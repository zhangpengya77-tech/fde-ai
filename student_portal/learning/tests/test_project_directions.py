from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse

from learning.project_directions import (
    direction_keys,
    direction_label,
    load_project_directions,
    task_display_id,
    student_status_label,
)
from learning.models import Cohort, Enrollment, TaskDefinition, TeacherCohortAccess
from learning.tests.helpers import create_student_account, enroll_student


class ProjectDirectionConfigurationTests(TestCase):
    def test_four_project_directions_have_direction_specific_growth_content(self):
        directions = load_project_directions()

        self.assertEqual(set(direction_keys()), {"flight_f450", "autonomous_mission", "ai_flight_assessment", "uav_3d_mapping"})
        for key in direction_keys():
            self.assertTrue(directions[key]["title"])
            for slot_id in ("R06", "R07", "R08"):
                self.assertTrue(directions[key][slot_id]["title"])
                self.assertTrue(directions[key][slot_id]["what_to_do"])
                self.assertTrue(directions[key][slot_id]["deliverables"])
                self.assertTrue(directions[key][slot_id]["learning_goal"])

        self.assertTrue(any("Meshroom" in item for item in directions["uav_3d_mapping"]["R06"]["what_to_do"]))
        self.assertTrue(directions["uav_3d_mapping"]["R06"]["optional"]["3d_printing"])
        self.assertTrue(directions["ai_flight_assessment"]["R06"]["teacher_provided"]["dataflash_log"])

    def test_shared_growth_records_and_display_mappings_are_stable(self):
        shared = load_project_directions()["shared_growth_records"]
        self.assertEqual([item["slot_id"] for item in shared], [f"R{i:02d}" for i in range(1, 6)])
        self.assertEqual(task_display_id("T01"), "M01")
        self.assertEqual(task_display_id("T12"), "M12")
        self.assertEqual(student_status_label("not_started"), "○ 未開始")
        self.assertEqual(student_status_label("submitted"), "待教師複核")
        self.assertEqual(student_status_label("approved"), "✅ 已完成")


class ProjectDirectionEnrollmentTests(TestCase):
    def setUp(self):
        self.profile = create_student_account("direction@example.com", "Direction")
        self.cohort = Cohort.objects.create(cohort_id="2026-09", name="2026 第九期")
        self.enrollment = enroll_student(self.profile, self.cohort)
        self.client.force_login(self.profile.user)

    def test_old_enrollment_without_direction_remains_valid(self):
        self.assertIsNone(self.enrollment.project_direction)
        response = self.client.get(reverse("learning:student_course_dashboard", args=[self.enrollment.pk]))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "選擇本期專案方向")

    def test_student_can_select_and_save_direction_on_enrollment(self):
        response = self.client.post(
            reverse("learning:select_project_direction", args=[self.enrollment.pk]),
            {"project_direction": "uav_3d_mapping"},
        )

        self.assertRedirects(response, reverse("learning:student_course_dashboard", args=[self.enrollment.pk]))
        self.enrollment.refresh_from_db()
        self.assertEqual(self.enrollment.project_direction, "uav_3d_mapping")
        page = self.client.get(reverse("learning:student_course_dashboard", args=[self.enrollment.pk]))
        self.assertContains(page, "無人機 3D 測繪")
        self.assertContains(page, "空拍")
        self.assertContains(page, "Meshroom")
        self.assertContains(page, "3D 模型")

    def test_teacher_facing_direction_label_is_available(self):
        self.enrollment.project_direction = "flight_f450"
        self.enrollment.save(update_fields=["project_direction"])
        self.assertEqual(direction_label(self.enrollment.project_direction), "F450 組裝與飛行")

    def test_teacher_can_update_enrollment_direction(self):
        teacher = get_user_model().objects.create_user(
            username="direction-teacher", password="Strong-passphrase-900!", is_staff=True
        )
        TeacherCohortAccess.objects.create(teacher=teacher, cohort=self.cohort)
        self.client.force_login(teacher)
        response = self.client.post(
            reverse("learning:teacher_update_project_direction", args=[self.enrollment.pk]),
            {"project_direction": "autonomous_mission"},
        )
        self.assertRedirects(response, reverse("learning:teacher_student_detail", args=[self.enrollment.pk]))
        self.enrollment.refresh_from_db()
        self.assertEqual(self.enrollment.project_direction, "autonomous_mission")

    def test_student_growth_page_explains_optional_and_teacher_provided_items(self):
        self.enrollment.project_direction = "ai_flight_assessment"
        self.enrollment.save(update_fields=["project_direction"])
        response = self.client.get(reverse("learning:student_growth_dashboard", args=[self.enrollment.pk]))
        self.assertContains(response, "教師提供資料")
        self.assertContains(response, "DataFlash Log")

        self.enrollment.project_direction = "uav_3d_mapping"
        self.enrollment.save(update_fields=["project_direction"])
        response = self.client.get(reverse("learning:student_growth_dashboard", args=[self.enrollment.pk]))
        self.assertContains(response, "延伸選修")
        self.assertContains(response, "3D列印")

    def test_teacher_dashboard_shows_enrollment_project_direction(self):
        teacher = get_user_model().objects.create_user(
            username="direction-teacher-dashboard", password="Strong-passphrase-900!", is_staff=True
        )
        TeacherCohortAccess.objects.create(teacher=teacher, cohort=self.cohort)
        self.enrollment.project_direction = "flight_f450"
        self.enrollment.save(update_fields=["project_direction"])
        self.client.force_login(teacher)
        response = self.client.get(reverse("learning:teacher_dashboard"))
        self.assertContains(response, "F450 組裝與飛行")


class TaskIdentifierCompatibilityTests(TestCase):
    def test_internal_task_ids_remain_t01_to_t12(self):
        for index in range(1, 13):
            TaskDefinition.objects.create(
                task_id=f"T{index:02d}",
                sort_order=index,
                stage=TaskDefinition.Stage.LEARN,
                title=f"任務 {index}",
            )
        self.assertEqual(
            list(TaskDefinition.objects.values_list("task_id", flat=True)),
            [f"T{i:02d}" for i in range(1, 13)],
        )

    def test_task_detail_uses_m_display_identifier(self):
        profile = create_student_account("task-direction@example.com", "Task Direction")
        cohort = Cohort.objects.create(cohort_id="2026-10", name="2026 第十期")
        enrollment = enroll_student(profile, cohort)
        task = TaskDefinition.objects.create(
            task_id="T01",
            sort_order=1,
            stage=TaskDefinition.Stage.LEARN,
            title="安全基礎",
        )
        self.client = self.client_class()
        self.client.force_login(profile.user)
        response = self.client.get(reverse("learning:task_detail", args=[enrollment.pk, task.task_id]))
        self.assertContains(response, "M01")
