"""Golden Set（黃金測試集）服務層（PROP_DIRECTION_V1）。

2026-10-09 教師第 23 輪指令「二、Golden Set 管理中心」的實作。

設計原則：
    1. **重用既有結構**：本模組沿用既有 `live_backend/app/vision_center.py`
       的 golden set 概念（golden_set_id / model_type / status），
       Django 端只補上教師後台需要的版本、樣本與鎖定能力，
       不建立第二套平行資料來源。
    2. 本輪只支援 PROP_DIRECTION_V1 一個任務類型，其餘一律拒絕。
    3. 四類標籤固定為 CW_F / CCW_F / CW_B / CCW_B，不得自創類別。
    4. 版本一旦 FROZEN，任何新增、修改、刪除樣本的操作一律拒絕。
    5. **不載入、不推論任何模型檔案**：本模組只處理照片與標籤。

本模組不執行推論、不訓練、不部署、不變更模型倉庫的任何狀態維度。
"""

import hashlib

from django.db import transaction
from django.utils import timezone

from .models import GoldenSet, GoldenSetSample
from .golden_set_guard import open_freeze_seal

# 本輪唯一支援的任務類型；與 vision_repository.SUPPORTED_TASK_IDS 一致。
SUPPORTED_TASK_IDS = ("PROP_DIRECTION",)

# 供教師端統一引用的別名，避免 views 自行硬編碼任務清單。
SUPPORTED_GOLDEN_TASK_IDS = SUPPORTED_TASK_IDS

# 四類固定標籤；與後端 PROP_CLASSES 完全一致，不得各自為政。
PROP_LABELS = ("CW_F", "CCW_F", "CW_B", "CCW_B")

# 供教師端顯示用的標籤（值, 說明），與 GoldenSet.Label 保持一致。
GOLDEN_LABELS = (
    ("CW_F", "順時針正面"),
    ("CCW_F", "逆時針正面"),
    ("CW_B", "順時針背面"),
    ("CCW_B", "逆時針背面"),
)

# 單張測試照片的位元組上限（10 MB）；避免誤傳大型檔案拖垮教師後台。
MAX_SAMPLE_BYTES = 10 * 1024 * 1024

# 允許的照片格式；僅接受影像，不接受任何模型檔。
ALLOWED_IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png", ".webp", ".bmp")


class GoldenSetError(Exception):
    """Golden Set 操作失敗；帶穩定錯誤碼以便記錄與測試比對。"""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def default_golden_set_id(task_id: str, version: str = "v1") -> str:
    """依既有後端慣例產生 golden_set_id，例如 PROP_GOLDEN_v1。

    與 `vision_center.create_golden_set` 的預設命名保持一致，
    使 Django 端與既有 JSON 註冊表可以用同一個 ID 對應同一份測試集。
    """
    prefix = {"PROP_DIRECTION": "PROP", "FOUR_SIDE_HOVER": "HOVER"}.get(task_id, task_id)
    cleaned = str(version or "v1").strip() or "v1"
    if not cleaned.startswith("v"):
        cleaned = f"v{cleaned}"
    return f"{prefix}_GOLDEN_{cleaned}"


def validate_task_id(task_id: str) -> str:
    """驗證任務類型；本輪僅支援 PROP_DIRECTION。"""
    cleaned = str(task_id or "").strip()
    if cleaned not in SUPPORTED_TASK_IDS:
        raise GoldenSetError(
            "TASK_NOT_SUPPORTED",
            f"本輪僅支援 {SUPPORTED_TASK_IDS[0]}，收到 {cleaned or '(空)'}。",
        )
    return cleaned


def validate_label(label: str) -> str:
    """驗證標籤必須為四類之一。"""
    cleaned = str(label or "").strip()
    if cleaned not in PROP_LABELS:
        raise GoldenSetError(
            "LABEL_INVALID",
            f"標籤必須為 {'、'.join(PROP_LABELS)} 之一，收到 {cleaned or '(空)'}。",
        )
    return cleaned


def hash_bytes(content: bytes) -> str:
    """計算照片內容 SHA256（只用於去重與追溯，與模型檔案無關）。"""
    digest = hashlib.sha256()
    digest.update(content)
    return digest.hexdigest()


def _validate_image_upload(image) -> tuple:
    """驗證上傳照片；回傳 (content, sha256)。

    拒絕條件：非影像副檔名、空檔案、超過大小上限。
    **不解析影像內容、不載入任何模型**。
    """
    if image is None:
        raise GoldenSetError("SAMPLE_IMAGE_REQUIRED", "請選擇要上傳的測試照片。")
    name = str(getattr(image, "name", "") or "")
    lowered = name.lower()
    if not lowered.endswith(ALLOWED_IMAGE_SUFFIXES):
        raise GoldenSetError(
            "SAMPLE_IMAGE_TYPE_INVALID",
            f"僅接受影像檔（{'、'.join(ALLOWED_IMAGE_SUFFIXES)}），收到 {name or '(未命名)'}。",
        )
    try:
        image.seek(0)
        content = image.read()
    except (OSError, ValueError) as exc:
        raise GoldenSetError("SAMPLE_IMAGE_UNREADABLE", "無法讀取上傳的照片內容。") from exc
    if not content:
        raise GoldenSetError("SAMPLE_IMAGE_EMPTY", "上傳的照片是空檔案。")
    if len(content) > MAX_SAMPLE_BYTES:
        raise GoldenSetError(
            "SAMPLE_IMAGE_TOO_LARGE",
            f"照片大小 {len(content)} bytes 超過上限 {MAX_SAMPLE_BYTES} bytes。",
        )
    try:
        image.seek(0)
    except (OSError, ValueError):
        pass
    return content, hash_bytes(content)


@transaction.atomic
def create_golden_set(
    *,
    teacher,
    name: str,
    version: str = "v1",
    task_id: str = "PROP_DIRECTION",
    description: str = "",
    cohort=None,
    golden_set_id: str = "",
) -> GoldenSet:
    """建立新的 Golden Set 版本；初始狀態為 DRAFT。"""
    task = validate_task_id(task_id)
    cleaned_name = str(name or "").strip()
    if not cleaned_name:
        raise GoldenSetError("NAME_REQUIRED", "請填寫測試集名稱。")

    identifier = str(golden_set_id or "").strip() or default_golden_set_id(task, version)
    if GoldenSet.objects.filter(golden_set_id=identifier).exists():
        raise GoldenSetError(
            "GOLDEN_SET_EXISTS", f"測試集識別碼 {identifier} 已存在，請改用其他版本。"
        )

    return GoldenSet.objects.create(
        golden_set_id=identifier,
        task_id=task,
        model_type=task,
        name=cleaned_name,
        description=str(description or "").strip(),
        version=str(version or "v1").strip() or "v1",
        status=GoldenSet.Status.DRAFT,
        created_by=teacher,
        cohort=cohort,
    )


def add_sample(
    *,
    golden_set: GoldenSet,
    teacher,
    image,
    label: str,
    annotation_source: str = GoldenSet.AnnotationSource.TEACHER_PHOTO,
    note: str = "",
    confirm_now: bool = False,
) -> GoldenSetSample:
    """新增一張測試照片到指定 Golden Set 版本。

    已鎖定（FROZEN）的版本一律拒絕，確保既有評估結果可重現。
    """
    blocked = golden_set.mutation_blocked_reason()
    if blocked:
        raise GoldenSetError("GOLDEN_SET_FROZEN", blocked)

    cleaned_label = validate_label(label)
    source = str(annotation_source or "").strip() or GoldenSet.AnnotationSource.TEACHER_PHOTO
    if source not in GoldenSet.AnnotationSource.values:
        raise GoldenSetError(
            "ANNOTATION_SOURCE_INVALID", f"不支援的標註來源：{source}。"
        )

    if image is not None and hasattr(image, "size") and image.size == 0:
        raise GoldenSetError("SAMPLE_IMAGE_EMPTY", "上傳的照片是空檔案。")

    with transaction.atomic():
        sample = GoldenSetSample(
            golden_set=golden_set,
            label=cleaned_label,
            annotation_source=source,
            confirmation_status=GoldenSet.ConfirmationStatus.PENDING,
            note=str(note or "").strip()[:255],
        )
        # image.size 需要檔案物件；先記錄以便寫入後計算雜湊。
        # 注意：上傳物件不一定支援 seek（例如串流包裝），因此一律先探測再呼叫，
        # 避免在「確定可以讀取」之前就因 AttributeError 中斷整個新增流程。
        content = None
        if hasattr(image, "read"):
            try:
                if hasattr(image, "seek"):
                    image.seek(0)
                content = image.read()
                if hasattr(image, "seek"):
                    image.seek(0)
            except (OSError, ValueError):
                content = None
        if content is not None:
            _validate_image_content(content, getattr(image, "name", ""))
            sample.content_sha256 = hash_bytes(content)
        sample.image.save(str(getattr(image, "name", "sample.jpg")), image, save=False)
        if confirm_now:
            sample.confirmation_status = GoldenSet.ConfirmationStatus.CONFIRMED
            sample.confirmed_by = teacher
            sample.confirmed_at = timezone.now()
        sample.save()
    return sample


def _validate_image_content(content: bytes, name: str) -> None:
    """驗證已讀入的影像位元組。"""
    lowered = str(name or "").lower()
    if not lowered.endswith(ALLOWED_IMAGE_SUFFIXES):
        raise GoldenSetError(
            "SAMPLE_IMAGE_TYPE_INVALID",
            f"僅接受影像檔（{'、'.join(ALLOWED_IMAGE_SUFFIXES)}），收到 {name or '(未命名)'}。",
        )
    if not content:
        raise GoldenSetError("SAMPLE_IMAGE_EMPTY", "上傳的照片是空檔案。")
    if len(content) > MAX_SAMPLE_BYTES:
        raise GoldenSetError(
            "SAMPLE_IMAGE_TOO_LARGE",
            f"照片大小 {len(content)} bytes 超過上限 {MAX_SAMPLE_BYTES} bytes。",
        )


@transaction.atomic
def confirm_sample(*, sample: GoldenSetSample, teacher, note: str = "") -> GoldenSetSample:
    """教師確認某張樣本的標籤；已鎖定版本拒絕變更。"""
    blocked = sample.golden_set.mutation_blocked_reason()
    if blocked:
        raise GoldenSetError("GOLDEN_SET_FROZEN", blocked)
    sample.confirmation_status = GoldenSet.ConfirmationStatus.CONFIRMED
    sample.confirmed_by = teacher
    sample.confirmed_at = timezone.now()
    if note:
        sample.note = str(note).strip()[:255]
    sample.save(update_fields=["confirmation_status", "confirmed_by", "confirmed_at", "note"])
    return sample


@transaction.atomic
def reject_sample(*, sample: GoldenSetSample, teacher, note: str = "") -> GoldenSetSample:
    """教師退回某張樣本；已鎖定版本拒絕變更。"""
    blocked = sample.golden_set.mutation_blocked_reason()
    if blocked:
        raise GoldenSetError("GOLDEN_SET_FROZEN", blocked)
    sample.confirmation_status = GoldenSet.ConfirmationStatus.REJECTED
    sample.confirmed_by = teacher
    sample.confirmed_at = timezone.now()
    if note:
        sample.note = str(note).strip()[:255]
    sample.save(update_fields=["confirmation_status", "confirmed_by", "confirmed_at", "note"])
    return sample


@transaction.atomic
def freeze_golden_set(*, golden_set: GoldenSet, teacher) -> GoldenSet:
    """鎖定測試集版本。

    鎖定後不得再新增、修改或刪除樣本，確保同一版本可重現。
    四類標籤必須皆有已確認樣本，否則拒絕鎖定——避免鎖出一份缺類別的測試集。
    """
    if golden_set.is_frozen:
        raise GoldenSetError("GOLDEN_SET_ALREADY_FROZEN", "此測試集版本已經鎖定。")

    missing = golden_set.missing_labels()
    if missing:
        raise GoldenSetError(
            "GOLDEN_SET_INCOMPLETE",
            f"四類標籤必須皆有已確認樣本才能鎖定；尚缺：{'、'.join(missing)}。",
        )

    golden_set.status = GoldenSet.Status.FROZEN
    golden_set.frozen_at = timezone.now()
    golden_set.frozen_by = teacher
    # 在鎖定當下把 Manifest 雜湊綁進紀錄；之後任何樣本變更都會造成 MISMATCH。
    # 使用 update_fields 明確列出，避免 updated_at 以外的欄位被意外寫入。
    golden_set.manifest_contract_version = GOLDEN_SET_CONTRACT_VERSION
    golden_set.manifest_sha256 = ""
    golden_set.save(
        update_fields=[
            "status",
            "frozen_at",
            "frozen_by",
            "manifest_contract_version",
            "manifest_sha256",
            "updated_at",
        ]
    )
    # 第 25 輪 P1 修復：Model 層守衛已上線，FROZEN 後不得再改動契約欄位。
    # 但「寫回剛算出的 manifest_sha256」是鎖定流程本身的必要收尾，
    # 因此以一次性、限交易內的許可放行這一步；用完即失效。
    golden_set.manifest_sha256 = manifest_sha256(golden_set)
    with open_freeze_seal():
        golden_set.save(update_fields=["manifest_sha256", "updated_at"])
    return golden_set


def golden_set_summary(golden_set: GoldenSet) -> dict:
    """彙整單一測試集的摘要，供教師頁面與 Golden Test 頁面顯示。"""
    distribution = golden_set.label_distribution()
    return {
        "golden_set_id": golden_set.golden_set_id,
        "task_id": golden_set.task_id,
        "name": golden_set.name,
        "version": golden_set.version,
        "status": golden_set.status,
        "is_frozen": golden_set.is_frozen,
        "sample_count": golden_set.sample_count,
        "confirmed_sample_count": golden_set.confirmed_sample_count,
        "label_distribution": distribution,
        "missing_labels": golden_set.missing_labels(),
        "created_at": golden_set.created_at,
        "frozen_at": golden_set.frozen_at,
    }


def golden_sets_for_teacher(user):
    """教師可見的測試集查詢集。

    沿用既有倉庫的班級隔離精神：教師只看得到自己建立的、
    或屬於其授權班級的測試集。
    """
    from .views import teacher_cohorts

    cohorts = teacher_cohorts(user)
    return (
        GoldenSet.objects.filter(created_by=user) | GoldenSet.objects.filter(cohort__in=cohorts)
    ).distinct()


# =====================================================================
# Golden Set 版本化契約（第 24 輪指令「三」）
#
# 目的：讓一份已鎖定的 Golden Set 能被**獨立重建與驗證**，
#       不必信任任何一端的資料庫狀態。
# =====================================================================

# 契約版本；欄位語意變更時必須遞增，避免舊 Manifest 被誤讀。
GOLDEN_SET_CONTRACT_VERSION = "GOLDEN_SET_CONTRACT_V1"

# 正式評估的最低樣本數門檻（每類）。
# 第 24 輪指令「五」要求：本輪先設計規則，**不設定未經驗證的合格分數門檻**。
# 因此這裡只設定「能讓四類都出現」的結構性下限，不宣稱這是統計上的可靠門檻。
MIN_SAMPLES_PER_CLASS_FOR_EVALUATION = 2

# 完整度等級。
COMPLETENESS_STRUCTURAL = "STRUCTURAL_COMPLETE"
COMPLETENESS_EVALUATION_READY = "EVALUATION_READY"
COMPLETENESS_INCOMPLETE = "INCOMPLETE"


def build_manifest(golden_set) -> dict:
    """產生 Golden Set 的版本化 Manifest（純資料，不含任何模型資訊）。

    Manifest 是**可離線重建的契約**：只要拿到 Manifest 與樣本，
    第三方即可驗證這份測試集是否被動過。

    FROZEN 後 Manifest 內容必須完全固定；任何修正都必須建立新版本。
    """
    samples = []
    for sample in golden_set.samples.order_by("created_at", "sample_id"):
        samples.append(
            {
                "sample_id": str(sample.sample_id),
                "image_sha256": str(sample.content_sha256 or ""),
                "image_name": str(getattr(sample.image, "name", "") or ""),
                "label": sample.label,
                "annotation_source": sample.annotation_source,
                "confirmation_status": sample.confirmation_status,
                "confirmed_by": (
                    str(sample.confirmed_by.username) if sample.confirmed_by_id else None
                ),
                "confirmed_at": (
                    sample.confirmed_at.isoformat() if sample.confirmed_at else None
                ),
            }
        )

    frozen_at = golden_set.frozen_at.isoformat() if golden_set.frozen_at else None
    per_class = golden_set.label_distribution()

    return {
        "contract_version": GOLDEN_SET_CONTRACT_VERSION,
        "golden_set_id": golden_set.golden_set_id,
        "task_id": golden_set.task_id,
        "version": golden_set.version,
        "name": golden_set.name,
        "status": golden_set.status,
        "frozen_at": frozen_at,
        "frozen_by": (
            str(golden_set.frozen_by.username) if golden_set.frozen_by_id else None
        ),
        "sample_count": len(samples),
        "confirmed_sample_count": golden_set.confirmed_sample_count,
        "per_class_count": per_class,
        "class_contract": list(PROP_LABELS),
        "source": "DJANGO_GOLDEN_SET_CENTER",
        "provenance": {
            "created_by": (
                str(golden_set.created_by.username) if golden_set.created_by_id else None
            ),
            "created_at": golden_set.created_at.isoformat(),
            "cohort": golden_set.cohort.cohort_id if golden_set.cohort_id else None,
            "authority": "DJANGO",
        },
        "samples": samples,
    }


def canonical_manifest_bytes(manifest: dict) -> bytes:
    """把 Manifest 轉為**可重現的位元組**。

    使用排序鍵 + 固定分隔符 + 不含空白的緊湊 JSON，
    確保同一份內容在任何機器、任何時間都得到同一個 SHA256。
    """
    import json

    return json.dumps(
        manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")


def manifest_sha256(golden_set) -> str:
    """計算 Golden Set 的 Manifest SHA256。

    FROZEN 後此值不得改變；若改變代表樣本內容或標籤被動過。
    """
    return hash_bytes(canonical_manifest_bytes(build_manifest(golden_set)))


def verify_manifest_sha256(golden_set, expected: str) -> bool:
    """驗證指定 Golden Set 的 Manifest 是否等於預期雜湊。

    回傳 True 代表內容未被更動。
    """
    expected_digest = str(expected or "").strip()
    if not expected_digest:
        return False
    return manifest_sha256(golden_set) == expected_digest


def completeness_level(golden_set) -> str:
    """判定 Golden Set 的完整度等級。

    A. STRUCTURAL_COMPLETE（結構完整）
       四類標籤都有已確認樣本。這是「可以鎖定 FROZEN」的條件。

    B. EVALUATION_READY（可供正式評估）
       在結構完整之上，另外要求：
         - 狀態必須為 FROZEN（未鎖定不得作為正式基準）
         - 每類至少 MIN_SAMPLES_PER_CLASS_FOR_EVALUATION 張已確認樣本
         - 所有樣本都有 image_sha256（可追溯）

    **重要**：EVALUATION_READY 只代表「滿足結構性最低條件」，
    不等於「統計上可靠」。真正的合格門檻需另行驗證後制定。
    """
    if golden_set.missing_labels():
        return COMPLETENESS_INCOMPLETE
    if not golden_set.is_frozen:
        # 四類齊備但尚未鎖定 → 僅達成結構完整。
        return COMPLETENESS_STRUCTURAL

    distribution = golden_set.label_distribution()
    if any(
        count < MIN_SAMPLES_PER_CLASS_FOR_EVALUATION for count in distribution.values()
    ):
        return COMPLETENESS_STRUCTURAL

    missing_hash = golden_set.samples.filter(
        confirmation_status=GoldenSet.ConfirmationStatus.CONFIRMED
    ).filter(content_sha256="").exists()
    if missing_hash:
        return COMPLETENESS_STRUCTURAL

    return COMPLETENESS_EVALUATION_READY


def completeness_reason(golden_set) -> str:
    """以教師可讀的句子說明目前完整度與還缺什麼。"""
    level = completeness_level(golden_set)

    if level == COMPLETENESS_INCOMPLETE:
        return (
            "結構未完整：四類標籤尚未齊備，尚缺 "
            f"{'、'.join(golden_set.missing_labels())}。"
        )

    if level == COMPLETENESS_STRUCTURAL:
        if not golden_set.is_frozen:
            return "結構已完整（四類齊備），但尚未鎖定 FROZEN，不可作為正式評估基準。"
        distribution = golden_set.label_distribution()
        short = [
            f"{label}（{count} 張）"
            for label, count in distribution.items()
            if count < MIN_SAMPLES_PER_CLASS_FOR_EVALUATION
        ]
        if short:
            return (
                "結構已完整且已鎖定，但每類至少需 "
                f"{MIN_SAMPLES_PER_CLASS_FOR_EVALUATION} 張已確認樣本才可正式評估；"
                f"目前不足：{'、'.join(short)}。"
            )
        return "結構已完整且已鎖定，但有已確認樣本缺少影像雜湊，無法追溯。"

    return (
        "符合可供正式評估的結構性最低條件（已鎖定、四類齊備、"
        f"每類至少 {MIN_SAMPLES_PER_CLASS_FOR_EVALUATION} 張已確認樣本）。"
        "請注意：此為結構性條件，不代表統計上的可靠門檻。"
    )


def formal_evaluation_blocked_reason(golden_set, task_id: str) -> str:
    """正式 Golden Test 是否被阻擋；回傳空字串代表允許。

    這與「可否鎖定」是**兩個不同層級**的判斷：
    - 鎖定只需要結構完整（A）。
    - 正式評估需要 EVALUATION_READY（B）。
    """
    reason = verify_frozen_golden_set(golden_set, task_id)
    if reason:
        return reason

    level = completeness_level(golden_set)
    if level != COMPLETENESS_EVALUATION_READY:
        return completeness_reason(golden_set)
    return ""


# Golden Test 評估中心預留的指標欄位（本輪只顯示，不計算）。
# 對應既有 vision_center.save_evaluation 要求的 metrics 結構，
# 避免 Django 端與既有 JSON 註冊表出現兩套不同的指標定義。
GOLDEN_TEST_METRIC_FIELDS = (
    ("precision", "Precision", "整體精確率"),
    ("recall", "Recall", "整體召回率"),
    ("map50", "mAP@50", "IoU 0.5 的平均精度"),
    ("map50_95", "mAP@50-95", "IoU 0.5–0.95 的平均精度"),
    ("per_class_metrics", "各類別指標", "CW_F / CCW_F / CW_B / CCW_B 逐類指標"),
    ("confusion_matrix", "混淆矩陣", "四類互相誤判的分佈"),
    ("error_count", "錯誤數", "預測錯誤的照片張數"),
    ("low_confidence_count", "低信心數", "信心低於門檻的照片張數"),
)


def golden_test_blocked_reason(record, frozen_golden_sets) -> str:
    """【已棄用】請改用 model_golden_test_blocked_reason()。

    保留此函式僅為相容舊呼叫端；它**不得**再被用於安全判斷，
    因為它只檢查清單是否為空，無法驗證 Golden Set 的真實狀態。

    第 24 輪指令「四」明確要求：服務層必須自行驗證，
    不得把頁面展示資料當成權威安全判斷。
    """
    return model_golden_test_blocked_reason(record, frozen_golden_sets)


def verify_frozen_golden_set(golden_set, task_id: str) -> str:
    """驗證單一 Golden Set 是否為指定 task 的合法已鎖定基準。

    回傳空字串代表通過；否則回傳阻擋原因。
    本函式**自行重新讀取 DB 狀態**，不接受外部傳入的展示用 dict，
    以避免呼叫端把未過濾的清單當成權威來源。
    """
    # 1. 必須是真實的資料庫物件，而非頁面組出的 dict。
    if not isinstance(golden_set, GoldenSet):
        return "Golden Set 來源不合法（必須為資料庫物件）。"

    # 2. 必須仍存在於資料庫（避免已刪除物件被沿用）。
    if not GoldenSet.objects.filter(pk=golden_set.pk).exists():
        return f"Golden Set {golden_set.golden_set_id} 已不存在。"

    # 3. task_id 必須相容：不得把 HOVER 或其他任務的測試集拿來評 PROP 模型。
    expected = str(task_id or "").strip()
    if not expected:
        return "未指定任務類型，無法驗證 Golden Set 相容性。"
    if golden_set.task_id != expected:
        return (
            f"Golden Set 任務為 {golden_set.task_id}，"
            f"與模型任務 {expected} 不相容，不可混用。"
        )

    # 4. 必須為 FROZEN：DRAFT 版本仍在變動，不得作為正式評估基準。
    if not golden_set.is_frozen:
        return (
            f"Golden Set {golden_set.golden_set_id} 目前為 "
            f"{golden_set.get_status_display()}，"
            "未鎖定（FROZEN）的版本不得用於正式 Golden Test。"
        )

    # 5. 鎖定審計欄位必須齊備，否則視為狀態不一致。
    if golden_set.frozen_at is None or golden_set.frozen_by_id is None:
        return f"Golden Set {golden_set.golden_set_id} 缺少鎖定審計紀錄，狀態不一致。"

    # 6. 至少需有一張已確認樣本。
    if golden_set.confirmed_sample_count <= 0:
        return f"Golden Set {golden_set.golden_set_id} 沒有任何教師已確認樣本。"

    # 7. 四類標籤必須完整，否則 Precision 會因類別缺失而失真。
    missing = golden_set.missing_labels()
    if missing:
        return (
            f"Golden Set {golden_set.golden_set_id} 四類標籤不完整，"
            f"尚缺：{'、'.join(missing)}。"
        )
    return ""


def model_golden_test_blocked_reason(record, golden_sets=None) -> str:
    """【權威版】判斷模型是否可進入 Golden Test。

    第 24 輪指令「四」：服務層必須自行驗證以下條件，
    不得依賴呼叫端傳入的展示資料。

        1. 模型仍為合法 Candidate。
        2. Golden Set 確實存在於資料庫。
        3. task_id 相容。
        4. 狀態為 FROZEN。
        5. 有已確認樣本。
        6. 四類標籤完整。

    `golden_sets` 參數僅為相容保留，**不再被信任**；
    本函式一律自行查詢資料庫取得真實狀態。
    """
    from .models import VisionModelRecord

    if record is None:
        return "找不到模型紀錄，無法進入 Golden Test。"

    # 1. 模型必須仍是合法 Candidate（以 DB 重新確認，不信呼叫端快取）。
    review_status = str(getattr(record, "review_status", "") or "")
    record_pk = getattr(record, "pk", None)
    if record_pk is not None and isinstance(record, VisionModelRecord):
        fresh = VisionModelRecord.objects.filter(pk=record_pk).values_list(
            "review_status", flat=True
        ).first()
        if fresh is None:
            return "模型紀錄已不存在，不可進入 Golden Test。"
        review_status = str(fresh)
    if review_status != VisionModelRecord.ReviewStatus.CANDIDATE:
        return (
            f"此模型目前審核狀態為 {review_status or 'UNKNOWN'}，"
            "尚未由教師列為候選（CANDIDATE），不可進入 Golden Test。"
        )

    task_id = str(getattr(record, "task_id", "") or "").strip()
    if not task_id:
        return "模型缺少任務類型，無法驗證 Golden Set 相容性。"

    # 2~6. 自行查詢此任務下所有 Golden Set，逐一驗證是否存在合法基準。
    candidates = GoldenSet.objects.filter(task_id=task_id)
    if not candidates.exists():
        return f"尚無任何 {task_id} 的 Golden Set 版本，無法固定評估基準。"

    reasons = []
    for golden_set in candidates:
        reason = verify_frozen_golden_set(golden_set, task_id)
        if not reason:
            return ""
        reasons.append(golden_set.golden_set_id)

    return (
        f"尚無可用的已鎖定 Golden Set：{task_id} 的 "
        f"{'、'.join(reasons) or '全部版本'} 均未通過驗證"
        "（需為 FROZEN、含已確認樣本且四類完整）。"
    )


def assert_no_false_validated(record) -> str:
    """驗證模型不得在沒有真實評估紀錄的情況下被標為 VALIDATED。

    回傳空字串代表合法；否則回傳違規原因。
    本函式**只讀取紀錄本身**，不修改任何狀態。
    """
    from .models import VisionModelRecord

    if record is None:
        return "找不到模型紀錄。"
    if record.validation_status != VisionModelRecord.ValidationStatus.VALIDATED:
        return ""

    has_real_evaluation = bool(record.golden_test_summary) or bool(record.validation_history)
    if has_real_evaluation:
        return ""
    return (
        f"模型 {record.model_id} 被標為 VALIDATED，但沒有任何真實評估紀錄"
        "（golden_test_summary / validation_history 皆為空），屬不實驗證。"
    )


def assert_no_false_active(record, golden_sets=None) -> str:
    """驗證模型不得在沒有真實合格結果的情況下被標為 ACTIVE。

    回傳空字串代表合法；否則回傳違規原因。
    本函式**只讀取紀錄本身**，不修改任何狀態。
    """
    from .models import VisionModelRecord

    if record is None:
        return "找不到模型紀錄。"
    if record.deployment_status != VisionModelRecord.DeploymentStatus.ACTIVE:
        return ""

    if record.validation_status != VisionModelRecord.ValidationStatus.VALIDATED:
        return (
            f"模型 {record.model_id} 被標為 ACTIVE，但驗證狀態為 "
            f"{record.validation_status}，未經 VALIDATED 不得啟用。"
        )

    violation = assert_no_false_validated(record)
    if violation:
        return f"模型 {record.model_id} 被標為 ACTIVE：{violation}"

    task_id = str(getattr(record, "task_id", "") or "").strip()
    if not task_id:
        return f"模型 {record.model_id} 被標為 ACTIVE，但缺少任務類型。"

    candidates = GoldenSet.objects.filter(task_id=task_id)
    if not any(not verify_frozen_golden_set(item, task_id) for item in candidates):
        return (
            f"模型 {record.model_id} 被標為 ACTIVE，"
            f"但 {task_id} 沒有任何通過驗證的可重現評估基準。"
        )
    return ""
