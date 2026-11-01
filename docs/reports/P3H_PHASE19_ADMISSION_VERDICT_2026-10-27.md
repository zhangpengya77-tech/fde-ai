# P3-H 第十九階段｜8022 正式維護前最後安全閘門 — 准入裁決報告

- **日期**：2026-10-27（本輪收尾快照 14:43 GMT+8）
- **工作樹**：`D:\FDE-AI-UAS-v2.0-p3h-local-backend`（HEAD `2fd4f2421dc18df761db80e74e6c4f134448feaf`，分支 `codex/p3h-local-backend`）
- **本輪性質**：**不執行正式修復**；只讀驗證、隔離測試、Runbook 編寫、准入裁決
- **配套報告**：`P3H_PHASE19_PARALLEL_CONFLICT_AND_PREMAINTENANCE_REVIEW_2026-10-27.md`（並行 Codex 審查）、`P3H_PHASE19_MAINTENANCE_RUNBOOK_2026-10-27.md`（待批准 Runbook）

---

## 1. 裁決（VERDICT）

> **CONDITIONAL — 有條件准入（準備就緒進入正式維護窗口，但不得視為「正式部署已安全」）**

**明確聲明**：本裁決**不代表**「8022 正式部署安全」。依第十九階段指令「不得以測試全部綠燈直接宣稱正式部署安全」，本輪所有 PASS 僅證明 *補丁本身、其依賴、其回滾與故障行為、以及正式環境只讀相容性* 已達維護閘門要求；但 **v3 補丁從未在正式環境執行過**（prod NOT TESTED），且 **正式維護窗口（方案 A）本身尚未執行**（僅有程序）。承認此差異是 CONDITIONAL 而非 READY 的核心原因。

**與 READY／BLOCKED 的界線**：

- 非 **READY**：正式維護操作（停排程、提升權限、停止 8022、切換 v3、觀察、回啟排程）**一項都沒執行**；補丁未觸及正式 `D:\FDE-AI-Gateway\`。
- 非 **BLOCKED**：所有硬閘門（補丁完整性、依賴可解析、故障退出安全、回滾不誤殺、不寫正式庫／不影響 8770／8030）**均已驗證通過**；剩餘只是「需批准後在窗口內執行」的程序性條件，而非技術上不可逾越的阻擋。

---

## 2. 六項任務結論速覽（PASS／FAIL／BLOCKED／NOT TESTED 分級）

| 任務 | 結論 | 分級 | 關鍵證據 |
|---|---|---|---|
| **A. 補丁完整性** | 8/8 全部通過 | **PASS** | `VERIFY_RESULTS_PHASE19_TASKA.json`（依賴路徑、PS 5.1 解析 9 腳本、ASCII/BOM、diff 無越界、0 生產寫入目標、0 憑證字面、模組版本匹配、原始腳本可追溯） |
| **B. 正式環境唯讀相容性** | 全部檢查通過；E3 由本輪解決為 READABLE | **PASS** | `PROBE_PHASE19_TASKB.json`；排程 `RunLevel=Highest`／`UserId=admin`／`PT5M`；狀態目錄 admin FullControl；`django-v15c-pid.json` ABSENT；8770=14124 全程不變；8030 未監聽 |
| **C. 維護路徑比較** | 方案 B **結構性不可達**（E4c 恆假 → ADOPTABLE 永不達成，但 ABORT 已證安全）；方案 A 程序完備（未執行） | 方案 B：**BLOCKED**（結構）；方案 A：**PROCEDURE-READY / NOT EXECUTED** | `PROBE_PHASE19_TASKC_ADOPTION.json`、`PROBE_PHASE19_TASKC_ELEVATED_SIM.json`；Runbook §7 |
| **D. 故障退出與回滾** | 12 故障 + 4 不變量 = **17/17 通過**；隔離實證無誤殺、無正式寫入 | **PASS** | `TEST_RESULTS_PHASE19_TASKD.json/.log`、`Test-V15CPhase19FaultExit.ps1`；INV1–INV4 全 PASS |
| **E. 正式維護 Runbook** | 12 章節獨立文件，標記 **待批准（DRAFT — NOT APPROVED）** | **DRAFT** | `P3H_PHASE19_MAINTENANCE_RUNBOOK_2026-10-27.md` |
| **F. 准入裁決** | 本報告 | **CONDITIONAL** | — |

**沿用第十八階段回歸基線（本輪未重跑，僅確認未被破壞）**：所有權契約 30/30、Phase 18 收養契約 37/37。

---

## 3. 統計（依證據類型分級）

| 判定 | 數量 | 說明 |
|---|---|---|
| PASS | 8（A）+ 約 10（B）+ 17（D）+ 67（沿用回歸）= **102** | 含靜態、相容、故障、回滾、回歸 |
| FAIL | **1**（C·方案 B 之 E4c） | 非技術崩潰，而是正式 `/login/` 頁缺少 `resend-verification` 標記 → 收養閘門恆不成立 |
| BLOCKED | **1**（C·方案 B 整體） | 結構性不可達，非權限或假設未證 |
| NOT TESTED | **1**（v3 於正式環境執行） | 依指令本輪不執行正式修復 |
| NOT EXECUTED | **1**（正式維護窗口／方案 A 實際操作） | 程序已就緒，待批准後執行 |
| DRAFT | 1（Runbook） | 待批准 |
| CONDITIONAL | 1（本裁決） | — |

> 註：並行會話報告（§7.2）統計為 PASS=13／FAIL=1／BLOCKED=1／NOT TESTED=4／NOT EXECUTED=1，其 BLOCKED 項為「方案 B 因 `CommandLine` 不可讀（非提升 UNKNOWN）」。本輪已將該 UNKNOWN 解決為 READABLE（見 §4），並進一步發現方案 B 的真正死結是 E4c（與 `CommandLine` 無關），故本輪的 BLOCKED 語意與並行報告不同。

---

## 4. 與並行會話報告（Codex §6.3）的並列比較

並行報告推薦「**方案 A 先行，方案 B 作為第二階段增強**」，並將方案 B 維持 **BLOCKED**，理由是「`CommandLine` 可讀性在非提升環境標 UNKNOWN，需提升權限只讀驗證才能解除」。

本輪在正式環境取得兩條**決定性生產證據**，將 E3 由 UNKNOWN 提升為 **READABLE**：

1. **`REUSE existing tunnel` 累計 4,232 次**——該分支（`patched-v3` L285）要求 `$existingTunnel` 非空，而它來自 `Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'"` 後以 `Where-Object { $_.CommandLine -match "127\.0\.0\.1:$DjangoPort" }` 篩選。同機、同查詢、同目標，僅權限不同 → 提升權限下可讀。
2. **`startup.log` 直接寫出 listener 的 `executable=` 完整路徑**（例：`STOPPING stale 8022 listener: PID=…; executable=C:\Users\admin\.fde-ai\YoloRuntime\python\cpython-3.12.13-windows-x86_64-none\python.exe`）——提升權限的啟動器在日誌裡明文記錄 listener 執行檔路徑，非推論。

**但本輪發現並行報告未觸及的更深死結**：即便 `CommandLine` 可讀，方案 B 的收養閘門仍**永不可達**，因為 E4c 要求 `FDE-AI`、`csrfmiddlewaretoken`、`resend-verification` **三者同時**出現於正式 `/login/` 頁；實測該頁（1,533 B）`FDE-AI=True`、`csrfmiddlewaretoken=True`、**`resend-verification=False`**（該頁僅含「忘記密碼？」與「建立帳號」）。故 `ADOPTABLE` 永不達成 → `decision_action=ABORT/adoption_evidence_insufficient`，且實證 ABORT 分支**無 `Stop-Process`**、listener PID 前後一致、狀態檔未建立。

| 維度 | 並行會話報告（Codex §6.3） | 本輪 Phase 19 |
|---|---|---|
| 方案 A 優先序 | 推薦 A 先行 | 一致，且 Runbook §7 給出 10 步程序 |
| 方案 B 狀態 | BLOCKED（因 `CommandLine` UNKNOWN） | 仍 BLOCKED，但**死結原因改為 E4c 結構性不成立**（與 `CommandLine` 無關） |
| `CommandLine` 可讀性 | UNKNOWN（非提升） | **READABLE**（兩條生產證據，已解決） |
| 回滾後「每 5 分鐘誤殺」復發 | A7 承認回滾後回歸原狀（已知缺陷） | Runbook §10 設計「**恢復舊檔但保持排程 DISABLED**」的受控退路，從根本上避免該復發 |
| v3 是否測試過 | NOT TESTED（11:58 產生後尚無測試） | 本輪隔離雙生體 + 17/17 故障測試 + 完整邏輯位元比對（見 §5） |

---

## 5. 本輪決定性發現（Decisive Findings）

1. **8022 五分鐘誤殺循環仍在活動**（這正是待修復對象）：
   - `startup.log` 現 **29,912 行**；`STOPPING stale 8022 listener` **4,755 次**（本輪期間 +2）。
   - 最近 6 個週期 `14:16:58 → 14:21:56 → 14:26:56 → 14:31:57 → 14:36:56 → 14:41:56`，間隔約 **5 分 00 秒**，與排程 `PT5M` 完全一致。
   - 現任 8022 listener PID 本輪由 29216 **重啟為 20700**——誤殺循環持續切換 PID，證實服務正被週期性中斷後由 Django 自啟動補回。
   - `REUSE existing tunnel` 4,232 次、`startup-error.log` 3,755 行（含 `Port 8022 is still occupied by a non-v1.5C process` 14 次、`NativeCommandError`(npx) 14 次）。

2. **E3 `CommandLine` 可讀性已解決為 READABLE**（見 §4）。

3. **方案 B 收養路徑結構性不可達**（E4c 恆假）。ABORT 安全已隔離實證：PID 不變、狀態檔未建立、無終止呼叫。

4. **v3 補丁從未在正式環境執行**（prod NOT TESTED）。隔離替身 `patched-v3.isolation.ps1` 已證明其邏輯區塊與正式 `patched-v3.ps1` **位元相同**（213 行邏輯區塊、0 終止原語、ASCII-only、無 BOM），可作為行為等價保證。

5. **新發現的既有環境風險（非補丁引入）**：當程序環境同時存在 `https_proxy` 與 `HTTPS_PROXY`（大小寫並存），.NET 的 case-insensitive `StringDictionary` 複製會拋 `ArgumentException: Item has already been added`，導致 `Start-Process -RedirectStandardOutput` 啟動的 Django **永不啟動**、launcher 經 trap `exit 1`。`PATCH-v3.diff` 不含這三行，正式環境目前未觸發，但維護前須清除重複 proxy 變數（Runbook §11.1）。

6. **不變量全 PASS（證明隔離測試未污染正式環境）**：
   - INV1：無正式 PID 狀態檔產生（`django-v15c-pid.json` 始終 ABSENT）。
   - INV2：正式資料庫 **byte-identical**（前後 SHA `2d58b9707670d8ad`）。
   - INV3：8770 PID **14124 → 14124** 不變；8030 監聽數 **0 → 0**（未受影響）。
   - INV4：故障測試僅終止 harness 追蹤的程序（12 個），未誤殺任何未知程序。

---

## 6. 為什麼不是 READY（不得宣稱正式部署安全）

1. **v3 從未在正式環境執行**：所有測試皆為靜態解析、隔離雙生體、或注入式模擬；正式 `D:\FDE-AI-Gateway\` 未被寫入、正式 8022 未被停止／重啟。
2. **正式維護窗口（方案 A）尚未執行**：10 步程序僅編入 Runbook，未在任何窗口以提升權限運行。
3. **誤殺循環仍處於活動狀態**（見 §5.1），本輪未對其做任何干預（依指令）。
4. **方案 B（零停機收養）不可用**，故必須容忍方案 A 的短暫受控停機——這是維護者須明確接受的代價。
5. **新發現的 proxy 大小寫環境風險**（見 §5.5），雖非補丁引入，但若維護時環境存在該並存變數，會使 Django 起不來。

---

## 7. CONDITIONAL 的准入條件（本輪要求批准後方可解除「不執行」）

以下任一條件未滿足，即**不得進入正式維護窗口**：

1. **批准 Runbook**（`P3H_PHASE19_MAINTENANCE_RUNBOOK_2026-10-27.md`，當前 DRAFT — NOT APPROVED）。
2. **在明確批准的維護窗口內、以提升權限執行方案 A**（Runbook §7 十步）。
3. **嚴格回滾紀律**：若需回退，必須「恢復舊檔 **但保持排程 DISABLED**」（Runbook §10 R1–R6），**不得**直接套用舊版啟動器＋原排程（那會恢復每 5 分鐘誤殺）。
4. **接受方案 B 不可用** → 必須容忍方案 A 的受控停機（本機 8022 中斷約 10–30 s、對外固定 URL 中斷約 60–100 s）。
5. **維護前清除環境中的大小寫重複 proxy 變數**（Runbook §11.1），避免 `Start-Process` 崩潰。
6. **維護後執行 A8 三週期防復發驗收**：連續 15 分鐘觀察，要求 3 個週期皆無 `STOPPING stale 8022 listener`、listener PID 不變、日誌出現 `8022 OWNED`、狀態檔 pid 與實際程序一致。

---

## 8. 本輪 11 項交付清單（Deliverables）

| # | 交付物 | 路徑 | SHA-256(前 16) | 用途 |
|---|---|---|---|---|
| 1 | 任務 A 完整性驗證器 | `ops/p3h/v15c-launcher/verify_p3h19_patch_integrity.py` | `949092605257f280` | 自動化 8 項補丁完整性檢查 |
| 2 | 任務 A 驗證結果 | `ops/p3h/v15c-launcher/VERIFY_RESULTS_PHASE19_TASKA.json`／`.log` | — | 8/8 PASS 證據 |
| 3 | 任務 B 正式環境唯讀探測 | `ops/p3h/v15c-launcher/PROBE_PHASE19_TASKB.json` | — | 相容性／E3／ACL／埠快照（唯讀） |
| 4 | 任務 C 收養實測（非提升） | `ops/p3h/v15c-launcher/PROBE_PHASE19_TASKC_ADOPTION.json` | — | UNKNOWN→ABORT 安全實證 |
| 5 | 任務 C 收養實測（提升模擬） | `ops/p3h/v15c-launcher/PROBE_PHASE19_TASKC_ELEVATED_SIM.json` | — | E1–E8 全條件；E4c 死結證據 |
| 6 | 任務 D 故障退出測試器 | `ops/p3h/v15c-launcher/Test-V15CPhase19FaultExit.ps1` | `c0ae68fe3bdaa814` | 12 故障 ＋ 4 不變量 |
| 7 | 任務 D 測試結果 | `ops/p3h/v15c-launcher/TEST_RESULTS_PHASE19_TASKD.json`／`.log` | — | 17/17 PASS、INV1–INV4 PASS |
| 8 | 隔離雙生體替身 | `ops/p3h/v15c-launcher/start_fde_v15c_classroom.patched-v3.isolation.ps1` | `1f1f4f402a02b82b` | 行為等價、無生產寫入、無終止原語 |
| 9 | 雙生體構建證明 | `ops/p3h/v15c-launcher/p3h19-build-isolation-double.py`＋`BUILD_PHASE19_ISOLATION_DOUBLE.json` | — | 位元相同／0 終止原語／ASCII／無 BOM |
| 10 | 任務 E 正式維護 Runbook（待批准） | `docs/reports/P3H_PHASE19_MAINTENANCE_RUNBOOK_2026-10-27.md` | — | 12 章節，DRAFT — NOT APPROVED |
| 11 | 任務 F 准入裁決報告（本檔） | `docs/reports/P3H_PHASE19_ADMISSION_VERDICT_2026-10-27.md` | — | CONDITIONAL 裁決與條件 |

**已驗證產物 SHA（與本輪紀錄一致）**：`patched-v3.ps1`=`a95a857b11de2ca1`、`V15C-Ownership.ps1`=`adf7f8ecd6bcdaf3`、`V15C-Adoption.ps1`=`48cb7c34732d1eb8`、正式啟動器 `start_fde_v15c_classroom.ps1`（唯讀，未改）=`a64330ef7a31e6c9`（15,766 B）。

---

## 9. 嚴格禁止事項確認（本輪未違反）

- 未修改正式 `D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1`（SHA 前測後相符）。
- 未停止／啟動／重啟正式 8022；未修改 Windows 排程；未修改 8770／8030。
- 未修改正式資料庫及 MEDIA_ROOT（INV2 byte-identical）。
- 未修改 Cloudflare Tunnel／DNS／GitHub Pages。
- 未 commit／push／merge／rebase／deploy（git status 全為 `??` 未追蹤，無已追蹤檔變更）。
- 未終止任何未知程序（INV4）。
- 未繞過 safe-delete；未影響其他工作樹。

---

## 10. 下一步（本輪終止條件）

**本輪於此停止，等待明確批准。不得自行進入正式維護窗口。**

待教師／架構師裁決：
1. 是否批准 Runbook（解除 DRAFT 狀態）；
2. 是否授權在指定窗口以提升權限執行方案 A；
3. 是否接受「方案 B 不可用 → 必須容忍短暫停機」；
4. 是否授權維護前做一次提升權限的 `CommandLine` 只讀複查（本輪已用生產日誌推論為 READABLE，此步為額外保險，非必要）；
5. v3 是否作為正式整合基底（本輪已證其隔離行為等價且 17/17 故障安全通過）。

---

*本報告所有「可讀性」「誤殺計數」「PID」「埠」「狀態檔存在性」等斷言，均取自正式環境**唯讀查詢**或既有日誌，未對正式服務做任何寫入、停止、重啟或接管。*
