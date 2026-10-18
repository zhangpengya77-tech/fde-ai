#!/usr/bin/env python3
"""FDE-AI-UAS v2.0 DEMO 公開入口伺服器（靜態託管 + 同源反向代理）。

用途（2026-10-18 R07 最終收尾任務）：
  1. 以「靜態檔案託管」方式提供公開入口頁（demo/runtime/public-site/index.html）。
  2. 其餘所有路徑以「同源反向代理」轉發到本機 Live Backend（預設 127.0.0.1:8111），
     由 Live 既有的 django_portal_proxy 再轉發到 Django（:8110）。
  3. 上游（Live/Django）連不上時，回傳 503 友好頁面，讓瀏覽器正確看到
     「服務暫時不可用」，而不是連線錯誤。

安全設計：
  * 同源（單一主機：連接埠）提供頁面與 API，Session Cookie / CSRF / CORS
    機制完全沿用 Django 既有設定，不開啟萬用 CORS、不關閉任何安全驗證。
  * 只綁 192.168.1.114（與 DEMO 其他服務一致，不綁 0.0.0.0）。
  * 靜態檔僅允許讀取 public-site 目錄，禁止目錄穿越。
  * 本檔為「新增的部署基礎設施」，不修改任何既有程式碼、資料或審核規則。

用法：
  FDE_ENTRY_PORT=8112 python static_entry_server.py
（預設 BIND=192.168.1.114、UPSTREAM=127.0.0.1:8111）
"""

from __future__ import annotations

import http.client
import json
import os
import socket
import sys
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

BIND_ADDR = os.environ.get("FDE_ENTRY_BIND", "192.168.1.114")
PORT = int(os.environ.get("FDE_ENTRY_PORT", "8112"))
SITE_DIR = Path(
    os.environ.get(
        "FDE_ENTRY_SITE_DIR",
        str(Path(__file__).resolve().parents[2] / "demo" / "runtime" / "public-site"),
    )
)
# 上游位址：DEMO 的 Django / Live 只綁 192.168.1.114（不綁 127.0.0.1），
# 因此預設走 192.168.1.114；Flight Health 綁 0.0.0.0，兩者皆可。
UPSTREAM_HOST = os.environ.get("FDE_ENTRY_UPSTREAM_HOST", "192.168.1.114")
UPSTREAM_PORT = int(os.environ.get("FDE_ENTRY_UPSTREAM_PORT", "8111"))
UPSTREAM_TIMEOUT = float(os.environ.get("FDE_ENTRY_UPSTREAM_TIMEOUT", "120"))

# 上游健康檢查目標（本機探測，僅供狀態燈顯示；不對外暴露內部錯誤細節）。
# 注意：/api/live/health 實測延遲約 2~3 秒，探測逾時預設 6 秒。
HEALTH_PROBES = {
    "django": (os.environ.get("FDE_ENTRY_DJANGO_HOST", "192.168.1.114"), int(os.environ.get("FDE_ENTRY_DJANGO_PORT", "8110")), "/login/"),
    "live": (UPSTREAM_HOST, UPSTREAM_PORT, "/api/live/health"),
    "flight_health": (os.environ.get("FDE_ENTRY_FH_HOST", "192.168.1.114"), int(os.environ.get("FDE_ENTRY_FH_PORT", "8040")), "/api/v1/health"),
}

HOP_BY_HOP_REQUEST = {
    "host", "connection", "keep-alive", "proxy-connection", "te",
    "trailer", "transfer-encoding", "upgrade", "content-length", "accept-encoding",
}
HOP_BY_HOP_RESPONSE = {
    "connection", "keep-alive", "proxy-connection", "te", "trailer",
    "transfer-encoding", "upgrade",
}

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
    ".webmanifest": "application/manifest+json",
}

UNAVAILABLE_HTML = """<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>服務暫時不可用 · FDE-AI</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#f4f6fa; color:#1c2433;
         font-family:"PingFang TC","Microsoft JhengHei","Noto Sans TC",system-ui,sans-serif; }
  .box { max-width: 30rem; margin: 1.5rem; padding: 1.6rem 1.4rem; background:#fff;
         border:1px solid #dde4ee; border-radius:14px; text-align:center; }
  h1 { font-size:1.25rem; margin:0 0 .6rem; }
  p { color:#5c6b82; font-size:.92rem; margin:.4rem 0; }
  a { color:#b3261e; }
</style>
</head>
<body>
  <div class="box">
    <h1>服務暫時不可用</h1>
    <p>無法連線到教師電腦上的學習平台後端。</p>
    <p>請確認教師電腦已開機並保持連線，稍後重新載入即可；若持續失敗，請向教師確認服務狀態。</p>
    <p><a href="/">重新載入入口頁</a></p>
  </div>
</body>
</html>
"""


def _probe(host: str, port: int, path: str, timeout: float = 6.0) -> bool:
    """本機健康探測：任一服務 200 視為正常。"""
    try:
        conn = http.client.HTTPConnection(host, port, timeout=timeout)
        try:
            conn.request("GET", path, headers={"Accept": "*/*", "Connection": "close"})
            resp = conn.getresponse()
            resp.read()
            return resp.status == 200
        finally:
            conn.close()
    except (OSError, http.client.HTTPException):
        return False


class EntryHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "FDE-Entry/1.0"

    # ---------------------------------------------------------------- helpers
    def _send_bytes(self, status: int, body: bytes, content_type: str, extra_headers=None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (extra_headers or []):
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _read_body(self) -> bytes:
        if "chunked" in (self.headers.get("Transfer-Encoding") or "").lower():
            chunks = []
            while True:
                line = self.rfile.readline(65536).strip()
                if b";" in line:
                    line = line.split(b";", 1)[0]
                try:
                    size = int(line, 16)
                except ValueError:
                    break
                if size == 0:
                    self.rfile.readline(65536)
                    break
                chunks.append(self.rfile.read(size))
                self.rfile.read(2)  # CRLF
            return b"".join(chunks)
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return b""
        return self.rfile.read(length)

    def _serve_static(self, path: str) -> bool:
        if path in ("/", "/index.html"):
            target = SITE_DIR / "index.html"
        elif path.startswith("/assets/"):
            name = path[len("/assets/"):]
            # 目錄穿越防護：解析後必須仍位於 SITE_DIR/assets 內。
            target = (SITE_DIR / "assets" / name).resolve()
            if not str(target).startswith(str((SITE_DIR / "assets").resolve())):
                return False
        else:
            return False
        if not target.is_file():
            return False
        body = target.read_bytes()
        ctype = CONTENT_TYPES.get(target.suffix.lower(), "application/octet-stream")
        # 快取策略由 _send_bytes 統一加上 no-store，避免重複標頭。
        self._send_bytes(200, body, ctype)
        return True

    def _serve_health(self) -> None:
        report = {"entry_server": {"ok": True}, "checked_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
        for name, (host, port, path) in HEALTH_PROBES.items():
            report[name] = {"ok": _probe(host, port, path)}
        body = json.dumps(report, ensure_ascii=False).encode("utf-8")
        self._send_bytes(200, body, "application/json; charset=utf-8")

    # ---------------------------------------------------------------- proxy
    def _proxy(self) -> None:
        split = urlsplit(self.path)
        upstream_path = split.path or "/"
        if split.query:
            upstream_path = f"{upstream_path}?{split.query}"
        body = self._read_body()

        headers = {}
        for key, value in self.headers.items():
            if key.lower() in HOP_BY_HOP_REQUEST:
                continue
            headers[key] = value
        headers["Host"] = f"{UPSTREAM_HOST}:{UPSTREAM_PORT}"
        headers["Content-Length"] = str(len(body))
        headers["X-Forwarded-Proto"] = self.headers.get("X-Forwarded-Proto", "https")
        headers["X-Forwarded-Host"] = self.headers.get("Host", "")
        headers["X-Forwarded-For"] = self.client_address[0]
        headers["Connection"] = "close"

        try:
            conn = http.client.HTTPConnection(UPSTREAM_HOST, UPSTREAM_PORT, timeout=UPSTREAM_TIMEOUT)
            try:
                conn.request(self.command, upstream_path, body=body, headers=headers)
                resp = conn.getresponse()
                data = resp.read()
            finally:
                conn.close()
        except (OSError, http.client.HTTPException) as exc:
            sys.stderr.write(f"[entry] upstream unavailable: {exc!r}\n")
            sys.stderr.flush()
            self._send_bytes(503, UNAVAILABLE_HTML.encode("utf-8"), "text/html; charset=utf-8")
            return

        self.send_response(resp.status)
        for key, value in resp.getheaders():
            lower = key.lower()
            if lower in HOP_BY_HOP_RESPONSE or lower in ("content-length", "set-cookie"):
                continue
            self.send_header(key, value)
        for cookie in resp.headers.get_all("Set-Cookie") or []:
            self.send_header("Set-Cookie", cookie)
        # 本代理已完整讀取上游 body，必須逐位元組如實轉發，因此一律帶上 Content-Length，
        # 否則 HTTP/1.1 keep-alive 下瀏覽器無法判斷 body 邊界而掛起。
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    # ---------------------------------------------------------------- routes
    def _route(self) -> None:
        path = urlsplit(self.path).path
        if path == "/favicon.ico":
            self._send_bytes(204, b"", "image/x-icon")
            return
        if path == "/portal/health":
            self._serve_health()
            return
        if self._serve_static(path):
            return
        self._proxy()

    def do_GET(self) -> None:  # noqa: N802
        self._route()

    def do_HEAD(self) -> None:  # noqa: N802
        self._route()

    def do_POST(self) -> None:  # noqa: N802
        self._route()

    def do_PUT(self) -> None:  # noqa: N802
        self._route()

    def do_DELETE(self) -> None:  # noqa: N802
        self._route()

    def do_PATCH(self) -> None:  # noqa: N802
        self._route()

    def log_message(self, fmt: str, *args) -> None:
        sys.stdout.write(
            "[%s] %s - %s\n" % (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), self.address_string(), fmt % args)
        )
        sys.stdout.flush()


class EntryServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> int:
    if not (SITE_DIR / "index.html").is_file():
        sys.stderr.write(f"[entry] site index.html not found: {SITE_DIR}\n")
        return 2
    # Windows SO_REUSEADDR 陷阱：allow_reuse_address=True 在 Windows 上允許
    # 第二個行程「靜默」綁定同一埠（不報錯），造成雙監聽、流量路由不確定，
    # 且殺掉後來的行程會把原监听一起帶走（2026-10-18 實測踩坑）。
    # 因此綁定前先探測：已有人在听就明確失敗退出，不搶佔埠。
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(2.0)
        try:
            probe.connect((BIND_ADDR, PORT))
        except OSError:
            pass  # 沒人监听，正常
        else:
            sys.stderr.write(
                f"[entry] {BIND_ADDR}:{PORT} 已有其他服務在監聽（可能入口伺服器已在執行）。\n"
                f"[entry] 如確認要重啟，請先停止舊实例：start_public_entry.ps1 -Stop\n"
            )
            return 3
    server = EntryServer((BIND_ADDR, PORT), EntryHandler)
    print(f"[entry] static site : {SITE_DIR}", flush=True)
    print(f"[entry] listening   : http://{BIND_ADDR}:{PORT}", flush=True)
    print(f"[entry] upstream    : http://{UPSTREAM_HOST}:{UPSTREAM_PORT} (Live Backend)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[entry] stopped by user", flush=True)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
