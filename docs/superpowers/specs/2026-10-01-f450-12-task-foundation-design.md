# F450 12 Task Foundation Design

## Purpose

Define the single FDE-AI-UAS 2.0 F450 training spine as twelve ordered tasks while reusing the existing Live Coach, Vision, SOP, Session, RAG, Django Evidence/Growth Record, and teacher-review foundations.

## Immutable product boundaries

- The learner performs the physical work and supplies authentic evidence and reflection.
- AI explains and guides but never owns final safety approval.
- Teachers own electrical, motor, first-power, preflight, flight, and final-release decisions.
- Vision emits facts only. SOP owns instructional decisions. Task progression remains backend-authoritative.
- `D:\FDE-AI-UAS\v1.5C` is read-only.
- Flight Health is `EXISTS / INDEPENDENT_BRANCH / OUT_OF_SCOPE / RESERVED_FOR_TASK_12`; only an external integration reference is permitted.

## Delivery slices

The product remains one ordered 01–12 course. A/B/C are delivery capability levels, not separate courses:

- v2.0A Build Coach: Tasks 01–06.
- v2.0B Setup & Verification Coach: Tasks 07–10.
- v2.0C Flight & Health Coach: Tasks 11–12.

## Domain model

`TaskDefinition` is configuration, not engine code. It contains identity, phase, purpose, prerequisites, completion mode, steps, evidence requirements, reflection requirements, and teacher gates.

`TaskStep` contains instruction, rationale, verification mode, optional Vision binding, safety reminders, expected component/connector identifiers, error guidance, and next step.

Top-level task states are distinct from SOP results:

- `NOT_STARTED`
- `IN_PROGRESS`
- `PENDING_TEACHER_REVIEW`
- `NEED_REWORK`
- `COMPLETED`

Verification modes are:

- `SOP_ONLY`
- `LEARNER_CONFIRM`
- `EVIDENCE_UPLOAD`
- `VISION_ASSISTED`
- `TEACHER_CONFIRM`
- `HYBRID`

## Twelve-task catalog

The fixed order and core purpose are:

1. Recognize components and inspect inventory.
2. Bench-test each Motor + ESC without propellers; teacher confirmation required.
3. Assemble frame and motors after Task 02.
4. Solder ESC/power wiring and perform teacher continuity review with battery disconnected.
5. Install Pixhawk and peripherals with connector/orientation guidance.
6. Complete an unpowered whole-aircraft safety inspection and obtain teacher release.
7. Complete the full Mission Planner configuration flow after Task 06 release; AI never changes parameters.
8. Verify configured functions, including teacher-reviewed propeller orientation assistance.
9. Complete QGC ground-station integration and simulated mission rehearsal.
10. Complete the final powered preflight gate, including outdoor GPS/Home/RTL evidence and teacher flight release.
11. Complete teacher-supervised outdoor flight testing and capture flight evidence.
12. Perform final acceptance, link to the existing Flight Health entry, collect reflection, teacher final review, and prepare Growth Record data.

Learning content may be viewed out of sequence, but completion and hazardous actions must satisfy prerequisites.

## Safety and identifier libraries

Safety reminders, component IDs, connector/power IDs, and error codes are centralized immutable catalogs. Steps reference IDs rather than duplicating free-form semantics. Unknown identifiers are rejected at configuration validation.

The first hardware profile is `F450_PIXHAWK248`. Hardware-specific connector mappings, orientation, and safety notes live in the profile rather than SOP engine branches.

## Session and authority

The existing in-memory Live Session is extended with course task progress, current task, task status, prerequisite results, teacher releases, evidence references, reflection status, and hardware profile. The backend is the source of truth. Frontend actions request transitions; they cannot submit an authoritative PASS or teacher release.

Unsafe bypass attempts return a stable error and append an auditable event. AI uncertainty produces `UNCERTAIN` plus teacher guidance and never guesses.

## Evidence and reflection

Evidence policies are per task, not per step. The 2.0 domain initially stores development references and later converts them through adapters rather than writing directly to the v1.5C database.

Reflection keeps separate fields:

- `student_original_summary`
- `ai_assisted_summary`

AI may organize learner-provided material but cannot fabricate experience.

`GrowthRecordAdapter` will convert completed Task evidence/reflection into the existing Growth Record contract using Dev Storage / Pending Sync until production integration is separately authorized.

## Context propagation

SOP, RAG, future Voice, Vision, and teacher review receive backend-owned context containing the current task, step, hardware profile, safety state, error code, and relevant detection/evidence state. RAG and Voice remain advisory and cannot alter task completion or teacher gates.

## Flight Health boundary

Task 12 stores an integration descriptor only: route/URL, module identity, invocation mode, and returned-result reference. No Flight Health internal source, UI, API, analyzer, model, rules, database, or performance behavior is modified.

## Initial implementation boundary

The first implementation slice creates the validated 12-task catalog, identifiers, safety reminders, hardware profile, prerequisite/task-state service, and tests. It does not implement physical hardware actions, production persistence, Flight Health internals, Mission Planner automation, Voice streaming, or production deployment.
