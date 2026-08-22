from __future__ import annotations

import argparse
import base64
import json
import os
import tempfile
import urllib.error
import urllib.request
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path

from PIL import Image
from ultralytics import YOLO

from hover_model import analyze_video


DEFAULT_MODEL = (
    r"E:\FDE_AI_F450_Dataset 無人機影像資料集專案"
    r"\05_Model_Training 訓練結果\fde_f450_parts_v2_cw_ccw_full\weights\best.pt"
)
DEFAULT_HOVER_MODEL = r"E:\四面懸停\hover_model_v1\hover_model.json"
DEFAULT_VOICE_RAG_DIR = r"E:\FDE_AI_Voice_RAG\knowledge_base"
DEFAULT_VOICE_MODEL = "gpt-5-mini"
VOICE_SYSTEM_INSTRUCTION = (
    "你是 FDE-AI 的 F450 組裝語音助教。請使用台灣繁中回答，語氣清楚、簡短、適合學生。"
    "回答前必須優先依據提供的 RAG 知識庫內容；如果資料不足，要明確說需要老師確認。"
    "涉及槳葉、馬達、電池、通電、解鎖或實飛時，提醒學生先停機檢查並請老師確認。"
)

CLASS_ZH = {
    "cw_propeller": "CW 正槳",
    "ccw_propeller": "CCW 反槳",
    "flight_controller": "飛控",
    "motor": "馬達",
    "esc": "電調",
    "gps_compass": "GPS/指南針",
    "receiver": "接收機",
    "battery": "電池",
    "frame_arm": "機臂",
    "power_module": "電源模組",
}


def load_env_file():
    for env_path in (Path.cwd() / ".env", Path.cwd().parent / ".env"):
        if not env_path.exists():
            continue
        for line in env_path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"'))


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
            {"label": "CW 正槳", "result": "PASS" if counts.get("cw_propeller", 0) >= 2 else "WARNING", "detail": f"偵測到 {counts.get('cw_propeller', 0)} 個"},
            {"label": "CCW 反槳", "result": "PASS" if counts.get("ccw_propeller", 0) >= 2 else "WARNING", "detail": f"偵測到 {counts.get('ccw_propeller', 0)} 個"},
            {"label": "馬達", "result": "PASS" if counts.get("motor", 0) >= 4 else "WARNING", "detail": f"偵測到 {counts.get('motor', 0)} 個"},
            {"label": "機臂", "result": "PASS" if counts.get("frame_arm", 0) >= 4 else "WARNING", "detail": f"偵測到 {counts.get('frame_arm', 0)} 個"},
            {"label": "飛控", "result": "PASS" if counts.get("flight_controller", 0) >= 1 else "WARNING", "detail": f"偵測到 {counts.get('flight_controller', 0)} 個"},
            {"label": "GPS/指南針", "result": "PASS" if counts.get("gps_compass", 0) >= 1 else "WARNING", "detail": f"偵測到 {counts.get('gps_compass', 0)} 個"},
        ]
        summary = (
            f"{file_name} 已完成本機 YOLOv8 檢測：偵測到 {len(detections)} 個目標。"
            "目前模型已包含 CW/CCW 槳葉、馬達、機臂、飛控與 GPS/指南針等類別；"
            "方向是否安裝正確仍建議由老師依機身朝向複核。"
        )
        return status, score, checklist, summary


class HoverScorer:
    def __init__(self, model_path: str):
        self.model_path = Path(model_path)
        if not self.model_path.exists():
            raise FileNotFoundError(f"找不到四面懸停模型：{self.model_path}")
        self.model = json.loads(self.model_path.read_text(encoding="utf-8"))

    def score_video(self, video_data: str, file_name: str) -> dict:
        if "," in video_data:
            video_data = video_data.split(",", 1)[1]
        suffix = Path(file_name).suffix or ".mp4"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as file:
            temp_path = Path(file.name)
            file.write(base64.b64decode(video_data))

        try:
            metrics = analyze_video(temp_path)
        finally:
            temp_path.unlink(missing_ok=True)

        if metrics is None:
            raise ValueError("影片無法讀取，請確認是 MP4 / MOV 等常見影片格式")

        result = as_hover_result(metrics, file_name)
        result["modelPath"] = str(self.model_path)
        result["baseline"] = self.model.get("thresholds", {})
        return result


class VoiceAssistant:
    def __init__(self, rag_dir: str, model: str):
        self.rag_dir = Path(rag_dir)
        self.model = model
        self.locale = os.environ.get("FDE_VOICE_LOCALE", "zh-TW")

    def health(self) -> dict:
        return {
            "ok": True,
            "locale": self.locale,
            "ragFirst": True,
            "ragDir": str(self.rag_dir),
            "ragDirExists": self.rag_dir.exists(),
            "model": self.model,
            "hasApiKey": bool(os.environ.get("OPENAI_API_KEY")),
        }

    def ask(self, question: str) -> dict:
        topic = question.strip()
        if not topic:
            raise ValueError("缺少問題內容")

        sources = search_voice_knowledge_base(topic, self.rag_dir)
        context = "\n\n".join(f"[{source['title']}]\n{source['content']}" for source in sources)
        api_key = os.environ.get("OPENAI_API_KEY")

        if api_key:
            answer = self._ask_openai(api_key, topic, context)
            source_status = "local-rag" if sources else "large-model-fallback"
            voice_status = "已用台灣繁中產生回答；前端會使用瀏覽器語音唸出。"
        elif sources:
            answer = (
                f"我先查到本機 RAG 知識庫：{sources[0]['title']}。"
                f"{sources[0]['content']} "
                "這是 AI 初步整理，涉及通電、槳葉或實飛前仍請老師確認。"
            )
            source_status = "local-rag"
            voice_status = "尚未設定 OPENAI_API_KEY；已先用 RAG 內容回答。"
        else:
            answer = (
                "目前沒有在 E 盤 RAG 知識庫找到足夠資料，且尚未設定 OPENAI_API_KEY。"
                "請先把教材文字放進 knowledge_base，或設定 API Key 後再詢問。"
            )
            source_status = "needs-config"
            voice_status = "尚未連接大模型。"

        return {
            "mode": "voice-rag-openai",
            "sourceStatus": source_status,
            "topic": topic,
            "answer": answer,
            "sources": [
                {"title": source["title"], "sourcePath": source["sourcePath"], "score": source["score"]}
                for source in sources
            ],
            "voiceStatus": voice_status,
        }

    def _ask_openai(self, api_key: str, question: str, context: str) -> str:
        if context:
            user_input = f"RAG 知識庫內容：\n{context}\n\n學生問題：{question}"
        else:
            user_input = f"RAG 知識庫沒有命中。學生問題：{question}"

        payload = {
            "model": self.model,
            "input": [
                {"role": "system", "content": VOICE_SYSTEM_INSTRUCTION},
                {"role": "user", "content": user_input},
            ],
        }
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            "https://api.openai.com/v1/responses",
            data=data,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=40) as response:
                result = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"OpenAI API 回應錯誤：{exc.code} {detail}") from exc

        output_text = result.get("output_text")
        if output_text:
            return output_text

        fragments = []
        for item in result.get("output", []):
            for content in item.get("content", []):
                if content.get("type") in {"output_text", "text"} and content.get("text"):
                    fragments.append(content["text"])
        return "\n".join(fragments).strip() or "大模型已回應，但沒有取得可顯示文字。"


def tokenize_text(value: str) -> list[str]:
    normalized = value.lower()
    for symbol in [",", "，", "。", "？", "?", "：", ":", "、", "/", "\\", "\n", "\r", "\t"]:
        normalized = normalized.replace(symbol, " ")
    return [term for term in normalized.split(" ") if len(term.strip()) >= 2]


def search_voice_knowledge_base(question: str, rag_dir: Path, limit: int = 3) -> list[dict]:
    if not rag_dir.exists():
        return []

    terms = tokenize_text(question)
    results = []
    for path in rag_dir.rglob("*"):
        if path.suffix.lower() not in {".txt", ".md"} or not path.is_file():
            continue
        try:
            content = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        haystack = f"{path.stem} {content}".lower()
        score = sum(2 if term in path.stem.lower() else 1 for term in terms if term in haystack)
        if score <= 0:
            continue
        snippet = content.strip().replace("\r", "\n")
        results.append(
            {
                "title": path.stem,
                "sourcePath": str(path),
                "score": score,
                "content": snippet[:1200],
            }
        )

    return sorted(results, key=lambda item: item["score"], reverse=True)[:limit]


def as_hover_result(metrics, file_name: str | None = None) -> dict:
    display_name = file_name or metrics.video
    stable_seconds = round(metrics.duration_sec * metrics.stable_ratio, 1)
    return {
        "engine": "Hover baseline local",
        "fileName": display_name,
        "status": metrics.status,
        "score": metrics.score,
        "summary": (
            f"{display_name} 已完成四面懸停基準檢測。"
            f"追蹤率 {metrics.tracking_rate:.0%}，穩定時間約 {stable_seconds} 秒；"
            "此為 AI 初評，最終仍需老師複核。"
        ),
        "teacherReview": "AI 初評完成，請老師依考場標準複核。",
        "metrics": [
            {"label": "漂移距離", "value": f"{metrics.drift_px:.1f} px"},
            {"label": "越界比例", "value": f"{metrics.out_of_zone_ratio:.0%}"},
            {"label": "穩定時間", "value": f"{stable_seconds} s"},
            {"label": "方向完成度", "value": f"{metrics.direction_completion}/4"},
            {"label": "姿態晃動", "value": f"{metrics.jitter_px:.1f} px"},
        ],
        "raw": {
            "durationSec": metrics.duration_sec,
            "sampledFrames": metrics.sampled_frames,
            "trackedFrames": metrics.tracked_frames,
            "trackingRate": metrics.tracking_rate,
            "driftPx": metrics.drift_px,
            "jitterPx": metrics.jitter_px,
            "outOfZoneRatio": metrics.out_of_zone_ratio,
        },
    }


def make_handler(detector: Detector, hover_scorer: HoverScorer, voice_assistant: VoiceAssistant):
    class YoloHandler(BaseHTTPRequestHandler):
        max_image_body_size = 18 * 1024 * 1024
        max_video_body_size = 260 * 1024 * 1024

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
                self._send_json(
                    200,
                    {
                        "ok": True,
                        "modelPath": str(detector.model_path),
                        "hoverModelPath": str(hover_scorer.model_path),
                        "voice": voice_assistant.health(),
                    },
                )
            elif self.path == "/api/voice/health":
                self._send_json(200, voice_assistant.health())
            else:
                self._send_json(404, {"ok": False, "error": "unknown endpoint"})

        def do_POST(self):
            if self.path == "/api/detect":
                self._handle_detect()
                return
            if self.path == "/api/hover":
                self._handle_hover()
                return
            if self.path == "/api/voice/ask":
                self._handle_voice_ask()
                return
            self._send_json(404, {"ok": False, "error": "unknown endpoint"})

        def _handle_detect(self):
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > self.max_image_body_size:
                    raise ValueError("圖片太大或內容為空")
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                if not payload.get("imageData"):
                    raise ValueError("缺少 imageData")
                result = detector.predict(payload["imageData"], payload.get("fileName", "uploaded-f450.jpg"), float(payload.get("conf", 0.25)))
                self._send_json(200, {"ok": True, "result": result})
            except Exception as exc:
                self._send_json(500, {"ok": False, "error": str(exc)})

        def _handle_hover(self):
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > self.max_video_body_size:
                    raise ValueError("影片太大或內容為空；1.0 建議上傳 30 秒內影片")
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                if not payload.get("videoData"):
                    raise ValueError("缺少 videoData")
                result = hover_scorer.score_video(payload["videoData"], payload.get("fileName", "hover.mp4"))
                self._send_json(200, {"ok": True, "result": result})
            except Exception as exc:
                self._send_json(500, {"ok": False, "error": str(exc)})

        def _handle_voice_ask(self):
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > 128 * 1024:
                    raise ValueError("問題內容太大或為空")
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                result = voice_assistant.ask(payload.get("question", ""))
                self._send_json(200, {"ok": True, "result": result})
            except Exception as exc:
                self._send_json(500, {"ok": False, "error": str(exc)})

        def log_message(self, format, *args):
            return

    return YoloHandler


def main():
    load_env_file()
    parser = argparse.ArgumentParser(description="FDE-AI local YOLOv8 and hover scoring server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--model", default=os.environ.get("FDE_AI_YOLO_MODEL", DEFAULT_MODEL))
    parser.add_argument("--hover-model", default=os.environ.get("FDE_AI_HOVER_MODEL", DEFAULT_HOVER_MODEL))
    parser.add_argument("--voice-rag-dir", default=os.environ.get("FDE_VOICE_RAG_DIR", DEFAULT_VOICE_RAG_DIR))
    parser.add_argument("--voice-model", default=os.environ.get("FDE_VOICE_MODEL", DEFAULT_VOICE_MODEL))
    args = parser.parse_args()

    detector = Detector(args.model)
    hover_scorer = HoverScorer(args.hover_model)
    voice_assistant = VoiceAssistant(args.voice_rag_dir, args.voice_model)
    server = ThreadingHTTPServer((args.host, args.port), make_handler(detector, hover_scorer, voice_assistant))
    print(f"FDE-AI local AI server running at http://{args.host}:{args.port}")
    print(f"Parts model: {detector.model_path}")
    print(f"Hover model: {hover_scorer.model_path}")
    print(f"Voice RAG dir: {voice_assistant.rag_dir}")
    server.serve_forever()


if __name__ == "__main__":
    main()
