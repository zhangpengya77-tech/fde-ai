import io
import re

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import Client, TestCase
from django.urls import reverse

from learning.models import Cohort, Enrollment, GrowthRecordSubmission, StudentProfile, TeacherCohortAccess


class QaAccountCommandTests(TestCase):
    def test_command_creates_verified_student_teacher_and_growth_records_with_random_passwords(self):
        output = io.StringIO()

        call_command("create_qa_accounts", stdout=output)

        student = StudentProfile.objects.get(email="qa-student@fde-ai.test")
        teacher = get_user_model().objects.get(email="qa-teacher@fde-ai.test")
        enrollment = Enrollment.objects.get(student=student)
        self.assertTrue(student.user.is_active)
        self.assertRegex(student.public_user_id, r"^FDE-26-[A-Z0-9]{6}$")
        self.assertEqual(student.nickname, "QA 測試學員")
        self.assertEqual(enrollment.cohort.cohort_id, "QA-2026-01")
        self.assertEqual(enrollment.group.name, "QA 測試組")
        self.assertEqual(GrowthRecordSubmission.objects.filter(enrollment=enrollment).count(), 8)
        self.assertTrue(teacher.is_active)
        self.assertTrue(teacher.is_staff)
        self.assertTrue(TeacherCohortAccess.objects.filter(teacher=teacher, cohort=enrollment.cohort).exists())

        credentials = dict(
            re.findall(r"^(student_password|teacher_password|student_email|student_fde_id|teacher_email)=(.+)$", output.getvalue(), re.MULTILINE)
        )
        self.assertEqual(
            set(credentials),
            {"student_password", "teacher_password", "student_email", "student_fde_id", "teacher_email"},
        )
        self.assertGreaterEqual(len(credentials["student_password"]), 20)
        self.assertGreaterEqual(len(credentials["teacher_password"]), 20)
        self.assertNotEqual(credentials["student_password"], credentials["teacher_password"])

        student_client = Client()
        student_login = student_client.post(
            reverse("learning:student_login"),
            {"username": credentials["student_email"], "password": credentials["student_password"]},
        )
        self.assertRedirects(student_login, reverse("learning:student_dashboard"))
        self.assertEqual(
            student_client.get(reverse("learning:student_growth_dashboard", args=[enrollment.pk])).status_code,
            200,
        )
        teacher_client = Client()
        teacher_login = teacher_client.post(
            reverse("learning:teacher_login"),
            {"username": credentials["teacher_email"], "password": credentials["teacher_password"]},
        )
        self.assertRedirects(teacher_login, reverse("learning:teacher_dashboard"))
        self.assertContains(teacher_client.get(reverse("learning:teacher_dashboard")), student.public_user_id)

        repeated = io.StringIO()
        call_command("create_qa_accounts", stdout=repeated)
        self.assertEqual(StudentProfile.objects.filter(email="qa-student@fde-ai.test").count(), 1)
        self.assertEqual(Enrollment.objects.filter(student=student).count(), 1)
        self.assertNotEqual(
            dict(re.findall(r"^(student_password|teacher_password)=(.+)$", repeated.getvalue(), re.MULTILINE))[
                "student_password"
            ],
            credentials["student_password"],
        )
