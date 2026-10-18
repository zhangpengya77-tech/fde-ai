#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""展示封版｜以已驗證 session 做五項功能最終驗收（HTTP 層，含 CSRF 登入）。"""
import json
import urllib.parse
import urllib.request
import http.cookiejar
import demo_credentials

LIVE = "http://127.0.0.1:8111"
STUDENT = demo_credentials.student_credentials()
TEACHER = demo_credentials.teacher_credentials()
OUT = r"D:\FDE-AI-UAS-v2.0\demo\runtime\logs\acceptance_auth.json"


def make_session():
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    return cj, op


def get(op, url, redirect="manual"):
    req = urllib.request.Request(url, headers={"User-Agent": "accept/1.0"})
    try:
        r = op.open(req) if redirect == "follow" else op.open(req)
        return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        try:
            return e.code, e.read().decode("utf-8", "replace")
        except Exception:
            return e.code, ""


def login(op, login_url, user, pwd):
    # 取 CSRF
    st, body = get(op, login_url)
    import re
    m = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', body)
    csrf = m.group(1) if m else ""
    data = urllib.parse.urlencode({
        "csrfmiddlewaretoken": csrf,
        "username": user,
        "password": pwd,
    }).encode()
    req = urllib.request.Request(login_url, data=data, headers={
        "User-Agent": "accept/1.0",
        "Referer": login_url,
        "Content-Type": "application/x-www-form-urlencoded",
    }, method="POST")
    try:
        r = op.open(req)
        return r.status, r.geturl(), dict(r.info())
    except urllib.error.HTTPError as e:
        return e.code, e.geturl(), {}


def has_sessionid(cj):
    return any(c.name == "sessionid" for c in cj)


def main():
    res = {}

    # HOME（不帶 cookie 也能看）
    import urllib.request as u
    cj0 = http.cookiejar.CookieJar()
    op0 = u.build_opener(u.HTTPCookieProcessor(cj0))
    st, body = get(op0, f"{LIVE}/")
    res["HOME"] = {"status": st, "title_in": ("FDE" in body), "pass": st == 200 and ("FDE" in body)}

    # STUDENT
    cj, op = make_session()
    st, url, _ = login(op, f"{LIVE}/login/", *STUDENT)
    st2, body2 = get(op, f"{LIVE}/student/")
    res["STUDENT_LOGIN"] = {"login_status": st, "landed": url, "has_sessionid": has_sessionid(cj),
                            "dashboard_status": st2, "pass": has_sessionid(cj) and st2 == 200}

    # GROWTH (authenticated)
    stg, bodyg = get(op, f"{LIVE}/student/growth/")
    stg2, bodyg2 = get(op, f"{LIVE}/student/courses/1/growth/")
    res["GROWTH"] = {"entry_url": f"{LIVE}/student/growth/", "entry_status": stg,
                     "course_status": stg2, "course_len": len(bodyg2),
                     "pass": has_sessionid(cj) and stg2 == 200 and len(bodyg2) > 2000}

    # TEACHER
    cj2, op2 = make_session()
    stt, urlt, _ = login(op2, f"{LIVE}/teacher/login/", *TEACHER)
    stt2, bodyt2 = get(op2, f"{LIVE}/teacher/")
    res["TEACHER_BACKEND"] = {"login_status": stt, "landed": urlt, "has_sessionid": has_sessionid(cj2),
                              "teacher_page_status": stt2, "teacher_page_len": len(bodyt2),
                              "pass": has_sessionid(cj2) and stt2 == 200 and len(bodyt2) > 500}

    # DOWNLOADS
    std, bodyd = get(op0, f"{LIVE}/downloads/")
    sta, bodya = get(op0, f"{LIVE}/api/downloads")
    try:
        j = json.loads(bodya)
        api_ok = isinstance(j, dict) and isinstance(j.get("downloads"), list) and len(j["downloads"]) > 0
        names = [x.get("display_name") for x in j.get("downloads", [])]
    except Exception:
        api_ok = False
        names = []
    res["DOWNLOADS"] = {"page_status": std, "page_len": len(bodyd), "api_status": sta,
                        "api_ok": api_ok, "files": names,
                        "pass": std == 200 and api_ok}

    passed = sum(1 for v in res.values() if v.get("pass"))
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"summary": f"{passed}/5", "results": res}, f, ensure_ascii=False, indent=2)
    print("ACCEPTANCE", passed, "/ 5")
    for k, v in res.items():
        print(k, "PASS" if v.get("pass") else "FAIL", json.dumps(v, ensure_ascii=False))


if __name__ == "__main__":
    main()
