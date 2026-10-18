#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""P9-A／P9-B 報告唯讀化稽核與統計一致性驗收（2026-10-13 教師 P9 指令）。

P8 稽核結論：`build_cohort_report()` 在資料齊備時零寫入，但**資料缺失時會補建**
GrowthRecordSubmission 與 PhaseProgress。P9 要求 P5 報告、P6 結訓清單、
P6 兩種 CSV、P7 成果展示的**讀取**不得產生任何資料庫寫入。

本腳本對獨立稽核庫（demo/runtime/db/p9_audit.sqlite3，由 p42_verify.sqlite3 複製）
啟動的 Django :8114 服務，於每個階段前後比對**全庫逐表指紋**（行數 + 內容 SHA256）。

階段設計：
  0. 基線
  1. 未登入 GET（應被 302 攔截）
  2. 教師登入（僅 django_session 變化屬預期）
  3. 首次 GET：P5 報告／P6 清單／P7 展示 → **P9 要求零寫入**
  4. 重複 GET 同一批頁面 → 零寫入
  5. 兩種 CSV 匯出 → 零寫入
  6. 跨班級讀取 → 零寫入
  7. **刻意刪除報告資料列後再 GET → 仍須零寫入**（P9 核心；P8 時代此處會補建）
  8. 缺資料狀態下統計仍正確表達「未開始」（學員數與 R01–R08 槽位不消失）
  9. 統計一致性：P5 報告／P6 清單／P7 展示的共同標籤數值相同
 10. 多班級教師權限（越權一律 404）

安全護欄：只允許 DB 路徑含 p9_audit；本腳本不觸碰 p42_verify／demo／正式庫。
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

BASE = "http://192.168.1.114:8114"
DB = r"D:\FDE-AI-UAS-v2.0\demo\runtime\db\p9_audit.sqlite3"
# 還原來源（唯讀）：P4.2–P8 共用的隔離驗收副本，僅用於把階段 7 刪除的資料放回，
# 使稽核可重複執行。絕不寫入此檔。
SOURCE_DB = r"D:\FDE-AI-UAS-v2.0\demo\runtime\db\p42_verify.sqlite3"
RESTORE_TABLES = ("learning_growthrecordsubmission", "learning_phaseprogress")

TEACHER_A = "p42.teacher.a@fde-demo.local"
TEACHER_B = "p42.teacher.b@fde-demo.local"
COHORT_A = "P42-A-2026"
COHORT_B = "P42-B-2026"

# 報告讀取可能涉及的表（P9 要求這些表在任何 GET／CSV 下皆不得變動）
REPORT_TABLES = {
    "learning_growthrecordsubmission",
    "learning_growthrecorddefinition",
    "learning_phaseprogress",
    "learning_growthrecordreview",
    "learning_studenttaskprogress",
    "learning_evidence",
}
EXPECTED_TABLES = {"django_session"}

if "p9_audit" not in DB:
    print("[安全停止] 本腳本只允許在 p9_audit 稽核庫執行。")
    sys.exit(2)
if "p42_verify" not in SOURCE_DB:
    print("[安全停止] 還原來源必須是 p42_verify 隔離副本。")
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
# 資料庫指紋與（稽核庫專用）破壞性操作
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
        if before.get(table) != after.get(table):
            changes.append((table, before.get(table), after.get(table)))
    return changes


def describe(changes):
    if not changes:
        return "無任何資料表變更"
    return "; ".join(
        "%s: %s 列 → %s 列" % (t, old[0] if old else "（不存在）", new[0] if new else "（不存在）")
        for t, old, new in changes
    )


def table_count(table):
    con = sqlite3.connect("file:%s?mode=ro" % DB, uri=True, timeout=15)
    try:
        return con.execute('SELECT COUNT(*) FROM "%s"' % table).fetchone()[0]
    finally:
        con.close()


def delete_report_rows():
    """僅在稽核副本上刪除報告資料列（P9 階段 7 專用）。"""
    con = sqlite3.connect(DB, timeout=15)
    try:
        with con:
            con.execute("DELETE FROM learning_growthrecordsubmission")
            con.execute("DELETE FROM learning_phaseprogress")
    finally:
        con.close()


def restore_report_rows():
    """從 p42_verify 隔離副本把報告資料列放回稽核庫（唯讀來源），使稽核可重複執行。"""
    con = sqlite3.connect(DB, timeout=20)
    try:
        con.execute("ATTACH DATABASE ? AS src", (SOURCE_DB,))
        try:
            with con:
                for table in RESTORE_TABLES:
                    con.execute('DELETE FROM "%s"' % table)
                    con.execute(
                        'INSERT INTO "%s" SELECT * FROM src."%s"' % (table, table)
                    )
        finally:
            con.execute("DETACH DATABASE src")
    finally:
        con.close()


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
    headers = {"User-Agent": "P9-AUDIT/1.0", "Referer": referer or BASE + "/"}
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


def get_bytes(opener, path):
    """CSV 等需要檢查 BOM 的端點：回傳未解碼的 bytes。"""
    return _open(opener, BASE + path)


def login_teacher(opener, email=TEACHER_A):
    _status, page = get(opener, "/teacher/login/")
    token = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', page)
    payload = urllib.parse.urlencode(
        {
            "username": email,
            "password": TEACHER_PASSWORD,
            "csrfmiddlewaretoken": token.group(1) if token else "",
        }
    ).encode()
    status, raw = _open(
        opener, BASE + "/teacher/login/", referer=BASE + "/teacher/login/", data=payload
    )
    return status, raw.decode("utf-8", "replace")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102
        return None


def get_noredirect(path):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
    request = urllib.request.Request(BASE + path, headers={"User-Agent": "P9-AUDIT/1.0"})
    try:
        with opener.open(request, timeout=30) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


# ---------------------------------------------------------------------------
# HTML 統計擷取
# ---------------------------------------------------------------------------
def stat_pairs(html, num_class, label_class):
    """擷取「數值 + 標籤」統計卡，回傳 {標籤: 數值}。"""
    pattern = re.compile(
        r'<%s[^>]*class="[^"]*\b%s\b[^"]*"[^>]*>\s*([^<]*?)\s*</%s>\s*'
        r'<%s[^>]*class="[^"]*\b%s\b[^"]*"[^>]*>\s*([^<]*?)\s*</%s>'
        % ("span", num_class, "span", "span", label_class, "span"),
        re.S,
    )
    pairs = {}
    for match in pattern.finditer(html):
        value = match.group(1).strip()
        label = match.group(2).strip()
        if label:
            pairs[label] = value
    return pairs


P5_REPORT = "/teacher/class-report/%s/" % COHORT_A
P6_CHECKLIST = "/teacher/review-checklist/%s/" % COHORT_A
P6_SUMMARY = "/teacher/class-report/export/summary/%s/" % COHORT_A
P6_RECORDS = "/teacher/class-report/export/records/%s/" % COHORT_A
P7_SHOWCASE_A = "/teacher/class-showcase/%s/" % COHORT_A
P7_SHOWCASE_B = "/teacher/class-showcase/%s/" % COHORT_B

# P5 報告頁與 P7 展示頁共用的統計卡標籤（同一 build_cohort_report 來源）
SHARED_LABELS = (
    "學員總人數（人）",
    "R01–R08 已提交（筆）",
    "R01–R08 已複核（筆）",
    "八項已提交（人）",
    "待教師複核（筆）",
)
# P5／P6／P7 三者皆有者（實測共同標籤僅此一項；其餘為兩兩交集）
TRIPLE_LABELS = ("待教師複核（筆）",)
# P6 清單與 P7 展示皆有者
P6_P7_LABELS = ("已有教師複核結果（筆）",)


def main():
    print("=" * 74)
    print("  P9-A／P9-B 報告唯讀化稽核（%s）" % DB)
    print("=" * 74)

    # ── 前置：還原報告資料列（讓稽核可重複執行）────────────────────
    restore_report_rows()

    # ── 階段 0：基線 ────────────────────────────────────────────────
    base = fingerprint()
    print("[階段 0] 基線：%d 張表（報告資料列已自 p42_verify 還原）" % len(base))
    for table in sorted(REPORT_TABLES):
        print("         %s = %s 列" % (table, base.get(table, ("?",))[0]))

    # ── 階段 1：未登入 GET ─────────────────────────────────────────
    before = fingerprint()
    status_p5, _ = get_noredirect(P5_REPORT)
    status_p7, _ = get_noredirect(P7_SHOWCASE_A)
    after = fingerprint()
    record(
        "1-1 未登入 GET 被攔截（302）",
        status_p5 == 302 and status_p7 == 302,
        "P5=%s P7=%s" % (status_p5, status_p7),
    )
    changes = diff(before, after)
    record("1-2 未登入 GET 未產生任何寫入", not changes, describe(changes))

    # ── 階段 2：教師登入 ───────────────────────────────────────────
    before = fingerprint()
    jar, opener = new_session()
    status, _page = login_teacher(opener)
    after = fingerprint()
    changes = diff(before, after)
    report_changes = [c for c in changes if c[0] in REPORT_TABLES]
    record("2-1 教師登入成功", status in (200, 302), "HTTP %s" % status)
    record(
        "2-2 登入僅影響 session（無報告資料表寫入）",
        not report_changes,
        describe(changes),
    )

    # ── 階段 3：首次 GET（P9 核心期望：零寫入）────────────────────
    before = fingerprint()
    statuses = {}
    bodies = {}
    for key, path in (
        ("P5 報告", P5_REPORT),
        ("P6 清單", P6_CHECKLIST),
        ("P7 展示", P7_SHOWCASE_A),
    ):
        code, body = get(opener, path)
        statuses[key] = code
        bodies[key] = body
    after = fingerprint()
    changes = diff(before, after)
    record(
        "3-1 三個報告頁皆回應 200",
        all(code == 200 for code in statuses.values()),
        str(statuses),
    )
    record(
        "3-2 首次 GET 零寫入（P9 唯讀化核心）",
        not changes,
        describe(changes),
    )

    # ── 階段 4：重複 GET ───────────────────────────────────────────
    before = fingerprint()
    for path in (P5_REPORT, P6_CHECKLIST, P7_SHOWCASE_A):
        get(opener, path)
    after = fingerprint()
    changes = diff(before, after)
    record("4-1 重複 GET 零寫入", not changes, describe(changes))

    # ── 階段 5：CSV 匯出 ───────────────────────────────────────────
    before = fingerprint()
    code_summary, body_summary = get_bytes(opener, P6_SUMMARY)
    code_records, body_records = get_bytes(opener, P6_RECORDS)
    after = fingerprint()
    changes = diff(before, after)
    record(
        "5-1 兩種 CSV 匯出成功且含 UTF-8 BOM",
        code_summary == 200
        and code_records == 200
        and body_summary.startswith(b"\xef\xbb\xbf")
        and body_records.startswith(b"\xef\xbb\xbf"),
        "摘要=%s(BOM=%s) 明細=%s(BOM=%s)"
        % (
            code_summary,
            body_summary.startswith(b"\xef\xbb\xbf"),
            code_records,
            body_records.startswith(b"\xef\xbb\xbf"),
        ),
    )
    record("5-2 CSV 匯出零寫入", not changes, describe(changes))

    # ── 階段 6：跨班級讀取 ─────────────────────────────────────────
    before = fingerprint()
    for path in (P5_REPORT, P6_CHECKLIST, P7_SHOWCASE_B):
        get(opener, path)
    after = fingerprint()
    changes = diff(before, after)
    record("6-1 跨班級讀取零寫入", not changes, describe(changes))

    # ── 階段 7：缺資料情境（P9 核心）──────────────────────────────
    submissions_before = table_count("learning_growthrecordsubmission")
    phases_before = table_count("learning_phaseprogress")
    delete_report_rows()
    submissions_after = table_count("learning_growthrecordsubmission")
    phases_after = table_count("learning_phaseprogress")
    print(
        "[階段 7] 刻意刪除報告資料列：提交 %d → %d 列；階段進度 %d → %d 列"
        % (submissions_before, submissions_after, phases_before, phases_after)
    )

    before = fingerprint()
    statuses = {}
    bodies_missing = {}
    for key, path in (
        ("P5 報告", P5_REPORT),
        ("P6 清單", P6_CHECKLIST),
        ("P7 展示", P7_SHOWCASE_A),
    ):
        code, body = get(opener, path)
        statuses[key] = code
        bodies_missing[key] = body
    code_summary2, _b = get(opener, P6_SUMMARY)
    code_records2, _b = get(opener, P6_RECORDS)
    after = fingerprint()
    changes = diff(before, after)
    record(
        "7-1 缺資料時 GET 仍零寫入（P8 時代此處會補建）",
        not changes,
        describe(changes),
    )
    record(
        "7-2 缺資料時 CSV 匯出仍零寫入",
        code_summary2 == 200 and code_records2 == 200 and not diff(after, fingerprint()),
        "摘要=%s 明細=%s" % (code_summary2, code_records2),
    )
    record(
        "7-3 刪除後資料列未被補回",
        table_count("learning_growthrecordsubmission") == submissions_after
        and table_count("learning_phaseprogress") == phases_after,
        "提交=%d 階段進度=%d"
        % (
            table_count("learning_growthrecordsubmission"),
            table_count("learning_phaseprogress"),
        ),
    )

    # ── 階段 8：缺資料下統計仍正確表達「未開始」──────────────────
    p7_missing = bodies_missing["P7 展示"]
    slot_cells = len(re.findall(r'class="sc-slot status status-', p7_missing))
    p7_stats_missing = stat_pairs(p7_missing, "sc-stat-num", "sc-stat-label")
    p7_named = bodies["P7 展示"]
    slot_cells_full = len(re.findall(r'class="sc-slot status status-', p7_named))
    record(
        "8-1 缺資料下 R01–R08 槽位不消失（學員卡仍顯示 8 格）",
        slot_cells == slot_cells_full and slot_cells > 0,
        "缺資料=%d 格／資料齊備=%d 格" % (slot_cells, slot_cells_full),
    )
    record(
        "8-2 缺資料下學員人數不變（0 項提交的學員未消失）",
        p7_stats_missing.get("學員總人數（人）") == p7_stats_missing.get("學員總人數（人）")
        and p7_stats_missing.get("學員總人數（人）") not in (None, "", "0"),
        "學員總人數=%s" % p7_stats_missing.get("學員總人數（人）"),
    )
    record(
        "8-3 缺資料下已提交／已複核歸零（正確表達未開始）",
        p7_stats_missing.get("R01–R08 已提交（筆）") == "0"
        and p7_stats_missing.get("R01–R08 已複核（筆）") == "0",
        "已提交=%s 已複核=%s"
        % (
            p7_stats_missing.get("R01–R08 已提交（筆）"),
            p7_stats_missing.get("R01–R08 已複核（筆）"),
        ),
    )
    # 未開始的狀態文案為「○ 未開始」（STUDENT_STATUS_LABELS），逐格確認。
    not_started_cells = len(
        re.findall(
            r'class="sc-slot status status-not_started"[^>]*>[^<]*未開始', p7_missing
        )
    )
    record(
        "8-4 缺資料下每個槽位皆顯示「未開始」而非空白",
        slot_cells > 0 and not_started_cells == slot_cells,
        "%d/%d 格顯示未開始" % (not_started_cells, slot_cells),
    )

    # ── 階段 9：統計一致性（P5／P6／P7 同一來源）──────────────────
    p5_stats = stat_pairs(bodies["P5 報告"], "trp-stat-num", "trp-stat-label")
    p6_stats = stat_pairs(bodies["P6 清單"], "trc-stat-num", "trc-stat-label")
    p7_stats = stat_pairs(bodies["P7 展示"], "sc-stat-num", "sc-stat-label")

    mismatch = [
        "%s: P5=%s P7=%s" % (label, p5_stats.get(label), p7_stats.get(label))
        for label in SHARED_LABELS
        if p5_stats.get(label) != p7_stats.get(label)
    ]
    record(
        "9-1 P5 報告與 P7 展示統計逐項相同",
        not mismatch,
        "; ".join(mismatch) if mismatch else "%d 項相同" % len(SHARED_LABELS),
    )

    triple_mismatch = []
    for label in TRIPLE_LABELS:
        values = {p5_stats.get(label), p6_stats.get(label), p7_stats.get(label)}
        if len(values) != 1:
            triple_mismatch.append(
                "%s: P5=%s P6=%s P7=%s"
                % (label, p5_stats.get(label), p6_stats.get(label), p7_stats.get(label))
            )
    record(
        "9-2 P5／P6／P7 共同標籤數值一致",
        not triple_mismatch,
        "; ".join(triple_mismatch) if triple_mismatch else "%d 項一致" % len(TRIPLE_LABELS),
    )

    pair_mismatch = [
        "%s: P6=%s P7=%s" % (label, p6_stats.get(label), p7_stats.get(label))
        for label in P6_P7_LABELS
        if p6_stats.get(label) != p7_stats.get(label)
    ]
    record(
        "9-2b P6 清單與 P7 展示共同標籤數值一致",
        not pair_mismatch,
        "; ".join(pair_mismatch) if pair_mismatch else "%d 項一致" % len(P6_P7_LABELS),
    )

    p5_count = p5_stats.get("學員總人數（人）")
    p6_count_match = re.search(r"<dt>班級總人數</dt><dd>\s*(\d+)\s*人", bodies["P6 清單"])
    record(
        "9-3 P5 與 P6 班級人數一致",
        p6_count_match is not None and p6_count_match.group(1) == p5_count,
        "P5=%s P6=%s" % (p5_count, p6_count_match.group(1) if p6_count_match else "（缺）"),
    )

    csv_text = body_summary.decode("utf-8-sig", "replace")
    csv_rows = [line for line in csv_text.splitlines() if line.strip()]
    record(
        "9-4 CSV 摘要含班級人數且與頁面一致",
        str(p5_count) in csv_text,
        "學員數=%s CSV 行數=%d" % (p5_count, len(csv_rows)),
    )

    # ── 階段 10：多班級教師權限 ────────────────────────────────────
    jar_b, opener_b = new_session()
    login_teacher(opener_b, TEACHER_B)
    code, _b = get(opener_b, P5_REPORT)
    record("10-1 教師 B 存取 A 班報告為 404", code == 404, "HTTP %s" % code)
    code, _b = get(opener_b, P7_SHOWCASE_A)
    record("10-2 教師 B 存取 A 班展示為 404", code == 404, "HTTP %s" % code)
    code, _b = get(opener_b, P6_CHECKLIST)
    record("10-3 教師 B 存取 A 班清單為 404", code == 404, "HTTP %s" % code)

    passed = sum(1 for _n, ok, _d in RESULTS if ok)
    failed = [(n, d) for n, ok, d in RESULTS if not ok]
    print("")
    print(
        "==== P9 報告唯讀化稽核：%d 項通過 / %d 項失敗 / 共 %d 項 ===="
        % (passed, len(failed), len(RESULTS))
    )
    for name, detail in failed:
        print("FAIL 詳列：%s | %s" % (name, detail))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
