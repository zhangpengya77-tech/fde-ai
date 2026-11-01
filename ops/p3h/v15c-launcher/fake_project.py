#!/usr/bin/env python3
"""
P3-H Phase 20-A E4c test double.

Serves a page that faithfully replicates the REAL v1.5C /login/ response:
  - contains "FDE-AI" (page title)
  - renders "csrfmiddlewaretoken" (Django {% csrf_token %} -> hidden input)
  - does NOT contain "resend-verification" (that is a SEPARATE route
    learning/urls.py:20 -> login/resend-verification/, never embedded in /login/)

This is the honest replica the previous over-cooperative fake_project.py was NOT:
it does not inject resend-verification, so it reproduces the E4c deadlock
(root cause: the 3-marker contract required a marker structurally absent from
the real page).
"""
import sys
import http.server
import socketserver

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 18199

PAGE = b"""<!DOCTYPE html>
<html><head><title>FDE-AI Classroom</title></head>
<body>
<h1>FDE-AI</h1>
<form method="post" action="/login/">
<input type="hidden" name="csrfmiddlewaretoken" value="abc123tok">
<input type="text" name="username" placeholder="username">
<input type="password" name="password" placeholder="password">
<button type="submit">Login</button>
</form>
</body></html>"""


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = PAGE
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # silence
        pass


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
        httpd.serve_forever()
