"""P7-B3 根因探針：Django 對 `/api/live/auth/assertion/` 的 CSRF 判定。

目的：把「Gateway 換 Assertion 一律 403」拆成兩個可分別驗證的因子——
      (a) `X-CSRFToken` 該送 cookie 密文還是遮罩後的 token；
      (b) `Origin` 是否必須落在 `CSRF_TRUSTED_ORIGINS` 內。

全程只讀：登入既有隔離帳號、呼叫既有端點，不寫任何業務資料。
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent
ENV_FILE = HERE.parent / "runtime" / "p7a.env"

BASE = "https://127.0.0.1:8443"          # 經 TLS 入口（等同瀏覽器）
DIRECT = "http://127.0.0.1:8120"          # 直連 Django（等同 Gateway）
HOST_HEADER = {"Host": "127.0.0.1:8120"}

ASSERTION_PATH = "/api/live/auth/assertion/"


def read_env() -> dict:
    values = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line.startswith("export "):
            continue
        name, _, value = line[len("export "):].partition("=")
        values[name.strip()] = value.strip().strip('"')
    return values


def masked_token(html: str) -> str:
    match = re.search(r'name="csrfmiddlewaretoken"\s+value="([^"]+)"', html)
    return match.group(1) if match else ""


def main() -> int:
    env = read_env()
    gateway_key = env.get("FDE_GATEWAY_INTERNAL_AUTH_KEY", "")
    password = env.get("P7A_SEED_PASSWORD", "")
    teacher = "p7a.teacher.a"

    results = []
    with httpx.Client(verify=False, timeout=20.0, follow_redirects=False) as client:
        landing = client.get(f"{BASE}/teacher/login/")
        landing_token = masked_token(landing.text)
        login = client.post(
            f"{BASE}/teacher/login/",
            data={"username": teacher, "password": password, "csrfmiddlewaretoken": landing_token},
            headers={"Referer": f"{BASE}/teacher/login/"},
        )
        results.append({"step": "teacher_login", "status": login.status_code,
                        "location": login.headers.get("location", "")})
        if login.status_code not in (301, 302):
            print(json.dumps(results, ensure_ascii=False, indent=2))
            return 1

        cookies = client.cookies
        csrf_cookie = cookies.get("csrftoken") or ""
        session_cookie = cookies.get("sessionid") or ""
        page = client.get(f"{BASE}/teacher/vision-center/")
        page_token = masked_token(page.text)
        results.append({
            "step": "tokens",
            "csrf_cookie_len": len(csrf_cookie),
            "masked_len": len(page_token),
            "session_present": bool(session_cookie),
        })

        cookie_header = f"csrftoken={csrf_cookie}; sessionid={session_cookie}"

        def probe(label, *, header_token, origin, send_cookie=True):
            headers = {"X-FDE-Gateway-Auth": gateway_key, "Accept": "application/json"}
            headers.update(HOST_HEADER)
            # 非 DEBUG 時 SECURE_SSL_REDIRECT 會把純 HTTP 導向 301；Gateway 也是走
            # 這條路（它直接連 8120），因此必須帶上與正式部署相同的轉發標頭。
            headers["X-Forwarded-Proto"] = "https"
            if send_cookie:
                headers["Cookie"] = cookie_header
            if header_token:
                headers["X-CSRFToken"] = header_token
            if origin:
                headers["Origin"] = origin
            response = httpx.post(
                f"{DIRECT}{ASSERTION_PATH}", headers=headers, json={}, timeout=20.0
            )
            body = response.text[:200]
            results.append({
                "step": label,
                "status": response.status_code,
                "origin": origin or "(none)",
                "token_kind": "masked" if header_token == page_token and header_token else (
                    "secret" if header_token == csrf_cookie and header_token else (
                        "none" if not header_token else "other")),
                "has_assertion": '"assertion"' in body,
                "body": body,
            })

        probe("A_no_token_cookie_only", header_token="", origin="https://127.0.0.1:8443")
        probe("B_secret_token_trusted_origin", header_token=csrf_cookie, origin="https://127.0.0.1:8443")
        probe("C_masked_token_trusted_origin", header_token=page_token, origin="https://127.0.0.1:8443")
        probe("D_secret_token_internal_origin", header_token=csrf_cookie, origin=DIRECT)
        probe("E_masked_token_internal_origin", header_token=page_token, origin=DIRECT)
        probe("F_masked_token_no_origin", header_token=page_token, origin="")
        probe("G_no_cookie_masked_token", header_token=page_token, origin="https://127.0.0.1:8443", send_cookie=False)

    print(json.dumps(results, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
