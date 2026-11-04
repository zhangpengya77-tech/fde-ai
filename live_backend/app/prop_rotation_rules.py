"""F450 CW／CCW 教學測試版規則引擎（2026-11-03 教師指令：V1.0 教學測試版 SOP）。

只產生「候選結果」PASS／ERROR／UNKNOWN，一律待教師確認，不產生正式考核通過紀錄。
判定原則（寧可 UNKNOWN，不得誤判 PASS）：
- 照片需為俯視、機頭朝上；四支槳依相對機身中心的位置對應 M1 右前、M2 左後、M3 左前、M4 右後。
- 達信心門檻的槳不是 4 支、兩支落在同一象限 → UNKNOWN。
- 四支都符合 M3、M4 = CW，M1、M2 = CCW → PASS 候選。
- 2026-11-04 教師指令：有槳不對時要指出「哪一支錯、正確是什麼、怎麼改」。
  1～3 支不符 → ERROR（WRONG_PROP），逐支列出錯槳與修正步驟；
  4 支全部相反 → ERROR（ROTATION_REVERSED），先確認機頭方向再換槳。
"""

from __future__ import annotations

PROP_TEST_RULE_VERSION = "PROP_ROTATION_TEST_RULE_v2"
TEACHING_TEST_NOTICE = "測試結果，待教師確認"
DEFAULT_CONFIDENCE_THRESHOLD = 0.5

MOTORS = {
    "M1": {"position": "右前", "expected": "CCW"},
    "M2": {"position": "左後", "expected": "CCW"},
    "M3": {"position": "左前", "expected": "CW"},
    "M4": {"position": "右後", "expected": "CW"},
}
REASONS = {
    "OK": "四支槳旋向符合 F450 X 型安裝規則。",
    "NO_DETECTION": "未偵測到槳葉，無法辨識。",
    "LOW_CONFIDENCE": "達信心門檻的槳少於 4 支，信心不足無法判定。",
    "TOO_MANY_PROPS": "達信心門檻的槳多於 4 支，可能有重複框或背景誤判。",
    "POSITION_AMBIGUOUS": "槳的位置無法對應到四個馬達（請俯視、機頭朝上重拍）。",
    "WRONG_PROP": "有槳葉旋向裝錯，請依下方步驟更換。",
    "ROTATION_REVERSED": "四支槳旋向整組與規則相反，請檢查槳葉或機頭方向。",
}
PROP_NAMES = {"CW": "CW 正槳（順時針）", "CCW": "CCW 反槳（逆時針）"}


def wrong_prop_steps(wrong: list[dict]) -> list[str]:
    """依錯槳清單產生固定修正步驟（不依賴模型或 RAG，確保一定有可執行指令）。"""
    steps = ["關閉電源並拔下電池，確認馬達不會轉動後再動手。"]
    for item in wrong:
        steps.append(
            f"{item['motor']}（{item['position']}）目前是 {item['detected']}，"
            f"拆下後換成 {PROP_NAMES[item['expected']]}。"
        )
    steps += [
        "裝槳時槳葉文字朝上、較厚的前緣朝向該馬達旋轉方向，依槳帽標示鎖緊，用手輕拉確認不鬆脫。",
        "全機複查：左前 M3、右後 M4 為 CW；右前 M1、左後 M2 為 CCW（對角線同旋向）。",
        "從正上方俯視、機頭朝上重新拍照上傳，等待教師覆核。",
    ]
    return steps


REVERSED_STEPS = [
    "先確認照片是從正上方俯視、機頭朝上；若機頭方向拍錯，請轉正後重拍。",
    "若機頭方向正確，代表四支槳全部裝反：關閉電源拔下電池後，左前 M3、右後 M4 換成 CW，右前 M1、左後 M2 換成 CCW。",
    "依槳帽標示鎖緊並重新拍照上傳，等待教師覆核。",
]


def _center(detection: dict) -> tuple[float, float]:
    box = detection.get("bbox") or detection.get("box")
    if not isinstance(box, (list, tuple)) or len(box) != 4:
        raise ValueError("bbox_required")
    return (float(box[0]) + float(box[2])) / 2, (float(box[1]) + float(box[3])) / 2


def evaluate_teaching_candidate(detections: list[dict], confidence_threshold: float = DEFAULT_CONFIDENCE_THRESHOLD) -> dict:
    """依真實推論框產生候選結果；回傳的 is_official 永遠為 False。"""
    strong = sorted(
        (dict(item) for item in detections if float(item.get("confidence", 0)) >= confidence_threshold),
        key=lambda item: float(item["confidence"]), reverse=True,
    )
    result = {
        "rule_version": PROP_TEST_RULE_VERSION, "candidate": "UNKNOWN", "reason_code": "",
        "reason": "", "motors": {}, "wrong_props": [], "fix_steps": [], "confidence_threshold": confidence_threshold,
        "min_confidence": round(min((float(item["confidence"]) for item in strong), default=0.0), 4),
        "notice": TEACHING_TEST_NOTICE, "requires_teacher_confirmation": True, "is_official": False,
    }

    def unknown(code: str) -> dict:
        result.update(candidate="UNKNOWN", reason_code=code, reason=REASONS[code])
        return result

    if not detections:
        return unknown("NO_DETECTION")
    if len(strong) < 4:
        return unknown("LOW_CONFIDENCE")
    if len(strong) > 4:
        return unknown("TOO_MANY_PROPS")
    centers = [_center(item) for item in strong]
    cx = sum(x for x, _ in centers) / 4
    cy = sum(y for _, y in centers) / 4
    motors = {}
    for item, (x, y) in zip(strong, centers):
        motor = ("M3" if x < cx else "M1") if y < cy else ("M2" if x < cx else "M4")
        if motor in motors:
            return unknown("POSITION_AMBIGUOUS")
        motors[motor] = {
            **MOTORS[motor], "detected": str(item.get("class") or ""),
            "confidence": round(float(item["confidence"]), 4), "bbox": item.get("bbox") or item.get("box"),
        }
    result["motors"] = motors
    wrong = [
        {"motor": motor, "position": item["position"], "detected": item["detected"], "expected": item["expected"],
         "confidence": item["confidence"]}
        for motor, item in sorted(motors.items()) if item["detected"] != item["expected"]
    ]
    for item in wrong:
        motors[item["motor"]]["wrong"] = True
    if not wrong:
        result.update(candidate="PASS", reason_code="OK", reason=REASONS["OK"])
    elif len(wrong) == 4:
        result.update(candidate="ERROR", reason_code="ROTATION_REVERSED", reason=REASONS["ROTATION_REVERSED"],
                      wrong_props=wrong, fix_steps=list(REVERSED_STEPS))
    else:
        names = "、".join(f"{item['motor']}（{item['position']}）" for item in wrong)
        result.update(candidate="ERROR", reason_code="WRONG_PROP", reason=f"{names} 槳葉旋向裝錯，請依下方步驟更換。",
                      wrong_props=wrong, fix_steps=wrong_prop_steps(wrong))
    return result
