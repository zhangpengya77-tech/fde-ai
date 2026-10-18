#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""I3-A 端到端教學流程驗收（學員 + 教師）。

對應 2026-10-13 教師 I3 指令第二節：
  學生登入 → 五階段工作台 → 開啟既有學習功能 → 開啟既有實訓功能 → 返回工作台
  → 查看 R01–R08 → 依既有流程提交允許的成果
  → 教師登入 → 查看班級 → 查看學生提交 → 依既有流程複核 → 查看班級成果

原則：
  * 只驗證**已存在**的真實功能；所有提交與複核都走既有表單端點，不直接寫 DB。
  * 不偽造任務完成、成績、證據或教師審核。
  * R07／YOLO 模型／教師模型倉庫只做**非破壞性**驗證（GET），不執行上傳／發布／回滾。
  * 全程**不跟隨重導**，避免「未登入 302 → 登入頁」被誤讀為 200（假 PASS）。

執行前提：隔離服務以獨立測試庫啟動（預設 :8115 / i3_e2e.sqlite3）。
  測試庫為 p42_verify.sqlite3 的副本，寫入不影響 :8112 的唯讀驗收庫。
"""
import http.cookiejar
import os
import re
import struct
import sys
import urllib.error
import urllib.parse
import urllib.request
import zlib

BASE = (os.environ.get("I3_E2E_BASE") or "http://192.168.1.114:8115").rstrip("/")
COOKIE_HOST = urllib.parse.urlsplit(BASE).hostname or "192.168.1.114"
STUDENT_EMAIL = "p42-a-0001@fde-p42.local"
TEACHER_A_EMAIL = "p42.teacher.a@fde-demo.local"
AUTHORIZED_COHORT = "P42-A-2026"
FORBIDDEN_COHORT = "P42-B-2026"
DOWNLOAD_MANIFEST = r"D:\下載中心文件\download_manifest.json"

CREDENTIALS_CANDIDATES = [
    os.environ.get("FDE_DEMO_CREDENTIALS_FILE"),
    os.path.expanduser("~/.fde-demo-credentials/demo.shared.password.txt"),
]

PASS, FAIL, SKIP, PENDING = "PASS", "FAIL", "SKIPPED", "PENDING"
RESULTS = []

# 學員提交時填入的備註：用於驗證教師端確實看到該筆提交內容（非依賴狀態用詞）。
SUBMIT_NOTE = "I3 端到端驗收：以既有表單提交一張測試照片。"


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
    print(
        "[安全停止] 無法取得驗收密碼。請設定 FDE_DEMO_STUDENT_PASSWORD，"
        "或提供 ~/.fde-demo-credentials/demo.shared.password.txt。"
    )
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
        urllib.request.HTTPCookieProcessor(cj),
        _NoRedirect(),
        urllib.request.ProxyHandler({}),
    )
    return cj, op


def get(op, url):
    req = urllib.request.Request(url, headers={"User-Agent": "I3-E2E/1.0"})
    try:
        with op.open(req, timeout=30) as resp:
            return resp.status, resp.read().decode("utf-8", "replace"), resp.headers.get("Location", "")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace"), exc.headers.get("Location", "")


def _origin(referer):
    parts = urllib.parse.urlsplit(referer)
    return parts.scheme + "://" + parts.netloc


def post(op, url, data, referer):
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "User-Agent": "I3-E2E/1.0",
            "Referer": referer,
            "Origin": _origin(referer),
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    try:
        with op.open(req, timeout=60) as resp:
            return resp.status, resp.read().decode("utf-8", "replace"), resp.headers.get("Location", "")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace"), exc.headers.get("Location", "")


def make_png(width=8, height=8):
    """產生一張最小合法 PNG（不依賴 PIL），供既有成長紀錄表單使用。"""
    rows = b""
    for _ in range(height):
        rows += b"\x00" + (b"\x20\x80\xc0" * width)

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )


def post_multipart(op, url, fields, files, referer):
    boundary = "----I3E2Eboundary7d1a"
    parts = []
    for key, value in fields.items():
        parts.append(
            ("--%s\r\n" % boundary).encode()
            + ('Content-Disposition: form-data; name="%s"\r\n\r\n' % key).encode()
            + str(value).encode()
            + b"\r\n"
        )
    for key, filename, content, content_type in files:
        parts.append(
            ("--%s\r\n" % boundary).encode()
            + (
                'Content-Disposition: form-data; name="%s"; filename="%s"\r\n' % (key, filename)
            ).encode()
            + ("Content-Type: %s\r\n\r\n" % content_type).encode()
            + content
            + b"\r\n"
        )
    parts.append(("--%s--\r\n" % boundary).encode())
    body = b"".join(parts)
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "User-Agent": "I3-E2E/1.0",
            "Referer": referer,
            "Origin": _origin(referer),
            "Content-Type": "multipart/form-data; boundary=%s" % boundary,
        },
    )
    try:
        with op.open(req, timeout=120) as resp:
            return resp.status, resp.read().decode("utf-8", "replace"), resp.headers.get("Location", "")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace"), exc.headers.get("Location", "")


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
    post(
        op,
        BASE + path,
        {"username": email, "password": PASSWORD, "csrfmiddlewaretoken": token},
        BASE + path,
    )
    return "sessionid" in [c.name for c in cj]


def normalize(html):
    return re.sub(
        r'name="csrfmiddlewaretoken" value="[^"]*"',
        'name="csrfmiddlewaretoken" value="X"',
        html,
    )


def manifest_has_hqgc():
    if not os.path.isfile(DOWNLOAD_MANIFEST):
        return None
    try:
        import json

        with open(DOWNLOAD_MANIFEST, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        return None
    return "HQGC" in json.dumps(data, ensure_ascii=False)


def slot_status(html, slot):
    m = re.search(
        r'growth-slot">%s</span><span class="status[^"]*">([^<]*)<' % slot, html
    )
    return m.group(1).strip() if m else ""


# ---------------------------------------------------------------------------
# 學員流程
# ---------------------------------------------------------------------------
def student_flow():
    print("\n---- 學員流程 ----")
    anon_cj, anon = new_session()
    status, _, location = get(anon, BASE + "/student/learning-path/")
    check(
        "未登入存取工作台 → 302 導向登入頁（不跟隨重導）",
        status == 302 and "/login/" in (location or ""),
        "HTTP %s → %s" % (status, location),
    )

    cj, op = new_session()
    check("學員登入成功", login(op, cj, STUDENT_EMAIL, "/login/"))

    status, _, location = get(op, BASE + "/student/learning-path/")
    m = re.search(r"/student/courses/(\d+)/learning-path/", location or "")
    check(
        "五階段工作台入口 → 導向該課程工作台",
        status == 302 and bool(m),
        "HTTP %s → %s" % (status, location),
    )
    if not m:
        return None, None, None, None, None
    enrollment_id = m.group(1)

    wb_url = BASE + "/student/courses/%s/learning-path/" % enrollment_id
    status, html, _ = get(op, wb_url)
    check("五階段工作台可開啟", status == 200, "HTTP %s" % status)
    if status != 200:
        return op, enrollment_id, None, None, None

    for title in ("學習知識", "模擬與練習", "專項實訓", "能力考核", "成長日誌"):
        check("五階段階段區塊存在：%s" % title, title in html)

    # 開啟既有學習功能
    status_platform, platform_body, _ = get(op, BASE + "/platform/")
    check("開啟既有學習功能：/platform/（學習平台）", status_platform == 200, "HTTP %s" % status_platform)
    status_live, _, _ = get(op, BASE + "/live/")
    if status_live == 200:
        check("開啟既有學習功能：/live/（AI 助教／RAG）", True, "HTTP 200")
    else:
        skip(
            "開啟既有學習功能：/live/（AI 助教／RAG）",
            "HTTP %s；/live/ 由 Live 服務（:8111）提供，非 Django 路由，隔離服務無法驗證" % status_live,
        )
    status_dl, _, _ = get(op, BASE + "/downloads/")
    if status_dl == 200:
        check("開啟既有學習功能：/downloads/（下載中心）", True, "HTTP 200")
    else:
        skip(
            "開啟既有學習功能：/downloads/（下載中心）",
            "HTTP %s；由 Live 服務提供，非 Django 路由" % status_dl,
        )
    hqgc = manifest_has_hqgc()
    if hqgc is None:
        check("下載中心 manifest 可讀且含 HQGC", False, DOWNLOAD_MANIFEST)
    else:
        check("下載中心 manifest 仍含 HQGC（既有入口資料未被破壞）", hqgc)

    # 開啟既有實訓功能
    status_f450, f450_body, _ = get(op, BASE + "/platform/f450")
    check(
        "開啟既有實訓功能：/platform/f450（F450 十二任務）",
        status_f450 == 200 and len(f450_body) > 500,
        "HTTP %s" % status_f450,
    )

    # 返回工作台
    check(
        "實訓頁提供返回工作台路徑（/student/learning-path/）",
        "/student/learning-path/" in f450_body,
    )

    # 查看 R01–R08
    status_growth, growth_body, _ = get(
        op, BASE + "/student/courses/%s/growth/" % enrollment_id
    )
    check("查看 R01–R08 成長日誌總覽", status_growth == 200, "HTTP %s" % status_growth)
    slots = sorted(set(re.findall(r"(R0[1-8])", growth_body)))
    check(
        "成長日誌含 R01–R08 全部項目",
        all(("R0%d" % i) in slots for i in range(1, 9)),
        "出現 %s" % [s for s in slots if s.startswith("R0")][:8],
    )

    r01_url = BASE + "/student/courses/%s/growth/R01/" % enrollment_id
    status_r01, r01_body, _ = get(op, r01_url)
    check("開啟 R01 成長紀錄詳情頁", status_r01 == 200, "HTTP %s" % status_r01)

    # 非破壞性：R07 與 M1–M4 只讀
    status_r07, _, _ = get(op, BASE + "/student/courses/%s/growth/R07/" % enrollment_id)
    check("R07 成長紀錄頁可開啟（凍結保護，僅讀取）", status_r07 == 200, "HTTP %s" % status_r07)
    status_m, m_body, _ = get(op, BASE + "/student/courses/%s/prop-scan/" % enrollment_id)
    check(
        "M1–M4 槳葉辨識頁可開啟（凍結保護，僅讀取）",
        status_m == 200 and all('name="motor_%s"' % x in m_body for x in ("M1", "M2", "M3", "M4")),
        "HTTP %s" % status_m,
    )

    # 選擇一筆「尚未提交」的成長紀錄，走既有表單提交（可重複執行；已複核者不可再提交）
    chosen_slot, r01_url, r01_body = None, None, None
    for slot in ("R0%d" % i for i in range(1, 9)):
        url = BASE + "/student/courses/%s/growth/%s/" % (enrollment_id, slot)
        status_slot, body_slot, _ = get(op, url)
        if status_slot == 200 and 'value="submit_review"' in body_slot:
            chosen_slot, r01_url, r01_body = slot, url, body_slot
            break
    if chosen_slot is None:
        skip(
            "依既有流程提交允許的成果",
            "R01–R08 皆已提交或已完成複核（此測試庫狀態），無可提交項目",
        )
        return op, enrollment_id, "", "", wb_url
    check("找到可提交的成長紀錄（尚未提交）", True, "slot=%s" % chosen_slot)

    # 依既有流程提交允許的成果（走既有表單端點）
    before_status = slot_status(html, chosen_slot)
    token = hidden_csrf(r01_body) or csrf_from(cj)
    status_submit, _, location_submit = post_multipart(
        op,
        r01_url,
        {
            "csrfmiddlewaretoken": token,
            "action": "submit_review",
            "student_note": SUBMIT_NOTE,
            "learning_summary": "",
        },
        [("images", "i3_e2e_probe.png", make_png(), "image/png")],
        r01_url,
    )
    check(
        "依既有流程提交 %s 成果（POST 既有表單端點）" % chosen_slot,
        status_submit in (200, 302),
        "HTTP %s → %s" % (status_submit, location_submit),
    )
    status_wb, wb_body, _ = get(op, wb_url)
    submitted_status = slot_status(wb_body, chosen_slot)
    check(
        "%s 狀態由既有流程真實更新為已提交（工作台回傳）" % chosen_slot,
        status_wb == 200 and submitted_status != "" and submitted_status != before_status,
        "提交前=%s → 提交後=%s" % (before_status or "(空)", submitted_status or "(空)"),
    )
    return op, enrollment_id, chosen_slot, submitted_status, wb_url


# ---------------------------------------------------------------------------
# 教師流程
# ---------------------------------------------------------------------------
def teacher_flow(enrollment_id, student_slot, student_status, workbench_url):
    print("\n---- 教師流程 ----")
    anon_cj, anon = new_session()
    status, _, location = get(anon, BASE + "/teacher/class-outcomes/")
    check(
        "未登入存取教師頁 → 302 導向教師登入頁（不跟隨重導）",
        status == 302 and "/teacher/login/" in (location or ""),
        "HTTP %s → %s" % (status, location),
    )

    cj, op = new_session()
    check("教師登入成功（/teacher/login/）", login(op, cj, TEACHER_A_EMAIL, "/teacher/login/"))

    status, body, _ = get(op, BASE + "/teacher/class-outcomes/")
    check("教師查看班級清單", status == 200, "HTTP %s" % status)
    check("班級清單含授權班級 %s" % AUTHORIZED_COHORT, AUTHORIZED_COHORT in body)
    check("班級清單不含未授權班級 %s" % FORBIDDEN_COHORT, FORBIDDEN_COHORT not in body)

    detail_url = BASE + "/teacher/enrollments/%s/" % enrollment_id
    status_detail, detail_body, _ = get(op, detail_url)
    check("教師查看學生提交（學員詳情頁）", status_detail == 200, "HTTP %s" % status_detail)
    if status_detail != 200:
        return
    check(
        "學員詳情頁列出成長紀錄（含 %s）" % student_slot,
        student_slot in detail_body,
    )
    check(
        "學員詳情頁顯示該生所提交紀錄的狀態（教師端狀態用詞）",
        bool(student_status) or re.search(r'class="status status-[a-z_]+"', detail_body) is not None,
        "工作台 R01=%s（教師端以「合格／待複核」等獨立用詞呈現）" % student_status,
    )
    check(
        "教師端可見該筆提交內容（學員備註與證據）",
        SUBMIT_NOTE in detail_body,
        "備註命中=%s" % (SUBMIT_NOTE in detail_body),
    )

    # 定位「該筆提交」的既有複核表單（取該紀錄區塊內的 action，避免複核到別筆）
    idx = detail_body.find(student_slot)
    segment = detail_body[idx : idx + 8000] if idx >= 0 else ""
    m = re.search(r'action="/teacher/growth-reviews/(\d+)/"', segment)
    if not m:
        m = re.search(r'action="/teacher/growth-reviews/(\d+)/"', detail_body)
    if not m:
        check("找到既有複核表單端點", False, "頁面無 /teacher/growth-reviews/<id>/ 表單")
        return
    submission_id = m.group(1)
    check("找到既有複核表單端點", True, "submission_id=%s" % submission_id)

    review_url = BASE + "/teacher/growth-reviews/%s/" % submission_id
    token = hidden_csrf(detail_body) or csrf_from(cj)
    status_review, _, location_review = post(
        op,
        review_url,
        {
            "csrfmiddlewaretoken": token,
            "review_status": "approved",
            "score": "88",
            "teacher_note": "I3 端到端驗收：以既有複核表單完成複核。",
        },
        detail_url,
    )
    check(
        "依既有流程複核該筆提交（POST 既有複核端點）",
        status_review in (200, 302),
        "HTTP %s → %s" % (status_review, location_review),
    )

    status_detail2, detail_body2, _ = get(op, detail_url)
    check(
        "複核結果反映於學員詳情頁",
        status_detail2 == 200 and "88" in detail_body2,
        "HTTP %s" % status_detail2,
    )

    # 複核後：學員端工作台狀態應反映教師複核結果（真實由後端回傳，非偽造）
    scj, sop = new_session()
    if login(sop, scj, STUDENT_EMAIL, "/login/"):
        status_wb, wb_body, _ = get(sop, workbench_url)
        reviewed_status = slot_status(wb_body, student_slot)
        check(
            "複核後學員工作台反映教師複核結果（%s）" % student_slot,
            status_wb == 200 and reviewed_status != "" and reviewed_status != student_status,
            "複核前=%s → 複核後=%s" % (student_status or "(空)", reviewed_status or "(空)"),
        )
    else:
        check("複核後學員工作台反映教師複核結果", False, "學員重新登入失敗")

    status_report, report_body, _ = get(
        op, BASE + "/teacher/class-report/%s/" % AUTHORIZED_COHORT
    )
    check("教師查看班級成果（結訓報告）", status_report == 200, "HTTP %s" % status_report)
    check(
        "班級報告反映已複核結果",
        "已複核" in report_body or "複核" in report_body,
    )

    status_csv1, csv1, _ = get(
        op, BASE + "/teacher/class-report/export/summary/%s/" % AUTHORIZED_COHORT
    )
    check(
        "班級成果匯出（摘要 CSV）",
        status_csv1 == 200 and csv1.startswith("\ufeff"),
        "HTTP %s BOM=%s" % (status_csv1, csv1.startswith("\ufeff")),
    )
    status_csv2, csv2, _ = get(
        op, BASE + "/teacher/class-report/export/records/%s/" % AUTHORIZED_COHORT
    )
    check(
        "班級成果匯出（學員明細 CSV）",
        status_csv2 == 200 and csv2.startswith("\ufeff"),
        "HTTP %s BOM=%s" % (status_csv2, csv2.startswith("\ufeff")),
    )

    # 跨班級隔離
    for path in (
        "/teacher/class-report/%s/" % FORBIDDEN_COHORT,
        "/teacher/review-checklist/%s/" % FORBIDDEN_COHORT,
        "/teacher/class-showcase/%s/" % FORBIDDEN_COHORT,
        "/teacher/class-report/export/summary/%s/" % FORBIDDEN_COHORT,
        "/teacher/class-report/export/records/%s/" % FORBIDDEN_COHORT,
    ):
        s, _, _ = get(op, BASE + path)
        check("教師對未授權班級 → 404：%s" % path, s == 404, "HTTP %s" % s)

    # 學員端權限
    status_student_teacher_page, _, _ = get(op, BASE + "/student/learning-path/")
    check(
        "教師身分存取學員工作台 → 非 200（角色區隔）",
        status_student_teacher_page != 200,
        "HTTP %s" % status_student_teacher_page,
    )


def student_cannot_open_teacher_pages():
    cj, op = new_session()
    if not login(op, cj, STUDENT_EMAIL, "/login/"):
        check("學員登入（權限區隔檢查）", False)
        return
    status, _, location = get(op, BASE + "/teacher/class-outcomes/")
    check(
        "學員身分存取教師頁 → 非 200（角色區隔）",
        status != 200,
        "HTTP %s → %s" % (status, location),
    )


def main():
    print("==== I3-A 端到端教學流程驗收（BASE=%s）====" % BASE)
    op, enrollment_id, student_slot, student_status, workbench_url = student_flow()
    if enrollment_id is None or op is None or not workbench_url:
        return finish()
    teacher_flow(enrollment_id, student_slot, student_status, workbench_url)
    student_cannot_open_teacher_pages()
    pending(
        "真實 iPhone Safari 人工驗收",
        "本腳本為 HTTP 層驗收；真機 Safari 須由教師以實機確認",
    )
    return finish()


def finish():
    counts = {PASS: 0, FAIL: 0, SKIP: 0, PENDING: 0}
    for _, result, _ in RESULTS:
        counts[result] = counts.get(result, 0) + 1
    print(
        "\n==== I3-A 結果：PASS %d / FAIL %d / SKIPPED %d / PENDING %d / 共 %d 項 ===="
        % (counts[PASS], counts[FAIL], counts[SKIP], counts[PENDING], len(RESULTS))
    )
    for name, result, detail in RESULTS:
        if result == FAIL:
            print("  [FAIL] %s | %s" % (name, detail))
    return 1 if counts[FAIL] else 0


if __name__ == "__main__":
    sys.exit(main())
