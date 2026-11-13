# P5 资源记录

| 项目 | 状态 |
| --- | --- |
| C 可用空间 | 约 10.3 GiB（本轮开始时） |
| D 可用空间 | 约 29.6 GiB（本轮开始时） |
| E 可用空间 | 约 172 GiB（本轮开始时） |
| WSL FDE-DT root | 约 951 GiB 可用 |
| Gazebo RTF / CPU | server-only 实测 RTF 约 0.55–0.63、CPU 约 91%；RAM / GPU / FPS 未量测，不能推断性能 PASS |
| serial1 UDP 探针 | 5 个 heartbeat，短暂 SITL，完成后停止 |

npm 与 TEMP/TMP 在本轮测试中指定至 E 槽。不得从此记录推断 Gazebo 负载 PASS。
# P5-H 更新（2026-11-11）

本轮没有在 IMU 预解锁失败后继续重负载 Mission；因此未采集可比较的 AUTO/RTL RTF、FPS 或资源峰值。已确认本轮 Gateway 关闭后 8200/8201 未监听；Gazebo 退出时 WSL PID 会复用，后续清理必须按实时命令列而非历史 PID 执行。

