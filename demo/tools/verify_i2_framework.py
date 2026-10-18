#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""I2 五階段教學平台框架 — 入口、導航、權限與模組狀態 HTTP 層驗收。

對應 2026-10-13 教師 I2 指令第三、四、五、六節：
  I2-A 五階段入口整理      ：學／練／做／測／證皆能連到既有入口
  I2-B 統一模組狀態        ：已可使用／尚未接入／服務暫時不可用／權限不足（四態不互冒）
  I2-C 操作體驗            ：可返回工作台、不繞過權限、R01–R08 狀態不被改寫
  權限                     ：未登入導向登入、跨課程 404、教師跨班級 404

模式（第 1 個參數）：
  default       對預設配置（全部模組 DISABLED）驗收 → 三模組應為「尚未接入」
  module-up     需伺服器以 FDE_MODULE_F450_DIGITAL_TWIN_ENABLED=1 且 URL 指向可達服務啟動
                → 該模組應為「已可使用」並產生連結
  module-down   需伺服器以 FDE_MODULE_F450_DIGITAL_TWIN_ENABLED=1 且 URL 指向不可達位置啟動
                → 該模組應為「服務暫時不可用」且**不得**產生連結（降級）

注意：本工具全程**不跟隨重導**，避免「未登入 → 302 登入頁」被誤判為 200（假 PASS）。
"""
import http.cookiejar
import os
import re
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request

MODE = (sys.argv[1] if len(sys.argv) > 1 else "default").strip().lower()
MODULE_URL = (os.environ.get("I2_MODULE_URL") or "").strip()

BASE = "http://192.168.1.114:8112"
COOKIE_HOST = "192.168.1.114"
STUDENT_EMAIL = "p42-a-0001@fde-p42.local"
TEACHER_A_EMAIL = "p42.teacher.a@fde-demo.local"
AUTHORIZED_COHORT = "P42-A-2026"
FORBIDDEN_COHORT = "P42-B-2026"
VERIFY_DB = r"D:\FDE-AI-UAS-v2.0\demo\runtime\db\p42_verify.sqlite3"
DOWNLOAD_MANIFEST = r"D:\下載中心文件\download_manifest.json"

CREDENTIALS_CANDIDATES = [
    os.environ.get("FDE_DEMO_CREDENTIALS_FILE"),
    os.path.expanduser("~/.fde-demo-credentials/demo.shared.password.txt"),
]


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
        "[安全停止] 無法取得驗收學員密碼。請設定 FDE_DEMO_STUDENT_PASSWORD，"
        "或提供 ~/.fde-demo-credentials/demo.shared.password.txt。"
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


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """停用自動重導，讓 302（未登入導向登入頁）如實呈現。"""

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
    req = urllib.request.Request(url, headers={"User-Agent": "I2-VERIFY/1.0"})
    try:
        with op.open(req, timeout=30) as resp:
            return resp.status, resp.read().decode("utf-8", "replace"), resp.headers.get("Location", "")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace"), exc.headers.get("Location", "")


def post(op, url, data, referer):
    body = urllib.parse.urlencode(data).encode()
    parts = urllib.parse.urlsplit(referer)
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "User-Agent": "I2-VERIFY/1.0",
            "Referer": referer,
            "Origin": parts.scheme + "://" + parts.netloc,
        },
    )
    try:
        with op.open(req, timeout=30) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")


def csrf_from(cj, domain):
    for cookie in cj:
        if cookie.name == "csrftoken" and domain in (cookie.domain or ""):
            return cookie.value
    return ""


def hidden_csrf(html):
    m = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', html)
    return m.group(1) if m else ""


def login(op, cj, email, path):
    status, page, _ = get(op, BASE + path)
    token = hidden_csrf(page) or csrf_from(cj, COOKIE_HOST)
    status, _ = post(
        op,
        BASE + path,
        {"username": email, "password": PASSWORD, "csrfmiddlewaretoken": token},
        BASE + path,
    )
    return "sessionid" in [c.name for c in cj]


def foreign_enrollment_id(own_id):
    if not os.path.isfile(VERIFY_DB):
        return None
    try:
        con = sqlite3.connect("file:{}?mode=ro".format(VERIFY_DB.replace("\\", "/")), uri=True)
        cur = con.cursor()
        cur.execute(
            "SELECT e.id FROM learning_enrollment e "
            "JOIN learning_studentprofile p ON p.student_id = e.student_id "
            "JOIN auth_user u ON u.id = p.user_id "
            "WHERE u.username <> ? AND e.active = 1 AND e.id <> ? ORDER BY e.id LIMIT 1",
            (STUDENT_EMAIL, own_id),
        )
        row = cur.fetchone()
        con.close()
        return row[0] if row else None
    except Exception:
        return None


def hqgc_in_download_manifest():
    if not os.path.isfile(DOWNLOAD_MANIFEST):
        return None
    try:
        import json

        with open(DOWNLOAD_MANIFEST, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        return None
    return "HQGC" in json.dumps(data, ensure_ascii=False)


def normalize(html):
    return re.sub(r'name="csrfmiddlewaretoken" value="[^"]*"', 'name="csrfmiddlewaretoken" value="X"', html)


# --- 共用：學員登入後的工作台 ---
def student_workbench():
    cj, op = new_session()
    ok = login(op, cj, STUDENT_EMAIL, "/login/")
    check("驗收學員登入成功", ok)
    if not ok:
        return None, None, None, None
    status, body, location = get(op, BASE + "/student/learning-path/")
    final = location or ""
    m = re.search(r"/student/courses/(\d+)/learning-path/", final) or re.search(
        r"/student/courses/(\d+)/learning-path/", body
    )
    if not m:
        check("找到學員課程工作台網址", False, "無法定位 /student/courses/<id>/learning-path/")
        return op, cj, None, None
    enrollment_id = m.group(1)
    check("找到學員課程工作台網址", True, "enrollment_id=%s" % enrollment_id)
    status, html, _ = get(op, BASE + "/student/courses/%s/learning-path/" % enrollment_id)
    check("五階段工作台可開啟", status == 200, "HTTP %s" % status)
    return op, cj, enrollment_id, html


def verify_default(op, enrollment_id, html):
    """I2-A/C：五階段入口、導航、R01–R08 一致性（預設配置）。"""
    # 五階段標題與錨點
    for title in ("學習知識", "模擬與練習", "專項實訓", "能力考核", "成長日誌"):
        check("五階段標題存在：%s" % title, title in html)
    for key in ("learn", "practice", "build", "assess", "certify"):
        check('階段錨點 id="stage-%s" 存在' % key, 'id="stage-%s"' % key in html)

    # I2-A：各階段既有入口
    stage_entries = {
        "learn": ("學習平台（課程影片與教材）", "下載中心（課程軟體）", "AI 助教（RAG 知識庫問答）"),
        "practice": ("模擬器練習（學習平台）", "AI 助教（練習即時問答）"),
        "build": ("F450 十二任務實訓", "Mission Planner 調參實訓（MP01–MP12）"),
        "assess": ("手機槳葉方向辨識（M1–M4）", "飛行健康 AI"),
        "certify": ("我的學習成長日誌（R01–R08 總覽）",),
    }
    for stage_key, names in stage_entries.items():
        seg = re.search(r'id="stage-%s"(.*?)(?=id="stage-|id="stage-feedback")' % stage_key, html, re.S)
        block = seg.group(1) if seg else ""
        for name in names:
            check("[%s] 既有入口存在：%s" % (stage_key, name), name in block)

    # 既有路由連結
    for expected in ("/platform/", "/downloads/", "/live/", "/flight-health/", "/platform/f450",
                     "/student/courses/%s/prop-scan/" % enrollment_id,
                     "/student/courses/%s/growth/" % enrollment_id):
        check("既有入口可連結：%s" % expected, expected in html)

    # I2-B：預設四態（三模組皆「尚未接入」）
    check("模組狀態顯示「尚未接入」", "尚未接入" in html)
    check("預設不得顯示「已可使用」", "已可使用" not in html)
    check("預設不得顯示「服務暫時不可用」", "服務暫時不可用" not in html)
    check("預設不得顯示「權限不足」", "權限不足" not in html)
    for name in ("F450 數位孿生", "MP 地面站（預留）", "HQGC 考核（預留）"):
        check("預留模組呈現：%s" % name, name in html)
        check(
            "預留模組不可點擊：%s" % name,
            re.search(r"<a[^>]*>\s*{}".format(re.escape(name)), html) is None,
        )
    for token in ("孿生", "twin", "ground-station", "hqgc"):
        check(
            "無指向 %s 的假連結" % token,
            re.search(r'href="[^"]*{}[^"]*"'.format(token), html, re.I) is None,
        )

    # I2-C（教師 2026-10-15 最終裁決）：平台頁五階段主導航＝左側 #moduleNav（學→練→做→測→證），
    # 帳號列／Django topbar 的重複「五階段學習工作台」連結已移除；工作台頁面與路由保留（首頁課程卡進入）。
    status, platform_html, _ = get(op, BASE + "/platform/f450")
    check("F450 十二任務 /platform/f450 可開啟", status == 200 and len(platform_html) > 500, "HTTP %s" % status)
    check(
        "平台頁提供五階段主導航（學/練/做/測/證，證→真實成長日誌）",
        all(
            token in platform_html
            for token in ("./courses", "./simulator", "./f450", "./eagle", "/student/growth/")
        ),
        "HTTP %s" % status,
    )

    # I2-C：R01–R08 狀態一致性（兩次瀏覽一致；不跟隨重導）
    status_a, html_a, _ = get(op, BASE + "/student/courses/%s/learning-path/" % enrollment_id)
    status_b, html_b, _ = get(op, BASE + "/student/courses/%s/learning-path/" % enrollment_id)
    slots = sorted(set(re.findall(r'growth-slot">(R0[1-8])<', html_a)))
    check(
        "成長紀錄 R01–R08 全部呈現",
        slots == ["R01", "R02", "R03", "R04", "R05", "R06", "R07", "R08"],
        "出現 %s" % slots,
    )
    check(
        "R01–R08 狀態於重複瀏覽間一致（未被改寫）",
        normalize(html_a) == normalize(html_b),
    )

    # 凍結保護頁面
    status_r07, _, _ = get(op, BASE + "/student/courses/%s/growth/R07/" % enrollment_id)
    check("R07 成長紀錄頁正常（凍結保護未受影響）", status_r07 == 200, "HTTP %s" % status_r07)
    status_m, mbody, _ = get(op, BASE + "/student/courses/%s/prop-scan/" % enrollment_id)
    check(
        "M1–M4 槳葉辨識頁正常（凍結保護未受影響）",
        status_m == 200 and all('name="motor_%s"' % x in mbody for x in ("M1", "M2", "M3", "M4")),
        "HTTP %s" % status_m,
    )


def verify_module_up(html):
    """模組啟用且服務可達 → 已可使用並產生連結。"""
    check("模組狀態顯示「已可使用」", "已可使用" in html)
    check("已可使用模組產生連結", 'href="%s"' % MODULE_URL in html, "url=%s" % MODULE_URL)
    check("不得再顯示「尚未接入」於 F450 數位孿生卡", "尚未接入" not in html.split("F450 數位孿生")[1][:400])


def verify_module_down(html):
    """模組啟用但服務不可達 → 服務暫時不可用且不產生連結（降級）。"""
    check("模組狀態顯示「服務暫時不可用」", "服務暫時不可用" in html)
    check("服務不可用時不得產生連結", 'href="%s"' % MODULE_URL not in html, "url=%s" % MODULE_URL)
    check("不得把服務不可用誤標為「尚未接入」於該卡", "尚未接入" not in html.split("F450 數位孿生")[1][:400])
    check("不得把服務不可用誤標為「已可使用」", "已可使用" not in html)


def verify_permissions(op, enrollment_id):
    """權限：未登入、跨課程、教師跨班級（全程不跟隨重導）。"""
    anon_cj, anon = new_session()
    status, _, location = get(anon, BASE + "/student/learning-path/")
    check(
        "未登入存取工作台入口 → 302 導向登入頁",
        status == 302 and "/login/" in (location or ""),
        "HTTP %s → %s" % (status, location),
    )
    status, _, location = get(anon, BASE + "/student/courses/%s/learning-path/" % enrollment_id)
    check(
        "未登入存取工作台頁 → 302 導向登入頁",
        status == 302 and "/login/" in (location or ""),
        "HTTP %s → %s" % (status, location),
    )

    foreign = foreign_enrollment_id(enrollment_id)
    if foreign:
        status, _, _ = get(op, BASE + "/student/courses/%s/learning-path/" % foreign)
        check("他人課程工作台 → 404（跨課程隔離）", status == 404, "enrollment_id=%s HTTP %s" % (foreign, status))
    else:
        check("他人課程工作台 → 404（跨課程隔離）", False, "找不到可用的他人課程 id")

    # 教師跨班級
    tcj, top = new_session()
    ok = login(top, tcj, TEACHER_A_EMAIL, "/teacher/login/")
    check("驗收教師 A 登入成功", ok)
    if not ok:
        return
    for path in (
        "/teacher/class-outcomes/",
        "/teacher/class-report/%s/" % AUTHORIZED_COHORT,
        "/teacher/review-checklist/%s/" % AUTHORIZED_COHORT,
        "/teacher/class-showcase/%s/" % AUTHORIZED_COHORT,
    ):
        s, _, _ = get(top, BASE + path)
        check("教師 A 可開啟授權班級頁：%s" % path, s == 200, "HTTP %s" % s)
    for path in (
        "/teacher/class-report/%s/" % FORBIDDEN_COHORT,
        "/teacher/review-checklist/%s/" % FORBIDDEN_COHORT,
        "/teacher/class-showcase/%s/" % FORBIDDEN_COHORT,
        "/teacher/class-report/export/summary/%s/" % FORBIDDEN_COHORT,
        "/teacher/class-report/export/records/%s/" % FORBIDDEN_COHORT,
    ):
        s, _, _ = get(top, BASE + path)
        check("教師 A 對未授權班級 → 404：%s" % path, s == 404, "HTTP %s" % s)
    s, body, _ = get(top, BASE + "/teacher/class-outcomes/")
    check("教師 A 班級清單含授權班級", AUTHORIZED_COHORT in body)
    check("教師 A 班級清單不含未授權班級", FORBIDDEN_COHORT not in body)

    # 教師導覽不含學員工作台入口（各自適用入口）
    check(
        "教師後台導覽不顯示學員工作台入口",
        "/student/learning-path/" not in body,
    )


def verify_hqgc_entry(op):
    status, html, _ = get(op, BASE + "/downloads/")
    # /downloads/ 由 Live 服務提供，非 Django 路由；此處僅驗證既有入口資料未被破壞。
    manifest_ok = hqgc_in_download_manifest()
    if manifest_ok is None:
        check("下載中心 manifest 可讀且含 HQGC", False, "無法讀取 %s" % DOWNLOAD_MANIFEST)
    else:
        check("下載中心 manifest 仍含 HQGC 條目（既有入口未被破壞）", manifest_ok)


def main():
    print("==== I2 驗收模式：%s ====" % MODE)
    op, cj, enrollment_id, html = student_workbench()
    if html is None:
        return finish()

    if MODE == "module-up":
        if not MODULE_URL:
            check("模組 URL 已提供（I2_MODULE_URL）", False)
            return finish()
        verify_module_up(html)
    elif MODE == "module-down":
        if not MODULE_URL:
            check("模組 URL 已提供（I2_MODULE_URL）", False)
            return finish()
        verify_module_down(html)
    else:
        verify_default(op, enrollment_id, html)

    verify_permissions(op, enrollment_id)
    verify_hqgc_entry(op)

    out_html = r"D:\FDE-AI-UAS-v2.0\demo\runtime\logs\i2_workbench_%s.html" % MODE
    try:
        os.makedirs(os.path.dirname(out_html), exist_ok=True)
        with open(out_html, "w", encoding="utf-8") as fh:
            fh.write(html)
        print("工作台 HTML 已存檔：%s（%d bytes）" % (out_html, len(html.encode("utf-8"))))
    except Exception as exc:
        print("HTML 存檔略過：%s" % exc)

    return finish()


def finish():
    failed = [r for r in RESULTS if not r[1]]
    print(
        "\n==== I2 驗收（%s）：%d 項通過 / %d 項失敗 / 共 %d 項 ===="
        % (MODE, len(RESULTS) - len(failed), len(failed), len(RESULTS))
    )
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
