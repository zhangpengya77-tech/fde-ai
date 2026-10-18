# FDE-AI-UAS 2.0｜現況盤點報告（Current State Audit）

| 項目 | 內容 |
| --- | --- |
| 文件編號 | `FDE_AI_2_0_Current_State_Audit.md` |
| 專案目錄 | `D:\FDE-AI-UAS-v2.0` |
| 分支 / HEAD | `fde-ai-v2.0-dev` / `e5c0442`（git worktree） |
| 稽核日期 | 2026-10-12 |
| 稽核性質 | **唯讀**。未修改產品程式、API、頁面、導航、路由、資料表 |
| 授權範圍 | 《FDE-AI-UAS 2.0｜第一階段可驗證檢查清單與交付驗收條件》＋教師補充指令（2026-10-12） |
| 盤點狀態標記 | `EXISTS` 存在 / `WORKING` 可運作 / `PARTIAL` 部分 / `MISSING` 不存在 |

> **重要前提**：本報告所有結論均附實際檔案路徑與行號。凡本輪無法在磁碟上找到實體者，一律列入「未找到／待確認」，**不建立替代模組、不臆測**。

---

## 0. 安全檢查結果（Step 1）

| 檢查項 | 結果 | 依據 |
| --- | --- | --- |
| `AGENTS.md` | ✅ 已讀（16 條開發鐵律） | `AGENTS.md:1-416` |
| `FDE-Safe-Dev Skill` | ⚠️ **未找到** | 全機搜尋 `*Safe*Dev*` 無結果；`C:\Users\admin\.workbuddy-ai\skills\` 與專案 `.workbuddy-ai\` 均無此技能 |
| 工作目錄 | `D:\FDE-AI-UAS-v2.0` | `.git` 指向 `FDE-AI/.git/worktrees/FDE-AI-UAS-v2.0` |
| Git 分支 | `fde-ai-v2.0-dev` | `git branch --show-current` |
| 未提交變更 | **154 筆**（含 34 筆已追蹤修改 + 大量未追蹤文件） | `git status --short` |
| 保護判定 | 全部標記 `EXTERNAL_DIRTY_STATE_DO_NOT_TOUCH` | `AGENTS.md:163-180` |
| Stash | 1 筆（`On fde-ai-v1.5: safety: pre-anonymous identity v1.5`）— **未動** | `git stash list` |
| Worktree 清單 | 7 個，其中 `D:/FDE-AI-UAS/v1.5C`（v1.5C 穩定版）、`D:/FDE-AI-UAS-MP12`（MP12 獨立） | `git worktree list` |

**R4 保護對象（本輪與後續皆不得觸碰）**：
v1.5C 穩定分支 `D:\FDE-AI-UAS\v1.5C`、Cloudflare Gateway、Cloudflare Tunnel、正式資料庫、正式學員資料、正式 ACTIVE 模型、真機與飛控設定、`D:\FDE-AI-UAS-MP12`、`flight-health`。

**教師補充指令（2026-10-12）新增凍結項**（已納入本報告與後續文件）：

- R07 提交流程：**凍結保護**
- M1–M4 前端版本（手機版響應式排版）：**凍結保護**
- RAG 學生前端問答（已驗證部分）：**凍結保護**
- 本輪盤點時**不得重做**上述已驗證模組

---

## 1. 學員端與教師端（AUD-01）

### 1.1 學員端

| 功能 | 路由 | View | 狀態 |
| --- | --- | --- | --- |
| 首頁 | `/` | `views.home:182` | `WORKING` |
| 註冊 / 啟用 | `/register/`、`/activate/<public_user_id>/` | `views.register:294`、`views.activate:346` | `WORKING` |
| 學員登入 | `/login/` | `StudentLoginView`（`urls.py:19`） | `WORKING`（DEMO 帳號已修復） |
| 學員儀表板 | `/student/` | `views.student_dashboard:558` | `WORKING` |
| 成長日誌入口 | `/student/growth/` | `views.student_growth_entry:576` | `WORKING` |
| 課程儀表板 | `/student/courses/<id>/` | `views.student_course_dashboard:623` | `WORKING` |
| 專業方向選擇 | `.../project-direction/` | `views.select_project_direction:668` | `WORKING` |
| 八項成長總覽 | `.../growth/` | `views.student_growth_dashboard:680` | `WORKING` |
| **R07 模型上傳** | `.../growth/R07/model/` | `views.growth_model_upload:994` | `WORKING`（**凍結保護**） |
| 手機槳葉辨識 | `.../prop-scan/` | `views.student_prop_scan:1121` | `WORKING` |
| 單項成長詳情 | `.../growth/<slot_id>/` | `views.growth_record_detail:716` | `WORKING` |
| R08 問卷 | `.../growth/R08/survey/` | `views.student_survey:1277` | `WORKING` |
| 任務詳情 / 證據 | `.../tasks/<task_id>/` | `views.task_detail:1384`、`views.evidence_add:1427` | `WORKING` |
| 證據下載 | `/evidence/<uuid>/download/` | `views.evidence_download:1450` | `WORKING` |
| 證據刪除 | `.../evidence/<uuid>/delete/` | `views.growth_evidence_delete:1354` | `WORKING` |

### 1.2 教師端

| 功能 | 路由 | View | 狀態 |
| --- | --- | --- | --- |
| 教師儀表板 | `/teacher/` | `views.teacher_dashboard:1509` | `WORKING` |
| **AI 視覺模型中心（單一入口、四區域）** | `/teacher/vision-center/` | `views.teacher_vision_center:2710` | `WORKING` |
| 視覺中心四動作 | `.../validate/`、`.../import/`、`.../activate/`、`.../rollback/`、`.../upload/` | `views.py:2906/2993/3066/3101/3124` | `WORKING` |
| 模型清單 / 詳情 / 複核 / 入庫 | `/teacher/vision-models/...` | `views.py:1650/1735/1945/1777` | `WORKING` |
| 教師圖片驗證 | `.../verify/`、`.../verify/run/` | `views.py:1821/1856` | `WORKING` |
| 完整性檢查 | `.../integrity-check/` | `views.py:1870/1890` | `WORKING` |
| 視覺飛輪頁 | `/teacher/vision-flywheel/` | `views.teacher_vision_flywheel:1909` | `WORKING` |
| **Golden Set 管理** | `/teacher/golden-sets/...` | `views.py:2334-2466` | `WORKING` |
| **Golden Test 評估中心** | `.../golden-test/` | `views.teacher_golden_test_page:2479` | `PARTIAL`（僅框架頁，不推論） |
| 問卷總覽 / 明細 | `/teacher/surveys/...` | `views.py:2049/2109` | `WORKING` |
| 學員詳情 / 驗證 / 身份 | `/teacher/enrollments/<id>/...` | `views.py:1982/2158/2171/2189` | `WORKING` |
| 成長紀錄複核 | `/teacher/growth-reviews/<id>/` | `views.review_growth_record:2205` | `WORKING` |
| 任務複核 | `/teacher/reviews/<id>/` | `views.review_task:2240` | `WORKING` |
| 候選升級 / 刪圖 | `/teacher/evidence/<uuid>/...` | `views.py:2272/2294` | `WORKING` |

**證據**：`student_portal/learning/urls.py:8-126`（40 條路由）；`student_portal/learning/views.py`（40 個 view function）；`student_portal/learning/templates/learning/`（38 個模板）。

---

## 2. 現有導航、頁面與路由（AUD-02）

### 2.1 側邊導航（動態渲染）

`index.html:18` `<nav class="nav" id="moduleNav">`（空殼）→ `src/app.js:81-95` `renderNavigation()` 產生。

| label | title | href | data-route | 狀態 |
| --- | --- | --- | --- | --- |
| 任 | 12 任務地圖 | `./tasks` | `missions` | `WORKING` |
| 學 | 課程影片與下載說明 | `./courses` | `learn` | `WORKING` |
| 練 | 模擬器與考照練習 | `./simulator` | `practice` | `WORKING` |
| 作 | F450 組裝與 AI 助教 | `./f450` | `build` | `WORKING` |
| 測 | 鷹眼 AI 檢測中心 | `./eagle` | `inspection` | `WORKING` |
| 證 | GitHub 成果存證 | `./github` | `certify` | `WORKING` |
| 健 | 飛行健康 AI / Flight Health | `/flight-health/` | （外部） | `WORKING`（外部服務） |
| 展 | 歷屆學員成果 | `./results` | `cohorts` | `WORKING` |
| 師 | 教師復核中心 | `./teacher` | `teacher` | `WORKING` |

### 2.2 路由機制（「路徑即區塊」）

`src/router.js:2-13` `routeDefinitions` 共 10 筆；`routeFromLocation()`（`:24-26`）以 `lastPathSegment(location.pathname)` 匹配。

**關鍵限制**：任何區塊路徑都必須由伺服器回傳同一份 `index.html`，否則手機直開會取得 404。目前 `live_backend/app/main.py:556` 只註冊 `Route("/")` 與 `main.py:560` `Route("/eagle")`；**其餘 8 個區塊路徑（`/tasks`、`/courses`、`/fde`、`/simulator`、`/f450`、`/github`、`/results`、`/teacher`）在 8111 直開會 404**，必須經由 `#sectionId` 錨點或首頁 JS 導覽。

> `main.py:542-554` 另有 `/courses/{portal_path:path}`、`/teacher/{portal_path:path}` 等 Django 代理路由，會優先匹配，因此**不可**再新增同名區塊路由。

### 2.3 頁面區塊（section id）

`index.html` 實際 section：`home`(58)、`mobile-demo`(86)、`dashboard`(123)、`missions`(142)、`flight-health-entry`(154)、`learn`(166)、`fde-column`(180)、`practice`(195)、`build`(204)、`inspection`(259)、`teacher`(296)、`cohorts`(306)、`certify`(315)。

**不一致點**：`dashboard`、`flight-health-entry` 有 DOM id 但**不在** `routeDefinitions` 的 `sectionId` 內，故 `applyRoute()`（`app.js:97-121`）不會單獨顯示。

### 2.4 section 渲染函式對應

| section | 渲染函式（`src/app.js`） |
| --- | --- |
| home | `renderHero:183`、`renderDataFlow:201`、`renderModes:232` |
| dashboard | `renderStudentDashboard:246`、`renderLearningPath:266` |
| missions | `renderMissionMap:279` |
| learn | `renderLearningResources:456` |
| fde-column | `renderFdeColumn:492` |
| practice | `renderPracticeResources:541` |
| build | `renderBuildWorkflow:559`、`renderBuildMain12Entry:1054`、`renderVoiceAssistantPanel:571` |
| inspection | `renderAssessmentWorkflows:576`；結果 `renderPropellerInspectionResult:901`、`renderHoverResult:958` |
| teacher | `renderTeacherDashboard:1091` |
| cohorts | `renderCohorts:412` |
| certify | `renderCertificationChecklist:1109` |

---

## 3. 右上角下載中心（AUD-03）

| 項目 | 內容 |
| --- | --- |
| 入口位置 | 行動選單 `index.html:47`；Portal 入口列 `index.html:56` |
| 獨立頁面 | `downloads/index.html`（標題「學員下載中心」） |
| 前端邏輯 | `downloads/downloads.js:45` `fetch("/api/downloads")`；樣式 `downloads/downloads.css` |
| 後端 API | `GET /api/downloads`（`live_backend/app/main.py:566`）、`GET /api/downloads/{download_id}/file`（`main.py:567`，支援 Range） |
| 實作 | `live_backend/app/download_center.py:238-264`；manifest 解析 `:23-36` |
| Manifest 路徑 | 優先 `D:\FDE-Downloads`，不存在則 `D:\下載中心文件`（可用 `FDE_DOWNLOAD_ROOT` 覆寫）；檔名 `download_manifest.json` |
| 目前項目數 | **6 筆**（DJI_WIN_Driver_Installer、NAZAM_2.20_Installer、FDE-AI-YOLO 學員安裝包 v1.1、HQGC_Student_Setup、MissionPlanner-1.3.83.msi、Git_Installer） |
| 靜態掛載 | `main.py:600` `Mount("/downloads", ...)` |
| 文件 | `docs/DOWNLOAD_CENTER.md` |
| 狀態 | `WORKING` |

**⚠️ 發現的測試矛盾**（如實記錄，不修）：`src/download-center-entry.test.cjs:12-14` 斷言 `app.js` 含 `title: '下載中心 / Download Center'` 與 `href: '/downloads/'`，但現行 `app.js` 已無該字串；而 `src/homepage-portal-entry.test.cjs:17` 反而斷言 `app.js`「不含」該字串。→ `RISK-07`。

**依教師指示**：下載中心**保留原位置與功能**，不移動、不改版。

---

## 4. 導航欄飛行健康功能（AUD-04）

| 項目 | 內容 |
| --- | --- |
| 目錄 | `flight-health/`（`index.html`、`css/style.css`、`js/app.js`、`js/config.js`） |
| 主站連結 | 側欄 `src/app.js:85`；首頁入口 `index.html:154-164`（`index.html:162` CTA）；行動選單 `index.html:45` |
| 整合方式 | **連結（href），非 iframe、非 API 整合** |
| 主站托管 | `live_backend/app/main.py:565` `Mount("/flight-health", StaticFiles(..., html=True))` |
| 後端 | **獨立專案** `D:\FDE-Flight-Health-AI`，`flight-health/js/config.js:7` `API_BASE_LOCAL: "http://127.0.0.1:8040/api/v1"`；`:44` 區網 `http://{hostname}:8040/api/v1` |
| 共用程式 | 與主站**無**共用 JS；主站 `live_backend` 內無 flight-health API 實作 |
| 狀態 | `WORKING`（外部服務；本輪未啟動驗證） |

**依教師指示**：飛行健康**保留原位置與功能**，僅做「連結＋接口預留」。

---

## 5. F450 數位孿生獨立專案（AUD-05）

| 項目 | 結果 |
| --- | --- |
| 獨立目錄 / repo | ⚠️ **已有獨立開發版本，完整專案路徑未確認**（教師補充指令 2026-10-12） |
| 本機搜尋結果 | 本輪搜尋範圍（`D:\FDE-AI-UAS-v2.0` 與 D 槽已列舉目錄）內未見實體 → **屬搜尋範圍限制，非不存在** |
| 歷史文件記載 | `docs/archive/phase0/V2_ARCHITECTURE.phase0.md:4`「v2.0 核心從 Three.js Digital Twin … 修正為 FDE Live Coach」；`docs/archive/phase0/DEV_HANDOFF.phase0.md:98`「**不是** Three.js Digital Twin」、`:384` 列為 Secondary — Future Feature；`V1.5C_BASELINE.md:53-64`「本基準只記錄規劃，不開發」；`CODEX_START_V1.5C.md:31`「不實作 Digital Twin、Three.js」 |
| 現有 F450 相關實作 | `build` section（`renderBuildWorkflow:559`、`renderBuildMain12Entry:1054`）為**組裝流程 + AI 助教**，非數位孿生 |
| 狀態 | **`EXISTS_BUT_LOCATION_UNKNOWN`** |

> **判定修正（2026-10-12 教師補充指令）**：
> F450 數位孿生**已有獨立開發版本**，僅**尚未確認其完整專案路徑**。
> 本報告初版誤判為 `MISSING`，係因「本輪搜尋範圍（`D:\FDE-AI-UAS-v2.0` 及 D 槽已列舉目錄）內未找到實體」，此為**搜尋範圍限制**，非「不存在」。
>
> **正確標註**：`獨立開發模組／位置待確認／尚未整合`
>
> | 屬性 | 值 |
> | --- | --- |
> | 實作狀態 | `EXISTS`（獨立開發版本已存在，依教師確認） |
> | 位置 | **待確認**（教師提供或確認獨立專案路徑） |
> | 整合狀態 | `NOT_CONNECTED`（尚未整合） |
> | 本輪處理 | **只預留文件層級的模組入口與候選接口**；不建立、不複製、不搬移 |
>
> 依教師指令，本輪**不建立數位孿生專案**。架構圖與本文件中，F450 數位孿生一律標示為
> 「**獨立模組／位置待確認／尚未整合**」（B 類），**不得畫成已完成整合，亦不得標為不存在**。

---

## 6. Mission Planner 調參實訓獨立專案（AUD-06）

### 6.1 獨立 worktree

`D:\FDE-AI-UAS-MP12`（worktree；分支 `fde-ai-v2.0-mp12-dev`）。頂層：`index.html`、`404.html`、`src/`、`live/`、`live_backend/app/`、`docs/`、`tests/`、`student_portal/`、`cloudflare/`、`ops/`。

### 6.2 主專案中的 MP12 整合點（**已存在**）

| 層 | 位置 | 內容 |
| --- | --- | --- |
| 資料模型 | `live_backend/app/mp12_models.py:7-22` | `MissionPlannerSubtaskDefinition` |
| 目錄定義 | `live_backend/app/mp12_catalog.py:6-35`、`:38+` | 12 筆 MP01–MP12，含 `legacy_step_ids` |
| 狀態機 | `live_backend/app/mp12_state.py` | `MissionPlannerProgress` |
| 後端 Adapter | `live_backend/app/main.py:317-345` | `training_mp12_select/complete/teacher_review` |
| 路由註冊 | `live_backend/app/main.py:578-580` | `POST .../training/mp12/{subtask_id}/select`、`/complete`、`/teacher-review` |
| Session 層 | `live_backend/app/sessions.py:331-353`、`:263`、`:318` | 併入 payload |
| 前端 UI | `live/index.html:50-113` | TASK_07 擴充區塊 `#missionPlannerPanel`；`:87`「仅 MP06、MP08、MP11、MP12 需要教师现场复核」 |
| 前端樣式 | `live/live.css:118-124+` | `.mp12-*` |
| 前端邏輯 | `live/live.js:549-567`、`:931-957` | 三支 endpoint 呼叫 + `renderMissionPlannerState` |
| 測試 | `live/mp12-frontend-integration.test.cjs`、`live_backend/tests/test_mp12_backend_integration.py`、`test_task07_mission_planner_content.py` | — |
| 任務契約 | 掛在 `TASK_07` 深度子模組 | — |

**整合性質**：**file-level adoption**（主站 `live/` 與 `live_backend/` 直接內含 `mp12_*` 模組與端點，屬同一程式基底），**非** iframe、非外部獨立 API。

**狀態**：`WORKING`（後端 + 前端 + 測試皆存在）。**但**：MP12 獨立 worktree 本身與主專案尚未 Merge（`AGENTS.md:153-161` 禁止未經要求 Merge MP-12）。

---

## 7. Camera、YOLO、SOP、RAG、LLM、Voice（AUD-07）

| 能力 | 實作位置 | 狀態 |
| --- | --- | --- |
| **Camera** | 前端 `getUserMedia`：`live/live.js:46`（`openCameraWithFallback`）、約束 `:20-40`、裝置切換 `:57`。後端不開攝影機，僅收圖：`main.py:571` → `snapshot:394-420`，解碼 `main.py:45` | `WORKING` |
| **YOLO** | 位址 `http://127.0.0.1:8765`（`live_backend/app/config.py:9`，env `FDE_LIVE_YOLO_BASE_URL:20`）。呼叫端 `vision.py:34`（health `:46`、detect `:55`）。伺服器 `live_backend/dev/vision_snapshot_server.py:154`（`/api/detect:125`、`/api/health:119`）。**外部 `yolo_server.py` 原始碼不在本倉** | `PARTIAL`（DEMO 走模擬推論） |
| **SOP** | 程式內 `live_backend/app/sop.py`（`SopStep:26`、`SopTask:39`、`SopCourse:46`、`SopDecision:53`、`load_demo_course:72`、`SopEngine.evaluate:107`）。完整目錄 `task_catalog.py:309` `load_f450_course()`（12 任務 `:315-324`，課程 ID `F450_AI_TRAINING:328`）。文件型 `docs/delivery/08-STUDENT-R07-SOP.md` | `WORKING` |
| **RAG** | 位址 `http://127.0.0.1:8770`（`config.py:14`）。客戶端 `rag.py:67` `query`（POST `{base}/api/rag/ask:72`、health `:45`）。**RAG 服務本體與 1105 docs 語料不在本倉**。前端 `src/rag-client.js`、`src/rag-config.js:5`。同源代理 `main.py:487` → `POST /api/rag/ask`（`main.py:562`） | `PARTIAL`（服務外部；前端問答**凍結保護**） |
| **LLM** | Provider 由環境變數決定：`providers/provider_manager.py:22` `from_environment`（`OPENAI_API_KEY:23`、模型 `FDE_GENERAL_MODEL` 預設 `gpt-5.6-luna:26`）。實作 `providers/provider_openai.py:15`（`https://api.openai.com/v1/responses`；文字 `generate:63`、視覺 `generate_visual:105`）。裝配 `main.py:611`。鏈路 `ask_coach:450` → `coach_ask.py:61` `answer` → `:151` `_general_answer` / `:161` `_general_visual_answer` | `WORKING` |
| **Voice** | **全在前端，後端無 STT/TTS**。TTS `live/live.js:773` `createSpeechReply`（`speechSynthesis.speak:788`、中文語音 `selectChineseVoice:767`）。STT `SpeechRecognition:1152`、`bindPushToTalk:68`、`createHandsFreeVoiceCoach:144`、實例化 `:1603/:1616`。能力偵測 `:760`。後端僅問答端點 `main.py:574` | `WORKING`（瀏覽器原生；後端 `MISSING`） |

---

## 8. R07、Submission、Evidence（AUD-08）

### 8.1 資料模型

| Model | 位置 | 關鍵關係 |
| --- | --- | --- |
| `Evidence` | `learning/models.py:526` | FK→`StudentTaskProgress`(CASCADE, 可空)`:538`；FK→`GrowthRecordSubmission`(CASCADE, 可空)`:541`；`evidence_type` 8 值 `:527` |
| `GrowthRecordSubmission` | `models.py:164` | FK→`Enrollment`(CASCADE)`:173`；FK→`GrowthRecordDefinition`(PROTECT)`:174`；status 6 值 `:165`；M2M `selected_evidence`→Evidence `:188` |
| `VisionModelRecord` | `models.py:683` | **OneToOne→`Evidence`(`on_delete=PROTECT`)`:733**；FK→`StudentProfile`(PROTECT)`:740`；FK→`Cohort`(PROTECT)`:743`；自參照 `parent_record`/`lineage_root`(PROTECT)`:750,758` |
| `GrowthRecordReview` | `models.py:605` | FK→`GrowthRecordSubmission`(CASCADE)`:611`；FK→`User`(PROTECT)`:614` |

**⚠️ 關鍵風險 `RISK-01`**：`VisionModelRecord.evidence` 為 `PROTECT`，**不可先刪 `Evidence`**（Django 會拋 `ProtectedError`）。刪除順序必須為 **先刪 `VisionModelRecord`，再刪 `Evidence`**。

### 8.2 端到端資料流（**已驗證存在**）

```
Django 學員端
  views.py:994  growth_model_upload
    → 建 Evidence（views.py:1029，evidence_type=MODEL）
    → vision_submission.py:235  submit_model_evidence_to_vision
        → 組 payload（:240）
        → POST {VISION_SUBMISSION_API_BASE_URL}/api/v1/vision/submissions（:252）
           （設定：settings.py:223-224，預設 http://127.0.0.1:8030；
             DEMO 以 DJANGO_VISION_SUBMISSION_API_BASE_URL 覆寫為 http://<bind>:8111，
             demo/tools/demo_common.ps1:124）
Starlette Live Backend
  vision_api.py:368  Route /api/v1/vision/submissions
    → vision_api.py:206  submissions
    → :217  center.create_submission
    → vision_center.py:480  create_submission
        → 存 submission.pt（:496）
        → JsonStore.save（:508）
Django 回寫
  views.py:1059  記錄 vision_submission_id
  views.py:1066-1068  失敗時回滾刪除已存檔
```

**狀態**：`WORKING`。**依教師指示**：R07 提交流程**凍結保護**。

### 8.3 R07 的實際資料職責（**重要釐清**）

| 問題 | 結論 | 依據 |
| --- | --- | --- |
| R07 是否等於「全部成長日誌」？ | **不是** | R07 只是 R01–R08 八個 slot 中的**一個** |
| R07 的權威定義 | 「專業任務驗證」 | `student_portal/learning/data/growth_records_v1.json:57-59`：「依學員所屬組別與專業方向，完成 AI 目標檢測、測繪建模、航線任務或組裝考照等行業應用驗證」 |
| R07 在實作中的承載 | **模型上傳（best.pt）的承載 slot** | `views.py:994` docstring「保存 R07 MODEL 證據並接入既有 Vision Submission 審核鏈」；僅當 `enrollment.project_direction == "ai_flight_assessment"` 時開放（`views.py:1005`）；建立 `evidence_type=Evidence.Type.MODEL`（`views.py:1031`） |
| 與 VisionModelRecord 的關係 | OneToOne(PROTECT) 關聯該 R07 的 MODEL 型 Evidence | `models.py:733-738` |

> **判定**：R07 = 成長紀錄 slot「專業任務驗證」；對 `ai_flight_assessment` 方向而言，其子能力為「AI 模型提交」。**R07 既非成長日誌全集，也非獨立模型實體**。

---

## 9. 現有八項成長紀錄（AUD-09）

**權威來源**：`student_portal/learning/data/growth_records_v1.json`
**載入程式**：`learning/growth_records.py:9` `GROWTH_RECORDS_CONFIG` → `seed_growth_record_definitions:17` 寫入 `GrowthRecordDefinition`
**slot 驗證**：`models.py:130` `RegexValidator(r"^R0[1-8]$")`

| slot | 名稱 | JSON 行號 | display_order |
| --- | --- | --- | --- |
| R01 | 無人機基礎認知 | `:3-4` | 1 |
| R02 | 模擬飛行訓練 | `:12-13` | 2 |
| R03 | 真機飛行訓練 | `:21-22` | 3 |
| R04 | 證照技能驗證 | `:30-31` | 4 |
| R05 | F450 工程組裝 | `:39-40` | 5 |
| R06 | 鷹眼 AI 目標檢測 | `:48-49` | 6 |
| R07 | 專業任務驗證 | `:57-58` | 7 |
| R08 | 綜合成果作品展示 | `:66-67` | 8 |

**狀態**：`WORKING`（八項齊備，由 `GrowthRecordDefinition` 逐期別建立）。

---

## 10. 資料庫、媒體、模型倉庫與服務介面（AUD-10）

### 10.1 資料庫（**兩套並行**）

| 系統 | 路徑 | 用途 | 狀態 |
| --- | --- | --- | --- |
| Django 正式 | `student_portal/db.sqlite3`（450,560 bytes） | 正式學員資料 | `WORKING`（**R4 保護**） |
| Django DEMO | `demo/runtime/db/demo.sqlite3`（593,920 bytes） | DEMO 展示（由 `DJANGO_DB_NAME` 指定） | `WORKING` |
| Live Backend JSON Store | `demo/runtime/vision-center/vision_center.json`（64,674 bytes） | 模型 / 資料集 / 提交 / 硬例 / Golden Set | `WORKING` |

> **注意**：兩套視覺系統**完全獨立** — Django `VisionModelRecord`（SQLite）vs Live Backend `VisionCenter`（JSON Store）。目前僅有 R07 提交鏈路將兩者串接。

### 10.2 媒體檔案

| 項目 | 路徑 | 設定 |
| --- | --- | --- |
| Django MEDIA | `student_portal/private_media/` | `DJANGO_MEDIA_ROOT`（DEMO 覆寫） |
| Live Backend 根 | `FDE_VISION_CENTER_ROOT`（預設 `%LOCALAPPDATA%\FDE-AI-UAS\vision-center`；DEMO 覆寫為 `demo/runtime/vision-center`） | `main.py:107` |

### 10.3 模型倉庫

```
{FDE_VISION_CENTER_ROOT}/
  model_registry/
    prop_direction/<model_id>/best.pt + manifest.json
    four_side_hover/<model_id>/best.pt + manifest.json
  datasets/
  submissions/
```

**依據**：`vision_center.py:187`（registry）、`:368`（任務目錄）、`:371`（`best.pt`）、`:416`（`manifest.json`）。

**現況（DEMO JSON Store）**：42 models / 12 datasets / 9 hard_examples / 1 submission / `demo_active_submissions = {"PROP_DIRECTION": "sub-ea18f5eb-a1a5-41f2-ae7d-512ad380f79e"}`。

**ACTIVE 模型（2 筆）**：
- `PROP_20261010_X_accv2_23fd`（PROP_DIRECTION，`best.pt` SHA256 `9725803a3d693643c9a3dfe4c6cf970c25b301974d695dc272bcffb46fc5813b`）
- `HOVER_20261010_X_haccv1_abc8`（FOUR_SIDE_HOVER，`best.pt` SHA256 `13637f261eb41acf985c19512bd5ba75c378aff4fb68e1e9de16a240d90d1bf8`）

### 10.4 服務介面與埠

| 埠 | 服務 | 依據 |
| --- | --- | --- |
| 8110 | DEMO Django | `demo/tools/demo_common.ps1:14` |
| 8111 | DEMO Live Backend | `demo_common.ps1:15` |
| 8022 | 正式 Django Portal | `main.py:120`、`demo_common.ps1:107` |
| 8030 | 正式 Live Backend / Vision API | `settings.py:224`、`src/rag-config.js:11` |
| 8040 | Flight Health 獨立後端 | `flight-health/js/config.js:7` |
| 8765 | YOLO Vision | `config.py:9`、`vision_snapshot_server.py:154` |
| 8770 | RAG | `config.py:14` |

**DEMO 環境變數（`demo_common.ps1:101-148` `Set-DemoEnvironment`）**：
`DJANGO_DB_NAME`(`:102`)、`DJANGO_MEDIA_ROOT`(`:103`)、`DJANGO_DEBUG`(`:104`)、`DJANGO_ALLOWED_HOSTS`(`:110`)、`DJANGO_CSRF_TRUSTED_ORIGINS`(`:111`)、`FDE_VISION_CENTER_ROOT`(`:112`)、`FDE_DOWNLOAD_ROOT`(`:117/119`)、`FDE_DJANGO_PORTAL_URL`(`:121`)、`DJANGO_VISION_SUBMISSION_API_BASE_URL`(`:124`)、`FDE_DEMO_SIMULATED_INFERENCE`(`:126`)、`DJANGO_VISION_DEMO_SIMULATION_ENABLED`(`:127`)、`PYTHONNOUSERSITE`(`:128`)、`PYTHONUTF8`(`:129`)、`DJANGO_SETTINGS_MODULE`(`:130`)，並清除代理變數（`:140-147`）。

---

## 11. 凍結保護模組（教師補充指令 2026-10-12）

| 凍結模組 | 實作位置 | 凍結理由 |
| --- | --- | --- |
| R07 提交流程 | `views.py:994` + `vision_submission.py:235` + `vision_api.py:206` + `vision_center.py:480` | 已驗證 |
| M1–M4 前端版本（手機版響應式排版） | `src/app.js:779-847`（`motor-check-grid` / `renderPropellerInspectionResult:901`）+ `src/styles.css`（`@media (max-width:680px)` 單欄覆寫） | 已驗證 |
| RAG 學生前端問答 | `src/rag-client.js` + `main.py:487` `rag_ask_proxy` + `main.py:562` | 已驗證 |

> **本輪與後續**：不得重做上述模組；不得修改其程式碼、路由、資料表。僅可在架構層「引用」與「預留接口」。

---

## 12. 未找到 / 待確認清單

| 編號 | 項目 | 狀態 | 處理原則 |
| --- | --- | --- | --- |
| `Q-01` | FDE-Safe-Dev Skill | **未找到** | 改以 `AGENTS.md` + `docs/architecture/FDE-DEVELOPMENT-CHARTER.md` 為安全依據 |
| `Q-02` | F450 數位孿生獨立專案路徑 | **位置待確認**（版本已存在） | 架構圖僅預留接口；待教師提供路徑後再評估連接性 |
| `Q-03` | 外部 `yolo_server.py` 原始碼 | **未找到** | 僅確認呼叫契約（`/api/health`、`/api/detect`） |
| `Q-04` | RAG 服務本體與 1105 docs 語料 | **未找到** | 僅確認呼叫契約（`/api/rag/ask`） |
| `Q-05` | 後端 STT / TTS 實作 | **未找到** | 語音目前為瀏覽器原生（前端） |
| `Q-06` | `docs/verification/phase1a2/*-checklist.md` 之外的官方檢查清單檔案 | **未找到** | 以本輪指令內文為驗收依據 |
| `Q-07` | `download-center-entry.test.cjs` 與 `homepage-portal-entry.test.cjs` 斷言矛盾 | **已確認矛盾** | 列入 `RISK-07`，待教師決策是否修正 |
| `Q-08` | `dashboard` / `flight-health-entry` section 有 id 無路由 | **已確認** | 列入 `RISK-08` |
| `Q-09` | 8 個區塊路徑在 8111 直開會 404 | **已確認** | 列入 `RISK-09` |

---

## 13. P0 驗收狀態區分（教師指令 2026-10-12 要求）

| 項目 | 狀態 |
| --- | --- |
| **A. 六份架構文件已交付**（`PHASE-00-A`） | ✅ **已達成** |
| **B. P0 全部驗收條件已通過**（`PHASE-00-B`） | ⏸ **未達成** → 本輪結果為「**文件已交付／驗收待教師確認**」，不得宣告完全通過 |

**B 項未達成的原因（未關閉的 R3 ／ R4 阻擋項）**：

| 編號 | 風險 | 等級 | 說明 |
| --- | --- | --- | --- |
| `RISK-06` | F450 數位孿生路徑未確認 | **R3** | 有版本但位置不明，`INT-08`／`INT-09` 無法評估 |
| `RISK-12` | F450 數位孿生「有版本但路徑未確認」 | **R3** | 本輪新增，因「有版本但找不到」比「不存在」更易誤判 |
| `RISK-02` | 雙軌視覺系統無同步 | **R3** | Django SQLite ↔ Live JSON Store |
| `RISK-03` | 8 個區塊路徑在 8111 直開會 404 | **R3** | 僅 `/`、`/eagle` 有註冊 |
| `RISK-05` | 五階段成果未系統性回寫成長證據鏈 | **R3** | 僅 R07 自動回寫 |

> 依教師補充指令複審，本輪**不得**直接宣告 P0 完全通過。`AGENTS.md:12-13` 亦規定測試須區分 AUTOMATED PASS 與 REAL DEVICE PASS，本輪為文件審查，未含任何真機驗收。

---

## 14. 盤點統計

| 統計項 | 數量 |
| --- | --- |
| `WORKING` 功能模組 | 47 |
| `PARTIAL` 功能模組 | 3（YOLO 真實推論、RAG 服務、Golden Test 頁） |
| `MISSING` 功能模組 | 3（後端 STT/TTS、外部 yolo_server 源碼、RAG 語料） |
| **`EXISTS_BUT_LOCATION_UNKNOWN` 獨立模組** | **1（F450 數位孿生）** |
| 已存在的模組連接 | 6（見 `FDE_AI_2_0_Module_Integration_Matrix.md`） |
| 尚未存在或未驗證的連接 | 9 |
| R2 風險 | 3 |
| R3 風險 | 4 |
| R4 風險 | 6 |
| **本輪產品程式修改** | **0** |
| **本輪正式資料修改** | **0** |

---

*本文件為唯讀稽核產出。未修改任何產品程式、API、頁面、導航、路由、資料表；未 Commit / Push / Merge / Deploy。*
