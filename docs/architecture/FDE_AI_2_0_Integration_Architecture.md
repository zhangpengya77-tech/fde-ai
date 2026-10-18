# FDE-AI-UAS 2.0｜整合架構文件（Integration Architecture）

| 項目 | 內容 |
| --- | --- |
| 文件編號 | `FDE_AI_2_0_Integration_Architecture.md` |
| 前置文件 | `FDE_AI_2_0_Current_State_Audit.md` |
| 專案目錄 | `D:\FDE-AI-UAS-v2.0` |
| 稽核日期 | 2026-10-12 |
| 性質 | **方案比較，不選定正式方案**。唯讀產出 |
| 圖例 | 🟩 綠＝已驗證功能（凍結保護）／🟨 黃＝待整合（接口存在、尚未接線）／🟥 紅＝待開發（尚不存在） |

> 本文件**只提出候選方案並比較**，不選定正式方案，不進行任何實作。

---

## 1. 六層架構（ARCH-01 ～ ARCH-06）

| 層級 | 名稱 | 現況實體 | 狀態 |
| --- | --- | --- | --- |
| **L6** | 使用者介面層（Presentation） | `index.html`（主站 13 section）、`live/index.html`（Live Coach）、`downloads/index.html`、`flight-health/index.html`、`student_portal` 38 個 Django 模板、`D:\FDE-AI-UAS-MP12` 前端 | 🟩 大部分 WORKING |
| **L5** | 學習流程層（Learning Flow） | 學（`learn`）→ 練（`practice`）→ 做（`build` + MP12）→ 測（`inspection`）→ 證（`certify` + R01–R08 成長紀錄） | 🟨 五階段有 UI，但**階段成果未回寫成長證據鏈** |
| **L4** | AI 能力層（AI Capability） | General AI（`providers/provider_openai.py`）、RAG（`rag.py`）、YOLO（`vision.py`）、SOP（`sop.py`）、Voice（前端 `live.js`）、教師風格層（`teacher_style.py`） | 🟩 六項皆存在 |
| **L3** | 服務層（Service） | Starlette Live Backend（`:8111` DEMO / `:8030` 正式）、Django Portal（`:8110` DEMO / `:8022` 正式）、YOLO `:8765`、RAG `:8770`、Flight Health `:8040` | 🟩 介面清楚 |
| **L2** | 資料層（Data） | Django SQLite（`student_portal/db.sqlite3` + DEMO `demo.sqlite3`）、Live JSON Store（`vision_center.json`）、模型倉庫（`model_registry/`）、媒體（`private_media/`）、下載 manifest（`download_manifest.json`） | 🟩 雙軌並行（見 `RISK-02`） |
| **L1** | 證據層（Evidence） | `Evidence`(models.py:526) → `GrowthRecordSubmission`(:164) → `GrowthRecordReview`(:605) → `VisionModelRecord`(:683) → `CandidatePool`(:656) | 🟩 WORKING |

---

## 2. 五階段主流程：學 → 練 → 做 → 測 → 證（FLOW-01 ～ FLOW-05）

| 階段 | 定義 | 現況承載 | 對應成長紀錄 | 狀態 |
| --- | --- | --- | --- | --- |
| **學** | 知識獲取 | `learn` section（`renderLearningResources:456`）、`fde-column`（`renderFdeColumn:492`）、課程影片與下載說明、下載中心 6 項軟體 | R01 無人機基礎認知 | 🟩 |
| **練** | 模擬與技能練習 | `practice` section（`renderPracticeResources:541`）、模擬器與考照練習 | R02 模擬飛行訓練、R04 證照技能驗證 | 🟩 |
| **做** | 實作與調參 | `build` section（`renderBuildWorkflow:559`、`renderBuildMain12Entry:1054`）+ **MP12 調參實訓**（`mp12_catalog.py` 12 子任務，掛 TASK_07）+ **F450 數位孿生（🟨 獨立模組／位置待確認／尚未整合）** | R05 F450 工程組裝 | 🟨（MP12 已接入主專案；F450 數位孿生路徑待教師提供後再評估） |
| **測** | 檢測與驗證 | `inspection` section（`renderAssessmentWorkflows:576`；`renderPropellerInspectionResult:901`、`renderHoverResult:958`）、手機槳葉辨識（`student_prop_scan:1121`）、教師 Vision Center 四區域 | R06 鷹眼 AI 目標檢測、R03 真機飛行訓練 | 🟩 |
| **證** | 成果存證與能力證據 | `certify` section（`renderCertificationChecklist:1109`）、`cohorts`（`renderCohorts:412`）、R01–R08 成長紀錄、`Evidence` / `GrowthRecordSubmission` / `VisionModelRecord` | R07 專業任務驗證、R08 綜合成果作品展示 | 🟨（R07 已通；**前四階段成果未系統性回寫**） |

### 2.1 核心缺口（`INT-01`）

**問題**：目前「學 → 練 → 做 → 測」四階段的任務成果，**沒有自動關聯至「證」階段的成長證據鏈**。唯一的自動回寫是 **R07 模型上傳**（`views.py:994` → `vision_submission.py:235`），其餘階段仍依賴學員手動 `evidence_add`（`views.py:1427`）。

**候選整合方式（僅比較）**：

| 方案 | 說明 | 優點 | 風險 |
| --- | --- | --- | --- |
| **A. 任務完成即回寫** | 各階段任務完成（`training_complete_task` `main.py:577`）時，由 Live Backend 產生 `EvidenceRecord`（`training_records.py`），同步至 Django `Evidence` | 自動化程度高；資料一致 | 需新增跨服務寫入；`RISK-01` PROTECT 鏈需重驗 |
| **B. 教師複核後回寫** | 維持現行 `training_evidence`（`main.py:583`）+ 教師 `review_task`（`views.py:2240`）雙軌，僅補「階段 → slot」對照表 | 最小改動；符合 `AGENTS.md:270-286` 安全原則 | 仍需學員手動上傳 |
| **C. 僅建立對照表，不回寫** | 只新增「階段 ↔ R0x」靜態對照（文件層），實際回寫留待後續 | 零風險；純規劃 | 不解決自動化 |

> **本文件不選定方案。** 建議留待教師決策（`Q-10`）。

---

## 3. Mission Planner 整合候選方案比較（INT-02）

### 3.1 現況（已存在）

MP12 目前以 **file-level adoption** 存在於主專案：`live_backend/app/mp12_*.py` + `live/index.html:50-113` `#missionPlannerPanel` + `live/live.js:549-567`。獨立 worktree `D:\FDE-AI-UAS-MP12`（分支 `fde-ai-v2.0-mp12-dev`）尚未 Merge。

### 3.2 MP12 已接入與未接入範圍（教師指令 2026-10-12 要求補齊）

| 分項 | 內容 | 位置 | 狀態 |
| --- | --- | --- | --- |
| **① 已在主專案** | 後端資料模型 `MissionPlannerSubtaskDefinition` | `live_backend/app/mp12_models.py:7-22` | ✅ 存在 |
| | 目錄定義 `_MP12_CATALOG`（MP01–MP12 共 12 筆） | `live_backend/app/mp12_catalog.py:38`（`_subtask():6-35`） | ✅ 存在 |
| | 狀態機 `MissionPlannerProgress` | `live_backend/app/mp12_state.py` | ✅ 存在 |
| | 後端 handler 3 支 | `live_backend/app/main.py:321/328/335`（`training_mp12_select/complete/teacher_review`） | ✅ 存在 |
| | Session 層方法 3 支 | `live_backend/app/sessions.py:331-353`（`select_mp_subtask/complete_mp_subtask/review_mp_subtask`） | ✅ 存在 |
| | 前端面板 `<section id="missionPlannerPanel">` | `live/index.html:52`（`:50-113`） | ✅ 存在 |
| | 前端樣式 `.mp12-*` | `live/live.css:118-124+` | ✅ 存在 |
| | 前端邏輯 3 支 endpoint 呼叫 + `renderMissionPlannerState` | `live/live.js:549-567`、`:931-957` | ✅ 存在 |
| **② 仍在獨立 worktree** | 完整 MP12 站點（`index.html`、`src/`、`live/`、`live_backend/app/`、`student_portal/`、`docs/`、`tests/`、`cloudflare/`、`ops/`） | `D:\FDE-AI-UAS-MP12`（分支 `fde-ai-v2.0-mp12-dev`） | 🟨 獨立 |
| | worktree 獨有測試：`test_mp12_api.py`、`test_mp12_catalog.py`、`test_mp12_state.py` | `D:\FDE-AI-UAS-MP12\live_backend\tests\` | 🟨 **主專案無對應** |
| | worktree 獨有前端測試：`mp12-ui.test.cjs` | `D:\FDE-AI-UAS-MP12\live\` | 🟨 **主專案無對應** |
| | worktree 驗收截圖 | `D:\FDE-AI-UAS-MP12\.test-temp\mp12-acceptance\` | 🟨 獨立 |
| **③ 已接通的路由** | `POST /api/live/sessions/{session_id}/training/mp12/{subtask_id}/select` | `main.py:578` | ✅ **已接通** |
| | `POST .../training/mp12/{subtask_id}/complete` | `main.py:579` | ✅ **已接通** |
| | `POST .../training/mp12/{subtask_id}/teacher-review` | `main.py:580` | ✅ **已接通** |
| | 前端呼叫上述三支 | `live/live.js:549-567` | ✅ **已接通** |
| **④ 只是頁面或資料接口** | MP12 面板掛在 `TASK_07` 深度子模組（非獨立任務） | `main.py:317`、`sessions.py:331` | ⚠️ 頁面層 |
| | 目錄資料 12 筆從前端讀取後渲染（靜態資料，非只讀 API） | `mp12_catalog.py:38` → `live/live.js` | ⚠️ 資料接口 |
| | 教師複核僅 MP06／MP08／MP11／MP12 四筆需現場複核 | `live/index.html:87` | ⚠️ 邏輯散布前端 |
| | **未經由 Django 教師端**（教師複核走 Live Backend 自身 handler，非 `teacher_vision_center` 四區域） | `main.py:335` | ⚠️ **與 Django 教師端未打通** |
| **⑤ 尚未端到端驗收** | 主專案的 MP12 測試僅 2 支：`live/mp12-frontend-integration.test.cjs`、`live_backend/tests/test_mp12_backend_integration.py` | — | ⚠️ 只有 AUTOMATED |
| | **未經 iPhone 真機驗收** | — | ⚠️ `REAL DEVICE` PENDING |
| | **未經教師現場複核流程驗收**（教師複核路徑存在但未實測） | — | ⚠️ 待驗收 |
| | **MP12 worktree 未 Merge**（獨立分支 `fde-ai-v2.0-mp12-dev`） | — | ⚠️ `AGENTS.md:153-161` 禁止未經要求 Merge |

**MP12 整合性質結論**：主專案採 **file-level adoption**（同一程式基底，非 iframe、非外部獨立 API）。**本輪不合併、不重寫、不補開發。**

### 3.3 四方案比較（**只比較，不選定**）

| 面向 | **方案 A：Deep Link** | **方案 B：Embed（iframe）** | **方案 C：API Integration** | **方案 D：暫不整合** |
| --- | --- | --- | --- | --- |
| **做法** | 主站導航加外部連結指向 MP12 站點 | 主站以 `<iframe>` 內嵌 MP12 頁面 | 主站前端呼叫 MP12 後端 API，UI 自繪 | 維持現狀（file-level adoption），不做新整合 |
| **改動範圍** | 1 處導航（`src/app.js:82-88`） | 1 個 section + 1 個 iframe | 前端 + 後端 Adapter | **0** |
| **與現況衝突** | 低 | 中（MP12 已有獨立前端 `index.html`） | 中（需新增契約） | 無 |
| **違反 `AGENTS.md:182-217`（Existing Architecture First）** | 否 | 否 | 否 | 否 |
| **違反 `AGENTS.md:100-117`（Do Not Expand Scope）** | 否 | 否 | 需評估 | 否 |
| **資料一致性** | 差（跨站、無共用 session） | 中（共用瀏覽器 session，但無資料共享） | **佳**（同一 Session 層 `sessions.py:331-353`） | 佳（現況已共用） |
| **行動裝置可用性** | 佳 | **差**（iframe 在 iOS Safari 有滾動/高度問題） | 佳 | 佳 |
| **教師複核一致性** | 差（MP12 有獨立教師複核 UI） | 差 | **佳**（可複用 `review_mp_subtask:353`） | 佳 |
| **實作成本** | 極低 | 低 | 中高 | 零 |
| **風險等級** | R1 | R2 | R2 | R0 |
| **阻擋後續開發** | 否 | 否 | 否 | 否 |

### 3.3 各方案關鍵事實依據

- **方案 A**：主站導航項目由 `src/app.js:82-88` `primaryNav` 產生，新增一筆 `{ label, title, href }` 即可（模式同 `flight-health` 的 `href: '/flight-health/'`）。
- **方案 B**：主站已有 `Mount` 模式（`main.py:565` `Mount("/flight-health", StaticFiles(html=True))`），可類比。但 MP12 前端依賴自身 `live.js`（143 KB）與 session，iframe 內跨 origin 會有問題。
- **方案 C**：**最符合現況**——`mp12_*` 模組與路由（`main.py:578-580`）**已在主專案內**，Session 層（`sessions.py:331-353`）已支援。真正待決的是「MP12 獨立 worktree 是否 Merge 回主線」。
- **方案 D**：現況即為此方案（file-level adoption）。`AGENTS.md:153-161` 明確禁止未經要求 Merge MP-12。

> **本文件不選定方案。** 建議留待教師決策（`Q-11`）。

---

## 4. F450 可連接性評估（INT-03 ～ INT-09）

依教師指示，逐項評估「數位孿生、攝影機、視覺模型、SOP、RAG、LLM、證據提交」之間的**實際可連接性**。

| 編號 | 連接對 | 現況 | 可連接性 | 依據 |
| --- | --- | --- | --- | --- |
| `INT-03` | 攝影機 → 視覺模型 | 🟩 **已連接** | 高 | `live.js:46` `getUserMedia` → `main.py:571` `snapshot` → `main.py:413` `adapter.detect` → `vision.py:55` |
| `INT-04` | 視覺模型 → SOP | 🟩 **已連接** | 高 | `orchestrator.py:15` `process` → `orchestrator.py:23` `SopEngine.evaluate` |
| `INT-05` | SOP → RAG | 🟩 **已連接** | 高 | `orchestrator.py` → `rag_guidance.py` `ContextualGuidanceCoordinator` |
| `INT-06` | RAG → LLM | 🟩 **已連接** | 高 | `coach_ask.py:61` `answer` → `:151` `_general_answer` → `provider_manager.py:29` |
| `INT-07` | LLM → 證據提交 | 🟨 **部分** | 中 | 目前僅 R07 模型上傳會產生 `Evidence`（`views.py:1029`）；一般 AI 回答**不回寫**證據 |
| `INT-08` | 數位孿生 → 攝影機／視覺模型 | 🟨 **獨立模組／位置待確認／尚未整合** | **無法評估**（路徑未確認） | F450 數位孿生**已有獨立開發版本，但完整專案路徑未確認**（`AUD-05` 已修正，教師指令 2026-10-12）。若未來連接，最自然的接口是：孿生輸出合成影像 → 餵入 `vision.py` 檢測鏈（與真實攝影機同構）。本輪**僅預留文件層級接口契約，不整合程式** |
| `INT-09` | 數位孿生 → SOP／證據提交 | 🟨 **獨立模組／位置待確認／尚未整合** | **無法評估**（路徑未確認） | 同上。`build` section 現有 `renderBuildWorkflow:559` 為純前端流程，無孿生狀態。若未來連接，候選接口為：孿生狀態變更 → `training_step_fact`（`main.py:581`）→ `Evidence` |

### 4.1 F450 相關已存在的連接（**不重做**）

| 連接 | 位置 | 狀態 |
| --- | --- | --- |
| F450 組裝流程 UI | `src/app.js:559` `renderBuildWorkflow`、`:1054` `renderBuildMain12Entry` | 🟩 |
| F450 12 任務目錄 | `task_catalog.py:309` `load_f450_course()`（`:315-324`） | 🟩 |
| F450 槳葉方向檢測 | `vision_center.py::evaluate_prop` + `learning/vision_rule_templates.py` | 🟩（**M1–M4 前端凍結**） |
| F450 硬體設定檔 | `hardware_profiles.py` `F450_PIXHAWK248` | 🟩 |

---

## 5. R07 與成長證據鏈資料流（INT-10）

### 5.0 三層概念釐清（**不得混淆為同一個已完成接口**，教師指令 2026-10-12）

`ai_flight_assessment`／`PROP_DIRECTION`／`R07` 是**三個不同層級**的概念，互不等同：

| 層級 | 值 | 權威來源 | 說明 |
| --- | --- | --- | --- |
| **專業方向**（`Enrollment.project_direction`） | `ai_flight_assessment`、`uav_3d_mapping`、`autonomous_mission`、`flight_f450` | `learning/data/project_directions_v1.json`（`direction_keys`） | 學員所屬專業組別；僅 `ai_flight_assessment` 開放模型上傳 |
| **模型類型**（Live Backend `MODEL_TYPES`） | `PROP_DIRECTION`、`FOUR_SIDE_HOVER` | `live_backend/app/vision_center.py:17` | Vision Center 的任務代碼；影響 classes、rule_version、目錄 |
| **成長紀錄 slot**（`GrowthRecordDefinition.slot_id`） | `R01`–`R08` | `learning/data/growth_records_v1.json`；驗證 `models.py:130` `^R0[1-8]$` | 八項成長紀錄；R07 = 「專業任務驗證」 |

**實際對應關係（已核對程式碼，非推測）**：

```
Enrollment.project_direction == "ai_flight_assessment"     ← 專業方向
        │
        │ gate：views.py:1005（非此方向 → "此專業方向不開放模型成果上傳"）
        ▼
GrowthRecordSubmission.slot_id == "R07"                    ← 成長紀錄 slot
        │
        │ views.py:1038 / 1046
        ▼
task_type="PROP_DIRECTION"  （硬編碼，非由前端選擇）        ← 模型類型
        │
        ▼
POST /api/v1/vision/submissions
```

| 關係 | 結論 | 依據 |
| --- | --- | --- |
| `ai_flight_assessment` → `PROP_DIRECTION` | **1:1 硬編碼**，非多對多 | `views.py:1038`（`original_metadata.task_type`）與 `views.py:1046`（`submit_model_evidence_to_vision(task_type=...)`）均為字面值 |
| `R07` → `PROP_DIRECTION` | **僅此一條**。R07 路徑只產出 PROP_DIRECTION 模型 | 同上 |
| `FOUR_SIDE_HOVER` → R07 上傳路徑 | ❌ **不在** R07 學員上傳路徑 | `views.py:994` 無任何 FOUR_SIDE_HOVER 分支；`vision_center.py:522` import 僅接受 `task_id == "PROP_DIRECTION"` |
| `FOUR_SIDE_HOVER` → 其他路徑 | ✅ 存在於：`/api/v1/vision/hover-analyze`（`vision_api.py:121-133`）、`/api/v1/vision/hover-video`（`vision_center.py:638 process_video`）、模型倉庫 `four_side_hover/`（`vision_center.py:368`） | 教師端分析鏈，**非學員 R07 提交鏈** |
| Golden Set 對 `FOUR_SIDE_HOVER` | ⚠️ **合法型別但本輪不開放** | `learning/golden_set.py:10`「本輪只支援 PROP_DIRECTION_V1」；`tests/test_golden_set_center.py:121` 預期 FOUR_SIDE_HOVER 被拒絕；而 `tests/test_golden_set_contract.py:605-606` 註解指其為合法型別 → **兩處測試語意不一致**（`RISK-11`） |

> **教師指令要求**：不得把不同任務流程誤認為同一個已完成的接口。據此，`PROP_DIRECTION`（R07 上傳＋手機檢測）與 `FOUR_SIDE_HOVER`（教師懸停分析＋影片抽幀）應視為**兩條獨立任務鏈**，僅共用模型倉庫目錄結構與 Session 層。R07 上傳接口**僅覆蓋 `PROP_DIRECTION`**。

### 5.1 現況資料流（🟩 已驗證，凍結保護）

```
[學員端 UI]
  student_prop_scan:1121  ──┐
                            ├─→ 上傳 best.pt
  growth_model_upload:994 ──┘
        │
        ├─ 建立 Evidence（views.py:1029, evidence_type=MODEL）
        │     └─ FK→ GrowthRecordSubmission(:541, 可空)
        │
        └─ submit_model_evidence_to_vision（vision_submission.py:235）
              │  payload（:240）
              └─ POST /api/v1/vision/submissions（:252）
                    │
                    ▼
[Live Backend]  vision_api.py:206 submissions → :217 create_submission
                    │
                    ▼
[VisionCenter]  vision_center.py:480 create_submission
                    ├─ 存 submission.pt（:496）
                    └─ JsonStore.save（:508）
                    │
                    ▼ 回寫 vision_submission_id（views.py:1059）
[教師端]
  teacher_vision_model_list:1650  →  teacher_vision_model_detail:1735
  → teacher_vision_model_verify:1821（圖片驗證）
  → teacher_vision_model_review:1945（複核）
  → teacher_vision_model_catalogue:1777（入庫 → VisionModelRecord）
        └─ OneToOne → Evidence（models.py:733, PROTECT）
  → teacher_vision_center_activate:3066（啟用 → ACTIVE）
  → teacher_vision_center_rollback:3101（回滾）
```

### 5.2 R07 在成長證據鏈中的定位

| 層 | 內容 |
| --- | --- |
| 成長紀錄 slot | R07「專業任務驗證」（`growth_records_v1.json:57-59`） |
| 子能力（依方向） | `ai_flight_assessment` → AI 模型提交（`views.py:1005` gate） |
| 產出證據 | `Evidence`(type=MODEL) → `VisionModelRecord` |
| 教師複核 | `review_growth_record:2205`（僅 `SUBMITTED` 可複核）+ Vision Center 四區域 |
| 能力證據 | `GrowthRecordReview`(`models.py:605`) + `teacher_final_score` |

### 5.3 成長證據鏈全景（候選，🟨 待整合）

```
學 R01 ─┐
練 R02 ─┤
練 R04 ─┼─→ [候選整合層 INT-01] ─→ GrowthRecordSubmission（slot R01-R08）
做 R05 ─┤                              │
測 R03 ─┤                              ├─→ Evidence（8 種類型）
測 R06 ─┤                              ├─→ GrowthRecordReview（教師複核）
證 R07 ─┘                              ├─→ VisionModelRecord（僅 R07）
                                        ├─→ CandidatePool（候選模型）
                                        └─→ GoldenSet / GoldenSetSample
```

**現況事實**：`GrowthRecordSubmission` 已支援 8 個 slot（`models.py:164`），`Evidence.evidence_type` 已支援 8 種類型（`models.py:527`）。**缺口在於「非 R07 階段的自動回寫」**（`INT-01`）。

### 5.4 AI 雙師與教師複核權限區分（**必須明確**）

| 角色 | 可做 | 不可做 | 依據 |
| --- | --- | --- | --- |
| **AI 雙師（General AI）** | 解釋、提示、教學、產生引導文字、朗讀 | **自動安全放行**；代替教師複核 | `AGENTS.md:262-286` |
| **學員** | 上傳證據、提交成長紀錄、請求 AI 協助 | 自我複核、變更 ACTIVE 模型 | `views.py:994` gate |
| **教師** | 複核成長紀錄、驗證模型、入庫、啟用 / 回滾 ACTIVE、Golden Set 凍結 | 繞過 `activate_model` 的 `VALIDATED` 安全閘 | `views.py:3066`、`vision_center.py::activate_model` |

**仍須教師確認的安全項目**（`AGENTS.md:274-286`）：首次上電、電源極性、ESC、Motor Test、Propeller、Arm/PreArm、Failsafe、RTL/AUTO 安全放行、飛前檢查、真機起飛。

---

## 6. 保持不動的既有功能（教師指示）

| 功能 | 位置 | 處理 |
| --- | --- | --- |
| 右上角下載中心 | `downloads/` + `main.py:566-567` + `main.py:600` | **保留原位置與功能**；僅接口預留 |
| 導航欄飛行健康 | `src/app.js:85` + `main.py:565` + `flight-health/` | **保留原位置與功能**；僅接口預留 |
| R07 提交流程 | 見 5.1 | **凍結保護**，不重做 |
| M1–M4 前端（手機版） | `src/app.js:779-847`、`src/styles.css` | **凍結保護**，不重做 |
| RAG 學生前端問答 | `src/rag-client.js` + `main.py:487/562` | **凍結保護**，不重做 |
| v1.5C 穩定版 | `D:\FDE-AI-UAS\v1.5C` | **R4 只讀** |

---

## 7. 架構層風險彙總

| 編號 | 風險 | 等級 | 說明 |
| --- | --- | --- | --- |
| `RISK-01` | `VisionModelRecord.evidence` 為 PROTECT | **R4** | 刪除順序必須先 `VisionModelRecord` 再 `Evidence`，否則 `ProtectedError` |
| `RISK-02` | 雙軌視覺系統（Django SQLite vs Live JSON Store） | **R3** | 兩者僅靠 R07 提交鏈串接，無雙向同步；資料可能不一致 |
| `RISK-03` | 8 個區塊路徑在 8111 直開會 404 | **R3** | 手機直開 `/tasks`、`/f450` 等會拿到 404（僅 `/` 與 `/eagle` 有註冊） |
| `RISK-04` | MP12 未 Merge 回主線 | **R2** | 主專案以 file-level adoption 內含 `mp12_*`；獨立 worktree 為 `fde-ai-v2.0-mp12-dev` |
| `RISK-05` | 五階段成果未系統性回寫成長證據鏈 | **R3** | 僅 R07 自動回寫；其餘依賴手動 `evidence_add` |
| `RISK-06` | F450 數位孿生**路徑未確認** | **R3** | 已有獨立開發版本但完整專案路徑未確認，無法評估其可連接性；架構圖僅預留接口（標為「獨立模組／位置待確認／尚未整合」） |
| `RISK-07` | 下載中心測試斷言互相矛盾 | **R2** | `download-center-entry.test.cjs` vs `homepage-portal-entry.test.cjs` |
| `RISK-08` | `dashboard` / `flight-health-entry` 有 id 無路由 | **R1** | `applyRoute()` 不會顯示 |
| `RISK-09` | 大量未提交變更（154 筆） | **R4** | `EXTERNAL_DIRTY_STATE_DO_NOT_TOUCH` |
| `RISK-10` | 外部依賴原始碼不在本倉（yolo_server、RAG 語料） | **R2** | 無法在本倉內完整驗證 |
| `RISK-11` | Golden Set 對 `FOUR_SIDE_HOVER` 的兩處測試語意不一致 | **R2** | `tests/test_golden_set_center.py:121` 預期拒絕；`tests/test_golden_set_contract.py:605-606` 註解指其為合法型別 |
| `RISK-12` | F450 數位孿生「有版本但路徑未確認」 | **R3** | 較「不存在」更易造成誤判；本輪已修正標註為「獨立模組／位置待確認／尚未整合」 |

---

*本文件為方案比較產出，**未選定任何正式整合方案**。未修改產品程式、API、頁面、導航、路由、資料表。*
