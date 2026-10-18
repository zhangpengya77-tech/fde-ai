# FDE Flight Health｜正式系統整合核驗報告

**日期**：2026-10-16
**性質**：正式環境整合核驗（唯讀調查 + 本機臨時實跑，**未改碼、未部署、未啟動常駐服務**）
**結論**：正式後端已定位並完成真實日誌端到端核驗；教師模型自動切換屬「待整合」。

---

## 一、真正的 Flight Health 正式後端（已定位）

| 項目 | 現況 |
|---|---|
| 部署位置 | `D:\FDE-Flight-Health-AI\`（**獨立 repo，不在 v2.0 內**） |
| 啟動方式 | `uvicorn backend.app.main:app --host 127.0.0.1 --port 8040`（預設僅監聽本機；README 明示可信網路才改 `0.0.0.0`） |
| 技術棧 | FastAPI 0.141 + uvicorn 0.54 + pydantic + **pymavlink 2.4.50（DFReader）**；`.venv`（py3.12.13）依賴齊全 |
| 正式 DataFlash Parser | `backend/app/parsers/ardupilot/parser.py`（pymavlink，**非** v2.0 內自研 stdlib 版本） |
| 正式健康規則引擎 | `backend/app/diagnostics/basic_rules.py`（ARM/BAT/GPS/VIB/MOT/RC）＋ `safety_event_rules.py`（FAILSAFE/NAV/MODE 事件） |
| 八卡呈現 | `backend/app/presentation/result_views.py` |
| API 契約 | `GET /api/v1/health`；`POST /api/v1/flights`；`POST /{id}/log`；`POST /{id}/analyze`；`GET /{id}/result`（學員無鑑權）；`GET /{id}/diagnosis`、`GET /{id}/teacher-result`（需 `X-FDE-Teacher-Mode: DEV-LOCAL`） |

- **未以 `reference_server.py` 取代正式後端**；**未修改原始 DataFlash Parser 核心演算法**。
- 本輪前確認 `:8040` 未監聽（正式服務未運行）；本輪僅本機臨時啟動真實後端實跑驗證後已停止（netstat 無 LISTENING）。

---

## 二、學生端分析流程核驗

1. **上傳真實 ArduPilot .bin**：`sample_logs/ardupilot/log_452_2026-9-29-20-38-08.bin`（1,631,197 B，SHA256 `e5ef768b…`，ArduCopter 4.5.7，合法 DataFlash 頭 `a39580…`）。✅
2. **學生不需綁定教師模型**：`GET /{id}/result` 無任何鑑權／模型前置，後端直接跑確定性規則引擎。✅（實測不帶頭→200）
3. **正式後端可用時真實分析並回傳八卡**：本機臨時啟動真實後端，HTTP 全流程 health→flights→log→analyze→result 全部成功，八卡數據真實。✅
4. **正式後端不可用時**：按鈕仍可操作、橫幅明確告知「服務目前離線／尚未配置」、分析失敗顯示真實錯誤、**絕不以 DEMO 冒充**（`app.js` 已驗）。✅（本輪起 :8040 即為不可用狀態，屬實測行為）
5. **不允許 DEMO 冒充正式分析**：`startAnalysis()` 失敗走 catch 顯示真實錯誤，無自動 DEMO 回退。✅

---

## 三、引擎選擇核驗

| 場景 | 真實後端行為 | 判定 |
|---|---|---|
| ACTIVE 且已驗證教師模型可用 | `analyze_flight` 調用 `analyze_log(log_path, ardupilot_parser)`，**無教師模型參數、無引擎解析器** | ❌ 不支援 |
| 無可用教師模型 | 僅用確定性規則引擎（`basic_rules` + `safety_event_rules`） | ✅ |
| 單元測試模擬 ACTIVE | **不以此宣稱正式切換成功** | 遵守 |
| 正式後端尚未支援自動切換 | — | **明確標記：待整合** |

**結論：教師模型自動切換在真實後端尚未實作，標記「待整合」。** 真實後端僅有確定性規則引擎，無任何教師模型接入。

---

## 四、實際日誌驗收（真實飛行日誌）

使用**真實飛行產生**的 `log_452_2026-9-29-20-38-08.bin`（非 `gen_sample_bin.py` 樣本），真實後端真實解析：

**整體**：`inspect`（需要檢查）｜主要問題：飛行模式出現需要檢查的變化（含失控保護）。

**八張健康卡（真實數據依據）**：
| # | 卡 | 狀態 | 依據 |
|---|---|---|---|
| 01 | 動力健康 | ABNORMAL | MOT-001 四路電機命令不均衡 |
| 02 | 電池健康 | NORMAL | 供電數據未觸發異常 |
| 03 | 定位健康 | ABNORMAL | NAV-EVENT-001 定位告警（9.5s 恢復） |
| 04 | 姿態穩定 | NORMAL | 姿態/震動未觸發異常 |
| 05 | 遙控信號 | NORMAL | 遙控未觸發異常 |
| 06 | 飛行模式 | ABNORMAL | MODE-EVENT-001 + FAILSAFE-001 失控保護（3.1s 恢復） |
| 07 | 高度控制 | **INSUFFICIENT_DATA（無法判斷）** | 無高度控制可靠規則（恆無法判斷） |
| 08 | 飛控傳感器 | **INSUFFICIENT_DATA（無法判斷）** | 日誌無 EKF 消息族 |

**4 條真實規則**：MOT-001、MODE-EVENT-001、FAILSAFE-001、NAV-EVENT-001；3 個安全事件、18 個原始事件。

**「無法判斷」處理**：缺少資料的域（高度控制、傳感器）一律顯示 INSUFFICIENT_DATA（未評估），**不猜測、不填預設健康結論**；整體結論採嚴格模式。✅

**安全紅線**：`student_view` 無 RCOU/EKF/VIBE/PID/RCIN/ATT/HDOP/PWM 等原始工程欄位洩漏 = PASS。

---

## 五、保護範圍（本輪未動）

未修改：正式 DataFlash Parser 核心、既有飛行健康判定規則、教師視覺模型中心、F450 數位孿生專案、其他 FDE 模組、正式資料庫結構。
未 commit／未 push／未部署／未啟動常駐正式服務。

---

## 六、最終回報（A–F 區分）

### A. 前端修復完成的項目（上一輪 #285–#290，已核生產安全）
- 移除「教師模型未綁定／請先啟用診斷／體驗 DEMO 才能繼續」等阻塞提示與禁用邏輯。
- 按鈕可用性改為 `canRun = !!uploadedFile && !isRunning`（僅依日誌與分析中狀態）。
- 離線／未配置僅資訊提示，不禁用按鈕；分析失敗顯示真實錯誤，不以 DEMO 冒充。
- 新增診斷引擎狀態標籤（`#flight-health-engine-status`，非阻塞）。
- ⚠️ **遺留**：`refreshFlightHealthState()` 呼叫 `/api/flight-health/engine-status`（相對同源路徑）= **契約外端點**，生產會靜默 404 恆顯「系統標準規則」——非阻塞，但需教師裁決是否移除。

### B. 參考後端測試完成的項目（僅 v2.0 內參考實作，**未接入生產**）
- `flight-health/engine_resolver.py`、`builtin_rule_engine.py`、`reference_server.py`、`gen_sample_bin.py`、`test_engine_resolver.py`（8/8 PASS）。
- 性質：僅為前端離線降級與單元測試的參考實作，**不是正式後端**，不得當作正式分析系統。

### C. 已接入正式後端的項目
- 前端 `app.js` 分析流程（`/flights`、`/{id}/log`、`/{id}/analyze`、`/{id}/result`、`/{id}/teacher-result`、`/health`）與真實後端 `api/flights.py` 契約**完全匹配**，已可對接。
- 真實 .bin 端到端（HTTP 實跑）已通：學員八卡 + 教師視圖 + 鑑權分級（403/200）全部正確。

### D. 尚未接入正式後端的項目
- **教師模型自動切換（ACTIVE 教師模型 → 否則內建規則）**：真實後端無此邏輯 → **待整合**。
- 正式環境 `API_BASE_PROD`（Cloudflare Tunnel 同域轉發）尚未配置（config.js 為空字串）。
- 教師視圖授權僅 `DEV-LOCAL` 開發標記（後端 `access_warning` 明確：接入前須換正式教師身分授權）。
- 引擎狀態標籤端點（`/api/flight-health/engine-status`）為契約外新增，需裁決。

### E. 真實飛行日誌測試結果
- 使用真實 `log_452_2026-9-29-20-38-08.bin`（非樣本），真實後端真實解析 → 八卡真實數據驅動，overall=inspect；
  缺資料域（高度控制、傳感器）正確顯示「無法判斷」；student_view 無原始欄位洩漏。**PASS。**

### F. 正式部署狀態
- `:8040` 正式服務**當前未運行**（netstat 無監聽）；正式後端由教師另行部署於 `D:\FDE-Flight-Health-AI\`。
- 正式環境入口 `API_BASE_PROD` 為空 → 瀏覽器顯示「服務尚未配置」（屬預期）。
- 真實 iPhone 實機驗收：**PENDING**（本輪為本機核驗，非真機）。

---

## 停止條件說明
正式後端**已找到**（`D:\FDE-Flight-Health-AI\`），故未觸發「找不到即停止」。本輪**未自行建立第二套正式分析系統**：`reference_server.py` 等僅作參考實作，未當作正式後端、未接入生產。

**完成，等待教師確認。**
