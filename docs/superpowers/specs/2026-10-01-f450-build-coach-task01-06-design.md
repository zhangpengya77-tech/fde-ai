# F450 Build Coach Task 01–06 Design

Date: 2026-10-01

## Goal

Deepen the existing F450 twelve-task foundation so a novice learner can complete the software-guided Build Coach flow from Task 01 through the Task 06 unpowered teacher safety release. The result unlocks Task 07 at `6 / 12` without claiming that any physical high-risk operation was automatically verified.

## Fixed architecture

The existing authority chain is extended, not replaced:

`Live Session → TrainingProgress → TaskProgress → TrainingStepProgress`

There is no second Session, SOP Engine, Task State Machine, or Teacher Review system. Training steps use `current_training_step_id` and `training_step_progress`; Phase 2 Vision/SOP fields such as `current_step_id`, detection state, and `PASS_CANDIDATE` remain separate.

Frontend submits learner operation facts. Backend owns step state, task state, prerequisites, completion, and teacher gates.

## Versioned configuration

The F450 course, each Task, and each Training Step expose `schema_version` and `content_version`. Evidence metadata records the applicable task/step content versions so later SOP edits do not make historical evidence ambiguous.

The expanded Training Step schema contains:

- `step_id`, `order`, `title`
- `student_instruction`, `why_it_matters`, `expected_action`
- `completion_type`
- `components`, `connectors`, `safety_reminders`
- `vision_task`, `evidence_required`, `teacher_gate`
- `common_errors`, `ai_guidance`, `fallback_guidance`, `next_step`

All Task 01–06 content is configuration-driven. Task 07–12 definitions and purpose remain unchanged.

## Step progress and completion

Each TaskProgress owns TrainingStepProgress records with state, acknowledgment, evidence references, learner result/checklist data, and teacher-review outcome. Safety acknowledgment means only that the learner read the warning; it never clears a teacher gate.

Step completion types are declarative: instruction/read, learner confirmation, safety acknowledgment, checklist, evidence, Vision-assisted, and teacher confirmation. Backend validates required facts before advancing. High-risk physical steps remain `NOT_TESTED` or `PENDING_TEACHER_REVIEW` until a real teacher records a result; `MOCK_TEACHER` approvals are marked development-only and prove only software workflow.

Task-level completion continues through the existing TrainingProgress state machine. Step-level teacher gates reuse the same role headers, teacher identity policy, decisions, and audit structure as task-level review.

## Build Coach content

Task 01 has ten steps covering workspace preparation, component identification, checklist, overview Evidence, and Reflection. Vision is optional assistance for component presence.

Task 02 has twelve steps covering purpose, no-prop acknowledgment, tester introduction, Motor/ESC connections and M1–M4 result capture, optional cross-test, teacher review, Evidence, and Reflection. Power connection and test execution remain teacher-gated.

Task 03 has eleven steps covering frame layout, forward direction, arm assembly, Vision-assisted structure check, tested motors, M1–M4 placement, screw-length warning, installation, mechanical review, Evidence, and Reflection.

Task 04 has twelve steps covering ESC power/signal concepts, routing, heat-shrink acknowledgment, real polarity verification, XT60 guidance, pre-solder teacher gate, human soldering, visual Evidence, teacher continuity check, electrical approval, Evidence, and Reflection. Vision never declares electrical safety.

Task 05 has eleven steps covering Pixhawk, arrow orientation, MAIN OUT signals, GPS orientation/connection, receiver, telemetry, power module, full wiring Evidence, and review. Unverified pin definitions explicitly require hardware reference or teacher confirmation.

Task 06 has eleven steps covering the complete unpowered mechanical/electrical checklist, whole-aircraft Evidence, learner checklist, final teacher safety release, and Reflection. Battery connection is prohibited. Task 07 remains blocked until Task 06 is completed through teacher release.

## Context and guidance

Backend training context contains the current Task and Training Step, hardware profile, expected action, component/connector IDs, safety reminders, teacher gate, Evidence state, and prior errors. Deterministic AI Coach text uses four short sections: now, why, caution when needed, and completion action.

RAG and future Voice may explain context but cannot change step/task state. If a Task 04 learner asks whether the battery may be connected before continuity approval, controlled context keeps the answer negative regardless of generic RAG content.

## Camera and Vision

Camera may remain `ACTIVE / WAITING`. Waiting never triggers inference. Vision runs only on learner request, a configured Vision step, or configured Auto Observation. Task 01, 03, and selected Task 05 orientation steps may use Vision assistance. Task 04 uses Camera for Evidence only and never delegates electrical safety to Vision.

## Evidence and Reflection

Task-level Evidence rules expose Required, Optional, and Completed status. Evidence is not required for every step. Task 01, 03, 04, 05, and 06 require the specified photos/checklists; Task 02 requires four test-result facts and teacher review. Development storage records metadata and references only.

Every Build Coach Task requires a short learner Reflection. Original learner input remains separate from AI-assisted wording; AI cannot invent an empty Reflection.

## Student and teacher UI

The existing shared Student Task UI becomes mobile-first and renders one current training step at a time. The 12 Task map is collapsible. Large touch controls expose learner confirmation, safety acknowledgment, manual AI check, Evidence, Reflection, and teacher state.

The minimal teacher review surface shows learner/session, Task and step, Evidence, safety reminders, AI/Vision facts, Reflection, and a required teacher note for rejection. It supports APPROVE and REJECT_REWORK through the existing authorization boundary.

## Safety and protected scope

Motor tests, soldering, continuity, battery, first power, outdoor GPS, Arm, and flight are never automatically marked as physical PASS. v1.5C and Flight Health remain untouched. Task 07–12 content remains the existing formal skeleton. No Production deployment occurs.

## Acceptance

Automated development flow proves Task 01 through Task 06, required Evidence/Reflection, step and task teacher gates, `6 / 12`, and Task 07 actionable. It explicitly records all physical high-risk results as development simulation or pending real review.

A classroom browser checklist covers Desktop Chrome and marks iPhone Safari/Android Chrome `NOT_TESTED` until real devices are used.
