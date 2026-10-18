#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""P8-A 報告讀取副作用稽核（2026-10-13 教師指令第一節）。

目的：判定 P5 報告頁、P6 結訓審核清單與 CSV、P7 成果展示頁在**單純讀取**時
是否對資料庫產生 INSERT／UPDATE／DELETE。

方法：對獨立稽核庫（demo/runtime/db/p8_audit.sqlite3，由 p42_verify.sqlite3 複製）
啟動的 Django :8113 服務，於每個階段前後比對**全庫逐表指紋**（行數 + 內容 SHA256），
逐項列出發生變更的表與前後值。

階段設計：
  0. 基線
  1. 未登入 GET（應被 302 攔截，不觸發報告邏輯）
  2. 教師登入（僅驗證 django_session 變化屬預期）
  3. 首次 GET：P5 報告／P6 清單／P7 展示（觀察惰性初始化）
  4. 重複 GET 同一批頁面（觀察是否仍持續寫入）
  5. CSV 匯出兩種
  6. 跨班級讀取
  7. 刻意刪除資料後 GET（證明寫入路徑確實存在與其重建範圍）

安全護欄：只允許 DB 路徑含 p8_audit；本腳本不觸碰 p42_verify／demo／正式庫。
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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import demo_credentials  # noqa: E402

BASE = "http://192.168.1.114:8113"
DB = r"D:\FDE-AI-UAS-v2.0\demo\runtime\db\p8_audit.sqlite3"

TEACHER_A = "p42.teacher.a@fde-demo.local"
COHORT_A = "P42-A-2026"
COHORT_B = "P42-B-2026"

# 報告路徑可能涉及的資料表（用於判定嚴重性）
REPORT_TABLES = {
    "learning_growthrecordsubmission",
    "learning_growthrecorddefinition",
    "learning_phaseprogress",
    "learning_growthrecordreview",
    "learning_studenttaskprogress",
    "learning_evidence",
}
# 登入／CSRF 造成的預期變化
EXPECTED_TABLES = {"django_session"}

if "p8_audit" not in DB:
    print("[安全停止] 本腳本只允許在 p8_audit 稽核庫執行。")
    sys.exit(2)

TEACHER_PASSWORD = demo_credentials.load_password("teacher", required=False)
if not TEACHER_PASSWORD:
    print("[安全停止] 無法取得教師密碼：請設定 FDE_DEMO_TEACHER_PASSWORD 或提供憑證檔。")
    sys.exit(2)

RESULTS = []


def record(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    print("%s - %s%s" % ("PASS" if ok else "FAIL", name, (" | " + detail) if detail else ""))


# ---------------------------------------------------------------------------
# 資料庫指紋
# ---------------------------------------------------------------------------
def fingerprint():
    con = sqlite3.connect("file:%s?mode=ro" % DB, uri=True, timeout=15)
    tables = [
        row[0]
        for row in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
    ]
    result = {}
    for table in tables:
        try:
            rows = con.execute('SELECT * FROM "%s"' % table).fetchall()
        except sqlite3.Error as exc:
            result[table] = (-1, "ERR:%s" % exc)
            continue
        payload = "\n".join(repr(tuple(row)) for row in rows)
        result[table] = (
            len(rows),
            hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16],
        )
    con.close()
    return result


def diff(before, after):
    changes = []
    for table in sorted(set(before) | set(after)):
        old = before.get(table)
        new = after.get(table)
        if old != new:
            changes.append((table, old, new))
    return changes


def describe(changes):
    if not changes:
        return "無任何資料表變更"
    parts = []
    for table, old, new in changes:
        old_count = old[0] if old else "（不存在）"
        new_count = new[0] if new else "（不存在）"
        parts.append("%s: %s 列 → %s 列" % (table, old_count, new_count))
    return "; ".join(parts)


def split_changes(changes):
    report_changes = [c for c in changes if c[0] in REPORT_TABLES]
    expected_changes = [c for c in changes if c[0] in EXPECTED_TABLES]
    other_changes = [
        c for c in changes if c[0] not in REPORT_TABLES and c[0] not in EXPECTED_TABLES
    ]
    return report_changes, expected_changes, other_changes


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------
def new_session():
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(jar)
    )
    return jar, opener


def _open(opener, url, referer=None, data=None):
    headers = {"User-Agent": "P8-AUDIT/1.0", "Referer": referer or BASE + "/"}
    if data is not None:
        parts = urllib.parse.urlsplit(referer or BASE + "/")
        headers["Origin"] = "%s://%s" % (parts.scheme, parts.netloc)
    request = urllib.request.Request(url, data=data, headers=headers)
    try:
        with opener.open(request, timeout=30) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def get(opener, path):
    status, raw = _open(opener, BASE + path)
    return status, raw.decode("utf-8", "replace")


def login_teacher(opener, jar):
    _status, page = get(opener, "/teacher/login/")
    token = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', page)
    payload = urllib.parse.urlencode(
        {
            "username": TEACHER_A,
            "password": TEACHER_PASSWORD,
            "csrfmiddlewaretoken": token.group(1) if token else "",
        }
    ).encode()
    status, raw = _open(opener, BASE + "/teacher/login/", referer=BASE + "/teacher/login/", data=payload)
    return status, raw.decode("utf-8", "replace")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102
        return None


def get_noredirect(path):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
    request = urllib.request.Request(BASE + path, headers={"User-Agent": "P8-AUDIT/1.0"})
    try:
        with opener.open(request, timeout=30) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


# ---------------------------------------------------------------------------
# 稽核流程
# ---------------------------------------------------------------------------
P5_REPORT = "/teacher/class-report/%s/" % COHORT_A
P6_CHECKLIST = "/teacher/review-checklist/%s/" % COHORT_A
P6_SUMMARY = "/teacher/class-report/export/summary/%s/" % COHORT_A
P6_RECORDS = "/teacher/class-report/export/records/%s/" % COHORT_A
P7_SHOWCASE_A = "/teacher/class-showcase/%s/" % COHORT_A
P7_SHOWCASE_B = "/teacher/class-showcase/%s/" % COHORT_B


def main():
    print("稽核庫：%s" % DB)
    print("服務：%s" % BASE)
    print("")

    # ── 階段 0：基線 ────────────────────────────────────────────────
    f0 = fingerprint()
    print("[階段 0] 基線：共 %d 張資料表" % len(f0))
    for table in sorted(REPORT_TABLES):
        if table in f0:
            print("         %s = %s 列" % (table, f0[table][0]))
    print("")

    # ── 階段 1：未登入 GET ──────────────────────────────────────────
    status, _raw = get_noredirect(P5_REPORT)
    status2, _raw2 = get_noredirect(P7_SHOWCASE_A)
    f1 = fingerprint()
    changes1 = diff(f0, f1)
    record(
        "1-1 未登入 GET 被攔截（302）",
        status == 302 and status2 == 302,
        "P5=%s P7=%s" % (status, status2),
    )
    record("1-2 未登入 GET 未產生任何寫入", not changes1, describe(changes1))

    # ── 階段 2：教師登入 ────────────────────────────────────────────
    jar, opener = new_session()
    login_status, _page = login_teacher(opener, jar)
    f2 = fingerprint()
    changes2 = diff(f1, f2)
    report2, expected2, other2 = split_changes(changes2)
    record(
        "2-1 教師登入成功",
        login_status in (200, 302),
        "HTTP %s" % login_status,
    )
    record(
        "2-2 登入僅影響 session（無報告資料表寫入）",
        not report2,
        describe(report2) if report2 else describe(expected2) or "無變更",
    )
    if other2:
        print("         [注意] 其他表變更：%s" % describe(other2))
    print("")

    # ── 階段 3：首次 GET 報告類頁面 ─────────────────────────────────
    statuses = {}
    for label, path in (
        ("P5 報告", P5_REPORT),
        ("P6 清單", P6_CHECKLIST),
        ("P7 展示", P7_SHOWCASE_A),
    ):
        code, _body = get(opener, path)
        statuses[label] = code
    f3 = fingerprint()
    changes3 = diff(f2, f3)
    report3, expected3, other3 = split_changes(changes3)
    record(
        "3-1 三個報告頁皆回應 200",
        all(code == 200 for code in statuses.values()),
        str(statuses),
    )
    record(
        "3-2 首次 GET 未寫入報告資料表",
        not report3,
        describe(report3) if report3 else "無報告資料表變更",
    )
    if other3:
        print("         [注意] 其他表變更：%s" % describe(other3))
    print("")

    # ── 階段 4：重複 GET ────────────────────────────────────────────
    for _round in range(2):
        for path in (P5_REPORT, P6_CHECKLIST, P7_SHOWCASE_A):
            get(opener, path)
    f4 = fingerprint()
    changes4 = diff(f3, f4)
    report4, _expected4, other4 = split_changes(changes4)
    record("4-1 重複 GET 未寫入報告資料表", not report4, describe(report4) if report4 else "無報告資料表變更")
    if other4:
        print("         [注意] 其他表變更：%s" % describe(other4))
    print("")

    # ── 階段 5：CSV 匯出 ────────────────────────────────────────────
    csv_status = {}
    for label, path in (("班級統計摘要", P6_SUMMARY), ("學員成果明細", P6_RECORDS)):
        code, body = get(opener, path)
        csv_status[label] = "%s(BOM=%s)" % (code, body.startswith("\ufeff"))
    f5 = fingerprint()
    changes5 = diff(f4, f5)
    report5, _expected5, other5 = split_changes(changes5)
    record(
        "5-1 兩種 CSV 匯出成功且含 UTF-8 BOM",
        all("200(BOM=True)" == value for value in csv_status.values()),
        str(csv_status),
    )
    record("5-2 CSV 匯出未寫入報告資料表", not report5, describe(report5) if report5 else "無報告資料表變更")
    if other5:
        print("         [注意] 其他表變更：%s" % describe(other5))
    print("")

    # ── 階段 6：跨班級讀取 ──────────────────────────────────────────
    for path in (P7_SHOWCASE_B, "/teacher/class-report/%s/" % COHORT_B, "/teacher/review-checklist/%s/" % COHORT_B):
        get(opener, path)
    f6 = fingerprint()
    changes6 = diff(f5, f6)
    report6, _expected6, other6 = split_changes(changes6)
    record("6-1 跨班級讀取未寫入報告資料表", not report6, describe(report6) if report6 else "無報告資料表變更")
    if other6:
        print("         [注意] 其他表變更：%s" % describe(other6))
    print("")

    # ── 階段 7：刻意刪除後 GET（證明寫入路徑存在） ─────────────────
    deleted = experiment_delete_and_get()
    print("")

    # ── 匯總 ────────────────────────────────────────────────────────
    passed = sum(1 for _n, ok, _d in RESULTS if ok)
    failed = [name for name, ok, _d in RESULTS if not ok]
    print("==== P8-A 副作用稽核：%d 項通過 / %d 項失敗 / 共 %d 項 ====" % (passed, len(failed), len(RESULTS)))
    for name in failed:
        print("FAIL 詳列：%s" % name)
    print("")
    print("稽核結論：%s" % deleted)
    return 0 if not failed else 1


def experiment_delete_and_get():
    """在稽核庫中刪除一位學員的成長紀錄提交與階段進度，再 GET，觀察是否被重建。

    注意：教師登入後會**重導至教師後台**，而 `teacher_dashboard` 本身也會呼叫
    `ensure_growth_submissions()`。因此必須「先登入、後刪除」，否則登入過程就會
    先把資料補回來，導致基線被污染、無法觀察報告頁的寫入行為。

    這是**破壞性實驗**，僅在 p8_audit 稽核庫進行（已由檔頭安全閘保護）。
    """
    # 先登入（此步驟本身會透過 teacher_dashboard 觸發重建）
    jar, opener = new_session()
    login_teacher(opener, jar)

    con = sqlite3.connect(DB, timeout=15)
    try:
        row = con.execute(
            """SELECT e.id FROM learning_enrollment e
               JOIN learning_cohort c ON c.cohort_id = e.cohort_id
               WHERE c.cohort_id = ? AND e.active = 1
               ORDER BY e.id LIMIT 1""",
            (COHORT_A,),
        ).fetchone()
        if not row:
            record("7-1 破壞性實驗：找不到可測學員", False, "無 active enrollment")
            return "無法執行（找不到學員）"
        enrollment_id = row[0]
        before_subs = con.execute(
            "SELECT COUNT(*) FROM learning_growthrecordsubmission WHERE enrollment_id = ?",
            (enrollment_id,),
        ).fetchone()[0]
        before_phase = con.execute(
            "SELECT COUNT(*) FROM learning_phaseprogress WHERE enrollment_id = ?",
            (enrollment_id,),
        ).fetchone()[0]
        con.execute(
            "DELETE FROM learning_growthrecordsubmission WHERE enrollment_id = ?",
            (enrollment_id,),
        )
        con.execute(
            "DELETE FROM learning_phaseprogress WHERE enrollment_id = ?",
            (enrollment_id,),
        )
        con.commit()
        after_delete_subs = con.execute(
            "SELECT COUNT(*) FROM learning_growthrecordsubmission WHERE enrollment_id = ?",
            (enrollment_id,),
        ).fetchone()[0]
        after_delete_phase = con.execute(
            "SELECT COUNT(*) FROM learning_phaseprogress WHERE enrollment_id = ?",
            (enrollment_id,),
        ).fetchone()[0]
        print(
            "[階段 7] 實驗前：學員 %d 有 %d 筆提交、%d 筆階段進度；刪除後：%d 筆、%d 筆"
            % (
                enrollment_id,
                before_subs,
                before_phase,
                after_delete_subs,
                after_delete_phase,
            )
        )
    finally:
        con.close()

    # 刪除完成後才取基線，此時資料確實缺失
    f_before = fingerprint()
    get(opener, P5_REPORT)
    f_after = fingerprint()
    changes = diff(f_before, f_after)
    report_changes = [c for c in changes if c[0] in REPORT_TABLES]

    con = sqlite3.connect("file:%s?mode=ro" % DB, uri=True, timeout=15)
    rebuilt_subs = con.execute(
        "SELECT COUNT(*) FROM learning_growthrecordsubmission WHERE enrollment_id = ?",
        (enrollment_id,),
    ).fetchone()[0]
    rebuilt_phase = con.execute(
        "SELECT COUNT(*) FROM learning_phaseprogress WHERE enrollment_id = ?",
        (enrollment_id,),
    ).fetchone()[0]
    con.close()

    write_detected = bool(report_changes)
    record(
        "7-1 缺資料時 GET 報告頁確實觸發重建（證明寫入路徑存在）",
        write_detected,
        describe(report_changes) if write_detected else "未偵測到寫入",
    )
    record(
        "7-2 重建範圍為成長紀錄提交與階段進度",
        rebuilt_subs > 0 and rebuilt_phase > 0,
        "重建後：提交 %d 筆、階段進度 %d 筆" % (rebuilt_subs, rebuilt_phase),
    )
    if write_detected:
        return (
            "確認存在**條件式冪等寫入**：當成長紀錄槽位或階段進度不存在時，"
            "讀取報告會自動補建（%s）。資料齊備時不寫入。" % describe(report_changes)
        )
    return "未偵測到任何寫入（需進一步確認實驗有效性）"


if __name__ == "__main__":
    sys.exit(main())
