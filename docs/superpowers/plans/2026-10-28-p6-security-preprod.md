# P6 Security Preproduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an isolated, fail-closed P6 candidate that protects Django-to-Live calls with short-lived, body-bound, cohort-bound, replay-resistant assertions.

**Architecture:** Start from commit `98523d6`, then selectively import only the verified Phase-4 Vision proxy files. Replace the legacy HMAC header contract with one versioned assertion envelope. Django issues claims from authenticated database relationships; Gateway forwards a trusted assertion; Live verifies claims and records each `jti` in a SQLite replay ledger using atomic unique insertion with expiry cleanup.

**Tech Stack:** Django, Starlette/FastAPI-style Live backend, Cloudflare Worker JavaScript candidate, Python standard-library HMAC/SQLite, Node test runner, isolated SQLite/media/registry paths.

**Spec:** User instruction “FDE-AI 2.0｜P6 最小安全修復與獨立預發布環境”, 2026-10-28.

## Global Constraints

- Use only `D:\FDE-AI-UAS-v2.0-p6-security-preprod` for P6 code changes.
- Never modify v1.5C, 8022, 8770, Pages, Worker, Tunnel, DNS, formal DB, formal Registry, or scheduled tasks.
- Do not commit, push, merge, deploy, or store real secrets in Git/logs/frontend.
- Extract only the Phase-4 runtime files and verified direct dependencies; never copy the main worktree’s 69 changes wholesale.
- P6 production mode must fail closed if any required key, assertion, claim, replay ledger, or trusted internal caller is unavailable.

## Review Focus

- A request body changed after signing must be rejected before the handler writes data.
- The same `jti` must be rejected across two Live processes sharing the same isolated SQLite ledger.
- Expired, future-skewed, malformed, wrong-audience, wrong-cohort, and wrong-enrollment assertions must be rejected.
- No browser-supplied `X-FDE-*` identity header may change the authenticated user, role, cohort, or enrollment.
- All isolated database, media, registry, replay-ledger, and log paths must remain below the candidate root.

---

### Task 1: Baseline and selective extraction

**Files:**
- Modify: seven verified Phase-4 runtime files only, after source SHA-256 capture.
- Create: `docs/reports/P6_FILE_MANIFEST_2026-10-28.md`

- [ ] Capture source and destination SHA-256, then create a line-level selective patch for the four core files plus `internal_auth.py` × 2 and `vision_preflight.py`.
- [ ] Verify no unrelated main-worktree files appear in the P6 diff.

### Task 2: Versioned assertion envelope and replay rejection

**Files:**
- Modify: `student_portal/learning/internal_auth.py`
- Modify: `live_backend/app/internal_auth.py`
- Create: focused Django/Live security tests

- [ ] Write failing tests for legacy unsigned acceptance, missing claims, body tampering, expiry beyond 60 seconds, and replay.
- [ ] Implement `v=1` HMAC envelope containing issuer, audience, subject, role, enrollment, sorted cohorts, method, canonical path, body SHA-256, `iat`, `exp`, and `jti`.
- [ ] Implement a candidate-root SQLite replay ledger using an atomic unique insert and expiry cleanup; test two verifier processes against the same ledger.
- [ ] Re-run focused tests and record RED-to-GREEN evidence.

### Task 3: Gateway and Live fail-closed boundary

**Files:**
- Modify: isolated Gateway candidate only after its current source is copied as a traceable patch.
- Modify: `live_backend/app/vision_api.py` and direct protected Live boundary only as needed.
- Test: Gateway and Live identity boundary suites.

- [ ] Write failing tests for missing assertion URL/key, forged browser identity headers, and direct Live access.
- [ ] Enforce assertion-only production mode; leave compatibility mode usable only under explicit isolated development configuration.
- [ ] Verify write requests reach Live only with valid body-bound assertion and trusted proxy proof.

### Task 4: Isolated preproduction E2E

**Files:**
- Create: `ops/p6/` isolated launch/stop/config/test scripts.
- Test: real HTTP Django → Gateway → Live flows with isolated SQLite/media/registry/log/replay paths.

- [ ] Verify all paths are below one candidate root and secrets are test-only runtime values.
- [ ] Test valid same-cohort request, cross-cohort denial, anonymous denial, body tamper, replay, direct Live denial, and offline upstream fail-closed behavior.
- [ ] Run existing focused YOLO/Django/Live regressions that the extracted files affect.

### Task 5: Release candidate evidence and rollback

**Files:**
- Create: P6 manifest, test evidence, runbook, and rollback document.

- [ ] Produce minimal runtime file list and SHA-256 values.
- [ ] Record test counts, untested HTTPS/Tunnel items, risks, and reversible rollback steps.
- [ ] Verify `git diff` and `git status`; leave all work uncommitted.

## Self-Review

- Spec coverage: Tasks 1–5 cover selective extraction, security contract, fail-closed behavior, isolated environment, and release evidence. Formal deployment remains deliberately excluded.
- Shared interfaces: Django-issued envelope is consumed by Gateway then Live; Task 2 fixes the format before Task 3 uses it.
- Scope: H3 ACTIVE Registry is excluded. No v1.5C or production service work is planned.

