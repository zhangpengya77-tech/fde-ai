# FDE-GCS Web 1.0 — P2 階段報告（真機 USB 唯讀）

- 日期：2026-11-13
- 分支：`feat/fde-gcs-web-v1`
- 沒有部署、沒有合併；沒有接任何真機；沒有寫入任何飛控

## 1. 實際完成

網頁可以透過 Web Serial 讀取飛控：心跳、識別、即時遙測、全部參數（含補讀）、搜尋、比對、匯出備份，並能處理斷線。細節和測試證據見 `FDE_GCS_USB_MAVLINK_TEST.md`。

**唯讀保證**：送出的訊息在編碼層就有白名單，只能送心跳、參數讀取和兩種資料請求指令。測試確認所有寫入或控制類訊息（參數寫入、模式切換、ARM、起飛、返航、降落、馬達測試、校準、重啟）都無法編碼。端到端測試中，模擬飛控收到的不允許訊息數量為 **0**。

## 2. 測試結果

| 測試 | 結果 |
|---|---|
| JavaScript 單元測試 | 13／13 PASS |
| Django `gcs_portal` | 19／19 PASS |
| 端到端（Chromium＋pymavlink 模擬飛控） | 8／8 PASS，不允許訊息 0 則 |
| 完整回歸 `learning` + `gcs_portal` | 失敗項目和改動前的基準**完全相同**（17 failures、19 errors，都是雲端缺少 ffmpeg 和平台檔造成） |
| `makemigrations --check` | 沒有新 migration |

## 3. 修改範圍

P2 的所有改動都在 `student_portal/gcs_portal/` 裡，**沒有修改任何既有檔案**。只有一處修改了 P1 自己的測試：「按鈕都停用」原本用固定字串比對，按鈕加上 id 之後改用正規表示式，檢查內容不變。

新增檔案：

| 檔案 | 用途 |
|---|---|
| `static/gcs_portal/mavlink/defs.js` | MAVLink 訊息定義（自動產生） |
| `static/gcs_portal/mavlink/LICENSE-MAVLINK-GENERATED.txt` | defs.js 的 MIT 授權聲明 |
| `static/gcs_portal/mavlink/codec.js` | 編解碼與送出白名單 |
| `static/gcs_portal/mavlink/params.js` | 參數下載狀態機 |
| `static/gcs_portal/mavlink/telemetry.js` | 遙測整理 |
| `static/gcs_portal/mavlink/link.js` | Web Serial 連線與心跳狀態 |
| `tools/gen_mavlink_defs.py`、`tools/gen_mavlink_fixtures.py` | 產生定義檔與測試資料（開發用，需要 pymavlink） |
| `tools/mock_vehicle.py` | pymavlink 模擬飛控（開發用，預設埠 8263） |
| `js_tests/` | 單元測試、測試資料、端到端腳本 |

`pymavlink` 只在開發環境使用，**沒有加入正式站的 requirements**。

## 4. 未完成與風險

| 項目 | 狀態 |
|---|---|
| ArduPilot SITL 測試 | `PENDING_LOCAL`：雲端擋下執行下載的 SITL 程式，改用 pymavlink 模擬飛控 |
| Windows Chrome／Edge 真實 USB、Pixhawk 2.4.8 讀取、拔除與重連、COM 埠占用提示 | `PENDING_MANUAL`：驗收步驟見 `FDE_GCS_USB_MAVLINK_TEST.md` 第 4 節 |
| 大於 2^24 的整數參數 | ArduPilot 協定本身的精度限制，畫面依型別四捨五入 |
| 飛控重開機 | 遙測頻率請求不會自動重送，需要重新連線 |

## 5. 回退方案

關閉 `FDE_GCS_ENABLED` 入口立即消失。只回退 P2：revert P2 的 commit，頁面會回到 P1 的純 Demo 介面。

## 6. 下一階段（P3：安全參數調整）建議

P3 會開始**寫入真機**，風險最高。開始前需要你提供或確認：

1. **白名單第一版**：哪些參數允許學員修改（建議從 `ATC_RAT_*_P`、`PSC_*` 這類調參教學用參數開始，並依韌體版本分檔）
2. 教師批准流程：每次寫入都要教師在網頁上按批准，還是教師預先開放某個時段
3. 真機驗收時間：P3 必須拆槳、由教師在場監督
