"""P3-D：身分閘道（Django Session → 短效 Assertion → Live）與拒絕路徑。"""

import importlib.util
import json
import time
import unittest
from pathlib import Path

import httpx
from starlette.testclient import TestClient

from app.gateway import GatewayConfig, IdentityGateway
from app.live_assertions import issue_live_assertion
from app.main import create_app
from app.sessions import InMemorySessionStore


ASSERTION_KEY = "p3d-gateway-assertion-key"
PROXY_KEY = "p3d-gateway-proxy-key"
GATEWAY_KEY = "p3d-gateway-internal-key"
DJANGO_ORIGIN = "http://django.test"
STUDENT_SUBJECT = "student:501"
STUDENT_ENROLLMENT = 77
STUDENT_COHORT = "cohort-a"


def _load_django_assertion_module():
    """直接以檔案載入 Django 端純標準庫實作，避免引入 Django 設定。"""
    path = Path(__file__).resolve().parents[2] / "student_portal" / "learning" / "live_assertions.py"
    spec = importlib.util.spec_from_file_location("p3d_django_live_assertions", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


DJANGO_ASSERTIONS = _load_django_assertion_module()


class OfflineVision:
    async def health(self):
        return False


def _student_claims():
    return {
        "sub": STUDENT_SUBJECT,
        "role": "student",
        "enrollment_id": STUDENT_ENROLLMENT,
        "cohort_ids": [STUDENT_COHORT],
    }


def _django_issue(claims):
    """模擬 Django `/api/live/auth/assertion/` 的簽發結果。"""
    return httpx.Response(200, json={"assertion": DJANGO_ASSERTIONS.issue_assertion(claims, ASSERTION_KEY), "expires_in": 60})


def _django_handler(request: httpx.Request) -> httpx.Response:
    """依真實 Django 契約回應：驗閘道金鑰、看 session cookie。"""
    if request.headers.get("X-FDE-Gateway-Auth") != GATEWAY_KEY:
        return httpx.Response(403, json={"error": "live_assertion_forbidden"})
    cookie = request.headers.get("Cookie", "")
    if "sessionid=" not in cookie:
        return httpx.Response(401, json={"authenticated": False})
    return _django_issue(_student_claims())


def _build(handler=_django_handler, *, config=None, transport=None):
    live_app = create_app(
        vision_adapter=OfflineVision(),
        session_store=InMemorySessionStore(),
        dev_mode=False,
        live_assertion_key=ASSERTION_KEY,
        trusted_proxy_key=PROXY_KEY,
        require_live_auth=True,
    )
    gateway_config = config or GatewayConfig(
        django_origin=DJANGO_ORIGIN,
        gateway_key=GATEWAY_KEY,
        proxy_key=PROXY_KEY,
        timeout_seconds=2.0,
    )
    transport = transport or httpx.MockTransport(handler)
    return TestClient(IdentityGateway(live_app, config=gateway_config, transport=transport))


def _signed_headers(subject=STUDENT_SUBJECT, role="student", cohort_ids=(STUDENT_COHORT,), enrollment_id=STUDENT_ENROLLMENT, now=None):
    claims = {"sub": subject, "role": role, "cohort_ids": list(cohort_ids)}
    if role == "student":
        claims["enrollment_id"] = enrollment_id
    token = issue_live_assertion(claims, ASSERTION_KEY) if now is None else issue_live_assertion(claims, ASSERTION_KEY, now=now)
    return {"X-FDE-Proxy-Auth": PROXY_KEY, "X-FDE-Live-Assertion": token}


class P3DGatewayIdentityTests(unittest.TestCase):
    """閘道是唯一身分來源；瀏覽器標頭一律不採用。"""

    def test_gateway_exchanges_django_session_for_signed_identity(self):
        client = _build()
        created = client.post("/api/live/sessions", json={}, headers={"Cookie": "sessionid=abc123; csrftoken=csrf456"})
        self.assertEqual(created.status_code, 201)
        session_id = created.json()["session_id"]
        owned = client.get(f"/api/live/sessions/{session_id}", headers={"Cookie": "sessionid=abc123; csrftoken=csrf456"})
        self.assertEqual(owned.status_code, 200)

    def test_gateway_strips_browser_forged_identity_headers(self):
        client = _build()
        forged = {
            "Cookie": "sessionid=abc123",
            "X-FDE-Role": "teacher",
            "X-FDE-Teacher-ID": "1",
            "X-FDE-Live-Assertion": "forged.token",
            "X-FDE-Proxy-Auth": "wrong-proxy-key",
        }
        created = client.post("/api/live/sessions", json={}, headers=forged)
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.json()["owner_subject"], STUDENT_SUBJECT)

    def test_gateway_rejects_request_without_session(self):
        client = _build()
        response = client.post("/api/live/sessions", json={}, headers={"Cookie": "csrftoken=csrf456"})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"]["code"], "live_session_required")

    def test_gateway_maps_django_forbidden_scope(self):
        def handler(request):
            return httpx.Response(403, json={"error": "live_enrollment_required"})

        client = _build(handler)
        response = client.post("/api/live/sessions", json={}, headers={"Cookie": "sessionid=abc123"})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "live_enrollment_required")

    def test_gateway_fails_closed_when_identity_provider_is_down(self):
        def handler(request):
            raise httpx.ConnectError("django down", request=request)

        client = _build(handler)
        response = client.post("/api/live/sessions", json={}, headers={"Cookie": "sessionid=abc123"})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"]["code"], "gateway_upstream_unavailable")

    def test_gateway_fails_closed_without_keys(self):
        calls = []

        def handler(request):
            calls.append(request)
            return _django_handler(request)

        client = _build(handler, config=GatewayConfig(django_origin=DJANGO_ORIGIN, gateway_key=GATEWAY_KEY, proxy_key=""))
        response = client.post("/api/live/sessions", json={}, headers={"Cookie": "sessionid=abc123"})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"]["code"], "gateway_misconfigured")
        self.assertEqual(calls, [])

    def test_health_endpoint_is_not_intercepted(self):
        calls = []

        def handler(request):
            calls.append(request)
            return _django_handler(request)

        client = _build(handler)
        response = client.get("/api/live/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(calls, [])

    def test_gateway_does_not_sign_assertions_and_ignores_h3_active_registry(self):
        source = (Path(__file__).resolve().parents[1] / "app" / "gateway.py").read_text(encoding="utf-8")
        self.assertNotIn("hmac", source)
        self.assertNotIn("hashlib", source)
        self.assertNotIn("ACTIVE_REGISTRY", source)


class P3DIdentityRejectionTests(unittest.TestCase):
    """Live 端對偽造、過期與越權身分的直接拒絕。"""

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

    def _create_session(self):
        created = self.client.post("/api/live/sessions", json={}, headers=_signed_headers())
        self.assertEqual(created.status_code, 201)
        return created.json()["session_id"]

    def test_forged_signature_is_rejected(self):
        claims = _student_claims()
        forged = {"X-FDE-Proxy-Auth": PROXY_KEY, "X-FDE-Live-Assertion": issue_live_assertion(claims, "attacker-key")}
        self.assertEqual(self.client.post("/api/live/sessions", json={}, headers=forged).status_code, 401)

    def test_expired_assertion_is_rejected(self):
        expired = _signed_headers(now=int(time.time()) - 300)
        self.assertEqual(self.client.post("/api/live/sessions", json={}, headers=expired).status_code, 401)

    def test_wrong_proxy_key_is_rejected(self):
        headers = _signed_headers()
        headers["X-FDE-Proxy-Auth"] = "wrong-proxy-key"
        self.assertEqual(self.client.post("/api/live/sessions", json={}, headers=headers).status_code, 403)

    def test_cross_student_session_read_is_rejected(self):
        session_id = self._create_session()
        attacker = _signed_headers(subject="student:999", enrollment_id=88)
        self.assertEqual(self.client.get(f"/api/live/sessions/{session_id}", headers=attacker).status_code, 403)

    def test_cross_cohort_teacher_read_is_rejected(self):
        session_id = self._create_session()
        teacher = _signed_headers(subject="teacher:3", role="teacher", cohort_ids=["cohort-b"])
        self.assertEqual(self.client.get(f"/api/live/sessions/{session_id}", headers=teacher).status_code, 403)

    def test_in_scope_teacher_can_read_session(self):
        session_id = self._create_session()
        teacher = _signed_headers(subject="teacher:3", role="teacher", cohort_ids=[STUDENT_COHORT])
        self.assertEqual(self.client.get(f"/api/live/sessions/{session_id}", headers=teacher).status_code, 200)

    def test_teacher_cannot_open_student_session(self):
        teacher = _signed_headers(subject="teacher:3", role="teacher", cohort_ids=[STUDENT_COHORT])
        response = self.client.post("/api/live/sessions", json={}, headers=teacher)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "live_student_required")

    def test_django_signed_assertion_is_accepted_by_live(self):
        """Django 端實作簽發的 token 必須能被 Live 端驗證（跨元件契約）。"""
        token = DJANGO_ASSERTIONS.issue_assertion(_student_claims(), ASSERTION_KEY)
        headers = {"X-FDE-Proxy-Auth": PROXY_KEY, "X-FDE-Live-Assertion": token}
        self.assertEqual(self.client.post("/api/live/sessions", json={}, headers=headers).status_code, 201)

    def test_assertion_payload_never_carries_django_secret(self):
        token = DJANGO_ASSERTIONS.issue_assertion(_student_claims(), ASSERTION_KEY)
        body, signature = token.split(".", 1)
        self.assertNotIn("password", json.dumps(body))
        self.assertTrue(signature)
