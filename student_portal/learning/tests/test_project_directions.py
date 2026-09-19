from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse

from learning.project_directions import (
    direction_keys,
    direction_label,
    direction_content,
    direction_overview,
    load_project_directions,
    task_display_id,
    student_status_label,
)
from learning.models import Cohort, Enrollment, TaskDefinition, TeacherCohortAccess
from learning.tests.helpers import create_student_account, enroll_student


class ProjectDirectionConfigurationTests(TestCase):
    def test_r06_and_r08_are_shared_while_r07_is_direction_specific(self):
        directions = load_project_directions()

        self.assertEqual(set(direction_keys()), {"flight_f450", "autonomous_mission", "ai_flight_assessment", "uav_3d_mapping"})
        shared = {item["slot_id"]: item for item in directions["shared_growth_records"]}
        for slot_id in ("R06", "R08"):
            self.assertTrue(shared[slot_id]["title"])
            self.assertTrue(shared[slot_id]["what_to_do"])
            self.assertTrue(shared[slot_id]["deliverables"])
            self.assertTrue(shared[slot_id]["learning_goal"])
        for key in direction_keys():
            self.assertTrue(directions[key]["title"])
            self.assertTrue(directions[key]["R07"]["title"])
            self.assertTrue(directions[key]["R07"]["what_to_do"])
            self.assertTrue(directions[key]["R07"]["deliverables"])
            self.assertTrue(directions[key]["R07"]["learning_goal"])

        self.assertIn("YOLO", " ".join(directions["ai_flight_assessment"]["R07"]["what_to_do"]))
        self.assertIn("Meshroom", " ".join(directions["uav_3d_mapping"]["R07"]["what_to_do"]))

    def test_r06_and_r07_use_the_final_classroom_positioning(self):
        directions = load_project_directions()
        shared = {item["slot_id"]: item for item in directions["shared_growth_records"]}

        self.assertEqual(shared["R06"]["title"], "鷹眼 AI 目標檢測")
        r06_text = " ".join(
            shared["R06"]["what_to_do"]
            + shared["R06"]["deliverables"]
            + [shared["R06"]["learning_goal"]]
        )
        for term in ("CW", "CCW", "正面", "反面", "PASS", "NG", "四面懸停"):
            self.assertIn(term, r06_text)

        expected_directions = {
            "ai_flight_assessment": "AI 目標檢測與模型訓練",
            "uav_3d_mapping": "測繪／3D 建模與列印",
            "autonomous_mission": "航線規劃與任務執行",
            "flight_f450": "無人機組裝與考照",
        }
        for key, label in expected_directions.items():
            self.assertEqual(directions[key]["title"], label)

        self.assertEqual(
            directions["ai_flight_assessment"]["R07"]["title"],
            "AI 目標檢測與模型訓練",
        )
        self.assertEqual(
            directions["uav_3d_mapping"]["R07"]["title"],
            "測繪／3D 建模與列印",
        )
        self.assertEqual(
            directions["autonomous_mission"]["R07"]["title"],
            "航線規劃與任務執行",
        )
        self.assertEqual(
            directions["flight_f450"]["R07"]["title"],
            "無人機組裝與考照",
        )

        self.assertEqual(
            [item["label"] for item in direction_overview()],
            ["AI 目標檢測與模型訓練", "測繪／3D 建模與列印", "航線規劃與任務執行", "無人機組裝與考照"],
        )

    def test_direction_content_uses_common_r06_and_r08(self):
        profile = create_student_account("shared-records@example.com", "Shared Records")
        cohort = Cohort.objects.create(cohort_id="2026-11", name="2026 第十一期")
        enrollment = enroll_student(profile, cohort)
        for key in direction_keys():
            enrollment.project_direction = key
            self.assertEqual(direction_content(enrollment, "R06")["title"], "鷹眼 AI 目標檢測")
            self.assertEqual(direction_content(enrollment, "R08")["title"], "綜合成果作品展示")
        enrollment.project_direction = "flight_f450"
        self.assertEqual(direction_content(enrollment, "R07")["title"], "無人機組裝與考照")

    def test_shared_growth_records_and_display_mappings_are_stable(self):
        shared = load_project_directions()["shared_growth_records"]
        self.assertEqual([item["slot_id"] for item in shared], ["R01", "R02", "R03", "R04", "R05", "R06", "R08"])
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
        self.assertContains(page, "測繪／3D 建模與列印")
        growth_page = self.client.get(reverse("learning:student_growth_dashboard", args=[self.enrollment.pk]))
        self.assertContains(growth_page, "專業任務驗證")
        self.assertContains(growth_page, "測繪／3D 建模與列印")
        self.assertNotContains(growth_page, "空拍")
        self.assertContains(growth_page, "進入記錄")
        self.assertNotContains(growth_page, "Meshroom")
        detail_page = self.client.get(
            reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R07"])
        )
        self.assertContains(detail_page, "Meshroom")

    def test_teacher_facing_direction_label_is_available(self):
        self.enrollment.project_direction = "flight_f450"
        self.enrollment.save(update_fields=["project_direction"])
        self.assertEqual(direction_label(self.enrollment.project_direction), "無人機組裝與考照")

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

    def test_teacher_growth_detail_uses_common_r06_r08_and_directional_r07_content(self):
        teacher = get_user_model().objects.create_user(
            username="direction-teacher-detail", password="Strong-passphrase-902!", is_staff=True
        )
        TeacherCohortAccess.objects.create(teacher=teacher, cohort=self.cohort)
        self.enrollment.project_direction = "flight_f450"
        self.enrollment.save(update_fields=["project_direction"])
        self.client.force_login(teacher)

        response = self.client.get(
            reverse("learning:teacher_student_detail", args=[self.enrollment.pk])
        )

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "專業任務驗證")
        self.assertContains(response, "鷹眼 AI 目標檢測")
        self.assertContains(response, "無人機組裝與考照")
        self.assertContains(response, "綜合成果作品展示")

    def test_student_growth_page_explains_optional_and_teacher_provided_items(self):
        self.enrollment.project_direction = "ai_flight_assessment"
        self.enrollment.save(update_fields=["project_direction"])
        response = self.client.get(
            reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R07"])
        )
        self.assertContains(response, "DataFlash Log")

        self.enrollment.project_direction = "uav_3d_mapping"
        self.enrollment.save(update_fields=["project_direction"])
        response = self.client.get(
            reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R07"])
        )
        self.assertContains(response, "Meshroom")
        self.assertContains(response, "Fusion 360")

    def test_growth_page_keeps_r07_as_a_card_without_direction_details(self):
        response = self.client.get(reverse("learning:student_growth_dashboard", args=[self.enrollment.pk]))
        self.assertContains(response, "專業任務驗證")
        self.assertContains(response, "R07")
        self.assertContains(response, "進入記錄")
        self.assertContains(response, "依專業方向完成本期行業應用任務驗證。")
        self.assertNotContains(response, "r07-directions-title")
        for label in ("AI 目標檢測與模型訓練", "測繪／3D 建模與列印", "航線規劃與任務執行", "無人機組裝與考照"):
            self.assertNotContains(response, label)

        self.assertContains(response, "鷹眼 AI 目標檢測")

    def test_r07_detail_page_shows_all_directions_before_selection(self):
        response = self.client.get(
            reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R07"])
        )
        self.assertContains(response, "R07｜專業任務驗證")
        for label in ("AI 目標檢測與模型訓練", "測繪／3D 建模與列印", "航線規劃與任務執行", "無人機組裝與考照"):
            self.assertContains(response, label)

    def test_r07_detail_keeps_direction_content_below_overview_and_uploads(self):
        self.enrollment.project_direction = "ai_flight_assessment"
        self.enrollment.save(update_fields=["project_direction"])
        response = self.client.get(
            reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R07"])
        )
        self.assertContains(response, "AI")
        self.assertContains(response, "照片證據")
        self.assertContains(response, "照片 0 / 5")
        self.assertContains(response, "新增照片")
        self.assertEqual(response.content.decode().count("＋新增照片"), 1)
        self.assertContains(response, 'id="id_images"')
        self.assertContains(response, 'id="id_video"')
        self.assertContains(response, "保存草稿")
        self.assertContains(response, "提交教師複核")

    def test_teacher_dashboard_shows_enrollment_project_direction(self):
        teacher = get_user_model().objects.create_user(
            username="direction-teacher-dashboard", password="Strong-passphrase-900!", is_staff=True
        )
        TeacherCohortAccess.objects.create(teacher=teacher, cohort=self.cohort)
        self.enrollment.project_direction = "flight_f450"
        self.enrollment.save(update_fields=["project_direction"])
        self.client.force_login(teacher)
        response = self.client.get(reverse("learning:teacher_dashboard"))
        self.assertContains(response, "無人機組裝與考照")

    def test_teacher_dashboard_shows_enrollment_training_source(self):
        teacher = get_user_model().objects.create_user(
            username="training-source-teacher", password="Strong-passphrase-901!", is_staff=True
        )
        TeacherCohortAccess.objects.create(teacher=teacher, cohort=self.cohort)
        self.enrollment.training_source = "in_service"
        self.enrollment.save(update_fields=["training_source"])
        self.client.force_login(teacher)
        response = self.client.get(reverse("learning:teacher_dashboard"))
        self.assertContains(response, "班型來源")
        self.assertContains(response, "在職培訓")


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
