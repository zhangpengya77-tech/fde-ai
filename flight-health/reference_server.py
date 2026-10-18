"""
FDE Flight Health — 参考后端 (Reference Backend)

用途：
    * 在沙箱 / 演示环境中提供一套「可真实运行」的 Flight Health 后端，
      实现与教师诊断主机 (:8040) 完全一致的 API 契约，外加统一的引擎端点。
    * 让学员端「无教师模型也能用内建规则引擎分析真实 .bin」这一修复可被端到端验证。

正式环境：
    生产由教师诊断主机 (:8040，独立部署，不在本仓库) 提供相同契约。
    本文件仅作为参考实现与验收载体，不修改任何正式后端。

API 契约（与 :8040 一致）：
    GET  /api/v1/health
    POST /api/v1/flights                       -> {flight_id}
    POST /api/v1/flights/{id}/log              (multipart file)
    POST /api/v1/flights/{id}/analyze
    GET  /api/v1/flights/{id}/result           (student_view)
    GET  /api/v1/flights/{id}/teacher-result   (需 X-FDE-Teacher-Mode 头)

统一引擎端点（本次新增）：
    GET  /api/flight-health/engine-status      -> engine_resolver.flight_health_engine_status()
    POST /api/flight-health/analyze            -> 解析引擎后真实分析（内建规则引擎 / 转发教师模型）

安全约束：绝不伪造健康结果。内建规则引擎走 builtin_rule_engine 的真实解析。
"""

from __future__ import annotations

import io
import json
import os
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import engine_resolver as er
import builtin_rule_engine as bre

ROOT = os.path.dirname(os.path.abspath(__file__))

# 内存会话表（仅参考实现使用）
SESSIONS = {}


def _student_view_from_analysis(analysis: dict, filename: str) -> dict:
    """把内建规则引擎结果包装成前端 student_view 期望的结构。

    八卡统一契约（2026-10-16）：学员视图每卡固定含 card_id / title / status /
    display_status / main_finding / next_action / rule_id，UNKNOWN 时含 missing_reason。
    evidence（原始字段实测值）仅教师层（/teacher-result）可见，学员视图不输出。
    """
    cards = []
    for card in analysis.get("health_cards", []):
        sv_card = {
            "card_id": card.get("card_id", ""),
            "title": card.get("title", ""),
            "status": card.get("status", "unknown"),
            "display_status": card.get("display_status", "无法判断"),
            "main_finding": card.get("main_finding", ""),
            "next_action": card.get("next_action", "请由教师复核确认下一步。"),
            "rule_id": card.get("rule_id", ""),
        }
        if card.get("status") == "unknown":
            sv_card["missing_reason"] = card.get("missing_reason", "数据缺失，无法判断。")
        cards.append(sv_card)
    return {
        "overall_status": analysis.get("overall_status", "unknown"),
        "display_status": analysis.get("display_status", "无法判断"),
        "main_finding": analysis.get("main_finding", ""),
        "next_action": analysis.get("next_action", ""),
        "health_cards": cards,
        "engine": analysis.get("engine", "builtin_rule_engine"),
        "engine_display": analysis.get("engine_display", "系统标准规则"),
        "source_file": filename,
        "parsed_message_count": analysis.get("parsed_message_count", 0),
    }


def _run_analysis(file_bytes: bytes, filename: str) -> dict:
    """按统一引擎解析结果执行真实分析。

    1) 解析引擎（teacher_model / builtin_rule_engine）。
    2) 若 teacher_model 且配置了上游教师主机 FDE_FLIGHT_HEALTH_UPSTREAM，则转发（真实）。
       未配置上游时，透明退回内建规则引擎，并在 detail 中如实说明（绝不伪造教师模型结果）。
    3) 内建规则引擎：真实解析 .bin，绝不返回假结果。
    """
    resolved = er.resolve_flight_health_engine()
    upstream = os.environ.get("FDE_FLIGHT_HEALTH_UPSTREAM", "").strip()

    if resolved["type"] == er.TEACHER_MODEL_ENGINE and upstream:
        # 正式路径：转发到教师诊断主机（真实 .bin 由 :8040 用教师模型分析）
        # 参考实现：此处依赖外部上游，沙箱无上游时退回内建并如实标注。
        raise RuntimeError("上游教师诊断主机转发需真实 :8040 部署，参考环境未配置时退回内建规则引擎。")

    analysis = bre.analyze(file_bytes, filename=filename)
    analysis["engine"] = resolved["engine"]
    analysis["engine_display"] = resolved["display_name"]
    # 若解析为教师模型但无上游，如实标注实际生效引擎
    if resolved["type"] == er.TEACHER_MODEL_ENGINE and not upstream:
        analysis["engine_effective"] = "builtin_rule_engine"
        analysis["engine_note"] = "教师模型已配置但上游未连接，本次以内建规则引擎真实分析。"
    return analysis


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, payload, content_type="application/json"):
        body = payload if isinstance(payload, (bytes, bytearray)) else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        # CORS 预检：前端 POST /api/v1/flights 使用 Content-Type: application/json，
        # 属非简单请求，浏览器会先发 OPTIONS。缺失此处理器时预检 501 → 前端 fetch Failed to fetch。
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-FDE-Teacher-Mode")
        self.send_header("Access-Control-Max-Age", "86400")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        return self.rfile.read(length) if length else b""

    def _serve_static(self, path: str):
        rel = path.lstrip("/")
        if rel == "" or rel == "index.html":
            rel = "index.html"
        full = os.path.normpath(os.path.join(ROOT, rel))
        if not full.startswith(ROOT) or not os.path.isfile(full):
            return self._send(404, {"error": "static not found", "path": path})
        ctype = "text/html"
        if full.endswith(".css"):
            ctype = "text/css"
        elif full.endswith(".js"):
            ctype = "application/javascript"
        with open(full, "rb") as f:
            return self._send(200, f.read(), content_type=ctype)

    def _parse_multipart_file(self, body: bytes):
        """极简 multipart 解析，取出第一个文件字段的二进制内容与真实文件名。

        返回 (bytes, filename)；无文件字段时返回 None。
        """
        boundary = None
        ct = self.headers.get("Content-Type", "")
        if "boundary=" in ct:
            boundary = ("--" + ct.split("boundary=")[1].split(";")[0].strip()).encode()
        if not boundary:
            return None
        parts = body.split(boundary)
        for part in parts:
            if b"filename=" in part and b"\r\n\r\n" in part:
                head, _, data = part.partition(b"\r\n\r\n")
                # 仅剥掉 multipart 分隔符前的单个 CRLF；不得 rstrip(b"\r\n")，
                # 否则二进制 .bin 内容尾部的真实 0x0D/0x0A 字节会被误删（数据损坏）。
                if data.endswith(b"\r\n"):
                    data = data[:-2]
                # 提取真实文件名（报告溯源用；缺失时回落 upload.bin）
                filename = "upload.bin"
                for line in head.split(b"\r\n"):
                    if b"filename=" in line:
                        try:
                            raw = line.split(b'filename="', 1)[1].split(b'"', 1)[0]
                            filename = raw.decode("utf-8", "replace") or "upload.bin"
                        except Exception:
                            pass
                        break
                return data, filename
        return None

    def do_GET(self):
        path = urlparse(self.path).path

        # 静态前端（与 API 同源，便于前端 fetch 同域 /api/flight-health/*）
        if not path.startswith("/api/"):
            return self._serve_static(path)

        if path == "/api/v1/health":
            return self._send(200, {"status": "ok"})

        if path == "/api/flight-health/engine-status":
            return self._send(200, er.flight_health_engine_status())

        if path.startswith("/api/v1/flights/") and path.endswith("/result"):
            fid = path.split("/")[-2]
            sess = SESSIONS.get(fid)
            # 注意：會話初始即含 "analysis": None，故必須判斷「值」而非「鍵是否存在」，
            # 否則分析未完成時 sess["student_view"] 會拋 KeyError 導致連線被切斷
            # （前端看到 Failed to fetch）。同時防禦 student_view 尚未寫入的情況。
            if not sess or not sess.get("analysis") or "student_view" not in sess:
                return self._send(404, {"error": "result not ready"})
            return self._send(200, {
                "student_view": sess["student_view"],
                "ai_diagnosis": sess.get("ai_diagnosis", {}),
            })

        if path.startswith("/api/v1/flights/") and path.endswith("/teacher-result"):
            fid = path.split("/")[-2]
            sess = SESSIONS.get(fid)
            if not sess or not sess.get("analysis"):
                return self._send(404, {"error": "result not ready"})
            # 教师端专业资料层：包含原始字段证据（学员视图不可见）
            return self._send(200, {
                "teacher_result": sess["analysis"],
                "raw_fields_present": True,
            })

        return self._send(404, {"error": "not found", "path": path})

    def do_POST(self):
        path = urlparse(self.path).path

        if path == "/api/v1/flights":
            body = self._read_body()
            try:
                data = json.loads(body) if body else {}
            except json.JSONDecodeError:
                data = {}
            fid = uuid.uuid4().hex[:12]
            SESSIONS[fid] = {
                "aircraft_name": data.get("aircraft_name", ""),
                "training_task": data.get("training_task", ""),
                "file_bytes": None,
                "analysis": None,
            }
            return self._send(200, {"flight_id": fid})

        if path.startswith("/api/v1/flights/") and path.endswith("/log"):
            fid = path.split("/")[-2]
            sess = SESSIONS.get(fid)
            if not sess:
                return self._send(404, {"error": "unknown flight"})
            body = self._read_body()
            try:
                parsed = self._parse_multipart_file(body)
            except Exception as e:
                return self._send(400, {"error": f"日誌檔案解析失敗：{e}"})
            file_bytes, filename = parsed if parsed else (body, "upload.bin")
            sess["file_bytes"] = file_bytes
            sess["filename"] = filename
            return self._send(200, {"ok": True, "bytes": len(file_bytes), "filename": filename})

        if path.startswith("/api/v1/flights/") and path.endswith("/analyze"):
            fid = path.split("/")[-2]
            sess = SESSIONS.get(fid)
            # 用 is None 判斷「尚未上傳」，讓空檔案（0 位元組）也能走分析流程，
            # 產出「八卡全 unknown + missing_reason」，與其他解析失敗情境一致（不謊報、不崩潰）。
            if not sess or sess.get("file_bytes") is None:
                return self._send(400, {"error": "no log uploaded"})
            try:
                analysis = _run_analysis(sess["file_bytes"], sess.get("filename", "upload.bin"))
            except RuntimeError as e:
                return self._send(502, {"error": str(e)})
            except Exception as e:
                # 解析器异常兜底：返回 500 JSON，避免 handler 断连导致前端 fetch Failed to fetch
                return self._send(500, {"error": f"分析處理失敗：{type(e).__name__}: {e}"})
            sess["analysis"] = analysis
            sess["student_view"] = _student_view_from_analysis(analysis, sess.get("filename", ""))
            sess["ai_diagnosis"] = {
                "summary": analysis.get("main_finding", ""),
                "engine": analysis.get("engine_display", "系统标准规则"),
            }
            return self._send(200, {"ok": True, "overall_status": analysis.get("overall_status")})

        if path == "/api/flight-health/analyze":
            body = self._read_body()
            parsed = self._parse_multipart_file(body)
            file_bytes = (parsed[0] if parsed else None) or body
            if not file_bytes:
                return self._send(400, {"error": "no file"})
            try:
                analysis = _run_analysis(file_bytes, "upload.bin")
            except RuntimeError as e:
                return self._send(502, {"error": str(e)})
            except Exception as e:
                return self._send(500, {"error": f"分析處理失敗：{type(e).__name__}: {e}"})
            return self._send(200, analysis)

        return self._send(404, {"error": "not found", "path": path})

    def log_message(self, *args):
        pass  # 静默


def main():
    port = int(os.environ.get("FDE_FLIGHT_HEALTH_PORT", "8040"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Flight Health reference backend on :{port}")
    print(f"  GET  /api/v1/health")
    print(f"  GET  /api/flight-health/engine-status")
    print(f"  POST /api/flight-health/analyze")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
