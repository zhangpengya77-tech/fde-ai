"""模型倉庫檔案完整性檢查（PROP_DIRECTION_V1）。

2026-10-08 教師指令「二、模型完整性檢查」的實作。

狀態定義：
    INTACT      ：檔案存在且 SHA256 與入庫紀錄一致
    MISSING     ：檔案不存在
    MODIFIED    ：SHA256 不一致
    NOT_CHECKED ：尚未檢查

設計原則：
    - 教師可觸發檢查並查看結果。
    - **不載入、不反序列化 .pt**：只做位元組串流雜湊。
    - 檔案損壞（MISSING / MODIFIED）時，不得作為後續訓練基底或發布。
    - **不自動刪除、不自動覆蓋**損壞檔案：保留現場以便追查。
    - **不自動切換 ACTIVE**：檢查只更新檢查欄位，不動部署狀態。
"""

from django.utils import timezone

from .models import VisionModelRecord
from .vision_snapshot import (
    SnapshotError,
    hash_file,
    read_snapshot,
)

# 完整性狀態常數（與 VisionModelRecord.IntegrityStatus 一致）。
INTACT = "INTACT"
MISSING = "MISSING"
MODIFIED = "MODIFIED"
NOT_CHECKED = "NOT_CHECKED"

INTEGRITY_STATUSES = (NOT_CHECKED, INTACT, MISSING, MODIFIED)

STATUS_LABELS = {
    NOT_CHECKED: "尚未檢查",
    INTACT: "完整",
    MISSING: "檔案不存在",
    MODIFIED: "內容已變動",
}


def check_record_integrity(record: VisionModelRecord) -> dict:
    """檢查單一倉庫紀錄的快照完整性；**唯讀，不修改任何檔案**。

    回傳：
        {
          "status": INTACT/MISSING/MODIFIED/NOT_CHECKED,
          "expected_sha256": ...,   # 入庫時記錄的雜湊
          "actual_sha256": ...,     # 本次實算；無法讀取時為空字串
          "actual_size_bytes": ...,
          "reason": ...,            # 異常原因（正常時為空字串）
        }
    """
    if not record.has_snapshot:
        return {
            "status": NOT_CHECKED,
            "expected_sha256": record.snapshot_sha256 or record.artifact_sha256 or "",
            "actual_sha256": "",
            "actual_size_bytes": 0,
            "reason": "此紀錄尚未建立快照，無法檢查。",
        }

    expected = record.snapshot_sha256 or record.artifact_sha256
    try:
        path = read_snapshot(record.snapshot_path)
    except SnapshotError as exc:
        return {
            "status": MISSING,
            "expected_sha256": expected,
            "actual_sha256": "",
            "actual_size_bytes": 0,
            "reason": exc.message,
        }

    import os

    if not os.path.isfile(path):
        return {
            "status": MISSING,
            "expected_sha256": expected,
            "actual_sha256": "",
            "actual_size_bytes": 0,
            "reason": "快照檔案不存在於倉庫中。",
        }

    try:
        actual = hash_file(path)
        size = os.path.getsize(path)
    except OSError as exc:
        return {
            "status": MISSING,
            "expected_sha256": expected,
            "actual_sha256": "",
            "actual_size_bytes": 0,
            "reason": f"無法讀取快照檔案：{exc.strerror or exc}",
        }

    if actual != expected:
        return {
            "status": MODIFIED,
            "expected_sha256": expected,
            "actual_sha256": actual,
            "actual_size_bytes": size,
            "reason": "快照內容與入庫紀錄不一致。",
        }

    return {
        "status": INTACT,
        "expected_sha256": expected,
        "actual_sha256": actual,
        "actual_size_bytes": size,
        "reason": "",
    }


def run_integrity_check(record: VisionModelRecord, *, save: bool = True) -> dict:
    """執行完整性檢查並（可選）寫回結果欄位。

    僅更新 integrity_status / integrity_checked_at / integrity_detail；
    **不變更部署狀態、驗證狀態、訓練用途**，亦不刪除或覆蓋任何檔案。
    """
    result = check_record_integrity(record)
    if save:
        record.integrity_status = result["status"]
        record.integrity_checked_at = timezone.now()
        record.integrity_detail = {
            "expected_sha256": result["expected_sha256"],
            "actual_sha256": result["actual_sha256"],
            "actual_size_bytes": result["actual_size_bytes"],
            "reason": result["reason"],
        }
        record.save(
            update_fields=[
                "integrity_status",
                "integrity_checked_at",
                "integrity_detail",
                "updated_at",
            ]
        )
    return result


def run_integrity_check_for_cohort(teacher, cohort_id=None) -> dict:
    """對教師可見的倉庫紀錄批次執行完整性檢查。

    只檢查該教師有授權的班級，避免跨班級讀取他人檔案。
    """
    from .vision_repository import records_for_teacher

    queryset = records_for_teacher(teacher)
    if cohort_id:
        queryset = queryset.filter(cohort_id=cohort_id)

    summary = {INTACT: 0, MISSING: 0, MODIFIED: 0, NOT_CHECKED: 0}
    checked = 0
    details = []
    for record in queryset.select_related("evidence"):
        result = run_integrity_check(record)
        summary[result["status"]] = summary.get(result["status"], 0) + 1
        checked += 1
        if result["status"] != INTACT:
            details.append(
                {
                    "model_id": str(record.pk),
                    "model_version": record.model_version,
                    "status": result["status"],
                    "reason": result["reason"],
                }
            )
    return {"checked": checked, "summary": summary, "abnormal": details}
