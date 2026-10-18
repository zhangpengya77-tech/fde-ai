# FDE-AI-UAS 2.0 · P5 班級結訓成果報告與展示 — 交付報告

- 專案：`D:\FDE-AI-UAS-v2.0`｜分支：`fde-ai-v2.0-dev`｜Git HEAD：`e5c044244475d18930f32e26696d2cf9cf43dfa6`
- 指令來源：教師 P5 正式開發指令（六節，完整未截斷）
- 報告日期：2026-10-13
- **完成等級：`AUTOMATED PASS`**（單元 256 項＋獨立 HTTP 驗收 158 項＋截圖與版面斷言 16 項）
- **人工 iPhone 真機驗收：`PENDING`**（本輪所有手機結果均為 Chrome 390×844 設備模擬，不得視為真實 Safari 驗收）

---

## 〇、指令可辨識性與範圍宣告

本次 P5 指令六節（P5-A 統一口徑／P5-B 班級結訓成果報告／P5-C 成果展示版面／學員成果證據／權限與安全／驗收要求／交付 A–I）內容完整、無截斷處，全數執行。

**範圍宣告**：本輪僅在既有教師後台新增「班級結訓成果報告」與統一待複核口徑；**未重做 P1–P4.2**、**未建立第二套資料管理系統**、**未新增 Migration**、**未修改原始提交或複核流程**。

---

## A. P5-A 統計口徑修正與驗證

### A.1 問題定義

同一份資料在 P3/P4 有兩種呈現，若口徑未明示會讓教師誤讀：

| 位置 | 顯示 | 單位 |
|------|------|------|
| 班級卡片「待複核成果」 | N | **筆**（工作項目數） |
| 學員篩選「有待複核成果」 | N | **人**（涉及學員數） |

原 bug 案例（P4.2 種子 B 班）：成長紀錄待複核 0 筆，但任務提交待複核 1 筆 → 卡片應為 1 筆、篩選應為 1 人；舊實作卡片只算成長紀錄 → 顯示 0，與篩選不一致。

### A.2 修正設計（單一工作項目集合）

在 `student_portal/learning/views.py` 新增（純附加，未刪任何行）：

```python
PENDING_WORK_GROUPS = (("pending_review", "待教師複核"), ("needs_revision", "需要補充"))
PENDING_SOURCE_LABELS = {"成長紀錄": "成長紀錄", "任務": "任務提交"}

def pending_work_group(status_key):
    if status_key == GrowthRecordSubmission.Status.SUBMITTED:      return "pending_review"
    if status_key == GrowthRecordSubmission.Status.NEEDS_REVISION: return "needs_revision"
    return "reviewed"

def build_pending_work_item(*, kind, code, title, student, submitted_at,
                            status_key, url, task_id=None, record_slots=()):
    ...
```

三組定義（教師指令第一節①②③）：

| 組別 | 定義 | 判定 |
|------|------|------|
| `pending_review` 待教師複核 | 尚未有有效教師複核的提交成果 | `status == submitted` |
| `needs_revision` 需要補充 | 已判定需補充 | `status == needs_revision` |
| `reviewed` 已複核 | 已有有效複核紀錄 | `status ∈ {needs_revision, approved, rejected}` |

**統一工作項目集合** = 成長紀錄提交（`GrowthRecordSubmission`）＋ 任務提交（`StudentTaskProgress`），兩者共用同一集合；班級卡片統計**筆數**，學員篩選統計**人數**，僅單位不同。

### A.3 產品改動（附加式）

| 檔案 | 變更 |
|------|------|
| `learning/views.py` | 新增上述常數與函式；`teacher_class_outcomes` 的待複核清單改由 `build_pending_work_item` 產生並累積 `student_work_items`；`student_rows` 新增 `pending_count`（含任務）／`needs_revision_count`；`class_rows` 新增 `pending_count`／`needs_revision_count`／`pending_source_counts`／`pending_student_count` |
| `templates/learning/teacher_class_outcomes.html` | 統計卡標籤明示單位（「班級學員（人）」「待複核成果（筆）」「尚未提交（人）」「已完成八項（人）」）；新增 `.tco-stat-note` 口徑說明列；待複核項加「來源：{{ item.source_label }}」；進度列「待複核 N 筆 · 需補充 N 筆」 |
| `static/learning/teacher-outcomes.css` | 新增 `.tco-stat-note`、`.tco-pending-source` 樣式 |

### A.4 驗證結果

| 驗證 | 結果 |
|------|------|
| `test_teacher_class_outcomes`（P4 20 ＋ P4.1 12 ＋ P4.2 4 ＋ P5-A 4） | **40/40 OK** |
| `verify_p5_consistency.py`（行程內唯讀，A/B/C 三班） | **24/24 PASS** |
| 原 bug 案例複驗（B 班） | 卡片 1 筆 ｜ 篩選 1 人 ｜ 需補充 1 筆 — **一致** |

P5-A 新增 4 項單元測試：`test_pending_card_and_student_filter_share_same_item_set`、`test_pending_source_breakdown_and_units`、`test_needs_revision_counted_separately_from_pending`、`test_pending_work_item_carries_group_and_source`。

---

## B. 班級結訓成果報告頁面（P5-B）

### B.1 入口與路由

| 項目 | 內容 |
|------|------|
| 入口 | 教師後台 `teacher_dashboard.html` 新增「P5 · 班級結訓成果報告」區塊 → 「開啟班級成果報告」 |
| 路由 | `teacher/class-report/`（`teacher_class_report`，未指定班級時自動選第一個授權班級）<br>`teacher/class-report/<str:cohort_id>/`（`teacher_class_report_cohort`） |
| 視圖 | `views.py::teacher_class_report(request, cohort_id=None)`，`@teacher_required`，**只讀彙整** |
| 模板 | `templates/learning/teacher_class_report.html`（新建） |
| 樣式 | `static/learning/teacher-report.css`（新建） |

### B.2 八項必備內容對照（教師指令第二節）

| # | 指令要求 | 實作 | 資料來源 |
|---|---------|------|---------|
| ① | 班級名稱與課程資訊 | `.trp-basic` 的 `<dl>`（班級名稱／編號／狀態／建立時間／學員總人數／報告產生時間）＋「課程資訊」專案方向與培訓來源 chips | `Cohort`、`Enrollment.project_direction`／`training_source` |
| ② | 學員總人數 | `report.student_count`（僅 `active=True` 在學學員） | `Enrollment` |
| ③ | R01–R08 提交統計 | `#report-slots` 表，逐槽 `submitted / total` | `GrowthRecordSubmission` |
| ④ | R01–R08 教師複核統計 | 同表 `reviewed / total`（`status ∈ {needs_revision, approved, rejected}`） | `GrowthRecordSubmission` |
| ⑤ | 五階段學習完成概況 | `#report-stage` 表，僅計 `PhaseProgress.status == COMPLETED`，分母＝班級人數 | `PhaseProgress` |
| ⑥ | 各學員成果摘要 | `#report-students` 逐學員卡片：已提交／已複核／待複核／需補充／五階段完成／證據數＋R01–R08 狀態條 | `GrowthRecordSubmission`、`PhaseProgress`、`Evidence` |
| ⑦ | 待複核及需要補充成果數量 | 摘要卡「待教師複核（筆）」「需要補充（筆）」＋「有待複核成果（人）」 | P5-A 統一口徑 |
| ⑧ | 已有教師評語與回饋 | `#report-feedback` 表：學員／來源／項目／複核結果／評分／教師評語／時間 | `GrowthRecordReview.teacher_note`、`StudentTaskProgress.teacher_note` |

### B.3 誠實性防線（教師指令第二節末）

- 所有內容**只來自既有真實資料**；無資料處一律顯示「**尚無紀錄**」（含「尚無紀錄（此班級目前尚無在學學員）」「尚無紀錄（目前尚無任何教師評語或回饋）」「尚無紀錄（尚無成果證據）」）。
- **未產生任何假成績、假照片、假證照**；`Evidence` 只做既有授權端點的縮圖／連結，不上傳、不複製。
- **未自動生成任何教師評語**：回饋區只取 `GrowthRecordReview.teacher_note` 與 `StudentTaskProgress.teacher_note` 非空者；空白評語的複核紀錄**不進回饋區**（單測 `test_feedback_only_real_notes` 逐字比對）。
- 頁面與報告皆明示：「**『八項已提交』不等於『八項通過』**」「**『證』階段成果不等於取得民航局專業操作證**」。

---

## C. 學員成果與教師回饋展示（P5-C）

### C.1 版面順序（教師指令第三節）

`班級基本資料 → 班級成果摘要 → 五階段學習概況 → R01–R08 成長成果 → 學員成果列表 → 教師回饋`

以 Chrome 實測 `getBoundingClientRect().top` 排序驗證，順序完全一致（見 §F 截圖斷言）。

### C.2 列印功能

- **瀏覽器原生列印**：`<button id="print-report">列印報告</button>` ＋ `addEventListener('click', () => window.print())`。
- **未開發伺服器 PDF 或 PPT 自動生成**：頁面與截圖腳本雙重斷言無 `report.pdf` / `report_pdf` / `jsPDF` / `html2pdf`。
- **print CSS**（`teacher-report.css`）：
  - `@page{size:A4;margin:12mm}` — A4 直式、合理邊界。
  - `@media print` 隱藏 `.topbar`（導覽列）、`.footer`、`.trp-screen-only`、`.trp-toolbar`（篩選器）、`.button`、`.back-link`、`.page-heading`。
  - `.trp-table thead{display:table-header-group}` — 表頭換頁重複。
  - `.trp-table tr`、`.trp-student{break-inside:avoid;page-break-inside:avoid}` — 表格列與學員卡片不跨頁裁切。
  - `.trp-stats` 於列印時固定 4 欄、`.trp-dl` 固定 3 欄，避免行動版單欄在 A4 上過度拉長。

---

## D. A4 列印驗收

以 Chrome DevTools Protocol `Emulation.setEmulatedMedia({media:'print'})` ＋ A4 直式（794×1123 CSS px）模擬列印預覽，結果：

| 驗收項 | 結果 |
|--------|------|
| 無橫向溢出（重要表格不裁切） | PASS — `overflowX=0`、超出元素 0 個 |
| 隱藏導覽列／頁尾／螢幕專用工具列 | PASS — `topbar=none`、`footer=none`、`.trp-screen-only=none` |
| 表頭換頁重複 | PASS — 兩張表的 `thead` 計算樣式皆為 `table-header-group` |
| 分頁不裁切重要表格 | PASS — `break-inside:avoid` 生效（規則存在且無溢出元素） |

產出截圖：`demo/runtime/logs/p5_class_report_a4_print_preview.png`

> 說明：此為**瀏覽器列印媒體模擬**，非伺服器端 PDF 產生器，符合教師指令「優先瀏覽器原生列印與 print CSS；本輪不開發伺服器 PDF 或 PPT 自動生成」。

---

## E. 多班級權限隔離

| 情境 | 實作 | 驗證 |
|------|------|------|
| 教師只能查看授權班級 | 班級清單由 `teacher_cohorts(request.user)` 產生 | PASS |
| 越權班級 | **一律 `raise Http404`**（不洩漏班級是否存在） | PASS（`test_other_cohort_report_is_404`；HTTP 驗收 404） |
| 無任何授權班級 | `context["report"] = None`，顯示「尚無紀錄：目前沒有可查看的班級報告」 | PASS |
| 學員 | `@teacher_required` → **403** | PASS |
| 未登入者 | 重導 `/teacher/login/?next=/teacher/class-report/` | PASS |
| 跨班級教師下載他班證據 | `evidence_download` 沿用既有授權檢查 → **404** | PASS |
| 未登入者下載學員證據 | → **302 重導登入** | PASS |

**證據授權沿用既有端點**：報告只輸出 `{% url 'learning:evidence_download' evidence.evidence_id %}`（圖片加 `?inline=1`），**不產生任何無需登入的公開網址**，頁面內無 `/media/...` 直連（單測與 HTTP 驗收雙重斷言）。

---

## F. DEMO 與手機模擬

### F.1 DEMO 環境

- 以 `demo/tools/start_demo_hold.ps1` 啟動（含 `FDE_DEMO_SIMULATED_INFERENCE=1` 全套 DEMO 環境變數）。
- Django `192.168.1.114:8110`｜Live Backend `192.168.1.114:8111`。
- DEMO DB：`demo/runtime/db/demo.sqlite3`（與正式 `student_portal/db.sqlite3` 完全隔離）。

### F.2 截圖與版面斷言（`demo/tools/p5_screenshot.cjs`，16/16 PASS）

| 斷言 | 結果 |
|------|------|
| 教師可開啟 `/teacher/class-report/` | PASS |
| 桌面 1440 無橫向溢出 | PASS `overflowX=0` |
| 版面順序＝六段（basic→stats→stage→slots→students→feedback） | PASS |
| 班級成果摘要 8 張卡 | PASS |
| R01–R08 表 8 列、五階段表 5 列 | PASS |
| 「列印報告」點擊後**真的呼叫** `window.print()`（stub 計數） | PASS `printCalls=1` |
| 無伺服器 PDF 產生器 | PASS |
| A4 列印預覽無溢出、隱藏 chrome、表頭重複 | PASS ×3 |
| 手機 390×844 無橫向溢出 | PASS `overflowX=0`、越界元素 0 |
| 手機 390×844 摘要卡仍可見、學員成果以卡片呈現 | PASS |
| 手機 390×844 報告頁自身控制項點按高度 ≥44px | PASS（7 項控制項、0 項未達標） |

**產出截圖**（皆位於 `demo/runtime/logs/`）：

| 檔案 | 內容 |
|------|------|
| `p5_class_report_desktop_full.png` | 桌面 1440 全頁（高 2375px） |
| `p5_class_report_iphone390x844.png` | iPhone 390×844 首屏 |
| `p5_class_report_iphone390_full.png` | iPhone 390×844 全頁（高 5793px） |
| `p5_class_report_a4_print_preview.png` | A4 列印預覽 |

**已記錄之既有項（非 P5 範圍）**：`base.html` 共用導覽列（topbar）的 `.brand`、`.link-button`（登出）與 nav 連結高度為 18–34px，屬**全站既有元件**，本輪未改動，僅記錄不納入本頁通過條件。

> ⚠️ **重要聲明**：以上為 **Chrome 390×844 設備模擬 ＋ print media emulation**，**不得**視為真實 iPhone Safari 驗收。**人工 iPhone 真機驗收：`PENDING`**。

---

## G. 回歸測試結果

### G.1 單元測試

| 套件 | 結果 |
|------|------|
| `test_teacher_class_report`（P5-B／P5-C 新建） | **21/21 OK** |
| `test_teacher_class_outcomes`（P4 20 ＋ P4.1 12 ＋ P4.2 4 ＋ P5-A 4） | **40/40 OK** |
| 8 套件完整回歸（P1 學習路徑／P2 證據鏈／班級成果／教師目錄／教師調查／學員任務／成長紀錄／班級報告） | **195/195 OK**（`System check identified no issues`，零新增失敗） |

### G.2 獨立驗收（皆為獨立推導期望值，不引用產品程式碼）

| 腳本 | 結果 |
|------|------|
| `verify_p5_class_report.py`（:8112 獨立測試庫，12 項驗收要求） | **59/59 PASS** |
| `verify_p5_consistency.py`（P5-A 口徑一致性，A/B/C 三班） | **24/24 PASS** |
| `verify_p42_multiclass.py`（P4.2 多班級回歸） | **57/57 PASS** |
| `verify_p5_protected_pages.py`（保護模組與前階段頁面） | **18/18 PASS** |
| `p5_screenshot.cjs`（桌面／手機／A4 版面斷言） | **16/16 PASS** |

**保護模組複驗**（`verify_p5_protected_pages.py` 全數 HTTP 200）：R07 AI 視覺模型中心、R07 資料飛輪倉庫、R07 模型清單、Golden Set 中心、R08 學員回饋分析、M1–M4 槳葉方向辨識頁、P1 五階段學習工作台、P2 成長紀錄儀表板。

### G.3 驗收要求 12 項對照（教師指令第六節）

| # | 要求 | 對應驗證 | 結果 |
|---|------|---------|------|
| ① | 待複核卡片與學員篩選統計口徑一致 | `verify_p5_consistency.py` | PASS |
| ② | 待教師複核與需要補充正確區分 | `test_pending_and_needs_revision_counts`、狀態徽章 | PASS |
| ③ | 班級人數與資料庫一致 | `test_basic_info_and_student_count`、`verify_p5_class_report.py` | PASS |
| ④ | R01–R08 統計與資料庫一致 | `test_slot_stats_match_database`、`verify_p5_class_report.py` | PASS |
| ⑤ | 五階段完成狀態正確 | `test_stage_progress_uses_completed_only` | PASS |
| ⑥ | 教師回饋只顯示真實資料 | `test_feedback_only_real_notes`、`test_feedback_empty_state` | PASS |
| ⑦ | 跨班級報告不可越權 | `test_other_cohort_report_is_404`、HTTP 404 | PASS |
| ⑧ | 學員與未登入者不可查看教師報告 | 403／302 重導 | PASS |
| ⑨ | 無資料空狀態 | `test_empty_cohort_shows_empty_state`、`test_no_cohort_at_all_shows_empty_state` | PASS |
| ⑩ | A4 列印版面 | print CSS 斷言 ＋ A4 媒體模擬截圖 | PASS |
| ⑪ | 390×844 手機模擬 | `p5_screenshot.cjs` 手機斷言 ×4 | PASS |
| ⑫ | P1–P4.2 必要回歸 | 195/195 單元 ＋ 57/57 多班級 ＋ 18/18 保護頁 | PASS |

**本輪驗收不以 HTTP 200 為唯一依據**：所有統計數字皆與資料庫獨立推導值逐項比對；列印與手機項目皆驗證實際計算樣式（`getComputedStyle`）與元素幾何（`getBoundingClientRect`），並實際觸發列印按鈕。

---

## H. 修改檔案與風險

### H.1 修改檔案（P5 範圍）

| 檔案 | 狀態 | 變更 |
|------|------|------|
| `student_portal/learning/views.py` | 修改 | ＋2582 行 / **−0 行**（純附加）。P5-A 統一待複核口徑函式與常數、`teacher_class_outcomes` 統計擴充、`teacher_class_report` 新視圖 |
| `student_portal/learning/urls.py` | 修改 | ＋81 / −0（`teacher/class-report/` 與 `teacher/class-report/<cohort_id>/`） |
| `student_portal/learning/templates/learning/teacher_class_report.html` | **新建** | 報告頁模板（六段版面＋列印按鈕） |
| `student_portal/learning/static/learning/teacher-report.css` | **新建** | 桌面／手機／A4 列印樣式 |
| `student_portal/learning/templates/learning/teacher_class_outcomes.html` | 修改 | P5-A 統計卡單位標示、口徑說明、來源標示 |
| `student_portal/learning/static/learning/teacher-outcomes.css` | 修改 | P5-A 兩條樣式（附加） |
| `student_portal/learning/templates/learning/teacher_dashboard.html` | 修改 | ＋4 / −1（單行替換，加入 P5 報告入口） |
| `student_portal/learning/tests/test_teacher_class_report.py` | **新建** | P5-B／P5-C 單元測試 21 項 |
| `student_portal/learning/tests/test_teacher_class_outcomes.py` | 修改 | ＋4 項 P5-A 測試（共 40） |
| `demo/tools/seed_p42_verify.py` | 修改 | 新增 C 空班級、真實複核／評語／含檔案證據種子 |
| `demo/tools/verify_p5_consistency.py` | **新建** | P5-A 口徑一致性驗收 24 項 |
| `demo/tools/verify_p5_class_report.py` | **新建** | P5 報告 HTTP 驗收 59 項 |
| `demo/tools/verify_p5_protected_pages.py` | **新建** | 保護模組與前階段頁面回歸 18 項 |
| `demo/tools/p5_screenshot.cjs` | **新建** | 桌面／手機／A4 截圖與版面斷言 16 項 |

### H.2 保護項核對（教師指令第五節）

| 保護項 | 本輪修改次數 |
|--------|-------------|
| 新增 Migration | **0**（`migrations/` 最新為 `0019_golden_set_manifest_contract.py`，mtime 2026-10-09，非本輪） |
| 正式資料庫 `student_portal/db.sqlite3` | **0**（mtime 仍為 2026-10-07 19:08:32） |
| R07 模型管理（`vision_center.py`、`vision_rule_templates.py`） | **0**（mtime 2026-10-11／10-08） |
| M1–M4 槳葉辨識、F450 數位孿生、MP12、飛行健康、下載中心、AI 助教 | **0** |
| Cloudflare、Gateway、正式 v1.5C、正式 GitHub Pages | **0** |
| 原始提交與複核流程（`growth_record_detail`、`review_growth_record`） | **0** |
| `git clean` / `reset` / `commit` / `push` / `merge` / `deploy` / R07 `--apply` | **0**（未執行任何一項） |
| 未提交成果保留 | 41 個已追蹤修改 ＋ 132 個未追蹤項目**全部保留** |

### H.3 風險與限制

| 風險 | 等級 | 說明與處置 |
|------|------|-----------|
| iPhone 真機未驗收 | **中** | 本輪僅 Chrome 設備模擬；`REAL DEVICE PASS` 未取得。建議教師以 iPhone Safari 開啟 DEMO 報告頁做人工驗收 |
| 共用導覽列 tap target < 44px | **低** | `base.html` topbar 為全站既有元件，非 P5 範圍；僅記錄，未改動以免影響其他頁面 |
| `demo/` 目錄未被 `.gitignore` 覆蓋 | **低** | `demo/` 為未追蹤（`??`），內含 DEMO DB 與 Chrome 快取。未來若執行 `git add .` 會一併納入，建議日後補 `.gitignore` 規則（本輪未改，避免超範圍） |
| 報告效能 | **低** | 報告為逐班級即時彙整；DEMO 單班 1 人無感。班級人數大時查詢數會線性成長，已用 `select_related` 收斂，暫不最佳化 |
| 行內文字連結（已修） | **已解** | 報告頁「前往既有學員詳情頁」與證據連結在手機上僅 17–21px；已於 `teacher-report.css` 手機區塊加 `.back-link,.trp-student .trp-screen-only a,.trp-evidence-item a{display:inline-flex;align-items:center;min-height:44px}`（僅本頁生效） |

### H.4 開發中自身修正（非產品缺陷）

1. `test_teacher_class_report.py` 首輪 2 項失敗：①證據測試未附實體檔案 → 模板落入「證據檔案尚未處理」分支（已改以 `SimpleUploadedFile` 建立真實 1×1 PNG 證據，並補一項「無檔案時顯示佔位、不得產生連結」測試）；②`assertNotIn("自動生成")` 與頁面說明文案「系統不會自動生成任何教師評語」衝突（已改為逐字比對回饋內容＋檢查 AI 代寫佔位詞）。
2. `verify_p5_consistency.py` 於新增空班級 C 後崩潰（`force_login(None)`）：腳本未涵蓋 C 班授權教師 → 已補 `P42-C → A 師` 映射並加入 `None` 防護（產品邏輯未改）。
3. `verify_p5_protected_pages.py` R08 路徑誤寫 `/teacher/survey-dashboard/`（實際為 `/teacher/surveys/`）→ 已修正。

---

## I. P6 下一階段建議

依現況（P1–P5 全部 `AUTOMATED PASS`，iPhone 真機仍 `PENDING`），建議 P6 聚焦「**教師班級營運決策**」，而非新增資料模型：

1. **P6-A 班級結訓狀態判定與結訓清單**：以既有資料導出「可結訓／待補件／未達標」班級清單（僅新增判定與檢視，不新增資料表、不新增 Migration）。
2. **P6-B 報告批次輸出（多班級）**：一次列印多班級報告（仍走瀏覽器原生列印，以 print CSS 分頁），或匯出單一 A4 摘要頁。
3. **P6-C 待複核工作佇列**：以 P5-A 統一工作項目集合為基礎，提供跨班級「待複核／需補充」佇列與排序（沿用既有複核流程，不另建複核機制）。
4. **P6-D iPhone 真機驗收正式化**：建立真機驗收紀錄檔與可重複流程，讓 `PENDING` 收斂為 `REAL DEVICE PASS`。
5. **技術債（建議先處理）**：`demo/` 目錄納入 `.gitignore`；`base.html` topbar tap target 統一提升至 44px（需評估全站影響，建議獨立一輪）。

> 依教師指令，**完成 P5 後停止，不自行進入 P6**。

---

## 附錄：本輪驗收指令與腳本對照

| 腳本 | 執行方式 | 項數 |
|------|---------|------|
| `demo/tools/verify_p5_class_report.py` | `python demo/tools/verify_p5_class_report.py`（需 :8112 獨立服務） | 59 |
| `demo/tools/verify_p5_consistency.py` | `DJANGO_DB_NAME=<p42_verify.sqlite3> python demo/tools/verify_p5_consistency.py` | 24 |
| `demo/tools/verify_p42_multiclass.py` | `python demo/tools/verify_p42_multiclass.py`（需 :8112 獨立服務） | 57 |
| `demo/tools/verify_p5_protected_pages.py` | `python demo/tools/verify_p5_protected_pages.py`（需 DEMO :8110） | 18 |
| `demo/tools/p5_screenshot.cjs` | `node demo/tools/p5_screenshot.cjs`（需 DEMO :8110） | 16 |
| `manage.py test learning.tests.test_teacher_class_report` | Django 測試 | 21 |
| `manage.py test`（8 套件） | Django 測試 | 195 |

所有腳本皆**不寫入程式碼內憑證**：DEMO 密碼由 `FDE_DEMO_TEACHER_PASSWORD` 環境變數或 `~/.fde-demo-credentials/demo.shared.password.txt`（版本庫外）載入；測試庫腳本內建 DB 路徑安全閘（須含 `p5check`／`p42_verify`／`demo.sqlite3`），拒絕對正式庫執行。

---

**完成等級：`AUTOMATED PASS`**
**人工 iPhone 真機驗收：`PENDING`**
