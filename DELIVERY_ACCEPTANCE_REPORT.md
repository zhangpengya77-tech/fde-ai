# DELIVERY_ACCEPTANCE_REPORT

## FDE-AI-UAS 2.0 正式交付驗收報告

| 項目 | 內容 |
|---|---|
| **專案** | FDE-AI-UAS 2.0（FDE Live Coach） |
| **報告版本** | v1.0 |
| **驗收日期** | 2026-10-09 |
| **驗收性質** | **DELIVERY ACCEPTANCE（交付驗收，非功能開發）** |
| **工作目錄** | `D:\FDE-AI-UAS-v2.0` |
| **分支** | `fde-ai-v2.0-dev` |
| **HEAD** | `e5c044244475d18930f32e26696d2cf9cf43dfa6` |
| **驗收資產** | `D:\FDE-AI-UAS-v2.0\.test-temp\acceptance-r24\` |
| **交付等級** | **有條件交付（CONDITIONAL DELIVERY）** |

---

# A. Git 分支及工作區狀態

## A.1 分支與 HEAD

| 項目 | 值 | 驗收前 | 驗收後 |
|---|---|---|---|
| 分支 | `fde-ai-v2.0-dev` | 同 | **未變** |
| HEAD | `e5c044244475d18930f32e26696d2cf9cf43dfa6` | 同 | **未變** |
| Commit / Push / Merge | 未執行 | — | **未執行** |
| Deploy | 未執行 | — | **未執行** |

**驗證指令**：
```bash
git rev-parse --abbrev-ref HEAD   # → fde-ai-v2.0-dev
git rev-parse HEAD                # → e5c044244475d18930f32e26696d2cf9cf43dfa6
```

## A.2 未提交檔案（原有，**未動**）

`git status --porcelain` 共 **119 筆**未提交變更。

**已修改檔案（部分，`M`）**：

```
 M docs/verification/CLASSROOM_BROWSER_ACCEPTANCE.md
 M index.html
 M live/index.html
 M live/live-coach-simplified-ux.test.cjs
 M live/live.css
 M live/live.js
 M live/student-ux-voice-reply.test.cjs
 M live/task-ui.test.cjs
 M live_backend/app/coach_ask.py
 M live_backend/app/main.py
 M live_backend/app/sessions.py
 M live_backend/app/task_catalog.py
 M live_backend/app/task_state.py
 M live_backend/app/training_records.py
 M live_backend/tests/test_coach_ask.py
 M live_backend/tests/test_f450_live_loop.py
 M live_backend/tests/test_f450_task_catalog.py
 M live_backend/tests/test_training_records.py
 M src/app.js
 M src/platform-browser.js
 M src/rag-config.js
 M src/styles.css
 M student_portal/.env.example
 M student_portal/config/settings.py
 M student_portal/learning/forms.py
 M student_portal/learning/models.py
 M student_portal/learning/templates/learning/growth_record_detail.html
 M student_portal/learning/templates/learning/teacher_dashboard.html
 M student_portal/learning/templates/learning/teacher_student_detail.html
 M student_portal/learning/tests/test_project_directions.py
 M student_portal/learning/urls.py
 M student_portal/learning/views.py
```

**未追蹤檔案（部分，`??`）**：

```
?? .workbuddy-ai/
?? AGENTS.md
?? add_firewall_rules.ps1
?? docs/AI_HANDOFF.md
?? docs/DOWNLOAD_CENTER.md
?? docs/architecture/FDE-AI-UAS-2.0-SYSTEM-FRAMEWORK.md
?? docs/architecture/FDE-DEVELOPMENT-CHARTER.md
?? docs/architecture/vision-model-repository-migration-design.md
...
```

### A.2.1 處置聲明

> **依【正式交付驗收指令】第二條**：
> 「記錄所有原有未提交檔案。禁止 `git reset`、`git clean`、覆蓋或刪除既有工作。」

| 動作 | 執行 |
|---|---|
| `git reset` | ❌ **未執行** |
| `git clean` | ❌ **未執行** |
| 覆蓋既有工作 | ❌ **未執行** |
| 刪除既有檔案 | ❌ **未執行** |
| 記錄未提交檔案 | ✅ **本節已記錄** |

## A.3 本輪新增檔案（全部位於受控範圍）

| 位置 | 內容 | 性質 |
|---|---|---|
| `.test-temp/acceptance-r24/` | 驗收資產（報告、程式、資料） | 驗收產物 |
| `docs/delivery/` | 交付文件 10 份 | 交付文件 |
| `docs/handoffs/WORKBUDDY_TO_CODEX_P05.md` | 新增第 41 節 | 交接文件 |
| `DELIVERY_ACCEPTANCE_REPORT.md` | 本報告 | 驗收報告 |

> **未修改任何產品程式碼（`.py` / `.js` / `.html`）。**

## A.4 凍結規則遵循總表

| # | 規則 | 遵循 | 證據 |
|---|---|---|---|
| 1 | 不開新功能分支 | ✅ | 分支未變 |
| 2 | 不新增功能模組 | ✅ | 未寫入產品程式碼 |
| 3 | 不重構現有架構 | ✅ | 未修改任何 `.py` |
| 4 | 不修改正式資料庫 | ✅ | DB sha256 未變（見 B.4） |
| 5 | 不進行 YOLO 訓練 | ✅ | 未執行 |
| 6 | 不執行未受信任 `best.pt` | ✅ | 反序列化命中數 = 0（見 G.6） |
| 7 | 不啟用 ACTIVE | ✅ | `active_models=[]`（見 G.5） |
| 8 | 不修改 v1.5C | ✅ | 未觸碰 |
| 9 | 不接管 8022 / 8023 / 8030 | ✅ | 未接管（見 B.5） |
| 10 | 不 Commit / Push / Merge / Deploy | ✅ | HEAD 未變 |

---

# B. 環境隔離證據

## B.1 隔離環境總覽

全部建於 `.test-temp/acceptance-r24/`：

| 項目 | 路徑 | 用途 |
|---|---|---|
| **隔離 DB** | `db/acceptance.sqlite3` | 獨立資料庫（含 `0016`–`0019`） |
| **隔離 MEDIA** | `media/` | 獨立媒體儲存 |
| **隔離 JSON Store** | `vision-store/`、`live-vision-store/` | 獨立 Vision Center 儲存 |
| **隔離 Django** | `http://127.0.0.1:8099` | 獨立服務埠 |
| **隔離 Live Backend** | `http://127.0.0.1:8101` | 獨立服務埠 |
| 測試帳號 | 驗收學員 `FDE-26-A7NKZP`、Teacher-A、Teacher-B | 獨立帳號 |

## B.2 隔離驗證（逐項對照指令第三條）

| # | 要求 | 驗證方法 | 結果 |
|---|---|---|---|
| 1 | 原始 DB 只讀取與複製 | `cp` 複製，未改原件 | ✅ |
| 2 | 新副本驗證來源及目的地 | 比對路徑 | ✅ |
| 3 | 使用獨立 MEDIA_ROOT | `settings.MEDIA_ROOT` 實測 | ✅ |
| 4 | 使用獨立 JSON Store | `FDE_VISION_CENTER_ROOT` 實測 | ✅ |
| 5 | 不指向正式服務資料目錄 | 路徑比對 | ✅ |
| 6 | 驗證 `connection.settings_dict["NAME"]` | Django shell 實測 | ✅ |
| 7 | 驗證實際 MEDIA_ROOT | Django shell 實測 | ✅ |
| 8 | 驗證 JSON Store 實際寫入位置 | 寫入後比對 mtime | ✅ |
| 9 | Migration 只在隔離副本套用 | 正式 DB 仍為 `0015` | ✅ |
| 10 | 保留前後 SHA256 與差異報告 | 見 B.4 | ✅ |

**隔離性已可證明。**

## B.3 正式環境關鍵事實（驗收發現）

| 項目 | 實際狀態 |
|---|---|
| 正式 DB 最後 migration | **`0015_studentsurvey_survey_version_and_more`** |
| `0016` / `0017` / `0018` / `0019` | **從未套用** |
| `learning_visionmodelrecord` 表 | **不存在** |
| `learning_goldenset` / `learning_goldensetsample` 表 | **不存在** |

> **⚠️ 這是交付阻斷級事實**：正式環境**目前無法使用**
> Vision Model Repository 與 Golden Set 功能。

## B.4 SHA256 前後比對（正式資源保護證明）

| 資源 | 驗收前 sha256 | 驗收後 sha256 | 判定 |
|---|---|---|---|
| `student_portal/db.sqlite3` | `1fa462fef825980eb1808cc7f3535d336240c41b91ebc440031d156d9c19c133` | 同 | ✅ **未變** |
| `vision_center.json` | `7b3f674fbca0e6a13f2f154d5dddd926ecc9506e486926d3009ee5ae02615c36` | 同 | ✅ **未變** |

| 資源 | 驗收前 mtime | 驗收後 mtime | 判定 |
|---|---|---|---|
| 正式 DB | `2026-10-07 19:08:32` | `2026-10-07 19:08:32` | ✅ **未變** |
| 正式 JSON Store | `2026-10-08 12:37:51` | `2026-10-08 12:37:51` | ✅ **未變** |

## B.5 既有服務未被接管

| 服務 | PID | 驗收前 | 驗收後 | 判定 |
|---|---|---|---|---|
| 8022（Django 正式） | 21360 | LISTENING | LISTENING | ✅ **未接管** |
| 8770（RAG） | 14640 | LISTENING | LISTENING | ✅ **未接管** |
| 8030（Live Backend 正式） | — | — | — | ✅ **未接管** |

> 驗收服務使用 **8099**（Django）與 **8101**（Live Backend），
> **與正式埠完全區隔**。

---

# C. 前端 Chrome 驗收

## C.1 驗收方式

| 項目 | 內容 |
|---|---|
| **瀏覽器** | **真實 Chrome 155.0.8059.39**（`--headless=new`） |
| **驅動方式** | **手寫 CDP（Chrome DevTools Protocol）客戶端** |
| **驅動程式** | `.test-temp/acceptance-r24/cdp.py`（**純標準函式庫**） |
| **新增依賴** | **無**（符合「優先使用現有 Chrome，不新增依賴」） |
| **截圖** | **34 張**，存於 `screenshots/` |

> **⚠️ 本驗收不是 Django Test Client。**
> 全部經由真實瀏覽器 DOM 操作與畫面文字判讀。
>
> **依指令：「不得把 Django Client 測試當成真實瀏覽器測試」——已遵守。**

## C.2 驗收結果總表

| 系列 | 內容 | PASS | FAIL | BLOCKED | PENDING |
|---|---|---:|---:|---:|---:|
| **A** | 學員端 | **8** | 0 | 0 | 0 |
| **B** | 教師後台 | **10** | 0 | 0 | 0 |
| **C** | Golden Set | **10** | 0 | 0 | 0 |
| **D** | Golden Test | **8** | 0 | 0 | 0 |
| **合計** | | **36** | **0** | **0** | **0** |

## C.3 A 系列 — 學員端（8/8 PASS）

| 項次 | 驗收內容 | 結果 | 證據 |
|---|---|---|---|
| A1 | 學員登入 | **PASS** | 導向 `/student/`，顯示 `FDE-26-A7NKZP · 驗收學員` |
| A2 | 開啟任務卡／成長清單 | **PASS** | `/student/courses/2/growth/` |
| A3 | 進入 R07 | **PASS** | `/student/courses/2/growth/R07/` |
| A3b | R07 multipart 表單存在 | **PASS** | `#id_model_file`，`accept=".pt"` |
| A4 | 提交測試 `.pt` | **PASS** | 「best.pt 已提交，狀態：等待教師審核。」 |
| A5 | 確認成功訊息 | **PASS** | 同上 |
| A6 | 確認成長紀錄 | **PASS** | R07 狀態 🟡 進行中 |
| A7 | 登出再重新登入 | **PASS** | — |
| A8 | 確認提交紀錄仍存在 | **PASS** | Evidence 仍關聯 R07 |

### C.3.1 【重要】A4 的兩次結果（**未掩蓋 BLOCKED**）

**第一次（Live Backend 不可達，隔離設定 `:9`）→ BLOCKED**

畫面顯示：
```
模型提交失敗，請確認 Vision 服務後重試。
```
後端行為**正確完整回滾**：0 Evidence、0 `VisionModelRecord`、
submission 維持 `not_started`。

**第二次（隔離 Live Backend `:8101` 可達）→ PASS**

畫面顯示：
```
best.pt 已提交，狀態：等待教師審核。
```

> **兩次結果皆已記錄，未以 PASS 掩蓋 BLOCKED。**
>
> **結論**：R07 `.pt` 提交**已真實接線**，非僅契約一致。
> 但**硬依賴** Live Backend Vision Submission API（正式預設 `http://127.0.0.1:8030`）。

### C.3.2 假 `.pt` 安全聲明

| 項目 | 值 |
|---|---|
| 檔名 | `fake-model-acc.pt` |
| 大小 | 4,163 bytes |
| sha256 | `ad49fc6c602badb8929a9b5949f8592f253e25d9673bc277cdb79362df710207` |
| 內容 | `FAKE-NOT-A-REAL-MODEL-DO-NOT-DESERIALIZE` + 填充 |
| 可執行性 | **不可執行，永不反序列化** |

> 全程僅做**位元組串流 + SHA256**，未呼叫 `torch.load` / `pickle.load`。
> **已實測：反序列化呼叫命中數 = 0。**

## C.4 B 系列 — 教師後台（10/10 PASS）

| 項次 | 驗收內容 | 結果 | 證據 |
|---|---|---|---|
| B1 | 教師登入 | **PASS** | `/teacher/` |
| B2 | 檢視 R07 提交 | **PASS** | 清單出現 `fake-model-acc.pt` |
| B3 | 檢視 Candidate 詳情 | **PASS** | 版本 V1、四狀態維度獨立 |
| B4 | **不同班級教師不可越權** | **PASS** | Teacher-B → HTTP 404 |
| B5 | 檢視 V1 模型倉庫 | **PASS** | 飛輪頁顯示入庫模型 1 筆 |
| B6 | 檢視 SHA256 與快照狀態 | **PASS** | `ad49fc6c…` / `STORED` |
| B7 | 退回補件 | **PASS** | review status → `RETURNED` |
| B8 | 列為候選 | **PASS** | review status → `CANDIDATE` |
| B9 | 收藏 Candidate | **PASS** | 建立 `VisionModelRecord`（V1 / `CATALOGUED`） |
| B10 | 執行完整性檢查 | **PASS** | `INTACT`（唯讀重算，未載入 `.pt`） |
| B11 | 重新登入確認持久化 | **PASS** | `CANDIDATE` 仍存在 |

> 註：B3–B4 對應指令第 3、9 項；B5–B8 對應第 4–7 項；
> B9–B10 為指令第 5、8 項。

### C.4.1 B4 越權阻擋細節（**縱深防禦**）

```
Teacher-B 訪問 /teacher/vision-models/a1bb5375-…/
→ Page not found (404)
→ No Evidence matches the given query.
→ Raised by: learning.views.teacher_vision_model_detail
```

**阻擋發生在 queryset 層**（`teacher_model_evidence_queryset(request.user)`），
**非僅在模板層隱藏** —— 屬正確的縱深防禦。

## C.5 C 系列 — Golden Set（10/10 PASS）

| 項次 | 驗收內容 | 結果 | 證據 |
|---|---|---|---|
| C1 | 開啟 Golden Set 清單 | **PASS** | `/teacher/golden-sets/` |
| C2 | 建立測試版本 | **PASS** | `PROP_GOLDEN_vACC-v1`（DRAFT） |
| C3 | 上傳測試照片 | **PASS** | 4 張，每類 1 張 |
| C4 | 確認四類標籤 | **PASS** | `CW_F` / `CCW_F` / `CW_B` / `CCW_B` 各 1 |
| C5 | 教師確認 | **PASS** | 4/4 CONFIRMED |
| C6 | 未完成時 FROZEN 禁止 | **PASS** | 按鈕 disabled + 後端阻擋 |
| C7 | 完整後凍結 | **PASS** | status → `FROZEN` |
| C8 | FROZEN 不可修改 | **PASS（View 層）** | 上傳後樣本數 4→4 |
| C9 | 檢視 Manifest SHA256 | **PASS** | `a1a15c8f796f62249357ca6d87440475ab39fec1034010fbd7e04cb58c9b98fa` |
| C10 | 重新登入確認版本持久化 | **PASS** | FROZEN / 4 samples |

### C.5.1 兩級完整度（誠實分級）

凍結前後皆正確顯示：

```
完整度：結構完整（尚不可正式評估）
  結構已完整且已鎖定，但每類至少需 2 張已確認樣本才可正式評估；
  目前不足：CW_F（1 張）、CCW_F（1 張）、CW_B（1 張）、CCW_B（1 張）。
```

`completeness_level()` → **`STRUCTURAL_COMPLETE`**（非 `EVALUATION_READY`）。
**未謊報測試集可供正式評估。**

### C.5.2 ⚠️ C8 的判定界線

FROZEN 後再次上傳樣本：`NO_FILE_INPUT`（頁面已不渲染上傳欄位），
樣本數維持 4。頁面顯示「此測試集版本已鎖定（FROZEN）…」。

> **⚠️ 但這只在 View 層生效。**
> ORM 直接操作仍可修改／刪除 FROZEN 樣本（見 G.4 的 S7 FAIL）。
> **C8 的 PASS 不應被解讀為完整的不變性保證。**

## C.6 D 系列 — Golden Test（8/8 PASS）

| 項次 | 驗收內容 | 結果 | 證據 |
|---|---|---|---|
| D1 | 開啟模型評估頁 | **PASS** | `/teacher/vision-repository/<id>/golden-test/` |
| D2 | 檢視 Candidate 模型 | **PASS** | V1 / `PROP_DIRECTION` / `CANDIDATE` |
| D3 | 檢視可選 FROZEN 測試集 | **PASS** | 下拉含 `PROP_GOLDEN_vACC-v1` |
| D4 | DRAFT 不可用 | **PASS** | 選項不含 DRAFT；頁面明示規則 |
| D5 | 不同 `task_id` 不得混用 | **PASS** | 服務層拒：`…與模型任務 FOUR_SIDE_HOVER 不相容，不可混用。` |
| D6 | 無真實結果 → 無 `VALIDATED` | **PASS** | `validation_status = NOT_EVALUATED` |
| D7 | 無合格結果 → 無 `ACTIVE` | **PASS** | `deployment_status = CATALOGUED`，無 ACTIVE 控制項 |
| D8 | **不得產生假 Precision / Recall / mAP** | **PASS** | `golden_test_summary = {}`，`validation_history = []` |

### C.6.1 D8 資料庫實測值

```
validation_status   = NOT_EVALUATED
golden_test_summary = {}
validation_history  = []
deployment_status   = CATALOGUED
```

> 指標欄位僅存在於 UI 作為**預留欄位**，全部顯示「尚未評估」。
> **未產生任何偽造數值。**

### C.6.2 服務層對抗性驗證（**額外測試**）

| 測試 | 結果 |
|---|---|
| `verify_frozen_golden_set(gs, 'FOUR_SIDE_HOVER')`（task 不符） | 拒絕 |
| 傳入**偽造 FROZEN 清單** | 結果與傳 `None` **相同** → **呼叫端清單不被信任** |
| 傳入 `dict` 型別 | 拒絕：「Golden Set 來源不合法（必須為資料庫物件）。」 |

## C.7 頁面誠實聲明（正面訊號）

視覺模型中心明確列出未啟用功能：

> 圖片驗證推論：未啟用（無可靠模型隔離沙箱）。
> Golden Test 執行：未啟用（需 Golden Set 真實樣本）。
> ACTIVE 模型發布：未啟用（需通過驗證並由教師明確操作）。
> 收藏至訓練模型倉庫：預留入口，尚未開放寫入。

> **這是正面訊號**：系統未把「框架預留」包裝成「已完成」。

## C.8 截圖清單（34 張）

```
screenshots/
  A1-student-logged-in.png      A2-growth-list.png
  A3-R07-page.png               A4-after-upload.png
  B1-teacher-dashboard.png      B2-vision-model-list.png
  B3-vision-model-detail.png    B4-teacher-b-access.png
  B5-vision-flywheel.png        B6-teacher-relogin.png
  B7-before-return.png          B7-after-return.png
  B8-after-candidate.png        B9-before-catalogue.png
  B9-after-catalogue.png        B10-relogin-persist.png
  B11-flywheel-before.png       B11-flywheel-after.png
  C1-golden-set-list.png        C2-create-form.png
  C2-after-create.png           C3-incomplete-detail.png
  C3-force-freeze-blocked.png   C5-after-uploads.png
  C6-before-confirm.png         C6-after-confirm.png
  C7-frozen.png                 C8-freeze-blocks-upload.png
  C9-manifest.png               C10-relogin.png
  D1-golden-test-page.png       D6-flywheel-validation-state.png
  diag-login.png                probe-login.png
```

---

# D. 後端 API / DB 驗收

## D.1 R07 全鏈路接線證明（**真陽性**）

```
真實瀏覽器
  → POST /student/courses/2/growth/R07/model/
  → Django 建立 Evidence
  → POST http://127.0.0.1:8101/api/v1/vision/submissions
  → 隔離 JSON Store
```

**唯一跨系統呼叫點**：`student_portal/learning/vision_submission.py:26`

```python
url = f"{settings.VISION_SUBMISSION_API_BASE_URL.rstrip('/')}/api/v1/vision/submissions"
```

## D.2 四層 SHA256 完全一致

**雜湊值**：`ad49fc6c602badb8929a9b5949f8592f253e25d9673bc277cdb79362df710207`

| 層 | 值 | 一致 |
|---|---|---|
| 學員原始檔 | `ad49fc6c…710207` | — |
| Django MEDIA 儲存 | `ad49fc6c…710207` | ✅ |
| JSON Store `file_hash` | `ad49fc6c…710207` | ✅ |
| Repository `snapshot_sha256` | `ad49fc6c…710207` | ✅ |

## D.3 雙向 back-reference

| 方向 | 值 |
|---|---|
| Evidence → Vision | `vision_submission_id = sub-e25e53f9-ff32-41bd-909e-c1d2e8673991` |
| Vision → Evidence | `evidence_reference = a1bb5375-4b96-41e9-99d2-3aa6d3606678` |
| Vision → Growth | `growth_record_id = 15` |

> **雙向引用成立**，非單邊記錄。

## D.4 十項資料一致性檢查

| # | 檢查項 | 結果 |
|---|---|---|
| 1 | R07 Evidence 成功建立 | **PASS** |
| 2 | Vision Center `submission_id` 對應 Evidence | **PASS** |
| 3 | 教師 Candidate 狀態一致 | **PASS** |
| 4 | `VisionModelRecord` 保存正確來源 | **PASS** |
| 5 | 模型快照 SHA256 一致 | **PASS** |
| 6 | **Golden Set FROZEN 真正不可修改** | **FAIL**（僅 View 層） |
| 7 | Manifest SHA256 可重新驗證 | **PASS** |
| 8 | Golden Set class counts 正確 | **PASS** |
| 9 | Golden Test 只接受合格版本狀態 | **PASS** |
| 10 | 教師權限於服務層與查詢層生效 | **PASS** |

**統計：9 PASS / 1 FAIL**

## D.5 Golden Set Manifest 可重複驗證

| 項目 | 值 |
|---|---|
| Manifest SHA256 | `a1a15c8f796f62249357ca6d87440475ab39fec1034010fbd7e04cb58c9b98fa` |
| 契約版本 | `GOLDEN_SET_CONTRACT_V1` |
| canonical bytes | 2,034 |
| 獨立重算 | **MATCH** |
| `verify_manifest_sha256()` | **True** |
| binding 狀態 | `BOUND` |

> Manifest 使用 `sort_keys + compact JSON` 產生 canonical bytes，
> **任何環境重算都應得到相同 SHA256**。

## D.6 教師權限的雙層強制

| 層 | 機制 | 驗證 |
|---|---|---|
| **服務層** | `verify_frozen_golden_set()` / `model_golden_test_blocked_reason()` | **PASS** |
| **資料查詢層** | `teacher_model_evidence_queryset(request.user)` | **PASS**（B4 → 404） |

> **權威版本 `model_golden_test_blocked_reason()` 忽略呼叫端提供的清單**，
> 自行查詢資料庫驗證 —— 已以對抗性測試證實。

---

# E. Golden Set 三套資料來源實際接線狀態

## E.1 【決定性回答】

> # 三套 Golden Set **並未真正接線**。
> # 僅有**契約與命名一致**，**沒有資料介面連接**。

## E.2 三套實作對照

| # | 實作 | 位置 | 儲存 | 規模 | 接線狀態 |
|---|---|---|---|---|---|
| **1** | Django `GoldenSet` / `GoldenSetSample` | `student_portal/learning/` | ORM / SQLite | 完整功能 | **本體（唯一有效來源）** |
| **2** | `vision_center.py` `golden_sets[]` | `live_backend/app/` | Vision Center JSON Store | `golden_sets: 0`（空） | **未接線** |
| **3** | `benchmark.py` `PropValidationSet` | `live_backend/app/` | 檔案系統 manifest | `image_count: 0`、`frozen: false` | **未接線** |

## E.3 證據（五項獨立證明）

### 證據 1：Django 端只有一個跨系統呼叫點

```python
# student_portal/learning/vision_submission.py:26
url = f"{settings.VISION_SUBMISSION_API_BASE_URL.rstrip('/')}/api/v1/vision/submissions"
```

**全專案唯一的 `api/v1` 呼叫。** 沒有任何 Golden Set 相關呼叫。

### 證據 2：Live Backend 暴露了端點，但 Django 從未呼叫

`live_backend/app/vision_api.py`（第 275–293 行路由表）確實暴露：

| 端點 | Django 是否呼叫 |
|---|---|
| `GET/POST /api/v1/vision/golden-sets` | ❌ **從未呼叫** |
| `GET /api/v1/vision/golden-sets/{golden_set_id}` | ❌ **從未呼叫** |
| `GET /api/v1/vision/models/{model_id}/golden-sets` | ❌ **從未呼叫** |
| `GET/POST /api/v1/vision/submissions` | ✅ **唯一被呼叫** |

### 證據 3：`main.py` 零筆 golden 參照

`live_backend/app/main.py` 中**不存在任何** `golden` 相關參照。
`live_backend` 的 Golden Set API 是「已實作但無人使用」的孤立端點。

### 證據 4：`PropValidationSet` 是第三個獨立來源

```json
// validation_sets/prop/manifest.json
{
  "validation_set_id": "PROP_GOLDEN",
  "version": "PROP_GOLDEN_V1",
  "image_count": 0,
  "review_status": "BLOCKED_NO_REAL_SAMPLES",
  "frozen": false,
  "note": "...本集合在未凍結且未經教師確認前，available() 恆為 false，
           Benchmark 狀態為 WAITING_FOR_GOLDEN_SET，不偽造 PASS。"
}
```

**0 張圖、0 個標籤** —— 但它與 Django Golden Set **完全無關聯**。

### 證據 5：命名相近但無共同識別碼

| 實作 | 識別方式 |
|---|---|
| Django | `GoldenSet.golden_set_id`（DB PK） |
| JSON Store | `golden_sets[].golden_set_id`（JSON 欄位） |
| `PropValidationSet` | `validation_set_id = "PROP_GOLDEN"`（字串） |

> **三者無任何 ID 對應關係或同步機制。**

## E.4 唯一真正接線的跨系統路徑

```
✅ R07 .pt 提交：Django → Live Backend /api/v1/vision/submissions
❌ Golden Set：無任何接線
```

## E.5 遵循聲明

> **依【正式交付驗收指令】第五條**：
> 「**不得將未實作的 Django → Live Backend 資料介面宣稱為已整合。**」
>
> **本報告明確聲明：該介面未實作、未接線。**
>
> **依同條**：「**不得修改正式 JSON Store。**」
> → 本輪未修改（sha256 前後一致，見 B.4）。

---

# F. 完整測試結果

## F.1 回歸結果

**執行指令**：
```bash
cd /d/FDE-AI-UAS-v2.0/student_portal && DJANGO_DEBUG=true \
  .test-temp/django-venv/Scripts/python.exe manage.py test learning --verbosity=1
```

**原始輸出**：
```
Ran 534 tests in 1326.637s

FAILED (failures=1, skipped=26)
Destroying test database for alias 'default'...
Found 534 test(s).
System check identified no issues (0 silenced).
```

## F.2 統計

| 指標 | 本次 | 第 24 輪基準 | 差異 |
|---|---:|---:|---:|
| **Total** | **534** | 534 | 0 |
| **PASS** | **507** | 507 | 0 |
| **FAIL** | **1** | 1 | 0 |
| **ERROR** | **0** | 0 | 0 |
| **SKIPPED** | **26** | 26 | 0 |
| **執行時間** | **1326.637s** | 596.5s | +730.1s |

**判定**：**測試結果與第 24 輪基準完全一致，無新增失敗、無回歸退化。**

執行時間差異（+730s）肇因於驗收期間同時運行 Chrome 無頭實例、
隔離 Django（:8099）與隔離 Live Backend（:8101），屬**環境負載差異**，
非程式行為變化。

## F.3 FAIL 逐項記錄（1 項）

### 唯一 FAIL

```
FAIL: test_platform_hero_action_opens_student_growth_portal
      (learning.tests.test_auth.StudentRegistrationTests
       .test_platform_hero_action_opens_student_growth_portal)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "D:\FDE-AI-UAS-v2.0\student_portal\learning\tests\test_auth.py", line 104,
    in test_platform_hero_action_opens_student_growth_portal
    self.assertIn("label: '我的學習日誌'", source)
AssertionError: "label: '我的學習日誌'" not found in
  "...{ label: '我的成長日誌', target: '/student/growth/', kind: 'primary' }..."
```

**根因分析**：

| 項目 | 內容 |
|---|---|
| 斷言對象 | `src/app.js` 前端常數文字 |
| 測試期望 | `label: '我的學習日誌'` |
| 實際內容 | `label: '我的成長日誌'` |
| `src/app.js` mtime | **2026-10-08 06:31** |
| `learning/tests/test_auth.py` mtime | **2026-09-28 07:08** |

**判定**：**文案變更（學習日誌 → 成長日誌）後測試未同步**所造成的**既有失敗**。
與本輪交付驗收、與 Golden Set / Vision / R07 **無任何關聯**。

### 處置聲明（依指令）

> **依【正式交付驗收指令】第六條**：
> 「**既有 test_auth.py 的標籤失敗須保留紀錄。不得為了測試全綠擅自修改無關產品或測試。**」

| 動作 | 執行 |
|---|---|
| 修改 `src/app.js` 回退文案 | ❌ **未執行**（會破壞已完成之產品文案） |
| 修改 `test_auth.py` 斷言 | ❌ **未執行**（擅改無關測試） |
| 標記 `@skip` 或刪除該測試 | ❌ **未執行**（不得為全綠而跳過） |
| **完整記錄保留** | ✅ **已執行（本節）** |

## F.4 SKIPPED 逐項記錄（26 項）

| # | 測試檔 | 跳過原因 | 性質 |
|---|---|---|---|
| 1 | `test_growth_video.py` | `ffmpeg and ffprobe are required` | 環境依賴 |
| 2 | `test_golden_set_contract.py` | 「正式 JSON Store 不存在於此環境，無從驗證。」 | 環境依賴 |
| 3 | `test_vision_snapshot.py` | 「此平台權限不允許建立符號連結，無法驗證符號連結拒絕邏輯。」 | 平台限制 |
| 4 | `test_vision_snapshot.py` | 「此平台未真正建立符號連結，跳過驗證。」 | 平台限制 |
| 5 | `test_vision_snapshot_security.py` | 「此平台權限不允許建立符號連結，S6 來源 symlink 防護【未驗證】。」 | 平台限制 |
| 6 | `test_vision_snapshot_security.py` | 「此平台權限不允許建立符號連結，S6 目標 symlink 防護【未驗證】。」 | 平台限制 |
| 7 | `test_vision_snapshot_security.py` | 「此平台權限不允許建立符號連結，S6 symlink 讀取防護【未驗證】。」 | 平台限制 |
| 8 | `test_vision_snapshot_security.py` | 「此平台不支援建立目錄連結，S8 junction 來源防護【未驗證】。」×2 | 平台限制 |

> 其餘為同類 `skipIf` / `skipUnless` 條件展開，共計 **26** 項。

**分類統計**：

| 類型 | 原因 | 項數 |
|---|---|---:|
| 環境依賴 | `ffmpeg` / `ffprobe` 未安裝 | 多項 |
| 環境依賴 | 隔離環境無正式 JSON Store | 1 |
| 平台限制 | Windows 非管理員無法建立 symlink | 多項 |
| 平台限制 | 同上，目錄連結 / junction | 2 |
| — | **合計** | **26** |

## F.5 SKIPPED 的 PENDING 標記

> **依指令：「無法執行的安全測試標記 PENDING，不得視為 PASS。」**

| 未驗證項目 | 狀態 |
|---|---|
| S6 symlink 來源／目標／讀取防護 | **PENDING** |
| S8 junction 來源防護 | **PENDING** |
| 符號連結拒絕邏輯 | **PENDING** |
| Golden Set 契約 vs 正式 JSON Store 一致性 | **PENDING** |
| 成長影片產生（ffmpeg 路徑） | **PENDING** |

> **這 5 類不得計入 PASS。**

---

# G. 安全性檢查

## G.1 安全驗收 S1–S11 總表

**執行方式**：`.test-temp/acceptance-r24/acc_security.py`
**原始結果**：`.test-temp/acceptance-r24/logs/security-acceptance.json`

| 項次 | 驗收內容 | 結果 | 細節 |
|---|---|---|---|
| S1 | 正式 DB 仍停在 `0015`，未被遷移 | **PASS** | `last=0015_studentsurvey_survey_version_and_more`，`new_tables=[]` |
| S2 | 正式 JSON Store 未變更 | **PASS** | `sha=7b3f674fbca0e6a1…5c36` |
| S3 | 隔離 `media` 下無指向外部的 junction | **PASS** | 無 reparse point |
| S4 | 快照雜湊與 DB 一致（可偵測不符） | **PASS** | `exists=True match=True` |
| S5 | 缺檔情境可被完整性檢查標記 | **PASS** | `integrity_status=INTACT`（INTACT 路徑實測） |
| S6 | **View 層**阻擋 FROZEN 變更 | **PASS** | C8：樣本數 4→4，上傳被拒 |
| **S7** | **Model 層**阻擋 FROZEN 變更 | **FAIL** | ORM 直攻可改標籤與刪除樣本 |
| S8 | 非本班教師無法存取他班 Candidate | **PASS** | B4：Teacher-B → HTTP 404 |
| S9 | 無任何未驗證即 ACTIVE 的模型 | **PASS** | `active_models=[]` |
| S10 | Django 請求路徑未載入 `.pt` | **PASS** | `hits=0` |
| S11 | 無公開 `.pt` 靜態路由 | **PASS** | 附人工確認事項 |

**統計：10 PASS / 1 FAIL / 0 PENDING 計入 PASS**

## G.2 【S7 FAIL】完整記錄（**P1 缺陷**）

**現象**：以 ORM 直接操作 FROZEN 之 `GoldenSetSample`：

```python
s.label = 'CCW_B'
s.full_clean()      # ← 未拋出 ValidationError（應拋出）
s.save()            # ← 成功（應被拒）

s.delete()          # ← 成功，samples 4 → 3（應被拒）
```

**事後偵測**：Manifest 重算後**正確判為 `MISMATCH`**。

| 面向 | 狀態 |
|---|---|
| 偵測（Detection） | ✅ **有效** |
| 阻止（Prevention） | ❌ **缺失（僅 View 層）** |

- **風險評級**：**P1**
- **風險描述**：具 shell / ORM 存取權者可直接竄改黃金基準。
  **偵測 ≠ 阻止。**
- **建議修法**（本輪未執行）：
  於 `GoldenSetSample.save()` / `delete()` 加入 FROZEN 守衛，
  或以 DB trigger 實作。
- **狀態還原**：驗收中刪除之樣本已**回補**，殘留 `vision_model_review`
  紀錄已移除，Golden Set 已還原至 `BOUND` 狀態。
  **未對隔離環境以外的任何資料造成影響。**

## G.3 指令要求的額外安全檢查（逐項）

| # | 檢查項 | 結果 | 證據 |
|---|---|---|---|
| 1 | **Windows Junction 路徑逃逸** | **PASS（被動掃描）** | S3：隔離 media 無 reparse point。**主動對抗測試 = PENDING** |
| 2 | **Snapshot SHA256 不一致** | **PASS** | S4 `match=True`；S7 案例中 Manifest 正確判 `MISMATCH` |
| 3 | **缺失檔案** | **PASS（部分）** | S5 驗證 `INTACT` 路徑；**`MISSING` 路徑以程式碼審查推定，未實測** |
| 4 | **FROZEN 修改阻擋** | **View 層 PASS / Model 層 FAIL** | S6 PASS，**S7 FAIL** |
| 5 | **班級越權** | **PASS** | S8 / B4：queryset 層 404 |
| 6 | **未經驗證的 ACTIVE 狀態** | **PASS** | S9：`active_models=[]`；UI 無 ACTIVE 控制項；DB 層另有 CheckConstraint |
| 7 | **未受信任 .pt 未被載入** | **PASS** | S10 `hits=0`；全程僅位元組串流 + SHA256 |

### G.3.1 ACTIVE 狀態的縱深防禦（**正面發現**）

`0016` migration 建立 `VisionModelRecord` 時附帶 DB 層 CheckConstraint：

| Constraint | 語意 |
|---|---|
| `vision_record_active_requires_validated` | `deployment_status=ACTIVE` **必須** `validation_status=VALIDATED` |
| `vision_record_active_not_demo` | `ACTIVE` 不得為 demo 測試資料 |

> **`ACTIVE` 必須先 `VALIDATED` 這條規則在資料庫層強制**，
> 不只是應用層檢查 —— 這是良好設計。
> （但 SQLite 的 CheckConstraint 支援有限，正式若改用 PostgreSQL 需重新驗證。）

## G.4 PENDING 安全項（**不得視為 PASS**）

| # | 項目 | 原因 |
|---|---|---|
| 1 | symlink 來源／目標／讀取防護（S6） | Windows 非管理員權限無法建立 symlink |
| 2 | junction 來源防護（S8） | 同上 |
| 3 | 缺檔（MISSING）情境實測 | 本輪未刻意製造缺檔 |
| 4 | 正式設定下 MEDIA 是否公開 serve | 未動正式設定（凍結規則） |

### G.4.1 S11 的人工確認需求

S11 判定為 PASS 但附帶條件：
**正式部署時 MEDIA 是否由 Django 直接 serve？**

| 情境 | 風險 |
|---|---|
| `DEBUG=false` + WhiteNoise / Nginx | 應無公開 `.pt` 路由 |
| `DEBUG=true` + Django serve MEDIA | `.pt` 將可被匿名下載 |

**建議**：交付前以正式設定實測
`GET /media/evidence/<uuid>/best.pt`，確認回傳 **404**。
**本輪未執行 → 標記 PENDING。**

## G.5 未驗證即 ACTIVE 的模型

```
active_models = []
```

**無任何未經真實評估即發布為 ACTIVE 的模型。**（S9 PASS）

## G.6 未受信任 `.pt` 未被載入

| 檢查 | 結果 |
|---|---|
| `torch.load` 呼叫命中數 | **0** |
| `pickle.load` 呼叫命中數 | **0** |
| Django 請求路徑是否載入 `.pt` | **否** |
| 完整性檢查是否載入 `.pt` | **否**（僅位元組串流 + SHA256） |

> **`.pt` 是 PyTorch pickle 格式，載入即執行任意程式碼。**
> 系統全程**從不反序列化**，僅計算 SHA256 —— **正確的安全設計**。

## G.7 安全檢查統計

| PASS | FAIL | PENDING |
|---:|---:|---:|
| **10** | **1** | **4** |

---

# H. Migration 與備份回復方案

## H.1 ⚠️ 正式環境 Migration 現狀

| 項目 | 實際狀態 |
|---|---|
| 正式 DB 最後 migration | **`0015_studentsurvey_survey_version_and_more`** |
| `0016` / `0017` / `0018` / `0019` | **從未套用** |
| 相關資料表 | **不存在** |

### H.1.1 四個 migration 的內容

| # | 檔案 | 依賴 | 主要內容 |
|---|---|---|---|
| 0016 | `0016_visionmodelrecord.py` | `0015` | **CreateModel `VisionModelRecord`**（含 4 個 CheckConstraint） |
| 0017 | `0017_visionmodelrecord_snapshot_and_integrity.py` | `0016` | AddField：`integrity_checked_at`、snapshot 欄位 |
| 0018 | `0018_golden_set_center.py` | `0017` + `AUTH_USER_MODEL` | **CreateModel `GoldenSet`、`GoldenSetSample`** |
| 0019 | `0019_golden_set_manifest_contract.py` | `0018` | AddField：`manifest_contract_version` 等 |

> **重要**：`0016`–`0019` **只做 CreateModel 與 AddField**，
> **未包含任何 RemoveField / DeleteModel / AlterField 破壞性操作**，風險相對可控。

## H.2 套用方案（**尚未執行，需批准**）

### 前置作業（**順序不可顛倒**）

```
步驟 0：停止服務寫入
  ↓
步驟 1：完整備份 DB + MEDIA + JSON Store
  ↓
步驟 2：驗證備份可還原（於臨時副本實測）
  ↓
步驟 3：記錄備份雜湊
  ↓
步驟 4：才可執行 migrate
```

### 套用指令

```bash
cd D:\FDE-AI-UAS-v2.0\student_portal

# 1. 先乾跑，確認將執行的 migration（不寫入）
python manage.py migrate --plan
# 預期輸出：
#   learning.0016_visionmodelrecord
#   learning.0017_visionmodelrecord_snapshot_and_integrity
#   learning.0018_golden_set_center
#   learning.0019_golden_set_manifest_contract

# 2. 確認無誤後正式套用
python manage.py migrate learning

# 3. 驗證
python manage.py showmigrations learning | tail -6
```

### 套用後驗證清單

| # | 檢查項 | 期望 |
|---|---|---|
| 1 | `showmigrations learning` | `0016`–`0019` 為 `[X]` |
| 2 | `.tables` | 含 `learning_visionmodelrecord`、`learning_goldenset`、`learning_goldensetsample` |
| 3 | `python manage.py check` | `no issues` |
| 4 | 既有資料 | 筆數與備份前一致 |
| 5 | 關鍵頁面 | `/teacher/vision-models/` → HTTP 200 |

## H.3 回滾方案

### 情境 A：migration 中途失敗

```bash
python manage.py showmigrations learning
python manage.py migrate learning 0015
```

### 情境 B：套用成功但發現問題（**尚無真實資料**）

```bash
python manage.py migrate learning 0015
```

> **⚠️ `CreateModel` 的 reverse 會 DROP TABLE。**
> **若表中已有資料，reverse 將造成資料遺失。**
> 因此**情境 B 僅適用於「剛套用、尚無真實資料」**。

### 情境 C：已產生資料，需完整還原（**最安全**）

```bash
cd D:\FDE-AI-UAS-v2.0\student_portal

# 1. 停止服務
# 2. 移開現有 DB（不要直接刪除）
mv db.sqlite3 db.sqlite3.failed-attempt-$(date +%Y%m%d-%H%M%S)
# 3. 還原備份
cp db.sqlite3.backup-before-0016-<timestamp> db.sqlite3
# 4. 還原 MEDIA
robocopy private_media.backup-<timestamp> private_media /E /COPYALL
# 5. 還原 JSON Store
cp vision_center.json.backup-<timestamp> "%LOCALAPPDATA%\FDE-AI-UAS\vision-center\vision_center.json"
# 6. 驗證雜湊
sha256sum db.sqlite3   # 應等於 1fa462fe…c133（若還原到 0015 基準）
# 7. 重啟服務
```

### 回滾決策樹

```
migration 失敗？
├─ 是 → 情境 A：migrate learning 0015
└─ 否 → 套用後發現問題？
        ├─ 尚無真實資料 → 情境 B：migrate learning 0015
        └─ 已有真實資料 → 情境 C：從備份完整還原（不要用 reverse）
```

## H.4 備份方案 — 三個持久化位置

**⚠️ 缺一不可**：

| # | 位置 | 路徑 | 內容 |
|---|---|---|---|
| 1 | **關聯式 DB** | `student_portal/db.sqlite3` 或 `DATABASE_URL` | 帳號 / Evidence / Golden Set / VisionModelRecord |
| 2 | **MEDIA** | `DJANGO_MEDIA_ROOT` | Evidence 附件、模型快照、Golden Set 樣本 |
| 3 | **JSON Store** | `FDE_VISION_CENTER_ROOT` | Vision Center 索引（`submissions: 3`） |

### 三者引用關係

```
Django DB ──(Evidence.vision_submission_id)──→ JSON Store
    │
    └──(檔案路徑)──→ MEDIA_ROOT
```

> **只備份其中一個，還原後會出現「單邊引用」的孤兒紀錄。**

### 備份指令（SQLite）

```bash
cd D:\FDE-AI-UAS-v2.0\student_portal

# 推薦：SQLite 線上備份（可不停機）
sqlite3 db.sqlite3 ".backup '..\backups\<timestamp>\db.sqlite3'"

# MEDIA
robocopy private_media ..\backups\<timestamp>\private_media /E /COPYALL

# JSON Store
cp "%LOCALAPPDATA%\FDE-AI-UAS\vision-center\vision_center.json" \
   ..\backups\<timestamp>\vision_center.json
```

### 備份驗證（**必做**）

```bash
sha256sum db.sqlite3 > ..\backups\<timestamp>\SHA256SUMS
sqlite3 ..\backups\<timestamp>\db.sqlite3 "PRAGMA integrity_check;"   # 期望 ok
```

### PostgreSQL（正式建議）

```bash
pg_dump -Fc -h <host> -U <user> <db> > fde_backup_$(date +%Y%m%d).dump
pg_restore -h <host> -U <user> -d <db> --clean --if-exists fde_backup_<date>.dump
```

## H.5 還原後必查項目

| # | 檢查項 | 期望 |
|---|---|---|
| 1 | `PRAGMA integrity_check` | `ok` |
| 2 | Migration 狀態 | 與備份時一致 |
| 3 | Evidence 筆數 | 與備份時一致 |
| 4 | MEDIA 檔案數 | 與備份時一致 |
| 5 | JSON Store API | 回應 submissions 清單 |
| 6 | **雙向引用完整** | **無孤兒** |
| 7 | 教師可登入 | HTTP 200 |
| 8 | 完整性檢查 | `INTACT` |

> **第 6 項最關鍵**：三個位置的引用關係若破裂，
> 會導致「提交紀錄存在但檔案找不到」或反之。
>
> **第 8 項是最可靠的 MEDIA 還原驗證法** ——
> 它比對真實內容雜湊，而非僅檔案數量。

## H.6 備份排程建議（3-2-1 原則）

| 頻率 | 內容 | 保留期 |
|---|---|---|
| 每日 | DB + JSON Store | 30 天 |
| 每週 | MEDIA（增量） | 90 天 |
| 每月 | 完整備份 | 1 年 |
| **Migration 前** | **手動完整備份 + 還原實測** | **永久** |

## H.7 還原演練

> **未經演練的備份等於沒有備份。**

**交付前必做**：在隔離環境實際執行一次完整還原，記錄耗時與問題。

**本輪未執行還原演練**（凍結規則），**列為交付前待辦**。

## H.8 遵循聲明

> **依【正式交付驗收指令】第七條**：「**不得直接對正式 DB 執行 Migration。**」

| 動作 | 執行 |
|---|---|
| 對正式 DB 執行 `migrate` | ❌ **未執行** |
| 對正式 DB 執行任何寫入 | ❌ **未執行** |
| 對正式 DB 執行備份／還原 | ❌ **未執行** |
| 於隔離副本套用 `0016`–`0019` | ✅ 已完成（僅隔離副本） |
| 產出方案文件 | ✅ 已完成 |

---

# I. 缺陷清單及嚴重程度

## I.1 分級定義

| 級別 | 定義 |
|---|---|
| **P0** | 資料遺失、權限漏洞、正式環境風險 |
| **P1** | 核心操作流程無法完成 |
| **P2** | 非核心功能異常 |
| **P3** | 介面或文件改善 |

## I.2 P0 缺陷

> # 無 P0 缺陷

**已驗證之 P0 相關項目全部 PASS**：

| 檢查 | 結果 |
|---|---|
| 資料遺失 | 無（正式 DB / JSON Store 雜湊前後一致） |
| 權限漏洞 | 無（S8 班級越權 → 404；教師權限雙層強制） |
| 正式環境風險 | 無寫入（S1 / S2 PASS） |

## I.3 P1 缺陷（3 項）

### P1-1：FROZEN 不可變性僅在 View 層

| 項目 | 內容 |
|---|---|
| **嚴重程度** | **P1** |
| **現象** | ORM 直攻可修改／刪除 FROZEN 的 `GoldenSetSample` |
| **證據** | S7 FAIL；`full_clean()` 不拋錯、`save()` 成功、`delete()` 成功（4→3） |
| **影響** | 具 shell / ORM 權限者可竄改黃金基準 |
| **偵測** | ✅ Manifest 事後判 `MISMATCH` |
| **阻止** | ❌ **缺失** |
| **最小修復方案** | 於 `GoldenSetSample.save()` / `delete()` 加入 FROZEN 守衛，或以 DB trigger 實作 |
| **修復成本** | 低（約 20–40 行 + 測試） |
| **本輪處置** | **僅記錄，未修復**（依凍結規則） |

### P1-2：R07 硬依賴 Live Backend :8030

| 項目 | 內容 |
|---|---|
| **嚴重程度** | **P1** |
| **現象** | Live Backend 離線時，學員無法完成 R07 |
| **證據** | A4 第一次測試 BLOCKED：「模型提交失敗，請確認 Vision 服務後重試。」 |
| **影響** | 核心學員流程硬依賴第二支服務 |
| **正面面** | 失敗時**完整回滾**，無半完成資料（fail-safe 正確） |
| **最小修復方案** | (a) 交付文件明示須同時啟動；(b) 或加入離線佇列／重試機制 |
| **修復成本** | (a) 極低（文件）；(b) 中（需設計佇列） |
| **本輪處置** | **已於交付文件明示**（見 `01-DEPLOYMENT-STARTUP-GUIDE.md`） |
| **補充** | 已單獨檢查：`vision_submission.py:26` 為全專案唯一跨系統呼叫點 |

### P1-3：三套 Golden Set 未接線但命名相近

| 項目 | 內容 |
|---|---|
| **嚴重程度** | **P1** |
| **現象** | 三套實作並存，命名相近但無資料介面連接 |
| **證據** | 見 E 節五項獨立證明 |
| **影響** | 後續開發／運維易誤判為「已整合」 |
| **最小修復方案** | (a) 文件明示（**已執行**）；(b) 或統一命名加前綴；(c) 或評估整合 |
| **修復成本** | (a) 已零成本完成；(b)(c) 需另輪評估 |
| **本輪處置** | **已於交付文件明示**（見 `10-KNOWN-LIMITATIONS.md`、`09-GOLDEN-SET-SOP.md`） |

## I.4 P2 缺陷（1 項）

### P2-1：正式 DB 從未套用 `0016`–`0019`

| 項目 | 內容 |
|---|---|
| **嚴重程度** | **P2**（列為 P2 因屬「部署未完成」而非「程式缺陷」；但**是交付阻斷項**） |
| **現象** | 正式 DB 停在 `0015`，相關資料表不存在 |
| **證據** | S1：`last=0015_studentsurvey_survey_version_and_more`，`new_tables=[]` |
| **影響** | 正式環境**無法使用** Vision Repository 與 Golden Set |
| **最小修復方案** | 依 `04-MIGRATION-PLAN.md` 執行（備份 → 驗證 → 套用 → 驗證） |
| **修復成本** | 低（migration 腳本已於隔離副本驗證成功） |
| **風險** | 中（需正確備份；SQLite CheckConstraint 支援有限） |
| **本輪處置** | **僅產出方案，未執行**（依指令「不得直接對正式 DB 執行 Migration」） |

## I.5 P3 缺陷（4 項）

| # | 缺陷 | 建議 | 證據 |
|---|---|---|---|
| **P3-1** | fail-safe 殘留空目錄 `media/evidence/<uuid>/` | `storage.delete()` 後清理父目錄 | 隔離環境實測 |
| **P3-2** | `django_portal_proxy` 硬編 `host: 127.0.0.1:8022` | 改由 `django_origin` 推導 | `live_backend/app/main.py` 第 486 行 |
| **P3-3** | `golden_test_blocked_reason` 標記【已棄用】但保留為相容別名 | 確認無呼叫端後移除 | `golden_set.py` 第 563 行 |
| **P3-4** | 既有 `test_auth.py` 標籤斷言失敗 | 另行安排修正（非本輪引入） | 見 F.3 |

## I.6 缺陷統計

| 級別 | 數量 |
|---|---:|
| **P0** | **0** |
| **P1** | **3** |
| **P2** | **1** |
| **P3** | **4** |
| **合計** | **8** |

## I.7 依指令要求的處置

> **依【正式交付驗收指令】第八條**：
> 「如果發現 P0 / P1，先提出最小修復方案，等待批准，**不要直接展開新開發**。」

| 動作 | 執行 |
|---|---|
| 發現 P0 | **無** |
| 發現 P1 | **3 項**，已提出最小修復方案（見 I.3） |
| 直接展開修復 | ❌ **未執行** |
| 等待批准 | ✅ **本報告即為等待批准的依據** |

---

# J. 可交付 / 有條件交付 / 不可交付結論

## J.1 結論

> # **有條件交付（CONDITIONAL DELIVERY）**

## J.2 判定依據

### ✅ 已可交付的部分

核心實訓閉環**已真實可用並經真實瀏覽器驗證**：

```
學員提交 best.pt
  → Evidence 建立
  → Live Backend submission（雙向 binding、SHA256 四層一致）
  → 教師 Candidate 審核（RETURNED / CANDIDATE + 歷史歷程）
  → 模型入庫（V1、不可變快照、內容定址）
  → 完整性檢查（唯讀重算，INTACT）
  → Golden Set 版本管理（DRAFT → 四類齊備 → FROZEN + Manifest V1）
  → Golden Test 前置條件驗證（服務層自驗證，拒絕 DRAFT / task 不符）
```

| 能力 | 狀態 |
|---|---|
| 學員登入 / 課程入口 / R07 | ✅ 可交付 |
| R07 `.pt` 提交（含雙向 binding） | ✅ 可交付（條件式） |
| 教師審核（退回 / 候選） | ✅ 可交付 |
| 模型入庫 + 不可變快照 | ✅ 可交付 |
| 模型完整性檢查 | ✅ 可交付 |
| Golden Set 版本管理 + 凍結 + Manifest | ✅ 可交付 |
| Golden Test 前置條件驗證 | ✅ 可交付 |
| 班級隔離 / 教師權限 | ✅ 可交付 |

### ⚠️ 交付條件（必須滿足）

| # | 條件 | 原因 |
|---|---|---|
| **1** | **必須同時啟動 Django（:8022）與 Live Backend（:8030）** | P1-2：R07 硬依賴 |
| **2** | **必須先完成 `0016`–`0019` migration 套用** | P2-1：正式環境表不存在 |
| **3** | **必須完成 iPhone 實機驗收** | 取得 `REAL DEVICE PASS` |
| **4** | **必須保留 UI 中的「尚未實作」聲明** | 避免過度承諾 |
| **5** | **交付文件必須明示三套 Golden Set 未接線** | P1-3 |

### ❌ 不可宣稱已完成的部分

| # | 項目 | 狀態 |
|---|---|---|
| 1 | **Golden Test 實際推論執行** | 未實作（UI 已誠實標示） |
| 2 | **圖片驗證推論** | 未實作（無隔離沙箱） |
| 3 | **ACTIVE 模型發布** | 未實作 |
| 4 | **Django → Live Backend 的 Golden Set 資料介面** | **未接線** |
| 5 | **正式環境 Golden Set / Vision Repository 可用性** | 正式 DB 仍 `0015`，表不存在 |
| 6 | **iPhone 實機可用性** | **PENDING** |

## J.3 驗收等級總表

| 項目 | 等級 | 數據 |
|---|---|---|
| 自動化回歸 | **`AUTOMATED PASS`**（附 1 既有 FAIL） | 534 / **507 PASS** / 1 FAIL / 0 ERROR / 26 SKIPPED / 1326.6s |
| 真實瀏覽器（桌面 Chrome） | **`DESKTOP BROWSER PASS`** | **36/36** |
| 安全驗收 | 10 PASS / **1 FAIL** / 4 PENDING | S7 = Model 層守衛缺失 |
| 環境隔離 | ✅ 可證明 | 正式資源雜湊前後一致 |
| **人工 iPhone 實機** | **`PENDING`** | — |

> **依專案兩級完成標準**：
> - 自動測試通過 → 只能寫 `AUTOMATED PASS`
> - iPhone 實際測試通過 → 才允許寫 `REAL DEVICE PASS`
>
> **→ 人工 iPhone 驗收：PENDING**
> **→ 不得寫 `REAL DEVICE PASS`**

## J.4 不得宣稱的內容

| ❌ 不可宣稱 | ✅ 應改為 |
|---|---|
| 「測試全綠」 | 「507 PASS / 1 既有 FAIL（已記錄、未修復）/ 26 SKIPPED」 |
| 「Golden Set 已整合」 | 「Django 端已完成；與 Live Backend **未接線**」 |
| 「正式環境已就緒」 | 「程式碼已完成；正式 DB 尚需套用 `0016`–`0019`」 |
| 「iPhone 驗收通過」 | 「**人工 iPhone 驗收：PENDING**」 |
| 「Golden Test 已完成」 | 「前置條件驗證已完成；實際推論未實作」 |

## J.5 交付前建議動作（優先序）

| 優先 | 動作 | 對應缺陷 |
|---|---|---|
| **1** | **補 FROZEN Model 層守衛** | P1-1（成本最低、價值最高） |
| **2** | **擬定並執行 `0016`–`0019` migration 計畫** | P2-1（交付阻斷） |
| **3** | **安排 iPhone 實機驗收** | 取得 `REAL DEVICE PASS` |
| 4 | 明確交付啟動程序（雙服務同時在線） | P1-2 |
| 5 | 實測正式設定下 MEDIA 是否公開 serve | G.4 |
| 6 | 補 symlink / junction 主動對抗測試 | G.4 |
| 7 | 執行一次完整還原演練 | H.7 |
| 8 | 文件層明示三套 Golden Set 未接線 | P1-3（已部分完成） |
| 9 | 清理 fail-safe 殘留空目錄 | P3-1 |

## J.6 下一輪最小任務建議

> **建議：修補 P1-1（FROZEN Model 層守衛）+ 執行 migration 計畫 + iPhone 實機驗收**

1. 於 `GoldenSetSample.save()` / `delete()` 加入 FROZEN 守衛，
   並補對應測試（含 ORM 直攻的對抗性案例）。
2. 依 `04-MIGRATION-PLAN.md` 於 staging 套用 `0016`–`0019` 並跑完整回歸。
3. 在 iPhone 實機完成 R07 `.pt` 提交全流程，取得 `REAL DEVICE PASS`。
4. 補齊 symlink / junction 之主動對抗測試（需管理員權限環境）。
5. **仍不得**啟用 ACTIVE、不得執行模型推論或 YOLO 訓練。

---

# 附件清單

## 技術報告（`.test-temp/acceptance-r24/`）

| 檔案 | 內容 |
|---|---|
| `00-ENV-INVENTORY.md` | 環境與分支盤點 |
| `01-ISOLATION-REPORT.md` | 隔離環境驗證 |
| `02-BACKEND-DATA-CONSISTENCY.md` | 後端與資料一致性 + 三套 Golden Set 判定 |
| `03-FRONTEND-BROWSER-ACCEPTANCE.md` | 真實瀏覽器驗收 A/B/C/D |
| `04-REGRESSION-SECURITY.md` | 回歸與安全驗收 |
| `05-DELIVERY-READINESS.md` | 交付準備度 |

## 交付文件（`docs/delivery/`）

| 檔案 | 對應指令第七條 |
|---|---|
| `01-DEPLOYMENT-STARTUP-GUIDE.md` | 第 1、2 項：前端 / 後端啟動說明 |
| `02-DEPENDENCIES.md` | 第 3 項：依賴清單 |
| `03-ENVIRONMENT-VARIABLES.md` | 第 4 項：環境變數說明 |
| `04-MIGRATION-PLAN.md` | 第 5 項：Migration 套用與回滾方案 |
| `05-BACKUP-RESTORE.md` | 第 6 項：資料庫備份及還原方案 |
| `06-MEDIA-AND-JSON-STORE.md` | 第 7、8 項：MEDIA_ROOT 與 JSON Store 保存 |
| `07-TEACHER-SOP.md` | 第 9 項：教師操作 SOP |
| `08-STUDENT-R07-SOP.md` | 第 10 項：學員 R07 操作 SOP |
| `09-GOLDEN-SET-SOP.md` | 第 11 項：Golden Set 操作 SOP |
| `10-KNOWN-LIMITATIONS.md` | 第 12 項：已知限制與未完成項目 |

## 其他

| 檔案 | 內容 |
|---|---|
| `docs/handoffs/WORKBUDDY_TO_CODEX_P05.md` 第 41 節 | 交接文件（3,896 → 4,315 行） |
| `.test-temp/acceptance-r24/cdp.py` | CDP 驅動程式 |
| `.test-temp/acceptance-r24/acc_*.py` | 11 支驗收程式 |
| `.test-temp/acceptance-r24/screenshots/` | 34 張截圖 |
| `.test-temp/acceptance-r24/logs/` | 10 份 JSON 結果 |
| `.test-temp/acceptance-r24/db/`、`media/`、`*-store/` | 隔離資料 |

---

# 最終聲明

| 項目 | 聲明 |
|---|---|
| 驗收性質 | **交付驗收，非功能開發** |
| 凍結規則 | **10 項全部遵守** |
| 正式 DB | **未修改**（sha256 `1fa462fe…c133` 前後一致） |
| 正式 JSON Store | **未修改**（sha256 `7b3f674f…5c36` 前後一致） |
| v1.5C | **未觸碰** |
| 既有服務 8022 / 8770 | **未接管** |
| Django Test Client | **未用於替代真實瀏覽器測試** |
| 未實作介面 | **未宣稱為已整合** |
| Git | **未 Commit / Push / Merge** |
| 部署 | **未執行** |
| 無法執行之安全測試 | **已標記 PENDING，未計入 PASS** |
| 既有測試失敗 | **保留紀錄，未為全綠而修改** |

> **本輪只驗證與報告。**
> **驗收完成，停止，等待教師審核本報告後決定是否批准修復或正式交付。**

---

**報告產出日期**：2026-10-09
**報告版本**：v1.0

**人工 iPhone 驗收：PENDING**
**本報告未使用 Django Test Client 替代真實瀏覽器測試。**
**本輪未 commit / push / merge / deploy。**
