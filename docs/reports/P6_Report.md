# P6 交付報告｜結訓審核與成果交付中心

**專案**：FDE-AI-UAS 2.0（`D:\FDE-AI-UAS-v2.0`，分支 `fde-ai-v2.0-dev`）
**基準 HEAD**：`e5c0442`
**報告日期**：2026-10-13
**對應指令**：教師 P6 正式開發指令（七節）＋ 開發進度校正指令（六步驟）

---

## 0. 完成等級與範圍宣告

| 項目 | 狀態 |
| --- | --- |
| P6-A 教師結訓審核清單 | 完成 |
| P6-B 班級成果匯出（兩種 CSV） | 完成 |
| P6-C 交付前安全檢查 | 完成 |
| P6 自動化測試 | **AUTOMATED PASS** |
| P1–P5 回歸 | **AUTOMATED PASS** |
| **iPhone 真機人工驗收** | **PENDING** |

> 本輪所有「手機」結果均為 **Chrome 390×844 設備模擬＋print media emulation**，
> **不得視為真實 iPhone Safari 驗收**。所有報告與驗收項目標註 `人工 iPhone 驗收：PENDING`。
>
> 本輪**未**宣稱：考核合格、結訓通過、證照取得、考照合格率、結訓通過率。
> 「證」階段一律表述為「課程成果紀錄，非民航局專業操作證」。

### 保護邊界遵守情形

| 保護項 | 修改次數 |
| --- | --- |
| R07 模型提交鏈 | 0 |
| M1–M4 槳葉方向辨識 | 0 |
| P1 五階段學習工作台核心 | 0 |
| P2 成長證據鏈核心 | 0 |
| F450 數位孿生 / MP12 / 飛行健康 / 下載中心 / AI 助教 | 0 |
| Cloudflare Worker / Gateway / Tunnel / 正式入口網址 | 0 |
| 正式 v1.5C 分支與 worktree | 0 |
| 新增 Migration | **0**（`migrations/` 最新仍為既有 `0019`） |
| 正式資料庫（`student_portal/db.sqlite3`） | **0**（mtime 仍為 2026-10-07 19:08） |
| `git add` / `commit` / `push` / `merge` / `deploy` / `git clean` / `git reset` / R07 `--apply` | **0 次執行** |

---

## A. P6-A 教師結訓審核清單

### A.1 落點與入口

| 項目 | 內容 |
| --- | --- |
| 路由 | `/teacher/review-checklist/`（`teacher_cohort_review_checklist`）<br>`/teacher/review-checklist/<cohort_id>/`（`teacher_cohort_review_checklist_cohort`） |
| 視圖 | `student_portal/learning/views.py::teacher_cohort_review_checklist` |
| 模板 | `student_portal/learning/templates/learning/teacher_cohort_review_checklist.html` |
| 樣式 | `student_portal/learning/static/learning/teacher-checklist.css` |
| 入口 | `teacher_dashboard.html` 於 P5「班級成果報告」**旁並列**新增「結訓審核清單」與兩種 CSV 匯出入口 |

### A.2 六項必要內容（全部由既有真實資料彙整）

| # | 指令要求 | 實作 |
| --- | --- | --- |
| ① | 班級總人數 | `#checklist-basic`：班級名稱／編號／總人數／清單產生時間 ＋ 4 張統計卡 |
| ② | R01–R08 尚未提交項目 | `#checklist-unsubmitted`：逐槽列「尚未提交人數／班級人數／待處理學員」 |
| ③ | 待教師複核項目 | `#checklist-pending`：學員／來源／項目／狀態／提交時間／審核入口 |
| ④ | 需要補充項目 | `#checklist-needs-revision`：同上欄位 |
| ⑤ | 已有教師複核結果 | `#checklist-reviewed`：複核結果／評分／教師評語／時間 |
| ⑥ | 每位學員尚待處理的項目 | `#checklist-students`：逐位學員卡片，含尚未提交／待複核／需補充／已複核／五階段完成 ＋ 逐筆待處理清單 |

### A.3 每筆待處理項目皆提供既有審核頁的安全入口

- 所有待處理項目（尚未提交、待教師複核、需要補充、學員卡片逐筆）皆為
  `<a href="{{ item.url }}">`，指向**既有** `teacher_student_detail`（`/teacher/enrollments/<id>/`），
  成長紀錄類再帶 `#growth-records` 錨點。
- 驗收實測：38/38 筆連結皆指向既有審核頁（DEMO 驗收 3-13／3-14）。
- 清單頁**唯一的 POST 表單是 `base.html` 的登出表單**，未新增任何寫入端點。
- **未建立第二套複核流程**：未新增複核路由、未新增複核模型、未複製任何複核表單。

### A.4 不自動判定合格、不核發證照

- 頁面明示：「本頁不自動判定學員合格或結訓通過，也不核發任何證照」。
- 未出現「考照合格率」「結訓通過率」「民航局證照取得」等字樣（自動化驗收逐字檢查）。
- 「八項已提交」僅表示已提交，頁面明示「不代表八項通過」。

---

## B. P6-B 班級成果匯出（兩種 CSV）

| 檔案 | 路由 | 視圖 |
| --- | --- | --- |
| A. 班級統計摘要 | `/teacher/class-report/export/summary/`、`.../summary/<cohort_id>/` | `teacher_cohort_export_summary` |
| B. 學員 R01–R08 成果明細 | `/teacher/class-report/export/records/`、`.../records/<cohort_id>/` | `teacher_cohort_export_records` |

### B.1 欄位

**A. 班級統計摘要（9 欄）**
`類別, 班級名稱, 班級編號, 項目代碼, 項目名稱, 已提交或完成, 班級人數, 已複核, 統計產生時間`
- 類別＝`班級摘要`（8 項指標）／`成長紀錄統計`（R01–R08 逐槽）／`五階段進度`（5 列）／`說明`（免責列）。

**B. 學員成果明細（12 欄）**
`班級名稱, 班級編號, 學員識別碼, 學員顯示名稱, 紀錄編號, 紀錄名稱, R01–R08 提交狀態, 教師複核狀態, 複核評分, 五階段完成, 五階段總數, 統計產生時間`
- 每位學員 × 每個 R01–R08 槽位一列（3 人班級 = 24 列）。

> 指令要求的「班級名稱、學員顯示名稱或既有班級識別碼、R01–R08 提交狀態、教師複核狀態、
> 五階段學習進度、統計產生時間」**全部具備**（學員以既有 `public_user_id` ＋ 暱稱呈現）。

### B.2 與 P5 報告同一套統計來源

- 由 `build_cohort_report(cohort)` 單一函式彙整；**P5 報告頁、P6 審核清單、P6 兩種 CSV 全部呼叫它**。
- 未自行推算考照合格率；未將「證」階段標示為民航局證照取得（CSV 內含明確免責說明列）。

### B.3 編碼與安全

| 要求 | 實作 |
| --- | --- |
| UTF-8 BOM（Windows Excel 繁中） | `CSV_BOM = "\ufeff"`，回應開頭 `EF BB BF`；`lineterminator="\r\n"` |
| 防止 CSV 公式注入 | `csv_safe_cell()`：以 `=` `+` `-` `@` `TAB` `CR` 開頭者前置單引號（OWASP CSV Injection） |
| 預設不匯出個資 | 不含 Email／電話／密碼／Token；自動化驗收逐字檢查 `@example.test`、`password`、`token` 皆不存在 |
| 不打包私人證據原始檔 | 不含 `/media/`、不含任何證據檔案內容或連結 |
| 不可公開快取 | `Cache-Control: no-store, no-cache, must-revalidate, private, max-age=0`、`Pragma: no-cache`、`X-Content-Type-Options: nosniff` |
| 不存放於公開靜態目錄 | 端點位於 `/teacher/...`，不在 `/static/`、`/media/` 之下 |

---

## C. 統計一致性（單一來源）

`build_cohort_report(cohort)` 回傳值為唯一權威：

| 使用端 | 取用欄位 |
| --- | --- |
| P5 班級成果報告頁 | `student_count / total_submitted / total_reviewed / pending_items_total / needs_revision_total / not_submitted_count / all_submitted_count / pending_student_count / slot_stats / stage_rows / student_rows / feedback_rows` |
| P6 結訓審核清單 | 上述 ＋ `pending_work_items / unsubmitted_items / review_result_rows / reviewed_result_total / unsubmitted_items_total / outstanding_total` |
| P6 摘要 CSV | `slot_stats / stage_rows / student_count / total_submitted / total_reviewed / pending_items_total / needs_revision_total / not_submitted_count / all_submitted_count / pending_student_count` |
| P6 明細 CSV | `student_rows[].slot_cells / reviewed_items / completed_stages / stage_total` |

**口徑（沿用 P5-A，未新定義）**
- 待複核工作項目集合 ＝ 成長紀錄提交（`submitted`／`needs_revision`）＋ 任務提交（`submitted`）。
- 待教師複核 ＝ `submitted`；需要補充 ＝ `needs_revision`；已複核 ∈ `{needs_revision, approved, rejected}`。
- 尚未提交 ＝ 狀態**不在** `GROWTH_SUBMITTED_STATUSES`（與既有常量互補）。
- 「尚待處理」＝ 尚未提交 ＋ 待教師複核 ＋ 需要補充。
- 「已有教師複核結果」＝ 成長紀錄複核紀錄 ＋ 任務（狀態 `reviewed` 或已填評語／評分）。

**驗收實測（P4.2 隔離測試庫，A 班 3 人）**
- P5 報告頁、摘要 CSV、結訓清單、測試庫**四方 8 項指標完全一致**。
- 逐槽統計 8 槽、五階段 5 列、明細 24 列，逐列與測試庫一致。

---

## D. 交付前安全檢查（P6-C）

| 要求 | 實作與驗收 |
| --- | --- |
| 所有報告與匯出端點重新驗證教師授權 | `@teacher_required`（未登入 302 → `/teacher/login/`；非 staff 403） |
| 教師不能匯出其他班級 | `_resolve_teacher_cohort()` 以 `teacher_cohorts(user)` 白名單解析；越權班級 `raise Http404`（**不洩漏是否存在**） |
| 學生與未登入者不得存取 | 實測 4 個端點：匿名 302、學員 403，且**未取得 CSV 位元組**（不含 BOM 開頭） |
| CSV 不應公開快取或存放於公開靜態目錄 | 見 B.3 |
| 保留既有證據下載授權 | 未修改 `evidence_download`；P5 證據授權驗收 59/59 仍全綠 |

---

## E. `.gitignore` 風險處理（P6 第四節）

### E.1 盤點結論

`demo/` 之下屬**執行期產物**者：`runtime/db/`（DEMO／驗證 SQLite）、`runtime/state/`、
`runtime/tmp/`、`runtime/logs/`、`runtime/chrome-vision-test/`、`runtime/vision-center/`、
`runtime/downloads/`、`runtime/*.json`、`runtime/*.txt`、`screenshots/`。

### E.2 最小增量更新（精確規則）

```
# DEMO 測試憑證（明文密碼）—— 絕不可進版本控制
*password*.txt
*帳密*.txt
*.password.txt
.fde-demo-credentials/

# DEMO 執行期產物（P6 精確規則）—— 只忽略執行期產物
demo/runtime/chrome-vision-test/
demo/runtime/vision-center/
demo/runtime/tmp/
demo/runtime/state/
demo/runtime/db/
demo/runtime/downloads/
demo/runtime/*.txt
demo/runtime/*.json
demo/screenshots/
```

**明確保留**（未被忽略，且經驗證可納版控）：
`demo/tools/**`（驗收腳本與種子程式）、`demo/*.md`（文件）、`demo/*.cmd`（啟動腳本）、
`demo/runtime/seed_demo_downloads.py`。

### E.3 驗證結果

| 檢查 | 結果 |
| --- | --- |
| `demo/` 之下可納版控檔案總數 | **67**（57 × `demo/tools`、9 × `demo/*.md` 與 `*.cmd`、1 × `seed_demo_downloads.py`） |
| `demo/tools/verify_p6_cohort_delivery.py` | TRACKABLE（應納版控） |
| `demo/runtime/db/p42_verify.sqlite3` | IGNORED |
| `demo/runtime/logs/*.png` / `*.log` | IGNORED（由既有 `.gitignore:5 logs/` 規則涵蓋） |
| P6 新增截圖與日誌 | 均為 IGNORED，不會誤入版控 |

### E.4 已追蹤敏感檔案

**未發現**任何已追蹤的敏感檔案（`git ls-files` 未包含憑證、DB、截圖或日誌）。
依指令**只報告、未自行從 Git 索引移除**；本輪**未執行** `git add`、`git clean` 或任何刪除資料的動作。

---

## F. DEMO 與手機驗收

### F.1 環境

| 環境 | 位址 | 資料庫 | 用途 |
| --- | --- | --- | --- |
| DEMO 展示 | `http://192.168.1.114:8110`（Django）／`:8111`（Live） | `demo/runtime/db/demo.sqlite3` | 教師實際展示 |
| 隔離驗收 | `http://192.168.1.114:8112` | `demo/runtime/db/p42_verify.sqlite3` | P4.2／P5／P6 驗收（0／部分／8 項情境） |

> 本輪因 DEMO 舊進程未載入 P6 新路由（`/teacher/` 曾回 500 NoReverseMatch），
> 已以 `demo/tools/stop_demo.ps1` → `start_demo_hold.ps1` **重啟 DEMO**，重啟後正常。
> 此為**進程未重啟**問題，非程式缺陷；正式環境不受影響。

### F.2 驗收工具與結果

| 腳本 | 目標 | 結果 |
| --- | --- | --- |
| `demo/tools/verify_p6_cohort_delivery.py` | :8112 | **97/97 PASS** |
| `demo/tools/verify_p6_csv_injection.py` | :8112（含建立／清除攻擊向量） | **16/16 PASS** |
| `demo/tools/p6_screenshot.cjs` | :8112（P42-A-2026） | **24/24 PASS** |
| `demo/tools/p6_screenshot.cjs` | :8110（DEMO 展示班） | **24/24 PASS** |
| `demo/tools/verify_p5_protected_pages.py` | :8110 | **18/18 PASS** |

**驗收腳本不以 HTTP 200 判定通過**：所有期望值皆由獨立測試庫唯讀查詢後在腳本內重新推導
（班級人數、逐槽提交／複核數、五階段完成數、逐位學員待處理數、逐列 CSV 狀態、CSV 統計值），
並與實際 HTML／CSV 內容逐項比對。

### F.3 截圖產物（`demo/runtime/logs/`，已 gitignore）

- `p6_checklist_p42a_desktop_full.png`（1440 全頁）
- `p6_checklist_p42a_iphone390x844.png`（390×844 首屏）
- `p6_checklist_p42a_iphone390_full.png`（390 全頁）
- `p6_checklist_p42a_a4_print_preview.png`（A4 列印媒體模擬）
- `p6_checklist_demo_*`（DEMO 展示班同四張）

### F.4 版面驗收重點

- 桌面 1440：無橫向溢出；六區塊順序正確；統計卡 4 張；尚未提交表 1–8 列；學員卡片逐位呈現。
- A4 列印：`table-layout:fixed` 後**無橫向溢出、表格不裁切**；`table-header-group` 表頭換頁重複；
  資料列 `break-inside:avoid`；列印時隱藏導覽列／頁尾／工具列／按鈕。
- 手機 390×844：**無橫向溢出（offenders=0）**；表格轉卡片（`thead` 隱藏、`tr` 非 table-row、
  `td` 顯示 `data-label`）；清單頁自身控制項 62 個**全部 ≥44px**。
  （`base.html` 共用導覽列 `.brand`／`.link-button` 為 34px，屬全站既有元件、非 P6 範圍，已單獨記錄。）

---

## G. P1–P5 回歸

| 套件 | 結果 |
| --- | --- |
| `learning.tests.test_teacher_cohort_delivery`（P6） | **33/33 OK** |
| P1–P6 九套件回歸<br>（`test_teacher_class_report`、`test_teacher_class_outcomes`、`test_student_learning_path`、`test_p2_task_record_chain`、`test_project_directions`、`test_student_tasks`、`test_teacher_catalogue`、`test_student_prop_scan_page`、`test_teacher_cohort_delivery`） | **213/213 OK** |
| `demo/tools/verify_p5_class_report.py`（:8112） | 59/59 PASS |
| `demo/tools/verify_p5_consistency.py`（:8112） | 24/24 PASS |
| `demo/tools/verify_p42_multiclass.py`（:8112） | 57/57 PASS |
| `demo/tools/verify_p5_protected_pages.py`（:8110） | 18/18 PASS |

`views.py` 對 HEAD 為 **+2921 / −0**（累計 P3–P6），`urls.py` 為 **+113 / −0**；
**未刪除任何既有程式行**，P5 統計來源重構後 P5 全套驗收仍全綠。

---

## H. 修改檔案與風險

### H.1 本輪（P6）修改與新增

| 類型 | 檔案 | 說明 |
| --- | --- | --- |
| 修改 | `student_portal/learning/views.py` | 抽出 `build_cohort_report()`；新增 `csv_safe_cell`、`_resolve_teacher_cohort`、`_csv_http_response`、`_export_stamp`、`_export_filename`、`teacher_cohort_review_checklist`、`teacher_cohort_export_summary`、`teacher_cohort_export_records`（全為附加式，0 刪除） |
| 修改 | `student_portal/learning/urls.py` | 新增 6 條 P6 路由 |
| 修改 | `.../templates/learning/teacher_dashboard.html` | 新增 P6 入口（+6／−1 行，僅插入區塊） |
| 新增 | `.../templates/learning/teacher_cohort_review_checklist.html` | 結訓審核清單模板 |
| 新增 | `.../static/learning/teacher-checklist.css` | 桌面／手機／A4 列印三段樣式 |
| 新增 | `student_portal/learning/tests/test_teacher_cohort_delivery.py` | 33 項 P6 測試 |
| 新增 | `demo/tools/verify_p6_cohort_delivery.py` | 97 項 DEMO 驗收 |
| 新增 | `demo/tools/verify_p6_csv_injection.py` | 16 項公式注入端到端驗收 |
| 新增 | `demo/tools/p6_screenshot.cjs` | 24 項截圖與版面驗收 |
| 修改 | `.gitignore` | 精確新增 19 行（見 E.2） |
| 修改 | `demo/tools/demo_credentials.py`（新增）＋ 19 個 `demo/tools/*.py` | 憑證改由版本庫外載入器取得（P6 第三步安全清理） |

### H.2 憑證安全清理結果

| 項目 | 結果 |
| --- | --- |
| 原本硬編碼 `DemoStudent#2026` / `DemoTeacher#2026` 的 DEMO 工具 | **19 檔** |
| 遷移後 | 全部改為 `demo_credentials` 載入器（env → `FDE_DEMO_CREDENTIALS_FILE` → `~/.fde-demo-credentials/*`） |
| 載入器設計 | **fail-closed**：找不到憑證即 `raise DemoCredentialsMissing`，**絕不回落預設密碼** |
| 全專案明文密碼掃描 | **0 筆** |
| 舊密碼驗證項 | 未設 `FDE_DEMO_OLD_PASSWORD` 時 `[SKIP]`（避免空字串造成假陽性） |
| 桌面憑證檔寫入 | `reset_demo_shared_password.py` 改為**預設停用**（桌面多位於 OneDrive 同步範圍） |
| 專案記憶檔 | 已改為**安全存放位置說明**，未再輸出任何密碼值 |
| 未執行 | 未刪除歷史資料、未改寫正式帳號；**密碼輪替另提方案（見 H.4），本輪未執行** |

### H.3 風險與殘留事項

| # | 風險 | 等級 | 說明與處置 |
| --- | --- | --- | --- |
| R1 | 桌面憑證檔 `D:\OneDrive\圖片\桌面\FDE_DEMO_測試帳密.txt` 仍在 OneDrive 同步範圍 | 中 | **僅報告，未刪除**。建議移出雲端同步目錄或刪除（需教師確認） |
| R2 | `~/.fde-demo-credentials/` 內 3 個憑證檔（shared／student01／student02）為設計內位置 | 低 | 位於使用者家目錄、不在版本庫；建議確認該目錄未被任何雲端同步涵蓋 |
| R3 | `demo/tools/stop_demo.ps1` 狀態檔記錄的 `django_pid` 為啟動器暫存 PID，非 8110 實際監聽 PID | 低 | 本輪重啟時仍成功釋放埠；若日後出現「埠未釋放」，請以 `CHECK_FDE_2_DEMO.cmd` 確認後手動處理。**本輪未修改啟停腳本** |
| R4 | `p5_screenshot.cjs` 若以 Git Bash 覆寫 `FDE_SHOT_REPORT_PATH`，MSYS 會把 `/...` 轉成磁碟路徑 | 低 | 僅影響環境變數覆寫；P5 預設值不受影響。`p6_screenshot.cjs` 已加入安全停止防護 |
| R5 | iPhone 真機未驗收 | — | 所有手機結果僅為 Chrome 模擬，`人工 iPhone 驗收：PENDING` |
| R6 | 真實 YOLO `:8765` 本輪未開 | — | 與 P6 無關；P6 不涉及推論鏈 |

### H.4 密碼輪替建議方案（**未執行**，待教師核准）

1. 於 `~/.fde-demo-credentials/` 產生新的 shared／student／teacher 三組高強度密碼。
2. 以既有 `demo/tools/reset_demo_shared_password.py`（改讀新憑證檔）重設 DEMO 庫密碼；
   P4.2 驗證庫教師／學員密碼另行以同一載入器重設。
3. 刪除桌面明文憑證檔，改以「憑證檔路徑說明」交付。
4. 重跑 `verify_p6_cohort_delivery.py`、`verify_p6_csv_injection.py`、`p6_screenshot.cjs`
   與 P5 三支驗收，確認全綠後才對外展示。
5. 輪替期間**不影響正式資料庫與正式帳號**。

---

## I. 11 項驗收對照表

| # | 指令要求 | 驗收方式 | 結果 |
| --- | --- | --- | --- |
| 1 | 兩班以上結訓清單 | 教師 A／B 各自只看到授權班級；A 班 3 人、B 班 3 人；互不混用 | PASS |
| 2 | 0／部分／8 項提交情境 | A 班三位學員分別為 0／3／8 項提交，逐位核對尚未提交／待複核／需補充／已複核／尚待處理 | PASS |
| 3 | 待複核與需要補充分類 | 12 筆待複核（含 2 筆任務提交）／1 筆需要補充，逐筆與測試庫對應 | PASS |
| 4 | P5 報告與 CSV 統計一致 | P5 報告頁／摘要 CSV／結訓清單／測試庫**四方 8 指標一致**；逐槽、五階段、明細 24 列一致 | PASS |
| 5 | CSV 繁體中文編碼 | UTF-8 BOM（`EF BB BF`）、`text/csv; charset=utf-8`、附件檔名正確、繁中欄名完整 | PASS |
| 6 | CSV 公式注入防護 | 5 種攻擊向量（`=`／`+`／`-`／`@`／TAB）＋ 惡意班級名稱，經 HTTP 匯出後全部中和且原文保留；清理後資料還原 | PASS |
| 7 | 教師跨班級權限隔離 | 清單／報告／兩種 CSV 越權皆 404；不存在班級亦 404 | PASS |
| 8 | 學員及匿名使用者禁止匯出 | 匿名 302 → 登入頁；學員 403；且未取得 CSV 位元組 | PASS |
| 9 | 無資料空狀態 | 空班級清單顯示 0 人與「尚無紀錄」；摘要 CSV 各項為 0；明細 CSV 僅標題與說明列 | PASS |
| 10 | 390×844 手機版 | 無橫向溢出（offenders=0）；表格轉卡片；自身控制項 62 個全部 ≥44px | PASS（Chrome 模擬）<br>**iPhone 真機 PENDING** |
| 11 | P1–P5 必要回歸 | 213/213 單測；P5 59/59、24/24；P4.2 57/57；保護頁 18/18 | PASS |

---

## 附件：本輪執行指令摘要

```
# P6 單元測試
manage.py test learning.tests.test_teacher_cohort_delivery            → 33 OK

# P1–P6 回歸
manage.py test <9 套件>                                              → 213 OK

# DEMO 驗收（需 :8112 獨立服務）
python demo/tools/verify_p6_cohort_delivery.py                       → 97/97
python demo/tools/verify_p6_csv_injection.py                         → 16/16

# 截圖與版面（Git Bash 需 MSYS_NO_PATHCONV=1）
node demo/tools/p6_screenshot.cjs                                    → 24/24（:8112 與 :8110 各一次）

# 既有驗收回歸
python demo/tools/verify_p5_class_report.py                          → 59/59
python demo/tools/verify_p5_consistency.py                           → 24/24
python demo/tools/verify_p42_multiclass.py                           → 57/57
python demo/tools/verify_p5_protected_pages.py                       → 18/18
```

---

**P6 完成，依指令停止，不自行進入 P7。**
