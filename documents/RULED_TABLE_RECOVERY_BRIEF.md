# Ruled table recovery — brief for a fresh session

Philon's README names geometric table recovery as a V1 gap: today it exports
only "safely delimited native tables". This is the brief for closing it, written
to be handed to a session that has none of the context that produced it.

It records a decision already taken and a prototype already run, so neither has
to be rediscovered. It is not a specification: the plan below is a starting
shape, not a contract.

---

Continue Philon's geometric table recovery. Two repos, kept in parity:

    /Users/tsevis/AI/ClaudeCode/philon      (Tauri/React + Rust + Python engine)
    /Users/tsevis/AI/ClaudeCode/philon_p    (PySide6 Qt port of the same engine)

Both are on `main`, clean, pushed. Work on a branch and merge when green.

## Goal

Recover ruled tables from the drawn rules a PDF contains, deterministically,
and emit them as real tables.

## Decision already made — do not reverse without asking

Do **not** add pdfplumber. It was evaluated and rejected: it works well
(recovered a 3×3 ruled table exactly via its `lines` strategy) but pulls
`pdfminer.six`, `charset-normalizer`, `cryptography`, `cffi` and `pycparser` —
taking Philon from 4 runtime dependencies to 9, ~25MB including a compiled Rust
crypto library, and 5 new SBOM entries per repo. Philon gates dependencies
deliberately. Implement on PDFium's own path objects instead; pypdfium2 is
already a dependency.

## What is already proven (prototype, not committed)

    page.get_objects(filter=[raw.FPDF_PAGEOBJ_PATH], max_depth=4)
    obj.get_bounds() -> (left, bottom, right, top)

A rule is a path whose bounding box is long on one axis and thin on the other
(thickness ≤ ~2.5pt, length > ~12pt). Using **bounds** rather than parsing path
segments is deliberate: many producers draw rules as thin filled rectangles,
which segment parsing would miss.

On a test PDF this yielded exactly:

    horizontal rules at y = 628, 652, 676, 700
    vertical   rules at x =  60, 220, 340, 460

i.e. a clean 3-row × 3-column grid.

## Plan

1. Pure, testable functions in `engine/philon_engine.py`:

       page_rules(page)                  -> horizontal/vertical rules in page space
       cluster_positions(values, tol)    -> collapse near-equal rules to one line
       ruled_table_grids(h, v)           -> grids where ≥2 rules cross ≥2 others
       table_cell_text(textpage, grid)   -> cell text from character boxes

   Reuse the character-box scan already written for link anchoring in
   `measure_link_anchors` — same technique, same place.

2. Record grids on the source page in `pdfium_extract`, and in the IR page record.

3. Collapse the parts inside a grid into one table part in
   `geometric_native_parts`, attaching the recovered rows to the block.

4. `render_markdown` / `render_html` prefer attached rows over the existing
   delimiter-based `table_rows()`; export CSV via `table_export_groups()`.

## Hard constraints

- **Parity.** `engine/philon_engine.py` must be identical in both repos except
  one documented hunk (a `RuntimeError` in an `except` tuple, commented in the
  source, recorded in `philon_p/docs/PARITY.md`). `diff` the two files — it must
  report exactly 1 hunk. Nothing checks this automatically; each repo tests its
  own copy.
- **Coordinate frame.** PDFium reports page size with `/Rotate` applied and text
  and path coordinates without it. Everything downstream is in the *displayed*
  frame. Put every recovered rectangle through `bbox_to_displayed_frame(box,
  rotation, source_width, source_height)`. Getting this wrong is the exact bug
  fixed in `36e787c`.
- **IR version.** Currently `0.3.0`. Adding fields to the IR means bumping it and
  saying what changed. The cache key carries the IR version, so entries written
  against an older shape become unreachable rather than rejected — by design.
- **Philosophy.** Prove or mark, never invent. Ruled tables are provable
  geometry. Whitespace-aligned "tables" are inference — pdfplumber's `text`
  strategy returned 13 rows with blanks and merged two separate tables on the
  fixture. Do not emit inferred tables; record uncertainty as a warning instead.
- **Tests.** Build PDF fixtures inline in the test, byte by byte, as
  `engine/test_engine.py` already does for the rotated-page and link-annotation
  cases (`PageRotationTest.rotated_pdf`, `SourceDeclaredLinkTest.linked_pdf`).
  A ruled-table fixture draws text cells, then rules with
  `0.6 w 0 0 0 RG x y m x2 y2 l S`.
- **GUI tests must not open windows.** They set `QT_QPA_PLATFORM=offscreen` at
  import. Keep it that way, and never run them without asking.

## Verify before merging — both must exit 0

    cd philon    && npm run release:verify
    cd philon_p  && PHILON_DATA_DIR=$(mktemp -d) zsh scripts/verify-release.sh

Baselines: philon 84 workspace + 162 engine + 8 Rust tests, 3 policy gates;
philon_p 37 desktop + 141 engine/fuzz/bench, 3 policy gates, shell with 5
agreeing views. Zero `qt.qpa` font warnings — a regression there means a
`QApplication` was built without `theme.apply_application_font()`.

## Also note

- Philon is MIT and reuses no Marker code; keep it that way. The compatibility
  export is named `page_tree` (formerly `marker_json`) — do not reintroduce the
  old name.
- `~/AI/marker` holds local commits of fixes written *for* Marker (GPL, upstream
  is `datalab-to/marker`, no push access). Unrelated to Philon; leave it alone.
