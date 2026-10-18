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
            "class_names": ["CW_F", "CCW_F", "CW_B", "CCW_B"],
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
        ① 學員模型 ② 圖片驗證 ③ 正式模型 ④ 下一輪資料飛輪。
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
            self.assertContains(response, "下一輪資料飛輪")
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
            "detections": [{"class": "CW_F", "confidence": 0.9, "bbox": [10, 10, 30, 30]}],
            "detection_count": 1,
            "verdict": {
                "decision": "MATCH", "predicted_class": "CW_F", "predicted_confidence": 0.9,
                "expected_class": "CW_F", "reason": "相符", "reason_code": "OK", "rule_version": "v1",
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
                    "expected_class": "CW_F",
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
        self.assertContains(response, "此版本尚未通過驗證，無法啟用")

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
                "class_names": ["CW_F", "CCW_F", "CW_B", "CCW_B"],
            },
            "detections": [
                {"class": "CW_F", "confidence": 0.9312, "bbox": [10, 10, 30, 30]},
                {"class": "CCW_F", "confidence": 0.8877, "bbox": [70, 10, 90, 30]},
            ],
            "detection_count": 2,
            "verdict": {
                "decision": "MATCH",
                "predicted_class": "CW_F",
                "predicted_confidence": 0.9312,
                "expected_class": "CW_F",
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
                    "expected_class": "CW_F",
                    "test_image": SimpleUploadedFile("t.jpg", b"jpegbytes", content_type="image/jpeg"),
                },
                follow=True,
            )
        self.assertEqual(response.status_code, 200)
        # 頁面會消費 session 中的結果並渲染；從渲染後的 context 取回。
        payload = response.context["validation_result"]
        self.assertIsNotNone(payload)
        self.assertEqual(payload["detection_count"], 2)
        self.assertEqual(payload["predicted_class"], "CW_F")
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
            "detections": [{"class": "CW_F", "confidence": 0.12, "bbox": [1, 1, 2, 2]}],
            "detection_count": 1,
            "verdict": {
                "decision": "INSUFFICIENT_DATA",
                "predicted_class": "CW_F",
                "predicted_confidence": 0.12,
                "expected_class": "CW_F",
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

    READY_PREFLIGHT = {"outcome": "ready", "class_names_actual": ["CW_F", "CCW_F", "CW_B", "CCW_B"], "class_names_expected": ["CW_F", "CCW_F", "CW_B", "CCW_B"]}

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

    @patch("learning.views.vision_api.create_dataset")
    @patch("learning.views.vision_api.import_submission")
    @patch("learning.views.vision_api.preflight_import")
    def test_import_failure_is_reported_in_full_without_auto_reject(self, preflight, import_sub, create_ds):
        """教師指令④⑤：完整顯示失敗原因，並告知提交未被自動駁回。"""
        create_ds.return_value = {"dataset_id": "ds-1", "dataset_version": "v1"}
        import_sub.side_effect = RuntimeError("vision_api_rejected:422:model_class_names_mismatch")
        preflight.return_value = dict(self.READY_PREFLIGHT)
        response = self.client.post(
            reverse("learning:teacher_vision_center_import"),
            {"task_id": self.TASK, "submission_id": "sub-bad"},
            follow=True,
        )
        self.assertContains(response, "導入失敗")
        self.assertContains(response, "model_class_names_mismatch")
        self.assertContains(response, "提交保持「待複核」，未被駁回")

    @patch("learning.views.vision_api.create_dataset")
    @patch("learning.views.vision_api.import_submission")
    @patch("learning.views.vision_api.preflight_import")
    def test_import_preflight_missing_class_names_tells_teacher_to_supply(self, preflight, import_sub, create_ds):
        """教師指令③：names 為空 → UI 提示「模型缺少類別名稱，請補充」，不駁回。"""
        preflight.return_value = {
            "outcome": "class_names_missing", "class_names_actual": [], "class_names_expected": ["CW_F", "CCW_F", "CW_B", "CCW_B"],
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

    @patch("learning.views.vision_api.create_dataset")
    @patch("learning.views.vision_api.import_submission")
    @patch("learning.views.vision_api.preflight_import")
    def test_import_preflight_count_mismatch_reports_both_counts(self, preflight, import_sub, create_ds):
        """類別數量不符 → 明確實際/預期數量，不駁回、不對照。"""
        preflight.return_value = {
            "outcome": "mismatch", "class_names_actual": ["A", "B"], "class_names_expected": ["CW_F", "CCW_F", "CW_B", "CCW_B"],
        }
        response = self.client.post(
            reverse("learning:teacher_vision_center_import"),
            {"task_id": self.TASK, "submission_id": "sub-count"},
            follow=True,
        )
        self.assertContains(response, "導入失敗")
        self.assertContains(response, "實際 2 類、預期 4 類")
        import_sub.assert_not_called()

    @patch("learning.views.vision_api.create_dataset")
    @patch("learning.views.vision_api.import_submission")
    @patch("learning.views.vision_api.preflight_import")
    def test_import_preflight_mapping_required_shows_mapping_form_without_side_effects(self, preflight, import_sub, create_ds):
        """教師指令③：數量一致名稱不同 → 對照表介面；不建資料集、不動提交。"""
        preflight.return_value = {
            "outcome": "mapping_required",
            "class_names_actual": ["CCW-F", "CCW-B", "CW-F", "CW-B"],
            "class_names_expected": ["CW_F", "CCW_F", "CW_B", "CCW_B"],
        }
        response = self.client.post(
            reverse("learning:teacher_vision_center_import"),
            {"task_id": self.TASK, "submission_id": "sub-2f8d"},
            follow=True,
        )
        self.assertContains(response, "類別名對照")
        self.assertContains(response, "CCW-F")
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
            "class_names_actual": ["CCW-F", "CCW-B", "CW-F", "CW-B"],
            "class_names_expected": ["CW_F", "CCW_F", "CW_B", "CCW_B"],
        }
        session.save()
        response = self.client.post(
            reverse("learning:teacher_vision_center_apply_mapping"),
            {
                "task_id": self.TASK,
                "map_0": "CCW_F", "map_1": "CCW_B", "map_2": "CW_F", "map_3": "CW_B",
            },
            follow=True,
        )
        self.assertContains(response, "已導入為候選模型")
        called_kwargs = import_sub.call_args.kwargs
        self.assertEqual(
            called_kwargs["class_name_mapping"],
            {"CCW-F": "CCW_F", "CCW-B": "CCW_B", "CW-F": "CW_F", "CW-B": "CW_B"},
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
            "class_names_actual": ["CCW-F", "CCW-B", "CW-F", "CW-B"],
            "class_names_expected": ["CW_F", "CCW_F", "CW_B", "CCW_B"],
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
                "map_0": "CCW_F", "map_1": "CCW_B", "map_2": "CW_F", "map_3": "CW_B",
            },
            follow=True,
        )
        self.assertNotContains(response, "對照表已過期")
        self.assertContains(response, "已導入為候選模型")
        called_kwargs = import_sub.call_args.kwargs
        self.assertEqual(
            called_kwargs["class_name_mapping"],
            {"CCW-F": "CCW_F", "CCW-B": "CCW_B", "CW-F": "CW_F", "CW-B": "CW_B"},
        )

    def test_apply_mapping_rejects_incomplete_mapping_and_keeps_form(self):
        """對照表不完整 → 拒絕導入並保留對照表供修正。"""
        session = self.client.session
        session["vision_class_name_mapping"] = {
            "submission_id": "sub-2f8d",
            "task_id": self.TASK,
            "class_names_actual": ["CCW-F", "CCW-B", "CW-F", "CW-B"],
            "class_names_expected": ["CW_F", "CCW_F", "CW_B", "CCW_B"],
        }
        session.save()
        response = self.client.post(
            reverse("learning:teacher_vision_center_apply_mapping"),
            {"task_id": self.TASK, "map_0": "CCW_F", "map_1": "CCW_B"},
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
        self.assertEqual(prop.context["class_options"], ["CW_F", "CCW_F", "CW_B", "CCW_B"])
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
                "class_names_actual": ["CCW-F", "CCW-B", "CW-F", "CW-B"],
                "class_names_expected": ["CW_F", "CCW_F", "CW_B", "CCW_B"],
            }
        })
        typed = vision_submission._rejected(self._http_error(body))
        self.assertIsInstance(typed, vision_submission.VisionImportClassNamesMappingRequired)
        self.assertEqual(typed.class_names_actual, ["CCW-F", "CCW-B", "CW-F", "CW-B"])
        self.assertEqual(typed.class_names_expected, ["CW_F", "CCW_F", "CW_B", "CCW_B"])

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
