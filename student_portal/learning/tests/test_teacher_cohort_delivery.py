"""P6 結訓審核與成果交付中心驗收（2026-10-13 教師指令）。

對應教師指令第六節 11 項驗收：
  1. 兩班以上結訓清單。
  2. 0／部分／8 項提交情境。
  3. 待複核與需要補充分類。
  4. P5 報告與 CSV 統計一致。
  5. CSV 繁體中文編碼（UTF-8 BOM）。
  6. CSV 公式注入防護。
  7. 教師跨班級權限隔離。
  8. 學員及匿名使用者禁止匯出。
  9. 無資料空狀態。
 10. 390×844 手機版（CSS／版面契約）。
 11. P1–P5 必要回歸（由獨立回歸套件與 DEMO 驗收涵蓋；本檔驗證 P5 統計來源未被破壞）。

另驗證：
  - 每筆待處理項目都連到**既有**教師審核頁，未建立第二套複核流程。
  - 不自動判定合格、不核發證照；「證」階段不得標示為民航局證照。
  - CSV 預設不匯出 Email／電話／密碼／Token，不打包私人證據原始檔。
  - CSV 不得公開快取，且不位於公開靜態目錄。
"""
import csv
import re
from datetime import timedelta
from io import StringIO
from pathlib import Path

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from learning.growth_records import ensure_growth_submissions
from learning.models import (
    Cohort,
    GrowthRecordReview,
    GrowthRecordSubmission,
    PhaseProgress,
    StudentTaskProgress,
    TaskDefinition,
    TeacherCohortAccess,
)
from learning.tests.helpers import create_student_account, enroll_student
from learning.views import (
    CSV_FORMULA_PREFIXES,
    build_cohort_report,
    csv_safe_cell,
)

SUBMITTED = GrowthRecordSubmission.Status.SUBMITTED
NEEDS_REVISION = GrowthRecordSubmission.Status.NEEDS_REVISION
APPROVED = GrowthRecordSubmission.Status.APPROVED
SLOT_IDS = ["R%02d" % index for index in range(1, 9)]


def parse_csv(payload_bytes):
    """以 UTF-8 BOM 解碼後解析 CSV，回傳 list[list[str]]。"""
    return list(csv.reader(StringIO(payload_bytes.decode("utf-8-sig"))))


class P6Base(TestCase):
    def setUp(self):
        # 兩個以上授權班級（驗收 1）＋ 一個未授權班級（驗收 7）＋ 一個空班級（驗收 9）。
        self.cohort_a = Cohort.objects.create(cohort_id="P6-A-2026", name="P6 甲班")
        self.cohort_b = Cohort.objects.create(cohort_id="P6-B-2026", name="P6 乙班")
        self.cohort_other = Cohort.objects.create(cohort_id="P6-OTHER", name="未授權班")
        self.cohort_empty = Cohort.objects.create(cohort_id="P6-EMPTY", name="空班級")

        self.teacher = get_user_model().objects.create_user(
            username="p6-teacher",
            email="p6-teacher@example.test",
            password="Another-strong-passphrase-911!",
            is_staff=True,
        )
        for cohort in (self.cohort_a, self.cohort_b, self.cohort_empty):
            TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=cohort)

        self.student_a = create_student_account("p6-a@example.test", "學員甲")
        self.student_b = create_student_account("p6-b@example.test", "學員乙")
        self.enrollment_a = enroll_student(self.student_a, self.cohort_a)
        self.enrollment_b = enroll_student(self.student_b, self.cohort_a)

        self.student_c = create_student_account("p6-c@example.test", "學員丙")
        self.enrollment_c = enroll_student(self.student_c, self.cohort_b)

        self.outsider = create_student_account("p6-out@example.test", "他班學員")
        self.enrollment_out = enroll_student(self.outsider, self.cohort_other)

        self.task = TaskDefinition.objects.create(
            task_id="T06", sort_order=6, stage=TaskDefinition.Stage.BUILD, title="F450 組裝"
        )

        self.checklist_url = reverse("learning:teacher_cohort_review_checklist")
        self.checklist_a = reverse(
            "learning:teacher_cohort_review_checklist_cohort", args=[self.cohort_a.cohort_id]
        )
        self.checklist_b = reverse(
            "learning:teacher_cohort_review_checklist_cohort", args=[self.cohort_b.cohort_id]
        )
        self.checklist_empty = reverse(
            "learning:teacher_cohort_review_checklist_cohort", args=[self.cohort_empty.cohort_id]
        )
        self.summary_url = reverse("learning:teacher_cohort_export_summary")
        self.summary_a = reverse(
            "learning:teacher_cohort_export_summary_cohort", args=[self.cohort_a.cohort_id]
        )
        self.records_url = reverse("learning:teacher_cohort_export_records")
        self.records_a = reverse(
            "learning:teacher_cohort_export_records_cohort", args=[self.cohort_a.cohort_id]
        )
        self.dashboard_url = reverse("learning:teacher_dashboard")

    # ── 工具 ──────────────────────────────────────────────────────────
    def _login_teacher(self):
        self.client.force_login(self.teacher)

    def _set_slot(self, enrollment, slot_id, status, days_ago=None):
        submissions = ensure_growth_submissions(enrollment)
        item = next(row for row in submissions if row.definition.slot_id == slot_id)
        item.status = status
        item.submitted_at = (
            timezone.now() - timedelta(days=days_ago) if days_ago is not None else None
        )
        item.save(update_fields=["status", "submitted_at"])
        return item

    def _review(self, submission, review_status, note="", score=None, days_ago=1):
        GrowthRecordReview.objects.create(
            submission=submission,
            reviewer=self.teacher,
            review_status=review_status,
            score=score,
            teacher_note=note,
            reviewed_at=timezone.now() - timedelta(days=days_ago),
        )
        submission.status = review_status
        submission.teacher_final_score = score
        submission.save(update_fields=["status", "teacher_final_score"])
        return submission

    def _submit_all_eight(self, enrollment, days_ago=1):
        for slot_id in SLOT_IDS:
            self._set_slot(enrollment, slot_id, SUBMITTED, days_ago=days_ago)

    def _summary_metrics(self, response):
        """把班級摘要 CSV 的「項目名稱 → 值」抽成 dict。"""
        rows = parse_csv(response.content)
        return {
            row[4]: row[5] for row in rows[1:] if row and row[0] == "班級摘要" and len(row) > 5
        }


# ══════════════════════════════════════════════════════════════════════
# 一、P6-A 結訓審核清單
# ══════════════════════════════════════════════════════════════════════
class ReviewChecklistTests(P6Base):
    def test_dashboard_has_checklist_and_export_entries(self):
        """P6-A／B 入口與 P5 報告入口並列。"""
        self._login_teacher()
        body = self.client.get(self.dashboard_url).content.decode("utf-8")
        self.assertIn("結訓審核清單", body)
        self.assertIn(self.checklist_url, body)
        self.assertIn(self.summary_url, body)
        self.assertIn(self.records_url, body)
        # 既有 P5 入口仍在（未被取代）
        self.assertIn(reverse("learning:teacher_class_report"), body)

    def test_checklist_requires_teacher_role(self):
        response = self.client.get(self.checklist_a)
        self.assertEqual(response.status_code, 302)
        self.assertIn("/teacher/login/", response["Location"])
        self.client.force_login(self.student_a.user)
        self.assertEqual(self.client.get(self.checklist_a).status_code, 403)
        self._login_teacher()
        self.assertEqual(self.client.get(self.checklist_a).status_code, 200)

    def test_two_cohorts_listed_and_switchable(self):
        """驗收 1：兩班以上結訓清單，且各班的數字互不混用。"""
        self._submit_all_eight(self.enrollment_a)
        self._set_slot(self.enrollment_c, "R01", SUBMITTED, days_ago=1)
        self._login_teacher()
        response = self.client.get(self.checklist_url)
        ids = [cohort.cohort_id for cohort in response.context["cohorts"]]
        self.assertEqual(sorted(ids), ["P6-A-2026", "P6-B-2026", "P6-EMPTY"])
        self.assertNotIn("P6-OTHER", ids)
        self.assertEqual(response.context["selected_cohort"], "P6-A-2026")

        first = self.client.get(self.checklist_a).context["checklist"]
        second = self.client.get(self.checklist_b).context["checklist"]
        self.assertEqual(first["student_count"], 2)
        self.assertEqual(second["student_count"], 1)
        self.assertEqual(first["unsubmitted_total"], 8)
        self.assertEqual(second["unsubmitted_total"], 7)
        # 乙班學員不得出現在甲班清單
        body_a = self.client.get(self.checklist_a).content.decode("utf-8")
        self.assertNotIn(self.student_c.public_user_id, body_a)
        self.assertNotIn(self.outsider.public_user_id, body_a)

    def test_checklist_contains_six_required_sections(self):
        """P6-A 六項內容：總人數／尚未提交／待複核／需要補充／已有複核結果／每人待處理。"""
        self._set_slot(self.enrollment_a, "R01", SUBMITTED, days_ago=1)
        self._set_slot(self.enrollment_a, "R02", NEEDS_REVISION, days_ago=2)
        self._review(self._set_slot(self.enrollment_a, "R03", SUBMITTED, days_ago=3), APPROVED,
                     note="線束固定確實。", score=88)
        self._set_slot(self.enrollment_b, "R04", SUBMITTED, days_ago=1)
        self._login_teacher()
        response = self.client.get(self.checklist_a)
        body = response.content.decode("utf-8")
        for anchor in (
            "checklist-basic",
            "checklist-unsubmitted",
            "checklist-pending",
            "checklist-needs-revision",
            "checklist-reviewed",
            "checklist-students",
        ):
            self.assertIn('id="%s"' % anchor, body)
        self.assertIn("班級總人數", body)
        self.assertIn("R01–R08 尚未提交", body)
        self.assertIn("待教師複核", body)
        self.assertIn("需要補充", body)
        self.assertIn("已有教師複核結果", body)
        self.assertIn("尚待處理", body)
        checklist = response.context["checklist"]
        self.assertEqual(checklist["student_count"], 2)
        self.assertEqual(checklist["unsubmitted_total"], 12)  # 2 人 × 8 槽 − 4 已提交
        self.assertEqual(checklist["pending_review_total"], 2)
        self.assertEqual(checklist["needs_revision_total"], 1)
        self.assertEqual(checklist["reviewed_result_total"], 1)

    def test_student_count_uses_active_enrollment_only(self):
        self._login_teacher()
        checklist = self.client.get(self.checklist_a).context["checklist"]
        self.assertEqual(checklist["student_count"], 2)
        ids = [row["student"].public_user_id for row in checklist["student_rows"]]
        self.assertEqual(len(ids), 2)
        self.assertNotIn(self.outsider.public_user_id, ids)

    # ── 驗收 2：0／部分／8 項提交情境 ────────────────────────────────
    def test_zero_submission_student(self):
        self._login_teacher()
        checklist = self.client.get(self.checklist_a).context["checklist"]
        row = next(r for r in checklist["student_rows"] if r["student"] == self.student_b)
        self.assertEqual(row["submitted_count"], 0)
        self.assertEqual(row["unsubmitted_count"], 8)
        self.assertEqual(row["outstanding_count"], 8)
        self.assertEqual(row["reviewed_result_count"], 0)
        self.assertTrue(all(item["status_key"] in ("not_started", "in_progress")
                            for item in row["outstanding_items"]))
        self.assertEqual(checklist["unsubmitted_total"], 16)
        self.assertEqual(checklist["outstanding_total"], 16)

    def test_partial_submission_student(self):
        self._set_slot(self.enrollment_a, "R01", SUBMITTED, days_ago=1)
        self._review(self._set_slot(self.enrollment_a, "R02", SUBMITTED, days_ago=2), APPROVED)
        self._set_slot(self.enrollment_a, "R03", NEEDS_REVISION, days_ago=3)
        self._login_teacher()
        checklist = self.client.get(self.checklist_a).context["checklist"]
        row = next(r for r in checklist["student_rows"] if r["student"] == self.student_a)
        self.assertEqual(row["submitted_count"], 3)
        self.assertEqual(row["unsubmitted_count"], 5)
        self.assertEqual(row["pending_count"], 1)
        self.assertEqual(row["needs_revision_count"], 1)
        self.assertEqual(row["reviewed_result_count"], 1)
        # 尚未提交 5 ＋ 待複核 1 ＋ 需補充 1
        self.assertEqual(row["outstanding_count"], 7)

    def test_all_eight_submitted_student(self):
        self._submit_all_eight(self.enrollment_a)
        self._login_teacher()
        response = self.client.get(self.checklist_a)
        checklist = response.context["checklist"]
        row = next(r for r in checklist["student_rows"] if r["student"] == self.student_a)
        self.assertEqual(row["submitted_count"], 8)
        self.assertEqual(row["unsubmitted_count"], 0)
        self.assertEqual(row["outstanding_count"], 8)  # 8 筆全在等教師複核
        self.assertEqual(checklist["unsubmitted_total"], 8)  # 只剩學員乙的 8 筆
        # 「八項已提交」只表示已提交，不得寫成通過
        body = response.content.decode("utf-8")
        self.assertNotIn("結訓通過名單", body)
        self.assertNotIn("已合格", body)
        self.assertIn("「八項已提交」不代表八項通過", body)

    # ── 驗收 3：待複核與需要補充分類 ────────────────────────────────
    def test_pending_and_needs_revision_classification(self):
        self._set_slot(self.enrollment_a, "R01", SUBMITTED, days_ago=1)
        self._set_slot(self.enrollment_a, "R02", NEEDS_REVISION, days_ago=2)
        self._set_slot(self.enrollment_b, "R03", SUBMITTED, days_ago=3)
        StudentTaskProgress.objects.create(
            enrollment=self.enrollment_a,
            task=self.task,
            status=StudentTaskProgress.Status.SUBMITTED,
            submitted_at=timezone.now() - timedelta(days=1),
        )
        self._login_teacher()
        checklist = self.client.get(self.checklist_a).context["checklist"]
        self.assertTrue(all(i["group"] == "pending_review" for i in checklist["pending_review_items"]))
        self.assertTrue(all(i["group"] == "needs_revision" for i in checklist["needs_revision_items"]))
        self.assertEqual(checklist["pending_review_total"], 3)
        self.assertEqual(checklist["needs_revision_total"], 1)
        # 任務提交與成長紀錄提交屬同一工作項目集合（P5-A 口徑）
        kinds = {item["source_label"] for item in checklist["pending_review_items"]}
        self.assertEqual(kinds, {"成長紀錄", "任務提交"})

    def test_unsubmitted_grouped_by_slot(self):
        self._set_slot(self.enrollment_a, "R01", SUBMITTED, days_ago=1)
        self._login_teacher()
        checklist = self.client.get(self.checklist_a).context["checklist"]
        grouped = dict(checklist["unsubmitted_by_slot"])
        # R01：只有學員甲已提交 → 只剩學員乙未提交
        self.assertEqual(len(grouped["R01"]), 1)
        self.assertEqual(grouped["R01"][0]["student"], self.student_b)
        # R02–R08：兩位學員皆未提交
        self.assertEqual(len(grouped["R02"]), 2)
        self.assertEqual(sorted(grouped), SLOT_IDS)

    # ── 複核入口必須指向既有頁面 ────────────────────────────────────
    def test_every_outstanding_item_links_to_existing_teacher_review_page(self):
        self._set_slot(self.enrollment_a, "R01", SUBMITTED, days_ago=1)
        self._set_slot(self.enrollment_a, "R02", NEEDS_REVISION, days_ago=2)
        StudentTaskProgress.objects.create(
            enrollment=self.enrollment_a,
            task=self.task,
            status=StudentTaskProgress.Status.SUBMITTED,
            submitted_at=timezone.now(),
        )
        self._login_teacher()
        checklist = self.client.get(self.checklist_a).context["checklist"]
        detail_prefixes = (
            reverse("learning:teacher_student_detail", args=[self.enrollment_a.pk]),
            reverse("learning:teacher_student_detail", args=[self.enrollment_b.pk]),
        )
        items = (
            checklist["pending_review_items"]
            + checklist["needs_revision_items"]
            + checklist["unsubmitted_items"]
        )
        self.assertTrue(items)
        for item in items:
            self.assertTrue(item["url"].startswith(detail_prefixes), item["url"])
            if item["source_label"] == "成長紀錄":
                self.assertTrue(item["url"].endswith("#growth-records"))
        # 清單本身不得含任何寫入端點，也不得新增複核路由
        body = self.client.get(self.checklist_a).content.decode("utf-8")
        self.assertNotIn("growth-reviews", body)
        self.assertNotIn("review_task", body)
        # 唯一的 POST 表單必須是 base.html 的登出表單
        actions = re.findall(r'<form method="post" action="([^"]+)"', body)
        self.assertEqual(actions, ["/logout/"])

    def test_checklist_never_claims_certification(self):
        self._submit_all_eight(self.enrollment_a)
        self._login_teacher()
        body = self.client.get(self.checklist_a).content.decode("utf-8")
        self.assertIn("不自動判定學員合格", body)
        self.assertIn("不核發任何證照", body)
        for forbidden in ("考照合格率", "結訓通過率", "民航局證照取得", "已取得專業操作證"):
            self.assertNotIn(forbidden, body)

    def test_other_cohort_checklist_is_404(self):
        """驗收 7：教師不得查看未授權班級，且不洩漏是否存在。"""
        self._login_teacher()
        url = reverse(
            "learning:teacher_cohort_review_checklist_cohort", args=[self.cohort_other.cohort_id]
        )
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(
            self.client.get(reverse("learning:teacher_cohort_review_checklist_cohort",
                                    args=["NOT-EXIST"])).status_code,
            404,
        )


# ══════════════════════════════════════════════════════════════════════
# 二、P6-B CSV 匯出
# ══════════════════════════════════════════════════════════════════════
class CohortExportTests(P6Base):
    def _seed(self):
        self._set_slot(self.enrollment_a, "R01", SUBMITTED, days_ago=1)
        self._set_slot(self.enrollment_a, "R02", NEEDS_REVISION, days_ago=2)
        self._review(self._set_slot(self.enrollment_a, "R03", SUBMITTED, days_ago=3), APPROVED,
                     note="線束固定確實。", score=88)
        self._set_slot(self.enrollment_b, "R04", SUBMITTED, days_ago=1)
        self._set_phase(self.enrollment_a, "learn", PhaseProgress.Status.COMPLETED)
        self._set_phase(self.enrollment_a, "practice", PhaseProgress.Status.IN_PROGRESS)

    def _set_phase(self, enrollment, phase, status):
        row, _ = PhaseProgress.objects.get_or_create(enrollment=enrollment, phase=phase)
        row.status = status
        row.save(update_fields=["status"])

    # ── 驗收 4：與 P5 報告統計一致 ──────────────────────────────────
    def test_summary_csv_matches_p5_report(self):
        self._seed()
        self._login_teacher()
        p5 = self.client.get(
            reverse("learning:teacher_class_report_cohort", args=[self.cohort_a.cohort_id])
        ).context["report"]
        response = self.client.get(self.summary_a)
        self.assertEqual(response.status_code, 200)
        metrics = self._summary_metrics(response)
        self.assertEqual(metrics["學員總人數（人）"], str(p5["student_count"]))
        self.assertEqual(metrics["R01–R08 已提交（筆）"], str(p5["total_submitted"]))
        self.assertEqual(metrics["R01–R08 已複核（筆）"], str(p5["total_reviewed"]))
        self.assertEqual(metrics["待教師複核（筆）"], str(p5["pending_items_total"]))
        self.assertEqual(metrics["需要補充（筆）"], str(p5["needs_revision_total"]))
        self.assertEqual(metrics["尚未提交（人）"], str(p5["not_submitted_count"]))
        self.assertEqual(metrics["八項已提交（人）"], str(p5["all_submitted_count"]))
        self.assertEqual(metrics["有待複核成果（人）"], str(p5["pending_student_count"]))

    def test_summary_csv_slot_and_stage_rows_match_report(self):
        self._seed()
        self._login_teacher()
        report = build_cohort_report(self.cohort_a)
        rows = parse_csv(self.client.get(self.summary_a).content)
        slot_rows = [row for row in rows[1:] if row and row[0] == "成長紀錄統計"]
        stage_rows = [row for row in rows[1:] if row and row[0] == "五階段進度"]
        self.assertEqual(len(slot_rows), 8)
        self.assertEqual(len(stage_rows), len(report["stage_rows"]))
        by_slot = {row[3]: row for row in slot_rows}
        for slot in report["slot_stats"]:
            self.assertEqual(by_slot[slot["slot_id"]][5], str(slot["submitted"]))
            self.assertEqual(by_slot[slot["slot_id"]][6], str(slot["total"]))
            self.assertEqual(by_slot[slot["slot_id"]][7], str(slot["reviewed"]))
        by_stage = {row[3]: row for row in stage_rows}
        for stage in report["stage_rows"]:
            self.assertEqual(by_stage[stage["key"]][5], str(stage["done"]))
            self.assertEqual(by_stage[stage["key"]][6], str(stage["total"]))

    def test_records_csv_matches_p5_report(self):
        self._seed()
        self._login_teacher()
        report = build_cohort_report(self.cohort_a)
        rows = parse_csv(self.client.get(self.records_a).content)
        header, body = rows[0], [row for row in rows[1:] if row and row[0] != "說明"]
        self.assertEqual(len(header), 12)
        self.assertEqual(len(body), len(report["student_rows"]) * 8)
        lookup = {(row[2], row[4]): row for row in body}
        for student_row in report["student_rows"]:
            cells = {cell["slot_id"]: cell for cell in student_row["slot_cells"]}
            for slot_id, cell in cells.items():
                row = lookup[(student_row["student"].public_user_id, slot_id)]
                self.assertEqual(row[6], cell["status_label"])
                self.assertEqual(row[9], str(student_row["completed_stages"]))
                self.assertEqual(row[10], str(student_row["stage_total"]))

    def test_records_csv_reports_teacher_review_status(self):
        self._seed()
        self._login_teacher()
        rows = parse_csv(self.client.get(self.records_a).content)
        body = [row for row in rows[1:] if row and row[0] != "說明"]
        lookup = {(row[2], row[4]): row for row in body}
        approved = lookup[(self.student_a.public_user_id, "R03")]
        self.assertEqual(approved[7], "合格")  # GrowthRecordReview.Status.APPROVED 標籤
        self.assertEqual(approved[8], "88.00")  # Decimal(5,2) 原樣輸出
        unreviewed = lookup[(self.student_a.public_user_id, "R01")]
        self.assertEqual(unreviewed[7], "尚未複核")
        self.assertEqual(unreviewed[8], "")

    # ── 驗收 5：繁體中文編碼 ────────────────────────────────────────
    def test_csv_has_utf8_bom_and_chinese_headers(self):
        self._seed()
        self._login_teacher()
        for url in (self.summary_a, self.records_a):
            response = self.client.get(url)
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.content.startswith(b"\xef\xbb\xbf"), url)
            text = response.content.decode("utf-8-sig")
            self.assertIn("班級名稱", text)
            self.assertIn("統計產生時間", text)
        summary = self.client.get(self.summary_a).content.decode("utf-8-sig")
        for header in ("類別", "班級編號", "項目代碼", "已提交或完成", "已複核"):
            self.assertIn(header, summary)
        records = self.client.get(self.records_a).content.decode("utf-8-sig")
        for header in ("學員識別碼", "學員顯示名稱", "R01–R08 提交狀態", "教師複核狀態", "複核評分"):
            self.assertIn(header, records)

    def test_csv_content_type_and_disposition(self):
        self._login_teacher()
        response = self.client.get(self.summary_a)
        self.assertIn("text/csv", response["Content-Type"])
        self.assertIn("charset=utf-8", response["Content-Type"])
        self.assertIn("attachment", response["Content-Disposition"])
        self.assertIn("cohort_summary_P6-A-2026_", response["Content-Disposition"])
        records = self.client.get(self.records_a)
        self.assertIn("cohort_records_P6-A-2026_", records["Content-Disposition"])

    # ── 驗收 6：公式注入防護 ────────────────────────────────────────
    def test_csv_safe_cell_covers_all_formula_prefixes(self):
        for prefix in CSV_FORMULA_PREFIXES:
            self.assertEqual(csv_safe_cell(prefix + "SUM(A1)"), "'" + prefix + "SUM(A1)")
        self.assertEqual(csv_safe_cell("正常文字"), "正常文字")
        self.assertEqual(csv_safe_cell(None), "")
        self.assertEqual(csv_safe_cell(True), "是")
        self.assertEqual(csv_safe_cell(False), "否")
        self.assertEqual(csv_safe_cell(0), "0")

    def test_csv_formula_injection_is_neutralised(self):
        """學員暱稱與班級名稱皆為攻擊向量；匯出後不得以公式字元開頭。"""
        evil_student = create_student_account("p6-evil@example.test", "=cmd|' /C calc'!A0")
        enroll_student(evil_student, self.cohort_a)
        evil_cohort = Cohort.objects.create(
            cohort_id="P6-INJ", name="@SUM(1+1)*cmd|'/C calc'!A0"
        )
        TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=evil_cohort)
        evil_student_2 = create_student_account("p6-evil2@example.test", "+1+1")
        enroll_student(evil_student_2, evil_cohort)
        self._login_teacher()

        for url in (
            self.summary_a,
            self.records_a,
            reverse("learning:teacher_cohort_export_summary_cohort", args=[evil_cohort.cohort_id]),
            reverse("learning:teacher_cohort_export_records_cohort", args=[evil_cohort.cohort_id]),
        ):
            rows = parse_csv(self.client.get(url).content)
            for row in rows:
                for cell in row:
                    if cell.startswith(CSV_FORMULA_PREFIXES):
                        self.fail("未中和的公式儲存格：%r（%s）" % (cell, url))
        # 攻擊字串仍完整保留（只是變成純文字），未被靜默丟棄
        text = self.client.get(self.records_a).content.decode("utf-8-sig")
        self.assertIn("'=cmd|' /C calc'!A0", text)

    # ── 個資與安全標頭 ──────────────────────────────────────────────
    def test_csv_excludes_personal_data_and_raw_evidence(self):
        self._seed()
        self._login_teacher()
        for url in (self.summary_a, self.records_a):
            text = self.client.get(url).content.decode("utf-8-sig")
            self.assertNotIn(self.student_a.email, text)
            self.assertNotIn(self.student_b.email, text)
            self.assertNotIn("@example.test", text)
            self.assertNotIn("/media/", text)
            self.assertNotIn("evidence", text.lower())
            self.assertNotIn("password", text.lower())
            self.assertNotIn("token", text.lower())
        # 仍保留既有班級識別碼與學員識別碼
        text = self.client.get(self.records_a).content.decode("utf-8-sig")
        self.assertIn(self.student_a.public_user_id, text)
        self.assertIn("學員甲", text)

    def test_csv_is_not_publicly_cacheable(self):
        self._login_teacher()
        for url in (self.summary_a, self.records_a):
            response = self.client.get(url)
            cache_control = response["Cache-Control"]
            self.assertIn("no-store", cache_control)
            self.assertIn("private", cache_control)
            self.assertIn("no-cache", cache_control)
            self.assertEqual(response["Pragma"], "no-cache")
            self.assertEqual(response["X-Content-Type-Options"], "nosniff")
            self.assertNotIn("public", cache_control)
        # 匯出端點不在任何公開靜態目錄下
        self.assertTrue(self.summary_a.startswith("/teacher/"))
        self.assertNotIn("/static/", self.summary_a)
        self.assertNotIn("/media/", self.summary_a)

    def test_csv_states_not_certification(self):
        self._seed()
        self._login_teacher()
        for url in (self.summary_a, self.records_a):
            text = self.client.get(url).content.decode("utf-8-sig")
            self.assertIn("不代表考核合格、結訓通過或任何證照取得", text)
            self.assertIn("非民航局專業操作證", text)
            for forbidden in ("考照合格率", "結訓通過率", "民航局證照取得"):
                self.assertNotIn(forbidden, text)

    # ── 驗收 7／8：權限 ─────────────────────────────────────────────
    def test_exports_require_teacher_role(self):
        """驗收 8：學員與未登入者一律不得匯出。"""
        for url in (self.summary_a, self.records_a, self.summary_url, self.records_url):
            self.client.logout()
            response = self.client.get(url)
            self.assertEqual(response.status_code, 302, url)
            self.assertIn("/teacher/login/", response["Location"])
            self.assertNotIn("attachment", response.get("Content-Disposition", ""))
            self.client.force_login(self.student_a.user)
            self.assertEqual(self.client.get(url).status_code, 403, url)
            self.client.force_login(self.teacher)
            self.assertEqual(self.client.get(url).status_code, 200, url)
        self.client.logout()
        self.assertEqual(self.client.get(self.checklist_a).status_code, 302)

    def test_cross_cohort_export_is_404(self):
        self._login_teacher()
        for name in (
            "learning:teacher_cohort_export_summary_cohort",
            "learning:teacher_cohort_export_records_cohort",
        ):
            url = reverse(name, args=[self.cohort_other.cohort_id])
            self.assertEqual(self.client.get(url).status_code, 404, url)
            unknown = reverse(name, args=["NOT-EXIST"])
            self.assertEqual(self.client.get(unknown).status_code, 404, unknown)

    def test_export_never_leaks_other_cohort_students(self):
        self._set_slot(self.enrollment_c, "R01", SUBMITTED, days_ago=1)
        self._login_teacher()
        for url in (self.summary_a, self.records_a):
            text = self.client.get(url).content.decode("utf-8-sig")
            self.assertNotIn(self.student_c.public_user_id, text)
            self.assertNotIn(self.outsider.public_user_id, text)

    # ── 驗收 9：無資料空狀態 ────────────────────────────────────────
    def test_empty_cohort_checklist_and_exports(self):
        self._login_teacher()
        response = self.client.get(self.checklist_empty)
        self.assertEqual(response.status_code, 200)
        checklist = response.context["checklist"]
        self.assertEqual(checklist["student_count"], 0)
        self.assertEqual(checklist["outstanding_total"], 0)
        body = response.content.decode("utf-8")
        self.assertIn("尚無紀錄（此班級目前尚無在學學員）", body)
        self.assertIn("尚無紀錄（此班級目前沒有尚未提交的 R01–R08 項目）", body)

        rows = parse_csv(self.client.get(
            reverse("learning:teacher_cohort_export_summary_cohort", args=[self.cohort_empty.cohort_id])
        ).content)
        self.assertEqual(rows[0][0], "類別")
        self.assertEqual([row for row in rows[1:] if row and row[0] == "成長紀錄統計"][0][5], "0")
        records = parse_csv(self.client.get(
            reverse("learning:teacher_cohort_export_records_cohort", args=[self.cohort_empty.cohort_id])
        ).content)
        self.assertEqual(len([row for row in records[1:] if row and row[0] != "說明"]), 0)

    def test_no_cohort_at_all(self):
        lonely = get_user_model().objects.create_user(
            username="p6-lonely",
            email="p6-lonely@example.test",
            password="Another-strong-passphrase-912!",
            is_staff=True,
        )
        self.client.force_login(lonely)
        response = self.client.get(self.checklist_url)
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.context["checklist"])
        self.assertIn("尚無紀錄", response.content.decode("utf-8"))
        # 沒有授權班級時匯出不得回傳空檔案假裝成功
        self.assertEqual(self.client.get(self.summary_url).status_code, 404)
        self.assertEqual(self.client.get(self.records_url).status_code, 404)

    # ── 驗收 10：手機版（390×844）版面契約 ─────────────────────────
    def test_mobile_css_contract(self):
        css = (
            Path(__file__).resolve().parents[1]
            / "static" / "learning" / "teacher-checklist.css"
        ).read_text(encoding="utf-8")
        self.assertIn("@media (max-width:680px)", css)
        self.assertIn("min-height:44px", css)
        self.assertIn("data-label", css)  # 表格轉卡片
        self.assertIn("overflow-x", css)  # 明確處理水平溢出
        # A4 列印
        self.assertIn("@page", css)
        self.assertIn("A4", css)
        self.assertIn("@media print", css)
        self.assertIn("table-header-group", css)
        self.assertIn("break-inside:avoid", css)
        self.assertRegex(css, r"@media print\{[^}]*\.topbar")

    def test_checklist_has_viewport_meta(self):
        self._login_teacher()
        body = self.client.get(self.checklist_a).content.decode("utf-8")
        self.assertIn("width=device-width", body)
        self.assertIn("teacher-checklist.css", body)


# ══════════════════════════════════════════════════════════════════════
# 三、單一統計來源（驗收 4／11：P5 未被破壞）
# ══════════════════════════════════════════════════════════════════════
class SingleSourceOfTruthTests(P6Base):
    def test_p5_page_checklist_and_csvs_share_one_source(self):
        self._set_slot(self.enrollment_a, "R01", SUBMITTED, days_ago=1)
        self._set_slot(self.enrollment_a, "R02", NEEDS_REVISION, days_ago=2)
        self._review(self._set_slot(self.enrollment_a, "R03", SUBMITTED, days_ago=3), APPROVED,
                     note="合格。", score=90)
        self._set_slot(self.enrollment_b, "R04", SUBMITTED, days_ago=1)
        StudentTaskProgress.objects.create(
            enrollment=self.enrollment_b,
            task=self.task,
            status=StudentTaskProgress.Status.SUBMITTED,
            submitted_at=timezone.now(),
        )
        self._login_teacher()
        report = self.client.get(
            reverse("learning:teacher_class_report_cohort", args=[self.cohort_a.cohort_id])
        ).context["report"]
        checklist = self.client.get(self.checklist_a).context["checklist"]
        metrics = self._summary_metrics(self.client.get(self.summary_a))

        self.assertEqual(checklist["student_count"], report["student_count"])
        self.assertEqual(checklist["pending_review_total"], report["pending_items_total"])
        self.assertEqual(checklist["needs_revision_total"], report["needs_revision_total"])
        self.assertEqual(checklist["reviewed_result_total"], report["reviewed_result_total"])
        self.assertEqual(checklist["unsubmitted_total"], report["unsubmitted_items_total"])
        self.assertEqual(metrics["待教師複核（筆）"], str(report["pending_items_total"]))
        self.assertEqual(metrics["需要補充（筆）"], str(report["needs_revision_total"]))
        self.assertEqual(metrics["學員總人數（人）"], str(report["student_count"]))
        # 任務提交也納入同一集合
        self.assertEqual(report["pending_items_total"], 3)

    def test_build_cohort_report_is_idempotent_and_read_only(self):
        """P6 只讀：重複呼叫彙整不得改變任何既有資料列，也不得產生複核紀錄。

        注意：首次呼叫會透過既有 `ensure_growth_submissions` / `PhaseProgress.get_or_create`
        補齊「本來就應該存在」的空白列（P5 既有行為、冪等），故以第二次呼叫為基準。
        """
        self._set_slot(self.enrollment_a, "R01", SUBMITTED, days_ago=1)
        build_cohort_report(self.cohort_a)
        before = list(
            GrowthRecordSubmission.objects.order_by("pk").values_list("pk", "status", "submitted_at")
        )
        phase_before = list(PhaseProgress.objects.order_by("pk").values_list("pk", "status"))
        build_cohort_report(self.cohort_a)
        after = list(
            GrowthRecordSubmission.objects.order_by("pk").values_list("pk", "status", "submitted_at")
        )
        phase_after = list(PhaseProgress.objects.order_by("pk").values_list("pk", "status"))
        self.assertEqual(before, after)
        self.assertEqual(phase_before, phase_after)
        self.assertEqual(GrowthRecordReview.objects.count(), 0)
        self.assertEqual(StudentTaskProgress.objects.count(), 0)
