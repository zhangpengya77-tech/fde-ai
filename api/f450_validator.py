from __future__ import annotations

import json
from pathlib import Path

RULES_PATH = Path(__file__).resolve().parents[1] / "config" / "f450_rules.json"
DEFAULT_RULES = {
    "confidence_threshold": 0.55,
    "motors": {
        "M1": {"position": "右前", "blade_direction": "CCW", "blade_side": "FRONT"},
        "M2": {"position": "左後", "blade_direction": "CCW", "blade_side": "FRONT"},
        "M3": {"position": "左前", "blade_direction": "CW", "blade_side": "FRONT"},
        "M4": {"position": "右後", "blade_direction": "CW", "blade_side": "FRONT"},
    },
}
CLASS_DIRECTIONS = {"cw_propeller": "CW", "ccw_propeller": "CCW"}

def load_rules(path: Path = RULES_PATH) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else DEFAULT_RULES

def _direction(detection: dict) -> str | None:
    return detection.get("blade_direction") or CLASS_DIRECTIONS.get(detection.get("className"))

def validate_motor(motor: str, detection: dict | None, rules: dict | None = None) -> dict:
    rules = rules or load_rules()
    expected = rules["motors"].get(motor)
    if expected is None:
        return {"status": "UNKNOWN", "motor": motor, "error_code": "WRONG_MOTOR_POSITION"}
    detection = detection or {}
    result = {
        "motor": motor,
        "detected": {"side": detection.get("blade_side"), "direction": _direction(detection)},
        "expected": {"side": expected["blade_side"], "direction": expected["blade_direction"]},
        "confidence": detection.get("confidence"),
        "error_code": None,
    }
    if not detection:
        result.update(status="UNKNOWN", error_code="OBJECT_NOT_FOUND")
        return result
    confidence = detection.get("confidence")
    if confidence is None or confidence < rules.get("confidence_threshold", 0.55):
        result.update(status="UNKNOWN", error_code="LOW_CONFIDENCE")
        return result
    if result["detected"]["direction"] is None:
        result.update(status="UNKNOWN", error_code="LOW_CONFIDENCE")
        return result
    if result["detected"]["direction"] != expected["blade_direction"]:
        result.update(status="ERROR", error_code="WRONG_BLADE_DIRECTION")
        return result
    if result["detected"]["side"] is not None and result["detected"]["side"] != expected["blade_side"]:
        result.update(status="ERROR", error_code="WRONG_BLADE_SIDE")
        return result
    result["status"] = "PASS"
    return result

def validate_all(detections_by_motor: dict[str, dict | None], rules: dict | None = None) -> dict:
    rules = rules or load_rules()
    checks = [validate_motor(motor, detections_by_motor.get(motor), rules) for motor in ("M1", "M2", "M3", "M4")]
    status = "PASS" if all(item["status"] == "PASS" for item in checks) else "ERROR" if any(item["status"] == "ERROR" for item in checks) else "UNKNOWN"
    return {"status": status, "checks": checks, "next_step_enabled": status == "PASS"}
