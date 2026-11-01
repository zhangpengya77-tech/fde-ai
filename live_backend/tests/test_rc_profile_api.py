import json
import os
import tempfile
import unittest
from pathlib import Path

from starlette.testclient import TestClient

from app.main import create_app


def _stored_document(device_id: str) -> dict:
    return {
        "schema": "fde.device-profile/1",
        "profile": {
            "id": device_id,
            "label": "RadioMaster Pocket (M1 标定)",
            "type": "gamepad",
            "mode": "custom",
            "axes": {
                "roll": {"source": 3, "kind": "bipolar", "calibration": {"min": -1, "center": 0, "max": 1, "reverse": False, "deadzone": 0.05, "expo": 0}},
                "pitch": {"source": 1, "kind": "bipolar", "calibration": {"min": -1, "center": 0, "max": 1, "reverse": False, "deadzone": 0.05, "expo": 0}},
                "yaw": {"source": 0, "kind": "bipolar", "calibration": {"min": -1, "center": 0, "max": 1, "reverse": False, "deadzone": 0.05, "expo": 0}},
                "throttle": {"source": 2, "kind": "unipolar", "calibration": {"min": -1, "center": -1, "max": 0.96, "reverse": False, "deadzone": 0.02, "expo": 0}},
            },
            "gimbal": None,
            "armButton": 7,
            "unsupported": False,
        },
        "savedAtMs": 1_700_000_000_000,
    }


class LatestRcProfileApiTests(unittest.TestCase):
    def setUp(self):
        self._saved_env = os.environ.get("FDE_RC_CALIB_DIR")
        self.tempdir = tempfile.TemporaryDirectory()
        self.calib_dir = Path(self.tempdir.name)
        self.calib_dir.mkdir(exist_ok=True)
        os.environ["FDE_RC_CALIB_DIR"] = str(self.calib_dir)
        self.client = TestClient(create_app())

    def tearDown(self):
        self.tempdir.cleanup()
        if self._saved_env is None:
            os.environ.pop("FDE_RC_CALIB_DIR", None)
        else:
            os.environ["FDE_RC_CALIB_DIR"] = self._saved_env

    def _write(self, name: str, payload) -> Path:
        path = self.calib_dir / name
        if isinstance(payload, str):
            path.write_text(payload, encoding="utf-8")
        else:
            path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        return path

    def test_returns_newest_valid_calibration_file(self):
        self._write("fde-rc-calibration-2026-10-18T20-00-00.json", _stored_document("Radiomaster Pocket Joystick (Vendor: 1209 Product: 4f54)"))

        response = self.client.get("/api/rc/latest-profile")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["profile"]["axes"]["throttle"]["source"], 2)
        self.assertEqual(payload["profile"]["armButton"], 7)
        self.assertEqual(payload["savedAtMs"], 1_700_000_000_000)

    def test_skips_malformed_and_foreign_files(self):
        self._write("fde-rc-calibration-2026-10-18T20-00-00.json", "{not json")
        self._write("fde-rc-calibration-2026-10-18T20-01-00.json", {"schema": "not-a-device-profile/1", "profile": {"id": "x"}})

        response = self.client.get("/api/rc/latest-profile")

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["ok"])

    def test_reports_false_when_directory_has_no_calibration(self):
        response = self.client.get("/api/rc/latest-profile")

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["ok"])

    def test_reports_false_when_directory_is_missing(self):
        os.environ["FDE_RC_CALIB_DIR"] = str(self.calib_dir / "does-not-exist")
        client = TestClient(create_app())

        response = client.get("/api/rc/latest-profile")

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["ok"])

    def test_newest_valid_file_wins_over_older_corrupt_one(self):
        self._write("fde-rc-calibration-2026-10-18T23-59-00.json", "{broken")
        self._write("fde-rc-calibration-2026-10-18T21-00-00.json", _stored_document("Radiomaster Pocket Joystick (Vendor: 1209 Product: 4f54)"))

        response = self.client.get("/api/rc/latest-profile")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["file"], "fde-rc-calibration-2026-10-18T21-00-00.json")
