# FDE-AI 2.0｜上線收尾第四階段
## Django Vision 安全代理、教師班級隔離及模型上傳驗證 — 交付報告

- 日期：2026-10-28
- 範圍：**隔離開發 / 隔離測試 / 文件與發布候選**（不含正式部署）
- 隔離環境：Django `127.0.0.1:18110`、Live `127.0.0.1:18111`、資源根 `ops/launch-20261028/isolated-phase4/`
- 未觸碰：正式 8022、正式 8770、正式排程、Worker/Tunnel/DNS、正式資料庫、正式 ACTIVE Registry
- Git：未 commit、未 push、未 merge、未 deploy

---

## 0. 結論摘要

| 准入項目 | 裁決 |
| --- | --- |
| PROXY READY（Django Vision 安全代理） | **READY** |
| COHORT ISOLATION READY（教師班級隔離） | **READY** |
| MODEL UPLOAD READY（模型上傳驗證） | **READY（附限制）** |
| YOLO E2E READY | **READY** |
| PRODUCTION RELEASE APPROVAL | **REQUIRED（等待教師批准）** |

測試總覽（全部在隔離環境實跑，非替身）：

| 測試組 | 結果 |
| --- | --- |
| P-01 ~ P-16 安全與整合 | **16 / 16 PASS** |
| 既有 12 項 YOLO 閉環（回歸） | **12 / 12 PASS** |
| Live Backend 單元測試（11 套件） | **176 / 176 PASS** |
| Django 教師視覺中心頁（全模組，含新增 8 項隔離測試） | **220 / 220 PASS，0 失敗（見 §6.2）** |
| 正式 Registry / DB 指紋前後比對 | **完全一致（P-16）** |

**全部四組測試零失敗。**

---

## 1. 任務 A：基線重建

| 項目 | 結果 |
| --- | --- |
| HEAD | `06481159f5ca638621c821e4fe9105b0837577f8` |
| 分支 | `feat/m02-simulator-entry` |
| 未提交變更 | 63 項（承接 2026-10-23 A/B/C/D 階段，尚未 commit） |
| 並行寫入者 | **無**（15 分鐘內產品檔案零改動；無其他 FDE-AI 相關 python/node 程序） |
| 備份位置 | `ops/launch-20261028/baseline/phase4/` |
| 備份指紋 | `ops/launch-20261028/baseline/phase4/SHA256_BEFORE.txt` |

備份涵蓋本階段可能修改的 7 個檔案，SHA-256 如下：

| 檔案 | SHA-256（前 16 碼） |
| --- | --- |
| `live_backend/app/main.py` | `32bf3a4463846c53` |
| `live_backend/app/vision_api.py` | `c1bba329fe87e717` |
| `live_backend/app/vision_center.py` | `a9dbfc6051ea50fa` |
| `student_portal/learning/forms.py` | `71719c469480eec1` |
| `student_portal/learning/urls.py` | `b32dfe1cc09f2230` |
| `student_portal/learning/views.py` | `aea597909e32cdad` |
| `student_portal/learning/vision_submission.py` | `a85850498ee3fbfc` |

無並行衝突，可安全繼續。

---

## 2. 任務 B：Django Vision 安全代理與可信身分契約

### 2.1 問題

原架構下，Live Backend 只綁 `127.0.0.1`，但**身分完全來自可偽造的 HTTP 標頭**：

```
X-FDE-Role: teacher
X-FDE-Teacher-ID: 2
```

任何同機程序、被繞過的代理、日後誤開的對外綁定，都能直接冒充教師呼叫
`/api/v1/vision/models/{id}/activate` 等 25 個教師級端點。**localhost 不等於可信來源。**

### 2.2 修復：伺服器端簽章（HMAC-SHA256）

新增兩個模組（因 Django 與 Live 用不同 Python 環境、不共用套件路徑，故各一份實作，**canonical 形式必須完全一致**）：

- `live_backend/app/internal_auth.py`（驗證端）
- `student_portal/learning/internal_auth.py`（簽章端）

契約：

```
canonical = "\n".join([METHOD, PATH, ROLE, SUBJECT_ID, TIMESTAMP])
signature = HMAC-SHA256(secret, canonical)  # 十六進位小寫
```

| 標頭 | 內容 |
| --- | --- |
| `X-FDE-Internal-Signature` | 上述簽章 |
| `X-FDE-Internal-Timestamp` | Unix 秒；與伺服器時間差 > `MAX_SKEW_SECONDS = 300` 視為過期 |

密鑰來源：環境變數 `FDE_INTERNAL_SHARED_SECRET`。比較使用 `hmac.compare_digest` 防時序攻擊。

### 2.3 覆蓋範圍（不需逐路由改）

`_teacher()` 是 Live 端 **25 個教師級端點的共同入口**，因此把驗證放進 `_teacher()` 即一次覆蓋全部：

```python
def _teacher(request):
    if request.headers.get("X-FDE-Role", "").casefold() != "teacher":
        return None, error_response("teacher_required", ..., 403)
    teacher_id = request.headers.get("X-FDE-Teacher-ID", "").strip()
    if not teacher_id:
        return None, error_response("teacher_id_required", ..., 403)
    trusted, reason = internal_auth.verify(request)
    if not trusted:
        return None, error_response("internal_auth_rejected", f"Untrusted internal caller: {reason}.", 403)
    return teacher_id, None
```

學員下載種子 `.pt` 的 `download_seed()` 原本只讀 `X-FDE-Student-ID`，同樣補上驗證。

### 2.4 Django 端：重建可信身分，不信任瀏覽器

`vision_submission.py` 的 `_post()` / `_get()` / `_delete()` / `download_seed()` 全部改為**由 Django 伺服器端自行組裝標頭並簽章**，瀏覽器送來的 `X-FDE-Role` / `X-FDE-User` / `X-FDE-Cohort` 一律不採用（已通讀 `learning/*.py`，確認無任何 `HTTP_X_FDE_*` 轉發；唯一例外 `X-FDE-Video-Request-ID` 只是請求關聯 id，不含授權語意）。

### 2.5 未設密鑰時的行為（必須如實揭露）

未設 `FDE_INTERNAL_SHARED_SECRET` 時，Live 停留在 `unsigned_legacy` 相容模式（一律通過），但：

```
GET /api/live/health  →  {"internal_auth": "signed"}   # 已設
                      →  {"internal_auth": "unsigned_legacy"}  # 未設
```

運維可一眼看出是否仍可偽造。**正式部署前必須為 `signed`**（見 §9 前置條件）。

### 2.6 其他代理層要求

| 要求 | 實作 |
| --- | --- |
| 只接受已驗證 Session | `teacher_required` / `student_required` 先驗 Django session |
| 伺服器端查真實角色 | `request.user.is_staff`，不看任何標頭 |
| 伺服器端查班級與 Enrollment | `vision_visible_student_ids()`（見 §3） |
| 轉送受限內部 Live | `settings.VISION_SUBMISSION_API_BASE_URL` 由設定決定，**使用者無法控制目標 URL**（無任何請求參數可改 base） |
| 請求大小 / 逾時 / 錯誤處理 | 表單層 100MB + 實際位元組檢查；`VISION_SUBMISSION_API_TIMEOUT_SECONDS`；逾時→`RuntimeError`→fail-closed（P-13） |
| 審計與權限隔離 | 沿用既有 Live 稽核軌跡；新增上傳拒絕審計（§4.4） |

---

## 3. 任務 C：教師班級隔離

### 3.1 缺口根因

`teacher_cohorts(user)` 早已存在且被 20 處使用，但 **vision center 系列完全沒用** —— 任何教師只要知道 `submission_id` / `model_id`，就能查看、驗證、匯入、甚至啟用他班模型。

### 3.2 橋樑

Live Registry 的 `student_id` = Django 的 `StudentProfile.public_user_id`。

```python
def vision_visible_student_ids(user):
    if user.is_superuser:
        return None  # 不受限（沿用既有角色契約）
    return set(
        Enrollment.objects.filter(cohort__in=teacher_cohorts(user), active=True)
        .values_list("student__public_user_id", flat=True)
    )
```

無班級關聯 → 集合為空 → 一律拒絕（不因「沒有資料」而放行）。

### 3.3 統一入口，不依賴前端隱藏

把資源級檢查放進 `teacher_required` 裝飾器，**所有教師視圖共用同一道檢查**，避免逐個視圖漏加：

```python
def teacher_required(view_func):
    @wraps(view_func)
    def wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated: ...
        if not request.user.is_staff: ...
        denied = vision_resource_guard(request, kwargs)
        if denied is not None:
            return denied
        return view_func(request, *args, **kwargs)
    return wrapped
```

`vision_resource_guard` 會從**三個來源**取 id，缺一即形成繞道：

1. POST 表單
2. GET 查詢字串
3. **URL 路徑參數**（例如 `/teacher/vision-repository/<model_id>/integrity-check/`）

判準：

| 情況 | 結果 |
| --- | --- |
| Live 不可用（`RuntimeError`） | **403（fail-closed）** |
| 查不到該 id | **403**（不做「查不到就放行」） |
| 來源學員不在教師班級 | **403** |
| 來源學員在教師班級 | 放行 |
| 模型無 `source_student_id`（教師自傳） | 放行（見 §11 R1） |
| `superuser` | 不受限 |

### 3.4 列表層

`teacher_vision_center` 三處同步過濾：

- `history_models`（模型清單）
- `raw_submissions`（提交清單）
- `task_summary[].history_count`（**計數也要過濾**，否則異班教師可從「有幾筆」推測他班活動量）

`verifiable_models` / `activatable_models` 皆由已過濾的 `history_models` 推導，無二次洩漏。

### 3.5 測試資料（雙班級）

以 `ops/launch-20261028/tools/seed_phase4_cohorts.py` 在隔離 DB 建立：

| 角色 | 帳號 | 班級 | 用途 |
| --- | --- | --- | --- |
| 教師 A | `demo.teacher@fde-demo.local`（pk=2） | `F450-DEMO-2026` | 同班可見 |
| 學員 A | `demo.student01@fde-demo.local`（`DEMO-STU-0001`） | `F450-DEMO-2026` | 被保護對象 |
| 教師 B | `phase4.teacherB@fde-demo.local`（pk=6） | `2026-99` | 異班不可見 |
| 學員 B | `phase4.studentB@fde-demo.local`（`FDE-26-NUC97N`） | `2026-99` | 對照 |
| 教師 C | `phase4.teacherC@fde-demo.local`（pk=7） | **無** | 無班級關聯 |

未新增任何 migration：`TeacherCohortAccess` / `Enrollment` / `Cohort` 皆為既有模型。

---

## 4. 任務 D：模型上傳安全

### 4.1 原缺陷

`GrowthModelForm` 只檢查副檔名 `.pt` 與 `upload.size ≤ 100MB`。實測（前階段 S-06/S-07）**2KB 垃圾位元組 `fake_model.pt` 可以通過表單，並在 Live 建立真實的 `SUBMITTED` 提交紀錄，污染教師待審佇列**。

### 4.2 安全邊界（最重要的一條）

PyTorch `.pt` 是 **pickle**，`torch.load` 即執行任意程式碼。因此：

> **禁止在 Django Web Request 內載入任何不可信 `.pt`。**
> 本階段只做「容器層」檢查：ZIP 中央目錄、entry 名稱、宣告大小。**絕不 unpickle、絕不 torch.load。**

真正的「這模型能不能跑」由 Live Backend 的匯入預檢負責（教師受控動作），不在 Web 請求內進行。

### 4.3 新增 `student_portal/learning/vision_preflight.py`

| 檢查 | 原因碼 |
| --- | --- |
| 空檔 | `empty_file` |
| 超過 100MB（以**實際讀到的位元組**計算，非表單宣告值） | `file_too_large` |
| 副檔名非 `.pt` | `extension_not_allowed` |
| 開頭 `\x80`（舊式純 pickle） | `unsafe_pickle_format` |
| 非 ZIP magic | `not_a_torch_archive` |
| `BadZipFile` | `corrupt_archive` |
| 絕對路徑或 `..` 分節（zip-slip） | `unsafe_archive_entry` |
| 解壓總量 > 1GB 或壓縮比 > 200 | `archive_expansion_too_large` |
| 缺 `data.pkl`（無模型權重） | `torch_payload_missing` |
| 子行程逾時（20s） | `preflight_timeout` |

**舊式純 pickle 一律拒絕**，因為驗證它必然要反序列化 —— 這是刻意的取捨：寧可拒絕，也不在 Web 進程解 pickle。

### 4.4 拒絕處理

失敗時：

1. 寫 append-only 審計（`VISION_UPLOAD_AUDIT_PATH`，預設 `MEDIA_ROOT/vision_upload_audit.jsonl`），欄位含 `event/at/user_id/enrollment_id/cohort_id/filename/reason/details`；
2. 顯示中文原因；
3. **不建立 Evidence、不進教師待審佇列**。

審計寫入失敗不會阻斷拒絕流程（`except: pass`），確保「拒絕」本身永遠生效。

### 4.5 實測（真實 `.pt` 不誤殺）

| 樣本 | 大小 | 結果 |
| --- | --- | --- |
| `PROP_20261023_DEMO-A_v1/best.pt` | 5.96 MB | PASS |
| `PROP_20261023_X_v1/best.pt` | 5.96 MB | PASS |
| `PROP_20261024_DEMO-A_v1/best.pt` | 5.21 MB | PASS |
| `PROP_20261024_X_v1/best.pt` | 5.21 MB | PASS |
| `sub-fc75c194…/submission.pt` | 5.96 MB | PASS |
| `sub-fd43fd64…/submission.pt` | 5.21 MB | PASS |

惡意／異常樣本 7 種全部 REJECT（空檔、2KB 垃圾、pickle 開頭、無 `data.pkl`、ZIP 炸彈、zip-slip、錯副檔名）。

### 4.6 品質門檻

**未降低任何門檻。** 啟用資格仍由 Live `activate_model` 硬判定（health OK＋圖片驗證最高信心 ≥0.6＋四類別名＋非 DEMO_IMPORTED＋非隔離＋`.pt` 可讀＋非 `REVIEW_REQUIRED`）。P-15 實測：未達門檻模型送出啟用後狀態不變、ACTIVE 前後一致。

---

## 5. 任務 E：P-01 ~ P-16 證據

腳本：`ops/launch-20261028/tools/phase4_security_tests.py`
證據：`ops/launch-20261028/evidence/phase4-p01-p16.json`
P-13 子腳本：`ops/launch-20261028/tools/phase4_proxy_timeout.py`

| 編號 | 測試 | 關鍵實測值 | 結果 |
| --- | --- | --- | --- |
| P-01 | 匿名請求拒絕 | 教師頁 302→`/teacher/login/`；教師動作 302/403 | PASS |
| P-02 | 學員偽造教師角色／標頭 | 頁面 403、動作 403、帶偽造標頭仍 403 | PASS |
| P-03 | 同班教師可查看 | 教師 A 頁面出現班級 A 提交 id | PASS |
| P-04 | 異班教師不能查看列表 | 教師 B 頁面 0 筆班級 A 提交、0 筆學員衍生模型 | PASS |
| P-05 | 異班直接猜 ID 也不能看詳情 | `submission_id` 403、`model_id` 403、`?model=` 頁面不含該 id | PASS |
| P-06 | 異班不能驗證／匯入／刪除 | validate 403、import 403、delete 403 | PASS |
| P-07 | 異班不能啟用 | activate 403；ACTIVE 前後一致 | PASS |
| P-08 | 無班級關聯安全拒絕 | 清單 200 但無他班資源；詳情 403；啟用 403 | PASS |
| P-09 | 無效 `.pt` 被拒且不進待審佇列 | 2100 bytes 垃圾 → flash「未通過安全檢查」；提交數前後不變 | PASS |
| P-10 | 合法候選可進受控驗證 | 真實 5.21MB `best.pt` → 建立 `SUBMITTED` 候選 | PASS |
| P-11 | Live 不接受未授權直連 | 無標頭 403／只有 Role 403／錯簽章 403／過期簽章 403／正確簽章 **200** | PASS |
| P-12 | 偽造 `X-FDE-*` 不得提權 | 直連偽造 403、錯 subject 簽章 403、Django 端偽造標頭 403 | PASS |
| P-13 | 代理逾時安全退出 | timeout=3s → 3.15s 拋 `vision_api_unavailable`；guard 3.41s 回 **403** | PASS |
| P-14 | 真實 YOLO 推論成功 | `evidence_source=REAL_INFERENCE`、`detection_count>0`、`max_confidence` 非空 | PASS |
| P-15 | 低品質模型仍不能 ACTIVE | 送出啟用後狀態未變 ACTIVE；ACTIVE 清單前後一致 | PASS |
| P-16 | 正式 Registry / DB 前後不變 | 4 個正式資源 SHA-256 前後完全一致 | PASS |

P-11 特別設計了「對照組」：正確簽章必須回 200，證明 403 不是「全部拒絕」造成的假通過。

### 5.1 既有 12 項 YOLO 閉環回歸

腳本：`ops/launch-20261028/tools/e2e_closed_loop.py`
證據：`ops/launch-20261028/evidence/yolo-closed-loop-12.json`

在 **簽章模式開啟 + 班級隔離生效** 的前提下重跑：**12 / 12 PASS**（學員登入 → 上傳 → 提交落庫 → 教師登入 → 列表 → 真實推論 → 真實結果 → 匯入候選 → 資格判定 → 門檻未放寬 → 學員回看 → 稽核可追溯）。

證明任務 B/C/D 的改動**沒有破壞既有閉環**。

---

## 6. 單元測試回歸

### 6.1 Live Backend（逐套件執行）

| 套件 | 結果 |
| --- | --- |
| `test_vision_api` | 17 / 17 OK |
| `test_teacher_vision_center` | 22 / 22 OK |
| `test_vision_center` | 49 / 49 OK |
| `test_vision_model_management` | 23 / 23 OK |
| `test_model_health` | 18 / 18 OK |
| `test_vision_quality_gate` | 9 / 9 OK |
| `test_vision_s2s3s4` | 8 / 8 OK |
| `test_vision_mapping_extra` | 7 / 7 OK |
| `test_vision_candidate_floor` | 7 / 7 OK |
| `test_vision_reliability` | 11 / 11 OK |
| `test_rc_profile_api` | 5 / 5 OK |
| **合計** | **176 / 176 OK** |

### 6.2 Django 教師視覺中心頁

**全模組執行結果：`Ran 220 tests in 112.801s` → `OK`（0 失敗、0 錯誤）。**

執行指令：

```
NO_PROXY="*" DJANGO_DB_NAME=fde_phase4_unit \
  .test-temp/django-venv/Scripts/python.exe manage.py test \
  learning.tests.test_teacher_vision_center_page -v 1
```

> 說明：該模組原先需時 20 分鐘以上，原因是每一次 `list_submissions` / `task_model_history`
> 都會真實跨進程呼叫 `:8030`（該埠有程序回 502，單次約 2 秒）。已將 `vision_resource_guard`
> 內的跨進程查詢抽成 `_vision_lookup_submission_student` / `_vision_lookup_model_student`
> 兩個小函式，並在模組層 `setUpModule` 以 patch 取代，使測試不再依賴外部程序。
> 這是**測試加速**，不是放寬判斷——真正的隔離行為由 P-01~P-16 的 HTTP 實測證明。

新增 8 項定向單元測試（`VisionCohortGuardTests`），逐一驗證 guard 的六種結局：

| 測試 | 驗證點 |
| --- | --- |
| `test_foreign_student_submission_is_denied` | 他班提交 → 403 |
| `test_same_cohort_submission_passes_guard` | 同班提交 → 放行 |
| `test_unknown_submission_is_denied` | 查不到 id → 403 |
| `test_foreign_model_is_denied` | 他班模型 → 403 |
| `test_teacher_uploaded_model_without_student_is_allowed` | 教師自傳模型 → 放行 |
| `test_live_unavailable_fails_closed` | Live 不可用 → 403 |
| `test_no_cohort_access_is_denied` | 無班級 → 403 |
| `test_superuser_is_not_restricted` | superuser → 不受限 |

該模組另以模組層 stub 取代跨進程查詢，維持既有 200+ 項頁面/流程測試的原意（真正的隔離行為由 P-01~P-16 的 HTTP 實測證明）。

---

## 7. 新增與修改檔案清單

### 7.1 新增

| 檔案 | 用途 |
| --- | --- |
| `live_backend/app/internal_auth.py` | Live 端簽章驗證 |
| `student_portal/learning/internal_auth.py` | Django 端簽章產生 |
| `student_portal/learning/vision_preflight.py` | `.pt` 容器層安全預檢 |
| `ops/launch-20261028/tools/seed_phase4_cohorts.py` | 雙班級測試資料種子 |
| `ops/launch-20261028/tools/phase4_security_tests.py` | P-01 ~ P-16 |
| `ops/launch-20261028/tools/phase4_proxy_timeout.py` | P-13 代理逾時代碼路徑 |
| `ops/launch-20261028/evidence/phase4-p01-p16.json` | P-01~P-16 證據 |
| `ops/launch-20261028/evidence/phase4-diff.patch` | 本階段精確 diff |
| `docs/reports/FDE_2_0_LAUNCH_CLOSURE_PHASE4_2026-10-28.md` | 本報告 |

### 7.2 修改

| 檔案 | 變更 |
| --- | --- |
| `live_backend/app/vision_api.py` | `_teacher()` 加簽章驗證（覆蓋 25 個端點）；`download_seed()` 加簽章 |
| `live_backend/app/main.py` | `/api/live/health` 回報 `internal_auth` 模式 |
| `student_portal/learning/vision_submission.py` | `_post`/`_get`/`_delete`/`download_seed` 補簽章標頭 |
| `student_portal/learning/views.py` | 班級隔離 4 個函式 + `teacher_required` 掛 guard + 列表過濾 + 上傳預檢與拒絕審計 |
| `student_portal/learning/tests/test_teacher_vision_center_page.py` | 模組層 stub + 8 項隔離測試 |
| `ops/launch-20261028/tools/start_isolated_stack.ps1` | 隔離棧注入 `FDE_INTERNAL_SHARED_SECRET`（簽章模式） |
| `ops/launch-20261028/tools/e2e_closed_loop.py` | Live 呼叫改為簽章呼叫 |

**未修改**：`forms.py`、`urls.py`、`vision_center.py`（本階段零改動，已由 diff 證實）。

---

## 8. Git Diff 與 SHA-256

### 8.1 精確 diff（對照 `baseline/phase4/`）

`ops/launch-20261028/evidence/phase4-diff.patch`：**412 行，新增 265 行、刪除 6 行**

| 檔案 | 新增行 |
| --- | --- |
| `student_portal/learning/views.py` | 202 |
| `live_backend/app/vision_api.py` | 13 |
| `live_backend/app/main.py` | 8 |
| `student_portal/learning/vision_submission.py` | 7 |

> 注意：工作樹另含 2026-10-23 A/B/C/D 等**先前階段未提交**的變更。上述 diff 是「相對本階段基線」的差異，才是本階段的真實改動量。

### 8.2 修改後 SHA-256（前 16 碼）

| 檔案 | SHA-256 |
| --- | --- |
| `live_backend/app/internal_auth.py` | `c6591f75e3952558` |
| `live_backend/app/vision_api.py` | `67c91dd6715b83df` |
| `live_backend/app/main.py` | `5da44cbd810d99a4` |
| `student_portal/learning/internal_auth.py` | `b0fd49d34e91e174` |
| `student_portal/learning/vision_preflight.py` | `913751d7d89db612` |
| `student_portal/learning/views.py` | `4e81f80ff245cf4a` |
| `student_portal/learning/vision_submission.py` | `4b6556c5536ac7f2` |
| `ops/launch-20261028/tools/start_isolated_stack.ps1` | `22aa2fb91bd2e1b1` |
| `ops/launch-20261028/tools/e2e_closed_loop.py` | `3cd0f6086df1cf9c` |
| `ops/launch-20261028/tools/seed_phase4_cohorts.py` | `2d2e70b86493eba0` |
| `ops/launch-20261028/tools/phase4_security_tests.py` | `2746b2ac72a77c5b` |
| `ops/launch-20261028/tools/phase4_proxy_timeout.py` | `fe8cb330573f7a4c` |

---

## 9. 部署順序（建議）

**順序錯了會全站 403。** 舊 Django + 新 Live（signed）= 所有教師操作被拒。因此：

| 步驟 | 動作 | 為什麼 |
| --- | --- | --- |
| 1 | 備份正式 Django / Live 程式碼與 Registry | 回滾前提 |
| 2 | **先部署 Django 程式碼**（含簽章、guard、preflight） | 舊 Live 忽略簽章標頭 → 新 Django 仍可運作，**服務不中斷** |
| 3 | 驗證既有閉環仍正常（教師頁、學員上傳） | 此時 Live 仍是 legacy |
| 4 | 產生密鑰：`openssl rand -hex 32` | 至少 32 bytes 隨機 |
| 5 | **同時**在 Live 與 Django 兩邊注入 `FDE_INTERNAL_SHARED_SECRET`（同一值） | 兩邊必須一致 |
| 6 | **部署 Live 程式碼**（含 `internal_auth` 驗證）並重啟 | 開始驗簽 |
| 7 | `curl /api/live/health` 確認 `"internal_auth":"signed"` | 一眼確認不可偽造 |
| 8 | 重跑 §12 人工驗收清單 | 見下 |

**絕不可**只在一邊設密鑰：只設 Live 不設 Django → Django 不簽 → 全部 403；只設 Django 不設 Live → Live 仍 legacy（不報錯但沒保護）。

### 9.1 常駐需求

| 項目 | 需求 |
| --- | --- |
| Live Backend | uvicorn 常駐（正式建議 `--workers N` + 進程守護），**不得用 `runserver`** |
| Django | 正式用 gunicorn/waitress + 反向代理；`runserver` 僅供隔離/DEMO |
| 密鑰注入 | 由環境變數或 secrets 檔注入，**不得寫入 repo、不得寫入日誌** |
| 密鑰輪替 | 兩邊同時替換後一起重啟；輪替窗口內舊簽章會失效（可接受，因為是內部呼叫） |
| 監控 | `/api/live/health` 的 `internal_auth` 欄位納入巡檢；非 `signed` 即告警 |
| 審計檔 | `VISION_UPLOAD_AUDIT_PATH` 需可寫且納入備份 |

---

## 10. `DEBUG=False` 與 Origin 防繞過前置條件

以下**必須在正式發布前完成**，否則本階段的權限隔離可被繞過或資訊洩漏：

| # | 前置條件 | 現況 |
| --- | --- | --- |
| 1 | `DJANGO_DEBUG=False`（正式 8022 目前仍為 `True`，會洩漏 44 條路由與內部源站） | **未完成（P0-1）** |
| 2 | `ALLOWED_HOSTS` 只含正式網域，移除萬用字元 | 待確認 |
| 3 | `CSRF_TRUSTED_ORIGINS` 只含正式 HTTPS 來源 | 待確認 |
| 4 | `SECURE_PROXY_SSL_HEADER` 正確設定，且反向代理不透傳用戶端 `X-Forwarded-*` | 待確認 |
| 5 | 關閉 quick tunnel（前階段 P0-2：公網可直達 200） | **未完成** |
| 6 | Live Backend 僅綁 `127.0.0.1`，防火牆封鎖 8030/8770/8111 對外 | 待確認 |
| 7 | 瀏覽器不得直接觸達 Live（無 CORS 白名單以外的來源） | 待確認 |
| 8 | 反向代理不得轉發 `X-FDE-*` 系列標頭給 Live | 需在 Nginx/IIS 加 `proxy_set_header X-FDE-Role ""` 等清除規則 |

第 8 項特別重要：即使有簽章，也應在邊界把外部 `X-FDE-*` 標頭剝除，形成第二道防線。

---

## 11. 人工驗收清單

在**隔離或預發布**環境，以真實瀏覽器完成：

| # | 步驟 | 預期 |
| --- | --- | --- |
| 1 | 學員以 HTTPS 登入 | 進入學員首頁 |
| 2 | 上傳真實 `best.pt`（>1MB） | 成功，出現於 R07 |
| 3 | 上傳改名為 `.pt` 的文字檔 | **被拒**，訊息含「未通過安全檢查」，教師端待審佇列**沒有**新增 |
| 4 | 教師 A 開啟視覺中心 | 看得到學員 A 的提交 |
| 5 | 教師 A 上傳四軸機俯照做圖片驗證 | 回傳真實候選框與信心值（非「無偵測」） |
| 6 | 教師 A 匯入為候選模型 | 產生模型紀錄，狀態為候選/待驗證 |
| 7 | 未達門檻時按「設為正式模型」 | 被拒，原 ACTIVE 不變 |
| 8 | 教師 B 登入視覺中心 | **看不到**學員 A 任何提交或模型 |
| 9 | 教師 B 用學員 A 的 `submission_id` 直接開網址 | **403**（不是空白頁、不是 404） |
| 10 | 教師 C（無班級）登入 | 清單為空；任何資源網址 403 |
| 11 | 瀏覽器 DevTools 手工加 `X-FDE-Role: teacher` 以學員身分請求教師端點 | **403** |
| 12 | `curl` 直打 Live `/api/v1/vision/submissions` 不帶簽章 | **403** |
| 13 | `/api/live/health` | `"internal_auth":"signed"` |
| 14 | 正式 Registry 與 DB 的 SHA-256 | 與驗收前一致 |

---

## 12. 回滾方案

**本階段所有改動都是純程式碼 + 環境變數，無資料庫 migration、無 Registry 變更**，因此回滾成本低且可逆。

| 步驟 | 動作 |
| --- | --- |
| 1 | 停止 Live 與 Django（僅停止本階段部署的實例） |
| 2 | 從 `ops/launch-20261028/baseline/phase4/` 還原 4 個被修改的檔案（`main.py`、`vision_api.py`、`views.py`、`vision_submission.py`） |
| 3 | 刪除新增的 2 個執行期模組（`internal_auth.py` × 2、`vision_preflight.py`）—— 還原後的程式碼不會 import 它們 |
| 4 | **移除兩邊的 `FDE_INTERNAL_SHARED_SECRET`**（回到 `unsigned_legacy`，服務立即可用） |
| 5 | 重啟並確認 `/api/live/health` 回應正常、`internal_auth` 回到 `unsigned_legacy` |
| 6 | 跑 §5.1 的 12 項閉環確認回到基線 |

回滾**不需要**動資料庫、Registry、`.pt` 檔或任何學員資料。

**注意**：回滾後即回到「Live 只信任可偽造標頭」的狀態，屬已知風險，只應在緊急情況下短期使用。

---

## 13. 剩餘風險（必須如實告知）

| # | 風險 | 影響 | 建議 |
| --- | --- | --- | --- |
| R1 | **教師自傳模型無班級歸屬**（`source_student_id` 為空，例如 `*_X_v1`），依既有契約對所有教師可見、可管理 | 教師 B 能看到教師 A 上傳的教材模型（**不含任何學員身分**），若該模型合格也能啟用 | 若要收斂，需加 `uploaded_by` 過濾；但會影響 DEMO 共用教材流程，**建議由教師裁決** |
| R2 | `hard_examples` 為全域樣本，不含 `student_id`，但含他班驗證失敗的檔名（如 `IMG_7788.jpeg`） | 輕微間接資訊暴露 | 可在 Live 端加來源過濾；本階段未動以免影響飛輪 |
| R3 | Windows 無法對 `.pt` 預檢做精確 CPU／記憶體配額 | 只做到「獨立進程 + 硬逾時 20s + 只讀 + 不載入模型」 | 更嚴格隔離需容器或 Job Object |
| R4 | 舊式純 pickle `.pt` 一律拒絕 | 少數舊格式模型無法上傳 | 刻意取捨（寧可拒絕也不在 Web 解 pickle）；教師可用受控匯入 |
| R5 | 忘記設 `FDE_INTERNAL_SHARED_SECRET` → 回到 `unsigned_legacy` | 可偽造身分 | 健康端點已暴露狀態；建議納入巡檢告警 |
| R6 | `records_for_teacher()` 只過濾 `cohort_id__in`，未過濾 `active` 班級 | 已停用班級的 Django 端模型紀錄仍可見 | 既有行為，本階段未改（避免影響既有契約）；建議後續收斂 |
| R7 | 正式 Django 仍 `DEBUG=True` | 洩漏路由與內部源站 | §10 第 1 項，**發布前必須處理** |
| R8 | 反向代理若轉發外部 `X-FDE-*` 標頭 | 即使有簽章仍應剝除，形成第二道防線 | §10 第 8 項 |
| R9 | 併發提交耗盡資源 | 目前靠 100MB 上限 + 結構預檢 + Live 端既有去重 | 建議後續加每學員單位時間提交配額 |

---

## 14. 授權邊界聲明

本階段**嚴格遵守**授權限制：

- 未修改正式 8022 / 8770 任何程式碼或設定
- 未修改正式排程、Worker、Tunnel、DNS
- 未修改正式資料庫（P-16 指紋前後一致）
- 未修改正式 ACTIVE Registry（P-16 指紋前後一致）
- 未 push / merge / deploy
- 未放寬任何模型品質門檻
- 未終止任何未知程序（僅停止本階段自己啟動的 18110/18111 隔離實例）
- 未覆蓋其他工作樹

**已停止，等待教師批准後才進行正式部署。**
