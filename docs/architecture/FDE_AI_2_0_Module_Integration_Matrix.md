# FDE-AI-UAS 2.0｜模組整合追蹤矩陣（Module Integration Matrix）

| 項目 | 內容 |
| --- | --- |
| 文件編號 | `FDE_AI_2_0_Module_Integration_Matrix.md` |
| 專案目錄 | `D:\FDE-AI-UAS-v2.0` |
| 稽核日期 | 2026-10-12 |
| 性質 | 唯讀產出 |
| 編號體系 | `AUD-*`（盤點）、`ARCH-*`（架構層）、`INT-*`（整合點）、`FLOW-*`（流程階段）、`PHASE-*`（階段）、`Q-*`（待確認）、`RISK-*`（風險） |

**同一對象在不同文件中沿用相同編號。**

## 欄位定義

| 欄位 | 說明 |
| --- | --- |
| **實作狀態** | `EXISTS` 存在 / `PARTIAL` 部分 / `MISSING` 不存在 |
| **驗證狀態** | `VERIFIED` 已於磁碟確認 / `UNVERIFIED` 未驗證 / `BLOCKED` 無法驗證 |
| **整合狀態** | `CONNECTED` 已接線 / `ADOPTED` file-level 內含 / `LINKED` 僅超連結 / `NOT_CONNECTED` 未接線 / `N/A` 不適用 |
| **風險等級** | `R0` 無 / `R1` 極低 / `R2` 低 / `R3` 中 / `R4` 高（保護對象） |
| **教師批准點** | 是否需要教師明確批准才能進入下一階段 |

---

## 1. 盤點項（AUD-*）

| 編號 | 對象 | 實作狀態 | 驗證狀態 | 整合狀態 | 風險 | 證據 / 證據缺口 | 驗收標準 | 阻擋條件 | 阻擋後續開發 | 教師批准點 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `AUD-01` | 學員端與教師端 | `EXISTS` | `VERIFIED` | `CONNECTED` | R4 | `learning/urls.py:8-126`（40 路由）；`views.py`（40 view）；`templates/learning/`（38 模板） | 40 條路由可解析、無 404 | 無 | 否 | 否 |
| `AUD-02` | 導航、頁面、路由 | `EXISTS` | `VERIFIED` | `CONNECTED` | R3 | `index.html:18/31-49/52-57`；`src/app.js:81-95`；`src/router.js:2-13`；`index.html` 13 section | 導航項目可點擊且路由可解析 | `RISK-03`（8 路徑 404） | 否 | 否 |
| `AUD-03` | 右上角下載中心 | `EXISTS` | `VERIFIED` | `CONNECTED` | R2 | `downloads/index.html`、`downloads.js:45`、`main.py:566-567`、`main.py:600`、`download_center.py:238-264`；manifest 6 筆 | 6 筆可下載、Range 支援 | `RISK-07`（測試矛盾） | 否 | **是**（教師指示保留原位置） |
| `AUD-04` | 導航欄飛行健康 | `EXISTS` | `VERIFIED` | `LINKED` | R2 | `src/app.js:85`、`index.html:154-164/45`、`main.py:565`、`flight-health/js/config.js:7`（`:8040`） | 連結可達、外部服務可回應 | 外部服務未啟動 | 否 | **是**（教師指示保留原位置） |
| `AUD-05` | F450 數位孿生獨立專案 | `EXISTS`／**位置待確認** | `BLOCKED` | `NOT_CONNECTED` | R3 | **教師指令 2026-10-12 修正**：已有獨立開發版本，僅完整專案路徑未確認。初版誤判為 `MISSING`，係搜尋範圍所致。歷史文件 `V1.5C_BASELINE.md:53-64`、`CODEX_START_V1.5C.md:31` 記載「本基準只記錄規劃，不開發」 | 需教師提供路徑後再訂驗收 | **路徑未確認** | **是** | **是** |
| `AUD-06` | MP 調參實訓獨立專案 | `EXISTS` | `VERIFIED` | `ADOPTED` | R2 | `D:/FDE-AI-UAS-MP12`；`mp12_models.py:7-22`、`mp12_catalog.py:6-38`、`mp12_state.py`、`main.py:317-345/578-580`、`sessions.py:331-353`、`live/index.html:50-113`、`live/live.js:549-567` | MP01–MP12 可選／完成／教師複核 | `RISK-04`（未 Merge） | 否 | **是** |
| `AUD-07` | Camera / YOLO / SOP / RAG / LLM / Voice | `PARTIAL` | `VERIFIED` | `CONNECTED` | R3 | 見下方 6 列細分 | 各能力端點可回應 | 外部服務未啟動 | 否 | 否 |
| `AUD-08` | R07 / Submission / Evidence | `EXISTS` | `VERIFIED` | `CONNECTED` | **R4** | `models.py:526/164/605/683`；`views.py:994`；`vision_submission.py:235`；`vision_api.py:206`；`vision_center.py:480` | 端到端提交成功且教師可見 | `RISK-01`（PROTECT 刪除順序） | 否 | **是**（凍結保護） |
| `AUD-09` | 八項成長紀錄 | `EXISTS` | `VERIFIED` | `CONNECTED` | R3 | `data/growth_records_v1.json`（R01–R08）；`growth_records.py:9/17`；`models.py:130` | 八 slot 齊備且可提交 | 無 | 否 | 否 |
| `AUD-10` | DB / 媒體 / 模型倉庫 / 服務介面 | `EXISTS` | `VERIFIED` | `CONNECTED` | **R4** | `student_portal/db.sqlite3`、`demo/runtime/db/demo.sqlite3`、`vision_center.json`、`model_registry/`、`private_media/`；埠 8110/8111/8022/8030/8040/8765/8770 | 各服務埠可連、資料可讀 | `RISK-02`（雙軌）、`RISK-09`（154 筆未提交） | 否 | **是** |

### 1.1 `AUD-07` 細分

| 編號 | 能力 | 實作狀態 | 驗證狀態 | 整合狀態 | 風險 | 證據 |
| --- | --- | --- | --- | --- | --- | --- |
| `AUD-07a` | Camera | `EXISTS` | `VERIFIED` | `CONNECTED` | R2 | 前端 `live/live.js:46`（`getUserMedia`）、`:20-40`、`:57`；後端 `main.py:571/394-420/45` |
| `AUD-07b` | YOLO | `PARTIAL` | `VERIFIED`（契約）／`BLOCKED`（源碼） | `CONNECTED` | R3 | `config.py:9`（`:8765`）、`vision.py:34/46/55`、`vision_snapshot_server.py:154/125/119`；**外部 `yolo_server.py` 不在本倉** |
| `AUD-07c` | SOP | `EXISTS` | `VERIFIED` | `CONNECTED` | R2 | `sop.py:26/39/46/53/72/107`；`task_catalog.py:309/315-324/328`；`docs/delivery/08-STUDENT-R07-SOP.md` |
| `AUD-07d` | RAG | `PARTIAL` | `VERIFIED`（契約）／`BLOCKED`（語料） | `CONNECTED` | R3 | `config.py:14`（`:8770`）、`rag.py:67/72/45`；**服務本體與 1105 docs 語料不在本倉** |
| `AUD-07e` | LLM | `EXISTS` | `VERIFIED` | `CONNECTED` | R3 | `provider_manager.py:22/23/26`、`provider_openai.py:15/63/105`、`main.py:611`、`coach_ask.py:61/151/161` |
| `AUD-07f` | Voice | `EXISTS`（前端）／`MISSING`（後端） | `VERIFIED` | `CONNECTED` | R2 | `live/live.js:773/788/767/1152/68/144/1603/1616/760`；後端僅 `main.py:574` |

---

## 2. 架構層項（ARCH-*）

| 編號 | 層級 | 實作狀態 | 驗證狀態 | 整合狀態 | 風險 | 證據 | 驗收標準 | 阻擋條件 | 阻擋後續開發 | 教師批准點 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ARCH-01` | L6 使用者介面層 | `EXISTS` | `VERIFIED` | `CONNECTED` | R3 | 見 `AUD-01/02/03/04/06` | 各入口可達 | `RISK-03` | 否 | 否 |
| `ARCH-02` | L5 學習流程層 | `PARTIAL` | `VERIFIED` | `NOT_CONNECTED` | R3 | 五階段 UI 存在；但階段成果未回寫證據鏈（`INT-01`） | 五階段成果可追溯至 R01–R08 | **`INT-01` 未決** | **是** | **是** |
| `ARCH-03` | L4 AI 能力層 | `EXISTS` | `VERIFIED` | `CONNECTED` | R3 | `AUD-07a`–`f` | 六項能力端點可回應 | 外部服務 | 否 | 否 |
| `ARCH-04` | L3 服務層 | `EXISTS` | `VERIFIED` | `CONNECTED` | R4 | `main.py:541-601`；埠 8110/8111/8022/8030/8040 | 各服務可啟動且埠可連 | 無 | 否 | 否 |
| `ARCH-05` | L2 資料層 | `EXISTS` | `VERIFIED` | `CONNECTED` | R4 | `db.sqlite3`、`demo.sqlite3`、`vision_center.json`、`model_registry/`、`private_media/`、`download_manifest.json` | 資料可讀且一致 | `RISK-02` | 否 | **是** |
| `ARCH-06` | L1 證據層 | `EXISTS` | `VERIFIED` | `CONNECTED` | R4 | `models.py:526/164/605/683/656` | 證據鏈可追溯 | `RISK-01` | 否 | **是** |

---

## 3. 整合點（INT-*）

| 編號 | 連接 | 實作狀態 | 驗證狀態 | 整合狀態 | 風險 | 證據 | 驗收標準 | 阻擋條件 | 阻擋後續開發 | 教師批准點 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `INT-01` | 學／練／做／測 → 成長證據鏈 | `PARTIAL` | `UNVERIFIED` | `NOT_CONNECTED` | R3 | 僅 R07 自動回寫（`views.py:994`）；其餘依賴手動 `evidence_add:1427` | 各階段成果可自動歸入對應 R0x | **方案未決** | **是** | **是** |
| `INT-02` | MP12 整合 | `EXISTS` | `VERIFIED` | `ADOPTED` | R2 | `main.py:578-580`、`sessions.py:331-353`、`live/index.html:50-113` | 四方案擇一並驗收 | **方案未決** | **是** | **是** |
| `INT-02-A` | MP12 Deep Link | `MISSING` | `UNVERIFIED` | `NOT_CONNECTED` | R1 | 候選：`src/app.js:82-88` 加一筆 `href`（模式同 `flight-health`） | 連結可達 MP12 | 未選定 | 否 | **是** |
| `INT-02-B` | MP12 Embed（iframe） | `MISSING` | `UNVERIFIED` | `NOT_CONNECTED` | R2 | 候選：類比 `main.py:565` `Mount` | iframe 內功能完整 | iOS Safari 滾動／高度問題 | 否 | **是** |
| `INT-02-C` | MP12 API Integration | `PARTIAL` | `VERIFIED` | `ADOPTED` | R2 | 候選：複用既有 `mp12_*` 模組與 Session 層 | 前端自繪 + 後端契約一致 | MP12 worktree 是否 Merge | **是** | **是** |
| `INT-02-D` | MP12 暫不整合 | `EXISTS` | `VERIFIED` | `ADOPTED` | R0 | 現況即此方案 | 維持現狀 | 無 | 否 | 否 |
| `INT-03` | 攝影機 → 視覺模型 | `EXISTS` | `VERIFIED` | `CONNECTED` | R3 | `live.js:46` → `main.py:571/394-420` → `main.py:413` → `vision.py:55` | 上傳影像可得檢測結果 | 外部 YOLO 未啟動 | 否 | 否 |
| `INT-04` | 視覺模型 → SOP | `EXISTS` | `VERIFIED` | `CONNECTED` | R2 | `orchestrator.py:15/23` → `sop.py:107` | 檢測結果可產生 SOP 決策 | 無 | 否 | 否 |
| `INT-05` | SOP → RAG | `EXISTS` | `VERIFIED` | `CONNECTED` | R3 | `rag_guidance.py` `ContextualGuidanceCoordinator`；`rag.py:67` | 可取得 RAG 解釋 | 外部 RAG 未啟動 | 否 | 否 |
| `INT-06` | RAG → LLM | `EXISTS` | `VERIFIED` | `CONNECTED` | R3 | `coach_ask.py:61/151` → `provider_manager.py:29` → `provider_openai.py:63` | 可產生 AI 回答 | API Key 未設 | 否 | 否 |
| `INT-07` | LLM → 證據提交 | `PARTIAL` | `UNVERIFIED` | `NOT_CONNECTED` | R3 | 目前僅 R07 上傳產生 `Evidence`（`views.py:1029`）；一般 AI 回答不回寫 | AI 引導結果可歸入證據 | 未定義契約 | **是** | **是** |
| `INT-08` | 數位孿生 → 攝影機／視覺模型 | `EXISTS`／位置待確認 | `BLOCKED` | `NOT_CONNECTED` | R3 | 獨立開發版本已存在但路徑未確認（`AUD-05`）。候選接口：孿生輸出合成影像 → `vision.py` 檢測鏈 | 需教師提供路徑 | **路徑未確認** | **是** | **是** |
| `INT-09` | 數位孿生 → SOP／證據提交 | `EXISTS`／位置待確認 | `BLOCKED` | `NOT_CONNECTED` | R3 | 同上。候選接口：孿生狀態變更 → `training_step_fact`（`main.py:581`）→ `Evidence` | 需教師定義範疇 | **路徑未確認** | **是** | **是** |
| `INT-10` | R07 → VisionModelRecord → ACTIVE | `EXISTS` | `VERIFIED` | `CONNECTED` | **R4** | `views.py:994/1029/1045/1059`；`vision_submission.py:235/240/252`；`vision_api.py:206/217`；`vision_center.py:480/496/508`；`models.py:733` | 端到端可提交且教師可啟用 | `RISK-01` | 否 | **是**（凍結） |
| `INT-11` | 下載中心 → manifest → 檔案串流 | `EXISTS` | `VERIFIED` | `CONNECTED` | R2 | `downloads.js:45` → `main.py:566/567` → `download_center.py:23-36/238-264` | 6 筆可下載 | `RISK-07` | 否 | **是**（凍結） |
| `INT-12` | 主站 → 飛行健康（連結） | `EXISTS` | `VERIFIED` | `LINKED` | R2 | `src/app.js:85`、`index.html:154-164/45`、`main.py:565`、`config.js:7` | 連結可達且外部服務可回應 | 外部服務未啟動 | 否 | **是**（凍結） |

---

## 4. 流程階段（FLOW-*）

| 編號 | 階段 | 實作狀態 | 驗證狀態 | 整合狀態 | 風險 | 證據 | 對應成長紀錄 | 阻擋條件 | 阻擋後續開發 | 教師批准點 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `FLOW-01` | 學 | `EXISTS` | `VERIFIED` | `PARTIAL` | R2 | `renderLearningResources:456`、`renderFdeColumn:492`、下載中心 6 項 | R01 | 無 | 否 | 否 |
| `FLOW-02` | 練 | `EXISTS` | `VERIFIED` | `PARTIAL` | R2 | `renderPracticeResources:541`、`sop.py:107` | R02 / R04 | 無 | 否 | 否 |
| `FLOW-03` | 做 | `PARTIAL` | `VERIFIED` | `PARTIAL` | R3 | `renderBuildWorkflow:559`、`renderBuildMain12Entry:1054`、`mp12_catalog.py:38`；**F450 數位孿生：獨立模組／位置待確認／尚未整合** | R05 | `AUD-05` 未決 | **是** | **是** |
| `FLOW-04` | 測 | `EXISTS` | `VERIFIED` | `PARTIAL` | R3 | `renderAssessmentWorkflows:576`、`renderPropellerInspectionResult:901`、`renderHoverResult:958`、`student_prop_scan:1121`、`teacher_vision_center:2710` | R03 / R06 | 無 | 否 | **是**（M1–M4 凍結） |
| `FLOW-05` | 證 | `PARTIAL` | `VERIFIED` | `PARTIAL` | R3 | `renderCertificationChecklist:1109`、`renderCohorts:412`、R01–R08、`Evidence`/`GrowthRecordSubmission`/`VisionModelRecord` | R07 / R08 | `INT-01` 未決 | **是** | **是** |

---

---

## 5. MP12 已接入與未接入細分（教師指令 2026-10-12，編號沿用 `AUD-06`／`INT-02`）

| 分項 | 細目 | 位置 | 狀態 |
| --- | --- | --- | --- |
| **① 已在主專案** | `MissionPlannerSubtaskDefinition` | `live_backend/app/mp12_models.py:7-22` | ✅ |
| | `_MP12_CATALOG`（MP01–MP12） | `live_backend/app/mp12_catalog.py:38`、`_subtask():6-35` | ✅ |
| | `MissionPlannerProgress` | `live_backend/app/mp12_state.py` | ✅ |
| | handler 3 支 | `live_backend/app/main.py:321/328/335` | ✅ |
| | Session 方法 3 支 | `live_backend/app/sessions.py:331-353` | ✅ |
| | `<section id="missionPlannerPanel">` | `live/index.html:52`（`:50-113`） | ✅ |
| | `.mp12-*` 樣式 | `live/live.css:118-124+` | ✅ |
| | 前端 3 支呼叫 + `renderMissionPlannerState` | `live/live.js:549-567`、`:931-957` | ✅ |
| **② 仍在獨立 worktree** | 完整 MP12 站點 | `D:\FDE-AI-UAS-MP12`（分支 `fde-ai-v2.0-mp12-dev`） | 🟨 |
| | `test_mp12_api.py`、`test_mp12_catalog.py`、`test_mp12_state.py` | `D:\FDE-AI-UAS-MP12\live_backend\tests\` | 🟨 主專案無對應 |
| | `mp12-ui.test.cjs` | `D:\FDE-AI-UAS-MP12\live\` | 🟨 主專案無對應 |
| | 驗收截圖 | `D:\FDE-AI-UAS-MP12\.test-temp\mp12-acceptance\` | 🟨 |
| **③ 已接通的路由** | `.../training/mp12/{subtask_id}/select` | `live_backend/app/main.py:578` | ✅ 已接通 |
| | `.../training/mp12/{subtask_id}/complete` | `main.py:579` | ✅ 已接通 |
| | `.../training/mp12/{subtask_id}/teacher-review` | `main.py:580` | ✅ 已接通 |
| | 前端呼叫上述三支 | `live/live.js:549-567` | ✅ 已接通 |
| **④ 只是頁面或資料接口** | 掛在 `TASK_07` 深度子模組（非獨立任務） | `main.py:317`、`sessions.py:331` | ⚠️ 頁面層 |
| | 目錄 12 筆為靜態資料 | `mp12_catalog.py:38` → `live/live.js` | ⚠️ 資料接口 |
| | 教師複核邏輯散佈前端（僅 MP06/MP08/MP11/MP12） | `live/index.html:87` | ⚠️ |
| | 教師複核走 Live Backend handler，**未打通 Django 教師端** | `main.py:335` | ⚠️ |
| **⑤ 尚未端到端驗收** | 主專案僅 2 支 AUTOMATED 測試 | `live/mp12-frontend-integration.test.cjs`、`live_backend/tests/test_mp12_backend_integration.py` | ⚠️ |
| | iPhone `REAL DEVICE` | — | ⚠️ PENDING |
| | 教師現場複核流程未實測 | — | ⚠️ 待驗收 |
| | worktree 未 Merge | — | ⚠️ `AGENTS.md:153-161` |

> **本輪不合併、不重寫、不補開發 MP12。**

---

## 5b. R07 三層概念與模型類型關係核對（教師指令 2026-10-12，編號沿用 `AUD-08`／`INT-10`）

**三層概念互不等同**：

| 層級 | 值 | 權威來源 |
| --- | --- | --- |
| 專業方向 `Enrollment.project_direction` | `ai_flight_assessment`／`uav_3d_mapping`／`autonomous_mission`／`flight_f450` | `learning/data/project_directions_v1.json` `direction_keys` |
| 模型類型 `VisionCenter.MODEL_TYPES` | `PROP_DIRECTION`／`FOUR_SIDE_HOVER` | `live_backend/app/vision_center.py:17` |
| 成長紀錄 slot `GrowthRecordDefinition.slot_id` | `R01`–`R08`（R07＝專業任務驗證） | `growth_records_v1.json`；`models.py:130` |

| 關係 | 結論 | 依據 |
| --- | --- | --- |
| `ai_flight_assessment` → gate | ✅ 唯一開放入傳者 | `views.py:1005` |
| `R07` → `PROP_DIRECTION` | **1:1 硬編碼** | `views.py:1038`、`views.py:1046` |
| `FOUR_SIDE_HOVER` → R07 上傳路徑 | ❌ **不在** | `views.py:994` 無分支；`vision_center.py:522` import 僅收 `task_id == "PROP_DIRECTION"` |
| `FOUR_SIDE_HOVER` → 教師鏈 | ✅ 存在 | `hover-analyze`、`hover-video`（`vision_api.py:121-133`；`vision_center.py:638`） |
| Golden Set 對 `FOUR_SIDE_HOVER` | ⚠️ 語意不一致（`RISK-11`） | `golden_set.py:10` vs `test_golden_set_contract.py:605-606` |

> **四個專業方向的 R07 子任務並非全部由程式支援**：`uav_3d_mapping`（3D 建模）、`autonomous_mission`（Mission Planner）、`flight_f450`（組裝考照）在 `project_directions_v1.json` 中有完整定義，**但無對應的模型上傳程式路徑**（R07 模型上傳僅服務 `ai_flight_assessment`）。不得誤認為四者共用同一已完成接口。

---

## 6. 階段（PHASE-*）

| 編號 | 階段 | 目標 | 前置條件 | 驗收條件 | 阻擋條件 | 教師批准點 |
| --- | --- | --- | --- | --- | --- | --- |
| `PHASE-00-A` | 現況盤點與架構審查 — **文件交付**（**本輪**） | 產出 6 份文件、建立追蹤矩陣、比較方案 | 唯讀授權 | 6 份文件齊備；追蹤編號體系一致；盤點項附實際路徑行號 | 無 | 否（已達成，教師 2026-10-12 已審閱修正指令） |
| `PHASE-00-B` | 現況盤點與架構審查 — **階段驗收** | 關閉本輪全部 R3／R4 阻擋項 | `PHASE-00-A` 完成 | `RISK-02`／`RISK-03`／`RISK-05`／`RISK-06`／`RISK-12` 與 `Q-02`／`Q-10`／`Q-11`／`Q-14` 全部有教師書面結論 | **5 項 R3 未關閉** | **是**（未通過 → P0 標為「文件已交付／驗收待教師確認」） |
| `PHASE-01` | 整合方案選定 | 教師就 `INT-01`／`INT-02` 選定方案 | `PHASE-00-B` 通過 | 方案書面確認 | `Q-10`／`Q-11` 未決 | **是** |
| `PHASE-02` | 成長證據鏈補齊 | 依選定方案實作階段 → R0x 回寫 | `PHASE-01` 通過 | 各階段成果可追溯 | `RISK-01` PROTECT 鏈 | **是** |
| `PHASE-03` | F450 數位孿生範疇定義 | 教師提供路徑後定義是否開發與範疇 | `AUD-05` 決策（路徑提供＋範疇） | 範疇書面確認 | `AUD-05` 位置待確認 | **是** |
| `PHASE-04` | MP12 整合落地 | 依 `INT-02` 選定方案實作 | `PHASE-01` 通過 | MP01–MP12 端到端可用 | `RISK-04` | **是** |
| `PHASE-05` | 全平台回歸與真機驗收 | 端到端驗收（含 iPhone 真機） | `PHASE-02/04` 通過 | `REAL DEVICE PASS` | 真機未就緒 | **是** |

---

## 7. 待確認事項（Q-*）

| 編號 | 項目 | 狀態 | 影響 | 需教師決策 |
| --- | --- | --- | --- | --- |
| `Q-01` | FDE-Safe-Dev Skill 未找到 | 未找到 | 安全依據改以 `AGENTS.md` + `FDE-DEVELOPMENT-CHARTER.md` | 否（已知） |
| `Q-02` | F450 數位孿生獨立專案路徑 | **位置待確認**（版本已存在） | `INT-08`／`INT-09` 待教師提供路徑後再評估 | **是** |
| `Q-03` | 外部 `yolo_server.py` 原始碼不在本倉 | 未找到 | 僅能驗證呼叫契約 | 否（已知） |
| `Q-04` | RAG 服務本體與 1105 docs 語料不在本倉 | 未找到 | 僅能驗證呼叫契約 | 否（已知） |
| `Q-05` | 後端 STT / TTS 未找到 | 未找到 | 語音為瀏覽器原生 | **是**（是否需要後端語音） |
| `Q-06` | 官方檢查清單檔案未找到 | 未找到 | 以本輪指令內文為驗收依據 | **是**（是否需補文件） |
| `Q-07` | 下載中心測試斷言矛盾 | 已確認 | `RISK-07` | **是** |
| `Q-08` | `dashboard`／`flight-health-entry` 有 id 無路由 | 已確認 | `RISK-08` | **是** |
| `Q-09` | 8 個區塊路徑在 8111 直開會 404 | 已確認 | `RISK-03` | **是** |
| `Q-10` | `INT-01` 成長證據鏈整合方案未選定 | 待決 | 阻擋 `PHASE-02` | **是** |
| `Q-11` | `INT-02` MP12 整合方案未選定 | 待決 | 阻擋 `PHASE-04` | **是** |
| `Q-12` | `RISK-02` 雙軌視覺系統是否需同步 | 待決 | 資料一致性 | **是** |
| `Q-13` | 154 筆未提交變更如何處理 | 待決 | `RISK-09` | **是** |
| `Q-14` | F450 數位孿生是否開發（不開發／僅預留接口／獨立開發） | 待決 | `FLOW-03`、`INT-08`／`INT-09`、`RISK-06`；**本輪已確定採「僅預留接口」，不得重新建立專案** | **是**（P3 前裁決） |
| `Q-15` | 是否需要後端 STT / TTS | 待決 | `AUD-07f` | **是** |
| `Q-16` | AI 雙師與教師複核的權限邊界是否需更細化 | 待決 | 安全性（`AGENTS.md:262-286`） | **是** |
| `Q-17` | 外部 YOLO `:8765` 是否可啟動 | 待查證 | 契約已知（`vision_snapshot_server.py:154`） | 否（後續查證） |
| `Q-18` | 外部 RAG `:8770` 是否可啟動且語料完整 | 待查證 | 契約已知（`rag.py:67`） | 否（後續查證） |
| `Q-19` | Flight Health `:8040` 是否可啟動 | 待查證 | `flight-health/js/config.js:7` | 否（後續查證） |
| `Q-20` | DEMO 模擬綁定 `sub-ea18f5eb`（28 bytes）是否足以支撐展示 | 已確認存在 | 需教師確認是否保留 | **是** |
| `Q-21` | 模型倉庫 42 筆中 17 筆 `file_path` 不存在 | 已確認為事故前既有狀態 | **R07 清理繼續暫停**（教師 2026-10-12 明確要求不執行 `--apply`，後續另行安排獨立任務） | **是**（另案處理） |
| `Q-22` | Golden Set 對 `FOUR_SIDE_HOVER` 兩處測試語意不一致（`RISK-11`） | 待決 | `tests/test_golden_set_center.py:121` vs `tests/test_golden_set_contract.py:605-606`；修正時不得擴大至 R07 凍結流程 | **是**（R2，不阻擋本輪） |

---

## 8. 風險（RISK-*）

| 編號 | 風險 | 等級 | 影響範圍 | 目前處置 | 阻擋後續開發 | 教師批准點 |
| --- | --- | --- | --- | --- | --- | --- |
| `RISK-01` | `VisionModelRecord.evidence` 為 `on_delete=PROTECT` | **R4** | 資料刪除／清理流程 | 已確認刪除順序：先 `VisionModelRecord` 再 `Evidence`（`models.py:733`） | 否 | **是** |
| `RISK-02` | 雙軌視覺系統（Django SQLite ↔ Live JSON Store） | **R3** | 資料一致性 | 僅 R07 提交鏈串接，無雙向同步 | **是**（若需一致） | **是** |
| `RISK-03` | 8 個區塊路徑在 8111 直開會 404 | **R3** | 手機直開體驗 | 僅 `/`、`/eagle` 有註冊（`main.py:556/560`） | 否 | **是** |
| `RISK-04` | MP12 未 Merge 回主線 | **R2** | MP12 整合落地 | 現以 file-level adoption 內含 | 否 | **是** |
| `RISK-05` | 五階段成果未系統性回寫成長證據鏈 | **R3** | `ARCH-02`／`FLOW-05` | 待 `INT-01` 決策 | **是** | **是** |
| `RISK-06` | F450 數位孿生路徑未確認（有版本但位置不明） | **R3** | `FLOW-03` | 標為「獨立模組／位置待確認／尚未整合」；架構圖僅預留接口 | **是** | **是** |
| `RISK-07` | 下載中心測試斷言互相矛盾 | **R2** | CI 可信度 | 已記錄，未修（禁止修改） | 否 | **是** |
| `RISK-08` | `dashboard`／`flight-health-entry` 有 id 無路由 | **R1** | 導航 | 已記錄 | 否 | **是** |
| `RISK-09` | 154 筆未提交變更（`EXTERNAL_DIRTY_STATE_DO_NOT_TOUCH`） | **R4** | 全專案 | 本輪完全未觸碰 | 否 | **是** |
| `RISK-10` | 外部依賴原始碼不在本倉 | **R2** | 可驗證性 | 僅驗證呼叫契約 | 否 | **是** |
| `RISK-11` | Golden Set 對 `FOUR_SIDE_HOVER` 的兩處測試語意不一致 | **R2** | Golden Test | `tests/test_golden_set_center.py:121` 預期拒絕；`tests/test_golden_set_contract.py:605-606` 註解指其為合法型別 | 否 | **是** |
| `RISK-12` | F450 數位孿生「有版本但路徑未確認」 | **R3** | `FLOW-03` | 較「不存在」更易誤判；已修正標註 | **是** | **是** |

### 風險統計

| 等級 | 數量 | 編號 |
| --- | --- | --- |
| **R4** | 6 | `RISK-01`、`RISK-09`、`AUD-08`、`AUD-10`、`ARCH-04/05/06`、`INT-10` |
| **R3** | 8 | `RISK-02`、`RISK-03`、`RISK-05`、`RISK-06`、`RISK-12`、`AUD-02`、`AUD-05`、`AUD-07`、`ARCH-02/03`、`FLOW-03/04/05` |
| **R2** | 6 | `RISK-04`、`RISK-07`、`RISK-10`、`RISK-11`、`AUD-03/04/06` |
| **R1** | 1 | `RISK-08`、`INT-02-A` |
| **R0** | 1 | `INT-02-D` |

---

## 9. 矩陣統計

| 統計項 | 數量 |
| --- | --- |
| `AUD-*` 盤點項 | 10（+ `AUD-07a`–`f` 細分 6） |
| `ARCH-*` 架構層 | 6 |
| `INT-*` 整合點 | 12（+ `INT-02-A/B/C/D` 4） |
| `FLOW-*` 流程階段 | 5 |
| `PHASE-*` 階段 | 7（`PHASE-00` 已拆分為 `PHASE-00-A` 文件交付與 `PHASE-00-B` 階段驗收） |
| `Q-*` 待確認 | **22** |
| `RISK-*` 風險 | **12** |
| **已接線整合點（CONNECTED / ADOPTED / LINKED）** | 12 |
| **未接線整合點（NOT_CONNECTED）** | 8 |
| **阻擋後續開發的項目** | 6（`INT-01`、`INT-07`、`INT-08`、`INT-09`、`ARCH-02`、`FLOW-03/05`） |
| **未關閉的 R3 風險數** | 8（`RISK-02`、`RISK-03`、`RISK-05`、**`RISK-06`**、**`RISK-12`**、`AUD-02`、`AUD-05`、`FLOW-03/04/05`） |
| **未關閉的 R4（保護）數** | 6（`RISK-01`、`RISK-09`、`AUD-08`、`AUD-10`、`ARCH-04/05/06`、`INT-10`） |

> **R3 中 `RISK-06` 與 `RISK-12` 已因教師補充指令而新增／升級**（F450 數位孿生由「不存在」改判為「有版本／路徑未確認」）：
> 「有版本但找不到」比「不存在」更容易造成誤判，故風險等級由 R2 提升為 R3。
> **這兩項尚未關閉，因此 P0 階段驗收（`PHASE-00-B`）不得宣告完全通過**；
> 文件交付部分（`PHASE-00-A`）已達成，P0 整體標為「文件已交付／驗收待教師確認」。

---

*本文件為唯讀產出。未修改產品程式、API、頁面、導航、路由、資料表。*
