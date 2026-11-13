# P5 回归报告（2026-11-10）

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| Gateway 安全/后端单元 | PASS | `python3 -m pytest -q`，P5-G 为 39 passed（FDE-DT-Ubuntu） |
| WEB LITE + Physics Pro 前端单元 | PASS | `npm test`，66 files / 857 tests passed |
| TypeScript / Vite | PASS | `npm run build` exit 0 |
| P5 GCS Chrome | PASS | `tests/browser/p5-ground-station.spec.ts --project=desktop-chrome`，1 passed |
| serial1 到 Windows NAT heartbeat | PASS | sysid 251 / compid 1 / MAVLink HEARTBEAT，5 frames |
| QGC 5.1.4 GUI 连接 | BLOCKED | 官方 v5.1.4 安装器 SHA-256 已复核，但其 NSIS manifest 要求 `requireAdministrator`；依隔离边界未执行安装。旧 build 的 `Qt6Bluetooth.dll` 缺失问题未绕过。 |
| QGC 四航点上传/读回/AUTO/RTL | NOT RUN | 合规 QGC GUI 尚未可用；没有使用替代工具冒充。 |
| Gazebo Iris 资源恢复与真实 telemetry | PASS | 官方 Iris world/plugin 实际位于 `/mnt/e/FDE-Gazebo`；Gazebo 8.15.0 + Copter-4.7.2 session 得到 GPS、姿态、ENU 位置和电池 telemetry |
| Chrome 3D 权威数值同步 | PENDING | 一次真实浏览器 session 记录 `armed=true`、高度 1.28 m；未取得完整 Playwright 终态 / 3D 数值对照工件，不标记 PASS |
| Gazebo + SITL 四航点 mission/AUTO/RTL | BLOCKED | mission upload/readback 协议尚未实现，且 Chrome session 有预解锁 IMU 一致性波动；没有关闭安全检查 |
| RadioMaster Pocket 实体验收 | PENDING_MANUAL | 未连接实体 USB 设备 |

## 进程与端口

本次 P5-E 启动前复核：Windows 与 FDE-DT-Ubuntu 均未监听 4173、8200、8201、8210、8211、8212、8230、9002、14550、14560 或 5760；未发现 arducopter、gz sim 或 fde_twin.server 残留。

安装器后续复核：目标目录 `E:\FDE-DT\qgc-v5.1.4-isolated\QGroundControl-v5.1.4\` 仍不存在，没有 QGroundControl GUI、隔离 QGC 服务或安装目录内容；但提升权限的安装器 PID `4368`（创建时间 `2026-11-10 18:46:45`）仍存在，必须由本机提升权限用户关闭。该状态不构成已安装或已验收。

官方 v5.1.4 Release 的 Windows 资产只包含 AMD64/ARM64 安装器；未发现可验证的 Windows Portable ZIP。源码 ZIP/TAR 不能替代已部署运行时。未执行非官方的 NSIS 静态解包。

P5-F 风险审查没有改变上述基线：Gateway 37 PASS、WEB LITE/Physics Pro 前端单元 857 PASS、P5 GCS Chrome 1 PASS。QGC GUI 继续 BLOCKED；Gazebo P5 mission 与 AUTO/RTL 继续 BLOCKED/NOT RUN。

## 已知非阻断警告

Vite 仍报告 `three.module` minified chunk 大于 500 kB。P5 没有为消除警告而重构或更改渲染依赖。

## 安全回归

- Gateway 本机 127.0.0.1、token、Origin、单会话和遥测超时/RC 看门狗没有被放宽。
- 新 QGC 输出不是 Gateway 接收端；默认关闭，且必须明确受控 host。
- WEB LITE 不读取 Gateway，P5 页面未连 session 时明确禁用上传/AUTO/RTL。
# P5-H 更新（2026-11-11）

## RCA-6 本輪回歸與阻斷

| 範圍 | 狀態 | 證據 |
| --- | --- | --- |
| RCA-4/5/6 runner 定向 pytest | PASS，11 | 新 G5 workspace / resource-boundary / preflight tests |
| Gateway 全量 pytest | NOT RUN（本輪） | 前一輪 48 PASS 是歷史結果，不冒稱重跑 |
| 前端 Vitest / Vite | NOT RUN | 本輪沒有前端修改 |
| G5 Gazebo+SITL+Gateway | BLOCKED BEFORE START | E: 及 `/mnt/e` plugin directory 不可用 |
| 五次冷啟動 / Mission 前置 | NOT RUN | 單次整合未通過環境前置 |

## RCA-5 隔離診斷回歸

| 範圍 | 本輪實測 |
| --- | --- |
| RCA-4/RCA-5 runner 定向 pytest | PASS，8 |
| Gateway 全量 pytest | PASS，48 |
| Gazebo G0--G5 exit isolation | PASS（診斷執行；非產品修復 PASS） |
| 前端 Vitest/Vite | NOT RUN（本輪未改前端） |
| Mission/AUTO/RTL | NOT RUN/BLOCKED |

本輪收尾時 8200、8201、8210、9002、5760 無監聽，且無本輪 Gazebo/SITL/Gateway 殘留。

| 項目 | 結果 | 證據 |
|---|---|---|
| Gateway IMU 健康定向測試 | PASS | `tests/test_gazebo_backend.py`: 9 PASS |
| Physics Pro 自動解鎖健康門檻 | PASS | `tests/unit/rea-sitl-client.test.ts`: 10 PASS |
| Gazebo 冷啟動 #1 | PARTIAL | GPS/EKF 就緒、曾 arm；WS 超時安全回退 |
| Gazebo 冷啟動 #2 | FAIL（安全阻斷） | `PreArm: Gyros inconsistent` |
| Gazebo 冷啟動 #3 | FAIL（基礎設施） | `SYS_STATUS` gyro/accel=true，但 GPS 收斂前 Gateway HTTP 8200 退出 |
| 四航點 AUTO/RTL | BLOCKED | 未在健康前置條件通過前執行 |
| 全量 Gateway／Vitest／Build／Chrome | NOT RUN（本輪尚未重跑） | 不沿用舊基線冒稱本輪結果 |

## P5-F 人工关闭安装器复核（2026-11-11）

| 项目 | 结果 |
|---|---|
| PID 4368 | NOT PRESENT（无 PID 重用风险） |
| 指定 E 槽 QGC 安装目录 | NOT CREATED |
| QGC/HQGC 背景程序及服务 | NONE FOUND |
| 隔离 QGC GUI | BLOCKED / NOT INSTALLED |

# RCA-3C 範圍聲明（2026-11-11）

本輪為純資源來源與完整性審計，未啟動服務、未執行 Gateway/前端測試或建置。先前 Gateway 39 PASS、前端 Vitest 859 PASS、Vite build PASS 僅為既有基線，並非本輪重跑結果。

RCA-3D 仍是靜態預檢；沒有新增執行時回歸測試結果。

## RCA-4（2026-11-11）

- `tests/test_rca4_runner.py`：5 PASS（隔離 resource path、variant overlay、C 模型 `model.config`/joint 完整性、localhost-only SITL command）。
- Gateway 全量 pytest：45 PASS。
- 前端 Vitest / Vite：NOT RUN（本輪未修改前端）；859 PASS / build PASS 僅為既有基線。
- Gazebo 實驗並非回歸 PASS：完整 Iris 退出仍 SIGSEGV，詳見 `P5_RCA4_RUNTIME_EVIDENCE.md`。

