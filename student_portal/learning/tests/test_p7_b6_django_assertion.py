"""P7-B6（Django 側）：學員提交必須帶著「綁定 method/path/body 的學員 Assertion」。

修復前 ``submit_model_evidence_to_vision`` 送出時**完全沒有任何憑證**，Live 端也
沒有驗證，因此任何本機程序都能建立正式提交。本檔驗證兩件事：

1. 出站請求真的帶了 Assertion，且 claims 的 sub / role / enrollment_id /
   cohort_ids 來自資料庫關係，不是瀏覽器輸入；
2. Assertion 的 ``body_sha256`` 與實際送出的 bytes 完全一致（簽章綁 body），
   且 ``method`` / ``path`` 與真實請求一致（不是固定的 GET /）。
"""

from __future__ import annotations

import hashlib
import io
import json
from unittest.mock import patch

from django.test import TestCase, override_settings

from learning import live_assertions, vision_submission


TEST_KEY = "p7-b6-django-test-key"


class _FakeResponse(io.BytesIO):
    """最小可用的 urlopen 回應。"""

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False


@override_settings(
    FDE_LIVE_ASSERTION_KEY=TEST_KEY,
    VISION_SUBMISSION_API_BASE_URL="http://127.0.0.1:9",
)
class SubmitModelEvidenceAssertionTests(TestCase):
    def setUp(self):
        # internal_auth.shared_secret() 讀 settings 或環境變數，兩邊都對齊。
        self._env_patch = patch.dict("os.environ", {"FDE_INTERNAL_SHARED_SECRET": TEST_KEY})
        self._env_patch.start()
        self.addCleanup(self._env_patch.stop)

    def _capture(self, **kwargs):
        captured = {}

        def fake_urlopen(request, timeout=None):
            captured["request"] = request
            captured["timeout"] = timeout
            return _FakeResponse(json.dumps({"submission_id": "sub-x", "status": "SUBMITTED"}).encode())

        with patch.object(vision_submission, "urlopen", fake_urlopen):
            vision_submission.submit_model_evidence_to_vision(
                task_type="PROP_DIRECTION",
                student_id="FDE-2026-001",
                group_id="G1",
                growth_record_id=77,
                growth_record_slot="R07",
                evidence_reference="ev-1",
                evidence_type="YOLO_MODEL",
                original_filename="best.pt",
                content=b"weights",
                notes="n",
                **kwargs,
            )
        return captured

    def _claims(self, request):
        token = request.get_header("X-fde-live-assertion") or request.headers.get("X-FDE-Live-Assertion")
        self.assertTrue(token, "出站請求必須帶 X-FDE-Live-Assertion")
        return live_assertions.verify_assertion(token, TEST_KEY)

    def test_assertion_is_present_and_carries_student_identity(self):
        captured = self._capture(enrollment_id=42, cohort_ids=["2026-01"])
        claims = self._claims(captured["request"])
        self.assertEqual(claims["sub"], "student:FDE-2026-001")
        self.assertEqual(claims["role"], "student")
        self.assertEqual(claims["enrollment_id"], 42)
        self.assertEqual(claims["cohort_ids"], ["2026-01"])

    def test_assertion_is_bound_to_real_method_and_path(self):
        captured = self._capture(enrollment_id=42, cohort_ids=["2026-01"])
        claims = self._claims(captured["request"])
        self.assertEqual(claims["method"], "POST")
        self.assertEqual(claims["path"], "/api/v1/vision/submissions")
        # 禁止用固定 GET / 代表真實操作。
        self.assertNotEqual(claims["path"], "/")

    def test_assertion_body_hash_matches_the_bytes_actually_sent(self):
        captured = self._capture(enrollment_id=42, cohort_ids=["2026-01"])
        request = captured["request"]
        claims = self._claims(request)
        sent = request.data
        self.assertIsInstance(sent, (bytes, bytearray))
        self.assertEqual(claims["body_sha256"], hashlib.sha256(bytes(sent)).hexdigest())
        # 送出內容必須是學員身分的宣告，且不再夾帶可偽造的身分標頭。
        payload = json.loads(bytes(sent).decode("utf-8"))
        self.assertEqual(payload["student_id"], "FDE-2026-001")
        self.assertIsNone(request.get_header("X-fde-role"))
        self.assertIsNone(request.get_header("X-fde-teacher-id"))

    def test_missing_secret_does_not_silently_produce_unsigned_success(self):
        """未設定密鑰時不得送出「看起來成功」的請求。"""
        with patch.dict("os.environ", {}, clear=False):
            from django.conf import settings as dj_settings

            with override_settings(FDE_LIVE_ASSERTION_KEY="", FDE_GATEWAY_INTERNAL_AUTH_KEY=""):
                with patch("learning.internal_auth.shared_secret", return_value=""):
                    captured = self._capture(enrollment_id=42, cohort_ids=["2026-01"])
        request = captured["request"]
        self.assertIsNone(
            request.get_header("X-fde-live-assertion"),
            "無密鑰時不得簽出偽造的 Assertion（應由 Live 端 fail closed）",
        )
