from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse

from learning.models import (
    ClassCode,
    Cohort,
    Enrollment,
    StudentTaskProgress,
    TaskDefinition,
    TeacherCohortAccess,
)
from learning.tests.helpers import create_student_account


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class EnrollmentWorkflowTests(TestCase):
    def setUp(self):
        call_command("seed_tasks", verbosity=0)
        self.profile = create_student_account()
        self.client.force_login(self.profile.user)
        self.first_cohort = Cohort.objects.create(cohort_id="2026-01", name="2026 第一梯")
        self.second_cohort = Cohort.objects.create(cohort_id="2026-02", name="2026 第二梯")
        self.first_code = ClassCode.objects.create(code="FDE2601", cohort=self.first_cohort)
        self.second_code = ClassCode.objects.create(code="FDE2602", cohort=self.second_cohort)

    def join(self, code):
        return self.client.post(reverse("learning:join_cohort"), {"class_code": code})

    def test_class_code_joins_student_and_initializes_course_tasks(self):
        response = self.join("fde2601")

        self.assertRedirects(response, reverse("learning:student_dashboard"))
        enrollment = Enrollment.objects.get(student=self.profile, cohort=self.first_cohort)
        self.assertEqual(enrollment.task_progress.count(), 12)
        self.assertEqual(enrollment.phase_progress.count(), 5)
        self.assertEqual(self.first_code.__class__.objects.get(pk=self.first_code.pk).use_count, 1)

    def test_duplicate_join_is_idempotent_and_course_progress_is_separate(self):
        self.join("FDE2601")
        first = Enrollment.objects.get(student=self.profile, cohort=self.first_cohort)
        task = TaskDefinition.objects.get(task_id="T01")
        StudentTaskProgress.objects.filter(enrollment=first, task=task).update(student_note="第一門課紀錄")

        self.join("FDE2601")
        self.join("FDE2602")

        self.assertEqual(Enrollment.objects.filter(student=self.profile).count(), 2)
        self.assertEqual(ClassCode.objects.get(pk=self.first_code.pk).use_count, 1)
        second = Enrollment.objects.get(student=self.profile, cohort=self.second_cohort)
        second_progress = StudentTaskProgress.objects.get(enrollment=second, task=task)
        self.assertEqual(second_progress.student_note, "")

    def test_invalid_code_does_not_create_enrollment(self):
        response = self.join("NOT-A-CODE")

        self.assertEqual(response.status_code, 200)
        self.assertFalse(Enrollment.objects.filter(student=self.profile).exists())
        self.assertContains(response, "無效或已失效")

    def test_teacher_can_find_registered_account_by_id_and_nickname_without_full_email(self):
        TeacherCohortAccess.objects.create(
            teacher=get_user_model().objects.create_user(
                username="teacher", email="teacher@example.com", password="Teacher-passphrase-984!", is_staff=True
            ),
            cohort=self.first_cohort,
        )
        self.client.force_login(get_user_model().objects.get(username="teacher"))

        response = self.client.get(reverse("learning:teacher_dashboard"), {"q": self.profile.public_user_id})

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, self.profile.public_user_id)
        self.assertContains(response, "Eagle")
        self.assertContains(response, "st***@example.com")
        self.assertNotContains(response, "student@example.com")
        self.assertContains(response, "尚未加入課程")

    def test_teacher_dashboard_shows_course_progress_and_scoped_details(self):
        teacher = get_user_model().objects.create_user(
            username="teacher", email="teacher@example.com", password="Teacher-passphrase-984!", is_staff=True
        )
        TeacherCohortAccess.objects.create(teacher=teacher, cohort=self.first_cohort)
        self.join("FDE2601")
        enrollment = Enrollment.objects.get(student=self.profile, cohort=self.first_cohort)
        task = TaskDefinition.objects.get(task_id="T01")
        StudentTaskProgress.objects.filter(enrollment=enrollment, task=task).update(status=StudentTaskProgress.Status.REVIEWED)
        self.client.force_login(teacher)

        response = self.client.get(reverse("learning:teacher_dashboard"), {"q": "Eagle"})

        self.assertContains(response, "1 / 12")
        self.assertContains(response, "2026-01")
        detail = self.client.get(reverse("learning:teacher_student_detail", args=[enrollment.pk]))
        self.assertEqual(detail.status_code, 200)

        other_teacher = get_user_model().objects.create_user(
            username="other-teacher", email="other@example.com", password="Teacher-passphrase-985!", is_staff=True
        )
        self.client.force_login(other_teacher)
        forbidden = self.client.get(reverse("learning:teacher_student_detail", args=[enrollment.pk]))
        self.assertEqual(forbidden.status_code, 404)
