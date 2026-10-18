# 模型倉庫持久化｜Migration 設計文件

* **文件版本**：V1.0
* **建立日期**：2026-10-08
* **對應指令**：FDE-AI-UAS 2.0｜WorkBuddy 下一輪｜教師後台驗收與模型倉庫持久化
* **狀態**：**設計完成，尚未套用**（`showmigrations` 顯示 `[ ] 0016_visionmodelrecord`）
* **任務類型範圍**：`PROP_DIRECTION_V1`（`FOUR_SIDE_HOVER_V1` 未開放）

---

## 1. 設計目標與約束

本設計對應指令「二、模型倉庫資料模型」的六項要求：

| # | 要求 | 本設計對應 |
|---|---|---|
| 1 | 不複製既有 R07 提交紀錄 | `VisionModelRecord.evidence` 為 `OneToOneField(PROTECT)`，為「入庫登錄」而非第二套提交系統 |
| 2 | 不把 Candidate / VALIDATED / TRAINING_BASE / ACTIVE 混成單一狀態 | 拆為 `review_status`、`validation_status`、`training_usage`、`deployment_status` **四個獨立欄位** |
| 3 | 模型血緣必須可追溯 | `parent_record` 自我參照 + `lineage_root` 指向起源版本，並以 CheckConstraint 保證一致性 |
| 4 | 學生私人模型不得跨班級洩漏 | `cohort` 為必填 `PROTECT` 外鍵；`records_for_teacher()` 一律以 `TeacherCohortAccess` 過濾 |
| 5 | DEMO_TEST_ONLY 不得發布為正式訓練基礎 | `is_demo_test_only` 旗標 + 兩條 CheckConstraint + 服務層防護函式 |
| 6 | 已入庫模型必須保留檔案完整性與來源資訊 | `artifact_sha256` 必填、`artifact_size_bytes`、`artifact_reference`、`data_yaml_reference` |

---

## 2. 為什麼需要新資料表（而非沿用 JSONField）

上一輪（33.x）把四個狀態維度暫存在 `Evidence.processed_metadata`（JSONField）。此做法可零 migration，
但**無法滿足本輪要求**：

| 問題 | JSONField 現狀 | 新資料表的改善 |
|---|---|---|
| 血緣查詢 | 無法 join、無法遞迴 | `parent_record` FK 可 join、可遞迴 |
| 班級隔離 | 需先查出 Evidence 再過濾 | `cohort` 直接過濾，可用 `select_related` |
| 完整性校驗 | JSON 內欄位無型別保證 | `artifact_sha256` 為 `CharField(64)` 必填 |
| 唯一性 | 無資料庫層保護 | `OneToOneField` 保證一證據一紀錄 |
| 狀態一致性 | 無約束 | 4 條 CheckConstraint 於資料庫層生效 |

**重要**：新表**不取代** `processed_metadata`。既有 `vision_model_review` 審核流程完全不動，
新表只作為「入庫登錄」。這是避免第二套提交系統的關鍵設計。

---

## 3. 資料表結構

### 3.1 表名

`learning_visionmodelrecord`

### 3.2 欄位定義

```python
class VisionModelRecord(models.Model):
    model_id            = UUIDField(primary_key=True, default=uuid.uuid4)      # Model ID
    evidence            = OneToOneField(Evidence, PROTECT)                     # → 既有 R07 提交
    task_id             = CharField(max_length=32)                             # Task ID
    student             = ForeignKey(StudentProfile, PROTECT)
    cohort              = ForeignKey(Cohort, PROTECT)                          # 班級隔離依據
    model_version       = CharField(max_length=16, default="V1")
    parent_record       = ForeignKey("self", null=True, PROTECT)               # Parent Model
    lineage_root        = ForeignKey("self", null=True, PROTECT)               # 血緣起源
    dataset_version     = CharField(max_length=64, blank=True)
    class_mapping       = JSONField(default=list)                              # 學員類別 → 平台類別
    artifact_reference  = CharField(max_length=255)                            # best.pt 參照
    artifact_sha256     = CharField(max_length=64)                             # best.pt SHA256（必填）
    artifact_size_bytes = PositiveBigIntegerField(default=0)
    data_yaml_reference = CharField(max_length=255, blank=True)                # 可為空
    is_demo_test_only   = BooleanField(default=False)                          # DEMO 標記
    review_status       = CharField(16, default="SUBMITTED")                   # 維度 1
    validation_status   = CharField(16, default="NOT_EVALUATED")               # 維度 2
    training_usage      = CharField(20, default="NOT_FOR_TRAINING")            # 維度 3
    deployment_status   = CharField(16, default="CATALOGUED")                  # 維度 4
    teacher_review      = JSONField(default=dict)                              # Teacher Review 摘要
    validation_history  = JSONField(default=list)                              # Validation History
    golden_test_summary = JSONField(default=dict)                              # Golden Test Summary
    publication_scope   = JSONField(default=list)                              # Publication Scope
    created_at          = DateTimeField(auto_now_add=True)
    updated_at          = DateTimeField(auto_now=True)
```

### 3.3 四個狀態維度（各自獨立，不合併）

| 維度 | 欄位 | 可選值 | 預設 |
|---|---|---|---|
| 審核 | `review_status` | `SUBMITTED` / `CANDIDATE` / `REJECTED` / `RETURNED` | `SUBMITTED` |
| 驗證 | `validation_status` | `NOT_EVALUATED` / `VALIDATED` / `FAILED` | `NOT_EVALUATED` |
| 訓練用途 | `training_usage` | `NOT_FOR_TRAINING` / `TRAINING_BASE` | `NOT_FOR_TRAINING` |
| 部署 | `deployment_status` | `CATALOGUED` / `ACTIVE` / `ARCHIVED` | `CATALOGUED` |

### 3.4 資料庫層約束（4 條）

| 約束名 | 條件 | 防護目的 |
|---|---|---|
| `vision_record_v1_has_no_parent` | `model_version != 'V1'` OR `parent_record IS NULL` | V1 不得有父版本 |
| `vision_record_demo_never_training_base` | `is_demo_test_only = false` OR `training_usage != 'TRAINING_BASE'` | DEMO 不得成訓練基底 |
| `vision_record_active_requires_validated` | `deployment_status != 'ACTIVE'` OR `validation_status = 'VALIDATED'` | 未驗證不得 ACTIVE |
| `vision_record_active_not_demo` | `deployment_status != 'ACTIVE'` OR `is_demo_test_only = false` | DEMO 不得 ACTIVE |

> **設計修正紀錄**：`vision_record_active_not_demo` 初版誤寫為三段 OR
> （`NOT ACTIVE OR NOT_FOR_TRAINING OR NOT DEMO`），因 `training_usage` 預設即 `NOT_FOR_TRAINING`，
> 導致約束恆真而失效。已由 `test_active_not_demo_is_rejected_by_database` 測出並修正為兩段式。

### 3.5 索引與刪除行為

* `evidence`：`OneToOneField` 隱含唯一索引
* `cohort`：`PROTECT`（班級不得在仍有模型時刪除）
* `student`：`PROTECT`（學員資料不得因模型入庫而被連帶刪除）
* `parent_record` / `lineage_root`：`PROTECT`（血緣鏈不得被破壞）
* `ordering = ["-created_at"]`

**刪除策略說明**：全面採用 `PROTECT` 而非 `CASCADE`，是為了保證「已入庫模型必須保留來源資訊」。
若需清理，必須先由教師顯式封存（`ARCHIVED`）或人工處理，不得靜默連帶刪除。

---

## 4. 服務層設計

檔案：`student_portal/learning/vision_repository.py`

| 函式 | 職責 |
|---|---|
| `compute_sha256(content)` | 計算 best.pt 完整性雜湊 |
| `is_demo_test_only(filename)` | 判斷檔名是否標記 DEMO |
| `build_class_mapping(task_id, mapping)` | 建立類別對應表；未提供時留空，**不猜測** |
| `register_model_record(...)` | 入庫登錄（`@transaction.atomic`），含 6 項前置驗證 |
| `lineage_of(record)` | 由起源到自身回傳完整血緣鏈 |
| `records_for_teacher(teacher)` | 依 `TeacherCohortAccess` 過濾可見紀錄 |
| `mark_demo_never_training_base(record)` | DEMO 防護：狀態不一致時強制回正 |

### 4.1 `register_model_record` 前置驗證

1. `task_id` 必須在 `SUPPORTED_TASK_IDS`（本輪僅 `PROP_DIRECTION`）
2. `artifact_sha256` 必填
3. `artifact_reference` 必填
4. 同一 `evidence` 不得重複入庫
5. `V1` 不得帶父版本；非 `V1` 必須帶父版本
6. 父版本與子版本必須同班級

### 4.2 入庫一律採保守預設

新紀錄建立時**不得**自動進階任何狀態：

```
review_status       = SUBMITTED        （尚待教師審核）
validation_status   = NOT_EVALUATED    （尚未跑 Golden Test）
training_usage      = NOT_FOR_TRAINING （尚不可作訓練基底）
deployment_status   = CATALOGUED       （僅入庫，未啟用）
golden_test_summary = {}               （不得虛構結果）
```

---

## 5. Migration 檔案

* **檔案**：`student_portal/learning/migrations/0016_visionmodelrecord.py`
* **依賴**：`0015_studentsurvey_survey_version_and_more`
* **操作**：`CreateModel` × 1（含 4 條 CheckConstraint）
* **是否套用**：**未套用**（`showmigrations` 顯示 `[ ]`）
* **是否影響既有表**：**否**，純新增表，無 ALTER 既有表

---

## 6. 測試資料庫 / Media 路徑與操作計畫（等待批准）

本輪測試**全部使用 Django 自動建立的隔離測試資料庫**（`test_<dbname>`，記憶體或暫存檔），
測試結束即銷毀，**未觸碰正式 DB**。

### 6.1 使用中的路徑

| 項目 | 路徑 | 說明 |
|---|---|---|
| 測試 DB | Django 自動建立之 `test_db.sqlite3` / `:memory:` | 測試結束自動銷毀 |
| 測試 Media | `D:/FDE-AI-UAS-v2.0/.test-temp/student-portal-8023-media` | 由 `DJANGO_MEDIA_ROOT` 指定，與正式 `private_media` 完全分離 |
| Django venv | `D:/FDE-AI-UAS-v2.0/.test-temp/django-venv/Scripts/python.exe` | Python 3.12.13 / Django 5.2.17 |
| 工作目錄 | `D:/FDE-AI-UAS-v2.0/student_portal` | — |

### 6.2 已驗證的隔離證據

```
$ stat -c '%y' student_portal/db.sqlite3
2026-10-07 19:08:32    ← 早於本輪（本輪為 2026-10-08 18:2x）

$ find . -name "*.sqlite3" -newermt "2026-10-08 17:30"
（空）                  ← 本輪無任何 DB 檔案被修改

$ manage.py showmigrations learning | tail -1
[ ] 0016_visionmodelrecord   ← 未套用
```

### 6.3 若需在「真實但隔離的」DB 上套用（**尚未執行，等待批准**）

如需在正式套用前先於真實檔案資料庫驗證，建議計畫如下：

| 步驟 | 操作 | 路徑 |
|---|---|---|
| 1 | 複製正式 DB 為離線副本 | `db.sqlite3` → `.test-temp/repo-dryrun/db.sqlite3` |
| 2 | 指定隔離 DB 與 Media | `DJANGO_DB_NAME=.test-temp/repo-dryrun/db.sqlite3`、`DJANGO_MEDIA_ROOT=.test-temp/repo-dryrun/media` |
| 3 | 套用 migration | `manage.py migrate learning` |
| 4 | 驗證 | `manage.py showmigrations learning` 應顯示 `[X] 0016` |
| 5 | 回滾驗證 | `manage.py migrate learning 0015` 確認可逆 |
| 6 | 清理 | 刪除 `.test-temp/repo-dryrun/` 整個目錄 |

**風險**：步驟 3 若誤用正式 DB 路徑，將對正式資料庫執行 schema 變更。
**防護**：步驟 2 必須先確認 `DJANGO_DB_NAME` 環境變數已生效，且路徑位於 `.test-temp/` 下。
**此計畫尚未執行，等待批准。**

---

## 7. 正式套用順序（建議）

```
1. 批准本設計文件
2. 執行 6.3 的離線副本試套用（可選，但建議）
3. 備份正式 DB 與 private_media
4. 於維護窗口執行 manage.py migrate learning
5. 驗證 showmigrations 顯示 [X] 0016
6. 確認既有 R07 / Candidate / Return 流程仍正常
```

**本輪不執行上述任何步驟。**

---

## 8. 未涵蓋範圍（明確聲明）

* **不執行推論**：本表不含任何模型載入或推論路徑。
* **不執行 Golden Test**：`golden_test_summary` 僅為欄位，無執行器。
* **不啟用 ACTIVE**：本輪無任何 ACTIVE 操作入口。
* **不支援 `FOUR_SIDE_HOVER`**：`SUPPORTED_TASK_IDS` 僅含 `PROP_DIRECTION`。
* **不建立學生取得訓練資源的路徑**：`publication_scope` 僅為欄位，無發布邏輯。
* **不修改正式 Vision ACTIVE**：`live_backend` 未觸及。
