import conversion from "./conversion.json";

/**
 * A local host for `npm run dev`, so the workspace can be worked on in a
 * browser without building the desktop shell.
 *
 * The conversion it answers with is real: `src/dev/conversion.json` is the
 * response Philon's own engine returned for a PDF, trimmed to its first six
 * pages. Nothing here invents a block, a confidence or a warning — a fixture
 * that flattered the interface would make the interface impossible to judge.
 *
 * Installed only under `import.meta.env.DEV`, and only when no real Tauri host
 * is present, so it can never stand in for the engine in a packaged build.
 */
type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

interface ConversionFixture {
  results: Array<{ warnings: unknown[] }>;
}

interface TauriHost {
  __TAURI_INTERNALS__?: { invoke: Invoke; convertFileSrc: (path: string) => string };
}

const converted = (conversion as ConversionFixture).results[0];

const SOURCE_PATH = "documents/Research/Qwen Architecting Philon_ A Decision-Ready Blueprint for High-Fidelity, Local-First Document Conversion.pdf";

const replies: Record<string, () => unknown> = {
  // The native file dialog is a plugin command; in a browser it answers with
  // the document this fixture was actually converted from.
  "plugin:dialog|open": () => SOURCE_PATH,
  list_jobs: () => [
    { id: "job-1", created_at: new Date().toISOString(), profile: "Verified", status: "completed_with_warnings", documents: 1, warnings: converted.warnings.length },
  ],
  latest_batch: () => null,
  list_batch_items: () => [],
  get_job: () => conversion,
  run_conversion: () => conversion,
  preflight_conversion: () => ({ items: [] }),
  engine_health: () => ({ engine: "philon-0.2.0", local_only: true, review_actions: ["accept", "edit", "restore_candidate", "rerun_region", "ignore_warning"] }),
  model_status: () => ({
    packs: [
      { id: "native-extraction", role: "extraction", required: true, approved: true, installed: true, license: "BSD-3-Clause", runtime: "pypdfium2", distribution: "bundled", integrity: "sha256", readiness: "ready", diagnostics: ["PDFium is bundled with the engine."] },
      { id: "apple-vision", role: "ocr", required: false, approved: true, installed: true, license: "macOS system framework", runtime: "Vision", distribution: "system", integrity: null, readiness: "ready", diagnostics: ["On-device recognition provided by macOS."] },
      { id: "local-repair", role: "manual repair", required: false, approved: false, installed: false, license: "non-commercial", runtime: "llama.cpp", distribution: "local", integrity: null, readiness: "blocked", diagnostics: ["Licence is not approved for this project."] },
    ],
  }),
  apply_review: () => ({}),
  clear_library: () => ({ removed: 1 }),
};

export function installDevHost(): void {
  const host = window as unknown as TauriHost;
  if (host.__TAURI_INTERNALS__) return;
  host.__TAURI_INTERNALS__ = {
    // The fixture carries no page rasters, so this only has to be a function.
    convertFileSrc: (path) => path,
    invoke: (command) => {
      const reply = replies[command];
      return reply ? Promise.resolve(reply()) : Promise.reject(new Error(`No dev host reply for ${command}`));
    },
  };
}
