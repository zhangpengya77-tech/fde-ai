"""P3-F（2026-10-25）：Django 側 Host 白名單與代理 HTTPS 判定的收斂測試。

三條規則：

  1. **DEBUG 不代表接受任意 Host**：移除原本 DEBUG 下的 `.trycloudflare.com`
     前導點預設，任何人開一條隧道就能打進本服務的情況不再成立。
  2. **不明確就不信任**：`*` 一律啟動失敗；正式模式不允許前導點子網域萬用字元；
     需要測試／隧道主機時只能逐條列出。
  3. **HTTPS 判定只在明確設定可信代理時成立**：`SECURE_PROXY_SSL_HEADER` 由
     `DJANGO_TRUST_PROXY_SSL_HEADER` 明確開啟，否則純 HTTP 部署不會被誤標為 HTTPS。

設定層用子進程探測（避免污染當前測試進程的 settings），請求層用真實 Host 標頭。
"""

import json
import os
import subprocess
import sys

from django.test import TestCase


SETTINGS_PROBE = (
    "import json; from config import settings; "
    "print(json.dumps({"
    "'debug': settings.DEBUG, "
    "'allowed_hosts': settings.ALLOWED_HOSTS, "
    "'csrf_origins': settings.CSRF_TRUSTED_ORIGINS, "
    "'proxy_ssl_header': settings.SECURE_PROXY_SSL_HEADER, "
    "'ssl_redirect': settings.SECURE_SSL_REDIRECT, "
    "'session_secure': settings.SESSION_COOKIE_SECURE, "
    "'csrf_cookie_secure': settings.CSRF_COOKIE_SECURE"
    "}))"
)

_PRODUCTION_ENV = {
    "DJANGO_SECRET_KEY": "p3f-probe-secret-not-real",
    "DJANGO_CSRF_TRUSTED_ORIGINS": "https://portal.example.test",
    "DATABASE_URL": "sqlite:///p3f-probe.sqlite3",
    "DJANGO_MEDIA_ROOT": "p3f-probe-media",
}


class HostAllowlistSettingsTests(TestCase):
    def probe(self, **overrides):
        environment = os.environ.copy()
        for name in (
            "DJANGO_DEBUG",
            "DJANGO_SECRET_KEY",
            "DJANGO_ALLOWED_HOSTS",
            "DJANGO_CSRF_TRUSTED_ORIGINS",
            "DJANGO_TRUST_PROXY_SSL_HEADER",
            "DATABASE_URL",
            "DJANGO_DB_NAME",
            "DJANGO_MEDIA_ROOT",
        ):
            environment.pop(name, None)
        environment.update(overrides)
        return subprocess.run(
            [sys.executable, "-c", SETTINGS_PROBE],
            check=False,
            capture_output=True,
            text=True,
            env=environment,
        )

    def settings_of(self, **overrides):
        result = self.probe(**overrides)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout.strip().splitlines()[-1])

    # ---------------------------------------------------------------- 規則 1
    def test_debug_default_no_longer_trusts_any_tunnel_host(self):
        settings = self.settings_of(DJANGO_DEBUG="true")
        self.assertTrue(settings["debug"])
        self.assertNotIn(
            ".trycloudflare.com",
            settings["allowed_hosts"],
            "DEBUG 預設不得再信任任何 trycloudflare 隧道主機",
        )
        self.assertFalse(
            any("trycloudflare" in host for host in settings["allowed_hosts"]),
            settings["allowed_hosts"],
        )

    def test_debug_default_only_covers_loopback(self):
        settings = self.settings_of(DJANGO_DEBUG="true")
        self.assertEqual(
            sorted(settings["allowed_hosts"]),
            sorted(["127.0.0.1", "localhost", "[::1]"]),
        )

    # ---------------------------------------------------------------- 規則 2
    def test_wildcard_allowed_hosts_fails_startup(self):
        result = self.probe(DJANGO_DEBUG="true", DJANGO_ALLOWED_HOSTS="*")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("DJANGO_ALLOWED_HOSTS", result.stderr)
        self.assertIn("wildcards are not allowed", result.stderr)

    def test_production_rejects_leading_dot_subdomain_wildcard(self):
        result = self.probe(
            DJANGO_DEBUG="false",
            DJANGO_ALLOWED_HOSTS=".trycloudflare.com",
            **_PRODUCTION_ENV,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("leading-dot", result.stderr)

    def test_production_accepts_explicit_hosts_only(self):
        settings = self.settings_of(
            DJANGO_DEBUG="false",
            DJANGO_ALLOWED_HOSTS="portal.example.test,portal.example.test:443",
            **_PRODUCTION_ENV,
        )
        self.assertEqual(
            settings["allowed_hosts"],
            ["portal.example.test", "portal.example.test:443"],
        )

    # ---------------------------------------------------------------- 規則 3
    def test_production_does_not_trust_forwarded_proto_by_default(self):
        settings = self.settings_of(
            DJANGO_DEBUG="false",
            DJANGO_ALLOWED_HOSTS="portal.example.test",
            **_PRODUCTION_ENV,
        )
        self.assertIsNone(
            settings["proxy_ssl_header"],
            "未明確設定可信代理時，Django 不得以 X-Forwarded-Proto 判定 HTTPS",
        )
        # 純 HTTP 部署因此不會被誤標為 HTTPS：仍會要求升級到 HTTPS。
        self.assertTrue(settings["ssl_redirect"])
        self.assertTrue(settings["session_secure"])
        self.assertTrue(settings["csrf_cookie_secure"])

    def test_production_trusts_forwarded_proto_only_when_explicitly_enabled(self):
        settings = self.settings_of(
            DJANGO_DEBUG="false",
            DJANGO_ALLOWED_HOSTS="portal.example.test",
            DJANGO_TRUST_PROXY_SSL_HEADER="true",
            **_PRODUCTION_ENV,
        )
        self.assertEqual(settings["proxy_ssl_header"], ["HTTP_X_FORWARDED_PROTO", "https"])
        # 明確開啟只影響「如何判定是否為 HTTPS」，不放寬任何 Cookie／CSRF 檢查。
        self.assertTrue(settings["session_secure"])
        self.assertTrue(settings["csrf_cookie_secure"])

    def test_debug_never_trusts_forwarded_proto(self):
        settings = self.settings_of(DJANGO_DEBUG="true", DJANGO_TRUST_PROXY_SSL_HEADER="true")
        self.assertIsNone(settings["proxy_ssl_header"])


class HostHeaderEnforcementTests(TestCase):
    """請求層：未授權 Host 由 Django 既有機制回 400（DisallowedHost）。"""

    def test_forged_host_is_rejected_with_400(self):
        response = self.client.get("/login/", HTTP_HOST="evil.example.test")
        self.assertEqual(response.status_code, 400)

    def test_tunnel_host_is_rejected_by_default(self):
        # 舊版 DEBUG 預設會放行任意 trycloudflare 主機，本輪必須拒絕。
        response = self.client.get("/login/", HTTP_HOST="attacker-abc.trycloudflare.com")
        self.assertEqual(response.status_code, 400)

    def test_allowed_host_passes(self):
        response = self.client.get("/login/", HTTP_HOST="127.0.0.1")
        self.assertNotEqual(response.status_code, 400)

    def test_allowed_host_with_port_passes(self):
        response = self.client.get("/login/", HTTP_HOST="127.0.0.1:8112")
        self.assertNotEqual(response.status_code, 400)
