"""S2/S3/S4 驗證系統增強測試（2026-10-21 教師指令）。

S2：匯入時顯式拒絕分類頭 nc 與 class_names 長度不符的模型。
S3：模型列表回傳健康度（nc、有無訓練痕跡、mAP50）。
S4：驗證結果回傳具體數字（max_confidence），並區分「無框」與「信心過低」。

不依賴 torch／ultralytics：健康度檢查器與模型推理器均為可注入的樁。
"""

import tempfile
import unittest
from pathlib import Path

from app.vision_center import (
    HEALTH_OK,
    HEALTH_UNTRAINED,
    PROP_CLASSES,
    ModelValidationError,
    VisionCenter,
)


class FixtureValidator:
    """返回正確的 4 類別名，使類別名匹配通過（不觸發類別數不符路徑）。"""

    def validate(self, _path, model_type):
        classes = PROP_CLASSES if model_type == "PROP_DIRECTION" else ()
        return {"class_names": list(classes), "task": "detect", "smoke_inference": True}


class FakeHealthInspector:
    """可控健康度檢查器：直接回傳指定事實，不讀真 .pt。"""

    def __init__(self, health, *, map50=None, nc=None, names_count=None, threshold=0.5):
        self.health = health
        self.facts = {
            "health": health,
            "reasons": [str(health).lower()],
            "map50": map50,
            "nc": nc,
            "names_count": names_count,
            "map50_threshold": threshold,
        }

    def __call__(self, _path):
        return dict(self.facts)


class FakeRunner:
    """不載入模型的推理器：直接回傳預設偵測結果。"""

    def __init__(self, detections=None):
        self.detections = list(detections or [])

    def get_names(self, _path):
        return list(PROP_CLASSES)

    def predict(self, _path, _image_bytes):
        return list(self.detections)


def _detection(class_name, confidence):
    return {
        "class": class_name,
        "confidence": confidence,
        "bbox": [10, 10, 30, 30],
        "center_x": 20,
        "center_y": 20,
    }


class S2NcLengthMismatchTests(unittest.TestCase):
    def setUp(self):
        test_root = Path(__file__).resolve().parents[2] / ".test-temp"
        test_root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=test_root)
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def make_center(self, health_inspector):
        # 質量證據閘口（2026-10-21）在此關閉：本檔聚焦 S2/S3/S4，評估門檻由 test_vision_quality_gate.py 覆蓋。
        return VisionCenter(
            self.root,
            model_validator=FixtureValidator(),
            model_health_inspector=health_inspector,
            quality_gate={"require_evaluation": False},
        )

    def upload(self, center, **kw):
        dataset = center.create_dataset({
            "model_type": "PROP_DIRECTION", "dataset_version": "v1", "total_images": 1,
            "train_count": 1, "val_count": 0, "test_count": 0,
            "class_distribution": {}, "source_groups": ["f"], "created_by": "t",
        })
        return center.upload_model(
            model_type="PROP_DIRECTION", model_name="x", version="v1",
            content=b"fixture-pt", dataset_id=dataset["dataset_id"],
            dataset_version="v1", rule_version="r1", uploaded_by="teacher", **kw,
        )

    def test_nc_mismatch_rejected_even_when_inspector_reports_ok(self):
        """S2 核心：inspector 漏判為 OK，但 nc=5 != len(class_names)=4 → 仍須拒絕。"""
        center = self.make_center(FakeHealthInspector(HEALTH_OK, map50=0.9, nc=5, names_count=4))
        with self.assertRaises(ModelValidationError) as ctx:
            self.upload(center)
        self.assertEqual(str(ctx.exception), "model_nc_mismatch")
        self.assertEqual(center.list_models()[0]["status"], "REJECTED")

    def test_nc_matches_length_passes(self):
        center = self.make_center(FakeHealthInspector(HEALTH_OK, map50=0.9, nc=4, names_count=4))
        model = self.upload(center)
        self.assertEqual(model["validation_status"], "VALIDATED")

    def test_nc_mismatch_demo_allowed_but_not_validated(self):
        """DEMO 放寬：nc 不符放行為 DEMO_IMPORTED，仍不得進 VALIDATED／ACTIVE。"""
        center = self.make_center(FakeHealthInspector(HEALTH_OK, nc=5, names_count=4))
        model = self.upload(center, demo_relaxed=True)
        self.assertEqual(model["validation_status"], "DEMO_IMPORTED")
        self.assertFalse(model["pass_eligible"])


class S3HealthVisibilityTests(unittest.TestCase):
    def setUp(self):
        test_root = Path(__file__).resolve().parents[2] / ".test-temp"
        test_root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=test_root)
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def make_center(self, health_inspector):
        # 質量證據閘口（2026-10-21）在此關閉：本檔聚焦 S2/S3/S4，評估門檻由 test_vision_quality_gate.py 覆蓋。
        return VisionCenter(
            self.root,
            model_validator=FixtureValidator(),
            model_health_inspector=health_inspector,
            quality_gate={"require_evaluation": False},
        )

    def upload(self, center):
        dataset = center.create_dataset({
            "model_type": "PROP_DIRECTION", "dataset_version": "v1", "total_images": 1,
            "train_count": 1, "val_count": 0, "test_count": 0,
            "class_distribution": {}, "source_groups": ["f"], "created_by": "t",
        })
        return center.upload_model(
            model_type="PROP_DIRECTION", model_name="x", version="v1",
            content=b"fixture-pt", dataset_id=dataset["dataset_id"],
            dataset_version="v1", rule_version="r1", uploaded_by="teacher",
        )

    def test_list_models_exposes_health_fields(self):
        center = self.make_center(FakeHealthInspector(HEALTH_OK, map50=0.85, nc=4, names_count=4))
        self.upload(center)
        listed = center.list_models()[0]
        # S3：nc、mAP50、有無訓練痕跡、pass_eligible 都必須出現在清單回傳。
        self.assertIn("nc", listed)
        self.assertEqual(listed["nc"], 4)
        self.assertIn("map50", listed)
        self.assertEqual(listed["map50"], 0.85)
        self.assertIn("has_training_trace", listed)
        self.assertIsInstance(listed["has_training_trace"], bool)
        self.assertIn("training_trace_label", listed)
        self.assertIn("pass_eligible", listed)
        self.assertTrue(listed["pass_eligible"])

    def test_untrained_model_lists_training_trace_absent(self):
        center = self.make_center(FakeHealthInspector(HEALTH_UNTRAINED))
        center.upload_model(
            model_type="PROP_DIRECTION", model_name="x", version="v1",
            content=b"fixture-pt",
            dataset_id=center.create_dataset({
                "model_type": "PROP_DIRECTION", "dataset_version": "v1", "total_images": 1,
                "train_count": 1, "val_count": 0, "test_count": 0,
                "class_distribution": {}, "source_groups": ["f"], "created_by": "t",
            })["dataset_id"],
            dataset_version="v1", rule_version="r1", uploaded_by="teacher",
            demo_relaxed=True,
        )
        listed = center.list_models()[0]
        self.assertFalse(listed["has_training_trace"])
        self.assertEqual(listed["training_trace_label"], "無訓練痕跡")


class S4ValidationDetailTests(unittest.TestCase):
    def setUp(self):
        test_root = Path(__file__).resolve().parents[2] / ".test-temp"
        test_root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=test_root)
        self.root = Path(self.temp.name)
        self.center = VisionCenter(
            self.root,
            model_validator=FixtureValidator(),
            model_health_inspector=FakeHealthInspector(HEALTH_OK, nc=4, names_count=4),
            model_runner=FakeRunner(),
            quality_gate={"require_evaluation": False},
        )

    def tearDown(self):
        self.temp.cleanup()

    def upload(self):
        dataset = self.center.create_dataset({
            "model_type": "PROP_DIRECTION", "dataset_version": "v1", "total_images": 1,
            "train_count": 1, "val_count": 0, "test_count": 0,
            "class_distribution": {}, "source_groups": ["f"], "created_by": "t",
        })
        return self.center.upload_model(
            model_type="PROP_DIRECTION", model_name="x", version="v1",
            content=b"fixture-pt", dataset_id=dataset["dataset_id"],
            dataset_version="v1", rule_version="r1", uploaded_by="teacher",
        )

    def test_no_detection_reports_zero_boxes_and_none_confidence(self):
        self.center.model_runner = FakeRunner([])
        model = self.upload()
        result = self.center.validate_image_with_model(model["model_id"], b"img", expected_class="CW_F")
        self.assertEqual(result["detection_count"], 0)
        self.assertEqual(result["verdict"]["reason_code"], "NO_DETECTION")
        self.assertIsNone(result["max_confidence"])
        self.assertIn("無框", result["verdict"]["reason"])

    def test_low_confidence_reports_specific_number_below_threshold(self):
        self.center.model_runner = FakeRunner([_detection("CW_F", 0.0088)])
        model = self.upload()
        result = self.center.validate_image_with_model(model["model_id"], b"img", expected_class="CW_F")
        self.assertEqual(result["verdict"]["reason_code"], "LOW_CONFIDENCE")
        self.assertAlmostEqual(result["max_confidence"], 0.0088, places=4)
        self.assertIn("0.0088", result["verdict"]["reason"])
        self.assertIn("0.5", result["verdict"]["reason"])
        self.assertNotEqual(result["verdict"]["decision"], "MATCH")

    def test_above_threshold_match_reports_confidence(self):
        self.center.model_runner = FakeRunner([_detection("CW_F", 0.93)])
        model = self.upload()
        result = self.center.validate_image_with_model(model["model_id"], b"img", expected_class="CW_F")
        self.assertEqual(result["verdict"]["reason_code"], "OK")
        self.assertAlmostEqual(result["max_confidence"], 0.93, places=4)


if __name__ == "__main__":
    unittest.main()
