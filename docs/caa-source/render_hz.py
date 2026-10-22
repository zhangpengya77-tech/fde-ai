import fitz, os
base = os.path.dirname(os.path.abspath(__file__))
doc = fitz.open(os.path.join(base, "AC107-005D-2026-02-03.pdf"))
for pg in [233, 163, 162]:
    page = doc[pg-1]
    pix = page.get_pixmap(matrix=fitz.Matrix(5, 5))
    out = os.path.join(base, f"fig5_p{pg}.png")
    pix.save(out)
    print("saved", out, pix.width, "x", pix.height)
