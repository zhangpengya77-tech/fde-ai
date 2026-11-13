# P4-C Chrome 真實閉環紀錄（2026-11-10）

## 結論

- **單一全新 Gazebo 會話的 Chrome 閉環：PASS**。
- 測試透過官方 Gazebo Harmonic Iris 無圖形場景、ArduCopter Copter-4.7.2、
  localhost-only FDE-DT Gateway 與 Playwright Desktop Chrome 完成；不是 Mock 或純 SITL。
- 最終專項：`tests/browser/rea-physics-pro.spec.ts --project=desktop-chrome`，
  **1 passed（約 2 分 42 秒）**。

## 本輪定位的根因與最小修復

1. 瀏覽器 `preparing` 的原始故障不是 CORS：失敗會話的 Gateway 錯誤為
   `沒有 SIM_* 參數，判定為真飛控`。
2. Gateway 原本在 MAVLink 驗證失敗後未關閉 `udpin:127.0.0.1:8210` 的 pymavlink socket；
   端口上累積多個接收端，造成後續 JSON SITL 的 HEARTBEAT / PARAM_VALUE 被競爭接收。
3. 修復後：SIM_SPEEDUP 參數探測最多三次、但仍強制要求 `SIM_*`；驗證失敗與正常 session
   結束均釋放其 MAVLink socket，失敗 session 也會停止其專屬 SITL。
4. Gateway 全量測試：**35 passed**。

## 真實瀏覽器斷言

- Gateway metadata：`simulator_type=gazebo_ardupilot_sitl`、sysid 251、ENU。
- 瀏覽器進入 Physics Pro，SITL 完成自身 PreArm / gyro 檢查後解鎖。
- 鍵盤升高後 HUD 高度大於 1m。
- Three.js canvas 的 `data-rea-drone-height` 與 HUD 高度差小於 0.05m；該值由
  `SitlEngine` 的 Gateway ENU 遙測經 `scene.setDrone` 寫入，沒有本地物理雙寫。
- Backspace 後 session 釋放；最終檢查沒有 `arducopter`，且 8200、8201、8210、9002、5760
  均未監聽。

## 已知限制（不得誤稱已解）

- 官方 Gazebo JSON 插件在同一個 Gazebo 進程內反覆替換 JSON SITL 對端的熱重連仍不穩定；
  本輪驗收的是全新 Gazebo 進程中的首個 session。多 session / 多次「重來」的 Gazebo
  生命周期策略仍是 **BLOCKED**，需設計常駐 SITL 或協調重啟 Gazebo 的明確方案。
- 真機 RadioMaster Pocket 的 Physics Pro HID 操作仍為 **PENDING_MANUAL**。
- 未在本輪量測 FPS、RTF、CPU/RAM 峰值；不得標為性能 PASS。

## 保護與回退

- Web Lite、既有評分與輸入映射未改動。
- Gateway 僅綁定 127.0.0.1，token、Origin 白名單、單 session、1 秒遙測逾時拒絕控制及
  RC 看門狗均未放寬。
- 回退：停止 Gateway / Gazebo；Web Lite 無需任何 Physics Pro 服務。
- 未執行 commit、push、merge 或 deploy。
