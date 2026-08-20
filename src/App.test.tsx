// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { bridge, callsTo, emit, modelPack, resetBridge, respondWith } from "./test/tauri-mock";
import App from "./App";
import { PREFERENCES_STORAGE_KEY } from "./lib/preferences";
import { VERSION } from "./lib/about";

const DOCUMENT_PATH = "/Users/someone/Documents/paper.pdf";

async function renderWorkspace() {
  const view = render(<App />);
  // The workspace asks the host for history and any interrupted batch on mount.
  await waitFor(() => expect(callsTo("list_jobs").length).toBeGreaterThan(0));
  return view;
}

/** Choose a single document through the mocked native file dialog. */
async function chooseDocument(path = DOCUMENT_PATH) {
  bridge.open.mockResolvedValueOnce(path);
  fireEvent.click(screen.getByRole("button", { name: /Open a document/i }));
  // The name appears both in the command bar and in the source panel header.
  await screen.findAllByTitle(path.split("/").pop()!);
}

function convertButton() {
  return screen.getByRole("button", { name: /Convert/i }) as HTMLButtonElement;
}

function isDisabled(element: HTMLElement) {
  return (element as HTMLButtonElement).disabled;
}

function conversionResult() {
  return { id: "job-1", profile: "Balanced", local_only: true, outputs: ["ir"], cache_policy: "use", results: [], failures: [], created_at: "2026-01-01T00:00:00Z" };
}

beforeEach(() => {
  resetBridge();
  localStorage.clear();
  respondWith();
});

afterEach(cleanup);

describe("conversion gating", () => {
  it("cannot start a conversion before a document is chosen", async () => {
    await renderWorkspace();
    expect(convertButton().disabled).toBe(true);
  });

  it("enables conversion once a document is chosen", async () => {
    await renderWorkspace();
    await chooseDocument();
    expect(convertButton().disabled).toBe(false);
  });

  it("sends the chosen document, profile, and stored preferences to the local host", async () => {
    respondWith({ run_conversion: conversionResult() });
    await renderWorkspace();
    await chooseDocument();
    fireEvent.click(screen.getByRole("button", { name: /Verified: /i }));
    fireEvent.click(convertButton());
    await waitFor(() => expect(callsTo("run_conversion").length).toBe(1));
    const config = callsTo("run_conversion")[0]?.config as Record<string, unknown>;
    expect(config.inputPaths).toEqual([DOCUMENT_PATH]);
    expect(config.profile).toBe("Verified");
    expect(config.cachePolicy).toBe("use");
  });

  it("never requests the compatibility output unless it was turned on", async () => {
    respondWith({ run_conversion: conversionResult() });
    await renderWorkspace();
    await chooseDocument();
    fireEvent.click(convertButton());
    await waitFor(() => expect(callsTo("run_conversion").length).toBe(1));
    const config = callsTo("run_conversion")[0]?.config as { outputs: string[] };
    expect(config.outputs).not.toContain("marker_json");
    expect(config.outputs).toContain("markdown");
  });

  it("reports a host failure in a dismissable banner instead of failing silently", async () => {
    respondWith({ run_conversion: new Error("The local engine closed before returning a result.") });
    await renderWorkspace();
    await chooseDocument();
    fireEvent.click(convertButton());
    const banner = await screen.findByText("The local engine closed before returning a result.");
    expect(banner).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Dismiss error/i }));
    await waitFor(() => expect(screen.queryByText("The local engine closed before returning a result.")).toBeNull());
  });

  it("re-enables the convert button after a failed conversion", async () => {
    respondWith({ run_conversion: new Error("Engine unavailable") });
    await renderWorkspace();
    await chooseDocument();
    fireEvent.click(convertButton());
    await screen.findByText("Engine unavailable");
    await waitFor(() => expect(convertButton().disabled).toBe(false));
  });
});

describe("conversion progress", () => {
  it("shows host progress for the running job", async () => {
    respondWith({ run_conversion: () => new Promise(() => {}) });
    await renderWorkspace();
    await chooseDocument();
    fireEvent.click(convertButton());
    const bar = await screen.findByRole("progressbar", { name: /Converting locally/i });
    await waitFor(() => expect(callsTo("run_conversion").length).toBe(1));
    const jobId = (callsTo("run_conversion")[0]?.config as { jobId: string }).jobId;
    act(() => emit("conversion-progress", { job_id: jobId, stage: "extracting", message: "Extracting page 2", percent: 40 }));
    await waitFor(() => expect(bar.getAttribute("aria-valuenow")).toBe("40"));
    expect(screen.getByText("Extracting page 2")).not.toBeNull();
  });

  it("ignores progress belonging to a different job", async () => {
    respondWith({ run_conversion: () => new Promise(() => {}) });
    await renderWorkspace();
    await chooseDocument();
    fireEvent.click(convertButton());
    const bar = await screen.findByRole("progressbar", { name: /Converting locally/i });
    await waitFor(() => expect(callsTo("run_conversion").length).toBe(1));
    const jobId = (callsTo("run_conversion")[0]?.config as { jobId: string }).jobId;
    act(() => emit("conversion-progress", { job_id: jobId, percent: 40, message: "Extracting page 2" }));
    await waitFor(() => expect(bar.getAttribute("aria-valuenow")).toBe("40"));
    act(() => emit("conversion-progress", { job_id: "a-stale-job", percent: 95, message: "Stale progress" }));
    expect(bar.getAttribute("aria-valuenow")).toBe("40");
    expect(screen.queryByText("Stale progress")).toBeNull();
  });
});

describe("batch safety", () => {
  const queued = { id: "item-1", batch_id: "batch-1", source_path: "/docs/blocked.pdf", status: "queued" as const, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };

  async function openBatchWithBlockedDocument() {
    respondWith({
      enqueue_batch: "batch-1",
      append_batch_items: null,
      list_batch_items: [queued],
      preflight_conversion: { items: [{ source_path: "/docs/blocked.pdf", status: "blocked", error: "PDF signature is invalid." }] },
    });
    await renderWorkspace();
    fireEvent.click(screen.getByRole("tab", { name: /Batch/i }));
    bridge.open.mockResolvedValueOnce(["/docs/blocked.pdf"]);
    fireEvent.click(screen.getByRole("button", { name: /Add documents/i }));
    await waitFor(() => expect(callsTo("preflight_conversion").length).toBe(1));
  }

  it("refuses to convert a batch while a document is blocked by preflight", async () => {
    await openBatchWithBlockedDocument();
    await waitFor(() => expect(convertButton().disabled).toBe(true));
  });

  it("shows the preflight reason a document was blocked", async () => {
    await openBatchWithBlockedDocument();
    expect(await screen.findByText("PDF signature is invalid.")).not.toBeNull();
  });
});

describe("preferences", () => {
  it("persists a changed output selection for the next session", async () => {
    await renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByLabelText("Marker JSON (compatibility)"));
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) || "{}");
      expect(stored.outputs).toContain("marker_json");
    });
  });

  it("refuses to leave a conversion with no output at all", async () => {
    await renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const checked = () => screen.getAllByRole("checkbox").filter((box) => (box as HTMLInputElement).checked);
    for (const box of checked()) fireEvent.click(box);
    expect(checked().length).toBe(1);
  });

  it("restores the documented defaults", async () => {
    await renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.change(await screen.findByDisplayValue("Balanced"), { target: { value: "Fast" } });
    fireEvent.click(screen.getByRole("button", { name: /Restore defaults/i }));
    await waitFor(() => expect((screen.getByDisplayValue("Balanced") as HTMLSelectElement).value).toBe("Balanced"));
  });
});

describe("model policy", () => {
  it("does not let a policy-blocked pack be enabled", async () => {
    respondWith({ model_status: { packs: [modelPack({ id: "local-repair", approved: false, readiness: "blocked" })] } });
    await renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    const toggle = await screen.findByRole("button", { name: "Blocked by policy" });
    expect(isDisabled(toggle)).toBe(true);
  });

  it("records an approved local pack the user turns on", async () => {
    respondWith({ model_status: { packs: [modelPack({ id: "local-verify", readiness: "ready" })] } });
    await renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    fireEvent.click(await screen.findByRole("button", { name: "Enable" }));
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) || "{}");
      expect(stored.enabledModelIds).toEqual(["local-verify"]);
    });
  });
});

describe("library", () => {
  const job = { id: "job-1", created_at: "2026-01-01T00:00:00Z", profile: "Balanced" as const, status: "completed", documents: 1, warnings: 0 };

  it("asks for confirmation before removing local history", async () => {
    respondWith({ list_jobs: [job], clear_library: { removed: 1 } });
    await renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /^Library/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Clean" }));
    expect(callsTo("clear_library").length).toBe(0);
    fireEvent.click(await screen.findByRole("button", { name: /Remove 1 job/i }));
    await waitFor(() => expect(callsTo("clear_library").length).toBe(1));
  });

  it("keeps exported files when history is removed", async () => {
    respondWith({ list_jobs: [job], clear_library: { removed: 1 } });
    await renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /^Library/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Clean" }));
    fireEvent.click(await screen.findByRole("button", { name: /Remove 1 job/i }));
    expect(await screen.findByText(/Exported files were kept/i)).not.toBeNull();
  });
});

describe("diagnostics", () => {
  it("reports the local engine contract without a network call", async () => {
    respondWith({ engine_health: { engine: "philon-0.2.0", local_only: true, review_actions: ["accept", "edit", "restore_candidate"] } });
    await renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Diagnostics" }));
    fireEvent.click(await screen.findByRole("button", { name: /Run check/i }));
    expect(await screen.findByText(/philon-0\.2\.0 is ready\. Local-only: yes\. 3 review actions available\./)).not.toBeNull();
  });
});

describe("reaching the about screen again", () => {
  // The splash is deliberately a once-per-version thing, so from the second
  // launch onwards the About button in the top bar is the only way back to
  // what Philon promises. A dead button there means the text is simply gone.
  beforeEach(() => localStorage.setItem("philon.splash.seen.v1", VERSION));

  it("stays out of the way on a launch that has already seen this version", async () => {
    await renderWorkspace();
    expect(screen.queryByRole("dialog", { name: "Philon" })).toBeNull();
  });

  it("reopens the about screen from the top bar", async () => {
    await renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /About Philon/i }));
    expect(screen.getByRole("dialog", { name: "Philon" })).not.toBeNull();
  });

  it("closes again on Continue", async () => {
    await renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /About Philon/i }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.queryByRole("dialog", { name: "Philon" })).toBeNull();
  });
});
