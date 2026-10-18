#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Seed two small, valid demo download files into demo/runtime/downloads.

This is DEMO-ENV-ONLY data setup (mirrors seed_demo.py for the DB). It does NOT
touch the production download root (D:\\FDE-Downloads) and does NOT modify any
code. The files are real, byte-valid, and downloadable so the client demo's
Download Center shows a working (non-error) list.
"""
import io
import os
import zipfile

ROOT = r"D:\FDE-AI-UAS-v2.0\demo\runtime\downloads"
os.makedirs(ROOT, exist_ok=True)


def build_minimal_pdf(title: str, lines) -> bytes:
    """Return bytes of a valid single-page PDF (ASCII content, latin-1 safe)."""
    content_cmds = ["BT", "/F1 18 Tf", "72 720 Td", f"({title}) Tj"]
    for ln in lines:
        content_cmds.append("0 -24 Td")
        content_cmds.append(f"({ln}) Tj")
    content_cmds.append("ET")
    stream = "\n".join(content_cmds)
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        f"<< /Length {len(stream.encode('latin-1'))} >>\nstream\n{stream}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(f"{i} 0 obj\n".encode("latin-1"))
        out.write(body.encode("latin-1"))
        out.write(b"\nendobj\n")
    xref_pos = out.tell()
    out.write(f"xref\n0 {len(objects) + 1}\n".encode("latin-1"))
    out.write(b"0000000000 65535 f \n")
    for off in offsets:
        out.write(f"{off:010d} 00000 n \n".encode("latin-1"))
    out.write(b"trailer\n")
    out.write(f"<< /Size {len(objects) + 1} /Root 1 0 R >>\n".encode("latin-1"))
    out.write(f"startxref\n{xref_pos}\n%%EOF\n".encode("latin-1"))
    return out.getvalue()


def main() -> None:
    # 1) ZIP with a README
    zip_path = os.path.join(ROOT, "FDE-AI-UAS-學員快速上手.zip")
    readme = (
        "FDE-AI-UAS 2.0 學員快速上手包（DEMO 演示資料，非真實發行檔）\n"
        "=================================================\n"
        "本壓縮包為展示用途，內含說明文件。\n"
        "正式課程軟體將由帶班教官於實體課堂統一發放。\n"
    )
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("README.txt", readme)
    print("wrote", zip_path, os.path.getsize(zip_path), "bytes")

    # 2) PDF 課程軟體說明（PDF 內文僅用 ASCII；下載中心顯示的是檔名/中繼資料，非 PDF 內容）
    pdf_path = os.path.join(ROOT, "FDE-AI-UAS-課程軟體說明.pdf")
    pdf = build_minimal_pdf(
        "FDE-AI-UAS 2.0 Course Software Notes (DEMO)",
        [
            "This is a DEMO document for presentation only.",
            "Recommended: Mission Planner / QGroundControl ground station",
            "3D mapping: WebODM",
            "Vision training: FDE-AI YOLO toolkit",
            "See the student Download Center for install steps.",
        ],
    )
    with open(pdf_path, "wb") as fh:
        fh.write(pdf)
    print("wrote", pdf_path, os.path.getsize(pdf_path), "bytes")


if __name__ == "__main__":
    main()
