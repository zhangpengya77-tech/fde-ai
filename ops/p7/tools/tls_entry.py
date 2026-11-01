"""P7-A 本地 TLS 終結器（自簽憑證，非外部雲端資源）。

用途：在隔離預發布環境中提供 HTTPS 入口，讓 Session／CSRF Cookie 的 Secure
屬性可以被真實驗證（純 HTTP 下瀏覽器不會送出 Secure Cookie，無法驗收）。

架構：
    瀏覽器 --HTTPS:8443--> 本模組 --HTTP:8122--> static_entry_server（Gateway 邏輯）
                                                 ├─> Django :8120
                                                 └─> Live   :8121

本模組刻意保持極簡：只做 TLS 解密與位元組轉發，不解析、不改寫、不注入任何
`X-FDE-*` 標頭。所有身分與授權判斷仍由 Gateway 與 Live 各自負責。
"""

from __future__ import annotations

import http.client
import os
import ssl
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
TLS_DIR = HERE.parent / "tls"

BIND = os.environ.get("P7A_TLS_BIND", "127.0.0.1")
PORT = int(os.environ.get("P7A_TLS_PORT", "8443"))
UPSTREAM_HOST = os.environ.get("P7A_TLS_UPSTREAM_HOST", "127.0.0.1")
UPSTREAM_PORT = int(os.environ.get("P7A_TLS_UPSTREAM_PORT", "8122"))
TIMEOUT = float(os.environ.get("P7A_TLS_UPSTREAM_TIMEOUT", "120"))

CERT = os.environ.get("P7A_TLS_CERT", str(TLS_DIR / "p7a-cert.pem"))
KEY = os.environ.get("P7A_TLS_KEY", str(TLS_DIR / "p7a-key.pem"))

# 逐跳標頭不應轉發。
_HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}


class TlsEntryHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "P7A-TLS-Entry/1.0"

    # ---------------------------------------------------------------- helpers
    def _read_body(self) -> bytes:
        length = self.headers.get("Content-Length")
        if not length:
            return b""
        try:
            size = int(length)
        except ValueError:
            return b""
        return self.rfile.read(size) if size > 0 else b""

    def _forward(self) -> None:
        body = self._read_body()
        connection = http.client.HTTPConnection(UPSTREAM_HOST, UPSTREAM_PORT, timeout=TIMEOUT)

        headers = {}
        for key, value in self.headers.items():
            if key.lower() in _HOP_BY_HOP:
                continue
            headers[key] = value
        # 由本層宣告真實的外部 scheme；上游 Gateway 依此決定是否標記 https。
        headers["X-Forwarded-Proto"] = "https"
        headers["X-Forwarded-For"] = self.client_address[0]
        if body:
            headers["Content-Length"] = str(len(body))

        try:
            connection.request(self.command, self.path, body=body or None, headers=headers)
            response = connection.getresponse()
            payload = response.read()
        except (ConnectionError, OSError, http.client.HTTPException) as exc:
            # 上游不可用時如實回 502，不偽裝成成功。
            message = f'{{"error":"p7a_upstream_unavailable","detail":"{type(exc).__name__}"}}'.encode()
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(message)))
            self.end_headers()
            self.wfile.write(message)
            connection.close()
            return

        self.send_response(response.status, response.reason)
        for key, value in response.getheaders():
            if key.lower() in _HOP_BY_HOP:
                continue
            self.send_header(key, value)
        # 明確標示本回應經 TLS 終結，便於驗收腳本確認。
        self.send_header("X-P7A-Tls-Terminated", "1")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)
        connection.close()

    # ------------------------------------------------------------------ verbs
    def do_GET(self) -> None:  # noqa: N802
        self._forward()

    def do_HEAD(self) -> None:  # noqa: N802
        self._forward()

    def do_POST(self) -> None:  # noqa: N802
        self._forward()

    def do_PUT(self) -> None:  # noqa: N802
        self._forward()

    def do_PATCH(self) -> None:  # noqa: N802
        self._forward()

    def do_DELETE(self) -> None:  # noqa: N802
        self._forward()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._forward()

    def log_message(self, fmt: str, *args) -> None:  # noqa: D401
        sys.stderr.write("[p7a-tls] %s - %s\n" % (self.address_string(), fmt % args))


def main() -> int:
    if not Path(CERT).is_file() or not Path(KEY).is_file():
        sys.stderr.write(f"[p7a-tls] 缺少憑證：{CERT} / {KEY}\n")
        return 2
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(certfile=CERT, keyfile=KEY)
    server = ThreadingHTTPServer((BIND, PORT), TlsEntryHandler)
    server.daemon_threads = True
    server.socket = context.wrap_socket(server.socket, server_side=True)
    sys.stderr.write(f"[p7a-tls] HTTPS {BIND}:{PORT} -> HTTP {UPSTREAM_HOST}:{UPSTREAM_PORT}\n")
    sys.stderr.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
