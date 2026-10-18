#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""I1 外部模組接口層 — 入口與權限 HTTP 層驗收（隔離驗收服務 :8112）。

對應 2026-10-13 教師總指令第八節測試項：
  1. P1–P9 現有功能不退化（工作台、R01–R08、R07、M1–M4 皆可開啟）
  2. F450 十二任務仍可正常進入（/platform/f450）
  3. F450 3D 數位孿生預設待接入（無連結、無假網址）
  4. MP 地面站預設待接入
  5. HQGC 既有入口不被破壞（下載中心仍可達）
  6. 模組 URL 未配置時不可產生假連結
  7. 未登入學員不能繞過權限
  8. 跨班級與跨課程資料隔離（他人課程 404）

使用前：以 start_p42_verify.ps1 -Port 8112 -DbFile p42_verify.sqlite3 啟動隔離服務。
本工具只讀，不寫入任何資料庫。
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
COOKIE_HOST = "192.168.1.114"
STUDENT_EMAIL = "p42-a-0001@fde-p42.local"
TEACHER_A_EMAIL = "p42.teacher.a@fde-demo.local"
AUTHORIZED_COHORT = "P42-A-2026"      # 教師 A 授權班級
FORBIDDEN_COHORT = "P42-B-2026"       # 教師 B 專屬班級（教師 A 不得存取）
VERIFY_DB = r"D:\FDE-AI-UAS-v2.0\demo\runtime\db\p42_verify.sqlite3"

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


def new_session(follow=True):
    """建立工作階段；follow=False 時不跟隨重導（用於辨識「未登入 → 302 登入頁」）。"""
    cj = http.cookiejar.CookieJar()
    handlers = [
        urllib.request.HTTPCookieProcessor(cj),
        _NoRedirect() if not follow else urllib.request.HTTPRedirectHandler(),
        urllib.request.ProxyHandler({}),
    ]
    return cj, urllib.request.build_opener(*handlers)


def get(op, url):
    req = urllib.request.Request(url, headers={"User-Agent": "I1-VERIFY/1.0"})
    try:
        with op.open(req, timeout=30) as resp:
            return resp.status, resp.read().decode("utf-8", "replace"), resp.geturl()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace"), url


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """停用自動重導，讓 302（未登入導向登入頁）如實呈現，避免被誤判為 200。"""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def post(op, url, data, referer):
    body = urllib.parse.urlencode(data).encode()
    parts = urllib.parse.urlsplit(referer)
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "User-Agent": "I1-VERIFY/1.0",
            "Referer": referer,
            "Origin": parts.scheme + "://" + parts.netloc,
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


def foreign_enrollment_id(own_id):
    """唯讀查詢隔離庫，找出不屬於本次登入學員的 enrollment id（跨課程隔離測試用）。"""
    if not os.path.isfile(VERIFY_DB):
        return None
    try:
        con = sqlite3.connect("file:{}?mode=ro".format(VERIFY_DB.replace("\\", "/")), uri=True)
        cur = con.cursor()
        # learning_enrollment.student_id → learning_studentprofile.student_id（varchar 主鍵）
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


DOWNLOAD_MANIFEST = r"D:\下載中心文件\download_manifest.json"


def hqgc_in_download_manifest():
    """唯讀檢查下載中心 manifest 仍含 HQGC 條目（HQGC 既有入口資料未被破壞）。"""
    if not os.path.isfile(DOWNLOAD_MANIFEST):
        return None
    try:
        import json

        with open(DOWNLOAD_MANIFEST, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        return None
    text = json.dumps(data, ensure_ascii=False)
    return "HQGC" in text


def verify_teacher_isolation():
    """教師跨班級資料隔離（教師總指令第八節第 8 項：跨班級與跨課程隔離）。

    驗收庫授權格局：教師 A → P42-A-2026／P42-C-2026；教師 B → P42-B-2026。
    教師 A 對 P42-B-2026 的任何頁面／CSV 一律 404（不得以空資料冒充 200）。
    註：教師登入端點為 /teacher/login/（非 /login/）；本函式全程不跟隨重導，
    以免「未登入 → 302 登入頁」被誤判為 200。
    """
    cj, op = new_session(follow=False)
    status, login_page, _ = get(op, BASE + "/teacher/login/")
    check("教師登入頁可開啟（/teacher/login/）", status == 200, "HTTP %s" % status)
    token = hidden_csrf(login_page) or csrf_from(cj, COOKIE_HOST)
    status, _, _ = post(
        op,
        BASE + "/teacher/login/",
        {"username": TEACHER_A_EMAIL, "password": PASSWORD, "csrfmiddlewaretoken": token},
        BASE + "/teacher/login/",
    )
    logged_in = "sessionid" in [c.name for c in cj]
    check("驗收教師 A 登入成功", logged_in, "HTTP %s sessionid=%s" % (status, logged_in))
    if not logged_in:
        check("教師跨班級隔離（後續檢查因登入失敗略過）", False, "無法建立教師工作階段")
        return

    authorized_paths = (
        "/teacher/class-outcomes/",
        "/teacher/class-report/%s/" % AUTHORIZED_COHORT,
        "/teacher/review-checklist/%s/" % AUTHORIZED_COHORT,
        "/teacher/class-showcase/%s/" % AUTHORIZED_COHORT,
    )
    for path in authorized_paths:
        s, _, _ = get(op, BASE + path)
        check("教師 A 可開啟授權班級頁：%s" % path, s == 200, "HTTP %s" % s)

    forbidden_paths = (
        "/teacher/class-report/%s/" % FORBIDDEN_COHORT,
        "/teacher/review-checklist/%s/" % FORBIDDEN_COHORT,
        "/teacher/class-showcase/%s/" % FORBIDDEN_COHORT,
        "/teacher/class-report/export/summary/%s/" % FORBIDDEN_COHORT,
        "/teacher/class-report/export/records/%s/" % FORBIDDEN_COHORT,
    )
    for path in forbidden_paths:
        s, _, _ = get(op, BASE + path)
        check("教師 A 對未授權班級 → 404：%s" % path, s == 404, "HTTP %s" % s)

    s, body, _ = get(op, BASE + "/teacher/class-outcomes/")
    check("教師 A 班級清單含授權班級", AUTHORIZED_COHORT in body, "HTTP %s" % s)
    check("教師 A 班級清單不含未授權班級", FORBIDDEN_COHORT not in body, "HTTP %s" % s)


def main():
    # A. 未登入不得繞過權限
    _, anon = new_session()
    status, _, final = get(anon, BASE + "/student/learning-path/")
    check(
        "未登入存取工作台入口 → 導向登入頁（權限未被繞過）",
        status in (200, 302) and "/login/" in (final or ""),
        "HTTP %s → %s" % (status, final),
    )
    status_anon_wb, _, final_anon_wb = get(anon, BASE + "/student/courses/1/learning-path/")
    check(
        "未登入存取工作台頁 → 導向登入頁",
        status_anon_wb in (200, 302) and "/login/" in (final_anon_wb or ""),
        "HTTP %s → %s" % (status_anon_wb, final_anon_wb),
    )

    # B. 登入
    cj, op = new_session()
    status, login_page, _ = get(op, BASE + "/login/")
    check("登入頁可開啟（隔離服務 :8112）", status == 200, "HTTP %s" % status)
    token = hidden_csrf(login_page) or csrf_from(cj, COOKIE_HOST)
    status, _, _ = post(
        op,
        BASE + "/login/",
        {"username": STUDENT_EMAIL, "password": PASSWORD, "csrfmiddlewaretoken": token},
        BASE + "/login/",
    )
    names = [c.name for c in cj]
    check(
        "驗收學員登入成功",
        "sessionid" in names,
        "HTTP %s sessionid=%s" % (status, "sessionid" in names),
    )

    # C. 定位工作台
    status, body, final = get(op, BASE + "/student/learning-path/")
    m = re.search(r"/student/courses/(\d+)/learning-path/", final or "") or re.search(
        r"/student/courses/(\d+)/learning-path/", body
    )
    if not m:
        check("找到學員課程工作台網址", False, "無法定位 /student/courses/<id>/learning-path/")
        return finish()
    enrollment_id = m.group(1)
    check("找到學員課程工作台網址", True, "enrollment_id=%s" % enrollment_id)

    status, html, final = get(op, BASE + "/student/courses/%s/learning-path/" % enrollment_id)
    check("五階段工作台可開啟", status == 200, "HTTP %s" % status)

    # D. 外部模組預留入口（預設待接入、無連結）
    for name in ("F450 數位孿生", "MP 地面站（預留）", "HQGC 考核（預留）"):
        check("外部模組預留入口呈現：%s" % name, name in html)
        check(
            "外部模組不可點擊：%s" % name,
            re.search(r"<a[^>]*>\s*{}".format(re.escape(name)), html) is None,
        )
    check("「待接入」狀態標示存在", "待接入" in html)
    for token in ("孿生", "twin", "ground-station", "hqgc"):
        check(
            "無指向 %s 的假連結" % token,
            re.search(r'href="[^"]*{}[^"]*"'.format(token), html, re.I) is None,
        )

    # E. F450 十二任務：既有入口存在且指向 /platform/f450
    check("工作台含 F450 十二任務實訓入口", "F450 十二任務實訓" in html)
    check("F450 十二任務入口連往 /platform/f450", 'href="/platform/f450"' in html)
    check(
        "十二任務入口未被誤標為 3D 數位孿生",
        re.search(r"<a[^>]*>\s*F450 數位孿生", html) is None,
    )

    # F. 既有功能入口不退化
    for expected in ("/platform/", "/downloads/", "/live/", "/flight-health/",
                     "/student/courses/%s/prop-scan/" % enrollment_id):
        check("既有安全入口可連結：%s" % expected, expected in html)

    # G. R01–R08 原始資料與狀態不變
    slots = sorted(set(re.findall(r'growth-slot">(R0[1-8])<', html)))
    check(
        "成長紀錄 R01–R08 全部呈現",
        slots == ["R01", "R02", "R03", "R04", "R05", "R06", "R07", "R08"],
        "出現 %s" % slots,
    )

    # H. F450 十二任務原服務可開啟（/platform/f450 與 /platform/）
    for path in ("/platform/f450", "/platform/"):
        status, pbody, _ = get(op, BASE + path)
        check(
            "既有平台入口可開啟：%s" % path,
            status == 200 and len(pbody) > 500,
            "HTTP %s bytes=%d" % (status, len(pbody)),
        )

    # I. HQGC 既有入口（下載中心）不被破壞
    #    /downloads/ 由 Live 服務（:8111）提供，並非 Django 路由；在 :8112 開啟 404 屬預期行為，
    #    故此處改以「工作台仍連往 /downloads/」＋「下載中心 manifest 仍含 HQGC」驗證未破壞。
    check("HQGC 既有入口連結仍在（工作台 → /downloads/）", 'href="/downloads/"' in html)
    manifest_ok = hqgc_in_download_manifest()
    if manifest_ok is None:
        check("下載中心 manifest 可讀且含 HQGC", False, "無法讀取 %s" % DOWNLOAD_MANIFEST)
    else:
        check("下載中心 manifest 仍含 HQGC 條目（既有入口未被破壞）", manifest_ok)

    # J. 跨課程資料隔離
    foreign = foreign_enrollment_id(enrollment_id)
    if foreign:
        status, _, _ = get(op, BASE + "/student/courses/%s/learning-path/" % foreign)
        check(
            "他人課程工作台 → 404（跨課程隔離）",
            status == 404,
            "foreign enrollment_id=%s HTTP %s" % (foreign, status),
        )
    else:
        check("他人課程工作台 → 404（跨課程隔離）", False, "找不到可用的他人課程 id")

    # K. 凍結保護頁面未受影響
    status_r07, _, _ = get(op, BASE + "/student/courses/%s/growth/R07/" % enrollment_id)
    check("R07 成長紀錄頁正常（凍結保護未受影響）", status_r07 == 200, "HTTP %s" % status_r07)
    status_m, mbody, _ = get(op, BASE + "/student/courses/%s/prop-scan/" % enrollment_id)
    check(
        "M1–M4 槳葉辨識頁正常（凍結保護未受影響）",
        status_m == 200 and all('name="motor_%s"' % x in mbody for x in ("M1", "M2", "M3", "M4")),
        "HTTP %s" % status_m,
    )

    # L. 教師跨班級資料隔離（第八節第 8 項）
    verify_teacher_isolation()

    out_html = r"D:\FDE-AI-UAS-v2.0\demo\runtime\logs\i1_workbench.html"
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
        "\n==== I1 入口與權限 HTTP 驗收：%d 項通過 / %d 項失敗 / 共 %d 項 ===="
        % (len(RESULTS) - len(failed), len(failed), len(RESULTS))
    )
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
