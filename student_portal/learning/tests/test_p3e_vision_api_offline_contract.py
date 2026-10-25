"""P3-E（2026-10-25）：Vision API 離線錯誤處理的邊界回歸測試。

本檔補足 `test_vision_submission_network_errors.py` 未覆蓋的兩類邊界：

1. **不得過度吞錯**：只有 `OSError` 家族（連線重設／拒絕／逾時）才轉為
   `vision_api_unavailable`；程式錯誤（`TypeError`、`ValueError`、`KeyError`）
   必須照原樣逸出，否則真正的 bug 會被誤報成「服務不可用」而永遠查不到。
2. **視圖層契約**：傳輸層把網路失敗轉成 `RuntimeError("vision_api_unavailable")`
   之後，教師頁的 `_vision_record_import_failure` 必須吞掉它並照常顯示訊息，
   不得變成 HTTP 500。這是 2026-10-25 兩個不穩定測試的真正根因。

全部使用 `SimpleTestCase` + mock，**完全離線**：不啟動服務、不連線、不讀寫資料庫。
"""

import socket
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from learning import vision_submission


BASE = "http://127.0.0.1:9"  # 明確死埠；urlopen 已被 mock，實際不會連線


def _fake_request(pk=1):
    """最小 request 替身：`_vision_record_import_failure` 只用到 `request.user.pk`。"""
    return SimpleNamespace(user=SimpleNamespace(pk=pk))


@override_settings(
    VISION_SUBMISSION_API_BASE_URL=BASE,
    VISION_SUBMISSION_API_TIMEOUT_SECONDS=5,
)
class NetworkFailureNarrowingTests(SimpleTestCase):
    """只有網路類 OSError 可被轉換；程式錯誤必須原樣逸出。"""

    def test_connection_refused_is_converted(self):
        """ConnectionRefusedError（WinError 10061）：對端無監聽。"""
        with patch.object(
            vision_submission, "urlopen", side_effect=ConnectionRefusedError(10061, "refused")
        ):
            with self.assertRaises(RuntimeError) as ctx:
                vision_submission._post("/api/v1/vision/models", {"a": 1})
        self.assertEqual(str(ctx.exception), "vision_api_unavailable")

    def test_socket_timeout_is_converted(self):
        """socket.timeout 是 TimeoutError 的別名，必須走同一契約。"""
        with patch.object(vision_submission, "urlopen", side_effect=socket.timeout("timed out")):
            with self.assertRaises(RuntimeError) as ctx:
                vision_submission._post("/api/v1/vision/models", {"a": 1})
        self.assertEqual(str(ctx.exception), "vision_api_unavailable")

    def test_type_error_is_not_swallowed(self):
        """程式錯誤（TypeError）不得被當成「服務不可用」。"""
        with patch.object(vision_submission, "urlopen", side_effect=TypeError("bad argument")):
            with self.assertRaises(TypeError):
                vision_submission._post("/api/v1/vision/models", {"a": 1})

    def test_value_error_is_not_swallowed(self):
        """程式錯誤（ValueError）不得被當成「服務不可用」。"""
        with patch.object(vision_submission, "urlopen", side_effect=ValueError("bad value")):
            with self.assertRaises(ValueError):
                vision_submission._post("/api/v1/vision/models", {"a": 1})

    def test_key_error_is_not_swallowed(self):
        """程式錯誤（KeyError）不得被當成「服務不可用」。"""
        with patch.object(vision_submission, "urlopen", side_effect=KeyError("missing")):
            with self.assertRaises(KeyError):
                vision_submission._get("/api/v1/vision/models")

    def test_non_oserror_runtime_error_is_not_reinterpreted(self):
        """已明確的 RuntimeError 不得被改寫成 vision_api_unavailable。"""
        with patch.object(
            vision_submission, "urlopen", side_effect=RuntimeError("some_programming_bug")
        ):
            with self.assertRaises(RuntimeError) as ctx:
                vision_submission._post("/api/v1/vision/models", {"a": 1})
        self.assertEqual(str(ctx.exception), "some_programming_bug")


class RecordImportFailureSwallowsTransportErrorTests(SimpleTestCase):
    """`_vision_record_import_failure` 必須吞掉傳輸層的 RuntimeError，避免 500。

    這是 2026-10-25 兩個不穩定測試（`test_import_preflight_*`）的根因：
    修正前 `ConnectionResetError`（OSError）不在 `except RuntimeError` 之內，
    會直接逸出成 HTTP 500；修正後傳輸層先轉成 RuntimeError，才會被吞掉。
    """

    def test_record_import_failure_swallows_vision_api_unavailable(self):
        from learning import views

        request = _fake_request()
        with patch.object(
            views.vision_api,
            "record_import_failure",
            side_effect=RuntimeError("vision_api_unavailable"),
        ) as mocked:
            views._vision_record_import_failure(request, "sub-1", "msg", "code")
        mocked.assert_called_once()
        self.assertEqual(mocked.call_args.kwargs["teacher_id"], 1)

    def test_record_import_failure_still_raises_programming_error(self):
        """不得因為「吞例外」而把真正的程式錯誤一併吞掉。"""
        from learning import views

        request = _fake_request()
        with patch.object(
            views.vision_api, "record_import_failure", side_effect=AttributeError("typo")
        ):
            with self.assertRaises(AttributeError) as ctx:
                views._vision_record_import_failure(request, "sub-1", "msg", "code")
        self.assertEqual(str(ctx.exception), "typo")

    def test_record_import_failure_noop_without_submission_id(self):
        from learning import views

        request = _fake_request()
        with patch.object(views.vision_api, "record_import_failure") as mocked:
            views._vision_record_import_failure(request, "", "msg", "code")
        mocked.assert_not_called()
