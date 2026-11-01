# P3-H 第二十階段 A：E4c 健康標記契約修復與 8022 啟動器隔離回歸 — 交付報告

- **日期**：2026-10-28
- **狀態**：DRAFT — 待架構師裁決（本階段完成後停止，未進入 20-B）
- **授權邊界**：未修改正式 `start_fde_v15c_classroom.ps1`、未修改 Windows 排程、未停止/重啟/接管正式 8022、未操作 8770/8030、未修改正式 DB/媒體/登入頁、未 commit/push/merge/deploy。

---

## 誠實性與完整性聲明（重要）

本輪開始時發現：**上一輪（摘要所述）的 Phase 20-A 工作檔與測試腳本在磁碟上已不存在**。
僅存的基底是 `D:/AI_Cache/temp/p3h19_iso_*` 等暫存快照，且**每一份快照都仍是未修復的 3-marker 版本**（`resend-verification` 仍在 `V15C-Adoption.ps1:297`）。
依本專案「磁碟碼 > 文件 > HEAD」原則與 fail-closed 完整性要求，**不得宣稱先前「12/12 通過」或「84 項回歸通過」**，因無任何檔案與執行證據可佐證。

因此本輪依使用者決策「重建並真實執行」：**在持久目錄重建 Phase 20-A 環境、落實 2-marker 修正、重建隔離副本、忠實重建並真實執行 E4c 12 項測試**，並誠實標註無法執行的項目。

**重建保真度交叉驗證**：重建後的隔離副本 SHA-256 = `c7bfd55257ab36d03755b7d3860a18c44dcae98b0bdb67dabbd1b88995694a65`，與上輪摘要所述「原隔離副本 SHA `c7bfd55257ab36d0`」**完全一致**；`V15C-Ownership.ps1` = `adf7f8ec…` 與 Phase 19 未改一致。此一致性證實本次重建忠實還原了原定交付物。

---

## 一、Git / 腳本基線（重新核實）

| 項目 | 結果 |
|---|---|
| 正式啟動器 `D:/FDE-AI-Gateway/start_fde_v15c_classroom.ps1` | SHA `a64330ef7a31e6c981fba95117466610af5e5db833d1ddafc8d91dba1c7a7b59`，15,766 B，Oct 11 — **與基線相符，未修改** |
| v2.0 倉庫目前分支 | `feat/m02-simulator-entry`（注意：非摘要所述 `codex/p3h-local-backend`） |
| P3H 工作提交狀態 | **從未 commit/push**（符合「不 commit/push」授權；P3H 工作原存活於暫存 `AI_Cache/temp`，現僅餘 Phase 19 快照） |
| 正式 8022 / 8770 / 8030 | 8022 監聽中、8770 監聽中、8030 未監聽（唯讀確認） |
| 並行寫入 | 無（Gateway 目錄 LastWriteTime 皆舊；本輪僅新增 `ops/p3h/v15c-launcher/` 子目錄） |

> 關於摘要所述 git HEAD `2fd4f242…` / 分支 `codex/p3h-local-backend`：該基線來自一過渡/暫存上下文，現已不可在常駐倉庫重現。本輪以**可常駐驗證的事實**（正式啟動器 SHA 不變、E4c 根因可由正式原始碼證實）作為基線。

## 二、E4c 根因證據（唯讀、由正式原始碼證實）

三項決定性證據，彼此一致：

1. **真實 `/login/` 頁面實測/原始碼**：`student_login.html` 僅穩定含 `FDE-AI`（標題）與渲染後的 `csrfmiddlewaretoken`（`{% csrf_token %}`），**從不含 `resend-verification`**。
2. **`learning/urls.py:20`**：`login/resend-verification/` 是**獨立路由**（`resend_activation_by_email` 視圖），**從未內嵌於 `/login/` 頁 HTML**。
3. **舊測試替身過度配合**：原 `fake_project.py:26` 刻意寫入 `action="/login/resend-verification/"` 讓 3-marker 測試通過 —— 此即「隔離通過、正式不符」矛盾根源（本輪已修正為誠實複本，移除 resend-verification）。

**結論**：E4c 是「HTTP 健康檢查」與「身分識別」混用。3-marker 契約 `@('FDE-AI','csrfmiddlewaretoken','resend-verification')` 要求一個在真實頁面**結構性不可達**的標記，是第十九階段 E4c 死結的真正原因（比 Codex 報告歸因 CommandLine 更深）。

## 三、最小 diff（3-marker → 2-marker）

| 檔案 | 位置 | 修改 |
|---|---|---|
| `V15C-Adoption.ps1`（權威模組） | L297 | `HealthMarkers` 預設由 3-marker 降為 `@('FDE-AI','csrfmiddlewaretoken')` |
| `start_fde_v15c_classroom.patched-v3.ps1` | L207 | 收養呼叫 `-HealthMarkers` 降為 2-marker |
| `start_fde_v15c_classroom.patched-v3.isolation.ps1` | L207 | 同上（隔離副本，與 patched-v3 現為 byte-identical） |
| `fake_project.py`（重建） | 全檔 | 誠實複本：僅含 FDE-AI + csrfmiddlewaretoken，移除 resend-verification |

- 程序層身分閘門 **E3/E4a/E4b/E5 仍為主要 fail-closed 閘門**；HTTP 指紋只作輔助。
- 不得只以 HTTP 200 判定 OWNED；不得移除 E4c 後無替代；不得將 UNKNOWN 改 OWNED；不得放寬 FOREIGN；不引入新正式依賴。

## 四、隔離修復產物（重建）

| 檔案 | SHA-256 (前16) | 說明 |
|---|---|---|
| `V15C-Adoption.ps1` | `7988d8668ba8be71` | 權威模組，2-marker |
| `V15C-Ownership.ps1` | `adf7f8ecd6bcdaf3` | 單一寫入器（Phase 19 未改） |
| `start_fde_v15c_classroom.patched-v3.ps1` | `c7bfd55257ab36d0` | 修補啟動器，2-marker |
| `start_fde_v15c_classroom.patched-v3.isolation.ps1` | `c7bfd55257ab36d0` | 隔離副本（= patched-v3，已含安全配置塊） |
| `fake_project.py` | `0180509e9b68dfcf` | 誠實測試替身 |
| `Test-V15CPhase20E4c.ps1` | `bdc4fa8454601b49` | 12 項 E4c 測試（重建並真實執行） |

- 終止原語掃描：`V15C-Adoption.ps1` 0 處；隔離副本僅 3 處為註解/訊息文字（「no-auto-kill」「no auto-kill by policy」），**無實際 Stop-Process / taskkill / `.Kill(`**。
- 編碼：三者皆 ASCII、無 BOM（PowerShell `-File` 安全）。

## 五、模組依賴與單一寫入器

- `Write-V15CStateRecord`（`V15C-Ownership.ps1:292`）：原子寫入（temp + move）、單一擁有者規則（`existing_owner_alive` 永不覆寫）、`AllowOverwrite` 預設關閉。
- `Invoke-V15CAdoptionClaim`（`V15C-Adoption.ps1:503`）：委託 `Write-V15CStateRecord`，自身不直寫檔案；`Verdict -ne 'ADOPTABLE'` 或 `CreatedUtc` 缺失 → 拒絕。
- 依賴模組：`V15C-Ownership.ps1`（ProcessInfo/ListenerPid/StateRecord）、`V15C-Adoption.ps1`（E1..E8 閘門 + Resolve + Claim）。啟動器依序 dot-source 兩者。

## 六、84 項既有回歸（所有權 30 + 整合 37 + 故障退出 17）

**原始狀態：NOT EXECUTED — 腳本已徹底遺失，不可還原。**

原三套測試腳本（`Test-V15CLauncherOwnership.ps1`、`Test-V15CPhase18Adoption.ps1`、`Test-V15CPhase19FaultExit.ps1`）與 `p3h19-build-isolation-double.py` 已不在磁碟。本輪對 `D:/AI_Cache/temp`（其中共有 190 個 `.ps1`）、v2.0 倉庫與 Codex 倉庫做了**窮盡搜尋，確認存在零個 `Test-*.ps1`**；原始 84 項腳本確認不可還原。**本輪未偽造這 84 項結果。**

**補救（本輪新增）：重建式回歸 `Test-V15CPhase20ReconstructedRegression.ps1`，32/32 PASS（真實執行，EXIT=0）。**

> 這是**全新重建**、覆蓋同類不變量的套件，**不是原始 84 項**；故本報告不宣稱「84 項通過」，僅宣稱「重建式 32 項全綠」。

- **覆蓋面**：
  - **所有權狀態檔 11 項（O-01..O-11）**：寫入缺失檔、活擁有者永不覆寫（且原紀錄不變）、同 pid 可刷新、`AllowOverwrite` 顯式接管、死擁有者可替換、損壞狀態拒絕覆寫、原子寫入無 `.tmp` 殘留、讀缺失/損壞語義、payload 蛇形欄位（`pid/created_at/port/v15_root`）、模組零真實終止原語（排除註解）。
  - **收養閘門故障矩陣 15 項（F-01..F-15）**：E1 監聽不符、E2 建立時間不可讀、E3 指令行不可讀/非 runserver、E4a venv 不足、E4b manage.py 身分不符、E5 解釋器未證、E6 PID 漂移、E7 健康失敗、E8 啟動器衝突/互斥鎖不可驗 —— 逐一 → UNKNOWN；全證據 → ADOPTABLE；claim 委託單一寫入器寫入、非 ADOPTABLE 拒絕、缺 `CreatedUtc` 拒絕。
  - **決策映射 6 項（D-01..D-06）**：OWNED→REUSE；UNKNOWN+state_absent+ADOPTABLE→ADOPT；證據不足→ABORT；收養停用→ABORT；FOREIGN→ABORT；無 state_absent 的 UNKNOWN→ABORT。
- **安全性**：全部以注入 provider 執行，**未掃描正式程序、未探測正式埠、未觸碰 8022/8770/8030**；狀態檔僅寫入 `$env:TEMP` 唯一子目錄並已清理；使用專用互斥鎖名（非正式啟動器互斥鎖）。
- **證據**：`TEST_RESULTS_PHASE20_REGRESSION.json` / `.log`（`total=32 pass=32 fail=0`）；腳本 SHA `723e58bb20286a82…`。
- **殘留建議**：重建套件覆蓋面可能與原始 84 項不同。若日後能還原原始三套腳本，仍應補跑以**完全**關閉 R1；在此之前 R1 由「高」降為「中」。

## 七、E4c 12 項專項測試（重建並真實執行）

**結果：12/12 PASS（EXIT=0）。** 執行方式：PowerShell 點選模組，注入 provider 做確定性契約驗證；對誠實 `fake_project.py`（隔離埠 18199）與（可選）正式 8022 做唯讀 HTTP 指紋；E4C-08 於隔離暫存狀態檔寫入單一擁有者記錄；全程不觸碰正式服務。

| ID | 驗證點 | 結果 |
|---|---|---|
| E4C-01 | 真實頁複本 2-marker → AllMarkers=True, status=200 | PASS |
| E4C-02 | 舊 3-marker 同頁 → AllMarkers=False（證實死結根因 + 修復必要性） | PASS |
| E4C-03 | 注入 UNKNOWN, e4c=False | PASS |
| E4C-04 | 注入 UNKNOWN, e4c=True e5=False | PASS |
| E4C-05 | 注入 UNKNOWN, e7=False status=302 | PASS |
| E4C-06 | 注入 UNKNOWN, 原因含 E3_commandline_unreadable | PASS |
| E4C-07 | 注入 UNKNOWN, e6=False | PASS |
| E4C-08 | ADOPTABLE（2-marker 現可達）＋隔離狀態紀錄寫入單一擁有者 pid=90001 | PASS |
| E4C-09 | OWNED→REUSE；模組終止原語 0 | PASS |
| E4C-10 | UNKNOWN（無 state_absent）→ABORT | PASS |
| E4C-11 | UNKNOWN e7=False→ABORT | PASS |
| E4C-12 | 正式 8022/8770/8030 監聽狀態前後不變（唯讀） | PASS |

證據：`TEST_RESULTS_PHASE20_E4C.json` / `.log`。

## 八、維護方案重新裁決（A/B）

| 維度 | 方案 A：受控冷啟動 | 方案 B：受控收養（2-marker 修復後） |
|---|---|---|
| 機制 | 首次啟動前要求 8022 已停止 | 對「已存在、經全證據驗證為我方」的 listener 收養並寫單一擁有者記錄，**不殺程序** |
| 停機 | 需要維護視窗（先停後啟） | 免停機 |
| 過去障礙 | 無 | E4c 死結（3-marker 永不滿足）→ UNKNOWN → ABORT |
| 現狀 | 仍可作安全備案 | **E4c 死結已解，B 現可達 ADOPTABLE**（E4C-08 證實 state-absent + ADOPTABLE → 受控寫入） |
| fail-closed | 任一閘門缺失→ABORT | 任一閘門缺失→UNKNOWN→ABORT（無殺） |

**裁決**：**方案 B 現為可行主案**（原封鎖它的 E4c 死結已修復）；方案 A 保留為安全備案。兩者皆須在「全證據通過 + 啟動器以提升權限執行」下方能走完 REUSE/ADOPT 完整路徑（見風險 R2）。

## 九、Runbook（另見 `P20A_MAINTENANCE_RUNBOOK_DRAFT.md`，DRAFT — NOT APPROVED）

十二節：E4c 根因/修復、新補丁 SHA、依賴模組、維護前檢查、A/B 准入、CommandLine 權限、排程防護、proxy 衝突、三週期驗收、回滾、舊版不得直恢問題排程、Tunnel 風險。**保持 DRAFT — NOT APPROVED。**

## 十、整體裁決

**CONDITIONAL（附條件通過）**：
- E4c 契約修復正確且 12/12 隔離測試通過；重建式回歸 32/32 真實全綠。
- 但（1）原始 84 項回歸腳本不可還原、未以其原貌執行（已由重建式 32 項覆蓋同類不變量，R1 由高降中），（2）正式環境 E3 CommandLine 讀取須提升權限方能走完 REUSE/ADOPT 完整路徑（非提升下安全 ABORT），（3）P3H 工作從未提交、須常駐化方能複驗。
- 待上述三項釐清/補齊，且架構師核准 Runbook，方可進入第二十階段 B 正式維護視窗。

## 十一、統計分級

| 類別 | 結果 |
|---|---|
| E4c 專項測試 | 12/12 PASS（真實執行） |
| 重建式回歸（所有權11＋故障矩陣15＋決策6） | **32/32 PASS（真實執行，EXIT=0）** |
| 原始 84 項回歸（所有權30/整合37/故障退出17） | **NOT EXECUTED — 腳本不可還原（窮盡搜尋零 `Test-*.ps1`）**；以重建式 32 項覆蓋同類不變量 |
| 正式埠最終狀態 | 8022: 監聽中 / 8770: 監聽中 / 8030: 未監聽（與基線一致，本輪零寫入） |
| 終止原語（模組+隔離副本） | 0 實際；3 註解/訊息 |
| 編碼 | ASCII 無 BOM |

## 十二、正式埠最終狀態（唯讀）

- `8022`（v1.5C Django）：監聽中，本輪未觸碰。
- `8770`（RAG）：監聽中，本輪未觸碰。
- `8030`：未監聽（與基線一致）。
- `django-v15c-pid.json`：本輪未建立/修改（E4C-08 僅寫隔離暫存檔，已清理）。

## 十三、未解除風險

- **R1（中，已由高下調）**：原始 84 項回歸腳本不可還原，故未以其原貌執行。本輪以重建式 32 項（所有權 11＋故障矩陣 15＋決策 6）真實全綠，覆蓋同類不變量，顯著縮小但**不等於**原始 84 項的完整覆蓋；若日後能還原原始三套腳本，仍應補跑以完全關閉本風險。
- **R2（中）**：正式環境 E3 CommandLine 讀取需提升權限；非提升下 `Test-V15CAdoptionEligible` 走 `E3_commandline_unreadable` → UNKNOWN → ABORT（安全但無法自動 REUSE/ADOPT）。維護視窗應以提升權限（與排程相同身分）執行啟動器。
- **R3（中）**：P3H 工作從未提交，僅常駐於 `ops/p3h/v15c-launcher/`（本輪新建）。建議架構師核准後納入版本控制/備份，避免再次遺失。
- **R4（中）**：proxy / 埠衝突（見 Runbook 第八節）；8022 與其他本機服務共用 127.0.0.1 時須確認無搶佔。
- **R5（低）**：舊版問題排程不得直接還原（見 Runbook 第十一節）；Tunnel 風險（見第十二節）。

## 十四、停止條件

**本階段完成後立即停止，等待架構師裁決。不得自行進入第二十階段 B 正式維護視窗。**
所有交付物（修正模組、隔離副本、12/12 E4c 證據、Runbook DRAFT、本報告）均已產出並常駐於 `D:/FDE-AI-UAS-v2.0/ops/p3h/v15c-launcher/`，供架構師審閱與後續還原 84 項回歸使用。

---
*附檔：V15C-Adoption.ps1, V15C-Ownership.ps1, start_fde_v15c_classroom.patched-v3.ps1, start_fde_v15c_classroom.patched-v3.isolation.ps1, fake_project.py, Test-V15CPhase20E4c.ps1, TEST_RESULTS_PHASE20_E4C.json, TEST_RESULTS_PHASE20_E4C.log, Test-V15CPhase20ReconstructedRegression.ps1, TEST_RESULTS_PHASE20_REGRESSION.json, TEST_RESULTS_PHASE20_REGRESSION.log, P20A_MAINTENANCE_RUNBOOK_DRAFT.md*
