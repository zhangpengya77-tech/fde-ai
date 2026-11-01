"""POWER_INSPECTION_V1 背景影片工作：不得由 Django request 同步處理。"""

import base64
import json
import subprocess

from pathlib import Path
from unittest.mock import patch

from django.core.files.base import ContentFile
from django.test import SimpleTestCase, TestCase, override_settings

from learning.models import Cohort, PowerInspectionJob
from learning.power_inspection_jobs import build_timeline, probe_video, process_next_job, retry_job
from learning.tests.helpers import create_student_account, enroll_student


class ProbeVideoTests(SimpleTestCase):
    def test_container_duration_is_used_when_stream_has_none(self):
        output = json.dumps({
            "streams": [{"width": 1920, "height": 1080, "r_frame_rate": "30/1"}],
            "format": {"duration": "2.5"},
        })
        completed = subprocess.CompletedProcess([], 0, stdout=output, stderr="")
        with patch("learning.power_inspection_jobs.subprocess.run", return_value=completed):
            metadata = probe_video(Path("clip.mkv"))
        self.assertEqual(metadata, {"duration_ms": 2500, "width": 1920, "height": 1080, "fps": 30.0})


class PowerInspectionJobTests(TestCase):
    def setUp(self):
        cohort = Cohort.objects.create(cohort_id="2099-PQ", name="巡檢處理班")
        student = create_student_account("power-queue@example.test", "巡檢處理學員")
        self.enrollment = enroll_student(student, cohort)

    def test_blocked_job_is_not_completed_by_mock_worker(self):
        job = PowerInspectionJob.objects.create(
            enrollment=self.enrollment,
            status=PowerInspectionJob.Status.WAITING_FOR_REAL_MODEL,
            inference_mode=PowerInspectionJob.InferenceMode.BLOCKED,
        )
        self.assertIsNone(process_next_job(allow_mock_test=True))
        job.refresh_from_db()
        self.assertEqual(job.status, PowerInspectionJob.Status.WAITING_FOR_REAL_MODEL)

    def test_versioned_rule_filters_low_confidence_and_marks_suspected_event(self):
        timeline = build_timeline(
            [
                {"timestamp_ms": 0, "detections": [{"class": "foreign_object", "confidence": 0.91}]},
                {"timestamp_ms": 600, "detections": [{"class": "foreign_object", "confidence": 0.82}]},
                {"timestamp_ms": 700, "detections": [{"class": "foreign_object", "confidence": 0.60}]},
            ],
            max_gap_ms=900,
            confidence_threshold=0.80,
            rule_version="POWER_INSPECTION_RULE_V1",
        )
        self.assertEqual(len(timeline), 1)
        self.assertEqual(timeline[0]["start_ms"], 0)
        self.assertEqual(timeline[0]["end_ms"], 600)
        self.assertEqual(timeline[0]["rule_version"], "POWER_INSPECTION_RULE_V1")
        self.assertEqual(timeline[0]["classification"], "SUSPECTED_ANOMALY")

    def test_explicit_mock_job_completes_with_visible_mock_provenance(self):
        job = PowerInspectionJob.objects.create(
            enrollment=self.enrollment,
            status=PowerInspectionJob.Status.QUEUED,
            inference_mode=PowerInspectionJob.InferenceMode.MOCK,
        )
        processed = process_next_job(
            allow_mock_test=True,
            mock_frame_results=[{"timestamp_ms": 500, "detections": [{"class": "MISSING_INSULATOR_DISC", "confidence": 0.88}]}],
        )
        self.assertEqual(processed.pk, job.pk)
        job.refresh_from_db()
        self.assertEqual(job.status, PowerInspectionJob.Status.COMPLETED)
        self.assertEqual(job.inference_mode, PowerInspectionJob.InferenceMode.MOCK)
        self.assertEqual(job.result_json["provenance"], "MOCK_TEST_ONLY")
        self.assertEqual(job.anomaly_timeline[0]["class"], "MISSING_INSULATOR_DISC")

    @override_settings(MEDIA_ROOT="/tmp/fde-power-inspection-screenshot-media")
    def test_worker_screenshot_bytes_are_stored_with_anomaly_frame(self):
        job = PowerInspectionJob.objects.create(
            enrollment=self.enrollment,
            status=PowerInspectionJob.Status.QUEUED,
            inference_mode=PowerInspectionJob.InferenceMode.MOCK,
        )
        process_next_job(
            allow_mock_test=True,
            mock_frame_results=[{
                "timestamp_ms": 500,
                "detections": [{"class": "MISSING_INSULATOR_DISC", "confidence": 0.88}],
                "screenshot_bytes": b"synthetic-test-screenshot",
            }],
        )
        frame = job.anomaly_frames.get()
        self.assertTrue(frame.screenshot.name)
        self.assertEqual(frame.screenshot.read(), b"synthetic-test-screenshot")

    def test_failed_job_retries_only_below_limit(self):
        job = PowerInspectionJob.objects.create(
            enrollment=self.enrollment, status=PowerInspectionJob.Status.FAILED,
            inference_mode=PowerInspectionJob.InferenceMode.REAL, retry_count=0,
        )
        self.assertTrue(retry_job(job.job_id))
        job.refresh_from_db()
        self.assertEqual(job.status, PowerInspectionJob.Status.QUEUED)
        self.assertEqual(job.retry_count, 1)

    @override_settings(MEDIA_ROOT="/tmp/fde-power-inspection-test-media")
    def test_real_job_runs_without_ffprobe_on_the_host(self):
        job = PowerInspectionJob.objects.create(
            enrollment=self.enrollment, status=PowerInspectionJob.Status.QUEUED,
            inference_mode=PowerInspectionJob.InferenceMode.REAL,
        )
        job.video.save("tower.mov", ContentFile(b"\x00\x00\x00\x18ftypqt  payload"), save=True)
        with patch("learning.power_inspection_jobs.probe_video", side_effect=FileNotFoundError):
            processed = process_next_job(real_runner=lambda _job: {"frame_results": [], "metadata": {"fps": 30.0}})
        self.assertEqual(processed.status, PowerInspectionJob.Status.COMPLETED)
        self.assertEqual(processed.video_metadata, {"fps": 30.0})

    def test_real_job_probes_metadata_before_isolated_runner(self):
        job = PowerInspectionJob.objects.create(
            enrollment=self.enrollment, status=PowerInspectionJob.Status.QUEUED,
            inference_mode=PowerInspectionJob.InferenceMode.REAL,
        )
        job.video.save("tower.mp4", ContentFile(b"\x00\x00\x00\x18ftypisompayload"), save=True)
        with patch("learning.power_inspection_jobs.probe_video", return_value={"duration_ms": 1200, "width": 1920, "height": 1080, "fps": 30.0}):
            processed = process_next_job(real_runner=lambda _job: {"frame_results": [], "metadata": {"runner": "isolated"}})
        self.assertEqual(processed.status, PowerInspectionJob.Status.COMPLETED)
        processed.refresh_from_db()
        self.assertEqual(processed.video_metadata["width"], 1920)
        self.assertEqual(processed.video_metadata["runner"], "isolated")

    @override_settings(MEDIA_ROOT="/tmp/fde-power-inspection-real-worker-media")
    def test_real_worker_base64_screenshot_is_decoded_only_for_a_queued_real_job(self):
        job = PowerInspectionJob.objects.create(
            enrollment=self.enrollment, status=PowerInspectionJob.Status.QUEUED,
            inference_mode=PowerInspectionJob.InferenceMode.REAL,
        )
        job.video.save("tower.mp4", ContentFile(b"\x00\x00\x00\x18ftypisompayload"), save=True)
        worker_screenshot = base64.b64encode(b"isolated-worker-screenshot").decode("ascii")
        with patch("learning.power_inspection_jobs.probe_video", return_value={"duration_ms": 1200, "width": 1920, "height": 1080, "fps": 30.0}):
            processed = process_next_job(real_runner=lambda _job: {
                "frame_results": [{
                    "timestamp_ms": 100,
                    "detections": [{"class": "MISSING_INSULATOR_DISC", "confidence": 0.8, "bbox": [1, 2, 3, 4]}],
                    "screenshot_b64": worker_screenshot,
                }],
                "metadata": {"runner": "isolated"},
            })
        self.assertEqual(processed.status, PowerInspectionJob.Status.COMPLETED)
        self.assertEqual(processed.anomaly_frames.get().screenshot.read(), b"isolated-worker-screenshot")
