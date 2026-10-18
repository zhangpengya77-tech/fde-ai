# P0 修復：iPhone DEMO 檢測「Load failed」— 根因與修復報告

日期：2026-10-11
專案：D:\FDE-AI-UAS-v2.0（分支 fde-ai-v2.0-dev）
範圍：/eagle 手機端槳葉檢測 DEMO 模擬推論

---

## 一、Load failed 根因

**唯一根因：Live Backend :8111 啟動時缺少環境變數 `FDE_DEMO_SIMULATED_INFERENCE=1`。**

完整因果鏈：

1. 上一輪修復後，8111 以**手動方式**重啟，只帶了 DB / Media / VisionCenter 等變數，
   **漏掉 `FDE_DEMO_SIMULATED_INFERENCE=1`**（該變數平常由 `demo_common.ps1` 的
   `Set-DemoEnvironment` 設定）。
2. → `main.py:110` 讀到空字串 → `VisionCenter(demo_simulation_enabled=False)`
3. → `demo_model_status("PROP_DIRECTION")` 回傳 `None`（實測 GET 回應
   `{"status":"MODEL_NOT_READY","simulation_mode":false}`）
4. → `prop_check` 改走正式路徑 `active_model()` / `infer_active()`
5. → 嘗試連真實 YOLO `:8765`（**未啟動**，實測未監聽）→ 請求**長時間阻塞**
   （實測 30 秒仍未回應）
6. → **Safari 在連線長時間無回應時拋 `TypeError: Load failed`**；
   Chrome 則會等到自身超時才報錯。
   **這正是「Chrome 驗收通過、iPhone 失敗」的差異來源。**
7. → 前端 catch 後走 `unavailableCard()` → 畫面顯示
   「目前尚無可用模型 / Load failed」

**非根因（已排除）**：
- DEMO 資料完好：`demo_active_submissions` 有 `PROP_DIRECTION`，
  對應 submission `sub-ea18f5eb-…` 狀態為 `DEMO_REVIEW_APPROVED`。
- Vision API base 解析正確（實測手機端為 `http://192.168.1.114:8111`）。
- 無「前端把 API 錯誤誤判為 MODEL_NOT_READY」的情況。

---

## 二、修復內容

| # | 檔案 | 變更 |
|---|---|---|
| 1 | 8111 啟動環境 | 補回 `FDE_DEMO_SIMULATED_INFERENCE=1`（並同步補 `DJANGO_VISION_DEMO_SIMULATION_ENABLED=1`、`FDE_DOWNLOAD_ROOT=D:\下載中心文件`），與 `Set-DemoEnvironment` 一致 |
| 2 | `src/vision-client.js` | `adaptPropResult` 傳遞後端 `simulation_mode` / `result_label` |
| 3 | `src/app.js` | 結果卡片新增「DEMO 模擬結果」標籤；新增 `missingFileCard()` 區分「未選照片」與「無可用模型」 |
| 4 | `src/styles.css` | 新增 `.demo-simulation-badge` 樣式 |
| 5 | `index.html` / `404.html` | 版本號更新為 `1.2.2-demo-label` / `1.0.3-demo-label`（強制 Safari 刷新快取） |
| 6 | `src/platform-integration.test.cjs` | 版本號斷言同步 |

**未修改**：正式 ACTIVE 模型、`:8765`、`:8770`、`:8022`、v1.5C、Cloudflare、
DEMO 帳密、R07 流程、教師後台、首頁。未 commit / push / merge / deploy。

---

## 三、API 實際結果

**GET `/api/v1/vision/prop-check`**
```json
{"status":"DEMO_REVIEW_APPROVED","simulation_mode":true,
 "result_label":"DEMO 模擬結果","model_id":"DEMO_R07_sub-ea18f5eb-…",
 "model_version":"R07-DEMO","student_id":"DEMO-STU-0001","group_id":"DEMO-A"}
```

**POST `/api/v1/vision/prop-check`（修復前 vs 後）**

| | 修復前 | 修復後 |
|---|---|---|
| 耗時 | **>30s 無回應** | **0.01s** |
| 結果 | Safari 拋 `Load failed` | HTTP **200** |

修復後回應摘要：`M4 → detected CW_F / expected CW_F / confidence 0.76 / PASS`，
其餘 M1–M3 為 `INSUFFICIENT_DATA`（DEMO 模擬僅產生單一偵測框，屬既有設計）。

---

## 四、驗收（Chrome CDP 真實瀏覽器，390×844）

| 驗收標準 | 結果 |
|---|---|
| DEMO 模擬推論成功 | **PASS** — `prop-check` HTTP 200，0.01s |
| 顯示圖片 | **PASS** — 上傳照片已顯示 |
| 顯示 BBOX / Class / Confidence | **PASS** — M4 `CW_F` / `76.0%` / DETECTED / EXPECTED / BLADE FACE |
| 顯示 AI 繁體中文回答 | **PASS** — `/api/rag/ask` HTTP 200 |
| **明確標示「DEMO 模擬結果」** | **PASS** — 置頂標籤「DEMO 模擬結果／非真實 YOLO 推論，僅供展示操作流程」 |
| Console 錯誤 | **0 筆** |

前端測試回歸：`platform-integration` / `rag-client` / `mobile-p0-entry` /
`homepage-portal-entry` / `fde-column` / `fde-videos` / `fde-column-view` **全數通過**。

驗收性質：**AUTOMATED PASS**
iPhone 真機：**PENDING**（需教師手機確認）
截圖：`.test-temp/eagle-e2e/eagle_demo_fixed.png`

---

## 五、手機驗收網址

**http://192.168.1.114:8111/eagle**

> 教師首次開啟若仍見舊畫面，請下拉重新整理（Safari 快取）；
> 版本號已由 `1.2.1` 更新為 `1.2.2-demo-label` 強制刷新。

---

## 六、防再犯建議

8111 **一律**透過 `demo/tools/start_demo.ps1` 啟動，或在手動啟動前執行
`Set-DemoEnvironment`。缺少 `FDE_DEMO_SIMULATED_INFERENCE=1` 時，
系統會退化為連線未啟動的真實 YOLO，導致請求長時間掛起——
在 Safari 上表現為難以診斷的 `Load failed`。
