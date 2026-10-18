# FDE-AI-UAS 2.0｜明日教學前最終收尾報告（P0 優先、功能凍結）

**報告日期**：2026-10-17
**執行範圍**：教學交付收尾模式（功能凍結）
**核心目標**：學員可登入並上傳真實 YOLO `best.pt` → 教師可審核並以真實模型驗證 → 提供學員可存取之臨時 2.0 網址
**基準 HEAD**：`e5c044244475d18930f32e26696d2cf9cf43dfa6`（分支 `fde-ai-v2.0-dev`，**本輪未新增任何 commit**）
**本輪修改的追蹤檔案**：**0 個**（本輪僅新增未追蹤的驗收腳本、隔離 DEMO 測試資料與本報告）

---

## 一、明日教學準備狀態

**結論：部分就緒（核心 P0 鏈已通過真實驗證；有 1 項操作前提必須遵守、1 項非阻擋缺口）**

| 判斷依據 | 狀態 |
|---|---|
| 學員真實登入 | ✅ 已驗證（真實 HTTP session，見 §7 A1–A3） |
| 學員真實 `best.pt` 上傳 | ✅ 已驗證（5,503,222 bytes 真實 YOLO 模型，A6–A10） |
| 後端檔案實際存在且可讀 | ✅ 已驗證（MEDIA 落地 + SHA256 與來源一致，A8） |
| 教師看到同一筆提交 | ✅ 已驗證（B2、B4） |
| 教師真實模型格式／相容性檢查 | ✅ 已驗證（ultralytics 真實載入 + 煙霧推論 → `VALIDATED`，B5） |
| 真實 YOLO 推論 | ✅ 已執行並取得真實結果（B6）；⚠️ **非** Live 攝影機推論服務（`:8765` 未啟動） |
| 未自動批准／未自動切 ACTIVE | ✅ 已驗證（B8） |
| 臨時網址 | ✅ 已驗證（`http://192.168.1.114:8111/`，C1） |
| **操作前提** | ⚠️ 學員註冊時「本期專案方向」**必須選「AI 目標檢測與模型訓練」**（值 `ai_flight_assessment`），否則 R07 上傳會被閘門擋下 |
| **非阻擋缺口** | ⚠️ `:8765` 真實 YOLO 服務未啟動 → Live 攝影機即時辨識不可用（R07 模型審核**不受影響**） |

> 明日要使用 ≠ 可把未驗證項目寫成已完成。上述每一格都有對應的實測證據或明確標示未驗證。

---

## 二、學員 best.pt 上傳流程（P0-A）

### 2.1 代碼入口與介面

| 層 | 位置 |
|---|---|
| 頁面入口 | `/student/` → `/student/growth/` → `/student/courses/<enrollment_id>/growth/` → `.../growth/R07/` |
| 表單 | `student_portal/learning/forms.py::GrowthModelForm`（欄位 `model_file`，`accept=".pt"`，上限 100 MB） |
| 視圖 | `student_portal/learning/views.py::growth_model_upload`（第 1189 行） |
| 路由 | `learning/urls.py:34` → `student/courses/<int:enrollment_id>/growth/R07/model/`（POST，`multipart/form-data`） |
| 跨服務呼叫 | `student_portal/learning/vision_submission.py::submit_model_evidence_to_vision` → Live Backend `POST /api/v1/vision/submissions` |

### 2.2 資料流（實測）

```
學員 POST best.pt
  → Django 建 Evidence（evidence_type=model）＋ 寫入隔離 MEDIA
  → POST 至 Live Backend /api/v1/vision/submissions（同源 :8111）
  → VisionCenter.create_submission 寫入 submission.pt ＋ JSON store 紀錄
  → Django 回寫 processed_metadata.vision_submission_id（雙向 binding）
  → R07 狀態 not_started → in_progress（等待教師審核，非「已完成」）
```

### 2.3 儲存位置（DEMO 隔離，與正式完全分離）

| 內容 | 路徑 |
|---|---|
| Django MEDIA | `demo/runtime/media/evidence/<uuid>/<hash>.pt` |
| Live 提交副本 | `demo/runtime/vision-center/submissions/prop_direction/<sub-id>/submission.pt` |
| 提交紀錄 | `demo/runtime/vision-center/vision_center.json` → `submissions[]` |
| DEMO DB | `demo/runtime/db/demo.sqlite3`（**非** `student_portal/db.sqlite3`） |

### 2.4 真實測試結果

以教師授權之**專用測試帳號** `demo.student02@fde-demo.local`（Enrollment #2、組別 DEMO-B）上傳真實 YOLO 模型：

| 項目 | 實測值 |
|---|---|
| 檔名 / 大小 | `best.pt` / 5,503,222 bytes |
| 落地檔 SHA256 | 與來源一致（`df14a190…` 檔名即為內容雜湊） |
| Evidence | `ac03f4c1-d02e-497c-8aa4-07df3509667b` |
| Live submission | `sub-d20f79cf-ae41-445c-ab1f-20b6b120292e`（`status=IMPORTED`） |
| R07 狀態 | `in_progress` |

**錯誤情境（皆實測）**

| 情境 | 結果 |
|---|---|
| 非 `.pt`（`notes.txt`） | 拒絕並提示「模型格式無效／模型提交失敗」；**Evidence 數未增加**（2→2） |
| 檔案過大（101 MB > 100 MB） | 拒絕並提示；Evidence 與狀態皆未變動 |
| Vision 服務中斷（`override_settings` 指向不可達位址） | 提示「模型提交失敗，請確認 Vision 服務後重試。」＋**完整回滾**（0 Evidence、0 殘檔、狀態不變） |

---

## 三、教師審核與模型驗證（P0-B）

### 3.1 沿用的既有機制（**未建立任何第二套流程**）

| 機制 | 實作位置 | 狀態 |
|---|---|---|
| R07 提交 | `views.py::growth_model_upload` | 沿用 |
| Evidence / Submission | `learning.models.Evidence`、`VisionCenter.submissions` | 沿用 |
| 教師審核 | `/teacher/vision-models/<evidence_id>/`＋`review/`（POST） | 沿用 |
| 模型候選 | `/teacher/vision-models/<evidence_id>/catalogue/` | 沿用 |
| 真實驗證 | `VisionCenter.upload_model`（`UltralyticsModelValidator`） | 沿用 |
| ACTIVE / 回滾 | `VisionCenter.activate_model` / `rollback_model` | 沿用，**本輪未觸發** |

### 3.2 審核入口（實測渲染）

| 路徑 | 結果 |
|---|---|
| `/teacher/vision-models/` | 200，可見 `DEMO-STU-0002` 的提交 |
| `/teacher/vision-models/<evidence_id>/` | 200，按鈕「列為候選」「退回補件」「收藏（尚不可用）」 |
| `/teacher/vision-models/<evidence_id>/review/` | 405 on GET（**POST-only，正確**） |
| `/teacher/vision-models/<evidence_id>/verify/` | 200，按鈕「執行測試」→ `verify/run/` |
| `/teacher/vision-center/` | 200（四場景切換主畫面） |

> 本輪**未代替教師執行「列為候選」或「退回補件」**，亦未執行任何 ACTIVE 切換 — 審核決定屬教師權責。

### 3.3 真實驗證證據（**非 Mock、非模擬**）

| 驗證 | 方法 | 真實結果 |
|---|---|---|
| 模型格式／相容性 | Live Backend 進程內 `from ultralytics import YOLO` 載入 + 64×64 煙霧推論 | `validation_status = VALIDATED`、`status = VALIDATED`（**未自動 ACTIVE**） |
| 真實推論 | `POST /api/v1/vision/models/<id>/validate-image`（真實 ultralytics `predict`） | `detection_count = 0`、`decision = INSUFFICIENT_DATA`、`reason_code = NO_DETECTION` |
| 負向（假 `.pt`） | 3,800 bytes `PK\x03\x04` + 填充 | **422 `import_failed: ultralytics_model_load_or_smoke_inference_failed`** → 明確拒絕 |

> 說明：`detection_count = 0` 是**真實推論的誠實結果**（測試影像為非螺旋槳場景圖）。此項證明「推論管線真的跑起來並回傳結果」，**不**宣稱模型對槳葉方向有辨識能力。真實辨識能力需教師以實際槳葉照片驗證。

### 3.4 ACTIVE 與回滾狀態

| 項目 | 驗證前 | 驗證後 |
|---|---|---|
| `PROP_DIRECTION` ACTIVE | `PROP_20261010_X_accv2_23fd` | **不變** |
| `FOUR_SIDE_HOVER` ACTIVE | `HOVER_20261010_X_haccv1_abc8` | **不變** |
| 版本歷史 | — | 35 筆可追溯 |
| 回滾目標（ARCHIVED + VALIDATED） | — | 16 筆存在（回滾能力完整） |

---

## 四、臨時 2.0 網址（P0-C）

### 4.1 完整 URL

| 用途 | URL |
|---|---|
| **學員統一入口（首頁）** | `http://192.168.1.114:8111/` |
| **學員登入** | `http://192.168.1.114:8111/login/` |
| 學員自助註冊 | `http://192.168.1.114:8111/register/` |
| R07 上傳頁 | `http://192.168.1.114:8111/student/courses/<enrollment_id>/growth/R07/` |
| **教師登入** | `http://192.168.1.114:8111/teacher/login/` |
| 教師審核清單 | `http://192.168.1.114:8111/teacher/vision-models/` |

**為何只需一個網址**：Live Backend `:8111` 已內建對 Django 的透明代理（`/login/`、`/student/`、`/teacher/`、`/courses/`、`/evidence/`、`/platform/`、`/static/`），瀏覽器來源全程維持同一 origin，不依賴 `127.0.0.1` 或 `:8022`。

### 4.2 適用網路範圍

- **僅限教室／同一區網**（情況一）。
- 伺服器 WLAN `192.168.1.114/24`，網路類別 `Public`，防火牆三設定檔（Domain/Private/Public）**皆為關閉**。
- 學員裝置需與伺服器同網段（`192.168.x.x`）。
- **不含**外部網路存取：無公網入口／域名／HTTPS／路由，**未**修改 Cloudflare、Gateway、DNS、路由器。**不宣稱已上線公網。**

### 4.3 實際訪問驗證結果

| 檢查 | 結果 |
|---|---|
| `:8111/` | 200 |
| `:8111/login/` | 200（含帳密欄位） |
| `:8111/teacher/login/` | 200 |
| `:8111/platform/` | 200 |
| 未登入存取 `/student/` | 302 → `/login/?next=/student/`（**導回同一 origin**，非 127.0.0.1） |
| 未登入存取 `/teacher/vision-center/` | 302 → `/teacher/login/?next=...`（同 origin） |

> **驗證來源限制（誠實聲明）**：以上驗證由**本機以 LAN IP** 發出，等同同網段裝置的網路路徑；**尚未由第二台實體手機／學員裝置實測**。此項標示為「待學員裝置複驗」。

### 4.4 服務依賴

`http://192.168.1.114:8111/` 一個網址即涵蓋：Live Backend（`:8111`，含 SPA 首頁與 Vision API）＋ Django DEMO（`:8110`，經代理）。**R07 上傳鏈不需要** `:8765`、`:8770`、`:8040`。

### 4.5 重啟後的可用性

- 重啟指令（PowerShell，需繞過腳本執行原則）：
  `powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\FDE-AI-UAS-v2.0\demo\tools\start_demo.ps1`
- 啟動後狀態寫入 `demo/runtime/state/demo-services.json`；`start_demo.ps1` 會實際 HTTP 健康檢查 6 個頁面。
- **風險**：若 DEMO 服務是由互動式工作階段啟動，該工作階段結束可能連帶終止服務（視啟動方式是否 `DETACHED_PROCESS`）。**建議明早開課前先執行啟動腳本並確認狀態檔**。
- 現況（本報告產出時）：`:8110`／`:8111`／`:8040` 皆在線，狀態檔 `started_at = 2026-10-17T07:34:59+08:00`；`:8040` 的狀態檔 PID（10536）已過期，實際為 21468（不影響運作，`stop_demo.ps1` 有埠持有者兜底）。

### 4.6 停止方式與風險

`powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\FDE-AI-UAS-v2.0\demo\tools\stop_demo.ps1`

- 只停止**狀態檔記錄的 PID**（且必須是 `python` 程序）＋ `8110/8111/8040` 的埠持有者（同為 python）。
- **不會**依埠號盲目終止其他服務；正式 `:8022`、`:8770` 全程不受影響。
- 停止後 DEMO DB 與展示資料完整保留。

---

## 五、服務狀態（P0-D，實際健康檢查）

| 服務 | 埠 / 監聽 | 健康檢查 | 判定 |
|---|---|---|---|
| Django DEMO | `192.168.1.114:8110` | `/login/` 200、`/teacher/login/` 200 | ✅ 可訪問且功能可用 |
| Live Backend（統一入口） | `192.168.1.114:8111` | `/api/live/health` → `live_backend: online`；`/api/v1/vision/models` 200 | ✅ 可訪問；Vision 子系統標示 `offline`（因 `:8765` 未啟動） |
| Vision Center（模型倉庫/審核） | 內嵌於 `:8111` | 教師 API 200；真實 ultralytics 載入與推論成功 | ✅ 可訪問且**真實模型推理成功** |
| Flight Health | `0.0.0.0:8040` | `/api/v1/health` → `{"status":"ok"}` | ✅ 可用（本次教學非必要依賴） |
| **YOLO 推論服務** | `:8765` | 連線失敗（`000`） | ❌ **未啟動** — Live 攝影機即時辨識不可用；**不影響 R07 上傳與教師模型審核** |
| RAG | `127.0.0.1:8770` | 埠在聽，`/health` 404 | ⚠️ 服務在線但健康端點不符；本次教學非必要依賴 |
| 正式 Django | `127.0.0.1:8022` | `/login/` 200（僅探測） | ⚪ **未觸碰**（PID 於本輪期間由 18820 變為 22492，非本人操作） |
| 原始 Flight Health 診斷主機 | `127.0.0.1:8051` | 連線失敗 | ⚪ 未觸碰（只讀邊界） |

> 「服務已啟動」與「真實推理成功」已分別判定，未以啟動腳本輸出作為唯一依據。

---

## 六、修改檔案與變更範圍

### 6.1 產品程式碼

**本輪修改：0 個檔案。** 未修改任何前端、後端、設定、路由、模板或遷移檔。

> 依教師「功能凍結」與「最小修改」原則，盤點後未發現阻擋明日教學的 P0 缺陷，故未進行任何產品程式碼變更。

### 6.2 本輪新增（僅驗收資產與隔離測試資料）

| 檔案 / 路徑 | 用途 | 性質 |
|---|---|---|
| `.test-temp/accept_r07_teacher_validation.py` | R07 端到端驗收（20 項） | 新增測試腳本 |
| `.test-temp/accept_r07_error_paths.py` | 錯誤情境驗收（2 項） | 新增測試腳本 |
| `.test-temp/r07_accept_result.json`、`r07_error_result.json` | 逐項結果 | 測試輸出 |
| `.test-temp/fixtures/r07_accept_best.pt`、`r07_accept_fake.pt` | 測試夾具（複製自 DEMO 倉庫模型／人工假檔） | 測試夾具 |
| `demo/backup/demo-before-student02-20261017-080152.sqlite3` | 建立測試帳號前的 DEMO DB 備份 | 既有工具自動產生 |
| `demo/runtime/**`、`demo/runtime/vision-center/vision_center.json` | 隔離 DEMO 的測試資料（提交／模型紀錄） | 隔離資料 |
| `~/.fde-demo-credentials/demo.student02.password.txt` | 測試帳號憑證（0600） | 憑證檔（未入庫） |
| `docs/reports/TEACHING_READINESS_FINAL_CLOSURE_2026-10-17.md` | 本報告 | 交付文件 |

### 6.3 為驗收而建立的隔離 DEMO 紀錄（可追溯、可清理）

| 類型 | 內容 |
|---|---|
| 測試帳號 | `demo.student02@fde-demo.local`（FDE ID `DEMO-STU-0002`、Enrollment #2、組別 DEMO-B、方向 `ai_flight_assessment`） |
| Django Evidence | 4 筆（2 筆真實 5.5 MB、2 筆 3,800 bytes 假檔），皆屬 Enrollment #2 |
| Live submissions | 4 筆：`sub-a18a58c1…`(IMPORTED)、`sub-f34d34ee…`(REJECTED)、`sub-d20f79cf…`(IMPORTED)、`sub-2d45998b…`(REJECTED) |
| 候選模型 | `PROP_20261017_DEMO-B_accv1`(VALIDATED)、`PROP_20261017_DEMO-B_accv1_af23`(VALIDATED) |
| 被拒模型 | `PROP_20261017_DEMO-B_accv1_7612`(REJECTED)、`PROP_20261017_DEMO-B_accv1_47b8`(REJECTED) |

> 全部為 **DEMO 隔離資料**，未觸及正式 DB／正式 Vision Center（`%LOCALAPPDATA%\FDE-AI-UAS\vision-center` 僅檢視存在性）。
> 清理方式：`python demo/tools/add_demo_student02.py --reset-r07`（僅重置該測試帳號的 R07）。

---

## 七、測試結果（逐項）

### 7.1 P0-A / P0-B 端到端（`accept_r07_teacher_validation.py`）— **20/20 PASS**

| ID | 項目 | 結果 |
|---|---|---|
| A1 | 學員登入頁可達且含帳密欄位 | PASS |
| A2 | 學員真實登入成功 | PASS |
| A3 | 學員首頁顯示學員編號 | PASS |
| A4 | R07 任務卡可達且含上傳表單 | PASS |
| A5 | 非 `.pt` 被拒並提示，Evidence 未增加 | PASS |
| A6 | 真實 `best.pt` 上傳成功並顯示成功訊息 | PASS |
| A7 | 後端確實建立 Evidence | PASS |
| A8 | 檔案落地隔離 MEDIA 且 SHA256 一致 | PASS |
| A9 | Evidence 記錄 `vision_submission_id` | PASS |
| A10 | R07 狀態為 `in_progress`（非「已完成」） | PASS |
| B1 | 教師真實登入成功 | PASS |
| B2 | 教師清單可見學員提交 | PASS |
| B3 | 教師視覺模型中心可達 | PASS |
| B4 | Live 端可追溯同一筆提交 | PASS |
| B5 | **真實模型格式／相容性檢查 → VALIDATED** | PASS |
| B6 | **真實 YOLO 推論已執行** | PASS |
| B7 | 假 `.pt` 於驗證階段被明確拒絕 | PASS |
| B8 | ACTIVE 未被自動切換 | PASS |
| B9 | 版本歷史可追溯且回滾目標存在 | PASS |
| C1 | 統一入口各入口可達 | PASS |

### 7.2 錯誤情境（`accept_r07_error_paths.py`）— **2/2 PASS**

| ID | 項目 | 結果 |
|---|---|---|
| E1 | 檔案過大（101 MB）被拒、無殘留 | PASS |
| E2 | Vision 服務中斷 → 明確提示 + 完整回滾 | PASS |

### 7.3 回歸測試

| 套組 | 指令 | 結果 |
|---|---|---|
| Live Backend 視覺（unittest） | `python -m unittest test_vision_center test_vision_api test_vision test_teacher_vision_center test_p1_model_submission test_vision_snapshot_server`（cwd `live_backend/tests`） | **86/86 OK**（277 s） |
| Node 前端 R07／入口 | `node --test live/vision-submission-ui.test.cjs live/vision-center-ui.test.cjs src/platform-integration.test.cjs src/homepage-portal-entry.test.cjs src/mobile-p0-entry.test.cjs` | **10/10 pass, 0 fail** |
| Django learning（R07／視覺／成長紀錄） | 逐模組 `manage.py test learning.tests.<module>`（7 個模組，各自 `timeout 240`） | **168/169 通過、1 既有失敗**（見下表） |

**Django 逐模組明細**（原始日誌：`.test-temp/django_reg/<module>.log`）

| 模組 | 測試數 | 結果 |
|---|---|---|
| `test_growth_records` | 36 | **OK**（56.1 s） |
| `test_project_directions` | 21 | **OK**（28.3 s；日誌中 `RuntimeError: vision unavailable` 為該套組**刻意 mock 的失敗路徑**，非缺陷） |
| `test_teacher_vision_center_page` | 34 | **OK**（96.0 s） |
| `test_vision_model_center` | 13 | **OK**（68.5 s） |
| `test_vision_repository` | 33 | **OK**（195.5 s） |
| `test_student_prop_scan_page` | 21 | **OK**（64.4 s） |
| `test_vision_flywheel_framework` | 11 | **FAILED (failures=1)** — 見下 |

**唯一失敗項（既有歷史基準，非本輪產生）**

- 測試：`test_teacher_sees_only_authorized_models_with_four_status_dimensions`
- 斷言：`AssertionError: False is not true : Couldn't find '訓練用途' in the following response`
- 歸屬：`/teacher/vision-models/`（**舊頁**，標「進階」），與本輪 R07／四場景視覺中心路徑無關。
- 處理：**未修改、未跳過、未改斷言**。此項與 2026-10-14 重跑基準一致（該次亦為 2 項既有失敗之一），本輪如實列出，交由教師裁決是否納入後續修復。

**未通過／未驗證項（如實列出）**

| 項目 | 說明 |
|---|---|
| 第二台實體學員裝置實測 | **未驗證** — 本輪僅由本機以 LAN IP 驗證網路路徑 |
| `:8765` Live 攝影機真實辨識 | **未驗證** — 服務未啟動 |
| 教師實際核准／退回動作 | **未執行** — 依安全邊界保留給教師 |
| ACTIVE 切換與回滾實作 | **未觸發** — 僅驗證「未自動切換」與「回滾目標存在」 |
| `test_vision_flywheel_framework`「訓練用途」欄 | 已知既有失敗（歷史基準，屬 `/teacher/vision-models/` 舊頁），本輪未修改 |

---

## 八、尚未解決的 P0

| # | 項目 | 是否阻擋明日教學 | 替代方案 |
|---|---|---|---|
| 1 | **學員註冊方向必須選對** — 未選「AI 目標檢測與模型訓練」(`ai_flight_assessment`) 者，R07 上傳會被擋（訊息：此專業方向不開放模型成果上傳） | **是（操作前提）** | 教師於註冊前明確指示方向選項；或課前以 `demo/tools/add_demo_student02.py` 模式批次建立正確方向的帳號 |
| 2 | 既有 DEMO 學員 `demo.student01` 的 R07 已為 `submitted`（唯讀），**無法再上傳** | 否（僅影響用該帳號示範） | 使用新帳號（如 `demo.student02`）；或教師執行「退回補件」使其可重傳 |
| 3 | `:8765` 真實 YOLO 服務未啟動 | **否** | R07 上傳與教師模型審核**不依賴** `:8765`（教師驗證走 Live Backend 進程內 ultralytics）。若明日需 Live 攝影機即時辨識，須另行啟動（來源：`C:\Users\admin\Documents\Codex\2026-08-30\new-chat\FDE-AI\api\yolo_server.py`，屬 v1.5C 倉，**需教師批准**） |
| 4 | `:8770` RAG `/health` 回 404 | 否 | 非本次教學核心路徑；如需要請另行確認 |
| 5 | 學員裝置實測未完成 | 否（風險項） | 開課前請以一支手機實連 `http://192.168.1.114:8111/` 確認 |

**無「阻擋明日教學且無替代方案」的 P0。**

---

## 九、安全與版本控制確認

| 項目 | 狀態 |
|---|---|
| Git commit | ❌ 未執行（HEAD 仍為 `e5c0442`） |
| Git push / merge / deploy | ❌ 未執行 |
| 本輪修改的追蹤檔 | **0 個** — 本輪僅新增**未追蹤**檔案（`.test-temp/` 驗收腳本、`docs/reports/` 報告） |
| 工作區既有追蹤檔變更 | 47 個 `M`（**全部為前序輪次遺留**，最近修改時間為今日 07:10–07:24，屬 Flight Health P0 前端與導航相關；本輪未觸碰、未提交） |
| 正式資料庫 | ❌ 未修改（`student_portal/db.sqlite3` 未開啟寫入） |
| 正式模型 / 正式 Vision Center | ❌ 未修改（`%LOCALAPPDATA%\FDE-AI-UAS\vision-center` 僅檢視） |
| 正式服務 `:8022` | ❌ 未觸碰（僅 HTTP 探測；其 PID 於期間變動為外部因素） |
| Migration / 新增資料表 | ❌ 未執行 |
| ACTIVE 切換 / 自動批准 | ❌ 未執行 |
| 解析核心 / YOLO 訓練演算法 / F450 12 任務核心 | ❌ 未修改 |
| Mock 冒充真實結果 | ❌ 未使用（B5/B6 皆為真實 ultralytics 執行；DEMO 的 `FDE_DEMO_SIMULATED_INFERENCE` 開關**未被本輪驗收引用為證據**） |
| 為通過測試而改斷言／跳過／偽造 | ❌ 未發生（首次執行 17/20，經查為測試腳本缺陷，修正腳本後 20/20，產品程式碼未動） |
| 其他 Agent 併行工作 | 已觀察到其他程序（`verify-ui-layout.mjs`、playwright、`P0_FLIGHT_HEALTH_929_CONTRACT_DIAGNOSIS_2026-10-17.md`），**未觸碰其檔案或程序** |

---

## 十、停止聲明

本輪收尾已完成教師指定之**狀態檢查、只讀盤點、阻擋項分類、P0 真實驗證、臨時網址驗證、回歸測試與交付報告**。

**現停止所有非必要開發**，不再擴展功能、不進入其他模組，**等待教師審查與明日使用**。

需教師決策之事項：
1. 是否核准啟動 `:8765` 真實 YOLO 服務（供 Live 攝影機即時辨識）。
2. 是否清理本輪於隔離 DEMO 產生的測試紀錄（清單見 §6.3）。
3. 是否需為明日班級批次建立學員帳號（並確認方向為「AI 目標檢測與模型訓練」）。
4. 是否將 §7.3 之 `test_vision_flywheel_framework` 既有失敗納入後續修復。
