"""P7-B2 驗收：Cookie 依實際路由分流，不全域剝除。

批准令要求：
* Django Portal → 保留合法瀏覽器 Session Cookie；
* Live 內部 API → 剝除瀏覽器 Cookie 與偽造身分標頭；
* 不得全域剝除 Cookie（會破壞登入）；
* 不得把瀏覽器 Session Cookie 轉發給不需要它的 Live 服務。

三層各測一次：入口（static_entry_server）、Live 中介層（credential_isolation）、
以及兩者串起來的端到端效果。
"""

from __future__ import annotations

import http.client
import importlib.util
import json
import os
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

import httpx

from app.credential_isolation import ClientCredentialIsolation, is_portal_route
from app.gateway import GatewayConfig, IdentityGateway


REPO = Path(__file__).resolve().parents[2]
ENTRY_PATH = REPO / "demo" / "tools" / "static_entry_server.py"

COOKIE = "sessionid=real-browser-session; csrftoken=csrf-secret"


def _load_entry_module(port: int, upstream_port: int):
    """以獨立模組載入入口伺服器（它會在 import 時讀環境變數）。"""
    os.environ["FDE_ENTRY_UPSTREAM_HOST"] = "127.0.0.1"
    os.environ["FDE_ENTRY_UPSTREAM_PORT"] = str(upstream_port)
    os.environ["FDE_ENTRY_ALLOWED_HOSTS"] = f"127.0.0.1:{port},127.0.0.1"
    spec = importlib.util.spec_from_file_location(f"_entry_{port}", ENTRY_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class _Recorder(BaseHTTPRequestHandler):
    """假上游：把收到的標頭記錄下來並回 200。"""

    seen: list[dict] = []

    def do_GET(self):  # noqa: N802
        type(self).seen.append({k.lower(): v for k, v in self.headers.items()})
        body = b'{"ok":true}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_POST = do_GET

    def log_message(self, *_args):
        pass


# ---------------------------------------------------------------- 入口層
class EntryCookieRoutingTests(unittest.TestCase):
    """入口層：Live API 剝 Cookie、Portal 保留 Cookie。"""

    @classmethod
    def setUpClass(cls):
        _Recorder.seen = []
        cls.upstream = ThreadingHTTPServer(("127.0.0.1", 0), _Recorder)
        cls.upstream_port = cls.upstream.server_address[1]
        threading.Thread(target=cls.upstream.serve_forever, daemon=True).start()

        cls.entry = ThreadingHTTPServer(("127.0.0.1", 0), None)
        cls.port = cls.entry.server_address[1]
        cls.entry.server_close()
        cls.module = _load_entry_module(cls.port, cls.upstream_port)
        cls.server = cls.module.EntryServer(("127.0.0.1", cls.port), cls.module.EntryHandler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.upstream.shutdown()
        cls.upstream.server_close()

    def _get(self, path: str) -> dict:
        _Recorder.seen = []
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=15)
        try:
            conn.request(
                "GET",
                path,
                headers={
                    "Host": f"127.0.0.1:{self.port}",
                    "Cookie": COOKIE,
                    "X-FDE-Role": "teacher",
                    "X-FDE-Teacher-ID": "1",
                },
            )
            response = conn.getresponse()
            response.read()
        finally:
            conn.close()
        self.assertEqual(len(_Recorder.seen), 1, "上游應收到恰好一次請求")
        return _Recorder.seen[0]

    def test_b2_1_api_route_keeps_cookie_for_the_gateway(self):
        """入口的單一上游是身分仲介（閘道），閘道要靠這顆 Cookie 才能換 Assertion。

        2026-10-29 實測：若入口在此處丟 Cookie，合法學員經 HTTPS 入口提交
        `POST /api/v1/vision/submissions` 會得到 403 `internal_auth_rejected`。
        真正的界線是「Cookie 絕不抵達 Live」，見 test_b2_2 與 test_b2_12。
        """
        forwarded = self._get("/api/v1/vision/submissions")
        self.assertEqual(forwarded.get("cookie"), COOKIE, "閘道必須拿到 Session Cookie 才能換票")

    def test_b2_2_api_route_drops_cookie_when_upstream_is_live(self):
        """入口直連 Live（無仲介可換票）時，Cookie 對 Live 毫無用處且屬憑證外洩。"""
        for path in ("/api/v1/vision/submissions", "/api/live/sessions", "/api/rc/anything"):
            with self.subTest(path=path):
                forwarded = self.module.strip_client_identity_headers(
                    {"Cookie": COOKIE, "X-FDE-Role": "teacher"},
                    path=path,
                    upstream_role="live",
                )
                self.assertNotIn("Cookie", forwarded, "直連 Live 時不得轉發瀏覽器 Cookie")
                self.assertNotIn("X-FDE-Role", forwarded)

    def test_b2_3_portal_route_preserves_browser_cookie(self):
        forwarded = self._get("/teacher/login/")
        self.assertEqual(forwarded.get("cookie"), COOKIE, "Django Portal 必須保留 Session Cookie")

    def test_b2_4_portal_pages_preserve_cookie(self):
        # 注意：`/` 與既有靜態檔由入口自己回應，不會轉發到上游，故不列入此測試。
        for path in ("/platform/", "/login/", "/student/growth/"):
            with self.subTest(path=path):
                forwarded = self._get(path)
                self.assertEqual(forwarded.get("cookie"), COOKIE)

    def test_b2_5_forged_identity_headers_stripped_on_every_route(self):
        for path in ("/api/v1/vision/submissions", "/teacher/login/", "/platform/"):
            with self.subTest(path=path):
                forwarded = self._get(path)
                self.assertNotIn("x-fde-role", forwarded)
                self.assertNotIn("x-fde-teacher-id", forwarded)


# ---------------------------------------------------------------- Live 層
class LiveCredentialIsolationTests(unittest.TestCase):
    """Live 中介層：即使入口失效，Live 業務處理器仍看不到瀏覽器憑證。"""

    PROXY_KEY = "p7-b2-proxy-key"

    def _app(self, *, proxy_key=None):
        seen = {}

        async def handler(request):
            seen.update({k.lower(): v for k, v in request.headers.items()})
            return JSONResponse({"path": request.url.path})

        app = Starlette(
            routes=[
                Route("/api/v1/vision/submissions", handler, methods=["GET", "POST"]),
                Route("/api/live/sessions", handler),
                Route("/teacher/login/", handler, methods=["GET", "POST"]),
                Route("/login/", handler, methods=["GET", "POST"]),
            ]
        )
        app.add_middleware(
            ClientCredentialIsolation,
            proxy_key=self.PROXY_KEY if proxy_key is None else proxy_key,
        )
        return app, seen

    def test_b2_6_live_route_drops_cookie(self):
        app, seen = self._app()
        client = TestClient(app)
        response = client.get("/api/v1/vision/submissions", headers={"Cookie": COOKIE})
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("cookie", seen)

    def test_b2_7_portal_route_keeps_cookie(self):
        app, seen = self._app()
        client = TestClient(app)
        client.get("/teacher/login/", headers={"Cookie": COOKIE})
        self.assertEqual(seen.get("cookie"), COOKIE)

    def test_b2_8_untrusted_identity_headers_dropped(self):
        app, seen = self._app()
        client = TestClient(app)
        client.post(
            "/api/v1/vision/submissions",
            headers={
                "Cookie": COOKIE,
                "X-FDE-Role": "teacher",
                "X-FDE-Teacher-ID": "1",
                "X-FDE-Live-Assertion": "v1.forged.sig",
            },
        )
        self.assertNotIn("x-fde-role", seen, "不可驗證的自稱角色必須丟棄")
        self.assertNotIn("x-fde-teacher-id", seen)
        # 偽造票不在此層丟棄（Django 直連 Live 的合法票不帶 proxy key），
        # 而是交由 internal_auth 的 HMAC 驗章拒絕；見 test_p7_b6 / p6 assertion 套件。
        self.assertEqual(seen.get("x-fde-live-assertion"), "v1.forged.sig")

    def test_b2_9_gateway_assertion_is_preserved(self):
        app, seen = self._app()
        client = TestClient(app)
        client.post(
            "/api/v1/vision/submissions",
            headers={
                "Cookie": COOKIE,
                "X-FDE-Proxy-Auth": self.PROXY_KEY,
                "X-FDE-Live-Assertion": "v1.real.sig",
                "X-FDE-Role": "teacher",
            },
        )
        self.assertEqual(seen.get("x-fde-live-assertion"), "v1.real.sig")
        self.assertEqual(seen.get("x-fde-proxy-auth"), self.PROXY_KEY)
        self.assertNotIn("x-fde-role", seen, "閘道也不能夾帶偽造角色標頭")
        self.assertNotIn("cookie", seen)

    def test_b2_10_assertion_without_proxy_key_is_still_forwarded(self):
        """Django 直連 Live 的內部呼叫不帶 proxy key；Assertion 必須保留給下游驗章。"""
        app, seen = self._app()
        client = TestClient(app)
        client.post(
            "/api/v1/vision/submissions",
            headers={"X-FDE-Live-Assertion": "v1.real.sig"},
        )
        self.assertEqual(seen.get("x-fde-live-assertion"), "v1.real.sig")
        self.assertNotIn("cookie", seen)

    def test_b2_11_portal_prefixes_are_exhaustive_against_main_routes(self):
        """Portal 前綴必須覆蓋 main.py 實際掛給 django_portal_proxy 的路徑。"""
        source = (REPO / "live_backend" / "app" / "main.py").read_text(encoding="utf-8")
        portal_paths = []
        for line in source.splitlines():
            if "django_portal_proxy" not in line or "Route(" not in line:
                continue
            start = line.find('"')
            end = line.find('"', start + 1)
            if start != -1 and end != -1:
                portal_paths.append(line[start + 1 : end])
        self.assertTrue(portal_paths, "應能找到 django_portal_proxy 的路由")
        for path in portal_paths:
            probe = path.replace("{portal_path:path}", "x")
            with self.subTest(route=path):
                self.assertTrue(is_portal_route(probe), f"{path} 必須被視為 Portal 路由")


# ---------------------------------------------------------------- 閘道 → Live
class GatewayCookieBoundaryTests(unittest.TestCase):
    """閘道是 Cookie 的終點：換完票就把瀏覽器憑證留在閘道，不帶進 Live。"""

    def test_b2_12_gateway_does_not_forward_browser_cookie_to_live(self):
        seen: dict = {}

        async def handler(request):
            seen.update({key.lower(): value for key, value in request.headers.items()})
            return JSONResponse({"ok": True})

        live_app = Starlette(
            routes=[Route("/api/v1/vision/submissions", handler, methods=["POST"])]
        )

        def django_handler(request):
            # 閘道必須帶著 Cookie 去換票，否則這裡就拿不到 session。
            assert "sessionid=" in request.headers.get("Cookie", "")
            return httpx.Response(200, json={"assertion": "v1.signed.token", "expires_in": 60})

        config = GatewayConfig(
            django_origin="http://django.test",
            gateway_key="gw-key",
            proxy_key="proxy-key",
            timeout_seconds=2.0,
            csrf_origin="https://entry.test",
        )
        client = TestClient(
            IdentityGateway(live_app, config=config, transport=httpx.MockTransport(django_handler))
        )
        response = client.post(
            "/api/v1/vision/submissions",
            json={"task_id": "PROP_DIRECTION"},
            headers={"Cookie": COOKIE, "Origin": "https://entry.test"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn("cookie", seen, "Live 絕不可看到瀏覽器 Session Cookie")
        self.assertEqual(seen.get("x-fde-live-assertion"), "v1.signed.token")
        self.assertEqual(seen.get("x-fde-proxy-auth"), "proxy-key")
