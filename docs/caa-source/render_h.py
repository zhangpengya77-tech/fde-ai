import fitz, os
base = os.path.dirname(os.path.abspath(__file__))
doc = fitz.open(os.path.join(base, "AC107-005D-2026-02-03.pdf"))

def clip(pg, rect_pts, name, zoom=8):
    page = doc[pg-1]
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=fitz.Rect(*rect_pts))
    out = os.path.join(base, name)
    pix.save(out)
    print("saved", out, pix.width, "x", pix.height)

# Page 233 = 圖11 未達25公斤 field. H detail box is bottom-right of the figure.
# Full page ~595x842pt. Try several candidate crops for the 起降點 H detail.
clip(233, (330, 640, 595, 842), "h_detail_p233_a.png", 8)   # bottom-right region
clip(233, (180, 620, 420, 800), "h_detail_p233_b.png", 8)   # bottom-center region
# Page 162 = 圖8 定點起降 (multirotor basic) — the field/H area is lower portion.
clip(162, (60, 600, 560, 842), "field_p162.png", 6)
# Page 163 = 圖9 8字水平圓 — full figure lower portion.
clip(163, (40, 640, 560, 842), "fig8_p163.png", 6)
