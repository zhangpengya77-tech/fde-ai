# FDE-AI-UAS 2.0 交付文件｜03 環境變數說明

**文件版本**：v1.0（交付驗收階段產出）
**產出日期**：2026-10-09
**依據**：【正式交付驗收指令】第七條第 4 項
**資料來源**：實際讀取 `student_portal/.env.example`、`student_portal/config/settings.py`、`live_backend/app/main.py`

---

## 一、Django Student Portal 環境變數

**範本檔案**：`student_portal/.env.example`

### 1.1 核心設定

| 變數 | 範例值 | 必要性 | 說明 |
|---|---|---|---|
| `DJANGO_DEBUG` | `true` | **必要** | **必須為字面值 `true`**（不可用 `1`） |
| `DJANGO_SECRET_KEY` | （空） | 正式**必要** | Django secret key |
| `DJANGO_ALLOWED_HOSTS` | `127.0.0.1,localhost` | 正式**必要** | 逗號分隔 |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | （空） | 正式**必要** | 逗號分隔 |
| `DATABASE_URL` | （空） | 正式**必要** | 例：`postgres://user:pass@host:5432/db` |
| `DJANGO_DB_NAME` | （空） | 選用 | 開發用 SQLite 路徑；預設 `manage.py` 旁 `db.sqlite3` |
| `DJANGO_MEDIA_ROOT` | （空） | 正式**必要** | MEDIA 根目錄；預設 `student_portal/private_media` |

> **⚠️ fail-fast 設計**：當 `DJANGO_DEBUG=false` 時，
> `settings.py` 會強制檢查 `DJANGO_ALLOWED_HOSTS`、`DJANGO_CSRF_TRUSTED_ORIGINS`、
> `DATABASE_URL`、`DJANGO_MEDIA_ROOT`，**任一未設即啟動失敗**。
> 這是**刻意的安全設計**，不是缺陷。

### 1.2 Vision 整合（**跨系統關鍵設定**）

| 變數 | 範例值 | 必要性 | 說明 |
|---|---|---|---|
| `DJANGO_VISION_SUBMISSION_API_BASE_URL` | `http://127.0.0.1:8030` | **必要** | Live Backend 位址 |
| `DJANGO_VISION_SUBMISSION_API_TIMEOUT_SECONDS` | `30` | 選用 | 提交逾時秒數 |

> **來源**：`student_portal/config/settings.py:223-224`
> **呼叫點**：`student_portal/learning/vision_submission.py:26`
> → `POST {BASE_URL}/api/v1/vision/submissions`
>
> **這是全專案唯一的跨系統呼叫點。**
> 若此變數指向錯誤位址或 Live Backend 離線，R07 `.pt` 提交將失敗
> （已實測：顯示「模型提交失敗，請確認 Vision 服務後重試。」並完整回滾）。

### 1.3 安全設定（HSTS）

| 變數 | 範例值 | 說明 |
|---|---|---|
| `DJANGO_SECURE_HSTS_SECONDS` | `0` | HSTS 秒數（`0` = 停用） |
| `DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS` | `false` | 是否含子網域 |
| `DJANGO_SECURE_HSTS_PRELOAD` | `false` | 是否送 preload 清單 |

> 正式環境（HTTPS）建議設為 `31536000` / `true` / `true`。

### 1.4 公開 AI 上游服務

| 變數 | 範例值 | 說明 |
|---|---|---|
| `DJANGO_PUBLIC_RAG_UPSTREAM_URL` | （空） | RAG 服務上游 |
| `DJANGO_PUBLIC_INSPECTION_UPSTREAM_URL` | （空） | 影像檢查上游 |
| `DJANGO_PUBLIC_VOICE_UPSTREAM_URL` | （空） | 語音服務上游 |
| `DJANGO_PUBLIC_AI_TIMEOUT_SECONDS` | `20` | AI 請求逾時 |
| `DJANGO_PUBLIC_AI_MAX_REQUEST_BYTES` | `25000000` | 最大請求位元組（約 25MB） |
| `DJANGO_PUBLIC_RAG_REQUESTS_PER_MINUTE` | `30` | RAG 速率限制 |
| `DJANGO_PUBLIC_INSPECTION_REQUESTS_PER_MINUTE` | `5` | 影像檢查速率限制 |
| `DJANGO_PUBLIC_VOICE_REQUESTS_PER_MINUTE` | `20` | 語音速率限制 |
| `DJANGO_PUBLIC_AI_TRUSTED_PROXY_IPS` | （空） | 信任的代理 IP |

### 1.5 郵件設定

| 變數 | 範例值 | 說明 |
|---|---|---|
| `DJANGO_EMAIL_BACKEND` | `django.core.mail.backends.console.EmailBackend` | 郵件後端 |
| `DJANGO_EMAIL_HOST` | （空） | SMTP 主機 |
| `DJANGO_EMAIL_PORT` | `587` | SMTP 埠 |
| `DJANGO_EMAIL_HOST_USER` | （空） | SMTP 使用者 |
| `DJANGO_EMAIL_HOST_PASSWORD` | （空） | SMTP 密碼 |
| `DJANGO_EMAIL_USE_TLS` | `true` | 使用 TLS |
| `DEFAULT_FROM_EMAIL` | （空） | 寄件者位址 |

### 1.6 快取與日誌

| 變數 | 範例值 | 說明 |
|---|---|---|
| `DJANGO_CACHE_BACKEND` | （空） | 快取後端；正式預設 FileBasedCache |
| `DJANGO_CACHE_LOCATION` | （空） | 快取位置；正式預設 `BASE_DIR/.cache` |
| `DJANGO_LOG_LEVEL` | `INFO` | 日誌等級 |

### 1.7 成長影片與上傳限制

| 變數 | 範例值 | 說明 |
|---|---|---|
| `DJANGO_GROWTH_VIDEO_MAX_UPLOAD_BYTES` | `314572800` | 影片上傳上限（約 300MB） |
| `DJANGO_GROWTH_VIDEO_PRESET` | `veryfast` | ffmpeg preset |
| `DJANGO_FFMPEG_BINARY` | `ffmpeg` | ffmpeg 路徑 |
| `DJANGO_FFPROBE_BINARY` | `ffprobe` | ffprobe 路徑 |
| `DJANGO_DATA_UPLOAD_MAX_MEMORY_SIZE` | `316572800` | 記憶體上傳上限（約 302MB） |

---

## 二、Live Backend 環境變數

**來源**：`live_backend/app/main.py` 第 107、117 行

| 變數 | 預設值 | 必要性 | 說明 |
|---|---|---|---|
| `FDE_VISION_CENTER_ROOT` | `%LOCALAPPDATA%\FDE-AI-UAS\vision-center` | **建議明確設定** | **Vision Center JSON Store 根目錄** |
| `FDE_DJANGO_PORTAL_URL` | `http://127.0.0.1:8022` | 選用 | Django Portal 位址（代理轉發） |

### 2.1 程式碼依據

```python
# live_backend/app/main.py:107
center_root = Path(
    os.environ.get("FDE_VISION_CENTER_ROOT")
    or Path(os.environ.get("LOCALAPPDATA", Path.home())) / "FDE-AI-UAS" / "vision-center"
)

# live_backend/app/main.py:117
django_origin = (
    django_portal_url or os.environ.get("FDE_DJANGO_PORTAL_URL") or "http://127.0.0.1:8022"
).rstrip("/")
```

### 2.2 ⚠️ `FDE_VISION_CENTER_ROOT` 的正式位置

**正式環境的 JSON Store 實際路徑**（本輪唯讀確認，**全程未寫入**）：

```
C:\Users\admin\AppData\Local\FDE-AI-UAS\vision-center\vision_center.json
```

| 屬性 | 值 |
|---|---|
| sha256 | `7b3f674fbca0e6a13f2f154d5dddd926ecc9506e486926d3009ee5ae02615c36` |
| mtime | `2026-10-08 12:37:51` |
| 內容統計 | `models:0, datasets:0, evaluations:0, hard_examples:0, camera_profiles:0, submissions:3, golden_sets:0` |

> **驗收前後雜湊一致 → 正式 JSON Store 未被本輪驗收修改。**

---

## 三、關鍵設定的「必須一致」矩陣

以下三組設定**必須互相對齊**，否則功能失效：

### 3.1 Django ↔ Live Backend 位址

| 端 | 變數 | 必須等於 |
|---|---|---|
| Django | `DJANGO_VISION_SUBMISSION_API_BASE_URL` | `http://<LiveBackend主機>:<埠>` |
| Live Backend | 啟動參數 `--port` | 同上埠號 |
| Live Backend | `FDE_DJANGO_PORTAL_URL` | `http://<Django主機>:<埠>` |
| Django | 啟動埠 | 同上埠號 |

**預設對應**：Django `8022` ↔ Live Backend `8030`

### 3.2 儲存路徑

| 端 | 變數 | 說明 |
|---|---|---|
| Django | `DJANGO_DB_NAME` 或 `DATABASE_URL` | 關聯式資料（Evidence / Golden Set / VisionModelRecord） |
| Django | `DJANGO_MEDIA_ROOT` | 檔案儲存（Evidence 附件、模型快照） |
| Live Backend | `FDE_VISION_CENTER_ROOT` | JSON Store（submissions / models 索引） |

> **三者是三個獨立的持久化位置，備份時不可遺漏任何一個。**
> 詳見 `06-BACKUP-RESTORE.md`。

### 3.3 除錯模式

| 變數 | 開發 | 正式 |
|---|---|---|
| `DJANGO_DEBUG` | `true` | `false` |
| `DJANGO_SECURE_HSTS_SECONDS` | `0` | `31536000` |

> **`DJANGO_DEBUG` 必須是字面值 `true`**。
> 使用 `1` 會被 Django 判定為 false，導致行為與預期不符。

---

## 四、環境變數設定範本

### 4.1 開發環境（本機）

```bash
export DJANGO_DEBUG=true
export DJANGO_SECRET_KEY=dev-only-not-for-production
export DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost
export DJANGO_MEDIA_ROOT=D:\FDE-AI-UAS-v2.0\student_portal\private_media
export DJANGO_VISION_SUBMISSION_API_BASE_URL=http://127.0.0.1:8030
export DJANGO_VISION_SUBMISSION_API_TIMEOUT_SECONDS=30

# Live Backend
export FDE_VISION_CENTER_ROOT=D:\FDE-AI-UAS-data\vision-center
export FDE_DJANGO_PORTAL_URL=http://127.0.0.1:8022
```

### 4.2 正式環境（範本，**本輪未套用**）

```bash
export DJANGO_DEBUG=false
export DJANGO_SECRET_KEY=<從密鑰管理系統取得>
export DJANGO_ALLOWED_HOSTS=<正式網域>
export DJANGO_CSRF_TRUSTED_ORIGINS=https://<正式網域>
export DATABASE_URL=postgres://<user>:<pass>@<host>:5432/<db>
export DJANGO_MEDIA_ROOT=/var/lib/fde-ai/private_media
export DJANGO_VISION_SUBMISSION_API_BASE_URL=http://127.0.0.1:8030
export DJANGO_VISION_SUBMISSION_API_TIMEOUT_SECONDS=30
export DJANGO_SECURE_HSTS_SECONDS=31536000
export DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS=true
export DJANGO_SECURE_HSTS_PRELOAD=true
export DJANGO_LOG_LEVEL=INFO

# Live Backend
export FDE_VISION_CENTER_ROOT=/var/lib/fde-ai/vision-center
export FDE_DJANGO_PORTAL_URL=http://127.0.0.1:8022
```

---

## 五、安全注意事項

| # | 注意事項 |
|---|---|
| 1 | **`DJANGO_SECRET_KEY` 不得提交至版本控制**（`.env` 應在 `.gitignore` 中） |
| 2 | **`DJANGO_EMAIL_HOST_PASSWORD` 不得提交** |
| 3 | `DATABASE_URL` 含密碼，**不得提交** |
| 4 | **API Key 不得寫進 GitHub**（專案禁止修改清單第 8 項） |
| 5 | 正式環境務必 `DJANGO_DEBUG=false`（`true` 會洩漏詳細錯誤頁） |
| 6 | `DJANGO_PUBLIC_AI_TRUSTED_PROXY_IPS` 需正確設定，否則速率限制可被繞過 |

---

## 六、本輪驗收使用的隔離環境變數（對照用）

**檔案**：`.test-temp/acceptance-r24/env.sh`

```bash
export DJANGO_DB_NAME=<PROJECT>/.test-temp/acceptance-r24/db/acceptance.sqlite3
export DJANGO_MEDIA_ROOT=<PROJECT>/.test-temp/acceptance-r24/media
export FDE_VISION_CENTER_ROOT=<PROJECT>/.test-temp/acceptance-r24/live-vision-store
export DJANGO_VISION_SUBMISSION_API_BASE_URL=http://127.0.0.1:<isolated-port>
```

> **以上全部指向 `.test-temp/`，未指向任何正式服務的資料目錄。**
> 隔離證明見 `01-ISOLATION-REPORT.md`。

---

**本文件僅為說明，未修改任何環境變數設定。**
**人工 iPhone 驗收：PENDING**
