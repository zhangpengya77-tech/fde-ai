# FDE-AI 2.0 上線收尾報告（唯讀盤點）

- **日期**：2026-10-28
- **範圍**：靜態網站部署現況 + YOLO 學員—教師—模型啟用閉環
- **本輪性質**：**純唯讀調查**（未改任何前端/後端/部署檔，未 push、未發布、未改 Worker/Tunnel/排程/DB、未切 ACTIVE）
- **倉庫**：`D:\FDE-AI-UAS-v2.0`（branch `feat/m02-simulator-entry`，HEAD `06481159f5ca638621c821e4fe9105b0837577f8`，18 個未提交修改 + 未追蹤 `.github/`）
- **並行寫入**：v2.0 倉庫近 60 分鐘**無**檔案變動；無活動並行寫入者。

---

## 1. 正式網站目前是否可開啟

**可以開啟，但「教學系統」永遠顯示離線。**

| 網址 | 狀態 | 內容 |
|---|---|---|
| `https://zhangpengya77-tech.github.io/fde-ai/` | ✅ 200 | **舊版 v1.5B 落地頁**（"System Boot · AI Vehicle Lab"），連到 `…/student/`（另一路徑） |
| `https://zhangpengya77-tech.github.io/fde-ai/v2/` | ✅ 200 | **v2 公開站**：標題「無人載具 AI 實訓學習平台」、12 項課程入口 |
| `…/fde-ai/v2/courses/` | ✅ 200 | 公開課程 |
| `https://fde-ai-gateway.fde-ai-gateway.workers.dev/` | ✅ 200 | Cloudflare Worker（動態入口） |
| `…workers.dev/login/` | ✅ 200 | 學員登入（經 Worker → Django 8022） |
| `…workers.dev/teacher/login/` | ✅ 200 | 教師登入 |

**但 `/v2/` 頁面顯示**：「FDE-AI 教學系統目前離線 / 學員登入、作業上傳及 AI 功能暫時無法使用」。

**根因（已定位到一行）**：`public-site/assets/config.js`
```js
portalBaseUrl: "",      // 空
portalStatusUrl: ""     // 空
```
`public-site/assets/app.js` 第 43 行：`if (!portalBase || !statusUrl) return renderStatus(false);`
→ **無論後端死活，公開站永遠顯示離線、且不提供登入連結**。這是設定缺口，不是後端故障。

## 2. GitHub Pages 實際部署版本

- **實際發布來源＝`gh-pages` 分支**（非 Actions 工作流）。
  - `gh-pages` HEAD = `24b53ecfd0cff716bd901aa3a66ce76634e03fa9`，2026-10-25 09:21，「feat: publish v2 public static course site」。
  - `gh-pages` 根目錄：`.gitignore, 404.html, favicon.svg, index.html, ops, src, v2/`；`v2/` 內為 `.nojekyll, README.md, assets, courses, index.html`。
  - 線上 `/fde-ai/v2/assets/config.js` 與本地 `public-site/assets/config.js` **完全一致**（皆空）→ 線上就是這份。
- **工作流存在但不生效**：`.github/workflows/deploy-public-site.yml` 只在 push 到 `codex/github-pages-public` 時，把 `public-site/` 發布到 Pages **根目錄**（`/fde-ai/`），而線上 v2 站實際在 **`/v2/`**。二者路徑不一致，說明目前 Pages 走的是分支發布，工作流未被採用。

## 3. 學員與教師入口網址

- 公開站：`https://zhangpengya77-tech.github.io/fde-ai/v2/`
- 學員登入（動態）：`https://fde-ai-gateway.fde-ai-gateway.workers.dev/login/`
- 教師登入（動態）：`https://fde-ai-gateway.fde-ai-gateway.workers.dev/teacher/login/`
- 學員成長：`…workers.dev/student/growth/` → 302（需登入，路由存在）
- 教師後台：`…workers.dev/teacher/` → 302（需登入，路由存在）
- ⚠️ 公開站目前**不會**把上面兩個登入連結顯示出來（因 config 為空）。

## 4. YOLO 上傳／教師審核／ACTIVE／前端回測的實際狀態

| 環節 | 代碼是否存在 | 線上是否可用 | 實測 |
|---|---|---|---|
| 學員模型上傳 | ✅ v2.0 `student/courses/<id>/growth/R07/model/`（`growth_model_upload`） | ❌ | 未部署到 8022 |
| 學員影像/證據上傳 | ✅ 成長紀錄 evidence 路由 | ⚠️ 路由存在（302） | 需登入，未做寫入測試 |
| 教師視覺中心 | ✅ v2.0 `teacher/vision-center/`（urls.py:109） | ❌ **404** | 經 Worker 與直連 8022 均 404 |
| 單張驗證 | ✅ `teacher/vision-center/validate/` | ❌ | 同上 |
| 模型註冊/ACTIVE | ✅ Live API `/api/v1/vision/models`、`…/activate` | ❌ **404** | 經 Worker 回 Django 404；8030 未啟動 |
| 前端回測 | ✅ `vision-client.js`（VISION_API_BASE_URL=`127.0.0.1:8030`） | ❌ | 8030/8765 均未監聽 |

**結論：YOLO 閉環目前在正式環境完全不可用。**

## 5. 已完成 vs 仍缺失

**已完成（可對外）**
- 公開靜態站（12 課程、M02 頁）已發布且可開啟。
- Cloudflare Worker 存活，能把 `/login`、`/teacher`、`/student`、`/api` 轉發到 Django 8022。
- 學員/教師登入頁 200、受保護頁 302（驗證鏈可用）。
- 8022（Django）與 8770（RAG）在線。

**仍缺失（阻擋 YOLO 閉環）**
- Vision API（8030）**未啟動**；YOLO（8765）**未啟動**。
- 部署中的 8022 **沒有** v2.0 視覺路由（`/teacher/vision-center/` 404）→ 正式 8022 實為 v1.5C 系，YOLO 視覺中心只存在於 v2.0 DEMO 疊（8110/8111），而該疊目前**全數下線**。
- Worker 的 `/api` 只轉到 Django，**沒有**把 `/api/v1/vision/*` 轉到 Live 8030 的路由。
- 公開站 config 空 → 永遠離線、無入口連結。
- Pages 發布路徑（`/v2/`）與工作流（根目錄）不一致。

## 6. 阻擋上線的問題（P0 / P1 / P2）

**P0（不修就無法完成 YOLO 閉環）**
1. Vision API 8030 + YOLO 8765 未運行，且無常駐機制。
2. 正式 8022 無 v2.0 視覺路由（`/teacher/vision-center/` 404）；v2.0 視覺能力未部署到正式後端。
3. Worker 無 `/api/v1/vision/*` → 8030 的轉發規則（目前 `/api` 全進 Django，必然 404）。
4. 8022 週期性重啟（本次觀察 owner PID 由 26888 → **25420，建立於 18:07:01**），動態層不穩定。

**P1（影響可用性/體驗）**
5. 公開站 `config.js` 兩個 URL 為空 → 永遠顯示離線、無登入入口。
6. 後端完全依賴開發者電腦（見第 8 節），關機即不可用。

**P2（一致性/整理）**
7. Pages 實際由 `gh-pages` 分支發布，與 `.github/workflows/deploy-public-site.yml`（發布到根目錄）不一致。
8. 根路徑 `/fde-ai/` 仍是舊 v1.5B 落地頁，連到另一路徑 `…/student/`，與 v2 站並存易混淆。

## 7. 8022 問題是否影響目前部署

- **對靜態站：不影響**（Pages 獨立，開發機可關機）。
- **對動態層：影響穩定性**（PID 週期輪換），但目前登入/教師台仍可用（Worker 有 origin 健康檢查與離線頁）。
- **對 YOLO 閉環：不是唯一阻擋**——即使 8022 完全穩定，8030/8765 未啟動、vision 路由不存在、Worker 無 vision 轉發，閉環仍不可用。故 **8022 修復不應作為靜態站發布的前置條件**，但它是動態閉環的必要條件之一。

## 8. 靜態前端與動態後端的常駐能力

| 層 | 開發機關機後 | 說明 |
|---|---|---|
| 靜態前端（GitHub Pages） | ✅ 仍可用 | 由 GitHub 託管，永遠在線 |
| 動態後端（8022/8770/8030/8765） | ❌ 不可用 | 全部跑在開發者本機，經 Tunnel 對外；關機即斷 |
| Worker | ✅ 在線 | 但 origin 不可達時只回「教學主機未啟動」離線頁 |

**要達成完整常駐仍缺**：一台 7×24 主機（或雲端）跑 Django + Live API + YOLO，並有固定對外入口（Named Tunnel 或 Worker + 穩定 origin）。
**最小成本、最少改動方案**（尚未執行、需批准）：沿用現有 Worker，將 origin 指向一台常駐主機的 Named Tunnel；靜態站維持 GitHub Pages。不需改 DNS，不需買新服務即可先做到「有人在線時可用」。

## 9. 本輪修改檔案及測試結果

- **本輪未修改任何產品檔案**（純唯讀盤點）。僅新增本報告。
- **未執行**任何寫入型測試（依「先盤點」要求）。
- 觀測證據：HTTP 狀態碼（見第 1、3、4 節）、`gh-pages` 分支 HEAD、Worker 路由碼、Django `urls.py` 路由、服務埠監聽狀態。

## 10. 正式發布所需的最少操作（待批准）

1. `public-site/assets/config.js` 填入 `portalBaseUrl = https://fde-ai-gateway.fde-ai-gateway.workers.dev`、`portalStatusUrl` = 一個匿名健康端點（需先新增）。
2. 讓 Vision API（8030）+ YOLO（8765）常駐，並在 Worker 增加 `/api/v1/vision/*` → 8030 的轉發（或由 Django 反向代理）。
3. 把 v2.0 視覺路由部署到正式 Django（或讓正式站指向跑 v2.0 的實例）。
4. 將修正後的 `public-site/` 發布到 **`gh-pages` 的 `v2/`**（與現行發布路徑一致），或改為使用工作流並同步調整 Pages 來源。
5. 停用/修正造成 8022 週期重啟的來源（需先根因確認）。

## 11. 發布後教師人工驗收步驟

1. 開 `…/v2/`，確認狀態顯示「在線」且「學員登入/教師登入」可按。
2. 教師以 `/teacher/login/` 登入 → 進 `/teacher/vision-center/`。
3. 學員登入 → 進 R07 視覺任務 → 上傳允許的證據/模型 → 確認狀態與紀錄。
4. 教師對提交執行單張驗證 → 檢視信心分數 → 人工覆核。
5. 依既有 ACTIVE 規則決定是否啟用（**切 ACTIVE 需另行授權**）。
6. 學員端用已啟用模型回測 → 確認結果來自真實推論、版本一致。
7. 抽查越權：匿名上傳、異班教師、學員自行設 ACTIVE 均應被拒。

## 12. 回滾計畫

- 靜態：`git revert` 對應 `gh-pages` 提交，或把 `v2/` 還原到 `24b53ecf`。
- 配置：`config.js` 還原為空（回到「安全離線」）。
- 動態：Worker 版本回滾（`wrangler rollback`），origin 指回原值。
- 服務：恢復原啟動方式；**不刪除**任何既有狀態檔/模型。
- 全程不動正式 DB 與 ACTIVE 指標。

## 13. 需要教師明確批准的操作

1. push `gh-pages`（或 `codex/github-pages-public`）以發布前端修正。
2. 部署/更新 Cloudflare Worker 路由。
3. 啟動 Vision API / YOLO / v2.0 Django 常駐服務。
4. 修改排程或啟動器（含 8022 週期重啟根因處置）。
5. 任何正式 ACTIVE 模型切換。
6. 修改正式 Tunnel/DNS（本輪未做、也不建議未經批准進行）。

---

## 最終裁決

| 狀態 | 判定 | 說明 |
|---|---|---|
| **STATIC READY** | ✅ **（候選）** | 靜態站已上線且可開；僅差 `config.js` 一行設定即可顯示「在線」與登入入口 |
| **API READY** | ⚠️ **部分** | 登入/教師台/成長路由經 Worker 可用；**視覺 API 不可用**（8030 未啟動、Worker 無 vision 轉發） |
| **YOLO READY** | ❌ **否** | Vision API/YOLO 未啟動、正式 8022 無視覺路由、ACTIVE 端點 404 |
| **BLOCKED** | ⛔ **是（就 YOLO 閉環）** | P0-1～P0-4 |

**一句話**：靜態站可發布（補一行設定）；**YOLO 閉環目前 BLOCKED**，需先讓 Vision API/YOLO 常駐、把視覺路由部署到正式後端、並在 Worker 開通 `/api/v1/vision/*` 轉發。本輪到此停止，等待批准後才進行任何發布或正式變更。
