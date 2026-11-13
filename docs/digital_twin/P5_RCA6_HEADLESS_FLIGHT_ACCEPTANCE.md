# P5-I-RCA-6：G5 Headless Flight Acceptance

日期：2026-11-11。目标是以 RCA-5 证明可正常退出的 G5（无 camera sensor、保留 Iris/IMU/云台/三轴 joint graph）建立 Gazebo → ArduPilot SITL → MAVLink → Gateway → Chrome/WS `telemetry_v2` 的受控单机验证。

## 固定安全边界

- 不写入 `/mnt/e/FDE-Gazebo/src/ardupilot_gazebo`，不使用其 dirty 0-byte world 或 dirty model。
- G5 工作输入将由已验证资源 `/home/fde/fde_p5i_rca_isolated/resources-f116b03552d0-complete` 建立 run-local 副本；world SHA-256 固定为 `35369d7a179e5eb3a190fbb0747b06c49c4a61fb382ff5a45ef48b168ad47b4a`。
- 仅移除 camera sensor；`yaw_joint`、`roll_joint`、`pitch_joint` 与 IMU 保留。G5 是退出稳定性诊断替代场景，不是完整 camera/GStreamer 修复。
- Gateway 保持 127.0.0.1、token、Origin、单会话、telemetry freshness 和 RC watchdog；不连接真机。
- 不发送 ARM、起飞、Mission、AUTO 或 RTL 指令。

## 本轮运行器与 TDD 证据

新增隔离运行器：`D:/FDE-DT/fde-flight-twin-gateway/scripts/p5i_rca6_flight.py`。

它在启动子进程前：

1. 创建唯一 run ID 与 G5 workspace；
2. 原子复制官方 world，结构化移除唯一 camera sensor；
3. 将 `GZ_SIM_RESOURCE_PATH` 限定为 run-local overlay + verified resources；
4. 拒绝 source worktree fallback、端口竞争及缺失前置；
5. 计划以 HTTP 8200 建立受 token 保护的 session、以 WS 8201 观察 20 秒实际 `telemetry_v2`，随后 DELETE session 并记录 Gazebo/Gateway 退出码和端口状态。

TDD：新测试先因不存在 RCA-6 运行器失败（RED）；实现后结构测试 2 PASS。针对 E 盘消失，又新增“精确报告缺失 plugin directory”测试，先 RED 再 GREEN。RCA-4/5/6 定向 pytest 最终为 11 PASS。

## 单次整合与五次冷启动：BLOCKED（环境）

首次执行在任何 Gazebo/SITL/Gateway 子进程创建前被前置检查拒绝。只读证据：

- WSL `FDE-DT-Ubuntu` 的 `/mnt/e` 是空 mountpoint；`/mnt/e/FDE-Gazebo/build/ardupilot_gazebo` 不存在。
- Windows 当前没有 E: PSDrive/Volume；`E:\FDE-Gazebo\build\ardupilot_gazebo\libArduPilotPlugin.so` 为 `False`。
- SITL binary 与官方 30-object resources 仍可见，但三项 plugin 不可见，故不能证明 G5 运行时使用正确二进制。
- 8200、8201、8210、9002、5760 在阻断前后均未监听；没有启动 Gazebo、SITL 或 Gateway。

因此以下项目均为 **NOT RUN / BLOCKED**，不是 FAIL，也绝非 PASS：单次整合、WebSocket 持续连接、HTTP/WS/MAVLink/`telemetry_v2`、GPS/IMU/EKF/sensor_health、五次独立冷启动，以及 Mission/AUTO/RTL 前置检查。

## 恢复条件与后续顺序

1. 教师恢复并确认原 E: 存储设备挂载；不得通过迁移、重装或复制未知 plugin 绕过。
2. 只读核对 `/mnt/e/FDE-Gazebo/build/ardupilot_gazebo` 与三项既有 `.so` 的原始 SHA-256。
3. 重新执行一次 G5 单次整合；仅在 Gazebo exit=0、HTTP/WS/telemetry/DELETE/端口清理均成功后开始新 batch 的五次冷启动。
4. 五次必须使用同一运行器版本与同一 G5 输入版本；任何失败保留完整工件，禁止挑选成功 run。
5. 五次全部通过后才可做 Mission/AUTO/RTL 的安全**前置检查**；本轮不执行飞行任务。

## 未解决项

完整 camera sensor 场景 SIGSEGV 仍为 `STRONGLY_SUPPORTED_HYPOTHESIS`，没有被 G5 取代、修复或掩盖。P6-HQGC-3D-MULTI 仅保留标准 MAVLink 多 SYSID/GCS Adapter 规划，未在本轮开发。
