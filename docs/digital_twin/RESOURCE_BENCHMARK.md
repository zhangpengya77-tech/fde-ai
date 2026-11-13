# P4-B Resource Benchmark

Date: 2026-11-10. This is an observational headless Iris run, not a hardware capacity guarantee.

| Resource | Observation |
| --- | --- |
| WSL memory during run | 1.1 GiB used, 6.3 GiB available, swap 0 B used. |
| ArduCopter | 7.8 MiB RSS and about 4.2% CPU at sample time. |
| Gazebo | Active headless server; WSL process accounting did not give a reliable standalone RSS value. |
| Gazebo RTF | One sample `0.0093`; an earlier idle sample about `0.52`. Performance is **NOT ACCEPTED**. |
| C / D / E free after installation | About 16.3 / 29.6 / 172.1 GiB. |
| APT estimate | 355 MB download, 1,585 MB installed. |
| Official plugin build | 83 MB on E:. |
| Browser FPS / GPU VRAM | NOT MEASURED; no graphical benchmark is claimed. |

Use only headless single-vehicle mode on this laptop until stable RTF, CPU, RAM and graphics profiling are established. The WSL virtual disk remains on D:; only plugin source/build is on E:.
