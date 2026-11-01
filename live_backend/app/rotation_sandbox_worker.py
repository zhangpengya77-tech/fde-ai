"""獨立子程序：只執行一張 PROP_ROTATION_V5 圖片推論並輸出 JSON。"""

from __future__ import annotations

import argparse
import json
import socket
from pathlib import Path


def _deny_network(*_args, **_kwargs):
    raise RuntimeError("network_disabled_in_rotation_sandbox")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    # 先完成 Python／torch 的 SSL 依賴載入：ssl 會以 socket.socket 建立子類別，
    # 過早替換它會讓 worker 在載入模型前即 TypeError。依賴載入後才封鎖一般
    # socket 開啟；OS 層隔離仍由部署 sandbox 負責。
    import cv2
    import numpy as np
    from ultralytics import YOLO
    socket.socket = _deny_network

    image = cv2.imdecode(np.frombuffer(Path(args.image).read_bytes(), dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        return 2
    model = YOLO(args.model, task="detect")
    names_value = getattr(model, "names", {})
    names = [str(names_value[key]) for key in sorted(names_value)] if isinstance(names_value, dict) else list(names_value)
    if names != ["CW", "CCW"]:
        return 3
    result = model.predict(source=image, conf=0.001, verbose=False)[0]
    detections = []
    for box in result.boxes:
        class_id = int(box.cls[0])
        x1, y1, x2, y2 = [float(value) for value in box.xyxy[0].tolist()]
        detections.append({
            "class": names[class_id], "confidence": float(box.conf[0]),
            "bbox": [x1, y1, x2, y2],
        })
    Path(args.output).write_text(json.dumps({
        "class_names": names, "detections": detections,
        "image_width": int(image.shape[1]), "image_height": int(image.shape[0]),
    }), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
