# P3-H 第二十階段 A-2：8022 啟動器最後隔離整合驗證與正式維護准入 — 報告

- **日期**：2026-10-28
- **工作樹**：`D:\FDE-AI-UAS-v2.0-p3h-local-backend`（Branch `codex/p3h-local-backend`，HEAD `2fd4f2421dc18df761db80e74e6c4f134448feaf`）
- **狀態**：**CONDITIONAL / NOT APPROVED FOR 20-B**（發現 1 個硬阻斷 I-11 與 1 個環境性生產輪換）
- **授權邊界遵守**：未修改正式啟動器、未修改排程、未停止/重啟/接管正式 8022、未操作 8770/8030、未改正式 DB/媒體/登入頁、未改 Cloudflare Tunnel、未 commit/push。

---

## 〇、重大更正（必讀）

**上一輪報告聲稱「原始 84 項測試腳本不可還原」是錯誤的。**
原因：上一輪搜尋了錯誤的倉庫 `D:\FDE-AI-UAS-v2.0`，而 A-2 指定的工作樹是 `D:\FDE-AI-UAS-v2.0-p3h-local-backend`。

本輪在**正確工作樹**的 `ops/p3h/v15c-launcher/` 找到並核實了原始腳本：
- `Test-V15CLauncherOwnership.ps1`（30 項，SHA `3157570af2751141…`）
- `Test-V15CPhase18Adoption.ps1`（37 項，SHA `ac857624e575d129…`）
- `Test-V15CPhase19FaultExit.ps1`（17 項，SHA `c0ae68fe3bdaa814…`）
- `p3h19-build-isolation-double.py`（SHA `e3b40c2f82f4a9b9…`）

依指令「如可從可信版本庫或備份找回原始腳本，先核實來源與 SHA-256，再決定是否執行」——已核實 SHA-256 並**真實執行**。
故原標記 **ORIGINAL 84 — NOT TESTED 已更正為 ORIGINAL 84 — FOUND & EXECUTED（83/84 PASS，1 項環境性失敗）**。

---

## 一、第一步：基線核實（全部符合，無衝突）

| 項目 | 核實結果 |
|---|---|
| 工作樹存在 | ✅ `D:\FDE-AI-UAS-v2.0-p3h-local-backend` |
| Branch | ✅ `codex/p3h-local-backend` |
| HEAD | ✅ `2fd4f2421dc18df761db80e74e6c4f134448feaf` |
| 正式啟動器 SHA | ✅ `a64330ef7a31e6c981fba95117466610af5e5db833d1ddafc8d91dba1c7a7b59`（未改） |
| 未追蹤檔案 | `ops/p3h/v15c-launcher/`（整目錄）、`backups/`、`docs/reports/P3H_PHASE11..19_*.md`、`docs/handoff/…RUNBOOK…` 等（皆為 P3-H 工作檔，未提交） |
| `patched-v3.ps1` | ✅ `bc57751349551959c9a7957039854d291a59800b3a16a42786dc9d805c5640d0`（19,713 B） |
| `V15C-Ownership.ps1` | ✅ `adf7f8ecd6bcdaf3…`（含 `Write-V15CStateRecord`，L292） |
| `V15C-Adoption.ps1` | ✅ `7988d8668ba8be71…`（2-marker，L297） |
| E4c 12 證據 | ✅ `TEST_RESULTS_PHASE20_E4C.json`：`Phase20-E4c total=12 pass=12 fail=0` |
| 重建 32 證據 | ⚠️ 原不在本工作樹（在 `D:\FDE-AI-UAS-v2.0`）；本輪已複製並在本工作樹重跑 **32/32** |
| Windows 排程 | `FDE-AI v1.5C Classroom Server` = **Ready**（未運行）；`FDE-AI v1.5B` = Disabled |
| 8022 / 8770 / 8030 | 8022 監聽中、8770 監聽中、8030 未監聽 |
| 其他工作樹寫入 | 本輪開始時**無活動寫入者**；但 16:39–16:47 有近期活動（`PATCH-v3.diff`、`TEST_RESULTS_PHASE19FIX_*`），已記錄 |

> **基線無衝突**，故進入第二步。

---

## 二、第二步：E4c 最終補丁核實（8 項全部通過）

| # | 核實點 | 結果 |
|---|---|---|
| 1 | 標記與正式登入頁一致 | ✅ 真實 `/login/` 僅含 `FDE-AI` + 渲染後 `csrfmiddlewaretoken` |
| 2 | 模組與 patched-v3 標記契約一致 | ✅ `V15C-Adoption.ps1:297` 與 `patched-v3.ps1:208` 均為 `@('FDE-AI','csrfmiddlewaretoken')` |
| 3 | 不再要求 `resend-verification` | ✅ 兩檔均無此標記；`fake_project.py` 亦已移除（`fakeHasResend=False`） |
| 4 | 兩標記非唯一身分證據 | ✅ E1/E2/E3/E4a/E4b/E5/E6/E7/E8 仍完整把關（見 E4C-04/06） |
| 5 | E1–E8 完整 | ✅ 收養模組 E1..E8 全在；故障矩陣 15 項逐一破壞均→UNKNOWN |
| 6 | UNKNOWN 不提升 OWNED | ✅ E4C-03/04/05/06/07/10/11 全部 UNKNOWN |
| 7 | FOREIGN/UNKNOWN 不強制終止 | ✅ 模組 0 個真實終止原語；F-13/14、T18-12 證實存活 |
| 8 | 無未批准 Tunnel／正式服務修改 | ✅ 補丁僅改標記契約與收養接線；未觸 Tunnel/正式服務 |

**E4c 專項 12/12 PASS（EXIT=0）**，含 E4C-12 正式 8022/8770/8030 前後狀態一致（`pid_before=8022:26888 8770:26380`，`pid_after` 相同）。

---

## 三、第三步：真實程序隔離整合測試（I-01..I-12）

隔離條件：非正式埠（18022–18027 / 18099 / 18199）、獨立 TEMP 專案與狀態/日誌目錄、不共用正式 DB/MEDIA_ROOT、不使用 Tunnel、不依賴正式 8022。

| ID | 要求 | 對應已真實執行之測試 | 結果 |
|---|---|---|---|
| I-01 | 冷啟動建立有效狀態檔 | R1（adoption）、T27、F12 | ✅ PASS |
| I-02 | REUSE 不建第二實例 | T18-10（REUSE×3）、T9 | ✅ PASS |
| I-03 | ADOPT 全證據受控收養 | T18-2（ADOPTABLE→ADOPT→OWNED）、R2 | ✅ PASS |
| I-04 | ABORT 外來 listener 不終止 | T18-7、R3（foreign_process）、F13 | ✅ PASS |
| I-05 | PID 重用不得誤判 OWNED | T5、T18-5、F4 | ✅ PASS |
| I-06 | CommandLine 不可讀安全退出 | T6、T18-8、F5 | ✅ PASS |
| I-07 | HTTP 異常不得誤判 OWNED | T7、T18-9、F6 | ✅ PASS |
| I-08 | 原子寫入無半成品 | T15（120 寫/0 壞讀）、R8（2621 讀/0 壞）、F11、F12 | ✅ PASS |
| I-09 | 連續三週期不重啟不誤殺 | T25（OWNED×3）、T9、R9（ADOPT+REUSE×4） | ✅ PASS |
| I-10 | 程序中途消失安全退出 | F8、T10 | ✅ PASS |
| I-11 | 代理大小寫衝突處理 | **新增 `Test-V15CPhase20I11ProxyConflict.ps1`（4/4 PASS）** | ⚠️ **發現硬阻斷**（見 §六） |
| I-12 | 只清理自有程序 | T12、INV4（tracked=12） | ✅ PASS |

> I-11 專項證據：`TEST_RESULTS_A2_I11_PROXY_2026-10-28.json/.log`（4/4 PASS）。

---

## 四、第四步：回歸重跑（真實執行）

| 套件 | 項數 | 結果 | 證據檔 |
|---|---|---|---|
| 原始 Ownership | 30 | **30/30 PASS**（EXIT=0） | `TEST_RESULTS_A2_OWNERSHIP_2026-10-28.json` |
| 原始 Phase18 Adoption | 37 | **36/37 PASS**（1 環境性失敗 T18-14） | `TEST_RESULTS_A2_ADOPTION_2026-10-28.json` |
| 原始 Phase19 FaultExit | 17 | **17/17 PASS**（INV1–INV4 全綠） | 控制台輸出（`ISO_ROOT=D:\AI_Cache\temp\p3h19_iso_20261028-175430`） |
| **原始 84 合計** | **84** | **83/84 PASS** | 同上 |
| E4c 專項 | 12 | **12/12 PASS** | `TEST_RESULTS_PHASE20_E4C.json` |
| 重建式回歸 | 32 | **32/32 PASS** | `TEST_RESULTS_PHASE20_REGRESSION.json` |

**T18-14 失敗定性**：`8770=16500->26380 8030=0->0 8022=22592->26888`。測試埠不涉正式埠（`ports_exclude_prod=True`），失敗純因**正式 8022/8770 在測試窗口內被外部輪換**，非程式缺陷。同一套件之 T11/T12（ownership）在 8770 穩定窗口內 PASS，反向佐證。

---

## 五、關鍵發現 1：正式服務被週期性輪換（營運症狀）

本輪多次觀察到正式埠 PID 變動：
- 8022：`22592 → 26888`（adoption 執行期間）
- 8770：`26380 → 16500 → 26380`（ownership 後 / adoption 期間）

排程 `FDE-AI v1.5C Classroom Server` 為 **Ready**，且歷史紀錄顯示其重複間隔為 **PT5M**。高度懷疑：**排程每 5 分鐘觸發啟動器，若無法把現有 8022 判為 OWNED（3-marker 舊契約/E4c 失敗），即重啟 Django → PID 輪換。** 這正是 P3-H 要修的營運症狀，也是 T18-14 失敗的直接原因。

> 未在本輪變更排程或重啟服務；此為唯讀觀察結論，待架構師裁決是否暫停排程做窗口。

## 六、關鍵發現 2：I-11 代理大小寫衝突為「硬阻斷」（必須先修）

- 目前環境同時存在 `HTTP_PROXY`、`HTTPS_PROXY`、`http_proxy`、`https_proxy`（同值 `http://127.0.0.1:58826`）。
- **三個啟動器版本（original / patched-v3 / isolation）皆使用 `Start-Process … -RedirectStandardOutput`**（original L203/211/252；patched-v3 L231/256/297；isolation L230）。
- I-11 實測：在此環境下 `Start-Process -RedirectStandardOutput` **拋出** `Item has already been added. Key in dictionary: 'https_proxy' Key being added: 'HTTPS_PROXY'`，**子程序永不啟動**。
- 現有啟動器僅設 `$handler.UseProxy = $false`（避免使用代理），**未清理大小寫重複的環境變數**；只有 `Test-V15CPhase19FaultExit.ps1` 測試殼在頂部做了清理。
- 移除重複變數後，同一 `Start-Process` 立即成功（I11-3 PASS），環境可復原（I11-4 PASS）。

**結論：若正式維護窗口在此類環境下執行，Django 將無法啟動。** 20-B 前必須二選一：
1. 在啟動器 `Start-Process` 前加入大小寫去重清理（建議），或
2. 保證維護窗口以「無大小寫重複代理變數」的乾淨環境執行，並在 Runbook 前置檢查中驗證。

---

## 七、准入裁決

**CONDITIONAL / NOT APPROVED FOR 20-B。** 阻斷項：

| # | 阻斷項 | 級別 | 處置 |
|---|---|---|---|
| B1 | I-11 代理大小寫衝突使啟動器無法啟動子程序 | **硬阻斷** | 啟動器加去重清理，或保證乾淨環境 |
| B2 | 正式 8022/8770 被週期性輪換（疑排程 PT5M） | 高 | 先根因確認；維護窗口建議暫停排程 |
| B3 | T18-14 於輪換窗口失敗 | 中（環境性） | 穩定窗口重跑，或明列為環境性已知項 |
| B4 | E3 CommandLine 需提升權限 | 中 | 維護窗口以提升權限執行（與排程同身分） |
| B5 | P3-H 工作全為未提交檔 | 中 | 架構師核准後納入版本控制/備份 |

**已達成（可作為准入正面依據）**：原始 84（83/84）、E4c 12/12、重建 32/32、I-01..I-10/I-12 全數有真實通過證據；正式啟動器 SHA 全程不變；模組 0 終止原語；原子寫入 0 壞讀。

---

## 八、停止條件

**本階段完成後停止，等待架構師裁決。未進入第二十階段 B 正式維護窗口，未做任何正式維護操作。**
