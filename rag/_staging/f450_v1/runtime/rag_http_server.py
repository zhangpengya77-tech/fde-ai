from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import traceback
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

_RUNTIME_DIR = Path(__file__).resolve().parent


def _load_module(name: str):
    spec = importlib.util.spec_from_file_location(f"fde_f450_v1_{name}", _RUNTIME_DIR / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


config = _load_module("rag_config")
RagService = _load_module("rag_service").RagService


def log_runtime_error(message: str, root: Path | None = None) -> Path:
    base = Path(root) if root else config.ACTIVE_VERSION_PATH.parent
    log_path = base / "logs" / "runtime_errors.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8", newline="\n") as stream:
        stream.write(f"{datetime.now(timezone.utc).isoformat()} {message}\n")
    return log_path


def safe_error(answer: str, version: str = config.VERSION) -> dict:
    return {"answer": answer, "source_type": "refuse", "score": 0.0, "sources": [], "version": version}


class RagHandler(BaseHTTPRequestHandler):
    service: RagService | None = None

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204, {})

    def do_GET(self):
        if self.path != "/api/rag/health":
            self._send(404, safe_error("找不到服務端點"))
            return
        if not self.service:
            self._send(503, {"status": "error", "version": config.VERSION, "document_count": 0, "index_loaded": False})
            return
        self._send(200, self.service.health())

    def do_POST(self):
        if self.path != "/api/rag/ask":
            self._send(404, safe_error("找不到服務端點"))
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > 8192:
                raise ValueError("請求內容過長")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("JSON 格式錯誤")
            if not self.service:
                self._send(503, safe_error("知識庫服務暫時不可用，請稍後再試。"))
                return
            self._send(200, self.service.ask(payload.get("question")))
        except (ValueError, TypeError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            log_runtime_error(str(exc), self.service.version_root if self.service else None)
            self._send(400, safe_error(str(exc)))
        except Exception as exc:
            log_runtime_error(str(exc), self.service.version_root if self.service else None)
            traceback.print_exc()
            self._send(503, safe_error("知識庫服務暫時不可用，請稍後再試。"))

    def log_message(self, format, *args):
        return


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8770)
    parser.add_argument("--version-root", type=Path)
    args = parser.parse_args()
    try:
        RagHandler.service = RagService(args.version_root)
    except Exception as exc:
        log_runtime_error(str(exc))
        print(f"RAG 啟動失敗：{exc}")
        return 2
    server = ThreadingHTTPServer((args.host, args.port), RagHandler)
    print(json.dumps(RagHandler.service.health(), ensure_ascii=False), flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
