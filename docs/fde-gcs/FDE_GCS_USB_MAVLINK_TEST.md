# FDE-GCS USB／MAVLink 測試報告（P2：真機 USB 唯讀）

- 日期：2026-11-13
- 分支：`feat/fde-gcs-web-v1`
- 測試環境：雲端容器（Linux、Node 22、Python 3.13、pymavlink 2.4.50、Chromium／Playwright）
- **沒有接任何真機**，也**沒有跑 ArduPilot SITL**（原因見第 4 節）

## 1. 本階段完成的功能

| 功能 | 位置 |
|---|---|
| MAVLink 訊息定義（12 則），由 pymavlink 產生器輸出（MIT 例外條款） | `gcs_portal/static/gcs_portal/mavlink/defs.js`，產生器 `gcs_portal/tools/gen_mavlink_defs.py` |
| MAVLink v1／v2 解碼、CRC 檢查、分段重組、雜訊重新同步；v2 編碼 | `mavlink/codec.js` |
| **送出白名單**：只允許 HEARTBEAT、PARAM_REQUEST_LIST、PARAM_REQUEST_READ，以及 COMMAND_LONG 的 511（SET_MESSAGE_INTERVAL）和 512（REQUEST_MESSAGE）。其他訊息在編碼層就被拒絕 | `mavlink/codec.js` |
| Web Serial 連線：使用者點擊後手動選 COM 埠、選 Baud Rate；不呼叫 `getPorts()`；中斷時呼叫 `forget()` 撤銷授權 | `mavlink/link.js` |
| COM 埠被占用時，用白話提示先關閉 Mission Planner、QGC，**不自動重試** | `link.js` 的 `describeOpenError()` |
| 心跳狀態：等待 → 正常 → 訊號中斷（超過 3 秒）→ 已斷線（超過 10 秒）；USB 拔除會偵測到 | `link.js` |
| 遙測：飛控類型、韌體版本、飛行模式、ARM 狀態、電池、GPS、相對高度、姿態、更新時間；每個值標示來源訊息，超過 2 秒沒更新就變灰 | `mavlink/telemetry.js`、`gcs.js` |
| 參數下載：全部讀取 → 安靜 1 秒後依索引補讀缺漏（每個最多 3 次）→ 標示完成、未完整或失敗；忽略重複訊息；整數型別四捨五入 | `mavlink/params.js` |
| 參數表：搜尋、原始值與目前值比對（有變化的標黃色）、匯出 `.param` 備份檔 | `gcs.js` |

### 為什麼用 SET_MESSAGE_INTERVAL 請求遙測

舊的 `REQUEST_DATA_STREAM` 在 ArduPilot 上會把頻率**存進 SRx_ 參數**，等於寫入飛控。`SET_MESSAGE_INTERVAL` 只在本次開機有效，不會寫入參數，符合「唯讀」要求。

### 已知限制

- ArduPilot 用 C 轉型把參數值放進 float 欄位。超過 2^24 的整數參數會有精度誤差，畫面依型別四捨五入，但無法還原原始精度。
- 遙測頻率請求只在第一次收到心跳時送出一次；飛控重開機後，要按「中斷」再重新連線。

## 2. 測試結果

### 2.1 單元測試（`node --test 'student_portal/gcs_portal/js_tests/*.test.mjs'`）

| 測試 | 結果 |
|---|---|
| 解碼 22 個 pymavlink 標準封包（MAVLink v1 與 v2，11 種訊息），每個欄位都和 pymavlink 一致 | PASS |
| 封包被切成 7 位元組小段、前面有雜訊，仍能完整重組 | PASS |
| CRC 損壞的封包被拒絕，下一個封包正常解出 | PASS |
| 5 種送出訊息的編碼結果和 pymavlink **逐位元組相同** | PASS |
| PARAM_SET、SET_MODE、MISSION_ITEM_INT、RC_CHANNELS_OVERRIDE、COMMAND_INT 一律拒絕編碼 | PASS |
| COMMAND_LONG 的 ARM（400）、DO_SET_MODE（176）、馬達測試（209）、校準（241）、重啟（246）、起飛（22）、RTL（20）、LAND（21）一律拒絕 | PASS |
| 參數下載：重複訊息、缺漏補讀、重試上限後回報缺少的索引、飛控不回應時失敗 | PASS（4 項） |
| 心跳狀態切換、只接受第一台飛控、忽略其他地面站的心跳 | PASS |
| 總計 | **13／13 PASS** |

### 2.2 Django 測試（`python manage.py test gcs_portal`）

**19／19 PASS**。包含 P1 的 18 項，以及新增的「`defs.js` 和產生器輸出一致」。

### 2.3 端到端測試（Chromium + pymavlink 模擬飛控）

做法：瀏覽器打開真正的 `/gcs/` 頁面。測試程式用假的 `navigator.serial` 取代 USB，把資料流接到 `gcs_portal/tools/mock_vehicle.py`。這是用 pymavlink 送出真實 MAVLink 封包的模擬飛控，有 400 個參數，下載時**刻意丟掉約 5%**。

| 檢查項目 | 結果 |
|---|---|
| 收到心跳，System ID／Component ID 顯示 1／1 | PASS |
| 遙測：LOITER、4.5.0 official、RTK Fixed 14 顆、電池 12.46 V，都來自 MAVLink 訊息 | PASS |
| 頂部色條顯示「真機模式（已連線・唯讀）」 | PASS |
| 400 個參數全部下載完成，丟掉的 19 個自動補讀回來 | PASS |
| 搜尋 `ATC_RAT` 只顯示 2 筆，數值正確 | PASS |
| 匯出檔案格式正確（4 行說明＋400 行參數） | PASS |
| 中斷後撤銷 COM 埠授權（`forget()`） | PASS |
| 瀏覽器主控台零錯誤（包含沒有任何 CSP 違規） | PASS |
| **模擬飛控收到的 30 則訊息裡，不允許的訊息數量** | **0** |

收到的訊息明細：HEARTBEAT 5、COMMAND_LONG 511 ×4、COMMAND_LONG 512 ×1、PARAM_REQUEST_LIST 1、PARAM_REQUEST_READ 19。

截圖：`P2_connected_mock.png`

### 2.4 回歸測試

完整回歸（`learning` + `gcs_portal`）：結果記錄在 `FDE_GCS_P2_REPORT.md`。

## 3. 重現方式（開發環境）

```bash
pip install pymavlink
node --test 'student_portal/gcs_portal/js_tests/*.test.mjs'
python manage.py test gcs_portal
python gcs_portal/tools/mock_vehicle.py --port 8263 --log received.json
node gcs_portal/js_tests/e2e/mock_serial_e2e.cjs http://127.0.0.1:8260 <sessionid> 8263 p2
```

更新 MAVLink 定義或測試資料時：

```bash
python gcs_portal/tools/gen_mavlink_defs.py > gcs_portal/static/gcs_portal/mavlink/defs.js
python gcs_portal/tools/gen_mavlink_fixtures.py > gcs_portal/js_tests/fixtures/mavlink_fixtures.json
```

## 4. 尚未完成：需要本機人工驗收

| 項目 | 狀態 | 說明 |
|---|---|---|
| ArduPilot SITL 測試 | `BLOCKED_CLOUD` → 改為 `PENDING_LOCAL` | 雲端已能下載官方 SITL 執行檔，但執行下載來的程式被雲端安全規則擋下，所以**沒有執行**，改用 pymavlink 模擬飛控 |
| Windows Chrome／Edge 的真實 Web Serial | `PENDING_LOCAL` | 雲端沒有 USB，端到端測試用的是假的 serial 物件 |
| Pixhawk 2.4.8 讀取 | `PENDING_MANUAL` | 見下方驗收步驟 |
| USB 拔除與重新連線 | `PENDING_MANUAL` | 同上 |
| COM 埠被 Mission Planner 占用時的提示 | `PENDING_MANUAL` | 同上 |

### 本機驗收步驟（教師執行，只讀，不會寫入飛控）

1. **拆下螺旋槳**，只用 USB 供電，不接電池。
2. 關閉 Mission Planner、QGC 等所有地面站。
3. 啟動網站（`FDE_GCS_ENABLED=1`），用 Chrome 或 Edge 打開 `http://localhost:<埠>/gcs/`。
4. 選「真機（USB）」→「選擇 USB 並連線」→ 在跳出的視窗選 Pixhawk 的 COM 埠。
5. 確認：心跳顯示「正常」、飛控類型、韌體版本、飛行模式、ARM 狀態（應為已上鎖）、電池、GPS、姿態都有數值，轉動飛控時姿態數值會跟著變。
6. 按「讀取全部參數」，確認顯示「完成：共 N 個參數」，再匯出備份。
7. 拔掉 USB，確認畫面在 10 秒內顯示斷線，所有按鈕停用。
8. 打開 Mission Planner 並連上同一個 COM 埠，再回到網頁按連線，確認出現「請先關閉 Mission Planner」的提示，而且沒有自動重試。
9. 把每一步的結果和截圖記錄到本文件，狀態改為 PASS 或 FAIL。
