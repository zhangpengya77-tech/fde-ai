# FDE-AI-UAS 2.0｜I4 跨服務整合與教學交付驗收 — 交付報告

- 專案：`D:\FDE-AI-UAS-v2.0`
- 分支：`fde-ai-v2.0-dev`
- HEAD（未變動）：`e5c044244475d18930f32e26696d2cf9cf43dfa6`（短碼 `e5c0442`）
- 執行日期：2026-10-13
- 對應指令：教師 I4 指令（一、任務定位；二、絕對凍結區；三、I4-A；四、I4-B；五、I4-C；六、I4-D；七、I4-E；八、回歸與安全；九、交付 A–I）
- 配套文件：`docs/reports/I4_iPhone_Safari_Acceptance_Checklist.md`（I4-E 人工驗收表）

---

## 0. 完成等級與結果總覽

| 等級 | 含義 | 本輪結果 |
|---|---|---|
| `AUTOMATED PASS` | 單元測試 + 隔離跨服務 HTTP 驗收 + Chrome 裝置模擬全數通過 | **達成** |
| `REAL DEVICE PASS` | iPhone 實機 Safari 人工驗收 | **`PENDING`（本輪未執行）** |

> 本輪所有手機結論均來自 **Chrome 裝置模擬（390×844）**，**不等於**真實 iPhone Safari。
> 報告中不出現任何未經實機驗證的「真機通過」字樣。

### 全部驗收結果彙總（PASS／FAIL／SKIPPED／PENDING）

| 驗收項 | PASS | FAIL | SKIPPED | PENDING | 合計 |
|---|---|---|---|---|---|
| I4-A 跨服務入口（主流程） | 31 | **0** | 0 | 2 | 33 |
| I4-A 服務停止降級 | 9 | **0** | 0 | 0 | 9 |
| I4-C 接口安全（deny 模式） | 25 | **0** | 0 | 1 | 26 |
| I4-C 接口安全（allow 模式） | 26 | **0** | 0 | 1 | 27 |
| I4-D 師生教學流程（經統一入口） | 47 | **0** | 0 | 1 | 48 |
| I4-E Chrome 裝置模擬（390×844） | 16 | **0** | 0 | 0 | 16 |
| I1 回歸 | 46 | **0** | 0 | 0 | 46 |
| I2 回歸（default／up／down） | 114 | **0** | 0 | 0 | 114 |
| I3 回歸（四模式） | 95 | **0** | 4 | 4 | 103 |
| **本輪新增／執行自動化驗收合計** | **409** | **0** | **4** | **9** | **422** |
| learning 全套件回歸（918 項） | 890 | 2（既有） | 26 | 0 | 918 |

**SKIPPED／PENDING 逐項說明（皆已說明原因，非隱藏失敗）**

- PENDING ×2（I4-A）：RAG 真實問答（隔離實例上游指向死埠以驗證降級，**未觸碰正式 :8770**）；真實 iPhone Safari。
- PENDING ×2（I4-C）：同上兩類（每支腳本各記一次）。
- PENDING ×1（I4-D）：真實 iPhone Safari。
- SKIPPED ×4（I3 回歸）：live 預設 `allowed_roles` 含 student，無法在隔離實例觸發「角色不符」，該項由單元測試 `test_role_restricted_skips_probe` 覆蓋。

---

## A. 2.0 最終功能入口總表

### A-1 五階段學習工作台（單一教學入口）

工作台位址：`/student/learning-path/`（單一在學課程自動進入 `/student/courses/<enrollment_id>/learning-path/`）

| 階段 | 入口名稱 | 路徑 | 提供服務 | 狀態 |
|---|---|---|---|---|
| 學 | 學習平台（課程影片與教材） | `/platform/` | Django（Live 已代理） | 既有，可用 |
| 學 | 下載中心（課程軟體） | `/downloads/` | Live Backend 靜態掛載 | 既有，可用 |
| 學 | AI 助教（RAG 知識庫問答） | `/live/` | Live Backend 靜態掛載 → RAG :8770 | 既有，可用（RAG 未啟動時明確降級） |
| 練 | 模擬器練習（學習平台） | `/platform/` | Django | 既有，可用 |
| 練 | AI 助教（練習即時問答） | `/live/` | Live Backend | 既有，可用 |
| 練 | 四面懸停／起飛與降落／八字訓練 | — | — | **規劃中**（純文字標示，無連結） |
| 做 | **F450 十二任務實訓** | `/platform/f450` | Django（Live 已代理） | 既有，可用（**本輪修正代理後可達**） |
| 做 | Mission Planner 調參實訓（MP01–MP12） | `/live/` | Live Backend | 既有，可用 |
| 做 | 3D 列印／航線規劃／三維建模／巡檢與產業 SOP／無人車 | — | — | **規劃中**（純文字標示，無連結） |
| 測 | 手機槳葉方向辨識（M1–M4） | `/student/courses/<id>/prop-scan/` | Django | 既有，可用（凍結保護） |
| 測 | 飛行健康 AI | `/flight-health/` | Live Backend 靜態掛載 | 既有，可用 |
| 證 | 我的學習成長日誌（R01–R08 總覽） | `/student/courses/<id>/growth/` | Django | 既有，可用 |

### A-2 三個預留外部模組（尚未接入）

| 模組 ID | 顯示名稱 | 所屬階段 | 預設狀態 | 本輪處置 |
|---|---|---|---|---|
| `F450_DIGITAL_TWIN` | F450 數位孿生 | 做 | 尚未接入 | 僅預留接口，無連結 |
| `MP_GROUND_STATION` | MP 地面站（預留） | 測 | 尚未接入 | 僅預留接口，無連結 |
| `HQGC_ASSESSMENT` | HQGC 考核（預留） | 測 | 尚未接入 | 僅預留接口，無連結 |

> 「F450 十二任務實訓（`/platform/f450`）」與「F450 3D 數位孿生（`F450_DIGITAL_TWIN`）」是**兩個不同模組**，未合併、未改名。

### A-3 服務分工（兩來源架構）

| 服務 | 埠（DEMO） | 提供內容 |
|---|---|---|
| Django（學員／教師後台） | :8110 | `/platform/`、`/platform/f450`、`/student/*`、`/teacher/*`、`/login/`、`/teacher/login/`、`/evidence/*` |
| Live Backend（統一模擬入口） | :8111 | `/`、`/live/`、`/downloads/`、`/flight-health/`、`/src/`、`/api/*`；並**代理** Django 的 `/login/`、`/student/`、`/teacher/`、`/courses/`、`/evidence/`、`/platform/`、`/static/` |
| RAG 知識庫 | :8770 | AI 助教問答後端（僅綁 127.0.0.1，經 Live 同源代理） |

**登入方式**：學員與教師都從**統一模擬入口（:8111）**登入一次；Live Backend 以透明代理轉發 Django 的 `Set-Cookie`，因此**全程只需登入一次**，代理頁與同源靜態頁共用同一 session。

---

## B. 跨服務實際驗收結果（I4-A）

隔離環境：Django `:8120`（測試庫 `demo/runtime/db/i4_e2e.sqlite3`，為 `p42_verify.sqlite3` 的**獨立副本**）+ Live Backend `:8121`（Django 上游指向 `:8120`，RAG 上游指向死埠 `:8799`）。**未操作正式 8022／8770，未改正式資料。**

### B-1 教師指定六問逐條對照

| # | 要求 | 驗證方式 | 結果 |
|---|---|---|---|
| 1 | 學員登入後能否進入 | 統一模擬入口登入 → `/student/learning-path/` → 302 → `/student/courses/14/learning-path/` → 200（頁長 27,959 字元，含五階段） | **PASS** |
| 2 | 是否需要重複登入 | 全程 login POST 次數 = **1**；後續所有代理頁與靜態頁共用同一 `sessionid` | **PASS** |
| 3 | 是否正確保留授權 | 學員 Cookie 存取 `/teacher/` → **403**（不放行）；匿名 Cookie 存取工作台 → 302 | **PASS** |
| 4 | 能否返回五階段工作台 | 學習平台頁含返回工作台連結（命中 `learning-path` 2 次）；來回開啟工作台內容一致（27,959／27,959） | **PASS** |
| 5 | 服務停止後是否正常降級 | 停止 Django 後：代理回 **503** 且訊息明確（`Student Portal is temporarily unavailable.`）；Live 自身健康端點 200；`/`、`/live/`、`/downloads/`、`/flight-health/`、`/api/downloads` **全部仍 200** | **PASS（9/9）** |
| 6 | 既有功能是否正常 | 下載中心 manifest API 200 且仍含 HQGC；SPA 資源 `/src/router.js` 200；`/platform/` 200；RAG health 200 | **PASS** |

### B-2 本輪發現並修正的跨服務缺口（唯一框架入口修正）

**現象**：從統一模擬入口（:8111）點擊五階段工作台「做」階段的「F450 十二任務實訓」（相對路徑 `/platform/f450`）→ **HTTP 404**。
工作台頁面本身由 Live 代理提供（瀏覽器來源為 :8111），但 Live Backend 的代理路由清單**只有** `/login/`、`/student/`、`/teacher/`、`/courses/`、`/evidence/`、`/static/`，**缺少 `/platform/`**；`/platform/f450` 因此落到 Live 的 404。Django 來源（:8120）上同一路徑為 200，證明是**跨服務代理缺口**而非功能缺失。

| 位置 | 修正前 | 修正後 |
|---|---|---|
| 統一模擬入口 `/platform/` | 404 | **200** |
| 統一模擬入口 `/platform/f450` | 404 | **200** |
| 統一模擬入口 `/platform/src/*`（SPA 資源） | 404 | **200** |

**修正內容**（`live_backend/app/main.py`，**僅新增 2 行路由 + 6 行註解**）：

```python
Route("/platform/", django_portal_proxy, methods=["GET", "POST"]),
Route("/platform/{portal_path:path}", django_portal_proxy, methods=["GET", "POST"]),
```

- 沿用**既有** `django_portal_proxy`（透明代理，不新增任何推論或業務邏輯）。
- 為**附加式**變更，不影響既有 `/teacher/`、`/courses/`、`/student/` 代理行為。
- 屬教師 I4 指令第二節允許範圍：「只允許修改 2.0 框架入口」。

---

## C. 三個獨立模組接口契約（I4-B）

契約由 `learning/external_modules.py::external_module_contract()` 提供（程式可讀，非紙上文件）。

### C-1 模組 ID 與獨立性

| 模組 ID | 顯示名稱 | 階段 | 介接版本 | 獨立專案 |
|---|---|---|---|---|
| `F450_DIGITAL_TWIN` | F450 數位孿生 | 做 | `reserved-1.0` | 是（教師其他專案獨立開發） |
| `MP_GROUND_STATION` | MP 地面站（預留） | 測 | `reserved-1.0` | 是 |
| `HQGC_ASSESSMENT` | HQGC 考核（預留） | 測 | `reserved-1.0` | 是 |

三個模組**各自獨立**：設定其一不影響其餘兩者（單元測試 `test_three_modules_are_independent` 實證）。

### C-2 服務 URL 配置

| 項目 | 內容 |
|---|---|
| 設定來源 | `settings.FDE_EXTERNAL_MODULES[<module_id>]['entry_url']` |
| 環境變數 | `FDE_MODULE_<module_id>_URL` |
| 值的形式 | **僅基礎網址**（scheme + host + port + path），不得夾帶 Token／密碼／學生個資 |
| 驗證函式 | `validate_entry_url()` |
| 未通過結果 | 狀態為「尚未接入」，**不探測、不連結** |
| 內網服務 | 必須以 `FDE_EXTERNAL_MODULE_ALLOWED_HOSTS` 明確列出（見 §D） |

### C-3 啟用與停用

| 項目 | 內容 |
|---|---|
| 預設 | **DISABLED** |
| 啟用 | `FDE_MODULE_<module_id>_ENABLED=1` **且** 提供 `entry_url` |
| 停用效果 | 狀態「尚未接入」；不探測、不產生連結、不影響任何學習紀錄 |
| 啟用但無 URL | 仍為「尚未接入」（需同時提供 URL） |
| 生效時機 | 讀取 settings，服務重啟後生效（本層不提供熱切換 API） |

### C-4 權限要求

| 項目 | 內容 |
|---|---|
| 欄位 | `allowed_roles` |
| 允許值 | `student`／`teacher` |
| 預設 | `["student", "teacher"]` |
| 角色不符 | 狀態「權限不足」 |
| 判定順序 | **角色判定先於健康探測**（不向未授權者洩漏服務可用性，也不發出探測） |
| 身分來源 | 沿用既有 Django session 角色，**不建立第二套身分系統** |

### C-5 服務可用性

| 項目 | 內容 |
|---|---|
| 探測方法 | `HEAD`（輕量、不取內容） |
| 逾時 | `FDE_EXTERNAL_MODULE_PROBE_TIMEOUT_SECONDS`（預設 **1.5 秒**） |
| 快取 TTL | `FDE_EXTERNAL_MODULE_PROBE_TTL_SECONDS`（預設 30 秒） |
| 判定 | 取得任何 HTTP 回應即視為在線；失敗 → 「服務暫時不可用」 |
| 例外處理 | **絕不拋出例外** |
| 重新導向 | **不跟隨**（見 §D） |

### C-6 未來資料交換格式（本輪僅預留，未實作）

| 項目 | 內容 |
|---|---|
| 狀態 | **RESERVED**（本輪不接入獨立專案、不指定未知服務埠） |
| 傳輸 | HTTPS + JSON（模組自帶認證，**不得把憑證放在 URL**） |
| 入口 | `GET {entry_url}`（由模組自身完成登入；本層不代傳憑證） |
| 預留端點 | `/health`（GET，健康探測）、`/sessions`（POST，建立工作階段）、`/results`（POST，回傳成果） |
| 封包欄位 | `module_id`、`integration_version`、`student_ref`（**偽名化參照**，不得為姓名／Email／身分證號）、`event`、`occurred_at`、`payload`、`signature` |
| 禁止 | 學生個資；Token／密碼／API Key 置於 URL；自動寫入學習紀錄或自動標記任務完成；自動建立成績、事件或完成紀錄 |
| 教師複核 | **必要**（`teacher_review_required = true`） |

### C-7 錯誤及降級行為

| 情境 | 行為 |
|---|---|
| 設定錯誤（含 URL 未通過安全檢查） | 狀態「尚未接入」，`note` 說明原因 |
| 角色不符 | 狀態「權限不足」，**不探測** |
| 服務異常 | 狀態「服務暫時不可用」，**不產生連結**，工作台仍正常 200 |
| 對學習紀錄的影響 | **無**（不修改任何學習紀錄、任務完成狀態或教師複核結果） |
| 對工作台的影響 | **無**（探測失敗絕不拋出例外） |
| 介面文案 | 明示「不影響你的學習紀錄與教師審核結果」 |

---

## D. 接口安全複查（I4-C）

複查對象：`student_portal/learning/external_modules.py`。實證手法：把模組入口指向**本機探測哨兵**（`demo/tools/i4_sentinel.py`，只記錄不回應內容），以哨兵日誌**客觀判定**介面層是否真的發出探測。

### D-1 教師指定七問逐條對照

| # | 要求 | 驗證方式 | 結果 |
|---|---|---|---|
| 1 | URL 是否限定可信配置來源 | 原始碼檢查：`get_external_module`／`validate_entry_url` 無任何 `request.`／`query_params`／`POST.get` 取用；唯一來源為 `settings.FDE_EXTERNAL_MODULES`（伺服器端 env） | **PASS** |
| 2 | 是否禁止非預期的內網及 metadata 目標 | 預設拒絕 private／loopback／link-local／reserved／multicast／unspecified 位址與雲端 metadata 主機；`127.0.0.1`、`10.9.9.9`、`192.168.1.50`、`169.254.169.254`、`::1`、`0.0.0.0`、`metadata.google.internal` 全部 → 「尚未接入」 | **PASS** |
| 3 | DNS 解析、重新導向是否可能繞過限制 | ①**DNS 解析後**再判定實際位址（主機名指向內網即拒絕；以 mock 驗證）②探測**不跟隨任何 3xx**（`_NoRedirectProbe`），無法以重導繞過 | **PASS** |
| 4 | 是否有短逾時 | 預設 **1.5 秒**，契約上限斷言 ≤ 5 秒 | **PASS** |
| 5 | 是否可能傳送登入憑證 | 探測僅送 `User-Agent: FDE-Module-Probe/1.0`，使用**全新 opener（無 CookieProcessor）**；原始碼掃描無 `Cookie`／`Authorization`／`sessionid`／`csrftoken`；URL 含帳密一律拒絕 | **PASS** |
| 6 | 是否會因服務探測影響正式資料 | 探測僅 `HEAD`，不寫入；複查動作前後**逐表內容指紋（32 張表）完全一致** | **PASS** |
| 7 | 未授權使用者是否完全不探測 | 角色不符時回「權限不足」且 `prober.calls == []`（**角色判定先於探測**） | **PASS** |

### D-2 探測哨兵實證（客觀證據）

| 模式 | 設定 | 哨兵日誌 | 判定 |
|---|---|---|---|
| `deny` | 三模組分別指向 `127.0.0.1:8198`（迴環）、`10.9.9.9:9000`（內網）、`169.254.169.254`（metadata），**無白名單** | **0 筆** | 未通過安全檢查者**完全不探測** ✔ |
| `allow` | MP 指向 `127.0.0.1:8198` 且白名單列出 `127.0.0.1` | **1 筆**：`HEAD /mp FDE-Module-Probe/1.0` | 白名單允許且在線者**確實被探測**，且方法為 `HEAD` ✔ |

### D-3 本輪安全強化（最小修改）

| 強化項 | 內容 |
|---|---|
| 內網／metadata 阻擋 | 新增 `_address_is_restricted()`（private／loopback／link-local／reserved／multicast／unspecified）與 `URL_REJECTED_NETWORK` 說明 |
| DNS 解析檢查 | 新增 `_host_addresses_are_restricted()`：主機名先解析，任一解析結果落在受限網段即拒絕（解析失敗不算安全事件，交由探測自然降級）；結果有 300 秒快取 |
| 不跟隨重導 | 新增 `_NoRedirectProbe`，探測 opener 改為 `build_opener(ProxyHandler({}), _NoRedirectProbe())` |
| 可信主機白名單 | 新增 `settings.FDE_EXTERNAL_MODULE_ALLOWED_HOSTS`（精確主機名或 `*.suffix` 後綴樣式），**白名單優先**；雲端 metadata 主機**無條件拒絕，白名單亦不得放行** |
| 契約擴充 | `external_module_contract()['url_safety']` 新增 `dns_resolution_checked`、`redirects_followed_by_probe`、`allowlist_precedence`、`credentials_sent_by_probe`、`probe_writes_data`、`restricted_address_classes` 等欄位 |

**注意（需教師知悉）**：若教師的獨立模組部署於**內網**（例如 MP 地面站在 `192.168.x.x`），必須同時設定
`FDE_EXTERNAL_MODULE_ALLOWED_HOSTS` 明確列出該主機，介面層才會接受該入口；否則狀態為「尚未接入」，`note` 會直接說明原因。

**未涉及部署網路架構變更**：本次僅為應用層 URL 驗證，未修改任何防火牆、DNS、反向代理或 Cloudflare 設定。

---

## E. 學員／教師教學操作流程（I4-D）

以**統一模擬入口（:8121）**跑完整流程（`verify_i3_e2e.py`，BASE 指向統一入口），全程只使用隔離測試資料。

### E-1 學員流程（學 → 練 → 做 → 測 → 證 → 成長紀錄）

| 步驟 | 結果 |
|---|---|
| 未登入存取工作台 | 302 → `/login/?next=/student/learning-path/`（**不跟隨重導**，防假 PASS） |
| 學員登入 | 成功 |
| 五階段工作台入口 | 302 → `/student/courses/14/learning-path/` |
| 五階段工作台 | 200，五個階段區塊（學習知識／模擬與練習／專項實訓／能力考核／成長日誌）全數存在 |
| 學：學習平台 `/platform/` | 200 |
| 學：AI 助教 `/live/` | **200（本輪由 SKIPPED 轉為 PASS）** |
| 學：下載中心 `/downloads/` | **200（本輪由 SKIPPED 轉為 PASS）** |
| 下載中心 manifest | 仍含 HQGC（既有入口資料未被破壞） |
| 做：F450 十二任務 `/platform/f450` | 200，且實訓頁提供返回工作台路徑 |
| 測：M1–M4 槳葉辨識 | 200（凍結保護，僅讀取） |
| 證：R01–R08 成長日誌總覽 | 200，八項齊備 |
| 證：R01 詳情頁 | 200 |
| R07 成長紀錄頁 | 200（凍結保護，**僅讀取，未執行任何 `--apply`**） |
| 依既有流程提交成果 | POST 既有表單端點 → 302；工作台狀態 `○ 未開始` → **`待教師複核`**（真實寫入，非 UI 假象） |

### E-2 教師流程（班級 → 提交 → 複核 → 班級成果）

| 步驟 | 結果 |
|---|---|
| 未登入存取教師頁 | 302 → `/teacher/login/?next=/teacher/class-outcomes/` |
| 教師登入（`/teacher/login/`） | 成功 |
| 班級清單 | 含授權班級 `P42-A-2026`、**不含**未授權班級 `P42-B-2026` |
| 學員詳情頁 | 200，列出成長紀錄（含 R01） |
| 教師端可見提交內容 | 學員備註逐字命中（`SUBMIT_NOTE`）＋狀態樣式存在 |
| 依既有流程複核 | POST 既有複核端點（`submission_id=137`，approved／88）→ 302 |
| 複核結果反映 | 學員工作台 R01：`待教師複核` → **`✅ 已完成`** |
| 班級成果（結訓報告） | 200，且反映已複核結果 |
| 班級成果匯出 | 摘要 CSV 200（含 BOM）、學員明細 CSV 200（含 BOM） |
| 跨班級權限 | 5 條未授權班級路徑全部 **404** |
| 角色區隔 | 教師開學員工作台 **403**；學員開教師頁 **403** |

**I4-D 結果：PASS 47 / FAIL 0 / SKIPPED 0 / PENDING 1（共 48 項）**
（相較 I3 在純 Django 來源的同一腳本，`/live/`、`/downloads/` 兩項由 SKIPPED 轉為 PASS，證明跨服務入口確實打通。）

### E-3 凍結區非破壞性驗證

| 項目 | 處置 |
|---|---|
| R07 | 僅 GET 檢視；**未執行** `r07_cleanup_apply*.py`（`--apply` 一律未使用） |
| YOLO／best.pt／訓練與推論 | **完全未觸碰** |
| 教師視覺模型倉庫／候選模型／ACTIVE／回滾／複核 | **完全未觸碰**（未為讓測試全綠而修改） |
| 飛行健康 AI 內部程式 | **完全未觸碰**（僅驗證 `/flight-health/` 入口 200） |
| F450 十二任務核心 | 內容**未修改**；僅修正「使其從統一入口可達」的代理路由 |
| MP12／HQGC／F450 3D 獨立專案 | **完全未觸碰**（僅預留接口） |
| R01–R08 資料模型與教師複核規則 | **完全未觸碰**（`models.py` mtime 仍 2026-10-09） |

---

## F. iPhone Safari 人工驗收表（I4-E）

完整表格見 **`docs/reports/I4_iPhone_Safari_Acceptance_Checklist.md`**（教師可直接照做，含逐站勾選欄與異常記錄表）。

涵蓋站別與項目數：

| 站別 | 內容 | 項目數 |
|---|---|---|
| 前置準備 | 啟動 DEMO、同網段、取得密碼、確認 RAG | 4 |
| 第 1 站 | 登入（含「不需重複登入」） | 4 |
| 第 2 站 | 五階段工作台（含無水平溢出、外部模組無連結） | 4 |
| 第 3 站 | F450 十二任務（含不得 404、返回路徑） | 3 |
| 第 4 站 | AI 助教（含 RAG 離線降級） | 3 |
| 第 5 站 | 成長紀錄 R01–R08（含不得顯示假成績、R07 無改動痕跡） | 4 |
| 第 6 站 | 教師班級成果（含 CSV 匯出中文不亂碼） | 5 |
| 第 7 站 | 返回及登出（含登出後不得直接看到工作台、學員不得進教師頁） | 5 |
| **合計** | | **32** |

**沒有真實 iPhone 測試證據，一律標記 `PENDING`。** 本輪以 Chrome 裝置模擬（390×844）先行確認渲染，結果見 §F-1。

### F-1 Chrome 裝置模擬結果（**非真機**）

經**統一模擬入口**（:8121）以 390×844（DPR 2、touch、iPhone UA）驗收：**16/16 PASS**

| 檢查 | 實測 |
|---|---|
| 登入後可進入五階段工作台 | `/student/courses/14/learning-path/` |
| 五階段區塊錨點／導覽錨點 | 5／5、5／5 |
| 功能入口無重複 | 10 個入口、0 重複 |
| 外部模組徽章皆四態之一 | `["尚未接入","尚未接入","尚未接入"]` |
| 預留模組不可點 | 0 個 `<a>` |
| F450 十二任務入口 | `href=/platform/f450` |
| F450 十二任務頁可開啟 | `readyState=complete` |
| 平台頁提供返回工作台路徑 | 存在 |
| 手機 390×844 無水平溢出 | `overflowX=0px` |
| 模組卡片／入口列表／五階段導覽可見 | 3／10／5 |
| 入口連結可點高度 | 10 個中 0 個 < 24px |
| 截圖 | `i3_workbench_iphone390x844.png`、`i3_workbench_desktop.png` |

---

## G. 回歸測試

### G-1 完整 learning 套件

```
Ran 918 tests in 2153.680s
FAILED (failures=2, skipped=26)
```

| 項目 | 數值 |
|---|---|
| 總測試數 | **918** |
| 通過 | **890** |
| 失敗 | **2**（皆為既有，見 §G-3） |
| 略過 | **26** |
| 耗時 | 2153.680 秒（≈ 35.9 分） |
| 與 I3（907 項）比較 | **+11**（I4-C 新增 10 項網路安全測試 + 契約斷言擴充） |
| I4 引入的新失敗 | **0** |

### G-2 I1／I2／I3 HTTP 層回歸（隔離服務，沿用前輪位址）

| 驗收 | 結果 |
|---|---|
| I1 入口與權限 | **46／46 PASS** |
| I2 `default` | **67／67 PASS** |
| I2 `module-up` | **23／23 PASS** |
| I2 `module-down` | **24／24 PASS** |
| I3 `default` | **PASS 25 / FAIL 0**（SKIPPED 1、PENDING 1） |
| I3 `unsafe` | **PASS 24 / FAIL 0**（SKIPPED 1、PENDING 1） |
| I3 `module-up` | **PASS 22 / FAIL 0**（SKIPPED 1、PENDING 1） |
| I3 `module-down` | **PASS 24 / FAIL 0**（SKIPPED 1、PENDING 1） |
| **合計** | **255 PASS / 0 FAIL** |

### G-3 既有失敗獨立列示（未修改受保護功能以求全綠）

| # | 測試 | 性質 | 本輪處置 |
|---|---|---|---|
| 1 | `learning.tests.test_auth::test_platform_hero_action_opens_student_growth_portal` | **測試斷言落後**：`platform-browser.js` 與 `index.html` 已一致改為「我的成長日誌」／`/student/growth/`，測試仍斷言舊字串 | **不修改**；建議改測試 2 行（待教師核可） |
| 2 | `learning.tests.test_vision_flywheel_framework::test_teacher_sees_only_authorized_models_with_four_status_dimensions` | 教師模型列表頁（`teacher_vision_model_list.html`，10-10 改版新頁）已無「訓練用途」欄 | **不修改**（**絕對凍結區**），僅記錄原因與建議 |

> 兩項失敗與 P9／I1／I2／I3 **完全相同**，屬**既有**問題；I4 **未引入任何新失敗**。

---

## H. 受保護區零修改證據

### H-1 版本與資料庫

| 項目 | 值 |
|---|---|
| HEAD | `e5c044244475d18930f32e26696d2cf9cf43dfa6`（未變動） |
| 分支 | `fde-ai-v2.0-dev` |
| Migration 數量 | **20**（`0001`–`0019` + `__init__`）→ **本輪新增 0** |
| 正式資料庫 | `student_portal/db.sqlite3`，mtime **2026-10-07 19:08:32.138589800 +0800**（未變動） |
| 正式資料庫 SHA256 | `1fa462fef825980eb1808cc7f3535d336240c41b91ebc440031d156d9c19c133` |
| git 寫操作 | **0**（未執行 clean／reset／commit／push／merge／deploy） |

### H-2 受保護模組最後修改時間（今日 = 2026-10-13）

| 模組 | 檔案 | mtime | 本輪 |
|---|---|---|---|
| YOLO／推論／模型資料 | `live_backend/app/vision_center.py` | 2026-10-11 06:05 | **0 修改** |
| YOLO API | `live_backend/app/vision_api.py` | 2026-10-11 06:05 | **0 修改** |
| F450 十二任務核心 | `live_backend/app/task_catalog.py` | 2026-10-07 18:39 | **0 修改** |
| F450 任務狀態 | `live_backend/app/task_state.py` | 2026-10-07 22:42 | **0 修改** |
| 訓練紀錄 | `live_backend/app/training_records.py` | 2026-10-07 22:44 | **0 修改** |
| AI Live Coach | `live_backend/app/coach_ask.py` | 2026-10-05 00:59 | **0 修改** |
| 視覺規則（R07 槳葉） | `student_portal/learning/vision_rule_templates.py` | 2026-10-08 17:25 | **0 修改** |
| R01–R08 資料模型 | `student_portal/learning/models.py` | 2026-10-09 02:39 | **0 修改** |
| Flight Health AI | `flight-health/` 全目錄（最新 `js/app.js`） | 2026-10-03 21:58 | **0 修改** |
| 教師視覺模型倉庫頁 | `teacher_vision_model_list.html` | 2026-10-10 19:15 | **0 修改** |
| MP12 內部 | `live_backend/app/mp12_catalog.py`／`mp12_models.py`／`mp12_state.py` | 2026-10-07 22:42 | **0 修改** |

### H-3 逐項對照（教師 I4 指令第二節絕對凍結區）

| # | 凍結項 | 本輪處置 |
|---|---|---|
| 1 | v1.5C 正式版本 | **未觸碰** |
| 2 | YOLO／best.pt／訓練／推論／模型資料 | **未觸碰** |
| 3 | 學員 R07 | **未觸碰**（僅唯讀檢視；未執行 `--apply`） |
| 4 | 教師視覺模型倉庫／候選模型／ACTIVE／回滾／複核 | **未觸碰** |
| 5 | Flight Health AI 內部程式 | **未觸碰** |
| 6 | F450 十二任務核心 | 內容**未修改**；僅修正框架層代理路由使其可達 |
| 7 | MP12／HQGC／F450 3D 獨立專案 | **未觸碰** |
| 8 | R01–R08 既有資料模型及教師複核規則 | **未觸碰** |

### H-4 本輪變更範圍（最小足跡）

I4 期間（18:50 之後）實際變更 **13 個檔案**，其中**產品程式 3 個**：

| 類型 | 檔案 | 內容 |
|---|---|---|
| 產品（框架入口） | `live_backend/app/main.py` | **+2 行路由 + 6 行註解**：新增 `/platform/` 透明代理（修正 F450 入口 404） |
| 產品（獨立適配層） | `student_portal/learning/external_modules.py` | I4-C 安全強化（內網／metadata／DNS／不跟隨重導／可信白名單）＋契約擴充 |
| 產品（配置） | `student_portal/config/settings.py` | 新增 `FDE_EXTERNAL_MODULE_ALLOWED_HOSTS` |
| 測試 | `student_portal/learning/tests/test_external_module_interface.py` | 新增 9 項網路安全測試；1 項測試改寫（配合新的內網預設拒絕）；契約斷言擴充 |
| 測試工具 | `demo/tools/i3_framework_check.cjs` | 2 處等待時間改為有界輪詢／可覆寫（**預設行為不變**） |
| 新增工具 | `demo/tools/i4_isolated.sh`、`i4_sentinel.py`、`verify_i4_cross_service.py`、`verify_i4_security.py`、`run_i4_matrix.sh`、`run_i4_regression.sh` | 隔離啟動器、探測哨兵、I4-A／I4-C 驗收、矩陣與回歸驅動器 |
| 文件 | `docs/reports/I4_iPhone_Safari_Acceptance_Checklist.md`、`docs/reports/I4_Report.md` | I4-E 人工驗收表、本報告 |

**未修改**：`student_portal/learning/views.py`、`urls.py`、所有 `.html` 模板、所有 `.css`、`live_backend/app/vision_center.py`、`live_backend/app/vision_api.py`、`src/` 前端、`live/`、`downloads/`、`flight-health/`。

### H-5 未提交成果保留

本輪**保留全部既有未提交成果**（P0–P9、I1–I3 之所有變更與新增檔案），未執行任何 git 寫操作。

---

## I. 尚未完成及待教師處理事項

| # | 事項 | 說明 | 建議 |
|---|---|---|---|
| 1 | **iPhone 實機驗收（PENDING）** | 本輪僅完成 Chrome 裝置模擬（390×844，16/16） | 教師依 `I4_iPhone_Safari_Acceptance_Checklist.md` 以實機逐項回填 |
| 2 | **三個外部模組尚未接入** | `F450_DIGITAL_TWIN`／`MP_GROUND_STATION`／`HQGC_ASSESSMENT` 僅預留接口 | 由教師獨立專案完成後，設定 `FDE_MODULE_<ID>_ENABLED=1` 與 `FDE_MODULE_<ID>_URL` |
| 3 | **內網模組需設定白名單** | 介面層預設拒絕內網位址（I4-C 安全要求） | 若模組在內網，須同時設定 `FDE_EXTERNAL_MODULE_ALLOWED_HOSTS` |
| 4 | **RAG 真實問答未在隔離環境驗證** | 為避免觸碰正式 `:8770`，隔離實例上游指向死埠，僅驗證降級行為 | 教師於正式／DEMO 環境啟動 RAG 後實測（已列入 iPhone 驗收表第 4 站） |
| 5 | **既有測試失敗 2 項** | 見 §G-3；皆為既有問題，I4 未引入新失敗 | 第 1 項建議改測試 2 行（**待教師核可後才執行**）；第 2 項屬凍結區，僅記錄 |
| 6 | **正式部署需同步 live_backend** | `/platform/` 代理修正位於 `live_backend/app/main.py` | 正式／DEMO 環境重啟 Live Backend 後生效（**本輪未部署、未重啟任何正式服務**） |
| 7 | **git 未提交** | 依安全限制，本輪 0 git 寫操作 | 由教師決定提交時機 |

---

## 附錄：驗收指令（可重現）

```bash
# 隔離測試庫（p42_verify.sqlite3 的獨立副本）
#   D:\FDE-AI-UAS-v2.0\demo\runtime\db\i4_e2e.sqlite3

# 1) 跨服務入口驗收（I4-A）：Django :8120 + Live :8121
bash demo/tools/i4_isolated.sh django   # 背景
bash demo/tools/i4_isolated.sh live     # 背景
python demo/tools/verify_i4_cross_service.py --phase main
# 停止 Django 後：
python demo/tools/verify_i4_cross_service.py --phase degradation

# 2) 接口安全複查（I4-C）：探測哨兵 + 兩模式矩陣
bash demo/tools/run_i4_matrix.sh

# 3) 師生教學流程（I4-D）：經統一模擬入口
I3_E2E_BASE=http://127.0.0.1:8121 python demo/tools/verify_i3_e2e.py

# 4) 手機渲染（I4-E 前置）：Chrome 裝置模擬
FDE_I3_BASE=http://127.0.0.1:8121 FDE_I3_LOGIN_WAIT_MS=9000 \
  node demo/tools/i3_framework_check.cjs

# 5) I1／I2／I3 HTTP 回歸
bash demo/tools/run_i4_regression.sh

# 6) 完整 learning 套件
cd student_portal && env -u DATABASE_URL -u DJANGO_DEBUG -u DJANGO_SETTINGS_MODULE \
  DJANGO_MEDIA_ROOT=../.test-temp/i4_media \
  ../.test-temp/django-venv/Scripts/python.exe manage.py test learning
```

> 所有指令皆使用獨立測試庫與非正式埠；正式服務 `:8022`、`:8770` 全程未被操作。

---

## 結論

1. **2.0 教學平台框架整合完成**：五階段學習工作台成為單一教學入口，`學／練／做／測／證` 全部既有功能可從同一入口使用，且**只需登入一次**。
2. **跨服務缺口已修正**：統一入口原先缺少 `/platform/` 代理，導致「F450 十二任務實訓」404；已以**新增 2 行路由**（沿用既有透明代理）修正並實證。
3. **接口安全已強化**：新增內網／metadata 阻擋、DNS 解析檢查、探測不跟隨重導、可信主機白名單，並以**探測哨兵**取得客觀證據（未通過者 0 次探測；允許且在線者 1 次 HEAD）。
4. **三個外部模組契約完備**：模組 ID、URL 配置、啟用停用、權限要求、服務可用性、未來資料交換格式、錯誤及降級行為皆有明確宣告，**未建立任何假成績、假事件或假完成紀錄**。
5. **受保護區零修改**：HEAD 未變、Migration 0 新增、正式資料庫未變、R07／YOLO／模型倉庫／飛行健康／MP12／HQGC／F450 3D 全部未觸碰。
6. **完成等級 `AUTOMATED PASS`；真實 iPhone Safari 驗收 `PENDING`。完成 I4，停止，不自行開始 I5。**
