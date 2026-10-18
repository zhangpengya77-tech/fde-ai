# FDE-AI-UAS 2.0｜I2 五階段教學平台框架完善 — 交付報告

- 專案：`D:\FDE-AI-UAS-v2.0`
- 分支：`fde-ai-v2.0-dev`
- HEAD（未變動）：`e5c0442`
- 執行日期：2026-10-13
- 對應指令：教師 I2 指令（一、開發目標；二、既有成果保留；三、I2-A；四、I2-B；五、I2-C；六、驗收；七、安全邊界；八、交付 A–I）

---

## 0. 驗收等級聲明（兩級完成標準）

| 等級 | 含義 | 本輪結果 |
|---|---|---|
| `AUTOMATED PASS` | 單元測試 + 隔離 HTTP 驗收 + Chrome 裝置模擬全數通過 | **達成** |
| `REAL DEVICE PASS` | iPhone 實機 Safari 人工驗收通過 | **PENDING（本輪未執行）** |

> 本輪所有驗收均為自動化與 Chrome 裝置模擬（含 390×844 手機視窗模擬）。
> **真實 iPhone Safari 驗收一律標 `PENDING`**，須教師以實機另行確認。
> 本報告不出現任何未經實機驗證的「真機通過」字樣。

---

## A. 五階段功能入口對照表

所有入口皆為**既有已存在**的頁面／路由，I2 只做「整理入口與資訊層級」，
**未新增第二套功能、未重構既有模組內部、未產生假完成狀態**。

| 階段 | 入口名稱 | 目標位址 | 來源 | 狀態 |
|---|---|---|---|---|
| 學 | 學習平台（課程影片與教材） | `learning:platform` | 既有主平台 | 已可使用 |
| 學 | 下載中心（課程軟體） | `/downloads/` | 既有 Live 服務提供 | 已可使用 |
| 學 | AI 助教（RAG 知識庫問答） | `/live/` | 既有 RAG + Live 教練 | 已可使用 |
| 練 | 模擬器練習（學習平台） | `learning:platform` | 既有模擬器與考照內容 | 已可使用 |
| 練 | AI 助教（練習即時問答） | `/live/` | 既有 Live 教練／RAG | 已可使用 |
| 練 | 四面懸停／起飛與降落／八字訓練 | — | 未來專項 | **規劃中**（無連結） |
| 做 | F450 十二任務實訓 | `/platform/f450` | 既有實訓入口 | 已可使用（沿用原名，**不改名為 3D 數位孿生**） |
| 做 | Mission Planner 調參實訓（MP01–MP12） | `/live/` | 已接入主專案（TASK_07 調參面板） | 已可使用（端到端與教師複核仍待教師確認） |
| 做 | F450 數位孿生 | — | 教師其他專案獨立開發 | **尚未接入**（預留，無連結） |
| 做 | 3D 列印／航線規劃／三維建模／巡檢與產業 SOP／無人車 | — | 未來專項 | **規劃中**（無連結） |
| 測 | 手機槳葉方向辨識（M1–M4） | `learning:student_prop_scan` | 既有 M1–M4 檢測頁 | 已可使用（手機版排版凍結保護） |
| 測 | 飛行健康 AI | `/flight-health/` | 既有外部服務連結 | 已可使用（原導航入口保持不變） |
| 測 | MP 地面站（預留） | — | 教師獨立開發 | **尚未接入**（預留，無連結） |
| 測 | HQGC 考核（預留） | — | 獨立專案 | **尚未接入**（預留，無連結） |
| 證 | 我的學習成長日誌（R01–R08 總覽） | `learning:student_growth_dashboard` | 既有成長日誌總覽頁 | 已可使用（含教師複核結果，不重構） |

**入口一致性保證**：上表每一個「已可使用」項目，在 Chrome 驗收中皆以
`li.lp-entry` 文字比對 + `a[href]` 實際位址雙重確認；每一個「規劃中／尚未接入」
項目皆驗證**不存在 `<a>` 連結**（見 §D、§F）。

---

## B. 修改檔案清單

### B-1 新增檔案

| 檔案 | 用途 |
|---|---|
| `student_portal/learning/external_modules.py` | 外部模組接口層（四態狀態機、探測、契約）；**無 DB 表** |
| `student_portal/learning/templates/learning/student_learning_path.html` | 五階段工作台頁面 |
| `student_portal/learning/static/learning/learning-path.css` | 工作台樣式（含四態徽章與手機斷點） |
| `student_portal/learning/tests/test_external_module_interface.py` | 接口層單元測試 |
| `demo/tools/verify_i2_framework.py` | I2 隔離 HTTP 驗收（default／module-up／module-down） |
| `demo/tools/i2_framework_check.cjs` | I2 Chrome 渲染 + 手機 390×844 驗收 |
| `demo/tools/verify_i1_external_modules.py` | I1 隔離 HTTP 驗收（入口／權限／跨班級跨課程） |
| `demo/tools/i1_external_modules_check.cjs` | I1 Chrome 驗收 |
| `docs/reports/I1_External_Module_Integration_Report.md` | I1 交付報告 |
| `docs/reports/I2_Report.md` | 本報告 |

### B-2 修改檔案

| 檔案 | 修改內容 | 性質 |
|---|---|---|
| `student_portal/config/settings.py` | 新增 `FDE_EXTERNAL_MODULES`、`FDE_EXTERNAL_MODULE_PROBE_TIMEOUT_SECONDS`、`FDE_EXTERNAL_MODULE_PROBE_TTL_SECONDS`（**預設全 DISABLED**） | 附加式，34 行 |
| `student_portal/learning/views.py` | `LEARNING_PATH_STAGES` 入口整理；`_learning_path_entry_urls` 加 `f450_training`／`growth_dashboard`；工作台視圖加入 `workbench_role` 與外部模組注入；`_platform_identity_context` 加 `workbench_url` | 附加式（與 P0/P1/I1 變更同屬未提交工作區） |
| `student_portal/learning/templates/learning/platform_identity_nav.html` | 學員分支新增「五階段學習工作台」返回連結（**+1 行**） | 附加式 |
| `student_portal/learning/templates/learning/student_learning_path.html` | 模組卡片改為四態 class／徽章；僅 `url` 非空時輸出連結 | 附加式 |
| `student_portal/learning/static/learning/learning-path.css` | 新增 `.lp-module-available/-not-integrated/-service-unavailable/-role-restricted` 與對應徽章樣式 | 附加式 |
| `student_portal/learning/tests/test_student_learning_path.py` | 五階段入口與模組渲染斷言 | 附加式 |

### B-3 未新增 Migration

- `student_portal/learning/migrations/` 檔數：**20（含 `__init__.py`）→ 實際 Migration 0001–0019**，最新為 `0019_golden_set_manifest_contract.py`。
- 本輪**未新增任何 Migration**、**未執行 `makemigrations`／`migrate`**。

---

## C. 學員實際操作流程

```
1. 登入（既有登入頁 /login/，帳號密碼與既有相同，不新增登入方式）
        ↓
2. 進入「五階段學習工作台」
   /student/learning-path/
     ├─ 在學課程 = 1 筆 → 直接進入該課程工作台（自動重導）
     └─ 在學課程 ≥ 2 筆 → 回學員總覽自行選擇課程（不擅自挑一門）
        ↓
3. 工作台頁面結構（由上而下）
   ├─ 身分導覽列（顯示目前角色，含「五階段學習工作台」返回連結）
   ├─ 課程／班級／組別資訊
   ├─ 學 → 練 → 做 → 測 → 證 五個階段區塊（各有錨點 #stage-learn … #stage-certify）
   │    ├─ 階段說明（該階段做什麼）
   │    ├─ 入口清單（li.lp-entry：既有入口，可點）
   │    ├─ 外部模組卡片（li/article.lp-module：四態徽章，僅「已可使用」可點）
   │    └─ 規劃中項目（純文字標示「規劃中」，無連結）
   └─ 成長紀錄／教師複核狀態（沿用既有，不被本輪改寫）
        ↓
4. 點任一「已可使用」入口 → 前往既有頁面（原功能不變）
        ↓
5. 返回：平台共用導覽列提供「五階段學習工作台」→ 回 /student/learning-path/
        （不需重新登入；不繞過權限）
```

**操作體驗保證（I2-C）**

| 檢查項 | 結果 |
|---|---|
| 學員入口單一（不新增第二套入口） | ✅ 僅 `/student/learning-path/` |
| 返回路徑存在且不需重新登入 | ✅ 平台共用導覽列 `workbench_url` |
| 不繞過權限 | ✅ 沿用 `@student_required` / `@teacher_required`，未放寬任何裝飾器 |
| 不重複登入 | ✅ 全流程同一 session |
| 既有資料不被改寫 | ✅ 工作台僅 `get_or_create` 既有進度列，未新增寫入路徑 |
| 教師與學員各自入口 | ✅ 教師走 `/teacher/...`，學員走 `/student/...`，互不混用 |

---

## D. 外部模組狀態與降級結果

### D-1 四態定義（`external_modules.py`）

| 狀態鍵 | 顯示文字 | 可點擊 | 判定依據（**皆為真實依據**） |
|---|---|---|---|
| `AVAILABLE` | 已可使用 | ✅ 是 | `enabled=True` 且 `entry_url` 非空，且**健康探測通過** |
| `NOT_INTEGRATED` | 尚未接入 | ❌ 否（預設） | 未啟用 或 未設定入口 URL |
| `SERVICE_UNAVAILABLE` | 服務暫時不可用 | ❌ 否 | 已設定，但**健康探測失敗**（降級） |
| `ROLE_RESTRICTED` | 權限不足 | ❌ 否 | 已設定，但當前角色不在 `allowed_roles` |

**判定順序（不可顛倒）**：
`尚未接入`（未啟用／無 URL）→ `權限不足`（角色不符，**不進行探測**）→ `服務暫時不可用`（探測失敗）→ `已可使用`。

**防冒充規則（I2-B 硬性要求）**

| 禁止行為 | 本層如何保證 |
|---|---|
| 把「服務不可用」顯示成「學員未完成」 | 服務狀態**不寫入任何學習紀錄**；`SERVICE_UNAVAILABLE` 說明文字明確寫「不影響你的學習紀錄與教師審核結果」 |
| 把「尚未接入」顯示成「已啟用」 | 非 `AVAILABLE` 一律 `url=""`，模板 `{% if module.url %}` 才輸出 `<a>` |
| 把「權限不足」顯示成「服務不可用」 | 角色不符時**提前返回**，不做探測，狀態為 `ROLE_RESTRICTED` |
| 對未授權角色洩漏服務可用性 | 角色不符時**不發出任何網路探測** |
| 模組服務異常拖垮工作台頁面 | 探測例外**一律吞掉回 False**，絕不拋出 |

### D-2 三模式驗收結果（隔離服務 `:8112` / `p42_verify.sqlite3`）

| 模式 | 配置 | 期望狀態 | 結果 |
|---|---|---|---|
| `default` | 三模組全 DISABLED（**生產預設**） | 全部「尚未接入」、無連結、**零網路探測** | **67/67 PASS** |
| `module-up` | `F450_DIGITAL_TWIN` enabled + 可達 URL | 「已可使用」並**產生連結** | **23/23 PASS** |
| `module-down` | `F450_DIGITAL_TWIN` enabled + 不可達 URL | 「服務暫時不可用」且**無連結** | **24/24 PASS** |

**降級行為實證**：
- `module-down` 模式下頁面 HTTP 狀態仍為 **200**（模組服務不可用不影響工作台可用性）；
- 該模組徽章文字為「服務暫時不可用」，`a[href]` 數量為 **0**；
- 學員既有成長紀錄（R01–R08）內容與 `default` 模式**逐字相同**（正規化 CSRF 後比對），證明降級不改寫學習狀態。

**預設零副作用**：所有模組 DISABLED 時，`_resolve_status` 在第一步即返回 `NOT_INTEGRATED`，
**不會呼叫 `_probe_available`**，因此對既有系統**不發出任何網路請求**。

---

## E. 權限隔離測試

沿用 I1 的隔離方法，並修正 I1 發現的兩個假 PASS 陷阱。

### E-1 防假 PASS 措施

| 陷阱 | 症狀 | 修正 |
|---|---|---|
| `urllib` 預設跟隨重導 | 未登入的 302 → 登入頁被讀成 200，使「未授權存取」看似正常（**假 PASS**） | 實作 `_NoRedirect` + `new_session(follow=False)`，隔離檢查**全程不跟隨重導** |
| 教師登入端點誤用 | 用 `/login/`（`StudentLoginView`）登入教師 → 失敗 | 改用 `/teacher/login/`（`TeacherLoginView`） |
| CSRF token 每次不同 | 兩次抓頁 HTML 不相等 → 誤判「狀態被改寫」 | `normalize()` 將 `csrfmiddlewaretoken` 值替換為 `X` 後再比對 |

### E-2 隔離矩陣與結果

驗收庫格局：`P42-A-2026`（3 學員）、`P42-B-2026`（3 學員）、`P42-C-2026`（0 學員）、`F450-DEMO-2026`。

| 受測身分 | 目標資源 | 期望 | 結果 |
|---|---|---|---|
| 學員 A（P42-A） | 自己的五階段工作台 | 200 | ✅ |
| 學員 A | 他班（P42-B）學員的工作台 | 302/403/404（**不跟隨重導**） | ✅ |
| 學員 A | 他班學員的成長日誌 | 拒絕 | ✅ |
| 教師 A | P42-A 班級資料 | 200 | ✅ |
| 教師 A | P42-C 班級資料（同為教師 A 授課） | 200 | ✅ |
| 教師 A | **P42-B 班級資料（非授課）** | 拒絕（302/403/404） | ✅ |
| 教師 B | P42-B 班級資料 | 200 | ✅ |
| 教師 B | P42-A／P42-C 班級資料 | 拒絕 | ✅ |
| 學員 | 教師端頁面 `/teacher/...` | 拒絕 | ✅ |
| 教師 | 學員端專屬頁面（以學員身分要求） | 拒絕 | ✅ |

### E-3 跨課程／跨班級額外驗證（I1 補完，46/46 PASS）

- 學員僅能看見**自己 `Enrollment`** 對應的課程工作台；
- 教師跨班級檢視以 `Cohort`／`Group` 授課關係為界，**非授課班級一律拒絕**；
- 跨課程（同一教師多課程）與跨班級（同課程多班）皆逐項驗證。

> **修正記錄**：I1 初版隔離腳本使用 `JOIN learning_studentprofile p ON p.id = e.student_id` 導致失敗。
> 實際 schema 為 `learning_enrollment.student_id` → `learning_studentprofile.student_id`（varchar FK）。
> 已修正為 `ON p.student_id = e.student_id`，修正後全數通過。

---

## F. 手機版驗收（Chrome 裝置模擬 390×844）

| 檢查項 | 實測值 | 結果 |
|---|---|---|
| 手機 390×844 無水平溢出 | `overflowX = 0 px` | ✅ |
| 模組卡片可見 | 3 張（`getBoundingClientRect().width > 0`） | ✅ |
| 入口列表可見 | 10 項 | ✅ |
| 五階段錨點齊備 | 5/5 | ✅ |
| 預留模組不可點 | 0 個匹配 `<a>` | ✅ |
| 全頁無指向孿生／MP／HQGC 的假連結 | 0 個 | ✅ |

- Chrome 驗收總計：**21/21 PASS**。
- 手機截圖：`demo/runtime/logs/i2_workbench_iphone390x844.png`
- 頁面存檔：`demo/runtime/logs/i2_workbench_{default,module-up,module-down}.html`

> ⚠️ 此為 **Chrome 裝置模擬**，非真實 iPhone Safari。
> **真實 iPhone Safari 驗收：PENDING。**

---

## G. P1–P9 回歸結果

### G-1 完整 learning 套件回歸

指令：`manage.py test learning`（in-memory test DB，**不觸碰正式 DB**）

```
Ran 882 tests in 1506.844s

FAILED (failures=2, skipped=26)
```

| 項目 | 數值 |
|---|---|
| 執行測試數 | **882** |
| 失敗 | **2** |
| 略過 | 26 |
| 耗時 | 1506.844 秒（約 25 分鐘） |

### G-2 兩項失敗皆為既有，**非本輪引入**

| 失敗測試 | 套件 | 失敗原因 | 是否本輪引入 |
|---|---|---|---|
| `test_platform_hero_action_opens_student_growth_portal` | `test_auth` | 前端 JS hero 標籤已改（`index.html` 早前改版），測試仍斷言舊字串 `label: '我的學習日誌'` | ❌ 否（P9 已歸位之既有失敗） |
| `test_teacher_sees_only_authorized_models_with_four_status_dimensions` | `test_vision_flywheel_framework` | 模板 2026-10-10 改版移除「訓練用途」欄位，測試仍斷言該字串 | ❌ 否（P9 已歸位之既有失敗） |

**對照 P9／I1 回歸紀錄，兩項失敗完全相同**：

| 輪次 | 測試數 | 失敗 | 失敗清單 |
|---|---|---|---|
| P9 | 858 | 2 | 同上兩項 |
| I1 | 869 | 2 | 同上兩項 |
| **I2（本輪）** | **882** | **2** | **同上兩項** |

**結論：I2 引入 0 項新失敗。** 測試數增量 869 → 882 = **+13**，全部來自
`test_external_module_interface`（I1 的 11 項 → I2 重寫為 **24 項**，+13）。

### G-3 本輪新增測試

| 測試檔 | 項數 | 結果 |
|---|---|---|
| `tests/test_external_module_interface.py` | 24 | **24/24 OK** |
| `tests/test_student_learning_path.py`（含 I2 新增斷言） | 18 | **18/18 OK** |
| 合計（I2 專項） | **42** | **42/42 OK** |

### G-4 P1–P9 既有功能未受影響

| 驗證項 | 方法 | 結果 |
|---|---|---|
| 五階段工作台（P1） | `test_student_learning_path` | 18/18 ✅ |
| 任務與成長證據鏈（P2） | `test_p2_task_record_chain` | 全綠 ✅ |
| 教師班級成果總覽（P3／P4／P4.1／P4.2） | `test_teacher_class_outcomes` | 全綠 ✅ |
| 班級結訓報告（P5） | `test_teacher_class_report` | 全綠 ✅ |
| 結訓審核與匯出（P6） | `test_teacher_cohort_delivery` | 全綠 ✅ |
| 成果展示與簡報（P7） | `test_teacher_class_showcase` | 全綠 ✅ |
| 展示安全加固（P8） | `test_p8_showcase_security` | 全綠 ✅ |
| 報告唯讀化（P9） | `test_p9_readonly_report` | 全綠 ✅ |
| R01–R08 狀態一致性 | `test_external_module_interface` 重複瀏覽比對 | 一致 ✅ |
| 受保護頁面可開啟 | Chrome 驗收 `/platform/f450` readyState=complete、bodyLen>500 | ✅ |

> 註：`test_auth` 與 `test_vision_flywheel_framework` 的 2 項失敗屬**前端／模板與測試斷言的歷史落差**，
> 與 I2 的五階段框架、外部模組接口層**無任何程式關聯**（I2 未觸碰 `index.html`、
> `platform-browser.js`、`teacher_vision_center.html`）。
> 是否修復該 2 項，建議由教師決定（屬獨立議題，不在 I2 範圍）。

---

## H. 受保護模組零修改證據

### H-1 版本與資料庫

| 項目 | 值 | 說明 |
|---|---|---|
| HEAD | `e5c0442` | 未變動 |
| 分支 | `fde-ai-v2.0-dev` | 未變動 |
| Migration 數 | 0001–0019（無新增） | 未新增 Migration |
| 正式 DB `student_portal/db.sqlite3` mtime | `2026-10-07 19:08:32` | 早於本輪（2026-10-13），**未被觸碰** |
| Git 寫操作 | **0 次**（無 commit／push／merge／reset／clean／deploy） | — |

### H-2 受保護模組最後修改時間（今日 = 2026-10-13）

| 檔案 | 最後修改時間 | 本輪是否修改 |
|---|---|---|
| `live_backend/app/vision_center.py` | 2026-10-11 06:05:48 | ❌ 否 |
| `live_backend/app/main.py` | 2026-10-11 07:05:25 | ❌ 否 |
| `live_backend/app/task_catalog.py` | 2026-10-07 18:39:10 | ❌ 否 |
| `live_backend/app/task_state.py` | 2026-10-07 22:42:45 | ❌ 否 |
| `live_backend/app/training_records.py` | 2026-10-07 22:44:35 | ❌ 否 |
| `live_backend/app/coach_ask.py` | 2026-10-05 00:59:27 | ❌ 否 |
| `student_portal/learning/vision_rule_templates.py` | 2026-10-08 17:25:41 | ❌ 否 |
| `student_portal/learning/models.py` | 2026-10-09 02:39:03 | ❌ 否 |

> 所有受保護模組最後修改時間**皆早於 2026-10-13**，證明本輪未觸碰其內部程式。

### H-3 逐項對照（教師 I2 指令第七節安全邊界）

| 禁止項 | 結果 |
|---|---|
| 修改 YOLO／`best.pt` | ✅ 未觸碰（模型檔案 mtime 皆為 2026-10-10 及更早） |
| 修改 R07 | ✅ 未觸碰（R07 相關程式與資料無變更） |
| 修改教師模型倉庫 | ✅ 未觸碰（`vision_center.py` 未變更） |
| 修改 Flight Health AI | ✅ 未觸碰（入口連結沿用，未改程式） |
| 修改 F450 十二任務核心 | ✅ 未觸碰（僅沿用 `/platform/f450` 入口） |
| 修改 MP12 | ✅ 未觸碰（僅沿用既有入口） |
| 修改 HQGC | ✅ 未觸碰（僅預留接口，無連結） |
| 修改 F450 3D | ✅ 未觸碰（僅預留接口，無連結） |
| 修改 v1.5C | ✅ 未觸碰（穩定母版未動） |
| 新增 Migration | ✅ 無 |
| 修改正式 DB | ✅ 無（mtime 早於本輪） |
| `git clean` / `reset` / `commit` / `push` / `merge` / `deploy` | ✅ 全部未執行 |
| R07 `--apply` | ✅ 未執行 |

### H-4 既有成果保留

- 工作區所有未提交變更**原樣保留**（P0 手機 MVP、P1 五階段工作台、P2–P9 各輪成果、I1 接口層）。
- 本輪採**附加式修改**：`platform_identity_nav.html` 僅 +1 行；`settings.py` 僅新增設定區塊；
  `views.py` 僅在既有結構中擴充入口定義與視圖注入，**未刪除既有程式**。

---

## I. 下一輪建議

1. **真實 iPhone Safari 驗收（最高優先）**
   本輪所有手機結論皆來自 Chrome 390×844 模擬。建議教師以實機開啟
   `/student/learning-path/`，確認：五階段捲動、模組徽章換行、入口點擊、
   返回工作台按鈕位置。驗收前請確認隔離服務以 `start_p42_verify.ps1` 啟動（勿手動拼環境變數）。

2. **外部模組接入前的契約凍結**
   目前 `F450_DIGITAL_TWIN` / `MP_GROUND_STATION` / `HQGC_ASSESSMENT` 三筆契約已固定
   （`module_id`／`stage`／`allowed_roles`／`integration_version`）。
   建議教師於各獨立專案開發時，**只提供基礎入口 URL**，不附加登入 Token 或學生個資參數；
   接入時僅需設定環境變數，**不需修改本專案程式碼**。

3. **探測策略可視需要調整**
   目前為 `HEAD` 輕量探測，TTL 30 秒、逾時 1.5 秒，並有進程內快取。
   若未來模組入口不支援 `HEAD`，可改為 `GET` 或改由教師提供專用健康檢查端點
   （透過 `FDE_EXTERNAL_MODULE_PROBER` 或後續擴充設定）。

4. **「規劃中」專項的後續處理**
   練／做兩階段的「規劃中」項目（四面懸停、起飛與降落、八字訓練、3D 列印、航線規劃、
   三維建模、巡檢與產業 SOP、無人車）目前為純文字標示。
   建議未來**逐項接入時才改為連結**，避免一次性開啟大量空入口。

5. **回歸基線固化**
   建議將本輪三模式驗收（`default` / `module-up` / `module-down`）與
   Chrome 21 項驗收納入每次改動後的固定回歸清單，
   特別是 `module-down` 模式（服務不可用降級）——這是最容易在後續改動中被破壞的行為。

---

## 附錄：本輪驗收指令（可重現）

```bash
# 1. 隔離服務（背景）
powershell -Command "Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force"
powershell -File demo/tools/start_p42_verify.ps1 -Port 8112 -DbFile p42_verify.sqlite3

# 2. HTTP 驗收（三模式）
python demo/tools/verify_i2_framework.py default
python demo/tools/verify_i2_framework.py module-up
python demo/tools/verify_i2_framework.py module-down

# 3. Chrome 渲染 + 手機 390×844
node demo/tools/i2_framework_check.cjs

# 4. 單元測試
cd student_portal
env -u DATABASE_URL -u DJANGO_DEBUG -u DJANGO_SETTINGS_MODULE \
    -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY \
    DJANGO_MEDIA_ROOT=/tmp/fde_test_media \
    ../.test-temp/django-venv/Scripts/python.exe manage.py test learning
```

---

## 結論

- **I2-A 五階段入口整理**：完成。五階段入口皆指向既有功能，未新增第二套功能。
- **I2-B 統一模組狀態**：完成。四態狀態機皆有真實依據，預留模組不冒充已啟用，服務不可用不冒充學員未完成。
- **I2-C 操作體驗**：完成。返回路徑、權限、手機排版、既有資料保護皆驗證通過。
- **驗收**：`AUTOMATED PASS`（單元測試 42/42、HTTP 67/67 + 23/23 + 24/24、Chrome 21/21）。
- **真實 iPhone Safari 驗收**：`PENDING`。
- **安全邊界**：全部遵守，受保護模組零修改，0 次 Git 寫操作，未新增 Migration。

**依教師指令「完成 I2 後停止，不自行進入 I3」，本輪到此結束。**
