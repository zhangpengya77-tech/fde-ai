#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""真實瀏覽器截圖：透過既有的 Chrome :9222 執行「真實登入」後截圖。

與 verify_demo_fix.py 不同的是，這裡的登入是用 CDP 填表 + 點擊提交，
由瀏覽器自然帶上 CSRF token 與 Origin=http://127.0.0.1:8111，
驗證修復後的登入確實可在真實 Chrome 走通，並留下登入後頁面的截圖。
"""
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


def cdp_login(b, login_url, user, pwd):
    b.goto(login_url, wait=2.0)
    b.fill("input[name=username]", user)
    b.fill("input[name=password]", pwd)
    # 嘗試多種提交鈕
    for sel in ["button[type=submit]", "input[type=submit]", "button.btn-primary"]:
        res = b.click(sel)
        if res == "OK":
            break
    time.sleep(2.5)
    return b.url()


def main():
    b = __import__("cdp").Browser()
    shots = {}
    plan = [
        ("01-home", f"{LIVE}/", None),
        ("02-student-login", f"{LIVE}/login/", None),
    ]
    for name, url, _ in plan:
        b.goto(url, wait=2.0)
        shots[name] = b.shot(name)
        print("SHOT", name, shots[name])

    # 學員真實登入 -> 儀表板
    u = cdp_login(b, f"{LIVE}/login/", *STUDENT)
    print("student landed:", u)
    shots["03-student-dashboard"] = b.shot("03-student-dashboard")
    print("SHOT 03-student-dashboard", shots["03-student-dashboard"])

    # 教師登入（先登出，避免 session 衝突）
    try:
        b.goto(f"{LIVE}/logout/", wait=1.5)
    except Exception:
        pass
    b.goto(f"{LIVE}/teacher/login/", wait=2.0)
    shots["04-teacher-login"] = b.shot("04-teacher-login")
    print("SHOT 04-teacher-login", shots["04-teacher-login"])

    u = cdp_login(b, f"{LIVE}/teacher/login/", *TEACHER)
    print("teacher landed:", u)
    shots["05-teacher-dashboard"] = b.shot("05-teacher-dashboard")
    print("SHOT 05-teacher-dashboard", shots["05-teacher-dashboard"])

    for name, url in [
        ("06-vision-flywheel", f"{LIVE}/teacher/vision-flywheel/"),
        ("07-golden-sets", f"{LIVE}/teacher/golden-sets/"),
        ("08-flight-health", f"{LIVE}/flight-health/"),
        ("09-downloads", f"{LIVE}/downloads/"),
    ]:
        b.goto(url, wait=2.2)
        shots[name] = b.shot(name)
        print("SHOT", name, shots[name])

    b.close()
    with open(r"D:\FDE-AI-UAS-v2.0\demo\runtime\screenshots_manifest.json", "w", encoding="utf-8") as f:
        json.dump(shots, f, ensure_ascii=False, indent=2)
    print("TOTAL", len(shots), "screenshots ->", cdp_mod.SHOTS)


if __name__ == "__main__":
    main()
