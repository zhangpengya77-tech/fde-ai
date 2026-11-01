"""公開入口 → Flight Health 主機的同域轉發：路徑改寫與憑證邊界（離線）。"""

import http.client
import json
import os
import socket
import subprocess
import sys
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ENTRY_SERVER = Path(__file__).resolve().parents[2] / "demo" / "tools" / "static_entry_server.py"


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class _Recorder(BaseHTTPRequestHandler):
    seen = []

    def _reply(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        type(self).seen.append((self.command, self.path, dict(self.headers), body))
        payload = json.dumps({"ok": True}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    do_GET = _reply
    do_POST = _reply

    def log_message(self, *args):
        pass


class FlightHealthProxyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fh = ThreadingHTTPServer(("127.0.0.1", 0), _Recorder)
        threading.Thread(target=cls.fh.serve_forever, daemon=True).start()
        cls.port = _free_port()
        env = dict(
            os.environ,
            FDE_ENTRY_BIND="127.0.0.1",
            FDE_ENTRY_PORT=str(cls.port),
            FDE_ENTRY_UPSTREAM_HOST="127.0.0.1",
            FDE_ENTRY_UPSTREAM_PORT="1",
            FDE_ENTRY_FH_HOST="127.0.0.1",
            FDE_ENTRY_FH_PORT=str(cls.fh.server_address[1]),
            FDE_ENTRY_ALLOWED_HOSTS="entry.test",
            FDE_ENTRY_TRUSTED_ORIGINS="https://entry.test",
            FDE_ENTRY_PUBLIC_SCHEME="https",
        )
        cls.proc = subprocess.Popen([sys.executable, str(ENTRY_SERVER)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.time() + 15
        while time.time() < deadline:
            with socket.socket() as sock:
                sock.settimeout(0.3)
                if sock.connect_ex(("127.0.0.1", cls.port)) == 0:
                    return
            time.sleep(0.1)
        raise RuntimeError("entry did not start")

    @classmethod
    def tearDownClass(cls):
        cls.proc.kill()
        cls.proc.wait()
        cls.fh.shutdown()
        cls.fh.server_close()

    def setUp(self):
        _Recorder.seen.clear()

    def _request(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        conn.request(method, path, body=body, headers={"Host": "entry.test", **(headers or {})})
        resp = conn.getresponse()
        resp.read()
        conn.close()
        return resp.status

    def test_rewrites_path_and_keeps_body(self):
        status = self._request("POST", "/api/flight-health/v1/flights/1/log?a=1", body=b"BIN", headers={"Origin": "https://entry.test"})
        self.assertEqual(status, 200)
        method, path, _, body = _Recorder.seen[0]
        self.assertEqual((method, path, body), ("POST", "/api/v1/flights/1/log?a=1", b"BIN"))

    def test_strips_cookie_and_teacher_mode(self):
        self._request("GET", "/api/flight-health/v1/flights/1/teacher-result", headers={"Cookie": "sessionid=x", "X-FDE-Teacher-Mode": "DEV-LOCAL"})
        sent = {key.lower() for key in _Recorder.seen[0][2]}
        self.assertNotIn("cookie", sent)
        self.assertNotIn("x-fde-teacher-mode", sent)

    def test_rejects_traversal(self):
        for path in ("/api/flight-health/v1/../../ui/", "/api/flight-health/v1/%2e%2e/%2e%2e/ui/"):
            self.assertEqual(self._request("GET", path), 404)
        self.assertEqual(_Recorder.seen, [])

    def test_rejects_cross_origin_post(self):
        self.assertEqual(self._request("POST", "/api/flight-health/v1/flights", body=b"{}", headers={"Origin": "https://evil.test"}), 403)
        self.assertEqual(_Recorder.seen, [])

    def test_rejects_oversized_body_without_reading(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        conn.putrequest("POST", "/api/flight-health/v1/flights", skip_host=True)
        conn.putheader("Host", "entry.test")
        conn.putheader("Content-Length", str(66 * 1024 * 1024))
        conn.endheaders()
        self.assertEqual(conn.getresponse().status, 413)
        conn.close()
        self.assertEqual(_Recorder.seen, [])


if __name__ == "__main__":
    unittest.main()
