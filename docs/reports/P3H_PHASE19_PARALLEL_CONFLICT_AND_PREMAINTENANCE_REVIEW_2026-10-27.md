# P3-H 第十九階段｜並行設計衝突消除與正式維護前最終安全審查

- 審查日期：2026-10-27（11:56–12:05 本地時間）
- 審查角色：外部審查者（本 session）
- 專案：`D:\FDE-AI-UAS-v2.0-p3h-local-backend`
- 分支：`codex/p3h-local-backend`
- HEAD：`2fd4f2421dc18df761db80e74e6c4f134448feaf`（**未變**）
- 正式啟動器：`D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1`
  SHA-256 `a64330ef7a31e6c981fba95117466610af5e5db833d1ddafc8d91dba1c7a7b59`（**完整值比對相符，未變**）
- 本輪性質：**只讀審查**。未執行任何正式操作。

---

## 0. 摘要

| 項目 | 判定 |
|---|---|
| 基線完整性（HEAD／正式啟動器 SHA） | **PASS** |
| 並行寫入是否仍在發生 | **FAIL（持續中）** — 本輪審查期間新增 2 檔、修改 1 檔 |
| 並行寫入者身分識別 | **PASS**（識別到 sandbox 會話層級）／**UNKNOWN**（無法識別具體任務意圖） |
| 兩套 R-1 設計可否整合 | **PASS**（介面簽名與語法皆相容，v3 已整合） |
| 8022 五分鐘誤殺循環 | **PASS（已證實持續發生，4 個連續週期）** |
| Tunnel 兩處 `Stop-Process` 風險 | **PASS（靜態分析完成）**／修復 **NOT TESTED** |
| 方案 A（受控停機切換） | 可申請授權（前置三項已核實） |
| 方案 B（不中斷收養） | **BLOCKED**（正式環境 `CommandLine` 可讀性未實證） |
| 正式服務切換 | **NOT EXECUTED**（依指令禁止） |

**一句話結論**：8022 的五分鐘自傷循環在本次審查期間**仍在持續發生**（4 個週期全部誤殺），根因與第十八階段判定一致；並行寫入者未停止活動但**未修改本 session 的四個檔案**；兩套設計在 v3 中已乾淨整合，唯一未解的是「提升權限下 `CommandLine` 是否可讀」這一項，它決定方案 B 能否脫離 BLOCKED。

---

## 1. 基線與環境重核（PASS）

### 1.1 Git

| 檢查 | 結果 |
|---|---|
| 分支 | `codex/p3h-local-backend` |
| HEAD | `2fd4f2421dc18df761db80e74e6c4f134448feaf`（與第十八階段一致） |
| 已追蹤檔案修改 | 0 |
| 未追蹤項目 | 13（第十八階段為 11，+2 為兩份 Phase 18 報告） |
| stash | 1 |

`ops/p3h/v15c-launcher/` 整個目錄為未追蹤，所有本階段產物皆不影響 Git 基線。

### 1.2 正式啟動器

`D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1`
- 大小 15,766 B
- 建立 `2026-09-22T19:00:37`，修改 `2026-10-11T12:48:53`
- SHA-256 `a64330ef7a31e6c981fba95117466610af5e5db833d1ddafc8d91dba1c7a7b59` → **與第十八階段基線完整值逐字元相符**

### 1.3 埠與排程（只讀）

| 對象 | 狀態 |
|---|---|
| 8022 | LISTENING，listener PID 隨每個 5 分鐘週期變動（見 §4） |
| 8770 | 未在本次取樣中單獨查詢（不在本輪授權範圍的變更對象內） |
| 8030 | 未變更 |
| 排程 `FDE-AI v1.5C Classroom Server` | Ready，`LastRun=11:56:54`，`Result=0`，`NextRun=12:01:53`，`Missed=0` |
| 排程 `FDE-AI v1.5B Classroom Server` | **Disabled**（不會執行，`Missed=9989` 為停用期間累積，無影響） |

**排程定義（決定性證據）**：

```
TaskName : \FDE-AI v1.5C Classroom Server
RunLevel : Highest          <-- 提升權限執行
UserId   : admin
LogonType: Interactive
Action   : powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass
           -File "D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1"
Trigger  : MSFT_TaskLogonTrigger
Trigger  : MSFT_TaskTimeTrigger start=2026-09-23T21:36:53+08:00 repeat=PT5M
```

`RunLevel=Highest` 是本輪新取得的關鍵事實，直接影響 §3.2 維度 6 與 §6.2 方案 B 的判定。

---

## 2. 任務 A｜並行設計調查

### 2.1 檔案清單、時間戳與完整 SHA-256

全部位於 `ops/p3h/v15c-launcher/`，全部為 Git 未追蹤。

| 檔案 | 建立 | 修改 | 大小 | SHA-256（完整） |
|---|---|---|---|---|
| `V15C-Adoption.ps1` | 11:07:24 | **11:56:59** | 22,949 | `48cb7c34732d1eb8c40611e3cf741c3b717784665ab7fde8dde8c544d66b81b1` |
| `fake_project.py` | 11:07:36 | **11:58:47** | 2,069 | `edeb68370953b94834c073340e21437983cd017132902006cdc4759ae6ac5b8c` |
| `start_fde_v15c_classroom.patched-v2.ps1` | 11:08:24 | 11:08:24 | 18,771 | `19124aed6aa659a515e64f43e2bfc25e102e92d0241819944be381314c13268c` |
| `PATCH-v2.diff` | 11:08:25 | 11:08:25 | 5,494 | `1e8e4900e08d62b427508c243abd0eb5c6c34335ca89dbb78e36af4f950f1c1d` |
| `Test-V15CPhase18Adoption.ps1` | 11:09:35 | 11:09:35 | 29,472 | `ad540262e35c5fe2e3eff37690f227b4984774d9124c6155119976fa13ace47a` |
| **`start_fde_v15c_classroom.patched-v3.ps1`** | **11:58:40** | 11:58:40 | 19,736 | `a95a857b11de2ca13483d0e50ae23c2c064b654994a51f7accfb56d0280d762b` |
| **`PATCH-v3.diff`** | **11:58:41** | 11:58:41 | 6,472 | `c24d3854f5e082bf52f05b8cc319079b97c6eb3d7302e2aff95fcb6a2383ef79` |

**本 session（第十八階段）四個檔案，SHA 全部未變**：

| 檔案 | 大小 | SHA-256（完整） | 狀態 |
|---|---|---|---|
| `V15C-Ownership.ps1` | 19,902 | `adf7f8ecd6bcdaf3d5bd013569c9c6231f0e7f16bf64675a83b0042391b03ec8` | 未變 |
| `start_fde_v15c_classroom.patched.ps1` | 17,846 | `5d1fc53dd32a064068ac87d3a03069493f3723e1926c88ff8b346f11bc4e74e9` | 未變 |
| `Test-V15CLauncherOwnership.ps1` | 40,813 | `3157570af27511413eb4a4273583717ba38b66a62b4c6cd81c661375b73cd031` | 未變 |
| `PATCH.diff` | 4,557 | `d43c37ab7d5fc7ffd8fe845b3dba559aaf2651ca16e8624b0f660f7a2e17a9c6` | 未變（修改時間 11:33:05） |

**第二波並行寫入（本輪審查期間偵測）**：`fake_project.py` 於 11:58:47 由 2,039 B 改為 2,069 B；11:58:40–11:58:41 新增 `patched-v3.ps1` 與 `PATCH-v3.diff`。

### 2.2 Git 狀態

全部未追蹤（`ops/p3h/v15c-launcher/` 未納入版控）。無 `git add` 痕跡，未污染任何已追蹤檔案。

### 2.3 與現行 R-1 設計的差異

| 面向 | 現行 R-1（`V15C-Ownership.ps1`，設計甲） | 並行方案（`V15C-Adoption.ps1`，設計乙） |
|---|---|---|
| 核心目的 | 判定 OWNED／FOREIGN／UNKNOWN，**三態皆不終止** | 在 UNKNOWN 且「僅缺狀態檔」時，用 8 項證據**收養**既有 listener |
| 訊號數 | S1–S7（7 項） | E1–E8（8 項） |
| 專案身分 | S7：命令列中的 `manage.py` 絕對路徑根比對（缺席為中性） | E4b：`manage.py` SHA-256 兩側相等 ＋ E4c：HTTP 指紋三標記 |
| venv 拓撲 | S4：自身或祖系深度 1–3 為 shim | E5：`self` / `ancestor` 雙模式 ＋ `pyvenv.cfg` 的 `home` 比對 |
| 狀態檔寫入 | `Write-V15CStateRecord`（mutex + tmp + `File.Replace` + 回讀） | **不自行寫入**，委派 `Write-V15CStateRecord` |
| 併發啟動 | 無（依賴 launcher 的 instance mutex） | E8：掃描 powershell/pwsh ＋ mutex 可取得性 |
| PID 漂移 | 單次判定 | E6：證據收集後**重驗 listener PID** |
| 決策 | 直接回傳 Verdict | 另加 `Resolve-V15CListenerAction` 純函式（REUSE／ADOPT／ABORT） |
| 對正式腳本的改動 | 取代 STOPPING 區塊 ＋ 原子寫入狀態檔 | 同上，再加 adoption 閘門與 dot-source 兩個模組 |

**互補關係確認**：乙在檔頭自述「There is exactly ONE state-file writer in this code base: `Write-V15CStateRecord`」，並在載入時 `throw` 若該函式不存在（第 26–28 行）。這表示乙**主動接受甲為基底**，兩者非競爭而是分層。

### 2.4 是否存在執行中的相關測試程序

**是。** 審查期間觀察到：

```
PID 24724  powershell.exe  created 11:59:26
  "C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile
   -ExecutionPolicy Bypass -File
   D:\FDE-AI-UAS-v2.0-p3h-local-backend\ops\p3h\v15c-launcher\Test-V15CLauncherOwnership.ps1
  └─ PID 29492 python  fake_manage.py runserver 127.0.0.1:18022 --noreload
     └─ PID 23344 python (uv cpython-3.12) 同上
  └─ PID 25920 python  -m http.server 18023 --bind 127.0.0.1
     └─ PID 21164 python (uv cpython-3.12)
  └─ PID 8628  python  -m http.server 18024 --bind 127.0.0.1
```

即：**並行會話正在執行本 session 於第十八階段撰寫的 `Test-V15CLauncherOwnership.ps1`**（30 項契約測試），使用隔離埠 18022–18024，未觸碰 8022。

### 2.5 寫入來源識別

| 證據 | 內容 |
|---|---|
| PID 15516 | `sandbox-cli.exe`，建立 11:54:05，`ipcAddress = WorkBuddy_a45f90fbde8da2fb` |
| PID 8772 | `sandbox-cli.exe`，建立 2026-10-26 19:36:42，`ipcAddress = WorkBuddy_26875c64000f8f68`（**本 session**） |
| 兩者 `--uid` | 同為 `dec7076e-76a4-43aa-8453-2576111dbd76`（同一 Windows 使用者） |
| 程式碼包裝 | PID 7396（15516 之子）使用與本 session 完全相同的 `CODEBUDDY_SAFE_DELETE_PS_READY` 包裝模板 |

**結論**：寫入者為**同一使用者的另一個 WorkBuddy 會話**（sandbox 15516），非外部入侵、非惡意程式。其行為模式（建立 Adoption 模組 → 產出 v2 → 修改 → 產出 v3 → 執行本 session 的測試套件）與「另一名 agent 平行處理同一任務」一致。

**但**：無法讀取該會話的對話內容與任務指令，因此**「其授權範圍與指令內容」標記 UNKNOWN**。也無法確認它是否會在未來修改本 session 的檔案（本輪觀察為「未修改」）。

**附帶發現（無關但需記錄）**：`codex.exe`（PID 3484）以 `pwsh`（PID 26512，10:53:33）啟動了 `cloudflared tunnel --url http://localhost:8000`。目標埠為 **8000**，非 8022，**不會**被正式啟動器第 240–241 行的 `127\.0\.0\.1:8022` 條件命中，無誤殺風險；但它是系統上第二個 cloudflared 實例，說明「多實例並存」在真實環境中確實會發生。

### 2.6 任務 A 判定

| 子項 | 判定 |
|---|---|
| 1. 建立時間 | PASS |
| 2. 修改時間 | PASS |
| 3. 完整 SHA-256 | PASS（10 檔全部取得完整值） |
| 4. Git 狀態 | PASS（全未追蹤） |
| 5. 與現行 R-1 差異 | PASS（見 §2.3 與 §3.2） |
| 6. 執行中測試程序 | PASS（已定位 PID 24724 及其子程序樹） |
| 7. 寫入來源證據 | **PASS（會話層級）／UNKNOWN（任務意圖層級）** |

**未對上述任何檔案執行移動、刪除、覆蓋或執行**（`Test-V15CLauncherOwnership.ps1` 的執行者是並行會話，非本 session）。

---

## 3. 任務 B｜兩套 R-1 設計 15 維度比較

### 3.1 界定

- **設計甲**：`V15C-Ownership.ps1` + `start_fde_v15c_classroom.patched.ps1` + `Test-V15CLauncherOwnership.ps1`（第十八階段，30/30 PASS）
- **設計乙**：`V15C-Adoption.ps1` + `start_fde_v15c_classroom.patched-v2.ps1` + `Test-V15CPhase18Adoption.ps1`（並行會話，25 項，未取得執行結果）
- **整合產物**：`patched-v3.ps1`（甲 + 乙，尚未測試）

### 3.2 15 維度矩陣

| # | 維度 | 設計甲行為 | 設計乙行為 | 證據 | 風險 | 建議保留 |
|---|---|---|---|---|---|---|
| 1 | OWNED 判定 | `interpreterOwned && stateMatch && healthOk` | 同甲（乙不重新定義 OWNED，直接沿用甲） | 甲 §判定樹；乙第 23–28 行強制依賴 | 無 | **甲** |
| 2 | FOREIGN 判定 | S3 可讀且明確不符，或 S7 根不符 | 無獨立 FOREIGN 判定（沿用甲） | 乙第 462–501 行只處理 OWNED 以外 | 乙單獨使用時無 FOREIGN 能力 → 必須與甲共存 | **甲** |
| 3 | UNKNOWN 判定 | 其餘一律 UNKNOWN，**不終止** | `ADOPTABLE` 需 E1–E8 全通過，否則 UNKNOWN | 乙第 445–446 行 | 乙的 UNKNOWN 會導致 ABORT（不殺） | **兩者一致** |
| 4 | PID 重用防護 | S5：狀態檔 `created_at` 與程序 `CreationDate` 差 < 2 秒 | E2 + E6：證據收集後重驗 listener PID | 乙第 428–432 行 | 甲較強（有時間戳綁定）；乙的 E6 只防「收集期間漂移」 | **甲**（S5）＋**乙**（E6 重驗） |
| 5 | CreationDate 驗證 | S2：必須可讀，否則 UNKNOWN | E2：必須可讀；`Invoke-V15CAdoptionClaim` 另驗一次，不可得則 `creation_time_unavailable` | 乙第 523–529 行 | 兩者一致 | **兩者一致** |
| 6 | CommandLine 驗證 | S3：須符合 `manage\.py\s+runserver` ＋ `127\.0\.0\.1:<port>` | E3：同一正則；不可讀 → `E3_commandline_unreadable` → UNKNOWN | 乙第 340–349 行 | **此為方案 B 的單點依賴**（見 §3.4） | **兩者一致** |
| 7 | V15Root 驗證 | S7：從命令列抽 `manage.py` 絕對路徑比對根目錄；**缺席為中性**（因正式 launcher 用裸 `manage.py`） | E4b：`manage.py` SHA-256 兩側相等（不依賴命令列） | 甲 S7；乙第 93–139 行 | 乙較強（不依賴命令列），但需讀 `pyvenv.cfg` 與專案根 `manage.py` | **乙**（E4b）＋**甲**（S7 作為命令列可讀時的加分項） |
| 8 | shim／子程序身分 | S4：自身或祖系深度 1–3 為 shim | E5：`self` / `ancestor` 雙模式；ancestor 模式另需 `pyvenv.cfg` 的 `home` == 觀察到的 interpreter | 乙第 351–387 行 | 乙更嚴格（ancestor 模式多一道 pyvenv 驗證），但也更容易誤判 UNKNOWN | **乙** |
| 9 | listener 所有權 | S1：`Get-V15CListenerPid` 單次 | E1 ＋ E6：前後各一次 | 乙第 316–320、428–432 行 | 乙較強 | **乙**（E6） |
| 10 | 健康檢查 | S6：`/login/` 2xx/3xx 且含 `FDE-AI` | E7：2xx/3xx；E4c：三個標記（`FDE-AI`、`csrfmiddlewaretoken`、`resend-verification`）**同一次回應**取得 | 乙第 141–184、405 行 | 乙較強（指紋與狀態同源）；但標記若改版會全數失效 | **乙**（但標記清單需可配置） |
| 11 | 狀態檔原子寫入 | mutex + `*.tmp.<guid>` + `Flush($true)` + `File.Replace` + 回讀驗證 + 40×15ms 重試 | 不自行寫入，**委派**甲 | 乙第 531 行 | 無（乙正確地不重複實作） | **甲**（唯一寫入者） |
| 12 | 併發啟動 | 無（依賴 launcher 第 42 行 instance mutex） | E8：掃描 powershell/pwsh 命令列 ＋ mutex 可取得性 | 乙第 201–270 行 | 乙補上甲的空缺 | **乙** |
| 13 | 損壞狀態檔 | `Read-V15CStateRecord` 3 次重試；損壞 → `existing_state_corrupt`，**拒絕覆寫** | 沿用甲；乙的 `Resolve-V15CListenerAction` 只在 `state_record_absent` 時考慮收養 | 乙第 483–494 行 | 兩者一致，設計正確 | **兩者一致** |
| 14 | 排程重複觸發 | 依賴 instance mutex（第 42–46 行，取不到即 `SKIP duplicate`） | E8 額外掃描命令列 | 乙第 217–226 行 | E8 掃描可能誤判（例如本 session 的測試 harness 命令列含 `start_fde_v15c_classroom.ps1` 字串時） | **甲**（mutex）＋**乙**（掃描作輔助，衝突時應只降級不中止） |
| 15 | 回滾複雜度 | 單檔還原 `patched.ps1` → `original.ps1`；模組檔可留可刪 | 需同時還原 `patched-v3.ps1` ＋ 移除 `V15C-Adoption.ps1`（否則 dot-source 失敗會 throw） | 乙第 19–21 行 `throw` 若模組不存在 | 乙的回滾多一個檔案依賴 | **甲**（回滾面較小） |

### 3.3 整合產物 v3 的評估

`PATCH-v3.diff` 三個 hunk 已把甲與乙串起：

1. **hunk 1**：新增 `$DjangoPidStateFile`、`$EnableAdoption = $true`，並 dot-source `V15C-Ownership.ps1` 與 `V15C-Adoption.ps1`（找不到即 `throw`）。
2. **hunk 2**：把原版第 185–192 行的「`ownerPath -ne $expectedDjangoExe` → `Stop-Process`」整段替換為：
   `Test-IsV15CDjango` → （若 `state_record_absent`）`Test-V15CAdoptionEligible` → `Resolve-V15CListenerAction` → `REUSE` / `ADOPT` / `ABORT`，**三態皆不 `Stop-Process`**。
3. **hunk 3**：Django 啟動後以 `Write-V15CStateRecord` 原子寫入狀態檔；被拒只記錄不中斷。

**介面簽名核對（PASS）**：

| v3 呼叫 | 模組實際簽名 | 結果 |
|---|---|---|
| `Test-IsV15CDjango -ListenerPid -Port -V15Root -DjangoPython -StateFile -HealthUrl -HealthMarker` | `V15C-Ownership.ps1:81-87` 完全一致（`-HealthMarker` 為單數） | 相符 |
| `Write-V15CStateRecord -StateFile -ProcessId -Port -V15Root -CreatedAtUtc` | `V15C-Ownership.ps1:301-310` 一致（`-ProcessId`，非 `-Pid`） | 相符 |
| `Test-V15CAdoptionEligible -ListenerPid -Port -V15Root -DjangoPython -HealthUrl -HealthMarkers -MutexName -CurrentPid` | `V15C-Adoption.ps1:290-307` 一致 | 相符 |
| `Resolve-V15CListenerAction -Verdict -Reasons -Adoption -AdoptionEnabled` | `V15C-Adoption.ps1:472-477` 一致 | 相符 |
| `Invoke-V15CAdoptionClaim -Adoption -StateFile -Port -V15Root` | `V15C-Adoption.ps1:511-517` 一致 | 相符 |

**語法與編碼核對（PASS）**：

```
start_fde_v15c_classroom.patched-v3.ps1 : BOM=False nonAsciiBytes=0 parseErrors=0
V15C-Adoption.ps1                        : BOM=False nonAsciiBytes=0 parseErrors=0
```

符合 PowerShell 5.1 對 `.ps1` 的 ASCII-only／無 BOM 硬約束。

**部署前置條件（必須寫入維護計畫）**：v3 以 `$GatewayRoot`（`D:\FDE-AI-Gateway`）為模組搜尋根，但兩個模組目前位於 `ops/p3h/v15c-launcher/`。部署時必須把 `V15C-Ownership.ps1` 與 `V15C-Adoption.ps1` **複製到 `D:\FDE-AI-Gateway\`**，否則 hunk 1 會 `throw`。

**v3 的測試狀態：NOT TESTED。** 並行會話在 11:59:26 執行的是甲的 `Test-V15CLauncherOwnership.ps1`，不是 v3。v3 自 11:58:40 產生後**尚未有任何測試結果**。

### 3.4 唯一實質分歧：`CommandLine` 可讀性

| 事實 | 來源 |
|---|---|
| 8022 現任 listener（PID 26916）的 `CommandLine` 在本審查環境**不可讀**（`CmdLen=0`） | 本輪實測 |
| 其祖程序鏈：26916 ← 25236（venv shim）← 23824（powershell，12:01:54 = 排程 launcher） | 本輪實測 |
| 排程 `RunLevel=Highest` → launcher 與其子程序皆為**提升權限** | `Get-ScheduledTask` |
| 同機可讀的對照組：PID 29492（並行會話的測試 Django）`CommandLine` **完整可讀** | 本輪實測 |

**推論**：不可讀的原因是**權限不對等**（本審查環境為非提升，listener 為提升），而非 WMI 本身不提供。因此提升權限的 launcher 讀自己啟動的提升 listener，**理論上可讀**。

**但這是推論，不是實測。** 因此：
- E3／S3 在正式環境是否成立 → **UNKNOWN**
- 方案 B（收養）能否通過閘門 → **BLOCKED**
- 方案 A **不受此項影響**（見 §6.1 的理由）

---

## 4. 任務 C｜8022 五分鐘誤殺循環：四個連續週期實證

### 4.1 排程與日誌來源

- 排程：`FDE-AI v1.5C Classroom Server`，`repeat=PT5M`，`RunLevel=Highest`
- 日誌：`C:\Users\admin\AppData\Local\FDE-AI\classroom\startup.log`（3,789,262 B，29,715 行）
- 取樣方式：單次讀取尾端，**未主動觸發排程、未停止或重啟 8022、未高頻輪詢**

### 4.2 四週期時序

| 週期 | launcher 起始 | `STOPPING stale 8022 listener` | 被殺 PID | `NETWORK READY` | `REUSE tunnel` | `ONLINE`（worker origin 更新完成） |
|---|---|---|---|---|---|---|
| 1 | 11:46:55 | **11:46:58** | 13944 | 11:47:05 | 11:47:06 | 11:48:35 |
| 2 | 11:52:09 | **11:52:16** | 29300 | 11:52:22 | 11:52:23 | 11:53:14 |
| 3 | 11:57:04 | **11:57:07** | 28740 | 11:57:25 | 11:57:28 | 11:58:30 |
| 4 | 12:01:57 | **12:02:00** | 13280 | 12:02:09 | 12:02:11 | 未記錄（審查結束） |

每次記錄的 `executable` 皆為：

```
C:\Users\admin\.fde-ai\YoloRuntime\python\cpython-3.12.13-windows-x86_64-none\python.exe
```

即 **base interpreter**，而非 venv shim。

### 4.3 建立時間與 PID 對照（可確認部分）

| 週期 | 被殺 PID | 建立時間 | 新 listener PID | 新建立時間 | 證據 |
|---|---|---|---|---|---|
| 3 → 4 | 28740 | 不可得（已終止） | **13280** | **11:57:10** | 11:59 實測 `Get-NetTCPConnection` 持有 8022；`CreationDate` 可讀 |
| 4 | **13280** | 11:57:10 | **26916** | **12:02:03** | 12:02 實測；祖鏈 26916 ← 25236 ← 23824（12:01:54） |

**閉環驗證**：本 session 於 11:59 觀察到「13280 持有 8022」，12:02:00 的日誌記錄「`STOPPING stale 8022 listener: PID=13280`」——**同一 PID 在 3 分鐘後被同一個 launcher 殺掉**。這排除了「日誌與現實不符」的可能，確認循環正在發生。

`STOPPING` 之後新 listener 的祖程序鏈（12:02 實測）：

```
PID 23824 powershell.exe  12:01:54   <- 排程觸發的 launcher（Highest）
  └ PID 25236 python.exe  12:02:03   <- .venv\Scripts\python.exe（shim / trampoline）
      └ PID 26916 python.exe 12:02:03 <- base interpreter，持有 127.0.0.1:8022
```

這正是「shim 與 base interpreter 分離」的實物證據，也是原版判定必然失敗的機制。

### 4.4 中斷區間與可用率

| 週期 | 本機 8022 不可用（`STOPPING` → `REUSE tunnel`，此後 `Wait-Http` 已通過） | 對外固定 URL 不可用（`STOPPING` → `ONLINE`） |
|---|---|---|
| 1 | 8 s | 97 s |
| 2 | 7 s | 58 s |
| 3 | 21 s | 83 s |
| 4 | 11 s | — |
| 平均 | **11.75 s** | **79.3 s**（3 樣本） |

以 300 秒週期計：

- 本機 8022 可用率 ≈ **96.1 %**
- 對外固定 URL 可用率 ≈ **73.6 %**

對外數字包含 `wrangler secret put ORIGIN_URL` 與 Worker 生效延遲，實際使用者感知可能更差。**此處不推測 DNS/CDN 傳播時間，只報可量測邊界。**

### 4.5 根因鏈（與第十八階段一致，本輪補強）

1. 原版第 185–192 行以 `$ownerPath -ne $expectedDjangoExe` 判定「stale」。
2. `$expectedDjangoExe` = `DjangoPython`（venv shim 路徑）。
3. 實際 listener = base interpreter（`YoloRuntime\...\python.exe`）。
4. 兩者**結構上永不相等** → 每 5 分鐘必殺。
5. 原版**沒有** PID 狀態檔機制：`StateRoot` 目錄實測僅有
   `current-tunnel-url.txt`、`startup-error.log`、`startup.log`、`supervisor.log`、`tunnel-state.json`
   ——**不存在 `django-v15c-pid.json`**。這確認了「狀態檔缺席」是正式環境的既有事實，也確認方案 B 首次部署時必然走 `state_record_absent` 分支。

### 4.6 任務 C 判定

| 子項 | 判定 |
|---|---|
| 觸發時間（≥3 週期） | PASS（4 週期） |
| 舊／新 PID | PASS（週期 3→4、4 完整；1、2 的新 PID 已被後續週期殺掉，不可得） |
| 建立時間 | PASS（13280=11:57:10、26916=12:02:03；更早者不可得） |
| `STOPPING stale` 記錄 | PASS（4/4 週期皆有） |
| 健康檢查 | PASS（4/4 週期 `django=PASS`、`rag=PASS`） |
| 中斷區間 | PASS（本機與對外兩種口徑） |

未主動觸發排程、未停止或重啟 8022、未高頻輪詢。

---

## 5. 任務 D｜Tunnel 8 點最小安全修復設計

**範圍聲明**：本節僅為設計。**未修改 `D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1`，未操作任何 cloudflared 程序。**

行號以權威原始檔（SHA `a64330ef…`）為準。第十八階段指令所述「第 260、282 行」是**修補版**行號；原始檔對應為 **246** 與 **268**（Django 的 `Stop-Process` 在 192，已被 patched 移除）。

### D1. PID 來源

| 位置 | PID 來源 | 是否可能過期 |
|---|---|---|
| 第 246 行 | 第 240–241 行 `Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'"` ＋ `CommandLine -match "127\.0\.0\.1:$DjangoPort"`，`Select-Object -First 1` | **可能，最長 30 秒** |
| 第 268 行 | 第 250 行 `Start-Process ... -PassThru` 的 `$startedTunnel.Id` | 可能，最長 60 秒（第 253 行迴圈上限） |

### D2. 過期窗口的具體成因

- 第 242 行 `if ($existingTunnel -and $state.last_successful_tunnel -and (Wait-Http "$($state.last_successful_tunnel)/login/" 30))`
  `Wait-Http` 位於快照（240）與終止（246）**之間**，最長 30 秒。若該 `Wait-Http` 逾時返回假，流程進入 `else`，用**30 秒前的 PID** 執行 `Stop-Process -Force`。
- 第 253–266 行迴圈最多 60 秒（每輪 `Start-Sleep 1` ＋ `Wait-TunnelReady 90` 內含等待），第 268 行用迴圈開始前的 `$startedTunnel.Id` 終止。

### D3. 是否驗證建立時間／命令列

**兩處都沒有。** 第 246 行僅在快照時匹配過命令列，終止前不重驗；第 268 行完全不驗證。

### D4. 跨專案誤殺風險

| 位置 | 風險 | 實例 |
|---|---|---|
| 第 246 行 | **中**。任何 `cloudflared.exe` 其命令列含 `127.0.0.1:8022` 都會被納入，包含其他專案或使用者手動啟動者；`-First 1` 使多實例時只處理一個 | 本機現有 `cloudflared --url http://localhost:8000`（PID 26512 之子）指向 **8000**，不匹配，**不會**被殺 |
| 第 268 行 | **極低**。為本進程自行啟動 | — |

### D5. 是否需獨立修復階段

**是。** 理由：
1. 兩處皆缺「終止前重驗」，屬 TOCTOU。
2. `Write-TunnelState`（第 173–175 行）以 `Set-Content` **非原子**寫入 `tunnel-state.json`；中斷會留下空檔或半截 JSON。
3. `Read-TunnelState`（第 168–171 行）讀取失敗時**靜默 fail-open**，回 `failure_count=0` 的空物件 → `rate_limit_until` 保護失效，且 `last_successful_tunnel` 遺失 → 第 242 行 REUSE 條件不成立 → 重建 tunnel → trycloudflare 隨機域名變更 → Worker origin 需重推 → 對外中斷擴大。
4. 目前 REUSE 路徑 4/4 成功，第 246 行在常態下**不會執行**；因此修復不具時效急迫性，但一旦 tunnel 健康檢查抖動就會觸發，屬「低頻高影響」。

### D6. 八點最小安全修復設計

1. **改為 handle-based 終止**：用 `Get-Process -Id $id` 取得 `Process` 物件，先 `if (-not $p.HasExited) { $p.Kill() }`，避免以裸 PID 重新解析。
2. **終止前重驗命令列**：對 `$p` 重取 `CommandLine`，仍須匹配 `127\.0\.0\.1:8022`，否則記錄 `TUNNEL KILL ABORTED reason=commandline_changed` 並跳過。
3. **終止前重驗建立時間**：快照時保存 `CreationDate`，終止前比對；不一致即視為 PID 重用，跳過。
4. **縮小 TOCTOU 窗口**：把 `Wait-Http` 從第 242 行的 `if` 條件中移出，改為先判定、後取 PID、立即終止（順序：`Wait-Http` → 重新 `Get-CimInstance` → 驗證 → 終止）。
5. **第 268 行改為「只殺自己且仍存活」**：`$startedTunnel` 保留 `Process` 物件；終止前 `Refresh()` 並比對 `CreationDate` 與啟動時記錄值。
6. **`Write-TunnelState` 改為原子寫入**：沿用 `Write-V15CStateRecord` 的同構手法（同目錄 `*.tmp.<guid>` → `Flush($true)` → `File.Replace` → 回讀驗證），**不降級為先刪再移**。
7. **`Read-TunnelState` 改為 fail-closed**：解析失敗時回 `$null` 並在呼叫端區分「檔案不存在（首次）」與「檔案損壞（拒絕啟動 tunnel 重建，記錄並要求人工介入）」，避免靜默丟失 `rate_limit_until`。
8. **加單一 tunnel 所有者標記**：在 `tunnel-state.json` 增加 `pid`、`created_at`、`port` 三欄（純新增，向後相容），使下一次啟動能驗證「這個 cloudflared 是不是我上次啟動的那一個」，取代目前的「命令列含 8022 即認定」。

### D7. 任務 D 判定

| 子項 | 判定 |
|---|---|
| PID 來源可追溯 | PASS（靜態） |
| 過期風險量化 | PASS（30 s／60 s） |
| 建立時間／命令列驗證缺失 | **FAIL（已證實缺失）** |
| 跨專案誤殺風險評估 | PASS |
| 是否需獨立階段 | PASS（結論：需要） |
| 修復設計完成 | PASS（8 點） |
| 修復是否實作或測試 | **NOT TESTED**（本輪禁止修改 Tunnel 檔案） |

---

## 6. 任務 E｜維護窗口最終預案

**兩案皆未執行。本節僅為計畫。**

### 6.1 方案 A｜受控短暫停機切換

| # | 項目 | 內容 |
|---|---|---|
| A1 | **前置檢查** | ① `HEAD == 2fd4f24…`；② 正式啟動器 SHA == `a64330ef…`（完整值）；③ 排程 `v1.5C` 為 Ready、`v1.5B` 為 Disabled；④ `django-v15c-pid.json` 不存在（已確認）；⑤ 8022 現任 listener 的祖鏈可解析到當次 launcher；⑥ `V15C-Ownership.ps1`／`V15C-Adoption.ps1` 已複製到 `D:\FDE-AI-Gateway\` 且 SHA 與本報告一致 |
| A2 | **維護人員權限** | 必須是 **提升權限** 的 PowerShell（因排程為 `RunLevel=Highest`；非提升無法停止 8022 listener、無法讀取其 `CommandLine`） |
| A3 | **停機風險** | 一次完整重啟。預估本機 8022 中斷 10–30 s、對外固定 URL 中斷 60–100 s（依 §4.4 實測區間）。**接受此代價以換取可預測與可回滾** |
| A4 | **操作順序** | 1. `Disable-ScheduledTask -TaskName 'FDE-AI v1.5C Classroom Server'`<br>2. 記錄當前 listener PID 與 `CreationDate`<br>3. `Stop-Process -Id <PID>`（僅此一個，提升權限）<br>4. `Wait-PortFree 8022`（上限 30 s）<br>5. 備份 `start_fde_v15c_classroom.ps1` 為 `.bak-20261027`<br>6. 以 v3 覆蓋（或改名切換）<br>7. **手動**執行一次 launcher，觀察 `startup.log`<br>8. 確認 `PID STATE WRITTEN` 與 `django-v15c-pid.json` 生成<br>9. `Enable-ScheduledTask` |
| A5 | **失敗停止條件** | 任一成立即停止並回滾：① 第 4 步 30 s 內埠未釋放；② 手動執行後 60 s 內無 `PID STATE WRITTEN`；③ 日誌出現 `ABORT`／`throw`；④ `django-v15c-pid.json` 內容與實際 listener PID 不符；⑤ 8022 在 60 s 內未通過 `Wait-Http` |
| A6 | **回滾步驟** | 1. `Disable-ScheduledTask`；2. 還原 `.bak-20261027` 為正式檔名；3. 刪除 `django-v15c-pid.json`（避免殘留狀態影響原版）；4. 手動執行一次原版 launcher 確認 8022 起來；5. `Enable-ScheduledTask` |
| A7 | **回滾後排程狀態** | 排程回到 `Ready`、`repeat=PT5M`、`RunLevel=Highest` 不變；下一個週期會恢復原本的「每 5 分鐘誤殺」行為——**這是已知的既有缺陷，回滾不代表修好，只代表回到原狀** |
| A8 | **五分鐘誤殺循環防復發驗收** | 連續觀察 **3 個週期**（15 分鐘），要求：① 3 個週期皆無 `STOPPING stale 8022 listener`；② listener PID 在 15 分鐘內**不變**；③ 3 個週期皆記錄 `8022 OWNED`（或至少不是 ABORT）；④ `django-v15c-pid.json` 的 `pid` 與 `created_at` 與實際程序一致 |

**方案 A 的關鍵優勢（本輪新增論證）**：A4 的第 3–7 步使 8022 在 launcher 執行時是**空的**，因此 `Get-Listener` 回空 → 直接啟動新 Django → **完全不進入 R-1 判定**。這意味著**方案 A 的成功不依賴 `CommandLine` 可讀性**，繞過了 §3.4 的未知數。只有在第 8 步之後的後續週期，R-1 才會第一次真正發揮作用。

### 6.2 方案 B｜不中斷所有權收養

| # | 項目 | 內容 |
|---|---|---|
| B1 | **前置檢查** | ①–⑤ 同 A1；⑥ **額外要求**：以提升權限對現任 listener 執行一次只讀 `Get-CimInstance Win32_Process` 並確認 `CommandLine` **非空且匹配** `manage\.py\s+runserver` ＋ `127\.0\.0\.1:8022`；⑦ 對 `pyvenv.cfg` 的 `home` 與實際 base interpreter 路徑做一次比對（E4a／E5 ancestor 模式的前提） |
| B2 | **維護人員權限** | 提升權限（同 A2） |
| B3 | **停機風險** | 理想為 0。**但**若收養閘門判定 UNKNOWN／`ADOPTION CLAIM FAILED`，launcher 會 `throw` 中止——此時 Django **仍在執行**（三態皆不終止），服務不中斷，但 RAG 啟動、tunnel 維護、Worker origin 更新都不會執行 |
| B4 | **操作順序** | 1. `Disable-ScheduledTask`<br>2. 記錄 listener PID／`CreationDate`<br>3. 部署兩個模組到 `D:\FDE-AI-Gateway\`<br>4. 備份並切換為 v3<br>5. **手動**執行一次 launcher（**不停 8022**）<br>6. 觀察日誌是否出現 `8022 ADOPTED`<br>7. 確認 `django-v15c-pid.json` 生成且 `pid` == 現任 listener<br>8. `Enable-ScheduledTask` |
| B5 | **失敗停止條件** | ① 日誌出現 `8022 UNKNOWN` 或 `ADOPTION CLAIM FAILED`；② `django-v15c-pid.json` 未生成；③ 生成的 `pid` 與實際 listener 不符；④ 出現任何 `Stop-Process` 痕跡（**不應存在**） |
| B6 | **回滾步驟** | 1. `Disable-ScheduledTask`；2. 還原備份檔；3. 刪除 `django-v15c-pid.json`；4. **不需重啟 8022**（全程未停止）；5. `Enable-ScheduledTask` |
| B7 | **回滾後排程狀態** | 同 A7（回到每 5 分鐘誤殺的既有缺陷） |
| B8 | **五分鐘誤殺循環防復發驗收** | 同 A8，但第 ③ 項改為**必須**看到 `8022 OWNED`（收養後的後續週期應判 OWNED，而非每次重新 ADOPT） |

**方案 B 的 BLOCKED 條件仍然成立**：B1⑥ 要求的「提升權限下 `CommandLine` 可讀」**尚未實證**。本輪只能確認「非提升不可讀」（`CmdLen=0`），以及「排程為 `RunLevel=Highest`」（推論應可讀）。依第十九階段指令，**方案 B 維持 BLOCKED**，直到 B1⑥ 在維護窗口以提升權限完成一次只讀驗證。

### 6.3 推薦與理由

**推薦：先執行方案 A，把方案 B 作為 A 通過後的第二階段增強。**

理由（依「證據最充分、回滾路徑最明確」排序，不以零停機為目標）：

1. **方案 A 不依賴唯一未實證的假設。** 它讓 8022 在 launcher 執行時為空，完全繞過 `CommandLine` 可讀性問題（§6.1 末段）。方案 B 的成敗完全押在這一項上。
2. **方案 A 的回滾面最小。** 只需還原一個 `.ps1` 並刪除一個狀態檔；方案 B 還原時多一個模組檔依賴（若 `V15C-Adoption.ps1` 殘留而 `patched.ps1` 不含 dot-source，或反之，會出現 `throw` 不一致）。
3. **方案 A 的失敗模式是「起不來」，可立即察覺；方案 B 的失敗模式是「起來了但沒接管」，較隱蔽。** 前者在維護窗口內 60 秒內就能判定；後者要等 3 個週期（15 分鐘）才看得出 `ABORT` 是否重複發生。
4. **兩者回滾後都回到「每 5 分鐘誤殺」的原狀**，因此不存在「選錯就無法回頭」的風險，但 A 的回頭成本更低。
5. **建議的實施組合**：方案 A 的停機切換 ＋ v3 腳本（`$EnableAdoption = $true`）。這樣首次乾淨啟動會寫入狀態檔，後續週期判 OWNED；adoption 能力保留給「launcher 重啟但 Django 存活」的未來場景（例如機器重啟後排程先跑、Django 由其他途徑存活）。

**這與並行會話報告 §6.4 的「方案 B 優先、A 兜底」相反。** 分歧點在於：對方以「零停機」為主要優化目標，本審查以「不依賴未實證假設」為主要目標。此分歧**須由架構師裁決**。

---

## 7. 判定彙總

### 7.1 依證據類型區分

| 類別 | 項目 | 判定 |
|---|---|---|
| **靜態檢查** | 基線 HEAD／正式啟動器 SHA | PASS |
| 靜態檢查 | 排程定義（`RunLevel`、`repeat`、Trigger） | PASS |
| 靜態檢查 | 兩套設計 15 維度差異 | PASS |
| 靜態檢查 | v3 介面簽名與語法／編碼 | PASS（parseErrors=0、ASCII-only、無 BOM） |
| 靜態檢查 | Tunnel 兩處 `Stop-Process` 缺陷 | PASS（缺陷已證實存在） |
| **正式環境只讀** | 8022 誤殺循環（4 週期） | PASS（持續發生中） |
| 正式環境只讀 | listener 祖鏈（shim → base interpreter） | PASS |
| 正式環境只讀 | `django-v15c-pid.json` 不存在 | PASS |
| 正式環境只讀 | 並行寫入者身分（sandbox 層級） | PASS／意圖 UNKNOWN |
| 正式環境只讀 | 正式 listener `CommandLine` 可讀性 | **UNKNOWN**（非提升環境不可讀） |
| **隔離模擬** | 設計甲 30 項契約 | PASS（第十八階段，30/30） |
| 隔離模擬 | 設計乙 25 項契約 | **NOT TESTED**（未取得執行結果；本輪觀察到並行會話正在執行甲） |
| 隔離模擬 | v3 整合版 | **NOT TESTED**（11:58:40 產生後尚無任何測試） |
| 隔離模擬 | Tunnel 修復 8 點 | **NOT TESTED**（未實作） |
| **尚未執行的正式維護操作** | 方案 A 全部步驟 | **NOT EXECUTED** |
| 尚未執行 | 方案 B 全部步驟 | **BLOCKED** |

### 7.2 統計

| 判定 | 數量 |
|---|---|
| PASS | 13 |
| FAIL | 1（並行寫入持續中，屬流程狀態非技術缺陷） |
| BLOCKED | 1（方案 B） |
| NOT TESTED | 4 |
| NOT EXECUTED | 1（正式維護） |

---

## 8. 待架構師裁決

1. **並行寫入如何處置**：是否要求另一個會話停止活動？是否指定「單一寫入者」？在裁決前，本 session 維持「只讀」。
2. **方案 A vs B 的優先序**：本審查推薦 A 先行（理由見 §6.3），並行會話推薦 B 優先。需裁決。
3. **v3 是否作為整合基底**：v3 已正確整合兩套設計且語法通過，但**完全未測試**。是否要求先補跑 `Test-V15CLauncherOwnership.ps1` ＋ `Test-V15CPhase18Adoption.ps1` 對 v3 的完整驗證？
4. **`CommandLine` 可讀性驗證授權**：是否授權在維護窗口以提升權限做**一次**只讀查詢，以解除方案 B 的 BLOCKED？此操作不改變任何狀態。
5. **Tunnel 修復是否獨立階段**：本審查判定需要（§5 D5）。是否排入 Phase 20？
6. **`student_growth=False` 警告**：4/4 週期皆出現 `WARNING fixed Worker health check incomplete`，與本次循環無關但屬既有問題，是否另案處理？

---

## 9. 本輪未執行事項聲明

本輪**未**執行以下任何操作：

- 未 commit／push／merge／deploy
- 未修改主工作樹 `D:\FDE-Power-Inspection-Simulator`
- 未修改正式 v1.5C 啟動器、Windows 排程、正式資料庫、Tunnel、DNS、8770、8030
- 未停止、重啟或接管 8022
- 未主動觸發排程
- 未關閉 safe-delete
- 未終止任何未知程序
- 未移動、刪除、覆蓋或執行並行會話的五個（後為七個）檔案
- 未對 `D:\FDE-AI-Gateway\` 做任何寫入

**唯一寫入動作**：建立本報告檔案。

---

## 10. 附錄｜證據取得方式

| 證據 | 取得方式 |
|---|---|
| HEAD／分支／status | `git rev-parse HEAD`、`git status --porcelain` |
| 正式啟動器 SHA | `Get-FileHash -Algorithm SHA256`（完整值） |
| 排程定義 | `Get-ScheduledTask` ＋ `Get-ScheduledTaskInfo`（只讀） |
| 8022 listener | `Get-NetTCPConnection -LocalPort 8022 -State Listen`（單次） |
| 程序身分 | `Get-CimInstance Win32_Process`（`CommandLine`／`CreationDate`） |
| 啟動日誌 | `[System.IO.File]::ReadAllLines` 尾端單次讀取 |
| 狀態目錄 | `Get-ChildItem` ＋ `Get-FileHash` |
| 語法驗證 | `[System.Management.Automation.Language.Parser]::ParseFile`（不執行腳本） |
| Tunnel 邏輯 | `Read` 原始檔第 232–282 行 |

**已知限制**：

1. 本審查環境為非提升權限，無法讀取提升程序（8022 listener）的 `CommandLine`，因此 E3／S3 在正式環境的成立性標 UNKNOWN。
2. 週期 1、2 的新 listener PID 已被後續週期殺掉，`CreationDate` 不可回溯。
3. 無法讀取並行會話的對話內容，其任務意圖標 UNKNOWN。
4. 未量測 `wrangler` 與 CDN 傳播延遲，對外可用率 73.6 % 為下界估計的可量測部分。

---

*報告結束。依第十九階段指令，交付後停止，等待架構師審核。*
