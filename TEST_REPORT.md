# Test Report

## P1-1 Project Skeleton

Status: PASS

Date: 2026-10-16

| Verification | Result | Evidence |
|---|---|---|
| TDD unit RED | PASS | `render-config.test.ts` failed because `src/app/render-config` did not exist |
| Unit GREEN | PASS | Vitest: 1 file, 2 tests passed |
| Browser RED | PASS | Root application was absent and the page could not satisfy the shell test |
| Desktop browser | PASS | Playwright Chrome, 1920×1080, non-empty canvas, zero page errors |
| Mobile browser simulation | PASS | Playwright Chromium with iPhone 13 viewport/touch profile |
| Production build | PASS | TypeScript and Vite build completed; 8 modules transformed |
| Visual review | PASS | Desktop and mobile screenshots show no incoherent overlap |

Screenshots:

- `screenshots/p1-1-desktop-chrome.png`
- `screenshots/p1-1-mobile-chrome.png`

Notes:

- The Chrome `NO_COLOR` warning comes from the test runner environment and is not an application error.
- No F450, flight controls, mission logic or AI behavior is claimed in P1-1.

## P1-2 F450 Entity and Keyboard Flight

Status: PASS

Date: 2026-10-16

Verification order for this stage was **sequential**, not concurrent, per the handoff instruction.

| Verification | Result | Evidence |
|---|---|---|
| Unit `npm test` | PASS | Vitest: 2 files, **6 tests passed** (`render-config` 2 + `simple-flight-controller` 4) |
| Browser `npm run test:browser` | PASS | Playwright: **4 tests passed** — desktop-chrome and mobile-chrome × `flight.spec.ts` + `shell.spec.ts` |
| Production build `npm run build` | PASS | `tsc -b` clean; Vite: **12 modules** transformed, JS 497.23 kB (gzip 126.61 kB) |
| Visual review | PASS | Desktop 1920×1080 and iPhone-13-size mobile screenshots: F450 framed centre, X-frame arms and propellers coherent, non-blank canvas, no layout overlap |
| Landing behaviour | PASS | After `降落`, altitude returns to `0` and state returns to `已解锁`; then `上锁` is reachable |
| Keyboard control | PASS | `W/S/A/D/Q/E/R/F` produce bounded pitch/roll/yaw/throttle motion through `KeyboardInputAdapter` |

Screenshots:

- `screenshots/p1-2-flight-desktop-chrome.png`
- `screenshots/p1-2-flight-mobile-chrome.png`
- `screenshots/p1-2-shell-desktop-chrome.png`
- `screenshots/p1-2-shell-mobile-chrome.png`
- P1-1 evidence `screenshots/p1-1-*.png` is retained byte-identical to commit `604c251`.

Notes:

- The F450 is the **programmatic** fallback. The candidate `F450_Assembly.glb` was inspected read-only but **not** copied because its source project carries no license/reuse statement; it must not be added before provenance is confirmed in `THIRD_PARTY_NOTICES.md`.
- One real defect was found while finishing this stage: `tests/browser/shell.spec.ts` wrote its screenshots to `screenshots/p1-1-<project>.png`, which **overwrote the P1-1 evidence files**. Fixed by renaming to `screenshots/p1-2-shell-<project>.png`; the two clobbered P1-1 screenshots were then restored bit-identical from `HEAD` (verified by SHA-256) and `p1-1-project-shell.png` was never touched.
- `playwright.config.ts` no longer retains traces or failure screenshots in `test-results/`. In this environment the runner's file-write guard blocked those artifact paths and turned otherwise-passing tests into failures; artifact output now goes to the git-ignored `.playwright-output/`. Application behaviour is unaffected.
- No controller brand, scene mission, scoring, persistence or AI behaviour is claimed in P1-2.
