"""P3H 第十階段：Gateway / Assertion 安全負向測試（真實 HTTP，非模擬）。

僅在隔離候選環境執行；所有密鑰取自已啟動的候選環境，不寫入檔案。
預設只跑非破壞性 N1–N10；加 `--failclosed` 才在最後停止 Django / Live 做
Fail Closed 探測（此模式會讓隔離棧失效，僅在收尾前使用）。

運行方式（需先以 start-p3h-isolated.ps1 啟動隔離棧）：
  python -c "import django; django.setup(); exec(open(r'ops/p3h/verify_p3h_security_negative.py',encoding='utf-8').read())"
  或直接：python ops/p3h/verify_p3h_security_negative.py [--failclosed]

前置環境變數：
  DJANGO_SETTINGS_MODULE=config.settings
  DJANGO_DB_NAME=<candidate>/p3h.sqlite3
  DJANGO_MEDIA_ROOT=<candidate>/media
  DJANGO_DEBUG=true
  P3H_ASSERTION_KEY=<與啟動一致的 Assertion 簽章金鑰>
  P3H_PROXY_KEY=<與啟動一致的 Proxy 金鑰（= GatewayKey）>
可選（預設指向 8140/8141/8142）：
  P3H_BASE / P3H_LIVE_BASE / P3H_DJANGO_BASE
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from http.cookiejar import CookieJar

ENTRY = os.environ.get("P3H_BASE", "http://127.0.0.1:8142").rstrip("/")
LIVE = os.environ.get("P3H_LIVE_BASE", "http://127.0.0.1:8141").rstrip("/")
# 未包閘道的原始 Live（app.main:app）；用來直接驗證 Live 身分邊界本身。
# 8141 是 gateway_main:app（閘道會剝除 x-fde-live-assertion / x-fde-proxy-auth），
# 故簽章/過期/aud-iss-sub 等測試必須打到這個原始 Live。
RAW = os.environ.get("P3H_LIVE_RAW_BASE", "http://127.0.0.1:8143").rstrip("/")
DJANGO = os.environ.get("P3H_DJANGO_BASE", "http://127.0.0.1:8140").rstrip("/")
ASSERTION_KEY = os.environ["P3H_ASSERTION_KEY"]
PROXY_KEY = os.environ["P3H_PROXY_KEY"]
CANDIDATE_ROOT = os.environ.get("P3H_CANDIDATE_ROOT", "")
TEST_PASSWORD = secrets.token_urlsafe(32)
FAILCLOSED = "--failclosed" in sys.argv

_HERE = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.dirname(os.path.dirname(_HERE))
sys.path.insert(0, os.path.join(_PROJECT_ROOT, "live_backend"))
sys.path.insert(0, os.path.join(_PROJECT_ROOT, "student_portal"))
from app.live_assertions import issue_live_assertion  # noqa: E402  (stdlib only)

import django  # noqa: E402
from django.apps import apps as django_apps  # noqa: E402

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
if not django_apps.ready:
    django.setup()

from django.contrib.auth import get_user_model  # noqa: E402
from learning.models import Cohort, Enrollment, LearningGroup, StudentProfile  # noqa: E402

RESULTS = []


def check(label, condition, detail=""):
    status = "PASS" if condition else "FAIL"
    RESULTS.append((label, status, detail))
    print(f"NEG {status} {label} {detail}".strip())
    return condition


def opener():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def rejecting_opener():
    return urllib.request.build_opener(_NoRedirect(), urllib.request.HTTPCookieProcessor(CookieJar()))


def request(op, url, data=None, headers=None, method=None):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with op.open(req, timeout=20) as resp:
            return resp.status, resp.read(), resp.geturl()
    except urllib.error.HTTPError as err:
        return err.code, err.read(), err.geturl()
    except urllib.error.URLError as err:
        return 0, str(err.reason).encode("utf-8", "replace"), url


def csrf(html):
    m = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', html)
    return m.group(1) if m else ""


def jar_cookie(op, name):
    for cookie in op.handlers[0].cookiejar if hasattr(op.handlers[0], "cookiejar") else []:
        if cookie.name == name:
            return cookie.value
    return ""


def cookie_value(op, name):
    for handler in op.handlers:
        jar = getattr(handler, "cookiejar", None)
        if jar is not None:
            for cookie in jar:
                if cookie.name == name:
                    return cookie.value
    return ""


def login(op, email):
    status, body, _ = request(op, ENTRY + "/login/")
    if status != 200:
        raise RuntimeError(f"login page status {status}")
    token = csrf(body.decode("utf-8", "replace"))
    status, body, url = request(
        op,
        ENTRY + "/login/",
        urllib.parse.urlencode({"csrfmiddlewaretoken": token, "username": email, "password": TEST_PASSWORD}).encode(),
        {"Content-Type": "application/x-www-form-urlencoded", "Origin": ENTRY, "Referer": ENTRY + "/login/"},
    )
    return status, url


def ensure_student(email, cohort_id, nickname):
    User = get_user_model()
    user, _ = User.objects.get_or_create(username=email, defaults={"email": email})
    user.email = email
    user.is_active = True
    user.set_password(TEST_PASSWORD)
    user.save()
    profile, _ = StudentProfile.objects.get_or_create(
        user=user,
        defaults={
            "nickname": nickname,
            "email": email,
            "account_type": StudentProfile.AccountType.STUDENT,
            "active": True,
        },
    )
    cohort, _ = Cohort.objects.get_or_create(cohort_id=cohort_id, defaults={"name": cohort_id, "active": True})
    group, _ = LearningGroup.objects.get_or_create(cohort=cohort, code="QA", defaults={"name": "QA", "active": True})
    enrollment, _ = Enrollment.objects.get_or_create(student=profile, cohort=cohort, defaults={"group": group, "active": True})
    return user, profile, enrollment, cohort


def _b64(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def sign_claims(payload, secret):
    """不覆寫任何 Claim 的原始簽章器：用來偽造錯誤 aud/iss 以驗證契約檢查。"""
    body = _b64(json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signature = _b64(hmac.new(secret.encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest())
    return f"{body}.{signature}"


def full_claims(claims, **override):
    now = int(time.time())
    payload = {
        "ver": "v1",
        "iss": "fde-v2-django",
        "aud": "fde-live",
        "iat": now,
        "exp": now + 60,
        "jti": secrets.token_urlsafe(18),
    }
    payload.update(claims)
    payload.update(override)
    return payload


def claims_for(profile, enrollment, cohort):
    return {
        "sub": f"student:{profile.pk}",
        "role": "student",
        "enrollment_id": enrollment.pk,
        "cohort_ids": [cohort.cohort_id],
    }


def direct_live(token, path="/api/live/sessions", method="POST", payload=None):
    data = json.dumps(payload if payload is not None else {"mode": "demo", "vision_source": "REAL_VISION"}).encode()
    return request(
        rejecting_opener(),
        RAW + path,
        data,
        {
            "Content-Type": "application/json",
            "X-FDE-Proxy-Auth": PROXY_KEY,
            "X-FDE-Live-Assertion": token,
        },
        method,
    )


def create_session(op):
    status, body, _ = request(
        op,
        ENTRY + "/api/live/sessions",
        json.dumps({"mode": "demo", "vision_source": "REAL_VISION"}).encode(),
        {"Content-Type": "application/json", "Origin": ENTRY},
    )
    sid = ""
    if status == 201:
        try:
            payload = json.loads(body)
            sid = payload.get("session_id") or payload.get("id") or payload.get("sid") or ""
        except ValueError:
            sid = ""
    return status, body, sid


def run_negative():
    a_user, a_profile, a_enr, a_cohort = ensure_student("p3hn-a@example.test", "P3H-N-A", "neg-a")
    b_user, b_profile, b_enr, b_cohort = ensure_student("p3hn-b@example.test", "P3H-N-B", "neg-b")
    a_claims = claims_for(a_profile, a_enr, a_cohort)
    b_claims = claims_for(b_profile, b_enr, b_cohort)
    print(f"NEG setup: A sub={a_claims['sub']} cohort={a_cohort.cohort_id}; B sub={b_claims['sub']} cohort={b_cohort.cohort_id}")

    # N1 過期 Assertion：以 120 秒前簽發（exp = now-60，已過期）
    expired = issue_live_assertion(a_claims, ASSERTION_KEY, now=int(time.time()) - 120)
    s, body, _ = direct_live(expired)
    check("N1 expired assertion rejected", s == 401, f"status={s}")

    # N2 簽章被竄改：翻轉最後一個字元
    valid = issue_live_assertion(a_claims, ASSERTION_KEY)
    flipped = ("A" if valid[-1] != "A" else "B")
    tampered = valid[:-1] + flipped
    s, body, _ = direct_live(tampered)
    check("N2 tampered signature rejected", s == 401, f"status={s}")

    # N3 audience 不符契約（以原始簽章器偽造 aud，避免 issue_live_assertion 覆寫）
    s, body, _ = direct_live(sign_claims(full_claims(a_claims, aud="fde-evil"), ASSERTION_KEY))
    check("N3 wrong audience rejected", s == 401, f"status={s}")

    # N4 issuer 不符契約（同上，偽造 iss）
    s, body, _ = direct_live(sign_claims(full_claims(a_claims, iss="evil-issuer"), ASSERTION_KEY))
    check("N4 wrong issuer rejected", s == 401, f"status={s}")

    # N5 subject 與 role 不符（sub 未以 role: 開頭）
    bad_sub = dict(a_claims, sub="teacher:999")
    s, body, _ = direct_live(issue_live_assertion(bad_sub, ASSERTION_KEY))
    check("N5 mismatched subject/role rejected", s == 401, f"status={s}")

    # N6 跨擁有者（跨 Cohort）：A 在原始 Live 建立 session，用 B 的合法 Assertion 存取 A 的 session
    a_token = issue_live_assertion(a_claims, ASSERTION_KEY)
    s, body, _ = direct_live(a_token, path="/api/live/sessions", method="POST")
    sid = ""
    if s == 201:
        try:
            payload = json.loads(body)
            sid = payload.get("session_id") or payload.get("id") or payload.get("sid") or ""
        except ValueError:
            sid = ""
    check("N6 precondition A create session (raw live)", s == 201 and bool(sid), f"status={s} sid={sid!r}")
    if sid:
        b_token = issue_live_assertion(b_claims, ASSERTION_KEY)
        s, body, _ = direct_live(b_token, path=f"/api/live/sessions/{sid}", method="GET")
        detail = body[:160].decode("utf-8", "replace")
        check("N6 cross-owner session access rejected", s == 403 and b"session_owner_required" in body, f"status={s} body={detail}")

    # N7 登出後舊 Session 無法再取得 Assertion
    op_out = opener()
    st, _ = login(op_out, "p3hn-a@example.test")
    s1, _, _ = create_session(op_out)
    token_csrf = cookie_value(op_out, "csrftoken")
    lo_status, _, _ = request(
        op_out,
        ENTRY + "/logout/",
        b"",
        {"Origin": ENTRY, "Referer": ENTRY + "/", "X-CSRFToken": token_csrf},
        "POST",
    )
    s2, _, _ = create_session(op_out)
    check("N7 logout invalidates old session", st == 200 and s1 == 201 and s2 in (401, 403), f"login={st} before={s1} logout={lo_status} after={s2}")

    # N8 惡意 Origin 於入口被拒（TRUSTED_ORIGINS 只含 127.0.0.1:8142）
    s, body, _ = request(
        rejecting_opener(),
        ENTRY + "/api/live/sessions",
        json.dumps({"mode": "demo", "vision_source": "REAL_VISION"}).encode(),
        {"Content-Type": "application/json", "Origin": "http://evil.example"},
    )
    check("N8 malicious origin rejected at entry", s == 403, f"status={s}")

    # N9 Django Assertion 端點在缺 CSRF token 時拒絕（即使帶正確 Gateway 金鑰）
    s, body, _ = request(
        rejecting_opener(),
        DJANGO + "/api/live/auth/assertion/",
        b"{}",
        {"Content-Type": "application/json", "X-FDE-Gateway-Auth": PROXY_KEY},
    )
    check("N9 assertion endpoint rejects missing CSRF", s == 403, f"status={s}")

    # N10 無效 Evidence 輸入不留下紀錄且不破壞 session
    if sid:
        a_token = issue_live_assertion(a_claims, ASSERTION_KEY)
        s_bad, body, _ = direct_live(
            a_token,
            path=f"/api/live/sessions/{sid}/training/evidence",
            payload={"evidence_type": "BOGUS_TYPE", "task_id": "TASK_01"},
        )
        s_get, _, _ = direct_live(a_token, path=f"/api/live/sessions/{sid}", method="GET")
        check(
            "N10 invalid evidence rejected, session intact",
            s_bad == 400 and s_get == 200,
            f"invalid={s_bad} session_get={s_get}",
        )


def run_failclosed():
    state_path = os.path.join(CANDIDATE_ROOT, "p3h-state.json") if CANDIDATE_ROOT else ""
    if not state_path or not os.path.isfile(state_path):
        check("N11 django offline fail-closed", False, "state file unavailable")
        check("N12 live offline fail-closed", False, "state file unavailable")
        return
    with open(state_path, "r", encoding="utf-8-sig") as fh:
        state = json.load(fh)
    pids = {svc["name"]: int(svc["listener_pid"]) for svc in state.get("services", [])}

    def kill(pid):
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, text=True)
        time.sleep(2.5)

    # N11：Django 離線 -> 閘道無法換 Assertion -> 503（Fail Closed）
    kill(pids["django"])
    s, body, _ = request(
        rejecting_opener(),
        ENTRY + "/api/live/sessions",
        json.dumps({"mode": "demo", "vision_source": "REAL_VISION"}).encode(),
        {"Content-Type": "application/json", "Origin": ENTRY},
    )
    detail = body[:160].decode("utf-8", "replace")
    check("N11 django offline fail-closed", s == 503, f"status={s} body={detail}")

    # N12：Live 離線 -> 入口無法連上游 -> 5xx（不洩漏內部）
    kill(pids["live"])
    s, body, _ = request(
        rejecting_opener(),
        ENTRY + "/api/live/sessions",
        json.dumps({"mode": "demo", "vision_source": "REAL_VISION"}).encode(),
        {"Content-Type": "application/json", "Origin": ENTRY},
    )
    detail = body[:160].decode("utf-8", "replace")
    check("N12 live offline fail-closed", s >= 500, f"status={s} body={detail}")


def main():
    if FAILCLOSED:
        run_failclosed()
    else:
        run_negative()
    passed = sum(1 for _, st, _ in RESULTS if st == "PASS")
    failed = sum(1 for _, st, _ in RESULTS if st == "FAIL")
    print(f"NEG_SUMMARY pass={passed} fail={failed} total={len(RESULTS)}")
    if failed:
        print("NEG_EXIT FAIL")
        sys.exit(1)
    print("NEG_EXIT PASS")


main()
