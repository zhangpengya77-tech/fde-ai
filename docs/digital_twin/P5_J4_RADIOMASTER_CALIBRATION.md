# P5-J4 RadioMaster calibration

## Teacher procedure

1. Connect RadioMaster by USB in **USB Joystick (HID)** mode and press a stick
   or button so Chrome exposes it through Gamepad API.
2. Open the existing controller calibration / stick-axis monitor. Confirm the
   displayed device identity and axis count; an unknown or unavailable device
   is **BLOCKED**, never guessed.
3. Select Mode 2 only as a draft: Roll, Pitch, Throttle and Yaw must each be
   moved and observed before saving.
4. Record centre and endpoints, set reversal only after the displayed movement
   agrees with the teacher, and choose a dead zone that leaves centred sticks
   neutral.
5. Save, reload and verify the device-specific profile. Repeat the four-axis
   live monitor before simulation use.

## Automated evidence

The isolated suite validates profile persistence, mapped role selection,
reverse, channel range, unsupported-device rejection, stale/disconnected
input handling, and read-only session isolation. It does not certify any
physical RadioMaster.
