"""Vision Model & Data Flywheel 資料契約與狀態維度定義（PROP_DIRECTION_V1）。

本模組只定義「資料契約」與「狀態維度」，不建立資料表、不執行推論。
設計原則（教師 2026-10-08 指令）：
    審核狀態、訓練用途、部署狀態是三個不同流程概念，不得混成單一欄位。
所有既有審核結果仍儲存在 Evidence.processed_metadata["vision_model_review"]，
本模組只負責維度映射與飛輪欄位規格，不產生第二套提交系統。
"""

# 審核流程狀態：由教師在模型審核頁決定，代表這份提交「被如何看待」。
REVIEW_STATUSES = ("SUBMITTED", "CANDIDATE", "REJECTED", "RETURNED")

# 驗證流程狀態：由 Golden Test / 基準測試決定，代表模型「是否被證明可用」。
VALIDATION_STATUSES = ("NOT_EVALUATED", "VALIDATED", "FAILED")

# 訓練用途：代表這顆模型「可否作為下一屆的訓練基底」，與部署無關。
TRAINING_USAGES = ("NOT_FOR_TRAINING", "TRAINING_BASE")

# 部署狀態：代表這顆模型「現在是否在學生端實際生效」，僅教師可變更。
DEPLOYMENT_STATUSES = ("CATALOGUED", "ACTIVE", "ARCHIVED")

# 飛輪倉庫項目規格：欄位名 → 說明。預留給未來正式資料表使用。
FLYWHEEL_FIELDS = (
    ("model_id", "模型唯一識別碼"),
    ("task_id", "所屬任務（僅支援 PROP_DIRECTION）"),
    ("student_id", "提交學員"),
    ("cohort_id", "所屬班級"),
    ("model_version", "模型版本（V1 / V2 / V3…）"),
    ("parent_model_id", "父版本模型；V1 為空"),
    ("dataset_version", "訓練資料集版本"),
    ("class_mapping", "類別索引對應表（學員 ID → 平台類別）"),
    ("artifact_reference", "best.pt 檔案參照"),
    ("data_yaml_reference", "data.yaml 參照（可為空）"),
    ("teacher_review", "教師審核摘要"),
    ("validation_history", "驗證歷程"),
    ("golden_test_result", "Golden Test 結果"),
    ("publication_scope", "發布範圍（哪些班級可取得）"),
    ("created_at", "建立時間"),
    ("updated_at", "更新時間"),
)


def build_flywheel_view(evidence):
    """把既有 Evidence 映射成飛輪倉庫檢視資料；不改動任何資料庫欄位。"""
    metadata = dict(evidence.original_metadata or {})
    processed = dict(evidence.processed_metadata or {})
    review = dict(processed.get("vision_model_review") or {})
    task_type = metadata.get("task_type", "") or ""

    return {
        "model_id": str(evidence.pk),
        "task_id": task_type,
        "student_name": evidence.enrollment.student.nickname,
        "cohort_id": evidence.enrollment.cohort_id,
        "model_version": review.get("model_version") or "V1",
        "parent_model_id": review.get("parent_model_id") or "",
        "dataset_version": metadata.get("dataset_version") or "",
        "class_mapping": review.get("class_mapping") or [],
        "artifact_reference": metadata.get("filename") or "best.pt",
        "data_yaml_reference": metadata.get("data_yaml_reference") or "",
        "teacher_review": {
            "status": review.get("status") or "SUBMITTED",
            "note": review.get("current_note") or "",
            "history": list(review.get("history") or []),
        },
        "validation_history": list(processed.get("validation_history") or []),
        "golden_test_result": processed.get("golden_test_result") or {},
        "publication_scope": list(processed.get("publication_scope") or []),
        "created_at": evidence.created_at,
        "updated_at": evidence.created_at,
    }


def review_status_of(evidence) -> str:
    """讀取既有審核狀態；未審核時視為 SUBMITTED。"""
    processed = dict(evidence.processed_metadata or {})
    review = dict(processed.get("vision_model_review") or {})
    return str(review.get("status") or "SUBMITTED")


def validation_status_of(evidence) -> str:
    """讀取驗證狀態；未驗證時為 NOT_EVALUATED。"""
    processed = dict(evidence.processed_metadata or {})
    return str(processed.get("validation_status") or "NOT_EVALUATED")


def training_usage_of(evidence) -> str:
    """讀取訓練用途；預設不可作為訓練基底。"""
    processed = dict(evidence.processed_metadata or {})
    return str(processed.get("training_usage") or "NOT_FOR_TRAINING")


def deployment_status_of(evidence) -> str:
    """讀取部署狀態；預設僅入庫，未 ACTIVE。"""
    processed = dict(evidence.processed_metadata or {})
    return str(processed.get("deployment_status") or "CATALOGUED")


def active_switch_blocked_reason(evidence) -> str:
    """判斷是否允許切換為 ACTIVE；回傳空字串代表允許。

    規則：未經 Golden Test 驗證（VALIDATED）不得啟用 ACTIVE。
    """
    if validation_status_of(evidence) != "VALIDATED":
        return "未通過 Golden Test 驗證，不可啟用 ACTIVE。"
    if review_status_of(evidence) != "CANDIDATE":
        return "尚未由教師列為候選，不可啟用 ACTIVE。"
    return ""
