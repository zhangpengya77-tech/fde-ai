#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""緊急修復驗收：學員登入、成長紀錄、教師登入、教師後台、登出再登入。"""
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
OUT = r"D:\FDE-AI-UAS-v2.0\demo\runtime\logs\acceptance_emergency.json"


def cdp_login(b, login_url, user, pwd):
    b.goto(login_url, wait=2.0)
    b.fill("input[name=username]", user)
    b.fill("input[name=password]", pwd)
    for sel in ["button[type=submit]", "input[type=submit]", "button.btn-primary"]:
        if b.click(sel) == "OK":
            break
    time.sleep(3.0)
    return b.url(), b.title()


def cdp_logout(b):
    try:
        b.goto(f"{LIVE}/logout/", wait=2.0)
    except Exception:
        pass


def main():
    b = cdp_mod.Browser()
    r = {}

    # 1) 學員登入
    url, title = cdp_login(b, f"{LIVE}/login/", *STUDENT)
    r["STUDENT_LOGIN"] = {"url": url, "title": title,
                          "pass": "/login/" not in url and "/student/" in url}
    b.shot("emergency-01-student-login")

    # 2) 成長紀錄
    b.goto(f"{LIVE}/student/growth/", wait=3.0)
    gu, gt = b.url(), b.title()
    r["GROWTH"] = {"url": gu, "title": gt,
                   "pass": "/login/" not in gu and ("growth" in gu or "courses" in gu)}
    b.shot("emergency-02-growth")

    # 3) 登出
    cdp_logout(b)

    # 4) 教師登入
    url, title = cdp_login(b, f"{LIVE}/teacher/login/", *TEACHER)
    r["TEACHER_LOGIN"] = {"url": url, "title": title,
                          "pass": "/teacher/login/" not in url}
    b.shot("emergency-03-teacher-login")

    # 5) 教師後台
    b.goto(f"{LIVE}/teacher/", wait=3.0)
    tu, tt = b.url(), b.title()
    r["TEACHER_BACKEND"] = {"url": tu, "title": tt,
                            "pass": "/teacher/login/" not in tu and "/teacher/" in tu}
    b.shot("emergency-04-teacher-backend")

    # 6) 登出再登入學員（Session/CSRF 驗證）
    cdp_logout(b)
    url2, title2 = cdp_login(b, f"{LIVE}/login/", *STUDENT)
    r["STUDENT_RELOGIN"] = {"url": url2, "title": title2,
                            "pass": "/login/" not in url2 and "/student/" in url2}
    b.shot("emergency-05-student-relogin")

    b.close()

    passed = sum(1 for v in r.values() if v.get("pass"))
    result = {"summary": f"{passed}/{len(r)}", "results": r}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
