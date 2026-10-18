# FDE-AI-UAS 2.0 交付文件｜06 MEDIA_ROOT 與 JSON Store 保存說明

**文件版本**：v1.0（交付驗收階段產出）
**產出日期**：2026-10-09
**依據**：【正式交付驗收指令】第七條第 7、8 項
**性質**：**說明文件，本輪未寫入任何正式儲存位置**

---

# 第一部分：MEDIA_ROOT 保存與備份

## 一、MEDIA_ROOT 是什麼

`MEDIA_ROOT` 是 Django 存放**使用者上傳檔案**的目錄。在 FDE-AI-UAS 2.0 中，它承載：

| 檔案類型 | 用途 | 來源 |
|---|---|---|
| **Evidence 附件** | 學員提交的 `.pt` 模型檔 | R07 提交 |
| **模型不可變快照** | 教師收藏後的內容定址副本 | 教師入庫 |
| **Golden Set 樣本** | 黃金基準測試圖片 | 教師上傳 |
| **成長紀錄附件** | 學員成長紀錄檔案 | 學員提交 |

## 二、設定方式

**來源**：`student_portal/config/settings.py:230`

```python
MEDIA_ROOT = Path(os.environ.get('DJANGO_MEDIA_ROOT') or BASE_DIR / 'private_media')
```

| 情境 | 實際路徑 |
|---|---|
| 未設定 `DJANGO_MEDIA_ROOT` | `student_portal/private_media`（預設） |
| 已設定 | 由變數決定 |
| `DJANGO_DEBUG=false` 時未設定 | **啟動失敗**（fail-fast，刻意設計） |

### 2.1 驗證實際 MEDIA_ROOT

```bash
cd D:\FDE-AI-UAS-v2.0\student_portal
python manage.py shell -c "from django.conf import settings; print(settings.MEDIA_ROOT)"
```

> **本輪驗收已於隔離環境實測**：實際 MEDIA_ROOT 指向
> `.test-temp/acceptance-r24/media/`，**未指向正式目錄**。

## 三、目錄結構（實測）

依本輪隔離環境實際產生的結構：

```
<MEDIA_ROOT>/
├── evidence/
│   └── <evidence-uuid>/
│       └── best.pt                    ← 學員提交的模型檔
├── vision_snapshots/                  ← 教師入庫後的不可變快照
│   └── <model_id>/
│       └── <sha256>...
└── golden_set_samples/                ← Golden Set 樣本
    └── <golden_set_id>/
        └── <image files>
```

### 3.1 已記錄的 P3 瑕疵

> **發現**：fail-safe 回滾時會殘留**空目錄** `media/evidence/<uuid>/`。
> `storage.delete()` 刪除了檔案但未清理父目錄。
>
> **影響**：低（僅佔用極小空間，不影響功能）
> **建議**：`storage.delete()` 後清理空的父目錄
> **本輪未修復**（依凍結規則，僅記錄）

## 四、備份方式

### 4.1 完整備份

```bash
cd D:\FDE-AI-UAS-v2.0\student_portal

# Windows（保留權限）
robocopy private_media ..\backups\<timestamp>\private_media /E /COPYALL /R:2 /W:2

# Linux
rsync -av --delete private_media/ /backups/<timestamp>/private_media/
```

### 4.2 增量備份（建議用於大容量）

```bash
# Linux
rsync -av --link-dest=/backups/latest private_media/ /backups/<timestamp>/private_media/
```

### 4.3 備份驗證

```bash
# 檔案數比對
find private_media -type f | wc -l
find ..\backups\<timestamp>\private_media -type f | wc -l
# 兩者應相等

# 雜湊比對（抽樣或全量）
sha256sum private_media/**/* > /tmp/media-now.txt
sha256sum ..\backups\<timestamp>\private_media/**/* > /tmp/media-backup.txt
diff /tmp/media-now.txt /tmp/media-backup.txt
# 應無差異
```

## 五、⚠️ 安全注意事項

| # | 注意事項 | 原因 |
|---|---|---|
| 1 | **`private_media` 不得設為公開目錄** | 內含 `.pt` 模型檔與學員資料 |
| 2 | **正式模式不可由 Django 直接 serve MEDIA** | 見下方第 5.1 節 |
| 3 | **備份檔含敏感資料，異地備份須加密** | 資料保護 |
| 4 | **目錄名稱 `private_media` 是刻意的** | 語意上表明非公開 |

### 5.1 【PENDING 安全項】MEDIA 是否公開 serve

本輪安全驗收 **S11** 判定為 PASS，但附帶**人工確認事項**：

| 情境 | 風險 |
|---|---|
| `DJANGO_DEBUG=true` 且 Django serve MEDIA | `.pt` 可被匿名下載 |
| `DJANGO_DEBUG=false` + WhiteNoise/Nginx/物件儲存 | 應無公開路由 |

**交付前必做**：以正式設定實測

```bash
curl -I http://<正式網域>/media/evidence/<uuid>/best.pt
# 期望：404
```

> **本輪未執行此實測**（凍結規則：不變更正式設定）。
> 標記為 **PENDING**，**不得視為已 PASS**。

## 六、還原方式

```bash
# 1. 停止服務
# 2. 移開現有目錄（不要刪除）
mv private_media private_media.before-restore-<timestamp>
# 3. 還原
robocopy ..\backups\<timestamp>\private_media private_media /E /COPYALL
# 4. 驗證檔案數與雜湊
```

### 6.1 還原後必查：完整性

還原 MEDIA 後，**必須**在教師後台執行「模型完整性檢查」：

| 結果 | 意義 |
|---|---|
| `INTACT` | 快照雜湊與 DB 記錄一致 → 還原成功 |
| `MISMATCH` | 檔案內容與 DB 記錄不符 → **還原不完整或檔案損毀** |
| `MISSING` | 檔案不存在 → **MEDIA 備份缺漏** |

> 這是驗證 MEDIA 還原是否成功的**最可靠方法**，
> 因為它比對的是真實內容雜湊，而非僅檔案數量。

---

# 第二部分：Vision Center JSON Store 保存方式

## 七、JSON Store 是什麼

Vision Center JSON Store 是 **Live Backend** 的輕量級索引儲存，**不是**關聯式資料庫。

**來源**：`live_backend/app/main.py:107`

```python
center_root = Path(
    os.environ.get("FDE_VISION_CENTER_ROOT")
    or Path(os.environ.get("LOCALAPPDATA", Path.home())) / "FDE-AI-UAS" / "vision-center"
)
```

| 項目 | 說明 |
|---|---|
| 檔案 | `vision_center.json` |
| 格式 | JSON |
| 管理 | Live Backend（Starlette） |
| 內容 | submissions / models / datasets / evaluations / golden_sets / hard_examples / camera_profiles |

## 八、正式位置（本輪唯讀確認，**未寫入**）

```
C:\Users\admin\AppData\Local\FDE-AI-UAS\vision-center\vision_center.json
```

| 屬性 | 值 |
|---|---|
| sha256 | `7b3f674fbca0e6a13f2f154d5dddd926ecc9506e486926d3009ee5ae02615c36` |
| mtime | `2026-10-08 12:37:51` |
| 大小 | — |

### 8.1 內容統計（實測）

```
models:           0
datasets:         0
evaluations:      0
hard_examples:    0
camera_profiles:  0
submissions:      3      ← 真實資料，不可遺失
golden_sets:      0
```

> **`submissions: 3` 是正式環境的真實資料。**
> 交付時必須連同 JSON Store 一併保存。

## 九、驗證實際寫入位置

**方法 1：直接讀取環境變數**

```bash
echo $FDE_VISION_CENTER_ROOT
```

**方法 2：實際寫入測試後檢查檔案 mtime**

```bash
# 記錄 mtime
stat -c '%y' "$FDE_VISION_CENTER_ROOT/vision_center.json"

# 執行一次提交操作

# 再次檢查 mtime
stat -c '%y' "$FDE_VISION_CENTER_ROOT/vision_center.json"
# mtime 應已更新 → 證明寫入位置正確
```

**方法 3：程式碼確認**

```python
# live_backend/app/main.py:107
center_root = Path(os.environ.get("FDE_VISION_CENTER_ROOT") or ...)
```

> **本輪已於隔離環境實測**：`FDE_VISION_CENTER_ROOT` 指向
> `.test-temp/acceptance-r24/live-vision-store/`，
> 提交後該檔案 mtime 更新，**正式 JSON Store 未被觸碰**。

## 十、備份方式

```bash
# 1. 停止 Live Backend（避免寫入中複製）
# 2. 備份
cp "%LOCALAPPDATA%\FDE-AI-UAS\vision-center\vision_center.json" \
   D:\FDE-AI-UAS-v2.0\backups\<timestamp>\vision_center.json

# 3. 驗證
sha256sum D:\FDE-AI-UAS-v2.0\backups\<timestamp>\vision_center.json
# 應等於 7b3f674fbca0e6a13f2f154d5dddd926ecc9506e486926d3009ee5ae02615c36

# 4. 驗證 JSON 可解析
python -c "import json; json.load(open('vision_center.json')); print('valid JSON')"
```

## 十一、還原方式

```bash
# 1. 停止 Live Backend
# 2. 移開現有檔案
mv "%LOCALAPPDATA%\FDE-AI-UAS\vision-center\vision_center.json" \
   "%LOCALAPPDATA%\FDE-AI-UAS\vision-center\vision_center.json.before-restore-<ts>"
# 3. 還原
cp D:\FDE-AI-UAS-v2.0\backups\<timestamp>\vision_center.json \
   "%LOCALAPPDATA%\FDE-AI-UAS\vision-center\vision_center.json"
# 4. 驗證雜湊
sha256sum "%LOCALAPPDATA%\FDE-AI-UAS\vision-center\vision_center.json"
# 5. 重啟 Live Backend
# 6. 驗證 API
curl -s http://127.0.0.1:8030/api/v1/vision/submissions
```

## 十二、⚠️ JSON Store 的架構風險（**必須揭露**）

### 12.1 三套 Golden Set 儲存並存

本輪驗收的**決定性發現**：

| # | Golden Set 實作 | 儲存位置 | 是否接線 |
|---|---|---|---|
| 1 | Django `GoldenSet`/`GoldenSetSample` | DB | 本體 |
| 2 | `vision_center.py` `golden_sets[]` | **JSON Store** | **未接線** |
| 3 | `benchmark.py` `PropValidationSet` | 檔案系統 manifest | **未接線** |

**目前 JSON Store 中 `golden_sets: 0`**——該欄位存在但**從未被寫入**。

### 12.2 風險

| 風險 | 說明 |
|---|---|
| 雙來源混淆 | 後續開發可能誤把 JSON Store 的 `golden_sets[]` 當作真實來源 |
| 備份對象不明 | 若未來誤用，需同時備份兩處 |
| 資料不一致 | 兩處若都寫入，可能出現分歧 |

### 12.3 建議

1. **文件明示**：JSON Store 的 `golden_sets[]` **目前為未使用的預留欄位**
2. **或停用**：若確定不使用，移除該欄位避免混淆
3. **或標記唯讀**：若保留作為鏡像，明確標示為「唯讀鏡像」

> **交付文件必須明示此限制**，避免後續誤判為「已整合」。

---

# 第三部分：三個位置的整體保存策略

## 十三、三者關係圖

```
┌─────────────────────────────────────────────────────────┐
│  Django DB (db.sqlite3)                                 │
│  - Evidence.evidence_id                                 │
│  - Evidence.vision_submission_id ──────┐                │
│  - VisionModelRecord.snapshot_sha256   │                │
│  - GoldenSet / GoldenSetSample         │                │
└────────────────┬───────────────────────┼────────────────┘
                 │                       │
                 │ 檔案路徑引用           │ submission_id 引用
                 ▼                       ▼
┌────────────────────────────┐  ┌──────────────────────────┐
│  MEDIA_ROOT                │  │  Vision Center JSON Store │
│  - evidence/<uuid>/best.pt │  │  - submissions[]          │
│  - vision_snapshots/...    │  │    .evidence_reference ───┼──→ 指向 DB
│  - golden_set_samples/...  │  │    .file_hash             │
└────────────────────────────┘  └──────────────────────────┘
```

## 十四、備份檢查清單

| # | 項目 | 完成 |
|---|---|---|
| 1 | DB 備份（含 `integrity_check` 驗證） | ☐ |
| 2 | MEDIA 備份（含檔案數與雜湊驗證） | ☐ |
| 3 | JSON Store 備份（含 JSON 可解析驗證） | ☐ |
| 4 | 三者雜湊已記錄於 `SHA256SUMS` | ☐ |
| 5 | 備份檔案已異地複製 | ☐ |
| 6 | **還原演練已在隔離環境執行** | ☐ |
| 7 | 還原後雙向引用完整（無孤兒） | ☐ |

## 十五、本輪遵循聲明

> 依【正式交付驗收指令】第一條第 4 項與第五條：
> 「不修改正式資料庫」「**不得修改正式 JSON Store**」

| 動作 | 執行 |
|---|---|
| 寫入正式 MEDIA_ROOT | ❌ **未執行** |
| 寫入正式 JSON Store | ❌ **未執行** |
| 修改 `vision_center.json` | ❌ **未執行** |
| 唯讀確認 JSON Store 內容 | ✅ 已執行 |
| 唯讀確認 MEDIA 路徑 | ✅ 已執行（隔離環境） |
| 產出保存/備份方案文件 | ✅ 本文件 |

**正式 JSON Store 驗收前後雜湊一致**：
`7b3f674fbca0e6a13f2f154d5dddd926ecc9506e486926d3009ee5ae02615c36`

---

**本文件僅為說明與方案，未寫入任何正式儲存位置。**
**人工 iPhone 驗收：PENDING**
