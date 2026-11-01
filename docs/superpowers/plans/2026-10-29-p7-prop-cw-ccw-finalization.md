# P7 Propeller CW/CCW Finalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely finish the isolated FDE-AI 2.0 flow: authenticated student `best.pt` submission, teacher image validation and candidate-only activation, then authenticated frontend CW/CCW propeller verification.

**Architecture:** GitHub Pages remains public and static-only.  A local HTTPS gateway exchanges the Django session for a short-lived request-bound assertion, then forwards that assertion (never browser cookies or identity headers) to Live.  The Live Vision API performs its existing class/quality checks and keeps activation candidate-only in this phase.

**Tech Stack:** Django, Starlette, Python unittest, static GitHub Pages HTML/CSS/JS.

**Spec:** User request of 2026-10-29; P7 handover report at `docs/reports/FDE_2_0_P7_ACCEPTANCE_2026-10-29.md`.

## Global Constraints

- Modify only `D:/FDE-AI-UAS-v2.0-p6-security-preprod`.
- Do not modify v1.5C, 8022, 8770, formal databases, formal models, Tunnel, DNS, or Pages configuration.
- Only `PROP_DIRECTION` is in scope; the accepted frontend labels are CW and CCW.
- Student models are never automatically ACTIVE; teacher image validation is required before candidate selection.
- No commit, push, merge, or deploy until explicit approval after verification.

## Review Focus

- Anonymous or forged student model upload must create no submission.
- Browser session cookies must reach Django only, never Live.
- Assertions must bind the exact HTTP method, path, and raw-body hash.
- Teacher validation and candidate selection must not silently make a model globally ACTIVE.
- Static public pages must not contain private API credentials or promise an offline upload.

### Task 1: Verify and repair the authenticated model-submission boundary

**Files:**
- Modify: `live_backend/app/gateway.py`, `live_backend/app/vision_api.py` only if current failing tests prove a defect.
- Test: `live_backend/tests/test_p7_b2_cookie_routing.py`, `live_backend/tests/test_p7_b3_csrf_flow.py`, `live_backend/tests/test_p7_b4_assertion_binding.py`, `live_backend/tests/test_p7_b5_vision_route_matrix.py`, `live_backend/tests/test_p7_b6_submission_auth.py`.

- [ ] Re-run the existing negative tests and retain output.
- [ ] Add a failing real-route regression only for any uncovered boundary failure.
- [ ] Implement the minimal correction.
- [ ] Re-run all P7 boundary tests.

### Task 2: Verify teacher validation and candidate-only model state

**Files:**
- Modify: `live_backend/app/vision_api.py`, `live_backend/app/vision_center.py` only if a red test establishes a gap.
- Test: `live_backend/tests/test_teacher_vision_center.py`, `live_backend/tests/test_vision_api.py`, `live_backend/tests/test_prop_direction_cw_ccw.py`.

- [ ] Write a failing test for an unauthorized validation/activation case if absent.
- [ ] Confirm `best.pt` validation uses the submitted model and reports only CW/CCW-relevant classes.
- [ ] Confirm candidate action does not change ACTIVE state.
- [ ] Run targeted Vision and mapping regression tests.

### Task 3: Perform isolated end-to-end HTTP acceptance

**Files:**
- Create: `ops/p7/tools/verify_prop_direction_e2e.py` only if no existing verifiable runner covers the full flow.
- Test: isolated HTTP evidence, with no formal service connection.

- [ ] Start only isolated processes after verifying ownership and free ports.
- [ ] Exercise student submission, teacher image validation, candidate action, and student CW/CCW frontend endpoint.
- [ ] Verify cross-cohort denial and no automatic ACTIVE mutation.
- [ ] Stop only processes started by the test and retain redacted evidence.

### Task 4: Validate the static public-site boundary

**Files:**
- Modify: `public-site/*` only if public-page tests prove a misleading login/upload/offline state.
- Test: static page JavaScript/HTML checks.

- [ ] Confirm phone/desktop responsive public URLs use public content only.
- [ ] Confirm offline state disables/redirects dynamic actions without exposing internal addresses.
- [ ] Produce the existing GitHub Pages URL for manual phone/desktop acceptance; do not publish a new build without explicit authorization.

## Self-Review

- Scope is limited to one YOLO task and its public/static boundary.
- All mutating operations require authenticated request-bound assertions.
- Any production/Tunnel/Pages operation remains outside this plan.
