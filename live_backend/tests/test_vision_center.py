import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from app.vision_center import (
    HOVER_CLASSES,
    PROP_CLASSES,
    ModelClassNamesMappingRequiredError,
    ModelClassNamesMissingError,
    ModelValidationError,
    VisionCenter,
    analyze_hover,
    evaluate_prop,
    sha256_bytes,
)


class FakeHoverRunner:
    def predict(self, _path, _image_bytes):
        return [{"class": "FRONT", "confidence": .9, "bbox": [40, 40, 60, 60], "center_x": 50, "center_y": 50}]


class FixtureValidator:
    def validate(self, _path: Path, model_type: str) -> dict:
        classes = PROP_CLASSES if model_type == "PROP_DIRECTION" else HOVER_CLASSES
        return {"class_names": list(classes), "task": "detect", "smoke_inference": True}


class WrongClassValidator:
    def validate(self, _path: Path, _model_type: str) -> dict:
        return {"class_names": ["WRONG"], "task": "detect", "smoke_inference": True}


class HyphenClassValidator:
    """模擬 sub-2f8d（2026-10-18）：數量一致、名稱用連字號——需要類別名對照表。"""

    def validate(self, _path: Path, _model_type: str) -> dict:
        return {"class_names": ["CCW-F", "CCW-B", "CW-F", "CW-B"], "task": "detect", "smoke_inference": True}


class EmptyClassValidator:
    """模擬 model.names 為空：不得直接駁回，教師需補充類別名。"""

    def validate(self, _path: Path, _model_type: str) -> dict:
        return {"class_names": [], "task": "detect", "smoke_inference": True}


def prop_detection(class_name, x, y, confidence=0.9):
    return {"class": class_name, "confidence": confidence, "bbox": [x - 5, y - 5, x + 5, y + 5], "center_x": x, "center_y": y}


class VisionCenterTests(unittest.TestCase):
    def setUp(self):
        test_root = Path(__file__).resolve().parents[2] / ".test-temp"
        test_root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=test_root)
        self.root = Path(self.temp.name)
        self.center = VisionCenter(self.root, model_validator=FixtureValidator())

    def tearDown(self):
        self.temp.cleanup()

    def dataset(self, model_type="PROP_DIRECTION", version="v1"):
        return self.center.create_dataset({
            "model_type": model_type, "dataset_version": version, "total_images": 12,
            "train_count": 8, "val_count": 2, "test_count": 2,
            "class_distribution": {}, "source_groups": ["fixture"], "created_by": "teacher",
        })

    def model(self, model_type="PROP_DIRECTION", version="v1", validator=None):
        dataset = self.dataset(model_type, version)
        if validator:
            self.center.model_validator = validator
        return self.center.upload_model(
            model_type=model_type, model_name=f"{model_type}-{version}", version=version,
            content=b"fixture-pt", dataset_id=dataset["dataset_id"],
            dataset_version=dataset["dataset_version"], rule_version="r1", uploaded_by="teacher",
        )

    def test_valid_prop_model_is_validated(self):
        self.assertEqual(self.model()["validation_status"], "VALIDATED")

    def test_wrong_classes_are_rejected(self):
        with self.assertRaises(ModelValidationError):
            self.model(validator=WrongClassValidator())
        self.assertEqual(self.center.list_models()[0]["status"], "REJECTED")

    def test_failed_candidate_does_not_replace_active(self):
        active = self.model(version="v1")
        self.center.activate_model(active["model_id"], "teacher")
        with self.assertRaises(ModelValidationError):
            self.model(version="v2", validator=WrongClassValidator())
        self.assertEqual(self.center.active_model("PROP_DIRECTION")["model_id"], active["model_id"])

    def test_m1_ccw_front_passes(self):
        result = evaluate_prop([prop_detection("CCW_F", 75, 25)], 100, 100)
        self.assertEqual(result["positions"]["M1"]["result"], "PASS")

    def test_m1_clockwise_front_is_rotation_ng(self):
        result = evaluate_prop([prop_detection("CW_F", 75, 25)], 100, 100)
        self.assertEqual(result["positions"]["M1"]["reason_code"], "ROTATION_WRONG")

    def test_m1_ccw_back_is_face_ng(self):
        result = evaluate_prop([prop_detection("CCW_B", 75, 25)], 100, 100)
        self.assertEqual(result["positions"]["M1"]["reason_code"], "FACE_WRONG")

    def test_missing_prop_is_insufficient(self):
        self.assertEqual(evaluate_prop([], 100, 100)["final_result"], "INSUFFICIENT_DATA")

    def test_low_confidence_cannot_pass(self):
        detections = [
            prop_detection("CCW_F", 75, 25, 0.2), prop_detection("CCW_F", 25, 75),
            prop_detection("CW_F", 25, 25), prop_detection("CW_F", 75, 75),
        ]
        self.assertEqual(evaluate_prop(detections, 100, 100)["final_result"], "INSUFFICIENT_DATA")

    def test_valid_hover_model_is_validated(self):
        self.assertEqual(self.model("FOUR_SIDE_HOVER")["validation_status"], "VALIDATED")

    def test_all_hover_directions_complete_passes(self):
        frames = []
        for index, direction in enumerate(HOVER_CLASSES):
            start = index * 6
            frames += [{"timestamp": start + offset, "direction": direction, "confidence": .9, "center_x": 50, "center_y": 50} for offset in range(6)]
        profile = {"four_corner_points": [[0, 0], [100, 0], [100, 100], [0, 100]], "width_m": 2, "height_m": 2}
        result = analyze_hover(frames, profile)
        self.assertEqual(result["result"], "PASS")
        self.assertGreaterEqual(result["score"], 60)

    def test_missing_left_is_ng(self):
        frames = []
        for index, direction in enumerate(HOVER_CLASSES[:-1]):
            frames += [{"timestamp": index * 6 + offset, "direction": direction, "confidence": .9, "center_x": 50, "center_y": 50} for offset in range(6)]
        result = analyze_hover(frames, {"four_corner_points": [[0, 0], [100, 0], [100, 100], [0, 100]], "width_m": 2, "height_m": 2})
        self.assertEqual(result["directions"]["LEFT"]["status"], "INCOMPLETE")
        self.assertEqual(result["result"], "NG")

    def test_short_right_hold_is_incomplete(self):
        frames = [{"timestamp": t, "direction": "RIGHT", "confidence": .9, "center_x": 50, "center_y": 50} for t in (0, 1, 2, 3, 4)]
        result = analyze_hover(frames, {"four_corner_points": [[0, 0], [100, 0], [100, 100], [0, 100]], "width_m": 2, "height_m": 2})
        self.assertEqual(result["directions"]["RIGHT"]["status"], "INCOMPLETE")

    def test_unknown_transition_does_not_directly_fail(self):
        frames = [{"timestamp": 0, "direction": "UNKNOWN", "confidence": .1, "center_x": 50, "center_y": 50}]
        result = analyze_hover(frames, {"four_corner_points": [[0, 0], [100, 0], [100, 100], [0, 100]], "width_m": 2, "height_m": 2})
        self.assertEqual(result["unknown_frames"], 1)
        self.assertNotIn("UNKNOWN", result["failure_reasons"])

    def test_no_calibration_requires_calibration(self):
        result = analyze_hover([], None)
        self.assertEqual(result["calibration_status"], "CALIBRATION_REQUIRED")

    def test_outside_time_uses_timestamps(self):
        frames = [
            {"timestamp": 0, "direction": "FRONT", "confidence": .9, "center_x": 50, "center_y": 50},
            {"timestamp": 1.5, "direction": "FRONT", "confidence": .9, "center_x": 120, "center_y": 50},
            {"timestamp": 3.5, "direction": "FRONT", "confidence": .9, "center_x": 120, "center_y": 50},
            {"timestamp": 4.0, "direction": "FRONT", "confidence": .9, "center_x": 50, "center_y": 50},
        ]
        result = analyze_hover(frames, {"four_corner_points": [[0, 0], [100, 0], [100, 100], [0, 100]], "width_m": 2, "height_m": 2})
        self.assertEqual(result["outside_time_seconds"], 2.5)

    def test_uncalibrated_result_never_fakes_meter_offset(self):
        result = analyze_hover([{"timestamp": 0, "direction": "FRONT", "confidence": .9, "center_x": 500, "center_y": 300}], None)
        self.assertIsNone(result["average_center_offset_m"])
        self.assertIsNone(result["max_center_offset_m"])

    def test_hard_example_can_be_created(self):
        sample = self.center.create_hard_example({"model_type": "PROP_DIRECTION", "model_version": "v1", "source": "LOW_CONFIDENCE", "input_reference": "frame://1", "prediction": "CW_F", "confidence": .2})
        self.assertEqual(sample["review_status"], "PENDING")

    def test_teacher_can_confirm_and_correct_hard_example(self):
        sample = self.center.create_hard_example({"model_type": "PROP_DIRECTION", "model_version": "v1", "source": "TEACHER", "input_reference": "frame://1", "prediction": "CW_B", "confidence": .8})
        reviewed = self.center.review_hard_example(sample["sample_id"], "CORRECTED", "CW_F", "teacher")
        self.assertEqual(reviewed["teacher_label"], "CW_F")

    def test_confirmed_examples_join_dataset_v2_with_lineage(self):
        parent = self.dataset()
        sample = self.center.create_hard_example({"model_type": "PROP_DIRECTION", "model_version": "v1", "source": "TEACHER", "input_reference": "frame://1", "prediction": "CW_F", "confidence": .9})
        self.center.review_hard_example(sample["sample_id"], "CONFIRMED", "CW_F", "teacher")
        child = self.center.build_next_dataset(parent["dataset_id"], [sample["sample_id"]], [], "teacher")
        self.assertEqual(child["parent_dataset_id"], parent["dataset_id"])
        self.assertEqual(child["dataset_version"], "v2")
        self.assertEqual(child["hard_example_count"], 1)

    def test_training_package_exports_required_files(self):
        dataset = self.dataset()
        payload = self.center.export_dataset(dataset["dataset_id"])
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            names = set(archive.namelist())
        self.assertTrue({"data.yaml", "split_manifest.json", "dataset_metadata.json", "images/", "labels/"}.issubset(names))

    def test_golden_evaluation_is_persisted(self):
        model = self.model()
        evaluation = self.center.save_evaluation(model["model_id"], {"precision": .8, "recall": .7, "map50": .75, "map50_95": .5, "per_class_metrics": {}, "confusion_matrix": [], "error_count": 2, "low_confidence_count": 1}, "teacher")
        reloaded = VisionCenter(self.root, model_validator=FixtureValidator())
        self.assertEqual(reloaded.get_model(model["model_id"])["evaluation_status"], "EVALUATED")
        self.assertEqual(reloaded.list_evaluations()[0]["evaluation_id"], evaluation["evaluation_id"])

    def test_only_one_active_per_model_type(self):
        first = self.model(version="v1")
        second = self.model(version="v2")
        self.center.activate_model(first["model_id"], "teacher")
        self.center.activate_model(second["model_id"], "teacher")
        self.assertEqual(self.center.get_model(first["model_id"])["status"], "ARCHIVED")
        self.assertEqual(self.center.active_model("PROP_DIRECTION")["model_id"], second["model_id"])

    def test_prop_and_hover_active_models_are_independent(self):
        prop = self.model("PROP_DIRECTION")
        hover = self.model("FOUR_SIDE_HOVER")
        self.center.activate_model(prop["model_id"], "teacher")
        self.center.activate_model(hover["model_id"], "teacher")
        self.assertEqual(self.center.active_model("PROP_DIRECTION")["model_id"], prop["model_id"])
        self.assertEqual(self.center.active_model("FOUR_SIDE_HOVER")["model_id"], hover["model_id"])

    def test_model_and_rule_versions_are_separate(self):
        model = self.model(version="v4")
        self.assertEqual(model["version"], "v4")
        self.assertEqual(model["rule_version"], "r1")

    def test_camera_profile_persists_four_corners(self):
        profile = self.center.create_camera_profile([[0, 0], [100, 0], [100, 100], [0, 100]], "teacher")
        reloaded = VisionCenter(self.root, model_validator=FixtureValidator())
        self.assertEqual(reloaded.get_camera_profile(profile["camera_profile_id"])["width_m"], 2.0)

    # ---- Student submission (inert attachment) ----
    def test_student_submission_is_stored_inert(self):
        sub = self.center.create_submission(
            task_id="PROP_DIRECTION", student_id="s1", group_id="G1",
            original_filename="best.pt", content=b"fixture-pt", notes="hw",
        )
        self.assertEqual(sub["status"], "SUBMITTED")
        self.assertEqual(self.center.list_models(), [])
        self.assertTrue(Path(sub["file_path"]).exists())
        self.assertEqual(sub["file_hash"], sha256_bytes(b"fixture-pt"))
        self.assertEqual(sub["file_size"], len(b"fixture-pt"))

    def test_submission_rejects_non_pt_extension(self):
        with self.assertRaises(ValueError):
            self.center.create_submission(task_id="PROP_DIRECTION", student_id="s1", group_id="G1", original_filename="model.txt", content=b"x")

    def test_submission_rejects_unknown_task(self):
        with self.assertRaises(ValueError):
            self.center.create_submission(task_id="UNKNOWN", student_id="s1", group_id="G1", original_filename="best.pt", content=b"x")

    def test_teacher_import_creates_model_referencing_submission(self):
        dataset = self.dataset()
        sub = self.center.create_submission(task_id="PROP_DIRECTION", student_id="s1", group_id="G1", original_filename="best.pt", content=b"fixture-pt")
        model = self.center.import_submission(
            sub["submission_id"], model_name="imp", version="v1", dataset_id=dataset["dataset_id"],
            dataset_version=dataset["dataset_version"], rule_version="r1", uploaded_by="teacher",
        )
        self.assertEqual(model["source_submission_id"], sub["submission_id"])
        self.assertEqual(model["source_student_id"], "s1")
        self.assertEqual(model["source_group"], "G1")
        record = self.center.get_submission(sub["submission_id"])
        self.assertEqual(record["status"], "IMPORTED")
        self.assertEqual(record["imported_model_id"], model["model_id"])

    def test_imported_submission_cannot_be_imported_again(self):
        dataset = self.dataset()
        sub = self.center.create_submission(task_id="PROP_DIRECTION", student_id="s1", group_id="G1", original_filename="best.pt", content=b"fixture-pt")
        self.center.import_submission(sub["submission_id"], model_name="imp", version="v1", dataset_id=dataset["dataset_id"], dataset_version=dataset["dataset_version"], rule_version="r1", uploaded_by="teacher")
        with self.assertRaises(ValueError):
            self.center.import_submission(sub["submission_id"], model_name="imp2", version="v2", dataset_id=dataset["dataset_id"], dataset_version=dataset["dataset_version"], rule_version="r1", uploaded_by="teacher")

    def test_submission_import_failure_keeps_submitted_and_records_reason(self):
        """教師指令④：匯入失敗不自動駁回——保持 SUBMITTED 並記錄失敗原因。"""
        sub = self.center.create_submission(task_id="PROP_DIRECTION", student_id="s1", group_id="G1", original_filename="best.pt", content=b"fixture-pt")
        with self.assertRaises(Exception):
            self.center.import_submission(sub["submission_id"], model_name="imp", version="v1", dataset_id="missing", dataset_version="v1", rule_version="r1", uploaded_by="teacher")
        record = self.center.get_submission(sub["submission_id"])
        self.assertEqual(record["status"], "SUBMITTED")
        self.assertIn("dataset_binding_mismatch", record.get("import_last_error") or "")
        self.assertTrue(record.get("import_attempted_at"))

    def test_import_class_names_mapping_required_keeps_submitted_without_side_effects(self):
        """教師指令③：數量一致、名稱不同 → 要求對照表；不建立模型/資料集，不駁回。"""
        self.center.model_validator = HyphenClassValidator()
        dataset = self.dataset()
        sub = self.center.create_submission(task_id="PROP_DIRECTION", student_id="s1", group_id="G1", original_filename="best.pt", content=b"fixture-pt")
        with self.assertRaises(ModelClassNamesMappingRequiredError) as ctx:
            self.center.import_submission(sub["submission_id"], model_name="imp", version="v1", dataset_id=dataset["dataset_id"], dataset_version=dataset["dataset_version"], rule_version="r1", uploaded_by="teacher")
        self.assertEqual(ctx.exception.class_names_actual, ["CCW-F", "CCW-B", "CW-F", "CW-B"])
        self.assertEqual(ctx.exception.class_names_expected, list(PROP_CLASSES))
        self.assertEqual(self.center.get_submission(sub["submission_id"])["status"], "SUBMITTED")
        self.assertEqual(self.center.list_models(), [])
        self.assertEqual(len(self.center.list_datasets()), 1)

    def test_import_with_class_name_mapping_validates_model(self):
        """教師指令③：教師提供對照表後導入成功，class_names 正規化為任務預期。"""
        self.center.model_validator = HyphenClassValidator()
        dataset = self.dataset()
        sub = self.center.create_submission(task_id="PROP_DIRECTION", student_id="s1", group_id="G1", original_filename="best.pt", content=b"fixture-pt")
        model = self.center.import_submission(
            sub["submission_id"], model_name="imp", version="v1", dataset_id=dataset["dataset_id"],
            dataset_version=dataset["dataset_version"], rule_version="r1", uploaded_by="teacher",
            class_name_mapping={"CCW-F": "CCW_F", "CCW-B": "CCW_B", "CW-F": "CW_F", "CW-B": "CW_B"},
        )
        self.assertEqual(model["class_names"], ["CCW_F", "CCW_B", "CW_F", "CW_B"])
        self.assertEqual(model["validation_status"], "VALIDATED")
        self.assertEqual(model["class_name_mapping"]["CCW-F"], "CCW_F")
        self.assertEqual(self.center.get_submission(sub["submission_id"])["status"], "IMPORTED")

    def test_import_with_incomplete_mapping_is_rejected_before_any_record(self):
        """對照表不完整（未映滿預期）必須在建立任何紀錄前失敗。"""
        self.center.model_validator = HyphenClassValidator()
        dataset = self.dataset()
        sub = self.center.create_submission(task_id="PROP_DIRECTION", student_id="s1", group_id="G1", original_filename="best.pt", content=b"fixture-pt")
        with self.assertRaises(ValueError):
            self.center.import_submission(
                sub["submission_id"], model_name="imp", version="v1", dataset_id=dataset["dataset_id"],
                dataset_version=dataset["dataset_version"], rule_version="r1", uploaded_by="teacher",
                class_name_mapping={"CCW-F": "CCW_F", "CCW-B": "CCW_B"},
            )
        self.assertEqual(self.center.get_submission(sub["submission_id"])["status"], "SUBMITTED")
        self.assertEqual(self.center.list_models(), [])

    def test_import_missing_class_names_keeps_submitted_without_side_effects(self):
        """教師指令③：names 為空 → 拋出缺少類別名錯誤；不建立模型，不駁回。"""
        self.center.model_validator = EmptyClassValidator()
        dataset = self.dataset()
        sub = self.center.create_submission(task_id="PROP_DIRECTION", student_id="s1", group_id="G1", original_filename="best.pt", content=b"fixture-pt")
        with self.assertRaises(ModelClassNamesMissingError):
            self.center.import_submission(sub["submission_id"], model_name="imp", version="v1", dataset_id=dataset["dataset_id"], dataset_version=dataset["dataset_version"], rule_version="r1", uploaded_by="teacher")
        self.assertEqual(self.center.get_submission(sub["submission_id"])["status"], "SUBMITTED")
        self.assertEqual(self.center.list_models(), [])

    def test_import_class_count_mismatch_keeps_submitted(self):
        """類別數量不符 → 明確失敗；提交保持 SUBMITTED（由教師決定）。"""
        self.center.model_validator = WrongClassValidator()
        dataset = self.dataset()
        sub = self.center.create_submission(task_id="PROP_DIRECTION", student_id="s1", group_id="G1", original_filename="best.pt", content=b"fixture-pt")
        with self.assertRaises(ModelValidationError) as ctx:
            self.center.import_submission(sub["submission_id"], model_name="imp", version="v1", dataset_id=dataset["dataset_id"], dataset_version=dataset["dataset_version"], rule_version="r1", uploaded_by="teacher")
        self.assertEqual(str(ctx.exception), "model_class_names_mismatch")
        self.assertEqual(self.center.get_submission(sub["submission_id"])["status"], "SUBMITTED")
        self.assertEqual(self.center.list_models(), [])

    def test_preflight_import_reports_outcomes_without_side_effects(self):
        """預檢為唯讀：各結局正確，且不建立任何模型/資料集、不改提交狀態。"""
        dataset = self.dataset()
        sub = self.center.create_submission(task_id="PROP_DIRECTION", student_id="s1", group_id="G1", original_filename="best.pt", content=b"fixture-pt")
        ready = self.center.preflight_import(sub["submission_id"])
        self.assertEqual(ready["outcome"], "ready")
        self.assertEqual(ready["class_names_actual"], list(PROP_CLASSES))

        self.center.model_validator = HyphenClassValidator()
        mapping = self.center.preflight_import(sub["submission_id"])
        self.assertEqual(mapping["outcome"], "mapping_required")
        self.assertEqual(mapping["class_names_actual"], ["CCW-F", "CCW-B", "CW-F", "CW-B"])

        self.center.model_validator = EmptyClassValidator()
        missing = self.center.preflight_import(sub["submission_id"])
        self.assertEqual(missing["outcome"], "class_names_missing")

        self.center.model_validator = WrongClassValidator()
        mismatch = self.center.preflight_import(sub["submission_id"])
        self.assertEqual(mismatch["outcome"], "mismatch")

        self.assertEqual(self.center.get_submission(sub["submission_id"])["status"], "SUBMITTED")
        self.assertEqual(self.center.list_models(), [])
        self.assertEqual(len(self.center.list_datasets()), 1)

    def test_demo_approval_persists_without_importing_or_changing_formal_active(self):
        self.center.demo_simulation_enabled = True
        sub = self.center.create_submission(
            task_id="PROP_DIRECTION", student_id="s1", group_id="G1",
            original_filename="best.pt", content=b"28-byte-demo-fixture-content",
            growth_record_id="77", growth_record_slot="R07",
            evidence_reference="evidence-77", evidence_type="YOLO_MODEL",
        )

        approved = self.center.approve_demo_submission(sub["submission_id"], approved_by="teacher-1")

        self.assertEqual(approved["status"], "SUBMITTED")
        self.assertEqual(approved["demo_review_status"], "DEMO_REVIEW_APPROVED")
        self.assertTrue(approved["demo_active"])
        self.assertEqual(self.center.list_models(), [])
        self.assertIsNone(self.center.active_model("PROP_DIRECTION"))
        reloaded = VisionCenter(
            self.root, model_validator=FixtureValidator(), demo_simulation_enabled=True
        )
        self.assertEqual(
            reloaded.demo_model_status("PROP_DIRECTION")["submission_id"],
            sub["submission_id"],
        )

    def test_demo_simulation_returns_future_real_api_contract(self):
        self.center.demo_simulation_enabled = True
        sub = self.center.create_submission(
            task_id="PROP_DIRECTION", student_id="s1", group_id="G1",
            original_filename="best.pt", content=b"not-a-real-yolo-model",
            growth_record_id="77", growth_record_slot="R07",
            evidence_reference="evidence-77", evidence_type="YOLO_MODEL",
        )
        self.center.approve_demo_submission(sub["submission_id"], approved_by="teacher-1")

        result = self.center.simulate_prop_check(
            image_bytes=b"uploaded-image", image_width=100, image_height=80
        )

        self.assertEqual(result["status"], "DEMO_SIMULATED")
        self.assertTrue(result["simulation_mode"])
        self.assertEqual(result["model"]["submission_id"], sub["submission_id"])
        self.assertEqual(result["detections"][0]["class"], "CW_F")
        self.assertEqual(len(result["detections"][0]["bbox"]), 4)
        self.assertIn("confidence", result["detections"][0])

    # ---- Golden Test Set registry ----
    def test_golden_set_created_with_default_id_and_reverse_lookup(self):
        golden = self.center.create_golden_set({"model_type": "PROP_DIRECTION", "name": "G1", "total_cases": 10})
        self.assertEqual(golden["golden_set_id"], "PROP_GOLDEN_v1")
        model = self.model()
        self.center.save_evaluation(model["model_id"], {"precision": .8, "recall": .7, "map50": .75, "map50_95": .5, "per_class_metrics": {}, "confusion_matrix": [], "error_count": 2, "low_confidence_count": 1}, "teacher")
        linked = self.center.model_golden_sets(model["model_id"])
        self.assertEqual(linked[0]["golden_set_id"], "PROP_GOLDEN_v1")

    # ---- Backend video frame extraction (Section 16) ----
    def test_process_video_extracts_frames_and_analyzes(self):
        try:
            import cv2
            import numpy as np
        except ImportError:
            self.skipTest("opencv unavailable")
        self.center.model_runner = FakeHoverRunner()
        hover = self.model("FOUR_SIDE_HOVER")
        self.center.activate_model(hover["model_id"], "teacher")
        tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
        writer = cv2.VideoWriter(tmp.name, cv2.VideoWriter_fourcc(*"mp4v"), 10, (64, 64))
        if not writer.isOpened():
            tmp.close()
            self.skipTest("video writer unavailable")
        for _ in range(20):
            writer.write(np.zeros((64, 64, 3), dtype=np.uint8))
        writer.release()
        tmp.close()
        content = Path(tmp.name).read_bytes()
        result = self.center.process_video(content=content, frame_interval_seconds=0.5)
        self.assertGreaterEqual(result["frame_count"], 3)
        self.assertLessEqual(result["frame_count"], 6)
        self.assertEqual(result["calibration_status"], "CALIBRATION_REQUIRED")
        self.assertIn("FRONT", result["directions"])


if __name__ == "__main__":
    unittest.main()
