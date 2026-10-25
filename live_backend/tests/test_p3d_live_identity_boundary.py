"""P3-D：候選版 Live 身分邊界與直接來源拒絕。"""

import unittest

from starlette.testclient import TestClient

from app.live_assertions import issue_live_assertion
from app.main import create_app
from app.sessions import InMemorySessionStore


class OfflineVision:
    """只供 P3-D 隔離驗證使用。"""

    async def health(self):
        return False


class P3DLiveIdentityBoundaryTests(unittest.TestCase):
    """候選版不得接受瀏覽器自行宣稱的身份。"""

    def setUp(self):
        self.assertion_key = "p3d-isolated-assertion-key"
        self.proxy_key = "p3d-isolated-proxy-key"
        self.client = TestClient(create_app(
            vision_adapter=OfflineVision(),
            session_store=InMemorySessionStore(),
            dev_mode=True,
            live_assertion_key=self.assertion_key,
            trusted_proxy_key=self.proxy_key,
            require_live_auth=True,
        ))

    def _headers(self, subject="student:101", role="student", enrollment_id=201, cohort_ids=("cohort-a",)):
        claims = {"sub": subject, "role": role, "cohort_ids": list(cohort_ids)}
        if role == "student":
            claims["enrollment_id"] = enrollment_id
        return {
            "X-FDE-Proxy-Auth": self.proxy_key,
            "X-FDE-Live-Assertion": issue_live_assertion(claims, self.assertion_key),
        }

    def test_direct_live_request_requires_trusted_proxy_and_assertion(self):
        response = self.client.post("/api/live/sessions", json={"training_track": "F450_TWELVE_TASK"})
        self.assertEqual(response.status_code, 403)

    def test_student_session_is_bound_to_signed_owner_and_rejects_cross_student(self):
        owner_headers = self._headers()
        created = self.client.post("/api/live/sessions", json={"training_track": "F450_TWELVE_TASK"}, headers=owner_headers)
        self.assertEqual(created.status_code, 201)
        session_id = created.json()["session_id"]
        attacker_headers = self._headers(subject="student:102", enrollment_id=202)
        self.assertEqual(self.client.get(f"/api/live/sessions/{session_id}", headers=attacker_headers).status_code, 403)

    def test_production_mode_without_security_keys_fails_closed(self):
        client = TestClient(create_app(vision_adapter=OfflineVision(), session_store=InMemorySessionStore(), dev_mode=False))
        response = client.post("/api/live/sessions", json={"training_track": "F450_TWELVE_TASK"})
        self.assertEqual(response.status_code, 503)

    def test_django_contract_uses_integer_enrollment_identifier(self):
        headers = self._headers(enrollment_id=201)
        response = self.client.post("/api/live/sessions", json={"training_track": "F450_TWELVE_TASK"}, headers=headers)
        self.assertEqual(response.status_code, 201)
