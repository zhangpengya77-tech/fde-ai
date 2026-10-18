# P8 成果展示安全加固與實際交付驗收 · 交付報告

專案：`D:\FDE-AI-UAS-v2.0`　分支：`fde-ai-v2.0-dev`　HEAD：`e5c0442`
日期：2026-10-13　指令依據：教師 P8 開發指令（七節，完整無截斷）

---

## 0. 完成等級與範圍宣告

| 項目 | 狀態 |
|---|---|
| 自動化測試（單元 + HTTP 驗收 + 截圖契約 + 副作用稽核） | **AUTOMATED PASS** |
| Chrome 裝置模擬驗收（1920×1080／1366×768／390×844） | **PASS（模擬，非真機）** |
| 真實 iPhone Safari 驗收 | **PENDING（未執行）** |

- 本報告所有「手機」「投影」畫面皆為 **Chrome DevTools Protocol 裝置模擬**，
  **與真實 iPhone Safari 為兩件事，分開陳述**，不得據此宣稱 REAL DEVICE PASS。
- 本輪**先修安全風險，再提升展示穩定性**；未新增第二套資料系統、未開發公開分享網站、**未新增 Migration**。
- 未執行 `git add／commit／push／merge／deploy／clean／reset`，未執行 `R07 --apply`。

---

## A. 報告讀取副作用稽核（P8-A）

**工具**：`demo/tools/audit_p8_readonly.py`（獨立稽核庫 `demo/runtime/db/p8_audit.sqlite3`，:8113）
**方法**：全庫逐表指紋（行數 + 內容 SHA256），任何 INSERT／UPDATE／DELETE 都會使指紋改變。

**結果：12 / 12 PASS**

| # | 稽核項 | 結果 |
|---|---|---|
| 1-1 | 未登入 GET 被攔截（P5／P7 皆 302） | PASS |
| 1-2 | 未登入 GET 未產生任何寫入 | PASS（無任何資料表變更） |
| 2-1 | 教師登入成功 | PASS |
| 2-2 | 登入僅影響 session（`django_session` 288 → 289 列） | PASS |
| 3-1 | 三個報告頁（P5 報告／P6 清單／P7 展示）皆 200 | PASS |
| 3-2 | 首次 GET 未寫入報告資料表 | PASS |
| 4-1 | 重複 GET 未寫入報告資料表 | PASS |
| 5-1 | 兩種 CSV 匯出成功且含 UTF-8 BOM | PASS |
| 5-2 | CSV 匯出未寫入報告資料表 | PASS |
| 6-1 | 跨班級讀取未寫入報告資料表 | PASS |
| 7-1 | 缺資料時 GET 確實觸發重建（證明寫入路徑存在） | PASS |
| 7-2 | 重建範圍僅成長紀錄提交與階段進度 | PASS |

### 稽核結論（已固化至 `build_cohort_report()` docstring）

`build_cohort_report()` **不是純唯讀，但為冪等的「讀取 ＋ 惰性初始化」**：

- **資料齊備時**：GET、重複 GET、CSV 匯出、跨班級讀取**皆不產生任何寫入**（逐表指紋驗證）。
- **資料缺失時**：會補建成長紀錄提交（`ensure_growth_submissions`）與階段進度
  （`PhaseProgress.get_or_create`）。實測：`learning_growthrecordsubmission: 48 → 56 列`、
  `learning_phaseprogress: 30 → 35 列`。
- 補建狀態皆為 `NOT_STARTED`，與「尚未提交／尚未開始」**等價**，**不改變任何統計語意**。

**是否修正**：**未修正**。依指令「僅在能證明不改變統計語意、不影響既有流程時才做最小修正」，
本項雖為寫入，但屬**五階段分母正確性的必要行為**（缺了補建，階段完成率分母會錯），
且為 P5／P6／P7 既有共用行為，**不應改為純唯讀**。已在 docstring 明確記錄，供後續輪次決策。

**確切呼叫位置**：`student_portal/learning/views.py::build_cohort_report()` 內，
由 `ensure_growth_submissions()` 與 `PhaseProgress.get_or_create()` 觸發；
呼叫者為 P5 報告頁、P6 結訓審核清單、P6 兩種 CSV 匯出、P7／P8 展示頁。

**未修改正式資料**：稽核全程只使用獨立副本庫；正式庫 `student_portal/db.sqlite3`
mtime 仍為 **2026-10-07 19:08**。

---

## B. 展示授權與隱私（P8-B）

### B-1 修正的真實缺陷：授權未按班級隔離

| 項目 | P7 原況 | P8 修正 |
|---|---|---|
| session 儲存 | **不分班級的單一布林值** | **班級集合（list）** |
| 切換班級 | 沿用其他班級的具名授權 | **不沿用**（逐班判定） |
| 舊版布林值 | — | **一律視為未授權**（不沿用） |
| 登出／session 過期 | — | 授權即失效 |

實作：`_showcase_consent_cohorts(request)` / `_showcase_store_consents(request, consents)`
（空集合時移除 session 鍵）。此為本輪發現並修復的**真實安全缺陷**，非新功能。

### B-2 匿名展示的強化（不只是隱藏姓名）

匿名模式下**完全不輸出**：

| 可識別項目 | 處理 |
|---|---|
| 學員暱稱 | 不輸出（改為「學員 01／02…」序號） |
| 既有唯一識別碼 `public_user_id` | **不輸出**（唯一編號仍可對應個別學員） |
| 教師評語內容 | **不輸出**（評語常含姓名） |
| 證據影像與外部連結 | **不載入** |
| context 內的識別列 | **不保留**（`feedback_rows=[]`、`review_result_rows=[]`） |

### B-3 匿名下的評語計數（P8-C 修正的語意缺口）

P8-B 改為匿名清空 `feedback_rows` 後，出現兩個副作用（本輪發現並修復）：

1. **空班級不再顯示「尚無紀錄」**：教師無法分辨「沒有評語」與「有評語但被隱藏」。
2. **評語筆數一律顯示 0**：明明有評語卻顯示 0，屬誤導。

修法：視圖層新增**純數字** `feedback_note_total`（不含任何可識別內容，匿名與具名兩模式一致）。
- 匿名 ＋ 有評語 → 顯示「共 N 筆評語（內容已隱藏）」
- 匿名 ＋ 無評語 → 顯示「尚無紀錄（目前尚無任何教師評語或回饋）」

### B-4 具名展示的標示

開啟具名時，頁面明確標示：

> **具名展示（教師確認已取得必要授權）**
> 具名展示＝教師確認已取得必要授權。本系統無法查核授權來源，開啟與否由教師自行負責；
> 請確認已取得學員（或其監護人）同意後再開啟。

並顯示「已聲明授權的班級」清單，讓教師確認作用範圍。

### B-5 本輪未做（依指令）

- 未新增同意書資料表、**未新增 Migration**。
- 未新增公開分享連結、未開放匿名觀看（整頁 `@teacher_required`；未登入 302、學員 403）。

---

## C. 投影及手機驗收（P8-C）

沿用 P7 既有七頁簡報，**未重新開發**。以 `demo/tools/p8_screenshot.cjs` 驗證。

**結果：`43 → 44 項` 全通過，且兩個環境皆 44/44**

| 環境 | 結果 |
|---|---|
| 隔離驗收庫 :8112 | **44 / 44 PASS** |
| DEMO :8110 | **44 / 44 PASS** |

| # | 驗證項 | 實測 |
|---|---|---|
| 1 | 1920×1080 投影 | 舞台 **1920×1080**，ratio **1.7778**（16:9），無橫向溢出 |
| 2 | 1366×768 筆電 | 舞台 **1365×768**，ratio **1.7778**，無橫向溢出 |
| 3 | 390×844 手機 | 填滿螢幕 **390×844**（非 letterbox），無橫向溢出 |
| 4 | 全螢幕進入與退出 | 進入後 `body.sc-presenting` 成立；`Esc` 可退出（`presenting=false`） |
| 5 | 鍵盤上下頁／Esc | `→` → outcomes、`←` → cover、`Esc` 退出，三解析度皆通過 |
| 6 | iOS Safari 全螢幕 fallback | 非 video 元素無 `requestFullscreen` 時，仍以 CSS 全螢幕呈現（契約已驗） |
| 7 | 沒有圖片時的空狀態 | DEMO 班無圖片證據 → 顯示空狀態，不影響其他頁 |
| 8 | 圖片載入失敗不影響展示 | 以 `Network.setBlockedURLs` 阻斷 `*/download/*` → 7 頁仍完整、可進入展示、可切頁 |
| 9 | 大量成果圖片載入效能 | 證據圖片皆 `loading="lazy"`；load event **373ms**（:8112）／**236ms**（DEMO） |
| 10 | 長篇教師評語不溢出 | overflowX **0px**、cellRight 1214 ≤ doc 1351 |

### C-1 修正的真實缺陷：長評語撐破版面

**現象**：注入 348 字無空白長評語後，頁面橫向溢出 **3721px**；`.sc-stage` 寬 1120px，
但 `.sc-slide` 被撐到 **4956px**。

**根因**（以 CDP 逐層 computed style 反查）：
1. **基礎樣式表存在全域 `table{white-space:nowrap}`**，被 `<td>` 繼承 → 長評語完全不換行
   （評語欄 `scrollWidth 4534px` / `clientWidth 484px`）。
2. `.sc-stage` 為 grid，`.sc-slide` 作為 grid item 的 `min-width:auto` 使投影片無法收縮至容器寬度。
3. `.sc-table` 為自動表格佈局，長欄位以 max-content 撐寬整張表。

**修法（僅本頁 CSS，不改全域規則）**：
- `.sc-table td{…white-space:normal}` 顯式覆寫（不改動全域 `table{white-space:nowrap}`，避免影響其他頁）
- `.sc-stage{grid-template-columns:minmax(0,1fr)}`、`.sc-slide{min-width:0}`
- `.sc-table{table-layout:fixed}` ＋ 教師回饋表列寬比例（評語欄 45%）
- 移除 legacy 的 `word-break:break-word`（不影響 min-content 計算，反而使長內容更難收斂）

修後：`overflowX=0px`、`scrollWidth == clientWidth`（完全換行）。

> **注意**：此缺陷在 P7 未暴露，因 P7 未測試長評語。**真實教師若填寫長評語，P7 版本會撐破版面**。

### C-2 驗收腳本修正（非產品問題）

DEMO 班無圖片證據、無評語列，導致版面契約項無法執行。已改為：
- 證據項：有證據必須經授權端點；無證據不得輸出任何證據連結（**不虛構**）。
- 長評語項：若該班無評語表格，以**與模板同構的模擬列**驗證 CSS 契約，並在輸出標註 `(模擬列)`。

---

## D. 圖片載入與效能（P8-C 後半）

| 項目 | 結果 |
|---|---|
| 圖片缺失（無檔案） | 顯示「證據檔案尚未處理」佔位，不影響其他頁 |
| 圖片載入失敗（網路阻斷） | 頁面仍完整渲染 7 頁、可進入展示、可正常切頁 |
| 大量圖片 | 全部 `loading="lazy"`，降低首屏成本 |
| 頁面載入時間 | 373ms（:8112，1 張證據）／236ms（DEMO，0 張） |
| 公開網址 | 全程**不使用 `/media/`**；證據一律經既有授權端點 `/evidence/<uuid>/download/` |

**未做**：未將私人圖片複製到公開靜態目錄；未新增大型前端框架（仍為零第三方依賴 vanilla JS）。

---

## E. 教師實際操作流程 SOP（P8-D）

**交付文件**：`docs/delivery/11-CLASS-SHOWCASE-SOP.md`（教師用，非技術語言）

流程：**登入 → 選擇班級 → 檢查成果 → 選擇展示模式 → 開始展示 → 結束展示**

重點提示（皆已寫入 SOP）：
- 系統**預設匿名化展示**，直接展示最安全。
- 開啟具名展示前，畫面會提示「教師確認已取得必要授權；本系統無法查核授權來源」。
- 授權**逐班分開**；切換班級不會沿用。
- **登出後授權失效**，下次登入需重新確認。
- 展示結束按 `Esc`；建議切回匿名或登出。
- iPhone 提示：Safari 不支援整頁全螢幕，畫面仍可正常播放。

---

## F. P1–P7 必要回歸

| 套件／腳本 | 結果 |
|---|---|
| P7 HTTP 驗收 `verify_p7_showcase.py`（:8112） | **89 / 89 PASS** |
| P7 單元 `test_teacher_class_showcase` | **41 / 41 OK** |
| P8 單元 `test_p8_showcase_security` | **37 / 37 OK** |
| P7＋P8 合併 | **78 / 78 OK** |
| **11 套件全回歸**（P1–P8） | **289 / 289 OK**（904.7s） |
| P8-A 副作用稽核 `audit_p8_readonly.py` | **12 / 12 PASS** |
| 截圖契約 `p8_screenshot.cjs`（:8112） | **44 / 44 PASS** |
| 截圖契約 `p8_screenshot.cjs`（:8110 DEMO） | **44 / 44 PASS** |

11 套件：`test_student_learning_path`、`test_p2_task_record_chain`、`test_teacher_class_outcomes`、
`test_teacher_class_report`、`test_teacher_cohort_delivery`、`test_teacher_class_showcase`、
`test_p8_showcase_security`、`test_project_directions`、`test_growth_records`、`test_student_tasks`、
`test_teacher_workflow`。

**驗收未以 HTTP 200 作為唯一依據**：每項皆有內容層、權限層、版面層、資料庫指紋層或統計一致性的具體斷言。

---

## G. 修改檔案與風險

### 修改檔案

| 檔案 | 變更 | 說明 |
|---|---|---|
| `student_portal/learning/views.py` | **+3103 / −0**（P7 累計 +3040，P8 增量 +63） | 授權逐班隔離、匿名強化、`feedback_note_total`、docstring 固化稽核結論 |
| `student_portal/learning/templates/learning/teacher_showcase.html` | 修改 | 隱私列、具名標示、匿名回饋區分流、計數 |
| `student_portal/learning/static/learning/teacher-showcase.css` | 修改 | 長評語換行、grid 收縮、表格固定佈局 |
| `student_portal/learning/tests/test_teacher_class_showcase.py` | 修改 3 項 | 配合 P8 契約（評語僅在具名模式斷言） |
| `student_portal/learning/tests/test_p8_showcase_security.py` | **新增 37 項** | P8 驗收 10 項 |
| `demo/tools/audit_p8_readonly.py` | 新增 | 副作用稽核 12 項 |
| `demo/tools/p8_screenshot.cjs` | 新增 | 截圖與版面契約 44 項 |
| `demo/tools/start_p42_verify.ps1` | 新增 | 隔離驗收服務啟動器（:8112／:8113） |
| `docs/delivery/11-CLASS-SHOWCASE-SOP.md` | 新增 | 教師操作手冊 |
| `docs/reports/P8_Report.md` | 新增 | 本報告 |

### 保護邊界核對（修改次數）

| 受保護項目 | 修改次數 |
|---|---|
| Migration（最新仍 `0019_golden_set_manifest_contract.py`） | **0** |
| 正式資料庫 `student_portal/db.sqlite3`（mtime 仍 2026-10-07 19:08） | **0** |
| R07 / M1–M4 / P1、P2 核心 / F450 數位孿生 / MP12 / 飛行健康 / 下載中心 / AI 助教 / Cloudflare / Gateway / 正式 v1.5C | **0** |
| `git clean / reset / commit / push / merge / deploy / R07 --apply` | **0** |
| 既有未提交成果 | **全數保留** |

### 風險清單

| 編號 | 風險 | 影響 | 現況 |
|---|---|---|---|
| R1 | 具名展示為教師自我聲明，系統無法查核授權來源 | 誤用時可能展示未授權作品 | 已於頁面明示；可稽核化需 Migration，待教師批准（見 H） |
| R2 | `build_cohort_report()` 於缺資料時會補建 | 與 P5／P6 既有行為一致，非新引入 | 已於 P8-A 量化並固化於 docstring |
| R3 | 匿名序號依 `public_user_id` 排序，學員增減會改變序號 | 教師口頭對照可能混淆 | 教師可切換具名對照 |
| R4 | 手機簡報不套 16:9，改填滿螢幕 | 與桌面投影版面不同 | 刻意設計（390px 下 16:9 過小） |
| R5 | iOS Safari 不支援整頁全螢幕 | 仍可展示（CSS 全螢幕），但無原生全螢幕 | 已實作 fallback；**真機未驗** |
| R6 | 全域 `table{white-space:nowrap}` 仍存在 | 其他頁面若有長欄位可能有同類問題 | 本輪僅修本頁（不改全域規則）；建議列入後續巡檢 |
| R7 | 非圖片證據（檔案類）無法在展示頁預覽 | 教師需點「開啟私有檔案」 | 屬既有設計，未變更 |

---

## H. 尚需教師批准的事項

1. **可稽核的學員展示授權紀錄**：目前具名展示為教師自我聲明，系統無從查核。
   若要正式可稽核，需新增資料欄位／資料表（**涉及 Migration**）。
   依 P8 指令，本輪**未實作**，僅提出設計方向，**等待教師批准後另開獨立輪次**。
2. **真實 iPhone Safari 驗收**：本輪僅完成 Chrome 裝置模擬。需教師以實機執行
   （進入展示、`Esc`、`←`／`→`、390×844 版面），方可標記 REAL DEVICE PASS。
3. **全域 `table{white-space:nowrap}` 是否統一收斂**：影響其他頁面長欄位；
   建議由教師決定是否另開巡檢輪次。

---

## I. P9 下一階段建議

1. **展示授權可稽核化**（需教師批准，含 Migration）：讓具名展示由系統查核而非教師聲明。
2. **投影與手機實機驗收**：以真實 16:9 投影機 ＋ iPhone 補齊 REAL DEVICE PASS。
3. **全域表格換行巡檢**：盤點其他頁面是否有同類長欄位溢出風險（唯讀盤點即可）。
4. **展示頁離線可用性**：教學現場網路不穩時，可評估產生單一自帶資料的靜態 HTML
   （維持不含 PPTX／影片／AI 文案的紀律）。
5. **教師後台入口整合**：現有 P3／P5／P6／P7 四個班級成果入口，可評估整合為單一工作區
   （**不改變各頁既有行為**）。

---

## 10 項驗收對照表（教師指令第五節）

| # | 驗收項目 | 結果 | 證據 |
|---|---|---|---|
| 1 | GET 與 CSV 的資料庫副作用 | **PASS** | 稽核 1-2／3-2／4-1／5-2／6-1（逐表指紋）；單測 `P8ReadOnlyAuditTests` 5 項 |
| 2 | 匿名模式的身分資訊隔離 | **PASS** | 單測 `P8AnonymityTests` 9 項；截圖「匿名模式未載入任何證據連結」「未使用公開 /media/」 |
| 3 | 班級切換的授權狀態 | **PASS** | 單測 `P8ConsentScopeTests` 8 項（逐班隔離、不沿用、舊布林值不沿用） |
| 4 | Session 失效 | **PASS** | 單測 `test_logout_invalidates_consent` |
| 5 | 教師跨班級權限 | **PASS** | HTTP 驗收 4-1～4-6（越權一律 404）；單測 `test_cross_cohort_post_is_404` |
| 6 | 證據下載權限 | **PASS** | HTTP 驗收 6-1～6-5；截圖「具名模式證據一律經授權端點」 |
| 7 | 投影與手機版面 | **PASS** | 截圖 1920×1080／1366×768／390×844 各項（16:9 比例、無溢出、填滿） |
| 8 | 圖片缺失及載入失敗 | **PASS** | 截圖「圖片失敗後仍可正常進入展示／切頁」；單測 `P8EvidenceFallbackTests` 4 項 |
| 9 | P5／P6／P7 統計一致 | **PASS** | HTTP 驗收 1-6～1-8、1-11；單測 `test_showcase_matches_p5_and_p6_sources` |
| 10 | P1–P7 必要回歸 | **PASS** | 11 套件 **289/289 OK**；P7 HTTP **89/89** |

**Chrome 模擬與真實 Safari 分開陳述**：第 7 項為 **Chrome 裝置模擬**；
**真實 iPhone Safari 驗收：PENDING**（見 H-2）。

---

## 附件：本輪執行指令摘要

- P8-A 報告讀取副作用稽核（12/12 PASS，結論固化，未改寫入路徑）
- P8-B 展示授權與隱私（修正逐班隔離缺陷、匿名強化、匿名計數語意修復）
- P8-C 簡報模式穩定性（44/44 × 2 環境，修正長評語撐破版面真實缺陷）
- P8-D 教師操作 SOP（`docs/delivery/11-CLASS-SHOWCASE-SOP.md`）
- 保護邊界全數 0 修改；完成即停，**不自行進入 P9**

**P8 完成，依指令停止。人工 iPhone 真機驗收：PENDING。**
