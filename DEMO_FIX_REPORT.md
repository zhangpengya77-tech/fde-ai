# FDE-AI-UAS 2.0 — 10/10 合作展示版 緊急修復報告（DEMO_FIX_REPORT）

> 分支：`fde-ai-v2.0-dev` ｜ 展示環境：`D:\FDE-AI-UAS-v2.0\demo\`
> 性質：**展示環境修復（demo-env-only），不開發新功能、不修改正式環境**
> 產出時間：2026-10-10 展示前

---

## 0. 執行摘要（Executive Summary）

針對 4 張真實瀏覽器截圖揭露的問題進行緊急修復，結果如下：

| 問題 | 狀態 | 說明 |
|------|------|------|
| ① 首頁 `/` | ✅ 正常 | HTTP 200，標題正確 |
| ② `/login/` 403 CSRF | ✅ **已修復** | 加入精確 CSRF 信任來源；真實 Chrome 學員/教師登入均 302 + 取得 session，不再 403 |
| ③ `/flight-health/` 教師診斷主機離線 | ⚠️ **預期內** | 診斷後端 8040 不在本隔離 DEMO 建置內；頁面正常載入並顯示離線橫幅，標記「暫時無法使用」 |
| ④ `/downloads/` 清單無法讀取 | ✅ **已修復** | 補齊 `demo/runtime/downloads` 目錄並塞入 2 個合法展示檔；`/api/downloads` 回傳 200 + 2 筆 |

**真實瀏覽器驗收：11/11 PASS（HTTP 層）＋ 9 張真實 Chrome 截圖（含學員/教師登入後儀表板）。**

### 最終判定
> ## ✅ READY FOR DEMO（展示環境已修復；Flight Health 標記為暫時無法使用，不影響核心雙師教學演示）

---

## 1. 服務與埠對應盤點（Phase 1）

| 埠 | 服務 | 本次狀態 | 說明 |
|----|------|----------|------|
| 8022 | 正式 Django Portal | 🔒 未觸碰 | 生產服務，PID 21360，持續運作 |
| 8770 | 正式 RAG | 🔒 未觸碰 | 生產服務，PID 14640，持續運作 |
| 8110 | **DEMO** Django Portal | 修復後啟動 | 隔離 DB/MEDIA，CSRF 白名單已加 |
| 8111 | **DEMO** Live Backend（反代 + 靜態） | 修復後啟動 | 反代到 8110，掛載 flight-health / downloads / live |
| 8040 | Flight Health 教師診斷主機 | 不在 DEMO 建置內 | 正式獨立服務，本輪**不啟動、不修改** |
| 8030 / 8765 | 生產 Live / YOLO | 未使用 | 與本次展示無關 |

- **Cloudflare Tunnel / Quick Tunnel**：DEMO 僅走 `127.0.0.1`，不使用任何 Tunnel。
- **代理轉送規則**（`live_backend/app/main.py:486-495` `django_portal_proxy`）：
  - 將 `Host` 寫死為 `127.0.0.1:8022`（生產埠，DEMO 沿用此值）。
  - 設定 `x-forwarded-host` = 瀏覽器原始 Host、`x-forwarded-proto` = 目前 scheme。
  - 瀏覽器對 `/login/` 發出的 `Origin` 為 `http://127.0.0.1:8111`。
- **Django CSRF 組態來源**（`student_portal/config/settings.py:31-48`）：
  - `ALLOWED_HOSTS` ← 環境變數 `DJANGO_ALLOWED_HOSTS`（未設則預設含 `127.0.0.1`）。
  - `CSRF_TRUSTED_ORIGINS` ← 環境變數 `DJANGO_CSRF_TRUSTED_ORIGINS`（未設且 DEBUG 時預設 `['https://*.trycloudflare.com']`）。

---

## 2. 登入 CSRF 修復（Phase 2）

### 根因
DEMO 啟動時未設定 `DJANGO_CSRF_TRUSTED_ORIGINS`，Django（DEBUG=true）預設只信任 `https://*.trycloudflare.com`。
瀏覽器經 Live 反代登入，`Origin = http://127.0.0.1:8111` 不在信任清單 → **403「Origin checking failed」**。

### 修復（精確、無萬用字元、未關閉 CSRF Middleware）
修改位置（**僅 DEMO 隔離設定**）：
- `demo/tools/demo_common.ps1` → `Set-DemoEnvironment`
- `demo/tools/demo_env.cmd`

新增兩個環境變數：
```
DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost,127.0.0.1:8022,127.0.0.1:8110,127.0.0.1:8111
DJANGO_CSRF_TRUSTED_ORIGINS=http://127.0.0.1:8110,http://127.0.0.1:8111
```
- `127.0.0.1:8022` 覆蓋反代寫死的 Host；`8110/8111` 覆蓋直連與反代瀏覽器 Origin。
- 僅列具體來源，**不使用 `*` 萬用字元**；CSRF Middleware 維持啟用。

### 驗收證明
- 真實 Chrome 經 `http://127.0.0.1:8111/login/` POST 登入（學員）→ **HTTP 302 + 核發 sessionid，非 403**。
- 真實 Chrome 經 `http://127.0.0.1:8111/teacher/login/` POST 登入（教師）→ **HTTP 302 + 核發 sessionid，非 403**。
- 截圖 `03-student-dashboard.png`、`05-teacher-dashboard.png` 顯示登入後儀表板（登入實際成功）。

---

## 3. Flight Health（Phase 3）

### 現況
- `/flight-health/` 為 Live Backend 的靜態掛載（`main.py:534`，指向 `flight-health/index.html`），**HTTP 200 正常載入**。
- 前端 `flight-health/js/config.js` 依瀏覽器 Host 決定 API Base；DEMO 走 loopback → 指向 `http://127.0.0.1:8040/api/v1`（教師診斷主機）。
- 該診斷主機（8040）**不在本隔離 DEMO 建置內**，故 Health Probe 失敗，頁面顯示「服務連線狀態：離線」橫幅。

### 重要發現（已澄清）
目前正式倉庫內的 `flight-health/index.html`（14375 bytes）**不含**「體驗 DEMO」切換按鈕（該按鈕僅存在於某個分支/版本的描述，磁碟實際檔案並無）。
因此：**本輪無法經由頁內「Demo Mode」展示預錄分析**，必須依指示誠實標記。

### 決策（符合約束）
- **不啟動、不修改**正式 Flight Health（含前端靜態檔）。
- 標記為 **「暫時無法使用 / 需連接教師診斷主機 (8040) 才會上線」**。
- 展示時由講者口頭說明：「飛行健康 AI 分析為獨立診斷子系統，本次展示環境未納入該診斷主機，故顯示離線；核心雙師教學流程不受影響。」

---

## 4. 下載中心（Phase 4）

### 根因
`/api/downloads` 讀取 `FDE_DOWNLOAD_ROOT`（DEMO = `demo/runtime/downloads`）。
該目錄**原本不存在** → `load_manifest` → `refresh_manifest` 拋 `FileNotFoundError` → API 500 → 頁面前端顯示「下載清單暫時無法讀取」。

### 修復（demo-env-only，未偽造連結）
- 建立 `demo/runtime/downloads/`。
- 以 `demo/runtime/seed_demo_downloads.py` 產生 2 個**真實、位元組合法、可下載**的展示檔：
  - `FDE-AI-UAS-學員快速上手.zip`（317 bytes，內含 README.txt）
  - `FDE-AI-UAS-課程軟體說明.pdf`（904 bytes，合法單頁 PDF）
- 均位於 DEMO 隔離目錄，不触碰正式 `D:\FDE-Downloads`。

### 驗收證明
- `GET /api/downloads` → **HTTP 200**，`{"downloads":[...]}` 含 **2 筆**（清單可讀，無錯誤）。
- 頁面 `05-downloads.png`（舊編號）/ `09-downloads.png` 顯示正常清單。

---

## 5. 真實瀏覽器驗收（Phase 5）A–J

> 驗收腳本：`demo/tools/verify_demo_fix.py`（HTTP 層，11 項全 PASS）
> 截圖腳本：`demo/tools/capture_demo_screenshots.py`（真實 Chrome CDP 登入）
> 報告 JSON：`demo/runtime/acceptance_fix.json` ｜ 截圖：`demo/screenshots/*.png`

| 項目 | 對應檢查 | 結果 | 截圖 |
|------|----------|------|------|
| A. 首頁 | `GET 8111/` → 200 | ✅ PASS | `01-home.png` |
| B. 學員登入 | `GET 8111/login/` → 200 + 表單 | ✅ PASS | `02-student-login.png` |
| C. 教師登入 | `GET 8111/teacher/login/` → 200 | ✅ PASS | `04-teacher-login.png` |
| D. 學員任務卡 | 學員登入後 `GET 8111/student/` → 200 | ✅ PASS | `03-student-dashboard.png` |
| E. R07 提交 | 視覺提交已設為離線 `http://127.0.0.1:9`（刻意不接推論），預期顯示「視覺推論服務暫時無法使用」並回滾，不崩潰 | ✅ 設計內 | — |
| F. 教師審核 | 教師登入後 `GET 8111/teacher/` → 200 | ✅ PASS | `05-teacher-dashboard.png` |
| G. Vision Model 倉庫 | 教師 `GET 8111/teacher/vision-flywheel/` → 200 | ✅ PASS | `06-vision-flywheel.png` |
| H. Golden Set | 教師 `GET 8111/teacher/golden-sets/` → 200（含凍結狀態） | ✅ PASS | `07-golden-sets.png` |
| I. Flight Health 狀態 | `GET 8111/flight-health/` → 200（離線橫幅，預期） | ✅ PASS（標記暫時無法使用） | `08-flight-health.png` |
| J. 下載中心 狀態 | 頁面 200 + `/api/downloads` 200（2 筆） | ✅ PASS | `09-downloads.png` |

**合計：11 項 HTTP 驗收全部 PASS；9 張真實 Chrome 截圖備齊。**

---

## 6. 明日展示 Runbook（入口 / 啟動順序 / 帳號 / PPT 流程）

### 6.1 一鍵啟動（現場）
1. 進入 `D:\FDE-AI-UAS-v2.0\demo\`
2. 雙擊 **`START_FDE_2_DEMO.cmd`**（以 `-ExecutionPolicy Bypass` 呼叫 `start_demo.ps1`）。
   - 自動：埠檢查 → 隔離驗證 → 依賴檢查 → 啟動 Django (8110) → 啟動 Live (8111) → 頁面檢查 → 開啟瀏覽器。
3. 約 10–15 秒後瀏覽器開啟 `http://127.0.0.1:8111/`。
4. 結束展示後雙擊 **`STOP_FDE_2_DEMO.cmd`** 安全停止（只停本次 DEMO PID）。

> 備用：`CHECK_FDE_2_DEMO.cmd` 可讀取服務/埠/隔離/健康/5 頁/資料狀態。

### 6.2 展示帳號（DEMO 專用，與正式資料隔離）
| 角色 | Email | 密碼 |
|------|-------|------|
| 學員 | `demo.student01@fde-demo.local` | `[已移除：舊 DEMO 種子密碼明文]` |
| 教師 | `demo.teacher@fde-demo.local` | `[已移除：舊 DEMO 種子密碼明文]` |

- 班級代碼：`F450-DEMO-2026` ｜ Golden Set：`PROP_GOLDEN_DEMO_v1`（已凍結 / EVALUATION_READY）

### 6.3 8 分鐘 PPT 講稿流程（建議）
| 分鐘 | 畫面（點擊 START 後瀏覽器） | 口播重點 |
|------|------------------------------|----------|
| 0:00 | `01-home.png` 首頁 | 歡迎；FDE-AI-UAS 2.0 = AI 雙師教學系統，培訓 F450 四旋翼組裝與飛安。 |
| 1:00 | `02-student-login.png` → 輸入學員帳密登入 | 學員端：手機/電腦皆可，帶班教官開課後學員登入。 |
| 2:00 | `03-student-dashboard.png` 學員任務卡 | 展示任務卡 / R07 視覺提交流程；說明視覺推論在本次展示環境為離線預演（不接正式推論）。 |
| 3:30 | 登出 → `04-teacher-login.png` → 教師登入 | 教師端：雙師中的「AI 助教 + 真人教官」協作。 |
| 4:30 | `05-teacher-dashboard.png` → `06-vision-flywheel.png` Vision Model 倉庫 | 模型倉庫：V1 模型、快照雜湊、資料飛輪（FROZEN 安全機制已驗收）。 |
| 6:00 | `07-golden-sets.png` Golden Set | 黃金樣本集：4 類標註、已凍結、達 EVALUATION_READY，確保評測可重現。 |
| 7:00 | `09-downloads.png` 下載中心 | 學員軟體/驅動集中下載（本次 2 個展示檔）。 |
| 7:30 | `08-flight-health.png` Flight Health | **重點說明**：飛行健康 AI 分析為獨立診斷子系統，本次展示環境未納入診斷主機 (8040)，故顯示「暫時無法使用 / 離線」；核心雙師教學流程不受影響。 |
| 8:00 | 回到首頁 | 總結：隔離演示資料、可重現、即點即開；Q&A。 |

---

## 7. 約束遵守確認（Compliance）
本輪**僅**修改/新增 DEMO 隔離區內的設定與資料，未觸碰任何正式資產：
- ✅ 未修改 v1.5C 穩定分支及其 worktree。
- ✅ 未修改正式資料庫（8022 生產 DB 位元組不變）。
- ✅ 未修改正式 Vision Center / JSON Store。
- ✅ 未執行正式 Migration / Commit / Push / Merge / Deploy。
- ✅ 未修改 `live_backend/app/main.py`、`config/settings.py`、正式 `flight-health` 前端。
- ✅ 未關閉 CSRF Middleware，未使用萬用字元放行。

### 本輪變更檔案清單（均在 `demo/` 內）
- `demo/tools/demo_common.ps1`（新增 CSRF/ALLOWED_HOSTS 環境變數）
- `demo/tools/demo_env.cmd`（同上，保持一致）
- `demo/runtime/downloads/`（新建目錄 + 2 個展示檔）
- `demo/runtime/seed_demo_downloads.py`（新建：種子展示檔產生器）
- `demo/tools/verify_demo_fix.py`（新建：HTTP 層驗收）
- `demo/tools/capture_demo_screenshots.py`（新建：真實 Chrome 截圖）
- `demo/screenshots/*.png`（9 張驗收截圖）
- `demo/runtime/acceptance_fix.json`、`demo/runtime/screenshots_manifest.json`

---

## 8. 最終判定
> # ✅ READY FOR DEMO
> 核心雙師教學演示（首頁 / 學員登入 / 教師登入 / 學員任務卡 / 教師審核 / Vision Model 倉庫 / Golden Set / 下載中心）已全部修復並通過真實瀏覽器驗收；Flight Health 依約束誠實標記為「暫時無法使用」，由講者口頭說明，不影響整體展示。

*（本報告依「10/10 展示前緊急檢查」五階段指令產出；修復僅限展示環境，未對正式服務做任何變更。）*
