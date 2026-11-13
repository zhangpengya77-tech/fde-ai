# P5-E / P5-G Gazebo 环境恢复诊断（2026-11-10）

## P5-E 旧结果：BLOCKED，不重装

`FDE-DT-Ubuntu` 仍可运行 `gz sim 8.15.0`，且 `/mnt/e` 以读写 9p 挂载。但是当前没有设置 `GZ_SIM_SYSTEM_PLUGIN_PATH` 或 `GZ_SIM_RESOURCE_PATH`，并且在 `/home/fde`、`/mnt/e/FDE-DT`、`/mnt/d/FDE-DT`、`/opt`、`/usr/local` 的限定检索中均未找到：

- `iris_runway.sdf`
- `libArduPilotPlugin.so`
- `ardupilot_gazebo`

既有 `GAZEBO_INSTALL_REPORT.md` 明确记录 P4 的官方 source/build 路径是：

```text
E:\FDE-Gazebo\src\ardupilot_gazebo
E:\FDE-Gazebo\build\ardupilot_gazebo
```

本轮 Windows 侧 `E:\FDE-DT` 只保留 QGC 隔离下载目录；`E:\FDE-Gazebo` 不存在。因此这是原有插件/世界文件不在当前可访问存储的阻断，不能通过设置环境变量恢复。

## 安全决定

没有重新安装 Gazebo、没有克隆代码、没有迁移 WSL、没有删除缓存。Gazebo + SITL 的 P5 AUTO/RTL 验收保持 BLOCKED。若教师批准，将以官方 ardupilot_gazebo 指定 commit 的独立 E 槽 source/build 重新获取与编译，并重新进行容量预检。

## P5-G 现场复核：资源恢复为可用（非重装）

P5-G 对旧路径作了精确复查，发现 P5-E 的限定检索漏掉了实际挂载路径。以下官方资产**已存在且可读**，本轮没有重新下载或编译：

| 项目 | 实际位置 / 版本 | 结果 |
| --- | --- | --- |
| Gazebo | `FDE-DT-Ubuntu` 的 `gz sim 8.15.0` | PASS |
| 官方源码 | `/mnt/e/FDE-Gazebo/src/ardupilot_gazebo`，commit `f116b03552d05c8d0b0bed5ed67033a1183121d1` | PASS |
| 官方插件 | `/mnt/e/FDE-Gazebo/build/ardupilot_gazebo/libArduPilotPlugin.so` | PASS |
| Iris world | `/mnt/e/FDE-Gazebo/src/ardupilot_gazebo/worlds/iris_runway.sdf` | PASS |
| 授权 | 上游 `ardupilot_gazebo` LGPL-3.0（既有安装报告） | 已记录 |

以仅本次进程环境变量启动 server-only 场景：

```text
GZ_SIM_SYSTEM_PLUGIN_PATH=/mnt/e/FDE-Gazebo/build/ardupilot_gazebo
GZ_SIM_RESOURCE_PATH=/mnt/e/FDE-Gazebo/src/ardupilot_gazebo/models:/mnt/e/FDE-Gazebo/src/ardupilot_gazebo/worlds
gz sim -s -r -v3 iris_runway.sdf
```

Gazebo 成功加载 Iris、IMU 与 ArduPilotPlugin；`/stats` 实测 RTF 约 `0.55–0.63`，1 ms step，CPU 约 91%。此为低资源无图形场景，RTF 尚不稳定，不能据此宣称性能合格。

## P5-G 真实 SITL 状态

- Gateway 创建 Gazebo session 后，真实 ArduCopter Copter-4.7.2（`fb77356789`）达到 `ready`，并取得 HEARTBEAT、姿态、ENU 局部位置、电池与 GPS fix 6 / 10 sats：**PASS**。
- Gateway 的 SIM 参数探测修正为只接受明确请求的 `SIM_SPEEDUP`；新增回归测试避免启动队列中的无关 `PARAM_VALUE` 被误判。
- 已恢复此前官方成功命令中的 `--slave 0`，且 Gateway 后端测试为 **38 passed**。
- Chrome 实测仍可遇到 `PreArm: Accels inconsistent` / `Arm: Gyros inconsistent`；一次浏览器会话最终记录到 `Arming motors`、`armed=true`、高度 `1.28 m`，但没有取得完整 Playwright 终态与 3D 数值对照工件。因此 **Chrome 3D 权威同步仍为 PENDING，不标记 PASS**。

本轮没有关闭 `ARMING_CHECK`、没有写入危险参数、没有连接真实飞控。AUTO/RTL 仍不应开始验收，直至预解锁收敛与浏览器闭环具备可重复证据。
