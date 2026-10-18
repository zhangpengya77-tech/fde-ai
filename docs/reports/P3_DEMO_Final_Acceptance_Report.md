# P3 教師端班級成果總覽 — DEMO 最終驗收報告

- 日期：2026-10-13
- 專案：D:\FDE-AI-UAS-v2.0（分支 fde-ai-v2.0-dev）
- 驗收對象：P3「教師端班級學習成果總覽」（沿用 P1 五階段工作台、P2 任務成長證據鏈，未建第二套系統）
- 驗收環境：隔離 DEMO（Django :8110 綁 192.168.1.114、Live :8111），DEMO DB = demo/runtime/db/demo.sqlite3（與正式 DB 完全隔離）
- 完成等級：**AUTOMATED PASS（含 DEMO 端到端層）**；**人工 iPhone Safari 真機驗收：PENDING**
- 總結果：指令 12 項驗收 **全部 PASS**（其中 1 項發現 P3 專屬手機版面缺陷，最小修正後重測通過）；彙總計數 34/34 + 8/8 + 12/12 + 47/47 + 21/21，零新增失敗

---

## A. DEMO 驗收逐項 PASS／FAIL

| # | 驗收項 | 結果 | 證據 |
|---|--------|------|------|
| 1 | 啟動隔離 DEMO，確認正式服務未受影響 | **PASS** | DEMO :8110/:8111 HTTP 200；正式服務 :8022 HTTP 200（唯讀探測）；正式 DB `student_portal/db.sqlite3` mtime 仍為 2026-10-07 19:08（未動）；DEMO DB 獨立於 demo/runtime/db/ |
| 2 | DEMO 教師帳號登入「班級學習成果」 | **PASS** | 登入成功；`/teacher/class-outcomes/` HTTP 200，h1＝「班級學習成果總覽」 |
| 3 | 教師只能看到自己授權的班級 | **PASS** | 頁面班級＝['F450-DEMO-2026']，授權（learning_teachercohortaccess）＝['F450-DEMO-2026'] |
| 4 | 班級人數與實際 active 學員一致 | **PASS** | 頁面「學員 1 人」｜DB active enrollment = 1（DEMO-STU-0001 / enrollment 1） |
| 5 | 每位學員 R01–R08 已提交/已複核/待複核數量 | **PASS** | 逐槽 8 項狀態與三欄計數（1/0/1）與 DB 完全一致（共 13 項逐項比對全過） |
| 6 | 「已提交」不會誤判為「已通過」 | **PASS** | R07 submitted 槽顯示「待教師複核」，全頁無「✅ 已完成」字樣 |
| 7 | 五階段「完成 N/M 人」符合 PhaseProgress 完成定義 | **PASS** | 5 階段皆 0/1（詳見 C 節） |
| 8 | 任務提交與成長紀錄無重複計數 | **PASS** | 詳見 D 節：DEMO task_submitted=[]、成長 1 筆，頁面 1 項＝DB 1 項 |
| 9 | 待複核清單進入既有教師詳情頁，目標學員正確 | **PASS** | 連結 `/teacher/enrollments/1/#growth-records`；詳情頁含 R07 紀錄與既有「保存複核」表單；預期學員 DEMO-STU-0001 正確 |
| 10 | 跨班級越權、學員登入、未登入 | **PASS** | 越權 cohort 篩選→空狀態不洩漏學員；未登入→重導 `/teacher/login/?next=...`；學員登入→HTTP 403 |
| 11 | 390×844 手機模擬版面（不宣稱真實 iPhone Safari） | **PASS（修正後）** | 8/8 PASS，詳見 F 節：初測發現 select 橫向溢出 27px，最小修正 CSS 後 overflowX=0 |
| 12 | 回歸確認 P1、P2、R07、M1–M4 不受影響 | **PASS** | P1 DEMO 47/47、P2 DEMO 21/21（內含 R07 頁、M1–M4 辨識頁、成長紀錄 R01–R08 檢查，全 PASS） |

## B. 班級與學員統計數字的資料依據

DEMO DB 唯讀基準（sqlite3 `file:...?mode=ro` 直連，存證 `demo/runtime/logs/p3_db_ground_truth.txt`）：

```
authorized   = ['F450-DEMO-2026']                       # learning_teachercohortaccess JOIN auth_user
active_counts= {'F450-DEMO-2026': 1}                    # learning_enrollment WHERE active=1
students     = {1: 'DEMO-STU-0001'}                     # enrollment 1 → public_user_id
slots        = R01..R06,R08 = not_started；R07 = submitted
phases       = learn/practice/build/assess/certify 全部 not_started
task_submitted = []                                     # StudentTaskProgress 無 SUBMITTED
```

- 頁面每個數字皆與 DB 基準逐項比對（17 項逐槽比對全部一致）後才計 PASS。
- 計數語意（沿用 P1/P2 既有定義）：`GROWTH_SUBMITTED_STATUSES`＝{SUBMITTED, NEEDS_REVISION, APPROVED, REJECTED}；`GROWTH_REVIEWED_STATUSES`＝{NEEDS_REVISION, APPROVED, REJECTED}，故 **reviewed ⊆ submitted**，「已複核」必然也是「已提交」，不會出現已複核＞已提交的矛盾。
- 民主計來源只有 GrowthRecordSubmission（矩陣與三欄計數）；StudentTaskProgress 只用於待複核清單，兩者不混算。

## C. 五階段完成定義核對

- 唯一計入條件（views.py:3547-3548，`teacher_class_outcomes`）：
  `phase.status == PhaseProgress.Status.COMPLETED` 才 `done += 1`。
- `PhaseProgress.Status` 四態：not_started / in_progress / completed / skipped；**僅 completed 計入**，「進入階段」（in_progress）與「未開始」皆不計——不存在把 in_progress 算成完成的可能。
- 分母 total：每位 active 學員一列（確保 `PhaseProgress.objects.get_or_create(enrollment, phase)` 五階段列存在後計數），故「完成 N/M 人」的 M＝班級 active 學員數，與人數徽章同源。
- DEMO 現況：5 階段全部 not_started → 頁面 5×「完成 0/1 人」與 DB (0,1) 一致，PASS。
- 已知限制（如實記錄）：DEMO 種子資料尚無 completed/in_progress 樣本，「in_progress 不計入完成」此路徑由單元測試（12/12 內含分母與計數斷言）覆蓋，DEMO 層以現況 0/1 驗證語意未誤把進入階段算完成。

## D. 待複核重複計數檢查

- `pending_rows` 由兩個**互斥** queryset 組成，無 join、無 union、無重疊：
  1. `GrowthRecordSubmission.status == SUBMITTED`（成長紀錄）
  2. `StudentTaskProgress.status == SUBMITTED`（任務）
- 每筆最多出現一次；DEMO 實測頁面項目序列 `[('成長紀錄','DEMO-STU-0001','R07')]` === DB 基準序列（逐項比對 + 無重複元素斷言），PASS。
- 與統計數位的分工：矩陣三欄（已提交/已複核/待複核）只讀 GrowthRecordSubmission；待複核清單額外納入任務提交，兩處分開呈現，不會互相重複計數。
- 若日後同一學員同時有 R07 submitted 與任務 submitted，清單會列 2 項但類型不同（成長紀錄/任務），不構成同一項目重複。

## E. 教師權限隔離測試

| 情境 | 結果 |
|------|------|
| 教師只見授權班級 | PASS（授權清單唯一，頁面班級清單與之一致） |
| 越權班級篩選（cohort=不屬於自己的 ID） | PASS（空狀態、不顯示任何學員） |
| 未登入存取 `/teacher/class-outcomes/` | PASS（重導 `/teacher/login/?next=/teacher/class-outcomes/`） |
| 學員帳號登入後存取教師頁面 | PASS（HTTP 403） |

- 權限來源完全沿用既有 `teacher_cohorts(request.user)`（P1 既有機制），P3 未新增、未改寫任何權限邏輯。

## F. 手機模擬驗收結果（390×844）

- 方法：Chrome headless + Chrome DevTools Protocol，`setDeviceMetricsOverride(390×844, dsf=2, mobile=true)` + iPhone Safari 17 UA + 觸控模擬。
- **明確聲明：此為 Chrome 設備模擬，未視為、也不宣稱已通過真實 iPhone Safari 驗收；iPhone 真機人工驗收維持 PENDING。**
- 結果 **8/8 PASS**：

| 檢查 | 結果 |
|------|------|
| 教師登入表單可送出（CDP） | PASS |
| 班級學習成果頁可開啟（h1 正確） | PASS |
| 桌面 1440 無橫向溢出 | PASS（overflowX=0） |
| 頁面含人數徽章/矩陣/待複核區塊 | PASS（badge=學員 1 人、matrixRows=1、pendingItems=1） |
| 390×844 無橫向溢出 | PASS（scrollWidth=390 = clientWidth，offenders=0） |
| 390×844 矩陣表轉為學員卡片 | PASS（thead display=none、tr display=grid） |
| 390×844 待複核連結指向既有學員詳情頁 | PASS（`/teacher/enrollments/1/#growth-records`） |
| 390×844 既有學員詳情頁無橫向溢出 | PASS（overflowX=0） |

### 發現的缺陷與最小修正（指令允許範圍內）

- **缺陷**：390×844 下班級篩選 `<select name="cohort">` 原生態寬度 417px，橫向溢出 27px（唯一溢出元件 `select.`）。
- **判定**：P3 專屬檔（`teacher-outcomes.css` 僅被 `teacher_class_outcomes.html` 引用）、純 CSS、無 DB 結構變動、不涉受保護模組 → 屬「可最小修正」範圍。
- **修正**（+2 行，附加式，git diff 0 deletions）：
  ```css
  /* 2026-10-13 DEMO 驗收修正：班級篩選 select 於 390px 原生態寬度溢出 27px，限制不超過欄寬 */
  select[name="cohort"]{max-width:100%;width:100%}
  ```
- **重測**：手機模擬 8/8、P3 單測 12/12、P3 DEMO 34/34，全部重跑通過。
- 排查註記：修正後首輪仍 FAIL，經直接請求 DEMO 確認伺服器已回傳新 CSS，定位為截圖工具持久化 Chrome 使用者目錄的磁碟快取；已在 `p3_screenshot.cjs` 啟動前清理該目錄，屬工具問題而非產品問題。
- 截圖存證：`demo/runtime/logs/p3_class_outcomes_desktop.png`、`p3_class_outcomes_iphone390x844.png`、`p3_student_detail_iphone390x844.png`；日誌 `p3_mobile_simulation.log`。

## G. 實際修改檔案及回歸結果

### 本輪（DEMO 驗收輪）實際修改

| 檔案 | 變更 |
|------|------|
| `student_portal/learning/static/learning/teacher-outcomes.css` | +2 行（手機 media query 內 select 寬度限制；P3 專屬檔） |
| `demo/tools/p3_screenshot.cjs` | 新增（390×844 CDP 截圖驗收工具） |

P3 開發輪既有未提交成果（本輪未再改動）：`views.py`（+124 行，`teacher_class_outcomes`）、`urls.py`（+2 行路由）、`teacher_dashboard.html`（+1 行入口）、`teacher_class_outcomes.html`（新增模板）、`test_teacher_class_outcomes.py`（新增 12 測試）、`docs/reports/P3_Teacher_Class_Outcomes_Report.md`。

### 回歸結果（全部重跑，非引用歷史數字）

| 套件 | 結果 |
|------|------|
| P3 單測 `test_teacher_class_outcomes` | **12/12 PASS**（CSS 修正後重跑） |
| P3 DEMO 端到端 `verify_p3_class_outcomes.py` | **34/34 PASS**（修正後重跑） |
| 390×844 手機模擬 | **8/8 PASS** |
| P1 DEMO 回歸 `verify_p1_learning_path.py` | **47/47 PASS**（含成長紀錄 R01–R08 呈現、R07 頁、M1–M4 辨識頁——凍結保護未受影響） |
| P2 DEMO 回歸 `verify_p2_task_record_chain.py` | **21/21 PASS** |

零新增失敗。

### 安全邊界遵守情況

- 未修改正式資料（正式 DB mtime 2026-10-07 未動）、未動 v1.5C／R07／M1–M4／P1／P2／數位孿生／MP12／飛行健康／下載中心／AI 助教。
- 未執行 migration；DEMO DB 僅由頁面既有 `get_or_create` / `ensure_growth_submissions` 冪等補列（P1/P2 同一模式），本輪驗收工具本身只讀。
- 未輪換 DEMO 密碼；未執行 R07 --apply；未執行 git clean/reset/commit/push/merge/deploy；全部未提交成果保留。
- 憑證未寫入程式或報告（工具沿用 env → 憑證檔載入，不回顯）。
- DEMO DB 註記：P2 輪曾冪等播種 12 筆任務定義，本輪未再寫入測試以外的資料。

### Git Status（本輪結束時）

- `M`（既有未提交成果，保留）：`student_portal/learning/views.py`、`urls.py`、`teacher_dashboard.html`、`teacher-outcomes.css` 等多個 P0–P3 檔案。
- `??`（未追踪新增）：`demo/tools/`（含本輪 `p3_screenshot.cjs`）、`docs/reports/`、`student_portal/learning/growth_task_map.py` 等。
- 本輪未執行任何 git 提交類操作。

## H. P4 下一階段最小增量開發建議

依「進度 → 下一步指令」原則（fde-dev-next-step 技能）整理。P3 已達 AUTOMATED PASS + DEMO 層，**下一最低成本、最高價值步驟是真人驗收收尾**，之後再由教師選定一項最小增量：

| 候選 | 內容 | 性質 |
|------|------|------|
| **P4-A（建議優先）** | P3 頁面 iPhone Safari 真機人工驗收：390×844 開啟 `/teacher/class-outcomes/`，走 待複核連結→詳情頁→保存複核 回跳，確認無橫向溢出、點擊區域 ≥44px | 零程式開發，通過後 P3 可升 REAL DEVICE PASS |
| P4-B | 待複核清單依提交時間/類型排序與篩選（P3 頁面內純讀取增強，不動 DB） | P3 專屬小增量 |
| P4-C | 班級級「目前階段」彙整提示（複用既有 `ordered_phase_progress` / current_stage 邏輯，只加彙總顯示） | P3 專屬小增量 |
| P4-D | 班級學習成果列印樣式（`@media print`，唯讀） | P3 專屬小增量 |

**下一則可直接貼回給代理的指令（模板）**：

```
【FDE-AI-UAS 2.0｜P4 最小增量開發指令】
專案目錄：D:\FDE-AI-UAS-v2.0
本輪範圍（擇一，YAGNI）：
1. iPhone 真機人工驗收 P3（驗收後停止，不開發新功能）；或
2. P4-B／P4-C／P4-D（指定其一）。
邊界（不變）：
- 在既有教師後台／P3 頁面內附加式開發，不建第二套系統，不改 DB 結構，不做 migration。
- 不修改正式資料、v1.5C、R07、M1–M4、P1、P2、數位孿生、MP12、飛行健康、下載中心、AI 助教。
- 不輪換 DEMO 密碼、不執行 R07 --apply、不 git clean/reset/commit/push/merge/deploy。
- 憑證不得寫入程式或報告。
- DEMO 一律以 demo/tools/start_demo_hold.ps1 啟動（背景常駐）。
報告格式（AGENTS.md §16）：修改檔案／完成功能／測試結果／已知問題／Git Status。
完成標準：自動測試通過只能寫 AUTOMATED PASS；iPhone 真機通過才允許寫 REAL DEVICE PASS。
```

---

## 附註

1. **技能安裝**：`FDE-Dev-Next-Step/SKILL.md` 源檔案於本機全盤搜尋不存在，已依指令所述「進度 → 下一步指令」原則**代建**並安裝於 `C:\Users\admin\.workbuddy-ai\skills\fde-dev-next-step\SKILL.md`（frontmatter 含 `agent_created: true`）。人工安全審計 P2 級（純 Markdown 指令，無腳本／無網路／無憑證／無破壞性操作）。如教師持有原版，提供後可直接覆蓋。往後每次收到教師貼上的開發進度，將依該技能原則處理。
2. **iPhone 真機驗收：PENDING**。本報告所有 PASS 均為自動化 + DEMO 層證據。
3. 存證清單（`demo/runtime/logs/`）：`p3_demo_verification.log`（34 項）、`p3_mobile_simulation.log`（8 項）、`p3_db_ground_truth.txt`、`p3_db_snapshot.txt`、`p3_class_outcomes_demo.html`、`p3_student_detail_demo.html`、3 張 PNG 截圖、`p1_regression_p3_round.log`、`p2_regression_p3_round.log`。
