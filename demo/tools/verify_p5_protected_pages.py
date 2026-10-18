#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""P5 保護模組與前階段回歸（唯讀 HTTP 檢查，DEMO :8110）。

目的：確認 P5 開發未破壞受保護模組與 P1–P4.2 既有頁面。
只做 GET，不送出任何表單，不修改任何資料。
憑證不寫入程式：讀取 ~/.fde-demo-credentials/demo.shared.password.txt。
"""
import http.cookiejar
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get("FDE_P5_BASE", "http://192.168.1.114:8110")
CRED = os.path.expanduser("~/.fde-demo-credentials/demo.shared.password.txt")
TEACHER = "demo.teacher@fde-demo.local"
STUDENT = "demo.student01@fde-demo.local"


def read_shared_password():
    with open(CRED, "r", encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    for i, line in enumerate(lines):
        if "以下為密碼" in line and "----" in line:
            for nxt in lines[i + 1:]:
                t = nxt.strip()
                if t and not t.startswith("----"):
                    return t
    raise SystemExit("[安全停止] 無法從憑證檔解析出密碼。")


PASSWORD = read_shared_password()

results = []


def check(label, ok, detail=""):
    results.append(bool(ok))
    print("%s - %s%s" % ("PASS" if ok else "FAIL", label, (" | " + detail) if detail else ""))


def make_opener():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(jar),
        urllib.request.ProxyHandler({}),
        urllib.request.HTTPRedirectHandler(),
    )


def login(opener, path, email):
    url = "%s%s" % (BASE, path)
    resp = opener.open(url, timeout=20)
    html = resp.read().decode("utf-8", "replace")
    m = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', html)
    if not m:
        return False, "no csrf token"
    data = urllib.parse.urlencode(
        {
            "csrfmiddlewaretoken": m.group(1),
            "username": email,
            "password": PASSWORD,
        }
    ).encode()
    req = urllib.request.Request(url, data=data, headers={"Referer": url})
    try:
        opener.open(req, timeout=20)
    except urllib.error.HTTPError as exc:
        if exc.code not in (302, 303):
            return False, "login HTTP %s" % exc.code
    return True, "ok"


def get_status(opener, path):
    url = "%s%s" % (BASE, path)
    try:
        resp = opener.open(url, timeout=25)
        return resp.getcode(), resp.geturl()
    except urllib.error.HTTPError as exc:
        return exc.code, url
    except Exception as exc:  # noqa: BLE001
        return None, "ERROR %s" % exc


def main():
    # ── 教師端 ──────────────────────────────────────────────────────
    topen = make_opener()
    ok, detail = login(topen, "/teacher/login/", TEACHER)
    check("DEMO 教師登入成功", ok, detail)

    teacher_pages = [
        ("P3 班級學習成果總覽（教師總覽）", "/teacher/class-outcomes/"),
        ("P5 班級結訓成果報告", "/teacher/class-report/"),
        ("R07 模型管理：AI 視覺模型中心", "/teacher/vision-center/"),
        ("R07 資料飛輪倉庫", "/teacher/vision-flywheel/"),
        ("R07 模型清單", "/teacher/vision-models/"),
        ("Golden Set 中心", "/teacher/golden-sets/"),
        ("R08 學員回饋分析", "/teacher/surveys/"),
    ]
    for label, path in teacher_pages:
        status, final = get_status(topen, path)
        check("保護／回歸頁可開啟：%s" % label, status == 200, "HTTP %s ｜ %s" % (status, final))

    # ── 學員端 ──────────────────────────────────────────────────────
    sopen = make_opener()
    ok, detail = login(sopen, "/login/", STUDENT)
    check("DEMO 學員登入成功", ok, detail)

    status, final = get_status(sopen, "/student/")
    check("P1 學員首頁可開啟", status == 200, "HTTP %s ｜ %s" % (status, final))
    status, final = get_status(sopen, "/student/learning-path/")
    check("P1 五階段學習工作台（單一課程自動重導）", status == 200, "HTTP %s ｜ %s" % (status, final))

    # 由成長紀錄入口取得 enrollment id
    status, final = get_status(sopen, "/student/growth/")
    check("P2 學習成長日誌入口可開啟", status == 200, "HTTP %s ｜ %s" % (status, final))
    m = re.search(r"/student/courses/(\d+)/", final)
    eid = m.group(1) if m else None
    check("可由入口取得課程 enrollment id", eid is not None, "enrollment=%s" % eid)

    if eid:
        student_pages = [
            ("P1 五階段學習路徑頁", "/student/courses/%s/learning-path/" % eid),
            ("P2 成長紀錄儀表板", "/student/courses/%s/growth/" % eid),
            ("R07 成長紀錄 R07 模型上傳頁", "/student/courses/%s/growth/R07/" % eid),
            ("M1–M4 槳葉方向辨識頁（受保護）", "/student/courses/%s/prop-scan/" % eid),
        ]
        for label, path in student_pages:
            status, final = get_status(sopen, path)
            check("保護／回歸頁可開啟：%s" % label, status == 200, "HTTP %s ｜ %s" % (status, final))

    # ── 未登入者不得讀取報告 ────────────────────────────────────────
    anon = make_opener()
    status, final = get_status(anon, "/teacher/class-report/")
    check("未登入者不得讀取班級成果報告（重導登入）", status == 200 and "/teacher/login/" in final, "HTTP %s ｜ %s" % (status, final))

    print("")
    total = len(results)
    passed = sum(results)
    print("==== P5 保護模組與回歸檢查：%d 項通過 / %d 項失敗 / 共 %d 項 ====" % (passed, total - passed, total))
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
