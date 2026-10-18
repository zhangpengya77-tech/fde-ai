from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from unittest.mock import patch

from learning.growth_records import ensure_growth_submissions
from learning.models import Cohort, Evidence, LearningGroup, TeacherCohortAccess
from learning.tests.helpers import create_student_account, enroll_student


class TeacherVisionModelCenterTests(TestCase):
    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="VM-A", name="視覺模型班 A")
        self.other_cohort = Cohort.objects.create(cohort_id="VM-B", name="視覺模型班 B")
        self.student = create_student_account("vision-a@example.test", "學員 A")
        self.other_student = create_student_account("vision-b@example.test", "學員 B")
        self.enrollment = enroll_student(self.student, self.cohort)
        self.other_enrollment = enroll_student(self.other_student, self.other_cohort)
        self.evidence = self._model_evidence(self.enrollment, "best-a.pt", "PROP_DIRECTION")
        self.other_evidence = self._model_evidence(self.other_enrollment, "best-b.pt", "FOUR_SIDE_HOVER")
        self.teacher = get_user_model().objects.create_user(
            username="vision-teacher@example.test", password="Teacher-pass-901!", is_staff=True
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

    def test_teacher_lists_only_models_from_assigned_cohorts(self):
        response = self.client.get(reverse("learning:teacher_vision_model_list"))

        self.assertContains(response, "best-a.pt")
        self.assertNotContains(response, "best-b.pt")

    @patch("learning.views.vision_api.list_models", return_value=[])
    @patch("learning.views.vision_api.vision_api_health", return_value=(True, "ok"))
    def test_model_center_is_one_vertical_four_step_page(self, _health, _models):
        response = self.client.get(reverse("learning:teacher_vision_model_list"))

        content = response.content.decode("utf-8")
        headings = [
            "01｜學員模型提交",
            "02｜教師圖片驗證",
            "03｜確認並啟用網站模型",
            "04｜下一期教學模型資源庫",
        ]
        positions = [content.index(heading) for heading in headings]
        self.assertEqual(positions, sorted(positions))
        self.assertNotContains(response, "區域一｜")
        self.assertNotContains(response, "區域二｜")
        self.assertNotContains(response, "區域三｜")
        self.assertNotContains(response, "區域四｜")

    @patch("learning.views.vision_api.list_models", return_value=[])
    @patch("learning.views.vision_api.vision_api_health", return_value=(True, "ok"))
    def test_selecting_r07_model_populates_step_two_and_preserves_group(self, _health, _models):
        group = LearningGroup.objects.create(cohort=self.cohort, code="A", name="槳葉方向組")
        self.enrollment.group = group
        self.enrollment.save(update_fields=["group"])

        response = self.client.get(
            reverse("learning:teacher_vision_model_list"),
            {"model": self.evidence.pk},
        )

        self.assertContains(response, 'id="step-2"')
        self.assertContains(response, "A｜槳葉方向組")
        self.assertContains(response, self.student.nickname)
        self.assertContains(response, self.student.public_user_id)
        self.assertContains(response, "best-a.pt")
        self.assertContains(response, f"?model={self.evidence.pk}#step-2")

    @patch("learning.views.vision_api.list_models", return_value=[])
    @patch("learning.views.vision_api.vision_api_health", return_value=(True, "ok"))
    def test_missing_group_is_shown_as_not_configured(self, _health, _models):
        response = self.client.get(reverse("learning:teacher_vision_model_list"))

        self.assertContains(response, "未設定")

    @patch(
        "learning.views.vision_api.vision_api_health",
        return_value=(False, "vision_api_unavailable"),
    )
    def test_api_outage_shows_teacher_friendly_block_reason(self, _health):
        response = self.client.get(reverse("learning:teacher_vision_model_list"))

        self.assertContains(response, "Vision API 目前無法連線")
        self.assertNotContains(response, ">vision_api_unavailable<")

    @patch("learning.views.vision_api.list_models", return_value=[])
    @patch("learning.views.vision_api.vision_api_health", return_value=(True, "ok"))
    def test_demo_only_model_cannot_start_real_image_validation(self, _health, _models):
        metadata = dict(self.evidence.original_metadata)
        metadata["is_demo_test_only"] = True
        self.evidence.original_metadata = metadata
        self.evidence.save(update_fields=["original_metadata"])

        response = self.client.get(
            reverse("learning:teacher_vision_model_list"),
            {"model": self.evidence.pk},
        )

        self.assertContains(response, "DEMO_TEST_ONLY 僅供流程展示，不得執行真實模型推論")
        self.assertContains(response, 'id="test-image"', html=False)
        self.assertContains(response, "disabled")

    def test_teacher_cannot_open_model_from_unassigned_cohort(self):
        response = self.client.get(
            reverse("learning:teacher_vision_model_detail", args=[self.other_evidence.pk])
        )

        self.assertEqual(response.status_code, 404)

    def test_candidate_review_records_fixed_template_and_teacher_note(self):
        response = self.client.post(
            reverse("learning:teacher_vision_model_review", args=[self.evidence.pk]),
            {
                "action": "candidate",
                "rule_template_id": "PROP_DIRECTION_V1",
                "note": "可進入候選檢查。",
            },
        )

        self.assertRedirects(
            response,
            reverse("learning:teacher_vision_model_detail", args=[self.evidence.pk]),
        )
        self.evidence.refresh_from_db()
        review = self.evidence.processed_metadata["vision_model_review"]
        self.assertEqual(review["status"], "CANDIDATE")
        self.assertEqual(review["rule_template_id"], "PROP_DIRECTION_V1")
        self.assertEqual(review["current_note"], "可進入候選檢查。")
        self.assertEqual(review["history"][-1]["action"], "CANDIDATE")

    def test_teacher_pages_show_the_fixed_template_and_dashboard_entry(self):
        dashboard = self.client.get(reverse("learning:teacher_dashboard"))
        detail = self.client.get(
            reverse("learning:teacher_vision_model_detail", args=[self.evidence.pk])
        )

        self.assertContains(dashboard, "視覺模型中心")
        self.assertContains(detail, "PROP_DIRECTION_V1")
        self.assertContains(detail, "M1 右前、M2 左後、M3 左前、M4 右後。")
        self.assertContains(detail, "私有下載")

    def test_student_r07_shows_candidate_review_status_after_refresh(self):
        self.enrollment.project_direction = "ai_flight_assessment"
        self.enrollment.save(update_fields=["project_direction"])
        self.evidence.processed_metadata["vision_model_review"] = {
            "status": "CANDIDATE",
            "rule_template_id": "PROP_DIRECTION_V1",
            "current_note": "可進入候選檢查。",
            "history": [],
        }
        self.evidence.save(update_fields=["processed_metadata"])
        self.client.force_login(self.student.user)

        response = self.client.get(
            reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R07"])
        )

        self.assertContains(response, "已列為候選")
        self.assertContains(response, "可進入候選檢查。")
    def test_return_review_persists_teacher_note(self):
        response = self.client.post(
            reverse("learning:teacher_vision_model_review", args=[self.evidence.pk]),
            {
                "action": "return",
                "rule_template_id": "PROP_DIRECTION_V1",
                "note": "請補上類別說明。",
            },
        )

        self.assertEqual(response.status_code, 302)
        self.evidence.refresh_from_db()
        review = self.evidence.processed_metadata["vision_model_review"]
        self.assertEqual(review["status"], "RETURNED")
        self.assertEqual(review["history"][-1]["action"], "RETURNED")

    def test_candidate_review_never_calls_vision_submission_or_marks_active(self):
        with patch("learning.views.submit_model_evidence_to_vision") as submit:
            response = self.client.post(
                reverse("learning:teacher_vision_model_review", args=[self.evidence.pk]),
                {
                    "action": "candidate",
                    "rule_template_id": "PROP_DIRECTION_V1",
                },
            )

        self.assertEqual(response.status_code, 302)
        submit.assert_not_called()
        self.evidence.refresh_from_db()
        self.assertEqual(self.evidence.processed_metadata["vision_model_review"]["status"], "CANDIDATE")
        self.assertNotIn("ACTIVE", self.evidence.processed_metadata["vision_model_review"].values())
    def test_cross_task_template_is_rejected_without_changing_metadata(self):
        response = self.client.post(
            reverse("learning:teacher_vision_model_review", args=[self.evidence.pk]),
            {
                "action": "candidate",
                "rule_template_id": "FOUR_SIDE_HOVER_V1",
                "note": "偽造模板。",
            },
        )

        self.assertEqual(response.status_code, 400)
        self.evidence.refresh_from_db()
        self.assertNotIn("vision_model_review", self.evidence.processed_metadata)
