# P3-H Independent v2.0 Local Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立不使用 v1.5C:8022 的 v2.0 本機教學後台候選啟動與隔離驗收方式，供已發布 GitHub Pages 公開站日後安全接線。

**Architecture:** GitHub Pages 保持只提供公開內容與離線提示。v2.0 Django、Live 與入口代理將只在候選埠位啟動，使用獨立 SQLite、media、測試金鑰與明確 Host／CSRF 白名單；不建立 Tunnel、不公開網路。

**Tech Stack:** Django、Starlette Live Backend、Python stdlib 入口代理、PowerShell、SQLite、Node Gateway tests。

**Spec:** 使用者 2026-10-25 指令：不改 v1.5C；公開靜態網站由 GitHub Pages 提供，電腦開機後才開放 v2.0 教學後台。

## Global Constraints

- 禁止修改 v1.5C、8022、正式資料庫、Tunnel、DNS、GitHub Pages。
- 候選服務不得使用 8022、8030、8770；所有資料庫與 media 必須為臨時隔離位置。
- 不在 Git 保存任何密鑰、Cookie、帳密、資料庫或上傳檔。
- Live／Vision／H3 ACTIVE 不對外公開；本階段不部署。
- Commit、Push、Merge、Deploy 僅在教師另行明確批准後執行。

## Review Focus

- 候選啟動器誤用 8022：測試必須拒絕預留正式埠。
- 缺失 Host、CSRF 或 Assertion 設定：候選啟動必須 Fail Closed。
- 入口代理錯信用戶傳入的 Forwarded 標頭：測試必須確認標頭由入口自行重建。
- 學員跨 Cohort 上傳或教師跨班讀取：既有隔離測試必須持續通過。
- 本機服務離線：公開 GitHub Pages 只能顯示離線，不能提交資料。

---

### Task 1: 候選環境契約與埠位保護

**Files:**
- Create: `ops/p3h/p3h-candidate.env.example`
- Create: `ops/p3h/start-p3h-isolated.ps1`
- Test: `ops/p3h/test_p3h_start_contract.ps1`

**Interfaces:**
- Consumes: P3-F 的 Django Host／CSRF 與 Assertion 環境變數契約。
- Produces: 僅供隔離啟動的 Django、Live、Entry 埠位與臨時資料根目錄。

- [ ] **Step 1: 寫入失敗測試**

驗證任何配置使用 `8022`、`8030`、`8770` 或遺漏必要 Host／CSRF／Assertion 設定時，啟動器回傳非零且不建立服務。

- [ ] **Step 2: 執行失敗測試**

Run: `powershell -File ops/p3h/test_p3h_start_contract.ps1`

Expected: FAIL，因啟動器尚不存在。

- [ ] **Step 3: 實作最小隔離啟動器**

使用 `start-p3h-isolated.ps1` 只接受明確的候選埠位與臨時根目錄；拒絕正式保留埠；不得啟動現有服務或改寫排程工作。

- [ ] **Step 4: 驗證測試通過**

Run: `powershell -File ops/p3h/test_p3h_start_contract.ps1`

Expected: PASS。

### Task 2: Django／Live 候選安全鏈路

**Files:**
- Modify: `student_portal/config/settings.py`
- Modify: `student_portal/learning/urls.py`
- Modify: `student_portal/learning/views.py`
- Create: `student_portal/learning/live_assertions.py`
- Modify: `live_backend/app/main.py`
- Modify: `live_backend/app/sessions.py`
- Create: `live_backend/app/live_assertions.py`
- Test: `student_portal/learning/tests/test_p3h_*`
- Test: `live_backend/tests/test_p3h_*`

**Interfaces:**
- Consumes: 已驗證 Django Session／CSRF、StudentProfile、Enrollment、TeacherCohortAccess。
- Produces: 60 秒 HMAC Assertion、Live Session owner 綁定與可信 Gateway 代理驗證。

- [ ] **Step 1: 確認 P3-F 已有測試是否涵蓋**

先執行 Assertion、Session owner、跨 Cohort 與缺失金鑰測試；若已完整通過，只記錄證據，不重複實作。

- [ ] **Step 2: 補足唯一缺口的失敗測試**

只在確有缺口時增加測試，確認 Django 簽發的 Enrollment Claim 可被 Live 驗證。

- [ ] **Step 3: 最小修復**

只移植 P3-F 已驗證的 Assertion／owner 變更；排除 Vision Center、H3 ACTIVE Registry 與任何模型啟用程式。

- [ ] **Step 4: 重跑定向回歸**

Expected: Assertion、CSRF、學生 owner、教師 cohort、普通 Evidence 上傳均通過。

### Task 3: 真實 HTTP 候選驗收

**Files:**
- Create: `ops/p3h/verify-p3h-http.ps1`
- Test: `ops/p3h/verify-p3h-http.ps1`

**Interfaces:**
- Consumes: Task 1 的候選埠位與 Task 2 的安全鏈路。
- Produces: 可重複執行的隔離 HTTP 驗收結果，不接觸正式服務。

- [ ] **Step 1: 寫入驗收情境**

定義登入、CSRF、普通 PDF 上傳、Evidence 內容雜湊、同班教師讀取、跨 Cohort 拒絕、登出拒絕、Live 直連拒絕與上游離線安全失敗。

- [ ] **Step 2: 啟動獨立候選棧並驗收**

所有服務使用臨時 SQLite／media 與新埠位；驗收結束立即停止候選程序並刪除臨時資料。

- [ ] **Step 3: 產出部署候選報告**

列出 PASS／FAIL／NOT TESTED，不把本機 HTTP 宣稱為公網 HTTPS 成功。

### Task 4: GitHub Pages 接線準備與回滾說明

**Files:**
- Create: `docs/deployment/P3H_GITHUB_PAGES_BACKEND_HANDOFF.md`

**Interfaces:**
- Consumes: Task 3 候選驗收與現有 `v2/assets/config.js`。
- Produces: 固定 HTTPS Gateway 啟用後才允許填入的公開站設定、離線行為與回滾程序。

- [ ] **Step 1: 寫入不含機密的接線說明**

說明固定 HTTPS hostname、Named Tunnel、Gateway 唯一公開入口、狀態端點、全頁登入跳轉及離線回退。

- [ ] **Step 2: 核對公開站不含內部位址或憑證**

Expected: `v2/assets/config.js` 在未正式接線時維持空白 URL；不變更已發布 GitHub Pages。

## Execution Handoff

本計畫先完成候選安全驗收；不包含正式 Tunnel、DNS、GitHub Pages 接線或部署。執行時使用 Native 方式逐項測試，任何埠衝突、正式服務偵測或缺失安全設定皆停止並回報。
