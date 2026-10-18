#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""P4.2 多班級、多學員驗收（2026-10-13 教師指令第三項）。

對獨立測試庫（demo/runtime/db/p42_verify.sqlite3）啟動的 Django :8112 進行 HTTP 驗收：
  A. 五種學員進度篩選（全部／尚未提交／部分提交／八項已提交／有待複核成果）
  B. 多班級多學員（2 班 × 3 學員）矩陣與統計一致性
  C. 教師權限隔離（2 位授權範圍不同的教師；越權班級不洩漏）
  D. 四種排序（含穩定次要鍵、缺失時間排最後）與多條件組合篩選
  E. 統計卡片與五階段完成數對 DB 一致性
所有期望值皆由獨立測試庫唯讀查詢後在腳本內重新推導（不引用產品程式碼），
避免「用產品邏輯驗證產品」。憑證不寫入程式。
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
TEACHER_A = "p42.teacher.a@fde-demo.local"
TEACHER_B = "p42.teacher.b@fde-demo.local"

SUBMITTED_STATUSES = {"submitted", "needs_revision", "approved", "rejected"}
STAGE_KEYS = ("learn", "practice", "build", "assess", "certify")
STAGE_CHARS = {"learn": "學", "practice": "練", "build": "做", "assess": "測", "certify": "證"}

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
        url, headers={"User-Agent": "P42-VERIFY/1.0", "Referer": referer or BASE + "/"}
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
            "User-Agent": "P42-VERIFY/1.0",
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
                token = type("T", (), {"group": lambda self, i: cookie.value})()
                break
    return post(
        opener,
        BASE + path,
        {"username": email, "password": password, "csrfmiddlewaretoken": token.group(1) if token else ""},
        BASE + path,
    )


# ---------------------------------------------------------------------------
# 獨立測試庫唯讀基準
# ---------------------------------------------------------------------------
def db_truth():
    con = sqlite3.connect("file:{}?mode=ro".format(DB), uri=True)
    con.row_factory = sqlite3.Row
    truth = {"cohorts": [COHORT_A, COHORT_B], "students": {}, "nicknames": {}, "cohort_of": {}}
    truth["authorized"] = {}
    for row in con.execute(
        "SELECT u.username AS teacher, a.cohort_id AS cohort_id FROM learning_teachercohortaccess a "
        "JOIN auth_user u ON u.id = a.teacher_id WHERE u.username IN (?, ?)",
        (TEACHER_A, TEACHER_B),
    ):
        truth["authorized"].setdefault(row["teacher"], set()).add(row["cohort_id"])
    for row in con.execute(
        "SELECT e.id AS eid, e.cohort_id AS cohort_id, sp.public_user_id AS sid, sp.nickname AS nickname "
        "FROM learning_enrollment e JOIN learning_studentprofile sp ON sp.student_id = e.student_id "
        "WHERE e.active = 1 AND e.cohort_id IN (?, ?)",
        (COHORT_A, COHORT_B),
    ):
        truth["students"][row["eid"]] = row["sid"]
        truth["nicknames"][row["eid"]] = row["nickname"]
        truth["cohort_of"][row["eid"]] = row["cohort_id"]
    truth["growth"] = {}
    for row in con.execute(
        "SELECT s.enrollment_id AS eid, d.slot_id AS slot, s.status AS status, s.submitted_at AS submitted_at "
        "FROM learning_growthrecordsubmission s "
        "JOIN learning_growthrecorddefinition d ON d.id = s.definition_id "
        "WHERE s.enrollment_id IN (SELECT id FROM learning_enrollment WHERE active = 1 AND cohort_id IN (?, ?))",
        (COHORT_A, COHORT_B),
    ):
        truth["growth"].setdefault(row["eid"], {})[row["slot"]] = (row["status"], row["submitted_at"])
    truth["tasks"] = {}
    for row in con.execute(
        "SELECT st.enrollment_id AS eid, t.task_id AS task_id, st.submitted_at AS submitted_at "
        "FROM learning_studenttaskprogress st JOIN learning_taskdefinition t ON t.task_id = st.task_id "
        "WHERE st.status = 'submitted' "
        "AND st.enrollment_id IN (SELECT id FROM learning_enrollment WHERE active = 1 AND cohort_id IN (?, ?))",
        (COHORT_A, COHORT_B),
    ):
        truth["tasks"].setdefault(row["eid"], []).append((row["task_id"], row["submitted_at"]))
    truth["phases"] = {}
    for row in con.execute(
        "SELECT p.enrollment_id AS eid, p.phase AS phase, p.status AS status FROM learning_phaseprogress p "
        "WHERE p.enrollment_id IN (SELECT id FROM learning_enrollment WHERE active = 1 AND cohort_id IN (?, ?))",
        (COHORT_A, COHORT_B),
    ):
        truth["phases"].setdefault(row["eid"], {})[row["phase"]] = row["status"]
    con.close()
    return truth


def enrolled_in(truth, cohort_id):
    return [eid for eid, cid in truth["cohort_of"].items() if cid == cohort_id]


def student_counts(truth, eid):
    """P5-A（2026-10-13）：待複核為單一工作項目集合＝成長紀錄 submitted ＋ 任務提交 submitted。

    與班級卡片「待複核成果（筆）」使用同一集合（僅單位不同：卡片為筆、篩選為人）。
    """
    slots = truth["growth"].get(eid, {})
    submitted = sum(1 for value in slots.values() if value[0] in SUBMITTED_STATUSES)
    pending = sum(1 for value in slots.values() if value[0] == "submitted")
    pending += len(truth["tasks"].get(eid, []))
    return submitted, pending


def class_expected(truth, cohort_id):
    eids = enrolled_in(truth, cohort_id)
    submitted_map = {eid: student_counts(truth, eid)[0] for eid in eids}
    pending_items = sum(student_counts(truth, eid)[1] for eid in eids)
    return {
        "students": len(eids),
        "pending_items": pending_items,
        "none": [eid for eid in eids if submitted_map[eid] == 0],
        "partial": [eid for eid in eids if 1 <= submitted_map[eid] <= 7],
        "complete": [eid for eid in eids if submitted_map[eid] == 8],
        "pending": [eid for eid in eids if student_counts(truth, eid)[1] > 0],
        "not_submitted": len([eid for eid in eids if submitted_map[eid] == 0]),
        "all_submitted": len([eid for eid in eids if submitted_map[eid] == 8]),
    }


def expected_pending_rows(truth, cohort_id, record="", kind="", status="all"):
    """依 DB 推導待複核清單（與產品無關的獨立實作）。"""
    rows = []
    for eid in enrolled_in(truth, cohort_id):
        for slot, (status_key, stamp) in truth["growth"].get(eid, {}).items():
            if status_key not in ("submitted", "needs_revision"):
                continue
            if record and slot != record:
                continue
            if kind and kind != "growth":
                continue
            if status != "all" and status_key != status:
                continue
            rows.append(
                {
                    "code": slot,
                    "kind": "成長紀錄",
                    "sid": truth["students"][eid],
                    "name": truth["nicknames"][eid],
                    "stamp": stamp,
                    "status_key": status_key,
                    "slots": (slot,),
                }
            )
        for task_id, stamp in truth["tasks"].get(eid, []):
            code = "M" + task_id[1:]
            if kind and kind != "task":
                continue
            if status != "all" and status != "submitted":
                continue
            if record:
                # 任務僅在 P2 對應表對應時才納入；由產品外的對應表推導。
                if record not in TASK_SLOT_HINTS.get(task_id, ()):
                    continue
            rows.append(
                {
                    "code": code,
                    "kind": "任務",
                    "sid": truth["students"][eid],
                    "name": truth["nicknames"][eid],
                    "stamp": stamp,
                    "status_key": "submitted",
                    "slots": TASK_SLOT_HINTS.get(task_id, ()),
                }
            )
    return rows


# P2 對應表（獨立抄錄，用於驗證「任務不強制歸類」；T10 刻意無對應）
TASK_SLOT_HINTS = {"T01": ("R01",), "T02": ("R02",), "T03": ("R03",), "T04": ("R04",),
                   "T05": ("R05",), "T06": ("R05",), "T07": ("R07",), "T08": ("R07",),
                   "T09": ("R06",), "T11": ("R07",), "T12": ("R08",)}


def record_key(code):
    code = (code or "").upper()
    prefix, digits = code[:1], code[1:]
    group = 0 if prefix == "R" else 1
    try:
        number = int(digits)
    except ValueError:
        number = 10 ** 6
    return (group, number, code)


def _name_key(row):
    return (row["name"].lower(), row["sid"])


def _record_key(row):
    return record_key(row["code"])


def _time_key(row):
    return (row["stamp"] is None, row["stamp"] or "")


def sort_expected_rows(rows, mode):
    """依 P4.1／P4.2 已記載規格獨立實作：主鍵＋穩定次要鍵（名稱→紀錄→時間）。

    oldest/newest：時間（缺失最後）→ 名稱 → 紀錄
    student_asc ：名稱 → 紀錄 → 時間
    record_asc  ：紀錄（R 群先於 M 群、數字升序）→ 名稱 → 時間
    """
    ordered = list(rows)
    ordered.sort(key=_time_key)     # 第三鍵
    ordered.sort(key=_record_key)   # 第二鍵
    ordered.sort(key=_name_key)     # 第二鍵
    if mode == "student_asc":
        ordered.sort(key=_name_key)
    elif mode == "record_asc":
        ordered.sort(key=_record_key)
    else:
        stamped = [row for row in ordered if row["stamp"] is not None]
        unstamped = [row for row in ordered if row["stamp"] is None]
        stamped.sort(key=lambda row: row["stamp"], reverse=(mode == "newest"))
        ordered = stamped + unstamped
    return ordered


def sort_expected(rows, mode):
    return [row["code"] for row in sort_expected_rows(rows, mode)]


# ---------------------------------------------------------------------------
# 頁面解析
# ---------------------------------------------------------------------------
def cohort_block(html, cohort_id):
    match = re.search(
        r'id="cohort-{}"[\s\S]*?(?=<section class="section-block|</main>)'.format(re.escape(cohort_id)),
        html,
    )
    return match.group(0) if match else ""


def card_value(block, label):
    match = re.search(
        r'<span class="tco-stat-num">(\d+)</span><span class="tco-stat-label">%s</span>' % re.escape(label),
        block,
    )
    return int(match.group(1)) if match else None


def pending_rows_of(block):
    return re.findall(
        r'<li class="tco-pending-item">[\s\S]*?<strong>([^<]+)</strong>[\s\S]*?'
        r'<span class="tco-pending-state tco-pending-state-([a-z_]+)">[\s\S]*?'
        r'<span class="muted">[^（]*（([^）]+)）',
        block,
    )


def progress_rows_of(block):
    return re.findall(
        r'<li class="tco-progress-item tco-progress-([a-z]+)">\s*<div class="tco-progress-main">\s*<strong>([^<]+)</strong>',
        block,
    )


def matrix_rows_of(block):
    rows = {}
    for chunk in re.findall(r"<tr>\s*<td data-label=\"FDE ID\">([\s\S]*?)</tr>", block):
        sid = re.match(r"([^<]+)", chunk).group(1).strip()
        submitted = re.search(r'data-label="已提交"[^>]*>(\d+) / 8', chunk)
        pending = re.search(r'data-label="待複核"[^>]*>(\d+)', chunk)
        rows[sid] = (
            int(submitted.group(1)) if submitted else None,
            int(pending.group(1)) if pending else None,
        )
    return rows


def main():
    truth = db_truth()
    outcomes_url = BASE + "/teacher/class-outcomes/"

    # --- C. 教師權限隔離 ---
    jar_a, op_a = new_session()
    status_a, _page, _ = login(op_a, jar_a, "/teacher/login/", TEACHER_A, TEACHER_PASSWORD)
    check("A 師登入成功", status_a in (200, 302), "HTTP %s" % status_a)
    jar_b, op_b = new_session()
    status_b, _page, _ = login(op_b, jar_b, "/teacher/login/", TEACHER_B, TEACHER_PASSWORD)
    check("B 師登入成功", status_b in (200, 302), "HTTP %s" % status_b)

    status, html_a, _ = get(op_a, outcomes_url)
    check("A 師可開啟班級學習成果", status == 200, "HTTP %s" % status)
    cohorts_a = re.findall(r'<section class="section-block tco-class" id="cohort-([^"]+)"', html_a)
    check("A 師只看到授權班級（A 班＋C 班空班級）", cohorts_a == sorted(truth["authorized"][TEACHER_A]), "頁面 %s ｜ 授權 %s" % (cohorts_a, sorted(truth["authorized"][TEACHER_A])))
    _, html_b, _ = get(op_b, outcomes_url)
    cohorts_b = re.findall(r'<section class="section-block tco-class" id="cohort-([^"]+)"', html_b)
    check("B 師只看到授權班級（B 班）", cohorts_b == sorted(truth["authorized"][TEACHER_B]), "頁面 %s ｜ 授權 %s" % (cohorts_b, sorted(truth["authorized"][TEACHER_B])))

    _, cross, _ = get(op_a, outcomes_url + "?cohort=" + COHORT_B)
    leaked = [sid for eid, sid in truth["students"].items() if truth["cohort_of"][eid] == COHORT_B and sid in cross]
    check("A 師越權查詢 B 班不洩漏任何學員",
          "沒有可查看的班級" in cross and not leaked, "洩漏 %s" % leaked if leaked else "空狀態正常")
    _, cross2, _ = get(op_b, outcomes_url + "?cohort=" + COHORT_A)
    leaked2 = [sid for eid, sid in truth["students"].items() if truth["cohort_of"][eid] == COHORT_A and sid in cross2]
    check("B 師越權查詢 A 班不洩漏任何學員",
          "沒有可查看的班級" in cross2 and not leaked2, "洩漏 %s" % leaked2 if leaked2 else "空狀態正常")

    _jar_anon, op_anon = new_session()
    status_anon, _body, final_anon = get(op_anon, outcomes_url)
    check("未登入存取重導教師登入",
          status_anon in (200, 302) and "/teacher/login/" in final_anon, "HTTP %s ｜ %s" % (status_anon, final_anon))
    if STUDENT_PASSWORD:
        jar_stu, op_stu = new_session()
        login(op_stu, jar_stu, "/login/", "demo.student01@fde-demo.local", STUDENT_PASSWORD)
        status_stu, _, _ = get(op_stu, outcomes_url)
        check("學員登入存取教師頁面為 403", status_stu == 403, "HTTP %s" % status_stu)
    else:
        check("學員登入測試（無學員憑證，略過）", True, "skipped")

    # --- B/E. 多班級多學員：矩陣、卡片、五階段 ---
    for cohort_id, html in ((COHORT_A, html_a), (COHORT_B, html_b)):
        expected = class_expected(truth, cohort_id)
        block = cohort_block(html, cohort_id)
        check("班級 %s 學員數與 DB 一致" % cohort_id,
              card_value(block, "班級學員（人）") == expected["students"],
              "頁面 %s ｜ DB %s" % (card_value(block, "班級學員（人）"), expected["students"]))
        check("班級 %s 待複核成果卡片與 DB 一致" % cohort_id,
              card_value(block, "待複核成果（筆）") == expected["pending_items"],
              "頁面 %s ｜ DB %s" % (card_value(block, "待複核成果（筆）"), expected["pending_items"]))
        check("班級 %s 尚未提交卡片與 DB 一致" % cohort_id,
              card_value(block, "尚未提交（人）") == expected["not_submitted"],
              "頁面 %s ｜ DB %s" % (card_value(block, "尚未提交（人）"), expected["not_submitted"]))
        check("班級 %s 已完成八項卡片與 DB 一致" % cohort_id,
              card_value(block, "已完成八項（人）") == expected["all_submitted"],
              "頁面 %s ｜ DB %s" % (card_value(block, "已完成八項（人）"), expected["all_submitted"]))
        matrix = matrix_rows_of(block)
        check("班級 %s 矩陣列數＝學員數" % cohort_id,
              len(matrix) == expected["students"], "頁面 %d ｜ DB %d" % (len(matrix), expected["students"]))
        mismatch = []
        for eid in enrolled_in(truth, cohort_id):
            sid = truth["students"][eid]
            submitted, pending = student_counts(truth, eid)
            got = matrix.get(sid)
            if got != (submitted, pending):
                mismatch.append((sid, got, (submitted, pending)))
        check("班級 %s 每位學員矩陣計數與 DB 一致" % cohort_id,
              not mismatch, "不一致 %s" % mismatch if mismatch else "全部一致")
        for key in STAGE_KEYS:
            done = sum(
                1
                for eid in enrolled_in(truth, cohort_id)
                if truth["phases"].get(eid, {}).get(key) == "completed"
            )
            match = re.search(
                r"{}\｜[^<]*</span><strong>完成 (\d+) / (\d+) 人".format(STAGE_CHARS[key]),
                block,
            )
            ok = match and int(match.group(1)) == done and int(match.group(2)) == expected["students"]
            check("班級 %s 五階段 %s 完成數符合 completed 定義（%d/%d）" % (cohort_id, key, done, expected["students"]),
                  ok, "頁面 %s ｜ DB %d" % (match.groups() if match else "無", done))

    # --- A. 五種學員進度篩選 ---
    for cohort_id, opener, html in ((COHORT_A, op_a, html_a), (COHORT_B, op_b, html_b)):
        expected = class_expected(truth, cohort_id)
        cases = (
            ("", expected["students"], None),
            ("none", len(expected["none"]), expected["none"]),
            ("partial", len(expected["partial"]), expected["partial"]),
            ("complete", len(expected["complete"]), expected["complete"]),
            ("pending", len(expected["pending"]), expected["pending"]),
        )
        for key, expected_count, eids in cases:
            url = outcomes_url if not key else outcomes_url + "?s_state=" + key
            _status, page, _ = get(opener, url)
            block = cohort_block(page, cohort_id)
            rows = progress_rows_of(block)
            expected_ids = sorted(truth["students"][eid] for eid in eids) if eids is not None else None
            ok = len(rows) == expected_count and (
                expected_ids is None or sorted(sid for _state, sid in rows) == expected_ids
            )
            check("班級 %s 進度篩選 %s 與 DB 一致" % (cohort_id, key or "全部"),
                  ok, "頁面 %d %s ｜ DB %d %s" % (len(rows), sorted(sid for _s, sid in rows), expected_count, expected_ids or ""))

    # --- D. 四種排序（逐筆順序比對）＋組合篩選 ---
    for cohort_id, opener in ((COHORT_A, op_a), (COHORT_B, op_b)):
        for mode in ("oldest", "newest", "student_asc", "record_asc"):
            _status, page, _ = get(opener, outcomes_url + "?sort=" + mode)
            block = cohort_block(page, cohort_id)
            got = [row[0].split("｜")[0].strip() for row in pending_rows_of(block)]
            expected_codes = sort_expected(expected_pending_rows(truth, cohort_id), mode)
            check("班級 %s 排序 %s 逐筆順序正確" % (cohort_id, mode),
                  got == expected_codes, "頁面 %s ｜ 期望 %s" % (got, expected_codes))

    # 組合：狀態=需要補充 + 類型=成長紀錄 + 排序=record_asc
    _status, page, _ = get(op_a, outcomes_url + "?p_status=needs_revision&p_type=growth&sort=record_asc")
    block = cohort_block(page, COHORT_A)
    got = [(row[0].split("｜")[0].strip(), row[1]) for row in pending_rows_of(block)]
    expected = [
        (row["code"], row["status_key"])
        for row in sort_expected_rows(expected_pending_rows(truth, COHORT_A, kind="growth", status="needs_revision"), "record_asc")
    ]
    check("組合篩選（需要補充＋成長紀錄＋record_asc）正確",
          got == expected, "頁面 %s ｜ 期望 %s" % (got, expected))
    # 組合：紀錄=R05 + 全部類型 → 成長紀錄 R05 與對應 R05 的任務（T06）皆納入
    _status, page, _ = get(op_a, outcomes_url + "?p_record=R05&sort=record_asc")
    block = cohort_block(page, COHORT_A)
    got = [row[0].split("｜")[0].strip() for row in pending_rows_of(block)]
    expected = sort_expected(expected_pending_rows(truth, COHORT_A, record="R05"), "record_asc")
    check("紀錄篩選 R05 納入成長紀錄與對應任務、不強制歸類",
          got == expected, "頁面 %s ｜ 期望 %s" % (got, expected))
    # 無對應任務（T10）不得出現在任何 R 篩選
    appearing = []
    for slot in ("R01", "R02", "R03", "R04", "R05", "R06", "R07", "R08"):
        _status, page, _ = get(op_a, outcomes_url + "?p_record=" + slot)
        codes = [row[0].split("｜")[0].strip() for row in pending_rows_of(cohort_block(page, COHORT_A))]
        if "M10" in codes:
            appearing.append(slot)
    check("無 R 槽位對應的任務（M10）不出現在任何紀錄篩選", not appearing, "出現於 %s" % appearing)

    # 多條件共存與參數保留
    combo = "?cohort=%s&sort=newest&p_record=R01&p_type=growth&p_status=submitted&s_state=partial" % COHORT_A
    status_combo, page_combo, _ = get(op_a, outcomes_url + combo)
    block = cohort_block(page_combo, COHORT_A)
    got = [row[0].split("｜")[0].strip() for row in pending_rows_of(block)]
    expected = sort_expected(
        expected_pending_rows(truth, COHORT_A, record="R01", kind="growth", status="submitted"), "newest"
    )
    check("六條件同時使用（班級＋排序＋紀錄＋類型＋狀態＋進度）",
          status_combo == 200 and got == expected, "HTTP %s ｜ 頁面 %s ｜ 期望 %s" % (status_combo, got, expected))
    preserved = all(
        token in page_combo
        for token in ('name="p_type" value="growth"', 'name="s_state" value="partial"', 'name="sort" value="newest"')
    )
    check("切換條件時其他有效條件以隱藏欄位保留", preserved, "hidden params present")

    # --- 狀態區分與缺失時間標示 ---
    check("待複核清單可區分「待教師複核」與「需要補充」",
          "tco-pending-state-submitted" in html_a and "tco-pending-state-needs_revision" in html_a,
          "state chips present")
    check("缺失提交時間的項目有明確標示",
          "無提交時間" in html_a, "label present")
    check("排序介面明確標示「學員名稱（字元排序）」",
          "學員名稱（字元排序）" in html_a, "label present")

    failed = [row for row in RESULTS if not row[1]]
    print("\n==== P4.2 多班級驗收結果：%d 項通過 / %d 項失敗 / 共 %d 項 ====" % (
        len(RESULTS) - len(failed), len(failed), len(RESULTS)))
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
