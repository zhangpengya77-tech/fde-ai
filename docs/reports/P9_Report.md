# P9 報告唯讀化與教師實際使用驗收 · 交付報告

**文件版本**：v1.0
**產出日期**：2026-10-13
**對應階段**：P9（報告唯讀化與教師實際使用驗收）
**分支**：`fde-ai-v2.0-dev`（HEAD `e5c0442`，未 commit／未 reset／未 push）
**完成等級**：**AUTOMATED PASS**（Chrome 自動化全通）；**iPhone 真機驗收：PENDING**

---

## 0. 完成等級與範圍宣告

| 項目 | 結果 |
|---|---|
| P9-A 報告唯讀化 | ✅ 完成（13/13 等價性證明 ＋ 最小修正） |
| P9-B 統計一致性與零寫入 | ✅ 完成（稽核 25/25） |
| P9-C 教師操作驗收 ＋ 一頁式 SOP | ✅ 完成（Chrome 自動化 32/32；SOP 已產出） |
| P9-D 交付安全檢查 | ✅ 完成（35/35） |
| P1–P8 必要回歸 | ⚠️ 全量 858 項，2 項**既有失敗**（與 P9 無關），P9 自身引入 0 項失敗 |
| iPhone 真機驗收 | ⏸️ PENDING（無真機操作證據，不自行宣稱通過） |

**本輪未做的事**（依 P9 指令與保護邊界）：
- 未新增教師後台功能；未改 R07／M1–M4／P1／P2 核心／F450 數位孿生／MP12／飛行健康／下載中心／AI 助教／Cloudflare／Gateway／正式 v1.5C。
- 未新增 Migration（最新仍為 `0019_golden_set_manifest_contract.py`）。
- 未執行 `git clean`／`reset`／`commit`／`push`／`merge`／`deploy`／`R07 --apply`。
- 未刪除 `ensure_growth_submissions()`，學員端與教師寫入路徑照常使用。

---

## A. 唯讀化前後架構

### A-1 前（P8 時代）

`build_cohort_report(cohort)` 是 P5 報告、P6 結訓清單、P6 兩種 CSV、P7 成果展示的**單一統計來源**，但內部為「讀取 ＋ 冪等惰性初始化」：

- 資料齊備時：GET／CSV 匯出皆不寫入（P8-A 已逐表指紋驗證）。
- **資料缺失時：會補建 `GrowthRecordSubmission` 與 `PhaseProgress`**（P8 稽核發現的副作用）。

### A-2 後（P9 起，純唯讀）

將「惰性初始化」自 `build_cohort_report()` **移出**，統計改為純讀取：

1. **槽位計畫**改呼叫新增的 `growth_record_slot_plan(enrollment)`（不建立任何資料列）：
   - 缺 `GrowthRecordDefinition` → 以配置檔 `growth_records_v1.json` 預設定義代替（`VirtualGrowthDefinition`）。
   - 缺 `GrowthRecordSubmission` → 以狀態 `NOT_STARTED` 的 `VirtualGrowthSubmission` 代替。
   - 選擇邏輯（小組專屬定義優先、`enabled` 過濾、排序）與寫入版**逐行對應**。
2. **五階段分母**改以**在學學員數**計算，不依賴 `PhaseProgress` 資料列是否存在；缺列等同「尚未開始」。
3. `ensure_growth_submissions()` **未刪除**（學員端開啟自己的成長紀錄、教師寫入路徑仍需要）。

### A-3 修改檔案與規模

| 檔案 | 變動 | 說明 |
|---|---|---|
| `student_portal/learning/growth_records.py` | +111 / −1 | 新增 `VirtualGrowthDefinition`／`VirtualGrowthSubmission`／`growth_record_slot_plan`；`ensure_growth_submissions` 不動 |
| `student_portal/learning/views.py` | P9-A 區塊 +3 / −0（含於累計 diff） | `build_cohort_report()` 循環體兩處替換（槽位計畫 ＋ 階段分母）＋ import ＋ docstring 更新 |
| `student_portal/learning/tests/test_p9_readonly_report.py` | 新增（未追蹤） | 13 情境等價性測試 ＋ 黃金基準（`baselines/p9/*.json`） |
| `student_portal/learning/tests/test_p8_showcase_security.py` | 修改 | P8 契約測試隨 P9 新契約更新（見 G-2） |

---

## B. 缺失資料情境統計等價證據

**`test_p9_readonly_report.py`：13 情境全部等價通過。** 證明手法比黃金基準更嚴謹：

1. 在同一資料狀態上，以 `transaction.savepoint()` 包住 `_legacy_initialize()`（重現 P8 補建行為）取「修正前統計」，再 `savepoint_rollback` 回滾；
2. 對**完全相同**的資料狀態執行唯讀統計，逐項比對；
3. 另與黃金基準檔比對，鎖定不漂移。

13 情境：空班級、0 項提交、部分提交、8 項已提交、待教師複核、需補充、已複核、缺提交列、缺階段進度、缺定義、多學員混排、小組覆寫、多班級。

**`audit_p9_readonly.py`：25/25。** 階段 7 **刻意刪除報告資料列後再 GET／CSV 仍零寫入**（P8 時代此處會補建）；階段 8 確認缺資料下 R01–R08 槽位不消失（24/24 格顯示「未開始」）、學員人數不變、已提交／已複核歸零。

---

## C. GET／CSV 零寫入驗證

對獨立稽核庫（`p9_audit.sqlite3`，由 `p42_verify.sqlite3` 複製）啟動的 Django :8114 服務，於每階段前後比對**全庫逐表指紋**（行數 ＋ 內容 SHA256）：

| 階段 | 動作 | 結果 |
|---|---|---|
| 3-2 | 首次 GET（P5 報告／P6 清單／P7 展示） | 零寫入 ✅ |
| 4-1 | 重複 GET | 零寫入 ✅ |
| 5-2 | 兩種 CSV 匯出 | 零寫入 ✅ |
| 6-1 | 跨班級讀取 | 零寫入 ✅ |
| 7-1 | **缺資料時 GET** | 零寫入 ✅（P8 時代會補建） |
| 7-2 | 缺資料時 CSV 匯出 | 零寫入 ✅ |

---

## D. P5–P8 統計一致性

P5 報告、P6 清單、P6 兩種 CSV、P7 展示**共用 `build_cohort_report()` 同一份統計來源**：

- 9-1：P5 報告與 P7 展示統計逐項相同（5 項共同標籤）。
- 9-2：P5／P6／P7 共同標籤數值一致。
- 9-2b：P6 清單與 P7 展示共同標籤數值一致。
- 9-3：P5 與 P6 班級人數一致。
- 9-4：CSV 摘要含班級人數且與頁面一致。

---

## E. 教師操作 SOP（P9-C）

**自動化驗收 `p9_teacher_flow.cjs`（Chrome 裝置模擬）：32/32 通過。**

九步流程全數走通且斷言正確：
1. 教師登入 → 2. 選擇班級（跨班級隔離） → 3. 查看待複核成果（四項統計） → 4. 查看結訓審核清單（指向既有審核頁） → 5. 查看班級成果報告 → 6. 匯出兩種 CSV（200 ＋ UTF-8 BOM ＋ 不含 Email／密碼） → 7. 開啟成果展示（預設匿名、7 頁簡報） → 8. 使用匿名簡報（鍵盤切頁、維持匿名） → 9. 退出展示與登出（受保護頁面不可再開）。

**一頁式 SOP：`docs/delivery/12-TEACHER-DAILY-FLOW-SOP.md`**（非技術教師可獨立照做）。

---

## F. 手機與權限驗收

| 項目 | 結果 |
|---|---|
| 手機 390×844（Chrome 模擬）：教師四頁可讀且不橫向溢出 | ✅ PASS（4/4 頁 overflowX=0） |
| 教師跨班級權限（P9-C 2-2 ＋ P9-D B ＋ 稽核 10-1/2/3） | ✅ 越權一律 404，不洩漏 |
| Session 展示授權隔離（P9-D C） | ✅ 逐班隔離 ＋ 跨 session 隔離 ＋ 可回復匿名（6/6） |
| **iPhone 真機 Safari 驗收** | ⏸️ **PENDING**（無真機操作證據，不自行宣稱通過） |

> 所有「Chrome 裝置模擬」結果均明確標註，與「真實 iPhone Safari」分開紀錄；真機驗收須待教師在實體 iPhone 上實際操作並回報。

---

## G. P1–P8 回歸

### G-1 全量後端回歸（learning 套件）

`manage.py test learning`：**858 項執行，829 項通過，2 項既有失敗，26 項 skipped。**

P9 自身引入的失敗：**0 項**。唯一與 P9 直接相關的測試（P8 契約測試 `test_build_cohort_report_is_documented_as_*`）反映 P8 時代契約，已被 P9-A 有意取代，已更新為 P9 新契約並通過。

### G-2 既有失敗（與 P9 無關，待教師決定修復或列為已知限制）

| 測試 | 失敗原因 | 與 P9 關聯 | 證據 |
|---|---|---|---|
| `test_auth.StudentRegistrationTests.test_platform_hero_action_opens_student_growth_portal` | 前端 JS 資源 `src/platform-browser.js` 的 hero 標籤已改（預期 `我的學習日誌`，現版無此字串） | 無（P9 未動前端） | 更早的全量日誌 `learning-full-test.log` 已記載此失敗 |
| `test_vision_flywheel_framework.VisionFlywheelFrameworkTests.test_teacher_sees_only_authorized_models_with_four_status_dimensions` | 教師視覺模型清單頁模板（`teacher_vision_model_list.html`，2026-10-10 改版）已移除 `訓練用途` 維度文字 | 無（P9 未動該視圖／模板；`teacher_vision_model_list` 對 `build_cohort_report` 引用為 0） | 該模板 2026-10-10 改版後即不再含此字串；P9 始於 2026-10-13 |

> 建議：此 2 項屬早期階段遺留的契約／模板不同步，不在 P9 範圍內。教師可選擇（a）修復測試或頁面使其一致，或（b）列為已知限制、於後續階段處理。P9 不擅自改動 P9 範圍外的產品邏輯。

### G-3 重點模組回歸（含 P9 新測試）

- P8 ＋ P9 安全／唯讀模組：`test_p8_showcase_security` ＋ `test_p9_readonly_report` → **50/50 OK**。
- P9-A 等價性：`test_p9_readonly_report` → **13/13**。
- P9-B 零寫入稽核：`audit_p9_readonly.py` → **25/25**。
- P9-C 教師流程（Chrome）：`p9_teacher_flow.cjs` → **32/32**。
- P9-D 交付安全：`audit_p9_delivery.py` → **35/35**。
- P5–P7 HTTP 回歸（報告／清單／展示）：`verify_p6_cohort_delivery.py` → **97/97**（含 P5/P6/P7 共同標籤與零寫入相關項）。

---

## H. 安全與保護邊界

| 檢查項 | 結果 |
|---|---|
| DEMO 明文憑證是否再次出現 | ✅ 未出現（已追蹤檔案、工作區全域掃描皆無明文密碼；憑證檔 `*.password.txt`／`.fde-demo-credentials/` 均被 `.gitignore` 排除且不存於專案目錄） |
| `.gitignore` 是否正確排除執行期資料 | ✅ `demo/runtime/db`、`demo/runtime/state`、`demo/runtime/logs` 等皆 `IGNORED`；`git ls-files demo/runtime` 為空 |
| 是否存在未授權公開證據網址 | ✅ 無；媒體目錄未以 `static()` 掛載（GET `/media/...` → 404）；證據一律經 `/evidence/<uuid>/download/` 授權端點；未登入存取 → 導向登入頁 |
| 教師跨班級權限 | ✅ 越權班級頁面／CSV 一律 404，不洩漏是否存在 |
| Session 展示授權隔離 | ✅ 逐班隔離 ＋ 跨 session 隔離 ＋ 可回復匿名 |
| 正式資料庫是否未被修改 | ✅ `student_portal/db.sqlite3` 最後修改時間仍為 **2026-10-07 19:08:32**，SHA256 未變 |
| Git 未提交成果是否完整保留 | ✅ 工作區 **184** 項變更（142 未追蹤 ＋ 42 已修改）保留；HEAD 仍為 `e5c0442`；Migration 仍 `0019` |

**保護邊界核對（P9 自身修改計數）**：受保護模組（R07、M1–M4、P1/P2 核心、F450 數位孿生、MP12、飛行健康、下載中心、AI 助教、Cloudflare、Gateway、正式 v1.5C）**0 修改**；**Migration 新增 0**；**正式資料庫寫入 0**；**git 寫操作 0**。

---

## I. 尚待完成及需教師批准事項

1. **iPhone 真機 Safari 驗收：PENDING。** 所有 Chrome 模擬結果已明確標註，但真機操作證據尚缺。請教師於實體 iPhone 上走完 P9-C 九步並回報。
2. **2 項既有測試失敗（G-2）待教師決定**：修復或列為已知限制。P9 不擅自改動 P9 範圍外產品邏輯。
3. **完成 P9 後停止**，不自行進入 P10。若需進入 P10，請教師明確批准並給定主題。

---

## 10 項驗收對照表（教師指令）

| # | 指令要求 | 結果 |
|---|---|---|
| 1 | 報告讀取不產生寫入（P9-A 唯讀化） | ✅ 25/25 零寫入稽核 ＋ 13/13 等價性 |
| 2 | 不改 R01–R08 提交／複核／五階段語意 | ✅ 等價性證明；缺資料正確表達未開始 |
| 3 | 缺資料下 0 提交學員不消失 | ✅ 8-2 學員人數不變；8-4 24/24 格顯示未開始 |
| 4 | 不新增 Migration | ✅ 最新仍 `0019` |
| 5 | 不修改正式資料 | ✅ 正式 DB mtime 未變 |
| 6 | 10 種情境統計一致（P9-B） | ✅ 25/25 稽核 |
| 7 | 教師操作九步 SOP（P9-C） | ✅ 32/32 ＋ 一頁式 SOP |
| 8 | Chrome 與 iPhone 真機分開記錄 | ✅ Chrome 全通；iPhone PENDING |
| 9 | 交付安全檢查（P9-D） | ✅ 35/35 |
| 10 | P1–P8 回歸 | ⚠️ 全量 858；2 項既有失敗（非 P9），P9 引入 0 |

---

## 附件：本輪新增／修改檔案

- 修改：`student_portal/learning/growth_records.py`、`student_portal/learning/views.py`、`student_portal/learning/tests/test_p8_showcase_security.py`
- 新增（未追蹤）：`student_portal/learning/tests/test_p9_readonly_report.py`、`student_portal/learning/tests/baselines/p9/*.json`（13 個黃金基準）
- 新增（未追蹤，驗收工具）：`demo/tools/p9_teacher_flow.cjs`、`demo/tools/audit_p9_delivery.py`
- 新增（未追蹤，文件）：`docs/reports/P9_Report.md`、`docs/delivery/12-TEACHER-DAILY-FLOW-SOP.md`

**人工 iPhone 真機驗收：PENDING**
