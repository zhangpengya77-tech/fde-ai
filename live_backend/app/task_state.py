from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime

from .mp12_catalog import LEGACY_TASK07_STEP_MAP, load_mp12_catalog
from .mp12_state import MissionPlannerProgress, MissionPlannerStateError
from .task_catalog import F450CourseDefinition, TaskStatus, load_f450_course


def _now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class TaskTransitionError(ValueError):
    pass


UNSAFE_STEP_PREREQUISITES = {
    ('TASK_07', 'T07_FIRST_POWER_TEACHER'): ('TASK_06',),
    ('TASK_11', 'TEACHER_CONTROLLED_FLIGHT'): ('TASK_10',),
}

TASK08_CHECK_STATUSES = {"PASS", "RETRY", "NEEDS_CONFIRMATION", "NOT_AVAILABLE_INDOOR", "VISION_MODEL_NOT_READY"}
TASK08_FINAL_STEP = "T08_TEACHER_FINAL_REVIEW"


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
            steps = {step.step_id: {"status": "NOT_STARTED", "facts": [], "evidence_references": [], "check_status": None, "student_note": "", "safety_acknowledged": False, "teacher_decision": None} for step in task.steps}
            self._tasks[task.id] = TaskProgress(task.id, current_training_step_id=(task.steps[0].step_id if task.steps else None), training_step_progress=steps)
        self.teacher_reviews: list[TeacherReview] = []
        self.events: list[dict] = []
        # MP-12 Integration（Backend）：MP-12 是 TASK_07 的深度子模組，
        # 狀態掛在 Main-12 同一份 TrainingProgress 上，parent_task_id 固定為 TASK_07。
        self._mission_planner = MissionPlannerProgress(student_id, load_mp12_catalog())

    def task(self, task_id: str) -> TaskProgress:
        try:
            return self._tasks[task_id]
        except KeyError as error:
            raise TaskTransitionError(f"unknown_task:{task_id}") from error

    def view_task(self, task_id: str) -> TaskProgress:
        return self.task(task_id)

    def _missing(self, task_id: str) -> tuple[str, ...]:
        return tuple(item for item in self._definitions[task_id].prerequisites if self.task(item).status is not TaskStatus.COMPLETED)

    def missing_prerequisites(self, task_id: str) -> tuple[str, ...]:
        return self._missing(task_id)

    def unsafe_step_missing(self, task_id: str, step_id: str | None) -> tuple[str, ...]:
        required = UNSAFE_STEP_PREREQUISITES.get((task_id, step_id), ())
        return tuple(item for item in required if self.task(item).status is not TaskStatus.COMPLETED)

    def _require_safe_step(self, task_id: str, step_id: str) -> None:
        missing = self.unsafe_step_missing(task_id, step_id)
        if missing:
            self._event('UNSAFE_STEP_BLOCKED', task_id, {'step_id': step_id, 'missing_prerequisites': list(missing)})
            raise TaskTransitionError(f"unsafe_step_prerequisites:{','.join(missing)}")

    def start_task(self, task_id: str) -> TaskProgress:
        progress = self.task(task_id)
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

    def record_step_fact(self, task_id: str, step_id: str, fact: str, student_note: str = "") -> None:
        progress = self.task(task_id)
        if progress.status is not TaskStatus.IN_PROGRESS or progress.current_training_step_id != step_id:
            raise TaskTransitionError("training_step_not_current")
        definition = self._step_definition(task_id, step_id)
        self._require_safe_step(task_id, step_id)
        state = progress.training_step_progress[step_id]
        if task_id == "TASK_08":
            if fact not in TASK08_CHECK_STATUSES:
                raise TaskTransitionError("invalid_task08_check_status")
            if fact == "NOT_AVAILABLE_INDOOR" and step_id != "T08_GPS_COMPASS_STATUS":
                raise TaskTransitionError("indoor_status_only_allowed_for_gps")
            if fact == "VISION_MODEL_NOT_READY" and step_id != "T08_PROP_VISION":
                raise TaskTransitionError("vision_pending_only_allowed_for_prop")
        state["facts"].append({"fact": fact, "timestamp": _now()})
        if task_id == "TASK_08":
            state["check_status"] = fact
            state["student_note"] = str(student_note or "").strip()
            if fact == "RETRY":
                state["status"] = "NEED_REWORK"
                self._event("TASK08_CHECK_RETRY", task_id, {"step_id": step_id})
                return
        self._event("TRAINING_STEP_FACT_RECORDED", task_id, {"step_id": step_id, "fact": fact})
        if definition.safety_reminders and not state["safety_acknowledged"]:
            raise TaskTransitionError("safety_acknowledgment_required")
        if definition.evidence_required:
            raise TaskTransitionError("evidence_required")
        if definition.teacher_gate and state["teacher_decision"] != "APPROVE":
            state["status"] = "PENDING_TEACHER_REVIEW"
            progress.status = TaskStatus.PENDING_TEACHER_REVIEW
            self._event("TRAINING_STEP_TEACHER_REVIEW_REQUESTED", task_id, {"step_id": step_id})
            return
        self._advance_step(task_id, step_id)

    def record_step_evidence(self, task_id: str, step_id: str, evidence_type: str, reference: str | None = None, check_status: str | None = None, student_note: str = "") -> None:
        progress = self.task(task_id)
        if progress.current_training_step_id != step_id:
            return
        definition = self._step_definition(task_id, step_id)
        self._require_safe_step(task_id, step_id)
        if evidence_type not in definition.evidence_required:
            raise TaskTransitionError("wrong_evidence_type")
        state = progress.training_step_progress[step_id]
        if task_id == "TASK_08":
            selected = check_status or "PASS"
            if selected not in TASK08_CHECK_STATUSES or selected in {"RETRY", "VISION_MODEL_NOT_READY"}:
                raise TaskTransitionError("invalid_task08_evidence_status")
        state["facts"].append({"fact": f"EVIDENCE:{evidence_type}", "timestamp": _now()})
        if reference:
            state["evidence_references"].append(reference)
        if task_id == "TASK_08":
            state["check_status"] = selected
            state["student_note"] = str(student_note or "").strip()
        if definition.teacher_gate and state["teacher_decision"] != "APPROVE":
            state["status"] = "PENDING_TEACHER_REVIEW"
            progress.status = TaskStatus.PENDING_TEACHER_REVIEW
            self._event("TRAINING_STEP_TEACHER_REVIEW_REQUESTED", task_id, {"step_id": step_id})
            return
        self._advance_step(task_id, step_id)

    def record_step_reflection(self, task_id: str, step_id: str) -> None:
        progress = self.task(task_id)
        if progress.current_training_step_id != step_id:
            return
        if not (step_id.endswith("REFLECTION") or step_id.endswith("RECORD")):
            return
        progress.training_step_progress[step_id]["facts"].append({"fact": "STUDENT_REFLECTION", "timestamp": _now()})
        self._advance_step(task_id, step_id)

    def acknowledge_step_safety(self, task_id: str, step_id: str) -> None:
        self._step_definition(task_id, step_id)
        self.task(task_id).training_step_progress[step_id]["safety_acknowledged"] = True
        self._event("SAFETY_ACKNOWLEDGED", task_id, {"step_id": step_id})

    # ---- MP-12 Integration Adapter（Backend）：複用既有 MP-12 子任務能力 ----
    # 複用來源：D:\FDE-AI-UAS-MP12 live_backend/app/mp12_state.py + mp12_catalog.py
    # 本輪不重新實作 Catalog / State / Safety / Teacher Gate，只做最小接入與契約校正。

    @staticmethod
    def _legacy_steps_for_mp_subtask(subtask_id: str) -> tuple[str, ...]:
        """依 LEGACY_TASK07_STEP_MAP 取得 MP 子任務對應的 TASK_07 舊步驟。"""
        return tuple(
            step_id for step_id, mapped_id in LEGACY_TASK07_STEP_MAP.items()
            if mapped_id == subtask_id
        )

    def _mirror_mp_subtask_state(self, subtask_id: str, state: dict) -> None:
        """把 MP 子任務狀態 mirror 回 TASK_07 的對應舊步驟（Main-12 看得到 MP 進度）。"""
        task = self.task("TASK_07")
        for step_id in self._legacy_steps_for_mp_subtask(subtask_id):
            legacy_state = task.training_step_progress[step_id]
            legacy_state["status"] = state["status"]
            legacy_state["teacher_decision"] = state.get("teacher_decision")
            if state.get("teacher_id"):
                legacy_state["teacher_id"] = state["teacher_id"]
            if state.get("teacher_note"):
                legacy_state["teacher_note"] = state["teacher_note"]

    def _mark_task07_in_progress(self) -> None:
        """Main-12 Contract：MP-12 推進只能把 TASK_07 帶到 IN_PROGRESS，
        不得因 MP-12 完成而自動完成 TASK_07（TASK_07 必須由 Main-12 自身流程完成）。"""
        task = self.task("TASK_07")
        if task.status is TaskStatus.NOT_STARTED:
            task.status = TaskStatus.IN_PROGRESS

    def select_mp_subtask(self, subtask_id: str) -> dict:
        self._mark_task07_in_progress()
        try:
            state = self._mission_planner.select(subtask_id)
        except MissionPlannerStateError as error:
            raise TaskTransitionError(str(error)) from error
        legacy_steps = self._legacy_steps_for_mp_subtask(subtask_id)
        if legacy_steps:
            self.task("TASK_07").current_training_step_id = legacy_steps[0]
        self._event("MP_SUBTASK_SELECTED", "TASK_07", {"subtask_id": subtask_id})
        return state

    def complete_mp_subtask(self, subtask_id: str, *, actor: str) -> dict:
        try:
            state = self._mission_planner.complete(subtask_id, actor=actor)
        except MissionPlannerStateError as error:
            raise TaskTransitionError(str(error)) from error
        self._mirror_mp_subtask_state(subtask_id, state)
        self._mark_task07_in_progress()
        self._event(
            "MP_SUBTASK_COMPLETION_RECORDED",
            "TASK_07",
            {"subtask_id": subtask_id, "status": state["status"], "actor": actor},
        )
        return state

    def review_mp_subtask(
        self,
        subtask_id: str,
        decision: str,
        teacher_id: str,
        *,
        actor_role: str = "teacher",
        reason: str = "",
        note: str = "",
    ) -> dict:
        try:
            state = self._mission_planner.review(
                subtask_id,
                decision,
                teacher_id,
                actor_role=actor_role,
                reason=reason,
                note=note,
            )
        except MissionPlannerStateError as error:
            raise TaskTransitionError(str(error)) from error
        self._mirror_mp_subtask_state(subtask_id, state)
        self._mark_task07_in_progress()
        self._event(
            "MP_SUBTASK_TEACHER_REVIEWED",
            "TASK_07",
            {
                "subtask_id": subtask_id,
                "decision": decision,
                "teacher_id": teacher_id,
                "reason": reason,
                "note": note,
            },
        )
        return state

    def record_mp_evidence(self, subtask_id: str, evidence_type: str, reference: str) -> dict:
        try:
            state = self._mission_planner.record_evidence(subtask_id, evidence_type, reference)
        except MissionPlannerStateError as error:
            raise TaskTransitionError(str(error)) from error
        self._event(
            "MP_SUBTASK_EVIDENCE_RECORDED",
            "TASK_07",
            {"subtask_id": subtask_id, "evidence_type": evidence_type},
        )
        return state

    def mp12_state(self) -> dict:
        return self._mission_planner.as_dict()

    def review_step(self, task_id: str, step_id: str, decision: str, teacher_id: str, *, actor_role: str = "teacher", note: str = "") -> None:
        if actor_role != "teacher":
            raise TaskTransitionError("teacher_authority_required")
        definition = self._step_definition(task_id, step_id)
        if not definition.teacher_gate or decision not in {"APPROVE", "REJECT_REWORK"}:
            raise TaskTransitionError("invalid_step_review")
        if task_id == "TASK_08" and step_id == TASK08_FINAL_STEP and decision == "APPROVE":
            if self.task("TASK_07").status is not TaskStatus.COMPLETED:
                raise TaskTransitionError("task08_prerequisite_incomplete:TASK_07")
            task08 = self.task("TASK_08")
            if not task08.evidence:
                raise TaskTransitionError("task08_evidence_required")
            previous_steps = [step for step in self._definitions[task_id].steps if step.step_id != TASK08_FINAL_STEP]
            if any(task08.training_step_progress[step.step_id]["status"] != "COMPLETED" for step in previous_steps):
                raise TaskTransitionError("task08_checks_incomplete")
        state = self.task(task_id).training_step_progress[step_id]
        state["teacher_decision"] = decision
        state["teacher_id"] = teacher_id
        state["teacher_note"] = note
        self._event("TRAINING_STEP_TEACHER_REVIEWED", task_id, {"step_id": step_id, "decision": decision, "teacher_id": teacher_id})
        if decision == "APPROVE":
            self._require_safe_step(task_id, step_id)
            if task_id == "TASK_08" and step_id == TASK08_FINAL_STEP:
                state["status"] = "COMPLETED"
                task08 = self.task(task_id)
                task08.current_training_step_id = None
                task08.status = TaskStatus.COMPLETED
                self._event("TASK_COMPLETED", task_id, {"completed_by": teacher_id})
                return
            self.task(task_id).status = TaskStatus.IN_PROGRESS
            self._advance_step(task_id, step_id)
        else:
            state["status"] = "NEED_REWORK"
            self.task(task_id).status = TaskStatus.NEED_REWORK

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

    def to_dict(self) -> dict:
        """Compact durable snapshot for session persistence (P1: 重载保留 VISION_MODEL_NOT_READY)."""
        return {
            "session_id": self.session_id,
            "student_id": self.student_id,
            "tasks": {
                task_id: {
                    "status": task.status.value,
                    "current_training_step_id": task.current_training_step_id,
                    "training_step_progress": task.training_step_progress,
                    "evidence": task.evidence,
                    "missing_prerequisites": list(task.missing_prerequisites),
                    "block_reason": task.block_reason,
                }
                for task_id, task in self._tasks.items()
            },
            "teacher_reviews": [
                {
                    "teacher_id": review.teacher_id,
                    "timestamp": review.timestamp,
                    "note": review.note,
                    "task_id": review.task_id,
                    "session_id": review.session_id,
                    "decision": review.decision,
                    "previous_state": review.previous_state.value,
                    "new_state": review.new_state.value,
                }
                for review in self.teacher_reviews
            ],
            "events": self.events,
            "mp12": self._mission_planner.to_dict(),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "TrainingProgress":
        progress = cls(data["session_id"], data["student_id"], load_f450_course())
        for task_id, task_data in data["tasks"].items():
            task = progress._tasks[task_id]
            task.status = TaskStatus(task_data["status"])
            task.current_training_step_id = task_data["current_training_step_id"]
            task.training_step_progress = task_data["training_step_progress"]
            task.evidence = task_data["evidence"]
            task.missing_prerequisites = tuple(task_data["missing_prerequisites"])
            task.block_reason = task_data["block_reason"]
        progress.teacher_reviews = [
            TeacherReview(
                teacher_id=review["teacher_id"],
                timestamp=review["timestamp"],
                note=review["note"],
                task_id=review["task_id"],
                session_id=review["session_id"],
                decision=review["decision"],
                previous_state=TaskStatus(review["previous_state"]),
                new_state=TaskStatus(review["new_state"]),
            )
            for review in data["teacher_reviews"]
        ]
        progress.events = data.get("events", [])
        progress._mission_planner = MissionPlannerProgress.from_dict(data.get("mp12", {}), data["student_id"])
        return progress
