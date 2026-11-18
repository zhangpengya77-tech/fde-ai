# 組裝實訓室｜架構提案（ARCHITECTURE）— 待批准

## 1. 位置與入口（建議）

| 項目 | 提案 |
|---|---|
| 網址 | `/f450-twin/build-lab/`（沿用既有 `/f450-twin` 靜態掛載，**不改** Live 後端、Gateway、Worker） |
| 程式目錄 | `f450-twin/build-lab/`（獨立資料夾；不修改 `f450-twin/` 既有檔案） |
| 3D 函式庫 | 共用 `f450-twin/vendor/three`（r181，MIT），只讀引用 |
| 入口開關 | 新檔 `f450-twin/build-lab/build-lab-flags.js`：`{ entryVisible: false }`。預設關閉時，網站任何地方都不出現入口；你可直接開網址預覽 |
| 舊版 | 完全不動；你批准後，舊版「隱藏」也只改開關，不刪檔，可回復 |
| 分支 | `feat/build-lab-r2`（worktree `D:\FDE-AI-build-lab`） |
| 預覽 | 在 worktree 以 `python -m http.server 8095` 提供靜態檔（埠 8095 不在禁用清單） |

## 2. 技術選擇（需要你決定）

| 方案 | 說明 | 優點 | 缺點 |
|---|---|---|---|
| **A（建議）原生 ES Modules＋three.js r181** | 與現有數位孿生同一技術棧，無建置流程；用 JSDoc 型別註記＋ `node --test` | 不需 node_modules／打包、C 槽零負擔、與舊版共用 three、部署只是複製靜態檔 | 沒有 React 元件化 |
| B TypeScript＋React＋React Three Fiber＋drei | 指令中「新建模組」的建議棧（授權皆 MIT，已核對） | 元件化、型別安全 | 需 Vite 建置與 node_modules（放 D 槽）；會多一套 three（版本需與 r181 對齊）；部署多一步 build |

## 3. 模組劃分（方案 A）

```
f450-twin/build-lab/
  index.html               頁面骨架（頁首／零件庫／3D／操作列／抽屜）
  build-lab.css            自行設計樣式（沿用 V2.0 色票）
  build-lab-flags.js       入口開關
  core/
    scene.js               場景、相機、控制、視角預設、低階降級
    assembly-engine.js     步驟狀態機：安裝／拆下／爆炸／全部顯示、吸附與位置校驗（毫米）
    history.js             撤銷／重做（指令模式）
    storage.js             本機儲存／恢復／匯出（localStorage＋JSON 檔），不連資料庫
    wiring-engine.js       接線狀態、熱點、步驟進度
    wiring-rules.js        確定性規則校驗（極性、電壓、介面、ESC 順序、供電、PWM／SBUS／UART／GPS）
    parts-gen.js           程式生成簡單零件幾何（板、臂、柱、螺絲、電機外形）
  data/
    schema.md              零件與接線欄位定義
    f450-pixhawk248/       parts.json、steps.json、wiring.json、boards/（克隆版板卡配置）
    fpv5-225/              parts.json、steps.json、wiring.json、boards/
  ui/
    library.js steps.js toolbar.js wiring-view.js report.js mobile-drawer.js
  tests/                   node --test：規則、步驟、撤銷、儲存；Playwright：3D 互動
```

## 4. 資料模型

零件：`partId, nameZh, model, category, dimensionsMm, mountPoints[], ports[], pinout[], voltageRange, signalType, compatibleParts[], source{title,url,date,status}`
接線：`sourcePort, targetPort, sourcePin, targetPin, wireType, polarity, validationStatus（PASS|PENDING_MANUAL|待確認）`
所有尺寸／引腳在 `source` 標來源與日期，沒核對的 `status: "待確認"`。

## 5. 規則與 AI 分工

- PASS／NG／錯誤判定只由 `wiring-rules.js` 確定性產生（有單元測試）。
- AI 講解（P4）：只送「零件 id＋接線狀態＋錯誤碼」，不送學員個資；走現有 `/api/rag/ask` 或助教 API，失敗時顯示固定說明。

## 6. 不碰的東西

正式站、`student_portal` 模型／migrations／認證、Gateway、Worker、HyperQGC、8262 Bridge、SITL 埠、學員資料表、既有 `f450-twin/` 檔案、`training/records.js`。

## 7. 回滾

新功能全在 `f450-twin/build-lab/` 一個資料夾＋一個開關；刪除資料夾或關閉開關即回到現狀。部署前會建 `backup/pre-build-lab-*` 標籤。

## 8. 效能預算（草案）

| 項目 | 預算 |
|---|---|
| 單機型 GLB 合計 | ≤ 3 MB（Draco 壓縮）；程式生成零件優先 |
| 目標幀率 | MX450 筆電 ≥ 45 fps；中階手機 ≥ 30 fps |
| 降級模式 | 手機或 `?lite=1`：關陰影、關後處理、像素比 ≤ 1.5、簡化幾何 |
| 首次載入 | ≤ 4 MB（不含已快取的 three） |
