# P3-H 第十二階段：Evidence 原子性與服務穩定性驗收

- 日期：2026-10-26
- 工作樹：`D:\FDE-AI-UAS-v2.0-p3h-local-backend`
- 分支：`codex/p3h-local-backend`
- HEAD：`dfef115dc911e25ad0604ff3534bffbe968adc21`（與預期一致）
- 已追蹤檔案變動：**0**（`git diff HEAD` 為空）
- 本輪未 Commit / Push / Merge / Rebase / Deploy；未修改核心安全邏輯；未啟動或重啟正式服務。

> 註：本輪指令在「正式保護」一節後截斷。以下依前十一階段已確立之約束執行；若截斷段落另有指定要求，請補述後再行加做。

---

## 一、執行摘要

| 項目 | 結果 |
|---|---|
| 任務 A：Evidence 無效 PDF 上傳與資料一致性 | **PASS**（10 項斷言全過，0 失敗），另有 **1 項設計缺口 FINDING** |
| 任務 B：8022 PID 非預期變動根因 | **已定位**（直接日誌證據，非推測） |
| 隔離埠 8140/8141/8142/8143 | 全部 released |
| 正式 8022 | **目前未監聽（已停止）**；非本輪所致，根因見第三節 |
| 正式 8770 | LISTENING（PID 14124），未受影響 |

---

## 二、任務 A：Evidence 原子性與資料一致性

### 2.1 方法（非模擬）

- 真實 HTTP 全鏈路：`Entry 8142 → Live/Gateway 8141 → Django 8140`，未直接呼叫 view、未用 Django test client。
- 全新候選根 `p3h-candidate-20261026e`（乾淨基線：media 0 檔、全新 SQLite），避免舊資料污染計數。
- 每個案例前後各做兩份快照並取差集：
  - **DB 快照**：`Evidence` 全表（evidence_id / type / upload name / progress / growth / size）
  - **媒體快照**：`MEDIA_ROOT` 全樹（相對路徑 → sha256）
- 拒絕類案例的通過標準＝**狀態碼符合 + DB 零新增列 + 媒體零新增檔 + 表單錯誤訊息存在**。第四項是關鍵：僅有「無殘留」不足以證明是驗證器擋下，故額外擷取 `<p class="error">` 內容作為因果證據。
- 帳號密碼僅存在本次程序記憶體（`secrets.token_urlsafe(32)`），未寫入檔案或日誌。

### 2.2 案例矩陣（本輪實測）

| 案例 | 內容 | 狀態碼 | DB 新增列 | 媒體新增檔 | 驗證器訊息（節錄） | 判定 |
|---|---|---|---|---|---|---|
| E1 | 有效 PDF（正向對照） | 302 | 1 | 1 | — | **PASS**（sha256 與來源一致、落在 MEDIA_ROOT 內） |
| E2 | 副檔名 `.exe` | 200 | 0 | 0 | 「不允許副檔名為 “exe” 。可用的像是: jpg, jpeg, …」 | **PASS** |
| E3 | 超過 100 MB（100MB+1KB） | 200 | 0 | 0 | 「單一證據檔案不得超過 100 MB。」 | **PASS** |
| E4 | 內容為垃圾但副檔名 `.pdf` | 302 | 1 | 1 | 無（無 magic-byte 檢查） | **FINDING**（見 2.3） |
| E5 | 零位元組 `.pdf` | 200 | 0 | 0 | 「送出的檔案是空的。」＋「請提供一個外部網址或一個檔案。」 | **PASS** |
| E6 | 路徑穿越檔名 `../../../p3h12-evil.pdf` | 302 | 1 | 1 | — | **PASS**（存為 `evidence/<uuid>/<hex>.pdf`，`..` 被消除、實體路徑在 MEDIA_ROOT 內） |
| E7 | 跨班級越權（B 用自己 token 上傳到 A 的 enrollment） | 404 | 0 | 0 | — | **PASS** |
| E7b | 沿用他人 CSRF token 越權 | 403 | 0 | 0 | — | **PASS** |
| E8a | 全域不變量：每筆 Evidence 都有實體檔 | — | — | — | rows=3 / media=3 / missing=0 | **PASS** |
| E8b | 全域不變量：無孤兒媒體檔 | — | — | — | orphans=0 | **PASS** |
| E9 | 拒絕類上傳未污染任務進度 | — | — | — | progress=in_progress | **PASS** |

補充（媒體目錄外殘留檢查）：系統 temp 目錄中 **無** 任何 >50 MB 且 2 小時內建立的暫存檔，E3 的 100 MB 串流上傳未在磁碟留下殘骸。

最終媒體樹僅 3 個檔（E1/E4/E6 各一），與 DB 3 筆一一對應。

### 2.3 FINDING（未修復，待裁決）

**E4：內容層未做 magic-byte 驗證。**
任意二進位內容只要副檔名為 `.pdf` 即被接受並原樣落盤（實測 bytes 完全一致，row `d5017332-890f-444a-b481-1f8c129680ab`）。

- 影響：**不影響原子性**（列與檔仍 1:1 一致，E8 已證明），但影響「無效 PDF 不得入庫」的語意。
- 現行防線僅有：副檔名白名單（`FileExtensionValidator`）＋ 100 MB 上限（`validate_evidence_size`）＋ 零位元組由 Django FileField 攔下。
- 建議修法（**本輪未執行**，因屬核心驗證邏輯變更，超出本輪授權）：在 `EvidenceForm.clean_upload()` 或 model validator 加入 PDF 檔頭 `%PDF-` 檢查與 MIME 一致性檢查。

### 2.4 任務 A 判定

**EVIDENCE_ATOMICITY_PASS**：10 項斷言全過、0 失敗、1 項 FINDING。
腳本輸出：`SUMMARY pass=10 fail=0 observe=1 finding=1` / `EVIDENCE_ATOMICITY_PASS`（exit 0）。

> 過程備註（方法學修正，非產品缺陷）：首次執行時 E2/E3/E5 因我的錯誤擷取器（只認 `errorlist`，實際模板用 `<p class="error">`）誤判為 FAIL。修正擷取器並改用全新候選根重跑後全數 PASS。此修正是**純測試腳本**修改，未動產品程式碼。

---

## 三、任務 B：8022 非預期 PID 變動之唯讀根因調查

### 3.1 現況（本輪實測）

- `127.0.0.1:8022` **無 LISTENING socket**；HTTP 探測回 `000`（不可達）。
- 無任何 `manage.py runserver ... 8022` 程序存在（`Win32_Process` 全表查證）。
- 相對地，`8770`（RAG）仍 LISTENING（PID 14124，19:33:14 啟動），健康檢查 200。
- 期間觀察到零星 `SYN_SENT → 127.0.0.1:8022`（來自不同 PID），係外部客戶端重試，非服務端。

### 3.2 直接證據（原文日誌，非推論）

`C:\Users\admin\AppData\Local\FDE-AI\classroom\startup.log`：

```
2026-10-26T09:32:01 STOPPING stale 8022 listener: PID=18448; executable=C:\Users\admin\.fde-ai\YoloRuntime\python\cpython-3.12.13-windows-x86_64-none\python.exe
2026-10-26T09:37:58 STOPPING stale 8022 listener: PID=24980; executable=...YoloRuntime\python\cpython-3.12.13...\python.exe
2026-10-26T18:52:36 STOPPING stale 8022 listener: PID=11952; executable=...YoloRuntime\python\cpython-3.12.13...\python.exe
2026-10-26T19:37:09 STOPPING stale 8022 listener: PID=15248; executable=...YoloRuntime\python\cpython-3.12.13...\python.exe
2026-10-26T19:59:41 STOPPING stale 8022 listener: PID=13516; executable=...YoloRuntime\python\cpython-3.12.13...\python.exe
```

`C:\Users\admin\AppData\Local\FDE-AI\classroom\startup-error.log`：

```
Port 8022 is still occupied by a non-v1.5C process.
v1.5C Django did not become available.
```

排程工作 `FDE-AI v1.5C Classroom Server`：

| 欄位 | 值 |
|---|---|
| State | Running |
| Action | `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1"` |
| Trigger | LogonTrigger + TimeTrigger（**約每 5 分鐘重複**） |
| LastRunTime | 2026-10-26 20:06:54 |
| LastTaskResult | 267009（`SCHED_S_TASK_RUNNING`） |
| NextRunTime | 2026-10-26 20:11:53 |

### 3.3 根因

`start_fde_v15c_classroom.ps1` 第 185–197 行的所有權判定：

```powershell
$expectedDjangoExe = [IO.Path]::GetFullPath($DjangoPython)   # ...FDE-AI-v1.5\student_portal\.venv\Scripts\python.exe
$django = Get-Listener $DjangoPort                            # 8022
if ($django) {
  $ownerPath = (Get-Process -Id $django.OwningProcess).Path
  if ($ownerPath -and $ownerPath -ne $expectedDjangoExe) {
    Add-Content ... "STOPPING stale 8022 listener: PID=...; executable=$ownerPath"
    Stop-Process -Id $django.OwningProcess -Force             # ← 強殺
    ...
    if ($django) { throw "Port 8022 is still occupied by a non-v1.5C process." }
  }
}
if (-not $django) { Start-Process $DjangoPython manage.py runserver 127.0.0.1:8022 --noreload --insecure ... }
if (-not (Wait-Http "http://127.0.0.1:8022/" 30)) { throw 'v1.5C Django did not become available.' }
```

**結論（三段因果）：**

1. **8022 被兩個不同啟動器爭用。** 一個外部啟動器用 `C:\Users\admin\.fde-ai\YoloRuntime\python\cpython-3.12.13-...\python.exe` 起 Django 佔用 8022；v1.5C 排程工作認定「非 v1.5C venv python」即為 stale。
2. **每約 5 分鐘的排程執行會把該 listener 強制終止。** 這正是「PID 非預期變動」的機制：每次被殺後由外部啟動器（或下一次排程）重新起一個新 PID，故觀察到 4328 → 25256 → 15248 → 13516 的序列。
3. **殺掉之後 v1.5C 自己起不來。** 19:59:41 那次終止後，`D:\FDE-AI-Gateway\logs\django.log` 與 `django.err.log` 於 19:59 被建立但為 **0 位元組**，隨後 `Wait-Http` 30 秒逾時 → `v1.5C Django did not become available.` → 任務失敗。此後 8022 一直無人監聽，直到本輪結束（20:12）仍未恢復。

**已排除的可能：**

- 非本輪 P3-H 工具所致：`stop-p3h-isolated.ps1` 只終止 `p3h-state.json` 記載的 8140/8141/8142，且需 PID＋命令列片段＋建立時間（±1s）三重比對；本輪三次停止皆輸出 `verified P3H process stopped`，與 8022 無關。
- 非 `start-p3h-isolated.ps1` 所致：該腳本對 8022/8030/8770 有硬性拒絕。
- 非程式碼 autoreload：v1.5C 以 `--noreload` 啟動，P3-H 隔離 Django 亦為 `--noreload`。

### 3.4 未能確定的事項（NOT DETERMINED）

- **以 YoloRuntime python 起 8022 的那個外部啟動器身份未定。** 已在本工作樹 `demo/`、`ops/`、`tools/` 全量搜尋 `YoloRuntime`：**零命中**；亦無對應 Windows 服務、無對應排程工作（僅 v1.5B 已 Disabled）。研判為其他工作樹／先前工作階段的啟動方式，需該側授權才能追查。
- **v1.5C Django 為何起不來未定。** 兩個 python 均存在且可用（`--version` 正常：venv 3.12.13、YoloRuntime 3.12.13），`D:\FDE-AI-UAS\v1.5C\student_portal\manage.py` 存在；但 `django.err.log` 為 0 位元組，無任何堆疊可判讀。判定需在**獲准重啟正式服務**的前提下，以同一命令前景執行一次才能取得 stderr。

### 3.5 本輪對正式服務的處置

**未執行任何修復或重啟。** 依約束：不啟動、不重啟、不修改正式服務與其排程工作。8022 目前處於停止狀態，需由教師裁決後另行處理。

---

## 四、計數

| 類別 | 數量 | 明細 |
|---|---|---|
| PASS | **12** | 任務 A 10 項斷言 ＋ 媒體目錄外殘留檢查 1 ＋ 任務 B 根因定位 1 |
| FAIL | **0** | — |
| BLOCKED | **0** | — |
| NOT TESTED | **1** | 8022 修復後之恢復驗證（需獲准重啟正式服務） |
| NOT DETERMINED | **1** | 以 YoloRuntime python 起 8022 之外部啟動器身份 |
| FINDING | **1** | E4 內容層無 magic-byte 驗證（不影響原子性） |

---

## 五、埠位與正式服務狀態（本輪結束時）

| 埠 | 狀態 |
|---|---|
| 8140 | released |
| 8141 | released |
| 8142 | released |
| 8143 | released（本輪未啟動） |
| 8022 | **NOT LISTENING**（19:59:41 被 v1.5C 排程終止後未恢復；非本輪所致） |
| 8770 | LISTENING，PID 14124（未碰觸，`/api/rag/health` = 200） |

---

## 六、本輪變更清單

| 檔案 | 類型 | SHA-256 |
|---|---|---|
| `ops/p3h/verify_p3h_evidence_atomicity.py` | 新增（純測試腳本，未追蹤） | `27600b65d58bbe87a58b1fb91da4755dc8220728231864269dbd848dc3594fcb` |
| `docs/reports/P3H_PHASE12_EVIDENCE_ATOMICITY_AND_8022_ROOT_CAUSE_2026-10-26.md` | 新增（本報告，未追蹤） | — |

- `git diff HEAD`：**空**（無任何已追蹤檔案被修改）。
- 未修改 `gateway.py`、`main.py`、`live_assertions.py`、`views.py`、`models.py`、`forms.py` 或任何 `.ps1`。
- 未新增 Commit。

---

## 七、建議（待批准，本輪均未執行）

1. **8022 所有權收斂（優先）**：擇一作為唯一擁有者。若保留 v1.5C 排程，則外部啟動器不得再綁 8022；否則應停用該排程工作。目前「兩個啟動器 + 5 分鐘強殺」的組合會持續造成服務中斷。
2. **恢復 8022 需授權**：以 v1.5C 的 venv python 前景執行 `manage.py runserver 127.0.0.1:8022 --noreload --insecure`，取得 stderr 以定位「起不來」的真正原因。
3. **E4 內容驗證**：於表單層加 `%PDF-` 檔頭檢查；屬核心驗證邏輯，需另行授權。
4. **本輪產物是否入庫**：`verify_p3h_evidence_atomicity.py` 建議納入下一個審計 Commit（需另行批准）。

---

## 八、聲明

本輪全程遵守：不 Commit、不 Push、不 Merge、不 Rebase、不 Deploy；不修改核心安全邏輯；不修改正式服務／DB／媒體；不啟用 Vision/H3 ACTIVE；不繞過 safe-delete；不清理其他工作樹之未提交修改。所有 PASS 均基於真實 HTTP／DB／媒體／排程日誌，未以模擬替代。
