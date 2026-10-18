"""教師可選用的固定視覺模型規則模板。"""


RULE_TEMPLATES = {
    "PROP_DIRECTION": {
        "template_id": "PROP_DIRECTION_V1",
        "title": "槳葉正反面與方向規則",
        "model_classes": ("CW_F", "CCW_F", "CW_B", "CCW_B"),
        # F450 機體位置（教師 2026-10-08 確認）：M1 右前、M2 左後、M3 左前、M4 右後。
        # 必須與 live_backend/app/vision_center.py evaluate_prop 的位置定義一致，不得各自為政。
        "motor_positions": {
            "M1": "右前",
            "M2": "左後",
            "M3": "左前",
            "M4": "右後",
        },
        "result_states": ("PASS", "NG", "REVIEW"),
        "review_note": "低信心、未知類別或位置不足時，交由教師確認。",
    },
    "FOUR_SIDE_HOVER": {
        "template_id": "FOUR_SIDE_HOVER_V1",
        "title": "四面懸停方向規則",
        "model_classes": ("FRONT", "RIGHT", "BACK", "LEFT"),
        "result_states": ("PASS", "NG", "REVIEW"),
        "review_note": "未知方向、低信心或階段不相符時，交由教師確認。",
    },
}


# 依既有模型任務取得唯一可用的固定模板。
def template_for_task(task_type: str):
    return RULE_TEMPLATES.get(str(task_type or "").strip())


# 提供教師頁面使用的唯讀模板選項。
def template_choices_for_task(task_type: str) -> tuple[dict, ...]:
    template = template_for_task(task_type)
    return (template,) if template else ()
