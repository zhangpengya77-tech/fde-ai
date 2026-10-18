# SYSTEM_ARCHITECTURE.md｜FDE-AI-UAS 2.0 系統架構

> 移交者：WorkBuddy ｜ 2026-10-14
> 依據：實測程式碼、`docs/reports/I*_Report.md`、I5-A 路由核對（PASS 33/33）

---

## 1. 整體拓撲

```
                        教師／學員瀏覽器（手機優先）
                                  │
                     http://192.168.1.114:8111（DEMO）
                                  │
                    ┌─────────────┴─────────────┐
                    │      Live Backend         │
                    │   Starlette :8111         │  ← 統一入口（I4 新增 /platform/）
                    │  live_backend/app/main.py │
                    └──┬───────┬───────┬───────┘
                       │       │       │
        /api/live/*    │       │       │  /api/rag/ask
        /api/downloads │       │       │
        /flight-health │       │       │
        /platform/* ───┼───────┼───────┼──→  Django :8110（透明代理）
                       │       │       │
              ┌────────┘       │       └──────────────┐
              ▼                ▼                      ▼
     ┌────────────────┐  ┌──────────┐        ┌──────────────┐
     │   Django 5.2   │  │   RAG    │        │  YOLO Vision │
     │ student_portal │  │   :8770  │        │    :8765     │
     │  （學員端／    │  │ 1105 docs│        │ 10 類別      │
     │   教師端／     │  └──────────┘        └──────────────┘
     │   學習工作台） │
     └───────┬────────┘
             │  growth_records / models / golden_set
             ▼
      SQLite（正式 db.sqlite3 / DEMO demo.sqlite3）
```

正式環境入口另有一組：Django `:8022`、RAG `:8770`（均為 127.0.0.1 監聽）。

---

## 2. 四大服務

### 2.1 Django（學員端 + 教師端 + 學習工作台）

| 項目 | 內容 |
|---|---|
| 位置 | `student_portal/` |
| 框架 | Django 5.2.17（venv：`.test-temp/django-venv`，Python 3.12.13） |
| 正式埠 | 8022 |
| DEMO 埠 | 8110（綁 `192.168.1.114`） |
| 設定 | `student_portal/config/settings.py` |
| 主要 app | `student_portal/learning/`（29 個模組） |

**learning app 關鍵模組**

| 檔案 | 職責 |
|---|---|
| `views.py` | 全部視圖（學員工作台、教師複核、班級報告、模型倉庫頁面） |
| `urls.py` | 路由（`student/`、`teacher/` 前綴） |
| `models.py` | TaskDefinition、StudentTaskProgress、PhaseProgress、GrowthRecord、VisionModelRecord 等 |
| `growth_records.py` | R01–R08 成長紀錄 |
| `growth_task_map.py` | 任務↔紀錄映射 |
| `external_modules.py` | 外部模組接口（I1 建立、I5 安全強化） |
| `golden_set.py` / `golden_set_guard.py` | Golden Set 與不可變保護 |
| `prop_scan.py` | 學員槳葉掃描（PROP_DIRECTION_V1） |
| `vision_*.py`（6 個） | R07 提交、規則模板、快照、完整性、驗證、倉庫、飛輪 |
| `survey_*.py` | 問卷、推薦 |
| `project_directions.py` | 專項方向（顯示「規劃中」徽章） |

### 2.2 Live Backend（AI Live Coach 統一入口）

| 項目 | 內容 |
|---|---|
| 位置 | `live_backend/` |
| 框架 | Starlette 1.0.0 + uvicorn 0.46.0 + httpx 0.28.1 |
| DEMO 埠 | 8111（綁 `192.168.1.114`） |
| 入口 | `live_backend/app/main.py` |

**路由族**

| 前綴 | 內容 |
|---|---|
| `/api/live/*` | Live Coach（31 條）：任務、字幕、TTS、session |
| `/api/rag/ask`、`/api/rag/health` | RAG 同源代理（手機端必要，I4/P0 新增） |
| `/api/downloads` | 下載中心 |
| `/api/v1/vision/*` | 視覺提交（R07 上傳鏈，只存檔不推論） |
| `/flight-health/`、`/downloads/`、`/live/` | 靜態／既有 Mount |
| `/platform/`、`/platform/{path}` | **Django 透明代理（I4 新增）** |

**關鍵模組**：`coach_ask.py`（AI 助教組裝答案）、`task_catalog.py` / `task_state.py`（F450 十二任務）、
`training_records.py`（訓練紀錄）、`download_center.py`、`mp12_state.py` / `mp12_catalog.py` / `mp12_models.py`、
`vision_center.py` / `vision_api.py`（視覺中心與 API）、`rag.py` / `rag_context.py` / `rag_guidance.py`、
`teacher_style.py`、`providers/`（AI provider 抽象）、`orchestrator.py`。

### 2.3 RAG 知識庫（:8770）

- hashed-char-ngram-2048 向量化，**1105 docs**
- Live Backend 預設上游 `http://127.0.0.1:8770`
- 上游不可用時 Live 明確降級為 503（I4-A 驗證 9/9 PASS）
- ⚠️ **只綁 127.0.0.1** → 手機無法直連，必須走 8111 的同源代理

### 2.4 YOLO Vision（:8765）

- 10 類別：`cw_propeller, ccw_propeller, flight_controller, motor, esc, gps_compass, receiver, battery, frame_arm, power_module`
- **目前未啟動**；DEMO 以 `FDE_DEMO_SIMULATED_INFERENCE=1` 走模擬推論
- 視覺任務目前僅 `PROP_DIRECTION_V1`（M1 右前／M2 左後／M3 左前／M4 右後）

---

## 3. 前端

| 位置 | 內容 |
|---|---|
| `src/` | SPA（vanilla JS）：`app.js`、`platform.js`、`router.js`、`platform-browser.js`、`rag-client.js`、`vision-client.js`、`course-definitions.js`、`styles.css` |
| `live/` | Live Coach 前端（`live.js`、`live.css`） |
| `student_portal/learning/static/learning/` | Django 端靜態（`portal.css`、`learning-path.css`、`teacher-*.css/js`） |
| `student_portal/learning/templates/learning/` | Django 模板（含 `student_learning_path.html`、`student_prop_scan.html`、`teacher_vision_center.html` 等） |

Node 測試 28 個 `.test.cjs`（`src/` + `live/`）。

---

## 4. 三組必須區分的概念（Codex 最易混淆）

### 4.1 F450 十二任務 ≠ F450 3D 數位孿生

| | 實作狀態 |
|---|---|
| **F450 十二任務** | **已可實際使用**。核心在 `live_backend/app/task_catalog.py` + `task_state.py`，Django 側 `TaskDefinition` / `StudentTaskProgress`，對應五階段工作台 |
| **F450 3D 數位孿生** | **獨立專案，僅預留接口**。在學習工作台只顯示「待接入／規劃中」徽章，**無連結**（測試以正則保證不可點） |

### 4.2 MP12 ≠ 獨立 MP 地面站

| | 實作狀態 |
|---|---|
| **MP12** | 已可實際使用（`live_backend/app/mp12_state.py` / `mp12_catalog.py` / `mp12_models.py`，12 個任務切片） |
| **MP_GROUND_STATION 外部模組** | **僅預留接口**（Mission Planner 獨立軟體），預設停用；教師側另有教師圖片測試頁可實際操作 |

### 4.3 YOLO 模型推論 ≠ R07 模型提交

| | 實作狀態 |
|---|---|
| **YOLO 模型推論** | 服務 `:8765` **未啟動**；DEMO 用模擬推論。正式推論**尚未收尾** |
| **R07 模型提交** | **已完成**：學員上傳 → Django `growth_model_upload` → `vision_submission.py` → Live `POST /api/v1/vision/submissions` → `VisionCenter.create_submission`（只存檔不推論）→ 教師審核 → 模型倉庫 → ACTIVE 發布／回滾 |

> ⚠️ **R07 提交鏈、教師審核、模型倉庫、ACTIVE 發布已完成，Codex 不得重新開發。**
> **尚未完成的是「學員端靜態圖片辨識前端」**（`urls.py` 無對應路由）與正式 `:8765` 真實推論。

---

## 5. 資料流（五階段 → 成長紀錄）

```
學員登入（Django :8110）
  → 五階段工作台 /student/learning-path/（views.py 學習路徑檢視）
  → F450 十二任務（Live Coach :8111 /api/live/*）
  → AI Live Coach：camera/語音 → ONE FRAME → coach_ask → 字幕 → TTS
  → RAG（:8770，經 8111 同源代理）
  → YOLO Vision（:8765，目前僅 DEMO 模擬）
  → R01–R08 成長紀錄（growth_records.py + growth_task_map.py）
  → 教師複核（/teacher/）
  → 班級成果 / 班級報告（P3、P5、P9）
  → 登出
```

外部模組（`MP_GROUND_STATION` / `HQGC_ASSESSMENT` / `F450_DIGITAL_TWIN`）在學習工作台以四態顯示，
**僅預留接口，預設停用，不代表已接入**。

---

## 6. 跨服務代理關係（I4 新增，I5-A 已核對）

`/platform/{path}` → `django_portal_proxy` → `http://127.0.0.1:8110`（`FDE_DJANGO_PORTAL_URL`）

- 請求側剝除 `host` / `connection` / `content-length` / `accept-encoding`
- 回應側剝除 `content-length` / `connection` / `transfer-encoding` / `content-encoding`，
  以 `get_list("set-cookie")` 逐條 append（**未改寫 `Domain`/`Path`/`Secure`** → 「全程只登入一次」的關鍵）
- `except httpx.HTTPError → 503`；逾時 15.0 秒
- 路由核對 PASS 33/33：`/platform/` 有 2 個 FULL match 但為同一 endpoint（Starlette `{x:path}` 可匹配空字串，
  與既有 `/login/`、`/student/`、`/teacher/` 形態完全相同）→ 無害重複，非覆蓋

**手機端同源必要性**：RAG `:8770` 只綁 127.0.0.1 → 手機無法直連 → 必須走 8111 的 `POST /api/rag/ask`。

---

## 7. 外部模組安全設計（I5 完成，禁止弱化）

- **IP Pinning**：`evaluate_entry_url()` 解析驗證後回傳單一 IP → `_probe_pinned(url, ip)` 以該 IP 建線，
  **連線過程 0 次 DNS 解析** → DNS 重綁（TOCTOU）無法命中內網
- **雙層檢查**：`_static_url_problem()`（不需 DNS：scheme、帳密、敏感參數、reserved hostname、
  數字型主機名、強制白名單、字面 IP）+ `_resolve_probe_target()`（DNS 後 IP 驗證）
- **白名單語意**：`FDE_EXTERNAL_MODULE_ALLOWED_HOSTS` 只管主機名，**不授予內網存取能力**；
  內網放行只能由 `FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS`（**精確比對、無通配符、預設空**）提供
- **fail-closed**：DNS 解析失敗 → `DNS_FAILED`，不探測
- **TLS 保留**：`_PinnedHTTPSConnection` 以 `ssl.create_default_context()` + 原主機名 SNI
- **診斷碼不給學員**：`DIAG_*` 為教師專用，學員模板只渲染 `status_key/url/name/state/note`
