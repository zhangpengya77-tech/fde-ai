from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse

from learning.models import (
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
        teacher = get_user_model().objects.create_user(
            username="course-teacher", email="course-teacher@example.com", password="Teacher-passphrase-986!", is_staff=True
        )
        TeacherCohortAccess.objects.create(teacher=teacher, cohort=self.first_cohort)
        TeacherCohortAccess.objects.create(teacher=teacher, cohort=self.second_cohort)

    def join(self, cohort):
        return self.client.post(reverse("learning:join_cohort"), {"cohort_id": cohort.pk})

    def test_join_page_shows_open_courses_without_an_invite_code(self):
        response = self.client.get(reverse("learning:join_cohort"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, self.first_cohort.name)
        self.assertContains(response, self.second_cohort.name)
        self.assertNotContains(response, "課程邀請碼")
        self.assertNotContains(response, "class_code")

    def test_student_can_join_active_course_and_open_it_directly(self):
        response = self.join(self.first_cohort)

        enrollment = Enrollment.objects.get(student=self.profile, cohort=self.first_cohort)
        self.assertRedirects(
            response,
            reverse("learning:student_course_dashboard", args=[enrollment.pk]),
        )
        self.assertEqual(enrollment.task_progress.count(), 12)
        self.assertEqual(enrollment.phase_progress.count(), 5)

    def test_duplicate_join_is_idempotent_and_course_progress_is_separate(self):
        self.join(self.first_cohort)
        first = Enrollment.objects.get(student=self.profile, cohort=self.first_cohort)
        task = TaskDefinition.objects.get(task_id="T01")
        StudentTaskProgress.objects.filter(enrollment=first, task=task).update(student_note="第一門課紀錄")

        self.join(self.first_cohort)
        self.join(self.second_cohort)

        self.assertEqual(Enrollment.objects.filter(student=self.profile).count(), 2)
        second = Enrollment.objects.get(student=self.profile, cohort=self.second_cohort)
        second_progress = StudentTaskProgress.objects.get(enrollment=second, task=task)
        self.assertEqual(second_progress.student_note, "")

    def test_inactive_course_cannot_be_joined(self):
        inactive = Cohort.objects.create(cohort_id="2026-03", name="已關閉課程", active=False)
        response = self.client.post(
            reverse("learning:join_cohort"), {"cohort_id": inactive.pk}, follow=True
        )

        self.assertRedirects(response, reverse("learning:join_cohort"))
        self.assertFalse(Enrollment.objects.filter(student=self.profile).exists())
        self.assertContains(response, "這門課程目前未開放加入")

    def test_unassigned_active_course_is_not_publicly_joinable(self):
        internal_cohort = Cohort.objects.create(cohort_id="2026-04", name="內部測試期別")
        page = self.client.get(reverse("learning:join_cohort"))

        self.assertNotContains(page, internal_cohort.name)
        response = self.client.post(
            reverse("learning:join_cohort"), {"cohort_id": internal_cohort.pk}, follow=True
        )

        self.assertFalse(Enrollment.objects.filter(student=self.profile, cohort=internal_cohort).exists())
        self.assertContains(response, "這門課程目前未開放加入")

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
        self.join(self.first_cohort)
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
