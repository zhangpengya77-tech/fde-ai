# RC Flaky Test Analysis — P4-E

## Evidence

Full browser regression on 2026-11-10 produced:

```text
156 passed, 12 skipped, 2 failed, 11.5 minutes
```

Both failures were `rc-calibration-visibility.spec.ts:367`, once per desktop/mobile project. The assertion expected the simulated self-centring stick to recover and show `偵測中`; the UI instead still reported `Pitch(axis1)=-0.90`.

The exact desktop test immediately passed alone:

```text
1 passed, 9.6s
```

## Ruling

This is a pre-existing test-harness/input restoration timing defect candidate. It is not evidence that Physics Pro broke RC control: this increment did not change RC source code. Do not alter RC calibration logic as part of Gazebo work.

## Follow-up

Create a separately scoped reproduction that observes the simulated Gamepad state across `restoreAllAxes()` and event/animation-frame boundaries. Fix only after a deterministic failing reproduction exists.
