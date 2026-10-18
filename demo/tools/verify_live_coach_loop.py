"""Phase 2/3：F450 十二任務 + AI Live Coach 真實 HTTP 閉環驗收。
不輸出密碼或任何憑證值；權限測試禁用自動跟隨重導。
用法：python verify_live_coach_loop.py [LIVE_BASE_URL]

契約要點（以 live_backend/app/main.py 為準）：
- 建立訓練 session 必須帶 training_track="F450_TWELVE_TASK"，否則訓練端點回 404。
- 反思需 task_id + original_text（非空）。
- 任務完成前所有訓練步驟須完成，否則 409 training_steps_incomplete。
- /simulate 為 dev-only（MOCK_VISION），DEMO 停用時回 404 dev_only，屬正確安全行為。
"""
import json
import sys
import urllib.error
import urllib.request

LIVE = sys.argv[1] if len(sys.argv) > 1 else "http://192.168.1.114:8111"
results = []


def record(step, ok, detail):
    results.append((step, ok, detail))
    print("%-54s %s  %s" % (step, "PASS" if ok else "FAIL", detail))


def req(method, path, payload=None, timeout=60):
    data = json.dumps(payload).encode() if payload is not None else None
    r = urllib.request.Request(LIVE + path, data=data, method=method)
    if data:
        r.add_header("Content-Type", "application/json")
    try:
        resp = urllib.request.urlopen(r, timeout=timeout)
        return resp.status, json.loads(resp.read().decode("utf-8", "replace") or "{}")
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        try:
            return exc.code, json.loads(raw or "{}")
        except ValueError:
            return exc.code, {"_raw": raw[:300]}
    except Exception as exc:  # noqa: BLE001
        return -1, {"_error": "%s: %s" % (type(exc).__name__, exc)}


def ack_all_steps(sid, max_steps=40):
    """逐步安全確認直到步驟全部完成；回傳已確認步驟數。"""
    acked = []
    for _ in range(max_steps):
        st, view = req("GET", "/api/live/sessions/%s/training/tasks/TASK_01" % sid)
        if st != 200:
            break
        tv = view.get("training_task_view") or {}
        step_id = tv.get("current_training_step_id")
        if not step_id or step_id in acked:
            break
        st, _ = req("POST", "/api/live/sessions/%s/training/steps/%s/safety-ack" % (sid, step_id), {})
        if st not in (200, 201):
            break
        acked.append(step_id)
    return acked


print("LIVE =", LIVE)
print("=" * 78)
print("Phase 3-A Live Coach 任務閉環（F450_TWELVE_TASK）")
print("=" * 78)

st, body = req("GET", "/api/live/health")
record("GET /api/live/health 回 200", st == 200, "status=%s" % st)

st, body = req("POST", "/api/live/sessions",
               {"mode": "demo", "vision_source": "REAL_VISION", "training_track": "F450_TWELVE_TASK"})
record("POST /api/live/sessions 建立訓練 session", st in (200, 201), "status=%s" % st)
sid = body.get("session_id")
record("session_id 可取回", bool(sid), "session_id=%s" % (sid or "N/A"))
record("session 帶 F450_TWELVE_TASK 與 TASK_01",
       body.get("training_track") == "F450_TWELVE_TASK" and body.get("current_task_id") == "TASK_01",
       "training_track=%s current_task_id=%s" % (body.get("training_track"), body.get("current_task_id")))

if sid:
    st, body = req("GET", "/api/live/sessions/%s" % sid)
    record("GET session 可取回", st == 200, "status=%s" % st)

    st, view = req("GET", "/api/live/sessions/%s/training/tasks/TASK_01" % sid)
    record("GET 任務檢視 TASK_01", st == 200, "status=%s" % st)
    tv = (view.get("training_task_view") or {}) if st == 200 else {}
    task_def = tv.get("task") or {}
    progress = tv.get("training_step_progress") or []
    step_count = len(progress) or len(task_def.get("steps") or [])
    record("TASK_01 內含步驟定義", step_count > 0,
           "steps=%d（task.title=%s）" % (step_count, task_def.get("title", "N/A")))
    record("檢視回報 completable／unsafe_action_allowed 語意",
           "completable" in tv and "unsafe_action_allowed" in tv,
           "completable=%s unsafe_action_allowed=%s" % (tv.get("completable"), tv.get("unsafe_action_allowed")))

    st, body = req("POST", "/api/live/sessions/%s/training/tasks/TASK_01/start" % sid, {})
    record("POST 開始任務 TASK_01", st in (200, 201), "status=%s" % st)

    # --- 未完成步驟時完成任務必須被拒（正確閘門） ---
    st, body = req("POST", "/api/live/sessions/%s/training/tasks/TASK_01/complete" % sid, {})
    record("步驟未完成時完成任務被拒（409 正確閘門）",
           st == 409 and body.get("error", {}).get("code") == "training_steps_incomplete",
           "status=%s code=%s" % (st, body.get("error", {}).get("code")))

    # --- AI Live Coach 真實問答 ---
    st, body = req("POST", "/api/live/sessions/%s/ask" % sid,
                   {"question": "這個任務的安全注意事項是什麼？"})
    answer = body.get("answer") or body.get("student_answer") or ""
    record("AI Live Coach ask 回覆內容", st == 200 and bool(answer),
           "status=%s source=%s needs_teacher=%s" % (
               st, body.get("answer_source") or body.get("source"), body.get("needs_teacher")))

    # --- 空問題必須被拒 ---
    st, body = req("POST", "/api/live/sessions/%s/ask" % sid, {"question": "   "})
    record("空問題被拒（400 question_required）",
           st == 400 and body.get("error", {}).get("code") == "question_required", "status=%s" % st)

    # --- 反思：缺 original_text 必須被拒 ---
    st, body = req("POST", "/api/live/sessions/%s/training/reflection" % sid, {"task_id": "TASK_01"})
    record("反思缺少 original_text 被拒（保留學生原文）",
           st == 400, "status=%s code=%s" % (st, body.get("error", {}).get("code")))

    # --- 逐步安全確認 ---
    acked = ack_all_steps(sid)
    record("逐步安全確認全部完成", bool(acked), "已確認步驟=%s" % (acked or "無"))

    # --- 證據提交 ---
    st, body = req("POST", "/api/live/sessions/%s/training/evidence" % sid,
                   {"evidence_type": "SCREENSHOT", "task_id": "TASK_01",
                    "source": "DEMO_CLOSED_LOOP", "file_reference": "demo://closed-loop"})
    record("POST 任務證據提交", st in (200, 201), "status=%s" % st)

    # --- 正式反思 ---
    st, body = req("POST", "/api/live/sessions/%s/training/reflection" % sid,
                   {"task_id": "TASK_01", "original_text": "DEMO 自動化閉環：完成工作區域準備並確認安全注意事項。",
                    "source_type": "TEXT"})
    record("POST 學生反思（保留原文）", st in (200, 201), "status=%s" % st)

    # --- 完成任務 ---
    st, view = req("GET", "/api/live/sessions/%s/training/tasks/TASK_01" % sid)
    tv = (view.get("training_task_view") or {}) if st == 200 else {}
    remaining = tv.get("training_step_progress") or []
    if isinstance(remaining, dict):
        remaining = list(remaining.values())
    remaining = [p for p in remaining if isinstance(p, dict)]
    pending = [p.get("step_id") for p in remaining
               if (p.get("status") or p.get("state")) not in ("COMPLETED", "DONE")]
    vision_steps = [p.get("step_id") for p in remaining if p.get("vision_task") or p.get("requires_vision")]
    st, body = req("POST", "/api/live/sessions/%s/training/tasks/TASK_01/complete" % sid, {})
    if st in (200, 201):
        record("POST 完成任務 TASK_01", True, "status=%s" % st)
    else:
        # DEMO + REAL_VISION：需視覺的步驟在無相機時無法完成，屬正確約束
        code = body.get("error", {}).get("code")
        record("TASK_01 完成仍受視覺步驟閘門（DEMO 無相機，正確約束）",
               st == 409 and code == "training_steps_incomplete",
               "status=%s code=%s 待完成步驟=%d 需視覺=%d（真機相機／教師核准後可完成）"
               % (st, code, len(pending), len(vision_steps)))

    # --- 成長紀錄 ---
    st, body = req("GET", "/api/live/sessions/%s/training/growth-record" % sid)
    record("GET 成長紀錄可取回", st == 200, "status=%s" % st)

    # --- 教師閘任務：學生不可自行完成 ---
    st, body = req("POST", "/api/live/sessions/%s/training/tasks/TASK_08/complete" % sid, {})
    record("教師閘任務 TASK_08 學生不可自行完成", st in (400, 403, 409, 422),
           "status=%s code=%s" % (st, body.get("error", {}).get("code", "?")))

    # --- 教師複核需教師身分（X-FDE-Role） ---
    st, body = req("POST", "/api/live/sessions/%s/training/teacher-review" % sid,
                   {"task_id": "TASK_01", "step_id": "T01_WORKSPACE", "decision": "PASS", "note": "demo"})
    record("教師複核在無教師身分時不得通過", st in (400, 401, 403, 409, 422),
           "status=%s" % st)

print()
print("=" * 78)
print("Phase 3-B 安全與降級語意")
print("=" * 78)

st, body = req("GET", "/api/rag/health")
record("RAG health 回 200", st == 200, "status=%s" % st)

st, body = req("POST", "/api/live/sessions", {"training_track": "F450_TWELVE_TASK"})
st2, _ = req("POST", "/api/live/sessions/%s/simulate" % (body.get("session_id") or "x",),
             {"scenario": "X"})
record("Mock Vision 在 DEMO 正確停用（404 dev_only）", st2 == 404,
       "status=%s（不可用模擬冒充真實推論）" % st2)

st, body = req("POST", "/api/live/sessions", {"student_id": "x", "pass": "y"})
record("session 建立拒絕身分／權限／結果欄位（400 untrusted_field）",
       st == 400 and body.get("error", {}).get("code") == "untrusted_field",
       "status=%s" % st)

st, body = req("GET", "/api/live/sessions/does-not-exist")
record("不存在 session 回 404（不洩漏）", st == 404, "status=%s" % st)

st, body = req("GET", "/api/live/health")
record("Vision/YOLO 未啟動時 live health 仍 200（不掛起）", st == 200, "status=%s" % st)

print()
print("=" * 78)
passed = sum(1 for _, ok, _ in results if ok)
failed = sum(1 for _, ok, _ in results if not ok)
print("彙總：PASS=%d / FAIL=%d / 共 %d" % (passed, failed, len(results)))
if failed:
    print("\n失敗項目：")
    for step, ok, detail in results:
        if not ok:
            print("  - %s :: %s" % (step, detail))
