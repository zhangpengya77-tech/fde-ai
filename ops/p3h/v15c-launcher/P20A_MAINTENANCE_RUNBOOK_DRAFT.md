# P3-H 8022 啟動器維護 Runbook（v1.5C 正式維護窗口）

> **狀態：DRAFT — NOT APPROVED。** 待架構師裁決與核准。本文件描述「受控冷啟動（A）/ 受控收養（B）」兩套方案的維護作業，並列出 E4c 修復後的依賴與防護。

---

## 0. 授權邊界（永遠適用）

- 維護對象：`D:/FDE-AI-Gateway/start_fde_v15c_classroom.ps1`（正式啟動器）。
- 禁止：未經核准修改 Cloudflare Tunnel、8770/8030、正式 DB/媒體/登入頁、Windows 排程語意（除非本 Runbook 明定步驟）。
- 所有變更須先備份、先隔離驗證、後上線；fail-closed 為最高原則（任何不確定 → ABORT，不殺程序）。

## 1. E4c 根因與修復

- **根因**：E4c 將 HTTP 健康檢查與身分識別混用。原 3-marker 契約 `@('FDE-AI','csrfmiddlewaretoken','resend-verification')` 要求 `resend-verification`，但該標記是 `learning/urls.py:20` 的**獨立路由**，**從未內嵌於 `/login/` 頁 HTML**（真實頁僅含 FDE-AI + 渲染後 csrfmiddlewaretoken）。故 3-marker 在正式頁**結構性不可達** → E4c 永遠 False → 死結。
- **修復**：降為 2-marker `@('FDE-AI','csrfmiddlewaretoken')`（權威模組 `V15C-Adoption.ps1` L297 預設 + 修補啟動器 L207 收養呼叫）。HTTP 指紋僅輔助；程序層 E3/E4a/E4b/E5 仍為主要 fail-closed 閘門。
- **驗證**：E4c 12/12 隔離測試通過（含「舊 3-marker 同頁 AllMarkers=False」證實死結、「2-marker 同頁 AllMarkers=True」證實修復、「ADOPTABLE 現可達」）；另重建式回歸 32/32 全綠（所有權 11＋故障矩陣 15＋決策 6，見交付報告 §6；非原始 84 項，原始腳本不可還原）。

## 2. 新補丁 SHA（維護比對用）

| 檔案 | SHA-256 |
|---|---|
| `V15C-Adoption.ps1`（權威） | `7988d8668ba8be71bc656c85625e4bad8867c6fc80a5c4fd7c416ebb64c74fe9` |
| `V15C-Ownership.ps1` | `adf7f8ecd6bcdaf3…`（Phase 19 未改） |
| `start_fde_v15c_classroom.patched-v3.ps1` | `c7bfd55257ab36d03755b7d3860a18c44dcae98b0bdb67dabbd1b88995694a65` |
| `start_fde_v15c_classroom.patched-v3.isolation.ps1` | `c7bfd55257ab36d03755b7d3860a18c44dcae98b0bdb67dabbd1b88995694a65` |
| 正式啟動器（**不得改**） | `a64330ef7a31e6c981fba95117466610af5e5db833d1ddafc8d91dba1c7a7b59` |

> 正式啟動器 SHA 須恆定。若變動，表示未經授權修改，立即停止。

## 3. 依賴模組與單一寫入器

- `V15C-Ownership.ps1`：`Get-V15CProcessInfo`、`Get-V15CListenerPid`、`Write-V15CStateRecord`（原子寫入、單一擁有者、`existing_owner_alive` 永不覆寫）。
- `V15C-Adoption.ps1`：`Get-V15CHealthDetailed`、`Test-V15CAdoptionEligible`（E1..E8）、`Resolve-V15CListenerAction`、`Invoke-V15CAdoptionClaim`（委託寫入器，不直寫）。
- 啟動器依序 dot-source 兩者；狀態紀錄寫入路徑由 `$DjangoPidStateFile`（`django-v15c-pid.json`）決定。

## 4. 維護前檢查（Maintenance Pre-flight）

1. 備份正式啟動器與 `django-v15c-pid.json`（若存在）。
2. 確認 `V15C-Adoption.ps1` / `V15C-Ownership.ps1` SHA 與第 2 節一致。
3. 確認正式啟動器 SHA 與第 2 節一致（未改）。
4. 確認 Windows 排程工作（`fde_v15c_classroom_task.xml`）存在且未變更語意。
5. 確認 8022/8770/8030 當前監聽狀態（基線）。
6. 確認執行身分為**提升權限**（否則 E3 CommandLine 不可讀 → 僅能 ABORT，見第 6 節）。

## 5. A/B 准入（Admission）

- **方案 A（受控冷啟動）準入**：維護視窗內先停止 8022（或確認其未監聽），再以啟動器首次啟動；適用於可容忍短暫停機。
- **方案 B（受控收養）準入**：須全部成立 ——（a）E4c 已修復為 2-marker；（b）啟動器以提升權限執行；（c）目標 listener 通過 E1..E8 全證據；（d）狀態紀錄缺失（`state_record_absent`）方得 ADOPT，既存擁有者紀錄**永不**被覆寫。B 適用於免停機收養。
- **共用底線**：任一閘門缺失 → UNKNOWN → ABORT；絕不殺程序。

## 6. CommandLine 權限（E3）

- `Test-V15CAdoptionEligible` 的 E3 需讀取 listener 的 CommandLine（`manage.py runserver 127.0.0.1:<port>`）。
- **非提升權限**下 `Get-CimInstance`/WMI 讀取他者 CommandLine 可能失敗或被拒 → `E3_commandline_unreadable` → UNKNOWN → ABORT（安全，但不會自動 REUSE/ADOPT）。
- **處置**：維護視窗須以提升權限（與 Windows 排程相同身分）執行啟動器，方能走完 REUSE/ADOPT 完整路徑。排程工作本身即為提升身分，故排程觸發路徑不受影響；手動執行則須「以系統管理員身分執行」。

## 7. 排程防護（Scheduler Guard）

- 排程工作 `fDE-AI-v15C-Classroom-Startup`：`Ready/Highest/admin/Logon+PT5M/IgnoreNew/PT0S`（Phase 1 核實值）。
- 禁止在維護時直接編輯/重設排程語意；若須調整，須經架構師核准並回寫本 Runbook。
- 維護窗口建議：先停用排程 → 執行維護 → 驗證 → 重新啟用排程。

## 8. Proxy / 埠衝突

- 8022 綁定 `127.0.0.1`；確認本機無其他服務搶佔 8022/18770/18022 等。
- Cloudflare Tunnel 僅代理正式 8022；維護時勿改 Tunnel 設定。
- 若採方案 B 收養既有 listener，須先確認該 listener 確為我方 Django（E1/E4 全證據），避免收養 FOREIGN 程序（→ ABORT）。

## 9. 三週期驗收（Three-cycle Acceptance）

- 新補丁上線後，連續 **3 個維護週期**觀察：啟動成功率、狀態紀錄一致性（單一擁有者、無競態）、無非預期 PID 變動、無非預期終止。
- 每週期產出驗收紀錄；3 週期全綠方得解除「CONDITIONAL」。

## 10. 回滾（Rollback）

- 保留上一版 `start_fde_v15c_classroom.ps1` 備份；異常時還原備份並重啟排程。
- 狀態紀錄 `django-v15c-pid.json` 僅在「ADOPT 且全證據」時寫入；回滾不刪除既存擁有者紀錄（防誤殺）。
- 回滾須記錄原因與時間，納入第 9 節驗收。

## 11. 舊版不得直恢問題排程

- 若發現舊版排程/啟動器有「問題行為」（如非預期接管、缺失 fail-closed），**禁止直接還原舊版排程**；須先修復根因（如本 E4c），再以第 5/7 節受控流程上線。

## 12. Tunnel 風險

- Cloudflare Tunnel 為正式對外通道；維護窗口不得異動其設定。
- 若維護涉及 8022 重啟，Tunnel 應自動重連；若 Tunnel 顯示 502/連線異常，優先確認 Django 監聽狀態與本機防火牆，而非改 Tunnel。

---
*DRAFT — NOT APPROVED。待架構師裁決與核准後，方可據此執行第二十階段 B 正式維護窗口。*
