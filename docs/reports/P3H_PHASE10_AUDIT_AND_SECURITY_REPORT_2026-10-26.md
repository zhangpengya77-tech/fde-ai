# P3-H 第十階段：變更審計與安全驗收補齊 — 交付報告

- 日期：2026-10-26
- 工作樹：`D:\FDE-AI-UAS-v2.0-p3h-local-backend`
- 分支：`codex/p3h-local-backend`
- 基線 HEAD：`98523d685b6b43f6c8d113f3281fc2f0f74896e5`（P3-F D: Live 安全測試對齊與無 pytest 執行器）
- 執行裁決遵守：T4 保留現有 403，不改成 401；本輪 **未 Commit / Push / Merge / Deploy**；未新增功能。
- 隔離棧埠：Django 8140 / Gateway+Live 8141 / Entry 8142 / 原始 Live（測試用）8143。全程未碰觸正式 8022、8770。

---

## 一、Git 變更清單與 SHA-256

### 1.1 基線狀態

```
HEAD   98523d685b6b43f6c8d113f3281fc2f0f74896e5
git diff --stat HEAD   →  （空，無任何已追蹤檔案被修改）
git status --porcelain →
  ?? docs/superpowers/plans/2026-10-25-p3h-independent-local-backend.md
  ?? ops/p3h/
```

**關鍵結論**：本工作樹**沒有任何已追蹤檔案的修改**。P3-H 的全部產物都是 `ops/p3h/` 下的**未追蹤新檔**。核心安全邏輯（`live_backend/app/gateway.py`、`live_backend/app/main.py`、`live_backend/app/live_assertions.py`、`student_portal/learning/views.py`、`student_portal/learning/live_assertions.py`）**本輪與第九階段皆未修改**，全部已在 HEAD 的既有 commit 內。

### 1.2 `ops/p3h/` 完整清單與最終 SHA-256

| 檔案 | SHA-256 | 狀態 |
|---|---|---|
| `invoke-p3h-django.ps1` | `ac921a716af42c962d5545af91604ca452c5f0148416d2d97d274c2491625832` | 本輪修改（+proxy 清除） |
| `start-p3h-isolated.ps1` | `72c8c75402946b1e6407c23c7e9b545c73d2475f1ccf5fdd636faa7d1c25cb74` | 本輪修改（+proxy 清除） |
| `stop-p3h-isolated.ps1` | `af565bc89fd3df91e5d9028408c3ceaf4e9c610a38a970fc7641d7f69b68e811` | 第九階段（未再動） |
| `test_p3h_start_contract.ps1` | `0d69ca7291c9da63d1dadd1b758f0cae8aaade0608eef2fac21121420caf2e94` | 第九階段（未再動） |
| `test_p3h_django_wrapper.ps1` | `f5f5eb89ae07bbed66fb3252741caf2a867987ad5a0efbd6b30ceec9af417fd3` | 第九階段（未再動） |
| `test_p3h_process_management.ps1` | `234ec0522be2103eaaf9bdab665d1853d748e698ae224caae705e96b30aa2058` | 第九階段（未再動） |
| `test_p3h_start_environment_restore.ps1` | `e930c492bac7e7e29f2640ca1191c4315148aa57d36c21f158fa22236c978c61` | 本輪修改（+BOM） |
| `verify_p3h_business_http.py` | `9c9bb4568805ea10cc1281e601f4cf62916eb746a24a484b5fae3b4fd0668df9` | 第八階段（未再動） |
| `verify_p3h_gateway_http.py` | `8f814a30cf81a8eb76ce39c49c5e2f21e9e5f47589e4851d7b9bc28e5849829f` | 第九階段（未再動） |
| `verify_p3h_security_negative.py` | `0222c83c862f668e9c83a93b69226e160a929fc793a44f91cb6d4145b574d8e0` | **本輪新增**（安全負向測試） |
| `p3h-candidate.env.example` | `6897b45b14a5e0428f0bc1f6e795a0f992301b46796fefad5ad06dd77347464d` | 第九階段（未再動） |

計畫文件：`docs/superpowers/plans/2026-10-25-p3h-independent-local-backend.md` → `f327ab9b82ae2da8bf10d7f05678d60fb6b4893cc2742462510cd2ede76ca24c`（未追蹤）。

### 1.3 「原有未提交」與「第九階段／第十階段新增」的區分

- **原有已追蹤檔案的未提交修改**：**無**（`git diff HEAD` 為空）。
- **第九階段新增／修改**（依本 session 紀錄）：`start/stop/invoke`、四個 `test_p3h_*`、`verify_p3h_gateway_http.py`、`p3h-candidate.env.example`，均為新建或既有未追蹤檔。
- **第十階段（本輪）新增／修改**：
  1. 新增 `verify_p3h_security_negative.py`。
  2. `start-p3h-isolated.ps1`：新增 process 層級 proxy 清除。
  3. `invoke-p3h-django.ps1`：新增 process 層級 proxy 清除。
  4. `test_p3h_start_environment_restore.ps1`：補 UTF-8 BOM。

> 因全部為未追蹤檔，Git 無法自動區分各階段；以上依 session 逐檔紀錄歸類。

---

## 二、第八項檢查點審計結果

| # | 檢查點 | 結論 | 證據 |
|---|---|---|---|
| 1 | `gateway_main:app` 接線 | ✅ 正確 | `start-p3h-isolated.ps1:172` `-ArgumentList @('-m','uvicorn','gateway_main:app',…)`；`:176` 監聽器識別片段 `-m uvicorn gateway_main:app`。實測 8141 即閘道（直打時身分標頭被剝除，回 403 而非 Live 的 401）。 |
| 2 | `FDE_GATEWAY_DJANGO_ORIGIN` 僅指向隔離 Django | ✅ 正確 | `:150` `$env:FDE_GATEWAY_DJANGO_ORIGIN = "http://127.0.0.1:$DjangoPort"`（本次 $DjangoPort=8140），**絕無 8022 硬編碼**；`:143-144` ALLOWED_HOSTS / CSRF_TRUSTED_ORIGINS 亦僅含隔離埠。 |
| 3 | `invoke-p3h-django.ps1` WinPS 5.1 相容 | ✅ 正確 | `:12` 以 `[IO.Path]::IsPathRooted` + `^[A-Za-z]:[^\\]` 取代未公開的 `IsPathFullyQualified`；無殘留舊 API。 |
| 4 | Python stderr 保留真實 exit code | ✅ 正確 | `:40-43` 呼叫前 `$ErrorActionPreference='Continue'`，取 `$commandExit=$LASTEXITCODE`，`:49 exit $commandExit`；不會因 stderr 觸發 `NativeCommandError` 吞掉結束碼。 |
| 5 | 所有 P3-H `.ps1` BOM | ⚠️→✅ 已補齊 | 起始時 6/7 有 BOM；`test_p3h_start_environment_restore.ps1` **無 BOM**（WinPS 5.1 會以 ANSI/Big5 解碼中文註解而報錯）。本輪補 BOM，複查 7/7 全為 `EF BB BF`。 |
| 6 | Proxy 環境變數清理僅限候選程序 | ❌→✅ 已修 | 起始時**完全沒有** proxy 清除，導致 `Start-Process` 因 `https_proxy`/`HTTPS_PROXY` 大小寫重複鍵拋出 `Item has already been added`，隔離棧**無法啟動**。本輪在兩個啟動器加入 `[Environment]::SetEnvironmentVariable(...,'Process')` 清除，僅作用於該子程序，不影響父 session／系統。 |
| 7 | `verify_p3h_gateway_http.py` 斷言 | ✅ 正確 | T1 health=200；T2 建立 session=201 且 owner 以 `student:` 開頭；T3 偽造 `X-FDE-Role: teacher` 仍 201 且 owner 仍 `student:`；T4 未認證接受 `401 或 403`（已註明 `@csrf_protect` 先回 403，符合裁決「保留 403」）；T5 直連閘道=403；T6 直連 Django assertion 缺金鑰=403。 |
| 8 | `stop-p3h-isolated.ps1` 防誤殺 | ✅ 正確 | `:24-61` 三重比對：監聽 PID == 記錄 `listener_pid`、`CommandLine` 含 `command_fragment`、建立時間差 < 1 秒；任一不符即 `exit 1` 拒絕。本次收尾輸出：django/live「listener already absent; no action」、entry「verified P3H process stopped」。 |

---

## 三、超出原授權字面範圍的修改（逐項列出，未視為已批准）

依「允許唯讀審計、執行既有隔離測試、CandidateRoot 建測試資料、修正純測試腳本斷言」的授權，以下三項**不屬「斷言修正」字面**，但為「實際執行安全測試」所必需，特此列出待批准：

1. **`start-p3h-isolated.ps1` 新增 proxy 清除（+7 行）**：不修則 `Start-Process` 直接崩潰，隔離棧起不來，任何測試都無法執行。屬啟動器可用性修復，非安全邏輯變更。
2. **`invoke-p3h-django.ps1` 新增 proxy 清除（+5 行）**：同上，保持兩啟動器一致；此檔本輪未被實際用到（start 腳本自行 migrate），屬一致性加固。
3. **`test_p3h_start_environment_restore.ps1` 補 BOM（+3 bytes）**：純測試腳本可執行性修復，無邏輯變更。

**未超出授權的部分**：核心安全邏輯（gateway.py / main.py / live_assertions.py / views.py）**零修改**（`git diff HEAD` 為空可證）；未碰正式服務／DB／媒體；未繞過 safe-delete；未 Commit/Push/Merge/Deploy；未啟用 Vision/H3 ACTIVE。

---

## 四、Gateway 正向／負向 HTTP 測試矩陣（真實 HTTP，非模擬）

### 4.1 正向鏈（`verify_p3h_gateway_http.py`，本次重跑）

| 測項 | 期望 | 實測 | 結果 |
|---|---|---|---|
| T1 health via entry | 200 | 200 | PASS |
| T2 create_session via gateway | 201 | 201 | PASS |
| T2 owner is student | `student:` 前綴 | `student:61ac6f9d…` | PASS |
| T3 forged `X-FDE-Role: teacher` stripped | 201 | 201 | PASS |
| T3 still student (no escalation) | `student:` 前綴 | `student:61ac6f9d…` | PASS |
| T4 unauthenticated via entry | 401/403 | 403 | PASS |
| T5 direct Live/Gateway without auth | 403 | 403 | PASS |
| T6 direct Django assertion without gateway key | 403 | 403 | PASS |

收尾行：`CHAIN_PASS full Django->Gateway->Live Assertion HTTP chain verified in isolation`。

### 4.2 負向安全矩陣（`verify_p3h_security_negative.py`）

> 說明：8141 是 `gateway_main:app`，閘道會**剝除** `x-fde-live-assertion`／`x-fde-proxy-auth`，故簽章／過期／aud-iss-sub 等測試必須打到**未包閘道的原始 Live**（`app.main:app`，本次另起 8143，同金鑰、`FDE_LIVE_DEV_MODE=false`）。跨擁有者與無效 Evidence 亦在此原始 Live 上建立 session，以確保同一 session store。

| 測項 | 手法 | 期望 | 實測 | 結果 |
|---|---|---|---|---|
| N1 過期 Assertion | 以 120 秒前簽發（exp 已過） | 401 | 401 | PASS |
| N2 簽章竄改 | 翻轉簽章末字元 | 401 | 401 | PASS |
| N3 audience 不符 | 原始簽章器偽造 `aud=fde-evil` | 401 | 401 | PASS |
| N4 issuer 不符 | 原始簽章器偽造 `iss=evil-issuer` | 401 | 401 | PASS |
| N5 sub/role 不符 | `sub=teacher:999` 但 `role=student` | 401 | 401 | PASS |
| N6 跨擁有者（跨 Cohort） | A 建 session，用 B 的合法 Assertion 存取 | 403 `session_owner_required` | 403 `session_owner_required` | PASS |
| N7 登出後舊 Session | 登入→建 session(201)→登出→再建 | 401/403 | 登出=200，再建=401 | PASS |
| N8 惡意 Origin | `Origin: http://evil.example` 打入口 | 403 | 403 | PASS |
| N9 缺 CSRF 打 assertion 端點 | 帶正確 Gateway 金鑰但無 CSRF | 403 | 403 | PASS |
| N10 無效 Evidence 輸入 | 原始 Live 送 `evidence_type=BOGUS_TYPE` | 400 且 session 完好 | 400，GET session=200 | PASS |
| N11 Django 離線 Fail Closed | 停 Django 後經入口建 session | 503 | 503 `gateway_upstream_unavailable` | PASS |
| N12 Live 離線 Fail Closed | 停閘道後經入口建 session | ≥500 | 503（入口錯誤頁） | PASS |

**負向合計：13/13 PASS。**

### 4.3 關於 T4 的 403（裁決遵守）

Django `live_identity_assertion` 的 `@csrf_protect` 在視圖 `is_authenticated`(401) 之前執行；無 session 即無 CSRF token，故先回 403。閘道如實映射為 403。**本輪保留 403，未改為 401**，與裁決一致。

---

## 五、Evidence 負向測試結果

- **已實測（PASS）**：原始 Live `/api/live/sessions/{sid}/training/evidence` 收到無效 `evidence_type` → `400 invalid_evidence`；同一 session 隨後 `GET` 仍為 `200`，證明**未留下殘缺紀錄、未破壞 session**。程式碼層面 `EvidenceRecord.create(...)` 位於 `try` 內、`add_training_evidence` 在其後，非法 enum 於 `create` 前即拋出，結構上不會寫入。
- **NOT TESTED（1 項，附理由）**：Django 端「無效 PDF 上傳成長記錄 → 不留下殘缺 Evidence」的**完整 HTTP 重現未執行**。理由：`growth_record_detail` 的檔案 Evidence 建立（`views.py:1118-1194`）需 R07 成長記錄定義／提交／方向等種子資料，而 P3-H 最小隔離候選以 `migrate` 建空庫、無此種子；強行造全套種子已超出「不再新增功能」與最小測試範圍。
  - **程式碼審閱結論**：該段以 `transaction.atomic()` 包住所有 `Evidence` 建立，例外時 `except` 逐筆 `evidence.upload.delete(save=False)` + `evidence.delete()` 後重拋，**結構上保證不殘留**。
  - **建議後續**：以獨立 R07 種子腳本做一次端到端無效 PDF 上傳，斷言 `Evidence.objects.count()` 前後不變。

---

## 六、PASS / FAIL / BLOCKED / NOT TESTED 計數

| 類別 | 數量 | 明細 |
|---|---|---|
| PASS | **21** | 正向鏈 8（T1–T6）＋ 負向 13（N1–N12，N6 含前置） |
| FAIL | **0** | — |
| BLOCKED | **0** | — |
| NOT TESTED | **1** | Django 成長記錄「無效 PDF → 無殘缺 Evidence」端到端（見第五節理由） |

---

## 七、8140 / 8141 / 8142（及測試用 8143）清理結果

| 埠 | 收尾狀態 |
|---|---|
| 8140（Django） | released |
| 8141（Gateway+Live） | released |
| 8142（Entry） | released（`verified P3H process stopped`） |
| 8143（原始 Live 測試實例） | released（taskkill 終止 PID 26668） |

所有隔離程序已停止，埠全部釋放。

---

## 八、8022 / 8770 保護狀態

| 埠 | 收尾狀態 | 說明 |
|---|---|---|
| 8022（正式 Django） | listening，PID 4328 | 全程未碰觸 |
| 8770（RAG） | listening，PID 9284 | 全程未碰觸 |

本輪所有啟動／停止均只作用於隔離候選（8140–8143），未對正式服務發出任何信號。

---

## 九、是否具備建立本機審計 Commit 的條件

**具備，但依裁決本輪不提交。** 判斷依據：

1. `git diff HEAD` 為空 → 無任何已追蹤檔案被改動，核心安全邏輯零變更，不存在污染正式碼的風險。
2. 全部產物集中於未追蹤的 `ops/p3h/`（11 檔）與 1 份計畫文件，邊界清楚，可一次性 `git add ops/p3h/ docs/superpowers/plans/2026-10-25-…md` 形成單一審計 commit。
3. 安全測試 21 項全 PASS、0 FAIL，具備可重現證據（本報告第四節）。
4. 唯一未竟項（Django 無效 PDF 端到端）為 NOT TESTED 且已附理由與後續方案，不構成阻擋。

**建議的 commit 訊息（待批准後才執行）**：

```
P3-H 第十階段：變更審計與安全驗收補齊

- 新增 ops/p3h/verify_p3h_security_negative.py：13 項負向安全測試
  （過期/竄改/aud-iss-sub/跨擁有者/登出/惡意 Origin/缺 CSRF/
   無效 Evidence/Django 離線/Live 離線），全 PASS。
- 啟動器加入 process 層級 proxy 清除，修復 Start-Process 大小寫重複
  proxy 鍵崩潰（隔離棧得以啟動）。
- test_p3h_start_environment_restore.ps1 補 UTF-8 BOM。
- 核心安全邏輯零修改；未 push/merge/deploy。
```

**未執行**：commit / push / merge / deploy（依本輪裁決）。等待批准。

---

## 附錄：本輪新增測試腳本用法

```
# 非破壞性負向測試（N1–N10）
python ops/p3h/verify_p3h_security_negative.py

# Fail Closed（N11–N12，會停 Django/閘道，僅收尾前用）
python ops/p3h/verify_p3h_security_negative.py --failclosed

# 必要環境變數
DJANGO_SETTINGS_MODULE=config.settings
DJANGO_DB_NAME=<candidate>/p3h.sqlite3
DJANGO_MEDIA_ROOT=<candidate>/media
DJANGO_DEBUG=true
P3H_ASSERTION_KEY=<與啟動一致>
P3H_PROXY_KEY=<與啟動一致（= GatewayKey）>
P3H_CANDIDATE_ROOT=<candidate>
P3H_LIVE_RAW_BASE=http://127.0.0.1:8143   # 未包閘道的原始 Live
```

> 注意：負向測試需先以 `app.main:app` 另起一個原始 Live（同 Assertion/Proxy 金鑰、`FDE_LIVE_DEV_MODE=false`），因 8141 是閘道，會剝除偽造的身分標頭。
