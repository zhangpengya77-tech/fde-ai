from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import Enum
from typing import Protocol, Sequence
from uuid import uuid4

from .task_catalog import TaskStatus
from .task_state import TrainingProgress


def _now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class EvidenceType(str, Enum):
    PHOTO = "PHOTO"
    VIDEO = "VIDEO"
    SCREENSHOT = "SCREENSHOT"
    CHECKLIST = "CHECKLIST"
    VISION_RESULT = "VISION_RESULT"
    TEACHER_REVIEW = "TEACHER_REVIEW"
    MP_RESULT = "MP_RESULT"
    QGC_RESULT = "QGC_RESULT"
    FLIGHT_LOG_REFERENCE = "FLIGHT_LOG_REFERENCE"
    FLIGHT_HEALTH_REFERENCE = "FLIGHT_HEALTH_REFERENCE"
    STUDENT_REFLECTION = "STUDENT_REFLECTION"
    YOLO_MODEL = "YOLO_MODEL"  # 學生上傳 best.pt 等 YOLO 模型檔案（P1-1）


class ModelTaskType(str, Enum):
    """AI 目標檢測任務類型；本輪只啟用 PROP_DETECTION，其餘預留。"""
    PROP_DETECTION = "PROP_DETECTION"       # 槳葉方向與正反面辨識（CW_F / CCW_F / CW_B / CCW_B）
    HOVER_DETECTION = "HOVER_DETECTION"     # 四面懸停（預留）
    MOTOR_DETECTION = "MOTOR_DETECTION"     # 馬達檢測（預留）
    GPS_DETECTION = "GPS_DETECTION"         # GPS 檢測（預留）
    ESC_DETECTION = "ESC_DETECTION"         # ESC 檢測（預留）
    FRAME_DETECTION = "FRAME_DETECTION"     # 機架檢測（預留）
    BATTERY_DETECTION = "BATTERY_DETECTION" # 電池檢測（預留）


class ModelSubmissionStatus(str, Enum):
    """YOLO 模型提交在教師審核流程中的狀態。"""
    UPLOADED = "UPLOADED"                           # 學生已上傳
    PENDING_REVIEW = "PENDING_REVIEW"               # 等待教師審核
    APPROVED_FOR_BENCHMARK = "APPROVED_FOR_BENCHMARK"  # 教師核准，可進入下一輪 Benchmark
    REJECTED = "REJECTED"                           # 教師退回


class ReflectionSource(str, Enum):
    TEXT = "TEXT"
    VOICE_TRANSCRIPT = "VOICE_TRANSCRIPT"


@dataclass(frozen=True)
class EvidenceRecord:
    evidence_id: str
    student_id: str
    session_id: str
    course_id: str
    task_id: str
    step_id: str | None
    evidence_type: EvidenceType
    created_at: str
    source: str
    file_reference: str | None
    vision_result: dict | None = None
    check_result: str | None = None
    teacher_review: dict | None = None
    error_codes: tuple[str, ...] = ()
    safety_reminders_acknowledged: tuple[str, ...] = ()
    metadata: dict = field(default_factory=dict)

    @classmethod
    def create(cls, student_id, session_id, course_id, task_id, step_id, evidence_type, source, file_reference=None, vision_result=None, check_result=None, teacher_review=None, error_codes=(), safety_reminders_acknowledged=(), metadata=None):
        return cls(str(uuid4()), student_id, session_id, course_id, task_id, step_id, EvidenceType(evidence_type), _now(), source, file_reference, vision_result, check_result, teacher_review, tuple(error_codes), tuple(safety_reminders_acknowledged), dict(metadata or {}))


@dataclass(frozen=True)
class StudentReflection:
    reflection_id: str
    student_id: str
    task_id: str
    original_text: str
    ai_assisted_text: str | None
    created_at: str
    source_type: ReflectionSource

    @classmethod
    def create(cls, student_id, task_id, original_text, ai_assisted_text, source_type):
        original = original_text.strip()
        if not original:
            raise ValueError("student_original_summary_required")
        return cls(str(uuid4()), student_id, task_id, original, ai_assisted_text.strip() if ai_assisted_text else None, _now(), ReflectionSource(source_type))


@dataclass(frozen=True)
class ExternalCapabilityLink:
    capability_id: str
    integration_entry: str
    invocation_mode: str
    module_path: str
    result_reference: str | None = None

    @classmethod
    def existing_flight_health(cls, result_reference: str | None = None):
        return cls("EXISTING_FLIGHT_HEALTH", "/flight-health/", "EXTERNAL_ROUTE", "flight-health/", result_reference)

    @classmethod
    def existing_mp12(cls, result_reference: str | None = None):
        """Platform Integration：MP-12 外部既有能力的 Integration Contract / Placeholder。

        只宣告 MP-12 為外部既有能力，由 Integration Adapter 接入。
        本輪不複製整個 repo、不合併分支、不重新開發 MP-12（不得觸碰 D:\\FDE-AI-UAS-MP12）。

        MP-12 REAL INTEGRATION Phase 1（Backend）後：
        MP-12 已確認為 Main-12 TASK_07 的深度子模組（parent_task_id = TASK_07），
        其 Catalog / State / Teacher Gate 以 file-level adoption 複用（app/mp12_*.py），
        經由 TrainingProgress.mp12_state() 與 /training/mp12/{subtask_id}/... 對外提供。
        integration_entry 仍留空：MP-12 不是對外獨立路由，而是 TASK_07 的子模組，
        入口即 TASK_07 本身；欄位值維持 EXTERNAL_ADAPTER_PENDING 以保有 Phase 1 凍結契約。
        """
        return cls("EXISTING_MP12", "", "EXTERNAL_ADAPTER_PENDING", "mp12/", result_reference)


@dataclass(frozen=True)
class GrowthRecordPayload:
    growth_record_id: str
    title: str
    progress_label: str
    current_task: str | None
    teacher_safety_checks: str
    evidence_count: int
    student_reflection: str
    final_status: str
    task_detail: tuple[dict, ...]
    sync_status: str = "PENDING_SYNC"


class GrowthRecordAdapter(Protocol):
    def build(self, progress: TrainingProgress, evidence: Sequence[EvidenceRecord], reflections: Sequence[StudentReflection]) -> GrowthRecordPayload: ...


class PendingSyncGrowthRecordAdapter:
    def build(self, progress: TrainingProgress, evidence: Sequence[EvidenceRecord], reflections: Sequence[StudentReflection]) -> GrowthRecordPayload:
        detail = tuple({
            "task_id": definition.id,
            "order": definition.order,
            "title": definition.title,
            "status": progress.task(definition.id).status.value,
        } for definition in progress.course.tasks)
        current = next((item["task_id"] for item in detail if item["status"] != TaskStatus.COMPLETED.value), None)
        required_teacher_checks = sum(task.teacher_review_required for task in progress.course.tasks)
        approved_teacher_checks = sum(review.decision == "APPROVE" for review in progress.teacher_reviews)
        return GrowthRecordPayload(
            growth_record_id="05",
            title="F450 组装",
            progress_label=progress.summary,
            current_task=current,
            teacher_safety_checks=f"{approved_teacher_checks} / {required_teacher_checks}",
            evidence_count=len(evidence),
            student_reflection="available" if reflections else "missing",
            final_status="COMPLETED" if progress.completed_count == 12 else "IN_PROGRESS",
            task_detail=detail,
        )
