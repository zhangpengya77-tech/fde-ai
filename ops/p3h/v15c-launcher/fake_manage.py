"""Fake Django entry point used by the P3-H Phase 17 contract tests.

Start it as `python fake_manage.py runserver 127.0.0.1:<port> --noreload` so that
its command line matches the `manage.py runserver 127.0.0.1:<port>` pattern that
Test-IsV15CDjango looks for, and so that it returns a fixed health marker.

It binds 127.0.0.1 only, and only on non-production test ports.

ASCII-only on purpose: this file is launched from a PowerShell test harness.
"""
import http.server
import sys

MARKER = b"P3H-TEST-MARKER v1.5C student login"

host, port = "127.0.0.1", 18022
for arg in sys.argv[1:]:
    parts = arg.split(":")
    if len(parts) == 2 and parts[0].count(".") == 3:
        try:
            host, port = parts[0], int(parts[1])
        except ValueError:
            pass


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(MARKER)))
        self.end_headers()
        self.wfile.write(MARKER)

    def log_message(self, *args):
        pass


http.server.ThreadingHTTPServer((host, port), Handler).serve_forever()
