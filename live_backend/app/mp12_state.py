from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime

from .mp12_catalog import load_mp12_catalog
from .mp12_models import MissionPlannerSubtaskDefinition


def _now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class MissionPlannerStateError(ValueError):
    pass


class MissionPlannerProgress:
    def __init__(
        self,
        student_id: str,
        catalog: tuple[MissionPlannerSubtaskDefinition, ...],
    ):
        self.student_id = student_id
        self.catalog = catalog
        self._definitions = {item.subtask_id: item for item in catalog}
        self.current_subtask_id = catalog[0].subtask_id if catalog else None
        self._states = {
            item.subtask_id: {
                "status": "NOT_STARTED",
                "facts": [],
                "evidence": [],
                "teacher_decision": None,
                "teacher_id": None,
                "teacher_reason": None,
                "teacher_note": None,
                "updated_at": None,
            }
            for item in catalog
        }
        self.events: list[dict] = []

    def definition(self, subtask_id: str) -> MissionPlannerSubtaskDefinition:
        try:
            return self._definitions[subtask_id]
        except KeyError as error:
            raise MissionPlannerStateError(f"unknown_mp_subtask:{subtask_id}") from error

    def state(self, subtask_id: str) -> dict:
        self.definition(subtask_id)
        return self._states[subtask_id]

    def select(self, subtask_id: str) -> dict:
        self.definition(subtask_id)
        state = self.state(subtask_id)
        if state["status"] == "NOT_STARTED":
            state["status"] = "IN_PROGRESS"
            state["updated_at"] = _now()
        self.current_subtask_id = subtask_id
        self._event("MP_SUBTASK_SELECTED", subtask_id)
        return deepcopy(state)

    def complete(self, subtask_id: str, *, actor: str) -> dict:
        definition = self.definition(subtask_id)
        state = self.state(subtask_id)
        if state["status"] == "COMPLETED":
            return deepcopy(state)
        if subtask_id == "MP12" and any(
            self._states[f"MP{index:02d}"]["status"] != "COMPLETED"
            for index in range(1, 12)
        ):
            raise MissionPlannerStateError("mp12_prerequisites_incomplete")
        state["status"] = (
            "PENDING_TEACHER_REVIEW" if definition.teacher_required else "COMPLETED"
        )
        state["facts"].append({"fact": "LEARNER_COMPLETED", "actor": actor, "timestamp": _now()})
        state["teacher_decision"] = None
        state["updated_at"] = _now()
        self.current_subtask_id = subtask_id
        self._event("MP_SUBTASK_COMPLETION_REQUESTED", subtask_id, {"actor": actor})
        return deepcopy(state)

    def review(
        self,
        subtask_id: str,
        decision: str,
        teacher_id: str,
        *,
        actor_role: str,
        reason: str = "",
        note: str = "",
    ) -> dict:
        if actor_role != "teacher":
            raise MissionPlannerStateError("teacher_authority_required")
        definition = self.definition(subtask_id)
        state = self.state(subtask_id)
        if not definition.teacher_required:
            raise MissionPlannerStateError("mp_subtask_teacher_review_not_required")
        if state["status"] != "PENDING_TEACHER_REVIEW":
            raise MissionPlannerStateError(f"mp_review_not_pending:{state['status']}")
        if decision not in {"APPROVE", "REJECT_REWORK", "HOLD"}:
            raise MissionPlannerStateError(f"invalid_mp_teacher_decision:{decision}")
        state["status"] = {
            "APPROVE": "COMPLETED",
            "REJECT_REWORK": "NEED_REWORK",
            "HOLD": "PENDING_TEACHER_REVIEW",
        }[decision]
        state["teacher_decision"] = decision
        state["teacher_id"] = teacher_id
        state["teacher_reason"] = reason
        state["teacher_note"] = note
        state["updated_at"] = _now()
        self._event(
            "MP_SUBTASK_TEACHER_REVIEWED",
            subtask_id,
            {
                "teacher_id": teacher_id,
                "decision": decision,
                "reason": reason,
                "note": note,
            },
        )
        return deepcopy(state)

    def record_evidence(self, subtask_id: str, evidence_type: str, reference: str) -> dict:
        definition = self.definition(subtask_id)
        if evidence_type not in definition.evidence_types:
            raise MissionPlannerStateError("wrong_mp_evidence_type")
        state = self.state(subtask_id)
        state["evidence"].append(
            {"evidence_type": evidence_type, "reference": reference, "timestamp": _now()}
        )
        state["updated_at"] = _now()
        self._event("MP_SUBTASK_EVIDENCE_RECORDED", subtask_id, {"evidence_type": evidence_type})
        return deepcopy(state)

    @property
    def completed_count(self) -> int:
        return sum(state["status"] == "COMPLETED" for state in self._states.values())

    @property
    def completed(self) -> bool:
        return bool(self._states) and self.completed_count == len(self._states)

    def as_dict(self) -> dict:
        current = self._definitions.get(self.current_subtask_id)
        items = []
        for definition in self.catalog:
            state = deepcopy(self._states[definition.subtask_id])
            items.append({
                "subtask_id": definition.subtask_id,
                "order": definition.order,
                "title": definition.title,
                "objective": definition.objective,
                "procedure": list(definition.procedure),
                "completion_checks": list(definition.completion_checks),
                "troubleshooting": list(definition.troubleshooting),
                "safety_rules": list(definition.safety_rules),
                "scope_notes": list(definition.scope_notes),
                "teacher_required": definition.teacher_required,
                "evidence_types": list(definition.evidence_types),
                "vision_task": definition.vision_task,
                "legacy_step_ids": list(definition.legacy_step_ids),
                **state,
            })
        return {
            "title": "Mission Planner AI 调参助教",
            "parent_task_id": "TASK_07",
            "current_subtask_id": self.current_subtask_id,
            "current_subtask": next(
                (item for item in items if item["subtask_id"] == self.current_subtask_id),
                None,
            ),
            "next_subtask": self._next_payload(current),
            "progress": f"{self.completed_count} / {len(self.catalog)}",
            "completed_count": self.completed_count,
            "total": len(self.catalog),
            "completed": self.completed,
            "subtasks": deepcopy(self._states),
            "items": items,
        }

    def to_dict(self) -> dict:
        """Compact durable snapshot for session persistence (P1: 重载保留)."""
        return {
            "current_subtask_id": self.current_subtask_id,
            "states": deepcopy(self._states),
            "events": self.events,
        }

    @classmethod
    def from_dict(cls, data: dict, student_id: str) -> "MissionPlannerProgress":
        instance = cls(student_id, load_mp12_catalog())
        instance.current_subtask_id = data.get("current_subtask_id")
        instance._states = data.get("states") or {
            item.subtask_id: {
                "status": "NOT_STARTED",
                "facts": [],
                "evidence": [],
                "teacher_decision": None,
                "teacher_id": None,
                "teacher_reason": None,
                "teacher_note": None,
                "updated_at": None,
            }
            for item in instance.catalog
        }
        instance.events = data.get("events", [])
        return instance

    def _next_payload(self, current: MissionPlannerSubtaskDefinition | None) -> dict | None:
        if current is None:
            return None
        following = next((item for item in self.catalog if item.order == current.order + 1), None)
        if following is None:
            return None
        return {"subtask_id": following.subtask_id, "title": following.title}

    def _event(self, event_type: str, subtask_id: str, data: dict | None = None) -> None:
        self.events.append({
            "sequence": len(self.events) + 1,
            "timestamp": _now(),
            "student_id": self.student_id,
            "parent_task_id": "TASK_07",
            "subtask_id": subtask_id,
            "type": event_type,
            "data": data or {},
        })

