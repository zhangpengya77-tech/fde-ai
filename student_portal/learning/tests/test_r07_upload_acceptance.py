"""R07 .pt upload-channel acceptance (fills a real coverage gap).

This exercises the REAL `growth_model_upload` view (form validation, Evidence
creation, physical file save, SHA-256 round-trip, Submission/R07 linkage, status
transition, and "no auto-activation"). The only seam patched is
`learning.views.submit_model_evidence_to_vision` — the outbound forward to the
Live Backend submission API — because the Live Backend HTTP service is not
running in this unit context. The forward behaviour itself (which is a plain
byte-write, never an inference load) is covered separately by the Live Backend
`create_submission` tests. Patching the seam here is explicitly an isolation
measure and is documented in the closing acceptance report.

Run (from student_portal/, isolated scratch DB + MEDIA):
  DJANGO_SETTINGS_MODULE=config.settings DJANGO_DEBUG=true DJANGO_ALLOWED_HOSTS='*' \
  DJANGO_DB_NAME=<scratch>/test.sqlite3 DJANGO_MEDIA_ROOT=<scratch>/media \
  <venv>/python manage.py test learning.tests.test_r07_upload_acceptance -v2
"""
import hashlib
from pathlib import Path
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.urls import reverse

from learning.models import (
    Cohort,
    Evidence,
    GrowthRecordSubmission,
    VisionModelRecord,
)
from learning.growth_records import ensure_growth_submissions
from learning.tests.helpers import create_student_account, enroll_student


class R07UploadChannelTests(TestCase):
    def setUp(self):
        self.profile = create_student_account("r07up@example.com", "R07 Up")
        self.cohort = Cohort.objects.create(cohort_id="2026-R07", name="r07 acceptance cohort")
        self.enrollment = enroll_student(self.profile, self.cohort)
        self.enrollment.project_direction = "ai_flight_assessment"
        self.enrollment.save(update_fields=["project_direction"])
        ensure_growth_submissions(self.enrollment)
        self.submission = GrowthRecordSubmission.objects.get(
            enrollment=self.enrollment, definition__slot_id="R07"
        )
        self.url = reverse("learning:growth_model_upload", args=[self.enrollment.pk])

    def test_valid_upload_saves_file_with_sha256_and_pends_for_teacher(self):
        self.client.force_login(self.profile.user)
        content = b"PT-MODEL-WEIGHTS-\x10\x20\x30" * 4096  # deterministic dummy weights
        upload = SimpleUploadedFile("best.pt", content, content_type="application/octet-stream")
        with patch("learning.views.submit_model_evidence_to_vision") as forward:
            forward.return_value = {"submission_id": "sub-accept-test", "status": "SUBMITTED"}
            resp = self.client.post(self.url, {"model_file": upload})

        # 1) success = redirect
        self.assertEqual(resp.status_code, 302)
        # 2) forward to Live Backend was invoked exactly once
        self.assertTrue(forward.called)

        # 3) exactly one MODEL Evidence exists, linked to the R07 submission
        evidence = Evidence.objects.get(
            growth_submission=self.submission, evidence_type=Evidence.Type.MODEL
        )
        # 4) file physically saved & readable, byte-identical + matching SHA-256
        saved = Path(evidence.upload.path).read_bytes()
        self.assertEqual(saved, content)
        self.assertEqual(
            hashlib.sha256(saved).hexdigest(), hashlib.sha256(content).hexdigest()
        )
        self.assertEqual(Path(evidence.upload.path).stat().st_size, len(content))

        # 5) metadata linkage back to the Live Backend submission + task typing
        self.assertEqual(evidence.processed_metadata["vision_submission_id"], "sub-accept-test")
        self.assertEqual(evidence.processed_metadata["submission_status"], "SUBMITTED")
        self.assertEqual(evidence.original_metadata["task_type"], "PROP_DIRECTION")
        self.assertEqual(evidence.original_metadata["evidence_type"], "YOLO_MODEL")

        # 6) status transitions to IN_PROGRESS (awaiting teacher) — NOT approved/active
        self.submission.refresh_from_db()
        self.assertEqual(self.submission.status, GrowthRecordSubmission.Status.IN_PROGRESS)

        # 7) upload does NOT create a repository record and does NOT activate anything
        self.assertEqual(VisionModelRecord.objects.count(), 0)

    def test_invalid_extension_is_rejected_and_nothing_is_saved(self):
        self.client.force_login(self.profile.user)
        upload = SimpleUploadedFile("model.bin", b"not-a-pt", content_type="application/octet-stream")
        with patch("learning.views.submit_model_evidence_to_vision") as forward:
            resp = self.client.post(self.url, {"model_file": upload})
        self.assertEqual(resp.status_code, 302)  # error redirect
        self.assertFalse(forward.called)          # never reached the forward seam
        self.assertEqual(Evidence.objects.count(), 0)

    def test_non_ai_direction_is_refused(self):
        self.enrollment.project_direction = "flight_f450"
        self.enrollment.save(update_fields=["project_direction"])
        self.client.force_login(self.profile.user)
        upload = SimpleUploadedFile("best.pt", b"weights" * 32)
        with patch("learning.views.submit_model_evidence_to_vision") as forward:
            resp = self.client.post(self.url, {"model_file": upload})
        self.assertEqual(resp.status_code, 302)
        self.assertFalse(forward.called)
        self.assertEqual(Evidence.objects.count(), 0)

    def test_forward_failure_rolls_back_and_leaves_no_evidence(self):
        self.client.force_login(self.profile.user)
        upload = SimpleUploadedFile("best.pt", b"weights" * 32)
        with patch("learning.views.submit_model_evidence_to_vision") as forward:
            forward.side_effect = RuntimeError("live backend down")
            resp = self.client.post(self.url, {"model_file": upload})
        self.assertEqual(resp.status_code, 302)  # error redirect
        self.assertEqual(Evidence.objects.count(), 0)
        self.submission.refresh_from_db()
        self.assertEqual(self.submission.status, GrowthRecordSubmission.Status.NOT_STARTED)
