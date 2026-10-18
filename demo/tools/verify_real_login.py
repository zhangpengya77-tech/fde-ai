#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""真實 Chrome CDP 登入驗證：截圖 + 錯誤文字 + cookie 檢查。"""
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
OUT = r"D:\FDE-AI-UAS-v2.0\demo\runtime\logs\verify_real_login.json"


def cdp_login(b, login_url, user, pwd, label):
    b.goto(login_url, wait=2.0)
    b.shot(f"{label}-01-page")
    # 清除舊值再填入
    b.eval("document.querySelector('input[name=username]').value=''")
    b.eval("document.querySelector('input[name=password]').value=''")
    b.fill("input[name=username]", user)
    b.fill("input[name=password]", pwd)
    b.shot(f"{label}-02-filled")
    for sel in ["button[type=submit]", "input[type=submit]", "button.btn-primary"]:
        res = b.click(sel)
        if res == "OK":
            break
    time.sleep(3.0)
    url = b.url()
    title = b.title()
    html = b.html()
    # 檢查錯誤訊息
    err = ""
    if "電子郵箱或密碼錯誤" in html:
        err = "電子郵箱或密碼錯誤"
    elif "錯誤" in html and "密碼" in html:
        err = "密碼相關錯誤"
    # 檢查 cookie
    cookies = b.eval("document.cookie")
    b.shot(f"{label}-03-after")
    return {"url": url, "title": title, "error": err, "cookies": cookies}


def main():
    b = cdp_mod.Browser()
    results = {}

    # 學員登入
    results["student_login"] = cdp_login(b, f"{LIVE}/login/", *STUDENT, "stu")

    # 登出
    try:
        b.goto(f"{LIVE}/logout/", wait=2.0)
    except Exception:
        pass

    # 教師登入
    results["teacher_login"] = cdp_login(b, f"{LIVE}/teacher/login/", *TEACHER, "tea")

    # 登出後再登入學員（Session / CSRF 驗證）
    try:
        b.goto(f"{LIVE}/logout/", wait=2.0)
    except Exception:
        pass
    results["student_relogin"] = cdp_login(b, f"{LIVE}/login/", *STUDENT, "stu2")

    b.close()

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
