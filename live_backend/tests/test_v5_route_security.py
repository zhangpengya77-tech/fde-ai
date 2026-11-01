"""V5 路由的身分邊界與推論失敗回應；模型推論以替身取代，只測授權與錯誤契約。"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from starlette.applications import Starlette
from starlette.testclient import TestClient

from app.prop_rotation_service import PropRotationServiceError
from app.rotation_sandbox import RotationSandboxError
from app.vision_api import vision_routes
from app.vision_center import VisionCenter
from p6_signed_client import install_identity_env, signed_teacher_client

IMAGE = {"image_base64": "AAAA"}


class StubTrial:
    def __init__(self):
        self.error = None
        self.activated = False

    def student_infer(self, **_kwargs):
        if self.error:
            raise self.error
        return {"detections": []}

    run_teacher_validation = student_infer

    def enable_teaching_trial(self, *, teacher_id, cohort_id, authorized_cohort_ids):
        if cohort_id not in authorized_cohort_ids:
            raise PropRotationServiceError("cohort_not_authorized")
        return {"status": "TEACHING_TRIAL"}

    def activate_isolated(self, **_kwargs):
        self.activated = True
        return {}


class V5RouteSecurityTests(unittest.TestCase):
    def setUp(self):
        install_identity_env()
        root = Path(__file__).resolve().parents[2] / ".test-temp"
        root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=root)
        self.addCleanup(self.temp.cleanup)
        self.trial = StubTrial()
        self.app = Starlette(routes=vision_routes(VisionCenter(self.temp.name), rotation_trial=self.trial))

    def _client(self, **kwargs):
        return signed_teacher_client(TestClient(self.app, raise_server_exceptions=False), **kwargs)

    def test_unsigned_request_refused(self):
        response = TestClient(self.app).post("/api/v1/vision/rotation-v5/teacher/activate-isolated", json={})
        self.assertEqual(response.status_code, 403)
        self.assertFalse(self.trial.activated)

    def test_forged_role_header_refused(self):
        response = TestClient(self.app).post(
            "/api/v1/vision/rotation-v5/teacher/activate-isolated", json={},
            headers={"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": "1"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertFalse(self.trial.activated)

    def test_student_assertion_cannot_use_teacher_route(self):
        client = self._client(subject="s1", role="student", enrollment_id=1, cohort_ids=("A",))
        response = client.post("/api/v1/vision/rotation-v5/teacher/activate-isolated", json={})
        self.assertEqual(response.status_code, 403)
        self.assertFalse(self.trial.activated)

    def test_teacher_assertion_cannot_use_student_inference(self):
        response = self._client().post("/api/v1/vision/rotation-v5/infer", json=IMAGE)
        self.assertEqual(response.status_code, 403)

    def test_wrong_cohort_enable_refused(self):
        client = self._client(cohort_ids=("A",))
        response = client.post("/api/v1/vision/rotation-v5/teacher/enable-trial", json={"cohort_id": "B"})
        self.assertEqual(response.status_code, 422)

    def test_right_cohort_enable_allowed(self):
        client = self._client(cohort_ids=("A",))
        response = client.post("/api/v1/vision/rotation-v5/teacher/enable-trial", json={"cohort_id": "A"})
        self.assertEqual(response.status_code, 200)

    def test_sandbox_timeout_is_structured_503_for_student(self):
        self.trial.error = RotationSandboxError("sandbox_timeout")
        client = self._client(subject="s1", role="student", enrollment_id=1, cohort_ids=("A",))
        response = client.post("/api/v1/vision/rotation-v5/infer", json=IMAGE)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"]["code"], "rotation_inference_unavailable")

    def test_sandbox_timeout_is_structured_503_for_teacher(self):
        self.trial.error = RotationSandboxError("sandbox_timeout")
        response = self._client().post("/api/v1/vision/rotation-v5/teacher/validate-image", json=IMAGE)
        self.assertEqual(response.status_code, 503)
