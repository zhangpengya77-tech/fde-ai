# P3 教師端班級學習成果總覽與學員能力追蹤 — 交付報告

- 日期：2026-10-13
- 分支：`fde-ai-v2.0-dev`（HEAD 仍為 `e5c0442`，本輪未 commit／push／merge／deploy）
- 依據：教師 P3 正式開發指令＋補充確認（功能九項）
- 完成標準：AUTOMATED PASS（自動化測試）
- DEMO 服務驗收／iPhone 真機人工驗收：**PENDING**（指令未要求 DEMO 開機；沙箱無法可見 Chrome 擷圖、無真機）

---

## A. 開發前盤點結果（對照九項功能）

| # | 功能 | 既有實現 | 處置 |
|---|---|---|---|
| 1 | 教師後台「班級學習成果」入口 | 無 | **本輪新增**（`teacher_dashboard` 加入口區塊） |
| 2 | 顯示教師有權查看的班級／課程 | 有：`teacher_cohorts(user)` 權限模型＋後台班級篩選 | 重用（總覽頁班級切換同模式） |
| 3 | 顯示班級學員人數 | 無（僅學員列表） | **本輪新增**（班級徽章「學員 N 人」） |
| 4 | 各學員 R01–R08 已提交／已複核／待複核數量 | 部分：後台有總數欄，無逐槽矩陣 | **本輪新增**（學員 × R01–R08 狀態矩陣＋三欄計數） |
| 5 | 五階段學習概況 | 學員詳情頁有個人五階段，無班級彙整 | **本輪新增**（班級級五階段完成人數，資料取自 PhaseProgress） |
| 6 | 現有資料能確認的待複核成果 | 部分：後台有待複核計數欄，無清單 | **本輪新增**（清單含成長紀錄＋任務，提交時間，連結到既有複核頁） |
| 7 | 個別學員成果詳情入口 | 有：`teacher_student_detail` | 重用（矩陣每列「查看」） |
| 8 | 連結到既有教師複核頁，不建立新複核功能 | 有：詳情頁 R01–R08 表單 POST 至 `growth_review` | 重用（待複核清單只連回詳情頁 `#growth-records`，本頁零表單、零寫入） |
| 9 | 手機瀏覽器單欄 | 無（既有 14 欄表格手機必溢出） | **本輪新增**（`teacher-outcomes.css`：≤680px 矩陣表轉學員卡片） |

文件與程式差異：無（`docs/architecture/` 六份 P0 架構文件與現況的既有差異屬 P0 以來狀態，本輪不改寫文件）。

---

## B. 實際修改檔案與程式範圍

| 檔案 | 狀態 | 內容 |
|---|---|---|
| `student_portal/learning/views.py` | 修改（附加式） | 新增 `teacher_class_outcomes` 視圖（檔尾 P3 區塊，繁體中文設計約束註解）。diff vs HEAD：**+124 行 / 0 刪除**（P2 後 1884 → 2008 insertions，全附加） |
| `student_portal/learning/urls.py` | 修改（附加式） | 新增路由 `teacher/class-outcomes/`（+2 行 / 0 刪除） |
| `.../templates/learning/teacher_dashboard.html` | 修改 | 頁首加入口區塊（1 個 `survey-dashboard-entry`，純附加 1 行） |
| `.../templates/learning/teacher_class_outcomes.html` | 新增 | 總覽頁模板（班級切換、人數徽章、五階段概況、R01–R08 矩陣、待複核清單、空狀態） |
| `.../static/learning/teacher-outcomes.css` | 新增 | 本頁專用樣式；桌面矩陣表、手機 680px 轉學員卡片單欄 |
| `student_portal/learning/tests/test_teacher_class_outcomes.py` | 新增 | 12 項測試 |

未修改：R01–R08／T01–T12 資料與 schema（無 migration）、教師複核流程（`review_growth_record`／`review_task` 零改動）、學生端、v1.5C、Flight Health、MP12、正式 DB、Cloudflare。

---

## C. 完成功能

1. **班級學習成果總覽頁**（`/teacher/class-outcomes/`）：只列 `teacher_cohorts` 授權班級，支援班級篩選；無權限教師顯示明確空狀態。
2. **學員人數**：每個班級徽章顯示在文學員數（`Enrollment active` 真實計數）。
3. **學員 × R01–R08 矩陣**：逐槽真實狀態（沿用 `student_status_label` 既有詞彙）＋已提交／已複核／待複核三欄計數（語意與既有後台一致： reviewed ⊆ submitted）。
4. **五階段學習概況**：每階段「完成 N / M 人」，取自 `PhaseProgress`（檢視依既有教師詳情頁同一 `get_or_create` 模式補建缺列，分母＝班級人數）。
5. **待複核成果清單**：只列 `status=submitted` 的成長紀錄與任務（現有資料能確認者），含提交時間與學員，統一連結到既有學員詳情頁（成長紀錄帶 `#growth-records` 錨點）；**本頁零表單、零寫入、零新複核路由**。
6. **手機單欄**：矩陣表在 ≤680px 轉為學員卡片（`data-label` 模式，沿用本專案既有 responsive 手法）。

---

## D. 測試結果

| 範圍 | 結果 |
|---|---|
| P3 新套件 `test_teacher_class_outcomes` | **12/12 OK** |
| 相關迴歸（P1 工作台、P2 證據鏈、教師工作流／目錄／調查、學員任務、成長紀錄、任務播種） | **164/164 OK**（含 P3 12 項） |

測試覆盖：未登入重導／非教師 403／越權班級不可見／人數／矩陣狀態與計數／已提交≠已透過／五階段分母與完成數／待複核連結全指向既有詳情頁／空狀態／手機 CSS。存證：本輪命令列輸出（測試數據庫為每次新建之隔離副本，不觸碰正式 DB）。

---

## E. 已知問題與風險

1. P0 基線既有 3 個失敗（test_auth hero 標籤、flywheel「訓練用途」、download-center 標題）本輪未觸及，列待教師裁示（同 P2 報告 E 節）。
2. 待複核任務列只會出現已被學生流程建立 `StudentTaskProgress` 列的提交；尚未初始化任務進度的學員不會產生任務待複核列（成長紀錄列不受影響，因為檢視會 `ensure_growth_submissions`）。
3. DEMO 服務驗收與 iPhone 真機驗收 **PENDING**；在真機通過前不得宣稱 REAL DEVICE PASS。

---

## F. 其他註記

1. 教師指令第二節在「先核對現有」後仍有截斷；本輪已依補充確認之九項功能與盤點程序完成，若補示含追加範圍，依其執行。
2. 教師帳號權限模型不變：非 superuser 教師只看 `TeacherCohortAccess` 授權班級；本頁未放寬任何權限。

---

## G. Git Status

- 分支 `fde-ai-v2.0-dev`，HEAD `e5c0442`（未動）。
- 本輪修改：`views.py` +124/−0、`urls.py` +2/−0、`teacher_dashboard.html` +1/−0（皆附加）；新增 3 個未追蹤檔（模板／CSS／測試）。
- 41 個 P0 起既有未提交修改全部保留；未 commit／push／merge／clean／reset／deploy。
