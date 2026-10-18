# FDE-AI-UAS 2.0｜待確認事項（Open Questions）

| 項目 | 內容 |
| --- | --- |
| 文件編號 | `FDE_AI_2_0_Open_Questions.md` |
| 前置文件 | `FDE_AI_2_0_Current_State_Audit.md`、`FDE_AI_2_0_Module_Integration_Matrix.md` |
| 專案目錄 | `D:\FDE-AI-UAS-v2.0` |
| 稽核日期 | 2026-10-12 |
| 性質 | 唯讀產出；**不自行選定方案、不臆測** |
| 編號體系 | 沿用 `Q-*`、`RISK-*`（與其他文件一致） |

> 本文件彙整本輪盤點中**無法在磁碟上確認**、或**需要教師決策**的所有事項。
> **凡本輪未找到者，一律列為待確認，不建立替代模組。**

---

## 1. 未找到實體（Not Found）

> **2026-10-12 補充指令修正對照**：
> 本表原先的 `Q-02`（F450 數位孿生）與 `Q-06`（官方檢查清單）判定已依教師補充指令修正。
> `Q-02` 由「未找到」改為「**已有獨立開發版本，完整路徑未確認**」；其餘維持原判。

| 編號 | 項目 | 搜尋範圍 | 結果 | 影響 | 建議 |
| --- | --- | --- | --- | --- | --- |
| `Q-01` | **FDE-Safe-Dev Skill** | 全機搜尋 `*Safe*Dev*`（含 `C:\Users\admin\.workbuddy-ai\skills\`、專案 `.workbuddy-ai\`） | ❌ 未找到 | 安全規則依據改以 `AGENTS.md`（16 條）+ `docs/architecture/FDE-DEVELOPMENT-CHARTER.md` | 教師確認是否需補建此 Skill |
| `Q-02` | **F450 數位孿生獨立專案路徑** | 全機搜尋 `*twin*`、`digital twin`、`數位孿生`、D 槽已列舉目錄 | ⚠️ **已有獨立開發版本，完整路徑未確認**（教師補充指令 2026-10-12 修正；初版誤判為「不存在」係搜尋範圍所致） | `INT-08`／`INT-09` 無法在路徑確認前評估；`FLOW-03` 部分缺口 | **需教師決策**：提供專案路徑，或明確「暫不整合」 |
| `Q-03` | 外部 `yolo_server.py` 原始碼 | `live_backend/dev/vision_snapshot_server.py:50` 指向外部 import | ❌ 不在本倉 | 僅能驗證呼叫契約（`/api/health`、`/api/detect`） | 確認外部服務部署位置與版本 |
| `Q-04` | RAG 服務本體與 1105 docs 語料 | `**/*rag*`、`Glob` | ❌ 不在本倉 | 僅能驗證呼叫契約（`/api/rag/ask`） | 確認語料來源與更新機制 |
| `Q-05` | 後端 STT / TTS 實作 | `live_backend/app/` 全檔 | ❌ 未找到 | 語音目前為瀏覽器原生（前端 `live/live.js:773/1152`） | **需教師決策**：是否需後端語音 |
| `Q-06` | 《FDE-AI-UAS 2.0｜第一階段可驗證檢查清單與交付驗收條件》實體檔案 | `*檢查清單*`、`*checklist*` | ❌ 未找到（僅有 `docs/verification/phase1a2/*-checklist.md` 三份裝置清單） | 本輪以指令內文為驗收依據 | 教師確認是否需將清單正式文件化 |
| `Q-07` | 下載中心測試斷言矛盾 | `src/download-center-entry.test.cjs:12-14` vs `src/homepage-portal-entry.test.cjs:17` | ⚠️ **已確認矛盾** | `RISK-07` | **需教師決策**（是否修正；本輪禁止修改） |
| `Q-08` | `dashboard`／`flight-health-entry` 有 DOM id 但無路由 | `index.html:123/154` vs `src/router.js:2-13` | ⚠️ **已確認** | `applyRoute()`（`app.js:97-121`）不會單獨顯示 | **需教師決策** |
| `Q-09` | 8 個區塊路徑在 8111 直開會 404 | `main.py:556/560` 僅註冊 `/`、`/eagle` | ⚠️ **已確認** | 手機直開 `/tasks`、`/courses`、`/fde`、`/simulator`、`/f450`、`/github`、`/results`、`/teacher` 會 404 | **需教師決策**（是否補路由；須避開 `/courses/{path}` 等代理路由） |

---

## 2. 需要教師決策的方案選擇

| 編號 | 決策事項 | 候選方案 | 影響 | 阻擋 |
| --- | --- | --- | --- | --- |
| `Q-10` | **`INT-01`：學／練／做／測 → 成長證據鏈整合方式** | **A** 任務完成即回寫（`main.py:577` → `training_records.py` → Django `Evidence`）<br/>**B** 教師複核後回寫（沿用 `main.py:583` + `views.py:2240`，僅補階段↔slot 對照）<br/>**C** 僅建立對照表（文件層，不回寫） | `ARCH-02`、`FLOW-01`–`FLOW-05`、`RISK-05` | **P2** |
| `Q-11` | **`INT-02`：MP12 整合方式** | **A** Deep Link（`src/app.js:82-88` 加 `href`）<br/>**B** Embed iframe（類比 `main.py:565` `Mount`）<br/>**C** API Integration（複用 `mp12_*` + `sessions.py:331-353`）<br/>**D** 暫不整合（＝現況 file-level adoption） | `FLOW-03`、`AUD-06`、`RISK-04` | **P4** |
| `Q-12` | **`RISK-02`：Django SQLite ↔ Live JSON Store 是否需雙向同步** | **A** 維持現狀（僅 R07 鏈串接）<br/>**B** 建立單向同步（Django → Live）<br/>**C** 建立雙向同步 | 資料一致性、`ARCH-05` | P2/P4 |
| `Q-13` | **`RISK-09`：154 筆未提交變更如何處理** | **A** 維持 `EXTERNAL_DIRTY_STATE_DO_NOT_TOUCH`（不處理）<br/>**B** 由教師逐項審閱後分批提交<br/>**C** 建立 checkpoint（不提交） | 全專案可追溯性 | 不阻擋本輪 |
| `Q-14` | **F450 數位孿生是否開發** | **A** 不開發（維持 `build` section）<br/>**B** 僅預留接口（架構層定義契約）<br/>**C** 獨立專案開發 | `FLOW-03`、`INT-08/09`、`RISK-06` | **P3** |
| `Q-15` | **是否需要後端 STT / TTS** | **A** 維持瀏覽器原生（現況）<br/>**B** 新增後端語音服務 | `AUD-07f` | P2/P4 |
| `Q-16` | **AI 雙師與教師複核的權限邊界是否需更細化** | **A** 維持現行（`AGENTS.md:262-286`）<br/>**B** 細化為可設定矩陣 | 安全性 | P2 |
| `Q-22` | **Golden Set 對 `FOUR_SIDE_HOVER` 的兩處測試語意不一致**（`RISK-11`） | **A** 統一為「合法型別」（修正 `tests/test_golden_set_center.py:121`）<br/>**B** 統一為「拒絕」（修正 `tests/test_golden_set_contract.py:605-606` 註解）<br/>**C** 維持現狀並在文件註明差異 | Golden Test 可信度；`FOUR_SIDE_HOVER` 與 R07 學員上傳路徑無關（僅存於教師懸浮分析鏈），修正時**不得擴大範圍至 R07 凍結流程** | 不阻擋本輪（R2） |

---

## 3. 需要教師決策的風險處置

| 編號 | 風險 | 等級 | 待決事項 |
| --- | --- | --- | --- |
| `RISK-01` | `VisionModelRecord.evidence` 為 `PROTECT` | **R4** | 是否需在文件層固化「先 `VisionModelRecord` 再 `Evidence`」的刪除順序規範 |
| `RISK-02` | 雙軌視覺系統無同步 | **R3** | 見 `Q-12` |
| `RISK-03` | 8 區塊路徑 404 | **R3** | 見 `Q-09` |
| `RISK-04` | MP12 未 Merge | **R2** | 見 `Q-11` |
| `RISK-05` | 階段成果未回寫 | **R3** | 見 `Q-10` |
| `RISK-06` | F450 數位孿生路徑未確認（有版本、位置不明） | **R3** | 見 `Q-02`（路徑）／`Q-14`（是否開發） |
| `RISK-07` | 測試斷言矛盾 | **R2** | 見 `Q-07` |
| `RISK-08` | 有 id 無路由 | **R1** | 見 `Q-08` |
| `RISK-09` | 154 筆未提交變更 | **R4** | 見 `Q-13` |
| `RISK-10` | 外部依賴源碼不在本倉 | **R2** | 見 `Q-03`／`Q-04` |
| `RISK-11` | Golden Set 對 `FOUR_SIDE_HOVER` 兩處測試語意不一致 | **R2** | 見 `Q-22` |
| `RISK-12` | F450 數位孿生「有版本但路徑未確認」 | **R3** | 本輪新增（教師補充指令 2026-10-12）；見 `Q-02`／`Q-14` |

---

## 4. 技術層面待確認（非教師決策，但需後續查證）

| 編號 | 事項 | 現況 | 查證方式（**不得在本輪執行**） |
| --- | --- | --- | --- |
| `Q-17` | 外部 YOLO `:8765` 是否可啟動 | 契約已知（`vision_snapshot_server.py:154`） | 啟動外部服務後 `GET /api/health` |
| `Q-18` | 外部 RAG `:8770` 是否可啟動且語料完整 | 契約已知（`rag.py:67`） | 啟動外部服務後 `GET /api/rag/health` |
| `Q-19` | Flight Health `:8040` 是否可啟動 | 契約已知（`flight-health/js/config.js:7`） | 啟動 `D:\FDE-Flight-Health-AI` 後 `GET /api/v1` |
| `Q-20` | `demo_active_submissions.PROP_DIRECTION` 綁定的 `sub-ea18f5eb`（28 bytes）是否足以支撐 DEMO 展示 | 已確認存在 | 需教師確認是否保留此 DEMO 模擬綁定 |
| `Q-21` | 模型倉庫 42 筆中有 17 筆 `file_path` 不存在 | 已確認為**事故前既有狀態**（備份 JSON == 現況 JSON） | **繼續暫停**（教師 2026-10-12 明確要求不得執行 `--apply`，後續另行安排獨立驗收與清理任務） |

---

## 5. 與上一輪（R07 清理）的交接狀態

| 項目 | 狀態 |
| --- | --- |
| 上一輪批准的 R07 測試資料清理 | ⏸ **繼續暫停**（教師補充指令 2026-10-12 明確要求：不得執行 `--apply`，不得刪除任何模型、資料集、Evidence 或資料庫紀錄） |
| 執行前 5 項確認 | ✅ 已完成 4 項（備份存在 + SHA256、兩筆 ACTIVE SHA256、DEMO Submission 與綁定完整、40 筆待刪清單與 17 筆缺檔歸屬核驗全數通過） |
| `--apply` 執行 | ⏸ **未執行，且本輪後續不得執行** |
| 後續安排 | 教師另行安排**獨立的驗收與清理任務** |

**執行前確認實際結果**：

| 確認項 | 結果 |
| --- | --- |
| 1. 完整備份存在 | ✅ `demo/backup/r07-cleanup-20261011-080704/`（`demo.sqlite3` 593,920 B SHA256 `e24b89c7…`；`vision_center.json` 64,674 B SHA256 `ba736ce0…`） |
| 2. 兩筆 ACTIVE 及其 SHA256 | ✅ `PROP_20261010_X_accv2_23fd`（`best.pt` SHA256 `9725803a…`）、`HOVER_20261010_X_haccv1_abc8`（`best.pt` SHA256 `13637f26…`） |
| 3. DEMO Submission 與綁定 | ✅ `submissions: 1`、`demo_active_submissions = {"PROP_DIRECTION": "sub-ea18f5eb-a1a5-41f2-ae7d-512ad380f79e"}` |
| 4. 17 筆缺檔模型歸屬 | ✅ 全部 17 筆 `status` 為 `ARCHIVED` / `REJECTED` / `VALIDATED`，且**全部落在已核准的 40 筆待刪清單內** |
| 5. 是否有未核准資料或引用變更 | ✅ 無。`42 = 2 keep + 40 delete`，無未分類項 |

---

## 6. 教師補充指令（2026-10-12）決策請求彙總

以下事項需教師單一回合裁決，裁決後方可解除對應阻擋：

| 請求項 | 對應編號 | 裁決選項 |
| --- | --- | --- |
| F450 數位孿生位置 | `Q-02`、`RISK-06`、`RISK-12` | ① 提供完整專案路徑 ② 明確暫不整合 ③ 維持「僅預留接口」 |
| 成長證據鏈整合方案 | `Q-10`、`INT-01` | A 任務完成即回寫 / B 教師複核後回寫 / C 僅對照表 |
| MP12 整合方案 | `Q-11`、`INT-02` | A Deep Link / B Embed / C API Integration / D 暫不整合 |
| 雙軌視覺系統同步 | `Q-12`、`RISK-02` | A 維持現狀 / B 單向同步 / C 雙向同步 |
| 未提交變更處理 | `Q-13`、`RISK-09` | A 維持 DO_NOT_TOUCH / B 教師審閱後分批提交 / C 建立 checkpoint |
| 官方檢查清單文件化 | `Q-06` | 是 / 否 |
| Golden Set 對 `FOUR_SIDE_HOVER` 語意 | `RISK-11` | 以 `golden_set.py:10`（拒絕）或以 `test_golden_set_contract.py:605-606`（合法型別）為準 |

---

## 7. 待確認事項統計

| 類別 | 數量 |
| --- | --- |
| 未找到實體（`Q-01`–`Q-09`） | 9 |
| 需教師決策的方案選擇（`Q-10`–`Q-16`、`Q-22`） | 8 |
| 技術層面待查證（`Q-17`–`Q-21`） | 5 |
| **合計** | **22** |
| 其中**阻擋後續開發** | `Q-10`、`Q-11`、`Q-14`（3 項） |
| 其中**列為 R4 需教師批准** | `RISK-01`、`RISK-09` |

---

*本文件為唯讀產出，**未選定任何方案**。未修改產品程式、API、頁面、導航、路由、資料表；未 Commit / Push / Merge / Deploy。*
