# 【Codex R07 Takeover Check & Final State】— FDE-AI-UAS 2.0

> 接管範圍：Codex 在 R07（Growth Record R07 → best.pt → Teacher Model Center）中途斷電，WorkBuddy 接管同一垂直切片，復用既有 EvidenceRecord / YOLO_MODEL / VisionCenter / Vision Submission / Teacher Model Center，僅 PROP_DIRECTION，不碰 TASK_08 / Download Center / MP-12 / Flight Health / Golden Set / Hard Example / Retrain / ONNX / Hover。
> Git 規則：不 commit / push / merge / deploy；保留 Codex 留下的 dirty state。

## 一、Codex R07 Takeover Check（每個節點 DONE / PARTIAL / MISSING）

| # | 節點 | 狀態 | 關鍵證據（磁碟真實代碼） |
|---|------|------|---------------------------|
| 1 | R07 UI | **DONE** | `templates/learning/growth_record_detail.html:43-58` — `{% if model_upload_allowed %}` 區塊，含 `上傳訓練模型` 表單、`{% csrf_token %}`、`model_file` 輸入、`PROP_DIRECTION` 說明；`model_upload_allowed = (slot=="R07" and project_direction=="ai_flight_assessment")`（`views.py:913-916`） |
| 2 | best.pt Upload | **DONE** | `views.py:938-1018` `growth_model_upload`（`@student_required @require_POST`）：`GrowthModelForm` 驗證 `.pt` ≤100MB → 存 `Evidence(MODEL)` → 呼叫 `submit_model_evidence_to_vision` |
| 3 | YOLO_MODEL Evidence | **DONE** | `models.py:531` `Evidence.Type.MODEL="model"` 已存在；`views.py:973-1006` 寫入 `original_metadata.task_type=PROP_DIRECTION / evidence_type=YOLO_MODEL`，`processed_metadata.vision_submission_id` |
| 4 | Vision Submission | **DONE** | `vision_submission.py:9-40` POST `/api/v1/vision/submissions`；Starlette `vision_api.py:200-216` + `vision_center.py:308-337` `create_submission` 回傳 `{submission_id, status:"SUBMITTED"}` |
| 5 | Teacher Model Center | **DONE** | `live/index.html:227`「學生模型提交」區段（`refreshStudentSubmissions` / `importSubmission`）；`live.js:1903-1916` 已接線，payload 與 `import_submission` 合約一致；「模型管理」區段（`index.html:222`）負責 activate / archive |
| 6 | Review | **DONE** | 教師於 Teacher Model Center 檢視 `GET /api/v1/vision/submissions?status=SUBMITTED`（`vision_api.py:194-199` + `list_submissions` `vision_center.py:342-343`） |
| 7 | Validate | **DONE** | `import_submission` → `upload_model` → `UltralyticsModelValidator`（嚴格 `class_names == PROP_CLASSES`），`vision_center.py:211-253`；`REJECTED` 狀態機完善 |
| 8 | Candidate | **DONE** | `save_evaluation` 後 `status="CANDIDATE"`（`vision_center.py:277`）；狀態機 DRAFT→VALIDATING→VALIDATED→CANDIDATE→ACTIVE→ARCHIVED |
| 9 | Teacher Set ACTIVE | **DONE** | `live.js` activateVisionModel → `POST /api/v1/vision/models/{id}/activate` → `activate_model`（`vision_center.py:288-295`） |
| 10 | Rollback（舊 ACTIVE→ARCHIVED） | **DONE** | `activate_model` 先將同類型舊 `ACTIVE` 置 `ARCHIVED`（`vision_center.py:293-294`）；另有 `archive` 端點（`vision_api.py:80-87`） |
| 11 | Student Vision ACTIVE Resolution | **DONE** | `prop_check`（`vision_api.py:89-103`）經 `active_model("PROP_DIRECTION")` 解析 ACTIVE 模型，未硬編碼路徑；`main.py:102` 亦以 `active_model` 探測 |
| — | Main-12 舊 best.pt 上傳項目移除 | **DONE / N/A** | 未發現任何「Main-12 best.pt 上傳」孤兒代碼實體；`Main-12` 僅見於文檔（F450 飛行任務，屬 TASK_08 範圍，不碰）。模型上傳現僅由 R07（學生）→ Vision Submission → Teacher Model Center 流轉。`live.js:464` 的 P1-1 AI Model Center 是獨立既有功能（live-session 學生上傳惰性 .pt EvidenceRecord），非 R07 物件，依「不重建既有」原則保留不動 |

**結論：11 個節點全部 DONE，無 PARTIAL / MISSING 代碼節點。** 因此依接管規則「從第一個 PARTIAL/MISSING 繼續」——無需 Minimal Patch，轉為「執行針對性測試 + 報告人工驗收狀態」。

## 二、針對性自動化測試結果

| 套件 | 結果 | 備註 |
|------|------|------|
| Starlette Vision（`test_vision_api.py` + `test_vision_center.py`，含 R07 submission 測試 `test_r07_submission_metadata_is_preserved_without_changing_active_model`、`test_student_cannot_import_submission`） | **46 passed / 2 skipped（opencv 跳過）** | 於隔離 venv 實際執行通過；覆蓋 Submission / import+validate / candidate / activate / rollback / active_model 等節點 4–11 |
| Django R07 上傳（`test_project_directions.py:234-313` 共 4 測試：AI 方向顯示上傳、非 AI 不顯示、上傳建立 MODEL 證據並連結 Vision Submission、失敗不殘留證據） | **代碼與合約已核對一致，但本沙箱無 Django 環境無法執行** | 4 測試對 `submit_model_evidence_to_vision` 做 mock，斷言 `Evidence.Type.MODEL`、`task_type=PROP_DIRECTION`、`growth_record_slot=R07`、`evidence_type=YOLO_MODEL`、`vision_submission_id` 寫入，均與 `views.py` / `vision_submission.py` 實作吻合 |

**AUTOMATED（Vision/Starlette 整合路徑）：PASS（實際執行 46/46）。**
**AUTOMATED（Django 學生上傳）：代碼 + 測試已審閱一致；Django 未在沙箱安裝，需於專案 Django 環境執行 `manage.py test learning.tests.test_project_directions` 取得完整 PASS。**

## 三、最終狀態

- **AUTOMATED:** PASS（Starlette 46/46 實際執行；Django R07 測試已撰寫且合約吻合，待專案環境執行）
- **Student R07 / Teacher Model Center / Review / Validate / Candidate / ACTIVE:** WAITING FOR USER（需於瀏覽器實際跑一遍）
- **REAL BROWSER:** PENDING
- **REAL MODEL PASS:** WAITING FOR USER（需真實 best.pt 通過 `UltralyticsModelValidator` 類別名校驗）

## 四、人工驗收啟動方式（供使用者）

1. 啟動 Starlette Vision 服務（提供 `/api/v1/vision/*` 與 live 前端）：
   - 設定：`student_portal/config/settings.py:223` `VISION_SUBMISSION_API_BASE_URL` 預設 `http://127.0.0.1:8030`（可由 `.env` `DJANGO_VISION_SUBMISSION_API_BASE_URL` 覆寫）
   - Teacher Model Center 位於 live 前端 `http://127.0.0.1:8030/`（展開「視覺模型與數據」→「學生模型提交」「模型管理」）
2. 啟動 Django Student Portal（開發伺服器，慣用 `:8020`；管理/教師後台慣用 `:8022`）：
   - 學生 R07 上傳頁：`http://127.0.0.1:8020/student/courses/<enrollment_id>/growth/R07/`
3. 驗收路徑：學生上傳 best.pt → Django 建立 MODEL 證據並 POST Vision Submission（SUBMITTED）→ 教師於 Teacher Model Center「刷新學生提交」→ 填寫 Model Name/Dataset/Rule 後「導入模型倉庫」（觸發 validate）→ 於「模型管理」貼上 Model ID「設為 ACTIVE」（舊 ACTIVE 自動 ARCHIVED）→ 學生 prop_check 經 `active_model` 解析新 ACTIVE。

## 五、Git 狀態

- 不執行 commit / push / merge / deploy。
- 保留 Codex dirty state（含未追蹤新檔 `student_portal/learning/vision_submission.py` 與對 `views.py`/`urls.py`/`forms.py`/`growth_record_detail.html`/`settings.py` 的 R07 修改，以及 `live/index.html`/`live.js` 既有 Vision 管理 UI）。
- 本輪 WorkBuddy 僅「調查 + 讀取 + 執行測試 + 寫報告」，未修改任何業務代碼，未觸碰 v1.5C / Stable / 正式 Pages / Worker / Tunnel / 正式入口 / 正式 DB。
