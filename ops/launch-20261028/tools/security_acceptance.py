"""FDE-AI 2.0 上線收尾 — 第六階段「權限與資料安全驗收」10 項（真實 HTTP，隔離環境）。

只連 127.0.0.1:18110（隔離 Django）與 127.0.0.1:18111（隔離 Live）。
不接觸正式 8022 / 8770 / 正式 Registry / 正式 DB。

用法：
  FDE_E2E_RUN_ROOT=<隔離根> python security_acceptance.py
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ISO = os.environ.get("FDE_E2E_RUN_ROOT") or os.path.join(ROOT, "isolated-final3")

# 重用閉環腳本裡的 Session / multipart 工具，避免兩套實作漂移。
_spec = importlib.util.spec_from_file_location("e2e", os.path.join(HERE, "e2e_closed_loop.py"))
e2e = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(e2e)

BASE = e2e.BASE
LIVE = e2e.LIVE
STUDENT_EMAIL = e2e.STUDENT_EMAIL
TEACHER_EMAIL = e2e.TEACHER_EMAIL
PASSWORD = e2e.STUDENT_PASSWORD
ENROLLMENT_ID = e2e.ENROLLMENT_ID
TASK_ID = e2e.TASK_ID

results: list[dict] = []


def record(idx: str, name: str, ok: bool, evidence: dict) -> None:
    results.append({"id": idx, "name": name, "pass": bool(ok), "evidence": evidence})
    print(f"[{'PASS' if ok else 'FAIL'}] {idx} {name}")


def submissions() -> list:
    _, data = e2e.live_get(f"/api/v1/vision/submissions?task_id={TASK_ID}")
    return data if isinstance(data, list) else data.get("submissions", [])


def models() -> list:
    _, data = e2e.live_get(f"/api/v1/vision/models?task_id={TASK_ID}")
    return data if isinstance(data, list) else data.get("models", [])


def login(email: str, path: str = "/login/") -> e2e.Session:
    session = e2e.Session()
    session.get(path)
    session.post(path, {"csrfmiddlewaretoken": session.csrf(), "username": email, "password": PASSWORD})
    return session


def main() -> int:
    student = login(STUDENT_EMAIL, "/login/")
    teacher = login(TEACHER_EMAIL, "/teacher/login/")
    anon = e2e.Session()

    sub_before = submissions()
    model_before = models()
    active_before = [m.get("model_id") for m in model_before if m.get("status") == "ACTIVE"]

    # ---- S-01 匿名使用者不能上傳 ----------------------------------------
    # 期望：被擋住且不留紀錄。實測可能為 302→/login/（未登入）或 403（CSRF 先擋）。
    # 兩者都算通過；只有「產生紀錄」或「200 成功」才算失敗。
    status, headers, _ = anon.post(
        f"/student/courses/{ENROLLMENT_ID}/growth/R07/model/",
        {"csrfmiddlewaretoken": "x"},
        files={"model_file": e2e.MODEL_PT},
    )
    location = headers.get("Location") or ""
    blocked = (status in (302, 303) and "/login/" in location) or status in (401, 403)
    ok01 = blocked and len(submissions()) == len(sub_before)
    record("S-01", "匿名使用者不能上傳模型", ok01, {
        "http": status,
        "redirect": location,
        "blocked_by": "csrf" if status == 403 else ("login_redirect" if location else "other"),
        "submission_count_unchanged": len(submissions()) == len(sub_before),
    })

    # ---- S-02 學員不能查看其他學員的私人資料 -----------------------------
    s_own, _, _ = student.get(f"/student/courses/{ENROLLMENT_ID}/growth/R07/")
    s_other, _, _ = student.get("/student/courses/9999/growth/")
    s_dash_other, _, _ = student.get("/student/courses/9999/")
    ok02 = s_own == 200 and s_other == 404 and s_dash_other == 404
    record("S-02", "學員不能查看其他學員的私人資料", ok02, {
        "own_growth_http": s_own, "other_growth_http": s_other, "other_course_http": s_dash_other,
        "note": "9999 為不存在的 enrollment，回 404 代表未做越權回退",
    })

    # ---- S-03 角色隔離：學員不能進入教師功能 -----------------------------
    st_get, h_get, _ = student.get("/teacher/vision-center/")
    st_act, h_act, _ = student.post(
        "/teacher/vision-center/activate/",
        {"csrfmiddlewaretoken": student.csrf(), "model_id": "PROP_20261028_DEMO-A_v1", "task": TASK_ID},
    )
    ok03 = st_get in (302, 403) and st_act in (302, 403)
    record("S-03", "學員不能查看或操作教師後台", ok03, {
        "teacher_page_http": st_get, "teacher_page_redirect": h_get.get("Location"),
        "activate_http": st_act, "activate_redirect": h_act.get("Location"),
        "cross_class_teacher_scoping": "NOT_IMPLEMENTED",
        "cross_class_note": "teacher_vision_center 以 list_submissions(task_id) 取全部提交，未按班級/教師過濾；DEMO 僅 1 班級故無法以第二班級實測",
    })

    # ---- S-04 學員不能直接將模型設為 ACTIVE -------------------------------
    active_after_s04 = [m.get("model_id") for m in models() if m.get("status") == "ACTIVE"]
    ok04 = active_after_s04 == active_before and st_act in (302, 403)
    record("S-04", "學員不能直接將模型設為 ACTIVE", ok04, {
        "active_before": active_before, "active_after": active_after_s04,
        "student_activate_http": st_act,
    })

    # ---- S-05 未經教師批准不能成為 ACTIVE --------------------------------
    statuses = {}
    for item in models():
        statuses[item.get("status")] = statuses.get(item.get("status"), 0) + 1
    ok05 = not active_after_s04
    record("S-05", "未經教師批准的模型不能成為正式使用版本", ok05, {
        "active_models": active_after_s04, "status_distribution": statuses,
        "note": "隔離環境無任何 ACTIVE；候選模型停在 REVIEW_REQUIRED",
    })

    # ---- S-06 非法檔案 / 超大檔案 / 錯誤格式被拒絕 ------------------------
    bad_txt = os.path.join(ISO, "tmp", "not_a_model.txt")
    fake_pt = os.path.join(ISO, "tmp", "fake_model.pt")
    big_pt = os.path.join(ISO, "tmp", "oversize.pt")
    os.makedirs(os.path.dirname(bad_txt), exist_ok=True)
    with open(bad_txt, "wb") as handle:
        handle.write(b"this is not a model\n")
    with open(fake_pt, "wb") as handle:
        handle.write(b"\x00" * 2048)
    if not os.path.exists(big_pt):
        with open(big_pt, "wb") as handle:
            handle.truncate(101 * 1024 * 1024)

    count_before_s06 = len(submissions())
    txt_status, txt_h, _ = student.post(
        f"/student/courses/{ENROLLMENT_ID}/growth/R07/model/",
        {"csrfmiddlewaretoken": student.csrf()},
        files={"model_file": bad_txt},
    )
    fake_status, fake_h, _ = student.post(
        f"/student/courses/{ENROLLMENT_ID}/growth/R07/model/",
        {"csrfmiddlewaretoken": student.csrf()},
        files={"model_file": fake_pt},
    )
    big_status, big_h, _ = student.post(
        f"/student/courses/{ENROLLMENT_ID}/growth/R07/model/",
        {"csrfmiddlewaretoken": student.csrf()},
        files={"model_file": big_pt},
    )
    count_after_s06 = len(submissions())
    # 分項判定：副檔名與大小在表單層被擋；內容（magic bytes）無任何檢查。
    txt_blocked = txt_status in (302, 303)
    big_blocked = big_status in (302, 303) and big_status != 413
    content_blocked = count_after_s06 == count_before_s06
    ok06 = txt_blocked and big_blocked and content_blocked
    record("S-06", "非法檔案／超大檔案／錯誤格式被拒絕", ok06, {
        "txt_rejected_at_form": txt_blocked,
        "oversize_101mb_rejected_at_form": big_blocked,
        "garbage_pt_rejected_by_content_check": content_blocked,
        "txt_http": txt_status, "fake_pt_http": fake_status, "oversize_101mb_http": big_status,
        "submission_count_before": count_before_s06, "submission_count_after": count_after_s06,
        "form_rules": "forms.py:423-429 僅檢查 .pt 副檔名與 <=100MB，不檢查檔案內容",
        "finding": (
            "2KB 垃圾位元組偽裝成 .pt 可通過表單驗證並在 Live 建立 SUBMITTED 提交紀錄；"
            "內容合法性要到教師「匯入預檢」載入模型時才會失敗"
        ) if not content_blocked else "",
    })
    try:
        os.truncate(big_pt, 0)
    except OSError:
        pass

    # ---- S-07 上傳失敗不留下假成功紀錄 -----------------------------------
    after = submissions()
    ok07 = len(after) == count_before_s06
    record("S-07", "上傳失敗不留下假成功紀錄", ok07, {
        "before": count_before_s06, "after": len(after),
        "no_phantom_submission": len(after) == count_before_s06,
    })

    # ---- S-08 模型驗證結果可追溯 -----------------------------------------
    # 追溯性以 Live 的 model history 為準（每次匯入/啟用都留檔並帶 file_hash、
    # class_names、activation_* 欄位）。model_management_audit.jsonl 只記歸檔/還原/刪除，
    # 不含匯入與驗證，因此不作為本項必要條件。
    _, history = e2e.live_get(f"/api/v1/vision/tasks/{TASK_ID}/history")
    entries = history.get("history") if isinstance(history, dict) else history
    entries = entries or []
    required_keys = {"model_id", "file_hash", "class_names", "activation_eligible"}
    traceable = [e for e in entries if required_keys.issubset(set(e.keys()))]
    audit_file = os.path.join(ISO, "vision-center", "model_management_audit.jsonl")
    audit_lines = 0
    if os.path.exists(audit_file):
        with open(audit_file, encoding="utf-8") as handle:
            audit_lines = sum(1 for line in handle if line.strip())
    ok08 = len(traceable) > 0
    record("S-08", "模型驗證結果可追溯", ok08, {
        "history_entries": len(entries),
        "traceable_entries": len(traceable),
        "required_fields_present": sorted(required_keys),
        "sample_file_hash": (traceable[0].get("file_hash") if traceable else None),
        "sample_class_names": (traceable[0].get("class_names") if traceable else None),
        "management_audit_lines": audit_lines,
        "note": "model_management_audit.jsonl 僅涵蓋歸檔/還原/刪除，匯入與驗證的軌跡在 history",
    })

    # ---- S-09 前端不暴露管理密鑰 -----------------------------------------
    cand = os.path.join(ROOT, "candidate", "v2")
    patterns = [
        (re.compile(r"(?i)(api[_-]?key|secret|password|passwd|token)\s*[:=]\s*['\"][^'\"]{6,}"), "硬編碼憑證"),
        (re.compile(r"(?i)bearer\s+[a-z0-9\-._~+/]{16,}"), "Bearer token"),
        (re.compile(r"(?i)(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)"), "內網/localhost 位址"),
        (re.compile(r"sk-[A-Za-z0-9]{16,}"), "雲端 API key"),
    ]
    hits: list[dict] = []
    scanned = 0
    for dirpath, _dirnames, filenames in os.walk(cand):
        for name in filenames:
            path = os.path.join(dirpath, name)
            scanned += 1
            try:
                text = open(path, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            for pattern, label in patterns:
                for match in pattern.finditer(text):
                    hits.append({
                        "file": os.path.relpath(path, cand),
                        "rule": label,
                        "snippet": match.group(0)[:60],
                    })
    ok09 = not hits
    record("S-09", "前端不暴露管理密鑰／內網位址", ok09, {
        "files_scanned": scanned, "hits": hits[:8], "hit_count": len(hits),
    })

    # ---- S-10 Gateway 保持原有隔離契約 -----------------------------------
    baseline_worker = os.path.join(ROOT, "baseline", "worker", "index.js")
    live_worker = r"D:\FDE-AI-Gateway\src\index.js"

    def sha(path: str) -> str:
        if not os.path.exists(path):
            return ""
        return hashlib.sha256(open(path, "rb").read()).hexdigest()

    src = open(live_worker, encoding="utf-8", errors="replace").read() if os.path.exists(live_worker) else ""
    dynamic_block = re.search(r"DYNAMIC_PREFIXES\s*=\s*\[(.*?)\]", src, re.S)
    prefixes = re.findall(r'"([^"]+)"', dynamic_block.group(1)) if dynamic_block else []
    vision_exposed = any("vision" in item for item in prefixes)
    live_in_worker = "8111" in src or "18111" in src
    ok10 = (
        sha(baseline_worker) == sha(live_worker)
        and not vision_exposed
        and not live_in_worker
    )
    record("S-10", "Gateway 保持原有隔離契約（未新增視覺/ Live 路由）", ok10, {
        "worker_sha_baseline": sha(baseline_worker),
        "worker_sha_now": sha(live_worker),
        "worker_unchanged": sha(baseline_worker) == sha(live_worker),
        "dynamic_prefixes": prefixes,
        "vision_route_added": vision_exposed,
        "live_port_referenced": live_in_worker,
    })

    passed = sum(1 for item in results if item["pass"])
    report = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "isolated_django": BASE,
        "isolated_live": LIVE,
        "total": len(results),
        "passed": passed,
        "results": results,
    }
    out = os.path.join(ROOT, "evidence", "security-acceptance-10.json")
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
    print(f"\n{passed}/{len(results)} 通過 → {out}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
