<div align="center">

<img src="docs/screenshots/splash.png" alt="The Philon splash screen: an engraved scholar holding a closed book, with the application name and version" width="640">

# Philon

**Documents converted with their evidence intact.**

A macOS-first, local-first document conversion workspace. Philon begins with a
document's own structure, keeps the evidence for every block it emits, and
marks uncertainty instead of quietly inventing text.

</div>

---

## Why it is called that

Philon of Alexandria spent his life reading one tradition in the language of
another. Writing in Greek in the first century, he worked through the Hebrew
scriptures a passage at a time — quoting the line, then drawing out what he
took it to mean — and he held that the literal sense had to stand even where
the allegory moved him most, against contemporaries content to let the reading
replace the text.

A conversion is a reading. A PDF becomes Markdown only because something
decided what was a heading, what was a table, and what the letters were. Philon
keeps the source beside the reading, and marks what it cannot settle instead of
smoothing it into fluent text nobody can go back and verify.

## The workspace

![The Philon workspace: the source page, the readable conversion, and the evidence panel side by side](docs/screenshots/workspace.png)

Three panels, always together. The **source** as Philon read it, the
**conversion** it produced, and the **evidence** behind the selected block —
which method read it, how confident that reading is, whether the source region
was measured, and what the Verified checks found. Selecting a block in either
of the first two panels moves the other two with it.

The warnings on the right are not decoration. `READING ORDER AMBIGUOUS` means
the measured geometry moved upward between emitted blocks: possibly a
multi-column transition. Philon keeps the source order, says so, and asks for
review rather than guessing.

## What it does

- **Evidence for every block.** A versioned Philon IR carries source method,
  confidence, validation record, warnings, measured source geometry, and stable
  block IDs.
- **Native structure first.** PDFium-first extraction, with Apple Vision for
  on-device recognition of images and textless pages. A page that cannot be read
  is reported, never invented.
- **Three profiles.** `Fast` is native-text only and never invokes OCR.
  `Balanced` is the default, using Apple Vision only for image or textless-PDF
  input. `Verified` adds deterministic source-geometry, duplicate-content, and
  reading-order ambiguity checks; it reports uncertainty for review rather than
  changing source order.
- **Intake preflight.** Invalid signatures, empty files, encrypted PDFs, and
  documents beyond the V1 size and page limits are refused before extraction.
  Images are checked for container integrity, single-frame status, and a
  100-megapixel ceiling before anything reaches OCR.
- **Local review as provenance.** Accepting, editing, or restoring a candidate
  is recorded as a reversible decision, and the original candidate is retained.
- **Single Job and Batch.** Batch items pause and cancel at a document boundary,
  and an interrupted batch is still there after a restart.

### Local model access

![The Models pane: native extraction built in, Apple Vision available, and a local repair pack blocked by policy](docs/screenshots/models.png)

Optional model packs stay off until you enable them, and a pack whose licence
has not been approved cannot be enabled at all — the control is disabled and
says why. The pane reports readiness, missing runtimes, and policy blocks
**without loading a model or making a network request**.

### History and preferences

<img src="docs/screenshots/library.png" alt="The Library pane listing locally retained conversions" width="49%"> <img src="docs/screenshots/settings.png" alt="The Settings pane with conversion profile, cache behaviour, and output format preferences" width="49%">

Conversion history is a local SQLite database on your Mac. Removing it removes
the records, not the files you exported. Output formats are chosen once and
apply to every new conversion.

## Local only

The desktop host launches `engine/philon_engine.py` as a local process and
talks to it over a `0600` Unix-domain socket authenticated with a per-session
token. There is no local HTTP server and no cloud credential. `npm run
local-only:check` is a source-level gate that fails the build if an HTTP client
reaches the runtime sources, so this stays true rather than merely being
intended.

Your documents are yours. Philon never sends a document, a fragment, or a
filename anywhere.

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

To work on the interface without building the desktop shell, `npm run dev`
serves the workspace with a development host installed only under
`import.meta.env.DEV`, which never reaches a packaged build. It answers with a
real conversion you record yourself:

```bash
.venv/bin/python scripts/make-dev-fixture.py path/to/document.pdf
```

That fixture is untracked, because it is the full extracted text of whatever
document it was made from. Without one the workspace simply opens empty; the
dev host does not invent a document to fill it.

The screenshots above are produced by `node scripts/make-screenshots.mjs`
against that dev server, so they can be regenerated rather than hand-collected.
The document shown in them is a journal article converted locally; only the
images are committed, not its text.

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

To rebuild and verify the ad-hoc signed DMG in the same sequence, run
`npm run release:verify -- --package`. The bundle is sealed with an ad-hoc
signature, so `codesign --verify` passes locally; it carries no Developer ID
and is not notarized.

`npm run release:verify` and the workflows run the same checks in the same
order, so a local run is not a weaker one. That equivalence is the point:
**both workflows are currently disabled**. They need `macos-15` runners, which
this private repository is billed for at ten times the wall-clock minutes, and
verification does not depend on them. Re-enable either with
`gh workflow enable "Verify Philon"`.

`npm run release:verify -- --package` additionally produces and checksums the
DMG, which is what `Package Philon` uploads when it is enabled.

Packaging and notarization require the project owner's Apple Developer
signing credentials; no signing identity is embedded in this repository.

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

## Releases

A version number here describes the application. The engine contract and the IR
version are deliberately separate and both remain at 0.2.0, so a document
converted by any 0.2.x build carries the same evidence shape.

**0.2.3** — A heading has to be a line of its own. `classify_block` judged a
block by its first line — capitalised, under a hundred characters, no full stop
— and the first line of ordinary prose is all three, because it ends mid-clause.
A wrapped paragraph of up to three lines therefore became a heading: converting
a page of plain prose emitted two of its three paragraphs as H2s. The cost of
the narrower rule is a heading that wraps onto a second line, which is rarer
than a paragraph that does.

**0.2.2** — Philon stops its engine when it quits. The engine was spawned and
never reaped: a `Child` does not kill on drop, and the application was run
without an exit handler, so an engine could outlive the window that started it
by a day and still hold its socket. Killing the process Philon holds is not
enough either, because the packaged engine is a PyInstaller one-file binary
whose bootloader runs the real interpreter as a child of its own. The engine
now runs in its own process group, and shutting down signals that group:
SIGTERM first, so the bootloader can remove what it unpacked, then SIGKILL for
anything that ignored it.

**0.2.1** — The About button in the top bar opens the screen it names. It had
no handler at all, so once the splash had been seen for a version there was no
way back to what Philon promises. The macOS bundle is now sealed with an ad-hoc
signature: `codesign --verify` passes on it instead of reporting an unsealed
bundle. It remains un-notarized and carries no Developer ID, so Gatekeeper
still refuses it on a machine that did not build it. The project is licensed
MIT.

## Licence

MIT. Model packs must be declared in `engine/model-manifest.json` and pass the project licence policy before becoming required dependencies.
