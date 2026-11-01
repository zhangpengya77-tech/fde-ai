# P3-H 第十八階段（重新執行）— 8022 正式維護前安全驗收與受控初始化設計

- 報告日期：2026-10-27
- 工作樹：`D:\FDE-AI-UAS-v2.0-p3h-local-backend`
- 分支：`codex/p3h-local-backend`
- 報告性質：**隔離驗證與設計，未進入正式維護窗口，未修改任何正式資產**
- 承接：第十七階段（v1.5C 8022 啟動器所有權判定修復）與第十八階段第一輪（並行寫入中止）

---

## 0. 執行摘要

| 項目 | 結論 |
|---|---|
| 基線核實 | 全部符合，無偏差 |
| 並行寫入 | 已停止；最後一筆外部寫入 11:33:05，之後 41 分鐘無變化 |
| 任務 A（R-1 狀態檔初始化） | 方案 A／B 設計完成；方案 B 已實作並以 37 項隔離測試驗證 |
| 任務 B（第二輪隔離驗證） | 所有權套件 30/30 PASS；Phase 18 套件 37/37 PASS |
| 任務 C（Tunnel 審核） | 2 處 Stop-Process 完成 7 問審核；建議另立低優先級修復階段 |
| 任務 D（維護窗口計畫） | 兩套方案完成；**明確排除「恢復舊版啟動器」作為無條件回滾** |
| 是否建議進入維護窗口 | **建議進入，但採「方案 B 優先、方案 A 兜底」**，並附 1 項未解除風險 |
| 正式資產 | 完全未動（啟動器 SHA、排程、8022／8770／8030 前後一致） |

**本輪最重要的兩個新事實：**

1. **正式環境的 `django-v15c-pid.json` 目前不存在**（`C:\Users\admin\AppData\Local\FDE-AI\classroom\` 下確認 ABSENT）。因此修補版啟動器第一次執行時**必然**走「狀態檔缺失」分支 → 方案 B 的收養路徑。
2. **誤殺循環仍在活動**：`startup.log`（29,731 行）中 `STOPPING stale 8022` 出現 **4,725 次**。本次作業期間（11:46–12:16）即觀測到 6 次，每輪 8022 中斷 58–95 秒，可用率約 68%–81%。

---

## 1. 交付項 1：Git 基線與 SHA-256

### 1.1 Git 基線

| 項目 | 期望值 | 實測值 | 結果 |
|---|---|---|---|
| HEAD | `2fd4f2421dc18df761db80e74e6c4f134448feaf` | `2fd4f2421dc18df761db80e74e6c4f134448feaf` | MATCH |
| 分支 | `codex/p3h-local-backend` | `codex/p3h-local-backend` | MATCH |
| 已追蹤檔案修改 | 0 | 0 | MATCH |
| 未追蹤項目 | 允許（本階段產物） | 14 項，全部為既有報告與本階段隔離目錄 | OK |
| 工作樹數量 | — | 17 個，均未被本階段修改 | OK |

### 1.2 正式啟動器（唯讀，全程未變）

| 項目 | 值 |
|---|---|
| 路徑 | `D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1` |
| SHA-256（執行前） | `a64330ef7a31e6c981fba95117466610af5e5db833d1ddafc8d91dba1c7a7b59` |
| SHA-256（執行後） | `a64330ef7a31e6c981fba95117466610af5e5db833d1ddafc8d91dba1c7a7b59` |
| 位元組數 | 15,766 |
| 最後寫入時間 | 2026-10-11 12:48:53（未變） |
| 編碼 | 純 ASCII、無 BOM |

### 1.3 隔離產物 SHA-256（本輪最終）

| 檔案 | 位元組 | SHA-256 |
|---|---|---|
| `V15C-Ownership.ps1` | 19,902 | `adf7f8ecd6bcdaf3d5bd013569c9c6231f0e7f16bf64675a83b0042391b03ec8` |
| `V15C-Adoption.ps1` | 22,949 | `48cb7c34732d1eb8c40611ee3cf741c3b717784665ab7fde8dde8c544d66b81b1` |
| `start_fde_v15c_classroom.patched-v3.ps1` | 19,736 | `a95a857b11de2ca13483d0e50ae23c2c064b654994a51f7accfb56d0280d762b` |
| `PATCH-v3.diff` | 6,472 | `c24d3854f5e082bf52f05b8cc319079b97c6eb3d7302e2aff95fcb6a2383ef79` |
| `start_fde_v15c_classroom.patched.ps1`（v3 基底） | 17,846 | `5d1fc53dd32a064068ac87d3a03069493f3723e1926c88ff8b346f11bc4e74e9` |
| `start_fde_v15c_classroom.original.ps1` | 15,766 | `a64330ef7a31e6c981fba95117466610af5e5db833d1ddafc8d91dba1c7a7b59` |
| `Test-V15CLauncherOwnership.ps1` | 40,813 | `3157570af27511413eb4a4273583717ba38b66a62b4c6cd81c661375b73cd031` |
| `Test-V15CPhase18Adoption.ps1` | 50,025 | `48a1e4e0a4d4cd67de45a8484bbdb03d806c97749efdc789c551b69218ccf6c658` |
| `fake_project.py` | 2,069 | `edeb68370953b94834c073340e21437983cd017132902006cdc4759ae6ac5b8c` |
| `fake_manage.py` | 1,197 | `02c2cac6d8d697c6681fd0c5f956a0ac2f3e2e60bf47f2d76914940b5c520376` |

**編碼驗證**：所有 `.ps1` 均 `non_ascii=0`、`bom=False`，並通過 `[Parser]::ParseFile`（`ALL_PARSE_OK`）。此為 Windows PowerShell 5.1 以 `-File` 執行無 BOM 非 ASCII 腳本會誤解析的必要防護。

### 1.4 並行寫入核實

`ops\p3h\v15c-launcher\` 全部 20 個檔案的最後寫入時間落在 10:28:52–12:14:14，逐筆可對應本輪或第十八階段第一輪（Codex，最後 11:33:05）之作業。**11:33:05 之後無任何外部寫入**，停止條件未觸發。

---

## 2. 交付項 2：R-1 PID 狀態檔初始化 — 兩套設計

### 2.1 問題陳述

修補版啟動器以「pid + created_at」狀態檔（`django-v15c-pid.json`）作為所有權的第五項訊號（S5）。但正式環境從未建立過此檔（實測 ABSENT）。因此修補版首次執行時：

- 若無狀態檔即視為 OWNED → 等於把任何佔用 8022 的程序自動認定為自己人（**不可接受**）
- 若無狀態檔即 ABORT → 修補版永遠無法接管，需人工一次性初始化

R-1 要解決的正是「第一次怎麼安全地把狀態檔建立起來」。

### 2.2 方案 A：受控冷啟動（Cold Start）

**設計**

| 步驟 | 動作 | 責任方 |
|---|---|---|
| A1 | `Disable-ScheduledTask -TaskName 'FDE-AI v1.5C Classroom Server'` | 運維（需授權） |
| A2 | 確認 8022 無監聽者；若仍有，**人工**停止該程序 | 運維（需教師授權，腳本不執行） |
| A3 | 以 `$EnableAdoption = $false` 執行修補版啟動器一次 | 運維 |
| A4 | 啟動器啟動 Django → `Write-V15CStateRecord` 首次寫入（狀態檔不存在 → 必成功） | 腳本 |
| A5 | 驗證：狀態檔 `pid` == 實際 listener pid、`port` == 8022、`created_at` 在 ±2 秒容差內 | 運維 |
| A6 | 再次執行啟動器 → 應得 `8022 OWNED ... reuse` | 運維 |
| A7 | `Enable-ScheduledTask` 恢復排程 | 運維（需授權） |

**優點**：狀態檔的 pid 與 created_at 完全由「本次啟動」取得，是**唯一能達到最強身分證據**的路徑；不依賴任何推論。

**缺點**：必然停機（A2 必須先停 8022）；且需要教師授權終止現有 8022 程序。以現況 5 分鐘一循環計算，停機窗口至少 3–5 分鐘（含 A3–A6 驗證）。

**開關**：`$EnableAdoption = $false`（單行，已內建於 v3，第 34 行）。

### 2.3 方案 B：受控收養（Controlled Adoption）

**設計**（已實作為 `V15C-Adoption.ps1`，並掛上 `patched-v3.ps1`）

| 步驟 | 動作 |
|---|---|
| B1 | 停用排程（避免與 5 分鐘觸發競爭） |
| B2 | **不動 8022**，以 `$EnableAdoption = $true` 執行修補版啟動器一次 |
| B3 | `Test-IsV15CDjango` 回 `UNKNOWN` 且理由含 `state_record_absent` |
| B4 | 觸發 `Test-V15CAdoptionEligible`，逐項核驗 E1–E8（見下表） |
| B5 | 全數成立 → `Invoke-V15CAdoptionClaim` → 委派唯一寫入器 `Write-V15CStateRecord` 原子寫入 → log `8022 ADOPTED` |
| B6 | 任一項不成立、矛盾或不可取得 → 回 `UNKNOWN` → `Resolve-V15CListenerAction` 回 `ABORT` → **不終止、不啟動**，log 並 `throw`，人工介入 |
| B7 | 驗證後恢復排程 |

**八項證據（E1–E8）**

| 代號 | 證據 | 不成立時 |
|---|---|---|
| E1 | listener PID 與該埠實際擁有者一致 | UNKNOWN |
| E2 | 程序存在且建立時間可讀 | UNKNOWN |
| E3 | 命令列符合 `manage\.py\s+runserver` 且含 `127.0.0.1:8022` | 命令列不可讀 → UNKNOWN；可讀但明確不是本埠 Django → FOREIGN |
| E4a | venv 身分：listener 執行檔 == venv shim（self）或祖系（深度 ≤3）== shim，且 `pyvenv.cfg home` 與觀測到的直譯器相符 | UNKNOWN |
| E4b | 專案身分：`$V15Root\manage.py` 與 shim 專案根 `manage.py` 的 SHA-256 相等 | UNKNOWN |
| E4c | HTTP 指紋：`FDE-AI` + `csrfmiddlewaretoken` + `resend-verification` 三者皆命中（與 E7 共用同一次回應） | UNKNOWN |
| E5 | 直譯器關係：self 或祖系 == `$DjangoPython` | UNKNOWN |
| E6 | 證據收集完成後重讀 listener PID，與 E1 一致（防 PID 漂移） | UNKNOWN |
| E7 | 專屬健康檢查：HTTP 2xx/3xx | UNKNOWN |
| E8 | 無其他啟動器實例（程序掃描 + 實例互斥鎖） | UNKNOWN |

**明確排除的「偽證據」**（依指令要求）

- `/login/` 回應 200 **不構成**充分證據（A1 測試：200 但無指紋 → UNKNOWN）
- 共用 Python 路徑 **不構成**充分證據（A3 測試：shim 不符 → UNKNOWN）
- 單獨 PID + 健康檢查 **不構成**充分證據（A2 測試：命令列不可讀 → UNKNOWN）

**寫入安全**：`Write-V15CStateRecord` 使用 `FileStream(CreateNew)` + `Flush($true)` → `[System.IO.File]::Replace()`（40 次重試處理 sharing violation）→ 寫後回讀驗證 pid。**絕不退化為 delete+move**。單一所有者宣告：`existing_state_corrupt` 與 `existing_owner_alive` 皆拒絕寫入，且不覆寫仍存活的其他 owner。

**優點**：零停機。
**缺點**：身分證據為推論鏈；且**關鍵前提**是執行環境能讀到 8022 擁有者的 `CommandLine`。

### 2.4 關鍵風險：CommandLine 可讀性（未解除）

- 實測（T19）：**非提權 session** 對正式 8022 擁有者呼叫 `Get-CimInstance Win32_Process` 回傳空 `CommandLine` → E3 失敗 → `UNKNOWN`。
- 排程以 `RunLevel = Highest` 執行，理論上可讀，但**本階段不得在正式環境驗證**（會觸及 8022）。
- 因此方案 B 在排程環境下的可行性**尚未取得實證**，這是本階段最大的未解除風險（見 §12）。

### 2.5 建議：B 優先、A 兜底

維護窗口內先執行方案 B；若 B 回 `ABORT`（`adoption_evidence_insufficient`），8022 仍在原狀運作，此時可**在同一窗口內**改走方案 A（人工停 8022 → 冷啟動 → 狀態檔由本次啟動寫入）。兩者共用同一份 v3 補丁，只差一個開關。

---

## 3. 交付項 3：隔離補丁完整 Diff

`PATCH-v3.diff`（6,472 位元組，88 行，**3 hunks**），以 `original.ps1` 為基準：

### Hunk 1（L30 附近，+15 行）：模組載入與方案開關

```diff
 $InstanceMutexName = 'Global\FDE-AI-v15C-Classroom-Startup'
+$DjangoPidStateFile = Join-Path $StateRoot 'django-v15c-pid.json'
+# P3-H Phase 18 scheme switch. $true = controlled adoption of a pre-existing
+# listener (scheme B). $false = require a stopped 8022 before the first run
+# (scheme A). Both keep the no-auto-kill rule.
+$EnableAdoption = $true
+
+# P3-H Phase 17: process-ownership module (single source of truth, shared with contract tests).
+$OwnershipModule = Join-Path $GatewayRoot 'V15C-Ownership.ps1'
+if (-not (Test-Path -LiteralPath $OwnershipModule)) { throw "Ownership module not found: $OwnershipModule" }
+. $OwnershipModule
+
+# P3-H Phase 18: controlled adoption gate (scheme B). Depends on the module above.
+$AdoptionModule = Join-Path $GatewayRoot 'V15C-Adoption.ps1'
+if (-not (Test-Path -LiteralPath $AdoptionModule)) { throw "Adoption module not found: $AdoptionModule" }
+. $AdoptionModule
```

### Hunk 2（L182 附近，-13 / +30 行）：根因修復 + 三分支決策

移除原始的三行致命邏輯：

```diff
-$expectedDjangoExe = [System.IO.Path]::GetFullPath($DjangoPython)
 $django = Get-Listener $DjangoPort
 if ($django) {
-  $owner = Get-Process -Id $django.OwningProcess -ErrorAction SilentlyContinue
-  $ownerPath = if ($owner -and $owner.Path) { [System.IO.Path]::GetFullPath($owner.Path) } else { '' }
-  if ($ownerPath -and $ownerPath -ne $expectedDjangoExe) {
-    Add-Content -LiteralPath $StartupLog -Value "... STOPPING stale 8022 listener: PID=...; executable=$ownerPath"
-    Stop-Process -Id $django.OwningProcess -Force -ErrorAction SilentlyContinue
-    Start-Sleep -Seconds 2
-    $django = Get-Listener $DjangoPort
-    if ($django) { throw "Port $DjangoPort is still occupied by a non-v1.5C process." }
```

替換為三態判定 + REUSE／ADOPT／ABORT 三分支（`Stop-Process` 完全移除）。

### Hunk 3（L203 附近，+17 行）：原子寫入狀態檔

Django 上線後以 `Write-V15CStateRecord` 原子寫入；寫入失敗**僅記錄不中止**（Django 已上線，中止只損失可用性而不提升安全）。

### 與 v2 的差異

| 項目 | patched-v2 (`19124aed`) | patched-v3 (`a95a857b`) |
|---|---|---|
| 收養邏輯 | 無 | 有（`V15C-Adoption.ps1`） |
| 狀態檔缺失時 | 直接 `throw` | 先試收養，失敗才 `throw` |
| 方案開關 | 無 | `$EnableAdoption` |
| 行數 / hunks | 75 行 / 3 | 88 行 / 3 |

> `PATCH-v2.diff`（`1e8e4900`）與 `patched-v2.ps1`（`19124aed`）已成為過期產物，僅保留作歷史對照，**不作為交付依據**。

---

## 4. 交付項 4：原 17 項重跑結果（T1a–T27，共 30 個 Record）

`Test-V15CLauncherOwnership.ps1`（`3157570a`）完整保留，未修改一個字元，重跑兩次。

### 4.1 第一次重跑（12:04–12:07）：29 PASS / 1 FAIL

唯一失敗：

```
FAIL T19 prod 8022 read-only verdict is never OWNED without readable evidence
     :: verdict=UNKNOWN pid=26916->0 reasons=no_listener_on_port
```

**根因判定：環境性，非補丁缺陷。** `startup.log` 顯示 12:06:58 排程以舊版邏輯執行 `STOPPING stale 8022 listener: PID=26916`，正好落在 T19 的量測窗口內，導致 listener pid 由 26916 變為 0（埠暫時空出）。T19 的附帶斷言「pid 前後一致」因此不成立；其**主要安全斷言「不得為 OWNED」仍然成立**（`verdict=UNKNOWN`）。

### 4.2 第二次重跑（12:12–12:14）：30 PASS / 0 FAIL

`PROD_BEFORE 8022=28208 8770=14124 8030=0` → `PROD_AFTER 8022=28208 8770=14124 8030=0`（1 分 44 秒內無誤殺，故 T19 通過）。

### 4.3 逐項結果（第二次重跑）

| ID | 驗證內容 | 結果 | 關鍵實測 |
|---|---|---|---|
| T1a | 真實 Django 程序 → OWNED | PASS | `ancestor_exe_is_django_python depth=1` |
| T1b | venv shim 子程序（ancestor）→ OWNED | PASS | 同 T1a |
| T1c | listener 即 DjangoPython（self）→ OWNED | PASS | `listener_exe_is_django_python` |
| T2 | 重複檢查不重啟 | PASS | pid 不變 |
| T3 | 同 python、不同專案 → FOREIGN/UNKNOWN，存活 | PASS | `command_line_not_django_runserver_on_port` |
| T4 | 不同 python、其他伺服器 → FOREIGN/UNKNOWN，存活 | PASS | 同上 |
| T5 | PID 重用／建立時間不同 → UNKNOWN，存活 | PASS | `state_created_at_mismatch` |
| T6 | 命令列不可讀 → UNKNOWN，存活 | PASS | `command_line_unreadable` |
| T7 | 健康檢查失敗 → 不終止 | PASS | `health_failed status=0` |
| T8a | 狀態檔缺失 → UNKNOWN，存活 | PASS | `state_record_absent` |
| T8b | 狀態檔損壞 → UNKNOWN，存活 | PASS | `state_unreadable_or_corrupt` |
| T9 | 重複觸發不雙啟、不誤殺 | PASS | `started_count=3`、pid 不變 |
| T10 | 停止後埠空出、可再啟動 | PASS | `no_listener_on_port` |
| T11 | 不影響 8022/8770/8030 | PASS | 8770／8030 前後一致 |
| T12 | 僅清理自身測試程序 | PASS | 無洩漏埠 |
| T13 | 模組**從不**終止程序（AST） | PASS | `termination_calls=[]`、`command_asts=32` |
| T14 | 執行期間正式啟動器不變 | PASS | 前後 `a64330ef…` |
| T15 | 原子寫入：讀者從不見部分內容 | PASS | `writes=120 bad=0 empty=0 tmp_leftovers=0` |
| T16 | 併發啟動器：單一所有者勝出 | PASS | `loser_reason=existing_owner_alive` |
| T17 | 存活的外部 owner 不被覆寫 | PASS | `reason=existing_owner_alive` |
| T18 | 建立時間差 3 秒 → UNKNOWN，存活 | PASS | `state_created_at_mismatch` |
| T19 | 正式 8022 唯讀判定不得無證據為 OWNED | PASS | `verdict=UNKNOWN command_line_unreadable` |
| T20 | 健康 OK 但身分未證 → 不得 OWNED | PASS | `state_record_absent` |
| T21 | UNKNOWN → listener 存活、pid 不變 | PASS | — |
| T22 | 外部佔用者 → FOREIGN/UNKNOWN，存活 | PASS | — |
| T23 | 裸 `manage.py`（正式形態）→ OWNED，S7 中性 | PASS | `root_hint_absent` |
| T24 | 絕對路徑但屬其他專案 → FOREIGN，存活 | PASS | `root_hint_mismatch` |
| T25 | 重複觸發 OWNED×3，不重啟、狀態不動 | PASS | `state_unchanged=True mtime_unchanged=True` |
| T26 | 狀態檔損壞 → UNKNOWN + 拒絕寫入 | PASS | `reason=existing_state_corrupt` |
| T27 | 佔用者停止後重新啟動 → OWNED | PASS | `port_freed=True` |

---

## 5. 交付項 5：新增測試結果（R1–R12）

`Test-V15CPhase18Adoption.ps1`（`48a1e4e0`）本輪重寫，改接 v3 與統一寫入器，並新增 R1–R12。全套 **37 項全 PASS**。

### 5.1 R1–R12 逐項

| ID | 需求 | 實作方式（動態） | 結果 | 實測值 |
|---|---|---|---|---|
| **R1** | 首次冷啟動建立狀態 | 先停 listener → 確認埠空（`UNKNOWN/no_listener_on_port`）→ 啟動 → 原子寫入 → 重判 | PASS | `port_was_free=True pid=20300 written=True state_pid_port_ok=True verdict=OWNED` |
| **R2** | 既有合法程序受控收養 | 真實 listener + 無狀態檔 → E1–E8 → `Invoke-V15CAdoptionClaim` | PASS | `mode=ancestor decision=ADOPT claimed=True pid 20300→20300`（無重啟、無新程序） |
| **R3** | 外來程序不得收養 | `-m http.server` 佔用者 | PASS | `verdict=FOREIGN adopt=UNKNOWN ABORT/foreign_process claimed=False state_file=False alive=True` |
| **R4** | PID 重用不誤判 | 狀態檔帶**當前** pid 但 created_at = 2001 年 | PASS | `state_created_at_mismatch` → `ABORT`，存活 |
| **R5** | 建立時間不同不沿用舊狀態 | created_at 偏移 −3 秒 | PASS | 舊狀態判 `UNKNOWN` + `ABORT`；以正確 created_at 重寫後 → `OWNED` |
| **R6** | 命令列不可讀保持 UNKNOWN | 注入 `CommandLine=''` 的 provider | PASS | `E3_commandline_unreadable`，`claimed=False`，存活 |
| **R7** | 狀態檔損壞安全拒絕 | 寫入 `{corrupt` | PASS | `write=False/existing_state_corrupt untouched=True` |
| **R8** | **寫入中斷不產生半成品** | 子進程緊密迴圈寫入（`-AllowOverwrite`），本進程連續讀取並解析；**硬殺**子進程 ×3 輪 | PASS | `rounds=3 valid_after_kill=3 reads=2214 bad=0 openErr=0 tmp_leftovers=1` |
| **R9** | 排程重複觸發不產生雙實例 | 連續 5 次觸發 | PASS | `actions=ADOPT,REUSE,REUSE,REUSE,REUSE claims=1 listeners=1 new_processes=0` |
| **R10** | 健康檢查失敗不誤殺 | 指向死埠 | PASS | `UNKNOWN` + `ABORT`，pid 不變、存活 |
| **R11** | 模擬回滾後不終止未知程序 | 狀態檔指向**另一程序**的 pid，同時合法 listener 在跑 | PASS | `listener_alive=True other_alive=True`；AST 證明 **原始啟動器 `Stop-Process $django` 計數 = 1，修補版 = 0** |
| **R12** | 不影響正式 8022/8770/8030 | 前後快照 | PASS | `8770=14124→14124 8030=0→0`；8022 `23204→28208`（期間排程誤殺，已記錄，非本測試造成） |

### 5.2 R8 補充說明（誠實揭露）

3 輪硬殺後留下 **1 個 `.tmp.<guid>` 殘檔**。這是預期行為：子進程在 `Replace` 之前被殺，臨時檔來不及清除。關鍵性質仍然成立：

- **目標檔從未出現半成品**（2,214 次讀取，`bad=0`，`empty=0`）
- 殘檔命名為 `<state>.tmp.<32位GUID>`，**永不重用**，且 `FileMode::CreateNew` 保證不會覆蓋既有檔
- 下一輪成功寫入會產生新 GUID 臨時檔，殘檔不影響任何判定

### 5.3 原有 Phase 18 測試（T18-1..14、A1..A6、S1..S4）同步結果

全部 PASS，且已改接 v3：

- **S1** 確認 v3 含 `Test-V15CAdoptionEligible` / `Resolve-V15CListenerAction` / `Invoke-V15CAdoptionClaim` / `Write-V15CStateRecord` / `EnableAdoption` / `V15C-Adoption.ps1`
- **S2** AST 掃描：`Stop-Process` 共 2 處，`targets_django=0`，語法乾淨
- **S3** `non_ascii=0 bom=False bytes=19736`
- **S4** 正式啟動器前後 `a64330ef…` 不變

> 本輪修正了上一輪的測試缺陷：`fake_project.py` 的 v15c 頁面缺少 `P3H18-MARKER`（導致 T18-1/2/10/11/13 誤判 `health_failed status=200`）。已於 `FINGERPRINT` 中加入 `<!--P3H18-MARKER-->`，現全數通過。

---

## 6. 交付項 6：OWNED / FOREIGN / UNKNOWN 判定證據

### 6.1 判定樹

```
listener 存在？
├─ 否  → UNKNOWN（no_listener_on_port），可啟動
└─ 是
   ├─ 命令列可讀 且 明確不是本埠 Django runserver → FOREIGN
   └─ 其他
      ├─ interpreterOwned ∧ stateMatch ∧ healthOk → OWNED
      └─ 其餘 → UNKNOWN（附 reasons）
```

**任何分支都不終止程序**（T13 以 AST 證明 `termination_calls=[]`；R11 以 AST 對比證明原始啟動器 1 處、修補版 0 處）。

### 6.2 實測樣本（取自本輪日誌）

**OWNED**（T23，正式形態：裸 `manage.py`）
```
listener_pid_matches
command_line_is_django_runserver
root_hint_absent
ancestor_exe_is_django_python depth=1
state_record_matches
health_ok status=200
```

**FOREIGN**（T24，絕對路徑屬其他專案）
```
listener_pid_matches
command_line_is_django_runserver
root_hint_mismatch
  cmd_root=D:\AI_Cache\temp\p3h-v15c-tests-...\otherproj
  expected=D:\FDE-AI-UAS\v1.5C\student_portal
```

**UNKNOWN**（T19，正式 8022，非提權 session）
```
listener_pid_matches
command_line_unreadable
→ 無法取得 E3 → 不得為 OWNED，不得終止
```

### 6.3 生產拓撲實測（決定方案 B 可行性的關鍵）

| 項目 | 值 |
|---|---|
| `$V15Root` | `D:\FDE-AI-UAS\v1.5C\student_portal` |
| shim 專案根 | `C:\Users\admin\Documents\Codex\2026-08-30\new-chat\FDE-AI-v1.5\student_portal` |
| `$V15Root\manage.py` SHA-256 | `b30eeb4890cb6f315cc238313808f636db29e9906b61cc6f6051567156a0097b` |
| shim 專案根 `manage.py` SHA-256 | `b30eeb4890cb6f315cc238313808f636db29e9906b61cc6f6051567156a0097b` |
| **E4b 同源判定** | **成立（完全相同）** |
| venv shim 大小 | 262,144 B（redirector） |
| `pyvenv.cfg home` | `C:\Users\admin\.fde-ai\YoloRuntime\python\cpython-3.12.13-windows-x86_64-none` |
| **E4a 預期模式** | `ancestor`（listener = base python，其父 = shim）→ `HomeMatchesObserved` 應成立 |

**結論**：E4a／E4b 在生產上可成立；E3 取決於執行權限（見 §2.4）。

---

## 7. 交付項 7：Tunnel 既有 Stop-Process 風險唯讀審核

### 7.1 審核對象

| 站點 | 行號 | 程式碼 |
|---|---|---|
| S1 | L246 | `if ($existingTunnel) { Stop-Process -Id $existingTunnel.ProcessId -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2 }` |
| S2 | L268 | `Stop-Process -Id $startedTunnel.Id -Force -ErrorAction SilentlyContinue` |

### 7.2 七問審核

#### 站點 S1（終止既有 cloudflared）

**① PID 來源**
```powershell
$existingTunnel = Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" |
  Where-Object { $_.CommandLine -match "127\.0\.0\.1:$DjangoPort" } | Select-Object -First 1
```
即時查詢程序表，條件為「映像名為 cloudflared.exe」且「命令列含 `127.0.0.1:8022`」。**非**來自任何持久化狀態檔。

**② 是否核對建立時間** — **否**。全程無 `CreationDate` 比對。`tunnel-state.json` 實測內容為 `failure_count` / `last_tunnel_attempt` / `last_successful_tunnel` / `rate_limit_until`，**不含 pid，也不含 created_at**，因此根本沒有可比對的基準。

**③ 是否核對命令列與實際執行檔** —
- 命令列：**部分**。僅以子字串 `127\.0\.0\.1:8022` 過濾，未驗證是否為 `tunnel --url http://127.0.0.1:8022` 的完整形態，也未驗證 `--no-autoupdate` / `--protocol http2` 等本啟動器自用參數。
- 執行檔：**否**。只靠 `Name='cloudflared.exe'`，從未讀 `ExecutablePath`。

**④ PID 重用風險** — **存在但低**。
- 正面：PID 是即時查詢結果，非跨執行殘留；`Get-CimInstance` 與 `Stop-Process` 間隔極短。
- 負面：`Select-Object -First 1` 在多個 cloudflared 指向 8022 時會任選其一，無建立時間或啟動順序的消歧；理論上存在 TOCTOU 窗口。
- 限制：即使 PID 被回收，**殺傷範圍仍被 filter 限制**在「名為 cloudflared.exe 且命令列提到 127.0.0.1:8022」的程序。

**⑤ 是否可能終止其他專案程序** —
- 不同埠（8141 / 8111 / 8030）：**不會**，正則含埠號。
- 非 cloudflared 程序：**不會**，有映像名過濾。
- 另一個也連 `127.0.0.1:8022` 的 cloudflared：**會**，且無法區分。實務上幾乎不可能，但結構上未被排除。

**⑥ 是否影響 Cloudflare Tunnel 連線** — **會，且影響不可忽略**。
觸發條件：`$existingTunnel` 存在 **但** `Wait-Http "$last_successful_tunnel/login/" 30` 失敗。此時先殺舊 tunnel，再進入 5 次重試迴圈建立新 tunnel。

後果：
- 公開 URL 變更（新的 `*.trycloudflare.com` 主機名），Worker 的 `ORIGIN_URL` secret 需重新 `wrangler secret put`；持有舊連結的學員立即失效。
- **最嚴重**：舊 tunnel 在**新 tunnel 就緒之前**已被殺。若 5 次重試全失敗，結果是**完全沒有 tunnel**，且無回滾到舊 tunnel 的路徑。
- 實測頻率：`startup.log` 中 `REUSE existing tunnel` 4,202 次、`TUNNEL CREATED` 100 次 → 殺舊建新約占 **2.3%** 的週期，**非零**。以 5 分鐘一循環計，平均約每 3.6 小時發生一次。

**⑦ 是否需另立獨立修復階段** — **建議：是，優先級低於 R-1**。

理由：
- 目前為**潛伏風險**而非活動故障（觀測窗口內全部走 REUSE 分支）。
- 殺傷範圍比 8022 缺陷窄（有 name + port 雙重過濾，且無持久化陳舊 PID）。
- 但缺陷性質相同：**先殺後驗**而非**先驗後殺**，且**失敗無回滾**。

**最小修復建議（僅建議，本階段不修改正式腳本）**
1. **（最高價值）重排順序**：先啟動新 tunnel 並確認 URL ready，成功後才停止舊 tunnel。消除「完全無 tunnel」的窗口。
2. **TOCTOU 防護**：匹配時記錄 `CreationDate`，`Stop-Process` 前重讀，不一致則放棄並記錄。
3. **執行檔校驗**：要求 `ExecutablePath` 等於設定的 `$cloudflared`，而非僅 `Name`。
4. **持久化身分**：在 `tunnel-state.json` 增寫 `tunnel_pid` 與 `tunnel_created_at`，供下一輪正面識別。
5. **多匹配拒絕**：`Select-Object -First 1` 改為收集全部，`Count > 1` 時記錄並放棄（不殺）。

#### 站點 S2（終止本次啟動的 cloudflared）

| 問題 | 結論 |
|---|---|
| PID 來源 | `Start-Process -PassThru` 回傳的 .NET `Process` 物件，**本次執行自己啟動**，非查詢 |
| 核對建立時間 | 不需要（同一物件）；但**未檢查 `HasExited`** |
| 核對命令列／執行檔 | 不需要（自己啟動的） |
| PID 重用風險 | **極低**。唯一理論缺口：程序已退出且 PID 被回收後，`Stop-Process -Id` 可能命中新程序。窗口受 60 秒輪詢限制 |
| 終止其他專案程序 | **不會**（物件持有原始 PID 與控制代碼） |
| 影響 Tunnel 連線 | 會（這是重試路徑，本來就要丟棄失敗的 tunnel），但屬預期行為 |
| 需獨立修復階段 | **不需要**，併入 S1 同批處理即可 |

**最小修復建議**：`if ($startedTunnel -and -not $startedTunnel.HasExited) { Stop-Process -Id $startedTunnel.Id -Force -ErrorAction SilentlyContinue }`。

### 7.3 與 8022 缺陷的風險對比

| 維度 | 8022 缺陷（第十七階段已修） | Tunnel S1 |
|---|---|---|
| 觸發頻率 | **幾乎每輪**（4,725 次 / 29,731 行日誌） | ~2.3% 週期 |
| 誤殺對象 | 自己剛啟動的 Django（路徑永不相等） | 另一個 cloudflared（同名同埠） |
| 陳舊 PID | 無（即時查詢）但**判定邏輯錯誤** | 無（即時查詢），判定邏輯較窄 |
| 失敗後果 | 每 5 分鐘中斷 58–95 秒 | 公開 URL 變更，或完全無 tunnel |
| 是否已有回滾 | 有（下一輪重新啟動） | **無** |
| 修復優先級 | P0（已修） | P2（建議另立階段） |

---

## 8. 交付項 8：正式維護窗口計畫

### 8.1 前置條件（全部必須成立才可開窗）

1. 教師書面認可第十七、十八階段交付
2. 8022 / 8770 當前運作中且可接受短暫風險
3. 已備份：`C:\Users\admin\AppData\Local\FDE-AI\classroom\`（含 `startup.log`、`tunnel-state.json`）
4. 已備份正式啟動器（雖不改動，仍留副本）
5. 已確認 `D:\FDE-AI-Gateway\V15C-Ownership.ps1` 與 `V15C-Adoption.ps1` **尚未存在**（實測 False/False）
6. 運維在場，可執行 `Highest` 權限操作
7. 觀測窗口 ≥ 20 分鐘（4 個排程週期）

### 8.2 方案 A：受控停機切換

| 階段 | 動作 | 預估耗時 | 可回滾點 |
|---|---|---|---|
| A0 | 記錄基線：8022 pid/created、8770 pid、`startup.log` 行數 | 1 min | — |
| A1 | `Disable-ScheduledTask 'FDE-AI v1.5C Classroom Server'` | <1 min | 可（重新 Enable） |
| A2 | 人工停止 8022 程序（**需教師授權**） | <1 min | 可（重啟舊版一次） |
| A3 | 複製兩個模組到 `D:\FDE-AI-Gateway\` | <1 min | 可（刪除即可） |
| A4 | 以 `$EnableAdoption = $false` 執行 v3 一次 | 2–3 min | 可 |
| A5 | 驗證 `PID STATE WRITTEN` + 狀態檔內容 + `8022 OWNED` | 1 min | — |
| A6 | `Enable-ScheduledTask` | <1 min | — |
| A7 | 觀測 3–4 個週期（≥20 min），確認無 `STOPPING stale 8022` | 20 min | — |

**停機可能性**：**必然**（A2 起至 A4 Django 上線，約 3–5 分鐘）。
**所需權限**：管理員（排程 + 終止程序）、`Highest`。
**失敗處理**：A4 失敗 → Django 未上線 → 保留模組、`Enable` 排程讓舊版接管（見 §9 回滾警告）。

### 8.3 方案 B：不中斷收養切換

| 階段 | 動作 | 預估耗時 | 可回滾點 |
|---|---|---|---|
| B0 | 同 A0 | 1 min | — |
| B1 | `Disable-ScheduledTask` | <1 min | 可 |
| B2 | 複製兩個模組到 `D:\FDE-AI-Gateway\` | <1 min | 可 |
| B3 | 以 `$EnableAdoption = $true` 執行 v3 一次（**不動 8022**） | 1–2 min | 可 |
| B4a | log 出現 `8022 ADOPTED ... mode=ancestor` → 成功 | — | — |
| B4b | log 出現 `8022 UNKNOWN ... manual intervention required` → 收養證據不足 | — | **8022 仍原狀運作**，可轉方案 A |
| B4c | log 出現 `8022 ADOPTION CLAIM FAILED reason=...` → 寫入被拒 | — | 檢查狀態檔後重試或轉 A |
| B5 | 驗證狀態檔 `pid` == 實際 listener pid、`created_at` 在 ±2 秒內 | 1 min | — |
| B6 | `Enable-ScheduledTask` | <1 min | — |
| B7 | 觀測 3–4 個週期（≥20 min） | 20 min | — |

**收養失敗的安全退出**：B4b/B4c 時腳本 `throw`，**不終止任何程序、不啟動任何程序**；8022 維持原樣，服務不中斷。這是方案 B 的關鍵安全性質，已由 T18-3、R3、R10 驗證。

**停機可能性**：**零**（成功路徑）。
**所需權限**：管理員（排程）、`Highest`（CommandLine 可讀性）。
**失敗處理**：轉方案 A，同一窗口內完成。

### 8.4 兩方案比較

| 維度 | 方案 A 受控停機 | 方案 B 不中斷收養 |
|---|---|---|
| 停機 | **必然** 3–5 分鐘 | **零**（成功時） |
| 身分證據強度 | **最強**（pid/created 由本次啟動取得） | 推論鏈（E1–E8 全綠才成立） |
| 依賴 CommandLine 可讀 | 否 | **是**（E3） |
| 失敗後服務狀態 | 可能無 8022 | 8022 原狀運作 |
| 失敗後續路徑 | 回滾到舊版（有風險，見 §9） | 轉方案 A（同窗口） |
| 所需授權 | 教師授權終止 8022 | 無需終止任何程序 |
| 風險等級 | 中（有停機） | 低（失敗即退出） |
| 建議 | **兜底** | **首選** |

### 8.5 推薦執行順序

**B → （必要時）A**，理由：

1. 現況已處於「每 5 分鐘中斷一次」的劣化狀態，任何改善都優於現狀；方案 B 零停機，是最小代價的改善。
2. 方案 B 失敗不會讓情況變差（8022 原狀），因此可以安全地「先試」。
3. 方案 A 需要教師授權終止 8022，宜作為備案而非首選。

---

## 9. 交付項 9：回滾與故障處置方案

### 9.1 關鍵警告：恢復舊版啟動器**不是**無條件安全回滾

舊版 L185–197 的邏輯是：

```powershell
$expectedDjangoExe = [System.IO.Path]::GetFullPath($DjangoPython)   # venv shim
$owner = Get-Process -Id $django.OwningProcess
$ownerPath = [System.IO.Path]::GetFullPath($owner.Path)
if ($ownerPath -and $ownerPath -ne $expectedDjangoExe) {            # 永遠成立
    Stop-Process -Id $django.OwningProcess -Force
```

而 v1.5C 的 venv shim（262,144 B redirector）會**啟動子程序**，真正持有 8022 的是 base python（`...\YoloRuntime\python\cpython-3.12.13-...\python.exe`）。**shim 路徑與子程序路徑永不相等**，因此條件恆真。

實測證據：`startup.log` 中 `STOPPING stale 8022` 出現 **4,725 次**，本次作業 30 分鐘內即 6 次。

**因此：把正式啟動器還原成舊版，等於主動恢復「每 5 分鐘殺一次 8022」的循環。** 回滾不是安全網，而是重新引入已確認的 P0 缺陷。

### 9.2 回滾的正確前提與做法

**只有一個情況可以考慮回滾**：修補版導致 8022 **完全無法啟動**（比現況更差）。

即使如此，回滾必須是「**舊版 + 排程停用**」的組合，而非單純還原檔案：

| 步驟 | 動作 |
|---|---|
| R-1 | `Disable-ScheduledTask 'FDE-AI v1.5C Classroom Server'` |
| R-2 | 還原啟動器檔案（若有備份）或移除兩個模組 |
| R-3 | **保持排程停用** |
| R-4 | 由人工按需啟動一次，啟動後不再自動輪詢 |
| R-5 | 待補丁修正後重新開窗 |

**禁止**：還原舊版並恢復排程。這會直接回到 5 分鐘誤殺循環。

### 9.3 故障處置對照表

| 現象（`startup.log`） | 判讀 | 立即處置 | 是否需回滾 |
|---|---|---|---|
| `8022 ADOPTED pid=... mode=ancestor` | 方案 B 成功 | 恢復排程，觀測 20 分鐘 | 否 |
| `8022 OWNED pid=... reuse` | 正常重複觸發 | 無 | 否 |
| `8022 UNKNOWN ... manual intervention required` | 收養證據不足 | 不改任何東西（8022 仍在跑）；轉方案 A | 否 |
| `8022 ADOPTION CLAIM FAILED reason=existing_owner_alive` | 狀態檔被另一存活 owner 佔用 | 檢查 `django-v15c-pid.json`；備份後人工移走再重試 | 否 |
| `8022 ADOPTION CLAIM FAILED reason=existing_state_corrupt` | 狀態檔損壞 | 備份損壞檔後移走，重跑 | 否 |
| `8022 FOREIGN` | 8022 被非本專案程序佔用 | **立即停手**，人工判斷；**不得自動終止** | 否 |
| `Adoption module not found` | 模組未複製到 `D:\FDE-AI-Gateway\` | 補複製 | 否 |
| `v1.5C Django did not become available` | Django 啟動失敗 | 查 `django.err.log`；保留模組 | 視情況 |
| 觀測期內出現任何 `STOPPING stale 8022` | 修補未生效（跑到的還是舊版） | 停排程，確認檔案 SHA | 否 |
| 8022 埠無監聽且無 Django 程序 | 服務中斷 | 啟動舊版一次（**排程保持停用**） | 是（見 §9.2） |

### 9.4 觀測期驗收標準（≥ 3 個排程週期，建議 4 個 / 20 分鐘）

1. `startup.log` **不得**出現 `STOPPING stale 8022`
2. 8022 listener pid 除首次啟動／收養外**保持不變**
3. 每個週期應出現 `8022 OWNED ... reuse` 或 `8022 ADOPTED`
4. 8022 HTTP `/login/` 持續 200
5. 8770 保持 `14124`（或開窗時記錄的原值）不變
6. `django-v15c-pid.json` 的 `pid` 與實際 listener 一致
7. 若期間出現 Tunnel 重建（約 2.3% 機率），確認新 URL 已寫入 `current-tunnel-url.txt` 且 Worker 已更新

---

## 10. 交付項 10：PASS / FAIL / BLOCKED / NOT TESTED 統計

### 10.1 總計

| 類別 | 數量 |
|---|---|
| **PASS** | **67** |
| FAIL（最終接受輪） | **0** |
| FAIL（環境性，已記錄並以重跑證明） | 1（T19 第一次重跑） |
| BLOCKED | 4 |
| NOT TESTED | 3 |

拆解：所有權套件 30 + Phase 18 套件 37 = 67。

### 10.2 BLOCKED（無法在隔離環境安全模擬）

| # | 項目 | 原因 | 需要的條件 |
|---|---|---|---|
| B-1 | 以修補版對**正式 8022** 執行收養 | 需在正式環境執行修補版，屬維護窗口動作 | 教師認可 + 開窗 |
| B-2 | 排程環境（`Highest`）下 8022 擁有者 `CommandLine` 可讀性 | 需在 `Highest` 下查詢正式 8022 程序 | 開窗時的第一次執行 |
| B-3 | 真實 Windows 排程 5 分鐘觸發的雙實例防護 | 需修改／觸發正式排程（禁止） | 以 R9 的 5 次連續觸發近似模擬，已 PASS |
| B-4 | Tunnel 殺舊建新對 Cloudflare Worker / 公開 URL 的真實影響 | 需中斷正式 tunnel（禁止） | 另立階段，於維護窗口外的受控測試 |

### 10.3 NOT TESTED（超出本階段範圍）

| # | 項目 | 原因 |
|---|---|---|
| N-1 | 正式維護窗口的實際執行 | 指令明令「完成隔離測試與報告後停止，不得自行進入」 |
| N-2 | P3-H 隔離棧 8140／8141／8142 | 目前未運行（`netstat` 確認無監聽），非本階段對象 |
| N-3 | Cloudflare DNS / GitHub Pages 變更 | 明確禁止 |

### 10.4 誠實揭露

- **T19 第一次重跑 FAIL** 為環境性（排程誤殺落在量測窗口內），已以 `startup.log` 12:06:58 的 `STOPPING stale 8022: PID=26916` 逐筆對應，並以第二次重跑 30/30 證明。
- **R8 留下 1 個 `.tmp` 殘檔**，如實記錄（§5.2），未美化為 0。
- **R12 期間 8022 pid 由 23204 變為 28208**，如實記錄並註明非本測試造成（R12 僅斷言 8770／8030 不變）。
- 未以靜態程式碼檢查取代動態測試：所有 R 項與 T 項均為動態執行；AST 掃描（T13、R11）僅作為**補充**證據，不用於替代行為驗證。

---

## 11. 交付項 11：正式 8022 / 8770 / 8030 最終狀態

### 11.1 埠位狀態（2026-10-27 12:15）

| 埠 | 監聽 | PID | 說明 |
|---|---|---|---|
| **8022** | 是 | **28208** | v1.5C Django；期間被排程誤殺 3 次（23204 → 28208） |
| **8770** | 是 | **14124** | RAG 服務，**全程未變** |
| **8030** | 否 | — | 未運行（與開窗時一致） |
| 8140 / 8141 / 8142 | 否 | — | P3-H 隔離棧未運行 |
| 8110 / 8111 | 否 | — | DEMO 棧未運行 |

### 11.2 正式資產完整性

| 項目 | 狀態 |
|---|---|
| `D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1` | SHA 前後一致 `a64330ef…`，15,766 B，LWT 2026-10-11 12:48:53 |
| `D:\FDE-AI-Gateway\V15C-Ownership.ps1` | **不存在**（未部署） |
| `D:\FDE-AI-Gateway\V15C-Adoption.ps1` | **不存在**（未部署） |
| 排程 `FDE-AI v1.5C Classroom Server` | `Ready` / `admin` / `Highest` / `Interactive` / `PT5M`，**未修改** |
| 排程 `FDE-AI v1.5B Classroom Server` | `Disabled`，未觸碰 |
| `django-v15c-pid.json` | **ABSENT**（R-1 目標，未建立） |
| `tunnel-state.json` | 未修改（4 個欄位，無 pid） |
| 正式資料庫 / `MEDIA_ROOT` | 未觸碰 |
| Cloudflare Tunnel / DNS / GitHub Pages | 未觸碰 |
| 其他 16 個工作樹 | 未觸碰 |
| Git | 未 commit / push / merge / rebase / deploy |
| H3 ACTIVE | 未啟用 |

### 11.3 本輪對正式環境的唯一影響

**無。** 所有測試使用 18022／18023／18024／18025／18099 五個非正式埠，僅**讀取** 8022／8770／8030 的 listener PID。8022 的 3 次 PID 變化（26916→23204→28208）皆由既有排程與舊版啟動器造成，與本階段產物無關（測試腳本 AST 證明 0 處終止 `$django`）。

---

## 12. 交付項 12：是否建議進入維護窗口，及未解除風險

### 12.1 結論

**建議進入維護窗口**，採「**方案 B 優先、方案 A 兜底**」。

理由：

1. 現況可用率約 68%–81%（每 5 分鐘中斷 58–95 秒），是**正在發生的服務劣化**，不是理論風險。
2. 修補版已通過 67 項隔離驗證，其中包含「從不終止程序」的 AST 證明與 12 項 R-1 專項要求。
3. 方案 B 失敗時**不會讓情況變差**（8022 原狀運作、腳本 throw 退出），因此「先試」的風險可控。
4. 回滾路徑已被重新定義（§9.2）：不是「還原舊版」，而是「停排程 + 人工啟動」，避免回到誤殺循環。

### 12.2 未解除風險（按嚴重度排序）

| # | 風險 | 嚴重度 | 影響 | 緩解 |
|---|---|---|---|---|
| **U-1** | **`Highest` 環境下 8022 擁有者的 `CommandLine` 可讀性未實證** | **高** | 若不可讀 → E3 失敗 → 方案 B 必然 `ABORT` → 需轉方案 A（停機 3–5 分鐘） | 開窗第一步即觀察 log；`ABORT` 時 8022 無損，可立即轉 A。**不影響安全性，只影響是否需停機** |
| U-2 | 方案 B 的證據鏈為推論（E4a 依賴 `pyvenv.cfg home` 與祖系比對） | 中 | 理論上存在誤收養可能 | 已用 6 項測試（T18-4/5/6/8、A1–A5b、R3/R4/R6/R7）證明單一訊號不足；生產實測 manage.py SHA 相同、home 相符 |
| U-3 | Tunnel S1「先殺後建、失敗無回滾」 | 中 | 約 2.3% 週期可能導致公開 URL 變更或完全無 tunnel | 建議另立階段修復（§7.2 建議 1：先建後殺） |
| U-4 | R8 硬殺留下 `.tmp` 殘檔 | 低 | 無功能影響（GUID 唯一、CreateNew 不覆蓋） | 可加定期清理，非必要 |
| U-5 | 修補版首次部署需把兩個模組複製到 `D:\FDE-AI-Gateway\` | 低 | 漏複製 → `throw "module not found"`，8022 不受影響（腳本在啟動 Django 之前就失敗） | 開窗前以 `Test-Path` 預檢 |
| U-6 | 排程 `LogonTrigger` 與 `TimeTrigger` 同時存在 | 低 | 登入時可能與 5 分鐘週期疊加觸發 | 已由 `Global\FDE-AI-v15C-Classroom-Startup` 互斥鎖 + R9 驗證 |

### 12.3 開窗前的三個必須確認項

1. `Test-Path 'D:\FDE-AI-Gateway\V15C-Ownership.ps1'` → 應為 `True`（部署後）
2. `Test-Path 'D:\FDE-AI-Gateway\V15C-Adoption.ps1'` → 應為 `True`（部署後）
3. `(Get-FileHash 'D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1').Hash` → 應為 `a64330ef…`（確認未被他人改動）

---

## 13. 附錄：本輪新增／修改檔案

| 檔案 | 動作 | 說明 |
|---|---|---|
| `V15C-Adoption.ps1` | 重寫 | 移除重複的狀態寫入器，改為 `Invoke-V15CAdoptionClaim` 委派唯一寫入器 `Write-V15CStateRecord` |
| `start_fde_v15c_classroom.patched-v3.ps1` | 新增 | v3 補丁（收養分支 + 方案開關） |
| `PATCH-v3.diff` | 新增 | 對 `original.ps1` 的完整 Diff（88 行 / 3 hunks） |
| `Test-V15CPhase18Adoption.ps1` | 重寫 | 改接 v3 + 統一寫入器；新增 R1–R12（37 項） |
| `fake_project.py` | 修正 | v15c 頁面補上 `P3H18-MARKER` |
| `TEST_RESULTS_PHASE18_RERUN_2026-10-27.json` | 新增 | 37 項結果（`bf13f10f…`） |
| `TEST_RESULTS_PHASE18_OWNERSHIP_RERUN_2026-10-27.json` | 新增 | 29/30（`9a8b5947…`，含 T19 環境性失敗） |
| `TEST_RESULTS_PHASE18_OWNERSHIP_RERUN2_2026-10-27.json` | 新增 | 30/30（`7a00498d…`） |

**未修改**：`V15C-Ownership.ps1`（`adf7f8ec…`）、`Test-V15CLauncherOwnership.ps1`（`3157570a…`）、`original.ps1`（`a64330ef…`）、正式啟動器、排程、任何正式服務。

---

## 14. 停止聲明

本階段已依指令完成全部隔離測試與報告。

- 未修改正式 8022 啟動器
- 未停止／啟動／重啟正式 8022
- 未修改 Windows 排程
- 未修改 8770／8030
- 未修改正式資料庫及 `MEDIA_ROOT`
- 未修改 Cloudflare Tunnel／DNS／GitHub Pages
- 未修改其他工作樹
- 未對未知 PID 執行 `Stop-Process`
- 未繞過 safe-delete
- 未 commit／push／merge／rebase／deploy
- 未啟用 H3 ACTIVE

**未進入正式維護窗口，等待裁決。**
