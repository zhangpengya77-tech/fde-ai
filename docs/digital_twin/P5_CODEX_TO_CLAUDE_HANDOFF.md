# P5 Codex → Claude 交接

## RCA-6 交接（2026-11-11）

G5 headless flight runner 已以 TDD 建立，但实际单次启动被 E: 挂载消失安全阻断：`/mnt/e/FDE-Gazebo/build/ardupilot_gazebo` 不存在，Windows 亦没有 E: 卷。没有启动 Gazebo/SITL/Gateway、没有发出飞行控制指令、没有端口残留。恢复 E: 后应先核验三项 plugin SHA，再从单次 G5 HTTP/WS/telemetry/DELETE/exit=0 验收开始；通过后才建立全新的五次冷启动 batch。详见 `P5_RCA6_HEADLESS_FLIGHT_ACCEPTANCE.md`。

## RCA-5 與 P6 架構登記（2026-11-11）

RCA-5 已縮小 SIGSEGV：完整 Iris、去 Gst、去 CameraZoom、去兩 plugin 皆 SIGSEGV；僅移除 camera sensor 且保留三軸雲台 joint graph 時，SIGINT/SIGTERM 各 3/3 為正常退出。這只允許進入隔離的 RCA-6 headless camera-sensor-disabled 策略評估，不允許直接修改第三方 plugin 或恢復五次正式冷啟動。詳見 `P5_RCA5_GIMBAL_ISOLATION.md`。

已登記 `P6-HQGC-3D-MULTI` 為後續架構目標，尚未實作：使用標準 MAVLink 的獨立 GCS Adapter、每機獨立 SYSID/Component ID/任務命名空間/斷線與人工接管；HyperQGC 私有 API 未核實，不得假設或複製。P6 僅能在 P5 單機安全閉環後開始，且必須維持 Web Lite、Physics Pro、考照評分與真機控制的隔離。

## 已实现

- Gateway `serial1` 的 QGC 专用可选输出；Gateway `serial0` 仍固定为 127.0.0.1:8210。
- QGC 输出 host 必须显式批准、完全匹配且为 loopback/私有地址；单元测试覆盖拒绝任意 host。
- WSL2 到 Windows NAT 的真实 SITL HEARTBEAT 已证明。
- `?mode=gcs` 网页训练入口、四航点计划、未连线禁用上传/AUTO/RTL 已加入。

## 阻断

1. QGC 5.1.4 Release 缺少 `Qt6Bluetooth.dll`，GUI 不可用；不要复制 DLL 或修改 baseline build。
2. `Ubuntu` / `Ubuntu-24.04` VHDX 缺失；不得重建或迁移。可用发行版为 `FDE-DT-Ubuntu`。
3. P5-G 已找到既有官方 `ardupilot_gazebo` source/build（`/mnt/e/FDE-Gazebo`，commit `f116b035`）并成功启动 Iris server-only。当前阻断不再是缺资源，而是浏览器 session 的 PreArm IMU 一致性波动与尚未实现的 mission upload/readback 协议。

## 下一步

先以可重复的 Gazebo/SITL 初始化记录解决 `Accels/Gyros inconsistent` 的收敛问题；不得放宽 `ARMING_CHECK`。然后新增最小、受 token/会话/白名单保护的 MAVLink mission upload/readback 协议，测试 `MISSION_COUNT/ITEM/ACK` 后，才执行 AUTO/RTL。QGC GUI 仍 BLOCKED，切勿把当前网页计划或 heartbeat probe 记为 QGC mission PASS。

P5-G 已补入第一道 AUTO 防线：`AUTO` 不再是“不支援模式”，但 `mission_verified=false` 时由 Gateway 拒绝、且不会发送 `set_mode`。尚未实现 Mission 协议本身。

## Git

未执行 commit、push、merge、deploy。所有保护 worktree 保持只读。
# P5-H 更新（2026-11-11）

新增安全遥测链：Gateway `SYS_STATUS` → `telemetry_v2.sensor_health` → `SitlEngine`。浏览器自动 arm 现在需要 GPS Fix >= 3、`sensor_health.gyro === true` 与连续 15 秒稳定期；未知或 false 都保持等待。定向 RED/GREEN 已保存：Gateway 9 PASS、SitlEngine 10 PASS；全量：Gateway 39 PASS、前端 Vitest 859 PASS、Vite build PASS。

真实冷启动证据尚不足：#1 发生 WebSocket 安全超时回退；#2 在 Fix 6 后仍 `PreArm: Gyros inconsistent`。不要执行 Mission AUTO/RTL，直到完成五次独立冷启动并记录失败率。未修改 ARMING_CHECK、EKF 或 Gazebo world/plugin 参数。

# RCA-3C 交接補充（2026-11-11）

可供後續 RCA-4 使用的唯一官方 world/model 輸入：`/home/fde/fde_p5i_rca_isolated/resources-f116b03552d0-complete`。它固定於 ardupilot_gazebo commit `f116b03552d05c8d0b0bed5ed67033a1183121d1`，含 30 個 Git object。不可使用 E 槽工作樹的 0-byte `worlds/iris_runway.sdf` 或 dirty `models/iris_with_standoffs/model.sdf`。插件 binary provenance 未完成，故完整 Iris 啟動對照仍 BLOCKED；Camera/GStreamer 與 Ogre2 的來源已定位但尚未證明 SIGSEGV 因果。

RCA-3D 靜態檢查後，三項 plugin 為 `PARTIALLY_VERIFIED` 而非完全未驗證：`CMakeCache` 指向固定官方 source commit，ELF 需要 Harmonic `libgz-sim8.so.8`，系統 loader 無缺失庫。完整 Iris B、E、F 實驗現在是 `READY WITH RISK`，但仍需要 RCA-4 明確執行授權；不得把此靜態結論當成 runtime/SIGSEGV 修復證明。

RCA-4 已執行：A 空場景正常；完整 Iris B、E、F 皆在 SIGINT/SIGTERM 重現 Gazebo `-11`；有效 C（移除 gimbal camera 裝配與關聯 joint）皆為 0。下一步不應直接開始五次冷啟動：先需對 gimbal/C camera path 建立更窄的、保持完整 joint graph 的變體或取得非特權 stack trace，確認是 GstCameraPlugin、CameraZoom、gimbal model 還是其卸載順序。所有既有原始 E 槽 dirty 檔仍未觸碰。

