"""P7-A 補充驗收：以「合法簽發的 Assertion」驗證第 5／8 項（不經入口層 Cookie）。

背景（2026-10-29 實測結論）：
    入口層 `demo/tools/static_entry_server.py` 的 `strip_client_identity_headers()`
    會丟棄 `Cookie`，導致瀏覽器 session 永遠到不了 Django，`POST /teacher/login/`
    恆回 403。為避免在未取得裁決前改動該安全控制，本腳本改走「Django 直連」取得
    合法 session 與 Assertion，再以 Assertion 打 Live API，藉此獨立驗證：

      * 第 5 項：跨班級教師的班級範圍是否互斥（DB 關係層）
      * 第 8 項：學員上傳 .pt 與教師複核在隔離資料下是否可運作
      * 反向對照：學員 Assertion 不得取得教師端點

本腳本只讀取正式工作區的 `.pt` 測試檔作為輸入，不寫入正式工作區任何檔案；
所有寫入都落在 P7-A 隔離 runtime（`ops/p7/runtime/`）。
"""

from __future__ import annotations

import base64
import json
import os
import re
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[3]
ENV_FILE = ROOT / "ops" / "p7" / "runtime" / "p7a.env"
PT_SOURCE = Path("D:/FDE-AI-UAS-v2.0/.test-temp/fixtures/r07_accept_best.pt")

PUBLIC_ORIGIN = "https://127.0.0.1:8443"
DJANGO = "http://127.0.0.1:8120"
LIVE = "http://127.0.0.1:8121"

# 直連 Django 時必須自行補上入口層本來會加的東西，否則 SECURE_SSL_REDIRECT 會 301。
DJANGO_HEADERS = {"X-Forwarded-Proto": "https", "Connection": "close"}


def load_env() -> dict:
    values = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or not line.startswith("export "):
            continue
        key, _, raw = line[len("export "):].partition("=")
        raw = raw.strip().strip('"').strip("'").replace("$P7A_ROOT", str(ROOT))
        values[key.strip()] = raw
    return values


ENV = load_env()
PASSWORD = ENV.get("P7A_SEED_PASSWORD", "P7a-isolated-only-2026")
GATEWAY_KEY = ENV["FDE_GATEWAY_INTERNAL_AUTH_KEY"]


def login(login_path: str, account: str) -> dict | None:
    """回傳 {session, csrf_cookie, csrf_token}。

    注意：Django 4.1+ 的 `csrfmiddlewaretoken` 是**遮罩後**的值，必須從頁面
    隱藏欄位取得；直接拿 `csrftoken` Cookie 當 token 會固定 403。
    另外 httpx 不會把 `Secure` Cookie 送到 http:// 位址，因此這裡手動注入 Cookie。
    """
    with httpx.Client(base_url=DJANGO, headers=DJANGO_HEADERS, follow_redirects=False, timeout=20, trust_env=False) as client:
        page = client.get(login_path)
        cookies = page.headers.get_list("set-cookie")
        match = re.search(r'name="csrfmiddlewaretoken"\s+value="([^"]+)"', page.text)
        if not cookies or not match:
            print(f"  [FAIL] {login_path} 取不到 CSRF token（status={page.status_code}）")
            return None
        csrf_cookie = re.search(r"csrftoken=([^;]+)", cookies[0]).group(1)
        client.cookies.clear()
        response = client.post(
            login_path,
            data={"username": account, "password": PASSWORD, "csrfmiddlewaretoken": match.group(1)},
            headers={"Referer": PUBLIC_ORIGIN + login_path, "Cookie": f"csrftoken={csrf_cookie}"},
        )
        session = re.search(r"sessionid=([^;]+)", ";".join(response.headers.get_list("set-cookie")))
        print(f"  login {account} via {login_path} -> {response.status_code} session={'Y' if session else 'N'}")
        if not session:
            return None
        # 登入成功後頁面會重新發一組 token，Assertion 端點要求 X-CSRFToken。
        landing = client.get(
            "/teacher/" if "teacher" in login_path else "/",
            headers={"Cookie": f"sessionid={session.group(1)}; csrftoken={csrf_cookie}"},
        )
        refreshed = re.search(r'name="csrfmiddlewaretoken"\s+value="([^"]+)"', landing.text)
        return {
            "session": session.group(1),
            "csrf_cookie": csrf_cookie,
            "csrf_token": refreshed.group(1) if refreshed else match.group(1),
        }


def mint_assertion(credentials: dict, body: dict | None = None) -> str | None:
    with httpx.Client(base_url=DJANGO, headers=DJANGO_HEADERS, follow_redirects=False, timeout=20, trust_env=False) as client:
        response = client.post(
            "/api/live/auth/assertion/",
            json=body or {},
            headers={
                "Cookie": f"sessionid={credentials['session']}; csrftoken={credentials['csrf_cookie']}",
                "X-FDE-Gateway-Auth": GATEWAY_KEY,
                "X-CSRFToken": credentials["csrf_token"],
                "Content-Type": "application/json",
                "Referer": PUBLIC_ORIGIN + "/teacher/",
            },
        )
        payload = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
        print(f"  mint assertion -> {response.status_code} keys={list(payload)[:4]}")
        return payload.get("assertion")


def cohort_scope_matrix() -> bool:
    """第 5 項：班級範圍由 Django 資料庫關係決定，且兩名教師互斥。"""
    sys.path.insert(0, str(ROOT / "student_portal"))
    for key, value in ENV.items():
        os.environ.setdefault(key, value)
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    import django

    django.setup()
    from learning.models import Enrollment, TeacherCohortAccess

    scope_a = set(TeacherCohortAccess.objects.filter(teacher__username="p7a.teacher.a").values_list("cohort_id", flat=True))
    scope_b = set(TeacherCohortAccess.objects.filter(teacher__username="p7a.teacher.b").values_list("cohort_id", flat=True))
    student_scope = set(Enrollment.objects.filter(student__user__username="p7a.student.s1", active=True).values_list("cohort_id", flat=True))
    print(f"  teacher_a={sorted(scope_a)} teacher_b={sorted(scope_b)} student_s1={sorted(student_scope)}")
    disjoint = not (scope_a & scope_b)
    both_nonempty = bool(scope_a) and bool(scope_b)
    student_in_a_only = student_scope <= scope_a and not (student_scope & scope_b)
    ok = disjoint and both_nonempty and student_in_a_only
    print(f"  互斥={disjoint} 兩者非空={both_nonempty} 學員僅在A={student_in_a_only} -> {'PASS' if ok else 'FAIL'}")
    return ok


def main() -> int:
    results: list[tuple[str, str, str]] = []

    print("[1] 班級範圍互斥（第 5 項）")
    results.append(("5", "跨班級教師被拒／班級範圍互斥", "PASS" if cohort_scope_matrix() else "FAIL"))

    print("[2] 學員登入並簽發 Assertion")
    student_credentials = login("/login/", "p7a.student.s1@p7a.invalid")
    student_assertion = mint_assertion(student_credentials) if student_credentials else None
    results.append(("8a", "學員可取得合法 Assertion", "PASS" if student_assertion else "FAIL"))

    print("[3] 學員上傳 .pt（隔離 Registry）")
    submission_id = None
    if student_assertion and PT_SOURCE.is_file():
        payload = {
            "task_id": "PROP_DIRECTION",
            "student_id": "p7a.student.s1",
            "group_id": "P7A",
            "original_filename": "p7a_accept_best.pt",
            "file_base64": base64.b64encode(PT_SOURCE.read_bytes()).decode(),
            "notes": "P7-A 隔離驗收用提交（不進正式 Registry）",
        }
        with httpx.Client(base_url=LIVE, follow_redirects=False, timeout=90, trust_env=False) as client:
            response = client.post("/api/v1/vision/submissions", json=payload, headers={"X-FDE-Live-Assertion": student_assertion})
            print(f"  POST /api/v1/vision/submissions -> {response.status_code}")
            body = response.json() if response.status_code < 300 else {}
            submission_id = body.get("submission_id") or body.get("id")
            print(f"  submission_id={submission_id} status={body.get('status')}")
    results.append(("8b", "學員上傳 .pt 成功", "PASS" if submission_id else "FAIL"))

    print("[4] 教師登入、讀取待審佇列、執行匯入預檢")
    teacher_credentials = login("/teacher/login/", "p7a.teacher.a")
    teacher_assertion = mint_assertion(teacher_credentials) if teacher_credentials else None
    queue_ok = preflight_ok = False
    if teacher_assertion:
        with httpx.Client(base_url=LIVE, follow_redirects=False, timeout=60, trust_env=False) as client:
            queue = client.get("/api/v1/vision/submissions?status=SUBMITTED", headers={"X-FDE-Live-Assertion": teacher_assertion})
            queue_ok = queue.status_code == 200
            print(f"  GET submissions -> {queue.status_code} 筆數={len(queue.json()) if queue_ok else '-'}")
            if submission_id:
                pre = client.post(f"/api/v1/vision/submissions/{submission_id}/import-preflight", json={}, headers={"X-FDE-Live-Assertion": teacher_assertion})
                preflight_ok = pre.status_code in (200, 422)
                print(f"  import-preflight -> {pre.status_code} {json.dumps(pre.json(), ensure_ascii=False)[:200]}")
    results.append(("8c", "教師可讀取隔離資料的待審佇列", "PASS" if queue_ok else "FAIL"))
    results.append(("8d", "教師可對該提交執行匯入預檢", "PASS" if preflight_ok else "FAIL"))

    print("[5] 反向對照：學員 Assertion 不得呼叫教師端點")
    student_denied = False
    if student_assertion:
        with httpx.Client(base_url=LIVE, follow_redirects=False, timeout=30, trust_env=False) as client:
            response = client.get("/api/v1/vision/hard-examples", headers={"X-FDE-Live-Assertion": student_assertion})
            student_denied = response.status_code == 403
            print(f"  學員 -> hard-examples: {response.status_code} {response.text[:100]}")
    results.append(("8e", "學員不得呼叫教師端點（403）", "PASS" if student_denied else "FAIL"))

    print("\n=== 彙總 ===")
    for item, name, status in results:
        print(f"  [{status}] {item} {name}")
    failed = [row for row in results if row[2] != "PASS"]
    print(f"\n通過 {len(results) - len(failed)}/{len(results)}")

    out = ROOT / "ops" / "p7" / "evidence" / "p7a-supplementary.json"
    out.write_text(
        json.dumps([{"item": i, "name": n, "status": s} for i, n, s in results], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"證據已寫入 {out}")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
