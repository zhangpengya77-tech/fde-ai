# FDE-AI 2.0｜P6 接棒驗收與兩線准入報告（2026-10-29）

> 本輪性質：**批准繼續隔離驗證，不批准正式部署**。僅執行裁決指定的 1–9 項。
> 未修改正式 v1.5C／8022／8770／Pages／Worker／Tunnel／DNS／正式 DB／Registry；未 Push／Merge／Deploy。

---

## 0. 裁決承接

| 項目 | 結論 |
| --- | --- |
| 繼續隔離驗證 | **批准（本輪執行）** |
| 正式部署 | **不批准** |
| 兩線拆分 | 已依裁決拆分為「平台安全線」與「YOLO 模型線」 |
| 平台安全線可先做 HTTPS 預發布 | **可以**（使用隔離測試資料；不得宣稱真實槳葉辨識通過） |

---

## 1. 測試總數核對與 80／88 矛盾修正

### 1.1 原始執行紀錄（本輪實跑，逐模組獨立行程）

| 套件 | 指令 | 原始輸出 | 結果 |
| --- | --- | --- | --- |
| P6 Assertion | `python live_backend/_run_unittests.py test_p6_assertion_security` | `Ran 13 tests in 5.567s / OK` | **13/13 PASS** |
| P6 Gateway | `python live_backend/_run_unittests.py test_p6_gateway_strip` | `Ran 4 tests in 1.368s / OK` | **4/4 PASS** |
| P6 Phase-4 `test_vision_api` | 同上 | `Ran 17 tests in 13.949s / OK` | **17/17 PASS** |
| P6 Phase-4 `test_teacher_vision_center` | 同上 | `Ran 22 tests in 26.990s / OK` | **22/22 PASS** |
| P6 Phase-4 `test_vision_center` | 同上 | `Ran 41 tests in 26.771s / OK` | **41/41 PASS** |
| 主樹 CW/CCW 映射 | `python live_backend/_run_unittests.py test_prop_direction_cw_ccw` | `Ran 6 tests in 0.001s / OK` | **6/6 PASS** |

原始日誌留存：`ops/launch-20261029/evidence/`（`p6-test-assertion.log`、`p6-test-gateway.log`、`main-test-cwccw.log`）。

### 1.2 80／88 矛盾的來源與修正

- **正確數字：P6 Phase-4 回歸 = 17 + 22 + 41 = 80/80。**
- 上一輪誤寫「17+22+49=80（含本輪新增 6 項）」是**三重錯誤**：
  1. `49` 是**主工作樹** `test_vision_center.py` 的測試數；**P6 工作樹**該檔是 41 項（`grep -c "def test_"`：main=49、P6=41）。17+22+49 實為 88，與 80 不符。
  2. `+6` 的 CW/CCW 測試位於**主樹獨立檔** `test_prop_direction_cw_ccw.py`，不屬於 P6 Phase-4 回歸。
  3. 因此 80 與 88 是兩棵樹混算；現已分離：**P6 回歸 80/80**、**主樹 CW/CCW 6/6**，互不重疊。

### 1.3 一次環境性假錯誤（已排除，非真實失敗）

首次把三個模組放在**同一個 bash 呼叫**的 for 迴圈執行時，`test_vision_api` 出現 `errors=3`。查證為沙箱 bulk-delete 守衛在 `tearDown` 清理 `TemporaryDirectory` 時觸發（`SystemExit: 1` @ `_check_bulk_delete_guard`，累計刪除 > 50）。**改為逐模組獨立呼叫後全部 OK**，與程式碼無關。

---

## 2. 正式安全模式 fail-closed 確認（含本輪硬化）

### 2.1 檢查結論

| 檢查點 | 主工作樹（Phase-4 舊版） | P6 工作樹（正式安全候選） |
| --- | --- | --- |
| 無密鑰時行為 | ⚠️ **自動放行 `unsigned_legacy`**（`verify` 第 86–88 行 `return True, unsigned_legacy`） | ✅ **fail closed**（`secret_not_configured`） |
| `FDE_ALLOW_UNSIGNED_LEGACY` 閘門 | 無此概念 | ✅ 僅嚴格等於 `"1"` 才生效 |
| 身分來源 | ⚠️ 取自可偽造 `X-FDE-*` 標頭 | ✅ 只取自簽章 claims |
| 部署腳本是否設定該旗標 | — | ✅ **零處設定**（全樹 grep 僅 P6 程式碼與測試引用） |

### 2.2 本輪發現並修復的漏洞（僅改 P6）

原 P6 的 `legacy_allowed()` 只檢查旗標，導致「**已設密鑰（正式）＋ 誤設旗標**」時仍會放行未簽章請求——這正是「意外啟用」風險。

**硬化**：`legacy_allowed()` 改為「**沒有密鑰** 且 旗標 == `"1"`」才成立。正式部署必然設定 `FDE_INTERNAL_SHARED_SECRET`，因此**只要密鑰存在，相容模式永遠不可能被啟用**，正式模式恆 fail-closed。

```python
def legacy_allowed() -> bool:
    if secret():
        return False
    return os.environ.get(LEGACY_ENV_FLAG, "") == "1"
```

同步強化測試 `test_2`：新增斷言「已設密鑰 + 旗標=1 → 仍回 `assertion_required`」。重跑 **13/13 OK**、Gateway **4/4 OK**、`test_vision_api` **17/17 OK**（無回歸）。

### 2.3 主工作樹的已知缺口（本輪刻意不改，遵守「後續修改只在 P6」）

主樹 `internal_auth.py` 仍是 Phase-4 舊版：**無密鑰時自動放行**、且以可偽造標頭取身分。其 17 項教師測試正是靠此行為（`test_vision_api.py:72` 只送 `X-FDE-Role` 標頭、無簽章）。若此刻強改主樹為 fail-closed 會直接打破這 17 項，且違反「後續修改只在 P6」。**處置：正式上線前必須以 P6 版 `internal_auth.py` 取代主樹舊版**（列為平台安全線的正式部署前置項）。

---

## 3. 兩棵樹修改範圍核實（task 3）

### 3.1 P6 工作樹

- 分支 `codex/p6-security-preprod`，HEAD `98523d6`，**20 項未提交**（全部為 P6 實作，未 commit）。
- **本輪修改僅 2 檔**：
  - `live_backend/app/internal_auth.py` → SHA-256 `04b7ea9585012a59…`
  - `live_backend/tests/test_p6_assertion_security.py` → SHA-256 `be04ad419cb1f04b…`

### 3.2 主工作樹（CW/CCW 映射的實際修改與授權依據）

- 分支 `feat/m02-simulator-entry`，HEAD `06481159`，**72 項未提交**（含先前多階段累積，**絕不整包提交**）。
- **本輪（前段）對主樹的唯一新增 = CW/CCW 映射**：
  - `live_backend/app/vision_center.py` 第 2559–2573 行（`PROP_DIRECTION_TO_CW_CCW` + `map_prop_to_direction`）。HEAD 版本無此符號（`grep -c` = 0），確認本輪新增。
  - `live_backend/tests/test_prop_direction_cw_ccw.py`（新檔，2303 bytes，6 測試）。
- **授權依據**：前次接棒指令明文允許「在隔離測試中明確建立 CW／CCW 對應規則」。該函式為**純顯示收斂**（四類 → 兩類），不改 Registry、不改品質門檻、不改模型行為。
- **澄清**：`vision_center.py` 的 `git diff` 顯示 +1046/−31 行，那是**先前 R07／模型健康等階段的累積未提交變更**，非本輪產生；本輪只加了上述 ~15 行。
- **後續約束**：自本輪起，所有新修改**只在 P6 工作樹**進行；主樹不再新增改動。

---

## 4. 12/12 YOLO 測試所用圖片是否為真實槳葉（task 4）

| 項目 | 內容 |
| --- | --- |
| 使用圖片 | `ops/launch-20261028/test-images/prop_real_01.jpg` |
| SHA-256 | `7f1515e42548ae2bca93ab4f2621a56ae80b7d604a07adf2aa5d31cbf57a76dc` |
| 大小 | 329,048 bytes |
| 實看內容 | **「首屆低空經濟創業者年會」會場人像照**（男子比讚合影）——**不是槳葉** |
| 第二張 `prop_real_02.jpg` | SHA-256 `b323800d4ceadde8…`；實看為幼兒園科學活動照，**亦非槳葉** |
| 使用模型 | `02995b79…`（Model B，4 類，mAP50=0.35139） |
| `active_before` | `[]`（測試前無 ACTIVE，ACTIVE 未被改動） |

**結論**：12/12 PASS 證明的是**通道可用**（上傳 → 佇列 → 真實 YOLO 推論 → 狀態不變），**不構成螺旋槳辨識驗收通過**。對非槳葉圖回 `NO_DETECTION` 是如實行為，不可解讀為槳葉辨識成功。

---

## 5. 四類模型 provenance（task 5）——修正「未訓練」誤判

> **重要修正**：上一輪以 `train_args=None` 推論「未訓練」是**錯誤的**。本輪直接讀 checkpoint（`torch.load`，唯讀自有 demo 模型），兩組權重**都確實訓練過**。

| model_id | status | 權重 SHA-256 | 大小 | 真實類別（checkpoint） | nc | 訓練紀錄 | mAP50 | P | R | 日期 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PROP_20261023_DEMO-A_v1 | DEMO_IMPORTED | `2ae4dac3c576a060…` | 6,252,849 | CCE-F, CCF-b, CCW-F, CCW-B, CW-F, CW-B | **6**（含錯字） | epochs=30, yolov8n, CPU, `train_76ad…` | **0.11746** | 0.00421 | 0.65 | 2026-10-11 |
| PROP_20261023_X_v1 | REJECTED | `2ae4dac3c576a060…`（同檔） | 6,252,849 | 同上 6 類 | 6 | 同上 | 0.11746 | 0.00421 | 0.65 | 2026-10-11 |
| PROP_20261024_DEMO-A_v1 | REVIEW_REQUIRED | `02995b79d6608bb0…` | 5,460,378 | **CW_F, CCW_F, CW_B, CCW_B** | **4**（乾淨） | epochs=50, resume, GPU, `train_b495…` | **0.35139** | 0.71888 | 0.33705 | 2026-10-24 |
| PROP_20261024_X_v1 | REVIEW_REQUIRED | `02995b79d6608bb0…`（同檔） | 5,460,378 | 同上 4 類 | 4 | 同上 | 0.35139 | 0.71888 | 0.33705 | 2026-10-24 |

**核實要點**
1. **僅 2 個不同權重檔**（`2ae4dac3…`、`02995b79…`）；4 筆 Registry 是「學員提交（DEMO-A）」＋「教師重傳（X）」共用同權重。
2. **確有訓練痕跡**：完整 `train_args`（含 data.yaml 路徑、epochs、batch、imgsz、device、日期）。`2ae4dac3` 由 `C:\Users\tammy\OneDrive\…` 訓練、`02995b79` 由 `C:\Users\admin\Documents\FDE-AI-YOLO\…` 訓練。
3. **獨立測試指標**：`evaluation_status = NOT_EVALUATED`、`metrics = {}`。表中 mAP50 是 **checkpoint 內訓練期驗證值**（`train_metrics["metrics/mAP50(B)"]`），**不是**獨立留出集評估。
4. **品質判定**：兩者 mAP50（0.117 / 0.351）**均低於 0.5 門檻** → `LOW_QUALITY`；`2ae4dac3` 的精確率僅 0.0042，實務不可用。
5. **CW/CCW 標籤語義**：四類契約為 `CW_F`(順時針·前槳)、`CCW_F`(逆時針·前槳)、`CW_B`(順時針·後槳)、`CCW_B`(逆時針·後槳)；對應規則 `CW_F/CW_B→CW`、`CCW_F/CCW_B→CCW`（`map_prop_to_direction`，6/6 單測）。
6. **類別錯字模型**：`2ae4dac3` 實為 6 類且含 `CCE-F`/`CCF-b` 錯字（應為 `CCW-F`/`CCW-B`），故 `PROP_20261023_X_v1` 被標 `model_class_names_mismatch` 且 `REJECTED`。

**YOLO 模型線的真正阻斷（非「未訓練」）**：mAP50 < 0.5 品質門檻、無獨立留出集評估、無真實槳葉測試影像、其中一組為 6 類錯字模型。

---

## 6. 保留四類契約（task 6）

- `PROP_CLASSES = ("CW_F","CCW_F","CW_B","CCW_B")` **未改動**；`PROP_RULE_v1` 未改。
- **正式 Registry 未修改**：demo_registry `9ffa6cb3…`、default_registry `7b3f674f…` 前後一致。
- **品質門檻未降低**：`map50_threshold` 仍預設 0.5；`LOW_QUALITY` 判定照舊。

---

## 7. 兩條獨立准入線（task 7 / 8）

### 7.1 平台安全線（登入、班級隔離、Gateway Assertion、HTTPS、教師覆核與上傳）

| 項目 | 狀態 |
| --- | --- |
| Assertion envelope（v1，綁 method/path/body_sha256/jti，TTL≤60s） | ✅ 13/13 |
| 跨程序 replay ledger（SQLite `BEGIN IMMEDIATE` + 唯一插入） | ✅ 含兩程序重放測試 |
| Gateway 剝離 `X-FDE-*`／Cookie／不可信轉送標頭 | ✅ 4/4 |
| 無密鑰 fail-closed、旗標不可在正式模式啟用 | ✅ 本輪硬化後確認 |
| 班級隔離（跨班/未知 id/Live 不可用 fail-closed） | ✅ 前階段 8/8 + Phase-4 80/80 |
| 正式部署前置：以 P6 版 `internal_auth` 取代主樹舊版 | ⏳ 待辦（見 §2.3） |

**可先行**：以隔離測試資料完成 HTTPS 預發布驗收（不依賴 YOLO 模型合格）。**但不得宣稱真實槳葉辨識已通過。**

### 7.2 YOLO 模型線（真實槳葉資料、模型品質、教師驗證、隔離 ACTIVE、前端辨識）

| 項目 | 狀態 |
| --- | --- |
| 四類契約與 CW/CCW 對應規則 | ✅ 規則已建立（6/6） |
| 真實槳葉測試影像 | ❌ **全環境無真實槳葉照**（`prop_real_*` 為人像/活動照；golden_set 為 64-byte 佔位） |
| 模型品質 ≥ 0.5 | ❌ mAP50 0.117 / 0.351，均 LOW_QUALITY |
| 獨立留出集評估 | ❌ `NOT_EVALUATED`、`metrics={}` |
| 教師真實 YOLO 圖片驗證 | ⛔ **BLOCKED**（無真實槳葉圖） |
| 隔離 ACTIVE / 前端辨識 | ⛔ 無合格候選，無從啟用 |

---

## 8. 最小差異、測試證據、剩餘阻斷、下一次需批准操作（task 9）

### 8.1 本輪最小差異

| 樹 | 檔案 | 變更 | SHA-256 |
| --- | --- | --- | --- |
| P6 | `live_backend/app/internal_auth.py` | `legacy_allowed()` 加「無密鑰」前置條件；docstring 更新 | `04b7ea9585012a59…` |
| P6 | `live_backend/tests/test_p6_assertion_security.py` | `test_2` 修正 legacy 前置 + 新增「正式模式誤設旗標仍拒絕」斷言 | `be04ad419cb1f04b…` |
| 主 | `live_backend/app/vision_center.py` | +CW/CCW 映射（2559–2573，前段） | （併入既有未提交） |
| 主 | `live_backend/tests/test_prop_direction_cw_ccw.py` | 新檔 6 測試（前段） | 2303 bytes |

### 8.2 測試證據

13/13、4/4、80/80（17+22+41）、6/6 全綠；原始日誌見 §1.1。`test_vision_api` 硬化後重跑 17/17（無回歸）。

### 8.3 剩餘阻斷

1. **真實槳葉影像缺失** → 教師需提供 CW/CCW 四軸機俯照（≥2 張/類）。
2. **模型品質不足**（mAP50 0.117/0.351 < 0.5）＋ **無獨立評估** → 需重訓並產出留出集 mAP50。
3. **6 類錯字模型**（`2ae4dac3…`）不可用於四類契約。
4. **主樹 `internal_auth` 仍非 fail-closed** → 正式部署前必須移植 P6 版。
5. **HTTPS 預發布尚未實作**（Tunnel／DNS 屬禁止修改範圍）。

### 8.4 下一次需要批准的具體操作

| # | 操作 | 為何需要批准 |
| --- | --- | --- |
| A | 在**隔離環境**架設 HTTPS 反向代理 + 自簽/測試憑證，跑平台安全線預發布驗收 | 涉及新增監聽與憑證，需授權 |
| B | 以 P6 版 `internal_auth.py` **取代主樹舊版**（正式部署前置） | 會改動主樹行為，需授權 |
| C | 將 CW/CCW 映射同步進 **P6 工作樹**（符合「後續修改只在 P6」） | 需授權是否同步 |
| D | 接收教師真實槳葉圖 + 重訓模型後，重跑 YOLO 模型線端到端 | 需教師提供素材 |

---

## 9. 正式環境未修改確認

| 資源 | SHA-256（前 16） | 對照 P-16 `after` |
| --- | --- | --- |
| prod_db `student_portal/db.sqlite3` | `1fa462fef825980e` | ✅ 一致 |
| demo_db `demo/runtime/db/demo.sqlite3` | `fdaf180529979bb8` | ✅ 一致 |
| demo_registry | `9ffa6cb305f40b7b` | ✅ 一致 |
| default_registry | `7b3f674fbca0e6a1` | ✅ 一致 |

未 commit／未 push／未 merge／未 deploy；未動 v1.5C／8022／8770／Pages／Worker／Tunnel／DNS。

---

## 10. 結論

- **平台安全線：READY（隔離）**，可在隔離環境先行 HTTPS 預發布驗收；正式部署仍需 §2.3 前置與 §8.4-A/B 授權。
- **YOLO 模型線：BLOCKED**，阻斷於真實槳葉資料、模型品質與獨立評估；**不得宣稱真實槳葉辨識通過**。
- 已修正上一輪「未訓練」與「80/88」兩處錯誤，並修復一個正式模式意外啟用的實質漏洞（P6）。
- **完成後停止，等待批准。**
