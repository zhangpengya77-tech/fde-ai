from .models import StudentSurvey


PATH_DEFINITIONS = (
    {
        "key": "2.0",
        "title": "2.0 無人系統專業人才",
        "subtitle": "從「會操作」走向「完成專業任務」",
        "interest_field": "path_20_interest",
        "topics": ("Mission Planner", "航線規劃", "自動任務", "無人車 Rover", "3D 建模", "3D 列印", "陸空協同", "專業任務驗證"),
        "future_interest_map": {
            "inspection": "巡檢應用",
            "surveying": "測繪",
            "modeling_3d": "3D 建模",
            "printing_3d": "3D 列印",
            "route_planning": "航線規劃",
            "autonomous_mission": "自動任務",
            "rover": "無人車 Rover",
            "air_ground_coordination": "陸空協同",
        },
    },
    {
        "key": "2.5",
        "title": "2.5 FPV 工程應用",
        "subtitle": "建立個人 FPV 飛行與工程能力",
        "interest_field": "path_25_interest",
        "topics": ("FPV 組裝", "Betaflight", "ELRS", "VTX", "PID", "Blackbox", "維修", "實戰飛行"),
        "future_interest_map": {
            "fpv": "FPV 穿越機",
            "drone_assembly": "無人機組裝",
            "drone_repair": "無人機維修",
        },
    },
    {
        "key": "3.0",
        "title": "3.0 無人系統軟體工程師",
        "subtitle": "從無人載具應用進入 AI、軟體與自主系統",
        "interest_field": "path_30_interest",
        "topics": ("Python", "MAVLink", "QGC", "YOLO", "ROS 2", "Gazebo", "LiDAR", "多感測器融合", "自主導航"),
        "future_interest_map": {
            "ai_detection": "AI 目標檢測",
            "ai_training": "AI 模型訓練",
            "ros2": "ROS 2",
            "uas_software": "無人系統軟體開發",
        },
    },
)

PATH_INTEREST_SCORES = {
    StudentSurvey.PathInterest.VERY_INTERESTED: 4,
    StudentSurvey.PathInterest.INTERESTED: 3,
    StudentSurvey.PathInterest.LEARN_MORE: 2,
    StudentSurvey.PathInterest.NOT_NOW: 0,
}
PATH_INTEREST_LABELS = dict(StudentSurvey.PathInterest.choices)


def recommend_paths(survey):
    """Return up to two explainable path recommendations for a survey."""
    future_interests = set(survey.future_interests or [])
    ranked = []
    for index, definition in enumerate(PATH_DEFINITIONS):
        path_score = PATH_INTEREST_SCORES.get(getattr(survey, definition["interest_field"], ""), 0)
        matched_topics = [
            label
            for key, label in definition["future_interest_map"].items()
            if key in future_interests
        ]
        score = path_score + len(matched_topics)
        ranked.append(
            {
                **definition,
                "score": score,
                "matched_topics": matched_topics,
                "reasons": matched_topics or [
                    f"你在路徑選擇中表示：{PATH_INTEREST_LABELS.get(getattr(survey, definition['interest_field'], ''), '想先了解')}"
                ],
                "path_interest_label": PATH_INTEREST_LABELS.get(
                    getattr(survey, definition["interest_field"], ""), ""
                ),
                "sort_key": (-score, index),
            }
        )

    ranked.sort(key=lambda item: item["sort_key"])
    if not ranked or ranked[0]["score"] < 3:
        return []
    return [item for item in ranked if item["score"] > 0][:2]
