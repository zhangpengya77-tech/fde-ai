# P5-E QGroundControl 5.1.4 隔离 GUI 修复记录

日期：2026-11-10  
状态：BLOCKED（安装器要求管理员权限；未安装）

## 官方资产复核

| 项目 | 实际值 |
| --- | --- |
| 发布来源 | `https://github.com/mavlink/qgroundcontrol/releases/tag/v5.1.4` |
| 资产 | `QGroundControl-installer-AMD64.exe` |
| 本机路径 | `E:\FDE-DT\qgc-v5.1.4-isolated\QGroundControl-installer-AMD64.exe` |
| 文件长度 | 135,364,443 bytes |
| 官方 / 本机 SHA-256 | `56F5F943DF5EB878A67AD73D81FDD8B3D823C60535FE1CC08410545108A49D20` |
| Authenticode | `NotSigned` |

## 隔离性判定

指定安装目录为 `E:\FDE-DT\qgc-v5.1.4-isolated\QGroundControl-v5.1.4\`，复核时尚不存在。

对官方安装器只作静态识别，结果显示它使用 NSIS 3.11，且内嵌 application manifest 宣告 `requestedExecutionLevel level="requireAdministrator"`。因此它无法在本轮“不需要管理员权限、不修改系统设置”的约束下被确认是合规的纯用户级隔离安装。

已启动到安装精灵的初始画面进行能力核对，但没有接受 UAC、没有选择安装路径、没有执行安装。后续人工关闭后复核发现 PID `4368` 仍为同一 `QGroundControl-installer-AMD64.exe` 程序，创建时间为 `2026-11-10 18:46:45`，因此不是 PID 重用；该提升权限程序尚未完全退出，当前用户权限不能安全终止它。目标安装目录仍不存在，未发现 PATH、驱动、Windows 服务或受保护工作树变更。

在该精确提升权限程序消失前，不应启动新的安装器实例或尝试任何解压/便携替代安装；应由拥有提升权限的当前桌面用户在 Windows 中关闭安装精灵或拒绝其权限请求，然后重新核对。

## 未执行的验收

以下项目必须保持未验收，不能由旧的缺 DLL build 或 HQGroundControl 替代：

- QGC 5.1.4 GUI 版本显示
- `Qt6Bluetooth.dll` 及运行时依赖完整性
- 隔离 ArduPilot SITL sysid 251 HEARTBEAT
- 姿态、GPS、电池与飞行模式显示
- QGC UDP link 的本机绑定与 Gateway serial1 分流
- QGC 断线/重连、四航点上传/读回、AUTO、RTL、日志

## 回退与后续

回退不需要任何动作：原始官方安装器保留在 E 槽，未产生安装目录或系统变更。Gazebo plugin/world 继续为既有 `BLOCKED`，AUTO/RTL 继续为 `NOT RUN`，RadioMaster 真机为 `PENDING_MANUAL`。

若教师之后另行批准管理员权限，下一步仍应先在安装精灵中验证能将全部文件放入上述 E 槽目标目录，确认没有驱动、PATH、服务或全局关联写入，再进行安装；若不能满足，则停止并寻找官方可验证的用户级发行方式。

## 官方可携替代方案评估（仅调查，未执行）

2026-11-10 通过官方 `mavlink/qgroundcontrol` v5.1.4 Release API 复核资产清单：Windows 平台只发布了 `QGroundControl-installer-AMD64.exe` 与 `QGroundControl-installer-ARM64.exe`；没有 Windows x64 Portable ZIP。Release 页面提供的 `zipball` / `tarball` 是源码快照，不是已部署 Qt 运行时，不能作为 GUI 运行包。

因此目前没有可直接下载、官方发布、且可验证 SHA-256 的 Windows Portable ZIP 方案。理论上可以研究从官方 NSIS 安装器静态解包到指定 E 槽目录，但这不是 QGC 官方发布的可携部署流程，无法预先保证完整 Qt plugins、注册表/安装脚本副作用、升级行为及运行时依赖；在完成专门的隔离性验证前，不建议执行，也不能把它当作已支持的替代安装方式。

## P5-F 安装风险审查（2026-11-10）

### 已验证

- PID `4368` 仍存在，进程名仍为 `QGroundControl-installer-AMD64.exe`，创建时间仍为 `2026-11-10 18:46:45`，父进程为 `codex-computer-use.exe` PID `18168`；不是 PID 重用。
- 进程尚在运行，Windows 无法在运行期间提供退出码；先前没有捕获退出码，进程未来退出后也不能回溯取得。
- 目标目录不存在，E 槽隔离根目录中只有原始安装器；无隔离 QGC GUI 进程、无从该 E 槽路径加载的 Windows 服务。
- 既有运行时仍在原位置：QGC build `5.1.4.0`、HQGroundControl `2.3.0.0`、Mission Planner `1.3.83`；本轮未写入或启动它们。
- 安装器静态 manifest 指定 `requireAdministrator`，所以在当前“不提升权限”边界下无法完成安装。

### 仅静态线索，不能视为实际写入

二进位扫描出现 `HKLM`、`Environment`、`Path` 与 `.exe` 等字串。这些也可能来自 NSIS 运行时或通用安装逻辑；未解包及未执行安装脚本，故**不能**据此断言会写入具体注册表键、PATH、服务、驱动、档案关联或卸载项。

### 未能确认

- 具体注册表键、卸载资讯、档案关联与 PATH 写入范围。
- 是否会新增服务或驱动（未发现可作为证据的具体服务/驱动名称）。
- 安装精灵在管理员权限下是否仍允许全文件落在指定 E 槽目录。

### Windows Sandbox / VM 评估

当前系统为 Windows 11 Home，且 Windows Optional Feature 查询本身要求提升权限；Windows Sandbox 正式支持通常需要 Pro/Enterprise/Education，不应在此主机上假定可用。已未发现 VirtualBox/VMware CLI。硬体状态回报 `HypervisorPresent=True`，但处理器韧体虚拟化与 SLAT 项均为 False；在未改变 BIOS 或系统功能前，不把新建本机 VM 视为可行方案。

最低风险的独立验证方式是：使用另一台已具 Windows Pro/Enterprise/Education、启用虚拟化的测试机，或教师已提供的现成 VM；先建立可还原快照，在 VM 内运行经 SHA-256 验证的官方安装器，再对安装前后进行注册表、PATH、服务、驱动、档案关联、卸载项及文件系统快照比对。不得将该 VM 验证结果自动等同于本机可安全安装。

## P5-F 后续人工关闭复核（2026-11-11）

- PID `4368` 已不存在；因此不能以历史 PID 推断任何现行程序身份或退出码。
- 指定目录 `E:\FDE-DT\qgc-v5.1.4-isolated\QGroundControl-v5.1.4\` 仍未建立；隔离根目录只保留安装器。
- 未发现 QGroundControl/HQGroundControl 背景程序或 Windows 服务；既有 HQGC 与 QGC-DEV 目录仍位于原路径，未见本轮写入证据。
- 安装器本机 SHA-256 仍为 `56F5F943DF5EB878A67AD73D81FDD8B3D823C60535FE1CC08410545108A49D20`；Authenticode 为 `NotSigned`。本轮未重新执行安装器，也未提升权限。

### 后续方案（仅建议，未执行）

**A. 隔离 VM / Sandbox 验证官方安装器。** 先在可还原快照环境比较安装前后文件、注册表、服务、PATH 与卸载项；这是验证 `requireAdministrator` 安装器副作用的最低风险方式。

**B. 暂缓 GUI。** 官方 v5.1.4 Release 未提供 Windows Portable ZIP；源码 zip/tar 不是 GUI 运行包。当前机器也没有 `7z` / `innounp` 等静态解包工具。即使未来研究从官方 NSIS 安装器解包，也应先在隔离环境验证完整 Qt runtime、plugins 与系统副作用，不能直接当成官方可携发行方式。
