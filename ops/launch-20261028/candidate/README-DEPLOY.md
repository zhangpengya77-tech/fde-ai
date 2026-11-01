# 發布候選說明（`candidate/v2/` → 線上 `fde-ai/v2/`）

## 這是什麼

`candidate/v2/` 是公開站 `/fde-ai/v2/` 的**發布候選**，不是正式內容。
正式內容仍以 `D:\FDE-AI-UAS-v2.0\public-site\` 為準，本輪未修改該目錄。

## 檔案清單（共 10 個，發布時必須完整覆蓋）

```
.nojekyll
README.md
assets/app.js
assets/config.js
assets/course-data.js
assets/favicon.svg
assets/style.css
courses/index.html
index.html
m02/index.html
```

線上目前缺 `m02/index.html` 與 `assets/favicon.svg`（首頁有兩個 404 死鏈），發布時必須一併補上。

## 發布方式

只覆蓋 `gh-pages` 分支的 `fde-ai/v2/` 目錄，**不要動 `fde-ai/` 根目錄（舊版首頁）**。

回滾：`../baseline/gh-pages-v2/` 即發布前快照。

## 發布前必須確認

1. **Worker `/gateway-status` 已加 CORS**（`patches/worker-gateway-status-cors.mjs`）。
   未加時本站會顯示「教學系統狀態無法確認」——這是**正確且刻意的降級**，不是 bug；但也意味著學生看不到「可用」。
2. **後端已提供含 `vision` 欄位的匿名端點**（`patches/django-public-health-endpoint.py`），並把網址填入 `config.js` 的 `visionStatusUrl`。
   未提供時「YOLO 視覺服務」永遠顯示「無法確認」，**不得為了好看而改成「可用」**。
3. **正式 Django 已以 `DEBUG=False` 執行**（見交付報告 P0-1）。目前 `DEBUG=True` 會讓任何 404 頁洩漏全部路由與內部源站網址。

## 三態語義（不可隨意簡化）

| 顯示 | 成立條件 |
|---|---|
| 靜態網站：可用 | 本頁已渲染完成（不依賴後端） |
| 登入服務：可用 | 狀態端點明確回 `classroom_server=true` 或 `login=true` |
| 登入服務：目前不可用 | 端點明確回 `false`，或端點完全不可達 |
| 登入服務：無法確認 | 端點可達但讀不到內容（如缺 CORS） |
| YOLO 視覺服務：可用 | 端點明確回 `vision.available=true` |
| YOLO 視覺服務：無法確認 | 未設定端點，或讀不到 |

任何一項在**缺少證據**時都只能顯示「無法確認」。這是硬規則。

## 驗證

```bash
cd ops/launch-20261028
node tools/verify_candidate_states.mjs
```

期望 `total 6 / passed 6`，並確認每個情境的 `courses.count` 為 12。
