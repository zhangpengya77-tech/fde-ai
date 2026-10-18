#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""P6 結訓審核與成果交付中心驗收（2026-10-13 教師指令第六項 11 項）。

對獨立測試庫（demo/runtime/db/p42_verify.sqlite3）啟動的 Django :8112 進行 HTTP 驗收：
  1. 兩班以上結訓清單（教師只看到授權班級）
  2. 0／部分／8 項提交情境（逐位學員核對）
  3. 待複核與需要補充分類正確
  4. P5 報告頁、結訓清單、兩種 CSV 四處統計一致（皆與獨立推導值相符）
  5. CSV 繁體中文編碼（UTF-8 BOM、Windows Excel 可讀）
  6. CSV 公式注入防護（結構不變式；攻擊向量另由 verify_p6_csv_injection.py 驗證）
  7. 教師跨班級權限隔離（越權一律 404）
  8. 學員及匿名使用者禁止存取與匯出（302／403，且不取得 CSV 內容）
  9. 無資料空狀態（空班級清單與 CSV）
 10. 390×844 手機版版面契約（media query／44px 觸控目標／不橫向溢出；實機畫面另由截圖驗證）
 11. P1–P5 必要回歸（既有頁面仍正常，且 P6 未取代 P5 入口）

所有期望值皆由獨立測試庫唯讀查詢後在腳本內重新推導（不引用產品程式碼）。
憑證不寫入程式：由 demo_credentials 載入器取得。
"""
import csv
import http.cookiejar
import io
import os
import re
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import demo_credentials  # noqa: E402

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
SLOTS = ["R%02d" % index for index in range(1, 9)]
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")

CHECKLIST = "/teacher/review-checklist/%s/"
REPORT = "/teacher/class-report/%s/"
SUMMARY_CSV = "/teacher/class-report/export/summary/%s/"
RECORDS_CSV = "/teacher/class-report/export/records/%s/"

RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    print("%s - %s%s" % ("PASS" if ok else "FAIL", name, (" | " + detail) if detail else ""))


# ---------------------------------------------------------------------------
# 憑證（不寫入程式）
# ---------------------------------------------------------------------------
TEACHER_PASSWORD = demo_credentials.load_password("teacher", required=False)
STUDENT_PASSWORD = demo_credentials.load_password("student", required=False)
if not TEACHER_PASSWORD:
    print("[安全停止] 無法取得教師密碼：請設定 FDE_DEMO_TEACHER_PASSWORD 或提供憑證檔。")
    sys.exit(2)
if not STUDENT_PASSWORD:
    print("[安全停止] 無法取得學員密碼：請設定 FDE_DEMO_STUDENT_PASSWORD 或提供憑證檔。")
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


def _open(opener, url, referer=None, data=None):
    headers = {"User-Agent": "P6-VERIFY/1.0", "Referer": referer or BASE + "/"}
    if data is not None:
        parts = urllib.parse.urlsplit(referer or BASE + "/")
        headers["Origin"] = "%s://%s" % (parts.scheme, parts.netloc)
    request = urllib.request.Request(url, data=data, headers=headers)
    try:
        with opener.open(request, timeout=30) as response:
            return response.status, response.read(), response.geturl(), dict(response.headers)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(), url, dict(exc.headers)


def get(opener, url, referer=None):
    status, raw, final, headers = _open(opener, url, referer)
    return status, raw.decode("utf-8", "replace"), final, headers


def login(opener, jar, path, email, password):
    _status, page, _final, _headers = get(opener, BASE + path)
    token = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', page)
    if not token:
        for cookie in jar:
            if cookie.name == "csrftoken":
                token = type("T", (), {"group": lambda self, c: c.value})()
                token.group = lambda index, c=cookie: c.value
                break
    payload = urllib.parse.urlencode(
        {
            "username": email,
            "password": password,
            "csrfmiddlewaretoken": token.group(1) if token else "",
        }
    ).encode()
    status, raw, final, headers = _open(opener, BASE + path, referer=BASE + path, data=payload)
    return status, raw.decode("utf-8", "replace"), final, headers


def login_as(path, email, password):
    jar, opener = new_session()
    status, page, final, _headers = login(opener, jar, path, email, password)
    ok = status in (200, 302) and "/login/" not in final
    return opener, ok


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102
        return None


def get_noredirect(url, referer=None):
    """不跟隨重導，觀察第一手狀態碼（驗證未登入被擋）。"""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
    request = urllib.request.Request(
        url, headers={"User-Agent": "P6-VERIFY/1.0", "Referer": referer or BASE + "/"}
    )
    try:
        with opener.open(request, timeout=30) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


# ---------------------------------------------------------------------------
# 獨立測試庫唯讀基準
# ---------------------------------------------------------------------------
def db_truth():
    con = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
    con.row_factory = sqlite3.Row
    truth = {
        "cohorts": {},
        "students": {},
        "submissions": {},
        "reviews": {},
        "tasks": {},
        "phases": {},
        "slot_titles": {},
    }
    for row in con.execute("SELECT cohort_id, name FROM learning_cohort"):
        truth["cohorts"][row["cohort_id"]] = row["name"]
    for row in con.execute("SELECT slot_id, title FROM learning_growthrecorddefinition"):
        truth["slot_titles"][row["slot_id"]] = row["title"]
    for row in con.execute(
        """SELECT e.id AS enrollment_id, c.cohort_id, sp.public_user_id, sp.nickname
           FROM learning_enrollment e
           JOIN learning_cohort c ON c.cohort_id = e.cohort_id
           JOIN learning_studentprofile sp ON sp.student_id = e.student_id
           WHERE e.active = 1"""
    ):
        truth["students"][row["public_user_id"]] = {
            "cohort_id": row["cohort_id"],
            "nickname": row["nickname"],
            "enrollment_id": row["enrollment_id"],
        }
    for row in con.execute(
        """SELECT c.cohort_id, sp.public_user_id, d.slot_id, s.status
           FROM learning_growthrecordsubmission s
           JOIN learning_growthrecorddefinition d ON d.id = s.definition_id
           JOIN learning_enrollment e ON e.id = s.enrollment_id
           JOIN learning_cohort c ON c.cohort_id = e.cohort_id
           JOIN learning_studentprofile sp ON sp.student_id = e.student_id
           WHERE e.active = 1"""
    ):
        truth["submissions"][(row["public_user_id"], row["slot_id"])] = row["status"]
    for row in con.execute(
        """SELECT c.cohort_id, sp.public_user_id, d.slot_id, r.review_status, r.score,
                  r.teacher_note, r.reviewed_at
           FROM learning_growthrecordreview r
           JOIN learning_growthrecordsubmission s ON s.id = r.submission_id
           JOIN learning_growthrecorddefinition d ON d.id = s.definition_id
           JOIN learning_enrollment e ON e.id = s.enrollment_id
           JOIN learning_cohort c ON c.cohort_id = e.cohort_id
           JOIN learning_studentprofile sp ON sp.student_id = e.student_id
           ORDER BY r.reviewed_at, r.id"""
    ):
        key = (row["public_user_id"], row["slot_id"])
        truth["reviews"][key] = {
            "review_status": row["review_status"],
            "score": row["score"],
            "note": row["teacher_note"] or "",
        }
    for row in con.execute(
        """SELECT c.cohort_id, sp.public_user_id, p.id, p.task_id, p.status, p.teacher_note,
                  p.teacher_score, t.title
           FROM learning_studenttaskprogress p
           JOIN learning_enrollment e ON e.id = p.enrollment_id
           JOIN learning_cohort c ON c.cohort_id = e.cohort_id
           JOIN learning_studentprofile sp ON sp.student_id = e.student_id
           LEFT JOIN learning_taskdefinition t ON t.task_id = p.task_id"""
    ):
        truth["tasks"][(row["public_user_id"], row["id"])] = {
            "cohort_id": row["cohort_id"],
            "task_id": row["task_id"],
            "status": row["status"],
            "note": row["teacher_note"] or "",
            "score": row["teacher_score"],
            "title": row["title"] or "",
        }
    for row in con.execute(
        """SELECT c.cohort_id, sp.public_user_id, ph.phase, ph.status
           FROM learning_phaseprogress ph
           JOIN learning_enrollment e ON e.id = ph.enrollment_id
           JOIN learning_cohort c ON c.cohort_id = e.cohort_id
           JOIN learning_studentprofile sp ON sp.student_id = e.student_id"""
    ):
        truth["phases"][(row["public_user_id"], row["phase"])] = row["status"]
    con.close()
    return truth


def derive(truth, cohort_id):
    """由獨立測試庫推導班級層級與學員層級期望值。"""
    students = sorted(
        pid for pid, info in truth["students"].items() if info["cohort_id"] == cohort_id
    )
    per_student = {}
    for pid in students:
        slots = {
            slot: truth["submissions"].get((pid, slot))
            for slot in SLOTS
        }
        submitted_count = sum(1 for status in slots.values() if status in SUBMITTED_STATUSES)
        unsubmitted = [slot for slot, status in slots.items() if status not in SUBMITTED_STATUSES]
        pending = [slot for slot, status in slots.items() if status == "submitted"]
        needs = [slot for slot, status in slots.items() if status == "needs_revision"]
        reviews = {
            slot: truth["reviews"][(pid, slot)]
            for slot in SLOTS
            if (pid, slot) in truth["reviews"]
        }
        tasks = {
            key: value
            for key, value in truth["tasks"].items()
            if key[0] == pid
        }
        reviewed_results = len(reviews) + sum(
            1
            for value in tasks.values()
            if value["status"] == "reviewed" or value["note"].strip() or value["score"] is not None
        )
        pending_tasks = sum(1 for value in tasks.values() if value["status"] == "submitted")
        completed = sum(
            1
            for phase in STAGE_KEYS
            if truth["phases"].get((pid, phase)) == "completed"
        )
        # 「待教師複核」與「尚待處理」皆為同一工作項目集合：成長紀錄提交 ＋ 任務提交。
        pending_count = len(pending) + pending_tasks
        per_student[pid] = {
            "submitted_count": submitted_count,
            "unsubmitted_slots": unsubmitted,
            "unsubmitted_count": len(unsubmitted),
            "pending_slots": pending,
            "pending_growth_count": len(pending),
            "pending_task_count": pending_tasks,
            "pending_count": pending_count,
            "needs_slots": needs,
            "needs_revision_count": len(needs),
            "reviewed_result_count": reviewed_results,
            "outstanding_count": len(unsubmitted) + pending_count + len(needs),
            "completed_stages": completed,
            "reviewed_slots": reviews,
        }
    totals = {
        "student_count": len(students),
        "total_submitted": sum(item["submitted_count"] for item in per_student.values()),
        "total_reviewed": sum(
            sum(1 for slot in SLOTS if truth["submissions"].get((pid, slot)) in REVIEWED_STATUSES)
            for pid in students
        ),
        "pending_items_total": sum(item["pending_count"] for item in per_student.values()),
        "needs_revision_total": sum(
            item["needs_revision_count"] for item in per_student.values()
        ),
        "unsubmitted_items_total": sum(
            item["unsubmitted_count"] for item in per_student.values()
        ),
        "reviewed_result_total": sum(
            item["reviewed_result_count"] for item in per_student.values()
        ),
        "not_submitted_count": sum(
            1 for item in per_student.values() if item["submitted_count"] == 0
        ),
        "all_submitted_count": sum(
            1 for item in per_student.values() if item["submitted_count"] == 8
        ),
        "pending_student_count": sum(
            1 for item in per_student.values() if item["pending_count"] > 0
        ),
    }
    totals["outstanding_total"] = (
        totals["pending_items_total"]
        + totals["needs_revision_total"]
        + totals["unsubmitted_items_total"]
    )
    return students, per_student, totals


# ---------------------------------------------------------------------------
# 解析工具
# ---------------------------------------------------------------------------
def parse_student_cards(html):
    cards = {}
    for block in html.split('<article class="trc-student">')[1:]:
        head = re.search(r"<strong>([^<]+)</strong>", block)
        if not head:
            continue
        pid = head.group(1).strip()
        outstanding = re.search(r"尚待處理 (\d+) 筆", block)
        nums = dict(
            re.findall(r"<span>([^<]+) <strong>([^<]+)</strong></span>", block)
        )
        cards[pid] = {
            "outstanding": int(outstanding.group(1)) if outstanding else None,
            "nums": nums,
        }
    return cards


def section_count(html, label):
    match = re.search(re.escape(label) + r"（(\d+) 筆）", html)
    return int(match.group(1)) if match else None


def parse_pending_rows(html, anchor):
    """解析 #checklist-pending 或 #checklist-needs-revision 的表格列。"""
    block = html.split('id="%s"' % anchor)[-1]
    block = block.split("</section>")[0]
    pattern = (
        r'<td data-label="學員">([^<]+)<span[^>]*>（([^<]*)）</span></td>\s*'
        r'<td data-label="來源">([^<]+)</td>\s*'
        r'<td data-label="項目">([^<]+)</td>\s*'
        r'<td data-label="狀態"><span class="status status-([a-z_]+)">([^<]+)</span></td>\s*'
        r'<td data-label="提交時間">.*?</td>\s*'
        r'<td data-label="審核入口"><a class="[^"]*" href="([^"]+)">'
    )
    return [
        {
            "student": match[0],
            "nickname": match[1],
            "source": match[2],
            "item": match[3],
            "status_key": match[4],
            "status_label": match[5],
            "url": match[6],
        }
        for match in re.findall(pattern, block, re.S)
    ]


def parse_unsubmitted_rows(html):
    block = html.split('id="checklist-unsubmitted"')[-1].split("</section>")[0]
    pattern = (
        r'<td data-label="紀錄">(R\d\d)</td>\s*'
        r'<td data-label="名稱">([^<]*)</td>\s*'
        r'<td data-label="尚未提交（人）">(\d+)</td>\s*'
        r'<td data-label="班級人數">(\d+)</td>\s*'
        r'<td data-label="待處理學員">(.*?)</td>'
    )
    rows = []
    for match in re.findall(pattern, block, re.S):
        students = re.findall(r'href="([^"]+)">([^<（]+)（([^<]*)）</a>', match[4])
        rows.append(
            {
                "slot_id": match[0],
                "title": match[1],
                "count": int(match[2]),
                "total": int(match[3]),
                "students": [
                    {"url": item[0], "public_user_id": item[1], "status": item[2]}
                    for item in students
                ],
            }
        )
    return rows


def parse_p5_stats(html):
    return {
        label: int(num)
        for num, label in re.findall(
            r'<span class="trp-stat-num">(\d+)</span><span class="trp-stat-label">([^<]+)</span>',
            html,
        )
    }


def csv_rows(text):
    return list(csv.reader(io.StringIO(text)))


def summary_metrics(text):
    return {
        row[4]: row[5]
        for row in csv_rows(text)[1:]
        if len(row) > 5 and row[0] == "班級摘要"
    }


def records_body(text):
    rows = csv_rows(text)
    return rows[0], [row for row in rows[1:] if row and row[0] != "說明"]


# ---------------------------------------------------------------------------
# 驗收主體
# ---------------------------------------------------------------------------
def main():
    truth = db_truth()
    for cohort_id in (COHORT_A, COHORT_B, COHORT_C):
        if cohort_id not in truth["cohorts"]:
            print("[安全停止] 獨立測試庫缺少班級 %s" % cohort_id)
            return 2

    students_a, per_a, totals_a = derive(truth, COHORT_A)
    students_b, per_b, totals_b = derive(truth, COHORT_B)
    _students_c, _per_c, totals_c = derive(truth, COHORT_C)

    teacher_a, ok_a = login_as("/teacher/login/", TEACHER_A, TEACHER_PASSWORD)
    teacher_b, ok_b = login_as("/teacher/login/", TEACHER_B, TEACHER_PASSWORD)
    check("前置：教師 A 可登入", ok_a)
    check("前置：教師 B 可登入", ok_b)
    if not (ok_a and ok_b):
        print("[安全停止] 教師登入失敗，無法進行後續驗收。")
        return 2

    # ── 驗收 1：兩班以上結訓清單 ────────────────────────────────────
    status_a, html_a, _f, _h = get(teacher_a, BASE + CHECKLIST % COHORT_A)
    status_b, html_b, _f, _h = get(teacher_b, BASE + CHECKLIST % COHORT_B)
    check("1-1 結訓審核清單回 200（A／B 兩班）", status_a == 200 and status_b == 200,
          "A=%s B=%s" % (status_a, status_b))
    options_a = re.findall(r'<option value="([^"]+)"', html_a)
    options_b = re.findall(r'<option value="([^"]+)"', html_b)
    check("1-2 教師 A 只看到授權班級（含 A、C，不含 B）",
          set(options_a) == {COHORT_A, COHORT_C}, "options=%s" % options_a)
    check("1-3 教師 B 只看到授權班級（僅 B）",
          set(options_b) == {COHORT_B}, "options=%s" % options_b)
    check("1-4 六個必要區塊齊備",
          all(
              ('id="%s"' % anchor) in html_a
              for anchor in (
                  "checklist-basic",
                  "checklist-unsubmitted",
                  "checklist-pending",
                  "checklist-needs-revision",
                  "checklist-reviewed",
                  "checklist-students",
              )
          ))
    count_match = re.search(r"<dt>班級總人數</dt><dd>(\d+) 人</dd>", html_a)
    check("1-5 A 班總人數與測試庫一致",
          count_match and int(count_match.group(1)) == totals_a["student_count"],
          "頁面=%s 期望=%s" % (count_match.group(1) if count_match else None,
                              totals_a["student_count"]))
    for pid in students_b:
        if pid in html_a:
            check("1-6 A 班清單不含 B 班學員 %s" % pid, False)
            break
    else:
        check("1-6 A 班清單不含任何 B 班學員", True)
    for pid in students_a:
        if pid in html_b:
            check("1-7 B 班清單不含 A 班學員 %s" % pid, False)
            break
    else:
        check("1-7 B 班清單不含任何 A 班學員", True)

    # ── 驗收 2：0／部分／8 項提交情境 ───────────────────────────────
    cards_a = parse_student_cards(html_a)
    check("2-1 逐位學員卡片齊備（A 班 %d 人）" % len(students_a),
          set(cards_a) == set(students_a), "cards=%s" % sorted(cards_a))
    zero_ids = [pid for pid, item in per_a.items() if item["submitted_count"] == 0]
    partial_ids = [pid for pid, item in per_a.items() if 0 < item["submitted_count"] < 8]
    full_ids = [pid for pid, item in per_a.items() if item["submitted_count"] == 8]
    check("2-2 測試庫含 0／部分／8 項三種情境",
          bool(zero_ids) and bool(partial_ids) and bool(full_ids),
          "0項=%s 部分=%s 8項=%s" % (zero_ids, partial_ids, full_ids))
    for pid in students_a:
        expected = per_a[pid]
        card = cards_a.get(pid, {})
        nums = card.get("nums", {})
        ok = (
            nums.get("尚未提交") == str(expected["unsubmitted_count"])
            and nums.get("待教師複核") == str(expected["pending_count"])
            and nums.get("需要補充") == str(expected["needs_revision_count"])
            and nums.get("已有複核結果") == str(expected["reviewed_result_count"])
            and card.get("outstanding") == expected["outstanding_count"]
        )
        check(
            "2-3 學員 %s 待處理數字與測試庫一致（尚未提交 %s／待複核 %s／需補充 %s／已複核 %s／尚待處理 %s）"
            % (pid, expected["unsubmitted_count"], expected["pending_count"],
               expected["needs_revision_count"], expected["reviewed_result_count"],
               expected["outstanding_count"]),
            ok,
            "頁面=%s" % nums,
        )
        stages = nums.get("五階段完成")
        check(
            "2-4 學員 %s 五階段完成數與測試庫一致" % pid,
            stages == "%d / %d" % (expected["completed_stages"], len(STAGE_KEYS)),
            "頁面=%s 期望=%d / %d" % (stages, expected["completed_stages"], len(STAGE_KEYS)),
        )

    # ── 驗收 3：待複核與需要補充分類 ────────────────────────────────
    pending_total = section_count(html_a, "待教師複核項目")
    needs_total = section_count(html_a, "需要補充項目")
    unsubmitted_total = section_count(html_a, "R01–R08 尚未提交項目")
    reviewed_total = section_count(html_a, "已有教師複核結果")
    check("3-1 待複核筆數與測試庫一致",
          pending_total == totals_a["pending_items_total"],
          "頁面=%s 期望=%s" % (pending_total, totals_a["pending_items_total"]))
    check("3-2 需要補充筆數與測試庫一致",
          needs_total == totals_a["needs_revision_total"],
          "頁面=%s 期望=%s" % (needs_total, totals_a["needs_revision_total"]))
    check("3-3 尚未提交筆數與測試庫一致",
          unsubmitted_total == totals_a["unsubmitted_items_total"],
          "頁面=%s 期望=%s" % (unsubmitted_total, totals_a["unsubmitted_items_total"]))
    check("3-4 已有複核結果筆數與測試庫一致",
          reviewed_total == totals_a["reviewed_result_total"],
          "頁面=%s 期望=%s" % (reviewed_total, totals_a["reviewed_result_total"]))

    pending_rows = parse_pending_rows(html_a, "checklist-pending")
    check("3-5 待複核列數等於待複核筆數",
          len(pending_rows) == totals_a["pending_items_total"],
          "列數=%s" % len(pending_rows))
    check("3-6 待複核每列狀態皆為待教師複核",
          all(row["status_key"] == "submitted" for row in pending_rows))
    expected_pending = sorted(
        [
            (pid, truth["slot_titles"][slot], "成長紀錄")
            for pid, item in per_a.items()
            for slot in item["pending_slots"]
        ]
        + [
            (pid, value["title"], "任務提交")
            for (pid, _progress_id), value in truth["tasks"].items()
            if value["cohort_id"] == COHORT_A and value["status"] == "submitted"
        ]
    )
    page_pending = sorted(
        (row["student"], row["item"].split("｜", 1)[-1], row["source"]) for row in pending_rows
    )
    check("3-7 待複核清單與測試庫逐筆對應（含任務提交）",
          page_pending == expected_pending,
          "頁面=%s 期望=%s" % (page_pending, expected_pending))

    revision_rows = parse_pending_rows(html_a, "checklist-needs-revision")
    expected_needs = sorted(
        (pid, truth["slot_titles"][slot], "成長紀錄")
        for pid, item in per_a.items()
        for slot in item["needs_slots"]
    )
    page_needs = sorted(
        (row["student"], row["item"].split("｜", 1)[-1], row["source"]) for row in revision_rows
    )
    check("3-8 需要補充清單與測試庫逐筆對應",
          page_needs == expected_needs,
          "頁面=%s 期望=%s" % (page_needs, expected_needs))

    unsubmitted_rows = parse_unsubmitted_rows(html_a)
    check("3-9 尚未提交表為 R01–R08 八列", len(unsubmitted_rows) == 8)
    unsub_ok = True
    for row in unsubmitted_rows:
        expected = sorted(
            pid for pid, item in per_a.items() if row["slot_id"] in item["unsubmitted_slots"]
        )
        got = sorted(item["public_user_id"] for item in row["students"])
        if got != expected or row["count"] != len(expected):
            unsub_ok = False
            break
    check("3-10 尚未提交逐槽名單與測試庫一致", unsub_ok)

    # 任務提交必須與成長紀錄同屬一個待複核集合（A 班兩種來源同時存在）
    sources_a = sorted({row["source"] for row in pending_rows})
    check("3-11 A 班待複核同時包含成長紀錄與任務提交",
          sources_a == ["任務提交", "成長紀錄"], "sources=%s" % sources_a)
    _status_b, html_b_page, _f, _h = get(teacher_b, BASE + CHECKLIST % COHORT_B)
    pending_rows_b = parse_pending_rows(html_b_page, "checklist-pending")
    check("3-12 B 班待複核（僅任務提交）仍正確呈現",
          len(pending_rows_b) == totals_b["pending_items_total"]
          and sorted({row["source"] for row in pending_rows_b}) == ["任務提交"],
          "頁面=%s 期望=%s" % (len(pending_rows_b), totals_b["pending_items_total"]))

    # 每筆待處理項目都指向既有教師審核頁
    all_items = (
        pending_rows
        + revision_rows
        + [item for row in unsubmitted_rows for item in row["students"]]
    )
    expected_prefixes = tuple(
        "/teacher/enrollments/%d/" % truth["students"][pid]["enrollment_id"]
        for pid in students_a
    )
    check("3-13 每筆待處理項目皆連到既有教師審核頁",
          bool(all_items) and all(item["url"].startswith(expected_prefixes) for item in all_items))
    growth_urls = [
        row["url"] for row in pending_rows + revision_rows if row["source"] == "成長紀錄"
    ]
    check("3-14 成長紀錄類項目帶 #growth-records 錨點",
          bool(growth_urls) and all(url.endswith("#growth-records") for url in growth_urls))
    post_actions = re.findall(r'<form method="post" action="([^"]+)"', html_a)
    check("3-15 清單未新增任何寫入端點（僅 base.html 登出）",
          post_actions == ["/logout/"], "actions=%s" % post_actions)
    check("3-16 清單未出現第二套複核路由",
          "growth-reviews" not in html_a and "review_task" not in html_a)
    check("3-17 清單明示不自動判定合格、不核發證照",
          "不自動判定學員合格" in html_a and "不核發任何證照" in html_a)
    for forbidden in ("考照合格率", "結訓通過率", "民航局證照取得"):
        if forbidden in html_a:
            check("3-18 清單不得出現「%s」" % forbidden, False)
            break
    else:
        check("3-18 清單未宣稱考照合格率或證照取得", True)

    # ── 驗收 4：P5 報告、清單、兩種 CSV 統計一致 ────────────────────
    _s, p5_html_a, _f, _h = get(teacher_a, BASE + REPORT % COHORT_A)
    p5_stats = parse_p5_stats(p5_html_a)
    _s2, summary_a, _f, summary_headers = get(teacher_a, BASE + SUMMARY_CSV % COHORT_A)
    _s3, records_a, _f, _h = get(teacher_a, BASE + RECORDS_CSV % COHORT_A)
    metrics_a = summary_metrics(summary_a)
    label_map = {
        "學員總人數（人）": "student_count",
        "R01–R08 已提交（筆）": "total_submitted",
        "R01–R08 已複核（筆）": "total_reviewed",
        "待教師複核（筆）": "pending_items_total",
        "需要補充（筆）": "needs_revision_total",
        "尚未提交（人）": "not_submitted_count",
        "八項已提交（人）": "all_submitted_count",
        "有待複核成果（人）": "pending_student_count",
    }
    consistent = True
    for label, key in label_map.items():
        expected = totals_a[key]
        if p5_stats.get(label) != expected or metrics_a.get(label) != str(expected):
            consistent = False
            check(
                "4-1 統計一致（%s）" % label,
                False,
                "P5頁=%s CSV=%s 測試庫=%s" % (p5_stats.get(label), metrics_a.get(label), expected),
            )
    if consistent:
        check("4-1 P5 報告頁、CSV 摘要、測試庫三方一致（8 項指標）", True)

    checklist_totals_a = {
        "pending_items_total": pending_total,
        "needs_revision_total": needs_total,
        "unsubmitted_items_total": unsubmitted_total,
        "reviewed_result_total": reviewed_total,
    }
    check("4-2 結訓清單四項統計與測試庫一致",
          all(checklist_totals_a[key] == totals_a[key] for key in checklist_totals_a),
          "%s vs %s" % (checklist_totals_a, totals_a))

    slot_rows = {row[3]: row for row in csv_rows(summary_a)[1:] if len(row) > 7 and row[0] == "成長紀錄統計"}
    slot_ok = len(slot_rows) == 8
    for slot in SLOTS:
        expected_submitted = sum(
            1 for pid in students_a if truth["submissions"].get((pid, slot)) in SUBMITTED_STATUSES
        )
        expected_reviewed = sum(
            1 for pid in students_a if truth["submissions"].get((pid, slot)) in REVIEWED_STATUSES
        )
        row = slot_rows.get(slot)
        if not row or int(row[5]) != expected_submitted or int(row[6]) != len(students_a) \
                or int(row[7]) != expected_reviewed:
            slot_ok = False
            break
    check("4-3 CSV 逐槽提交／複核統計與測試庫一致", slot_ok)

    stage_rows = {row[3]: row for row in csv_rows(summary_a)[1:] if len(row) > 6 and row[0] == "五階段進度"}
    stage_ok = set(stage_rows) == set(STAGE_KEYS)
    for key in STAGE_KEYS:
        expected_done = sum(
            1 for pid in students_a if truth["phases"].get((pid, key)) == "completed"
        )
        row = stage_rows.get(key)
        if not row or int(row[5]) != expected_done or int(row[6]) != len(students_a):
            stage_ok = False
            break
    check("4-4 CSV 五階段進度與測試庫一致", stage_ok)

    header_records, body_records = records_body(records_a)
    check("4-5 明細 CSV 欄位數為 12", len(header_records) == 12, "header=%s" % header_records)
    check("4-6 明細 CSV 列數＝學員數 × 8",
          len(body_records) == len(students_a) * 8,
          "列數=%s 期望=%s" % (len(body_records), len(students_a) * 8))
    lookup = {(row[2], row[4]): row for row in body_records}
    detail_ok = True
    for pid in students_a:
        for slot in SLOTS:
            row = lookup.get((pid, slot))
            if row is None:
                detail_ok = False
                break
            expected_status = truth["submissions"].get((pid, slot))
            label = {
                "not_started": "○ 未開始",
                "in_progress": "🟡 進行中",
                "submitted": "待教師複核",
                "needs_revision": "需補充",
                "approved": "✅ 已完成",
                "rejected": "未通過",
            }.get(expected_status, expected_status)
            review = per_a[pid]["reviewed_slots"].get(slot)
            expected_review = {
                "approved": "合格",
                "needs_revision": "需要補充",
                "rejected": "不合格",
            }.get(review["review_status"], review["review_status"]) if review else "尚未複核"
            if row[6] != label or row[7] != expected_review:
                detail_ok = False
                check(
                    "4-7 明細 CSV 狀態不符（%s %s）" % (pid, slot),
                    False,
                    "頁面=%s/%s 期望=%s/%s" % (row[6], row[7], label, expected_review),
                )
                break
            if str(per_a[pid]["completed_stages"]) != row[9] or row[10] != "5":
                detail_ok = False
                break
        if not detail_ok:
            break
    check("4-7 明細 CSV 逐列提交狀態、複核狀態、五階段與測試庫一致", detail_ok)

    # ── 驗收 5：CSV 繁體中文編碼 ────────────────────────────────────
    for name, url in (("摘要", SUMMARY_CSV), ("明細", RECORDS_CSV)):
        _status, raw, _final, headers = _open(teacher_a, BASE + url % COHORT_A)
        check("5-1 %s CSV 具 UTF-8 BOM" % name, raw.startswith(b"\xef\xbb\xbf"))
        text = raw.decode("utf-8-sig")
        check("5-2 %s CSV 為合法 UTF-8 且含繁體中文欄名" % name,
              "班級名稱" in text and "統計產生時間" in text)
        content_type = headers.get("Content-Type", "")
        disposition = headers.get("Content-Disposition", "")
        check("5-3 %s CSV Content-Type 正確" % name,
              "text/csv" in content_type and "charset=utf-8" in content_type,
              content_type)
        expected_prefix = "cohort_summary_%s_" % COHORT_A if name == "摘要" else "cohort_records_%s_" % COHORT_A
        check("5-4 %s CSV 為附件下載且檔名正確" % name,
              disposition.startswith("attachment") and expected_prefix in disposition,
              disposition)
    summary_text = summary_a
    check("5-5 摘要 CSV 欄名完整",
          all(
              column in summary_text
              for column in ("類別", "班級名稱", "班級編號", "項目代碼", "項目名稱",
                             "已提交或完成", "班級人數", "已複核", "統計產生時間")
          ))
    check("5-6 明細 CSV 欄名完整",
          all(
              column in records_a
              for column in ("班級名稱", "班級編號", "學員識別碼", "學員顯示名稱",
                             "紀錄編號", "紀錄名稱", "R01–R08 提交狀態", "教師複核狀態",
                             "複核評分", "五階段完成", "五階段總數", "統計產生時間")
          ))

    # ── 驗收 6：CSV 公式注入防護（結構不變式） ──────────────────────
    offenders = []
    for name, text in (("摘要", summary_a), ("明細", records_a)):
        for row in csv_rows(text):
            for cell in row:
                if cell.startswith(FORMULA_PREFIXES):
                    offenders.append((name, cell))
    check("6-1 真實匯出不含任何以公式字元開頭的儲存格",
          not offenders, "offenders=%s" % offenders[:5])

    # ── 驗收 7：教師跨班級權限隔離 ──────────────────────────────────
    cross_ok = True
    for opener, cohort_id in ((teacher_a, COHORT_B), (teacher_b, COHORT_A)):
        for template in (CHECKLIST, REPORT, SUMMARY_CSV, RECORDS_CSV):
            status, _body, _final, _h = get(opener, BASE + template % cohort_id)
            if status != 404:
                cross_ok = False
                check("7-1 越權存取 %s → %s（期望 404）" % (template % cohort_id, status), False)
    if cross_ok:
        check("7-1 教師越權班級一律 404（清單／報告／兩種 CSV）", True)
    for template in (CHECKLIST, SUMMARY_CSV, RECORDS_CSV):
        status, _body, _final, _h = get(teacher_a, BASE + template % "NOT-EXIST-COHORT")
        check("7-2 不存在的班級不洩漏存在性（%s）" % template, status == 404, "status=%s" % status)

    # ── 驗收 8：學員及匿名使用者禁止存取與匯出 ──────────────────────
    student_opener, student_ok = login_as("/login/", STUDENT_A, STUDENT_PASSWORD)
    check("8-1 學員帳號可登入（前置）", student_ok)
    for template in (CHECKLIST, REPORT, SUMMARY_CSV, RECORDS_CSV):
        status, raw, _final, headers = _open(
            student_opener, BASE + template % COHORT_A
        )
        check(
            "8-2 學員存取 %s 被拒（403）" % template,
            status == 403,
            "status=%s" % status,
        )
        check(
            "8-3 學員未取得 %s 的 CSV 內容" % template,
            b"\xef\xbb\xbf" not in raw[:3],
        )
    for template in (CHECKLIST, REPORT, SUMMARY_CSV, RECORDS_CSV):
        status, raw = get_noredirect(BASE + template % COHORT_A)
        check(
            "8-4 未登入存取 %s 被導向登入頁（302）" % template,
            status == 302 and b"attachment" not in raw[:400].lower(),
            "status=%s" % status,
        )

    # ── 驗收 9：無資料空狀態 ────────────────────────────────────────
    status, empty_html, _f, _h = get(teacher_a, BASE + CHECKLIST % COHORT_C)
    check("9-1 空班級清單回 200", status == 200, "status=%s" % status)
    check("9-2 空班級顯示 0 人與尚無紀錄",
          "0 人" in empty_html
          and "尚無紀錄（此班級目前尚無在學學員）" in empty_html
          and "尚無紀錄（此班級目前沒有尚未提交的 R01–R08 項目）" in empty_html)
    check("9-3 空班級各區塊計數為 0",
          section_count(empty_html, "待教師複核項目") == 0
          and section_count(empty_html, "需要補充項目") == 0
          and section_count(empty_html, "已有教師複核結果") == 0)
    _status, empty_summary, _f, _h = get(teacher_a, BASE + SUMMARY_CSV % COHORT_C)
    empty_metrics = summary_metrics(empty_summary)
    check("9-4 空班級摘要 CSV 各項為 0",
          empty_metrics.get("學員總人數（人）") == "0"
          and empty_metrics.get("R01–R08 已提交（筆）") == "0"
          and empty_metrics.get("待教師複核（筆）") == "0",
          str(empty_metrics))
    _status, empty_records, _f, _h = get(teacher_a, BASE + RECORDS_CSV % COHORT_C)
    _header, empty_body = records_body(empty_records)
    check("9-5 空班級明細 CSV 只有標題與說明列", len(empty_body) == 0, "列數=%s" % len(empty_body))
    check("9-6 空班級統計與測試庫一致", totals_c["student_count"] == 0
          and totals_c["outstanding_total"] == 0)

    # ── 驗收 10：390×844 手機版版面契約 ────────────────────────────
    _status, css, _f, _h = get(teacher_a, BASE + "/static/learning/teacher-checklist.css")
    check("10-1 清單樣式表可由 HTTP 取得", "trc-section" in css and "trc-table" in css)
    for token in ("@media (max-width:680px)", "min-height:44px", "data-label",
                  "overflow-x", "@page", "A4", "@media print", "table-header-group",
                  "break-inside:avoid"):
        check("10-2 樣式表含 %s" % token, token in css)
    check("10-3 頁面含手機 viewport 設定", 'name="viewport"' in html_a and "width=device-width" in html_a)
    check("10-4 頁面載入清單專屬樣式表", "teacher-checklist.css" in html_a)

    # ── 驗收 11：P1–P5 必要回歸 ─────────────────────────────────────
    status_report_b, report_b, _f, _h = get(teacher_b, BASE + REPORT % COHORT_B)
    check("11-1 P5 班級成果報告仍正常（A／B）",
          status_a == 200 and status_report_b == 200 and "trp-section" in report_b)
    check("11-2 P5 報告統計與測試庫一致（B 班）",
          parse_p5_stats(report_b).get("學員總人數（人）") == totals_b["student_count"]
          and parse_p5_stats(report_b).get("待教師複核（筆）") == totals_b["pending_items_total"],
          str(parse_p5_stats(report_b)))
    status_outcomes, outcomes, _f, _h = get(teacher_a, BASE + "/teacher/class-outcomes/")
    check("11-3 P3 班級學習成果總覽仍正常",
          status_outcomes == 200 and "班級學習成果總覽" in outcomes
          and "P3 · 班級學習成果" in outcomes,
          "status=%s" % status_outcomes)
    status_dash, dash, _f, _h = get(teacher_a, BASE + "/teacher/")
    check("11-4 教師總覽含 P6 結訓審核入口",
          "/teacher/review-checklist/" in dash and "結訓審核清單" in dash)
    check("11-5 教師總覽含 P6 兩種 CSV 匯出入口",
          "/teacher/class-report/export/summary/" in dash
          and "/teacher/class-report/export/records/" in dash)
    check("11-6 P5 班級成果報告入口未被取代",
          "/teacher/class-report/" in dash and "班級成果報告" in dash)
    check("11-7 P3 班級學習成果總覽入口仍在", "/teacher/class-outcomes/" in dash)
    check("11-8 清單頁提供前往 P5 報告與兩種 CSV 的連結",
          "/teacher/class-report/?cohort=" in html_a
          and "/teacher/class-report/export/summary/" in html_a
          and "/teacher/class-report/export/records/" in html_a)
    student_page = get(student_opener, BASE + "/student/learning-path/")[0]
    check("11-9 P1 五階段學習工作台仍可存取（學員）", student_page == 200,
          "status=%s" % student_page)

    # ── 彙總 ────────────────────────────────────────────────────────
    passed = sum(1 for _n, ok, _d in RESULTS if ok)
    failed = [name for name, ok, _d in RESULTS if not ok]
    print("")
    print("=" * 74)
    print("P6 結訓審核與成果交付中心驗收：%d/%d PASS" % (passed, len(RESULTS)))
    if failed:
        print("未通過項目：")
        for name in failed:
            print("  - %s" % name)
    print("=" * 74)
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
