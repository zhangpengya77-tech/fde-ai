#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""P5 班級結訓成果報告驗收（2026-10-13 教師指令第六項 12 項）。

對獨立測試庫（demo/runtime/db/p42_verify.sqlite3）啟動的 Django :8112 進行 HTTP 驗收：
  1. 待複核卡片與學員篩選統計口徑一致
  2. 待教師複核與需要補充正確區分
  3. 班級人數與資料庫一致
  4. R01–R08 統計與資料庫一致
  5. 五階段完成狀態正確
  6. 教師回饋只顯示真實資料
  7. 跨班級報告不可越權
  8. 學員與未登入者不可查看教師報告
  9. 無資料空狀態
 10. A4 列印版面（print CSS／原生列印，無伺服器 PDF）
 11. 390×844 手機模擬（版面由截圖工具驗證；此處驗證 media query 存在）
 12. 成果證據沿用既有授權檢查（縮圖走 evidence_download，跨班級不可下載）

所有期望值皆由獨立測試庫唯讀查詢後在腳本內重新推導（不引用產品程式碼）。
憑證不寫入程式。
"""
import http.cookiejar
import os
import re
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = "http://192.168.1.114:8112"
DB = r"D:\FDE-AI-UAS-v2.0\demo\runtime\db\p42_verify.sqlite3"
COHORT_A = "P42-A-2026"
COHORT_B = "P42-B-2026"
COHORT_C = "P42-C-2026"  # 無學員空班級
TEACHER_A = "p42.teacher.a@fde-demo.local"
TEACHER_B = "p42.teacher.b@fde-demo.local"
STUDENT_A = "p42-a-0001@fde-p42.local"

SUBMITTED_STATUSES = {"submitted", "needs_revision", "approved", "rejected"}
REVIEWED_STATUSES = {"needs_revision", "approved", "rejected"}
STAGE_KEYS = ("learn", "practice", "build", "assess", "certify")
SLOTS = ["R0%d" % i for i in range(1, 9)]

RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    print("%s - %s%s" % ("PASS" if ok else "FAIL", name, (" | " + detail) if detail else ""))


# ---------------------------------------------------------------------------
# 憑證（不寫入程式）
# ---------------------------------------------------------------------------
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
STUDENT_PASSWORD = load_password("FDE_DEMO_STUDENT_PASSWORD")
if not TEACHER_PASSWORD:
    print("[安全停止] 無法取得教師密碼：請設定 FDE_DEMO_TEACHER_PASSWORD 或提供憑證檔。")
    sys.exit(2)


# ---------------------------------------------------------------------------
# HTTP 工具
# ---------------------------------------------------------------------------
def new_session():
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(jar)
    )
    return jar, opener


def get(opener, url, referer=None):
    request = urllib.request.Request(
        url, headers={"User-Agent": "P5-VERIFY/1.0", "Referer": referer or BASE + "/"}
    )
    try:
        with opener.open(request, timeout=30) as response:
            return response.status, response.read().decode("utf-8", "replace"), response.geturl()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace"), url


def get_raw(opener, url, referer=None):
    request = urllib.request.Request(
        url, headers={"User-Agent": "P5-VERIFY/1.0", "Referer": referer or BASE + "/"}
    )
    try:
        with opener.open(request, timeout=30) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def post(opener, url, data, referer):
    body = urllib.parse.urlencode(data).encode()
    parts = urllib.parse.urlsplit(referer)
    request = urllib.request.Request(
        url,
        data=body,
        headers={
            "User-Agent": "P5-VERIFY/1.0",
            "Referer": referer,
            "Origin": "%s://%s" % (parts.scheme, parts.netloc),
        },
    )
    try:
        with opener.open(request, timeout=30) as response:
            return response.status, response.read().decode("utf-8", "replace"), response.geturl()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace"), url


def login(opener, jar, path, email, password):
    _status, page, _final = get(opener, BASE + path)
    token = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', page)
    if not token:
        for cookie in jar:
            if cookie.name == "csrftoken":
                token = type("T", (), {"group": lambda self, c: c.value})()
                token.group = lambda i, c=cookie: c.value
                break
    return post(
        opener,
        BASE + path,
        {
            "username": email,
            "password": password,
            "csrfmiddlewaretoken": token.group(1) if token else "",
        },
        BASE + path,
    )


def login_teacher(email):
    jar, opener = new_session()
    status, _page, final = login(opener, jar, "/teacher/login/", email, TEACHER_PASSWORD)
    return opener, status, final


# ---------------------------------------------------------------------------
# 獨立測試庫唯讀基準
# ---------------------------------------------------------------------------
def fmt_uuid(raw):
    """SQLite 以 32 字元無連字號儲存 UUIDField；URL 需帶連字號格式。"""
    text = str(raw)
    if len(text) == 32 and "-" not in text:
        return "%s-%s-%s-%s-%s" % (text[0:8], text[8:12], text[12:16], text[16:20], text[20:32])
    return text


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102
        return None


def get_noredirect(url, referer=None):
    """不跟隨重導，觀察第一手狀態碼（用於驗證未登入被擋）。"""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
    request = urllib.request.Request(
        url, headers={"User-Agent": "P5-VERIFY/1.0", "Referer": referer or BASE + "/"}
    )
    try:
        with opener.open(request, timeout=30) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def db_truth():
    con = sqlite3.connect("file:{}?mode=ro".format(DB), uri=True)
    con.row_factory = sqlite3.Row
    truth = {"cohorts": {}, "students": {}, "growth": {}, "tasks": {}, "phases": {}, "feedback": [], "evidence": []}
    for row in con.execute("SELECT cohort_id, name FROM learning_cohort WHERE cohort_id IN (?,?,?)", (COHORT_A, COHORT_B, COHORT_C)):
        truth["cohorts"][row["cohort_id"]] = row["name"]
    for row in con.execute(
        "SELECT e.id AS eid, e.cohort_id AS cid, sp.public_user_id AS sid, sp.nickname AS nickname "
        "FROM learning_enrollment e JOIN learning_studentprofile sp ON sp.student_id = e.student_id "
        "WHERE e.active = 1 AND e.cohort_id IN (?,?,?)",
        (COHORT_A, COHORT_B, COHORT_C),
    ):
        truth["students"][row["eid"]] = {"sid": row["sid"], "cid": row["cid"], "nickname": row["nickname"]}
    for row in con.execute(
        "SELECT s.enrollment_id AS eid, d.slot_id AS slot, d.title AS title, s.status AS status "
        "FROM learning_growthrecordsubmission s "
        "JOIN learning_growthrecorddefinition d ON d.id = s.definition_id "
        "WHERE s.enrollment_id IN (SELECT id FROM learning_enrollment WHERE active = 1 AND cohort_id IN (?,?,?))",
        (COHORT_A, COHORT_B, COHORT_C),
    ):
        truth["growth"].setdefault(row["eid"], {})[row["slot"]] = {
            "status": row["status"],
            "title": row["title"],
        }
    for row in con.execute(
        "SELECT st.enrollment_id AS eid, t.task_id AS task_id "
        "FROM learning_studenttaskprogress st JOIN learning_taskdefinition t ON t.task_id = st.task_id "
        "WHERE st.status = 'submitted' "
        "AND st.enrollment_id IN (SELECT id FROM learning_enrollment WHERE active = 1 AND cohort_id IN (?,?,?))",
        (COHORT_A, COHORT_B, COHORT_C),
    ):
        truth["tasks"].setdefault(row["eid"], []).append(row["task_id"])
    for row in con.execute(
        "SELECT p.enrollment_id AS eid, p.phase AS phase, p.status AS status "
        "FROM learning_phaseprogress p "
        "WHERE p.enrollment_id IN (SELECT id FROM learning_enrollment WHERE active = 1 AND cohort_id IN (?,?,?))",
        (COHORT_A, COHORT_B, COHORT_C),
    ):
        truth["phases"].setdefault(row["eid"], {})[row["phase"]] = row["status"]
    for row in con.execute(
        "SELECT r.teacher_note AS note, r.review_status AS review_status, sp.public_user_id AS sid, d.slot_id AS slot "
        "FROM learning_growthrecordreview r "
        "JOIN learning_growthrecordsubmission s ON s.id = r.submission_id "
        "JOIN learning_enrollment e ON e.id = s.enrollment_id "
        "JOIN learning_studentprofile sp ON sp.student_id = e.student_id "
        "JOIN learning_growthrecorddefinition d ON d.id = s.definition_id "
        "WHERE e.cohort_id IN (?,?,?) AND TRIM(COALESCE(r.teacher_note,'')) <> ''",
        (COHORT_A, COHORT_B, COHORT_C),
    ):
        truth["feedback"].append(
            {"note": row["note"].strip(), "sid": row["sid"], "slot": row["slot"], "status": row["review_status"]}
        )
    for row in con.execute(
        "SELECT ev.evidence_id AS eid, ev.evidence_type AS etype, ev.upload AS upload, "
        "e.cohort_id AS cid, sp.public_user_id AS sid "
        "FROM learning_evidence ev "
        "JOIN learning_growthrecordsubmission s ON s.id = ev.growth_submission_id "
        "JOIN learning_enrollment e ON e.id = s.enrollment_id "
        "JOIN learning_studentprofile sp ON sp.student_id = e.student_id "
        "WHERE e.cohort_id IN (?,?,?)",
        (COHORT_A, COHORT_B, COHORT_C),
    ):
        truth["evidence"].append(
            {
                "eid": fmt_uuid(row["eid"]),
                "etype": row["etype"],
                "has_upload": bool((row["upload"] or "").strip()),
                "cid": row["cid"],
                "sid": row["sid"],
            }
        )
    con.close()
    return truth


def cohort_expected(truth, cid):
    """獨立推導某班級的報告期望值。"""
    eids = [eid for eid, info in truth["students"].items() if info["cid"] == cid]
    pending_items = 0
    needs_items = 0
    students_with_pending = 0
    slot_submitted = {slot: 0 for slot in SLOTS}
    slot_reviewed = {slot: 0 for slot in SLOTS}
    stage_done = {key: 0 for key in STAGE_KEYS}
    total_submitted = 0
    total_reviewed = 0
    for eid in eids:
        growth = truth["growth"].get(eid, {})
        student_pending = 0
        for slot in SLOTS:
            item = growth.get(slot)
            if item is None:
                continue
            if item["status"] in SUBMITTED_STATUSES:
                slot_submitted[slot] += 1
                total_submitted += 1
            if item["status"] in REVIEWED_STATUSES:
                slot_reviewed[slot] += 1
                total_reviewed += 1
            if item["status"] == "submitted":
                student_pending += 1
                pending_items += 1
            elif item["status"] == "needs_revision":
                needs_items += 1
        for _task in truth["tasks"].get(eid, []):
            student_pending += 1
            pending_items += 1
        if student_pending > 0:
            students_with_pending += 1
        phases = truth["phases"].get(eid, {})
        for key in STAGE_KEYS:
            if phases.get(key) == "completed":
                stage_done[key] += 1
    return {
        "student_count": len(eids),
        "pending_items": pending_items,
        "needs_items": needs_items,
        "students_with_pending": students_with_pending,
        "slot_submitted": slot_submitted,
        "slot_reviewed": slot_reviewed,
        "stage_done": stage_done,
        "total_submitted": total_submitted,
        "total_reviewed": total_reviewed,
        "feedback": [f for f in truth["feedback"] if f["sid"] in {truth["students"][e]["sid"] for e in eids}],
        "not_submitted": sum(
            1
            for eid in eids
            if sum(1 for v in truth["growth"].get(eid, {}).values() if v["status"] in SUBMITTED_STATUSES) == 0
        ),
        "all_submitted": sum(
            1
            for eid in eids
            if sum(1 for v in truth["growth"].get(eid, {}).values() if v["status"] in SUBMITTED_STATUSES) == 8
        ),
    }


# ---------------------------------------------------------------------------
# 頁面解析小工具
# ---------------------------------------------------------------------------
def stat_value(html, label):
    m = re.search(
        r'trp-stat-num[^>]*>\s*(\d+)\s*<[^>]*>\s*<span class="trp-stat-label">%s' % re.escape(label),
        html,
        re.S,
    )
    return int(m.group(1)) if m else None


def stage_done_value(html, character):
    m = re.search(
        r"<td data-label=\"階段\">%s｜[^<]*</td>\s*<td data-label=\"完成人數\">(\d+) 人</td>" % re.escape(character),
        html,
        re.S,
    )
    return int(m.group(1)) if m else None


def slot_row(html, slot):
    m = re.search(
        r"<td data-label=\"紀錄\">%s</td>.*?<td data-label=\"已提交（人）\">(\d+) / (\d+)</td>.*?"
        r"<td data-label=\"已複核（人）\">(\d+) / (\d+)</td>" % re.escape(slot),
        html,
        re.S,
    )
    return (int(m.group(1)), int(m.group(3))) if m else (None, None)


def main():
    truth = db_truth()
    opener_a, status_a, _final = login_teacher(TEACHER_A)
    opener_b, status_b, _final = login_teacher(TEACHER_B)
    check("A 師登入成功", status_a == 200, "HTTP %s" % status_a)
    check("B 師登入成功", status_b == 200, "HTTP %s" % status_b)

    # ── 1. 口徑一致（P5-A）─────────────────────────────────────────────
    for cid, opener in ((COHORT_A, opener_a), (COHORT_B, opener_b)):
        expected = cohort_expected(truth, cid)
        status, html, _ = get(opener, "%s/teacher/class-outcomes/?cohort=%s" % (BASE, cid))
        card = None
        m = re.search(
            r'tco-stat-num[^>]*>\s*(\d+)\s*<[^>]*>\s*<span class="tco-stat-label">待複核成果（筆）', html, re.S
        )
        if m:
            card = int(m.group(1))
        m2 = re.search(r"目前\s*(\d+)\s*人", html)
        people = int(m2.group(1)) if m2 else None
        check(
            "口徑一致：%s 卡片筆數＝DB 待複核項目數" % cid,
            card == expected["pending_items"],
            "頁面 %s ｜ DB %s" % (card, expected["pending_items"]),
        )
        check(
            "口徑一致：%s 篩選人數＝DB 有待複核學員數" % cid,
            people == expected["students_with_pending"],
            "頁面 %s ｜ DB %s" % (people, expected["students_with_pending"]),
        )
        check(
            "口徑一致：%s 卡片（筆）與篩選（人）為同一集合（筆 ≥ 人）" % cid,
            card is not None and people is not None and card >= people,
            "筆 %s ｜ 人 %s" % (card, people),
        )

    # ── 2. 待教師複核與需要補充正確區分 ────────────────────────────────
    for cid, opener in ((COHORT_A, opener_a), (COHORT_B, opener_b)):
        expected = cohort_expected(truth, cid)
        _status, html, _ = get(opener, "%s/teacher/class-outcomes/?cohort=%s" % (BASE, cid))
        m = re.search(r"另有需要補充\s*(\d+)\s*筆", html)
        needs = int(m.group(1)) if m else None
        check(
            "區分：%s 需要補充筆數與 DB 一致" % cid,
            needs == expected["needs_items"],
            "頁面 %s ｜ DB %s" % (needs, expected["needs_items"]),
        )
        check(
            "區分：%s 同時具備待教師複核與需要補充標籤" % cid,
            ("tco-pending-state-submitted" in html or "待教師複核" in html) and "需要補充" in html,
            "chips present",
        )

    # ── 3–6. 報告頁：人數／R01–R08／五階段／教師回饋 ────────────────────
    for cid, opener in ((COHORT_A, opener_a), (COHORT_B, opener_b)):
        expected = cohort_expected(truth, cid)
        url = "%s/teacher/class-report/%s/" % (BASE, cid)
        status, html, _ = get(opener, url)
        check("報告頁可開啟：%s" % cid, status == 200, "HTTP %s" % status)

        value = stat_value(html, "學員總人數（人）")
        check(
            "班級人數與 DB 一致：%s" % cid,
            value == expected["student_count"],
            "頁面 %s ｜ DB %s" % (value, expected["student_count"]),
        )

        submitted = stat_value(html, "R01–R08 已提交（筆）")
        reviewed = stat_value(html, "R01–R08 已複核（筆）")
        check(
            "R01–R08 已提交總數與 DB 一致：%s" % cid,
            submitted == expected["total_submitted"],
            "頁面 %s ｜ DB %s" % (submitted, expected["total_submitted"]),
        )
        check(
            "R01–R08 已複核總數與 DB 一致：%s" % cid,
            reviewed == expected["total_reviewed"],
            "頁面 %s ｜ DB %s" % (reviewed, expected["total_reviewed"]),
        )

        mismatched = []
        for slot in SLOTS:
            page_sub, page_rev = slot_row(html, slot)
            if page_sub != expected["slot_submitted"][slot] or page_rev != expected["slot_reviewed"][slot]:
                mismatched.append(slot)
        check(
            "R01–R08 逐槽提交／複核統計與 DB 一致：%s" % cid,
            not mismatched,
            "不一致：%s" % (mismatched or "無"),
        )

        stage_bad = []
        for key, character in zip(STAGE_KEYS, ("學", "練", "做", "測", "證")):
            page_done = stage_done_value(html, character)
            if page_done != expected["stage_done"][key]:
                stage_bad.append("%s(頁%s/DB%s)" % (key, page_done, expected["stage_done"][key]))
        check(
            "五階段完成數符合 completed 定義：%s" % cid,
            not stage_bad,
            "不一致：%s" % (stage_bad or "無"),
        )

        m = re.search(r"教師回饋（(\d+) 筆）", html)
        page_fb = int(m.group(1)) if m else None
        check(
            "教師回饋筆數與 DB 真實評語數一致：%s" % cid,
            page_fb == len(expected["feedback"]),
            "頁面 %s ｜ DB %s" % (page_fb, len(expected["feedback"])),
        )
        missing_note = [f["note"] for f in expected["feedback"] if f["note"] not in html]
        check(
            "教師回饋逐筆為真實評語（頁面可找到原文）：%s" % cid,
            not missing_note,
            "缺漏 %s" % (missing_note or "無"),
        )
        if not expected["feedback"]:
            check(
                "無真實評語時顯示「尚無紀錄」：%s" % cid,
                "尚無紀錄" in html,
                "empty state present",
            )

        # 報告為唯讀（不得含任何寫入表單；base.html 的登出表單不在此限）
        write_forms = re.findall(r'<form[^>]*method="post"[^>]*action="([^"]*)"', html, re.I)
        check(
            "報告頁為唯讀（無任何寫入表單）：%s" % cid,
            all("/logout/" in action for action in write_forms),
            "post forms=%s" % (write_forms or "無"),
        )
        check(
            "報告頁不含複核提交端點：%s" % cid,
            "growth-reviews" not in html,
            "no review endpoint",
        )

    # ── 7. 跨班級不可越權 ─────────────────────────────────────────────
    status, _html, _ = get(opener_a, "%s/teacher/class-report/%s/" % (BASE, COHORT_B))
    check("A 師不得查看 B 班報告（404）", status == 404, "HTTP %s" % status)
    status, _html, _ = get(opener_b, "%s/teacher/class-report/%s/" % (BASE, COHORT_A))
    check("B 師不得查看 A 班報告（404）", status == 404, "HTTP %s" % status)
    status, _html, _ = get(opener_a, "%s/teacher/class-outcomes/?cohort=%s" % (BASE, COHORT_B))
    body_ok = status == 200 and COHORT_B not in re.sub(r"<option[^>]*>[^<]*</option>", "", _html)
    check("A 師越權查詢 B 班成果總覽不洩漏學員", body_ok, "HTTP %s" % status)

    # ── 8. 學員與未登入者不可查看 ──────────────────────────────────────
    anon_jar, anon = new_session()
    status, _html, final = get(anon, "%s/teacher/class-report/%s/" % (BASE, COHORT_A))
    check(
        "未登入存取報告重導教師登入",
        status == 200 and "/teacher/login/" in final,
        "HTTP %s ｜ %s" % (status, final),
    )
    if STUDENT_PASSWORD:
        jar, opener = new_session()
        login(opener, jar, "/login/", STUDENT_A, STUDENT_PASSWORD)
        status, _html, final = get(opener, "%s/teacher/class-report/%s/" % (BASE, COHORT_A))
        check(
            "學員存取報告為 403",
            status == 403,
            "HTTP %s ｜ %s" % (status, final),
        )
    else:
        check("學員存取報告為 403", False, "無學員憑證可測（略過）")

    # ── 9. 無資料空狀態（C 班：無學員）────────────────────────────────
    status, html, _ = get(opener_a, "%s/teacher/class-report/%s/" % (BASE, COHORT_C))
    check("空班級報告可開啟", status == 200, "HTTP %s" % status)
    check(
        "空班級顯示「尚無紀錄」",
        "尚無紀錄" in html,
        "empty state present",
    )
    check(
        "空班級人數為 0",
        stat_value(html, "學員總人數（人）") == 0,
        "頁面 %s" % stat_value(html, "學員總人數（人）"),
    )
    check(
        "空班級不顯示任何虛構評語",
        "尚無紀錄（目前尚無任何教師評語或回饋）" in html,
        "feedback empty state",
    )

    # ── 10. A4 列印版面 ───────────────────────────────────────────────
    status, css, _ = get(opener_a, "%s/static/learning/teacher-report.css" % BASE)
    check("列印樣式檔可取得", status == 200 and len(css) > 500, "HTTP %s ｜ %d bytes" % (status, len(css)))
    check("含 A4 頁面設定 @page", "@page" in css and "A4" in css, "@page size A4")
    check("含 print media query", "@media print" in css, "media print present")
    check(
        "列印時隱藏導覽列與工具列",
        re.search(r"@media print\{[^}]*\.topbar", css, re.S) is not None and ".trp-toolbar" in css,
        "hidden in print",
    )
    check(
        "列印時表頭重複且列不跨頁",
        "table-header-group" in css and "break-inside:avoid" in css,
        "pagination rules present",
    )
    status, html, _ = get(opener_a, "%s/teacher/class-report/%s/" % (BASE, COHORT_A))
    check("報告頁載入列印樣式", "teacher-report.css" in html, "css linked")
    check("報告頁提供列印按鈕（原生列印）", 'id="print-report"' in html and "window.print()" in html, "print button")
    check(
        "未開發伺服器 PDF 產生器",
        "/report.pdf" not in html and "pdf" not in html.lower().split("teacher-report.css")[0][-200:].lower(),
        "no server pdf",
    )
    order = [
        html.find("班級基本資料"),
        html.find("班級成果摘要"),
        html.find("五階段學習概況"),
        html.find("R01–R08 成長成果"),
        html.find("學員成果列表"),
        html.find("教師回饋"),
    ]
    check(
        "版面順序符合指令（基本資料→摘要→五階段→R01–R08→學員列表→教師回饋）",
        all(index >= 0 for index in order) and order == sorted(order),
        "order=%s" % order,
    )

    # ── 11. 手機 390×844 ──────────────────────────────────────────────
    check(
        "含手機 390px media query（單欄、表格轉卡片）",
        "@media (max-width:680px)" in css and "trp-table thead{display:none}" in css,
        "mobile rules present",
    )
    check(
        "手機控制項 ≥44px",
        "min-height:44px" in css,
        "touch target rule present",
    )

    # ── 12. 成果證據授權 ──────────────────────────────────────────────
    status, html, _ = get(opener_a, "%s/teacher/class-report/%s/" % (BASE, COHORT_A))
    check(
        "報告頁證據縮圖走既有授權端點",
        "/evidence/" in html and "inline=1" in html,
        "uses evidence_download",
    )
    check(
        "報告頁不產生無需登入的公開證據網址",
        not re.search(r'src="https?://(?!192\.168\.1\.114:8112)', html),
        "no external media src",
    )
    a_uploaded = [e for e in truth["evidence"] if e["cid"] == COHORT_A and e["has_upload"]]
    b_uploaded = [e for e in truth["evidence"] if e["cid"] == COHORT_B and e["has_upload"]]
    check(
        "測試資料含可下載的成果證據（含上傳檔案）",
        bool(a_uploaded) and bool(b_uploaded),
        "A %d 筆 ｜ B %d 筆" % (len(a_uploaded), len(b_uploaded)),
    )
    if b_uploaded:
        status, _body = get_raw(opener_a, "%s/evidence/%s/download/?inline=1" % (BASE, b_uploaded[0]["eid"]))
        check("跨班級教師不得下載他班證據（404）", status == 404, "HTTP %s" % status)
    if a_uploaded:
        status, body = get_raw(opener_a, "%s/evidence/%s/download/?inline=1" % (BASE, a_uploaded[0]["eid"]))
        check(
            "授權教師可取得本班證據",
            status == 200 and len(body) > 0,
            "HTTP %s ｜ %d bytes" % (status, len(body)),
        )
    if a_uploaded:
        status, body = get_noredirect("%s/evidence/%s/download/" % (BASE, a_uploaded[0]["eid"]))
        check(
            "未登入者不得下載學員證據（重導登入）",
            status in (301, 302, 303, 403, 404),
            "HTTP %s" % status,
        )
        # 已登入的授權教師仍可正常取得（對照組）
        status_auth, body_auth = get_raw(opener_a, "%s/evidence/%s/download/" % (BASE, a_uploaded[0]["eid"]))
        check(
            "同一檔案授權教師可下載（對照組）",
            status_auth == 200 and len(body_auth) > 0,
            "HTTP %s ｜ %d bytes" % (status_auth, len(body_auth)),
        )

    print("")
    passed = sum(1 for row in RESULTS if row[1])
    print("==== P5 班級成果報告驗收結果：%d 項通過 / %d 項失敗 / 共 %d 項 ====" % (
        passed, len(RESULTS) - passed, len(RESULTS)))
    print("NOTE: 390×844 為 Chrome 設備模擬；未視為真實 iPhone Safari 驗收。")
    return 0 if passed == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
