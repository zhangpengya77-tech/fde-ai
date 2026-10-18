"""模型倉庫服務層（PROP_DIRECTION_V1）。

本模組負責「把既有 R07 模型證據登錄進倉庫」，不執行推論、不訓練、不部署。

設計邊界（教師 2026-10-08 指令）：
    1. 不複製既有 R07 提交紀錄：只建立指向 Evidence 的入庫登錄。
    2. 四個狀態維度各自獨立，不得合併為單一狀態。
    3. 血緣可追溯：建立子版本時必須指向父版本。
    4. 班級隔離：所有查詢一律以 cohort 過濾。
    5. DEMO_TEST_ONLY 不得發布為正式訓練基礎。
    6. 已入庫模型保留檔案完整性（SHA256）與來源資訊。
"""

import hashlib

from django.core.exceptions import ValidationError
from django.db import transaction

from .models import VisionModelRecord
from .vision_snapshot import (
    SnapshotError,
    create_immutable_snapshot,
    resolve_evidence_artifact_path,
)

# 本輪唯一支援的任務類型。FOUR_SIDE_HOVER 尚未開放。
SUPPORTED_TASK_IDS = ("PROP_DIRECTION",)

# 檔名標記：帶此字串的檔案不得作為正式訓練基礎。
DEMO_MARKER = "DEMO_TEST_ONLY"


def compute_sha256(content: bytes) -> str:
    """計算 best.pt 的 SHA256，供入庫後驗證檔案完整性。"""
    return hashlib.sha256(content).hexdigest()


def is_demo_test_only(filename: str) -> bool:
    """判斷檔名是否標記為 DEMO_TEST_ONLY。"""
    return DEMO_MARKER in str(filename or "").upper()


def build_class_mapping(task_id: str, mapping=None) -> list:
    """建立類別索引對應表；未提供時回傳空清單，不得猜測。"""
    if mapping:
        return list(mapping)
    return []


def _review_status_of(evidence) -> str:
    """讀取 Evidence 上既有的教師審核狀態，作為入庫時的審核維度初值。

    入庫前提是教師已列為候選（CANDIDATE），因此倉庫紀錄的審核維度必須
    與 Evidence 的真實審核結果一致，不得一律退成 SUBMITTED。
    本函式只讀取既有 processed_metadata，**不修改 Evidence**。
    """
    processed = dict(evidence.processed_metadata or {})
    review = dict(processed.get("vision_model_review") or {})
    return str(review.get("status") or VisionModelRecord.ReviewStatus.SUBMITTED)


@transaction.atomic
def register_model_record(
    *,
    evidence,
    task_id: str,
    artifact_reference: str,
    artifact_sha256: str,
    artifact_size_bytes: int = 0,
    model_version: str = "V1",
    parent_record=None,
    dataset_version: str = "",
    class_mapping=None,
    data_yaml_reference: str = "",
    source_filename: str = "",
    snapshot: dict | None = None,
):
    """把既有 R07 模型證據登錄為倉庫紀錄。

    只新增入庫登錄，**不修改 Evidence 本身**，避免複製既有提交紀錄。
    新紀錄一律以保守狀態建立：
        審核 = 沿用 Evidence 的既有審核結果（入庫前提為 CANDIDATE）、
        驗證 = NOT_EVALUATED、訓練用途 = NOT_FOR_TRAINING、部署 = CATALOGUED
    """
    if task_id not in SUPPORTED_TASK_IDS:
        raise ValidationError(f"本輪僅支援任務類型：{'、'.join(SUPPORTED_TASK_IDS)}。")
    if not artifact_sha256:
        raise ValidationError("入庫必須提供 best.pt 的 SHA256，以保留檔案完整性。")
    if not artifact_reference:
        raise ValidationError("入庫必須提供 best.pt 參照。")
    if VisionModelRecord.objects.filter(evidence=evidence).exists():
        raise ValidationError("此證據已入庫，不得重複登錄。")

    enrollment = evidence.enrollment
    demo = is_demo_test_only(source_filename or artifact_reference)
    # 審核維度沿用 Evidence 的真實審核結果，不得一律退成 SUBMITTED。
    review_status = _review_status_of(evidence)
    # 快照欄位：未提供時維持 PENDING，代表尚無可用的獨立副本。
    snapshot = snapshot or {}
    snapshot_fields = {
        "snapshot_path": str(snapshot.get("relative_path") or ""),
        "snapshot_sha256": str(snapshot.get("sha256") or ""),
        "snapshot_size_bytes": int(snapshot.get("size_bytes") or 0),
        "snapshot_status": (
            VisionModelRecord.SnapshotStatus.STORED
            if snapshot.get("relative_path")
            else VisionModelRecord.SnapshotStatus.PENDING
        ),
        "source_artifact_reference": str(snapshot.get("source_artifact_reference") or ""),
    }

    if model_version == "V1":
        if parent_record is not None:
            raise ValidationError("V1 版本不得有父版本。")
    else:
        if parent_record is None:
            raise ValidationError(f"{model_version} 版本必須指定父版本以維持血緣。")
        if parent_record.cohort_id != enrollment.cohort_id:
            raise ValidationError("父版本與子版本必須屬於同一班級。")

    if parent_record is None:
        # V1：血緣起源指向自己，於建立後回填。
        record = VisionModelRecord.objects.create(
            evidence=evidence,
            task_id=task_id,
            student=enrollment.student,
            cohort=enrollment.cohort,
            model_version=model_version,
            parent_record=None,
            dataset_version=dataset_version,
            class_mapping=build_class_mapping(task_id, class_mapping),
            artifact_reference=artifact_reference,
            artifact_sha256=artifact_sha256,
            artifact_size_bytes=artifact_size_bytes,
            data_yaml_reference=data_yaml_reference,
            is_demo_test_only=demo,
            review_status=review_status,
            **snapshot_fields,
        )
        record.lineage_root = record
        record.save(update_fields=["lineage_root"])
        return record

    record = VisionModelRecord.objects.create(
        evidence=evidence,
        task_id=task_id,
        student=enrollment.student,
        cohort=enrollment.cohort,
        model_version=model_version,
        parent_record=parent_record,
        lineage_root=parent_record.lineage_root or parent_record,
        dataset_version=dataset_version,
        class_mapping=build_class_mapping(task_id, class_mapping),
        artifact_reference=artifact_reference,
        artifact_sha256=artifact_sha256,
        artifact_size_bytes=artifact_size_bytes,
        data_yaml_reference=data_yaml_reference,
        is_demo_test_only=demo,
        review_status=review_status,
        **snapshot_fields,
    )
    return record


def lineage_of(record) -> list:
    """回傳完整血緣鏈（由起源到自身），供追溯使用。"""
    chain = []
    current = record
    seen = set()
    while current is not None and current.pk not in seen:
        seen.add(current.pk)
        chain.append(current)
        current = current.parent_record
    return list(reversed(chain))


def records_for_teacher(teacher):
    """取得此教師有權限查看的倉庫紀錄；一律以班級授權過濾。"""
    from .models import TeacherCohortAccess

    cohort_ids = TeacherCohortAccess.objects.filter(teacher=teacher).values_list(
        "cohort_id", flat=True
    )
    return VisionModelRecord.objects.filter(cohort_id__in=list(cohort_ids))


def mark_demo_never_training_base(record):
    """確保 DEMO_TEST_ONLY 紀錄不得被標為訓練基底。

    此函式為防護用途：若旗標與訓練用途不一致，直接強制回正。
    """
    if record.is_demo_test_only and record.training_usage == VisionModelRecord.TrainingUsage.TRAINING_BASE:
        record.training_usage = VisionModelRecord.TrainingUsage.NOT_FOR_TRAINING
        record.save(update_fields=["training_usage", "updated_at"])
        return False
    return True


# 入庫前完整性檢查的穩定錯誤碼，供記錄與測試比對。
class IntakeError(Exception):
    """入庫檢查失敗；帶穩定錯誤碼以便記錄原因。"""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def hash_evidence_artifact(evidence) -> str:
    """計算 Evidence 上傳檔案的 SHA256。

    只讀取檔案位元組並計算雜湊，**不載入、不反序列化、不執行模型**。
    .pt 為 PyTorch pickle，反序列化即執行任意程式碼，故一律以純位元組方式處理。
    """
    if not evidence.upload:
        raise IntakeError("ARTIFACT_MISSING", "此證據沒有可用的 best.pt 檔案。")
    try:
        digest = hashlib.sha256()
        with evidence.upload.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except FileNotFoundError as exc:
        raise IntakeError("ARTIFACT_MISSING", "best.pt 檔案不存在於儲存空間。") from exc
    except ValueError as exc:
        # Django FileField 在檔案已遺失時，重新開啟會拋出 ValueError("The file cannot be reopened.")，
        # 需與 FileNotFoundError 一併視為「檔案不存在」，否則會變成未預期的 500 錯誤。
        if evidence.upload.storage.exists(evidence.upload.name):
            raise IntakeError("ARTIFACT_UNREADABLE", f"無法讀取 best.pt：{exc}") from exc
        raise IntakeError("ARTIFACT_MISSING", "best.pt 檔案不存在於儲存空間。") from exc
    except OSError as exc:
        raise IntakeError("ARTIFACT_UNREADABLE", f"無法讀取 best.pt：{exc.strerror or exc}") from exc
    return digest.hexdigest()


def _submitted_sha256(evidence) -> str:
    """取得提交時記錄的 SHA256（可能為空）。"""
    metadata = dict(evidence.original_metadata or {})
    return str(metadata.get("sha256") or "").strip().lower()


def check_intake_eligibility(*, evidence, teacher, model_version="V1", parent_record=None) -> str:
    """入庫前七項檢查；通過回傳實際 SHA256，失敗拋出 IntakeError。

    檢查項（依指令「二、模型檔案完整性」）：
        1. Evidence 是否存在
        2. 是否屬於授權教師可查看的班級
        3. best.pt 是否存在
        4. SHA256 是否與提交紀錄一致
        5. 是否為 DEMO_TEST_ONLY（僅記錄，不阻擋入庫，但不得成訓練基底）
        6. 重複入庫（ALREADY_CATALOGUED）
        7. Parent Model 是否合法（先於版本重複檢查，避免誤導錯誤原因）
        8. 模型版本是否重複（VERSION_DUPLICATE）

    **不得在檢查時載入或反序列化 .pt**：本函式只讀取位元組計算雜湊。
    """
    from .models import TeacherCohortAccess

    # 1. Evidence 是否存在
    if evidence is None or evidence.pk is None:
        raise IntakeError("EVIDENCE_NOT_FOUND", "找不到對應的模型證據。")

    # 2. 班級授權
    enrollment = evidence.enrollment
    if enrollment is None:
        raise IntakeError("ENROLLMENT_MISSING", "此證據未綁定任何班級。")
    if not TeacherCohortAccess.objects.filter(
        teacher=teacher, cohort_id=enrollment.cohort_id
    ).exists():
        raise IntakeError("COHORT_NOT_AUTHORIZED", "您沒有此模型所屬班級的權限。")

    # 3. best.pt 是否存在 + 4. SHA256 一致性
    actual_sha256 = hash_evidence_artifact(evidence)
    submitted = _submitted_sha256(evidence)
    if submitted and submitted != actual_sha256:
        raise IntakeError(
            "SHA256_MISMATCH",
            f"檔案雜湊與提交紀錄不符（提交 {submitted[:12]}…／實際 {actual_sha256[:12]}…）。",
        )

    # 7. Parent Model 合法性
    #    必須先於「版本重複」檢查：若 V1 誤帶父版本，應回報 V1 不得有父版本，
    #    而非回報版本重複，否則錯誤原因會被誤導。
    if model_version == "V1" and parent_record is not None:
        raise IntakeError("PARENT_NOT_ALLOWED", "V1 版本不得有父版本。")
    if model_version != "V1":
        if parent_record is None:
            raise IntakeError("PARENT_REQUIRED", f"{model_version} 版本必須指定父版本。")
        if parent_record.cohort_id != enrollment.cohort_id:
            raise IntakeError("PARENT_COHORT_MISMATCH", "父版本與子版本必須屬於同一班級。")
        if parent_record.task_id != "PROP_DIRECTION":
            raise IntakeError("PARENT_TASK_MISMATCH", "父版本任務類型不相符。")

    # 6. 版本重複
    if VisionModelRecord.objects.filter(evidence=evidence).exists():
        raise IntakeError("ALREADY_CATALOGUED", "此模型已入庫，不得重複收藏。")
    if parent_record is not None:
        if VisionModelRecord.objects.filter(
            lineage_root=parent_record.lineage_root_id or parent_record.pk,
            model_version=model_version,
            cohort_id=enrollment.cohort_id,
        ).exists():
            raise IntakeError("VERSION_DUPLICATE", f"{model_version} 版本已存在於此血緣。")
    else:
        # 同班已存在其他 V1 起源時不阻擋（不同學員可各有 V1），僅供追溯。
        pass

    return actual_sha256


def catalogue_model(
    *, evidence, teacher, model_version="V1", parent_record=None,
    dataset_version="", class_mapping=None, data_yaml_reference="",
):
    """教師收藏模型：完成檢查後建立獨立快照，再建立倉庫紀錄。

    流程（依 2026-10-08 指令「一、模型不可變快照」）：
        1. 入庫前七項完整性檢查（不載入 .pt）。
        2. 在隔離倉庫建立**獨立檔案副本**（內容雜湊命名、暫存檔 + 原子改名）。
        3. 建立 VisionModelRecord，保存快照路徑、SHA256 與來源 Evidence。
        4. 若步驟 3 失敗，清理本次未完成的快照檔，避免留下孤兒檔案。

    **原始 Evidence 與原始 best.pt 一律不搬移、不刪除、不就地修改。**
    入庫**不等於** VALIDATED 或 ACTIVE；一律以保守預設建立。
    """
    actual_sha256 = check_intake_eligibility(
        evidence=evidence,
        teacher=teacher,
        model_version=model_version,
        parent_record=parent_record,
    )
    metadata = dict(evidence.original_metadata or {})
    filename = str(metadata.get("filename") or "")
    source_reference = str(evidence.upload.name or filename or "best.pt")

    # 建立不可變快照；失敗一律拒絕入庫，不得建立「有紀錄卻無副本」的空殼。
    snapshot = None
    created_new_snapshot = False
    try:
        source_path = resolve_evidence_artifact_path(evidence)
        snapshot = create_immutable_snapshot(
            source_path=source_path, expected_sha256=actual_sha256
        )
        created_new_snapshot = not snapshot.get("deduplicated")
        snapshot["source_artifact_reference"] = source_reference
    except SnapshotError as exc:
        raise IntakeError(f"SNAPSHOT_{exc.code}", f"無法建立模型快照：{exc.message}") from exc

    try:
        record = register_model_record(
            evidence=evidence,
            task_id=str(metadata.get("task_type") or "PROP_DIRECTION"),
            artifact_reference=source_reference,
            artifact_sha256=actual_sha256,
            artifact_size_bytes=int(metadata.get("size_bytes") or 0),
            model_version=model_version,
            parent_record=parent_record,
            dataset_version=dataset_version,
            class_mapping=class_mapping,
            data_yaml_reference=data_yaml_reference,
            source_filename=filename,
            snapshot=snapshot,
        )
    except Exception:
        # 資料庫寫入失敗：清理本次才建立、且尚無任何紀錄指向的快照檔，
        # 避免留下孤兒檔案。若為去重命中（既有紀錄已在用），一律不動。
        if created_new_snapshot and snapshot:
            _discard_snapshot(snapshot.get("relative_path"))
        raise
    return record


def _discard_snapshot(relative_path: str) -> None:
    """清理未被任何紀錄引用的快照檔；失敗不得掩蓋原始例外。"""
    if not relative_path:
        return
    from .vision_snapshot import delete_snapshot_file

    try:
        if VisionModelRecord.objects.filter(snapshot_path=relative_path).exists():
            return
        delete_snapshot_file(relative_path)
    except Exception:  # noqa: BLE001 - 清理失敗不得掩蓋原始入庫錯誤
        pass
