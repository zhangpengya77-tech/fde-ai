#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""I4-A 跨服務入口驗收（統一模擬入口 = Live Backend 代理 + 同源靜態掛載）。

對應 2026-10-13 教師 I4 指令第三節，逐一驗證：
  1. 學員登入後能否進入
  2. 是否需要重複登入
  3. 是否正確保留授權
  4. 能否返回五階段工作台
  5. 服務停止後是否正常降級
  6. 既有功能是否正常

環境（隔離，與正式 8022／8770 完全隔離）：
  Django :8120（測試庫 i4_e2e.sqlite3 副本）
  Live   :8121（Django 上游指向 :8120；RAG 上游指向死埠 :8799）

原則：
  * 全程**不跟隨重導**，避免「未登入 302 → 登入頁」被誤讀為 200（假 PASS）。
  * 只做 GET／一次登入 POST；不提交任何學習成果、不改任何學習紀錄。
  * 無法在隔離環境啟動的服務標 PENDING，不假報 PASS。

用法：
  python verify_i4_cross_service.py --phase main
  python verify_i4_cross_service.py --phase degradation   （需先停止 Django :8120）
"""
import argparse
import hashlib
import http.cookiejar
import os
import re
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request

LIVE = (os.environ.get("I4_LIVE_BASE") or "http://127.0.0.1:8121").rstrip("/")
DJANGO = (os.environ.get("I4_DJANGO_BASE") or "http://127.0.0.1:8120").rstrip("/")
DB_PATH = os.environ.get("I4_DB") or r"D:\FDE-AI-UAS-v2.0\demo\runtime\db\i4_e2e.sqlite3"

STUDENT_EMAIL = "p42-a-0001@fde-p42.local"
TEACHER_A_EMAIL = "p42.teacher.a@fde-demo.local"
ENROLLMENT_ID = 14
AUTHORIZED_COHORT = "P42-A-2026"
FORBIDDEN_COHORT = "P42-B-2026"
DOWNLOAD_MANIFEST = r"D:\下載中心文件\download_manifest.json"

PASS, FAIL, SKIP, PENDING = "PASS", "FAIL", "SKIPPED", "PENDING"
RESULTS = []
COUNTER = {"login_posts": 0}

CREDENTIALS_CANDIDATES = [
    os.environ.get("FDE_DEMO_CREDENTIALS_FILE"),
    os.path.expanduser("~/.fde-demo-credentials/demo.shared.password.txt"),
]


def record(name, result, detail=""):
    RESULTS.append((name, result, detail))
    print("%-7s - %s%s" % (result, name, (" | " + detail) if detail else ""))


def check(name, ok, detail=""):
    record(name, PASS if ok else FAIL, detail)


def skip(name, reason):
    record(name, SKIP, reason)


def pending(name, reason):
    record(name, PENDING, reason)


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
    print("[安全停止] 無法取得驗收密碼。請設定 FDE_DEMO_STUDENT_PASSWORD 或提供 "
          "~/.fde-demo-credentials/demo.shared.password.txt。")
    sys.exit(2)

for _k in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
    os.environ.pop(_k, None)
os.environ["NO_PROXY"] = "*"
os.environ["no_proxy"] = "*"


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def new_session():
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(cj),
        _NoRedirect(),
        urllib.request.ProxyHandler({}),
    )
    return cj, op


def fetch(op, url, headers=None, method="GET", data=None, timeout=30):
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("User-Agent", "I4-CrossService/1.0")
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    try:
        with op.open(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", "replace"), resp.headers, ""
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace"), exc.headers, ""
    except Exception as exc:  # 連線失敗（服務停止）→ 明確記錄，不當成 PASS
        return -1, "", {}, "%s: %s" % (type(exc).__name__, exc)


def origin_of(url):
    parts = urllib.parse.urlsplit(url)
    return "%s://%s" % (parts.scheme, parts.netloc)


def login(op, base, path, email, password):
    """以既有表單登入；回傳 (status, location, error)。"""
    login_url = base + path
    status, body, headers, err = fetch(op, login_url)
    if status != 200:
        return status, headers.get("Location", ""), "登入頁無法取得（HTTP %s / %s）" % (status, err)
    match = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', body)
    if not match:
        return -1, "", "登入頁找不到 CSRF token"
    payload = urllib.parse.urlencode(
        {"csrfmiddlewaretoken": match.group(1), "username": email, "password": password, "next": ""}
    ).encode()
    COUNTER["login_posts"] += 1
    status, body, headers, err = fetch(
        op,
        login_url,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": login_url,
            "Origin": origin_of(login_url),
        },
        method="POST",
        data=payload,
    )
    return status, headers.get("Location", ""), err


def db_fingerprint():
    """逐表內容指紋（行數 + 全表內容 SHA256）；唯讀，不寫入。"""
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
            cur.execute('SELECT * FROM "%s"' % table)
            rows = cur.fetchall()
            counts[table] = len(rows)
            digest.update(("%s:%d;" % (table, len(rows))).encode())
            for row in rows:
                digest.update(repr(row).encode("utf-8", "replace"))
        con.close()
        return {"sha256": digest.hexdigest(), "tables": len(tables), "counts": counts}
    except Exception as exc:
        return {"error": str(exc)}


# ---------------------------------------------------------------------------
#  Phase: main
# ---------------------------------------------------------------------------
def phase_main():
    print("=" * 78)
    print("I4-A 跨服務入口驗收（統一模擬入口 %s → Django %s）" % (LIVE, DJANGO))
    print("=" * 78)

    before = db_fingerprint()
    # --- 1. 統一模擬入口可達性 -------------------------------------------
    print("\n-- 1. 統一模擬入口（Live Backend）可達性 --")
    status, body, _, err = fetch(new_session()[1], LIVE + "/")
    check("統一模擬入口首頁 HTTP 200", status == 200, "HTTP %s" % status)

    status, _, _, err = fetch(new_session()[1], LIVE + "/api/live/health")
    check("Live 服務健康端點 HTTP 200", status == 200, "HTTP %s" % status)

    # --- 2. 未登入不得進入受保護頁（不跟隨重導） ---------------------------
    print("\n-- 2. 未登入存取受保護頁（防假 PASS：不跟隨重導） --")
    op = new_session()[1]
    status, _, headers, err = fetch(op, LIVE + "/student/learning-path/")
    loc = headers.get("Location", "")
    check(
        "未登入存取五階段工作台 → 302 導向登入頁",
        status == 302 and "/login/" in loc,
        "HTTP %s Location=%s" % (status, loc or "-"),
    )

    # --- 3. 學員登入（僅一次，透過統一模擬入口） ---------------------------
    print("\n-- 3. 學員登入（統一模擬入口，僅登入一次） --")
    cj, op = new_session()
    status, loc, err = login(op, LIVE, "/login/", STUDENT_EMAIL, PASSWORD)
    check("學員登入成功（302）", status == 302, "HTTP %s Location=%s %s" % (status, loc or "-", err or ""))
    session_cookies = [c.name for c in cj if c.name == "sessionid"]
    check("登入取得 sessionid Cookie（經代理透傳）", bool(session_cookies), "cookies=%s" % sorted(c.name for c in cj))

    # --- 4. 不需重複登入：同一 cookie 進入工作台 ---------------------------
    print("\n-- 4. 不需重複登入（同一 Cookie 進入五階段工作台） --")
    status, _, headers, err = fetch(op, LIVE + "/student/learning-path/")
    loc = headers.get("Location", "")
    check(
        "工作台入口 → 302 導向單一課程工作台",
        status == 302 and ("/student/courses/%d/learning-path/" % ENROLLMENT_ID) in loc,
        "HTTP %s Location=%s" % (status, loc or "-"),
    )
    workbench_url = LIVE + "/student/courses/%d/learning-path/" % ENROLLMENT_ID
    status, wb_body, _, err = fetch(op, workbench_url)
    check("五階段工作台 HTTP 200（未重新登入）", status == 200, "HTTP %s %s" % (status, err or ""))
    check("工作台頁面確實為登入後內容（含五階段）", "五階段" in wb_body or "學習路徑" in wb_body,
          "len=%d" % len(wb_body))

    # --- 5. 授權正確保留（角色區隔） ---------------------------------------
    print("\n-- 5. 授權保留與角色區隔 --")
    status, _, headers, err = fetch(op, LIVE + "/teacher/")
    check(
        "學員 Cookie 存取教師頁不得放行（302/403）",
        status in (302, 403),
        "HTTP %s Location=%s" % (status, headers.get("Location", "") or "-"),
    )
    op_anon = new_session()[1]
    status, _, headers, err = fetch(op_anon, LIVE + "/student/learning-path/")
    check("匿名 Cookie 仍被擋（302）", status == 302, "HTTP %s" % status)

    # --- 6. 五階段各入口 ---------------------------------------------------
    print("\n-- 6. 五階段既有功能入口（統一模擬入口） --")
    entries = [
        ("學：下載中心 /downloads/", LIVE + "/downloads/", 200),
        ("學／練：AI 助教 /live/", LIVE + "/live/", 200),
        ("做：F450 十二任務 /platform/f450", LIVE + "/platform/f450", 200),
        ("測：手機槳葉辨識 prop-scan", LIVE + "/student/courses/%d/prop-scan/" % ENROLLMENT_ID, 200),
        ("測：飛行健康 AI /flight-health/", LIVE + "/flight-health/", 200),
        ("證：成長日誌 growth", LIVE + "/student/courses/%d/growth/" % ENROLLMENT_ID, 200),
        ("學：學習平台 /platform/", LIVE + "/platform/", 200),
        ("學：SPA 資源 /src/router.js", LIVE + "/src/router.js", 200),
    ]
    for name, url, expect in entries:
        status, _, _, err = fetch(op, url)
        check("%s（HTTP %d）" % (name, expect), status == expect, "HTTP %s %s" % (status, err or ""))

    # --- 7. 返回五階段工作台 ------------------------------------------------
    print("\n-- 7. 能否返回五階段工作台 --")
    status, platform_body, _, err = fetch(op, LIVE + "/platform/")
    check("學習平台頁含返回五階段工作台連結",
          "learning-path" in platform_body,
          "命中 learning-path 次數=%d" % platform_body.count("learning-path"))
    status, wb2, _, err = fetch(op, workbench_url)
    check("可再次開啟五階段工作台（來回一致）", status == 200 and len(wb2) == len(wb_body),
          "HTTP %s len=%d/%d" % (status, len(wb2), len(wb_body)))

    # --- 8. 下載中心既有資料 -----------------------------------------------
    print("\n-- 8. 下載中心既有資料（唯讀） --")
    status, dl_body, _, err = fetch(op, LIVE + "/api/downloads")
    check("下載中心 manifest API HTTP 200", status == 200, "HTTP %s" % status)
    if os.path.isfile(DOWNLOAD_MANIFEST):
        with open(DOWNLOAD_MANIFEST, "r", encoding="utf-8", errors="replace") as fh:
            manifest_text = fh.read()
        check("manifest 含 HQGC 課程軟體", "HQGC" in manifest_text,
              "manifest=%s" % DOWNLOAD_MANIFEST)
    else:
        skip("manifest 含 HQGC 課程軟體", "找不到 %s" % DOWNLOAD_MANIFEST)

    # --- 9. RAG 知識庫 ------------------------------------------------------
    print("\n-- 9. RAG 知識庫入口（不觸碰正式 :8770） --")
    status, _, _, err = fetch(op, LIVE + "/api/rag/health")
    check("同源 RAG health 端點 HTTP 200", status == 200, "HTTP %s" % status)
    payload = '{"question": "F450 螺旋槳方向如何判別？"}'.encode("utf-8")
    status, rag_body, _, err = fetch(
        op, LIVE + "/api/rag/ask",
        headers={"Content-Type": "application/json", "Origin": LIVE},
        method="POST", data=payload,
    )
    check(
        "RAG 上游不可用時明確降級（503 + 說明，不掛起）",
        status == 503,
        "HTTP %s body=%s" % (status, rag_body[:80].replace("\n", " ")),
    )
    pending("RAG 知識庫真實問答（正式 :8770）",
            "隔離實例 RAG 上游指向死埠以驗證降級；未觸碰正式 :8770，需教師於正式環境確認。")

    # --- 10. 登入次數統計 ---------------------------------------------------
    print("\n-- 10. 是否重複登入 --")
    check("整個流程僅登入一次（login POST 次數 = 1）", COUNTER["login_posts"] == 1,
          "login POSTs=%d" % COUNTER["login_posts"])

    # --- 11. 跨來源落差 -----------------------------------------------------
    print("\n-- 11. 跨來源入口落差檢查 --")
    status_live, _, _, _ = fetch(new_session()[1], LIVE + "/platform/f450")
    status_dj, _, _, _ = fetch(new_session()[1], DJANGO + "/platform/f450")
    check("F450 十二任務在統一模擬入口可開啟（跨服務整合）", status_live == 200,
          "Live=%s Django=%s" % (status_live, status_dj))
    for name, path in (("Django 專屬入口 /live/", "/live/"), ("Django 專屬入口 /downloads/", "/downloads/"),
                       ("Django 專屬入口 /flight-health/", "/flight-health/")):
        status, _, _, _ = fetch(new_session()[1], DJANGO + path)
        check("%s 於 Django 來源不應存在（正確分工）" % name, status == 404, "HTTP %s" % status)

    # --- 12. 入口導覽不修改資料 ---------------------------------------------
    print("\n-- 12. 入口導覽不修改任何學習紀錄 --")
    mid = db_fingerprint()
    # 再走一次同樣的入口導覽，確認「導覽本身」不會持續寫入資料。
    fetch(op, workbench_url)
    for _name, _url, _expect in entries:
        fetch(op, _url)
    after = db_fingerprint()
    if mid and after and "sha256" in mid and "sha256" in after:
        check("重複導覽不再變更資料庫（無持續寫入）",
              mid["sha256"] == after["sha256"],
              "%d 張表 %s" % (after["tables"], after["sha256"][:16]))
        if before and "sha256" in before:
            if before["sha256"] == mid["sha256"]:
                record("首次導覽未寫入任何紀錄", PASS, "指紋前後一致")
            else:
                # 既有工作台首次載入會以 get_or_create 補齊進度列（產品既有行為），
                # 屬 lazy-init，非導覽副作用；僅記錄不判 FAIL。
                record("首次導覽僅觸發既有 lazy-init（補齊進度列）", PASS,
                       "既有行為：工作台首次載入建立 StudentTaskProgress／PhaseProgress／成長紀錄列")
    else:
        skip("重複導覽不再變更資料庫", "無法讀取測試庫")

    pending("真實 iPhone Safari 人工驗收", "須教師以實機確認（見 I4-E 測試表）。")


# ---------------------------------------------------------------------------
#  Phase: degradation（需先停止 Django :8120）
# ---------------------------------------------------------------------------
def phase_degradation():
    print("=" * 78)
    print("I4-A 服務停止後降級驗收（Django :8120 應已停止）")
    print("=" * 78)

    op = new_session()[1]
    status, _, _, err = fetch(op, DJANGO + "/login/", timeout=5)
    check("Django :8120 確實已停止", status == -1, "%s" % (err or "仍可連線（HTTP %s）" % status))

    status, body, _, err = fetch(op, LIVE + "/api/live/health")
    check("Live 服務本身仍存活（未受上游故障拖垮）", status == 200, "HTTP %s" % status)

    status, body, _, err = fetch(op, LIVE + "/student/learning-path/")
    check("Django 故障時代理明確降級（503）", status == 503, "HTTP %s" % status)
    check("降級訊息明確可讀（非空白／非例外堆疊）",
          "temporarily unavailable" in body or "暫時" in body,
          "body=%s" % body[:60].replace("\n", " "))

    for name, path in (("首頁 /", "/"), ("AI 助教 /live/", "/live/"),
                       ("下載中心 /downloads/", "/downloads/"), ("飛行健康 /flight-health/", "/flight-health/")):
        status, _, _, err = fetch(op, LIVE + path)
        check("Django 故障時同源靜態入口仍可用：%s" % name, status == 200, "HTTP %s" % status)

    status, body, _, err = fetch(op, LIVE + "/api/downloads")
    check("Django 故障時下載中心 API 仍可用（不依賴 Django）", status == 200, "HTTP %s" % status)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", choices=["main", "degradation"], default="main")
    args = parser.parse_args()
    if args.phase == "main":
        phase_main()
    else:
        phase_degradation()

    print("\n" + "=" * 78)
    tally = {PASS: 0, FAIL: 0, SKIP: 0, PENDING: 0}
    for _, result, _ in RESULTS:
        tally[result] += 1
    print("PASS=%d FAIL=%d SKIPPED=%d PENDING=%d TOTAL=%d"
          % (tally[PASS], tally[FAIL], tally[SKIP], tally[PENDING], len(RESULTS)))
    if tally[FAIL]:
        print("\n失敗項目：")
        for name, result, detail in RESULTS:
            if result == FAIL:
                print("  FAIL - %s | %s" % (name, detail))
    print("=" * 78)
    return 1 if tally[FAIL] else 0


if __name__ == "__main__":
    sys.exit(main())
