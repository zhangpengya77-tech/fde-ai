# FDE-AI-UAS 2.0｜整體系統架構、模組清單與開發順序

> 建立者：WorkBuddy
> 建立日期：2026-10-08
> 性質：**規劃與盤點文件（MD-only）**。本輪**未修改任何產品程式碼**。
> 依據指令：【FDE-AI-UAS 2.0｜開發方向修正指令】—「先完成平台框架，再逐步接入功能；不要把時間花在已經獨立存在的工具上。」
> 盤點方式：唯讀掃描磁碟真實程式碼（不依賴舊文件推測）。

---

## 0. 本輪指令遵循聲明

### 0.1 已立即停止的非必要工作

| # | 指令要求停止的事項 | 本輪狀態 |
|---|---|---|
| 1 | 不再檢查 YOLO Student Lite 的類別新增／修改／刪除功能 | ✅ 已停止 |
| 2 | 不修改 `data.yaml` 產生流程 | ✅ 未修改 |
| 3 | 不修改 YOLO 訓練程序或 best.pt 輸出功能 | ✅ 未修改 |
| 4 | 不重構現有標註軟體 | ✅ 未重構 |
| 5 | 不將 YOLO Student Lite 強制整合進 2.0 | ✅ 未整合 |

### 0.2 上一輪（第三輪）結論的處置

上一輪 Task A 已完成盤點並發現「學員類別順序與平台契約先天不符（ID 0 與 ID 3 對調）」。
**本輪依指令不再推進該修改**。此發現僅作為「未來接入時的已知契約差異」記錄於第 6.3 節，**不進入開發**。

### 0.3 開發限制遵循

- ✅ 嚴格遵守 FDE-Safe-Dev（AGENTS.md 16 條）
- ✅ 未修改 v1.5C（`D:\FDE-AI-UAS\v1.5C`）
- ✅ 未修改 Flight Health AI（`flight-health/`、`D:\FDE-Flight-Health-AI`）
- ✅ 未破壞現有 2.0 功能（僅新增本文件）
- ✅ 未提前實作完整模型訓練／審核／推論功能
- ✅ 未新增任何技術依賴

---

## 1. 整體系統架構圖

### 1.1 五層架構

```
┌──────────────────────────────────────────────────────────────────────┐
│ 第 1 層｜使用者端                                                      │
│   學員手機 · 學員桌機 · 教師後台 · 講師投影                              │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ HTTPS / HTTP
┌───────────────────────────────▼──────────────────────────────────────┐
│ 第 2 層｜前端靜態層（GitHub Pages 部署，vanilla JS）                     │
│   入口首頁 index.html + src/    Live Coach live/    下載中心 downloads/ │
│   Flight Health flight-health/（外部模組，凍結）                        │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ HTTP / JSON
┌───────────────────────────────▼──────────────────────────────────────┐
│ 第 3 層｜服務層                                                        │
│  ┌────────────────────┐ ┌────────────────────┐ ┌──────────────────┐ │
│  │ Live Backend :8030 │ │ 學員入口 Django     │ │ Vision 推論 :8765│ │
│  │ Starlette/Uvicorn  │ │ :8022 正式（凍結）  │ │ RAG 知識庫 :8770 │ │
│  │ Session/SOP/Coach  │ │ :8020 dev          │ │                  │ │
│  │ ＋Vision Center API│ │ :8023 test         │ │                  │ │
│  └────────────────────┘ └────────────────────┘ └──────────────────┘ │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────┐
│ 第 4 層｜資料層                                                        │
│   Django DB + private_media · Vision Center JSON · Golden Set · 下載清單│
└───────────────────────────────┬──────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────┐
│ 第 5 層｜外部獨立工具與隔離區（不修改其程式碼）                            │
│   YOLO Student Lite（標註／訓練）· Flight Health AI · MP-12（獨立 WT）  │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.2 服務埠一覽（磁碟與執行時實測）

| 埠 | 服務 | 進程 | 狀態 | 可否修改 |
|---|---|---|---|---|
| **8030** | Live Backend（含 Vision Center API） | Starlette/Uvicorn | v2.0 開發中 | ✅ 本專案主要開發對象 |
| **8022** | 學員入口 Django（v1.5C 正式） | Django | 運行中（PID 21360） | 🔴 **絕對凍結** |
| **8020** | 學員入口 Django（dev） | Django | 未啟動 | ⚠️ 可啟動（隔離） |
| **8023** | 學員入口 Django（test） | Django | 未啟動 | ⚠️ 可啟動（隔離） |
| **8765** | Vision 推論服務 | YOLO server | 未啟動 | ⚠️ 可啟動（不得載入未受信任權重） |
| **8770** | RAG 知識庫 | RAG service | 運行中（PID 14640） | 🔴 正式服務，禁改 |
| 8040 | Flight Health API（外部專案） | FastAPI | 未啟動 | 🔴 外部模組，禁改 |
| 5173 / 8000 | YOLO Student Lite 前端／後端 | 外部產品 | 運行中 | 🔴 **外部工具，不修改** |

### 1.3 核心資料流

**① 學生即時教學閉環（P0，已實作）**

```
手機鏡頭（1 FPS）
  → Live Backend :8030（擷取 + 編排）
  → YOLO 推論 :8765（Detection Facts）
  → SOP Engine（唯一教學決策引擎）
  → 判定 PASS_CANDIDATE / TEACHER_CHECK
  → 字幕 + 語音回饋（學生端不得自行斷言 PASS/NG）
  ├→ RAG :8770（非同步解釋，僅顯示、不影響判定）
  └→ Django 學習歷程（教師覆核後才寫入）
```

**② 模型飛輪閉環（P1，僅規格、未實作）**

```
1 外部標註（YOLO Student Lite）
  → 2 產出 best.pt（外部訓練）
  → 3 R07 提交（學員端上傳）
  → 4 教師審核（列為候選，非 ACTIVE）
  → 5 隔離測試 + Golden Set 驗證
  → 6 ACTIVE 切換（每型別同時僅 1 個）
  → 回到 1（下一屆以 ACTIVE 為基底繼續訓練）
```

### 1.4 信任邊界（安全鐵律）

| 邊界 | 規則 | 實作位置 |
|---|---|---|
| 學生端 | 不得斷言 PASS/NG、不得決定安全 | `sessions.py` / `V2_ARCHITECTURE.md` |
| AI 助教 | 只「解釋」，不「決定」 | `guidance.py` / `rag_guidance.py` |
| 規則引擎 | SOP Engine 是唯一教學決策者 | `sop.py` |
| 教師 | 唯一可啟用模型、覆核安全 | `vision_api.py` `_teacher()` |
| 模型 | 未受信任 `.pt` 不得在服務進程內載入 | ⚠️ **現況未達成，見第 6.2 節** |

---

## 2. 模組清單

### 2.1 後端服務模組（`live_backend/app/`，共 28 個檔案）

| 模組 | 大小 | 職責 | 主要對外介面 |
|---|---|---|---|
| `main.py` | 39.9 KB | 組裝 Starlette app、路由、依賴注入 | `create_app()` |
| `config.py` | 1.3 KB | 服務設定（frozen dataclass） | `LiveConfig.from_environment()` |
| `sessions.py` | 41.3 KB | Session 生命週期與權威狀態機 | `InMemorySessionStore`、`LiveSession` |
| `task_catalog.py` | 33.7 KB | F450 Main-12 課程目錄 | `load_f450_course()`、`validate_course()` |
| `task_state.py` | 18.6 KB | 任務／步驟狀態機、教師複核 | `TrainingProgress`、`TaskProgress`、`TeacherReview` |
| `training_records.py` | 7.0 KB | 訓練證據與反思紀錄 | `EvidenceRecord`、`StudentReflection`、`ModelSubmissionStatus` |
| `coach_ask.py` | 13.6 KB | 學生問答分類與 AI/視覺/安全路由 | `LiveCoachAskService.answer()` |
| `guidance.py` | 1.9 KB | 決定性引導提供者 | `DeterministicGuidanceProvider.get_guidance()` |
| `orchestrator.py` | 1.8 KB | 編排（不繞過 SOP、不確認步驟） | `CoachOrchestrator.process()` |
| `sop.py` | 4.7 KB | **唯一教學決策引擎** | `SopEngine.evaluate()` |
| `rag.py` / `rag_context.py` / `rag_guidance.py` | 4.3/3.0/2.6 KB | RAG 查詢、上下文建構、引導 | `RAGAdapter.query()`、`RAGContextBuilder.build()` |
| `safety.py` | 1.9 KB | 13 條安全提醒 | `SAFETY_REMINDERS` |
| `teacher_style.py` | 2.8 KB | 教師人設層（簡轉繁、斷句） | `TeacherStyleLayer.apply()` |
| `vision.py` | 3.9 KB | Vision 轉接器 | `VisionAdapter.detect()` |
| `vision_api.py` | 16.0 KB | **Vision Center 唯一 HTTP 入口** | `vision_routes(center)`（19 條） |
| `vision_center.py` | 39.8 KB | **Vision Center 唯一權威核心** | `VisionCenter`、`JsonStore`、`evaluate_prop()`、`analyze_hover()` |
| `benchmark.py` | 14.7 KB | 槳葉基準測試沙箱（契約隔離） | `PropBenchmarkSandbox.run()`、`PropValidationSet` |
| `mock_vision.py` | 0.7 KB | Dev/Test 決定性假偵測 | `MockVision.scenario()` |
| `mp12_catalog.py` / `mp12_models.py` / `mp12_state.py` | 12.5/0.6/7.7 KB | MP-12 Mission Planner 子任務 | `load_mp12_catalog()`、`MissionPlannerProgress` |
| `download_center.py` | 10.8 KB | 下載中心（Range 串流） | `manifest_endpoint()`、`download_endpoint()` |
| `hardware_profiles.py` | 2.2 KB | 硬體設定檔 | `F450_PIXHAWK248`、`get_hardware_profile()` |
| `identifiers.py` | 1.2 KB | 元件／連接器／電源 ID 驗證 | `validate_identifier()` |
| `errors.py` | 0.5 KB | 統一 JSON 錯誤回應 | `json_response()`、`error_response()` |
| `providers/` | 5 檔 | 通用 AI 供應者抽象 | `GeneralAIProvider`、`GeneralAIProviderManager` |

### 2.2 學員入口模組（`student_portal/`，Django）

| 模組 | 職責 | 備註 |
|---|---|---|
| app：`learning`（唯一） | 學員／教師所有業務邏輯 | `LearningConfig` |
| `learning/models.py` | **17 個 model**：Cohort、LearningGroup、Enrollment、ClassCode、GrowthRecordDefinition、GrowthRecordSubmission、StudentSurvey、TeacherCohortAccess、StudentProfile、TaskDefinition、TaskDefinitionRevision、StudentTaskProgress、PhaseProgress、Evidence、GrowthRecordReview、TeacherReviewEvent、CandidatePool、EmailVerificationCode | 權威資料模型 |
| `learning/views.py` | 81.7 KB，學員端 + 教師端 view | `student_required` / `teacher_required` 權限 |
| `learning/urls.py` | 56 條路由 | 含 `teacher/vision-models/*` |
| `learning/vision_rule_templates.py` | 規則模板（唯讀內建） | `PROP_DIRECTION_V1`、`FOUR_SIDE_HOVER_V1` |
| `learning/vision_submission.py` | 學員模型提交至 Vision Center | `submit_model_evidence_to_vision()` |
| `learning/templates/learning/` | 學員／教師頁面 | 含 `teacher_vision_model_list/detail.html` |
| `learning/tests/` | 26 檔、253 個測試 | 本專案最大測試集 |

### 2.3 前端模組

| 模組 | 檔案 | 職責 | 後端依賴 |
|---|---|---|---|
| 入口首頁 | `index.html` + `src/`（20 檔） | SPA 入口、12 任務地圖、模組導航 | RAG :8770、Vision :8030 |
| Live Coach | `live/`（`index.html` 27 KB、`live.js` 143 KB、`live.css` 25 KB） | F450 即時實訓助教學生頁 | Live Backend 相對路徑 `/api/live/*` |
| Live 自動觀察 | `live/auto-observation.js` | 1 FPS 排程（同時最多 1 個在途請求） | — |
| 下載中心 | `downloads/`（`index.html`、`downloads.js`、`downloads.css`） | 學員檔案下載 | `/api/downloads` |
| Flight Health | `flight-health/`（`index.html`、`css/`、`js/app.js` 37 KB、`js/config.js`） | 飛行健康度前端 | 🔴 外部：:8040 |
| 前端設定 | `src/rag-config.js` | **所有後端 base URL 單一來源** | — |

**前端 base URL 常數（`src/rag-config.js`）**

```js
RAG_API_BASE_URL:    'http://127.0.0.1:8770'   // F450 RAG
VISION_API_BASE_URL: 'http://127.0.0.1:8030'   // Live Backend / Vision Center
LIVE_COACH_URL:      '/live/'
RAG_API_MODE / VISION_API_MODE: 'auto'
```

### 2.4 部署與運維

| 模組 | 檔案 | 用途 |
|---|---|---|
| Cloudflare | `cloudflare/dev-phase1a/worker.mjs`、`wrangler.example.jsonc` | Phase 1A 開發期 Worker 範例（未部署） |
| 運維腳本 | `ops/classroom-start.ps1`、`classroom-stop.ps1`、`ops/v2/start-phase1a.ps1` 等 11 檔 | 課堂啟動／停止 |
| 下載清單工具 | `tools/refresh_download_manifest.py` | 產生含 SHA-256 的清單 |
| 資格測試 | `tools/qualify_live_propellers.py`、`qualification/live_propellers/` | 槳葉資格驗證 |
| 驗證資料 | `validation_sets/prop/manifest.json` | Golden Set 治理（現 `BLOCKED_NO_REAL_SAMPLES`） |

---

## 3. 已完成功能（P0 及之前）

| 功能 | 狀態 | 證據 |
|---|---|---|
| F450 Main-12 課程目錄（TASK_01–12） | ✅ 完成 | `task_catalog.py` `load_f450_course()`；測試 `test_f450_task_catalog.py` |
| 任務／步驟狀態機 + 教師閘門 | ✅ 完成 | `task_state.py`；測試 `test_f450_task_state.py` |
| Session 生命週期與事件 | ✅ 完成 | `sessions.py`；測試 `test_sessions.py`、`test_phase2_sessions.py` |
| SOP 教學決策引擎 | ✅ 完成 | `sop.py`；測試 `test_sop.py` |
| Live Coach 即時教學迴路 | ✅ 完成 | 11 階段主流程 AUTOMATED PASS；`docs/verification/p0-1-closeout-report.md` |
| 1 FPS 自動觀察（無佇列） | ✅ 完成 | `live/auto-observation.js`；測試 `test_auto-observation` |
| RAG 上下文引導 | ✅ 完成 | `rag*.py`；測試 `test_rag*.py` 共 15 個 |
| 學員入口 Django（註冊／登入／啟用） | ✅ 完成 | `learning/views.py`；`test_auth.py`(21) |
| 學習歷程與成長紀錄 R01–R08 | ✅ 完成 | `growth_records_v1.json`；`test_growth_records.py`(36) |
| 教師後台（cohort 隔離） | ✅ 完成 | `teacher_cohorts(user)`、`teacher_required` |
| F450 12 任務資料基礎 | ✅ 完成 | `docs/verification/f450-12-task-data-foundation-report.md` |
| MP-12 Mission Planner 整合（後端 + 前端） | ✅ 完成 | `mp12_*.py`；`test_mp12_backend_integration.py`(14)、`live/mp12-frontend-integration.test.cjs` |
| 下載中心（本機 P0） | ✅ 完成 | `download_center.py`；`test_download_center.py`(7)；`docs/DOWNLOAD_CENTER.md` |
| Vision Center 核心（模型／資料集／評估／Golden Set） | ✅ 完成 | `vision_center.py`；`test_vision_center.py`(33) |
| Vision Center HTTP API（19 條路由） | ✅ 完成 | `vision_api.py`；`test_vision_api.py`(13) |
| 教師視覺模型規則模板（Django 端） | ✅ 完成 | `vision_rule_templates.py`；`test_vision_model_center.py`(8)、`test_vision_rule_templates.py`(3) |
| 學員 R07 模型提交（前端 + Django + API） | ✅ 完成 | `vision_submission.py`、`growth_model_upload`；`test_p1_model_submission.py`(11) |
| 槳葉基準測試沙箱（契約隔離） | ✅ 完成 | `benchmark.py`；`test_p1_2_benchmark.py`(21) |
| M1–M4 位置定義統一（M1右前/M2左後/M3左前/M4右後） | ✅ 完成 | 第二輪修正，5 檔已一致 |
| 通用 AI 供應者抽象 | ✅ 完成 | `providers/`；`test_general_ai_provider.py`、`test_general_ai_p05.py` |

**測試總量（磁碟實測）**

| 範圍 | 檔案數 | 測試數 |
|---|---|---|
| `live_backend/tests/` | 40+ | — |
| `student_portal/learning/tests/` | 26 | **253** |
| `live/`（前端 `.test.cjs`） | 20 | — |
| `src/`（前端 `.test.cjs`） | 9 | — |

---

## 4. 待開發功能

### 4.1 框架層（本階段優先，指令第二項）

| # | 功能 | 現況 | 本階段要做什麼 |
|---|---|---|---|
| F1 | **模組入口註冊表** | 散落於 `index.html` 側欄、`live/index.html` | 建立單一模組註冊來源，供首頁／導航／權限一致使用 |
| F2 | **模組健康檢查聚合** | 各服務各自 `/health` | 建立統一健康端點，回報 8030/8765/8770/8022 狀態 |
| F3 | **Vision Model Center 模組邊界文件化** | 已有 `vision_center.py` + `vision_api.py` | 明確標示唯一入口／唯一權威，禁止旁路（見第 5 節） |
| F4 | **接口規格凍結（v1）** | 19 條路由已存在但無凍結規格書 | 產出 `/api/v1/vision/*` 契約文件，作為未來接入依據 |
| F5 | **模組狀態看板** | 無 | 教師後台顯示各模組完成度與資料流狀態 |
| F6 | **資料流契約測試** | 部分存在（`test_platform_integration_contract.py`） | 補齊模組間契約測試 |

### 4.2 Vision Model Center 後續功能（本階段僅預留接口，不實作）

| # | 功能 | 現況 | 預留方式 |
|---|---|---|---|
| V1 | 學員 best.pt 提交 | ✅ 已存在（`POST /submissions`） | 已可用 |
| V2 | 教師審核（列為候選） | ✅ 已存在（Django 端 + `import_submission`） | 已可用 |
| V3 | 教師選定 Candidate 並上傳測試圖片 | ❌ 未實作 | 預留 `POST /models/{id}/test-image` |
| V4 | 隔離模型執行環境 | ❌ **無可靠隔離**（阻斷） | 預留 `execution_environment` 欄位（見第 6.2 節） |
| V5 | 教師查看測試記錄 | ❌ 未實作 | 預留 `GET /models/{id}/test-records` |
| V6 | Golden Set 真實樣本 | ⚠️ `BLOCKED_NO_REAL_SAMPLES` | 維持現有 `PropValidationSet` 治理 |
| V7 | ACTIVE 模型切換 | ✅ 已存在（`POST /models/{id}/activate`） | 已可用，需 `VALIDATED` 前置 |
| V8 | 難例回流 | ✅ 已存在（`hard_examples`） | 已可用 |
| V9 | 飛輪倉庫（訓練資料沉澱） | ❌ 未實作 | 屬 P1 後段，本階段不做 |

### 4.3 其他後續（P2/P3，不在本階段）

| # | 功能 | 說明 |
|---|---|---|
| P2-1 | MP-12 深化 | 既有 worktree `D:\FDE-AI-UAS-MP12`，**禁重寫** |
| P3-1 | Flight Health 整合 | 外部模組，**禁重寫**；Task12 僅存 reference |
| P4 | 產業任務 / QGC Advanced | 遠期 |
| P5 | 3.0 多載具 | 遠期 |

---

## 5. Vision Model Center｜獨立模組入口與接口規格

### 5.1 模組定位

Vision Model Center 是 FDE-AI-UAS 2.0 的**獨立子系統**，負責「模型的完整生命週期治理」。

**邊界宣告（鐵律）**

| 角色 | 檔案 | 規則 |
|---|---|---|
| 唯一權威核心 | `live_backend/app/vision_center.py` | 所有模型狀態變更必須經此 |
| 唯一 HTTP 入口 | `live_backend/app/vision_api.py` | 前綴 `/api/v1/vision`，不得新增旁路 |
| 規則模板 | `student_portal/learning/vision_rule_templates.py` | 唯讀內建，非權威 |
| 教師審核介面 | `student_portal/learning/views.py` `teacher_vision_model_*` | 僅寫入 Django Evidence metadata |

**禁止事項**
1. 不得在前端直接操作模型狀態（前端只能呼叫 API）。
2. 不得繞過 `vision_api.py` 直接呼叫 `VisionCenter`。
3. 不得讓規則模板與 `vision_center.py` 的規則引擎各自為政（M1–M4 上次即因此出錯）。
4. 不得放寬 `UltralyticsModelValidator` 的類別驗證。

### 5.2 子域劃分

| 子域 | 儲存鍵 | 職責 |
|---|---|---|
| ① 模型倉庫 | `models` | 模型註冊、驗證、狀態、ACTIVE 切換 |
| ② 提交收件匣 | `submissions` | 學員提交的 `.pt` 中轉 |
| ③ 評測中心 | `evaluations` | 指標、評估狀態 |
| ④ Golden Set | `golden_sets` | 凍結黃金驗證集治理 |
| ⑤ 難例回流 | `hard_examples` | 未通過案例回流訓練 |
| ⑥ 資料集 | `datasets` | 訓練資料集版本與匯出 |
| ⑦ 攝影機設定 | `camera_profiles` | 裝置參數 |

### 5.3 持久化

```
JsonStore → %LOCALAPPDATA%\FDE-AI-UAS\vision-center\vision_center.json
          （或環境變數 FDE_VISION_CENTER_ROOT 覆寫）
結構：schema_version=1 + models/datasets/evaluations/hard_examples/
      camera_profiles/submissions/golden_sets
寫入：.tmp + os.replace() 原子寫入
```

### 5.4 核心常數（契約）

```python
PROP_CLASSES  = ("CW_F", "CCW_F", "CW_B", "CCW_B")
HOVER_CLASSES = ("FRONT", "RIGHT", "BACK", "LEFT")
MODEL_TYPES   = ("PROP_DIRECTION", "FOUR_SIDE_HOVER")
MODEL_STATUSES = ("DRAFT", "VALIDATING", "VALIDATED", "CANDIDATE",
                  "ACTIVE", "ARCHIVED", "REJECTED", "FAILED")
```

### 5.5 現有接口規格（19 條，`/api/v1/vision`）

| 方法 | 路徑 | 權限 | 職責 |
|---|---|---|---|
| GET | `/models` | 教師 | 列出模型 |
| POST | `/models` | 教師 | 上傳並驗證模型 |
| GET | `/models/{id}` | 教師 | 模型詳情 |
| POST | `/models/{id}/evaluate` | 教師 | 儲存評估結果 → `CANDIDATE` |
| POST | `/models/{id}/activate` | 教師 | 啟用（需 `VALIDATED`）→ `ACTIVE` |
| POST | `/models/{id}/archive` | 教師 | 封存 |
| POST | `/prop-check` | — | 槳葉推論 + `evaluate_prop()` |
| POST | `/hover-analyze` | — | 四面懸停分析 |
| POST | `/hover-video` | — | 影片懸停分析 |
| GET/POST | `/datasets` | 教師 | 資料集清單／建立 |
| POST | `/datasets/{id}/build-next` | 教師 | 建立下一代資料集 |
| GET | `/datasets/{id}/export` | 教師 | 匯出 ZIP |
| GET | `/hard-examples` | 教師 | 難例清單 |
| POST | `/hard-examples/{id}/review` | 教師 | 難例複核 |
| POST | `/camera-profiles` | 教師 | 攝影機設定 |
| GET/POST | `/submissions` | — | 提交清單／建立 |
| POST | `/submissions/{id}/import` | 教師 | 匯入為模型 |
| GET/POST | `/golden-sets` | 教師 | Golden Set 清單／建立 |
| GET | `/golden-sets/{id}` | 教師 | Golden Set 詳情 |

**教師授權方式**：`X-FDE-Role: teacher` + `X-FDE-Teacher-ID`（或 `X-FDE-User-ID`）。

### 5.6 預留接口（本階段僅定義，不實作）

> 依指令「預留未來 best.pt 模型提交、教師審核、Golden Test、ACTIVE 模型切換等功能」。
> 以下為**規格預留**，程式碼中**尚未實作**。

| 方法 | 路徑 | 用途 | 前置條件 |
|---|---|---|---|
| POST | `/models/{id}/test-image` | 教師上傳 1 張圖片送隔離環境測試 | **需可靠隔離環境**（見 6.2） |
| GET | `/models/{id}/test-records` | 教師查看測試記錄 | 需 V3 先完成 |
| POST | `/models/{id}/golden-test` | 以 Golden Set 執行完整驗證 | 需 Golden Set `image_count > 0` |
| GET | `/module/manifest` | 模組自我描述（供平台框架聚合） | 本階段框架用 |

**`/module/manifest` 回應規格（框架用，建議先實作）**

```json
{
  "module_id": "vision-model-center",
  "module_name": "Vision Model Center",
  "version": "1.0",
  "api_prefix": "/api/v1/vision",
  "capabilities": {
    "model_submission": true,
    "teacher_review": true,
    "isolated_test": false,
    "golden_test": false,
    "active_switch": true,
    "hard_example_feedback": true
  },
  "dependency": {
    "vision_inference": ":8765",
    "isolation_environment": "UNAVAILABLE"
  },
  "contract": {
    "prop_classes": ["CW_F", "CCW_F", "CW_B", "CCW_B"],
    "model_types": ["PROP_DIRECTION", "FOUR_SIDE_HOVER"]
  }
}
```

---

## 6. 風險與阻斷項目

### 6.1 已完成且無風險

- 平台核心（Live Coach、SOP、RAG、學習歷程、MP-12、下載中心）皆已實作且有測試。
- Vision Center 核心與 API 已就緒。

### 6.2 🔴 阻斷：無可靠模型隔離執行環境

| 檢查項 | 現況 |
|---|---|
| Windows 版本 | Windows 11 **家庭版** Build 26200 |
| 虛擬化 | `VirtualizationFirmwareEnabled=False`（BIOS 未開 VT-x） |
| 帳號權限 | `IsAdmin=False` → 無法啟用 Windows 功能 |
| Docker Desktop | 4.94.0 已安裝，daemon **未啟動** |
| 記憶體 / 磁碟 | RAM 15.74 GB（可用約 1.8 GB）／C 槽剩 12.37 GB |

**現有程式碼風險點（未修改）**
- `vision_center.py:82`：`UltralyticsModelValidator.validate()` 在**服務進程內**執行 `YOLO(path)`
- `benchmark.py:233`：`PropBenchmarkSandbox` 同樣在**服務進程內**載入模型
- 兩者皆為**契約隔離**，非安全隔離。`.pt` 是 PyTorch pickle，載入即執行任意程式碼。

**結論**：目前**不得**在 8030／8765／正式 Vision 中載入學員 `.pt`。
一般 `subprocess`、低權限帳號、Job Object **不構成**安全沙箱。

### 6.3 ⚠️ 已知契約差異（記錄用，本階段不處理）

學員 DB 的類別順序（`0=CCW-B, 1=CCW-F, 2=CW-B, 3=CW-F`）與平台契約（`CW_F, CCW_F, CW_B, CCW_B`）**先天不符**，ID 0 與 ID 3 對調。
→ 依本輪指令，**不修改 YOLO Student Lite**。未來接入時需以「提交時明確宣告類別對應」方式處理，**不放寬平台驗證**。

### 6.4 ⚠️ 服務歸屬未確認

**8030 目前未啟動**，無法由執行中程序反查身份；工具限制無法取得命令列。
→ **禁止啟動或接管 8030**，需用戶明確告知歸屬後方可進行。

---

## 7. 下一階段開發順序（建議）

> 依指令「先完成平台框架，再逐步接入功能」。

### 第 1 階段｜平台框架（建議本階段執行）

| 順序 | 任務 | 產出 | 風險 |
|---|---|---|---|
| 1-1 | **模組註冊表**（F1） | `live_backend/app/module_registry.py` + 單一設定來源 | 低 |
| 1-2 | **模組自我描述接口**（V-預留 `/module/manifest`） | 各模組提供 manifest | 低 |
| 1-3 | **統一健康檢查**（F2） | `GET /api/live/modules/health` 聚合 | 低 |
| 1-4 | **Vision Center 接口規格凍結 v1**（F4） | `docs/architecture/vision-model-center-api-v1.md` | 低（純文件） |
| 1-5 | **資料流契約測試**（F6） | 補齊模組間契約測試 | 低 |
| 1-6 | **模組狀態看板**（F5） | 教師後台頁面 | 中（動 UI，需確認） |

### 第 2 階段｜Vision Model Center 接入（需第 1 階段完成 + 隔離環境就緒）

| 順序 | 任務 | 依賴 |
|---|---|---|
| 2-1 | 教師選定 Candidate + 上傳測試圖片（V3） | 隔離環境 |
| 2-2 | 教師查看測試記錄（V5） | 2-1 |
| 2-3 | Golden Set 真實樣本建立（V6） | 真實標註資料 |
| 2-4 | ACTIVE 切換實戰驗證（V7） | 2-1～2-3 |

### 第 3 階段｜飛輪倉庫（P1 後段）

訓練資料沉澱、下一代資料集建構、難例回流閉環。

### 第 4 階段｜P2/P3（MP-12 深化、Flight Health 整合）

既有模組，**禁重寫**，僅整合。

---

## 8. 本輪交付總結

| 交付項 | 狀態 |
|---|---|
| 整體架構圖（五層） | ✅ 第 1 節 |
| 模組清單（後端／學員入口／前端／運維） | ✅ 第 2 節 |
| 已完成功能清單 | ✅ 第 3 節 |
| 待開發功能清單 | ✅ 第 4 節 |
| Vision Model Center 入口與接口規格 | ✅ 第 5 節（含預留接口） |
| 下一階段開發順序 | ✅ 第 7 節 |
| 產品程式碼修改 | ✅ **無**（本輪僅新增本文件） |

**依指令：未經確認，不進入 YOLO Student Lite 的功能修改。本輪完成，等待下一階段批准。**
