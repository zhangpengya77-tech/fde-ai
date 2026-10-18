"""學員五階段學習工作台（P1，2026-10-12 教師指令）HTTP 層驗收。

驗證重點（教師指令第二、三、四、六節）：
  1. 頁面可開啟，含「學 → 練 → 做 → 測 → 證」五階段路徑與目前學習階段。
  2. 進度、狀態、教師回饋一律取自真實資料；無資料時明確顯示「尚無」，不使用假資料。
  3. 已存在的功能入口可連結（學習平台、下載中心、Live 教練、M1–M4 辨識、飛行健康）。
  4. 未接入的獨立模組（F450 數位孿生）只顯示「待接入」，不得顯示成可正常使用。
  5. 規劃中專項標示「規劃中」，不建立假功能。
  6. 未登入不得存取；非本人課程 404。
  7. 凍結保護項不受影響：R07 上傳路由、M1–M4 辨識頁、成長日誌照常運作。
"""
import re
from pathlib import Path

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse

from learning.models import Cohort, GrowthRecordReview, PhaseProgress, StudentTaskProgress, TaskDefinition
from learning.tests.helpers import create_student_account, enroll_student


class LearningPathWorkbenchTests(TestCase):
    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="LP-2026", name="工作台測試班")
        self.student = create_student_account("lp-student@example.test", "工作台學員")
        self.enrollment = enroll_student(self.student, self.cohort)
        self.user = self.student.user
        self.url = reverse("learning:student_learning_path", args=[self.enrollment.pk])
        self.entry_url = reverse("learning:student_learning_path_entry")

    def test_requires_login(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 302)
        self.assertIn("/login/", response["Location"])

    def test_other_student_gets_404(self):
        outsider = create_student_account("lp-outsider@example.test", "校外學員")
        self.client.force_login(outsider.user)
        self.assertEqual(self.client.get(self.url).status_code, 404)

    def test_page_opens_with_five_stage_path(self):
        self.client.force_login(self.user)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "五階段學習工作台")
        for title in ("學習知識", "模擬與練習", "專項實訓", "能力考核", "成長日誌"):
            self.assertContains(response, title)
        self.assertContains(response, "學 → 練 → 做 → 測 → 證")

    def test_growth_records_show_real_status_and_counts(self):
        self.client.force_login(self.user)
        response = self.client.get(self.url)
        for slot in ("R01", "R02", "R03", "R04", "R05", "R06", "R07", "R08"):
            self.assertContains(response, slot)
        # 真實計數：尚無提交時必須是 0，不得出現假進度。
        self.assertContains(response, "0 / 8")
        self.assertNotContains(response, "100%")

    def test_links_existing_safe_entries(self):
        self.client.force_login(self.user)
        response = self.client.get(self.url)
        body = response.content.decode("utf-8")
        for expected in (
            "/downloads/",
            "/live/",
            "/flight-health/",
            reverse("learning:student_prop_scan", args=[self.enrollment.pk]),
            reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R01"]),
            reverse("learning:student_growth_dashboard", args=[self.enrollment.pk]),
            reverse("learning:platform"),
        ):
            self.assertIn(expected, body)

    def test_f450_module_marked_pending_and_not_linked(self):
        self.client.force_login(self.user)
        response = self.client.get(self.url)
        body = response.content.decode("utf-8")
        self.assertContains(response, "F450 數位孿生")
        self.assertContains(response, "待接入")
        # 未接入模組不得包在可點擊連結中，也不得出現假可用網址。
        self.assertIsNone(re.search(r"<a[^>]*>\s*F450 數位孿生", body))
        self.assertIsNone(re.search(r'href="[^"]*孿生[^"]*"', body))

    def test_planned_modules_marked_without_links(self):
        self.client.force_login(self.user)
        response = self.client.get(self.url)
        body = response.content.decode("utf-8")
        for name in ("3D 列印", "航線規劃", "三維建模", "巡檢與產業 SOP", "無人車"):
            self.assertContains(response, name)
        self.assertContains(response, "規劃中")
        for name in ("3D 列印", "航線規劃", "三維建模", "巡檢與產業 SOP", "無人車"):
            self.assertIsNone(re.search(r"<a[^>]*>\s*{}".format(re.escape(name)), body))

    def test_feedback_area_is_honest_without_data(self):
        self.client.force_login(self.user)
        response = self.client.get(self.url)
        self.assertContains(response, "目前尚無教師回饋")

    def test_feedback_shows_real_teacher_data_only(self):
        from learning.growth_records import ensure_growth_submissions

        ensure_growth_submissions(self.enrollment)
        task = TaskDefinition.objects.create(
            task_id="T55", sort_order=55, stage=TaskDefinition.Stage.BUILD, title="調參實作任務"
        )
        progress, _ = StudentTaskProgress.objects.get_or_create(
            enrollment=self.enrollment, task=task
        )
        progress.teacher_note = "調參步驟正確，請補上飛行前檢查清單。"
        progress.teacher_score = 88
        progress.save(update_fields=["teacher_note", "teacher_score"])
        submission = self.enrollment.growth_submissions.get(definition__slot_id="R07")
        GrowthRecordReview.objects.create(
            submission=submission,
            reviewer=get_user_model().objects.create_user("lp-teacher@example.test"),
            review_status=GrowthRecordReview.Status.NEEDS_REVISION,
            teacher_note="請補充模型評估報告。",
            score=None,
        )

        self.client.force_login(self.user)
        response = self.client.get(self.url)
        self.assertContains(response, "調參步驟正確，請補上飛行前檢查清單。")
        self.assertContains(response, "88.00 分")
        self.assertContains(response, "請補充模型評估報告。")
        self.assertNotContains(response, "目前尚無教師回饋")
        self.assertContains(response, reverse("learning:task_detail", args=[self.enrollment.pk, "T55"]))
        self.assertContains(response, reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R07"]))

    def test_current_stage_follows_phase_progress(self):
        phase, _ = PhaseProgress.objects.get_or_create(
            enrollment=self.enrollment, phase=TaskDefinition.Stage.BUILD
        )
        phase.status = PhaseProgress.Status.IN_PROGRESS
        phase.save(update_fields=["status"])
        self.client.force_login(self.user)
        response = self.client.get(self.url)
        self.assertContains(response, "目前階段")
        self.assertContains(response, "前往「做」階段任務")
        self.assertContains(response, 'id="stage-build"')

    def test_all_phases_completed_shows_completion_message(self):
        # 先讓工作台建立 PhaseProgress 列（沿用 view 的 get_or_create 行為）。
        self.client.force_login(self.user)
        self.assertEqual(self.client.get(self.url).status_code, 200)
        for phase in PhaseProgress.objects.filter(enrollment=self.enrollment):
            phase.status = PhaseProgress.Status.COMPLETED
            phase.save(update_fields=["status"])
        response = self.client.get(self.url)
        self.assertContains(response, "本期五階段皆已完成")

    def test_entry_redirects_single_enrollment(self):
        self.client.force_login(self.user)
        response = self.client.get(self.entry_url)
        self.assertRedirects(response, self.url, fetch_redirect_response=False)

    def test_entry_without_enrollment_goes_dashboard(self):
        fresh = create_student_account("lp-fresh@example.test", "新生")
        self.client.force_login(fresh.user)
        response = self.client.get(self.entry_url)
        self.assertRedirects(
            response, reverse("learning:student_dashboard"), fetch_redirect_response=False
        )

    def test_dashboard_offers_workbench_entry(self):
        self.client.force_login(self.user)
        response = self.client.get(reverse("learning:student_dashboard"))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "五階段學習工作台")
        self.assertContains(response, self.url)

    def test_m1_m4_page_unaffected(self):
        """M1–M4 凍結保護：手機槳葉辨識頁照常運作。"""
        self.client.force_login(self.user)
        response = self.client.get(reverse("learning:student_prop_scan", args=[self.enrollment.pk]))
        self.assertEqual(response.status_code, 200)
        for motor in ("M1", "M2", "M3", "M4"):
            self.assertContains(response, 'name="motor_{}"'.format(motor))

    def test_r07_upload_route_gate_unchanged(self):
        """R07 凍結保護：路由路徑與 POST-only 閘門、方向阻擋邏輯皆未變動。"""
        self.client.force_login(self.user)
        # 路由位址未變（不得改路徑或放行非 ai_flight_assessment 方向）。
        self.assertEqual(
            reverse("learning:growth_model_upload", args=[self.enrollment.pk]),
            "/student/courses/{}/growth/R07/model/".format(self.enrollment.pk),
        )
        # GET 仍為 Method Not Allowed（@require_POST 未動）。
        get_response = self.client.get(
            reverse("learning:growth_model_upload", args=[self.enrollment.pk])
        )
        self.assertEqual(get_response.status_code, 405)
        # 未設定 ai_flight_assessment 方向時，POST 直接被閘門阻擋並重導回 R07 詳情頁
        # （流程在讀取檔案前就返回，不寫入任何 R07 資料）。
        post_response = self.client.post(
            reverse("learning:growth_model_upload", args=[self.enrollment.pk])
        )
        self.assertRedirects(
            post_response,
            reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R07"]),
            fetch_redirect_response=False,
        )
        # 表單入口頁（R07 詳情）仍可正常開啟。
        detail_response = self.client.get(
            reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R07"])
        )
        self.assertEqual(detail_response.status_code, 200)

    def test_growth_dashboard_still_works(self):
        self.client.force_login(self.user)
        response = self.client.get(
            reverse("learning:student_growth_dashboard", args=[self.enrollment.pk])
        )
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "我的學習成長日誌")

    def test_mobile_stylesheet_is_single_column(self):
        css = Path(__file__).resolve().parents[1] / "static" / "learning" / "learning-path.css"
        content = css.read_text(encoding="utf-8")
        self.assertIn("@media (max-width:680px)", content)
        self.assertIn("grid-template-columns:1fr", content)
        self.assertIn("min-height:48px", content)
