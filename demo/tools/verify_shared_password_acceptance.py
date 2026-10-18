"""DEMO-only：學生／教師共用測試密碼的完整驗收（唯讀，不修改任何資料）。

驗收項目（對應指令第五節）：
  1. 學生使用共同密碼可登入 /student/
  2. 教師使用共同密碼可登入 /teacher/
  3. 學生不能進入教師後台
  4. 教師權限維持正常
  5. R07 與 prop-scan 頁面可開啟
  6. 錯誤密碼不能登入
  7. DEMO 8110／8111 正常
  8. 正式服務及正式資料庫不受影響

全程走手機實際路徑 http://192.168.1.114:8111，使用 iPhone Safari UA。
明文密碼不輸出。
"""

from __future__ import annotations

import hashlib
import http.cookiejar
import json
import os
import re
import sqlite3
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "http://192.168.1.114:8111"
DJANGO_DIRECT = "http://192.168.1.114:8110"
PROD_PROBE = "http://127.0.0.1:8022"

STUDENT_EMAIL = "demo.student01@fde-demo.local"
TEACHER_EMAIL = "demo.teacher@fde-demo.local"

IPHONE_UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) "
             "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 "
             "Mobile/15E148 Safari/604.1")

PROJECT_ROOT = Path(r"D:\FDE-AI-UAS-v2.0")
DEMO_DB = PROJECT_ROOT / "demo" / "runtime" / "db" / "demo.sqlite3"
PROD_DB = PROJECT_ROOT / "student_portal" / "db.sqlite3"
DELIVERY_FILE = Path(os.path.expanduser("~")) / ".fde-demo-credentials" / "demo.shared.password.txt"
DESKTOP_FILE = Path(os.path.expanduser("~")) / "Desktop" / "FDE_DEMO_測試帳密.txt"

RESULT = {"checks": []}


def rec(name, ok, detail=""):
    RESULT["checks"].append({"name": name, "ok": bool(ok), "detail": detail})
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" :: {detail}" if detail else ""))


def read_shared_password() -> str:
    """從本機受限交付檔讀取共用密碼（不輸出明文）。"""
    lines = DELIVERY_FILE.read_text(encoding="utf-8").splitlines()
    for i, l in enumerate(lines):
        if "以下為密碼" in l and "----" in l:
            for nxt in lines[i + 1:]:
                if nxt.strip() and not nxt.strip().startswith("----"):
                    return nxt.strip()
    raise SystemExit("無法從交付檔解析密碼")


def new_opener():
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(
        urllib.request.ProxyHandler({}),
        urllib.request.HTTPCookieProcessor(cj),
    )
    op.addheaders = [("User-Agent", IPHONE_UA)]
    return op, cj


def get_csrf(html: str) -> str | None:
    m = re.search(r'name="csrfmiddlewaretoken"\s+value="([^"]+)"', html)
    return m.group(1) if m else None


def login(base: str, email: str, password: str, path: str = "/login/"):
    """完整登入流程，回傳 (status, landed_url, body, sessionid_set, err_shown)。

    注意：/login/ 為「學生專用」入口（使用 StudentLoginForm），
    教師必須走 /teacher/login/（TeacherLoginForm）—— 兩者表單與成功導向不同。
    """
    op, cj = new_opener()
    r = op.open(f"{base}{path}", timeout=10)
    html = r.read().decode("utf-8", "replace")
    tok = get_csrf(html)
    if not tok:
        return None, None, html, False, False

    data = urllib.parse.urlencode({
        "csrfmiddlewaretoken": tok, "username": email, "password": password,
    }).encode()
    req = urllib.request.Request(f"{base}{path}", data=data, method="POST")
    req.add_header("User-Agent", IPHONE_UA)
    req.add_header("Referer", f"{base}{path}")
    req.add_header("Origin", base)
    try:
        resp = op.open(req, timeout=15)
    except urllib.error.HTTPError as e:
        resp = e
    body = resp.read().decode("utf-8", "replace")
    landed = resp.geturl()
    has_sid = any(c.name == "sessionid" for c in cj)
    # 學生入口 (StudentLoginForm) 自訂訊息；教師入口 (TeacherLoginForm) 沿用 Django 內建
    # AuthenticationForm 的訊息 → 必須同時涵蓋兩種文字，否則會誤判。
    err = ("電子郵箱或密碼錯誤" in body
           or "電子郵件或密碼錯誤" in body
           or "輸入正確的" in body
           or "Please enter a correct" in body)
    return getattr(resp, "status", None), landed, body, has_sid, err


def fetch(op, url):
    try:
        r = op.open(url, timeout=10)
        return r.status, r.geturl(), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.geturl(), e.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        return None, None, f"{type(e).__name__}: {e}"


print("=" * 74)
print("  FDE-AI-UAS 2.0｜DEMO 學生／教師共用測試密碼 — 完整驗收")
print("=" * 74)

pwd = read_shared_password()
fp = hashlib.sha256(pwd.encode()).hexdigest()[:16]
print(f"\n  交付檔：{DELIVERY_FILE}")
print(f"  密碼：16 字元 / 純英數={pwd.isalnum()} / 指紋={fp}")
print("  （明文不輸出）\n")

WRONG_PWD = "DefinitelyWrongPwd000"

# ---------------------------------------------------------------------------
print("--- 驗收 1：學生使用共同密碼登入 /student/ ---")
st, landed, body, sid, err = login(BASE, STUDENT_EMAIL, pwd, "/login/")
ok1 = (st == 200 and landed and landed.rstrip("/").endswith("/student") and sid)
rec("1. 學生共同密碼登入 /student/", ok1,
    f"status={st} landed={landed} sessionid={sid} err={err}")

# ---------------------------------------------------------------------------
print("\n--- 驗收 2：教師使用共同密碼登入 /teacher/ ---")
st2, landed2, body2, sid2, err2 = login(BASE, TEACHER_EMAIL, pwd, "/teacher/login/")
ok2 = (st2 == 200 and landed2 and "/teacher" in landed2 and sid2)
rec("2. 教師共同密碼登入 /teacher/", ok2,
    f"status={st2} landed={landed2} sessionid={sid2} err={err2}")

# 補充：教師走「學生入口」應被拒（證明角色分流正確）
st2x, landed2x, body2x, sid2x, err2x = login(BASE, TEACHER_EMAIL, pwd, "/login/")
rec("2b. 教師帳號無法經學生入口 /login/ 登入（角色分流正確）",
    not (landed2x or "").rstrip("/").endswith("/student"),
    f"status={st2x} landed={landed2x} err_shown={err2x}")

# ---------------------------------------------------------------------------
print("\n--- 驗收 3：學生不能進入教師後台 ---")
# 以學生身分登入（/login/），再嘗試存取教師後台各頁
op_s, cj_s = new_opener()
r = op_s.open(f"{BASE}/login/", timeout=10)
tok = get_csrf(r.read().decode("utf-8", "replace"))
data = urllib.parse.urlencode({"csrfmiddlewaretoken": tok,
                               "username": STUDENT_EMAIL,
                               "password": pwd}).encode()
req = urllib.request.Request(f"{BASE}/login/", data=data, method="POST")
req.add_header("User-Agent", IPHONE_UA)
req.add_header("Referer", f"{BASE}/login/")
req.add_header("Origin", BASE)
op_s.open(req, timeout=15)

teacher_urls = [
    f"{BASE}/teacher/",
    f"{BASE}/teacher/vision-flywheel/",
    f"{BASE}/teacher/golden-sets/",
]
blocked = []
for u in teacher_urls:
    code, final, b = fetch(op_s, u)
    # 學生應被導向登入頁或 403/302，而非看到教師後台內容
    is_blocked = (code in (302, 403, 404)) or ("teacher/login" in (final or ""))
    blocked.append((u, code, final, is_blocked))
    print(f"    {u} -> status={code} final={final} blocked={is_blocked}")
ok3 = all(b[3] for b in blocked)
rec("3. 學生無法進入教師後台", ok3,
    f"檢查 {len(blocked)} 個教師網址，全部被拒={ok3}")

# ---------------------------------------------------------------------------
print("\n--- 驗收 4：教師權限維持正常 ---")
op_t, cj_t = new_opener()
r = op_t.open(f"{BASE}/teacher/login/", timeout=10)
tok = get_csrf(r.read().decode("utf-8", "replace"))
data = urllib.parse.urlencode({"csrfmiddlewaretoken": tok,
                               "username": TEACHER_EMAIL,
                               "password": pwd}).encode()
req = urllib.request.Request(f"{BASE}/teacher/login/", data=data, method="POST")
req.add_header("User-Agent", IPHONE_UA)
req.add_header("Referer", f"{BASE}/teacher/login/")
req.add_header("Origin", BASE)
resp = op_t.open(req, timeout=15)
teacher_landed = resp.geturl()
teacher_ok_pages = [
    (f"{BASE}/teacher/", 200),
    (f"{BASE}/teacher/vision-flywheel/", 200),
    (f"{BASE}/teacher/golden-sets/", 200),
]
t_results = []
for u, expect in teacher_ok_pages:
    code, final, b = fetch(op_t, u)
    ok = (code == expect) and "teacher/login" not in (final or "")
    t_results.append((u, code, ok))
    print(f"    {u} -> status={code} ok={ok}")
ok4 = all(t[2] for t in t_results) and "/teacher" in (teacher_landed or "")
rec("4. 教師權限正常（可進教師後台各頁）", ok4,
    f"landed={teacher_landed}；{len(t_results)} 頁檢查")

# ---------------------------------------------------------------------------
print("\n--- 驗收 5：R07 與 prop-scan 頁面可開啟 ---")
op_s2, cj_s2 = new_opener()
r = op_s2.open(f"{BASE}/login/", timeout=10)
tok = get_csrf(r.read().decode("utf-8", "replace"))
data = urllib.parse.urlencode({"csrfmiddlewaretoken": tok,
                               "username": STUDENT_EMAIL,
                               "password": pwd}).encode()
req = urllib.request.Request(f"{BASE}/login/", data=data, method="POST")
req.add_header("User-Agent", IPHONE_UA)
req.add_header("Referer", f"{BASE}/login/")
req.add_header("Origin", BASE)
op_s2.open(req, timeout=15)

student_pages = [
    (f"{BASE}/student/courses/1/growth/R07/", "R07"),
    (f"{BASE}/student/courses/1/prop-scan/", "prop-scan"),
]
sp_results = []
for u, label in student_pages:
    code, final, b = fetch(op_s2, u)
    sp_results.append((label, code, len(b)))
    print(f"    {label}: {u} -> status={code} bytes={len(b)}")
ok5 = all(c == 200 for _, c, _ in sp_results)
rec("5. R07 與 prop-scan 頁面可開啟", ok5,
    "; ".join(f"{l}={c}" for l, c, _ in sp_results))

# ---------------------------------------------------------------------------
print("\n--- 驗收 6：錯誤密碼不能登入 ---")
e1 = login(BASE, STUDENT_EMAIL, WRONG_PWD, "/login/")
e2 = login(BASE, TEACHER_EMAIL, WRONG_PWD, "/teacher/login/")
ok6a = bool(e1[4]) and not e1[3]      # 顯示錯誤 且 未建立 session
ok6b = bool(e2[4]) and not e2[3]
print(f"    學生錯誤密碼: err_shown={e1[4]} sessionid={e1[3]} landed={e1[1]}")
print(f"    教師錯誤密碼: err_shown={e2[4]} sessionid={e2[3]} landed={e2[1]}")
rec("6. 錯誤密碼不能登入（學生）", ok6a, f"err_shown={e1[4]} sessionid={e1[3]}")
rec("6. 錯誤密碼不能登入（教師）", ok6b, f"err_shown={e2[4]} sessionid={e2[3]}")

# 舊密碼（改密碼前的學生密碼）也應失效
# P6 安全修正：舊密碼不得硬編碼；未設定環境變數時明確 SKIP，不計為通過
# （避免用空字串登入失敗產生「必然通過」的假陽性）。
old_student_pwd = os.environ.get("FDE_DEMO_OLD_PASSWORD", "").strip()
if old_student_pwd:
    old_fail = login(BASE, STUDENT_EMAIL, old_student_pwd, "/login/")
    rec("6b. 舊密碼已失效", bool(old_fail[4]) and not old_fail[3],
        f"err_shown={old_fail[4]} sessionid={old_fail[3]}")
else:
    print("[SKIP] 6b. 未設定 FDE_DEMO_OLD_PASSWORD，略過舊密碼失效驗證（不計為通過）")

# ---------------------------------------------------------------------------
print("\n--- 驗收 7：DEMO 8110／8111 正常 ---")
health = []
for url, label in [
    (f"{BASE}/", "8111 首頁"),
    (f"{BASE}/api/live/health", "8111 health"),
    (f"{DJANGO_DIRECT}/login/", "8110 直連登入頁"),
    (f"{DJANGO_DIRECT}/teacher/login/", "8110 教師登入頁"),
]:
    code, final, b = fetch(*new_opener()[:1], url) if False else fetch(new_opener()[0], url)
    health.append((label, code))
    print(f"    {label}: status={code}")
ok7 = all(c == 200 for _, c in health)
rec("7. DEMO 8110／8111 正常", ok7,
    "; ".join(f"{l}={c}" for l, c in health))

# ---------------------------------------------------------------------------
print("\n--- 驗收 8：正式服務及正式資料庫不受影響 ---")
prod_st = PROD_DB.stat()
demo_st = DEMO_DB.stat()
print(f"    PROD DB  size={prod_st.st_size}  mtime_ns={prod_st.st_mtime_ns}")
print(f"    DEMO DB  size={demo_st.st_size}  mtime_ns={demo_st.st_mtime_ns}")

con = sqlite3.connect(f"file:{PROD_DB}?mode=ro", uri=True)
prod_users = list(con.execute("SELECT username,is_staff FROM auth_user ORDER BY id"))
con.close()
print(f"    PROD 帳號：{prod_users}")

# DEMO 帳號角色確認
con = sqlite3.connect(f"file:{DEMO_DB}?mode=ro", uri=True)
demo_users = list(con.execute(
    "SELECT id,username,is_active,is_staff,is_superuser FROM auth_user ORDER BY id"))
con.close()
print(f"    DEMO 帳號：{demo_users}")

prod_mtime_expected = 1791371312138589800  # 2026-10-07T19:08:32.138589800
prod_only_r07 = len(prod_users) == 1 and prod_users[0][0] == "r07.student@local.test"
demo_roles_ok = (len(demo_users) == 2
                 and demo_users[0][1] == STUDENT_EMAIL and demo_users[0][3] == 0
                 and demo_users[1][1] == TEACHER_EMAIL and demo_users[1][3] == 1)
rec("8a. 正式資料庫 mtime 未變（2026-10-07T19:08:32）",
    prod_st.st_mtime_ns == prod_mtime_expected, f"mtime_ns={prod_st.st_mtime_ns}")
rec("8b. 正式資料庫僅有原帳號 r07.student@local.test", prod_only_r07,
    f"{prod_users}")
rec("8c. DEMO 帳號角色正確（學生非 staff / 教師 is_staff）", demo_roles_ok,
    f"{demo_users}")

# 正式 8022 探測：DEMO 帳號應被拒（證明兩庫不同）
st_prod, landed_prod, body_prod, sid_prod, err_prod = login(
    PROD_PROBE, STUDENT_EMAIL, pwd, "/login/")
rec("8d. 正式 8022 拒絕 DEMO 帳號（證明 8111 未指向正式）",
    bool(err_prod) and not sid_prod,
    f"status={st_prod} err_shown={err_prod} sessionid={sid_prod}")

# ---------------------------------------------------------------------------
print("\n" + "=" * 74)
passed = sum(1 for c in RESULT["checks"] if c["ok"])
total = len(RESULT["checks"])
print(f"  結果：{passed}/{total} PASS")
print("=" * 74)
RESULT["passed"] = passed
RESULT["total"] = total
RESULT["password_fingerprint"] = fp
RESULT["password_length"] = len(pwd)

out = PROJECT_ROOT / "demo" / "runtime" / "logs" / "shared_password_acceptance.json"
out.write_text(json.dumps(RESULT, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"  報告（不含明文密碼）：{out}")
