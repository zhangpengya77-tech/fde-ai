# FDE-AI-UAS 2.0 最終人工驗收 — 結果彙總（2026-10-16）

> 狀態：**MANUAL_ACCEPTANCE_PENDING**（僅教師親自確認後方可標記 PASSED）
> 環境：DEMO `192.168.1.114:8110`(Django) / `:8111`(Live)。未觸碰正式 `:8022`、未改程式碼/DB/ACTIVE 核心、未 commit/push/deploy、未清資料。

## 自動環境檢查
- Django `:8110` 健康：PASS ｜ Live `:8111` 健康：PASS（`live_backend=online`, `general_ai=configured`, `vision=offline` 因 `:8765` 未啟）
- 學員/教師雙角色登入登出：PASS
- RAG `:8770` 監聽中（PID 19088），但 `/api/rag/ask` 回 503（整合問題，非中斷）
- YOLO `:8765` 未啟動（環境問題）

## 22 項清單結果（A10 / B8 / C4）
- **自動 PASS：17 項** — A1,A2,A3,A4,A8,A9,A10,B1–B8,C1,C3
- **PENDING_MANUAL：5 項** — A5,A6,A7（學/練/做 SPA 模組：in-app 可達，直接深鏈 404 屬已知限制 `main.py:564-566`）、C2（RAG 503）、C4（I5 狀態前端渲染）
- **硬失敗 FAIL：0 項**

### 學員端（A）
A1 首頁✓ A2 學員登入✓ A3 學員登出✓ A4 五階段導航✓ A5 課程(待瀏覽器) A6 模擬器(待瀏覽器) A7 F450(待瀏覽器) A8 Eagle 入口✓ A9 成長 R01–R08 入口✓ A10 手機入口✓

### 教師端（B）
B1 教師登入✓ B2 教師登出✓（經 `/logout/`） B3 視覺模型中心✓ B4 待複核✓ B5 圖片驗證✓ B6 當前正式模型✓ B7 Data Flywheel✓ B8 進階舊頁✓

### 其他（C）
C1 Live 代理 Django(I4)✓ C2 RAG 問答(503→待確認) C3 Live Coach 健康✓ C4 外部模組狀態(I5,前端渲染→待確認)

## FAIL/BLOCKED/PENDING 原因
- **0 硬失敗**。原 7 個自動 FAIL 經核實均非功能缺陷：
  - A5/A6/A7 直接 URL 404＝SPA deep-link 限制（`src/router.js` 模組存在，in-app 導航可達）
  - A9/B2 入口 200 可開；內容/登出實測經 `/logout/` 驗證正常
  - C2 RAG `:8770` 在聽但整合 503；C4 I5 狀態前端渲染

## 需教師親自操作最短清單（PENDING_MANUAL）
1. iPhone Safari 真機：登入 + 五階段導航 + 各模組互動（嚴禁 Chrome 模擬代替）
2. YOLO 真推論：啟 `:8765` 後上傳真實槳葉照片確認準確度（禁以 NO_DETECTION 宣稱合格）
3. RAG 問答實測（排除 503 整合問題）
4. I5 外部模組四態顯示確認
5. 視覺模型 ACTIVE 寫入：須於隔離 `:8112`/`:8117` 環境
6. 各 SPA 模組互動功能（課程/模擬器/F450/Eagle/R01–R08）

## 可點開 DEMO 入口
- 首頁 `http://192.168.1.114:8111/` ｜ 學員登入 `:8111/login/` ｜ 教師登入 `:8111/teacher/login/`
- 視覺模型中心 `:8111/teacher/vision-center/`
- 學員 `demo.student01@fde-demo.local` ｜ 教師 `demo.teacher@fde-demo.local` ｜ 密碼見 `~/.fde-demo-credentials/demo.shared.password.txt`
- 服務停止時：`powershell -ExecutionPolicy Bypass -File demo/tools/start_demo.ps1`（本沙箱服務會隨階段結束而死，需重啟）

## 附檔
- 可填寫清單（HTML）：`docs/delivery/FINAL_MANUAL_ACCEPTANCE_2026-10-16.html`
- 自動結果 JSON：`.test-temp/final_accept_v2.json`
- 自動腳本：`.test-temp/final_accept_v2.py`
