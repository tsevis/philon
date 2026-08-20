"""Record a real conversion for the development host to answer with.

`src/dev/host.ts` serves this so the workspace can be worked on in a browser
without building the desktop shell, and `scripts/make-screenshots.mjs` captures
the README screenshots from it. The fixture is deliberately untracked: it is
the full extracted text of whatever document it was made from, and that is not
ours to publish.

Page rasters and extracted images are dropped. They are absolute paths on the
machine that ran the conversion and a browser cannot fetch them, so the panels
fall back to the text Philon actually extracted.

Usage:
    .venv/bin/python scripts/make-dev-fixture.py <document.pdf> [--profile Verified]
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DESTINATION = ROOT / "src" / "dev" / "conversion.json"
#: Absolute paths to files this machine happens to hold. Nothing a browser can
#: fetch, and nothing a screenshot should show as a broken image.
MACHINE_LOCAL = ("assets", "extracted_assets", "source_overlays", "page_previews")


def load_engine():
    spec = importlib.util.spec_from_file_location("philon_engine", ROOT / "engine" / "philon_engine.py")
    assert spec and spec.loader
    engine = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = engine
    spec.loader.exec_module(engine)
    return engine


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("document", type=Path, help="A PDF or image to convert")
    parser.add_argument("--profile", default="Verified", choices=["Fast", "Balanced", "Verified"])
    arguments = parser.parse_args()

    if not arguments.document.is_file():
        raise SystemExit(f"Not a file: {arguments.document}")

    engine = load_engine()
    vision = ROOT / "engine" / "dist" / "philon-vision-ocr"
    if vision.is_file():
        engine.VISION_HELPER = vision

    with tempfile.TemporaryDirectory() as workspace:
        response = engine.action_convert({"config": {
            "input_paths": [str(arguments.document.resolve())],
            "profile": arguments.profile,
            "workspace_dir": workspace,
        }})
        if response["failures"]:
            raise SystemExit(f"Conversion failed: {response['failures'][0]['error']}")
        document = response["results"][0]
        for key in MACHINE_LOCAL:
            document["outputs"].pop(key, None)
        for page in document["pages"]:
            page.pop("preview_path", None)
        DESTINATION.write_text(json.dumps(response, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"{DESTINATION.relative_to(ROOT)}  {len(document['pages'])} pages  "
          f"{len(document['blocks'])} blocks  {len(document['warnings'])} warnings  "
          f"{DESTINATION.stat().st_size // 1024}K")


if __name__ == "__main__":
    main()
