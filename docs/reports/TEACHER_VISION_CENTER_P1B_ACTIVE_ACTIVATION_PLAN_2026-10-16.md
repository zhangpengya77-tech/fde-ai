# 教師模型中心｜P1-B 正式 ACTIVE 啟用條件方案（設計，待教師核准）

- 日期：2026-10-16
- 範圍：**純設計文件**。本輪**未修改任何 ACTIVE 核心閘門**、未新增 migration、未改資料模型。
- 對應教師指令：三、P1「**本輪不得自行修改 ACTIVE 核心閘門。請另外提出正式 ACTIVE 啟用條件方案，包含四類槳葉方向的驗證標準、後端強制檢查及回滾策略，等待教師核准後再實作。**」
- 前置報告：`TEACHER_VISION_CENTER_SAFETY_AUDIT_2026-10-16.md`（風險 R1）

---

## 0. 現況事實（核驗後確認，附程式位置）

| 項目 | 現況 | 位置 |
| --- | --- | --- |
| `VALIDATED` 如何產生 | 入庫當下由**結構驗證**設定：`task == "detect"` ＋ `class_names == ['CW_F','CCW_F','CW_B','CCW_B']` ＋ `smoke_inference is True`（64×64 空白圖跑一次） | `live_backend/app/vision_center.py:387-398` |
| 是否看真實圖片 | **完全不看**。結構驗證與真實照片無關 | 同上 |
| ACTIVE 啟用閘門（Live） | `validation_status != "VALIDATED" or status == "REJECTED"` → 拒絕 | `vision_center.py:445` |
| ACTIVE 啟用閘門（Django） | `can_activate = validation_status == "VALIDATED" and status != "REJECTED"` | `views.py:2957` |
| 模型紀錄層閘門 | `active_blocked_reason()` 四條件：非 DEMO_TEST_ONLY、完整性正常、`VALIDATED`、`review_status == CANDIDATE` | `models.py:907` |
| 圖片驗證 | `validate_image_with_model()` 唯讀，**不碰 ACTIVE、不改狀態** | `vision_center.py:203` |
| DEMO 模擬可否成 ACTIVE | **不可能**。只寫 `submissions[].demo_active`，不進 `models[]` | `vision_center.py:517` |

**核心問題（R1）**：目前「通過結構驗證」＝可啟用。教師若看到「已通過驗證」字樣，可能誤解為「真實辨識品質已通過」。本輪已在畫面揭露（P1 前端），但**閘門本身未動**。

---

## 1. 四類槳葉方向驗證標準（PROP_DIRECTION）

### 1.1 類別與任務契約（不可變）

```
PROP_CLASSES = ("CW_F", "CCW_F", "CW_B", "CCW_B")   # 順時針正面/逆時針正面/順時針背面/逆時針背面
PROP_RULE_VERSION = "PROP_RULE_v1"
```

機位期望值（`evaluate_prop`，`vision_center.py:816-819`）：

| 機位 | 期望類別 | 象限 |
| --- | --- | --- |
| M1 | CCW_F | front_right |
| M2 | CCW_F | rear_left |
| M3 | CW_F | front_left |
| M4 | CW_F | rear_right |

> 注意：機位（M1–M4）是**畫面象限**判定，不是模型類別。四類槳葉方向驗證標準針對的是**四個模型輸出類別**，與機位無關。

### 1.2 建議驗證標準（門檻值待教師核定）

一筆「有效真實圖片驗證證據」的定義：

1. `evidence_source == "REAL_INFERENCE"`（由 Live Backend 實際載入 `.pt` 推論；**DEMO 模擬一律排除**）。
2. 教師於驗證時**提供了標註類別**（`expected_class` 非空）。
3. `verdict.decision == "MATCH"`（預測類別 == 教師標註類別）。
4. `verdict.predicted_confidence >= confidence_threshold`（建議 0.5，與規則引擎一致）。

模型達到「可啟用」的建議門檻：

| 代號 | 條件 | 建議值 | 說明 |
| --- | --- | --- | --- |
| E1 | 四個類別**各自**的有效證據數 | ≥ 3 筆／類別 | 避免只驗一類就啟用 |
| E2 | 有效證據總數 | ≥ 12 筆 | 4 類 × 3 |
| E3 | 類別覆蓋 | 4／4 類皆有 ≥1 筆 | 禁止缺類 |
| E4 | 最近一筆證據 | 必須為 `MATCH`（不得停在 NG） | 避免「驗過但最後一次失敗仍可啟用」 |
| E5 | 未解決 NG 數（該模型） | ≤ 1 筆且不得為最近 3 筆 | 容忍個別誤判，但近期不得連續失敗 |
| E6 | 證據時效 | 最近 30 天內至少 E2 的一半 | 避免用過期證據啟用 |
| E7 | 結構驗證 | `validation_status == "VALIDATED"` | 沿用既有，不弱化 |

> 門檻值（3／12／30 天／E5 容忍數）為**建議值**，請教師核定後再實作。

### 1.3 明確的「不得」條款（寫入實作規格）

- 不得把 `VALIDATED` 當成真實辨識已通過。
- 不得把 DEMO 模擬結果（`evidence_source != "REAL_INFERENCE"`）計入任何一項。
- 不得在證據不足時，以「管理員覆寫」方式靜默啟用（若需例外，必須留下 `override_by`／`override_reason`／`override_at` 稽核欄位，且教師畫面明示）。
- 不得因新增閘門而移除既有檢查（fail-closed 疊加，不替換）。

---

## 2. 後端強制檢查設計（實作階段，需教師授權）

### 2.1 檢查點（三層，全部 fail-closed）

| 層 | 位置 | 新增內容 | 風險等級 |
| --- | --- | --- | --- |
| L1 模型紀錄層 | `student_portal/learning/models.py::VisionModelRecord.active_blocked_reason()` | 新增第 5 條件：`image_evidence_satisfied` | 受保護核心 → **需授權** |
| L2 視圖層 | `views.py::_vision_model_row` 的 `can_activate` ＋ `teacher_vision_center_activate` | 同上條件；按鈕 disable ＋ 後端二次檢查 | 需授權 |
| L3 推論服務層 | `live_backend/app/vision_center.py::activate_model()` | 新增閘門（讀取持久化證據） | **受保護核心 → 需授權** |

### 2.2 開關與相容性

```python
# 建議（僅設計，未實作）
FDE_VISION_REQUIRE_IMAGE_EVIDENCE = "0" | "1"   # 預設 "0"（關閉）＝與現況完全相容
```

- 預設關閉 → 部署當下行為與現況 100% 相同，零回歸風險。
- 教師核准並驗證後，於 DEMO 環境設 `"1"` 觀察，再決定是否於正式環境開啟。
- 閘門開啟時，`activate_model()` 回傳 `ValueError("image_evidence_required")`，並在 `activation.blocked_reason` 帶出具體缺口（例：`缺 CCW_B 2 筆`）。

### 2.3 證據來源（依賴 P2 的持久化）

目前教師驗證紀錄**只存在 Django session（上限 20 筆）**，重登即消失 → **無法作為啟用依據**。
因此 L3 閘門必須先有**持久化證據來源**（見 P2 設計的 C 類項目）。在證據持久化完成前，L3 閘門**不可開啟**。

**建議實作順序**：
1. （P2-C）持久化教師驗證證據。
2. （本方案 L1/L2）唯讀計算「是否滿足 E1–E7」並在畫面呈現。
3. 教師以 DEMO 環境驗證門檻合理性。
4. （L3）開啟後端強制閘門，預設仍為關閉，由教師決定正式環境是否開啟。

---

## 3. 回滾策略

### 3.1 既有回滾契約（保留，不變）

`rollback_model()`（`vision_center.py:299`）：「還原**最近一次被 ARCHIVED 的 VALIDATED 版本**」。
- 現行 ACTIVE 被 ARCHIVED 而非刪除 → 回滾本身可逆。
- 無可還原版本時**不動 ACTIVE 指標**並拋錯 → 失敗的交換不會讓任務失去模型。

### 3.2 新增閘門下的回滾強化（建議）

| 情境 | 建議行為 |
| --- | --- |
| 啟用成功 | `activation` 事件記錄當時的證據快照（`evidence_snapshot`：E1–E7 實測值 ＋ 證據 id 清單） |
| 教師回滾 | 沿用既有契約；額外將「被回滾的模型」標記 `evidence_invalidated_at`，避免再次被無證據啟用 |
| 閘門開啟後，舊 ACTIVE 證據不足 | **不強制下架**（避免中斷教學）；僅在教師畫面標示「目前 ACTIVE 尚未滿足新版啟用標準」，由教師決定是否回滾 |
| 回滾失敗 | 維持既有 fail-closed：不動指標、拋錯、畫面明示 |

### 3.3 回滾不可破壞的既有不變式

1. 任何時候任務不得沒有 ACTIVE（除從未啟用過）。
2. 回滾只改變 `models[]` 的 `status`／時間戳，不刪檔。
3. 回滾不得寫入 DEMO 共用 store（隔離驗收環境見 P0）。

---

## 4. 風險與影響評估

| 風險 | 等級 | 緩解 |
| --- | --- | --- |
| 新增閘門導致教師「無法啟用」而中斷教學 | 中 | 預設關閉 ＋ 分階段開啟 ＋ 明示缺口 |
| 閘門讀取證據來源失敗 | 中 | fail-closed 但**僅在閘門開啟時**；關閉時零影響 |
| 門檻值訂得過嚴，教學現場難以達成 | 中 | 門檻值由教師核定；先於 DEMO 觀察 |
| 誤改受保護核心 | 高 | 本輪不動碼；實作需教師**逐項明確授權** |
| 教師誤把結構驗證當辨識通過 | 中 | 本輪已在前端揭露（P1）；閘門開啟後可強制阻擋 |

---

## 5. 待教師裁決清單

1. 是否核准 E1–E7 門檻值（或指定替代值）。
2. 是否核准「例外覆寫」機制（含稽核欄位），或完全禁止覆寫。
3. 是否核准後端三層檢查的實作（L1／L2／L3）。
4. L3 閘門開啟的前置條件是否同意為「P2 證據持久化完成」。
5. 正式環境是否開啟閘門，以及開啟時程。

> **本輪未實作任何一項。** 待教師核准後另行開工。
