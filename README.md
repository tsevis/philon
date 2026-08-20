# Philon

Philon is a macOS-first, local-first document conversion workspace. It begins with native source structure, retains evidence for every emitted block, and marks uncertainty instead of silently inventing text.

## Included in this foundation

- Tauri 2 desktop shell for macOS with a Single Job and Batch workspace.
- Local authenticated Unix-socket bridge from the Rust host to the Python engine.
- SQLite-backed conversion history.
- A versioned Philon IR with source method, confidence, validation record, warnings, and stable block IDs.
- PDFium-first extraction with a development fallback, image intake, deterministic Markdown/HTML/IR/chunk/evidence exports, hashing, and content-addressed caching.
- Intake preflight that rejects invalid signatures, empty files, encrypted PDFs, and documents beyond the V1 size/page limits before extraction.
- Image intake also checks container integrity, single-frame status, and a 100-megapixel limit before handing anything to OCR.
- Explicit local-only policy. Apple Vision handles on-device OCR for image inputs and textless PDF pages; unavailable recognition never causes invented text or VLM output.
- Original application icon at `src-tauri/icons/icon.png`.

## Deliberate V1 boundaries

The architecture includes adapters for tables, formulas, layout models, and manual local VLM repair. Those model packs are intentionally not bundled yet: each needs a documented accuracy bakeoff and licence approval before it becomes a Philon runtime dependency. Apple Vision is an approved macOS-system OCR runtime; its output retains line confidence and provenance.

The Models pane can also discover local olmOCR, Qwen, and BGE-M3 copies from
the system model inventory. On this private development Mac, Qwen 3.8 27B with
its local multimodal projector is the preferred **manual-only** repair adapter;
olmOCR is retained as the fallback. Philon renders and retains the selected
source crop, records the candidate and model artefact fingerprint, and never
replaces text automatically. Qwen 2.5 VL remains blocked because its installed
licence is non-commercial. BGE-M3 is permitted only as a user-authorized local
Verified sidecar; its runtime and artifact are checked before vector export.
The Models pane reports readiness, missing runtimes, and policy blocks without
loading a model or making a network request.

Philon does not reuse Marker code or models.

The current engine also marks repeated page artifacts, retains a per-page routing decision, detects only safely delimited native tables for CSV export, flags formula-like native blocks, and records local human review decisions as reversible provenance. It does not yet perform geometric table recovery, formula recognition, or automatic VLM repair.

`Fast` is native-text only and never invokes OCR. `Balanced` is the default,
using Apple Vision only for image or textless-PDF input. `Verified` adds
deterministic source-geometry, duplicate-content, and reading-order ambiguity
checks; it reports uncertainty for review rather than changing source order.

## Development

```bash
npm install
python3 -m venv .venv
.venv/bin/pip install -r engine/requirements.txt
npm run tauri dev
```

The desktop host launches `engine/philon_engine.py` as a local process and communicates through a `0600` Unix-domain socket. No local HTTP server or cloud credential is required.

## Verification

`npm test` runs the workspace, engine, and type checks together. `npm run
release:verify` runs the complete sequence below, which is what CI performs.

```bash
npm run license:check      # model packs carry an approved licence
npm run sbom:check         # every declared dependency is in SBOM.cdx.json
npm run local-only:check   # no HTTP client reached the runtime sources
npm run test:ui            # workspace logic and React component behaviour
npm run test:engine        # engine, socket bridge, preflight fuzz, benchmark harness
npm run test:bench         # benchmark harness alone, also covered by test:engine
npm run build              # tsc --noEmit and the production bundle
cargo test  --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

Tests live beside what they cover: `engine/test_engine.py` for conversion and
evidence, `engine/test_socket.py` for the authenticated Unix-socket bridge,
`engine/test_fuzz.py` for the malformed-input corpus, `bench/test_run.py` for
the benchmark harness, `src/**/*.test.ts` for workspace logic, and
`src/App.test.tsx` for the React workspace against a mocked Tauri host.

Two Apple Vision tests are skipped unless the native helper has been built and
the integration flag is set. `npm run engine:package` compiles the helper to
`engine/dist/philon-vision-ocr`; after that, run them with:

```bash
PHILON_VISION_INTEGRATION=1 npm run test:engine
```

`npm run sbom:check` cross-references `package.json` and
`src-tauri/Cargo.toml`, so adding a dependency without declaring it in
`SBOM.cdx.json` fails the check. Components record whether they are shipped,
build-only, or test-only, and a copyleft licence on a shipped component is
rejected rather than assumed to be intentional.

To rebuild and verify the unsigned DMG in the same sequence, run
`npm run release:verify -- --package`. This does not sign or notarize the app.

The GitHub Actions workflow runs the same checks on macOS 15. Packaging and notarization require the project owner's Apple Developer signing credentials; no signing identity is embedded in this repository.

## Outputs

Philon 0.2 writes two complementary layers from the same local evidence:

- `machine/` is the canonical machine package. `blocks.ndjson` is streamable
  for LLMs and databases; `reading-order.json`, `pages/`, and `assets.json`
  preserve page structure, geometry, visual-asset provenance, and uncertainty.
  Each block keeps source-retained `text` beside safe-reflowed `reading_text`.
- `*.md` is clean reading Markdown for text apps. It reflows source lines and
  cautiously rejoins line-end hyphenation, but keeps source-page comments and
  never appends a distracting image gallery.
- `*.html` is a standalone responsive presentation document. It is text-first
  and places a collapsible original-page facsimile with each source page.

For each input, Philon also creates a dedicated export directory containing:

- `*.philon.json` canonical IR
- `*.chunks.json` RAG chunks with source block IDs
- `*.evidence.json` warnings, confidence summary, validation record, and timings
- `philon-output-manifest.json` stable relative file paths and SHA-256 hashes
- `assets/page-previews/*.png` local review rasters used for source/evidence overlays
- `images/*` native PDF image streams, deduplicated by hash with a page/object provenance manifest
- optional `*.marker.json` compatibility output with embedded image data
- `tables/*.csv` for native tables whose delimiter and row shape were provable

The machine package, clean Markdown, and presentation HTML are selected by
default. Marker JSON remains available as an explicit compatibility option.
Export directories include a source-hash and profile suffix. This prevents two
unrelated `paper.pdf` files from overwriting one another, while each exported
text file is committed atomically. Markdown, semantic HTML, and the Philon IR
refer to each extracted image using a portable relative path plus source-page
provenance. Philon labels these as source assets and requests visual-description
review rather than inventing image alt text.

## Benchmarks

Use the private-corpus harness in [`bench/README.md`](bench/README.md) to record local runs, including cold/warm timing, cache use, source-map coverage, output-contract failures, and optional private-gold accuracy metrics. Public claims against Marker or Docling remain blocked until the same version-pinned corpus, hardware, and methodology have been run.

## Licence

Apache-2.0. Model packs must be declared in `engine/model-manifest.json` and pass the project licence policy before becoming required dependencies.
