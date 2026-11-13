# P5-J4 Camera Sensor scope record

P5-J4 does not modify, rebuild, or enable the Camera Sensor path. The existing
diagnostic record is [P5_GAZEBO_SIGSEGV_DIAGNOSTICS.md](P5_GAZEBO_SIGSEGV_DIAGNOSTICS.md).

## Status

- Camera Sensor SIGSEGV: **UNRESOLVED**.
- P5-J4 validation used the already accepted G5 isolated, no-Camera-Sensor
  scenario only.
- RadioMaster/Gamepad work did not alter Gazebo plugins, the original E-drive
  source tree, SDF files, Ogre2/GStreamer, or camera dependencies.

This separation is intentional: a successful USB calibration or simulated
control test is not evidence of camera recovery.
