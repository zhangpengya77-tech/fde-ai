#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""展示封版｜五項功能真實 Chrome 驗收（DEMO 8111 代理 django 8110）。"""
import json
import os
import sys
import time

sys.path.insert(0, r"D:\FDE-AI-UAS-v2.0\.test-temp\acceptance-r24")
import cdp as cdp_mod
import demo_credentials

cdp_mod.SHOTS = r"D:\FDE-AI-UAS-v2.0\demo\screenshots"
os.makedirs(cdp_mod.SHOTS, exist_ok=True)

LIVE = "http://127.0.0.1:8111"
STUDENT = demo_credentials.student_credentials()
TEACHER = demo_credentials.teacher_credentials()

results = {}
shots = {}


def cdp_login(b, login_url, user, pwd):
    b.goto(login_url, wait=2.0)
    b.fill("input[name=username]", user)
    b.fill("input[name=password]", pwd)
    for sel in ["button[type=submit]", "input[type=submit]", "button.btn-primary"]:
        res = b.click(sel)
        if res == "OK":
            break
    time.sleep(2.5)
    return b.url()


def fetch(url):
    import urllib.request
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except Exception as e:
        return getattr(e, "code", 0), str(e)


def main():
    b = cdp_mod.Browser()

    # 1) 首頁
    b.goto(f"{LIVE}/", wait=2.0)
    title = b.title()
    ok_home = "FDE" in title
    results["HOME"] = {"url": b.url(), "title": title, "pass": ok_home}
    shots["01-home"] = b.shot("01-home")

    # 2) 學員登入
    b.goto(f"{LIVE}/login/", wait=2.0)
    u = cdp_login(b, f"{LIVE}/login/", *STUDENT)
    # 登入後應落在首頁/儀表板（非 login）
    ok_stu = ("/login/" not in u) and ("sessionid" in "" or True)
    results["STUDENT_LOGIN"] = {"landed": u, "pass": ("/login/" not in u)}
    shots["02-student-dashboard"] = b.shot("02-student-dashboard")

    # 3) 學員成長紀錄：登入後訪問 /student/growth/ 應重定向到課程儀表板並 200
    b.goto(f"{LIVE}/student/growth/", wait=2.5)
    gu = b.url()
    # 直接對課程成長頁做 HTTP 驗證
    st, body = fetch(f"{LIVE}/student/courses/1/growth/")
    ok_growth = (st == 200) and (len(body) > 2000)
    results["GROWTH"] = {
        "entry_url": gu,
        "course_growth_status": st,
        "course_growth_len": len(body),
        "pass": ok_growth,
    }
    shots["03-growth"] = b.shot("03-growth")

    # 4) 教師後台：先登出，再走 /teacher/login/
    try:
        b.goto(f"{LIVE}/logout/", wait=1.5)
    except Exception:
        pass
    b.goto(f"{LIVE}/teacher/login/", wait=2.0)
    tu = cdp_login(b, f"{LIVE}/teacher/login/", *TEACHER)
    # 教師登入後應落在 /teacher/ 儀表板
    st_t, body_t = fetch(f"{LIVE}/teacher/")
    ok_teacher = ("/teacher/login/" not in tu) and (st_t == 200) and (len(body_t) > 500)
    results["TEACHER_BACKEND"] = {
        "landed": tu,
        "teacher_page_status": st_t,
        "teacher_page_len": len(body_t),
        "pass": ok_teacher,
    }
    shots["04-teacher-dashboard"] = b.shot("04-teacher-dashboard")

    # 5) 下載中心：頁面 + API
    b.goto(f"{LIVE}/downloads/", wait=2.2)
    st_d, body_d = fetch(f"{LIVE}/downloads/")
    st_a, body_a = fetch(f"{LIVE}/api/downloads")
    ok_dl_page = (st_d == 200) and (len(body_d) > 200)
    # API 應為 JSON 且含 downloads 陣列
    try:
        j = json.loads(body_a)
        api_ok = isinstance(j, dict) and isinstance(j.get("downloads"), list) and len(j["downloads"]) > 0
        api_names = [x.get("display_name") for x in j.get("downloads", [])]
    except Exception:
        api_ok = False
        api_names = []
    results["DOWNLOADS"] = {
        "page_status": st_d,
        "page_len": len(body_d),
        "api_status": st_a,
        "api_ok": api_ok,
        "api_files": api_names,
        "pass": ok_dl_page and api_ok,
    }
    shots["05-downloads"] = b.shot("05-downloads")

    b.close()

    with open(r"D:\FDE-AI-UAS-v2.0\demo\runtime\logs\acceptance_final.json", "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    with open(r"D:\FDE-AI-UAS-v2.0\demo\runtime\screenshots_manifest.json", "w", encoding="utf-8") as f:
        json.dump(shots, f, ensure_ascii=False, indent=2)

    passed = sum(1 for v in results.values() if v.get("pass"))
    print("ACCEPTANCE", passed, "/", len(results))
    for k, v in results.items():
        print(k, "PASS" if v.get("pass") else "FAIL", json.dumps(v, ensure_ascii=False))


if __name__ == "__main__":
    main()
