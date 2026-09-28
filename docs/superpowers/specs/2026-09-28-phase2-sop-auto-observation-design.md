# FDE-AI-UAS v2.0 Phase 2 SOP Live Task and Automatic Observation Design

Date: 2026-09-28  
Status: Approved architecture; implementation pending  
Canonical workspace: `D:\FDE-AI-UAS-v2.0`  
Branch: `fde-ai-v2.0-dev`

## 1. Intent and scope

Phase 2 turns the verified Phase 1A.2 camera and snapshot chain into a task-aware Live Coach. The system must know the active course, task, and step; turn Vision facts into deterministic SOP decisions; provide guidance; and support a low-frequency automatic observation loop without request accumulation.

This phase includes:

- Phase 2A: configurable SOP engine, authoritative in-memory session state, deterministic guidance, coach orchestrator, Dev-only Mock Vision, task UI, confirmation flow, and event stream.
- Phase 2B foundation: 1 FPS automatic observation with one-in-flight, latest-frame-wins semantics, and stale-frame dropping.
- Interfaces only for future RAG and Voice AI.

This phase excludes real RAG/LLM integration, Realtime Voice AI, production Learning Record writes, Teacher Dashboard, model retraining or replacement, Production deployment, WebSocket transport, and multi-user scaling.

## 2. Fixed architectural authority

The architecture is Backend Modular Authority:

```text
Camera / Upload / Mock Input
          |
          v
Vision Source -> Detection Facts
          |
          v
Coach Orchestrator
          |
          +-> SOP Engine -> Teaching Decision
          |
          +-> Guidance Provider -> Coach Message
          |
          +-> Session Service -> State, Counters, Events
          |
          v
Frontend rendering and user controls
```

Authority boundaries are strict:

- Vision answers only “what is visible”: class, confidence, bounding box, and frame ID.
- SOP Engine is the sole producer of PASS_CANDIDATE, NG, UNCERTAIN, NO_DETECTION, NEED_HELP, and TEACHER_CHECK.
- Session Service owns current step, state, counters, event sequence, and completion.
- Coach Orchestrator coordinates modules but never invents PASS/NG decisions.
- Frontend captures frames and renders state. It cannot directly set a step or task as completed.
- Mock Vision is Dev/Test-only and must be rejected when the backend is not explicitly in development/test mode.

## 3. Vision sources

### 3.1 REAL_VISION

REAL_VISION preserves the Phase 1A.2 chain:

```text
Browser JPEG snapshot
-> Live Backend :8030
-> HTTP Vision Adapter
-> Vision Service :8765
-> best.pt
-> Detection Facts
```

The existing `best.pt` and configured threshold are unchanged. Model status remains `MODEL_ACCURACY_PENDING`.

A REAL_VISION result may reach `PASS_CANDIDATE` but must never permanently complete a step without an explicit backend confirmation request. Repeated correct frames update evidence counters only.

### 3.2 MOCK_VISION

MOCK_VISION supports deterministic development scenarios:

- `motor`
- `frame_arm`
- `flight_controller`
- wrong class
- no detection
- low confidence

The server exposes mock behavior only when an explicit Dev/Test configuration flag is enabled. Production-like configuration returns a forbidden/not-available error. Mock input is never accepted through the normal REAL_VISION snapshot contract.

Mock Vision can be configured for test-only automatic confirmation so the complete task flow can be exercised without physical hardware.

## 4. SOP definition schema

The first implementation uses a structured Python definition with JSON-compatible values. Definitions are data, not step-specific conditional code.

Course fields:

- `course_id`
- `title`
- `tasks`

Task fields:

- `task_id`
- `title`
- `steps`

Step fields:

- `step_id`
- `title`
- `instruction`
- `expected_classes`
- `min_confidence`
- `required_pass_count`
- `error_guidance`
- `safety_gate`
- `next_step`

The initial course is `F450_BASIC_ASSEMBLY`, task `PARTS_PREPARATION`:

1. `MOTOR_PREPARATION`: expected `motor`
2. `FRAME_ARM_PREPARATION`: expected `frame_arm`
3. `FLIGHT_CONTROLLER_PREPARATION`: expected `flight_controller`
4. task completed

The demo steps are not safety gates. The schema nevertheless supports `safety_gate=true`; a qualifying detection at such a step yields `TEACHER_CHECK` and cannot be confirmed through the ordinary student confirmation route.

## 5. SOP decision model

Inputs:

- task and step context
- expected classes
- detection class
- confidence
- bounding box
- frame ID
- vision source
- current pass count

Decision order:

1. Missing detection -> `NO_DETECTION`
2. Confidence below step minimum -> `UNCERTAIN`
3. Detected class outside expected classes -> `NG`
4. Safety-gated expected detection -> `TEACHER_CHECK`
5. Expected detection -> `PASS_CANDIDATE`

The SOP result contains:

- `status`
- `error_code`
- `expected_classes`
- `detected_class`
- `confidence`
- `pass_candidate_count`
- `required_pass_count`
- `next_step`

Different frame IDs are required for repeated evidence. Duplicate or stale frames do not increment the pass candidate count.

## 6. Session Service and state machine

The in-memory session record contains:

- `session_id`
- `user_mode`
- `course_id`
- `task_id`
- `current_step_id`
- `state`
- `vision_source`
- `expected_class`
- `last_detection`
- `last_confidence`
- `last_frame_id`
- `pass_candidate_count`
- `fail_count`
- `help_count`
- `started_at`
- `updated_at`
- `completed_at`

States:

- `READY`
- `WAITING_FOR_OBJECT`
- `DETECTING`
- `NO_DETECTION`
- `UNCERTAIN`
- `NG`
- `PASS_CANDIDATE`
- `STEP_COMPLETED`
- `TASK_COMPLETED`
- `OFFLINE`
- reserved: `NEED_HELP`, `TEACHER_CHECK`

The backend validates transitions. An ordinary confirmation is accepted only from `PASS_CANDIDATE`. REAL_VISION always requires explicit confirmation. A confirmed non-final step emits completion events, advances to its configured next step, resets step counters, and returns to `WAITING_FOR_OBJECT`. The final confirmation transitions to `TASK_COMPLETED`.

## 7. Event stream

Every event has:

- `sequence`: monotonically increasing per session
- `timestamp`
- `session_id`
- `step_id`
- `type`
- `data`

Event types:

- `SESSION_STARTED`
- `CAMERA_STARTED`
- `AUTO_OBSERVATION_STARTED`
- `FRAME_CAPTURED`
- `DETECTION_RECEIVED`
- `SOP_EVALUATED`
- `NO_DETECTION`
- `UNCERTAIN`
- `NG`
- `PASS_CANDIDATE`
- `STEP_CONFIRMED`
- `STEP_COMPLETED`
- `TASK_COMPLETED`
- `SESSION_STOPPED`

Events remain in memory and are exposed read-only. This is not yet the production Learning Record.

## 8. Guidance and future interfaces

`GuidanceProvider` accepts session context, SOP result, and error code, and returns a `CoachMessage`.

`DeterministicGuidanceProvider` produces localized fixed messages:

- NO_DETECTION: ask the learner to place the full object in frame.
- UNCERTAIN: ask the learner to move closer and hold steady.
- NG: name the expected and detected classes.
- PASS_CANDIDATE: state that the expected object appears correct and awaits confirmation.
- STEP_COMPLETED: state that the next step has started.
- TASK_COMPLETED: state that parts preparation is complete.
- TEACHER_CHECK: state that teacher confirmation is required.

`RAGGuidanceProvider` is an interface/placeholder only. It performs no network request and receives no API key.

Voice boundaries are type/interface definitions only:

- `VoiceInput`
- `VoiceOutput`
- `CoachMessage`

No microphone stream, speech recognition, speech synthesis, OpenAI Realtime connection, or secret is added.

## 9. Coach Orchestrator

The orchestrator receives a Detection Fact from the selected Vision source and:

1. loads the authoritative session and current SOP step;
2. records `FRAME_CAPTURED` and `DETECTION_RECEIVED`;
3. calls the SOP Engine;
4. applies the decision through Session Service;
5. records `SOP_EVALUATED` and the decision event;
6. calls the Guidance Provider;
7. returns one response containing detection facts, SOP result, guidance, session state, step progress, metrics, and event sequence.

The orchestrator cannot directly mark a step complete. Completion is performed only by the Session Service after a valid confirmation or an explicitly enabled Dev/Test mock auto-confirm path.

## 10. Incremental HTTP API

Existing routes remain compatible:

- `POST /api/live/sessions`
- `POST /api/live/sessions/{id}/snapshot`
- `DELETE /api/live/sessions/{id}`

Incremental routes:

- `GET /api/live/sessions/{id}`: authoritative session/task/step state.
- `POST /api/live/sessions/{id}/confirm`: confirm an eligible PASS_CANDIDATE; backend controls advancement.
- `GET /api/live/sessions/{id}/events`: read ordered in-memory events.
- Dev/Test only `POST /api/live/sessions/{id}/simulate`: submit a named Mock Vision scenario.

There is no arbitrary “set PASS” or “advance to step” API. Invalid transitions, disabled mock mode, safety gates, missing sessions, offline Vision, and malformed payloads return structured errors.

## 11. Frontend task mode

The existing camera and Manual AI Detect controls remain.

The task panel displays:

- Course
- Task
- Current step
- Progress
- Instruction
- Vision result
- SOP result
- Guidance
- Metrics

Controls:

- `开始 AI 陪做`
- `停止 AI 陪做`
- Manual / Auto mode
- `立即 AI 检测`
- `确认并进入下一步` when the backend reports an eligible PASS_CANDIDATE
- Dev-only simulation controls

The UI renders backend state and never invents completion. Development controls are hidden unless the page is served with backend-confirmed Dev Mode.

## 12. Automatic Observation scheduler

Phase 2B begins at 1 FPS. The scheduler is a standalone frontend module.

Required semantics:

- `one-in-flight`: no more than one snapshot request exists at any time.
- `latest-frame-wins`: each tick considers only the current video frame.
- `drop-stale-frame`: when a request is in flight, the tick is counted as dropped and no frame is encoded or queued.
- stopping cancels future ticks and prevents late responses from updating a stopped generation.
- Manual AI Detect remains available when Auto mode is stopped.

The scheduler uses a recursive timeout or equivalent completion-aware control, not an unrestricted `setInterval` POST loop. Metrics include processed frames, dropped ticks, current in-flight state, and last round trip.

Automatic REAL_VISION observations never permanently pass a step. Automatic Mock Vision advancement is permitted only under explicit Dev/Test configuration.

## 13. Failure and offline behavior

- Vision unavailable: session state becomes `OFFLINE`; guidance reports temporary Vision unavailability; auto observation remains stoppable.
- Backend request failure: frontend shows a structured error and releases `inFlight`.
- No camera/session: auto start is rejected visibly.
- Stopped stream: scheduler stops capturing.
- Invalid SOP definition: application startup/test fails rather than silently skipping a step.
- Mock endpoint outside Dev/Test: hard rejection.
- Safety gate: ordinary confirm rejected; state remains `TEACHER_CHECK`.
- Late response after Auto stop: ignored by scheduler generation token.

## 14. Testing strategy

Python tests cover:

- configurable schema and definition validation
- correct object, wrong object, no detection, and low confidence
- repeated detection with unique and duplicate frame IDs
- step confirmation, step advance, and task completion
- safety gate -> TEACHER_CHECK
- authoritative session transitions and counters
- ordered event sequence
- deterministic guidance
- orchestrator boundaries
- Mock Vision scenarios and Production hard rejection
- API retrieval, confirm, events, invalid transition, and offline behavior

JavaScript tests cover:

- task UI state rendering
- Manual mode compatibility
- Auto start and stop
- 1 FPS scheduling
- one-in-flight
- busy-tick dropping
- no request pile-up
- stale response suppression
- session/camera prerequisite errors
- Dev Simulator visibility and calls

Regression includes Live Backend, all JavaScript suites, Worker tests, Django regression, Python compile, Phase 1A/1A.2 tests, and Phase 2 tests.

## 15. Implementation sequence and commits

1. Configurable SOP schema and engine.
2. Authoritative Session Service and event stream.
3. Deterministic Guidance Provider and future interfaces.
4. Coach Orchestrator.
5. Dev-only Mock Vision and incremental APIs.
6. Live task UI and Mock demonstration.
7. Automatic Observation scheduler.
8. Full workflow/regression tests.
9. Project context, architecture, and handoff documentation.

Commits remain small and local to `fde-ai-v2.0-dev`. No push, merge, Production deploy, model change, or v1.5C modification is part of this work.

## 16. Acceptance criteria

In Mock Vision Dev Mode the system demonstrates:

1. start coach at motor step;
2. simulate frame_arm -> NG with corrective guidance;
3. simulate motor -> PASS_CANDIDATE;
4. confirm -> frame_arm step;
5. correct frame_arm and confirm -> flight_controller step;
6. correct flight_controller and confirm -> TASK_COMPLETED.

Automatic observation can start and stop at 1 FPS. Tests prove at most one inference request is active, busy ticks are dropped rather than queued, and stopped/stale responses cannot mutate the UI.

REAL_VISION remains usable in Manual and Auto modes, but never auto-completes a step while model status is `MODEL_ACCURACY_PENDING`.
