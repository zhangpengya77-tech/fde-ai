# P5-J3 handoff checkpoint

## 2026-11-11 resume point

First real same-session G5 Mission Chrome observation is PASS (`p5j2-g5-a985ce6a54ba`): read-only Chrome attached with `read_subscribers=1`, Playwright passed, Runner completed the pre-existing ARM/AUTO/RTL/Disarm acceptance, and cleanup released all scoped ports. Gateway is now at 91 pytest passes; frontend is 862 Vitest passes.

Still required: run five **new**, independent Mission→Chrome→AUTO→RTL lifecycle artifacts, run Vite build, and summarize all results. Do not claim final P5-J3 PASS until those five runs complete. Resume with the existing isolated command from `scripts/p5j2_mission_upload_readback.py` using `--execute-flight --chrome-attach`; do not use the historical leaked-ticket log.

Update: Vite production build passed on 2026-11-11. Before the five-run batch, extend the real Chrome assertion surface beyond height: position, attitude, mission progress and RTL/Disarm must each have a current-session observable and a quantitative comparison against Runner telemetry. This is an evidence gap, not a SITL safety bypass.

Completed: verified Home + TAKEOFF + four-waypoint MAVLink Mission INT transaction; session/SYSID/COMPID/hash-bound verification; real isolated G5 SITL ARM/AUTO/RTL with ordered MAVLink progress and controlled cleanup.

Still required before full P5-J3 sign-off:

1. Connect the existing isolated browser Physics Pro/GCS adapter to the **same** verified mission session and prove Chrome Three.js AUTO/RTL trajectory from `telemetry_v2`.
2. Rerun frontend Vitest, Vite build, real Chrome E2E, and a fresh five-run mission lifecycle batch.
3. Keep Camera Sensor SIGSEGV separate; G5 is a diagnostic substitute, not a camera fix.
4. Real RadioMaster validation remains `PENDING_MANUAL`.

Protected worktrees, official site, original E: Gazebo worktree, QGC/HQGC, and P6 multi-vehicle work remain untouched.

## Final handoff — 2026-11-12

**P5-J3 = READY FOR MANUAL ACCEPTANCE.** This is not a production-release
approval.

### Evidence

- Baseline PASS: `p5j2-g5-8f030097332d`.
- Independent cold-start PASS runs: `p5j2-g5-cb4cf82c47a4`,
  `p5j2-g5-4c4162377582`, `p5j2-g5-59070765ae0b`,
  `p5j2-g5-b1e4857988c7`, `p5j2-g5-fe46ff7d374e`.
- Each result is stored at `/home/fde/fde_p5j3_flight_runs/<run_id>/result.json`.
- All six runs prove MissionVerification; ARM/AUTO/four-waypoint/RTL/Disarm;
  read-only Chrome attach; STALE before DELETE; DISCONNECTED after DELETE;
  controlled exits and port release. The five batch runs also verified no
  runner-owned Gazebo/SITL process remained.

### Manual acceptance SOP

1. Use the isolated runner `scripts/p5j2_mission_upload_readback.py` with
   `--execute-flight --chrome-attach`; verify its plugin/resource SHA gate
   before launch.
2. Observe the Windows Chrome Physics Pro scene: HUD and Three.js aircraft
   must attach to the Runner-owned session without creating a browser session.
3. Confirm takeoff, AUTO mission movement, mission progress, RTL and final
   disarm in the runner artifact and browser evidence.
4. Confirm Chrome becomes STALE only after the controlled Gazebo source stop;
   then Runner DELETE causes DISCONNECTED. Chrome must not send controls.
5. Confirm the result has both browser exits `0`, Gateway `-15`, Gazebo stale
   exit `0`, and no listeners on 8200/8201/8210/9002/5760/4173.

### Remaining manual / known risks

- Camera Sensor SIGSEGV remains unresolved; G5 is an isolation scenario, not a
  camera repair.
- RadioMaster USB validation is **PENDING MANUAL**: attach the controller only
  to the isolated simulator, verify axis/channel mapping and neutral failsafe,
  then verify no browser attach mode can send RC or flight commands.
- No real flight controller, drone, deployment, QGC/HQGC change or P6 work was
  performed.
