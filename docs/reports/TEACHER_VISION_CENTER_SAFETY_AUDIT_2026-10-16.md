# 教師端 AI 視覺模型中心｜最後一輪唯讀安全核驗報告

- 日期：2026-10-16
- 專案：FDE-AI-UAS 2.0（`D:\FDE-AI-UAS-v2.0`，分支 `fde-ai-v2.0-dev`）
- 依據：教師 2026-10-16「教師模型中心最後安全核驗」（五項核驗）
- 性質：**純唯讀核驗**。未修改任何程式碼、未新增資料模型／migration、未動正式資料庫與模型核心、未 commit／未部署、未清理任何資料。
- 方法：讀取原始碼（Django `views.py`／`models.py`／`urls.py`／模板、Live Backend `vision_center.py`／`vision_api.py`）＋ 檢視既有 `vision_center.json` 與 DB 檔案狀態 ＋ 引用 V2 端到端實測紀錄。

---

## 核驗一：真實圖片驗證與 ACTIVE 啟用條件

### 1.1 模型結構驗證 VALIDATED 與圖片辨識結果是否為不同判定？

**是，兩者是完全獨立的判定，且無任何寫入關聯。**

| 維度 | `validation_status = VALIDATED` | 圖片辨識結果（MATCH／MISMATCH／INSUFFICIENT_DATA／DETECTED） |
|---|---|---|
| 產生位置 | `live_backend/app/vision_center.py::upload_model()`（`:387-398`） | `vision_center.py::validate_image_with_model()`（`:203-272`） |
| 觸發時機 | **入庫／導入當下**（`import_submission`／教師上傳） | 教師在 ② 手動上傳圖片時 |
| 判定內容 | ① `task == 'detect'` ② `class_names == ['CW_F','CCW_F','CW_B','CCW_B']` ③ `smoke_inference is True`（對 64×64 空白圖跑一次確認可推論） | 真實照片的偵測框、類別、信心值，再套規則 |
| 是否看真實照片 | **完全不看**（只用空白測試圖驗證「跑得動」） | 是 |
| 對模型狀態的影響 | 寫入 `validation_status`／`status` | **唯讀，不改動任何狀態**（docstring 原文：*"This never touches the ACTIVE pointer and never mutates model status"*） |

**結論**：`VALIDATED` ＝「模型載得起來、類別契約正確」；圖片辨識結果 ＝「這張照片認得對不對」。兩者互不影響——圖片驗證**不會**把 `validation_status` 改成 VALIDATED 或 FAILED；`VALIDATED` 也**不會**因圖片驗證失敗而回退。

### 1.2 當圖片結果為 NO_DETECTION、NG 或 CHECK 時，是否仍允許啟用 ACTIVE？

**是，仍然允許。** 啟用閘門只有兩處，**兩處都不看圖片結果**：

| 層級 | 位置 | 條件 |
|---|---|---|
| 後端（權威） | `vision_center.py::activate_model()`（`:445`） | `validation_status != "VALIDATED" or status == "REJECTED"` → 拒絕 |
| 前端（按鈕顯示） | `views.py::_vision_model_row()`（`:2900`） | `can_activate = validation_status == "VALIDATED" and status != "REJECTED"` |

`models.py::VisionModelRecord.active_blocked_reason()`（`:907`）的四項條件為：非 DEMO_TEST_ONLY、完整性正常、`VALIDATED`、`review_status == CANDIDATE`——**同樣不含圖片辨識結果**。

> **實證（非理論）**：V2 端到端測試中，模型 `PROP_20261015_DEMO-A_v1_3db1` 的圖片驗證結果為
> `CHECK（需要檢查）· 資料不足，無法判定`（偵測框 **0**、判定代碼 `NO_DETECTION`），
> **下一步仍成功啟用為 ACTIVE**（`v2_result.json` 案例 4 → 案例 5）。

### 1.3 DEMO 模擬驗證是否可能影響正式模型啟用條件？

**不會。** 三重隔離：

1. `simulate_prop_check()`（`:560`）只回傳固定 1 框 `CW_F / 0.76`，且必須先有 `demo_model_status()`。
2. `approve_demo_submission()`（`:517`）只寫 `submissions[].demo_active` 與 `demo_active_submissions{}`，
   **完全不碰 `models[]` 與 ACTIVE 指標**；`demo_model_status()` 回傳的是**合成編號** `DEMO_R07_<submission_id>`，不存在於 `models[]`。
3. `activate_model()` 要求目標必須存在於 `models[]` 且 `VALIDATED` → **DEMO 模擬結果在結構上不可能成為 ACTIVE**。
4. 教師圖片驗證端點 `validate_image` / `validate_image_with_model` **沒有任何模擬分支**，`FDE_DEMO_SIMULATED_INFERENCE` 對它無效。
5. Django 端 DEMO 複核入口有**雙重開關**（`views.py:3217-3220`）：需 `demo_review_approved=1` **且** `settings.VISION_DEMO_SIMULATION_ENABLED` 為真，否則直接拒絕並提示「DEMO 模擬推論未啟用，未變更任何模型狀態」。

### 1.4 是否存在教師誤操作啟用未完成圖片驗證模型的風險？

**存在（等級：中）。** 目前**沒有「必須先通過圖片驗證才能啟用」的硬性閘門**，系統只用文案勸阻：

| 情境 | 系統行為 |
|---|---|
| 圖片驗證 = CHECK | 提示「資料不足，**請勿據此啟用模型**」（`teacher_vision_center.html:320`）— **純文案** |
| 圖片驗證 = NG | 提示「**建議不要採用此模型**」（`:315`）— **純文案** |
| 從未做過圖片驗證 | 無任何提示；只要 `VALIDATED` 按鈕就出現 |
| 按下「設為正式模型」 | 通用 `confirm()`：「確定要把這個模型設為正式使用嗎？」（`:401`）— **不顯示該模型的圖片驗證結果** |

**可能情境**：教師導入學員模型（自動 `VALIDATED`）→ 圖片驗證得 CHECK 或 NG → 仍按下「設為正式模型」→ 學員端立刻改用該模型推論。

**現有緩解因素**：
- 每次啟用都有 `confirm()` 二次確認；
- 舊模型自動保留為歷史版本，可一鍵回復（V2 已實證）；
- 啟用後 Django 會核對 `inference_source.active_model_id` 是否確實切換，不一致時顯示警告（`views.py:3297`）。

> ⚠️ 依教師指示，**本輪未修改受保護的 ACTIVE 核心**。是否加閘門列為待裁決事項（見第五節）。

---

## 核驗二：Data Flywheel 資料完整性

### 2.1 逐項核對

| 教師要求確認的項目 | 狀態 | 具體證據 |
|---|---|---|
| **驗證圖片 / 可追溯的圖片參照** | **尚未實作** | ① `validate_image_with_model()` 全函式**無任何檔案寫入**，只吃 `image_bytes` 跑推論即丟棄；② 錯誤案例的 `input_reference` 僅為**檔名字串**（DEMO 現存 9 筆皆為 `IMG_7788.jpeg` / `IMG_7789.jpeg`），非可解析路徑、非圖片本體；③ `submissions[]` **無任何 image 欄位**。 |
| **模型版本** | **已實際保存** | `models[].model_id` / `version` / `file_hash` / `uploaded_at` / `source_submission_id`；DEMO store 現存 **44 筆**。 |
| **預測結果與信心值** | **部分保存（多數僅統計顯示）** | `hard_examples[]` **有** `prediction` / `confidence` 欄位，但 DEMO 現存 9 筆**全部為 `None`**；教師單圖驗證的 `predicted_class` / `predicted_confidence` / `boxes` **只存在 Django session**（`_vision_remember_validation`，`views.py:2869`），**上限 20 筆**，session 失效即遺失，且**不進入 Live Backend store**。 |
| **教師複核結果** | **機制存在、資料為空、UI 未接** | `hard_examples[]` 具備 `teacher_label` / `review_status` / `reviewed_by` / `reviewed_at`，`review_hard_example()` 可寫入 CONFIRMED／CORRECTED／REJECTED；但 DEMO 現存 9 筆**全部 `PENDING`**，且 **Django 端沒有任何呼叫**（僅存在於 Live Backend API 與其單元測試）。 |
| **錯誤案例** | **已實際保存（僅 metadata 級）** | DEMO store 現存 **9 筆**，來源全為 `RULE_ENGINE_NON_PASS`（學員端 `prop_check` 非通過），時間皆 2026-10-10，`retention_status = METADATA_AND_NECESSARY_FRAME_ONLY`。 |
| **下一輪訓練可使用的資料來源** | **尚未實作（Django 端未接）** | Live Backend 具備 `build_next_dataset()`（`:717`）與 `export_dataset()`（`:739`）且已註冊路由，`datasets` 已 15 筆；但 Django 客戶端 `vision_submission.py` **沒有** `build_next_dataset` / `export_dataset` / `create_hard_example` / `review_hard_example` 對應函式 → 教師端**無任何按鈕可產出下一輪訓練包**。 |

### 2.2 三個關鍵澄清

1. **「④ 本輪新增樣本」的資料來源是 session，不是資料庫。**
   新頁 ④ 的三項統計（新增／誤判／低信心）全部由 `_vision_validation_records(request)`（**Django session**，上限 20 筆）推導（`views.py:3032-3070`）。
   → **關閉瀏覽器、換裝置或 session 逾時，統計即歸零。** 這不是持久化的飛輪資料。

2. **兩套「複核」是不同東西，不可混為一談。**
   - 飛輪錯誤案例複核：Live Backend `hard_examples[]`（**目前 UI 未接**）。
   - 學員模型證據複核：Django `Evidence.processed_metadata.vision_model_review`（舊頁 `/teacher/vision-models/` 的 review 流程）。
   兩者**沒有任何同步關係**。

3. **④ 的「下一輪教學資源盤點」是文字狀態顯示，不產生檔案。**
   例如 `images: 缺少`、`labels: 缺少（需人工確認標註）`、`data_yaml: 匯出訓練包時產生`——這些是**狀態描述**，不是已存在的資源。

### 2.3 結論

目前 Data Flywheel 的實質能力是「**看得見的即時統計 ＋ metadata 級錯誤案例清單**」；
**尚不具備**可追溯的驗證圖片、可複核的錯誤案例流程、可匯出的下一輪訓練資料集。

> 本輪**未新增任何資料模型或 migration**（依教師限制）。

---

## 核驗三：隔離 DEMO 安全

### 3.1 實際使用哪一個資料庫及模型儲存位置

| 元件 | 隔離 :8112 實際使用 | 是否隔離 |
|---|---|---|
| Django DB | `demo/runtime/db/v2_vision.sqlite3`（`demo.sqlite3` 副本） | **是** ✅（`v2_server4.log` 實證：`測試庫：…\v2_vision.sqlite3`） |
| 模型／提交儲存 | `demo/runtime/vision-center/vision_center.json` | **否** ❌ |
| Live Backend 行程 | 與 DEMO :8110 **共用同一個 :8111 行程** | **否** ❌ |

**原因**：`start_p42_verify.ps1`（`:25`）先呼叫 `Set-DemoEnvironment`，其中
`demo_common.ps1:112` 設定 `FDE_VISION_CENTER_ROOT = <DemoRoot>\runtime\vision-center`。
:8112 與 :8110 因此指向**同一份 `vision_center.json`**。

### 3.2 是否曾寫入共用 DEMO 資料？

**是，已寫入。** 現存證據（`demo/runtime/vision-center/vision_center.json`）：

| 類型 | 新增項目 | 時間（UTC） | 對應 |
|---|---|---|---|
| submissions | `sub-00e3de9d-fc81-4232-a13b-0ed0e09ae2b1` | 2026-10-15T18:52:01Z | 早期 V2 嘗試 |
| submissions | `sub-89c0fb68-0fcd-481e-bd98-946e2728c2b4` | 2026-10-15T19:06:24Z | **V2 測試上傳的那筆** |
| models | `PROP_20261015_DEMO-A_v1` | 2026-10-15T18:52:14Z | 早期 V2 導入 |
| models | `PROP_20261015_DEMO-A_v1_3db1` | 2026-10-15T19:06:28Z | **V2 導入並曾短暫 ACTIVE** |

時間戳與 V2 執行時間（03:05–03:07 +0800 ＝ 19:05–19:07Z）**完全吻合**，可確認來源。

### 3.3 ACTIVE 切換與回滾後是否留下狀態變更？

| 項目 | 測試前 | 測試後（現況） | 判定 |
|---|---|---|---|
| `PROP_DIRECTION` ACTIVE | `PROP_20261010_X_accv2_23fd` | `PROP_20261010_X_accv2_23fd` | **已還原** ✅ |
| `demo_active_submissions` | `sub-ea18f5eb-…`（10-09） | `sub-ea18f5eb-…` | **未變動** ✅ |
| 模型筆數 | 42 | **44** | 殘留 +2（皆 ARCHIVED）⚠️ |
| submission 筆數 | 2 | **4** | 殘留 +2 ⚠️ |

**結論**：**ACTIVE 指標無狀態漂移**；但**留下 2 筆 submission 與 2 筆 ARCHIVED 模型的殘留資料**。

### 3.4 正式環境是否完全未受影響？

**是，完全未受影響。** ✅

- 正式 Django `:8022` 未參與本輪任何請求。
- 正式路徑 `D:\FDE-AI-UAS-data\vision-center` **不存在**（未建立）。
- 預設 store `%LOCALAPPDATA%\FDE-AI-UAS\vision-center\vision_center.json` **mtime 仍為 2026-10-08 12:37，未變動** ✅。
- 未動正式 DB、未 commit、未 push、未部署。

### 3.5 風險評級

**低～中。** 影響範圍限於 **DEMO 展示資料**（非正式環境），且 ACTIVE 已還原；
但「隔離測試寫入共用 DEMO store」屬**驗收方法上的不嚴謹**——
後續若要重跑隔離驗收，建議將 `FDE_VISION_CENTER_ROOT` 指向獨立目錄（**需教師核准後才執行**）。

---

## 核驗四：教師端重複頁面

### 4.1 入口位置

| 頁面 | 路由 | 入口 |
|---|---|---|
| 新頁（本輪四區塊） | `/teacher/vision-center/` | 教師後台卡片「AI 視覺模型中心」→「開啟 AI 視覺模型中心」（`teacher_dashboard.html:10`，**主要按鈕**） |
| 舊頁 | `/teacher/vision-models/` | **教師後台沒有直接入口**。僅能由 `teacher_vision_flywheel.html:4` 與 `teacher_vision_model_detail.html:4` 的「返回視覺模型中心」反向進入；而「資料飛輪倉庫」卡片（`teacher_dashboard.html:11`）→ 飛輪頁 → 再「返回視覺模型中心」→ 才會到達舊頁 |

### 4.2 功能重疊

| 面向 | 新頁 `/teacher/vision-center/` | 舊頁 `/teacher/vision-models/` |
|---|---|---|
| 步驟結構 | 四區塊：① 待複核模型 ② 教師圖片驗證 ③ 當前正式模型 ④ Data Flywheel | 四步驟：01 學員模型提交 02 圖片驗證 03 啟用 04 保存資源 |
| 圖片驗證 | **可實際執行真實推論** | **按鈕已停用**：`teacher_vision_model_verify_run` 直接回「圖片驗證 Runner 尚未接入，未執行任何推論」（`views.py:2059`） |
| 啟用 ACTIVE | **有**（`teacher_vision_center_activate`） | **無啟用路由**（`urls.py` 中 vision-models 底下僅 detail／review／catalogue／verify／verify_run） |
| 「啟用」語意 | Live Backend `models[]` 的 ACTIVE 指標 | Django `VisionModelRecord` 入庫紀錄（`catalogue` ＋ 完整性檢查 ＋ Golden Test）→ **另一套東西** |
| 底層資料 | 讀 Live Backend `models[]` / `submissions[]` | **同一個** Live Backend `models[]`，另疊加 Django `VisionModelRecord` 維度 |
| 用語風格 | 教師語意（已中文化） | 工程語意（SHA256、完整性檢查、Golden Test、訓練用途） |

### 4.3 使用者可能遇到的混淆

1. **兩頁 `<title>` 與 `<h1>` 完全相同**：皆為「AI 視覺模型中心｜FDE-AI」／「AI 視覺模型中心」。
   → 教師從飛輪倉庫按「返回視覺模型中心」，實際到達的是**舊頁**，但標題一模一樣，**會誤以為回到了新頁**。
2. **兩頁都是「四步驟」**，語意重疊但版面與用語完全不同 → 教師容易記錯自己在哪一頁。
3. **同名功能、能力不同**（最易誤導）：舊頁 02 的「圖片驗證」按鈕存在但**一按就報「Runner 尚未接入」**。
4. **同一個 ACTIVE 指標、兩頁不同呈現**：舊頁看不到 Live Backend 的 ACTIVE 切換結果，教師可能在舊頁找「為什麼沒有生效」。

> 本輪**未刪除任何頁面或路由**（依教師指示）。

---

## 核驗五：交付

### 5.1 已確認安全的項目

1. **圖片驗證與模型驗證是兩套獨立判定**，圖片驗證為唯讀、不改任何模型狀態、不切換 ACTIVE。
2. **未通過結構驗證（`validation_status != VALIDATED`）或 `REJECTED` 的模型，前後端雙重閘門都無法啟用**。
3. **DEMO 模擬推論在結構上不可能成為 ACTIVE**；教師驗證端點無模擬分支。
4. **跨進程呼叫一律帶 `X-FDE-Role: teacher` ＋ `X-FDE-Teacher-ID`**，缺任一即 403（`vision_api.py:14-20`）。
5. **啟用失敗不會讓任務失去模型**：先驗證新模型檔案存在，才封存舊 ACTIVE（`activate_model` 註解明示）。
6. **回滾為可逆操作**：被替換版本一律 `ARCHIVED` 保留、**永不刪除**。
7. **本輪所有動作未觸碰正式 DB、正式 store、受保護核心**；未 commit／未部署。
8. **隔離測試的 Django DB 確實獨立**（`v2_vision.sqlite3`），未污染 `demo.sqlite3`。
9. **`ACTIVE` 切換與回滾後無狀態漂移**（已還原為原值）。

### 5.2 存在風險的項目

| # | 風險 | 等級 | 說明 |
|---|---|---|---|
| **R1** | 圖片驗證結果**不構成啟用條件** | **中** | 即使 NO_DETECTION／NG／CHECK，教師仍可啟用 ACTIVE（V2 已實證）。僅有文案勸阻，無硬性閘門。 |
| **R2** | 隔離驗收**寫入共用 DEMO store** | 低～中 | `FDE_VISION_CENTER_ROOT` 未隔離；已殘留 2 submissions ＋ 2 ARCHIVED models（ACTIVE 已還原）。 |
| **R3** | 驗證歷史只存 **session（上限 20 筆）** | **中** | 教師單圖驗證紀錄與 ④ 三項統計皆綁 session；換裝置／逾時即遺失，無法作為飛輪資料。 |
| **R4** | 錯誤案例**無圖片、無預測值** | **中** | 9 筆 `hard_examples` 皆 `prediction=None`、`input_reference` 僅檔名字串；無法追溯、無法直接用於再訓練。 |
| **R5** | 下一輪訓練資料集**無 UI 可產出** | **中** | `build_next_dataset` / `export_dataset` 未接 Django；教師無法匯出訓練包。 |
| **R6** | 兩頁同名、舊頁圖片驗證已停用 | 低～中 | 教師可能誤入舊頁，按了圖片驗證卻得到「Runner 尚未接入」。 |
| **R7** | 舊頁既有測試失敗 1 項 | 低 | `test_vision_flywheel_framework`（「訓練用途」欄），屬保護區另一頁，本輪未動。 |

### 5.3 需要教師裁決的項目

1. **是否要把「圖片驗證通過（MATCH）」設為啟用 ACTIVE 的必要條件？**
   改動點：`can_activate`（`views.py:2900`）＋ `activate_model` 閘門（`vision_center.py:445`）。
   ⚠️ **屬受保護的 ACTIVE 核心，須教師明確核准才可動。**
2. 若不改閘門，是否至少在啟用確認框**顯示該模型最近一次圖片驗證結果**？（僅改模板，風險低）
3. **Data Flywheel 是否要保存驗證圖片本體？** 若要，需指定儲存位置、保存期限與個資考量。
   ⚠️ 依限制**不得新增資料模型或 migration**，須以既有 store 欄位表達。
4. 是否要接上 `build_next_dataset` / `export_dataset`，讓教師能匯出下一輪訓練包？
5. 是否要**合併或下架 `/teacher/vision-models/`**？（本輪未動）
6. 是否核准**清理** V2 測試在 DEMO store 留下的 2 submissions ＋ 2 ARCHIVED models？
   （**未經核准不會清理**）
7. 後續隔離驗收是否改用獨立 `FDE_VISION_CENTER_ROOT`？

### 5.4 最後人工驗收清單

> 以下全部標 `PENDING_MANUAL`，教師完成前不得寫 `REAL DEVICE PASS`。

**A. 真實圖片驗證**
1. 以真實槳葉照片在 ② 驗證候選模型，確認判定為 PASS／NG／CHECK 且數值合理。
2. 故意上傳一張無關照片，確認顯示 CHECK（NO_DETECTION），並**不要**啟用。
3. 確認「最近的驗證紀錄」表格內容與剛才操作一致。

**B. 啟用與回滾**
4. 選一個圖片驗證 PASS 的模型按「設為正式模型」，確認 ③ 顯示的正式模型已更新。
5. 按「回復舊版本」，確認回到原模型，且舊版本仍列於「模型版本清單」。
6. **（風險驗證）** 刻意在圖片驗證為 CHECK 的模型上按「設為正式模型」，確認系統**確實允許**（＝R1 成立），據此決定是否要加閘門。

**C. Data Flywheel**
7. 確認 ④ 三項統計在完成一次驗證後 +1。
8. **重新登入或換一台裝置**，確認 ④ 統計歸零（＝R3 成立）。
9. 確認「錯誤案例」表格的內容與可追溯性是否足夠。

**D. 重複頁面**
10. 從教師後台按「開啟 AI 視覺模型中心」，記錄看到的頁面。
11. 從「資料飛輪倉庫」→ 按「返回視覺模型中心」，確認是否**誤以為回到同一頁**（＝R6 成立）。

**E. 手機**
12. 以**真實 iPhone Safari** 開 ②③④，確認可讀、可點（Chrome 390×844 模擬已 10/10，真機未驗）。

**F. 環境**
13. 確認正式 `:8022` 在整個驗收過程未受影響。

---

## 附錄：本輪核驗所用證據來源

| 檔案 | 用途 |
|---|---|
| `live_backend/app/vision_center.py` | `validate_image_with_model`（203-272）、`activate_model`（436-470）、`upload_model`（359-406）、`approve_demo_submission`（517-537）、`simulate_prop_check`（560-583）、`create_hard_example`（751-760）、`review_hard_example`（765-771）、`build_next_dataset`（717）、`export_dataset`（739） |
| `live_backend/app/vision_api.py` | 教師認證 `_teacher()`（14-20）、`activate`（69-78）、`validate_image`（291-320）、`prop_check`（89-115，唯一建立 hard example 的路徑） |
| `student_portal/learning/views.py` | `_vision_remember_validation`（2869）、`_vision_model_row.can_activate`（2900）、`teacher_vision_center`（2907-3117）、`_validate`（3122）、`_import`（3209）、`_activate`（3282）、`_rollback`（3317）、`_upload`（3340）、`verify_run` 停用（2051-2060） |
| `student_portal/learning/models.py` | `VisionModelRecord`（683-918）、4 條 CheckConstraint（845-854）、`active_blocked_reason`（907-918） |
| `student_portal/learning/vision_submission.py` | Django 端可用 API 清單（**無** build_next_dataset／export_dataset／create_hard_example／review_hard_example） |
| `student_portal/learning/templates/learning/teacher_vision_center.html` | 判定提示文案（309-322）、啟用確認框（401）、未驗證阻擋文案（408） |
| `demo/tools/demo_common.ps1:112` | `FDE_VISION_CENTER_ROOT` 指向共用 DEMO store |
| `demo/tools/start_p42_verify.ps1:25,36` | 隔離服務呼叫 `Set-DemoEnvironment`；僅 `DJANGO_DB_NAME` 被覆寫 |
| `demo/runtime/vision-center/vision_center.json` | 44 models／4 submissions／9 hard_examples／15 datasets／`demo_active_submissions` |
| `.test-temp/vision-center-v1/v2_result.json` | V2 端到端 17/17，含 CHECK→ACTIVE 實證 |
| `.test-temp/vision-center-v1/v2_server4.log` | 隔離服務實際 DB 路徑實證 |

**環境現況（核驗時）**：正式 Django `:8022`（PID 4668）、RAG `:8770`（PID 19088）、DEMO Django `:8110`（PID 7444）、DEMO Live Backend `:8111`（PID 9492）、隔離 `:8112`（PID 20400）；YOLO `:8765` 未啟動。
