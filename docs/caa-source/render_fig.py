import fitz, os
base = os.path.dirname(os.path.abspath(__file__))
doc = fitz.open(os.path.join(base, "AC107-005D-2026-02-03.pdf"))
# PDF internal page indices are 1-based in the text markers; fitz uses 0-based.
# Multirotor basic-level figures: 定點起降及四面停懸 (PAGE 162), 8字水平圓 (PAGE 163),
# also helicopter 定點起降 (PAGE 90) and 8字 (PAGE 92) for cross-check.
for pg in [162, 163, 90, 92]:
    page = doc[pg-1]
    pix = page.get_pixmap(matrix=fitz.Matrix(3, 3))
    out = os.path.join(base, f"fig_p{pg}.png")
    pix.save(out)
    print("saved", out, pix.width, "x", pix.height)
