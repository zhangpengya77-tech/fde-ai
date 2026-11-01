"""PROP_ROTATION_V5 教師驗證與教學試用服務測試。"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.prop_rotation_v5 import V5_MODEL_SHA256, PropRotationTrialRegistry
from app.prop_rotation_service import PropRotationTrialService, PropRotationServiceError


class _FakeRunner:
    def infer(self, *, model_path, image_bytes, actual_model_sha256):
        return {
            "class_names": ["CW", "CCW"],
            "detections": [
                {"class": "CW", "confidence": 0.91, "bbox": [1, 2, 3, 4]},
                {"class": "CCW", "confidence": 0.22, "bbox": [4, 5, 6, 7]},
            ],
        }


class PropRotationV5ServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.model = Path(self.temp.name) / "best.pt"
        self.model.write_bytes(b"test-model")
        self.registry = PropRotationTrialRegistry(Path(self.temp.name) / "registry")
        self.service = PropRotationTrialService(
            registry=self.registry,
            runner=_FakeRunner(),
            model_path=self.model,
            model_sha256=V5_MODEL_SHA256,
            source="F450_CW_CCW_V5_training",
        )

    def tearDown(self):
        self.temp.cleanup()

    def test_teacher_confirmation_enables_only_scoped_teaching_trial(self):
        result = self.service.run_teacher_validation(
            image_bytes=b"actual-image", teacher_id="teacher:1", expected_class="CW",
        )
        self.assertEqual(result["best_detection"]["class"], "CW")
        self.assertEqual(result["status"], "AWAITING_TEACHER_CONFIRMATION")

        validation = self.service.confirm_teacher_validation(
            validation_id=result["validation_id"], teacher_id="teacher:1", decision="CORRECT",
        )
        self.assertEqual(validation["teacher_decision"], "CORRECT")

        model = self.service.enable_teaching_trial(
            teacher_id="teacher:1", cohort_id="cohort-a", authorized_cohort_ids=["cohort-a"],
        )
        self.assertEqual(model["status"], "TEACHING_TRIAL")
        self.assertEqual(model["trial_cohort_ids"], ["cohort-a"])

    def test_student_inference_rejects_other_cohort_and_never_activates_model(self):
        result = self.service.run_teacher_validation(
            image_bytes=b"actual-image", teacher_id="teacher:1", expected_class="CW",
        )
        self.service.confirm_teacher_validation(
            validation_id=result["validation_id"], teacher_id="teacher:1", decision="CORRECT",
        )
        self.service.enable_teaching_trial(
            teacher_id="teacher:1", cohort_id="cohort-a", authorized_cohort_ids=["cohort-a"],
        )

        with self.assertRaisesRegex(PropRotationServiceError, "cohort_not_authorized"):
            self.service.student_infer(image_bytes=b"actual-image", student_id="student:2", cohort_ids=["cohort-b"])

        response = self.service.student_infer(image_bytes=b"actual-image", student_id="student:1", cohort_ids=["cohort-a"])
        self.assertEqual(response["model_status"], "TEACHING_TRIAL")
        self.assertEqual(response["best_detection"]["class"], "CW")
        self.assertNotEqual(self.service.status()["model"]["status"], "ACTIVE")

    def test_active_remains_blocked_without_independent_golden_test(self):
        with self.assertRaisesRegex(PropRotationServiceError, "independent_golden_test_required"):
            self.service.activate_isolated(teacher_id="teacher:1")
