"""把 ACTIVE 槳葉模型（best.pt）轉成瀏覽器即時檢測用的 best.onnx，並寫出 best.onnx.json（2026-11-08）。

用法（請用另外建立、裝有 onnx 套件的獨立 Python 環境執行，不要裝進正式站 Python）：
  python export_prop_live_onnx.py --model-dir <ACTIVE 模型目錄> --expected-sha256 <ACTIVE 模型 file_hash>

只在 best.pt 的 SHA-256 等於 --expected-sha256、且模型類別恰好是 CW、CCW 時才輸出。
輸出 best.onnx（動態輸入尺寸）與 best.onnx.json（來源雜湊、ONNX 雜湊、類別、尺寸），
後端 /api/v1/vision/prop-live/model 會逐項核對這兩個檔案後才提供給瀏覽器。
目標目錄已有 best.onnx 時拒絕覆蓋（要更新請先人工移除）。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path

EXPECTED_CLASSES = ["CW", "CCW"]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--imgsz", type=int, default=640)
    args = parser.parse_args()

    folder = Path(args.model_dir)
    pt = folder / "best.pt"
    if (folder / "best.onnx").exists() or (folder / "best.onnx.json").exists():
        print("拒絕：目錄已有 best.onnx／best.onnx.json，請人工確認後再處理。")
        return 2
    source_sha = sha256(pt)
    if source_sha != args.expected_sha256.lower():
        print("拒絕：best.pt 的 SHA-256 與 ACTIVE 模型不符。")
        return 2

    from ultralytics import YOLO

    with tempfile.TemporaryDirectory() as work:
        local_pt = Path(work) / "best.pt"
        shutil.copy2(pt, local_pt)
        model = YOLO(str(local_pt))
        names = [model.names[i] for i in sorted(model.names)]
        if names != EXPECTED_CLASSES:
            print(f"拒絕：模型類別 {names} 不是 {EXPECTED_CLASSES}。")
            return 2
        exported = Path(model.export(format="onnx", imgsz=args.imgsz, dynamic=True, simplify=True, opset=17))
        onnx_sha = sha256(exported)
        sidecar = {
            "source_sha256": source_sha,
            "onnx_sha256": onnx_sha,
            "class_names": names,
            "imgsz": args.imgsz,
            "dynamic": True,
            "opset": 17,
            "exported_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        }
        shutil.copy2(exported, folder / "best.onnx")
        (folder / "best.onnx.json").write_text(json.dumps(sidecar, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(sidecar, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
