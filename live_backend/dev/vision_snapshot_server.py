from __future__ import annotations

import argparse
import json
import math
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


TIMING_KEYS = (
    "server_decode_ms",
    "queue_wait_ms",
    "model_preprocess_ms",
    "model_inference_ms",
    "postprocess_ms",
)


def _clean_timings(value: object) -> dict[str, float]:
    if not isinstance(value, dict):
        raise ValueError("Existing detector returned invalid timings.")
    cleaned = {}
    for key in TIMING_KEYS:
        number = value.get(key, 0.0)
        if not isinstance(number, (int, float)) or not math.isfinite(number) or number < 0:
            raise ValueError("Existing detector returned invalid timings.")
        cleaned[key] = round(float(number), 1)
    return cleaned


def sanitize_detector_result(result: dict) -> dict:
    detections = result.get("detections")
    if not isinstance(detections, list):
        raise ValueError("Existing detector returned invalid detections.")
    sanitized = {"detections": detections}
    if "timings" in result:
        sanitized["timings"] = _clean_timings(result["timings"])
    return sanitized


def load_existing_detector(source_root: Path, model_path: str | None):
    source_root = source_root.resolve()
    if not (source_root / "yolo_server.py").exists():
        raise FileNotFoundError(f"Existing YOLO source not found: {source_root}")
    sys.path.insert(0, str(source_root))
    import yolo_server  # type: ignore

    yolo_server.load_env_file()
    selected_model = model_path or os.environ.get("FDE_AI_YOLO_MODEL") or yolo_server.DEFAULT_MODEL

    class SnapshotDetector(yolo_server.Detector):
        def __init__(self, selected_model_path: str):
            super().__init__(selected_model_path)
            self._inference_lock = threading.Lock()

        @property
        def model_names(self) -> dict:
            names = self.model.names
            if isinstance(names, list):
                return {index: name for index, name in enumerate(names)}
            return dict(names)

        def predict(self, image_data: str, file_name: str, conf: float) -> dict:
            decode_started = time.perf_counter()
            image = self._decode_image(image_data)
            decode_ms = (time.perf_counter() - decode_started) * 1000

            queue_started = time.perf_counter()
            with self._inference_lock:
                queue_wait_ms = (time.perf_counter() - queue_started) * 1000
                result = self.model.predict(source=image, conf=conf, verbose=False)[0]

            extraction_started = time.perf_counter()
            detections = []
            for box in result.boxes:
                class_id = int(box.cls[0])
                x1, y1, x2, y2 = [float(value) for value in box.xyxy[0]]
                detections.append(
                    {
                        "className": result.names[class_id],
                        "confidence": round(float(box.conf[0]), 3),
                        "box": [round(x1), round(y1), round(x2), round(y2)],
                    }
                )
            extraction_ms = (time.perf_counter() - extraction_started) * 1000
            speed = result.speed or {}
            return {
                "detections": detections,
                "timings": {
                    "server_decode_ms": decode_ms,
                    "queue_wait_ms": queue_wait_ms,
                    "model_preprocess_ms": float(speed.get("preprocess", 0.0)),
                    "model_inference_ms": float(speed.get("inference", 0.0)),
                    "postprocess_ms": float(speed.get("postprocess", 0.0)) + extraction_ms,
                },
            }

    return SnapshotDetector(selected_model)


def make_handler(detector):
    class SnapshotHandler(BaseHTTPRequestHandler):
        max_body_size = 12 * 1024 * 1024

        def _send(self, status: int, payload: dict):
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/api/health":
                self._send(200, {"ok": True, "service": "phase1a_snapshot_vision", "model_names": detector.model_names})
                return
            self._send(404, {"ok": False, "error": "not_found"})

        def do_POST(self):
            if self.path != "/api/detect":
                self._send(404, {"ok": False, "error": "not_found"})
                return
            try:
                content_length = int(self.headers.get("Content-Length", "0"))
                if content_length <= 0 or content_length > self.max_body_size:
                    raise ValueError("invalid_request_size")
                payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
                image_data = payload.get("imageData")
                if not isinstance(image_data, str) or not image_data.startswith("data:image/"):
                    raise ValueError("invalid_image")
                result = detector.predict(image_data, str(payload.get("fileName") or "live-snapshot.jpg"), float(payload.get("conf", 0.25)))
                self._send(200, {"ok": True, "result": sanitize_detector_result(result)})
            except (ValueError, TypeError, json.JSONDecodeError):
                self._send(400, {"ok": False, "error": "invalid_snapshot"})
            except Exception:
                self._send(500, {"ok": False, "error": "vision_inference_failed"})

        def log_message(self, _format, *_args):
            return

    return SnapshotHandler


def main() -> int:
    parser = argparse.ArgumentParser(description="FDE-AI Phase 1A snapshot-only YOLO adapter")
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--model", default=None)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    detector = load_existing_detector(Path(args.source_root), args.model)
    server = ThreadingHTTPServer((args.host, args.port), make_handler(detector))
    print(json.dumps({"status": "online", "service": "phase1a_snapshot_vision", "host": args.host, "port": args.port}, ensure_ascii=False), flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

