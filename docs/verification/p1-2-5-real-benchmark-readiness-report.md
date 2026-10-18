# 【P1-2.5 Real Benchmark Readiness Report】

**專案**：FDE-AI-UAS 2.0（分支 `fde-ai-v2.0-dev`，開發目錄 `D:\FDE-AI-UAS-v2.0`）
**任務**：P1-2.5｜PROP Golden Validation Set & Real Benchmark Readiness
**日期**：2026-10-08
**執行原則**：只檢查真實性，不偽造 / 不重標 / 不擅自安裝依賴 / 不進入 P1-3。

---

## 一、核心結論

> **PROP_GOLDEN_SET = BLOCKED（真實樣本不足）**
> **Real Benchmark = BLOCKED（無真實 Golden Set，且受控後端執行環境缺模型依賴）**
> **Decision = BLOCKED**

本輪**只做真實性檢查與程式防護強化**，未執行任何真實 Benchmark、未偽造 PASS、未安裝 ultralytics/torch、未部署、未 commit/push/merge/deploy。

---

## 二、真實性檢查清單（磁碟實際狀態）

| 項目 | 結果 | 說明 |
|---|---|---|
| PROP Golden Set | **BLOCKED** | `validation_sets/prop` 無真實 CW_F/CCW_F/CW_B/CCW_B 標註樣本 |
| Golden Set Version | `PROP_GOLDEN_V1`（尚未成為 Golden） | `frozen=false`、`review_status=BLOCKED_NO_REAL_SAMPLES` |
| Real Images（真實圖片） | **0** | `images/` 僅含 `.gitkeep` |
| Per-Class Count | CW_F=0 / CCW_F=0 / CW_B=0 / CCW_B=0 | 四類皆無人工確認標註 |
| Class Contract（邏輯層） | 宣告 PASS / 資料層 FAIL | manifest 宣告 `["CW_F","CCW_F","CW_B","CCW_B"]` 契約正確，但無真實樣本支撐 |
| Real PROP Model（真實 APPROVED best.pt） | **NOT_AVAILABLE** | 見下方「真實模型」說明 |
| Model Runtime（受控後端 venv 3.13） | **MISSING** | `ultralytics`/`torch` 均未安裝於 `python/envs/default` |
| Ultralytics（受控後端 venv 3.13） | **MISSING** | 未安裝，且依 AGENTS.md §13 不擅自安裝 |
| Torch（受控後端 venv 3.13） | **MISSING** | 同上 |
| System Python 3.14（系統全域） | AVAILABLE | 系統 Python 3.14 **有** ultralytics+torch，但非受控/隔離執行環境，不納入後端部署 |
| Real Benchmark | **NOT_RUN / BLOCKED** | 缺 Golden Set，無從執行 |
| Real Metrics | **PENDING** | 無真實指標可報告 |
| Benchmark Policy | **NOT_CONFIGURED** | 門檻未設定 → 即便有指標也只判定 REVIEW_REQUIRED，不自動 PASS |
| Production | **NOT PERFORMED** | 未觸碰 Production / A06 / Hover |
| A06 | **UNTOUCHED** | 未呼叫、未改寫 |
| Commit / Push / Merge / Deploy | **NOT PERFORMED** | 本輪只改程式與文檔，未提交 |

---

## 三、真實模型（Real PROP Model）說明

- 磁碟上確實存在 `.pt` 檔（共 135 個），**但全部位於 `D:\FDE-AI-UAS-v2.0\.test-temp\` 之下**。
- 這些是測試套件產生的暫存 fixture（`model_registry/prop_direction/PROP_20261006_X_v1/best.pt`、`submissions/.../submission.pt` 等），**並非真實學生經教師 APPROVED_FOR_BENCHMARK 提交的模型**。
- 依《FDE-DEVELOPMENT-CHARTER》規範：學生 `.pt` 僅作附件，禁止 `torch.load` / YOLO 載入 / 推理；此處亦**未載入、未執行**任何 `.pt`。
- 因此 **Real PROP Model = NOT_AVAILABLE（無真實 APPROVED 模型）**。

---

## 四、既有 qualification 舊資料集處置

- `qualification/live_propellers/`：`images/` 為空、`manifest.csv` 僅表頭、`README.md` 描述舊類別 `cw_propeller` / `ccw_propeller`，要求每類 30+ 樣本。
- 舊類別與新 PROP Contract `("CW_F","CCW_F","CW_B","CCW_B")` 嚴格不一致，`PropValidationSet.contract_ok()` 會直接判 False。
- **結論**：舊 qualification 資料集不得冒充新 Golden Set；本輪**未重標、未轉換、未合併**。

---

## 五、程式防護強化（最小修改，符合 AGENTS.md）

為讓「真實就緒度」由程式強制而非人工保證，對 `live_backend/app/benchmark.py` 做了最小強化（不新增功能、不碰 Production/A06/Hover）：

1. **Runtime Gate（執行環境探測）**
   - 新增 `runtime_status()`：以 `importlib.util.find_spec` 探測 `ultralytics`/`torch`，只偵測不安裝。
   - `PropBenchmarkSandbox.__init__` 新增 `runtime_probe` 注入參數（預設 `runtime_status`）。
   - `run()` 在載入模型前先探測；`ready=False` → 直接 `MODEL_LOAD_FAILED`，**絕不執行模型**。
   - 回傳 `runtime_version`（如 `ultralytics=MISSING;torch=MISSING`）供介面顯示。

2. **模型檔案雜湊（真實可重複性）**
   - 新增 `model_file_hash` 欄位；有真實檔案時計算 SHA256，無則 `NOT_AVAILABLE`，**不偽造**。

3. **Golden Set 凍結原則強化**
   - `PropValidationSet.available()` 現要求：`manifest 存在` + `contract_ok()` + `frozen=True` + `review_status=="TEACHER_CONFIRMED"` + `images>0`。
   - 半套（未凍結 / 未確認 / 無樣本）一律 `available()=False`，訓練與 Hard Example 不得回流寫入。
   - 升級走 `PROP_GOLDEN_V2`，永不直接 mutate V1。

4. **manifest.json 治理欄位**
   - 重寫 `validation_sets/prop/manifest.json`，補齊 `validation_set_id / version / class_contract / class_contract_version / image_count / per_class_count / source / review_status / frozen / note`，並標記 `BLOCKED_NO_REAL_SAMPLES`。

5. **前端顯示強化（最小）**
   - `live/live.js` 的 `renderP1Benchmark` 增加四行：`Validation Set（AVAILABLE/NOT AVAILABLE）`、`Runtime（READY/MISSING）`、`Real Model（READY/MISSING）`、`Real Metrics（AVAILABLE/PENDING）`。
   - 不新增按鈕、不新增部署/Hover/重訓邏輯。

---

## 六、測試結果（隔離 venv 執行）

- 執行環境：`C:\Users\admin\.workbuddy-ai\binaries\python\envs\default`（隔離，僅含 starlette 1.0.0 / httpx 0.28.1 / Pillow，未污染系統或專案）。
- 指令：`python -m unittest discover -s tests -p "test_p1_*.py" -v`
- 結果：**Ran 32 tests — OK（0 FAIL）**
  - P1-1 模型提交：11 tests
  - P1-2 Benchmark：13 tests
  - P1-2.5 真實就緒度：8 tests（含：真實磁碟 Golden Set 確認 BLOCKED、runtime 缺失不執行模型、runtime 就緒+可用集才產指標、未凍結/未確認/空圖永不 available、舊類別契約拒絕、測試環境 runtime 缺失）

---

## 七、業務檔案變更清單

| 檔案 | 變更性質 |
|---|---|
| `live_backend/app/benchmark.py` | 增 runtime gate / model hash / 凍結原則 / manifest 治理欄位（最小修改） |
| `live_backend/tests/test_p1_2_benchmark.py` | 注入 `runtime_probe` 使既有 13 測試通過 + 新增 8 個 P1-2.5 測試 |
| `validation_sets/prop/manifest.json` | 重寫為治理格式，標記 `BLOCKED_NO_REAL_SAMPLES` |
| `live/live.js` | `renderP1Benchmark` 增 4 行真實就緒度顯示（最小） |
| `docs/verification/p1-2-5-real-benchmark-readiness-report.md` | 本報告（新增） |

> 未觸碰：`legacy src/`、`student_portal/`、`v1.5C` 穩定分支、正式 GitHub Pages / Cloudflare Worker / Tunnel / 入口網址 / 資料庫 / API Key。

---

## 八、後續待辦（不屬本輪，待用戶確認）

若要解除 BLOCKED，需由用戶/教師提供真實資料並授權：

1. **真實 Golden Set**：由教師收集並人工確認 CW_F/CCW_F/CW_B/CCW_B 四類真實標註樣本，放入 `validation_sets/prop/{images,labels}`，將 `manifest.json` 設 `frozen=true`、`review_status=TEACHER_CONFIRMED`。
2. **真實 APPROVED 模型**：學生經 P1-1 上傳、教師審核為 `APPROVED_FOR_BENCHMARK` 的 `.pt`。
3. **模型執行環境**（需授權）：依 AGENTS.md §13，將 `ultralytics`+`torch` 安裝至受控後端 venv（或確認後端統一改用已具備該環境的 Python 3.14 隔離 venv）前，須先向用戶報告並取得確認。
4. 滿足上述三項後，方可執行「真實 Benchmark」並產出 Real Metrics。

---

**本輪到此停止，不自行進入 P1-3。**
