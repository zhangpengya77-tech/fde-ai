# 學員端五階段導航整合 — 本輪交付報告（2026-10-15）

> **範圍聲明（重要）**：本輪只完成「Django 五階段學習工作台單頁精簡（一次只顯示一個階段）」與「首頁重複入口移除」。
> **本輪並未將三套五階段導航（平台 A/B 靜態示範 ＋ Django C 真實）完全整合為一套。**
> 最終整合（A3/A4：平台左側導航與 Django 工作台合併、移除重複入口、僅留一套主導航）仍待代理完成 ＋ 教師下次核准。

---

## 一、本輪修改的檔案（共 4 個，皆位於 Django 學員端，零後端 / 零路由 / 零資料改動）

| 檔案 | 性質 | 修改內容 |
|---|---|---|
| `student_portal/learning/templates/learning/student_learning_path.html` | 修改 | ① 路徑列連結加 `data-stage-link`；② 五個 stage `<section>` 全部保留於 DOM，非當前階段加 `hidden` + `is-collapsed`；③ 「測」階段模板層新增 FOUR_SIDE_HOVER 連結（指向既有 `/platform/eagle`，不動 views.py）；④ 頁尾引入切換 JS。 |
| `student_portal/learning/static/learning/learning-path-switch.js` | **新建** | 純前端 IIFE：監聽 `hashchange` ＋ 重整還原，以 `hidden` 屬性控制僅顯示一個階段；支援點擊 / 直接設 hash / 重新整理 / 上一頁下一頁 / 手機；無 JS 時退回原生錨點（漸進增強）。 |
| `student_portal/learning/static/learning/learning-path.css` | 修改 | 新增 `.lp-stage[hidden]{display:none}`、`.lp-switch-note`、`.lp-path-step[aria-current]` 樣式。 |
| `student_portal/learning/templates/learning/student_dashboard.html` | 修改 | 課程卡片由 3 顆鈕改為 2 顆（移除與五階段重複的「AI 目標檢測」secondary 鈕），保留「五階段學習工作台」＋「我的學習成長日誌」。 |

**未動（受保護核心，依教師裁決 A1/A3/A4 本輪不碰）**：`views.py`、`urls.py`、`models.py`、`growth_record_detail.html`、`platform_identity_nav.html`、平台側 `index.html` / `src/*` / `platform.js` / `styles.css`、`live/`、`live_backend/`、`flight-health/`、`R01–R08` 既有邏輯、`R07 best.pt` 上傳與教師複核、Evidence 處理、正式 DB、migration、git 寫入。

---

## 二、修改前 vs 修改後

- **修改前**：五階段工作台把「學 → 練 → 做 → 測 → 證」五個 section 全部無條件渲染（無 `hidden`），整頁五段內容層層堆疊成一個超長單頁；首頁每張課程卡片有 3 顆鈕（含與五階段重複的「AI 目標檢測」）。
- **修改後**：五個 section 全部仍在 DOM（保留既有錨點、R01–R08 八槽位、各功能入口），**但同一時間只顯示一個階段**；點擊路徑列「學/練/做/測/證」切換；重整、上一頁、下一頁、手機皆可用；首頁課程卡片回歸 2 顆鈕。

> 說明：因本輪修改直接落在工作樹（未 commit），原始模板狀態已不可從 git 還原，故**無法提供「修改前」實際截圖**；上列「修改前」描述據原始模板邏輯（五段皆渲染、無 hidden）重現。修改後實際畫面見第三節截圖。

---

## 三、實際畫面（修改後，Chrome 實機擷取）

桌面版每階段各一張（`shots/desktop_stage_*.png`）：`learn` / `practice` / `build` / `assess` / `certify`。
手機版 390×844（`shots/mobile_default.png`、`shots/mobile_assess.png`，含四面懸停入口）。

---

## 四、測試結果（全部通過）

| 層級 | 工具 / 腳本 | 結果 |
|---|---|---|
| 單元回歸 | `run_isolated.py`（Django test runner，隔離 DB） | **113 項，FAILURES = 0** |
| 伺服器渲染 | `render_verify.py`（唯讀 DB 副本） | **26 / 0**（五 stage 在 DOM、恰一可見、5 個 data-stage-link、四面懸停連結、R01–R08 八槽位、既有入口保留、首頁 ≤2 鈕） |
| 實機瀏覽器 | `verify_5stage_switch.cjs`（Chrome CDP） | **23 / 0**（登入、初始恰一階段、逐一點擊僅一階段可見、直接設 hash、重整還原、上一頁/下一頁、R01–R08 真實狀態、四面懸停連結、手機 390×844 無溢出、無 JS 錯誤） |
| 既有入口回歸 | `verify_entries.cjs`（Chrome CDP，登入後逐項） | **8 / 0**（儀表板、五階段工作台、成長日誌 R01–R08 總覽、下載中心、Flight Health AI、AI Live Coach、F450 十二任務、鷹眼四面懸停 皆 200 可用，非 404 / 非錯誤頁） |

### R01–R08 真實狀態（取自 DEMO 真實 DB，非靜態示範）
- 已提交 5 筆（R01/R02/R05/R07/R08）→ 頁面顯示「待教師複核」；
- 未開始 3 筆（R03/R04/R06）→ 頁面顯示「○ 未開始」；
- 成長紀錄進度摘要：**已提交 5 / 8、教師已複核 0 / 8**（DEMO 尚未有教師複核，頁面誠實顯示「目前尚無教師回饋」）。

> 誠實揭露：Vision `:8030` 與 YOLO `:8765` 未啟動，故**不宣稱**懸停 / 槳葉推論「可用」；四面懸停連結僅指向既有 `/platform/eagle`（無 ACTIVE 模型時該頁顯示「目前尚無可用模型」），未偽造任何結果。

---

## 五、剩餘整合項目（待辦，非本輪範圍）

1. **A3**：平台 `/platform/` 左側 `#moduleNav` 與 Django 工作台最終合併為唯一主導航（本輪未動平台側 `index.html` / `src/*` / `platform.js` / `styles.css`）。
2. **A4**：最終移除重複五階段主入口（平台頁首 `fde-public-sections` 字樣「作」），確保全站僅留一套五階段。
3. **最終驗收標準**：學員端只保留一套五階段主導航，且顯示真實學習資料（本輪 Django C 已符合；A/B 平台靜態示範須收斂或改為引用 Django 真實資料）。
4. iPhone 真機七站 32 項驗收、正式 Tunnel、正式 YOLO 推論、教師課堂試用、R4/R5/R8 修復核准 —— 仍為 `PENDING_MANUAL`（待教師另行安排）。

---

## 六、DEMO 環境狀態（本輪驗證用）

- 為在隔離環境內執行實機瀏覽器驗證，將 DEMO 綁定於 **127.0.0.1:8110 / 8111**（loopback，Chrome 可連）；服務以背景任務持續存活。
- 若教師需以**手機區網**驗收（iPhone 真機七站），請以標準設定 `FDE_DEMO_BIND_ADDR=192.168.1.114` 重新啟動 DEMO（標準設定，本機 WLAN IP 仍為 192.168.1.114）。
- 本輪**未** commit / deploy / 動正式 DB / 動 migration；所有修改停留於工作樹。
