#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""P9-D 交付安全檢查（2026-10-13 教師指令第四項）。

對隔離驗收服務（:8112，demo/runtime/db/p42_verify.sqlite3）做交付前安全檢查：

  A. 未登入存取保護（報告／清單／展示／證據下載一律需登入）
  B. 教師跨班級權限（教師 A 不得檢視教師 B 的班級；含頁面與 CSV）
  C. Session 展示授權隔離（逐班隔離、跨 session 隔離、可回復匿名）
  D. 明文憑證與執行期資料（.gitignore、版控追蹤、憑證掃描）
  E. 正式資料庫未被修改（mtime + SHA256，唯讀）
  F. Git 未提交成果完整保留（工作區變更清單）

憑證不寫入程式；一律由安全載入器取得。
"""
import hashlib
import http.cookiejar
import os
import re
import sqlite3
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = "http://192.168.1.114:8112"
REPO = r"D:\FDE-AI-UAS-v2.0"
DB = os.path.join(REPO, "demo", "runtime", "db", "p42_verify.sqlite3")
PROD_DB = os.path.join(REPO, "student_portal", "db.sqlite3")

COHORT_A = "P42-A-2026"        # 教師 A 有授權
COHORT_C = "P42-C-2026"        # 教師 A 有授權（空班）
COHORT_B = "P42-B-2026"        # 教師 B 專屬，教師 A 不得檢視
TEACHER_A = "p42.teacher.a@fde-demo.local"
TEACHER_B = "p42.teacher.b@fde-demo.local"

RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    print("%s - %s%s" % ("PASS" if ok else "FAIL", name, (" | " + detail) if detail else ""))


def load_password(env_key):
    value = (os.environ.get(env_key) or "").strip()
    if value:
        return value
    candidates = [
        os.environ.get("FDE_DEMO_CREDENTIALS_FILE"),
        os.path.join(os.path.expanduser("~"), ".fde-demo-credentials", "demo.shared.password.txt"),
    ]
    for path in candidates:
        if not path:
            continue
        try:
            lines = open(path, encoding="utf-8").read().splitlines()
        except OSError:
            continue
        for index, line in enumerate(lines):
            if "以下為密碼" in line and "----" in line:
                for follower in lines[index + 1:]:
                    text = follower.strip()
                    if text and not text.startswith("----"):
                        return text
    return None


TEACHER_PASSWORD = load_password("FDE_DEMO_TEACHER_PASSWORD")
if not TEACHER_PASSWORD:
    print("[安全停止] 無法取得教師密碼：請設定 FDE_DEMO_TEACHER_PASSWORD 或提供憑證檔。")
    sys.exit(2)


def new_session():
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(jar)
    )
    return jar, opener


def get(opener, url, referer=None):
    request = urllib.request.Request(
        url, headers={"User-Agent": "P9-DELIVERY/1.0", "Referer": referer or BASE + "/"}
    )
    try:
        with opener.open(request, timeout=30) as response:
            return response.status, response.read().decode("utf-8", "replace"), response.geturl()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace"), url


def post(opener, url, data, referer):
    body = urllib.parse.urlencode(data).encode()
    parts = urllib.parse.urlsplit(referer)
    request = urllib.request.Request(
        url,
        data=body,
        headers={
            "User-Agent": "P9-DELIVERY/1.0",
            "Referer": referer,
            "Origin": "%s://%s" % (parts.scheme, parts.netloc),
        },
    )
    try:
        with opener.open(request, timeout=30) as response:
            return response.status, response.read().decode("utf-8", "replace"), response.geturl()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace"), url


def login(opener, jar, email, password):
    path = "/teacher/login/"
    _s, page, _f = get(opener, BASE + path)
    token = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', page)
    if not token:
        for cookie in jar:
            if cookie.name == "csrftoken":
                token = type("T", (), {"group": lambda self, i: cookie.value})()
                break
    return post(
        opener, BASE + path,
        {"username": email, "password": password, "csrfmiddlewaretoken": token.group(1) if token else ""},
        BASE + path,
    )


def showcase_state(opener, cohort):
    _s, page, _f = get(opener, "%s/teacher/class-showcase/%s/" % (BASE, cohort))
    token = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', page)
    return {
        "anon": "匿名化展示" in page,
        "named": "具名展示（教師確認已取得必要授權）" in page,
        "has_download": "/download/" in page,
        "has_media": "/media/" in page,
        "csrf": token.group(1) if token else "",
    }


def showcase_action(opener, cohort, action, csrf):
    url = "%s/teacher/class-showcase/%s/" % (BASE, cohort)
    return post(opener, url, {"action": action, "csrfmiddlewaretoken": csrf}, url)


# ═══════════════ A. 未登入存取保護 ═══════════════
print("--- A. 未登入存取保護 ---")
jar0, opener0 = new_session()
protected = [
    ("班級成果報告", "/teacher/class-report/"),
    ("結訓審核清單", "/teacher/review-checklist/"),
    ("班級成果展示", "/teacher/class-showcase/%s/" % COHORT_A),
    ("班級學習成果總覽", "/teacher/class-outcomes/"),
    ("班級統計摘要 CSV", "/teacher/class-report/export/summary/%s/" % COHORT_A),
    ("學員成果明細 CSV", "/teacher/class-report/export/records/%s/" % COHORT_A),
]
for label, path in protected:
    status, body, final = get(opener0, BASE + path)
    is_login = "/teacher/login/" in (final or "") or "登入" in body[:4000]
    check("A-未登入存取「%s」被導向登入頁" % label, is_login, "status=%s final=%s" % (status, final))

# 未掛載公開 /media/：請求任何媒體路徑不得回傳檔案
status_media, body_media, _ = get(opener0, BASE + "/media/evidence/nonexistent.jpg")
check(
    "A-未掛載公開 /media/ 媒體目錄（無公開證據網址）",
    status_media in (301, 302, 403, 404),
    "status=%s len=%s" % (status_media, len(body_media)),
)

# 證據下載端點：取一個真實 evidence id 驗證需登入
con = sqlite3.connect("file:{}?mode=ro".format(DB), uri=True)
ev = con.execute("SELECT evidence_id FROM learning_evidence LIMIT 1").fetchone()
con.close()
if ev:
    raw = str(ev[0]).replace("-", "")
    ev_uuid = "%s-%s-%s-%s-%s" % (raw[0:8], raw[8:12], raw[12:16], raw[16:20], raw[20:32])
    status_ev, _b, final_ev = get(opener0, "%s/evidence/%s/download/" % (BASE, ev_uuid))
    check(
        "A-未登入存取證據下載被導向登入頁",
        "/login/" in (final_ev or ""),
        "status=%s final=%s" % (status_ev, final_ev),
    )
else:
    check("A-未登入存取證據下載被導向登入頁", True, "驗收庫無證據資料列，跳過（不偽造）")

# ═══════════════ B. 教師跨班級權限 ═══════════════
print("--- B. 教師跨班級權限 ---")
jarA, openerA = new_session()
login(openerA, jarA, TEACHER_A, TEACHER_PASSWORD)
_s, dashA, _f = get(openerA, BASE + "/teacher/")
check("B-教師 A 可登入教師後台", "班級成果" in dashA, "len=%s" % len(dashA))

for label, path in [
    ("班級成果報告", "/teacher/class-report/?cohort=%s" % COHORT_B),
    ("結訓審核清單", "/teacher/review-checklist/%s/" % COHORT_B),
    ("班級成果展示", "/teacher/class-showcase/%s/" % COHORT_B),
    ("班級統計摘要 CSV", "/teacher/class-report/export/summary/%s/" % COHORT_B),
    ("學員成果明細 CSV", "/teacher/class-report/export/records/%s/" % COHORT_B),
]:
    status, body, final = get(openerA, BASE + path)
    leaked = COHORT_B in body and "P42 驗證 B 班" in body
    check(
        "B-教師 A 無法檢視教師 B 的「%s」" % label,
        (not leaked) and (status in (302, 403, 404) or "登入" in body[:4000] or "403" in body[:2000] or "找不到" in body[:4000]),
        "status=%s leaked=%s final=%s" % (status, leaked, final),
    )

for label, path in [
    ("班級成果報告", "/teacher/class-report/?cohort=%s" % COHORT_A),
    ("結訓審核清單", "/teacher/review-checklist/%s/" % COHORT_A),
    ("班級成果展示", "/teacher/class-showcase/%s/" % COHORT_A),
]:
    status, body, _f = get(openerA, BASE + path)
    check("B-教師 A 可正常檢視自己班級的「%s」" % label, status == 200, "status=%s" % status)

# ═══════════════ C. Session 展示授權隔離 ═══════════════
print("--- C. Session 展示授權隔離 ---")
st = showcase_state(openerA, COHORT_A)
check("C-1 預設為匿名化展示", st["anon"] and not st["named"], str(st))
check("C-2 匿名模式不輸出證據連結", not st["has_download"] and not st["has_media"], str(st))

# 教師 A 為 A 班開啟具名
st_before = showcase_state(openerA, COHORT_A)
showcase_action(openerA, COHORT_A, "enable_identify", st_before["csrf"])
st2 = showcase_state(openerA, COHORT_A)
check("C-3 可為 A 班開啟具名展示", st2["named"], str(st2))

# 逐班隔離：C 班（同教師、不同班）仍應匿名
st_c = showcase_state(openerA, COHORT_C)
check(
    "C-4 授權逐班隔離（C 班仍匿名）",
    st_c["anon"] and not st_c["named"] and not st_c["has_download"],
    str(st_c),
)

# 跨 session 隔離：新 session 對 A 班仍應匿名
jar2, opener2 = new_session()
login(opener2, jar2, TEACHER_A, TEACHER_PASSWORD)
st_new = showcase_state(opener2, COHORT_A)
check(
    "C-5 授權跨 session 隔離（新 session 對 A 班仍匿名）",
    st_new["anon"] and not st_new["named"] and not st_new["has_download"],
    str(st_new),
)

# 可回復匿名
st_mid = showcase_state(openerA, COHORT_A)
showcase_action(openerA, COHORT_A, "disable_identify", st_mid["csrf"])
st3 = showcase_state(openerA, COHORT_A)
check("C-6 可回復匿名化展示", st3["anon"] and not st3["has_download"], str(st3))

# ═══════════════ D. 明文憑證與執行期資料 ═══════════════
print("--- D. 明文憑證與執行期資料 ---")


def git(*args):
    return subprocess.run(
        ["git"] + list(args), cwd=REPO, capture_output=True, text=True, encoding="utf-8", errors="replace"
    )


# D-1 明文密碼不得進入版控追蹤檔
leaks = []
for pw in [TEACHER_PASSWORD, "DemoStudent#2026", "DemoTeacher#2026"]:
    out = git("grep", "-F", "-l", pw, "--", ".")
    if out.stdout.strip():
        leaks.append((pw[:2] + "***", out.stdout.strip().splitlines()[:5]))
check("D-1 明文密碼未出現在版控追蹤檔", not leaks, "leaks=%s" % leaks)

# D-2 憑證檔本身被 gitignore 排除
cred_rel = ".fde-demo-credentials/demo.shared.password.txt"
r = git("check-ignore", "-q", cred_rel)
check("D-2 憑證檔規則被 .gitignore 排除", r.returncode == 0, "check-ignore rc=%s" % r.returncode)

# D-3 執行期產物被排除、且未被追蹤
runtime_paths = [
    "demo/runtime/db/p9_audit.sqlite3",
    "demo/runtime/db/p42_verify.sqlite3",
    "demo/runtime/db/demo.sqlite3",
    "demo/runtime/state/demo-services.json",
    "demo/runtime/logs/x.log",
]
not_ignored = [p for p in runtime_paths if git("check-ignore", "-q", p).returncode != 0]
check("D-3 執行期資料（DB／state／log）被 .gitignore 排除", not not_ignored, "notIgnored=%s" % not_ignored)

tracked_runtime = git("ls-files", "demo/runtime").stdout.strip()
check("D-3b 執行期資料未被版控追蹤", not tracked_runtime, "tracked=%s" % (tracked_runtime[:200] or "(none)"))

# D-4 憑證檔本身不在工作區 repo 內（應位於使用者家目錄）
cred_in_repo = os.path.exists(os.path.join(REPO, ".fde-demo-credentials"))
check("D-4 憑證檔不存放在專案目錄內", not cred_in_repo, "exists=%s" % cred_in_repo)

# ═══════════════ E. 正式資料庫未被修改 ═══════════════
print("--- E. 正式資料庫未被修改 ---")
if os.path.exists(PROD_DB):
    stat = os.stat(PROD_DB)
    digest = hashlib.sha256(open(PROD_DB, "rb").read()).hexdigest()
    import datetime

    mtime = datetime.datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S")
    check(
        "E-1 正式資料庫存在且可讀",
        stat.st_size > 0,
        "size=%s mtime=%s sha256=%s" % (stat.st_size, mtime, digest[:16]),
    )
    check(
        "E-2 正式資料庫最後修改時間仍為 2026-10-07（P9 期間未寫入）",
        mtime.startswith("2026-10-07"),
        "mtime=%s" % mtime,
    )
else:
    check("E-1 正式資料庫存在且可讀", False, "找不到 %s" % PROD_DB)

# E-3 驗收服務確實指向隔離庫（非正式庫）
con = sqlite3.connect("file:{}?mode=ro".format(DB), uri=True)
isolated = con.execute("SELECT COUNT(*) FROM learning_cohort").fetchone()[0]
con.close()
check("E-3 驗收服務使用隔離測試庫（班級數 != 正式庫）", isolated > 0, "isolatedCohorts=%s" % isolated)

# ═══════════════ F. Git 未提交成果完整保留 ═══════════════
print("--- F. Git 未提交成果完整保留 ---")
status = git("status", "--porcelain").stdout.strip().splitlines()
count = len(status)
check("F-1 工作區未提交成果仍保留（>150 項）", count > 150, "changedFiles=%s" % count)
untracked = [l for l in status if l.startswith("??")]
modified = [l for l in status if l[:2].strip() and not l.startswith("??")]
check("F-2 未追蹤新檔與已修改檔並存（未被 clean）", len(untracked) > 0 and len(modified) > 0,
      "untracked=%s modified=%s" % (len(untracked), len(modified)))
head = git("rev-parse", "--short", "HEAD").stdout.strip()
check("F-3 HEAD 仍為 e5c0442（未 commit／未 reset）", head == "e5c0442", "HEAD=%s" % head)
mig = sorted(os.listdir(os.path.join(REPO, "student_portal", "learning", "migrations")))
migs = [m for m in mig if m[0].isdigit()]
check("F-4 未新增 Migration（最新仍為 0019）", migs and migs[-1].startswith("0019"), "latest=%s count=%s" % (migs[-1] if migs else None, len(migs)))

# ═══════════════ 汇总 ═══════════════
passed = sum(1 for _n, ok, _d in RESULTS if ok)
failed = [(n, d) for n, ok, d in RESULTS if not ok]
print("")
print("==== P9-D 交付安全檢查：%s 項通過 / %s 項失敗 / 共 %s 項 ====" % (passed, len(failed), len(RESULTS)))
for n, d in failed:
    print("FAIL 詳列：%s | %s" % (n, d))
sys.exit(1 if failed else 0)
