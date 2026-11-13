# Gazebo Environment Report — P4-A

Date: 2026-11-10  
Worktree: `D:\FDE-REA-Exam-Sim` / `feat/physics-pro` / `569122e`

## Observed environment

| Item | Observed state |
| --- | --- |
| Host | Intel i5-11320H, 4 cores / 8 logical processors, 15.74 GiB RAM |
| Disk | After installation/build, approximately C: 16.3 GiB, D: 29.6 GiB, E: 172.1 GiB free |
| WSL | `FDE-DT-Ubuntu` available; existing SITL binary present |
| Docker | Not used or started for this phase |
| Gazebo CLI | Installed: `gz sim 8.15.0`, `gz-harmonic 1.0.0-1~jammy` |
| ardupilot_gazebo | Built from official commit `f116b03552d05c8d0b0bed5ed67033a1183121d1` on E: |
| Existing SITL | ArduCopter 4.7.2 through `D:\FDE-DT\fde-flight-twin` |

## Official compatibility finding

The official ArduPilot Gazebo plugin supports Gazebo Harmonic and uses `gz-sim8` for Harmonic. Harmonic is the selected target for a future isolated install. The plugin also requires development packages and OpenCV/GStreamer components. ROS is not required for the base ArduPilot Gazebo plugin.

Sources: ArduPilot SITL with Gazebo documentation and `ArduPilot/ardupilot_gazebo` README/CMake configuration, checked 2026-11-10.

## Installation decision and result

The explicit P4-B authorization was received after this audit. APT simulation estimated 355 MB download and 1,585 MB additional installation size; D: remained above the 20 GiB safety gate. Official packages were installed only into `FDE-DT-Ubuntu`. Official source and the 83 MB plugin build reside on E: (`/mnt/e/FDE-Gazebo`).

E: is USB-attached/exFAT and is used only for the reproducible source/build directory. The WSL virtual disk remains on D:, not E:.

## Actual minimum installation gate

1. Confirm `FDE-DT-Ubuntu` Ubuntu release is supported by the selected Harmonic repository.
2. Estimate package download, installed size, source/build cache and log allowance.
3. Confirm D/WSL VHDX expansion budget and rollback method.
4. Installed only Harmonic runtime/development packages plus the official plugin's documented dependencies.
5. Started `gz sim -s -r iris_runway.sdf` and one stock Iris quad only; no multi-vehicle or high-resolution renderer.
