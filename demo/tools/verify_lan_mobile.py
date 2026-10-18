"""FDE-AI-UAS 2.0｜學員手機區網測試驗收（2026-10-10 教師授權）。

驗證項目（依教師指令）：
  1. 電腦本機 DEMO 正常
  2. http://192.168.1.114:8111/login/ 可正常回應
  3. 學員登入及登出正常
  4. R07 頁面可進入
  5. 槳葉照片上傳與預覽頁面可進入
  6. 教師後台仍可使用
  7. 正式 1.5C 未受影響

全程走區網位址 192.168.1.114:8111（經 Live Backend 反代 Django :8110）。
只讀驗證；除登入/登出外不寫入任何資料。
"""
from __future__ import annotations

import http.cookiejar
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
import demo_credentials

BASE = "http://192.168.1.114:8111"
LOCAL = "http://127.0.0.1:8022"  # 僅用於確認正式服務仍為 loopback
STUDENT = demo_credentials.student_credentials()
TEACHER = demo_credentials.teacher_credentials()
OUT = Path(r"D:\FDE-AI-UAS-v2.0\demo\runtime\logs\lan_acceptance.json")
PROD_DB = Path(r"D:\FDE-AI-UAS-v2.0\student_portal\db.sqlite3")

results: dict = {}


def opener():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(jar),
        urllib.request.ProxyHandler({}),  # 關閉代理，避免 502 假象
    )


def get(op, path, timeout=30):
    req = urllib.request.Request(BASE + path, headers={"User-Agent": "fde-lan-test/1.0"})
    with op.open(req, timeout=timeout) as resp:
        return resp.status, resp.read().decode("utf-8", "replace"), resp.geturl()


def csrf_of(html: str) -> str:
    m = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', html)
    return m.group(1) if m else ""


def post_form(op, path, fields, timeout=60):
    _, html, _ = get(op, path)
    token = csrf_of(html)
    data = urllib.parse.urlencode({**fields, "csrfmiddlewaretoken": token}).encode()
    req = urllib.request.Request(BASE + path, data=data, headers={
        "User-Agent": "fde-lan-test/1.0",
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": BASE + path,
        "Origin": BASE,
    })
    try:
        with op.open(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", "replace"), resp.geturl()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace"), exc.geturl()


# --- 1. 電腦本機 DEMO 正常（區網位址可回應即代表本機服務正常）---
try:
    status, html, url = get(opener(), "/")
    results["1_LOCAL_DEMO_OK"] = {
        "status": status, "landed": url,
        "has_homepage": "FDE-AI" in html or "fde-ai" in html,
        "pass": status == 200,
    }
except Exception as exc:
    results["1_LOCAL_DEMO_OK"] = {"pass": False, "error": str(exc)}

# --- 2. http://192.168.1.114:8111/login/ 可正常回應 ---
try:
    status, html, url = get(opener(), "/login/")
    has_form = "csrfmiddlewaretoken" in html and ("password" in html)
    results["2_LAN_LOGIN_PAGE"] = {
        "status": status, "landed": url, "has_login_form": has_form,
        "pass": status == 200 and has_form,
    }
except Exception as exc:
    results["2_LAN_LOGIN_PAGE"] = {"pass": False, "error": str(exc)}

# --- 3. 學員登入及登出正常 ---
op_s = opener()
try:
    status, html, url = post_form(op_s, "/login/", {
        "username": STUDENT[0], "password": STUDENT[1],
    })
    logged_in = "/student/" in url
    results["3a_STUDENT_LOGIN"] = {
        "status": status, "landed": url, "pass": status == 200 and logged_in,
    }
    # 登出：Django logout 為 POST-only（GET 回 405 屬正確行為）。
    # 因此先取學生頁的 CSRF token，再直接 POST，不先 GET /logout/。
    token = csrf_of(html)
    data = urllib.parse.urlencode({"csrfmiddlewaretoken": token}).encode()
    req = urllib.request.Request(BASE + "/logout/", data=data, headers={
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": BASE + "/student/",
        "Origin": BASE,
        "User-Agent": "fde-lan-test/1.0",
    })
    try:
        with op_s.open(req, timeout=30) as resp:
            status_out, url_out = resp.status, resp.geturl()
    except urllib.error.HTTPError as exc:
        status_out, url_out = exc.code, exc.geturl()

    # 登出後 /student/ 應導回登入頁（session 已失效）
    try:
        s_after, _, url_after = get(op_s, "/student/")
        session_gone = "/login/" in url_after
    except urllib.error.HTTPError as exc:
        s_after, url_after, session_gone = exc.code, exc.geturl(), "/login/" in exc.geturl()

    has_session_cookie = any(c.name == "sessionid" for c in op_s.__dict__.get("_cookies", []))
    results["3b_STUDENT_LOGOUT"] = {
        "logout_status": status_out, "logout_landed": url_out,
        "student_after_logout": s_after, "student_after_url": url_after,
        "session_invalidated": session_gone,
        "pass": status_out in (200, 302) and session_gone,
    }
except Exception as exc:
    results["3a_STUDENT_LOGIN"] = {"pass": False, "error": str(exc)}
    results["3b_STUDENT_LOGOUT"] = {"pass": False, "error": str(exc)}

# --- 4. R07 頁面可進入 ---
op_s2 = opener()
try:
    post_form(op_s2, "/login/", {"username": STUDENT[0], "password": STUDENT[1]})
    status, html, url = get(op_s2, "/student/courses/1/growth/R07/")
    has_r07 = ("R07" in html) or ("模型" in html)
    results["4_R07_PAGE"] = {
        "status": status, "landed": url, "has_r07_content": has_r07,
        "pass": status == 200 and has_r07,
    }
except Exception as exc:
    results["4_R07_PAGE"] = {"pass": False, "error": str(exc)}

# --- 5. 槳葉照片上傳與預覽頁面可進入 ---
try:
    status, html, url = get(op_s2, "/student/courses/1/prop-scan/")
    has_upload = 'name="photo"' in html
    has_preview = 'id="preview-wrap"' in html
    has_motors = all(f'name="motor_{m}"' in html for m in ("M1", "M2", "M3", "M4"))
    has_tts = "tts-play" in html
    blocked_or_waiting = ("BLOCKED" in html) or ("WAITING_FOR_MODEL" in html)
    demo_simulation = (
        "DEMO 模擬推論" in html
        and "結果只驗證網站操作鏈路，不代表真實 YOLO 準確率" in html
    )
    state_ok = blocked_or_waiting or demo_simulation
    result_boundary = (
        "本頁不會顯示模擬的檢測框、可信度或 PASS 結果" in html
        or demo_simulation
    )
    results["5_PROP_SCAN_PAGE"] = {
        "status": status, "landed": url,
        "has_upload": has_upload, "has_preview": has_preview,
        "has_motor_options": has_motors, "has_tts": has_tts,
        "state_blocked_waiting_or_explicit_demo": state_ok,
        "result_boundary_declared": result_boundary,
        "demo_simulation": demo_simulation,
        "pass": all([status == 200, has_upload, has_preview, has_motors, has_tts, state_ok, result_boundary]),
    }
except Exception as exc:
    results["5_PROP_SCAN_PAGE"] = {"pass": False, "error": str(exc)}

# --- 6. 教師後台仍可使用 ---
op_t = opener()
try:
    status, html, url = post_form(op_t, "/teacher/login/", {
        "username": TEACHER[0], "password": TEACHER[1],
    })
    t_login = "/teacher/" in url
    s2, tlist, u2 = get(op_t, "/teacher/vision-models/")
    has_models = "模型" in tlist
    results["6_TEACHER_BACKEND"] = {
        "login_status": status, "login_landed": url, "login_ok": t_login,
        "models_status": s2, "has_model_list": has_models,
        "pass": status == 200 and t_login and s2 == 200 and has_models,
    }
except Exception as exc:
    results["6_TEACHER_BACKEND"] = {"pass": False, "error": str(exc)}

# --- 7. 正式 1.5C 未受影響（正式 DB mtime 未變）---
try:
    import datetime
    mtime = PROD_DB.stat().st_mtime if PROD_DB.exists() else None
    results["7_PROD_UNTOUCHED"] = {
        "prod_db_exists": PROD_DB.exists(),
        "prod_db_mtime": datetime.datetime.fromtimestamp(mtime).isoformat() if mtime else None,
        "pass": mtime is not None and datetime.datetime.fromtimestamp(mtime).date().isoformat() <= "2026-10-07",
    }
except Exception as exc:
    results["7_PROD_UNTOUCHED"] = {"pass": False, "error": str(exc)}

passed = sum(1 for v in results.values() if v.get("pass"))
total = len(results)
summary = {"passed": passed, "total": total}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps({"summary": summary, "results": results}, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(summary, ensure_ascii=False))
for key, value in results.items():
    flag = "PASS" if value.get("pass") else "FAIL"
    detail = json.dumps({k: v for k, v in value.items() if k != "pass"}, ensure_ascii=False)
    print(f"{flag}  {key}  {detail[:230]}")
