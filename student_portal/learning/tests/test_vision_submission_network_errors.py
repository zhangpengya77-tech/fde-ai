"""任務 C（2026-10-20）：vision_submission 網路例外處理契約的隔離單元測試。

背景：`_post` / `_get` / `_delete` 原本只捕捉 `URLError, TimeoutError, json.JSONDecodeError`。
`ConnectionResetError`（WinError 10054）等 `OSError` 子類不在清單內，會直接逸出，
在 Django 視圖中變成 HTTP 500，而不是契約定義的 `RuntimeError("vision_api_unavailable")`。

本檔全部使用 `SimpleTestCase` + `urlopen` mock，**完全離線**：
不啟動任何服務、不連接任何端點、不讀寫資料庫。
"""

import io
import json
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from django.test import SimpleTestCase, override_settings

from learning import vision_submission


BASE = "http://127.0.0.1:9"  # 明確的死埠；因 urlopen 已被 mock，實際不會連線


class _ResponseRaisingOnRead:
    """模擬連線已建立但讀取時被對端重置（Windows 上即 WinError 10054）。"""

    def __init__(self, error):
        self._error = error

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def read(self):
        raise self._error


class _OkResponse:
    def __init__(self, payload):
        self._payload = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def read(self):
        return self._payload


@override_settings(
    VISION_SUBMISSION_API_BASE_URL=BASE,
    VISION_SUBMISSION_API_TIMEOUT_SECONDS=5,
)
class PostNetworkErrorContractTests(SimpleTestCase):
    """`_post` 必須把各類網路失敗統一轉為 RuntimeError("vision_api_unavailable")。"""

    def _assert_unavailable(self, side_effect):
        with patch.object(vision_submission, "urlopen", side_effect=side_effect):
            with self.assertRaises(RuntimeError) as ctx:
                vision_submission._post("/api/v1/vision/models", {"a": 1})
        self.assertEqual(str(ctx.exception), "vision_api_unavailable")

    def test_connection_reset_on_open_is_converted(self):
        """ConnectionResetError 於建立連線時拋出（修正前會逸出）。"""
        self._assert_unavailable(ConnectionResetError(10054, "遠端主機已強制關閉一個現存的連線。"))

    def test_connection_reset_on_read_is_converted(self):
        """ConnectionResetError 於 response.read() 時拋出（最貼近實際 10054 情境）。"""
        with patch.object(
            vision_submission,
            "urlopen",
            return_value=_ResponseRaisingOnRead(ConnectionResetError(10054, "reset during read")),
        ):
            with self.assertRaises(RuntimeError) as ctx:
                vision_submission._post("/api/v1/vision/models", {"a": 1})
        self.assertEqual(str(ctx.exception), "vision_api_unavailable")

    def test_generic_oserror_is_converted(self):
        """一般 OSError（非 URLError、非 ConnectionResetError）。"""
        self._assert_unavailable(OSError(10060, "連線嘗試失敗"))

    def test_broken_pipe_error_is_converted(self):
        """BrokenPipeError 也是 OSError 子類。"""
        self._assert_unavailable(BrokenPipeError(32, "pipe broken"))

    def test_urlerror_is_still_converted(self):
        """既有行為回歸：URLError 仍轉為 vision_api_unavailable。"""
        self._assert_unavailable(URLError("connection refused"))

    def test_timeout_is_still_converted(self):
        """既有行為回歸：TimeoutError 仍轉為 vision_api_unavailable。"""
        self._assert_unavailable(TimeoutError("timed out"))

    def test_http_error_keeps_rejection_contract(self):
        """既有契約不得被放寬：HTTPError 必須走 _rejected，而不是被當成「服務不可用」。"""
        body = io.BytesIO(
            json.dumps(
                {"error": {"code": "model_class_names_missing", "message": "模型缺少類別名稱"}}
            ).encode("utf-8")
        )
        http_error = HTTPError(f"{BASE}/api/v1/vision/models", 422, "Unprocessable", {}, body)
        with patch.object(vision_submission, "urlopen", side_effect=http_error):
            with self.assertRaises(vision_submission.VisionImportClassNamesMissing):
                vision_submission._post("/api/v1/vision/models", {"a": 1})

    def test_http_error_without_known_code_still_reports_rejection(self):
        """未知 4xx 仍保留原始代碼，不可退化成 vision_api_unavailable。"""
        body = io.BytesIO(json.dumps({"error": {"code": "some_other_error", "message": "x"}}).encode("utf-8"))
        http_error = HTTPError(f"{BASE}/api/v1/vision/models", 400, "Bad Request", {}, body)
        with patch.object(vision_submission, "urlopen", side_effect=http_error):
            with self.assertRaises(RuntimeError) as ctx:
                vision_submission._post("/api/v1/vision/models", {"a": 1})
        self.assertIn("vision_api_rejected:400", str(ctx.exception))

    def test_success_path_is_unchanged(self):
        """修正不得影響成功路徑。"""
        with patch.object(vision_submission, "urlopen", return_value=_OkResponse({"ok": True})):
            result = vision_submission._post("/api/v1/vision/models", {"a": 1})
        self.assertEqual(result, {"ok": True})


@override_settings(
    VISION_SUBMISSION_API_BASE_URL=BASE,
    VISION_SUBMISSION_API_TIMEOUT_SECONDS=5,
)
class OtherTransportNetworkErrorTests(SimpleTestCase):
    """`_get` / `_delete` / 提交證據的內聯 POST 共用同一契約。"""

    def test_get_connection_reset_is_converted(self):
        with patch.object(vision_submission, "urlopen", side_effect=ConnectionResetError(10054, "reset")):
            with self.assertRaises(RuntimeError) as ctx:
                vision_submission._get("/api/v1/vision/models")
        self.assertEqual(str(ctx.exception), "vision_api_unavailable")

    def test_delete_connection_reset_is_converted(self):
        with patch.object(vision_submission, "urlopen", side_effect=ConnectionResetError(10054, "reset")):
            with self.assertRaises(RuntimeError) as ctx:
                vision_submission._delete("/api/v1/vision/submissions/sub-x")
        self.assertEqual(str(ctx.exception), "vision_api_unavailable")

    def test_submit_model_evidence_connection_reset_is_converted(self):
        with patch.object(vision_submission, "urlopen", side_effect=ConnectionResetError(10054, "reset")):
            with self.assertRaises(RuntimeError) as ctx:
                vision_submission.submit_model_evidence_to_vision(
                    task_type="PROP_DIRECTION",
                    student_id="s-1",
                    group_id="g-1",
                    growth_record_id="gr-1",
                    growth_record_slot=1,
                    evidence_reference="ev-1",
                    evidence_type="model",
                    original_filename="best.pt",
                    content=b"not-a-real-model",
                )
        self.assertEqual(str(ctx.exception), "vision_submission_unavailable")
