# 學員端五階段導航整合收尾 — 唯一主導航交付報告（2026-10-15 晚）

> 本輪依教師 2026-10-15 裁決完成「原版左側學練做測證作為唯一主導航」收尾（A3/A4 付諸執行）。
> 零後端、零路由、零 DB、零 git 寫入；所有修改停留工作樹。

## 〇、接續前狀態確認（教師要求四項）

### 1. 上一次開發任務進度（沒有重做）
- 2026-10-15 日誌與 `STUDENT_5STAGE_DELIVERY_REPORT_2026-10-15.md` 在案：五階段最小修改
  （Django C 工作台一次只顯示一個階段、首頁課程卡 3→2 鈕）**已完成**，測試
  單元 113/0、渲染 26/0、Chrome 切換 23/0（今次實跑 26/0）、既有入口 8/0 全過。
- 該輪交付報告第五節列 **A3/A4 尚待教師核准**：平台左側 `#moduleNav` 與重複入口收斂。
  **本輪即為核准後的收尾執行**，未重做任何已完成部分。

### 2. 工作樹完整性
- `git status` = **44 M + 149 ??（共 193 項）**，與 10-14 基線（44 M + 314 ??）＋本日五階段修改一致；
  本輪五個修改檔案的相對 HEAD diff 皆為最小改動（見第一节）。
- 18:00 後工作樹原始碼無第三方新改動（唯一例外：`demo/runtime/db/demo.sqlite3`，見下）。

### 3. 其他代理活動（⚠️ 如實回報）
機器上 **Codex / ChatGPT 相關行程自 18:01 起大量運行**，並觀察到：
- DEMO DB（`demo.sqlite3`）於 **18:15:47 被寫入**（非本代理；本輪對 DEMO 僅唯讀驗證）；
- 正式 Django **:8022 於 18:32、18:37 被外部行程重啟兩次**（PID 11724 → 12056，
  現由 YoloRuntime python 持有；10-14 紀錄為 PID 8640）；
- v1.5C repo 的 venv python 於 **18:37:40** 被啟動。
- **本輪未重啟/未觸碰正式 8022 與正式 DB**；上述皆非本代理行為，建議教師確認是否預期。
  本輪修改的 5 個檔案在動工前後 mtime 檢查無他人並發寫入。

### 4. DEMO 測試結果可用性
- 上一輪的測試結果本身有效，但 **8110/8111 服務已隨該工作階段結束而停止**（現僅 8022 正式與 8770 RAG 在聽）。
- 本輪已用 `demo/tools/start_demo.ps1 -NoBrowser` 重新啟動（綁定 **192.168.1.114**，與上輪結束時一致，
  iPhone 區網驗收位址不變），並**全部重跑通過**（見第三节）。

## 一、本輪修改檔案（5 個，皆前端／測試層）

| 檔案 | 性質 | 修改內容 |
|---|---|---|
| `src/platform.js` | 修改 | `moduleSections`「證」：移除 `key`（連結不再被 SPA router 攔截）、title/summary/goal 改為 R01–R08 真實成長日誌、`href: '/student/growth/'` |
| `src/platform-browser.js` | 修改 | 同上內容（**瀏覽器實際載入的副本**；與 platform.js 為手工同步副本——本輪實測發現漏改此檔會導致線上不生效，已同步） |
| `index.html` | 修改 | ① 手機選單「證」→ `/student/growth/`；② 「三分鐘看懂 FDE-AI」示範面板 07「證」→ `/student/growth/`（學習成長日誌 R01–R08）；③ `#certify`（`./github` 公開展示頁）補靜態 stage-guide（原 JS 注入退役，頁面外觀與內容不變，直達網址仍可開）；④ `platform-browser.js` 版本號遞增（`1.5b-course-sync` → `1.5c-nav-certify-growth`，避免 iPhone 快取舊導航） |
| `student_portal/learning/tests/test_public_platform.py` | 修改 | ① 手機選單順序斷言「證」→ `/student/growth/`（隨裁決同步）；② **退役** `aria-label="平台学习分类"` 斷言——B 組分類列已於 10-15 整合裁決合法移除，該斷言屬移除後遺留之**既有失敗**（HEAD 模板有該字串、工作樹沒有），非本輪造成，改為斷言左側 `aria-label="Main navigation"` 存在 |
| `.test-temp/5stage-check/verify_unique_nav.cjs` | 新建 | 唯一主導航 15 項 Chrome CDP 驗證 |

**未動（受保護核心）**：`views.py`／`urls.py`／`models.py`／`growth_records.py`／`growth_record_detail.html`／
`live/`／`live_backend/`／`flight-health/`／YOLO 與 `best.pt`／R01–R08 提交複核鏈／正式 DB／migration／git。

## 二、最終導航狀態（教師裁決落地）

**唯一主導航＝原版左側 `#moduleNav`（保留原版，字樣不動）**，實測內容：

| 階段 | 目標 | 對應教師指示 |
|---|---|---|
| 學 | `./courses`（課程影片與學習資源） | 學：知識學習 |
| 練 | `./simulator`（模擬器與考照練習） | 練：原有練習 |
| 作 | `./f450`（F450 組裝與 AI 助教） | 做：F450 組裝 |
| 測 | `./eagle`（鷹眼：槳葉方向＋四面懸停兩個入口） | 測：槳葉方向、四面懸停 |
| 證 | `/student/growth/`（Django 真實 R01–R08 成長日誌） | 證：R01–R08 成長日誌 |

- **實機點擊「證」落地**：`/student/growth/` → `302` → `/student/courses/1/growth/`
  （頁標「我的學習成長日誌｜FDE-AI-UAS DEMO 展示班」，含真實 R01–R08 八槽位），非 `./github` 展示頁。
- 保留：任（12 任務）、健（飛行健康）、展（歷屆成果）、師（教師複核中心）四項；
  下載中心、AI Live Coach、F450 十二任務、鷹眼檢測、Django 五階段工作台 C、`./github` 公開展示頁（直達仍可開）。
- 重複入口收斂：平台頁首五階段分類列（B 組）已於 10-15 整合裁決移除，本輪確認無殘留。

## 三、測試結果（本輪全部實跑，非引用）

| 層級 | 工具 | 結果 |
|---|---|---|
| Node 前端 | `node --test src/*.test.cjs live/*.test.cjs`（Node 22.22.2） | **188 / 0** |
| Django 隔離迴歸 | `run_isolated.py`（四模組，隔離 DB） | **113 / 0** |
| Django 平台頁 | `run_public_platform.py`（含本輪斷言更新） | **10 / 0** |
| 伺服器渲染 | `render_verify.py`（唯讀 DB 副本） | **26 / 0** |
| Chrome CDP 唯一主導航 | `verify_unique_nav.cjs`（**本輪新建**） | **15 / 0** |
| Chrome CDP 既有入口 | `verify_entries.cjs` | **8 / 0** |
| Chrome CDP 五階段切換 | `verify_5stage_switch.cjs` | **26 / 0** |

## 四、誠實揭露與待裁示

1. **QR Code**：v2.0 全 repo 無 QR Code 功能（搜尋僅 `PUBLIC_ID_ALPHABET` 字母表假陽性）。
   「保留 QR Code」一項無對象可動；若指 v1.5C 或其他系統的 QR 功能，請告知。
2. **「作」vs「做」**：原版左側導航第字為「作」（平台原版用字），Django C 用「做」；
   依「保留原版」原則本輪未改字樣。若教師要統一為「做」，下批可改（需同步更新既有測試斷言）。
3. **其他代理活動**：見第〇節第 3 項（正式 8022 被外部重啟兩次、DEMO DB 18:15 被寫入）。
4. **帳號列／Django topbar 仍各有「五階段學習工作台」→ C 單一入口**（屬功能頁入口，非主導航）；
   若教師要求左側導航成為唯一五階段相關入口（移除這兩處），請裁示後下批處理。
5. 本輪**未 commit／未部署／未動正式 DB／未動正式服務**；所有修改在工作樹。
6. DEMO 現況：**192.168.1.114:8110 / 8111 運行中**（教師 iPhone 驗收可直接連；
   `demo.student01@fde-demo.local`，密碼位置不變）。
