# 教師端「AI 視覺模型中心」簡化 — 現況盤點與最小修改方案（2026-10-16）

> **本文件為規劃文件，尚未動任何程式碼。** 依教師指示「先盤點現況 → 再規劃最小修改方案，
> 不要一次性重構」產出。所有盤點皆為**唯讀**。
> 分支 `fde-ai-v2.0-dev`；未 commit、未部署、未動正式 DB。

---

## 一、現況盤點（唯讀）

### 1.1 入口與路由

入口單頁：`student_portal/learning/urls.py:104` → `teacher/vision-center/`（name `teacher_vision_center`）
→ `student_portal/learning/views.py:2905` `teacher_vision_center()`
→ 模板 `student_portal/learning/templates/learning/teacher_vision_center.html`（560 行）。

相關子路由（全部保留、本輪不刪）：

| urls.py 行 | path | name | views.py 行 |
|---|---|---|---|
| 105 | `.../validate/` | `teacher_vision_center_validate` | 3101 |
| 110 | `.../import/` | `teacher_vision_center_import` | 3188 |
| 115 | `.../activate/` | `teacher_vision_center_activate` | 3261 |
| 120 | `.../rollback/` | `teacher_vision_center_rollback` | 3296 |
| 125 | `.../upload/` | `teacher_vision_center_upload` | 3319 |
| 130 | `teacher/vision-models/` | `teacher_vision_model_list` | 1845 |
| 136 | `teacher/vision-flywheel/` | `teacher_vision_flywheel` | 2104 |
| 147-170 | `teacher/golden-sets/*` | Golden Test Center（6 條） | 2529-2674 |

### 1.2 目前頁面結構（`teacher_vision_center.html`，560 行）

**頁首區（目標四區塊之外，屬「模型工程後台」氣味）**

| 行號 | 元素 | 說明 |
|---|---|---|
| 79-99 | `<section class="page-heading">` / `<h1>AI 視覺模型中心</h1>` | 標題 |
| 100-113 | `div.vc-status` | 狀態列：推論服務狀態 / 正式模型 |
| 114-121 | `div.vc-taskbar` | **任務類型切換**（PROP_DIRECTION / FOUR_SIDE_HOVER 等） |

**四個步驟區塊（`section.vc-step-block`）**

| 步驟 | 行號 | `<h2>` 標題 | 內部 `<h3>` / 子塊 |
|---|---|---|---|
| ① | 122-193 | **查看學員模型** | 149 `<details>進階資訊` |
| ② | 194-318 | **教師圖片驗證** | 256 驗證結果；278 `<details>進階資訊`；294 `<details>最近的驗證紀錄` |
| ③ | 319-450 | **教師複核與啟用** | 336 **目前正式模型**；347 可設為正式模型的版本；392 **上傳您自己的模型**；416 `<details>版本歷史` |
| ④ | 451-560 | **保存下一期教學資源** | 479 模型版本清單；501 **錯誤案例（待教師確認）**；528 `<details>進階資訊 · 系統運作方式（供技術人員參考）` |

> 觀察：頁面**已具備**「四步驟垂直排列 ＋ `<details>` 進階資訊收合」的雛形
> （前一輪已做過一次簡化）。但**步驟語意與教師要的四區塊並非一對一**，且頁首兩塊
> （狀態列／任務切換）與步驟③的「上傳您自己的模型」仍偏工程後台。

### 1.3 資料模型（可複用，無需新增）

`student_portal/learning/models.py:683-918` `VisionModelRecord`（Model Registry 主表）已具備四維度：

| 欄位 | 行號 | 值域 |
|---|---|---|
| `review_status` | 802 | SUBMITTED / CANDIDATE / REJECTED / RETURNED |
| `validation_status` | 805 | NOT_EVALUATED / VALIDATED / FAILED |
| `deployment_status` | 811 | CATALOGUED / **ACTIVE** / ARCHIVED |
| `task_id` | 739 | 本輪僅 `PROP_DIRECTION` |
| `training_usage` | 808 | NOT_FOR_TRAINING / TRAINING_BASE |
| `artifact_sha256` / `snapshot_*` | 770-797 | 指紋與不可變快照 |

約束：4 條 CheckConstraint（835-871）強制 ACTIVE 必須 VALIDATED 且非 DEMO；
`active_blocked_reason()`（907-918）為啟用安全閘。

→ **「①待複核／②驗證／③當前正式模型」三區塊皆可直接由本表驅動，不需新 model、不需 migration。**

### 1.4 服務層

| 檔案 | 角色 |
|---|---|
| `vision_submission.py` | Django ↔ Live Backend 唯一視覺 API 轉發層（Django 永不載入 `.pt`） |
| `vision_flywheel.py` | Data Flywheel **契約層**（`build_flywheel_view()`:43、`review_status_of`:74、`validation_status_of`:81、`active_switch_blocked_reason`:99）；**不建資料表** |
| `vision_repository.py` | 入庫：`register_model_record`:63、`check_intake_eligibility`:241、`catalogue_model`:310 |
| `vision_snapshot.py` / `vision_integrity.py` | 不可變快照／檔案完整性 |
| `vision_verification.py` | 隔離執行環境探測：`runner_state()`:45、`verification_blocked_reason`:76 |
| `golden_set.py` / `golden_set_guard.py` | Golden Set 業務與唯讀防護 |

### 1.5 Data Flywheel 現況（重要落差）

- **Django 端**：只有契約層 `vision_flywheel.py`，**無資料表**；
  「誤判」僅以驗證歷程 `verdict == MISMATCH` 統計（`views.py:3045-3049`），**無專屬模型**。
- **Live Backend 端**：**有實作**，但存 JSON 檔（`store.data["hard_examples"]`）：
  `live_backend/app/vision_center.py:751` `create_hard_example`、`:762` `list_hard_examples`、
  `:765` `review_hard_example`、`:717` `build_next_dataset`；
  路由 `live_backend/app/vision_api.py:365` `GET /api/v1/vision/hard-examples`、
  `:366` `.../{sample_id}/review`。非 PASS 時由規則引擎自動產生。
- 頁面既有「錯誤案例（待教師確認）」（模板 501 行）已接此資料。

### 1.6 真實推理鏈（`:8765` 目前未啟動）

```
Django view
  → vision_submission._post()   (settings.VISION_SUBMISSION_API_BASE_URL, settings.py:223-225)
  → Live Backend  live_backend/app/vision_api.py
      validate_image:291 / prop_check:89 / activate:69 / rollback:338
      import_submission:230 / hard_examples:173
  → live_backend/app/vision_center.py  (ultralytics YOLO)
      ModelRunner 69-95（YOLO 載入 82、predict 88）
      真實 predict 129-139（YOLO 134、model.predict 139）
      upload_model 359-415（寫入 best.pt 371）
```

- **模擬推論開關**：Live `FDE_DEMO_SIMULATED_INFERENCE=1`（`main.py:110`；閘門 `vision_center.py:180,186,519,540`；
  `simulate_prop_check()`:560；`vision_api.py:98` 分流）。
- Django 端對應 `DJANGO_VISION_DEMO_SIMULATION_ENABLED`（`settings.py:229-231`），
  由 `views.py:3091` 傳入模板 `demo_simulation_enabled`。
- `:8765` 正式 YOLO 服務**未啟動**；DEMO 走模擬推論（刻意示範，非缺陷）。

### 1.7 學員上傳 `best.pt` 鏈路

```
growth_record_detail.html:45-55 (form, input name=model_file)
  → urls.py:34  student/courses/<enrollment_id>/growth/R07/model/  (growth_model_upload)
  → views.py:1189-1269
      建立 Evidence(evidence_type=MODEL, task_type=PROP_DIRECTION)  1224-1236
      vision_submission.submit_model_evidence_to_vision()           1240-1251
  → Live  POST /api/v1/vision/submissions  →  vision_center.py:502  status = "SUBMITTED"
  → 回寫 processed_metadata.vision_submission_id / submission_status 1252-1257
```

→ 學員上傳後狀態為 **SUBMITTED（＝教師收件匣的「待複核」）**，**不會自動成為正式模型**。

### 1.8 既有測試（本輪必須維持全綠）

Django：`test_teacher_vision_center_page.py`、`test_teacher_vision_acceptance.py`、
`test_vision_model_center.py`、`test_vision_flywheel_framework.py`、`test_vision_repository.py`、
`test_vision_snapshot.py`、`test_vision_snapshot_security.py`、`test_teacher_catalogue.py`、
`test_golden_set_center.py`、`test_golden_set_contract.py`、`test_golden_set_immutability.py`。
工具：`demo/tools/verify_teacher_vision_center.py`、`verify_r07_flow.py`、
`verify_prop_scan_acceptance.py`、`capture_teacher_vision_workflow.py`、`verify_p5_protected_pages.py`。
Live：`live_backend/tests/test_teacher_vision_center.py`、`test_vision_api.py`、`test_vision_center.py`。

---

## 二、目標四區塊 ↔ 現況落差分析

| 教師目標四區塊 | 現況對應 | 落差 |
|---|---|---|
| ①**待复核模型** | 步驟①「查看學員模型」（122-193） | 名稱不符；內容混入「導入／進階資訊」；未以「待複核」為主軸排序 |
| ②**教师验证** | 步驟②「教師圖片驗證」（194-318） | 語意相符，**最接近目標**；僅需標題與說明微調 |
| ③**当前正式模型** | 步驟③「教師複核與啟用」（319-450） | 一個區塊塞了三件事：目前正式模型（336）＋ 可設為正式模型的版本（347）＋ **上傳您自己的模型（392，教師自建，非教學複核流程）**；「版本歷史」收在 details |
| ④**Data Flywheel（数据飞轮）** | 步驟④「保存下一期教學資源」（451-560） | 名稱與飛輪語意不同；「模型版本清單」（479）其實屬③；只有「錯誤案例」（501）是飛輪 |
| —（四區塊之外） | 頁首 `vc-status`（100）＋ `vc-taskbar` 任務切換（114） | 屬模型工程後台語彙；任務切換對教師無意義（本輪僅 PROP_DIRECTION） |
| — | 步驟③「上傳您自己的模型」（392） | 教師自建模型上傳，偏工程；目標四區塊未包含 |

---

## 三、最小修改方案（分 4 個可獨立驗收的階段）

> 原則：**只改模板呈現與 view 傳入的 context；不動 model、不動 migration、不動路由、
> 不動服務層、不動 Live Backend、不動 Golden Set、不動 R07 提交鏈。**
> 每個階段結束都能單獨驗收、可隨時停止。

### Phase V1｜四區塊骨架對齊（最小、零風險）
- 檔：`teacher_vision_center.html`（＋必要時 `views.py:2905` 的 context 增補，**只增不減**）
- 動作：
  1. 四個 `<h2>` 改為教師指定名稱：**①待複核模型 ②教師驗證 ③當前正式模型 ④Data Flywheel（資料飛輪）**；
     各加一句白話「這個區塊要我做什麼」。
  2. 步驟③的「上傳您自己的模型」**整塊移入 `<details>進階資訊`**（不刪功能，只收合）。
  3. 步驟④的「模型版本清單」**移回步驟③**（屬「當前正式模型」的版本歷史）。
  4. 頁首 `vc-status` / `vc-taskbar` 收進頁首的 `<details>進階資訊`（預設收合）。
- 驗收：`test_teacher_vision_center_page.py`、`verify_teacher_vision_center.py` 全綠；
  頁面僅四個主要 `<h2>`；既有 5 條 POST 路由仍可送出。

### Phase V2｜真實端到端跑通（教師指定）
- 以隔離 DEMO（`:8110`/`:8111`，`demo.sqlite3` 或 `p42_verify.sqlite3`）實跑：
  1. 學員上傳 `best.pt`（R07）→ Live `submissions` 狀態 `SUBMITTED`
  2. 教師端①看到該筆「待複核」
  3. ②教師圖片驗證 → 產生 verdict 與 BBOX/Class/Confidence
  4. ③啟用為 ACTIVE → 檢查 CheckConstraint 與 `active_blocked_reason()`
  5. ④錯誤案例寫入 Live `hard_examples` 並可在頁面確認
- 驗收：Chrome CDP 逐步截圖 ＋ `verify_r07_flow.py` ＋ `verify_teacher_vision_center.py`；
  **全程標註 `FDE_DEMO_SIMULATED_INFERENCE=1`（模擬推論），不得寫成「真實 YOLO PASS」**。

### Phase V3｜用語與降噪
- 全頁術語統一：「正式模型」→「當前正式模型」；「複核」→「複核／待複核」一致；
  移除純技術字樣（例如「供技術人員參考」可保留在 details）。
- 手機 390×844 排版檢查（`base.html` 有全域 `table{white-space:nowrap}`，須在本頁 CSS 收斂）。

### Phase V4｜回歸與交付
- 1.8 節全部測試重跑；`verify_p5_protected_pages.py`（含 `/teacher/vision-flywheel/` 保護）重跑。
- 交付：修改前後截圖、測試結果、待人工驗收清單。

---

## 四、明確「不動」清單（本方案全程不碰）

- `models.py`、任何 migration、`VisionModelRecord` 的狀態機與 4 條 CheckConstraint
- `urls.py`（路由不增不減不改名）
- `vision_submission.py`、`vision_repository.py`、`vision_snapshot.py`、`vision_integrity.py`、
  `vision_verification.py`、`vision_flywheel.py`、`golden_set*.py`
- `live_backend/`（含 `vision_center.py`、`vision_api.py`、YOLO 載入與 `best.pt`）
- Golden Set 中心 6 條路由與其模板
- R07 學員提交鏈（`growth_model_upload`、`growth_record_detail.html`）
- 學員端五階段導航（本輪前已封版，停止新增）
- 正式 DB `:8022`、正式 RAG `:8770`、`:8765`、部署與 git 寫入

---

## 五、待教師確認事項（動工前）

1. **Phase V1 是否即刻執行？** 或先只出一份「頁面重排草圖」供教師看過再改？
2. **「上傳您自己的模型」（教師自建模型上傳）** 要保留在頁面上（收進進階）、
   還是移到獨立頁？（本方案預設：**收進進階資訊，不刪功能**）
3. **任務類型切換 `vc-taskbar`** 目前只有 `PROP_DIRECTION` 一種。
   本方案預設收進進階；若要保留在頁首請告知。
4. **Data Flywheel 是否要落地成 Django 資料模型？** 現況是 Live Backend JSON 檔
   ＋ Django 契約層。若要真正持久化並在 Django 端查詢，屬**新增功能**（需 model ＋ migration），
   不在「最小修改」範圍，須教師另行核准。
5. **是否允許以 DEMO 模擬推論完成 Phase V2 端到端？**
   （`:8765` 未啟動；真實 YOLO 推論屬既有待驗項目。）
