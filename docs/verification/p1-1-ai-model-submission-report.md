# P1-1 AI 模型提交與教師審核｜完成報告

**日期**：2026-10-06（續 P1-1 Resume）
**分支**：`fde-ai-v2.0-dev` @ `D:\FDE-AI-UAS-v2.0`
**指令**：【FDE-AI-UAS 2.0｜P1-1 AI Model Center｜PROP 模型提交與教師审核 MVP】+【P1-1 Resume】

## 完成判定（兩級標準）

- **AUTOMATED PASS**：後端 11 項目標測試全數通過（涵蓋 8 項核心驗證 + 2 項授權/校驗守衛 + 1 項 student_note 持久化）。
- **REAL DEVICE PASS**：**PENDING**（未於真實瀏覽器 / iPhone 實機驗收）。
- **人工 iPhone 驗收**：PENDING。

## 功能驗證結果（鎖定狀態）

| 項目 | 狀態 | 說明 |
|---|---|---|
| Student R07 Upload（best.pt 上傳） | PASS | `evidence_type=YOLO_MODEL`，經 `saveTrainingEvidence` 寫入 EvidenceRecord |
| best.pt Artifact Storage | PASS | 僅作附件保存，絕不執行 |
| Teacher Inbox（AI 模型提交清單） | PASS | `GET .../training/model-submissions`，學生呼叫回傳 403 |
| Teacher Review | PASS | `POST .../review`，寫入 teacher_review + metadata.model_status |
| APPROVED_FOR_BENCHMARK | PASS | 狀態轉為 APPROVED_FOR_BENCHMARK |
| REJECTED | PASS | 狀態轉為 REJECTED，teacher_note 保存 |
| Model Execution | NOT PERFORMED | 全鏈路不呼叫 torch.load / YOLO / Benchmark / Deploy |
| Benchmark | NOT PERFORMED | 無 Benchmark 端點或邏輯 |
| Production / ACTIVE / DEPLOYED | NOT PERFORMED | 審核不產生任何生產狀態 |
| A06 | UNTOUCHED | 未觸及 A06 相關程式 |
| Candidate Queue | DEFERRED_TO_P1-2 | 複用既有 model-submissions 清單，未新建第二套 Queue |
| Hover（FOUR_SIDE_HOVER） | NOT IMPLEMENTED | 僅 PROP_DETECTION；Hover 留待後續 |
| 非 .pt 檔案 | REJECTED（400） | `_validate_model_submission` 強制 .pt |
| 非法審核決策（如 ACTIVATE） | REJECTED（400） | 僅允許 APPROVED_FOR_BENCHMARK / REJECTED |
| Targeted Tests | PASS | `test_p1_model_submission.py` 11/11 OK |

## 設計要點

- **複用既有基礎設施**：`EvidenceRecord` + `EvidenceType.YOLO_MODEL` + 既有 teacher-review 風格流程；學生上傳沿用 `saveTrainingEvidence`，教師審核沿用新路由，**不建第二系統**。
- **PROP Contract**：`expected_classes = ["CW_F","CCW_F","CW_B","CCW_B"]`，僅 PROP_DETECTION。
- **安全紅線**：best.pt 視為 Artifact Storage，全程不載入/不驗證/不執行；500MB 上限與空檔/型別檢查。
- **前端獨立性**：新增 `aiModelOutcomeCard`（學生）與 `teacherModelReviewCard`（教師）**位於 frozen `visionAssessCenter`/`studentModelSubmission`/`teacherVisionCenter` 之外**；綁定置於 `createController`（與既有學生證據/教師審核共用同一 session id），不動 frozen `initializeVisionCenter`。

## 業務檔案異動

| 檔案 | 異動 |
|---|---|
| `live_backend/app/training_records.py` | 新增 `EvidenceType.YOLO_MODEL`、`ModelTaskType`、`ModelSubmissionStatus` |
| `live_backend/app/sessions.py` | 新增 `list_model_submissions` / `get_model_submission` / `review_model_submission` + import |
| `live_backend/app/main.py` | 新增 `_validate_model_submission`、YOLO 分支、`training_model_submissions`、`training_model_submission_review`、2 條路由、student_note 持久化 |
| `live_backend/tests/test_p1_model_submission.py` | 新增 11 項目標測試（全綠） |
| `live/index.html` | 新增學生 `aiModelOutcomeCard` 與教師 `teacherModelReviewCard` |
| `live/live.js` | 新增 `submitP1ModelOutcome` / `fetchP1ModelSubmissions` / `reviewP1ModelSubmission` 與綁定（位於 `createController`） |
| `live/live.css` | 新增 `.p1-submission` / `.p1-review-actions` 樣式 |

## 保護清單（UNTOUCHED）

- **v1.5C 穩定分支 / `src/` / `student_portal/`**：未觸及。
- **Flight Health**：未觸及。
- **MP-12**：未觸及。
- **Student Live Coach（P0-1 主鏈）**：未觸及。
- **Vision Center 舊模組**（`visionAssessCenter` / `studentModelSubmission` / `teacherVisionCenter` / `initializeVisionCenter`）：未觸及。
- **A06**：未觸及。

## 後續動作

- **Candidate Queue**：DEFERRED_TO_P1-2（本輪未實作第二套 Queue）。
- **Hover / MOTOR / GPS / ESC / FRAME / BATTERY 任務類型**：本輪僅 PROP_DETECTION。
- **Commit / Push / Merge / Deploy**：**NOT PERFORMED**。

## 下一步

- 等待 **REAL DEVICE PASS**（瀏覽器 / iPhone 實機驗收）後，方可標註 `REAL DEVICE PASS`。
- 不自行開始 P1-2。
