# HANDOFF_ACCEPTANCE.md｜交接驗收清單

> 移交者：WorkBuddy ｜ 接收者：Codex ｜ 最終確認者：教師
> 建立日期：2026-10-14（2026-10-14 依教師指示同步 I1 最終基準）
> 狀態：**`CODEX_HANDOFF_READY`**（交接文件與程式碼盤點已準備完成）
> **本狀態不代表正式部署完成，也不代表 Codex 已驗收。**

---

## 1. 移交方（WorkBuddy）交付清單

### 1.1 交接文件（10 份，全部已建立於 `docs/handoff/`）

| # | 文件 | 內容 | 狀態 |
|---|---|---|---|
| 1 | `CODEX_HANDOFF_MASTER.md` | 專案總覽、開發歷史、目前狀態、接棒原則 | 已交付 |
| 2 | `SYSTEM_ARCHITECTURE.md` | 系統架構、Django／Live／RAG／Vision 關係、三組區分 | 已交付 |
| 3 | `MODULE_STATUS_MATRIX.md` | P1–P9／I1–I5／各模組實際狀態 | 已交付 |
| 4 | `PROTECTED_MODULES.md` | 凍結區、禁止範圍、需教師批准的操作、I1 不得覆蓋 I5 | 已交付 |
| 5 | `DEVELOPMENT_ENVIRONMENT.md` | 環境、依賴、啟動順序、埠號、環境變數（無密碼）、故障排除 | 已交付 |
| 6 | `TEST_BASELINE.md` | 測試基準（含 I1 46/46 教師確認歸檔）、既有失敗、待人工驗收 | 已交付 |
| 7 | `GIT_WORKTREE_INVENTORY.md` | 分支、HEAD、43 修改＋292 未追蹤、stash、runtime | 已交付 |
| 8 | `NEXT_DEVELOPMENT_BACKLOG.md` | 未完成功能、待接入、風險、建議順序 | 已交付 |
| 9 | `CODEX_FIRST_RUN_CHECKLIST.md` | Codex 首次接手唯讀檢查與最小驗收 | 已交付 |
| 10 | `HANDOFF_ACCEPTANCE.md` | 本文件 | 已交付 |

### 1.2 測試基準同步（教師確認項目）

| 項目 | 結果 | 納入文件 |
|---|---|---|
| **I1 教師跨班級隔離補充驗收** | **46/46 PASS，教師接受為 I1 最終測試基準** | `TEST_BASELINE.md` §1、§1.1、§4.2；`CODEX_HANDOFF_MASTER.md` §3.4 |
| I1 驗證腳本位置 | `demo/tools/verify_i1_external_modules.py`（46 項）；隔離服務 `demo/tools/start_p42_verify.ps1 -Port 8112 -DbFile p42_verify.sqlite3` | `TEST_BASELINE.md` §1.1.1／§1.1.3 |
| I1 六項確認要點 | 授權班級可存取／跨班級 404／跨課程 404／`/teacher/login/`／不跟隨重導／iPhone PENDING | `TEST_BASELINE.md` §1.1.2 |

### 1.3 I1–I5 全部納入交接

| 階段 | 最終結果 | 交接文件對應 |
|---|---|---|
| I1 外部模組接口與權限隔離 | **46/46 PASS（教師確認最終基準）** | `MODULE_STATUS_MATRIX.md` §3、`TEST_BASELINE.md` §1.1 |
| I2 五階段入口與四態模組狀態 | 114/114 | `MODULE_STATUS_MATRIX.md` §3 |
| I3 教學端到端流程及接口安全 | 45 PASS + 95 PASS | `MODULE_STATUS_MATRIX.md` §3 |
| I4 跨服務統一入口與 `/platform/` 代理 | 31+9 PASS、deny 35 + allow 36 | `MODULE_STATUS_MATRIX.md` §3、`SYSTEM_ARCHITECTURE.md` §6 |
| I5 DNS 重綁防護、IP Pinning、交付前審查 | 33/33 + PASS 39 + 單元 63/63 | `MODULE_STATUS_MATRIX.md` §3、`SYSTEM_ARCHITECTURE.md` §7 |

### 1.4 後續版本成果保留確認（教師第三節要求）

| 要求 | 狀態 |
|---|---|
| I2／I3／I4／I5 已完成框架、跨服務代理、安全修復全部保留 | **已保留**，本輪僅新增／更新 `docs/handoff/`，未動任何產品程式 |
| 不得以 I1 歷史程式覆蓋 I5 最新版本 | 已寫入 `PROTECTED_MODULES.md` §1.4 與 `CODEX_HANDOFF_MASTER.md` §4.2 明令禁止 |
| 不得修改 YOLO／R07／教師模型倉庫／Flight Health AI／F450 十二任務／v1.5C | 本輪零修改（見 §2.3） |

---

## 2. 接收方（Codex）驗收清單

### 2.1 必做（依 `CODEX_FIRST_RUN_CHECKLIST.md`）

| # | 項目 | 驗收條件 |
|---|---|---|
| 1 | 依序讀完 10 份交接文件 | 能用自己的話重述三組易混淆概念 |
| 2 | 唯讀 Git 盤點 | 分支 `fde-ai-v2.0-dev`、HEAD `e5c0442`、status 189、stash 1 筆 |
| 3 | 確認受保護模組未被修改 | v1.5C HEAD `c7a0b25`、worktree 僅主、正式庫 mtime |
| 4 | 核對 I1–I5 報告與程式碼一致 | 5 份報告 + `external_modules.py` 存在 |
| 5 | 執行最小驗收 | I1 46/46（教師基準）、I5 安全 39/39、單元 63/63 |
| 6 | 提交「接棒理解報告」 | 含理解、盤點、保護確認、驗收結果、建議起點、待批准事項 |
| 7 | **等教師批准後才開始開發** | 未取得批准前不得動手 |

### 2.2 禁止（首次接手期間）

`git clean`／`reset`／`checkout --`／`stash pop`／`commit`／`push`／`merge`／`rebase`；
修改 v1.5C／YOLO／`best.pt`／R07／教師模型倉庫／Flight Health／F450 十二任務／MP12／HQGC／F450 3D；
新增 Migration；修改正式 DB；部署；重啟正式服務；大規模重構；自行啟動 I6。

---

## 3. 仍需教師批准的事項

| # | 事項 | 現況 |
|---|---|---|
| 1 | 為工作區建立 Git 提交／備份包／版本標籤 | 43 修改 + 292 未追蹤**全無版本保護**；需單獨批准 |
| 2 | iPhone 7 站 32 項實機驗收 | PENDING（教師執行） |
| 3 | 正式 Tunnel 登入、正式 RAG 問答、正式 YOLO 推論實測 | PENDING |
| 4 | 外部模組是否維持預設停用 | 目前預設停用；啟用需教師明確配置 |
| 5 | I5 §G 八項正式部署前檢查 | 方案已產出，未執行 |
| 6 | 啟動正式 YOLO `:8765` | 服務未啟動，歸屬需教師確認 |
| 7 | 是否核准 Codex 開始第 1 項開發（建議 B3 Git 封版） | 待教師批准 |
| 8 | 兩項既有失敗是否維持現狀 | 目前維持，禁止改保護區消滅 |

---

## 4. CODEX_HANDOFF_READY 判準核對

教師要求「只能在證據完整時標記 `CODEX_HANDOFF_READY`」。逐項核對：

| 判準 | 證據 | 滿足 |
|---|---|---|
| 程式碼盤點完成 | `GIT_WORKTREE_INVENTORY.md`：分支／HEAD／43 修改／292 未追蹤／1 stash／4 Migration／DB／埠 | ✅ |
| 最終任務狀態已確認（未重建、未覆蓋既有成果） | 本輪僅新增／更新 `docs/handoff/`，產品程式 0 修改 | ✅ |
| I1 最終基準歸檔 | `TEST_BASELINE.md` §1.1（46/46，教師確認，含腳本位置與六項要點） | ✅ |
| I1–I5 全部納入交接 | `MODULE_STATUS_MATRIX.md` §3 + `TEST_BASELINE.md` §1 + 本文件 §1.3 | ✅ |
| 後續版本成果保留（I1 不覆蓋 I5） | `PROTECTED_MODULES.md` §1.4 明令禁止；本輪未動 `external_modules.py` | ✅ |
| 測試基準有來源與日期 | `TEST_BASELINE.md` 每項標明日期與日誌／腳本來源 | ✅ |
| 受保護區零修改 | `PROTECTED_MODULES.md` §3：v1.5C HEAD、mtime、0 Migration、0 git 寫入 | ✅ |
| 無密碼／Token／Key 外洩 | `DEVELOPMENT_ENVIRONMENT.md` §9 只記錄變數**名稱** | ✅ |
| 明確標註非部署完成、Codex 未驗收 | 本文件標題與 §5 聲明 | ✅ |

### 結論

**證據完整 → 標記 `CODEX_HANDOFF_READY`。**

- ✅ 交接文件與程式碼盤點已準備完成
- ❌ 不代表正式部署完成（未部署、未重啟服務、未提交 Git）
- ❌ 不代表 Codex 已驗收（接收方驗收清單見 §2，尚未執行）
- ❌ 不代表 iPhone 實機通過（7 站 32 項全數 PENDING）

---

## 5. 本輪操作紀錄（2026-10-14 交接同步）

| 項目 | 紀錄 |
|---|---|
| 修改的產品程式 | **0** |
| 新增 Migration | 0 |
| 修改正式資料庫 | **0** |
| Git 寫入操作（commit/push/merge/reset/clean/stash） | **0** |
| 部署／重啟正式服務 | **0** |
| 清理工作區／移動獨立專案 | **0** |
| 新增／更新的文件 | 僅 `docs/handoff/` 下 10 份（含本輪同步 `TEST_BASELINE.md`、`CODEX_HANDOFF_MASTER.md`、`PROTECTED_MODULES.md`、新建 `HANDOFF_ACCEPTANCE.md`） |

> 本輪完成後停止，等待教師確認 Codex 接棒。Codex 未提交理解報告並取得教師批准前，不得開始任何開發。
