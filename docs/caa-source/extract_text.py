import fitz, os

base = os.path.dirname(os.path.abspath(__file__))
jobs = [
    ("yongwenjian", "caa-exam-用文件-2025-05-23.pdf"),
    ("AC107-005D", "AC107-005D-2026-02-03.pdf"),
]

for key, fname in jobs:
    path = os.path.join(base, fname)
    doc = fitz.open(path)
    parts = []
    total_text = 0
    for i, page in enumerate(doc):
        t = page.get_text()
        total_text += len(t)
        parts.append(f"\n===== PAGE {i+1} =====\n{t}")
    txt = "".join(parts)
    out_path = os.path.join(base, f"{key}.txt")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(txt)
    print(f"{key}: pages={doc.page_count} text_chars={total_text} -> {out_path}")
