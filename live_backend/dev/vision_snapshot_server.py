from __future__ import annotations

import argparse
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path


def sanitize_detector_result(result: dict) -> dict:
    detections = result.get("detections")
    if not isinstance(detections, list):
        raise ValueError("Existing detector returned invalid detections.")
    return {"detections": detections}


def load_existing_detector(source_root: Path, model_path: str | None):
    source_root = source_root.resolve()
    if not (source_root / "yolo_server.py").exists():
        raise FileNotFoundError(f"Existing YOLO source not found: {source_root}")
    sys.path.insert(0, str(source_root))
    import yolo_server  # type: ignore

    yolo_server.load_env_file()
    selected_model = model_path or os.environ.get("FDE_AI_YOLO_MODEL") or yolo_server.DEFAULT_MODEL

    class SnapshotDetector(yolo_server.Detector):
        @staticmethod
        def _encode_plot(_result) -> str:
            # Phase 1A returns boxes only, so skip expensive annotated-image rendering.
            return ""

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
                self._send(200, {"ok": True, "service": "phase1a_snapshot_vision"})
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
                result = detector.predict(
                    image_data,
                    str(payload.get("fileName") or "live-snapshot.jpg"),
                    float(payload.get("conf", 0.25)),
                )
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
    server = HTTPServer((args.host, args.port), make_handler(detector))
    print(
        json.dumps(
            {"status": "online", "service": "phase1a_snapshot_vision", "host": args.host, "port": args.port},
            ensure_ascii=False,
        ),
        flush=True,
    )
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
