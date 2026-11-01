# P3-H v1.5C 8022 所有權修復｜維護 Runbook

- 版本：1.0（2026-10-27，第十九階段產出）
- 適用對象：具備本機提升權限的維護人員
- 狀態：**尚未在正式環境執行過**。本手冊所有步驟皆為計畫，未經實地驗證。
- 前置文件：`docs/reports/P3H_PHASE19_PARALLEL_CONFLICT_AND_PREMAINTENANCE_REVIEW_2026-10-27.md`

---

## 0. 一句話說明

正式環境每 5 分鐘會殺掉自己的 Django，因為原啟動器用「listener 的 exe 是否等於 venv shim」判定所有權，而實際 listener 是 shim 的**子程序**（base interpreter），兩者結構上永不相等。本手冊的目的是把這個判定換成有完整證據鏈的 R-1 判定，並確保換的過程可回滾。

---

## 1. 現況事實（維護前必須知道）

| 項目 | 值 |
|---|---|
| 排程任務 | `\FDE-AI v1.5C Classroom Server` |
| 排程執行等級 | **`RunLevel=Highest`（提升權限）** |
| 排程週期 | `repeat=PT5M`（每 5 分鐘） |
| 正式啟動器 | `D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1` |
| 正式啟動器 SHA-256 | `a64330ef7a31e6c981fba95117466610af5e5db833d1ddafc8d91dba1c7a7b59` |
| `$V15Root` | `D:\FDE-AI-UAS\v1.5C\student_portal` |
| `$DjangoPython`（venv shim） | `C:\Users\admin\Documents\Codex\2026-08-30\new-chat\FDE-AI-v1.5\student_portal\.venv\Scripts\python.exe` |
| 實際 listener（base interpreter） | `C:\Users\admin\.fde-ai\YoloRuntime\python\cpython-3.12.13-windows-x86_64-none\python.exe` |
| 狀態目錄 | `C:\Users\admin\AppData\Local\FDE-AI\classroom` |
| PID 狀態檔 | `django-v15c-pid.json` —— **目前不存在**（正式環境從無此機制） |

**已實測的循環代價**（2026-10-27 四個連續週期）：

| 週期 | 誤殺時刻 | 本機中斷 | 對外固定 URL 中斷 |
|---|---|---|---|
| 1 | 11:46:58 | 8 s | 97 s |
| 2 | 11:52:16 | 7 s | 58 s |
| 3 | 11:57:07 | 21 s | 83 s |
| 4 | 12:02:00 | 11 s | 未記錄 |

本機可用率約 96.1%，**對外固定 URL 可用率約 73.6%**。

---

## 2. 維護前檢查清單（全部通過才可繼續）

在**提升權限**的 PowerShell 中逐項執行。

```powershell
# 2.1 權限驗證（必須為 True）
([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

# 2.2 正式啟動器 SHA 必須完全相符
(Get-FileHash 'D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1' -Algorithm SHA256).Hash.ToLower()
# 期望：a64330ef7a31e6c981fba95117466610af5e5db833d1ddafc8d91dba1c7a7b59

# 2.3 排程狀態（v1.5C 應為 Ready；v1.5B 應為 Disabled）
Get-ScheduledTask -TaskName 'FDE-AI v1.5C Classroom Server' | Select-Object TaskName,State
Get-ScheduledTask -TaskName 'FDE-AI v1.5B Classroom Server' | Select-Object TaskName,State

# 2.4 目前 8022 listener 與其祖程序鏈
$l = Get-NetTCPConnection -LocalPort 8022 -State Listen
$pid8022 = $l.OwningProcess
Get-CimInstance Win32_Process -Filter "ProcessId=$pid8022" | Select-Object ProcessId,ParentProcessId,ExecutablePath,CreationDate

# 2.5 PID 狀態檔應不存在（首次部署的前提）
Test-Path 'C:\Users\admin\AppData\Local\FDE-AI\classroom\django-v15c-pid.json'
# 期望：False。若為 True，代表曾被其他版本寫過 → 先查明來源，不要直接覆蓋。

# 2.6 模組 SHA 必須與本手冊一致
Get-FileHash 'D:\FDE-AI-UAS-v2.0-p3h-local-backend\ops\p3h\v15c-launcher\V15C-Ownership.ps1' -Algorithm SHA256
Get-FileHash 'D:\FDE-AI-UAS-v2.0-p3h-local-backend\ops\p3h\v15c-launcher\V15C-Adoption.ps1' -Algorithm SHA256
```

**任一項不符 → 停止，不進入維護窗口。**

---

## 3. 維護前備份

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$bak = "D:\FDE-AI-Gateway\_backup-$stamp"
New-Item -ItemType Directory -Force -Path $bak | Out-Null

# 3.1 正式啟動器
Copy-Item 'D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1' (Join-Path $bak 'start_fde_v15c_classroom.ps1') -Force

# 3.2 狀態目錄（tunnel-state.json 等）
Copy-Item 'C:\Users\admin\AppData\Local\FDE-AI\classroom\*' $bak -Force

# 3.3 排程定義（匯出 XML，供精確還原）
Export-ScheduledTask -TaskName 'FDE-AI v1.5C Classroom Server' | Set-Content (Join-Path $bak 'task-v15c.xml') -Encoding UTF8

# 3.4 記錄校驗值
Get-ChildItem $bak -File | ForEach-Object {
    "{0}`t{1}" -f $_.Name, (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower()
} | Set-Content (Join-Path $bak 'SHA256SUMS.txt') -Encoding UTF8

$bak   # 記下這個路徑，回滾時要用
```

**備份未完成或 `SHA256SUMS.txt` 為空 → 停止。**

---

## 4. 部署前置：模組必須放進 Gateway 根目錄

`patched-v3.ps1` 以 `$GatewayRoot`（即啟動器所在目錄）為模組搜尋根：

```powershell
$OwnershipModule = Join-Path $GatewayRoot 'V15C-Ownership.ps1'
$AdoptionModule  = Join-Path $GatewayRoot 'V15C-Adoption.ps1'
```

**這兩個檔案目前位於 `ops\p3h\v15c-launcher\`，不在 `D:\FDE-AI-Gateway\`。** 若未複製，啟動器會在 dot-source 階段 `throw`，Django 不會啟動。

```powershell
Copy-Item 'D:\FDE-AI-UAS-v2.0-p3h-local-backend\ops\p3h\v15c-launcher\V15C-Ownership.ps1' 'D:\FDE-AI-Gateway\' -Force
Copy-Item 'D:\FDE-AI-UAS-v2.0-p3h-local-backend\ops\p3h\v15c-launcher\V15C-Adoption.ps1'  'D:\FDE-AI-Gateway\' -Force

# 驗證：兩檔在 Gateway 根目錄且 SHA 相符
Get-FileHash 'D:\FDE-AI-Gateway\V15C-Ownership.ps1','D:\FDE-AI-Gateway\V15C-Adoption.ps1' -Algorithm SHA256
```

---

## 5. 方案 A｜冷啟動切換（**推薦**）

### 5.1 為何推薦 A

方案 A 先停掉 8022，讓新啟動器面對「空埠」→ 直接啟動新 Django → **完全不進入 R-1 判定**。因此它**不依賴 `CommandLine` 可讀性**這個唯一未實證的假設，成功條件最少。

### 5.2 前置條件

- 第 2 節全部通過
- 第 3 節備份完成
- 第 4 節模組已就位
- 已通知使用者「對外固定 URL 可能中斷 60–100 秒」

### 5.3 操作順序

```powershell
# 步驟 1：停用排程（避免維護期間被 5 分鐘觸發打斷）
Disable-ScheduledTask -TaskName 'FDE-AI v1.5C Classroom Server'

# 步驟 2：記錄目前 listener，稍後比對
$oldPid = (Get-NetTCPConnection -LocalPort 8022 -State Listen).OwningProcess
$oldCreated = (Get-CimInstance Win32_Process -Filter "ProcessId=$oldPid").CreationDate
"OLD pid=$oldPid created=$oldCreated"

# 步驟 3：停止該 listener（僅此一個 PID）
Stop-Process -Id $oldPid -Force

# 步驟 4：確認埠已釋放（最多等 30 秒）
$sw=[Diagnostics.Stopwatch]::StartNew()
while ($sw.Elapsed.TotalSeconds -lt 30) {
    if (-not (Get-NetTCPConnection -LocalPort 8022 -State Listen -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 300
}
if (Get-NetTCPConnection -LocalPort 8022 -State Listen -ErrorAction SilentlyContinue) { throw 'PORT STILL BUSY - ABORT' }

# 步驟 5：切換啟動器（保留原檔為 .orig，便於回滾）
Copy-Item 'D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1' 'D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1.orig' -Force
Copy-Item 'D:\FDE-AI-UAS-v2.0-p3h-local-backend\ops\p3h\v15c-launcher\start_fde_v15c_classroom.patched-v3.ps1' 'D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1' -Force

# 步驟 6：手動執行一次（前景，觀察輸出）
& 'D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1'

# 步驟 7：檢查日誌
Get-Content 'C:\Users\admin\AppData\Local\FDE-AI\classroom\startup.log' -Tail 30

# 步驟 8：確認狀態檔已生成且 pid 正確
$state = Get-Content 'C:\Users\admin\AppData\Local\FDE-AI\classroom\django-v15c-pid.json' -Raw | ConvertFrom-Json
$livePid = (Get-NetTCPConnection -LocalPort 8022 -State Listen).OwningProcess
"STATE pid=$($state.pid) LIVE pid=$livePid match=$($state.pid -eq $livePid)"

# 步驟 9：恢復排程
Enable-ScheduledTask -TaskName 'FDE-AI v1.5C Classroom Server'
```

### 5.4 成功判據

- 步驟 6 輸出結尾為 `ONLINE; django=PASS`
- 日誌出現 `PID STATE WRITTEN pid=<livePid>`
- 步驟 8 的 `match=True`

### 5.5 失敗停止條件（任一成立即中止並回滾）

| # | 條件 |
|---|---|
| 1 | 步驟 4 在 30 秒內埠未釋放 |
| 2 | 步驟 6 在 60 秒內未出現 `ONLINE` |
| 3 | 日誌出現 `throw` 或 `startup-error.log` 有新內容 |
| 4 | 步驟 8 的 `django-v15c-pid.json` 不存在，或 `match=False` |
| 5 | 8022 在 60 秒內未通過 `http://127.0.0.1:8022/login/` |

---

## 6. 方案 B｜受控收養（**目前 BLOCKED，不可直接執行**）

### 6.1 方案 B 想解決什麼

不停止 Django，由新啟動器用 8 項證據「認領」既有 listener，寫入 PID 狀態檔，達成零停機切換。

### 6.2 BLOCKED 的兩個具體原因（2026-10-27 實測）

**原因一：E4c 的第三個指紋標記在正式頁面不存在。**

`V15C-Adoption.ps1` 第 297 行的預設值是：

```powershell
[string[]]$HealthMarkers = @('FDE-AI', 'csrfmiddlewaretoken', 'resend-verification')
```

對 `http://127.0.0.1:8022/login/` 實測：

| 標記 | 是否命中 |
|---|---|
| `FDE-AI` | True |
| `csrfmiddlewaretoken` | True |
| `resend-verification` | **False** |

`AllMarkers` 要求**全部命中**，因此 E4c 必然為 `False` → E4 失敗 → 判定 UNKNOWN → ABORT。**收養永遠不會成功。**

改為兩個標記後實測 `AllMarkers=True`（已驗證）。因此修正方式明確：把預設值改為 `@('FDE-AI','csrfmiddlewaretoken')`。

**原因二：E3 需要讀取 listener 的 `CommandLine`，而該程序以提升權限執行。**

本審查環境（非提升）實測 `CmdLen=0`，讀不到。排程為 `RunLevel=Highest`，因此 launcher 自身以提升權限執行時**理論上可讀**，但**尚未實證**。

### 6.3 解除 BLOCKED 需要的兩個前置（缺一不可）

```powershell
# 前置 1：以提升權限驗證 CommandLine 可讀（只讀，不改任何狀態）
$l = Get-NetTCPConnection -LocalPort 8022 -State Listen
$p = Get-CimInstance Win32_Process -Filter "ProcessId=$($l.OwningProcess)"
"CmdLen=$($p.CommandLine.Length)"
$p.CommandLine
# 期望：非空，且符合 manage.py runserver + 127.0.0.1:8022
```

前置 2：把 `V15C-Adoption.ps1` 的 `HealthMarkers` 預設值改為 `@('FDE-AI','csrfmiddlewaretoken')`，或在呼叫端明確傳入。

**兩項都通過後，方案 B 才能重新評估。**

### 6.4 若解除 BLOCKED，操作順序

```powershell
Disable-ScheduledTask -TaskName 'FDE-AI v1.5C Classroom Server'
# 記錄 listener（不停止）
$livePid = (Get-NetTCPConnection -LocalPort 8022 -State Listen).OwningProcess
# 部署模組與 v3（見第 4 節）
# 手動執行一次（不停 8022）
& 'D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1'
Get-Content 'C:\Users\admin\AppData\Local\FDE-AI\classroom\startup.log' -Tail 30
# 期望看到：8022 ADOPTED pid=<livePid>; mode=ancestor
```

### 6.5 方案 B 的失敗模式（比 A 溫和）

若收養失敗，啟動器會 `throw` 中止，但**不會殺掉 listener**（三態皆不終止），服務維持可用。代價是該次啟動不更新 tunnel / Worker origin。這是方案 B 唯一的優勢。

---

## 7. 異常退出

任何時刻需要中止：

```powershell
# 1. 立即停用排程，阻止後續觸發
Disable-ScheduledTask -TaskName 'FDE-AI v1.5C Classroom Server'

# 2. 不要殺任何程序，除非你確認它就是步驟 3 記錄的那個 PID
# 3. 依第 8 節回滾
```

**禁止**：在未確認身分的情況下用 `Stop-Process -Name python` 或類似廣域條件終止程序。

---

## 8. 回滾

### 8.1 ⚠️ 不安全組合警示

**「原啟動器 + 原排程（Enabled）」不是安全的回滾組合。** 這個組合就是造成每 5 分鐘自傷循環的現況。若回滾到原啟動器卻保留排程啟用，等於**主動恢復故障**。

### 8.2 三層回滾

| 層級 | 組合 | 服務可用 | 誤殺循環 | 適用情境 |
|---|---|---|---|---|
| **R1（推薦）** | 原啟動器 + **排程 Disabled** + 手動啟動一次 | 是 | **無** | 新版本驗證失敗，且不急着恢復自動化 |
| **R2（有條件）** | 原啟動器 + 排程 Enabled | 是 | **有（每 5 分鐘）** | 僅當「必須恢復自動重啟能力」且接受 73.6% 對外可用率 |
| **R3（不建議）** | 新啟動器 + 排程 Enabled，但狀態檔殘留錯誤 | 視情況 | 可能無 | 只在能解釋狀態檔內容時使用 |

### 8.3 R1 回滾步驟（推薦）

```powershell
# 1. 停用排程
Disable-ScheduledTask -TaskName 'FDE-AI v1.5C Classroom Server'

# 2. 還原啟動器
$bak = 'D:\FDE-AI-Gateway\_backup-<stamp>'   # 換成第 3 節的實際路徑
Copy-Item (Join-Path $bak 'start_fde_v15c_classroom.ps1') 'D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1' -Force

# 3. 移除模組（避免新舊混用）
Remove-Item 'D:\FDE-AI-Gateway\V15C-Ownership.ps1','D:\FDE-AI-Gateway\V15C-Adoption.ps1' -Force -ErrorAction SilentlyContinue

# 4. 移除 PID 狀態檔（原啟動器不認得它）
Remove-Item 'C:\Users\admin\AppData\Local\FDE-AI\classroom\django-v15c-pid.json' -Force -ErrorAction SilentlyContinue

# 5. 確認 SHA 已還原
(Get-FileHash 'D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1' -Algorithm SHA256).Hash.ToLower()
# 期望：a64330ef...

# 6. 手動啟動一次，確認服務可用
& 'D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1'
```

**回滾後排程維持 Disabled。** 是否重新啟用，由維護負責人依 8.1 的警示自行決定並記錄理由。

### 8.4 回滾後必須記錄

- 回滾層級（R1/R2/R3）
- 回滾原因（對應第 5.5 或 6.5 的哪一條）
- 回滾後 8022 的 PID 與 `/login/` 狀態
- 排程是否重新啟用、理由

---

## 9. 驗收：三個以上排程週期觀察

切換後**必須**連續觀察 **≥3 個排程週期（≥15 分鐘）**，不得只看一次啟動結果。

```powershell
$pids = @()
for ($i = 0; $i -lt 4; $i++) {
    $l = Get-NetTCPConnection -LocalPort 8022 -State Listen -ErrorAction SilentlyContinue
    $pids += if ($l) { $l.OwningProcess } else { 0 }
    "sample $i pid=$($pids[-1]) time=$(Get-Date -Format 'HH:mm:ss')"
    if ($i -lt 3) { Start-Sleep -Seconds 300 }   # 等一個排程週期
}
"unique pids = $(($pids | Select-Object -Unique) -join ',')"
```

### 9.1 通過判據

| # | 判據 |
|---|---|
| 1 | 4 次取樣的 listener PID **完全相同**（`unique pids` 只有一個值） |
| 2 | `startup.log` 在觀察期間**沒有** `STOPPING stale 8022 listener` |
| 3 | 每個週期都記錄 `8022 OWNED`（或首次 `8022 ADOPTED` 後續 `OWNED`） |
| 4 | `django-v15c-pid.json` 的 `pid` 與 `created_at` 與實際程序一致 |
| 5 | `http://127.0.0.1:8022/login/` 每次取樣皆回 2xx/3xx |
| 6 | 對外固定 URL `https://fde-ai-gateway.fde-ai-gateway.workers.dev/login/` 可用 |

### 9.2 不通過的處理

任一判據失敗 → 立即執行第 8.3 節 R1 回滾，並記錄失敗判據編號。

---

## 10. 五分鐘誤殺循環防復發檢查

切換後 **24 小時內**至少抽查兩次，之後每週一次：

```powershell
# 10.1 統計最近 24 小時的誤殺次數（期望 0）
$log = 'C:\Users\admin\AppData\Local\FDE-AI\classroom\startup.log'
$since = (Get-Date).AddHours(-24)
$hits = Select-String -LiteralPath $log -Pattern 'STOPPING stale 8022 listener' |
        Where-Object { $_.Line -match '^(\d{4}-\d{2}-\d{2}T[\d:.]+)' -and ([datetime]::Parse($Matches[1]) -gt $since) }
"MISKILL_24H = $($hits.Count)"
# 期望：0

# 10.2 狀態檔與實況一致
$state = Get-Content 'C:\Users\admin\AppData\Local\FDE-AI\classroom\django-v15c-pid.json' -Raw | ConvertFrom-Json
$live = (Get-NetTCPConnection -LocalPort 8022 -State Listen).OwningProcess
"STATE=$($state.pid) LIVE=$live MATCH=$($state.pid -eq $live)"

# 10.3 listener 存活時間應持續增長（不再每 5 分鐘歸零）
$p = Get-Process -Id $live
"UPTIME_MIN = $([int]((Get-Date) - $p.StartTime).TotalMinutes)"
# 期望：持續增長，不應反覆回到 0-5 分鐘
```

### 10.1 若 `MISKILL_24H > 0`

代表新判定仍把 listener 判成非 OWNED。依序檢查：

1. `startup.log` 中該次記錄的 `reasons=` 內容
2. 若為 `command_line_unreadable` → 權限問題，確認排程仍為 `RunLevel=Highest`
3. 若為 `state_created_at_mismatch` → 狀態檔陳舊，檢查是否有第二個寫入者
4. 若為 `state_record_absent` → 狀態檔被刪或未寫入，檢查步驟 8
5. 無法解釋 → R1 回滾

---

## 11. 已知限制（維護人員必須知道）

1. **方案 B 目前不可用**：E4c 標記不匹配 + E3 未實證（第 6.2 節）。
2. **Tunnel 的兩處 `Stop-Process` 未修**（原始檔第 246、268 行）：缺終止前重驗，最長 TOCTOU 窗口 30 秒 / 60 秒。目前 REUSE 路徑 4/4 成功，該分支在常態下不執行，屬低頻高影響。**需獨立階段處理。**
3. **`tunnel-state.json` 寫入非原子**（`Set-Content`），`Read-TunnelState` 讀取失敗時靜默 fail-open。同樣待獨立階段。
4. **本手冊未經實地演練**。所有時間估計來自 2026-10-27 的四個觀測週期，實際值可能不同。
5. **回滾後排程維持 Disabled** 會失去自動重啟能力；若機器重啟，服務不會自動恢復。

---

## 12. 附錄：本次維護涉及的全部檔案

| 角色 | 路徑 | SHA-256 |
|---|---|---|
| 正式啟動器（原始） | `D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1` | `a64330ef…7a7b59` |
| 判定模組 | `ops\p3h\v15c-launcher\V15C-Ownership.ps1` | `adf7f8ec…b03ec8` |
| 收養模組 | `ops\p3h\v15c-launcher\V15C-Adoption.ps1` | `48cb7c34…6b81b1` |
| 整合啟動器 | `ops\p3h\v15c-launcher\start_fde_v15c_classroom.patched-v3.ps1` | `a95a857b…0d762b` |
| 契約測試（30 項） | `ops\p3h\v15c-launcher\Test-V15CLauncherOwnership.ps1` | `3157570a…3cd031` |
| 故障矩陣（14 類） | `ops\p3h\v15c-launcher\Test-V15CPhase19FaultMatrix.ps1` | `31c0d300…39adf6` |

完整 SHA 見 `docs/reports/P3H_PHASE19_INTEGRATION_AND_REGRESSION_2026-10-27.md` 附錄。

---

*本手冊為計畫文件，尚未在正式環境執行。執行前請確認第 2 節全部通過。*
