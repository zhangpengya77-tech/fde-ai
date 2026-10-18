"""P3 教師端班級學習成果總覽（2026-10-13 教師指令）驗收。

驗證重點（教師補充指令九項功能）：
  1. 教師後台有「班級學習成果」入口；未登入／非教師不得存取。
  2. 只顯示教師有權查看的班級（沿用 teacher_cohorts 權限）。
  3. 顯示班級學員人數。
  4. 學員 × R01–R08 逐槽真實狀態與已提交／已複核／待複核數量。
  5. 五階段學習概況來自 PhaseProgress 真實資料。
  6. 待複核清單只列出現有資料能確認的項目，並連結到既有教師複核頁
     （teacher_student_detail 的 R01～R08 表單；不新建複核功能）。
  7. 個別學員成果詳情入口沿用既有 teacher_student_detail。
  8. 狀態誠實：已提交顯示「待教師複核」，不得顯示成已透過。
  9. 手機版 CSS 單欄（矩陣表轉學員卡片）。
  P4（2026-10-13 教師指令，UI/UX 優化＋待複核排序）追加驗證：
  10. 待複核清單排序：預設最早優先、可切最新優先、非法值回落預設。
  11. 四張統計卡片（班級學員／待複核成果／尚未提交／已完成八項）數字正確。
  12. 頁面區塊順序：統計卡片 → 待複核清單 → 學員進度列表 → R01–R08 詳細矩陣。
  13. 學員進度列表 progress_state（none／partial／complete）正確。
  14. 手機版 CSS 覆蓋統計卡片 2×2、排序控制項與 ≥44px 點按高度。
"""
from datetime import timedelta
from pathlib import Path

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from learning.growth_records import ensure_growth_submissions
from learning.models import (
    Cohort,
    GrowthRecordSubmission,
    PhaseProgress,
    StudentTaskProgress,
    TaskDefinition,
    TeacherCohortAccess,
)
from learning.tests.helpers import create_student_account, enroll_student
from learning.views import PENDING_SORT_OPTIONS, PROGRESS_FILTER_OPTIONS


class TeacherClassOutcomesTests(TestCase):
    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="P3-2026", name="P3 整合班")
        self.cohort_other = Cohort.objects.create(cohort_id="P3-OTHER", name="其他班")
        self.teacher = get_user_model().objects.create_user(
            username="p3-teacher", email="p3-teacher@example.test", password="Another-strong-passphrase-911!", is_staff=True
        )
        TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=self.cohort)
        self.student_a = create_student_account("p3-a@example.test", "學員甲")
        self.student_b = create_student_account("p3-b@example.test", "學員乙")
        self.enrollment_a = enroll_student(self.student_a, self.cohort)
        self.enrollment_b = enroll_student(self.student_b, self.cohort)
        # 其他班學員：教師無權查看，不得出現在總覽。
        self.outsider = create_student_account("p3-outsider@example.test", "校外學員")
        self.enrollment_outsider = enroll_student(self.outsider, self.cohort_other)
        self.url = reverse("learning:teacher_class_outcomes")
        self.dashboard_url = reverse("learning:teacher_dashboard")
        # 既有任務（供待複核任務列使用）。
        self.task = TaskDefinition.objects.create(
            task_id="T06", sort_order=6, stage=TaskDefinition.Stage.BUILD, title="F450 組裝"
        )

    def _login_teacher(self):
        self.client.force_login(self.teacher)

    def test_requires_teacher_role(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 302)
        self.assertIn("/teacher/login/", response["Location"])
        self.client.force_login(self.student_a.user)
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self._login_teacher()
        self.assertEqual(self.client.get(self.url).status_code, 200)

    def test_dashboard_has_class_outcomes_entry(self):
        self._login_teacher()
        response = self.client.get(self.dashboard_url)
        self.assertContains(response, "班級學習成果總覽")
        self.assertContains(response, self.url)

    def test_only_authorized_cohorts_and_student_count(self):
        self._login_teacher()
        response = self.client.get(self.url)
        rows = {row["cohort"].cohort_id: row for row in response.context["class_rows"]}
        self.assertIn(self.cohort.cohort_id, rows)
        self.assertNotIn(self.cohort_other.cohort_id, rows)
        self.assertEqual(rows[self.cohort.cohort_id]["student_count"], 2)
        self.assertContains(response, "學員 2 人")
        self.assertNotContains(response, self.outsider.public_user_id)

    def test_student_matrix_shows_real_slot_status_and_counts(self):
        submissions_a = ensure_growth_submissions(self.enrollment_a)
        r01 = next(item for item in submissions_a if item.definition.slot_id == "R01")
        r01.status = GrowthRecordSubmission.Status.SUBMITTED
        r01.save(update_fields=["status"])
        r05 = next(item for item in submissions_a if item.definition.slot_id == "R05")
        r05.status = GrowthRecordSubmission.Status.APPROVED
        r05.save(update_fields=["status"])
        r06 = next(item for item in submissions_a if item.definition.slot_id == "R06")
        r06.status = GrowthRecordSubmission.Status.NEEDS_REVISION
        r06.save(update_fields=["status"])
        self._login_teacher()
        response = self.client.get(self.url)
        row = next(
            item for item in response.context["class_rows"][0]["student_rows"]
            if item["enrollment"].pk == self.enrollment_a.pk
        )
        cells = {cell["slot_id"]: cell for cell in row["slot_cells"]}
        self.assertEqual(cells["R01"]["status_key"], "submitted")
        self.assertEqual(cells["R01"]["status_label"], "待教師複核")
        self.assertEqual(cells["R05"]["status_key"], "approved")
        self.assertEqual(cells["R05"]["status_label"], "✅ 已完成")
        self.assertEqual(row["submitted_count"], 3)
        self.assertEqual(row["reviewed_count"], 2)
        self.assertEqual(row["pending_count"], 1)
        body = response.content.decode("utf-8")
        self.assertIn(self.student_a.public_user_id, body)

    def test_submitted_slot_not_shown_as_approved(self):
        submissions_a = ensure_growth_submissions(self.enrollment_a)
        r02 = next(item for item in submissions_a if item.definition.slot_id == "R02")
        r02.status = GrowthRecordSubmission.Status.SUBMITTED
        r02.save(update_fields=["status"])
        self._login_teacher()
        response = self.client.get(self.url)
        # R02 列必須顯示「待教師複核」，不得出現 ✅ 已完成。
        self.assertContains(response, "待教師複核")
        self.assertNotContains(response, "✅ 已完成")

    def test_stage_overview_uses_phase_progress(self):
        for phase, _ in TaskDefinition.Stage.choices:
            PhaseProgress.objects.get_or_create(enrollment=self.enrollment_a, phase=phase)
        PhaseProgress.objects.filter(enrollment=self.enrollment_a, phase__in=["learn", "practice"]).update(
            status=PhaseProgress.Status.COMPLETED
        )
        self._login_teacher()
        response = self.client.get(self.url)
        stage_rows = {row["key"]: row for row in response.context["class_rows"][0]["stage_rows"]}
        # 分母＝班級人數（2 人；檢視會為每員建立五階段進度列）。
        self.assertEqual(stage_rows["learn"]["done"], 1)
        self.assertEqual(stage_rows["learn"]["total"], 2)
        self.assertEqual(stage_rows["build"]["done"], 0)
        self.assertEqual(stage_rows["build"]["total"], 2)
        self.assertContains(response, "完成 1 / 2 人")
        self.assertContains(response, "完成 0 / 2 人")

    def test_pending_rows_link_to_existing_review_page(self):
        submissions_a = ensure_growth_submissions(self.enrollment_a)
        r03 = next(item for item in submissions_a if item.definition.slot_id == "R03")
        r03.status = GrowthRecordSubmission.Status.SUBMITTED
        r03.save(update_fields=["status", "submitted_at"])
        progress, _ = StudentTaskProgress.objects.get_or_create(
            enrollment=self.enrollment_a, task=self.task
        )
        progress.status = StudentTaskProgress.Status.SUBMITTED
        progress.save(update_fields=["status"])
        self._login_teacher()
        response = self.client.get(self.url)
        pending = response.context["class_rows"][0]["pending_rows"]
        kinds = {(row["kind"], row["code"]) for row in pending}
        self.assertIn(("成長紀錄", "R03"), kinds)
        self.assertIn(("任務", "M06"), kinds)
        growth_url = reverse("learning:teacher_student_detail", args=[self.enrollment_a.pk])
        growth_row = next(row for row in pending if row["code"] == "R03")
        self.assertEqual(growth_row["url"], growth_url + "#growth-records")
        task_row = next(row for row in pending if row["code"] == "M06")
        self.assertEqual(task_row["url"], growth_url)
        # 不新建複核功能：所有待複核連結都指向既有學員詳情頁（複核表單位於該頁）。
        for row in pending:
            self.assertTrue(row["url"].startswith(growth_url), row)

    def test_pending_empty_state(self):
        self._login_teacher()
        response = self.client.get(self.url)
        self.assertContains(response, "目前沒有待複核的成果。")

    def test_student_detail_link_exists(self):
        self._login_teacher()
        response = self.client.get(self.url)
        detail_url = reverse("learning:teacher_student_detail", args=[self.enrollment_a.pk])
        self.assertContains(response, detail_url)

    def test_teacher_without_access_sees_empty_state(self):
        lonely_teacher = get_user_model().objects.create_user(
            username="p3-lonely", email="p3-lonely@example.test", password="Another-strong-passphrase-911!", is_staff=True
        )
        self.client.force_login(lonely_teacher)
        response = self.client.get(self.url)
        self.assertContains(response, "沒有可查看的班級")

    def test_cohort_filter(self):
        self._login_teacher()
        response = self.client.get(self.url + "?cohort=" + self.cohort.cohort_id)
        self.assertContains(response, self.cohort.name)
        response_all = self.client.get(self.url + "?cohort=" + self.cohort_other.cohort_id)
        self.assertContains(response_all, "沒有可查看的班級")

    def test_mobile_css_single_column(self):
        css = Path(__file__).resolve().parents[1] / "static" / "learning" / "teacher-outcomes.css"
        content = css.read_text(encoding="utf-8")
        self.assertIn("@media (max-width:680px)", content)
        self.assertIn("grid-template-columns", content)
        self.assertIn('content:attr(data-label)', content)

    # ---- P4（2026-10-13）：待複核排序 / 統計卡片 / 區塊順序 / 進度分組 ----

    def _submit_slot(self, enrollment, slot_id, days_ago):
        submissions = ensure_growth_submissions(enrollment)
        item = next(row for row in submissions if row.definition.slot_id == slot_id)
        item.status = GrowthRecordSubmission.Status.SUBMITTED
        item.submitted_at = timezone.now() - timedelta(days=days_ago)
        item.save(update_fields=["status", "submitted_at"])
        return item

    def _pending_codes(self, response):
        return [row["code"] for row in response.context["class_rows"][0]["pending_rows"]]

    def test_pending_sort_default_oldest_first(self):
        # 學員甲：R01 三天前、R02 一天前；學員乙：R03 兩天前。
        self._submit_slot(self.enrollment_a, "R01", days_ago=3)
        self._submit_slot(self.enrollment_a, "R02", days_ago=1)
        self._submit_slot(self.enrollment_b, "R03", days_ago=2)
        self._login_teacher()
        response = self.client.get(self.url)
        # 預設（未帶 sort）＝最早優先：R01(3d) → R03(2d) → R02(1d)。
        self.assertEqual(self._pending_codes(response), ["R01", "R03", "R02"])
        # 顯式帶入預設值結果一致。
        explicit = self.client.get(self.url + "?sort=oldest")
        self.assertEqual(self._pending_codes(explicit), ["R01", "R03", "R02"])

    def test_pending_sort_newest_first(self):
        self._submit_slot(self.enrollment_a, "R01", days_ago=3)
        self._submit_slot(self.enrollment_a, "R02", days_ago=1)
        self._submit_slot(self.enrollment_b, "R03", days_ago=2)
        self._login_teacher()
        response = self.client.get(self.url + "?sort=newest")
        self.assertEqual(self._pending_codes(response), ["R02", "R03", "R01"])

    def test_pending_sort_invalid_value_falls_back_to_default(self):
        self._submit_slot(self.enrollment_a, "R01", days_ago=3)
        self._submit_slot(self.enrollment_a, "R02", days_ago=1)
        self._login_teacher()
        response = self.client.get(self.url + "?sort=not-a-real-option")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._pending_codes(response), ["R01", "R02"])

    def test_pending_sort_form_keeps_cohort_selection(self):
        self._submit_slot(self.enrollment_a, "R01", days_ago=1)
        self._login_teacher()
        response = self.client.get(self.url + "?cohort=" + self.cohort.cohort_id)
        body = response.content.decode("utf-8")
        # 排序表單須帶隱藏 cohort，切換班級才不會遺失排序。
        self.assertIn('name="cohort"', body)
        self.assertIn('name="sort"', body)
        self.assertIn("提交時間：最早優先", body)
        self.assertIn("提交時間：最新優先", body)

    def test_stat_cards_counts(self):
        # 學員甲提交 3 項、學員乙 0 項。
        for slot in ("R01", "R02", "R03"):
            self._submit_slot(self.enrollment_a, slot, days_ago=1)
        self._login_teacher()
        class_row = self.client.get(self.url).context["class_rows"][0]
        self.assertEqual(class_row["student_count"], 2)
        self.assertEqual(class_row["pending_count"], 3)
        self.assertEqual(class_row["not_submitted_count"], 1)  # 學員乙
        self.assertEqual(class_row["all_submitted_count"], 0)
        # 學員甲補滿 8 項後：已完成八項＝1，尚未提交仍為 1（學員乙）。
        for slot in ("R04", "R05", "R06", "R07", "R08"):
            self._submit_slot(self.enrollment_a, slot, days_ago=1)
        class_row = self.client.get(self.url).context["class_rows"][0]
        self.assertEqual(class_row["all_submitted_count"], 1)
        self.assertEqual(class_row["not_submitted_count"], 1)
        body = self.client.get(self.url).content.decode("utf-8")
        for label in ("班級學員", "待複核成果", "尚未提交", "已完成八項"):
            self.assertIn(label, body)

    def test_page_section_order(self):
        self._submit_slot(self.enrollment_a, "R01", days_ago=1)
        self._login_teacher()
        body = self.client.get(self.url).content.decode("utf-8")
        i_stats = body.index("tco-stat-label")
        i_pending = body.index("待複核成果（")
        i_progress = body.index("學員進度列表")
        i_matrix = body.index("R01–R08 詳細矩陣")
        i_phase = body.index("五階段學習概況")
        # P3 既有五階段概況保留；順序：統計卡片 → 待複核 → 學員進度 → 矩陣 → 五階段。
        self.assertTrue(i_stats < i_pending < i_progress < i_matrix < i_phase)

    def test_student_progress_state_values(self):
        # 學員甲：進行中；學員乙：尚未提交。
        self._submit_slot(self.enrollment_a, "R01", days_ago=1)
        self._login_teacher()
        rows = {
            row["enrollment"].pk: row
            for row in self.client.get(self.url).context["class_rows"][0]["student_rows"]
        }
        self.assertEqual(rows[self.enrollment_a.pk]["progress_state"], "partial")
        self.assertEqual(rows[self.enrollment_b.pk]["progress_state"], "none")
        # 補滿 8 項後：complete。
        for slot in ("R02", "R03", "R04", "R05", "R06", "R07", "R08"):
            self._submit_slot(self.enrollment_a, slot, days_ago=1)
        rows = {
            row["enrollment"].pk: row
            for row in self.client.get(self.url).context["class_rows"][0]["student_rows"]
        }
        self.assertEqual(rows[self.enrollment_a.pk]["progress_state"], "complete")

    def test_mobile_css_covers_p4_controls(self):
        css = Path(__file__).resolve().parents[1] / "static" / "learning" / "teacher-outcomes.css"
        content = css.read_text(encoding="utf-8")
        self.assertIn(".tco-stats", content)
        self.assertIn(".tco-progress", content)
        self.assertIn(".sort-bar", content)
        self.assertIn("min-height:44px", content)

    # ---- P4.1（2026-10-13）：四種排序 / 三項待複核篩選 / 學員進度篩選 ----

    def _set_slot(self, enrollment, slot_id, status, days_ago=None):
        submissions = ensure_growth_submissions(enrollment)
        item = next(row for row in submissions if row.definition.slot_id == slot_id)
        item.status = status
        item.submitted_at = timezone.now() - timedelta(days=days_ago) if days_ago is not None else None
        item.save(update_fields=["status", "submitted_at"])
        return item

    def _submit_task(self, enrollment, task, days_ago=None):
        progress, _ = StudentTaskProgress.objects.get_or_create(enrollment=enrollment, task=task)
        progress.status = StudentTaskProgress.Status.SUBMITTED
        progress.submitted_at = timezone.now() - timedelta(days=days_ago) if days_ago is not None else None
        progress.save(update_fields=["status", "submitted_at"])
        return progress

    def _pending_codes(self, response):
        return [row["code"] for row in response.context["class_rows"][0]["pending_rows"]]

    def test_pending_sort_options_include_p41(self):
        self._login_teacher()
        body = self.client.get(self.url).content.decode("utf-8")
        # 以視圖常量為準比對（含 P4.2 的「學員名稱（字元排序）」標示）。
        for _key, label in PENDING_SORT_OPTIONS:
            self.assertIn(label, body)

    def test_pending_sort_student_asc(self):
        # 兩位學員各提交一項；目標依名稱 A→Z。
        self._set_slot(self.enrollment_a, "R01", GrowthRecordSubmission.Status.SUBMITTED, days_ago=1)
        self._set_slot(self.enrollment_b, "R01", GrowthRecordSubmission.Status.SUBMITTED, days_ago=5)
        self._login_teacher()
        response = self.client.get(self.url + "?sort=student_asc")
        rows = response.context["class_rows"][0]["pending_rows"]
        # 中文名稱採 Unicode 碼位序（決定性、不依賴系統 locale）：
        # 「乙」(U+4E59) 先於「甲」(U+7532)，故乙排在甲前。
        expected = sorted([self.student_a, self.student_b], key=lambda s: (s.nickname.lower(), s.public_user_id))
        self.assertEqual([row["student"].public_user_id for row in rows], [s.public_user_id for s in expected])

    def test_pending_sort_record_asc(self):
        # R 群先於 M 群，各群內數字由小到大：R01 → R02 → M06。
        self._set_slot(self.enrollment_a, "R02", GrowthRecordSubmission.Status.SUBMITTED, days_ago=1)
        self._set_slot(self.enrollment_a, "R01", GrowthRecordSubmission.Status.SUBMITTED, days_ago=2)
        self._submit_task(self.enrollment_a, self.task, days_ago=3)  # T06 → M06
        self._login_teacher()
        response = self.client.get(self.url + "?sort=record_asc")
        self.assertEqual(self._pending_codes(response), ["R01", "R02", "M06"])

    def test_pending_sort_secondary_key_stable(self):
        # 相同提交時間：依學員名稱（次要鍵）決定順序，兩次請求結果一致。
        now = timezone.now()
        self._set_slot(self.enrollment_b, "R01", GrowthRecordSubmission.Status.SUBMITTED, days_ago=1)
        self._set_slot(self.enrollment_a, "R02", GrowthRecordSubmission.Status.SUBMITTED, days_ago=1)
        GrowthRecordSubmission.objects.filter(
            enrollment__in=[self.enrollment_a, self.enrollment_b]
        ).update(submitted_at=now)
        self._login_teacher()
        first = self._pending_codes(self.client.get(self.url + "?sort=oldest"))
        second = self._pending_codes(self.client.get(self.url + "?sort=oldest"))
        self.assertEqual(first, second)
        # 相同時間 → 依名稱碼位序決定（乙 U+4E59 先於甲 U+7532），兩次請求完全一致。
        expected = sorted([self.student_a, self.student_b], key=lambda s: (s.nickname.lower(), s.public_user_id))
        self.assertEqual(len(first), 2)
        self.assertEqual(
            [row["student"].public_user_id for row in self.client.get(self.url + "?sort=oldest").context["class_rows"][0]["pending_rows"]],
            [s.public_user_id for s in expected],
        )

    def test_pending_sort_missing_time_last_in_time_modes(self):
        # 無 submitted_at 的項目在 oldest／newest 下都排最後。
        self._set_slot(self.enrollment_a, "R01", GrowthRecordSubmission.Status.SUBMITTED, days_ago=1)
        self._set_slot(self.enrollment_a, "R02", GrowthRecordSubmission.Status.SUBMITTED, days_ago=None)
        self._login_teacher()
        for mode in ("oldest", "newest"):
            codes = self._pending_codes(self.client.get(self.url + "?sort=" + mode))
            self.assertEqual(codes[-1], "R02", mode)
            self.assertEqual(codes[0], "R01", mode)

    def test_pending_record_filter(self):
        # 紀錄篩選只顯示該槽位成長紀錄；任務僅在 P2 對應表 genuinely 對應時納入。
        self._set_slot(self.enrollment_a, "R02", GrowthRecordSubmission.Status.SUBMITTED, days_ago=1)
        self._submit_task(self.enrollment_a, self.task, days_ago=2)  # T06 對應 R05
        self._login_teacher()
        r02 = self.client.get(self.url + "?p_record=R02")
        self.assertEqual(self._pending_codes(r02), ["R02"])
        r05 = self.client.get(self.url + "?p_record=R05")
        # T06 在 P2 對應表上 related R05 → 可出現在 R05 篩選。
        self.assertEqual(self._pending_codes(r05), ["M06"])
        # 無對應槽位的任務（T10）在任何 R 篩選下都不得出現。
        task_no_map = TaskDefinition.objects.create(
            task_id="T10", sort_order=10, stage=TaskDefinition.Stage.CERTIFY, title="無對應任務"
        )
        self._submit_task(self.enrollment_a, task_no_map, days_ago=1)
        for slot in ("R01", "R05", "R08"):
            codes = self._pending_codes(self.client.get(self.url + "?p_record=" + slot))
            self.assertNotIn("M10", codes, slot)
        # 非法紀錄值回落「全部紀錄」（不報錯、不縮減清單）。
        fallback = self.client.get(self.url + "?p_record=bogus")
        self.assertEqual(fallback.status_code, 200)
        self.assertEqual(len(fallback.context["class_rows"][0]["pending_rows"]), 3)

    def test_pending_type_filter(self):
        self._set_slot(self.enrollment_a, "R01", GrowthRecordSubmission.Status.SUBMITTED, days_ago=1)
        self._submit_task(self.enrollment_a, self.task, days_ago=2)
        self._login_teacher()
        growth = self.client.get(self.url + "?p_type=growth")
        self.assertEqual(self._pending_codes(growth), ["R01"])
        task = self.client.get(self.url + "?p_type=task")
        self.assertEqual(self._pending_codes(task), ["M06"])

    def test_pending_status_filter(self):
        # 需要補充（needs_revision）納入待複核清單；任務僅有 submitted 一態，不受狀態篩選影響。
        self._set_slot(self.enrollment_a, "R01", GrowthRecordSubmission.Status.SUBMITTED, days_ago=2)
        self._set_slot(self.enrollment_a, "R02", GrowthRecordSubmission.Status.NEEDS_REVISION, days_ago=1)
        self._submit_task(self.enrollment_a, self.task, days_ago=3)
        self._login_teacher()
        all_rows = self.client.get(self.url).context["class_rows"][0]
        # 預設 oldest：M06（3 天前）→ R01（2 天前）→ R02（1 天前）。
        self.assertEqual([row["code"] for row in all_rows["pending_rows"]], ["M06", "R01", "R02"])
        submitted = self.client.get(self.url + "?p_status=submitted")
        self.assertEqual(self._pending_codes(submitted), ["M06", "R01"])
        revision = self.client.get(self.url + "?p_status=needs_revision")
        self.assertEqual(self._pending_codes(revision), ["R02"])
        # 卡片「待複核成果」固定為 submitted 數（P4 語意），不隨狀態篩選變動。
        self.assertEqual(all_rows["pending_count"], 2)
        self.assertEqual(
            self.client.get(self.url + "?p_status=needs_revision").context["class_rows"][0]["pending_count"], 2
        )

    def test_pending_filters_combined_and_preserved(self):
        # 班級＋排序＋紀錄＋類型＋狀態同時使用；切換任一條件時其他條件以隱藏欄位保留。
        self._set_slot(self.enrollment_a, "R01", GrowthRecordSubmission.Status.SUBMITTED, days_ago=1)
        self._set_slot(self.enrollment_b, "R01", GrowthRecordSubmission.Status.SUBMITTED, days_ago=2)
        self._submit_task(self.enrollment_a, self.task, days_ago=3)
        self._login_teacher()
        url = self.url + "?cohort=%s&sort=newest&p_record=R01&p_type=growth&p_status=submitted" % self.cohort.cohort_id
        response = self.client.get(url)
        rows = response.context["class_rows"][0]["pending_rows"]
        # 最新優先：1 天前（學員甲）先於 2 天前（學員乙）。
        self.assertEqual(
            [row["student"].public_user_id for row in rows],
            [self.student_a.public_user_id, self.student_b.public_user_id],
        )
        body = response.content.decode("utf-8")
        for hidden in ('name="sort" value="newest"', 'name="p_record" value="R01"', 'name="p_type" value="growth"', 'name="p_status" value="submitted"'):
            self.assertIn(hidden, body)

    def test_progress_filter_none(self):
        # 學員甲有提交、學員乙沒有；s_state=none 只顯示尚未提交的學員。
        self._set_slot(self.enrollment_a, "R01", GrowthRecordSubmission.Status.SUBMITTED, days_ago=1)
        self._login_teacher()
        default_rows = self.client.get(self.url).context["class_rows"][0]["visible_student_rows"]
        self.assertEqual(len(default_rows), 2)
        filtered = self.client.get(self.url + "?s_state=none")
        rows = filtered.context["class_rows"][0]["visible_student_rows"]
        self.assertEqual([row["student"].nickname for row in rows], ["學員乙"])
        body = filtered.content.decode("utf-8")
        self.assertIn("尚未提交任何 R01–R08", body)
        # 切換進度篩選時，待複核條件以隱藏欄位保留。
        combined = self.client.get(self.url + "?s_state=none&sort=newest&p_type=task")
        self.assertIn('name="sort" value="newest"', combined.content.decode("utf-8"))

    def test_progress_filter_invalid_falls_back(self):
        self._login_teacher()
        response = self.client.get(self.url + "?s_state=bogus")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.context["class_rows"][0]["visible_student_rows"]), 2)

    def test_p41_template_has_control_names(self):
        template = Path(__file__).resolve().parents[1] / "templates" / "learning" / "teacher_class_outcomes.html"
        content = template.read_text(encoding="utf-8")
        for name in ('name="p_record"', 'name="p_type"', 'name="p_status"', 'name="s_state"', 'name="sort"'):
            self.assertIn(name, content)

    # ---- P4.2（2026-10-13）：五種學員進度篩選 / 狀態區分 ----

    def _third_student(self):
        student = create_student_account("p3-c@example.test", "學員丙")
        return student, enroll_student(student, self.cohort)

    def test_progress_filter_five_options(self):
        """五種篩選：全部／尚未提交／部分提交／八項已提交／有待複核成果。"""
        # 學員甲：3 項（1 待複核＋1 已複核＋1 需要補充）→ partial、有待複核。
        self._set_slot(self.enrollment_a, "R01", GrowthRecordSubmission.Status.SUBMITTED, days_ago=1)
        self._set_slot(self.enrollment_a, "R02", GrowthRecordSubmission.Status.APPROVED, days_ago=2)
        self._set_slot(self.enrollment_a, "R03", GrowthRecordSubmission.Status.NEEDS_REVISION, days_ago=3)
        # 學員乙：0 項 → none。
        # 學員丙：8 項（4 已複核＋4 需要補充）→ complete、且無待複核。
        _student_c, enrollment_c = self._third_student()
        for slot in ("R01", "R02", "R03", "R04"):
            self._set_slot(enrollment_c, slot, GrowthRecordSubmission.Status.APPROVED, days_ago=4)
        for slot in ("R05", "R06", "R07", "R08"):
            self._set_slot(enrollment_c, slot, GrowthRecordSubmission.Status.NEEDS_REVISION, days_ago=5)
        self._login_teacher()

        def visible(flt):
            url = self.url if not flt else self.url + "?s_state=" + flt
            return [
                row["student"].public_user_id
                for row in self.client.get(url).context["class_rows"][0]["visible_student_rows"]
            ]

        all_ids = visible("")
        self.assertEqual(len(all_ids), 3)
        self.assertEqual(visible("none"), [self.student_b.public_user_id])
        self.assertEqual(visible("partial"), [self.student_a.public_user_id])
        self.assertEqual(visible("complete"), [enrollment_c.student.public_user_id])
        # 有待複核成果＝至少一筆真實待複核紀錄；丙雖有 8 項提交但全部已複核／需補充 → 不列入。
        self.assertEqual(visible("pending"), [self.student_a.public_user_id])
        # 五個選項標籤皆須出現在頁面。
        body = self.client.get(self.url).content.decode("utf-8")
        for _key, label in PROGRESS_FILTER_OPTIONS:
            self.assertIn(label, body)

    def test_progress_filter_combined_with_pending_filters(self):
        self._set_slot(self.enrollment_a, "R01", GrowthRecordSubmission.Status.SUBMITTED, days_ago=1)
        _student_c, enrollment_c = self._third_student()
        self._set_slot(enrollment_c, "R01", GrowthRecordSubmission.Status.SUBMITTED, days_ago=2)
        self._login_teacher()
        url = (
            self.url
            + "?cohort=%s&sort=record_asc&p_record=R01&p_type=growth&p_status=submitted&s_state=pending"
            % self.cohort.cohort_id
        )
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        rows = response.context["class_rows"][0]["pending_rows"]
        self.assertEqual([row["code"] for row in rows], ["R01", "R01"])
        visible_students = response.context["class_rows"][0]["visible_student_rows"]
        self.assertEqual(len(visible_students), 2)
        body = response.content.decode("utf-8")
        self.assertIn('name="s_state" value="pending"', body)
        self.assertIn('name="p_record" value="R01"', body)

    def test_pending_state_chip_distinguishes_statuses(self):
        self._set_slot(self.enrollment_a, "R01", GrowthRecordSubmission.Status.SUBMITTED, days_ago=1)
        self._set_slot(self.enrollment_a, "R02", GrowthRecordSubmission.Status.NEEDS_REVISION, days_ago=2)
        self._login_teacher()
        body = self.client.get(self.url).content.decode("utf-8")
        self.assertIn("tco-pending-state-submitted", body)
        self.assertIn("tco-pending-state-needs_revision", body)

    def test_pending_missing_time_is_labelled(self):
        self._set_slot(self.enrollment_a, "R01", GrowthRecordSubmission.Status.SUBMITTED, days_ago=None)
        self._login_teacher()
        body = self.client.get(self.url).content.decode("utf-8")
        rows = self.client.get(self.url).context["class_rows"][0]["pending_rows"]
        self.assertIsNone(rows[0]["submitted_at"])
        self.assertIn("無提交時間", body)

    # ── P5-A（2026-10-13 教師指令）：統一待複核口徑 ────────────────────────────
    def test_pending_card_and_student_filter_share_same_item_set(self):
        """卡片（筆數）與學員篩選（人數）必須共用同一工作項目集合。

        情境即教師回報的不一致：某學員只有「任務提交」待複核、沒有成長紀錄待複核，
        修正前卡片為 1 筆但篩選為 0 人。
        """
        self._submit_task(self.enrollment_a, self.task, days_ago=1)
        self._login_teacher()
        response = self.client.get(self.url)
        row = response.context["class_rows"][0]
        # 卡片：1 筆（任務提交）
        self.assertEqual(row["pending_count"], 1)
        # 該學員在進度列表中「待複核」亦為 1 筆
        student_row = next(r for r in row["student_rows"] if r["student"] == self.student_a)
        self.assertEqual(student_row["pending_count"], 1)
        # 篩選「有待複核成果」應命中 1 人（修正前為 0 人）
        filtered = self.client.get(self.url + "?s_state=pending").context["class_rows"][0]
        self.assertEqual(len(filtered["visible_student_rows"]), 1)
        # 卡片同時提供涉及人數，且與篩選一致
        self.assertEqual(filtered["pending_student_count"], 1)

    def test_pending_source_breakdown_and_units(self):
        """來源（成長紀錄／任務提交）分別標示，且卡片單位為「筆」。"""
        self._set_slot(self.enrollment_a, "R01", GrowthRecordSubmission.Status.SUBMITTED, days_ago=1)
        self._submit_task(self.enrollment_a, self.task, days_ago=2)
        self._login_teacher()
        response = self.client.get(self.url)
        row = response.context["class_rows"][0]
        self.assertEqual(row["pending_count"], 2)
        counts = {item["kind"]: item["count"] for item in row["pending_source_counts"]}
        self.assertEqual(counts.get("成長紀錄"), 1)
        self.assertEqual(counts.get("任務"), 1)
        body = response.content.decode("utf-8")
        self.assertIn("待複核成果（筆）", body)
        self.assertIn("成長紀錄 1 筆", body)
        self.assertIn("任務提交 1 筆", body)
        # 每一項目一律標示資料來源
        self.assertIn("來源：成長紀錄", body)
        self.assertIn("來源：任務提交", body)

    def test_needs_revision_counted_separately_from_pending(self):
        """需要補充（已複核但需補件）與待教師複核分開計數，且不混入待複核卡片。"""
        self._set_slot(self.enrollment_a, "R01", GrowthRecordSubmission.Status.SUBMITTED, days_ago=1)
        self._set_slot(self.enrollment_a, "R02", GrowthRecordSubmission.Status.NEEDS_REVISION, days_ago=2)
        self._login_teacher()
        row = self.client.get(self.url).context["class_rows"][0]
        self.assertEqual(row["pending_count"], 1)
        self.assertEqual(row["needs_revision_count"], 1)
        student_row = next(r for r in row["student_rows"] if r["student"] == self.student_a)
        self.assertEqual(student_row["pending_count"], 1)
        self.assertEqual(student_row["needs_revision_count"], 1)

    def test_pending_work_item_carries_group_and_source(self):
        """工作項目具備分組（待教師複核／需要補充）與來源欄位，供兩種檢視共用。"""
        self._set_slot(self.enrollment_a, "R01", GrowthRecordSubmission.Status.SUBMITTED, days_ago=1)
        self._set_slot(self.enrollment_a, "R02", GrowthRecordSubmission.Status.NEEDS_REVISION, days_ago=2)
        self._submit_task(self.enrollment_a, self.task, days_ago=3)
        self._login_teacher()
        rows = self.client.get(self.url).context["class_rows"][0]["pending_rows"]
        groups = sorted(row["group"] for row in rows)
        self.assertEqual(groups, ["needs_revision", "pending_review", "pending_review"])
        sources = {row["source_label"] for row in rows}
        self.assertEqual(sources, {"成長紀錄", "任務提交"})
        for row in rows:
            self.assertIn(row["group_label"], {"待教師複核", "需要補充"})

