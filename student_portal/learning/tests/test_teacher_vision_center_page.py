"""AI 視覺模型中心（2026-10-10 指令 P）的 Django 端測試。

重點在驗證 Django 層的**行為契約**，而非推論本身：
1. 未登入 / 非教師一律被擋。
2. Live Backend 不可用時，頁面明確顯示停用，按鈕不開放，且不偽造任何結果。
3. 驗證動作把圖片轉發到 Live Backend，並如實呈現偵測結果與判定。
4. 啟用 / 回復失敗時，明確告知「原本的正式模型未變更」。
5. 四個步驟（單頁垂直）與兩個任務都可正常渲染，舊的「區域一~四」主入口與橫向分頁已移除。

真實 ultralytics 推論由 Live Backend 端的測試與驗收腳本負責；
本檔一律以 mock 替代跨進程呼叫，確保測試不依賴外部服務。
"""

import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse


# ---------------------------------------------------------------------------
# 2026-10-28（上線收尾第四階段 C）：資源級班級隔離的測試替身
#
# teacher_required 現在會在請求帶 submission_id / model_id 時，向 Live 查該資源
# 的來源學員，並比對「教師被授權班級」。本模組測的是頁面渲染與流程契約，不該
# 依賴真實跨進程查詢，因此把兩個查詢函式換成可控 stub：
#   * 預設 stub 回報「資源存在且屬於可見學員」，讓既有流程測試維持原意。
#   * 「異班必須 403、無班級必須 403、Live 不可用必須 fail-closed」等安全行為，
#     由隔離環境的 HTTP 實測證明（ops/launch-20261028/tools/phase4_security_tests.py
#     的 P-01~P-16），以及本檔 VisionCohortGuardTests 的定向單元測試。
# ---------------------------------------------------------------------------
_GUARD_PATCHERS = []


def setUpModule():
    global _GUARD_PATCHERS
    _GUARD_PATCHERS = [
        patch(
            "learning.views._vision_lookup_submission_student",
            side_effect=lambda submission_id, *, teacher_id: (True, "DEMO-STU-0001"),
        ),
        patch(
            "learning.views._vision_lookup_model_student",
            side_effect=lambda model_id, *, teacher_id, preferred_task: (True, "DEMO-STU-0001"),
        ),
        patch(
            "learning.views.vision_visible_student_ids",
            side_effect=lambda user: {"DEMO-STU-0001"},
        ),
        # 下列四項是「Live 不可用」時的預設行為（本機沒有可用的 Live 服務，
        # 未 mock 時每次呼叫都要等真實連線失敗，單一測試可慢到 10 秒以上）。
        # 以等價的假值取代，行為完全相同、速度大幅提升；需要線上分支的測試
        # 會自行以 @patch 覆寫。
        patch(
            "learning.views.vision_api.vision_api_health",
            return_value=(False, "vision_api_unavailable"),
        ),
        patch(
            "learning.views.vision_api.recommended_seed",
            side_effect=RuntimeError("vision_api_unavailable"),
        ),
        patch(
            "learning.views.vision_api.seed_version_chain",
            side_effect=RuntimeError("vision_api_unavailable"),
        ),
        patch(
            "learning.views.vision_api.list_hard_examples",
            side_effect=RuntimeError("vision_api_unavailable"),
        ),
        patch(
            "learning.views.vision_api.task_model_history",
            return_value={"history": [], "active": None, "inference_source": {}},
        ),
    ]
    for patcher in _GUARD_PATCHERS:
        patcher.start()


def tearDownModule():
    global _GUARD_PATCHERS
    for patcher in _GUARD_PATCHERS:
        patcher.stop()
    _GUARD_PATCHERS = []


class VisionCenterAccessTests(TestCase):
    """權限：只有教師可以進入。"""

    def setUp(self):
        self.url = reverse("learning:teacher_vision_center")

    def test_anonymous_is_redirected_to_teacher_login(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 302)
        self.assertIn(reverse("learning:teacher_login"), response["Location"])

    def test_student_is_denied(self):
        get_user_model().objects.create_user(
            username="vc-student@example.test", password="Student-pass-901!"
        )
        self.client.login(username="vc-student@example.test", password="Student-pass-901!")
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 403)

    def test_post_endpoints_require_teacher(self):
        for name in (
            "learning:teacher_vision_center_validate",
            "learning:teacher_vision_center_import",
            "learning:teacher_vision_center_activate",
            "learning:teacher_vision_center_rollback",
            "learning:teacher_vision_center_upload",
        ):
            response = self.client.post(reverse(name), {})
            self.assertIn(response.status_code, (302, 403), name)


class VisionCenterOfflineTests(TestCase):
    """推論服務不可用時，必須明確停用且不偽造結果。"""

    def setUp(self):
        self.teacher = get_user_model().objects.create_user(
            username="vc-offline@example.test", password="Teacher-pass-901!", is_staff=True
        )
        self.client.force_login(self.teacher)

    @patch("learning.views.vision_api.vision_api_health", return_value=(False, "vision_api_unavailable"))
    def test_page_reports_service_offline(self, _health):
        response = self.client.get(reverse("learning:teacher_vision_center"))
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.context["api_online"])
        self.assertContains(response, "推論服務目前無法連線")

    @patch("learning.views.vision_api.vision_api_health", return_value=(False, "vision_api_unavailable"))
    def test_validate_refuses_when_service_offline(self, _health):
        with patch("learning.views.vision_api.validate_image_with_model") as validate:
            validate.side_effect = RuntimeError("vision_api_unavailable")
            response = self.client.post(
                reverse("learning:teacher_vision_center_validate"),
                {
                    "task_id": "PROP_DIRECTION",
                    "model_id": "PROP_x",
                    "test_image": SimpleUploadedFile("t.jpg", b"jpegbytes", content_type="image/jpeg"),
                },
                follow=True,
            )
        self.assertContains(response, "無法執行圖片驗證")
        self.assertIsNone(self.client.session.get("vision_center_result"))


class VisionCenterOnlineTests(TestCase):
    """推論服務可用時的正常流程（跨進程呼叫以 mock 替代）。"""

    TASK = "PROP_DIRECTION"

    def setUp(self):
        self.teacher = get_user_model().objects.create_user(
            username="vc-online@example.test", password="Teacher-pass-901!", is_staff=True
        )
        self.client.force_login(self.teacher)

    def _history(self, models=None, active=None):
        return {
            "model_type": self.TASK,
            "history": models or [],
            "active": active,
            "inference_source": {"active_model_id": (active or {}).get("model_id")},
        }

    def _model(self, model_id, status="VALIDATED", version="v1", validation="VALIDATED"):
        return {
            "model_id": model_id,
            "model_type": self.TASK,
            "model_name": f"模型 {version}",
            "version": version,
            "status": status,
            "validation_status": validation,
            "file_size": 5_512_149,
            "uploaded_at": "2026-10-10T02:00:00Z",
            "activated_at": "2026-10-10T03:00:00Z" if status == "ACTIVE" else None,
            "class_names": ["CW", "CCW"],
        }

    def _patch_common(self, models):
        return patch(
            "learning.views.vision_api.task_model_history",
            return_value=self._history(models),
        )

    # ---- 頁面渲染 ----

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_four_steps_render_in_single_page(self, _subs, _health):
        """四個場景必須存在於同一頁，且一次只顯示一個（由 scene 參數控制）。

        教師 2026-10-16 裁決：四場景名稱為
        ① 學員模型 ② 圖片驗證 ③ 正式模型 ④ 歸檔與回流。
        """
        models = [self._model("PROP_1", status="ACTIVE")]
        with self._patch_common(models):
            response = self.client.get(
                reverse("learning:teacher_vision_center"), {"task": self.TASK}
            )
            self.assertEqual(response.status_code, 200)
            self.assertContains(response, "學員模型")
            self.assertContains(response, "圖片驗證")
            self.assertContains(response, "正式模型")
            self.assertContains(response, "歸檔與回流")
            # 舊的「區域一~四」主入口與橫向分頁必須移除。
            self.assertNotContains(response, "區域一")
            self.assertNotContains(response, "區域二")
            self.assertNotContains(response, "區域三")
            self.assertNotContains(response, "區域四")

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_tab_param_is_ignored_single_page_render(self, _subs, _health):
        """tab 參數已廢除：無效 task 仍回落到預設，且四場景照常渲染。"""
        with self._patch_common([]):
            response = self.client.get(
                reverse("learning:teacher_vision_center"), {"tab": "../../etc", "task": "BAD"}
            )
        self.assertEqual(response.context["task_id"], self.TASK)
        self.assertContains(response, "學員模型")

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_default_scene_wired_from_param(self, _subs, _health):
        """scene 參數必須流到前端，決定頁面載入後預設顯示哪個場景。"""
        with self._patch_common([]):
            response = self.client.get(
                reverse("learning:teacher_vision_center"), {"task": self.TASK, "scene": "3"}
            )
        self.assertContains(response, "var scene = 3;")
        # 四個場景導覽卡都必須存在。
        for n in ("1", "2", "3", "4"):
            self.assertContains(response, 'data-scene="%s"' % n)

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_ajax_validate_returns_json_without_redirect(self, _subs, _health):
        """② 圖片驗證的 AJAX 分支必須回傳 JSON（不整頁重導），供前端即時畫框。"""
        result = {
            "model": {"model_id": "PROP_1", "model_type": self.TASK, "version": "v1", "class_names": []},
            "detections": [{"class": "CW", "confidence": 0.9, "bbox": [10, 10, 30, 30]}],
            "detection_count": 1,
            "verdict": {
                "decision": "MATCH", "predicted_class": "CW", "predicted_confidence": 0.9,
                "max_confidence": 0.9,
                "expected_class": "CW", "reason": "相符", "reason_code": "OK", "rule_version": "v1",
                "confidence_threshold": 0.5,
            },
            "validated_at": "2026-10-10T04:00:00Z",
        }
        with self._patch_common([self._model("PROP_1")]), patch(
            "learning.views.vision_api.validate_image_with_model", return_value=result
        ):
            response = self.client.post(
                reverse("learning:teacher_vision_center_validate"),
                {
                    "task_id": self.TASK,
                    "model_id": "PROP_1",
                    "expected_class": "CW",
                    "test_image": SimpleUploadedFile("t.jpg", b"jpegbytes", content_type="image/jpeg"),
                },
                HTTP_X_REQUESTED_WITH="XMLHttpRequest",
            )
        self.assertEqual(response.status_code, 200)
        import json
        data = json.loads(response.content)
        self.assertTrue(data["ok"])
        self.assertEqual(data["result"]["verdict"], "MATCH")
        self.assertEqual(len(data["result"]["boxes"]), 1)
        self.assertEqual(data["result"]["boxes"][0]["bbox"], [10, 10, 30, 30])

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_validate_no_detection_reports_highest_confidence_zero(self, _subs, _health):
        """D4（2026-10-20）：① 無框（NO_DETECTION）時最高信心值必須為 0，
        與模板①文案「最高信心值為 0」一致（不是「—」）。"""
        result = {
            "model": {"model_id": "PROP_1", "model_type": self.TASK, "version": "v1", "class_names": []},
            "detections": [],
            "detection_count": 0,
            "verdict": {
                "decision": "INSUFFICIENT_DATA", "predicted_class": None, "predicted_confidence": None,
                "expected_class": None, "reason": "模型未偵測到任何目標（無框）。", "reason_code": "NO_DETECTION", "rule_version": "v1",
                "confidence_threshold": 0.5,
            },
            "validated_at": "2026-10-10T04:00:00Z",
        }
        with self._patch_common([self._model("PROP_1")]), patch(
            "learning.views.vision_api.validate_image_with_model", return_value=result
        ):
            response = self.client.post(
                reverse("learning:teacher_vision_center_validate"),
                {
                    "task_id": self.TASK,
                    "model_id": "PROP_1",
                    "expected_class": "",
                    "test_image": SimpleUploadedFile("t.jpg", b"jpegbytes", content_type="image/jpeg"),
                },
                HTTP_X_REQUESTED_WITH="XMLHttpRequest",
            )
        self.assertEqual(response.status_code, 200)
        import json
        data = json.loads(response.content)
        self.assertTrue(data["ok"])
        self.assertEqual(data["result"]["verdict_reason_code"], "NO_DETECTION")
        self.assertEqual(data["result"]["highest_confidence"], 0.0)
        self.assertEqual(data["result"]["max_confidence"], 0.0)
        self.assertEqual(data["result"]["confidence_threshold_used"], 0.5)

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_active_model_is_surfaced(self, _subs, _health):
        models = [self._model("PROP_active", status="ACTIVE", version="v2")]
        with self._patch_common(models):
            response = self.client.get(
                reverse("learning:teacher_vision_center"), {"task": self.TASK}
            )
        self.assertIsNotNone(response.context["active_model"])
        self.assertEqual(response.context["active_model"]["model_id"], "PROP_active")

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_rollback_available_only_with_validated_history(self, _subs, _health):
        archived = self._model("PROP_old", status="ARCHIVED")
        with self._patch_common([archived]):
            response = self.client.get(
                reverse("learning:teacher_vision_center"), {"task": self.TASK}
            )
        self.assertTrue(response.context["can_rollback"])

        rejected = self._model("PROP_bad", status="ARCHIVED", validation="REJECTED")
        with self._patch_common([rejected]):
            response = self.client.get(
                reverse("learning:teacher_vision_center"), {"task": self.TASK}
            )
        self.assertFalse(response.context["can_rollback"])

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_unverified_model_cannot_activate(self, _subs, _health):
        """未通過驗證的模型：can_activate 必須為 False，且頁面不提供啟用按鈕。"""
        candidate = self._model("PROP_cand", status="CANDIDATE", validation="CANDIDATE")
        with self._patch_common([candidate]):
            response = self.client.get(
                reverse("learning:teacher_vision_center"), {"task": self.TASK}
            )
        models = response.context["activatable_models"]
        self.assertTrue(models)
        self.assertFalse(models[0]["can_activate"])
        # 場景③ 精簡：不符合資格的模型不出現「設為正式模型」按鈕，
        # 只以一顆合併狀態徽章標示（細節放 hover）。
        self.assertFalse(models[0]["can_set_active"])
        self.assertEqual(models[0]["eligibility"], "needs_validation")
        self.assertContains(response, "暫無可啟用的模型，請先完成圖片驗證並達到啟用門檻")

    # ---- 區域二：圖片驗證 ----

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_validate_shows_real_detections(self, _subs, _health):
        """驗證結果必須呈現偵測框、類別、信心值，而不是只看 HTTP 200。"""
        result = {
            "model": {
                "model_id": "PROP_1",
                "model_type": self.TASK,
                "model_name": "模型 v1",
                "version": "v1",
                "class_names": ["CW", "CCW"],
            },
            "detections": [
                {"class": "CW", "confidence": 0.9312, "bbox": [10, 10, 30, 30]},
                {"class": "CCW", "confidence": 0.8877, "bbox": [70, 10, 90, 30]},
            ],
            "detection_count": 2,
            "verdict": {
                "decision": "MATCH",
                "predicted_class": "CW",
                "predicted_confidence": 0.9312,
                "expected_class": "CW",
                "reason": "預測類別與教師標註相符。",
                "reason_code": "OK",
                "rule_version": "PROP_RULE_v1",
                "confidence_threshold": 0.5,
            },
            "validated_at": "2026-10-10T04:00:00Z",
        }
        with self._patch_common([self._model("PROP_1")]), patch(
            "learning.views.vision_api.validate_image_with_model", return_value=result
        ):
            response = self.client.post(
                reverse("learning:teacher_vision_center_validate"),
                {
                    "task_id": self.TASK,
                    "model_id": "PROP_1",
                    "expected_class": "CW",
                    "test_image": SimpleUploadedFile("t.jpg", b"jpegbytes", content_type="image/jpeg"),
                },
                follow=True,
            )
        self.assertEqual(response.status_code, 200)
        # 頁面會消費 session 中的結果並渲染；從渲染後的 context 取回。
        payload = response.context["validation_result"]
        self.assertIsNotNone(payload)
        self.assertEqual(payload["detection_count"], 2)
        self.assertEqual(payload["predicted_class"], "CW")
        self.assertEqual(payload["verdict"], "MATCH")
        self.assertEqual(len(payload["boxes"]), 2)
        self.assertEqual(payload["boxes"][0]["bbox"], [10, 10, 30, 30])
        self.assertContains(response, "相符")

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_low_confidence_is_reported_as_insufficient_not_pass(self, _subs, _health):
        """不得只憑信心值判定；低信心必須是「資料不足」。"""
        result = {
            "model": {"model_id": "PROP_1", "model_type": self.TASK, "version": "v1", "class_names": []},
            "detections": [{"class": "CW", "confidence": 0.12, "bbox": [1, 1, 2, 2]}],
            "detection_count": 1,
            "verdict": {
                "decision": "INSUFFICIENT_DATA",
                "predicted_class": "CW",
                "predicted_confidence": 0.12,
                "expected_class": "CW",
                "reason": "信心值低於門檻，不足以判定。",
                "reason_code": "LOW_CONFIDENCE",
                "confidence_threshold": 0.5,
            },
            "validated_at": "2026-10-10T04:00:00Z",
        }
        with self._patch_common([self._model("PROP_1")]), patch(
            "learning.views.vision_api.validate_image_with_model", return_value=result
        ):
            response = self.client.post(
                reverse("learning:teacher_vision_center_validate"),
                {
                    "task_id": self.TASK,
                    "model_id": "PROP_1",
                    "test_image": SimpleUploadedFile("t.jpg", b"x", content_type="image/jpeg"),
                },
                follow=True,
            )
        payload = response.context["validation_result"]
        self.assertEqual(payload["verdict"], "INSUFFICIENT_DATA")
        self.assertEqual(payload["reason_code"], "LOW_CONFIDENCE")
        self.assertContains(response, "資料不足")

    def test_validate_requires_image(self):
        response = self.client.post(
            reverse("learning:teacher_vision_center_validate"),
            {"task_id": self.TASK, "model_id": "PROP_1"},
            follow=True,
        )
        self.assertContains(response, "請先選擇一張測試圖片")

    def test_validate_requires_model(self):
        response = self.client.post(
            reverse("learning:teacher_vision_center_validate"),
            {
                "task_id": self.TASK,
                "test_image": SimpleUploadedFile("t.jpg", b"x", content_type="image/jpeg"),
            },
            follow=True,
        )
        self.assertContains(response, "請先選擇要驗證的模型")

    # ---- 區域三：啟用 / 回復 ----

    @patch("learning.views.vision_api.activate_model")
    def test_activate_success_mentions_history_kept(self, activate):
        activate.return_value = {
            "model_id": "PROP_2",
            "status": "ACTIVE",
            "activation": {
                "previous_active_model_id": "PROP_1",
                "already_active": False,
                "inference_source": {"active_model_id": "PROP_2", "file_exists": True},
            },
        }
        response = self.client.post(
            reverse("learning:teacher_vision_center_activate"),
            {"task_id": self.TASK, "model_id": "PROP_2"},
            follow=True,
        )
        self.assertContains(response, "已設為正式模型")
        self.assertContains(response, "歷史版本")

    @patch("learning.views.vision_api.activate_model")
    def test_activate_failure_preserves_original_model(self, activate):
        """切換失敗必須明確告知原本的正式模型未變更。"""
        activate.side_effect = RuntimeError("vision_api_rejected:422:model_file_unreadable")
        response = self.client.post(
            reverse("learning:teacher_vision_center_activate"),
            {"task_id": self.TASK, "model_id": "PROP_bad"},
            follow=True,
        )
        self.assertContains(response, "啟用失敗")
        self.assertContains(response, "原本的正式模型未變更")

    @patch("learning.views.vision_api.activate_model")
    def test_activate_warns_when_inference_source_unconfirmed(self, activate):
        """啟用後若無法確認推論服務已改用新模型，必須警告而非直接宣稱成功。"""
        activate.return_value = {
            "model_id": "PROP_2",
            "status": "ACTIVE",
            "activation": {
                "previous_active_model_id": None,
                "inference_source": {"active_model_id": "PROP_1"},
            },
        }
        response = self.client.post(
            reverse("learning:teacher_vision_center_activate"),
            {"task_id": self.TASK, "model_id": "PROP_2"},
            follow=True,
        )
        self.assertContains(response, "無法確認推論服務已改用新模型")

    @patch("learning.views.vision_api.rollback_model")
    def test_rollback_success(self, rollback):
        rollback.return_value = {
            "restored": {"model_id": "PROP_1", "version": "v1"},
            "replaced": {"model_id": "PROP_2"},
            "inference_source": {"active_model_id": "PROP_1"},
        }
        response = self.client.post(
            reverse("learning:teacher_vision_center_rollback"),
            {"task_id": self.TASK},
            follow=True,
        )
        self.assertContains(response, "已回復到版本 v1")
        self.assertContains(response, "仍保留在歷史中")

    @patch("learning.views.vision_api.rollback_model")
    def test_rollback_failure_preserves_current_model(self, rollback):
        rollback.side_effect = RuntimeError("vision_api_rejected:422:no_previous_validated_model")
        response = self.client.post(
            reverse("learning:teacher_vision_center_rollback"),
            {"task_id": self.TASK},
            follow=True,
        )
        self.assertContains(response, "回復失敗")
        self.assertContains(response, "目前的正式模型未變更")

    # ---- 區域一：導入學員模型 ----

    READY_PREFLIGHT = {"outcome": "ready", "class_names_actual": ["CW", "CCW"], "class_names_expected": ["CW", "CCW"]}

    @patch("learning.views.vision_api.create_dataset")
    @patch("learning.views.vision_api.import_submission")
    @patch("learning.views.vision_api.preflight_import")
    def test_import_submission_creates_candidate(self, preflight, import_sub, create_ds):
        create_ds.return_value = {"dataset_id": "ds-1", "dataset_version": "v1"}
        import_sub.return_value = {"model_id": "PROP_new"}
        preflight.return_value = dict(self.READY_PREFLIGHT)
        response = self.client.post(
            reverse("learning:teacher_vision_center_import"),
            {"task_id": self.TASK, "submission_id": "sub-abc123"},
            follow=True,
        )
        self.assertContains(response, "已導入為候選模型")
        self.assertContains(response, "仍需完成圖片驗證")
        import_sub.assert_called_once()

    @patch("learning.views.vision_api.record_import_failure")
    @patch("learning.views.vision_api.quarantine_dataset")
    @patch("learning.views.vision_api.create_dataset")
    @patch("learning.views.vision_api.import_submission")
    @patch("learning.views.vision_api.preflight_import")
    def test_import_failure_is_reported_in_full_without_auto_reject(
        self, preflight, import_sub, create_ds, quarantine_ds, record_failure,
    ):
        """教師指令④⑤ + D2（2026-10-19）：顯示可理解的失敗原因，不駁回、不回顯原始代碼。"""
        create_ds.return_value = {"dataset_id": "ds-1", "dataset_version": "v1"}
        import_sub.side_effect = RuntimeError("vision_api_rejected:422:model_class_names_mismatch")
        preflight.return_value = dict(self.READY_PREFLIGHT)
        response = self.client.post(
            reverse("learning:teacher_vision_center_import"),
            {"task_id": self.TASK, "submission_id": "sub-bad"},
            follow=True,
        )
        self.assertContains(response, "導入失敗")
        self.assertContains(response, "模型類別數量與任務預期不一致")
        # D2：原始錯誤代碼不得出現在教師畫面
        self.assertNotContains(response, "model_class_names_mismatch")
        self.assertContains(response, "提交保持「待複核」，未被駁回")
        # D1：匯入失敗後隔離剛建立的資料集
        quarantine_ds.assert_called_once()
        self.assertEqual(quarantine_ds.call_args.kwargs["dataset_id"], "ds-1")
        # D2：失敗原因寫回 Live
        record_failure.assert_called_once()
        self.assertEqual(record_failure.call_args.kwargs["code"], "model_class_names_mismatch")

    @patch("learning.views.vision_api.record_import_failure")
    @patch("learning.views.vision_api.create_dataset")
    @patch("learning.views.vision_api.import_submission")
    @patch("learning.views.vision_api.preflight_import")
    def test_import_preflight_missing_class_names_tells_teacher_to_supply(
        self, preflight, import_sub, create_ds, record_failure,
    ):
        """教師指令③：names 為空 → UI 提示「模型缺少類別名稱，請補充」，不駁回。"""
        preflight.return_value = {
            "outcome": "class_names_missing", "class_names_actual": [], "class_names_expected": ["CW", "CCW"],
        }
        response = self.client.post(
            reverse("learning:teacher_vision_center_import"),
            {"task_id": self.TASK, "submission_id": "sub-empty"},
            follow=True,
        )
        self.assertContains(response, "模型缺少類別名稱，請補充")
        self.assertContains(response, "未被駁回")
        create_ds.assert_not_called()
        import_sub.assert_not_called()
        # F-A（2026-10-20）：隔離 Live 呼叫，測試期間不得發出真實 HTTP。
        record_failure.assert_called_once()
        self.assertEqual(record_failure.call_args.kwargs["code"], "model_class_names_missing")
        self.assertEqual(record_failure.call_args.kwargs["submission_id"], "sub-empty")

    @patch("learning.views.vision_api.record_import_failure")
    @patch("learning.views.vision_api.create_dataset")
    @patch("learning.views.vision_api.import_submission")
    @patch("learning.views.vision_api.preflight_import")
    def test_import_preflight_count_mismatch_reports_both_counts(
        self, preflight, import_sub, create_ds, record_failure,
    ):
        """類別數量不符 → 明確實際/預期數量，不駁回、不對照。"""
        preflight.return_value = {
            "outcome": "mismatch", "class_names_actual": ["A", "B", "C"], "class_names_expected": ["CW", "CCW"],
        }
        response = self.client.post(
            reverse("learning:teacher_vision_center_import"),
            {"task_id": self.TASK, "submission_id": "sub-count"},
            follow=True,
        )
        self.assertContains(response, "導入失敗")
        self.assertContains(response, "實際 3 類、預期 2 類")
        import_sub.assert_not_called()
        # F-A（2026-10-20）：隔離 Live 呼叫，測試期間不得發出真實 HTTP。
        record_failure.assert_called_once()
        self.assertEqual(record_failure.call_args.kwargs["code"], "model_class_names_mismatch")
        self.assertEqual(record_failure.call_args.kwargs["submission_id"], "sub-count")

    @patch("learning.views.vision_api.create_dataset")
    @patch("learning.views.vision_api.import_submission")
    @patch("learning.views.vision_api.preflight_import")
    def test_import_preflight_mapping_required_shows_mapping_form_without_side_effects(self, preflight, import_sub, create_ds):
        """教師指令③：數量一致名稱不同 → 對照表介面；不建資料集、不動提交。"""
        preflight.return_value = {
            "outcome": "mapping_required",
            "class_names_actual": ["cw-prop", "ccw-prop"],
            "class_names_expected": ["CW", "CCW"],
        }
        response = self.client.post(
            reverse("learning:teacher_vision_center_import"),
            {"task_id": self.TASK, "submission_id": "sub-2f8d"},
            follow=True,
        )
        self.assertContains(response, "類別名對照")
        self.assertContains(response, "ccw-prop")
        self.assertContains(response, "確認對照並導入")
        create_ds.assert_not_called()
        import_sub.assert_not_called()

    @patch("learning.views.vision_api.create_dataset")
    @patch("learning.views.vision_api.import_submission")
    def test_apply_mapping_completes_import_with_mapping(self, import_sub, create_ds):
        """教師指令③：提交對照表後完成導入，並帶上 {實際: 預期} 對照。"""
        create_ds.return_value = {"dataset_id": "ds-1", "dataset_version": "v1"}
        import_sub.return_value = {"model_id": "PROP_mapped"}
        session = self.client.session
        session["vision_class_name_mapping"] = {
            "submission_id": "sub-2f8d",
            "task_id": self.TASK,
            "class_names_actual": ["cw-prop", "ccw-prop"],
            "class_names_expected": ["CW", "CCW"],
        }
        session.save()
        response = self.client.post(
            reverse("learning:teacher_vision_center_apply_mapping"),
            {
                "task_id": self.TASK,
                "map_0": "CW", "map_1": "CCW",
            },
            follow=True,
        )
        self.assertContains(response, "已導入為候選模型")
        called_kwargs = import_sub.call_args.kwargs
        self.assertEqual(
            called_kwargs["class_name_mapping"],
            {"cw-prop": "CW", "ccw-prop": "CCW"},
        )

    @patch("learning.views.vision_api.create_dataset")
    @patch("learning.views.vision_api.import_submission")
    @patch("learning.views.vision_api.preflight_import")
    def test_mapping_survives_page_render_until_applied(self, preflight, import_sub, create_ds):
        """迴歸：導入預檢→渲染對照表卡片（GET）→教師提交對照表，session 不可被渲染消費。

        真實鏈路中教師會在「地圖表頁面」停留並填表；若 GET 渲染時 pop session，
        apply-mapping 將誤判「對照表已過期」，教師永遠無法完成導入。
        """
        preflight.return_value = {
            "outcome": "mapping_required",
            "class_names_actual": ["cw-prop", "ccw-prop"],
            "class_names_expected": ["CW", "CCW"],
        }
        create_ds.return_value = {"dataset_id": "ds-1", "dataset_version": "v1"}
        import_sub.return_value = {"model_id": "PROP_mapped"}
        # ① 觸發導入 → 預檢要求對照 → 重定向到對照表頁面（follow 會執行 GET 渲染）
        response = self.client.post(
            reverse("learning:teacher_vision_center_import"),
            {"task_id": self.TASK, "submission_id": "sub-2f8d"},
            follow=True,
        )
        self.assertContains(response, "類別名對照")
        # ② 教師在渲染後的頁面填寫完整對照表並提交 → 必須能完成導入
        response = self.client.post(
            reverse("learning:teacher_vision_center_apply_mapping"),
            {
                "task_id": self.TASK,
                "map_0": "CW", "map_1": "CCW",
            },
            follow=True,
        )
        self.assertNotContains(response, "對照表已過期")
        self.assertContains(response, "已導入為候選模型")
        called_kwargs = import_sub.call_args.kwargs
        self.assertEqual(
            called_kwargs["class_name_mapping"],
            {"cw-prop": "CW", "ccw-prop": "CCW"},
        )

    def test_apply_mapping_rejects_incomplete_mapping_and_keeps_form(self):
        """對照表不完整 → 拒絕導入並保留對照表供修正。"""
        session = self.client.session
        session["vision_class_name_mapping"] = {
            "submission_id": "sub-2f8d",
            "task_id": self.TASK,
            "class_names_actual": ["cw-prop", "ccw-prop"],
            "class_names_expected": ["CW", "CCW"],
        }
        session.save()
        response = self.client.post(
            reverse("learning:teacher_vision_center_apply_mapping"),
            {"task_id": self.TASK, "map_0": "CCW", "map_1": "CCW"},
            follow=True,
        )
        self.assertContains(response, "對照表不完整或重複")
        self.assertContains(response, "類別名對照")

    @override_settings(VISION_DEMO_SIMULATION_ENABLED=True)
    @patch("learning.views.vision_api.approve_demo_submission")
    def test_demo_review_approval_uses_inert_submission_without_real_import(self, approve):
        approve.return_value = {
            "submission_id": "sub-demo",
            "status": "SUBMITTED",
            "demo_review_status": "DEMO_REVIEW_APPROVED",
            "demo_active": True,
        }

        response = self.client.post(
            reverse("learning:teacher_vision_center_import"),
            {
                "task_id": self.TASK,
                "submission_id": "sub-demo",
                "demo_review_approved": "1",
            },
            follow=True,
        )

        self.assertContains(response, "DEMO 模型已複核通過並啟用")
        approve.assert_called_once_with(
            submission_id="sub-demo", teacher_id=self.teacher.pk
        )

    # ---- 區域三：教師上傳模型 ----

    @patch("learning.views.vision_api.create_dataset")
    @patch("learning.views.vision_api.upload_teacher_model")
    def test_upload_teacher_model_warns_validation_still_needed(self, upload, create_ds):
        create_ds.return_value = {"dataset_id": "ds-1", "dataset_version": "v1"}
        upload.return_value = {"model_id": "PROP_up", "validation_status": "VALIDATED"}
        response = self.client.post(
            reverse("learning:teacher_vision_center_upload"),
            {
                "task_id": self.TASK,
                "model_name": "我的模型",
                "version": "v2",
                "model_file": SimpleUploadedFile("best.pt", b"PK\x03\x04fake", content_type="application/octet-stream"),
            },
            follow=True,
        )
        self.assertContains(response, "模型已通過檢查")
        self.assertContains(response, "請先到「② 圖片驗證」用圖片驗證")

    @patch("learning.views.vision_api.upload_teacher_model")
    def test_upload_rejects_non_pt_extension(self, upload):
        response = self.client.post(
            reverse("learning:teacher_vision_center_upload"),
            {
                "task_id": self.TASK,
                "model_name": "壞檔",
                "version": "v1",
                "model_file": SimpleUploadedFile("best.txt", b"not-a-model", content_type="text/plain"),
            },
            follow=True,
        )
        self.assertContains(response, "必須是 .pt 格式")
        upload.assert_not_called()

    @patch("learning.views.vision_api.upload_teacher_model")
    def test_upload_rejects_missing_name(self, upload):
        response = self.client.post(
            reverse("learning:teacher_vision_center_upload"),
            {
                "task_id": self.TASK,
                "version": "v1",
                "model_file": SimpleUploadedFile("best.pt", b"PK\x03\x04fake"),
            },
            follow=True,
        )
        self.assertContains(response, "請填寫模型名稱")
        upload.assert_not_called()

    @patch("learning.views.vision_api.create_dataset")
    @patch("learning.views.vision_api.upload_teacher_model")
    def test_upload_failure_adds_no_version(self, upload, create_ds):
        """模型檢查失敗時不得新增任何版本。"""
        create_ds.return_value = {"dataset_id": "ds-1", "dataset_version": "v1"}
        upload.side_effect = RuntimeError("vision_api_rejected:422:model_class_names_mismatch")
        response = self.client.post(
            reverse("learning:teacher_vision_center_upload"),
            {
                "task_id": self.TASK,
                "model_name": "契約錯誤",
                "version": "v1",
                "model_file": SimpleUploadedFile("best.pt", b"PK\x03\x04fake"),
            },
            follow=True,
        )
        self.assertContains(response, "未通過檢查")
        self.assertContains(response, "未新增任何版本")


class VisionCenterTaskIsolationTests(TestCase):
    """兩個任務必須各自獨立：模型、類別、啟用版本互不干擾。"""

    def setUp(self):
        self.teacher = get_user_model().objects.create_user(
            username="vc-tasks@example.test", password="Teacher-pass-901!", is_staff=True
        )
        self.client.force_login(self.teacher)

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    @patch("learning.views.vision_api.task_model_history")
    def test_each_task_queries_its_own_model_type(self, history, _subs, _health):
        history.return_value = {"history": [], "active": None, "inference_source": {}}
        self.client.get(reverse("learning:teacher_vision_center"), {"task": "FOUR_SIDE_HOVER"})
        called = {call.kwargs.get("model_type") for call in history.call_args_list}
        self.assertIn("PROP_DIRECTION", called)
        self.assertIn("FOUR_SIDE_HOVER", called)

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    @patch("learning.views.vision_api.task_model_history")
    def test_class_options_differ_between_tasks(self, history, _subs, _health):
        history.return_value = {"history": [], "active": None, "inference_source": {}}
        prop = self.client.get(
            reverse("learning:teacher_vision_center"), {"task": "PROP_DIRECTION"}
        )
        hover = self.client.get(
            reverse("learning:teacher_vision_center"), {"task": "FOUR_SIDE_HOVER"}
        )
        self.assertEqual(prop.context["class_options"], ["CW", "CCW"])
        self.assertEqual(hover.context["class_options"], ["FRONT", "RIGHT", "BACK", "LEFT"])

    @patch("learning.views.vision_api.rollback_model")
    def test_rollback_uses_selected_task(self, rollback):
        rollback.return_value = {
            "restored": {"model_id": "HOVER_1", "version": "v1"},
            "inference_source": {"active_model_id": "HOVER_1"},
        }
        self.client.post(
            reverse("learning:teacher_vision_center_rollback"),
            {"task_id": "FOUR_SIDE_HOVER"},
            follow=True,
        )
        rollback.assert_called_once()
        self.assertEqual(rollback.call_args.kwargs["model_type"], "FOUR_SIDE_HOVER")


class VisionVerificationGateTests(TestCase):
    """推論閘門必須反映真實可用性，而非永久硬編碼阻擋。"""

    @patch("learning.vision_submission.list_models", return_value=[])
    def test_gate_opens_when_live_backend_reachable(self, _models):
        from learning import vision_verification

        state = vision_verification.runner_state()
        self.assertTrue(state["available"])
        self.assertEqual(state["environment"], "LIVE_BACKEND")

    @patch("learning.vision_submission.list_models", side_effect=RuntimeError("vision_api_unavailable"))
    def test_gate_blocks_when_live_backend_unreachable(self, _models):
        from learning import vision_verification

        state = vision_verification.runner_state()
        self.assertFalse(state["available"])
        self.assertEqual(state["environment"], "NONE")
        self.assertIn("Live Backend", state["reason"])

    def test_in_process_loading_remains_forbidden(self):
        """無論如何，Django 進程都不得載入 .pt。"""
        from learning import vision_verification

        self.assertFalse(vision_verification.IN_PROCESS_LOADING_ALLOWED)


class VisionSubmissionWrapperTests(TestCase):
    """教師指令⑤：Live Backend 4xx 錯誤內容必須完整帶回、不截斷。

    類別名相關錯誤轉為可識別型別，供教師頁渲染對照表／補充提示。
    """

    def _http_error(self, body, code=422):
        import io as _io
        from urllib.error import HTTPError

        return HTTPError(
            "http://live.invalid/api/v1/vision/submissions/sub-x/import",
            code, "Unprocessable Entity", {}, _io.BytesIO(body.encode("utf-8")),
        )

    def test_long_error_body_is_not_truncated(self):
        """超過舊版 400 字元截斷上限的長訊息也必須完整出現在例外文字中。"""
        from learning import vision_submission

        long_message = "import_rejected_because:" + "x" * 1500
        body = json.dumps({"error": {"code": "import_failed", "message": long_message}})
        runtime_error = vision_submission._rejected(self._http_error(body))
        self.assertIsInstance(runtime_error, RuntimeError)
        self.assertIn(long_message, str(runtime_error))
        self.assertGreater(len(str(runtime_error)), 1400)

    def test_mapping_required_body_becomes_typed_exception(self):
        from learning import vision_submission

        body = json.dumps({
            "error": {
                "code": "import_failed",
                "message": "model_class_names_mapping_required",
                "class_names_actual": ["cw-prop", "ccw-prop"],
                "class_names_expected": ["CW", "CCW"],
            }
        })
        typed = vision_submission._rejected(self._http_error(body))
        self.assertIsInstance(typed, vision_submission.VisionImportClassNamesMappingRequired)
        self.assertEqual(typed.class_names_actual, ["cw-prop", "ccw-prop"])
        self.assertEqual(typed.class_names_expected, ["CW", "CCW"])

    def test_missing_class_names_body_becomes_typed_exception(self):
        from learning import vision_submission

        body = json.dumps({"error": {"code": "import_failed", "message": "model_class_names_missing"}})
        self.assertIsInstance(
            vision_submission._rejected(self._http_error(body)),
            vision_submission.VisionImportClassNamesMissing,
        )

    def test_plain_error_body_stays_readable(self):
        from learning import vision_submission

        body = json.dumps({"error": {"code": "import_failed", "message": "model_class_names_mismatch"}})
        runtime_error = vision_submission._rejected(self._http_error(body))
        self.assertEqual(
            str(runtime_error),
            "vision_api_rejected:422:import_failed:model_class_names_mismatch",
        )


class VisionCenterDeleteSubmissionTests(VisionCenterOnlineTests):
    """刪除學員上傳（教師指令 2026-10-20：教師後台增加刪除功能）。

    Django 層只驗證行為契約：按鈕存在、轉發、成功／失敗訊息如實；
    真正的 store／檔案刪除與備份由 Live 端測試（test_vision_submission_delete.py）把關。
    """

    def _pending(self, submission_id="sub-abc123", filename="best.pt"):
        return [{
            "submission_id": submission_id,
            "original_filename": filename,
            "student_id": "DEMO-STU-0001",
            "group_id": "DEMO-VERIFY",
            "status": "SUBMITTED",
            "file_hash": "0" * 64,
            "file_size": 5_503_222,
            "uploaded_at": "2026-10-20T03:00:00Z",
            "imported_model_id": None,
        }]

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions")
    def test_pending_submission_shows_delete_button(self, subs, _health):
        """待複核清單必須提供「刪除上傳」按鈕（附提交編號與確認對話框）。"""
        subs.return_value = self._pending()
        with self._patch_common([self._model("PROP_1", status="ACTIVE")]):
            response = self.client.get(
                reverse("learning:teacher_vision_center"), {"task": self.TASK, "scene": "1"}
            )
        self.assertEqual(response.status_code, 200)
        self.assertContains(
            response, reverse("learning:teacher_vision_center_delete_submission")
        )
        self.assertContains(response, "刪除上傳")
        self.assertContains(response, "sub-abc123")
        self.assertContains(response, "刪除前會自動備份")

    @patch("learning.views.vision_api.delete_submission")
    def test_delete_success_reports_record_and_file_removed(self, delete_sub):
        delete_sub.return_value = {
            "submission_id": "sub-abc123",
            "record_removed": True,
            "file_removed": True,
            "backup_path": "backups/x-delete-sub-abc123",
        }
        response = self.client.post(
            reverse("learning:teacher_vision_center_delete_submission"),
            {"task_id": self.TASK, "submission_id": "sub-abc123"},
            follow=True,
        )
        self.assertContains(response, "已刪除學員上傳 sub-abc123")
        self.assertContains(response, "已自動備份")
        delete_sub.assert_called_once_with(submission_id="sub-abc123", teacher_id=self.teacher.pk)

    @patch("learning.views.vision_api.delete_submission")
    def test_delete_failure_maps_dependency_error_and_changes_nothing(self, delete_sub):
        """有模型依賴時，Live 拒絕刪除；Django 必須如實顯示中文原因。"""
        delete_sub.side_effect = RuntimeError(
            "vision_api_rejected:422:submission_has_models:PROP_20261019_DEMO-A_v1_994d"
        )
        response = self.client.post(
            reverse("learning:teacher_vision_center_delete_submission"),
            {"task_id": self.TASK, "submission_id": "sub-imported"},
            follow=True,
        )
        self.assertContains(response, "刪除失敗")
        self.assertContains(response, "均未變更")
        self.assertContains(response, "此提交已導入為模型，不能直接刪除")

    def test_delete_without_submission_id_is_refused(self):
        response = self.client.post(
            reverse("learning:teacher_vision_center_delete_submission"),
            {"task_id": self.TASK},
            follow=True,
        )
        self.assertContains(response, "缺少提交編號")


class VisionCenterModelManagementTests(VisionCenterOnlineTests):
    """模型管理（教師指令 2026-10-21）：歸檔／還原／永久刪除的 Django 端契約。

    本類只驗證 Django 的行為：按鈕是否依狀態出現、是否轉發正確參數、
    失敗原因是否如實顯示、二次確認是否真的擋住未確認的刪除。
    真正的狀態機、共用 .pt 保護、備份與審計由 Live 端
    test_vision_model_management.py 把關。
    """

    def _archived_model(self, model_id="PROP_archived", version="v0"):
        model = self._model(model_id, status="ARCHIVED", version=version)
        model.update(
            archived_via="teacher",
            archived_reason="未訓練",
            status_before_archive="VALIDATED",
            archived_at="2026-10-21T01:00:00Z",
        )
        return model

    # ---- 頁面渲染 ----
    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_candidate_list_offers_archive_for_non_active_model(self, _subs, _health):
        models = [self._model("PROP_1", status="VALIDATED")]
        with self._patch_common(models):
            response = self.client.get(
                reverse("learning:teacher_vision_center"), {"task": self.TASK, "scene": "3"}
            )
        self.assertEqual(response.status_code, 200)
        self.assertContains(
            response, reverse("learning:teacher_vision_center_archive_model")
        )
        self.assertContains(response, ">歸檔</button>")
        # 歸檔原因不再是常駐輸入框，改由確認對話框內填寫（POST 參數名 reason 不變）
        self.assertContains(response, "vcArchive(")
        self.assertContains(response, "歸檔原因（選填，會寫入審計紀錄，最長 120 字）")
        self.assertContains(response, 'name="reason"')
        self.assertNotContains(response, 'type="text" name="reason"')

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_active_model_has_no_archive_or_delete_action(self, _subs, _health):
        models = [self._model("PROP_active", status="ACTIVE")]
        with self._patch_common(models):
            response = self.client.get(
                reverse("learning:teacher_vision_center"), {"task": self.TASK, "scene": "3"}
            )
        self.assertEqual(response.status_code, 200)
        context = response.context
        self.assertEqual(context["archived_models"], [])
        self.assertEqual(context["deletable_models"], [])
        self.assertNotContains(response, "歸檔此模型")

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_archived_section_lists_teacher_archived_with_restore(self, _subs, _health):
        models = [self._archived_model()]
        with self._patch_common(models):
            response = self.client.get(
                reverse("learning:teacher_vision_center"), {"task": self.TASK, "scene": "3"}
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [item["model_id"] for item in response.context["archived_models"]],
            ["PROP_archived"],
        )
        self.assertContains(response, "已歸檔")
        self.assertContains(
            response, reverse("learning:teacher_vision_center_restore_model")
        )
        self.assertContains(response, "一鍵還原")
        self.assertContains(response, "未訓練")

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_restored_model_is_not_listed_as_archived(self, _subs, _health):
        """還原後 archived_via 可能仍殘留，但 status 已非 ARCHIVED → 不得列入已歸檔區。"""
        model = self._model("PROP_back", status="VALIDATED", version="v2")
        model.update(archived_via="teacher", archived_reason="曾歸檔", archived_at=None)
        with self._patch_common([model]):
            response = self.client.get(
                reverse("learning:teacher_vision_center"), {"task": self.TASK, "scene": "3"}
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.context["archived_models"], [])

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_delete_only_inside_archived_section(self, _subs, _health):
        """永久刪除只出現在「已歸檔」折疊區，且維持二次確認與共用 .pt 保護提示。"""
        models = [self._archived_model()]
        with self._patch_common(models):
            response = self.client.get(
                reverse("learning:teacher_vision_center"), {"task": self.TASK, "scene": "3"}
            )
        self.assertEqual(response.status_code, 200)
        self.assertContains(
            response, reverse("learning:teacher_vision_center_delete_model")
        )
        self.assertContains(response, "我已確認要永久刪除這筆模型記錄")
        # 共用 .pt 保護：只刪記錄不刪檔案的提示仍隨確認對話框輸出
        self.assertContains(response, ".pt 仍被其他記錄共用，只刪記錄不刪檔案")

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_non_archived_model_has_no_delete_action(self, _subs, _health):
        """未歸檔的模型不得出現永久刪除（刪除只留在已歸檔區）。"""
        models = [self._model("PROP_1", status="VALIDATED")]
        with self._patch_common(models):
            response = self.client.get(
                reverse("learning:teacher_vision_center"), {"task": self.TASK, "scene": "3"}
            )
        self.assertEqual(response.status_code, 200)
        self.assertNotContains(
            response, reverse("learning:teacher_vision_center_delete_model")
        )

    # ---- 歸檔 ----
    @patch("learning.views.vision_api.archive_model")
    def test_archive_forwards_reason_and_reports_success(self, archive):
        archive.return_value = {
            "model_id": "PROP_1",
            "status": "ARCHIVED",
            "already_archived": False,
            "superseded_submission_id": "sub-1",
            "backup_path": "backups/x-archive-PROP_1",
        }
        with patch("learning.views._vision_mark_submission_superseded") as mark:
            response = self.client.post(
                reverse("learning:teacher_vision_center_archive_model"),
                {"task_id": self.TASK, "model_id": "PROP_1", "reason": "辨識品質不足"},
                follow=True,
            )
        self.assertContains(response, "已歸檔此模型")
        self.assertContains(response, "學員可重新上傳新模型")
        archive.assert_called_once_with(
            model_id="PROP_1", teacher_id=self.teacher.pk, reason="辨識品質不足"
        )
        mark.assert_called_once()
        self.assertEqual(mark.call_args.args[0], "sub-1")
        self.assertEqual(mark.call_args.kwargs["op"], "archive")

    @patch("learning.views.vision_api.archive_model")
    def test_archive_active_guard_error_is_explained(self, archive):
        archive.side_effect = RuntimeError(
            "vision_api_rejected:422:model_active_cannot_manage"
        )
        response = self.client.post(
            reverse("learning:teacher_vision_center_archive_model"),
            {"task_id": self.TASK, "model_id": "PROP_active"},
            follow=True,
        )
        self.assertContains(response, "歸檔失敗")
        self.assertContains(response, "狀態未變更")
        self.assertContains(response, "ACTIVE")
        self.assertContains(response, "不可歸檔或刪除")

    def test_archive_without_model_id_is_refused(self):
        response = self.client.post(
            reverse("learning:teacher_vision_center_archive_model"),
            {"task_id": self.TASK},
            follow=True,
        )
        self.assertContains(response, "缺少模型編號")

    # ---- 還原 ----
    @patch("learning.views.vision_api.restore_model")
    def test_restore_reports_restored_status(self, restore):
        restore.return_value = {"model_id": "PROP_archived", "status": "VALIDATED"}
        response = self.client.post(
            reverse("learning:teacher_vision_center_restore_model"),
            {"task_id": self.TASK, "model_id": "PROP_archived"},
            follow=True,
        )
        self.assertContains(response, "已還原模型")
        self.assertContains(response, "VALIDATED")
        restore.assert_called_once_with(
            model_id="PROP_archived", teacher_id=self.teacher.pk, reason=""
        )

    @patch("learning.views.vision_api.restore_model")
    def test_restore_clears_django_superseded_marker(self, restore):
        """M2：還原後 Django 端 Evidence 的 SUPERSEDED 標記必須同步回退。"""
        restore.return_value = {
            "model_id": "PROP_archived",
            "status": "VALIDATED",
            "unsuperseded_submission_id": "sub-1",
        }
        with patch("learning.views._vision_clear_submission_superseded") as clear:
            response = self.client.post(
                reverse("learning:teacher_vision_center_restore_model"),
                {"task_id": self.TASK, "model_id": "PROP_archived"},
                follow=True,
            )
        self.assertContains(response, "已還原模型")
        clear.assert_called_once_with("sub-1")

    # ---- 永久刪除 ----
    @patch("learning.views.vision_api.delete_model")
    def test_delete_without_confirmation_never_calls_backend(self, delete):
        response = self.client.post(
            reverse("learning:teacher_vision_center_delete_model"),
            {"task_id": self.TASK, "model_id": "PROP_1", "reason": "重複"},
            follow=True,
        )
        self.assertContains(response, "需要二次確認")
        delete.assert_not_called()

    @patch("learning.views.vision_api.delete_model")
    def test_delete_reports_shared_file_kept(self, delete):
        delete.return_value = {
            "model_id": "PROP_1",
            "record_removed": True,
            "file_removed": False,
            "shared_with": ["PROP_2", "sub-9"],
            "superseded_submission_id": None,
            "backup_path": "backups/x-delete-PROP_1",
        }
        with patch("learning.views._vision_mark_submission_superseded") as mark:
            response = self.client.post(
                reverse("learning:teacher_vision_center_delete_model"),
                {"task_id": self.TASK, "model_id": "PROP_1", "confirm_delete": "yes"},
                follow=True,
            )
        self.assertContains(response, "已永久刪除模型 PROP_1")
        self.assertContains(response, "仍被其他記錄共用")
        self.assertContains(response, "PROP_2")
        mark.assert_not_called()

    @patch("learning.views.vision_api.delete_model")
    def test_delete_success_marks_submission_superseded(self, delete):
        delete.return_value = {
            "model_id": "PROP_1",
            "record_removed": True,
            "file_removed": True,
            "shared_with": [],
            "superseded_submission_id": "sub-1",
            "backup_path": "backups/x-delete-PROP_1",
        }
        with patch("learning.views._vision_mark_submission_superseded") as mark:
            response = self.client.post(
                reverse("learning:teacher_vision_center_delete_model"),
                {"task_id": self.TASK, "model_id": "PROP_1", "confirm_delete": "yes"},
                follow=True,
            )
        self.assertContains(response, "記錄與 .pt 檔均已永久移除")
        mark.assert_called_once()
        self.assertEqual(mark.call_args.kwargs["op"], "delete")

    # ---- 權限 ----
    def test_student_cannot_call_management_endpoints(self):
        student = get_user_model().objects.create_user(
            username="vc-mgmt-student@example.test", password="Student-pass-901!"
        )
        self.client.force_login(student)
        for name in (
            "learning:teacher_vision_center_archive_model",
            "learning:teacher_vision_center_restore_model",
            "learning:teacher_vision_center_delete_model",
        ):
            response = self.client.post(reverse(name), {"model_id": "PROP_1"})
            self.assertIn(response.status_code, (302, 403), name)


class VisionCenterScene3SlimTests(VisionCenterOnlineTests):
    """場景③「正式模型」（教師指令 2026-10-22）。

    頁面只保留三個動作：啟用／歸檔／刪除。其餘長篇說明、多枚徽章、
    多餘入口一律移除。

    2026-10-22 教師裁定改版：模型「不符合自動品質判定」不再一律不可用，
    改由教師看過「② 圖片驗證」結果後自行決定是否啟用。唯一硬攔是
    quarantined（Live 端 `activate_model(..., override=True)` 仍拒）。
    其餘閘門被覆寫時，由 Live 端逐條記進審計，不靜音放行。
    """

    def _pass_record(self, model_id, verdict="MATCH"):
        return {
            "model_id": model_id,
            "task_id": self.TASK,
            "verdict": verdict,
            "evidence_source": "REAL_INFERENCE",
            "predicted_class": "CW" if verdict == "MATCH" else "CCW",
            "predicted_confidence": 0.91 if verdict == "MATCH" else 0.0027,
            "confidence_threshold": 0.5,
            "expected_class": "CW",
            "validated_at": "2026-10-22T10:00:00Z",
        }

    def _archived_model(self, model_id="PROP_archived", version="v0"):
        model = self._model(model_id, status="ARCHIVED", version=version)
        model.update(
            archived_via="teacher",
            archived_reason="未訓練",
            status_before_archive="VALIDATED",
            archived_at="2026-10-22T01:00:00Z",
        )
        return model

    def _ready_model(self, model_id="PROP_ready", version="v1"):
        model = self._model(model_id, status="VALIDATED", version=version)
        model.update(
            health="OK",
            health_label="正常",
            health_css="active",
            health_note="模型訓練痕跡完整且 mAP50 達門檻。",
            map50=0.83,
            map50_threshold=0.5,
            nc=4,
            names_count=4,
            has_train_args=True,
            has_epoch=True,
            has_metrics=True,
            pass_eligible=True,
        )
        return model

    def _get_scene3(self, models, session_records=None):
        with self._patch_common(models):
            session = self.client.session
            session["vision_validation_records"] = session_records or []
            session.save()
            return self.client.get(
                reverse("learning:teacher_vision_center"),
                {"task": self.TASK, "scene": "3"},
            )

    # ---- 啟用 ----

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_activate_button_when_image_validation_done(self, _subs, _health):
        """2026-10-23 教師指令：恢復硬規則——模型通過 Live 啟用資格
        （activation_eligible：健康度 OK＋驗證通過且信心≥0.6＋類別四類）才出現
        「設為正式模型」按鈕。"""
        ready = self._ready_model()
        ready.update(activation_eligible=True, activation_min_confidence=0.6,
                     validation_pass_confidence=0.91)
        response = self._get_scene3([ready], [self._pass_record("PROP_ready")])
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, ">設為正式模型</button>")
        self.assertContains(
            response, reverse("learning:teacher_vision_center_activate")
        )
        self.assertTrue(response.context["settable_active_models"])
        self.assertNotContains(response, "暫無可啟用的模型")

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_activate_button_appears_only_when_eligible(self, _subs, _health):
        """2026-10-23 恢復硬規則：只有通過啟用資格（MATCH＋activation_eligible）
        才出現按鈕；MISMATCH／CHECK 一律不出現，也不得被教師覆寫。"""
        ok = self._ready_model("PROP_MATCH")
        ok.update(activation_eligible=True, activation_min_confidence=0.6,
                  validation_pass_confidence=0.91)
        response = self._get_scene3([ok], [self._pass_record("PROP_MATCH", "MATCH")])
        self.assertContains(response, ">設為正式模型</button>")
        row = next(m for m in response.context["scene3_models"]
                   if m["model_id"] == "PROP_MATCH")
        self.assertEqual(row["eligibility"], "ready")
        for verdict in ("MISMATCH", "CHECK"):
            model = self._ready_model("PROP_%s" % verdict)
            model.update(activation_eligible=False)
            response = self._get_scene3(
                [model], [self._pass_record("PROP_%s" % verdict, verdict)]
            )
            self.assertNotContains(response, ">設為正式模型</button>")
            self.assertEqual(response.context["settable_active_models"], [])
            row = next(
                m for m in response.context["scene3_models"]
                if m["model_id"] == "PROP_%s" % verdict
            )
            self.assertNotEqual(row["eligibility"], "ready")

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_no_activatable_model_shows_single_hint_and_no_button(self, _subs, _health):
        """從未做過圖片驗證：只出現一行提示，不出現任何按鈕。"""
        plain = self._model("PROP_plain", status="VALIDATED")
        response = self._get_scene3([plain])
        self.assertContains(response, "暫無可啟用的模型，請先完成圖片驗證並達到啟用門檻")
        self.assertEqual(response.context["settable_active_models"], [])
        self.assertNotContains(
            response, reverse("learning:teacher_vision_center_activate")
        )
        self.assertNotContains(response, ">設為正式模型</button>")

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_demo_imported_model_cannot_be_activated_by_teacher(self, _subs, _health):
        """2026-10-23 恢復硬規則：DEMO 放寬匯入模型不得啟用（activation_eligible=False），
        即使做過圖片驗證也不出現按鈕，杜絕覆寫後門。"""
        demo = self._ready_model("PROP_demo")
        demo.update(
            status="DEMO_IMPORTED",
            validation_status="DEMO_IMPORTED",
            demo_class_relaxed=True,
            activation_eligible=False,
        )
        response = self._get_scene3([demo], [self._pass_record("PROP_demo")])
        self.assertEqual(response.context["settable_active_models"], [])
        self.assertNotContains(response, ">設為正式模型</button>")
        row = next(m for m in response.context["scene3_models"]
                   if m["model_id"] == "PROP_demo")
        self.assertEqual(row["eligibility"], "unavailable")
        self.assertEqual(row["eligibility_label"], "不可用")

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_low_quality_model_cannot_be_activated_by_teacher(self, _subs, _health):
        """2026-10-23 恢復硬規則：低品質（mAP50 低於門檻）模型不得啟用
        （activation_eligible=False），按鈕不出現；事實寫在 hover 提示。"""
        low = self._ready_model("PROP_low")
        low.update(health="LOW_QUALITY", health_label="低品質", health_css="candidate",
                   map50=0.117, pass_eligible=False, activation_eligible=False)
        response = self._get_scene3([low], [self._pass_record("PROP_low")])
        self.assertEqual(response.context["settable_active_models"], [])
        self.assertNotContains(response, ">設為正式模型</button>")
        row = next(m for m in response.context["scene3_models"]
                   if m["model_id"] == "PROP_low")
        self.assertEqual(row["eligibility"], "unavailable")
        # 事實不得被藏起來：hover 提示仍載明健康度與 mAP50
        self.assertIn("健康度 低品質", row["eligibility_title"])
        self.assertIn("mAP50 0.117／門檻 0.5", row["eligibility_title"])

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_quarantined_model_never_gets_activate_button(self, _subs, _health):
        """唯一硬攔：已隔離（quarantined）模型連教師覆寫都不得啟用。"""
        quarantined = self._ready_model("PROP_quar")
        quarantined.update(quarantined=True)
        response = self._get_scene3(
            [quarantined], [self._pass_record("PROP_quar")]
        )
        self.assertEqual(response.context["settable_active_models"], [])
        self.assertNotContains(
            response, reverse("learning:teacher_vision_center_activate")
        )
        self.assertNotContains(response, ">設為正式模型</button>")
        row = next(m for m in response.context["scene3_models"]
                   if m["model_id"] == "PROP_quar")
        self.assertEqual(row["eligibility"], "unavailable")

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_health_ok_but_unverified_model_gets_no_activate_button(self, _subs, _health):
        """健康度 OK 但沒做過真實圖片驗證 → 仍不出現啟用按鈕（先看過再決定）。"""
        ready = self._ready_model()
        response = self._get_scene3([ready])
        self.assertEqual(response.context["settable_active_models"], [])
        self.assertNotContains(
            response, reverse("learning:teacher_vision_center_activate")
        )
        self.assertNotContains(response, ">設為正式模型</button>")
        row = next(m for m in response.context["scene3_models"]
                   if m["model_id"] == "PROP_ready")
        self.assertEqual(row["eligibility"], "needs_validation")

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_activate_confirm_dialog_lists_model_facts(self, _subs, _health):
        """確認框（vcActivate）只對通過啟用資格的模型出現，並說明硬規則、無法覆寫。"""
        ready = self._ready_model("PROP_ready")
        ready.update(activation_eligible=True, activation_min_confidence=0.6,
                     validation_pass_confidence=0.91)
        response = self._get_scene3([ready], [self._pass_record("PROP_ready")])
        self.assertContains(response, "vcActivate(")
        self.assertContains(response, "此模型已通過啟用資格檢核：")
        self.assertContains(response, "無法覆寫")

    # ---- 歸檔 ----
    @patch("learning.views.vision_api.archive_model")
    def test_archive_forwards_reason_and_reports_success(self, archive):
        archive.return_value = {
            "model_id": "PROP_1",
            "status": "ARCHIVED",
            "already_archived": False,
            "superseded_submission_id": "sub-1",
            "backup_path": "backups/x-archive-PROP_1",
        }
        with patch("learning.views._vision_mark_submission_superseded") as mark:
            response = self.client.post(
                reverse("learning:teacher_vision_center_archive_model"),
                {"task_id": self.TASK, "model_id": "PROP_1", "reason": "辨識品質不足"},
                follow=True,
            )
        self.assertContains(response, "已歸檔此模型")
        self.assertContains(response, "學員可重新上傳新模型")
        archive.assert_called_once_with(
            model_id="PROP_1", teacher_id=self.teacher.pk, reason="辨識品質不足"
        )
        mark.assert_called_once()
        self.assertEqual(mark.call_args.args[0], "sub-1")
        self.assertEqual(mark.call_args.kwargs["op"], "archive")

    @patch("learning.views.vision_api.archive_model")
    def test_archive_active_guard_error_is_explained(self, archive):
        archive.side_effect = RuntimeError(
            "vision_api_rejected:422:model_active_cannot_manage"
        )
        response = self.client.post(
            reverse("learning:teacher_vision_center_archive_model"),
            {"task_id": self.TASK, "model_id": "PROP_active"},
            follow=True,
        )
        self.assertContains(response, "歸檔失敗")
        self.assertContains(response, "狀態未變更")
        self.assertContains(response, "ACTIVE")
        self.assertContains(response, "不可歸檔或刪除")

    def test_archive_without_model_id_is_refused(self):
        response = self.client.post(
            reverse("learning:teacher_vision_center_archive_model"),
            {"task_id": self.TASK},
            follow=True,
        )
        self.assertContains(response, "缺少模型編號")

    # ---- 還原 ----
    @patch("learning.views.vision_api.restore_model")
    def test_restore_reports_restored_status(self, restore):
        restore.return_value = {"model_id": "PROP_archived", "status": "VALIDATED"}
        response = self.client.post(
            reverse("learning:teacher_vision_center_restore_model"),
            {"task_id": self.TASK, "model_id": "PROP_archived"},
            follow=True,
        )
        self.assertContains(response, "已還原模型")
        self.assertContains(response, "VALIDATED")
        restore.assert_called_once_with(
            model_id="PROP_archived", teacher_id=self.teacher.pk, reason=""
        )

    @patch("learning.views.vision_api.restore_model")
    def test_restore_clears_django_superseded_marker(self, restore):
        """M2：還原後 Django 端 Evidence 的 SUPERSEDED 標記必須同步回退。"""
        restore.return_value = {
            "model_id": "PROP_archived",
            "status": "VALIDATED",
            "unsuperseded_submission_id": "sub-1",
        }
        with patch("learning.views._vision_clear_submission_superseded") as clear:
            response = self.client.post(
                reverse("learning:teacher_vision_center_restore_model"),
                {"task_id": self.TASK, "model_id": "PROP_archived"},
                follow=True,
            )
        self.assertContains(response, "已還原模型")
        clear.assert_called_once_with("sub-1")

    # ---- 永久刪除 ----
    @patch("learning.views.vision_api.delete_model")
    def test_delete_without_confirmation_never_calls_backend(self, delete):
        response = self.client.post(
            reverse("learning:teacher_vision_center_delete_model"),
            {"task_id": self.TASK, "model_id": "PROP_1", "reason": "重複"},
            follow=True,
        )
        self.assertContains(response, "需要二次確認")
        delete.assert_not_called()

    @patch("learning.views.vision_api.delete_model")
    def test_delete_reports_shared_file_kept(self, delete):
        delete.return_value = {
            "model_id": "PROP_1",
            "record_removed": True,
            "file_removed": False,
            "shared_with": ["PROP_2", "sub-9"],
            "superseded_submission_id": None,
            "backup_path": "backups/x-delete-PROP_1",
        }
        with patch("learning.views._vision_mark_submission_superseded") as mark:
            response = self.client.post(
                reverse("learning:teacher_vision_center_delete_model"),
                {"task_id": self.TASK, "model_id": "PROP_1", "confirm_delete": "yes"},
                follow=True,
            )
        self.assertContains(response, "已永久刪除模型 PROP_1")
        self.assertContains(response, "仍被其他記錄共用")
        self.assertContains(response, "PROP_2")
        mark.assert_not_called()

    @patch("learning.views.vision_api.delete_model")
    def test_delete_success_marks_submission_superseded(self, delete):
        delete.return_value = {
            "model_id": "PROP_1",
            "record_removed": True,
            "file_removed": True,
            "shared_with": [],
            "superseded_submission_id": "sub-1",
            "backup_path": "backups/x-delete-PROP_1",
        }
        with patch("learning.views._vision_mark_submission_superseded") as mark:
            response = self.client.post(
                reverse("learning:teacher_vision_center_delete_model"),
                {"task_id": self.TASK, "model_id": "PROP_1", "confirm_delete": "yes"},
                follow=True,
            )
        self.assertContains(response, "記錄與 .pt 檔均已永久移除")
        mark.assert_called_once()
        self.assertEqual(mark.call_args.kwargs["op"], "delete")

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_archive_button_only_for_non_active_models(self, _subs, _health):
        """每個非 ACTIVE 模型都有歸檔按鈕；ACTIVE 不出現在主列表。"""
        active = self._model("PROP_active", status="ACTIVE")
        valid = self._model("PROP_valid", status="VALIDATED")
        rejected = self._model("PROP_rej", status="REJECTED", validation="REJECTED")
        response = self._get_scene3([active, valid, rejected])
        ids = [m["model_id"] for m in response.context["scene3_models"]]
        self.assertNotIn("PROP_active", ids)
        self.assertIn("PROP_valid", ids)
        self.assertIn("PROP_rej", ids)
        self.assertContains(response, ">歸檔</button>")
        self.assertNotContains(response, ">歸檔此模型<")

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_archived_models_are_not_listed_in_main_archive_area(self, _subs, _health):
        archived = self._archived_model()
        response = self._get_scene3([archived])
        self.assertEqual(
            [m["model_id"] for m in response.context["scene3_models"]], []
        )
        self.assertEqual(
            [m["model_id"] for m in response.context["archived_models"]],
            ["PROP_archived"],
        )

    # ---- 已移除的元素（隱藏不等於放行：直接從模板移除，不是 CSS 隱藏）----

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_removed_entries_and_long_notes_are_gone(self, _subs, _health):
        ready = self._ready_model()
        archived = self._archived_model()
        response = self._get_scene3([ready, archived], [self._pass_record("PROP_ready")])
        for gone in (
            "版本管理",
            "進階管理：永久刪除模型",
            "進入完整模型管理頁",
            "先驗證圖片",
            "DEMO 類別放寬",
            "尚未完成品質驗證",
            "本頁不保證",
            "PASS 條件不符，需覆核",
            "回復舊版本",
            'type="text" name="reason"',
        ):
            self.assertNotContains(response, gone)

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_single_merged_status_badge_per_model(self, _subs, _health):
        """每個模型只渲染一枚狀態徽章（可啟用／需驗證／不可用），不再並列多枚。"""
        ready = self._ready_model()
        ready.update(activation_eligible=True, activation_min_confidence=0.6,
                     validation_pass_confidence=0.91)
        plain = self._model("PROP_plain", status="VALIDATED")
        demo = self._ready_model("PROP_demo")
        demo.update(
            status="DEMO_IMPORTED", validation_status="DEMO_IMPORTED",
            activation_eligible=False,
        )
        quarantined = self._ready_model("PROP_quar")
        quarantined.update(quarantined=True)
        response = self._get_scene3(
            [ready, plain, demo, quarantined],
            [self._pass_record("PROP_ready"), self._pass_record("PROP_demo"),
             self._pass_record("PROP_quar")],
        )
        for row in response.context["scene3_models"]:
            self.assertIn(
                row["eligibility_label"],
                ("可啟用", "需驗證", "不可用"),
                row["model_id"],
            )
        self.assertContains(response, '>可啟用</span>')
        self.assertContains(response, '>需驗證</span>')
        self.assertContains(response, '>不可用</span>')
        # 絕不渲染 dict repr（regression：eligibility_label／eligibility_css 曾誤存成 dict）。
        # Django 自動跳脫會把單引號轉成 &#x27;，兩種形式都要擋。
        for leaked in ("{'ready'", '{"ready"', "&#x27;ready&#x27;",
                      "&#x27;active&#x27;", "&#x27;candidate&#x27;", "&#x27;rejected&#x27;"):
            self.assertNotContains(response, leaked)
        # 場景③內不再有獨立的「健康度：…」徽章；細節只出現在 hover 提示裡
        content = response.content.decode("utf-8")
        # 用 `data-scene="3">`（section 標籤）而不是 `data-scene="3"`，
        # 後者會先命中頂部導覽卡的 <a data-scene="3" href=...>。
        scene3 = content[
            content.index('data-scene="3">'):content.index('data-scene="4">')
        ]
        self.assertNotIn("健康度：", scene3)
        self.assertNotIn("類別不一致（DEMO 放行）", scene3)
        self.assertIn("mAP50 0.83／門檻 0.5", scene3)
        # 2026-10-23 恢復硬規則：ready 通過資格→「可啟用」；DEMO_IMPORTED 不得啟用→「不可用」
        self.assertIn('>可啟用</span>', scene3)
        self.assertIn('>不可用</span>', scene3)

    # ---- 權限 ----
    def test_student_cannot_call_management_endpoints(self):
        student = get_user_model().objects.create_user(
            username="vc-mgmt-student@example.test", password="Student-pass-901!"
        )
        self.client.force_login(student)
        for name in (
            "learning:teacher_vision_center_archive_model",
            "learning:teacher_vision_center_restore_model",
            "learning:teacher_vision_center_delete_model",
        ):
            response = self.client.post(reverse(name), {"model_id": "PROP_1"})
            self.assertIn(response.status_code, (302, 403), name)


class VisionCenterScene2PassCtaTests(VisionCenterOnlineTests):
    """場景②「測試通過 → 前往啟用正式模型」捷徑（教師指令 2026-10-22）。

    教師在②做完真實圖片驗證且判定通過（MATCH）後，要求結果下方直接出現
    通往③啟用正式模型的按鈕。

    鐵律：這個按鈕只是**場景導覽連結**（`<a href="?scene=3">`），
    不 POST、不切換 ACTIVE；能否啟用仍由場景③的完整判定把關
    （health=OK + VALIDATED + 真實圖片驗證 PASS + 非 DEMO_IMPORTED…）。
    """

    def _result(self, decision="MATCH", reason_code="OK"):
        label = {"MATCH": "通過", "MISMATCH": "不通過"}.get(decision, "需檢查")
        return {
            "task_id": self.TASK,
            "model_id": "PROP_1",
            "model_name": "模型 v1",
            "model_version": "v1",
            "predicted_class": "CW",
            "predicted_confidence": 0.91,
            "highest_confidence": 0.91,
            "confidence_threshold_used": 0.5,
            "verdict": decision,
            "verdict_label": label,
            "verdict_css": {"MATCH": "pass", "MISMATCH": "fail"}.get(decision, "check"),
            "verdict_reason_code": reason_code,
            "verdict_passed": decision == "MATCH",
            "verdict_cta_label": "測試通過" if decision == "MATCH" else label,
            "reason": "模型預測與教師標註相符。",
            "evidence_source": "REAL_INFERENCE",
        }

    def _get_scene2(self, models, session_result=None):
        with self._patch_common(models):
            session = self.client.session
            if session_result is None:
                session.pop("vision_center_result", None)
            else:
                session["vision_center_result"] = session_result
            session.save()
            return self.client.get(
                reverse("learning:teacher_vision_center"),
                {"task": self.TASK, "scene": "2"},
            )

    def _scene2(self, response):
        """切出場景② 的 <section> 本體。

        頁尾 <script> 裡的 JS 原始碼也含按鈕文字（由 JS 依 verdict 動態產生），
        因此「未通過時不得出現」必須在場景② 切片內斷言，否則會誤判。
        """
        content = response.content.decode("utf-8")
        return content[content.index('data-scene="2">'):content.index('data-scene="3">')]

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_pass_cta_shown_after_successful_image_validation(self, _subs, _health):
        """驗證通過（MATCH）時，場景②結果下方出現「測試通過 → 前往啟用正式模型」。"""
        response = self._get_scene2([self._model("PROP_1")], self._result("MATCH"))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "測試通過 → 前往啟用正式模型")
        self.assertContains(response, 'href="?task=PROP_DIRECTION&amp;scene=3"')
        # 結果卡與底部動作列各一處（AJAX 容器由 JS 依 verdict 顯示）
        self.assertGreaterEqual(
            response.content.decode("utf-8").count("測試通過 → 前往啟用正式模型"), 2
        )

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_cta_shown_for_any_verdict_with_honest_prefix(self, _subs, _health):
        """2026-10-22 教師指令：判定不符合要求也不再擋下，任何判定都出現捷徑，
        但按鈕前綴如實標示判定（需檢查／不通過），不假裝通過。"""
        for decision, prefix in (("CHECK", "需檢查"), ("MISMATCH", "不通過")):
            response = self._get_scene2(
                [self._model("PROP_1")], self._result(decision)
            )
            scene2 = self._scene2(response)
            self.assertIn("%s → 前往啟用正式模型" % prefix, scene2)
            self.assertNotIn("測試通過 →", scene2)

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_cta_absent_without_any_validation_result(self, _subs, _health):
        """從未做過驗證時只保留原本的「查看正式模型」，不出現任何啟用捷徑。"""
        response = self._get_scene2([self._model("PROP_1")], None)
        scene2 = self._scene2(response)
        self.assertNotIn("前往啟用正式模型", scene2)
        self.assertIn("查看正式模型 →", scene2)

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_pass_cta_hidden_without_any_validation_result(self, _subs, _health):
        """從未做過圖片驗證時不出現捷徑。"""
        response = self._get_scene2([self._model("PROP_1")], None)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("測試通過 → 前往啟用正式模型", self._scene2(response))
        self.assertIn("查看正式模型 →", self._scene2(response))

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_pass_cta_is_navigation_only_never_activates(self, _subs, _health):
        """捷徑只能是 <a> 導覽：不得夾帶 activate 表單或任何 POST 動作。"""
        response = self._get_scene2([self._model("PROP_1")], self._result("MATCH"))
        scene2 = self._scene2(response)
        self.assertIn("測試通過 → 前往啟用正式模型", scene2)
        idx = scene2.index("測試通過 → 前往啟用正式模型")
        # 只看捷徑前 200 字元（場景②裡本來就有圖片上傳的 <form>，不能全段比對）
        head = scene2[max(0, idx - 200):idx]
        self.assertIn("<a ", head)
        self.assertNotIn("teacher_vision_center_activate", head)
        self.assertNotIn("<form", head)
        self.assertNotIn("<button", head)
        # AJAX 容器在未通過前不得含有任何按鈕（容器只有 data-href）
        self.assertIn('id="vc-r-pass-cta"', scene2)
        self.assertIn("data-href=", scene2)

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_no_template_comment_leaks_into_page(self, _subs, _health):
        """Django 的 {# #} 註解**不支援多行**（lexer 未開 DOTALL）。

        多行註解會被當成正文輸出到頁面，教師會看到一排程式註解。
        此測試守住整頁不出現任何 `{#`。
        """
        response = self._get_scene2([self._model("PROP_1")], self._result("MATCH"))
        content = response.content.decode("utf-8")
        self.assertNotIn("{#", content)
        self.assertNotIn("#}", content)

    @patch("learning.views.vision_api.vision_api_health", return_value=(True, ""))
    @patch("learning.views.vision_api.list_submissions", return_value=[])
    def test_ajax_validate_payload_carries_verdict_passed(self, _subs, _health):
        """AJAX 驗證回應必須帶 verdict_passed，供前端即時顯示／隱藏捷徑。"""
        result = {
            "model": {"model_id": "PROP_1", "model_type": self.TASK, "version": "v1", "class_names": []},
            "detections": [{"class": "CW", "confidence": 0.9, "bbox": [10, 10, 30, 30]}],
            "detection_count": 1,
            "verdict": {
                "decision": "MATCH", "predicted_class": "CW", "predicted_confidence": 0.9,
                "max_confidence": 0.9,
                "expected_class": "CW", "reason": "相符", "reason_code": "OK", "rule_version": "v1",
                "confidence_threshold": 0.5,
            },
            "validated_at": "2026-10-22T10:00:00Z",
        }
        with self._patch_common([self._model("PROP_1")]), patch(
            "learning.views.vision_api.validate_image_with_model", return_value=result
        ):
            response = self.client.post(
                reverse("learning:teacher_vision_center_validate"),
                {
                    "task_id": self.TASK,
                    "model_id": "PROP_1",
                    "expected_class": "CW",
                    "test_image": SimpleUploadedFile("t.jpg", b"jpegbytes", content_type="image/jpeg"),
                },
                HTTP_X_REQUESTED_WITH="XMLHttpRequest",
            )
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.content)
        self.assertTrue(data["ok"])
        self.assertTrue(data["result"]["verdict_passed"])


class VisionCohortGuardTests(TestCase):
    """階段四 C：資源級班級隔離（單元層定向測試）。

    這裡刻意**覆寫**模組層的寬鬆 stub，逐一驗證 teacher_required 內的
    vision_resource_guard 在各種情況下都 fail-closed。
    """

    TASK = "PROP_DIRECTION"

    def setUp(self):
        self.teacher = get_user_model().objects.create_user(
            username="vc-cohort@example.test", password="Teacher-pass-901!", is_staff=True
        )
        self.client.login(username="vc-cohort@example.test", password="Teacher-pass-901!")

    def _post(self, name, payload):
        return self.client.post(reverse(name), payload)

    def test_foreign_student_submission_is_denied(self):
        with patch(
            "learning.views._vision_lookup_submission_student",
            side_effect=lambda submission_id, *, teacher_id: (True, "OTHER-STU-9999"),
        ):
            response = self._post(
                "learning:teacher_vision_center_validate_submission",
                {"task_id": self.TASK, "submission_id": "sub-x", "expected_class": "CW"},
            )
        self.assertEqual(response.status_code, 403)

    def test_same_cohort_submission_passes_guard(self):
        with patch(
            "learning.views._vision_lookup_submission_student",
            side_effect=lambda submission_id, *, teacher_id: (True, "DEMO-STU-0001"),
        ), patch("learning.views.vision_api.validate_image_with_submission") as validate:
            validate.side_effect = RuntimeError("vision_api_unavailable")
            response = self._post(
                "learning:teacher_vision_center_validate_submission",
                {"task_id": self.TASK, "submission_id": "sub-x", "expected_class": "CW"},
            )
        # 通過隔離檢查後才由視圖處理；此處 Live 不可用 → 走視圖自身的錯誤路徑（非 403 隔離）
        self.assertNotEqual(response.status_code, 403)

    def test_unknown_submission_is_denied(self):
        with patch(
            "learning.views._vision_lookup_submission_student",
            side_effect=lambda submission_id, *, teacher_id: (False, None),
        ):
            response = self._post(
                "learning:teacher_vision_center_import",
                {"task_id": self.TASK, "submission_id": "sub-does-not-exist"},
            )
        self.assertEqual(response.status_code, 403)

    def test_foreign_model_is_denied(self):
        with patch(
            "learning.views._vision_lookup_model_student",
            side_effect=lambda model_id, *, teacher_id, preferred_task: (True, "OTHER-STU-9999"),
        ):
            response = self._post(
                "learning:teacher_vision_center_activate",
                {"task_id": self.TASK, "model_id": "PROP_OTHER"},
            )
        self.assertEqual(response.status_code, 403)

    def test_teacher_uploaded_model_without_student_is_allowed(self):
        with patch(
            "learning.views._vision_lookup_model_student",
            side_effect=lambda model_id, *, teacher_id, preferred_task: (True, None),
        ), patch("learning.views.vision_api.activate_model") as activate:
            activate.side_effect = RuntimeError("activation_not_eligible")
            response = self._post(
                "learning:teacher_vision_center_activate",
                {"task_id": self.TASK, "model_id": "PROP_TEACHER_UPLOAD"},
            )
        self.assertNotEqual(response.status_code, 403)

    def test_live_unavailable_fails_closed(self):
        with patch(
            "learning.views._vision_lookup_submission_student",
            side_effect=RuntimeError("vision_api_unavailable"),
        ):
            response = self._post(
                "learning:teacher_vision_center_import",
                {"task_id": self.TASK, "submission_id": "sub-x"},
            )
        self.assertEqual(response.status_code, 403)

    def test_no_cohort_access_is_denied(self):
        with patch("learning.views.vision_visible_student_ids", side_effect=lambda user: set()):
            response = self._post(
                "learning:teacher_vision_center_import",
                {"task_id": self.TASK, "submission_id": "sub-x"},
            )
        self.assertEqual(response.status_code, 403)

    def test_superuser_is_not_restricted(self):
        get_user_model().objects.create_superuser(
            username="vc-root@example.test", password="Root-pass-901!", email="root@example.test"
        )
        self.client.logout()
        self.client.login(username="vc-root@example.test", password="Root-pass-901!")
        with patch("learning.views.vision_visible_student_ids", side_effect=lambda user: None), patch(
            "learning.views._vision_lookup_submission_student",
            side_effect=lambda submission_id, *, teacher_id: (False, None),
        ), patch("learning.views.vision_api.import_submission") as importer:
            importer.side_effect = RuntimeError("vision_api_unavailable")
            response = self._post(
                "learning:teacher_vision_center_import",
                {"task_id": self.TASK, "submission_id": "sub-x"},
            )
        self.assertNotEqual(response.status_code, 403)
