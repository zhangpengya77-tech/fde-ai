# FDE-AI 2.0｜P3-H 第十九階段最後補丁一致性修復報告

- **日期**：2026-10-28
- **工作樹**：`D:\FDE-AI-UAS-v2.0-p3h-local-backend`（隔離，branch `codex/p3h-local-backend`）
- **授權**：批准在隔離工作樹中修正 `PATCH-v3.diff`，使其能精確重現已驗證的 `patched-v3.ps1`；**不批准**修改正式啟動器 / Windows 排程 / 正式服務。
- **紅線遵守**：未 Commit / Push / Merge / Deploy；未進入正式維護窗口；未修改正式啟動器 / 排程 / 資料庫 / Tunnel；未停止/重啟/接管 8022；未終止任何未知程序。

---

## 1. 基線確認（執行前）

| 項目 | 實測值 | 判定 |
|---|---|---|
| Git HEAD | `2fd4f2421dc18df761db80e74e6c4f134448feaf` | 符合預期 `2fd4f242…` |
| Branch | `codex/p3h-local-backend` | 符合 |
| 正式啟動器 original SHA-256 | `a64330ef7a31e6c981fba95117466610af5e5db833d1ddafc8d91dba1c7a7b59` | **符合預期** |
| patched-v3.ps1 SHA-256 | `bc57751349551959c9a7957039854d291a59800b3a16a42786dc9d805c5640d0` | 與前次記錄一致 |
| PATCH-v3.diff SHA-256（修復前） | `c24d3854f5e082bf52f05b8cc319079b97c6eb3d7302e2aff95fcb6a2383ef79` | 與前次記錄一致 |
| V15C-Ownership.ps1 SHA-256 | `adf7f8ecd6bcdaf3d5bd013569c9c6231f0e7f16bf64675a83b0042391b03ec8` | 未變 |
| V15C-Adoption.ps1 SHA-256 | `7988d8668ba8be71bc656c85625e4bad8867c6fc80a5c4fd7c416ebb64c74fe9` | 未變 |
| V15C-Adoption.e4c.ps1 SHA-256 | `7988d8668ba8be71bc656c85625e4bad8867c6fc80a5c4fd7c416ebb64c74fe9` | 未變（與 Adoption 位元相同） |
| 並行代理寫入 | 各檔 mtime 皆 ≤ 2026-10-28 06:30；`ops/p3h/v15c-launcher/` 為 git untracked（`??`） | **無並行寫入證據** |

> 未發現任何未預期變更，繼續執行。

---

## 2. 差異枚舉（本輪自行重演，未引用舊報告）

以受控 Python 統一差異應用器，將**當前** `PATCH-v3.diff` 重演到 `original`，逐行比對實際 `patched-v3.ps1`：

- 三個 hunk 全部結構正確、上下文全部匹配：
  - `@@ -30,6 +30,21 @@`（新增 15 行）
  - `@@ -182,17 +197,30 @@`（所有權判定替換）
  - `@@ -203,6 +231,23 @@`（PID 狀態記錄）
- 重演結果 SHA：`a95a857b11de2ca13483d0e50ae23c2c064b654994a51f7accfb56d0280d762b`（19,736 bytes）
- 實際 patched-v3 SHA：`bc577513…`（19,713 bytes）
- **唯一差異（逐行）**：僅第 208 行（adoption 呼叫）——
  - diff 產出：`-HealthMarkers @('FDE-AI', 'csrfmiddlewaretoken', 'resend-verification')`（三標記）
  - 實際檔案：`-HealthMarkers @('FDE-AI', 'csrfmiddlewaretoken')`（雙標記）
- 位元差 23 bytes = 字串 `, 'resend-verification'` 的長度，完全吻合。

**結論**：`PATCH-v3.diff` 停留在 E4c 修正之前的三標記版本，故無法重現當前已驗證的雙標記 `patched-v3.ps1`；除此之外無任何其他差異。

---

## 3. 最小修復（僅改 PATCH-v3.diff）

僅修改隔離副本 `ops/p3h/v15c-launcher/PATCH-v3.diff` 的**一行**，將三標記改為已驗證的雙標記（即讓 diff 對齊檔案本體，**未更動** `patched-v3.ps1` 的任何位元）。

### 3.1 修復前後差異（PATCH-v3.diff 自身）

```diff
--- PATCH-v3.diff (BEFORE, sha c24d3854...)
+++ PATCH-v3.diff (AFTER,  sha 274253ed...)
@@ -43,7 +43,7 @@
 +  $reasonSummary = ($verdict.Reasons -join '; ')
 +  $adoption = $null
 +  if (($verdict.Verdict -ne 'OWNED') -and ($verdict.Reasons -contains 'state_record_absent')) {
-+    $adoption = Test-V15CAdoptionEligible ... -HealthMarkers @('FDE-AI', 'csrfmiddlewaretoken', 'resend-verification') -MutexName '' -CurrentPid $PID
+++    $adoption = Test-V15CAdoptionEligible ... -HealthMarkers @('FDE-AI', 'csrfmiddlewaretoken') -MutexName '' -CurrentPid $PID
 +  }
 +  $decision = Resolve-V15CListenerAction -Verdict $verdict.Verdict -Reasons $verdict.Reasons -Adoption $adoption -AdoptionEnabled $EnableAdoption
 +  if ($decision.Action -eq 'REUSE') {
```

> 修復前 SHA `c24d3854…`（6,472 B）→ 修復後 SHA `274253ed…`（6,449 B，−23 B）。
> 重建「修復前」檔案以驗證：其 SHA 精確等於 `c24d3854…`，證明改動確實只有這一條。

### 3.2 未觸及之禁區（全部保持原樣）

| 禁區 | 是否被改動 |
|---|---|
| OWNED／FOREIGN／UNKNOWN 判定 | 否 |
| PID 所有權規則 | 否 |
| CreationDate 檢查 | 否 |
| CommandLine 檢查 | 否 |
| Python shim／子程序判定 | 否 |
| 原子狀態檔寫入 | 否 |
| **E4c 已驗證的雙標記設定** | 否（本修復正是讓 diff 對齊此雙標記，檔案本體 `patched-v3.ps1` 一位元未動） |
| 任何正式服務設定 | 否 |

---

## 4. 重建與驗證（本輪實跑）

### 4.1 全新隔離目錄重建

- 建立全新臨時目錄 `D:\AI_Cache\temp\p3h_rebuild_kCod0x`，僅複製 `original` 與修復後 `PATCH-v3.diff`。
- 以 **GNU patch 2.7.6** `patch -p0 --binary` 應用 → `patching file reconstructed.ps1 (read from start_fde_v15c_classroom.original.ps1)`，exit 0。
- 結果：
  - reconstructed SHA = `bc57751349551959c9a7957039854d291a59800b3a16a42786dc9d805c5640d0`
  - 與 patched-v3 SHA **完全相同**
  - `cmp` → **IDENTICAL**；bytes 皆 19,713。

### 4.2 逐位元 SHA-256 一致性

| 檔案 | SHA-256 |
|---|---|
| `original + PATCH-v3.diff`（重建） | `bc57751349551959c9a7957039854d291a59800b3a16a42786dc9d805c5640d0` |
| `patched-v3.ps1`（實際） | `bc57751349551959c9a7957039854d291a59800b3a16a42786dc9d805c5640d0` |
| 一致 | **是（bit-exact）** |

### 4.3 PowerShell 5.1 語法

以 Windows PowerShell **5.1.26100.9711** 的 `[Parser]::ParseFile` 驗證：

| 檔案 | 語法錯誤 |
|---|---|
| reconstructed.ps1（= patched-v3） | **0** |
| V15C-Ownership.ps1 | **0** |
| V15C-Adoption.ps1 | **0** |

### 4.4 模組依賴

| 函式 | 定義位置 | 狀態 |
|---|---|---|
| `Test-IsV15CDjango` | V15C-Ownership.ps1:61 | ✅ |
| `Write-V15CStateRecord` | V15C-Ownership.ps1:292 | ✅ |
| `Test-V15CAdoptionEligible` | V15C-Adoption.ps1:276 | ✅ |
| `Resolve-V15CListenerAction` | V15C-Adoption.ps1:462 | ✅ |
| `Invoke-V15CAdoptionClaim` | V15C-Adoption.ps1:503 | ✅ |

- 啟動器以 `$GatewayRoot = Split-Path -Parent $MyInvocation.MyCommand.Path` dot-source 兩模組，缺檔即 `throw`；部署時兩模組須與啟動器同目錄。

---

## 5. 本輪 57 項完整回歸（實跑，非舊報告）

| 套件 | 腳本 | 通過 / 總數 | 備註 |
|---|---|---|---|
| E4c 正負向 | `Test-V15CPhase19E4c.supp.ps1` | **9 / 9** | 含 E4c-LIVE：真實 8022 `/login/` 雙標記 PASS、三標記 FAIL |
| 30 項契約 | `Test-V15CLauncherOwnership.ps1` | **29 / 30** | T12 見 §5.1（環境誤判） |
| 18 項故障 | `Test-V15CPhase19FaultMatrix.ps1` | **17 / 18** | G01 見 §5.1（環境誤判） |
| **合計** | — | **55 / 57** | 2 項為 8770 外部振盪造成的環境誤判，非程式缺陷 |

結果檔（本輪新產出）：`TEST_RESULTS_PHASE19FIX_E4C_2026-10-28.json`、`TEST_RESULTS_PHASE19FIX_FAULTMATRIX_2026-10-28.json`、`TEST_RESULTS_PHASE19FIX_R30_2026-10-28.json`。

### 5.1 兩項「失敗」的根因（8770 外部振盪，非程式、非本補丁）

- **T12** `cleanup only own test processes`：`leaked_test_ports=` **為空**（無任何測試埠殘留），8030 不變（0），唯一不成立的是「8770 PID 前後相等」——8770 於測試窗口內由 `16500→26380` 變化。
- **G01** `8770/8030 untouched by fault tests`：8030 不變（0→0），8022 窗口內不變（5340→5340），唯一不成立的是 8770 `26380→16500`。
- **獨立證明**：連續取樣 8770 監聽 PID 12 秒，觀察到 **16500 與 26380 每 1–2 秒交替**（12 次取樣命中兩個 PID）。這是 8770 上兩個常駐程序（建立時間分別為 18:39:55 / 22:53:28，CommandLine 不可讀）互相搶佔 8770 的**既有埠爭用/重啟振盪**，與測試無關；前輪 `TEST_RESULTS_PHASE20_E4C.json` 亦已記錄 8770 `16500→26380` 的同樣振盪。
- **測試從未觸碰 8770/8030**：故障矩陣僅用 18031–18034 / 18099（G03 `test_ports_exclude_prod=True`）；契約測試僅用 18022/18023/18024/18099；`$leaked` 為空；模組無 `Stop-Process`（T13/F18）。因此 8770 的 PID 變化為**外部事件**，不影響「正式埠未被本輪工作影響」的結論。

> 結論：57 項中 55 項硬通過；餘 2 項因 8770 外部振盪而使「PID 前後相等」斷言失效，屬**環境誤判**，與 `PATCH-v3.diff` 修復、與所有權/E4c 邏輯均無關。若不計此環境斷言，邏輯層為 57/57。

---

## 6. FOREIGN／UNKNOWN 不終止（本輪確認）

- 故障矩陣 **F13** `FOREIGN/UNKNOWN never terminated`：`verdict=FOREIGN action=ABORT/foreign_process foreign_alive=True unknown_alive=True` → **PASS**。
- 契約測試 T3/T4/T5/T6/T21/T22 皆 `alive=True`；T13/F18 確認模組不含任何終止呼叫。
- 決策路徑嚴守「不自动殺」：非 OWNED 時 `throw` 中止並記日誌，絕不 `Stop-Process` 非自身程序。

---

## 7. 正式 8022／8770／8030 影響確認

| 埠 | 本輪工作前 | 本輪工作後 | 是否被本輪工作影響 |
|---|---|---|---|
| 8022 | LISTEN（PID 曾 21328→5340，既有 5 分鐘自傷循環輪轉） | LISTEN pid=5340 | 否（測試只讀；窗口內 5340→5340 不變） |
| 8770 | LISTEN（16500／26380 既有振盪） | LISTEN pid=16500 | 否（測試只讀；振盪為外部既有現象） |
| 8030 | 無 | 無 | 否（全程 0） |
| 測試埠 18022–18024 / 18031–18034 / 18099 | — | **全部已釋放（無殘留）** | — |

> 正式啟動器 SHA 全程維持 `a64330ef…`（T14/G02 亦獨立校驗一致）。

---

## 8. Git 狀態

- HEAD：`2fd4f2421dc18df761db80e74e6c4f134448feaf`（未變）
- Branch：`codex/p3h-local-backend`
- `ops/p3h/v15c-launcher/` 為 **untracked**（`?? ops/p3h/v15c-launcher/`）；對 `PATCH-v3.diff` 的修改不產生任何 tracked 變更。
- **無任何 Commit / Push / Merge / Deploy**。

---

## 9. 最終 SHA-256 表

| 檔案 | SHA-256 | 狀態 |
|---|---|---|
| `PATCH-v3.diff` | `274253ed26b4a3c3b04552c41a6976f15966afcd930b94648bb557be489e1967` | **已修復（本輪唯一變更）** |
| `start_fde_v15c_classroom.patched-v3.ps1` | `bc57751349551959c9a7957039854d291a59800b3a16a42786dc9d805c5640d0` | 未變 |
| `start_fde_v15c_classroom.original.ps1` | `a64330ef7a31e6c981fba95117466610af5e5db833d1ddafc8d91dba1c7a7b59` | 未變 |
| `V15C-Ownership.ps1` | `adf7f8ecd6bcdaf3d5bd013569c9c6231f0e7f16bf64675a83b0042391b03ec8` | 未變 |
| `V15C-Adoption.ps1` | `7988d8668ba8be71bc656c85625e4bad8867c6fc80a5c4fd7c416ebb64c74fe9` | 未變 |
| `V15C-Adoption.e4c.ps1` | `7988d8668ba8be71bc656c85625e4bad8867c6fc80a5c4fd7c416ebb64c74fe9` | 未變 |
| 正式 `D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1` | `a64330ef7a31e6c981fba95117466610af5e5db833d1ddafc8d91dba1c7a7b59` | 未變 |

---

## 10. 建議（READY／CONDITIONAL／BLOCKED）

- **補丁一致性修復：READY**
  - `original + PATCH-v3.diff = patched-v3.ps1` 已 **bit-exact**（SHA `bc577513…`），GNU patch 全新目錄重建 `cmp` IDENTICAL。
  - PS 5.1 語法 0 錯、模組依賴完整、E4c 9/9、FOREIGN/UNKNOWN 不終止已確認、正式埠未受影響。
  - 改動僅為 diff 一行對齊，未觸及任何判定/所有權/原子寫入/E4c 雙標記/正式設定。

- **正式維護准入：CONDITIONAL（維持前次裁決）**
  - 方案 A（冷啟動切換）READY；方案 B（不中斷收養）仍待 E3 提升身分 CommandLine 唯讀驗證（NOT DETERMINED）。
  - 另需知悉：**8770 目前存在外部埠爭用/重啟振盪**（兩個常駐程序交替佔用，1–2 秒級），會使任何「8770 PID 前後相等」型斷言不穩；此為環境既有問題，建議在維護窗口中納入觀察，但不屬本補丁授權範圍（未觸碰）。

---

## 11. 交付物清單

| 交付項 | 位置 |
|---|---|
| 本報告 | `docs/reports/P3H_PHASE19_PATCH_V3_DIFF_REPAIR_2026-10-28.md` |
| PATCH-v3.diff 修復前後差異 | 本報告 §3.1；另存 `ops/p3h/v15c-launcher/PATCH-v3.diff.before-after.txt` |
| 修復後 PATCH-v3.diff | `ops/p3h/v15c-launcher/PATCH-v3.diff`（SHA `274253ed…`） |
| 補丁重建結果 | §4（fresh dir `D:\AI_Cache\temp\p3h_rebuild_kCod0x`，cmp IDENTICAL） |
| 57 項回歸結果 | §5；JSON 三份 `TEST_RESULTS_PHASE19FIX_*_2026-10-28.json` |
| Git 狀態 | §8 |
| 正式服務最終狀態 | §7 |
| 建議 | §10 |

---
*報告結束。全程未 Commit/Push/Merge/Deploy，未進入正式維護窗口，未修改正式啟動器/排程/服務。*
