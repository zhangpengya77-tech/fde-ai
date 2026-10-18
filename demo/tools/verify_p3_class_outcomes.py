#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""P3 教師端班級學習成果總覽 — DEMO 端到端驗收（2026-10-13 教師指令）。

P4 追加（2026-10-13 UI/UX＋排序指令）：8b 統計卡片、8c 待複核排序、
8d 學員進度列表、8e 區塊順序（統計卡片→待複核→學員進度→矩陣→五階段）。

驗收項對照：
  1. DEMO 服務（:8110/:8111）可連線；正式服務（:8022）未受影響（唯讀 GET）。
  2. DEMO 教師帳號可登入班級學習成果總覽。
  3. 只顯示教師授權班級；非授權班級篩選不出資料、不洩漏學員。
  4. 班級人數與 DEMO DB active 學員數一致。
  5. 每位學員 R01–R08 已提交／已複核／待複核數量與 DB 一致。
  6. 「已提交」顯示為待教師複核，不誤判為已透過。
  7. 五階段「完成 N/M 人」符合 PhaseProgress.status=completed 定義（非僅進入階段）。
  8. 待複核清單無重複計數（成長紀錄與任務分列但不重複）；矩陣計數只來自成長紀錄。
  9. 從待複核清單進入既有教師學員詳情頁，目標學員與 R07 複核表單正確。
  10. 未登入重導、學員登入 403、越權班級篩選空狀態。
基準資料一律以 DEMO DB 唯讀連線（sqlite3 mode=ro）即時比對；不寫入任何資料。
"""
import http.cookiejar
import os
import re
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request

LIVE = "http://192.168.1.114:8111"
DJANGO = "http://192.168.1.114:8110"
PROD = "http://127.0.0.1:8022"
TEACHER_EMAIL = "demo.teacher@fde-demo.local"
STUDENT_EMAIL = "demo.student01@fde-demo.local"
COOKIE_HOST = "192.168.1.114"
DEMO_DB = r"D:\FDE-AI-UAS-v2.0\demo\runtime\db\demo.sqlite3"

STAGE_KEYS = ("learn", "practice", "build", "assess", "certify")
SUBMITTED_STATUSES = {"submitted", "needs_revision", "approved", "rejected"}
REVIEWED_STATUSES = {"needs_revision", "approved", "rejected"}

# 安全規範（2026-10-13 指令）：密碼不寫死在程式碼、不輸出至報告。
# 依序嘗試環境變數 → 版本庫外憑證檔；皆無 → 安全停止。
CREDENTIALS_CANDIDATES = [
    os.environ.get("FDE_DEMO_CREDENTIALS_FILE"),
    os.path.expanduser("~/.fde-demo-credentials/demo.shared.password.txt"),
    os.path.expanduser("~/.fde-demo-credentials/demo.student01.password.txt"),
    os.path.expanduser("~/.fde-demo-credentials/demo.student02.password.txt"),
]


def load_demo_password(env_key):
    """從環境變數或版本庫外憑證檔讀取密碼（不回顯明文）。"""
    env_pw = (os.environ.get(env_key) or "").strip()
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


TEACHER_PASSWORD = load_demo_password("FDE_DEMO_TEACHER_PASSWORD")
STUDENT_PASSWORD = load_demo_password("FDE_DEMO_STUDENT_PASSWORD")
if not TEACHER_PASSWORD:
    print(
        "[安全停止] 無法取得 DEMO 教師密碼。請設定 FDE_DEMO_TEACHER_PASSWORD 或 "
        "FDE_DEMO_CREDENTIALS_FILE；本工具不在程式碼中內建預設密碼。"
    )
    sys.exit(2)

for k in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
    os.environ.pop(k, None)
os.environ["NO_PROXY"] = "*"
os.environ["no_proxy"] = "*"

RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    print(("PASS" if ok else "FAIL"), "-", name, ("| " + detail if detail else ""))


def new_session():
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(cj),
        urllib.request.HTTPRedirectHandler(),
        urllib.request.ProxyHandler({}),
    )
    return cj, op


def get(op, url):
    req = urllib.request.Request(url, headers={"User-Agent": "P3-DEMO-VERIFY/1.0"})
    try:
        with op.open(req, timeout=30) as resp:
            return resp.status, resp.read().decode("utf-8", "replace"), resp.geturl()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace"), url


def post(op, url, data, referer):
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "User-Agent": "P3-DEMO-VERIFY/1.0",
            "Referer": referer,
            "Origin": urllib.parse.urlsplit(referer).scheme + "://" + urllib.parse.urlsplit(referer).netloc,
        },
    )
    try:
        with op.open(req, timeout=30) as resp:
            return resp.status, resp.read().decode("utf-8", "replace"), resp.geturl()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace"), url


def csrf_from(cj, domain):
    for cookie in cj:
        if cookie.name == "csrftoken" and domain in (cookie.domain or ""):
            return cookie.value
    return ""


def hidden_csrf(html):
    m = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', html)
    return m.group(1) if m else ""


def login(op, cj, login_path, email, password):
    status, page, _ = get(op, DJANGO + login_path)
    token = hidden_csrf(page) or csrf_from(cj, COOKIE_HOST)
    return post(
        op,
        DJANGO + login_path,
        {"username": email, "password": password, "csrfmiddlewaretoken": token},
        DJANGO + login_path,
    )


# ---------------------------------------------------------------------------
# DEMO DB 唯讀基準（sqlite3 mode=ro；不寫入）
# ---------------------------------------------------------------------------
def db_ground_truth():
    con = sqlite3.connect("file:{}?mode=ro".format(DEMO_DB), uri=True)
    con.row_factory = sqlite3.Row
    truth = {}
    truth["cohort_names"] = {
        row["cohort_id"]: row["name"]
        for row in con.execute("SELECT cohort_id, name FROM learning_cohort")
    }
    truth["authorized"] = [
        row["cohort_id"]
        for row in con.execute(
            "SELECT a.cohort_id FROM learning_teachercohortaccess a "
            "JOIN auth_user u ON u.id = a.teacher_id WHERE u.username = ?",
            (TEACHER_EMAIL,),
        )
    ]
    truth["active_counts"] = {
        row["cohort_id"]: row["n"]
        for row in con.execute(
            "SELECT cohort_id, COUNT(*) AS n FROM learning_enrollment WHERE active = 1 GROUP BY cohort_id"
        )
    }
    truth["students"] = {
        row["id"]: row["public_user_id"]
        for row in con.execute(
            "SELECT e.id AS id, sp.public_user_id AS public_user_id FROM learning_enrollment e "
            "JOIN learning_studentprofile sp ON sp.student_id = e.student_id WHERE e.active = 1"
        )
    }
    truth["cohort_of"] = {
        row["id"]: row["cohort_id"]
        for row in con.execute(
            "SELECT id, cohort_id FROM learning_enrollment WHERE active = 1"
        )
    }
    truth["growth"] = {}
    for row in con.execute(
        "SELECT e.id AS eid, d.slot_id AS slot, s.status AS status, s.submitted_at AS submitted_at "
        "FROM learning_growthrecordsubmission s "
        "JOIN learning_growthrecorddefinition d ON d.id = s.definition_id "
        "JOIN learning_enrollment e ON e.id = s.enrollment_id WHERE e.active = 1"
    ):
        truth["growth"].setdefault(row["eid"], {})[row["slot"]] = (row["status"], row["submitted_at"])
    truth["phases"] = {}
    for row in con.execute(
        "SELECT e.id AS eid, p.phase AS phase, p.status AS status FROM learning_phaseprogress p "
        "JOIN learning_enrollment e ON e.id = p.enrollment_id WHERE e.active = 1"
    ):
        truth["phases"].setdefault(row["eid"], {})[row["phase"]] = row["status"]
    truth["task_submitted"] = []
    for row in con.execute(
        "SELECT e.id AS eid, t.task_id AS task_id, st.submitted_at AS submitted_at "
        "FROM learning_studenttaskprogress st "
        "JOIN learning_taskdefinition t ON t.task_id = st.task_id "
        "JOIN learning_enrollment e ON e.id = st.enrollment_id "
        "WHERE e.active = 1 AND st.status = 'submitted'"
    ):
        truth["task_submitted"].append((row["eid"], row["task_id"], row["submitted_at"]))
    con.close()
    return truth


def growth_counts(slots):
    submitted = sum(1 for value in slots.values() if value[0] in SUBMITTED_STATUSES)
    reviewed = sum(1 for value in slots.values() if value[0] in REVIEWED_STATUSES)
    pending = sum(1 for value in slots.values() if value[0] == "submitted")
    return submitted, reviewed, pending


def stage_completion(phases):
    return {
        key: {
            "done": sum(1 for value in phases.values() if value.get(key) == "completed"),
            "total": sum(1 for value in phases.values() if key in value),
        }
        for key in STAGE_KEYS
    }


def cohort_expected(truth, cohort_id):
    """P4：以 DB 基準推導某班級的統計卡片預期值（計數規則與矩陣同一套）。"""
    eids = [eid for eid, cid in truth["cohort_of"].items() if cid == cohort_id]
    not_submitted = 0
    all_submitted = 0
    pending = 0
    for eid in eids:
        submitted, _, pend = growth_counts(truth["growth"].get(eid, {}))
        if submitted == 0:
            not_submitted += 1
        if submitted == 8:
            all_submitted += 1
        pending += pend
    for eid, _task_id, _when in truth["task_submitted"]:
        if truth["cohort_of"].get(eid) == cohort_id:
            pending += 1
    return {
        "students": len(eids),
        "pending": pending,
        "not_submitted": not_submitted,
        "all_submitted": all_submitted,
    }


CARD_LABELS = {
    "students": "班級學員",
    "pending": "待複核成果",
    "not_submitted": "尚未提交",
    "all_submitted": "已完成八項",
}


def card_value(block, label):
    m = re.search(
        r'<span class="tco-stat-num">(\d+)</span><span class="tco-stat-label">%s</span>' % re.escape(label),
        block,
    )
    return int(m.group(1)) if m else None


def main():
    truth = db_ground_truth()

    # 1. 服務可連線；正式服務未受影響（唯讀 GET）
    status, _, _ = get(new_session()[1], DJANGO + "/login/")
    check("DEMO Django :8110 登入頁可開啟", status == 200, "HTTP %s" % status)
    status, _, _ = get(new_session()[1], LIVE + "/")
    check("DEMO Live :8111 首頁可開啟", status == 200, "HTTP %s" % status)
    status, _, _ = get(new_session()[1], PROD + "/login/")
    check("正式服務 :8022 仍正常（未受影響，唯讀探測）", status in (200, 302), "HTTP %s" % status)

    # 2. 教師登入
    cj, op = new_session()
    status, _, _ = login(op, cj, "/teacher/login/", TEACHER_EMAIL, TEACHER_PASSWORD)
    logged_in = "sessionid" in [c.name for c in cj]
    check("DEMO 教師登入成功", status in (200, 302) and logged_in, "HTTP %s" % status)

    outcomes_url = DJANGO + "/teacher/class-outcomes/"
    status, html, _ = get(op, outcomes_url)
    check("班級學習成果總覽可開啟（教師）", status == 200, "HTTP %s" % status)
    with open(r"D:\FDE-AI-UAS-v2.0\demo\runtime\logs\p3_class_outcomes_demo.html", "w", encoding="utf-8") as fh:
        fh.write(html)

    # 3. 只顯示授權班級
    page_cohorts = re.findall(r'<section class="section-block tco-class" id="cohort-([^"]+)"', html)
    expected_cohorts = sorted(set(truth["authorized"]) & set(truth["active_counts"]))
    check("只顯示教師授權班級", sorted(page_cohorts) == expected_cohorts,
          "頁面 %s ｜ 授權 %s" % (sorted(page_cohorts), sorted(truth["authorized"])))
    status, fake_html, _ = get(op, outcomes_url + "?cohort=NOT-AUTHORIZED-XZ")
    leaked = [sid for sid in truth["students"].values() if sid in fake_html]
    check("越權班級篩選不出資料、不洩漏學員", "沒有可查看的班級" in fake_html and not leaked,
          "洩漏 %s" % leaked if leaked else "空狀態正常")

    # 4. 班級人數
    for cohort_id in page_cohorts:
        m = re.search(r"學員 (\d+) 人", html)
        expected = truth["active_counts"].get(cohort_id, 0)
        # 每班一顆徽章：以班級區塊內解析。
        block = re.search(
            r'id="cohort-{}"[\s\S]*?(?=<section class="section-block|</main>)'.format(re.escape(cohort_id)),
            html,
        )
        badge = re.search(r"學員 (\d+) 人", block.group(0)) if block else None
        check("班級 %s 人數與 DB active 學員數一致" % cohort_id,
              badge is not None and int(badge.group(1)) == expected,
              "頁面 %s ｜ DB %s" % (badge.group(1) if badge else "無", expected))

    # 5-8. 學員矩陣、計數、待複核清單（逐學員比對 DB）
    for eid, slots in sorted(truth["growth"].items()):
        sid = truth["students"][eid]
        submitted, reviewed, pending = growth_counts(slots)
        phases = truth["phases"].get(eid, {})
        # 矩陣列
        row_m = re.search(r"<tr>\s*<td data-label=\"FDE ID\">{}[\s\S]*?</tr>".format(re.escape(sid)), html)
        check("學員 %s 矩陣列存在" % sid, row_m is not None)
        if not row_m:
            continue
        row_html = row_m.group(0)
        sm = re.search(r'data-label="已提交"[^>]*>(\d+) / 8', row_html)
        rm = re.search(r'data-label="已複核"[^>]*>(\d+) / 8', row_html)
        pm = re.search(r'data-label="待複核"[^>]*>(\d+)', row_html)
        check("學員 %s 已提交=%s 與 DB 一致" % (sid, submitted),
              sm is not None and int(sm.group(1)) == submitted,
              "頁面 %s ｜ DB %s" % (sm.group(1) if sm else "無", submitted))
        check("學員 %s 已複核=%s 與 DB 一致" % (sid, reviewed),
              rm is not None and int(rm.group(1)) == reviewed,
              "頁面 %s ｜ DB %s" % (rm.group(1) if rm else "無", reviewed))
        check("學員 %s 待複核=%s 與 DB 一致" % (sid, pending),
              pm is not None and int(pm.group(1)) == pending,
              "頁面 %s ｜ DB %s" % (pm.group(1) if pm else "無", pending))
        # 逐槽狀態
        for slot, (status_key, _) in sorted(slots.items()):
            cell = re.search(r'data-label="{}"><span class="status status-([a-z_]+)">'.format(slot), row_html)
            check("學員 %s %s 槽狀態與 DB 一致（%s）" % (sid, slot, status_key),
                  cell is not None and cell.group(1) == status_key,
                  "頁面 %s ｜ DB %s" % (cell.group(1) if cell else "無", status_key))
        # 6. 已提交 ≠ 已透過
        submitted_slots = [slot for slot, value in slots.items() if value[0] == "submitted"]
        approved_slots = [slot for slot, value in slots.items() if value[0] == "approved"]
        if submitted_slots and not approved_slots:
            check("學員 %s 已提交槽位顯示待教師複核、無 ✅ 已完成" % sid,
                  "待教師複核" in row_html and "✅ 已完成" not in row_html)
        # 7. 五階段完成定義（completed 才計入；非僅進入階段）
        comp = stage_completion({eid: phases})
        for key in STAGE_KEYS:
            m = re.search(
                r"{}\｜[^<]*</span><strong>完成 (\d+) / (\d+) 人".format(
                    {"learn": "學", "practice": "練", "build": "做", "assess": "測", "certify": "證"}[key]
                ),
                html,
            )
            check("學員 %s 五階段 %s 完成數符合 completed 定義（%d/%d）" % (sid, key, comp[key]["done"], comp[key]["total"]),
                  m is not None and int(m.group(1)) == comp[key]["done"] and int(m.group(2)) == comp[key]["total"],
                  "頁面 %s ｜ DB %s" % (m.groups() if m else "無", (comp[key]["done"], comp[key]["total"])))
    # 8. 待複核清單：成長紀錄 submitted ＋ 任務 submitted，無重複
    pending_items = re.findall(
        r'<li class="tco-pending-item">[\s\S]*?<strong>([^<]+)</strong>[\s\S]*?<span class="muted">([^<]*)</span>[\s\S]*?<a class="button secondary" href="([^"]+)"',
        html,
    )
    parsed_pending = []
    for title, meta, href in pending_items:
        code = title.split("｜")[0].strip()
        kind = meta.split(" · ")[0].strip()
        sid_m = re.search(r"（([^）]+)）", meta)
        parsed_pending.append((kind, sid_m.group(1) if sid_m else "", code))
    expected_pending = []
    for eid, slots in truth["growth"].items():
        sid = truth["students"][eid]
        for slot, (status_key, _) in sorted(slots.items()):
            # P4.1：預設狀態篩選＝全部，含「待教師複核（submitted）」與「需要補充（needs_revision）」。
            if status_key in ("submitted", "needs_revision"):
                expected_pending.append(("成長紀錄", sid, slot))
    for eid, task_id, _ in truth["task_submitted"]:
        expected_pending.append(("任務", truth["students"][eid], "M" + task_id[1:]))
    check("待複核清單筆數與 DB 一致", len(parsed_pending) == len(expected_pending),
          "頁面 %d ｜ DB %d" % (len(parsed_pending), len(expected_pending)))
    check("待複核清單無重複計數（同項目不出現兩次）",
          len(parsed_pending) == len(set(parsed_pending)),
          "頁面項目 %s" % parsed_pending)
    check("待複核清單項目與 DB 一一對應", sorted(parsed_pending) == sorted(expected_pending),
          "頁面 %s ｜ DB %s" % (parsed_pending, expected_pending))

    # 8b. P4 統計卡片（數字與 DB 基準一致）
    for cohort_id in page_cohorts:
        block = re.search(
            r'id="cohort-{}"[\s\S]*?(?=<section class="section-block|</main>)'.format(re.escape(cohort_id)),
            html,
        )
        block = block.group(0) if block else ""
        expected = cohort_expected(truth, cohort_id)
        for key, label in CARD_LABELS.items():
            value = card_value(block, label)
            check("P4 統計卡片 %s（%s）與 DB 一致" % (label, cohort_id),
                  value == expected[key], "頁面 %s ｜ DB %s" % (value, expected[key]))

    # 8c. P4 待複核排序（GET 參數；預設最早優先；非法值回落）
    status_newest, html_newest, _ = get(op, outcomes_url + "?sort=newest")
    check("P4 排序 sort=newest 可開啟", status_newest == 200, "HTTP %s" % status_newest)
    check("P4 排序表單標記目前排序（newest）",
          '<option value="newest" selected>' in html_newest,
          "selected=%s" % ('<option value="newest" selected>' in html_newest))
    status_oldest, html_oldest, _ = get(op, outcomes_url + "?sort=oldest")
    check("P4 排序 sort=oldest（最早優先）可開啟", status_oldest == 200, "HTTP %s" % status_oldest)
    status_bogus, html_bogus, _ = get(op, outcomes_url + "?sort=bogus-xyz")
    check("P4 排序非法值回落預設（oldest）",
          status_bogus == 200 and '<option value="oldest" selected>' in html_bogus,
          "HTTP %s" % status_bogus)
    if page_cohorts:
        status_both, html_both, _ = get(op, outcomes_url + "?cohort=%s&sort=newest" % page_cohorts[0])
        check("P4 排序與班級篩選可共存（不遺失參數）",
              status_both == 200
              and 'name="cohort" value="%s"' % page_cohorts[0] in html_both
              and '<option value="newest" selected>' in html_both,
              "HTTP %s" % status_both)

    # 8d. P4 學員進度列表（人數與詳情連結）
    for cohort_id in page_cohorts:
        block = re.search(
            r'id="cohort-{}"[\s\S]*?(?=<section class="section-block|</main>)'.format(re.escape(cohort_id)),
            html,
        )
        block = block.group(0) if block else ""
        expected_students = truth["active_counts"].get(cohort_id, 0)
        progress_rows = re.findall(r'<li class="tco-progress-item tco-progress-([a-z]+)">', block)
        detail_links = re.findall(r'<a class="button secondary" href="([^"]+)">查看詳情</a>', block)
        check("P4 學員進度列表人數與 DB 一致（%s）" % cohort_id,
              len(progress_rows) == expected_students,
              "頁面 %d ｜ DB %d ｜ 分組 %s" % (len(progress_rows), expected_students, progress_rows))
        check("P4 學員進度列表每人都有詳情連結（%s）" % cohort_id,
              len(detail_links) == expected_students,
              "連結 %d ｜ DB %d" % (len(detail_links), expected_students))

    # 8e. P4 區塊順序：統計卡片 → 待複核 → 學員進度 → 矩陣 → 五階段（P3 保留）
    try:
        ordered = (
            html.index("tco-stat-label")
            < html.index("待複核成果（")
            < html.index("學員進度列表")
            < html.index("R01–R08 詳細矩陣")
            < html.index("五階段學習概況")
        )
        detail_txt = "統計卡片→待複核→學員進度→矩陣→五階段"
    except ValueError as exc:
        ordered = False
        detail_txt = "缺少區塊: %s" % exc
    check("P4 頁面區塊順序符合教師指定", ordered, detail_txt)

    # 8f. P4.1／P4.2 四種排序（新增 student_asc／record_asc）與穩定次要鍵
    # 期望標籤直接由視圖常數抽取，避免手寫中文字串走樣。
    view_src = open(
        r"D:\FDE-AI-UAS-v2.0\student_portal\learning\views.py", encoding="utf-8"
    ).read()

    def option_labels(block_name):
        block = re.search(r"%s = \(([\s\S]*?)\n\)" % block_name, view_src)
        return re.findall(r'\(\s*"[^"]*"\s*,\s*"([^"]+)"\s*\)', block.group(1)) if block else []

    sort_labels = option_labels("PENDING_SORT_OPTIONS")
    progress_labels = option_labels("PROGRESS_FILTER_OPTIONS")
    for label in sort_labels:
        check("P4.1 排序選項存在：%s" % label, label in html, "in page=%s" % (label in html))
    for label in progress_labels:
        check("P4.2 學員進度篩選選項存在：%s" % label, label in html, "in page=%s" % (label in html))
    for mode in ("student_asc", "record_asc"):
        status_s, _, _ = get(op, outcomes_url + "?sort=" + mode)
        check("P4.1 排序 sort=%s 可開啟" % mode, status_s == 200, "HTTP %s" % status_s)
        status_sel, html_sel, _ = get(op, outcomes_url + "?sort=" + mode)
        check("P4.1 排序表單標記目前排序（%s）" % mode,
              '<option value="%s" selected>' % mode in html_sel,
              "selected=%s" % ('<option value="%s" selected>' % mode in html_sel))

    # 8g. P4.1 待複核篩選（紀錄／類型／狀態）＋ 卡片不隨篩選變動
    def pending_codes_from(page_html):
        return re.findall(
            r'<li class="tco-pending-item">[\s\S]*?<strong>([^<]+)</strong>', page_html
        )

    submitted_slots = sorted(
        slot
        for slots in truth["growth"].values()
        for slot, value in slots.items()
        if value[0] == "submitted"
    )
    revision_slots = sorted(
        slot
        for slots in truth["growth"].values()
        for slot, value in slots.items()
        if value[0] == "needs_revision"
    )
    if submitted_slots:
        slot = submitted_slots[0]
        _, html_rec, _ = get(op, outcomes_url + "?p_record=" + slot)
        codes = pending_codes_from(html_rec)
        check("P4.1 紀錄篩選 p_record=%s 只顯示該槽位" % slot,
              len(codes) == 1 and codes[0].startswith(slot), "codes=%s" % codes)
    empty_slot = next((s for s in ("R01", "R02", "R03", "R04", "R05", "R06", "R08") if s not in submitted_slots), None)
    if empty_slot:
        _, html_empty, _ = get(op, outcomes_url + "?p_record=" + empty_slot)
        check("P4.1 紀錄篩選無資料時顯示篩選空狀態",
              pending_codes_from(html_empty) == [] and "沒有符合目前篩選條件的待複核成果。" in html_empty,
              "codes=%s" % pending_codes_from(html_empty))
    _, html_growth, _ = get(op, outcomes_url + "?p_type=growth")
    check("P4.1 類型篩選 p_type=growth 只顯示成長紀錄",
          all(not c.startswith("M") for c in pending_codes_from(html_growth)),
          "codes=%s" % pending_codes_from(html_growth))
    _, html_task, _ = get(op, outcomes_url + "?p_type=task")
    check("P4.1 類型篩選 p_type=task 只顯示任務提交",
          all(c.startswith("M") for c in pending_codes_from(html_task)),
          "codes=%s" % pending_codes_from(html_task))
    _, html_status_sub, _ = get(op, outcomes_url + "?p_status=submitted")
    check("P4.1 狀態篩選 p_status=submitted 只顯示待教師複核",
          len(pending_codes_from(html_status_sub)) == len(submitted_slots),
          "頁面 %d ｜ DB %d" % (len(pending_codes_from(html_status_sub)), len(submitted_slots)))
    _, html_status_rev, _ = get(op, outcomes_url + "?p_status=needs_revision")
    check("P4.1 狀態篩選 p_status=needs_revision 只顯示需要補充",
          len(pending_codes_from(html_status_rev)) == len(revision_slots),
          "頁面 %d ｜ DB %d" % (len(pending_codes_from(html_status_rev)), len(revision_slots)))
    for cohort_id in page_cohorts:
        block = re.search(
            r'id="cohort-{}"[\s\S]*?(?=<section class="section-block|</main>)'.format(re.escape(cohort_id)),
            html_status_rev,
        )
        block = block.group(0) if block else ""
        card = card_value(block, "待複核成果")
        expected_card = cohort_expected(truth, cohort_id)["pending"]
        check("P4.1 卡片「待複核成果」不隨狀態篩選變動（%s）" % cohort_id,
              card == expected_card, "頁面 %s ｜ DB %s" % (card, expected_card))
    if page_cohorts:
        combined_url = outcomes_url + "?cohort=%s&sort=newest&p_record=%s&p_type=growth&p_status=submitted" % (
            page_cohorts[0],
            submitted_slots[0] if submitted_slots else "R01",
        )
        status_c, html_c, _ = get(op, combined_url)
        check("P4.1 班級＋排序＋紀錄＋類型＋狀態可同時使用",
              status_c == 200 and 'name="p_type" value="growth"' in html_c and 'name="sort" value="newest"' in html_c,
              "HTTP %s" % status_c)
        check("P4.1 控制項齊備（紀錄／類型／狀態／進度）",
              all(n in html for n in ('name="p_record"', 'name="p_type"', 'name="p_status"', 'name="s_state"')),
              "control names present")

    # 8h. P4.1／P4.2 學員進度篩選（五項）逐項對 DB
    total_students = sum(truth["active_counts"].get(cid, 0) for cid in page_cohorts)

    def expected_by_progress(flt):
        eids = []
        for eid, cid in truth["cohort_of"].items():
            if cid not in page_cohorts:
                continue
            submitted, _reviewed, pending = growth_counts(truth["growth"].get(eid, {}))
            if flt == "none" and submitted == 0:
                eids.append(eid)
            elif flt == "partial" and 1 <= submitted <= 7:
                eids.append(eid)
            elif flt == "complete" and submitted == 8:
                eids.append(eid)
            elif flt == "pending" and pending > 0:
                eids.append(eid)
        return sorted(truth["students"][eid] for eid in eids)

    progress_cases = [("", total_students)] + [(key, len(expected_by_progress(key))) for key in ("none", "partial", "complete", "pending")]
    for key, expected_count in progress_cases:
        url = outcomes_url if not key else outcomes_url + "?s_state=" + key
        _status, page_html, _ = get(op, url)
        rows = re.findall(r'<li class="tco-progress-item tco-progress-([a-z]+)">', page_html)
        expected_ids = expected_by_progress(key) if key else None
        page_ids = sorted(re.findall(
            r'<li class="tco-progress-item tco-progress-[a-z]+">\s*<div class="tco-progress-main">\s*<strong>([^<]+)</strong>',
            page_html,
        ))
        ok = len(rows) == expected_count and (expected_ids is None or page_ids == expected_ids)
        check("P4.2 進度篩選 %s 與 DB 一致" % (key or "全部"),
              ok, "頁面 %d %s ｜ DB %d %s" % (len(rows), page_ids, expected_count, expected_ids or ""))
    _, html_none, _ = get(op, outcomes_url + "?s_state=none")
    check("P4.1 切換進度篩選保留待複核條件",
          'name="p_type" value="' in html_none and 'name="sort" value="' in html_none,
          "hidden params present")

    # 9. 從待複核清單進入既有教師詳情頁
    if pending_items:
        title, meta, href = pending_items[0]
        detail_url = urllib.parse.urljoin(DJANGO, href)
        status_d, detail_html, final_d = get(op, detail_url)
        target_sid = re.search(r"（([^）]+)）", meta)
        check("待複核連結開啟既有教師學員詳情頁", status_d == 200, "HTTP %s" % status_d)
        check("詳情頁目標學員正確",
              target_sid is not None and target_sid.group(1) in detail_html,
              "預期 %s" % (target_sid.group(1) if target_sid else "無"))
        check("詳情頁含 R07 成長紀錄與既有複核表單",
              "R07" in detail_html and "growth-reviews/" in detail_html and "保存複核" in detail_html)
    else:
        check("DEMO 有待複核資料可供跳轉驗證", False, "待複核清單為空")

    # 10. 未登入重導／學員登入 403
    cj_anon, op_anon = new_session()
    status, _, final_anon = get(op_anon, outcomes_url)
    check("未登入存取重導至教師登入",
          status in (200, 302) and "/teacher/login/" in final_anon,
          "HTTP %s ｜ %s" % (status, final_anon))
    if STUDENT_PASSWORD:
        cj_stu, op_stu = new_session()
        status, _, _ = login(op_stu, cj_stu, "/login/", STUDENT_EMAIL, STUDENT_PASSWORD)
        status_s, _, _ = get(op_stu, outcomes_url)
        check("學員登入存取教師頁面為 403", status_s == 403, "HTTP %s" % status_s)
    else:
        check("學員登入測試（未有學員憑證，略過）", True, "skipped")

    # 存證：DB 基準輸出
    with open(r"D:\FDE-AI-UAS-v2.0\demo\runtime\logs\p3_db_ground_truth.txt", "w", encoding="utf-8") as fh:
        fh.write("authorized=%s\nactive_counts=%s\nstudents=%s\n" % (
            sorted(truth["authorized"]), truth["active_counts"], truth["students"]))
        for eid, slots in sorted(truth["growth"].items()):
            fh.write("enroll=%s slots=%s\n" % (eid, {k: v[0] for k, v in sorted(slots.items())}))
        for eid, phases in sorted(truth["phases"].items()):
            fh.write("enroll=%s phases=%s\n" % (eid, phases))
        fh.write("task_submitted=%s\n" % truth["task_submitted"])
    print("DB 基準已存檔：demo/runtime/logs/p3_db_ground_truth.txt")
    return finish()


def finish():
    failed = [r for r in RESULTS if not r[1]]
    print("\n==== P3 DEMO 驗收結果：%d 項通過 / %d 項失敗 / 共 %d 項 ====" % (
        len(RESULTS) - len(failed), len(failed), len(RESULTS)))
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
