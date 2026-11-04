"""V1.0 教學測試版：V6 TEST／V7 啟用與規則引擎候選結果測試（2026-11-03、2026-11-04）。"""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app.prop_rotation_rules import TEACHING_TEST_NOTICE, evaluate_teaching_candidate
from app.prop_rotation_service import PropRotationServiceError, PropRotationTrialService
from app.prop_rotation_v5 import V6_TEST_MODEL_SHA256, V7_MODEL_SHA256, PropRotationTrialRegistry


def _prop(cls, x, y, conf=0.9):
    return {"class": cls, "confidence": conf, "bbox": [x - 10, y - 10, x + 10, y + 10]}


# 俯視、機頭朝上：左上 M3、右上 M1、左下 M2、右下 M4。
CORRECT = [_prop("CW", 100, 100), _prop("CCW", 300, 100), _prop("CCW", 100, 300), _prop("CW", 300, 300)]


class _Runner:
    def __init__(self, detections):
        self.detections = detections

    def infer(self, *, model_path, image_bytes, actual_model_sha256):
        return {"class_names": ["CW", "CCW"], "detections": self.detections, "image_width": 400, "image_height": 400}


class TeachingCandidateRuleTests(unittest.TestCase):
    def test_correct_layout_is_pass_candidate_not_official(self):
        result = evaluate_teaching_candidate(CORRECT)
        self.assertEqual(result["candidate"], "PASS")
        self.assertFalse(result["is_official"])
        self.assertTrue(result["requires_teacher_confirmation"])
        self.assertEqual(result["notice"], TEACHING_TEST_NOTICE)
        self.assertEqual(result["motors"]["M3"]["detected"], "CW")

    def test_whole_set_reversed_is_error_candidate(self):
        reversed_set = [_prop("CCW" if p["class"] == "CW" else "CW", *[(p["bbox"][0] + 10), (p["bbox"][1] + 10)]) for p in CORRECT]
        result = evaluate_teaching_candidate(reversed_set)
        self.assertEqual((result["candidate"], result["reason_code"]), ("ERROR", "ROTATION_REVERSED"))
        self.assertEqual(len(result["wrong_props"]), 4)
        self.assertIn("機頭朝上", result["fix_steps"][0])

    def test_one_wrong_prop_names_motor_correct_type_and_steps(self):
        # 左前 M3 應為 CW，裝成 CCW。
        one_wrong = [_prop("CCW", 100, 100)] + CORRECT[1:]
        result = evaluate_teaching_candidate(one_wrong)
        self.assertEqual((result["candidate"], result["reason_code"]), ("ERROR", "WRONG_PROP"))
        self.assertEqual(result["wrong_props"], [
            {"motor": "M3", "position": "左前", "detected": "CCW", "expected": "CW", "confidence": 0.9},
        ])
        self.assertTrue(result["motors"]["M3"]["wrong"])
        self.assertNotIn("wrong", result["motors"]["M1"])
        self.assertIn("M3（左前）", result["reason"])
        self.assertTrue(any("M3（左前）目前是 CCW" in step and "CW 正槳" in step for step in result["fix_steps"]))
        self.assertFalse(result["is_official"])

    def test_two_wrong_props_are_both_listed(self):
        two_wrong = [_prop("CCW", 100, 100), _prop("CW", 300, 100)] + CORRECT[2:]
        result = evaluate_teaching_candidate(two_wrong)
        self.assertEqual([item["motor"] for item in result["wrong_props"]], ["M1", "M3"])

    def test_low_confidence_is_unknown_never_pass(self):
        weak = CORRECT[:3] + [_prop("CW", 300, 300, conf=0.3)]
        result = evaluate_teaching_candidate(weak)
        self.assertEqual((result["candidate"], result["reason_code"]), ("UNKNOWN", "LOW_CONFIDENCE"))

    def test_no_detection_and_extra_boxes_are_unknown(self):
        self.assertEqual(evaluate_teaching_candidate([])["reason_code"], "NO_DETECTION")
        self.assertEqual(evaluate_teaching_candidate(CORRECT + [_prop("CW", 200, 200)])["reason_code"], "TOO_MANY_PROPS")

    def test_two_props_in_one_quadrant_is_unknown(self):
        crowded = [_prop("CW", 100, 100), _prop("CCW", 120, 110), _prop("CCW", 100, 300), _prop("CW", 300, 300)]
        self.assertEqual(evaluate_teaching_candidate(crowded)["reason_code"], "POSITION_AMBIGUOUS")


class V6TestModelTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.model = Path(self.temp.name) / "best.pt"
        self.model.write_bytes(b"test-model")
        self.registry = PropRotationTrialRegistry(Path(self.temp.name) / "registry")
        self.runner = _Runner(CORRECT)
        self.service = PropRotationTrialService(
            registry=self.registry, runner=self.runner, model_path=self.model,
            model_sha256=V6_TEST_MODEL_SHA256, source="F450_V6_test",
        )

    def tearDown(self):
        self.temp.cleanup()

    def _enable(self):
        result = self.service.run_teacher_validation(image_bytes=b"img", teacher_id="teacher:1", expected_class="CW")
        self.service.confirm_teacher_validation(validation_id=result["validation_id"], teacher_id="teacher:1", decision="CORRECT")
        return self.service.enable_teaching_trial(teacher_id="teacher:1", cohort_id="cohort-a", authorized_cohort_ids=["cohort-a"])

    def test_v6_enables_as_test_and_never_active(self):
        model = self._enable()
        self.assertEqual(model["status"], "TEST")
        self.assertTrue(model["test_only"])
        with self.assertRaisesRegex(PropRotationServiceError, "test_model_not_activatable"):
            self.service.activate_isolated(teacher_id="teacher:1")
        self.assertEqual(self.service.status()["model"]["status"], "TEST")

    def test_student_result_carries_version_notice_and_candidate(self):
        self._enable()
        response = self.service.student_infer(image_bytes=b"img", student_id="student:1", cohort_ids=["cohort-a"])
        self.assertEqual(response["model_status"], "TEST")
        self.assertEqual(response["release_stage"], "TEST")
        self.assertEqual(response["model_version"], "v6_final_all_20261103_204027")
        self.assertEqual(response["notice"], TEACHING_TEST_NOTICE)
        self.assertEqual(response["rule_evaluation"]["candidate"], "PASS")
        event = self.registry.data["student_events"][-1]
        self.assertFalse(event["rule_evaluation"]["is_official"])

    def test_low_confidence_student_photo_is_unknown(self):
        self._enable()
        self.runner.detections = CORRECT[:3] + [_prop("CW", 300, 300, conf=0.3)]
        response = self.service.student_infer(image_bytes=b"img", student_id="student:1", cohort_ids=["cohort-a"])
        self.assertEqual(response["rule_evaluation"]["candidate"], "UNKNOWN")

    def test_teacher_label_edit_is_appended_with_original_kept(self):
        model = self._enable()
        edit = self.registry.record_teacher_label_edit(
            model_id=model["model_id"], image_sha256="a" * 64, teacher_id="teacher:1",
            before=CORRECT, after=CORRECT[:3], note="移除誤框",
        )
        self.assertEqual(edit["label_status"], "TEACHER_CONFIRMED")
        self.assertEqual(len(self.registry.data["label_edits"][0]["before"]), 4)



class V7ActivationTests(unittest.TestCase):
    """2026-11-04 教師指令：V7（mAP50 0.585）達 0.58 門檻即可啟用。"""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.model = Path(self.temp.name) / "best.pt"
        self.model.write_bytes(b"v7-model")

    def tearDown(self):
        self.temp.cleanup()

    def _service(self, root="registry"):
        return PropRotationTrialService(
            registry=PropRotationTrialRegistry(Path(self.temp.name) / root), runner=_Runner(CORRECT),
            model_path=self.model, model_sha256=V7_MODEL_SHA256, source="F450_V7",
        )

    def _enable(self, service):
        result = service.run_teacher_validation(image_bytes=b"img", teacher_id="teacher:1", expected_class="CW")
        service.confirm_teacher_validation(validation_id=result["validation_id"], teacher_id="teacher:1", decision="CORRECT")
        service.enable_teaching_trial(teacher_id="teacher:1", cohort_id="cohort-a", authorized_cohort_ids=["cohort-a"])

    def test_v7_passes_058_gate_and_can_be_activated(self):
        service = self._service()
        model = service.status()["model"]
        self.assertEqual(model["map50_threshold"], 0.58)
        self.assertTrue(model["independent_golden_test_passed"])
        self._enable(service)
        self.assertEqual(service.activate_isolated(teacher_id="teacher:1")["status"], "ACTIVE_ISOLATED")
        response = service.student_infer(image_bytes=b"img", student_id="student:1", cohort_ids=["cohort-a"])
        self.assertEqual(response["model_version"], "v7_final_all_20261103_221118")
        self.assertEqual(response["rule_evaluation"]["candidate"], "PASS")

    def test_raised_threshold_blocks_v7(self):
        with mock.patch.dict(os.environ, {"FDE_PROP_ROTATION_MAP50_THRESHOLD": "0.6"}):
            service = self._service("strict")
            self.assertNotIn("independent_golden_test_passed", service.status()["model"])
        self._enable(service)
        with self.assertRaisesRegex(PropRotationServiceError, "independent_golden_test_required"):
            service.activate_isolated(teacher_id="teacher:1")


if __name__ == "__main__":
    unittest.main()
