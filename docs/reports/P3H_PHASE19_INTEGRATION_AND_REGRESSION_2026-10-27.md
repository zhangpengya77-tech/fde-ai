# P3-H 第十九階段｜整合驗證與全量回歸報告

- 日期：2026-10-27（13:41–13:55 本地時間）
- 分支：`codex/p3h-local-backend`
- HEAD：`2fd4f2421dc18df761db80e74e6c4f134448feaf`（**未變**）
- 正式啟動器 SHA-256：`a64330ef7a31e6c981fba95117466610af5e5db833d1ddafc8d91dba1c7a7b59`（**完整值相符**）
- 已追蹤檔案修改：**0**
- 本輪性質：隔離開發與驗收。**未執行任何正式修復**。

---

## 0. 裁決建議

# **CONDITIONAL**

| 面向 | 判定 | 條件 |
|---|---|---|
| 方案 A（冷啟動切換） | **可執行** | 部署時必須把兩個模組複製到 `D:\FDE-AI-Gateway\` |
| 方案 B（受控收養） | **BLOCKED** | 必須先修 `HealthMarkers` 預設值，並以提升權限實證 `CommandLine` 可讀 |
| 整合補丁 v3 | **READY** | 30/30 + 18/18 全綠，補丁可重現（SHA 一致） |

**建議路徑**：以方案 A 完成首次切換（不依賴任何未實證假設），方案 B 作為第二階段，待兩項前置完成後再評估。

---

## 1. 代碼修改清單

### 1.1 本輪新增

| 檔案 | 大小 | SHA-256 | 用途 |
|---|---|---|---|
| `ops/p3h/v15c-launcher/Test-V15CPhase19FaultMatrix.ps1` | 25,306 | `31c0d300049076b78e2847aa66f0f87c05b938f49746deb84350aa14ac39adf6` | 14 類故障注入矩陣（F01–F14 + G01–G04） |
| `docs/handoff/P3H-V15C-MAINTENANCE-RUNBOOK-2026-10-27.md` | — | — | 維護手冊（交付項 8） |
| `docs/reports/P3H_PHASE19_INTEGRATION_AND_REGRESSION_2026-10-27.md` | — | — | 本報告 |

### 1.2 本輪未修改（僅讀取與驗證）

| 檔案 | SHA-256 | 狀態 |
|---|---|---|
| `V15C-Ownership.ps1` | `adf7f8ecd6bcdaf3d5bd013569c9c6231f0e7f16bf64675a83b0042391b03ec8` | 未變（11:30:21） |
| `V15C-Adoption.ps1` | `48cb7c34732d1eb8c40611e3cf741c3b717784665ab7fde8dde8c544d66b81b1` | 未變（11:56:59） |
| `start_fde_v15c_classroom.patched-v3.ps1` | `a95a857b11de2ca13483d0e50ae23c2c064b654994a51f7accfb56d0280d762b` | 未變（11:58:40） |
| `start_fde_v15c_classroom.patched.ps1` | `5d1fc53dd32a064068ac87d3a03069493f3723e1926c88ff8b346f11bc4e74e9` | 未變（11:16:46） |
| `Test-V15CLauncherOwnership.ps1` | `3157570af27511413eb4a4273583717ba38b66a62b4c6cd81c661375b73cd031` | 未變（11:31:08） |
| `PATCH.diff` | `d43c37ab7d5fc7ffd8fe845b3dba559aaf2651ca16e8624b0f660f7a2e17a9c6` | 未變 |
| `PATCH-v3.diff` | `c24d3854f5e082bf52f05b8cc319079b97c6eb3d7302e2aff95fcb6a2383ef79` | 未變 |
| `fake_manage.py` | `02c2cac6d8d697c6681fd0c5f956a0ac2f3e2e60bf…` | 未變 |
| `fake_project.py` | `edeb68370953b94834c073340e21437983cd017132902006cdc4759ae6ac5b8c` | 未變 |
| `start_fde_v15c_classroom.original.ps1` | `a64330ef7a31e6c981fba95117466610af5e5db833d1ddafc8d91dba1c7a7b59` | 未變 |

**並行會話的檔案未被本輪修改**（依指令：衝突時只讀比較，不覆蓋、不自動合併）。

---

## 2. patched-v3 完整 Diff

### 2.1 補丁可重現性驗證（PASS）

在臨時目錄以 `patch -p0` 將 `PATCH-v3.diff` 套用到 `start_fde_v15c_classroom.original.ps1`：

```
patch_exit=0
結果 SHA-256 = a95a857b11de2ca13483d0e50ae23c2c064b654994a51f7accfb56d0280d762b
目標 v3 SHA  = a95a857b11de2ca13483d0e50ae23c2c064b654994a51f7accfb56d0280d762b
```

**完全一致。** 這證明：
1. `PATCH-v3.diff` 是真實補丁，不是描述性文件
2. v3 相對 original **只有 3 個 hunk**，無隱藏修改
3. 任何人可用 original + patch 精確重建 v3，供獨立審計

### 2.2 三個 hunk 摘要

**hunk 1（第 30 行後，+15 行）** — 宣告與模組載入

```powershell
$DjangoPidStateFile = Join-Path $StateRoot 'django-v15c-pid.json'
$EnableAdoption = $true

$OwnershipModule = Join-Path $GatewayRoot 'V15C-Ownership.ps1'
if (-not (Test-Path -LiteralPath $OwnershipModule)) { throw "Ownership module not found: $OwnershipModule" }
. $OwnershipModule

$AdoptionModule = Join-Path $GatewayRoot 'V15C-Adoption.ps1'
if (-not (Test-Path -LiteralPath $AdoptionModule)) { throw "Adoption module not found: $AdoptionModule" }
. $AdoptionModule
```

**hunk 2（第 197 行區，取代原 STOPPING 區塊）** — 核心：移除自傷終止

原版：
```powershell
if ($ownerPath -and $ownerPath -ne $expectedDjangoExe) {
  Add-Content ... "STOPPING stale 8022 listener: PID=..."
  Stop-Process -Id $django.OwningProcess -Force -ErrorAction SilentlyContinue
  ...
}
```

v3：
```powershell
$verdict = Test-IsV15CDjango -ListenerPid $django.OwningProcess -Port $DjangoPort `
  -V15Root $V15Root -DjangoPython $DjangoPython -StateFile $DjangoPidStateFile `
  -HealthUrl "http://127.0.0.1:$DjangoPort/login/" -HealthMarker 'FDE-AI'
$adoption = $null
if (($verdict.Verdict -ne 'OWNED') -and ($verdict.Reasons -contains 'state_record_absent')) {
  $adoption = Test-V15CAdoptionEligible -ListenerPid $django.OwningProcess ... -MutexName '' -CurrentPid $PID
}
$decision = Resolve-V15CListenerAction -Verdict $verdict.Verdict -Reasons $verdict.Reasons -Adoption $adoption -AdoptionEnabled $EnableAdoption
# REUSE -> log and continue; ADOPT -> claim state; 其他 -> throw（不殺）
```

**關鍵**：整段**沒有任何 `Stop-Process` 指向 Django**。三方分支（REUSE / ADOPT / ABORT）皆不終止程序。

**hunk 3（第 231 行後，+23 行）** — 原子寫入 PID 狀態檔

```powershell
$stateClaim = Write-V15CStateRecord -StateFile $DjangoPidStateFile `
  -ProcessId ([int]$startedListener.OwningProcess) -Port $DjangoPort `
  -V15Root $V15Root -CreatedAtUtc $startedCreated
if ($stateClaim.Written) { Add-Content ... "PID STATE WRITTEN pid=..." }
else { Add-Content ... "PID STATE NOT WRITTEN reason=...; state file left untouched by policy" }
```

被拒時只記錄、不中斷（Django 已上線，中止只損失可用性）。

### 2.3 v3 仍保留的 2 處 `Stop-Process`

測試 T30（並行會話）與 G04（本輪）確認：`stop_process_count=2, targets_django=0`。

| 位置 | 目標 | 風險 |
|---|---|---|
| 第 246 行 | `$existingTunnel`（cloudflared） | TOCTOU 最長 30 s，未驗 CreationDate |
| 第 268 行 | `$startedTunnel`（自己啟動的 cloudflared） | TOCTOU 最長 60 s |

**屬 Tunnel 修復範圍，不在本階段處理**（見第 7.3 節）。

---

## 3. 依賴模組 SHA-256

| 角色 | 檔案 | 大小 | SHA-256 |
|---|---|---|---|
| 正式啟動器（原始基線） | `start_fde_v15c_classroom.original.ps1` | 15,766 | `a64330ef7a31e6c981fba95117466610af5e5db833d1ddafc8d91dba1c7a7b59` |
| 判定模組 | `V15C-Ownership.ps1` | 19,902 | `adf7f8ecd6bcdaf3d5bd013569c9c6231f0e7f16bf64675a83b0042391b03ec8` |
| 收養模組 | `V15C-Adoption.ps1` | 22,949 | `48cb7c34732d1eb8c40611e3cf741c3b717784665ab7fde8dde8c544d66b81b1` |
| 整合啟動器 | `start_fde_v15c_classroom.patched-v3.ps1` | 19,736 | `a95a857b11de2ca13483d0e50ae23c2c064b654994a51f7accfb56d0280d762b` |
| 整合補丁 | `PATCH-v3.diff` | 6,472 | `c24d3854f5e082bf52f05b8cc319079b97c6eb3d7302e2aff95fcb6a2383ef79` |
| 契約測試（30 項） | `Test-V15CLauncherOwnership.ps1` | 40,813 | `3157570af27511413eb4a4273583717ba38b66a62b4c6cd81c661375b73cd031` |
| 故障矩陣（18 項） | `Test-V15CPhase19FaultMatrix.ps1` | 25,306 | `31c0d300049076b78e2847aa66f0f87c05b938f49746deb84350aa14ac39adf6` |
| 測試替身（Django） | `fake_manage.py` | 1,197 | `02c2cac6d8d697c6681fd0c5f956a0ac2f3e2e60bf…` |
| 測試替身（專案） | `fake_project.py` | 2,069 | `edeb68370953b94834c073340e21437983cd017132902006cdc4759ae6ac5b8c` |

### 3.1 編碼與語法（全部 PASS）

| 檔案 | parseErrors | non-ASCII bytes | BOM | PowerShell |
|---|---|---|---|---|
| `V15C-Ownership.ps1` | 0 | 0 | False | 5.1.26100.9711 |
| `V15C-Adoption.ps1` | 0 | 0 | False | 5.1.26100.9711 |
| `start_fde_v15c_classroom.patched-v3.ps1` | 0 | 0 | False | 5.1.26100.9711 |
| `Test-V15CPhase19FaultMatrix.ps1` | 0 | 0 | False | 5.1.26100.9711 |

全部符合 PowerShell 5.1 對 `.ps1` 的 ASCII-only／無 BOM 硬約束。

### 3.2 模組依賴（PASS）

```
先 Ownership 後 Adoption:
  Test-IsV15CDjango=True  Write-V15CStateRecord=True
  Get-V15CProcessInfo=True  Read-V15CStateRecord=True
  → Adoption 載入 OK
  Test-V15CAdoptionEligible=True  Resolve-V15CListenerAction=True  Invoke-V15CAdoptionClaim=True

簽名核對（v3 呼叫端 vs 模組定義）:
  Test-IsV15CDjango        : ListenerPid,Port,V15Root,DjangoPython,StateFile,HealthUrl,HealthMarker  ✓
  Write-V15CStateRecord    : StateFile,ProcessId,Port,V15Root,CreatedAtUtc,...                      ✓
  Test-V15CAdoptionEligible: ListenerPid,Port,V15Root,DjangoPython,HealthUrl,HealthMarkers,...      ✓
  Resolve-V15CListenerAction: Verdict,Reasons,Adoption,AdoptionEnabled                              ✓
  Invoke-V15CAdoptionClaim : Adoption,StateFile,Port,V15Root                                        ✓
```

**反序載入會 throw**（F10 實證）：`V15C-Adoption.ps1 requires V15C-Ownership.ps1 to be dot-sourced first.`

---

## 4. 測試結果

### 4.1 總表

| 套件 | 項數 | PASS | FAIL | 耗時 | 執行者 |
|---|---|---|---|---|---|
| 第十七階段契約（T1a–T14） | 17 | **17** | 0 | 含於下列 | 本輪（重跑） |
| 第十八階段契約（T1a–T27，含前 17 項） | 30 | **30** | 0 | 2m51s | 本輪（重跑） |
| 第十九階段故障矩陣（F01–F14 + G01–G04） | 18 | **18** | 0 | 1m30s | 本輪（新增） |
| **合計（本輪獨立執行）** | **48** | **48** | **0** | 4m21s | — |
| 並行會話 v3 整合套件（參考） | 37 | 37 | 0 | — | 並行會話（12:12:22） |

**說明**：第十七階段的 17 項是第十八階段 30 項的**子集**（T1a–T14 即原 17 項契約）。本輪重跑 30 項即同時涵蓋第十七階段全部契約，未以新增測試替代。

### 4.2 第十八階段 30 項（本輪重跑，節錄關鍵項）

| ID | 項目 | 結果 |
|---|---|---|
| T1a | legit django（真實程序）→ OWNED | PASS |
| T1b | venv shim 子程序（ancestor）→ OWNED | PASS |
| T1c | listener exe 即 DjangoPython（self）→ OWNED | PASS |
| T3/T4 | 不同專案／不同伺服器 → FOREIGN | PASS |
| T5 | PID 重用／建立時間不符 → UNKNOWN | PASS |
| T6 | 命令列不可讀 → UNKNOWN | PASS |
| T8a/T8b | 狀態檔缺失／損壞 → UNKNOWN | PASS |
| T13 | 判定模組從不終止程序（AST 掃描 32 節點，`termination_calls=[]`） | PASS |
| T14 | 執行期間正式啟動器 SHA 不變 | PASS |
| T15 | 原子寫入：120 寫 / 讀者 `bad=0; empty=0` | PASS |
| T16 | 併發啟動：恰一勝出（`loser_reason=existing_owner_alive`） | PASS |
| T17 | 存活他人所有權不被覆寫 | PASS |
| T19 | **正式 8022 唯讀判定永不在證據不足時給 OWNED**（`verdict=UNKNOWN, command_line_unreadable`） | PASS |
| T24 | 他專案絕對路徑 → FOREIGN（`root_hint_mismatch`） | PASS |
| T27 | 佔用者停止後 → 埠釋放 → 新 listener → OWNED | PASS |

**正式環境對照**：`PROD_BEFORE 8022=27424` → `PROD_AFTER 8022=27424`（**測試期間未變**），8770 `14124→14124`，8030 `0→0`。

### 4.3 第十九階段故障矩陣 18 項（本輪新增）

| ID | 故障類別 | 注入方式 | 結果 |
|---|---|---|---|
| **F01** | 狀態檔缺失 | 不建檔 | UNKNOWN（`state_record_absent`），listener 存活 |
| **F02** | 狀態檔損壞 | 寫入 `{ "pid": 12` | UNKNOWN；寫入器拒絕（`existing_state_corrupt`），**檔案 SHA 前後一致** |
| **F03** | 狀態檔無寫入權限 | 設 `IsReadOnly` | 拒絕（`replace_failed`），不崩潰，**檔案未損壞** |
| **F04** | PID 重用 | 記錄指向另一存活程序 | UNKNOWN（`state_pid_mismatch`） |
| **F05** | CreationDate 不一致 | 記錄時間回推 30 s | UNKNOWN（`state_created_at_mismatch`） |
| **F06** | CommandLine 無法讀取 | Provider 注入空字串 | UNKNOWN（`command_line_unreadable`），收養亦 UNKNOWN |
| **F07** | 健康檢查失敗 | Provider 注入 Ok=false | **never OWNED**（UNKNOWN），不終止 |
| **F08** | 驗證途中程序退出 | ①Info 回 null ②listener PID 漂移 | 兩者皆 UNKNOWN；**E6 重驗命中**（`E6_listener_changed_during_evidence`） |
| **F09** | 重複排程觸發 | 連續 3 次判定 | `OWNED,OWNED,OWNED`，PID 不變，不重啟 |
| **F10** | 模組缺失 | 只載 Adoption 不載 Ownership | **throw**：`requires V15C-Ownership.ps1 to be dot-sourced first` |
| **F11** | 版本／結構不匹配 | `{pid, schema_version:99}`（缺 created_at） | UNKNOWN，無誤判 OWNED |
| **F12** | 原子寫入中斷 | 12 寫 × 8 讀 + 殘留 tmp | `reads=96, bad=0`；殘留 tmp 不影響後續寫入 |
| **F13** | FOREIGN／UNKNOWN 不終止 | 外部 http.server 佔埠 | FOREIGN → `ABORT/foreign_process`，**兩者皆存活** |
| **F14** | 受控收養失敗後安全退出 | V15Root 指向無 manage.py 的目錄 | `ABORT/adoption_evidence_insufficient`，`claimed=False`，**狀態檔未建立**，listener 存活 |
| G01 | 8770/8030 未受影響 | — | `14124→14124`, `0→0` |
| G02 | 正式啟動器未變 | — | `a64330ef…` 前後一致 |
| G03 | 測試埠排除正式埠 | — | `18031,18032,18033` |
| G04 | 收養模組無 `Stop-Process` | 原始碼掃描 | `contains_stop_process=False` |

---

## 5. 故障退出驗證（匯總）

所有 14 類故障的**共同結論**：**沒有任何一類導致程序被終止**。

| 保證 | 證據 |
|---|---|
| 判定模組不含終止能力 | T13：AST 掃描 32 節點，`termination_calls=[]` |
| 收養模組不含終止能力 | G04：原始碼無 `Stop-Process` |
| v3 不終止 Django | 並行會話 T30：`stop_process_count=2, targets_django=0` |
| UNKNOWN 不終止 | T21、F01/F02/F05/F06/F07/F08/F11 |
| FOREIGN 不終止 | T22、F13 |
| 收養失敗不終止 | F14（`claimed=False`, `state_exists=False`, `alive=True`） |
| 狀態檔永不留半截 | T15（`bad=0`）、F12（`reads=96, bad=0`）、F02（SHA 一致） |

**失敗模式一律為「拒絕動作 + 記錄 + 中止啟動流程」，而非「殺掉程序重來」。**

---

## 6. 受控收養驗證

### 6.1 收養在隔離環境可運作（PASS）

| 驗證 | 結果 |
|---|---|
| 收養成功 → 寫入狀態 → 轉 OWNED | 並行會話：`before=UNKNOWN/state_absent → ADOPTABLE → ADOPT → claimed=True → after=OWNED` |
| 收養後不重啟程序 | 並行會話：`pid=20300->20300, new_processes=0` |
| 重複觸發只收養一次 | 並行會話：`actions=ADOPT,REUSE,REUSE,REUSE,REUSE, claims=1` |
| 收養失敗安全退出 | 本輪 F14 PASS |
| 收養模組從不終止 | 本輪 G04 PASS |

### 6.2 但在**正式環境**目前無法成立（BLOCKED）

對 `http://127.0.0.1:8022/login/` 實測（本輪）：

| 標記 | 命中 |
|---|---|
| `FDE-AI` | **True** |
| `csrfmiddlewaretoken` | **True** |
| `resend-verification` | **False** |

`V15C-Adoption.ps1` 第 297 行預設值：

```powershell
[string[]]$HealthMarkers = @('FDE-AI', 'csrfmiddlewaretoken', 'resend-verification')
```

`Get-V15CHealthDetailed` 要求 `AllMarkers`（全部命中）。因此 **E4c 必然為 False → E4 失敗 → 永遠 UNKNOWN → ABORT**。

**修正驗證**（本輪實測）：

| markers 組合 | AllMarkers |
|---|---|
| 三標記（現行預設） | **False** |
| `@('FDE-AI','csrfmiddlewaretoken')` | **True** |
| `@('FDE-AI')` | **True** |
| `@()` | **True** |

→ 修正方式明確：把預設值改為兩個穩定標記。

### 6.3 其餘證據項的實測狀態

| 證據項 | 內容 | 狀態 |
|---|---|---|
| **E4a** venv/pyvenv | `pyvenv.cfg` 的 `home` = `C:\Users\admin\.fde-ai\YoloRuntime\python\cpython-3.12.13-windows-x86_64-none`，**正是實際 listener 的 base interpreter** | **PASS（實證）** |
| **E4b** manage.py 同源 | `D:\FDE-AI-UAS\v1.5C\student_portal\manage.py` 與 `...\FDE-AI-v1.5\student_portal\manage.py` 同為 `b30eeb4890cb6f315cc238313808f636db29e9906b61cc6f6051567156a0097b`（684 B） | **PASS（實證）** |
| **E4c** HTTP 指紋 | 三標記 → False | **FAIL（需修 markers）** |
| **E5** interpreter 關係 | listener 父程序為 venv shim（ancestor 模式） | **PASS（結構實證）** |
| **E3** CommandLine | 非提升環境 `CmdLen=0` | **UNKNOWN（需提升權限實證）** |
| E1/E2/E6/E7/E8 | listener／建立時間／重驗／健康／無併發 | 隔離測試全 PASS |

**結論**：8 項證據中 5 項已實證成立、1 項需修設定、1 項需權限實證。**方案 B 不是設計錯誤，而是兩個可修的前置條件未滿足。**

---

## 7. 正式環境只讀兼容性

### 7.1 未受影響（PASS）

| 對象 | 維護前 | 維護後 | 判定 |
|---|---|---|---|
| 正式啟動器 SHA | `a64330ef…7a7b59` | `a64330ef…7a7b59` | 未變 |
| 8770 listener | 14124 | 14124 | 未變 |
| 8030 listener | 無 | 無 | 未變 |
| Gateway 根目錄模組 | 不存在 | **不存在** | 未部署 |
| `django-v15c-pid.json` | 不存在 | **不存在** | 未建立 |
| Git HEAD | `2fd4f242…` | `2fd4f242…` | 未變 |
| 已追蹤檔案修改 | 0 | 0 | 未變 |

### 7.2 8022 的變化屬背景排程（非本輪所致）

| 時點 | 8022 PID | 說明 |
|---|---|---|
| 30 項測試前 | 27424 | — |
| 30 項測試後 | **27424** | 測試期間**未變** |
| 故障矩陣前 | 27096 | 期間背景排程觸發一次 |
| 故障矩陣後 | **27096** | 測試期間**未變** |

兩次測試執行期間，8022 的 PID **各自保持不變**；跨測試的變化（27424→27096）發生在兩次執行之間，由排程 `repeat=PT5M` 造成。這是既有缺陷，與本輪無關。

### 7.3 唯讀兼容性的意義

v3 對正式環境的兼容性表現在：**在正式 listener 上執行判定，不會產生任何副作用**（T19：`verdict=UNKNOWN`，`pid=27424->27424`）。這意味著即使部署了 v3，在 `CommandLine` 不可讀的情況下，最壞結果是「每 5 分鐘 ABORT 一次但不殺程序」——比現況（每 5 分鐘誤殺）安全得多。

---

## 8. 維護 Runbook

獨立文件：`docs/handoff/P3H-V15C-MAINTENANCE-RUNBOOK-2026-10-27.md`

涵蓋 12 節：

| # | 內容 |
|---|---|
| 1 | 現況事實（排程 `RunLevel=Highest`、四週期中斷數據） |
| 2 | 維護前檢查清單（6 項，含權限驗證與 SHA 比對） |
| 3 | 備份（啟動器／狀態目錄／排程 XML／SHA256SUMS） |
| 4 | **部署前置：模組必須複製到 `D:\FDE-AI-Gateway\`** |
| 5 | 方案 A 冷啟動切換（9 步 + 成功判據 + 5 項失敗停止條件） |
| 6 | 方案 B 受控收養（含 BLOCKED 兩原因與解除條件） |
| 7 | 異常退出 |
| 8 | 回滾（三層 + 不安全組合警示） |
| 9 | 驗收：≥3 排程週期觀察（6 項判據） |
| 10 | 五分鐘誤殺循環防復發檢查（24h 抽查腳本 + 5 步排查） |
| 11 | 已知限制（5 項） |
| 12 | 附錄：檔案與 SHA |

**關鍵設計**：第 8.1 節明確標示「原啟動器 + 原排程（Enabled）」為**不安全回滾組合**，因為那正是造成每 5 分鐘自傷的現況。回滾必須落到「原啟動器 + 排程 Disabled」。

---

## 9. 安全回滾方案

### 9.1 三層設計

| 層級 | 組合 | 服務可用 | 誤殺循環 | 建議 |
|---|---|---|---|---|
| **R1** | 原啟動器 + **排程 Disabled** + 手動啟動 | 是 | **無** | **推薦** |
| R2 | 原啟動器 + 排程 Enabled | 是 | **有（每 5 分鐘，對外可用率 73.6%）** | 僅在必須恢復自動重啟時使用，並記錄理由 |
| R3 | 新啟動器 + 排程 Enabled + 殘留狀態檔 | 視情況 | 可能無 | 只在能解釋狀態檔內容時使用 |

### 9.2 R1 步驟（6 步）

1. `Disable-ScheduledTask`
2. 還原啟動器（從備份）
3. 移除 `D:\FDE-AI-Gateway\` 的兩個模組
4. 移除 `django-v15c-pid.json`
5. 驗證 SHA 回到 `a64330ef…`
6. 手動啟動一次確認可用

**回滾後排程維持 Disabled**，是否重新啟用由維護負責人決定並記錄。

### 9.3 回滾的技術保障

| 保障 | 證據 |
|---|---|
| 原始檔完整保存 | `start_fde_v15c_classroom.original.ps1` SHA = `a64330ef…`（與正式檔逐字元相同） |
| 補丁可重現 | `PATCH-v3.diff` 套用後 SHA 與 v3 一致（第 2.1 節） |
| 模組可獨立移除 | v3 在模組缺失時 `throw`（明確失敗，非靜默） |
| 狀態檔可安全刪除 | 原啟動器不認得該檔，刪除無副作用 |
| 排程定義可精確還原 | Runbook 第 3.3 節匯出 XML |

---

## 10. 裁決建議與待決事項

### 10.1 建議：CONDITIONAL

**可以進行的**：以方案 A 完成首次切換。

**必須先完成的**（3 項）：

| # | 事項 | 理由 |
|---|---|---|
| 1 | 部署時複製 `V15C-Ownership.ps1` 與 `V15C-Adoption.ps1` 到 `D:\FDE-AI-Gateway\` | v3 以 `$GatewayRoot` 搜尋，否則 `throw` |
| 2 | 修 `HealthMarkers` 預設值為 `@('FDE-AI','csrfmiddlewaretoken')` | 否則方案 B 永遠 UNKNOWN（第 6.2 節實測） |
| 3 | 以提升權限做一次只讀 `CommandLine` 驗證 | 否則 E3 永遠 UNKNOWN，方案 B 無法脫離 BLOCKED |

**暫時不要做的**：方案 B 的正式切換（在前 2、3 項完成前）。

### 10.2 待架構師決策

1. **是否授權第 10.1 節第 3 項的只讀驗證**（提升權限查詢一次 listener 的 `CommandLine`，不改任何狀態）
2. **`HealthMarkers` 修正由誰執行**：`V15C-Adoption.ps1` 是並行會話的檔案，本輪依指令未修改
3. **方案 A / B 的優先序**：本輪維持「A 先行」建議（A 不依賴未實證假設）
4. **Tunnel 兩處 `Stop-Process` 是否排入 Phase 20**（判定需要：缺終止前重驗，TOCTOU 30s/60s）
5. **並行會話的 37 項測試結果是否納入正式驗收**（本輪僅作參考，未作為通過依據）

### 10.3 本輪未執行事項聲明

- 未停止／啟動／重啟正式 8022
- 未修改正式 v1.5C 啟動器
- 未修改 Windows 排程
- 未修改 8770／8030
- 未修改正式資料庫
- 未修改 Cloudflare Tunnel 或 DNS
- 未 Commit／Push／Merge／Deploy
- 未終止任何未知程序（僅終止本腳本 `$script:started` 中的程序）
- 未繞過 safe-delete
- 未影響其他工作樹（`D:\FDE-Power-Inspection-Simulator*` 全程未觸碰）
- 未修改並行會話的任何檔案

---

## 附錄 A：本輪執行命令與環境

| 項目 | 值 |
|---|---|
| PowerShell | 5.1.26100.9711 |
| ExecutionPolicy | `Process=Bypass`（僅本 session，未改系統設定） |
| 測試埠 | 18022–18027、18031–18033（全部非正式埠） |
| 暫存目錄 | `D:\AI_Cache\temp\p3h-phase19-fault-*`（執行後自動移除） |
| 30 項套件耗時 | 2 分 51 秒 |
| 18 項套件耗時 | 1 分 30 秒 |

## 附錄 B：關鍵數字

| 指標 | 值 |
|---|---|
| 本輪獨立執行測試總數 | **48** |
| PASS | **48** |
| FAIL | **0** |
| 覆蓋故障類別 | 14（任務 B 全數） |
| 正式環境副作用 | **0** |
| 已追蹤檔案修改 | **0** |

---

*報告結束。依指令停止，等待架構師審核。未自行進入正式維護窗口。*
