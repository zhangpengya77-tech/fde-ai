"""教師視覺模型中心整合新功能的測試（2026-10-10 指令 P）。

涵蓋三項新增能力：
1. `validate_image_with_model` / `POST /models/{id}/validate-image`
   —— 對「指定模型」跑真實推論，產生驗證證據，且不動 ACTIVE。
2. `model_history` / `previous_active_model` / `rollback_model`
   —— 版本歷史與一鍵回復舊版本。
3. `activate_model` 的切換保證 —— 失敗時保留原 ACTIVE、成功後推論來源確實指向新模型。

注意：本檔使用 Fixture Runner 驗證「流程與狀態機」的正確性。
「真實 ultralytics 推論」不由本檔證明，而由真機環境的
demo/tools/verify_teacher_vision_center.py 於驗收階段實測。
"""

import base64
import tempfile
import unittest
from pathlib import Path

from starlette.testclient import TestClient

from app.main import create_app
from app.vision_center import HOVER_CLASSES, PROP_CLASSES, VisionCenter


class OfflineVision:
    async def health(self):
        return False


class OkHealthInspector:
    """假 .pt 內容不是真實 checkpoint（真實檢查判 UNKNOWN）；注入 OK 健康度，
    讓本檔聚焦啟用/歷史/回滾的流程與狀態機（健康度閈門由 test_model_health.py
    覆蓋）。nc=None 不斷言分類頭數量，與 PROP/HOVER 兩種預期類別集都相容。"""

    def __call__(self, _path):
        return {
            "health": "OK",
            "reasons": [],
            "map50": 0.9,
            "nc": None,
            "names_count": None,
            "map50_threshold": 0.5,
        }


class FixtureValidator:
    def validate(self, _path, model_type):
        return {
            "class_names": list(PROP_CLASSES if model_type == "PROP_DIRECTION" else HOVER_CLASSES),
            "task": "detect",
            "smoke_inference": True,
        }


class FixtureRunner:
    """依 image_bytes 內容回傳不同結果，讓測試能精確控制預測。"""

    def predict(self, _path, image_bytes):
        if image_bytes == b"match-image":
            return [{"class": "CW_F", "confidence": .93, "bbox": [10, 10, 30, 30], "center_x": 20, "center_y": 20}]
        if image_bytes == b"mismatch-image":
            return [{"class": "CCW_F", "confidence": .88, "bbox": [10, 10, 30, 30], "center_x": 20, "center_y": 20}]
        if image_bytes == b"lowconf-image":
            return [{"class": "CW_F", "confidence": .12, "bbox": [10, 10, 30, 30], "center_x": 20, "center_y": 20}]
        if image_bytes == b"empty-image":
            return []
        return [{"class": "CW_F", "confidence": .9, "bbox": [10, 10, 30, 30], "center_x": 20, "center_y": 20}]


class TeacherVisionCenterTests(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parents[2] / ".test-temp"
        root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=root)
        self.center = VisionCenter(
            self.temp.name,
            model_validator=FixtureValidator(),
            model_runner=FixtureRunner(),
            model_health_inspector=OkHealthInspector(),
            # 本檔聚焦啟用/歷史/回滾流程；質量證據閈口（require_evaluation）由
            # test_vision_quality_gate.py 專門覆蓋，這裡關閉以隔离变量。
            quality_gate={"require_evaluation": False},
        )
        self.client = TestClient(
            create_app(vision_adapter=OfflineVision(), vision_center=self.center, dev_mode=True)
        )
        self.teacher = {"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": "teacher-1"}

    def tearDown(self):
        self.temp.cleanup()

    # ---- helpers ----
    def create_dataset(self, model_type="PROP_DIRECTION"):
        response = self.client.post(
            "/api/v1/vision/datasets",
            headers=self.teacher,
            json={"model_type": model_type, "dataset_version": "v1", "created_by": "ignored"},
        )
        self.assertEqual(response.status_code, 201)
        return response.json()

    def upload(self, version="v1", model_type="PROP_DIRECTION"):
        dataset = self.create_dataset(model_type)
        response = self.client.post(
            "/api/v1/vision/models",
            headers=self.teacher,
            json={
                "model_type": model_type,
                "model_name": f"fixture-{version}",
                "version": version,
                "file_name": "best.pt",
                "file_base64": base64.b64encode(f"model-{version}".encode()).decode(),
                "dataset_id": dataset["dataset_id"],
                "dataset_version": "v1",
                "rule_version": "r1",
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def activate(self, model_id, model_type="PROP_DIRECTION"):
        # A 硬規則（2026-10-23）：啟用需有真實圖片驗證通過紀錄（最高信心 ≥ 0.6）。
        # 本檔焦點為啟用/歷史/回滾的流程與狀態機，以一次 MATCH 紀錄滿足前置條件
        #（驗證端點本身的行為由本檔 validate_image 系列與資格判定由專門套件覆蓋）。
        self.center._remember_validation(
            model_id=model_id, model_type=model_type, decision="MATCH",
            max_confidence=0.9, expected_class=None, confidence_threshold=0.5,
            validated_by="teacher-1", reason_code="OK",
        )
        return self.client.post(
            f"/api/v1/vision/models/{model_id}/activate", headers=self.teacher, json={}
        )

    def validate_image(self, model_id, image_bytes, **extra):
        payload = {"image_base64": base64.b64encode(image_bytes).decode()}
        payload.update(extra)
        return self.client.post(
            f"/api/v1/vision/models/{model_id}/validate-image", headers=self.teacher, json=payload
        )

    # ==================================================================
    # 區域二：指定模型 × 單張圖片真實驗證
    # ==================================================================

    def test_validate_image_returns_real_detection_facts(self):
        """驗證端點必須回傳真實偵測框、類別與信心值，而非僅 HTTP 200。"""
        model = self.upload()
        response = self.validate_image(model["model_id"], b"match-image", expected_class="CW_F")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["detection_count"], 1)
        self.assertEqual(body["detections"][0]["class"], "CW_F")
        self.assertAlmostEqual(body["detections"][0]["confidence"], .93, places=5)
        self.assertEqual(body["detections"][0]["bbox"], [10, 10, 30, 30])
        self.assertEqual(body["verdict"]["predicted_class"], "CW_F")
        self.assertEqual(body["verdict"]["decision"], "MATCH")
        self.assertEqual(body["verdict"]["reason_code"], "OK")
        self.assertEqual(body["validated_by"], "teacher-1")
        self.assertEqual(body["model"]["class_names"], list(PROP_CLASSES))

    def test_validate_image_detects_class_mismatch(self):
        model = self.upload()
        body = self.validate_image(model["model_id"], b"mismatch-image", expected_class="CW_F").json()
        self.assertEqual(body["verdict"]["decision"], "MISMATCH")
        self.assertEqual(body["verdict"]["reason_code"], "CLASS_MISMATCH")
        self.assertEqual(body["verdict"]["predicted_class"], "CCW_F")

    def test_validate_image_low_confidence_is_not_a_pass(self):
        """不得只憑信心值判定；低於門檻必須回報資料不足。"""
        model = self.upload()
        body = self.validate_image(model["model_id"], b"lowconf-image", expected_class="CW_F").json()
        self.assertEqual(body["verdict"]["decision"], "INSUFFICIENT_DATA")
        self.assertEqual(body["verdict"]["reason_code"], "LOW_CONFIDENCE")

    def test_validate_image_without_detection(self):
        model = self.upload()
        body = self.validate_image(model["model_id"], b"empty-image", expected_class="CW_F").json()
        self.assertEqual(body["detection_count"], 0)
        self.assertEqual(body["verdict"]["decision"], "INSUFFICIENT_DATA")
        self.assertEqual(body["verdict"]["reason_code"], "NO_DETECTION")

    def test_validate_image_does_not_change_active_pointer(self):
        """驗證是唯讀探測，不得影響 ACTIVE。"""
        model = self.upload()
        self.activate(model["model_id"])
        self.validate_image(model["model_id"], b"match-image", expected_class="CW_F")
        self.assertEqual(self.center.active_model("PROP_DIRECTION")["model_id"], model["model_id"])
        self.assertEqual(self.center.get_model(model["model_id"])["status"], "ACTIVE")

    def test_validate_image_requires_teacher(self):
        model = self.upload()
        response = self.client.post(
            f"/api/v1/vision/models/{model['model_id']}/validate-image",
            json={"image_base64": base64.b64encode(b"match-image").decode()},
        )
        self.assertEqual(response.status_code, 403)

    def test_validate_image_unknown_model_is_404(self):
        self.assertEqual(self.validate_image("PROP_nope", b"match-image").status_code, 404)

    def test_validate_image_empty_payload_is_422(self):
        model = self.upload()
        response = self.client.post(
            f"/api/v1/vision/models/{model['model_id']}/validate-image",
            headers=self.teacher,
            json={"image_base64": ""},
        )
        self.assertEqual(response.status_code, 422)

    def test_validate_image_works_on_hover_task(self):
        """FOUR_SIDE_HOVER 必須有獨立可用的驗證路徑。"""
        model = self.upload(model_type="FOUR_SIDE_HOVER")
        body = self.validate_image(model["model_id"], b"match-image").json()
        self.assertEqual(body["model"]["model_type"], "FOUR_SIDE_HOVER")
        self.assertEqual(body["model"]["class_names"], list(HOVER_CLASSES))
        self.assertEqual(body["detection_count"], 1)

    def test_two_tasks_keep_independent_active_models(self):
        """PROP 與 HOVER 的啟用版本必須互相獨立。"""
        prop = self.upload(version="p1")
        hover = self.upload(version="h1", model_type="FOUR_SIDE_HOVER")
        self.activate(prop["model_id"])
        self.activate(hover["model_id"])
        self.assertEqual(self.center.active_model("PROP_DIRECTION")["model_id"], prop["model_id"])
        self.assertEqual(self.center.active_model("FOUR_SIDE_HOVER")["model_id"], hover["model_id"])

    # ==================================================================
    # 區域三：啟用 / 歷史 / 一鍵回復
    # ==================================================================

    def test_activation_archives_previous_and_reports_inference_source(self):
        first = self.upload(version="v1")
        second = self.upload(version="v2")
        self.activate(first["model_id"])
        result = self.activate(second["model_id"]).json()
        self.assertEqual(result["status"], "ACTIVE")
        self.assertEqual(result["activation"]["previous_active_model_id"], first["model_id"])
        self.assertEqual(result["activation"]["already_active"], False)
        self.assertEqual(self.center.get_model(first["model_id"])["status"], "ARCHIVED")
        source = result["activation"]["inference_source"]
        self.assertEqual(source["active_model_id"], second["model_id"])
        self.assertEqual(source["inference_source"], "ACTIVE_MODEL_FILE")
        self.assertTrue(source["file_exists"])

    def test_activation_rejects_unvalidated_model(self):
        model = self.upload()
        self.center._find("models", "model_id", model["model_id"])["validation_status"] = "REJECTED"
        response = self.activate(model["model_id"])
        self.assertEqual(response.status_code, 422)
        # 2026-10-23 A 硬規則：被駁回的紀錄一律不得啟用（原因碼 model_rejected；
        # 原 validated_model_required 已由 _activation_eligibility 統一判定取代）。
        self.assertIn("model_rejected", response.text)

    def test_activation_keeps_original_when_new_file_missing(self):
        """切換失敗必須保留原 ACTIVE（指令：切換失敗時保留原本正式模型）。"""
        first = self.upload(version="v1")
        second = self.upload(version="v2")
        self.activate(first["model_id"])
        Path(self.center.get_model(second["model_id"])["file_path"]).unlink()
        response = self.activate(second["model_id"])
        self.assertEqual(response.status_code, 422)
        self.assertIn("model_file_unreadable", response.text)
        self.assertEqual(self.center.active_model("PROP_DIRECTION")["model_id"], first["model_id"])
        self.assertEqual(self.center.get_model(first["model_id"])["status"], "ACTIVE")

    def test_activation_is_idempotent(self):
        model = self.upload()
        self.activate(model["model_id"])
        result = self.activate(model["model_id"]).json()
        self.assertEqual(result["status"], "ACTIVE")
        self.assertTrue(result["activation"]["already_active"])

    def test_history_never_loses_old_versions(self):
        """歷史版本不得被刪除或覆蓋。"""
        versions = [self.upload(version=f"v{i}") for i in ("1", "2", "3")]
        for item in versions:
            self.activate(item["model_id"])
        history = self.client.get(
            "/api/v1/vision/tasks/PROP_DIRECTION/history", headers=self.teacher
        ).json()
        self.assertEqual(len(history["history"]), 3)
        self.assertEqual(history["active"]["model_id"], versions[2]["model_id"])
        statuses = sorted(item["status"] for item in history["history"])
        self.assertEqual(statuses, ["ACTIVE", "ARCHIVED", "ARCHIVED"])

    def test_rollback_restores_previous_validated_version(self):
        first = self.upload(version="v1")
        second = self.upload(version="v2")
        self.activate(first["model_id"])
        self.activate(second["model_id"])
        response = self.client.post(
            "/api/v1/vision/tasks/PROP_DIRECTION/rollback", headers=self.teacher, json={}
        )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["restored"]["model_id"], first["model_id"])
        self.assertEqual(body["replaced"]["model_id"], second["model_id"])
        self.assertEqual(self.center.active_model("PROP_DIRECTION")["model_id"], first["model_id"])
        self.assertEqual(self.center.get_model(second["model_id"])["status"], "ARCHIVED")
        self.assertEqual(body["inference_source"]["active_model_id"], first["model_id"])

    def test_rollback_is_itself_reversible(self):
        first = self.upload(version="v1")
        second = self.upload(version="v2")
        self.activate(first["model_id"])
        self.activate(second["model_id"])
        self.client.post("/api/v1/vision/tasks/PROP_DIRECTION/rollback", headers=self.teacher, json={})
        again = self.client.post(
            "/api/v1/vision/tasks/PROP_DIRECTION/rollback", headers=self.teacher, json={}
        )
        self.assertEqual(again.status_code, 200)
        self.assertEqual(again.json()["restored"]["model_id"], second["model_id"])

    def test_rollback_without_history_is_rejected_and_keeps_active(self):
        only = self.upload(version="v1")
        self.activate(only["model_id"])
        response = self.client.post(
            "/api/v1/vision/tasks/PROP_DIRECTION/rollback", headers=self.teacher, json={}
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("no_previous_validated_model", response.text)
        self.assertEqual(self.center.active_model("PROP_DIRECTION")["model_id"], only["model_id"])

    def test_rollback_requires_teacher(self):
        self.assertEqual(
            self.client.post("/api/v1/vision/tasks/PROP_DIRECTION/rollback", json={}).status_code, 403
        )

    def test_history_requires_teacher(self):
        self.assertEqual(
            self.client.get("/api/v1/vision/tasks/PROP_DIRECTION/history").status_code, 403
        )

    def test_history_is_per_task(self):
        prop = self.upload(version="p1")
        hover = self.upload(version="h1", model_type="FOUR_SIDE_HOVER")
        self.activate(prop["model_id"])
        self.activate(hover["model_id"])
        prop_history = self.client.get(
            "/api/v1/vision/tasks/PROP_DIRECTION/history", headers=self.teacher
        ).json()
        hover_history = self.client.get(
            "/api/v1/vision/tasks/FOUR_SIDE_HOVER/history", headers=self.teacher
        ).json()
        self.assertEqual([item["model_id"] for item in prop_history["history"]], [prop["model_id"]])
        self.assertEqual([item["model_id"] for item in hover_history["history"]], [hover["model_id"]])

    def test_previous_active_ignores_rejected_models(self):
        """回復目標必須是 VALIDATED 的版本，不得回復到被拒絕的模型。"""
        good = self.upload(version="v1")
        bad = self.upload(version="v2")
        self.activate(good["model_id"])
        self.activate(bad["model_id"])
        self.center._find("models", "model_id", good["model_id"])["validation_status"] = "REJECTED"
        self.assertIsNone(self.center.previous_active_model("PROP_DIRECTION"))


if __name__ == "__main__":
    unittest.main()
