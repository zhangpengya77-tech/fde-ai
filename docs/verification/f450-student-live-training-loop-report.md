# F450 Student Live Training Loop Report

Date: 2026-10-01

## Scope

The F450 twelve-task data foundation is connected to the existing Live Session, Live Coach page, backend-owned teacher review, development Evidence/Reflection storage, and the pending-sync Growth Record 05 adapter. The twelve-task definitions were reused without redesign.

## Implemented loop

1. A session created with `training_track=F450_TWELVE_TASK` receives the `F450_PIXHAWK248` hardware profile and backend-owned Task context.
2. The student page renders all twelve tasks through one shared renderer. Future tasks remain viewable while Backend prerequisite state controls whether they are actionable or completable.
3. Task 01 requires a linked Evidence record and non-empty original student Reflection before completion.
4. Task 02 completion becomes `PENDING_TEACHER_REVIEW`. Student approval is rejected; explicit development `MOCK_TEACHER` approval completes Task 02 and unlocks Task 03. Rejection produces `NEED_REWORK`.
5. Growth Record 05 reports F450 progress as `x / 12` with `PENDING_SYNC`; it does not write the v1.5C database.

## Authority boundaries

- Session, Task state, prerequisites, completion, safety state, and teacher review are Backend authoritative.
- Frontend renders state and submits learner Evidence/Reflection; it cannot forge completion or teacher approval.
- Camera may stay active in `WAITING`, but Vision runs only for an explicit student check, configured SOP Vision check, or configured Auto Observation task.
- Student UI translates internal IDs to human wording; raw IDs remain for development diagnostics.
- Reflection keeps original student input separate from any AI-assisted text and rejects AI-only records.

## Verification

- Live Backend: 95 passed.
- JavaScript, Worker, and Phase suites: 79 passed.
- Focused student task UI: 17 passed.
- Django: 238 passed, 22 skipped; system check clean.
- Phase 1 Python helper tests: 4 passed.
- Python compile: passed.

## Protected and untested scope

- Flight Health is unchanged and remains an external Task 12 integration reference.
- `D:\FDE-AI-UAS\v1.5C` remains `EXTERNAL_DIRTY_STATE_DO_NOT_TOUCH`; no checkout, reset, clean, stash, commit, or file write was performed.
- Real Motor/ESC testing, soldering, multimeter continuity, first power, outdoor GPS, Arm, propeller operation, and real flight were not tested and require learner/teacher evidence.
