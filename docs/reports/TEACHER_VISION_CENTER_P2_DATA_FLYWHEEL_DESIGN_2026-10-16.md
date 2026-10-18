# 教師模型中心｜P2 Data Flywheel 真正閉環規劃（設計，本輪未實作）

- 日期：2026-10-16
- 範圍：**盤點 ＋ 設計 ＋ 無風險前端說明修正**。
- 本輪**未新增 migration、未改寫資料模型、未啟用任何新的資料寫入流程**。
- 對應教師指令：三、P2「**盤點既有儲存能力，設計持久化流程…區分 A 已實際保存／B 可用既有服務接通／C 需新增資料結構或修改受保護核心。本輪先完成設計及無風險的前端說明修正。未經教師核准，不得新增 migration、改寫資料模型或啟用新的資料寫入流程。不得再將 session 暫存統計描述為完整 Data Flywheel。**」
- 前置報告：`TEACHER_VISION_CENTER_SAFETY_AUDIT_2026-10-16.md`（風險 R3／R4／R5）

---

## 0. 名詞定義（避免混淆）

| 名詞 | 定義 | 位置 |
| --- | --- | --- |
| Live Store | Live Backend 的 JSON 儲存區 `vision_center.json` ＋ 子目錄 | `FDE_VISION_CENTER_ROOT`（`main.py:107`） |
| Django ORM | Django 關聯式資料庫（`learning_*` 資料表） | `student_portal/learning/models.py` |
| Session 暫存 | 教師單張圖片驗證歷史，存在 `request.session`，上限 20 筆 | `views.py:2864-2872` |
| 錯誤案例（hard example） | Live Store `hard_examples[]`，由**學員端**推論未通過時自動產生 | `vision_api.py:112,133` |

---

## 1. A 類｜**已實際保存**（現況即為持久化，跨 session 存活）

### A1. 模型版本登錄（Live Store `models[]`）

| 欄位 | 內容 | 是否保存 |
| --- | --- | --- |
| `model_id` / `model_type` / `model_name` / `version` | 模型識別 | ✅ |
| `file_path` / `file_hash` / `file_size` | 檔案與完整性 | ✅ |
| `class_names` | 類別契約 | ✅ |
| `dataset_id` / `dataset_version` / `rule_version` | 資料與規則版本 | ✅ |
| `source_submission_id` / `source_student_id` / `source_group` | 來源（學員提交或教師上傳） | ✅ |
| `uploaded_by` / `uploaded_at` | 上傳者與時間 | ✅ |
| `validation_status` / `evaluation_status` / `metrics` / `status` | 結構驗證與評估 | ✅ |

> 定義：`vision_center.py:375-383`；`_write_manifest()` 另在模型目錄寫 `manifest.json`。

### A2. 學員提交（Live Store `submissions[]`）

`submission_id`、`task_id`、`student_id`、`group_id`、`original_filename`、`file_path`、`file_hash`、`file_size`、`uploaded_at`、`status`、`imported_model_id`、`notes`、`growth_record_id`、`growth_record_slot`、`evidence_reference`、`evidence_type`。（`vision_center.py:498-506`）

### A3. Django 模型倉庫（`VisionModelRecord`）

- 四個獨立狀態維度：`review_status`／`validation_status`／`training_usage`／`deployment_status`。
- 血緣：`parent_record` ＋ `lineage_root`；班級隔離：`cohort` 必填。
- 完整性：`artifact_sha256`／`snapshot_sha256`／`integrity_status`／`integrity_detail`。
- 教師複核：`teacher_review`（JSON）／`validation_history`／`golden_test_summary`。
- 6 條 DB CheckConstraint 強制：ACTIVE 必須 VALIDATED、ACTIVE 不得為 DEMO、DEMO 不得為訓練基底、完整性異常不得為訓練基底、快照欄位齊備。（`models.py:833-871`）

### A4. 黃金測試集（`GoldenSet` ＋ `GoldenSetSample`）

- `GoldenSet`：`golden_set_id`、`task_id`、`version`、`status`（DRAFT／FROZEN）、`created_by`、`cohort`。
- `GoldenSetSample`：`image`（FileField，存於 Media）、`label`（四類之一）、`annotation_source`、`confirmation_status`、`confirmed_by`、`content_sha256`。
- **這是既有、且已可保存「教師標註的真實圖片」的結構**（`models.py:1098-1147`）。

### A5. 評估與資料集（Live Store）

- `evaluations[]`：golden set 指標（precision/recall/mAP/per_class/confusion matrix）。
- `datasets[]`：`dataset_id`、`dataset_version`、`parent_dataset_id`、`storage_path`、`hard_example_ids`、`total_images`、`train/val/test_count`、`class_distribution`、`source_groups`、`auto_train_enabled`（固定 `False`）。
- `camera_profiles[]`、`golden_sets[]`。

### A6. 錯誤案例（Live Store `hard_examples[]`）

`sample_id`、`model_type`、`model_version`、`source`、`input_reference`、`prediction`、`confidence`、`teacher_label`、`review_status`、`created_at`、`reviewed_by`、`reviewed_at`、`notes`、`retention_status`。（`vision_center.py:751-760`）

> **限制（R4）**：只存 `input_reference`（參照字串），**不存圖片本體**；無 `expected_class`；且**唯一產生路徑是學員端推論**（`prop_check` 非 PASS、hover 分析困難）——**教師在步驟②的單張圖片驗證目前不會產生任何錯誤案例**。

---

## 2. B 類｜**可用既有服務接通**（Live Backend 端點已存在，缺 Django 端 client 與 UI）

Live Backend 已實作以下端點，**Django 端 `vision_submission.py` 尚無對應 client 函式**（目前缺 4 個：`build_next_dataset`／`export_dataset`／`create_hard_example`／`review_hard_example`）：

| 能力 | Live 端（已存在） | 路由 | Django client |
| --- | --- | --- | --- |
| 建立錯誤案例 | `create_hard_example()` `vision_center.py:751` | `POST /api/v1/vision/hard-examples`※ | ❌ 缺 |
| 列出／複核錯誤案例 | `list_hard_examples()` / `review_hard_example()` `:762,765` | `GET /api/v1/vision/hard-examples`、`POST .../{id}/review` | ❌ 缺 |
| 產生下一輪資料集 | `build_next_dataset()` `:717` | `POST /api/v1/vision/datasets/{id}/build-next` | ❌ 缺 |
| 匯出訓練包 | `export_dataset()` `:739` | `GET /api/v1/vision/datasets/{id}/export` | ❌ 缺 |

> ※ 現有 `create_hard_example` 由 Live 內部（`prop_check`／`hover_analyze`）直接呼叫，未暴露為獨立 POST 路由；若要走 HTTP，需另加路由（屬 C 類微調）。

**B 類可接通的使用者價值**（不需新 schema）：
1. 教師在步驟②的 NG／CHECK 驗證 → 可寫成錯誤案例（需先解決「無圖片本體」問題，見 C2）。
2. 教師複核錯誤案例（CONFIRMED／CORRECTED）→ 已有 `review_hard_example`。
3. 教師以既有資料集 ＋ 已複核錯誤案例 → 一鍵產生下一輪資料集（`build_next_dataset` 已強制要求 `review_status ∈ {CONFIRMED, CORRECTED}`）。
4. 教師匯出訓練包 zip（`export_dataset` 已產生 `data.yaml`／`split_manifest.json`／`dataset_metadata.json`）。

---

## 3. C 類｜**需新增資料結構或修改受保護核心**（**需教師逐項授權**）

| 代號 | 需求 | 影響 | 風險 |
| --- | --- | --- | --- |
| C1 | 教師單張圖片驗證紀錄**持久化**（現只在 session 20 筆） | 需新 store collection 或 Django 模型 ＋ migration | **高**（涉 migration） |
| C2 | `hard_examples` 增加 `image_path`／`expected_class`／`prediction_confidence` 完整性欄位，並保存必要圖片 | 修改 Live 受保護核心 ＋ 圖片保存政策 | **高** |
| C3 | 教師驗證路徑接入 `create_hard_example`（新增獨立 HTTP 路由 ＋ Django client） | 修改 Live 路由 ＋ Django 服務層 | 中 |
| C4 | 「下一輪資料集」UI（選資料集 → 勾選已複核錯誤案例 → build → export） | 新增 Django view／template ＋ client | 中 |
| C5 | 資料保留政策（`retention_status` 目前僅標記字串，未實際執行清理） | 需排程與清理邏輯 | 中 |
| C6 | 四類槳葉方向「啟用證據」持久化（與 P1-B 的 L3 閘門相依） | 同 C1 | **高** |

---

## 4. 建議的持久化流程（目標狀態，未實作）

```
學員端推論未通過 ──┐
                  ├─► hard_examples[]（Live Store，已存在）
教師②單張驗證 NG/CHECK ──┘        │（C2：補圖片與 expected_class）
                                   ▼
                        教師複核（CONFIRMED/CORRECTED）  ← review_hard_example（已存在）
                                   ▼
                     build_next_dataset()（已存在，強制要求已複核）
                                   ▼
                        datasets[]（新版本，parent 指向舊版）
                                   ▼
                        export_dataset() → 訓練包 zip（已存在）
                                   ▼
                          下一輪訓練 → 上傳新模型 → 回到 A1
```

**待補缺口（依 C 類排序）**：
1. C1／C6：教師驗證證據持久化（同時解決 P1-B 的 L3 閘門前置條件）。
2. C2：錯誤案例補齊「圖片 ＋ 教師標註 ＋ 預測值」。
3. C3／C4：Django 端接通與 UI。
4. C5：資料保留政策。

---

## 5. 本輪已完成（無風險前端說明修正）

已於 `teacher_vision_center.html` 修正以下**不實敘述**，不再把 session 暫存統計描述為完整 Data Flywheel：

| 位置 | 修正前（不實） | 修正後（如實） |
| --- | --- | --- |
| ④ 區塊標題／說明 | 暗示為完整資料飛輪 | 「本區彙整可留給下一輪教學的資料狀態」＋ 明示「統計來自**本次登入的工作階段紀錄（最多 20 筆）**，**不是完整的資料飛輪**；圖片本體與下一輪訓練資料集目前**尚未持久化**」 |
| 統計標籤 | 「新增樣本」 | 「本輪新增樣本（本次登入期間）」 |
| 錯誤案例空狀態 | 未說明來源 | 明示「**教師②的單張圖片驗證目前不會自動產生錯誤案例**」 |
| 驗證紀錄說明 | 未說明壽命 | 「保存在本次登入的工作階段（session），最多 20 筆；重新登入、逾時或換裝置會清空，且不會寫入資料庫」 |
| 進階管理「資料飛輪存放位置」 | 含糊 | 「模型版本與**學員端**錯誤案例保存在 Live Backend 的 JSON 儲存區；教師②的驗證紀錄目前**只存在 session**，尚未持久化」 |

> 上述修正**只動模板文字**，未改任何後端行為、未新增寫入。

---

## 6. 明確聲明

- 本輪**未**新增任何 migration。
- 本輪**未**修改任何資料模型。
- 本輪**未**啟用任何新的資料寫入流程。
- 教師②的驗證紀錄**仍然只在 session**；錯誤案例**仍然只由學員端產生**。
- 是否實作 C1–C6，**待教師逐項授權**。
