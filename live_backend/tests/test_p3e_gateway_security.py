"""P3-E（2026-10-25）：Gateway 安全驗收的補充測試。

P3-D 的 `test_p3d_gateway_identity.py` 已覆蓋正向交換與主要拒絕路徑；本檔補上
P3-E 要求的四類「邊界與資訊外洩」驗證：

  1. 閘道不簽發 Assertion（原始碼層面即無簽章能力）。
  2. 瀏覽器提供的內部金鑰（X-FDE-Gateway-Auth）不被採用、也不被轉送下游。
  3. 閘道不把內部 URL／埠／金鑰洩漏到任何錯誤回應。
  4. 正式模式不存在 P1 角色回退（偽造 X-FDE-Role 不改變任何授權結果）。

全部離線：httpx.MockTransport 模擬 Django，下游用記錄型 ASGI app 或隔離 Live。
"""

import inspect
import unittest

import httpx
from starlette.responses import Response
from starlette.testclient import TestClient

from app import gateway as gateway_module
from app.gateway import CLIENT_IDENTITY_HEADERS, GatewayConfig, IdentityGateway
from app.live_assertions import issue_live_assertion
from app.main import create_app
from app.sessions import InMemorySessionStore


ASSERTION_KEY = "p3e-assertion-key"
PROXY_KEY = "p3e-proxy-key"
GATEWAY_KEY = "p3e-gateway-internal-key"
DJANGO_ORIGIN = "http://django.internal:8022"
# P7-B3：閘道送給 Django 的 Origin 必須是對外入口位址（在 CSRF_TRUSTED_ORIGINS 內）。
PUBLIC_ORIGIN = "https://entry.test"
STUDENT_SUBJECT = "student:601"
STUDENT_ENROLLMENT = 88
STUDENT_COHORT = "cohort-p3e"


def _claims(subject=STUDENT_SUBJECT, role="student"):
    payload = {"sub": subject, "role": role, "cohort_ids": [STUDENT_COHORT]}
    if role == "student":
        payload["enrollment_id"] = STUDENT_ENROLLMENT
    return payload


def _issue(claims):
    return httpx.Response(200, json={"assertion": issue_live_assertion(claims, ASSERTION_KEY), "expires_in": 60})


def _django_ok(request: httpx.Request) -> httpx.Response:
    if request.headers.get("X-FDE-Gateway-Auth") != GATEWAY_KEY:
        return httpx.Response(403, json={"error": "live_assertion_forbidden"})
    if "sessionid=" not in request.headers.get("Cookie", ""):
        return httpx.Response(401, json={"authenticated": False})
    return _issue(_claims())


class _RecordingApp:
    """記錄閘道實際轉送給下游的 scope（用來檢查標頭增刪）。"""

    def __init__(self):
        self.scopes = []

    async def __call__(self, scope, receive, send):
        self.scopes.append(scope)
        await Response("downstream-ok", status_code=200)(scope, receive, send)

    def forwarded_headers(self, index=-1):
        return {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in self.scopes[index]["headers"]}


def _gateway(downstream, *, handler=_django_ok, config=None):
    return TestClient(
        IdentityGateway(
            downstream,
            config=config
            or GatewayConfig(
                django_origin=DJANGO_ORIGIN, gateway_key=GATEWAY_KEY, proxy_key=PROXY_KEY,
                timeout_seconds=2.0, csrf_origin=PUBLIC_ORIGIN,
            ),
            transport=httpx.MockTransport(handler),
        )
    )


class GatewayDoesNotSignTests(unittest.TestCase):
    """閘道只能轉發 Django 簽發的 Assertion，本身不具備簽章能力。"""

    def test_gateway_source_has_no_signing_capability(self):
        source = inspect.getsource(gateway_module)
        for forbidden in ("hmac", "hashlib", "issue_live_assertion", "issue_assertion", "secret"):
            self.assertNotIn(forbidden, source.lower(), f"gateway 不應具備簽章能力，但出現 {forbidden!r}")

    def test_assertion_is_taken_verbatim_from_django(self):
        downstream = _RecordingApp()
        client = _gateway(downstream)
        response = client.post(
            "/api/live/sessions",
            json={},
            headers={"Cookie": "sessionid=abc; csrftoken=tok"},
        )
        self.assertEqual(response.status_code, 200)
        token = downstream.forwarded_headers()["x-fde-live-assertion"]
        from app.live_assertions import verify_live_assertion

        self.assertEqual(verify_live_assertion(token, ASSERTION_KEY)["sub"], STUDENT_SUBJECT)

    def test_django_returning_no_assertion_fails_closed(self):
        downstream = _RecordingApp()
        client = _gateway(downstream, handler=lambda request: httpx.Response(200, json={}))
        response = client.post("/api/live/sessions", json={}, headers={"Cookie": "sessionid=abc"})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"]["code"], "gateway_identity_unavailable")
        self.assertEqual(downstream.scopes, [])


class BrowserCannotSupplyInternalCredentialsTests(unittest.TestCase):
    """瀏覽器送來的內部金鑰／身分標頭一律不採用、也不轉送下游。"""

    def test_browser_gateway_key_is_replaced_by_configured_key(self):
        seen = {}

        def handler(request):
            seen["gateway_auth"] = request.headers.get("X-FDE-Gateway-Auth")
            return _django_ok(request)

        client = _gateway(_RecordingApp(), handler=handler)
        response = client.post(
            "/api/live/sessions",
            json={},
            headers={
                "Cookie": "sessionid=abc",
                "X-FDE-Gateway-Auth": "attacker-supplied-key",
                "X-FDE-Role": "teacher",
                "X-FDE-Teacher-ID": "1",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(seen["gateway_auth"], GATEWAY_KEY)

    def test_browser_identity_headers_are_not_forwarded_downstream(self):
        downstream = _RecordingApp()
        client = _gateway(downstream)
        forged_assertion = issue_live_assertion(_claims("student:999", "teacher"), ASSERTION_KEY)
        response = client.post(
            "/api/live/sessions",
            json={},
            headers={
                "Cookie": "sessionid=abc",
                "X-FDE-Proxy-Auth": "browser-proxy-key",
                "X-FDE-Live-Assertion": forged_assertion,
                "X-FDE-Role": "teacher",
                "X-FDE-Teacher-ID": "1",
                "X-FDE-Gateway-Auth": GATEWAY_KEY,
            },
        )
        self.assertEqual(response.status_code, 200)
        headers = downstream.forwarded_headers()
        for name in CLIENT_IDENTITY_HEADERS:
            self.assertNotEqual(
                headers.get(name), "browser-proxy-key", f"{name} 不應保留瀏覽器提供的值"
            )
        self.assertEqual(headers["x-fde-proxy-auth"], PROXY_KEY)
        self.assertNotEqual(headers["x-fde-live-assertion"], forged_assertion)
        self.assertNotIn("x-fde-role", headers)
        self.assertNotIn("x-fde-teacher-id", headers)

    def test_missing_gateway_key_config_never_calls_django(self):
        calls = []
        config = GatewayConfig(django_origin=DJANGO_ORIGIN, gateway_key="", proxy_key=PROXY_KEY, timeout_seconds=2.0)
        client = _gateway(_RecordingApp(), handler=lambda request: calls.append(1) or _django_ok(request), config=config)
        response = client.post(
            "/api/live/sessions",
            json={},
            headers={"Cookie": "sessionid=abc", "X-FDE-Gateway-Auth": GATEWAY_KEY},
        )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"]["code"], "gateway_misconfigured")
        self.assertEqual(calls, [])

    def test_missing_proxy_key_config_fails_closed(self):
        config = GatewayConfig(django_origin=DJANGO_ORIGIN, gateway_key=GATEWAY_KEY, proxy_key="", timeout_seconds=2.0)
        client = _gateway(_RecordingApp(), config=config)
        response = client.post("/api/live/sessions", json={}, headers={"Cookie": "sessionid=abc"})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"]["code"], "gateway_misconfigured")


class NoInternalDetailLeakTests(unittest.TestCase):
    """任何錯誤回應都不得出現內部主機、埠位或金鑰。"""

    SECRETS = ("django.internal", "8022", GATEWAY_KEY, PROXY_KEY, ASSERTION_KEY, "127.0.0.1")

    def _assert_clean(self, response):
        body = response.text
        for secret in self.SECRETS:
            self.assertNotIn(secret, body, f"錯誤回應洩漏內部資訊：{secret!r}")

    def test_misconfigured_response_is_clean(self):
        config = GatewayConfig(django_origin=DJANGO_ORIGIN, gateway_key="", proxy_key="", timeout_seconds=2.0)
        self._assert_clean(_gateway(_RecordingApp(), config=config).post("/api/live/sessions", json={}))

    def test_upstream_down_response_is_clean(self):
        def boom(request):
            raise httpx.ConnectError("connection refused", request=request)

        response = _gateway(_RecordingApp(), handler=boom).post(
            "/api/live/sessions", json={}, headers={"Cookie": "sessionid=abc"}
        )
        self.assertEqual(response.status_code, 503)
        self._assert_clean(response)

    def test_session_required_response_is_clean(self):
        def unauth(request):
            return httpx.Response(401, json={"authenticated": False})

        response = _gateway(_RecordingApp(), handler=unauth).post(
            "/api/live/sessions", json={}, headers={"Cookie": "sessionid=abc"}
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"]["code"], "live_session_required")
        self._assert_clean(response)

    def test_forbidden_response_is_clean(self):
        def forbidden(request):
            return httpx.Response(403, json={"error": "live_assertion_forbidden"})

        response = _gateway(_RecordingApp(), handler=forbidden).post(
            "/api/live/sessions", json={}, headers={"Cookie": "sessionid=abc"}
        )
        self.assertEqual(response.status_code, 403)
        self._assert_clean(response)

    def test_no_assertion_response_is_clean(self):
        response = _gateway(_RecordingApp(), handler=lambda request: httpx.Response(200, json={})).post(
            "/api/live/sessions", json={}, headers={"Cookie": "sessionid=abc"}
        )
        self.assertEqual(response.status_code, 503)
        self._assert_clean(response)


class OfflineVision:
    async def health(self):
        return False


class NoRoleFallbackInSecureModeTests(unittest.TestCase):
    """正式模式只採用簽章身分；偽造 X-FDE-Role 不得提升任何權限。"""

    def setUp(self):
        self.client = TestClient(
            create_app(
                vision_adapter=OfflineVision(),
                session_store=InMemorySessionStore(),
                dev_mode=False,
                live_assertion_key=ASSERTION_KEY,
                trusted_proxy_key=PROXY_KEY,
                require_live_auth=True,
            )
        )

    def _headers(self, subject, enrollment_id, role="student"):
        claims = {"sub": subject, "role": role, "cohort_ids": [STUDENT_COHORT], "enrollment_id": enrollment_id}
        return {
            "X-FDE-Proxy-Auth": PROXY_KEY,
            "X-FDE-Live-Assertion": issue_live_assertion(claims, ASSERTION_KEY),
        }

    def test_forged_role_header_does_not_grant_cross_student_access(self):
        owner = self._headers("student:601", 88)
        created = self.client.post("/api/live/sessions", json={"training_track": "F450_TWELVE_TASK"}, headers=owner)
        self.assertEqual(created.status_code, 201)
        session_id = created.json()["session_id"]

        attacker = self._headers("student:602", 89)
        attacker.update({"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": "student:601"})
        response = self.client.get(f"/api/live/sessions/{session_id}", headers=attacker)
        self.assertEqual(response.status_code, 403)

    def test_forged_role_header_without_assertion_is_rejected(self):
        response = self.client.post(
            "/api/live/sessions",
            json={"training_track": "F450_TWELVE_TASK"},
            headers={"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": "1", "X-FDE-Proxy-Auth": PROXY_KEY},
        )
        # 有 proxy key 但缺簽章 Assertion → 身分不成立（401），絕不退化成信任 X-FDE-Role。
        self.assertIn(response.status_code, (401, 403))
        self.assertNotIn("session_id", response.text)

    def test_production_mode_without_keys_fails_closed(self):
        client = TestClient(create_app(vision_adapter=OfflineVision(), session_store=InMemorySessionStore(), dev_mode=False))
        response = client.post(
            "/api/live/sessions",
            json={"training_track": "F450_TWELVE_TASK"},
            headers={"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": "1"},
        )
        self.assertEqual(response.status_code, 503)
