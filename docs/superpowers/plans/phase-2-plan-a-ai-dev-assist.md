# Phase 2 — Plan A: AI Code Analysis and Automated Development Assistance

> This document is a plan for the next phase, not a current-round task.
> The current round (2026-10-17) only produces this planning document: no new dependencies, no model training, no project refactor.

---

## 1. Goal

Build a controlled and auditable AI-assisted development workflow for `FDE-Power-Inspection-Simulator` that can deliver, in later phases:

- Module dependency and impact-surface analysis
- Functional gap / missing capability localization
- Defect root-cause localization
- Unit / browser test generation (RED first, then GREEN)
- Minimal change + full regression acceptance

The emphasis is on **assistance**, not autonomous writing: every piece of AI-generated code or test must pass the same local acceptance bar — `tsc -b` + `npm test` + `npm run test:browser` + `npm run build`.

---

## 2. Preconditions

- Passing P1-1 ~ P1-7 teaching loop (HEAD = `8d23ad5`, see the independent audit).
- Current test baseline: unit 213/213, browser 46 passed / 2 skipped (PENDING_DEVICE_TEST), `npm run build` clean.
- `package.json` already contains `vitest`, `@playwright/test`, `typescript`, `vite`, `three`, `@types/three`.
- Existing helper and test-seam patterns in `tests/unit/` and `tests/browser/` (`__fdeInputClock`, `__fdeTeleport`, `__fdeInspection`, `__fdeGimbal`, `__fdeMission`, `__fdeReport`).
- AI assistant has local file and git history access; no cloud training / annotation platform access (to avoid data egress).
- Real hardware test stays skipped under `PENDING_DEVICE_TEST`.

---

## 3. File Scope

New (assistant tools and docs only; do not pollute application code):

- `tools/ai-assist/`
  - `module-graph.ts` — static import graph and reverse-dependency / impact-surface (via `ts-morph` or `typescript` compiler API; as a devDependency).
  - `test-grep.ts` — look up existing test coverage by symbol or descriptor.
- `docs/ai-assist/`
  - `prompt-template-gap-analysis.md`
  - `prompt-template-defect-locate.md`
  - `prompt-template-test-gen.md`
  - `playbook.md` — end-to-end flow (input -> analysis -> proposal -> implementation -> acceptance)

Read-only + propose (final changes go through git diff):

- `src/**`, `tests/**`, `index.html`, `src/styles.css`, `playwright.config.ts`, `vitest.config.ts`, `vite.config.ts`
- `package.json` / `package-lock.json` (any new devDependency must be explicitly approved by the user, e.g. `ts-morph`)

Do NOT touch:

- Sealed stage plans in `docs/handoff/`, `docs/superpowers/plans/`
- Other FDE projects (e.g. `D:\FDE-Blender-MCP`)
- Flight core (`SimpleFlightController`), brand-neutral input chain, Three.js rendering, scoring config (`DEFAULT_SCORE_CONFIG`)
- Heavy dependencies (`react`, `vue`, `redux`, `tailwindcss`, `tensorflow`, `pytorch`, ...) — none allowed; if really needed, devDependency only and called out in the PR.

---

## 4. Workflow (5 steps, each with a verifiable artifact)

1. Dependency graph / impact-surface index
   - Statically scan imports in `src/`, output `module-graph.json` plus a visualization (DOT/Graphviz or Mermaid).
   - Acceptance: `tsc -b` clean; script runs; any module can be queried for its direct / transitive reverse dependencies.

2. Functional gap and duplicate-code localization
   - Cross-check every interface declared in `docs/superpowers/specs/2026-10-16-power-inspection-simulator-v1-design.md` against current implementation, unit tests and browser tests.
   - Acceptance: gap table (interface ↔ implementation status ↔ covered test); any residual gap is explicitly labelled "not implemented" or "known limited".

3. Defect root-cause localization
   - On regression or user-reported failure:
     1. Reproduce (minimum case: unit or browser) and assert stable failure.
     2. Static localization (dependency graph + type signatures + stack trace).
     3. Output a minimal fix diff (1-2 files, < 50 lines preferred).
   - Acceptance: full suite passes after fix; no new skip; commit message includes root cause and minimal-fix explanation.

4. Test generation (RED first)
   - Template: write `*.test.ts` using existing helpers, confirm RED, then add implementation -> GREEN.
   - Acceptance: every new test has a clear `it('...')` description; assertions are concrete (numbers / strings / behaviour), no "should probably work"; naming follows existing style.

5. Regression acceptance
   - Order: `tsc -b` -> `npm test` -> `npm run test:browser` -> `npm run build` (last two with `CODEBUDDY_SAFE_DELETE_ENABLED=0`).
   - Acceptance: same as or better than baseline; any perf / bundle regression must be explained; do not touch P1 evidence screenshots (old phase pngs stay `M` unstaged, HEAD keeps evidence).

---

## 5. Acceptance Criteria (DoD for Phase 2-A itself)

- Workflow docs complete and readable (`docs/ai-assist/playbook.md`).
- At least one real gap / defect / test-generation end-to-end sample (visible in `git log`) that can serve as a reference.
- Tool scripts run once with no uncaught exceptions; output goes to `tools/ai-assist/output/` (git-ignored).
- `tsc -b` clean, `npm test` passes, browser suite does not regress, build has no new warnings.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| Automation overreaches and rewrites architecture | Strict read + propose + wait for explicit approval; AI never stages / commits / pushes on its own |
| Heavy dependencies slip in | Every new dependency requires explicit user approval; never `tensorflow*` / `pytorch*` / `react*` / `vue*` / `tailwind*` |
| Test bloat / duplication | Unified test naming, prefer existing helpers; coverage comes from existing vitest / playwright reports |
| Old-phase evidence overwritten | Only stage the current phase's screenshots; old pngs stay `M` and out of the commit |
| Git history contamination | No `reset` / `clean` / `stash` / `--force`; one independent commit per change |
| AI invents APIs / types | `tsc -b` failure stops the line; no `any` / `@ts-ignore` abuse |

---

## 7. Expected Work Order

1. Draft `docs/ai-assist/playbook.md` and 3 prompt templates (half day, docs only).
2. Implement `tools/ai-assist/module-graph.ts` and a runner (small half day; TDD: write a script test asserting expected nodes).
3. Run a gap analysis, produce `gap-table.md`; confirm no hidden gaps after P1-7.
4. Pick [FIND-1] from the P1-7 independent audit as the first end-to-end sample (minimal fix: move the "list" screenshot before the click in the test), walk the full workflow.
5. Full regression; independent commit; update this plan file to "implemented" or add a deviation log.

---

## 8. Stop Conditions (this round)

- No application code is written (except the minimal fix in step 4).
- No large dependencies.
- No model training, no whole-project refactor.
- No engine migration (keep Vite + Three.js + Vitest + Playwright).
- This round produces ONLY: this document + helper scripts + 1 end-to-end sample.
