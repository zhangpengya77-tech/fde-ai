# FDE-AI-UAS 2.0 交付文件｜14 Flight Health AI 真實飛行日誌驗收流程

**文件版本**：v1.0（2026-10-14 Phase 6 產出）
**依據**：教師 Phase 6 指令第七節第 5 項
**性質**：**驗收流程文件；真實日誌分析屬教師實機操作，標 `PENDING_MANUAL`**

---

## 一、模組定位（唯讀盤點結論）

| 項目 | 現況 |
|---|---|
| 前端位置 | `D:\FDE-AI-UAS-v2.0\flight-health\`（`index.html` + `css/style.css` + `js/app.js` + `js/config.js`），**完全自包含、無外部 CDN 依賴** |
| 所屬系統 | **獨立於 Django／Live Backend**，不佔用 8022／8110／8111／8770 |
| 後端位置 | 教師診斷主機（FastAPI 風格，預設 `http://127.0.0.1:8040/api/v1`）——**不在本 repo 內**，由教師另行部署 |
| 正式環境入口 | `API_BASE_PROD` 目前為空字串 → 瀏覽器顯示「服務尚未配置」橫幅（屬**預期**，非缺陷） |
| 本輪是否修改 | **零修改**（Flight Health AI 屬絕對保護項目） |
| 本輪自動化 | `demo\tools\verify_flight_health_frontend.cjs` → **16 PASS / 0 FAIL**（唯讀靜態服務，不連線後端，不修改檔案） |

> 自動化已覆蓋：離線降級、DEMO 隔離、五階段流程可達性、學員視圖安全、390×844 無溢出、0 JS 錯誤。
> **未覆蓋（`PENDING_MANUAL`）：真實 `.BIN`/`.LOG` 日誌上傳與分析**（需教師主機 + 真實飛控日誌）。

---

## 二、後端 API 契約（教師主機必須實作，依前端實測行為歸納）

前端 `js/app.js::startAnalysis()` 依序呼叫：

| 步驟 | 方法與路徑 | 請求 | 回應 |
|---|---|---|---|
| 0 健康探針 | `GET {base}/health` | —（2 秒逾時） | 200 → 顯示「已連接」；非 200／逾時 → 「離線」橫幅 |
| 1 建立會話 | `POST {base}/flights` | `{"aircraft_name": "...", "training_task": "..."}` | `{"flight_id": "..."}` |
| 2 上傳日誌 | `POST {base}/flights/{flight_id}/log` | multipart `file`（`.BIN`/`.LOG`） | 200 |
| 3 觸發分析 | `POST {base}/flights/{flight_id}/analyze` | — | 200 |
| 4 學員結果 | `GET {base}/flights/{flight_id}/result` | — | `{"student_view": {...}, "ai_diagnosis": {...}}` |
| 5 教師結果 | `GET {base}/flights/{flight_id}/teacher-result` | Header `X-FDE-Teacher-Mode: DEV-LOCAL` | 完整原始遙測＋規則證據鏈（教師專用） |

### 2.1 學員視圖（`student_view`）必要結構

```json
{
  "overall_status": "normal | attention | inspect | stop",
  "display_status": "正常 | 注意 | 需要檢查 | 建議暫停飛行",
  "main_finding": "主要問題（白話）",
  "next_action": "下一步建議",
  "health_cards": [
    {"card_id": "propulsion|battery|positioning|stability",
     "title": "動力健康 | 電池健康 | 定位健康 | 飛行穩定性",
     "status": "NORMAL|NOTICE|ABNORMAL|INSUFFICIENT_DATA",
     "display_status": "...", "main_finding": "...", "next_action": "..."}
  ]
}
```

> **安全紅線（自動化已驗 A6）**：`/result` 回應與學員頁 DOM **不得出現** `RCOU`/`EKF`/`ATT`/`VIBE`/`PID`/`RCIN` 等原始工程欄位；這些只允許出現在 `/teacher-result`（經 `X-FDE-Teacher-Mode` 頭）與教師手動展開的抽屜中。

---

## 三、五階段驗收流程（逐段標示自動化／手動）

### 前置（教師實機操作，`PENDING_MANUAL`）

| # | 動作 | 預期 |
|---|---|---|
| F0-1 | 啟動教師診斷主機（預設 :8040），確認 `GET /health` 回 200 | 主機就緒 |
| F0-2 | 準備一份**真實 F450 飛控日誌**（`.BIN` 或 `.LOG`，ArduPilot 格式） | 檔案就緒 |
| F0-3 | 以 `http://127.0.0.1:<埠>/...` 或區網 IP 開啟 `flight-health/index.html` | 橫幅顯示「🟢 飛行健康 AI 服務已連接」 |

### 階段 ① 上傳飛控日誌

| # | 操作 | 預期 | 等級 |
|---|---|---|---|
| 1-1 | 確認機體名稱與訓練任務欄位 | 預設「F450-01 一號機 (Quad-X)」／「四面懸停訓練」 | `PENDING_MANUAL` |
| 1-2 | 拖曳或選擇真实日誌 | 顯示「已選擇日誌：xxx (x.xx MB)」，可接受 `.BIN/.LOG` | `PENDING_MANUAL` |
| 1-3 | 點「開始分析」 | 進入分析中狀態，依序完成 建立會話→上傳→分析→讀結果 | `PENDING_MANUAL` |
| 1-4 | 檢查「不偽造」規定 | 任一失敗→跳出**【分析失敗】**真實錯誤，**不得**以 DEMO 數據冒充 | 自動化已驗（程式碼層 `startAnalysis` catch 語意） |

### 階段 ② 飛行健康診斷

| # | 操作 | 預期 | 等級 |
|---|---|---|---|
| 2-1 | 整體狀態徽章 | 🟢正常／🟡注意／🟠需要檢查／🔴建議暫停飛行，與 `student_view.overall_status` 一致 | 自動化已驗（A4，DEMO 等格式結構） |
| 2-2 | 主要問題與下一步 | 白話文字，非工程術語 | 自動化已驗（A4b 四卡渲染） |
| 2-3 | 四大健康卡 | 動力／電池／定位／穩定逐卡呈現，`INSUFFICIENT_DATA` 顯示「未評估」 | 自動化已驗 |
| 2-4 | **學員視圖零原始欄位** | 頁面無 RCOU/EKF/VIBE/PID | 自動化已驗（A6） |
| 2-5 | 真實日誌數值合理性 | 卡內數值與日誌實際內容對應（如馬達命令極差） | `PENDING_MANUAL` |

### 階段 ③ 飛手實際飛行感受

| # | 操作 | 預期 | 等級 |
|---|---|---|---|
| 3-1 | 點選手感評價（poor~excellent） | 可選中儲存 | 自動化已驗（A7 流程可達） |
| 3-2 | 多選症狀晶片（左右漂／起飛容易翻…）與飛行階段 | 可多選切換 | 自動化已驗 |
| 3-3 | 填寫文字感受並提交 | 進入階段 ④ | 自動化已驗（A7） |
| 3-4 | 真實課堂情境符合度 | 症狀選項是否涵蓋該架次真實現象 | `PENDING_MANUAL` |

### 階段 ④ 日誌客觀數據＋飛手感受融合

| # | 操作 | 預期 | 等級 |
|---|---|---|---|
| 4-1 | 關聯四區塊 | ①日誌看到什麼 ②飛手感覺什麼 ③兩者是否一致 ④下一步建議 | 自動化已驗（A7b） |
| 4-2 | 八項最終飛行結論 | 發生什麼／大白話／日誌證據／飛手感受／綜合判斷／依序排查／禁止事項／下一次建議測試 | 自動化已驗（A7b，concl=565 字元） |
| 4-3 | **禁止事項欄** | 明確提示「暫時不要修改 PID／不自動寫入飛控」 | 自動化已驗（結論含 `doNot`） |
| 4-4 | 融合判定正確性 | 「aligned／not_confirmed」與真實日誌證據相符 | `PENDING_MANUAL` |

### 階段 ⑤ 帶班教師複核

| # | 操作 | 預期 | 等級 |
|---|---|---|---|
| 5-1 | 成長記錄卡 | 顯示機體、任務、日期、四大系統徽章、教師簽署與狀態 | 自動化已驗（A9） |
| 5-2 | 教師複核四態 | 待教師復核／教官已確認／教官提示注意／需重新測試 | 自動化已驗（A9） |
| 5-3 | 教師專業抽屜 | 預設關閉；手動點「教師模式」才展開，含 RCOU 原始表與 Rule Trace 證據鏈 | 自動化已驗（A8a/A8b） |
| 5-4 | 教師判定與後續 | 教官現場觀察、更換零件、複測並上傳新日誌比對 | `PENDING_MANUAL` |

---

## 四、降級與隔離規定（自動化已驗，教師驗收時不需回報）

| 規定 | 實測結果 |
|---|---|
| 離線**不自動**進入 DEMO（停在階段 ①） | A3 PASS |
| 只有使用者**主動點擊**「體驗 DEMO」才進入 | A4 PASS（進入後頂部顯示 DEMO 橫幅） |
| DEMO 數據與真實分析完全隔離（獨立 `DEMO_PAYLOAD`，不混用） | A5 PASS |
| 真實分析失敗顯示真實錯誤，**禁止**以 DEMO 冒充 | 程式碼層已驗（catch 分支） |
| 未配置正式 API 時顯示「服務尚未配置」 | `API_BASE_PROD` 為空時橫幅正確（A2 同族路徑） |
| 390×844 無水平溢出、0 JS 錯誤 | A10／A11 PASS |

---

## 五、教師主機接入清單（`PENDING_MANUAL`）

1. 實作第二部分 6 個端點（`/health`、`/flights`、`/{id}/log`、`/{id}/analyze`、`/{id}/result`、`/{id}/teacher-result`）。
2. 決定正式環境 API Base：完成 Cloudflare Tunnel 同域轉發後，將 `flight-health/js/config.js` 的 `API_BASE_PROD` 由空字串改為正式路徑（例：`/api/flight-health/v1`）——**此檔在保護區，修改須教師核准**。
3. 提供至少一份真實 `.BIN` 日誌供第一輪實機驗收。
4. 決定教師專用視圖的授權機制（目前以 `X-FDE-Teacher-Mode: DEV-LOCAL` 頭區分，正式環境需換成正式身分驗證）。
5. 回填本文件第三部分所有 `PENDING_MANUAL` 項目與結果。

---

**本文件所述自動化項目已 16/16 通過；真實飛行日誌分析全部 `PENDING_MANUAL`。**
**Flight Health AI 模組本輪零修改。**
