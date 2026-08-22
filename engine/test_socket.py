import asyncio
import contextlib
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

MODULE_PATH = Path(__file__).with_name("philon_engine.py")
SPEC = importlib.util.spec_from_file_location("philon_engine", MODULE_PATH)
assert SPEC and SPEC.loader
engine = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = engine
SPEC.loader.exec_module(engine)

TOKEN = "0f8c1d2e3a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f"
BIND_TIMEOUT_SECONDS = 5.0
EXCHANGE_TIMEOUT_SECONDS = 60.0


@contextlib.asynccontextmanager
async def running_bridge(socket_path: Path, token: str = TOKEN):
    """Serve the real engine bridge on a private socket for one test."""
    server = asyncio.ensure_future(engine.serve(socket_path, token))
    deadline = asyncio.get_event_loop().time() + BIND_TIMEOUT_SECONDS
    while not socket_path.exists():
        if server.done() or asyncio.get_event_loop().time() > deadline:
            await server  # surfaces the bind failure instead of hanging
            raise TimeoutError("The engine bridge never bound its socket.")
        await asyncio.sleep(0.01)
    try:
        yield socket_path
    finally:
        server.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await server


async def exchange(socket_path: Path, request: dict) -> tuple[list[dict], dict | None]:
    """Send one line-delimited request and split progress from the final frame."""
    reader, writer = await asyncio.open_unix_connection(str(socket_path))
    writer.write((json.dumps(request, ensure_ascii=False) + "\n").encode("utf-8"))
    await writer.drain()
    progress: list[dict] = []
    final: dict | None = None
    while True:
        line = await reader.readline()
        if not line:
            break
        message = json.loads(line.decode("utf-8"))
        if message.get("type") == "progress":
            progress.append(message["data"])
            continue
        final = message
    writer.close()
    with contextlib.suppress(Exception):
        await writer.wait_closed()
    return progress, final


async def send_raw(socket_path: Path, payload: bytes) -> dict:
    reader, writer = await asyncio.open_unix_connection(str(socket_path))
    writer.write(payload)
    await writer.drain()
    line = await reader.readline()
    writer.close()
    with contextlib.suppress(Exception):
        await writer.wait_closed()
    return json.loads(line.decode("utf-8"))


def run_on_bridge(scenario, token: str = TOKEN):
    """Run one async scenario against a freshly bound bridge in a temp directory."""

    async def main():
        with tempfile.TemporaryDirectory() as directory:
            socket_path = Path(directory) / "philon.sock"
            async with running_bridge(socket_path, token):
                return await asyncio.wait_for(
                    scenario(socket_path, Path(directory)), timeout=EXCHANGE_TIMEOUT_SECONDS
                )

    return asyncio.run(main())


class BridgeAuthenticationTest(unittest.TestCase):
    def test_a_wrong_token_is_rejected_before_any_action_runs(self):
        async def scenario(socket_path, _directory):
            return await exchange(socket_path, {"action": "models", "token": "not-the-session-token"})

        with mock.patch.object(engine, "action_models") as never_called:
            _progress, response = run_on_bridge(scenario)
        self.assertFalse(response["ok"])
        self.assertIn("Unauthenticated", response["error"])
        never_called.assert_not_called()

    def test_a_request_without_a_token_is_rejected(self):
        async def scenario(socket_path, _directory):
            return await exchange(socket_path, {"action": "health"})

        _progress, response = run_on_bridge(scenario)
        self.assertFalse(response["ok"])
        self.assertIn("Unauthenticated", response["error"])

    def test_a_non_string_token_is_rejected_without_a_type_error(self):
        async def scenario(socket_path, _directory):
            return await exchange(socket_path, {"action": "health", "token": ["not", "a", "string"]})

        _progress, response = run_on_bridge(scenario)
        self.assertFalse(response["ok"])
        self.assertIn("Unauthenticated", response["error"])

    def test_an_empty_session_token_rejects_every_request(self):
        # An engine started without a token must never fall open.
        async def scenario(socket_path, _directory):
            return await exchange(socket_path, {"action": "health", "token": ""})

        _progress, response = run_on_bridge(scenario, token="")
        self.assertFalse(response["ok"])
        self.assertIn("Unauthenticated", response["error"])

    def test_a_rejected_request_does_not_stop_the_bridge_serving_the_next_one(self):
        async def scenario(socket_path, _directory):
            _rejected_progress, rejected = await exchange(socket_path, {"action": "health", "token": "wrong"})
            _accepted_progress, accepted = await exchange(socket_path, {"action": "health", "token": TOKEN})
            return rejected, accepted

        rejected, accepted = run_on_bridge(scenario)
        self.assertFalse(rejected["ok"])
        self.assertTrue(accepted["ok"])


class BridgeTransportTest(unittest.TestCase):
    def test_the_socket_is_created_with_owner_only_permissions(self):
        async def scenario(socket_path, _directory):
            return os.stat(socket_path).st_mode & 0o777

        self.assertEqual(run_on_bridge(scenario), 0o600)

    def test_a_stale_socket_file_is_replaced_at_startup(self):
        async def main():
            with tempfile.TemporaryDirectory() as directory:
                socket_path = Path(directory) / "philon.sock"
                socket_path.write_text("stale socket left by a killed engine")
                async with running_bridge(socket_path):
                    return await asyncio.wait_for(
                        exchange(socket_path, {"action": "health", "token": TOKEN}),
                        timeout=EXCHANGE_TIMEOUT_SECONDS,
                    )

        _progress, response = asyncio.run(main())
        self.assertTrue(response["ok"])

    def test_a_malformed_request_line_is_reported_as_an_error_frame(self):
        async def scenario(socket_path, _directory):
            return await send_raw(socket_path, b"{this is not json}\n")

        response = run_on_bridge(scenario)
        self.assertFalse(response["ok"])
        self.assertTrue(response["error"])

    def test_an_unknown_action_names_the_action_it_refused(self):
        async def scenario(socket_path, _directory):
            return await exchange(socket_path, {"action": "exfiltrate", "token": TOKEN})

        _progress, response = run_on_bridge(scenario)
        self.assertFalse(response["ok"])
        self.assertIn("exfiltrate", response["error"])

    def test_every_response_is_a_single_newline_delimited_frame(self):
        async def scenario(socket_path, _directory):
            reader, writer = await asyncio.open_unix_connection(str(socket_path))
            writer.write((json.dumps({"action": "health", "token": TOKEN}) + "\n").encode("utf-8"))
            await writer.drain()
            body = await reader.read()
            writer.close()
            with contextlib.suppress(Exception):
                await writer.wait_closed()
            return body

        body = run_on_bridge(scenario)
        self.assertTrue(body.endswith(b"\n"))
        self.assertEqual(len(body.decode("utf-8").strip().splitlines()), 1)


class BridgeActionTest(unittest.TestCase):
    def test_health_reports_the_local_only_engine_contract(self):
        async def scenario(socket_path, _directory):
            return await exchange(socket_path, {"action": "health", "token": TOKEN})

        _progress, response = run_on_bridge(scenario)
        self.assertTrue(response["ok"])
        self.assertTrue(response["data"]["local_only"])
        self.assertEqual(response["data"]["engine"], engine.ENGINE_VERSION)
        self.assertIn("restore_candidate", response["data"]["review_actions"])

    def test_models_reports_pack_readiness_over_the_socket(self):
        async def scenario(socket_path, _directory):
            return await exchange(socket_path, {"action": "models", "token": TOKEN})

        _progress, response = run_on_bridge(scenario)
        self.assertTrue(response["ok"])
        self.assertTrue(all(pack["readiness"] for pack in response["data"]["packs"]))

    def test_preflight_returns_blocked_items_over_the_socket(self):
        async def scenario(socket_path, directory):
            source = directory / "bad.pdf"
            source.write_text("not a PDF")
            return await exchange(
                socket_path,
                {"action": "preflight", "token": TOKEN, "config": {"input_paths": [str(source)]}},
            )

        _progress, response = run_on_bridge(scenario)
        self.assertTrue(response["ok"])
        self.assertEqual(response["data"]["items"][0]["status"], "blocked")

    def test_convert_streams_progress_before_the_final_result(self):
        try:
            from PIL import Image
        except ImportError:
            self.skipTest("Pillow is not installed")

        async def scenario(socket_path, directory):
            source = directory / "scan.png"
            Image.new("RGB", (32, 32), "white").save(source)
            return await exchange(
                socket_path,
                {
                    "action": "convert",
                    "token": TOKEN,
                    "config": {
                        "input_paths": [str(source)],
                        "profile": "Fast",
                        "workspace_dir": str(directory / "workspace"),
                    },
                },
            )

        progress, response = run_on_bridge(scenario)
        self.assertTrue(response["ok"])
        self.assertTrue(progress)
        self.assertEqual(progress[0]["stage"], "starting")
        self.assertTrue(all(0 <= item["percent"] <= 100 for item in progress))
        self.assertTrue(all(item["total"] == 1 for item in progress))
        self.assertTrue(response["data"]["local_only"])
        self.assertEqual(len(response["data"]["results"]), 1)

    def test_convert_rejects_a_job_with_no_input_path(self):
        async def scenario(socket_path, directory):
            return await exchange(
                socket_path,
                {"action": "convert", "token": TOKEN, "config": {"workspace_dir": str(directory)}},
            )

        _progress, response = run_on_bridge(scenario)
        self.assertFalse(response["ok"])
        self.assertIn("at least one local input path", response["error"])

    def test_convert_rejects_an_unknown_profile(self):
        async def scenario(socket_path, directory):
            return await exchange(
                socket_path,
                {
                    "action": "convert",
                    "token": TOKEN,
                    "config": {
                        "input_paths": [str(directory / "any.pdf")],
                        "profile": "Cloud",
                        "workspace_dir": str(directory),
                    },
                },
            )

        _progress, response = run_on_bridge(scenario)
        self.assertFalse(response["ok"])
        self.assertIn("Fast, Balanced, or Verified", response["error"])

    def test_convert_rejects_an_empty_output_selection(self):
        async def scenario(socket_path, directory):
            return await exchange(
                socket_path,
                {
                    "action": "convert",
                    "token": TOKEN,
                    "config": {
                        "input_paths": [str(directory / "any.pdf")],
                        "outputs": [],
                        "workspace_dir": str(directory),
                    },
                },
            )

        _progress, response = run_on_bridge(scenario)
        self.assertFalse(response["ok"])
        self.assertIn("At least one output", response["error"])


class ConvertRequestContractTest(unittest.TestCase):
    def test_a_failing_document_is_isolated_from_the_rest_of_the_batch(self):
        try:
            from PIL import Image
        except ImportError:
            self.skipTest("Pillow is not installed")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "scan.png"
            Image.new("RGB", (32, 32), "white").save(source)
            response = engine.action_convert(
                {
                    "config": {
                        "input_paths": [str(source), str(root / "missing.pdf")],
                        "profile": "Fast",
                        "workspace_dir": str(root / "workspace"),
                    }
                }
            )
        self.assertEqual(len(response["results"]), 1)
        self.assertEqual(len(response["failures"]), 1)
        self.assertIn("missing.pdf", response["failures"][0]["source_path"])
        self.assertTrue(response["failures"][0]["error"])

    def test_the_verified_profile_always_requests_embeddings(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            response = engine.action_convert(
                {
                    "config": {
                        "input_paths": [str(root / "missing.pdf")],
                        "profile": "Verified",
                        "outputs": ["ir"],
                        "workspace_dir": str(root / "workspace"),
                    }
                }
            )
        self.assertIn("embeddings", response["outputs"])
        self.assertEqual(response["profile"], "Verified")

    def test_the_verified_profile_never_mutates_the_requested_output_list(self):
        requested = ["ir"]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            response = engine.action_convert(
                {
                    "config": {
                        "input_paths": [str(root / "missing.pdf")],
                        "profile": "Verified",
                        "outputs": requested,
                        "workspace_dir": str(root / "workspace"),
                    }
                }
            )
        self.assertEqual(requested, ["ir"])
        self.assertIn("embeddings", response["outputs"])

    def test_a_convert_response_owns_its_output_list(self):
        requested = ["ir", "evidence"]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            response = engine.action_convert(
                {
                    "config": {
                        "input_paths": [str(root / "missing.pdf")],
                        "outputs": requested,
                        "workspace_dir": str(root / "workspace"),
                    }
                }
            )
        response["outputs"].append("page_tree")
        self.assertEqual(requested, ["ir", "evidence"])

    def test_a_convert_response_records_its_local_only_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            response = engine.action_convert(
                {
                    "config": {
                        "input_paths": [str(root / "missing.pdf")],
                        "cache_policy": "bypass",
                        "local_repair": True,
                        "workspace_dir": str(root / "workspace"),
                    }
                }
            )
        self.assertTrue(response["local_only"])
        self.assertTrue(response["local_repair_requested"])
        self.assertEqual(response["cache_policy"], "bypass")
        self.assertTrue(response["id"])
        self.assertTrue(response["created_at"])


if __name__ == "__main__":
    unittest.main()
