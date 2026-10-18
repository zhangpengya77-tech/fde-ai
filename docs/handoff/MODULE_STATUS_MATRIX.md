# MODULE_STATUS_MATRIX.md｜模組狀態矩陣

> 移交者：WorkBuddy ｜ 2026-10-14
> 狀態定義：
> **已可使用**＝功能完成且有測試／實測證據 ｜ **僅預留接口**＝有資料結構與四態顯示但未接入實際服務
> **已完成但尚未整合**＝功能完成但尚未接到最終使用端 ｜ **阻塞／待驗證**＝需教師實機或正式環境才能確認

---

## 1. 總覽統計（依據 I5 封版清單）

| 狀態 | 數量 |
|---|---|
| 已可實際使用 | 12 |
| 僅預留接口 | 5 |
| 已完成但尚未整合 | 2 |
| 尚有阻塞問題 | 0 |

---

## 2. P1–P9 階段成果

| 階段 | 功能 | 位置 | 狀態 | 測試／證據 |
|---|---|---|---|---|
| P1 | 五階段學習工作台（學→練→做→測→證） | `student_portal/learning/views.py`（學習路徑區塊）、`templates/learning/student_learning_path.html`、`static/learning/learning-path.css` | 已可使用 | I2 114/114；DEMO 47/47；iPhone **PENDING** |
| P2 | 任務紀錄鏈 R01–R08 | `learning/growth_records.py`、`growth_task_map.py`、`templates/learning/growth_record_detail.html` | 已可使用 | P2 報告 + `verify_p2_task_record_chain.py` |
| P3 | 教師班級成果 | `learning/views.py`、`templates/learning/teacher_class_outcomes.html`、`teacher-outcomes.css` | 已可使用 | P3 DEMO 驗收 + `verify_p3_class_outcomes.py` |
| P4 | 教師複核管理（4.1 篩選 / 4.2 多類別） | `learning/views.py`、`templates/learning/teacher_cohort_review_checklist.html`、`teacher-checklist.css` | 已可使用 | P4/P4.1/P4.2 報告 |
| P5 | 班級報告只讀頁 + CSV 注入防護 | `templates/learning/teacher_class_report.html`、`teacher-report.css` | 已可使用 | `verify_p5_class_report.py`、`verify_p5_consistency.py`、`verify_p5_protected_pages.py` |
| P6 | 班級交付 + CSV 安全 | `learning/views.py` | 已可使用 | `verify_p6_cohort_delivery.py`、`verify_p6_csv_injection.py` |
| P7 | 學員成果展示 | `templates/learning/teacher_showcase.html`、`teacher-showcase.js/css` | 已可使用 | `verify_p7_showcase.py` |
| P8 | 展示安全 | `learning/views.py` | 已可使用 | `test_p8_showcase_security.py` |
| P9 | 只讀班級報告 | `learning/views.py` | 已可使用 | `test_p9_readonly_report.py` |

---

## 3. I1–I5 交付前審查成果

| 階段 | 功能 | 位置 | 狀態 | 測試／證據 |
|---|---|---|---|---|
| I1 | 外部模組接口與權限隔離 | `student_portal/learning/external_modules.py` | 已可使用（**教師確認之最終測試基準**） | I1 46/46（含教師跨班級隔離補充驗收）；單元 63/63 |
| I2 | 五階段入口與四態模組狀態 | `external_modules.py` + `student_learning_path.html` | 已可使用 | I2 114/114 |
| I3 | 教學端到端流程及接口安全 | `verify_i3_e2e.py`、`verify_i3_modules.py` | 已可使用 | I3-A 45 PASS、I3-B 95 PASS |
| I4 | 跨服務統一入口與 `/platform/` 代理 | `live_backend/app/main.py` | 已可使用 | I4-A 31+9 PASS、I4-C deny 35 + allow 36 |
| I5 | DNS 重綁防護、IP Pinning、交付前審查 | `external_modules.py`、`config/settings.py` | 已可使用（安全） | I5-A 33/33、I5-B 39/39、單元 63/63 |

---

## 4. 核心功能模組

| 模組 | 位置 | 狀態 | 說明與證據 |
|---|---|---|---|
| F450 十二任務 | `live_backend/app/task_catalog.py`、`task_state.py`；Django `TaskDefinition`/`StudentTaskProgress` | 已可使用 | 五階段工作台已串接；≠ F450 3D 數位孿生 |
| AI Live Coach | `live_backend/app/coach_ask.py`、`orchestrator.py`、`teacher_style.py`、`providers/` | 已可使用 | camera→ONE FRAME→組裝答案→字幕→TTS |
| RAG 知識庫 | `live_backend/app/rag.py`、`rag_context.py`；服務 :8770 | 已可使用（正式問答待測） | 1105 docs；手機需經 8111 同源代理 |
| YOLO Vision（推論） | `live_backend/app/vision.py`、`vision_center.py`；服務 :8765 | **阻塞／待驗證** | 未啟動；DEMO 走模擬推論；≠ R07 提交 |
| R07 學員模型提交鏈 | `learning/vision_submission.py` → Live `POST /api/v1/vision/submissions` → `VisionCenter.create_submission` | 已完成 | 只存檔不推論；**不得重新開發** |
| 教師視覺模型倉庫 | `learning/vision_repository.py`、`vision_integrity.py`、`vision_verification.py`、`vision_snapshot.py`、`vision_flywheel.py` | 已完成 | 含 Golden Set 不可變保護 |
| 教師圖片測試頁 | `templates/learning/teacher_golden_test.html`、`teacher_vision_center.html` | 已可使用 | 教師端已可實際操作 |
| 學員端靜態圖片辨識前端 | —（`urls.py` **無路由**） | **已完成但尚未整合** | 屬待接入項目，見 `NEXT_DEVELOPMENT_BACKLOG.md` |
| 正式 YOLO 推論端到端 | — | **已完成但尚未整合** | 服務未啟動，需教師批准後實測 |
| 成長紀錄 R01–R08 | `learning/growth_records.py`、`growth_task_map.py` | 已可使用 | P2 報告 |
| 教師複核 | `learning/views.py`、`templates/learning/teacher_*.html` | 已可使用 | P4 系列 |
| 班級成果／報告 | `templates/learning/teacher_class_outcomes.html`、`teacher_class_report.html` | 已可使用 | P3/P5/P9 只讀 |
| 下載中心 | `live_backend/app/download_center.py` | 已可使用 | 6 個課程軟體（來源 `D:\下載中心文件`） |
| 手機 MVP | `src/vision-client.js`、`rag-client.js`、`platform-browser.js` | 已可使用（iPhone 待驗） | 同源代理 + 事件委託朗讀；iPhone **PENDING** |
| MP12 | `live_backend/app/mp12_state.py`、`mp12_catalog.py`、`mp12_models.py` | 已可使用 | ≠ 獨立 MP 地面站外部模組 |
| Flight Health AI | `live_backend/app/`（Mount `/flight-health/`） | 既有成果（保護） | I4-A 驗證不受影響 |
| 五階段工作台 | 見 P1 | 已可使用 | iPhone **PENDING** |

---

## 5. 外部模組與獨立專案（僅預留接口）

| 模組 | 設定 ID | 狀態 | 說明 |
|---|---|---|---|
| MP 地面站 | `MP_GROUND_STATION` | 僅預留接口 | Mission Planner 獨立軟體；預設停用；啟用需教師明確配置 |
| HQGC 評量 | `HQGC_ASSESSMENT` | 僅預留接口 | HQGC 獨立專案；metadata 主機無條件拒絕 |
| F450 數位孿生 | `F450_DIGITAL_TWIN` | 僅預留接口 | 獨立專案；工作台只顯示「待接入／規劃中」徽章、**無連結** |
| F450 3D 數位孿生 | — | 獨立專案 | 已存在但未接入 2.0；**不等於 F450 十二任務** |
| HQGC 獨立專案 | — | 獨立專案 | 不在 2.0 repo 內，禁止移動 |

---

## 6. 保護區既有成果（Codex 不得修改）

v1.5C 正式系統（獨立 repo）、YOLO 模型與 `best.pt`、R07 提交鏈、教師視覺模型倉庫、
ACTIVE 模型發布及回滾、Flight Health AI、F450 十二任務核心、R01–R08 既有成長紀錄、MP12、
HQGC 獨立專案、F450 3D 數位孿生獨立專案。詳見 `PROTECTED_MODULES.md`。

---

## 7. 待教師人工驗證（非自動化可完成）

| 項目 | 狀態 |
|---|---|
| 真實 iPhone Safari（7 站 32 項） | PENDING |
| 正式 Tunnel 登入 | PENDING |
| 正式 RAG 真實問答 | PENDING |
| 正式 YOLO 真實推論 | PENDING |
| 教師實際課堂試用 | PENDING |

> Chrome 390×844 裝置模擬**不算**真機結果。
