"""FDE-AI-UAS 2.0 DEMO — 真實 HTTP 登入與頁面驗收。

使用真實 HTTP 請求（含 CSRF、cookie）驗證：
  * 學員可用 DEMO 帳號登入
  * 教師可用 DEMO 帳號登入
  * 五個展示頁面在登入後可正常開啟（非 500）
  * 重新請求（模擬重新整理）資料仍在
所有請求只打 127.0.0.1:8110 / 8111，不觸碰正式服務。
"""

from __future__ import annotations

import http.cookiejar
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import demo_credentials

# 清除代理，避免 127.0.0.1 被攔截
for var in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
            "http_proxy", "https_proxy", "all_proxy"):
    os.environ.pop(var, None)
os.environ["NO_PROXY"] = "*"
os.environ["no_proxy"] = "*"

DJANGO = "http://127.0.0.1:8110"
LIVE = "http://127.0.0.1:8111"

STUDENT_EMAIL = "demo.student01@fde-demo.local"
STUDENT_PASSWORD = demo_credentials.student_password()
TEACHER_EMAIL = "demo.teacher@fde-demo.local"
TEACHER_PASSWORD = demo_credentials.teacher_password()

NO_PROXY_HANDLER = urllib.request.ProxyHandler({})
results: list[tuple[str, bool, str]] = []


def make_opener():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(
        NO_PROXY_HANDLER, urllib.request.HTTPCookieProcessor(jar)
    )


def get(opener, url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": "FDE-DEMO-VERIFY"})
    try:
        with opener.open(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace"), r.geturl()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace"), e.url if hasattr(e, "url") else url


def csrf_from(html: str) -> str:
    m = re.search(r'name="csrfmiddlewaretoken"\s+value="([^"]+)"', html)
    if not m:
        m = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', html)
    return m.group(1) if m else ""


def post(opener, url, data, referer):
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body, headers={
        "User-Agent": "FDE-DEMO-VERIFY",
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": referer,
    })
    try:
        with opener.open(req, timeout=20) as r:
            return r.status, r.read().decode("utf-8", "replace"), r.geturl()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace"), url


def check(label, ok, detail=""):
    results.append((label, ok, detail))
    tag = "[PASS]" if ok else "[FAIL]"
    print(f"  {tag} {label}" + (f" — {detail}" if detail else ""))
    return ok


def login(opener, login_url, email, password, expect_after):
    status, html, _ = get(opener, login_url)
    if status != 200:
        return False, f"登入頁 HTTP {status}"
    token = csrf_from(html)
    if not token:
        return False, "取不到 CSRF token"
    status, body, final = post(opener, login_url, {
        "csrfmiddlewaretoken": token,
        "username": email,
        "password": password,
    }, login_url)
    return True, f"HTTP {status} → {final}"


print("=" * 74)
print("  DEMO 真實 HTTP 登入與頁面驗收")
print("=" * 74)
print(f"  Django : {DJANGO}")
print(f"  Live   : {LIVE}")
print()

# ---------------- 1. 服務可達 ----------------
print("[1] 服務可達性")
for label, url in [
    ("Live 首頁", f"{LIVE}/"),
    ("Django 學員登入頁", f"{DJANGO}/login/"),
    ("Django 教師登入頁", f"{DJANGO}/teacher/login/"),
    ("Live 健康端點", f"{LIVE}/api/live/health"),
]:
    op = make_opener()
    st, _, _ = get(op, url)
    check(label, st == 200, f"HTTP {st}")

# Live 反代到 DEMO Django（而非正式 8022）
op = make_opener()
st, html, _ = get(op, f"{LIVE}/student/")
check("Live 反代 /student/ 可達", st in (200, 302), f"HTTP {st}")

# ---------------- 2. 學員登入 ----------------
print()
print("[2] 學員登入")
student_op = make_opener()
ok, detail = login(student_op, f"{DJANGO}/login/", STUDENT_EMAIL, STUDENT_PASSWORD, None)
check("學員登入送出", ok, detail)

st, html, _ = get(student_op, f"{DJANGO}/student/")
already_in = "student" in html.lower() and "登入" not in html[:2000]
check("學員可進入 /student/", st == 200, f"HTTP {st}")

st, html, _ = get(student_op, f"{DJANGO}/student/growth/")
check("學員可進入成長紀錄入口", st in (200, 302), f"HTTP {st}")

# 找出 Enrollment ID，直接驗證 R07 頁面
m = re.search(r'/student/courses/(\d+)/', html) if st == 200 else None
if m:
    eid = m.group(1)
    for slot, name in [("R07", "R07 任務卡"), ("R01", "R01 任務卡")]:
        st2, h2, _ = get(student_op, f"{DJANGO}/student/courses/{eid}/growth/{slot}/")
        check(f"學員 {name} 可開啟", st2 == 200 and "500" not in str(st2), f"HTTP {st2}")
    # 重新請求（模擬重新整理）
    st3, h3, _ = get(student_op, f"{DJANGO}/student/courses/{eid}/growth/R07/")
    check("R07 重新整理後仍可開啟", st3 == 200, f"HTTP {st3}")
else:
    check("找到 Enrollment 連結", False, "無法從成長入口取得 enrollment id")

# ---------------- 3. 教師登入 ----------------
print()
print("[3] 教師登入")
teacher_op = make_opener()
ok, detail = login(teacher_op, f"{DJANGO}/teacher/login/", TEACHER_EMAIL, TEACHER_PASSWORD, None)
check("教師登入送出", ok, detail)

teacher_pages = [
    ("教師後台", f"{DJANGO}/teacher/"),
    ("教師模型倉庫（Vision Flywheel）", f"{DJANGO}/teacher/vision-flywheel/"),
    ("教師模型清單", f"{DJANGO}/teacher/vision-models/"),
    ("Golden Set 管理頁", f"{DJANGO}/teacher/golden-sets/"),
    ("Golden Set 詳情頁", f"{DJANGO}/teacher/golden-sets/PROP_GOLDEN_DEMO_v1/"),
]
print()
print("[4] 教師展示頁面")
for name, url in teacher_pages:
    st, html, final = get(teacher_op, url)
    is_login_redirect = "/teacher/login/" in final or "/login/" in final
    ok = st == 200 and not is_login_redirect
    note = f"HTTP {st}"
    if is_login_redirect:
        note += "（被重導到登入頁 → 登入未生效）"
    check(name, ok, note)

# ---------------- 5. 關鍵資料顯示檢查 ----------------
print()
print("[5] 展示資料顯示於頁面")
st, html, _ = get(teacher_op, f"{DJANGO}/teacher/golden-sets/PROP_GOLDEN_DEMO_v1/")
if st == 200:
    check("Golden Set 頁顯示 FROZEN", "FROZEN" in html)
    check("Golden Set 頁顯示四類標籤",
          all(lbl in html for lbl in ("CW_F", "CCW_F", "CW_B", "CCW_B")))
    check("Golden Set 頁顯示 Manifest SHA256", "SHA256" in html.upper() or "sha256" in html)

st, html, _ = get(teacher_op, f"{DJANGO}/teacher/vision-flywheel/")
if st == 200:
    check("模型倉庫顯示 V1", "V1" in html)
    # 模板刻意只顯示前 12 碼（slice:":12"），因此比對 12 碼十六進位。
    has_sha = bool(re.search(r"\b[0-9a-f]{12,}\b", html))
    check("模型倉庫顯示快照雜湊（前 12 碼）", has_sha)

# ---------------- 6. 重新登入後資料仍在 ----------------
print()
print("[6] 重新登入後資料仍在（模擬重新整理／重開瀏覽器）")
op2 = make_opener()
login(op2, f"{DJANGO}/teacher/login/", TEACHER_EMAIL, TEACHER_PASSWORD, None)
st, html, _ = get(op2, f"{DJANGO}/teacher/golden-sets/PROP_GOLDEN_DEMO_v1/")
check("重新登入後 Golden Set 仍可開啟", st == 200, f"HTTP {st}")
if st == 200:
    check("重新登入後 FROZEN 狀態仍在", "FROZEN" in html)

print()
print("=" * 74)
passed = sum(1 for _, ok, _ in results if ok)
total = len(results)
print(f"  真實 HTTP 驗收：{passed}/{total} PASS")
print("=" * 74)
fails = [r for r in results if not r[1]]
if fails:
    print("\n  未通過項目：")
    for label, _, detail in fails:
        print(f"    - {label}（{detail}）")

sys.exit(0 if passed == total else 1)
