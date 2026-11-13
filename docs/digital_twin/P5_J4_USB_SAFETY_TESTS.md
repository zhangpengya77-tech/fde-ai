# P5-J4 USB safety tests

## Automated — SIMULATED INPUT

- Gamepad device discovery and unsupported Gamepad API rejection.
- Mode 2 channel mapping, reverse and throttle normalization.
- Calibration persistence and profile reload.
- USB/Gamepad disappearance falls back to safe non-radio input path.
- Read-only Chrome Mission attachment cannot emit RC, Mission, ARM, AUTO, RTL,
  POST session or DELETE session commands.
- Gateway watchdog and session identity protections remain covered by Gateway
  safety regression.

## Executed regression evidence

- Simulated USB unit subset: 56 PASS.
- Full frontend Vitest: 66 files / 864 PASS.
- Simulated USB Chrome suite: 23 PASS, 2 physical-device tests deliberately
  skipped (`PENDING_DEVICE_TEST`).
- Gateway full pytest: 97 PASS.
- TypeScript no-emit and Vite production build: PASS.

The browser suite uses an injected Gamepad API device only. It demonstrates
software behaviour and must not be interpreted as a physical RadioMaster
acceptance result.

## Manual — PENDING

- USB unplug while sticks are moving.
- Browser tab close / focus loss while a simulator session is running.
- Actual RadioMaster axis direction, end stops, centre noise and dead-zone.
- Gateway disconnect, session expiry/delete and simulator restart with the
  physical device connected.

No P5-J4 check sends a command to a real aircraft or flight controller.
