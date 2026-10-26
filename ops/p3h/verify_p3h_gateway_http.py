"""P3H：經 Entry 驗證 Django -> IdentityGateway -> Live Assertion 真實 HTTP 鏈。

僅在隔離環境執行；所有密鑰取自已啟動的候選環境，不寫入檔案。
運行方式（需先以 start-p3h-isolated.ps1 啟動隔離棧）：
  python -c "import django; django.setup(); exec(open(r'ops/p3h/verify_p3h_gateway_http.py',encoding='utf-8').read())"
前置環境變數：
  DJANGO_SETTINGS_MODULE=config.settings
  DJANGO_DB_NAME=<candidate>/p3h.sqlite3
  DJANGO_MEDIA_ROOT=<candidate>/media
  DJANGO_DEBUG=true
可選（預設指向 8140/8141/8142）：
  P3H_BASE / P3H_LIVE_BASE / P3H_DJANGO_BASE
"""
import json
import os
import re
import secrets
import urllib.error
import urllib.parse
import urllib.request
from http.cookiejar import CookieJar

ENTRY = os.environ.get("P3H_BASE", "http://127.0.0.1:8142").rstrip("/")
LIVE = os.environ.get("P3H_LIVE_BASE", "http://127.0.0.1:8141").rstrip("/")
DJANGO = os.environ.get("P3H_DJANGO_BASE", "http://127.0.0.1:8140").rstrip("/")
# 僅存在本程序記憶體；不寫入檔案、日誌或回應。
TEST_PASSWORD = secrets.token_urlsafe(32)


def opener():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def rejecting_opener():
    return urllib.request.build_opener(
        _NoRedirect(), urllib.request.HTTPCookieProcessor(CookieJar())
    )


def request(op, url, data=None, headers=None, method=None):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with op.open(req, timeout=20) as resp:
            return resp.status, resp.read(), resp.geturl()
    except urllib.error.HTTPError as err:
        return err.code, err.read(), err.geturl()


def csrf(html):
    m = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', html)
    assert m, "csrf token missing in login page"
    return m.group(1)


def login(op, path, email):
    status, body, _ = request(op, ENTRY + path)
    assert status == 200, (status, body[:200])
    token = csrf(body.decode("utf-8", "replace"))
    status, body, url = request(
        op,
        ENTRY + path,
        urllib.parse.urlencode(
            {"csrfmiddlewaretoken": token, "username": email, "password": TEST_PASSWORD}
        ).encode(),
        {"Content-Type": "application/x-www-form-urlencoded", "Origin": ENTRY, "Referer": ENTRY + path},
    )
    assert status == 200 and ("student" in url or "teacher" in url), (status, url)
    return token


from django.contrib.auth import get_user_model
from learning.models import Cohort, Enrollment, LearningGroup, StudentProfile


def ensure_student(email, cohort_id):
    User = get_user_model()
    user, _ = User.objects.get_or_create(username=email, defaults={"email": email})
    user.email = email
    user.is_active = True
    user.set_password(TEST_PASSWORD)
    user.save()
    profile, _ = StudentProfile.objects.get_or_create(
        user=user,
        defaults={
            "nickname": email.split("@")[0],
            "email": email,
            "account_type": StudentProfile.AccountType.STUDENT,
            "active": True,
        },
    )
    cohort, _ = Cohort.objects.get_or_create(cohort_id=cohort_id, defaults={"name": cohort_id, "active": True})
    group, _ = LearningGroup.objects.get_or_create(cohort=cohort, code="QA", defaults={"name": "QA", "active": True})
    Enrollment.objects.get_or_create(student=profile, cohort=cohort, defaults={"group": group, "active": True})
    return user, profile


def check(label, condition, detail=""):
    status = "PASS" if condition else "FAIL"
    print(f"CHAIN {status} {label} {detail}".strip())
    if not condition:
        raise AssertionError(f"{label} FAILED: {detail}")


# --- 準備隔離帳號（恰好 1 筆 enrollment，對應 Django Assertion 直接簽發路徑） ---
ensure_student("p3hg-student@example.test", "P3H-G")
print("CHAIN setup: isolated student ready")

# --- T1：health 經 entry（豁免路徑，驗證 entry -> gateway -> live 連通性） ---
s, _, _ = request(opener(), ENTRY + "/api/live/health")
check("T1 health via entry", s == 200, f"status={s}")

# --- 登入取得 session cookie ---
op = opener()
login(op, "/login/", "p3hg-student@example.test")

# --- T2：經 entry 建立 Live session（受保護路徑 -> gateway 向 Django 換 Assertion -> Live 接受） ---
s, body, _ = request(
    op,
    ENTRY + "/api/live/sessions",
    json.dumps({"mode": "demo", "vision_source": "REAL_VISION"}).encode(),
    {"Content-Type": "application/json", "Origin": ENTRY},
)
check("T2 create_session via gateway", s == 201, f"status={s} body={body[:200]!r}")
owner = (json.loads(body).get("owner_subject") or "") if s == 201 else ""
check("T2 owner is student", owner.startswith("student:"), f"owner_subject={owner!r}")

# --- T3：偽造 X-FDE-Role: teacher 經 entry -> gateway 剝除 -> Django 依真實身分簽發 student ---
s, body, _ = request(
    op,
    ENTRY + "/api/live/sessions",
    json.dumps({"mode": "demo", "vision_source": "REAL_VISION"}).encode(),
    {"Content-Type": "application/json", "Origin": ENTRY, "X-FDE-Role": "teacher", "X-FDE-Teacher-ID": "1"},
)
check("T3 forged X-FDE-Role stripped", s == 201, f"status={s} body={body[:200]!r}")
owner2 = (json.loads(body).get("owner_subject") or "") if s == 201 else ""
check("T3 still student (no escalation)", owner2.startswith("student:"), f"owner_subject={owner2!r}")

# --- T4：無 session cookie 經 entry -> gateway 向 Django 換 Assertion -> 被拒 ---
# 說明：Django 的 @csrf_protect 在視圖的 is_authenticated(401) 檢查「之前」執行；
# 無 session cookie 即無 CSRF token，故 Django 先回 403（CSRF），閘道如實映射為 403。
# 真實未認證請求絕不會拿到 200/201，安全閉環成立；此處接受 401 或 403 均視為「已拒絕」。
s, _, _ = request(
    rejecting_opener(),
    ENTRY + "/api/live/sessions",
    json.dumps({"mode": "demo", "vision_source": "REAL_VISION"}).encode(),
    {"Content-Type": "application/json", "Origin": ENTRY},
)
check("T4 unauthenticated via entry rejected", s in (401, 403), f"status={s}")

# --- T5：直連 Live/Gateway（無 session）建立 session -> 無身分 -> 403 ---
# 註：P3-H 後 Live 以 gateway_main:app 啟動，故直連 8141 即直連閘道本身；
# 無 session cookie 同 T4，Django @csrf_protect 先回 403，閘道如實映射為 403。
s, _, _ = request(
    rejecting_opener(),
    LIVE + "/api/live/sessions",
    json.dumps({"mode": "demo", "vision_source": "REAL_VISION"}).encode(),
    {"Content-Type": "application/json"},
)
check("T5 direct Live/Gateway without auth", s == 403, f"status={s}")

# --- T6：直連 Django assertion 端點（無 Gateway-Auth）-> 403 ---
s, _, _ = request(
    rejecting_opener(),
    DJANGO + "/api/live/auth/assertion/",
    b"{}",
    {"Content-Type": "application/json"},
)
check("T6 direct Django assertion without gateway key", s == 403, f"status={s}")

print("CHAIN_PASS full Django->Gateway->Live Assertion HTTP chain verified in isolation")
