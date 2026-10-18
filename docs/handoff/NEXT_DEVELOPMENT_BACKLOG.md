# NEXT_DEVELOPMENT_BACKLOG.md｜後續開發待辦與風險

> 移交者：WorkBuddy ｜ 2026-10-14
> 原則：只列**有程式碼或報告依據**的項目；等待教師人工驗證的項目單獨標註。

---

## 1. 尚未完成的功能（需開發）

| # | 項目 | 現況與依據 | 位置 | 優先序 |
|---|---|---|---|---|
| B1 | **學員端靜態圖片辨識前端** | `student_portal/learning/urls.py` **無對應路由**；教師端圖片測試頁（`teacher_golden_test.html`）已可實際使用，學員端尚未建立 | 新增 `student_portal/learning/` 路由 + 模板 + 靜態 | **P0（首要）** |
| B2 | **正式 YOLO 推論端到端** | 服務 `:8765` 未啟動（2026-10-14 實測）；DEMO 走 `FDE_DEMO_SIMULATED_INFERENCE=1` 模擬推論 | `live_backend/app/vision.py`、`vision_center.py` | P0 |
| B3 | **為工作區建立 Git 版本控制** | 43 個已修改 + 292 個未追蹤檔案，全部無版本保護（見 `GIT_WORKTREE_INVENTORY.md`） | 需教師單獨批准後方能 commit / 打 tag | **P0（但需批准）** |
| B4 | 正式部署前 8 項檢查 | I5 §G 已產出方案但**未執行**：重啟服務、新增安全配置、外部模組預設停用、正式資料備份、健康檢查、回滾程序、未提交工作區保護、v1.5C 隔離證據 | 見 `docs/reports/I5_Report.md` §G | P1 |

---

## 2. 待接入接口（僅預留，不代表已接入）

| 模組 | 設定 ID | 待辦 |
|---|---|---|
| MP 地面站 | `MP_GROUND_STATION` | 接入 Mission Planner（獨立軟體）；預設停用 |
| HQGC 評量 | `HQGC_ASSESSMENT` | 接入 HQGC 獨立專案；預設停用 |
| F450 數位孿生 | `F450_DIGITAL_TWIN` | 接入獨立專案；工作台目前只顯示「待接入／規劃中」徽章、無連結 |
| F450 3D 數位孿生 | — | 獨立專案，尚未與 2.0 整合 |

> 三者皆為**僅預留接口**狀態。啟用需教師明確配置，且受限於 I5 安全規則
> （只能指向 80/443，或教師精確列入 `FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS` 的位址）。

---

## 3. 待教師人工驗證（非開發項目）

| # | 項目 | 狀態 |
|---|---|---|
| V1 | 真實 iPhone Safari（7 站 32 項） | PENDING |
| V2 | 正式 Tunnel 登入 | PENDING |
| V3 | 正式 RAG 真實問答 | PENDING |
| V4 | 正式 YOLO 真實推論 | PENDING |
| V5 | 教師實際課堂試用 | PENDING |

---

## 4. 殘餘風險（I5 未修復，教師僅批准 R1/R2/R3/R7/R9）

| 編號 | 級別 | 風險 | 建議 |
|---|---|---|---|
| **R4** | **中** | 探測目標埠號未限制（理論上可探任意埠） | 下一輪限制為 80/443，或要求教師明確配置 |
| **R5** | **中** | 探測同步執行，逾時 1.5 秒 × N 個模組會阻塞 Django worker | 改非同步／背景探測 |
| R6 | 低 | 探測結果快取 TTL 30 秒，期間主機名可能重新解析 | 已有 IP Pinning，風險有限 |
| R8 | 低 | `FDE_EXTERNAL_MODULE_PROBER` 測試捷徑若在正式環境誤設會繞過真實探測 | 部署前檢查環境變數 |
| R10 | 低 | I5-A 觀察：代理把 `Host` 寫死為 `127.0.0.1:8022`；`x-forwarded-proto` 在 Cloudflare Tunnel 下為 `http`；`httpx` 無連線池 | 正式部署時評估 |

---

## 5. 測試基準債

| 項目 | 說明 |
|---|---|
| Node 測試（28 個 `.test.cjs`） | 本輪（2026-10-14）未重新執行，最後紀錄見 I4／P0 報告 |
| `live_backend` 後端套件 | 未單獨整輪重跑；改以 learning 6 批 + I1–I5 驗收腳本覆蓋 |
| 兩項既有失敗 | `test_auth` hero 標籤、`test_vision_flywheel_framework` 「訓練用途」欄位 — **保留，不修改保護區** |

---

## 6. 其他已知待辦

| # | 項目 | 說明 |
|---|---|---|
| N1 | DEMO 有效密碼機制 | `demo/runtime/` 下 `demo.shared.password.txt` 的 shared 值覆寫學員專屬檔；登入失敗先查 `auth_user.username` |
| N2 | 上傳鏈模型大小上限 | `FDE_LIVE_MAX_IMAGE_BYTES` 預設 8 MiB；影片／模型提交是否需另行配置 |
| N3 | 班級報告 CSV | P5/P6 已有注入防護；正式菜單匯出格式可再與教師確認 |
| N4 | `best.pt` 訓練 | 從未真實訓練出 `best.pt`（P0.5 已證實）；需教師安排訓練資源（GPU 2GB / RAM 偏緊） |

---

## 7. 建議開發順序（給 Codex，教師批准後才可執行）

1. **先做 B3（Git 封版）** — 在没有版本保護的情況下繼續開發，任何誤操作都可能永久損失 292 個檔案
2. B1 學員端圖片辨識前端（垂直開發：路由 → 頁面 → 調用既有 vision API → 測試）
3. B2 正式 YOLO 推論（需先確認 `:8765` 服務歸屬與啟動方式，屬保護區協作）
4. V1 iPhone 實機驗收（教師執行，Codex 依結果修 UX）
5. R4／R5 安全強化
6. B4 正式部署前 8 項檢查
7. 外部模組接入（MP／HQGC／F450 Digital Twin）— **最後做，且需逐項教師批准**

> 🔴 **Codex 不得自行啟動 I6 或大規模重構。完成理解報告並取得教師批准後，才開始第 1 項。**
