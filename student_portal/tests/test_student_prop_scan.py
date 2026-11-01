"""學員手機端靜態圖片辨識（PROP_DIRECTION_V1）局部測試。

驗證重點：
  1. 未取得真實推論結果時，一律 INSUFFICIENT_DATA，不得產生 PASS／NG。
  2. 四類契約以外的類別名不得被模糊對應。
  3. 低信心不得判定 PASS／NG。
  4. M1 右前／M2 左後／M3 左前／M4 右後 與預期方向一致。
  5. 模型狀態為 WAITING_FOR_MODEL（磁碟上無合格模型）。
  6. 解釋文字為規則組裝、不使用 RAG。
"""
import os
import sys
import unittest
from unittest.mock import patch
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django  # noqa: E402

django.setup()

from learning import prop_scan  # noqa: E402
from django.test import override_settings  # noqa: E402


class PropScanRuleTests(unittest.TestCase):
    def test_motor_positions_match_confirmed_table(self):
        self.assertEqual(prop_scan.MOTOR_POSITIONS, {
            "M1": "右前", "M2": "左後", "M3": "左前", "M4": "右後",
        })

    def test_expected_direction_table(self):
        self.assertEqual(prop_scan.EXPECTED_BY_MOTOR["M1"], {"direction": "CCW"})
        self.assertEqual(prop_scan.EXPECTED_BY_MOTOR["M2"], {"direction": "CCW"})
        self.assertEqual(prop_scan.EXPECTED_BY_MOTOR["M3"], {"direction": "CW"})
        self.assertEqual(prop_scan.EXPECTED_BY_MOTOR["M4"], {"direction": "CW"})

    def test_model_status_is_waiting_for_model(self):
        status = prop_scan.model_status()
        self.assertEqual(status["status"], "WAITING_FOR_MODEL")
        self.assertEqual(status["class_contract"], ["CW", "CCW"])

    def test_no_detection_never_passes(self):
        result = prop_scan.evaluate_motor("M1", None)
        self.assertEqual(result["result"], "INSUFFICIENT_DATA")
        self.assertEqual(result["reason_code"], "MISSING_TARGET")

    def test_unknown_class_is_not_mapped(self):
        parsed = prop_scan.classify_class_name("cw_propeller")
        self.assertFalse(parsed["known"])
        result = prop_scan.evaluate_motor("M1", {"class_name": "cw_propeller", "confidence": 0.99})
        self.assertEqual(result["result"], "INSUFFICIENT_DATA")
        self.assertEqual(result["reason_code"], "UNKNOWN_CLASS")

    def test_low_confidence_never_passes(self):
        result = prop_scan.evaluate_motor("M1", {"class_name": "CCW", "confidence": 0.30})
        self.assertEqual(result["result"], "INSUFFICIENT_DATA")
        self.assertEqual(result["reason_code"], "LOW_CONFIDENCE")

    def test_correct_detection_passes(self):
        result = prop_scan.evaluate_motor("M1", {"class_name": "CCW", "confidence": 0.91})
        self.assertEqual(result["result"], "PASS")

    def test_wrong_direction_is_ng(self):
        result = prop_scan.evaluate_motor("M1", {"class_name": "CW", "confidence": 0.91})
        self.assertEqual(result["result"], "NG")
        self.assertEqual(result["reason_code"], "ROTATION_WRONG")

    def test_selection_without_detections_is_insufficient(self):
        evaluation = prop_scan.evaluate_selection({"M1": None, "M2": None, "M3": None, "M4": None}, [])
        self.assertEqual(evaluation["status"], "INSUFFICIENT_DATA")
        self.assertEqual(evaluation["pass_count"], 0)

    def test_selection_all_correct_passes(self):
        detections = [
            {"class_name": "CCW", "confidence": 0.9, "box": [0, 0, 10, 10]},
            {"class_name": "CCW", "confidence": 0.9, "box": [0, 0, 10, 10]},
            {"class_name": "CW", "confidence": 0.9, "box": [0, 0, 10, 10]},
            {"class_name": "CW", "confidence": 0.9, "box": [0, 0, 10, 10]},
        ]
        evaluation = prop_scan.evaluate_selection({"M1": 0, "M2": 1, "M3": 2, "M4": 3}, detections)
        self.assertEqual(evaluation["status"], "PASS")

    def test_explanation_is_rule_based_without_rag(self):
        checks = [prop_scan.evaluate_motor("M1", None)]
        explanation = prop_scan.build_explanation(checks, "INSUFFICIENT_DATA")
        self.assertFalse(explanation["rag_used"])
        self.assertEqual(explanation["source"], "RULE_BASED_ZH_TW")
        self.assertTrue(explanation["tts_text"])


if __name__ == "__main__":
    unittest.main(verbosity=2)


class TeacherTestModelStatusTests(unittest.TestCase):
    MODEL = {
        "status": "ACTIVE", "activation_mode": "TEACHER_TEST", "validation_status": "REVIEW_REQUIRED",
        "class_names": ["CW", "CCW"], "file_path": __file__, "model_id": "m1", "version": "v5",
    }

    def _status(self, enabled):
        with patch("learning.vision_submission.list_models", return_value=[self.MODEL]), \
                override_settings(VISION_TEACHER_TEST_MODE=enabled, VISION_DEMO_SIMULATION_ENABLED=False):
            return prop_scan.model_status()

    def test_teacher_test_model_is_ready_and_labelled_when_mode_on(self):
        status = self._status(True)
        self.assertEqual(status["status"], "READY")
        self.assertTrue(status["teacher_test"])

    def test_teacher_test_model_is_blocked_when_mode_off(self):
        self.assertEqual(self._status(False)["status"], "BLOCKED")
