# I1 教學核心整合 — 唯讀盤點與最小整合方案（等待教師確認）

日期：2026-10-13
輪次：I1（教學核心整合）— 第一階段：唯讀盤點（指令「一、先核實現況」）
狀態：**僅盤點，未編碼。發現重大架構衝突，依指令停止並提交最小整合方案供教師確認。**

---

## 執行摘要與關鍵判定

本輪 I1 指令「一、先核實現況」要求唯讀確認 F450 數位孿生獨立專案是否存在，並明訂：
> 「若找不到獨立專案或無法確認版本，停止並回報，不得重建 F450。」

**判定結果**：
1. **F450 3D 數位孿生（真機對照模型與幾何結構）不存在** —— 全倉無任何 `.gltf/.glb/.obj/.fbx` 檔，無 Three.js / WebGL / Babylon 之 F450 幾何程式；`views.py:3428` 註明「本輪不開發 3D 模型與零件互動」。
2. **現存可用的 F450 功能 = F450 十二任務實訓（Live Coach）**，位於同一倉 `live_backend/app/task_catalog.py`（`F450CourseDefinition`，12 任務，`F450_PIXHAWK248` 硬體檔）＋ `live/` 前端 SPA（標題「F450 AI 實訓助教」、`/platform/f450`），含證據／反思上傳、`PENDING_TEACHER_REVIEW` / `NEED_REWORK` 狀態、R05 成長紀錄轉接（x/12、PENDING_SYNC）。此係**同一倉內的服務，非獨立專案**，且**從未被以「F450 數位孿生」之名接入工作台**。
3. **架構衝突（指令「若前置盤點發現重大架構衝突，先停止並提交最小整合方案」適用）**：
   - 工作台「做」階段 `views.py:3428` 將 F450 列為 `modules`：`("F450 數位孿生", "待接入", "獨立開發模組：位置待確認、尚未整合…")`，**無連結**（模板 `student_learning_path.html:127-135` 的 `modules` 區塊不渲染 `<a>`）。
   - 但全域導覽 `platform_identity_nav.html:29` 的「作」已連結 `/platform/f450`，而該路徑即為上述功能完整的 F450 十二任務 SPA。
   - 亦即：**F450 實訓已可由導覽抵達，卻在工作台被標示為「待接入、位置待確認」**——兩處不一致，且「F450 數位孿生」究竟指「3D 幾何孿生（不存在）」還是「十二任務實訓（存在）」存在歧義。

**結論**：3D 孿生專案無法確認（不存在），不得重建；十二任務實訓雖存在但未被以該名義接入工作台。依指令停止，提交最小整合方案供教師確認後再動工。

---

## 一、現有系統唯讀盤點（標記：已整合可用／獨立可用／部分完成／尚未接入／無法驗證）

| 項目 | 實際位置（已核對磁碟真碼） | 狀態 | 說明 |
|---|---|---|---|
| P1 五階段工作台 | `student_portal/learning/views.py` `LEARNING_PATH_STAGES`（:3387）、`student_learning_path.html`、`learning-path.css` | 已整合可用 | 五階段（學→練→做→測→證）路由 `student/learning-path/` 與 `student/courses/<id>/learning-path/` 皆存在 |
| P2 成長紀錄槽位 | `growth_task_map.STAGE_RECORD_SLOTS` R01–R08 | 已整合可用 | learn:R01 / practice:R02-R04 / build:R05 / assess:R06 / certify:R07-R08 |
| P3–P9 學員／教師功能 | `views.py`、`urls.py`、`templates/learning/*`、`tests/*` | 已整合可用 | 858 項回歸通過、唯讀化 13/13、零寫入 25/25、教師流程 32/32、交付安全 35/35（前輪 P9） |
| F450 3D 數位孿生 | 無 | **無法驗證（不存在）** | 無幾何模型檔、無 WebGL 程式；`views.py:3428` 註明不開發 3D 模型 |
| F450 十二任務實訓 | `live_backend/app/task_catalog.py`、`live/index.html`、`live/live.js`（`training_track: 'F450_TWELVE_TASK'`） | 獨立可用 | 12 任務、硬體檔 `F450_PIXHAWK248`、證據/反思/教師複核；由 `/platform/f450` 或 `/live/` 抵達 |
| 工作台「做」F450 卡片 | `views.py:3428` + 模板 `modules` 區塊 | **尚未接入** | 標「待接入／位置待確認、尚未整合」，無連結 |
| MP12 調參（Mission Planner） | `live_backend/app/mp12_catalog.py`/`mp12_models.py`/`mp12_state.py`、TASK_07 面板 | 部分完成（已接入主專案） | 工作台 build 條目「Mission Planner 調參實訓（MP01–MP12）」註「已接入主專案（TASK_07 調參面板）；端到端與教師複核流程仍待教師確認」 |
| HQGC 飛行考核 | `download_center.py:77-80`（`HQGC_Student_Setup.exe`）、下載中心 | 獨立可用（僅下載） | HQGC 為可下載桌面軟體，未以互動功能接入網頁工作台 |
| AI Live Coach 即時助教 | `live_backend`（`coach_ask.py`/`orchestrator.py`/`sessions.py`/`vision.py`）+ `live/` SPA | 已整合可用 | 導覽 + 工作台 learn 條目 `live_coach`→`/live/` |
| YOLO 目標檢測與模型中心 | `live_backend/app/vision_center.py`/`vision_api.py`、教師 `teacher_vision_center`、學員 `prop_scan`（M1–M4） | 已整合可用 | 手機槳葉方向辨識（M1–M4）為 assess 條目 |
| RAG 知識庫 | `live_backend/app/rag.py`/`rag_context.py`/`rag_guidance.py` | 已整合可用 | 經 Live Coach 問答 |
| Flight Health AI 飛行健康 | `flight-health/` 目錄、外部服務連結 | 獨立可用（外部連結） | 工作台 assess 條目 `flight_health`→`/flight-health/`（外部服務） |
| 成長紀錄 R01–R08 | `growth_task_map.STAGE_RECORD_SLOTS`、成長儀表板 | 已整合可用 | R05=F450 組裝（T05↔R05、T06 調參併入 R05）；F450 訓練→GR05 轉接（x/12、PENDING_SYNC）已存在 |

**不得把「獨立專案已完成」誤寫成「網站已整合」**：F450 十二任務實訓與 MP12 調參均屬 `live_backend` 同一倉服務，可經 `/platform/f450`、`/live/` 獨立使用，但**未被以工作台「做」階段卡片之名義接入**（F450 卡片仍標待接入；MP12 僅列為單一條目且端到端/教師複核待確認）。

---

## 二、F450 數位孿生：核心發現

- **不存在 3D 幾何孿生**：全倉搜尋無 `gltf/glb/obj/fbx`，無 Three.js/WebGL 之 F450 程式；`views.py:3383` 設計約束明載「未接入的獨立模組（F450 數位孿生）只顯示『待接入』，不得顯示成可正常使用」，`:3428` 註明「本輪不開發 3D 模型」。
- **存在 F450 十二任務實訓（資料級孿生）**：`task_catalog.py` 定義 `F450CourseDefinition`（12 任務、元件 `F450_FRAME`/`MOTOR_2212`、硬體檔 `F450_PIXHAWK248`），由 `live/` SPA 以共享渲染器呈現；具備真實操作事件（完成態、`PENDING_TEACHER_REVIEW`、`NEED_REWORK`）、證據/反思紀錄、R05 轉接。此即「F450 數位孿生」在專案中**唯一可對應的實體**。
- **衝突點**：工作台卡片（待接入、無連結）與全域導覽「作」→`/platform/f450`（功能完整 SPA）互相矛盾。

---

## 三、五階段教學整合流程（現狀，標出 F450 缺口）

| 階段 | 學員入口 | 可完成操作 | 結果保存 | 教師可見 | 進入成果紀錄 |
|---|---|---|---|---|---|
| 學 | 學習平台、下載中心、AI 助教 | 看課/下載/問答 | — | — | R01 |
| 練 | 模擬器練習（platform） | 模擬/考照練習 | — | — | R02–R04 |
| 做 | MP12 調參（live_coach→/live/）**＋ F450 卡片（待接入、斷鏈）** | MP12 調參面板可用；**F450 卡片無法進入** | MP12 經 TASK_07；F450 經 SPA 但入口斷鏈 | 是（live_backend） | R05（F450 經 GR05 x/12） |
| 測 | 槳葉方向辨識（prop_scan）、飛行健康（外部） | M1–M4 檢測、外部飛健 | 是 | 是 | R06 |
| 證 | 成長日誌（R07–R08） | 提交/展示 | 是 | 是（教師複核/展示） | R07–R08 |

**缺口**：學員在「做」階段**無法自工作台卡片進入 F450 實訓**（卡片斷鏈）；只能繞經全域導覽「作」。這與 I1 目標「在『做』階段接入 F450 數位孿生」直接相關。

---

## 四、尚未串接的資料流／衝突

1. **工作台↔F450 實訓入口斷鏈**：build 階段 `modules` 的 F450 卡無 URL；`live_coach` kind 指向 `/live/`，與導覽 `/platform/f450` 是否同一 SPA 需確認（兩者皆由 `platform_entry` 服務 `live/` 前端，應為同一實訓 SPA）。
2. **「F450 數位孿生」名義歧義**：指 3D 幾何孿生（不存在）或 12 任務實訓（存在）？決定後才能正確接入。
3. **MP12 端到端與教師複核**：build 條目已註「端到端與教師複核流程仍待教師確認」——TASK_07 調參成果如何併入 R05／教師複核尚未定稿。
4. **服務可用性**：F450 實訓依賴 `live_backend`（DEMO :8111）。若服務未啟動，SPA 載入但無法開任務——需「不可用提示」（I1-A 要求）。

---

## 五、I1 最小整合方案（供教師確認，尚未執行）

> 以下為方案草案，經教師確認後才動工。本輪僅盤點。

**目標（一句話）**：將工作台「做」階段現有「F450 數位孿生」待接入卡片，改為連往既存 F450 十二任務實訓（`/platform/f450` 或 `/live/`），使學員自工作台即能進入 F450 實訓並回流 R05，不新建任何功能、不建 3D 孿生。

**允許修改（最小化）**：
- `student_portal/learning/views.py`：`LEARNING_PATH_STAGES` 之 build 階段，將 F450 由 `modules`（無連結）改為 `entries` 並給 `kind`（或新增 `f450` kind→`/platform/f450`）；新增一個輕量可用性探測（判斷 `live_backend` F450 服務是否在線，離線時於卡片顯示「F450 實訓服務目前不可用」）。
- `student_learning_path.html` / `learning-path.css`：依既有 `entries` 區塊渲染 F450 連結與不可用提示（不新增第二套樣式）。
- `tests/`：新增/調整 P1 工作台測試，斷言 F450 卡片現為可點連結（或離線提示），且原本「不可點」之正則斷言需同步更新。

**禁止修改（凍結）**：R07、M1–M4、F450 真機模型/幾何（不存在亦不建）、MP12 內部程式、飛行健康、下載中心、AI 助教、Cloudflare、Gateway、正式 v1.5C；不新增 Migration；不修改正式 DB；不執行 git clean/reset/commit/push/merge/deploy、R07 --apply。

**驗收標準（草案）**：
1. 學員登入→課程→學習路徑→「做」→F450 卡片可點，進入既存 F450 實訓 SPA。
2. 未登入直接訪問 F450 路徑→導登入頁。
3. 跨課程權限：非該課程學員不可經由工作台取得 F450 入口（沿用現有 `student_required` / enrollment 檢查）。
4. `live_backend` 未啟動時，F450 卡片顯示清楚「不可用」提示，不得出現假連結/假完成。
5. 返回工作台正常；R05 真實提交（經既存 F450 實訓 SPA→GR05）教師可於 live_backend 複核；不新建第二套成長紀錄、不自動標 R05 通過。
6. 手機 390×844 模擬：F450 卡片與提示排版正常。
7. P1–P9 必要回歸（learning 套件）零新失敗；F450 原有功能未被破壞（live/ SPA、task_catalog 不動）。

**停止條件**：完成上述最小接入與驗收即停止，不自行進入 I2；iPhone 真機驗收標 PENDING（Chrome 模擬≠真機）。

---

## 六、下一輪建議（MP12 / Live Coach 深化，待本輪確認後排程）

1. **MP12 端到端與教師複核定稿**：將 TASK_07 調參成果併入 R05 的教師複核流（目前 build 條目註「待教師確認」）。
2. **Live Coach 深度接入工作台**：除 F450 外，將「AI 即時輔助」在練/做階段的入口與成長紀錄回流制度化（目前僅 learn 條目 `live_coach`）。
3. **HQGC**：若需網頁互動，先評估是否僅維持「下載中心＋外部啟動」模式（凍結保護：HQGC 內部程式不動）。
4. **3D 孿生**：若教師確認需要，屬獨立新專案，不在本輪（I1）範圍，須另行立項，且不得由本輪「重建 F450」。

---

## 保護邊界確認（本輪盤點期間）

- 未修改任何程式碼/模板/設定（僅讀）；HEAD 仍 `e5c0442`；Migration 仍 0019；正式 DB mtime 仍 `2026-10-07 19:08`；工作區未提交變更保留。
- 開發服務（:8112/:8114）已於上輪 P9 收尾時停止並釋放埠；本輪未啟動任何服務。

## 下一步

**等待教師確認「F450 數位孿生」之定義與第五節最小整合方案**後，才執行 I1-A/B/C。若教師確認「F450 數位孿生」= 現存十二任務實訓，則依第五節最小方案動工；若教師意指 3D 幾何孿生，則本輪無法執行（不存在且不得重建），請教師另行立項。
