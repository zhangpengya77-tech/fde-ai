# 安全範圍確認報告（教師裁決後第一步，唯讀）

日期：2026-10-15
依據：教師【教師裁決｜FDE-AI-UAS 2.0 五階段導航整合】執行順序第 1 步
狀態：**唯讀確認，未修改任何檔案、未動資料庫、未重啟服務**
分支：`fde-ai-v2.0-dev`｜HEAD `e5c0442`

---

## 一、四個候選檔案最新差異

| 檔案 | Git 狀態 | mtime | 差異內容 |
|------|---------|-------|---------|
| `templates/learning/base.html` | **M** | 2026-10-12 17:33 | 僅 1 行：學員導覽列新增「五階段學習工作台」連結（原僅有「我的學習成長日誌」） |
| `templates/learning/student_dashboard.html` | **M** | 2026-10-12 17:33 | 僅 1 行：課程卡片由 1 顆鈕改為 3 顆鈕（五階段學習工作台 / AI 目標檢測 / 我的學習成長日誌） |
| `templates/learning/student_learning_path.html` | **??（未追蹤）** | 2026-10-13 17:05 | 新檔，176 行，P1 建立之五階段工作台模板 |
| `static/learning/learning-path.css` | **??（未追蹤）** | 2026-10-13 17:05 | 新檔，五階段工作台專用樣式 |

**結論**：四個檔案皆為「P1/P2 階段由本專案（WorkBuddy 前身 Codex）建立」的檔案，
**不是其他代理（Flight Health／影片複核）的工作範圍**。差異明確、範圍可控。
且兩個 M 檔的差異都只有 1 行，無隱藏的第三方修改。

## 二、其他代理的檔案所有權與修改狀態

依 mtime 排序，最近 48 小時內被修改的檔案分布清晰：

| 時間 | 檔案 | 歸屬 | 與本輪關係 |
|------|------|------|-----------|
| 2026-10-14 20:59 | `flight-health/js/app.js` | **代理 A：Flight Health** | 🛑 不碰 |
| 2026-10-14 20:39 | `flight-health/css/style.css` | **代理 A** | 🛑 不碰 |
| 2026-10-14 20:38 | `flight-health/index.html` | **代理 A** | 🛑 不碰 |
| 2026-10-14 12:25 | `demo/tools/verify_flight_health_frontend.cjs` | 驗收工具 | 🛑 不碰 |
| 2026-10-14 12:16 | `demo/tools/verify_mobile_390x844.cjs` | 驗收工具 | 🛑 不碰 |
| 2026-10-14 07:55 | `live/task-ui.test.cjs` | **代理 B：Live Coach** | 🛑 不碰 |
| 2026-10-14 07:53 | `live/index.html`、`live/live-coach-simplified-ux.test.cjs` | **代理 B** | 🛑 不碰 |
| 2026-10-14 01:22 | `tests/test_external_module_interface.py` | I5 安全測試 | ⚠️ 本輪若動模板須同步 |
| 2026-10-14 01:03 | `external_modules.py` | I1/I5 外部模組介面 | 🛑 不碰 |
| 2026-10-13 18:58 | `live_backend/app/main.py` | Live Backend | 🛑 不碰 |
| 2026-10-13 18:17 | `tests/test_i3_student_experience.py` | I3 驗收測試 | ⚠️ 本輪若動模板須同步 |

**結論**：
- **代理 A（Flight Health）**：工作範圍 = `flight-health/`（未追蹤目錄），最後修改 2026-10-14 20:59。與本輪 4 個候選檔**零重疊**。
- **代理 B（Live Coach／影片複核）**：工作範圍 = `live/`、`live_backend/`、`growth_record_detail.html`、`growth-upload.js`。與本輪 4 個候選檔**零重疊**。
- **無任何其他代理正在修改** `base.html`、`student_dashboard.html`、`student_learning_path.html`、`learning-path.css`。

## 三、A1 核實：FOUR_SIDE_HOVER 既有真實路由與權限

### 3.1 後端端點（實測存在）

| 項目 | 實測結果 |
|------|---------|
| 路由定義 | `live_backend/app/vision_api.py:361` → `Route("/api/v1/vision/hover-video", hover_video, methods=["POST"])` |
| 掛載 | `main.py:541` → `routes = vision_routes(center) + [...]`，已隨主 app 掛載 |
| 實測（8111） | `POST http://192.168.1.114:8111/api/v1/vision/hover-video` → **HTTP 422**，body `{"error":{"code":"video_analysis_failed","message":"video_file_required"}}` |
| 判定 | ✅ **端點真實存在且請求驗證正常**（非 404、非 500），與 `prop-check`（同樣 422 `invalid_prop_request`）行為一致 |
| 模型類型 | `vision_center.py:17` → `MODEL_TYPES = ("PROP_DIRECTION", "FOUR_SIDE_HOVER")`，兩者為同一套 Vision Center 管理 |
| 類別契約 | `HOVER_CLASSES = ("FRONT", "RIGHT", "BACK", "LEFT")`；`HOVER_CLASS_CONTRACT` 同 |

### 3.2 前端呼叫鏈（實測存在）

```
平台 /platform/eagle 頁面
  → #hoverButton click (src/app.js:1334)
  → window.FdeVisionClient.hoverAnalyze({ base: visionApiBase(), fileDataUrl, fileName })
  → POST ${base}/api/v1/vision/hover-video   (src/vision-client.js:146)
```

`visionApiBase()` 解析規則（`src/vision-client.js:39–54`）：
`VISION_API_MODE='auto'` → 若頁面為 loopback 用 `VISION_API_BASE_URL`（`http://127.0.0.1:8030`）
→ 否則用 `PUBLIC_VISION_API_URL`（目前**空字串**）→ 再退 `sameOrigin`。
`sameOrigin` 允許 http 協定（line 31 僅在頁面為 https 時才要求外部 URL 為 https）。

### 3.3 A1 判定

| 教師條件 | 核實結果 |
|---------|---------|
| 「先核實 FOUR_SIDE_HOVER 的既有真實路由與權限」 | ✅ 完成。端點 `/api/v1/vision/hover-video` 存在、掛載正確、實測回應 422 驗證錯誤；前端呼叫鏈完整；走既有 Vision Center（`active_model("FOUR_SIDE_HOVER")`）＋既有模型管理，**不需新建任何功能** |
| 「如可安全在模板層加入連結，可採用最小修改」 | ✅ **可安全採模板層方案**。既有真實入口為 `/platform/eagle`（平台 `#inspection` 區塊內已含「四面懸停檢測」上傳區）。模板層只需新增一個指向 `/platform/eagle` 的 `<li class="lp-entry">`，**零 views.py 改動、零新頁面、零新 API** |
| 「不得建立虛假測試功能」 | ✅ 遵守。僅連向既有真實端點，不新增任何模擬／假結果 |
| 「不得修改受保護 views.py」 | ✅ 遵守。**完全避開 views.py**，採模板層硬編連結 |

### 3.4 誠實揭露（不得誇大）

`/platform/eagle` 頁面上的「四面懸停檢測」按鈕，其預設 API base 在**非 loopback 頁面**下會因
`PUBLIC_VISION_API_URL` 為空而退回 `sameOrigin`（即 8111 自身），而 8111 上的
`/api/v1/vision/hover-video` 端點**確實存在**（實測 422），因此同源路徑可達。
但**該端點需要 `FOUR_SIDE_HOVER` 類型的 ACTIVE 模型才會有真實推論結果**；
目前 YOLO `:8765` 未啟動、`FOUR_SIDE_HOVER` 無 ACTIVE 模型時，前端會顯示
「目前尚無可用模型」的誠實提示（`src/app.js:1016` `noModelMessage()`），**不會偽造 PASS**。

**因此本輪新增的「四面懸停辨識」入口，其驗收標準為：連結存在且指向既有真實頁面、
前往後不偽造結果。不宣稱「四面懸停已可完成真實推論」。**

## 四、本輪可安全修改的檔案範圍（最終確認）

| # | 檔案 | 授權 | 說明 |
|---|------|------|------|
| 1 | `templates/learning/student_learning_path.html` | ✅ **本輪修改** | 五階段超長單頁 → hash 切換、一次一階段；新增「四面懸停」entry 連結；保留五階段路徑列與 `#stage-*` 錨點 |
| 2 | `static/learning/learning-path.css` | ✅ **本輪修改** | 配合階段切換樣式；保留 `@media (max-width:680px)` 單欄與 `min-height:48px` |
| 3 | `templates/learning/student_dashboard.html` | ✅ **本輪修改** | 移除重複的五階段主入口（3 鈕 → 精簡），保留成長日誌入口 |
| 4 | `templates/learning/base.html` | ✅ **本輪修改** | 學員導覽列保留**唯一**「五階段學習工作台」入口 |
| 5 | `student_portal/learning/tests/test_student_learning_path.py` | ⚠️ **須同步調整** | 既有斷言需配合（見第五節） |
| 6 | `student_portal/learning/tests/test_i3_student_experience.py` | ⚠️ **須同步調整** | 同上 |
| 7 | 新增 `static/learning/learning-path-switch.js` | ✅ **可新增** | hash 切換邏輯（純前端、無後端） |

### 4.1 本輪明確不動（教師裁決 A3／A4）

- `index.html`、`src/app.js`、`src/platform.js`、`src/styles.css`、`src/router.js` — 平台側
- `templates/learning/platform_identity_nav.html` — 平台頁首導覽
- `views.py`、`urls.py`、`models.py`、`forms.py`、`growth_records.py`、`growth_task_map.py`
- `growth_record_detail.html`、`growth-upload.js`、`growth_video.py`、`growth_media.py`
- `flight-health/*`、`live/*`、`live_backend/*`

## 五、既有測試影響與同步計畫（A5）

### 5.1 受影響斷言

| 測試 | 斷言 | 影響 | 處理 |
|------|------|------|------|
| `test_student_learning_path.py::test_page_opens_with_five_stage_path` | `assertContains("學 → 練 → 做 → 測 → 證")`＋五個階段標題同頁 | 🟡 | 五階段路徑列仍在同頁 → **保留通過**；五個階段標題仍在（路徑列內） → **保留通過** |
| 同上 `::test_current_stage_follows_phase_progress` | `id="stage-build"`、`目前階段`、`前往「做」階段任務` | 🟢 | 保留（當前階段區塊仍渲染） |
| 同上 `::test_all_phases_completed_shows_completion_message` | `本期五階段皆已完成` | 🟢 | 保留判定邏輯於模板 |
| `test_i3_student_experience.py::test_five_stage_sections_and_nav_anchors_match` | 5 個 `id="stage-*"` 與 5 個 `href="#stage-*"` 一一對應 | 🔴 **會失敗** | 改為：路徑列保留 5 個 `href="#stage-*"`；`id="stage-*"` 仍全部輸出但非當前階段加 `hidden` |
| 同上 `::test_no_duplicate_entries_within_stage` | 依 `id="stage-"` 切段計數 | 🟡 | 需確認切段 regex 仍能運作 |
| 同上 `::test_planned_items_are_not_four_state_badges` | 恰好 3 個模組徽章 | 🟢 | 模組卡片仍全部渲染（隱藏非當前階段） |
| `test_p2_task_record_chain.py::test_p1_behavior_preserved` | 五標題 + `0 / 8` + `目前尚無教師回饋` | 🟡 | 保留路徑列與回饋區 → 可通過 |
| `test_external_module_interface.py::test_r01_r08_status_stable_across_repeated_views` | 同頁抓 8 個 `growth-slot">R0x<` | 🔴 **會失敗** | 需改為分階段抓、或確認八個 slot 仍全在 DOM |
| 同上 `::test_five_stage_existing_entries_present` | 五階段 entries 名稱 | 🟢 | 保留（entries 仍全渲染） |
| 同上 `::test_badges_use_unified_status_labels` | `body.count("尚未接入") == 3` | 🟢 | 保留（模組卡全渲染） |

### 5.2 最小衝擊設計原則（保住測試語意）

採 **「全部渲染 + CSS/JS 控制顯示」** 而非「後端只渲染當前階段」：

1. **五階段路徑列**（`lp-path`）保留全部 5 個階段的標題與 `href="#stage-*"` — 不動。
2. **五個 `<section id="stage-*">` 全部輸出** — 保住 `id="stage-*"` 與 8 個 `growth-slot`。
3. **五個「獨立實訓模組」與「規劃中專項」全部渲染** — 保住徽章計數。
4. 僅在**當前階段以外的 section 加 `hidden` 屬性**（純 HTML 屬性，不動 DOM 結構）。
5. JS 依 `location.hash` 切換 `hidden`；支援重新整理、上一頁／下一頁（`hashchange`）、手機。
6. 教師回饋區、常用入口區保留在頁尾（僅在「證」階段顯示，或常駐）。

**如此，第 5.1 節標記 🔴 的兩項測試，只需把「同頁可見」的斷言改為「同頁存在於 DOM」即可，
不改變任何既有語意（八項紀錄仍全在頁面上、狀態仍全部一致）。**

## 六、DEMO 隔離環境現況

| 服務 | 埠 | PID | 狀態 | 用途 |
|------|-----|-----|------|------|
| DEMO Django | 192.168.1.114:8110 | 6944 | LISTENING | 本輪隔離驗證 |
| DEMO Live Backend | 192.168.1.114:8111 | 17360 | LISTENING | 統一入口（代理 Django + downloads + flight-health + live） |
| 正式 Django | 127.0.0.1:8022 | 16360 | LISTENING | 🛑 不碰 |
| Vision API :8030 | — | — | **未啟動** | 誠實揭露（不宣稱懸停推論可用） |
| YOLO :8765 | — | — | **未啟動** | 同上 |

實測各入口（8111）：`/flight-health/` 200、`/downloads/` 200、`/live/` 200、`/platform/f450` 200。
`/student/` 302（未登入導向，正常）。

---

## 七、第一步結論

✅ **本輪可安全修改的範圍已確認**：4 個前端檔案（2 個 M、2 個未追蹤）＋ 1 個新增 JS ＋ 2 個既有測試同步。
✅ **與其他代理零重疊**：Flight Health（`flight-health/`）與 Live Coach／影片複核（`live/`、`live_backend/`、`growth_record_detail.html`）皆不在本輪範圍。
✅ **A1 核實完成**：FOUR_SIDE_HOVER 端點真實存在（實測 422）、前端鏈完整，可安全採模板層連結方案，**完全避開 views.py**。
✅ **A2–A5 已依裁決納入設計**：hash 切換、不碰平台側、不碰 `platform_identity_nav.html`、保留既有錨點。

🛑 **本輪不得宣稱**：「三套五階段已完全整合」。本輪僅完成「Django 單頁精簡」。
最終驗收標準（學員端只保留一套五階段主導航且顯示真實資料）**仍待平台側合併後達成**。

下一步：進入執行順序第二步 —— 在無衝突前提下修正 Django 五階段超長單頁問題。
