# Physics Pro P4-B Rollback Plan

## Runtime rollback

1. Stop only processes recorded in `/mnt/e/FDE-Gazebo/logs/gz-iris-headless.pid` and `/mnt/e/FDE-Gazebo/logs/arducopter-gazebo-iris.pid`.
2. Verify no local listeners remain on `9002` or `5760`.
3. Use the existing direct-SITL procedure only, or leave Physics Pro unavailable; do not point the current gateway at Gazebo until an approved registration adapter exists.
4. WEB LITE stays independent and can run without Gazebo.

## Installed scope

- Official OSRF Gazebo apt source/key in `FDE-DT-Ubuntu` only.
- `gz-harmonic`, `libgz-sim8-dev`, documented plugin dependencies, `python3-pexpect`, and `libdebuginfod1`.
- Official source/build files in `E:\FDE-Gazebo`.

No automated uninstall is performed. If later removal is approved, remove only these explicit packages/files; never remove shared WSL, ArduPilot, Docker, Node, Python, or project dependencies.

No protected worktree, gateway source, WEB LITE source, deployment, or database was modified in P4-B.
