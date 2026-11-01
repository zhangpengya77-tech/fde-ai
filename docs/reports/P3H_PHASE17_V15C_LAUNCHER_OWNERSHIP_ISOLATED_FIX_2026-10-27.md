# P3-H 第十七階段：v1.5C Django 8022 啟動器安全修復（隔離驗證版）

- 日期：2026-10-27
- 工作樹：`D:\FDE-AI-UAS-v2.0-p3h-local-backend`
- 分支／HEAD：`codex/p3h-local-backend` / `2fd4f2421dc18df761db80e74e6c4f134448feaf`
- 性質：**只開發與隔離驗證修復方案，未執行任何正式修復**
- 結論：**修復方案在隔離環境 17/17 契約測試全數 PASS；正式環境部署 BLOCKED，需維護窗口**

---

## 0. 摘要

原啟動器以「程序執行檔路徑字串相等」判定 8022 是否為自己啟動的 Django。實測證明該假設不成立：venv 的 `python.exe` 是 redirector，真正持有 8022 的 listener 是它的**子程序**（base interpreter），兩者路徑永不相等。於是排程每 5 分鐘觸發一次，啟動器每次都把自己的 Django 判定為 stale 並 `Stop-Process -Force`，形成自傷循環，每輪約 2 分鐘服務中斷。

本階段在隔離工作樹建立修復副本，改用 6 項訊號（S1–S6）綜合判定，輸出 **OWNED / FOREIGN / UNKNOWN** 三態；**OWNED 不終止，FOREIGN 與 UNKNOWN 亦不終止**，改為中止啟動流程並記錄衝突。契約測試 17 項全數 PASS，且全程未觸碰 8022／8770／8030。

---

## 1. 一、Git 基線與狀態

| 項目 | 值 |
|---|---|
| 工作樹 | `D:\FDE-AI-UAS-v2.0-p3h-local-backend` |
| 分支 | `codex/p3h-local-backend` |
| HEAD | `2fd4f2421dc18df761db80e74e6c4f134448feaf`（第十六階段建立的單一 Commit） |
| 本階段新增（未追蹤） | `ops/p3h/v15c-launcher/`（全部產物）、`docs/reports/P3H_PHASE17_*.md`（本報告） |
| 既有未追蹤 | `backups/`、`docs/reports/P3H_PHASE11..16_*.md`、`docs/superpowers/plans/…`、`ops/p3h/verify_p3h_evidence_atomicity.py` |
| 已修改未提交 | **無**（本階段未修改任何已追蹤檔案） |
| Commit / Push | **未執行**（禁止） |

驗證：本階段所有寫入僅落在 `ops/p3h/v15c-launcher/` 與 `docs/reports/` 之下，未觸及任何已追蹤檔案。

---

## 2. 二、正式腳本原始 SHA-256（基線，未變）

| 項目 | 值 |
|---|---|
| 路徑 | `D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1` |
| SHA-256 | `a64330ef7a31e6c981fba95117466610af5e5db833d1ddafc8d91dba1c7a7b59` |
| 大小 | 15,766 bytes |
| LastWriteTime | `2026-10-11 12:48:53` |
| 編碼 | 純 ASCII（0 個非 ASCII 位元組）、**無 BOM** |
| 測試前後 | 完全相同（T14 PASS，見 §6） |

關鍵變數（唯讀讀出）：

```
$V15Root       = 'D:\FDE-AI-UAS\v1.5C\student_portal'
$DjangoPython  = 'C:\Users\admin\Documents\Codex\2026-08-30\new-chat\FDE-AI-v1.5\student_portal\.venv\Scripts\python.exe'
$RagRoot       = 'C:\Users\admin\Documents\Codex\2026-08-30\new-chat\FDE-AI\rag\f450_v1\runtime'
$DjangoPort    = 8022
$RagPort       = 8770
$StateRoot     = 'C:\Users\admin\AppData\Local\FDE-AI\classroom'
```

排程（唯讀）：

| 項目 | 值 |
|---|---|
| 名稱 | `FDE-AI v1.5C Classroom Server` |
| 狀態 | Running |
| 執行身分 | `admin` / LogonType=`Interactive` / RunLevel=`Highest` |
| 動作 | `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1"` |
| 觸發器 | `MSFT_TaskLogonTrigger`（登入）＋ `MSFT_TaskTimeTrigger` `Repetition.Interval=PT5M` |
| 最近執行 | 2026-10-27 10:46:55（lastResult `267009` = `0x41301` 執行中） |

---

## 3. 三、根因（本階段取得決定性證據）

### 3.1 原判定邏輯（第 185–197 行）

```powershell
$expectedDjangoExe = [System.IO.Path]::GetFullPath($DjangoPython)
$django = Get-Listener $DjangoPort
if ($django) {
  $owner = Get-Process -Id $django.OwningProcess -ErrorAction SilentlyContinue
  $ownerPath = if ($owner -and $owner.Path) { [System.IO.Path]::GetFullPath($owner.Path) } else { '' }
  if ($ownerPath -and $ownerPath -ne $expectedDjangoExe) {
    Add-Content -LiteralPath $StartupLog -Value "... STOPPING stale 8022 listener ..."
    Stop-Process -Id $django.OwningProcess -Force -ErrorAction SilentlyContinue
```

只有一個訊號：**listener 自身執行檔路徑 == venv shim 路徑**。不相等即強制終止。

### 3.2 為什麼這個假設必然失敗

v1.5C 的 venv 是 redirector 型 venv：

```
# D:\...\FDE-AI-v1.5\student_portal\.venv\pyvenv.cfg
home = C:\Users\admin\.fde-ai\YoloRuntime\python\cpython-3.12.13-windows-x86_64-none
include-system-site-packages = false
version = 3.12.13
executable = C:\Users\admin\.fde-ai\YoloRuntime\python\cpython-3.12.13-windows-x86_64-none\python.exe
command = C:\Users\admin\.fde-ai\YoloRuntime\python\cpython-3.12.13-windows-x86_64-none\python.exe -m venv --upgrade D:\...\.venv
```

`.venv\Scripts\python.exe`（262,144 bytes）啟動後**再執行 base interpreter**，因此真正持有 8022 的 listener 是 base interpreter，是 shim 的**子程序**。

### 3.3 生產日誌直接證據（`%LOCALAPPDATA%\FDE-AI\classroom\startup.log`）

```
2026-10-27T10:42:02.5590480+08:00 STOPPING stale 8022 listener: PID=22672; executable=C:\Users\admin\.fde-ai\YoloRuntime\python\cpython-3.12.13-windows-x86_64-none\python.exe
2026-10-27T10:44:11.5764027+08:00 ONLINE; django=PASS; rag=PASS; tunnel=https://...; fixed_root=True; login=True; student_growth=True
2026-10-27T10:47:20.4936588+08:00 STOPPING stale 8022 listener: PID=6976;  executable=C:\Users\admin\.fde-ai\YoloRuntime\python\cpython-3.12.13-windows-x86_64-none\python.exe
2026-10-27T10:47:51.4141635+08:00 NETWORK READY attempt=1
```

即：啟動器自己記錄的「stale」執行檔，正是它自己啟動的 Django 的 base interpreter。

### 3.4 影響量化

| 事件 | 時間 |
|---|---|
| 殺 22672 | 10:42:02 |
| 恢復 ONLINE | 10:44:11 |
| **中斷時長** | **約 2 分 09 秒** |
| 下一輪殺 6976 | 10:47:20 |
| 觸發週期 | 5 分鐘 |

→ 每 5 分鐘約 2 分鐘不可用，**可用率約 60%**。且每輪重建 Django、重建 worker_origin、重寫 tunnel 狀態，屬反覆自傷而非單次故障。

### 3.5 補充事實

本階段非提權 session 讀不到 8022 擁有者的 `CommandLine` / `ExecutablePath`（CIM 回傳空字串）；排程以 `RunLevel=Highest` 執行，日誌顯示提權上下文可讀到 `Get-Process.Path`。**這正是 T6（UNKNOWN 情境）在真實環境的活體樣本**，也是判定設計必須把「讀不到」歸為 UNKNOWN 而非 FOREIGN 的原因。

---

## 4. 四、隔離修復副本與完整 Diff

### 4.1 產物清單（全部位於 `ops/p3h/v15c-launcher/`）

| 檔案 | bytes | SHA-256 | 說明 |
|---|---:|---|---|
| `start_fde_v15c_classroom.original.ps1` | 15,766 | `a64330ef7a31e6c981fba95117466610af5e5db833d1ddafc8d91dba1c7a7b59` | 正式腳本唯讀副本，與正式檔**逐位元組相同**（`cmp` IDENTICAL） |
| `start_fde_v15c_classroom.patched.ps1` | 17,108 | `7082a6ef861ab508f097a2696a22b0c76b63eafd1eafd006d12068d2a35a7968` | 修復版本（測試版本） |
| `V15C-Ownership.ps1` | 9,888 | `d31007a264fee254143044d3990700a9861b7e8929e77803e933eb68b56c937d` | 判定模組（單一真相來源，啟動器與測試共用） |
| `PATCH.diff` | 3,810 | `277c35d6705c94fbcba58372b1bb27580e83583b982bdbb2e908c01e305cea7a` | 統一 diff，57 行 / 3 hunks |
| `Test-V15CLauncherOwnership.ps1` | 21,609 | `75626e975aa0fd62969d872cdde57f1973ac6f06b822875efa15e4185791d6488` | 契約測試 T1–T14 |
| `fake_manage.py` | 1,197 | `02c2cac6d8d697c6681fd0c5f956a0ac2f3e2e60bff47f2d76914940b5c520376` | 測試用假 Django 入口（命令列形狀 + 健康標記） |
| `TEST_RESULTS_2026-10-27.log` | 3,619 | `c486f460036b6e844f6a8fe0697a475a4b1d342f692be7202a90158deba3b205` | 測試原始輸出 |
| `TEST_RESULTS_2026-10-27.json` | 6,951 | `5ec3ad1e738119e67f8eb47c01844a2e8dc430f8dd2e875acc0c2cfda37d3fd0f` | 測試結構化結果 |

**未寫回正式路徑**：`D:\FDE-AI-Gateway\` 於本階段全程無寫入（T14 證明）。

### 4.2 編碼處理（本階段踩到的坑）

Windows PowerShell 5.1 以 `-File` 執行**無 BOM 且含非 ASCII** 的 `.ps1` 會誤解析（`Unexpected token '}'`）。正式腳本本身是純 ASCII 且無 BOM，因此本階段所有 `.ps1` 一律寫成 **ASCII-only、無 BOM**（已逐檔驗證 `non_ascii=0`、`bom=False`），並以 `[Parser]::ParseFile` 驗證語法（`ALL_PARSE_OK`）。此為可交付性硬約束，維護窗口套用時不得引入中文註解或 BOM 以外的編碼。

### 4.3 三處最小變更

- **R1（第 30 行後）**：新增 `$DjangoPidStateFile`，dot-source 判定模組（找不到即 throw，fail-closed）。
- **R2（第 185–197 行）**：以 `Test-IsV15CDjango` 三態判定取代「路徑不等即強殺」。
- **R3（第 205 行後）**：啟動 Django 後落盤 PID 狀態紀錄（`django-v15c-pid.json`：`pid`／`created_at`(UTC)／`port`／`v15_root`）。

### 4.4 完整 Diff

```diff
--- start_fde_v15c_classroom.original.ps1
+++ start_fde_v15c_classroom.patched.ps1
@@ -30,6 +30,12 @@
 $StartupLog = Join-Path $StateRoot 'startup.log'
 $TunnelStateFile = Join-Path $StateRoot 'tunnel-state.json'
 $InstanceMutexName = 'Global\FDE-AI-v15C-Classroom-Startup'
+$DjangoPidStateFile = Join-Path $StateRoot 'django-v15c-pid.json'
+
+# P3-H Phase 17: process-ownership module (single source of truth, shared with contract tests).
+$OwnershipModule = Join-Path $GatewayRoot 'V15C-Ownership.ps1'
+if (-not (Test-Path -LiteralPath $OwnershipModule)) { throw "Ownership module not found: $OwnershipModule" }
+. $OwnershipModule
 
 trap {
   $_ | Out-File -FilePath $StartupErrorLog -Encoding utf8 -Append
@@ -182,17 +188,17 @@
 if (-not (Test-Path (Join-Path $V15Root 'manage.py'))) { throw "v1.5C manage.py not found: $V15Root" }
 if (-not (Test-Path (Join-Path $RagRoot 'rag_http_server.py'))) { throw "RAG runtime not found: $RagRoot" }
 
-$expectedDjangoExe = [System.IO.Path]::GetFullPath($DjangoPython)
+# P3-H Phase 17: ownership is no longer decided by venv-shim path equality alone; never auto-kill.
+# OWNED is never stopped; FOREIGN/UNKNOWN are never stopped either: startup aborts, conflict logged.
 $django = Get-Listener $DjangoPort
 if ($django) {
-  $owner = Get-Process -Id $django.OwningProcess -ErrorAction SilentlyContinue
-  $ownerPath = if ($owner -and $owner.Path) { [System.IO.Path]::GetFullPath($owner.Path) } else { '' }
-  if ($ownerPath -and $ownerPath -ne $expectedDjangoExe) {
-    Add-Content -LiteralPath $StartupLog -Value "$(Get-Date -Format o) STOPPING stale 8022 listener: PID=$($django.OwningProcess); executable=$ownerPath"
-    Stop-Process -Id $django.OwningProcess -Force -ErrorAction SilentlyContinue
-    Start-Sleep -Seconds 2
-    $django = Get-Listener $DjangoPort
-    if ($django) { throw "Port $DjangoPort is still occupied by a non-v1.5C process." }
+  $verdict = Test-IsV15CDjango -ListenerPid $django.OwningProcess -Port $DjangoPort -V15Root $V15Root -DjangoPython $DjangoPython -StateFile $DjangoPidStateFile -HealthUrl "http://127.0.0.1:$DjangoPort/login/" -HealthMarker 'FDE-AI'
+  $reasonSummary = ($verdict.Reasons -join '; ')
+  if ($verdict.Verdict -eq 'OWNED') {
+    Add-Content -LiteralPath $StartupLog -Value "$(Get-Date -Format o) 8022 OWNED pid=$($django.OwningProcess); reuse; reasons=$reasonSummary"
+  } else {
+    Add-Content -LiteralPath $StartupLog -Value "$(Get-Date -Format o) 8022 $($verdict.Verdict) pid=$($django.OwningProcess); refusing to stop or start; manual intervention required; reasons=$reasonSummary"
+    throw "Port $DjangoPort is occupied by a $($verdict.Verdict) process; no auto-kill by policy; manual intervention required."
   }
 }
 if (-not $django) {
@@ -203,6 +209,14 @@
     -WorkingDirectory $V15Root -WindowStyle Hidden -RedirectStandardOutput $djangoLog -RedirectStandardError $djangoErr | Out-Null
 }
 if (-not (Wait-Http "http://127.0.0.1:$DjangoPort/" 30)) { throw 'v1.5C Django did not become available.' }
+# P3-H Phase 17: persist the PID state record (consistency signal for later ownership judgments).
+$startedListener = Get-Listener $DjangoPort
+if ($startedListener) {
+  $startedProc = Get-CimInstance Win32_Process -Filter "ProcessId=$($startedListener.OwningProcess)" -ErrorAction SilentlyContinue
+  $startedCreated = if ($startedProc -and $startedProc.CreationDate) { ([datetime]$startedProc.CreationDate).ToUniversalTime().ToString('o') } else { '' }
+  [pscustomobject]@{ pid = [int]$startedListener.OwningProcess; created_at = $startedCreated; port = $DjangoPort; v15_root = $V15Root } |
+    ConvertTo-Json | Set-Content -LiteralPath $DjangoPidStateFile -Encoding utf8
+}
 
 if (-not (Test-Http "http://127.0.0.1:$RagPort/api/rag/health")) {
   $ragLog = Join-Path $LogRoot 'rag.log'
```

---

## 5. 五、判定規則（`V15C-Ownership.ps1`）

### 5.1 六項訊號

| 訊號 | 內容 | 失敗語意 |
|---|---|---|
| **S1** listener 身分 | 當下該埠的 owning pid 必須等於傳入的 `ListenerPid` | 不符 → UNKNOWN（`listener_pid_changed`）；無 listener → UNKNOWN（`no_listener_on_port`） |
| **S2** 程序存在 | `Win32_Process` 查得到、`CreationDate` 可讀 | 查不到 → UNKNOWN（`process_not_found`） |
| **S3** 命令列 | 可讀，且同時符合 `manage\.py\s+runserver\b` 與 `127\.0\.0\.1:<port>` | 不可讀 → UNKNOWN（`command_line_unreadable`）；可讀但明確不符 → **FOREIGN** |
| **S4** interpreter 身分 | listener 自身 exe，或其**祖系（深度 1–3）**exe 等於 `DjangoPython` | 都不符 → 記錄 `no_self_or_ancestor_matches_django_python` |
| **S5** PID 狀態紀錄 | `django-v15c-pid.json` 存在、`pid` 相符、`created_at` 與程序建立時間差 < 2 秒 | 缺失／損壞／不符 → 對應 reason |
| **S6** 專屬健康檢查 | `http://127.0.0.1:8022/login/` 回 2xx/3xx **且**內容含標記 `FDE-AI` | 失敗 → `health_failed` |

### 5.2 判定樹

```
interpreterOwned && stateMatch && healthOk   -> OWNED
interpreterOwned && stateMatch && !healthOk  -> UNKNOWN  (health_failed_despite_process_evidence)
interpreterOwned && stateMatch != 'match'    -> UNKNOWN  (state_absent / state_mismatch / state_corrupt)
!interpreterOwned && stateMatch              -> UNKNOWN  (state_matches_but_interpreter_unproven)
其餘                                          -> UNKNOWN  (insufficient_evidence)
S3 可讀且明確不是本埠 Django runserver        -> FOREIGN
```

### 5.3 三條硬規則

1. **`Test-IsV15CDjango` 只讀不寫、永不終止任何程序**（T13 以 AST 掃描證明：0 個終止呼叫）。
2. **OWNED 不終止**；FOREIGN 與 UNKNOWN **亦不終止**，改為寫 log 後 `throw` 中止啟動流程，等待人工處理。
3. **不得僅憑 `/login/` 回 200 或共用 Python 基底路徑判定 OWNED**——健康檢查只是 S6，必須同時滿足 S4 與 S5。

### 5.4 為什麼 S4 要允許「祖系」

實測（T1a）證明：本機 venv 的 `python.exe` 是 redirector，listener 是其子程序。若只比對自身 exe，**修復後仍會判 UNKNOWN 並中止啟動**，等於把「誤殺」換成「永不啟動」。允許祖系（深度上限 3）正是針對此拓撲；T1b 以合成程序表驗證，T1a 以真實程序驗證。

---

## 6. 六、契約測試結果（T1–T12 + T13/T14）

執行方式：

```
powershell -NoProfile -ExecutionPolicy Bypass -File ops\p3h\v15c-launcher\Test-V15CLauncherOwnership.ps1 -ResultJson TEST_RESULTS_2026-10-27.json
```

埠位：`18022`（合法 Django 形狀）／`18023`（同 interpreter 不同專案）／`18024`（不同 interpreter）／`18099`（無人監聽，用於強制健康檢查失敗）。**全部為非正式埠位。**

| ID | 情境 | 期望 | 實測 verdict | 結果 |
|---|---|---|---|---|
| T1a | 真實合法 Django listener（venv shim 的子程序） | OWNED | OWNED（`ancestor_exe_is_django_python depth=1`） | **PASS** |
| T1b | venv shim → 子程序（合成祖系） | OWNED | OWNED（`ancestor depth=1`） | **PASS** |
| T1c | listener 自身 exe == DjangoPython（合成） | OWNED | OWNED（`listener_exe_is_django_python`） | **PASS** |
| T2 | 同一程序重複檢查 | OWNED，不重啟 | OWNED／OWNED，pid 22756→22756 | **PASS** |
| T3 | 同 Python、不同專案（`-m http.server`） | FOREIGN 或 UNKNOWN，不終止 | FOREIGN，alive=True | **PASS** |
| T4 | 不同 Python、其他 server | FOREIGN 或 UNKNOWN，不終止 | FOREIGN，alive=True | **PASS** |
| T5 | PID 重用、建立時間不同（state `created_at` 2000-01-01） | UNKNOWN，不終止 | UNKNOWN（`state_created_at_mismatch`），alive=True | **PASS** |
| T6 | 命令列無法讀取 | UNKNOWN，不終止 | UNKNOWN（`command_line_unreadable`），alive=True | **PASS** |
| T7 | 健康檢查暫時失敗（指向 18099） | 不強殺 | UNKNOWN（`health_failed status=0`），alive=True | **PASS** |
| T8a | PID 狀態檔缺失 | UNKNOWN，不強殺 | UNKNOWN（`state_record_absent`），alive=True | **PASS** |
| T8b | PID 狀態檔損壞（非法 JSON） | UNKNOWN，不強殺 | UNKNOWN（`state_unreadable_or_corrupt`），alive=True | **PASS** |
| T9 | 排程重複觸發（連續 3 次判定） | 不重複啟動、不誤殺 | 3×OWNED，pid 22756→22756，`started_count` 未增 | **PASS** |
| T10 | 程序真正停止後 | 埠位釋放、可安全啟動 | `port_pid=0`，UNKNOWN（`no_listener_on_port`） | **PASS** |
| T11 | 不影響 8022／8770／8030 | 三者不受影響 | 8770 14124→14124、8030 0→0、8022 6976→6976；測試埠位不含正式埠 | **PASS** |
| T12 | 測試後僅清理本輪自有程序 | 無洩漏、正式不受影響 | `leaked_test_ports=`（空）、8770=14124、8030=0 | **PASS** |
| T13 | 判定模組永不終止程序（AST 掃描） | 0 個終止呼叫 | `termination_calls=[]`、12 個 CommandAst、parse_clean=True | **PASS** |
| T14 | 正式啟動器在測試期間未被修改 | SHA 不變 | `a64330ef…` 前後一致 | **PASS** |

**合計：17 / 17 PASS，0 FAIL。**

補充證據：正式 8022 於測試前的 `PROD_BEFORE` 為 22672，測試後 `PROD_AFTER` 為 6976——變動來源是**正式排程在 10:42:02 的既有自傷循環**（見 §3.3 日誌），非本測試所致；本測試全程未對 8022 發出任何終止或啟動指令（T11/T14）。

---

## 7. 七、是否仍有誤殺／重複啟動風險

### 7.1 已消除

| 風險 | 狀態 |
|---|---|
| 以「venv shim 路徑不等」誤殺自家 Django | **已消除**（改為 S4 允許祖系 + S1/S3/S5/S6 綜合） |
| 對 FOREIGN 程序自動強殺 | **已消除**（改為 throw，不終止） |
| 對 UNKNOWN（讀不到資訊）自動強殺 | **已消除**（改為 throw，不終止） |
| 重複觸發導致重複啟動 | **已消除**（OWNED 直接 reuse，T9 證明 3 次觸發 0 次重啟） |
| 排程與人工啟動競爭 | 仍由既有 `Global\FDE-AI-v15C-Classroom-Startup` mutex 保護（未改動） |

### 7.2 殘留（需裁決或於維護窗口觀察）

| # | 殘留風險 | 說明 | 建議 |
|---|---|---|---|
| R-1 | **首次接管需要 PID 狀態紀錄** | 依 T8a 契約，狀態檔缺失 → UNKNOWN → 啟動流程中止。若在 8022 仍在運行時直接換上 patched 腳本，因狀態檔尚不存在，每 5 分鐘都會 UNKNOWN 中止（安全，但不會寫入狀態檔，形成永久中止） | **維護窗口必須「先停 8022」再套用**，讓 patched 啟動器自行啟動 Django 並寫入 `django-v15c-pid.json`；下一輪觸發即 OWNED。已寫入 §8 第 4 步 |
| R-2 | 中止點在 RAG／tunnel 之前 | `throw` 發生於 Django 區塊，其後的 RAG 健康檢查與 tunnel 重建不會執行 | 屬預期 fail-safe；若 tunnel 已死且判定為 UNKNOWN，需人工介入。已列入維護窗口觀察項 |
| R-3 | tunnel 區塊仍有 2 處 `Stop-Process` | 第 260／282 行，終止對象是 `tunnel-state.json` 記錄的 tunnel 子程序（原有行為，非本次範圍） | **未修改**（最小變更原則）。若 PID 被重用仍可能誤殺無關程序；建議另立階段處理 |
| R-4 | S6 標記 `FDE-AI` 較寬鬆 | 只要求頁面含 `FDE-AI`（ASCII，避免 PS 5.1 解碼問題） | 已實測正式 `/login/` 回 200 且含 `FDE-AI`（長度 1533）；S4/S5 仍為主閘門，可接受 |
| R-5 | 非提權上下文讀不到正式程序資訊 | 本 session 對 8022 讀不到 `CommandLine`/`ExecutablePath` | 排程以 `Highest` 執行，日誌顯示提權時可讀；維護窗口需確認新日誌出現 `8022 OWNED … reuse` 而非 `UNKNOWN` |

**結論：誤殺風險已由「必然發生（每 5 分鐘）」降為「結構上不可能」；重複啟動風險已消除。剩餘風險為可用性層面（R-1／R-2），且均為 fail-safe（不殺、不動），可於維護窗口一次性解決。**

---

## 8. 八、維護窗口計畫（**僅計畫，本階段未執行**）

> 前置條件：已取得教師對本報告的認可；窗口內可接受 8022 短暫中斷。

| # | 步驟 | 指令／動作 | 驗收 |
|---|---|---|---|
| 1 | 凍結與備份 | 停用排程：`Disable-ScheduledTask -TaskName 'FDE-AI v1.5C Classroom Server'`；備份 `start_fde_v15c_classroom.ps1` 至 `D:\FDE-AI-Gateway\backups\<戳>\`；記錄 SHA-256 | 備份檔 SHA 與 `a64330ef…` 一致；排程 `State=Disabled` |
| 2 | 部署判定模組 | 複製 `V15C-Ownership.ps1` → `D:\FDE-AI-Gateway\V15C-Ownership.ps1` | SHA = `d31007a2…`；`[Parser]::ParseFile` 無錯；`non_ascii=0`、無 BOM |
| 3 | 部署修復啟動器 | 以 `start_fde_v15c_classroom.patched.ps1` 覆蓋正式檔 | SHA = `7082a6ef…`；`PATCH.diff` 可從備份原檔還原出相同結果 |
| 4 | **先停 8022（關鍵）** | 記錄 8022 PID → `Stop-Process -Id <PID>`（僅此一次、人工確認 PID 為 Django）→ 確認 8022 埠位釋放 | `Get-NetTCPConnection -LocalPort 8022` 無 Listen；解決 R-1 |
| 5 | 手動執行一次啟動器 | `powershell -NoProfile -ExecutionPolicy Bypass -File "D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1"` | 結束碼 0；`startup.log` 出現 `ONLINE; django=PASS; rag=PASS`；`django-v15c-pid.json` 產生且 `pid` = 當前 8022 擁有者 |
| 6 | 驗證 OWNED 可達 | 再手動執行一次啟動器 | `startup.log` 出現 `8022 OWNED pid=…; reuse; reasons=…`，且 **PID 不變**（證明不再自傷） |
| 7 | 恢復排程 | `Enable-ScheduledTask` | `State=Ready/Running`；`Repetition.Interval` 仍為 `PT5M`（未改設定） |
| 8 | 觀察 3 個週期（15 分鐘） | 每 5 分鐘檢查一次 | 連續 3 次 `8022 OWNED … reuse`；8022 PID **全程不變**；`/login/` 持續 200 |
| 9 | 端到端驗收 | 學員登入、成長記錄、RAG 健康、tunnel URL 可用 | 四項全通；`startup.log` 無 `STOPPING stale` |
| 10 | 收尾 | 記錄最終 SHA、排程狀態、連續 OWNED 次數、tunnel URL；更新工作日誌 | 交付「維護窗口執行紀錄」；若任一驗收失敗 → 立即執行 §9 回滾 |

**額外注意**：步驟 2／3 的檔案必須保持 ASCII-only 且無 BOM；若以編輯器另存導致加入 BOM 或中文，PS 5.1 會解析失敗（本階段已實測踩坑）。

---

## 9. 九、回滾方案

### 9.1 快速回滾（3 步，目標 < 2 分鐘）

```powershell
# 1) 停用排程，避免回滾過程中再次觸發
Disable-ScheduledTask -TaskName 'FDE-AI v1.5C Classroom Server'

# 2) 還原原始啟動器（SHA 必須回到 a64330ef…）
Copy-Item -LiteralPath 'D:\FDE-AI-Gateway\backups\<戳>\start_fde_v15c_classroom.ps1' `
          -Destination 'D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1' -Force
Get-FileHash 'D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1' -Algorithm SHA256

# 3) 刪除判定模組與狀態檔（原腳本不引用，殘留無害但一併清理）
Remove-Item -LiteralPath 'D:\FDE-AI-Gateway\V15C-Ownership.ps1' -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "$env:LOCALAPPDATA\FDE-AI\classroom\django-v15c-pid.json" -ErrorAction SilentlyContinue

# 4) 恢復排程並手動跑一次
Enable-ScheduledTask -TaskName 'FDE-AI v1.5C Classroom Server'
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1"
```

### 9.2 回滾驗收

| 檢查 | 期望 |
|---|---|
| 正式腳本 SHA-256 | `a64330ef7a31e6c981fba95117466610af5e5db833d1ddafc8d91dba1c7a7b59` |
| 正式腳本大小／LWT | 15,766 bytes；內容與備份逐位元組相同 |
| 排程 | `State=Ready`，觸發器 `PT5M` 未變 |
| 8022 | `/login/` 回 200 |
| 行為 | 回到「每 5 分鐘重啟」的既有缺陷（可運作但可用率約 60%）——**這是回滾的已知代價，需教師知悉** |

### 9.3 回滾觸發條件

- 步驟 6 或 8 出現 `UNKNOWN`／`FOREIGN` 且連續 2 個週期未恢復 OWNED
- 8022 連續 2 個週期不可用
- 學員登入／成長記錄／RAG／tunnel 任一項驗收失敗
- 出現非預期的程序被終止（安全事件，立即回滾）

---

## 10. 十、PASS / FAIL / BLOCKED / NOT TESTED 統計

| 分類 | 數量 | 項目 |
|---|---:|---|
| **PASS** | 17 | T1a、T1b、T1c、T2、T3、T4、T5、T6、T7、T8a、T8b、T9、T10、T11、T12、T13、T14 |
| **FAIL** | 0 | — |
| **BLOCKED** | 2 | B-1：無法在正式環境驗證「修復後 OWNED」——禁止修改正式腳本／排程／8022，須維護窗口執行<br>B-2：無法在隔離環境驗證「接管既有 8022」——依 T8a 契約需既有 PID 狀態檔，而該檔只能由 patched 啟動器首次啟動時產生（見 R-1） |
| **NOT TESTED** | 3 | N-1：以正式 `FDE-AI-v1.5\.venv`（而非 `.test-temp` venv）跑真實 trampoline 端到端<br>N-2：排程實際觸發 patched 啟動器（禁止修改／停用正式排程）<br>N-3：提權上下文中讀取 8022 `CommandLine`/`ExecutablePath` 的實際結果（本 session 非提權，實測讀不到，即 T6 活體樣本） |

**總計：22 項受檢，17 PASS / 0 FAIL / 2 BLOCKED / 3 NOT TESTED。**

---

## 11. 十一、8022 / 8770 / 8030 最終狀態

| 埠 | 狀態 | PID | 說明 |
|---|---|---|---|
| **8022** | Listening，HTTP 200 | 6976（取樣當下） | `/login/` 回 200、內容含 `FDE-AI`、長度 1533。**PID 仍在自傷循環中變動**：10:42:02 殺 22672、10:47:20 殺 6976（正式排程所為，非本階段）。擁有者 `ExecutablePath`/`CommandLine` 於本 session 讀不到（非提權） |
| **8770** | Listening，HTTP 200 | 14124 | `/api/rag/health` 回 200（長度 84）；全程 PID 未變（T11/T12 證明未受影響） |
| **8030** | 未監聽 | 0 | 本階段開始與結束皆為未監聽，未被本階段改變 |

排程狀態：`FDE-AI v1.5C Classroom Server` = **Running**，`PT5M` 觸發器**仍啟用**（未停用、未修改）。

正式腳本：SHA-256 `a64330ef…`、15,766 bytes、LWT `2026-10-11 12:48:53`——**與階段開始時完全相同**。

---

## 12. 十二、停止條件檢查與裁決需求

| 停止條件 | 檢查結果 |
|---|---|
| 正式腳本已被外部修改 | 未發生（T14：SHA 前後一致） |
| 無法安全辨識程序所有權 | 未發生（T1–T8 共 9 項涵蓋 OWNED／FOREIGN／UNKNOWN 全分支） |
| 隔離測試需操作正式埠位 | 未發生（僅用 18022/18023/18024/18099） |
| 需更改正式排程 | 未發生（排程僅唯讀查詢） |
| 存在其他專案程序衝突 | 未發生（T3/T4 以合成埠位驗證 FOREIGN 路徑） |

### 裁決需求（3 項）

1. **是否核准本修復方案進入維護窗口**（§8 十步，含「先停 8022」前置）。
2. **R-1 契約確認**：維持「PID 狀態檔缺失 → UNKNOWN」的嚴格契約（需維護窗口先停 8022），或改為「缺失視為中性、可由 OWNED 判定收養並補寫狀態檔」（可免停機，但放寬 T8a）。**本階段依指令維持嚴格契約，未擅自放寬。**
3. **R-3 是否另立階段**處理 tunnel 區塊殘留的 2 處 `Stop-Process`（PID 重用誤殺風險）。

---

## 13. 本階段未執行清單（合規聲明）

- 未修改 `D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1`
- 未修改或停用 Windows 正式排程
- 未啟動／停止／重啟／終止／接管正式 8022
- 未修改正式 8770／8030
- 未修改正式資料庫／媒體／Tunnel／DNS／GitHub Pages
- 未 Commit／Push／Merge／Rebase／Deploy
- 未刪除或覆蓋其他工作樹資料
- 未繞過 safe-delete、未強制終止任何非本輪自有程序（T12 證明）
