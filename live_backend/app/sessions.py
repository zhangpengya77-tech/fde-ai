from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from threading import RLock
from uuid import uuid4

from .sop import DetectionFact, SopCourse, SopDecision, SopStep, load_demo_course
from .safety import SAFETY_REMINDERS
from .task_catalog import TaskStatus, load_f450_course
from .task_state import TaskTransitionError, TrainingProgress
from .training_records import EvidenceRecord, PendingSyncGrowthRecordAdapter, StudentReflection


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


class InMemorySessionStore:
    def __init__(self, course: SopCourse | None = None):
        self.course = course or load_demo_course()
        self.task = self.course.tasks[0]
        self._sessions: dict[str, LiveSession] = {}
        self._training: dict[str, TrainingProgress] = {}
        self._evidence: dict[str, list[EvidenceRecord]] = {}
        self._reflections: dict[str, list[StudentReflection]] = {}
        self._lock = RLock()

    def create(self, *, vision_source: str = "REAL_VISION", mode: str = "demo", training_track: str | None = None) -> LiveSession:
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
        )
        with self._lock:
            self._sessions[session.session_id] = session
            if training_track == "F450_TWELVE_TASK":
                self._training[session.session_id] = TrainingProgress(session.session_id, f"dev-student:{session.session_id}", load_f450_course())
                self._evidence[session.session_id] = []
                self._reflections[session.session_id] = []
            self._append(session, "SESSION_STARTED")
            self._append(session, "STEP_STARTED")
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
        } for item in progress.course.tasks]
        return {
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

    @staticmethod
    def _training_step_payload(step, progress) -> dict:
        state = progress.training_step_progress.get(step.step_id, {})
        return {
            "step_id": step.step_id, "id": step.step_id, "order": step.order,
            "title": step.title, "student_instruction": step.student_instruction,
            "instruction": step.student_instruction, "why_it_matters": step.why_it_matters,
            "rationale": step.why_it_matters, "expected_action": step.expected_action,
            "completion_type": step.completion_type, "teacher_gate": step.teacher_gate,
            "vision_task": step.vision_task, "evidence_required": list(step.evidence_required),
            "safety_reminders": [{"id": item, "message": SAFETY_REMINDERS[item].message} for item in step.safety_reminders],
            "progress": state,
        }

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
        return {
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

    def record_training_step_fact(self, session_id: str, step_id: str, fact: str) -> dict:
        task_id = self._sessions[session_id].current_task_id
        self.training_progress(session_id).record_step_fact(task_id, step_id, fact)
        return self.training_state(session_id)

    def acknowledge_training_step_safety(self, session_id: str, step_id: str) -> dict:
        task_id = self._sessions[session_id].current_task_id
        self.training_progress(session_id).acknowledge_step_safety(task_id, step_id)
        return self.training_state(session_id)

    def review_training_step(self, session_id: str, task_id: str, step_id: str, decision: str, teacher_id: str, note: str) -> dict:
        self.training_progress(session_id).review_step(task_id, step_id, decision, teacher_id, note=note)
        self._sync_training_session(session_id, task_id)
        return self.training_state(session_id)

    def start_training_task(self, session_id: str, task_id: str) -> dict:
        self.training_progress(session_id).start_task(task_id)
        self._sync_training_session(session_id, task_id)
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
        return self.training_state(session_id)

    def add_training_evidence(self, session_id: str, evidence: EvidenceRecord) -> None:
        self._evidence[session_id].append(evidence)
        self.training_progress(session_id).record_evidence(evidence.task_id, evidence.evidence_type.value, evidence.file_reference or evidence.evidence_id)
        if evidence.step_id:
            self.training_progress(session_id).record_step_evidence(evidence.task_id, evidence.step_id, evidence.evidence_type.value)
        self._sync_training_session(session_id, evidence.task_id)

    def add_training_reflection(self, session_id: str, reflection: StudentReflection) -> None:
        self._reflections[session_id].append(reflection)
        current = self.training_progress(session_id).task(reflection.task_id).current_training_step_id
        if current:
            self.training_progress(session_id).record_step_reflection(reflection.task_id, current)
        self._sync_training_session(session_id, reflection.task_id)

    def review_training_task(self, session_id: str, task_id: str, decision: str, teacher_id: str, note: str):
        review = self.training_progress(session_id).record_teacher_review(task_id, decision, teacher_id, note)
        self._sync_training_session(session_id, task_id)
        return review

    def growth_record(self, session_id: str):
        return PendingSyncGrowthRecordAdapter().build(self.training_progress(session_id), tuple(self._evidence[session_id]), tuple(self._reflections[session_id]))

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
            return True
