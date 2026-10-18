#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""模擬瀏覽器完整流程（含 CSRF、session、登出再登入、成長紀錄、教師後台）。

與 Chrome 行為一致的部分：
  - GET 登入頁取得 csrftoken cookie + hidden csrfmiddlewaretoken
  - POST 表單帶 Referer / Origin / CSRF
  - 跟隨 302 重定向
  - 檢查 sessionid cookie
  - 登出後重新登入
"""
import http.cookiejar
import json
import re
import urllib.error
import urllib.parse
import urllib.request

import demo_credentials

LIVE = "http://127.0.0.1:8111"
STUDENT = demo_credentials.student_credentials()
TEACHER = demo_credentials.teacher_credentials()
OUT = r"D:\FDE-AI-UAS-v2.0\demo\runtime\logs\verify_browser_flow.json"

import os

for k in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
    os.environ.pop(k, None)
os.environ["NO_PROXY"] = "*"
os.environ["no_proxy"] = "*"


def new_session():
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(cj),
        urllib.request.HTTPRedirectHandler(),
        urllib.request.ProxyHandler({}),
    )
    return cj, op


def get(op, url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    try:
        r = op.open(req, timeout=10)
        return r.status, r.geturl(), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        try:
            return e.code, e.geturl(), e.read().decode("utf-8", "replace")
        except Exception:
            return e.code, url, ""


def login(op, login_url, user, pwd):
    st, url, body = get(op, login_url)
    m = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', body)
    if not m:
        return {"error": "no csrf token in login page", "status": st}
    csrf = m.group(1)
    data = urllib.parse.urlencode({
        "csrfmiddlewaretoken": csrf,
        "username": user,
        "password": pwd,
    }).encode()
    req = urllib.request.Request(login_url, data=data, headers={
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": login_url,
        "Origin": LIVE,
    }, method="POST")
    try:
        r = op.open(req, timeout=10)
        status, landed, html = r.status, r.geturl(), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        status, landed, html = e.code, e.geturl(), e.read().decode("utf-8", "replace")
    err = "電子郵箱或密碼錯誤" if "電子郵箱或密碼錯誤" in html else ""
    return {"status": status, "landed": landed, "error": err}


def has_sessionid(cj):
    return any(c.name == "sessionid" for c in cj)


def main():
    r = {}

    # 1) 學員登入
    cj, op = new_session()
    li = login(op, f"{LIVE}/login/", *STUDENT)
    r["STUDENT_LOGIN"] = {
        **li,
        "has_sessionid": has_sessionid(cj),
        "pass": li.get("error") == "" and has_sessionid(cj) and "/student/" in li.get("landed", ""),
    }

    # 2) 成長紀錄（同一 session）
    st, url, body = get(op, f"{LIVE}/student/growth/")
    ok_growth = st == 200 and "/login/" not in url and len(body) > 2000
    r["GROWTH"] = {"status": st, "final_url": url, "len": len(body), "pass": ok_growth}

    # 3) 登出
    st, url, body = get(op, f"{LIVE}/logout/")
    r["LOGOUT"] = {"status": st, "final_url": url}

    # 4) 登出後再登入學員（Session/CSRF 驗證）
    cj2, op2 = new_session()
    li2 = login(op2, f"{LIVE}/login/", *STUDENT)
    r["STUDENT_RELOGIN"] = {
        **li2,
        "has_sessionid": has_sessionid(cj2),
        "pass": li2.get("error") == "" and has_sessionid(cj2) and "/student/" in li2.get("landed", ""),
    }

    # 5) 教師登入
    cj3, op3 = new_session()
    lt = login(op3, f"{LIVE}/teacher/login/", *TEACHER)
    r["TEACHER_LOGIN"] = {
        **lt,
        "has_sessionid": has_sessionid(cj3),
        "pass": lt.get("error") == "" and has_sessionid(cj3),
    }

    # 6) 教師後台
    st, url, body = get(op3, f"{LIVE}/teacher/")
    r["TEACHER_BACKEND"] = {
        "status": st, "final_url": url, "len": len(body),
        "pass": st == 200 and "/teacher/login/" not in url and "/teacher/" in url,
    }

    passed = sum(1 for v in r.values() if v.get("pass"))
    result = {"summary": f"{passed} pass", "results": r}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
