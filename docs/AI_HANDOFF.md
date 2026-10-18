# FDE-AI-UAS v2.0 AI Handoff

Updated: 2026-10-07 (Phase 2 Student View 演示数据接通 + 教师隔离复核)

> **当前优先级**：Flight Health AI Phase 2 开发中。F450 12 Task Live Coach 已冻结，仅允许更新本文件。


## Repository Safety

- Project: `D:\FDE-AI-UAS-v2.0`
- Branch: `fde-ai-v2.0-dev`
- Worktree: `D:\FDE-AI-UAS-v2.0`
- Current worktree is dirty. Preserve existing `index.html`, `src/styles.css`, `flight-health/`, firewall and preview-script changes.
- Do not reset, clean, stash, overwrite, commit, push, merge or deploy without explicit user approval.
- `D:\FDE-AI-UAS\v1.5C` is protected and read-only for all new work.

## Module A: F450 AI Training Coach / Live Coach

Status: **frozen for the current Flight Health priority**.

Completed foundation recorded by existing verification reports:

- Twelve-task F450 catalog and `F450_PIXHAWK248` development profile.
- Backend-owned prerequisite and task progression rules.
- Evidence, original student reflection and teacher approve/rework flow.
- Live Session integration and pending-sync Growth Record 05 adapter.
- Task 01-06 student workflow and deeper Task 07 Mission Planner coach work.

Still incomplete or requiring physical verification:

- Real motor/ESC, soldering, multimeter, first power, outdoor GPS, Arm, propeller and real-flight validation.
- Current Flight Health is an external integration reference for Task 12; do not copy its Python backend into v2.0.

Key references:

- `docs/verification/f450-12-task-data-foundation-report.md`
- `docs/verification/f450-student-live-training-loop-report.md`
- `docs/superpowers/specs/2026-10-01-f450-12-task-foundation-design.md`
- `docs/superpowers/specs/2026-10-01-f450-build-coach-task01-06-design.md`

## Module B: Flight Health AI

Status: **independent backend under active development**.

- Backend project: `D:\FDE-Flight-Health-AI`
- Backend branch: `codex/phase1-ardupilot-bin`
- Backend repository currently has no first commit; all files are untracked and must be preserved.
- v2.0 static integration shell: `D:\FDE-AI-UAS-v2.0\flight-health`
- v2.0 already has a local `/flight-health/` entry in its dirty working tree.

Implemented in the independent backend:

- FastAPI health/session/upload/analyze/diagnosis vertical slice.
- ArduPilot BIN/LOG parser, normalizer, basic features and eight basic rules.
- Backward-compatible role-view enhancement: eight engine domains, four Student View cards, deterministic plain-language AI structure, Teacher Evidence Chain, Parameter Snapshot, Teacher Review, Final Outcome and comparison schema.
- Student-safe `/result` and DEV ONLY local teacher `/teacher-result` response projections.
- Legacy full `/diagnosis` remains structurally compatible but now requires the same DEV ONLY teacher header, preventing student clients from bypassing `/result`.
- Flight Phase V1: direct MODE context for LOITER/AUTO/RTL/LAND/explicit TAKEOFF, conservative ARMED_GROUND/HOVER/MANEUVER heuristics, PREARM boundary and UNKNOWN fallback.
- Independent frontend reads backend `student_view`; professional data is fetched separately by local teacher mode.
- Real-analysis correlation, conclusion, assistant and growth-card views consume structured backend output; fixed motor/PWM examples remain Demo-only.
- DEMO payload now embeds a structured `student_view` (overall_status, display_status, main_finding, next_action, 4 health_cards) alongside `ai_diagnosis` and `experience_correlation`. DEMO mode therefore consumes the same backend-shaped projection and no longer derives health status from raw `health`/`diagnostics`.
- DEMO teacher drawer carries an explicit "DEV ONLY · DEMO 教师资料层" banner for parity with the non-demo `/teacher-result` projection.
- Verification: 81 independent backend/contract tests pass; 39 role/view/contract tests verified this round.

Not yet complete:

- Physical F450 BIN validation and threshold calibration.
- Physical validation of HOVER/MANEUVER heuristics and reliable ARMED_GROUND/TAKEOFF boundaries.
- Phase-windowed Motor/ATT/GPS calculations; current rules only receive non-destructive `phase_context` labels.
- Pilot Feedback/Teacher Review database persistence and write APIs.
- Real LLM/RAG explanation, parameter ingestion, session comparison and final-outcome workflow.
- Gateway, Tunnel, production API base, authentication and Growth Record synchronization.
- Formal v2.0 role authorization. `X-FDE-Teacher-Mode: DEV-LOCAL` is an explicit development boundary, not production authentication.

## Round 2026-10-07 Notes (Phase 2 wrap-up)

- Frontend `DEMO_DIAGNOSIS_DATA` augmented with `student_view`, `ai_diagnosis`, `pilot_feedback`, `experience_correlation` (schema_version `3.1-role-views`). DEMO 4-card render now reads `student.health_cards` exclusively.
- `renderReportPage()` and `determineStatus()` keep legacy `data.health`/`data.diagnostics` fallback paths behind explicit comments; those branches are no longer reached when `student_view` is present.
- DEMO teacher drawer banner updated to "DEV ONLY · DEMO 教师资料层" matching the non-demo projection's wording.

## Round 2026-10-07 Notes (Phase 3 — real F450 validation prep)

Scope: **documentation and fact-checking only. No backend/parser code modified.**

New/updated docs in `D:\FDE-Flight-Health-AI\docs\`:

- `REPO_BASELINE_STATUS.md` — rewritten for Phase 3 baseline: 86 untracked files / no first commit, 81 passed, API matrix, per-domain evaluability, rule trust levels, recommendation to create a first baseline commit (awaiting user authorization).
- `REAL_F450_VALIDATION_PLAN.md` — expanded: three sample classes (A normal / B known-defect / C retest), full per-sample field list, fact-check procedure, Flight Phase manual cross-check with `phase_error_case` YAML format, rule trust matrix, Student/Teacher division of labour.
- `PARM_EXTRACTION_DESIGN.md` — new. Confirmed real BIN does contain PARM (1446 messages / 1427 unique names; fields `TimeUS`,`Name`,`Value`,`Default`). Mapping to existing `ParameterSnapshot`/`ParameterValue` models, dedup strategy (latest `TimeUS` per name), parameter grouping, implementation placement options. **Design only — parser untouched.**
- `LOG_FACT_REPORT_SITL_SAMPLE.md` — new. Dry-run of the fact-check procedure.

Key findings from the fact-check dry run:

- The only BIN in the repo (13.9 MB, ArduCopter 4.8.0, 195 s) is **SITL**, confirmed by MSG `SIM Hit ground` and `RC Protocol: UDP`. **Not usable for physical rule calibration.**
- Parser reads 15 message classes correctly; mode-number mapping and timestamps OK.
- 4/8 engine domains evaluable (GPS, Motor, BAT, Log Completeness); 4 not (Flight Mode, EKF, ATT, VIBE).
- EKF and ATT domains have **no rules at all**, so they always report `INSUFFICIENT_DATA` — design现状, not a data problem.
- **Two field-level defects found and deliberately NOT fixed** (awaiting real-BIN confirmation + user decision):
  1. VIBE field is `Clip` (single) but normalizer expects `Clip0/1/2` → `clip_growth=None` → `VIB-002` can never fire.
  2. Real ARM message is `Arming motors`, but `_arm_time()` matches substring `"armed"` → ARM time never detected → PREARM boundary never applies.

Backend code, parser, rule engine and thresholds: **untouched this round.** Test counts unchanged: 81 Flight Health pass; v2.0 167 pass / 4 pre-existing failures (tunnel/supervisor/live-coach, out of scope, not addressed).

## Integration Boundary

Future integration remains:

```text
v2.0 /flight-health/ static frontend
        -> Flight Health API
        -> D:\FDE-Flight-Health-AI backend
```

Do not copy Parser, Rule Engine or backend Python files into v2.0. Stabilize the independent API first, then wire `API_BASE_URL`, Gateway/Tunnel, user Session and Growth Record adapters.

## Current Change Scope

This handoff update does not modify Live Coach runtime code. The current Flight Health role/data enhancement is contained in the independent backend plus this documentation file.

Current priority remains Flight Health independent validation. Live Coach runtime work stays frozen until the user explicitly resumes it.

## Round 2026-10-07 Notes (Phase 3 — baseline commit + field-level compatibility fixes)

Authorization: user approved creating the first baseline commit, then fixing **only** A (VIBE Clip) and B (ARM/DISARM). No thresholds, no Rule Engine criteria, no new features. **No push / merge / deploy; the fix code is intentionally left uncommitted pending user confirmation.**

### 1. Baseline commit created

- Hash: `1d769fbbdd51bbb75c99833ef6f3f37ea44a713a` (`1d769fb`)
- Message: `chore: establish Flight Health Phase 3 baseline`
- 88 files, 9749 insertions; 81 passed before committing
- Pre-commit safety: `.gitignore` already excludes `.venv/`, `.pytest_cache/`, `.test-tmp*/`, `data/`, `uploads/`, `runtime/`, `*.BIN`; no secrets/tokens/API keys found; hostname in `LOG_FACT_REPORT_SITL_SAMPLE.md` redacted to `<hostname-redacted>`
- The 13.9 MB SITL BIN stays **out of Git** (matched by the `data/` rule, and it is runtime/upload data, not source)
- `D:/FDE-AI-UAS/v1.5C` untouched (mtimes unchanged)

### 2. Fixes applied

- **A. VIBE Clip compatibility** (`backend/app/normalizer/flight_normalizer.py`): new `_collect_vibration_clips()` prefers modern `IMU` + scalar `Clip` (grouped per IMU instance, `source_field = VIBE.Clip[IMU{n}]`), keeps `Clip0/Clip1/Clip2` as legacy fallback. On the SITL sample `clip_growth` went `null -> 0.0` and the vibration domain `INSUFFICIENT_DATA -> NORMAL`. VIB-001/VIB-002 thresholds untouched.
- **B. ARM/DISARM detection** (`backend/app/features/flight_phases.py`): three-tier priority — structured `ARM` message (reserved, not emitted by current parser) -> `EV` `ARMED=10`/`DISARMED=11` -> MSG text fallback accepting `Arming motors` / `Disarming motors` while excluding `PreArm`. DISARM time now becomes a phase boundary. On the SITL sample: `arm_time = 0.0 s` (MSG fallback), `disarm_time = 180.306 s` (EV Id=11).
- **B-addendum (minimal, same scope)**: a segment starting at/after `disarm_time` is no longer labelled `ARMED_GROUND`; it falls back to conservative `UNKNOWN`. Without this, the 15 s after touchdown and disarm were labelled "armed on ground".

### 3. Tests and regression

- New: `tests/test_phase3_field_compatibility.py` — 17 tests (VIBE modern/legacy/missing, VIB-002 fire vs not, EV 10/11, MSG fallbacks, PreArm exclusion, structured-ARM priority, no-evidence -> UNKNOWN/None, INSUFFICIENT_DATA semantics, Student View `not_assessed`).
- Full suite: **98 passed** (81 baseline + 17 new).
- Verified unchanged: Student View 4 cards and no professional-field leakage; Teacher View rule_results/evidence_chain; `parameter_snapshot` still empty; legacy API keys (`overall_status`, `summary_zh`, `metadata`, `health`, `diagnostics`) intact; `schema_version` still `3.1-role-views`.
- End-to-end diff on the SITL BIN before vs after is exactly three lines: `clip_growth` null->0.0, vibration domain status, and the new DISARM boundary.

### 4. New findings, deliberately not fixed

1. **Numeric MODE not mapped in Flight Phase**: the real log stores `MODE.Mode` as a number (4 / 9); `_mode_name()` stringifies it to `"9"`, so `LAND` is never recognised and most segments stay `UNKNOWN`. Fixing it requires joining the Normalizer's pymavlink mode mapping into Flight Phase — out of scope this round.
2. **flight_mode / ekf / attitude have no rules**, so they are permanently `INSUFFICIENT_DATA`, which keeps propulsion/positioning/stability student cards at "未评估". Existing design, not a regression.
3. **SITL != Physical F450 Validation** still holds; the sample remains `SIM Hit ground` + `RC Protocol: UDP`.

### 5. State left for the user

Working tree has 2 modified backend files + 1 new test file, **uncommitted**. Next action requires explicit user confirmation before creating a second commit.

## Round 2026-10-07 Notes (Phase 3.1 — numeric MODE compatibility)

Scope: **only** the ArduPilot DataFlash numeric `MODE.Mode` problem. No new health rules, no threshold changes, no Rule Engine changes. Second commit `d08aa55` already contains the VIBE / ARM-DISARM fixes; Phase 3.1 changes are intentionally left uncommitted.

### Root cause (why the mode name got lost)

Traced `MODE` end to end:

- **Parser**: keeps `MODE.Mode` raw — real logs store numbers (`4`, `9`).
- **Normalizer**: already had a correct pymavlink mapping (`_mode_name` → `GUIDED` / `LAND`) and wrote it into `flight.modes[*].name`. The name was never actually lost here.
- **Flight Phase**: did *not* consume the Normalizer result. It re-read the raw `ParsedMessage` and only did `str(value).upper()` → `"9"`, which matches no phase table → `UNKNOWN`.

So the defect was Flight Phase bypassing the canonical name and re-parsing raw values without number→name mapping.

### Fix: one firmware-aware mapping layer, no hardcoding

New `backend/app/parsers/mode_mapping.py` — the single mapping table:

```
Raw MODE number -> canonical_mode_name(raw, vehicle_type=...) -> Canonical Mode Name -> Flight Phase
                   (pymavlink mode_mapping_bynumber, per plane/copter/rover/sub)
```

- Both Normalizer and Flight Phase now call the same function (thin wrappers); neither module contains `MAV_TYPE_*` or `mode_mapping_bynumber` any more — locked by a test.
- No `4 = GUIDED` / `9 = LAND` hardcoded anywhere; Flight Phase does not know ArduPilot mode numbers.
- Unknown mode number / unknown vehicle type falls back to the raw value → stays `UNKNOWN`. Never guessed.
- Per-vehicle separation verified: copter `4→GUIDED`, plane `4→ACRO`, rover `4→HOLD`, sub `4→GUIDED`; copter `9→LAND` vs rover `9→CIRCLE` vs sub `9→SURFACE`.

### Tests and regression

- New `tests/test_phase3_1_mode_mapping.py` — 14 tests: copter 4/9, numeric LAND producing a `DIRECT_MODE`/`VERIFIED` phase, GUIDED→LAND transition, unknown numbers (99/250) and missing values staying UNKNOWN, unknown vehicle type, string modes (`LOITER/AUTO/RTL/LAND/ALT_HOLD/STABILIZE`) unchanged, per-vehicle tables not shared, Normalizer/Flight Phase agreement, and no duplicate mode table in either module.
- Full suite: **112 passed** (98 + 14).
- SITL end-to-end diff is exactly two lines: `UNKNOWN 157.80→180.31` and `UNKNOWN 180.31→195.30` became `LAND ... DIRECT_MODE`. Engine 8 domains, Student View 4 cards, Teacher View, legacy API keys, `parameter_snapshot` and `schema_version` (`3.1-role-views`) all unchanged.

### Found but deliberately not fixed

1. **Post-DISARM segment still labelled LAND**: the sample disarms at 180.306 s but MODE stays `LAND`, so `DIRECT_MODE` also labels 180.31–195.30 as LAND. This is a Flight Phase V1 semantics question (a flight-controller mode is not the same as "flight finished"). Left untouched per "don't fix other things"; recorded as a `phase_error_case` candidate for manual review with real F450 logs.
2. **GUIDED has no V1 phase**: `4 → GUIDED` now resolves correctly, but V1's 10 phases have no GUIDED, so it stays `UNKNOWN` — conservative by design.

### State left for the user

Working tree: `flight_phases.py` + `flight_normalizer.py` modified, `parsers/mode_mapping.py` and `tests/test_phase3_1_mode_mapping.py` new, docs updated. **No third commit created.** No push / merge / deploy. v1.5C untouched.

## Phase 3 / Phase 3.1 Status Summary (2026-10-07) — accepted, frozen for Physical F450

### Commits (all in `D:/FDE-Flight-Health-AI`, none pushed)

| Stage | Hash | Message |
|---|---|---|
| Baseline | `1d769fb` | `chore: establish Flight Health Phase 3 baseline` |
| VIBE + ARM/DISARM | `d08aa55` | `fix: improve VIBE and arm-disarm log compatibility` |
| Phase 3.1 MODE | (this round) | `fix: canonicalize ArduPilot flight modes` |

Current test count: **112 passed** (81 baseline + 17 VIBE/ARM-DISARM + 14 MODE canonical mapping).

### Phase 3.1 accepted design

```
Raw MODE number
  -> shared canonical_mode_name(raw, vehicle_type=...)
  -> pymavlink firmware/vehicle-aware mapping
  -> Canonical Mode Name
  -> Flight Phase
```

- Single mapping module: `backend/app/parsers/mode_mapping.py`. Normalizer and Flight Phase both consume it; neither keeps its own table (locked by test).
- **No hardcoded ArduPilot mode table anywhere.**
- Accepted mappings: Copter `4 -> GUIDED`, `9 -> LAND`; Plane / Rover / Sub resolve through their own pymavlink tables (e.g. `4` is `ACRO` on Plane, `HOLD` on Rover).
- Unknown mode number or unknown `vehicle_type` falls back to the raw value -> stays `UNKNOWN`. Never guessed.
- Flight Phase does not know any ArduPilot mode number.

### KNOWN PHASE SEMANTIC ISSUE — DISARM 后 MODE 仍为 LAND（本轮不修）

- Observed on the SITL sample: `DISARM = 180.306 s`, but `MODE` stays `LAND`, so the segment `180.31 -> 195.30` is still reported as `LAND`.
- Root cause is conceptual: **Flight Controller Mode != Physical Flight Phase.** A mode is what the controller was commanded to do; it does not end when the aircraft disarms.
- Decision deferred until a real Physical F450 BIN plus a manual timeline cross-check is available. Candidate options:
  - A. force `UNKNOWN` after DISARM
  - B. add a `POSTFLIGHT` phase
  - C. another state design
- **Do NOT calibrate this semantic using SITL.** SITL is not Physical F450 evidence.

### SITL != Physical F450 Validation

The only log available so far is SITL (`SIM Hit ground`, `RC Protocol: UDP`, ArduCopter 4.8.0, 195 s). It is used for Parser / API / Schema / UI / test verification only. No rule threshold, phase semantic or health criterion may be calibrated from it. First real Physical F450 BIN still pending.

### Domains without complete health rules — keep INSUFFICIENT_DATA

- `ekf`, `attitude`, `flight_mode` currently have **no complete health rules** and therefore always report `INSUFFICIENT_DATA`.
- This is intentional. **Do not add rules just to make "未评估" disappear.** Unassessed is safer than a wrong "normal".
- Consequence: Student View `propulsion` / `positioning` / `stability` cards may show 未评估 because their source domains include EKF / ATT / flight_mode. That is correct behaviour, not a defect to paper over.
- `parameter_snapshot` also remains empty until PARM extraction is implemented (design only: `PARM_EXTRACTION_DESIGN.md`).

### Explicitly not done / not to be done next

- No new EKF / ATTITUDE / Flight Mode / Battery / Motor / Vibration rules.
- No threshold changes; Rule Engine criteria untouched.
- No DISARM/LAND semantics change (see KNOWN PHASE SEMANTIC ISSUE).
- No LLM, RAG, PX4, ULG, auto-tuning, database, deployment, Cloudflare, Gateway.
- `D:/FDE-AI-UAS/v1.5C` untouched (read-only).
- No push / merge / deploy.

### Next gate

Next phase starts only when a real **Physical F450** BIN arrives. Until then: fact-check only, no rule calibration.
