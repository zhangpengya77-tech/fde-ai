# P5-J3 SITL ARM/AUTO/RTL acceptance

Status: **PASS — isolated G5 Gazebo + ArduPilot SITL only.**

Run evidence: `/home/fde/fde_p5j3_flight_runs/p5j2-g5-f6a83448e7b7/result.json`

- Resources: verified G5 no-camera-sensor overlay; original E: Gazebo worktree was not used.
- Vehicle: ArduCopter Copter-4.7.2, localhost SITL `sysid=251`, `compid=1`.
- Mission: Home `seq=0`, `NAV_TAKEOFF` `seq=1` at 3 m, four `NAV_WAYPOINT` items `seq=2..5` at 5 m.
- Mission upload, ACK, full readback, normalized comparison, hash, and session-bound MissionVerification passed before control.
- Pre-arm gate required GPS Fix 6, gyro/accel health, and both `EKF3 IMU0/1 origin set`; no ArduPilot safety parameter was changed.
- Initial no-RC run was rejected/disarmed by `Arm: Accels inconsistent` before EKF convergence, then AUTO disarmed on the ground. This failure is retained in `p5j2-g5-40f00644bf7d`.
- Final run used Gateway WebSocket neutral synthetic RC keepalive (not RadioMaster validation; no mode channel) while retaining `FS_THR_ENABLE=1` and the RC watchdog.
- Final telemetry: altitude 0.19–5.24 m; ENU x -1.031–1.041 m; ENU y -1.002–1.013 m; `MISSION_ITEM_REACHED` 1, 2, 3, 4, 5 in order.
- Gateway entered RTL after seq 5 and telemetry later reported `armed=false`.
- Cleanup: Gateway controlled SIGTERM `-15`, Gazebo exit `0`, ports 8200/8201/8210/9002/5760 released.

This is not a real-aircraft or RadioMaster result. Camera Sensor SIGSEGV remains unresolved; this run used G5 only.
