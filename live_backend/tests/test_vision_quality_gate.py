"""質量證據閘口測試（2026-10-21，方案第五節）。

覆蓋範圍：
1. 類別名吻合但無評估證據 → 不得 VALIDATED（標 REVIEW_REQUIRED）。
2. golden eval 後 map50≥門檻 → 可 VALIDATED（可啟用）。
3. golden eval 後 map50<門檻 → 不得 VALIDATED（附帶具體差距）。
4. sandbox benchmark PASS → 視為已具備評估證據。
5. REVIEW_REQUIRED 不得啟用（activate_model 拋 model_review_required；2026-10-23
   起啟用資格統一由 _activation_eligibility 判定，並疊加圖片驗證要求）。
6. 具證據且 VALIDATED 可正常啟用為 ACTIVE。
7. 無 golden set / 未評估時，原因要明確點名 golden set，不是無聲失敗。
8. require_evaluation=False 時，類別名吻合即 VALIDATED（閘門關閉的合法設定）。
"""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.vision_center import (
    ModelValidationError,
    HEALTH_OK,
    PROP_CLASSES,
    VisionCenter,
)


def _full_metrics(map50: float) -> dict:
    """save_evaluation 要求的完整指標集合，僅改動 map50。"""
    return {
        "precision": 0.9,
        "recall": 0.9,
        "map50": map50,
        "map50_95": 0.6,
        "per_class_metrics": {},
        "confusion_matrix": [],
        "error_count": 0,
        "low_confidence_count": 0,
    }


class FixtureValidator:
    def validate(self, _path: Path, _model_type: str) -> dict:
        return {"class_names": list(PROP_CLASSES), "task": "detect", "smoke_inference": True}


class OkHealthInspector:
    def __call__(self, _path):
        return {"health": HEALTH_OK, "reasons": [], "map50": 0.9, "nc": 2, "names_count": 2, "map50_threshold": 0.5}


class QualityGateTests(unittest.TestCase):
    def setUp(self):
        test_root = Path(__file__).resolve().parents[2] / ".test-temp"
        test_root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=test_root)
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def center(self, **gate):
        cfg = {"require_evaluation": True, "map50_threshold": 0.5}
        cfg.update(gate)
        return VisionCenter(self.root, model_validator=FixtureValidator(), model_health_inspector=OkHealthInspector(), quality_gate=cfg)

    def dataset(self, center):
        return center.create_dataset({
            "model_type": "PROP_DIRECTION", "dataset_version": "v1", "total_images": 1,
            "train_count": 1, "val_count": 0, "test_count": 0,
            "class_distribution": {}, "source_groups": ["f"], "created_by": "t",
        })

    def import_model(self, center):
        ds = self.dataset(center)
        return center.upload_model(
            model_type="PROP_DIRECTION", model_name="x", version="v1",
            content=b"fixture-pt", dataset_id=ds["dataset_id"],
            dataset_version="v1", rule_version="r1", uploaded_by="teacher",
        )

    # 1. 類別吻合但無評估 → 不得 VALIDATED
    def test_class_match_without_evaluation_is_review_required(self):
        center = self.center()
        model = self.import_model(center)
        self.assertEqual(model["validation_status"], "REVIEW_REQUIRED")
        self.assertEqual(model["status"], "REVIEW_REQUIRED")
        # 類型契約仍正確解析成正規類別名（不因閘門而降級類別）
        self.assertEqual(model["class_names"], list(PROP_CLASSES))
        # 原因明確點名需要評估/benchmark
        self.assertIn("golden set", model["review_reason"])

    # 2. map50 達門檻 → 可 VALIDATED
    def test_map50_meets_threshold_becomes_validated(self):
        center = self.center()
        model = self.import_model(center)
        center.save_evaluation(model["model_id"], _full_metrics(0.6), "teacher")
        updated = center.get_model(model["model_id"])
        self.assertEqual(updated["evaluation_status"], "EVALUATED")
        self.assertEqual(updated["validation_status"], "VALIDATED")
        self.assertEqual(updated["status"], "VALIDATED")
        self.assertEqual(updated["review_reason"], "")

    # 3. map50 低於門檻 → 不得 VALIDATED（附帶具體差距）
    def test_map50_below_threshold_stays_review_required(self):
        center = self.center()
        model = self.import_model(center)
        center.save_evaluation(model["model_id"], _full_metrics(0.3), "teacher")
        updated = center.get_model(model["model_id"])
        self.assertEqual(updated["evaluation_status"], "EVALUATED")
        self.assertEqual(updated["validation_status"], "REVIEW_REQUIRED")
        self.assertIn("0.3", updated["review_reason"])
        self.assertIn("0.5", updated["review_reason"])

    # 4. benchmark PASS → 視為已具備證據（單測 _quality_gate_passes）
    def test_benchmark_pass_counts_as_evidence(self):
        center = self.center()
        ok, reason = center._quality_gate_passes({"benchmark_status": "PASS", "evaluation_status": "NOT_EVALUATED"})
        self.assertTrue(ok)
        self.assertIsNone(reason)

    # 5. REVIEW_REQUIRED 不得啟用
    def test_review_required_cannot_activate(self):
        center = self.center()
        model = self.import_model(center)
        self.assertEqual(model["validation_status"], "REVIEW_REQUIRED")
        with self.assertRaises(ValueError) as ctx:
            center.activate_model(model["model_id"], "teacher")
        # 2026-10-23：啟用資格改由 _activation_eligibility 統一判定；REVIEW_REQUIRED
        # （無足夠質量證據）在資格檢查最前排阻，原因碼 model_review_required
        #（原 model_quality_gate 已由此可追溯碼取代）。
        self.assertEqual(str(ctx.exception), "model_review_required")

    # 6. 具證據且 VALIDATED 可啟用為 ACTIVE
    def test_evaluated_validated_can_activate(self):
        center = self.center()
        model = self.import_model(center)
        center.save_evaluation(model["model_id"], _full_metrics(0.8), "teacher")
        # A 硬規則（2026-10-23）：啟用還需一次真實圖片驗證通過紀錄（最高信心 ≥ 0.6）。
        center._remember_validation(
            model_id=model["model_id"], model_type=model["model_type"], decision="MATCH",
            max_confidence=0.9, expected_class=None, confidence_threshold=0.5,
            validated_by="teacher", reason_code="OK",
        )
        activated = center.activate_model(model["model_id"], "teacher")
        self.assertEqual(activated["status"], "ACTIVE")
        self.assertEqual(activated["validation_status"], "VALIDATED")

    def _remember_match(self, center, model, confidence):
        center._remember_validation(
            model_id=model["model_id"], model_type=model["model_type"], decision="MATCH",
            max_confidence=confidence, expected_class=None, confidence_threshold=0.3,
            validated_by="teacher", reason_code="OK",
        )

    def test_teacher_test_mode_is_off_by_default(self):
        center = self.center()
        model = self.import_model(center)
        self._remember_match(center, model, 0.4)
        with self.assertRaises(ValueError):
            center.activate_model(model["model_id"], "teacher")

    def test_teacher_test_mode_activates_and_marks_experimental_model(self):
        center = self.center()
        model = self.import_model(center)
        self._remember_match(center, model, 0.4)
        with patch.dict(os.environ, {"FDE_VISION_TEACHER_TEST_MODE": "1"}):
            activated = center.activate_model(model["model_id"], "teacher")
        self.assertEqual(activated["status"], "ACTIVE")
        self.assertEqual(activated["activation_mode"], "TEACHER_TEST")
        self.assertEqual(activated["validation_status"], "REVIEW_REQUIRED")
        with self.assertRaises(ModelValidationError):
            center.seed_model(model["model_id"], "teacher")

    def test_teacher_test_mode_still_requires_real_image_validation(self):
        center = self.center()
        model = self.import_model(center)
        with patch.dict(os.environ, {"FDE_VISION_TEACHER_TEST_MODE": "1"}):
            with self.assertRaisesRegex(ValueError, "model_validation_required"):
                center.activate_model(model["model_id"], "teacher")

    # 7. 無 golden set / 未評估 → 原因明確點名 golden set
    def test_missing_evaluation_reason_names_golden_set(self):
        center = self.center()
        ok, reason = center._quality_gate_passes({"evaluation_status": "NOT_EVALUATED"})
        self.assertFalse(ok)
        self.assertIn("golden set", reason)

    # 8. require_evaluation=False → 類別名吻合即 VALIDATED（合法關閉閘門）
    def test_require_evaluation_false_validates_on_class_match(self):
        center = self.center(require_evaluation=False)
        model = self.import_model(center)
        self.assertEqual(model["validation_status"], "VALIDATED")
        self.assertEqual(model["status"], "VALIDATED")

    # 門檻預設值取自設定（0.5）
    def test_map50_threshold_default_is_half(self):
        center = self.center()
        self.assertEqual(center.quality_gate["map50_threshold"], 0.5)


if __name__ == "__main__":
    unittest.main()
