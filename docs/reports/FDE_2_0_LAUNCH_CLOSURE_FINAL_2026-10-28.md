# FDE-AI 2.0 上線收尾報告（最終交付）

- 報告日期：2026-10-28
- 工作樹：`D:\FDE-AI-UAS-v2.0`｜Branch `feat/m02-simulator-entry`｜HEAD `06481159f5ca638621c821e4fe9105b0837577f8`
- 本輪授權範圍：唯讀調查、隔離環境修改與測試、建立部署候選、編寫發布清單
- **未執行**：push、GitHub Pages 正式發布、修改正式 Worker/Tunnel/DNS、修改正式排程或啟動器、修改正式資料庫、將候選模型切為 ACTIVE

---

## 最終裁決

| 裁決 | 結論 |
|---|---|
| **STATIC READY** | **是（候選可發布）** — 修復後的候選 6/6 情境通過、12 門課程完整、`/fde-ai/v2/` 路徑全通；發布後若 Worker 未加 CORS，狀態會顯示「無法確認」（正確降級，非故障） |
| **API READY** | **否（部分）** — 登入／學員頁／教師頁／成長紀錄經 Worker 可用；**YOLO 視覺 API 完全不可用**（正式 8022 無 v2.0 視覺路由，Live 8111 未對外且不可對外） |
| **YOLO READY** | **否（隔離環境已 READY，正式環境未 READY）** — 隔離環境 12/12 全通且全程未降門檻；正式環境因架構斷點無法對外操作 |
| **BLOCKED** | **是** — 2 項 P0、4 項 P1、2 項 P2，詳見 §6 |

**一句話**：靜態前端可以發布；但「學員從外網完成 YOLO 上傳、教師覆核、學員用 ACTIVE 模型回測」這條鏈，**在正式環境目前走不通**，且正式後端有 2 項必須先修的 P0 安全問題。

---

## 1. 正式網站目前是否可開啟

| 檢查 | 結果 |
|---|---|
| `https://zhangpengya77-tech.github.io/fde-ai/v2/` | **200**（3,104 bytes HTML） |
| `https://zhangpengya77-tech.github.io/fde-ai/v2/courses/` | 200 |
| `https://zhangpengya77-tech.github.io/fde-ai/v2/m02/` | **404（死鏈）** |
| `https://zhangpengya77-tech.github.io/fde-ai/v2/assets/favicon.svg` | **404（死鏈）** |
| 12 門課程資料 | 完整（`course-data.js` 含 M01–M12） |
| 狀態顯示 | **永遠顯示「教學系統目前離線」** |

**可以開啟 ≠ 可以使用。** 目前線上 `assets/config.js` 的 `portalBaseUrl` 與 `portalStatusUrl` 都是空字串，配合 `app.js` 原第 43 行 `if (!portalBase || !statusUrl) return renderStatus(false);`，導致：狀態永遠離線、兩個登入按鈕永遠 `disabled`。這是唯一根因，且已在候選中修復（見 §9）。

---

## 2. GitHub Pages 實際部署版本

| 項目 | 實測值 |
|---|---|
| 實際發布來源 | **`gh-pages` 分支**（不是 GitHub Actions） |
| `gh-pages` HEAD | `24b53ecfd0cff716bd901aa3a66ce76634e03fa9` |
| 站台路徑 | `/fde-ai/v2/`（根 `/fde-ai/` 仍是舊 v1.5B 落地頁） |
| 線上 `v2/` 檔案數 | 8（**缺** `m02/index.html`、`assets/favicon.svg`） |
| `.github/workflows/deploy-public-site.yml` | **未生效**：它把 `public-site/` 發布到站台根目錄，與實際 `/v2/` 不符，且觸發分支為 `codex/github-pages-public` |

結論：**部署是手動 push `gh-pages`**。工作流的存在會誤導後續維護者，建議日後清理或改為正確路徑（本輪未動）。

---

## 3. 學員與教師入口網址

| 角色 | 入口 | 實測 |
|---|---|---|
| 公開站首頁 | `https://zhangpengya77-tech.github.io/fde-ai/v2/` | 200（但登入鈕 disabled） |
| 學員登入 | `https://fde-ai-gateway.fde-ai-gateway.workers.dev/login/` | **200**，發 `csrftoken`（`SameSite=Lax`，**缺 `Secure`**） |
| 教師登入 | `https://fde-ai-gateway.fde-ai-gateway.workers.dev/teacher/login/` | 200 |
| 學員後台 | `/student/` | 302（未登入）→ 登入後 200 |
| 教師後台 | `/teacher/` | 302（未登入） |
| 學員 YOLO 掃描 | `/student/courses/1/prop-scan/` | 登入後 **200**，含上傳表單 |
| 學員 R07 模型上傳 | `/student/courses/1/growth/R07/` | 登入後 **200**，含上傳表單 |
| **教師 Vision Center** | `/teacher/vision-center/` | **404（正式環境不存在）** |

最後一行是關鍵：**v2.0 的教師視覺後台在正式 8022 上根本沒有這個路由**，因為 8022 跑的是 v1.5C 系。

---

## 4. YOLO 上傳／教師審核／ACTIVE／前端回測的實際狀態

以下為**隔離環境**（`127.0.0.1:18110` Django + `18111` Live，獨立 DB／media／Registry 副本）的真實執行結果，證據檔 `ops/launch-20261028/evidence/yolo-closed-loop-12.json`。

| 環節 | 隔離環境 | 正式環境 |
|---|---|---|
| 學員登入 | ✅ 302 + session | ✅ 可用 |
| 學員上傳 `.pt` | ✅ 5,460,378 B，SHA-256 `02995b79…` | ⚠️ 頁面存在，但提交去向的 Live 不在正式環境 |
| 後端保存提交 | ✅ `sub-ddc92375…`，`file_hash` 與磁碟一致 | ❌ 無 Live 可接 |
| 教師查看班級提交 | ✅ 頁面列出該提交 | ❌ 教師 Vision Center 404 |
| 教師單張驗證 | ✅ `evidence_source=REAL_INFERENCE` | ❌ 無路由 |
| 真實推論結果 | ✅ 300 個候選框、最高信心 **0.2305**、門檻 0.5 → `INSUFFICIENT_DATA` | ❌ |
| 教師匯入候選模型 | ✅ `PROP_20261028_DEMO-A_v1`、`REVIEW_REQUIRED`、`LOW_QUALITY`、mAP50 **0.35139** | ❌ |
| 資格判定 | ✅ `activation_eligible=false`（附 mAP50 事實） | ❌ |
| ACTIVE 啟用 | ✅ **被拒**：「請完成圖片驗證並達到啟用門檻 0.6」；ACTIVE 前後皆空 | ❌ 正式 Registry 也無 ACTIVE |
| 學員回看成長紀錄 | ✅ 200 | ✅ 可用（但看不到模型審核結果） |
| 稽核軌跡 | ✅ history 5 筆，含 `file_hash`／`class_names`／`activation_*` | ❌ |
| 學員用 ACTIVE 模型回測 | ⛔ **無法進行**：隔離環境無 ACTIVE 模型 | ⛔ 同 |

**關於「前端回測」的誠實結論**：學員 `prop-scan` 頁面實測會明確回報「**目前沒有已啟用的 PROP_DIRECTION 模型。**」——這是正確的閘門行為，不是故障，也沒有偽造辨識結果。要真正跑通「學員用已啟用模型回測」，前提是先有一個通過品質門檻的模型，而現有 CW／CCW 四分類模型的 mAP50 只有 0.35139（門檻 0.5），**依規則不得啟用**。

---

## 5. 已完成 vs 仍缺失

### 已完成（本輪交付）

1. 靜態站發布候選：三態狀態顯示（靜態／登入／YOLO）、入口連結正確、12 門課程完整、補齊 `m02/` 與 `favicon.svg`。
2. 三態 6 情境真實瀏覽器驗證 6/6（含「無 CORS 必須顯示無法確認」專項）。
3. 隔離 YOLO 閉環 12/12，全程未降門檻，附 Registry SHA 未變證明。
4. 權限安全驗收 8/10（2 項為真實缺陷，見 §6）。
5. Worker CORS 補丁（未部署）、Django 匿名健康端點設計（未接線）。
6. 隔離棧啟動器（可 prepare/start/status/stop，可指定隔離根）。
7. 部署基線快照與回滾素材。

### 仍缺失

| 缺失 | 影響 |
|---|---|
| 正式 8022 無 v2.0 視覺路由 | 教師 Vision Center、視覺 API 全部不可用 |
| Django 端無 `/api/v1/vision/*` 代理層 | 學員／教師無法從外網操作 YOLO |
| Worker `/gateway-status` 無 CORS | 靜態站永遠顯示「無法確認」 |
| 無匿名健康端點 | YOLO 狀態無法顯示 |
| 線上缺 `m02/`、`favicon.svg` | 首頁 2 個 404 死鏈 |
| 無通過品質門檻的模型 | 無 ACTIVE 可用，前端回測無法成立 |
| 上傳層無內容檢查 | 垃圾 `.pt` 可污染提交佇列 |
| 教師後台無班級範圍過濾 | 異班教師可見全部班級提交 |

---

## 6. 阻擋上線的問題（P0 / P1 / P2）

### P0-1　正式 Django 以 `DEBUG=True` 對外執行

**證據**：`GET /api/__fde_probe_20261028__/` 回傳 Django 除錯 404 頁，頁面內明文 `DEBUG=True`，並列出**全部 44 條 URL pattern**（含 `admin/`、所有 `teacher/*`、`student/*`、`api/*`）。證據檔 `evidence/django-debug-404-body.html`（15,033 bytes）。

**連帶**：`SESSION_COOKIE_SECURE`、`CSRF_COOKIE_SECURE`、`SECURE_SSL_REDIRECT` 皆為 `not DEBUG`，因此全部失效 —— 已由 `Set-Cookie` 缺 `Secure` 實證。

**風險**：路由結構全洩、Session Cookie 可能明文傳輸、任何未捕捉例外回傳完整 traceback。

### P0-2　內部源站 quick tunnel 可從公網直連

**證據**：除錯頁洩漏 `http://sandy-constructed-generates-martha.trycloudflare.com`；直接請求回 **200**（0.97s），完全繞過 Worker。

**風險**：Worker 的離線頁、前綴白名單、健康探測全部可被繞過；quick tunnel 重啟即換網址，同時是可用性風險。

### P1-1　v2.0 視覺能力對外不可達

正式 8022 無 `/api/v1/vision/*`；Live 8111 未對外且**不可**對外（見 P1-2）。→ 外網無法使用 YOLO。

### P1-2　Live 鑑權僅信任標頭（架構約束）

`live_backend/app/vision_api.py:20-27` 的 `_teacher()` 只檢查 `X-FDE-Role == "teacher"` 與 `X-FDE-Teacher-ID`，**無簽章、無共享密鑰**；而 Worker **原樣轉發客戶端標頭**。因此若把 `/api/v1/vision/*` 直接路由到 Live，任何匿名訪客加兩行標頭即可啟用／歸檔／刪除模型。**Live 必須維持只綁 127.0.0.1。**

### P1-3　Worker `/gateway-status` 無 CORS

實測帶 `Origin` 請求，回應無任何 `access-control-*` 標頭 → 瀏覽器讀不到 → 靜態站只能顯示「無法確認」。

### P1-4　線上 `v2/` 缺 `m02/` 與 `favicon.svg`

已實測 `v2/m02/` → 404。

### P2-1　上傳層只檢查副檔名與大小，不檢查內容

實測：2 KB 垃圾位元組命名為 `fake_model.pt` → **通過表單驗證並在 Live 建立 `SUBMITTED` 提交紀錄**（`sub-8fa1130c…`，2048 bytes）。內容合法性要到教師「匯入預檢」載入模型時才失敗。
→ 後果：教師待審佇列可被無成本污染。安全驗收 S-06／S-07 因此未通過。
→ 規則依據：`forms.py:423-429` 僅檢查 `.pt` 副檔名與 ≤100 MB。

### P2-2　教師後台無班級範圍過濾

`teacher_vision_center` 以 `list_submissions(task_id, status)` 取**全部**提交，未按班級或教師過濾 → 異班教師可見他班提交。DEMO 資料集僅 1 班級，無法以第二班級實測，但程式碼層面確認無此過濾。

### P2-3　正式 8022 週期性重啟

本輪觀測 owner PID 依序 `7932 → 6748 → 15040 → 11416 → 17156 → 18944 → 21052`（7 次變動）。長連線工作階段會被中斷。

---

## 7. 8022 問題是否影響目前部署

| 問題 | 是否阻擋靜態發布 | 是否阻擋動態閉環 |
|---|---|---|
| 8022 週期重啟（P2-3） | **不阻擋** | **阻擋**（session 中斷、上傳中斷） |
| 8022 為 v1.5C 系、無視覺路由（P1-1） | 不阻擋 | **阻擋**（根本原因） |
| `DEBUG=True`（P0-1） | 不阻擋 | 不阻擋功能，但**屬發布前必修** |
| quick tunnel（P0-2） | 不阻擋 | 阻擋（源站不穩定且不安全） |

**結論：不要因為 8022 啟動器尚未修復而延遲靜態前端發布準備。** 靜態前端與 8022 完全解耦（見 §8）。但動態閉環必須先解決 P1-1（視覺路由）與 P0-2（源站常駐），且 P2-3 的重啟會讓任何長流程中途失敗。

---

## 8. 靜態前端與動態後端的常駐能力

| 項目 | 關閉本機電腦後 | 說明 |
|---|---|---|
| **A. 靜態前端** | ✅ **仍可開啟** | 由 GitHub Pages（GitHub 託管）提供；Worker 另有 `assets.directory: ./public` 靜態快照作為後端離線時的備援，兩者都不依賴本機 |
| **B. 動態後端** | ❌ **不可用** | Django 8022 跑在本機 Windows，經 quick tunnel 對外。關機即斷 |
| **C. Gateway 轉發** | 部分 | 登入／學員／教師／成長紀錄：✅ 可安全轉發（實測 `/login/` 200、`/teacher/` 302）。**模型驗證 API：❌ 無路由可轉發** |
| **D. 後端離線時的表現** | ✅ **誠實** | Worker 回自帶離線頁（`x-fde-gateway-mode: offline`，200 +「教學主機目前未啟動」）；候選前端在端點不可達時顯示「目前不可用」，不會假裝上傳成功 |

**要達成完整常駐服務還缺什麼**

1. 後端搬到可常駐的主機（雲端 VM／校內伺服器／具固定 IP 的機器），而非開發機。
2. 以 **Named Tunnel**（固定主機名）+ Access／IP 白名單取代 quick tunnel。
3. Django 加視覺代理層，讓 `/api/v1/vision/*` 經 session 授權後轉發到本機 Live。
4. 以 `DEBUG=False` 啟動並正確設定 `DJANGO_ALLOWED_HOSTS`、`DJANGO_CSRF_TRUSTED_ORIGINS`（否則 `settings.py:45-48` 會拒絕啟動）。
5. 以 Windows 服務／systemd／容器方式管理進程，取代現行排程每 5 分鐘探測重啟的做法。

**最小成本、最少改動的方案（不採購雲端）**：沿用現有校內／教室主機常開，改 Named Tunnel（免費方案即可）＋ `DEBUG=False` ＋ Django 代理層三項。不需新增付費資源，不需改 DNS 供應商。

---

## 9. 本輪修改檔案及測試結果

### 新增（全部在 `ops/launch-20261028/`，未動任何既有產品檔案）

| 路徑 | 用途 |
|---|---|
| `baseline/` | 部署前快照（gh-pages-v2 8 檔、local-public-site 10 檔、worker 2 檔） |
| `candidate/v2/` | 靜態站發布候選（10 檔） |
| `candidate/patches/worker-gateway-status-cors.mjs` | Worker CORS 補丁（未部署） |
| `candidate/patches/django-public-health-endpoint.py` | 匿名健康端點設計（未接線） |
| `candidate/README-DEPLOY.md` | 候選發布說明與三態語義 |
| `tools/verify_candidate_states.mjs` | 三態 6 情境瀏覽器驗證 |
| `tools/start_isolated_stack.ps1` | 隔離棧啟動器 |
| `tools/e2e_closed_loop.py` | 閉環 12 項 |
| `tools/security_acceptance.py` | 安全驗收 10 項 |
| `evidence/*.json` | 四份執行證據 |
| `docs/reports/FDE_2_0_LAUNCH_CLOSURE_PHASE2_2026-10-28.md` | 任務 A–F 技術報告 |

### 修改（僅候選目錄內）

`candidate/v2/assets/config.js`、`candidate/v2/assets/app.js`、`candidate/v2/assets/style.css`、`candidate/v2/index.html`。

**正式 `public-site/` 零改動**（`git status` 仍為未跟蹤且內容未變）。

### 測試結果

| 套件 | 結果 | 證據 |
|---|---|---|
| 靜態站三態（真實 Chromium，真實跨域） | **6/6** | `evidence/candidate-three-state-verification.json` |
| YOLO 隔離閉環 | **12/12** | `evidence/yolo-closed-loop-12.json` |
| 權限安全驗收 | **8/10** | `evidence/security-acceptance-10.json` |
| 學員 prop-scan 閘門 | 200 +「目前沒有已啟用的 PROP_DIRECTION 模型」 | `evidence/student-prop-scan.json` |
| 啟用被拒頁面原因 | 「啟用失敗，原本的正式模型未變更：請完成圖片驗證並達到啟用門檻 0.6」 | `evidence/activation-blocked-reason.json` |

**隔離證明**：正式 DEMO Registry `vision_center.json` SHA-256 執行前後皆為 `9FFA6CB305F40B7B5AFD72FBCAAAD51A2C60AD5DD7749FD7B1F562CC3D416B32`（未變）；新模型 `file_path` 落在 `isolated-final4\...`（寫入隔離目錄）。

### 安全驗收 10 項明細

| # | 項目 | 結果 |
|---|---|---|
| S-01 | 匿名使用者不能上傳 | ✅ 403（CSRF 先擋）+ 無紀錄 |
| S-02 | 學員不能查看其他學員私人資料 | ✅ 本人 200／他人 404 |
| S-03 | 學員不能查看或操作教師後台 | ✅ 302／302；**跨班級教師隔離未實作**（見 P2-2） |
| S-04 | 學員不能直接將模型設為 ACTIVE | ✅ ACTIVE 前後皆空 |
| S-05 | 未經教師批准不能成為 ACTIVE | ✅ 無任何 ACTIVE，候選停在 `REVIEW_REQUIRED` |
| S-06 | 非法／超大／錯誤格式被拒絕 | ❌ 副檔名與大小可擋，**內容不檢查**（P2-1） |
| S-07 | 上傳失敗不留假成功紀錄 | ❌ 垃圾 `.pt` 產生真實 `SUBMITTED` 紀錄（P2-1） |
| S-08 | 模型驗證結果可追溯 | ✅ history 5 筆，含 `file_hash`／`class_names`／`activation_*` |
| S-09 | 前端不暴露管理密鑰／內網位址 | ✅ 10 檔掃描，0 命中（無硬編碼憑證、無 localhost／私有 IP） |
| S-10 | Gateway 保持原有隔離契約 | ✅ Worker SHA 與基線一致、`DYNAMIC_PREFIXES` 未加視覺路由、未引用 Live 埠 |

---

## 10. 正式發布所需的最少操作

### 第一步：修 P0（必須先做，否則不建議發布）

1. 正式 Django 以 `DJANGO_DEBUG=false` 重啟，同時設定 `DJANGO_ALLOWED_HOSTS` 與 `DJANGO_CSRF_TRUSTED_ORIGINS`（缺一會直接拒絕啟動）。
2. 內部源站改 Named Tunnel（固定主機名）+ Access 或 IP 白名單；Worker 的 `ORIGIN_URL` 指向新主機名。

### 第二步：發布靜態前端（與後端解耦，可獨立進行）

3. 把 `ops/launch-20261028/candidate/v2/` 的 10 個檔案覆蓋到 `gh-pages` 的 `fde-ai/v2/`（**只動 `v2/`，不動 `fde-ai/` 根目錄**）。
4. commit → push `gh-pages`。
5. 驗證：`/fde-ai/v2/` 200、`/fde-ai/v2/m02/` 200、`/fde-ai/v2/assets/favicon.svg` 200、`/fde-ai/` 舊首頁仍 200。

### 第三步：讓狀態顯示變成「可用」（可選但建議）

6. 部署 Worker CORS 補丁（`candidate/patches/worker-gateway-status-cors.mjs`）。
7. 接線 Django 匿名健康端點（`candidate/patches/django-public-health-endpoint.py`），並把網址填入 `config.js` 的 `visionStatusUrl`。

### 第四步：打通 YOLO（這是「YOLO READY」的必要條件）

8. 在 Django 新增 `/api/v1/vision/*` 代理路由：`teacher_required` 或學員本人 enrollment 範圍校驗 → 伺服器端重建 `X-FDE-*` 標頭 → 轉發到 `127.0.0.1:8111`。**Live 維持只綁 127.0.0.1。**
9. 以 Live 常駐（服務化）取代現行隨 DEMO 啟動的方式。

> 第 8、9 項本輪**未實作**（需先取得授權，且屬新增程式碼而非最小修復）。

---

## 11. 發布後的教師人工驗收步驟

1. 手機開 `https://zhangpengya77-tech.github.io/fde-ai/v2/`，確認三行狀態各自顯示，**沒有任何一行在無證據時顯示「可用」**。
2. 點「學員登入」→ 應到 `/login/`；點「教師登入」→ 應到 `/teacher/login/`。用真實帳號登入。
3. 學員端：`/student/courses/<id>/prop-scan/` 上傳一張槳葉照 → 若無 ACTIVE 模型，必須看到「目前沒有已啟用的 PROP_DIRECTION 模型」，**不得出現任何辨識結果**。
4. 學員端：`/student/courses/<id>/growth/R07/` 上傳 `best.pt` → 確認提交出現在教師待審清單。
5. 教師端：`/teacher/vision-center/` 查看該提交 → 上傳一張真實槳葉照做單張驗證 → 確認顯示最高信心值與門檻，且標記為真實推論。
6. 教師端：嘗試啟用 → 若模型未達門檻，必須看到明確拒絕原因，且 ACTIVE 模型不變。
7. 教師端：換一個**不符合門檻**的檔案與一個**非 `.pt`** 的檔案上傳 → 兩者都必須被拒。
8. 學員端：重新登入 → 確認成長紀錄仍可看到，且**看不到其他學員的資料**（把網址的 enrollment id 改成別的數字應 404）。
9. 拔掉後端（停 8022）→ 重新整理公開站 → 必須顯示「目前不可用」，**不得顯示假的成功**。

---

## 12. 回滾計畫

| 層級 | 回滾素材 | 操作 |
|---|---|---|
| 靜態前端 | `ops/launch-20261028/baseline/gh-pages-v2/`（8 檔，發布前快照） | 把這 8 檔覆蓋回 `fde-ai/v2/` 並 push；`m02/` 與 `favicon.svg` 為新增檔，可保留（不影響舊版） |
| Worker | `ops/launch-20261028/baseline/worker/{index.js,wrangler.jsonc}` | 覆蓋回 `D:/FDE-AI-Gateway/src/` 後重新 deploy |
| Django 設定 | 無程式碼改動；僅環境變數 | 把 `DJANGO_DEBUG` 改回原值並重啟 |
| Registry／DB | 本輪**未修改**正式 Registry 與正式 DB（SHA 已證） | 無需回滾 |
| 驗證 | 回滾後重跑 `tools/verify_candidate_states.mjs`（期望 6/6）與 `curl` 檢查 `/fde-ai/` 舊首頁 200 | — |

---

## 13. 需要教師明確批准的操作

以下每一項本輪**均未執行**，需逐項批准：

1. ☐ 修改正式 Django 啟動參數為 `DJANGO_DEBUG=false` 並重啟 8022。
2. ☐ 建立 Named Tunnel 並修改 Worker 的 `ORIGIN_URL`（涉及正式 Tunnel／DNS）。
3. ☐ 部署 Worker CORS 補丁（修改正式 Worker）。
4. ☐ 接線並部署 Django 匿名健康端點（新增正式路由）。
5. ☐ Push `gh-pages` 發布靜態前端候選（含 `m02/`、`favicon.svg`）。
6. ☐ 新增 Django `/api/v1/vision/*` 代理層（新增程式碼，非最小修復）。
7. ☐ 將 Live backend 服務化為常駐進程。
8. ☐ 修復 P2-1（上傳層內容檢查）—— 涉及改動學員上傳路徑的既有契約。
9. ☐ 補 P2-2（教師後台班級範圍過濾）—— 涉及權限模型變更。
10. ☐ 將任何候選模型切換為 ACTIVE（本輪明確不建議：現有模型 mAP50 0.35139 < 0.5）。

---

## 附：本輪明確未做的事

- 未 push、未發布 GitHub Pages、未改 `gh-pages`
- 未修改或部署 Worker、未改 Tunnel／DNS
- 未修改正式排程、未重啟或接管 8022／8770
- 未修改正式 DB／媒體／登入頁
- 未將任何模型切為 ACTIVE
- 未降低任何品質門檻（`health_map50 ≥ 0.5`、圖片驗證信心 `≥ 0.6`、四類別規範、評估證據要求全數原樣）
- 未修改 `/fde-ai/` 舊版首頁
- 未實作健康端點、未實作視覺代理層
- 隔離棧已停止，18110／18111 已釋放
