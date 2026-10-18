# 教師視覺模型中心｜現況稽核報告（V-AUDIT-1）

- 報告日期：2026-10-10
- 專案：FDE-AI-UAS 2.0（`D:\FDE-AI-UAS-v2.0`）
- 分支：`fde-ai-v2.0-dev`
- 稽核前 Git HEAD：`e5c044244475d18930f32e26696d2cf9cf43dfa6`
- 稽核範圍：教師後台 視覺模型中心 / 資料飛輪倉庫 / Golden Test / 模型審核與啟用
- 稽核性質：**唯讀**。本輪未修改任何業務程式，未 commit / push / merge / deploy。
- 完成標準：教師能在網頁上完成「查看學員模型 → 驗證圖片 → 正式啟用 → 保存下一屆資源」，全程不需 VS Code、不改 Python、不手動覆蓋 `best.pt`、不重寫規則。

---

## 一、稽核結論總表

| # | 稽核項目 | 判定 | 關鍵證據 |
|---|---|---|---|
| A | 學員模型上傳 | **WORKING** | `vision_api.py:194`、`views.py:989`、`vision_center.py:308` |
| A2 | 模型檔案 SHA256 完整性 | **WORKING** | `vision_center.py:225`、`vision_integrity.py` |
| B | 視覺規則引擎 PROP_DIRECTION（CW_F / CCW_F / CW_B / CCW_B） | **WORKING** | `vision_center.py:15,575` |
| B2 | 視覺規則引擎 FOUR_SIDE_HOVER（FRONT / RIGHT / BACK / LEFT） | **PARTIAL** | 後端存在 `vision_center.py:16,646`；Django 端未開放 |
| C | 真實 YOLO 推論 | **PARTIAL** | Live Backend 可推論；Django 端物理上不可 |
| D | Golden Test 黃金測試 | **PARTIAL** | 框架與阻擋邏輯存在，指標從未計算 |
| E | ACTIVE 正式模型切換 | **PARTIAL** | Starlette 可切換且驅動推論；Django 端無啟用 view |
| F | 版本歷史與一鍵回復舊版本 | **MISSING** | 全庫無 rollback / restore 實作 |
| G | 下一屆模型資源庫 | **PARTIAL** | `data.yaml` 僅在匯出時產生；訓練影像與標註為空目錄 |
| H | 教師圖片驗證（上傳測試圖 → 真實推論） | **PARTIAL** | UI 存在，但 `verify_run` 永遠拒絕 |
| I | 單一教師入口頁 | **MISSING** | 目前為 3 張入口卡片 + 8 個分散頁面 |

判定用語定義：
- **EXISTS**：程式碼存在，但未確認可運作。
- **WORKING**：程式碼存在，且經既有測試或本次唯讀檢查確認可實際運作。
- **PARTIAL**：部分完成；已有骨架或單邊實作，但端到端流程不通。
- **MISSING**：不存在實作。

---

## 二、系統架構關鍵事實（本次稽核最重要的發現）

### 2.1 兩套並行、互不溝通的視覺狀態系統

這是本專案最大的架構斷點，決定了後續所有開發取徑。

**(1) Starlette `VisionCenter`（真正的視覺能力所在）**

- 檔案：`live_backend/app/vision_center.py`（39,821 bytes）
- 狀態儲存：**JSON 檔案**，經 `JsonStore`，路徑由 `FDE_VISION_CENTER_ROOT` 決定
  - `main.py:107`：`center_root = Path(os.environ.get("FDE_VISION_CENTER_ROOT") or Path(os.environ.get("LOCALAPPDATA", Path.home())) / "FDE-AI-UAS" / "vision-center")`
  - DEMO 實際路徑：`D:\FDE-AI-UAS-v2.0\demo\runtime\vision-center\vision_center.json`
    （由 `demo/tools/demo_env.cmd:14,54` 設定 `FDE_VISION_CENTER_ROOT=%FDE_DEMO_ROOT%\runtime\vision-center`）
- 已實作的完整能力：
  - `UltralyticsModelValidator.validate()`（第 76–116 行）：副檔名 → 魔術簽章（`PK\x03\x04` / `\x80\x02` / `\x80\x03` / `\x80\x04`）→ 可讀性 → 最小 1024 bytes → YOLO 載入 → `task == "detect"` → 類別非空 → 64×64 零陣列冒煙推論 → 回傳格式檢查。
  - `UltralyticsModelRunner.predict()`（第 125–151 行）：真實 `ultralytics` 推論，`cv2.imdecode` 解碼，逐框回傳 `{"class","confidence","bbox","center_x","center_y"}`。
  - `VisionCenter.upload_model()`（第 211–258 行）：寫入 `model_registry/<type>/<model_id>/best.pt`、計算 `sha256`、寫 `manifest.json`，再驗證。驗證通過 → `VALIDATED`；失敗 → `REJECTED`。**類別名稱必須與 `PROP_CLASSES` / `HOVER_CLASSES` 完全相等（順序敏感）**，否則 `model_class_names_mismatch`。
  - `activate_model()`（第 288–298 行）：要求 `validation_status == "VALIDATED"` 且 `status != "REJECTED"`；會**自動把同 `model_type` 的前一個 ACTIVE 降為 ARCHIVED**，再設新模型為 ACTIVE。
  - `save_evaluation()`（第 270–283 行）：要求 metrics 八個鍵齊全（`precision`/`recall`/`map50`/`map50_95`/`per_class_metrics`/`confusion_matrix`/`error_count`/`low_confidence_count`），否則 `incomplete_golden_evaluation`；通過後模型升級為 `CANDIDATE`。
  - `infer_active()`（第 193–199 行）：讀 ACTIVE 模型檔案並執行真實推論。
  - `create_submission()`（第 308–337 行）：學員 `best.pt` 以**惰性附件**形式保存，**永不執行**。
  - `import_submission()`（第 345–366 行）：把學員提交導入為正式模型（內部走 `upload_model`，因此同樣受驗證閘門約束）。
  - `export_dataset()`（第 499–509 行）：只在匯出時才生成 `data.yaml`。
  - `process_video()`（第 398–449 行）：後端抽幀 + hover 分析。

**(2) Django `VisionModelRecord`（教師目前看到的介面所依據的資料）**

- 檔案：`student_portal/learning/models.py:732–831`
- 狀態儲存：**SQL**（DEMO 為 `demo/runtime/db/demo.sqlite3`）
- 關鍵欄位：`model_id`(UUID PK)、`evidence`(OneToOne)、`task_id`、`student`、`cohort`、`model_version`、`parent_record`、`lineage_root`、`dataset_version`、`class_mapping`、`artifact_reference`、`artifact_sha256`、`snapshot_path`、`review_status`、`validation_status`、`training_usage`、`deployment_status`、`teacher_review`、`validation_history`、`golden_test_summary`、`integrity_status`
- 約束：DB CheckConstraint `vision_record_active_requires_validated`（models.py:845–849）
- Django 端另有 `active_blocked_reason()`（models.py:907–918）與 `assert_no_false_active()`（`golden_set.py:713`）

**（1）與（2）之間沒有任何同步機制。** 這是「切了 ACTIVE 但推論還是舊模型」這類問題的結構性根因。

### 2.2 真實推論只有 Live Backend 做得到（決定性事實）

| 環境 | Python | ultralytics | torch | cv2 | numpy | 能否真實推論 |
|---|---|---|---|---|---|---|
| Django venv（`.test-temp/django-venv`，Python 3.12.13 / Django 5.2.17） | 3.12.13 | ✗ 無 | ✗ 無 | ✗ 無 | ✗ 無 | **不能**（四項全部 `ModuleNotFoundError`） |
| Live Backend Python（`C:\Users\admin\AppData\Local\Python\pythoncore-3.14-64\python.exe`） | 3.14 | 8.4.46 | 2.11.0+cpu | 4.13.0 | 2.4.4 | **能** |

外部 YOLO 服務 `:8765` 目前 **未啟動（CLOSED）**。

→ 結論：教師圖片驗證**必須**經由 Live Backend 執行，不能在 Django 進程內跑。這與既有安全立場一致（見 2.3），也正好是最小修改的正確取徑：**接線**，而不是把 torch 搬進 Django。

### 2.3 目前刻意阻擋教師圖片驗證的閘門

檔案：`student_portal/learning/vision_verification.py`（全文 57 行，已完整讀取）

```python
def runner_state() -> dict:
    """本輪固定回報不可用：本機為 Windows 11 家庭版、BIOS 未啟用虛擬化、
    帳號非管理員、Docker daemon 未啟動，無任何可靠隔離環境。"""
    return {
        "available": False,
        "environment": "NONE",
        "environment_label": "無可用隔離環境",
        "reason": "本機無可靠模型隔離沙箱，禁止載入學員 .pt 執行推論。",
        "required_for_enable": "需先具備作業系統級沙箱或容器隔離環境。",
    }
```

連鎖效應：
- `verification_blocked_reason()` 永遠回傳該 reason（第 47–48 行）
- `verification_ready()` 永遠 `False`
- `teacher_vision_model_verify_run`（`views.py:1718–1727`）永遠走 `if blocked: messages.error(...)` 分支，**永遠拒絕並顯示「圖片驗證 Runner 尚未接入，未執行任何推論。」**

模組 docstring 明確引用教師 2026-10-08 指令：「學生 .pt 是 PyTorch pickle，載入即執行任意程式碼，禁止在服務進程內載入。」

**重要區分**：此閘門阻擋的是「在**未隔離的 Django 進程**內載入學員 `.pt`」。若改由**既有的 Live Backend 推論服務**執行（該服務本來就以載入 `.pt` 為職責），並在 Django 端經由 HTTP 呼叫，則不違背此安全立場，反而是其正解。

### 2.4 環境與連接埠基線（本輪實測）

```
TCP  127.0.0.1:8022       LISTENING  PID 21800   ← 正式 Django（僅本機綁定）
TCP  127.0.0.1:8770       LISTENING  PID 4348    ← 正式 RAG
TCP  192.168.1.114:8110   LISTENING  PID 7620    ← DEMO Django
TCP  192.168.1.114:8111   LISTENING  PID 18548   ← DEMO Live Backend
                          :8765    未監聽         ← 外部 YOLO 服務未啟動
```

### 2.5 現有教師視覺相關路由（`learning/urls.py:47–88`）

```
teacher/vision-models/                                    teacher_vision_model_list
teacher/vision-models/<uuid:evidence_id>/                 teacher_vision_model_detail
teacher/vision-models/<uuid:evidence_id>/review/          teacher_vision_model_review
teacher/vision-models/<uuid:evidence_id>/catalogue/       teacher_vision_model_catalogue
teacher/vision-models/<uuid:evidence_id>/verify/          teacher_vision_model_verify
teacher/vision-models/<uuid:evidence_id>/verify/run/      teacher_vision_model_verify_run
teacher/vision-flywheel/                                  teacher_vision_flywheel
teacher/vision-repository/<uuid>/integrity-check/         teacher_vision_model_integrity_check
teacher/vision-repository/integrity-check/                teacher_vision_integrity_check_all
teacher/golden-sets/                                      teacher_golden_set_list
teacher/golden-sets/create/                               teacher_golden_set_create
teacher/golden-sets/<str:golden_set_id>/                  teacher_golden_set_detail
teacher/golden-sets/<str:golden_set_id>/samples/          teacher_golden_set_add_sample
teacher/golden-sets/<str>/samples/<uuid>/confirm/         teacher_golden_sample_confirm
teacher/golden-sets/<str:golden_set_id>/freeze/           teacher_golden_set_freeze
teacher/vision-repository/<uuid:model_id>/golden-test/    teacher_golden_test_page
```

### 2.6 現有 Live Backend 視覺 API（`vision_api.py:274–294`）

```
GET  /api/v1/vision/models                        列出模型
POST /api/v1/vision/models                        教師上傳模型（需 X-FDE-Role: teacher）
GET  /api/v1/vision/models/{model_id}
POST /api/v1/vision/models/{model_id}/evaluate    儲存 Golden 評估
POST /api/v1/vision/models/{model_id}/activate    設為 ACTIVE
POST /api/v1/vision/models/{model_id}/archive     封存
POST /api/v1/vision/prop-check                    PROP 規則判定（可帶 image_base64）
POST /api/v1/vision/hover-analyze                 四向 hover 判定
POST /api/v1/vision/hover-video                   影片抽幀 + hover 分析
GET/POST /api/v1/vision/datasets
POST /api/v1/vision/datasets/{id}/build-next      下一屆資料集
GET  /api/v1/vision/datasets/{id}/export          匯出 zip（含 data.yaml）
GET  /api/v1/vision/hard-examples
POST /api/v1/vision/hard-examples/{id}/review
POST /api/v1/vision/camera-profiles
GET/POST /api/v1/vision/submissions               學員提交
POST /api/v1/vision/submissions/{id}/import       匯入為模型
GET/POST /api/v1/vision/golden-sets
GET  /api/v1/vision/golden-sets/{id}
GET  /api/v1/vision/models/{id}/golden-sets
```

教師身分驗證：`_teacher(request)`（第 14–20 行）讀 `X-FDE-Role`（須為 `teacher`）與 `X-FDE-Teacher-ID`（非空）。

**注意：目前無「對指定 model_id 執行單張圖片推論」的端點。** `prop-check` / `hover-analyze` 走的是 `active_model()`，而非指定模型。這是本次開發必須補的關鍵缺口。

### 2.7 類別契約（順序即索引）

```python
PROP_CLASSES  = ("CW_F", "CCW_F", "CW_B", "CCW_B")
HOVER_CLASSES = ("FRONT", "RIGHT", "BACK", "LEFT")
MODEL_TYPES   = ("PROP_DIRECTION", "FOUR_SIDE_HOVER")
MODEL_ID_PREFIX = {"PROP_DIRECTION": "PROP", "FOUR_SIDE_HOVER": "HOVER"}
```

`prop_scan.py:15–16` 註明「順序即模型索引」。`upload_model` 用 `list(details["class_names"]) != expected` 做**逐位相等**比對，因此順序錯誤會直接被拒絕 —— 這是既有且正確的安全設計。

`evaluate_prop()`（第 575–612 行）的四槳位對應：
```python
"M1": {"expected": "CCW_F", "quadrant": "front_right"}
"M2": {"expected": "CCW_F", "quadrant": "rear_left"}
"M3": {"expected": "CW_F",  "quadrant": "front_left"}
"M4": {"expected": "CW_F",  "quadrant": "rear_right"}
```
判定結果：`PASS` / `NG`（細分 `ROTATION_WRONG` / `FACE_WRONG` / `ROTATION_AND_FACE_WRONG`）/ `INSUFFICIENT_DATA`（`MISSING_TARGET` / `DUPLICATE_DETECTION` / `LOW_CONFIDENCE`）。

### 2.8 Django 端任務支援範圍

- `golden_set.py:27`：`SUPPORTED_TASK_IDS = ("PROP_DIRECTION",)`（註解：與 `vision_repository.SUPPORTED_TASK_IDS` 一致）
- `models.py:965`：`SUPPORTED_TASK_IDS = ("PROP_DIRECTION",)`
- `models.py:1023–1025`：DB CheckConstraint 只允許 `task_id="PROP_DIRECTION"`
- `golden_set.py:73–78`：`validate_task_id()` 對其他任務拋出「本輪僅支援 PROP_DIRECTION_V1，收到 …」

→ **FOUR_SIDE_HOVER 在後端（Starlette）完整存在，但 Django 端完全未開放。** 依指令要求（兩個任務需同一 UI、但獨立模型／規則／測試集／啟用版本），後續需放寬 Django 端白名單並保持兩套完全獨立的狀態。

### 2.9 目前模型資料實況（DEMO）

`demo/runtime/vision-center/vision_center.json` 全量內容（1,008 bytes）：

```json
{
  "schema_version": 1,
  "models": [],
  "datasets": [],
  "evaluations": [],
  "hard_examples": [],
  "camera_profiles": [],
  "submissions": [ { "submission_id": "sub-ea18f5eb-...", "task_id": "PROP_DIRECTION",
                     "file_size": 28, "status": "SUBMITTED", "notes": "api probe" } ],
  "golden_sets": []
}
```

關鍵事實：
- **`models` 為空 → 目前沒有任何正式模型，`active_model("PROP_DIRECTION")` 回傳 `None`。**
- `datasets` 為空 → `upload_model()` 的 `dataset_binding_mismatch` 檢查會先擋下（它要求 `dataset_id` 必須存在且 `model_type`/`dataset_version` 相符）。
- 唯一的 submission 只有 28 bytes、且簽章為 `FDE-AI-UAS-DEMO-TEST-ONLY-best.pt` 純文字（見下），**連 1024 bytes 下限都不到**，永遠不可能通過驗證。
- `demo/runtime/media/vision_repository/` 與 `evidence/` 下的 `.pt` 檔（2,097 bytes）簽章同為 `FDE-AI-UAS-DEMO-TEST-ONLY-best.pt`，**是佔位文字檔，不是真模型**。

### 2.10 磁碟上真實可載入的 YOLO 權重

全專案（排除 `.test-temp`）掃描後，**唯一具備真實 PyTorch/ZIP 簽章（`PK\x03\x04`）且大小合理**的檔案為：

```
.test-temp/r07-demo-model/FDE_R07_DEMO_TEST_ONLY_best.pt   5,512,149 bytes
```

另有外部檔：`C:\Users\admin\AppData\Local\FDE-AI-YOLO\app\backend\yolo11n.pt`（5,613,764 bytes）、`C:\Users\admin\Documents\Codex\2026-08-14\new-chat\yolov8n.pt`。

→ **這對驗收測試是硬約束**：`yolo11n.pt` 的類別是 COCO 80 類，**不等於** `PROP_CLASSES`，因此它**不可能**通過 `upload_model()` 的類別契約檢查。要產出一個合法可啟用的模型，必須有一份以 `CW_F/CCW_F/CW_B/CCW_B` 四類訓練的 `best.pt`。**本機目前沒有這種檔案。**（依指令「不得偽造假的訓練資料」，此缺口只能如實標記，並在驗收中以「格式／安全／契約／阻擋行為」的驗證代替「真實準確度」驗證。）

### 2.11 Golden Set 現況

`validation_sets/prop/manifest.json` 全文：

```json
{
  "validation_set_id": "PROP_GOLDEN",
  "version": "PROP_GOLDEN_V1",
  "class_contract": ["CW_F", "CCW_F", "CW_B", "CCW_B"],
  "class_contract_version": "PROP_V1",
  "image_count": 0,
  "per_class_count": { "CW_F": 0, "CCW_F": 0, "CW_B": 0, "CCW_B": 0 },
  "source": "NONE",
  "review_status": "BLOCKED_NO_REAL_SAMPLES",
  "frozen": false,
  "note": "P1-2.5 真實性檢查結果：磁碟上不存在對應 … 四類的真實人工確認標註樣本，因此本集合尚未成為 Golden Set。… 在未凍結且未經教師確認前，available() 恆為 false，Benchmark 狀態為 WAITING_FOR_GOLDEN_SET，不偽造 PASS。"
}
```

`validation_sets/prop/images/` 與 `labels/` 僅有 `.gitkeep`。

→ **Golden Set 目前是空的（0 張圖），且是刻意、誠實地空著。** 因此 Golden Test 的 8 項指標（`precision`/`recall`/`map50`…）在現況下**不可能被真實計算**。任何聲稱 Golden Test PASS 的結果都會是偽造。

### 2.12 Django 教師頁面現況

**入口**：`teacher_dashboard.html` 第 5–6 行為三張卡片（視覺模型中心／資料飛輪倉庫／R08 調查），**無單一整合入口**。

**`teacher_vision_flywheel.html`**：15 欄表格，直接對教師暴露工程細節：
```
Model ID / 父版本 / 快照 SHA256 / 完整性 / ACTIVE / DEMO_TEST_ONLY / ...
```

**`teacher_golden_test.html`**：按鈕**永久 `disabled`**。

**`teacher_vision_verify.html`**：有完整 UI，但依 2.3 永遠顯示 BLOCKED。

→ 完全符合指令所指「教師需要 VS Code、改 Python、手動換 best.pt、重配規則」的問題描述。

---

## 三、逐項細節判定

### A. 學員模型上傳 — **WORKING**

- 路徑一（Live API）：`vision_api.py:194–216` `POST /api/v1/vision/submissions`
- 路徑二（Django 網頁）：`views.py:989–1057` `growth_model_upload`（R07 成長紀錄）
- 後端落地：`vision_center.py:308` `create_submission()`
- 安全性：以惰性附件保存，**永不執行**；`task_id` 必須屬於 `MODEL_TYPES`；副檔名必須 `.pt`；大小上限 100 MB
- 已有測試：`student_portal/learning/tests/test_vision_model_center.py`、`test_vision_repository.py`

### A2. 模型完整性（SHA256） — **WORKING**

- `vision_center.py:225` 上傳即計算 `file_hash`
- `vision_integrity.py` 提供重算與比對
- 路由：`teacher/vision-repository/<uuid>/integrity-check/`

### B. PROP_DIRECTION 規則引擎 — **WORKING**

- 四類契約：`vision_center.py:15`，順序即索引
- 四槳位規則：`evaluate_prop()`（第 575–612 行），M1/M2 = CCW_F、M3/M4 = CW_F
- 五種 reason_code 完整
- 契約檢查：`upload_model()` 第 244–245 行強制逐位相等
- 已有測試：`test_vision_rule_templates.py`、`test_vision_api.py`、`test_vision_center.py`

### B2. FOUR_SIDE_HOVER 規則引擎 — **PARTIAL**

- 後端完整：`HOVER_CLASSES`（第 16 行）、`analyze_hover()`（第 646–…）、`DEFAULT_HOVER_CONFIG`（第 29–37 行）、`process_video()`（第 398–449 行）、`_homography()` / `_project()` 相機校正
- 缺口：Django 端 `SUPPORTED_TASK_IDS` 僅 `PROP_DIRECTION`，無任何 UI 或表單可觸及此任務
- 依指令「兩者使用同一 UI 但必須有**獨立**模型、規則、測試集與啟用版本」，此為後續必補，且**不可與 PROP 共用狀態**

### C. 真實 YOLO 推論 — **PARTIAL**

- 可推論端：Starlette（見 2.2 證明）
- 不可推論端：Django（缺 ultralytics/torch/cv2/numpy）
- 現有推論入口全部綁 `active_model()`（`infer_active` 第 193–199 行），**沒有「以指定模型對單張圖推論」的端點**
- `:8765` 外部服務未啟動

### D. Golden Test — **PARTIAL**

- 存在：`golden_set.py`（服務層）、`golden_set_guard.py`（防偽 ACTIVE）、`assert_no_false_active()`（`golden_set.py:713`）、`teacher_golden_test_page`（`views.py:2341–2406`）、完整度分級 `COMPLETENESS_INCOMPLETE/STRUCTURAL/EVALUATION_READY`
- `model_golden_test_blocked_reason()` 為權威判斷，不採信頁面傳入的清單（已正確設計）
- 缺口：
  1. 指標從未被計算（`vision_center.json` 的 `evaluations` 為空；`validation_sets` 為 0 張圖）
  2. UI 按鈕永久 `disabled`
  3. 無「教師上傳測試圖 → 跑 Golden Set → 產生 summary」的實際執行路徑

### E. ACTIVE 正式模型切換 — **PARTIAL**

- Starlette：`activate_model()`（第 288–298 行）**可用**，且前一個同型 ACTIVE 自動轉 ARCHIVED（保護舊模型不被覆蓋）
- 該 ACTIVE 會**實際驅動推論**（`infer_active` 讀 `model["file_path"]`，第 199 行）
- 缺口：
  1. Django 端**完全沒有 activate view**，教師無法從網頁切換
  2. Django `deployment_status` 與 Starlette `status` 無同步 → 改了 Django 不影響推論
  3. 無「切換失敗時保留原 ACTIVE」的顯式保證（Starlette 是先歸檔舊的再設新的；若新模型設定失敗，會出現無 ACTIVE 的窗口）
  4. 未驗證「切換後推論真的用新模型」

### F. 版本歷史與一鍵回復 — **MISSING**

全庫搜尋 `rollback` / `restore` / `revert` 於視覺領域：無實作。
`parent_record` / `lineage_root` 欄位存在（`models.py`），但只是血緣標記，**不構成可回復的版本歷史**。
`vision_center.json` 的 `models` 陣列保留 `ARCHIVED` 項目，技術上可作為歷史，但**無 API、無 UI、無一鍵回復動作**。
→ 本項為**完全缺失**，且是本次指令的核心要求之一。

### G. 下一屆模型資源庫 — **PARTIAL**

- 存在：`create_dataset()`（第 451–472 行）、`build_next_dataset()`（第 477–497 行，要求 hard example 必須已 `CONFIRMED`/`CORRECTED` 才可納入）、`export_dataset()`（第 499–509 行）
- 存在：hard examples 收集（`prop-check` / `hover-analyze` 非 PASS 時自動建立）、`review_hard_example()`（第 525–531 行）
- 缺口令**指令明確警告的點已驗證成立**：`export_dataset()` 第 504–506 行只寫入空的 `images/` 與 `labels/` 目錄，`data.yaml` 是**匯出時臨時生成**，**並未保存在模型旁邊**
- 缺：無 `is_demo_test_only` 之外的可信度分級；無「教師核准才發布」的閘門；無學生隱私資料的過濾
- → **不得假設 `best.pt` 內含原始訓練影像或完整 `data.yaml`**（實測確認：本機所有 `.pt` 都不含）

### H. 教師圖片驗證 — **PARTIAL**

- UI 完整：`teacher_vision_verify.html` + `teacher_vision_model_verify`（`views.py:1683–1713`）
- `gate_state` 三態：`BLOCKED` / `WAITING_FOR_MODEL` / `READY`
- 缺口：依 2.3，`runner_state()["available"]` 硬編碼 `False` → 永遠 `BLOCKED`；`verify_run` 永遠拒絕
- 依指令「不得以 mock 畫面、假資料或單純 HTTP 200 代替真實推論測試」→ 本項必須真正打通

### I. 單一教師入口頁 — **MISSING**

現況為 3 張卡片 + 8 個分散頁面，且直接暴露 SHA256、Model ID、ACTIVE 等工程術語。無「區域一～區域四」的垂直卡片式整合頁。

---

## 四、本次開發必須補的最小缺口（依指令對應）

| 指令要求 | 對應缺口 | 最小實作方向 |
|---|---|---|
| 單一入口「AI 視覺模型中心」 | I | 新增 1 個整合頁 + 1 條路由，重用既有 8 個頁面的資料，不刪舊頁 |
| 區域一 學員模型共享區 | 已有 submission 能力，缺教師視角清單 | 在整合頁列出 submission，重用 `list_submissions` |
| 區域二 教師圖片驗證區 | H + C（缺指定模型推論端點） | **新增** Live Backend 端點：對指定 `model_id` 跑真實推論；Django 經 HTTP 呼叫 |
| 區域三 正式模型管理 | E（Django 無 activate）+ F（無回復） | 新增 activate / rollback view，代理至 Starlette；**切換後驗證推論確實使用新模型** |
| 區域四 下一屆資源庫 | G（`data.yaml` 未保存、影像為空） | 保存 `data.yaml` 與類別映射；缺失資料**明確標記**而非偽造 |
| 兩任務獨立 | B2 + 2.8 | 放寬 Django `SUPPORTED_TASK_IDS`，兩套狀態完全分離 |
| 不得以假資料代替真實推論 | 2.9 / 2.10 / 2.11 | 驗收須誠實區分「真實推論可驗證」與「缺少合法模型／Golden Set 樣本而無法驗證」 |

---

## 五、安全邊界（本輪遵守）

- **未觸碰**：v1.5C 穩定分支與 worktree、Stable Tag、正式 GitHub Pages、正式 Cloudflare Worker / Tunnel、正式入口網址、正式資料庫、8022 / 8030 / 8765 / 8770
- **未執行**：commit / push / merge / deploy
- **未安裝或升級**：任何 pip / npm 套件、Python / Node 版本、Browser-Driver、防火牆設定
- **開發前備份已建立**：`demo/backup/P0-vision-center-checkpoint-20261010/`
  - `GIT_HEAD.txt`（記錄 `e5c044244475d18930f32e26696d2cf9cf43dfa6`）
  - `demo.sqlite3.bak`（565,248 bytes）
  - `vision-center/vision_center.json`
  - `vision_center.py.bak` / `vision_api.py.bak` / `vision_verification.py.bak` / `urls.py.bak` / `views.py.bak` / `models.py.bak`
- **未使用 DEMO 模型冒充正式模型**：DEMO 現有 `.pt` 已確認全為 `FDE-AI-UAS-DEMO-TEST-ONLY-best.pt` 佔位檔
- **未啟用任何未驗證模型**：`models` 陣列為空，無 ACTIVE

---

## 六、已知限制（必須在最終交付中如實列出）

1. **本機沒有以 `CW_F/CCW_F/CW_B/CCW_B` 或 `FRONT/RIGHT/BACK/LEFT` 訓練的合法 `best.pt`。** 因此無法完成「真實準確度」層級的驗收；只能完成「格式／簽章／類別契約／安全阻擋／真實載入與冒煙推論」層級的驗收。
2. **Golden Set 為 0 張圖。** Golden Test 的 8 項指標無法真實計算，任何 PASS 都會是偽造。
3. **DEMO 與正式共用同一份程式碼但不同 DB 與不同 vision-center JSON**，後續修改需確保兩邊 path 各自獨立（`FDE_VISION_CENTER_ROOT` 已能隔離）。
4. **`:8765` 外部 YOLO 服務未啟動**，若後續設計依賴它需先確認。
5. **`demo/tools/seed_demo.py:70` 仍硬編碼舊密碼 `[已移除：舊 DEMO 種子密碼明文]`**，未來若重新 seed DEMO 會覆蓋臨時／共用密碼（未修改，未獲授權）。
6. **Git 工作區未提交**：目前有 30 個已修改檔案與大量未追蹤檔案。依 `AGENTS.md` §15，未經明確允許不得 commit。本次「Git checkpoint」以**檔案備份 + HEAD SHA 記錄**實現，非 commit。

---

## 七、稽核方法與可重現性

- 檔案讀取：`live_backend/app/vision_center.py`（全 660 行）、`live_backend/app/vision_api.py`（全 295 行）、`live_backend/app/main.py` 關鍵段、`student_portal/learning/vision_verification.py`（全文）、`student_portal/learning/urls.py`（全文）、`student_portal/learning/views.py` 關鍵段、`student_portal/learning/models.py` 關鍵段、`student_portal/learning/golden_set.py` 關鍵段、`teacher_dashboard.html`、`validation_sets/prop/manifest.json`、`demo/runtime/vision-center/vision_center.json`
- 環境探測：Django venv 與 Live Backend Python 的 `ultralytics`/`torch`/`cv2`/`numpy` import 測試
- 檔案簽章：`.pt` 檔案前 32 bytes `od -c` 比對 `_MODEL_SIGNATURES`
- 連接埠：`netstat -ano | grep LISTENING`
- 全部為**唯讀操作**，未寫入任何業務資料

---

## 八、判定總結

| 面向 | 現況 |
|---|---|
| 底層視覺能力（Starlette） | **大致完備**：真實推論、嚴格驗證、ACTIVE 切換、匯出皆已實作 |
| 教師可用介面（Django） | **明顯落後**：無整合入口、無啟用動作、無回復、驗證被硬編碼阻擋 |
| 兩者之間的橋樑 | **不存在** |
| 版本歷史與回復 | **完全缺失** |
| 下一屆資源庫 | **骨架存在但資料為空** |

**核心診斷**：本專案並不需要「重寫一套視覺系統」。真實推論能力已經存在且品質良好（嚴格驗證、契約檢查、冒煙推論、自動歸檔舊 ACTIVE）。缺的是**一座橋**：把教師在 Django 網頁上的操作，安全地代理到既有 Starlette 能力，並補上版本歷史與回復。這正是最小、穩定、可實際使用的取徑，符合 AGENTS.md 的 Reuse / Minimal Change / Vertical Slice 原則。

---

*本報告為唯讀稽核產物。後續開發依指令「完成稽核後繼續開發，不需要等待人工逐項批准；但不得跳過安全檢查」。*
