# 教師模型中心｜安全收尾交付報告（P0–P4）

- 日期：2026-10-16
- 分支：`fde-ai-v2.0-dev`（**未 commit／未 push／未 deploy**）
- 對應教師指令：三、P0–P4「安全收尾裁決」
- 相關文件：
  - `TEACHER_VISION_CENTER_SAFETY_AUDIT_2026-10-16.md`（上一輪唯讀核驗）
  - `TEACHER_VISION_CENTER_P1B_ACTIVE_ACTIVATION_PLAN_2026-10-16.md`（P1-B 方案，待核准）
  - `TEACHER_VISION_CENTER_P2_DATA_FLYWHEEL_DESIGN_2026-10-16.md`（P2 設計，待核准）

---

## 摘要（一句話版）

**P0 隔離驗收已做到真正獨立（15/15 行為證明）；P1／P2 的教師畫面已如實揭露風險，但 ACTIVE 核心閘門與資料寫入流程一律未動；P3 舊版頁面已標示為「進階模型管理」並保留全部路由；需教師授權的後端核心修改已列清單。**

---

## P0｜隔離驗收環境修正（已完成並取得行為證明）

### 問題（修正前）

`start_p42_verify.ps1` 呼叫 `Set-DemoEnvironment`，而該函式設定
`$env:FDE_VISION_CENTER_ROOT = <DemoRoot>\runtime\vision-center`（`demo_common.ps1:112`）
→ **8112 隔離驗收與 8110 DEMO 共用同一份模型儲存區**，違反「隔離」語意。

### 修正內容（4 個檔案）

| 檔案 | 變更 |
| --- | --- |
| `demo/tools/start_vision_isolated.ps1` | **新建**：完全隔離啟動器（隔離 Live Backend :8117 ＋ 隔離 Django :8112 ＋ 獨立 DB）。含多重安全閘（禁 8110／8111、禁指向 DEMO／正式 store、必須位於 `.test-temp` 之下）。 |
| `demo/tools/seed_vision_isolated_store.py` | **新建**：DEMO→隔離**單向複製**（覆寫不刪除，避開沙箱 safe-delete 保護）＋ 重寫 `vision_center.json` 內絕對路徑。 |
| `demo/tools/verify_vision_isolation.py` | **新建**：隔離行為證明（15 項）。 |
| `demo/tools/start_p42_verify.ps1` | **修改**：注入隔離區塊，改用自己的 store／Live 埠，不再寫入共用 DEMO store。 |

### 隔離證明結果（`isolation_result.json`，15/15 PASS）

| 關鍵項 | 結果 |
| --- | --- |
| 三個儲存區路徑互不相同 | PASS（isolated／demo／prod 三路徑皆不同） |
| 隔離區位於 `.test-temp` 之下 | PASS |
| 隔離 Live Backend :8117 可用 | PASS（HTTP 200） |
| 透過隔離 Live Backend 建立提交 | PASS（HTTP 201，僅寫隔離區） |
| **DEMO 共用區未被寫入** | PASS（sha256 `1db66c1f0397…` 與 mtime **全程不變**） |
| **正式區未被寫入** | PASS（sha256 `7b3f674fbca0e6a1…`，mtime 2026-10-08 12:37:51 不變） |
| ACTIVE 切換只在隔離區生效 | PASS |
| 回滾只在隔離區生效 | PASS |
| 全程結束後 DEMO 區仍完全未變 | PASS |
| **隔離區 65 筆路徑全指向隔離目錄（0 筆指回 DEMO）** | PASS |

### 附帶事實

- 種子路徑重寫 **63 筆**；隔離區模型檔可用 27／44（缺 17 筆為 **DEMO 原有的歷史缺檔**，非本次造成）。
- **既有 V2 測試殘留依教師指示全部保留，未刪除。**

---

## P1｜ACTIVE 啟用安全（前端揭露已完成；核心閘門**未動**）

### 現況風險（R1）

`VALIDATED` 由**結構驗證**在入庫當下設定（`task=='detect'` ＋ 類別契約正確 ＋ 64×64 空白圖 smoke inference），**完全不看真實照片**；而 ACTIVE 閘門只檢查 `VALIDATED`（`vision_center.py:445`、`views.py:2957`）。
→ 教師可能誤把「已通過驗證」解讀為「真實辨識品質已通過」。

### 本輪完成（僅教師畫面揭露，零後端行為變更）

`views.py` 新增：`IMAGE_EVIDENCE_LABELS／CSS／NOTES`、`STRUCTURE_VALIDATED_NOTE`、
`_vision_latest_image_evidence()`、`_vision_image_evidence_state()`、
`_vision_model_row(validation_records=…)` 新增 9 個欄位、`models_without_proven_quality`。
驗證 payload 新增 `evidence_source="REAL_INFERENCE"`。

`teacher_vision_center.html` 新增三項揭露：

1. **模型結構驗證狀態**（「已通過結構驗證」只代表可載入、類別契約正確）。
2. **最近一次真實圖片驗證結果**（PASS／NG／CHECK／尚未做過；含時間、預測類別、信心值、偵測框數、來源）。
3. **是否已有足夠真實圖片驗證依據**——不足者明確標示「**尚未證實模型辨識品質**」。

並明示：本判定來自**真實推論**，**不是 DEMO 模擬結果**。

### 明確聲明

- **本輪未修改 ACTIVE 核心閘門**（Live `activate_model()`、Django `can_activate`、`active_blocked_reason()` 一字未動）。
- 未把 `VALIDATED` 解釋成真實辨識已通過。
- 未把 DEMO 模擬當成正式驗證（DEMO 結果本身也不可能成為 ACTIVE）。
- 正式啟用條件方案（四類槳葉方向標準 ＋ 後端強制檢查 ＋ 回滾策略）見 **P1-B 文件**，**待教師核准**。

---

## P2｜Data Flywheel 真正閉環（設計完成；未新增任何寫入）

### 本輪完成

- 盤點 A／B／C 三類（詳見 **P2 設計文件**）。
- **前端如實說明修正**：不再把 session 暫存統計描述為完整 Data Flywheel。四區塊第 ④ 區明確標示「統計來自本次登入的工作階段（最多 20 筆），**不是完整的資料飛輪**；圖片本體與下一輪訓練資料集**尚未持久化**」；錯誤案例區明示「**教師②的單張圖片驗證目前不會自動產生錯誤案例**」。

### 核心事實（供教師判讀）

| 分類 | 內容 |
| --- | --- |
| **A 已實際保存** | 模型版本登錄（含 hash／類別／dataset／rule 版本／來源）、學員提交、Django `VisionModelRecord`（4 狀態維度＋6 條 DB 約束）、`GoldenSet`／`GoldenSetSample`（**教師標註的真實圖片**）、評估指標、資料集、學員端錯誤案例 |
| **B 可用既有服務接通** | Live 端 `create_hard_example`／`review_hard_example`／`build_next_dataset`／`export_dataset` **皆已存在**；缺的是 **Django 端 4 個 client 函式**與 UI |
| **C 需授權** | ①教師驗證紀錄持久化 ②錯誤案例補「圖片＋教師標註＋預測值」 ③教師驗證接入錯誤案例 ④下一輪資料集 UI ⑤資料保留政策 ⑥啟用證據持久化 |

### 明確聲明

- **未新增 migration、未改寫資料模型、未啟用任何新寫入流程。**
- 教師②的驗證紀錄**仍然只在 session（20 筆）**；錯誤案例**仍然只由學員端產生**。

---

## P3｜舊版模型中心（保留全部路由，僅最小標示）

### 入口與反向連結盤點（完整）

| 來源 | 目標 | 狀態 |
| --- | --- | --- |
| `teacher_dashboard.html:10` | **AI 視覺模型中心**（主按鈕） | ✅ 主入口指向新版 |
| `teacher_dashboard.html:11` | 資料飛輪倉庫（**標示「進階」**） | ✅ 次要入口 |
| `teacher_vision_model_list.html:53` | AI 視覺模型中心（導引連結） | ✅ 本輪新增 |
| `teacher_vision_center.html:547` | 資料飛輪 | 保留 |
| `teacher_vision_model_list.html:126` | 資料飛輪 | 保留 |
| `teacher_vision_flywheel.html:4`、`teacher_vision_model_detail.html:4` | 返回**進階模型管理** | ✅ 本輪改字 |
| `teacher_golden_set_list.html:4`、`teacher_golden_test.html:4` | 返回資料飛輪倉庫 | 保留 |

### 最小標示方案（已實作，未刪任何頁面／路由）

- 頁面標題 `AI 視覺模型中心` → **`進階模型管理`**（`{% block title %}` 亦改）。
- eyebrow 改「教師後台 · 進階」；purpose 明示「本頁為**進階／工程檢視**…日常請使用『**AI 視覺模型中心**』」。
- 新增 `.vision-status` 導引區塊，直接連結新版中心。
- 反向連結統一改「返回進階模型管理」。

### 路由現況（**全部保留**）

```
/teacher/vision-center/                 ← 新版（單頁四區塊）
/teacher/vision-center/{validate,import,activate,rollback,upload}/
/teacher/vision-models/                 ← 舊版（已標示「進階模型管理」）
/teacher/vision-models/<uuid>/{,review,catalogue,verify,verify/run}/
/teacher/vision-flywheel/
```

### 測試依賴（**未修改任何測試**）

| 測試檔 | 依賴 |
| --- | --- |
| `test_vision_model_center.py` | `teacher_vision_model_list`、`teacher_vision_model_detail` |
| `test_teacher_vision_acceptance.py` | 舊頁模板名、**四步驟標題字串**（01–04）、`reverse('…flywheel')` |
| `test_vision_flywheel_framework.py` | 兩路由存在性（:92-93） |
| `test_vision_repository.py` | 兩路由存在性（:422-423） |
| `test_vision_snapshot.py`、`test_teacher_catalogue.py`、`test_golden_set_center.py`、`test_golden_set_contract.py`、`test_student_prop_scan_page.py` | flywheel／detail／verify 路由 |

> 已逐項確認：本輪 P3 編輯**未移除** `test_teacher_vision_acceptance.py` A2 所斷言的四步驟標題與其他字串。

---

## P4｜統一回報（教師指定五項）

### 1. 隔離驗收是否真正獨立？

**是。** 三層皆獨立：Django DB（`v2_vision.sqlite3`）、模型 store（`.test-temp/vision-isolated/live-vision-store`）、Live Backend 行程（:8117）。
行為證明 **15/15 PASS**：DEMO 與正式 store 的 sha256／mtime **全程不變**；隔離區 65 筆路徑**全指向隔離目錄**（0 筆指回 DEMO）。既有 V2 殘留**依指示保留未刪**。

### 2. ACTIVE 啟用風險是否已在教師畫面清楚揭露？

**是（僅揭露，未阻擋）。** 三項揭露已上線：結構驗證狀態、最近一次真實圖片驗證結果、是否已有足夠依據；不足者明確警示「尚未證實模型辨識品質」。
**但核心閘門未動**——這正是教師本輪的要求。正式啟用條件方案見 P1-B 文件。

### 3. 資料飛輪哪些真正保存、哪些尚未接通？

- **真正保存（A）**：模型版本登錄、學員提交、Django 模型倉庫紀錄、黃金測試集與樣本、評估指標、資料集、**學員端**錯誤案例。
- **尚未接通（B）**：教師②驗證結果寫入錯誤案例、錯誤案例複核、下一輪資料集產生／匯出——Live 端端點**已存在**，缺 Django client 與 UI。
- **尚未持久化（C）**：**教師②的單張圖片驗證紀錄目前只在 session（20 筆）**；錯誤案例**無圖片本體、無教師標註**。

### 4. 舊版模型中心如何避免與新版混淆？

後台**主按鈕**指向新版「AI 視覺模型中心」，舊版以**次要入口**並標示「進階」；舊版頁面改名「進階模型管理」＋ 加導引連結 ＋ 反向連結統一改字；**所有路由與功能完整保留**，未刪任何頁面或測試。

### 5. 哪些後端核心修改需要教師下一次明確授權？

見下表（本輪**全部未執行**）。

---

## 需教師下次明確授權的後端核心修改

| 編號 | 項目 | 涉及檔案 | 風險 |
| --- | --- | --- | --- |
| A1 | ACTIVE 啟用閘門新增「真實圖片證據」條件（L1 模型紀錄層） | `learning/models.py::VisionModelRecord.active_blocked_reason()` | 受保護核心 |
| A2 | 同上（L2 視圖層二次檢查） | `learning/views.py::_vision_model_row`／`teacher_vision_center_activate` | 中 |
| A3 | 同上（L3 推論服務層強制閘門） | `live_backend/app/vision_center.py::activate_model()` | **受保護核心** |
| A4 | 教師驗證證據**持久化**（新 store collection 或 Django 模型 ＋ migration） | `live_backend` ＋ `learning/migrations/` | **高（涉 migration）** |
| A5 | 錯誤案例補齊 `image_path`／`expected_class`／`prediction_confidence` | `live_backend/app/vision_center.py` | 受保護核心 |
| A6 | Django 端接通 4 個 client（`create_hard_example`／`review_hard_example`／`build_next_dataset`／`export_dataset`） | `learning/vision_submission.py` | 中 |
| A7 | 「下一輪資料集」UI（build → export） | `learning/views.py` ＋ 模板 | 中 |
| A8 | 教師驗證路徑接入錯誤案例（新增 Live HTTP 路由） | `live_backend/app/vision_api.py` | 中 |
| A9 | 資料保留政策（`retention_status` 目前僅標記，未執行） | `live_backend` | 中 |
| A10 | 門檻值核定（E1–E7）與例外覆寫機制 | 設計層 | 低 |

---

## 測試證據

| 項目 | 結果 |
| --- | --- |
| P0 隔離行為證明 `verify_vision_isolation.py` | **15/15 PASS** |
| P1 `test_teacher_vision_center_page`（32 項） | **32/32 OK** |
| P1 視覺模組回歸（5 個模組） | 見下方「回歸結果」 |

### 回歸結果（`p1_regression.log`）

```
Ran 120 tests in 1600.304s

FAILED (failures=1)
FAILURES: 1
```

執行模組：`test_vision_model_center`、`test_teacher_vision_acceptance`、
`test_vision_flywheel_framework`、`test_vision_repository`、`test_teacher_catalogue`。
隔離環境：`DJANGO_DB_NAME=.test-temp/vision-center-v1/base.sqlite3`（runner 另建 `test_` 前綴庫）、
`DJANGO_MEDIA_ROOT=.test-temp/vision-center-v1/media`、`DEBUG=true`、`DATABASE_URL` 已清除。

**唯一失敗項（＝既有失敗，非本輪造成）**：

```
FAIL: test_teacher_sees_only_authorized_models_with_four_status_dimensions
      (learning.tests.test_vision_flywheel_framework)
AssertionError: False is not true : Couldn't find '訓練用途' in the following response
```

判定為**既有失敗**的三項證據：

1. `student_portal/learning/templates/learning/teacher_vision_model_list.html`
   **全文不含「訓練用途」**（本輪完整讀檔確認）——該字串從未存在，與本輪編輯無關。
2. 本輪 P3 編輯**只改** `{% block title %}`／`<h1>`／eyebrow／purpose 與新增一個導引 `div`，
   **未觸碰任何表格欄位、標題列或資料列**。
3. 工作區記憶檔已於 **2026-10-14** 記載此為既有失敗：
   「兩項既有失敗（保留，禁止改保護區消滅）：`test_auth` hero 標籤、`test_vision_flywheel_framework`『訓練用途』欄」。

> 依教師長期指示，**既有失敗不得為使其通過而修改保護區**，故本輪**不修**此測試。

---

## 環境現況（收尾時實測）

| 服務 | 位址 | PID | 狀態 |
| --- | --- | --- | --- |
| 正式 Django | 127.0.0.1:8022 | 22708 | LISTENING（未參與本輪） |
| RAG | 127.0.0.1:8770 | 19088 | LISTENING |
| DEMO Django | 192.168.1.114:8110 | 7444 | LISTENING（**未受影響**） |
| DEMO Live Backend | 192.168.1.114:8111 | 9492 | LISTENING（**未受影響**） |
| 隔離 Django | 127.0.0.1:8112 | 6592 | LISTENING（本輪隔離驗收用） |
| 隔離 Live Backend | 127.0.0.1:8117 | 20892 | LISTENING（本輪隔離驗收用） |
| YOLO | :8765 | — | 未啟動（既有狀態） |

---

## 停止條件遵守聲明

- ✅ 未修改正式 ACTIVE 核心閘門
- ✅ 未修改正式資料庫
- ✅ 未觸碰 R07 best.pt 提交鏈
- ✅ 未修改 YOLO 推論核心
- ✅ 未新增 migration、未改寫資料模型、未啟用新寫入流程
- ✅ 未 commit、未 push、未 deploy
- ✅ 既有 V2 測試殘留未刪除
- ✅ 舊版模型中心頁面與路由全部保留
- ⏸ 教師人工驗收：**PENDING**（教師本輪不進行人工驗收）
