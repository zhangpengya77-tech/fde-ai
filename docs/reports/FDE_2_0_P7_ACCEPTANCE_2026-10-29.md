# FDE-AI 2.0｜P7 雙軌驗收交付報告

- 日期：2026-10-29
- 執行環境：`D:\FDE-AI-UAS-v2.0-p6-security-preprod`（分支 `codex/p6-security-preprod`，HEAD `98523d6`，基於主樹 HEAD `0648115`）
- 主工作區：`D:\FDE-AI-UAS-v2.0`（分支 `feat/m02-simulator-entry`，HEAD `06481159`）——**本輪未對其做任何寫入**
- 授權範圍：P7-A／P7-C／P7-D 已核准；P7-B 僅產出發布候選與差異報告，**不覆寫主工作區**
- 禁止項遵守情形：未修改正式 v1.5C／8022／8770／正式 Pages／Worker／Tunnel／DNS／正式 DB／正式 Registry／排程；未 Push／Merge／正式 Deploy／正式 ACTIVE

---

## 零、先講結論（給教師的裁決要點）

| 項目 | 狀態 | 一句話 |
|---|---|---|
| P7-C CW／CCW 語義與同步 | **完成** | 已確認 CW/CCW 為「機體座標系旋向」，非觀察視角；映射已同步進 P6，15 項測試全過 |
| P7-B 最小發布候選 | **完成（但不可發布）** | 17 檔清單＋SHA-256＋補丁＋回滾已備齊；**P6 安全鏈路存在 5 個阻斷級缺陷，見 3.5** |
| P7-A HTTPS 隔離預發布 | **基礎設施完成、正向鏈路不通** | 四層 HTTPS 棧實跑；攻擊面 15 項全擋住；但**正向（合法使用者）路徑全斷**，且發現匿名寫入漏洞 |
| P7-D 真實槳葉資料方案 | **完成** | 四類契約維持、獨立留出集、mAP50 ≥ 0.5 閘門，未造假資料 |

**最重要的結論：P6 目前是「負向全通、正向全斷」。** 十項負向驗收全過，是因為整條簽章鏈路沒有任何請求能成功（B3／B4／B5），同時還存在匿名寫入（B6）。**不建議進入發布流程。**

**需要教師裁決的五件事**：
1. **B6 匿名寫入**（最高優先）：`POST /api/v1/vision/submissions` 無任何授權，實測匿名 201 並可偽造 `student_id`。是否核准在 P6 補上學員身分校驗？
2. **B2 入口剝離 `Cookie`**：是否為刻意設計？是否核准改為「僅對 Live 路徑剝離、Django 路徑保留」？
3. **B3／B4 斷言鏈路**：Gateway 需改用遮罩 CSRF token 並把 method／path／body 傳給 Django。這是 3 處以上改動，是否授權在 P6 內修？
4. **B5 保護範圍**：`PROTECTED_PREFIX` 只含 `/api/live/`，`/api/v1/vision/*` 無斷言來源。要改前綴，還是改拓撲（把 `/api/v1/` 也納入 Gateway 保護）？
5. 8022 在會話期間 PID 由 24004 變為 14612（非我下令；期間曾因設定缺失把登入請求誤送到 8022，詳見第七節）。

---

## 一、P7-C｜CW／CCW 語義確認與同步

### 1.1 語義裁決（§四 要求的「先確認」）

**結論：CW／CCW 是「螺旋槳旋向（規格方向）」，定義於機體座標系；不是「觀察視角方向」。**

四類 = **旋向 × 槳面** 兩個正交屬性：

| 類別 | 旋向 | 槳面 |
|---|---|---|
| `CW_F` | 順時針 | 正面（面向相機） |
| `CCW_F` | 逆時針 | 正面 |
| `CW_B` | 順時針 | 背面 |
| `CCW_B` | 逆時針 | 背面 |

證據鏈（皆為磁碟既有內容，非推論）：

1. **設計文件明定錨點**：`docs/superpowers/specs/2026-10-08-teacher-vision-rule-templates-design.md:61`——「機體位置語意：M1 右前、M2 左後、M3 左前、M4 右後（教師 2026-10-08 確認）；**畫面解讀以現有 F450 機頭方向定義為準**」。
2. **規則引擎的期望值服從機械事實**：`vision_center.py` `evaluate_prop()` 要求 M1／M2（右前／左後，對角）同為 `CCW_F`，M3／M4（左前／右後，對角）同為 `CW_F`。對角馬達同旋向是四軸力矩平衡的必要條件，**與相機位置無關**。
3. **系統明確分離「旋向」與「視角」**：同文件的 `REVIEW` 條件包含「**畫面方向無法可靠取得**」——即視角不明時系統拒絕猜測，證明旋向不是從畫面「看起來」的方向。
4. **規則層把三者當獨立屬性組合**：`規則層責任 = 將偵測出的 CW/CCW、正反面與 M1–M4 位置關係組合為教學結果`。

**因此**：剝離槳面（`_F`／`_B`）取得 CW／CCW 在語義上合法；`CW_F` 與 `CW_B` 必為同一旋向。若語義是「觀察視角」，則從背面看順時針應變逆時針，`CW_B` 就該對應 `CCW`——本專案不是這個定義。

**必要限制（已寫入程式註解）**：此對應表**只可用於顯示與統計，不得用於 PASS／NG 判定**。判定仍走 `evaluate_prop()` 的四類規則，否則等於把四類規則靜默降級為兩類。

### 1.2 四類契約（未變動）

```
PROP_CLASSES = ("CW_F", "CCW_F", "CW_B", "CCW_B")
0 = CW_F    1 = CCW_F    2 = CW_B    3 = CCW_B
```

與實體模型核對：`PROP_20261024_DEMO-A_v1`（SHA `02995b79…`）的 `model_names` 恰為 `{0:CW_F, 1:CCW_F, 2:CW_B, 3:CCW_B}`，**與契約順序完全一致**。

> 注意：學員端自建資料集的 `class_index` 順序為 `CCW-B, CCW-F, CW-B, CW-F`（ID 0／3 對調，見 `docs/handoffs/WORKBUDDY_TO_CODEX_P05.md:18`）。因此映射**必須在「索引→類別名」解析完成之後**套用，絕不可直接作用於原始索引。

### 1.3 同步實作

- 檔案：`live_backend/app/vision_center.py`
- 新增：`PROP_DIRECTION_TO_CW_CCW`、`map_prop_to_direction()`，位置在 `evaluate_prop()` 之後、`_solve_linear()` 之前
- **執行碼與主樹逐位元一致**：區塊 SHA-256 = `a8dd30e9c2d5a958c94f884e8698f3d6b5c214e515c37c8de30d7ac6190a2a4e`（兩樹相同）
- 唯一差異：P6 版多了一段「語義基礎＋顯示專用」註解（純註解，不改行為）
- 同步前備份：`ops/p7/backup/vision_center.py.before_p7c`（原 SHA `96b17f7b…`）

### 1.4 驗證案例與測試結果

新增 `live_backend/tests/test_prop_direction_cw_ccw.py`，**15 項全過**（`Ran 15 tests ... OK`）：

| 組別 | 覆蓋 |
|---|---|
| 映射基本 | 四類→兩類、大小寫／空白容錯、未知類別回 None、空值回 None、涵蓋完整性、無多餘鍵 |
| **正面** | `CW_F→CW`、`CCW_F→CCW` |
| **反面** | `CW_B→CW`、`CCW_B→CCW` |
| **相機視角** | 正面與反面必須同旋向；反向斷言 `CW_B ≠ CCW`、`CCW_B ≠ CW`（若日後有人改成視角語義會立刻失敗） |
| 四類契約保護 | 順序精確、索引位置、`evaluate_prop` 仍產出四類字串、槳面錯誤仍判 `FACE_WRONG`、映射不得污染判定（M2 旋向錯時整體必須 NG 而非被降級成 PASS） |

P6 迴歸：`test_vision_center` **41／41 OK**。

---

## 二、P7-B｜安全模組最小發布候選

### 2.1 分叉關係（重要前提）

主樹 HEAD `0648115` **是** P6 HEAD `98523d6` 的祖先（`git merge-base` 實測）。兩棵樹的檔案行數落差（如 `views.py` 6325 vs 5657）**不是 P6 刪了主樹功能**，而是主樹工作區有約 977 行**未提交**的 R07 工作在 P6 中不存在。

因此：
- 「最小發布候選」= `git diff 0648115..P6工作區`，天然排除主樹未提交工作
- **不可以檔案複製或整檔覆蓋**（會把主樹未提交工作洗掉或產生衝突）

### 2.2 發布檔案清單與 SHA-256

見 `ops/p7/evidence/p7b-release-manifest.json`。摘要（17 檔）：

| 組 | 檔案 | 性質 | 行數 | SHA-256（前 16） |
|---|---|---|---|---|
| A | `live_backend/app/internal_auth.py` | 新增 | 211 | `04b7ea9585012a59` |
| A | `live_backend/app/live_assertions.py` | 新增 | 316 | `71fa28ceab6feca5` |
| A | `live_backend/app/gateway.py` | 新增（已提交） | 224 | `1a9c4eb0d76fc135` |
| A | `live_backend/app/main.py` | 修改 | 761 | `48b5f6c5e3fd50f2` |
| A | `live_backend/app/vision_api.py` | 修改 | 508 | `9f43fed63a305b6d` |
| A | `live_backend/app/sessions.py` | 修改 | 914 | `1ee99e2841b357bc` |
| A | `live_backend/gateway_main.py` | 新增（已提交） | 10 | `4acd6446ac4cebef` |
| A | `live_backend/_run_unittests.py` | 新增（已提交） | 15 | `ec2958ba11ed1d30` |
| B | `student_portal/learning/internal_auth.py` | 新增 | 75 | `b3b0a7100ee9c116` |
| B | `student_portal/learning/live_assertions.py` | 新增 | 188 | `98c2aaadb1079cf1` |
| B | `student_portal/learning/views.py` | 修改 | 5657 | `8680c0d865486e0b` |
| B | `student_portal/learning/vision_submission.py` | 修改 | 463 | `32ca4eeaf948cc63` |
| B | `student_portal/learning/vision_preflight.py` | 新增 | 47 | `64f18ce318006bb2` |
| B | `student_portal/learning/urls.py` | 修改 | 200 | `70b252ea6a021302` |
| B | `student_portal/config/settings.py` | 修改 | 374 | `e44ad54a4bfd80bf` |
| C | `cloudflare/dev-phase1a/worker.mjs` | 修改 | 91 | `8a009e59f5d1dd1d` |
| C | `demo/tools/static_entry_server.py` | 修改 | 586 | `06a97a4880e87b15` |

補丁：`ops/p7/p7b-security-tracked.patch`（2355 行，SHA-256 `4ee2c9cfd51b7013f1f531248eea4c0250ab4bae14d04f96900db87951ba4fdb`），涵蓋 14 個已跟蹤檔，+1645／−69。

### 2.3 依賴清單（環境變數）

| 變數 | 用途 | 缺失後果 |
|---|---|---|
| `FDE_INTERNAL_SHARED_SECRET` | Live 驗章密鑰（＝Django `FDE_LIVE_ASSERTION_KEY` 同值） | fail closed，全部受保護 API 403 `secret_not_configured` |
| `FDE_LIVE_ASSERTION_KEY` | Django 簽發密鑰 | 斷言端點 503 `live_assertion_unavailable` |
| `FDE_GATEWAY_INTERNAL_AUTH_KEY` | Gateway→Django 專用鑰 | 斷言端點 403 `live_assertion_forbidden` |
| `FDE_LIVE_PROXY_KEY` | Gateway→Live 專用鑰 | Gateway 整體不可用 |
| `FDE_LIVE_ASSERTION_TTL_SECONDS` | 有效期（上限硬夾 60） | 預設 60，超出自動夾回 |
| `FDE_REPLAY_LEDGER_PATH` | 重放帳本 SQLite | 走預設路徑（可能與其他實例共用） |
| `FDE_ALLOW_UNSIGNED_LEGACY` | 相容模式旗標 | **必須不設**；即使設為 1，只要有密鑰仍 fail closed |
| `FDE_DJANGO_PORTAL_URL` | Live→Django portal 目標 | **預設 8022（正式）**，隔離環境必設，見第八節事故 |
| `DJANGO_DEBUG` | 必須 false | true 時全部 Secure／重導保護關閉 |
| `DJANGO_TRUST_PROXY_SSL_HEADER` | 是否信任 `X-Forwarded-Proto` | 未設時 Django 永遠判定為 http，Cookie 無 Secure |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | CSRF 受信來源 | 未設且非 DEBUG 時啟動失敗 |

### 2.4 回滾方案

1. P6 為獨立 worktree，**回滾 = 不採用**，主樹零改動。
2. 若已在 P6 內回滾：`git checkout 98523d6 -- <file>` 逐檔還原（本輪所有新檔皆為未跟蹤，直接刪除即可）。
3. 若曾誤套用至其他樹：`git apply -R ops/p7/p7b-security-tracked.patch`（補丁可逆）。
4. 資料面無 migration 變更，**無需 DB 回滾**。

### 2.5 發布阻斷項（P7-B 的核心發現）

**入口層剝離 `Cookie`，使瀏覽器登入鏈完全失效。**

- 位置：`demo/tools/static_entry_server.py:160`
  ```python
  CLIENT_IDENTITY_HEADERS = frozenset({"cookie", "authorization", "forwarded", "x-real-ip"})
  ```
- **為 P6 新增**：`git show 0648115:demo/tools/static_entry_server.py` 中不存在此常數；`git diff 0648115` 顯示為 `+` 行。
- 後果：經公開入口的請求，`Cookie` 一律被丟棄 → Django 永遠收不到 `sessionid` → 所有需登入的頁面與 API 失效。
- 已實測：經 HTTPS 入口 `POST /login/` 固定 403「CSRF 驗證失敗」；直連 Django（繞過入口）則正常發放 `Secure` Cookie。
- 影響面：若此版本上線，**學員端與教師端全部無法登入**。
- 建議修法（**待核准，未自行修改**）：把 `cookie` 從 `CLIENT_IDENTITY_HEADERS` 移除，僅保留 `authorization` 與轉發類標頭；或維持剝離但改由 Gateway 以獨立機制取得 Session（需另外設計，成本較高）。

> 補充：`demo/tools/static_entry_server.py:157` 的註解寫「Cookie / Authorization：上游不得看到外部瀏覽器的憑證」，顯示此改動是**刻意的安全決策**。因此本輪不擅自回退，交由教師裁決。

---

## 三、P7-A｜HTTPS 隔離預發布

### 3.1 拓撲（全部本機，未使用任何外部雲端資源）

```
腳本 ──HTTPS:8443──► TLS 終結器（自簽，ops/p7/tools/tls_entry.py）
                        └─► 入口 :8122（static_entry_server，Host/Origin 檢查＋標頭剝離）
                              └─► Gateway :8123（Django Session → 短效 Assertion 注入）
                                    ├─► Live :8121（驗章、重放帳本、視覺 API）
                                    └─► Django :8120（Session／CSRF／斷言簽發）
```

隔離邊界：

| 項目 | 隔離位置 |
|---|---|
| Django | :8120（正式為 8022） |
| Live | :8121 |
| 測試 DB | `ops/p7/runtime/db/p7a.sqlite3`（全新，19 個 migration 套用完成） |
| 模型 Registry／Store | `ops/p7/runtime/live-var/vision-center/` |
| Media | `ops/p7/runtime/media/` |
| Logs | `ops/p7/runtime/logs/` |
| 密鑰 | `ops/p7/runtime/p7a.env`（3 把獨立隨機密鑰，互不相同） |
| TLS | 自簽憑證 `ops/p7/tls/p7a-cert.pem`（CN=localhost，SAN 含 127.0.0.1，7 天） |

**外部雲端資源：無。** 未建立或修改任何 Cloudflare／Worker／Tunnel／DNS 資源，故不需 §二 的外部資源核准。

### 3.2 十項驗收結果（真實 HTTP，證據見 `ops/p7/evidence/p7a-verification.json`）

| # | 項目 | 結果 | 證據摘要 |
|---|---|---|---|
| 1 | `DEBUG=False` | **PASS** | `http://127.0.0.1:8120/login/` → 301 → `https://…`（`SECURE_SSL_REDIRECT` 生效） |
| 2a | CSRF Cookie Secure | **PASS** | `csrftoken=…; Path=/; SameSite=Lax; **Secure**`（經 HTTPS 入口） |
| 2b | Session Cookie Secure＋HttpOnly | **PASS（屬性）** | 直連 Django 登入成功後：`sessionid=…; HttpOnly; SameSite=Lax; **Secure**`；經入口仍 403（見 3.5 B2） |
| 3 | Gateway 斷言不得被降級 | **PASS** | 帶偽造 `X-FDE-Role`／`X-FDE-Teacher-ID`／`X-FDE-Live-Assertion` → 403 `internal_auth_rejected: assertion_required` |
| 4a | 重放保護 | **PASS** | 同一 jti 第一次 200、第二次 403 `replay_detected` |
| 4b | 過期拒絕 | **PASS** | iat 落於 120 秒前 → 403 `expired_assertion` |
| 4c | 60 秒上限 | **PASS** | iat 超前 3600 秒 → 403 `future_assertion` |
| 5a | 跨班級（僅角色端點） | **INFO** | `cohort_ids=[2]` → 200，此端點只檢查 role，不作通過依據 |
| 5b | 班級範圍互斥 | **PASS（DB 層）** | `teacher_a={COHORT-A}`、`teacher_b={COHORT-B}`、交集為空、學員 S1 僅在 A（見 3.5 表 5） |
| 6a | 直連 Live 未授權拒絕 | **PASS** | 無憑證 → 403 `assertion_required` |
| 6b | 對照：公開端點 | **INFO** | `GET /api/v1/vision/models` → 200（GET 分支刻意不呼叫 `_teacher`，非漏洞） |
| 7a | 原始 Origin 無法繞過 | **PASS** | `Origin: https://evil.example` → 403 |
| 7b | 直連＋偽標頭＋偽 Origin | **PASS** | → 403 `assertion_required` |
| 8a | 學員可進入視覺 API | **PASS** | 學員斷言 → `prop-check` 200，回 `PROP_RULE_v1` 四槳位結果 |
| 8b | 教師可讀受保護資源 | **PASS** | 教師斷言 → `hard-examples` 200（資料來自隔離 Registry） |
| 9 | Live 不可用時安全失敗 | **PASS** | 上游不可達 → 502 結構化錯誤信封，不偽裝成功 |
| 8c | 學員上傳（正向鏈路） | **BLOCKED** | 見 3.5：經 Gateway 無法取得斷言；且端點本身不驗證身分（B6） |
| 8d | 教師複核（正向鏈路） | **BLOCKED** | 見 3.5：Gateway 取斷言回 503 `gateway_identity_unavailable`（B3）；手工簽發則 403 `method_mismatch`（B4） |
| 11 | 受保護請求的正向可達性 | **FAIL** | 任何經 Gateway 的受保護請求都無法成功（B3＋B4＋B5） |
| 12 | 提交端點的授權 | **FAIL** | `POST /api/v1/vision/submissions` 無任何憑證 → 201，`student_id` 可任意偽造（B6） |
| 10 | 不影響正式 v1.5C | **PASS** | `demo.sqlite3` = `fdaf1805…`，與 P-16 基線一致；正式 Registry／DB 未寫入 |

**合計：15 PASS／2 BLOCKED／2 INFO／2 FAIL（新增第 11、12 項）。**

> 第 11、12 項是本輪追加發現，**不在原十項之內**，但屬於發布前必須處理的阻斷級問題。

### 3.3 過程中修掉的環境問題（非產品缺陷）

| 問題 | 處理 |
|---|---|
| Django 缺 `whitenoise` Manifest 靜態清單 → 500 | 執行 `collectstatic`（411 檔後處理） |
| Django 未信任 `X-Forwarded-Proto` → Cookie 無 Secure | 設 `DJANGO_TRUST_PROXY_SSL_HEADER=true` |
| Gateway／Live 的 uvicorn 未信任本地 XFP | 設 `FORWARDED_ALLOW_IPS='*'`（僅本機隔離環境） |
| Windows 雙綁導致舊 Django 進程繼續應答 | 以 `netstat` 找出重複 PID 並終止 |

### 3.4 P6 Django 側的啟動缺陷（已修，1 行）

`student_portal/learning/internal_auth.py:21` 讀 `live_assertions.ASSERTION_HEADER`，但 Django 側 `live_assertions.py` **從未定義該常數**（只存在於 Live 側）→ `AttributeError`，**Django 應用根本無法啟動**。

- 影響：這說明 P6 的 Django 側此前從未被真正啟動過（先前測試只覆蓋 Live 端）。
- 修法：在 `student_portal/learning/live_assertions.py` 補上 `ASSERTION_HEADER = "X-FDE-Live-Assertion"`（與 Live 同值，不改行為）。
- 修後：`manage.py migrate`、`collectstatic`、`runserver` 全部正常。

### 3.5 追加驗收：正向鏈路（happy path）不可用——五個致命阻塞

十項驗收的「負向」全數擋住，但進一步追查「正向能不能走通」時，發現 **P6 的簽章鏈路從來沒有成功過**。以下每一項都有可重跑的實測證據（`ops/p7/tools/verify_p7a_flow.py`、`ops/p7/evidence/p7a-supplementary.json`）。

#### B2｜入口層剝離 `Cookie`，瀏覽器登入恆 403

`demo/tools/static_entry_server.py:160` 的 `CLIENT_IDENTITY_HEADERS` 含 `"cookie"`，而 `_proxy()`（:449）對**所有**上游（含 Django）都套用剝離。

三組對照實驗（其餘條件完全相同，只差 Cookie 是否送達）：

| 組別 | 條件 | `POST /teacher/login/` |
|---|---|---|
| A | 直連 8120＋注入 `Cookie`（模擬「不剝離」） | **302 → `/teacher/`**，並發 `sessionid` |
| B | 直連 8120＋不注入 `Cookie`（模擬「剝離」） | **403** |
| C | 經 TLS 入口 8443（現況） | **403** |

→ A 成功、B/C 失敗，**唯一差異就是 Cookie**，可判定為單一成因。

> 註：`_proxy()` 只有一個呼叫點，Django 與 Live 共用同一套剝離規則；但程式註解寫的意圖是「**Live Backend** 只信任 Django 簽發的 Assertion」，Django 入口頁本身必須收到瀏覽器 Cookie。實作範圍明顯大於註解所述的意圖。

#### B3｜Gateway 取不到 Assertion：`X-CSRFToken` 填錯值

`live_backend/app/gateway.py:86` 的 `_csrf_from_cookie()` 把 `csrftoken` **Cookie 值**直接回填 `X-CSRFToken`。但 Django 4.1+ 的 CSRF 是**遮罩制**：Cookie 存的是 secret，表單／標頭要送的是 `mask + secret` 的遮罩值，兩者不同。而 `student_portal/learning/views.py:448` 的 `live_identity_assertion` 帶 `@csrf_protect`。

實測：`POST /api/live/sessions`（經 Gateway 8123）→ **503 `gateway_identity_unavailable`**（Gateway 把 Django 的 403 映射成 503）。
對照：手工帶**頁面抓到的遮罩 token** 呼叫同一端點 → **200，成功取得 Assertion**。

→ 也就是說：**只要走 Gateway，任何受保護請求都拿不到 Assertion**。

#### B4｜Assertion 的 `method`／`path` 恆為 `GET /`

`gateway.py:181` 呼叫 Django 時送的是 `json={}`；`live_identity_assertion` 只用 `body.get("enrollment_id")` 組 claims，**沒有帶入本次請求的 method／path／body 雜湊**。於是 `issue_assertion()` 的預設值 `method="GET"`、`path="/"`、`body_sha256=EMPTY` 被原樣簽進去。

Live 端 `internal_auth` 會比對實際請求 → 實測結果：

- 教師讀 `/api/v1/vision/hard-examples` → 403 `internal_auth_rejected: method_mismatch`
- 學員讀同一路徑 → 403 `internal_auth_rejected: path_mismatch`

→ 即使 B3 修好，斷言仍然**不可能對上任何真實請求**。

#### B5｜Gateway 只保護 `/api/live/*`，`/api/v1/vision/*` 沒有斷言來源

`gateway.py:22` `PROTECTED_PREFIX = "/api/live/"`。`/api/v1/vision/*` 不注入斷言直接放行，但 Live 的教師端點（`_teacher()`）要求斷言 → 經 Gateway 呼叫一律 `assertion_required`。

實測：帶合法教師 session Cookie 經 Gateway 8123 讀 `hard-examples` → 403 `assertion_required`。

#### B6｜提交端點完全沒有授權（匿名可寫）

`POST /api/v1/vision/submissions` 的分支（`vision_api.py:230`）**沒有呼叫 `_teacher()`，也沒有任何 `internal_auth` 檢查**。

實測：完全不帶任何憑證 → **201**，且 `student_id` 由請求者任意指定：

```
無任何憑證 POST /api/v1/vision/submissions -> 201
{"submission_id":"sub-e199993d-…","task_id":"PROP_DIRECTION","student_id":"attacker",…}
```

→ 任何能連到 Live 的人都能以任意學員身分寫入提交，污染 Registry 與成長紀錄。這是**發布前必須修**的問題。

#### 五個阻塞的相互關係

| 編號 | 阻塞 | 影響 | 是否需要改產品碼 |
|---|---|---|---|
| B2 | 入口剝離 Cookie | 瀏覽器完全無法登入 | 是（1 行，或改為僅對 Live 路徑剝離） |
| B3 | Gateway CSRF 取值錯 | 經 Gateway 取不到 Assertion | 是（Gateway 需改用遮罩 token，或該端點改以共享密鑰鑑別） |
| B4 | 斷言未綁定 method/path | 斷言永遠對不上真實請求 | 是（Gateway 需把 method/path/body 傳給 Django） |
| B5 | `/api/v1/*` 無斷言來源 | 教師視覺 API 經 Gateway 不可達 | 是（調整 `PROTECTED_PREFIX` 或改拓撲） |
| B6 | 提交端點無授權 | 匿名可偽造學員提交 | 是（補上學員身分校驗） |

**結論：P6 的安全模組目前是「負向全通、正向全斷」。** 十項負向驗收之所以全過，正是因為整條鏈路沒有任何一個請求能成功。這不影響 P7-C 的槳葉語義結論，但**直接否決「可以發布」的判斷**。

---

## 四、P7-D｜真實槳葉資料驗證、標註與訓練方案

**原則：不得以假資料訓練、不得以普通照片冒充槳葉、不得降低品質閘門。**

### 4.1 現況（已核實）

| 項目 | 現況 |
|---|---|
| 真實槳葉樣本 | **0**（`validation_sets/prop/manifest.json`：`image_count: 0`、`frozen: false`、`review_status: BLOCKED_NO_REAL_SAMPLES`） |
| 可訓練模型 | 2 組權重／4 筆 Registry 記錄（兩兩同檔） |
| 4 類模型 `02995b79…` | mAP50 = 0.35139、P = 0.71888、R = 0.33705、50 epoch（GPU resume，2026-10-24） |
| 6 類模型 `2ae4dac3…` | mAP50 = 0.11746、P = 0.00421、R = 0.65、30 epoch（CPU，2026-10-11），類別含錯字 `CCE-F`／`CCF-b` |
| 評估性質 | 上述 mAP50 為**訓練期驗證值**，非獨立留出集評估；`evaluation_status = NOT_EVALUATED` |

### 4.2 資料收集與標註規格

1. **拍攝要求**：真實四軸機（F450）俯拍；至少涵蓋「整機四槳同時入鏡」與「單槳特寫」兩種取景；含自然光、室內日光燈、逆光、反光、雜亂背景、斜角。
2. **姿態要求**：每個槳位都要有「正面朝上」與「背面朝上」兩種實拍；並額外收「相機從機尾拍」與「相機從機頭拍」兩組，用來驗證旋向判定不隨視角漂移。
3. **標註規則**（四類，順序即索引）：
   - `0 = CW_F`、`1 = CCW_F`、`2 = CW_B`、`3 = CCW_B`
   - 標註前必須先確定「機頭方向」，並在檔名或 metadata 記錄機頭朝向；**機頭不明者不得標註旋向**，直接剔除。
   - 槳面以「面向鏡頭的那一面」為準；翻面即改 `_F`／`_B`，旋向不變。
4. **一致性**：抽 10% 做雙人標註，計算 inter-annotator agreement；未達標前不進入訓練。

### 4.3 資料切分與驗收閘門

| 集合 | 比例 | 規則 |
|---|---|---|
| Train | 70% | 允許增強 |
| Val | 15% | 訓練期使用 |
| **Hold-out（獨立留出）** | 15% | **訓練全程不可見**，`frozen: true`，`review_status: TEACHER_CONFIRMED` |

**准入閘門（全部滿足才可 ACTIVE）**：
1. Hold-out mAP50 ≥ **0.5**（獨立評估，非訓練期驗證值）
2. 四類 per-class recall 均 ≥ 0.5（避免整體被單類拉高）
3. 槳面混淆率（`_F`↔`_B`）≤ 10%
4. 旋向混淆率（CW↔CCW）≤ 10%
5. 教師以真實照片做圖片驗證通過

### 4.4 里程碑

| 階段 | 產出 | 阻擋條件 |
|---|---|---|
| D1 | 收集 ≥ 400 張真實槳葉照（四類各 ≥ 80，含正／反面與兩種機頭視角） | 無真實照片即不可開始 |
| D2 | 標註＋10% 雙人一致性檢查 | 一致性未達標不訓練 |
| D3 | 以 `yolov8n` 從預訓練微調，四類、固定 seed | — |
| D4 | Hold-out 獨立評估，產出四項指標 | 未達 4.3 閘門不得申請 ACTIVE |
| D5 | 教師真實照片驗收 | — |

---

## 五、本輪修改清單（全部在 P6，主樹零改動）

| 檔案 | 改動 | 性質 |
|---|---|---|
| `live_backend/app/vision_center.py` | 新增 `PROP_DIRECTION_TO_CW_CCW`、`map_prop_to_direction()`＋語義註解 | P7-C |
| `live_backend/tests/test_prop_direction_cw_ccw.py` | 新增 15 項測試 | P7-C |
| `student_portal/learning/live_assertions.py` | 補 `ASSERTION_HEADER` 常數（1 行） | 修 P6 啟動缺陷 |
| `ops/p7/tools/tls_entry.py` | 新增本機 TLS 終結器 | P7-A |
| `ops/p7/tools/seed_p7a.py` | 新增隔離測試資料種子；**追加電子郵件欄位**（學員登入以 email 驗證，初版未寫 email 導致學員恆登入失敗） | P7-A |
| `ops/p7/tools/verify_p7a.py` | 新增十項驗收腳本 | P7-A |
| `ops/p7/tools/verify_p7a_flow.py` | 新增正向鏈路驗證腳本（第 5／8 項＋B2～B6 證據） | P7-A |
| `ops/p7/evidence/p7a-supplementary.json` | 正向鏈路驗收證據 | P7-A |
| `ops/p7/tls/*` | 自簽憑證 | P7-A |
| `ops/p7/runtime/p7a.env` | 隔離環境變數（含 3 把獨立密鑰） | P7-A |
| `ops/p7/evidence/p7b-release-manifest.json` | 發布清單＋SHA-256 | P7-B |
| `ops/p7/p7b-security-tracked.patch` | 最小補丁 | P7-B |
| `ops/p7/evidence/p7a-verification.json` | 十項驗收證據 | P7-A |
| `ops/p7/backup/vision_center.py.before_p7c` | 同步前備份 | P7-C |

**未 commit、未 push、未 merge、未 deploy。**

---

## 六、遺留與待決

| # | 事項 | 需教師決定 |
|---|---|---|
| 1 | **B6 匿名寫入**：`POST /api/v1/vision/submissions` 無授權（實測匿名 201、可偽造 `student_id`） | 是否核准在 P6 補上學員身分校驗（最高優先） |
| 2 | **B2 入口剝離 `Cookie`** 導致登入鏈失效 | 是否為刻意設計？是否核准改為「僅 Live 路徑剝離」 |
| 3 | **B3 Gateway CSRF 取值錯** → 取不到 Assertion（503） | 是否授權修（改用遮罩 token 或以共享密鑰鑑別該端點） |
| 4 | **B4 斷言未綁定 method/path** → 恆 `method_mismatch` | 是否授權修（Gateway 需傳入 method/path/body） |
| 5 | **B5 `/api/v1/*` 無斷言來源** → 教師視覺 API 經 Gateway 不可達 | 改 `PROTECTED_PREFIX`，或改拓撲 |
| 6 | 8022 PID 於會話期間由 24004 → 14612 | 是否需另案調查（非本輪下令） |
| 7 | 4 類模型 mAP50 = 0.35139（訓練期值）低於 0.5 | 是否維持 REVIEW_REQUIRED、待真實資料重訓 |
| 8 | 6 類模型含錯字類別 `CCE-F`／`CCF-b` | 是否重訓或走對照表 |
| 9 | P6 全部改動尚未 commit | 是否核准本地 commit（仍不 push） |

**本輪遺留在隔離環境的測試資料（不影響正式）**：
- `sub-cffda36b-4fee-4457-a1fa-df99ff1b2a04`（學員 `p7a.student.s1`，正常路徑）
- `sub-e199993d-1535-46b0-8818-dcc118b284c4`（`student_id="attacker"`，B6 匿名寫入證據，**刻意保留作為證據**）
- 兩筆都在 `ops/p7/runtime/live-var/vision-center/`，正式 Registry 零影響。

---

## 七、事故如實記錄（隔離設定缺失，已修正）

**事件**：P7-A 首次執行時，`FDE_DJANGO_PORTAL_URL` 未設定，Live 的 portal proxy 使用預設值 `http://127.0.0.1:8022`，導致經 HTTPS 入口的 `GET /login/` 與 `POST /login/` 被送到**正式 v1.5C（8022）**，而非隔離的 8120。

**影響評估**：
- 請求內容：`GET /login/` 取頁面、`POST /login/` 以 `p7a.teacher.a` 登入。
- 該帳號在正式庫不存在 → 登入失敗（實測回 403，未建立任何 Session）。
- 未執行任何寫入類 API，未上傳檔案，未變更模型或 Registry。
- 正式 `demo.sqlite3` 事後哈希 = `fdaf1805…`，與 P-16 基線一致。
- **未造成資料變更**，但確實發生了不該發生的請求路由。

**修正**：在 `ops/p7/runtime/p7a.env` 明確設定 `FDE_DJANGO_PORTAL_URL="http://127.0.0.1:8120"` 並重啟 Live；此後全部請求僅在隔離鏈路內。

**教訓（建議納入部署檢查清單）**：`FDE_DJANGO_PORTAL_URL` 的預設值指向正式服務，屬**危險預設**；隔離環境啟動前必須顯式覆寫並驗證。

---

## 八、結論

- **P7-C 完成**：CW／CCW 語義已依磁碟證據裁決為「機體座標系旋向」，映射與主樹逐位元一致，15 項測試含正面／反面／相機視角全過，四類契約未被降級。
- **P7-B 完成但不可發布**：清單、SHA-256、補丁、依賴、回滾皆已備齊；但 P6 安全鏈路本身有 5 個阻斷級缺陷（見 3.5 節）。
- **P7-A 基礎設施完成、正向鏈路不通**：四層 HTTPS 隔離棧已真實跑通，攻擊面負向測試 15 項全數擋住；但合法使用者的正向路徑**沒有一條能走完**，並實測到匿名寫入。
- **P7-D 方案已出**：真實資料、四類契約、獨立留出集、mAP50 ≥ 0.5 閘門，未造假資料。

**本輪未宣稱任何真實槳葉辨識已通過**——現有模型仍為 `REVIEW_REQUIRED`／`DEMO_IMPORTED`，且無任何真實槳葉驗證樣本。

**本輪也不宣稱 P6 安全模組可用**——負向測試通過不代表功能可用；恰恰相反，正因為每個請求都失敗，負向測試才會全過。
