"""Fake v1.5C-shaped HTTP entry point used by the P3-H Phase 18 adoption tests.

Start it as:
    python fake_project.py runserver 127.0.0.1:<port> --noreload --mode=v15c

The command line deliberately matches the `manage.py runserver 127.0.0.1:<port>`
shape that the ownership/adoption detectors look for.

--mode=v15c     serves a page carrying the v1.5C project fingerprint
                (FDE-AI + csrfmiddlewaretoken) -- matches the real /login/ page
--mode=generic  serves a plain 200 page with no fingerprint (proves that a bare
                200 response is never sufficient for adoption)

Binds 127.0.0.1 only, on non-production test ports.

ASCII-only on purpose: launched from a PowerShell test harness.
"""
import http.server
import sys

MARKER = b"P3H18-MARKER"
FINGERPRINT = (
    b"<!doctype html><html><head>"
    b"<title>\xe5\xad\xb8\xe5\x93\xa1\xe7\x99\xbb\xe5\x85\xa5\xef\xbd\x9cFDE-AI</title>"
    b"</head><body>"
    b"<form method=\"post\">"
    b"<input type=\"hidden\" name=\"csrfmiddlewaretoken\" value=\"x\">"
    b"<h1>FDE-AI student login</h1>"
    b"<!--" + MARKER + b"-->"
    b"</form></body></html>"
)
GENERIC = b"<!doctype html><html><body><h1>plain server</h1></body></html>"

host, port = "127.0.0.1", 18022
mode = "v15c"
for arg in sys.argv[1:]:
    if arg.startswith("--mode="):
        mode = arg.split("=", 1)[1].strip().lower()
        continue
    parts = arg.split(":")
    if len(parts) == 2 and parts[0].count(".") == 3:
        try:
            host, port = parts[0], int(parts[1])
        except ValueError:
            pass

BODY = FINGERPRINT if mode == "v15c" else GENERIC


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(BODY)))
        self.end_headers()
        self.wfile.write(BODY)

    def log_message(self, *args):
        pass


http.server.ThreadingHTTPServer((host, port), Handler).serve_forever()
