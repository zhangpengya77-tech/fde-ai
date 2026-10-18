# FDE-AI-UAS 2.0 交付文件｜02 依賴清單

**文件版本**：v1.0（交付驗收階段產出）
**產出日期**：2026-10-09
**依據**：【正式交付驗收指令】第七條第 3 項
**資料來源**：實際讀取 `student_portal/requirements.txt`、`live_backend/requirements.txt`

---

## 一、Python 執行環境

| 項目 | 版本 | 說明 |
|---|---|---|
| **Python（Django 端）** | **3.12.13** | 本輪驗收實測版本 |
| **Python（Live Backend 端）** | 3.12+ | 建議與 Django 端一致 |
| 系統 Python（備用） | 3.14.4 | 未驗證 |

> **注意**：Django 5.2.17 支援 Python 3.10–3.13。
> 建議統一使用 **Python 3.12.x**，避免版本分歧。

---

## 二、Django Student Portal 依賴

**來源檔案**：`student_portal/requirements.txt`（實際內容，逐字）

```
Django==5.2.17
Pillow==12.2.0
pillow-heif==1.7.0
dj-database-url==3.1.2
psycopg[binary]==3.3.5
whitenoise==6.12.0
gunicorn==26.2.0; sys_platform != "win32"
```

### 2.1 各套件用途

| 套件 | 版本 | 用途 | 必要性 |
|---|---|---|---|
| **Django** | 5.2.17 | Web 框架本體 | **必要** |
| **Pillow** | 12.2.0 | 圖片處理（Golden Set 樣本、Evidence） | **必要** |
| **pillow-heif** | 1.7.0 | HEIF/HEIC 支援（iPhone 上傳照片） | **必要** |
| **dj-database-url** | 3.1.2 | 解析 `DATABASE_URL` | **必要** |
| **psycopg[binary]** | 3.3.5 | PostgreSQL 驅動 | 正式環境**必要**；SQLite 開發可不裝 |
| **whitenoise** | 6.12.0 | 靜態檔案服務 | 正式環境**建議** |
| **gunicorn** | 26.2.0 | WSGI 伺服器（**僅非 Windows**） | 正式環境**必要** |

> **Windows 注意**：`gunicorn` 因 `sys_platform != "win32"` 標記，
> **Windows 上不會安裝**。Windows 正式部署請改用
> `waitress` 或置於 IIS/Nginx 之後，或以 Linux 容器部署。

### 2.2 本輪驗收實際安裝版本（隔離 venv）

```
Python      3.12.13
Django      5.2.17
Pillow      12.2.0
pillow-heif 1.7.0
dj-database-url 3.1.2
psycopg     3.3.5
whitenoise  6.12.0
```

> 路徑：`D:\FDE-AI-UAS-v2.0\.test-temp\django-venv\`
> **本輪未對系統環境安裝或升級任何套件。**

---

## 三、Live Backend 依賴

**來源檔案**：`live_backend/requirements.txt`（實際內容，逐字）

```
starlette==1.0.0
uvicorn==0.46.0
httpx==0.28.1
```

### 3.1 各套件用途

| 套件 | 版本 | 用途 | 必要性 |
|---|---|---|---|
| **starlette** | 1.0.0 | ASGI 框架本體 | **必要** |
| **uvicorn** | 0.46.0 | ASGI 伺服器 | **必要** |
| **httpx** | 0.28.1 | 對 Django Portal 的 HTTP 代理 | **必要** |

### 3.2 本輪驗收實際使用

Live Backend 套件安裝於 WorkBuddy 隔離 venv：

```
路徑：C:\Users\admin\.workbuddy-ai\binaries\python\envs\default\
starlette 1.0.0 / uvicorn 0.46.0 / httpx 0.28.1
```

---

## 四、⚠️ 兩套依賴必須分開的環境

**重要**：Django 端與 Live Backend 端的依賴**互不包含**。

| | Django venv | Live Backend venv |
|---|---|---|
| Django / Pillow / psycopg | ✅ | ❌ |
| starlette / uvicorn / httpx | ❌ | ✅ |
| `pip` 可用性 | 本輪隔離 venv **無 pip**（預建） | 有 |

> **驗收時遇到過的實際問題**：在 Django venv 中匯入 `live_backend` 模組會
> 因缺少 `starlette` 而失敗。若需在測試中檢視 Live Backend 程式碼，
> 應改用 **AST 靜態分析**或**獨立 venv**，不要合併環境。

### 4.1 建議的部署佈局

```
環境 A（Django）：
  pip install -r student_portal/requirements.txt

環境 B（Live Backend）：
  pip install -r live_backend/requirements.txt
```

---

## 五、前端依賴

**結論：無需額外安裝。**

| 項目 | 狀態 |
|---|---|
| 前端框架 | **vanilla JS**（無 npm 依賴） |
| 前端測試 | `.test.cjs` 使用 Node.js 內建 `node:test` |
| 瀏覽器 | Chrome（驗收實測 155.0.8059.39） |
| 額外套件 | **無** |

> 依指令「優先使用現有 Chrome，**不新增依賴**」，
> 本輪瀏覽器驗收以**手寫 WebSocket CDP 客戶端**（純 Python 標準函式庫）
> 驅動 Chrome，**未安裝 Puppeteer / Playwright / Selenium**。
> 程式：`.test-temp/acceptance-r24/cdp.py`

---

## 六、選用依賴（依部署情境）

| 套件 | 用途 | 何時需要 |
|---|---|---|
| `waitress` | Windows WSGI 伺服器 | Windows 正式部署（替代 gunicorn） |
| `redis` / `django-redis` | 快取後端 | 需 `DJANGO_CACHE_BACKEND` 指向 Redis 時 |
| `ffmpeg` / `ffprobe`（**外部二進位**） | 成長影片處理 | 使用成長影片功能時 |

### 6.1 ffmpeg / ffprobe 說明

| 項目 | 狀態 |
|---|---|
| 設定變數 | `DJANGO_FFMPEG_BINARY=ffmpeg`、`DJANGO_FFPROBE_BINARY=ffprobe` |
| 本輪測試 | **未安裝 → 相關測試 SKIPPED**（見 `04-REGRESSION-SECURITY.md`） |
| 影響 | 成長影片產生功能**未經驗證（PENDING）** |

> **這是 26 個 SKIPPED 中「環境依賴」類的主要原因之一。**
> 若交付範圍包含成長影片，必須在目標環境安裝 ffmpeg 並重跑測試。

---

## 七、依賴安裝指令（參考，本輪未執行）

```bash
# Django 端
cd D:\FDE-AI-UAS-v2.0\student_portal
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt

# Live Backend 端（獨立環境）
cd D:\FDE-AI-UAS-v2.0
python -m venv .venv-live
.venv-live\Scripts\activate
pip install -r live_backend\requirements.txt
```

---

## 八、驗收遵循聲明

> 依【正式交付驗收指令】第一條第 1 項與專案安全規則 2：
> **「不新增依賴」「禁止擅自安裝/升級系統級環境」**

本輪：

| 動作 | 執行 |
|---|---|
| 對系統 Python 安裝套件 | ❌ **未執行** |
| 升級任何既有套件 | ❌ **未執行** |
| 變更 Python / Node 版本 | ❌ **未執行** |
| 修改浏覽器驅動 | ❌ **未執行** |
| 安裝 Puppeteer / Playwright | ❌ **未執行** |
| 使用既有隔離 venv | ✅ 僅讀取既有環境 |

---

**人工 iPhone 驗收：PENDING**
