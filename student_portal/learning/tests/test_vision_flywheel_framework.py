"""教師 Vision Model Center 框架測試（PROP_DIRECTION_V1）。

覆蓋本輪驗收七項：
1. 教師能看到自己有權限查看的模型
2. 學員 A 的私人模型不會洩漏給學員 B
3. Candidate / Return 原有流程不受影響
4. 圖片驗證頁面可以開啟
5. 沒有安全 Runner 時不可執行推論
6. 未經 Golden Test 不可啟用 ACTIVE
7. 不影響既有 R07 上傳及學員前端
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse

from learning.growth_records import ensure_growth_submissions
from learning.models import Cohort, Evidence, TeacherCohortAccess
from learning.tests.helpers import create_student_account, enroll_student
from learning.vision_flywheel import (
    active_switch_blocked_reason,
    deployment_status_of,
    review_status_of,
    training_usage_of,
    validation_status_of,
)
from learning.vision_verification import runner_available, runner_state, verification_ready


class VisionFlywheelFrameworkTests(TestCase):
    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="FW-A", name="飛輪班 A")
        self.other_cohort = Cohort.objects.create(cohort_id="FW-B", name="飛輪班 B")
        self.student = create_student_account("fw-a@example.test", "學員 A")
        self.other_student = create_student_account("fw-b@example.test", "學員 B")
        self.enrollment = enroll_student(self.student, self.cohort)
        self.other_enrollment = enroll_student(self.other_student, self.other_cohort)
        self.evidence = self._model_evidence(self.enrollment, "best-fw-a.pt", "PROP_DIRECTION")
        self.other_evidence = self._model_evidence(self.other_enrollment, "best-fw-b.pt", "PROP_DIRECTION")
        self.teacher = get_user_model().objects.create_user(
            username="fw-teacher@example.test", password="Teacher-pass-902!", is_staff=True
        )
        TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=self.cohort)
        self.client.force_login(self.teacher)

    @staticmethod
    def _model_evidence(enrollment, filename, task_type):
        submission = next(
            item for item in ensure_growth_submissions(enrollment)
            if item.definition.slot_id == "R07"
        )
        return Evidence.objects.create(
            growth_submission=submission,
            evidence_type=Evidence.Type.MODEL,
            original_metadata={
                "filename": filename,
                "size_bytes": 2048,
                "task_type": task_type,
                "evidence_type": "YOLO_MODEL",
            },
            processed_metadata={"submission_status": "SUBMITTED"},
        )

    # 驗收 1：教師能看到有權限的模型
    def test_teacher_sees_only_authorized_models_with_four_status_dimensions(self):
        response = self.client.get(reverse("learning:teacher_vision_model_list"))

        self.assertContains(response, "best-fw-a.pt")
        self.assertNotContains(response, "best-fw-b.pt")
        for label in ("審核", "驗證", "訓練用途", "部署"):
            self.assertContains(response, label)
        self.assertContains(response, "SUBMITTED")

    # 驗收 2：學員私人模型不洩漏
    def test_unassigned_cohort_model_is_not_visible_or_openable(self):
        listing = self.client.get(reverse("learning:teacher_vision_model_list"))
        detail = self.client.get(
            reverse("learning:teacher_vision_model_detail", args=[self.other_evidence.pk])
        )
        verify = self.client.get(
            reverse("learning:teacher_vision_model_verify", args=[self.other_evidence.pk])
        )

        self.assertNotContains(listing, "best-fw-b.pt")
        self.assertEqual(detail.status_code, 404)
        self.assertEqual(verify.status_code, 404)

    def test_student_cannot_open_teacher_vision_pages(self):
        self.client.force_login(self.student.user)

        for name in (
            "learning:teacher_vision_model_list",
            "learning:teacher_vision_flywheel",
        ):
            response = self.client.get(reverse(name))
            self.assertNotEqual(response.status_code, 200)

    # 驗收 3：原有 Candidate / Return 流程不受影響
    def test_candidate_and_return_flow_still_works(self):
        candidate = self.client.post(
            reverse("learning:teacher_vision_model_review", args=[self.evidence.pk]),
            {"action": "candidate", "rule_template_id": "PROP_DIRECTION_V1", "note": "可進入候選。"},
        )
        self.assertEqual(candidate.status_code, 302)
        self.evidence.refresh_from_db()
        self.assertEqual(review_status_of(self.evidence), "CANDIDATE")

        returned = self.client.post(
            reverse("learning:teacher_vision_model_review", args=[self.evidence.pk]),
            {"action": "return", "rule_template_id": "PROP_DIRECTION_V1", "note": "請補說明。"},
        )
        self.assertEqual(returned.status_code, 302)
        self.evidence.refresh_from_db()
        self.assertEqual(review_status_of(self.evidence), "RETURNED")

    # 驗收 4：圖片驗證頁可開啟
    def test_verification_page_opens_with_required_sections(self):
        response = self.client.get(
            reverse("learning:teacher_vision_model_verify", args=[self.evidence.pk])
        )

        self.assertEqual(response.status_code, 200)
        for label in ("模型資訊", "圖片上傳區", "測試歷史紀錄", "PASS / NG / REVIEW"):
            self.assertContains(response, label)
        self.assertContains(response, "BBOX")

    # 驗收 5：沒有安全 Runner 時不可執行推論
    def test_runner_reports_unavailable_and_verification_is_blocked(self):
        self.assertFalse(runner_available())
        self.assertEqual(runner_state()["environment"], "NONE")
        self.assertFalse(verification_ready(self.evidence))

    def test_verification_button_is_disabled_and_run_does_not_infer(self):
        page = self.client.get(
            reverse("learning:teacher_vision_model_verify", args=[self.evidence.pk])
        )
        run = self.client.post(
            reverse("learning:teacher_vision_model_verify_run", args=[self.evidence.pk])
        )

        self.assertContains(page, "disabled")
        self.assertContains(page, "目前無法執行推論")
        self.assertEqual(run.status_code, 302)
        self.evidence.refresh_from_db()
        self.assertNotIn("vision_test_records", self.evidence.processed_metadata)

    # 驗收 6：未經 Golden Test 不可啟用 ACTIVE
    def test_active_is_blocked_without_golden_validation(self):
        self.assertEqual(validation_status_of(self.evidence), "NOT_EVALUATED")
        self.assertNotEqual(active_switch_blocked_reason(self.evidence), "")

        self.evidence.processed_metadata = {
            **self.evidence.processed_metadata,
            "vision_model_review": {"status": "CANDIDATE", "history": []},
        }
        self.evidence.save(update_fields=["processed_metadata"])
        self.assertNotEqual(active_switch_blocked_reason(self.evidence), "")

        self.evidence.processed_metadata = {
            **self.evidence.processed_metadata,
            "validation_status": "VALIDATED",
        }
        self.evidence.save(update_fields=["processed_metadata"])
        self.assertEqual(active_switch_blocked_reason(self.evidence), "")

    def test_default_dimensions_are_conservative(self):
        self.assertEqual(deployment_status_of(self.evidence), "CATALOGUED")
        self.assertEqual(training_usage_of(self.evidence), "NOT_FOR_TRAINING")
        self.assertEqual(validation_status_of(self.evidence), "NOT_EVALUATED")

    # 驗收 7：不影響既有 R07 上傳與學員前端
    def test_student_r07_page_and_upload_route_are_unchanged(self):
        self.enrollment.project_direction = "ai_flight_assessment"
        self.enrollment.save(update_fields=["project_direction"])
        self.client.force_login(self.student.user)

        detail = self.client.get(
            reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R07"])
        )

        self.assertEqual(detail.status_code, 200)
        self.assertContains(detail, "R07")
        self.assertTrue(reverse("learning:growth_model_upload", args=[self.enrollment.pk]))

    # 飛輪倉庫框架
    def test_flywheel_page_shows_framework_columns_and_stays_unpublished(self):
        response = self.client.get(reverse("learning:teacher_vision_flywheel"))

        self.assertEqual(response.status_code, 200)
        for column in ("版本", "父版本", "驗證", "訓練用途", "發布範圍"):
            self.assertContains(response, column)
        self.assertContains(response, "尚未啟用")
        self.other_evidence.refresh_from_db()
        self.assertNotIn("publication_scope", self.other_evidence.processed_metadata)
