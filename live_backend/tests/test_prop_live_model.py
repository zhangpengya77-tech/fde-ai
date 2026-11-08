"""即時鏡頭檢測：ACTIVE 模型 ONNX 端點測試（2026-11-08）。

驗證只提供教師已啟用、類別為 CW／CCW、來源雜湊與檔案雜湊都核對通過的 ONNX；
任何不符一律拒絕，且端點不改任何資料。
"""

import base64
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from starlette.testclient import TestClient

from app.main import create_app
from app.vision_center import VisionCenter
from p6_signed_client import signed_teacher_client
from test_vision_api import FixtureRunner, FixtureValidator, OfflineVision, OkHealthInspector

ONNX_BYTES = b"fake-onnx-model-bytes"


class PropLiveModelApiTests(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parents[2] / ".test-temp"
        root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=root)
        self.center = VisionCenter(
            self.temp.name, model_validator=FixtureValidator(), model_runner=FixtureRunner(),
            model_health_inspector=OkHealthInspector(), quality_gate={"require_evaluation": False},
        )
        app = create_app(vision_adapter=OfflineVision(), vision_center=self.center, dev_mode=True)
        self.teacher = signed_teacher_client(TestClient(app), subject="teacher-1")
        self.student = signed_teacher_client(TestClient(app), subject="s1", role="student", enrollment_id=21, cohort_ids=("2026-01",))
        self.anonymous = TestClient(app)

    def tearDown(self):
        self.temp.cleanup()

    def activate_prop_model(self):
        dataset = self.teacher.post("/api/v1/vision/datasets", json={"model_type": "PROP_DIRECTION", "dataset_version": "v1"}).json()
        model = self.teacher.post("/api/v1/vision/models", json={
            "model_type": "PROP_DIRECTION", "model_name": "fixture", "version": "v1", "file_name": "best.pt",
            "file_base64": base64.b64encode(b"fixture").decode(), "dataset_id": dataset["dataset_id"],
            "dataset_version": "v1", "rule_version": "r1",
        }).json()
        self.center._remember_validation(
            model_id=model["model_id"], model_type="PROP_DIRECTION", decision="MATCH", max_confidence=0.9,
            expected_class=None, confidence_threshold=0.5, validated_by="teacher-1", reason_code="OK",
        )
        active = self.teacher.post(f"/api/v1/vision/models/{model['model_id']}/activate", json={}).json()
        self.assertEqual(active["status"], "ACTIVE")
        return self.center.active_model("PROP_DIRECTION")

    def prepare_onnx(self, model, **override):
        folder = Path(model["file_path"]).parent
        (folder / "best.onnx").write_bytes(ONNX_BYTES)
        sidecar = {
            "source_sha256": model["file_hash"], "onnx_sha256": hashlib.sha256(ONNX_BYTES).hexdigest(),
            "class_names": ["CW", "CCW"], "imgsz": 640, "dynamic": True,
        }
        sidecar.update(override)
        (folder / "best.onnx.json").write_text(json.dumps(sidecar), encoding="utf-8")
        return folder

    def code(self, response):
        return response.json()["error"]["code"]

    def test_requires_verified_identity(self):
        self.assertEqual(self.anonymous.get("/api/v1/vision/prop-live/model").status_code, 403)
        self.assertEqual(self.anonymous.get("/api/v1/vision/prop-live/model.onnx").status_code, 403)

    def test_no_active_model(self):
        response = self.student.get("/api/v1/vision/prop-live/model")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.code(response), "no_active_model")

    def test_active_without_onnx_is_not_prepared(self):
        self.activate_prop_model()
        response = self.student.get("/api/v1/vision/prop-live/model")
        self.assertEqual((response.status_code, self.code(response)), (404, "live_model_not_prepared"))

    def test_serves_active_model_meta_and_bytes(self):
        model = self.activate_prop_model()
        self.prepare_onnx(model)
        meta = self.student.get("/api/v1/vision/prop-live/model")
        self.assertEqual(meta.status_code, 200)
        body = meta.json()
        self.assertEqual(body["model_id"], model["model_id"])
        self.assertEqual(body["class_names"], ["CW", "CCW"])
        self.assertEqual(body["onnx_sha256"], hashlib.sha256(ONNX_BYTES).hexdigest())
        self.assertNotIn("_onnx_path", body)
        self.assertFalse(any("file_path" in key for key in body))
        data = self.student.get("/api/v1/vision/prop-live/model.onnx")
        self.assertEqual(data.status_code, 200)
        self.assertEqual(data.content, ONNX_BYTES)
        self.assertEqual(data.headers["X-Model-Sha256"], hashlib.sha256(ONNX_BYTES).hexdigest())
        self.assertIn("no-store", data.headers["Cache-Control"])

    def test_rejects_onnx_from_other_source(self):
        self.prepare_onnx(self.activate_prop_model(), source_sha256="0" * 64)
        for path in ("/api/v1/vision/prop-live/model", "/api/v1/vision/prop-live/model.onnx"):
            response = self.student.get(path)
            self.assertEqual((response.status_code, self.code(response)), (409, "live_model_source_mismatch"))

    def test_rejects_tampered_onnx(self):
        folder = self.prepare_onnx(self.activate_prop_model())
        (folder / "best.onnx").write_bytes(b"replaced")
        response = self.student.get("/api/v1/vision/prop-live/model.onnx")
        self.assertEqual((response.status_code, self.code(response)), (409, "live_model_hash_mismatch"))

    def test_rejects_class_mismatch_including_old_front_back_classes(self):
        self.prepare_onnx(self.activate_prop_model(), class_names=["CW_F", "CW_B", "CCW_F", "CCW_B"])
        response = self.student.get("/api/v1/vision/prop-live/model")
        self.assertEqual((response.status_code, self.code(response)), (409, "model_class_names_mismatch"))

    def test_withdrawn_model_is_no_longer_served(self):
        model = self.activate_prop_model()
        self.prepare_onnx(model)
        self.assertEqual(self.student.get("/api/v1/vision/prop-live/model").status_code, 200)
        # 教師把模型封存後，即時檢測立刻拿不到
        for item in self.center.store.data["models"]:
            if item["model_id"] == model["model_id"]:
                item["status"] = "ARCHIVED"
        self.center.store.save()
        response = self.student.get("/api/v1/vision/prop-live/model")
        self.assertEqual((response.status_code, self.code(response)), (404, "no_active_model"))

    def test_endpoint_is_read_only(self):
        self.prepare_onnx(self.activate_prop_model())
        store = Path(self.temp.name) / "vision_center.json"
        before = store.read_bytes() if store.exists() else None
        self.student.get("/api/v1/vision/prop-live/model")
        self.student.get("/api/v1/vision/prop-live/model.onnx")
        after = store.read_bytes() if store.exists() else None
        self.assertEqual(before, after)


if __name__ == "__main__":
    unittest.main()
