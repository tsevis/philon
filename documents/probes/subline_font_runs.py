"""How much within-line font structure does a corpus actually carry?

Read-only; renders nothing and writes nothing. Supporting measurement for
documents/SUBLINE_FONT_RUNS_REFUSED.md. Point SRC at a folder of PDFs.
"""
import sys, ctypes, statistics, pathlib, collections
sys.path.insert(0, "/Users/tsevis/AI/ClaudeCode/philon/engine")
import philon_engine as E
import pypdfium2 as pdfium, pypdfium2.raw as raw

SRC = pathlib.Path("/Users/tsevis/AI/01 AI LAB/01MOZAIX LAB/03 ALGORITHMS/PHOTOMOSAICS")

def face(tp, i, buf, flags):
    n = raw.FPDFText_GetFontInfo(tp, i, buf, 160, ctypes.byref(flags))
    return buf.raw[:max(0, n - 1)].decode("utf-8", "replace")

for name in ["029-039", "267-271", "1056a"]:
    doc = pdfium.PdfDocument(str(SRC / f"{name}.pdf"))
    lines_total = lines_mixed = 0
    leading_bold = []
    body_counter = collections.Counter()
    buf, flags = ctypes.create_string_buffer(160), ctypes.c_int()
    for pno in range(len(doc)):
        page = doc[pno]; tp = page.get_textpage()
        text = tp.get_text_range(); n = raw.FPDFText_CountChars(tp)
        offset = 0
        for rawline in text.splitlines(keepends=True):
            line = rawline.rstrip("\r\n"); start, offset = offset, offset + len(rawline)
            idx = [i for i in range(start, min(n, start + len(line))) if not text[i].isspace()]
            if not line.strip() or not idx:
                continue
            faces = [face(tp, i, buf, flags) for i in idx]
            body_counter.update(faces)
            lines_total += 1
            if len(set(faces)) > 1:
                lines_mixed += 1
                # a run-in heading: the line OPENS in one face and switches once
                first = faces[0]
                switch = next((k for k, f in enumerate(faces) if f != first), None)
                if switch and switch >= 3 and faces[switch:].count(faces[switch]) > len(faces) * 0.4:
                    leading_bold.append((line[:64], first, faces[switch], switch))
        tp.close(); page.close()
    doc.close()
    body = body_counter.most_common(1)[0][0]
    runins = [r for r in leading_bold if E.is_bold_face(r[1]) and not E.is_bold_face(r[2])]
    print(f"--- {name}: {lines_total} lines, {lines_mixed} with a within-line face change ({lines_mixed/lines_total:.0%})")
    print(f"    body face {body};  lines opening bold then switching to a lighter face: {len(runins)}")
    for line, a, b, k in runins[:5]:
        print(f"      {line!r}")
        print(f"         opens {a} for {k} chars, then {b}")
