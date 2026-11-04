"""鷹眼 AI 檢測頁（/platform/eagle）的 AI 助教（2026-11-04 教師指令）。

槳葉檢測結果出來後，前台把 M1～M4 的檢測結果送到這裡，回傳：
1. 判定說明：固定規則組成（例如「3 號槳應該是 CW，但目前檢測是 CCW…所以未通過」），不經 LLM。
2. 知識庫說明：F450 RAG 的回答與出處（只在未通過時查詢）。
3. 大模型解說：沿用 rotation_tutor 的 LLM 呼叫；未設定金鑰或失敗時省略，其他部分照常。
前台會自動朗讀判定說明與知識庫說明；大模型解說由學員按「AI 助教解說」取得。
只接受結構化檢測結果（不收照片），並嚴格驗證欄位，避免被拿來當任意 LLM 代理。
"""

import hashlib
import json

from . import rotation_guidance, rotation_tutor

# F450 X 型標準：位置與正確旋向（與規則引擎、知識庫一致）
STANDARD = {
    "M1": ("右前", "CCW"),
    "M2": ("左後", "CCW"),
    "M3": ("左前", "CW"),
    "M4": ("右後", "CW"),
}
DIRECTIONS = {"CW", "CCW"}


class TutorInputError(ValueError):
    """前台送來的檢測結果格式不正確。"""


def evaluation_from_payload(payload):
    """把前台的 M1～M4 結果轉成 rotation_tutor 使用的評估格式；只採用白名單欄位。"""
    if not isinstance(payload, dict) or payload.get("task") != "f450_propeller_check":
        raise TutorInputError("unsupported_task")
    motors_in = payload.get("motors")
    if not isinstance(motors_in, list) or not 1 <= len(motors_in) <= 4:
        raise TutorInputError("motors_required")
    motors = {}
    for item in motors_in:
        if not isinstance(item, dict):
            raise TutorInputError("invalid_motor")
        motor = str(item.get("motor") or "").upper()
        if motor not in STANDARD or motor in motors:
            raise TutorInputError("invalid_motor")
        detected = str(item.get("detected") or "").upper()
        position, expected = STANDARD[motor]
        motors[motor] = {
            "position": position,
            "expected": expected,
            # 偵測不到或不是 CW／CCW 一律視為「無法判斷」，不猜測
            "detected": detected if detected in DIRECTIONS else None,
        }
    wrong = [
        {"motor": m, "position": v["position"], "expected": v["expected"], "detected": v["detected"]}
        for m, v in sorted(motors.items()) if v["detected"] and v["detected"] != v["expected"]
    ]
    complete = len(motors) == 4 and all(v["detected"] for v in motors.values())
    if wrong:
        candidate = "ERROR"
        reason_code = "ROTATION_REVERSED" if len(wrong) == 4 else "WRONG_PROP"
    elif complete:
        candidate, reason_code = "PASS", "OK"
    else:
        candidate, reason_code = "UNKNOWN", "INCOMPLETE"
    evaluation = {
        "candidate": candidate,
        "reason_code": reason_code,
        "motors": motors,
        "wrong_props": wrong,
        "fix_steps": [
            "{}（{}）換成 {} 槳".format(item["motor"], item["position"], item["expected"]) for item in wrong
        ],
    }
    if candidate == "UNKNOWN":
        evaluation["reason"] = "沒有完整辨識到四支槳葉。"
    return evaluation


def cache_key(evaluation, with_llm):
    """相同檢測結果共用快取，避免重複呼叫知識庫與大模型。"""
    digest = hashlib.sha256(json.dumps(
        {"m": evaluation["motors"], "llm": bool(with_llm)}, sort_keys=True, ensure_ascii=False,
    ).encode("utf-8")).hexdigest()[:32]
    return "eagle-ai-tutor:" + digest


def tutor_answer(evaluation, *, with_llm=False):
    """組成判定、知識庫與（選擇性）大模型解說，以及要朗讀的文字。"""
    verdict = rotation_tutor.verdict_text(evaluation)
    rag = rotation_guidance.ask_rotation_guidance(evaluation) if evaluation["candidate"] == "ERROR" else {}
    llm = rotation_tutor.llm_explanation(evaluation, verdict, rag) if with_llm else ""
    rag_text = rag.get("answer", "") if rag.get("available") else ""
    return {
        "candidate": evaluation["candidate"],
        "verdict": verdict,
        "wrong_props": evaluation["wrong_props"],
        "fix_steps": evaluation["fix_steps"],
        "rag": rag,
        "llm": llm,
        "llm_requested": bool(with_llm),
        "llm_available": bool(llm),
        # 自動朗讀：判定＋知識庫；按下 AI 助教解說後再加上大模型解說
        "speech_text": " ".join(part for part in (verdict, rag_text, llm) if part)[:2000],
    }
