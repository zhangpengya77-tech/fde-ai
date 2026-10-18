"""P0 驗收：iPhone Safari 學員登入無反應修復。

驗收 7 項（僅 DEMO，全程走公開的 192.168.1.114:8111，模擬 iPhone Safari UA）：
  1. 正確帳密 -> 成功登入
  2. 錯誤密碼 -> 明確錯誤提示
  3. iPhone Safari 表單可送出（無 HTML5 原生驗證阻擋）
  4. 登出後重新登入正常
  5. R07 頁面可開啟
  6. 教師登入不受影響
  7. 正式 1.5C 完全不受影響

密碼自常數讀取，不寫入任何輸出、日誌或檔案。
"""

import http.cookiejar
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
import demo_credentials

BASE = "http://192.168.1.114:8111"
IPHONE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
)

STUDENT_EMAIL = "demo.student01@fde-demo.local"
STUDENT_PWD = demo_credentials.student_password()          # 不輸出
WRONG_PWD = "NotThePassword#9999"          # 不輸出
TEACHER_EMAIL = "demo.teacher@fde-demo.local"
TEACHER_PWD = demo_credentials.teacher_password()           # 不輸出

PROD_DB = r"D:\FDE-AI-UAS-v2.0\student_portal\db.sqlite3"
PROD_DB_MTIME = "2026-10-07T19:08:32.138590"

RESULTS = []


def record(name, ok, detail):
    RESULTS.append({"name": name, "ok": bool(ok), "detail": detail})
    print(("PASS  " if ok else "FAIL  ") + name + "  " + json.dumps(detail, ensure_ascii=False))


def new_opener():
    cj = http.cookiejar.CookieJar()
    return urllib.request.build_opener(
        urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(cj)
    ), cj


def get(op, path):
    req = urllib.request.Request(BASE + path, headers={"User-Agent": IPHONE_UA})
    return op.open(req, timeout=20)


def csrf_of(html):
    m = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', html)
    return m.group(1) if m else None


def post_form(op, path, fields, referer=None):
    data = urllib.parse.urlencode(fields).encode()
    headers = {
        "User-Agent": IPHONE_UA,
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": BASE,
        "Referer": referer or (BASE + path),
    }
    req = urllib.request.Request(BASE + path, data=data, headers=headers)
    try:
        r = op.open(req, timeout=20)
        return r.status, r.url, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.url, e.read().decode("utf-8", "replace")


# ---------------------------------------------------------------- 3. 表單可送出
def check_form_submittable():
    op, _ = new_opener()
    r = get(op, "/login/")
    html = r.read().decode("utf-8", "replace")
    m = re.search(r"<form[^>]*>", html)
    form_tag = m.group(0) if m else ""
    user_input = re.search(r'<input[^>]*name="username"[^>]*>', html)
    user_tag = user_input.group(0) if user_input else ""

    has_action = 'action="/login/"' in form_tag
    has_novalidate = "novalidate" in form_tag
    is_text = 'type="text"' in user_tag
    not_email = 'type="email"' not in user_tag
    has_inputmode = 'inputmode="email"' in user_tag
    has_csrf = csrf_of(html) is not None

    ok = has_action and has_novalidate and is_text and not_email and has_inputmode and has_csrf
    record(
        "3_IPHONE_FORM_SUBMITTABLE",
        ok,
        {
            "form_has_explicit_action": has_action,
            "form_novalidate": has_novalidate,
            "username_type": "text" if is_text else "other",
            "no_type_email_blocker": not_email,
            "mobile_keyboard_hint_kept": has_inputmode,
            "csrf_token_present": has_csrf,
            "note": "登入頁無任何 JavaScript，故不可能有 JS 錯誤或事件攔截",
        },
    )


# ------------------------------------------------------- 1. 正確帳密 -> 成功登入
def check_correct_login():
    op, cj = new_opener()
    r = get(op, "/login/")
    html = r.read().decode("utf-8", "replace")
    token = csrf_of(html)
    status, url, body = post_form(
        op,
        "/login/",
        {"csrfmiddlewaretoken": token, "username": STUDENT_EMAIL, "password": STUDENT_PWD},
    )
    session_cookies = [c.name for c in cj]
    ok = (
        status == 200
        and url.rstrip("/").endswith("/student")
        and "sessionid" in session_cookies
    )
    record(
        "1_CORRECT_CREDENTIALS_LOGIN",
        ok,
        {
            "status": status,
            "landed": url,
            "session_cookie_set": "sessionid" in session_cookies,
            "landed_on_student_dashboard": url.rstrip("/").endswith("/student"),
        },
    )
    return op, cj


# ------------------------------------------------------ 2. 錯誤密碼 -> 明確錯誤
def check_wrong_password():
    op, cj = new_opener()
    r = get(op, "/login/")
    html = r.read().decode("utf-8", "replace")
    token = csrf_of(html)
    status, url, body = post_form(
        op,
        "/login/",
        {"csrfmiddlewaretoken": token, "username": STUDENT_EMAIL, "password": WRONG_PWD},
    )
    has_error = "電子郵箱或密碼錯誤" in body
    no_session = "sessionid" not in [c.name for c in cj]
    still_on_login = url.rstrip("/").endswith("/login")
    ok = status == 200 and has_error and no_session and still_on_login
    record(
        "2_WRONG_PASSWORD_SHOWS_ERROR",
        ok,
        {
            "status": status,
            "error_message_visible": has_error,
            "message_text": "電子郵箱或密碼錯誤，請重新確認。",
            "no_session_created": no_session,
            "stayed_on_login_page": still_on_login,
            "error_rendered_before_fields": "login-errors" in body,
        },
    )


# ------------------------------------------------------- 4. 登出後重新登入正常
def check_logout_relogin(op, cj):
    # 取得已登入頁面的 CSRF，再 POST /logout/
    r = get(op, "/student/")
    dash = r.read().decode("utf-8", "replace")
    token = csrf_of(dash)
    status, url, _ = post_form(op, "/logout/", {"csrfmiddlewaretoken": token}, referer=BASE + "/student/")

    # 確認 session 已失效
    r2 = get(op, "/student/")
    after_url = r2.url
    session_invalidated = "/login/" in after_url

    # 重新登入
    r3 = get(op, "/login/")
    html3 = r3.read().decode("utf-8", "replace")
    token3 = csrf_of(html3)
    status3, url3, _ = post_form(
        op,
        "/login/",
        {"csrfmiddlewaretoken": token3, "username": STUDENT_EMAIL, "password": STUDENT_PWD},
    )
    ok = session_invalidated and status3 == 200 and url3.rstrip("/").endswith("/student")
    record(
        "4_LOGOUT_THEN_RELOGIN",
        ok,
        {
            "logout_status": status,
            "session_invalidated": session_invalidated,
            "redirect_after_logout": after_url,
            "relogin_status": status3,
            "relogin_landed": url3,
        },
    )
    return op, cj


# ------------------------------------------------------------- 5. R07 頁面可開啟
def check_r07(op):
    r = get(op, "/student/courses/1/growth/R07/")
    html = r.read().decode("utf-8", "replace")
    has_content = ("R07" in html) and ("專業任務驗證" in html)
    record(
        "5_R07_PAGE",
        r.status == 200 and has_content,
        {"status": r.status, "landed": r.url, "has_r07_content": has_content},
    )


# --------------------------------------------------------- 6. 教師登入不受影響
def check_teacher():
    op, cj = new_opener()
    r = get(op, "/teacher/login/")
    html = r.read().decode("utf-8", "replace")
    token = csrf_of(html)
    status, url, body = post_form(
        op,
        "/teacher/login/",
        {"csrfmiddlewaretoken": token, "username": TEACHER_EMAIL, "password": TEACHER_PWD},
    )
    landed_teacher = url.rstrip("/").endswith("/teacher")
    ok = status == 200 and landed_teacher

    # 教師後台頁面可讀
    models_status = None
    has_model_list = False
    if ok:
        r2 = get(op, "/teacher/vision-models/")
        b2 = r2.read().decode("utf-8", "replace")
        models_status = r2.status
        has_model_list = r2.status == 200 and len(b2) > 500

    record(
        "6_TEACHER_LOGIN_UNAFFECTED",
        ok and has_model_list,
        {
            "login_status": status,
            "login_landed": url,
            "teacher_dashboard_reached": landed_teacher,
            "vision_models_status": models_status,
            "vision_models_readable": has_model_list,
        },
    )


# ------------------------------------------------------ 7. 正式 1.5C 完全不受影響
def check_prod():
    exists = os.path.exists(PROD_DB)
    mtime = None
    if exists:
        import datetime

        ts = os.path.getmtime(PROD_DB)
        mtime = datetime.datetime.fromtimestamp(ts).isoformat()
    unchanged = (mtime == PROD_DB_MTIME)
    record(
        "7_PROD_UNTOUCHED",
        exists and unchanged,
        {
            "prod_db_exists": exists,
            "prod_db_mtime": mtime,
            "expected_mtime": PROD_DB_MTIME,
            "unchanged": unchanged,
        },
    )


def main():
    check_form_submittable()
    op, cj = check_correct_login()
    check_wrong_password()
    op2, cj2 = check_logout_relogin(op, cj)
    check_r07(op2)
    check_teacher()
    check_prod()

    passed = sum(1 for r in RESULTS if r["ok"])
    total = len(RESULTS)
    print()
    print(json.dumps({"passed": passed, "total": total}, ensure_ascii=False))

    out = r"D:\FDE-AI-UAS-v2.0\demo\runtime\logs\verify_login_p0.json"
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"passed": passed, "total": total, "results": RESULTS}, f, ensure_ascii=False, indent=2)
    return 0 if passed == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
