# FDE-AI-UAS 2.0 交付文件｜05 資料庫備份與還原方案

**文件版本**：v1.0（交付驗收階段產出）
**產出日期**：2026-10-09
**依據**：【正式交付驗收指令】第七條第 6 項
**性質**：**方案文件，本輪未對正式 DB 執行任何備份或還原**

---

## 一、需要備份的三個持久化位置

FDE-AI-UAS 2.0 的資料分散在**三個獨立位置**，**缺一不可**：

| # | 位置 | 路徑 | 內容 | 遺失後果 |
|---|---|---|---|---|
| 1 | **關聯式 DB** | `student_portal/db.sqlite3`<br>或 `DATABASE_URL` | 學員 / 教師 / Evidence / Golden Set / VisionModelRecord | **嚴重**：帳號、提交紀錄、審核歷程全失 |
| 2 | **MEDIA** | `DJANGO_MEDIA_ROOT`<br>（預設 `student_portal/private_media`） | Evidence 附件、模型快照、Golden Set 樣本 | **嚴重**：檔遺失 → 完整性檢查 `MISSING` |
| 3 | **Vision Center JSON Store** | `FDE_VISION_CENTER_ROOT`<br>（預設 `%LOCALAPPDATA%\FDE-AI-UAS\vision-center`） | Vision Center 索引（submissions / models） | **中度**：Vision Center 索引遺失 |

> **⚠️ 三者之間存在引用關係**：
> Django DB 中的 Evidence 持有 `vision_submission_id`，
> JSON Store 中的 submission 持有 `evidence_reference`。
> **只備份其中一個，還原後會出現「單邊引用」的孤兒紀錄。**

---

## 二、當前正式資料狀態（唯讀實測）

| 資源 | sha256 | mtime | 大小 |
|---|---|---|---|
| `student_portal/db.sqlite3` | `1fa462fef825980eb1808cc7f3535d336240c41b91ebc440031d156d9c19c133` | `2026-10-07 19:08:32` | — |
| `vision_center.json` | `7b3f674fbca0e6a13f2f154d5dddd926ecc9506e486926d3009ee5ae02615c36` | `2026-10-08 12:37:51` | — |

**JSON Store 內容統計**：
```
models: 0
datasets: 0
evaluations: 0
hard_examples: 0
camera_profiles: 0
submissions: 3
golden_sets: 0
```

> 正式 JSON Store 中有 **3 筆 submissions**，為真實資料，**不可遺失**。

---

## 三、SQLite 環境備份方案

### 3.1 備份（服務停止後執行）

```bash
cd D:\FDE-AI-UAS-v2.0\student_portal

# 1. 停止 Django 服務（重要：避免寫入中備份導致 DB 損毀）
# 2. 建立備份目錄
mkdir -p ..\backups\$(date +%Y%m%d-%H%M%S)

# 3. 備份 DB
cp db.sqlite3 ..\backups\<timestamp>\db.sqlite3

# 4. 備份 MEDIA
robocopy private_media ..\backups\<timestamp>\private_media /E /COPYALL

# 5. 備份 JSON Store
cp "%LOCALAPPDATA%\FDE-AI-UAS\vision-center\vision_center.json" \
   ..\backups\<timestamp>\vision_center.json
```

### 3.2 使用 SQLite 線上備份（**推薦，可不停機**）

SQLite 提供 `.backup` 指令，可在服務運行中安全備份：

```bash
sqlite3 db.sqlite3 ".backup '..\backups\<timestamp>\db.sqlite3'"
```

> **優點**：不需停機，且產出一致的快照。
> **這是 SQLite 官方推薦的備份方式。**

### 3.3 備份完整性驗證（**必做**）

```bash
# 1. 記錄雜湊
sha256sum db.sqlite3 > ..\backups\<timestamp>\SHA256SUMS
sha256sum private_media/**/* >> ..\backups\<timestamp>\SHA256SUMS

# 2. 驗證 SQLite 完整性
sqlite3 ..\backups\<timestamp>\db.sqlite3 "PRAGMA integrity_check;"
# 期望輸出：ok

# 3. 驗證可讀取
sqlite3 ..\backups\<timestamp>\db.sqlite3 "SELECT COUNT(*) FROM learning_evidence;"
```

---

## 四、PostgreSQL 環境備份方案（正式建議）

### 4.1 備份

```bash
# 自訂格式（推薦，支援平行還原與壓縮）
pg_dump -Fc -h <host> -U <user> -d <db> > fde_backup_$(date +%Y%m%d-%H%M%S).dump

# 純 SQL 格式（可讀性佳，適合小庫）
pg_dump -h <host> -U <user> -d <db> > fde_backup_$(date +%Y%m%d-%H%M%S).sql
```

### 4.2 還原

```bash
# 自訂格式
pg_restore -h <host> -U <user> -d <db> --clean --if-exists fde_backup_<timestamp>.dump

# 純 SQL 格式
psql -h <host> -U <user> -d <db> < fde_backup_<timestamp>.sql
```

### 4.3 驗證

```bash
psql -h <host> -U <user> -d <db> -c "\dt" | head -30
psql -h <host> -U <user> -d <db> -c "SELECT COUNT(*) FROM learning_evidence;"
```

---

## 五、還原程序

### 5.1 完整還原（三個位置一起）

```bash
# 1. 停止所有服務（Django + Live Backend）

# 2. 移開現有資料（不要直接刪除！）
cd D:\FDE-AI-UAS-v2.0\student_portal
mv db.sqlite3 db.sqlite3.before-restore-$(date +%Y%m%d-%H%M%S)
mv private_media private_media.before-restore-$(date +%Y%m%d-%H%M%S)

# 3. 還原 DB
cp ..\backups\<timestamp>\db.sqlite3 db.sqlite3

# 4. 還原 MEDIA
robocopy ..\backups\<timestamp>\private_media private_media /E /COPYALL

# 5. 還原 JSON Store
cp ..\backups\<timestamp>\vision_center.json \
   "%LOCALAPPDATA%\FDE-AI-UAS\vision-center\vision_center.json"

# 6. 驗證雜湊
sha256sum db.sqlite3
# 應等於備份時的雜湊值

sqlite3 db.sqlite3 "PRAGMA integrity_check;"
# 期望：ok

# 7. 重啟服務
```

### 5.2 還原後必須驗證的項目

| # | 檢查項 | 方法 | 期望 |
|---|---|---|---|
| 1 | DB 完整性 | `PRAGMA integrity_check` | `ok` |
| 2 | Migration 狀態 | `showmigrations learning` | 與備份時一致 |
| 3 | Evidence 筆數 | SQL count | 與備份時一致 |
| 4 | 檔案存在 | MEDIA 檔案數 | 與備份時一致 |
| 5 | JSON Store 可讀 | `GET /api/v1/vision/submissions` | 回應 submissions 清單 |
| 6 | **雙向引用完整** | 檢查 Evidence.vision_submission_id ↔ submission.evidence_reference | **無孤兒** |
| 7 | 教師可登入 | 瀏覽器 | HTTP 200 |
| 8 | 完整性檢查 | 教師後台執行 | `INTACT` |

> **第 6 項最關鍵**：三個位置的引用關係若破裂，
> 會導致「提交紀錄存在但檔案找不到」或反之。
> 還原後必須以 `02-BACKEND-DATA-CONSISTENCY.md` 的方法重新驗證 binding。

---

## 六、備份排程建議

| 頻率 | 內容 | 保留期 |
|---|---|---|
| **每日** | DB 完整備份 | 30 天 |
| **每日** | JSON Store | 30 天 |
| **每週** | MEDIA 完整備份（增量） | 90 天 |
| **每月** | 完整備份（DB + MEDIA + JSON） | 1 年 |
| **Migration 前** | **手動完整備份 + 還原實測** | 永久 |

### 6.1 備份儲存位置建議

| 位置 | 用途 |
|---|---|
| 本機 `backups/` | 快速還原 |
| 外接磁碟 / NAS | 硬體故障防護 |
| **異地（雲端 / 另一機房）** | 災難復原 |

> **遵循 3-2-1 原則**：3 份副本、2 種媒介、1 份異地。

---

## 七、還原演練建議

**交付前必做**：

1. 在**隔離環境**實際執行一次完整還原
2. 記錄還原耗時
3. 驗證第 5.2 節全部 8 項
4. 記錄遇到的任何問題

> **未經演練的備份等於沒有備份。**
> 本輪因凍結規則未對正式環境執行還原演練，**列為交付前待辦**。

---

## 八、風險與注意事項

| # | 風險 | 說明 | 緩解 |
|---|---|---|---|
| 1 | 服務運行中複製 SQLite | 可能得到損毀的 DB | 使用 `.backup` 或先停機 |
| 2 | 只備份 DB 未備份 MEDIA | 還原後檔案全失 | **三個位置一起備份** |
| 3 | 引用關係破裂 | 單邊備份或還原順序錯誤 | 還原後執行 5.2 第 6 項驗證 |
| 4 | 備份未驗證 | 備份檔本身損毀而不自知 | 每次備份後跑 `integrity_check` |
| 5 | 備份含敏感資料未加密 | 資料外洩 | 異地備份須加密 |
| 6 | 未做還原演練 | 真正需要時才發現備份不可用 | 交付前必做演練 |

---

## 九、本輪遵循聲明

> 依【正式交付驗收指令】第七條第 6 項要求「資料庫備份及還原方案」，
> 以及第一條第 4 項「不修改正式資料庫」。

| 動作 | 執行 |
|---|---|
| 對正式 DB 執行備份 | ❌ **未執行**（本輪為驗收，非維運） |
| 對正式 DB 執行還原 | ❌ **未執行** |
| 對正式 DB 執行寫入 | ❌ **未執行** |
| 唯讀確認 DB 雜湊與 migration 狀態 | ✅ 已執行 |
| 唯讀確認 JSON Store 內容與雜湊 | ✅ 已執行 |
| 產出備份/還原方案文件 | ✅ 本文件 |

> 正式 DB sha256 `1fa462fe…c133` 與 mtime `2026-10-07 19:08:32`
> 在驗收前後**完全一致**，證明本輪未對正式資料造成任何變更。

---

**本文件僅為方案，未執行任何備份或還原。**
**人工 iPhone 驗收：PENDING**
