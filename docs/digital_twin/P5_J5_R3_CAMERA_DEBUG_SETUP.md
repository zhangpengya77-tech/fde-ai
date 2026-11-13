# P5-J5-R3 Camera debug setup

WSL provides only `addr2line`, `readelf`, and `ldd`; no debugger or core reader
is available. Core limit is zero and core handling is delegated to WSL. No
system package, global core policy, Gazebo version, or plugin was changed.

Camera root-cause work remains BLOCKED pending an approved isolated debugger or
core-capture facility.
