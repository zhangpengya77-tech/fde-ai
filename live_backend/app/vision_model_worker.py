"""獨立子程序：載入一個 .pt 執行驗證、推論或健康度檢查，只輸出 JSON。"""

from __future__ import annotations

import argparse
import json
import socket
import sys
from pathlib import Path


def _deny_network(*_args, **_kwargs):
    raise RuntimeError("network_disabled_in_vision_worker")


def _names(model) -> list[str]:
    value = getattr(model, "names", {})
    return [str(value[key]) for key in sorted(value)] if isinstance(value, dict) else [str(item) for item in value]


def _validate(model_path: str) -> dict:
    import numpy as np
    from ultralytics import YOLO

    socket.socket = _deny_network
    model = YOLO(model_path, task="detect")
    prediction = model.predict(source=np.zeros((64, 64, 3), dtype=np.uint8), verbose=False)
    first = prediction[0] if prediction else None
    return {
        "class_names": _names(model), "task": str(getattr(model, "task", "")),
        "has_result": first is not None,
        "result_format": first is not None and getattr(first, "boxes", None) is not None and getattr(first, "names", None) is not None,
    }


def _predict(model_path: str, image_path: str, confidence: float) -> dict:
    import cv2
    import numpy as np
    from ultralytics import YOLO

    socket.socket = _deny_network
    image = cv2.imdecode(np.frombuffer(Path(image_path).read_bytes(), dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("invalid_image")
    prediction = YOLO(model_path, task="detect").predict(source=image, conf=confidence, verbose=False)[0]
    names = prediction.names
    detections = []
    for box in prediction.boxes:
        x1, y1, x2, y2 = [float(value) for value in box.xyxy[0].tolist()]
        detections.append({"class": str(names[int(box.cls[0])]), "confidence": float(box.conf[0]), "bbox": [x1, y1, x2, y2]})
    return {"detections": detections}


def _health(model_path: str) -> dict:
    # -I 不含腳本目錄；model_health 只依賴標準庫與 torch，可單獨匯入。
    sys.path.insert(0, str(Path(__file__).parent))
    import model_health
    import torch  # noqa: F401 - 先完成依賴載入，再封鎖 socket

    socket.socket = _deny_network
    return model_health.inspect_model_health(model_path, use_cache=False)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", required=True, choices=("validate", "predict", "names", "health"))
    parser.add_argument("--model", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--image")
    parser.add_argument("--confidence", type=float, default=0.25)
    args = parser.parse_args()

    if args.mode == "predict":
        payload = _predict(args.model, args.image, args.confidence)
    elif args.mode == "health":
        payload = _health(args.model)
    else:
        payload = _validate(args.model)
    Path(args.output).write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
