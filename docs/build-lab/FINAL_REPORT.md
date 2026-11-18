# 組裝實訓室 R2.1｜P5 測試與預覽驗收報告（總交付）

日期：2026-11-19　分支：`feat/build-lab-r2`（worktree `D:\FDE-AI-build-lab`，基底 `442b3cf`）　版本：R2.1-P5
狀態標示：PASS／FAIL／BLOCKED／PENDING_MANUAL（人工驗收項目一律 PENDING_MANUAL，AI 不宣稱通過）

## 1. 各階段總覽

| 階段 | 內容 | 狀態 | 報告 |
|---|---|---|---|
| P0 | 只讀審計、影片版面規格、證據表、授權、尺寸來源 | PASS（REA：BLOCKED） | AUDIT.md 等 7 份 |
| P1 | 組裝引擎：3D、零件庫、步驟、爆炸／拆解、吸附校驗、撤銷、儲存 | PASS | P1_REPORT.md |
| P2 | F450＋Pixhawk 2.4.8：21 步接線、規則、8 錯誤案例、ArduPilot 參數模擬報告 | PASS（內容 PENDING_MANUAL） | P2_REPORT.md |
| P3 | 5 吋 FPV（Betaflight 編號）：12 步接線、8 錯誤案例、Betaflight 檢查報告、機型切換 | PASS（內容 PENDING_MANUAL） | P3_REPORT.md |
| P4 | 教學卡、AI 講解、考試計分、本機紀錄與匯出 | PASS（計分規則 PENDING_MANUAL） | P4_REPORT.md |
| P5 | 測試、手機、授權、安全回歸、預覽 | 見下表 | 本文件 |

## 2. P5 驗收結果

| 驗收項目 | 狀態 | 證據 |
|---|---|---|
| 單元測試（引擎、規則、計分、紀錄、AI 提問、匯入安全） | PASS | `node --test tests/build-lab/*.test.mjs`（專案根目錄）：**42／42** |
| 接線規則測試（兩機型每步正確答案、所有錯誤代碼、整機檢查） | PASS | 同上 |
| 3D 互動測試（載入、縮圖、下一步、拖放錯／對、撤銷、爆炸、俯視、完成、重新整理恢復） | PASS | `tests/e2e/p1-assembly.cjs` |
| F450 完整組裝與接線、拆槳限制、錯誤案例、報告 | PASS | `p2-f450-wiring.mjs` |
| 5 吋完整組裝與接線、Betaflight 編號錯誤識別 | PASS | `p3-fpv5-wiring.mjs` |
| 考試流程、計分、紀錄、CSV 匯出、重新整理不重複記錄 | PASS | `p4-exam-records.mjs` |
| 手機（390 寬、觸控點選）：抽屜、點選、下一步、接線點選、無水平溢出 | PASS | `p5-mobile.mjs` |
| 一鍵執行全部瀏覽器測試 | PASS | `node tests/build-lab/e2e/run-e2e.mjs`：**5／5**，主控台 0 錯誤 |
| 兩機型可完整組裝與拆解 | PASS | p1～p3 |
| 錯誤接線能識別並解釋 | PASS | 16 個錯誤案例全由規則判定並附原因與正確做法 |
| 尺寸與引腳來源可追溯 | PASS（多數值為「待確認」） | 每個零件與步驟都有 `source`／`validationStatus`；DIMENSION_SOURCES.md |
| 進度可儲存與恢復 | PASS | 本機自動儲存＋匯出／載入 |
| 授權與素材檢查 | PASS | 無任何圖片、模型、字型、CDN 或第三方名稱；3D 全程式生成；three.js 為既有 MIT 檔 |
| 安全檢查 | PASS（已修正 1 項） | 見 §3 |
| 正式站與既有功能不受影響 | PASS | `git diff 442b3cf` 在 `f450-twin/build-lab/`、`docs/build-lab/` 以外**零變更**；舊版數位孿生後端測試 5／5；網站既有前端測試 13 通過、3 失敗與改動前相同（homepage-portal-entry、platform-integration、programs，版本號舊斷言） |
| Gateway 認證與 Cohort 隔離不退化 | PASS（未觸及） | 沒有改任何後端、Gateway、Worker、Django、資料庫檔案 |
| 實機觸控「拖放零件」 | PENDING_MANUAL | Playwright 無法模擬手指拖曳，需真機測 |
| 效能：MX450 筆電 ≥45 fps、中階手機 ≥30 fps | PENDING_MANUAL | 無頭瀏覽器用軟體繪圖，幀率不具代表性；需實機量 |
| 首次載入大小 | PASS | 新程式約 178 KB（28 檔）＋既有共用 three.js 約 758 KB，遠低於 4 MB 預算；無 GLB |
| 接線、參數、引腳、尺寸、計分規則內容 | PENDING_MANUAL | 須教師或有實機經驗者覆核 |
| REA 安裝 | BLOCKED | 本機 Node 24.19.0 低於要求 24.22.1；依指示未升級、未安裝 |

## 3. 安全檢查

- 對外連線只有一處：AI 講解呼叫網站既有 `/api/rag/ask`，只送零件／步驟／錯誤代碼，不含個資；失敗退回內建說明。其餘網址只是資料來源引用，不會被載入。
- 沒有 `eval`、`new Function`、外部腳本或 CDN。
- **已修正**：被竄改的「進度檔」原本可能把任意文字（例如 HTML）帶進完成畫面。現在載入時只保留已知零件、已知錯誤代碼與嚴重度並重組欄位；畫面輸出的紀錄與錯誤一律跳脫；匯入檔上限 2 MB。已加測試。
- CSV 匯出防試算表公式注入。
- 危險錯誤只在虛擬環境以文字說明，不對任何真實硬體供電；參數／設定報告不寫入飛控。
- 測試已移出公開資料夾（`tests/build-lab/`，網站不提供）；`f450-twin/build-lab/package.json` 只有一行說明與 type 設定，公開無妨。

## 4. 預覽網址

在 `D:\FDE-AI-build-lab` 執行 `python -m http.server 8095 --bind 127.0.0.1`，開：
- F450：`http://127.0.0.1:8095/f450-twin/build-lab/`
- 5 吋：`http://127.0.0.1:8095/f450-twin/build-lab/?model=fpv5-225`

（AI 講解在本機預覽會顯示「內建說明」，因為本機預覽沒有知識庫；部署到正式站後才會連到知識庫。）

## 5. 檔案清單（全部新增，未修改任何既有檔案）

```
docs/build-lab/        AUDIT、ARCHITECTURE、LAYOUT_SPEC、EVIDENCE_TABLE、FEATURE_MATRIX、ASSET_LICENSES、
                       DIMENSION_SOURCES、P1～P4_REPORT、FINAL_REPORT
f450-twin/build-lab/
  index.html  build-lab.css  build-lab-flags.js（入口開關 entryVisible:false）  package.json（測試用）
  core/   assembly-engine  scene  parts-gen  storage  wiring-rules  wiring-engine  error-cases  fpv5-error-cases
          params-report  betaflight-report  scoring  records  ai-explain
  data/   models（機型註冊表）  f450-pixhawk248  f450-wiring  fpv5-225  fpv5-wiring  scoring-rules
          boards/pixhawk-248-generic  boards/betaflight-f7-3030-generic
  ui/     app  wiring-view  layouts/f450-layout  layouts/fpv5-layout
  （測試已移到專案根目錄 tests/build-lab/：單元測試 4 檔＋e2e/run-e2e 與 p1～p5，不隨網站公開）
```

## 6. 授權清單

見 `ASSET_LICENSES.md`：three.js（MIT，既有）；open-fpv-sim（GPL-3.0，只參考概念）；ArduPilot wiki（CC BY-SA 3.0，只引用事實）；ArduPilot／Betaflight 原始碼（GPL-3.0，只讀說明核對參數與編號，不使用程式碼）；Betaflight 文件站與 lumipaddrones（授權不明，PENDING_MANUAL，只引用事實／流程）；參考影片工具（不取用任何內容）。

## 7. 回滾方案

- 目前：分支未合併、未部署，正式站完全不受影響；不需要回滾。
- 日後部署後若要撤回：
  1. 部署前先建 `backup/pre-build-lab-YYYYMMDD` 標籤；
  2. 只要刪除（或不部署）`f450-twin/build-lab/` 資料夾即完全移除；
  3. 網站入口由 `build-lab-flags.js` 的 `entryVisible` 控制，改回 `false` 即隱藏；
  4. 舊版數位孿生一直保留；若批准後「隱藏舊版」，也只改開關，不刪檔，可回復。

## 8. 未完成／需要你決定

1. 實際零件資料：F450 套件廠牌型號、Pixhawk 2.4.8 克隆版來源、5 吋實際機架與飛控堆疊、ArduPilot／Betaflight 韌體版本。
2. 教師覆核：接線、參數、引腳、計分規則（扣分與 80 分及格線）。
3. 實機驗收：手機觸控拖放、MX450 與中階手機幀率。
4. REA：選 (a) 你升級 Node、(b) D 槽可攜版 Node、或 (c) 不使用。
5. 下一關（需你批准）：是否部署到正式站、是否開啟新入口（`entryVisible`）、是否隱藏舊版（只隱藏不刪除）。
