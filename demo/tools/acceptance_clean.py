#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""緊急修復驗收：每次登入都用全新 Browser（模擬使用者真實測試情境）。"""
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
OUT = r"D:\FDE-AI-UAS-v2.0\demo\runtime\logs\acceptance_clean.json"


def login_check(login_url, user, pwd, label):
    b = cdp_mod.Browser()
    b.goto(login_url, wait=2.0)
    b.fill("input[name=username]", user)
    b.fill("input[name=password]", pwd)
    for sel in ["button[type=submit]", "input[type=submit]", "button.btn-primary"]:
        if b.click(sel) == "OK":
            break
    time.sleep(3.0)
    url = b.url()
    title = b.title()
    html = b.html()
    err = "電子郵箱或密碼錯誤" if "電子郵箱或密碼錯誤" in html else ""
    b.shot(label)
    b.close()
    return {"url": url, "title": title, "error": err}


def page_check(url, label):
    b = cdp_mod.Browser()
    b.goto(url, wait=3.0)
    u = b.url()
    t = b.title()
    err = "電子郵箱或密碼錯誤" if "電子郵箱或密碼錯誤" in b.html() else ""
    b.shot(label)
    b.close()
    return {"url": u, "title": t, "error": err}


def main():
    r = {}

    # 1) 學員登入（全新瀏覽器）
    info = login_check(f"{LIVE}/login/", *STUDENT, "clean-01-student-login")
    r["STUDENT_LOGIN"] = {**info, "pass": "/login/" not in info["url"] and bool(info["error"] == "")}

    # 2) 成長紀錄（全新瀏覽器，未登入應被導向登入頁；這不是驗收標準）
    # 正確做法：用已登入的 session 訪問。但 CDP 每次新 Browser 沒有 cookie。
    # 所以我們需要「登入後在同一個 Browser 訪問成長紀錄」，但這會有 session 問題。
    # 替代方案：用 urllib session（已驗證成功）+ 截圖登入後的成長頁。

    # 讓我們用一個 Browser 做「登入 → 成長紀錄 → 登出」
    b = cdp_mod.Browser()
    b.goto(f"{LIVE}/login/", wait=2.0)
    b.fill("input[name=username]", STUDENT[0])
    b.fill("input[name=password]", STUDENT[1])
    for sel in ["button[type=submit]", "input[type=submit]", "button.btn-primary"]:
        if b.click(sel) == "OK":
            break
    time.sleep(3.0)
    stu_url = b.url()
    stu_title = b.title()
    r["STUDENT_LOGIN_2"] = {"url": stu_url, "title": stu_title,
                            "pass": "/login/" not in stu_url}

    # 成長紀錄
    b.goto(f"{LIVE}/student/growth/", wait=3.0)
    gu = b.url()
    gt = b.title()
    r["GROWTH"] = {"url": gu, "title": gt,
                   "pass": "/login/" not in gu}
    b.shot("clean-02-growth")

    # 登出
    try:
        b.goto(f"{LIVE}/logout/", wait=2.0)
    except Exception:
        pass
    b.close()

    # 3) 教師登入（全新瀏覽器）
    info = login_check(f"{LIVE}/teacher/login/", *TEACHER, "clean-03-teacher-login")
    r["TEACHER_LOGIN"] = {**info, "pass": "/teacher/login/" not in info["url"] and bool(info["error"] == "")}

    # 4) 教師後台（用同一個已登入 Browser）
    b = cdp_mod.Browser()
    b.goto(f"{LIVE}/teacher/login/", wait=2.0)
    b.fill("input[name=username]", TEACHER[0])
    b.fill("input[name=password]", TEACHER[1])
    for sel in ["button[type=submit]", "input[type=submit]", "button.btn-primary"]:
        if b.click(sel) == "OK":
            break
    time.sleep(3.0)
    b.goto(f"{LIVE}/teacher/", wait=3.0)
    tu = b.url()
    tt = b.title()
    r["TEACHER_BACKEND"] = {"url": tu, "title": tt,
                            "pass": "/teacher/login/" not in tu and "/teacher/" in tu}
    b.shot("clean-04-teacher-backend")
    b.close()

    # 5) 登出後重新學員登入（全新瀏覽器 = 模擬 Session/CSRF 驗證）
    info = login_check(f"{LIVE}/login/", *STUDENT, "clean-05-student-relogin")
    r["STUDENT_RELOGIN"] = {**info, "pass": "/login/" not in info["url"] and bool(info["error"] == "")}

    passed = sum(1 for v in r.values() if v.get("pass"))
    result = {"summary": f"{passed}/{len(r)}", "results": r}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
