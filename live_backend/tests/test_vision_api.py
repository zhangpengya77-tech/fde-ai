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


class FixtureValidator:
    def validate(self, _path, model_type):
        return {"class_names": list(PROP_CLASSES if model_type == "PROP_DIRECTION" else HOVER_CLASSES), "task": "detect", "smoke_inference": True}


class HyphenClassValidator:
    """模擬 sub-2f8d（2026-10-18）：數量一致、名稱用連字號——需要類別名對照表。"""

    def validate(self, _path, model_type):
        return {"class_names": ["CCW-F", "CCW-B", "CW-F", "CW-B"], "task": "detect", "smoke_inference": True}


class FixtureRunner:
    def predict(self, _path, image_bytes):
        if image_bytes == b"prop-image":
            return [
                {"class": "CW_F", "confidence": .9, "bbox": [10, 10, 30, 30], "center_x": 20, "center_y": 20},
                {"class": "CCW_F", "confidence": .9, "bbox": [70, 10, 90, 30], "center_x": 80, "center_y": 20},
                {"class": "CCW_F", "confidence": .9, "bbox": [10, 70, 30, 90], "center_x": 20, "center_y": 80},
                {"class": "CW_F", "confidence": .9, "bbox": [70, 70, 90, 90], "center_x": 80, "center_y": 80},
            ]
        return [{"class": "FRONT", "confidence": .9, "bbox": [40, 40, 60, 60], "center_x": 50, "center_y": 50}]


class VisionApiTests(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parents[2] / ".test-temp"
        root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=root)
        self.center = VisionCenter(self.temp.name, model_validator=FixtureValidator(), model_runner=FixtureRunner())
        self.client = TestClient(create_app(vision_adapter=OfflineVision(), vision_center=self.center, dev_mode=True))
        self.teacher = {"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": "teacher-1"}

    def tearDown(self):
        self.temp.cleanup()

    def create_dataset(self, model_type="PROP_DIRECTION"):
        response = self.client.post("/api/v1/vision/datasets", headers=self.teacher, json={"model_type": model_type, "dataset_version": "v1", "created_by": "ignored"})
        self.assertEqual(response.status_code, 201)
        return response.json()

    def upload(self, model_type="PROP_DIRECTION"):
        dataset = self.create_dataset(model_type)
        return self.client.post("/api/v1/vision/models", headers=self.teacher, json={
            "model_type": model_type, "model_name": "fixture", "version": "v1", "file_name": "best.pt",
            "file_base64": base64.b64encode(b"fixture").decode(), "dataset_id": dataset["dataset_id"],
            "dataset_version": "v1", "rule_version": "r1",
        })

    def test_teacher_upload_list_get_evaluate_and_activate(self):
        uploaded = self.upload()
        self.assertEqual(uploaded.status_code, 201)
        model = uploaded.json()
        self.assertEqual(self.client.get("/api/v1/vision/models").json()[0]["model_id"], model["model_id"])
        self.assertEqual(self.client.get(f"/api/v1/vision/models/{model['model_id']}").status_code, 200)
        metrics = {"precision": .8, "recall": .7, "map50": .75, "map50_95": .5, "per_class_metrics": {}, "confusion_matrix": [], "error_count": 2, "low_confidence_count": 1}
        self.assertEqual(self.client.post(f"/api/v1/vision/models/{model['model_id']}/evaluate", headers=self.teacher, json=metrics).status_code, 200)
        active = self.client.post(f"/api/v1/vision/models/{model['model_id']}/activate", headers=self.teacher, json={})
        self.assertEqual(active.json()["status"], "ACTIVE")

    def test_student_cannot_upload_or_activate(self):
        self.assertEqual(self.client.post("/api/v1/vision/models", json={}).status_code, 403)
        self.assertEqual(self.client.post("/api/v1/vision/models/missing/activate", json={}).status_code, 403)

    def test_prop_check_uses_rule_engine_and_records_hard_example(self):
        detections = [{"class": "CCW_F", "confidence": .2, "bbox": [70, 20, 80, 30]}]
        response = self.client.post("/api/v1/vision/prop-check", json={"detections": detections, "image_width": 100, "image_height": 100, "input_reference": "frame://1"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["final_result"], "INSUFFICIENT_DATA")
        self.assertEqual(response.json()["detections"], detections)
        self.assertEqual(len(self.client.get("/api/v1/vision/hard-examples", headers=self.teacher).json()), 1)

    def test_hover_analysis_calibration_and_timestamp_rules(self):
        profile = self.client.post("/api/v1/vision/camera-profiles", headers=self.teacher, json={"four_corner_points": [[0, 0], [100, 0], [100, 100], [0, 100]]}).json()
        response = self.client.post("/api/v1/vision/hover-analyze", json={"camera_profile_id": profile["camera_profile_id"], "frames": [{"timestamp": 0, "direction": "UNKNOWN", "confidence": .1, "center_x": 50, "center_y": 50}]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["calibration_status"], "CALIBRATED")
        self.assertEqual(response.json()["unknown_frames"], 1)

    def test_hard_example_review_build_next_and_export(self):
        dataset = self.create_dataset()
        sample = self.center.create_hard_example({"model_type": "PROP_DIRECTION", "model_version": "v1", "source": "LOW_CONFIDENCE", "input_reference": "frame://1", "prediction": "CW_F", "confidence": .2})
        reviewed = self.client.post(f"/api/v1/vision/hard-examples/{sample['sample_id']}/review", headers=self.teacher, json={"decision": "CONFIRMED", "teacher_label": "CW_F"})
        self.assertEqual(reviewed.json()["review_status"], "CONFIRMED")
        child = self.client.post(f"/api/v1/vision/datasets/{dataset['dataset_id']}/build-next", headers=self.teacher, json={"hard_example_ids": [sample["sample_id"]], "new_samples": []})
        self.assertEqual(child.json()["dataset_version"], "v2")
        exported = self.client.get(f"/api/v1/vision/datasets/{child.json()['dataset_id']}/export", headers=self.teacher)
        self.assertEqual(exported.status_code, 200)
        self.assertEqual(exported.headers["content-type"], "application/zip")

    def test_student_image_uses_active_prop_model_without_model_selection(self):
        model = self.upload().json()
        self.client.post(f"/api/v1/vision/models/{model['model_id']}/activate", headers=self.teacher, json={})
        response = self.client.post("/api/v1/vision/prop-check", json={
            "image_base64": base64.b64encode(b"prop-image").decode(), "image_width": 100, "image_height": 100,
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["final_result"], "PASS")
        self.assertEqual(response.json()["model"]["model_id"], model["model_id"])

    def test_hover_frame_images_use_active_hover_model(self):
        model = self.upload("FOUR_SIDE_HOVER").json()
        self.client.post(f"/api/v1/vision/models/{model['model_id']}/activate", headers=self.teacher, json={})
        response = self.client.post("/api/v1/vision/hover-analyze", json={"frames": [
            {"timestamp": 0, "image_base64": base64.b64encode(b"hover-image").decode()},
            {"timestamp": 5, "image_base64": base64.b64encode(b"hover-image").decode()},
        ]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["directions"]["FRONT"]["status"], "COMPLETE")

    # ---- Student submission + teacher import ----
    def submit(self):
        return self.client.post("/api/v1/vision/submissions", json={
            "task_id": "PROP_DIRECTION", "student_id": "s1", "group_id": "G1",
            "original_filename": "best.pt", "file_base64": base64.b64encode(b"fixture").decode(), "notes": "hw",
        })

    def test_student_submission_and_teacher_import(self):
        sub = self.submit()
        self.assertEqual(sub.status_code, 201)
        sid = sub.json()["submission_id"]
        listed = self.client.get("/api/v1/vision/submissions", headers=self.teacher)
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json()[0]["submission_id"], sid)
        dataset = self.create_dataset()
        imported = self.client.post(f"/api/v1/vision/submissions/{sid}/import", headers=self.teacher, json={
            "model_name": "imp", "version": "v1", "dataset_id": dataset["dataset_id"],
            "dataset_version": "v1", "rule_version": "r1",
        })
        self.assertEqual(imported.status_code, 201)
        self.assertEqual(imported.json()["source_submission_id"], sid)
        self.assertEqual(self.client.get(f"/api/v1/vision/submissions", headers=self.teacher).json()[0]["status"], "IMPORTED")

    def test_r07_submission_metadata_is_preserved_without_changing_active_model(self):
        active_model = self.upload().json()
        self.client.post(
            f"/api/v1/vision/models/{active_model['model_id']}/activate",
            headers=self.teacher,
            json={},
        )

        response = self.client.post("/api/v1/vision/submissions", json={
            "task_id": "PROP_DIRECTION",
            "student_id": "FDE-2026-001",
            "group_id": "G1",
            "growth_record_id": "77",
            "growth_record_slot": "R07",
            "evidence_reference": "evidence-123",
            "evidence_type": "YOLO_MODEL",
            "original_filename": "best.pt",
            "file_base64": base64.b64encode(b"r07-fixture").decode(),
            "notes": "R07 model evidence",
        })

        self.assertEqual(response.status_code, 201)
        submission = response.json()
        self.assertEqual(submission["status"], "SUBMITTED")
        self.assertEqual(submission["growth_record_id"], "77")
        self.assertEqual(submission["growth_record_slot"], "R07")
        self.assertEqual(submission["evidence_reference"], "evidence-123")
        self.assertEqual(submission["evidence_type"], "YOLO_MODEL")
        self.assertIsNone(submission["imported_model_id"])
        self.assertEqual(
            self.center.active_model("PROP_DIRECTION")["model_id"],
            active_model["model_id"],
        )

    def test_student_cannot_import_submission(self):
        sid = self.submit().json()["submission_id"]
        self.assertEqual(self.client.post(f"/api/v1/vision/submissions/{sid}/import", json={}).status_code, 403)

    def test_import_preflight_reports_mapping_required_without_side_effects(self):
        """教師指令③：預檢唯讀回報對照表需求，不建立任何模型。"""
        sid = self.submit().json()["submission_id"]
        self.center.model_validator = HyphenClassValidator()
        response = self.client.post(f"/api/v1/vision/submissions/{sid}/import-preflight", headers=self.teacher, json={})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["outcome"], "mapping_required")
        self.assertEqual(body["class_names_actual"], ["CCW-F", "CCW-B", "CW-F", "CW-B"])
        self.assertEqual(body["class_names_expected"], list(PROP_CLASSES))
        self.assertEqual(self.center.list_models(), [])

    def test_import_mapping_required_returns_structured_422_and_keeps_submission(self):
        """教師指令③④：422 帶實際/預期類別名；提交保持 SUBMITTED 未被駁回。"""
        sid = self.submit().json()["submission_id"]
        dataset = self.create_dataset()
        self.center.model_validator = HyphenClassValidator()
        response = self.client.post(f"/api/v1/vision/submissions/{sid}/import", headers=self.teacher, json={
            "model_name": "imp", "version": "v1", "dataset_id": dataset["dataset_id"],
            "dataset_version": "v1", "rule_version": "r1",
        })
        self.assertEqual(response.status_code, 422)
        error = response.json()["error"]
        self.assertEqual(error["message"], "model_class_names_mapping_required")
        self.assertEqual(error["class_names_actual"], ["CCW-F", "CCW-B", "CW-F", "CW-B"])
        self.assertEqual(error["class_names_expected"], list(PROP_CLASSES))
        listed = self.client.get("/api/v1/vision/submissions", headers=self.teacher).json()
        self.assertEqual(listed[0]["status"], "SUBMITTED")
        self.assertEqual(self.center.list_models(), [])

    def test_import_with_class_name_mapping_succeeds(self):
        """教師指令③：提供對照表後導入成功，類別名正規化為任務預期。"""
        sid = self.submit().json()["submission_id"]
        dataset = self.create_dataset()
        self.center.model_validator = HyphenClassValidator()
        response = self.client.post(f"/api/v1/vision/submissions/{sid}/import", headers=self.teacher, json={
            "model_name": "imp", "version": "v1", "dataset_id": dataset["dataset_id"],
            "dataset_version": "v1", "rule_version": "r1",
            "class_name_mapping": {"CCW-F": "CCW_F", "CCW-B": "CCW_B", "CW-F": "CW_F", "CW-B": "CW_B"},
        })
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["class_names"], ["CCW_F", "CCW_B", "CW_F", "CW_B"])
        self.assertEqual(response.json()["validation_status"], "VALIDATED")
        listed = self.client.get("/api/v1/vision/submissions", headers=self.teacher).json()
        self.assertEqual(listed[0]["status"], "IMPORTED")

    def test_teacher_can_approve_demo_submission_and_prop_check_uses_adapter(self):
        self.center.demo_simulation_enabled = True
        submitted = self.client.post("/api/v1/vision/submissions", json={
            "task_id": "PROP_DIRECTION", "student_id": "s1", "group_id": "G1",
            "growth_record_id": "77", "growth_record_slot": "R07",
            "evidence_reference": "evidence-77", "evidence_type": "YOLO_MODEL",
            "original_filename": "best.pt",
            "file_base64": base64.b64encode(b"28-byte-demo-fixture-content").decode(),
        })
        sid = submitted.json()["submission_id"]

        approved = self.client.post(
            f"/api/v1/vision/submissions/{sid}/import",
            headers=self.teacher,
            json={"demo_review_approved": True},
        )
        self.assertEqual(approved.status_code, 200)
        self.assertEqual(approved.json()["demo_review_status"], "DEMO_REVIEW_APPROVED")
        status = self.client.get("/api/v1/vision/prop-check")
        self.assertEqual(status.status_code, 200)
        self.assertEqual(status.json()["submission_id"], sid)

        result = self.client.post("/api/v1/vision/prop-check", json={
            "image_base64": base64.b64encode(b"uploaded-image").decode(),
            "image_width": 100,
            "image_height": 80,
        })
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["status"], "DEMO_SIMULATED")
        self.assertTrue(result.json()["simulation_mode"])
        self.assertEqual(result.json()["model"]["submission_id"], sid)
        self.assertEqual(result.json()["detections"][0]["class"], "CW_F")

    def test_submission_requires_pt_extension(self):
        bad = self.client.post("/api/v1/vision/submissions", json={
            "task_id": "PROP_DIRECTION", "student_id": "s1", "group_id": "G1",
            "original_filename": "model.txt", "file_base64": base64.b64encode(b"x").decode(),
        })
        self.assertEqual(bad.status_code, 422)

    # ---- Golden Test Set registry ----
    def test_golden_set_create_and_model_reverse_lookup(self):
        golden = self.client.post("/api/v1/vision/golden-sets", headers=self.teacher, json={"model_type": "PROP_DIRECTION", "name": "G1", "total_cases": 5})
        self.assertEqual(golden.status_code, 201)
        self.assertEqual(golden.json()["golden_set_id"], "PROP_GOLDEN_v1")
        model = self.upload().json()
        metrics = {"precision": .8, "recall": .7, "map50": .75, "map50_95": .5, "per_class_metrics": {}, "confusion_matrix": [], "error_count": 2, "low_confidence_count": 1}
        self.client.post(f"/api/v1/vision/models/{model['model_id']}/evaluate", headers=self.teacher, json=metrics)
        linked = self.client.get(f"/api/v1/vision/models/{model['model_id']}/golden-sets")
        self.assertEqual(linked.status_code, 200)
        self.assertEqual(linked.json()[0]["golden_set_id"], "PROP_GOLDEN_v1")

    # ---- Backend video frame extraction ----
    def test_hover_video_analysis(self):
        try:
            import cv2
            import numpy as np
        except ImportError:
            self.skipTest("opencv unavailable")
        model = self.upload("FOUR_SIDE_HOVER").json()
        self.client.post(f"/api/v1/vision/models/{model['model_id']}/activate", headers=self.teacher, json={})
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
        response = self.client.post("/api/v1/vision/hover-video", json={
            "file_name": "clip.mp4", "file_base64": base64.b64encode(content).decode(), "frame_interval_seconds": 0.5,
        })
        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(response.json()["frame_count"], 3)


if __name__ == "__main__":
    unittest.main()
