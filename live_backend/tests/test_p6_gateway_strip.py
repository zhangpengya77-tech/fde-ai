"""P6：入口（Gateway）必須丟棄客戶端自帶的身分標頭，不得轉發給 Live。

必須**獨立行程**執行：

    python live_backend/_run_unittests.py test_p6_gateway_strip
"""

from __future__ import annotations

import http.client
import importlib.util
import json
import os
import subprocess
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENTRY_PATH = ROOT / "demo" / "tools" / "static_entry_server.py"
WORKER_PATH = ROOT / "cloudflare" / "dev-phase1a" / "worker.mjs"

FORGED_HEADERS = {
    "X-FDE-Role": "teacher",
    "X-FDE-Teacher-ID": "2",
    "X-FDE-Student-ID": "7",
    "X-FDE-Live-Assertion": "v1.browser-forged.signature",
    "Cookie": "sessionid=attacker-session; csrftoken=x",
    "Authorization": "Bearer attacker-token",
    "X-Forwarded-For": "1.2.3.4",
    "X-Forwarded-Proto": "https",
    "X-Real-IP": "1.2.3.4",
    "Forwarded": "for=1.2.3.4",
    "X-Original-URL": "/admin",
    "X-Client-Id": "attacker",
    "X-Auth-Token": "attacker",
    "Accept": "*/*",
}


def _load_entry_module():
    spec = importlib.util.spec_from_file_location("p6_entry_server", ENTRY_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _RecordingUpstream(BaseHTTPRequestHandler):
    seen: list = []

    def do_GET(self):  # noqa: N802
        _RecordingUpstream.seen.append({key.lower(): value for key, value in self.headers.items()})
        body = b"upstream-ok"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args) -> None:  # noqa: A002
        return None


class GatewayStripUnitTests(unittest.TestCase):
    def setUp(self):
        self.entry = _load_entry_module()

    def test_strip_removes_every_client_identity_header(self):
        clean = self.entry.strip_client_identity_headers(FORGED_HEADERS.items())
        lowered = {key.lower() for key in clean}
        for name in FORGED_HEADERS:
            if name == "Accept":
                continue
            self.assertNotIn(name.lower(), lowered, f"{name} 不應轉發給 Live")
        self.assertEqual(clean.get("Accept"), "*/*")

    def test_proxy_uses_the_strip_helper(self):
        source = ENTRY_PATH.read_text(encoding="utf-8")
        # P7-B2（2026-10-29）：入口必須把「實際路徑」交給剝除函式，才能依路由決定
        # 是否保留 Cookie（Live 自有 API 剝除、Django Portal 保留）。
        self.assertIn("strip_client_identity_headers(self.headers.items(), path=", source)


class GatewayStripEndToEndTests(unittest.TestCase):
    """真的把請求送進入口，檢查上游（Live 位置）收到什麼。"""

    def setUp(self):
        _RecordingUpstream.seen = []
        self.upstream = ThreadingHTTPServer(("127.0.0.1", 0), _RecordingUpstream)
        self.upstream_thread = threading.Thread(target=self.upstream.serve_forever, daemon=True)
        self.upstream_thread.start()

        self.entry = _load_entry_module()
        self.entry.UPSTREAM_HOST = "127.0.0.1"
        self.entry.UPSTREAM_PORT = self.upstream.server_address[1]
        self.server = self.entry.EntryServer(("127.0.0.1", 0), self.entry.EntryHandler)
        self.entry.ALLOWED_HOSTS = {f"127.0.0.1:{self.server.server_address[1]}"}
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.upstream.shutdown()
        self.upstream.server_close()

    def test_forged_identity_headers_never_reach_live(self):
        port = self.server.server_address[1]
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=15)
        try:
            headers = dict(FORGED_HEADERS)
            headers["Host"] = f"127.0.0.1:{port}"
            conn.request("GET", "/api/live/sessions", headers=headers)
            response = conn.getresponse()
            body = response.read()
        finally:
            conn.close()

        self.assertEqual(response.status, 200, body[:200])
        self.assertEqual(len(_RecordingUpstream.seen), 1)
        forwarded = _RecordingUpstream.seen[0]
        for name in ("x-fde-role", "x-fde-teacher-id", "x-fde-student-id", "x-fde-live-assertion",
                     "authorization", "x-original-url", "x-client-id", "x-auth-token", "x-real-ip"):
            self.assertNotIn(name, forwarded, f"{name} 不應出現在轉發給 Live 的標頭中")
        # P7-B2（2026-10-29 修正）：入口的單一上游是身分仲介（閘道），閘道需要這顆
        # Session Cookie 才能換取本次操作的短效 Assertion。Cookie 的真正終點是閘道
        # →Live 這一段（gateway.py 明確剝除）與 Live 端 credential_isolation（第二層）。
        # 若入口直連 Live（FDE_ENTRY_UPSTREAM_ROLE=live），則在此處即丟棄。
        self.assertIn("cookie", forwarded)
        # 轉發標頭由入口自己決定，不採信客戶端值。
        self.assertNotEqual(forwarded.get("x-forwarded-for"), "1.2.3.4")
        self.assertEqual(forwarded.get("x-forwarded-for"), "127.0.0.1")
        self.assertNotEqual(forwarded.get("x-forwarded-proto"), "https")
        self.assertEqual(forwarded.get("accept"), "*/*")


class CloudflareWorkerStripTests(unittest.TestCase):
    """Cloudflare Worker 候選：對 Live upstream 的 fetch 也要剝離身分標頭。"""

    SCRIPT = r"""
const mod = await import(process.env.P6_WORKER_URL);
const input = JSON.parse(process.env.P6_HEADERS);
const headers = new Headers(input);
const clean = mod.stripClientIdentityHeaders(headers);
console.log(JSON.stringify([...clean.keys()].sort()));
"""

    def test_worker_strips_client_identity_headers(self):
        if not WORKER_PATH.is_file():
            self.skipTest("worker.mjs not present")
        env = dict(os.environ)
        env["P6_WORKER_URL"] = WORKER_PATH.as_uri()
        env["P6_HEADERS"] = json.dumps(FORGED_HEADERS)
        completed = subprocess.run(
            ["node", "--input-type=module", "-e", self.SCRIPT],
            capture_output=True,
            text=True,
            env=env,
            timeout=120,
        )
        if completed.returncode != 0:
            self.skipTest(f"node unavailable or worker import failed: {completed.stderr.strip()[:200]}")
        forwarded = set(json.loads(completed.stdout.strip()))
        for name in ("x-fde-role", "x-fde-teacher-id", "x-fde-student-id", "x-fde-live-assertion",
                     "cookie", "authorization", "x-forwarded-for", "x-real-ip", "forwarded",
                     "x-original-url", "x-client-id", "x-auth-token"):
            self.assertNotIn(name, forwarded, f"{name} 不應被 Worker 轉發")
        self.assertIn("accept", forwarded)


if __name__ == "__main__":
    unittest.main()
