# FDE-AI 2.0｜P3-H 正式維護前最後差異核對報告

- **日期**：2026-10-28（第十九階段最終安全確認之後，正式維護窗口之前）
- **性質**：唯讀差異核對（read-only diff audit）。**未執行任何正式維護動作**。
- **授權狀態**：沿用第十九階段架構師裁決 —— 已批准 A/B/C/D 核驗，**未批准**正式部署、服務停止、重啟或接管。本輪嚴格遵守「禁止事項」。
- **執行身分**：本機 WorkBuddy 會話（非提升），與第十九階段同源隔離工作樹 `D:\FDE-AI-UAS-v2.0-p3h-local-backend`。

---

## 0. 執行紅線（本輪嚴格遵守）

| 禁止項目 | 本輪是否觸及 |
|---|---|
| 修改正式啟動器 / 排程 / 資料庫 / Tunnel | **否** |
| 停止 / 重啟 / 接管 8022 | **否** |
| Commit / Push / Merge / Deploy | **否** |
| 終止任何未知程序 | **否** |
| 修改 `MEMORY.md` / 每日日誌（本輪） | **否**（僅唯讀審查，見任務 B） |

本輪產出**唯一新增檔案**：本報告（位於 `docs/reports/`，屬交付物，非生產系統）。

---

## 1. 任務 A：補丁雜湊差異核對

### 1.1 patched-v3.ps1 當前雜湊 vs 前次記錄

| 項目 | 值 |
|---|---|
| 當前 SHA-256 | `bc57751349551959c9a7957039854d291a59800b3a16a42786dc9d805c5640d0` |
| 第十九階段補充報告記錄值 | `bc57751349551959…`（同前綴，全文一致） |
| 結論 | **完全一致 → 內容未變，非並行代理修改** |

### 1.2 PATCH-v3.diff 可重現性（關鍵發現）

`PATCH-v3.diff` 標頭為：
```
--- start_fde_v15c_classroom.original.ps1
+++ start_fde_v15c_classroom.patched-v3.ps1
```
即該 diff 聲稱可將 `original` 轉換為 `patched-v3`。

**實際核對（雙重驗證）：**

1. **`git apply --check PATCH-v3.diff` → 失敗**（`patch does not apply`，目標行 30 上下文不符）。
2. **直接內容比對（平衡括號感知提取）：**

| 來源 | `-HealthMarkers` 標記 |
|---|---|
| `PATCH-v3.diff` 內嵌 adoption 呼叫 | `'FDE-AI', 'csrfmiddlewaretoken', 'resend-verification'`（**三標記**） |
| `patched-v3.ps1` 實際 line 208 | `'FDE-AI', 'csrfmiddlewaretoken'`（**雙標記**，無 `resend-verification`） |
| `original` 基線 | 無 adoption 呼叫（NONE，證實 diff 新增此行） |

→ **PATCH-v3.diff 與當前 patched-v3.ps1 直接矛盾：diff 為三標記，檔案為雙標記。**

**結論**：`PATCH-v3.diff` 已**陳舊（stale）**，無法重現當前 `patched-v3.ps1`。該 diff 停留在 E4c 修正**之前**的版本；E4c 雙標記修正已直接落地於檔案本體，但未同步回 diff。

### 1.3 是否有未驗證的功能差異

- 實際 `patched-v3.ps1`（雙標記）已包含正確的 E4c 修正 → 正式 `/login/` 僅含 `FDE-AI` 與 `csrfmiddlewaretoken`，雙標記即成立，收養閘門（E1–E8）邏輯完備。
- diff 陳舊**不影響**檔案本體的正確性：檔案即將部署的實體，其邏輯已正確；diff 僅為歷史重建工件。
- **無任何未驗證的功能差異殘留**。剩餘差異僅為「diff 與檔案不同步」這一文件層面問題，不影響運行。

### 1.4 是否由並行代理修改

- 目錄 mtime 列舉顯示：`patched-v3.ps1` mtime `2026-10-28 06:30`，早於本輪核對時間；無近期（本輪期間）寫入。
- `patched-v3.ps1` 雜湊與第十九階段記錄值逐位元一致 → 自上次記錄後未被任何代理改動。
- 同目錄下另有 `patched-v3.isolation.ps1`（14020B，mtime 06:31）與 `patched-v2.ps1` 等，**均非部署標的**，不影響結論。
- **結論：無證據顯示並行代理修改了將部署的 patched-v3.ps1。**

### 1.5 任務 A 小結

| 子項 | 結果 |
|---|---|
| 當前雜湊 = 前次記錄 | ✅ 一致 |
| PATCH-v3.diff 可重現當前檔案 | ❌ 陳舊（三標記 vs 雙標記） |
| 並行代理修改 | ✅ 無證據 |
| 未驗證功能差異 | ✅ 無（E4c 修正已落地檔案本體） |

---

## 2. 任務 B：MEMORY.md 變更審查

### 2.1 修改前後 Diff

- 本輪**未對 `MEMORY.md` 做任何寫入**。其 mtime 為 `2026-10-28 08:12:07`，與第十九階段最終安全確認同批；本輪核對未改動。
- 依授權，本輪**不得再次修改或清理**。審查僅讀取。

### 2.2 是否涉及正式設定

- `MEMORY.md` 為本機專案記憶（跨會話摘要），**非**生產啟動器 / 排程 / 資料庫。內容記錄的 `D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1` 路徑與 SHA `a64330ef…` 為**唯讀參考**，未實際變更該正式檔。
- 結論：不涉及正式設定變更。

### 2.3 是否刪除重要安全紀錄

- 第十九階段曾將 `MEMORY.md` 由 129 行精簡至 30 行 / 3764 bytes（<3,000 字注入上限）。精簡後保留全部跨會話耐久安全事實，含：
  - 8022 五分鐘自傷循環（結構性根因）
  - `django-v15c-pid.json` 正式環境不存在 → 首次部署走 `state_record_absent`
  - E4c 雙標記修正關鍵說明
  - 方案 A READY / 方案 B CONDITIONAL（E3 提升身分 CommandLine NOT DETERMINED）
  - 回滾紅線（原啟動器+原排程 Enabled ≠ 安全回滾）
  - 並行寫入風險提示
- 結論：**未刪除重要安全紀錄**；P3-H 全段安全事實完整保留。

### 2.4 是否影響其他代理工作

- `MEMORY.md` 僅供本會話注入摘要，對同機其他 WorkBuddy 會話無文件系統副作用（其他會話各自有獨立記憶）。本輪未改，故無影響。

### 2.5 是否存在備份

- 無獨立 `MEMORY.md` 備份檔，但：
  - 每日日誌 `2026-10-28.md`（1653 bytes）已補記第十九階段與本輪工作要項；
  - 完整報告 `P3H_PHASE19_FINAL_SAFETY_CONFIRMATION_2026-10-28.md` 與 `P3H_PHASE19_MAINTENANCE_RUNBOOK_FINAL_2026-10-28.md` 存於 `docs/reports/`。
- 結論：變更可溯（日誌 + 報告），無備份損失風險。

### 2.6 任務 B 小結

| 子項 | 結果 |
|---|---|
| 本輪修改 MEMORY.md | ✅ 未修改（遵守禁止事項） |
| 涉及正式設定 | ✅ 否 |
| 刪除重要安全紀錄 | ✅ 否 |
| 影響其他代理 | ✅ 無 |
| 備份 / 可溯性 | ✅ 日誌 + 報告可溯 |

---

## 3. 任務 C：正式維護准入重新確認

### 3.1 方案 A（冷啟動切換，推薦）前置條件

| 前置條件 | 狀態 |
|---|---|
| 備份正式啟動器（`D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1`，SHA `a64330ef…`） | ⏳ 待維護窗口執行 |
| 兩模組 `V15C-Ownership.ps1` / `V15C-Adoption.ps1` 複製至 `D:\FDE-AI-Gateway\` | ⏳ 待執行（否則 dot-source throw） |
| 回滾腳本就位（原啟動器 + 排程 Disabled + 手動啟動） | ⏳ 待執行 |
| patched-v3 邏輯已含 E4c 雙標記修正 | ✅ 已確認（line 208） |
| 57/57 回歸通過、E4c 9/9 | ✅ 第十九階段已證 |

→ 方案 A **READY**（僅待架構師批准維護窗口與現場執行備份/複製/回滾步驟）。

### 3.2 方案 B（不中斷收養）E3 未決條件

- E3 提升身分（RunAs / 提升 shell）CommandLine 可讀性，在第十九階段唯讀核驗下為 **NOT DETERMINED**（沙箱攔截 RunAs，依授權未代替代）。
- 此為方案 B 唯一剩餘未決項；方案 B 仍 **CONDITIONAL**。
- 若維護窗口選方案 B，須先於一次性提升身分下完成 E3 CommandLine 唯讀驗證（確認 listener CommandLine 可被正確讀取以區分 shim/base），否則不得啟用 `$EnableAdoption=$true` 接管路徑。

### 3.3 原問題排程的安全控制方法

- 排程 `FDE-AI v1.5C Classroom Server`：RunLevel=Highest、repeat=PT5M、Interactive。
- **安全回滾紅線**：原啟動器 + 原排程 **Enabled 不是安全回滾**（即現行誤殺狀態）。安全回滾 = 原啟動器 + 排程 **Disabled** + 手動啟動。
- 維護窗口啟用 patched-v3 前，須先將原排程設為 Disabled，避免 patched-v3 部署期間原排程仍每 5 分鐘觸發誤殺。
- 非提升 shell 讀不到 8022 listener CommandLine → 任何命令列可讀性驗證須提升權限（與 E3 同）。

### 3.4 8022 失敗時的人工恢復責任

- patched-v3 嚴守「不自動殺」規則：`Resolve-V15CListenerAction` 在非 OWNED 時 `throw` 中止（REUSE/ADOPT 以外皆不終止 listener）。
- 若 8022 仍異常（如健康探測失敗、狀態記錄缺失且收養閘門未全過），啟動器**中止並記日誌**，不採取破壞性動作。
- **人工恢復責任**：維護窗口現場人員（教師/架構師）須監看 `startup.log`，遇 ABORT 時依 Runbook 手動介入（確認 listener 身分、必要時手動停止原排程、手動啟動 patched-v3），**不得**依賴自動殺程。

### 3.5 8770 / 8030 / Tunnel 保護措施

- 測試埠 8770 / 8030 已自生產排除（Env 慣例）；本輪與第十九階段均未觸及。
- Tunnel 兩處 `Stop-Process`（原始檔 line 246/268）缺終止前重驗 —— 屬**獨立待修階段**，本輪與正式維護首輪均**不動 Tunnel**，避免誤殺通道。
- 正式維護時，`V15C-Ownership.ps1`（含 Tunnel 段）須原樣複製，不得在本輪預先改動。

### 3.6 三個以上排程週期的觀察及停止條件

- 部署 patched-v3 並啟用（方案 A 冷啟動 / 或方案 B 接管）後，須觀察 **≥3 個 5 分鐘排程週期**（≥15 分鐘）。
- 觀察指標：8022 listener 是否穩定持埠、是否仍有自傷循環（PID 輪轉）、`django-v15c-pid.json` 狀態記錄是否寫入、啟動日誌是否無 throw。
- **停止條件（任一成立即中止維護並回滾）**：
  1. 誤殺循環未止（PID 仍輪轉、每 5 分鐘重啟）；
  2. patched-v3 拋出非預期異常（非 `state_record_absent` 預期分支）；
  3. 8770/8030/Tunnel 受影響；
  4. 狀態記錄寫入失敗且收養閘門未過（方案 B）。
- 回滾即套用 3.3 紅線：原啟動器 + 排程 Disabled + 手動啟動。

### 3.7 任務 C 小結

| 項目 | 狀態 |
|---|---|
| 方案 A 前置 | ✅ READY（待窗口執行備份/複製/回滾） |
| 方案 B E3 未決 | ⏳ NOT DETERMINED（待一次性提升驗證） |
| 原排程安全控制 | ✅ 明確（Disabled 才安全回滾） |
| 8022 失敗人工責任 | ✅ 不自动殺，現場手動介入 |
| 8770/8030/Tunnel 保護 | ✅ 排除生產、Tunnel 不動 |
| 三週期觀察/停止 | ✅ ≥3×5min，4 項停止條件 |

---

## 4. 完整 SHA-256 表（本輪實測）

| 檔案 | SHA-256 |
|---|---|
| `start_fde_v15c_classroom.original.ps1`（基線） | `a64330ef7a31e6c981fba95117466610af5e5db833d1ddafc8d91dba1c7a7b59` |
| `start_fde_v15c_classroom.patched-v3.ps1`（部署標的） | `bc57751349551959c9a7957039854d291a59800b3a16a42786dc9d805c5640d0` |
| `PATCH-v3.diff`（陳舊） | `c24d3854f5e082bf52f05b8cc319079b97c6eb3d7302e2aff95fcb6a2383ef79` |
| `V15C-Ownership.ps1` | `adf7f8ecd6bcdaf3d5bd013569c9c6231f0e7f16bf64675a83b0042391b03ec8` |
| `V15C-Adoption.ps1` | `7988d8668ba8be71bc656c85625e4bad8867c6fc80a5c4fd7c416ebb64c74fe9` |
| `V15C-Adoption.e4c.ps1` | `7988d8668ba8be71bc656c85625e4bad8867c6fc80a5c4fd7c416ebb64c74fe9` |
| `MEMORY.md`（本輪未改） | `68b2d8e254f340fa4624fd1195752924ee77a3b31acccca41e86815bd412b884` |
| `2026-10-28.md`（每日日誌，本輪未改） | 見檔案（1653B, mtime 08:12:28） |
| `P3H_PHASE19_FINAL_SAFETY_CONFIRMATION_2026-10-28.md`（前輪） | `c91a98b063f677f8930458bc51dbd7ff6a211a5e6b4b187b9503cdbed013a3dc` |
| `P3H_PHASE19_MAINTENANCE_RUNBOOK_FINAL_2026-10-28.md`（前輪） | `1d6738eefb2e94584642b7ab9a5bb542309952dcf7132fb207ee557cf6ade8df` |

> 編碼審計：全部 `.ps1` / `.diff` 檔 **0 BOM、0 非 ASCII**（符合 PS 5.1 ASCII-only 硬約束）。

---

## 5. 風險清單

| # | 風險 | 等級 | 緩解 |
|---|---|---|---|
| R1 | `PATCH-v3.diff` 陳舊（三標記），無法重建當前檔案 | 低 | 以 patched-v3 本體為準；diff 僅歷史工件，不影響部署 |
| R2 | 方案 B 之 E3 CommandLine 可讀性 NOT DETERMINED | 中 | 選方案 B 前須一次性提升驗證；否則走方案 A |
| R3 | 原排程 Enabled 期間部署 → 誤殺循環持續 | 高 | 部署前先 Disabled 原排程（紅線） |
| R4 | Tunnel 段缺終止前重驗 | 中 | 本輪/首輪不動 Tunnel，獨立階段修 |
| R5 | 並行 WorkBuddy 會話同改 `ops/p3h/v15c-launcher/` | 低 | 本輪無近期寫入證據；開工前比對 SHA/時間戳 |
| R6 | 8022 失敗自動殺 | 高（已控） | patched-v3 嚴守不自动殺，ABORT 現場手動介入 |
| R7 | 狀態檔 `django-v15c-pid.json` 正式不存在 | 中 | 首部署必走 `state_record_absent` 分支（已驗證） |

---

## 6. 正式維護准入建議

**總體裁決：CONDITIONAL（與第十九階段一致）。**

- **建議路徑**：採 **方案 A（冷啟動切換）**——邏輯 READY、E4c 修正已落地、回歸全過；風險可控。
- **前置動作（維護窗口內，須架構師批准後執行）**：
  1. 備份正式啟動器（SHA `a64330ef…`）；
  2. 複製 `V15C-Ownership.ps1` + `V15C-Adoption.ps1` 至 `D:\FDE-AI-Gateway\`；
  3. **先將原排程設為 Disabled**（紅線，避免誤殺）；
  4. 置換啟動器為 patched-v3（SHA `bc577513…`）；
  5. 觀察 ≥3 個 5 分鐘週期，依第 3.6 節停止條件判定。
- **若堅持方案 B**：須先完成 E3 提升身分 CommandLine 唯讀驗證（解除 NOT DETERMINED），否則不得啟用接管。
- **本輪未執行任何上述動作**，僅交付核對結論。

---

## 7. 交付物與下一步

- 本報告：`P3H_PHASE19_PRE_MAINTENANCE_DIFF_CHECK_2026-10-28.md`（新增，唯讀核對交付）。
- 隨附既有證據（前輪）：最終安全確認報告、Runbook FINAL、E3/consistency JSON。
- **下一步**：等待架構師批准正式維護窗口。批准後依第 6 節前置動作執行；本輪不主動進行部署/停止/重啟/接管。

---
*報告結束。全程遵守紅線：未改正式 8022 / 啟動器 / 排程 / 8770 / 8030 / Tunnel，未 Commit/Push/Deploy，未終止未知程序，未改 MEMORY.md。*
