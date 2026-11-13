# P5-J4 USB RadioMaster architecture

Status: **READY FOR PHYSICAL USB ACCEPTANCE** (not a real-aircraft approval).

## Reused isolated architecture

- Browser input uses the standard Gamepad API through `GamepadInputAdapter`;
  P5-J4 requests neither WebHID nor WebSerial permissions.
- `PilotInputPipeline`, `InputNormalizer`, and `ChannelMapper` provide the
  single mapping path. A second USB-to-flight control channel was not added.
- Profiles are keyed by the browser-reported `Gamepad.id`; device names and
  axis order are never sufficient authorization by themselves.
- The existing controller-calibration panel exposes raw axes, channel roles,
  reverse, centre, endpoints, dead zone, saved profile and guided calibration.
- Gateway accepts RC only through its authenticated writable simulation
  WebSocket. Read-ticket Chrome attachment remains server-enforced read-only.

## Safety boundary

USB input is eligible only for a local, explicit simulation session after a
valid calibration profile is selected. It never targets a physical flight
controller. Missing or stale input stays within the existing neutral/failsafe
and Gateway watchdog behavior; P5-J4 does not alter ARMING_CHECK, EKF,
sensor-health, Origin, token or Session constraints.

## Known limitation

The actual RadioMaster USB descriptor, axes and physical travel must be
measured by the teacher. Automated tests use **SIMULATED INPUT** only.
