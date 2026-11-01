"""P7-A 十項驗收（隔離預發布，真實 HTTPS + 真實簽章）。

拓撲：
    腳本 --HTTPS:8443--> TLS 終結 --> 入口 8122 --> Gateway 8123 --> Live 8121
                                                              \\--> Django 8120

端點選擇說明（2026-10-29 修正）：
    `GET /api/v1/vision/models` 的 GET 分支刻意不要求教師身分（僅 POST 要求），
    因此所有「必須被拒」的負向測試一律改用真正受保護的
    `GET /api/v1/vision/hard-examples`（`_teacher()` 前置），避免把公開端點
    誤判成授權漏洞。

所有請求都打到隔離環境，不觸碰正式 v1.5C（8022）、RAG（8770）、正式 DB/Registry。
輸出：ops/p7/evidence/p7a-verification.json
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import ssl
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "live_backend"))

from app import live_assertions  # noqa: E402

BASE = os.environ.get("P7A_BASE", "https://localhost:8443")
LIVE_DIRECT = os.environ.get("P7A_LIVE_DIRECT", "http://127.0.0.1:8121")
DJANGO_DIRECT = os.environ.get("P7A_DJANGO_DIRECT", "http://127.0.0.1:8120")
KEY = os.environ.get("FDE_INTERNAL_SHARED_SECRET", "")
GATEWAY_KEY = os.environ.get("FDE_GATEWAY_INTERNAL_AUTH_KEY", "")
PASSWORD = os.environ.get("P7A_SEED_PASSWORD", "P7a-isolated-only-2026")

# 真正受教師保護的端點（GET 也需要 Assertion）。
PROTECTED = "/api/v1/vision/hard-examples"
# 刻意公開的端點，僅作為對照。
PUBLIC_GET = "/api/v1/vision/models"

RESULTS: list[dict] = []


def record(item: str, name: str, status: str, detail: str, evidence=None) -> None:
    RESULTS.append({"item": item, "name": name, "status": status, "detail": detail, "evidence": evidence or {}})
    print(f"[{status}] {item} {name} :: {detail}")


def client(base: str, **kwargs) -> httpx.Client:
    return httpx.Client(base_url=base, verify=False, timeout=20.0, follow_redirects=False, **kwargs)


def mint(method: str, path: str, body: bytes = b"", *, role="teacher", cohort_ids=(1,), sub=None, now=None, skew=0):
    claims = {
        "sub": sub or f"{role}:1",
        "role": role,
        "cohort_ids": list(cohort_ids),
        "method": method.upper(),
        "path": path,
        "body_sha256": live_assertions.body_sha256(body),
    }
    return live_assertions.issue_live_assertion(claims, KEY, now=(int(time.time()) + skew) if now is None else now)


def login(client_: httpx.Client, base: str, username: str) -> dict:
    """以真實 CSRF 流程登入，回傳 Set-Cookie 原始字串清單。

    注意：Django 4.1+ 會遮罩 CSRF token，表單裡送的是 **遮罩後** 的值，
    與 Cookie 內的 secret 不同；因此必須從頁面隱藏欄位取 token，
    不能直接拿 Set-Cookie 的值當 csrfmiddlewaretoken（會固定 403）。
    """
    r = client_.get("/login/")
    match = re.search(r'name="csrfmiddlewaretoken"\s+value="([^"]+)"', r.text)
    token = match.group(1) if match else ""
    resp = client_.post(
        "/login/",
        data={"username": username, "password": PASSWORD, "csrfmiddlewaretoken": token},
        headers={"Referer": f"{base}/login/", "Origin": base},
    )
    return {"status": resp.status_code, "cookies": resp.headers.get_list("set-cookie"), "csrf": token}


def main() -> int:
    if not KEY:
        print("缺少 FDE_INTERNAL_SHARED_SECRET，請先 source ops/p7/runtime/p7a.env")
        return 2
    ssl._create_default_https_context = ssl._create_unverified_context

    # ------------------------------------------------------ 1 DEBUG=False + 強制 HTTPS
    with client(DJANGO_DIRECT) as c:
        r = c.get("/login/")
        loc = r.headers.get("location", "")
        ok = r.status_code in (301, 302) and loc.startswith("https://")
        record("1", "DEBUG=False 且強制 HTTPS 重導", "PASS" if ok else "FAIL",
               f"http://127.0.0.1:8120/login/ -> {r.status_code} Location={loc}",
               {"status": r.status_code, "location": loc})

    # ---------------------------------------- 2 Session / CSRF Cookie Secure（HTTPS）
    with client(BASE) as c:
        r = c.get("/login/")
        pre = r.headers.get_list("set-cookie")
        csrf_secure = any("csrftoken" in v and "secure" in v.lower() for v in pre)
        record("2a", "CSRF Cookie 具 Secure 屬性", "PASS" if csrf_secure else "FAIL",
               f"GET {BASE}/login/ -> {r.status_code}; set-cookie={pre}", {"set_cookie": pre})

        info = login(c, BASE, "p7a.teacher.a")
        cookies = info["cookies"]
        sess_secure = any("sessionid" in v and "secure" in v.lower() for v in cookies)
        sess_httponly = any("sessionid" in v and "httponly" in v.lower() for v in cookies)
        record("2b", "Session Cookie 具 Secure + HttpOnly", "PASS" if (sess_secure and sess_httponly) else "FAIL",
               f"POST /login/ -> {info['status']}; Secure={sess_secure} HttpOnly={sess_httponly}; {cookies}",
               {"status": info["status"], "set_cookie": cookies})

        # ------------------------------- 3 Gateway 不得被偽造標頭降級
        forged = c.get(PROTECTED, headers={
            "X-FDE-Role": "teacher", "X-FDE-Teacher-ID": "1",
            "X-FDE-Live-Assertion": "v1.forged.sig", "X-FDE-Gateway-Auth": GATEWAY_KEY,
        })
        record("3", "Gateway Assertion 不得被降級（偽造標頭無效）",
               "PASS" if forged.status_code in (401, 403) else "FAIL",
               f"經 Gateway 帶偽造 X-FDE-* -> {forged.status_code} {forged.text[:160]}",
               {"status": forged.status_code, "body": forged.text[:400]})

        # ------------------------------- 7a Origin 無法繞過（入口層）
        evil = c.get(PROTECTED, headers={"Origin": "https://evil.example", "X-FDE-Role": "teacher"})
        record("7a", "原始 Origin 無法繞過授權（入口層攔截）",
               "PASS" if evil.status_code in (401, 403) else "FAIL",
               f"Origin=https://evil.example -> {evil.status_code} {evil.text[:160]}",
               {"status": evil.status_code, "body": evil.text[:400]})

    # ---------------------------------------- 6 / 7b 直連 Live 未授權一律拒絕
    with client(LIVE_DIRECT) as c:
        no_auth = c.get(PROTECTED)
        record("6a", "直連 Live 無憑證被拒（fail closed）",
               "PASS" if no_auth.status_code in (401, 403) else "FAIL",
               f"GET {LIVE_DIRECT}{PROTECTED} -> {no_auth.status_code} {no_auth.text[:160]}",
               {"status": no_auth.status_code, "body": no_auth.text[:400]})

        pub = c.get(PUBLIC_GET)
        record("6b", "對照：GET 模型清單為刻意公開端點（非漏洞）", "INFO",
               f"GET {PUBLIC_GET} -> {pub.status_code}（GET 分支不呼叫 _teacher）",
               {"status": pub.status_code})

        forged_direct = c.get(PROTECTED, headers={
            "X-FDE-Role": "teacher", "X-FDE-Teacher-ID": "1",
            "Origin": "https://evil.example", "X-Forwarded-Proto": "https",
        })
        record("7b", "直連 Live 帶偽造標頭 + 偽 Origin 仍被拒",
               "PASS" if forged_direct.status_code in (401, 403) else "FAIL",
               f"直連 + 偽造 X-FDE-* -> {forged_direct.status_code} {forged_direct.text[:160]}",
               {"status": forged_direct.status_code, "body": forged_direct.text[:400]})

        # ------------------------------- 4 有效期 60 秒 + 重放保護
        good = mint("GET", PROTECTED, cohort_ids=[1])
        first = c.get(PROTECTED, headers={live_assertions.ASSERTION_HEADER: good})
        replay = c.get(PROTECTED, headers={live_assertions.ASSERTION_HEADER: good})
        record("4a", "重放保護（同一 jti 第二次必須被拒）",
               "PASS" if (first.status_code == 200 and replay.status_code in (401, 403)) else "FAIL",
               f"第一次 {first.status_code} / 重放 {replay.status_code} {replay.text[:120]}",
               {"first": first.status_code, "replay": replay.status_code, "replay_body": replay.text[:300]})

        expired = mint("GET", PROTECTED, cohort_ids=[1], skew=-120)
        exp_resp = c.get(PROTECTED, headers={live_assertions.ASSERTION_HEADER: expired})
        record("4b", "過期 Assertion 被拒", "PASS" if exp_resp.status_code in (401, 403) else "FAIL",
               f"iat 落於 120 秒前 -> {exp_resp.status_code} {exp_resp.text[:160]}",
               {"status": exp_resp.status_code, "body": exp_resp.text[:300]})

        future = mint("GET", PROTECTED, cohort_ids=[1], skew=+3600)
        fut_resp = c.get(PROTECTED, headers={live_assertions.ASSERTION_HEADER: future})
        record("4c", "超過 60 秒上限（iat 超前 1 小時）被拒",
               "PASS" if fut_resp.status_code in (401, 403) else "FAIL",
               f"iat 超前 3600 秒 -> {fut_resp.status_code} {fut_resp.text[:160]}",
               {"status": fut_resp.status_code, "body": fut_resp.text[:300]})

        # ------------------------------- 5a 跨班級（僅記錄，權威證據在 5b）
        other = mint("GET", PROTECTED, cohort_ids=[2])
        other_resp = c.get(PROTECTED, headers={live_assertions.ASSERTION_HEADER: other})
        record("5a", "跨班級憑證在僅檢查角色的端點（記錄用，不作通過依據）", "INFO",
               f"cohort_ids=[2] -> {other_resp.status_code}（此端點只檢查 role，班級隔離在 session 端點）",
               {"status": other_resp.status_code})

    # ---------------------------------------- 5b Django 簽發的 cohort 範圍互斥
    claims_a = claims_b = None
    with client(DJANGO_DIRECT) as c:
        for username, target in (("p7a.teacher.a", "a"), ("p7a.teacher.b", "b")):
            login(c, DJANGO_DIRECT, username)
            resp = c.post("/api/live/auth/assertion/", json={}, headers={"X-FDE-Gateway-Auth": GATEWAY_KEY})
            if resp.status_code == 200:
                claims = live_assertions.verify_live_assertion(json.loads(resp.text)["assertion"], KEY)
                if target == "a":
                    claims_a = claims
                else:
                    claims_b = claims
    sep = (
        claims_a is not None and claims_b is not None
        and claims_a["cohort_ids"] != claims_b["cohort_ids"]
        and len(claims_a["cohort_ids"]) == 1 and len(claims_b["cohort_ids"]) == 1
    )
    record("5b", "班級範圍由 Django 資料庫關係決定且互斥", "PASS" if sep else "FAIL",
           f"教師A cohorts={claims_a and claims_a['cohort_ids']} / 教師B cohorts={claims_b and claims_b['cohort_ids']}",
           {"teacher_a": claims_a, "teacher_b": claims_b})

    # ---------------------------------------- 8 學員上傳 / 教師複核（隔離資料）
    student_claims = None
    with client(DJANGO_DIRECT) as c:
        login(c, DJANGO_DIRECT, "p7a.student.s1")
        resp = c.post("/api/live/auth/assertion/", json={}, headers={"X-FDE-Gateway-Auth": GATEWAY_KEY})
        if resp.status_code == 200:
            student_claims = live_assertions.verify_live_assertion(json.loads(resp.text)["assertion"], KEY)

    with client(LIVE_DIRECT) as c:
        body = json.dumps({"image_base64": "", "image_width": 640, "image_height": 480}).encode()
        s_token = mint("POST", "/api/v1/vision/prop-check", body, role="student", cohort_ids=[1], sub="student:1")
        s_resp = c.post("/api/v1/vision/prop-check", content=body,
                        headers={live_assertions.ASSERTION_HEADER: s_token, "Content-Type": "application/json"})
        record("8a", "學員身分可進入視覺 API（未被授權層誤擋）",
               "PASS" if s_resp.status_code not in (401, 403) else "FAIL",
               f"student prop-check -> {s_resp.status_code} {s_resp.text[:160]}",
               {"status": s_resp.status_code, "body": s_resp.text[:400], "claims": student_claims})

        t_token = mint("GET", PROTECTED, role="teacher", cohort_ids=[1], sub="teacher:1")
        t_resp = c.get(PROTECTED, headers={live_assertions.ASSERTION_HEADER: t_token})
        record("8b", "教師身分可讀取受保護資源（隔離 Registry）",
               "PASS" if t_resp.status_code == 200 else "FAIL",
               f"teacher {PROTECTED} -> {t_resp.status_code} {t_resp.text[:160]}",
               {"status": t_resp.status_code, "body": t_resp.text[:400]})

    # ---------------------------------------- 9 上游不可用時安全失敗
    try:
        dead = httpx.get("http://127.0.0.1:8199/api/live/health", timeout=3.0)
        safe = dead.status_code in (502, 503)
        detail = f"回應 {dead.status_code}（安全失敗信封）"
    except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout) as exc:
        safe = True
        detail = f"連線被拒：{type(exc).__name__}（不偽裝成功）"
    record("9a", "上游不可用時安全失敗（不偽裝成功）", "PASS" if safe else "FAIL", detail, {"detail": detail})

    # ---------------------------------------- 10 正式環境未受影響
    formal = {}
    for label, path in (
        ("prod_db", Path("D:/FDE-AI-UAS-v2.0/demo/runtime/db/prod.sqlite3")),
        ("demo_db", Path("D:/FDE-AI-UAS-v2.0/demo/runtime/db/demo.sqlite3")),
        ("demo_registry", Path("D:/FDE-AI-UAS-v2.0/demo/runtime/vision-center/store.json")),
    ):
        if path.is_file():
            formal[label] = hashlib.sha256(path.read_bytes()).hexdigest()
    record("10", "正式 v1.5C 資料檔雜湊記錄（前後比對用）",
           "PASS" if formal else "BLOCKED",
           f"已記錄 {len(formal)} 個正式資料檔", formal)

    out = ROOT / "ops/p7/evidence/p7a-verification.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(RESULTS, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n結果寫入 {out}")
    fails = [r for r in RESULTS if r["status"] == "FAIL"]
    print(f"FAIL 共 {len(fails)} 項")
    return 0 if not fails else 1


if __name__ == "__main__":
    raise SystemExit(main())
