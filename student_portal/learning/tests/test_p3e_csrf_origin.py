"""P3-E（2026-10-25）：CSRF Origin 白名單的 Django 層回歸測試。

背景：`demo/tools/static_entry_server.py` 原本把瀏覽器送來的 Origin/Referer
**無條件改寫**成內部 Django 位址，使 Django 的 Origin 比對恆成立 —— 第二道防線
被整條中和。P3-E 改為「原樣轉發 + 明確白名單」，本檔驗證 Django 端的實際行為：

  1. 白名單內的來源 + 有效 CSRF token  → 放行（登入與 Assertion 交換都可用）。
  2. 白名單外的來源 + 有效 token        → 403（不得因 token 有效就放行）。
  3. 白名單內的來源 + 缺少 token        → 403（不得因 Origin 合法就放行）。
  4. Origin 等於請求 host（同源）       → 仍放行（既有行為不得回歸）。
  5. 只有 Referer、無 Origin            → 依 Referer 判定，同樣受白名單約束。

測試用 Origin 刻意選 `http://entry.example.test`（與 `testserver` 不同 host），
否則 Django 會因「同源」直接通過，測不到白名單本身。
"""

import json

from django.test import Client, TestCase, override_settings
from django.urls import reverse

from learning.live_assertions import verify_assertion
from learning.models import Cohort, TeacherCohortAccess
from learning.tests.helpers import create_student_account, enroll_student


ENTRY_ORIGIN = "http://entry.example.test"
EVIL_ORIGIN = "http://evil.example.test"
SIGNING_KEY = "p3e-test-signing-key"
GATEWAY_KEY = "p3e-test-gateway-key"

CSRF_SETTINGS = dict(
    CSRF_TRUSTED_ORIGINS=[ENTRY_ORIGIN],
    FDE_LIVE_ASSERTION_KEY=SIGNING_KEY,
    FDE_GATEWAY_INTERNAL_AUTH_KEY=GATEWAY_KEY,
    FDE_LIVE_ASSERTION_TTL_SECONDS=60,
    PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
)


@override_settings(**CSRF_SETTINGS)
class TrustedOriginLoginTests(TestCase):
    """學員登入在「入口來源」下必須可用，在惡意來源下必須被拒。"""

    def setUp(self):
        self.password = "A-strong-passphrase-984!"
        cohort = Cohort.objects.create(cohort_id="2099-P3E", name="P3-E 班級")
        self.student = create_student_account("p3e-login@example.test", "P3-E 學員")
        self.enrollment = enroll_student(self.student, cohort)
        self.login_url = reverse("learning:student_login")

    def _client_with_token(self):
        client = Client(enforce_csrf_checks=True)
        response = client.get(self.login_url, HTTP_HOST="testserver")
        self.assertEqual(response.status_code, 200)
        return client

    def _post_login(self, client, origin=None, referer=None, with_token=True, host="testserver"):
        extra = {"HTTP_HOST": host}
        if origin:
            extra["HTTP_ORIGIN"] = origin
        if referer:
            extra["HTTP_REFERER"] = referer
        if with_token:
            extra["HTTP_X_CSRFTOKEN"] = client.cookies["csrftoken"].value
        return client.post(
            self.login_url,
            {"username": "p3e-login@example.test", "password": self.password},
            **extra,
        )

    def test_trusted_origin_login_succeeds(self):
        client = self._client_with_token()
        response = self._post_login(client, origin=ENTRY_ORIGIN)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["Location"], reverse("learning:student_dashboard"))
        self.assertIn("_auth_user_id", client.session)

    def test_untrusted_origin_login_is_rejected(self):
        client = self._client_with_token()
        response = self._post_login(client, origin=EVIL_ORIGIN)
        self.assertEqual(response.status_code, 403)
        self.assertNotIn("_auth_user_id", client.session)

    def test_trusted_origin_without_csrf_token_is_rejected(self):
        client = self._client_with_token()
        response = self._post_login(client, origin=ENTRY_ORIGIN, with_token=False)
        self.assertEqual(response.status_code, 403)
        self.assertNotIn("_auth_user_id", client.session)

    def test_untrusted_origin_without_token_is_rejected(self):
        client = self._client_with_token()
        response = self._post_login(client, origin=EVIL_ORIGIN, with_token=False)
        self.assertEqual(response.status_code, 403)

    def test_same_origin_login_still_works(self):
        """Origin 與請求 host 相同時，Django 走同源分支，不受白名單影響。"""
        client = self._client_with_token()
        response = self._post_login(client, origin="http://testserver")
        self.assertEqual(response.status_code, 302)

    def test_referer_only_trusted_is_accepted(self):
        """無 Origin、只有 Referer 時仍可登入（此路徑在純 HTTP 下由 token 把關）。"""
        client = self._client_with_token()
        response = self._post_login(client, referer=f"{ENTRY_ORIGIN}/login/")
        self.assertEqual(response.status_code, 302)

    def test_referer_only_is_not_used_by_django_over_plain_http(self):
        """記錄 Django 的實際語意（不是我們的策略選擇）。

        Django 只在 `request.is_secure()` 為真時才比對 Referer；純 HTTP 請求若沒有
        Origin，就只剩 CSRF token 一道防線。因此「無 Origin 的跨站 POST」不能靠
        Django 的 Referer 檢查攔下 —— 這正是入口層 `_origin_gate` 必須同時檢查
        Referer 的原因（見 `demo/tools/static_entry_server.py`）。
        """
        client = self._client_with_token()
        response = self._post_login(client, referer=f"{EVIL_ORIGIN}/login/")
        self.assertEqual(response.status_code, 302)

    def test_origin_null_is_rejected(self):
        """沙箱 iframe / file:// 會送 Origin: null，必須被拒。"""
        client = self._client_with_token()
        response = self._post_login(client, origin="null")
        self.assertEqual(response.status_code, 403)


@override_settings(**CSRF_SETTINGS)
class TrustedOriginAssertionExchangeTests(TestCase):
    """Assertion 端點必須同時受 CSRF token 與來源白名單保護。"""

    def setUp(self):
        cohort = Cohort.objects.create(cohort_id="2099-P3E-A", name="P3-E 班級 A")
        self.student = create_student_account("p3e-assert@example.test", "P3-E 學員")
        self.enrollment = enroll_student(self.student, cohort)
        self.endpoint = reverse("learning:live_identity_assertion")

    def _client(self):
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.student.user)
        client.get(reverse("learning:live_session_auth"))
        return client

    def _post(self, client, *, origin=ENTRY_ORIGIN, with_token=True, gateway_key=GATEWAY_KEY):
        extra = {"HTTP_ORIGIN": origin}
        if with_token:
            extra["HTTP_X_CSRFTOKEN"] = client.cookies["csrftoken"].value
        if gateway_key is not None:
            extra["HTTP_X_FDE_GATEWAY_AUTH"] = gateway_key
        return client.post(
            self.endpoint,
            data=json.dumps({"enrollment_id": self.enrollment.pk}),
            content_type="application/json",
            **extra,
        )

    def test_trusted_origin_exchanges_assertion(self):
        response = self._post(self._client())
        self.assertEqual(response.status_code, 200)
        claims = verify_assertion(response.json()["assertion"], SIGNING_KEY)
        self.assertEqual(claims["sub"], f"student:{self.student.pk}")

    def test_untrusted_origin_cannot_exchange_assertion(self):
        response = self._post(self._client(), origin=EVIL_ORIGIN)
        self.assertEqual(response.status_code, 403)
        self.assertNotIn("application/json", response.get("Content-Type", ""))

    def test_trusted_origin_without_token_cannot_exchange_assertion(self):
        response = self._post(self._client(), with_token=False)
        self.assertEqual(response.status_code, 403)

    def test_trusted_origin_without_gateway_key_is_forbidden(self):
        response = self._post(self._client(), gateway_key=None)
        self.assertEqual(response.status_code, 403)
        self.assertNotIn("assertion", response.json())


class TrustedOriginSettingsGuardTests(TestCase):
    """settings 必須拒絕萬用字元來源（fail closed）。"""

    def test_wildcard_trusted_origin_raises_at_startup(self):
        import importlib
        import os
        from unittest.mock import patch

        from config import settings as config_settings

        with patch.dict(
            os.environ,
            {"DJANGO_CSRF_TRUSTED_ORIGINS": "https://*.example.test", "DJANGO_DEBUG": "true"},
            clear=False,
        ):
            with self.assertRaises(RuntimeError):
                importlib.reload(config_settings)
        # 還原為測試環境的設定，避免污染後續測試。
        importlib.reload(config_settings)

    def test_explicit_trusted_origin_is_accepted(self):
        import importlib
        import os
        from unittest.mock import patch

        from config import settings as config_settings

        with patch.dict(
            os.environ,
            {"DJANGO_CSRF_TRUSTED_ORIGINS": "https://demo.example.test", "DJANGO_DEBUG": "true"},
            clear=False,
        ):
            reloaded = importlib.reload(config_settings)
        self.assertIn("https://demo.example.test", reloaded.CSRF_TRUSTED_ORIGINS)
        importlib.reload(config_settings)
