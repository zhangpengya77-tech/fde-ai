# DEVELOPMENT_ENVIRONMENT.md｜開發環境與啟動方式

> 移交者：WorkBuddy ｜ 2026-10-14
> **本文件只記錄環境變數「名稱」與用途，不記錄任何密碼、Token、API Key、Cookie 值。**

---

## 1. 本機環境（Windows，2026-10-14 實測）

| 項目 | 值 |
|---|---|
| OS | Windows 11（家庭版，虛擬化未啟用、帳號非管理員 → **無可靠進程隔離手段**） |
| Python（Django venv） | 3.12.13，位於 `D:\FDE-AI-UAS-v2.0\.test-temp\django-venv\Scripts\python.exe` |
| Node | 系統另有 Node 22/24（`.test.cjs` 測試用） |
| 真實桌面 | `D:\OneDrive\圖片\桌面`（OneDrive 重導向；`C:\Users\admin\Desktop` 是殘留舊目錄，勿寫入） |
| OneDrive | `D:\OneDrive`（桌面在同步範圍 → **勿在桌面放明文密碼**） |

---

## 2. 依賴

### 2.1 Python

| 檔案 | 內容 |
|---|---|
| `live_backend/requirements.txt` | `starlette==1.0.0`、`uvicorn==0.46.0`、`httpx==0.28.1` |
| `student_portal/requirements.txt` | `Django==5.2.17`、`Pillow==12.2.0`、`pillow-heif==1.7.0`、`dj-database-url==3.1.2`、`psycopg[binary]==3.3.5`、`whitenoise==6.12.0`、`gunicorn==26.2.0`（僅非 Windows） |

### 2.2 虛擬環境

| venv | 用途 |
|---|---|
| `.test-temp/django-venv`（Python 3.12.13） | Django 5.2.17 測試與管理命令 |
| 系統 Python | 部分靜態腳本（如 `i5_route_check.py` 用系統 Python 3.14 + starlette） |

### 2.3 測試規模

- `live_backend/tests/`：48 個測試檔
- `student_portal/learning/tests/`：45 個測試檔（+ `baselines/`）
- `src/*.test.cjs` + `live/*.test.cjs`：28 個 Node 測試

---

## 3. 連接埠

| 埠 | 服務 | 綁定 | 狀態（2026-10-14） |
|---|---|---|---|
| 8022 | Django 正式（v1.5C 系） | 127.0.0.1 | LISTENING |
| 8770 | RAG | 127.0.0.1 | LISTENING |
| 8765 | YOLO 推論 | 127.0.0.1 | 未啟動 |
| 8110 | DEMO Django | 192.168.1.114 | 未啟動 |
| 8111 | DEMO Live Backend | 192.168.1.114 | 未啟動 |
| 9222 | Chrome CDP（自動化） | 127.0.0.1 | 未啟動 |
| 8197 / 8198 | I5 安全測試用哨兵（臨時） | 127.0.0.1 | 僅測試期間存在 |

---

## 4. 服務啟動順序

### 4.1 DEMO（推薦，唯一安全啟動方式）

```powershell
# 必須用 PowerShell 工具執行，並加 -ExecutionPolicy Bypass
powershell -ExecutionPolicy Bypass -File D:\FDE-AI-UAS-v2.0\demo\tools\start_demo.ps1
# 停止：stop_demo.ps1
```

`start_demo.ps1` 流程：埠檢查 → 隔離驗證（所有路徑必須在 `demo/` 之下）→ 依賴檢查 →
啟動 Django（8110）→ 啟動 Live Backend（8111）→ 健康檢查 → 開瀏覽器。
`demo/tools/demo_common.ps1` 的 `Set-DemoEnvironment` 負責設定全部環境變數。

> 🔴 **鐵律：永遠用 `start_demo.ps1`（或先跑 `Set-DemoEnvironment`），不要手動拼環境變數。**
> 手動啟動漏掉 `FDE_DEMO_SIMULATED_INFERENCE=1` 會導致 DEMO 退化去連未啟動的真實 YOLO `:8765`
> → 請求掛起 >30 秒 → iPhone Safari 拋 `TypeError: Load failed`（Chrome 只會自己超時，造成「Chrome PASS / iPhone FAIL」假象）。

### 4.2 Django（正式／手動）

```bash
cd D:\FDE-AI-UAS-v2.0\student_portal
# 設 DJANGO_DB_NAME 指向正式庫（預設 student_portal/db.sqlite3）
DJANGO_SETTINGS_MODULE=config.settings <venv>/python.exe manage.py runserver 8022
```

### 4.3 Live Backend

```bash
cd D:\FDE-AI-UAS-v2.0\live_backend
<venv>/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8111
```

### 4.4 RAG（:8770）／ YOLO（:8765）

既有 v1.5C 系服務，啟動方式屬保護區，詳見 v1.5C repo 文件；本輪未修改其設定。

---

## 5. 必要環境變數（名稱與用途）

### 5.1 Django 側（`student_portal/config/settings.py`）

| 名稱 | 用途 | 預設 |
|---|---|---|
| `DJANGO_SETTINGS_MODULE` | 設定模組 | `config.settings` |
| `DJANGO_DB_NAME` | SQLite 路徑（DEMO 用） | — |
| `DJANGO_DB_PATH` | **不被讀取**（誤用會靜默落到正式庫） | — |
| `DJANGO_MEDIA_ROOT` | 媒體根 | — |
| `DJANGO_DEBUG` | 除錯 | — |
| `DJANGO_ALLOWED_HOSTS` | 允許主機 | — |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | CSRF 信任來源 | — |
| `FDE_MODULE_<ID>_ENABLED` | 外部模組啟用（`=1`） | 空（停用） |
| `FDE_MODULE_<ID>_URL` | 外部模組進入網址 | 空 |
| `FDE_EXTERNAL_MODULE_PROBE_TIMEOUT_SECONDS` | 探測逾時 | 1.5 |
| `FDE_EXTERNAL_MODULE_PROBE_TTL_SECONDS` | 探測快取 TTL | 30 |
| `FDE_EXTERNAL_MODULE_ALLOWED_HOSTS` | 主機名信任清單（**非空時強制**；不授與內網能力） | 空 |
| `FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS` | 私網 IP 精確放行清單（**無通配符**） | 空 |
| `FDE_EXTERNAL_MODULE_PROBER` | **僅測試用**探測捷徑（優先於快取） | 未設 |
| `FDE_VISION_CENTER_ROOT` | 視覺中心根 | — |
| `FDE_DOWNLOAD_ROOT` | 下載中心來源 | 空 |
| `FDE_DJANGO_PORTAL_URL` | Live→Django 代理目標 | — |
| `DJANGO_VISION_SUBMISSION_API_BASE_URL` | R07 提交 API 基底 | — |

### 5.2 DEMO 專用（`demo/tools/demo_common.ps1`）

```
DJANGO_DB_NAME / DJANGO_MEDIA_ROOT / DJANGO_DEBUG / DJANGO_SETTINGS_MODULE
DJANGO_ALLOWED_HOSTS / DJANGO_CSRF_TRUSTED_ORIGINS
FDE_VISION_CENTER_ROOT / FDE_DOWNLOAD_ROOT
FDE_DJANGO_PORTAL_URL / DJANGO_VISION_SUBMISSION_API_BASE_URL
FDE_DEMO_SIMULATED_INFERENCE=1 / DJANGO_VISION_DEMO_SIMULATION_ENABLED=1
PYTHONNOUSERSITE=1 / PYTHONUTF8=1 / NO_PROXY=*
```

### 5.3 Live Backend 側（`live_backend/app/config.py`）

| 名稱 | 用途 | 預設 |
|---|---|---|
| `FDE_LIVE_YOLO_BASE_URL` | YOLO 上游 | `http://127.0.0.1:8765` |
| `FDE_LIVE_RAG_BASE_URL` | RAG 上游 | `http://127.0.0.1:8770` |
| `FDE_LIVE_RAG_TIMEOUT_SECONDS` | RAG 逾時 | 8.0 |
| `FDE_LIVE_VISION_HEALTH_TIMEOUT_SECONDS` | 視覺健康檢查逾時 | 3.0 |
| `FDE_LIVE_VISION_REQUEST_TIMEOUT_SECONDS` | 視覺請求逾時 | 20.0 |
| `FDE_LIVE_MAX_IMAGE_BYTES` | 圖片大小上限 | 8 MiB |
| `FDE_LIVE_DEV_MODE` | 開發模式 | 關 |

---

## 6. 健康檢查

```bash
# Django 正式
curl -s --noproxy '*' -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8022/login/   # 期望 200

# RAG（根路徑回應 JSON refuse 即正常）
curl -s --noproxy '*' http://127.0.0.1:8770/

# DEMO 健康檢查（start_demo.ps1 內建）
# pytest 回歸：見 TEST_BASELINE.md 的重現指令
```

---

## 7. 常見故障與排除

| 症狀 | 根因 | 處理 |
|---|---|---|
| iPhone Safari `TypeError: Load failed` | DEMO 缺 `FDE_DEMO_SIMULATED_INFERENCE=1` → 連未啟動的 :8765 掛起 | 用 `start_demo.ps1` 重啟，勿手動拼環境變數 |
| 「目前尚無可用模型 / Load failed」 | 同上 | 同上 |
| 登入失敗（電子郵箱或密碼錯誤） | `auth_user.username` 曾被改壞（不再等於種子 email） | 先查 `auth_user.username` 是否等於種子 email，再懷疑密碼；`demo/tools/fix_demo_accounts.py` 可就地還原 |
| `curl` 502 假陰性 | 系統代理 `http_proxy=127.0.0.1:64991` | 一律加 `--noproxy '*'`（或用 urllib `ProxyHandler({})`） |
| 手機 390px 版面溢出 | `.motor-check-grid` 桌面最小 520px | 已於 `@media (max-width:680px)` 改單欄；`.inspection-summary-panel` 改 `visible` |
| 沙箱內 PowerShell `Write-Output` 無輸出 | 工具不回傳 stdout | 改用 `Out-File` 後以 Read 讀取 |
| `wmic` 不存在 | 已移除 | 用 `Get-CimInstance Win32_Process` |
| 背景服務被殺 | 沙箱 tool 呼叫結束會終止子程序 | 用 Bash 工具 + `run_in_background: true` |
| `.ps1` 無法執行 | ExecutionPolicy = Restricted | 加 `-ExecutionPolicy Bypass -File` |
| 路徑寫入錯誤 | `C:\Users\admin\Desktop` 是殘留目錄 | 真實桌面 = `D:\OneDrive\圖片\桌面` |

---

## 8. 跨服務代理與外部模組安全配置

### 8.1 代理關係（I4）

`/platform/{path}` → Live Backend `django_portal_proxy` → `FDE_DJANGO_PORTAL_URL`（預設 `http://192.168.1.114:8110`）。
回應例外：`httpx.HTTPError → 503`；逾時 15.0 秒。`Set-Cookie` 逐條轉送不改寫 `Domain`/`Path`/`Secure`。

手機端 RAG 走 `POST /api/rag/ask`（8111 同源代理），因為 `:8770` 只綁 127.0.0.1。

### 8.2 外部模組安全配置（I5 完成，禁止弱化）

| 項目 | 規則 |
|---|---|
| IP Pinning | 解析驗證後回傳單一 IP 建線，連線過程 0 次 DNS；未釘選即 `raise OSError`，**不退回 hostname** |
| 白名單 | `FDE_EXTERNAL_MODULE_ALLOWED_HOSTS` 非空時強制，但**只判主機名，不授與內網能力** |
| 私網放行 | 只能由 `FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS` **精確比對（無通配符、預設空）** 提供 |
| metadata | `169.254.169.254` 與 `metadata.google.internal` 一律拒絕（含尾點變體、IDNA 正規化後） |
| DNS 失敗 | **fail-closed** → `DNS_FAILED`，不探測 |
| 憑證 | `_PinnedHTTPSConnection` 以 `ssl.create_default_context()` + 原主機名 SNI；**禁止關閉憑證驗證** |
| 重新導向 | 一律不跟隨 |
| 診斷碼 | `DIAG_*` 只給教師；學員模板只渲染 `status_key/url/name/state/note` |

### 8.3 安全測試工具

| 腳本 | 用途 |
|---|---|
| `demo/tools/verify_i5_security.py` | I5-B 13 項安全驗收（PASS 39/39），以 `CONNECT_TARGETS` 證明實際連線目標 |
| `demo/tools/verify_i4_security.py` | I4-C deny/allow 雙模式 |
| `demo/tools/i5_route_check.py` | I5-A 路由核對（33/33） |

---

## 9. 禁止在文件中記錄的秘密

交接文件一律不得出現：密碼、Token、API Key、Cookie 值、 session ID。
環境變數只記錄**名稱**。DEMO 有效密碼存量請查 `demo/runtime/` 下 `demo.shared.password.txt`
（**不要把值寫進任何 Markdown**）。
