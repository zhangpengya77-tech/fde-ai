from __future__ import annotations

class MockVision:
    _classes = {"motor", "frame_arm", "flight_controller"}

    def scenario(self, name: str, frame_id: str) -> list[dict]:
        if name == "no_detection":
            return []
        if name == "low_confidence":
            return [{"class": "motor", "confidence": 0.2, "box": [80, 60, 560, 420]}]
        if name == "wrong_class":
            return [{"class": "frame_arm", "confidence": 0.9, "box": [80, 60, 560, 420]}]
        if name not in self._classes:
            raise ValueError("unsupported_mock_scenario")
        return [{"class": name, "confidence": 0.95, "box": [80, 60, 560, 420]}]
