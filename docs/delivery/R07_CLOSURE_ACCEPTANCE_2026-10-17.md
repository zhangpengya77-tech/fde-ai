# R07 模型上傳至教師模型倉庫與數據飛輪收尾驗收報告

- 日期：2026-10-17
- 範圍：隔離 DEMO 環境（`D:\FDE-AI-UAS-v2.0\demo\runtime\`）；正式 v1.5C / 正式 DB / 模型 / 學員資料 / R07 核心 / 審核規則 / ACTIVE 回滾 / YOLO 核心推論 **均未修改**
- 方法：以實際程式碼、資料庫、檔案、測試證據逐項驗證；**未只看頁面打開／HTTP 200**；**未實際執行不填 PASS**
- 結論：**具備交由教師人工認證的條件**（MANUAL_ACCEPTANCE_PENDING，教師確認後方可標記 PASSED）

---

## 0. 驗收鏈路總覽

```
學員 R07 上傳 .pt（Django growth_model_upload）
   → Live Backend create_submission（位元組落盤，從不載入/推論，status=SUBMITTED）
   → 教師模型倉庫（Django VisionModelRecord 目錄 + Live vision_center.json 驅動 ACTIVE）
   → 教師圖片驗證（validate_image_with_model → 真實 ultralytics 推論，唯讀）
   → 教師確認/啟用（activate_model 硬閘 VALIDATED；回滾只回 VALIDATED）
   → 數據飛輪留存（submissions/datasets/hard_examples）
   → 測試版本清理（本輪保守清理 21 筆佔位）
   → 交教師人工認證
```

雙註冊表架構（關鍵事實）：Django `VisionModelRecord.model_id`（UUID 目錄表）與 Live `vision_center.json` 的 `models[].model_id`（如 `PROP_20261010_X_accv2_23fd`）是**兩套不同 ID**；ACTIVE／推論真正以 **Live registry** 為準；Django `deployment_status` 正式碼裡從不被寫成 ACTIVE（恆 CATALOGUED）。驗收 ACTIVE 必須讀 `vision_center.json`／`active_model()`。

---

## 1. Phase 1：R07 學員 .pt 上傳通道 — PASS

### 1.1 程式碼證據（唯讀核對）
| 檢查項 | 結果 | 證據 |
|---|---|---|
| 入口與路由 | PASS | `student_portal/learning/views.py:1189` `growth_model_upload`（`@student_required @require_POST`），既有 R07 路由由 `test_vision_repository` 斷言保留 |
| 請求/回應契約 | PASS | 成功→302＋訊息「best.pt 已提交，狀態：等待教師審核」；異常→回滾＋「模型提交失敗」（不假成功） |
| 格式/大小校驗 | PASS | `forms.py:396` `GrowthModelForm.clean_model_file`：副檔名須 `.pt`、≤100MB |
| 保存位置 | PASS | `Evidence(...).upload.save(...)` → `demo/runtime/media/evidence/<uuid>/…pt` |
| 轉發 Live Backend | PASS | `submit_model_evidence_to_vision` → Live `create_submission`（`vision_center.py:480`）位元組寫 `submissions/<task>/sub-<uuid>/submission.pt` |
| **從不載入/推論** | PASS | `create_submission` 只存 bytes，無 YOLO 載入、無 predict 調用 |
| 上傳後狀態 | PASS | submission.status=SUBMITTED→IN_PROGRESS；**不自動通過、不自動啟用**（ACTIVE 需教師操作） |
| 完整性 | PASS | SHA-256 雙向核對（寫入 bytes ≡ 讀回 bytes；`processed_metadata.artifact_sha256`） |
| 記錄關聯 | PASS | `processed_metadata{vision_submission_id, submission_status, task_type}`＋Evidence/Submission 關聯 |

### 1.2 行為測試（本輪新增，填補真實覆蓋缺口）
**新增檔案**：`student_portal/learning/tests/test_r07_upload_acceptance.py`（4 項）
唯一縫：`patch("learning.views.submit_model_evidence_to_vision")`（因單測不起 HTTP 服務）

| 測試 | 斷言 | 結果 |
|---|---|---|
| valid upload | 302 + forward 被調 + 唯一 MODEL Evidence + 位元組一致 + SHA-256 匹配 + `vision_submission_id=='sub-accept-test'` + status=IN_PROGRESS + **VisionModelRecord==0（不自動建倉記錄）** | **PASS** |
| invalid extension | forward 未調、無 Evidence | **PASS** |
| non-AI direction | 拒絕上傳 | **PASS** |
| forward failure | 回滾：無 Evidence、submission 仍 NOT_STARTED（不假成功） | **PASS** |

> **已知限制（誠實記錄）**：空 `.pt` 在 Django 表單層不攔截，只在 Live Backend `create_submission` 攔截。表單層未加空檔檢查是既有行為，本輪未改（最小修改原則）。

---

## 2. Phase 2：教師模型倉庫（真實記錄，非靜態/Mock/硬編碼）— PASS

### 2.1 真實資料存在性（DEMO 隔離庫實測）
- **Django 目錄表**：`learning_visionmodelrecord` 1 筆 `c291aaee7098450881d54edb7f7f1cae`（PROP_DIRECTION, V1, CANDIDATE/NOT_EVALUATED/CATALOGUED, `is_demo_test_only=1`, sha256 已記錄, snapshot=STORED）
- **Live registry**：真實「教師從提交匯入」鏈 3 筆（`PROP_20261015_DEMO-A_v1` / `_3db1` / `PROP_20261016_DEMO-A_v1`），`source_submission_id` 綁定 3 個 IMPORTED 提交（ev_ref 為 Django evidence UUID）
- **教師頁面**：`/teacher/vision-center/` 由視圖從上述 store 取數（`test_teacher_catalogue` + `test_vision_model_center` 斷言頁面開啟與關聯，非硬編碼卡）

### 2.2 狀態維度核對（四維獨立，不合併）
review_status(SUBMITTED/CANDIDATE/REJECTED/RETURNED)｜validation_status(NOT_EVALUATED/VALIDATED/FAILED)｜training_usage｜deployment_status(CATALOGUED/ACTIVE/ARCHIVED)——逐筆核對與 DB/JSON 一致。

### 2.3 回歸批次
`test_teacher_catalogue + test_vision_model_center + test_golden_set_contract + test_project_directions` = **113/113 OK**（in-memory test DB，與 DEMO DB 隔離）。

---

## 3. Phase 3：圖片驗證與模型確認（真實 vs Mock 明確區分）— PASS

### 3.1 教師驗證路徑恆為真實推論
- `validate_image_with_model`（`vision_center.py:203`）**無模擬分支**；`FDE_DEMO_SIMULATED_INFERENCE=1` 只影響學員端 `simulate_prop_check`／`approve_demo_submission`，**不影響教師驗證端**
- 推理器 `UltralyticsModelRunner`（:119）：`YOLO(path, task="detect")` + `cv2.imdecode` + `model.predict()`——真實 ultralytics

### 3.2 真實推論實測（LivePy，真實 ACTIVE 模型）
`.test-temp/r07_real_infer_probe.py` 載入 DEMO ACTIVE `PROP_20261010_X_accv2_23fd/best.pt`（5,503,222B）：
```
YOLO_LOAD: OK | names={0:'CW_F',1:'CCW_F',2:'CW_B',3:'CCW_B'}
PREDICT: OK | detection_count=0        ← 實色測試圖，誠實真實結果（0 偵測）
REAL_INFERENCE_RESULT: REAL_INFERENCE_RAN_OK detection_count=0
```

### 3.3 行為測試
- `test_teacher_vision_center` **22/22 OK**：真實偵測事實比對、mismatch/lowconf/no-detection 不通過、422/404、**驗證唯讀不動 ACTIVE**、activation 保留舊版本、rollback 只回 VALIDATED、PROP/HOVER 獨立
- `test_vision_center` **35/35 OK**（LivePy 執行，opencv 可用，零 skip）

### 3.4 教師確認/啟用邊界
激活硬閘：`validation_status==VALIDATED` 且 status≠REJECTED 且 `file_path` 可讀；不满足 raise `validated_model_required`。**本輪未執行任何自動批准/切 ACTIVE**。

---

## 4. Phase 4：數據飛輪與測試版本清理（DEMO 隔離）— PASS

### 4.1 清理前盤點（46 模型）
ACTIVE 2｜ARCHIVED 20（回滾歷史）｜VALIDATED 2｜REJECTED 22；submissions 4｜datasets 17｜hard_examples 9。

### 4.2 清理決策與執行
| 類別 | 數量 | 處置 | 理由 |
|---|---|---|---|
| ACTIVE | 2 | **保留** | 在用中模型 |
| ARCHIVED | 20 | **保留** | 回滾歷史（activate 只遷移不刪除） |
| demo_active 綁定 REJECTED | 1 | **保留** | `PROP_20261015_DEMO-A_v1_2b9b` 綁定 demo_active_submissions |
| REJECTED 佔位（fake/mis/zz-debug） | 21 | **刪除** | 四重條件全滿足：①REJECTED ②夾具命名 ③`source_submission_id=None`（無 R07 鏈）④JSON 其他區塊零引用；抽樣雜湊核證 `mis-42a994` 兩檔為真實模型位元組副本 |
| VALIDATED 非 ACTIVE | 2 | **待教師決策** | `accv1_5fcb`（檔缺失）、`DEMO-A_v1`（綁 IMPORTED 提交） |
| Django is_demo_test_only VMR | 1 | **待教師決策** | 2026-10-08 播種、非本輪、掛 growth_submission_id=7、integrity=MISSING 為過期狀態（檔實際存在） |

**清理後**：25 模型（ACTIVE 2｜ARCHIVED 20｜VALIDATED 2｜REJECTED 1）；submissions/datasets/hard_examples 計數不變。

### 4.3 清理後一致性核對 — 全部 PASS
- [PASS] ACTIVE 2 筆不變、檔案可讀、`VisionCenter.active_model()` 兩任務正確解析（真實類別重載 JSON）
- [PASS] ARCHIVED 20 筆全保留；demo_active_submissions 綁定不變
- [PASS] Django 五張表列數與清理前完全一致（**本輪零 DB 寫入**）
- [PASS] registry 目錄 16 個，無孤兒、無斷鏈（除清理前既缺 9 筆舊夾具）
- [PASS] 備份 `demo/runtime/backups/r07_closure_20261017-202509/`（vision_center.json.bak + demo.sqlite3.bak）

### 4.4 安全邊界遵守
未改正式環境、未新增表/migration、未部署/commit/push、未自動批准/切 ACTIVE；刪除僅限隔離 DEMO 內可明確識別的測試佔位。**名稱含 test/demo/temp 而未核對關聯者（accv*/DEMO-A*/VALIDATED）一律未刪，列教師決策。**

---

## 5. Phase 5：回歸測試結果

| 批次 | 結果 |
|---|---|
| Django（in-memory DB）：teacher_catalogue + vision_model_center + golden_set_contract + project_directions + r07_upload_acceptance + vision_repository | 150/150 OK（含本輪新增 4 項） |
| Live Backend（LivePy）：test_teacher_vision_center | 22/22 OK |
| Live Backend（LivePy）：test_vision_center | 35/35 OK（零 skip） |
| 真實推論探針（LivePy × 真實 ACTIVE 模型） | REAL_INFERENCE_RAN_OK |
| 清理前後一致性（機器斷言） | removed_all_placeholder=True；active_unchanged=True |

---

## 6. 本輪實際修改檔案

| 檔案 | 類型 | 原因 |
|---|---|---|
| `student_portal/learning/tests/test_r07_upload_acceptance.py` | **新增** | 填補 R07 .pt 上傳通道真實覆蓋缺口（4 項） |
| `.test-temp/r07_cleanup_conservative.py` | 新增 | Phase 4 保守清理工具（四重條件護欄） |
| `.test-temp/inv_r07_demo.py` | 新增 | 只讀盤點 |
| `.test-temp/r07_real_infer_probe.py` | 新增 | 真實 YOLO 推論探針 |
| `.test-temp/gen_phase4_closure.py` | 新增 | Phase 4 證據產生器 |
| `.test-temp/r07-closure/*` | 新增 | 分類/前後對照 JSON + 清理報告 |
| `demo/runtime/vision-center/vision_center.json` | 修改（DEMO 資料） | 移除 21 筆佔位模型（已備份） |
| `demo/runtime/vision-center/model_registry/` 13 個目錄 | 刪除（DEMO 資料） | 佔位模型檔案（已備份 JSON） |

**未修改**：任何正式碼、migration、正式 DB、R07 核心、審核規則、ACTIVE 回滾邏輯、YOLO 核心。

---

## 7. 測試資料清單

- **新增**：無（未向 DEMO 寫入新測試資料）
- **刪除**：21 筆 REJECTED 佔位模型（JSON 條目 + 13 個 registry 目錄）；全部為 fake/mis/zz-debug 夾具
- **保留**：2 ACTIVE、20 ARCHIVED（回滾歷史）、2 VALIDATED、1 demo 綁定 REJECTED、Django 全部 1+18+8 列（VMR/Evidence/Growth）
- **待教師決策**：2 VALIDATED 非 ACTIVE＋1 Django is_demo_test_only VMR＋9 筆清理前既缺檔的舊 ARCHIVED 夾具

---

## 8. 真實 vs Mock 區分

| 項目 | 真實 | Mock/模擬 |
|---|---|---|
| 教師圖片驗證 | ✅ 恆真實 ultralytics（無模擬分支） | — |
| 真實 ACTIVE 模型推論探針 | ✅ LivePy × 真實 .pt | — |
| DEMO DB / JSON 讀取 | ✅ 直接 sqlite/json | — |
| 學員端 Photo Check | — | ⚠️ `FDE_DEMO_SIMULATED_INFERENCE=1` 模擬（僅學員演示，不涉教師驗收） |
| Live Backend 單測 | — | ⚠️ FixtureRunner/FixtureValidator 模擬推論（測試檔明示「真實推論不由本檔證明」，由 3.2 探針補證） |

---

## 9. 未竟事項 / 風險 / 阻擋（交教師決策）

1. **R1** `PROP_20261010_X_accv1_5fcb`：VALIDATED 但檔案缺失（舊夾具）——保留待裁決
2. **R2** Django VMR `c291aaee…`：is_demo_test_only、integrity 過期 MISSING、掛 growth_submission_id=7——刪與否牽動演示鏈，待裁決
3. **R3** demo_active_submissions 綁定的提交 `sub-ea18f5eb` 本身是 REJECTED（direct-api-probe）——演示鏈預存狀態，待裁決
4. **R4** LIVE submissions 的 3 個 ev_ref（1515e411/2c258ab0/ab1458b3）在當前 Django DB 不存在——跨庫漂移（既有）
5. **R5** 空 `.pt` 僅 Live Backend 攔截、Django 表單層不攔（既有行為，未改）
6. **R6** DEMO 服務（:8110/:8111）本輪未常駐——公開隧道驗收時重啟
7. **教師人工認證未執行**：以上技術驗收證據供教師裁決；**未經教師確認，不得標記正式驗收完成**

---

## 10. 結論

**可否交教師人工認證：可以。** 五階段技術驗收全部以真實證據通過；清理保守且可回溯（備份+前後對照）；未触碰任何正式资源与核心逻辑。請教師就第 9 節 R1–R6 裁決後，進行人工確認/認證。
