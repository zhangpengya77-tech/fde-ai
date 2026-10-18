"""FDE-AI-UAS 2.0｜PROP_DIRECTION_V1 本輪 DEMO 驗收。

依 2026-10-10 教師指令的 9 項驗收：
  1. 學員登入
  2. 教師登入
  3. R07 best.pt 上傳
  4. 教師 R07 與模型詳情
  5. 學員手機圖片上傳及預覽
  6. 教師測試頁面
  7. 六個下載檔案
  8. 未取得模型時正確顯示 BLOCKED
  9. 正式 1.5C 未受影響（由外部腳本檢查，本檔記錄）

全程走 DEMO :8111（經 Live Backend 反代 Django :8110）。
"""
from __future__ import annotations

import demo_credentials

import http.cookiejar
import io
import json
import re
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

BASE = "http://127.0.0.1:8111"
STUDENT = demo_credentials.student_credentials()
TEACHER = demo_credentials.teacher_credentials()
OUT = Path(r"D:\FDE-AI-UAS-v2.0\demo\runtime\logs\prop_scan_acceptance.json")
PROD_DB = Path(r"D:\FDE-AI-UAS-v2.0\student_portal\db.sqlite3")

results: dict = {}


def opener():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(jar),
        urllib.request.ProxyHandler({}),  # 關閉代理，避免 502 假象
    )


def get(op, path, timeout=30):
    req = urllib.request.Request(BASE + path, headers={"User-Agent": "fde-acceptance/1.0"})
    with op.open(req, timeout=timeout) as resp:
        return resp.status, resp.read().decode("utf-8", "replace"), resp.geturl()


def csrf_of(html: str) -> str:
    m = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', html)
    return m.group(1) if m else ""


def post_form(op, path, fields, timeout=60):
    _, html, _ = get(op, path)
    token = csrf_of(html)
    data = urllib.parse.urlencode(fields).encode()
    req = urllib.request.Request(BASE + path, data=data, headers={
        "User-Agent": "fde-acceptance/1.0",
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": BASE + path,
        "X-CSRFToken": token,
    })
    with op.open(req, timeout=timeout) as resp:
        return resp.status, resp.read().decode("utf-8", "replace"), resp.geturl()


def post_multipart(op, path, field_name, filename, content, content_type="application/octet-stream", extra=None, timeout=90):
    _, html, _ = get(op, path)
    token = csrf_of(html)
    boundary = "----FDEBoundary" + uuid.uuid4().hex
    body = io.BytesIO()

    def w(s):
        body.write(s.encode() if isinstance(s, str) else s)

    for key, value in (extra or {}).items():
        w(f"--{boundary}\r\n")
        w(f'Content-Disposition: form-data; name="{key}"\r\n\r\n')
        w(f"{value}\r\n")
    w(f"--{boundary}\r\n")
    w(f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\n')
    w(f"Content-Type: {content_type}\r\n\r\n")
    w(content)
    w(f"\r\n--{boundary}--\r\n")

    req = urllib.request.Request(BASE + path, data=body.getvalue(), headers={
        "User-Agent": "fde-acceptance/1.0",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Referer": BASE + path,
        "X-CSRFToken": token,
    })
    with op.open(req, timeout=timeout) as resp:
        return resp.status, resp.read().decode("utf-8", "replace"), resp.geturl()


import urllib.parse  # noqa: E402,F811 (保留給 post_form 使用)


# --- 1. 學員登入 ---
op_s = opener()
try:
    status, html, url = post_form(op_s, "/login/", {
        "username": STUDENT[0], "password": STUDENT[1],
    })
    ok = status == 200 and "/student/" in url
    results["1_STUDENT_LOGIN"] = {"status": status, "landed": url, "pass": ok}
except Exception as exc:
    results["1_STUDENT_LOGIN"] = {"pass": False, "error": str(exc)}

# --- 5. 學員手機圖片上傳及預覽（prop-scan 頁） ---
try:
    status, html, url = get(op_s, "/student/courses/1/prop-scan/")
    has_preview = 'id="preview-wrap"' in html
    has_upload = 'name="photo"' in html
    has_motor = all(f'name="motor_{m}"' in html for m in ("M1", "M2", "M3", "M4"))
    has_tts = "tts-play" in html and "語音朗讀結果" in html
    has_bbox_area = "辨識框" in html
    has_verdict_area = "判定結果" in html
    state_blocked = "BLOCKED" in html
    state_waiting = "WAITING_FOR_MODEL" in html
    no_fake = "本頁不會顯示模擬的檢測框、可信度或 PASS 結果" in html
    results["5_STUDENT_SCAN_PAGE"] = {
        "status": status, "landed": url,
        "has_upload": has_upload, "has_preview": has_preview, "has_motor_options": has_motor,
        "has_tts": has_tts, "has_bbox_area": has_bbox_area, "has_verdict_area": has_verdict_area,
        "declares_no_fake": no_fake,
        "pass": all([status == 200, has_upload, has_preview, has_motor, has_tts,
                     has_bbox_area, has_verdict_area, no_fake]),
    }
    results["8_BLOCKED_STATE"] = {
        "state_blocked": state_blocked, "state_waiting_for_model": state_waiting,
        "pass": state_blocked or state_waiting,
    }
except Exception as exc:
    results["5_STUDENT_SCAN_PAGE"] = {"pass": False, "error": str(exc)}
    results["8_BLOCKED_STATE"] = {"pass": False, "error": str(exc)}

# --- 5b. 上傳照片（未取得模型時不得產生 PASS/NG） ---
try:
    jpeg = b"\xff\xd8\xff\xe0" + b"\x00" * 200 + b"\xff\xd9"
    status, html, url = post_multipart(op_s, "/student/courses/1/prop-scan/",
                                       "photo", "prop-test.jpg", jpeg, "image/jpeg")
    no_pass = "PASS｜安裝正確" not in html
    no_ng = "NG｜安裝有誤" not in html
    blocked_msg = ("BLOCKED" in html) or ("WAITING_FOR_MODEL" in html) or ("無法" in html)
    results["5b_STUDENT_UPLOAD_BLOCKED"] = {
        "status": status, "no_fake_pass": no_pass, "no_fake_ng": no_ng,
        "shows_blocked": blocked_msg, "pass": all([status == 200, no_pass, no_ng, blocked_msg]),
    }
except Exception as exc:
    results["5b_STUDENT_UPLOAD_BLOCKED"] = {"pass": False, "error": str(exc)}

# --- 3. R07 best.pt 上傳 ---
try:
    placeholder = b"DEMO_TEST_ONLY\n" + uuid.uuid4().bytes
    # 注意：growth_model_upload 是 @require_POST，禁止先 GET。
    # 直接以 R07 詳情頁的 CSRF token 送出 multipart，避免 405。
    _, page_before, _ = get(op_s, "/student/courses/1/growth/R07/")
    token = csrf_of(page_before)
    boundary = "----FDEBoundary" + uuid.uuid4().hex
    body = io.BytesIO()

    def _w(s):
        body.write(s.encode() if isinstance(s, str) else s)

    _w(f"--{boundary}\r\n")
    _w('Content-Disposition: form-data; name="csrfmiddlewaretoken"\r\n\r\n')
    _w(f"{token}\r\n")
    _w(f"--{boundary}\r\n")
    _w('Content-Disposition: form-data; name="model_file"; filename="DEMO_TEST_ONLY_best.pt"\r\n')
    _w("Content-Type: application/octet-stream\r\n\r\n")
    _w(placeholder)
    _w(f"\r\n--{boundary}--\r\n")

    req = urllib.request.Request(
        BASE + "/student/courses/1/growth/R07/model/",
        data=body.getvalue(),
        headers={
            "User-Agent": "fde-acceptance/1.0",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Referer": BASE + "/student/courses/1/growth/R07/",
            "Origin": BASE,
        },
        method="POST",
    )
    try:
        with op_s.open(req, timeout=90) as resp:
            status, landed = resp.status, resp.geturl()
    except urllib.error.HTTPError as exc:
        status, landed = exc.code, exc.geturl()

    _, page, _ = get(op_s, "/student/courses/1/growth/R07/")
    submitted = ("等待教師審核" in page) or ("已列為候選" in page) or ("已提交" in page)
    updated = "DEMO_TEST_ONLY_best.pt" in page
    # 三種都算成功：① 顯示提交狀態 ② 頁面出現檔名 ③ 302 導回 R07（表單通過並已落盤）
    landed_ok = landed.rstrip("/").endswith("/growth/R07")
    passed = status in (200, 302) and (submitted or updated or landed_ok)
    results["3_R07_UPLOAD"] = {
        "status": status, "landed": landed, "shows_submission": submitted,
        "shows_filename": updated, "no_405": status != 405, "pass": passed,
    }
except Exception as exc:
    results["3_R07_UPLOAD"] = {"pass": False, "error": str(exc)}

# --- 2. 教師登入 ---
op_t = opener()
try:
    status, html, url = post_form(op_t, "/teacher/login/", {
        "username": TEACHER[0], "password": TEACHER[1],
    })
    ok = status == 200 and "/teacher/" in url
    results["2_TEACHER_LOGIN"] = {"status": status, "landed": url, "pass": ok}
except Exception as exc:
    results["2_TEACHER_LOGIN"] = {"pass": False, "error": str(exc)}

# --- 4. 教師 R07 與模型詳情；6. 教師測試頁 ---
try:
    status, html, url = get(op_t, "/teacher/vision-models/")
    links = re.findall(r'/teacher/vision-models/([0-9a-f\-]{36})/', html)
    results["4_TEACHER_MODEL_LIST"] = {
        "status": status, "landed": url, "model_count": len(set(links)),
        "pass": status == 200 and len(links) > 0,
    }
    if links:
        eid = sorted(set(links))[0]
        s2, detail, u2 = get(op_t, f"/teacher/vision-models/{eid}/")
        has_test_link = f"/teacher/vision-models/{eid}/verify/" in detail
        results["4_TEACHER_MODEL_DETAIL"] = {
            "status": s2, "landed": u2, "has_image_test_link": has_test_link,
            "pass": s2 == 200 and has_test_link,
        }
        s3, verify, u3 = get(op_t, f"/teacher/vision-models/{eid}/verify/")
        v_blocked = "BLOCKED" in verify
        v_waiting = "WAITING_FOR_MODEL" in verify
        v_disabled = 'disabled aria-disabled="true"' in verify
        v_no_fake = "本頁不會載入學員 .pt，也不會產生任何模擬辨識結果" in verify
        results["6_TEACHER_TEST_PAGE"] = {
            "status": s3, "landed": u3,
            "state_blocked": v_blocked, "state_waiting": v_waiting,
            "button_disabled": v_disabled, "declares_no_fake": v_no_fake,
            "pass": s3 == 200 and (v_blocked or v_waiting) and v_disabled and v_no_fake,
        }
    else:
        results["4_TEACHER_MODEL_DETAIL"] = {"pass": False, "error": "no model evidence found"}
        results["6_TEACHER_TEST_PAGE"] = {"pass": False, "error": "no model evidence found"}
except Exception as exc:
    results["4_TEACHER_MODEL_LIST"] = {"pass": False, "error": str(exc)}
    results["6_TEACHER_TEST_PAGE"] = {"pass": False, "error": str(exc)}

# --- 7. 六個下載檔案 ---
try:
    status, body, url = get(op_t, "/api/downloads")
    payload = json.loads(body)
    items = payload.get("downloads") or payload.get("items") or []
    names = [str(i.get("name") or i.get("filename") or i.get("id")) for i in items]
    results["7_DOWNLOADS"] = {
        "status": status, "count": len(items), "names": names,
        "pass": status == 200 and len(items) == 6,
    }
except Exception as exc:
    results["7_DOWNLOADS"] = {"pass": False, "error": str(exc)}

# --- 9. 正式 1.5C 未受影響 ---
try:
    mtime = PROD_DB.stat().st_mtime if PROD_DB.exists() else None
    import datetime
    results["9_PROD_UNTOUCHED"] = {
        "prod_db_exists": PROD_DB.exists(),
        "prod_db_mtime": datetime.datetime.fromtimestamp(mtime).isoformat() if mtime else None,
        "prod_db_sha_note": "本輪未寫入正式 DB；mtime 應維持 2026-10-07",
        "pass": mtime is not None and datetime.datetime.fromtimestamp(mtime).date().isoformat() <= "2026-10-07",
    }
except Exception as exc:
    results["9_PROD_UNTOUCHED"] = {"pass": False, "error": str(exc)}

passed = sum(1 for v in results.values() if v.get("pass"))
total = len(results)
summary = {"passed": passed, "total": total}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps({"summary": summary, "results": results}, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(summary, ensure_ascii=False))
for key, value in results.items():
    print(f"{'PASS' if value.get('pass') else 'FAIL'}  {key}  {json.dumps({k: v for k, v in value.items() if k != 'pass'}, ensure_ascii=False)[:220]}")
