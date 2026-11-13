# P5-B 四航点 AUTO / RTL 报告

## 结果：BLOCKED（P5-G 复核后）

P5-B 的验收要求是 **QGC GUI** 建立四航点、上传/读回 ArduPilot mission、AUTO 逐点执行、RTL、降落和导出日志。本轮未能启动可操作 QGC 5.1.4，因此没有上传、执行或伪造 mission 结果。

已具备的前置条件：

- 独立 serial1 路由已实际输出 SITL HEARTBEAT。
- Gateway serial0 / telemetry_v2 保持隔离。
- Web 地面站可展示一份尚未上传的四航点教学计划。

后续真实验收必须记录：GPS/EKF/PreArm、MISSION_COUNT/ITEM/ACK、MISSION_REQUEST、AUTO current sequence、RTL 与 LAND、BIN 日志路径、端口/进程释放。不得关闭 ArduPilot 预解锁检查。

### P5-G 状态更新

Gazebo Iris world/plugin 已恢复并可启动；Gateway 也能得到真实 Gazebo/SITL telemetry。阻断已收敛为两个明确项目：

1. 当前 Gateway 白名单命令只涵盖 arm/disarm、有限模式与 takeoff/land/RTL；尚未实现 mission upload/readback 的 MAVLink 协议层，不能把网页四航点教学计划当作已上传 mission。
2. Chrome 驱动的 session 仍可出现 `Accels/Gyros inconsistent` 预解锁拒绝；不得为执行 AUTO 而关闭 `ARMING_CHECK`。

| 验收项 | P5-G 真实结果 |
| --- | --- |
| 四航点建立（网页教学计划） | PASS（未上传） |
| MAVLink MISSION_COUNT / ITEM / ACK | NOT RUN |
| Mission readback | NOT RUN |
| AUTO 逐点 / `MISSION_CURRENT` / `MISSION_ITEM_REACHED` | NOT RUN |
| RTL / LAND / BIN 日志 | NOT RUN |

因此 AUTO/RTL 保持 **BLOCKED**，不是 FAIL，也不是 PASS。

### P5-G 最小安全前置

Gateway 现已将 `AUTO` 纳入受控模式集合，但新增了强制门槛：`mission_verified` 未由 Gateway 的上传/读回流程置真时，`set_mode AUTO` 返回“尚未上傳已驗證的 mission，已拒絕 AUTO”，且不会发送 MAVLink mode command。该单元测试以 RED→GREEN 完成；Gateway 全量测试现为 **39 passed**。这不是 mission upload 的替代实现。
# P5-H 更新（2026-11-11）

Mission AUTO／RTL：**BLOCKED**。第 2 次獨立冷啟動在 GPS Fix 6 與 16 秒穩定等待後仍收到 `PreArm: Gyros inconsistent`。依安全規則未上傳四航點、未切換 AUTO、未執行 RTL，也未將任何純 SITL 或歷史結果冒充為本次 Gazebo Mission 結果。

