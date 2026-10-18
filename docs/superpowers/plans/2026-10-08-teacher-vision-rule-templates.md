# Teacher Vision Rule Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a minimal Django teacher model repository with two fixed, read-only vision rule templates and R07 review-status synchronization.

**Architecture:** Keep R07 `Evidence` and its existing Vision Submission as the only model-submission source. A small template module maps `PROP_DIRECTION` and `FOUR_SIDE_HOVER` to fixed teacher-readable definitions; Django teacher pages write only a bounded review block to `Evidence.processed_metadata`. Candidate is presentation status only and never calls Vision Center, runs inference, or changes an ACTIVE model.

**Tech Stack:** Existing Django Student Portal, Django templates, JSONField metadata, Django TestCase.

**Spec:** `docs/superpowers/specs/2026-10-08-teacher-vision-rule-templates-design.md`

## Global Constraints

- Implement only `PROP_DIRECTION_V1` and `FOUR_SIDE_HOVER_V1`; no editable teacher rule configuration.
- Reuse existing R07 `MODEL / YOLO_MODEL Evidence`, Django teacher session and cohort authorization; no migration or second repository.
- Candidate only synchronizes a status for teacher/student views; it must not run inference, import a model, or affect ACTIVE.
- `DEMO_TEST_ONLY` is never ACTIVE; this plan has no ACTIVE operation.
- Do not modify v1.5C / 8022, Vision core, Live Coach, RAG, Flight Health, MP-12, Task 08, General AI, or production data.
- Add concise Traditional Chinese comments to new core functions.
- Do not commit, push, merge, deploy, restart services, or alter existing dirty files beyond the listed focused changes.

## Review Focus

- A teacher must not access a model Evidence from an unassigned cohort; return 404 rather than exposing its existence.
- A forged cross-task template identifier must be rejected without changing metadata.
- A candidate review must not call Vision Center import/evaluate/activate or modify a model registry.
- A student must see only their own model’s review status after refresh.
- A `DEMO_TEST_ONLY` filename must never receive an ACTIVE path or label.

---

### Task 1: Fixed rule-template catalog

**Files:**
- Create: `student_portal/learning/vision_rule_templates.py`
- Create: `student_portal/learning/tests/test_vision_rule_templates.py`

**Interfaces:**
- Produces: `RULE_TEMPLATES`, `template_for_task(task_type: str) -> dict | None`, and `template_choices_for_task(task_type: str) -> tuple[dict, ...]`.
- Consumes: Existing task type strings `PROP_DIRECTION` and `FOUR_SIDE_HOVER` only.

- [ ] **Step 1: Write failing catalog tests**

Assert that `PROP_DIRECTION` resolves only to `PROP_DIRECTION_V1` with `CW_F`, `CCW_F`, `CW_B`, `CCW_B` and M1 left-front / M2 right-front / M3 right-rear / M4 left-rear text; assert `FOUR_SIDE_HOVER` resolves only to `FOUR_SIDE_HOVER_V1` with `FRONT`, `RIGHT`, `BACK`, `LEFT`; unsupported tasks return no choice.

- [ ] **Step 2: Run the catalog tests to confirm RED**

Run: `python manage.py test learning.tests.test_vision_rule_templates -v 2`

Expected: FAIL because the catalog module does not exist.

- [ ] **Step 3: Implement the read-only catalog**

Create two immutable structured definitions with Traditional Chinese display labels, fixed PASS/NG/REVIEW description, expected classes and safety wording. Add a short Traditional Chinese comment above each public helper. Do not import `vision_center.py` or call any Vision API.

- [ ] **Step 4: Run the catalog tests to confirm GREEN**

Run: `python manage.py test learning.tests.test_vision_rule_templates -v 2`

Expected: PASS.

### Task 2: Cohort-scoped teacher repository and metadata review action

**Files:**
- Modify: `student_portal/learning/views.py`
- Modify: `student_portal/learning/urls.py`
- Test: `student_portal/learning/tests/test_vision_model_center.py`

**Interfaces:**
- Consumes: `template_for_task`, existing `Evidence`, `teacher_required`, `teacher_cohorts`, and `Evidence.processed_metadata`.
- Produces: `teacher_vision_model_list`, `teacher_vision_model_detail`, and `teacher_vision_model_review` Django views plus the three `/teacher/vision-models/` routes.

- [ ] **Step 1: Write failing access and review tests**

Create model Evidence in two cohorts. Assert an assigned teacher sees only their cohort’s Evidence; direct detail/review access to the other Evidence returns 404. Assert a valid `candidate` POST writes `vision_model_review.status == "CANDIDATE"`, the correct fixed template id, teacher identity, timestamp and note history. Assert `return` writes `RETURNED`; forged template id or action leaves metadata unchanged.

- [ ] **Step 2: Run the targeted tests to confirm RED**

Run: `python manage.py test learning.tests.test_vision_model_center -v 2`

Expected: FAIL because the routes and views do not exist.

- [ ] **Step 3: Implement minimal scoped views**

Query only `Evidence.Type.MODEL` attached through `growth_submission__enrollment__cohort__in=teacher_cohorts(request.user)`. Use `get_object_or_404` on that scoped queryset. Determine the allowed template from the evidence’s existing metadata; accept only `candidate` or `return`, append an audit item under `processed_metadata["vision_model_review"]["history"]`, save only `processed_metadata`, and redirect to detail. Do not call `vision_center`, `vision_api`, import, evaluate, activate, or change any submission/model status outside the review metadata.

- [ ] **Step 4: Run the targeted tests to confirm GREEN**

Run: `python manage.py test learning.tests.test_vision_model_center -v 2`

Expected: PASS, including no cross-cohort access and no ACTIVE side effect.

### Task 3: Teacher and student presentation

**Files:**
- Modify: `student_portal/learning/templates/learning/teacher_dashboard.html`
- Create: `student_portal/learning/templates/learning/teacher_vision_model_list.html`
- Create: `student_portal/learning/templates/learning/teacher_vision_model_detail.html`
- Modify: `student_portal/learning/templates/learning/growth_record_detail.html`
- Test: `student_portal/learning/tests/test_vision_model_center.py`

**Interfaces:**
- Consumes: Task 2 view context containing scoped Evidence, fixed template data and `vision_model_review` metadata.
- Produces: A dashboard entry, model list/detail pages, and R07 review-status text for the submitting student.

- [ ] **Step 1: Extend the failing view tests**

Assert the teacher dashboard includes `視覺模型中心`; list/detail pages show filename, student, cohort, task type, size, uploaded time, fixed template summary, private existing download link, candidate/return choices and review history. Assert R07 displays `等待教師審核`, `已列為候選`, or `退回補件` from its own Evidence metadata and never shows ACTIVE/inference copy.

- [ ] **Step 2: Run the presentation tests to confirm RED**

Run: `python manage.py test learning.tests.test_vision_model_center -v 2`

Expected: FAIL because the templates and status copy do not exist.

- [ ] **Step 3: Implement the minimal Traditional Chinese pages**

Add one dashboard link. Render simple responsive semantic tables/cards using existing portal CSS classes; reuse the existing evidence download route. Present the template as read-only; teachers only select the permitted template and submit candidate/return with optional note. On R07, show only the current review status and current note for that student’s own model.

- [ ] **Step 4: Run presentation tests to confirm GREEN**

Run: `python manage.py test learning.tests.test_vision_model_center -v 2`

Expected: PASS.

### Task 4: Focused regression and manual acceptance evidence

**Files:**
- Test: `student_portal/learning/tests/test_vision_model_center.py`
- Test: `student_portal/learning/tests/test_project_directions.py`

**Interfaces:**
- Consumes: The completed Django teacher repository and existing R07 upload flow.
- Produces: Evidence that the new review metadata neither changes R07 upload behavior nor invokes the Vision model runtime.

- [ ] **Step 1: Add no-runtime-side-effect test**

Patch the existing Vision submission/model-center call points and assert a candidate or return review does not call import, evaluation, activation or inference. Add a `DEMO_TEST_ONLY` Evidence case and assert the page may show candidate/returned status but never ACTIVE.

- [ ] **Step 2: Run focused automated verification**

Run: `python manage.py test learning.tests.test_vision_rule_templates learning.tests.test_vision_model_center learning.tests.test_project_directions -v 1`

Expected: PASS. Existing intentional mocked failure logs in project-direction tests may appear, but the test command must finish `OK`.

- [ ] **Step 3: Perform local session acceptance**

Using the isolated v2.0 portal only: teacher login -> dashboard -> 視覺模型中心 -> submitted R07 model -> detail -> candidate or return -> refresh; student login -> R07 -> see synchronized status. Record this as local browser acceptance only; iPhone Safari remains PENDING until the user performs device testing.

- [ ] **Step 4: Inspect focused diff and status without Git writes**

Run: `git diff --check` for the listed files, `git diff -- <listed files>`, and `git status --short`. Confirm no protected paths changed and report no commit/push/merge/deploy.
