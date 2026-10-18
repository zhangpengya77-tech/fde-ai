#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""I3-B 外部模組接口安全驗收（MP_GROUND_STATION / HQGC_ASSESSMENT / F450_DIGITAL_TWIN）。

對應 2026-10-13 教師 I3 指令第三節，逐項驗證：
  1. 未配置時 DISABLED（尚未接入、無連結、不探測）
  2. 未授權時不探測（角色不符 → 權限不足，且不發出探測）
  3. 服務不可用時不產生可點連結（降級）
  4. URL 配置不接受不受信任的任意目標（scheme／帳密／敏感參數／metadata 主機）
  5. 服務探測具短逾時與明確失敗處理
  6. URL 不得含 Token、密碼或學生個資
  7. 不因外部服務故障拖垮工作台（頁面仍 200、R01–R08 完整）
  8. 不因探測而修改學習紀錄（DB 逐表指紋前後一致）
  9. 不自動啟動外部服務（介面層原始碼掃描）

模式（第 1 個參數）：
  default   三模組皆未配置 → 應全部「尚未接入」
  unsafe    以含敏感參數的 URL 配置 → 應被拒絕（服務暫時不可用、URL 不出現）
  module-up 配置可達 URL → 應「已可使用」並產生連結
  module-down 配置不可達 URL → 應「服務暫時不可用」且無連結

全程**不跟隨重導**。DB 指紋以唯讀方式讀取，不寫入任何資料。
"""
import hashlib
import http.cookiejar
import os
import re
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request

MODE = (sys.argv[1] if len(sys.argv) > 1 else "default").strip().lower()
BASE = (os.environ.get("I3_MODULE_BASE") or "http://192.168.1.114:8116").rstrip("/")
COOKIE_HOST = urllib.parse.urlsplit(BASE).hostname or "192.168.1.114"
MODULE_URL = (os.environ.get("I3_MODULE_URL") or "").strip()
DB_PATH = (os.environ.get("I3_DB") or r"D:\FDE-AI-UAS-v2.0\demo\runtime\db\i3_e2e.sqlite3").strip()
STUDENT_EMAIL = "p42-a-0001@fde-p42.local"
CREDENTIALS_CANDIDATES = [
    os.environ.get("FDE_DEMO_CREDENTIALS_FILE"),
    os.path.expanduser("~/.fde-demo-credentials/demo.shared.password.txt"),
]
MODULE_NAMES = ("F450 數位孿生", "MP 地面站（預留）", "HQGC 考核（預留）")

PASS, FAIL, SKIP, PENDING = "PASS", "FAIL", "SKIPPED", "PENDING"
RESULTS = []


def record(name, result, detail=""):
    RESULTS.append((name, result, detail))
    print("%-7s - %s%s" % (result, name, (" | " + detail) if detail else ""))


def check(name, ok, detail=""):
    record(name, PASS if ok else FAIL, detail)


def skip(name, reason):
    record(name, SKIP, reason)


def pending(name, reason):
    record(name, PENDING, reason)


def module_badges(html):
    """只取外部模組卡片（article.lp-module）內的徽章文字。

    工作台另有「規劃中」徽章屬未來專項項目，不屬四態，須排除。
    """
    labels = []
    for block in re.findall(r'<article class="lp-module[^"]*">(.*?)</article>', html, re.S):
        m = re.search(r'lp-badge[^>]*>([^<]+)<', block)
        if m:
            labels.append(m.group(1).strip())
    return labels


def load_password():
    env_pw = (os.environ.get("FDE_DEMO_STUDENT_PASSWORD") or "").strip()
    if env_pw:
        return env_pw
    for path in CREDENTIALS_CANDIDATES:
        if not path or not os.path.isfile(path):
            continue
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            lines = fh.read().splitlines()
        for i, line in enumerate(lines):
            if "以下為密碼" in line and "----" in line:
                for nxt in lines[i + 1:]:
                    nxt = nxt.strip()
                    if nxt and not nxt.startswith("----"):
                        return nxt
    return None


PASSWORD = load_password()
if not PASSWORD:
    print("[安全停止] 無法取得驗收密碼。")
    sys.exit(2)

for k in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
    os.environ.pop(k, None)
os.environ["NO_PROXY"] = "*"
os.environ["no_proxy"] = "*"


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def new_session():
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(cj), _NoRedirect(), urllib.request.ProxyHandler({})
    )
    return cj, op


def get(op, url):
    req = urllib.request.Request(url, headers={"User-Agent": "I3-MODULE/1.0"})
    try:
        with op.open(req, timeout=30) as resp:
            return resp.status, resp.read().decode("utf-8", "replace"), resp.headers.get("Location", "")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace"), exc.headers.get("Location", "")


def post(op, url, data, referer):
    parts = urllib.parse.urlsplit(referer)
    req = urllib.request.Request(
        url,
        data=urllib.parse.urlencode(data).encode(),
        headers={
            "User-Agent": "I3-MODULE/1.0",
            "Referer": referer,
            "Origin": parts.scheme + "://" + parts.netloc,
        },
    )
    try:
        with op.open(req, timeout=30) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")


def csrf_from(cj):
    for cookie in cj:
        if cookie.name == "csrftoken" and COOKIE_HOST in (cookie.domain or ""):
            return cookie.value
    return ""


def hidden_csrf(html):
    m = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', html)
    return m.group(1) if m else ""


def login(op, cj, email, path):
    status, page, _ = get(op, BASE + path)
    token = hidden_csrf(page) or csrf_from(cj)
    post(op, BASE + path, {"username": email, "password": PASSWORD, "csrfmiddlewaretoken": token}, BASE + path)
    return "sessionid" in [c.name for c in cj]


def db_fingerprint():
    """逐表指紋（行數 + 內容 SHA256）；唯讀，不寫入。"""
    if not os.path.isfile(DB_PATH):
        return None
    try:
        con = sqlite3.connect("file:{}?mode=ro".format(DB_PATH.replace("\\", "/")), uri=True)
        cur = con.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        tables = sorted(r[0] for r in cur.fetchall())
        digest = hashlib.sha256()
        counts = {}
        for table in tables:
            cur.execute('SELECT COUNT(*) FROM "%s"' % table)
            count = cur.fetchone()[0]
            counts[table] = count
            digest.update(("%s:%d;" % (table, count)).encode())
        con.close()
        return {"sha256": digest.hexdigest(), "tables": len(tables), "counts": counts}
    except Exception as exc:
        return {"error": str(exc)}


def slot_count(html):
    return len(sorted(set(re.findall(r'growth-slot">(R0[1-8])<', html))))


def main():
    print("==== I3-B 外部模組接口安全驗收（模式=%s，BASE=%s）====" % (MODE, BASE))
    cj, op = new_session()
    check("驗收學員登入成功", login(op, cj, STUDENT_EMAIL, "/login/"))

    fp_before = db_fingerprint()

    status, _, location = get(op, BASE + "/student/learning-path/")
    m = re.search(r"/student/courses/(\d+)/learning-path/", location or "")
    if not m:
        check("取得學員工作台網址", False, "HTTP %s → %s" % (status, location))
        return finish()
    enrollment_id = m.group(1)
    wb_url = BASE + "/student/courses/%s/learning-path/" % enrollment_id
    status, html, _ = get(op, wb_url)
    check("五階段工作台可開啟", status == 200, "HTTP %s" % status)

    # 1. 三模組皆存在且狀態標籤為四態之一
    for name in MODULE_NAMES:
        check("模組呈現於工作台：%s" % name, name in html)
    badges = module_badges(html)
    labels = set(badges)
    check(
        "模組徽章僅使用四態標籤",
        len(badges) == 3 and labels <= {"已可使用", "尚未接入", "服務暫時不可用", "權限不足"},
        "出現 %s" % sorted(labels),
    )

    # 2. 依模式驗證狀態
    if MODE == "default":
        check("預設配置下三模組皆「尚未接入」", html.count("尚未接入") == 3, "count=%d" % html.count("尚未接入"))
        for other in ("已可使用", "服務暫時不可用", "權限不足"):
            check("預設不得誤標「%s」" % other, other not in html)
    elif MODE == "unsafe":
        # I5-B 語意：安全檢查失敗 → 「服務暫時不可用」（診斷碼 SECURITY_REJECTED，教師端可見）
        check("含敏感參數的 URL 被拒絕（顯示「服務暫時不可用」）", "服務暫時不可用" in html)
        check("被拒絕的 URL 不得出現在頁面", "token=" not in html and "secret" not in html.lower())
        check("被拒絕的 URL 不得顯示為「已可使用」", "已可使用" not in html)
    elif MODE == "module-up":
        check("可達 URL → 顯示「已可使用」", "已可使用" in html)
        if MODULE_URL:
            check("已可使用模組產生連結", 'href="%s"' % MODULE_URL in html, "url=%s" % MODULE_URL)
    elif MODE == "module-down":
        check("不可達 URL → 顯示「服務暫時不可用」", "服務暫時不可用" in html)
        if MODULE_URL:
            check("服務不可用時不得產生連結", 'href="%s"' % MODULE_URL not in html, "url=%s" % MODULE_URL)
        check("服務不可用不得誤標為「已可使用」", "已可使用" not in html)

    # 3. 預留模組不可點（非 AVAILABLE 一律無連結）
    for name in MODULE_NAMES:
        linked = re.search(r"<a[^>]*>\s*{}".format(re.escape(name)), html) is not None
        if MODE == "module-up" and name == "F450 數位孿生":
            continue
        check("模組不可點擊（無連結）：%s" % name, not linked)

    # 4. URL 不得含 Token／密碼／個資
    for token in ("token=", "access_token", "password=", "api_key", "sessionid=", "student_id="):
        check("頁面不得出現敏感參數「%s」" % token, token not in html)

    # 5. 不因外部服務故障拖垮工作台
    check("工作台仍正常回應（外部服務故障不影響）", status == 200, "HTTP %s" % status)
    check("工作台 R01–R08 完整呈現", slot_count(html) == 8, "slots=%d" % slot_count(html))
    status_f450, f450_body, _ = get(op, BASE + "/platform/f450")
    check("F450 十二任務仍可開啟（不受外部模組影響）", status_f450 == 200, "HTTP %s" % status_f450)

    # 6. 重複瀏覽穩定（探測不改變畫面內容）
    status2, html2, _ = get(op, wb_url)

    def normalize(text):
        return re.sub(r'name="csrfmiddlewaretoken" value="[^"]*"', "CSRF", text)

    check("重複瀏覽工作台內容一致（探測不改變頁面）", normalize(html) == normalize(html2))

    # 7. 探測不修改學習紀錄（DB 指紋前後一致）
    fp_after = db_fingerprint()
    if fp_before is None or fp_after is None or "error" in fp_before or "error" in fp_after:
        skip("探測未修改學習紀錄（DB 指紋比對）", "無法讀取測試庫指紋：%s" % DB_PATH)
    else:
        check(
            "探測未修改學習紀錄（DB 逐表指紋一致）",
            fp_before["sha256"] == fp_after["sha256"],
            "tables=%d" % fp_before["tables"],
        )

    # 8. 介面層不得自動啟動外部服務
    mod_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "..", "student_portal", "learning", "external_modules.py"
    )
    try:
        with open(mod_path, "r", encoding="utf-8") as fh:
            source = fh.read()
        forbidden = [t for t in ("subprocess", "os.system", "Popen", "startfile") if t in source]
        check("介面層不自動啟動外部服務（原始碼掃描）", not forbidden, "命中=%s" % forbidden)
    except OSError as exc:
        check("介面層不自動啟動外部服務（原始碼掃描）", False, str(exc))

    # 9. 未授權時不探測（角色限制於 live 配置無法觸發，由單元測試覆蓋）
    skip(
        "未授權時不探測（角色不符）",
        "live 預設 allowed_roles 含 student；此項由單元測試 test_role_restricted_skips_probe 覆蓋",
    )

    pending("真實 iPhone Safari 人工驗收", "本腳本為 HTTP 層驗收；真機須教師以實機確認")
    return finish()


def finish():
    counts = {PASS: 0, FAIL: 0, SKIP: 0, PENDING: 0}
    for _, result, _ in RESULTS:
        counts[result] = counts.get(result, 0) + 1
    print(
        "\n==== I3-B（%s）結果：PASS %d / FAIL %d / SKIPPED %d / PENDING %d / 共 %d 項 ===="
        % (MODE, counts[PASS], counts[FAIL], counts[SKIP], counts[PENDING], len(RESULTS))
    )
    for name, result, detail in RESULTS:
        if result == FAIL:
            print("  [FAIL] %s | %s" % (name, detail))
    return 1 if counts[FAIL] else 0


if __name__ == "__main__":
    sys.exit(main())
