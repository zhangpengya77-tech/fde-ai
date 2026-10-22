import fitz, os
base = os.path.dirname(os.path.abspath(__file__))
doc = fitz.open(os.path.join(base, "AC107-005D-2026-02-03.pdf"))
def clip(pg, rect_pts, name, zoom=10):
    page = doc[pg-1]
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=fitz.Rect(*rect_pts))
    out = os.path.join(base, name)
    pix.save(out)
    print("saved", out, pix.width, "x", pix.height)
# 圖11 (未達25公斤) is the BOTTOM diagram on page 233. Its detail boxes sit just above the 圖11 caption (~y700).
clip(233, (330, 585, 595, 700), "h11_right.png", 10)   # bottom-right detail box
clip(233, (40, 585, 340, 700), "h11_left.png", 10)     # bottom-left detail box
