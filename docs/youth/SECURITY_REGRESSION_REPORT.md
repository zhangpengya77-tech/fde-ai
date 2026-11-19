# 安全與回歸報告

## 正式系統保護
- 開發在獨立工作樹 `D:\FDE-AI-youth-lab`，分支 `feature/youth-drone-stem-lab`（基底 db01978）；**正式站資料夾 `D:\FDE-AI-UAS-v2.0-integration` 未改動**。
- 未改：登入、Session／CSRF、HMAC、Owner／Cohort 隔離、Django、Gateway、Worker、資料庫、HyperQGC、SITL、8262 Bridge。
- 既有檔案只改 3 個：`src/programs.js`（入口，功能開關預設關閉）、`src/programs.css`（1 行連結樣式）、`index.html`（programs.js 版本號）。
- 測試伺服器只用 8271–8273，只讀、測完即關。

## 個資與隔離
- 學員只填暱稱＋班級代碼（只允許中英數，長度限制）；不收姓名、電話、學號、Email。
- 紀錄存在學員自己的瀏覽器；同裝置不同學員各自獨立（單元測試 PASS）。
- 教師匯入報告：必須是已建立的班級，且只能匯入目前選擇的班級，跨班報告被拒絕（單元＋瀏覽器測試 PASS）。
- 助教不連外部 AI，學員輸入不送出任何伺服器。
- 頁面所有使用者輸入顯示前皆跳脫 HTML。
- **限制**：本機版教師區不是伺服器權限控管（同一台電腦的人都能看）。正式班級權限需接 FDE-AI 後端，待授權。

## 回歸測試（2026-11-20）
| 測試 | 結果 |
|---|---|
| 青少年核心單元測試 `node --test tests/youth/core.test.mjs` | 11／11 PASS |
| 青少年端到端 `node tests/youth/e2e.mjs` | 48／48 PASS（見 DEPLOYMENT 報告最新數字） |
| 入口功能開關 `node tests/youth/entry-flag.mjs` | 2／2 PASS（預設不顯示；?youth=1 才顯示） |
| 既有前端測試 `node --test src/*.test.cjs src/prop-live/*.test.cjs` | 129／132；**3 項失敗在未修改的正式版也一樣失敗**（改動前就存在） |
| 組裝實訓室 `node --test tests/build-lab/*.test.mjs` | 43／43 PASS |
| Django 後端測試 | 未執行（本次未改後端） |
