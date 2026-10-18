# 【Vision YOLO Final Handoff Report】

**專案**：FDE-AI-UAS 2.0（分支 `fde-ai-v2.0-dev`，目錄 `D:\FDE-AI-UAS-v2.0`）
**任務**：Vision YOLO 最終收尾與移交 Codex（WorkBuddy 最後一輪修改 v2.0）
**日期**：2026-10-08（GMT+8）
**遵守**：AGENTS.md（MVP / Minimal Change / Vertical Slice / External Dirty State 保護）、FDE-DEVELOPMENT-CHARTER.md

---

## 0. 本輪操作範圍

- 本輪**未修改任何程式碼**（Vision 功能均來自前序 P1-1 / P1-2 / Vision Data Flywheel Center 輪次，目前未提交）。
- 本輪僅做：真實 Git 狀態確認 → 現有 Vision 系統盤點（只讀）→ 定向自動測試 → 真實就緒度判定 → 本報告 → 嘗試提交（因外部髒狀態受阻）。
- **未**擴建 Vision、**未**新開發 Hover、**未**偽造 PASS/ACTIVE/REAL VALIDATION、**未**安裝依賴、**未**部署。

---

## 1. 狀態總結（報告欄位）

| 欄位 | 值 |
|---|---|
| Status | **PARTIAL PASS**（程式完整 + 自動測試通過；真實模型/裝置驗證 PENDING；提交因外部髒狀態受阻） |
| PROP_DIRECTION | **IMPLEMENTED（AUTOMATED PASS）/ REAL_MODEL_VALIDATION = BLOCKED** |
| FOUR_SIDE_HOVER | **EXISTING（程式碼存在）/ NOT_IMPLEMENTED（無真實模型、無真實 Dataset）** |
| Student Model Submission | **PASS**（惰性附件，禁止執行；測試通過） |
| Teacher Review | **PASS**（P1-1/P1-2 Live 審核完整；Vision Center 以 import 觸發驗證）；明確「拒絕 submission」端點 = 小 GAP（不阻塞） |
| Model Validation | **PASS（AUTOMATED，嚴格 PROP 契約）/ REAL = BLOCKED**（需 ultralytics+cv2+numpy + 真實 .pt） |
| Model Registry | **PASS**（VisionCenter `model_registry/`，JsonStore，狀態機 DRAFT→VALIDATING→VALIDATED→CANDIDATE→ACTIVE→ARCHIVED） |
| ACTIVE Model | **PASS**（每類型僅一個 ACTIVE；舊模型轉 ARCHIVED 保留、可切回；測試 `test_only_one_active_per_model_type` 證實） |
| Rollback | **PASS**（archive_model + 重新 activate 任何 VALIDATED 模型即可回切；舊版本保留） |
| Student Vision API Active Resolution | **PASS**（`prop_check` 經 `active_model(task_type)` 解析，未硬編碼 best.pt 路徑） |
| Automated Tests | **77 PASS / 0 FAIL**（2 skipped = opencv 不可用，屬真實環境依賴，非失敗） |
| Real Model Validation | **BLOCKED**（無真實符合契約的 best.pt；受控後端 venv 缺 ultralytics/cv2/numpy；無真實 Dataset） |
| Real Device Validation | **PENDING** |
| Vision Files Modified（本輪） | **無**（所有 Vision 程式來自前序輪次，當前未提交） |
| Protected External Dirty Files | 見下方第 4 節（列出但不修改） |
| Git Branch | `fde-ai-v2.0-dev` |
| Vision Commit | **COMMIT_BLOCKED_BY_EXTERNAL_DIRTY_STATE**（見第 3 節） |
| Push | **NOT PERFORMED** |
| Merge | **NOT PERFORMED** |
| Deploy | **NOT PERFORMED** |

---

## 2. PROP_DIRECTION 最小閉環（已具備，AUTOMATED PASS）

完整鏈路在 `live_backend/app/vision_center.py` + `vision_api.py`，已通過自動測試：

1. **Student 提交** `create_submission`（POST `/api/v1/vision/submissions`）：惰性附件，僅存 `.pt` + hash，**不載入/不推理**（符合 CHARTER）。
2. **教師匯入** `import_submission`（POST `/.../submissions/{id}/import`）：匯入即觸發 `upload_model` 驗證。
3. **模型驗證** `upload_model` → `UltralyticsModelValidator`：擴充名 `.pt`、檔案簽章、大小、YOLO 載入、`task=="detect"`、類別名稱**嚴格 = PROP_CLASSES**、smoke 推理。舊 `cw_propeller/ccw_propeller` → `model_class_names_mismatch` → REJECTED。
4. **評估** `save_evaluation`：寫入 metrics，狀態轉 CANDIDATE。
5. **啟用** `activate_model`：同類型僅一個 ACTIVE，舊轉 ARCHIVED。
6. **學生推論** `prop_check`（POST `/api/v1/vision/prop-check`）：經 `active_model("PROP_DIRECTION")` 解析 ACTIVE 模型，規則引擎 `evaluate_prop` 判定，非硬編碼路徑。

---

## 3. Git 收尾與 COMMIT_BLOCKED 說明

### 3.1 嘗試建立純 Vision 提交受阻

Vision 相關的**新檔案**（可乾淨分離，純 Vision）包括：
- `live_backend/app/vision_center.py`、`live_backend/app/vision_api.py`、`live_backend/app/benchmark.py`
- `live_backend/tests/test_vision_center.py`、`live_backend/tests/test_vision_api.py`、`live_backend/tests/test_p1_model_submission.py`、`live_backend/tests/test_p1_2_benchmark.py`
- `live/vision-center-ui.test.cjs`、`live/vision-submission-ui.test.cjs`
- `validation_sets/`（僅 `.gitkeep` + `manifest.json`，4 KB，無 `.pt`/Dataset，安全）
- `docs/verification/p1-1-* / p1-2-* / p1-2-5-*`

但上述新檔案依賴 `main.py` 的 `vision_routes(center)` 掛載與 `benchmark_sandbox` 接線，而 `main.py`、`sessions.py`、`live.js`、`index.html`、`live.css` 這 5 個**已修改檔案**經 diff 掃描確認**混入了其他任務**：
- `main.py` / `sessions.py` → General AI provider、Classroom Validation、F450 任務、Coach history
- `live.js` / `index.html` / `live.css` → Student Live Coach、Voice、Classroom Browser

若 `git add` 這些已修改檔案會**連帶提交其他任務的髒改動**；若只提交新檔案則 `main.py` 接線不在提交內 → 樹處於「模組存在但未掛載」的**不一致**狀態。

依 AGENTS.md §6（External Dirty State 不 reset/clean/stash/覆蓋/順手修復）與本任務規範 §13（「宁可不 commit，也不要污染其它开发内容」「如果因为 External Dirty State 无法安全建立纯 Vision commit：不要强行 commit。报告 COMMIT_BLOCKED_BY_EXTERNAL_DIRTY_STATE」），**本輪不強行提交**，報告：

> **Vision Commit = COMMIT_BLOCKED_BY_EXTERNAL_DIRTY_STATE**

### 3.2 後續（交由 Codex / 使用者決策）

若要在 `fde-ai-v2.0-dev` 建立純 Vision 提交，建議作法（非本輪執行）：
- 以 `git add -p` 僅選取 `main.py` / `sessions.py` 中 Vision 接線相關 hunk（vision_routes、benchmark_sandbox、YOLO_MODEL 相關），排除 General AI / Classroom / F450 / Coach hunk；**或**
- 先將其他任務的髒改動各自提交/清理後，再單獨提交 Vision；**或**
- 由 Codex 接管後統一整理提交。

所有 Vision 相關檔案（新檔 + 混入股務檔中的 Vision hunk）**保留在工作樹，未提交**，可供 Codex 接手。

### 3.3 安全檢查（§12）

- `.test-temp/`（含 135 個測試 `.pt`）已被 `.gitignore` 忽略，**不會進入 Git**。
- `validation_sets/` 僅 4 KB，無 `.pt`、無 Dataset、無學生上傳。
- 未發現 Secret / API Key / Token / Password / 個人絕對路徑 / 大型檔案擬進入提交範圍。

---

## 4. Protected External Dirty Files（存在但不修改）

**已修改且混入它務（EXTERNAL_DIRTY_STATE_DO_NOT_TOUCH）**：
- `live_backend/app/main.py`（混 General AI / Classroom / F450）
- `live_backend/app/sessions.py`（混 Coach history / Classroom）
- `live/live.js`（混 Live Coach / Voice / Classroom）
- `live/index.html`（混 Live Coach / Classroom）
- `live/live.css`（混 Live Coach）

**未追蹤、非 Vision（不納入 Vision 提交）**：
- `flight-health/`（明確保護，禁止碰）
- `live_backend/app/providers/`、`live_backend/app/teacher_style.py`、`test_general_ai_*.py`、`test_teacher_clone.py`（General AI / Teacher Style）
- `live_backend/app/coach_ask.py`、`test_coach_ask.py`、`test_f450_live_loop.py`（Coach / F450）
- `live/live-coach-simplified-ux.test.cjs`、`student-ux-voice-reply.test.cjs`、`task-ui.test.cjs`、`classroom-validation-ux.test.cjs`、`traditional-chinese-ui.test.cjs`（Live Coach / Classroom / UI）
- `docs/verification/CLASSROOM_BROWSER_ACCEPTANCE.md`、`p0-1-closeout-report.md`
- `AGENTS.md`、`docs/architecture/FDE-DEVELOPMENT-CHARTER.md`、`docs/AI_HANDOFF.md`、`docs/superpowers/plans/2026-10-04-vision-data-flywheel-center.md`
- `add_firewall_rules.ps1`、`start_fde_mobile_preview.bat`、`src/styles.css`（legacy，禁止碰）

---

## 5. FOUR_SIDE_HOVER 處置（§4）

- 程式碼**已存在**（`HOVER_CLASSES`、`analyze_hover`、`process_video`、camera profiles、`hover-analyze` / `hover-video` 路由、FOUR_SIDE_HOVER 驗證分支）。
- 但**無真實 Hover best.pt、無真實 Dataset、無現成完整真實流程**。
- 依規範：**禁止為本輪收尾新開發**；**不得偽造** PASS / ACTIVE / REAL VALIDATION。
- 判定：**FOUR_SIDE_HOVER = EXISTING（code）/ NOT_IMPLEMENTED（no real model/dataset）**。

---

## 6. 真實環境與自動測試區隔（§11）

| 維度 | 自動測試（AUTOMATED） | 真實模型（REAL MODEL） | 真實裝置（REAL DEVICE） |
|---|---|---|---|
| 結果 | **PASS**（77/77，注入 FixtureValidator/FixtureRunner mock） | **BLOCKED** | **PENDING** |
| 說明 | 不依賴 ultralytics/cv2/numpy | 受控後端 venv 缺 ultralytics/cv2/numpy；無真實符合契約 best.pt；無真實 Dataset | 未執行 iPhone / 真機驗收 |

> 禁止以 mock 冒充真實模型通過。REAL MODEL VALIDATION = BLOCKED 已如實記錄。

---

## 7. Codex 接手說明（§16）

1. **現有 Vision API 路由**（`live_backend/app/vision_api.py` → `vision_routes`）：
   - `POST /api/v1/vision/models`（教師上傳+驗證）、`GET /api/v1/vision/models`、`GET /api/v1/vision/models/{id}`、`POST /.../evaluate`、`POST /.../activate`、`POST /.../archive`
   - `POST /api/v1/vision/prop-check`（學生推論，讀 ACTIVE PROP 模型）、`POST /api/v1/vision/hover-analyze`、`POST /api/v1/vision/hover-video`
   - `GET/POST /api/v1/vision/datasets`、`POST /.../build-next`、`GET /.../export`
   - `GET/POST /api/v1/vision/hard-examples`、`POST /.../{id}/review`
   - `POST /api/v1/vision/camera-profiles`
   - `GET/POST /api/v1/vision/submissions`、`POST /.../{id}/import`
   - `GET/POST /api/v1/vision/golden-sets`、`GET /.../{id}`、`GET /api/v1/vision/models/{id}/golden-sets`
2. **Model Registry 所在檔案**：`live_backend/app/vision_center.py`（`VisionCenter` 類別；磁碟 `model_registry/<prop_direction|four_side_hover>/<model_id>/best.pt` + `manifest.json`；JsonStore 於 `vision_center.json`）。
3. **Submission / Review 所在檔案**：
   - Vision Center：`vision_center.py` 的 `create_submission` / `import_submission`（教師匯入即驗證）。
   - Live 路徑（P1-1/P1-2）：`sessions.py` 的 `review_model_submission`、`main.py` 的 model-submission 審核 + benchmark 路由、`benchmark.py` 的 `PropBenchmarkSandbox`。
4. **ACTIVE Model 讀取位置**：`VisionCenter.active_model(model_type)`（`vision_center.py:207`）；`prop_check` / `hover-analyze` / `process_video` 皆經此解析。
5. **F450 Main-12 應透過何介面呼叫 Vision**：後端 `POST /api/v1/vision/prop-check`（傳 `detections` 或 `image_base64`），前端/整合端不需知道模型路徑，由 Registry 解析 ACTIVE PROP 模型。Hover 用 `POST /api/v1/vision/hover-analyze` / `hover-video`。
6. **已穩定、勿重寫的 Vision 檔案**：`vision_center.py`、`vision_api.py`、`benchmark.py` 及其 4 個測試檔。規則引擎 `evaluate_prop` / `analyze_hover` 邏輯已測試覆蓋，勿重寫。
7. **僅 RESERVED / PENDING 的功能**：
   - FOUR_SIDE_HOVER：程式碼存在，但無真實模型/Dataset → 不得宣稱 ACTIVE/PASS。
   - 真實模型驗證（`UltralyticsModelValidator`）：需後端環境安裝 ultralytics+cv2+numpy（依 AGENTS.md §13 須使用者授權）。
   - 真實 Golden Set / Dataset：當前 `validation_sets/prop` 僅 placeholder（BLOCKED_NO_REAL_SAMPLES）。
8. **尚未完成的真實驗證**：
   - 無真實符合 PROP 契約的 best.pt 上傳/驗證/啟用。
   - 無真實 FOUR_SIDE_HOVER 模型。
   - 無真實 Golden Set / Dataset（含標註圖片）。
   - 模型驗證依賴的 runtime 未在受控後端 venv 安裝。
   - REAL DEVICE PASS 未執行。

---

## 8. WorkBuddy 停止修改 v2.0（§17）

報告完成後，WorkBuddy **停止修改 `D:\FDE-AI-UAS-v2.0`**。後續由 Codex 接手 F450 Main-12 / Download Center / 主平台 Integration / Final QA。WorkBuddy 後續只繼續 `D:\FDE-Flight-Health-AI`，除非使用者重新明確授權。

---

**Vision YOLO 收尾：程式完整（AUTOMATED PASS），真實驗證 PENDING/BLOCKED，提交因外部髒狀態受阻（COMMIT_BLOCKED_BY_EXTERNAL_DIRTY_STATE）。未偽造任何 PASS/ACTIVE。**
