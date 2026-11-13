# FDE-GCS Web 1.0 架構與 P0 盤點報告

- 日期：2026-11-13
- 盤點範圍：GitHub `zhangpengya77-tech/fde-ai`。以最新發布標籤 `v2.0C-release-20261108i`（commit `2e7f9f3`，與 `fde-ai-v2.0c` 分支同一個 commit）為準
- 盤點方式：**只讀**，沒有修改任何 V2.0 分支、標籤或部署設定
- 限制：雲端無法存取本機，D:\、E:\、COM 埠、SITL、Gazebo 接管案都標為 `PENDING_LOCAL`

## 1. P0 盤點結果

### 1.1 雲端可確認的項目

| 項目 | 結果 | 狀態 |
|---|---|---|
| V2.0 程式碼位置 | GitHub 標籤 `v2.0C-release-20261108i`；`PROJECT_CONTEXT.md` 記載本機正式目錄是 `D:\FDE-AI-UAS-v2.0`、分支 `fde-ai-v2.0-dev` | `PASS`（本機 HEAD 待核對） |
| 「REA 重建版」指什麼 | 考照模擬器的介面版本：`demo/runtime/public-site/sim/`，標題「臺灣無人機考照模擬器 FDE-AI V2.0・REA 重建版」。**倉庫裡只有建置後的檔案**，原始碼不在這個標籤 | `PASS`（原始碼位置待本機確認） |
| 學員／教師／Cohort 資料模型 | Django `student_portal/learning/models.py`：`Cohort`、`LearningGroup`、`Enrollment`、`ClassCode`；教師與學員角色已有 | `PASS` |
| 右上角帳號列 | `student_portal/learning/templates/learning/platform_identity_nav.html` 的 `.fde-public-bar` / `.fde-public-links`，依角色（anonymous／student／teacher）顯示不同連結 | `PASS` |
| 外部模組入口機制 | `student_portal/learning/external_modules.py`＋`settings.FDE_EXTERNAL_MODULES`：預設 DISABLED，四種狀態（AVAILABLE／NOT_INTEGRATED／SERVICE_UNAVAILABLE／ROLE_RESTRICTED），有角色檢查和 URL 安全檢查。已預留 `MP_GROUND_STATION`、`HQGC_ASSESSMENT` | `PASS` |
| 現有 MAVLink 即時通訊 | 倉庫內**沒有** MAVLink Gateway、Web Serial 或即時遙測程式。只有 Flight Health 的 DataFlash 日誌解析（`live_backend/pid_filter_lab/parsers/dataflash.py`、`flight-health/`） | `PASS`（確認不存在） |
| 模擬器的 simlink | `simlink-client` 是**手機當搖桿**的 WebRTC 配對（經 `fde-ai-v2.fde-ai-gateway.workers.dev/api/simlink`），**不是** MAVLink，跟 SITL 無關 | `PASS` |
| CSP | `settings.py` 有 HSTS、nosniff、Referrer-Policy，但**沒有 Content-Security-Policy** | `FINDING` |
| 已知占用埠 | 8030（Live Backend）、8040、8110（Demo Django）、8111（Demo Live）、8770（RAG），與指令清單一致；本機另有網頁模擬器 **8251** | `PASS` |
| 專案開發規則 | `AGENTS.md`：最小修改、垂直切片、v1.5C 唯讀、Flight Health 和 MP-12 未經指定不得修改、發現未提交修改不得動 | `PASS`（已遵守） |

### 1.2 必須在本機盤點的項目

| 項目 | 狀態 |
|---|---|
| `D:\FDE-AI-UAS-v2.0` 的 git status、HEAD，是否與 `v2.0C-release-20261108i` 一致 | `PENDING_LOCAL` |
| 正式站部署架構（Tunnel、Worker、Gateway 實際設定） | `PENDING_LOCAL`（倉庫有 `cloudflare/`，但實際部署以本機為準） |
| Gazebo／SITL 接管案 `D:\FDE-CC-Takeover\sim` 的狀態與回歸測試結果 | `PENDING_LOCAL` |
| QGC（`D:\QGC-Official`）、HyperQGC（`E:\HQGC`）、Mission Planner 的版本 | `PENDING_LOCAL` |
| USB COM 埠、Pixhawk 驅動、Node／Python 版本 | `PENDING_LOCAL` |
| REA 模擬器原始碼所在位置（可能在 `simulator/*` 分支或本機） | `PENDING_LOCAL` |
| C 槽剩餘空間（指令記載約 7 GB） | `PENDING_LOCAL` |

## 2. 重要發現（影響設計）

1. **入口要走現有的外部模組機制**：新增 `FDE_GCS` 模組 ID，只需改 `settings.py` 的模組清單和 `external_modules.py` 的模組定義。**不動 models、migrations、登入流程**，符合「V1.5C 帳號遷移批准前不得修改」的限制。
2. **外部模組機制會拒絕 localhost**：URL 安全檢查「metadata／localhost 主機永遠拒絕」。所以本機開發時，入口不能指向 `http://localhost:82xx`。兩種做法：
   - A（建議）：FDE-GCS 做成 Django 同源路由 `/gcs/`，在 `learning` 之外另建一個 app，只用 Django 的登入狀態與角色。
   - B：做成獨立服務，正式站用核准的主機名，本機開發另開旗標。
   選 A 才能做到「同源腳本＋嚴格 CSP」，Web Serial 也需要安全來源（HTTPS 或 localhost）。
3. **CSP 目前不存在**：FDE-GCS 頁面要自己加嚴格 CSP（`script-src 'self'`、禁止 inline、`connect-src` 只允許同源和 Gateway）。只套用在 `/gcs/` 路由，不改全站設定。
4. **REA 介面只有建置後的檔案**：「沿用 REA 風格」先抽取設計變數（顏色、字型、元件樣式）成為 FDE-GCS 自己的 CSS，不改模擬器本身。

## 3. 建議架構

```text
                         ┌──────────────── 網站層（Django，同源 /gcs/）────────────────┐
學員/教師瀏覽器 ──HTTPS──→ │ 登入／角色／Cohort（沿用）→ Feature Flag → FDE-GCS 頁面        │
                         │ 參數備份、差異報告、操作日誌、教師 PASS/NG（P5，新 app）       │
                         └──────────────────────────────────────────────────────────────┘
   │
   ├─ 真機通道（只在本機）
   │   瀏覽器 Web Serial ──USB──→ Pixhawk
   │   MAVLink 編解碼在瀏覽器內完成（mavgen 產生的 TypeScript，MIT）
   │   雲端只收學員主動上傳的紀錄，沒有任何遠端控制真機的路徑
   │
   └─ 仿真通道
       瀏覽器 ──WebSocket（短效 ticket）──→ FDE-GCS SITL Gateway（新服務）
                                              │  唯讀 ticket：只轉發遙測
                                              │  控制 ticket：教師授權、短效、可撤銷
                                              ↓
                                      MAVLink 分流（單一擁有者，例如 mavlink-router）
                                              ↓
                                      ArduPilot SITL ↔ Gazebo（接管案，不修改）
```

### 3.1 模組切分

| 模組 | 位置（建議） | 階段 |
|---|---|---|
| 入口與 Feature Flag | `settings.py` 新增 `FDE_GCS` 模組 ID；新 Django app `gcs_portal/` 提供 `/gcs/` | P1 |
| 前端 | `gcs-web/`（TypeScript），建置成靜態檔，由 `/gcs/static/` 同源提供 | P1 |
| MAVLink 編解碼 | `gcs-web/src/mavlink/`（mavgen 產出＋最小包裝） | P2 |
| Web Serial 連線 | `gcs-web/src/link/serial.ts` | P2 |
| 參數管理狀態機 | `gcs-web/src/params/`（批次讀取、缺漏重傳、逾時、寫入後讀回） | P2–P3 |
| 白名單 | `gcs_portal/param_allowlist/<韌體版本>.json`（版本化） | P3 |
| SITL Gateway | `gcs-gateway/`（Python，獨立程序） | P4 |

### 3.2 埠位規劃

範圍 8200～8299，避開 **8251**（本機網頁模擬器已在用），也避開指令列出的所有埠：

| 埠 | 用途 |
|---|---|
| 8260 | FDE-GCS 本機開發伺服器（只有不走 Django 同源時才用） |
| 8261 | FDE-GCS SITL Gateway（WebSocket，只綁 127.0.0.1） |
| 8262 | MAVLink 分流輸出給 Gateway（UDP，只綁 127.0.0.1） |

5760／5762 只由分流程式連接，Gateway、QGC、Mission Planner 都從分流取資料，不直接搶 SITL。

## 4. 安全設計重點

1. **真機寫入的七道關卡**（P3）要寫成單一函式 `canWriteParam()`，每道都有測試。任何一道沒過，UI 就不顯示寫入按鈕；不是顯示了再擋。
2. **黑名單硬編碼在程式裡，不讀設定檔**：`ARMING_CHECK`、`FS_*`、`EK2_*`／`EK3_*` 的安全相關項、`BRD_SAFETY*`、`MOT_*` 測試、`SERVO*`、校準和重啟類指令。教師也無法在 UI 解除。
3. **不發送的 MAVLink 指令**：`MAV_CMD_COMPONENT_ARM_DISARM`、`MAV_CMD_DO_SET_MODE`（真機）、`MAV_CMD_PREFLIGHT_*`、`MAV_CMD_DO_MOTOR_TEST`、`MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN`。編碼器層直接拒絕產生這些訊息，不靠 UI 擋。
4. **Ticket**：唯讀和控制分開簽發；控制 ticket 綁定學員、SITL 實例和有效時間（建議 10 分鐘），教師可以隨時撤銷。
5. **模式標示**：頁面頂部常駐「真機／仿真／Demo」色條，三種狀態的連線物件彼此獨立，不共用狀態。

## 5. P1 範圍提案（等待批准）

**本輪目標**：在網站右上角加 FDE-GCS 入口，打開後看到六大區塊的介面骨架（全部標示 Demo），不連任何設備。

- 允許修改：`student_portal/config/settings.py`（新增模組 ID 和 Feature Flag）、`external_modules.py`（新增一筆模組定義）、`platform_identity_nav.html`（新增一個條件式連結）；新增 `gcs_portal/`、`gcs-web/`
- 禁止修改：`learning/models.py`、migrations、登入與認證流程、Flight Health、MP-12、模擬器、`cloudflare/`、v1.5C
- 開發分支：在本機從 `fde-ai-v2.0c` 開 `feat/fde-gcs-web-v1`
- 驗收標準：
  1. Feature Flag 關閉時，入口不出現，`/gcs/` 回 404
  2. 未登入時導向登入頁；學員只看到自己的資料，教師只看到自己班級
  3. `/gcs/` 頁面的 CSP 擋得住 inline script 和第三方來源
  4. 每個區塊都明確標示「Demo」，沒有假遙測冒充真實資料
  5. 現有測試全部通過

## 6. 回退方案

P1 所有改動集中在新目錄，加上三個檔案的小修改。關閉 Feature Flag 就能讓入口完全消失；要完全回退時，revert 該分支的 commit 即可，不涉及資料庫。
