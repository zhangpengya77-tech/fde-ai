"""只在預覽環境資料庫（複本）建立預覽專用測試學員與登入 session，用來驗證閘道與模型端點（2026-11-08）。

安全保護：DATABASE_URL 必須指向 v2-live-camera 預覽環境，否則直接拒絕執行（避免誤寫正式資料庫）。
不設定任何可用密碼（set_unusable_password），只產生一次性的 session，輸出到指定檔案（不印在畫面上）。
用法（在 student_portal 目錄、已載入預覽 stack.env）：python make_preview_session.py <輸出檔>
"""
import os
import sys

if "v2-live-camera" not in os.environ.get("DATABASE_URL", ""):
    sys.exit("拒絕：DATABASE_URL 不是預覽環境資料庫")

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
sys.path.insert(0, os.getcwd())
import django  # noqa: E402

django.setup()
from django.conf import settings  # noqa: E402
from django.contrib.auth import BACKEND_SESSION_KEY, HASH_SESSION_KEY, SESSION_KEY, get_user_model  # noqa: E402
from django.contrib.sessions.backends.db import SessionStore  # noqa: E402

from learning.models import Cohort, Enrollment, StudentProfile  # noqa: E402

User = get_user_model()
email = "preview-livecam@preview.local"
user, made = User.objects.get_or_create(username=email, defaults={"email": email, "is_active": True})
if made:
    user.set_unusable_password()
    user.save()
profile = StudentProfile.objects.filter(user=user).first() or StudentProfile.objects.create(user=user, nickname="預覽測試學員", email=email)
cohort = Cohort.objects.filter(cohort_id="V2-A").first() or Cohort.objects.first()
Enrollment.objects.get_or_create(student=profile, cohort=cohort)
session = SessionStore()
session[SESSION_KEY] = str(user.pk)
session[BACKEND_SESSION_KEY] = settings.AUTHENTICATION_BACKENDS[0] if getattr(settings, "AUTHENTICATION_BACKENDS", None) else "django.contrib.auth.backends.ModelBackend"
session[HASH_SESSION_KEY] = user.get_session_auth_hash()
session.create()
with open(sys.argv[1], "w", encoding="utf-8") as handle:
    handle.write(f"{settings.SESSION_COOKIE_NAME}={session.session_key}")
print("預覽測試學員 session 已建立（只在預覽資料庫）")
