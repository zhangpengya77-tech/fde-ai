# Gazebo Harmonic Installation Report — P4-B

## Scope and safety gate

Installation occurred only after an APT dry-run reported **355 MB download** and **1,585 MB additional installed space**. D: had roughly 32.5 GiB free before the install and about 29.6 GiB afterwards, preserving the required 20 GiB margin. E: retained about 172.1 GiB free.

The WSL distribution remains at `D:\FDE-DT\wsl\ext4.vhdx`; `/mnt/e` is only an external exFAT source/build mount.

## Versions and source

- Ubuntu: 22.04 Jammy, `FDE-DT-Ubuntu`.
- Gazebo: `gz sim 8.15.0`, `gz-harmonic 1.0.0-1~jammy`, official OSRF apt source.
- Plugin source: `https://github.com/ArduPilot/ardupilot_gazebo`, commit `f116b03552d05c8d0b0bed5ed67033a1183121d1`, LGPL-3.0.
- Plugin source/build: `E:\FDE-Gazebo\src\ardupilot_gazebo` and `E:\FDE-Gazebo\build\ardupilot_gazebo`.
- Build configuration: `GZ_VERSION=harmonic`, `RelWithDebInfo`, parallelism 2.

## Installed packages

`gz-harmonic`, `libgz-sim8-dev`, the official plugin README's OpenCV/GStreamer dependency set, `rapidjson-dev`; plus the small missing runtime dependencies `python3-pexpect` (official `sim_vehicle.py`) and `libdebuginfod1` (GStreamer camera plugin).

APT also applied package updates required by its dependency resolution. This was an observed install side effect; no Node, Windows Qt, project dependency, Docker, or global application configuration was changed.

## Build result

All official plugin libraries built successfully:

```text
libArduPilotPlugin.so
libCameraZoomPlugin.so
libGstCameraPlugin.so
libParachutePlugin.so
```

The WSL/exFAT build emitted minor clock-skew warnings. Artifacts completed, but the build directory should be rebuilt on a native Linux filesystem if a future reproducibility issue is observed.

## Logs

- `D:\FDE-DT\logs\gazebo-apt-preflight-20261110.log`
- `D:\FDE-DT\logs\gazebo-harmonic-install-20261110.log`
- `D:\FDE-DT\logs\ardupilot-gazebo-clone-20261110.log`
- `D:\FDE-DT\logs\ardupilot-gazebo-build-20261110.log`
