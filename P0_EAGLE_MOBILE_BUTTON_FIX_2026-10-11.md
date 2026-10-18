# P0 手機前端「執行槳葉檢測」按鈕無反應 — 修復報告

日期：2026-10-11
專案：D:\FDE-AI-UAS-v2.0（分支 fde-ai-v2.0-dev）
範圍：/eagle 手機前端 → 槳葉檢測結果顯示

---

## 1. 按鈕無反應根因

**根因（主因）：Live Backend :8111 沒有註冊 `/eagle` 路由。**

- 手機開啟 `http://192.168.1.114:8111/eagle` → **HTTP 404**。
- 前端為「路徑即區塊」路由（`src/router.js`：`{ key:'inspection', path:'eagle' }`），
  但 8111 只註冊了 `Route("/", homepage)`，沒有 `/eagle`，因此直接 404。
- 使用者「看得到按鈕」是因為 404 回應內含同名 `#propellerButton`／`#propellerInput`，
  但該入口的腳本清單**缺少 `src/vision-client.js`**（`index.html` 有、`404.html` 沒有），
  點擊後 `window.FdeVisionClient` 為 undefined，事件鏈無法完成 → 無結果。

**次要根因（修復主因後才浮現，逐項以實測定位）：**

| # | 問題 | 證據 | 修法 |
|---|---|---|---|
| B | 手機端 RAG(:8770) 只綁 127.0.0.1，`PUBLIC_RAG_API_URL` 為空 → AI 中文回答永遠失敗 | `rag-client.js::apiCandidates` 非 loopback 時只回 `[publicApi]` = 空 | 前端加同源回退 + 8111 新增 `/api/rag/ask` 透明代理 |
| C | 結果詳情印出 `M1: undefined` | `app.js:765` 讀 `item.errorCode`，但 `vision-client.js::adaptPropResult` 提供的是 `reason` | 改為 `item.reason || item.errorCode` |
| D | 預覽區永遠停在「等待 YOLO 檢測圖片」 | `adaptPropResult` 不返回圖片；`app.js` 未回填 `inputImage` | 點擊流程補 `result.inputImage = imageData` |
| E | 真實 iPhone Safari 會沿用舊 JS 快取 | `?v=` 版本號未更新；實測未更新時舊行為重現 | 更新 `index.html` / `404.html` 版本號 |

> 註：Codex 上一輪的「Vision API 改為同源」**已生效**，實測
> `visionApiBase()` 於手機端正確解析為 `http://192.168.1.114:8111`，非本次問題。

---

## 2. 修改的檔案

| 檔案 | 變更 |
|---|---|
| `live_backend/app/main.py` | 新增 `Route("/eagle", homepage)`；新增 `/api/rag/ask` 同源 RAG 透明代理（複用既有 `rag_client`，不新增推論邏輯） |
| `src/app.js` | `propellerFinalResult` / `inspectionAssistantContext` 改讀 `item.reason`；點擊成功後回填 `result.inputImage` |
| `src/rag-client.js` | `apiCandidates` 非 loopback 時加入 `sameOrigin` 後備（與 `vision-client.js` 一致） |
| `index.html` | `rag-client.js` / `vision-client.js` / `app.js` 版本號更新為 `1.2.1-mobile-rag-sameorigin` / `1.0.2-mobile-lan-fix` / `1.2.1-mobile-eagle-fix` |
| `404.html` | 補上缺失的 `vision-client.js`；同步版本號 |
| `src/platform-integration.test.cjs` | 版本號斷言同步 |
| `src/rag-client.test.cjs` | 版本無關斷言（原意為 `rag-client.js` 須先於 `app.js` 載入） |

未修改：v1.5C、正式 8022/8030/8765/8770、Cloudflare、DEMO 帳密、R07、教師 Vision Center、首頁。
無 Git commit / push / merge / deploy。

---

## 3. 驗收結果（真實瀏覽器 CDP 實測，iPhone 尺寸 390×844）

| 項目 | 結果 |
|---|---|
| 1. 圖片上傳 | **PASS** — `IMG_7788.jpeg` 37,061 bytes 注入成功 |
| 2. API 請求 | **PASS** — `POST /api/v1/vision/prop-check` → **HTTP 200** |
| 3. 檢測結果顯示 | **PASS** — `#propellerResult` 高度 1837px、可見、可捲動；M1–M4 完整 |
| 4. AI 中文回答 | **PASS** — `POST /api/rag/ask` → **HTTP 200**，回傳繁體中文修正建議 |
| 5. 無檔案明確提示 | **PASS** — 「請先上傳 F450 俯視照片…」 |
| 6. BBOX/Class/Confidence | **PASS** — DETECTED / EXPECTED / BLADE FACE / CONFIDENCE / FINAL RESULT 全數呈現 |
| 7. Console 錯誤 | **0 筆** |
| 8. iPhone 真機 | **PENDING** — 需教師以手機確認 |

驗收方式：Chrome DevTools Protocol 真實瀏覽器，注入真實 JPG 至 `#propellerInput`，
實際點擊 `#propellerButton`，捕獲網路請求與 DOM 輸出。
截圖：`.test-temp/eagle-e2e/eagle_result_mobile.png`

自動測試回歸：`src/*.test.cjs` 除 `download-center-entry.test.cjs`（既有失敗，非本輪引入）外全綠。

---

## 4. 已知問題

1. **`download-center-entry.test.cjs` 既有失敗**：`platform-browser.js` 的「下載中心」標題
   與測試期望字串不符。屬既有 EXTERNAL_DIRTY_STATE，本輪未處理。
2. **DEMO 為模擬推論**：`prop-check` 走 `simulate_prop_check`，結果標示為
   「AI 視覺評測 CHECK」，**未冒充真實 YOLO**。真實推論 `:8765` 本輪未開啟。
3. **iPhone 真機未驗收**：Safari 的 WebKit 行為與快取策略與 Chrome 不同，
   雖已強制更新 `?v=` 版本號，仍須教師手機實測確認。
4. 手機測試網址：**http://192.168.1.114:8111/eagle**

---

## 5. Git Status

工作樹保留全部既有未提交修改（未 reset / clean / stash / checkout 覆蓋）。
本輪新增修改檔案列於第 2 節，皆為未提交狀態。
