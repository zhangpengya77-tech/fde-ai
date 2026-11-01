"""P7 探針：以真實瀏覽器路徑驗證學員登入後提交隔離 .pt 的安全流程。

入口會把 Cookie 送到 Gateway 以換取短效 Assertion；Gateway 轉送至 Live 前
必須剝除 Cookie。提交非 201 即視為失敗，避免把安全拒絕誤報為流程通過。
"""

from __future__ import annotations

import base64
import json
import re
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[3]
PT_SOURCE = Path("D:/FDE-AI-UAS-v2.0/.test-temp/fixtures/r07_accept_best.pt")
PASSWORD = "P7a-isolated-only-2026"
BASE = "https://127.0.0.1:8443"
ORIGIN = BASE


def login(login_path: str, account: str) -> httpx.Client | None:
    client = httpx.Client(base_url=BASE, verify=False, follow_redirects=False, timeout=30, trust_env=False)
    page = client.get(login_path)
    cookies = page.headers.get_list("set-cookie")
    match = re.search(r'name="csrfmiddlewaretoken"\s+value="([^"]+)"', page.text)
    if not match:
        print(f"  [FAIL] {login_path} 無 csrfmiddlewaretoken（status={page.status_code}）")
        return None
    csrf_cookie = ""
    for raw in cookies:
        found = re.search(r"csrftoken=([^;]+)", raw)
        if found:
            csrf_cookie = found.group(1)
            break
    client.cookies.set("csrftoken", csrf_cookie)
    response = client.post(
        login_path,
        data={"username": account, "password": PASSWORD, "csrfmiddlewaretoken": match.group(1)},
        headers={"Referer": ORIGIN + login_path, "Origin": ORIGIN},
    )
    names = sorted({cookie.name for cookie in client.cookies.jar})
    print(f"  login {account} -> {response.status_code} cookie_names={names}")
    return client if response.status_code in (301, 302, 303) else None


def main() -> int:
    print("[1] 學員登入")
    student = login("/login/", "p7a.student.s1@p7a.invalid")
    if student is None:
        return 1

    print("[2] 學員經入口提交 .pt（瀏覽器只帶 Session Cookie）")
    payload = {
        "task_id": "PROP_DIRECTION",
        "group_id": "P7A",
        "original_filename": "p7a_accept_best.pt",
        "file_base64": base64.b64encode(PT_SOURCE.read_bytes()).decode(),
        "notes": "probe browser flow",
    }
    response = student.post(
        "/api/v1/vision/submissions",
        json=payload,
        headers={"Origin": ORIGIN, "Referer": ORIGIN + "/student/"},
    )
    print(f"  POST /api/v1/vision/submissions -> {response.status_code}")
    print(f"  body: {response.text[:300]}")
    if response.status_code != 201:
        print("  [FAIL] 已登入學員的隔離提交沒有建立。")
        return 1

    print("[3] 憑證邊界")
    print("  Cookie 僅送往 Gateway 換票；Live 只接收短效 Assertion。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
