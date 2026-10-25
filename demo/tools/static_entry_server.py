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
  * **Origin / Referer 原樣轉發，不改寫**（P3-E 2026-10-25）。入口對外位址必須以
    `DJANGO_CSRF_TRUSTED_ORIGINS` 明確列入 Django 白名單；本代理另以
    `FDE_ENTRY_TRUSTED_ORIGINS` 做最外層前置攔截（可留空，留空時由 Django 決定）。
  * 只綁 192.168.1.114（與 DEMO 其他服務一致，不綁 0.0.0.0）。
  * **Host 明確白名單**（P3-F 2026-10-25）：本代理會把 `Host` 改寫成上游位址，
    上游 `ALLOWED_HOSTS` 因此看不到瀏覽器送來的 Host。合法性在本層判定，
    未授權 Host 一律回 400；白名單以 `FDE_ENTRY_ALLOWED_HOSTS` 明確列出。
  * **轉發標頭不採信客戶端**（P3-F 2026-10-25）：客戶端自帶的 `X-Forwarded-*`／
    `Forwarded` 一律丟棄，`X-Forwarded-Proto` 由本層依 `FDE_ENTRY_PUBLIC_SCHEME`
    決定（預設 `http`，因本代理無 TLS）；純 HTTP 部署不再被誤標為 HTTPS。
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


# ---------------------------------------------------------------- 來源信任白名單
# P3-E（2026-10-25）安全收斂：本代理**不再改寫** Origin / Referer。
#
# 2026-10-23 曾以「把 Origin 改寫成內部 Django 位址」的方式繞過 CSRF 403，但這會讓
# Django 的 Origin 比對恆成立 —— 等於把第二道防線整條中和，任何跨站來源都能通過
# Origin 檢查（只剩 CSRF token 一道）。本版改為：
#   1. Origin / Referer 原樣轉發，瀏覽器送什麼就是什麼；
#   2. Django 端以 `DJANGO_CSRF_TRUSTED_ORIGINS` **明確列出**入口的對外位址；
#   3. 本代理在最外層做一次「來源是否在白名單內」的前置攔截（縱深防禦）。
#
# `FDE_ENTRY_TRUSTED_ORIGINS`：逗號分隔的完整來源（scheme://host[:port]）。
#   * 不允許萬用字元（含 `*`）—— 出現即啟動失敗（fail closed），不做靜默降級。
#   * 未設定時本層不攔截，完全交由 Django 的 CSRF 檢查決定（Django 仍是權威）。
#   * 例：FDE_ENTRY_TRUSTED_ORIGINS=https://demo.example.edu.tw,http://127.0.0.1:8112
UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def _parse_trusted_origins(raw: str) -> frozenset:
    """解析並嚴格驗證來源白名單；任何不合規格即拋 SystemExit（啟動失敗）。"""
    parsed = set()
    for item in (raw or "").split(","):
        origin = item.strip().rstrip("/")
        if not origin:
            continue
        if "*" in origin:
            raise SystemExit(
                "[entry] FDE_ENTRY_TRUSTED_ORIGINS 不允許萬用字元；請逐一列出完整來源（fail closed）。"
            )
        parts = urlsplit(origin)
        if parts.scheme not in ("http", "https") or not parts.netloc:
            raise SystemExit(f"[entry] FDE_ENTRY_TRUSTED_ORIGINS 項目無法解析：{origin!r}")
        if parts.path or parts.query or parts.fragment:
            raise SystemExit(f"[entry] FDE_ENTRY_TRUSTED_ORIGINS 項目不可帶路徑／查詢：{origin!r}")
        parsed.add(f"{parts.scheme}://{parts.netloc}".lower())
    return frozenset(parsed)


TRUSTED_ORIGINS = _parse_trusted_origins(os.environ.get("FDE_ENTRY_TRUSTED_ORIGINS", ""))


# ---------------------------------------------------------------- Host 白名單
# P3-F（2026-10-25）安全收斂：本代理在轉發前會把 `Host` 改寫成上游位址，因此
# 瀏覽器送來的 Host **永遠不會**到達上游的 `ALLOWED_HOSTS` 檢查。若不在這一層
# 判定，偽造 Host 等於無人把關。故本層自帶明確白名單：
#   * `FDE_ENTRY_ALLOWED_HOSTS`：逗號分隔的 `host` 或 `host:port`（可含 IPv6 方括號）。
#     設定後**完全取代**預設值；不允許萬用字元，出現即啟動失敗（fail closed）。
#   * 未設定時採預設值：loopback（含 IPv6）與本代理實際綁定位址，各自帶/不帶本埠。
#   * 未帶埠的 Host 與帶埠的 Host 視為不同項目，需分別列出（HTTP/1.1 預設埠除外）。
def _parse_allowed_hosts(raw: str) -> frozenset:
    parsed = set()
    for item in (raw or "").split(","):
        host = item.strip().lower().rstrip(".")
        if not host:
            continue
        if "*" in host:
            raise SystemExit(
                "[entry] FDE_ENTRY_ALLOWED_HOSTS 不允許萬用字元；請逐一列出完整主機（fail closed）。"
            )
        parsed.add(host)
    return frozenset(parsed)


def _default_allowed_hosts() -> frozenset:
    base = {"127.0.0.1", "localhost", "[::1]", BIND_ADDR.strip().lower()}
    hosts = set(base)
    for host in base:
        hosts.add(f"{host}:{PORT}")
    return frozenset(hosts)


ALLOWED_HOSTS = _parse_allowed_hosts(os.environ.get("FDE_ENTRY_ALLOWED_HOSTS", "")) or _default_allowed_hosts()


# ---------------------------------------------------------------- 轉發標頭策略
# P3-F（2026-10-25）：`X-Forwarded-*` 一律由本代理自行決定，**不採信客戶端送來的值**。
# 舊行為是 `X-Forwarded-Proto = 客戶端自帶值 or "https"`，等同：
#   1. 任何客戶端自帶 `X-Forwarded-Proto: https` 就能把純 HTTP 連線偽造成 HTTPS；
#   2. 沒帶時預設成 `https`，使非 DEBUG 的純 HTTP 部署被誤標為 HTTPS，
#      `SECURE_SSL_REDIRECT` 因此不再生效。
# 新行為：客戶端提供的轉發標頭全部丟棄，改由本層設定；HTTPS 只在運維明確聲明
# 「本入口位於可信 TLS 終結器之後」時才標記。
CLIENT_FORWARDED_HEADERS = frozenset(
    {
        "x-forwarded-proto",
        "x-forwarded-host",
        "x-forwarded-for",
        "x-forwarded-port",
        "x-forwarded-server",
        "x-real-ip",
        "forwarded",
    }
)


def _parse_public_scheme(raw: str) -> str:
    scheme = (raw or "").strip().lower()
    if scheme not in ("http", "https"):
        raise SystemExit(f"[entry] FDE_ENTRY_PUBLIC_SCHEME 只接受 http 或 https：{raw!r}")
    return scheme


# 本代理是純 HTTP 監聽（ThreadingHTTPServer，無 TLS），因此預設對外 scheme 為 http。
PUBLIC_SCHEME = _parse_public_scheme(os.environ.get("FDE_ENTRY_PUBLIC_SCHEME", "http"))

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
    def handle(self) -> None:
        """客戶端在 keep-alive 期間直接斷線屬正常情形，不留下堆疊噪音。

        `BaseHTTPRequestHandler.handle()` 不捕捉 `ConnectionError`，瀏覽器切頁或
        取消請求時會在日誌留下整段 traceback，遮蔽真正的錯誤。
        """
        try:
            super().handle()
        except ConnectionError:
            self.close_connection = True

    def _send_bytes(self, status: int, body: bytes, content_type: str, extra_headers=None, *, close: bool = False) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if close:
            # 拒絕類回應**不讀取請求體**（避免為攻擊者白讀大量位元組）。HTTP/1.1
            # keep-alive 下若不關閉連線，殘留的請求體會被當成下一個請求的開頭，
            # 造成連線內請求錯位（實測：同一條連線上的下一個 POST 被誤判為 501）。
            self.close_connection = True
            self.send_header("Connection", "close")
        for key, value in (extra_headers or []):
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            try:
                self.wfile.write(body)
            except ConnectionError:
                # 客戶端提前斷線（瀏覽器取消、健康探測讀完即關）屬正常情形，
                # 不應在日誌留下整段堆疊噪音。
                pass

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

    # ---------------------------------------------------------------- host gate
    def _host_gate(self) -> bool:
        """Host 白名單前置檢查（所有方法、所有路徑，含靜態檔）。

        理由：本代理會把 `Host` 改寫成上游位址，上游的 `ALLOWED_HOSTS` 看不到
        瀏覽器送來的 Host。若不在此攔截，偽造 Host 不會被任何一層拒絕。
        """
        raw = (self.headers.get("Host") or "").strip().lower().rstrip(".")
        if raw and raw in ALLOWED_HOSTS:
            return True
        return self._reject_host(raw)

    def _reject_host(self, candidate: str) -> bool:
        """Host 不合格：回 400 且不轉發。回應不得包含白名單內容或內部位址。"""
        sys.stderr.write(f"[entry] host rejected: {candidate!r} {self.command}\n")
        sys.stderr.flush()
        body = json.dumps(
            {
                "error": {
                    "code": "host_not_allowed",
                    "message": "Request host is not in the configured allowlist.",
                }
            },
            ensure_ascii=False,
        ).encode("utf-8")
        self._send_bytes(400, body, "application/json; charset=utf-8", close=True)
        return False

    # ---------------------------------------------------------------- origin gate
    @staticmethod
    def _normalize_origin(value: str) -> str:
        """把 Origin/Referer 正規化為 scheme://host[:port]（去路徑、轉小寫）。"""
        parts = urlsplit(value.strip())
        if not parts.scheme or not parts.netloc:
            return ""
        return f"{parts.scheme}://{parts.netloc}".lower()

    def _origin_gate(self) -> bool:
        """不安全方法的前置來源檢查。回傳 True 表示放行。

        語意刻意與 Django 一致，但**不取代** Django：
          * 只比對「瀏覽器自己送來的」Origin／Referer，不改寫、不合成。
          * 白名單未設定 → 放行（由 Django 的 CSRF_TRUSTED_ORIGINS 決定）。
          * 兩者皆缺 → 放行（Django 仍會要求 CSRF token，缺 token 必被拒）。
          * 有值但不在白名單 → 立即 403，不轉發給上游。
          * 有值但無法解析（如 `Origin: null`，來自沙箱 iframe / file://）
            → 一律拒絕，不當成「沒有來源」放行。
        """
        if not TRUSTED_ORIGINS or self.command not in UNSAFE_METHODS:
            return True
        origin = (self.headers.get("Origin") or "").strip()
        referer = (self.headers.get("Referer") or "").strip()
        if origin:
            candidate = self._normalize_origin(origin)
            if not candidate:
                # Origin 存在但不可解析（null / 畸形）：fail closed。
                return self._reject_origin(origin)
        elif referer:
            candidate = self._normalize_origin(referer)
            if not candidate:
                return self._reject_origin(referer)
        else:
            # 完全沒有來源資訊：不以此放行，交由 Django 的 token 檢查把關。
            return True
        if candidate in TRUSTED_ORIGINS:
            return True
        return self._reject_origin(candidate)

    def _reject_origin(self, candidate: str) -> bool:
        """來源不合格：回 403 且不轉發。回應不得包含任何內部位址或埠。"""
        sys.stderr.write(f"[entry] origin rejected: {candidate!r} {self.command} {self.path}\n")
        sys.stderr.flush()
        body = json.dumps(
            {
                "error": {
                    "code": "origin_not_allowed",
                    "message": "Request origin is not in the configured allowlist.",
                }
            },
            ensure_ascii=False,
        ).encode("utf-8")
        self._send_bytes(403, body, "application/json; charset=utf-8", close=True)
        return False

    # ---------------------------------------------------------------- proxy
    def _proxy(self) -> None:
        split = urlsplit(self.path)
        upstream_path = split.path or "/"
        if split.query:
            upstream_path = f"{upstream_path}?{split.query}"
        body = self._read_body()

        headers = {}
        for key, value in self.headers.items():
            lower = key.lower()
            if lower in HOP_BY_HOP_REQUEST or lower in CLIENT_FORWARDED_HEADERS:
                continue
            headers[key] = value
        headers["Host"] = f"{UPSTREAM_HOST}:{UPSTREAM_PORT}"
        # P3-E：Origin / Referer **原樣轉發**（刻意不改寫）。
        # 若在此改寫成內部位址，Django 的 Origin 比對會恆成立，跨站來源即可通過
        # 第二道防線。入口對外位址請列入 Django 的 DJANGO_CSRF_TRUSTED_ORIGINS。
        headers["Content-Length"] = str(len(body))
        # P3-F：轉發標頭由本層決定，不採信客戶端（見 CLIENT_FORWARDED_HEADERS 註解）。
        headers["X-Forwarded-Proto"] = PUBLIC_SCHEME
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
            try:
                self.wfile.write(data)
            except ConnectionError:
                pass

    # ---------------------------------------------------------------- routes
    def _route(self) -> None:
        # Host 檢查最先：它與方法無關，且靜態檔分支也必須受同一白名單約束。
        if not self._host_gate():
            return
        # 來源檢查必須先於任何回應分支（含靜態檔），否則 POST 到 "/" 會繞過。
        if not self._origin_gate():
            return
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
    if TRUSTED_ORIGINS:
        print(f"[entry] trusted origin: {', '.join(sorted(TRUSTED_ORIGINS))}", flush=True)
    else:
        print("[entry] trusted origin: (未設定；由 Django CSRF_TRUSTED_ORIGINS 決定)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[entry] stopped by user", flush=True)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
