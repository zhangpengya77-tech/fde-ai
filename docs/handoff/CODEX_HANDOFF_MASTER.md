# CODEX_HANDOFF_MASTER.md｜FDE-AI-UAS 2.0 接棒總綱

> 移交者：WorkBuddy
> 接收者：Codex
> 最終確認者：教師
> 建立日期：2026-10-14
> 專案根目錄：`D:\FDE-AI-UAS-v2.0`
> 本文件性質：**正式開發交接**，不是新一輪功能開發。

---

## 0. 先讀這段（30 秒版）

1. 本專案是 **FDE-AI-UAS 2.0（AI 雙師教學系統，F450 四旋翼無人載具組裝培訓）**，
   在 `D:\FDE-AI-UAS-v2.0` 開發，分支 `fde-ai-v2.0-dev`。
2. **v1.5C 穩定母版在另一個 repo**：`C:\Users\admin\Documents\Codex\2026-08-30\new-chat\FDE-AI`
   （HEAD `c7a0b25`，2026-09-02）。**兩者不可混為一談，v1.5C 一律禁止修改。**
3. 已完成 **P1–P9 階段開發 + I1–I5 交付前審查與安全修復**。本次交接**不新增任何功能**。
4. 最大風險：**HEAD `e5c0442` 只是 2026-10-03 的歷史基準，絕不代表工作區成果已被 Git 保存。**
   目前有 **43 個已修改未提交 + 292 個未追蹤成果檔案**（另加 10 份本輪交接文件），全部只存在於工作區磁碟上。
   詳見 `GIT_WORKTREE_INVENTORY.md`。
5. **I1 測試基準已由教師確認**：教師跨班級隔離補充驗收 **46/46 PASS**，接受為 I1 最終測試基準
   （腳本 `demo/tools/verify_i1_external_modules.py`）。但 **I1 是起點不是終點**——
   I2／I3／I4／I5 的框架、跨服務代理與安全修復必須全部保留，**不得以 I1 歷史程式覆蓋 I5**。
6. Codex 首次接手：**只讀** → 讀 `PROTECTED_MODULES.md` → 盤點 → 提理解報告 → **等教師批准**。
   不得一接手就重構，不得自行啟動 I6。

---

## 1. 專案總覽

| 項目 | 內容 |
|---|---|
| 系統名稱 | FDE-AI-UAS（Flight Drone Education – AI Unmanned Aerial System） |
| 版本 | 2.0（開發分支 `fde-ai-v2.0-dev`） |
| 核心目標 | AI 雙師教學：手机摄影機／槳葉掃描 → YOLO 視覺 → RAG 知識庫 → AI Live Coach 即時助教 |
| 教學場景 | F450 四旋翼無人載具組裝實訓（學→練→做→測→證五階段） |
| 前代 | v1.5C（穩定母版，Photo Check 模式，獨立 repo，禁止修改） |
| 開發主 repo | `D:\FDE-AI-UAS-v2.0` |
| v1.5C repo | `C:\Users\admin\Documents\Codex\2026-08-30\new-chat\FDE-AI` |

### 1.1 2.0 的定位

2.0 在 v1.5C 之上增加：

- **學員端五階段學習工作台**（`student_portal/learning`）
- **AI Live Coach**（即時實訓助教，`live_backend/app/coach_ask.py`）
- **學員模型提交 R07 + 教師視覺模型倉庫 + ACTIVE 發布／回滾**
- **手機 MVP**（同源代理、語音朗讀、RAG 前端）
- **跨服務統一入口**（`/platform/` 代理）
- **外部模組安全接口**（I5：DNS 重綁防護 + IP Pinning）

---

## 2. 開發歷史（P1–P9 → I1–I5）

| 階段 | 主題 | 報告位置 |
|---|---|---|
| P0 / P0.5 | 手機 MVP、F450 槳葉模型測試 | `docs/reports/`、`docs/handoffs/WORKBUDDY_TO_CODEX_P05.md` |
| P1 | 五階段學習工作台 | `docs/reports/P1_Learning_Workbench_Delivery_Report.md` |
| P2 | 任務紀錄鏈（R01–R08） | `docs/reports/P2_Task_Record_Chain_Report.md` |
| P3 | DEMO 驗收 + 教師班級成果 | `docs/reports/P3_*` |
| P4 | 教師複核管理（+ 4.1 篩選 / 4.2 多類別） | `docs/reports/P4*` |
| P5 | 班級報告只讀頁 + CSV 注入防護 | `docs/reports/P5_Report.md` |
| P6 | 班級交付 + CSV 安全 | `docs/reports/P6_Report.md` |
| P7 | 學員成果展示 | `docs/reports/P7_Report.md` |
| P8 | 展示安全 | `docs/reports/P8_Report.md` |
| P9 | 只讀班級報告 | `docs/reports/P9_Report.md` |
| I1 | 外部模組接口與權限隔離 | `docs/reports/I1_External_Module_Integration_Report.md` |
| I2 | 五階段入口與四態模組狀態 | `docs/reports/I2_Report.md` |
| I3 | 教學端到端流程及接口安全 | `docs/reports/I3_Report.md` |
| I4 | 跨服務統一入口與 `/platform/` 代理 | `docs/reports/I4_Report.md` |
| I5 | DNS 重綁防護、IP Pinning 與交付前審查 | `docs/reports/I5_Report.md` |

> P1/P3 另有驗收腳本與回歸紀錄；`demo/tools/` 下有 33 個 `verify_*` 驗收腳本。

---

## 3. 目前狀態（以 2026-10-14 實測為準）

### 3.1 Git

- 分支：`fde-ai-v2.0-dev`
- HEAD：`e5c044244475d18930f32e26696d2cf9cf43dfa6`（`e5c0442`，2026-10-03 12:50）
- 工作區：**190 條狀態** = 43 已修改未提交 + 146 未追蹤 + 1（`docs/handoff/` 交接文件目錄）
  （未追蹤展開為 **302 個實際檔案** = 292 個既有成果 + 10 份交接文件）
- stash：`stash@{0}: On fde-ai-v1.5: safety: pre-anonymous identity v1.5 2026-09-14`
  （屬於另一分支，**與 2.0 開發無關，禁止 pop**）
- 最新 migration：`student_portal/learning/migrations/0019_golden_set_manifest_contract.py`
  （0016–0019 四個檔案**均為未追蹤**）

### 3.2 服務（2026-10-14 實測）

| 埠 | 服務 | 狀態 |
|---|---|---|
| 8022 | Django 正式入口（v1.5C 系） | LISTENING，`/login/` 回 200 |
| 8770 | RAG 知識庫 | LISTENING，回應 `f450_v1` JSON |
| 8765 | YOLO 推論 | **未啟動** |
| 8110 / 8111 | DEMO Django / Live Backend | **未啟動** |
| 9222 | Chrome CDP（自動化用） | **未啟動** |

### 3.3 資料庫（讀取狀態，未修改）

| 檔案 | 角色 |
|---|---|
| `student_portal/db.sqlite3`（2026-10-07） | **正式資料庫**（本輪零修改） |
| `demo/runtime/db/demo.sqlite3`（2026-10-13） | DEMO 專用庫（獨立隔離） |
| `demo/runtime/db/i4_e2e.sqlite3`（2026-10-14） | I4/I5 回歸測試庫 |
| `demo/backup/` | 3 個歷史備份（R07 cleanup、incident snapshot 等） |

### 3.4 測試基準（詳見 `TEST_BASELINE.md`）

| 階段 | 結果 | 備註 |
|---|---|---|
| **I1** | **46/46 PASS** | **教師確認之最終測試基準**（含教師跨班級隔離補充驗收）；腳本 `demo/tools/verify_i1_external_modules.py` |
| I2 | 114/114 | default 67 + module-up 23 + module-down 24 |
| I3-A／I3-B | 45 PASS／95 PASS | 端到端與模組安全 |
| I4-A／I4-C | 31+9 PASS／deny 35 + allow 36 | 跨服務主流程、降級、雙模式安全 |
| I5-A／I5-B | 33/33／PASS 39 | 路由核對、DNS 重綁與 13 項安全驗收 |
| I1／I5 單元測試 | 63/63 OK | `test_external_module_interface.py` |
| learning 完整回歸 | 934 項 → 932 通過 | **2 項既有失敗保留**（`test_auth` hero 標籤、`test_vision_flywheel_framework`「訓練用途」欄） |

iPhone 實機 7 站 32 項、正式 Tunnel／RAG／YOLO 實測：**全部 PENDING**。

---

## 4. 接棒原則（Codex 必須遵守）

### 4.1 第一批必讀

1. 本文件（`CODEX_HANDOFF_MASTER.md`）
2. `PROTECTED_MODULES.md`（**最高優先，違反即屬事故**）
3. `GIT_WORKTREE_INVENTORY.md`
4. `MODULE_STATUS_MATRIX.md`、`SYSTEM_ARCHITECTURE.md`

### 4.2 硬性禁止（未經教師單獨批准）

- 修改 v1.5C 正式系統、穩定分支、正式 GitHub Pages、正式 Cloudflare Worker/Tunnel、正式資料庫
- 修改 YOLO 模型與 `best.pt`、R07 提交鏈、教師視覺模型倉庫、ACTIVE 發布與回滾
- 修改 Flight Health AI、F450 十二任務核心、MP12、HQGC、F450 3D 數位孿生獨立專案
- 新增 Migration、修改正式 DB
- `git clean` / `reset` / `checkout` 覆蓋 / `commit` / `push` / `merge` / `rebase` / `stash pop`
- 部署、重啟正式服務、清理工作區、移動獨立專案
- 自行啟動 I6 或大規模重構
- 把尚未提交的成果當成已完成版本控制
- **以 I1 的歷史程式覆蓋 I2／I3／I4／I5 的最新版本**（I1 為介面與權限層基準，其後各階段的框架、
  跨服務代理與安全修復均為後續成果，必須全部保留）

### 4.3 完成標準（兩級）

| 層級 | 條件 |
|---|---|
| `AUTOMATED PASS` | 自動化測試／腳本研究收全綠 |
| `REAL DEVICE PASS` | **真實 iPhone** 逐項通過並附截圖 |

iPhone 實機驗收完成前，任何手機相關結論只能寫 `PENDING`。Chrome 裝置模擬不算真機。

---

## 5. 交接文件索引

| 文件 | 內容 |
|---|---|
| `CODEX_HANDOFF_MASTER.md` | 本文件：總覽、歷史、現狀、接棒原則 |
| `SYSTEM_ARCHITECTURE.md` | 系統架構、各服務關係、三組重要區分 |
| `MODULE_STATUS_MATRIX.md` | P1–P9／I1–I5／各模組實際狀態 |
| `PROTECTED_MODULES.md` | 凍結區、禁止範圍、需教師批准的操作 |
| `DEVELOPMENT_ENVIRONMENT.md` | 環境、依賴、啟動順序、埠號、環境變數、故障排除 |
| `TEST_BASELINE.md` | 測試基準、通過數、既有失敗、待人工驗收 |
| `GIT_WORKTREE_INVENTORY.md` | Git 盤點：分支、HEAD、修改、未追蹤、stash |
| `NEXT_DEVELOPMENT_BACKLOG.md` | 未完成功能、待接入接口、風險與優先序 |
| `CODEX_FIRST_RUN_CHECKLIST.md` | Codex 首次接手唯讀檢查與最小驗收 |
| `HANDOFF_ACCEPTANCE.md` | 移交／接收驗收清單 |

---

## 6. 教師待確認事項（摘要）

完整列表見 `HANDOFF_ACCEPTANCE.md` §3，重點：

1. 是否為目前工作區建立 Git 提交／備份包／版本標籤（**需單獨批准**）
2. iPhone 7 站 32 項實機驗收（教師執行）
3. 正式 Tunnel 登入、正式 RAG 問答、正式 YOLO 推論實測
4. 外部模組是否維持預設停用
5. §G 八項正式部署前檢查（重啟服務、備份正式 DB、回滾程序等）

---

*本文件所有數字均來自 2026-10-14 實測或 `TEST_BASELINE.md` 記錄的執行結果；未重新執行的項目已明確標註來源。*
