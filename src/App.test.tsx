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
  // These tests exercise the workspace, which a first run does not open onto:
  // model setup takes the first launch. Mark it seen so each test starts where
  // an ordinary launch does; the first-run behaviour has its own tests below.
  localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({ modelSetupSeen: true }));
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

  it("leaves the page selection out entirely when the field is empty", async () => {
    respondWith({ run_conversion: conversionResult() });
    await renderWorkspace();
    await chooseDocument();
    fireEvent.click(convertButton());
    await waitFor(() => expect(callsTo("run_conversion").length).toBe(1));
    const config = callsTo("run_conversion")[0]?.config as Record<string, unknown>;
    // Absent, not "": the engine reads an absent selection as the whole
    // document, and an empty string would be a selection that matched nothing.
    expect(config.pages).toBeUndefined();
  });

  it("sends the page selection as written, for the engine to read", async () => {
    respondWith({ run_conversion: conversionResult() });
    await renderWorkspace();
    await chooseDocument();
    fireEvent.change(screen.getByLabelText("Pages to convert"), { target: { value: " 1-5,8 " } });
    fireEvent.click(convertButton());
    await waitFor(() => expect(callsTo("run_conversion").length).toBe(1));
    const config = callsTo("run_conversion")[0]?.config as Record<string, unknown>;
    expect(config.pages).toBe("1-5,8");
  });

  it("never requests the compatibility output unless it was turned on", async () => {
    respondWith({ run_conversion: conversionResult() });
    await renderWorkspace();
    await chooseDocument();
    fireEvent.click(convertButton());
    await waitFor(() => expect(callsTo("run_conversion").length).toBe(1));
    const config = callsTo("run_conversion")[0]?.config as { outputs: string[] };
    expect(config.outputs).not.toContain("page_tree");
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

  /// A queued document is drawn from the record the host returns. The whole
  /// workspace used to disappear here, because the record arrived with its
  /// fields renamed and the queue asked an absent path for its file name.
  it("names a queued document the host has described", async () => {
    const ready = { ...queued, source_path: "/docs/paper.pdf" };
    respondWith({
      enqueue_batch: "batch-1",
      list_batch_items: [ready],
      preflight_conversion: { items: [{ source_path: "/docs/paper.pdf", status: "ready", route: "native-text-pending", preflight: { kind: "pdf", bytes: 402144, declared_page_count: 12 } }] },
    });
    await renderWorkspace();
    fireEvent.click(screen.getByRole("tab", { name: /Batch/i }));
    bridge.open.mockResolvedValueOnce(["/docs/paper.pdf"]);
    fireEvent.click(screen.getByRole("button", { name: /Add documents/i }));

    expect(await screen.findByText("paper.pdf")).not.toBeNull();
    expect(await screen.findByText(/PDF · 12 page\(s\) · 393 KB · queued/)).not.toBeNull();
  });

  it("offers a queued document's own path for inspection", async () => {
    const ready = { ...queued, source_path: "/docs/paper.pdf" };
    respondWith({ enqueue_batch: "batch-1", list_batch_items: [ready], preflight_conversion: { items: [] } });
    await renderWorkspace();
    fireEvent.click(screen.getByRole("tab", { name: /Batch/i }));
    bridge.open.mockResolvedValueOnce(["/docs/paper.pdf"]);
    fireEvent.click(screen.getByRole("button", { name: /Add documents/i }));

    await waitFor(() => expect(callsTo("preflight_conversion").length).toBe(1));
    expect((callsTo("preflight_conversion")[0]?.config as { inputPaths: string[] }).inputPaths).toEqual(["/docs/paper.pdf"]);
  });
});

describe("preferences", () => {
  it("persists a changed output selection for the next session", async () => {
    await renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByLabelText("Page tree JSON (interchange)"));
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) || "{}");
      expect(stored.outputs).toContain("page_tree");
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

  it("offers a download only for an approved pack that is not already here", async () => {
    respondWith({ model_status: { packs: [
      modelPack({ id: "fetchable", readiness: "not-found", available_locally: false, downloadable: true, download_bytes: 545590272, download_verified: true }),
      modelPack({ id: "already-here", readiness: "ready", available_locally: true, downloadable: true, download_bytes: 100, download_verified: true }),
      modelPack({ id: "unapproved", approved: false, readiness: "blocked", available_locally: false, downloadable: true, download_bytes: 100 }),
    ] } });
    await renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Download" })).toHaveLength(1));
    // The size and the fact the bytes are checked are shown before anything is fetched.
    expect(screen.getByText("Download 520 MB, checked against a SHA-256")).toBeTruthy();
  });

  it("asks the host to fetch the pack and shows what came back", async () => {
    const installed = modelPack({ id: "fetchable", readiness: "ready", available_locally: true, managed: true, downloadable: true });
    respondWith({
      model_status: { packs: [modelPack({ id: "fetchable", readiness: "not-found", available_locally: false, downloadable: true, download_bytes: 100, download_verified: true })] },
      fetch_model: { status: "installed", pack_id: "fetchable", models: { packs: [installed] } },
    });
    await renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    fireEvent.click(await screen.findByRole("button", { name: "Download" }));
    await waitFor(() => expect(callsTo("fetch_model")).toEqual([{ packId: "fetchable", jobId: expect.any(String) }]));
    // ...and the pack Philon installed can be removed again.
    await screen.findByRole("button", { name: "Remove" });
  });

  it("surfaces a refused fetch rather than reporting success", async () => {
    respondWith({
      model_status: { packs: [modelPack({ id: "fetchable", readiness: "not-found", available_locally: false, downloadable: true, download_bytes: 100 })] },
      fetch_model: { status: "failed", pack_id: "fetchable", message: "did not match its declared SHA-256" },
    });
    await renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    fireEvent.click(await screen.findByRole("button", { name: "Download" }));
    expect(await screen.findByText(/did not match its declared SHA-256/)).toBeTruthy();
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

describe("first run", () => {
  it("opens model setup once, and not again", async () => {
    localStorage.clear();
    respondWith({ model_status: { packs: [modelPack({ id: "a-pack", readiness: "ready", available_locally: true })] } });
    await renderWorkspace();
    // Model setup is what a first launch lands on, so a person sees what
    // Philon can fetch before they convert anything.
    expect(await screen.findByRole("heading", { name: "Local model access" })).toBeTruthy();
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) || "{}");
      expect(stored.modelSetupSeen).toBe(true);
    });
    cleanup();
    resetBridge();
    respondWith({ model_status: { packs: [] } });
    await renderWorkspace();
    expect(screen.queryByRole("heading", { name: "Local model access" })).toBeNull();
  });

  it("says what it found and what it could fetch", async () => {
    localStorage.clear();
    respondWith({ model_status: { packs: [
      modelPack({ id: "here", readiness: "ready", available_locally: true }),
      modelPack({ id: "missing", readiness: "not-found", available_locally: false, downloadable: true, download_bytes: 100 }),
    ] } });
    await renderWorkspace();
    expect(await screen.findByText("1 of 2 approved packs are already on this machine; 1 can be downloaded.")).toBeTruthy();
  });
});

describe("about", () => {
  it("the menu item and the toolbar button open the same screen", async () => {
    // They did not. The toolbar button opened Philon's own about screen; the
    // menu used Tauri's predefined About item, which opens the stock macOS
    // panel -- an icon, a name and a version number. `install_native_menu`
    // says in its own doc comment that menu selection and its on-canvas
    // counterpart always perform the same action, and this was the one item
    // where that was untrue.
    // The splash opens itself on a first launch, so mark it seen: what is
    // under test is asking for it again once it has been dismissed.
    localStorage.setItem("philon.splash.seen.v1", VERSION);
    respondWith({ model_status: { packs: [] } });
    await renderWorkspace();
    expect(screen.queryByRole("dialog")).toBeNull();

    await act(async () => { emit("menu-command", "app-about"); });

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain(VERSION);
    // The stock panel carries a version and nothing else. This is the screen
    // that says what the program is and what it is built from.
    expect(dialog.textContent).toMatch(/Sources, licences and credits/i);
  });

  it("the toolbar button opens it too", async () => {
    localStorage.setItem("philon.splash.seen.v1", VERSION);
    respondWith({ model_status: { packs: [] } });
    await renderWorkspace();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByTitle("About Philon"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain(VERSION);
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

  /// The Library dated every job "Invalid Date" for as long as the host sent
  /// `createdAt` and this read `created_at`. The date is asserted here, so a
  /// record that loses its timestamp again fails a test rather than quietly
  /// printing a JavaScript artefact into the window.
  it("dates a job by the time the host recorded", async () => {
    respondWith({ list_jobs: [job] });
    await renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /^Library/ }));
    const dated = new Date("2026-01-01T00:00:00Z").toLocaleString();
    expect(await screen.findByText(new RegExp(dated.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).not.toBeNull();
  });

  it("never dates a job \"Invalid Date\"", async () => {
    respondWith({ list_jobs: [{ ...job, created_at: undefined }] });
    await renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /^Library/ }));
    expect(await screen.findByText(/Date not recorded/)).not.toBeNull();
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
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
