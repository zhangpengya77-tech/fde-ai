from django.contrib import admin
from django.contrib.auth import get_user_model
from django.test import RequestFactory, TestCase, override_settings
from django.urls import reverse

from learning.models import (
    CandidatePool,
    ClassCode,
    Cohort,
    Enrollment,
    Evidence,
    StudentProfile,
    StudentTaskProgress,
    TaskDefinition,
    TeacherCohortAccess,
    TeacherReviewEvent,
)
from learning.tests.helpers import create_student_account, enroll_student


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class TeacherWorkflowTests(TestCase):
    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="2026-01", name="2026 第一梯")
        self.student = create_student_account()
        self.enrollment = enroll_student(self.student, self.cohort)
        self.teacher = get_user_model().objects.create_user(
            username="teacher", email="teacher@example.com", password="Another-strong-passphrase-911!", is_staff=True
        )
        TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=self.cohort)
        self.task = TaskDefinition.objects.create(
            task_id="T06", sort_order=6, stage=TaskDefinition.Stage.BUILD, title="F450 組裝"
        )
        self.progress = StudentTaskProgress.objects.create(
            enrollment=self.enrollment, task=self.task, status=StudentTaskProgress.Status.SUBMITTED
        )

    def test_only_teacher_can_open_review_dashboard(self):
        self.client.force_login(self.student.user)
        response = self.client.get(reverse("learning:teacher_dashboard"))
        self.assertEqual(response.status_code, 302)

        self.client.force_login(self.teacher)
        response = self.client.get(reverse("learning:teacher_dashboard"))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, self.student.public_user_id)

    def test_teacher_cannot_read_or_review_an_unassigned_cohort(self):
        other_cohort = Cohort.objects.create(cohort_id="2026-02", name="2026 第二梯")
        other_teacher = get_user_model().objects.create_user(
            username="teacher2", email="teacher2@example.com", password="Another-strong-passphrase-912!", is_staff=True
        )
        TeacherCohortAccess.objects.create(teacher=other_teacher, cohort=other_cohort)
        self.client.force_login(other_teacher)

        detail = self.client.get(reverse("learning:teacher_student_detail", args=[self.enrollment.pk]))
        review = self.client.post(
            reverse("learning:review_task", args=[self.progress.pk]),
            {"result": TeacherReviewEvent.Result.REVIEWED, "note": "不能跨班查看", "score": ""},
        )

        self.assertEqual(detail.status_code, 404)
        self.assertEqual(review.status_code, 404)
        self.assertFalse(TeacherReviewEvent.objects.filter(progress=self.progress).exists())

    def test_teacher_review_persists_status_note_score_and_history(self):
        self.client.force_login(self.teacher)

        response = self.client.post(
            reverse("learning:review_task", args=[self.progress.pk]),
            {"result": TeacherReviewEvent.Result.REVIEWED, "note": "接線與方向確認完成", "score": "92.5"},
        )

        self.assertEqual(response.status_code, 302)
        self.progress.refresh_from_db()
        self.assertEqual(self.progress.status, StudentTaskProgress.Status.REVIEWED)
        self.assertEqual(self.progress.teacher_note, "接線與方向確認完成")
        self.assertEqual(str(self.progress.teacher_score), "92.50")
        self.assertIsNotNone(self.progress.reviewed_at)
        event = TeacherReviewEvent.objects.get(progress=self.progress)
        self.assertEqual(event.teacher, self.teacher)
        self.assertEqual(event.result, TeacherReviewEvent.Result.REVIEWED)

    def test_incomplete_review_can_be_resubmitted_without_deleting_history(self):
        self.client.force_login(self.teacher)
        self.client.post(
            reverse("learning:review_task", args=[self.progress.pk]),
            {"result": TeacherReviewEvent.Result.INCOMPLETE, "note": "請補一張照片", "score": ""},
        )
        self.progress.refresh_from_db()
        self.assertEqual(self.progress.status, StudentTaskProgress.Status.INCOMPLETE)
        self.assertEqual(TeacherReviewEvent.objects.filter(progress=self.progress).count(), 1)

        self.client.force_login(self.student.user)
        response = self.client.post(
            reverse("learning:task_detail", args=[self.enrollment.pk, "T06"]),
            {"status": StudentTaskProgress.Status.SUBMITTED, "student_note": "已補照片"},
        )
        self.assertEqual(response.status_code, 302)
        self.progress.refresh_from_db()
        self.assertEqual(self.progress.status, StudentTaskProgress.Status.SUBMITTED)
        self.assertEqual(TeacherReviewEvent.objects.filter(progress=self.progress).count(), 1)

    def test_teacher_must_explicitly_approve_candidate_promotion(self):
        evidence = Evidence.objects.create(
            progress=self.progress,
            evidence_type=Evidence.Type.GITHUB,
            external_url="https://github.com/example/fde-work",
            description="學員成果",
        )
        self.client.force_login(self.teacher)

        response = self.client.post(
            reverse("learning:promote_candidate", args=[str(evidence.pk)]),
            {"promote_to_dataset": "on", "promote_to_rag": ""},
        )

        self.assertEqual(response.status_code, 302)
        candidate = CandidatePool.objects.get(evidence=evidence)
        self.assertTrue(candidate.promote_to_dataset)
        self.assertFalse(candidate.promote_to_rag)
        self.assertEqual(candidate.approved_by_teacher, self.teacher)
        self.assertIsNotNone(candidate.approved_at)

    def test_audit_records_cannot_be_changed_or_deleted_in_admin(self):
        evidence = Evidence.objects.create(
            progress=self.progress,
            evidence_type=Evidence.Type.GITHUB,
            external_url="https://github.com/example/fde-work",
        )
        event = TeacherReviewEvent.objects.create(
            progress=self.progress,
            teacher=self.teacher,
            result=TeacherReviewEvent.Result.REVIEWED,
        )
        candidate = CandidatePool.objects.create(
            evidence=evidence, promote_to_rag=True, approved_by_teacher=self.teacher
        )
        request = RequestFactory().get("/admin/")
        request.user = get_user_model().objects.create_superuser(
            username="root", email="root@example.com", password="A-root-passphrase-984!"
        )

        profile_admin = admin.site._registry[StudentProfile]
        self.assertIn("public_user_id", profile_admin.get_readonly_fields(request, self.student))
        self.assertNotIn("email", profile_admin.get_fields(request, self.student))

        for record in (self.progress, evidence, event, candidate):
            model_admin = admin.site._registry[type(record)]
            self.assertFalse(model_admin.has_add_permission(request))
            self.assertFalse(model_admin.has_change_permission(request, record))
            self.assertFalse(model_admin.has_delete_permission(request, record))

    def test_class_code_admin_only_offers_assigned_cohorts(self):
        other_cohort = Cohort.objects.create(cohort_id="2026-02", name="2026 第二梯")
        request = RequestFactory().get("/admin/")
        request.user = self.teacher
        model_admin = admin.site._registry[ClassCode]

        field = model_admin.formfield_for_foreignkey(ClassCode._meta.get_field("cohort"), request)

        self.assertQuerySetEqual(field.queryset.order_by("cohort_id"), [self.cohort], transform=lambda item: item)
        self.assertNotIn(other_cohort, field.queryset)
