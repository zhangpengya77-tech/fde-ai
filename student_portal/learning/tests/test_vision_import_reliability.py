"""D1 / D2 / D4 定向測試（Django 端，2026-10-19）。

驗證教師導入流程的補償與失敗原因顯示：
- D1：匯入失敗後把剛建立的資料集標記隔離，不刪除、不進清單；
- D2：預檢／匯入失敗寫入 import_last_error，且教師看到的是中文說明；
- D4：隔離模型無法啟用，ACTIVE 不變。

全程 mock Live API，不接觸真實服務與正式資料。
"""

from unittest.mock import patch

from django.contrib import messages as django_messages
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse

from learning import views
from learning.models import Cohort, TeacherCohortAccess
from learning.tests.helpers import create_student_account, enroll_student


def _texts(response):
    return [str(item) for item in django_messages.get_messages(response.wsgi_request)]


class VisionImportReliabilityTests(TestCase):
    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="P1-A", name="導入可靠度班 A")
        self.student = create_student_account("p1-a@example.test", "學員 A")
        self.enrollment = enroll_student(self.student, self.cohort)
        self.teacher = get_user_model().objects.create_user(
            username="p1-teacher@example.test", password="Teacher-pass-901!", is_staff=True
        )
        TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=self.cohort)
        self.client.force_login(self.teacher)
        self.submission_id = "sub-00000000-0000-0000-0000-000000000001"

    def _post_import(self):
        return self.client.post(
            reverse("learning:teacher_vision_center_import"),
            {"submission_id": self.submission_id, "task_id": "PROP_DIRECTION"},
        )

    # ---- D1 + D2：匯入失敗 ----
    @patch.object(views.vision_api, "record_import_failure")
    @patch.object(views.vision_api, "quarantine_dataset")
    @patch.object(views.vision_api, "import_submission")
    @patch.object(views.vision_api, "create_dataset")
    @patch.object(views.vision_api, "preflight_import")
    def test_import_failure_quarantines_dataset_and_records_reason(
        self, preflight, create_dataset, import_submission, quarantine_dataset, record_failure,
    ):
        preflight.return_value = {"outcome": "ready", "class_names_actual": [], "class_names_expected": []}
        create_dataset.return_value = {"dataset_id": "dataset-p1-1", "dataset_version": "v1"}
        import_submission.side_effect = RuntimeError(
            "vision_api_rejected:422:import_failed:dataset_binding_mismatch"
        )

        response = self._post_import()

        self.assertEqual(response.status_code, 302)
        self.assertIn("scene=1", response["Location"])
        # D1：本次建立的資料集被隔離，且帶上來源提交
        quarantine_dataset.assert_called_once()
        kwargs = quarantine_dataset.call_args.kwargs
        self.assertEqual(kwargs["dataset_id"], "dataset-p1-1")
        self.assertEqual(kwargs["source_submission_id"], self.submission_id)
        self.assertIn("import_failed", kwargs["reason"])
        # D2：失敗原因寫回，且為中文說明（不含原始例外字串）
        record_failure.assert_called_once()
        recorded = record_failure.call_args.kwargs
        self.assertEqual(recorded["submission_id"], self.submission_id)
        self.assertEqual(recorded["code"], "dataset_binding_mismatch")
        self.assertNotIn("vision_api_rejected", recorded["message"])
        self.assertNotIn("http", recorded["message"].lower())
        # 提交維持待複核，未進入步驟②（未標記成功導入）
        joined = " ".join(_texts(response))
        self.assertIn("待複核", joined)
        self.assertIn("已標記隔離", joined)

    @patch.object(views.vision_api, "record_import_failure")
    @patch.object(views.vision_api, "quarantine_dataset")
    @patch.object(views.vision_api, "import_submission")
    @patch.object(views.vision_api, "create_dataset")
    @patch.object(views.vision_api, "preflight_import")
    def test_import_failure_reports_when_quarantine_could_not_be_applied(
        self, preflight, create_dataset, import_submission, quarantine_dataset, record_failure,
    ):
        preflight.return_value = {"outcome": "ready"}
        create_dataset.return_value = {"dataset_id": "dataset-p1-2", "dataset_version": "v1"}
        import_submission.side_effect = RuntimeError("vision_api_unavailable")
        quarantine_dataset.side_effect = RuntimeError("vision_api_unavailable")

        response = self._post_import()

        self.assertEqual(response.status_code, 302)
        joined = " ".join(_texts(response))
        self.assertIn("未能標記隔離", joined)
        self.assertIn("無法連線到推論服務", joined)

    # ---- D2：預檢失敗 ----
    @patch.object(views.vision_api, "record_import_failure")
    @patch.object(views.vision_api, "quarantine_dataset")
    @patch.object(views.vision_api, "create_dataset")
    @patch.object(views.vision_api, "preflight_import")
    def test_preflight_mismatch_creates_no_dataset_and_shows_reason(
        self, preflight, create_dataset, quarantine_dataset, record_failure,
    ):
        preflight.return_value = {
            "outcome": "mismatch", "class_names_actual": ["A", "B"], "class_names_expected": ["X", "Y", "Z", "W"],
        }

        response = self._post_import()

        self.assertEqual(response.status_code, 302)
        # 預檢失敗不得建立任何資料集
        create_dataset.assert_not_called()
        quarantine_dataset.assert_not_called()
        record_failure.assert_called_once()
        recorded = record_failure.call_args.kwargs
        self.assertEqual(recorded["code"], "model_class_names_mismatch")
        self.assertIn("類別數量", recorded["message"])
        joined = " ".join(_texts(response))
        self.assertIn("類別數量", joined)
        self.assertIn("待複核", joined)

    @patch.object(views.vision_api, "record_import_failure")
    @patch.object(views.vision_api, "create_dataset")
    @patch.object(views.vision_api, "preflight_import")
    def test_preflight_exception_creates_no_dataset_and_records_reason(
        self, preflight, create_dataset, record_failure,
    ):
        preflight.side_effect = RuntimeError("vision_api_unavailable")

        response = self._post_import()

        self.assertEqual(response.status_code, 302)
        create_dataset.assert_not_called()
        record_failure.assert_called_once()
        recorded = record_failure.call_args.kwargs
        self.assertEqual(recorded["code"], "vision_api_unavailable")
        self.assertIn("無法連線到推論服務", recorded["message"])
        self.assertNotIn("vision_api_unavailable", " ".join(_texts(response)))

    # ---- 成功導入 ----
    @patch.object(views.vision_api, "record_import_failure")
    @patch.object(views.vision_api, "quarantine_dataset")
    @patch.object(views.vision_api, "import_submission")
    @patch.object(views.vision_api, "create_dataset")
    @patch.object(views.vision_api, "preflight_import")
    def test_successful_import_keeps_dataset_and_clears_error_path(
        self, preflight, create_dataset, import_submission, quarantine_dataset, record_failure,
    ):
        preflight.return_value = {"outcome": "ready"}
        create_dataset.return_value = {"dataset_id": "dataset-p1-ok", "dataset_version": "v1"}
        import_submission.return_value = {"model_id": "PROP_TEST_OK"}

        response = self._post_import()

        self.assertEqual(response.status_code, 302)
        self.assertIn("scene=2", response["Location"])
        self.assertIn("model=PROP_TEST_OK", response["Location"])
        # 成功時不得隔離資料集、不得寫入失敗原因（Live 端負責清除舊錯誤）
        quarantine_dataset.assert_not_called()
        record_failure.assert_not_called()
        self.assertEqual(import_submission.call_args.kwargs["dataset_id"], "dataset-p1-ok")

    # ---- D4：隔離模型不得啟用 ----
    @patch.object(views.vision_api, "activate_model")
    def test_quarantined_model_activation_is_refused(self, activate_model):
        activate_model.side_effect = RuntimeError(
            "vision_api_rejected:422:activation_failed:model_quarantined"
        )

        response = self.client.post(
            reverse("learning:teacher_vision_center_activate"),
            {"model_id": "PROP_20261010_X_accv1", "task_id": "PROP_DIRECTION"},
        )

        self.assertEqual(response.status_code, 302)
        self.assertIn("scene=3", response["Location"])
        joined = " ".join(_texts(response))
        self.assertIn("此模型已隔離，無法啟用。", joined)
        self.assertIn("原本的正式模型未變更", joined)
        self.assertNotIn("vision_api_rejected", joined)
