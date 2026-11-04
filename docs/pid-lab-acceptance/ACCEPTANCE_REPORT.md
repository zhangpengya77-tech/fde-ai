# FDE-AI UAS 2.0｜多飛控 AI PID 與濾波實驗室 驗收報告

- 日期：2026-11-04
- 分支：`feature/pid-filter-lab`（基於 `fde-ai-v2.0-integration-local-20261102` 的 `846ee80`）
- 工作樹：`D:\FDE-AI-UAS-v2.0-pidlab`（獨立工作樹；整合樹 `D:\FDE-AI-UAS-v2.0-integration` 內他人未提交的 14 個修改**完全未觸碰**）
- 部署：**未部署**。正式網站、正式資料庫、DNS、Gateway / 入口代理設定皆未修改。

## 1. 現況檢查結論（P0）

| 項目 | 實際情況 | 對任務書假設的差異 |
|---|---|---|
| 網站實際來源 | `D:\FDE-AI-UAS-v2.0-integration`（入口 :8142 → Gateway :8143 → Live :8141 / Django :8140） | 主目錄 `D:\FDE-AI-UAS-v2.0` 不是線上來源 |
| 左側工具列 | `src/app.js` `renderNavigation()`，「飛行健康 AI」為單字圖示 `健` | 依現有風格新增 `調`，未用 SVG 圖示 |
| Flight Health AI | 獨立服務 `D:\FDE-Flight-Health-AI`（:8040，另一個 repo，有未提交修改），只支援 ArduPilot BIN | 不修改該服務；Betaflight / PX4 健康分析由新模組提供同一套八大指標 |
| 八大指標評分 | 原系統只有狀態卡，**沒有數值權重** | 新增可解釋評分規則（見 §4） |
| 身分與權限 | Gateway 對 `/api/live/*` 驗證 Django 簽發的短效 Assertion（sub / role / cohort） | 實驗室 API 掛在 `/api/live/pid-lab/` 下，**直接沿用**；因此**不需要**修改入口或 Gateway（比原先提出的 :8050 代理方案更安全） |
| 既有 AI PID 功能 | 不存在（全庫搜尋無 PID 調參程式碼） | 全新模組 |
| GitHub CLI | `gh` 未登入 | 無法自動建立 PR，見 §9 |

## 2. 新增 / 修改檔案

修改（僅 3 個既有檔案，皆為加法）：
- `src/app.js`：左側欄在「飛行健康 AI」正下方新增一行入口 `AI PID 與濾波實驗室 / AI PID & Filter Lab`。
- `live_backend/app/main.py`：import + 掛載實驗室路由與 `/pid-lab` 靜態頁（`create_app` 新增可選參數 `pid_lab_service`）。
- `flight-health/index.html`：上傳區上方新增飛控選擇卡（ArduPilot 維持原流程；Betaflight / PX4 / 其他導向實驗室）。原有上傳、分析、報告程式碼未改動。

新增：
- `live_backend/pid_filter_lab/`（約 3,700 行 Python）
  - `parsers/blackbox.py` Betaflight BBL/BFL 解碼器（自行實作）
  - `parsers/dataflash.py` ArduPilot DataFlash BIN 解析器（自行實作，不依賴 LGPL pymavlink）
  - `parsers/ulog.py` PX4 ULog 解析器（自行實作）
  - `parsers/params.py` Betaflight `version` / `diff all` / `dump all`、ArduPilot `.param`、PX4 `.params` 匯入
  - `adapters/{betaflight,ardupilot,px4}.py` 三套**獨立**適配器 → 統一 `FlightData`
  - `analysis/control.py` 追蹤誤差、延遲、Wiener 反卷積階躍響應、Welch 頻譜、姿態外環
  - `analysis/health.py` 統一八大健康指標
  - `analysis/compare.py` BASELINE / AFTER_TUNING 比較
  - `rules/catalog.py` 三套（+ 舊版 APM）獨立參數目錄、`rules/advisor.py` 建議引擎、`rules/export.py` 三種匯出格式
  - `store.py` SQLite + SHA-256 檔案儲存、`api.py` HTTP API、`pipeline.py`
- `live_backend/tests/test_pid_filter_lab.py`（36 項測試）
- `pid-lab/`（前端頁面：`index.html`、`css/lab.css`、`js/lab.js`、`js/charts.js`）
- `docs/pid-lab-acceptance/`（本報告、21 張截圖、截圖驅動腳本）

## 3. 多飛控架構

```
上傳（依「檔案內容」判斷格式，不依副檔名）
  ├─ Betaflight Blackbox ─→ parsers/blackbox ─→ adapters/betaflight ┐
  ├─ ArduPilot DataFlash ─→ parsers/dataflash ─→ adapters/ardupilot ├→ FlightData（統一單位：s、deg/s、deg、0..1、V、A）
  └─ PX4 ULog ───────────→ parsers/ulog ─────→ adapters/px4 ───────┘
        ↓
  analysis/control（演算法 pidlab-analysis/1.0）＋ analysis/health（統一八大指標）
        ↓
  rules/advisor ← rules/catalog（betaflight / ardupilot / ardupilot_legacy / px4 各自獨立）
        ↓
  教師審核（只限同班教師）→ rules/export（Betaflight CLI / Mission Planner .param / QGC .params）
        ↓
  AFTER_TUNING 複測 → analysis/compare → 學員成長檔案 / 實訓報告 / 教師標準參數庫
```

安全原則（已實作並有測試）：
- 不連接飛控、不寫參數、不刷韌體、不啟動馬達；日誌只在本機後端解析，不送第三方 AI。
- 參數只建議「日誌快照或匯入參數檔中實際存在」且「韌體版本在目錄範圍內」者；不同飛控目錄名稱互不重疊（測試確認）。
- 建議值一律為目前值 ±10% 小步調整並夾在範圍內；明示「不是最佳參數」。
- 振動 / 動力 / 電池 / 遙控任一 FAIL 或日誌損毀 > 5% → BLOCKED，不給任何方案。
- 匯出前再次檢查：教師審核狀態、參數屬於該生態目錄、版本、範圍；並附備份與不得改動資源映射 / 接收機 / 失控保護的提醒。
- 「其他飛控」只能建檔，上傳日誌會被拒絕。
- 正式模式只認 Gateway Assertion；開發身分標頭 `X-PidLab-Dev-Identity` 只在 Live 開發模式生效（測試確認正式模式回 401）。

## 4. 八大健康指標與評分規則

指標：動力系統、電池、GPS 定位、導航系統、振動、遙控與通信、姿態控制、飛行模式與控制狀態。
狀態：PASS / WARN / FAIL / N/A / INSUFFICIENT，每項顯示依據、資料來源欄位、覆蓋率、可信度、限制。

評分（原系統無數值權重，本次補充並公開於報告頁）：PASS=100、WARN=60、FAIL=20，八項等權；N/A 不計入；INSUFFICIENT 不計分但降低覆蓋率；覆蓋率 < 75% 標示「不可與其他飛行比較或排名」。
- Betaflight 無 GPS → GPS、導航為 N/A（不扣分）。
- 沒有電池資料 → INSUFFICIENT（不視為正常）。
- 閾值：ArduPilot VIBE 採官方建議（30 / 60 m/s²、削波 0）；其餘為「FDE 教學閾值（DERIVED，待驗證）」並在每張卡標示。

## 5. GitHub 開源參考清單

| 專案 | URL | 授權 | 用途 / 結論 |
|---|---|---|---|
| Betaflight blackbox-tools | github.com/betaflight/blackbox-tools | GPL-3.0 | 參考公開的 Blackbox 格式；**未複製程式碼**；官方解碼器只有舊版 exe，未下載執行 |
| Betaflight blackbox-log-viewer | github.com/betaflight/blackbox-log-viewer | GPL-3.0 | 參考 gyro 單位與 rates 定義；未複製程式碼 |
| orangebox | github.com/atomgomba/orangebox | GPL-3.0 | Python Blackbox 解析器；因 GPL 不引入 |
| Plasmatree PID-Analyzer | github.com/Plasmatree/PID-Analyzer | 未明示（NOASSERTION） | 參考 Wiener 反卷積階躍響應方法（公開訊號處理方法，自行實作）；其 2 份公開 Blackbox 日誌僅作本機測試樣本，**授權不明，不提交入庫** |
| PIDtoolbox | github.com/bw1129/PIDtoolbox | — | 同類方法參考（階躍響應、頻譜）；未複製 |
| ArduPilot | github.com/ArduPilot/ardupilot | GPL-3.0 | DataFlash 自描述格式（FMT）、ATC_RAT_* / RATE_* 參數命名、VIBE 判讀建議 |
| pymavlink | github.com/ArduPilot/pymavlink | LGPL-3.0 | 可用但為減少依賴與授權複雜度，自行實作 DataFlash 解析 |
| ArduPilot MethodicConfigurator | github.com/ArduPilot/MethodicConfigurator | GPL-3.0 | 其 Tarot X4 範本中的真機 BIN（含 IMU 批次取樣）作為本機測試樣本；未提交 |
| Mission Planner | github.com/ArduPilot/MissionPlanner | GPL-3.0 | 只參考 .param 匯出格式 |
| PX4-Autopilot | github.com/PX4/PX4-Autopilot | BSD-3-Clause | ULog 主題（vehicle_angular_velocity、vehicle_rates_setpoint…）、MC_*RATE_*、IMU_GYRO_* 參數、ver_sw_release 編碼 |
| pyulog | github.com/PX4/pyulog | BSD-3-Clause | 參考 ULog 格式；其測試樣本 `sample_px4_events.ulg`（BSD）用於測試 |
| PX4 Flight Review | github.com/PX4/flight_review | BSD-3-Clause | 參考分析項目；公開日誌庫 API 重新導向，未取得樣本 |

結論：沒有把任何名稱含 AI / AutoTune 的專案當成可靠自動調參系統；所有正式演算法為自行實作、可追溯版本。

## 6. 測試結果

### 6.1 自動化測試
- 實驗室：`python _run_unittests.py test_pid_filter_lab` → **40 / 40 通過**（真實樣本解析、損毀 / 空 / 截斷 / 格式不符、權限隔離、上傳安全、教師審核流程、匯出拒絕、參數不混用、BLOCKED、比較規則、正式模式身分、主程式掛載）。
- 原有 Live 後端回歸：621 項中 29 項失敗；**在原始基線 846ee80 上同樣 29 項失敗、清單完全相同** → 本次修改沒有新增任何失敗。
- 前端 Node 測試 11 個檔案：10 個通過；`homepage-portal-entry.test.cjs` 失敗，但在基線 846ee80 上同樣失敗（首頁未改動）。

### 6.2 真實日誌解析
| 樣本 | 結果 |
|---|---|
| Betaflight 3.1.5 `stock_tune.BFL`（14 段） | 52 萬框、0 損毀、正常結束；setpoint 與 gyro 相關係數 > 0.95 |
| Betaflight 3.1.5 `good_tune.BBL` | 15.4 萬框，1.1% 損毀（檔尾截斷），已重新同步並警示 |
| ArduCopter 4.5.7 F450 真實飛行 BIN | 版本、板型 fmuv3、1059 參數、八大指標全部可評估 |
| ArduCopter 4.5.7 / 4.8.0-dev 其他 BIN | 解析成功；地面 / 台架日誌被正確判為「實際角速度≈0」而不給結論 |
| 2 份損毀 BIN（1 MB / 7.6 MB） | 正確回報無法解析 |
| 學員 F450 真實日誌（桌面「2026AI無人載具文件」：log_484 10/15、log_495 / 496 10/18、log_498 11/1） | 全部解析成功；484 長航 22 分鐘電池 WARN；495 GPS 衛星數偏少 WARN；496 全部 PASS（落地後搬動機體不誤判為翻覆）；498 偵測推力不足 + 墜機 + 電池失控保護 → FAIL 並 BLOCKED；482（=f450_flight_4.5.7）偵測墜機 → BLOCKED |
| ArduCopter 4.5.5 Tarot X4 / Pixhawk6X 真機飛行（ArduPilot MethodicConfigurator 範本日誌，GPL-3.0，僅本機測試、不提交） | 八大指標 8/8 可評估；IMU 批次取樣 221 批 × 1024 點、2025 Hz，自動區分濾波前（instance 0）/ 後（instance 3） |
| PX4 `sample_log_small.ulg`（CubeOrange） | 識別 PX4 1.11.2、980 參數、八大指標 7 項可評估 |
| PX4 `sample.ulg`（AUAV_X21 舊版） | 無 ver_sw_release → 版本標「unknown」，不捏造 |
| PX4 `sample_px4_events.ulg` | 識別 PX4 1.15.0 SITL |

說明：官方 Betaflight 解碼器未做逐值交叉比對（不下載執行舊版 exe），改以時間單調、損毀率、setpoint–gyro 相關性做內部一致性驗證。

### 6.3 PID 分析
- Betaflight：`stock_tune`（原廠參數）偵測到 Roll 過衝 83.8%、Pitch 55.1% → 產生 D +10% 的 REVIEW 建議；`good_tune`（已調好）判為合理範圍、無 REVIEW。**與樣本作者標示的「原廠 vs 調好」一致**，屬一次真實交叉驗證。
- ArduPilot：現有真實樣本 RATE 記錄只有 10 Hz → 內環、階躍一律 INSUFFICIENT 並提示提高記錄頻率；姿態外環可評估。
- ArduPilot 濾波（2026-11-04 追加）：新增 ISBH/ISBD 批次取樣解析。Tarot X4 真機日誌顯示濾波前主峰 67.2 Hz、濾波後基頻約 33.6 Hz，與 `INS_HNTCH_FREQ=35` 的諧波一致；濾波實測衰減 20–80 Hz 約 -30～-33 dB、80–200 Hz 約 -35 dB。產生 INFO 級「諧波陷波設定與實測頻譜對照」，不自動給頻率數值。
- 安全事件（2026-11-04 依學員 F450 日誌追加）：加入 ArduCopter ERR 子系統對照（CRASH_CHECK、THRUST_LOSS_CHECK、各類 FAILSAFE…）；未解除的墜機 / 推力不足 / 失控保護 → 飛行模式指標 FAIL，調參建議 BLOCKED。姿態外環排除「飛行中 |角度| > 80°」的翻覆段（前後各 1 秒）並單獨列出，避免墜機片段把 RMS 拉高（log_482：18.0° → 2.3°；log_498：10.0° → 3.4° / 5.6°）。
- 同時修正 DataFlash 解析器 bug：`a`（int16[32]）欄位原本會讓後續欄位索引錯位（先前樣本未用到陣列欄位，因此未暴露）。
- PX4：現有樣本皆為台架 / SITL / VTOL，沒有可用的多旋翼操控段 → PID 分析 INSUFFICIENT。

### 6.4 教師審核、匯出、前後比較（真實頁面操作）
- 學員選建議送審 → 教師（同班）核准並填意見 → 匯出 Betaflight CLI（含 `diff all` 備份提醒與原值註解）。
- 他班教師 404、學員不得審核 403、未審核不得匯出 409、超出範圍的教師改值 400（測試確認）。
- 前後比較示範：以兩份不同的公開日誌（stock → good_tune）當 BASELINE / AFTER，結果 **WORSE**，並列出記錄頻率、操控量不一致等限制。這只驗證比較流程，**不是本系統調參方案的實際複測**。
- 標準參數庫：無 IMPROVED 前後比較時拒絕標記 APPROVED（測試確認）。

### 6.5 截圖（`docs/pid-lab-acceptance/screenshots/`，全部來自真實執行中的頁面）
本機隔離開發伺服器（127.0.0.1:8191，開發模式、獨立資料夾），以無頭 Edge 透過 DevTools 協定實際點擊、填表、經檔案選擇框上傳真實日誌後截圖；腳本見 `tools/`。開發模式的身分由下拉選單模擬，頁面上有明確標示。

| 要求 | 檔案 |
|---|---|
| 01 飛控選擇 | `01_飛控選擇.png` |
| 02 其他飛控填寫 | `02_其他飛控填寫.png` |
| 03 Betaflight 上傳 | `03_Betaflight日誌上傳.png` |
| 04 ArduPilot 上傳 | `04_ArduPilot日誌上傳.png` |
| 05 八大健康評分 | `05_八大健康評分.png`、`05b_ArduPilot八大健康評分.png`、`15_PX4八大健康評分.png` |
| 06 Betaflight PID | `06_Betaflight_PID分析.png` |
| 07 ArduPilot PID | `07_ArduPilot_PID分析.png` |
| 08 AI 調參建議 | `08_AI調參建議.png` |
| 09 教師審核 | `09_教師審核.png`、`09b_參數匯出.png` |
| 10 調參前後對比 | `10_調參前後對比.png` |
| 11 學生報告 | `11_學生報告.png` |
| 12 移動端 | `12_移動端頁面.png`、`12b_移動端飛控選擇.png`（375 px，無橫向捲動） |
| ArduPilot 濾波（追加） | `18_ArduPilot濾波批次取樣分析.png`、`19_ArduPilot陷波建議.png` |
| F450 墜機日誌（追加） | `20_F450墜機日誌健康報告.png`、`21_F450墜機日誌停止調參.png` |
| 補充 | `00_首頁側欄入口.png`、`13_FlightHealth飛控選擇_PX4.png`、`14_PX4日誌上傳.png`、`16_PX4_PID分析.png`、`17_GitHubPages靜態離線狀態.png` |

## 7. 驗收狀態（嚴格區分）

### 已實作並通過真實測試
- 三種日誌格式內容識別與解析（Betaflight 3.1.5、ArduCopter 4.5.7 / 4.8-dev、PX4 1.11 / 1.15 / 舊版）
- 韌體版本、板型識別；無法識別時標 unknown
- 統一八大健康指標與評分框架（三生態皆有真實樣本截圖）
- Betaflight PID 分析（階躍響應、過衝、延遲、追蹤誤差、頻譜）與調參建議（與樣本標示一致）
- 教師審核、Betaflight CLI 匯出、權限隔離、上傳安全、錯誤 / 損毀日誌處理
- 左側欄入口、Flight Health 飛控選擇、桌面與移動端顯示、靜態站離線狀態
- ArduPilot IMU 批次取樣濾波前後頻譜、濾波實測衰減、諧波陷波設定對照（Tarot X4 真機日誌）

### 已實作但尚未以真實資料驗證
- Betaflight 4.x（setpoint、FF、gyroUnfilt、新濾波參數名）— 缺 4.x 真實日誌
- ArduPilot 高頻（≥ 50 Hz RATE / IMU 批次取樣）PID 與濾波分析、ArduPilot `.param` 匯出 — 缺高頻真實日誌
- **PX4**：PID 與濾波分析、建議、QGC `.params` 匯出 — 缺真實多旋翼飛行日誌；**PX4 不得宣稱完整支援**
- 舊版 APM（ArduCopter < 3.4，RATE_* 參數）— 僅有規則與單元測試，**無真實 APM 日誌**
- AutoTune 偵測（ArduPilot ATUN / 模式、PX4 autotune 主題）— 樣本中不存在
- 調參前後比較：流程已真實執行，但沒有「依本系統方案實際複飛」的成對日誌
- 八大指標中 FDE 教學閾值（DERIVED）尚待機隊資料校正

### 僅完成介面或模擬測試
- 規則邏輯單元測試使用明確標示的合成資料（BLOCKED、N/A、比較判定）
- 開發模式身分切換（正式環境由 Django 登入與 Gateway Assertion 提供）

### 尚未開發
- 既有課程系統（Django 課程 / 任務卡）中嵌入實訓入口：為避免改動既有課程，本次只在實驗室內提供 L1–L3 課程說明，**未修改課程資料**
- 四組種子教師實訓的資料（需教師以真實 2.5 寸教學機執行）
- Windows 本地連接助手、MSP / MAVLink 自動寫入（依任務書僅預留，未實作）
- 大型語言模型解釋：目前為規則模板中文解釋；接入 LLM 需教師授權
- PDF：使用瀏覽器列印另存 PDF，未開發伺服器端 PDF

## 8. 風險
1. 樣本授權：Plasmatree 日誌授權不明，只存於 `D:\FDE-AI-Runtime\pidlab-samples`，未提交。
2. Blackbox 解碼器未與官方工具逐值比對。
3. 上傳透過 Gateway 時，Gateway 會把整個請求本文讀入記憶體計算雜湊；64 MB 上限下記憶體可接受，但需在正式環境觀察。
4. 分析在 Live 程序內單一背景執行緒進行；8 kHz 長日誌約需 40 秒，同時多人上傳會排隊。
5. 正式環境需設定 `FDE_PID_LAB_ROOT`（預設在 Live store 旁的 `pid-lab/`）。

## 9. GitHub 與部署
- 已提交至本機分支 `feature/pid-filter-lab`；推送結果與 PR 狀態見最終回報。
- `gh` CLI 未登入，無法自動建立 PR。
- **未部署預覽、未上線**；未修改正式資料庫、DNS、Gateway。
