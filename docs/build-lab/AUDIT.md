# 組裝實訓室升級 R2.1｜P0 只讀審計（AUDIT）

日期：2026-11-19　階段：P0（只讀審計）　狀態：**PASS（文件完成）／REA：BLOCKED**

## 1. Git 狀態

| 項目 | 值 |
|---|---|
| 來源 worktree | `D:\FDE-AI-courses`（分支 `feat/courses-zone`，HEAD `442b3cf`，工作區乾淨） |
| 正式站 | `D:\FDE-AI-UAS-v2.0-integration`（HEAD `442b3cf`，與上面相同，未動） |
| **本次新 worktree** | `D:\FDE-AI-build-lab`，新分支 `feat/build-lab-r2`，從 `442b3cf` 切出 |
| 本階段變更 | 只新增 `docs/build-lab/*.md`（7 份文件）；未改任何程式、正式站、資料庫 |
| 既有相關分支（未動） | `feat/f450-assembly-training`（`D:\FDE-AI-UAS-v2.0-f450-training`）、`feature/f450-twin-2.0`（`D:\FDE-AI-UAS-v2.0-f450-twin`） |

## 2. 現有數位孿生：入口與程式位置（已見）

| 項目 | 位置／內容 |
|---|---|
| 網站入口 | `index.html` 第 332～354 行，教學區「F450 數位孿生」卡片（`#buildF450Twin`），連結 `/f450-twin/` |
| 首頁 3D 無人機 | `src/hero-drone-3d.js`，共用 `/f450-twin/vendor/three` |
| 程式目錄 | `f450-twin/`（約 25 MB）：`index.html`、`app.js`（場景與五種模式）、`parts-data.js`（383 行零件／步驟／接線資料）、`wiring.html`（全螢幕接線頁）、`twin.css` |
| 實訓模組 | `f450-twin/training/` 13 支：`assembly-mode.js`（3D 組裝練習）、`wiring-canvas.js`／`pin-canvas.js`／`pins.js`（接頭級與引腳級接線，Pixhawk FMUv2.4.6 幾何）、`bench*.js`（接線工作台）、`scoring.js`、`session.js`（教學／練習／考核）、`records.js`（**寫入學員練習紀錄**）、`bus.js`／`sync3d.js`（2D／3D 同步） |
| 3D 模型 | `f450-twin/models/`：`f450-l2-r8-twin.glb`（357 KB）、兩個 r4 預覽 GLB（各 1.6 MB） |
| 3D 函式庫 | 內建 `f450-twin/vendor/three`：**three.js r181（MIT）**＋ addons＋ Draco 解碼器；用 importmap 載入，**沒有建置流程** |
| 既有模式 | 整機／爆炸／組裝／接線／尺寸；視角 等軸／上視／右視／前視；實拍對照、量測、全螢幕 |
| 伺服方式 | `live_backend/app/main.py` 第 754 行：`Mount("/f450-twin", StaticFiles(..., html=True))`，由 Live（:8141）提供 |
| 測試 | `live_backend/tests/test_f450_twin_page.py` |

## 3. 技術棧與周邊

- 網站前端：原生 HTML／CSS／ES Modules，無打包器；測試用 `node --test`、vitest 3.2.7、Playwright 1.64.1（`package.json`）。
- 導覽：`src/data/nav-config.js`（資料驅動，`featured／before／after`），專門給新入口用，避免改 `app.js`。
- 課程入口：`src/data/vocational-programs.js`、`src/programs.js` 有連到 `/f450-twin/`。
- 公開路徑：Cloudflare Worker（`cloudflare/v2-fixed-entry/src/index.js` 的 `DYNAMIC_PREFIXES`）→ Tunnel → Entry :8142 → Gateway :8143 → Django :8140 / Live :8141。
- 教師後台：Django `student_portal`（本案不碰）。

## 4. 重要發現（影響設計）

1. **新頁面若用新網址（如 `/build-lab/`），必須改 Live 後端加 Mount，可能還要改 Worker 的路徑清單** → 會碰到正式後端與 Worker。
   **建議：新版放在 `/f450-twin/build-lab/` 子目錄**，沿用既有的 `/f450-twin` 靜態掛載，不需要改任何後端、Gateway、Worker，也正好符合「放在數位孿生同一區域」。
2. 既有 `training/records.js` 會寫入學員練習紀錄（資料庫）。**新版第一版不得引用它**，成績只存瀏覽器本機並可匯出。
3. 既有 `pins.js` 已有 Pixhawk FMUv2.4.6 引腳級資料（來源 PX4 開源硬體，CC-BY-SA 3.0），P2 可以參考，但新版要另建「板卡配置檔」區分克隆版，不直接沿用假設。
4. 預覽可用 `python -m http.server`（埠 8095，避開禁用埠清單）直接從 worktree 提供靜態檔，不需要啟動正式服務。

## 5. 參考影片（已見）

| 項目 | 值 |
|---|---|
| 實際檔名 | `D:\Desktop\2026AI無人載具文件\數字孿生視頻.mp4`（你口語說的「數字學生視頻」即此檔） |
| 大小／長度 | 35,871,103 bytes（34.2 MB）／137.27 秒（2:17）✔ 與描述相符 |
| 規格 | 1280×590、60 fps，含音軌 |
| E 槽 | 已連接；E 槽同名資料夾內**沒有**此影片 |
| 複本 | `D:\FDE-AI-Build-Lab-Reference\reference-video.mp4`（SHA-256 與原檔相同，原檔未動） |
| 抽幀 | 每 2.5 秒 1 張，共 55 張：`D:\FDE-AI-Build-Lab-Reference\frames\`；拼圖 10 張：`...\sheets\`；放大裁切：`...\crops\` |
| 未碰 | 該資料夾其他檔案一律未讀、未搬（只用檔名比對找出影片） |

## 6. REA 安裝驗證：**BLOCKED（未安裝）**

| 檢查 | 結果 |
|---|---|
| 官方套件 | npm `rea-agents` 6.9.0，MIT，repository = `github.com/morluto/rea`（非 fork）✔ |
| 套件要求 Node | `^22.23.4 \|\| ^24.22.1 \|\| >=26.12.1` |
| 本機 Node | **v24.19.0（低於 24.22.1）✘** |
| 處置 | 依指示不自行升級系統 Node、不安裝、不執行 `npx rea-agents setup` |

要繼續需要你決定其一：(a) 你自行把 Node 升到 24.22.1 以上；(b) 我在 D 槽放一份「可攜版 Node 24.22.1+」只給 REA 用，不動系統 Node（需你批准）；(c) 本案不用 REA，以人工證據表取代（目前 EVIDENCE_TABLE.md 已用這方式完成）。
npm 快取目前在 C 槽（`C:\Users\admin\AppData\Local\npm-cache`），安裝前會改設到 D 槽。

## 7. 磁碟

C 槽可用 22 GB、D 槽 62 GB、E 槽 91 GB。本階段所有輸出都在 D 槽。

## 8. 本階段未做（依規定）

未安裝任何套件、未啟動任何服務或預覽、未改正式站、未碰學員資料、未 push／merge／deploy。
