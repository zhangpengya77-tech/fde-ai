# 教師端 AI 視覺模型中心 V1–V4 交付報告

- 日期：2026-10-16
- 專案：FDE-AI-UAS 2.0（`D:\FDE-AI-UAS-v2.0`，分支 `fde-ai-v2.0-dev`）
- 依據：教師 2026-10-16「教師端 AI 視覺模型中心開發裁決」（六節）
- 範圍：**只修改教師後台「AI 視覺模型中心」**（`/teacher/vision-center/`）。未新增資料模型、未新增 migration、未重寫 YOLO 訓練／推論／R07 上傳／教師審核／ACTIVE 切換／回滾核心、未動正式資料庫與正式部署。
- 狀態：**V1–V4 全部完成並通過自動化驗證**；教師人工驗收尚未進行（依指示完成後統一回報）。

---

## 一、教師後台簡化前後差異

### 1.1 頁面入口（未變）

教師後台首頁卡片「AI 視覺模型中心」→ `開啟 AI 視覺模型中心` → `/teacher/vision-center/`。
**本輪未新增或移除任何入口**；`/teacher/vision-models/`（另一頁，含 01｜學員模型提交 等步驟）不在本輪範圍，未修改。

### 1.2 主畫面：改為四區塊

| 區塊 | 內容 | 說明 |
|---|---|---|
| ① 待複核模型 | 學員上傳的 `best.pt` 清單 | 每張卡片只顯示：學員 ID／小組／任務類型／上傳時間＋**「開始驗證」大按鈕**。舊按鈕文字「導入為候選模型」已改為「開始驗證」。 |
| ② 教師圖片驗證 | 選模型＋上傳圖片＋教師標註＋信心值門檻 | 結果以**大字**顯示 `PASS（通過）／NG（失敗）／CHECK（需要檢查）`，並列出 AI 預測類別、Confidence、教師標註、系統說明。 |
| ③ 當前正式模型 | 目前 ACTIVE 模型＋**模型版本清單**＋「回復舊版本」 | 可設為正式模型的版本清單（未通過驗證者不提供啟用按鈕），另有「先驗證圖片 →」直達連結。 |
| ④ Data Flywheel（資料飛輪） | **本輪新增樣本／誤判樣本／低信心樣本**三項統計＋錯誤案例表＋「進入資料飛輪」 | 全部由既有驗證紀錄推導，**不新增資料表、不寫入任何檔案**。 |

### 1.3 收進「進階管理」（頁尾 `<details>`，預設收合）

一般教師不需要看到的工程內容全部收進此處：
1. 任務類型切換（槳葉方向／四面懸停）
2. 推論服務與版本狀態（`api_detail`）
3. 教師自行上傳模型（`上傳並檢查`）
4. 系統運作方式（供技術人員參考）

### 1.4 移除的工程術語與技術欄位

主畫面（排除 `<details>` 進階資訊）**已無任何工程術語**：自動化檢查以 16 個關鍵詞（`SHA256`／`migration`／`ultralytics`／`JSON`／`endpoint`／`rollback`／`deploy`／`SQLite`／`資料表`／`欄位`／`API` 等）掃描可見文字，**0 命中**。

技術欄位（提交編號、檔案指紋 SHA256、模型編號、規則版本、判定代碼、執行環境…）全部改置於各區塊的「進階資訊」`<details>` 內，預設收合。

### 1.5 用語簡化對照（教師端）

| 原本（工程語意） | 現在（教師語意） |
|---|---|
| `SUBMITTED` | 待複核 |
| `IMPORTED` | 已導入（待驗證） |
| `REJECTED` | NG（未採用） |
| `NOT_EVALUATED` | 未驗證 |
| `VALIDATED` | PASS（已通過驗證） |
| `FAILED` | NG（檢查失敗） |
| `CANDIDATE` | 候選模型（待驗證） |
| `ACTIVE` | ACTIVE（正式模型） |
| `ARCHIVED` | 歷史版本 |
| `MATCH` | PASS（通過）· 預測與教師標註相符 |
| `MISMATCH` | NG（失敗）· 預測與教師標註不相符 |
| `INSUFFICIENT_DATA` | CHECK（需要檢查）· 資料不足，無法判定 |
| `DETECTED` | CHECK（需要檢查）· 已辨識（教師未標註） |

---

## 二、學員 best.pt 是否自動進入待複核

**是。已於隔離 DEMO 實測通過。**

- 學員路徑：`成長紀錄 R07 → 上傳 best.pt` → `POST /student/courses/<enrollment>/growth/R07/model/`
  （`views.growth_model_upload`）→ 建立 `Evidence(evidence_type=MODEL, task_type=PROP_DIRECTION)`
  → `submit_model_evidence_to_vision()` → Live Backend `POST /api/v1/vision/submissions`，狀態 `SUBMITTED`。
- 教師端 ① 待複核模型**自動出現該筆提交**，無需教師自行找檔案。
- 實測（V2）：上傳前 2 筆待複核 → 上傳後 3 筆，新增 `sub-89c0fb68-0fcd-481e-bd98-946e2728c2b4`。
- **學員模型永遠不會自動成為正式模型**（此點在頁面文案與後端契約皆明確）。

---

## 三、圖片真實推理是否跑通

**是。教師「② 教師圖片驗證」走的是真實 ultralytics 推論，不是 DEMO 模擬路徑。**

證據鏈：

1. Django `teacher_vision_center_validate` → `learning/vision_submission.py`（唯一跨進程轉發層）
   → Live Backend `POST /api/v1/vision/models/{model_id}/validate-image`
   → `VisionCenter.validate_image_with_model()` → `UltralyticsModelRunner.predict()`
   → `YOLO(path)` ＋ `model.predict(source=image)`（真實載入 .pt、真實執行）。
2. **DEMO 模擬開關不影響此路徑**：`FDE_DEMO_SIMULATED_INFERENCE=1` 只作用於學員端 `prop_check`
   （`vision_center.simulate_prop_check`，固定回傳 1 個 `CW_F/0.76` 框）。
   教師驗證端點**沒有任何模擬分支**。
3. 實測對照：以合成測試圖驗證，結果為 `偵測框 = 0`、`判定代碼 = NO_DETECTION`
   → 與模擬路徑（固定 1 框）明顯不同 → **確認走真實推論**。
4. 導入模型經真實載入驗證：`validation_status = VALIDATED`、`class_names = ['CW_F','CCW_F','CW_B','CCW_B']`。
   （未通過真實載入者不可能取得 `VALIDATED`，也不可能被啟用——見第五節閘門。）
5. 既有驗收工具 `demo/tools/verify_teacher_vision_center.py` 的「驗收1／驗收3」歷來即以真實 .pt
   載入＋真實推論通過。

> **重要區分**：本機（含 DEMO）**沒有真實槳葉照片**，故真實推論在合成圖上「偵測 0 個目標」
> 屬模型正常行為，不代表推論失敗；真實辨識準確度仍需教師以真實照片驗收。

---

## 四、ACTIVE 模型是否成功切換

**是。切換、保留歷史、回復舊版本三項全部通過。**

- 啟用閘門（既有，未修改）：`VisionModelRecord` 4 條 CheckConstraint 強制 ACTIVE 必須 `VALIDATED` 且非 DEMO；
  `active_blocked_reason()` 為啟用前的唯一判斷點。
- 實測（V2，隔離 DEMO）：
  1. 導入候選模型 `PROP_20261015_DEMO-A_v1_3db1`
  2. 圖片驗證 → **ACTIVE 不變**（`PROP_20261010_X_accv2_23fd`）→ 驗證與啟用分離
  3. 教師按「設為正式模型」→ 頁面顯示「已設為正式模型」
     → Live Backend `active_model_id = PROP_20261015_DEMO-A_v1_3db1` ✅
  4. 按「回復舊版本」→ 頁面顯示「已回復到版本」
     → ACTIVE 回復為 `PROP_20261010_X_accv2_23fd`（＝原值）✅
  5. 舊模型仍在歷史中（歷史 29 筆，含本次導入模型）✅
- 收尾已將 DEMO ACTIVE 還原為原始模型，未留下狀態漂移。

---

## 五、Data Flywheel 是否收到驗證資料

**是。教師在 ② 做的每一次驗證都會累積到 ④。**

- ④ 三項統計（本輪新增，純顯示、唯讀）：
  - **本輪新增樣本** ＝ 該任務的驗證紀錄總數
  - **誤判樣本** ＝ `verdict == MISMATCH`（教師標註與預測不符）
  - **低信心樣本** ＝ `predicted_confidence < confidence_threshold`
- 資料來源：教師驗證紀錄（`_vision_remember_validation`）＋ Live Backend `hard_examples`
  （錯誤案例表：來源／預測／信心值／狀態／時間）。
- 實測（V2）：完成一次圖片驗證後，④「本輪新增樣本」由 0 → **1 筆**（誤判 0 筆、低信心 0 筆，
  因該次判定為 CHECK／NO_DETECTION）。
- **未新增任何資料模型或資料表**；Django 端不建立第二套飛輪儲存。

---

## 六、自動化驗證結果

### V1 四區塊介面重整

| 項目 | 結果 |
|---|---|
| `learning.tests.test_teacher_vision_center_page` | **32 / 32 OK** |
| `learning.tests.test_teacher_vision_acceptance` | **29 / 29 OK** |

### V2 隔離 DEMO 端到端流程

隔離方式：Django **:8112**（獨立行程）＋ `demo/runtime/db/v2_vision.sqlite3`（`demo.sqlite3` 副本）
＋ Live Backend :8111（DEMO 既有服務）。**全程未觸碰 :8110／demo.sqlite3／:8022 正式服務。**

工具：`.test-temp/vision-center-v1/verify_v2_flow.py` → **17 / 17 PASS**（`v2_result.json`）

### V3 教師用語簡化與手機排版

工具：`.test-temp/vision-center-v1/verify_v3_teacher_mobile.cjs` → **10 / 10 PASS**（`v3_result.json`）

| 檢查 | 結果 |
|---|---|
| 桌面｜頁面標題「AI 視覺模型中心」 | PASS |
| 桌面｜四區塊依序呈現 | PASS |
| 桌面｜主畫面無工程術語（排除進階資訊） | PASS（0 命中） |
| 桌面｜「進階管理」預設收合 | PASS |
| 手機 390×844｜無水平溢出 | PASS（scrollWidth 390 ＝ clientWidth 390） |
| 手機 390×844｜四區塊單欄呈現 | PASS |
| 手機 390×844｜主要按鈕高度 ≥ 44px | PASS（12 個按鈕，最小 44px） |
| 手機 390×844｜無元素超出視窗右緣 | PASS（表格皆被 `.vc-scroll` 容納） |

> ⚠️ Chrome 裝置模擬**不等於**真實 iPhone Safari 驗收；真機一律標 `PENDING_MANUAL`。

### V4 回歸

| 項目 | 結果 |
|---|---|
| 六模組全套（最終模板前） | 152 項，**1 項本輪缺陷（已修）＋1 項既有失敗** |
| 本輪缺陷：`test_unverified_model_cannot_activate` | 模板漏掉「此版本」前綴 → **已修正** |
| 既有失敗：`test_vision_flywheel_framework::test_teacher_sees_only_authorized_models_with_four_status_dimensions` | 斷言 `訓練用途`，屬 **`/teacher/vision-models/`（另一頁）**，本輪未修改該模板（mtime 2026-10-10 19:15）→ **既有失敗，保留** |
| 修正後複測（最終模板） | `test_teacher_vision_center_page` ＋ `test_teacher_vision_acceptance` = **61 / 61 OK** |

---

## 七、修改檔案清單

| 檔案 | 變更 |
|---|---|
| `student_portal/learning/templates/learning/teacher_vision_center.html` | 整檔重寫為四區塊＋進階管理；新增 `.vc-cta`（min-height 52px）、`.vc-verdict-big`、`.vc-stats`／`.vc-stat`、`.vc-admin`、`.vc-flowline`；所有表格包 `.vc-scroll`；`.vc-actions .button` 最小高度 44px；手機 media query（≤640px）單欄化 |
| `student_portal/learning/views.py` | `VISION_CENTER_STATUS_LABELS`／`SUBMISSION_LABELS`／`VERDICT_LABELS` 中文化；`teacher_vision_center` 新增 Data Flywheel 三項統計（`new_samples`／`mismatch_samples`／`low_confidence_samples`）。**未新增 view、未新增路由、未改任何 POST 子路由行為** |
| `student_portal/learning/tests/test_teacher_vision_center_page.py` | 四區塊名稱斷言同步（「待複核模型／教師圖片驗證／當前正式模型／Data Flywheel」）；`tab` 參數測試改斷言新區塊名 |

**未修改**：`urls.py`、`models.py`、`forms.py`、`vision_submission.py`、`vision_center.py`、`vision_api.py`、
R01–R08、R07 提交鏈、`best.pt`、F450 十二任務、Flight Health AI、`live/`、`live_backend/`、
`teacher_vision_model_list.html`、`teacher_vision_flywheel.html`、migration、正式 DB。

---

## 八、截圖

`.test-temp/vision-center-v1/shots/`

| 檔案 | 內容 |
|---|---|
| `v3_desktop_vision_center.png` | 桌面 1440×900：標題、流程線、① 待複核模型卡片 |
| `v3_mobile_vision_center.png` | 手機 390×844：單欄、大按鈕 |
| `v3_mobile_block3_active.png` | 手機：③ 當前正式模型 |
| `v3_mobile_block4_flywheel.png` | 手機：④ Data Flywheel（三項統計＋錯誤案例表） |

---

## 九、環境現況（本輪收尾後）

- DEMO 常駐：Django PID **1768** `192.168.1.114:8110`、Live Backend PID **9492** `192.168.1.114:8111`
  （已重啟以載入最終模板；實測 `vc-scroll = 10`、四區塊齊備、修正已生效）。
- 隔離驗收服務：Django `:8112` ＋ `demo/runtime/db/v2_vision.sqlite3`（僅供驗收，可隨時停止）。
- 未 commit、未 push、未部署、未動正式 DB。
- 本輪未修改任何受保護核心。

## 十、待教師確認事項

1. **真實照片辨識準確度**：本機無真實槳葉照片，需教師以真實圖片驗收「② 教師圖片驗證」。
2. **iPhone Safari 真機**：手機版面目前僅 Chrome 裝置模擬（390×844）通過，真機待驗。
3. **`/teacher/vision-models/` 另一頁**：與本頁功能重疊，是否併入或下架，請教師指示（本輪未動）。
4. **DEMO 模擬捷徑**：① 的「DEMO 模擬複核（不啟用正式模型）」僅供流程展示，
   **不得視為真實辨識通過、不得據此啟用正式 ACTIVE 模型**（頁面已明確標示）。
5. **既有測試失敗 1 項**：`test_vision_flywheel_framework`「訓練用途」欄，屬保護區另一頁，未動。
