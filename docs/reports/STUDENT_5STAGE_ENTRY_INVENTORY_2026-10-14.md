# 學員端五階段入口盤點（第一步，唯讀）

日期：2026-10-14
指令依據：教師【學員端五階段統一與頁面精簡調整指令】第一、二節
狀態：**唯讀盤點，未修改任何檔案、未動任何資料庫、未重啟任何服務**
分支：`fde-ai-v2.0-dev`｜HEAD `e5c0442`（歷史基準）

---

## 一、核心發現：目前實際存在「三套」五階段入口，不是兩套

教師指令假設為「原版左側導航」＋「右上角新版五階段工作台」兩套。實際盤點發現
前端平台（`/platform/`，由 Django `platform_entry` 提供，`PLATFORM_ROOT/index.html`）
本身就是一套完整的「學／練／作(or 做)／測／證」左側導航，加上 Django 學員入口的三處
連向新版工作台，合計 **三套並存**：

| # | 名稱 | 位置 | 五階段字樣 | 技術載體 | 資料來源 |
|---|------|------|-----------|---------|---------|
| A | **平台側邊欄五階段導航** | `/platform/` 左側 `#moduleNav` | 學／練／**作**／測／證 | `index.html` + `src/app.js::renderNavigation()` | **靜態示範資料**（`src/platform.js`，含「早安，張同學」等假資料） |
| B | **平台頁面頂部公共導覽** | `/platform/` 頁首 `fde-public-sections` | 學／練／**作**／測／證 | `platform_identity_nav.html`（由 views.py:431 注入） | 連結至平台自己的五個路徑 |
| C | **Django 學員端五階段工作台** | `/student/learning-path/` | 學／練／**做**／測／證 | `student_learning_path.html` | **真實資料**（GrowthRecordSubmission／PhaseProgress／StudentTaskProgress） |

**關鍵結論**：教師指令第二節列出的「原版左側『學→練→做→測→證』」，
在磁碟上實際對應到 A 與 B（字樣為「作」），且其資料是**靜態示範資料、非真實學習紀錄**；
而教師要求「讀取原有八項紀錄的真實狀態」的那一套是 C。
**A/B 與 C 在任何一個頁面上都沒有同時出現過**——教師所描述的「右上角新版五階段入口」
是 C 的入口連結，位於 Django 模板 `base.html` 第 19 行最右側。

---

## 二、完整入口清單（雙入口 → 模板 → 路由）

### 2.1 進入「五階段工作台」（C）的所有入口

| 序 | 出現位置 | 模板／檔案 | 行 | 連結文字 | 路由 |
|----|---------|-----------|----|---------|------|
| 1 | Django 學員頁首導覽（最右側、教師所稱「右上角」） | `templates/learning/base.html` | 19 | 五階段學習工作台 | `learning:student_learning_path_entry` → `/student/learning-path/` |
| 2 | 學員總覽課程卡片（三鈕並列第 1 顆） | `templates/learning/student_dashboard.html` | 10 | 五階段學習工作台 | `learning:student_learning_path` → `/student/courses/<id>/learning-path/` |
| 3 | 平台頁首公共導覽（學員已登入時） | `templates/learning/platform_identity_nav.html` | 11 | 五階段學習工作台 | `workbench_url` ＝ 同上 entry |
| 4 | 平台頁首公共導覽分類列 | `templates/learning/platform_identity_nav.html` | 24–28 | 學／練／作／測／證 | `/platform/courses`、`/platform/simulator`、`/platform/f450`、`/platform/eagle`、`/platform/github` |
| 5 | 平台側邊欄（JS 動態產生） | `src/app.js::renderNavigation()` | 81–93 | 學／練／作／測／證＋任／健／展／師 | `router.hrefFor(key)` → `./courses` 等 |
| 6 | 平台手機選單 | `index.html` | 31–49 | 學／練／作／測／證 | `./courses` 等 |
| 7 | 平台首頁流程圖（非連結） | `index.html`＋`src/app.js::renderDataFlow()` | 202–208 | 學／練／作／測／證 | 純視覺 |
| 8 | 工作台頁內「常用入口」 | `student_learning_path.html` | 172 | 我的學習成長日誌（R01–R08） | `learning:student_growth_dashboard` |

### 2.2 「學員總覽」（`/student/`）課程卡片三鈕現況

`student_dashboard.html` 第 10 行（工作區已修改、未提交）：

1. `button secondary` **五階段學習工作台** → `student_learning_path`
2. `button secondary` **AI 目標檢測** → `student_prop_scan`
3. `button primary` **我的學習成長日誌** → `student_course_dashboard`

> 註：Git HEAD 版本的同一行**只有第 3 顆鈕**；第 1、2 顆為工作區未提交修改（P1/P2 階段加入）。
> 這正是教師所見「右上角新版五階段學習工作台重複主入口」的來源之一。

### 2.3 五階段各階段現有可連結目標（C 的 entries，views.py:3390–3468）

| 階段 | key | character | 現有 entries（皆已實測可連） | 成長槽位 |
|------|-----|-----------|--------------------------|---------|
| 學習知識 | `learn` | 學 | 學習平台（`learning:platform`）、下載中心（`/downloads/`）、AI 助教（`/live/`） | R01 |
| 模擬與練習 | `practice` | 練 | 模擬器練習（`learning:platform`）、AI 助教（`/live/`） | R02 R03 R04 |
| 專項實訓 | `build` | 做 | F450 十二任務實訓（`/platform/f450`）、Mission Planner 調參（`/live/`） | R05 |
| 能力考核 | `assess` | 測 | 手機槳葉方向辨識（`student_prop_scan`）、飛行健康 AI（`/flight-health/`） | R06 |
| 成長日誌 | `certify` | 證 | 我的學習成長日誌（R01–R08 總覽）（`student_growth_dashboard`） | R07 R08 |

### 2.4 「測」階段的兩項與教師指令對照

教師要求「測」只顯示兩項：

| 教師指定名稱 | 現況 | 對應入口 | 判定 |
|------------|------|---------|------|
| PROP_DIRECTION（F450 槳葉方向辨識） | **已存在** | `student_prop_scan`（手機槳葉方向辨識 M1–M4） | ✅ 直接對應 |
| FOUR_SIDE_HOVER（F450 四面懸停方向辨識） | **部分存在** | 平台 `#inspection` 區塊的「四面懸停檢測」（`hoverInput`／`hoverButton`，位於 `/platform/eagle`）；工作台 `assess` 階段目前**無**此項 | ⚠️ 需補入口（僅連結，不開發） |
| — 其他考核／規劃中項目 | 工作台 `assess` 階段目前 `planned: ()`（空）、`modules: ()`（空） | 無需隱藏 | ✅ 已符合 |

> 重要：平台 `#inspection` 區塊**已經是**教師所要求的「只有兩個入口」狀態
> （`index.html:262–264` 明文寫「本頁只保留兩個檢測入口」，`assessmentWorkflows` 僅 2 筆）。
> 因此「測只留兩項」在平台側已達成；缺口僅在 C（Django 工作台）的 `assess` 階段
> 少了「四面懸停」這一項可點連結。

### 2.5 「證」階段與 R01–R08 現況

- 教師指令要求「證」＝ 現有 R01–R08 八項成長日誌，**不是新證書系統**。
- C 的 `certify` 階段現況：`growth_slots = ("R07","R08")`，**只渲染 R07/R08 兩張卡**，
  entries 指向 `student_growth_dashboard`（八項總覽）。
- 平台側 `#certify`（`/platform/github`）顯示的是 `certificationChecklist` 四條靜態說明
  （GitHub 私人專案倉庫、學習過程紀錄、組裝照片與 30 秒影片、AI 測評結果），
  **與 R01–R08 無資料關聯**，屬「GitHub 成果存證」的示範文案。
- R07 `best.pt` 上傳鏈（`growth_model_upload` → `vision_submission.py` → Live `POST /api/v1/vision/submissions`）**完整存在且未變動**。

---

## 三、本輪擬修改檔案清單與受保護核心對照

| 檔案 | 擬修改內容 | 屬於教師列出的受保護核心？ | 判定 |
|------|-----------|------------------------|------|
| `templates/learning/student_dashboard.html` | 課程卡片移除重複的「五階段學習工作台」secondary 鈕（或改為單一主入口），保留「我的學習成長日誌」 | ❌ 否（僅學員首頁排版） | ✅ 可改 |
| `templates/learning/base.html` | 頁首導覽保留單一「五階段學習工作台」（不新增第二套） | ❌ 否（僅導覽列） | ✅ 可改 |
| `templates/learning/student_learning_path.html` | 五階段改為各階段獨立主題頁（每階段只顯示該階段內容），去除超長單頁向下展開 | ❌ 否（工作台模板本體） | ✅ 可改 |
| `static/learning/learning-path.css` | 配合階段版面調整 | ❌ 否 | ✅ 可改 |
| `views.py::LEARNING_PATH_STAGES` | 僅**可能**調整 `assess` 階段 entries（補「四面懸停」連結）；`growth_slots` 一律不動 | ⚠️ 需教師核准（views.py 為受保護清單邊緣） | 🔶 需核准或改用模板層方案 |
| `views.py::student_learning_path` | 若採「各階段獨立 URL」需新增路由參數；資料組裝邏輯不動 | ⚠️ 需教師核准 | 🔶 待定 |
| `templates/learning/platform_identity_nav.html` | 平台頁首分類列（學／練／作／測／證）是否改指向 C | ⚠️ 與平台側（另一代理範圍）重疊 | 🔶 需先報告 |
| `index.html`、`src/app.js`、`src/router.js`、`src/platform.js` | 平台側五階段（A/B 套） | ⚠️ **與其他代理修改檔案重疊** | 🛑 **本輪不動，先報告** |

### 3.1 受保護核心確認（一律不動）

以下皆在教師禁止修改清單內，本輪**完全不觸碰**：

- R01–R08 成長日誌核心：`models.py::GrowthRecordSubmission`／`GrowthRecordReview`、
  `growth_records.py`、`growth_task_map.py`、`growth_record_detail` 提交／複核邏輯
- R07 `best.pt` 上傳及教師複核核心：`growth_model_upload`、`vision_submission.py`、
  `teacher_vision_model_*` 系列
- Evidence 與影片/照片處理流程：`growth_video.py`、`growth_media.py`、
  `growth-upload.js`、`growth_record_detail.html`（本輪**不修改此模板**）
- Flight Health AI 核心：`flight-health/`（另一代理正在修改）
- F450 十二任務核心：`task_catalog.py`、`task_state.py`、`live_backend/app/task_*.py`
- YOLO 推論及模型管理：`vision_center.py`、`live_backend/app/mock_vision.py`
- 教師後台審核規則：`review_growth_record`（views.py:2400）
- 正式資料庫、migration

---

## 四、與其他代理的衝突面檢查

`git status` 顯示工作區 **44 M + 314 ??**（未提交）。與本輪修改範圍直接相關的已修改檔案：

| 檔案 | 狀態 | 與本輪關係 | 風險 |
|------|------|-----------|------|
| `student_portal/learning/templates/learning/base.html` | M | 本輪擬改 | 🟡 低（僅 1 行差異，已知） |
| `student_portal/learning/templates/learning/student_dashboard.html` | M | 本輪擬改 | 🟡 低（僅 1 行差異，已知） |
| `student_portal/learning/templates/learning/platform_identity_nav.html` | M | 平台頁首導覽 | 🟠 中（涉及平台側） |
| `student_portal/learning/templates/learning/growth_record_detail.html` | M | **受保護**（R05/R08 影片複核模組） | 🛑 本輪不動 |
| `student_portal/learning/views.py` | M | 含 `LEARNING_PATH_STAGES` 與大量 P1–P9 修改 | 🟠 中 |
| `student_portal/learning/urls.py` | M | 若新增階段路由需改 | 🟠 中 |
| `index.html`、`src/app.js`、`src/platform-browser.js`、`src/styles.css` | M | **平台側（另一代理）** | 🛑 本輪不動 |
| `live/*`、`live_backend/app/*` | M | Flight Health／Live Coach（另一代理） | 🛑 本輪不動 |
| `student_portal/learning/models.py`、`forms.py`、`growth_records.py` | M | 受保護核心 | 🛑 本輪不動 |

### 4.1 衝突結論

1. **安全可改**：`student_dashboard.html`、`base.html`、`student_learning_path.html`、
   `learning-path.css` — 這 4 個檔案的修改不會影響其他代理正在修的
   Flight Health（`live*`／`flight-health/`）與影片複核（`growth_record_detail.html`／`growth-upload.js`）。
2. **需先報告**：`platform_identity_nav.html`、`views.py`、`urls.py`、
   `index.html`／`src/*`（平台側）— 這些要麼屬受保護邊緣，要麼與其他代理修改檔案重疊。
3. **本輪絕對不動**：受保護核心 8 類 + 平台側五階段（A/B 套）全部檔案。

---

## 五、本輪最小修改方案（待教師核准後才動）

### 方案概述（不改 views.py 資料組裝、不改 models.py、不新增資料表）

1. **首頁只留一套五階段**
   - `student_dashboard.html`：課程卡片保留「五階段學習工作台」**單一主入口**
     （由 `secondary` 改 `primary`），「我的學習成長日誌」保留為次要入口。
     移除「AI 目標檢測」冗餘鈕（該功能已在「測」階段內）。
   - `base.html`：頁首導覽「五階段學習工作台」保留唯一一個（Already 只有一個，無需新增）。

2. **五階段各自獨立主題頁（模板層達成，不動 views.py）**
   - `student_learning_path.html` 改為：上方保留五階段路徑列（`lp-path`）作為導航；
     下方**只渲染 `current_stage` 對應的那一個 stage 區塊**（`{% for %}` 改為單一區塊）；
     每階段以 `?stage=<key>` 查詢參數或純前端 hash 切換；**或**新增 5 條只讀路由。
   - 優先採**純模板 + hash 方案**（`#stage-learn` 等），零後端改動、零路由改動、零破壞既有測試。
   - 移除「教師回饋」與「常用入口」兩段在全階段的向下展開（改為在各階段頁內適度呈現）。

3. **「測」只留兩項**
   - `LEARNING_PATH_STAGES["assess"]["entries"]` 補「F450 四面懸停方向辨識」→ 指向
     平台既有 `/platform/eagle`（**僅新增連結，不開發新功能**）。
   - 此項需動 `views.py`（受保護邊緣）→ **列入需核准清單**；
     若教師不同意動 views.py，備選方案為在模板層硬編該連結（較不理想）。

4. **「證」指向 R01–R08**
   - **零修改**：C 的 `certify` 階段已指向 `student_growth_dashboard`（八項總覽），
     且 R07/R08 卡片直接連到 `growth_record_detail`。已符合教師要求。

5. **原有輔助功能不動**
   - 下載中心 `/downloads/`、QR Code、Flight Health AI `/flight-health/`、F450 十二任務
     `/platform/f450`、Live Coach `/live/` — **全部保持現狀，不刪不搬不改名**。

### 5.1 需教師核准事項（動工前）

| # | 事項 | 原因 |
|---|------|------|
| A1 | 是否允許修改 `views.py::LEARNING_PATH_STAGES` 的 `assess.entries`（僅補 1 筆連結） | views.py 屬受保護清單邊緣；亦可改為模板層硬編 |
| A2 | 五階段切換採「純 hash（零後端改動）」或「5 條新路由」 | hash 方案不動 urls.py／views.py，風險最低 |
| A3 | 平台側五階段（`index.html`／`src/*`，字樣「作」）是否納入本輪整理 | 與另一代理修改檔案重疊，**建議本輪不動** |
| A4 | `platform_identity_nav.html` 的平台頁首分類列是否改指向 Django 工作台 | 涉及平台側，**建議本輪不動** |
| A5 | 既有自動化測試引用（見下節）如何處理 | 測試斷言需同步，屬「已存在測試」不屬新開發 |

### 5.2 受影響的既有自動化測試（若動模板，須同步）

| 測試檔 | 受影響斷言 | 影響程度 |
|--------|-----------|---------|
| `tests/test_student_learning_path.py` | `test_page_opens_with_five_stage_path`（五階段標題同時出現、`學 → 練 → 做 → 測 → 證` 字串）、`test_current_stage_follows_phase_progress`（`id="stage-build"`）、`test_all_phases_completed_shows_completion_message` | 🟠 中：若改為單階段渲染，同頁不再同時出現五個標題 |
| `tests/test_i3_student_experience.py` | `test_five_stage_sections_and_nav_anchors_match`（五個 `id="stage-*"` 與五個錨點一一對應）、`test_no_duplicate_entries_within_stage`、`test_planned_items_are_not_four_state_badges`（斷言恰好 3 個模組徽章）、`test_return_to_workbench_path_present` | 🟠 中 |
| `tests/test_p2_task_record_chain.py` | `test_p1_behavior_preserved`、`test_task_cards_show_requirements_evidence_and_stage`（`_stage_row` 由 context 取，安全）、`test_p1_behavior_preserved` 斷言五標題 | 🟡 低—中 |
| `tests/test_external_module_interface.py` | `test_five_stage_existing_entries_present`（五階段 entries 名稱）、`test_r01_r08_status_stable_across_repeated_views`（同頁抓 R01–R08 八個 `growth-slot`） | 🟠 中：單階段渲染後同頁不再有全部八個 R |
| `tests/test_student_learning_path.py::test_dashboard_offers_workbench_entry` | 學員首頁仍須有工作台入口 | 🟢 低（保留入口即通過） |

**處理原則**：以**最小改動保住測試語意**為優先——例如五階段路徑列（含五個階段名稱與
`#stage-*` 錨點）保留在同一頁，只把「下方內容區」改為一次只顯示一個階段。
如此 `test_five_stage_sections_and_nav_anchors_match` 等斷言可原樣通過，
僅需調整「同頁同時出現五個階段標題」的兩處斷言。

---

## 六、停止與回報

本次盤點**未修改任何檔案**、**未動任何資料庫**、**未重啟任何服務**。
依教師指令第六節：「若發現必須修改受保護核心或其他代理正在修改的檔案，立即停止該部分，
先向教師報告」——盤點結果顯示 **A2/A3/A4 三項與其他代理修改檔案重疊**，
且 **A1 涉及 `views.py`（受保護邊緣）**，故在此停止，等待教師針對 5.1 節 A1–A5 回覆後
再進入第三步最小必要修改。
