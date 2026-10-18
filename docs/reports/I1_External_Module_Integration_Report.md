# I1 外部模組接口層與五階段工作台整合 — 交付報告

- 專案：`D:\FDE-AI-UAS-v2.0`（分支 `fde-ai-v2.0-dev`，HEAD `e5c0442`）
- 依據：2026-10-13 教師《統一開發總指令》第一～十節；以及同日《後續開發方向修正》
- 性質：**平台框架／導航／配置／獨立適配層**的入口整合，**不新增產品功能**
- 完成等級：**AUTOMATED PASS**（Chrome 模擬）
- **真實 iPhone Safari 驗收：PENDING**（須教師以實機另行確認）
- 本輪完成後停止，**不自行進入下一輪**

---

## A. 2.0 現有功能與入口總表

逐項以實際程式碼核對（非依記憶檔推斷）。標記：**已整合可用**／**獨立可用**／**部分完成**／**尚未接入**／**無法驗證**。

| # | 模組 | 實際入口（程式碼核對） | 整合程度 |
|---|---|---|---|
| 1 | P1–P9 學員五階段工作台 | `learning:student_learning_path`（`student/courses/<id>/learning-path/`）＋ `student/learning-path/` 單課程自動重導 | 已整合可用 |
| 2 | P1–P9 教師後台 | `teacher/class-outcomes/`、`teacher/class-report/<cohort>/`、`teacher/review-checklist/<cohort>/`、兩種 CSV 匯出、`teacher/class-showcase/<cohort>/` | 已整合可用 |
| 3 | **F450 十二任務實訓** | `live_backend/app/task_catalog.py`（`F450CourseDefinition`，12 任務、`F450_PIXHAWK248`）＋ `live/` SPA，經 `platform_asset` 由 **`/platform/f450`** 提供（實測 HTTP 200，16,004 bytes） | 已整合可用（同一倉服務） |
| 4 | 學員 R01–R08 成長紀錄 | `growth_records.py` ＋ `growth_task_map.STAGE_RECORD_SLOTS`；`student/courses/<id>/growth/` | 已整合可用 |
| 5 | 班級成果／教師複核／CSV／成果展示 | P3–P8（`teacher_class_outcomes`、`cohort_report`、`review_checklist`、`class_showcase`） | 已整合可用 |
| 6 | AI Live Coach 即時助教 | `/live/`（`live_coach` 入口） | 已整合可用 |
| 7 | YOLO 目標檢測與模型中心 | `teacher/vision-center/`、`teacher/vision-models/`、`teacher/vision-flywheel/`、`student_prop_scan` | 已整合可用（本輪凍結） |
| 8 | RAG 知識庫 | 由 Live／公開 API 提供；工作台不直連 | 已整合可用（本輪凍結） |
| 9 | Flight Health AI 飛行健康 | `/flight-health/`（外部服務連結） | 已整合可用（本輪凍結） |
| 10 | 下載中心（含 HQGC 安裝包） | `/downloads/`（由 **Live 服務** 提供，非 Django 路由） | 已整合可用 |
| 11 | **MP12 調參實訓** | 工作台「做」→ `live_coach`（`/live/`，TASK_07 調參面板） | 部分完成（端到端與教師複核仍待教師確認） |
| 12 | **MP 地面站／飛行考核** | 本輪僅預留接口（`MP_GROUND_STATION`，預設 DISABLED） | 尚未接入（教師獨立開發中） |
| 13 | **HQGC 考核** | 獨立專案；2.0 內既有可見入口為下載中心安裝包 | 獨立可用（僅下載）；考核接口本輪預留 |
| 14 | **F450 3D 數位孿生** | 教師其他專案獨立開發；本輪僅預留接口（`F450_DIGITAL_TWIN`，預設 DISABLED） | 尚未接入（**2.0 倉內無 3D 幾何／`.gltf/.glb/.obj`，無 Three.js/WebGL**，故非「已整合」） |

> 校正說明：本輪**不把獨立專案已完成誤寫成網站已整合**。F450 十二任務與 F450 3D 數位孿生為**兩個不同模組**，前者已可用（`/platform/f450`），後者尚未接入（僅預留）。

---

## B. 本輪修改檔案清單

| 檔案 | 類型 | 說明 |
|---|---|---|
| `student_portal/learning/external_modules.py` | **新增** | 外部模組接口層（唯一配置來源；無 DB 表） |
| `student_portal/learning/tests/test_external_module_interface.py` | **新增** | 接口層與工作台渲染測試（11 項） |
| `student_portal/config/settings.py` | 修改 | 新增 `FDE_EXTERNAL_MODULES`（env 驅動，未設定一律 DISABLED） |
| `student_portal/learning/views.py` | 修改 | 工作台：`build` 階段改由接口層提供模組；新增 F450 十二任務入口；`assess` 階段掛入 MP／HQGC 預留模組 |
| `student_portal/learning/templates/learning/student_learning_path.html` | 修改 | 模組卡片：僅在 `module.url` 存在時才輸出連結（DISABLED 時完全不變） |
| `demo/tools/verify_i1_external_modules.py` | **新增** | 入口、權限、跨班級／跨課程隔離 HTTP 層驗收（46 項） |
| `demo/tools/i1_external_modules_check.cjs` | **新增** | Chrome CDP 渲染／手機 390×844 驗收（11 項） |
| `docs/reports/I1_External_Module_Integration_Report.md` | **新增** | 本報告 |

未改動：`learning/models.py`、任何 `migrations/`、`live_backend/**`、`live/**`、R07 流程、`vision_*`、`growth_records.py`、正式 DB、v1.5C。

---

## C. 外部模組接口契約

實作於 `student_portal/learning/external_modules.py`，**沿用既有 settings／環境變數機制，未新增任何資料庫表**（教師總指令第六節）。

每個模組欄位（`external_module_contract()`）：

| 欄位 | 型別 | 預設 | 說明 |
|---|---|---|---|
| `module_id` | str | — | 穩定識別碼（`F450_DIGITAL_TWIN`／`MP_GROUND_STATION`／`HQGC_ASSESSMENT`） |
| `display_name` | str | — | 顯示名稱 |
| `enabled` | bool | **False** | 是否啟用 |
| `entry_url` | str | **""** | 模組入口基礎網址（**不得夾帶 Token／個資**） |
| `availability_status` | str | **UNAVAILABLE** | `AVAILABLE` 僅當 `enabled=True` **且** `entry_url` 非空 |
| `allowed_roles` | list | `["student","teacher"]` | 允許角色 |
| `integration_version` | str | `reserved-1.0` | 整合版本 |

覆寫來源：`settings.FDE_EXTERNAL_MODULES`（`external_modules.py` 延遲讀取，支援 `override_settings`）。
`settings.py` 由環境變數組出，未設定即 DISABLED：

```
FDE_MODULE_F450_DIGITAL_TWIN_ENABLED / FDE_MODULE_F450_DIGITAL_TWIN_URL
FDE_MODULE_MP_GROUND_STATION_ENABLED / FDE_MODULE_MP_GROUND_STATION_URL
FDE_MODULE_HQGC_ASSESSMENT_ENABLED  / FDE_MODULE_HQGC_ASSESSMENT_URL
```

安全設計：
1. **未設定 → DISABLED → 無連結**（實測無任何假 `href`）。
2. `enabled=True` 但 `entry_url` 為空 → 仍 `UNAVAILABLE`（不產生假連結）。
3. 入口僅為基礎網址；本輪**未實作跨服務登入**，亦**未傳遞任何 Token**（教師總指令第六節末）。
4. 不建立第二套身分系統、不寫入正式 DB、不新增 Migration。

---

## D. MP／HQGC／F450 3D 預留入口

工作台渲染結果（實測 HTML 節錄）：

- **「做」（build）階段**
  - `F450 數位孿生` → 徽章 **待接入**，`<article class="lp-module is-pending">`，**無 `<a>`**
  - `F450 十二任務實訓` → **入口**，`<a href="/platform/f450">進入</a>`
  - `Mission Planner 調參實訓（MP01–MP12）` → 入口 `/live/`（既有）
- **「測」（assess）階段**
  - `MP 地面站（預留）` → 徽章 **待接入**，無連結
  - `HQGC 考核（預留）` → 徽章 **待接入**，無連結
  - `手機槳葉方向辨識（M1–M4）`、`飛行健康 AI` → 既有入口不變

驗收（Chrome CDP，11/11）：F450 十二任務入口 `href=/platform/f450` ✓；F450 3D 孿生未被 `<a>` 包裹 ✓；MP／HQGC 待接入且不可點 ✓；全頁無 `孿生|twin|ground-station|hqgc` 假連結 ✓。

> **未自行指定任何未知正式服務埠號**（教師總指令第四節）；未建立虛假考核結果。

---

## E. F450 十二任務原有功能驗證

| 檢查 | 結果 |
|---|---|
| 工作台含「F450 十二任務實訓」入口 | PASS |
| 入口指向既有 `/platform/f450` | PASS（`href="/platform/f450"`） |
| 十二任務未被改名為 3D 數位孿生 | PASS（無 `<a>F450 數位孿生`） |
| `/platform/f450` 可開啟 | PASS（HTTP 200；Chrome `readyState=complete`，`bodyLen=56725`，title「FDE-AI ｜ 無人載具學習控制中心」） |
| `/platform/` 可開啟 | PASS（HTTP 200，16,004 bytes） |

**未修改** `live_backend/app/task_catalog.py`、`live/**`、`F450CourseDefinition`、`F450_PIXHAWK248`。

---

## F. R01–R08 與教師權限保護結果

| 檢查 | 結果 |
|---|---|
| 工作台呈現 R01–R08 全部槽位 | PASS（`['R01'…'R08']`） |
| R07 成長紀錄頁正常 | PASS（HTTP 200） |
| M1–M4 槳葉辨識頁正常（`name="motor_M1..M4"`） | PASS（HTTP 200） |
| 未登入存取工作台 → 導向登入頁 | PASS（`/login/?next=…`） |
| **跨課程隔離**：他人課程工作台 → 404 | PASS（foreign `enrollment_id=1` → HTTP 404） |
| **跨班級隔離**：教師 A 可開啟授權班級（總覽／報告／結訓清單／展示） | PASS（4/4 HTTP 200） |
| **跨班級隔離**：教師 A 對未授權班級（`P42-B-2026`）→ 404（報告／結訓清單／展示／兩種 CSV） | PASS（5/5 HTTP 404） |
| **跨班級隔離**：教師 A 班級清單不含未授權班級 | PASS（清單含 `P42-A-2026`、不含 `P42-B-2026`） |
| 下載中心 manifest 仍含 HQGC 條目 | PASS（`D:\下載中心文件\download_manifest.json` 唯讀檢查） |
| 既有入口連結不變（`/platform/`、`/downloads/`、`/live/`、`/flight-health/`、`prop-scan`） | PASS |

授權格局（隔離驗收庫 `p42_verify.sqlite3`）：教師 A → `P42-A-2026`／`P42-C-2026`；教師 B → `P42-B-2026`。
> 教師登入端點為 **`/teacher/login/`**（非 `/login/`）；隔離檢查全程**不跟隨重導**，避免「未登入 → 302 登入頁」被誤判為 200。

**R01–R08 原始資料與狀態不變**：本輪未修改 `growth_records.py`／`growth_task_map.py`／任何成長紀錄模型；`ensure_growth_submissions` 行為未動。
**教師權限**：本輪未修改 `teacher_cohorts()`／任何教師視圖或模板，既有班級授權過濾不受影響（上表 9 項實測驗證）。

---

## G. P1–P9 回歸測試

| 測試 | 範圍 | 結果 |
|---|---|---|
| 新增接口層測試 | `learning.tests.test_external_module_interface` | **11/11 PASS** |
| 工作台既有測試 | `learning.tests.test_student_learning_path` | **18/18 PASS** |
| 兩者合併 | — | **29/29 PASS** |
| **全 learning 套件** | `manage.py test learning` | **869 項，2 失敗，26 略過** |

全量回歸的 **2 項失敗為既有失敗，與本輪無關**（P9 已核對舊日誌 `learning-full-test.log` 歸位）：
1. `test_platform_hero_action_opens_student_growth_portal`（`test_auth`）— 前端 JS hero 標籤已於先前改版（現為「我的學習成長日誌」）。
2. `test_teacher_sees_only_authorized_models_with_four_status_dimensions`（`test_vision_flywheel_framework`）— 教師模型列表模板已於 2026-10-10 改版移除「訓練用途」欄。

> 本輪**新增 11 項測試全數通過，引入 0 項新失敗**（858 → 869，增量即本輪新增）。

| HTTP／Chrome 驗收 | 結果 |
|---|---|
| `verify_i1_external_modules.py`（入口、權限、跨班級／跨課程隔離） | **46/46 PASS** |
| `i1_external_modules_check.cjs`（渲染＋手機 390×844） | **11/11 PASS** |

手機 390×844：`overflowX = 0px`（無水平溢出），模組卡片可見 3 個。
**註：上述為 Chrome 裝置模擬，不等於真實 iPhone Safari 驗收。**

---

## H. 受保護區零修改證據

| 保護區 | 本輪修改 |
|---|---|
| v1.5C（程式／資料／部署） | **0** |
| YOLO：`best.pt`、訓練程式、資料集、`data.yaml`、推論／規則引擎、候選／ACTIVE 模型、版本回滾 | **0** |
| R07 提交資料模型／上傳驗證／提交權限／審核歷史 | **0** |
| 教師視覺模型倉庫（上傳清單／驗證／候選審核／ACTIVE 發布／回滾／失敗樣本池） | **0** |
| F450 十二任務核心、MP12 內部、HQGC 獨立專案、F450 3D 獨立專案、Flight Health AI | **0** |
| Cloudflare Gateway／正式部署設定 | **0** |
| **Migration** | **0**（仍為 `0019_golden_set_manifest_contract`，共 19 支 + `__init__`） |
| **正式資料庫** `student_portal/db.sqlite3` | mtime 仍 **2026-10-07 19:08**（未修改） |
| Git 寫操作 | **0**（未 `clean`／`reset`／`commit`／`push`／`merge`／`deploy`；未執行 `R07 --apply`） |
| 工作區未提交成果 | 保留（**186** 項，含本輪新增 2 個原始檔） |

HEAD 仍為 `e5c0442`；未強制切換分支。

---

## I. 尚未完成的實際整合工作

1. **F450 3D 數位孿生**：2.0 倉內不存在 3D 幾何／檢視器，僅預留接口。待教師提供獨立專案入口後，設定 `FDE_MODULE_F450_DIGITAL_TWIN_ENABLED=1` ＋ `_URL` 即自動由「待接入」轉為可點入口。**零件點選事件格式與 R05 關聯設計**尚未實作（教師總指令第五節第 5、6 點），需教師確認資料契約後再議。
2. **MP 地面站／飛行考核**：僅預留接口。`allowed_roles`、`entry_url`、未來「飛行任務結果資料格式」與「考核結果 ↔ 成長紀錄關聯」尚未定義。
3. **HQGC 考核**：2.0 內目前僅下載入口；考核接口預留，未串接。
4. **跨服務登入**：未實作（依指令「先產出安全設計，不自行實作不安全的 Token 傳遞」）。**需教師批准後另立安全設計**。
5. **真實 iPhone Safari 驗收**：**PENDING**（本輪僅 Chrome 模擬）。
6. **兩項既有測試失敗**：`test_auth`／`test_vision_flywheel_framework` 各 1 項，屬前端文案／模板改版造成的既有落差，**不在本輪範圍**，待教師決定是否修復。

---

## J. 下一輪最小開發建議

1. **優先**：由教師提供 **F450 3D 數位孿生**獨立專案入口與事件契約（零件點選 → 學習事件格式 → R05 關聯），再以現有 `external_modules.py` 配置啟用，**不新增程式分支**。
2. 同理處理 **MP 地面站**：先定 `entry_url` 與「飛行任務結果資料格式」，再啟用；HQGC 一併比照。
3. **跨服務登入安全設計**（一次性文件，不含實作）：SSO／一次性授權碼／短效 Token 的取捨與威脅模型，待教師批准。
4. 兩項既有測試失敗：以**最小修改**對齊現行文案（前端 hero 標籤、教師模型列表），或由教師裁定移除過時斷言。
5. **真實 iPhone Safari**：以隔離驗收服務（`:8112`，`p42_verify.sqlite3`）執行教師／學員真機清單，逐項記錄截圖位置。

---

## 附件：可重現指令

```bash
# 1) 新增測試 + 工作台測試（11 + 18）
cd D:\FDE-AI-UAS-v2.0\student_portal
env -u DATABASE_URL -u DJANGO_DEBUG -u DJANGO_SETTINGS_MODULE \
    -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY \
    DJANGO_MEDIA_ROOT=/tmp/fde_test_media \
    ../.test-temp/django-venv/Scripts/python.exe manage.py test \
    learning.tests.test_external_module_interface learning.tests.test_student_learning_path

# 2) 全 learning 回歸（約 20 分鐘）
#    同上，改為 manage.py test learning

# 3) 隔離驗收服務（教師／學員 HTTP 與 Chrome 驗收用）
powershell -ExecutionPolicy Bypass -File demo\tools\start_p42_verify.ps1 -Port 8112 -DbFile p42_verify.sqlite3

# 4) 入口、權限與跨班級／跨課程隔離 HTTP 驗收（46 項）
python demo\tools\verify_i1_external_modules.py

# 5) Chrome 渲染 + 手機 390×844 驗收（11 項）
node demo\tools\i1_external_modules_check.cjs
```

**完成 I1，停止，等待教師審核；不自行開始下一輪。**
