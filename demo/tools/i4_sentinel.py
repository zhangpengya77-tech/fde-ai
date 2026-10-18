#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""I4-C 探測哨兵：一個只記錄、不回應內容的本機服務。

用途：把外部模組入口 URL 指向本哨兵，即可**客觀證明**介面層是否真的發出探測：
  - 未通過安全檢查的 URL → 哨兵日誌必須為空（完全不探測）
  - 通過檢查且服務在線的 URL → 哨兵日誌必須出現該次 HEAD 請求

用法：python i4_sentinel.py <port> <logfile>
"""
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class _Handler(BaseHTTPRequestHandler):
    def _record(self):
        with open(LOG_PATH, "a", encoding="utf-8") as fh:
            fh.write("%s %s %s\n" % (self.command, self.path, self.headers.get("User-Agent", "")))
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    do_GET = _record
    do_HEAD = _record
    do_POST = _record

    def log_message(self, *args):  # 靜音
        pass


if __name__ == "__main__":
    PORT = int(sys.argv[1])
    LOG_PATH = sys.argv[2]
    ThreadingHTTPServer(("127.0.0.1", PORT), _Handler).serve_forever()
