# P3-H 第十八階段：中止報告 — 偵測到並行寫入

- 日期：2026-10-27
- 工作樹：`D:\FDE-AI-UAS-v2.0-p3h-local-backend`（分支 `codex/p3h-local-backend`，HEAD `2fd4f2421dc18df761db80e74e6c4f134448feaf`）
- 觸發條款：第十八階段指令「若出現非預期修改或並行寫入，立即停止」
- 結論：**任務 C 完整交付；任務 A／D 設計完成；任務 B 判定 BLOCKED（基線被並行改寫 + 本輪自身缺陷），停止寫入並請求裁決。正式服務與 Git 全程未被本輪修改。**

---

## 1. 停止原因

第十八階段於 11:03 開始，基線核實全部符合（HEAD、分支、`git status` 僅未追蹤項、正式腳本 SHA `a64330ef…`、隔離產物 SHA 與第十七階段交付一致）。

在 11:07–11:14 期間，**本輪未觸碰的 4 個共享產物被外部改寫**：

| 檔案 | 階段開始（11:03 核實） | 現在（11:15 取樣） | 變化 |
|---|---|---|---|
| `V15C-Ownership.ps1` | `d31007a2…` / 9,888 B / 208 行 | `b5b8fcff…` / 18,512 B / 404 行 | **+196 行** |
| `start_fde_v15c_classroom.patched.ps1` | `7082a6ef…` / 17,108 B | `aa467d69…` / 17,840 B | **+732 B** |
| `Test-V15CLauncherOwnership.ps1` | `75626e97…` / 21,609 B / 17 項 | `961ccbef…` / 40,499 B / **27 項** | **+18,890 B** |
| `PATCH.diff` | `277c35d6…` / 3,810 B / 57 行 | `0a4440f4…` / 4,551 B | 重新產生 |

修改時間戳：`patched.ps1` 11:11:07 → `PATCH.diff` 11:11:40 → `V15C-Ownership.ps1` 11:12:11 → `Test-V15CLauncherOwnership.ps1` 11:14:40。

**未被改寫**（仍為真原始檔）：`start_fde_v15c_classroom.original.ps1` = `a64330ef…`（15,766 B，10:28:52）、`fake_manage.py`（10:37:06）。因此修復基準仍然可信。

並行寫入已於 11:14:40 後停止：11:15:59 再取樣，4 檔 mtime 與 SHA 全部不變（靜止 79 秒以上）。

---

## 2. 並行變更的內容（讀碼結論，未修改）

| 變更 | 內容 | 與本輪關係 |
|---|---|---|
| `V15C-Ownership.ps1` 新增 **S7 專案根提示** | 當命令列帶有絕對 `manage.py` 路徑時，必須位於 `$V15Root` 之下，否則直接判 FOREIGN；命令列只有裸 `manage.py`（正式環境實況）時保持中性（`root_hint_absent`） | **互補**：正好補上本輪 E4 想解的「專案實際路徑」缺口，且不會把正式啟動降級 |
| `V15C-Ownership.ps1` 新增 3 個狀態檔函式 | `Read-V15CStateRecord`、`Test-V15CProcessAlive`、`Write-V15CStateRecord`（mutex 保護、原子寫入、`AllowOverwrite` 開關、`existing_owner_alive` 前置條件） | **重疊**：與本輪 `Write-V15CAdoptionState` 功能重複，需合併為單一實作 |
| `patched.ps1` R3 改用 `Write-V15CStateRecord` | 原本裸 `Set-Content` 改為受保護寫入 | **取代**本輪 patched-v2 的基底（v2 由舊 `7082a6ef` 建出，已過期） |
| `Test-V15CLauncherOwnership.ps1` 17 → 27 項 | 擴充測試 | **取代**本輪「重跑原 17 項」的對象；原 17 項已不存在於該檔 |

**關鍵判定**：並行實作**不含**收養邏輯（`patched.ps1` 內無 `EnableAdoption` / `Test-V15CAdoptionEligible`），即它做的是「狀態檔安全寫入」那一半，本輪做的是「受控收養判定」那一半。兩者設計上互補，但落在同一批檔案上，形成**同一階段被兩個實作同時推進**的衝突。

---

## 3. 本輪已完成 / 未完成

### 已完成（產物均為本輪新建，未被並行寫入觸及）

| 檔案 | bytes | SHA-256 | 說明 |
|---|---:|---|---|
| `V15C-Adoption.ps1` | 23,062 | 見 §7 | 受控收養模組：E1–E8 八項證據 + 純決策函式 + 狀態寫入器 |
| `fake_project.py` | 2,039 | 見 §7 | 隔離測試用假入口（v15c 指紋 / generic 兩種模式） |
| `start_fde_v15c_classroom.patched-v2.ps1` | 18,771 | `19124aed…` | 在舊 `7082a6ef` 基底上加收養分支（**基底已過期，需重掛**） |
| `PATCH-v2.diff` | 5,494 | 見 §7 | patched-v2 vs original，75 行 / 3 hunks |
| `Test-V15CPhase18Adoption.ps1` | 29,472 | 見 §7 | T18-1..T18-14 + A1..A6 + S1..S4，共 25 項 |
| `TEST_RESULTS_PHASE18_2026-10-27.{log,json}` | 1,840 / 11,022 | 見 §7 | 11:14 執行結果（**部分無效，見 §4**） |

### 未完成（因停止條款）

- 任務 B 的完整驗收（需在穩定基線上重跑）。
- 任務 D 的最終推薦需在衝突解除後重驗。

---

## 4. 測試結果（11:14 執行，25 項：20 PASS / 5 FAIL）— **部分無效，不可作為驗收證據**

### 4.1 有效部分（與共享檔案無關，可採信）

| ID | 情境 | 結果 |
|---|---|---|
| T18-3 | 狀態檔缺失：方案 A → ABORT／方案 B → ADOPT | **PASS** |
| T18-4 | 狀態檔損壞 → UNKNOWN，不嘗試收養，存活 | **PASS** |
| T18-5 | PID 重用（created_at 2000-01-01）→ UNKNOWN，存活 | **PASS** |
| T18-6 | 建立時間偏移 5 秒 → UNKNOWN，存活 | **PASS** |
| T18-7 | 同 Python 不同專案 → FOREIGN，不收養，存活 | **PASS** |
| T18-8 | 命令列不可讀 → UNKNOWN，不收養，存活 | **PASS** |
| T18-9 | 健康檢查失敗 → UNKNOWN，不收養，存活 | **PASS** |
| T18-12 | FOREIGN／UNKNOWN 不終止 | **PASS** |
| T18-14 | 正式 8022／8770／8030 不受影響 | **PASS** |
| A1 | 健康 200 但無專案指紋 → UNKNOWN | **PASS** |
| A2 | 只有 PID + 健康 → UNKNOWN | **PASS** |
| A3 | 只有 Python 路徑（shim 不符）→ UNKNOWN | **PASS** |
| A4 | `manage.py` 身分不符 → UNKNOWN | **PASS** |
| A5 | 偵測到另一個啟動器進程 → UNKNOWN | **PASS** |
| A5b | 實例 mutex 被其他執行緒持有 → UNKNOWN | **PASS** |
| A6 | 狀態寫入器拒絕覆寫既有紀錄 | **PASS** |
| S1 | patched-v2 已接上收養分支 | **PASS** |
| S2 | AST：`Stop-Process` 共 2 個、**0 個指向 `$django`** | **PASS** |
| S3 | patched-v2 ASCII-only、無 BOM | **PASS** |
| S4 | 正式啟動器 SHA 全程未變 | **PASS** |

其中 A1–A6 直接證明指令要求：「不得只憑健康檢查 200、Python 路徑或 PID 單一訊號完成收養」——六種單一訊號情境全部回傳 UNKNOWN。

### 4.2 無效／失敗部分（歸因：**本輪自身缺陷**，非並行變更造成）

| ID | 現象 | 根因 |
|---|---|---|
| T18-1 | `verdict=UNKNOWN … health_failed status=200` | 測試傳入 `-HealthMarker 'P3H18-MARKER'`，但 `fake_project.py` 的 v15c 頁面**未包含該字串**（只含 `FDE-AI` / `csrfmiddlewaretoken` / `resend-verification`）。HTTP 確實回 200，是標記缺失導致 `Test-V15CHealth` 的 `markerOk=false` |
| T18-2 | 收養判定 `ADOPTABLE`、決策 `ADOPT`、狀態檔已寫入，但事後 `Test-IsV15CDjango` 仍 UNKNOWN | 同上（收養本身成功，後續 OWNED 驗證被同一標記缺陷擋住） |
| T18-10 | actions=ABORT×3 | 同上 |
| T18-11 | OWNED → 未達成 | 同上 |
| T18-13 | 停止→重啟後 `wrote=True` 但 `restart_verdict=UNKNOWN` | 同上 |

**這 5 項是 `fake_project.py` 的頁面內容缺一個標記所致，一行可修。** 但因基線已被並行改寫，此時重跑所得結果會混用「本輪 Adoption 模組 + 外部 Ownership 模組（b5b8fcff）+ 外部測試檔（961ccbef）」，**無法作為第十八階段驗收證據**，故不重跑。

### 4.3 額外觀測

- 正式 8022 在測試期間由 27520 → 20576 變動，來源仍是正式排程的既有自傷循環（非本輪測試）。
- 本輪測試全程只使用 18022／18023／18024／18099，且只終止自己啟動的程序。

---

## 5. 任務 C：Tunnel `Stop-Process` 風險審核（**完整交付，唯讀**）

審核對象：`D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1`（SHA `a64330ef…`，未修改）。

### 5.1 全檔終止呼叫清單（僅 3 處）

| 行 | 呼叫 | 目標 |
|---|---|---|
| 192 | `Stop-Process -Id $django.OwningProcess -Force` | **8022 listener**（本次缺陷根源，Phase 17 已設計移除） |
| 246 | `Stop-Process -Id $existingTunnel.ProcessId -Force` | 既有的 cloudflared |
| 268 | `Stop-Process -Id $startedTunnel.Id -Force` | 本輪剛啟動但未產出 URL 的 cloudflared |

### 5.2 逐項確認（對應指令七問）

**（1）Stop-Process 的實際目標**

- 第 246 行：`$existingTunnel` 來自
  ```powershell
  $existingTunnel = Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" |
    Where-Object { $_.CommandLine -match "127\.0\.0\.1:$DjangoPort" } | Select-Object -First 1
  ```
  目標是「名為 cloudflared.exe 且命令列指向 127.0.0.1:8022」的進程。
- 第 268 行：`$startedTunnel` 是同一輪 `Start-Process -PassThru` 回傳的**自身子進程**。

**（2）PID 來源與保存方式**

- 第 246 行：PID **每次執行時由 CIM 即時查詢**取得，不是從狀態檔讀出。
- 第 268 行：PID 來自本輪 `-PassThru` 的 Process 物件。
- `tunnel-state.json` 的實際欄位只有 `failure_count`、`last_tunnel_attempt`、`last_successful_tunnel`、`rate_limit_until`——**不保存任何 PID**。因此不存在「從狀態檔讀到過期 PID 去殺」的路徑。

**（3）是否核對程序建立時間**：**兩處都沒有**。

**（4）是否核對命令列**：第 246 行**有**（`127.0.0.1:8022`）；第 268 行**沒有**（也不需要，是自己剛起的子進程）。

**（5）是否可能誤殺其他專案**

- 第 246 行：誤殺條件是「另一個 cloudflared.exe 也指向 127.0.0.1:8022」。若真存在，它隧道的仍是**同一個 Django**，殺掉屬於預期清理，不影響其他專案。**不會**誤殺指向其他埠／其他專案的 cloudflared（命令列過濾已排除）。唯一未驗證的是 `ExecutablePath`（僅憑 `Name`），理論上一個被改名為 `cloudflared.exe` 的無關程式若命令列也含 `127.0.0.1:8022` 才會誤判——機率極低。
- 第 268 行：只殺自己剛啟動的子進程，不涉及其他專案。

**（6）是否存在 PID 重用風險**

- 第 246 行：**無**。PID 與「name + command line」在同一筆查詢中同時取得，中間無時間差可利用。
- 第 268 行：**存在一個窄窗口**。殺戮發生在最多 60 秒的輪詢之後；若 cloudflared 提前退出且 Windows 在該窗口內把同一 PID 分配給無關進程，`Stop-Process -Id` 就會打到別人。機率極低（需秒級 PID 重用），但屬真實風險。

**（7）是否需要獨立修復階段**

- **需要，但不緊急，且與 8022 缺陷不同源。** 建議的最小修法（兩行，未實作）：
  ```powershell
  # 第 268 行改為：先確認仍存活，再用物件終止（免疫 PID 重用）
  if ($startedTunnel -and -not $startedTunnel.HasExited) { $startedTunnel.Kill() }
  ```
- 第 246 行可選擇性加上 `ExecutablePath` 核對，屬加固而非必要。

### 5.3 結論

**Tunnel 的兩處 `Stop-Process` 不具備 8022 缺陷的性質**（不是「路徑相等」判斷、不依賴狀態檔 PID、有命令列或父子關係約束）。風險等級：第 246 行 **低**、第 268 行 **低（窄窗口 PID 重用）**。建議另立小階段處理，不應與 8022 修復綁在一起。

---

## 6. 任務 D：兩套正式維護方案（**設計完成，未執行；待衝突解除後重驗**）

### 6.1 方案 A：短暫停機切換

| 步驟 | 動作 |
|---|---|
| A1 | `Disable-ScheduledTask -TaskName 'FDE-AI v1.5C Classroom Server'` |
| A2 | 備份正式腳本至 `D:\FDE-AI-Gateway\backups\<戳>\`，記錄 SHA |
| A3 | 部署 `V15C-Ownership.ps1`、`V15C-Adoption.ps1`、`patched.ps1`（`$EnableAdoption = $false`） |
| A4 | 記錄 8022 PID → 先以 `/login/` 確認是 Django → `Stop-Process -Id <PID>` |
| A5 | 手動執行一次啟動器（自行啟動 Django 並寫入狀態檔） |
| A6 | 再執行一次 → 期望 `8022 OWNED … reuse` 且 PID 不變 |
| A7 | `Enable-ScheduledTask`，觀察 3 個週期（15 分鐘） |
| A8 | 端到端驗收（登入／成長記錄／RAG／tunnel） |

### 6.2 方案 B：不中斷收養切換

| 步驟 | 動作 |
|---|---|
| B1 | `Disable-ScheduledTask` |
| B2 | 備份正式腳本 |
| B3 | 部署三個模組 + `patched-v2.ps1`（`$EnableAdoption = $true`） |
| B4 | **提權執行唯讀證據探針**（只讀，不動 8022），必須輸出 `ADOPTABLE`；否則改走方案 A |
| B5 | 手動執行一次啟動器 → 期望 `startup.log` 出現 `8022 ADOPTED …`，狀態檔建立且 pid／created_at 相符 |
| B6 | 再執行一次 → 期望 `8022 OWNED … reuse`，PID 不變 |
| B7 | `Enable-ScheduledTask`，觀察 3 個週期 |
| B8 | 端到端驗收 |

### 6.3 逐項比較

| 維度 | 方案 A（停機切換） | 方案 B（不中斷收養） |
|---|---|---|
| **風險** | 中。停止 8022 後若啟動失敗，服務處於**已停**狀態，必須立即回滾或手動拉起 | 低。證據不足時啟動器只中止、**不殺不動**，服務維持原狀 |
| **停機時間** | 約 30–120 秒（Django 啟動 + `Wait-Http` 30 秒 + RAG／tunnel 重用） | **0 秒** |
| **必要權限** | 系統管理員（停用排程、停止 8022、寫入 `D:\FDE-AI-Gateway`） | 同左（另需提權以讀取 8022 的 CommandLine／ExecutablePath） |
| **前置檢查** | 確認 8022 PID 為 Django（`/login/` 200 且含 `FDE-AI`）、備份 SHA 相符 | 除上述外，**必須**先跑證據探針取得 `ADOPTABLE`；`mutex` 可獨占、無第二個啟動器進程 |
| **操作順序** | 停排程 → 備份 → 部署 → **停 8022** → 啟動 → 驗證 → 開排程 | 停排程 → 備份 → 部署 → **證據探針** → 收養 → 驗證 → 開排程 |
| **回滾方法** | 還原原始腳本 SHA → 刪模組與狀態檔 → 開排程 → 手動執行一次 | 同左（收養未改變進程，回滾只還原檔案） |
| **失敗時是否可能恢復 5 分鐘誤殺循環** | **只有回滾（還原原始腳本）才會恢復循環**；方案本身失敗不會恢復循環 | 同左 |

### 6.4 推薦

**推薦方案 B，並以方案 A 作為 B4 證據探針未通過時的後備**（即「B 優先、A 兜底」複合方案）：

1. B 的失敗模式是 fail-safe——證據不足就中止，服務完全不動，可無損退回 A。
2. B 停機 0 秒，對課堂使用無感。
3. A 的唯一優勢是不依賴證據鏈，但代價是把「服務已停」的風險引入窗口。
4. 兩案的回滾成本相同，且**只有還原原始腳本才會讓誤殺循環復現**——這一點必須在窗口前向教師明示。

**但此推薦目前為設計結論**：B 的關鍵前提「提權下證據探針可得 `ADOPTABLE`」在本輪無法驗證（本 session 非提權，讀不到 8022 的 CommandLine／ExecutablePath），已列為 NOT TESTED。窗口第一步必須先跑該探針。

---

## 7. 雜湊清單（本輪產物）

| 檔案 | bytes | SHA-256 |
|---|---:|---|
| `V15C-Adoption.ps1` | 23,062 | `15b1e0282c6a209392d25db03fb2a25dce6399fac78f64721349f66f014e9343` |
| `fake_project.py` | 2,039 | `716459fa9550cd86208cbbad0f1b45ab2acbd70fd101c00fb7964716a30405ce` |
| `start_fde_v15c_classroom.patched-v2.ps1` | 18,771 | `19124aed6aa659a515e64f43e2bfc25e102e92d0241819944be381314c13268c` |
| `PATCH-v2.diff` | 5,494 | `1e8e4900e08d62b427508c243abd0eb5c6c34335ca89dbb78e36af4f950f1c1d` |
| `Test-V15CPhase18Adoption.ps1` | 29,472 | `ad540262e35c5fe2e3eff37690f227b4984774d9124c6155119976fa13ace47a` |
| `TEST_RESULTS_PHASE18_2026-10-27.log` | 1,840 | `3497cdbb823e2943d35d8765bdfc4542763916b4e331430a4cb081aa66284e6c` |
| `TEST_RESULTS_PHASE18_2026-10-27.json` | 11,022 | `d24c5bc3e6d3a46dd9596ebb6817009bcf439afc5b3a576dbd0b7955f72400e0` |

全部為 `sha256sum` 實測值，無推測。

**未變更（真原始檔）**：`start_fde_v15c_classroom.original.ps1` = `a64330ef7a31e6c981fba95117466610af5e5db833d1ddafc8d91dba1c7a7b59`（15,766 B）。
**正式檔**：`D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1` = `a64330ef…`，15,766 B，LWT `2026-10-11 12:48:53`——**與階段開始時完全相同**。

---

## 8. PASS／FAIL／BLOCKED／NOT TESTED

| 分類 | 數量 | 說明 |
|---|---:|---|
| **PASS** | 20 | T18-3/4/5/6/7/8/9/12/14、A1–A6（含 A5b）、S1–S4（明細見 §4.1） |
| **FAIL** | 5 | T18-1/2/10/11/13，**根因是本輪 `fake_project.py` 頁面缺少 `P3H18-MARKER` 標記**，非並行變更造成 |
| **BLOCKED** | 4 | B-1 任務 B 完整驗收：基線被並行改寫（4 檔 SHA 變動），結果無法歸屬<br>B-2 `patched-v2` 基底過期：由舊 `7082a6ef` 建出，需重掛到新 `aa467d69`<br>B-3 狀態寫入器重複：本輪 `Write-V15CAdoptionState` 與外部 `Write-V15CStateRecord` 需合併<br>B-4 任務 D 最終推薦：需在衝突解除後重驗 |
| **NOT TESTED** | 3 | N-1 提權下對正式 8022 的證據探針（本 session 非提權，CommandLine／ExecutablePath 讀不到）<br>N-2 排程實際觸發 patched-v2（禁止修改排程）<br>N-3 以正式 `FDE-AI-v1.5\.venv` 跑端到端收養（本輪用 `.test-temp` 建立的隔離 venv） |

---

## 9. 正式服務與 Git 最終狀態

| 項目 | 狀態 |
|---|---|
| 8022 | Listening；`/login/` 200、含 `FDE-AI`；PID 於本輪期間 27520 → 20576（既有自傷循環，非本輪） |
| 8770 | Listening，PID 14124，`/api/rag/health` 200；全程未變 |
| 8030 | 未監聽；全程未變 |
| 8140／8141／8142 | 未監聽 |
| 排程 | `FDE-AI v1.5C Classroom Server` = Ready，`PT5M` 未改，user=admin／RunLevel=Highest |
| 正式啟動器 | SHA `a64330ef…`、15,766 B、LWT 2026-10-11 12:48:53——未變 |
| `D:\FDE-AI-Gateway` 寫入 | **無**（本輪未寫入任何檔案） |
| Git | HEAD `2fd4f24` 未變；**0 個已追蹤檔案被修改**；僅新增未追蹤 `ops/p3h/v15c-launcher/` 與本報告；未 commit／未 push |
| 本輪終止的程序 | 僅測試自行啟動的 18022／18023／18024 listener |

---

## 10. 裁決需求（4 項）

1. **哪一份實作為權威？**
   - 外部版：`V15C-Ownership.ps1 b5b8fcff`（S7 專案根提示 + `Write-V15CStateRecord` 原子寫入）+ `patched.ps1 aa467d69` + 27 項測試；
   - 本輪版：`V15C-Adoption.ps1`（E1–E8 收養判定）+ `patched-v2 19124aed`（收養分支）。
   - 兩者互補但檔案重疊。建議：**以外部版為基底，把本輪收養模組掛上去**，並把兩個狀態寫入器合併為一個。

2. **是否允許本輪修復自身缺陷並在穩定基線上重跑？**
   - 待修：`fake_project.py` 的 v15c 頁面補上 `P3H18-MARKER`（一行）。
   - 待重掛：`patched-v2` 改以 `aa467d69` 為基底重建。

3. **是否把 `V15C-Ownership.ps1` 回退到 `d31007a2`？**
   - 回退可恢復第十七階段已驗收基線，但會丟失 S7 與原子寫入（兩者都是真實改進）。**不建議回退**，建議合併。

4. **Tunnel 第 268 行是否另立小階段修復？**
   - 兩行改動即可消除窄窗口 PID 重用風險，與 8022 修復無耦合。

---

## 11. 合規聲明（本輪未執行清單）

- 未停止／重啟 8022
- 未修改正式 v1.5C 啟動器（SHA 前後一致）
- 未修改 Windows 排程
- 未修改 8770／8030
- 未修改正式資料庫
- 未修改 Cloudflare Tunnel／DNS
- 未 Commit／Push／Merge／Deploy
- 未以 `Stop-Process` 終止任何未知程序（僅終止自己啟動的測試 listener）
- 未繞過 safe-delete
- 未修改本輪偵測到的並行變更檔案（`V15C-Ownership.ps1`、`patched.ps1`、`Test-V15CLauncherOwnership.ps1`、`PATCH.diff`）
