"""P8 成果展示安全加固與交付驗收（2026-10-13 教師指令第五節 10 項）。

對應驗收項目：
  1. GET 與 CSV 的資料庫副作用（資料齊備時不得有任何寫入）。
  2. 匿名模式的身分資訊隔離（暱稱／既有識別碼／評語／證據／外部連結）。
  3. 班級切換的授權狀態（逐班隔離，不沿用）。
  4. Session 失效（登出後授權歸零）。
  5. 教師跨班級權限。
  6. 證據下載權限。
  7. 投影與手機版面（CSS 契約；實機畫面由 p8_screenshot.cjs 驗證）。
  8. 圖片缺失及載入失敗（空狀態與佔位，不影響整場展示）。
  9. P5／P6／P7 統計一致。
 10. P1–P7 必要回歸。

另驗證 P8-A 稽核結論：`build_cohort_report()` 為「冪等讀 ＋ 惰性初始化」，
資料齊備時純讀；缺資料時才補建（此行為不得改變統計語意）。
"""
import hashlib
import re
from datetime import timedelta
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from learning.growth_records import ensure_growth_submissions
from learning.models import (
    Cohort,
    Evidence,
    GrowthRecordReview,
    GrowthRecordSubmission,
    StudentTaskProgress,
    TaskDefinition,
    TeacherCohortAccess,
)
from learning.tests.helpers import create_student_account, enroll_student
from learning.views import (
    SHOWCASE_CONSENT_SESSION_KEY,
    build_cohort_report,
)

SUBMITTED = GrowthRecordSubmission.Status.SUBMITTED
APPROVED = GrowthRecordSubmission.Status.APPROVED
SLOT_IDS = ["R%02d" % index for index in range(1, 9)]

STATIC_DIR = Path(__file__).resolve().parent.parent / "static" / "learning"
SHOWCASE_CSS = (STATIC_DIR / "teacher-showcase.css").read_text(encoding="utf-8")


class P8Base(TestCase):
    def setUp(self):
        self.cohort_a = Cohort.objects.create(cohort_id="P8-A-2026", name="P8 甲班")
        self.cohort_b = Cohort.objects.create(cohort_id="P8-B-2026", name="P8 乙班")
        self.cohort_other = Cohort.objects.create(cohort_id="P8-OTHER", name="未授權班")

        self.teacher = get_user_model().objects.create_user(
            username="p8-teacher",
            email="p8-teacher@example.test",
            password="Another-strong-passphrase-911!",
            is_staff=True,
        )
        for cohort in (self.cohort_a, self.cohort_b):
            TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=cohort)

        self.student_a = create_student_account("p8-a@example.test", "學員甲")
        self.student_b = create_student_account("p8-b@example.test", "學員乙")
        self.enrollment_a = enroll_student(self.student_a, self.cohort_a)
        self.enrollment_b = enroll_student(self.student_b, self.cohort_b)

        self.outsider = create_student_account("p8-out@example.test", "他班學員")
        self.enrollment_out = enroll_student(self.outsider, self.cohort_other)

        self.task = TaskDefinition.objects.create(
            task_id="T06", sort_order=6, stage=TaskDefinition.Stage.BUILD, title="F450 組裝"
        )

        self.showcase_url = reverse("learning:teacher_class_showcase")
        self.showcase_a = reverse(
            "learning:teacher_class_showcase_cohort", args=[self.cohort_a.cohort_id]
        )
        self.showcase_b = reverse(
            "learning:teacher_class_showcase_cohort", args=[self.cohort_b.cohort_id]
        )
        self.showcase_other = reverse(
            "learning:teacher_class_showcase_cohort", args=[self.cohort_other.cohort_id]
        )
        self.report_a = reverse(
            "learning:teacher_class_report_cohort", args=[self.cohort_a.cohort_id]
        )
        self.checklist_a = reverse(
            "learning:teacher_cohort_review_checklist_cohort", args=[self.cohort_a.cohort_id]
        )
        self.summary_a = reverse(
            "learning:teacher_cohort_export_summary_cohort", args=[self.cohort_a.cohort_id]
        )
        self.records_a = reverse(
            "learning:teacher_cohort_export_records_cohort", args=[self.cohort_a.cohort_id]
        )

    # ── 工具 ──────────────────────────────────────────────────────────
    def _login_teacher(self):
        self.client.force_login(self.teacher)

    def _body(self, response):
        return response.content.decode("utf-8")

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

    def _add_image_evidence(self, enrollment, slot_id, name="proof.png", with_file=True):
        submission = next(
            row
            for row in ensure_growth_submissions(enrollment)
            if row.definition.slot_id == slot_id
        )
        return Evidence.objects.create(
            growth_submission=submission,
            evidence_type=Evidence.Type.IMAGE,
            description="組裝完成照",
            upload=SimpleUploadedFile(name, b"\x89PNG\r\n\x1a\n", content_type="image/png")
            if with_file
            else "",
        )

    def _fingerprint(self):
        """全庫逐表指紋（行數 + 內容 SHA256），用於偵測任何 INSERT／UPDATE／DELETE。"""
        tables = sorted(connection.introspection.table_names())
        fingerprint = {}
        with connection.cursor() as cursor:
            for table in tables:
                cursor.execute('SELECT * FROM "%s"' % table)
                rows = cursor.fetchall()
                payload = "\n".join(repr(tuple(row)) for row in rows)
                fingerprint[table] = (
                    len(rows),
                    hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12],
                )
        return fingerprint


# ══ 1. 讀取副作用（P8-A 稽核結論固化） ═══════════════════════════════════
class P8ReadOnlyAuditTests(P8Base):
    def _prepare_complete_data(self):
        """把班級資料補到齊備（完成惰性初始化），使後續讀取應為純讀。"""
        build_cohort_report(self.cohort_a)
        build_cohort_report(self.cohort_b)
        self._set_slot(self.enrollment_a, "R01", SUBMITTED, days_ago=1)
        self._set_slot(self.enrollment_b, "R02", SUBMITTED, days_ago=1)

    def test_report_pages_do_not_write_when_data_complete(self):
        """資料齊備時，P5／P6／P7 讀取不得產生任何寫入。"""
        self._login_teacher()
        self._prepare_complete_data()
        before = self._fingerprint()

        for url in (
            self.report_a,
            self.checklist_a,
            self.showcase_a,
            self.showcase_b,
            reverse("learning:teacher_class_report"),
        ):
            response = self.client.get(url)
            self.assertEqual(response.status_code, 200, url)

        after = self._fingerprint()
        changed = {
            table: (before[table], after[table])
            for table in before
            if before[table] != after[table]
        }
        self.assertEqual(changed, {}, "資料齊備時讀取仍產生寫入：%s" % changed)

    def test_csv_exports_do_not_write(self):
        """CSV 匯出不得產生任何寫入。"""
        self._login_teacher()
        self._prepare_complete_data()
        before = self._fingerprint()
        for url in (self.summary_a, self.records_a):
            self.assertEqual(self.client.get(url).status_code, 200, url)
        after = self._fingerprint()
        changed = {
            table: (before[table], after[table])
            for table in before
            if before[table] != after[table]
        }
        self.assertEqual(changed, {}, "CSV 匯出仍產生寫入：%s" % changed)

    def test_cross_cohort_read_does_not_write(self):
        """跨班級讀取不得產生任何寫入。"""
        self._login_teacher()
        self._prepare_complete_data()
        before = self._fingerprint()
        for url in (self.showcase_b, self.report_a, self.checklist_a):
            self.client.get(url)
        after = self._fingerprint()
        changed = {
            table: (before[table], after[table])
            for table in before
            if before[table] != after[table]
        }
        self.assertEqual(changed, {}, "跨班級讀取仍產生寫入：%s" % changed)

    def test_missing_data_keeps_stats_equivalent_without_writes(self):
        """缺資料時統計語意不變，且讀取**不再補建任何資料列**（P9-A 唯讀化）。

        P8 時期此處為「冪等惰性初始化」；P9-A 已將補建移出 build_cohort_report()，
        改以唯讀替身表達「未開始」，故本測試同時驗證「統計等價」與「零寫入」。
        """
        self._login_teacher()
        build_cohort_report(self.cohort_a)
        before_report = build_cohort_report(self.cohort_a)

        # 刪除一位學員的成長紀錄提交與階段進度
        GrowthRecordSubmission.objects.filter(enrollment=self.enrollment_a).delete()
        self.enrollment_a.phase_progress.all().delete()

        self.client.get(self.showcase_a)
        after_report = build_cohort_report(self.cohort_a)

        # P9-A：讀取不得把資料補回來
        self.assertEqual(
            GrowthRecordSubmission.objects.filter(enrollment=self.enrollment_a).count(),
            0,
            "P9-A 唯讀化後，讀取不得再補建成長紀錄提交列",
        )
        self.assertEqual(
            self.enrollment_a.phase_progress.count(),
            0,
            "P9-A 唯讀化後，讀取不得再補建階段進度列",
        )

        # 補建後統計語意必須完全相同
        for key in (
            "student_count",
            "total_submitted",
            "total_reviewed",
            "pending_items_total",
            "needs_revision_total",
        ):
            self.assertEqual(before_report[key], after_report[key], key)
        self.assertEqual(
            [row["done"] for row in before_report["stage_rows"]],
            [row["done"] for row in after_report["stage_rows"]],
        )
        self.assertEqual(
            [slot["submitted"] for slot in before_report["slot_stats"]],
            [slot["submitted"] for slot in after_report["slot_stats"]],
        )

    def test_build_cohort_report_is_documented_as_readonly(self):
        """P9-A 起本函式為**純唯讀**；說明須載明惰性初始化已移出且未刪除初始化函式。

        P8 時期本函式為「讀取 ＋ 冪等惰性初始化」，該契約已由 P9-A 有意取代
        （教師指令：P5 報告／P6 清單／P6 CSV／P7 展示的讀取不得產生資料庫寫入）。
        """
        source = build_cohort_report.__doc__ or ""
        self.assertIn("單一統計來源", source)
        self.assertIn("純唯讀", source)
        self.assertIn("移出", source)
        self.assertIn("未被刪除", source)


# ══ 2. 授權範圍（驗收 3、4） ═════════════════════════════════════════════
class P8ConsentScopeTests(P8Base):
    def test_consent_is_isolated_per_cohort(self):
        """在 A 班開啟具名展示，切到 B 班仍為匿名。"""
        self._login_teacher()
        self.client.post(self.showcase_a, {"action": "enable_identify"})
        self.assertIn("學員甲", self._body(self.client.get(self.showcase_a)))
        body_b = self._body(self.client.get(self.showcase_b))
        self.assertNotIn("學員乙", body_b)
        self.assertIn("匿名化展示（預設）", body_b)

    def test_returning_to_consented_cohort_keeps_named_mode(self):
        self._login_teacher()
        self.client.post(self.showcase_a, {"action": "enable_identify"})
        self.client.get(self.showcase_b)
        self.assertIn("學員甲", self._body(self.client.get(self.showcase_a)))

    def test_consent_can_be_revoked_per_cohort(self):
        self._login_teacher()
        self.client.post(self.showcase_a, {"action": "enable_identify"})
        self.client.post(self.showcase_a, {"action": "disable_identify"})
        self.assertNotIn(SHOWCASE_CONSENT_SESSION_KEY, self.client.session)
        self.assertNotIn("學員甲", self._body(self.client.get(self.showcase_a)))

    def test_session_consent_survives_other_cohort_toggle(self):
        self._login_teacher()
        self.client.post(self.showcase_a, {"action": "enable_identify"})
        self.client.post(self.showcase_b, {"action": "enable_identify"})
        self.assertEqual(
            sorted(self.client.session[SHOWCASE_CONSENT_SESSION_KEY]),
            ["P8-A-2026", "P8-B-2026"],
        )

    def test_logout_invalidates_consent(self):
        """登出後 session 失效，授權狀態不得殘留。"""
        self._login_teacher()
        self.client.post(self.showcase_a, {"action": "enable_identify"})
        self.assertIn("學員甲", self._body(self.client.get(self.showcase_a)))

        self.client.logout()
        self._login_teacher()
        body = self._body(self.client.get(self.showcase_a))
        self.assertNotIn("學員甲", body)
        self.assertIn("匿名化展示（預設）", body)

    def test_legacy_boolean_consent_is_not_honoured(self):
        """舊版（P7）不分班級的布林授權不得被沿用。"""
        self._login_teacher()
        session = self.client.session
        session[SHOWCASE_CONSENT_SESSION_KEY] = True
        session.save()
        body = self._body(self.client.get(self.showcase_a))
        self.assertNotIn("學員甲", body)
        self.assertIn("匿名化展示（預設）", body)

    def test_post_still_redirects_to_same_path_only(self):
        self._login_teacher()
        response = self.client.post(
            self.showcase_a, {"action": "enable_identify", "next": "https://evil.example/"}
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], self.showcase_a)

    def test_cross_cohort_post_is_404(self):
        """對無權班級 POST 授權不得生效。"""
        self._login_teacher()
        response = self.client.post(self.showcase_other, {"action": "enable_identify"})
        self.assertEqual(response.status_code, 404)
        self.assertNotIn(SHOWCASE_CONSENT_SESSION_KEY, self.client.session)


# ══ 3. 匿名身分隔離（驗收 2） ═══════════════════════════════════════════
class P8AnonymityTests(P8Base):
    def test_anonymous_hides_nickname_and_identifier(self):
        """匿名模式不得出現暱稱，也不得出現既有唯一識別碼。"""
        self._set_slot(self.enrollment_a, "R01", SUBMITTED, days_ago=1)
        self._login_teacher()
        body = self._body(self.client.get(self.showcase_a))
        self.assertNotIn("學員甲", body)
        self.assertNotIn(self.student_a.public_user_id, body)
        self.assertIn("學員 01", body)

    def test_anonymous_hides_teacher_note(self):
        """教師評語可能含姓名，匿名模式不得輸出評語內容。"""
        submission = self._set_slot(self.enrollment_a, "R01", SUBMITTED, days_ago=1)
        self._review(submission, APPROVED, note="學員甲接線整齊，散熱走線可再加強。", score=88)
        self._login_teacher()
        body = self._body(self.client.get(self.showcase_a))
        self.assertNotIn("學員甲接線整齊", body)
        self.assertNotIn("散熱走線可再加強", body)
        self.assertIn("不顯示評語內容", body)

    def test_anonymous_context_has_no_identifying_rows(self):
        """匿名模式下連 context 也不得保留評語與複核結果列。"""
        submission = self._set_slot(self.enrollment_a, "R01", SUBMITTED, days_ago=1)
        self._review(submission, APPROVED, note="學員甲表現良好。", score=90)
        self._login_teacher()
        response = self.client.get(self.showcase_a)
        self.assertEqual(response.context["report"]["feedback_rows"], [])
        self.assertEqual(response.context["report"]["review_result_rows"], [])

    def test_anonymous_hides_evidence_and_external_urls(self):
        submission = next(
            row
            for row in ensure_growth_submissions(self.enrollment_a)
            if row.definition.slot_id == "R02"
        )
        Evidence.objects.create(
            growth_submission=submission,
            evidence_type=Evidence.Type.OTHER,
            external_url="https://example.test/student-a-portfolio",
            description="學員甲作品集",
        )
        self._login_teacher()
        body = self._body(self.client.get(self.showcase_a))
        self.assertNotIn("https://example.test/student-a-portfolio", body)
        self.assertNotIn("學員甲作品集", body)
        self.assertNotIn("/download/", body)
        self.assertNotIn("/media/", body)

    def test_anonymous_html_contains_no_student_profile_fields(self):
        """頁面原始碼不得含暱稱、識別碼或頭像類欄位。"""
        self._set_slot(self.enrollment_a, "R01", SUBMITTED, days_ago=1)
        self._login_teacher()
        body = self._body(self.client.get(self.showcase_a))
        for token in ("學員甲", self.student_a.public_user_id, "avatar", "student_profile"):
            self.assertNotIn(token, body, token)

    def test_named_mode_is_labelled_as_teacher_confirmation(self):
        """具名展示必須明確標示為教師確認，而非系統已查核。"""
        self._login_teacher()
        self.client.post(self.showcase_a, {"action": "enable_identify"})
        body = self._body(self.client.get(self.showcase_a))
        self.assertIn("教師確認已取得必要授權", body)
        self.assertIn("本系統無法查核授權來源", body)

    def test_anonymous_mode_has_no_named_label(self):
        self._login_teacher()
        body = self._body(self.client.get(self.showcase_a))
        self.assertNotIn("具名展示（教師確認已取得必要授權）", body)
        self.assertIn("匿名化展示（預設）", body)

    def test_anonymous_keeps_note_count_but_not_note_body(self):
        """匿名時仍須讓教師知道「有幾筆評語」，但不得輸出評語內容。

        P8-C 修正：計數（feedback_note_total）為純數字，不含可識別內容，
        匿名與具名兩種模式必須一致；否則教師會誤以為「完全沒有評語」。
        """
        submission = self._set_slot(self.enrollment_a, "R01", SUBMITTED, days_ago=1)
        self._review(submission, APPROVED, note="學員甲接線整齊，散熱走線可再加強。", score=88)
        self._login_teacher()
        anon = self.client.get(self.showcase_a)
        self.assertEqual(anon.context["feedback_note_total"], 1)
        anon_body = self._body(anon)
        self.assertNotIn("學員甲接線整齊", anon_body)
        self.assertIn("共 1 筆評語", anon_body)

        self.client.post(self.showcase_a, {"action": "enable_identify"})
        named = self.client.get(self.showcase_a)
        self.assertEqual(named.context["feedback_note_total"], 1)
        named_body = self._body(named)
        self.assertIn("學員甲接線整齊", named_body)

    def test_anonymous_empty_feedback_shows_no_record_state(self):
        """匿名模式下若真的沒有任何評語，仍須顯示「尚無紀錄」空狀態。

        P8-B 改為匿名時清空 feedback_rows 後，空狀態曾一度消失（教師無法分辨
        「沒有評語」與「有評語但被隱藏」）。P8-C 以純數字計數修復。
        """
        self._login_teacher()
        response = self.client.get(self.showcase_a)
        self.assertEqual(response.context["feedback_note_total"], 0)
        body = self._body(response)
        self.assertIn("尚無紀錄", body)
        self.assertNotIn("共 0 筆評語", body)


# ══ 4. 圖片缺失與載入失敗（驗收 8） ═════════════════════════════════════
class P8EvidenceFallbackTests(P8Base):
    def _enable_identify(self):
        self._login_teacher()
        self.client.post(self.showcase_a, {"action": "enable_identify"})

    def test_evidence_without_file_renders_placeholder(self):
        """無實體檔案的證據顯示佔位文字，不產生 <img>，不影響整場展示。"""
        self._add_image_evidence(self.enrollment_a, "R01", with_file=False)
        self._enable_identify()
        body = self._body(self.client.get(self.showcase_a))
        self.assertIn("證據檔案尚未處理", body)
        self.assertNotIn("<img class=\"sc-evidence-thumb\"", body)

    def test_evidence_with_file_renders_authorised_endpoint(self):
        evidence = self._add_image_evidence(self.enrollment_a, "R01", with_file=True)
        self._enable_identify()
        body = self._body(self.client.get(self.showcase_a))
        self.assertIn("/download/?inline=1", body)
        self.assertNotIn("/media/", body)
        self.assertIn(str(evidence.pk), body)

    def test_cohort_without_evidence_shows_empty_state(self):
        self._login_teacher()
        body = self._body(self.client.get(self.showcase_a))
        self.assertIn("尚無紀錄（尚無成果證據）", body)

    def test_missing_evidence_does_not_break_other_slides(self):
        """單一證據缺失不得影響其他頁面內容。"""
        self._add_image_evidence(self.enrollment_a, "R01", with_file=False)
        self._enable_identify()
        body = self._body(self.client.get(self.showcase_a))
        for slide in ("cover", "outcomes", "stages", "slots", "works", "feedback", "closing"):
            self.assertIn('data-slide="%s"' % slide, body)


# ══ 5. 版面契約（驗收 7） ═══════════════════════════════════════════════
class P8LayoutContractTests(P8Base):
    def test_long_teacher_note_wraps(self):
        """長篇教師評語不得溢出畫面：儲存格必須可斷行。

        P8-C 實測缺陷：基礎樣式表有全域 `table{white-space:nowrap}`，會被儲存格
        繼承而使長評語完全不換行（評語欄 scrollWidth 4534px / clientWidth 484px），
        並把外層 grid 投影片一起撐開（stage 1120px → slide 4956px）。
        修法為本頁顯式覆寫 white-space:normal（不改全域規則）。
        """
        compact = SHOWCASE_CSS.replace(" ", "")
        self.assertIn("overflow-wrap:anywhere", compact)
        self.assertIn(".sc-tabletd{color:#3d5464;overflow-wrap:anywhere;white-space:normal}", compact)

    def test_table_and_stage_cannot_be_stretched_by_long_content(self):
        """表格與 grid 投影片須能被長內容收斂，不得撐破版面。"""
        compact = SHOWCASE_CSS.replace(" ", "")
        self.assertIn("table-layout:fixed", compact)
        self.assertIn("grid-template-columns:minmax(0,1fr)", compact)
        self.assertIn(".sc-slide{", compact)
        self.assertIn("min-width:0}", compact)

    def test_projection_resolutions_covered_by_vmin_scaling(self):
        """1920×1080 與 1366×768 由 vmin 等比縮放涵蓋。"""
        self.assertIn("vmin", SHOWCASE_CSS)
        self.assertIn("16 / 9", SHOWCASE_CSS)

    def test_mobile_breakpoint_and_touch_target(self):
        self.assertIn("@media (max-width:680px)", SHOWCASE_CSS)
        self.assertIn("min-height:44px", SHOWCASE_CSS)

    def test_no_large_frontend_framework_added(self):
        """不得引入大型前端框架。"""
        js = (STATIC_DIR / "teacher-showcase.js").read_text(encoding="utf-8")
        for token in ("react", "vue", "angular", "jquery", "bootstrap", "import ", "require("):
            self.assertNotIn(token, js, token)


# ══ 6. 統計一致與回歸（驗收 9、10） ═════════════════════════════════════
class P8ConsistencyTests(P8Base):
    def test_showcase_matches_p5_and_p6_sources(self):
        self._set_slot(self.enrollment_a, "R01", SUBMITTED, days_ago=1)
        self._login_teacher()
        showcase = self.client.get(self.showcase_a).context["report"]
        report = self.client.get(self.report_a).context["report"]
        for key in ("student_count", "total_submitted", "total_reviewed", "pending_items_total"):
            self.assertEqual(showcase[key], report[key], key)

    def test_p1_to_p7_pages_still_render(self):
        self._login_teacher()
        for name in (
            "learning:teacher_dashboard",
            "learning:teacher_class_outcomes",
            "learning:teacher_class_report",
            "learning:teacher_cohort_review_checklist",
            "learning:teacher_cohort_export_summary",
            "learning:teacher_cohort_export_records",
            "learning:teacher_class_showcase",
        ):
            response = self.client.get(reverse(name))
            self.assertEqual(response.status_code, 200, name)

    def test_no_new_migration_added(self):
        from learning.tests.migration_assertions import assert_migration_chain

        assert_migration_chain(self)

    def test_certificate_wording_discipline_unchanged(self):
        self._login_teacher()
        body = self._body(self.client.get(self.showcase_a))
        self.assertIn("非民航局專業操作證", body)
        self.assertNotIn("民航局證照", body)
        self.assertNotIn("考照合格率", body)

    def test_showcase_still_not_cacheable(self):
        self._login_teacher()
        response = self.client.get(self.showcase_a)
        self.assertIn("no-store", response["Cache-Control"])
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")

    def test_anonymous_and_student_blocked(self):
        self.assertEqual(self.client.get(self.showcase_a).status_code, 302)
        self.client.force_login(self.student_a.user)
        self.assertEqual(self.client.get(self.showcase_a).status_code, 403)
