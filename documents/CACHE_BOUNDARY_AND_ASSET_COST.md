# The cache is drawn around the cheapest phase

Measured 2026-08-21, from the first multi-document benchmark run. Two
observations came out of that run and both have the same cause, so they are
recorded together.

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

## What this does not say

No fix is proposed here and none was attempted. Caching the rasterised
previews and the extracted assets against the same content hash is the obvious
direction, but it changes what the cache is responsible for and how much disk
it holds, and that is a design decision rather than a tuning one. The
measurement is recorded so it is made deliberately.

Two smaller things noticed in passing, neither investigated: asset extraction
emits `Fax4Decode: Bad code word` on a CCITT image in `029-039`, and
`render_source_previews` runs whenever `machine`, `html` or `assets` is
requested, which is most of the time.

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
