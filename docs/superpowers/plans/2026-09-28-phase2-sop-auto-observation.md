# Phase 2 SOP Live Task and Automatic Observation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an authoritative backend SOP task flow with Dev-only Mock Vision and a 1 FPS, no-queue automatic observation frontend while preserving Phase 1A manual snapshot behavior.

**Architecture:** Backend modules own SOP decisions, session transitions, events, guidance, and confirmation. The frontend owns camera capture and scheduling only; it renders authoritative responses and uses one-in-flight/drop-stale semantics.

**Tech Stack:** Python 3.14, Starlette, dataclasses, unittest/TestClient, browser JavaScript, Node test runner, HTML/CSS.

**Spec:** `docs/superpowers/specs/2026-09-28-phase2-sop-auto-observation-design.md`

## Global Constraints

- Work only in `D:\FDE-AI-UAS-v2.0` on `fde-ai-v2.0-dev`.
- Do not modify `D:\FDE-AI-UAS\v1.5C`, Production Worker/Tunnel/ORIGIN_URL, `best.pt`, model threshold, or Production data.
- Vision emits Detection Facts only. SOP Engine alone emits teaching decisions.
- REAL_VISION never automatically completes a step while `MODEL_ACCURACY_PENDING`.
- Mock Vision is available only under explicit Dev/Test configuration and is rejected otherwise.
- Safety-gated steps require `TEACHER_CHECK` and ordinary confirmation cannot bypass it.
- Keep existing snapshot and manual camera behavior compatible.
- Do not add RAG/LLM/Voice network integration, API keys, WebSocket, or production persistence.
- Use TDD: each production behavior follows a witnessed failing test.

## Review Focus

- Multiple detections in one Vision result: choose the highest-confidence detection deterministically and preserve all raw facts in the response.
- Duplicate/out-of-order frame IDs: do not increment evidence or regress authoritative session state.
- Confirmation replay: a repeated confirm must not skip an additional step.
- Mock flag/config mismatch: backend rejection must hold even if a client reveals or calls the endpoint.
- Auto-stop during a slow request: late completion must not render or schedule another request.

---

### Task 1: Configurable SOP schema and decision engine

**Files:**
- Create: `live_backend/app/sop.py`
- Create: `live_backend/tests/test_sop.py`

**Interfaces:**
- Produces: `DetectionFact(class_name, confidence, box, frame_id, timestamp)`; `SopStep`, `SopTask`, `SopCourse`; `SopDecision`; `load_demo_course() -> SopCourse`; `SopEngine.evaluate(step, detection, pass_candidate_count, last_frame_id) -> SopDecision`.
- Consumes: none.

- [ ] **Step 1: Write failing SOP tests**
  - Assert schema values for `prepare_motor`, `prepare_frame_arm`, and `prepare_flight_controller`.
  - Assert no detection -> NO_DETECTION, confidence below minimum -> UNCERTAIN, wrong class -> NG, expected class -> PASS_CANDIDATE.
  - Assert safety gate -> TEACHER_CHECK.
  - Assert duplicate frame ID does not increment evidence.
  - Assert highest-confidence selection is deterministic when a helper receives multiple detections.
- [ ] **Step 2: Run RED**
  - Run: `python -m unittest tests.test_sop -v`
  - Expected: import failure for `app.sop`.
- [ ] **Step 3: Implement minimal schema, demo definition, validation, and pure engine**
  - Demo IDs exactly match the approved instruction; minimum confidence is one centralized demo value and not a Production/model qualification threshold.
- [ ] **Step 4: Run GREEN and backend suite**
  - Run: `python -m unittest tests.test_sop -v`
  - Run: `python -m unittest discover -s tests -q`
  - Expected: all pass.
- [ ] **Step 5: Commit**
  - `git commit -m "feat: add configurable sop engine"`

### Task 2: Authoritative session state machine and events

**Files:**
- Modify: `live_backend/app/sessions.py`
- Modify: `live_backend/tests/test_sessions.py`
- Create: `live_backend/tests/test_phase2_sessions.py`

**Interfaces:**
- Consumes: `SopCourse`, `SopDecision` from Task 1.
- Produces: mutable internal `LiveSession` with `as_dict()`; immutable event dictionaries; `InMemorySessionStore.create(...)`, `apply_decision(...)`, `confirm(...)`, `events(...)`, `append_event(...)`, `delete(...)`.

- [ ] **Step 1: Write failing state/event tests**
  - Assert required fields, READY/WAITING transitions, counters, unique-frame evidence, monotonic sequences, session isolation, confirmation replay rejection, step advance, final task completion, and safety confirmation rejection.
- [ ] **Step 2: Run RED**
  - Run: `python -m unittest tests.test_phase2_sessions -v`
  - Expected: missing state-machine API failures.
- [ ] **Step 3: Implement minimal locked in-memory state and event stream**
  - Preserve `create()`, `get()`, and `delete()` compatibility for Phase 1 tests.
- [ ] **Step 4: Run GREEN and backend suite**
  - Run both the new test file and full backend discovery.
- [ ] **Step 5: Commit**
  - `git commit -m "feat: add backend session state machine"`

### Task 3: Guidance interfaces and deterministic provider

**Files:**
- Create: `live_backend/app/guidance.py`
- Create: `live_backend/tests/test_guidance.py`

**Interfaces:**
- Consumes: session dictionaries and `SopDecision`.
- Produces: `CoachMessage`; abstract `GuidanceProvider.get_guidance(session, decision, error_code) -> CoachMessage`; `DeterministicGuidanceProvider`; non-network `RAGGuidanceProvider` protocol/interface; `VoiceInput` and `VoiceOutput` protocols.

- [ ] **Step 1: Write failing message tests**
  - Assert exact Chinese guidance for NO_DETECTION, UNCERTAIN, NG with expected/detected values, PASS_CANDIDATE, STEP_COMPLETED, TASK_COMPLETED, and TEACHER_CHECK.
  - Assert placeholder RAG provider has no network/API-key implementation.
- [ ] **Step 2: Run RED**
  - Expected: `app.guidance` missing.
- [ ] **Step 3: Implement minimal interfaces and provider**
- [ ] **Step 4: Run GREEN and backend suite**
- [ ] **Step 5: Commit**
  - `git commit -m "feat: add deterministic guidance provider"`

### Task 4: Coach orchestrator, Mock Vision, and authoritative APIs

**Files:**
- Create: `live_backend/app/orchestrator.py`
- Create: `live_backend/app/mock_vision.py`
- Modify: `live_backend/app/config.py`
- Modify: `live_backend/app/main.py`
- Create: `live_backend/tests/test_orchestrator.py`
- Create: `live_backend/tests/test_phase2_api.py`
- Create: `live_backend/tests/test_mock_vision.py`
- Modify: existing snapshot/session tests only where additive response fields require assertions.

**Interfaces:**
- Consumes: engine, store, guidance, DetectionFact.
- Produces: `CoachOrchestrator.process(session_id, detections, frame_id, vision_source, metrics) -> dict`; `MockVision.scenario(name, frame_id) -> list[dict]`; GET session/events, POST confirm, Dev-only POST simulate; additive snapshot response fields `session`, `sop`, `guidance`.

- [ ] **Step 1: Write failing orchestrator and API tests**
  - Cover correct/wrong/no/low, REAL no auto-complete, Dev Mock full three-step flow, Production mock hard rejection, offline Vision availability response, event order, invalid confirmation, confirmation replay, and highest-confidence multi-detection.
- [ ] **Step 2: Run RED**
  - Expected: missing orchestrator/mock/routes.
- [ ] **Step 3: Implement orchestrator and Dev/Test configuration**
  - Add `FDE_LIVE_DEV_MODE` with secure false default; tests inject explicit config/arguments rather than mutating Production.
  - Snapshot continues returning existing facts/metrics plus authoritative Phase 2 fields.
- [ ] **Step 4: Run GREEN and full backend suite**
- [ ] **Step 5: Commit**
  - `git commit -m "feat: add coach orchestrator and dev mock vision"`

### Task 5: Live task UI and Dev Simulator

**Files:**
- Modify: `live/index.html`
- Modify: `live/live.css`
- Modify: `live/live.js`
- Create: `live/task-ui.test.cjs`
- Extend: `live/interaction.test.cjs` only for compatibility assertions.

**Interfaces:**
- Consumes: Phase 2 API response shapes from Task 4.
- Produces: `renderTaskState(elements, payload)`; `confirmStep(fetchImpl, sessionId)`; `simulateVision(fetchImpl, sessionId, scenario)`; controller methods for start coach, confirm, and simulate.

- [ ] **Step 1: Write failing DOM/state tests**
  - Assert course/task/progress/current step/instruction/Vision/SOP/guidance rendering; confirm API call; Dev Simulator hidden unless server reports Dev mode; scenario calls; existing Manual Detect remains enabled.
- [ ] **Step 2: Run RED**
  - Run: `node --test live/task-ui.test.cjs`
  - Expected: missing exports/markup.
- [ ] **Step 3: Implement minimal task panel and Dev Simulator**
  - No client-side completion mutation; refresh using authoritative response.
- [ ] **Step 4: Run GREEN and all live JS tests**
- [ ] **Step 5: Commit**
  - `git commit -m "feat: add live task interface"`

### Task 6: 1 FPS Automatic Observation scheduler

**Files:**
- Create: `live/auto-observation.js`
- Create: `live/auto-observation.test.cjs`
- Modify: `live/index.html`
- Modify: `live/live.js`
- Modify: `live/live.css`

**Interfaces:**
- Consumes: a `captureAndSend() -> Promise<response>` callback and UI/controller session/camera readiness.
- Produces: `createAutoObservationScheduler({intervalMs, captureAndSend, setTimeoutImpl, clearTimeoutImpl, onMetrics, onResult, onError})` with `start()`, `stop()`, `getMetrics()`; metrics `requestCount`, `skippedFrameCount`, `averageRoundTripMs`, `maxInFlight`, `queueLength`.

- [ ] **Step 1: Write failing scheduler tests**
  - Assert 1000 ms default, start/stop, one-in-flight, busy tick skipped without capture/queue, queueLength always zero, maxInFlight one, latest tick captures current frame, and a late response after stop is ignored and cannot reschedule.
- [ ] **Step 2: Run RED**
  - Expected: module missing.
- [ ] **Step 3: Implement minimal generation-token scheduler**
  - Use one scheduled timeout at a time; expose no queue.
- [ ] **Step 4: Write failing controller integration tests**
  - Assert Auto requires active camera/session; start and stop events/UI; stop prevents hidden posts; REAL response stays PASS_CANDIDATE.
- [ ] **Step 5: Implement controller integration and Manual/Auto controls**
- [ ] **Step 6: Run GREEN and all JavaScript tests**
- [ ] **Step 7: Commit**
  - `git commit -m "feat: add automatic observation scheduler"`

### Task 7: End-to-end workflow, regression, and handoff

**Files:**
- Create: `live_backend/tests/test_phase2_workflow.py`
- Modify: `PROJECT_CONTEXT.md`
- Modify: `V2_ARCHITECTURE.md`
- Modify: `DEV_HANDOFF.md`
- Create: `docs/verification/phase2-development-report.md`
- Fix: trailing whitespace in the Phase 2 spec metadata while updating docs.

**Interfaces:**
- Consumes: all prior Phase 2 modules and UI contracts.
- Produces: executable Mock workflow evidence, regression evidence, and current handoff.

- [ ] **Step 1: Write failing end-to-end Mock workflow test**
  - Assert frame_arm at motor -> NG; motor -> PASS_CANDIDATE; confirm; frame_arm/confirm; flight_controller/confirm; TASK_COMPLETED; ordered expected events.
- [ ] **Step 2: Run RED**
  - Expected: fail on any missing integration behavior.
- [ ] **Step 3: Complete only the integration gaps exposed by the test**
- [ ] **Step 4: Run Phase 2 GREEN**
  - Backend Phase 2 tests and all JavaScript tests.
- [ ] **Step 5: Run full regression**
  - Live Backend unittest discovery.
  - All repository Node tests.
  - Worker tests using the existing project command.
  - Django regression using the existing isolated environment/command; report actual pass/skip values.
  - Python `compileall`.
  - Verify v1.5C HEAD and clean status.
- [ ] **Step 6: Update documentation with actual commands, counts, performance scheduler metrics, commits, and known issue `MODEL_ACCURACY_PENDING`**
- [ ] **Step 7: Commit**
  - `git commit -m "test: cover phase2 workflow"`
  - `git commit -m "docs: update phase2 handoff"`
