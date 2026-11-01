# FDE-AI 2.0｜P3-H 第十九階段
# 8022 正式維護操作手冊（Runbook）

| 項目 | 內容 |
|---|---|
| 文件狀態 | **待批准（DRAFT — NOT APPROVED）** |
| 用途 | 8022 啟動器安全修復的正式部署與回滾程序 |
| 適用對象 | 專案架構師 / 維運執行者（具本機 Administrator 權限） |
| 產生階段 | P3-H 第十九階段（Pre-Maintenance Gate） |
| 產生時間 | 2026-10-27 |
| 執行限制 | **本文件不得自動執行。每一步都需人工確認並留證。** |
| 前置依賴 | 第十八階段補丁 `patched-v3`（SHA `a95a857b…`）＋ 兩個模組 |

> **重要**：本輪（第十九階段）**未執行任何正式修復**。本手冊只是待批准的操作文件。
> 在教師／架構師明確批准之前，**不得**進入正式維護窗口。

---

## 第 1 章　目的與範圍

### 1.1 要解決的問題

正式排程 `FDE-AI v1.5C Classroom Server` 每 5 分鐘執行一次
`D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1`。該腳本第 185–197 行以
「`Get-Process` 回報的執行檔路徑 ≠ venv shim 路徑」為條件，對佔用 8022 的程序
執行 `Stop-Process -Force`。

由於 Windows venv 的 `python.exe` 只是 redirector（trampoline），實際持有 8022
監聽的是它的**子程序**（base interpreter），路徑永遠不等於 shim，因此條件恆為真：

- 每一次排程執行都會殺掉上一個自己啟動的 Django，然後重新啟動。
- 生產日誌 `startup.log` 累計 `STOPPING stale 8022` **4,747 次**。
- 本輪觀察到的連續 6 次：`13:36:56 / 13:42:01 / 13:47:03 / 13:51:59 / 13:56:57 / 14:01:58`，
  間隔約 4 分 55 秒，與 `PT5M` 觸發週期完全一致。
- 每次殺到恢復約 129 秒，可用率約 60%。

### 1.2 修復內容（第十八階段已完成，本輪僅驗證）

| 檔案 | 角色 | SHA-256 |
|---|---|---|
| `start_fde_v15c_classroom.patched-v3.ps1` | 補丁主體 | `a95a857b11de2ca13483d0e50ae23c2c064b654994a51f7accfb56d0280d762b` |
| `V15C-Ownership.ps1` | 所有權判定＋唯一原子狀態寫入器 | `adf7f8ecd6bcdaf3d5bd013569c9c6231f0e7f16bf64675a83b0042391b03ec8` |
| `V15C-Adoption.ps1` | 受控收養閘門（E1–E8） | `48cb7c34732d1eb8c40611e3cf741c3b717784665ab7fde8dde8c544d66b81b1` |

修復語義：**永不終止任何程序**。8022 上有 listener 時，只做「判定 → 重用／收養／中止」，
中止就 `throw`，由 trap 記錄後 `exit 1`。

### 1.3 範圍外（本手冊不處理）

- Cloudflared tunnel 的兩處 `Stop-Process`（正式檔 L246／L268）——既有殘留風險，
  第十八階段已記錄，本輪不動。
- RAG 8770、Flight Health 8030、Django 正式資料庫、MEDIA_ROOT。
- v1.5C 業務程式碼與資料模型。

---

## 第 2 章　前置條件與硬性禁止

### 2.1 必須成立的前置條件（任一不成立即取消窗口）

| # | 條件 | 查核方式 |
|---|---|---|
| P1 | Git HEAD = `2fd4f2421dc18df761db80e74e6c4f134448feaf`，分支 `codex/p3h-local-backend` | `git rev-parse HEAD` |
| P2 | 正式啟動器 SHA = `a64330ef…`，15,766 bytes | `Get-FileHash` |
| P3 | 三個補丁檔 SHA 與第 1.2 節一致 | `Get-FileHash` |
| P4 | 排程存在且 `RunLevel=Highest`、`UserId=admin`、`MultipleInstances=IgnoreNew` | `Get-ScheduledTask` |
| P5 | 8022 現況已記錄（PID、建立時間、health 200、tunnel URL） | 見第 4 章 |
| P6 | 8770 現況已記錄（PID、建立時間） | `Get-NetTCPConnection -LocalPort 8770` |
| P7 | 備份已完成且 SHA 已登錄 | 見第 4 章 |
| P8 | 執行者 session 為**提升權限**（`IsElevated=True`） | 見第 3.2 節 |

> **P8 為什麼是硬條件**：非提升權限的 session 讀不到提升權限程序的
> `CommandLine`／`ExecutablePath`，所有權判定會落在 `command_line_unreadable`
> → `UNKNOWN` → 中止。本輪已實測：非提升權限對 8022 的判定結果為
> `listener_pid_matches; command_line_unreadable`。

### 2.2 硬性禁止

- 不得修改 8770／8030 的任何程序或設定。
- 不得修改正式資料庫與 MEDIA_ROOT。
- 不得修改 Cloudflare Tunnel／DNS／GitHub Pages。
- 不得終止**未經本手冊明確辨識**的程序（見第 7 章的程序辨識三條件）。
- 不得在排程仍啟用時執行手動維護（見第 6 章）。
- 不得略過第 5 章的時間軸順序。
- 不得在未備份的情況下覆蓋任何正式檔案。
- 不得 push 任何 commit；本輪不涉及 commit。

---

## 第 3 章　角色與授權

### 3.1 角色

| 角色 | 職責 | 必要權限 |
|---|---|---|
| 架構師／教師 | 批准本手冊、裁決方案 A/B、批准回滾 | 無需本機權限 |
| 維運執行者 | 按本手冊逐條執行、留證 | 本機 Administrator（提升權限） |
| 覆核者 | 獨立核對每一步的證據，簽核 | 本機讀取權限 |

### 3.2 提升權限確認（P8）

在執行任何步驟前，先確認：

```powershell
([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
```

必須回傳 `True`。回傳 `False` 時**立即停止**，改以「以系統管理員身分執行」重開。

### 3.3 授權邊界

- 執行者只能在被批准的窗口內、按被批准的步驟操作。
- 任何偏離本手冊的操作，必須先暫停並取得架構師口頭／書面同意，並記錄在案。
- 執行者**無權**自行決定「跳過某一步應該也沒關係」。

---

## 第 4 章　事前快照與備份

### 4.1 建立備份目錄

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$bk = "D:\FDE-AI-Gateway\backups\P3H19-$stamp"
New-Item -ItemType Directory -Force -Path $bk | Out-Null
```

### 4.2 備份正式啟動器與狀態目錄

```powershell
Copy-Item 'D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1' $bk -Force
Copy-Item 'C:\Users\admin\AppData\Local\FDE-AI\classroom' (Join-Path $bk 'classroom') -Recurse -Force
```

### 4.3 記錄 SHA-256 清單

```powershell
Get-FileHash 'D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1' -Algorithm SHA256 |
  Format-List | Out-File (Join-Path $bk 'SHA_BEFORE.txt') -Encoding utf8
Get-ChildItem (Join-Path $bk 'classroom') -File |
  Get-FileHash -Algorithm SHA256 |
  Format-Table -AutoSize | Out-File (Join-Path $bk 'SHA_BEFORE.txt') -Append -Encoding utf8
```

### 4.4 記錄服務現況（唯讀）

```powershell
Get-NetTCPConnection -State Listen -LocalPort 8022,8770,8030 |
  Select-Object LocalPort,OwningProcess | Format-Table -AutoSize
Get-Content 'C:\Users\admin\AppData\Local\FDE-AI\classroom\startup.log' -Tail 20
Get-Content 'C:\Users\admin\AppData\Local\FDE-AI\classroom\tunnel-state.json' -Raw
```

把輸出貼進本次窗口的記錄檔（建議 `$bk\WINDOW_LOG.txt`）。

### 4.5 備份完成檢查

- [ ] `$bk\start_fde_v15c_classroom.ps1` 存在且 SHA = `a64330ef…`
- [ ] `$bk\classroom\` 內含 `startup.log`、`tunnel-state.json`、`current-tunnel-url.txt`
- [ ] `SHA_BEFORE.txt` 已產生
- [ ] 服務現況已貼入 `WINDOW_LOG.txt`

**任一未完成即不得進入第 5 章。**

---

## 第 5 章　維護窗口時間軸

| 時點 | 動作 | 章節 |
|---|---|---|
| T-30 min | 通知使用者停機、確認無學員在線 | 5.1 |
| T-20 min | 完成第 4 章備份與現況記錄 | 4 |
| T-10 min | **停用排程**（關鍵） | 6 |
| T-5 min | 再次確認排程已停用、無 launcher 在跑 | 6.3 |
| T+0 | 停止 8022 → 部署補丁 → 冷啟動 | 7 |
| T+10 min | 驗證（health／state／tunnel／8770） | 8 |
| T+15 min | 恢復排程 | 9.1 |
| T+15 ~ T+45 | 觀察 3 個 5 分鐘週期 | 9.2 |
| T+45 min | 收尾、簽核 | 9.3 |

### 5.1 停機通知範本

> 系統將於 `<時間>` 進行例行維護，預計 `<N>` 分鐘無法使用。維護期間請勿上傳作業。

---

## 第 6 章　步驟 A：停用問題排程（必要前置）

> **這是整個窗口最關鍵的一步。** 排程若仍啟用，5 分鐘內就會再殺一次 8022，
> 使第 7 章的冷啟動與第 8 章的驗證全部失效。
> 第十八階段的設計前提即為「舊版啟動器加上原排程，會恢復每五分鐘誤殺風險，
> 因此不得直接當作安全回滾」——同理，部署前必須先讓排程停用。

### 6.1 停用排程

```powershell
Disable-ScheduledTask -TaskName 'FDE-AI v1.5C Classroom Server'
```

### 6.2 確認停用

```powershell
Get-ScheduledTask -TaskName 'FDE-AI v1.5C Classroom Server' |
  Select-Object TaskName,State
```

必須顯示 `State = Disabled`。

### 6.3 確認無 launcher 正在執行

```powershell
Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" |
  Where-Object { $_.CommandLine -match 'start_fde_v15c_classroom\.ps1' } |
  Select-Object ProcessId,CreationDate,CommandLine
```

必須回傳空集合。若有殘留，記錄 PID 並等待其自然結束（最多 5 分鐘）；
**不得**為了加速而終止它——它可能正在寫狀態檔。

### 6.4 確認實例互斥鎖已釋放

排程停用且無 launcher 在跑後，`Global\FDE-AI-v15C-Classroom-Startup` 應已釋放。
不需要主動查詢；第 7 章執行時若日誌出現 `SKIP duplicate startup instance`，
表示鎖仍被佔用，回到 6.3 重新確認。

---

## 第 7 章　步驟 B：受控冷啟動（方案 A）十步程序

> **本輪不執行。** 以下為待批准的執行程序。
> 為什麼選方案 A：第十九階段對方案 B（受控收養）做了 8 條件實測，
> 結果為 **7 項成立、E4c 不成立**（詳見交付報告 §C）。方案 B 目前無法達到
> `ADOPTABLE`，只能走方案 A。

### 步驟 1｜確認排程已停用

回到 6.2 再確認一次 `State = Disabled`。**這一步不能跳。**

### 步驟 2｜記錄停止前的 8022 完整身分

```powershell
$p = (Get-NetTCPConnection -State Listen -LocalPort 8022 | Select-Object -First 1).OwningProcess
Get-CimInstance Win32_Process -Filter "ProcessId=$p" |
  Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,CreationDate
Invoke-WebRequest 'http://127.0.0.1:8022/login/' -UseBasicParsing | Select-Object StatusCode
```

把 `ExecutablePath`、`CommandLine`、`CreationDate` 貼進 `WINDOW_LOG.txt`。
**這是後面辨識「該殺的是哪一個」的唯一依據。**

### 步驟 3｜以三條件驗證目標程序

三個條件必須**同時**成立，才允許停止：

1. `ExecutablePath` = `C:\Users\admin\.fde-ai\YoloRuntime\python\cpython-3.12.13-windows-x86_64-none\python.exe`
2. `CommandLine` 同時匹配 `manage\.py\s+runserver` 與 `127\.0\.0\.1:8022`
3. `CreationDate` 與步驟 2 記錄一致

任一不符 → **停止整個窗口**，回報架構師。不得改用「看起來像」的程序。

> 為什麼需要第 1 條：正式 Django 是由 venv shim（
> `…\FDE-AI-v1.5\student_portal\.venv\Scripts\python.exe`）啟動，
> 實際持有監聽的是它的子程序，也就是 YoloRuntime 的 base interpreter。
> 第十九階段已用生產日誌的 `executable=` 欄位證實此拓撲。

### 步驟 4｜停止 8022

```powershell
Stop-Process -Id $p -Force
```

只停這一個 PID。**不得**使用 `-Name python`、`taskkill /IM`、或任何批次終止。

### 步驟 5｜確認 8022 已釋放且 8770 未受影響

```powershell
Start-Sleep -Seconds 3
Get-NetTCPConnection -State Listen -LocalPort 8022,8770,8030 -ErrorAction SilentlyContinue |
  Select-Object LocalPort,OwningProcess
```

預期：`8022` 無輸出；`8770` 仍存在且 PID 與第 4 章記錄相同；`8030` 仍無。

若 8770 消失或 PID 改變 → **立即停止並回報**。

### 步驟 6｜部署補丁（先備份再覆蓋）

```powershell
$src = 'D:\FDE-AI-UAS-v2.0-p3h-local-backend\ops\p3h\v15c-launcher'
$dst = 'D:\FDE-AI-Gateway'

# 6.1 再次確認來源 SHA
Get-FileHash "$src\start_fde_v15c_classroom.patched-v3.ps1" -Algorithm SHA256  # 必須 a95a857b…
Get-FileHash "$src\V15C-Ownership.ps1" -Algorithm SHA256                        # 必須 adf7f8ec…
Get-FileHash "$src\V15C-Adoption.ps1"  -Algorithm SHA256                        # 必須 48cb7c34…

# 6.2 放置模組（先放模組，避免主檔 dot-source 失敗）
Copy-Item "$src\V15C-Ownership.ps1" $dst -Force
Copy-Item "$src\V15C-Adoption.ps1"  $dst -Force

# 6.3 覆蓋主檔（原檔已在第 4 章備份）
Copy-Item "$src\start_fde_v15c_classroom.patched-v3.ps1" "$dst\start_fde_v15c_classroom.ps1" -Force

# 6.4 確認部署後 SHA
Get-FileHash "$dst\start_fde_v15c_classroom.ps1" -Algorithm SHA256  # 必須 a95a857b…
```

> **順序很重要**：先放兩個模組，再覆蓋主檔。若先覆蓋主檔，主檔在
> L40–47 會因找不到模組而 `throw`，雖然安全（不會有任何副作用），但會讓窗口多一次失敗。

### 步驟 7｜以提升權限手動執行一次（模擬排程身分）

```powershell
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1'
```

預期日誌序列（`C:\Users\admin\AppData\Local\FDE-AI\classroom\startup.log`）：

```
SMTP CONFIGURED; ...
NETWORK READY attempt=1
REUSE existing tunnel=https://guests-demands-roller-vinyl.trycloudflare.com
PID STATE WRITTEN pid=<新 PID> file=C:\Users\admin\AppData\Local\FDE-AI\classroom\django-v15c-pid.json
ONLINE; django=PASS; rag=PASS; tunnel=...
```

**不得出現** `STOPPING stale 8022 listener`。

### 步驟 8｜驗證狀態檔

```powershell
Get-Content 'C:\Users\admin\AppData\Local\FDE-AI\classroom\django-v15c-pid.json' -Raw
```

必須存在，且 `pid` = 目前 8022 的 `OwningProcess`，`created_at` 與該程序建立時間差 < 2 秒。

### 步驟 9｜驗證健康與 tunnel

```powershell
(Invoke-WebRequest 'http://127.0.0.1:8022/login/' -UseBasicParsing).StatusCode   # 200
(Invoke-WebRequest 'http://127.0.0.1:8770/api/rag/health' -UseBasicParsing).StatusCode  # 200
Get-Content 'C:\Users\admin\AppData\Local\FDE-AI\classroom\current-tunnel-url.txt' -Raw
```

tunnel URL 應與維護前相同（`REUSE`），不得重新建立。

### 步驟 10｜恢復排程前的最後確認

- [ ] 步驟 8 狀態檔 `pid` == 8022 PID
- [ ] 步驟 9 兩個 health 皆 200
- [ ] `startup.log` 最後 20 行無 `STOPPING stale`
- [ ] 8770 PID 與維護前相同
- [ ] 無任何 `ADOPTION CLAIM FAILED` / `refusing to stop or start`

全部成立才進第 9 章。任一不成立 → 進第 10 章回滾。

---

## 第 8 章　步驟 C：驗證與證據收集

### 8.1 必要證據清單

| # | 證據 | 來源 |
|---|---|---|
| E1 | 部署前後正式檔 SHA 對照 | 第 4.3 / 6.4 |
| E2 | 排程停用與恢復的 State 截圖或輸出 | 6.2 / 9.1 |
| E3 | 停止前 8022 程序三條件輸出 | 7 步驟 2–3 |
| E4 | 8022 釋放後三埠狀態 | 7 步驟 5 |
| E5 | 冷啟動日誌全文 | 7 步驟 7 |
| E6 | 狀態檔內容 | 7 步驟 8 |
| E7 | 兩個 health 狀態碼 | 7 步驟 9 |
| E8 | 觀察期 3 個週期的 `startup.log` | 9.2 |

### 8.2 判讀規則

| 日誌字樣 | 含義 | 處置 |
|---|---|---|
| `8022 OWNED pid=…; reuse` | 判定為自家程序，直接重用 | 正常 |
| `8022 ADOPTED pid=…` | 收養成功並寫入狀態 | 正常（本輪方案 B 不會出現） |
| `8022 ADOPTION CLAIM FAILED` | 收養寫入被拒 | 進第 10 章 |
| `8022 UNKNOWN …; refusing to stop or start` | 證據不足，安全中止 | 進第 10 章 |
| `8022 FOREIGN …; refusing to stop or start` | 判定為他方程序，安全中止 | 進第 10 章 |
| `PID STATE NOT WRITTEN reason=…` | 狀態檔寫入被拒，但服務已上線 | 記錄原因；觀察下一週期 |
| `SKIP duplicate startup instance` | 有另一個實例持有鎖 | 回 6.3 |
| `STOPPING stale 8022 listener` | **不應出現** | 立即進第 10 章 |

---

## 第 9 章　步驟 D：恢復排程與觀察期

### 9.1 恢復排程

```powershell
Enable-ScheduledTask -TaskName 'FDE-AI v1.5C Classroom Server'
Get-ScheduledTask -TaskName 'FDE-AI v1.5C Classroom Server' | Select-Object State
```

必須顯示 `State = Ready`。

### 9.2 觀察期（至少 3 個 5 分鐘週期，約 15 分鐘）

每個週期結束後執行：

```powershell
$log = 'C:\Users\admin\AppData\Local\FDE-AI\classroom\startup.log'
Get-Content $log -Tail 25
Get-NetTCPConnection -State Listen -LocalPort 8022 | Select-Object OwningProcess
Get-Content 'C:\Users\admin\AppData\Local\FDE-AI\classroom\django-v15c-pid.json' -Raw
```

**通過標準（三者必須同時成立）**：

1. 8022 的 `OwningProcess` **三個週期完全不變**。
2. `startup.log` 中**沒有**新增任何 `STOPPING stale 8022 listener`。
3. 狀態檔 `pid` 與 8022 PID 一致。

三者任一不成立 → 進第 10 章。

### 9.3 收尾

```powershell
$before = (Get-Content $log | Select-String -SimpleMatch 'STOPPING stale 8022').Count
```

記錄觀察期前後的計數差，必須為 **0**。把第 8.1 節八項證據歸檔到 `$bk`。

### 9.4 簽核

| 項目 | 執行者 | 覆核者 | 時間 |
|---|---|---|---|
| 備份完成 | | | |
| 排程停用 | | | |
| 冷啟動成功 | | | |
| 驗證八項 | | | |
| 觀察期通過 | | | |

---

## 第 10 章　回滾程序（恢復舊檔但保持問題排程停用）

> **核心原則**：第十八階段已明確——「舊版啟動器加上原排程，會恢復每五分鐘誤殺風險，
> 因此不得直接當作安全回滾」。所以回滾**必須同時**恢復舊檔並**讓排程保持停用**，
> 由人工接手，直到問題被重新處理。
>
> 恢復舊檔但不恢復排程，等於「回到手動啟動、不再自動誤殺」的穩定狀態，
> 這是本手冊認可的唯一安全回滾形態。

### 10.1 觸發條件（任一成立）

- 第 7 章任一步驟失敗且無法在 10 分鐘內排除。
- 第 8 章任一驗證項不成立。
- 第 9.2 節觀察期任一通過標準不成立。
- 執行者判斷風險不可接受。

### 10.2 回滾步驟

**R1｜停用排程（若尚未停用）**

```powershell
Disable-ScheduledTask -TaskName 'FDE-AI v1.5C Classroom Server'
```

**R2｜恢復原始啟動器**

```powershell
Copy-Item "$bk\start_fde_v15c_classroom.ps1" 'D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1' -Force
Get-FileHash 'D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1' -Algorithm SHA256   # 必須 a64330ef…
```

**R3｜移除兩個模組（可選，但建議）**

```powershell
Remove-Item 'D:\FDE-AI-Gateway\V15C-Ownership.ps1' -Force -ErrorAction SilentlyContinue
Remove-Item 'D:\FDE-AI-Gateway\V15C-Adoption.ps1'  -Force -ErrorAction SilentlyContinue
```

原始啟動器不 dot-source 這兩個模組，留著不影響；移除是為了避免狀態混淆。

**R4｜依需要重新啟動 8022（手動、一次）**

只有在服務必須恢復時才做，且必須用**原始**啟動器手動執行一次：

```powershell
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1'
```

**R5｜確認排程維持停用**

```powershell
Get-ScheduledTask -TaskName 'FDE-AI v1.5C Classroom Server' | Select-Object State
```

必須為 `Disabled`。**不得**為了「恢復原狀」而重新啟用排程——那會立刻恢復
每 5 分鐘誤殺。

**R6｜記錄與回報**

把 R1–R5 的輸出、觸發原因、失敗步驟貼進 `$bk\ROLLBACK_LOG.txt`，回報架構師。

### 10.3 回滾後的系統狀態

| 項目 | 狀態 |
|---|---|
| 正式啟動器 | 原始版（`a64330ef…`） |
| 排程 | **停用**（需人工決定後續） |
| 8022 | 由手動執行維持，或依架構師指示停止 |
| 8770／8030 | 不受影響 |
| 誤殺循環 | **已停止**（因為排程停用） |

> 這個狀態是「安全但需人工」的。它的缺點是失去自動恢復能力；優點是不會再
> 每 5 分鐘殺掉服務。架構師需在 24 小時內決定下一步。

---

## 第 11 章　故障決策樹

| 現象 | 可能原因 | 處置 |
|---|---|---|
| `startup.log` 出現 `STOPPING stale 8022` | 排程未停用，或補丁未生效 | 確認排程 `Disabled`；確認部署後 SHA = `a95a857b…`；進回滾 |
| `Ownership module not found` | 模組未放到 `D:\FDE-AI-Gateway\` | 依第 7 章步驟 6.2 補放；重新執行 |
| `Adoption module not found` | 同上 | 同上 |
| `requires Write-V15CStateRecord from V15C-Ownership.ps1` | 模組版本不匹配 | 用第 1.2 節的 SHA 重新部署兩個模組 |
| `refusing to stop or start` + `UNKNOWN` | 證據不足（多為非提升權限） | 確認 `IsElevated=True` 後重試；仍失敗則回滾 |
| `refusing to stop or start` + `FOREIGN` | 8022 被非本專案程序佔用 | **不得終止**；回報架構師 |
| `ADOPTION CLAIM FAILED` | 狀態檔被其他存活程序持有，或狀態檔損壞 | 檢查狀態檔；必要時依第 4 章備份後人工移除，再重試 |
| `PID STATE NOT WRITTEN reason=replace_failed` | 狀態檔為唯讀或被鎖 | 檢查檔案屬性與鎖；服務已在線，可先觀察下一週期 |
| `SKIP duplicate startup instance` | 另一實例持有鎖 | 等 5 分鐘或確認無殘留 launcher 後重試 |
| `Start-Process : Item has already been added. Key in dictionary: 'https_proxy'` | 環境同時存在大小寫兩份 proxy 變數 | **本輪新發現**：見第 11.1 節 |
| `v1.5C Django did not become available` | Django 未啟動或埠被佔 | 查 `logs\django.err.log`；確認 8022 已釋放 |
| 8770 消失或 PID 改變 | 不應發生 | **立即停止全部操作**，回報架構師 |

### 11.1 新發現的環境風險：重複大小寫的環境變數

第十九階段故障注入時發現：當程序環境同時存在 `https_proxy` 與 `HTTPS_PROXY`
（大小寫不同的同名變數）時，`Start-Process -RedirectStandardOutput` 會拋出

```
Start-Process : Item has already been added. Key in dictionary: 'https_proxy'  Key being added: 'HTTPS_PROXY'
```

導致 Django 永遠不會啟動，launcher 經 trap 後 `exit 1`。

- **是否為本補丁引入**：否。`Start-Process` 這三行在補丁中未被修改（`PATCH-v3.diff` 不含）。
- **正式環境目前是否受影響**：否。8022 目前正常在線，且 `startup.log` 無此錯誤。
- **風險**：若日後有工具（例如某些代理設定腳本）在使用者或系統環境變數中同時寫入
  兩種大小寫，下一次排程執行就會啟動失敗。
- **窗口前檢查**：

```powershell
Get-ChildItem Env: | Where-Object { $_.Name -match '(?i)proxy' } | Select-Object Name,Value
```

若出現同名不同大小寫的配對，先清除其中一份再執行。

---

## 第 12 章　附錄

### 12.1 檔案 SHA-256 對照表

| 檔案 | SHA-256 | Bytes |
|---|---|---|
| 正式啟動器（原始） | `a64330ef7a31e6c981fba95117466610af5e5db833d1ddafc8d91dba1c7a7b59` | 15,766 |
| `patched-v3.ps1`（部署用） | `a95a857b11de2ca13483d0e50ae23c2c064b654994a51f7accfb56d0280d762b` | 19,736 |
| `V15C-Ownership.ps1` | `adf7f8ecd6bcdaf3d5bd013569c9c6231f0e7f16bf64675a83b0042391b03ec8` | 19,902 |
| `V15C-Adoption.ps1` | `48cb7c34732d1eb8c40611e3cf741c3b717784665ab7fde8dde8c544d66b81b1` | 22,949 |
| `PATCH-v3.diff` | `c24d3854f5e082bf52f05b8cc319079b97c6eb3d7302e2aff95fcb6a2383ef79` | 6,472 |

### 12.2 關鍵路徑

| 用途 | 路徑 |
|---|---|
| 正式啟動器 | `D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1` |
| 模組放置位置 | `D:\FDE-AI-Gateway\V15C-Ownership.ps1`、`V15C-Adoption.ps1` |
| 狀態目錄 | `C:\Users\admin\AppData\Local\FDE-AI\classroom` |
| 狀態檔 | `…\classroom\django-v15c-pid.json` |
| 啟動日誌 | `…\classroom\startup.log` |
| 錯誤日誌 | `…\classroom\startup-error.log` |
| tunnel 狀態 | `…\classroom\tunnel-state.json` |
| 專案根 | `D:\FDE-AI-UAS\v1.5C\student_portal` |
| venv shim | `C:\Users\admin\Documents\Codex\2026-08-30\new-chat\FDE-AI-v1.5\student_portal\.venv\Scripts\python.exe` |
| base interpreter | `C:\Users\admin\.fde-ai\YoloRuntime\python\cpython-3.12.13-windows-x86_64-none\python.exe` |

### 12.3 排程定義（唯讀參考）

| 項目 | 值 |
|---|---|
| TaskName | `FDE-AI v1.5C Classroom Server` |
| RunLevel | `Highest` |
| UserId | `admin` |
| LogonType | `Interactive` |
| Triggers | `MSFT_TaskLogonTrigger` + `MSFT_TaskTimeTrigger`（`PT5M`） |
| MultipleInstances | `IgnoreNew` |
| ExecutionTimeLimit | `PT0S`（無限制） |
| Action | `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1"` |
| WorkingDirectory | `D:\FDE-AI-Gateway` |

### 12.4 版本與簽核

| 項目 | 內容 |
|---|---|
| 文件版本 | v1.0（P3-H 第十九階段初稿） |
| 狀態 | **待批准** |
| 批准人 | ____________________ |
| 批准日期 | ____________________ |
| 執行窗口 | ____________________ |
| 執行者 | ____________________ |
| 覆核者 | ____________________ |

---

**文件結束。本文件在獲得明確批准前不得執行。**
