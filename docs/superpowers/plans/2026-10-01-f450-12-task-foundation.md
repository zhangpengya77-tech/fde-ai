# F450 12 Task Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the validated twelve-task F450 course foundation, safety/identifier catalogs, hardware profile, and backend-authoritative prerequisite state without modifying Flight Health or v1.5C.

**Architecture:** Extend the existing modular Live Backend with configuration-first domain modules. Keep SOP decisions and top-level task progression separate, and expose no client-controlled PASS or teacher-release transition.

**Tech Stack:** Python 3 dataclasses, Starlette Live Backend, unittest/pytest-compatible tests, existing JavaScript Live Coach.

**Spec:** `docs/superpowers/specs/2026-10-01-f450-12-task-foundation-design.md`

## Global Constraints

- Work only in `D:\FDE-AI-UAS-v2.0` on `fde-ai-v2.0-dev`.
- Never modify `D:\FDE-AI-UAS\v1.5C`.
- Preserve all pre-existing dirty files and do not include them in commits.
- Do not modify any `flight-health/` internal file or its API/UI/analyzer.
- Do not modify `best.pt`, model thresholds, Production, secrets, or the RAG corpus.
- Hardware-dependent results remain `NOT_TESTED` or `PENDING_TEACHER_REVIEW`.

## Review Focus

- Attempting to complete a task with unmet prerequisites must be rejected and tested in Task 4.
- Learner confirmation must never satisfy a teacher gate; tested in Task 4.
- Unknown safety/component/connector IDs must fail catalog validation; tested in Tasks 1–3.
- Viewing a future task must not mutate completion state; tested in Task 4.
- Flight Health must remain an external descriptor with no internal dependency import; tested in Task 5.

---

### Task 1: Identifier and Safety Reminder Catalogs

**Files:**
- Create: `live_backend/app/identifiers.py`
- Create: `live_backend/app/safety.py`
- Test: `live_backend/tests/test_f450_catalogs.py`

**Interfaces:**
- Produces: frozen component, connector, power, error, and safety-reminder catalogs; `validate_identifier(kind: str, value: str) -> None`.

- [ ] Write failing tests for every required identifier/reminder and unknown-ID rejection.
- [ ] Run `python -m pytest live_backend/tests/test_f450_catalogs.py -q` and confirm failure.
- [ ] Implement immutable catalogs and validation.
- [ ] Re-run the focused tests and confirm PASS.
- [ ] Commit only these files with `feat: add f450 identifier and safety catalogs`.

### Task 2: Hardware Profile

**Files:**
- Create: `live_backend/app/hardware_profiles.py`
- Modify: `live_backend/tests/test_f450_catalogs.py`

**Interfaces:**
- Consumes: identifier catalogs from Task 1.
- Produces: frozen `HardwareProfile`; `get_hardware_profile(profile_id: str) -> HardwareProfile`; profile `F450_PIXHAWK248`.

- [ ] Add failing tests for profile identity, Pixhawk connector mapping, orientation, and unknown profile rejection.
- [ ] Run the focused tests and confirm failure.
- [ ] Implement the profile without adding SOP conditionals.
- [ ] Re-run and confirm PASS.
- [ ] Commit with `feat: add f450 pixhawk hardware profile`.

### Task 3: Validated Twelve-Task Configuration

**Files:**
- Create: `live_backend/app/task_catalog.py`
- Create: `live_backend/tests/test_f450_task_catalog.py`

**Interfaces:**
- Consumes: safety and identifier validation plus hardware profile identity.
- Produces: `VerificationMode`, `CompletionMode`, `TaskStatus`, `TaskStep`, `TaskDefinition`, `F450CourseDefinition`; `load_f450_course() -> F450CourseDefinition`; `validate_course(course) -> None`.

- [ ] Write failing tests asserting exactly 12 ordered tasks, immutable names/purposes, A/B/C allocation, required prerequisites, completion modes, evidence/reflection policy, and Task 12 external Flight Health descriptor.
- [ ] Add tests for Task 07 being a complete Mission Planner flow rather than a placeholder.
- [ ] Add tests for required safety reminders and verification modes on Tasks 02–11.
- [ ] Run focused tests and confirm failure.
- [ ] Implement the smallest configuration and validator satisfying the tests.
- [ ] Re-run and confirm PASS.
- [ ] Commit with `feat: add f450 twelve task catalog`.

### Task 4: Prerequisite and Task State Service

**Files:**
- Create: `live_backend/app/task_state.py`
- Create: `live_backend/tests/test_f450_task_state.py`

**Interfaces:**
- Consumes: `F450CourseDefinition`, `TaskStatus`, and teacher-gate metadata.
- Produces: `TrainingProgress`, `TaskProgress`, `TaskTransitionError`; `start_task`, `request_completion`, `record_teacher_review`, `can_start_task`, and read-only `view_task`.

- [ ] Write failing tests for normal start, prerequisite rejection, Task 06 release before Task 07, Task 10 release before Task 11, learner teacher-gate bypass rejection, NEED_REWORK, completion, task isolation, and view-without-mutation.
- [ ] Run focused tests and confirm failure.
- [ ] Implement backend-authoritative transitions and monotonic events.
- [ ] Re-run and confirm PASS.
- [ ] Commit with `feat: add f450 prerequisite task state`.

### Task 5: Evidence, Reflection, and External Integration Contracts

**Files:**
- Create: `live_backend/app/training_records.py`
- Create: `live_backend/tests/test_training_records.py`

**Interfaces:**
- Produces: `EvidenceReference`, `StudentReflection`, `GrowthRecordPayload`, `GrowthRecordAdapter` protocol, `PendingSyncGrowthRecordAdapter`, and `ExternalCapabilityLink` for existing Flight Health.

- [ ] Write failing tests preserving original/AI-assisted reflection separately, rejecting fabricated empty-original summaries, producing pending-sync payloads, and keeping Flight Health as an external link only.
- [ ] Run focused tests and confirm failure.
- [ ] Implement development-only contracts without Django or Flight Health writes.
- [ ] Re-run and confirm PASS.
- [ ] Commit with `feat: add training evidence and reflection contracts`.

### Task 6: Session Context Integration

**Files:**
- Modify: `live_backend/app/sessions.py`
- Modify: `live_backend/app/rag_context.py`
- Create: `live_backend/tests/test_f450_session_context.py`

**Interfaces:**
- Consumes: task progress, hardware profile, evidence/reflection contracts.
- Produces: backend-owned F450 task context for SOP/RAG/future Voice while preserving the Phase 2 demo API.

- [ ] Write failing compatibility and context-integrity tests.
- [ ] Run focused Phase 2/3 plus new tests and confirm only new assertions fail.
- [ ] Add optional F450 training context without changing existing demo behavior.
- [ ] Re-run and confirm PASS.
- [ ] Commit with `feat: add f450 task session context`.

### Task 7: Foundation Regression and Documentation

**Files:**
- Modify: `V2_ARCHITECTURE.md`
- Modify: `DEV_HANDOFF.md`
- Create: `docs/verification/f450-12-task-foundation-report.md`

**Interfaces:**
- Consumes: completed Tasks 1–6.
- Produces: verified handoff for the next UI/teacher/evidence slice.

- [ ] Run all Live Backend, JavaScript, Worker, Django, and compile regressions.
- [ ] Verify `git diff -- flight-health` is empty and v1.5C was not written.
- [ ] Record real test counts and known hardware/production exclusions.
- [ ] Commit only foundation documentation with `docs: record f450 twelve task foundation`.
