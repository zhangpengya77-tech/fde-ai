# FDE-AI 2.0｜上線收尾第二階段交付報告

- 執行日期：2026-10-28
- 工作樹：`D:\FDE-AI-UAS-v2.0`（Branch `feat/m02-simulator-entry`，HEAD `06481159f5ca638621c821e4fe9105b0837577f8`）
- 執行範圍：任務 A（基線保護）、B（靜態站最小修復候選）、C（Vision/YOLO 盤點）、D（隔離 YOLO 閉環 12 項）、E（Gateway 路由設計）、F（發布 Runbook）
- 授權邊界遵守情形：**未 push、未發布 GitHub Pages、未修改正式 Worker/Tunnel/DNS、未修改正式排程或啟動器、未修改正式 DB、未將任何候選模型切為 ACTIVE、未重啟 8022/8770、未修改 `/fde-ai/` 舊版首頁**

---

## 0. 執行摘要與四項裁決

| 裁決項 | 結論 | 依據 |
|---|---|---|
| **STATIC CANDIDATE READY / BLOCKED** | **READY（候選可用，但發布後仍會顯示「無法確認」）** | 隔離候選 6/6 情境通過、12 門課程完整、`/fde-ai/v2/` 路徑全通；但因 Worker `/gateway-status` 缺 CORS，真實環境下登入狀態會誠實顯示「無法確認」而非「可用」 |
| **API INTEGRATION READY / BLOCKED** | **BLOCKED** | 正式 8022 為 v1.5C 系，**無任何 v2.0 視覺路由**（`/api/v1/vision/*` 經 Worker 回 404）；v2.0 視覺能力全在 Live 8111，而 8111 未對外且**其鑑權僅信任 `X-FDE-Role` 標頭、無簽章**，直接外曝等同開放任意人啟用／刪除模型 |
| **YOLO ISOLATED E2E READY / BLOCKED** | **READY（隔離環境 12/12 全通，且全程未降低門檻）** | 見 §4，含真實推論證據與 Registry 未被修改的 SHA 證明 |
| **PRODUCTION RELEASE APPROVAL REQUIRED** | **REQUIRED，且當前狀態下不建議核准** | 存在 2 項 P0 阻斷（§7）：正式 Django `DEBUG=True` 對外洩漏全部路由與內部源站網址；內部源站 quick tunnel 可從公網直連 |

**一句話結論**：現有功能在隔離環境已形成可操作的完整閉環（真實上傳→真實推論→真實門檻攔截→可追溯），但**正式部署面存在 2 項 P0 安全阻斷與 1 項架構阻斷**，在修復前不應對外發布。

---

## 1. 任務 A：保護正式部署基線

備份目錄：`ops/launch-20261028/baseline/`

| 來源 | 檔案數 | 說明 |
|---|---|---|
| `gh-pages-v2/` | 8 | 線上 `/fde-ai/v2/` 實際發布內容（`.nojekyll`、`README.md`、`assets/{app,config,course-data}.js`、`assets/style.css`、`courses/index.html`、`index.html`） |
| `local-public-site/` | 10 | 本地 `public-site/` 全量（多 `m02/index.html`、`assets/favicon.svg`） |
| `worker/` | 2 | `src/index.js`、`wrangler.jsonc` |

**基線差異（重要）**：線上 `gh-pages` 的 `v2/` **缺 `m02/index.html` 與 `assets/favicon.svg`**。目前線上首頁仍引用 `<a href="m02/">M02 模擬飛行</a>` 與 `assets/favicon.svg` → 線上為 **404 死鏈**。發布候選時必須一併補齊，否則修好狀態顯示卻留下斷鏈。

未覆蓋任何其他工作樹；未直接修改 `gh-pages`。

---

## 2. 任務 B：靜態網站最小修復（隔離候選）

候選目錄：`ops/launch-20261028/candidate/v2/`（對應線上 `/fde-ai/v2/` 根）
正式 `public-site/` **未修改**（`git status` 仍為未跟蹤狀態，內容零改動）。

### 2.1 根因確認（實測，非推定）

線上 `https://zhangpengya77-tech.github.io/fde-ai/v2/assets/config.js` 內容為：

```js
portalBaseUrl: "",
portalStatusUrl: ""
```

配合 `app.js` 原第 43 行 `if (!portalBase || !statusUrl) return renderStatus(false);` → **永遠顯示離線**，且登入按鈕永遠 disabled。這就是「頁面打得開但永遠離線」的唯一根因。

### 2.2 修復內容

| 項目 | 修復前 | 修復後 |
|---|---|---|
| `portalBaseUrl` | `""` | `https://fde-ai-gateway.fde-ai-gateway.workers.dev`（2026-10-28 實測 `/login/` 200、`/teacher/login/` 200） |
| `portalStatusUrl` | `""` | `.../gateway-status`（已存在、匿名、唯讀、僅回 `gateway` 與 `classroom_server`） |
| 狀態呈現 | 二態（可用／離線） | **三態 + 未知態**：靜態網站／登入服務／YOLO 視覺服務 各一行，分別為 可用／目前不可用／無法確認 |
| 假成功風險 | 端點缺失時直接判離線 | 端點缺失或不可讀時判「無法確認」，**絕不判可用** |
| 入口連結 | 僅 online 才放行 | 確定離線才封閉；狀態未知時放行並附提示（導向的教學系統自己顯示真實狀態） |

`app.js` 另修正一處既有缺陷：`renderCourses()` 原本用 `article.innerHTML = "<p>" + course[0] + "</p>..."` 拼接，改為 `textContent` 逐欄位寫入（消除注入面，且行為不變）。

### 2.3 驗證：6 情境真實瀏覽器測試

工具：`tools/verify_candidate_states.mjs`（Playwright + 真實 Chromium，本地起靜態服務於 `http://127.0.0.1:18100/fde-ai/v2/`，狀態端點另起 `18101`，**走真實跨域鏈路，非 mock 攔截**）
證據：`evidence/candidate-three-state-verification.json`

| 情境 | 條件 | 期望 login | 期望 vision | 結果 |
|---|---|---|---|---|
| S1 | 端點回 `classroom_server=true` + CORS | online | unknown | **PASS** |
| S2 | 端點回 `classroom_server=false` | offline | unknown | **PASS** |
| S3 | 端點可達但**無 CORS**（等同現況 Worker） | unknown | unknown | **PASS** |
| S4 | 端點完全不可達 | offline | unknown | **PASS** |
| S5 | 提供 `vision.available=true` 端點 | online | online | **PASS** |
| S6 | 完全未設定端點 | unknown | unknown | **PASS** |

**6/6 通過**；六個情境下課程頁均渲染 **12 門課程**（M01–M12 完整，未增刪）。

### 2.4 路徑適用 `/fde-ai/v2/`

全站使用相對路徑（`assets/…`、`courses/`、`../assets/…`），在 `/fde-ai/v2/` 前綴下實測首頁、`courses/`、`m02/` 全部 200 且資源載入正常。**未修改 `/fde-ai/` 舊版首頁**（該目錄不在候選範圍內）。

### 2.5 兩個必須知道的缺口（未自行開放）

**(a) Worker `/gateway-status` 缺 CORS 標頭**
實測（帶 `Origin` 請求）回應只有 `content-type` 與 `cache-control`，**沒有任何 `access-control-*`**。因此正式環境下瀏覽器讀不到 JSON → 候選會顯示「無法確認」（S3 已驗證此降級行為正確、不假裝可用）。
→ 候選補丁：`candidate/patches/worker-gateway-status-cors.mjs`（白名單來源、僅 GET/HEAD/OPTIONS、不用 `*`、保留 `no-store` + `Vary: Origin`）。**未部署。**

**(b) 沒有 YOLO 匿名健康端點**
現有公開端點僅 `/api/public/{rag,inspection,voice}/*`，全為 `@require_POST` 且需帶業務參數，不能當健康檢查。依指令「不得自行開放管理 API」，本輪只提出設計、**未實作、未接線、未部署**：
→ `candidate/patches/django-public-health-endpoint.py`
契約：`GET /api/public/health/` → `{"gateway":"online","login":bool,"vision":{"available":bool,"reason":"ok|not_configured|backend_unreachable|no_active_model|backend_error"}}`
限制：匿名、僅 GET/HEAD、`no-store`、1.2s 下游逾時、**只回布林與固定原因碼**，不回模型名稱／路徑／檔案大小／人數／版本／主機名／內部 URL。

### 2.6 HTTPS Cookie 實測（發現問題）

```
GET https://fde-ai-gateway.../login/  → 200
Set-Cookie: csrftoken=…; Max-Age=31449600; Path=/; SameSite=Lax
```

**缺少 `Secure` 屬性**。而 `config/settings.py:301-303` 寫的是 `SESSION_COOKIE_SECURE = not DEBUG`、`CSRF_COOKIE_SECURE = not DEBUG`、`SECURE_SSL_REDIRECT = not DEBUG`。三者同時失效只有一個解釋：**正式服務正以 `DEBUG=True` 執行**（見 §7 P0-1 的直接證據）。

`SameSite=Lax` 本身可接受：靜態站只用連結「導航」到教學系統，登入後所有操作都在同一來源，不需要 `SameSite=None`。

---

## 3. 任務 C：Vision / YOLO 實際服務盤點（以程式碼＋實測確認，非推定）

| 埠 | 身分 | 判定依據 |
|---|---|---|
| 8022 | 正式 Django（**v1.5C 系**） | `netstat` 監聽；經 Worker 實測 `/login/` 200、`/teacher/` 302；`/api/v1/vision/models` → Django 404 |
| 8770 | RAG 服務 | `live_backend/app/config.py` `rag_base_url`；監聽中 |
| 8110 / 8111 | DEMO Django / Live backend | `demo/tools/demo_common.ps1`、`launch_detached.ps1`（`runserver :8110`、`uvicorn app.main:app --port 8111`）；**本輪實測皆未監聽** |
| 8112 | 公開入口（static_entry_server） | 同上；未監聽 |
| 8040 | flight-health | 同上；未監聽 |
| **8765** | **僅 dev 快照工具** `vision_snapshot_server.py` | `config.py` 的 `yolo_base_url` 指向 8765，但**沒有任何正式啟動器綁定它**；未監聽 |
| **8030** | **無現行啟動器綁定** | 全倉僅前端 config 與舊報告提及；未監聽 |

**關鍵結論：真正的 YOLO 推論不在任何獨立埠，而在 Live backend 進程內**（`UltralyticsModelRunner.predict`，`live_backend/app/vision_center.py`）。因此「YOLO 服務是否可用」實質等於「Live backend 是否可用且有可載入模型」，不存在一個可獨立探測的 8765 服務。

Registry 現況（`demo/runtime/vision-center/vision_center.json`，SHA-256 `9FFA6CB305F40B7B5AFD72FBCAAAD51A2C60AD5DD7749FD7B1F562CC3D416B32`）：
- 4 個 `prop_direction` 模型，狀態分布 `{DEMO_IMPORTED:1, REJECTED:1, REVIEW_REQUIRED:2}`
- **無任何 ACTIVE 模型**

---

## 4. 任務 D：隔離 YOLO 閉環 12 項（12/12 通過）

### 4.1 隔離方式（可審計）

- 只綁 `127.0.0.1:18110`（Django）與 `127.0.0.1:18111`（Live），與正式 8022/8770、DEMO 8110/8111 完全分離。
- DB、MEDIA、vision-center 全部為 `ops/launch-20261028/isolated-final3/` 下的副本（來源 `demo/runtime`）。
- 啟動器：`tools/start_isolated_stack.ps1`（WMI 建立行程，脫離呼叫端；`-Action prepare|start|status|stop`，`-RunRoot` 可指定隔離根）。
- 驗證腳本：`tools/e2e_closed_loop.py`；證據：`evidence/yolo-closed-loop-12.json`。

### 4.2 結果

| # | 步驟 | 結果 | 關鍵證據 |
|---|---|---|---|
| 1 | 學員登入（Django session） | PASS | HTTP 302 + session cookie |
| 2 | 學員上傳 `best.pt`（真實 multipart） | PASS | 5,460,378 bytes，SHA-256 `02995b79…` |
| 3 | 提交保存於 Live Registry | PASS | `sub-ddc92375…`，`status=SUBMITTED`，`file_hash` 與磁碟一致，`duplicate_hint=same_as_pending_submission`（如實回報不拒絕） |
| 4 | 教師登入 | PASS | HTTP 302 |
| 5 | 教師頁面列出該筆提交 | PASS | 頁面 HTML 含該 submission_id |
| 6 | 單張驗證（真實圖片送入 Live 推論） | PASS | HTTP 200，`ok=true` |
| 7 | 推論回傳真實結果（非替身） | PASS | `evidence_source=REAL_INFERENCE`、`detection_count=300`、`predicted_class=CW_F`、`max_confidence=0.2305`、門檻 0.5、`verdict=INSUFFICIENT_DATA`、`rule_version=PROP_RULE_v1` |
| 8 | 教師匯入為候選模型 | PASS | `PROP_20261028_DEMO-A_v1`，`status=REVIEW_REQUIRED`，`health=LOW_QUALITY`，`health_map50=0.35139`，`activation_eligible=false` |
| 9 | 資格判定有明確結論 | PASS | `activation_eligible=false`，`evaluation_status=NOT_EVALUATED`，附 mAP50 事實 |
| 10 | ACTIVE 流程遵守品質門檻 | PASS | 啟用被拒，`active_before=[]`、`active_after=[]`（**未被繞過**） |
| 11 | 學員回看 R07 成長紀錄 | PASS | HTTP 200，頁面含模型證據 |
| 12 | 稽核軌跡可追溯 | PASS | history 5 筆，新模型含 `source_submission_id`、`source_student_id`，`file_path` 指向**隔離目錄** |

**啟用被拒的頁面級原因（補充證據 `evidence/activation-blocked-reason.json`）**：

> 啟用失敗，原本的正式模型未變更：請完成圖片驗證並達到啟用門檻 0.6。

即：門檻未被降低、正式模型未被改動、失敗原因對教師可見。

### 4.3 隔離證明（SHA 對照）

```
來源（正式 DEMO）Registry 執行前 SHA-256：9FFA6CB305F40B7B5AFD72FBCAAAD51A2C60AD5DD7749FD7B1F562CC3D416B32
來源（正式 DEMO）Registry 執行後 SHA-256：9ffa6cb305f40b7b5afd72fbcaaad51a2c60ad5dd7749fd7b1f562cc3d416b32
→ source_store_unchanged = true

隔離 Registry 執行後 SHA-256：36e317f0c458f5118838ba8af23ecf913e9b21e055a2cf2cd5878b1be33eb294
→ isolated_store_differs_from_source = true
```

且步驟 12 顯示新模型的 `file_path` 為
`D:\FDE-AI-UAS-v2.0\ops\launch-20261028\isolated-final3\vision-center\model_registry\...`
—— 寫入發生在隔離目錄，正式 Registry 未被寫入。

### 4.4 閉環中暴露的兩個事實（非缺陷，但影響上線敘事）

1. **既有測試圖集是假圖**：`.test-temp/acceptance-r24/media/golden_set/` 的 3,428 張「golden set」全是 **64 bytes 佔位檔**（`FF D8 FF E0` + `GGGG…`），cv2 無法解碼。任何用該圖集跑出的「驗收通過」都不具證據力。本輪改用 `demo/runtime/media/evidence/` 中的真實上傳照片（329KB／175KB，可正常解碼）才得到真實推論。
2. **模型能力確實不足**：同一張真實槳葉照，模型給出 300 個候選框、最高信心 **0.2305**，遠低於 0.5 門檻 → 判定 `INSUFFICIENT_DATA`。這與 `health_map50=0.35139` 一致，**不是流程問題，是模型品質問題**。

---

## 5. 任務 E：安全 Gateway 路由設計（僅設計，未部署）

### 5.1 現況架構（實測）

```
瀏覽器 → https://fde-ai-gateway.fde-ai-gateway.workers.dev（Worker）
        → env.ORIGIN_URL = http://sandy-constructed-generates-martha.trycloudflare.com
        → Django 8022（v1.5C）
```

- `DYNAMIC_PREFIXES` 已涵蓋 `/admin /accounts /activate /api /courses /evidence /login /logout /media /password-reset /register /reset /student /teacher`
- Worker **原樣轉發客戶端標頭**（只改寫 `host`/`origin`/`referer`，並補 `x-forwarded-host`、`x-forwarded-proto`）
- 因此 `/api/v1/vision/*` 會被送到 Django 8022 → **404**

### 5.2 硬約束：Live 絕不可直接對外

`live_backend/app/vision_api.py:20-27`：

```python
def _teacher(request):
    if request.headers.get("X-FDE-Role", "").casefold() != "teacher":
        return None, error_response("teacher_required", ..., 403)
    teacher_id = request.headers.get("X-FDE-Teacher-ID", "").strip()
```

**純標頭信任、無簽章、無共享密鑰**。而 Worker 原樣轉發標頭 → 若把 `/api/v1/vision/*` 直接指向 Live，任何匿名訪客只要加兩行標頭即可 `activate`／`archive`／`delete` 模型。

**結論：Live 必須維持只綁 `127.0.0.1`，不得由 Worker 直接路由。** 唯一安全路徑是「Django 以 session 授權後代為轉發」，且 Django 必須**自行重建** `X-FDE-*` 標頭（現有 `learning/vision_submission.py::_post` 已是此模式，只帶自己產生的標頭，天然剝離客戶端偽造值）。

### 5.3 建議路由分工

| 對外路徑 | 目的地 | 授權 | 備註 |
|---|---|---|---|
| `/`、`/login/`、`/register/`、`/password-reset/*` | Django 8022 | 匿名 | 現況已通 |
| `/teacher/*`、`/student/*` | Django 8022 | session（教師/學員） | 現況已通 |
| `/api/public/health/`（**新增**） | Django 8022 | 匿名、只讀 | 供靜態站三態顯示 |
| `/api/v1/vision/*`（**新增代理**） | Django 8022 → **本機 127.0.0.1:8111** | 教師 session 或學員本人 enrollment 範圍 | Django 端重建 `X-FDE-*`，剝離客戶端同名標頭 |
| `/media/*` | Django 8022 | 既有權限 | 不上移到 Worker |

**不要做的事**：不要為視覺 API 在 Worker 加第二個 origin 綁定；不要開放 8030/8765；不要把 `X-FDE-Role` 當成對外可用的認證機制。

### 5.4 隔離環境已驗證的部分

本輪在 18110（Django）→ 18111（Live）的隔離鏈路上，完整走通「Django session 授權 → 伺服器端注入 `X-FDE-*` → Live 真實推論」，證明此代理模式可行（步驟 2/6/8/10 全部經此路徑）。**Worker 側路由變更未執行、未驗證**（需部署權限）。

---

## 6. 任務 F：發布 Runbook（可直接執行）

### 6.1 前置條件（全部滿足才可發布）

- [ ] **P0-1 已修**：正式 Django 以 `DEBUG=False` 執行（證據見 §7）
- [ ] **P0-2 已修**：內部源站不再使用 quick tunnel，改用 Named Tunnel + Access 或 IP 白名單
- [ ] Worker 已加 `/gateway-status` CORS 白名單補丁
- [ ] Django 已新增 `/api/public/health/`（可選，但沒有它 YOLO 狀態只能顯示「無法確認」）
- [ ] 發布候選已補齊 `m02/index.html`、`assets/favicon.svg`
- [ ] 已確認 `gh-pages` 的 `/fde-ai/` 舊版首頁**未被本次發布覆蓋**

### 6.2 發布步驟（前端）

1. 從 `ops/launch-20261028/candidate/v2/` 取全部檔案
2. 複製到 `gh-pages` 分支的 `fde-ai/v2/` 目錄（**只動 `v2/`，不動 `fde-ai/` 根目錄**）
3. 確認 `fde-ai/v2/` 下檔案清單為 10 個（含 `m02/index.html`、`assets/favicon.svg`）
4. commit → push `gh-pages`
5. 驗證：`https://zhangpengya77-tech.github.io/fde-ai/v2/` 200；`/fde-ai/v2/m02/` 200；`/fde-ai/v2/assets/favicon.svg` 200
6. 驗證舊版首頁仍 200：`https://zhangpengya77-tech.github.io/fde-ai/`

### 6.3 回滾

`ops/launch-20261028/baseline/gh-pages-v2/` 即發布前快照。回滾＝把該 8 個檔案覆蓋回 `fde-ai/v2/` 並 push。

### 6.4 驗收檢查清單（發布後）

- [ ] 手機（HTTPS）開啟首頁，三行狀態各自顯示真實狀態，無「假可用」
- [ ] 點「學員登入」能到教學系統 `/login/`；「教師登入」到 `/teacher/login/`
- [ ] 課程頁 12 門課完整
- [ ] 後端停機時，首頁仍可開、狀態顯示「目前不可用」，不顯示假的成功
- [ ] YOLO 狀態在沒有健康端點時顯示「無法確認」，**不得顯示可用**

### 6.5 已知會踩的坑（本輪實測）

| 坑 | 現象 | 處理 |
|---|---|---|
| PowerShell `$Args` 是自動變數 | 傳參被吞成空字串，Python 落進 REPL 並狂寫 traceback（曾把日誌撐到 219MB） | 參數改名 `$ArgLine` |
| `cmd /c "路徑"` 單引號對 | 引號被保留，整串被當命令名 → 找不到檔案 | 路徑無空白時不加引號 |
| 殭屍行程佔日誌句柄 | 新行程重定向失敗、靜默不啟動 | 先確認舊 PID 已死再啟動 |
| PS 5.1 讀無 BOM UTF-8 `.ps1` | 中文註解變亂碼 → 解析錯誤 | 寫入 UTF-8 **with BOM** |
| `Get-ChildItem \| Remove-Item` | 沙箱守衛攔截批量刪除 | 改用全新目錄，不做批量刪除 |

---

## 7. 阻斷清單

### P0-1　正式 Django 以 `DEBUG=True` 對外執行（**最嚴重**）

**證據**：`GET https://fde-ai-gateway.../api/__fde_probe_20261028__/` 回傳 Django 除錯 404 頁，頁面內直接出現 `DEBUG=True` 字樣，並列出**全部 44 條 URL pattern**（含 `admin/`、所有 `teacher/*`、`student/*`、`api/*`）。證據檔：`evidence/django-debug-404-body.html`（15,033 bytes）。

**連帶後果**：`SESSION_COOKIE_SECURE`／`CSRF_COOKIE_SECURE`／`SECURE_SSL_REDIRECT` 全部因 `not DEBUG` 而失效（已由缺少 `Secure` 的 `Set-Cookie` 實證）。

**風險**：路由結構完整外洩、Session Cookie 可能在明文 HTTP 下傳輸、任何未捕捉例外都會回傳完整 traceback 與設定。

**修復**：以 `DJANGO_DEBUG=false` 重啟正式 8022（需同時設定 `DJANGO_ALLOWED_HOSTS`、`DJANGO_CSRF_TRUSTED_ORIGINS`，否則 `settings.py:45-48` 會直接拋錯拒絕啟動）。**本輪未執行**（未授權重啟正式服務）。

### P0-2　內部源站 quick tunnel 可從公網直連

**證據**：除錯頁洩漏 `http://sandy-constructed-generates-martha.trycloudflare.com`；直接請求該位址回 **HTTP 200**（0.97s），完全繞過 Worker。

**風險**：Worker 的所有防護（離線頁、前綴白名單、健康探測）可被完全繞過；quick tunnel 為臨時通道，重啟即換網址 → 同時是可用性風險。

**修復**：改用 Named Tunnel（固定主機名）+ Cloudflare Access 或來源 IP 白名單，並讓 Worker 只信任該固定來源。

### P1-1　v2.0 視覺能力對外不可達（架構阻斷）

正式 8022 為 v1.5C 系，無 `/api/v1/vision/*`；Live 8111 未對外且不可對外（§5.2）。→ 學員／教師從外網**無法使用 YOLO**。需按 §5.3 在 Django 增設代理層（未實作）。

### P1-2　Worker `/gateway-status` 缺 CORS

不修則靜態站永遠顯示「無法確認」。補丁已備（`candidate/patches/worker-gateway-status-cors.mjs`），未部署。

### P1-3　線上 `v2/` 缺 `m02/` 與 `favicon.svg`

首頁現有 2 個 404 死鏈。

### P2-1　正式 8022 反覆重啟（可用性）

本輪觀測到 8022 的 owner PID 依序為 `7932 → 6748 → 15040 → 11416 → 17156 → 18944`（6 次變動，全在本次執行期間），8770 亦出現 `26380 → 16500 → 26380` 輪換。與既有記載「排程每 5 分鐘檢查、在 E4c 死結下無法判 OWNED 而重啟」相符。這會使任何長連線工作階段中斷。

### P2-2　Live 鑑權僅信任標頭

`_teacher()` 無簽章。只要 Live 不外曝即不構成即時風險，但屬結構性弱點，建議長期改為共享密鑰或 mTLS。

---

## 8. 本輪未執行 / 未核准事項（明確聲明）

- 未 push 任何分支、未發布 GitHub Pages、未修改 `gh-pages`
- 未修改或部署 Worker、未修改 Tunnel／DNS
- 未修改正式排程、未重啟或接管正式 8022／8770
- 未修改正式 DB／媒體／登入頁
- 未將任何模型切為 ACTIVE（隔離環境中的啟用嘗試被門檻如實攔截）
- 未降低任何品質門檻（`health_map50 >= 0.5`、圖片驗證信心 `>= 0.6`、四類別規範、評估證據要求全部原樣）
- 未修改 `/fde-ai/` 舊版首頁
- 未實作 `/api/public/health/`（僅提設計）
- 未在 Worker 側驗證任何路由變更

---

## 9. 產出物清單

| 路徑 | 內容 |
|---|---|
| `ops/launch-20261028/baseline/` | 任務 A 三份基線快照 |
| `ops/launch-20261028/candidate/v2/` | 任務 B 前端發布候選（10 檔） |
| `ops/launch-20261028/candidate/patches/worker-gateway-status-cors.mjs` | Worker CORS 補丁（未部署） |
| `ops/launch-20261028/candidate/patches/django-public-health-endpoint.py` | 匿名健康端點設計（未接線） |
| `ops/launch-20261028/tools/verify_candidate_states.mjs` | 三態 6 情境瀏覽器驗證 |
| `ops/launch-20261028/tools/start_isolated_stack.ps1` | 隔離棧啟動器（prepare/start/status/stop） |
| `ops/launch-20261028/tools/e2e_closed_loop.py` | 閉環 12 項驗證 |
| `ops/launch-20261028/evidence/candidate-three-state-verification.json` | 6/6 證據 |
| `ops/launch-20261028/evidence/yolo-closed-loop-12.json` | 12/12 證據 + 隔離 SHA 證明 |
| `ops/launch-20261028/evidence/activation-blocked-reason.json` | 啟用被拒的頁面級原因 |
| `ops/launch-20261028/evidence/django-debug-404-body.html` | P0-1 直接證據 |
| `ops/launch-20261028/isolated-final3/` | 最終隔離執行環境（含 DB／media／Registry 副本與日誌） |

---

**本階段到此停止，等待批准。**
