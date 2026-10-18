# Vision Model & Data Flywheel Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one persistent teacher-governed vision model and dataset flywheel for PROP_DIRECTION and FOUR_SIDE_HOVER to the existing FDE-AI-UAS 2.0 backend and UI.

**Architecture:** Reuse the existing Starlette backend and Vision Adapter. Add a small JSON-backed registry service for models, datasets, evaluations, camera profiles, and hard examples; deterministic PROP/HOVER rule engines consume normalized detection facts. Add routes to the existing server and minimal panels to the existing UI, without creating a second site, session system, coach, or teacher-review system.

**Tech Stack:** Python 3, Starlette, standard-library JSON/ZIP storage, existing browser JavaScript/CSS, unittest/node:test.

**Spec:** `C:\Users\admin\.codex\attachments\471046f5-a75e-4439-93ae-a87bdc200603\貼上的文字.txt`

## Global Constraints

- `D:\FDE-AI-UAS\v1.5C` is read-only.
- Do not modify `flight-health/` internals.
- No commit, push, merge, or deploy.
- YOLO sees; deterministic rules decide; AI Coach only explains; teacher activates.
- Exactly one ACTIVE model per model type; PROP and HOVER are independent.
- Persist registry state outside RAM using a minimal migratable format.
- No Auto GPU Training, AutoML, cloud training, ROS2, PX4, QGC, or new Flight Health features.

## Review Focus

- Invalid or malicious model uploads must never replace an ACTIVE model.
- Missing/duplicate/low-confidence PROP detections must not produce PASS.
- HOVER timing must use timestamps and UNKNOWN transition frames must not directly fail a run.
- Pixel coordinates without calibration must never be presented as metres.
- Dataset vNext must retain parent lineage and export metadata, not combine `.pt` files.

### Task 1: Deterministic Domain and Persistence

**Files:**
- Create: `live_backend/app/vision_center.py`
- Test: `live_backend/tests/test_vision_center.py`

- [ ] Write failing tests for model validation/activation, PROP rules, HOVER rules, calibration, hard examples, dataset lineage/export, and version separation.
- [ ] Run the focused tests and confirm failure because the module is absent.
- [ ] Implement JSON-backed registries, validators, rule engines, and ZIP export.
- [ ] Run focused tests and confirm pass.

### Task 2: Existing Backend API Integration

**Files:**
- Create: `live_backend/app/vision_api.py`
- Modify: `live_backend/app/main.py`
- Test: `live_backend/tests/test_vision_api.py`

- [ ] Write failing endpoint and teacher-role authorization tests.
- [ ] Run and confirm route failures.
- [ ] Add the `/api/v1/vision/*` routes to the existing Starlette app.
- [ ] Run focused API tests and confirm pass.

### Task 3: Existing UI Integration

**Files:**
- Modify: `live/index.html`
- Modify: `live/live.js`
- Modify: `live/live.css`
- Test: `live/vision-center-ui.test.cjs`

- [ ] Write failing static/interaction tests for the teacher center and student PROP/HOVER results.
- [ ] Add four teacher sections and two student assessment panels to the existing page.
- [ ] Connect UI actions to existing backend endpoints without model selection by students.
- [ ] Run Node tests and confirm pass.

### Task 4: Regression and Local Verification

**Files:**
- Modify only documentation if verification evidence is needed.

- [ ] Run all Python and Node tests and report pre-existing failures separately.
- [ ] Start the existing backend/frontend locally and verify health, registry, MOCK model validation, activation, PROP, HOVER, hard-example, and dataset export flows.
- [ ] Record `git status` and `git diff`; confirm v1.5C and Flight Health remain untouched.

