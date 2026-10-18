# FDE-AI-UAS 2.0 交付文件｜01 啟動操作說明（前端 / 後端）

**文件版本**：v1.0（交付驗收階段產出）
**產出日期**：2026-10-09
**依據**：【正式交付驗收指令】第七條第 1、2 項
**性質**：**操作說明文件，未執行任何部署**

---

## 一、交付架構總覽

FDE-AI-UAS 2.0 由**兩支必須同時在線的服務**組成：

```
┌──────────────────────────────────────────────────────────┐
│  瀏覽器（學員 / 教師）                                     │
└───────────────┬──────────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────┐
│  Django Student Portal          :8022                     │
│  student_portal/                                          │
│  - 學員端 / 教師端 / Golden Set / Vision Model Center      │
│  - DB: sqlite3 或 DATABASE_URL（PostgreSQL）              │
│  - MEDIA: DJANGO_MEDIA_ROOT                              │
└───────────────┬──────────────────────────────────────────┘
                │  POST /api/v1/vision/submissions
                ▼  （唯一跨系統呼叫點）
┌──────────────────────────────────────────────────────────┐
│  Live Backend（Starlette + Uvicorn）   :8030              │
│  live_backend/app/main.py                                │
│  - Vision Center JSON Store                              │
│  - FDE_VISION_CENTER_ROOT                                │
└──────────────────────────────────────────────────────────┘
```

> **⚠️ 關鍵依賴**：R07 `.pt` 提交**硬依賴** Live Backend。
> 若 Live Backend 離線，學員提交會顯示
> 「模型提交失敗，請確認 Vision 服務後重試。」（已實測，見 `04-REGRESSION-SECURITY.md`）

---

## 二、後端啟動 — Django Student Portal（:8022）

### 2.1 前置條件

| 項目 | 要求 |
|---|---|
| Python | 3.12+（驗收實測 3.12.13） |
| 工作目錄 | `D:\FDE-AI-UAS-v2.0\student_portal` |
| 依賴 | 見 `02-DEPENDENCIES.md` |
| DB | 需先完成 migration（見 `05-MIGRATION-PLAN.md`） |

### 2.2 啟動步驟

```bash
# 1. 切換至 Django 專案目錄
cd D:\FDE-AI-UAS-v2.0\student_portal

# 2. 設定環境變數（開發；正式請用 04-ENVIRONMENT-VARIABLES.md）
export DJANGO_DEBUG=true
export DJANGO_SECRET_KEY=<請設定>
export DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost
export DJANGO_MEDIA_ROOT=D:\FDE-AI-UAS-v2.0\student_portal\private_media

# 3. 套用 migration（⚠️ 正式環境須先備份，見 05 / 06）
python manage.py migrate

# 4. 啟動服務
python manage.py runserver 127.0.0.1:8022
```

### 2.3 驗證啟動成功

```bash
curl -I http://127.0.0.1:8022/
# 期望：HTTP/1.1 200 或 302
```

### 2.4 正式環境啟動（gunicorn，Linux）

```bash
# gunicorn 僅在非 Windows 平台安裝（見 requirements.txt）
cd D:\FDE-AI-UAS-v2.0\student_portal
gunicorn config.wsgi:application --bind 0.0.0.0:8022 --workers 3
```

> **正式模式必要條件**（`DJANGO_DEBUG=false` 時 `settings.py` 強制檢查）：
> - `DJANGO_ALLOWED_HOSTS` 必須設定
> - `DJANGO_CSRF_TRUSTED_ORIGINS` 必須設定
> - `DATABASE_URL` 必須指向持久化資料庫
> - `DJANGO_MEDIA_ROOT` 必須指向持久化儲存
>
> 以上任一未設定，Django **啟動即拋 RuntimeError**（fail-fast 設計，屬正確行為）。

### 2.5 使用的本地埠

| 埠 | 用途 | 本輪驗收是否佔用 |
|---|---|---|
| **8022** | Django Student Portal（正式） | ❌ 未接管（PID 21360 原有服務持續運行） |
| 8030 | Live Backend（正式） | ❌ 未接管 |
| 8099 / 8101 | 本輪隔離驗收使用 | ✅ 僅驗收期間 |

---

## 三、後端啟動 — Live Backend（:8030）

### 3.1 前置條件

| 項目 | 要求 |
|---|---|
| Python | 3.12+ |
| 依賴 | `starlette==1.0.0`、`uvicorn==0.46.0`、`httpx==0.28.1` |
| 工作目錄 | `D:\FDE-AI-UAS-v2.0`（**專案根目錄**，非 `live_backend/`） |

### 3.2 啟動步驟

```bash
# 1. 切換至專案根目錄（重要：套件路徑為 live_backend.app.main）
cd D:\FDE-AI-UAS-v2.0

# 2. 設定環境變數
export FDE_VISION_CENTER_ROOT=D:\FDE-AI-UAS-data\vision-center
export FDE_DJANGO_PORTAL_URL=http://127.0.0.1:8022

# 3. 啟動服務
python -m uvicorn live_backend.app.main:app --host 127.0.0.1 --port 8030
```

### 3.3 環境變數說明

| 變數 | 預設值 | 說明 |
|---|---|---|
| `FDE_VISION_CENTER_ROOT` | `%LOCALAPPDATA%\FDE-AI-UAS\vision-center` | **Vision Center JSON Store 根目錄** |
| `FDE_DJANGO_PORTAL_URL` | `http://127.0.0.1:8022` | Django Portal 位址（代理轉發用） |

> 來源：`live_backend/app/main.py` 第 107、117 行。

### 3.4 驗證啟動成功

```bash
curl -s http://127.0.0.1:8030/api/v1/vision/submissions
# 期望：JSON 回應（submissions 清單）
```

---

## 四、兩個服務的連線設定（**必須一致**）

前端（Django）與後端（Live Backend）的位址**必須互相對齊**，否則 R07 提交失敗：

| 設定位置 | 變數 | 值 | 說明 |
|---|---|---|---|
| Django | `DJANGO_VISION_SUBMISSION_API_BASE_URL` | `http://127.0.0.1:8030` | Django → Live Backend |
| Live Backend | `FDE_DJANGO_PORTAL_URL` | `http://127.0.0.1:8022` | Live Backend → Django 代理 |

> **Django 端來源**：`student_portal/config/settings.py:223-224`，
> 預設 `http://127.0.0.1:8030`。
>
> **呼叫點**：`student_portal/learning/vision_submission.py:26`
> → `POST {BASE_URL}/api/v1/vision/submissions`

---

## 五、啟動順序建議

```
1. 啟動 Live Backend（:8030）
   ↓
2. 啟動 Django（:8022）
   ↓
3. 瀏覽器開啟 http://127.0.0.1:8022/
```

**原因**：Django 端對 Live Backend 的呼叫採**同步請求 + 30 秒 timeout**
（`DJANGO_VISION_SUBMISSION_API_TIMEOUT_SECONDS=30`）。
先啟動 Live Backend 可避免首位學員提交時遭遇冷啟動失敗。

---

## 六、常見啟動問題

| 症狀 | 原因 | 處理 |
|---|---|---|
| `RuntimeError: DJANGO_ALLOWED_HOSTS must be configured` | `DJANGO_DEBUG=false` 但未設 ALLOWED_HOSTS | 設定該變數或改用 `DJANGO_DEBUG=true` |
| `RuntimeError: DATABASE_URL must point to a durable production database` | 正式模式未設 DATABASE_URL | 設定 PostgreSQL 連線字串 |
| `ModuleNotFoundError: live_backend` | 在錯誤目錄啟動 Live Backend | 切換至專案**根目錄** |
| R07 提交顯示「模型提交失敗」 | Live Backend 未啟動或埠不符 | 確認 :8030 在線且兩端設定一致 |
| 學員登入後被彈回登入頁 | 瀏覽器殘留舊 session cookie | 清除 cookies 後重試 |
| `DJANGO_DEBUG=1` 無效 | 需為字面值 `true` | 設為 `DJANGO_DEBUG=true` |

---

## 七、本輪驗收的實際啟動參數（供對照）

本輪**未接管任何正式服務**。隔離驗收使用：

| 服務 | 埠 | 隔離設定 |
|---|---|---|
| Django | 8099 | `DJANGO_DB_NAME=.test-temp/acceptance-r24/db/acceptance.sqlite3`<br>`DJANGO_MEDIA_ROOT=.test-temp/acceptance-r24/media` |
| Live Backend | 8101 | `FDE_VISION_CENTER_ROOT=.test-temp/acceptance-r24/live-vision-store` |

詳細隔離證明見 `01-ISOLATION-REPORT.md`。

---

**本文件僅為操作說明，未執行任何部署。**
**人工 iPhone 驗收：PENDING**
