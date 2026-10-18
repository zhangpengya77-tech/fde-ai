#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""P1 五階段學習工作台 — DEMO 真實資料驗收（HTTP 層）。

以 DEMO 學員帳號登入 :8110（DEMO DB），再透過 :8111 的 /student/ 代理
開啟五階段學習工作台，驗證：
  1. 頁面 200，含「學 → 練 → 做 → 測 → 證」五階段與目前階段
  2. 成長紀錄 R01–R08 真實狀態與計數（DEMO 實際值，非假資料）
  3. F450 數位孿生顯示「待接入」且不可點擊（不得有假網址）
  4. 規劃中專項有徽章、無假連結
  5. 既有安全入口皆可連結（學習平台／下載中心／Live／M1–M4／飛行健康）
  6. 教師回饋區為真實資料（無資料時明確顯示尚無）
  7. 學員導航與課程總覽有工作台入口
"""
import http.cookiejar
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

LIVE = "http://192.168.1.114:8111"
DJANGO = "http://192.168.1.114:8110"
STUDENT_EMAIL = "demo.student01@fde-demo.local"
COOKIE_HOST = "192.168.1.114"

# 安全規範（2026-10-13 指令）：密碼不寫死在程式碼。
# 依序嘗試：(1) 環境變數 FDE_DEMO_STUDENT_PASSWORD；
#           (2) 環境變數 FDE_DEMO_CREDENTIALS_FILE 指向的憑證檔；
#           (3) 版本庫外預設憑證檔 ~/.fde-demo-credentials/demo.shared.password.txt。
# 憑證檔格式依 reset_demo_shared_password.py 約定：
#   「---- 以下為密碼，複製這一行 ----」的下一行非空、非 ---- 者即密碼。
# 皆失敗 → 安全停止；本工具不在程式碼中內建任何預設明文密碼。
CREDENTIALS_CANDIDATES = [
    os.environ.get("FDE_DEMO_CREDENTIALS_FILE"),
    os.path.expanduser("~/.fde-demo-credentials/demo.shared.password.txt"),
    os.path.expanduser("~/.fde-demo-credentials/demo.student01.password.txt"),
]


def load_demo_password():
    """從環境變數或版本庫外憑證檔讀取 DEMO 學員密碼（不回顯明文）。"""
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


STUDENT_PASSWORD = load_demo_password()
if not STUDENT_PASSWORD:
    print(
        "[安全停止] 無法取得 DEMO 學員密碼。請任選其一設定：\n"
        "  1. 環境變數 FDE_DEMO_STUDENT_PASSWORD\n"
        "  2. 環境變數 FDE_DEMO_CREDENTIALS_FILE → 指向符合 "
        "reset_demo_shared_password.py 格式的密碼檔\n"
        "  3. 使用預設憑證檔 ~/.fde-demo-credentials/demo.shared.password.txt\n"
        "本工具不在程式碼中內建預設密碼（2026-10-13 安全收尾）。"
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
    req = urllib.request.Request(url, headers={"User-Agent": "P1-DEMO-VERIFY/1.0"})
    with op.open(req, timeout=30) as resp:
        return resp.status, resp.read().decode("utf-8", "replace"), resp.geturl()


def post(op, url, data, referer):
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "User-Agent": "P1-DEMO-VERIFY/1.0",
            "Referer": referer,
            "Origin": urllib.parse.urlsplit(referer).scheme
            + "://"
            + urllib.parse.urlsplit(referer).netloc,
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


def main():
    # 1. 登入 DEMO Django
    cj, op = new_session()
    status, login_page, _ = get(op, DJANGO + "/login/")
    check("DEMO 學員登入頁可開啟（:8110）", status == 200, "HTTP %s" % status)

    token = csrf_from(cj, COOKIE_HOST)
    form_token = hidden_csrf(login_page) or token
    status, body, final = post(
        op,
        DJANGO + "/login/",
        {
            "username": STUDENT_EMAIL,
            "password": STUDENT_PASSWORD,
            "csrfmiddlewaretoken": form_token,
        },
        DJANGO + "/login/",
    )
    logged_in = "csrftoken" in [c.name for c in cj] and "sessionid" in [c.name for c in cj]
    check("DEMO 學員 demo.student01 登入成功", status in (200, 302) and logged_in,
          "HTTP %s sessionid=%s" % (status, "sessionid" in [c.name for c in cj]))

    # 2. 透過 :8111 代理找學習路徑入口（單一課程會自動重導）
    status, body, final = get(op, LIVE + "/student/learning-path/")
    m = re.search(r'/student/courses/(\d+)/learning-path/', body) or re.search(
        r'/student/courses/(\d+)/learning-path/', final
    )
    if not m:
        # 直接重導情況：final URL 已是工作台
        m2 = re.search(r'/student/courses/(\d+)/learning-path/', final)
        if not m2:
            check("找到學員課程與工作台網址", False, "無法定位 /student/courses/<id>/learning-path/")
            return finish()
        m = m2
    enrollment_id = m.group(1)
    check("找到學員課程與工作台網址", True, "enrollment_id=%s" % enrollment_id)

    workbench_url = LIVE + "/student/courses/%s/learning-path/" % enrollment_id
    status, html, final = get(op, workbench_url)
    check("五階段工作台頁面可開啟（:8111 代理 → DEMO Django）", status == 200,
          "HTTP %s ｜ %s" % (status, final))

    # 也直接打 :8110 確認路由本體
    status_d, html_d, _ = get(op, DJANGO + "/student/courses/%s/learning-path/" % enrollment_id)
    check("工作台頁面可開啟（DEMO Django :8110 直連）", status_d == 200, "HTTP %s" % status_d)

    # 3. 五階段路徑
    for title in ("學習知識", "模擬與練習", "專項實訓", "能力考核", "成長日誌"):
        check("五階段標題存在：%s" % title, title in html)
    check("路徑字串「學 → 練 → 做 → 測 → 證」存在", "學 → 練 → 做 → 測 → 證" in html)
    check("目前階段區塊存在", "目前階段" in html)
    for key in ("stage-learn", "stage-practice", "stage-build", "stage-assess", "stage-certify"):
        check('階段錨點 id="%s" 存在' % key, 'id="%s"' % key in html)

    # 4. 成長紀錄 R01–R08 真實狀態
    slots = re.findall(r'growth-slot">(R0[1-8])<', html)
    check("成長紀錄 R01–R08 全部呈現", sorted(set(slots)) == ["R01", "R02", "R03", "R04", "R05", "R06", "R07", "R08"],
          "出現 %s" % sorted(set(slots)))
    count_m = re.search(r"成長紀錄已提交</span><strong>(\d+) / 8", html)
    reviewed_m = re.search(r"教師已複核</span><strong>(\d+) / 8", html)
    if count_m and reviewed_m:
        check("進度計數為真實 DEMO 資料（非假 100%%）",
              not (count_m.group(1) == "8" and "100%" in html),
              "已提交 %s / 8 ｜ 教師已複核 %s / 8" % (count_m.group(1), reviewed_m.group(1)))
    else:
        check("進度計數區塊存在", False, "找不到成長紀錄計數")

    # 5. F450 數位孿生待接入、不可點
    check("F450 數位孿生以「待接入」呈現", "F450 數位孿生" in html and "待接入" in html)
    check("F450 數位孿生不可點擊（未被 <a> 包裹）",
          re.search(r"<a[^>]*>\s*F450 數位孿生", html) is None)
    check("不存在假孿生網址", re.search(r'href="[^"]*孿生[^"]*"', html) is None)

    # 6. 規劃中專項
    for name in ("3D 列印", "航線規劃", "三維建模", "巡檢與產業 SOP", "無人車", "四面懸停", "起飛與降落", "八字訓練"):
        check("規劃中專項呈現：%s" % name, name in html)
    check("規劃中徽章存在", "規劃中" in html)
    for name in ("3D 列印", "航線規劃", "三維建模", "巡檢與產業 SOP", "無人車"):
        check("規劃中專項無假連結：%s" % name,
              re.search(r"<a[^>]*>\s*{}".format(re.escape(name)), html) is None)

    # 7. 既有安全入口
    for expected in ("/platform/", "/downloads/", "/live/", "/flight-health/",
                     "/student/courses/%s/prop-scan/" % enrollment_id):
        check("既有安全入口可連結：%s" % expected, expected in html)

    # 8. 教師回饋區誠實呈現
    if "目前尚無教師回饋" in html:
        check("教師回饋區（DEMO 真實尚無回饋時明確顯示）", True, "顯示「目前尚無教師回饋」")
    else:
        check("教師回饋區顯示真實回饋內容", "教師回饋" in html and "lp-feedback-item" in html,
              "有真實教師回饋資料")

    # 9. 學員導航與課程總覽入口
    status, dash, _ = get(op, DJANGO + "/student/")
    check("學員課程總覽（/student/）有工作台入口按鈕",
          status == 200 and "/student/courses/%s/learning-path/" % enrollment_id in dash,
          "HTTP %s" % status)
    check("學員導航有工作台連結（經由首頁任一頁面）", "/student/learning-path/" in html)

    # 10. 凍結保護頁面未受影響
    status_r07, html_r07, _ = get(op, DJANGO + "/student/courses/%s/growth/R07/" % enrollment_id)
    check("R07 成長紀錄頁正常（凍結保護未受影響）", status_r07 == 200, "HTTP %s" % status_r07)
    status_m14, html_m14, _ = get(op, DJANGO + "/student/courses/%s/prop-scan/" % enrollment_id)
    check("M1–M4 手機槳葉辨識頁正常（凍結保護未受影響）",
          status_m14 == 200 and all('name="motor_%s"' % m in html_m14 for m in ("M1", "M2", "M3", "M4")),
          "HTTP %s" % status_m14)
    status_gd, html_gd, _ = get(op, DJANGO + "/student/courses/%s/growth/" % enrollment_id)
    check("學習成長日誌正常（凍結保護未受影響）", status_gd == 200, "HTTP %s" % status_gd)

    # 輸出 HTML 存檔供檢視
    out_html = r"D:\FDE-AI-UAS-v2.0\demo\runtime\logs\p1_learning_path_demo.html"
    with open(out_html, "w", encoding="utf-8") as fh:
        fh.write(html)
    print("工作台 HTML 已存檔：%s（%d bytes）" % (out_html, len(html.encode("utf-8"))))

    return finish()


def finish():
    failed = [r for r in RESULTS if not r[1]]
    print("\n==== P1 DEMO 驗收結果：%d 項通過 / %d 項失敗 / 共 %d 項 ====" % (len(RESULTS) - len(failed), len(failed), len(RESULTS)))
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
