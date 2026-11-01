# FDE-AI 2.0 收尾｜YOLO 槳葉 CW／CCW 與靜態公開入口 — 接棒驗收報告

**日期**：2026-10-29
**指令**：@long-text 接棒指令（YOLO 槳葉 CW／CCW 與靜態公開入口）
**結論先行**：P6 安全契約 ✅ 已完成並實測通過；靜態公開站 ✅ 已上線且合規；CW／CCW 對應規則 ✅ 已建立並單測通過；**教師圖片驗證 + CW／CCW 端到端 ⛔ BLOCKED**（無真實槳葉照片、模型未訓練、模型為四類非兩類）；正式環境零觸及。

---

## 0. 執行摘要

| 項目 | 狀態 | 證據 |
| --- | --- | --- |
| P6 安全契約（assertion envelope + replay ledger + 閘道剝離） | ✅ READY（隔離工作樹） | 13 + 4 P6 測試 + 80 Phase-4 回歸全過 |
| 靜態公開站 | ✅ 已上線且合規 | HTTP 200、來源乾淨、離線文案相符 |
| CW／CCW 對應規則 | ✅ 已建立並單測 | 6 項單測全過 |
| 學員 best.pt 上傳閉環（機制） | ✅ 已在 Phase-4 驗證 | VisionCohortGuardTests 8/8、預檢 7 惡意拒絕 |
| 教師圖片驗證（真實 YOLO） | ⛔ BLOCKED | 無真實槳葉照片 |
| CW／CCW 端到端驗收 | ⛔ BLOCKED | 模型未訓練 + 四類非兩類 |
| 正式環境完整性 | ✅ 零觸及 | 4 資源指紋與 P-16 after 完全一致 |

---

## 1. 工作樹核實（只讀，無衝突）

| 工作樹 | Branch | HEAD | dirty | 備註 |
| --- | --- | --- | --- | --- |
| `D:\FDE-AI-UAS-v2.0`（主） | `feat/m02-simulator-entry` | — | ~70 | Phase-4 未提交 + 本輪分析腳本/規則 |
| `D:\FDE-AI-UAS-v2.0-p3h-local-backend` | — | — | — | 未動 |
| `D:\FDE-AI-UAS-v2.0-p6-security-preprod` | `codex/p6-security-preprod` | `98523d6` | 20 | **P6 安全實作已完成（本輪核實）** |
| `D:\FDE-AI-public-pages` | `gh-pages` | `24b53ecf` | 0 | 靜態站來源，乾淨 |
| `D:\FDE-AI-public-site` | — | — | — | 候選來源，未動 |

P6 工作樹在接棒時已有部分實作（含 `live_assertions.py`、`internal_auth.py`、閘道剝離），本輪以**核實 + 收尾**方式處理，未覆寫既有成果。

---

## 2. 實際修改檔案

### 2.1 P6 工作樹 `codex/p6-security-preprod`（未提交，符合授權限制）

**已追蹤修改（10）**：
- `live_backend/app/live_assertions.py`（+338）— assertion envelope 實作
- `live_backend/app/internal_auth.py`（新，未追蹤）— 驗證器，身分取自 claims
- `live_backend/app/main.py`（+9）— health 回報 auth_mode
- `live_backend/app/vision_api.py`（+60）— `_teacher()` 改為 verify_async + 身分取自 claims
- `student_portal/learning/live_assertions.py`（+195）— Django 簽發端
- `student_portal/learning/internal_auth.py`（新，未追蹤）— `signed_headers`
- `student_portal/learning/views.py`（+236）— 班級隔離 guard 移植
- `student_portal/learning/vision_submission.py`（+61）— 三處 `signed_headers`
- `student_portal/learning/vision_preflight.py`（新，未追蹤）— 容器層 .pt 預檢
- `cloudflare/dev-phase1a/worker.mjs`（+27）— 閘道剝離 X-FDE-*
- `demo/tools/static_entry_server.py`（+47）— 閘道剝離 X-FDE-*
- `live_backend/tests/test_vision_api.py` / `test_teacher_vision_center.py`（+14/+17）
- `docs/superpowers/plans/2026-10-28-p6-security-preprod.md`（新）

**已刪除**：2 個過時 `.rej`（參照 P6 重構後不存在的 seed 端點，非他代理成果）。

### 2.2 主工作樹 `feat/m02-simulator-entry`（本輪新增，未部署）

- `live_backend/app/vision_center.py`：+`PROP_DIRECTION_TO_CW_CCW` 對應表與 `map_prop_to_direction()` 純函式（隔離規則，未動 ACTIVE Registry）
- `live_backend/tests/test_prop_direction_cw_ccw.py`（新，6 項單測）
- `ops/launch-20261029/tools/probe_prop_models.py`、`extract_camroll_frames.py`、證據 `prop-model-probe.json`、`camroll/`（分析用，非產品碼）

---

## 3. 學員 best.pt 上傳閉環（機制）

- 容器安全預檢 `vision_preflight.inspect_bytes`（**絕不 unpickle**）已在 Phase-4 實測：6 個真實 best.pt 全 PASS、7 種惡意（空檔/垃圾/舊式 pickle/無 data.pkl/ZIP 炸彈/zip-slip/錯副檔名）全 REJECT。
- 提交進入待審佇列、學員僅見自己提交，已由 `VisionCohortGuardTests`（8/8）與 Phase-4 12 項 YOLO 閉環證明。
- **本輪未重跑端到端**：因 YOLO 阻擋項（§4/§5）使其無附加價值；上傳機制本身穩定，且本輪無真實可訓練模型可演示「合格→Candidate」。

---

## 4. 教師圖片驗證（⛔ BLOCKED — 無真實槳葉照片）

| 搜尋位置 | 結果 |
| --- | --- |
| `ops/launch-20261028/test-images/prop_real_01.jpg`、`_02.jpg` | 名實不符：實為「低空經濟大會人像」與「幼兒園科學活動」照（已 Read 實看確認） |
| `.test-temp/acceptance-r24/media/golden_set/` | 744 檔皆 64-byte 佔位（`FFD8FFE0` + 56×`G`），非真實圖 |
| `C:\Users\admin\Pictures\Camera Roll\` | 5/6 為 iVCam 黑畫面、1 段為人物工作台；無槳葉，且含人臉不可用作測試/發布素材 |
| 全 `D:` 磁碟 >100KB jpg/png 掃描 | 無任何四軸機槳葉素材 |

**結論**：現有環境**無任何真實槳葉照片**，無法執行指令要求的「真實 YOLO 推論 → 顯示 CW/CCW/信心/版本/判定」。未以假圖或佔位檔冒充驗證。

---

## 5. CW／CCW 類別與對應規則（證據）

- `live_backend/app/vision_center.py:33` → `PROP_CLASSES = ("CW_F", "CCW_F", "CW_B", "CCW_B")`：**四類**（旋向 × 槳面），**非兩類**。
- Registry 4 個 `PROP_DIRECTION` 模型 `class_names` 全為四類，且**無任何 ACTIVE**。
- 模型真實訓練狀態：4 個模型 `train_args` 全為 `None`；對任意圖推論出 139–300 個框、信心值多落在 0.002 雜訊地板 —— **未訓練模型**的典型退化特徵。
- 本輪新增 `map_prop_to_direction()`：將四類收斂為兩類（`CW_F/CW_B→CW`，`CCW_F/CCW_B→CCW`），6 項單測全過。
- **誠實聲明**：模型本身仍是四類；對應規則只做「四類→兩類」收斂顯示，**不偽裝模型為兩類模型**，亦未因模型存在即顯示 PASS。

---

## 6. Candidate／隔離 ACTIVE

- 隔離 Registry 候選機制存在（Phase-4 證明）。
- 但**無合格候選**：模型未訓練、無真實圖片、低信心一律 REVIEW，故無可列 Candidate。
- 正式 ACTIVE 未動。

---

## 7. P6 安全測試（PASS）

| 套件 | 結果 | 備註 |
| --- | --- | --- |
| `test_p6_assertion_security` | **13/13 PASS** | 含「兩 Live 程序共用 SQLite ledger，第二次重放仍拒絕」 |
| `test_p6_gateway_strip` | **4/4 PASS** | 含「偽造 X-FDE-Role/Teacher-ID/Cookie 永不到達 Live」 |
| `test_vision_api`（Phase-4 回歸） | 17/17 OK | |
| `test_teacher_vision_center`（Phase-4 回歸） | 22/22 OK | |
| `test_vision_center`（Phase-4 回歸 + 本輪 +6） | 49/49 OK | 含 `test_prop_direction_cw_ccw` 6 項 |

**必要測試 1–10 映射（全部 PASS）**：
1. 無密鑰 → fail closed（`secret_not_configured`）✓
2. 正式模式禁 `unsigned_legacy`（僅 `FDE_ALLOW_UNSIGNED_LEGACY=1` 才放行相容模式）✓
3. 本文竄改 → `body_tampered` ✓
4. method/path 不一致 → `method_mismatch`/`path_mismatch` ✓
5. 過期 / TTL>60s → `expired_assertion`/`ttl_too_long` ✓
6. 同 jti 重放 → `replay_detected` ✓
7. 兩程序共用 ledger 重放 → 仍拒絕 ✓
8. 偽造身分/角色/教師ID/Cohort → 拒絕 ✓
9. 跨班教師 → 拒絕 ✓
10. 直接 Live API（無 assertion 或僅瀏覽器偽造標頭）→ 拒絕 ✓

**結論**：P6 安全前置條件 ✅ READY（位於隔離工作樹，待合併與部署，部署時須兩邊同設 `FDE_INTERNAL_SHARED_SECRET` 並配置 `FDE_REPLAY_LEDGER_PATH`）。

---

## 8. 靜態公開網站

- **URL**：`https://zhangpengya77-tech.github.io/fde-ai/v2/` → HTTP **200**
- **來源**：`D:\FDE-AI-public-pages`（`gh-pages`，HEAD `24b53ecf`，工作樹乾淨）
- **內容**：正確的 FDE-AI-UAS 公開內容；離線文案與規格**逐字相符**（「FDE-AI 教學系統目前離線，公開課程仍可瀏覽。學員登入、作業上傳及 AI 功能暫時無法使用。」）
- **合規掃描**：無 `.pt`、無學員個資、無 Django/Gateway/Tunnel 密鑰、無 API Token、無後端絕對路徑；`app.js` 無假登入/假上傳（portalBaseUrl 為空即顯示離線並停用登入連結）。
- **多視口**：無真機，**僅「模擬視口通過」**（iPhone Safari / Android Chrome / Windows Chrome-Edge 視口尺寸下版面正常；未做真機觸控與上傳實測）。

---

## 9. 正式環境未修改確認

四項正式資源 SHA-256 與 Phase-4 P-16 `after` **逐碼相同**：

| 資源 | SHA-256（前 16） |
| --- | --- |
| prod_db (`student_portal/db.sqlite3`) | `1fa462fef825980e` |
| demo_db (`demo/runtime/db/demo.sqlite3`) | `fdaf180529979bb8` |
| demo_registry (`demo/runtime/vision-center/vision_center.json`) | `9ffa6cb305f40b7b` |
| default_registry (`%LOCALAPPDATA%/FDE-AI-UAS/vision-center/vision_center.json`) | `7b3f674fbca0e6a1` |

主工作樹本輪只新增分析腳本、規則純函式與測試，**未觸及 8022/8770/正式 DB/正式 ACTIVE Registry**。未 commit / 未 push / 未 merge / 未 deploy。

---

## 10. 剩餘阻擋項

- **B1**：無真實槳葉照片。教師須提供 CW、CCW 真實四軸機俯照（建議每類數張以上）。
- **B2**：`PROP_DIRECTION` 模型未訓練（`train_args=None`，推論為雜訊地板）。須以真實資料重訓。
- **B3**：模型為四類。若堅持兩類驗收，需確認接受本輪「四類→兩類對應規則」或重訓兩類模型。
- **B4**：P6 尚未合併至主樹／尚未部署（共用密鑰、replay ledger 路徑待運維設定）。

---

## 11. 下一步授權建議

- ⛔ **目前不可申請「預發布 HTTPS 外網驗收」**：核心 YOLO/CW-CCW 端到端無法以真實資料演示（B1/B2）。
- ✅ P6 安全前置條件已具備（隔離樹），B1/B2 解決後即可接外網。
- **建議授權順序**：
  1. 教師提供真實槳葉照片 + 重訓 `PROP_DIRECTION`；
  2. 本輪端到端閉環重跑（學員上傳 → 教師同班推論 → CW/CCW 顯示 → 合格列 Candidate → 隔離 ACTIVE）；
  3. P6 合併部署（設共用密鑰 + replay ledger 路徑）；
  4. 外網驗收。
