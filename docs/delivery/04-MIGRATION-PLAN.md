# FDE-AI-UAS 2.0 交付文件｜04 Migration 0016～0019 套用與回滾方案

**文件版本**：v1.0（交付驗收階段產出）
**產出日期**：2026-10-09
**依據**：【正式交付驗收指令】第七條第 5 項
**性質**：**方案文件，本輪未對正式 DB 執行任何 migration**

---

## 一、⚠️ 當前狀態（本輪最重要發現）

### 1.1 正式 DB 仍在 `0015`

| 項目 | 實際狀態 |
|---|---|
| 正式 DB 路徑 | `D:\FDE-AI-UAS-v2.0\student_portal\db.sqlite3` |
| sha256 | `1fa462fef825980eb1808cc7f3535d336240c41b91ebc440031d156d9c19c133` |
| mtime | `2026-10-07 19:08:32` |
| **最後套用 migration** | **`0015_studentsurvey_survey_version_and_more`** |
| `0016` / `0017` / `0018` / `0019` | **從未套用** |
| `learning_visionmodelrecord` 表 | **不存在** |
| `learning_goldenset` / `learning_goldensetsample` 表 | **不存在** |

> **這是交付阻斷級事實**：正式環境**目前無法使用** Vision Model Repository
> 與 Golden Set 功能。所有相關程式碼路徑在正式環境會因「資料表不存在」而失敗。

### 1.2 四個 migration 的實際內容

**來源**：實際讀取 `student_portal/learning/migrations/`（唯讀）

| # | 檔案 | 建立時間 | 依賴 | 主要內容 |
|---|---|---|---|---|
| **0016** | `0016_visionmodelrecord.py` | 2026-10-08 10:30 | `0015_...` | **CreateModel `VisionModelRecord`** |
| **0017** | `0017_visionmodelrecord_snapshot_and_integrity.py` | 2026-10-08 11:22 | `0016_...` | AddField：`integrity_checked_at`、snapshot 相關欄位 |
| **0018** | `0018_golden_set_center.py` | 2026-10-08 16:15 | `0017_...` + `AUTH_USER_MODEL` | **CreateModel `GoldenSet`、`GoldenSetSample`** |
| **0019** | `0019_golden_set_manifest_contract.py` | 2026-10-08 16:48 | `0018_...` | AddField：`manifest_contract_version` 等 |

### 1.3 0016 的 CheckConstraint（**重要：資料完整性由 DB 層保證**）

`0016` 建立 `VisionModelRecord` 時附帶四個 CheckConstraint：

| Constraint 名稱 | 語意 |
|---|---|
| `vision_record_v1_has_no_parent` | V1 版本必須 `parent_record IS NULL` |
| `vision_record_demo_never_training_base` | `is_demo_test_only=True` 者不得為 `TRAINING_BASE` |
| `vision_record_active_requires_validated` | `deployment_status=ACTIVE` 必須 `validation_status=VALIDATED` |
| `vision_record_active_not_demo` | `ACTIVE` 不得為 demo 測試資料 |

> **正面訊號**：`ACTIVE` 必須先 `VALIDATED` 這條規則**在資料庫層強制**，
> 不只是應用層檢查。這是本次驗收中發現的良好設計。
> 但 **SQLite 的 CheckConstraint 支援有限**，正式若改用 PostgreSQL 需重新驗證。

---

## 二、套用方案（**尚未執行，需批准**）

### 2.1 前置作業（**順序不可顛倒**）

```
步驟 0：確認服務已停止寫入
  ↓
步驟 1：完整備份 DB + MEDIA + JSON Store（見 06-BACKUP-RESTORE.md）
  ↓
步驟 2：驗證備份可還原（於臨時副本實測）
  ↓
步驟 3：確認備份雜湊已記錄
  ↓
步驟 4：才可執行 migrate
```

### 2.2 備份指令

```bash
# 1. 停止 Django 服務（避免寫入中備份）
# 2. 備份 DB
cd D:\FDE-AI-UAS-v2.0\student_portal
cp db.sqlite3 "db.sqlite3.backup-before-0016-$(date +%Y%m%d-%H%M%S)"

# 3. 備份 MEDIA（模型快照等）
robocopy private_media "private_media.backup-$(date +%Y%m%d-%H%M%S)" /E /COPYALL

# 4. 備份 JSON Store
cp "%LOCALAPPDATA%\FDE-AI-UAS\vision-center\vision_center.json" \
   "vision_center.json.backup-$(date +%Y%m%d-%H%M%S)"

# 5. 記錄雜湊
sha256sum db.sqlite3 private_media/**/* vision_center.json > backup-manifest.txt
```

### 2.3 套用指令

```bash
cd D:\FDE-AI-UAS-v2.0\student_portal

# 1. 先乾跑，確認將執行的 migration（不寫入）
python manage.py migrate --plan

# 預期輸出應為：
#   learning.0016_visionmodelrecord
#   learning.0017_visionmodelrecord_snapshot_and_integrity
#   learning.0018_golden_set_center
#   learning.0019_golden_set_manifest_contract

# 2. 確認無誤後正式套用
python manage.py migrate learning

# 3. 驗證
python manage.py showmigrations learning | tail -6
```

### 2.4 套用後驗證清單

| # | 檢查項 | 指令 / 方法 | 期望 |
|---|---|---|---|
| 1 | migration 已套用 | `showmigrations learning` | `[X]` 0016–0019 |
| 2 | 新表存在 | `sqlite3 db.sqlite3 ".tables"` | 含 `learning_visionmodelrecord`、`learning_goldenset`、`learning_goldensetsample` |
| 3 | Django 檢查 | `python manage.py check` | `no issues` |
| 4 | 既有資料未損 | 查詢既有表筆數 | 與備份前一致 |
| 5 | 關鍵頁面可開 | 瀏覽器開 `/teacher/vision-models/` | HTTP 200 |

### 2.5 風險評估

| 風險 | 等級 | 說明 | 緩解 |
|---|---|---|---|
| migration 失敗 | **中** | SQLite 對 CheckConstraint 支援有限 | 已於隔離副本實測成功 |
| 資料遺失 | **低** | 0016–0019 僅**新增表與欄位**，未修改或刪除既有欄位 | 仍須完整備份 |
| 服務中斷 | **低** | 新增表通常快速完成 | 安排維護視窗 |
| 既有功能受影響 | **低** | 未觸碰既有 model | 套用後跑完整回歸（534 tests） |

> **重要**：`0016`–`0019` **只做 CreateModel 與 AddField**，
> **未包含任何 RemoveField / DeleteModel / AlterField 破壞性操作**，風險相對可控。

---

## 三、回滾方案

### 3.1 情境 A：migration 中途失敗（最常見）

```bash
# Django migration 具事務性；失敗通常會自動回滾該筆
# 檢查目前狀態
python manage.py showmigrations learning

# 若處於半套用狀態，強制回退到 0015
python manage.py migrate learning 0015
```

### 3.2 情境 B：套用成功但發現問題 → 回退

```bash
cd D:\FDE-AI-UAS-v2.0\student_portal

# 1. 停止服務
# 2. 回退 migration（Django 會執行 reverse operations）
python manage.py migrate learning 0015

# 3. 驗證
python manage.py showmigrations learning | tail -6
# 期望：0016–0019 為 [ ]
```

> **⚠️ 注意**：`0016`–`0019` 的 `CreateModel` 可 reverse（會 DROP TABLE）。
> **若表中已有資料，reverse 將造成資料遺失。**
> 因此 **情境 B 僅適用於「剛套用、尚無真實資料」** 的情況。

### 3.3 情境 C：已產生資料，需完整還原（**最安全**）

```bash
cd D:\FDE-AI-UAS-v2.0\student_portal

# 1. 停止 Django 服務
# 2. 移開現有 DB（不要直接刪除）
mv db.sqlite3 db.sqlite3.failed-attempt-$(date +%Y%m%d-%H%M%S)

# 3. 還原備份
cp db.sqlite3.backup-before-0016-<timestamp> db.sqlite3

# 4. 還原 MEDIA
robocopy private_media.backup-<timestamp> private_media /E /COPYALL

# 5. 還原 JSON Store
cp vision_center.json.backup-<timestamp> "%LOCALAPPDATA%\FDE-AI-UAS\vision-center\vision_center.json"

# 6. 驗證雜湊一致
sha256sum db.sqlite3
# 應等於 1fa462fef825980eb1808cc7f3535d336240c41b91ebc440031d156d9c19c133

# 7. 重啟服務
```

### 3.4 回滾決策樹

```
migration 失敗？
├─ 是 → 情境 A：migrate learning 0015
└─ 否 → 套用後發現問題？
        ├─ 尚無真實資料 → 情境 B：migrate learning 0015
        └─ 已有真實資料 → 情境 C：從備份完整還原（不要用 reverse）
```

---

## 四、正式環境的特殊考量

### 4.1 若正式 DB 為 PostgreSQL

| 項目 | SQLite（當前） | PostgreSQL（正式建議） |
|---|---|---|
| CheckConstraint 支援 | 部分 | **完整** |
| 並發寫入 | 弱 | **強** |
| Reverse migration | 可行 | 可行 |
| 備份方式 | 檔案複製 | `pg_dump` |

**PostgreSQL 備份**：
```bash
pg_dump -Fc -h <host> -U <user> <db> > fde_backup_$(date +%Y%m%d).dump
```

**PostgreSQL 還原**：
```bash
pg_restore -h <host> -U <user> -d <db> --clean --if-exists fde_backup_<date>.dump
```

### 4.2 本輪隔離副本的實測結果

本輪已在**隔離副本**成功套用 `0016`–`0019`：

| 項目 | 結果 |
|---|---|
| 隔離 DB | `.test-temp/acceptance-r24/db/acceptance.sqlite3` |
| 套用結果 | `0016`–`0019` 全部成功 |
| 表建立 | `learning_visionmodelrecord`、`learning_goldenset`、`learning_goldensetsample` 皆存在 |
| 功能驗證 | R07 提交、教師審核、Golden Set 生命週期、Golden Test 前置條件全數 PASS |

> **隔離副本套用成功，證明 migration 腳本本身無誤。**
> 正式套用失敗的風險主要來自行環境差異（如 PostgreSQL 方言、權限）。

---

## 五、時間與順序建議

**建議的交付順序**：

```
第 1 步：完成正式環境備份並驗證可還原
第 2 步：於 staging（或第二副本）套用 0016–0019
第 3 步：於 staging 跑完整回歸（534 tests）
第 4 步：於 staging 做教師 / 學員人工驗收（含 iPhone）
第 5 步：安排維護視窗
第 6 步：正式套用 0016–0019
第 7 步：正式驗證清單逐項確認
```

> **不得跳過第 2–4 步直接對正式 DB 套用。**

---

## 六、本輪遵循聲明

> 依【正式交付驗收指令】第七條：
> 「**不得直接對正式 DB 執行 Migration。**」

| 動作 | 執行 |
|---|---|
| 對正式 DB 執行 `migrate` | ❌ **未執行** |
| 對正式 DB 執行任何寫入 | ❌ **未執行** |
| 修改正式 DB 檔案 | ❌ **未執行** |
| 正式 DB sha256 驗收前後比對 | ✅ **一致**（`1fa462fe…c133`） |
| 於隔離副本套用 | ✅ 已完成（僅隔離副本） |

> **依【正式交付驗收指令】第一條第 4 項：**
> **「不修改正式資料庫」——本輪完全遵守。**

---

**本文件僅為方案，未執行任何 migration。**
**人工 iPhone 驗收：PENDING**
