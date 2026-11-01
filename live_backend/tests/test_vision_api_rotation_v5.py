"""PROP_ROTATION_V5 API 必須沿用 P6 Assertion，不接受瀏覽器角色標頭。"""

from __future__ import annotations

import base64
import tempfile
import unittest
from pathlib import Path

from starlette.applications import Starlette
from starlette.testclient import TestClient

from app.vision_api import vision_routes
from app.vision_center import VisionCenter
from p6_signed_client import signed_teacher_client


class _RotationTrial:
    def status(self):
        return {"model": {"task_id": "PROP_ROTATION_V5", "status": "PENDING_TEACHER_VALIDATION"}}

    def run_teacher_validation(self, **kwargs):
        return {"validation_id": "rotation-validation-1", "status": "AWAITING_TEACHER_CONFIRMATION", "best_detection": {"class": "CW", "confidence": .9}}

    def confirm_teacher_validation(self, **kwargs):
        return {"validation_id": kwargs["validation_id"], "teacher_decision": kwargs["decision"]}

    def enable_teaching_trial(self, **kwargs):
        if kwargs["cohort_id"] not in kwargs["authorized_cohort_ids"]:
            from app.prop_rotation_service import PropRotationServiceError
            raise PropRotationServiceError("cohort_not_authorized")
        return {"status": "TEACHING_TRIAL", "trial_cohort_ids": [kwargs["cohort_id"]]}

    def activate_isolated(self, **kwargs):
        from app.prop_rotation_service import PropRotationServiceError
        raise PropRotationServiceError("independent_golden_test_required")

    def student_infer(self, **kwargs):
        return {"model_status": "TEACHING_TRIAL", "best_detection": {"class": "CCW", "confidence": .8}}


class VisionApiRotationV5Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        center = VisionCenter(Path(self.temp.name) / "center")
        self.app = Starlette(routes=vision_routes(center, rotation_trial=_RotationTrial()))
        self.direct = TestClient(self.app)
        self.teacher = signed_teacher_client(TestClient(self.app), subject="teacher-1", cohort_ids=("cohort-a",), ledger_path=str(Path(self.temp.name) / "ledger.sqlite"))
        self.student = signed_teacher_client(TestClient(self.app), subject="student-1", role="student", enrollment_id=7, cohort_ids=("cohort-a",), ledger_path=str(Path(self.temp.name) / "ledger.sqlite"))

    def tearDown(self):
        self.temp.cleanup()

    def test_teacher_validation_requires_assertion_and_can_only_enable_own_cohort_trial(self):
        image = base64.b64encode(b"real-photo").decode()
        self.assertEqual(self.direct.post("/api/v1/vision/rotation-v5/teacher/validate-image", json={"image_base64": image}, headers={"X-FDE-Role": "teacher"}).status_code, 403)
        self.assertEqual(self.teacher.post("/api/v1/vision/rotation-v5/teacher/validate-image", json={"image_base64": image, "expected_class": "CW"}).status_code, 200)
        self.assertEqual(self.teacher.post("/api/v1/vision/rotation-v5/teacher/enable-trial", json={"cohort_id": "cohort-b"}).status_code, 422)
        self.assertEqual(self.teacher.post("/api/v1/vision/rotation-v5/teacher/enable-trial", json={"cohort_id": "cohort-a"}).json()["status"], "TEACHING_TRIAL")

    def test_student_endpoint_rejects_teacher_and_allows_signed_student(self):
        image = base64.b64encode(b"real-photo").decode()
        self.assertEqual(self.teacher.post("/api/v1/vision/rotation-v5/infer", json={"image_base64": image}).status_code, 403)
        response = self.student.post("/api/v1/vision/rotation-v5/infer", json={"image_base64": image})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["best_detection"]["class"], "CCW")
