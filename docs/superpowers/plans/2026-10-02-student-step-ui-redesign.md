# Student Step UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the existing Student Mode into a mobile-first, one-step-at-a-time interface without changing Backend training authority.

**Architecture:** Keep Backend Training Steps and IDs unchanged. Add a presentation-only mapping that groups detailed steps into student-facing phases, derive visibility from the current authoritative step, and keep Camera, Evidence, Reflection, Teacher Review, Ask AI, and DEV diagnostics as conditional or collapsed tools.

**Tech Stack:** Existing HTML, CSS, vanilla JavaScript, Node test runner.

**Spec:** User-approved Student Step UI Redesign instruction dated 2026-10-02.

## Global Constraints

- Work only on `fde-ai-v2.0-dev` in `D:\FDE-AI-UAS-v2.0`.
- Do not modify Backend authority, Task definitions, Task 07 logic, Camera/Vision pipeline, Growth Record architecture, Flight Health, or v1.5C.
- Task 08 remains not started.
- Preserve all protected external changes without staging or cleanup.

## Review Focus

- Unknown or future step IDs fall back to a usable one-step group instead of breaking rendering.
- Empty safety reminders hide the whole warning region.
- Evidence, Reflection, Camera, and Teacher controls only appear when the authoritative current step requires them.
- Teacher gates never enable learner forward actions.
- Backend advancement remains authoritative while the completion feedback pauses visual navigation.

---

### Task 1: Student-facing step groups

**Files:** Modify `live/live.js`; test `live/student-step-ui.test.cjs`.

- [x] Write and run failing tests for Task 01–06 mappings, Task 07 shell mapping, current/completed/future status, and fallback behavior.
- [x] Implement presentation-only group definitions and status derivation.
- [x] Run focused tests and commit.

### Task 2: One-step renderer and conditional tools

**Files:** Modify `live/index.html`, `live/live.js`, `live/live.css`; test `live/student-step-ui.test.cjs`.

- [x] Write and run failing tests for current-step rendering, conditional Camera/Safety/Evidence/Reflection/Teacher regions, AI drawer, DEV mode, and 390px layout.
- [x] Implement the mobile-first shell and conditional rendering without changing API calls.
- [x] Run focused tests and commit.

### Task 3: Completion feedback and preview

**Files:** Modify `live/live.js`, `live/live.css`; create `docs/verification/student-step-ui-mobile-preview.html`; test `live/student-step-ui.test.cjs`.

- [x] Write and run failing tests for step-complete and task-complete feedback.
- [x] Implement explicit continue controls while retaining Backend-owned progress.
- [x] Generate static 390px and desktop preview artifacts, run full regression, inspect diff, and commit.
