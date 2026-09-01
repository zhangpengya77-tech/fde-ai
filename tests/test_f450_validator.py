import unittest
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))

from f450_validator import validate_motor, validate_all  # noqa: E402


class F450ValidatorTest(unittest.TestCase):
    def test_correct_m3_is_pass(self):
        result = validate_motor("M3", {"blade_direction": "CW", "blade_side": "FRONT", "confidence": 0.91})
        self.assertEqual(result["status"], "PASS")
        self.assertIsNone(result["error_code"])

    def test_wrong_direction_is_error(self):
        result = validate_motor("M3", {"blade_direction": "CCW", "blade_side": "FRONT", "confidence": 0.91})
        self.assertEqual(result["status"], "ERROR")
        self.assertEqual(result["error_code"], "WRONG_BLADE_DIRECTION")

    def test_wrong_side_is_error(self):
        result = validate_motor("M3", {"blade_direction": "CW", "blade_side": "BACK", "confidence": 0.91})
        self.assertEqual(result["status"], "ERROR")
        self.assertEqual(result["error_code"], "WRONG_BLADE_SIDE")

    def test_low_confidence_is_unknown(self):
        result = validate_motor("M3", {"blade_direction": "CW", "blade_side": "FRONT", "confidence": 0.4})
        self.assertEqual(result["status"], "UNKNOWN")
        self.assertEqual(result["error_code"], "LOW_CONFIDENCE")

    def test_missing_detection_is_unknown(self):
        result = validate_motor("M3", None)
        self.assertEqual(result["status"], "UNKNOWN")
        self.assertEqual(result["error_code"], "OBJECT_NOT_FOUND")

    def test_all_four_pass_unlocks_next_step(self):
        detections = {
            motor: {"blade_direction": direction, "blade_side": "FRONT", "confidence": 0.9}
            for motor, direction in {"M1": "CCW", "M2": "CCW", "M3": "CW", "M4": "CW"}.items()
        }
        result = validate_all(detections)
        self.assertEqual(result["status"], "PASS")
        self.assertTrue(result["next_step_enabled"])


if __name__ == "__main__":
    unittest.main()
