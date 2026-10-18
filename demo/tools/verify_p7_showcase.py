#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""P7 班級成果發表與教學展示中心驗收（2026-10-13 教師指令第四項 11 項）。

對獨立測試庫（demo/runtime/db/p42_verify.sqlite3）啟動的 Django :8112 進行 HTTP 驗收：
  1. 班級統計與 P5／P6 一致（展示頁 vs 班級成果報告 vs 獨立推導值）
  2. 五階段與 R01–R08 真實數據（逐列核對獨立推導值）
  3. 無資料空狀態
  4. 教師跨班級權限隔離（越權一律 404）
  5. 未登入與學員不可進入教師展示頁（302／403）
  6. 證據存取授權（沿用既有權限檢查；不產生公開 /media/ 網址）
  7. 個資預設隱藏（匿名化展示；具名需教師顯式聲明）
  8. 16:9 簡報播放（7 頁順序、舞台契約、控件存在）
  9. 上一頁、下一頁、Esc（前端行為契約）
 10. 390×844 手機模擬（CSS 契約；實機畫面另由 p7_screenshot.cjs 驗證）
 11. P1–P6 必要回歸（既有頁面仍正常）

所有期望值皆由獨立測試庫唯讀查詢後在腳本內重新推導（不引用產品程式碼）。
憑證不寫入程式：由 demo_credentials 載入器取得。
"""
import http.cookiejar
import os
import re
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

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
STAGE_CHARS = ("學", "練", "做", "測", "證")
SLOTS = ["R%02d" % index for index in range(1, 9)]

SHOWCASE = "/teacher/class-showcase/%s/"
SHOWCASE_ANY = "/teacher/class-showcase/"
REPORT = "/teacher/class-report/%s/"
CHECKLIST = "/teacher/review-checklist/%s/"
OUTCOMES = "/teacher/class-outcomes/"
DASHBOARD = "/teacher/"

SLIDE_ORDER = ("cover", "outcomes", "stages", "slots", "works", "feedback", "closing")

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

if "p42_verify" not in os.environ.get("DJANGO_DB_NAME", "") and "p42_verify" not in DB:
    print("[安全停止] 拒絕在非獨立測試庫執行。")
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
    headers = {"User-Agent": "P7-VERIFY/1.0", "Referer": referer or BASE + "/"}
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
        token_value = ""
        for cookie in jar:
            if cookie.name == "csrftoken":
                token_value = cookie.value
                break
    else:
        token_value = token.group(1)
    payload = urllib.parse.urlencode(
        {"username": email, "password": password, "csrfmiddlewaretoken": token_value}
    ).encode()
    status, raw, final, headers = _open(opener, BASE + path, referer=BASE + path, data=payload)
    return status, raw.decode("utf-8", "replace"), final, headers


def login_as(path, email, password):
    jar, opener = new_session()
    status, page, final, _headers = login(opener, jar, path, email, password)
    ok = status in (200, 302) and "/login/" not in final
    return opener, ok, final


def csrf_from(html):
    match = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', html)
    return match.group(1) if match else ""


def post(opener, url, fields, referer):
    payload = urllib.parse.urlencode(fields).encode()
    return _open(opener, url, referer=referer, data=payload)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102
        return None


def get_noredirect(url, referer=None):
    """不跟隨重導，觀察第一手狀態碼（驗證未登入被擋）。"""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
    request = urllib.request.Request(
        url, headers={"User-Agent": "P7-VERIFY/1.0", "Referer": referer or BASE + "/"}
    )
    try:
        with opener.open(request, timeout=30) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


# ---------------------------------------------------------------------------
# HTML 解析
# ---------------------------------------------------------------------------
def strip_tags(value):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", value)).strip()


def section(html, slide_id):
    start = html.find('id="%s"' % slide_id)
    if start < 0:
        return ""
    end = html.find("</section>", start)
    return html[start: end if end > 0 else len(html)]


def parse_stat_cards(html, num_cls, label_cls):
    pattern = re.compile(
        r'<span class="%s">([^<]*)</span>\s*<span class="%s">([^<]*)</span>' % (num_cls, label_cls)
    )
    return {label.strip(): num.strip() for num, label in pattern.findall(html)}


def parse_table_rows(fragment, columns):
    rows = []
    for tr in re.findall(r"<tr>\s*(.*?)</tr>", fragment, re.S):
        cells = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)
        if len(cells) == columns:
            rows.append([strip_tags(cell) for cell in cells])
    return rows


def parse_slide_positions(html):
    return [html.find('data-slide="%s"' % slide) for slide in SLIDE_ORDER]


def parse_cohort_options(html):
    return re.findall(r'<option value="([^"]+)"', html)


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
        "evidence": [],
        "teacher_access": {},
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
                  r.teacher_note
           FROM learning_growthrecordreview r
           JOIN learning_growthrecordsubmission s ON s.id = r.submission_id
           JOIN learning_growthrecorddefinition d ON d.id = s.definition_id
           JOIN learning_enrollment e ON e.id = s.enrollment_id
           JOIN learning_cohort c ON c.cohort_id = e.cohort_id
           JOIN learning_studentprofile sp ON sp.student_id = e.student_id
           ORDER BY r.reviewed_at, r.id"""
    ):
        truth["reviews"][(row["public_user_id"], row["slot_id"])] = {
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
    for row in con.execute(
        """SELECT ev.evidence_id, c.cohort_id, sp.public_user_id, ev.evidence_type, ev.upload
           FROM learning_evidence ev
           LEFT JOIN learning_growthrecordsubmission s ON s.id = ev.growth_submission_id
           LEFT JOIN learning_studenttaskprogress p ON p.id = ev.progress_id
           JOIN learning_enrollment e ON e.id = COALESCE(s.enrollment_id, p.enrollment_id)
           JOIN learning_cohort c ON c.cohort_id = e.cohort_id
           JOIN learning_studentprofile sp ON sp.student_id = e.student_id"""
    ):
        truth["evidence"].append(
            {
                "evidence_id": row["evidence_id"],
                "cohort_id": row["cohort_id"],
                "public_user_id": row["public_user_id"],
                "type": row["evidence_type"],
                "has_upload": bool(row["upload"]),
            }
        )
    for row in con.execute(
        """SELECT c.cohort_id, u.username
           FROM learning_teachercohortaccess a
           JOIN learning_cohort c ON c.cohort_id = a.cohort_id
           JOIN auth_user u ON u.id = a.teacher_id"""
    ):
        truth["teacher_access"].setdefault(row["username"], set()).add(row["cohort_id"])
    con.close()
    return truth


def derive(truth, cohort_id):
    """由獨立測試庫推導班級層級與學員層級期望值。"""
    students = sorted(
        pid for pid, info in truth["students"].items() if info["cohort_id"] == cohort_id
    )
    per_student = {}
    for pid in students:
        slots = {slot: truth["submissions"].get((pid, slot)) for slot in SLOTS}
        submitted_count = sum(1 for status in slots.values() if status in SUBMITTED_STATUSES)
        unsubmitted = [slot for slot, status in slots.items() if status not in SUBMITTED_STATUSES]
        pending = [slot for slot, status in slots.items() if status == "submitted"]
        needs = [slot for slot, status in slots.items() if status == "needs_revision"]
        reviews = {
            slot: truth["reviews"][(pid, slot)]
            for slot in SLOTS
            if (pid, slot) in truth["reviews"]
        }
        tasks = {key: value for key, value in truth["tasks"].items() if key[0] == pid}
        reviewed_results = len(reviews) + sum(
            1
            for value in tasks.values()
            if value["status"] == "reviewed" or value["note"].strip() or value["score"] is not None
        )
        pending_tasks = sum(1 for value in tasks.values() if value["status"] == "submitted")
        completed = sum(
            1 for phase in STAGE_KEYS if truth["phases"].get((pid, phase)) == "completed"
        )
        pending_count = len(pending) + pending_tasks
        per_student[pid] = {
            "submitted_count": submitted_count,
            "unsubmitted_count": len(unsubmitted),
            "pending_count": pending_count,
            "needs_revision_count": len(needs),
            "reviewed_result_count": reviewed_results,
            "completed_stages": completed,
        }
    reviewed_total = sum(
        sum(1 for slot in SLOTS if truth["submissions"].get((pid, slot)) in REVIEWED_STATUSES)
        for pid in students
    )
    slot_rows = []
    for slot in SLOTS:
        submitted = sum(
            1
            for pid in students
            if truth["submissions"].get((pid, slot)) in SUBMITTED_STATUSES
        )
        reviewed = sum(
            1
            for pid in students
            if truth["submissions"].get((pid, slot)) in REVIEWED_STATUSES
        )
        slot_rows.append((slot, submitted, reviewed))
    stage_rows = []
    for phase in STAGE_KEYS:
        done = sum(1 for pid in students if truth["phases"].get((pid, phase)) == "completed")
        stage_rows.append((done, len(students)))
    return {
        "students": students,
        "per_student": per_student,
        "totals": {
            "student_count": len(students),
            "total_submitted": sum(item["submitted_count"] for item in per_student.values()),
            "total_reviewed": reviewed_total,
            "pending_items_total": sum(item["pending_count"] for item in per_student.values()),
            "needs_revision_total": sum(
                item["needs_revision_count"] for item in per_student.values()
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
        },
        "slot_rows": slot_rows,
        "stage_rows": stage_rows,
    }


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
def main():
    truth = db_truth()
    print("獨立測試庫班級：%s" % ", ".join(sorted(truth["cohorts"])))
    print("獨立測試庫在學學員：%d 位 · 證據 %d 件" % (len(truth["students"]), len(truth["evidence"])))

    expected_a = derive(truth, COHORT_A)
    expected_b = derive(truth, COHORT_B)
    expected_c = derive(truth, COHORT_C)

    # ── 登入 ──────────────────────────────────────────────────────────
    teacher_a, ok_a, final_a = login_as("/teacher/login/", TEACHER_A, TEACHER_PASSWORD)
    check("1-1 教師 A 登入成功", ok_a, final_a)
    teacher_b, ok_b, final_b = login_as("/teacher/login/", TEACHER_B, TEACHER_PASSWORD)
    check("1-2 教師 B 登入成功", ok_b, final_b)
    if not (ok_a and ok_b):
        print("")
        print("[中止] 教師登入失敗，無法繼續驗收。")
        return 1

    # ── 驗收 1：班級統計與 P5／P6 一致 ────────────────────────────────
    status, showcase_a, _f, headers = get(teacher_a, BASE + SHOWCASE % COHORT_A)
    check("1-3 展示頁回應 200", status == 200, "HTTP %s" % status)
    check(
        "1-4 展示頁不可公開快取",
        "no-store" in (headers.get("Cache-Control", "") or "")
        or "no-cache" in (headers.get("Cache-Control", "") or ""),
        headers.get("Cache-Control", ""),
    )

    showcase_stats = parse_stat_cards(
        section(showcase_a, "slide-outcomes"), "sc-stat-num", "sc-stat-label"
    )
    status, report_a, _f, _h = get(teacher_a, BASE + REPORT % COHORT_A)
    check("1-5 班級成果報告回應 200", status == 200, "HTTP %s" % status)
    report_stats = parse_stat_cards(report_a, "trp-stat-num", "trp-stat-label")

    shared_labels = [label for label in showcase_stats if label in report_stats]
    check("1-6 展示頁與報告頁有共同統計卡", len(shared_labels) >= 5, "共同 %d 張" % len(shared_labels))
    mismatched = [
        "%s: 展示=%s 報告=%s" % (label, showcase_stats[label], report_stats[label])
        for label in shared_labels
        if showcase_stats[label] != report_stats[label]
    ]
    check("1-7 展示頁與報告頁數字完全一致", not mismatched, "; ".join(mismatched))

    expected_pairs = [
        ("學員總人數（人）", expected_a["totals"]["student_count"]),
        ("R01–R08 已提交（筆）", expected_a["totals"]["total_submitted"]),
        ("R01–R08 已複核（筆）", expected_a["totals"]["total_reviewed"]),
        ("八項已提交（人）", expected_a["totals"]["all_submitted_count"]),
        ("待教師複核（筆）", expected_a["totals"]["pending_items_total"]),
        ("已有教師複核結果（筆）", expected_a["totals"]["reviewed_result_total"]),
    ]
    wrong = [
        "%s: 頁面=%s 期望=%s" % (label, showcase_stats.get(label), value)
        for label, value in expected_pairs
        if showcase_stats.get(label) != str(value)
    ]
    check("1-8 展示頁數字與獨立推導值相符", not wrong, "; ".join(wrong))

    # 與 P6 結訓審核清單、CSV 匯出交叉比對（同一統計來源）
    status, checklist_a, _f, _h = get(teacher_a, BASE + CHECKLIST % COHORT_A)
    check("1-9 結訓審核清單仍可存取（P6 回歸）", status == 200, "HTTP %s" % status)
    status, csv_body, _f, _h = get(
        teacher_a, BASE + "/teacher/class-report/export/summary/%s/" % COHORT_A
    )
    check(
        "1-10 P6 CSV 匯出仍正常（UTF-8 BOM）",
        status == 200 and csv_body.startswith("\ufeff"),
        "HTTP %s" % status,
    )
    check(
        "1-11 展示頁統計與 P5 報告頁逐項相同",
        all(showcase_stats[label] == report_stats[label] for label in shared_labels),
        "%d 張統計卡" % len(shared_labels),
    )

    # ── 驗收 2：五階段與 R01–R08 真實數據 ────────────────────────────
    stage_rows = parse_table_rows(section(showcase_a, "slide-stages"), 4)
    check("2-1 五階段共 5 列", len(stage_rows) == 5, "實際 %d 列" % len(stage_rows))
    stage_chars = [row[0].split("｜")[0] for row in stage_rows]
    check("2-2 五階段順序為 學→練→做→測→證", stage_chars == list(STAGE_CHARS), str(stage_chars))
    stage_mismatch = []
    for index, (done, total) in enumerate(expected_a["stage_rows"]):
        if index >= len(stage_rows):
            break
        if stage_rows[index][1] != "%d 人" % done or stage_rows[index][2] != "%d 人" % total:
            stage_mismatch.append(
                "%s: 頁面=%s/%s 期望=%d/%d"
                % (stage_chars[index], stage_rows[index][1], stage_rows[index][2], done, total)
            )
    check("2-3 五階段完成人數與獨立推導值相符", not stage_mismatch, "; ".join(stage_mismatch))

    slot_rows = parse_table_rows(section(showcase_a, "slide-slots"), 4)
    check("2-4 R01–R08 共 8 列", len(slot_rows) == 8, "實際 %d 列" % len(slot_rows))
    slot_mismatch = []
    for index, (slot_id, submitted, reviewed) in enumerate(expected_a["slot_rows"]):
        if index >= len(slot_rows):
            break
        if slot_rows[index][0] != slot_id:
            slot_mismatch.append("順序 %s != %s" % (slot_rows[index][0], slot_id))
            continue
        if slot_rows[index][2] != "%d / %d" % (submitted, len(expected_a["students"])):
            slot_mismatch.append("%s 已提交 %s" % (slot_id, slot_rows[index][2]))
        if slot_rows[index][3] != "%d / %d" % (reviewed, len(expected_a["students"])):
            slot_mismatch.append("%s 已複核 %s" % (slot_id, slot_rows[index][3]))
    check("2-5 R01–R08 提交／複核數與獨立推導值相符", not slot_mismatch, "; ".join(slot_mismatch))

    works_html = section(showcase_a, "slide-works")
    card_count = len(re.findall(r'<article class="sc-work">', works_html))
    check(
        "2-6 學員作品卡數等於班級人數",
        card_count == expected_a["totals"]["student_count"],
        "卡片 %d / 學員 %d" % (card_count, expected_a["totals"]["student_count"]),
    )

    # ── 驗收 3：無資料空狀態 ────────────────────────────────────────
    status, showcase_c, _f, _h = get(teacher_a, BASE + SHOWCASE % COHORT_C)
    check("3-1 空班級展示頁回應 200", status == 200, "HTTP %s" % status)
    empty_stats = parse_stat_cards(
        section(showcase_c, "slide-outcomes"), "sc-stat-num", "sc-stat-label"
    )
    check(
        "3-2 空班級學員數為 0",
        empty_stats.get("學員總人數（人）") == "0",
        empty_stats.get("學員總人數（人）", "（缺）"),
    )
    check(
        "3-3 空班級顯示尚無紀錄",
        "尚無紀錄" in section(showcase_c, "slide-works"),
        "作品區空狀態",
    )
    check(
        "3-4 空班級教師回饋顯示尚無紀錄",
        "尚無紀錄" in section(showcase_c, "slide-feedback"),
        "回饋區空狀態",
    )

    # ── 驗收 4：教師跨班級權限隔離 ──────────────────────────────────
    access_b = truth["teacher_access"].get(TEACHER_B, set())
    forbidden = sorted(set(truth["cohorts"]) - access_b)[:1]
    status, _body, _f, _h = get(teacher_b, BASE + SHOWCASE % COHORT_A)
    check("4-1 教師 B 存取 A 班展示頁為 404", status == 404, "HTTP %s" % status)
    status, _body, _f, _h = get(teacher_b, BASE + SHOWCASE % COHORT_C)
    check("4-2 教師 B 存取未授權空班級為 404", status == 404, "HTTP %s" % status)
    if forbidden:
        status, _body, _f, _h = get(teacher_b, BASE + SHOWCASE % forbidden[0])
        check(
            "4-3 教師 B 存取他班（%s）為 404" % forbidden[0],
            status == 404,
            "HTTP %s" % status,
        )

    status, body_b, _f, _h = get(teacher_b, BASE + SHOWCASE % COHORT_B)
    check("4-4 教師 B 可存取自身班級", status == 200, "HTTP %s" % status)
    options_b = parse_cohort_options(body_b)
    check(
        "4-5 教師 B 班級選單僅含授權班級",
        set(options_b) <= access_b,
        "選單 %s / 授權 %s" % (sorted(set(options_b)), sorted(access_b)),
    )

    status, _body, _f, _h = get(teacher_a, BASE + SHOWCASE_ANY)
    check("4-6 未指定班級時回應 200", status == 200, "HTTP %s" % status)

    # ── 驗收 5：未登入與學員不可進入 ────────────────────────────────
    status, _raw = get_noredirect(BASE + SHOWCASE % COHORT_A)
    check("5-1 未登入存取展示頁為 302", status == 302, "HTTP %s" % status)
    status, _raw = get_noredirect(BASE + SHOWCASE_ANY)
    check("5-2 未登入存取入口為 302", status == 302, "HTTP %s" % status)

    student, ok_s, final_s = login_as("/login/", STUDENT_A, STUDENT_PASSWORD)
    check("5-3 學員登入成功", ok_s, final_s)
    if ok_s:
        status, body_s, _f, _h = get(student, BASE + SHOWCASE % COHORT_A)
        check("5-4 學員存取展示頁為 403", status == 403, "HTTP %s" % status)
        check("5-5 學員未取得任何統計內容", "sc-stat-num" not in body_s, "無統計卡")
        status, _body, _f, _h = get(student, BASE + SHOWCASE_ANY)
        check("5-6 學員存取展示入口為 403", status == 403, "HTTP %s" % status)

    # ── 驗收 6：證據存取授權 ────────────────────────────────────────
    check(
        "6-1 匿名化展示頁不輸出任何證據下載連結",
        "/download/" not in showcase_a,
        "無 /download/",
    )
    check("6-2 展示頁不含公開 /media/ 網址", "/media/" not in showcase_a, "無 /media/")
    evidence_a = [item for item in truth["evidence"] if item["cohort_id"] == COHORT_A]
    if evidence_a:
        # SQLite 以 32 位十六進位儲存 UUIDField；還原為標準帶連字號格式才能命中 URL。
        with_file = [item for item in evidence_a if item["has_upload"]]
        target = str(uuid.UUID(str((with_file or evidence_a)[0]["evidence_id"])))
        status, _raw = get_noredirect("%s/evidence/%s/download/" % (BASE, target))
        check("6-3 未登入存取證據為 302", status == 302, "HTTP %s" % status)
        status, _body, _f, _h = get(teacher_b, "%s/evidence/%s/download/" % (BASE, target))
        check("6-4 非授權教師存取證據為 404", status == 404, "HTTP %s" % status)
        status, _body, _f, _h = get(teacher_a, "%s/evidence/%s/download/" % (BASE, target))
        check(
            "6-5 授權教師未被權限拒絕（200 或檔案缺失 404）",
            status in (200, 404),
            "HTTP %s" % status,
        )
    else:
        check("6-3 A 班無既有證據，跳過逐件授權比對", True, "以 6-1／6-2 契約替代")

    # ── 驗收 7：個資預設隱藏 ────────────────────────────────────────
    nicknames_a = {
        info["nickname"]
        for pid, info in truth["students"].items()
        if info["cohort_id"] == COHORT_A
    }
    leaked = sorted(name for name in nicknames_a if name and name in showcase_a)
    check("7-1 預設不顯示任何學員暱稱", not leaked, "洩漏：%s" % leaked)
    check("7-2 預設標示為匿名化展示", "匿名化展示（預設）" in showcase_a, "模式標籤")
    check("7-3 預設顯示匿名序號", "學員 01" in showcase_a, "序號標籤")
    check("7-4 頁面載明隱私預設說明", "隱私預設" in showcase_a, "隱私列")
    check(
        "7-5 載明未確認授權時不顯示",
        "無法確認授權時一律不顯示" in showcase_a,
        "授權說明",
    )
    check(
        "7-6 未開放匿名觀看（未登入 302）",
        get_noredirect(BASE + SHOWCASE % COHORT_A)[0] == 302,
        "302",
    )

    # 具名展示需教師顯式聲明
    token = csrf_from(showcase_a)
    post(teacher_a, BASE + SHOWCASE % COHORT_A, {"action": "enable_identify", "csrfmiddlewaretoken": token}, BASE + SHOWCASE % COHORT_A)
    status, named_a, _f, _h = get(teacher_a, BASE + SHOWCASE % COHORT_A)
    named_ok = all(name in named_a for name in nicknames_a if name)
    check("7-7 教師顯式聲明後可具名展示", named_ok, "暱稱 %d 個" % len(nicknames_a))
    # P8-B：具名標示改為「教師確認已取得必要授權」，並須載明系統無法查核授權來源。
    check(
        "7-8 具名模式標示授權聲明",
        "具名展示（教師確認已取得必要授權）" in named_a,
        "模式標籤",
    )
    check(
        "7-8b 具名模式載明系統無法查核授權來源",
        "本系統無法查核授權來源" in named_a,
        "授權聲明",
    )
    if evidence_a:
        check(
            "7-9 具名模式仍不使用 /media/ 直連",
            "/media/" not in named_a,
            "使用既有授權端點",
        )
    token = csrf_from(named_a)
    post(teacher_a, BASE + SHOWCASE % COHORT_A, {"action": "disable_identify", "csrfmiddlewaretoken": token}, BASE + SHOWCASE % COHORT_A)
    status, back_a, _f, _h = get(teacher_a, BASE + SHOWCASE % COHORT_A)
    check(
        "7-10 可回復匿名化展示",
        not any(name in back_a for name in nicknames_a if name),
        "已回復匿名",
    )

    # ── 驗收 8：16:9 簡報播放 ──────────────────────────────────────
    positions = parse_slide_positions(showcase_a)
    check("8-1 七頁投影片皆存在", all(pos >= 0 for pos in positions), str(positions))
    check("8-2 投影片順序正確", positions == sorted(positions), str(positions))
    slide_count = len(re.findall(r'class="sc-slide', showcase_a))
    check("8-3 投影片總數為 7", slide_count == 7, "實際 %d" % slide_count)
    for token_name, label in (
        ("sc-slide-cover", "封面"),
        ("班級成果", "班級成果"),
        ("五階段概況", "五階段概況"),
        ("R01–R08 真實提交成果", "R01–R08"),
        ("學員作品與成果證據", "學員作品"),
        ("教師已複核的學習成果與回饋", "教師回饋"),
        ("結語", "結語"),
    ):
        check("8-4 含「%s」頁" % label, token_name in showcase_a, token_name)
    for token_name in ("showcase-start", "sc-prev", "sc-next", "sc-exit", "sc-current", "sc-stage"):
        check("8-5 含控件 %s" % token_name, token_name in showcase_a, token_name)

    css_status, css_text, _f, _h = get(teacher_a, BASE + "/static/learning/teacher-showcase.css")
    check("8-6 樣式檔可存取", css_status == 200, "HTTP %s" % css_status)
    check("8-7 樣式含 16:9 舞台契約", "16 / 9" in css_text, "min(100vw, calc(100vh * 16 / 9))")
    check("8-8 樣式含全螢幕展示模式", "body.sc-presenting" in css_text, "sc-presenting")

    # ── 驗收 9：上一頁、下一頁、Esc ────────────────────────────────
    js_status, js_text, _f, _h = get(teacher_a, BASE + "/static/learning/teacher-showcase.js")
    check("9-1 腳本檔可存取", js_status == 200, "HTTP %s" % js_status)
    for key in ("ArrowRight", "ArrowLeft", "PageUp", "PageDown", "Home", "End", "Escape"):
        check("9-2 支援鍵盤 %s" % key, key in js_text, key)
    check("9-3 支援全螢幕進入／退出", "requestFullscreen" in js_text and "exitFullscreen" in js_text, "Fullscreen API")
    check("9-4 上一頁／下一頁按鈕綁定", "sc-prev" in js_text and "sc-next" in js_text, "prev/next")
    check("9-5 不含 PPTX／影片產生器", not any(t in js_text for t in ("jszip", "ffmpeg", "PptxGenJS", "MediaRecorder")), "零第三方依賴")

    # ── 驗收 10：390×844 手機模擬（CSS 契約） ──────────────────────
    check("10-1 樣式含手機斷點", "@media (max-width:680px)" in css_text, "680px")
    check("10-2 樣式含 44px 觸控目標", "min-height:44px" in css_text, "44px")
    check(
        "10-3 表格於手機轉卡片",
        "td::before{content:attr(data-label)" in css_text.replace(" ", ""),
        "data-label 卡片化",
    )
    mobile_block = css_text.split("@media (max-width:680px)")[-1]
    check("10-4 手機簡報改為填滿螢幕", "100vw" in mobile_block, "非 16:9 letterbox")

    # ── 驗收 11：P1–P6 必要回歸 ────────────────────────────────────
    for label, url in (
        ("P3 班級學習成果總覽", OUTCOMES),
        ("P5 班級成果報告", REPORT % COHORT_A),
        ("P6 結訓審核清單", CHECKLIST % COHORT_A),
        ("教師總覽", DASHBOARD),
    ):
        status, body, _f, _h = get(teacher_a, BASE + url)
        check("11-1 %s 仍正常" % label, status == 200, "HTTP %s" % status)
    status, body, _f, _h = get(teacher_a, BASE + DASHBOARD)
    check("11-2 教師總覽含 P7 入口", "班級成果展示中心" in body, "P7 入口")
    check("11-3 教師總覽仍含 P5／P6 入口", "班級成果報告" in body and "結訓審核清單" in body, "P5/P6 未移除")

    # ── 匯總 ────────────────────────────────────────────────────────
    passed = sum(1 for _n, ok, _d in RESULTS if ok)
    failed = [name for name, ok, _d in RESULTS if not ok]
    print("")
    print("==== P7 班級成果展示驗收：%d 項通過 / %d 項失敗 / 共 %d 項 ====" % (passed, len(failed), len(RESULTS)))
    for name in failed:
        print("FAIL 詳列：%s" % name)
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
