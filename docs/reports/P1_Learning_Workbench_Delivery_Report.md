# FDE-AI-UAS 2.0｜P1 五階段學習工作台與專項實訓入口框架 — 交付報告

- 日期：2026-10-12
- 分支：`fde-ai-v2.0-dev`（未 Commit／未 Push／未 Deploy）
- 指令依據：教師 2026-10-12 P1 正式開發指令（範圍僅限五階段工作台與任務入口框架）

---

## A. 實際完成功能

1. **學員五階段學習工作台**（`/student/learning-path/` 或課程列按鈕進入）
   - 頁面標頭宣告「學習路徑：學 → 練 → 做 → 測 → 證。所有進度與狀態皆取自你的真實學習紀錄，未完成的功能會標示『規劃中』」。
   - 五階段路徑导航（學=學習知識、練=模擬與練習、做=專項實訓、測=能力考核、證=成長日誌），含「目前階段」徽章與已完成／未開始狀態。
   - 「目前學習階段」區塊（`PhaseProgress` 優先取 IN_PROGRESS，再取 NOT_STARTED；五階段全部完成時顯示「本期五階段皆已完成」）。
   - 真實進度彙總：成長紀錄已提交 `n / 8`、教師已複核 `n / 8`（DEMO 真實值：1 / 8 與 0 / 8；無提交時顯示 0 / 8，**不使用假資料**）。
2. **各階段內容（全部真實資料）**
   - 每階段掛對應成長紀錄任務（R01–R08）卡片：真實 slot 徽章＋真實狀態（未開始／進行中／待補充／已提交／已複核）。
   - 「做」階段另列 `StudentTaskProgress` 任務進度卡（真實狀態；本輪僅讀取，不改寫）。
   - 既有安全入口清單（見 D）。
3. **獨立模組與規劃中專項（不造假）**
   - F450 數位孿生：僅顯示模組名稱＋簡介＋「待接入」徽章，**不可點擊、無假網址**（以正則斷言保證不被 `<a>` 包裹）。
   - 規畫中專項（模擬器四面懸停、起飛與降落、八字訓練、3D 列印、航線規劃、三維建模、巡檢與產業 SOP、無人車）只顯示「規劃中」徽章，無假功能、無連結。
4. **教師回饋區**：僅在有真實資料時列出（`StudentTaskProgress.teacher_note/teacher_score` 或 `GrowthRecordReview`）；無資料時明確顯示「目前尚無教師回饋」。
5. **入口**：學員導航列新增「五階段學習工作台」（插在「學習平台」與「我的學習成長日誌」之間）；學員課程總覽每列課程第一個動作按鈕「五階段學習工作台」。單一課程學員從導航進入自動重導到該課程工作台；無課程學者重導課程總覽。
6. **手機排版**：沿用既有設計語彙與色碼；`@media (max-width:680px)` 單欄、按鈕 `min-height:48px`；實測 iPhone 390×844 水平溢出 **0px**。

---

## B. 新增及修改檔案清單

### 新增（未追蹤，3 個產品檔 + 2 個驗收工具）
| 檔案 | 說明 |
| --- | --- |
| `student_portal/learning/templates/learning/student_learning_path.html` | 工作台頁面模板 |
| `student_portal/learning/static/learning/learning-path.css` | 工作台樣式（沿用既有色碼，手機單欄） |
| `student_portal/learning/tests/test_student_learning_path.py` | 18 個 HTTP 層驗收測試 |
| `demo/tools/verify_p1_learning_path.py` | DEMO 真實資料驗收腳本（47 項） |
| `demo/tools/p1_screenshot.cjs` | CDP 截圖腳本（桌面＋iPhone 390×844） |

### 修改（皆為附加式；`views.py` diff vs HEAD：1816 insertions / **0 deletions**）
| 檔案 | 變更 |
| --- | --- |
| `student_portal/learning/views.py` | EOF 附加 `LEARNING_PATH_STAGES` 常數＋`student_learning_path_entry`／`_learning_path_entry_urls`／`student_learning_path` 三個函式（3192–3318 行）；沿用 `student_course_dashboard` 相同 `get_or_create` 防禦做法，**不修改既有紀錄** |
| `student_portal/learning/urls.py` | +2 條路由（`student/learning-path/`、`student/courses/<int:enrollment_id>/learning-path/`） |
| `student_portal/learning/templates/learning/base.html` | 學員導航分支加「五階段學習工作台」連結（1 行） |
| `student_portal/learning/templates/learning/student_dashboard.html` | 每列課程動作第一個加工作台按鈕（1 行） |

> 本輪之前的 40 筆已追蹤未提交修改（P0 歷史累積）與 120 個未追蹤檔全部原樣保留，未動。
> git status：**164 項**（41 已追蹤修改＝原 40＋`base.html`；123 未追蹤＝原 120＋3 新檔）；staged 0。

---

## C. 頁面與路由

| 路由 | 名稱 | 狀態 |
| --- | --- | --- |
| `/student/learning-path/` | `student_learning_path_entry` | 新增（單一課程 302 到工作台；無課程回課程總覽） |
| `/student/courses/<id>/learning-path/` | `student_learning_path` | 新增（工作台本體；需登入、非本人 404） |
| `/student/courses/<id>/` | `student_course_dashboard` | 既有，未改 |
| `/student/` | `student_dashboard` | 既有，僅加工作台按鈕 |
| `/student/courses/<id>/growth/…`、`/prop-scan/`、`/platform/`、`/downloads/`、`/live/`、`/flight-health/` | — | 既有，未改 |

經 `main.py:550` 的 `/student/{portal_path:path}` 代理，`:8111` 亦可開啟 `/student/...` 工作台（P0 `RISK-03` 的 8 個區塊路徑 404 不影響 `/student/` 前綴，不阻擋 P1）。

---

## D. 已接入既有功能（只用已確認可用路由，未創造新功能）

1. 學習平台 `/platform/`（課程影片與教材）
2. 下載中心 `/downloads/`（課程軟體；原右上角位置不變）
3. AI 助教／Live 教練 `/live/`（RAG／語音教練；含 TASK_07 MP12 調參面板，沿用原本操作方式）
4. 手機槳葉方向辨識 `/student/courses/<id>/prop-scan/`（M1–M4，既有頁面）
5. 飛行健康 AI `/flight-health/`（原導航入口不變）
6. 成長紀錄 R01–R08（`growth_record_detail`）、學習成長日誌（`student_growth_dashboard`）、任務詳情（`task_detail`）

Mission Planner 調參實訓（MP01–MP12）：以「已接入主專案（TASK_07 調參面板）」既有入口呈現，說明註明「端到端與教師覆核流程仍待教師確認」；未合併 MP12 worktree、未修改 MP 內部程式、未操作飛控。

---

## E. 尚未接入獨立模組（只顯示狀態，不開發、不造假）

| 模組 | 呈現方式 |
| --- | --- |
| F450 數位孿生 | 「待接入」徽章＋簡介（獨立開發模組：位置待確認、尚未整合；本輪不開發 3D 模型與零件互動） |
| 模擬器四面懸停／起降／八字 | 「規劃中」徽章（未完成者不建立假功能） |
| 3D 列印、航線規劃、三維建模、巡檢與產業 SOP、無人車 | 可擴充任務卡片＋「規劃中」徽章 |
| 跨階段自動回寫 | 留待下一階段（教師指示 RISK-05） |

---

## F. R07、M1–M4 保護驗證

| 保護項 | 驗證 | 結果 |
| --- | --- | --- |
| R07 上傳路由 | 路由位址未變；GET 仍 405（`@require_POST` 未動）；非 `ai_flight_assessment` 方向 POST 被閘門 302 阻擋（流程在讀檔前返回，不寫入資料） | PASS（自動化） |
| R07 詳情頁／表單入口 | 200 | PASS（自動化＋DEMO） |
| M1–M4 辨識頁 | 200 且 `motor_M1..M4` 欄位齊全 | PASS（自動化＋DEMO） |
| 學習成長日誌 | 200 | PASS（自動化＋DEMO） |
| Evidence／Submission／教師覆核／best.pt 規則／資料表 | 未修改（views.py diff 0 deletions；未執行任何 migration、未清理資料） | PASS |
| v1.5C、Cloudflare、Gateway、正式資料庫 | 未觸碰（正式 Django :8022 PID 10688 全程未動；stop 日誌明確記錄） | PASS |

---

## G. DEMO 測試結果與截圖

**DEMO 真實資料驗收：47 / 47 PASS**（`demo/tools/verify_p1_learning_path.py`，登入真實 DEMO 學員帳號、透過 :8111 代理與 :8110 直連雙路徑）

重點結果：
- 工作台頁雙路徑 200；五階段標題、路徑字串、目前階段、五個錨點齊全。
- 成長紀錄 R01–R08 真實狀態；計數為 DEMO 真實值 **已提交 1 / 8、教師已複核 0 / 8**（非假進度）。
- F450 數位孿生「待接入」且不可點、無假孿生網址；8 個規劃中專項有徽章、無假連結。
- 6 個既有安全入口全部可連結；教師回饋區真實（尚無回饋時明確顯示）。
- 凍結頁面 R07／M1–M4／成長日誌全部 200。
- iPhone 390×844（Safari UA）水平溢出 **0px**。

**自動化測試**：
- 新套件 `test_student_learning_path`：18 / 18 PASS。
- 回歸 `manage.py test learning` 分 5 批共 **654 項：2 失敗，皆為 P0 期既有矛盾、非本輪造成**：
  1. `test_auth.py` 平台 hero label——工作樹未提交的 `src/platform-browser.js` 把 label 改成「我的成長日誌」，與已提交測試期望的「我的學習日誌」不一致（該測試檔與 src 檔本輪均未動）。
  2. `test_vision_flywheel_framework`——教師視覺模型列表頁缺「訓練用途」欄（測試與 `teacher_vision_model_list.html` 皆為 P0 期未追蹤檔，本輪未動）。
- 前端 `node --test src/*.test.cjs`：32 項，31 過 1 敗（`download-center-entry.test.cjs`，未追蹤 P0 檔，RISK-07 已知矛盾）。

**截圖**（`demo/runtime/logs/`）：
- `p1_workbench_desktop.png`（1440px 桌面）
- `p1_workbench_iphone390x844.png`（iPhone Safari 390×844）
- 另存工作台真實渲染 HTML：`p1_learning_path_demo.html`

完成度標註（依兩級完成標準）：**AUTOMATED PASS**；**人工 iPhone 真機驗收：PENDING**（本輪為沙箱內 Chrome iPhone 模擬，非真機）。

---

## H. 未完成項目、風險及下一階段建議

### 未完成／待真機
1. iPhone 真機人工驗收（真實 Safari、真實觸控）— PENDING。
2. MP12 端到端與教師覆核流程 — 待教師確認（沿用既有入口，未改動）。
3. F450 數位孿生、模擬器四項、跨階段自動回寫 — 留待後續階段（本輪只預留入口與「待接入／規劃中」標示）。

### 風險
1. **兩筆 P0 期既有測試失敗**（B/G 節已說明）：非本輪造成，但會讓「全套綠燈」無法成立；建議下階段先裁定工作樹 vs 已提交測試的優先序（規則 1：磁碟真實代碼為準）。
2. `student_dashboard.html` 的工作台按鈕在單一課程學員的視窗中不可見（該學員著落頁為課程頁，按鈕在課程總覽列）；導航列入口可覆蓋此情境。如教師要求單課程頁也有按鈕，屬小追加，待指示。
3. 工作台成長紀錄卡狀態圖示沿用 `status-{key}` 既有類別，本次新增 `.status-not_started`；若未來改通用 status 映射，需同步 CSS。

### 下一階段建議（未獲授權，僅建議）
1. 真 iPhone 驗收工作台（教練現場走一次學→練→做→測→證）。
2. 裁定兩筆 P0 測試矛盾後補敘歸屬（RISK-07 收尾）。
3. 跨階段自動回寫（RISK-05）與 MP12 端到端確認後，再評估獨立模組接入順序。

---

## 受保護項目修改計數（全部為 0）

| 項目 | 次數 |
| --- | --- |
| 正式資料庫／正式學員資料 | 0 |
| R07（路由／流程／資料） | 0 |
| M1–M4（頁面／規則／資料） | 0 |
| F450 數位孿生等獨立模組 | 0 |
| Cloudflare／Gateway／正式部署 | 0 |
| Commit / Push / Deploy | 0 |
| `git reset --hard`／`git clean`／強制 checkout／Merge | 0 |
| R07 測試資料清理 `--apply` | 0 |

**本輪僅完成 P1 五階段工作台及任務入口框架，完成後即停止，未進入 P2。**
