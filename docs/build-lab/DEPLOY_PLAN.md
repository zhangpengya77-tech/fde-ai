# 組裝實訓室 R2.1｜部署方案（待批准，尚未執行）

日期：2026-11-19　來源分支：`feat/build-lab-r2`（worktree `D:\FDE-AI-build-lab`）

## 1. 現況核對（已做，只讀）

| 項目 | 結果 |
|---|---|
| 正式站資料夾 | `D:\FDE-AI-UAS-v2.0-integration`，HEAD `442b3cf`，工作區乾淨 |
| 開發分支 `feat/courses-zone` | `442b3cf`（與正式站相同） |
| `feat/build-lab-r2` | 以 `442b3cf` 為基底、往上 8 個提交 → **可直接快轉合併，不會有衝突** |
| 變更範圍 | 只有新增 `f450-twin/build-lab/`（網站會提供）、`tests/build-lab/`、`docs/build-lab/`（都不會被網站提供，已用正式 Live 後端驗證 404） |
| 路由 | `/f450-twin/` 底下的深層路徑已能經 Cloudflare Worker → Tunnel → Entry → Gateway → Live 取得（實測 `training/bus.js`、`vendor/three`、`models/*.glb` 皆 200）→ **不需要改 Live、Gateway、Worker 任何設定** |
| 重新啟動 | 不需要（純靜態檔，Live 直接讀資料夾） |
| 知識庫 | `/api/rag/ask` 已在 Worker 動態路徑清單內；正式站上 AI 講解會連到既有知識庫 |

## 2. 三個選項（請擇一）

| 選項 | 做什麼 | 改到網站其他檔案？ | 學員看得到嗎？ |
|---|---|---|---|
| **A（建議先做）部署、入口仍隱藏** | 只把新資料夾放上正式站 | 否 | 網站上沒有任何連結；只有知道網址的人（你、老師）能開，方便用真手機與 MX450 筆電實測 |
| B 部署並開啟入口 | A＋在首頁「F450 數位孿生」卡片加一個「組裝實訓室（新版）」按鈕，並把開關 `entryVisible` 改成 `true` | 是（只動 `index.html` 那張卡片一處） | 看得到，新舊版並列 |
| C 之後再做：隱藏舊版 | 把舊版入口改為隱藏（不刪檔，可回復） | 是 | 只看到新版 |

說明：選項 A 的網址雖然沒有公開連結，但不是密碼保護；內容只是教學頁、沒有任何資料或密鑰，頁面也標了 `noindex`（不讓搜尋引擎收錄）。

## 3. 部署步驟（你回「更新正式站」並指定選項後才執行）

1. 正式站資料夾確認工作區乾淨，建立回退標籤：`backup/pre-build-lab-20261119`。
2. `feat/courses-zone` 快轉合併 `feat/build-lab-r2`（維持原本「開發分支 → 正式站」的流程）。
3. 正式站 `git merge --ff-only feat/courses-zone`。
4. 選項 B 才做：另一個提交加入首頁按鈕與開關，同樣經開發分支快轉到正式站。
5. 不重啟任何服務、不推送 GitHub。

## 4. 部署後驗證（我會從固定網址做）

- `https://fde-ai-v2.fde-ai-gateway.workers.dev/f450-twin/build-lab/` 回 200，載入 `ui/app.js?v=p4-1`、`build-lab-flags.js` 顯示 R2.1-P5。
- `/f450-twin/build-lab/?model=fpv5-225` 回 200。
- `/f450-twin/`（舊版）仍回 200、內容不變。
- 首頁：選項 A 不得出現 `build-lab` 字樣；選項 B 只出現在數位孿生卡片。
- `/tests/build-lab/…`、`/docs/build-lab/…` 回 404。
- AI 講解：在正式站點一次，確認能拿到知識庫回答或正確退回內建說明。

## 5. 需要你在真機上驗收（PENDING_MANUAL）

1. 手機：手指從零件庫拖零件到 3D、抽屜開關、接線模式點焊盤。
2. MX450 筆電與中階手機：轉動畫面是否流暢（目標筆電 ≥45 fps、手機 ≥30 fps）。
3. 老師覆核：接線步驟、參數／Betaflight 設定、引腳、尺寸、計分規則（扣分與 80 分及格）。

## 6. 回滾方案

- 最快：正式站資料夾 `git reset --hard backup/pre-build-lab-20261119`（只回到部署前；因為這次只新增檔案，不影響其他功能）。若部署後又有其他更新，改用 `git revert` 撤回這幾個提交，保留其他更新。
- 只想先關閉入口（選項 B 之後）：把 `build-lab-flags.js` 的 `entryVisible` 改回 `false` 並移除首頁按鈕。
- 舊版數位孿生全程不動，隨時可用。
- 主機離線時：GitHub 備援頁沒有這個新資料夾（會顯示 V2 首頁），不影響其他頁面；需要的話之後再同步。

## 7. 不會做的事

不改 Live／Gateway／Worker／Django／學員資料庫；不重啟服務；不推送或合併到 GitHub；不刪除舊版；沒有你明確說「更新正式站」不執行任何步驟。
