from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class MissionPlannerSubtaskDefinition:
    subtask_id: str
    order: int
    title: str
    objective: str
    procedure: tuple[str, ...]
    completion_checks: tuple[str, ...]
    troubleshooting: tuple[str, ...] = ()
    safety_rules: tuple[str, ...] = ()
    scope_notes: tuple[str, ...] = ()
    teacher_required: bool = False
    evidence_types: tuple[str, ...] = ()
    vision_task: str | None = None
    legacy_step_ids: tuple[str, ...] = ()
    schema_version: str = "1.0"
    content_version: str = "2026.10.03"

