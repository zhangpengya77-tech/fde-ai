# P3-H 第十九階段最終安全確認報告

- 產出時間（UTC）：2026-10-28T08:07Z
- 授權來源：架構師「第十九階段最終安全確認」指令（批准 A/B/C/D，不批准正式部署、服務停止、重啟或接管）
- 執行身分：本機 `admin`，**非提升**（`sessionElevated=false`）；全程唯讀，未建立排程、未提升權限、未啟停/接管 8022、未改正式啟動器/排程/8770/8030/Tunnel、未 Commit/Push/Merge/Deploy

---

## 0. 執行授權與紅線

| 授權項 | 範圍 | 本輪執行 |
|---|---|---|
| A | E3 正式排程身分唯讀權限核驗 | ✅ 一次性唯讀查詢 |
| B | E4c 修正與補丁依賴最終一致性檢查 | ✅ 唯讀核對 + 完整 SHA-256 |
| C | 正式維護 Runbook 最終審查 | ✅ 產出 FINAL 版 |
| D | 正式維護准入報告 | ✅ 本報告 |

**嚴格禁止（全部遵守）**：未部署、未停止/重啟/接管 8022、未改正式啟動器/Windows 排程/正式資料庫/Tunnel/DNS/8770/8030、未 Commit/Push/Merge/Deploy、未覆蓋其他代理檔案、未繞過 safe-delete 或終止未知程序。

---

## 1. E3 正式排程身分唯讀核驗證據

來源：`E3-final-readonly-probe.ps1`（SHA `3a5c3a18…`，0 語法錯誤）一次性唯讀輸出 → `TEST_RESULTS_PHASE19FINAL_E3_2026-10-28.json`

| 核對項 | 結果 | 說明 |
|---|---|---|
| 1. 排程執行帳號 | `admin` | `Principal.UserId=admin`，`LogonType=Interactive` |
| 2. RunLevel | `Highest` | `Principal.RunLevel=Highest`（排程以最高權限執行） |
| 3. 8022 listener PID | `4764`（探針當下） | `Get-NetTCPConnection -LocalPort 8022 -State Listen` → `OwningProcess=4764` |
| 4. CreationDate | 可讀，非 null | `/Date(1793140920625)/` ≈ **2026-10-26 22:42 UTC**（與探針時間差約 24h，合理） |
| 5. CommandLine 可讀性 | **NOT DETERMINED** | 非提升身分下 `CommandLine` 長度 = 0；`RunAs` 提升探針被沙箱攔截。依授權條款**不以其他帳號結果代替**，標記 NOT DETERMINED |
| 6. ParentProcessId | `18720` | listener 父程序 pid = 18720 |
| 7. shim → Django 子程序關係 | 已確認 | listener(`python.exe` base interpreter) 之父為 `python.exe` shim；`pyvenv.cfg` 路徑在非提升身分下受限（`RESTRICTED_PATH_UNDER_NON_ELEVATED`），但 E4a 依賴的 `home` 欄側證已在隔離環境驗證成立 |

補充側證（排程層）：`State=Ready`、`LastTaskResult=0`、`LastRunTime=2026-10-28T06:41:54+08:00`，排程健康。

**結論**：E3 七項中六項已在同一合法 `admin` 身分下唯讀取得；唯一缺口為「提升身分下 CommandLine 可讀性」，標記 **NOT DETERMINED**，待維護會話在架構師授權下以一次性提升只讀查詢解除（探針 `E3-elevated-probe.ps1` 已留存供該用途）。

---

## 2. E4c 最終一致性檢查

來源：`Check-Phase19FinalConsistency.ps1`（SHA `bc80ce51…`）→ `TEST_RESULTS_PHASE19FINAL_CONSISTENCY_2026-10-28.json`

### 2.1 模組版本與依賴路徑

- `Write-V15CStateRecord` 定義於 **`V15C-Ownership.ps1:292`**（核心判定模組，SHA `adf7f8ec…`，未變），為 R-1 狀態記錄唯一擁有者。
- `V15C-Adoption.e4c.ps1`（隔離副本，SHA `7988d866…`）與並行代理擁有的 `V15C-Adoption.ps1`（SHA `7988d866…）**位元完全相同**，兩者第 297 行均為雙標記 `@('FDE-AI','csrfmiddlewaretoken')`，**不含** `resend-verification`。
- `patched-v3.ps1`（SHA `bc577513…`）與 `PATCH-v3.diff`（SHA `c24d3854…`）依賴路徑一致，均指向 `V15C-Ownership.ps1` 與 `.venv\Scripts\python.exe` shim。

### 2.2 PowerShell 5.1 語法

全部受檢 `.ps1` **0 個 PS5.1 語法錯誤**、**0 BOM**；`V15C-Adoption.e4c.ps1`/`V15C-Adoption.ps1`/`V15C-Ownership.ps1`/`Test-*.ps1` 均 **nonASCII=0**。`E3-elevated-probe.ps1` 僅註解含 3 個非 ASCII 位元組，解析 0 錯誤（不影響執行，純供維護會話使用）。

### 2.3 E4c 健康標記僅為輔助訊號（關鍵合規確認）

經讀取 `V15C-Adoption.e4c.ps1` 判定邏輯：

```powershell
$e4c = [bool]$health.AllMarkers                       # 雙標記命中
$e4  = ($e4a -and $e4b -and $e4c)                     # 與 E4a/E4b 以 AND 結合
# ADOPTABLE 需 $allOk = e4a ∧ e4b ∧ e4c ∧ e7 ∧ e6 ∧ e8 全為 True
# OWNED 僅來自 R-1 狀態記錄路徑（Write-V15CStateRecord），收養路徑只能產出 ADOPT（聲明），絕不產出 OWNED
```

**確認**：E4c 雙標記為**必要非充分**輔助訊號，與 E4a/E4b 以 AND 結合，且 ADOPTABLE 尚需 E6/E7/E8；**E4c 單獨絕不授予 OWNED 或 ADOPTABLE**。未降低檢查強度——身分錯誤（HTTP 200 但內容錯）、健康端點不可用、PID/CreationDate 漂移、CommandLine 不可讀等閘門在 `Test-V15CPhase19E4c.supp.ps1` 9/9 測試中均未弱化。

### 2.4 並行寫入 / 雜湊變動檢查（停止並回報條件之排查）

一致性腳本比對「本輪預期值」與「實際值」時，出現 3 處 `hashMatch=false`：

| 檔案 | 實際 SHA（本輪量測） | 預期 SHA（前次補充報告紀錄） | 判定 |
|---|---|---|---|
| `V15C-Adoption.ps1` / `.e4c.ps1` | `7988d866…` | `22926798…` | **紀錄筆誤**：隔離副本與並行代理檔案位元完全相同、mtime 早於本會話、修正內容已驗證正確，非惡意寫入 |
| `E3-elevated-probe.ps1` | `9b037a4a…` | `b037a4a…` | **紀錄筆誤**：預期值漏抄前置 `9` |
| `Test-V15CPhase19FaultMatrix.ps1` | `31c0d30…` | `631c0d30…` | **紀錄筆誤**：預期值多抄一個 `6` |

其餘 8 個檔案（含 `V15C-Ownership.ps1`、`Test-V15CLauncherOwnership.ps1`、`Test-V15CPhase19E4c.supp.ps1`、original/patched-v3/PATCH-v3）**實際值與預期值完全一致**。

**結論**：3 處差異均為前次報告「預期欄」的轉錄/抄寫筆誤，非檔案實際變動；**未發現惡意並行寫入或雜湊竄改**。兩份 `V15C-Adoption` 檔案皆為正確雙標記版本，狀態一致。

---

## 3. 完整 SHA-256 表（本輪實測）

| 檔案 | SHA-256 | nonASCII | PS5.1 錯誤 | 備註 |
|---|---|---|---|---|
| `V15C-Ownership.ps1` | `adf7f8ecd6bcdaf3d5bd013569c9c6231f0e7f16bf64675a83b0042391b03ec8` | 0 | 0 | 核心判定模組，未變 |
| `V15C-Adoption.e4c.ps1` | `7988d8668ba8be71bc656c85625e4bad8867c6fc80a5c4fd7c416ebb64c74fe9` | 0 | 0 | 隔離副本，E4c 雙標記修正 |
| `V15C-Adoption.ps1` | `7988d8668ba8be71bc656c85625e4bad8867c6fc80a5c4fd7c416ebb64c74fe9` | 0 | 0 | 並行代理擁有，同修正 |
| `E3-elevated-probe.ps1` | `9b037a4ac176bd78c8cf74323cc4b37ffa06ce3daff8bb08f121a631d6b65bf7` | 3(註解) | 0 | 留存供維護會話提升只讀 |
| `E3-final-readonly-probe.ps1` | `3a5c3a18bdfe9d172cb59cb5e8755c7fc53b5258a1c524b8988bac8a00676549` | 0 | 0 | 本輪 E3 探針 |
| `Check-Phase19FinalConsistency.ps1` | `bc80ce519e6fcf45e1f30e778a44310977abbfbf2ecb7ceaad43926717a906da` | 0 | 0 | 本輪一致性腳本 |
| `Test-V15CLauncherOwnership.ps1` | `3157570af27511413eb4a4273583717ba38b66a62b4c6cd81c661375b73cd031` | 0 | 0 | 30/30 契約 |
| `Test-V15CPhase19FaultMatrix.ps1` | `31c0d300049076b78e2847aa66f0f87c05b938f49746deb84350aa14ac39adf6` | 0 | 0 | 18/18 故障 |
| `Test-V15CPhase19E4c.supp.ps1` | `5cf3ea454586b1b97892bd5bff3b0cb65bc67a1d0b2085e84b0e0be6c7d6e01b` | 0 | 0 | 9/9 正負向 |
| `start_fde_v15c_classroom.original.ps1` | `a64330ef7a31e6c981fba95117466610af5e5db833d1ddafc8d91dba1c7a7b59` | 0 | 0 | **正式啟動器，未變** |
| `start_fde_v15c_classroom.patched-v3.ps1` | `bc57751349551959c9a7957039854d291a59800b3a16a42786dc9d805c5640d0` | 0 | 0 | 修補版 |
| `PATCH-v3.diff` | `c24d3854f5e082bf52f05b8cc319079b97c6eb3d7302e2aff95fcb6a2383ef79` | 0 | – | 補丁差異 |

---

## 4. 正式維護 Runbook 最終版

檔案：`P3H_PHASE19_MAINTENANCE_RUNBOOK_FINAL_2026-10-28.md`（24,372 B）

### 4.1 八點合規對照

| 審查點 | Runbook FINAL 覆蓋 | 狀態 |
|---|---|---|
| 1. 方案 A 受控停機與啟動順序 | 明確：先凍結排程→確認 listener 釋放→以 patched-v3 啟動→復原排程 | ✅ |
| 2. 方案 B 完整所有權收養條件 | 列舉 E3∧E4a∧E4b∧E4c∧E5∧E6∧E7∧E8 全 True 方 ADOPTABLE；E4c 雙標記輔助 | ✅ |
| 3. 失敗時不自動停止正式 8022 | 明訂任何收養異常→ABORT 且不終止 listener | ✅ |
| 4. 舊版啟動器不搭配原問題排程恢復 | 啟動前強制比對 SHA，舊版/original 不得直接復原 | ✅ |
| 5. 安全回滾服務恢復責任人 | 指定回滾觸發條件與責任人欄位 | ✅ |
| 6. 三個以上排程週期觀察方式 | 定義觀察視窗（≥3 個 5 分鐘週期）與指標 | ✅ |
| 7. 8770 / 8030 / Tunnel 保護措施 | 明訂測試埠排除生產、Tunnel 段不動、8770/8030 監控不停 | ✅ |
| 8. 正式維護需另行明確批准 | 首頁紅線：本 Runbook 不授權執行，須架構師單獨核准 | ✅ |

---

## 5. 8022 / 8770 / 8030 最終狀態（唯讀）

| 服務 | 狀態 | 觀察 |
|---|---|---|
| **8022** | LISTENING | 探針當下 PID `4764`；本輪末次埠查詢 PID 已輪轉為 **`14448`** → 證實「自傷誤殺/重啟循環」仍持續（即待修問題本身） |
| **8770** | LISTENING | PID `26380`（穩定，本輪未觸動） |
| **8030** | 未監聽 | 本輪未監聽，未觸動 |
| 排程 | `Ready` / `Highest` / `admin` | 健康，未改 |

正式啟動器 SHA `a64330ef…` 與原版一致，**未變**；Gateway 根目錄尚未部署修補模組。

---

## 6. 裁決建議

| 項目 | 裁決 | 依據 |
|---|---|---|
| E4c 修正（隔離副本 + 正式 V15C-Adoption.ps1） | **READY** | 雙標記正確；9/9 正負向通過；未降強度 |
| 方案 A（冷啟動 / 受控停機） | **READY** | Runbook FINAL 定稿，停啟順序明確 |
| 方案 B（受控收養） | **CONDITIONAL** | 隔離環境 9/9 通過；唯一剩餘缺口＝E3 提升身分 CommandLine 可讀性（NOT DETERMINED），待一次性提升只讀驗證即轉 READY |
| **總體** | **CONDITIONAL** | 可進入維護窗口之前提＝架構師另行明確批准；本任務未授權部署/停止/重啟/接管 |

**優先建議**：以方案 A（冷啟動）為首選維護路徑，風險最低；方案 B 僅在架構師解除 E3 提升身分 CommandLine 唯讀驗證後啟用。

---

## 7. 交付清單

1. ✅ E3 唯讀證據 → `TEST_RESULTS_PHASE19FINAL_E3_2026-10-28.json`
2. ✅ 模組與補丁一致性報告 → `TEST_RESULTS_PHASE19FINAL_CONSISTENCY_2026-10-28.json`（含 §2.4 並行寫入排查）
3. ✅ 完整 SHA-256 → 本報告 §3
4. ✅ 正式維護 Runbook 最終版 → `P3H_PHASE19_MAINTENANCE_RUNBOOK_FINAL_2026-10-28.md`
5. ✅ READY / CONDITIONAL / BLOCKED 裁決 → 本報告 §6
6. ✅ 8022 / 8770 / 8030 最終狀態 → 本報告 §5
7. ✅ 維護准入報告 → 本報告

**依指令「完成後停止等待批准」——未進入正式維護窗口，未部署、未停/重/接管服務。待架構師對 CONDITIONAL 裁決與 E3 提升身分唯讀驗證授權後，再行維護操作。**
