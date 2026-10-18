"""DEMO-only：重設單一學員測試帳號密碼為隨機純英數臨時密碼。

授權範圍（2026-10-10）：
  - 僅 DEMO 隔離資料庫 `demo/runtime/db/demo.sqlite3`
  - 僅帳號 demo.student01@fde-demo.local
  - 使用 Django set_password
  - 純英數、長度 >= 12
  - 不改其他帳號、不改登入頁/Proxy/Cloudflare、不重啟正式服務

安全設計：
  - 三重護欄：路徑須在 demo/ 下；連線 DB 必須等於 DEMO DB；帳號必須存在且 is_staff=False
  - 新密碼**不寫入任何檔案、日誌或報告**
  - 新密碼以 UTF-8 寫入本機使用者專屬交付檔（權限僅本使用者可讀），
    並在 stdout 僅輸出遮罩後資訊
"""

from __future__ import annotations

import os
import secrets
import string
import sys
from pathlib import Path

DEMO_DB = Path(r"D:\FDE-AI-UAS-v2.0\demo\runtime\db\demo.sqlite3")
TARGET_EMAIL = "demo.student01@fde-demo.local"

# 新密碼交付位置：本機使用者專屬目錄（非專案、非 Git、非日誌）
DELIVERY_DIR = Path(os.path.expanduser("~")) / ".fde-demo-credentials"
DELIVERY_FILE = DELIVERY_DIR / "demo.student01.password.txt"

ALPHABET = string.ascii_letters + string.digits  # 純英數，無符號


def generate_password(length: int = 16) -> str:
    """產生純英數臨時密碼；保證含大寫、小寫、數字各至少一。"""
    while True:
        pwd = "".join(secrets.choice(ALPHABET) for _ in range(length))
        if (
            any(c.islower() for c in pwd)
            and any(c.isupper() for c in pwd)
            and any(c.isdigit() for c in pwd)
        ):
            return pwd


def guard_path() -> None:
    """護欄 1：DEMO DB 必須存在，且路徑必須位於 demo/ 之下。"""
    if not DEMO_DB.exists():
        raise SystemExit(f"[ABORT] DEMO DB not found: {DEMO_DB}")

    resolved = DEMO_DB.resolve()
    parts = [p.lower() for p in resolved.parts]
    if "fde-ai-uas-v2.0" not in parts or "demo" not in parts:
        raise SystemExit(f"[ABORT] DEMO DB path is not under demo/: {resolved}")

    # 明確拒絕正式 DB
    prod_db = Path(r"D:\FDE-AI-UAS-v2.0\student_portal\db.sqlite3").resolve()
    if resolved == prod_db:
        raise SystemExit("[ABORT] Refusing to operate on the production database.")

    print(f"[OK] Guard 1: target DB = {resolved}")


def main() -> int:
    guard_path()

    # 以 DEMO DB 設定 Django（僅此一個 DB）
    os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings"
    os.environ["DJANGO_DEBUG"] = "true"
    os.environ.pop("DATABASE_URL", None)
    os.environ["DJANGO_DB_NAME"] = str(DEMO_DB)

    sys.path.insert(0, r"D:\FDE-AI-UAS-v2.0\student_portal")

    import django

    django.setup()

    from django.conf import settings
    from django.contrib.auth import get_user_model

    # 護欄 2：Django 實際連線的 DB 必須等於 DEMO DB
    actual = Path(str(settings.DATABASES["default"]["NAME"])).resolve()
    if actual != DEMO_DB.resolve():
        raise SystemExit(f"[ABORT] Django is bound to {actual}, expected {DEMO_DB.resolve()}")
    print(f"[OK] Guard 2: Django connection DB = {actual}")

    User = get_user_model()

    # 護欄 3：帳號必須存在、非 staff、且為預期的學員帳號
    try:
        user = User.objects.get(email__iexact=TARGET_EMAIL)
    except User.DoesNotExist:
        raise SystemExit(f"[ABORT] Target account not found: {TARGET_EMAIL}")

    if user.is_staff or user.is_superuser:
        raise SystemExit("[ABORT] Target account is staff/superuser; refusing.")
    if user.username != TARGET_EMAIL:
        raise SystemExit(f"[ABORT] Unexpected username: {user.username}")

    print(f"[OK] Guard 3: account id={user.id} username={user.username} is_staff={user.is_staff}")

    # 記錄其他帳號的雜湊，用於事後證明未被更動
    others_before = {
        u.id: (u.username, u.password)
        for u in User.objects.exclude(id=user.id).order_by("id")
    }

    target_hash_before = user.password

    new_password = generate_password(16)
    user.set_password(new_password)
    user.save(update_fields=["password"])

    # 驗證
    user.refresh_from_db()
    ok = user.check_password(new_password)
    still_active = user.is_active
    others_after = {
        u.id: (u.username, u.password)
        for u in User.objects.exclude(id=user.id).order_by("id")
    }

    print(f"[RESULT] set_password verified = {ok}")
    print(f"[RESULT] is_active preserved   = {still_active}")
    print(f"[RESULT] password hash changed = {target_hash_before != user.password}")
    print(f"[RESULT] new password length   = {len(new_password)}")
    print(f"[RESULT] new password charset  = alphanumeric only = "
          f"{new_password.isalnum()}")
    print(f"[RESULT] other accounts unchanged = {others_before == others_after}")

    if not ok:
        raise SystemExit("[ABORT] Verification failed after set_password.")
    if others_before != others_after:
        raise SystemExit("[ABORT] Another account was modified. Investigate immediately.")

    # 安全交付：寫入本機使用者專屬檔（不出現在專案/Git/日誌）
    #
    # 2026-10-10 格式修訂（P0 核對發現）：
    #   舊格式寫成 `password: xxxx`，使用者在手機上容易連同「password: 」標籤
    #   一起複製或手抄，導致登入失敗（檢查 6 已逐一實測證實）。
    #   新格式把密碼「單獨放一行」，方便整行長按選取複製，且不再有標籤干擾。
    DELIVERY_DIR.mkdir(parents=True, exist_ok=True)
    import datetime

    content = (
        "# FDE-AI-UAS 2.0 DEMO 學員測試帳號（臨時密碼）\n"
        f"# 產生時間：{datetime.datetime.now().isoformat(timespec='seconds')}\n"
        "# 僅供 DEMO 展示使用\n"
        "#\n"
        "# 【手機登入操作】\n"
        "#   帳號：demo.student01@fde-demo.local\n"
        "#   密碼：請複製下方分隔線之間的整行內容，不要多選、不要含空白\n"
        "#\n"
        "---- 以下為密碼，複製這一行 ----\n"
        f"{new_password}\n"
        "---- 密碼結束 ----\n"
    )
    DELIVERY_FILE.write_text(content, encoding="utf-8")
    try:
        os.chmod(DELIVERY_FILE, 0o600)
    except OSError:
        pass

    print(f"[OK] Credential delivered to: {DELIVERY_FILE}")
    print(f"[OK] masked preview: {new_password[:2]}{'*' * (len(new_password) - 4)}{new_password[-2:]}")
    print("[OK] delivery format: password on its own line (copy-safe)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
