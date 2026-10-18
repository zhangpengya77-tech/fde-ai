"""教師 Vision Model Center 頁面驗收測試（PROP_DIRECTION_V1）。

本檔為 2026-10-08「教師後台驗收與模型倉庫持久化」指令的驗收測試，
優先使用 Django 測試用戶端與模板斷言，**不啟動 8023、不啟動 8030**。

驗收範圍：
A. 教師模型清單
B. 模型詳情
C. Candidate / Return
D. 圖片驗證頁
E. 資料飛輪倉庫入口
F. 無 Runner 時的安全停用狀態

注意：本檔只驗收「頁面與安全狀態」，不驗收任何推論行為（推論尚未實作）。
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from unittest.mock import patch

from learning.growth_records import ensure_growth_submissions
from learning.models import Cohort, Evidence, TeacherCohortAccess
from learning.tests.helpers import create_student_account, enroll_student


class TeacherVisionBackendAcceptanceTests(TestCase):
    """教師後台頁面驗收：確認現有頁面可開啟、內容正確、安全狀態明確。"""

    def setUp(self):
        self.api_health = patch(
            "learning.views.vision_api.vision_api_health", return_value=(True, "ok")
        )
        self.api_models = patch("learning.views.vision_api.list_models", return_value=[])
        self.api_health.start()
        self.api_models.start()
        self.addCleanup(self.api_health.stop)
        self.addCleanup(self.api_models.stop)
        self.cohort = Cohort.objects.create(cohort_id="AC-A", name="驗收班 A")
        self.other_cohort = Cohort.objects.create(cohort_id="AC-B", name="驗收班 B")
        self.student = create_student_account("ac-a@example.test", "驗收學員 A")
        self.other_student = create_student_account("ac-b@example.test", "驗收學員 B")
        self.enrollment = enroll_student(self.student, self.cohort)
        self.other_enrollment = enroll_student(self.other_student, self.other_cohort)
        self.evidence = self._model_evidence(self.enrollment, "accept-a.pt")
        self.other_evidence = self._model_evidence(self.other_enrollment, "accept-b.pt")
        self.teacher = get_user_model().objects.create_user(
            username="ac-teacher@example.test", password="Teacher-pass-902!", is_staff=True
        )
        TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=self.cohort)
        self.client.force_login(self.teacher)

    @staticmethod
    def _model_evidence(enrollment, filename, task_type="PROP_DIRECTION"):
        submission = next(
            item for item in ensure_growth_submissions(enrollment)
            if item.definition.slot_id == "R07"
        )
        return Evidence.objects.create(
            growth_submission=submission,
            evidence_type=Evidence.Type.MODEL,
            original_metadata={
                "filename": filename,
                "size_bytes": 4096,
                "task_type": task_type,
                "evidence_type": "YOLO_MODEL",
            },
            processed_metadata={"submission_status": "SUBMITTED"},
        )

    # ---------- A. 教師模型清單 ----------

    def test_a_model_list_opens_and_renders_required_columns(self):
        """A1：教師模型清單可開啟，且具備必要欄位。"""
        response = self.client.get(reverse("learning:teacher_vision_model_list"))

        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, "learning/teacher_vision_model_list.html")
        for heading in ("班級／期別", "組別", "學員", "模型任務", "檔案／時間", "審核狀態", "操作"):
            self.assertContains(response, heading)
        self.assertContains(response, "accept-a.pt")

    def test_a_model_list_shows_unimplemented_features_as_not_enabled(self):
        """A2：四步驟必須同頁呈現，安全限制不得被隱藏。"""
        response = self.client.get(reverse("learning:teacher_vision_model_list"))

        for heading in (
            "01｜學員模型提交",
            "02｜教師圖片驗證",
            "03｜確認並啟用網站模型",
            "04｜下一期教學模型資源庫",
        ):
            self.assertContains(response, heading)
        self.assertContains(response, "只有安全 Runner、真實模型與既有驗證門檻都就緒時")
        self.assertContains(response, "目前沒有符合既有安全規則且可啟用的已驗證模型")

    def test_a_model_list_hides_other_cohort_models(self):
        """A3：清單不得顯示未授權班級的模型。"""
        response = self.client.get(reverse("learning:teacher_vision_model_list"))

        self.assertContains(response, "accept-a.pt")
        self.assertNotContains(response, "accept-b.pt")

    def test_a_teacher_without_cohort_access_sees_empty_list(self):
        """A4：無任何班級授權的教師取得空清單，不得看到他人模型。"""
        outsider = get_user_model().objects.create_user(
            username="ac-outsider@example.test", password="Teacher-pass-902!", is_staff=True
        )
        self.client.force_login(outsider)

        response = self.client.get(reverse("learning:teacher_vision_model_list"))

        self.assertEqual(response.status_code, 200)
        self.assertNotContains(response, "accept-a.pt")
        self.assertNotContains(response, "accept-b.pt")

    # ---------- B. 模型詳情 ----------

    def test_b_model_detail_opens_with_version_and_provenance(self):
        """B1：詳情頁可開啟，且呈現模型版本與來源資訊。"""
        response = self.client.get(
            reverse("learning:teacher_vision_model_detail", args=[self.evidence.pk])
        )

        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, "learning/teacher_vision_model_detail.html")
        self.assertContains(response, "模型版本與來源")
        self.assertContains(response, "審核狀態")
        self.assertContains(response, "驗證狀態")
        self.assertContains(response, "訓練用途")
        self.assertContains(response, "部署狀態")

    def test_b_model_detail_shows_blocked_reason_for_active(self):
        """B2：詳情頁必須說明為何不可啟用 ACTIVE。"""
        response = self.client.get(
            reverse("learning:teacher_vision_model_detail", args=[self.evidence.pk])
        )

        self.assertContains(response, "未通過 Golden Test 驗證，不可啟用 ACTIVE。")

    def test_b_model_detail_shows_favorite_button_disabled(self):
        """B3：未列為候選時，收藏按鈕必須為停用狀態並說明原因。

        註：本輪已實作收藏功能，故按鈕文字由「尚未啟用」改為「尚不可用」，
        並附上阻擋原因（需先列為候選）。
        """
        response = self.client.get(
            reverse("learning:teacher_vision_model_detail", args=[self.evidence.pk])
        )

        self.assertContains(response, "收藏（尚不可用）")
        self.assertContains(response, "需先由教師列為候選，才可收藏至模型倉庫。")
        self.assertContains(response, 'disabled')

    def test_b_other_cohort_model_detail_is_not_found(self):
        """B4：未授權班級的模型詳情回 404，不得洩漏存在性。"""
        response = self.client.get(
            reverse("learning:teacher_vision_model_detail", args=[self.other_evidence.pk])
        )

        self.assertEqual(response.status_code, 404)

    # ---------- C. Candidate / Return ----------

    def _review_payload(self, action, note):
        """既有審核契約要求同時帶入固定規則模板 ID，缺少即 400。"""
        return {
            "action": action,
            "note": note,
            "rule_template_id": "PROP_DIRECTION_V1",
        }

    def test_c_candidate_action_is_available(self):
        """C1：教師可將模型列為候選（沿用既有流程）。"""
        response = self.client.post(
            reverse("learning:teacher_vision_model_review", args=[self.evidence.pk]),
            self._review_payload("candidate", "槳葉方向分類正確。"),
        )

        self.assertEqual(response.status_code, 302)
        self.evidence.refresh_from_db()
        review = self.evidence.processed_metadata.get("vision_model_review", {})
        self.assertEqual(review.get("status"), "CANDIDATE")
        self.assertEqual(review.get("rule_template_id"), "PROP_DIRECTION_V1")

    def test_c_return_action_is_available(self):
        """C2：教師可退回補件（沿用既有流程）。"""
        response = self.client.post(
            reverse("learning:teacher_vision_model_review", args=[self.evidence.pk]),
            self._review_payload("return", "請補上 data.yaml。"),
        )

        self.assertEqual(response.status_code, 302)
        self.evidence.refresh_from_db()
        review = self.evidence.processed_metadata.get("vision_model_review", {})
        self.assertEqual(review.get("status"), "RETURNED")

    def test_c_review_without_rule_template_is_rejected(self):
        """C2b：未帶固定規則模板 ID 的審核必須被拒（既有契約不變）。"""
        response = self.client.post(
            reverse("learning:teacher_vision_model_review", args=[self.evidence.pk]),
            {"action": "candidate", "note": "缺模板。"},
        )

        self.assertEqual(response.status_code, 400)
        self.evidence.refresh_from_db()
        review = self.evidence.processed_metadata.get("vision_model_review", {})
        self.assertNotEqual(review.get("status"), "CANDIDATE")

    def test_c_review_never_calls_activation_or_inference(self):
        """C3：審核動作不得產生 ACTIVE、驗證結果或推論紀錄。"""
        self.client.post(
            reverse("learning:teacher_vision_model_review", args=[self.evidence.pk]),
            self._review_payload("candidate", "列為候選。"),
        )

        self.evidence.refresh_from_db()
        processed = self.evidence.processed_metadata
        self.assertNotIn("golden_test_result", processed)
        self.assertNotIn("validation_status", processed)
        self.assertNotEqual(processed.get("deployment_status"), "ACTIVE")
        self.assertNotIn("vision_test_records", processed)

    def test_c_student_cannot_reach_review_route(self):
        """C4：學員不得呼叫教師審核路由。"""
        self.client.force_login(self.student.user)

        response = self.client.post(
            reverse("learning:teacher_vision_model_review", args=[self.evidence.pk]),
            self._review_payload("candidate", "偽造審核。"),
        )

        self.assertIn(response.status_code, (302, 403))
        self.evidence.refresh_from_db()
        review = self.evidence.processed_metadata.get("vision_model_review", {})
        self.assertNotEqual(review.get("status"), "CANDIDATE")

    # ---------- D. 圖片驗證頁 ----------

    def test_d_verification_page_opens_for_authorized_teacher(self):
        """D1：圖片驗證頁可開啟。"""
        response = self.client.get(
            reverse("learning:teacher_vision_model_verify", args=[self.evidence.pk])
        )

        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, "learning/teacher_vision_verify.html")

    def test_d_verification_page_has_all_required_sections(self):
        """D2：驗證頁必須具備模型資訊、上傳區、BBOX、判定、歷史五個區塊。"""
        response = self.client.get(
            reverse("learning:teacher_vision_model_verify", args=[self.evidence.pk])
        )

        for section in ("模型資訊", "圖片上傳區", "BBOX", "Class ID", "Confidence", "PASS", "測試歷史"):
            self.assertContains(response, section)

    # ---------- D2. 圖片測試（門檻／防偽造） ----------

    def test_d_verification_declares_no_fake_result_and_disables_button(self):
        """D2b：無安全 Runner 與合格模型時，必須停用並宣告不產生模擬結果。"""
        response = self.client.get(
            reverse("learning:teacher_vision_model_verify", args=[self.evidence.pk])
        )

        self.assertContains(response, "本頁不會載入學員 .pt，也不會產生任何模擬辨識結果")
        self.assertContains(response, "disabled aria-disabled")

    def test_d_verification_gate_is_blocked_or_waiting_when_unavailable(self):
        """D2c：沒有隔離環境或沒有合格模型時，只允許 BLOCKED／WAITING_FOR_MODEL。"""
        from learning.vision_verification import runner_state
        from learning import prop_scan

        response = self.client.get(
            reverse("learning:teacher_vision_model_verify", args=[self.evidence.pk])
        )
        html = response.content.decode("utf-8")

        if not runner_state().get("available"):
            self.assertIn("BLOCKED", html)
        else:
            self.assertIn("WAITING_FOR_MODEL", html)
        self.assertEqual(prop_scan.model_status()["status"], "WAITING_FOR_MODEL")

    def test_d_other_cohort_verification_page_is_not_found(self):
        """D3：未授權班級的驗證頁回 404。"""
        response = self.client.get(
            reverse("learning:teacher_vision_model_verify", args=[self.other_evidence.pk])
        )

        self.assertEqual(response.status_code, 404)

    # ---------- E. 資料飛輪倉庫入口 ----------

    def test_e_teacher_dashboard_has_flywheel_entry(self):
        """E1：教師後台必須有資料飛輪倉庫入口，且連結正確。"""
        response = self.client.get(reverse("learning:teacher_dashboard"))

        self.assertContains(response, "資料飛輪倉庫")
        self.assertContains(response, reverse("learning:teacher_vision_flywheel"))

    def test_e_flywheel_page_opens_with_field_specification(self):
        """E2：飛輪倉庫頁可開啟，且列出欄位規格。"""
        response = self.client.get(reverse("learning:teacher_vision_flywheel"))

        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, "learning/teacher_vision_flywheel.html")
        for column in ("模型", "班級", "版本", "父版本", "任務", "審核", "驗證", "訓練用途", "部署", "發布範圍"):
            self.assertContains(response, column)

    def test_e_flywheel_lists_all_reserved_fields(self):
        """E3：飛輪倉庫必須列出全部 16 個預留欄位（依 33.1 規格以中文分組呈現）。"""
        response = self.client.get(reverse("learning:teacher_vision_flywheel"))

        for field in (
            "Model ID", "Task ID", "Student / Cohort",
            "Model Version", "Parent Model ID", "Dataset Version",
            "Class Mapping", "best.pt", "data.yaml",
            "Teacher Review", "Validation History", "Golden Test Result",
            "Publication Scope", "Created", "Updated",
        ):
            self.assertContains(response, field)

    def test_e_flywheel_page_does_not_publish_student_resources(self):
        """E4：飛輪倉庫頁不得發布任何學生資源或下載連結。"""
        response = self.client.get(reverse("learning:teacher_vision_flywheel"))

        self.assertContains(response, "尚未啟用的功能")
        self.assertNotContains(response, reverse("learning:evidence_download", args=[self.evidence.pk]))

    # ---------- F. 無 Runner 時的安全停用狀態 ----------

    @patch(
        "learning.views.runner_state",
        return_value={
            "available": False,
            "reason": "Live Backend 推論服務目前無法連線",
            "required_for_enable": "請確認 Live Backend（DEMO :8111）已啟動",
        },
    )
    def test_f_runner_reports_unavailable_when_backend_is_offline(self, _runner_state):
        """F1：Live Backend 離線時必須回報 BLOCKED 與恢復條件。"""
        response = self.client.get(
            reverse("learning:teacher_vision_model_verify", args=[self.evidence.pk])
        )

        self.assertContains(response, "目前無法執行推論")
        self.assertContains(response, "Live Backend 推論服務目前無法連線")
        self.assertContains(response, "請確認 Live Backend（DEMO :8111）已啟動")

    def test_f_verification_form_is_disabled(self):
        """F2：上傳與測試按鈕必須停用。"""
        response = self.client.get(
            reverse("learning:teacher_vision_model_verify", args=[self.evidence.pk])
        )

        self.assertContains(response, "disabled")
        self.assertContains(response, 'aria-disabled="true"')

    def test_f_page_declares_no_inference_will_happen(self):
        """F3：頁面必須明示不會載入 .pt、不會產生模擬結果。"""
        response = self.client.get(
            reverse("learning:teacher_vision_model_verify", args=[self.evidence.pk])
        )

        self.assertContains(response, "本頁不會載入學員 .pt，也不會產生任何模擬辨識結果。")

    def test_f_run_endpoint_refuses_and_writes_nothing(self):
        """F4：驗證執行端點必須拒絕，且不得寫入任何測試紀錄。"""
        response = self.client.post(
            reverse("learning:teacher_vision_model_verify_run", args=[self.evidence.pk])
        )

        self.assertEqual(response.status_code, 302)
        self.evidence.refresh_from_db()
        self.assertNotIn("vision_test_records", self.evidence.processed_metadata)
        self.assertNotIn("golden_test_result", self.evidence.processed_metadata)

    def test_f_run_endpoint_refuses_even_for_candidate_model(self):
        """F5：即使已列為候選，無 Runner 時仍必須拒絕執行。"""
        self.client.post(
            reverse("learning:teacher_vision_model_review", args=[self.evidence.pk]),
            {"action": "candidate", "note": "列為候選。"},
        )

        response = self.client.post(
            reverse("learning:teacher_vision_model_verify_run", args=[self.evidence.pk])
        )

        self.assertEqual(response.status_code, 302)
        self.evidence.refresh_from_db()
        self.assertNotIn("vision_test_records", self.evidence.processed_metadata)

    # ---------- 迴歸：學員端不受影響 ----------

    def test_regression_student_r07_page_still_opens(self):
        """R1：學員 R07 成長紀錄頁不受教師後台改動影響。"""
        self.client.force_login(self.student.user)

        response = self.client.get(
            reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R07"])
        )

        self.assertEqual(response.status_code, 200)

    def test_regression_student_cannot_open_teacher_pages(self):
        """R2：學員存取任何教師 Vision 頁面皆須被拒。"""
        self.client.force_login(self.student.user)

        for name in ("teacher_vision_model_list", "teacher_vision_flywheel"):
            response = self.client.get(reverse(f"learning:{name}"))
            self.assertIn(response.status_code, (302, 403))
