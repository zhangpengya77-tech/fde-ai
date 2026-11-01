"""P7 班級成果發表與教學展示中心驗收（2026-10-13 教師指令）。

對應教師指令第四節 11 項驗收：
  1. 班級統計與 P5／P6 一致（同一統計來源，不重算）。
  2. 五階段與 R01–R08 真實數據。
  3. 無資料空狀態。
  4. 教師跨班級權限隔離。
  5. 未登入與學員不可進入教師展示頁。
  6. 證據存取授權（沿用既有權限檢查，不產生公開網址）。
  7. 個資預設隱藏（匿名化展示）。
  8. 16:9 簡報播放（版面契約）。
  9. 上一頁、下一頁、Esc（前端行為契約）。
 10. 390×844 手機模擬（CSS 契約）。
 11. P1–P6 必要回歸（本檔驗證 P5／P6 統計來源未被破壞）。

另驗證：
  - 不建立第二套系統：展示頁統計一律取自 build_cohort_report()。
  - 「證」階段不得標示為民航局證照；「已提交」不得誤稱為「已通過」。
  - 不新增公開分享連結、不開放匿名觀看、不產生公開 /media/ 網址。
"""
import re
from datetime import timedelta
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
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
    SHOWCASE_SLIDE_IDS,
    build_cohort_report,
)

SUBMITTED = GrowthRecordSubmission.Status.SUBMITTED
NEEDS_REVISION = GrowthRecordSubmission.Status.NEEDS_REVISION
APPROVED = GrowthRecordSubmission.Status.APPROVED
SLOT_IDS = ["R%02d" % index for index in range(1, 9)]

STATIC_DIR = Path(__file__).resolve().parent.parent / "static" / "learning"
SHOWCASE_CSS = (STATIC_DIR / "teacher-showcase.css").read_text(encoding="utf-8")
SHOWCASE_JS = (STATIC_DIR / "teacher-showcase.js").read_text(encoding="utf-8")


class P7Base(TestCase):
    def setUp(self):
        self.cohort_a = Cohort.objects.create(cohort_id="P7-A-2026", name="P7 甲班")
        self.cohort_b = Cohort.objects.create(cohort_id="P7-B-2026", name="P7 乙班")
        self.cohort_other = Cohort.objects.create(cohort_id="P7-OTHER", name="未授權班")
        self.cohort_empty = Cohort.objects.create(cohort_id="P7-EMPTY", name="空班級")

        self.teacher = get_user_model().objects.create_user(
            username="p7-teacher",
            email="p7-teacher@example.test",
            password="Another-strong-passphrase-911!",
            is_staff=True,
        )
        for cohort in (self.cohort_a, self.cohort_b, self.cohort_empty):
            TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=cohort)

        self.student_a = create_student_account("p7-a@example.test", "學員甲")
        self.student_b = create_student_account("p7-b@example.test", "學員乙")
        self.enrollment_a = enroll_student(self.student_a, self.cohort_a)
        self.enrollment_b = enroll_student(self.student_b, self.cohort_a)

        self.student_c = create_student_account("p7-c@example.test", "學員丙")
        self.enrollment_c = enroll_student(self.student_c, self.cohort_b)

        self.outsider = create_student_account("p7-out@example.test", "他班學員")
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
        self.showcase_empty = reverse(
            "learning:teacher_class_showcase_cohort", args=[self.cohort_empty.cohort_id]
        )
        self.showcase_other = reverse(
            "learning:teacher_class_showcase_cohort", args=[self.cohort_other.cohort_id]
        )

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

    def _add_image_evidence(self, enrollment, slot_id, name="proof.png"):
        submission = next(
            row for row in ensure_growth_submissions(enrollment) if row.definition.slot_id == slot_id
        )
        evidence = Evidence.objects.create(
            growth_submission=submission,
            evidence_type=Evidence.Type.IMAGE,
            description="組裝完成照",
            upload=SimpleUploadedFile(name, b"\x89PNG\r\n\x1a\n", content_type="image/png"),
        )
        return evidence

    def _body(self, response):
        return response.content.decode("utf-8")


# ══ 1. 權限與隔離（驗收 4、5） ═══════════════════════════════════════════
class ShowcaseAccessTests(P7Base):
    def test_anonymous_is_redirected_to_teacher_login(self):
        response = self.client.get(self.showcase_url)
        self.assertEqual(response.status_code, 302)
        self.assertIn(reverse("learning:teacher_login"), response["Location"])

    def test_student_is_forbidden(self):
        self.client.force_login(self.student_a.user)
        response = self.client.get(self.showcase_url)
        self.assertEqual(response.status_code, 403)

    def test_cross_cohort_is_404(self):
        self._login_teacher()
        response = self.client.get(self.showcase_other)
        self.assertEqual(response.status_code, 404)

    def test_unauthorised_cohort_via_query_is_404(self):
        self._login_teacher()
        response = self.client.get(self.showcase_url, {"cohort": self.cohort_other.cohort_id})
        self.assertEqual(response.status_code, 404)

    def test_authorised_cohorts_are_listed_only(self):
        self._login_teacher()
        response = self.client.get(self.showcase_url)
        self.assertEqual(response.status_code, 200)
        ids = [item.cohort_id for item in response.context["cohorts"]]
        self.assertEqual(ids, ["P7-A-2026", "P7-B-2026", "P7-EMPTY"])
        self.assertNotIn(self.cohort_other.cohort_id, ids)

    def test_no_public_share_link_or_anonymous_view(self):
        """不得產生公開分享連結、不開放匿名觀看。"""
        self._login_teacher()
        body = self._body(self.client.get(self.showcase_a))
        self.assertNotIn("share", body.lower().replace("shared", ""))
        self.assertNotIn("/media/", body)
        # 未登入一律 302，不存在任何匿名可讀入口。
        self.client.logout()
        for url in (self.showcase_url, self.showcase_a):
            self.assertEqual(self.client.get(url).status_code, 302)

    def test_showcase_response_is_not_cacheable(self):
        """展示頁含個資與證據連結，一律禁止快取。"""
        self._login_teacher()
        response = self.client.get(self.showcase_a)
        self.assertIn("no-store", response["Cache-Control"])
        self.assertIn("private", response["Cache-Control"])
        self.assertEqual(response["Pragma"], "no-cache")
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")


# ══ 2. 統計一致性（驗收 1、2、11） ═══════════════════════════════════════
class ShowcaseConsistencyTests(P7Base):
    def test_statistics_match_build_cohort_report(self):
        """展示頁數字必須與 build_cohort_report 完全一致（不重算另一套）。"""
        self._submit_all_eight(self.enrollment_a)
        self._set_slot(self.enrollment_b, "R01", SUBMITTED, days_ago=2)
        self._set_slot(self.enrollment_b, "R02", NEEDS_REVISION, days_ago=2)
        self._login_teacher()

        response = self.client.get(self.showcase_a)
        report = response.context["report"]
        expected = build_cohort_report(self.cohort_a)

        for key in (
            "student_count",
            "total_submitted",
            "total_reviewed",
            "pending_items_total",
            "needs_revision_total",
            "not_submitted_count",
            "all_submitted_count",
            "pending_student_count",
            "reviewed_result_total",
        ):
            self.assertEqual(report[key], expected[key], key)
        self.assertEqual(
            [row["done"] for row in report["stage_rows"]],
            [row["done"] for row in expected["stage_rows"]],
        )
        self.assertEqual(
            [(slot["slot_id"], slot["submitted"], slot["reviewed"]) for slot in report["slot_stats"]],
            [
                (slot["slot_id"], slot["submitted"], slot["reviewed"])
                for slot in expected["slot_stats"]
            ],
        )

    def test_showcase_and_class_report_show_same_numbers(self):
        """展示頁與 P5 班級成果報告在同一班級上顯示相同數字。"""
        self._submit_all_eight(self.enrollment_a)
        self._login_teacher()
        showcase = self.client.get(self.showcase_a)
        report = self.client.get(
            reverse("learning:teacher_class_report_cohort", args=[self.cohort_a.cohort_id])
        )
        self.assertEqual(showcase.status_code, 200)
        self.assertEqual(report.status_code, 200)
        left = showcase.context["report"]
        right = report.context["report"]
        for key in ("student_count", "total_submitted", "total_reviewed", "pending_items_total"):
            self.assertEqual(left[key], right[key], key)

    def test_stage_rows_cover_five_stages(self):
        self._login_teacher()
        response = self.client.get(self.showcase_a)
        rows = response.context["report"]["stage_rows"]
        self.assertEqual(len(rows), 5)
        self.assertEqual([row["character"] for row in rows], ["學", "練", "做", "測", "證"])
        for row in rows:
            self.assertEqual(row["total"], 2)

    def test_slot_rows_cover_r01_to_r08(self):
        self._set_slot(self.enrollment_a, "R03", SUBMITTED, days_ago=1)
        self._login_teacher()
        response = self.client.get(self.showcase_a)
        slots = response.context["report"]["slot_stats"]
        self.assertEqual([slot["slot_id"] for slot in slots], SLOT_IDS)
        r03 = next(slot for slot in slots if slot["slot_id"] == "R03")
        self.assertEqual(r03["submitted"], 1)

    def test_real_task_submission_is_reflected(self):
        """任務提交（P2 鏈）也計入待複核，非只算成長紀錄。"""
        StudentTaskProgress.objects.create(
            enrollment=self.enrollment_a,
            task=self.task,
            status=StudentTaskProgress.Status.SUBMITTED,
            submitted_at=timezone.now(),
        )
        self._login_teacher()
        report = self.client.get(self.showcase_a).context["report"]
        self.assertEqual(report["pending_items_total"], 1)
        self.assertEqual(report["pending_student_count"], 1)

    def test_showcase_does_not_write_extra_records(self):
        """展示頁沿用既有冪等行為，不新增任何統計資料表或額外寫入。"""
        self._login_teacher()
        self.client.get(self.showcase_a)
        baseline = build_cohort_report(self.cohort_a)
        self.client.get(self.showcase_a)
        again = build_cohort_report(self.cohort_a)
        self.assertEqual(baseline["total_submitted"], again["total_submitted"])
        self.assertEqual(baseline["student_count"], again["student_count"])


# ══ 3. 內容與空狀態（驗收 2、3） ═════════════════════════════════════════
class ShowcaseContentTests(P7Base):
    def test_empty_cohort_shows_no_record_state(self):
        self._login_teacher()
        body = self._body(self.client.get(self.showcase_empty))
        self.assertIn("尚無紀錄", body)
        self.assertIn("學員總人數", body)

    def test_teacher_feedback_is_real_only(self):
        submission = self._set_slot(self.enrollment_a, "R01", SUBMITTED, days_ago=1)
        self._review(submission, APPROVED, note="接線整齊，散熱走線可再加強。", score=88)
        self._login_teacher()
        # P8-B：評語原文只在具名展示下輸出（匿名時評語可能含學員姓名）。
        self.client.post(self.showcase_a, {"action": "enable_identify"})
        response = self.client.get(self.showcase_a)
        notes = [row["note"] for row in response.context["report"]["feedback_rows"]]
        self.assertIn("接線整齊，散熱走線可再加強。", notes)
        body = self._body(response)
        self.assertIn("接線整齊，散熱走線可再加強。", body)

    def test_anonymous_mode_hides_feedback_body(self):
        """P8-B：匿名模式下不輸出評語內容（僅顯示統計筆數）。"""
        submission = self._set_slot(self.enrollment_a, "R01", SUBMITTED, days_ago=1)
        self._review(submission, APPROVED, note="接線整齊，散熱走線可再加強。", score=88)
        self._login_teacher()
        response = self.client.get(self.showcase_a)
        self.assertEqual(response.context["report"]["feedback_rows"], [])
        self.assertNotIn("接線整齊，散熱走線可再加強。", self._body(response))

    def test_no_fabricated_feedback_when_none_exists(self):
        self._login_teacher()
        # P8-B：匿名模式僅顯示統計；具名模式才顯示明細與空狀態。
        self.client.post(self.showcase_a, {"action": "enable_identify"})
        response = self.client.get(self.showcase_a)
        self.assertEqual(response.context["report"]["feedback_rows"], [])
        self.assertIn("尚無紀錄（目前尚無任何教師評語或回饋）", self._body(response))

    def test_certificate_stage_is_not_labelled_as_caa_licence(self):
        self._login_teacher()
        body = self._body(self.client.get(self.showcase_a))
        self.assertIn("非民航局專業操作證", body)
        self.assertNotIn("取得民航局", body)
        self.assertNotIn("民航局證照", body)

    def test_submitted_is_not_called_passed(self):
        self._submit_all_eight(self.enrollment_a)
        self._login_teacher()
        body = self._body(self.client.get(self.showcase_a))
        self.assertIn("已提交", body)
        self.assertNotIn("結訓通過名單", body)
        self.assertNotIn("已合格", body)

    def test_dashboard_has_p7_entry(self):
        self._login_teacher()
        body = self._body(self.client.get(reverse("learning:teacher_dashboard")))
        self.assertIn("班級成果展示中心", body)
        self.assertIn(self.showcase_url, body)


# ══ 4. 隱私與證據授權（驗收 6、7） ═══════════════════════════════════════
class ShowcasePrivacyTests(P7Base):
    def test_default_is_anonymous(self):
        """預設匿名化：不顯示學員暱稱。"""
        self._submit_all_eight(self.enrollment_a)
        self._login_teacher()
        response = self.client.get(self.showcase_a)
        self.assertFalse(response.context["identify"])
        body = self._body(response)
        self.assertNotIn("學員甲", body)
        self.assertNotIn("學員乙", body)
        self.assertIn("學員 01", body)
        self.assertIn("匿名化展示（預設）", body)

    def test_anonymous_mode_does_not_load_evidence_images(self):
        self._add_image_evidence(self.enrollment_a, "R01")
        self._login_teacher()
        response = self.client.get(self.showcase_a)
        rows = response.context["showcase_rows"]
        self.assertTrue(all(row["evidence_rows"] == [] for row in rows))
        body = self._body(response)
        self.assertNotIn("/download/", body)

    def test_named_mode_requires_explicit_teacher_consent(self):
        """具名展示必須由教師顯式聲明；未聲明前不顯示暱稱。"""
        self._add_image_evidence(self.enrollment_a, "R01")
        self._login_teacher()
        # 先確認預設匿名
        self.assertNotIn("學員甲", self._body(self.client.get(self.showcase_a)))

        # 教師顯式開啟具名展示
        response = self.client.post(self.showcase_a, {"action": "enable_identify"})
        self.assertEqual(response.status_code, 302)
        self.assertTrue(self.client.session[SHOWCASE_CONSENT_SESSION_KEY])

        body = self._body(self.client.get(self.showcase_a))
        self.assertIn("學員甲", body)
        self.assertIn("具名展示（教師確認已取得必要授權）", body)
        # 具名模式才載入既有授權證據端點（非 /media/ 直連）
        self.assertIn("/download/?inline=1", body)
        self.assertNotIn("/media/", body)

    def test_teacher_can_return_to_anonymous_mode(self):
        self._login_teacher()
        self.client.post(self.showcase_a, {"action": "enable_identify"})
        self.client.post(self.showcase_a, {"action": "disable_identify"})
        self.assertNotIn(SHOWCASE_CONSENT_SESSION_KEY, self.client.session)
        self.assertNotIn("學員甲", self._body(self.client.get(self.showcase_a)))

    def test_post_redirects_to_same_path_only(self):
        """避免開放式重導。"""
        self._login_teacher()
        response = self.client.post(
            self.showcase_a, {"action": "enable_identify", "next": "https://evil.example/"}
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], self.showcase_a)

    def test_evidence_download_still_authorised(self):
        """證據存取沿用既有權限檢查：授權教師可讀、未登入與他班教師不可讀。"""
        evidence = self._add_image_evidence(self.enrollment_a, "R01")
        url = reverse("learning:evidence_download", args=[evidence.pk])
        self.assertEqual(self.client.get(url).status_code, 302)  # 未登入

        self.client.force_login(self.student_a.user)
        self.assertEqual(self.client.get(url).status_code, 200)  # 擁有者
        self.client.logout()

        self._login_teacher()
        self.assertEqual(self.client.get(url).status_code, 200)  # 授權教師
        self.client.logout()

        other_teacher = get_user_model().objects.create_user(
            username="p7-teacher-other",
            email="p7-teacher-other@example.test",
            password="Another-strong-passphrase-912!",
            is_staff=True,
        )
        TeacherCohortAccess.objects.create(teacher=other_teacher, cohort=self.cohort_other)
        self.client.force_login(other_teacher)
        self.assertEqual(self.client.get(url).status_code, 404)  # 非授權教師

    def test_anonymous_mode_hides_external_urls(self):
        """匿名化時不輸出任何證據列（含外部連結）。"""
        submission = next(
            row
            for row in ensure_growth_submissions(self.enrollment_a)
            if row.definition.slot_id == "R02"
        )
        Evidence.objects.create(
            growth_submission=submission,
            evidence_type=Evidence.Type.OTHER,
            external_url="https://example.test/report",
            description="外部成果連結",
        )
        self._login_teacher()
        body = self._body(self.client.get(self.showcase_a))
        self.assertNotIn("https://example.test/report", body)


# ══ 5. 簡報播放模式（驗收 8、9、10） ═════════════════════════════════════
class ShowcasePresentationTests(P7Base):
    def test_seven_slides_in_required_order(self):
        self._login_teacher()
        body = self._body(self.client.get(self.showcase_a))
        positions = [body.index('data-slide="%s"' % slide) for slide in SHOWCASE_SLIDE_IDS]
        self.assertEqual(positions, sorted(positions))
        self.assertEqual(
            list(SHOWCASE_SLIDE_IDS),
            ["cover", "outcomes", "stages", "slots", "works", "feedback", "closing"],
        )
        self.assertEqual(len(SHOWCASE_SLIDE_IDS), 7)

    def test_presentation_controls_present(self):
        self._login_teacher()
        body = self._body(self.client.get(self.showcase_a))
        for token in ("showcase-start", "sc-prev", "sc-next", "sc-exit", "sc-current"):
            self.assertIn(token, body)

    def test_slide_count_is_seven_in_page(self):
        self._login_teacher()
        body = self._body(self.client.get(self.showcase_a))
        self.assertEqual(body.count('class="sc-slide'), 7)

    def test_css_supports_16_9_projection(self):
        """16:9 投影：以 min(100vw, 100vh*16/9) letterbox 舞台呈現。"""
        self.assertIn("16 / 9", SHOWCASE_CSS)
        self.assertIn("body.sc-presenting", SHOWCASE_CSS)
        self.assertIn("sc-presenting", SHOWCASE_CSS)

    def test_css_supports_mobile_390(self):
        """390×844 手機：單欄、表格轉卡片、44px 觸控目標、不強制 16:9。"""
        self.assertIn("@media (max-width:680px)", SHOWCASE_CSS)
        self.assertIn("min-height:44px", SHOWCASE_CSS)
        self.assertIn("td::before{content:attr(data-label)", SHOWCASE_CSS.replace(" ", ""))
        mobile_block = SHOWCASE_CSS.split("@media (max-width:680px)")[1]
        self.assertIn("100vw", mobile_block)

    def test_js_supports_arrow_keys_and_escape(self):
        """鍵盤：←／→／PageUp／PageDown／Home／End／Esc。"""
        for key in ("ArrowRight", "ArrowLeft", "PageUp", "PageDown", "Home", "End", "Escape"):
            self.assertIn(key, SHOWCASE_JS, key)
        self.assertIn("requestFullscreen", SHOWCASE_JS)
        self.assertIn("exitFullscreen", SHOWCASE_JS)

    def test_js_has_no_third_party_media_pipeline(self):
        """本輪不開發 PPTX 自動生成、影片剪輯或 AI 自動撰寫成果：
        前端為零依賴 vanilla JS，不含任何打包／轉檔／剪輯模組。"""
        for token in ("import ", "require(", "jszip", "ffmpeg", "PptxGenJS", "MediaRecorder"):
            self.assertNotIn(token, SHOWCASE_JS, token)

    def test_works_slide_renders_student_cards(self):
        self._submit_all_eight(self.enrollment_a)
        self._login_teacher()
        body = self._body(self.client.get(self.showcase_a))
        self.assertIn("學員作品與成果證據", body)
        self.assertIn("學員 01", body)

    def test_print_styles_hide_controls(self):
        self.assertIn("@media print", SHOWCASE_CSS)
        print_block = SHOWCASE_CSS.split("@media print")[-1]
        self.assertIn(".sc-controls", print_block)
        self.assertIn("display:none", print_block)


# ══ 6. 迴歸：P5／P6 統計來源未被破壞（驗收 11） ══════════════════════════
class ShowcaseRegressionTests(P7Base):
    def test_p5_class_report_still_renders(self):
        self._login_teacher()
        response = self.client.get(reverse("learning:teacher_class_report"))
        self.assertEqual(response.status_code, 200)

    def test_p6_checklist_still_renders(self):
        self._login_teacher()
        response = self.client.get(reverse("learning:teacher_cohort_review_checklist"))
        self.assertEqual(response.status_code, 200)

    def test_p6_csv_exports_still_render(self):
        self._login_teacher()
        for name in ("learning:teacher_cohort_export_summary", "learning:teacher_cohort_export_records"):
            response = self.client.get(reverse(name))
            self.assertEqual(response.status_code, 200, name)
            self.assertTrue(response.content.startswith("\ufeff".encode("utf-8")), name)

    def test_build_cohort_report_signature_unchanged(self):
        """build_cohort_report 仍為 P5／P6／P7 共用單一來源，鍵集合未變。"""
        report = build_cohort_report(self.cohort_a)
        for key in (
            "cohort",
            "student_count",
            "generated_at",
            "slot_stats",
            "stage_rows",
            "student_rows",
            "feedback_rows",
            "pending_work_items",
            "unsubmitted_items",
            "review_result_rows",
            "reviewed_result_total",
            "outstanding_total",
        ):
            self.assertIn(key, report, key)

    def test_no_new_migration_added(self):
        from learning.tests.migration_assertions import assert_migration_chain

        assert_migration_chain(self)
