"""P5-B／P5-C 班級結訓成果報告驗收（2026-10-13 教師指令）。

驗證重點：
  1. 教師後台有「班級成果報告」入口；未登入／學員不得存取。
  2. 只顯示教師授權班級；越權班級 404（不洩漏是否存在）。
  3. 班級名稱與課程資訊、學員總人數來自既有資料。
  4. R01–R08 提交統計與教師複核統計與 DB 一致。
  5. 五階段學習完成概況依 PhaseProgress.COMPLETED 判定。
  6. 各學員成果摘要（提交／複核／待複核／需補充／五階段／證據）。
  7. 待複核與需要補充數量與 P5-A 統一口徑一致。
  8. 教師回饋只顯示真實 GrowthRecordReview 評語；無資料顯示「尚無紀錄」。
  9. 報告為唯讀（不得含任何寫入表單）。
 10. 列印使用瀏覽器原生列印＋print CSS；不建伺服器 PDF。
 11. 成果證據沿用既有授權端點（evidence_download），不產生公開網址。
"""
from datetime import timedelta
from tempfile import TemporaryDirectory

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from learning.growth_records import ensure_growth_submissions
from learning.models import (
    Cohort,
    Evidence,
    GrowthRecordReview,
    GrowthRecordSubmission,
    PhaseProgress,
    TeacherCohortAccess,
)
from learning.tests.helpers import create_student_account, enroll_student

SUBMITTED = GrowthRecordSubmission.Status.SUBMITTED
NEEDS_REVISION = GrowthRecordSubmission.Status.NEEDS_REVISION
APPROVED = GrowthRecordSubmission.Status.APPROVED

# 1×1 透明 PNG：僅供測試建立「真的有檔案」的證據，不涉及任何真實學員資料。
TINY_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
)


def tiny_image_upload(name="evidence.png"):
    return SimpleUploadedFile(name, TINY_PNG, content_type="image/png")


class TeacherClassReportTests(TestCase):
    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="P5-2026", name="P5 報告班")
        self.cohort_other = Cohort.objects.create(cohort_id="P5-OTHER", name="其他班")
        self.cohort_empty = Cohort.objects.create(cohort_id="P5-EMPTY", name="空班級")
        self.teacher = get_user_model().objects.create_user(
            username="p5-teacher",
            email="p5-teacher@example.test",
            password="Another-strong-passphrase-911!",
            is_staff=True,
        )
        TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=self.cohort)
        TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=self.cohort_empty)
        self.student_a = create_student_account("p5-a@example.test", "學員甲")
        self.student_b = create_student_account("p5-b@example.test", "學員乙")
        self.enrollment_a = enroll_student(self.student_a, self.cohort)
        self.enrollment_b = enroll_student(self.student_b, self.cohort)
        self.outsider = create_student_account("p5-out@example.test", "他班學員")
        self.enrollment_out = enroll_student(self.outsider, self.cohort_other)
        self.url = reverse("learning:teacher_class_report")
        self.cohort_url = reverse(
            "learning:teacher_class_report_cohort", args=[self.cohort.cohort_id]
        )
        self.empty_url = reverse(
            "learning:teacher_class_report_cohort", args=[self.cohort_empty.cohort_id]
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

    def _set_phase(self, enrollment, phase, status):
        row, _ = PhaseProgress.objects.get_or_create(enrollment=enrollment, phase=phase)
        row.status = status
        row.save(update_fields=["status"])

    # ── 1. 入口與權限 ────────────────────────────────────────────────
    def test_dashboard_has_report_entry(self):
        self._login_teacher()
        response = self.client.get(self.dashboard_url)
        self.assertContains(response, "班級成果報告")
        self.assertContains(response, self.url)

    def test_requires_teacher_role(self):
        response = self.client.get(self.cohort_url)
        self.assertEqual(response.status_code, 302)
        self.assertIn("/teacher/login/", response["Location"])
        self.client.force_login(self.student_a.user)
        self.assertEqual(self.client.get(self.cohort_url).status_code, 403)
        self._login_teacher()
        self.assertEqual(self.client.get(self.cohort_url).status_code, 200)

    def test_other_cohort_report_is_404(self):
        """越權班級一律 404，不洩漏是否存在。"""
        self._login_teacher()
        url = reverse("learning:teacher_class_report_cohort", args=[self.cohort_other.cohort_id])
        self.assertEqual(self.client.get(url).status_code, 404)

    def test_default_cohort_selected(self):
        self._login_teacher()
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(response.context["report"])

    # ── 2. 班級基本資料與人數 ────────────────────────────────────────
    def test_basic_info_and_student_count(self):
        self._login_teacher()
        response = self.client.get(self.cohort_url)
        report = response.context["report"]
        self.assertEqual(report["student_count"], 2)
        self.assertEqual(report["cohort"], self.cohort)
        body = response.content.decode("utf-8")
        self.assertIn("P5 報告班", body)
        self.assertIn("P5-2026", body)
        self.assertIn("學員總人數", body)

    def test_student_count_excludes_other_cohort(self):
        self._login_teacher()
        report = self.client.get(self.cohort_url).context["report"]
        ids = [row["student"].public_user_id for row in report["student_rows"]]
        self.assertNotIn(self.outsider.public_user_id, ids)

    # ── 3. R01–R08 提交／複核統計 ────────────────────────────────────
    def test_slot_stats_match_database(self):
        self._set_slot(self.enrollment_a, "R01", SUBMITTED, days_ago=1)
        self._review(self._set_slot(self.enrollment_a, "R02", SUBMITTED, days_ago=2), APPROVED)
        self._set_slot(self.enrollment_a, "R03", NEEDS_REVISION, days_ago=3)
        self._set_slot(self.enrollment_b, "R01", SUBMITTED, days_ago=1)
        self._login_teacher()
        report = self.client.get(self.cohort_url).context["report"]
        stats = {row["slot_id"]: row for row in report["slot_stats"]}
        # R01：兩位學員皆已提交，皆未複核
        self.assertEqual((stats["R01"]["submitted"], stats["R01"]["reviewed"]), (2, 0))
        # R02：甲已提交並已複核
        self.assertEqual((stats["R02"]["submitted"], stats["R02"]["reviewed"]), (1, 1))
        # R03：甲需補充（屬已提交且已複核）
        self.assertEqual((stats["R03"]["submitted"], stats["R03"]["reviewed"]), (1, 1))
        # R04–R08：無提交
        self.assertEqual((stats["R04"]["submitted"], stats["R04"]["reviewed"]), (0, 0))
        # 逐槽分母＝班級人數
        self.assertTrue(all(row["total"] == 2 for row in report["slot_stats"]))

    def test_total_submitted_and_reviewed(self):
        self._set_slot(self.enrollment_a, "R01", SUBMITTED, days_ago=1)
        self._review(self._set_slot(self.enrollment_a, "R02", SUBMITTED, days_ago=2), APPROVED)
        self._login_teacher()
        report = self.client.get(self.cohort_url).context["report"]
        self.assertEqual(report["total_submitted"], 2)
        self.assertEqual(report["total_reviewed"], 1)

    # ── 4. 五階段 ────────────────────────────────────────────────────
    def test_stage_progress_uses_completed_only(self):
        self._set_phase(self.enrollment_a, "learn", PhaseProgress.Status.COMPLETED)
        self._set_phase(self.enrollment_b, "learn", PhaseProgress.Status.IN_PROGRESS)
        self._set_phase(self.enrollment_a, "practice", PhaseProgress.Status.COMPLETED)
        self._login_teacher()
        report = self.client.get(self.cohort_url).context["report"]
        stages = {row["key"]: row for row in report["stage_rows"]}
        self.assertEqual(stages["learn"]["done"], 1)  # in_progress 不計入
        self.assertEqual(stages["learn"]["total"], 2)
        self.assertEqual(stages["practice"]["done"], 1)
        self.assertEqual(stages["build"]["done"], 0)

    # ── 5. 待複核與需要補充（P5-A 統一口徑）─────────────────────────
    def test_pending_and_needs_revision_counts(self):
        self._set_slot(self.enrollment_a, "R01", SUBMITTED, days_ago=1)
        self._set_slot(self.enrollment_a, "R02", NEEDS_REVISION, days_ago=2)
        self._set_slot(self.enrollment_b, "R03", SUBMITTED, days_ago=3)
        self._login_teacher()
        report = self.client.get(self.cohort_url).context["report"]
        self.assertEqual(report["pending_items_total"], 2)
        self.assertEqual(report["needs_revision_total"], 1)
        self.assertEqual(report["pending_student_count"], 2)
        # 學員層級與班級層級同集合
        row_a = next(r for r in report["student_rows"] if r["student"] == self.student_a)
        self.assertEqual(row_a["pending_count"], 1)
        self.assertEqual(row_a["needs_revision_count"], 1)

    # ── 6. 教師回饋 ──────────────────────────────────────────────────
    def test_feedback_only_real_notes(self):
        submission = self._set_slot(self.enrollment_a, "R01", SUBMITTED, days_ago=1)
        self._review(submission, APPROVED, note="組裝正確，線束固定確實。", score=88)
        # 另一筆已複核但未填評語 → 不得出現在回饋區
        other = self._set_slot(self.enrollment_a, "R02", SUBMITTED, days_ago=2)
        self._review(other, APPROVED, note="", score=70)
        self._login_teacher()
        response = self.client.get(self.cohort_url)
        report = response.context["report"]
        body = response.content.decode("utf-8")
        # 回饋區只納入教師真的填過評語的紀錄，且內容與 DB 逐字相同
        self.assertEqual(len(report["feedback_rows"]), 1)
        self.assertEqual(report["feedback_rows"][0]["note"], "組裝正確，線束固定確實。")
        self.assertIn("組裝正確，線束固定確實。", body)
        # 空白評語不得被系統或 AI 代寫成任何文字
        for placeholder in ("AI 生成", "系統產生", "自動產生評語", "範例評語"):
            self.assertNotIn(placeholder, body)

    def test_feedback_empty_state(self):
        self._set_slot(self.enrollment_a, "R01", SUBMITTED, days_ago=1)
        self._login_teacher()
        body = self.client.get(self.cohort_url).content.decode("utf-8")
        self.assertIn("尚無紀錄（目前尚無任何教師評語或回饋）", body)

    # ── 7. 無資料空狀態 ──────────────────────────────────────────────
    def test_empty_cohort_shows_empty_state(self):
        self._login_teacher()
        response = self.client.get(self.empty_url)
        self.assertEqual(response.status_code, 200)
        report = response.context["report"]
        self.assertEqual(report["student_count"], 0)
        self.assertEqual(report["pending_items_total"], 0)
        body = response.content.decode("utf-8")
        self.assertIn("尚無紀錄", body)
        self.assertIn("尚無紀錄（此班級目前尚無在學學員）", body)

    def test_no_cohort_at_all_shows_empty_state(self):
        lonely = get_user_model().objects.create_user(
            username="p5-lonely",
            email="p5-lonely@example.test",
            password="Another-strong-passphrase-912!",
            is_staff=True,
        )
        self.client.force_login(lonely)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.context["report"])
        self.assertIn("尚無紀錄", response.content.decode("utf-8"))

    # ── 8. 唯讀與列印 ────────────────────────────────────────────────
    def test_report_is_read_only(self):
        self._set_slot(self.enrollment_a, "R01", SUBMITTED, days_ago=1)
        self._login_teacher()
        body = self.client.get(self.cohort_url).content.decode("utf-8")
        # base.html 的登出表單不在此限；不得含任何寫入端點
        self.assertNotIn("growth-reviews", body)
        self.assertNotIn("review_task", body)

    def test_print_assets_present(self):
        self._login_teacher()
        body = self.client.get(self.cohort_url).content.decode("utf-8")
        self.assertIn("teacher-report.css", body)
        self.assertIn('id="print-report"', body)
        self.assertIn("window.print()", body)
        # 未開發伺服器 PDF 產生器
        self.assertNotIn("report.pdf", body)
        self.assertNotIn("report_pdf", body)

    def test_print_css_has_a4_and_hides_chrome(self):
        from pathlib import Path

        css_path = Path(__file__).resolve().parents[1] / "static" / "learning" / "teacher-report.css"
        css = css_path.read_text(encoding="utf-8")
        self.assertIn("@page", css)
        self.assertIn("A4", css)
        self.assertIn("@media print", css)
        self.assertIn("table-header-group", css)
        self.assertIn("break-inside:avoid", css)
        self.assertIn(".trp-toolbar", css)
        # 列印時隱藏導覽列與工具列
        self.assertRegex(css, r"@media print\{[^}]*\.topbar")

    def test_mobile_media_query_present(self):
        from pathlib import Path

        css_path = Path(__file__).resolve().parents[1] / "static" / "learning" / "teacher-report.css"
        css = css_path.read_text(encoding="utf-8")
        self.assertIn("@media (max-width:680px)", css)
        self.assertIn("min-height:44px", css)

    # ── 9. 成果證據 ──────────────────────────────────────────────────
    def test_evidence_uses_authorized_endpoint(self):
        submission = self._set_slot(self.enrollment_a, "R01", SUBMITTED, days_ago=1)
        with TemporaryDirectory() as media_dir, override_settings(MEDIA_ROOT=media_dir):
            evidence = Evidence.objects.create(
                growth_submission=submission,
                evidence_type=Evidence.Type.IMAGE,
                description="組裝成果照片",
                upload=tiny_image_upload(),
            )
            self._login_teacher()
            response = self.client.get(self.cohort_url)
            body = response.content.decode("utf-8")
            # 圖片縮圖與連結都必須走既有授權端點，且不得產生任何公開網址
            endpoint = reverse("learning:evidence_download", args=[evidence.pk])
            self.assertIn(endpoint, body)
            self.assertIn("inline=1", body)
            self.assertNotIn(f"/media/{evidence.upload.name}", body)
            report = response.context["report"]
            row = next(r for r in report["student_rows"] if r["student"] == self.student_a)
            self.assertEqual(row["evidence_count"], 1)
            self.assertTrue(row["evidence_rows"][0]["is_image"])

    def test_evidence_without_upload_shows_placeholder(self):
        """無檔案亦無外部連結的證據，不得產生任何可點擊網址。"""
        submission = self._set_slot(self.enrollment_a, "R01", SUBMITTED, days_ago=1)
        Evidence.objects.create(
            growth_submission=submission,
            evidence_type=Evidence.Type.IMAGE,
            description="尚未上傳",
        )
        self._login_teacher()
        response = self.client.get(self.cohort_url)
        body = response.content.decode("utf-8")
        self.assertIn("證據檔案尚未處理", body)
        report = response.context["report"]
        row = next(r for r in report["student_rows"] if r["student"] == self.student_a)
        self.assertFalse(row["evidence_rows"][0]["is_image"])
        self.assertFalse(row["evidence_rows"][0]["has_upload"])

    def test_external_evidence_link_not_made_public(self):
        submission = self._set_slot(self.enrollment_a, "R01", SUBMITTED, days_ago=1)
        Evidence.objects.create(
            growth_submission=submission,
            evidence_type=Evidence.Type.GITHUB,
            description="開源連結",
            external_url="https://example.invalid/repo",
        )
        self._login_teacher()
        report = self.client.get(self.cohort_url).context["report"]
        row = next(r for r in report["student_rows"] if r["student"] == self.student_a)
        self.assertEqual(row["evidence_count"], 1)
        self.assertEqual(row["evidence_rows"][0]["external_url"], "https://example.invalid/repo")
