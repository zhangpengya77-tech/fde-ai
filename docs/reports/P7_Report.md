# P7 班級成果發表與教學展示中心 · 交付報告

專案：`D:\FDE-AI-UAS-v2.0`　分支：`fde-ai-v2.0-dev`　HEAD：`e5c0442`
日期：2026-10-13　指令依據：教師 P7 正式開發指令（七節，完整無截斷）

---

## 0. 完成等級與範圍宣告

| 項目 | 狀態 |
|---|---|
| 自動化測試（單元 + HTTP 驗收 + 截圖契約） | **AUTOMATED PASS** |
| 人工 iPhone 真機驗收 | **PENDING** |

- 本報告所有桌面／手機畫面皆為 **Chrome DevTools Protocol 裝置模擬**（含 print media emulation），
  **非真實 iPhone Safari 驗收**，不得據此宣稱 REAL DEVICE PASS。
- 本輪**未**開發 PPTX 自動生成、影片自動剪輯、AI 自動撰寫成果。
- 未執行 `git add／commit／push／merge／deploy／clean／reset`，未執行 `R07 --apply`。

---

## A. 成果展示頁（P7-A）

**入口**：教師後台 `teacher_dashboard.html` 新增並列入口「P7 · 班級成果發表與教學展示 → 班級成果展示中心」。

**路由**（`learning/urls.py`，附加式新增 2 條）

| 路由 | 名稱 |
|---|---|
| `/teacher/class-showcase/` | `teacher_class_showcase` |
| `/teacher/class-showcase/<str:cohort_id>/` | `teacher_class_showcase_cohort` |

**展示內容與資料來源**

| 指令要求 | 實作 | 來源 |
|---|---|---|
| 1. FDE-AI-UAS 品牌與班級名稱 | 封面頁（`slide-cover`） | `report.cohort.name` / `cohort_id` |
| 2. 班級學員人數 | 班級成果頁統計卡 | `report.student_count` |
| 3. 學 → 練 → 做 → 測 → 證 五階段概況 | `slide-stages` 表格 | `report.stage_rows` |
| 4. R01–R08 真實提交成果 | `slide-slots` 表格 | `report.slot_stats` |
| 5. 教師已複核的學習成果 | `slide-feedback` 統計 + 清單 | `report.review_result_rows` / `feedback_rows` |
| 6. 已有的學員作品及證據 | `slide-works` 學員卡 + 證據區 | `report.student_rows[].evidence_rows` |
| 7. 教師實際填寫的回饋 | `slide-feedback` | `report.feedback_rows` |

**單一統計來源**：展示頁呼叫 `build_cohort_report(cohort)`（P5 報告頁、P6 結訓審核清單、P6 兩種 CSV 共用同一函式）。
`teacher_class_showcase` **不重算任何統計**，只做呈現層包裝（`_showcase_student_rows`）。已由測試與 HTTP 驗收雙重證明數字一致。

**無資料**：空班級顯示「尚無紀錄」；作品區顯示「尚無紀錄（此班級目前尚無在學學員）」，教師回饋區顯示「尚無紀錄（目前尚無任何教師評語或回饋）」。

**用語紀律**：頁面明示「已提交不等於已通過」；「證」階段標示為「課程學習成果紀錄，非民航局專業操作證」。
測試以正則保證頁面**不含**「結訓通過名單」「已合格」「民航局證照」「考照合格率」「結訓通過率」。

---

## B. 16:9 簡報模式（P7-B）

**「開始展示」功能**：同一頁面的前端切頁，**不重新載入頁面、不產生任何檔案**。

**七頁順序**（`SHOWCASE_SLIDE_IDS`，已由測試鎖定順序與數量）

```
封面 → 班級成果 → 五階段概況 → R01–R08 → 學員作品 → 教師回饋 → 結語
cover → outcomes → stages   → slots   → works   → feedback → closing
```

**操作方式**

| 操作 | 實作 |
|---|---|
| 上一頁 / 下一頁 | 控制列按鈕 `#sc-prev` / `#sc-next` |
| 退出展示 | 控制列 `#sc-exit` 或 **Esc** |
| 鍵盤 | `←` `→` `PageUp` `PageDown` `空白鍵` `Home` `End` `Esc` |
| 全螢幕 | `requestFullscreen()`（失敗時仍以 CSS 全螢幕呈現，相容 iOS Safari） |
| 同步退出 | 瀏覽器 UI 退出全螢幕時，`fullscreenchange` 同步退出展示模式 |

**16:9 投影適配**：簡報模式採 letterbox 舞台

```css
width:  min(100vw, calc(100vh * 16 / 9));
height: min(100vh, calc(100vw * 9 / 16));
```

實測 1440×900 視口下舞台為 **1440×810（比例 1.7778 = 16:9）**，由截圖腳本以 `Math.abs(ratio - 16/9) < 0.05` 斷言通過。
字級採 `clamp(…vmin…)` 隨投影尺寸等比縮放。

**手機例外**：390×844 豎屏下不套用 16:9 letterbox（會過小），改為填滿螢幕（實測 390×844）。

**本輪未開發**：PPTX 自動生成、影片自動剪輯、AI 自動撰寫成果。前端為**零第三方依賴 vanilla JS**，
測試以 `import `/`require(`/`jszip`/`ffmpeg`/`PptxGenJS`/`MediaRecorder` 不存在作為契約。

---

## C. 真實證據與教師回饋（P7-C 前半）

- 證據列直接取自 `build_cohort_report()` 的 `evidence_rows`（成長紀錄既有 `Evidence`），**不新增查詢、不新增端點**。
- 圖片縮圖與私有檔案連結一律走**既有** `evidence_download`（`?inline=1` 供縮圖），該端點已內建：
  擁有者 或 `is_superuser` 或（`is_staff` 且具 `TeacherCohortAccess`）才可讀，否則 `Http404`。
- **不建立公開 `/media/` 網址**：頁面 HTML 經斷言不含 `/media/`，全部經 `/evidence/<uuid>/download/` 授權端點。
- 教師回饋只顯示**真有 `GrowthRecordReview` 紀錄且填有評語**者（成長紀錄）與**任務已有複核結果或評語／評分**者（任務提交）；
  系統不生成任何教師評語（測試以「尚無紀錄（目前尚無任何教師評語或回饋）」與空清單雙重驗證）。

---

## D. 隱私及授權驗收（P7-C 後半）

**設計前提**：現有資料模型**沒有**「展示授權」欄位，且本輪**不新增 Migration**。
因此採最保守策略：**預設匿名化，具名需教師顯式聲明**。

| 指令要求 | 實作 |
|---|---|
| 只顯示教師有權查看的既有證據 | 沿用 `evidence_download` 權限檢查（擁有者／授權教師；其餘 404） |
| 不得建立公開 `/media/` 網址 | 斷言頁面不含 `/media/` |
| 圖片與檔案沿用原有權限檢查 | 同上，未新增任何證據端點 |
| **預設以班級統計及匿名化成果展示** | 學員以「學員 01／02…」序號呈現；**不輸出暱稱**；**不載入任何證據影像與外部連結** |
| 展示姓名／照片／可識別作品前須有明確授權及展示條件；**無法確認時不顯示** | 教師須在頁面上**顯式聲明**「我已取得授權，開啟具名展示」（POST → session，**不寫 DB、不需 Migration**）；未聲明前一律匿名 |
| 不新增公開分享連結 | 無任何分享功能；斷言無 share 端點 |
| 不開放匿名觀看 | 整頁 `@teacher_required`；未登入 302、學員 403 |
| 額外強化 | 展示頁回應一律 `Cache-Control: no-store, no-cache, must-revalidate, private, max-age=0` + `Pragma: no-cache` + `X-Content-Type-Options: nosniff` |

**具名展示的可逆性**：教師可隨時按「改回匿名化展示」回到預設（session 清除，測試驗證）。
POST 一律重導回**本頁路徑**（`request.path`），避免開放式重導（測試以 `next=https://evil.example/` 驗證無效）。

**⚠️ 待教師確認**：由於系統無授權欄位，目前「具名展示」為教師的**自我聲明**，系統無法查核授權來源。
若後續需要可稽核的授權紀錄，需新增資料欄位（將涉及 Migration），建議列入 P8 或獨立輪次討論。

---

## E. 桌面／手機／投影畫面

截圖輸出於 `demo/runtime/logs/`（由 `demo/tools/p7_screenshot.cjs` 產生）：

| 檔案 | 內容 |
|---|---|
| `p7_showcase_desktop_full.png` | 桌面 1440 全頁（一般檢視） |
| `p7_showcase_slide_cover_16x9.png` | **16:9 投影簡報 · 封面頁**（1440×810 letterbox） |
| `p7_showcase_slide_outcomes_16x9.png` | **16:9 投影簡報 · 班級成果頁** |
| `p7_showcase_iphone390x844.png` | iPhone 390×844 模擬（首屏） |
| `p7_showcase_iphone390_full.png` | iPhone 390×844 模擬（全頁） |
| `p7_showcase_iphone390_slide.png` | 手機簡報模式（填滿螢幕） |
| `p7_showcase_demo_*.png` | DEMO 環境（:8110）同組 6 張 |

**截圖腳本斷言 37 項**（:8112 與 :8110 各 37/37 PASS），涵蓋：
版面順序、無橫向溢出、七頁齊備、五階段順序、R01–R08 列數、匿名化、
無 `/media/`、無證據連結（匿名時）、證照用語紀律、16:9 比例、控制列、
鍵盤 `→`／`←`／`Home`／`End`、按鈕切頁、`Esc` 退出、手機表格卡片化、44px 觸控目標、手機簡報填滿。

**修正紀錄**：首次截圖發現手機工具列「班級」標籤被擠成直排 → 手機斷點改 `label{display:grid;gap:6px}`，
重新截圖確認正常（37/37 PASS）。

---

## F. P1–P6 回歸

| 套件 | 結果 |
|---|---|
| P7 單元測試 `test_teacher_class_showcase` | **40/40 OK** |
| P1–P6 + P7 十套件回歸 | **250/250 OK** |
| （套件：`test_student_learning_path`／`test_p2_task_record_chain`／`test_teacher_class_outcomes`／`test_teacher_class_report`／`test_teacher_cohort_delivery`／`test_teacher_class_showcase`／`test_project_directions`／`test_growth_records`／`test_student_tasks`／`test_teacher_workflow`） | |
| `verify_p7_showcase.py`（HTTP，:8112 隔離庫） | **88/88 PASS** |
| `p7_screenshot.cjs`（:8112） | **37/37 PASS** |
| `p7_screenshot.cjs`（:8110 DEMO） | **37/37 PASS** |
| `verify_p6_cohort_delivery.py`（P6 HTTP 回歸） | **exit 0（無 FAIL）** |

P7 新增測試檔另含「P5 報告頁／P6 清單／P6 CSV 仍正常」與「`build_cohort_report` 鍵集合未變」的顯式回歸項。

---

## G. 修改檔案與風險

### 修改檔案（全部附加式）

| 檔案 | 變更 | 說明 |
|---|---|---|
| `student_portal/learning/views.py` | **+3040 / −0** | P7 區塊（`SHOWCASE_*` 常數、`_showcase_student_rows`、`_showcase_response`、`teacher_class_showcase`） |
| `student_portal/learning/urls.py` | **+125 / −0** | P7 兩條路由 |
| `student_portal/learning/templates/learning/teacher_dashboard.html` | **+7 / −1** | P7 入口（純插入，−1 為既有行尾） |
| `student_portal/learning/templates/learning/teacher_showcase.html` | 新增 | 展示頁與七頁投影片 |
| `student_portal/learning/static/learning/teacher-showcase.css` | 新增 | 桌面／16:9 投影／手機／列印樣式 |
| `student_portal/learning/static/learning/teacher-showcase.js` | 新增 | 簡報切頁、鍵盤、全螢幕（零依賴） |
| `student_portal/learning/tests/test_teacher_class_showcase.py` | 新增 | 40 項驗收 |
| `demo/tools/verify_p7_showcase.py` | 新增 | HTTP 驗收 88 項 |
| `demo/tools/p7_screenshot.cjs` | 新增 | 截圖與簡報契約 37 項 |
| `docs/reports/P7_Report.md` | 新增 | 本報告 |

### 保護邊界核對（修改次數）

| 受保護項目 | 修改次數 |
|---|---|
| Migration（最新仍 `0019_golden_set_manifest_contract.py`） | **0** |
| 正式資料庫 `student_portal/db.sqlite3`（mtime 仍 2026-10-07 19:08） | **0** |
| R07 / M1–M4 / P1、P2 核心 / F450 數位孿生 / MP12 / 飛行健康 / 下載中心 / AI 助教 / Cloudflare / Gateway / 正式 v1.5C | **0** |
| `git clean / reset / commit / push / merge / deploy / R07 --apply` | **0** |
| 既有未提交成果 | **全數保留** |

### 風險清單

| 編號 | 風險 | 影響 | 建議 |
|---|---|---|---|
| R1 | 「具名展示」為教師自我聲明，系統無法查核授權來源 | 誤用具名展示時可能展示未授權作品 | 若需可稽核授權，需新增欄位（涉 Migration），列入 P8 討論 |
| R2 | 展示頁呼叫 `build_cohort_report()` 會觸發既有冪等的 `ensure_growth_submissions` / `PhaseProgress.get_or_create` | 與 P5／P6 行為一致，非新引入 | 已於 P6 記錄；若需純唯讀，應獨立輪次重構 |
| R3 | 匿名化序號依 `public_user_id` 排序，重新整理順序穩定，但學員增減會改變序號 | 教師口頭對照可能混淆 | 教師可切換具名模式對照 |
| R4 | 手機簡報不套 16:9，改填滿螢幕 | 與桌面投影版面不同 | 刻意設計（390px 下 16:9 過小），已於 CSS 註明 |
| R5 | 瀏覽器不支援 Fullscreen API 時（iOS Safari 非 video 元素） | 仍可展示（CSS 全螢幕），但無原生全螢幕 | 已實作 fallback，截圖已驗證 |
| R6 | 證據檔案若已從磁碟移除 | 授權教師取得 404（非權限問題） | 頁面顯示「證據檔案尚未處理」 |

---

## H. P8 下一階段建議

1. **展示授權可稽核化**：新增學員「展示授權」欄位（需 Migration），讓具名展示由系統查核而非教師自我聲明；
   在此之前維持預設匿名。
2. **展示頁離線可用性**：目前簡報模式需連線載入頁面。若教學現場網路不穩，可評估產生單一自帶資料的靜態 HTML
   （仍不含 PPTX／影片，維持本輪紀律）。
3. **投影實機驗收**：以真實 16:9 投影機 + iPhone 進行一次人工驗收，補齊 P7 的 REAL DEVICE PASS。
4. **證據縮圖效能**：具名模式下若證據量大，可評估縮圖延遲載入與尺寸上限（目前 `loading="lazy"`）。
5. **P7 與 P5/P6 的入口整合**：教師後台已有 P3／P5／P6／P7 四個入口，可評估整合為單一「班級成果」工作區，
   但**不改變各頁既有行為**。

---

## 11 項驗收對照表（教師指令第四節）

| # | 驗收項目 | 結果 | 證據 |
|---|---|---|---|
| 1 | 班級統計與 P5／P6 一致 | **PASS** | 單測 `test_statistics_match_build_cohort_report`、`test_showcase_and_class_report_show_same_numbers`；HTTP `1-6`～`1-8`、`1-11` |
| 2 | 五階段與 R01–R08 真實數據 | **PASS** | 單測 `test_stage_rows_cover_five_stages`、`test_slot_rows_cover_r01_to_r08`；HTTP `2-1`～`2-6`；截圖斷言 |
| 3 | 無資料空狀態 | **PASS** | 單測 `test_empty_cohort_shows_no_record_state`；HTTP `3-1`～`3-4` |
| 4 | 教師跨班級權限隔離 | **PASS** | 單測 `test_cross_cohort_is_404`、`test_unauthorised_cohort_via_query_is_404`；HTTP `4-1`～`4-6` |
| 5 | 未登入與學員不可進入教師展示頁 | **PASS** | 單測 `test_anonymous_is_redirected_to_teacher_login`、`test_student_is_forbidden`；HTTP `5-1`～`5-6` |
| 6 | 證據存取授權 | **PASS** | 單測 `test_evidence_download_still_authorised`；HTTP `6-1`～`6-5` |
| 7 | 個資預設隱藏 | **PASS** | 單測 `test_default_is_anonymous`、`test_anonymous_mode_does_not_load_evidence_images`、`test_named_mode_requires_explicit_teacher_consent`；HTTP `7-1`～`7-10` |
| 8 | 16:9 簡報播放 | **PASS** | 單測 `test_seven_slides_in_required_order`、`test_css_supports_16_9_projection`；截圖 `16:9 投影舞台比例正確`（1440×810） |
| 9 | 上一頁、下一頁、Esc | **PASS** | 單測 `test_js_supports_arrow_keys_and_escape`；截圖 `鍵盤 → ／ ← ／ Home ／ End`、`「上一頁」／「下一頁」按鈕可用`、`Esc 退出簡報模式` |
| 10 | 390×844 手機模擬 | **PASS** | 單測 `test_css_supports_mobile_390`；HTTP `10-1`～`10-4`；截圖 `手機 390 無橫向溢出`、`表格卡片化`、`44px 觸控高度` |
| 11 | P1–P6 必要回歸 | **PASS** | 十套件 **250/250 OK**；`verify_p6_cohort_delivery.py` exit 0；單測 `test_p5_class_report_still_renders` 等 |

**驗收未以 HTTP 200 作為唯一依據**：每項皆有內容層、權限層、版面層或統計一致性的具體斷言。

---

## 附件：本輪執行指令摘要

- P7-A 班級成果展示頁（七項展示內容、沿用 `build_cohort_report`、無資料顯示「尚無紀錄」、用語紀律）
- P7-B 16:9 簡報播放（七頁、上下頁、Esc、方向鍵、不開發 PPTX／影片／AI 文案）
- P7-C 證據展示與隱私（預設匿名化、不建公開 `/media/`、不新增分享連結、不開放匿名觀看）
- P7-D 11 項驗收（全部通過）
- 保護邊界全數 0 修改；完成即停，**不自行進入 P8**

**P7 完成，依指令停止。人工 iPhone 真機驗收：PENDING。**
