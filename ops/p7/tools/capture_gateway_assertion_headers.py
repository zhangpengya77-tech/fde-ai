"""僅供 P7 隔離診斷：確認 Gateway 送往 Django 的安全中繼資料。

此工具絕不輸出 Cookie、CSRF Token、Gateway Key 或 Assertion 的實際值；
只記錄是否存在及 HTTPS/Origin 等非機密契約欄位。
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, HTTPServer


class HeaderCaptureHandler(BaseHTTPRequestHandler):
    """接收單次 Gateway 換票請求並輸出無秘密診斷資料。"""

    def do_POST(self) -> None:  # noqa: N802 - HTTP handler 固定名稱
        size = int(self.headers.get("Content-Length", "0"))
        self.rfile.read(size)
        # 僅列出 Cookie 名稱，絕不輸出值，方便確認 Session 與 CSRF 都有到達。
        cookie_names = [
            item.strip().partition("=")[0]
            for item in self.headers.get("Cookie", "").split(";")
            if item.strip().partition("=")[0]
        ]
        result = {
            "x_forwarded_proto": self.headers.get("X-Forwarded-Proto", ""),
            "origin": self.headers.get("Origin", ""),
            "cookie_present": bool(self.headers.get("Cookie")),
            "cookie_names": cookie_names,
            "csrf_present": bool(self.headers.get("X-CSRFToken")),
            "gateway_auth_present": bool(self.headers.get("X-FDE-Gateway-Auth")),
        }
        print(json.dumps(result, ensure_ascii=False), flush=True)
        self.send_response(403)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"error":"capture"}')

    def log_message(self, *_args) -> None:
        """避免標準 HTTP 日誌混入診斷輸出。"""


def main() -> None:
    """僅綁定 loopback 的隔離捕捉服務。"""
    HTTPServer(("127.0.0.1", 8126), HeaderCaptureHandler).serve_forever()


if __name__ == "__main__":
    main()
