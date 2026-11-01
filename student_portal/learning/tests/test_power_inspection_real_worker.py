"""以真實權重與影片走完核驗到時間軸；只在明確提供環境變數時執行。"""

import hashlib
import os
import tempfile
from pathlib import Path
from unittest import skipUnless

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.test import TestCase, override_settings

from learning.models import Cohort, PowerInspectionJob, PowerInspectionModel
from learning.power_inspection_jobs import process_next_job
from learning.power_inspection_runner import run_job, verify_model
from learning.tests.helpers import create_student_account, enroll_student

MODEL = os.environ.get("FDE_POWER_E2E_MODEL", "")
VIDEO = os.environ.get("FDE_POWER_E2E_VIDEO", "")
CLASSES = [item for item in os.environ.get("FDE_POWER_E2E_CLASSES", "").split(",") if item]


@skipUnless(MODEL and VIDEO and CLASSES, "需要 FDE_POWER_E2E_MODEL／VIDEO／CLASSES")
class PowerInspectionRealWorkerTests(TestCase):
    def test_verify_then_process_real_video(self):
        content = Path(MODEL).read_bytes()
        data_yaml = f"names: {CLASSES}\n".encode()
        with tempfile.TemporaryDirectory() as media, override_settings(MEDIA_ROOT=Path(media)):
            teacher = get_user_model().objects.create_user(username="power-e2e", password="test", is_staff=True)
            model = PowerInspectionModel.objects.create(
                version="e2e", sha256=hashlib.sha256(content).hexdigest(), class_contract=CLASSES,
                status=PowerInspectionModel.Status.IMPORTED, imported_by=teacher,
                rule_config={"confidence_threshold": 0.25, "max_gap_ms": 1500},
                delivery_manifest={
                    "data_yaml_sha256": hashlib.sha256(data_yaml).hexdigest(),
                    "training": {"version": "e2e", "date": "2026-11-02"},
                    "metrics": {"precision": 0.5, "recall": 0.5, "map50": 0.5},
                    "independent_test": {"report_id": "e2e", "passed": True},
                    "inference": {"confidence": 0.25, "frame_stride": 2},
                    "source_license": {"source": "e2e", "license": "e2e"},
                },
            )
            model.artifact.save("best.pt", ContentFile(content), save=True)
            model.data_yaml.save("data.yaml", ContentFile(data_yaml), save=True)
            self.assertEqual(verify_model(model)["class_names"], CLASSES)

            student = create_student_account("power-e2e@example.test", "巡檢學員")
            job = PowerInspectionJob.objects.create(
                enrollment=enroll_student(student, Cohort.objects.create(cohort_id="2099-E2", name="E2E")),
                model=model, status=PowerInspectionJob.Status.QUEUED,
                inference_mode=PowerInspectionJob.InferenceMode.REAL,
                rule_config=model.rule_config,
            )
            job.video.save(Path(VIDEO).name, ContentFile(Path(VIDEO).read_bytes()), save=True)
            processed = process_next_job(real_runner=run_job)
            self.assertEqual(processed.status, PowerInspectionJob.Status.COMPLETED, processed.last_error)
            self.assertEqual(processed.result_json["provenance"], "REAL_YOLO")
            self.assertEqual(processed.video_metadata["frame_stride"], 2)
            self.assertEqual(processed.result_json["frame_count"], 3)
