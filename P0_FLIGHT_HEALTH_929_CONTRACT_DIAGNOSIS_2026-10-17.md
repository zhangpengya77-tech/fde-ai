# P0｜Flight Health AI 八張健康卡「判定內容與數據綁定」查證報告

日期：2026-10-17
範圍：`D:\FDE-AI-UAS-v2.0\flight-health\`（沙箱）＋ `D:\FDE-Flight-Health-AI\`（教師正式診斷主機，唯讀）
基準日誌：教師 9/29 真實 DataFlash 日誌 `log_452_2026-9-29-20-38-08.bin`

> 本輪依教師指令「先查證、不要直接改判定閾值」執行。
> **未修改任何判定規則、閾值、正式資料庫、正式服務或原始 BIN。**
> flight-health 原始碼在本輪進行中有其他代理並行修改（見 §9），因此本輪**未改動** `flight-health/js/app.js`、`reference_server.py`、`builtin_rule_engine.py`。

---

## 1. 摘要（先講結論）

1. **`undefined` 已不存在於現行版本**，但仍可在**特定部署組合**下重現「卡片有顯示、內容卻是空白」。
   - 舊截圖 `demo/runtime/logs/fh_fix_stage2_report.png`（2026-10-16 19:39）是 **2026-10-16 20:25 修復前**的產物：當時八卡契約缺 `next_action` → `👉 undefined`；且 `CARD_DEFS` 只有 4 張卡 → 03/05/06/07 空白。**該問題已於 20:25 修復，本輪用真實 9/29 日誌重新實測：8/8 卡片渲染、`undefined=0`、空白=0。**
2. **真正的 P0 是卡片 ID 契約不一致**：教師正式後端與沙箱後端對同一張卡使用不同 `card_id`，而沙箱前端只認自己那一套 → 只要前端連到教師正式後端，**03 定位健康／05 遙控信號／06 飛行模式／07 高度控制 四張卡完全空白**（已用真實日誌 100% 重現，見 §7）。
3. **沙箱內建規則引擎與教師正式引擎，對同一份 9/29 真實日誌給出 6/8 不一致的判定**（見 §5 核對表）。其中兩項是**語意錯誤**（無規則卻報「通過」），兩項是**規則缺口**（缺事件型規則），兩項是**閾值/演算法問題**。
4. 依教師指令，**上述規則問題全部列為待批准清單（§8），本輪不自行修改**。

---

## 2. 檔案身分核對（可追溯）

| 項目 | 值 |
|---|---|
| 實際路徑 | `D:\FDE-Flight-Health-AI\sample_logs\ardupilot\log_452_2026-9-29-20-38-08.bin` |
| 大小 | 1,631,197 bytes |
| SHA-256 | `e5ef768b6033a72b2acc523e7ea3e490f4b647f8cc7df2c849f79acc5a2a9d7a` |
| 檔頭 | `a3 95 80 80` → DataFlash sync `0xA3 0x95` + FMT type `0x80`（ArduPilot DataFlash 二進位） |
| 與先前紀錄比對 | ✅ 檔名、大小、SHA-256 與 2026-10-16 紀錄完全一致（同一份檔案） |

> 本輪所有驗證皆使用此真實檔案；**未使用 `gen_sample_bin.py` 產生的自製樣本**。
> （注意：`demo/tools/fh_real_screenshot.cjs` 名為 "real"，實際注入的是 `sample_flight_healthy.bin` 自製樣本，**不可作為 9/29 真實日誌驗收證據**。）

---

## 3. 解析器輸出與 API 回應結構

### 3.1 沙箱內建引擎（`builtin_rule_engine.parse_bin_log`）
- 解析結果：**42,110 筆**飛控訊息（真實 DataFlash FMT 自描述解析）。
- 有正確抓到：`BAT`、`GPS`、`RCOU`、`RCIN`、`ATT`、`MODE`、`BARO`、`CTUN`、`VIBE`。
- 解析器本身**沒有** 0 筆問題（2026-10-16 對齊真實幀結構後已修復）。

### 3.2 教師正式引擎（`D:\FDE-Flight-Health-AI`，pymavlink DFReader）
- 觸發 4 條規則：
  | rule_id | category | severity | finding |
  |---|---|---|---|
  | `MOT-001` | MOTOR | inspect | 四路 Motor Command 明顯不均衡（非真實轉速） |
  | `MODE-EVENT-001` | MODE | attention | 飛控曾拒絕一次飛行模式切換（如油門過高） |
  | `FAILSAFE-001` | FAILSAFE | inspect | 遙控鏈路曾中斷，觸發失控保護，約 3.1 秒後恢復 |
  | `NAV-EVENT-001` | GPS | inspect | 定位相關數據異常並觸發告警，約 9.5 秒後恢復 |
- `student_view.safety_alerts`：3 筆（模式切換失敗 20.572s／遙控中斷 58.407–61.502s（3.095s）／GPS·羅盤 110.053–119.505s（9.452s））
- `overall_status = inspect`

### 3.3 API JSON 契約差異

| 欄位 | 教師正式 `student_view` | 沙箱 `student_view` |
|---|---|---|
| `overall_status` / `display_status` / `main_finding` / `next_action` | ✅ | ✅ |
| `health_cards[]` | ✅ | ✅ |
| 每卡 `card_id` / `title` / `status` / `display_status` / `main_finding` / `next_action` | ✅ | ✅ |
| **`safety_alerts[]`** | ✅ 有 | ❌ **缺**（`_student_view_from_analysis` 未輸出） |
| 每卡 `rule_id` | ✗（在 teacher_view） | ✅ |
| 每卡 `missing_reason`（僅 unknown） | ✗ | ✅ |

> **契約缺陷 A**：沙箱 `student_view` 缺 `safety_alerts`。前端 `renderSafetyAlerts(sv.safety_alerts || [])` 會整塊隱藏 → 沙箱模式下**學員完全看不到真實安全事件**（GPS 異常 9.452s、失控保護 3.095s、模式切換失敗）。

---

## 4. 八卡 ID / 名稱 / 欄位對照

| # | 卡片名稱 | 教師正式後端 `card_id` | 沙箱後端 `card_id` | 前端 DOM id | 沙箱前端 `cardIdMap`（現行） |
|---|---|---|---|---|---|
| 01 | 動力健康 | `propulsion` | `propulsion` | `propulsion-card` | ✅ |
| 02 | 電池健康 | `battery` | `battery` | `battery-card` | ✅ |
| 03 | 定位健康 | **`positioning`** | **`gps`** | `gps-card` | ❌ 只認 `gps` |
| 04 | 姿態穩定 | `stability` | `stability` | `stability-card` | ✅ |
| 05 | 遙控信號 | **`rc_signal`** | **`rc-signal`** | `rc-signal-card` | ❌ 只認 `rc-signal` |
| 06 | 飛行模式 | **`flight_mode`** | **`flight-mode`** | `flight-mode-card` | ❌ 只認 `flight-mode` |
| 07 | 高度控制 | **`altitude_control`** | **`altitude`** | `altitude-card` | ❌ 只認 `altitude` |
| 08 | 飛控傳感器 | `sensors` | `sensors` | `sensors-card` | ✅ |

- 教師正式**前端**（`D:\FDE-Flight-Health-AI\frontend\js\app.js` 的 `cardTargets`）使用 `positioning / rc_signal / flight_mode / altitude_control` → 與教師正式後端**自洽**。
- 沙箱**前端**目前只認 `gps / rc-signal / flight-mode / altitude` → 與沙箱後端**自洽**，但**與教師正式後端不相容**。
- 沙箱 `flight-health/js/config.js` 對 loopback／LAN 一律指向 `:8040`，而教師正式主機正是部署在 `:8040` → **這兩套必須互通，因此這是真實契約缺陷，不是理論問題。**

---

## 5. 八卡核對表（9/29 真實日誌）

| # | 卡片 | 先前分析紀錄 | 教師正式引擎（pymavlink） | 沙箱內建引擎（v2.0） | 一致？ |
|---|---|---|---|---|---|
| 01 | 動力健康 | 🟠 需要檢查 | 🟠 ABNORMAL 需要檢查（MOT-001） | 🟠 inspect 需要檢查（MOT-01） | ✅ |
| 02 | 電池健康 | 🟢 正常 | 🟢 NORMAL 正常 | 🟠 inspect 需要檢查（BAT-01，最低 11.05V） | ❌ |
| 03 | 定位健康 | 🟠 需要檢查（GPS 9.452s） | 🟠 ABNORMAL 需要檢查（NAV-EVENT-001） | 🟢 normal 通過（GPS-01） | ❌ |
| 04 | 姿態穩定 | ⚪ 未評估 | 🟢 NORMAL 正常 | 🔴 danger 危險（ATT-01，45.7°） | ❌ |
| 05 | 遙控信號 | 🟠 需要檢查（Radio Failsafe 3.095s） | 🟢 NORMAL 正常（事件只出現在 safety_alerts） | 🟢 normal 通過（RC-01） | ❌ |
| 06 | 飛行模式 | 🟡 注意（Mode change failed 20.572s） | 🟠 ABNORMAL 需要檢查（MODE-EVENT-001） | 🟢 normal 通過（MODE-01） | ❌ |
| 07 | 高度控制 | —（先前未涵蓋） | ⚪ INSUFFICIENT_DATA 未評估 | 🟢 normal 通過（ALT-01） | ❌ |
| 08 | 飛控傳感器 | —（先前未涵蓋） | ⚪ INSUFFICIENT_DATA 未評估 | 🟢 normal 通過（VIB-01） | ❌ |

### 沙箱引擎各卡實測證據（教師層查核用）

| # | rule_id | 狀態 | 實測證據 |
|---|---|---|---|
| 01 | MOT-01 | inspect | `channel_avg` C1≈1606.6 / C2≈1312.0 / C3≈1281.3 / C4≈1639.4，`spread=358.1`（門檻 200） |
| 02 | BAT-01 | inspect | `volt_min=11.051`、`volt_max=11.196`、`pct_min=99.0`（門檻 `vol_min_inspect_v=13.5`） |
| 03 | GPS-01 | normal | `sats_min=12`、`hdop_max=1.43` |
| 04 | ATT-01 | danger | `att_err_max_deg=45.7`（門檻 danger 25.0） |
| 05 | RC-01 | normal | `channel_range` C1 1440–1501、C2 1503、C3 1000–2000、C4 1005–1995 |
| 06 | MODE-01 | normal | `mode_records=32`、`distinct_modes=[0,2,5,6]` |
| 07 | ALT-01 | normal | `baro_median_m=-0.15`、`ctun_median_m=-0.02`、`cross_diff_m=0.13` |
| 08 | VIB-01 | normal | `vibe_peak_max=1.842`、`clip_count=0` |

### 差異原因（逐項）

- **02 電池**：沙箱門檻 `vol_min_inspect_v = 13.5`。3S 電池標稱 11.1V、滿電 12.6V，11.05V 對 3S 是正常放電電壓；用 13.5V 會把**幾乎所有 3S 日誌**判成「需要檢查」。教師正式引擎判 NORMAL。
- **03 定位**：沙箱只看衛星數（12 顆、HDOP 1.43 → 通過）；**沒有事件型規則**，抓不到真實發生的 GPS/羅盤告警（110.053–119.505s，9.452s）。教師正式引擎依 `NAV-EVENT-001` 判 ABNORMAL。
- **04 姿態穩定**：沙箱 `_rule_attitude` 對 `Roll/Pitch/**Yaw**` 一律 `abs(實際-期望)` 取最大。Yaw 為 ±180° 環繞量，直接相減會產生**假誤差 45.7°** → 誤報「危險」。教師正式引擎判 NORMAL。
- **05 遙控信號**：沙箱只檢查 RCIN PWM 是否落在 900–2100 帶內（全部落在帶內 → 通過）；抓不到 `FAILSAFE-001`（遙控中斷 58.407–61.502s）。注意：教師正式引擎的**卡片**也判 NORMAL，事件只出現在 `safety_alerts` → **卡片與安全提醒在正式系統內亦不一致**，需教師確認卡片是否應反映已恢復的失控保護。
- **06 飛行模式**：沙箱只檢查模式編號是否落在 0–30（32 筆、4 種模式 → 通過）；抓不到 `MODE-EVENT-001`（模式切換被拒絕 20.572s）。
- **07 高度控制**：沙箱用 `BARO` 與 `CTUN` 中位數交叉核對（差 0.13m → 通過）。教師正式引擎刻意把 `altitude` 領域設為 `DOMAIN_CATEGORIES["altitude"] = set()`、`available=False` → **恆為 INSUFFICIENT_DATA（未評估）**，理由是「目前沒有可靠的定高規則」。
- **08 飛控傳感器**：沙箱用 `VIBE` 峰值（1.842 → 通過）。教師正式引擎把第 08 卡對應 `ekf` 領域（無可靠規則）→ 未評估；且把震動歸入**第 04 卡**（`stability = attitude + vibration`）。

---

## 6. `undefined` 與「數據缺失」的真正來源

| 現象 | 來源 | 現況 |
|---|---|---|
| `👉 undefined` | 舊版 `builtin_rule_engine._card()` 未輸出 `next_action`，前端 `renderCardFromBackend` 直接輸出 `card.next_action` | **已修**（現行 `CARD_CONTRACT` 每卡都有 `next_action`；實測 undefined=0） |
| 03/05/06/07 卡片空白 | 舊版 `CARD_DEFS` 只有 4 張卡（propulsion/battery/stability/sensors），後端根本沒有那 4 張卡的資料 | 沙箱後端**已修**（8 張卡）；但**換成前端 card_id 契約不符時會再度空白**（§7） |
| 「數據缺失，無法判斷」 | `analyze()` 在 `parse_bin_log` 回 0 筆時，八卡全部輸出 `"数据缺失，无法判断。"` | 解析器已修（現可解析 42,110 筆）；此文案目前**不會**出現在 9/29 日誌 |

**結論**：截圖中的 `undefined`／空白／資料缺失，是 **2026-10-16 20:25 之前**的狀態，現行版本已修復。
但 §7 顯示**同一個症狀在「前端連教師正式後端」時仍會 100% 重現**，這才是目前仍待處理的 P0。

---

## 7. 可重現缺陷：沙箱前端 × 教師正式後端 → 4 張卡全空白

**重現方式**（本輪已實測）：沙箱前端（`flight-health/index.html`）→ API 指向教師正式後端（本機以 `:8051` 起 `backend.app.main:app`）→ 注入 9/29 真實日誌 → 分析。

**實測結果**（`demo/runtime/logs/fh_929_verify_PROD_ENGINE.json`）：

```
propulsion-card    rendered=true   undefined=false
battery-card       rendered=true   undefined=false
gps-card           rendered=FALSE  ← 空白（後端 card_id = positioning）
stability-card     rendered=true   undefined=false
rc-signal-card     rendered=FALSE  ← 空白（後端 card_id = rc_signal）
flight-mode-card   rendered=FALSE  ← 空白（後端 card_id = flight_mode）
altitude-card      rendered=FALSE  ← 空白（後端 card_id = altitude_control）
sensors-card       rendered=true   undefined=false
summary: cards=8 | undefined=false | empty=4
```

截圖證據：`demo/runtime/logs/fh_929_report_PROD_ENGINE.png`
（畫面同時出現「本次飛行安全提醒」3 筆真實事件，但 05 遙控信號、06 飛行模式兩張卡卻是空白——學員看得到警報卻看不到對應卡片。）

**根因**：`flight-health/js/app.js` 的 `cardIdMap`（現行版本，2026-10-17 07:44:55 修改）**只保留 8 個沙箱 card_id，明確移除了 `positioning / rc_signal / flight_mode / altitude_control` 別名**，遇到未知 id 僅 `console.warn` 後靜默略過。

**建議修法（待批准，本輪未動）**：二選一
- **(A) 前端容忍雙命名**（改動最小、不動正式服務）：`cardIdMap` 恢復別名，或加入 `canonicalCardId()` 正規化函式，把 `positioning→gps`、`rc_signal→rc-signal`、`flight_mode→flight-mode`、`altitude_control→altitude`。
- **(B) 統一命名來源**：改由後端只輸出一套 id。但教師正式主機在「不可修改正式服務」範圍內 → 只能改沙箱後端，無法解決連正式後端的情況。
→ 在「不可修改正式服務」前提下，**必須採 (A)**。

**附帶缺陷 B**：沙箱 `_student_view_from_analysis` 未輸出 `safety_alerts`（§3.3 契約缺陷 A）→ 沙箱模式下安全提醒整塊消失。
**附帶缺陷 C**：`flight-health/js/app.js::renderGrowthCard()` 仍硬編碼「主要問題：動力輸出不均衡（某一側持續偏高）」與 `|| "主客觀高度一致"` 等文案，對健康日誌會**謊報**（違反同檔 1155 行自訂的「嚴禁硬編碼故障故事」）。

---

## 8. 規則缺口／閾值問題（**待教師批准，本輪未修改**）

| # | 項目 | 規則原文 | 原始證據 | 建議變更 | 風險 |
|---|---|---|---|---|---|
| R1 | 電池電壓門檻 | `SAFETY_THRESHOLDS["battery"]["vol_min_inspect_v"] = 13.5` | `volt_min=11.051V`、`pct_min=99%`（BAT） | 需先確認**電池節數**。若為 3S：門檻應對齊節數（如 3S≈10.5V 危險／10.8–11.0V 檢查），或改用單節電壓判定 | 若實際為 4S，11.05V 確實偏低，降門檻會漏報 |
| R2 | 姿態跟蹤誤差 | `_rule_attitude` 對 `Roll/Pitch/Yaw` 一律 `abs(實際-期望)` 取最大；`err_danger_deg=25.0` | `att_err_max_deg=45.7`（疑似 Yaw ±180° 環繞造成） | Yaw 需先做 ±180° 環繞正規化，或將 Yaw 排除於角度誤差判定 | 若排除 Yaw，可能掩蓋真實偏航跟隨問題 |
| R3 | 事件型規則缺漏 | 沙箱引擎**無** GPS Glitch／Compass Error、Mode change failed、Radio Failsafe 規則 | 教師正式引擎於同日誌觸發 `NAV-EVENT-001`(9.5s)、`MODE-EVENT-001`(20.572s)、`FAILSAFE-001`(3.095s) | 移植三條事件規則，並輸出 `safety_alerts` | 新增規則面；需教師逐條確認門檻與文案 |
| R4 | 高度控制卡語意 | 沙箱 `_rule_altitude` 以 BARO/CTUN 中位數差判定，`cross_check_max_inspect_m=3.0` | `cross_diff_m=0.13` → 判「通過」 | 教師正式引擎認為「無可靠規則」→ 恆未評估。建議對齊為**未評估**，待規則經驗證後才可判正常 | 會把一張綠卡改為灰卡（但符合教師「沒有判定規則 ≠ 正常」原則） |
| R5 | 傳感器卡歸屬 | 沙箱第 08 卡 = `VIBE` 峰值；教師正式第 08 卡 = `ekf` 領域（無規則） | `vibe_peak_max=1.842` → 判「通過」 | 建議：震動歸第 04 卡（與正式一致），第 08 卡改為未評估；或教師批准獨立的震動規則 | 會把一張綠卡改為灰卡，並移動震動結論 |

> 依教師指令：「如需修改既有判定規則或閾值，先列出規則原文、原始證據、建議變更及風險，等待教師批准；不得自行更改。」
> 以上五項**均未修改**。

---

## 9. ⚠️ 並行編輯警告（依教師指令第七節「避免覆蓋他人變更」）

本輪進行中偵測到 `flight-health/` 有其他代理正在修改：

| 檔案 | mtime | 觀察 |
|---|---|---|
| `flight-health/js/app.js` | 2026-10-17 **07:44:55** | 本輪 07:41 讀到時 `cardIdMap` **含雙命名別名**；07:52 再讀時**別名已被移除**，改為 `console.warn` 未知 id |
| `flight-health/reference_server.py` | 2026-10-17 **07:48:03** | 新增「解析失敗時輸出八卡全 unknown + missing_reason」的處理 |
| `flight-health/index.html` | 2026-10-17 07:43:15 | script 版本號更新為 `?v=20261017` |

→ **本輪因此未改動任何 flight-health 原始碼**，僅新增唯讀驗收腳本與本報告。
→ 已於 `D:\FDE-AI-UAS-v2.0\.test-temp\fh-snapshot-075508\` 留存快照供比對。

---

## 10. 驗收測試結果（本輪）

| 類別 | 方式 | 結果 |
|---|---|---|
| A. 真實日誌身分 | SHA-256 + 檔頭核對 | ✅ 與紀錄一致（`e5ef768b…`、1,631,197B） |
| B. 真實 BIN 解析 | 沙箱引擎 | ✅ 42,110 筆訊息（非 0 筆） |
| C. 真實 BIN 解析 | 教師正式引擎（pymavlink，唯讀） | ✅ 4 條規則 + 3 筆安全事件 |
| D. 八卡數據映射（沙箱前端 × 沙箱後端） | 瀏覽器端到端（真實日誌） | ✅ 8/8 渲染、`undefined=0`、空白=0、資料缺失=0 |
| E. 八卡數據映射（沙箱前端 × 教師正式後端） | 瀏覽器端到端（真實日誌） | ❌ **4/8 空白** → 契約缺陷重現 |
| F. 判定規則比對 | 三方（先前紀錄／正式引擎／沙箱引擎） | ⚠️ 6/8 不一致（見 §5） |
| G. 安全事件呈現 | 沙箱 `student_view` | ❌ 缺 `safety_alerts` 欄位 |

**產出檔案**
- `demo/runtime/logs/fh_929_verify_SANDBOX_ENGINE.json` / `fh_929_report_SANDBOX_ENGINE.png`
- `demo/runtime/logs/fh_929_verify_PROD_ENGINE.json` / `fh_929_report_PROD_ENGINE.png`
- `demo/tools/fh_real_929_verify.cjs`（**新增**唯讀驗收腳本；只讀真實日誌，不改任何服務）

**未執行**：未跑 Django／Node 既有回歸套件（本輪未改動其涵蓋之原始碼）；未 commit／push／merge／deploy。

> 補充：為驗證「沙箱前端 × 教師正式後端」，本輪曾在本機臨時啟動教師正式後端（`:8051`，唯讀載入）。該後端在 `data/flights/` 下產生 2 個臨時 session 目錄（`aea2adfb…`、`cd092ce0…`），已於驗證後**刪除**；`D:\FDE-Flight-Health-AI` 的原始碼、規則、模型、原始 BIN 均未被修改（該 repo 既有的 `M`/`??` 變更為先前既有工作，非本輪產生）。

---

## 11. 未解決項目與待決策（給教師）

1. **是否批准 §7 修法 (A)**：讓沙箱前端 `cardIdMap` 容忍教師正式後端的 `positioning / rc_signal / flight_mode / altitude_control` 四組命名？（這是目前唯一能修好「4 張卡空白」且不動正式服務的方法。）
2. **是否批准 R1–R5 規則變更**（§8）？特別是 R4/R5 會把兩張綠卡改為灰卡。
3. **卡片與安全提醒的一致性**：第 05 卡（遙控）與第 06 卡（模式）在正式引擎下判「正常／需要檢查」，但 `safety_alerts` 有對應事件——卡片是否應反映「已恢復」的安全事件？
4. **是否補 `safety_alerts` 到沙箱 `student_view`**（附帶缺陷 B）？
5. **是否一併修掉 `renderGrowthCard()` 的硬編碼故障文案**（附帶缺陷 C）？
6. **並行編輯協調**：`flight-health/` 目前有另一個代理在改，請確認由誰主導，以免互相覆蓋。

## 12. 回復方式

本輪**未修改任何既有檔案**（僅新增腳本與報告），無需回復。
如需移除本輪產出：
```
del D:\FDE-AI-UAS-v2.0\demo\tools\fh_real_929_verify.cjs
del D:\FDE-AI-UAS-v2.0\demo\runtime\logs\fh_929_*
del D:\FDE-AI-UAS-v2.0\.test-temp\fh-snapshot-075508   (遞迴)
del D:\FDE-AI-UAS-v2.0\P0_FLIGHT_HEALTH_929_CONTRACT_DIAGNOSIS_2026-10-17.md
```
（本輪臨時啟動的教師正式後端 `:8051` 已於驗證後停止；其 `data/flights/` 臨時 session 已刪除；`D:\FDE-Flight-Health-AI` 原始碼／規則／模型／原始 BIN 全程未修改。）
