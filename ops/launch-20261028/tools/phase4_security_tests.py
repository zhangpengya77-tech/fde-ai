"""FDE-AI 2.0 上線收尾第四階段 — P-01 ~ P-16 安全與 YOLO 整合測試。

全部針對「隔離棧」執行：
  Django  127.0.0.1:18110
  Live    127.0.0.1:18111（已啟用 FDE_INTERNAL_SHARED_SECRET 簽章模式）
  DB / MEDIA / Registry 皆為 ops/launch-20261028/isolated-phase4 下的副本。

隔離資料（由 seed_phase4_cohorts.py 建立）：
  班級 A  F450-DEMO-2026  教師 A = demo.teacher@fde-demo.local   學員 A = demo.student01@fde-demo.local
  班級 B  2026-99         教師 B = phase4.teacherB@fde-demo.local 學員 B = phase4.studentB@fde-demo.local
  教師 C  phase4.teacherC@fde-demo.local（刻意不指派任何班級）

用法：
  set FDE_INTERNAL_SHARED_SECRET=<與隔離棧相同>
  python phase4_security_tests.py
"""

from __future__ import annotations

import hashlib
import http.cookiejar
import json
import mimetypes
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS_DIR)
PROJECT_ROOT = os.path.dirname(os.path.dirname(ROOT))
sys.path.insert(0, os.path.join(PROJECT_ROOT, "student_portal"))
from learning import internal_auth  # noqa: E402

ISO = os.environ.get("FDE_E2E_RUN_ROOT") or os.path.join(ROOT, "isolated-phase4")
BASE = "http://127.0.0.1:18110"
LIVE = "http://127.0.0.1:18111"

PASSWORD = "zYpy8gr4p9NDRQqV"
TEACHER_A = "demo.teacher@fde-demo.local"
TEACHER_B = "phase4.teacherB@fde-demo.local"
TEACHER_C = "phase4.teacherC@fde-demo.local"
STUDENT_A = "demo.student01@fde-demo.local"
STUDENT_B = "phase4.studentB@fde-demo.local"

ENROLLMENT_A = 1
ENROLLMENT_B = 3
TASK_ID = "PROP_DIRECTION"
TEACHER_A_ID = 2
TEACHER_B_ID = 6
TEACHER_C_ID = 7

MODEL_PT = os.path.join(
    ISO, "vision-center", "model_registry", "prop_direction",
    "PROP_20261024_DEMO-A_v1", "best.pt",
)
GOLDEN = os.path.join(ROOT, "test-images")
IMG_1 = os.path.join(GOLDEN, "prop_real_01.jpg")
IMG_2 = os.path.join(GOLDEN, "prop_real_02.jpg")

# 正式（非隔離）資源指紋：P-16 用，前後必須完全一致
PRODUCTION_PATHS = {
    "prod_db": os.path.join(PROJECT_ROOT, "student_portal", "db.sqlite3"),
    "demo_db": os.path.join(PROJECT_ROOT, "demo", "runtime", "db", "demo.sqlite3"),
    "demo_registry": os.path.join(PROJECT_ROOT, "demo", "runtime", "vision-center", "vision_center.json"),
    "default_registry": os.path.join(
        os.environ.get("LOCALAPPDATA", ""), "FDE-AI-UAS", "vision-center", "vision_center.json"
    ),
}

results: list[dict] = []


def record(code: str, name: str, ok: bool, evidence: dict) -> None:
    results.append({"id": code, "name": name, "pass": bool(ok), "evidence": evidence})
    print(f"[{'PASS' if ok else 'FAIL'}] {code} {name}")


def sha256_file(path: str) -> str:
    if not os.path.exists(path):
        return ""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


# ---------------------------------------------------------------------------
# HTTP 會話
# ---------------------------------------------------------------------------
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Session:
    def __init__(self) -> None:
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar), NoRedirect()
        )

    def csrf(self) -> str:
        for cookie in self.jar:
            if cookie.name == "csrftoken":
                return cookie.value
        return ""

    def get(self, path: str, headers: dict | None = None):
        req = urllib.request.Request(BASE + path, method="GET")
        for key, value in (headers or {}).items():
            req.add_header(key, value)
        return self._do(req)

    def post(self, path: str, fields: dict, files: dict | None = None, headers: dict | None = None):
        data, ctype = _encode(fields, files)
        req = urllib.request.Request(BASE + path, data=data, method="POST")
        req.add_header("Content-Type", ctype)
        req.add_header("Referer", BASE + path)
        req.add_header("X-CSRFToken", self.csrf())
        for key, value in (headers or {}).items():
            req.add_header(key, value)
        return self._do(req)

    def _do(self, req):
        try:
            with self.opener.open(req, timeout=180) as resp:
                return resp.status, resp.headers, resp.read()
        except urllib.error.HTTPError as exc:
            return exc.code, exc.headers, exc.read()


def _encode(fields: dict, files: dict | None):
    if not files:
        return urllib.parse.urlencode(fields).encode("utf-8"), "application/x-www-form-urlencoded"
    boundary = "----FDE4" + uuid.uuid4().hex
    chunks: list[bytes] = []
    for key, value in fields.items():
        chunks.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{value}\r\n".encode()
        )
    for key, path in files.items():
        name = os.path.basename(path)
        ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
        with open(path, "rb") as handle:
            blob = handle.read()
        chunks.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"; filename=\"{name}\"\r\n"
            f"Content-Type: {ctype}\r\n\r\n".encode() + blob + b"\r\n"
        )
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def live_get(path: str, teacher_id: int = TEACHER_A_ID, *, sign: bool = True, raw_headers: dict | None = None):
    req = urllib.request.Request(LIVE + path, method="GET")
    if raw_headers is not None:
        for key, value in raw_headers.items():
            req.add_header(key, value)
    else:
        headers = {"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": str(teacher_id)}
        if sign:
            headers = internal_auth.signed_headers("GET", path.split("?")[0], headers)
        for key, value in headers.items():
            req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, _safe_json(exc.read())


def _safe_json(blob: bytes):
    try:
        return json.loads(blob.decode("utf-8"))
    except ValueError:
        return {"raw": blob.decode("utf-8", "replace")[:300]}


def _flash(html: str) -> str:
    found = re.findall(r'class="[^"]*message[^"]*"[^>]*>(.*?)</', html, re.S)
    cleaned = [re.sub(r"<[^>]+>", "", item).strip() for item in found]
    cleaned = [item for item in cleaned if item]
    return " | ".join(cleaned[:4])[:400]


def login(path: str, email: str) -> Session:
    session = Session()
    session.get(path)
    session.post(
        path,
        {"csrfmiddlewaretoken": session.csrf(), "username": email, "password": PASSWORD},
    )
    return session


def submissions_all() -> list:
    status, payload = live_get("/api/v1/vision/submissions")
    if status != 200:
        return []
    return payload if isinstance(payload, list) else (payload.get("submissions") or [])


def models_all() -> list:
    status, payload = live_get("/api/v1/vision/models")
    if status != 200:
        return []
    return payload if isinstance(payload, list) else (payload.get("models") or [])


# ---------------------------------------------------------------------------
def main() -> int:
    if not os.path.exists(MODEL_PT):
        print(f"缺少測試模型：{MODEL_PT}", file=sys.stderr)
        return 2
    if not os.environ.get("FDE_INTERNAL_SHARED_SECRET"):
        print("缺少 FDE_INTERNAL_SHARED_SECRET（需與隔離棧一致）", file=sys.stderr)
        return 2

    sha_before = {key: sha256_file(path) for key, path in PRODUCTION_PATHS.items()}
    model_sha = sha256_file(MODEL_PT)

    # 起始狀態
    subs_before = submissions_all()
    models_before = models_all()
    sub_count_before = len(subs_before)
    active_before = [m.get("model_id") for m in models_before if m.get("status") == "ACTIVE"]

    # 班級 A（學員 A = DEMO-STU-0001）的全部提交；作為「同班可見 / 異班不可見」的判準。
    cohort_a_subs = [s for s in subs_before if s.get("student_id") == "DEMO-STU-0001"]
    cohort_a_sub_ids = [str(s.get("submission_id") or "") for s in cohort_a_subs]
    # 攻擊目標優先用「仍待審（SUBMITTED）」的那筆，最貼近真實越權情境。
    target_sub = next(
        (s for s in cohort_a_subs if s.get("status") == "SUBMITTED"),
        cohort_a_subs[0] if cohort_a_subs else None,
    )
    target_sub_id = str((target_sub or {}).get("submission_id") or "")

    # 班級 A 的「學員衍生」模型（source_student_id = DEMO-STU-0001）。
    # 教師自行上傳的模型（source_student_id 為空，例如 *_X_v1）依既有契約屬全域教材，
    # 不帶任何學員身分，因此不列入跨班洩漏判準；此取捨在交付報告中列為剩餘風險說明。
    cohort_a_models = [
        m for m in models_before
        if m.get("model_type") == TASK_ID
        and m.get("status") != "ARCHIVED"
        and m.get("source_student_id") == "DEMO-STU-0001"
    ]
    cohort_a_model_ids = [str(m.get("model_id") or "") for m in cohort_a_models]
    global_teacher_models = [
        str(m.get("model_id") or "")
        for m in models_before
        if m.get("source_student_id") in (None, "") and m.get("status") != "ARCHIVED"
    ]
    # 攻擊目標優先挑「班級 A 可見且非 ACTIVE」的模型
    target_model = next(
        (m for m in cohort_a_models if m.get("status") != "ACTIVE"),
        cohort_a_models[0] if cohort_a_models else None,
    )
    target_model_id = str((target_model or {}).get("model_id") or "")

    # ---- P-01 匿名請求拒絕 -------------------------------------------------
    anon = Session()
    st_page, headers_page, _ = anon.get(f"/teacher/vision-center/?task={TASK_ID}&scene=1")
    location = headers_page.get("Location", "") if headers_page else ""
    st_post, _, _ = anon.post(
        "/teacher/vision-center/activate/",
        {"csrfmiddlewaretoken": "", "model_id": target_model_id, "task": TASK_ID},
    )
    blocked_anon = st_page in (301, 302, 303, 401, 403)
    record("P-01", "匿名請求被拒絕（教師頁與教師動作）", blocked_anon and st_post in (301, 302, 303, 401, 403), {
        "get_teacher_page_http": st_page,
        "get_teacher_page_location": location,
        "post_activate_http": st_post,
    })

    # ---- P-02 學員偽造教師角色 ---------------------------------------------
    student_a = login("/login/", STUDENT_A)
    st_s_page, _, body_s_page = student_a.get(f"/teacher/vision-center/?task={TASK_ID}&scene=1")
    st_s_post, _, _ = student_a.post(
        "/teacher/vision-center/activate/",
        {"csrfmiddlewaretoken": student_a.csrf(), "model_id": target_model_id, "task": TASK_ID},
    )
    # 同時帶上偽造標頭，Django 必須忽略（伺服器端查真實角色）
    st_s_spoof, _, _ = student_a.get(
        f"/teacher/vision-center/?task={TASK_ID}&scene=1",
        headers={"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": str(TEACHER_A_ID), "X-FDE-User": "2"},
    )
    record("P-02", "學員偽造教師角色/標頭無法提權", st_s_page == 403 and st_s_post == 403 and st_s_spoof == 403, {
        "get_teacher_page_http": st_s_page,
        "post_activate_http": st_s_post,
        "get_with_forged_headers_http": st_s_spoof,
        "body_snippet": body_s_page.decode("utf-8", "replace")[:160],
    })

    # ---- P-03 同班教師可查看 -------------------------------------------------
    teacher_a = login("/teacher/login/", TEACHER_A)
    st_a, _, page_a = teacher_a.get(f"/teacher/vision-center/?task={TASK_ID}&scene=1")
    html_a = page_a.decode("utf-8", "replace")
    visible_a = [sid for sid in cohort_a_sub_ids if sid and sid in html_a]
    record(
        "P-03",
        "同班教師（A）可見學員 A 的提交",
        st_a == 200 and bool(visible_a),
        {
            "http": st_a,
            "cohort_a_submissions": cohort_a_sub_ids,
            "visible_on_page": visible_a,
            "html_bytes": len(page_a),
        },
    )

    # ---- P-04 異班教師不能查看列表 -------------------------------------------
    teacher_b = login("/teacher/login/", TEACHER_B)
    st_b, _, page_b = teacher_b.get(f"/teacher/vision-center/?task={TASK_ID}&scene=1")
    html_b = page_b.decode("utf-8", "replace")
    leaked_subs = [sid for sid in cohort_a_sub_ids if sid and sid in html_b]
    leaked_models = [mid for mid in cohort_a_model_ids if mid and mid in html_b]
    record(
        "P-04",
        "異班教師（B）列表中不含班級 A 任何提交或學員衍生模型",
        st_b == 200 and not leaked_subs and not leaked_models,
        {
            "http": st_b,
            "cohort_a_submissions": cohort_a_sub_ids,
            "leaked_submissions": leaked_subs,
            "cohort_a_student_models": cohort_a_model_ids,
            "leaked_models": leaked_models,
            "global_teacher_models_not_cohort_scoped": global_teacher_models,
            "html_bytes": len(page_b),
        },
    )

    # ---- P-05 異班不能存取詳情（直接猜 ID）----------------------------------
    st_b_detail, _, body_b_detail = teacher_b.get(
        f"/teacher/vision-center/?task={TASK_ID}&scene=2&submission_id={target_sub_id}"
    )
    st_b_model, _, _ = teacher_b.get(
        f"/teacher/vision-center/?task={TASK_ID}&scene=2&model_id={target_model_id}"
    )
    st_b_modelsel, _, page_b_modelsel = teacher_b.get(
        f"/teacher/vision-center/?task={TASK_ID}&scene=2&model={target_model_id}"
    )
    html_b_modelsel = page_b_modelsel.decode("utf-8", "replace")
    record(
        "P-05",
        "異班教師直接猜 submission_id / model_id 也無法取得詳情",
        st_b_detail == 403 and st_b_model == 403 and target_model_id not in html_b_modelsel,
        {
            "get_with_submission_id_http": st_b_detail,
            "get_with_model_id_http": st_b_model,
            "get_with_model_param_http": st_b_modelsel,
            "model_id_in_page": target_model_id in html_b_modelsel,
            "denied_body": body_b_detail.decode("utf-8", "replace")[:160],
        },
    )

    # ---- P-06 異班不能驗證/修改 ---------------------------------------------
    st_b_validate, _, body_b_validate = teacher_b.post(
        "/teacher/vision-center/validate-submission/",
        {
            "csrfmiddlewaretoken": teacher_b.csrf(),
            "submission_id": target_sub_id,
            "expected_class": "CW_F",
            "confidence_threshold": "0.5",
        },
        files={"test_image": IMG_1},
        headers={"X-Requested-With": "XMLHttpRequest"},
    )
    st_b_import, _, body_b_import = teacher_b.post(
        "/teacher/vision-center/import/",
        {"csrfmiddlewaretoken": teacher_b.csrf(), "submission_id": target_sub_id, "task": TASK_ID},
    )
    st_b_del, _, _ = teacher_b.post(
        "/teacher/vision-center/delete-submission/",
        {"csrfmiddlewaretoken": teacher_b.csrf(), "submission_id": target_sub_id, "task": TASK_ID},
    )
    record(
        "P-06",
        "異班教師不能驗證／匯入／刪除他班提交",
        st_b_validate == 403 and st_b_import == 403 and st_b_del == 403,
        {
            "validate_submission_http": st_b_validate,
            "import_http": st_b_import,
            "delete_submission_http": st_b_del,
            "validate_body": body_b_validate.decode("utf-8", "replace")[:160],
            "import_body": body_b_import.decode("utf-8", "replace")[:160],
        },
    )

    # ---- P-07 異班不能啟用 ---------------------------------------------------
    st_b_activate, _, body_b_activate = teacher_b.post(
        "/teacher/vision-center/activate/",
        {"csrfmiddlewaretoken": teacher_b.csrf(), "model_id": target_model_id, "task": TASK_ID},
    )
    active_after_b = [m.get("model_id") for m in models_all() if m.get("status") == "ACTIVE"]
    record(
        "P-07",
        "異班教師不能啟用他班模型（ACTIVE 未變）",
        st_b_activate == 403 and active_after_b == active_before,
        {
            "activate_http": st_b_activate,
            "active_before": active_before,
            "active_after": active_after_b,
            "body": body_b_activate.decode("utf-8", "replace")[:160],
        },
    )

    # ---- P-08 無班級關聯安全拒絕 ---------------------------------------------
    teacher_c = login("/teacher/login/", TEACHER_C)
    st_c_list, _, page_c = teacher_c.get(f"/teacher/vision-center/?task={TASK_ID}&scene=1")
    html_c = page_c.decode("utf-8", "replace")
    st_c_detail, _, _ = teacher_c.get(
        f"/teacher/vision-center/?task={TASK_ID}&scene=2&submission_id={target_sub_id}"
    )
    st_c_activate, _, _ = teacher_c.post(
        "/teacher/vision-center/activate/",
        {"csrfmiddlewaretoken": teacher_c.csrf(), "model_id": target_model_id, "task": TASK_ID},
    )
    record(
        "P-08",
        "無班級關聯教師（C）安全拒絕（空清單 + 資源一律 403）",
        st_c_list == 200
        and target_sub_id not in html_c
        and st_c_detail == 403
        and st_c_activate == 403,
        {
            "list_http": st_c_list,
            "submission_in_list": target_sub_id in html_c,
            "detail_http": st_c_detail,
            "activate_http": st_c_activate,
        },
    )

    # ---- P-09 無效 .pt 被拒且不進待審佇列 -------------------------------------
    junk_path = os.path.join(ROOT, "test-images", "fake_model.pt")
    with open(junk_path, "wb") as handle:
        handle.write(b"GARBAGE" * 300)  # 2100 bytes 垃圾位元組
    count_before_junk = len(submissions_all())
    st_junk, _, _ = student_a.post(
        f"/student/courses/{ENROLLMENT_A}/growth/R07/model/",
        {"csrfmiddlewaretoken": student_a.csrf(), "parent_model_id": ""},
        files={"model_file": junk_path},
    )
    _, _, page_junk = student_a.get(f"/student/courses/{ENROLLMENT_A}/growth/R07/")
    flash_junk = _flash(page_junk.decode("utf-8", "replace"))
    time.sleep(1.5)
    count_after_junk = len(submissions_all())
    record(
        "P-09",
        "無效 .pt 被拒且未進入待審佇列",
        st_junk in (302, 303)
        and "未通過安全檢查" in flash_junk
        and count_after_junk == count_before_junk,
        {
            "http": st_junk,
            "flash": flash_junk,
            "submissions_before": count_before_junk,
            "submissions_after": count_after_junk,
            "junk_size": os.path.getsize(junk_path),
        },
    )

    # ---- P-10 合法候選可進受控驗證 -------------------------------------------
    count_before_real = len(submissions_all())
    st_real, _, _ = student_a.post(
        f"/student/courses/{ENROLLMENT_A}/growth/R07/model/",
        {"csrfmiddlewaretoken": student_a.csrf(), "parent_model_id": ""},
        files={"model_file": MODEL_PT},
    )
    time.sleep(1.5)
    subs_after_real = submissions_all()
    new_real = [
        s for s in subs_after_real
        if s.get("file_hash") == model_sha and s.get("status") in ("SUBMITTED", "IMPORTED")
    ]
    ok10 = st_real in (302, 303) and len(subs_after_real) >= count_before_real and bool(new_real)
    record("P-10", "合法 .pt 通過預檢並建立受控待審候選", ok10, {
        "http": st_real,
        "submissions_before": count_before_real,
        "submissions_after": len(subs_after_real),
        "matching_submissions": [s.get("submission_id") for s in new_real][:3],
        "model_sha256": model_sha,
    })

    # ---- P-11 Live 不接受未授權直連 -------------------------------------------
    p11: dict = {}
    st_none, _ = live_get("/api/v1/vision/submissions", raw_headers={})
    p11["no_headers"] = st_none
    st_role, _ = live_get(
        "/api/v1/vision/submissions",
        raw_headers={"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": str(TEACHER_A_ID)},
    )
    p11["forged_role_only"] = st_role
    bad_sig = internal_auth.signed_headers(
        "GET", "/api/v1/vision/submissions",
        {"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": str(TEACHER_A_ID)},
    )
    bad_sig["X-FDE-Internal-Signature"] = "0" * 64
    st_bad, _ = live_get("/api/v1/vision/submissions", raw_headers=bad_sig)
    p11["bad_signature"] = st_bad
    stale = internal_auth.signed_headers(
        "GET", "/api/v1/vision/submissions",
        {"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": str(TEACHER_A_ID)},
    )
    # 用 1 小時前的時間戳重算簽章（簽章本身正確，但已過期）
    stale_ts = str(int(time.time()) - 3600)
    stale["X-FDE-Internal-Timestamp"] = stale_ts
    stale["X-FDE-Internal-Signature"] = internal_auth.sign(
        "GET", "/api/v1/vision/submissions", "teacher", str(TEACHER_A_ID), stale_ts,
        internal_auth.shared_secret(),
    )
    st_stale, _ = live_get("/api/v1/vision/submissions", raw_headers=stale)
    p11["stale_signature"] = st_stale
    # 對照組：正確簽章必須 200（證明拒絕不是「全部拒絕」造成的假通過）
    st_good, _ = live_get("/api/v1/vision/submissions")
    p11["valid_signature"] = st_good
    record(
        "P-11",
        "Live 只接受帶正確簽章的內部呼叫（未簽章/偽造/過期一律 403）",
        st_none == 403 and st_role == 403 and st_bad == 403 and st_stale == 403 and st_good == 200,
        p11,
    )

    # ---- P-12 偽造 X-FDE-* 不得提權 -------------------------------------------
    # (a) 直接對 Live 偽造「我是教師 A」，但沒有簽章 → 403
    st_spoof_live, _ = live_get(
        "/api/v1/vision/submissions",
        raw_headers={
            "X-FDE-Role": "teacher",
            "X-FDE-Teacher-ID": str(TEACHER_A_ID),
            "X-FDE-User": str(TEACHER_A_ID),
            "X-FDE-Cohort": "F450-DEMO-2026",
        },
    )
    # (b) 教師 B 用自己的身分簽章，但宣稱是教師 A（簽章與 subject 不符）→ 403
    escalate = internal_auth.signed_headers(
        "GET", "/api/v1/vision/submissions",
        {"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": str(TEACHER_A_ID)},
        subject_id=str(TEACHER_B_ID),
    )
    st_escalate, _ = live_get("/api/v1/vision/submissions", raw_headers=escalate)
    # (c) Django 端：學員帶偽造標頭仍被 403（與 P-02 互為印證）
    st_spoof_django, _, _ = student_a.post(
        "/teacher/vision-center/import/",
        {"csrfmiddlewaretoken": student_a.csrf(), "submission_id": target_sub_id, "task": TASK_ID},
        headers={"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": str(TEACHER_A_ID)},
    )
    record(
        "P-12",
        "偽造 X-FDE-Role／X-FDE-Teacher-ID／X-FDE-Cohort 不得提權",
        st_spoof_live == 403 and st_escalate == 403 and st_spoof_django == 403,
        {
            "live_forged_headers_http": st_spoof_live,
            "live_signed_with_wrong_subject_http": st_escalate,
            "django_forged_headers_http": st_spoof_django,
        },
    )

    # ---- P-13 代理逾時安全退出 -----------------------------------------------
    env = dict(os.environ)
    env["FDE_E2E_RUN_ROOT"] = ISO
    # P-13 需要在 Django 環境執行，因此用專案既有的 Django venv（不是本腳本的解釋器）。
    django_py = env.get("FDE_DJANGO_PYTHON") or os.path.join(
        PROJECT_ROOT, ".test-temp", "django-venv", "Scripts", "python.exe"
    )
    completed = subprocess.run(
        [django_py, os.path.join(TOOLS_DIR, "phase4_proxy_timeout.py")],
        capture_output=True, timeout=240, env=env,
    )
    stdout = (completed.stdout or b"").decode("utf-8", "replace")
    p13 = _safe_json(stdout.strip().splitlines()[-1].encode() if stdout.strip() else b"{}")
    record("P-13", "代理逾時安全退出（fail-closed，不掛住請求）", bool(p13.get("ok")), {
        "returncode": completed.returncode,
        "result": p13,
        "stderr_tail": (completed.stderr or b"").decode("utf-8", "replace")[-300:],
    })

    # ---- P-14 真實 YOLO 圖片推論成功 ------------------------------------------
    st14, _, body14 = teacher_a.post(
        "/teacher/vision-center/validate-submission/",
        {
            "csrfmiddlewaretoken": teacher_a.csrf(),
            "submission_id": target_sub_id,
            "expected_class": "CW_F",
            "confidence_threshold": "0.5",
        },
        files={"test_image": IMG_2},
        headers={"X-Requested-With": "XMLHttpRequest"},
    )
    payload14 = _safe_json(body14)
    result14 = payload14.get("result") if isinstance(payload14.get("result"), dict) else {}
    ok14 = (
        st14 == 200
        and result14.get("evidence_source") == "REAL_INFERENCE"
        and isinstance(result14.get("detection_count"), int)
        and result14.get("detection_count") > 0
        and result14.get("max_confidence") is not None
    )
    record("P-14", "真實 YOLO 推論成功（非替身，有候選框與信心值）", ok14, {
        "http": st14,
        "image": os.path.basename(IMG_2),
        "evidence_source": result14.get("evidence_source"),
        "detection_count": result14.get("detection_count"),
        "max_confidence": result14.get("max_confidence"),
        "verdict": result14.get("verdict"),
        "class_names": result14.get("class_names"),
    })

    # ---- P-15 低品質模型仍不能 ACTIVE ----------------------------------------
    # 挑一個「班級 A 可見、且 activation_eligible 不為 True」的模型
    candidates = [
        m for m in models_all()
        if m.get("model_type") == TASK_ID
        and m.get("status") != "ARCHIVED"
        and m.get("activation_eligible") is not True
        and (m.get("source_student_id") in (None, "", "DEMO-STU-0001"))
    ]
    low = candidates[0] if candidates else None
    low_id = str((low or {}).get("model_id") or "")
    active_before_15 = [m.get("model_id") for m in models_all() if m.get("status") == "ACTIVE"]
    if low_id:
        st15, _, body15 = teacher_a.post(
            "/teacher/vision-center/activate/",
            {"csrfmiddlewaretoken": teacher_a.csrf(), "model_id": low_id, "task": TASK_ID},
        )
        flash15 = _flash(body15.decode("utf-8", "replace"))
        models_after_15 = models_all()
        low_after = next((m for m in models_after_15 if m.get("model_id") == low_id), {})
        active_after_15 = [m.get("model_id") for m in models_after_15 if m.get("status") == "ACTIVE"]
        ok15 = low_after.get("status") != "ACTIVE" and active_after_15 == active_before_15
    else:
        st15, flash15, active_after_15, ok15 = None, "", active_before_15, False
    record("P-15", "低品質/未達門檻模型仍不能 ACTIVE（門檻未被放寬）", ok15, {
        "model_id": low_id,
        "activation_eligible": (low or {}).get("activation_eligible"),
        "health": (low or {}).get("health"),
        "health_map50": (low or {}).get("health_map50"),
        "http": st15,
        "flash": flash15,
        "status_after": low_after.get("status") if low_id else None,
        "active_before": active_before_15,
        "active_after": active_after_15,
    })

    # ---- P-16 正式 Registry 與正式 DB 前後不變 -------------------------------
    sha_after = {key: sha256_file(path) for key, path in PRODUCTION_PATHS.items()}
    unchanged = {key: sha_before[key] == sha_after[key] for key in PRODUCTION_PATHS}
    record("P-16", "正式 Registry 與正式 DB 前後指紋不變", all(unchanged.values()), {
        "sha256_before": sha_before,
        "sha256_after": sha_after,
        "unchanged": unchanged,
    })

    # ---- 匯總 ---------------------------------------------------------------
    passed = sum(1 for r in results if r["pass"])
    report = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "isolated_django": BASE,
        "isolated_live": LIVE,
        "iso_root": ISO,
        "task_id": TASK_ID,
        "cohorts": {
            "A": {"cohort_id": "F450-DEMO-2026", "teacher": TEACHER_A, "student": STUDENT_A,
                  "enrollment_id": ENROLLMENT_A},
            "B": {"cohort_id": "2026-99", "teacher": TEACHER_B, "student": STUDENT_B,
                  "enrollment_id": ENROLLMENT_B},
            "C": {"teacher": TEACHER_C, "cohort": None},
        },
        "target_submission_id": target_sub_id,
        "target_model_id": target_model_id,
        "total": len(results),
        "passed": passed,
        "results": results,
    }
    out_dir = os.path.join(ROOT, "evidence")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "phase4-p01-p16.json")
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
    print(f"\n{passed}/{len(results)} 通過 → {out}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
