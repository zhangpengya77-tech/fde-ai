"""P3-F（2026-10-25）：公開入口（`demo/tools/static_entry_server.py`）的
Host 白名單與 `X-Forwarded-Proto` 信任邊界測試。

為什麼需要這一層的測試：

  * 入口在轉發前會把 `Host` 改寫成上游位址，因此上游 Django 的 `ALLOWED_HOSTS`
    **永遠看不到**瀏覽器送來的 Host。偽造 Host 是否被拒絕，只能在入口判定。
  * 舊版入口把 `X-Forwarded-Proto` 設成「客戶端自帶值 or `https`」：
      - 客戶端自帶 `X-Forwarded-Proto: https` 即可把純 HTTP 連線偽造成 HTTPS；
      - 沒帶時預設 `https`，使純 HTTP 部署被誤標為 HTTPS（SSL redirect 失效）。

全部離線：以子進程啟動真實入口（隨機埠），上游用本檔內的記錄型 HTTP 伺服器，
不接觸任何既有服務、正式資料或網路外部位址。
"""

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


def _header(headers: dict, name: str) -> str:
    for key, value in headers.items():
        if key.lower() == name:
            return str(value).strip().lower()
    return ""


def _wait_port(port: int, timeout: float = 15.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.3)
            if sock.connect_ex(("127.0.0.1", port)) == 0:
                return True
        time.sleep(0.05)
    return False


class _RecordingUpstream:
    """記錄最後一次請求標頭的假上游（不解析 body，直接回 200）。"""

    def __init__(self) -> None:
        self.requests: list[dict] = []
        recorder = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def _handle(self) -> None:  # noqa: D401
                recorder.requests.append(
                    {
                        "method": self.command,
                        "path": self.path,
                        "headers": {k.lower(): v for k, v in self.headers.items()},
                    }
                )
                body = json.dumps({"ok": True}).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(body)

            do_GET = _handle
            do_POST = _handle

            def log_message(self, *_args) -> None:  # 靜音
                return

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = int(self.server.server_address[1])
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    @property
    def last(self) -> dict:
        return self.requests[-1] if self.requests else {}

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


class _EntryProcess:
    """以子進程啟動真實入口；退出時確保終止。"""

    def __init__(self, *, upstream_port: int, extra_env: dict | None = None) -> None:
        self.port = _free_port()
        env = os.environ.copy()
        env.update(
            {
                "FDE_ENTRY_BIND": "127.0.0.1",
                "FDE_ENTRY_PORT": str(self.port),
                "FDE_ENTRY_UPSTREAM_HOST": "127.0.0.1",
                "FDE_ENTRY_UPSTREAM_PORT": str(upstream_port),
                "FDE_ENTRY_UPSTREAM_TIMEOUT": "5",
                "FDE_ENTRY_ALLOWED_HOSTS": f"127.0.0.1:{self.port},localhost",
                "FDE_ENTRY_TRUSTED_ORIGINS": f"http://127.0.0.1:{self.port}",
                "FDE_ENTRY_DJANGO_HOST": "127.0.0.1",
                "FDE_ENTRY_DJANGO_PORT": "1",
                "FDE_ENTRY_FH_HOST": "127.0.0.1",
                "FDE_ENTRY_FH_PORT": "1",
            }
        )
        for name in ("FDE_ENTRY_PUBLIC_SCHEME",):
            env.pop(name, None)
        if extra_env:
            env.update(extra_env)
        self.proc = subprocess.Popen(
            [sys.executable, str(ENTRY_SERVER)],
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    def __enter__(self) -> "_EntryProcess":
        if not _wait_port(self.port):
            self.__exit__(None, None, None)
            raise AssertionError("入口伺服器未在時限內啟動")
        return self

    def __exit__(self, *_exc) -> None:
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=10)

    def request(self, method: str, path: str, headers: dict | None = None, body: bytes | None = None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            conn.request(method, path, body=body, headers=headers or {})
            response = conn.getresponse()
            payload = response.read()
            return response.status, payload, dict(response.getheaders())
        finally:
            conn.close()


class EntryHostAllowlistTests(unittest.TestCase):
    """未授權 Host 必須在入口就被拒絕（回 400），且不得轉發給上游。"""

    @classmethod
    def setUpClass(cls) -> None:
        cls.upstream = _RecordingUpstream()
        cls.entry = _EntryProcess(upstream_port=cls.upstream.port).__enter__()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.entry.__exit__(None, None, None)
        cls.upstream.close()

    def test_forged_host_is_rejected_with_400(self):
        status, payload, _ = self.entry.request(
            "GET", "/login/", {"Host": "evil.example.test"}
        )
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(payload)["error"]["code"], "host_not_allowed")

    def test_forged_host_is_not_forwarded_upstream(self):
        before = len(self.upstream.requests)
        self.entry.request("GET", "/login/", {"Host": "evil.example.test"})
        self.assertEqual(len(self.upstream.requests), before, "未授權 Host 不得到達上游")

    def test_host_gate_runs_before_origin_gate(self):
        # 同時偽造 Host 與 Origin：必須是 400（Host 先判），不能是 403。
        status, payload, _ = self.entry.request(
            "POST",
            "/login/",
            {"Host": "evil.example.test", "Origin": "http://evil.example.test"},
            body=b"",
        )
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(payload)["error"]["code"], "host_not_allowed")

    def test_host_gate_covers_special_paths(self):
        # /favicon.ico 走的是「不轉發」的特別分支，同樣必須受 Host 白名單約束。
        status, _, _ = self.entry.request("GET", "/favicon.ico", {"Host": "evil.example.test"})
        self.assertEqual(status, 400)
        status_ok, _, _ = self.entry.request(
            "GET", "/favicon.ico", {"Host": f"127.0.0.1:{self.entry.port}"}
        )
        self.assertEqual(status_ok, 204)

    def test_allowed_host_reaches_upstream(self):
        status, _, _ = self.entry.request(
            "GET", "/login/", {"Host": f"127.0.0.1:{self.entry.port}"}
        )
        self.assertEqual(status, 200)
        self.assertEqual(self.upstream.last.get("path"), "/login/")

    def test_origin_gate_still_applies_to_allowed_host(self):
        status, payload, _ = self.entry.request(
            "POST",
            "/login/",
            {"Host": f"127.0.0.1:{self.entry.port}", "Origin": "http://evil.example.test"},
            body=b"",
        )
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(payload)["error"]["code"], "origin_not_allowed")

    def test_host_rejection_closes_connection(self):
        # 拒絕時不讀取請求體，若不關閉連線，殘留 body 會被當成下一個請求的開頭
        # （實測：同一條 keep-alive 連線上的下一個 POST 被誤判為 501）。
        status, _, headers = self.entry.request(
            "POST", "/login/", {"Host": "evil.example.test"}, body=b"username=a&password=b"
        )
        self.assertEqual(status, 400)
        self.assertEqual(_header(headers, "connection"), "close")

    def test_origin_rejection_closes_connection(self):
        status, _, headers = self.entry.request(
            "POST",
            "/login/",
            {
                "Host": f"127.0.0.1:{self.entry.port}",
                "Origin": "http://evil.example.test",
            },
            body=b"username=a&password=b",
        )
        self.assertEqual(status, 403)
        self.assertEqual(_header(headers, "connection"), "close")


class EntryForwardedProtoTests(unittest.TestCase):
    """`X-Forwarded-Proto` 必須由入口決定，不採信客戶端。"""

    @classmethod
    def setUpClass(cls) -> None:
        cls.upstream = _RecordingUpstream()
        cls.entry = _EntryProcess(upstream_port=cls.upstream.port).__enter__()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.entry.__exit__(None, None, None)
        cls.upstream.close()

    def test_default_forwarded_proto_is_http(self):
        self.entry.request("GET", "/login/", {"Host": f"127.0.0.1:{self.entry.port}"})
        self.assertEqual(self.upstream.last["headers"].get("x-forwarded-proto"), "http")

    def test_client_supplied_https_is_not_trusted(self):
        self.entry.request(
            "GET",
            "/login/",
            {
                "Host": f"127.0.0.1:{self.entry.port}",
                "X-Forwarded-Proto": "https",
            },
        )
        self.assertEqual(self.upstream.last["headers"].get("x-forwarded-proto"), "http")

    def test_client_supplied_forwarded_headers_are_stripped(self):
        self.entry.request(
            "GET",
            "/login/",
            {
                "Host": f"127.0.0.1:{self.entry.port}",
                "X-Forwarded-For": "6.6.6.6",
                "X-Forwarded-Host": "evil.example.test",
                "X-Real-IP": "6.6.6.6",
                "Forwarded": "for=6.6.6.6;proto=https",
            },
        )
        headers = self.upstream.last["headers"]
        self.assertEqual(headers.get("x-forwarded-for"), "127.0.0.1")
        self.assertEqual(headers.get("x-forwarded-host"), f"127.0.0.1:{self.entry.port}")
        self.assertNotIn("x-real-ip", headers)
        self.assertNotIn("forwarded", headers)


class EntryPublicSchemeTests(unittest.TestCase):
    """只有明確聲明「位於可信 TLS 終結器之後」時，才標記為 https。"""

    def test_explicit_https_public_scheme_marks_upstream_https(self):
        upstream = _RecordingUpstream()
        try:
            with _EntryProcess(
                upstream_port=upstream.port,
                extra_env={"FDE_ENTRY_PUBLIC_SCHEME": "https"},
            ) as entry:
                entry.request("GET", "/login/", {"Host": f"127.0.0.1:{entry.port}"})
            self.assertEqual(upstream.last["headers"].get("x-forwarded-proto"), "https")
        finally:
            upstream.close()

    def test_invalid_public_scheme_fails_startup(self):
        upstream = _RecordingUpstream()
        try:
            port = _free_port()
            env = os.environ.copy()
            env.update(
                {
                    "FDE_ENTRY_BIND": "127.0.0.1",
                    "FDE_ENTRY_PORT": str(port),
                    "FDE_ENTRY_UPSTREAM_PORT": str(upstream.port),
                    "FDE_ENTRY_PUBLIC_SCHEME": "ftp",
                }
            )
            result = subprocess.run(
                [sys.executable, str(ENTRY_SERVER)],
                env=env,
                capture_output=True,
                text=True,
                timeout=30,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("FDE_ENTRY_PUBLIC_SCHEME", result.stderr)
        finally:
            upstream.close()


class EntryAllowedHostConfigTests(unittest.TestCase):
    """白名單設定本身 fail closed：不允許萬用字元。"""

    def test_wildcard_allowed_hosts_fails_startup(self):
        port = _free_port()
        env = os.environ.copy()
        env.update(
            {
                "FDE_ENTRY_BIND": "127.0.0.1",
                "FDE_ENTRY_PORT": str(port),
                "FDE_ENTRY_ALLOWED_HOSTS": "*",
            }
        )
        result = subprocess.run(
            [sys.executable, str(ENTRY_SERVER)],
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("FDE_ENTRY_ALLOWED_HOSTS", result.stderr)


if __name__ == "__main__":
    unittest.main()
