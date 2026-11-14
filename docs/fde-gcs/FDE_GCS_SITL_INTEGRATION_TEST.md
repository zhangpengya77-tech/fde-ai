# FDE-GCS SITL 仿真整合（P4）

- 日期：2026-11-14
- 狀態：**BLOCKED（尚未開始）**

## 1. 為什麼還沒開始

總指令第八部分規定：**P4 必須等 Gazebo 接管案回歸測試通過後才能開始，而且不得干擾它**。接管案的整合樹在本機 `D:\FDE-CC-Takeover\sim`，雲端無法存取，所以無法確認回歸測試狀態。

另外，雲端執行官方 SITL 執行檔被安全規則擋下（見 `FDE_GCS_USB_MAVLINK_TEST.md` 第 4 節），雲端也無法跑 SITL 測試。

## 2. 目前已有的部分

| 項目 | 狀態 |
|---|---|
| 介面上的「仿真（SITL）」模式按鈕與色條 | 已有，顯示「P4 開放」 |
| 航線規劃說明（TAKEOFF 開頭、RETURN_TO_LAUNCH 結尾） | 已寫在介面上，來自 SITL 實測時遇到的 `init failed` |
| `START_FDE_SITL_TRAINING.bat` | 已完成：只檢查 SITL 是否在執行（5760 埠），已在執行就不重複啟動；沒有在執行時，只會呼叫教師設定的 `FDE_SITL_LAUNCHER`（接管案自己的啟動程式） |
| 前端 MAVLink 編解碼器、心跳、遙測、參數 | P2 已完成，P4 可以直接沿用 |

## 3. P4 實作計畫（開始條件成立後）

```text
瀏覽器 ──WebSocket（短效 ticket）──→ FDE-GCS SITL Gateway（127.0.0.1:8261，新服務）
                                         │  唯讀 ticket：只轉發遙測
                                         │  控制 ticket：教師授權、短效、可撤銷
                                         ↓
                                 MAVLink 分流（單一擁有者，例如 mavlink-router，UDP 127.0.0.1:8262）
                                         ↓
                                 ArduPilot SITL（5760）↔ Gazebo（接管案，不修改）
```

1. **只讀第一**：Gateway 只轉發遙測，瀏覽器沿用 P2 的編解碼器顯示儀表板。
2. **離線航線編輯**：地圖上編輯航點，存成學員的課程資料，還不上傳。
3. **控制 ticket**：教師授權後，才開放上傳航線和 AUTO／RTL；控制 ticket 綁定學員、SITL 實例、10 分鐘有效。
4. **任務結果**：記錄航點序號、完成時間、是否觸發返航，接到 P5 的學員成果。

## 4. 驗收項目（P4 開始後填寫）

| 項目 | 狀態 |
|---|---|
| 接管案回歸測試通過（開始條件） | PENDING_LOCAL |
| SITL 獨立啟動、FDE-GCS 不搶 5760 | PENDING |
| FDE-GCS 與 QGC／HyperQGC 同時連線（經分流） | PENDING |
| 四航點仿真任務 | PENDING |
| 唯讀 ticket 不能送出控制指令 | PENDING |
