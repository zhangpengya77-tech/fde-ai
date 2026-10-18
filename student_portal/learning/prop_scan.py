"""學員手機端靜態圖片辨識（PROP_DIRECTION_V1）後端閘門。

安全立場（2026-10-10 教師指令）：
    1. 沒有真實推論結果時，不得顯示假檢測框、假可信度或假 PASS。
    2. 未找到符合 CW_F／CCW_F／CW_B／CCW_B 的真實模型時，標示 WAITING_FOR_MODEL。
    3. 本輪不使用 RAG；大模型只能根據「真實檢測結果 + 已確認安裝規則」提供繁中建議。
    4. 沒有真實辨識結果時，不呼叫大模型編造結論。

本模組只做狀態判定與規則組裝，不載入任何 .pt、不執行推論。
真正的推論必須經由通過隔離審查的 Runner（見 vision_verification.runner_state）。
"""

from pathlib import Path

from django.conf import settings

from .vision_rule_templates import template_for_task

# 本輪承認的 PROP 四類契約（順序即模型索引，必須嚴格一致）。
PROP_CLASS_CONTRACT = ("CW_F", "CCW_F", "CW_B", "CCW_B")

# 馬達位置（教師 2026-08-30／2026-10-08 確認）：M1 右前、M2 左後、M3 左前、M4 右後。
MOTOR_POSITIONS = {
    "M1": "右前",
    "M2": "左後",
    "M3": "左前",
    "M4": "右後",
}

# 每個馬達「預期」的方向與槳面；與 vision_rule_templates / vision_center.evaluate_prop 一致。
EXPECTED_BY_MOTOR = {
    "M1": {"direction": "CCW", "face": "F"},
    "M2": {"direction": "CCW", "face": "F"},
    "M3": {"direction": "CW", "face": "F"},
    "M4": {"direction": "CW", "face": "F"},
}

# 學員頁面可選的馬達清單（保持固定順序）。
MOTOR_IDS = ("M1", "M2", "M3", "M4")

# 畫面四象限 → 馬達對照（以圖片中心為原點，俯視、機頭朝上）。
# 左上＝左前＝M3、右上＝右前＝M1、左下＝左後＝M2、右下＝右後＝M4。
QUADRANT_TO_MOTOR = {
    "front_left": "M3",
    "front_right": "M1",
    "rear_left": "M2",
    "rear_right": "M4",
}


class PropScanBlocked(Exception):
    """無法產生真實辨識結果時拋出；呼叫端必須轉為 BLOCKED，不得偽造。"""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def model_status() -> dict:
    """查詢既有 Registry，只有完成安全與真實評估的 ACTIVE 模型才放行。"""
    from . import vision_submission

    base = {
        "class_contract": list(PROP_CLASS_CONTRACT),
        "next_step": "請由教師完成真實圖片驗證、合格評估及 ACTIVE 啟用。",
    }
    if getattr(settings, "VISION_DEMO_SIMULATION_ENABLED", False):
        try:
            demo = vision_submission.prop_check_status()
        except RuntimeError:
            demo = None
        if isinstance(demo, dict) and demo.get("status") == "DEMO_REVIEW_APPROVED" and demo.get("simulation_mode") is True:
            return {
                **base,
                "status": "READY",
                "label": "DEMO 模擬推論",
                "reason": "",
                "next_step": "星期日替換為真實 best.pt 後沿用相同流程。",
                "simulation_mode": True,
                "model_id": demo.get("model_id"),
                "model_version": demo.get("model_version"),
                "submission_id": demo.get("submission_id"),
            }
    try:
        records = vision_submission.list_models(model_type="PROP_DIRECTION")
    except RuntimeError:
        return {
            **base,
            "status": "BLOCKED",
            "label": "模型服務無法連線",
            "reason": "目前無法查詢 PROP_DIRECTION 模型狀態。",
        }

    active = [item for item in records if item.get("status") == "ACTIVE"]
    if not active:
        return {
            **base,
            "status": "WAITING_FOR_MODEL",
            "label": "等待合格模型",
            "reason": "目前沒有已啟用的 PROP_DIRECTION 模型。",
        }
    if len(active) != 1:
        return {
            **base,
            "status": "BLOCKED",
            "label": "模型狀態異常",
            "reason": "PROP_DIRECTION 同時存在多個 ACTIVE 模型，已停止學員辨識。",
        }

    model = active[0]
    model_path = Path(str(model.get("file_path") or ""))
    if not model_path.is_file():
        return {
            **base,
            "status": "BLOCKED",
            "label": "模型檔案不存在",
            "reason": "ACTIVE 模型紀錄存在，但模型檔案無法讀取。",
        }
    if tuple(model.get("class_names") or ()) != PROP_CLASS_CONTRACT:
        return {
            **base,
            "status": "BLOCKED",
            "label": "類別契約不符",
            "reason": "ACTIVE 模型類別必須依序為 CW_F、CCW_F、CW_B、CCW_B。",
        }
    if model.get("validation_status") != "VALIDATED":
        return {
            **base,
            "status": "BLOCKED",
            "label": "安全驗證未完成",
            "reason": "ACTIVE 模型尚未通過必要的模型安全驗證。",
        }

    fixture_text = " ".join(
        str(model.get(field) or "").lower()
        for field in ("model_name", "version", "uploaded_by", "notes", "source")
    )
    fixture_markers = ("demo_test_only", "smoke fixture", "smoke_fixture", "test fixture")
    if model.get("demo_test_only") or model.get("is_demo_test_only") or any(
        marker in fixture_text for marker in fixture_markers
    ):
        return {
            **base,
            "status": "BLOCKED",
            "label": "測試模型不可用於學員辨識",
            "reason": "目前 ACTIVE 模型屬於 DEMO_TEST_ONLY 或 Smoke Fixture 測試資料。",
        }

    required_metrics = {
        "precision", "recall", "map50", "map50_95", "per_class_metrics",
        "confusion_matrix", "error_count", "low_confidence_count",
    }
    metrics = model.get("metrics") or {}
    if model.get("evaluation_status") != "EVALUATED" or not required_metrics.issubset(metrics):
        return {
            **base,
            "status": "BLOCKED",
            "label": "真實評估未完成",
            "reason": "ACTIVE 模型尚無完整的真實圖片評估紀錄。",
        }

    return {
        **base,
        "status": "READY",
        "label": "可推论",
        "reason": "",
        "model_id": model.get("model_id"),
        "model_version": model.get("version"),
        "file_hash": model.get("file_hash"),
    }


def rule_table() -> dict:
    """回傳已確認的安裝規則對照表（唯讀，供前端顯示）。"""
    template = template_for_task("PROP_DIRECTION") or {}
    return {
        "template_id": template.get("template_id", "PROP_DIRECTION_V1"),
        "motor_positions": dict(MOTOR_POSITIONS),
        "expected": {
            motor: {
                "position": MOTOR_POSITIONS[motor],
                "direction": EXPECTED_BY_MOTOR[motor]["direction"],
                "face": EXPECTED_BY_MOTOR[motor]["face"],
            }
            for motor in MOTOR_IDS
        },
        "class_contract": list(PROP_CLASS_CONTRACT),
    }


def classify_class_name(class_name: str) -> dict:
    """把模型輸出的類別名解析為方向與槳面。

    只接受四類契約中的精確名稱；其餘一律視為未知，不做模糊對應。
    """
    name = str(class_name or "").strip().upper()
    if name not in PROP_CLASS_CONTRACT:
        return {"known": False, "class_name": name, "direction": None, "face": None}
    direction, face = name.split("_", 1)
    return {"known": True, "class_name": name, "direction": direction, "face": face}


def evaluate_motor(motor: str, detection: dict | None, confidence_threshold: float = 0.55) -> dict:
    """依已確認規則判定單一馬達。回傳 PASS／NG／INSUFFICIENT_DATA。

    detection 必須來自真實推論；為 None 時一律 INSUFFICIENT_DATA，
    絕不以預設值假裝 PASS。
    """
    expected = EXPECTED_BY_MOTOR.get(motor)
    if expected is None:
        return {
            "motor": motor, "result": "INSUFFICIENT_DATA",
            "reason_code": "UNKNOWN_MOTOR", "reason": "未知的馬達編號。",
        }
    base = {
        "motor": motor,
        "position": MOTOR_POSITIONS[motor],
        "expected_direction": expected["direction"],
        "expected_face": expected["face"],
        "detected_class": None,
        "detected_direction": None,
        "detected_face": None,
        "confidence": None,
    }
    if detection is None:
        return {**base, "result": "INSUFFICIENT_DATA", "reason_code": "MISSING_TARGET",
                "reason": f"{motor}（{MOTOR_POSITIONS[motor]}）未偵測到槳葉。"}

    parsed = classify_class_name(detection.get("class_name"))
    confidence = detection.get("confidence")
    base["detected_class"] = parsed["class_name"] or None
    base["detected_direction"] = parsed["direction"]
    base["detected_face"] = parsed["face"]
    base["confidence"] = confidence

    if not parsed["known"]:
        return {**base, "result": "INSUFFICIENT_DATA", "reason_code": "UNKNOWN_CLASS",
                "reason": f"偵測到的類別「{detection.get('class_name')}」不在四類契約中。"}
    if not isinstance(confidence, (int, float)) or confidence < confidence_threshold:
        return {**base, "result": "INSUFFICIENT_DATA", "reason_code": "LOW_CONFIDENCE",
                "reason": f"可信度 {confidence} 低於門檻 {confidence_threshold}，無法判定。"}

    direction_ok = parsed["direction"] == expected["direction"]
    face_ok = parsed["face"] == expected["face"]
    if direction_ok and face_ok:
        return {**base, "result": "PASS", "reason_code": "OK",
                "reason": f"{motor}（{MOTOR_POSITIONS[motor]}）方向與槳面皆正確。"}
    if not direction_ok and not face_ok:
        code, reason = "ROTATION_AND_FACE_WRONG", "槳葉方向與正反面皆相反。"
    elif not direction_ok:
        code, reason = "ROTATION_WRONG", f"槳葉方向錯誤（偵測 {parsed['direction']}，應為 {expected['direction']}）。"
    else:
        code, reason = "FACE_WRONG", f"槳葉正反面錯誤（偵測 {parsed['face']} 面，應為 {expected['face']} 面）。"
    return {**base, "result": "NG", "reason_code": code, "reason": reason}


def evaluate_selection(selection: dict, detections: list, confidence_threshold: float = 0.55) -> dict:
    """依學員選擇的馬達與真實推論結果，產生整體判定。

    selection: {"M1": detections 索引或 None, ...} 由呼叫端對照後傳入。
    detections: 真實推論輸出 [{"class_name","confidence","box"}...]
    回傳 status ∈ {PASS, NG, INSUFFICIENT_DATA}
    """
    checks = []
    for motor in MOTOR_IDS:
        index = selection.get(motor)
        detection = None
        if isinstance(index, int) and 0 <= index < len(detections):
            detection = detections[index]
        checks.append(evaluate_motor(motor, detection, confidence_threshold))

    results = [item["result"] for item in checks]
    if "NG" in results:
        status = "NG"
    elif any(item == "INSUFFICIENT_DATA" for item in results):
        status = "INSUFFICIENT_DATA"
    else:
        status = "PASS"
    return {
        "status": status,
        "checks": checks,
        "pass_count": results.count("PASS"),
        "ng_count": results.count("NG"),
        "insufficient_count": results.count("INSUFFICIENT_DATA"),
    }


def build_explanation(motor_checks: list, status: str) -> dict:
    """依「真實檢測結果 + 已確認安裝規則」組裝繁體中文建議。

    本輪不使用 RAG，也不是自由生成：文字只由已確認規則與實際偵測值組合而成，
    因此不會在沒有真實辨識結果時編造結論。
    """
    if status == "INSUFFICIENT_DATA":
        headline = "目前無法完成判定，請重新拍攝或請教師協助。"
    elif status == "NG":
        headline = "槳葉安裝有誤，請依下列說明調整後重新拍照。"
    else:
        headline = "四顆馬達槳葉方向與正反面皆符合 F450 安裝規則。"

    details = []
    for item in motor_checks:
        motor = item["motor"]
        position = item.get("position") or MOTOR_POSITIONS.get(motor, "")
        if item["result"] == "PASS":
            details.append(f"{motor}（{position}）：正確，方向 {item['expected_direction']}、槳面 {item['expected_face']} 面。")
            continue
        if item["result"] == "NG":
            details.append(f"{motor}（{position}）：錯誤。{item['reason']}請更換為 {item['expected_direction']} 槳，並讓 {item['expected_face']} 面朝上。")
            continue
        details.append(f"{motor}（{position}）：資料不足，{item['reason']}")

    if status == "NG":
        safety = "調整槳葉前請先斷電，並確認馬達已完全停止；完成後請教師複核再進行通電測試。"
    elif status == "PASS":
        safety = "此為 AI 初步判定，實際通電與飛行前仍須由教師確認。"
    else:
        safety = "未取得完整辨識結果前，請勿通電測試。"

    return {
        "source": "RULE_BASED_ZH_TW",
        "rag_used": False,
        "headline": headline,
        "details": details,
        "safety_note": safety,
        "tts_text": "。".join([headline] + details + [safety]),
    }
