# Sub-line font runs: measured and refused

**Status: not built.** The measurement is below so the question is not reopened
on a hunch. Re-run `documents/probes/subline_font_runs.py` against any corpus
before overturning it.

## What was proposed

Split a measured line into *runs* wherever the face changes, instead of taking
one dominant face per line. The motivating case was a heading set on the same
line as the text it heads — `CCS Concepts • Computing methodologies → …`.

## Why it was refused

### 1. The motivating case does not exist

`CCS Concepts` is a line of its own, and so is `Abstract`. Both are already
found, by width: a heading occupies a fraction of the measure while body text
fills it. Philon currently has **no** heading miss attributable to a within-line
face change on the three reference papers.

This was asserted in a session summary before it was checked, and was wrong.

### 2. Per-character font attribution is too noisy to run on

A typographic run boundary essentially never falls inside a word. Measured
across the three papers:

| paper | glyphs | empty font name | face changes | **mid-word** |
|---|---|---|---|---|
| 029-039 | 25,633 | 0 | 107 | 37 (34.6%) |
| 267-271 | 15,071 | 0 | 31 | 9 (29.0%) |
| 1056a | 42,695 | 684 (1.6%) | 856 | **686 (80.1%)** |

Four in five face changes on one paper cut a word in half. They are subset-font
fallbacks — a glyph absent from one subset served from another — not structure.
A run splitter fed this signal produces mostly spurious blocks:

```
'Pixel mask'       face=LinLibertineT
'in'               face=              <- empty
'g. We define a '  face=LinLibertineTI   <- reported italic
'mask Ωi by remov' face=LinLibertineT
```

This also explains why the shipped design works: `line_typeface` samples up to
`FACE_SAMPLE` characters and takes the **most common** face, which averages the
noise out. Going finer-grained exposes it.

### 3. Word-aligned runs remove the noise and find nothing new

Requiring a whole word to agree on a face fixes the mid-word artefacts. Across
all three papers it finds 26 lines that open bold and switch to a lighter face:

- **029-039 (12) and 267-271 (6):** every one is a figure or table caption label
  — `Figure 1:`, `Table 1:` — which `opens_a_float_caption` already handles.
- **1056a (8):** all spurious, e.g. `Our method builds upon a frozen |
  text-to-image diffusion model`, which is not a run-in heading.

### 4. The one thing it might have bought is invisible to PDFium anyway

`1056a` carries genuine run-in headings that Marker marks — `**Pixel masking.**`,
`**Adaptive quantile-weighted MSE loss.**`. PDFium reports them in
`LinLibertineT`, the **plain body face**. Whatever makes them read as bold is not
in the font name PDFium exposes, so no font-name rule reaches them, sub-line or
otherwise. `FPDFText_GetTextRenderMode` is absent from the pinned pypdfium2, so
a synthetic-bold hypothesis was not testable here; it is the only lead left and
it is not a sub-line question.

## What would change the answer

A corpus where run-in headings are set in a face PDFium names as bold, **and**
where word-aligned runs find them. Both halves matter: the second is what this
measurement failed, and the first is what makes the feature possible at all.
