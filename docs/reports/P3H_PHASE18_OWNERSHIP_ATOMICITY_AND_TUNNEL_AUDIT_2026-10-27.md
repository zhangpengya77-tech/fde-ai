# P3-H 第十八階段：R-1 所有權規則強化、隔離測試、Tunnel 審核與正式維護計畫

- 日期：2026-10-27
- 工作樹：`D:\FDE-AI-UAS-v2.0-p3h-local-backend`
- 分支／HEAD：`codex/p3h-local-backend` / `2fd4f2421dc18df761db80e74e6c4f134448feaf`
- 性質：**只開發與隔離驗證；未執行任何正式操作**
- 結論：**隔離契約測試 30/30 PASS**；**正式部署 BLOCKED**（禁止正式操作 + 發現並行寫入，見 §7）

---

## 0. 執行摘要

| 任務 | 內容 | 結果 |
|---|---|---|
| **A** | R-1 所有權規則：OWNED／FOREIGN／UNKNOWN 三態、S7 專案根訊號、狀態檔原子寫入、單一所有者宣告 | **PASS**（隔離驗證） |
| **B** | 隔離測試：14 類必測情境全覆蓋 + 原第十七階段 17 項契約**重跑** | **PASS 30/30** |
| **C** | Tunnel `Stop-Process` 呼叫鏈只讀審核 | **PASS（審核完成）**；發現 2 處 TOCTOU，建議獨立階段修復 |
| **D** | 正式維護計畫（方案 A 受控停機／方案 B 不中斷收養） | **完成**；推薦**方案 A** |

**紅線遵守**：未停止／重啟／接管 8022；未修改正式啟動器、Windows 排程、正式資料庫、Tunnel、DNS、8770、8030；未 Commit／Push／Merge／Deploy；未關閉 safe-delete；未終止任何非本輪自有程序。

---

## 1. 基線核實（完整 SHA-256，未使用截斷值判定）

| 項目 | 期望 | 實測 | 結果 |
|---|---|---|---|
| Git HEAD | `2fd4f2421dc18df761db80e74e6c4f134448feaf` | `2fd4f2421dc18df761db80e74e6c4f134448feaf` | **相符** |
| 正式啟動器 SHA-256 | `a64330ef…7a7b59`（截斷提示） | `a64330ef7a31e6c981fba95117466610af5e5db833d1ddafc8d91dba1c7a7b59` | **相符（完整值比對）** |
| 正式啟動器大小／LWT | — | 15,766 bytes；`2026-10-11T12:48:53.4560114+08:00` | 未變 |
| 工作樹狀態 | — | 11 項未追蹤（`ops/p3h/v15c-launcher/`、`docs/reports/P3H_PHASE11..17_*.md` 等）；**0 項已追蹤檔案被修改** | 無異常修改 |
| 8022 | — | LISTEN pid=27148 | 未操作 |
| 8770 | — | LISTEN pid=14124 | 未操作 |
| 8030 | — | 未監聽 | 未操作 |
| 排程 | — | `FDE-AI v1.5C Classroom Server`，State=Ready，2 個觸發器，lastRun 11:31:55，nextRun 11:36:53 | 僅唯讀查詢 |

> 測試腳本內建 T14：每次執行前後各取一次正式啟動器 SHA-256，本輪執行前後皆為 `a64330ef7a31e6c981fba95117466610af5e5db833d1ddafc8d91dba1c7a7b59`。

---

## 2. 任務 A：R-1 所有權規則

### 2.1 三態與硬規則（沿用第十七階段，未放寬）

| 判定 | 條件 | 行為 |
|---|---|---|
| **OWNED** | S1 listener 身分 ＋ S3 命令列形狀 ＋ S4 interpreter（自身或祖系）＋ S5 狀態檔匹配 ＋ S6 專屬健康檢查，**全部成立** | 不終止、直接重用 |
| **FOREIGN** | S3 可讀且明確不是本埠 `manage.py runserver`；或 **S7 專案根不符** | **不終止**；寫 log 後 `throw` 中止啟動流程 |
| **UNKNOWN** | 其餘（讀不到、矛盾、狀態檔缺失／損壞／不符） | **不終止**、**不自動收養**、**不覆寫狀態檔** |

### 2.2 本輪新增：S7 專案根訊號（修補第十七階段缺口）

**發現（FAIL → 已修）**：第十七階段的 `Test-IsV15CDjango` 宣告了 `-V15Root` 參數，但函式體內**從未引用**（死參數）。也就是說「完整所有權證據」缺了「哪個專案」這一項：任何使用同一 interpreter、對同一埠執行 `manage.py runserver 127.0.0.1:8022` 的其他專案，只要狀態檔匹配就會被判 OWNED。

**修法（最小、不破壞正式形狀）**：

```powershell
# 正式啟動器的命令列是「裸 manage.py」（專案根不在命令列），因此缺席必須視為中性；
# 只有當命令列帶有「絕對路徑的 \manage.py」時，才要求其目錄等於 V15Root。
$rootMatch = [regex]::Match($cmd, '"?([A-Za-z]:\\[^"]*\\manage\.py)"?', 'IgnoreCase')
# 命中且目錄不符 → FOREIGN（root_hint_mismatch）；未命中 → 中性（root_hint_absent）
```

- S7 **只能強化 FOREIGN，永不把非 OWNED 提升為 OWNED**。
- 正則要求 `manage.py` 前必須是路徑分隔符，因此測試用的 `fake_manage.py` 不會被誤判為專案根。
- 以 **T23**（正式形狀：裸 `manage.py` → 仍 OWNED、`root_hint_absent`）與 **T24**（他專案絕對路徑 → FOREIGN）雙向釘死。

### 2.3 本輪新增：PID 狀態檔原子寫入 + 單一所有者宣告

`Write-V15CStateRecord`（新增於 `V15C-Ownership.ps1`）：

| 機制 | 實作 | 為什麼 |
|---|---|---|
| 序列化 | 具名 mutex `Local\FDE-AI-v15C-PidState`（含 `AbandonedMutexException` 視為取得） | 防止兩個啟動器同時寫入 |
| 原子替換 | 先寫同目錄 `*.tmp.<guid>`（`FileStream` + `Flush($true)`）→ `[System.IO.File]::Replace()` | 讀者只會看到舊檔或新檔，不會看到半截內容 |
| 重試 | 最多 40 次 × 15ms | 讀者以 `FileShare.Read` 開啟時 `ReplaceFile` 會回分享衝突 |
| **不降級** | 重試耗盡 → `replace_failed`（拒絕），**絕不**改為「先刪再移」 | 刪除+搬移正是原子性要消除的窗口 |
| 不得覆寫 | 既有記錄屬於**另一個存活程序** → `existing_owner_alive`，原檔不動 | 對應「FOREIGN／UNKNOWN 不得覆寫狀態檔」 |
| 不得靜默修復 | 既有記錄損壞 → `existing_state_corrupt`，原檔不動 | 損壞是衝突，不是授權 |
| 回讀驗證 | 寫入後重新解析並比對 `pid` | 避免「寫成功但內容不是我要的」 |

呼叫端（`start_fde_v15c_classroom.patched.ps1`）在寫入被拒時**只記錄不中斷**：此時 Django 已上線，中止只會損失可用性而不增加安全性。

### 2.4 本輪修正的兩個真實缺陷

| # | 缺陷 | 證據 | 處理 |
|---|---|---|---|
| R-7 | Windows PowerShell 5.1 `Get-Content -Raw` 在檔案被替換的瞬間會回傳 **`$null`**（檔案實際 119 bytes） | 診斷：500 次讀取中 14 次 `$null`，同刻 `file_len=119` | `Read-V15CStateRecord` 加入 3 次重試；避免誤判 `state_corrupt` → 假 UNKNOWN |
| R-8 | `[System.IO.File]::Replace($a,$b,$null)` 的 `$null` 被 PowerShell 綁成 `""`，.NET 拋 `The path is not of a legal form` | 首次 T15 全數 `replace_failed`（writes=0） | 改用 `[NullString]::Value` |

### 2.5 產物與 SHA-256

| 檔案 | bytes | SHA-256 |
|---|---:|---|
| `ops/p3h/v15c-launcher/V15C-Ownership.ps1` | 19,902 | `adf7f8ecd6bcdaf3d5bd013569c9c6231f0e7f16bf64675a83b0042391b03ec8` |
| `ops/p3h/v15c-launcher/start_fde_v15c_classroom.patched.ps1` | 17,846 | `5d1fc53dd32a064068ac87d3a03069493f3723e1926c88ff8b346f11bc4e74e9` |
| `ops/p3h/v15c-launcher/Test-V15CLauncherOwnership.ps1` | 40,813 | `3157570af27511413eb4a4273583717ba38b66a62b4c6cd81c661375b73cd031` |
| `ops/p3h/v15c-launcher/PATCH.diff`（3 hunks / 66 行） | 4,557 | `d43c37ab7d5fc7ffd8fe845b3dba559aaf2651ca16e8624b0f660f7a2e17a9c6` |
| `ops/p3h/v15c-launcher/TEST_RESULTS_PHASE18_2026-10-27.json` | 12,111 | `ba1f0478a0da95e7717846f071634f73c6bf2e141f8044de2fa253b6cbb9230b` |
| `start_fde_v15c_classroom.original.ps1`（唯讀副本） | 15,766 | `a64330ef7a31e6c981fba95117466610af5e5db833d1ddafc8d91dba1c7a7b59` |

編碼硬約束（PS 5.1）：全部 `.ps1` 皆 **ASCII-only（non_ascii=0）、無 BOM**，並以 `[Parser]::ParseFile` 驗證 `parse_errors=0`。

---

## 3. 任務 B：隔離測試

### 3.1 執行方式與邊界

```
powershell -NoProfile -ExecutionPolicy Bypass -File ops\p3h\v15c-launcher\Test-V15CLauncherOwnership.ps1 -ResultJson TEST_RESULTS_PHASE18_2026-10-27.json
```

- 獨立暫存目錄：`%TEMP%\p3h-v15c-tests-<guid>\`（本輪 `D:\AI_Cache\temp\p3h-v15c-tests-f2d7c3ae…`）
- 非正式埠位：`18022 / 18023 / 18024 / 18025 / 18026 / 18027 / 18099`
- 8022／8770／8030 **只讀取 listener pid**，未發任何終止或啟動指令
- 只終止本腳本自己啟動的程序（T12 驗證 `leaked_test_ports=` 為空）

### 3.2 結果：**30 / 30 PASS，0 FAIL**

```
SUMMARY pass=30 fail=0 total=30
V15C_OWNERSHIP_TESTS_PASS
```

**原第十七階段 17 項契約（T1a/T1b/T1c/T2..T14）全部重跑且全部 PASS**，未以新增測試替代：

| ID | 情境 | 判定 | 結果 |
|---|---|---|---|
| T1a | 真實合法 Django listener（venv shim 的子程序） | OWNED（`ancestor depth=1`） | PASS |
| T1b | venv shim → 子程序（合成祖系） | OWNED | PASS |
| T1c | listener 自身 exe == DjangoPython | OWNED（`listener_exe_is_django_python`） | PASS |
| T2 | 同程序重複檢查 | OWNED／OWNED，pid 不變 | PASS |
| T3 | 同 interpreter、不同專案 | FOREIGN，alive=True | PASS |
| T4 | 不同 interpreter、其他 server | FOREIGN，alive=True | PASS |
| T5 | PID 重用／建立時間不同（2000-01-01） | UNKNOWN，alive=True | PASS |
| T6 | 命令列不可讀 | UNKNOWN，alive=True | PASS |
| T7 | 健康檢查失敗 | UNKNOWN，alive=True | PASS |
| T8a | 狀態檔缺失 | UNKNOWN，alive=True | PASS |
| T8b | 狀態檔損壞 | UNKNOWN，alive=True | PASS |
| T9 | 排程重複觸發（3 次） | 3×OWNED，pid 不變，`started_count` 未增 | PASS |
| T10 | 程序真正停止 | 埠位釋放、`no_listener_on_port` | PASS |
| T11 | 不影響 8022／8770／8030 | 8770/8030 不變；測試埠不含正式埠 | PASS |
| T12 | 僅清理自有程序 | `leaked_test_ports=`（空） | PASS |
| T13 | 判定模組永不終止程序（AST 掃描） | `termination_calls=[]`、32 個 CommandAst、parse_clean | PASS |
| T14 | 正式啟動器未被修改 | `a64330ef…` 前後一致 | PASS |

**本輪新增 13 項（T15–T27）**：

| ID | 情境 | 實測 | 結果 |
|---|---|---|---|
| T15 | 狀態檔原子寫入（600 次併發讀／120 次寫） | `bad=0;empty=0`、`openErr=51`（分享衝突，屬競爭非損壞）、`tmp_leftovers=0` | PASS |
| T16 | 併發啟動（兩程序競爭所有權） | 恰 1 勝（`file_pid=winner`），敗者 `existing_owner_alive` | PASS |
| T17 | 存活的外部所有者不被覆寫 | `existing_owner_alive`、檔案位元組未變 | PASS |
| T18 | 程序建立時間差 3 秒（近域） | UNKNOWN（`state_created_at_mismatch`），alive | PASS |
| T19 | 正式 8022 唯讀判定（非提權） | UNKNOWN（`command_line_unreadable`），pid 27148→27148 | PASS |
| T20 | 健康檢查成功但身分證據不足 | 非 OWNED（`health_ok` ＋ `state_record_absent`） | PASS |
| T21 | UNKNOWN 不終止 | verdict UNKNOWN，pid 不變、alive | PASS |
| T22 | 外部程序佔用埠 | FOREIGN，alive=True | PASS |
| T23 | 正式形狀（裸 `manage.py`、shim→子程序） | OWNED 且 `root_hint_absent`（S7 不誤傷） | PASS |
| T24 | 他專案絕對路徑 `\manage.py` | FOREIGN（`root_hint_mismatch`），alive | PASS |
| T25 | 排程重複觸發 | 3×OWNED、pid 不變、狀態檔 hash 與 mtime 均未變 | PASS |
| T26 | 狀態檔損壞後的安全拒絕 | UNKNOWN ＋ `existing_state_corrupt` ＋ 原檔未變 | PASS |
| T27 | 隔離程序停止後的恢復 | 埠位釋放 → 新 listener ＋ 寫入狀態 → OWNED | PASS |

### 3.3 十四類必測情境 → 覆蓋對照

| # | 要求情境 | 覆蓋 | 類別 |
|---|---|---|---|
| 1 | 狀態檔原子寫入 | **T15**（新增） | 隔離模擬 |
| 2 | 併發啟動 | **T16**（新增） | 隔離模擬 |
| 3 | PID 重用 | T5（重跑）＋ **T17**（寫入面） | 隔離模擬 |
| 4 | 程序建立時間變化 | **T18**（新增，3 秒近域）＋ T5 | 隔離模擬 |
| 5 | 命令列不可讀取 | T6（重跑）＋ **T19**（正式活體） | 隔離 ＋ 正式唯讀 |
| 6 | Python shim 與 Django 子程序身分 | T1a／T1b／T1c（重跑）＋ **T23** | 隔離模擬 |
| 7 | 外部程序佔用埠 | **T22**（新增）＋ T3／T4 | 隔離模擬 |
| 8 | 健康檢查成功但身分不符 | **T20**（新增） | 隔離模擬 |
| 9 | UNKNOWN 不終止 | **T21**（新增）＋ T8a／T8b | 隔離模擬 |
| 10 | FOREIGN 不終止 | **T22／T24**（新增）＋ T3／T4 | 隔離模擬 |
| 11 | OWNED 正常保持運行 | T2／T9（重跑）＋ **T25** | 隔離模擬 |
| 12 | 排程重複觸發 | T9（重跑）＋ **T25**（狀態檔不被重寫） | 隔離模擬 |
| 13 | 狀態檔損壞後的安全拒絕 | **T26**（新增）＋ T8b | 隔離模擬 |
| 14 | 隔離程序停止後的恢復 | **T27**（新增）＋ T10 | 隔離模擬 |

### 3.4 測試期間的正式環境觀察（非本輪造成）

`PROD_BEFORE 8022=13528` → `PROD_AFTER 8022=27148`。變動來源是**正式排程自身的既有自傷循環**，同一時間的 `startup.log` 有直接證據：

```
2026-10-27T11:31:59.3209599+08:00 STOPPING stale 8022 listener: PID=13528; executable=C:\Users\admin\.fde-ai\YoloRuntime\python\cpython-3.12.13-windows-x86_64-none\python.exe
```

本輪測試全程未對 8022 發出任何終止或啟動指令（T11／T14 證明）。**此缺陷仍在上線中，每 5 分鐘一次，單次中斷約 2 分鐘。**

---

## 4. 任務 C：Tunnel `Stop-Process` 呼叫鏈只讀審核

> 未修改、未執行、未終止任何 Tunnel 檔案或程序。

### 4.1 行號對映（重要）

指令指出的「第 260、282 行」**不是** SHA 已驗證的原始檔行號，而是**第十七階段修補版**的行號：

| 檔案 | `Stop-Process` 行號 | 說明 |
|---|---|---|
| `start_fde_v15c_classroom.original.ps1`（= 正式檔，SHA `a64330ef…`） | **192**（Django）、**246**、**268** | 權威基線 |
| `start_fde_v15c_classroom.patched.ps1`（第十七階段版） | **260**、**282** | 指令所指行號（+14 位移） |
| `start_fde_v15c_classroom.patched.ps1`（第十八階段版） | **269**、**291** | 本輪 R3 再 +7 行 |

以下分析以**原始檔 246／268**（＝修補版 260／282 的同一段程式碼）為準。

### 4.2 呼叫鏈逐點核對

**A. 第 246 行（修補版 260）**

```powershell
240: $existingTunnel = Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" |
241:   Where-Object { $_.CommandLine -match "127\.0\.0\.1:$DjangoPort" } | Select-Object -First 1
242: if ($existingTunnel -and $state.last_successful_tunnel -and (Wait-Http "$($state.last_successful_tunnel)/login/" 30)) {
245: } else {
246:   if ($existingTunnel) { Stop-Process -Id $existingTunnel.ProcessId -Force ... }
```

| 問題 | 結論 |
|---|---|
| **PID 從何而來** | 第 240–241 行的 **CIM 即時快照**（`Name='cloudflared.exe'` 且命令列含 `127.0.0.1:8022`）。**不是** `tunnel-state.json` 的記錄——該檔只有 `failure_count`／`last_tunnel_attempt`／`last_successful_tunnel`／`rate_limit_until`，**沒有 PID**（第十七階段 R-3 的描述需更正） |
| **PID 是否可能過期** | **是。** 快照（240）與終止（246）之間夾著第 242 行的 `Wait-Http … 30`（**最長阻塞 30 秒**）。此期間 cloudflared 若自行退出，其 PID 可被系統重用 |
| **是否驗證建立時間** | **否**（終止前未比對 `CreationDate`） |
| **是否驗證命令列** | 僅在**快照時**以命令列過濾；**終止前未重驗**。若命令列不可讀（非提權），`Where-Object` 會濾掉 → `$existingTunnel` 為 `$null` → 不終止（fail-safe，但可能導致重複啟動 tunnel） |
| **跨專案誤殺風險** | **低但非零**：條件已限定為「cloudflared.exe 且指向 8022」，真正誤殺需「PID 重用 ＋ 該 PID 恰好是另一個 cloudflared」 |

**B. 第 268 行（修補版 282）**

```powershell
250: $startedTunnel = Start-Process -FilePath $cloudflared ... -PassThru ...
253: for ($i = 0; $i -lt 60 -and -not $currentUrl; $i++) { Start-Sleep -Seconds 1; ... }
268:       Stop-Process -Id $startedTunnel.Id -Force ...
```

| 問題 | 結論 |
|---|---|
| **PID 從何而來** | `Start-Process … -PassThru` 回傳的 `Process` 物件（本輪自行啟動） |
| **PID 是否可能過期** | **是。** 啟動（250）到終止（268）之間有**最長 60 秒**的等待迴圈。子程序若在期間自行退出且 PID 被重用，`$startedTunnel.Id` 即為過期值 |
| **是否驗證建立時間** | **否** |
| **是否驗證命令列** | **否**（僅憑 `-PassThru` 的 PID） |
| **跨專案誤殺風險** | **極低**（PID 剛由本程序建立），但 60 秒窗口 ＋ PID 重用仍可能命中無關程序 |

**C. 第 192 行（Django，原始檔）**

- 原始碼以「venv shim 路徑不等」強制終止 → 這是每 5 分鐘自傷循環的根因。
- **修補版已完全移除**（改為三態判定 + 不終止），本輪 T1a／T2／T9／T25 已驗證。

### 4.3 附帶發現（同屬 Tunnel 區塊，未修改）

| # | 發現 | 影響 |
|---|---|---|
| R-9 | `Write-TunnelState` 使用 `ConvertTo-Json \| Set-Content`（就地截斷，非原子） | 與本輪修好的 PID 狀態檔同類問題；併發或崩潰可留下半截 JSON |
| R-10 | `Read-TunnelState` 解析失敗時**靜默**回傳 `{failure_count=0}` | 損壞的 rate-limit 狀態會被當成「無限制」，可能觸發 Quick Tunnel 限流 |

### 4.4 是否需要獨立修復階段

**需要（建議 Phase 19）**，理由：

1. 修法必須動 tunnel 區塊（3 處），與本輪「所有權／狀態檔」屬不同風險面。
2. 正確修法很小但要驗證：終止前 `if (-not $p.HasExited)`、優先用 **`$p.Kill()`（handle-based，免疫 PID 重用）**、對 `$existingTunnel` 在終止前**重取快照並比對 `CreationDate`**。
3. tunnel 是對外唯一入口，與所有權修復同窗口會讓**回滾邊界混淆**（出事時無法判斷是 Django 段還是 tunnel 段）。
4. R-9／R-10 應與 tunnel 修復同批處理。

---

## 5. 任務 D：正式維護計畫

> 兩方案皆**未執行**。前置條件：教師核准 + 維護窗口 + 可接受相應中斷程度。

### 5.1 方案 A：受控短暫停機切換（推薦）

| 要素 | 內容 |
|---|---|
| **前置檢查** | ①排程目前 State=Ready、觸發器 `PT5M`（記錄基線）②正式啟動器 SHA = `a64330ef7a31e6c981fba95117466610af5e5db833d1ddafc8d91dba1c7a7b59`、15,766 bytes ③模組 SHA = `adf7f8ec…`、啟動器 SHA = `5d1fc53d…`，兩者 `non_ascii=0`／無 BOM／`ParseFile` 0 錯 ④記錄當前 tunnel URL 與 8022 PID ⑤窗口內無其他代理寫入 `D:\FDE-AI-Gateway\` |
| **操作順序** | 1) `Disable-ScheduledTask`（先凍結 5 分鐘循環）<br>2) 備份正式啟動器至 `D:\FDE-AI-Gateway\backups\<戳>\` 並記錄 SHA<br>3) 複製 `V15C-Ownership.ps1` → `D:\FDE-AI-Gateway\`（驗 SHA）<br>4) 以 `patched.ps1` 覆蓋正式啟動器（驗 SHA = `5d1fc53d…`）<br>5) **記錄 8022 PID → 確認其為 Django（命令列/interpreter）→ 終止該 PID 一次** → 確認埠位釋放<br>6) 手動執行啟動器一次 → 應出現 `ONLINE; django=PASS` 且 `django-v15c-pid.json` 產生、`pid` = 當前 8022 擁有者<br>7) 再執行一次 → 應出現 `8022 OWNED … reuse`，**PID 不變**<br>8) `Enable-ScheduledTask`<br>9) 觀察 3 個週期（15 分鐘） |
| **失敗停止條件** | 任一 SHA 不符／`ParseFile` 有錯／終止 8022 後 60 秒埠位未釋放／首次啟動結束碼 ≠ 0 或無 `ONLINE`／狀態檔未產生／第二次執行仍非 OWNED／8022 連續 2 個週期不可用／出現任何非預期程序被終止 → **立即停止並回滾** |
| **回滾步驟** | 1) `Disable-ScheduledTask` 2) 還原備份的原始啟動器（驗 SHA 回 `a64330ef…`）3) 刪除 `D:\FDE-AI-Gateway\V15C-Ownership.ps1` 與 `%LOCALAPPDATA%\FDE-AI\classroom\django-v15c-pid.json` 4) `Enable-ScheduledTask` 5) 手動執行一次確認回到 `ONLINE` |
| **回滾後排程狀態** | `State=Ready`、觸發器 `PT5M` 未變（回滾不應改動任何觸發器設定）；代價是回到每 5 分鐘約 2 分鐘中斷的既有缺陷，**需向教師明示** |
| **五分鐘誤殺循環防復發檢查** | ①連續 3 個週期 `startup.log` 出現 `8022 OWNED pid=…; reuse` ②8022 PID **全程不變** ③日誌中 **0 次** `STOPPING stale` ④每 5 分鐘仍有新日誌（證明排程真的在跑）⑤`/login/` 持續 200 ⑥`student_growth` 健康檢查回到 True（目前為 False，屬既有告警） |

### 5.2 方案 B：不中斷所有權收養（零停機備選）

核心思路：**不放寬 R-1**（UNKNOWN 仍不自動收養），改以「人工、可驗證的證據種子」讓首次判定即為 OWNED，因此不需重啟 Django。

| 要素 | 內容 |
|---|---|
| **前置檢查** | 同方案 A ①～⑤，另加：<br>⑥**排程必須先停用**——否則每 5 分鐘重建 Django 會使種子立即失效<br>⑦必須在**提權 PowerShell** 中執行（S3 需可讀命令列；本輪非提權 session 讀不到，T19 即活體樣本）<br>⑧確認可讀 8022 擁有者的 `CreationDate`（本輪實測**可讀**）與 `CommandLine`（本輪**不可讀**，需提權） |
| **操作順序** | 1) `Disable-ScheduledTask`<br>2) 提權取得 8022 擁有者 `PID` ＋ `CreationDate`（UTC）<br>3) 以 `Write-V15CStateRecord -ProcessId <pid> -CreatedAtUtc <created>` 原子寫入種子（不得覆寫既有記錄）<br>4) 部署模組與修補啟動器（同方案 A 步驟 3–4）<br>5) 手動執行啟動器一次 → 應出現 `8022 OWNED … reuse`，**Django 未重啟、PID 不變**<br>6) 再執行一次確認穩定<br>7) `Enable-ScheduledTask`<br>8) 觀察 3 個週期 |
| **失敗停止條件** | 種子寫入被拒（`existing_owner_alive`／`existing_state_corrupt`）／判定為 UNKNOWN（命令列不可讀、建立時間差 > 2 秒、健康檢查失敗）／日誌出現任何 `STOPPING`／PID 改變 → **立即轉方案 A**（同一窗口內） |
| **回滾步驟** | 1) `Disable-ScheduledTask` 2) 刪除 `django-v15c-pid.json`（否則殘留會誤導後續判定）3) 還原原始啟動器（驗 SHA）4) `Enable-ScheduledTask` 5) 手動執行一次確認 `ONLINE`。<br>**8022 全程未被碰觸，回滾不需重啟 Django** |
| **回滾後排程狀態** | `State=Ready`、`PT5M` 未變；服務全程未中斷 |
| **五分鐘誤殺循環防復發檢查** | 同方案 A ①～⑤，另加：⑥確認 `django-v15c-pid.json` 的 `created_at` 與實際程序建立時間差 < 2 秒（否則下輪會翻為 UNKNOWN） |

### 5.3 推薦：**方案 A**（不以零停機為唯一優化目標）

| 判準 | 方案 A | 方案 B |
|---|---|---|
| 證據強度 | **強**：狀態檔由「啟動器自己啟動的程序」產生，證據鏈自洽；T1a／T2／T9／T25 已用**真實程序**驗證此路徑 | 中：依賴「人工種子 + 提權可讀命令列」；**提權可讀性本輪 NOT TESTED**，且種子與實際建立時間差 > 2 秒即 UNKNOWN |
| 回滾路徑明確度 | **高**：還原 1 檔 + 刪 2 檔，SHA 可驗 | 中：需刪種子檔，否則殘留會誤導；且「零停機」使操作者較難察覺已進入失敗態 |
| 失敗模式 | 失敗即「啟動流程中止、Django 仍在」，fail-safe | 同為 fail-safe，但失敗後仍需轉方案 A，等於**多一次切換** |
| 中斷成本 | 60–120 秒（一次性） | 0 |
| 與現況比較 | 現況每 5 分鐘中斷約 2 分鐘（可用率約 60%）；方案 A 當日即回收成本 | 同左，但多一個未驗證前提 |

**結論：推薦方案 A。** 若教師要求「窗口內不得有任何中斷」，方案 B 可作為備選，但必須滿足兩個硬前提：①提權上下文可讀 `CommandLine`（窗口內第一步先驗證，不可讀即放棄 B）②排程已停用。任一不滿足 → 直接走方案 A。

---

## 6. 統計：PASS / FAIL / BLOCKED / NOT TESTED

| 分類 | 數量 | 項目 |
|---|---:|---|
| **PASS** | **32** | 基線核實 2（HEAD、正式啟動器完整 SHA）＋ 契約測試 30（T1a–T27） |
| **FAIL** | **0** | — |
| **BLOCKED** | **4** | **B-1** 無法在正式環境驗證「修復後 OWNED」（禁止改正式腳本／排程／8022）<br>**B-2** 無法驗證「接管既有 8022」的提權可讀性（本 session 非提權）<br>**B-3** 並行寫入未經裁決前，不得部署任一版本（見 §7）<br>**B-4** Tunnel 修復未授權（本輪僅只讀審核） |
| **NOT TESTED** | **5** | **N-1** 以正式 `.venv` 跑真實 trampoline 端到端<br>**N-2** 排程實際觸發修補啟動器<br>**N-3** 提權上下文讀取 8022 `CommandLine`／`ExecutablePath` 的實際結果<br>**N-4** cloudflared PID 重用的實際發生率（未在正式環境製造）<br>**N-5** 方案 B 零停機收養全流程 |

---

## 7. 異常並行寫入（BLOCKED，需裁決）

### 7.1 事實

本輪工作期間（11:07–11:11），`ops/p3h/v15c-launcher/` 出現**五個非本輪建立的檔案**：

| 檔案 | mtime | bytes | SHA-256（前 16） |
|---|---|---:|---|
| `fake_project.py` | 11:07:36 | 2,039 | — |
| `start_fde_v15c_classroom.patched-v2.ps1` | 11:08:24 | 18,771 | `19124aed6aa659a5…` |
| `PATCH-v2.diff` | 11:08:25 | 5,494 | `1e8e4900e08d62b4…` |
| `Test-V15CPhase18Adoption.ps1` | 11:09:35 | 29,472 | `ad540262e35c5fe2…` |
| `V15C-Adoption.ps1` | 11:11:41 | 23,062 | `15b1e0282c6a2093…` |

檔案標頭自述為「P3-H Phase 18: controlled adoption of a pre-existing 8022 listener (scheme B)」，即**同一階段的另一套設計（方案 B 收養）**，含獨立模組、獨立修補啟動器（`patched-v2`）與獨立測試（`T18-1..T18-14`）。

### 7.2 影響判定

1. **本輪產物未被覆寫**：`V15C-Ownership.ps1`（`adf7f8ec…`）、`Test-V15CLauncherOwnership.ps1`（`3157570a…`）、`patched.ps1`（`5d1fc53d…`）的 SHA 與 11:32 測試執行時 T13 回報值一致；正式啟動器仍為 `a64330ef…`。
2. **同一目錄出現兩套互斥設計**：本輪採「嚴格 R-1（UNKNOWN 不自動收養）＋ 人工種子」；並行寫入者採「受控收養模組」。兩者對「是否允許收養」的立場不同，**不可同時部署**。
3. **測試埠位衝突**：對方測試使用 `18022/18023/18024/18099`，與本輪相同 → 兩套測試**不可並行執行**（preflight 會失敗或互相干擾）。
4. **未執行對方任何腳本**，未讀取其測試結果，未刪除、未修改其檔案。

### 7.3 本輪處置（依指令「發現異常並行寫入，立即停止」）

- 於 11:33 發現後**立即停止所有寫入**：未再修改 `V15C-Ownership.ps1`、`patched.ps1`、測試腳本或 `PATCH.diff`。
- 僅完成**唯讀**工作（Tunnel 審核、正式環境快照）與本報告（新檔名，不與對方衝突）。
- **未**對正式環境做任何操作。

### 7.4 待裁決

1. 兩套設計以哪一套為第十八階段正式交付？（本輪 `patched.ps1` 系列 vs 並行寫入者 `patched-v2` 系列）
2. 是否要求並行寫入者停止，或改於**獨立工作樹**進行，避免同目錄競爭？
3. 若採用方案 B，是否授權在維護窗口以提權 PowerShell 先驗證 `CommandLine` 可讀性？

---

## 8. 證據分類（明確區分）

| 類別 | 本輪內容 |
|---|---|
| **靜態程式碼檢查** | `V15C-Ownership.ps1` 全文（S1–S7 判定樹）、`patched.ps1` 的 R1／R2／R3、Tunnel 區塊逐行審核（§4）、AST 掃描（T13）、編碼／BOM／`ParseFile` 檢查、`PATCH.diff` 3 hunks |
| **隔離模擬測試** | T1a–T27 共 30 項（埠位 18022–18027／18099，暫存目錄），`TEST_RESULTS_PHASE18_2026-10-27.json/.log` |
| **正式環境只讀證據** | 正式啟動器完整 SHA-256（`a64330ef…`，15,766 bytes，LWT 2026-10-11）、HEAD、8022=27148／8770=14124／8030 未監聽、排程 State=Ready／nextRun 11:36:53、`startup.log` 的 `STOPPING stale` 證據、T19 對 8022 的唯讀判定（UNKNOWN／`command_line_unreadable`） |
| **尚未執行的正式維護操作** | 方案 A 全部 9 步、方案 B 全部 8 步、Tunnel 修復（Phase 19 建議）、排程停用／啟用、正式檔案部署 |

---

## 9. 本輪未執行清單（合規聲明）

- 未修改 `D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1`（前後 SHA 一致）
- 未修改或停用 Windows 正式排程（僅唯讀查詢）
- 未啟動／停止／重啟／終止／接管正式 8022
- 未修改正式 8770／8030
- 未修改正式資料庫／媒體／Tunnel／DNS／Cloudflare Worker／GitHub Pages
- 未修改 `tunnel-state.json`、未終止任何 `cloudflared.exe`
- 未 Commit／Push／Merge／Rebase／Deploy
- 未關閉 safe-delete、未終止任何非本輪自有程序（T12 證明）
- 未執行、未修改、未刪除並行寫入者建立的 5 個檔案

---

## 10. 建議的下一步

1. **裁決 §7.4 的三個問題**（尤其：哪一套為正式交付）。
2. 核准後於維護窗口執行**方案 A**（§5.1），並以 §5.1 的「防復發檢查」六項驗收。
3. 另立 **Phase 19** 處理 Tunnel 區塊：`HasExited` 檢查 ＋ `$p.Kill()` ＋ 終止前重驗 `CreationDate`，並將 `tunnel-state.json` 改為原子寫入（R-9／R-10）。
4. 併行修正 `student_growth=False` 的既有告警（非本階段範圍，但已連續多輪出現）。
