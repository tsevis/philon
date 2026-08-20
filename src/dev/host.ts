/**
 * A local host for `npm run dev`, so the workspace can be worked on in a
 * browser without building the desktop shell.
 *
 * The conversion it answers with is real: `scripts/make-dev-fixture.py` records
 * what Philon's own engine returned for a document. Nothing here invents a
 * block, a confidence or a warning — a fixture that flattered the interface
 * would make the interface impossible to judge.
 *
 * That fixture is untracked, because it is the full extracted text of whatever
 * document it was made from. It is loaded through `import.meta.glob` rather
 * than a static import so its absence is a quiet empty workspace rather than a
 * build error on a fresh clone.
 *
 * Installed only under `import.meta.env.DEV`, and only when no real Tauri host
 * is present, so it can never stand in for the engine in a packaged build.
 */
type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

interface ConvertedDocument {
  source_path: string;
  warnings: unknown[];
}

interface ConversionFixture {
  results: ConvertedDocument[];
}

interface TauriHost {
  __TAURI_INTERNALS__?: { invoke: Invoke; convertFileSrc: (path: string) => string };
}

const recorded = import.meta.glob<ConversionFixture>("./conversion.json", { eager: true, import: "default" });
const conversion: ConversionFixture | undefined = Object.values(recorded)[0];
const converted: ConvertedDocument | undefined = conversion?.results[0];

const MODEL_PACKS = [
  { id: "native-extraction", role: "extraction", required: true, approved: true, installed: true, license: "BSD-3-Clause", runtime: "pypdfium2", distribution: "bundled", integrity: "sha256", readiness: "ready", diagnostics: ["PDFium is bundled with the engine."] },
  { id: "apple-vision", role: "ocr", required: false, approved: true, installed: true, license: "macOS system framework", runtime: "Vision", distribution: "system", integrity: null, readiness: "ready", diagnostics: ["On-device recognition provided by macOS."] },
  { id: "local-repair", role: "manual repair", required: false, approved: false, installed: false, license: "non-commercial", runtime: "llama.cpp", distribution: "local", integrity: null, readiness: "blocked", diagnostics: ["Licence is not approved for this project."] },
];

const replies: Record<string, () => unknown> = {
  // The native file dialog is a plugin command; in a browser it answers with
  // the document the recorded conversion was actually made from.
  "plugin:dialog|open": () => converted?.source_path ?? null,
  list_jobs: () => converted
    ? [{ id: "job-1", created_at: new Date().toISOString(), profile: "Verified", status: "completed_with_warnings", documents: 1, warnings: converted.warnings.length }]
    : [],
  latest_batch: () => null,
  list_batch_items: () => [],
  get_job: () => conversion ?? null,
  run_conversion: () => conversion ?? { results: [], failures: [] },
  preflight_conversion: () => ({ items: [] }),
  engine_health: () => ({ engine: "philon-0.2.0", local_only: true, review_actions: ["accept", "edit", "restore_candidate", "rerun_region", "ignore_warning"] }),
  model_status: () => ({ packs: MODEL_PACKS }),
  apply_review: () => ({}),
  clear_library: () => ({ removed: 1 }),
};

export function installDevHost(): void {
  const host = window as unknown as TauriHost;
  if (host.__TAURI_INTERNALS__) return;
  if (!conversion) {
    // Not an error: a clone has no fixture until someone records one.
    console.info("Philon: no dev conversion recorded. Run scripts/make-dev-fixture.py <document.pdf> to populate the workspace.");
  }
  host.__TAURI_INTERNALS__ = {
    // A recorded fixture carries no page rasters, so this only has to exist.
    convertFileSrc: (path) => path,
    invoke: (command) => {
      const reply = replies[command];
      return reply ? Promise.resolve(reply()) : Promise.reject(new Error(`No dev host reply for ${command}`));
    },
  };
}
