import json
from pathlib import Path


PROJECT_DIRECTIONS_CONFIG = Path(__file__).parent / "data" / "project_directions_v1.json"

STUDENT_STATUS_LABELS = {
    "not_started": "○ 未開始",
    "in_progress": "🟡 進行中",
    "submitted": "待教師複核",
    "needs_revision": "需補充",
    "approved": "✅ 已完成",
    "rejected": "未通過",
}

TASK_STATUS_LABELS = {
    "not_started": "○ 未開始",
    "in_progress": "🟡 進行中",
    "submitted": "待教師複核",
    "reviewed": "✅ 已完成",
    "incomplete": "需補充",
    "skipped": "略過",
}


def load_project_directions():
    with PROJECT_DIRECTIONS_CONFIG.open(encoding="utf-8") as config_file:
        return json.load(config_file)


def direction_keys():
    return tuple(load_project_directions()["direction_keys"])


def direction_options():
    config = load_project_directions()
    return [(key, config[key]["title"]) for key in direction_keys()]


def learner_direction_options():
    return [
        *direction_options(),
        ("fpv", "FPV（第一人稱視角無人機）組"),
        ("", "無組別"),
        ("other", "其他"),
    ]


def direction_label(key):
    if not key:
        return "尚未選擇"
    return load_project_directions().get(key, {}).get("title", key)


def direction_content(enrollment, slot_id):
    config = load_project_directions()
    if slot_id in {f"R{i:02d}" for i in range(1, 6)}:
        return next(item for item in config["shared_growth_records"] if item["slot_id"] == slot_id)
    if enrollment.project_direction in direction_keys():
        return config[enrollment.project_direction].get(slot_id)
    return None


def task_display_id(task_id):
    task_id = str(task_id).upper()
    return f"M{task_id[1:]}" if task_id.startswith("T") and task_id[1:].isdigit() else task_id


def student_status_label(status):
    return STUDENT_STATUS_LABELS.get(status, status)


def task_status_label(status):
    return TASK_STATUS_LABELS.get(status, status)
