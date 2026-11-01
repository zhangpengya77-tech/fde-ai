# FDE-AI-UAS 公開靜態站

此目錄是 GitHub Pages 的唯一發布內容（workflow 的 `path: public-site`，只上傳這個資料夾）。

## 內容邊界

- 只保存公開課程說明與教學頁面。
- 不保存帳號、密碼、Cookie、Token、模型檔（.pt）、學生資料、作業、後端設定或任何私鑰。
- 動態登入、上傳與教師審核仍由獨立教學後台處理；本目錄不含任何後端程式碼。

## 目錄結構

```
public-site/
├─ .nojekyll              # 關閉 Jekyll，避免底線開頭檔案被忽略
├─ index.html             # 首頁：公開課程入口 + 教學系統狀態
├─ 404.html               # （未提供）未知路徑交由 GitHub Pages 預設 404
├─ courses/index.html     # 12 項課程主題清單
├─ m02/index.html         # M02 模擬飛行訓練（公開教學說明，含 A–D 任務卡）
└─ assets/
   ├─ style.css           # 公開站樣式（與 m02 頁無關，m02 自帶樣式）
   ├─ config.js           # 教學後台 URL／匿名狀態端點（預設留空＝安全顯示離線）
   ├─ app.js              # 狀態檢查、入口連結、課程清單渲染
   └─ course-data.js      # M01–M12 課程名稱與一句說明
```

## 路徑策略（重要）

全站一律使用**相對路徑**，因此可部署在 `https://<user>.github.io/<repo>/` 子路徑下，不需改任何設定。

- 首頁 → `courses/`、`m02/`
- 子頁 → `../`、`../assets/...`
- 曾出現的絕對路徑 `/student/growth/` 已改為 `data-portal-link="student"` +
  `data-portal-fallback="../#system-status"`：教學後台未設定或離線時，按鈕回到首頁狀態區塊，
  不會出現 404 或假成功；設定 `portalBaseUrl` 後由 `app.js` 改寫為正式後台網址。

## 教學系統串接（目前刻意留空）

`assets/config.js`：

```js
window.FDE_PUBLIC_CONFIG = Object.freeze({
  portalBaseUrl: "",     // 例："https://<tunnel-domain>"，留空＝入口按鈕維持停用
  portalStatusUrl: ""    // 匿名狀態端點；留空＝直接顯示離線
});
```

- 兩者留空時：首頁顯示「FDE-AI 教學系統目前離線」，登入按鈕為 `disabled`（`pointer-events:none`），
  不發出任何網路請求。這是**誠實離線**設計，不是故障。
- `portalStatusUrl` 必須是允許匿名 `GET`（`credentials: "omit"`）且回傳 `{"status":"online"}` 的端點，
  且需開放 CORS 給 Pages 網域；逾時 3 秒即視為離線。

## 與 `m02-simulator/` 的關係（同步規則）

`public-site/m02/index.html` 是 `m02-simulator/index.html` 的**靜態託管副本**，內容主體相同，
差異固定為下列 5 處（共 19 行），不可再增加其他差異：

1. 加 `<link rel="icon" href="../assets/favicon.svg">`。
2. 加 `.btn.disabled` 樣式（離線時入口按鈕必須看得出停用，不得假裝可用）。
3. 頂部「前往學習紀錄」改為 `data-portal-link="student"` + `data-portal-fallback="../#system-status"`
   （原本寫死 `/student/growth/`，在 Pages 子路徑下會 404）。
4. 第五節「前往我的成長日誌」同上，並補一句「本頁為公開教學說明…」。
5. 尾端載入 `../assets/config.js`、`../assets/app.js`。

**改 M02 內容時的同步流程**：先改 `m02-simulator/index.html`（教學系統內用），再重跑上面 5 處改寫，
最後用 `diff` 確認只剩這 5 處：

```
diff -u m02-simulator/index.html public-site/m02/index.html
```

## 部署方式

`.github/workflows/deploy-public-site.yml`：

- 觸發：推送到 `codex/github-pages-public` 分支且變更 `public-site/**` 或該 workflow 檔，或手動 `workflow_dispatch`。
- 流程：`actions/checkout@v4` → `configure-pages@v5` → `upload-pages-artifact@v3`（`path: public-site`）→ `deploy-pages@v4`。
- 一次性前置（由教師在 GitHub 網頁操作）：Repository → Settings → Pages → Source 選 **GitHub Actions**。

## 本機預覽

直接以 HTTP 伺服器開啟本目錄（不要用 `file://`，相對路徑與 fetch 行為會不同）：

```
python -m http.server 8099 --directory public-site
```

預期：首頁顯示離線狀態、`courses/` 顯示 12 筆、`m02/` 完整顯示且兩個「前往學習紀錄」按鈕為停用狀態。
