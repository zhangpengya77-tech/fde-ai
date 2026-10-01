from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime

from .task_catalog import F450CourseDefinition, TaskStatus


def _now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class TaskTransitionError(ValueError):
    pass


@dataclass
class TaskProgress:
    task_id: str
    status: TaskStatus = TaskStatus.NOT_STARTED
    block_reason: str | None = None
    missing_prerequisites: tuple[str, ...] = ()
    evidence: list[dict] = field(default_factory=list)
    current_training_step_id: str | None = None
    training_step_progress: dict[str, dict] = field(default_factory=dict)


@dataclass(frozen=True)
class TeacherReview:
    teacher_id: str
    timestamp: str
    note: str
    task_id: str
    session_id: str
    decision: str
    previous_state: TaskStatus
    new_state: TaskStatus


class TrainingProgress:
    def __init__(self, session_id: str, student_id: str, course: F450CourseDefinition):
        self.session_id = session_id
        self.student_id = student_id
        self.course = course
        self._definitions = {task.id: task for task in course.tasks}
        self._tasks = {}
        for task in course.tasks:
            steps = {step.step_id: {"status": "NOT_STARTED", "facts": [], "safety_acknowledged": False, "teacher_decision": None} for step in task.steps}
            self._tasks[task.id] = TaskProgress(task.id, current_training_step_id=(task.steps[0].step_id if task.steps else None), training_step_progress=steps)
        self.teacher_reviews: list[TeacherReview] = []
        self.events: list[dict] = []

    def task(self, task_id: str) -> TaskProgress:
        try:
            return self._tasks[task_id]
        except KeyError as error:
            raise TaskTransitionError(f"unknown_task:{task_id}") from error

    def view_task(self, task_id: str) -> TaskProgress:
        return self.task(task_id)

    def _missing(self, task_id: str) -> tuple[str, ...]:
        return tuple(item for item in self._definitions[task_id].prerequisites if self.task(item).status is not TaskStatus.COMPLETED)

    def start_task(self, task_id: str) -> TaskProgress:
        progress = self.task(task_id)
        missing = self._missing(task_id)
        if missing:
            progress.status = TaskStatus.BLOCKED
            progress.block_reason = "MISSING_PREREQUISITES"
            progress.missing_prerequisites = missing
            self._event("TASK_BLOCKED", task_id, {"missing_prerequisites": list(missing)})
            raise TaskTransitionError(f"missing_prerequisites:{','.join(missing)}")
        if progress.status in {TaskStatus.COMPLETED, TaskStatus.PENDING_TEACHER_REVIEW}:
            raise TaskTransitionError(f"invalid_start_state:{progress.status.value}")
        progress.status = TaskStatus.IN_PROGRESS
        progress.block_reason = None
        progress.missing_prerequisites = ()
        self._event("TASK_STARTED", task_id)
        return progress

    def record_evidence(self, task_id: str, evidence_type: str, reference: str) -> None:
        progress = self.task(task_id)
        progress.evidence.append({"evidence_type": evidence_type, "reference": reference, "created_at": _now()})
        self._event("EVIDENCE_RECORDED", task_id, {"evidence_type": evidence_type})

    def _step_definition(self, task_id: str, step_id: str):
        try:
            return next(step for step in self._definitions[task_id].steps if step.step_id == step_id)
        except StopIteration as error:
            raise TaskTransitionError(f"unknown_training_step:{step_id}") from error

    def _advance_step(self, task_id: str, step_id: str) -> None:
        progress = self.task(task_id)
        definition = self._step_definition(task_id, step_id)
        progress.training_step_progress[step_id]["status"] = "COMPLETED"
        progress.current_training_step_id = definition.next_step
        self._event("TRAINING_STEP_COMPLETED", task_id, {"step_id": step_id, "next_step": definition.next_step})

    def record_step_fact(self, task_id: str, step_id: str, fact: str) -> None:
        progress = self.task(task_id)
        if progress.status is not TaskStatus.IN_PROGRESS or progress.current_training_step_id != step_id:
            raise TaskTransitionError("training_step_not_current")
        definition = self._step_definition(task_id, step_id)
        state = progress.training_step_progress[step_id]
        state["facts"].append({"fact": fact, "timestamp": _now()})
        self._event("TRAINING_STEP_FACT_RECORDED", task_id, {"step_id": step_id, "fact": fact})
        if definition.teacher_gate and state["teacher_decision"] != "APPROVE":
            state["status"] = "PENDING_TEACHER_REVIEW"
            raise TaskTransitionError("teacher_step_approval_required")
        self._advance_step(task_id, step_id)

    def acknowledge_step_safety(self, task_id: str, step_id: str) -> None:
        self._step_definition(task_id, step_id)
        self.task(task_id).training_step_progress[step_id]["safety_acknowledged"] = True
        self._event("SAFETY_ACKNOWLEDGED", task_id, {"step_id": step_id})

    def review_step(self, task_id: str, step_id: str, decision: str, teacher_id: str, *, actor_role: str = "teacher", note: str = "") -> None:
        if actor_role != "teacher":
            raise TaskTransitionError("teacher_authority_required")
        definition = self._step_definition(task_id, step_id)
        if not definition.teacher_gate or decision not in {"APPROVE", "REJECT_REWORK"}:
            raise TaskTransitionError("invalid_step_review")
        state = self.task(task_id).training_step_progress[step_id]
        state["teacher_decision"] = decision
        state["teacher_id"] = teacher_id
        state["teacher_note"] = note
        self._event("TRAINING_STEP_TEACHER_REVIEWED", task_id, {"step_id": step_id, "decision": decision, "teacher_id": teacher_id})
        if decision == "APPROVE":
            self._advance_step(task_id, step_id)
        else:
            state["status"] = "NEED_REWORK"

    def request_completion(self, task_id: str, *, actor: str) -> TaskProgress:
        progress = self.task(task_id)
        definition = self._definitions[task_id]
        if progress.status is not TaskStatus.IN_PROGRESS:
            raise TaskTransitionError(f"invalid_completion_state:{progress.status.value}")
        if task_id == "TASK_12" and not any(item["evidence_type"] == "FLIGHT_LOG_REFERENCE" for item in self.task("TASK_11").evidence):
            raise TaskTransitionError("flight_evidence_required")
        if definition.teacher_review_required:
            progress.status = TaskStatus.PENDING_TEACHER_REVIEW
            self._event("TEACHER_REVIEW_REQUESTED", task_id, {"requested_by": actor})
        else:
            progress.status = TaskStatus.COMPLETED
            self._event("TASK_COMPLETED", task_id, {"completed_by": actor})
        return progress

    def record_teacher_review(self, task_id: str, decision: str, teacher_id: str, note: str, *, actor_role: str = "teacher") -> TeacherReview:
        if actor_role != "teacher":
            raise TaskTransitionError("teacher_authority_required")
        progress = self.task(task_id)
        if progress.status is not TaskStatus.PENDING_TEACHER_REVIEW:
            raise TaskTransitionError(f"review_not_pending:{progress.status.value}")
        if decision not in {"APPROVE", "REJECT_REWORK"}:
            raise TaskTransitionError(f"invalid_teacher_decision:{decision}")
        previous = progress.status
        progress.status = TaskStatus.COMPLETED if decision == "APPROVE" else TaskStatus.NEED_REWORK
        review = TeacherReview(teacher_id, _now(), note, task_id, self.session_id, decision, previous, progress.status)
        self.teacher_reviews.append(review)
        self._event("TEACHER_REVIEWED", task_id, {"decision": decision, "teacher_id": teacher_id})
        return review

    def _event(self, event_type: str, task_id: str, data: dict | None = None) -> None:
        self.events.append({
            "sequence": len(self.events) + 1,
            "timestamp": _now(),
            "session_id": self.session_id,
            "task_id": task_id,
            "type": event_type,
            "data": data or {},
        })

    @property
    def completed_count(self) -> int:
        return sum(item.status is TaskStatus.COMPLETED for item in self._tasks.values())

    @property
    def summary(self) -> str:
        return f"{self.completed_count} / {len(self._tasks)}"
