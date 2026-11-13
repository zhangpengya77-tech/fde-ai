# FDE-GCS Web 1.0 — P1 階段報告

- 日期：2026-11-13
- 分支：`feat/fde-gcs-web-v1`（從 `fde-ai-v2.0c` @ `2e7f9f3` 開出）
- 環境：雲端容器，Python 3.13、Django 5.2.17（依 `student_portal/requirements.txt`）
- 沒有部署、沒有合併、沒有修改正式站

## 1. 實際完成

| 功能 | 狀態 | 位置 |
|---|---|---|
| `/gcs/` 同源路由（入口方案 A） | PASS | `student_portal/gcs_portal/`、`config/urls.py` |
| Feature Flag：預設關閉，關閉時 404 且不顯示入口 | PASS | `config/settings.py`：`FDE_GCS_ENABLED`、`FDE_GCS_COHORTS` |
| 存取判定：未登入導向登入；教師可用；學員須在開放期別有有效選課；未啟用帳號拒絕 | PASS | `gcs_portal/access.py` |
| 右上角入口（只對有權限的人顯示） | PASS | `platform_identity_nav.html`、`base.html`（透過 context processor `gcs_entry`） |
| 六大區塊介面骨架，沿用 REA 設計變數 | PASS | `gcs_portal/templates/gcs_portal/home.html`、`static/gcs_portal/gcs.css` |
| 明確的 Demo 標示，頂部模式色條（Demo／真機／仿真三種顏色） | PASS | 同上，`gcs.js` |
| Web Serial 支援偵測（顯示真實的瀏覽器狀態） | PASS | `gcs.js` |
| 嚴格 CSP 與安全標頭（只用在 `/gcs/`） | PASS | `gcs_portal/views.py` |
| 桌面限定：寬度小於 1024px 時改顯示「請用電腦開啟」 | PASS | `gcs.css` |

所有按鈕在 P1 都是停用狀態，沒有任何連線、遙測、寫入或控制功能。

## 2. 和 P0 架構文件不同的地方

架構文件原本規劃修改 `external_modules.py`。實作時發現入口 A 是同源路由，不需要經過外部模組的 URL 探測機制，所以改用 **context processor** 提供入口網址，`external_modules.py` 和 `learning/views.py` 都**沒有修改**。

實際修改的既有檔案（共 4 個，15 行新增，0 行刪除）：

| 檔案 | 改動 |
|---|---|
| `student_portal/config/settings.py` | 新增 app、context processor、兩個 Feature Flag 設定 |
| `student_portal/config/urls.py` | 新增 `gcs/` 路由 |
| `learning/templates/learning/base.html` | 有權限時多一個「FDE-AI 地面站」連結 |
| `learning/templates/learning/platform_identity_nav.html` | 同上 |

沒有動到：`learning/models.py`、migrations、登入與認證流程、Flight Health、MP-12、模擬器、`cloudflare/`、v1.5C。

## 3. 測試證據

| 測試 | 結果 |
|---|---|
| 新增 `gcs_portal/tests.py` 共 18 個測試（旗標、登入、角色、期別隔離、CSP、無 inline script、無第三方來源、六大區塊、所有按鈕停用、入口顯示規則） | **18／18 PASS** |
| `makemigrations --check` | PASS（沒有新 migration） |
| 完整回歸 `learning` + `gcs_portal`（1355 個測試） | 失敗項目和改動前的基準**完全相同**：17 failures、19 errors |
| 瀏覽器實測（Chromium 1440×900，教師帳號） | 頁面 200、主控台零錯誤、切換「仿真」後色條與文字正確更新，截圖：`P1_gcs_home_1440.png` |

**基準就有的 36 個失敗與本次無關**：雲端容器缺少 ffmpeg（影片處理測試）和平台靜態檔（`/platform/` 相關測試），另有 2 個 `test_no_new_migration_added` 在改動前就失敗。這些要在本機環境確認。

## 4. 啟動方式（本機開發）

```bat
set FDE_GCS_ENABLED=1
set FDE_GCS_COHORTS=2026-06
python manage.py runserver 127.0.0.1:8260
```

以教師帳號登入後，右上角會出現「FDE-AI 地面站」。一鍵關閉：把 `FDE_GCS_ENABLED` 設成 `0` 或刪除這個變數。

## 5. 風險與待辦

| 項目 | 說明 |
|---|---|
| 教師只能看所屬班級 | 現有資料模型裡沒有「教師 ↔ 班級」的關聯。P1 頁面沒有任何學員資料所以不受影響，但 P5 顯示學員成果前必須先解決 |
| 本機盤點 | 仍為 `PENDING_LOCAL`，等 Remote Control 連上後補做 |
| 本機回歸測試 | 需要在本機（有 ffmpeg、平台檔）再跑一次完整測試 |

## 6. 回退方案

關閉 `FDE_GCS_ENABLED` 入口立即消失；要完全回退，revert 本分支的 commit 即可，不涉及資料庫。

## 7. 下一階段（P2）計畫

1. 用 mavgen 產生 TypeScript MAVLink 編解碼器（先確認 TypeScript 輸出可用並記錄版本）
2. Web Serial 連線：使用者手動選 COM 埠、HEARTBEAT、識別、只讀遙測、參數讀取、斷線恢復
3. 先用 SITL 或 MAVLink 模擬資料流驗證，**不拿真機當第一次測試對象**
