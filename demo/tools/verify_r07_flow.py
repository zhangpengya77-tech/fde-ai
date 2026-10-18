#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""R07 學員模型提交完整流程驗收（DEMO，含 CSRF + session）。

流程：
  1. 學員登入（以 Django session）
  2. 進入 R07 頁面
  3. 上傳 DEMO_TEST_ONLY 佔位 best.pt
  4. 重新載入 R07，確認提交紀錄仍在（持久化）
  5. 教師登入，確認可看到該學員模型提交

安全：只上傳「佔位檔」驗證上傳/儲存/SHA256/審核流程，
      絕不載入或推論該 .pt；佔位檔明確標示 DEMO_TEST_ONLY。
"""
import http.cookiejar
import io
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

# 允許驗收工具對準既有 DEMO 綁定位址，不改動服務設定。
LIVE = os.environ.get("FDE_ACCEPT_LIVE_BASE", "http://127.0.0.1:8111").rstrip("/")
STUDENT_EMAIL = "demo.student01@fde-demo.local"
TEACHER_EMAIL = "demo.teacher@fde-demo.local"
DELIVERY_FILE = Path.home() / ".fde-demo-credentials" / "demo.shared.password.txt"
ENROLLMENT_ID = 1
R07_URL = f"{LIVE}/student/courses/{ENROLLMENT_ID}/growth/R07/"
R07_MODEL_URL = f"{LIVE}/student/courses/{ENROLLMENT_ID}/growth/R07/model/"
OUT = r"D:\FDE-AI-UAS-v2.0\demo\runtime\logs\r07_acceptance.json"

for k in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
    os.environ.pop(k, None)
os.environ["NO_PROXY"] = "*"
os.environ["no_proxy"] = "*"

PLACEHOLDER = (
    b"DEMO_TEST_ONLY\n"
    b"This is NOT a real YOLO weight file. It exists solely to exercise the\n"
    b"R07 upload / storage / SHA256 / review pipeline in the isolated DEMO DB.\n"
    b"It must never be loaded for inference.\n" + uuid.uuid4().bytes
)


def read_shared_password():
    """從本機受限交付檔讀取 DEMO 密碼，絕不輸出明文。"""
    lines = DELIVERY_FILE.read_text(encoding="utf-8").splitlines()
    for index, line in enumerate(lines):
        if "以下為密碼" in line and "----" in line:
            for candidate in lines[index + 1:]:
                value = candidate.strip()
                if value and not value.startswith("----"):
                    return value
    raise SystemExit("無法從 DEMO 受限交付檔解析共用密碼")


def new_session():
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(cj),
        urllib.request.HTTPRedirectHandler(),
        urllib.request.ProxyHandler({}),
    )
    return cj, op


def get(op, url):
    try:
        r = op.open(urllib.request.Request(url), timeout=15)
        return r.status, r.geturl(), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.geturl(), e.read().decode("utf-8", "replace")


def csrf_of(html):
    m = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', html)
    return m.group(1) if m else None


def login(op, login_url, user, pwd):
    st, url, body = get(op, login_url)
    csrf = csrf_of(body)
    data = urllib.parse.urlencode({
        "csrfmiddlewaretoken": csrf, "username": user, "password": pwd,
    }).encode()
    req = urllib.request.Request(login_url, data=data, headers={
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": login_url, "Origin": LIVE,
    }, method="POST")
    try:
        r = op.open(req, timeout=15)
        return r.status, r.geturl(), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.geturl(), e.read().decode("utf-8", "replace")


def multipart_post(op, url, page_html, file_bytes, filename):
    """以 multipart/form-data 上傳 .pt（模擬瀏覽器檔案上傳）。"""
    csrf = csrf_of(page_html)
    boundary = "----FDEDEMOBoundary" + uuid.uuid4().hex
    parts = []
    parts.append(f"--{boundary}\r\n".encode())
    parts.append(b'Content-Disposition: form-data; name="csrfmiddlewaretoken"\r\n\r\n')
    parts.append((csrf or "").encode() + b"\r\n")
    parts.append(f"--{boundary}\r\n".encode())
    parts.append(
        f'Content-Disposition: form-data; name="model_file"; filename="{filename}"\r\n'.encode()
    )
    parts.append(b"Content-Type: application/octet-stream\r\n\r\n")
    parts.append(file_bytes + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    body = b"".join(parts)
    req = urllib.request.Request(url, data=body, headers={
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Referer": url, "Origin": LIVE,
    }, method="POST")
    try:
        r = op.open(req, timeout=30)
        return r.status, r.geturl(), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.geturl(), e.read().decode("utf-8", "replace")


def main():
    r = {}
    shared_password = read_shared_password()

    # --- 學員登入 ---
    cj, op = new_session()
    st, url, html = login(op, f"{LIVE}/login/", STUDENT_EMAIL, shared_password)
    r["student_login"] = {"status": st, "landed": url,
                          "pass": "/login/" not in url and any(c.name == "sessionid" for c in cj)}

    # --- 進入 R07 ---
    st, url, html = get(op, R07_URL)
    has_upload_form = "model_file" in html or "上傳" in html
    r["r07_open"] = {"status": st, "url": url, "has_form": has_upload_form,
                     "pass": st == 200 and "/login/" not in url}

    # --- 上傳 best.pt（DEMO_TEST_ONLY 佔位）---
    st, url, resp_html = multipart_post(op, R07_MODEL_URL, html, PLACEHOLDER, "best.pt")
    r["r07_upload"] = {"status": st, "landed": url}
    # 判斷成功訊息 / 錯誤訊息
    if "已提交" in resp_html or "等待教師審核" in resp_html:
        r["r07_upload"]["result"] = "SUBMITTED"
    elif "模型提交失敗" in resp_html:
        r["r07_upload"]["result"] = "FAILED_MESSAGE"
    else:
        r["r07_upload"]["result"] = "UNKNOWN"

    # --- 重新載入 R07，確認持久化 ---
    st2, url2, html2 = get(op, R07_URL)
    persisted = ("best.pt" in html2) or ("等待教師審核" in html2) or ("已提交" in html2)
    r["r07_persistence"] = {"status": st2, "shows_submission": persisted}

    # --- 登出再登入，確認仍可見 ---
    try:
        get(op, f"{LIVE}/logout/")
    except Exception:
        pass
    cj2, op2 = new_session()
    st3, url3, _ = login(op2, f"{LIVE}/login/", STUDENT_EMAIL, shared_password)
    st4, url4, html4 = get(op2, R07_URL)
    relogin_visible = ("best.pt" in html4) or ("等待教師審核" in html4) or ("已提交" in html4)
    r["r07_relogin_persistence"] = {"login_landed": url3, "status": st4,
                                    "shows_submission": relogin_visible,
                                    "pass": relogin_visible}

    # --- 教師登入，確認可看到學員模型 ---
    cj3, op3 = new_session()
    st5, url5, _ = login(op3, f"{LIVE}/teacher/login/", TEACHER_EMAIL, shared_password)
    st6, url6, tlist = get(op3, f"{LIVE}/teacher/vision-models/")
    # 教師模型列表或學員頁面應能找到該提交
    st7, url7, tenroll = get(op3, f"{LIVE}/teacher/enrollments/{ENROLLMENT_ID}/")
    found = ("best.pt" in tlist) or ("best.pt" in tenroll) or ("等待審核" in tlist) or ("R07" in tlist)
    r["teacher_sees_model"] = {
        "login_landed": url5,
        "vision_models_status": st6, "vision_models_url": url6,
        "enrollment_status": st7,
        "found": found,
        "pass": bool(found),
    }

    # --- 整體判定 ---
    ok_login = r["student_login"]["pass"]
    ok_upload = r["r07_upload"].get("result") == "SUBMITTED"
    ok_persist = r["r07_relogin_persistence"]["pass"]
    ok_teacher = r["teacher_sees_model"]["pass"]

    summary = {
        "STUDENT_LOGIN": "PASS" if ok_login else "FAIL",
        "R07_UPLOAD": "PASS" if ok_upload else "FAIL",
        "R07_PERSISTENCE": "PASS" if ok_persist else "FAIL",
        "TEACHER_SEES_MODEL": "PASS" if ok_teacher else "FAIL",
    }
    out = {"summary": summary, "detail": r}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
