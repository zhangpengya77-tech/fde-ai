# P5-J4 physical USB acceptance checklist

| Item | Required result | Status before teacher test |
|---|---|---|
| USB device identity | Gamepad API shows expected device and axes | PENDING |
| Four-axis monitor | Roll/Pitch/Throttle/Yaw respond correctly | PENDING |
| Calibration | centre/endpoints/reverse/dead-zone saved and reloaded | PENDING |
| Neutral safety | centred sticks and low throttle meet displayed safety check | PENDING |
| Isolated simulator movement | takeoff, hover, translation, yaw and landing observed in SITL only | PENDING |
| USB removal | existing failsafe/neutral behavior observed | PENDING |
| Chrome read-only | attachment has no control ability | Automated PASS |

Teacher must attach screenshots or a signed observation to move a PENDING item
to PASS. Do not record a simulated Gamepad test as physical-device evidence.

## Teacher SOP (isolated SITL only)

1. Verify that the page reports the intended USB device, then capture the
   displayed name, axis count and four raw-axis values.
2. With the aircraft disarmed and throttle low, move one stick at a time and
   confirm the Mode 2 mapping: right-stick horizontal Roll, right-stick
   vertical Pitch, left-stick vertical Throttle and left-stick horizontal Yaw.
   Confirm reversals only from the live monitor; never infer them from the
   device name.
3. Save and reload the calibration profile. Recheck centres, endpoints and
   dead zone before enabling any simulator session.
4. In the isolated SITL session only, have the teacher perform low-altitude
   takeoff, neutral hover, forward/backward movement, lateral movement, yaw,
   and landing. Record each item independently as PASS or FAIL.
5. While safely disarmed/landed, unplug USB and confirm the input reports
   disconnected and no stale channel value is retained. Repeat for browser
   focus loss or tab close if applicable.
6. Delete the session and verify that the control surface no longer has an
   active simulation session. Attach evidence before signing the checklist.

Never connect this procedure to an aircraft or hardware flight controller.
