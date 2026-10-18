# P2 五階段任務與成長證據鏈整合 — 交付報告

- 日期：2026-10-13
- 分支：`fde-ai-v2.0-dev`（HEAD 仍為 `e5c0442`，本輪未 commit／push／merge／deploy）
- 依據：教師 P2 正式開發指令（2026-10-13），接續 P1 五階段學習工作台
- 完成標準：AUTOMATED PASS（自動化測試 ＋ DEMO HTTP 層真實資料驗收）
- iPhone 真機人工驗收：**PENDING**（沙箱無法啟動可見 Chrome 擷圖，亦無真機；未宣告 REAL DEVICE PASS）

---

## A. 對應表（五階段 ↔ R01–R08 ↔ T01–T12）

以 `data/growth_records_v1.json` 與 `data/tasks_v1.json` 實際內容為準，集中維護於新模組
`student_portal/learning/growth_task_map.py`（不改寫 R01–R08 原始名稱、任務代碼或資料格式，
不做 migration；TaskDefinition 與 GrowthRecordDefinition 在 DB 層無外鍵，對應表只此一份）。

### A1. 階段 ↔ 成長紀錄槽位

| 階段 | R 槽位 | 判定依據 |
|---|---|---|
| 學 learn | R01 | 無人機基礎認知＝法規／安全／學科（T01 同學段） |
| 練 practice | R02、R03、R04 | 模擬飛行／真機飛行訓練／證照技能驗證皆為飛行「練習」；T03 在 tasks_v1.json 的 stage 即為 practice |
| 做 build | R05 | F450 工程組裝＝實作（P1 工作台「做」階段語義） |
| 測 assess | R06 | 鷹眼 AI 目標檢測（T09 同學段） |
| 證 certify | R07、R08 | 專業任務驗證／綜合成果展示 |

- 模組 import 時自我驗證：8 個槽位每個恰好歸屬一個階段、槽位格式 `^R0[1-8]$`、
  `validate_against_data()` 對照兩份 JSON（任務代碼／槽位皆存在、無遺漏槽位、每階段皆有任務覆蓋）。
- **與 P1 的差異**：R03 由 assess 改隸屬 practice（依據 tasks_v1.json 中 T03＝practice 與五階段語義）。
- **已知與 tasks_v1.json stage 標註的差異**（保留待教師確認，未改寫資料檔）：
  - T02（模擬飛行訓練）資料標為 learn；對應 R02 依「練＝飛行訓練」置於 practice。
  - T05（F450 工程組裝）資料標為 practice；對應 R05 依「做＝實作」置於 build。
  - 兩筆皆以同一張對應卡呈現（任務卡標 R 編號、紀錄卡可由任務卡抵達），學員操作與教師審核不受影響。

### A2. 任務 ↔ 成長紀錄（1:1，七對）

T01→R01、T02→R02、T03→R03、T04→R04、T05→R05、T09→R06、T11→R07。

- T01–T05 與 R01–R05 的 `evidence_required` 清單**逐項相同**（測試以資料實證）；
  T09↔R06、T11↔R07 依標題與語義對應。

### A3. 無 1:1 對應的任務（只顯示相關紀錄與歸屬說明，不得假裝已對應）

| 任務 | 相關成長紀錄 | 說明 |
|---|---|---|
| T06 飛控與感測器調校 | R05 | R05 飛控基礎認識的延伸練習 |
| T07 自主航線與任務規劃 | R07 | R07 專業方向子能力（航線任務） |
| T08 無人機 3D 測繪建模 | R07 | R07 專業方向子能力（測繪建模） |
| T10 機器人與無人系統開發 | 無 | 進階概念任務，目前無 R 槽位 |
| T12 空地協同與綜合 Capstone | R08 | R08 以整理既有成果為主，不強制對應 |

---

## B. 實際修改檔案與程式範圍

| 檔案 | 狀態 | 內容 |
|---|---|---|
| `student_portal/learning/growth_task_map.py` | 新增 | 對應表模組（常數＋查詢函式＋import 自我驗證＋`validate_against_data()`） |
| `student_portal/learning/views.py` | 修改（附加式） | 新增 import；`LEARNING_PATH_STAGES` 槽位改引用 `STAGE_RECORD_SLOTS`（單一權威來源）；成長卡加 description／完成要求／需附證據／教師複核狀態；任務卡加 M 碼、要求、證據清單、對應 R 槽位與真實狀態、相關紀錄、歸屬說明、教師回饋。diff vs HEAD：**+68 行 / 0 刪除**（P1 後為 1816 行附加，現 1884 行，全部為附加） |
| `.../templates/learning/student_learning_path.html` | 修改 | 成長卡／任務卡渲染上述內容；無對應槽位任務只顯示「相關成長紀錄」，未實作功能僅既有「待接入／規劃中」徽章 |
| `.../static/learning/learning-path.css` | 修改 | 新增 `.lp-card-desc/.lp-card-detail/.lp-card-label/.lp-card-list/.lp-card-linkline/.lp-card-note/.lp-card-review`（沿用既有配色；手機 680px 單欄規則未動） |
| `student_portal/learning/tests/test_p2_task_record_chain.py` | 新增 | 19 項測試（對應表純資料 10 項 ＋ HTTP 層 9 項） |
| `demo/tools/verify_p2_task_record_chain.py` | 新增 | DEMO 真實資料驗收工具（安全憑證載入，無明文密碼） |
| `demo/tools/start_demo_hold.ps1` | 新增 | 常駐啟動器（驗收期間保持 DEMO 服務存活；純 ASCII 內容） |
| DEMO DB（`demo/runtime/db/demo.sqlite3`） | 資料 | 以既有 `manage.py seed_tasks` 冪等播種 12 筆任務定義（DEMO DB 原先缺任務定義；不覆寫既有內容） |

未修改：R01–R08／T01–T12 原始資料檔、資料庫 schema（無 migration）、R07 提交與模型驗證流程、
M1–M4 前端、教師後台、下載中心、飛行健康、MP12、RAG 學生前端、正式 DB、Cloudflare／Gateway。
未執行：git commit／push／merge／clean／reset；R07 清理 `--apply` 維持暫停。

---

## C. 已完成功能

1. **任務卡完整資訊**：M01–M12 編號、任務名稱、描述、任務要求、需附證據、所屬五階段、真實提交狀態、教師回饋（有則顯示）、查看／提交成果入口（既有 `task_detail`）。
2. **成長卡完整資訊**：R01–R08 編號、名稱、描述、完成要求、需附證據、真實狀態、教師複核狀態（僅在有真实 `GrowthRecordReview` 時顯示）、進入紀錄入口（既有 `growth_record_detail`）。
3. **任務↔紀錄互相可達**：任務卡標註對應 R 槽位與該紀錄即時狀態；無 1:1 任務顯示相關紀錄與歸屬說明。
4. **狀態誠實**：沿用既有標籤體系（已提交＝「待教師複核」≠ 已透過＝「✅ 已完成」）；無教師審核不顯示合格；無資料顯示「目前尚無教師回饋」；未接入模組只顯示「待接入」。
5. **流程零新建**：提交／證據／教師複核一律走既有路由與資料表，未建立第二套 Evidence／Submission／成長日誌／教師審核資料庫。

---

## D. 測試結果

| 範圍 | 結果 |
|---|---|
| P2 新套件 `test_p2_task_record_chain` | **19/19 OK** |
| P1 工作台套件 `test_student_learning_path` | 18/18 OK（迴歸通過） |
| learning 全量迴歸（6 批，避免單次全跑觸發清理防護） | **673 項，2 失敗**（皆為 P0 基線既有，非本輪引入；見 E） |
| 前端 `node --test`（src＋downloads 9 檔） | 33 項，32 通過 / 1 失敗（P0 基線既有，見 E） |
| DEMO 真實資料驗收 `verify_p2_task_record_chain.py` | **21/21 PASS**（登入 → :8111 代理 → 工作台 200；M01–M12 十二張卡；T03↔R03、T05↔R05 對應連結；R03 隸屬 practice；T07 只顯示相關紀錄；已提交 1/8、教師已複核 0/8 真實計數；R07／M1–M4／成長日誌／T03 任務詳情凍結項正常） |

- 存證：`demo/runtime/logs/p2_reg_b1..b5b.log`、`p2_task_record_chain_demo.html`（33 KB 真實頁面）。

---

## E. 已知問題與風險（皆為 P0 既有，非本輪引入）

1. `test_auth.py::test_platform_hero_action_opens_student_growth_portal`
   期望 `label: '我的學習日誌'`，靜態資料現為「我的成長日誌」（P0 未提交改名造成的測試／資料矛盾）。
2. `test_vision_flywheel_framework.py::test_teacher_sees_only_authorized_models_with_four_status_dimensions`
   頁面缺少「訓練用途」標籤（P0 未追蹤檔既有矛盾）。
3. `src/download-center-entry.test.cjs` 標題正則不符（P0 RISK-07 既有）。

三者與 P1 驗收時完全一致；**本輪零新增失敗**。修復需改動 P0 未提交成果，超出 P2 授權範圍，列為待教師裁示。

---

## F. 其他風險與待確認事項

1. **指令第七節截斷**：教師指令第七節（凍結保護，R07 best.pt 上傳／模型格式驗證／教師模型…）在「教師模型」後中斷。本輪已按可辨識部分從嚴遵守：未觸碰任何 R07／模型驗證／教師模型相關程式；若補示內容含其他凍結項，依其執行。
2. T02／T05 的 stage 標註差異（A1）待教師確認；不對應任務的歸屬語義（A3）同待確認。
3. 桌面／手機截圖與 iPhone 真機驗收 **PENDING**（沙箱無法啟動可見 Chrome；無真機）。iPhone 測試完成前不得宣稱 REAL DEVICE PASS。
4. DEMO 帳密政策維持：驗收工具從環境變數或版本庫外憑證檔讀取，無明文、不輸出。

---

## G. Git Status

- 分支 `fde-ai-v2.0-dev`，HEAD `e5c0442`（未動）。
- 已追蹤修改 41 檔（P0 起既有未提交成果，全部保留）；`views.py` 對 HEAD 為 +1884 / −0 純附加（其中 P2 新增 68 行）。
- 未追蹤：P1 起的模板／CSS 與本輪新模組、測試、DEMO 工具、`demo/` 執行期產物。
- 未 commit／push／merge／clean／reset／deploy；正式 DB、正式 Cloudflare 設定未動。
