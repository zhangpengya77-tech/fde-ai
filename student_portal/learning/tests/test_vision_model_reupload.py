"""M5（2026-10-21 教師指令）：教師歸檔／刪除模型後，學員可重傳 best.pt。

教師指令原話：「不理想模型可歸檔/刪除，學員可再傳新模型。」
本檔驗證 Django 端的四件事：

1. 教師歸檔／刪除模型 → 來源提交對應 Evidence 標記 SUPERSEDED；
   未達終態的成長記錄收回 NEEDS_REVISION（可重傳）。
2. 已通過（APPROVED）的成長記錄不改評分狀態，但學員頁面因模型證據被取代
   而重新顯示 best.pt 上傳入口（只放寬重傳，不動評分）。
3. 重傳同檔（與已歸檔模型相同）只提示、不拒絕，仍送交教師審核。
4. 沒有「已被取代」時，唯讀記錄仍然擋住上傳（不擴大放寬範圍）。

跨進程呼叫（submit_model_evidence_to_vision）以 mock 替代，Live 端契約由
live_backend/tests/test_vision_model_management.py 把關。
"""

from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.urls import reverse

from learning.growth_records import ensure_growth_submissions
from learning.models import Cohort, Evidence, GrowthRecordSubmission
from learning.tests.helpers import create_student_account, enroll_student
from learning.views import (
    _vision_clear_submission_superseded,
    _vision_mark_submission_superseded,
)


class VisionModelReuploadTests(TestCase):
    def setUp(self):
        self.profile = create_student_account("reupload@example.com", "Reupload")
        self.cohort = Cohort.objects.create(cohort_id="2026-MG", name="模型管理測試班")
        self.enrollment = enroll_student(self.profile, self.cohort)
        self.enrollment.project_direction = "ai_flight_assessment"
        self.enrollment.save(update_fields=["project_direction"])
        ensure_growth_submissions(self.enrollment)
        self.submission = GrowthRecordSubmission.objects.get(
            enrollment=self.enrollment, definition__slot_id="R07"
        )
        self.detail_url = reverse(
            "learning:growth_record_detail", args=[self.enrollment.pk, "R07"]
        )
        self.upload_url = reverse("learning:growth_model_upload", args=[self.enrollment.pk])
        self.client.force_login(self.profile.user)

    def make_evidence(self, submission_id="sub-1", status="SUBMITTED"):
        return Evidence.objects.create(
            growth_submission=self.submission,
            evidence_type=Evidence.Type.MODEL,
            description="R07 AI Vision / YOLO 訓練模型",
            original_metadata={"filename": "best.pt", "extension": ".pt"},
            processed_metadata={
                "vision_submission_id": submission_id,
                "submission_status": status,
            },
        )

    def set_status(self, status):
        self.submission.status = status
        self.submission.save(update_fields=["status", "updated_at"])

    # ---- 1. 標記函式：SUPERSEDED ＋ 非終態收回 NEEDS_REVISION ----
    def test_superseded_marking_sets_metadata_and_reopens_growth(self):
        evidence = self.make_evidence(submission_id="sub-mg-1")
        self.set_status(GrowthRecordSubmission.Status.SUBMITTED)

        marked = _vision_mark_submission_superseded(
            "sub-mg-1", reason="不理想，請重傳", op="archive"
        )
        self.assertEqual(marked, 1)

        evidence.refresh_from_db()
        metadata = evidence.processed_metadata
        self.assertEqual(metadata["submission_status"], "SUPERSEDED")
        self.assertEqual(metadata["superseded_reason"], "不理想，請重傳")
        self.assertEqual(metadata["superseded_op"], "archive")
        self.assertTrue(metadata["superseded_at"])

        self.submission.refresh_from_db()
        self.assertEqual(
            self.submission.status, GrowthRecordSubmission.Status.NEEDS_REVISION
        )

    def test_superseded_marking_keeps_approved_status(self):
        """已通過的記錄不因歸檔而改評分狀態（評分結果保留）。"""
        evidence = self.make_evidence(submission_id="sub-mg-2")
        self.set_status(GrowthRecordSubmission.Status.APPROVED)

        _vision_mark_submission_superseded("sub-mg-2", reason="重複", op="delete")

        evidence.refresh_from_db()
        self.assertEqual(evidence.processed_metadata["submission_status"], "SUPERSEDED")
        self.submission.refresh_from_db()
        self.assertEqual(self.submission.status, GrowthRecordSubmission.Status.APPROVED)

    def test_restore_clears_superseded_metadata_back_to_original(self):
        """M2：模型還原後，Evidence 狀態回退到標記前的值（不猜測）。"""
        evidence = self.make_evidence(submission_id="sub-mg-7", status="IMPORTED")

        _vision_mark_submission_superseded("sub-mg-7", reason="不理想", op="archive")
        evidence.refresh_from_db()
        self.assertEqual(evidence.processed_metadata["submission_status"], "SUPERSEDED")
        self.assertEqual(
            evidence.processed_metadata["submission_status_before_supersede"], "IMPORTED"
        )

        cleared = _vision_clear_submission_superseded("sub-mg-7")
        self.assertEqual(cleared, 1)
        evidence.refresh_from_db()
        self.assertEqual(evidence.processed_metadata["submission_status"], "IMPORTED")
        self.assertNotIn("superseded_at", evidence.processed_metadata)
        self.assertNotIn("submission_status_before_supersede", evidence.processed_metadata)

    def test_clear_ignores_non_superseded_states(self):
        """非模型管理造成的狀態（例如教師刪除）不被回退。"""
        evidence = self.make_evidence(submission_id="sub-mg-8", status="REMOVED_BY_TEACHER")
        self.assertEqual(_vision_clear_submission_superseded("sub-mg-8"), 0)
        evidence.refresh_from_db()
        self.assertEqual(evidence.processed_metadata["submission_status"], "REMOVED_BY_TEACHER")

    # ---- 2. 學員頁面：已通過但模型被取代 → 重新顯示上傳入口 ----
    def test_approved_record_reopens_upload_form_when_model_superseded(self):
        self.make_evidence(submission_id="sub-mg-3", status="SUPERSEDED")
        self.set_status(GrowthRecordSubmission.Status.APPROVED)

        response = self.client.get(self.detail_url)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.context["model_upload_open"])
        self.assertTrue(response.context["has_removed_model"])
        self.assertContains(response, "重新上傳 YOLO 模型 best.pt")
        self.assertContains(response, "教師已歸檔／刪除此模型，請重新上傳新的 best.pt")

    def test_read_only_record_still_hides_upload_when_not_superseded(self):
        """沒有「已被取代」時不放寬：已通過的記錄維持唯讀。"""
        self.make_evidence(submission_id="sub-mg-4", status="SUBMITTED")
        self.set_status(GrowthRecordSubmission.Status.APPROVED)

        response = self.client.get(self.detail_url)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.context["model_upload_open"])
        self.assertFalse(response.context["has_removed_model"])
        self.assertNotContains(response, "重新上傳 YOLO 模型 best.pt")

    # ---- 3. 重傳端點：可上傳新檔，同檔只提示 ----
    def test_upload_endpoint_accepts_resubmit_after_archive(self):
        self.make_evidence(submission_id="sub-mg-5", status="SUPERSEDED")
        self.set_status(GrowthRecordSubmission.Status.APPROVED)
        content = b"PT-NEW-WEIGHTS-" * 2048
        upload = SimpleUploadedFile("best-v2.pt", content, content_type="application/octet-stream")

        with patch("learning.views.submit_model_evidence_to_vision") as forward:
            forward.return_value = {
                "submission_id": "sub-mg-new",
                "status": "SUBMITTED",
                "duplicate_hint": "same_as_archived_model",
            }
            response = self.client.post(self.upload_url, {"model_file": upload}, follow=True)

        self.assertEqual(response.status_code, 200)
        forward.assert_called_once()
        # 新證據建立並連到新的 Live 提交
        new_evidence = Evidence.objects.filter(
            growth_submission=self.submission, evidence_type=Evidence.Type.MODEL
        ).order_by("-created_at").first()
        self.assertEqual(new_evidence.processed_metadata["vision_submission_id"], "sub-mg-new")
        # 同檔提示（不拒絕）
        self.assertContains(response, "此文件與已歸檔模型相同")
        # 已通過的評分狀態不變
        self.submission.refresh_from_db()
        self.assertEqual(self.submission.status, GrowthRecordSubmission.Status.APPROVED)

    def test_upload_endpoint_still_refuses_when_not_superseded(self):
        self.make_evidence(submission_id="sub-mg-6", status="SUBMITTED")
        self.set_status(GrowthRecordSubmission.Status.APPROVED)
        upload = SimpleUploadedFile("best.pt", b"PT-X" * 512, content_type="application/octet-stream")

        with patch("learning.views.submit_model_evidence_to_vision") as forward:
            response = self.client.post(self.upload_url, {"model_file": upload}, follow=True)

        self.assertContains(response, "目前唯讀")
        forward.assert_not_called()
        self.assertEqual(
            Evidence.objects.filter(
                growth_submission=self.submission, evidence_type=Evidence.Type.MODEL
            ).count(),
            1,
        )
