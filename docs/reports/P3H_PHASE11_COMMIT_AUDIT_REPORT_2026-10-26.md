# P3-H 第十一階段：本機審計 Commit — 完整審計報告

- 日期：2026-10-26
- 工作樹：`D:\FDE-AI-UAS-v2.0-p3h-local-backend`
- 分支：`codex/p3h-local-backend`
- 授權：僅本機 Commit；禁止 Push / Merge / Rebase / Deploy；禁止改正式服務、其他工作樹、H3 ACTIVE。
- 本報告為第十一階段產物，**未提交**（僅授權一個 commit），留在工作樹待下一階段裁決。

---

## 一、提交前基線重新核實（未沿用舊報告）

| 項目 | 實測 |
|---|---|
| 分支 | `codex/p3h-local-backend` |
| HEAD（提交前） | `98523d685b6b43f6c8d113f3281fc2f0f74896e5`（P3-F D） |
| `git diff HEAD` | **空**（無任何已追蹤檔案修改） |
| 未追蹤 | `ops/p3h/`（11 檔）、`docs/reports/P3H_PHASE10_…md`、`docs/superpowers/plans/2026-10-25-…md` |
| 備份 `.bak` | 工作樹內**無** |

---

## 二、提交前安全審計（逐檔）

### 2.1 七項檢查結論

| 檢查 | 結論 |
|---|---|
| 1. 屬 P3-H 開發範圍 | ✅ 11 個 `ops/p3h/` 檔（啟動器／停止器／契約測試／HTTP 驗收）＋ 1 份第十階段審計報告 |
| 2. 含正式或測試 Secret | ⚠️ 僅含**自述式隔離佔位值**（見 2.3），無正式 Secret |
| 3. 含密碼／Session Cookie／CSRF Token／Assertion Token | ✅ 無（無任何執行期 Token；密碼均為 `secrets.token_urlsafe(32)` 執行期生成，不落檔） |
| 4. 含 SQLite／PDF／媒體／日誌／PID／程序狀態檔 | ✅ 無（候選資料在 `%TEMP%` 之外，未進 repo） |
| 5. 含絕對路徑形式的敏感設定 | ✅ 無（腳本以 `$PSScriptRoot`／`$env:TEMP` 相對推導；掃描無 `C:\`/`D:\` 硬編碼） |
| 6. 含不應提交的備份 | ✅ 無（`.bak` 掃描為空） |
| 7. 會覆蓋正式環境的預設值 | ✅ 無（啟動器強制候選埠並拒絕 8022/8030/8770；`FDE_GATEWAY_DJANGO_ORIGIN` 僅指候選 Django） |

### 2.2 檔案型態與編碼

12 個候選檔全部為 UTF-8 文字，NUL 位元組 = 0，無二進位。`git diff --cached --numstat` 全為「新增行/0」，無 `-`（二進位）。

### 2.3 掃描到的 key 類字串（全部為非敏感佔位值）

| 位置 | 值 | 判定 |
|---|---|---|
| `invoke-p3h-django.ps1:40` | `DJANGO_SECRET_KEY='p3h-isolated-only-key'` | 隔離候選 Django 專用，非正式；僅作用臨時 SQLite |
| 同上 | `FDE_LIVE_ASSERTION_KEY='p3h-isolated-assertion-key'` | 隔離簽章金鑰，非正式 |
| 同上 | `FDE_GATEWAY_INTERNAL_AUTH_KEY='p3h-isolated-gateway-key'` | 隔離內部金鑰，非正式 |
| `test_p3h_start_contract.ps1:32` | `AssertionKey='test-assertion-key-not-for-production'` | 契約測試用，自述 not-for-production |
| `test_p3h_start_contract.ps1:33` | `GatewayKey='test-gateway-key-not-for-production'` | 同上 |

> 判斷：以上皆為**隔離測試專用佔位字串**，在正式環境無效、無法取得任何正式資源，且命名自述用途。不構成正式或可用 Secret，故未阻擋提交，但完整列出供教師覆核。

### 2.4 高風險秘密樣式掃描（staged diff）

`BEGIN * PRIVATE KEY`、`AKIA…`、`ghp_…`、`github_pat_…`、`sk-…`、`xox[baprs]-…`、`sessionid=`、`csrftoken=` → **全部 0 命中**。

### 2.5 未納入本次提交

- `docs/superpowers/plans/2026-10-25-p3h-independent-local-backend.md`：P3-H 計畫文件（含未勾選任務清單），非本次驗收證據，**保留未追蹤**，未提交、未刪除。

---

## 三、本輪（Phase 11）實際重跑測試

> 全部為本輪重新執行，未沿用第十階段歷史結果。

### 3.1 Gateway 正向鏈 T1–T6（`verify_p3h_gateway_http.py`）

| 測項 | 實測 | 結果 |
|---|---|---|
| T1 health via entry | 200 | PASS |
| T2 create_session via gateway | 201 | PASS |
| T2 owner is student | `student:4998515b…` | PASS |
| T3 forged `X-FDE-Role: teacher` stripped | 201 | PASS |
| T3 still student (no escalation) | `student:4998515b…` | PASS |
| T4 unauthenticated via entry | 403 | PASS |
| T5 direct Live/Gateway without auth | 403 | PASS |
| T6 direct Django assertion without gateway key | 403 | PASS |

收尾：`CHAIN_PASS full Django->Gateway->Live Assertion HTTP chain verified in isolation`。

### 3.2 安全負向 N1–N12（`verify_p3h_security_negative.py`）

| 測項 | 實測 | 結果 |
|---|---|---|
| N1 過期 Assertion | 401 | PASS |
| N2 簽章竄改 | 401 | PASS |
| N3 audience 不符 | 401 | PASS |
| N4 issuer 不符 | 401 | PASS |
| N5 sub/role 不符 | 401 | PASS |
| N6 跨擁有者（跨 Cohort） | 403 `session_owner_required` | PASS |
| N7 登出後舊 Session | 登出 200、再建 401 | PASS |
| N8 惡意 Origin | 403 | PASS |
| N9 缺 CSRF 打 assertion 端點 | 403 | PASS |
| N10 無效 Evidence 輸入 | 400、session GET 200 | PASS |
| N11 Django 離線 Fail Closed | 503 `gateway_upstream_unavailable` | PASS |
| N12 Live 離線 Fail Closed | 503 | PASS |

`NEG_SUMMARY pass=11 fail=0`（N1–N10）＋ `pass=2 fail=0`（N11–N12）。

### 3.3 四個契約測試

| 測試 | 實測 | 結果 |
|---|---|---|
| `test_p3h_start_contract.ps1`（拒絕 8022／缺金鑰／佔用埠；接受合法 DryRun） | EXIT=0 | PASS |
| `test_p3h_django_wrapper.ps1`（拒絕相對路徑；settings 落 CandidateRoot；失敗指令非零且可續跑） | EXIT=0 | PASS |
| `test_p3h_process_management.ps1`（PID／命令列不符即拒絕，不誤殺） | EXIT=0 | PASS |
| `test_p3h_start_environment_restore.ps1`（真實啟動隨機埠 51191–51193 後還原 `FDE_GATEWAY_DJANGO_ORIGIN` 並停止） | EXIT=0 | PASS |

### 3.4 第八階段 Evidence 業務閉環（`verify_p3h_business_http.py`）

```
BUSINESS_HTTP_PASS evidence=66873d89-… sha256=6658c8881ea236c048a2c97b17c61fcbec1b1ccfd853fe8da18542db8fc4242e
teacher=200 cross_teacher=404 cross_student=404 forged=403 anonymous=302
```
與第八／九／十階段**逐位元組一致**（sha256 相同），證明閘道包裝未影響業務鏈。

### 3.5 測試計數

| 類別 | 數量 |
|---|---|
| PASS（斷言） | 21（T1–T6 共 8 ＋ N1–N12 共 13） |
| PASS（契約腳本） | 4 |
| PASS（業務閉環） | 1（內含 6 項存取/拒絕子檢查） |
| FAIL | 0 |
| BLOCKED | 0 |
| NOT TESTED | 1（Django 成長記錄「無效 PDF → 無殘缺 Evidence」端到端；需 R07 種子，程式碼以 `transaction.atomic`＋例外清理保證不殘留） |

---

## 四、Commit 建立

### 4.1 Stage 方式

逐一指定 12 個經審核檔案（**未使用** `git add .` 或 `git add -A`）：

```
docs/reports/P3H_PHASE10_AUDIT_AND_SECURITY_REPORT_2026-10-26.md
ops/p3h/invoke-p3h-django.ps1
ops/p3h/p3h-candidate.env.example
ops/p3h/start-p3h-isolated.ps1
ops/p3h/stop-p3h-isolated.ps1
ops/p3h/test_p3h_django_wrapper.ps1
ops/p3h/test_p3h_process_management.ps1
ops/p3h/test_p3h_start_contract.ps1
ops/p3h/test_p3h_start_environment_restore.ps1
ops/p3h/verify_p3h_business_http.py
ops/p3h/verify_p3h_gateway_http.py
ops/p3h/verify_p3h_security_negative.py
```

### 4.2 Staged 檢查

- `git diff --cached --stat`：**12 files changed, 1319 insertions(+), 0 deletions(-)**
- `git diff --cached --check`：**check-ok**（無空白錯誤）
- `git diff --cached --numstat`：全為文字，無二進位
- 無 DB／媒體／日誌／備份檔名

### 4.3 Commit

- 訊息：`feat(p3h): validate isolated business and gateway HTTP closure`
- 結果：`[codex/p3h-local-backend dfef115] … 12 files changed, 1319 insertions(+)`

---

## 五、提交後驗證

| 項目 | 值 |
|---|---|
| Commit SHA | `dfef115dc911e25ad0604ff3534bffbe968adc21` |
| Branch | `codex/p3h-local-backend` |
| Upstream | **無**（local only，未 push） |
| `git status` | 僅剩 `?? docs/superpowers/plans/2026-10-25-…md`（計畫文件，保留未追蹤） |
| `git diff --stat HEAD` | 空（committed blobs 與工作樹一致） |

### 5.1 Commit 檔案清單（12）

見 4.1；`git show --name-only HEAD` 完全一致。

### 5.2 各檔 SHA-256（提交後工作樹）

| 檔案 | SHA-256 |
|---|---|
| `ops/p3h/invoke-p3h-django.ps1` | `ac921a716af42c962d5545af91604ca452c5f0148416d2d97d274c2491625832` |
| `ops/p3h/p3h-candidate.env.example` | `6897b45b14a5e0428f0bc1f6e795a0f992301b46796fefad5ad06dd77347464d` |
| `ops/p3h/start-p3h-isolated.ps1` | `72c8c75402946b1e6407c23c7e9b545c73d2475f1ccf5fdd636faa7d1c25cb74` |
| `ops/p3h/stop-p3h-isolated.ps1` | `af565bc89fd3df91e5d9028408c3ceaf4e9c610a38a970fc7641d7f69b68e811` |
| `ops/p3h/test_p3h_django_wrapper.ps1` | `f5f5eb89ae07bbed66fb3252741caf2a867987ad5a0efbd6b30ceec9af417fd3` |
| `ops/p3h/test_p3h_process_management.ps1` | `234ec0522be2103eaaf9bdab665d1853d748e698ae224caae705e96b30aa2058` |
| `ops/p3h/test_p3h_start_contract.ps1` | `0d69ca7291c9da63d1dadd1b758f0cae8aaade0608eef2fac21121420caf2e94` |
| `ops/p3h/test_p3h_start_environment_restore.ps1` | `e930c492bac7e7e29f2640ca1191c4315148aa57d36c21f158fa22236c978c61` |
| `ops/p3h/verify_p3h_business_http.py` | `9c9bb4568805ea10cc1281e601f4cf62916eb746a24a484b5fae3b4fd0668df9` |
| `ops/p3h/verify_p3h_gateway_http.py` | `8f814a30cf81a8eb76ce39c49c5e2f21e9e5f47589e4851d7b9bc28e5849829f` |
| `ops/p3h/verify_p3h_security_negative.py` | `0222c83c862f668e9c83a93b69226e160a929fc793a44f91cb6d4145b574d8e0` |
| `docs/reports/P3H_PHASE10_AUDIT_AND_SECURITY_REPORT_2026-10-26.md` | `486fd51cff6f1d776ec1ba57f2c369aef887428032f05fedda0517a833624da1` |

### 5.3 埠位

| 埠 | 狀態 |
|---|---|
| 8140 / 8141 / 8142 / 8143 | 全部 **released** |
| 8022（正式 Django） | listening，PID 25256（**本輪未碰觸**；PID 較第十階段 4328 變動，屬外部重啟） |
| 8770（RAG） | listening，PID 9284（**本輪未碰觸**） |

### 5.4 其他工作樹

`git worktree list` 顯示 17 個工作樹；除本工作樹 `D:/FDE-AI-UAS-v2.0-p3h-local-backend` 前進至 `dfef115` 外，其餘 HEAD **全部未變**，未清除任何未提交修改。

---

## 六、結束狀態

- 已完成單一本機審計 Commit：`dfef115`。
- **未 Push、未 Merge、未 Rebase、未 Deploy**。
- 未進入 HTTPS／Tunnel／公開部署。
- 等待下一階段批准。
