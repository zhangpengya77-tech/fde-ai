# P5-A QGC 单机连接报告

## 结果：BLOCKED（QGC GUI），PASS（隔离 serial1 HEARTBEAT 路由）

- 本机 QGroundControl Release：`D:\FDE-AI-UAS\QGC-DEV\builds\baseline\Release\QGroundControl.exe`，文件版本 5.1.4.0。
- 直接启动的实际错误：`Qt6Bluetooth.dll` 缺失。该 DLL 在 Qt 6.11.1 toolchain 中存在，但不在 Release 目录。
- 未复制 DLL、未修改 QGC build、未永久修改 PATH、未重新安装 QGC。
- HQGroundControl 2.3.0 portable 和 Mission Planner 1.3.83 存在，但本报告不将它们视为官方 QGC 5.1.4 验收替代品。

已完成的真实证据是 Gateway/SITL serial1 到 Windows NAT UDP 14560 的 sysid 251 HEARTBEAT 输出（详见 `P5_MAVLINK_ROUTING.md`）。

## 继续条件

已从官方 GitHub release 下载 `QGroundControl-installer-AMD64.exe` 至 `E:\FDE-DT\qgc-v5.1.4-isolated\`：长度 `135,364,443` bytes、SHA-256 `56F5F943DF5EB878A67AD73D81FDD8B3D823C60535FE1CC08410545108A49D20`，与官方 release digest 相符。安装器本身显示为 `NotSigned`；尚未执行，等待运行新下载软件的即时确认。

## 隔离安装复核（2026-11-10）

已获得执行安装的即时授权后，再次在本机复核：

- 安装器：`E:\FDE-DT\qgc-v5.1.4-isolated\QGroundControl-installer-AMD64.exe`
- 长度：`135,364,443` bytes
- SHA-256：`56F5F943DF5EB878A67AD73D81FDD8B3D823C60535FE1CC08410545108A49D20`（与官方 `mavlink/qgroundcontrol` v5.1.4 Release asset 一致）
- Authenticode：`NotSigned`
- 目标目录：`E:\FDE-DT\qgc-v5.1.4-isolated\QGroundControl-v5.1.4\` 在执行前不存在，未被创建或写入。

安装器的内嵌 NSIS manifest 明确声明：`requestedExecutionLevel level="requireAdministrator"`。这不符合本轮“若需要管理员权限即停止”的隔离安装边界，因此没有接受 UAC、没有选择目标目录、没有写入程序文件、没有安装驱动、没有修改 PATH 或其他系统级设置。

结论：官方安装器来源与完整性 **PASS**；在“不升权”的限定下，GUI 安装 **BLOCKED**。后续只能在获得单独的管理员权限授权后重新评估，或核对 QGC 官方是否发布可验证、无需管理员权限的可携式发行包；不得使用第三方 DLL 或来源不明的便携包。
