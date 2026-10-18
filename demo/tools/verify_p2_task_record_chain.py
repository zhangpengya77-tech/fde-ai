#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""P2 五階段任務與成長證據鏈整合 — DEMO 真實資料驗收（HTTP 層）。

以 DEMO 學員帳號登入 :8110（DEMO DB），透過 :8111 代理開啟五階段學習工作台，
驗證 P2 整合結果（全部以 DEMO 真實資料為準，不使用假資料）：
  1. 任務卡呈現 M01–M12 編號、任務要求與需附證據（真实 TaskDefinition 已入库）
  2. 對應鏈：practice 階段 T03 卡片連結 R03「真機飛行訓練」；R03 成長卡隸屬 practice
  3. F450：build 階段含 R05 成長卡；practice 階段 T05 卡片連結 R05
  4. 無一對一對應的任務（T07）只顯示「相關成長紀錄」與歸屬說明，不得假裝對應
  5. 狀態誠實：教師已複核數 ≤ 已提交數（已提交不得顯示成已透過）
     「教師複核：合格」僅在有真實 GrowthRecordReview 時出現
  6. 凍結保護未受影響：R07 成長紀錄頁、M1–M4 辨識頁、學習成長日誌皆正常
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
    req = urllib.request.Request(url, headers={"User-Agent": "P2-DEMO-VERIFY/1.0"})
    with op.open(req, timeout=30) as resp:
        return resp.status, resp.read().decode("utf-8", "replace"), resp.geturl()


def post(op, url, data, referer):
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "User-Agent": "P2-DEMO-VERIFY/1.0",
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


def stage_block(html, stage_key):
    """取出某階段 <section> 區塊內容（用於階段隸屬斷言）。"""
    m = re.search(
        r'<section class="section-block lp-stage" id="stage-{}"[\s\S]*?(?=<section class="section-block|</main>)'.format(stage_key),
        html,
    )
    return m.group(0) if m else ""


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
    logged_in = "sessionid" in [c.name for c in cj]
    check("DEMO 學員 demo.student01 登入成功", status in (200, 302) and logged_in,
          "HTTP %s sessionid=%s" % (status, logged_in))

    # 2. 定位工作台
    status, body, final = get(op, LIVE + "/student/learning-path/")
    m = re.search(r"/student/courses/(\d+)/learning-path/", body) or re.search(
        r"/student/courses/(\d+)/learning-path/", final
    )
    if not m:
        check("找到學員課程與工作台網址", False, "無法定位 /student/courses/<id>/learning-path/")
        return finish()
    enrollment_id = m.group(1)
    check("找到學員課程與工作台網址", True, "enrollment_id=%s" % enrollment_id)

    workbench_url = LIVE + "/student/courses/%s/learning-path/" % enrollment_id
    status, html, final = get(op, workbench_url)
    check("五階段工作台頁面可開啟（:8111 代理 → DEMO Django）", status == 200,
          "HTTP %s ｜ %s" % (status, final))

    # 3. 任務卡 M01–M12 與要求／證據區塊（真实 TaskDefinition）
    task_ids = re.findall(r'class="task-id">(M\d{2})<', html)
    missing = ["M%02d" % i for i in range(1, 13) if "M%02d" % i not in task_ids]
    check("任務卡 M01–M12 全部呈現（DEMO 任务定义已入库）", not missing,
          "缺少 %s" % missing if missing else "共 %d 張卡" % len(task_ids))
    check("任務卡顯示「任務要求」", "任務要求" in html)
    check("任務卡顯示「需附證據」", "需附證據" in html)

    # 4. 對應鏈：T03（practice）↔ R03
    practice = stage_block(html, "practice")
    assess = stage_block(html, "assess")
    build = stage_block(html, "build")
    check("practice 階段區塊可解析", bool(practice))
    check("T03 任務卡連結 R03「真機飛行訓練」",
          re.search(r"M03[\s\S]{0,3000}?growth/R03/", practice) is not None
          and "真機飛行訓練" in practice)
    check("R03 成長卡隸屬 practice（assess 階段不再出現 R03）",
          'growth-slot">R03<' in practice and 'growth-slot">R03<' not in assess)

    # 5. F450：R05 成長卡隸屬 build；T05（practice 任務）連結 R05
    check("R05 成長卡隸屬 build 階段", 'growth-slot">R05<' in build and "F450 工程組裝" in build)
    check("T05 任務卡連結 R05「F450 工程組裝」",
          re.search(r"M05[\s\S]{0,3000}?growth/R05/", practice) is not None)

    # 6. 無一對一對應任務（T07）只顯示相關成長紀錄＋歸屬說明
    check("T07 卡片顯示「相關成長紀錄」歸屬提示",
          re.search(r"M07[\s\S]{0,3000}?相關成長紀錄", build) is not None)
    check("T07 歸屬說明呈現（不假裝已對應）",
          "屬 R07 專業任務驗證的方向子能力（航線任務）" in build)

    # 7. 狀態誠實：已提交 ≠ 已透過
    count_m = re.search(r"成長紀錄已提交</span><strong>(\d+) / 8", html)
    reviewed_m = re.search(r"教師已複核</span><strong>(\d+) / 8", html)
    reviewed_count = int(reviewed_m.group(1)) if reviewed_m else 0
    if count_m and reviewed_m:
        submitted = int(count_m.group(1))
        check("教師已複核數 ≤ 已提交數（已提交不冒充已透過）",
              reviewed_count <= submitted,
              "已提交 %d / 8 ｜ 教師已複核 %d / 8" % (submitted, reviewed_count))
    else:
        check("進度計數區塊存在", False, "找不到成長紀錄計數")
    if "教師複核：合格" in html:
        check("「教師複核：合格」僅在有真實 review 時出現", reviewed_count > 0,
              "DEMO 存在真實教師複核資料（%d 筆）" % reviewed_count)
    else:
        check("DEMO 尚無教師複核資料（頁面未虛構合格標籤）", True, "未出現教師複核標籤")
    if "✅ 已完成" in html:
        check("「✅ 已完成」僅在有真實教師複核時出現", reviewed_count > 0,
              "已完成標籤 %d 處 ｜ 教師已複核 %d / 8" % (html.count("✅ 已完成"), reviewed_count))
    else:
        check("DEMO 尚無已完成紀錄（未虛構完成狀態）", True, "未出現 ✅ 已完成")

    # 8. 凍結保護未受影響
    status_r07, html_r07, _ = get(op, DJANGO + "/student/courses/%s/growth/R07/" % enrollment_id)
    check("R07 成長紀錄頁正常（凍結保護未受影響）", status_r07 == 200, "HTTP %s" % status_r07)
    status_m14, html_m14, _ = get(op, DJANGO + "/student/courses/%s/prop-scan/" % enrollment_id)
    check("M1–M4 手機槳葉辨識頁正常（凍結保護未受影響）",
          status_m14 == 200 and all('name="motor_%s"' % m in html_m14 for m in ("M1", "M2", "M3", "M4")),
          "HTTP %s" % status_m14)
    status_gd, html_gd, _ = get(op, DJANGO + "/student/courses/%s/growth/" % enrollment_id)
    check("學習成長日誌正常（凍結保護未受影響）", status_gd == 200, "HTTP %s" % status_gd)
    status_td, _, _ = get(op, DJANGO + "/student/courses/%s/tasks/T03/" % enrollment_id)
    check("既有任務詳情頁 T03 正常（提交流程未改寫）", status_td == 200, "HTTP %s" % status_td)

    # 輸出 HTML 存檔供檢視
    out_html = r"D:\FDE-AI-UAS-v2.0\demo\runtime\logs\p2_task_record_chain_demo.html"
    with open(out_html, "w", encoding="utf-8") as fh:
        fh.write(html)
    print("工作台 HTML 已存檔：%s（%d bytes）" % (out_html, len(html.encode("utf-8"))))

    return finish()


def finish():
    failed = [r for r in RESULTS if not r[1]]
    print("\n==== P2 DEMO 驗收結果：%d 項通過 / %d 項失敗 / 共 %d 項 ====" % (len(RESULTS) - len(failed), len(failed), len(RESULTS)))
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
