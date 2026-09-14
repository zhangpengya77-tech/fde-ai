import json
import os
import subprocess
import sys

from django.test import SimpleTestCase


SETTINGS_PROBE = (
    "import json; from config import settings; "
    "print(json.dumps({"
    "'debug': settings.DEBUG, "
    "'db_engine': settings.DATABASES['default']['ENGINE'], "
    "'email_backend': settings.EMAIL_BACKEND, "
    "'email_host': settings.EMAIL_HOST, "
    "'email_port': settings.EMAIL_PORT, "
    "'email_host_user': settings.EMAIL_HOST_USER, "
    "'email_use_tls': settings.EMAIL_USE_TLS, "
    "'default_from_email': settings.DEFAULT_FROM_EMAIL, "
    "'allowed_hosts': settings.ALLOWED_HOSTS, "
    "'csrf_origins': settings.CSRF_TRUSTED_ORIGINS, "
    "'media_root': str(settings.MEDIA_ROOT), "
    "'ssl_redirect': getattr(settings, 'SECURE_SSL_REDIRECT', False), "
    "'session_secure': settings.SESSION_COOKIE_SECURE, "
    "'static_root': str(getattr(settings, 'STATIC_ROOT', ''))"
    "}))"
)


class DeploymentSettingsTests(SimpleTestCase):
    def probe(self, **overrides):
        environment = os.environ.copy()
        for name in (
            "DJANGO_DEBUG",
            "DJANGO_SECRET_KEY",
            "DJANGO_ALLOWED_HOSTS",
            "DJANGO_CSRF_TRUSTED_ORIGINS",
            "DATABASE_URL",
            "DJANGO_DB_NAME",
            "DJANGO_MEDIA_ROOT",
            "DJANGO_EMAIL_BACKEND",
            "DJANGO_EMAIL_HOST",
            "DJANGO_EMAIL_PORT",
            "DJANGO_EMAIL_HOST_USER",
            "DJANGO_EMAIL_HOST_PASSWORD",
            "DJANGO_EMAIL_USE_TLS",
            "DEFAULT_FROM_EMAIL",
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

    def test_development_keeps_console_mail_and_local_sqlite(self):
        result = self.probe(DJANGO_DEBUG="true")

        self.assertEqual(result.returncode, 0, result.stderr)
        settings = json.loads(result.stdout)
        self.assertTrue(settings["debug"])
        self.assertEqual(settings["db_engine"], "django.db.backends.sqlite3")
        self.assertEqual(
            settings["email_backend"],
            "django.core.mail.backends.console.EmailBackend",
        )
        self.assertFalse(settings["ssl_redirect"])

    def test_production_uses_env_database_and_persistent_media_configuration(self):
        media_root = os.path.join(os.getcwd(), ".tmp", "persistent-media")
        result = self.probe(
            DJANGO_DEBUG="false",
            DJANGO_SECRET_KEY="test-only-not-a-real-secret-key-with-adequate-length",
            DJANGO_ALLOWED_HOSTS="portal.example.test",
            DJANGO_CSRF_TRUSTED_ORIGINS="https://portal.example.test",
            DATABASE_URL="postgres://fde:test-password@localhost/fde",
            DJANGO_MEDIA_ROOT=media_root,
            DJANGO_EMAIL_BACKEND="django.core.mail.backends.smtp.EmailBackend",
            DJANGO_EMAIL_HOST="smtp.gmail.com",
            DJANGO_EMAIL_PORT="587",
            DJANGO_EMAIL_HOST_USER="qa@example.test",
            DJANGO_EMAIL_HOST_PASSWORD="not-a-real-secret",
            DJANGO_EMAIL_USE_TLS="true",
            DEFAULT_FROM_EMAIL="FDE-AI <qa@example.test>",
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        settings = json.loads(result.stdout)
        self.assertFalse(settings["debug"])
        self.assertEqual(settings["db_engine"], "django.db.backends.postgresql")
        self.assertEqual(settings["email_backend"], "django.core.mail.backends.smtp.EmailBackend")
        self.assertEqual(settings["email_host"], "smtp.gmail.com")
        self.assertEqual(settings["email_port"], 587)
        self.assertEqual(settings["email_host_user"], "qa@example.test")
        self.assertTrue(settings["email_use_tls"])
        self.assertEqual(settings["default_from_email"], "FDE-AI <qa@example.test>")
        self.assertIn("portal.example.test", settings["allowed_hosts"])
        self.assertEqual(settings["csrf_origins"], ["https://portal.example.test"])
        self.assertEqual(settings["media_root"], media_root)
        self.assertTrue(settings["ssl_redirect"])
        self.assertTrue(settings["session_secure"])
        self.assertTrue(settings["static_root"].endswith("staticfiles"))
        self.assertNotIn("test-password", result.stdout)
        self.assertNotIn("not-a-real-secret", result.stdout)

    def test_production_refuses_to_use_ephemeral_default_media_directory(self):
        result = self.probe(
            DJANGO_DEBUG="false",
            DJANGO_SECRET_KEY="test-only-not-a-real-secret-key-with-adequate-length",
            DJANGO_ALLOWED_HOSTS="portal.example.test",
            DJANGO_CSRF_TRUSTED_ORIGINS="https://portal.example.test",
            DATABASE_URL="postgres://fde:test-password@localhost/fde",
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("DJANGO_MEDIA_ROOT", result.stderr)
