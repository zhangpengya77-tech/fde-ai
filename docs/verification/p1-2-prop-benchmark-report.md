# P1-2 PROP Benchmark MVP｜完成報告

**日期**：2026-10-07
**分支**：`fde-ai-v2.0-dev` @ `D:\FDE-AI-UAS-v2.0`
**前置**：P1-1 已鎖定（AUTOMATED PASS 11/11），本輪未回頭修改 P1-1 邏輯。

## 本輪目標

APPROVED_FOR_BENCHMARK → 教師點擊「驗證模型」→ Backend Sandbox Benchmark → PROP Benchmark Report → 教師看到 PASS / FAIL。

## 完成判定（兩級標準）

- **AUTOMATED PASS**：P1-2 定向測試 13/13；P1-1 回歸 11/11；合計 24/24 OK。
- **REAL DEVICE PASS**：**PENDING**（未於真實瀏覽器 / iPhone 實機驗收）。
- **人工 iPhone 驗收**：PENDING。

## 安全邊界

- P1-1 上傳階段仍**禁止執行模型**；僅當 `model_status = APPROVED_FOR_BENCHMARK` 且教師主動點擊「開始驗證」才進入 Sandbox。
- Sandbox 完全隔離：不自動啟用、不自動部署、不覆寫 Production、不修改 A06。
- 學生身分呼叫 Benchmark 回傳 403；非 APPROVED_FOR_BENCHMARK 回傳 409 `invalid_benchmark_stage`。

## PROP Class Contract

嚴格契約（含順序，順序即模型索引）：`CW_F` / `CCW_F` / `CW_B` / `CCW_B`。
不符者一律 `INCOMPATIBLE_CLASSES`；舊類別（`cw_propeller` / `ccw_propeller` / `无人机` / `motor` 等）一律不通過，不冒充 PASS。

## Benchmark 狀態機

`PENDING`、`RUNNING`、`PASS`、`FAIL`、`REVIEW_REQUIRED`、`INCOMPATIBLE_CLASSES`、`MODEL_LOAD_FAILED`、`WAITING_FOR_GOLDEN_SET`、`ERROR`。
**不含** `PRODUCTION` / `ACTIVE` / `DEPLOYED`。

## Benchmark Policy

`PROP_BENCHMARK_POLICY`（min_precision / min_recall / min_map50）預設為 `NOT_CONFIGURED`。
門檻未設定時**顯示指標但不自動判定 PASS**，狀態為 `REVIEW_REQUIRED`；未自行發明 90% 等教學標準。

## Golden Validation Set

建立最小介面：`validation_sets/prop/manifest.json` + `images/` + `labels/`。
`available()` 判定需 manifest 存在且 `images/` 內含樣本（忽略 `.gitkeep`）。
目前 images 為空 → **不可用**，系統回傳 `WAITING_FOR_GOLDEN_SET`，**不偽造 Benchmark PASS**。

## 定向測試驗證（9 項 + 4 項加測）

| # | 項目 | 結果 |
|---|---|---|
| 1 | 只有 APPROVED_FOR_BENCHMARK 才能啟動驗證 | PASS（409；REJECTED 亦 409；學生 403） |
| 2 | 錯誤類別 → INCOMPATIBLE_CLASSES | PASS（舊類別 `cw_propeller` / `无人机` 皆擋） |
| 3 | 正確 PROP 類別 → 通過 Contract Check | PASS |
| 4 | 模型載入失敗 → MODEL_LOAD_FAILED | PASS |
| 5 | 沒有 Golden Set → WAITING_FOR_GOLDEN_SET | PASS（metrics 為空，不偽造 PASS） |
| 6 | 有測試集時能保存 metrics | PASS（precision / recall / map50 / map50-95 / inference_time_ms） |
| 7 | Benchmark 不改變 Production | PASS（model_status 維持 APPROVED_FOR_BENCHMARK） |
| 8 | Benchmark 不呼叫 A06 | PASS（回應無 a06 / deploy / production） |
| 9 | 不會碰 Hover | PASS（僅 PROP 契約與 PROP 驗證集版本） |
| + | Policy 未設定 → REVIEW_REQUIRED；設定後 PASS / FAIL | PASS |
| + | 同一 submission 可重複 Benchmark 並保留歷史 | PASS |

## 業務檔案異動（本輪）

| 檔案 | 異動 |
|---|---|
| `live_backend/app/benchmark.py` | **新增**：BenchmarkStatus / BenchmarkPolicy / BenchmarkRecord / PropValidationSet / PropBenchmarkSandbox（類別契約檢查 + Sandbox Benchmark + 歷史） |
| `live_backend/app/sessions.py` | 新增 `record_model_benchmark`（寫回既有 submission，不改 model_status） |
| `live_backend/app/main.py` | import、`benchmark_sandbox` 參數、`training_model_submission_benchmark`(POST)、`training_model_submission_benchmarks`(GET)、2 條路由 |
| `live_backend/tests/test_p1_2_benchmark.py` | **新增**：13 項定向測試 |
| `live/index.html` | 教師卡改為「審核與驗證」，含【模型驗證】說明 |
| `live/live.js` | 新增 `startP1Benchmark` / `fetchP1Benchmarks` / `renderP1Benchmark`；教師提交項新增【模型驗證】區塊與綁定 |
| `live/live.css` | 新增 `.p1-benchmark` 等樣式 |
| `validation_sets/prop/manifest.json` + `images/.gitkeep` + `labels/.gitkeep` | **新增**：最小標準驗證集介面（目前無樣本） |

## 未實作（本輪明確排除）

Production、Deploy、ACTIVE、Rollback、Hover Benchmark、ROI、Motor、GPS、Retrain、Hard Example Pool、Dataset Upgrade、Model Promotion、Production Flywheel。

## 保護清單（UNTOUCHED）

v1.5C（絕對唯讀）、Flight Health、MP-12、Student Live Coach、General AI、RAG、A06、Vision Model Center frozen path、Task08。

## 已知限制（誠實揭露）

- 本環境**未安裝 ultralytics / torch**（依依賴規則未經批准不安裝）。真實 `.pt` 載入與 `model.val()` 指標運算**尚未於真實環境執行**；載入邏輯以注入載入器驗證，預設載入器採延遲匯入，失敗即 `MODEL_LOAD_FAILED`。
- 真實 Golden Set 尚未建立 → 真實 Benchmark 決策為 `WAITING_FOR_GOLDEN_SET`，指標 PENDING。
- 前端【模型驗證】區塊已實作並通過語法檢查，但**未經瀏覽器 / iPhone 實機驗收**。

## Git

Commit / Push / Merge / Deploy：**NOT PERFORMED**。
