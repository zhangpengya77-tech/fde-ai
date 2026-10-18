# 教師人工驗收問題回報（FFmpeg 修復／Git 盤點／Flight Health／UI 整合）

- 日期：2026-10-14（晚間）
- 專案：`D:\FDE-AI-UAS-v2.0`（分支 `fde-ai-v2.0-dev`，HEAD `e5c0442` 未動）
- 範圍聲明：本輪不再產出交接文件；專注教師人工驗收發現的三項問題修復與兩項唯讀盤點
- 安全底線：不部署、不 commit、不改正式庫（8022/8770 未碰）、不刪除學員資料、不重啟正式服務、不使用 git clean/reset/checkout

---

## 一、Git 差異原因（唯讀盤點結論）

教師疑問：上次交接記錄為「44 修改／314 未追蹤」，本輪接手時看到「43 修改／146 未追蹤」。

### 1.1 本次實測（唯讀）

| 項目 | 結果 |
|---|---|
| 工作目錄 | `D:/FDE-AI-UAS-v2.0`（未切換，`git rev-parse --show-toplevel` 確認） |
| 分支 | `fde-ai-v2.0-dev`（未變） |
| HEAD | `e5c0442`（2026-10-03 歷史基準，未動） |
| 修改（M） | **44**（教師板 43） |
| 未追蹤（??） | **147**（教師板 146） |
| 刪除（D） | **0** |
| stash | 1（`On fde-ai-v1.5`，未動） |
| 8 個 worktree | 註冊清單與既有記錄一致 |

與教師數字各差 1：屬查看時點差異（教師查看與本次實測之間，工作區有一個檔案的增減），不影響結論。

### 1.2 差異主因：.gitignore 純新增規則（19 行、0 刪除）

`.gitignore` 本身在 44 個修改項中，diff 內容為**純新增忽略規則**，分兩組：

1. DEMO 測試憑證（明文密碼）——安全強化；
2. DEMO 執行期產物精確規則（前幾輪 P6 盤點成果）：
   - 新增忽略：`demo/runtime/db/`、`demo/runtime/media/`、`demo/runtime/state/`、`demo/runtime/tmp/`、`demo/runtime/downloads/`、`demo/runtime/vision-center/`、`demo/runtime/chrome-vision-test/`、`demo/runtime/logs/`、`demo/screenshots/`、`demo/backup/`、`demo/runtime/*.txt|*.json`、`demo/tools/__pycache__/`、`.fde-demo-credentials/`；
   - **明確保留追蹤**：`demo/tools/**`（驗收腳本）、`demo/*.md`、`demo/*.cmd`、`demo/runtime/seed_demo_downloads.py`。

效果量化：`demo/runtime/` 實際有 **958 個檔案**（含 media 90 個），此前多數逐條列為未追蹤；現在以目錄級忽略一次性收斂——未追蹤從 314 降到 147 由此解釋。

### 1.3 無檔案遺失的佐證

- 0 deleted；被「消失」的 167 項全部是 `demo/runtime/` 執行期產物與憑證，磁碟上 958 個檔案仍在（`find demo/runtime -type f` 實測）；
- `.gitignore` 修改是新增而非擴大既有誤傷（`demo/tools`、`demo/*.md`、`demo/*.cmd` 仍出現於未追蹤清單，證明驗收資產未被排除）；
- 工作目錄、worktree、stash、HEAD 皆未變；未使用任何 git 覆蓋指令。

### 1.4 交接文件完整性確認（10/10 存在）

`docs/handoff/` 十份文件全部在位（建立時間 2026-10-14 05:37–06:08）：
`SYSTEM_ARCHITECTURE.md`、`DEVELOPMENT_ENVIRONMENT.md`、`GIT_WORKTREE_INVENTORY.md`、`PROTECTED_MODULES.md`、`NEXT_DEVELOPMENT_BACKLOG.md`、`HANDOFF_ACCEPTANCE.md`、`MODULE_STATUS_MATRIX.md`、`TEST_BASELINE.md`、`CODEX_HANDOFF_MASTER.md`、`CODEX_FIRST_RUN_CHECKLIST.md`。

---

## 二、P1：R01／R02 影片功能 PASS／FAIL（FFmpeg 獨立環境修復）

### 2.1 修復內容（教師先前核准範圍內，未重新開發上傳模組）

1. **安裝獨立 FFmpeg 9.0.2**（gyan.dev official static build）至 `D:\FDE-AI-UAS-v2.0\tools\ffmpeg\bin\`（`ffmpeg.exe` 105MB＋`ffprobe.exe` 105MB，sha 由官方源校驗，傳輸斷點續傳完整性 ZIP_OK）；**未動系統 PATH、未動 winget 殘留**；
2. **配置注入**：`demo/tools/demo_common.ps1` 的 `Set-DemoEnvironment` 新增 3 行（含防呆：二進位不存在則不設定，行為與修復前一致，不偽裝成功）；
3. **重啟 DEMO 8110/8111**（教師標準腳本 start_demo.ps1 / stop_demo.ps1，5 個展示頁面全 200）；正式 8022／8770 全程未碰。

### 2.2 驗證結果（三層）

| 驗證層 | 結果 |
|---|---|
| Django 單元測試 `learning.tests.test_growth_video` | **22/22 PASS、0 skip、38.4s**（修復前 100% skip；含轉碼/截斷/720p 縮放/旋轉中繼資料/損毀影片防禦等） |
| 隔離 E2E（副本 DB+隔離 media，127.0.0.1:8131） | **40/40 PASS**：R01 13 項＋R02 13 項完整鏈（影片草稿→重整仍在→提交教師→教師審核 approved→學員端已完成＋評語可見），mp4 實體落盤（`evidence/<uuid>/<hex>.mp4`） |
| R03–R06、R08 共用上傳機制回歸 | **PASS**：各 GET 200＋照片草稿→in_progress＋image evidence 建立 |
| R07 保護 | **PASS**：既有 submitted 模型提交鏈未被改動 |
| 線上 DEMO 唯讀檢查（教師視角） | **9/9 ALL PASS**：學員登入後 GET R01–R08 全 200、無「目前無法處理影片」提示 |

### 2.3 教師資料完整性

- 原始 DEMO 庫學員/教師/證據/審核結構複驗：R01 submitted＋2 張照片（教師 18:47 測試提交）、R07 submitted＋1 model evidence、其餘未開始、審核空——與教師離開時狀態一致；
- 唯一變化是 sha256（cbc27708→dbea9c70）：來源為登入產生的 session/last_login 寫入（教師重測登入同樣會發生），非資料破壞。

### 2.4 結論

- **R01 影片功能：PASS**（真實 ffmpeg 9.0.2 環境）
- **R02 影片功能：PASS**（同樣 E2E 全鏈通過）
- 請教師以相同帳號重新測試：`http://192.168.1.114:8111/student/courses/1/growth/R01/` 與 `.../R02/`（保存草稿→重整仍在→提交教師→教師審核→學員端已完成）。教師現有已提交資料保留原樣，不會被覆寫。

---

## 三、P2：Flight Health 真實診斷可用狀態

### 3.1 實測（區網教師視角）

| 檢查點 | 結果 |
|---|---|
| DEMO 前端頁面（8111 掛載） | `http://192.168.1.114:8111/flight-health/` → **200** |
| 後端健康檢查 | `http://192.168.1.114:8040/api/v1/health` → **200** `{"status":"ok","service":"FDE Flight Health AI","version":"0.1.0","ardupilot_parser":true}` |
| CORS 預檢（Origin: 192.168.1.114:8111） | **200**，`access-control-allow-origin` 精確回顯（無萬用字元） |
| 前端 API 位址推導 | hostname=192.168.1.114（RFC1918）→ `http://192.168.1.114:8040/api/v1`，與實測一致 |

**結論：全鏈路當前健康，真實診斷可用。**

### 3.2 教師見到「診斷主機離線」的原因

- 前端離線橫幅觸發條件：`fetch(apiBase+'/health')` 失敗或 2 秒逾時（`flight-health/js/app.js` 的 `checkServiceConnection`）；
- 根本原因在**服務可用性而非程式**：8040 由 `start_fde_mobile_preview.bat` 以 `cmd /k` 開視窗手動啟動（獨立專案 `D:\FDE-Flight-Health-AI`），**視窗關閉或未執行批次檔時服務即離線**；
- 佐證：本輪調查中 8040 的 PID 由 31080 變為 30216（經歷過重啟窗口），教師測試時服務大概率不在線；CORS、連線、解析器（ardupilot_parser:true）本輪全部實測正常。

### 3.3 已核准範圍內的處理

- 本輪僅做唯讀連線確認，未上傳任何測試日誌到 8040、未改動其任何檔案（`D:\FDE-Flight-Health-AI` 屬禁止修改清單）；
- 若教師再遇離線橫幅，優先點頁面內的「重新檢測服務」；仍失敗即顯示「主機未啟動」，請執行 `start_fde_mobile_preview.bat`（現在的 8040 已在線，可立即重測）。

---

## 四、P3：五階段工作台與舊版導航重複——盤點與最小整合方案

### 4.1 盤點結果（唯讀，未動任何程式）

頁面清單：

| 頁面 | 路由 | 功能內容 | 入口 |
|---|---|---|---|
| 學員總覽 | `/student/` | 課程卡片三鈕：五階段學習工作台／AI 目標檢測／我的學習成長日誌(primary) | 登入後首頁 |
| 舊版課程主頁 | `/student/courses/<id>/` | 專案方向選擇＋任務/階段進度＋「打開我的學習成長日誌」按鈕 | 總覽 primary 鈕 |
| 成長日誌列表 | `/student/courses/<id>/growth/` | R01–R08 列表（狀態/圖片數）→ 各明細 | 舊主頁按鈕、identity nav |
| 五階段學習工作台 | `/student/courses/<id>/learning-path/` | 五階段分組＋R01–R08（狀態/教師評語/分數）＋任務進度＋外部模組 | 總覽按鈕 |

重複事實：①總覽同時亮出「五階段學習工作台」與「我的學習成長日誌」兩個主按鈕；②兩條路徑最終都到達同一批 R01–R08 明細與進度資訊；③身份導航另有「我的學習成長日誌」連結。教師看到的「導航重複」即此。

資料關聯：四個頁面共用同一資料來源（`GrowthRecordSubmission`/`StudentTaskProgress`/`PhaseProgress`），無資料競爭，屬純導航層重複。

### 4.2 最小 UI 整合方案（建議方案 A，待核准）

不修改受保護核心（models/views/urls/審核規則/資料表全部不動），只調兩個模板的按鈕：

1. `student_dashboard.html`（總覽課程卡片）：課程卡片只保留「五階段學習工作台」（primary）＋「AI 目標檢測」；**移除並列的「我的學習成長日誌」按鈕**（舊路徑保留可直達，不破壞既有書籤）；
2. `platform_identity_nav.html`：浮動導航「我的學習成長日誌」改指向五階段工作台（或維持指向日誌列表，二選一，確保同一概念只留一處）；
3. 五階段工作台與舊版課程主頁**不改**（工作台已有「我的學習成長日誌（R01–R08）」連結；舊深連結全部保留相容）。

效果：學員單一主入口＝五階段學習工作台，舊版日誌降級為「完整日誌視圖」，功能零遺失、零重新開發、修改量約 2 個檔案各 1–2 行。

### 4.3 備案（方案 B，不建議）

合併 growth_dashboard 與 learning_path 為一頁：涉及模板重構，違反最小修改原則，且手機排版需重新驗收，本輪不建議。

---

## 五、仍需教師核准事項

1. **P3 導航整合施工**（方案 A，2 個模板按鈕調整）：核准後即執行，30 分鐘內可完成並附驗證截圖；
2. **Flight Health 穩定性強化**（選配）：把 8040 健康檢查納入 `demo/tools/check_demo.ps1`（只檢查不啟動，1 行級改動）或啟動納入 start_demo.ps1（會啟動正式 Flight Health 服務，需明確核准）；
3. **R01/R02 教師端重測**：以 `demo.student01@fde-demo.local` 於 R01/R02 各上傳一支 40 秒影片實測（修復預期：草稿→重整仍在→提交→教師審核→學員端已完成全鏈打通）；
4. **iPhone 真機複測**：修復後建議以 iPhone Safari 重測 R01 影片上傳（此前的 iPhone Safari `TypeError: Load failed` 屬連線逾時表癥，與 ffmpeg 缺失並存；Chromium 裝置模擬不計入）。

---

## 附：本輪產物清單（皆未 commit）

- `tools/ffmpeg/bin/ffmpeg.exe`、`tools/ffmpeg/bin/ffprobe.exe`（9.0.2 官方 static build）
- `demo/tools/demo_common.ps1`（+3 行 ffmpeg 注入，帶防呆）
- `docs/reports/TEACHER_ACCEPTANCE_REPLY_2026-10-14.md`（本文件）
- `.test-temp/ffmpeg-check/`（隔離副本 DB、回歸脚本、日誌；原始 DEMO 庫從未被寫入）
