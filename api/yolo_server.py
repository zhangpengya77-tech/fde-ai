from __future__ import annotations

import argparse
import base64
import json
import os
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path

from PIL import Image
from ultralytics import YOLO


DEFAULT_MODEL = (
    r"E:\FDE_AI_F450_Dataset 無人機影像資料集專案"
    r"\05_Model_Training 訓練結果\fde_f450_parts_v1\weights\best.pt"
)

CLASS_ZH = {
    "flight_controller": "飛控",
    "motor": "馬達",
    "esc": "電調",
    "gps_compass": "GPS/指南針",
    "receiver": "接收機",
    "battery": "電池",
    "frame_arm": "機臂",
    "power_module": "電源模組",
}


class Detector:
    def __init__(self, model_path: str):
        self.model_path = Path(model_path)
        if not self.model_path.exists():
            raise FileNotFoundError(f"找不到模型檔：{self.model_path}")
        self.model = YOLO(str(self.model_path))

    def predict(self, image_data: str, file_name: str, conf: float) -> dict:
        image = self._decode_image(image_data)
        result = self.model.predict(source=image, conf=conf, verbose=False)[0]
        detections = []

        for box in result.boxes:
            class_id = int(box.cls[0])
            class_name = result.names[class_id]
            x1, y1, x2, y2 = [float(value) for value in box.xyxy[0]]
            detections.append(
                {
                    "className": class_name,
                    "label": CLASS_ZH.get(class_name, class_name),
                    "confidence": round(float(box.conf[0]), 3),
                    "box": [round(x1), round(y1), round(x2), round(y2)],
                }
            )

        counts = Counter(item["className"] for item in detections)
        status, score, checklist, summary = self._summarize(file_name, detections, counts)

        return {
            "engine": "YOLOv8 local",
            "modelPath": str(self.model_path),
            "fileName": file_name,
            "status": status,
            "score": score,
            "summary": summary,
            "teacherStatus": "待教師複核",
            "detections": detections,
            "counts": dict(counts),
            "checklist": checklist,
            "annotatedImage": self._encode_plot(result),
        }

    @staticmethod
    def _decode_image(image_data: str) -> Image.Image:
        if "," in image_data:
            image_data = image_data.split(",", 1)[1]
        return Image.open(BytesIO(base64.b64decode(image_data))).convert("RGB")

    @staticmethod
    def _encode_plot(result) -> str:
        plotted_bgr = result.plot()
        plotted_rgb = plotted_bgr[:, :, ::-1]
        buffer = BytesIO()
        Image.fromarray(plotted_rgb).save(buffer, format="JPEG", quality=88)
        return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")

    @staticmethod
    def _summarize(file_name: str, detections: list[dict], counts: Counter) -> tuple[str, int, list[dict], str]:
        if not detections:
            return (
                "FAIL",
                0,
                [{"label": "目標檢測", "result": "FAIL", "detail": "沒有偵測到已訓練零件"}],
                f"{file_name} 沒有偵測到 F450 零件，請換一張更清楚的俯視照片。",
            )

        avg_conf = sum(item["confidence"] for item in detections) / len(detections)
        required_pass = counts.get("motor", 0) >= 4 and counts.get("frame_arm", 0) >= 4
        score = round(min(100, 45 + avg_conf * 35 + (20 if required_pass else 8)))
        status = "PASS" if required_pass and score >= 75 else "WARNING"
        checklist = [
            {"label": "馬達", "result": "PASS" if counts.get("motor", 0) >= 4 else "WARNING", "detail": f"偵測到 {counts.get('motor', 0)} 個"},
            {"label": "機臂", "result": "PASS" if counts.get("frame_arm", 0) >= 4 else "WARNING", "detail": f"偵測到 {counts.get('frame_arm', 0)} 個"},
            {"label": "飛控", "result": "PASS" if counts.get("flight_controller", 0) >= 1 else "WARNING", "detail": f"偵測到 {counts.get('flight_controller', 0)} 個"},
            {"label": "GPS/指南針", "result": "PASS" if counts.get("gps_compass", 0) >= 1 else "WARNING", "detail": f"偵測到 {counts.get('gps_compass', 0)} 個"},
        ]
        summary = (
            f"{file_name} 已完成本機 YOLOv8 檢測：偵測到 {len(detections)} 個目標。"
            "目前模型只訓練了現有標註中的零件，尚未包含 CW/CCW 槳葉方向。"
        )
        return status, score, checklist, summary


def make_handler(detector: Detector):
    class YoloHandler(BaseHTTPRequestHandler):
        max_body_size = 18 * 1024 * 1024

        def _send_json(self, status: int, payload: dict):
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_OPTIONS(self):
            self._send_json(200, {"ok": True})

        def do_GET(self):
            if self.path == "/api/health":
                self._send_json(200, {"ok": True, "modelPath": str(detector.model_path)})
            else:
                self._send_json(404, {"ok": False, "error": "unknown endpoint"})

        def do_POST(self):
            if self.path != "/api/detect":
                self._send_json(404, {"ok": False, "error": "unknown endpoint"})
                return

            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > self.max_body_size:
                    raise ValueError("圖片太大或內容為空")
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                if not payload.get("imageData"):
                    raise ValueError("缺少 imageData")
                result = detector.predict(payload["imageData"], payload.get("fileName", "uploaded-f450.jpg"), float(payload.get("conf", 0.25)))
                self._send_json(200, {"ok": True, "result": result})
            except Exception as exc:
                self._send_json(500, {"ok": False, "error": str(exc)})

        def log_message(self, format, *args):
            return

    return YoloHandler


def main():
    parser = argparse.ArgumentParser(description="FDE-AI local YOLOv8 detection server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--model", default=os.environ.get("FDE_AI_YOLO_MODEL", DEFAULT_MODEL))
    args = parser.parse_args()

    detector = Detector(args.model)
    server = ThreadingHTTPServer((args.host, args.port), make_handler(detector))
    print(f"FDE-AI YOLO server running at http://{args.host}:{args.port}")
    print(f"Model: {detector.model_path}")
    server.serve_forever()


if __name__ == "__main__":
    main()
