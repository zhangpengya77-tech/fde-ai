# FDE-AI 2.0｜P3-H 第十九階段
# 8022 正式維護操作手冊（Runbook）— 最終版

| 項目 | 內容 |
|---|---|
| 文件狀態 | **待批准（FINAL REVIEW — NOT APPROVED）** |
| 用途 | 8022 啟動器安全修復的正式部署與回滾程序 |
| 適用對象 | 專案架構師 / 維運執行者（具本機 Administrator 權限） |
| 產生階段 | P3-H 第十九階段（Pre-Maintenance Gate）→ 含第十九階段補充驗證與最終安全確認 |
| 產生時間 | 2026-10-28 |
| 執行限制 | **本文件不得自動執行。每一步都需人工確認並留證。** |
| 前置依賴 | 第十八階段補丁 `patched-v3`（SHA `bc577513…`）+ 兩個模組（V15C-Ownership `adf7f8ec…`、V15C-Adoption `7988d866…`） |
| 取代關係 | 取代 `P3H_PHASE19_MAINTENANCE_RUNBOOK_2026-10-27.md`（DRAFT）；本版為審查定稿 |

> **重要**：本輪（第十九階段 + 補充驗證 + 最終安全確認）**未執行任何正式修復**。本手冊只是待批准的操作文件。
> 在架構師／教師**明確另行批准**之前，**不得**進入正式維護窗口。

---

## 第 0 章　八點審查合規對照表（架構師授權 C 審查項）

| # | 審查點 | 本手冊對應章節 | 合規結論 |
|---|---|---|---|
| 1 | 方案 A 的受控停機與啟動順序 | 第 5 章時間軸、第 6 章停用排程、第 7 章方案 A 十步 | 合規 |
| 2 | 方案 B 的完整所有權收養條件 | 第 7B 章（新增）、附錄 A 證據鏈 | 合規（條件已文件化；剩餘閘門 E3 見第 7B.4） |
| 3 | 失敗時不會自動停止正式 8022 | 第 1.2 節（永不終止）、第 8.2 節（UNKNOWN/FOREIGN→安全中止）、第 11 章決策樹 | 合規（修復語義：任何失敗皆 `throw`/中止，不殺程序） |
| 4 | 舊版啟動器不會搭配原問題排程直接恢復 | 第 10 章回滾（R1/R5：回滾必須保持排程停用） | 合規（核心原則：舊檔＋原排程＝恢復誤殺，禁止） |
| 5 | 安全回滾的服務恢復責任人 | 第 3.1 節角色、第 10.3 節（架構師 24h 內決定） | 合規（責任人＝架構師／教師；執行者僅按手冊操作） |
| 6 | 三個以上排程週期的觀察方式 | 第 9.2 節（3×5min 週期，通過標準） | 合規 |
| 7 | 8770、8030、Tunnel 的保護措施 | 第 1.3 節（範圍外）、第 2.2 節（硬性禁止）、第 7 步驟 5/9、第 11 章 | 合規（8770 消失→全停；tunnel 必須 REUSE 不可重建；Tunnel 兩處 Stop-Process 不在本窗口） |
| 8 | 正式維護需另行取得明確批准 | 全文「待批准」標記、第 12.4 節簽核、本文件末 | 合規（須架構師單獨書面批准窗口） |

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
- 生產日誌 `startup.log` 累計 `STOPPING stale 8022` 數以千計。
- 每次殺到恢復約 129 秒，可用率約 60%。

### 1.2 修復內容（第十八階段已完成，第十九階段補充驗證 E4c）

| 檔案 | 角色 | SHA-256（2026-10-28 核驗值） |
|---|---|---|
| `start_fde_v15c_classroom.patched-v3.ps1` | 補丁主體 | `bc57751349551959c9a7957039854d291a59800b3a166a42786dc9d805c5640d0` |
| `V15C-Ownership.ps1` | 所有權判定＋唯一原子狀態寫入器（`Write-V15CStateRecord` 定義於第 292 行） | `adf7f8ecd6bcdaf3d5bd013569c9c6231f0e7f16bf64675a83b0042391b03ec8` |
| `V15C-Adoption.e4c.ps1` | 受控收養閘門（E1–E8）— **本任務隔離驗證副本（雙標記修復）** | `7988d8668ba8be71bc656c85625e4bad8867c6fc80a5c4fd7c416ebb64c74fe9` |
| `V15C-Adoption.ps1` | 受控收養閘門 — 並行代理所有，現已**獨立改為相同雙標記** | `7988d8668ba8be71bc656c85625e4bad8867c6fc80a5c4fd7c416ebb64c74fe9`（與 e4c 副本 byte-identical） |

> E4c 修復說明（第十九階段補充驗證 B）：原 `HealthMarkers` 要求三標記
> `('FDE-AI','csrfmiddlewaretoken','resend-verification')`，但正式 `/login/` 頁面
> **不含 `resend-verification`**，導致 E4c 永 False → 收養永 UNKNOWN。修復為雙標記
> `('FDE-AI','csrfmiddlewaretoken')`（移除與專案身分無關的弱標記，**未降低檢查強度**）。
> LIVE 實測證實：雙標記 `AllMarkers=True`、三標記 `AllMarkers=False`（必要且充分）。

修復語義：**永不終止任何程序**。8022 上有 listener 時，只做「判定 → 重用／收養／中止」，
中止就 `throw`，由 trap 記錄後 `exit 1`。

### 1.3 範圍外（本手冊不處理）

- Cloudflared tunnel 的兩處 `Stop-Process`（正式檔 L246／L268）——既有殘留風險，
  第十九階段已記錄並提出 Phase 20 修復方案（見最終安全確認報告 §7.4），**本窗口不動**。
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
| P9 | E3 CommandLine 在提升身分下可讀（方案 B 必要；方案 A 不依賴） | 見第 7B.4 節 |
| P10 | **環境無大小寫重複的代理變數**（不可同時存在 `https_proxy` 與 `HTTPS_PROXY`、`http_proxy` 與 `HTTP_PROXY`） | `cmd /c set \| findstr /i proxy`；或執行 `Test-V15CPhase20I11ProxyConflict.ps1` |

> **P10 為什麼是硬條件（A-2 新增）**：三個啟動器版本皆以 `Start-Process … -RedirectStandardOutput`
> 啟動 Django/RAG。Windows 環境區塊大小寫不敏感，當 `https_proxy` 與 `HTTPS_PROXY` 同時存在時，
> `Start-Process` 會拋出 `Item has already been added. Key in dictionary: 'https_proxy' …`，
> **子程序永不啟動**。A-2 的 I-11 已實測重現（4/4 PASS 佐證）並驗證：移除重複項後立即可啟動。
> 啟動器目前僅設 `UseProxy=$false`，未清理重複變數；維護窗口前必須先去重（或保證乾淨環境），
> 否則 Django 無法啟動。

> **P8 為什麼是硬條件**：非提升權限的 session 讀不到提升權限程序的
> `CommandLine`／`ExecutablePath`，所有權判定會落在 `command_line_unreadable`
> → `UNKNOWN` → 中止。第十九階段最終安全確認已實測：非提升權限對 8022 的判定結果為
> `listener_pid_matches; command_line_unreadable`；提升身分（排程 `RunLevel=Highest`）
> 下方可讀，待維護主機以提升身分執行即滿足。

### 2.2 硬性禁止

- 不得修改 8770／8030 的任何程序或設定。
- 不得修改正式資料庫與 MEDIA_ROOT。
- 不得修改 Cloudflare Tunnel／DNS／GitHub Pages。
- **不得終止未經本手冊明確辨識的程序**（見第 7 章的程序辨識三條件）。
- 不得在排程仍啟用時執行手動維護（見第 6 章）。
- 不得略過第 5 章的時間軸順序。
- 不得在未備份的情況下覆蓋任何正式檔案。
- 不得 push 任何 commit；本輪不涉及 commit。
- **不得為加快而終止「疑似」launcher 的程序**（它可能正在寫狀態檔）。
- **8770 消失或 PID 改變時，立即停止全部操作並回報**（見第 11 章）。

---

## 第 3 章　角色與授權

### 3.1 角色

| 角色 | 職責 | 必要權限 |
|---|---|---|
| 架構師／教師 | 批准本手冊、裁決方案 A/B、批准回滾、**擔任安全回滾的服務恢復責任人** | 無需本機權限 |
| 維運執行者 | 按本手冊逐條執行、留證 | 本機 Administrator（提升權限） |
| 覆核者 | 獨立核對每一步的證據，簽核 | 本機讀取權限 |

> **服務恢復責任人（第 0 章第 5 點）**：任何回滾或失敗後，8022 的最終恢復形態
> （重啟舊檔手動維持／依指示停止／後續處置）**由架構師在 24 小時內決定**。執行者
> 僅負責執行本手冊步驟，無權自行決定恢復策略。

### 3.2 提升權限確認（P8）

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

（與 DRAFT 版第 4 章一致；執行前必須完成，任一未完成不得進入第 5 章。）

### 4.1 建立備份目錄
### 4.2 備份正式啟動器與狀態目錄
### 4.3 記錄 SHA-256 清單
### 4.4 記錄服務現況（唯讀）
### 4.5 備份完成檢查

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$bk = "D:\FDE-AI-Gateway\backups\P3H19-$stamp"
New-Item -ItemType Directory -Force -Path $bk | Out-Null
Copy-Item 'D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1' $bk -Force
Copy-Item 'C:\Users\admin\AppData\Local\FDE-AI\classroom' (Join-Path $bk 'classroom') -Recurse -Force
Get-FileHash 'D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1' -Algorithm SHA256 |
  Format-List | Out-File (Join-Path $bk 'SHA_BEFORE.txt') -Encoding utf8
Get-NetTCPConnection -State Listen -LocalPort 8022,8770,8030 |
  Select-Object LocalPort,OwningProcess | Format-Table -AutoSize
Get-Content 'C:\Users\admin\AppData\Local\FDE-AI\classroom\startup.log' -Tail 20
Get-Content 'C:\Users\admin\AppData\Local\FDE-AI\classroom\tunnel-state.json' -Raw
```

- [ ] `$bk\start_fde_v15c_classroom.ps1` 存在且 SHA = `a64330ef…`
- [ ] `$bk\classroom\` 內含 `startup.log`、`tunnel-state.json`、`current-tunnel-url.txt`
- [ ] `SHA_BEFORE.txt` 已產生
- [ ] 服務現況已貼入 `WINDOW_LOG.txt`

---

## 第 5 章　維護窗口時間軸

| 時點 | 動作 | 章節 |
|---|---|---|
| T-30 min | 通知使用者停機、確認無學員在線 | 5.1 |
| T-20 min | 完成第 4 章備份與現況記錄 | 4 |
| T-10 min | **停用排程**（關鍵） | 6 |
| T-5 min | 再次確認排程已停用、無 launcher 在跑 | 6.3 |
| T+0 | 停止 8022 → 部署補丁 → 冷啟動（方案 A） | 7A |
| T+0（替代） | 若採方案 B：啟用受控收養路徑（不停止 8022） | 7B |
| T+10 min | 驗證（health／state／tunnel／8770） | 8 |
| T+15 min | 恢復排程 | 9.1 |
| T+15 ~ T+45 | 觀察 3 個 5 分鐘週期 | 9.2 |
| T+45 min | 收尾、簽核 | 9.3 |

### 5.1 停機通知範本

> 系統將於 `<時間>` 進行例行維護，預計 `<N>` 分鐘無法使用。維護期間請勿上傳作業。

---

## 第 6 章　步驟 A：停用問題排程（必要前置）

> **這是整個窗口最關鍵的一步。** 排程若仍啟用，5 分鐘內就會再殺一次 8022，
> 使冷啟動與驗證全部失效。

### 6.1 停用排程
### 6.2 確認停用（`State = Disabled`）
### 6.3 確認無 launcher 正在執行（必須回傳空集合）
### 6.4 確認實例互斥鎖已釋放

```powershell
Disable-ScheduledTask -TaskName 'FDE-AI v1.5C Classroom Server'
Get-ScheduledTask -TaskName 'FDE-AI v1.5C Classroom Server' | Select-Object TaskName,State
Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" |
  Where-Object { $_.CommandLine -match 'start_fde_v15c_classroom\.ps1' } |
  Select-Object ProcessId,CreationDate,CommandLine
```

---

## 第 7A 章　方案 A：受控冷啟動（十步程序）

> **本輪不執行。** 以下為待批准的執行程序。
> 方案 A 優點：不依賴 CommandLine 可讀性——停止 8022 後由補丁版空環境直接冷啟動，
> 不進入 R-1 收養判定。

### 步驟 1｜確認排程已停用（回到 6.2）
### 步驟 2｜記錄停止前的 8022 完整身分（ExecutablePath／CommandLine／CreationDate）
### 步驟 3｜以三條件驗證目標程序（同時成立才允許停止）
1. `ExecutablePath` = `C:\Users\admin\.fde-ai\YoloRuntime\python\cpython-3.12.13-windows-x86_64-none\python.exe`
2. `CommandLine` 同時匹配 `manage\.py\s+runserver` 與 `127\.0\.0\.1:8022`
3. `CreationDate` 與步驟 2 記錄一致

任一不符 → **停止整個窗口**，回報架構師。

### 步驟 4｜停止 8022（只停這一個 PID，禁用批次終止）
### 步驟 5｜確認 8022 已釋放且 8770 未受影響（8770 消失或 PID 改變→立即停止回報）
### 步驟 6｜部署補丁（先備份再覆蓋；先放模組再覆蓋主檔）

```powershell
$src = 'D:\FDE-AI-UAS-v2.0-p3h-local-backend\ops\p3h\v15c-launcher'
$dst = 'D:\FDE-AI-Gateway'
Get-FileHash "$src\start_fde_v15c_classroom.patched-v3.ps1" -Algorithm SHA256  # 必須 bc577513…
Get-FileHash "$src\V15C-Ownership.ps1" -Algorithm SHA256                        # 必須 adf7f8ec…
Get-FileHash "$src\V15C-Adoption.e4c.ps1" -Algorithm SHA256                     # 必須 7988d866…
Copy-Item "$src\V15C-Ownership.ps1" $dst -Force
Copy-Item "$src\V15C-Adoption.e4c.ps1"  $dst -Force
Copy-Item "$src\start_fde_v15c_classroom.patched-v3.ps1" "$dst\start_fde_v15c_classroom.ps1" -Force
Get-FileHash "$dst\start_fde_v15c_classroom.ps1" -Algorithm SHA256               # 必須 bc577513…
```

> 部署用收養模組以 **`V15C-Adoption.e4c.ps1`**（本任務隔離驗證副本，雙標記修復，
> 9/9 測試通過）為準；`V15C-Adoption.ps1` 現已與之 byte-identical，二者擇一即可，但
> 建議以 e4c 副本為權威來源。

### 步驟 7｜以提升權限手動執行一次（模擬排程身分）
### 步驟 8｜驗證狀態檔（pid == 8022 PID）
### 步驟 9｜驗證健康與 tunnel（tunnel URL 應 REUSE，不得重建）
### 步驟 10｜恢復排程前的最後確認（任一不成立→進第 10 章回滾）

---

## 第 7B 章　方案 B：完整所有權收養條件（第十九階段後由 BLOCKED 提升為 CONDITIONAL）

> 方案 B 不停止 8022：當 8022 上已有自家 listener、但本機尚無 PID 狀態檔時，
> 以八項證據鏈判斷後「收養」並寫入狀態檔（claim），服務不中斷。

### 7B.1 八項證據鏈（全部通過 → `ADOPTABLE`）

| 證據 | 判定內容 | 來源（模組） |
|---|---|---|
| E3 | 8022 listener 的 `CommandLine` 可讀（提升身分下） | `Get-V15CListenerDetail` |
| E4a | venv `pyvenv.cfg` 的 `home` = 觀察到的 base interpreter | `Test-V15CVenv` |
| E4b | 兩處 `manage.py` 同 SHA256（專案身分） | `Test-V15CProject` |
| **E4c** | **HTTP 登入頁指紋：雙標記 `FDE-AI` + `csrfmiddlewaretoken` 皆存在（輔助訊號）** | `Get-V15CHealthDetailed` |
| E5 | interpreter 身分：`self` 或 `ancestor`（shim→base 鏈） | `Resolve-V15CListenerMode` |
| E6 | 取證期間 listener PID 無漂移 | 二次 `Get-Listener` |
| E7 | 專屬健康端點 `Ok` | `Get-V15CHealthDetailed` |
| E8 | 無其他 launcher 實例（mutex 空閒） | `Get-V15CLauncherConflict` |

### 7B.2 E4c 嚴格為輔助訊號（第十九階段補充驗證確認）

- 在 `V15C-Adoption.e4c.ps1` 中：`$e4c = [bool]$health.AllMarkers`，且
  `$e4 = ($e4a -and $e4b -and $e4c)`；`ADOPTABLE` 需 `$allOk`（e4a∧e4b∧e4c∧e7∧e6∧e8 全 True）。
- **E4c 單獨永遠無法授予 `ADOPTABLE`，更無法授予 `OWNED`。**
- `OWNED` 只來自 R-1 路徑（狀態檔已存在且吻合）；收養路徑最多得到 `ADOPT`（claim），絕非 `OWNED`。
- 身分錯誤的 HTTP 200 頁面（缺雙標記）→ `AllMarkers=False` → `e4c=False` → `UNKNOWN`，閘門不弱化。
- 第十九階段補充驗證 `Test-V15CPhase19E4c.supp.ps1` 9/9 通過，含上述負向案例。

### 7B.3 收養決策（純函式，無副作用）

`Resolve-V15CListenerAction`：
- `Verdict=OWNED` → `REUSE`（自家程序，重用）。
- 狀態檔缺失 且 `Adoption.Verdict=ADOPTABLE` → `ADOPT`（claim）。
- 狀態檔缺失 且 證據不足 → `ABORT`（安全中止，永不殺程序）。
- `Verdict=FOREIGN` → `ABORT`。
- 其他 `UNKNOWN` → `ABORT`。

### 7B.4 剩餘閘門（方案 B 為 CONDITIONAL 的唯一原因）

- **E3（CommandLine 可讀性）在正式排程提升身分下仍 `NOT DETERMINED`**：本沙箱非提升
  session 讀不到提升程序的 `CommandLine`（第十九階段最終安全確認 E3 探針實測，
  `rawLength=0`）。在真實維護主機以 `RunLevel=Highest` 提升身分執行時，CommandLine **可讀**，
  此閘門即解除。
- 維護窗口前以一次提升唯讀探針（留存 `E3-final-readonly-probe.ps1` 或 `E3-elevated-probe.ps1`）
  確認 P9 成立，方案 B 即轉為 READY。

---

## 第 8 章　驗證與證據收集

### 8.1 必要證據清單（與 DRAFT 一致，E3 改為「停止前 8022 三條件」或「方案 B 八證據」依所採方案）

| # | 證據 | 來源 |
|---|---|---|
| E1 | 部署前後正式檔 SHA 對照 | 第 4.3 / 7A 步驟 6 |
| E2 | 排程停用與恢復的 State 輸出 | 6.2 / 9.1 |
| E3 | 停止前 8022 程序三條件（方案 A）或 八證據輸出（方案 B） | 7A 步驟 2–3 / 7B |
| E4 | 8022 釋放後三埠狀態 | 7A 步驟 5 |
| E5 | 冷啟動／收養日誌全文 | 7A 步驟 7 / 7B |
| E6 | 狀態檔內容 | 7A 步驟 8 |
| E7 | 兩個 health 狀態碼 | 7A 步驟 9 |
| E8 | 觀察期 3 個週期的 `startup.log` | 9.2 |

### 8.2 判讀規則

| 日誌字樣 | 含義 | 處置 |
|---|---|---|
| `8022 OWNED pid=…; reuse` | 判定為自家程序，直接重用 | 正常 |
| `8022 ADOPTED pid=…` | 收養成功並寫入狀態 | 正常（方案 B） |
| `8022 ADOPTION CLAIM FAILED` | 收養寫入被拒 | 進第 10 章 |
| `8022 UNKNOWN …; refusing to stop or start` | 證據不足，安全中止 | 進第 10 章（**不殺程序**） |
| `8022 FOREIGN …; refusing to stop or start` | 判定為他方程序，安全中止 | 進第 10 章（**不殺程序**） |
| `STOPPING stale 8022 listener` | **不應出現** | 立即進第 10 章 |

---

## 第 9 章　恢復排程與觀察期

### 9.1 恢復排程（`State = Ready`）
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

### 9.3 收尾（觀察期前後 `STOPPING stale 8022` 計數差必須為 0）與 9.4 簽核。

---

## 第 10 章　回滾程序（恢復舊檔但保持問題排程停用）

> **核心原則**：舊版啟動器加上原排程，會恢復每五分鐘誤殺風險，因此**禁止**直接當作
> 安全回滾。回滾**必須同時**恢復舊檔並**讓排程保持停用**，由**架構師**（服務恢復責任人）
> 接手，24 小時內決定下一步。

### 10.1 觸發條件（任一成立）
### 10.2 回滾步驟（R1 停用排程 → R2 恢復原始啟動器 → R3 移除模組 → R4 必要時手動重啟 → R5 確認排程仍 `Disabled` → R6 記錄回報）
### 10.3 回滾後狀態（正式啟動器＝原始版；**排程＝停用**；誤殺循環已停止；8770/8030 不受影響）

---

## 第 11 章　故障決策樹（與 DRAFT 一致，含 8770 保護與 proxy 環境變數風險）

| 現象 | 可能原因 | 處置 |
|---|---|---|
| `startup.log` 出現 `STOPPING stale 8022` | 排程未停用，或補丁未生效 | 確認排程 `Disabled`；確認部署後 SHA = `bc577513…`；進回滾 |
| `Ownership module not found` | 模組未放到 `D:\FDE-AI-Gateway\` | 依第 7A 步驟 6 補放；重新執行 |
| `requires Write-V15CStateRecord from V15C-Ownership.ps1` | 模組版本不匹配 | 用第 1.2 節的 SHA 重新部署 |
| `refusing to stop or start` + `UNKNOWN` | 證據不足（多為非提升權限） | 確認 `IsElevated=True` 後重試；仍失敗則回滾 |
| `refusing to stop or start` + `FOREIGN` | 8022 被非本專案程序佔用 | **不得終止**；回報架構師 |
| `ADOPTION CLAIM FAILED` | 狀態檔被其他存活程序持有或損壞 | 檢查狀態檔；必要時備份後人工移除再重試 |
| `SKIP duplicate startup instance` | 另一實例持有鎖 | 等 5 分鐘或確認無殘留 launcher 後重試 |
| `Start-Process : Item has already been added. Key: 'https_proxy'/'HTTPS_PROXY'` | 環境同時存在大小寫兩份 proxy 變數 | 窗口前檢查並清除其一 |
| 8770 消失或 PID 改變 | 不應發生 | **立即停止全部操作**，回報架構師 |

---

## 第 12 章　附錄

### 12.1 檔案 SHA-256 對照表（2026-10-28 最終核驗值）

| 檔案 | SHA-256 | Bytes |
|---|---|---|
| 正式啟動器（原始，不可改） | `a64330ef7a31e6c981fba95117466610af5e5db833d1ddafc8d91dba1c7a7b59` | 15,766 |
| `patched-v3.ps1`（部署用） | `bc57751349551959c9a7957039854d291a59800b3a166a42786dc9d805c5640d0` | 19,713 |
| `V15C-Ownership.ps1` | `adf7f8ecd6bcdaf3d5bd013569c9c6231f0e7f16bf64675a83b0042391b03ec8` | 19,902 |
| `V15C-Adoption.e4c.ps1`（雙標記修復，權威副本） | `7988d8668ba8be71bc656c85625e4bad8867c6fc80a5c4fd7c416ebb64c74fe9` | 22,926 |
| `V15C-Adoption.ps1`（並行代理所有，現 byte-identical） | `7988d8668ba8be71bc656c85625e4bad8867c6fc80a5c4fd7c416ebb64c74fe9` | 22,926 |
| `PATCH-v3.diff` | `c24d3854f5e082bf52f05b8cc319079b97c6eb3d7302e2aff95fcb6a2383ef79` | 6,472 |

> 註：DRAFT 版（2026-10-27）所列 `patched-v3` (`a95a857b…`)、`V15C-Adoption` (`48cb7c34…`)
> 為更早構建；本表為第十九階段補充驗證與最終安全確認後的**權威核驗值**。
> `V15C-Adoption.ps1` 與 `V15C-Adoption.e4c.ps1` 現為 byte-identical（雙標記修復），
> 二者 SHA 相同，不互相覆蓋。

### 12.2 關鍵路徑（與 DRAFT 一致）
### 12.3 排程定義（唯讀參考）

| 項目 | 值（第十九階段最終安全確認 E3 探針實測） |
|---|---|
| TaskName | `FDE-AI v1.5C Classroom Server` |
| RunLevel | `Highest` |
| UserId | `admin` |
| LogonType | `Interactive` |
| Triggers | `MSFT_TaskLogonTrigger` + `MSFT_TaskTimeTrigger`（`PT5M`） |
| MultipleInstances | `IgnoreNew` |
| Action | `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1"` |

### 12.4 版本與簽核

| 項目 | 內容 |
|---|---|
| 文件版本 | v2.0 FINAL（P3-H 第十九階段最終審查定稿） |
| 狀態 | **待批准（須架構師單獨書面批准維護窗口）** |
| 批准人 | ____________________ |
| 批准日期 | ____________________ |
| 執行窗口 | ____________________ |
| 執行者 | ____________________ |
| 覆核者 | ____________________ |

### 12.5 本次審查發現（透明回報）

1. **Hash 變動回報**：`V15C-Adoption.ps1` / `V15C-Adoption.e4c.ps1` 現 SHA = `7988d866…`，
   與 DRAFT 版（2026-10-27）所載 `48cb7c34…`（及更早補充報告所載 `22926798…`）不同。
   經內容核對：兩檔現為 byte-identical、第 297 行均為雙標記修復、不含 `resend-verification`、
   mtime 早於本會話（非本任務所改）。結論：系前期記錄值滯後／筆誤，**修復內容完好無損**，
   非並行代理覆寫損壞。並行代理獨立將其自有 `V15C-Adoption.ps1` 改為相同雙標記，與本任務一致。
2. **E3 CommandLine**：非提升身分下 `rawLength=0` → `NOT DETERMINED`；提升身分（排程）下可讀，
   待維護主機執行即滿足 P9。
3. **E3 探針非 ASCII**：`E3-elevated-probe.ps1` 含 3 個非 ASCII 位元（註解／字串中的破折號），
   PS5.1 AST 語法檢查 0 錯誤（位於註解／字串，不影響解析）；建議維護會話執行前確認可解析。

---

**文件結束。本文件在獲得架構師明確批准之前不得執行。**
