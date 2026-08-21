# The cache was drawn around the cheapest phase

Measured 2026-08-21, from the first multi-document benchmark run. Two
observations came out of that run and both had the same cause, so they are
recorded together. The cause is now fixed; the measurement is kept because it
is what the fix was aimed at, and because proving the fix surfaced a second
defect that is still open.

## What the run showed

Three papers, `Verified` profile, all gates passing and source-map coverage
1.000 on each:

| id | pages | blocks | cold ms | warm ms | pages/s | warnings | uncertainty |
|---|---|---|---|---|---|---|---|
| 029-039 | 11 | 112 | 4,430 | 3,515 | 2.48 | 21 | 0.1875 |
| 267-271 | 5 | 61 | 2,542 | 2,432 | 1.97 | 11 | 0.1803 |
| 1056a | 10 | 171 | 19,248 | 19,106 | **0.52** | 11 | 0.0643 |

Two things looked wrong: `1056a` is 4.8x slower per page than `029-039`, and a
warm cache reporting `warm_cache_hit: true` saved **0.7%** on it.

## The cause, measured

`convert_file` consults the cache around `make_ir` and nothing else. Every
phase after that check — page rasterisation, asset extraction, overlay
diagnostics, all exports — runs again on every conversion. Phase timings:

| phase | 029-039 cold | 1056a cold |
|---|---|---|
| `make_ir` **(the only cached phase)** | 873 ms (17.7%) | **266 ms (1.1%)** |
| `render_source_previews` | 2,518 ms (51.1%) | 3,176 ms (13.1%) |
| `extract_native_pdf_assets` | 1,370 ms (27.8%) | **20,620 ms (84.8%)** |
| `render_source_overlay_diagnostics` | 2 ms | 2 ms |
| `write_outputs` | 63 ms (1.3%) | 118 ms (0.5%) |

Both observations follow directly.

**The warm cache is not broken; it is bounded.** The most it can ever save is
the `make_ir` share — 17.7% on `029-039`, **1.1%** on `1056a`. The benchmark
measured 21% and 0.7%. The cache hit is real and it is nearly worthless on the
document that needs it most, because the work it skips is the cheap work.

**`1056a` is not slow at text extraction.** Its `make_ir` is the *fastest* of
the three at 266 ms. It is slow at `extract_native_pdf_assets`, which takes
20.6 seconds to pull 107 embedded images out of a 58 MB file. The per-page
figure in the benchmark is measuring image extraction, not conversion.

The cost is also inverted from what the numbers suggest: the paper with the
most pages of text is the cheapest to convert, and the one with the most
embedded images is 4.8x dearer per page.

## Fixed

Both expensive phases now reuse their own output. Their destination is already
content-addressed (`slug-hash12-profile`), so a second conversion of the same
bytes was regenerating work sitting on disk beside it. Each phase writes a
manifest **atomically after it succeeds**, recording the source path and the
sha256 of every file it produced; reuse happens only when that manifest reads
back and every file still hashes to what it claims. An interrupted run leaves
no manifest and therefore cannot be mistaken for a finished one.

| id | cold before | cold after | warm before | warm after | warm saving |
|---|---|---|---|---|---|
| 029-039 | 4,430 | 3,896 | 3,515 | **106** | 20.7% → **97.3%** |
| 267-271 | 2,542 | 2,620 | 2,432 | **68** | 4.3% → **97.4%** |
| 1056a | 19,248 | 19,553 | 19,106 | **304** | 0.7% → **98.4%** |

`1056a` reconverts 63x faster. The cold column is unchanged: the bench's cold
figures are noisy (the same build measured 19,248, 19,484, 23,171 and 24,318 ms
on that document), so the added cost was measured directly instead — hashing
every artifact for the manifests totals **266 ms across 331 files, about 1%**.

Reuse is equivalent to recomputation, not merely close to it. A conversion that
reuses and one that recomputes from scratch produce byte-identical trees once
two things are set aside: absolute paths recorded in manifests, which differ
because the two arms used different roots, and timestamps.

`bypass` and `refresh` still recompute everything, so a caller can always
demand the work be done again. A truncated asset extraction replays its
`ASSET_EXTRACTION_LIMIT` warning from the manifest, because reusing the files
without it would quietly turn a bounded export into a complete-looking one.

## Open: one asset does not extract reproducibly

Proving the above surfaced a separate defect, present with or without caching.
`029-039` carries a CCITT fax TIFF that emits `Fax4Decode: Bad code word`, and
**three fresh extractions produce three different sha256 values** for it:

    asset-0014: 1d542a40c2a9, 6332b9a8be8c, 2e3704ff02be

The control runs `extract_native_pdf_assets` directly with `reuse=False`, so no
caching is involved. A failed decode appears to leave part of the buffer
undefined and it is written out regardless.

This matters beyond tidiness: `bytes_sha256` is provenance. An asset whose hash
changes every run makes the output manifest unreproducible and that asset's
evidence meaningless, and the Markdown reference embeds the hash in its
filename, so the export differs run to run. Caching now hides it — reuse keeps
whichever copy was written first — which makes recording it here more important
rather than less.

Not fixed: it needs the decode failure to be detected rather than inferred from
a message on stderr, and that is a different piece of work.

Also still unexamined: `render_source_previews` runs whenever `machine`, `html`
or `assets` is requested, which is most of the time, and was 51% of the cold
cost on `029-039`.

## Reproducing it

There is no gold corpus, so `word_accuracy` is `null` on every document and no
accuracy claim is made or implied — see `docs/PARITY.md`. The timings above
need only the harness:

```sh
.venv/bin/python bench/run.py /path/to/private-manifest.json \
    --output bench/results/run.json --profile Verified
```

Phase timings were taken by wrapping `make_ir`, `render_source_previews`,
`extract_native_pdf_assets`, `render_source_overlay_diagnostics` and
`write_outputs` and converting each document twice into one temporary root, so
the second pass is a cache hit.
