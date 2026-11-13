# WEB LITE Regression Boundary

The WEB LITE `FlightSession` remains the default engine and continues to use the existing input adapters, CourseRunner, scoring, replay and scene layers.

Regression run on 2026-11-10:

```text
npm test       -> 65 files, 855 tests passed
npm run build  -> TypeScript and Vite build passed
```

The full generic Playwright suite ran on 2026-11-10:

```text
156 passed, 12 skipped, 2 failed (11.5m)
```

Both failures were the same pre-existing simulated RC calibration case (`rc-calibration-visibility.spec.ts:367`) on desktop and mobile. The full-suite failure retained a stale simulated Pitch axis of `-0.90` after its helper restored axes. The identical desktop case was immediately re-run in isolation and passed (1/1, 9.6s), so it is recorded as a timing-sensitive test-harness issue, not a Physics Pro regression. No RC code was changed in this increment.

The dedicated real-SITL browser case passed separately:

```text
npx.cmd playwright test tests/browser/rea-physics-pro.spec.ts --project=desktop-chrome
-> 1 passed (56.6s)
```

Required full browser regression before a merge or release:

```text
npm test
npm run build
npm run test:browser
```

This increment did not modify WEB LITE source files. The existing dirty Physics Pro client/UI draft files remain owned by the prior agent and were verified through their targeted real-SITL browser test.
