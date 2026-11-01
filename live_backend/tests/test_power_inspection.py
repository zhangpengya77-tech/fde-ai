import tempfile
import unittest
from pathlib import Path

from app.power_inspection import (
    PowerInspectionRegistry,
    PowerInspectionValidationError,
    assess_model_delivery,
    build_anomaly_timeline,
    validate_mp4_upload,
    verify_model_manifest,
)
from app.power_inspection_worker import serialize_worker_result, validate_worker_frame_results


class PowerInspectionContractTests(unittest.TestCase):
    """POWER_INSPECTION_V1 的最小安全契約。"""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def manifest(self, path, sha256):
        return {
            "task_type": "POWER_INSPECTION_V1",
            "model_name": "power-line-defect",
            "version": "v1",
            "artifact_path": str(path),
            "sha256": sha256,
            "class_names": ["MISSING_INSULATOR_DISC"],
            "source": "teacher-verified",
        }

    def test_missing_model_is_rejected_before_any_inference(self):
        with self.assertRaisesRegex(PowerInspectionValidationError, "model_artifact_missing"):
            verify_model_manifest(self.manifest(self.root / "missing.pt", "0" * 64), self.root)

    def test_hash_mismatch_is_rejected(self):
        model = self.root / "model.pt"
        model.write_bytes(b"not-loaded-by-web-process")
        with self.assertRaisesRegex(PowerInspectionValidationError, "model_sha256_mismatch"):
            verify_model_manifest(self.manifest(model, "0" * 64), self.root)

    def test_non_mp4_and_fake_mp4_are_rejected(self):
        with self.assertRaisesRegex(PowerInspectionValidationError, "video_extension_invalid"):
            validate_mp4_upload("inspection.avi", b"x")
        with self.assertRaisesRegex(PowerInspectionValidationError, "video_container_invalid"):
            validate_mp4_upload("inspection.mp4", b"not an mp4")

    def test_anomaly_timeline_joins_adjacent_detections_only(self):
        timeline = build_anomaly_timeline(
            [
                {"timestamp_ms": 0, "detections": [{"class": "MISSING_INSULATOR_DISC", "confidence": 0.91}]},
                {"timestamp_ms": 900, "detections": [{"class": "MISSING_INSULATOR_DISC", "confidence": 0.89}]},
                {"timestamp_ms": 6000, "detections": [{"class": "MISSING_INSULATOR_DISC", "confidence": 0.94}]},
            ],
            max_gap_ms=1500,
        )
        self.assertEqual(len(timeline), 2)
        self.assertEqual(timeline[0]["start_ms"], 0)
        self.assertEqual(timeline[0]["end_ms"], 900)
        self.assertEqual(timeline[0]["max_confidence"], 0.91)

    def test_trial_is_cohort_scoped_and_does_not_become_active(self):
        model = self.root / "model.pt"
        model.write_bytes(b"verified-artifact")
        import hashlib
        verified = verify_model_manifest(self.manifest(model, hashlib.sha256(model.read_bytes()).hexdigest()), self.root)
        registry = PowerInspectionRegistry(self.root / "registry")
        stored = registry.register_verified_model(verified, teacher_subject="teacher:1")
        trial = registry.enable_teaching_trial(stored["model_id"], cohort_id="COHORT-A", teacher_subject="teacher:1")
        self.assertEqual(trial["status"], "TEACHING_TRIAL")
        self.assertTrue(registry.model_for_student("COHORT-A"))
        self.assertIsNone(registry.model_for_student("COHORT-B"))
        self.assertIsNone(registry.active_model("POWER_INSPECTION_V1"))

    def test_incomplete_delivery_remains_pending_without_guessing_classes(self):
        model = self.root / "model.onnx"
        model.write_bytes(b"untrusted-model-artifact")
        import hashlib

        outcome = assess_model_delivery(
            self.manifest(model, hashlib.sha256(model.read_bytes()).hexdigest()),
            self.root,
        )

        self.assertEqual(outcome["status"], "PENDING_REAL_MODEL_VALIDATION")
        self.assertIn("data_yaml", outcome["missing"])
        self.assertIn("metrics", outcome["missing"])
        self.assertNotIn("class_names", outcome["missing"])

    def test_complete_delivery_validates_metadata_without_loading_checkpoint(self):
        model = self.root / "model.onnx"
        model.write_bytes(b"untrusted-model-artifact")
        data_yaml = self.root / "data.yaml"
        data_yaml.write_text("names: [BROKEN_INSULATOR]", encoding="utf-8")
        import hashlib

        manifest = {
            **self.manifest(model, hashlib.sha256(model.read_bytes()).hexdigest()),
            "data_yaml_path": str(data_yaml),
            "data_yaml_sha256": hashlib.sha256(data_yaml.read_bytes()).hexdigest(),
            "training": {"version": "2026.10", "date": "2026-10-31"},
            "metrics": {"precision": 0.91, "recall": 0.88, "map50": 0.90},
            "independent_test": {"report_id": "POWER-TEST-001", "passed": True},
            "inference": {"confidence": 0.25, "frame_stride": 3},
            "source_license": {"source": "internal-training", "license": "FDE-training-only"},
        }

        outcome = assess_model_delivery(manifest, self.root)

        self.assertEqual(outcome["status"], "VALIDATED")
        self.assertEqual(outcome["verified"]["data_yaml_sha256"], manifest["data_yaml_sha256"])

    def test_worker_result_rejects_unknown_labels_and_keeps_bounding_boxes(self):
        frames = [{
            "timestamp_ms": 100,
            "detections": [{"class": "BROKEN_INSULATOR", "confidence": 0.8, "bbox": [1, 2, 3, 4]}],
            "screenshot_bytes": b"isolated-png",
        }]
        normalized = validate_worker_frame_results(frames, ["BROKEN_INSULATOR"])
        self.assertEqual(normalized[0]["detections"][0]["bbox"], [1.0, 2.0, 3.0, 4.0])
        encoded = serialize_worker_result({"frame_results": normalized})
        self.assertNotIn("screenshot_bytes", encoded["frame_results"][0])
        self.assertTrue(encoded["frame_results"][0]["screenshot_b64"])
        with self.assertRaisesRegex(PowerInspectionValidationError, "worker_class_not_in_contract"):
            validate_worker_frame_results(
                [{"timestamp_ms": 0, "detections": [{"class": "GUESSED_LABEL", "confidence": 0.8, "bbox": [1, 2, 3, 4]}]}],
                ["BROKEN_INSULATOR"],
            )

