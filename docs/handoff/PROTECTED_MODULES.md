# PROTECTED_MODULES.md｜保護模組與禁止範圍

> 移交者：WorkBuddy ｜ 2026-10-14
> **本文件是 Codex 接手後的第一份必讀文件。違反本文件任何一條即屬開發事故。**

---

## 1. 絕對凍結區（未經教師單獨書面批准，一律禁止修改）

### 1.1 v1.5C 正式系統

| 項目 | 值 |
|---|---|
| 位置 | **獨立 repo**：`C:\Users\admin\Documents\Codex\2026-08-30\new-chat\FDE-AI` |
| 實測 HEAD | `c7a0b25`（2026-09-02），目前 checkout 在 `fde-ai-v2.0a` |
| 穩定分支 | `fde-ai-v1.5c` |
| 服務 | Django `:8022`（2026-10-14 實測 LISTENING，`/login/` → 200） |

禁止：修改 v1.5C 分支與其 worktree、修改穩定 Tag、修改正式 GitHub Pages、正式 Cloudflare Worker、
正式 Cloudflare Tunnel、正式入口網址、**正式資料庫**（`student_portal/db.sqlite3`）。

> ⚠️ v1.5C 在 2.0 repo **之外**。2.0 repo 的 `student_portal/db.sqlite3` 屬正式資料庫，禁止寫入。

### 1.2 模型與視覺鏈

| 項目 | 位置／識別 | 禁令 |
|---|---|---|
| YOLO 模型與 `best.pt` | 模型倉庫（2.0 repo 內最佳做法是不碰） | 禁止修改、重新訓練、覆寫、刪除 |
| R07 學員模型提交鏈 | `student_portal/learning/vision_submission.py`、`growth_records.py` 的 R07 段、Live `POST /api/v1/vision/submissions` | 禁止修改語意 |
| 教師視覺模型倉庫 | `learning/vision_repository.py`、`vision_integrity.py`、`vision_verification.py`、`vision_snapshot.py`、`vision_flywheel.py`、`golden_set*.py` | 禁止為讓測試全綠而修改 |
| Golden Set | `learning/golden_set.py`、`golden_set_guard.py`、`templates/learning/teacher_golden_*` | 不可變保護，禁止修改 |
| ACTIVE 模型發布／回滾 | `vision_repository.py` 的 activate（要求 `validation_status=='VALIDATED'`） | 禁止修改安全閘 |

### 1.3 教學核心

| 項目 | 位置 |
|---|---|
| F450 十二任務核心 | `live_backend/app/task_catalog.py`、`task_state.py`；`learning/models.py` 的 TaskDefinition |
| R01–R08 既有成長紀錄 | `learning/growth_records.py`、`growth_task_map.py`、`growth_media.py` |
| Flight Health AI | `live_backend/app/`（Mount `/flight-health/`） |
| MP12 | `live_backend/app/mp12_state.py`、`mp12_catalog.py`、`mp12_models.py` |

### 1.4 版本成果保留（I1 不得覆蓋 I2–I5）

| 規則 | 說明 |
|---|---|
| I1 定位 | **介面與權限層基準**（46/46，教師確認之最終測試基準）。它是起點，不是終點 |
| I2 成果 | 五階段入口與四態模組狀態（`external_modules.py` + `student_learning_path.html`） |
| I3 成果 | 教學端到端流程及接口安全 |
| I4 成果 | 跨服務統一入口與 `/platform/` 代理（`live_backend/app/main.py`） |
| I5 成果 | DNS 重綁防護、IP Pinning、雙層安全檢查、私網精確清單、fail-closed DNS |

🔴 **禁止以 I1 的歷史程式碼覆蓋 I5 最新版本。** I1 之後的所有框架、跨服務代理與安全修復必須全部保留。
若需參考 I1 歷史實作，只能讀取 `docs/reports/I1_External_Module_Integration_Report.md`，不得還原程式。

### 1.5 獨立專案（不在 2.0 repo 內，禁止移動／接管）

- **HQGC 獨立專案**
- **F450 3D 數位孿生獨立專案**
- **MP 地面站**（Mission Planner 獨立軟體）

---

## 2. 需要教師批准才能執行的操作

| # | 操作 | 說明 |
|---|---|---|
| 1 | 建立 Git 提交 / 備份包 / 版本標籤 | 目前成果**全部未提交**，需教師單獨批准後方可執行 |
| 2 | 正式部署（含 Cloudflare Tunnel、Production 設定） | 本輪未部署 |
| 3 | 重啟正式服務（:8022、:8770） | 本輪未重啟 |
| 4 | 修改正式資料庫或新增 Migration | 本輪零 Migration、未連正式庫 |
| 5 | 啟用外部模組（`FDE_MODULE_*_ENABLED=1`） | 預設停用；啟用只能指向 80/443 或教師精確列入私網清單的位址 |
| 6 | 啟動正式 YOLO `:8765` | 需教師安排 |
| 7 | 任何 `git clean` / `reset` / `checkout` 覆蓋 / `stash pop` | 絕對禁止（無批准程序） |
| 8 | Git `commit` / `push` / `merge` / `rebase` | 需教師單獨批准 |
| 9 | 修改 I5 已完成的安全判定（IP Pinning、私網清單、fail-closed） | 需教師批准並附安全評估 |
| 10 | 安裝／升級系統級環境（pip/npm/Python/Node/Driver） | 需先以中文報告原因、影響與替代方案 |

---

## 3. 本輪（交接盤點）保護證據

### 3.1 v1.5C 隔離

- v1.5C repo HEAD `c7a0b25`（2026-09-02）與 2.0 分支 `fde-ai-v2.0-dev` HEAD `e5c0442` 為不同 repo/分支
- 2.0 repo 內無 v1.5C worktree；Git worktree 清單無其他項目

### 3.2 受保護檔案 mtime（2026-10-14 實測，晚於 I5 開始時間者為零）

| 檔案 | mtime |
|---|---|
| `live_backend/app/task_catalog.py` | 2026-10-07 18:39 |
| `live_backend/app/task_state.py` | 2026-10-07 22:42 |
| `live_backend/app/training_records.py` | 2026-10-07 22:44 |
| `live_backend/app/mp12_state.py` | 2026-10-07 22:42 |
| `live_backend/app/rag.py` | 2026-09-29 03:53 |
| `live_backend/app/vision.py` | 2026-09-28 13:28 |
| `student_portal/learning/models.py` | 2026-10-09 02:39 |
| `student_portal/learning/growth_records.py` | 2026-10-13 09:16 |
| `student_portal/db.sqlite3`（正式庫） | 2026-10-07 19:08 |

> `live_backend/app/main.py`（2026-10-13 18:58）為 **I4 跨服務代理**的既有修改（已提交前的追蹤修改），
> 非保護區內容；本輪（交接）對其零修改。

### 3.3 本輪交接操作限制

本輪（2026-10-14 交接）**只新增／更新 `docs/handoff/` 下的文件**：
- 未修改任何產品程式
- 未新增 Migration、未修改正式 DB
- 未部署、未重啟正式服務
- 未清理 Git 工作區、未移動獨立專案
- 未執行任何 git 寫入操作

---

## 4. 已知歷史失敗（禁止為消滅它們而改保護區）

| 測試 | 差異 | 狀態 |
|---|---|---|
| `learning.tests.test_auth` | hero 標籤差異 | I5 之前即存在，獨立記錄 |
| `learning.tests.test_vision_flywheel_framework` | 「訓練用途」欄位差異 | I5 之前即存在，獨立記錄 |

> **禁止修改教師模型倉庫／前端來讓這兩項轉綠。**
