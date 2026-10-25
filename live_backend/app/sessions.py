from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field, replace
from datetime import UTC, datetime
from collections import Counter, defaultdict
from pathlib import Path
from threading import RLock
from uuid import uuid4

from .sop import DetectionFact, SopCourse, SopDecision, SopStep, load_demo_course
from .safety import SAFETY_REMINDERS
from .task_catalog import TaskStatus, load_f450_course
from .task_state import TaskTransitionError, TrainingProgress
from .training_records import EvidenceRecord, EvidenceType, ModelSubmissionStatus, ModelTaskType, PendingSyncGrowthRecordAdapter, StudentReflection


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class InvalidSessionTransition(ValueError):
    pass


@dataclass
class LiveSession:
    session_id: str
    mode: str
    created_at: str
    course_id: str
    task_id: str
    current_step_id: str
    state: str
    vision_source: str
    expected_class: str
    last_detection: str | None = None
    last_confidence: float | None = None
    last_frame_id: str | None = None
    pass_candidate_count: int = 0
    fail_count: int = 0
    help_count: int = 0
    sequence: int = 0
    started_at: str = ""
    updated_at: str = ""
    completed_at: str | None = None
    context_version: int = 1
    training_track: str | None = None
    hardware_profile: str | None = None
    current_task_id: str | None = None
    task_state: str | None = None
    prerequisite_state: str | None = None
    safety_state: str | None = None
    teacher_review_state: str | None = None
    evidence_count: int = 0
    reflection_state: str = "missing"
    # 僅由已驗證 Assertion 建立，禁止瀏覽器變更 Session 所有者。
    owner_subject: str | None = None
    owner_enrollment_id: str | None = None
    owner_cohort_id: str | None = None
    rag_explanation: dict = field(default_factory=lambda: {
        "status": "idle",
        "explanation": None,
        "reference_summary": None,
        "sources": None,
        "latency_ms": None,
        "hit": False,
        "error_code": None,
        "request_id": None,
        "context_version": 1,
    })
    rag_metrics: dict = field(default_factory=lambda: {
        "request_count": 0,
        "success_count": 0,
        "fallback_count": 0,
        "timeout_count": 0,
        "no_hit_count": 0,
        "stale_drop_count": 0,
        "last_latency_ms": None,
        "average_latency_ms": 0,
    })
    _rag_dedup_key: str | None = field(default=None, repr=False)
    _latest_rag_request_id: str | None = field(default=None, repr=False)
    _rag_latency_total: float = field(default=0, repr=False)
    _step_index: int = field(default=0, repr=False)
    _events: list[dict] = field(default_factory=list, repr=False)

    def as_dict(self) -> dict:
        value = asdict(self)
        value.pop("_step_index", None)
        value.pop("_events", None)
        value.pop("_rag_dedup_key", None)
        value.pop("_latest_rag_request_id", None)
        value.pop("_rag_latency_total", None)
        if self.training_track is None:
            for key in ("training_track", "hardware_profile", "current_task_id", "task_state", "prerequisite_state", "safety_state", "teacher_review_state", "evidence_count", "reflection_state"):
                value.pop(key, None)
        return value

    def to_persist_dict(self) -> dict:
        """Full serialization for session persistence (P1: 重载保留)."""
        return asdict(self)

    @classmethod
    def from_persist_dict(cls, data: dict) -> "LiveSession":
        return cls(**data)


class InMemorySessionStore:
    def __init__(self, course: SopCourse | None = None, persistence_path: Path | None = None):
        self.course = course or load_demo_course()
        self.task = self.course.tasks[0]
        self._sessions: dict[str, LiveSession] = {}
        self._training: dict[str, TrainingProgress] = {}
        self._evidence: dict[str, list[EvidenceRecord]] = {}
        self._reflections: dict[str, list[StudentReflection]] = {}
        self._knowledge_candidates: dict[str, list[dict]] = {}
        self._classroom_validation: dict[str, dict] = {}
        self._coach_history: dict[str, list[dict]] = {}
        self._prop_vision_probe = lambda: False
        self._lock = RLock()
        self._persistence_path = persistence_path
        if self._persistence_path is not None:
            self._load_all()

    def _persist(self) -> None:
        """Atomically write the full session + training snapshot to disk (P1: 重载保留)."""
        if self._persistence_path is None:
            return
        snapshot = {
            "sessions": {sid: session.to_persist_dict() for sid, session in self._sessions.items()},
            "training": {
                sid: progress.to_dict()
                for sid, progress in self._training.items()
                if sid in self._sessions
            },
        }
        try:
            self._persistence_path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self._persistence_path.with_name(self._persistence_path.name + ".tmp")
            tmp.write_text(json.dumps(snapshot, ensure_ascii=False), encoding="utf-8")
            os.replace(tmp, self._persistence_path)
        except OSError:
            # Persistence is best-effort; never break the live session path.
            pass

    def _load_all(self) -> None:
        if self._persistence_path is None or not self._persistence_path.exists():
            return
        try:
            data = json.loads(self._persistence_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return
        for sid, sdata in data.get("sessions", {}).items():
            try:
                self._sessions[sid] = LiveSession.from_persist_dict(sdata)
            except Exception:
                continue
        for sid, tdata in data.get("training", {}).items():
            if sid not in self._sessions:
                continue
            try:
                self._training[sid] = TrainingProgress.from_dict(tdata)
            except Exception:
                self._training.pop(sid, None)
        # Ensure every restored F450 session has a training entry even if training wasn't saved.
        for sid, session in self._sessions.items():
            if session.training_track == "F450_TWELVE_TASK" and sid not in self._training:
                self._training[sid] = TrainingProgress(session.session_id, f"dev-student:{sid}", load_f450_course())

    def set_prop_vision_probe(self, probe) -> None:
        """注入既有 PROP ACTIVE 模型狀態，不建立第二套 Vision 系統。"""
        self._prop_vision_probe = probe

    def _prop_vision_status(self) -> str:
        try:
            return "READY" if self._prop_vision_probe() else "PENDING"
        except (KeyError, OSError, ValueError):
            return "PENDING"

    def create(self, *, vision_source: str = "REAL_VISION", mode: str = "demo", training_track: str | None = None, owner_subject: str | None = None, owner_enrollment_id: str | None = None, owner_cohort_id: str | None = None) -> LiveSession:
        now = utc_now_iso()
        first = self.task.steps[0]
        session = LiveSession(
            session_id=str(uuid4()),
            mode=mode,
            created_at=now,
            course_id=self.course.course_id,
            task_id=self.task.task_id,
            current_step_id=first.step_id,
            state="WAITING_FOR_OBJECT",
            vision_source=vision_source,
            expected_class=first.expected_classes[0],
            started_at=now,
            updated_at=now,
            training_track=training_track,
            hardware_profile="F450_PIXHAWK248" if training_track == "F450_TWELVE_TASK" else None,
            current_task_id="TASK_01" if training_track == "F450_TWELVE_TASK" else None,
            task_state=TaskStatus.NOT_STARTED.value if training_track == "F450_TWELVE_TASK" else None,
            prerequisite_state="READY" if training_track == "F450_TWELVE_TASK" else None,
            safety_state="ADVISORY" if training_track == "F450_TWELVE_TASK" else None,
            teacher_review_state="NOT_REQUIRED" if training_track == "F450_TWELVE_TASK" else None,
            owner_subject=owner_subject,
            owner_enrollment_id=owner_enrollment_id,
            owner_cohort_id=owner_cohort_id,
        )
        with self._lock:
            self._sessions[session.session_id] = session
            if training_track == "F450_TWELVE_TASK":
                self._training[session.session_id] = TrainingProgress(session.session_id, f"dev-student:{session.session_id}", load_f450_course())
                self._evidence[session.session_id] = []
            self._reflections[session.session_id] = []
            self._knowledge_candidates[session.session_id] = []
            self._classroom_validation[session.session_id] = {
                "enabled": False, "entered_at": None, "exited_at": None, "events": [],
            }
            self._coach_history[session.session_id] = []
            self._append(session, "SESSION_STARTED")
            self._append(session, "STEP_STARTED")
        self._persist()
        return session

    def training_progress(self, session_id: str) -> TrainingProgress:
        try:
            return self._training[session_id]
        except KeyError as error:
            raise KeyError(session_id) from error

    def _sync_training_session(self, session_id: str, task_id: str | None = None) -> LiveSession:
        session = self._sessions[session_id]
        progress = self.training_progress(session_id)
        if task_id is not None:
            session.current_task_id = task_id
        current_id = session.current_task_id or "TASK_01"
        current = progress.task(current_id)
        definition = next(item for item in progress.course.tasks if item.id == current_id)
        missing = progress.unsafe_step_missing(current_id, current.current_training_step_id)
        session.task_state = current.status.value
        session.prerequisite_state = "BLOCKED" if missing else "READY"
        session.safety_state = "TEACHER_GATE" if definition.safety_gate else "ADVISORY"
        session.teacher_review_state = "PENDING" if current.status is TaskStatus.PENDING_TEACHER_REVIEW else ("REQUIRED" if definition.teacher_review_required else "NOT_REQUIRED")
        # MP-12 Integration：TASK_07 以目前 MP 子任務的教師需求「強化」Gate。
        # 注意：只做強化，不做放寬；Main-12 既有的 unsafe_step_missing 安全鏈維持不變。
        if current_id == "TASK_07":
            mp_current = progress.mp12_state().get("current_subtask") or {}
            if mp_current.get("teacher_required"):
                session.safety_state = "TEACHER_GATE"
                if mp_current.get("status") == "PENDING_TEACHER_REVIEW":
                    session.teacher_review_state = "PENDING"
                elif session.teacher_review_state == "NOT_REQUIRED":
                    session.teacher_review_state = "REQUIRED"
        session.evidence_count = len(self._evidence[session_id])
        session.reflection_state = "available" if self._reflections[session_id] else "missing"
        return session

    def training_state(self, session_id: str) -> dict:
        session = self._sync_training_session(session_id)
        progress = self.training_progress(session_id)
        current = next(item for item in progress.course.tasks if item.id == session.current_task_id)
        current_progress = progress.task(current.id)
        current_step = next((step for step in current.steps if step.step_id == current_progress.current_training_step_id), None)
        next_step = next((step for step in current.steps if current_step and step.order == current_step.order + 1), None)
        missing = progress.unsafe_step_missing(current.id, current_progress.current_training_step_id)
        tasks = [{
            "task_id": item.id, "order": item.order, "short_name": item.short_name,
            "title": item.title, "status": progress.task(item.id).status.value,
            "viewable": True,
            "actionable": True,
            "readiness": "READY" if not progress.missing_prerequisites(item.id) else "BLOCKED",
            "missing_prerequisites": list(progress.missing_prerequisites(item.id)),
        } for item in progress.course.tasks]
        payload = {
            "training_track": session.training_track,
            "hardware_profile": session.hardware_profile,
            "current_task_id": current.id,
            "current_step_id": current_step.step_id if current_step else None,
            "current_training_step_id": current_progress.current_training_step_id,
            "training_step_progress": current_progress.training_step_progress,
            "task_state": current_progress.status.value,
            "prerequisite_state": "BLOCKED" if missing else "READY",
            "missing_prerequisites": list(missing),
            "safety_state": session.safety_state,
            "teacher_review_state": session.teacher_review_state,
            "evidence_count": len(self._evidence[session_id]),
            "reflection_state": session.reflection_state,
            "progress": progress.summary,
            "overall_progress": progress.summary,
            "actionable": not missing,
            "completable": not missing,
            "unsafe_action_allowed": not missing,
            "current_step": self._training_step_payload(current_step, current_progress) if current_step else None,
            "tasks": tasks,
            "task": {
                "id": current.id, "order": current.order, "title": current.title,
                "description": current.description, "objective": current.objective,
                "steps": [self._training_step_payload(step, current_progress) for step in current.steps],
                "safety_reminders": [{"id": item, "message": SAFETY_REMINDERS[item].message} for item in current.safety_reminders],
                "vision_tasks": list(current.vision_tasks),
                "teacher_review_required": current.teacher_review_required,
            },
            "context": {
                "course_id": progress.course.course_id,
                "main_task_id": current.id,
                "task_id": current.id,
                "task_title": current.title,
                "current_training_step_id": current_step.step_id if current_step else None,
                "step_id": current_step.step_id if current_step else None,
                "current_step_title": current_step.title if current_step else None,
                "current_step_instruction": current_step.student_instruction if current_step else None,
                "next_step": None if next_step is None else {
                    "step_id": next_step.step_id,
                    "title": next_step.title,
                    "student_instruction": next_step.student_instruction,
                },
                "hardware_profile": session.hardware_profile,
                "safety_state": session.safety_state,
                "expected_action": current_step.expected_action if current_step else None,
                "component_ids": list(current.component_ids),
                "connector_ids": list(current.connector_ids),
                "safety_reminders": list(current.safety_reminders),
                "teacher_gate": current.teacher_review_required,
                "evidence_state": len(self._evidence[session_id]),
            },
        }
        if current.id == "TASK_08":
            payload["prop_vision_status"] = self._prop_vision_status()
        if current.id == "TASK_07":
            # MP-12 Integration：TASK_07 暴露既有 MP-12 子模組狀態（parent_task_id 由 MP-12 自帶）
            payload["mission_planner"] = progress.mp12_state()
        return payload

    @staticmethod
    def _training_step_payload(step, progress) -> dict:
        state = progress.training_step_progress.get(step.step_id, {})
        payload = {
            "step_id": step.step_id, "id": step.step_id, "order": step.order,
            "title": step.title, "student_instruction": step.student_instruction,
            "instruction": step.student_instruction, "why_it_matters": step.why_it_matters,
            "rationale": step.why_it_matters, "expected_action": step.expected_action,
            "completion_type": step.completion_type, "teacher_gate": step.teacher_gate,
            "vision_task": step.vision_task, "evidence_required": list(step.evidence_required),
            "safety_reminders": [{"id": item, "message": SAFETY_REMINDERS[item].message} for item in step.safety_reminders],
            "progress": state,
        }
        return payload

    def training_task_view(self, session_id: str, task_id: str) -> dict:
        progress = self.training_progress(session_id)
        current_id = self._sessions[session_id].current_task_id
        task = next((item for item in progress.course.tasks if item.id == task_id), None)
        if task is None:
            raise KeyError(task_id)
        task_progress = progress.task(task.id)
        if task_progress.status is TaskStatus.NOT_STARTED:
            progress.start_task(task.id)
            self._sync_training_session(session_id, task.id)
            task_progress = progress.task(task.id)
            current_id = task.id
        current_step = next((step for step in task.steps if step.step_id == task_progress.current_training_step_id), None)
        missing = list(progress.unsafe_step_missing(task.id, task_progress.current_training_step_id))
        payload = {
            "viewable": True,
            "actionable": True,
            "completable": not missing,
            "unsafe_action_allowed": not missing,
            "current_task_id": current_id,
            "current_training_step_id": task_progress.current_training_step_id,
            "current_step": self._training_step_payload(current_step, task_progress) if current_step else None,
            "training_step_progress": task_progress.training_step_progress,
            "missing_prerequisites": missing,
            "task_state": progress.task(task.id).status.value,
            "task": {
                "id": task.id, "order": task.order, "title": task.title,
                "description": task.description, "objective": task.objective,
                "steps": [self._training_step_payload(step, progress.task(task.id)) for step in task.steps],
                "safety_reminders": [{"id": item, "message": SAFETY_REMINDERS[item].message} for item in task.safety_reminders],
                "vision_tasks": list(task.vision_tasks),
                "teacher_review_required": task.teacher_review_required,
            },
        }
        if task.id == "TASK_08":
            payload["prop_vision_status"] = self._prop_vision_status()
        if task.id == "TASK_07":
            payload["mission_planner"] = progress.mp12_state()
        return payload

    def record_training_step_fact(self, session_id: str, step_id: str, fact: str, student_note: str = "") -> dict:
        task_id = self._sessions[session_id].current_task_id
        self.training_progress(session_id).record_step_fact(task_id, step_id, fact, student_note)
        self._persist()
        return self.training_state(session_id)

    def acknowledge_training_step_safety(self, session_id: str, step_id: str) -> dict:
        task_id = self._sessions[session_id].current_task_id
        self.training_progress(session_id).acknowledge_step_safety(task_id, step_id)
        self._persist()
        return self.training_state(session_id)

    # ---- MP-12 Integration Adapter（Backend）：TASK_07 深度子模組 MP01～MP12 ----

    def select_mp_subtask(self, session_id: str, subtask_id: str) -> dict:
        self.training_progress(session_id).select_mp_subtask(subtask_id)
        self._sync_training_session(session_id, "TASK_07")
        self._persist()
        return self.training_state(session_id)

    def complete_mp_subtask(self, session_id: str, subtask_id: str, *, actor: str) -> dict:
        self.training_progress(session_id).complete_mp_subtask(subtask_id, actor=actor)
        self._sync_training_session(session_id, "TASK_07")
        self._persist()
        return self.training_state(session_id)

    def review_mp_subtask(
        self,
        session_id: str,
        subtask_id: str,
        decision: str,
        teacher_id: str,
        *,
        reason: str = "",
        note: str = "",
    ) -> dict:
        self.training_progress(session_id).review_mp_subtask(
            subtask_id, decision, teacher_id, reason=reason, note=note
        )
        self._sync_training_session(session_id, "TASK_07")
        self._persist()
        return self.training_state(session_id)

    def review_training_step(self, session_id: str, task_id: str, step_id: str, decision: str, teacher_id: str, note: str) -> dict:
        self.training_progress(session_id).review_step(task_id, step_id, decision, teacher_id, note=note)
        self._sync_training_session(session_id, task_id)
        self._persist()
        return self.training_state(session_id)

    def start_training_task(self, session_id: str, task_id: str) -> dict:
        self.training_progress(session_id).start_task(task_id)
        self._sync_training_session(session_id, task_id)
        self._persist()
        return self.training_state(session_id)

    def complete_training_task(self, session_id: str, task_id: str) -> dict:
        task_progress = self.training_progress(session_id).task(task_id)
        if task_progress.current_training_step_id is not None:
            raise TaskTransitionError("training_steps_incomplete")
        if not any(item.task_id == task_id for item in self._evidence[session_id]):
            raise TaskTransitionError("evidence_required")
        if not any(item.task_id == task_id for item in self._reflections[session_id]):
            raise TaskTransitionError("reflection_required")
        self.training_progress(session_id).request_completion(task_id, actor="student")
        self._sync_training_session(session_id, task_id)
        self._persist()
        return self.training_state(session_id)

    def add_training_evidence(self, session_id: str, evidence: EvidenceRecord) -> None:
        # MP-12 Integration：MP 證據同樣進入 Shared Evidence（Growth Record 口徑不變），
        # 並額外寫入 MP-12 子任務自身的 evidence 清單。
        self._evidence[session_id].append(evidence)
        progress = self.training_progress(session_id)
        reference = evidence.file_reference or evidence.evidence_id
        progress.record_evidence(evidence.task_id, evidence.evidence_type.value, reference)
        if evidence.step_id:
            if evidence.task_id == "TASK_07" and evidence.step_id.startswith("MP"):
                progress.record_mp_evidence(evidence.step_id, evidence.evidence_type.value, reference)
                self._sync_training_session(session_id, evidence.task_id)
                return
            progress.record_step_evidence(
                evidence.task_id, evidence.step_id, evidence.evidence_type.value,
                evidence.file_reference, evidence.check_result, str(evidence.metadata.get("student_note") or ""),
            )
        self._sync_training_session(session_id, evidence.task_id)
        self._persist()

    def add_training_reflection(self, session_id: str, reflection: StudentReflection) -> None:
        self._reflections[session_id].append(reflection)
        current = self.training_progress(session_id).task(reflection.task_id).current_training_step_id
        if current:
            self.training_progress(session_id).record_step_reflection(reflection.task_id, current)
        self._sync_training_session(session_id, reflection.task_id)
        self._persist()

    def review_training_task(self, session_id: str, task_id: str, decision: str, teacher_id: str, note: str):
        review = self.training_progress(session_id).record_teacher_review(task_id, decision, teacher_id, note)
        self._sync_training_session(session_id, task_id)
        self._persist()
        return review

    def growth_record(self, session_id: str):
        return PendingSyncGrowthRecordAdapter().build(self.training_progress(session_id), tuple(self._evidence[session_id]), tuple(self._reflections[session_id]))

    # ---- P1-1：學生 YOLO 模型提交與教師審核（復用 EvidenceRecord） ----
    def list_model_submissions(self, session_id: str) -> list[dict]:
        """列出該 session 下所有 YOLO 模型提交（教師收件匣）。"""
        if session_id not in self._sessions:
            raise KeyError(session_id)
        return [asdict(ev) for ev in self._evidence[session_id] if ev.evidence_type == EvidenceType.YOLO_MODEL]

    def get_model_submission(self, session_id: str, evidence_id: str) -> dict:
        if session_id not in self._sessions:
            raise KeyError(session_id)
        for ev in self._evidence[session_id]:
            if ev.evidence_id == evidence_id and ev.evidence_type == EvidenceType.YOLO_MODEL:
                return asdict(ev)
        raise KeyError("model_submission_not_found")

    def review_model_submission(self, session_id: str, evidence_id: str, decision: str, teacher_id: str, note: str) -> dict:
        # 教師審核結果；decision 僅允許 APPROVED_FOR_BENCHMARK / REJECTED，不觸發執行或部署。
        if decision not in (ModelSubmissionStatus.APPROVED_FOR_BENCHMARK.value, ModelSubmissionStatus.REJECTED.value):
            raise ValueError("invalid_model_review_decision")
        if session_id not in self._sessions:
            raise KeyError(session_id)
        evidences = self._evidence[session_id]
        for index, ev in enumerate(evidences):
            if ev.evidence_id == evidence_id and ev.evidence_type == EvidenceType.YOLO_MODEL:
                meta = dict(ev.metadata)
                meta["model_status"] = decision
                meta["teacher_note"] = str(note or "")
                meta["reviewed_by"] = teacher_id
                meta["reviewed_at"] = utc_now_iso()
                # 僅更新審核狀態與備註，不載入、不執行、不部署模型。
                updated = replace(ev, teacher_review={"decision": decision, "teacher_id": teacher_id, "note": note, "reviewed_at": meta["reviewed_at"]}, metadata=meta)
                evidences[index] = updated
                return asdict(updated)
        raise KeyError("model_submission_not_found")

    def record_model_benchmark(self, session_id: str, evidence_id: str, benchmark: dict) -> dict:
        # P1-2：將 Benchmark 結果寫回既有 submission；不改變 model_status，不部署、不啟用。
        if session_id not in self._sessions:
            raise KeyError(session_id)
        evidences = self._evidence[session_id]
        for index, ev in enumerate(evidences):
            if ev.evidence_id == evidence_id and ev.evidence_type == EvidenceType.YOLO_MODEL:
                meta = dict(ev.metadata)
                meta["benchmark_status"] = str(benchmark.get("status") or "")
                meta["latest_benchmark_id"] = str(benchmark.get("benchmark_id") or "")
                meta["benchmarked_at"] = str(benchmark.get("created_at") or "")
                # 只記錄結果供教師審核，不複製 best.pt，不建立 Model Version Manager。
                updated = replace(ev, metadata=meta)
                evidences[index] = updated
                return asdict(updated)
        raise KeyError("model_submission_not_found")

    def record_knowledge_candidate(self, session_id: str, *, question: str, task_id: str | None, step_id: str | None, llm_answer: str, provider: str | None = None, model: str | None = None, language: str = "zh-TW", answer_source: str = "AI_REFERENCE", tokens: dict | None = None, latency_ms: float | None = None, vision_used: bool = False, image_reference: str | None = None) -> dict:
        candidate = {
            "session_id": session_id,
            "question": question,
            "answer": llm_answer,
            "task": task_id,
            "step": step_id,
            "task_id": task_id,
            "step_id": step_id,
            "llm_answer": llm_answer,
            "answer_source": answer_source,
            "provider": provider,
            "model": model,
            "language": language,
            "tokens": dict(tokens or {}),
            "latency_ms": latency_ms,
            "vision_used": bool(vision_used),
            "image_reference": image_reference,
            "follow_up_count": 0,
            "resolved": False,
            "teacher_override": None,
            "teacher_review": None,
            "teacher_correction": None,
            "review_status": "PENDING_REVIEW",
            "candidate_type": "KNOWLEDGE_CANDIDATE",
            "final_answer": None,
        }
        self._knowledge_candidates[session_id].append(candidate)
        return dict(candidate)

    def knowledge_candidates(self, session_id: str) -> list[dict]:
        return [dict(item) for item in self._knowledge_candidates[session_id]]

    def record_coach_turn(self, session_id: str, question: str, answer: str, answer_source: str) -> dict:
        if session_id not in self._sessions:
            raise KeyError(session_id)
        training = self.training_state(session_id)
        turn = {
            "timestamp": utc_now_iso(), "question": str(question).strip(), "answer": str(answer).strip(),
            "answer_source": answer_source, "task_id": training.get("current_task_id"),
            "step_id": training.get("current_training_step_id"), "evidence_count": training.get("evidence_count", 0),
            "teacher_review_state": training.get("teacher_review_state"),
        }
        history = self._coach_history[session_id]
        history.append(turn)
        del history[:-20]
        return dict(turn)

    def coach_history(self, session_id: str) -> list[dict]:
        if session_id not in self._sessions:
            raise KeyError(session_id)
        return [dict(item) for item in self._coach_history[session_id]]

    def approved_teacher_answer(self, session_id: str, question: str, task_id: str | None, step_id: str | None) -> str | None:
        normalized = str(question).strip().casefold()
        for candidate in reversed(self._knowledge_candidates[session_id]):
            if candidate.get("review_status") != "APPROVED":
                continue
            if str(candidate.get("question") or "").strip().casefold() != normalized:
                continue
            if candidate.get("task_id") not in (None, task_id) or candidate.get("step_id") not in (None, step_id):
                continue
            answer = candidate.get("final_answer") or candidate.get("teacher_correction") or candidate.get("teacher_override")
            if answer:
                return str(answer)
        return None

    def set_classroom_validation(self, session_id: str, enabled: bool) -> dict:
        if session_id not in self._sessions:
            raise KeyError(session_id)
        state = self._classroom_validation[session_id]
        state["enabled"] = bool(enabled)
        stamp = utc_now_iso()
        state["entered_at" if enabled else "exited_at"] = stamp
        return self.classroom_validation_state(session_id)

    def classroom_validation_state(self, session_id: str) -> dict:
        if session_id not in self._sessions:
            raise KeyError(session_id)
        state = self._classroom_validation[session_id]
        return {
            "enabled": state["enabled"],
            "entered_at": state["entered_at"],
            "exited_at": state["exited_at"],
            "event_count": len(state["events"]),
        }

    def record_classroom_event(self, session_id: str, payload: dict) -> dict:
        if session_id not in self._sessions:
            raise KeyError(session_id)
        state = self._classroom_validation[session_id]
        event = {
            "timestamp": utc_now_iso(),
            "event_type": str(payload.get("event_type") or "UNKNOWN"),
            "task_id": payload.get("task_id"),
            "step_id": payload.get("step_id"),
            "channel": payload.get("channel"),
            "question": str(payload.get("question") or "").strip(),
            "duration_ms": max(0, int(payload.get("duration_ms") or 0)),
        }
        if state["enabled"]:
            state["events"].append(event)
            if event["event_type"] == "TEACHER_CORRECTION":
                self.record_knowledge_candidate(
                    session_id,
                    question=event["question"],
                    task_id=event["task_id"],
                    step_id=event["step_id"],
                    llm_answer=str(payload.get("ai_answer") or ""),
                    answer_source="AI_REFERENCE",
                )
                candidate = self._knowledge_candidates[session_id][-1]
                candidate["teacher_correction"] = str(payload.get("teacher_answer") or "")
                candidate["teacher_review"] = "APPROVED"
                candidate["teacher_override"] = candidate["teacher_correction"]
                candidate["resolved"] = True
                candidate["review_status"] = "APPROVED"
                candidate["candidate_type"] = "TEACHER_STYLE_CANDIDATE"
                candidate["final_answer"] = candidate["teacher_correction"]
        return dict(event)

    def classroom_validation_report(self, session_id: str) -> dict:
        if session_id not in self._sessions:
            raise KeyError(session_id)
        events = self._classroom_validation[session_id]["events"]
        questions = Counter(item["question"] for item in events if item["event_type"] == "AI_ASK" and item["question"])
        step_times = defaultdict(int)
        teacher_help = Counter()
        for item in events:
            key = (item["task_id"], item["step_id"])
            if item["event_type"] == "STEP_EXIT":
                step_times[key] += item["duration_ms"]
            elif item["event_type"] == "TEACHER_REVIEW":
                teacher_help[key] += 1
        asks = [item for item in events if item["event_type"] == "AI_ASK"]
        growth = self.growth_record(session_id)
        completed, total = (int(value.strip()) for value in growth.progress_label.split("/", 1))
        return {
            **self.classroom_validation_state(session_id),
            "analytics": {
                "top_questions": [{"question": question, "count": count} for question, count in questions.most_common(20)],
                "longest_steps": [
                    {"task_id": key[0], "step_id": key[1], "duration_ms": duration}
                    for key, duration in sorted(step_times.items(), key=lambda item: item[1], reverse=True)[:20]
                ],
                "teacher_help": [
                    {"task_id": key[0], "step_id": key[1], "count": count}
                    for key, count in teacher_help.most_common(20)
                ],
            },
            "learning_report": {
                "progress": growth.progress_label,
                "growth_record_id": growth.growth_record_id,
                "evidence_count": growth.evidence_count,
                "ai_ask_count": len(asks),
                "voice_count": sum(item["channel"] == "VOICE" for item in asks),
                "text_count": sum(item["channel"] == "TEXT" for item in asks),
                "vision_count": sum(item["channel"] == "VISION" for item in asks),
                "teacher_review_count": sum(item["event_type"] == "TEACHER_REVIEW" for item in events),
                "stuck_time_ms": sum(item["duration_ms"] for item in events if item["event_type"] == "STUCK"),
                "completion_rate": round(completed / total, 4) if total else 0,
                "total_recorded_duration_ms": sum(item["duration_ms"] for item in events),
            },
        }

    def get(self, session_id: str) -> LiveSession | None:
        with self._lock:
            return self._sessions.get(session_id)

    def current_step(self, session_id: str) -> SopStep:
        session = self.get(session_id)
        if session is None:
            raise KeyError(session_id)
        return self.task.steps[session._step_index]

    def _append(self, session: LiveSession, event_type: str, data: dict | None = None) -> dict:
        session.sequence += 1
        event = {
            "sequence": session.sequence,
            "timestamp": utc_now_iso(),
            "session_id": session.session_id,
            "step_id": session.current_step_id,
            "type": event_type,
            "data": data or {},
        }
        session._events.append(event)
        session.updated_at = event["timestamp"]
        return event

    def append_event(self, session_id: str, event_type: str, data: dict | None = None) -> dict:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                raise KeyError(session_id)
            return self._append(session, event_type, data)

    def begin_rag_request(self, session_id: str, dedup_key: str, request_id: str, context) -> bool:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None or session._rag_dedup_key == dedup_key:
                return False
            session._rag_dedup_key = dedup_key
            session._latest_rag_request_id = request_id
            session.rag_metrics["request_count"] += 1
            session.rag_explanation = {
                "status": "pending",
                "explanation": "正在查询教学知识…",
                "reference_summary": None,
                "sources": None,
                "latency_ms": None,
                "hit": False,
                "error_code": None,
                "request_id": request_id,
                "context_version": context.context_version,
            }
            self._append(session, "RAG_REQUESTED", {
                "request_id": request_id,
                "context_version": context.context_version,
                "sop_result": context.sop_result,
                "error_code": context.error_code,
            })
            return True

    def complete_rag_request(
        self,
        session_id: str,
        step_id: str,
        context_version: int,
        request_id: str,
        sop_result: str,
        result: dict,
    ) -> bool:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return False
            if (
                session.current_step_id != step_id
                or session.context_version != context_version
                or session._latest_rag_request_id != request_id
                or session.state == "TASK_COMPLETED"
            ):
                session.rag_metrics["stale_drop_count"] += 1
                self._append(session, "RAG_STALE_DROPPED", {"request_id": request_id})
                return False
            status = result.get("status", "error")
            latency = result.get("latency_ms")
            if isinstance(latency, (int, float)):
                session._rag_latency_total += float(latency)
                session.rag_metrics["last_latency_ms"] = float(latency)
                completed = (
                    session.rag_metrics["success_count"]
                    + session.rag_metrics["fallback_count"]
                    + 1
                )
                session.rag_metrics["average_latency_ms"] = round(session._rag_latency_total / completed, 1)
            if status == "online":
                session.rag_metrics["success_count"] += 1
                event_type = "RAG_COMPLETED"
                explanation = result.get("explanation")
            else:
                session.rag_metrics["fallback_count"] += 1
                if status == "timeout":
                    session.rag_metrics["timeout_count"] += 1
                    event_type = "RAG_TIMEOUT"
                elif status == "no_hit":
                    session.rag_metrics["no_hit_count"] += 1
                    event_type = "RAG_NO_HIT"
                elif status == "offline":
                    event_type = "RAG_FALLBACK"
                else:
                    event_type = "RAG_ERROR"
                explanation = "目前知识库说明暂时不可用。"
            session.rag_explanation = {
                **result,
                "explanation": explanation,
                "safety_notice": (
                    "此步骤涉及安全操作，必须由教师确认后才能继续。"
                    if sop_result == "TEACHER_CHECK" else None
                ),
            }
            self._append(session, event_type, {
                "request_id": request_id,
                "status": status,
                "latency_ms": latency,
            })
            return True

    def events(self, session_id: str) -> list[dict]:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                raise KeyError(session_id)
            return [dict(event) for event in session._events]

    def apply_decision(
        self,
        session_id: str,
        step: SopStep,
        detection: DetectionFact | None,
        decision: SopDecision,
    ) -> LiveSession:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                raise KeyError(session_id)
            session.state = decision.status
            if detection is not None:
                session.last_detection = detection.class_name
                session.last_confidence = detection.confidence
                if decision.error_code != "duplicate_frame":
                    session.last_frame_id = detection.frame_id
            session.pass_candidate_count = decision.pass_candidate_count
            if decision.status == "NG":
                session.fail_count += 1
            self._append(session, "SOP_EVALUATED", decision.as_dict())
            self._append(session, decision.status, decision.as_dict())
            return session

    def confirm(self, session_id: str) -> LiveSession:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                raise KeyError(session_id)
            if session.state != "PASS_CANDIDATE":
                raise InvalidSessionTransition("pass_candidate_required")
            self._append(session, "STEP_CONFIRMED")
            self._append(session, "STEP_COMPLETED")
            if session._step_index >= len(self.task.steps) - 1:
                session.state = "TASK_COMPLETED"
                session.completed_at = utc_now_iso()
                self._append(session, "TASK_COMPLETED")
                return session
            session._step_index += 1
            next_step = self.task.steps[session._step_index]
            session.current_step_id = next_step.step_id
            session.expected_class = next_step.expected_classes[0]
            session.state = "WAITING_FOR_OBJECT"
            session.last_detection = None
            session.last_confidence = None
            session.last_frame_id = None
            session.pass_candidate_count = 0
            session.context_version += 1
            session._rag_dedup_key = None
            session._latest_rag_request_id = None
            session.rag_explanation = {
                "status": "idle",
                "explanation": None,
                "reference_summary": None,
                "sources": None,
                "latency_ms": None,
                "hit": False,
                "error_code": None,
                "request_id": None,
                "context_version": session.context_version,
            }
            self._append(session, "STEP_STARTED")
            return session

    def delete(self, session_id: str) -> bool:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return False
            self._append(session, "SESSION_STOPPED")
            self._sessions.pop(session_id, None)
            self._training.pop(session_id, None)
            self._evidence.pop(session_id, None)
            self._reflections.pop(session_id, None)
            self._persist()
            return True
