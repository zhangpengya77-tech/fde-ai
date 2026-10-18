# FDE-AI-UAS 2.0｜I5 正式交付前封版審查 — 最終報告（A–J）

- 專案：`D:\FDE-AI-UAS-v2.0`
- 分支：`fde-ai-v2.0-dev`
- HEAD（本輪未變動）：`e5c044244475d18930f32e26696d2cf9cf43dfa6`（短碼 `e5c0442`）
- 執行日期：2026-10-13（審查與安全複核）→ 2026-10-14（安全修復、驗收、回歸、封版文件）
- 完成等級：**`AUTOMATED PASS`**（I5-A／I5-B 修復與驗收／I5-C–I5-H 全部產出）；
  **人工 iPhone 驗收：`PENDING`**（未經教師實機確認，不得宣稱 `REAL DEVICE PASS`）
- 本輪原則：**只修復教師已批准的外部模組安全問題**（R1／R2／R3／R7／R9）；不新增功能、不接入外部專案、不部署正式環境、**不進入 I6**

---

## 0. 結果總覽

| 項目 | 結果 | 詳見 |
|---|---|---|
| I5-A 跨服務代理核對（八問） | **PASS 33/33**（路由解析，無覆蓋） | §H-1、附錄二 |
| I5-B 安全複核（修復前） | **12 項 RISK**（R1 高風險已實證可連上 127.0.0.1） | §A、§J-1 |
| I5-B 安全修復（教師批准 R1/R2/R3/R7/R9） | **5/5 完成**，未動其他機制 | §A |
| I5-B 安全驗收（修復後，教師 13 項） | **PASS 39 / FAIL 0** | §B、§C |
| I5-C 封版清單（四組特別區分） | **完成並修正**（R07 不整體標記為「尚未整合」） | §D |
| I5-D 教師教學 SOP | **完成**（9 步，含入口／預期結果／失敗處理） | §E |
| I5-E iPhone Safari | **沿用 I4-E 7 站 32 項表，全數 `PENDING`** | §F |
| I5-F 部署前檢查與回滾方案 | **方案已產出，未執行任何一項** | §G |
| I5-G 回歸 | **learning 934 項：932 通過、2 項既有失敗**；HTTP 層 10 個腳本全綠 | §H |
| I5-H 保護邊界 | **受保護區零修改**（證據見 §I） | §I |
| I5-I 教師試用結論 | **條件式適合教師試用**（條件見 §J-3） | §J |

### 本輪實際修改的檔案（共 9 個，全部屬教師授權範圍）

| # | 檔案 | 修改內容 | 性質 |
|---|---|---|---|
| 1 | `student_portal/learning/external_modules.py` | R1/R2/R3/R7/R9 安全核心修復（IP 釘選、雙層安全檢查、私網精確清單、fail-closed DNS、主機名正規化與數字型拒絕）；修復前備份 `external_modules.py.i5-prebak` | 產品程式 |
| 2 | `student_portal/config/settings.py` | 新增 `FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS`（預設空、精確比對、無通配符）；`FDE_EXTERNAL_MODULE_ALLOWED_HOSTS` 註解改為「主機名信任清單，非空時具強制性，不再授予放行內網位址的能力」 | 直接相關配置 |
| 3 | `student_portal/learning/tests/test_external_module_interface.py` | 新增／改寫 DNS 安全測試（47 → **63** 項） | 測試 |
| 4 | `demo/tools/verify_i5_security.py` | 新增 I5-B 修復後驗收（39 項，含哨兵與 `CONNECT_TARGETS` 實際連線目標記錄） | 測試 |
| 5 | `demo/tools/verify_i4_security.py` | 依新安全語意更新 deny/allow 期望；新增 IP 釘選、白名單不繞過、通配符無效等 5 項回歸證據；修掉「文件字串造成假陽性」的舊斷言 | 測試 |
| 6 | `demo/tools/verify_i3_modules.py` | unsafe 模式期望由「尚未接入」改為「服務暫時不可用」（安全拒絕屬設定失敗，非未配置） | 測試 |
| 7 | `demo/tools/run_i4_matrix.sh` | allow 模式補 `FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS=127.0.0.1` | 測試驅動 |
| 8 | `demo/tools/run_i4_regression.sh` | module-up／module-down 區块補私網精確放行 | 測試驅動 |
| 9 | `demo/tools/i5_route_check.py`、`docs/reports/I5_Report.md` | I5-A 核對工具與本報告 | 工具／文件 |

> 未修改：任何前端頁面、模板、CSS、Django 視圖、URL、模型、Migration、Live Backend、YOLO、教師模型倉庫、R07、MP12、Flight Health AI（證據見 §I）。

---

## A. 安全修復前後對照（教師批准的 R1／R2／R3／R7／R9）

| 編號 | 修復前（實證） | 修復後（實證） | 客觀證據 |
|---|---|---|---|
| **R1** DNS 重綁 TOCTOU | 安全判定與探測**各自獨立解析 DNS**：模擬「判定時回公網 `93.184.216.34`、探測時回 `127.0.0.1`」→ 判定通過，**探測實際連上 `127.0.0.1:8198`，哨兵收到 1 次請求** | `_resolve_probe_target()` **只解析一次**並回傳單一已驗證 IP → `_probe_pinned(url, ip)` 以 `_PinnedHTTPConnection`／`_PinnedHTTPSConnection` **釘選該 IP 建線**，連線過程 0 次 DNS；TLS 仍以原主機名做 SNI 與憑證驗證；未取得釘選 IP 即 `raise OSError("pinned_ip_required")`，**不退回 hostname** | §B（1a–1d）；`verify_i5_security.py` §1；`CONNECT_TARGETS=[('93.184.216.34', 8198)]`、`getaddrinfo` 呼叫 **1 次** |
| **R2** 白名單繞過位址判定 | 白名單命中即 `return True`，不再做 DNS 位址判定：`*.school.edu.tw` + 主機解析到 `127.0.0.1`／`10.0.0.5` → **放行** | 白名單**只決定「主機名是否可信」**（`allowlist_precedence=False`、`allowlist_grants_private_access=False`）；內網位址一律改由 `FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS` **精細比對**放行（預設空、**無通配符**）；metadata／localhost **無條件拒絕** | `verify_i5_security.py` §2/§3：白名單主機解析至 127.0.0.1／10.0.0.5 → `SECURITY_REJECTED`、**實際連線目標=None**；I4-C 新增 5 項 in-process 證據（含「通配符無效」） |
| **R3** DNS 解析失敗視為安全（fail-open） | `metadata.google.internal./x` + 解析失敗 → **放行**；數字型主機名 + 解析失敗 → 全部放行 | **fail-closed**：解析失敗 → 診斷 `DNS_FAILED`、狀態「服務暫時不可用」、**不探測、不連線、不產生連結**，工作台仍 200 | `verify_i5_security.py` §5a/§5b：實際連線目標=None、診斷=DNS_FAILED |
| **R7** 數字／進位制主機名未顯式拒絕 | `0xA9FEA9FE` **放行**；解析失敗時 `2852039166`／`0177.0.0.1`／`2130706433` 全放行 | `_is_numeric_host_form()` 一律拒絕（純十進位、`0x` 前綴、含前導 0 的分段式 IPv4），靜態檢查階段即拒、不進入 DNS | `verify_i5_security.py` §6：5 種表示法全部 `SECURITY_REJECTED`、探測 0 次；正規公網 IP `93.184.216.34` **未被誤傷** |
| **R9** 主機名未正規化（尾點變體） | `metadata.google.internal.` 未命中保留主機名清單（僅靠 DNS 位址判定攔下） | `_normalize_hostname()`：小寫、去尾點（含多點）、去 IPv6 zone、IDNA → 再比對；靜態安全檢查（含測試捷徑路徑）**一律執行** | `verify_i5_security.py` §7：5 組正規化結果正確；§4：尾點變體 metadata 被拒 |

**未修改的既有防護**（修復前即有效，修復後仍有效，且已納入回歸）：無白名單時拒絕內網／link-local／metadata、不跟隨重新導向、HEAD 單次探測、不攜帶任何憑證、未授權零探測、模組停用零探測、任何失敗都不拋出例外拖垮工作台。

---

## B. DNS 重綁實際阻擋證據（R1）

以下由 `demo/tools/verify_i5_security.py` 產出（in-process 哨兵 `127.0.0.1:8198`；以 mock DNS 模擬「判定時為公網、探測時為內網」的重綁情境；`socket.create_connection` 全程記錄實際 TCP 目標）：

```
--- 1. DNS 判定公網、實際解析內網的重綁情境（R1）---
[PASS] 1a 重綁情境未連到內網（實際 TCP 目標）
        實際連線目標=[('93.184.216.34', 8198)]；哨兵收到 0 次請求
[PASS] 1b 探測使用判定時釘選的公網 IP
        首次連線目標=('93.184.216.34', 8198)（DNS 解析 1 次：判定 1 次，連線 0 次）
[PASS] 1c 整個流程只解析一次 DNS
        getaddrinfo 呼叫 1 次
[PASS] 1d 狀態非 AVAILABLE（公網位址不可達 → 服務暫時不可用）
        狀態=SERVICE_UNAVAILABLE／診斷=SERVICE_UNREACHABLE／url=''
```

- **修復前同一情境**：實際連線目標為 `('127.0.0.1', 8198)`，哨兵收到 **1 次**請求（已記錄於 I5 前次報告 §B-1 Q2）。
- 修復後即使 DNS 在「判定 → 探測」之間被改成內網位址，**探測也不會重新解析**，因此重綁窗口被完全消除；連線目標由 `CONNECT_TARGETS`（非 URL 字串）客觀證明。

---

## C. 安全測試結果

### C-1 單元測試：`learning.tests.test_external_module_interface` — **63/63 OK**

新增／改寫的重點測試（對應教師 10 項修復要求）：

| 測試 | 對應要求 |
|---|---|
| `test_dns_rebinding_cannot_reach_internal_address` | ①安全判定與連線使用同一個經驗證 IP；②不得只靠 DNS 快取／TTL |
| `test_probe_connects_to_pinned_ip_not_hostname` | ①⑦（連線目標=釘選 IP；安全檢查失敗不退回 hostname） |
| `test_probe_without_pinned_ip_refuses_to_connect` | ⑦（未釘選即拋錯） |
| `test_allowlist_does_not_bypass_ip_safety_check` | ②③④（白名單不繞過 metadata 禁令、不自動放行內網） |
| `test_private_allowlist_is_exact_only` | ④（內網服務需明確可信配置，無通配符） |
| `test_metadata_host_is_denied_even_in_private_allowlist` | ③（metadata 無條件拒絕） |
| `test_metadata_trailing_dot_variant_is_denied` | ⑥（尾點正規化） |
| `test_hostname_normalization_is_consistent` | ⑥（大小寫／尾點／IDNA 一致正規化） |
| `test_numeric_host_forms_are_rejected`／`test_valid_public_ip_literal_is_accepted` | ⑥（非標準 IP 表示法拒絕，且不誤傷正規公網 IP） |
| `test_dns_failure_is_fail_closed` | ⑤（DNS 解析失敗一律禁止探測，不得 fail-open） |
| `test_probe_does_not_follow_redirects`／`test_probe_sends_no_credentials` | ⑧⑨（不跟隨重導、不攜帶 Cookie／Authorization／個資／憑證） |
| `test_https_probe_uses_default_tls_context` | 憑證驗證未被關閉 |
| `test_security_rejection_does_not_write_learning_data`（`CaptureQueriesContext` 斷言零寫入） | ⑩（不影響學習資料） |
| `test_role_restricted_does_not_resolve_dns` | ⑩（權限隔離；未授權零探測） |
| `test_contract_declares_diagnosis_for_teachers_only`／`test_diagnosis_is_not_rendered_for_students` | 狀態語意（診斷碼不洩漏給學員） |

### C-2 教師 13 項安全驗收對照（`verify_i5_security.py`：PASS 39 / FAIL 0）

| # | 教師驗收項 | 結論 | 客觀證據 |
|---|---|---|---|
| 1 | DNS 重綁 | **PASS** | §B（1a–1d） |
| 2 | 白名單主機解析至 127.0.0.1／10.0.0.5 | **PASS** | 兩者皆 `SECURITY_REJECTED`、實際連線目標=None、未探測；附帶驗證明網清單通配符 `*.school.edu.tw` 對私網 IP **無效** |
| 3 | metadata 無條件拒絕 | **PASS** | 字面 metadata／主機名 metadata／localhost 字面／localhost 名稱／尾點變體，5/5 拒絕且探測 0 次 |
| 4 | DNS 失敗 | **PASS** | fail-closed：`DNS_FAILED`、不探測、狀態「服務暫時不可用」 |
| 5 | 非標準數字 IP | **PASS** | `2852039166`／`0xA9FEA9FE`／`0177.0.0.1`／`2130706433`／`017700000001` 全拒；`93.184.216.34` 未誤傷 |
| 6 | 主機尾點／大小寫／IDNA | **PASS** | 5 組正規化結果正確（含 `example.test...`、`fe80::1%eth0`） |
| 7 | HTTP 3xx 不跟隨 | **PASS** | 哨兵回應 302 → 哨兵請求僅 `['/mp']`；實際連線目標為經驗證 IP |
| 8 | 未授權零探測 | **PASS** | 角色不符 → `ROLE_RESTRICTED`、連線 0 次、解析 0 次 |
| 9 | 模組停用零探測 | **PASS** | `NOT_INTEGRATED`／`NOT_CONFIGURED`、連線 0 次 |
| 10 | 正常可信服務可達 | **PASS** | 11a–11d：`AVAILABLE` 且有連結、哨兵實收 1 次 `HEAD`、Cookie／Authorization 皆空、教師精確配置的內網服務可用 |
| 11 | HTTPS 憑證驗證仍有效 | **PASS** | 12a/12b：自簽憑證端點被拒（TCP 已連線、由 TLS 驗證攔下）、`verify_mode=CERT_REQUIRED`、`check_hostname=True` |
| 12 | 安全拒絕不寫入學習資料 | **PASS** | 13a/13b：零連線（無資料交換途徑）、契約宣告學習紀錄零影響 |
| 13 | （附加）診斷碼不洩漏 | **PASS** | 診斷碼不含主機名／IP、`student_visible=False`；模板僅渲染 `status_key/url/name/state/note`，單元測試以字串比對保證不渲染 |

**「測試必須證明實際連線目標，不得只驗證 URL 字串」**：本脚本全程以 `socket.create_connection` 包一層記錄器（`CONNECT_TARGETS`），並以哨兵請求日誌交叉驗證；上述每一項的「實際連線目標」欄位皆來自**真實 socket 目標**，不是 URL 字串比對。

### C-3 教師 10 項修復要求對照

| # | 要求 | 達成方式 | 狀態 |
|---|---|---|---|
| 1 | DNS 安全判定與實際連線使用同一個經驗證的目標 IP | 判定與探測共用 `_resolve_probe_target()` 的單一 IP；`_probe_pinned()` 釘選 | ✅ |
| 2 | 不得只依靠 DNS 快取或縮短 TTL 宣稱修復 | 未以快取/TTL 作為修復手段；連線層零解析 | ✅ |
| 3 | 白名單只能允許明確受信任服務，不得繞過 metadata 禁令 | `metadata_and_localhost_always_denied=True`，先於白名單與私網清單判定 | ✅ |
| 4 | 內網服務需明確可信配置，不得因通配符自動放行 | `FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS` 精確比對、無通配符、預設空 | ✅ |
| 5 | DNS 解析失敗一律禁止探測，不得 fail-open | fail-closed → `DNS_FAILED`、不探測 | ✅ |
| 6 | 非標準 IP 表示法／尾點／大小寫／IDNA 一致正規化與驗證 | `_normalize_hostname()` + `_is_numeric_host_form()` | ✅ |
| 7 | 禁止安全檢查失敗後退回使用原始 hostname 連線 | 未釘選 IP 即 `raise OSError("pinned_ip_required")` | ✅ |
| 8 | 不得攜帶 Cookie／Authorization／學生個資／憑證 | 僅送 `User-Agent`（`headers={"User-Agent": PROBE_USER_AGENT}`，別無其他標頭設定） | ✅ |
| 9 | 維持短逾時、不跟隨重新導向 | 逾時預設 1.5s；`http.client` 單次取回應，無重新導向處理器 | ✅ |
| 10 | 不得影響正常外部模組停用與權限隔離 | 停用 → `NOT_INTEGRATED` 零探測；角色不符 → `ROLE_RESTRICTED` 零解析零探測 | ✅ |

> HTTP 客戶端可安全鎖定 IP 並保留 TLS 驗證（`_PinnedHTTPSConnection` 以 `ssl.create_default_context()` + 原主機名 SNI），**因此未觸發教師設定的停止條件（關閉憑證驗證）**。

---

## D. 五階段封版清單（I5-C，依教師指示重新核對）

### D-0 標記定義

| 標記 | 含義 |
|---|---|
| **已可實際使用** | 端到端可用，隔離環境已通過 HTTP 層驗收 |
| **已完成但尚未整合** | 程式已完成，但尚未與其他服務或外部專案串接 |
| **僅預留接口** | 只有契約與狀態顯示，無連結、無資料交換 |
| **需要教師實測** | 自動化已通過，但需真人／真機／正式環境確認 |
| **尚有阻塞問題** | 目前無法使用，且有明確阻塞原因 |

### D-1 五階段全部入口（以 `views.py::LEARNING_PATH_STAGES` 與實測為準）

| 階段 | 入口名稱 | 路徑（來源） | 提供服務 | 封版標記 |
|---|---|---|---|---|
| 學 | 學習平台（課程影片與教材） | `/platform/`（`reverse("learning:platform")`） | Django（Live 已代理） | **已可實際使用** |
| 學 | 下載中心（課程軟體） | `/downloads/` | Live Backend 靜態掛載 + `/api/downloads` | **已可實際使用**；**需要教師實測**（正式環境大檔下載） |
| 學 | AI 助教（RAG 知識庫問答） | `/live/` → `/api/rag/ask` | Live Backend → RAG `:8770` | **已可實際使用**；**需要教師實測**（正式 `:8770` 真實問答；隔離環境上游指向死埠，僅驗降級） |
| 練 | 模擬器練習（學習平台） | `/platform/` | Django | **已可實際使用** |
| 練 | AI 助教（練習即時問答） | `/live/` | Live Backend | **已可實際使用** |
| 練 | 四面懸停／起飛與降落／八字訓練 | —（純文字標示） | — | **僅預留接口**（顯示「規劃中」，無連結） |
| 做 | **F450 十二任務實訓** | `/platform/f450` | Django（Live 已代理） | **已可實際使用**（I4-A 修正代理後可達）；**需要教師實測**（iPhone） |
| 做 | **Mission Planner 調參實訓（MP01–MP12）** | `/live/`（TASK_07 深度子模組） | Live Backend | **已可實際使用**（凍結保護，本輪未修改內部程式） |
| 做 | 3D 列印／航線規劃／三維建模／巡檢與產業 SOP／無人車 | —（純文字標示） | — | **僅預留接口** |
| 做 | **F450 3D 數位孿生** | 模組 ID `F450_DIGITAL_TWIN` | 教師獨立專案（未接入） | **僅預留接口** |
| 測 | 手機槳葉方向辨識（M1–M4） | `/student/courses/<id>/prop-scan/` | Django → Live → YOLO／DEMO 模擬推論 | **已可實際使用**（凍結保護） |
| 測 | 飛行健康 AI | `/flight-health/` | Live Backend 靜態掛載 | **已可實際使用** |
| 測 | **MP 地面站** | 模組 ID `MP_GROUND_STATION` | 教師獨立專案（未接入） | **僅預留接口** |
| 測 | **HQGC 考核** | 模組 ID `HQGC_ASSESSMENT` | 教師獨立專案（未接入） | **僅預留接口** |
| 證 | 我的學習成長日誌（R01–R08 總覽） | `/student/courses/<id>/growth/` | Django | **已可實際使用** |
| 證 | 教師班級成果 | `/teacher/class-outcomes/`、`/teacher/class-report/<cohort>/` 等 | Django | **已可實際使用**；**需要教師實測** |

**統計**：已可實際使用 **12**；僅預留接口 **5**（3 個外部模組 + 8 項規劃中專項中的 5 組純文字標示）；需要教師實測 **5**（與前者重疊）；**已完成但尚未整合 2**（見 D-4）；**尚有阻塞問題 0**（見 D-5）。

### D-2 特別區分（教師指定四組，逐一核對）

**（1）F450 十二任務 vs F450 3D 數位孿生 —— 兩個不同模組，未合併、未改名**

| 項目 | F450 十二任務 | F450 3D 數位孿生 |
|---|---|---|
| 識別 | 路徑 `/platform/f450`（Django `learning:platform`） | 模組 ID `F450_DIGITAL_TWIN` |
| 實作位置 | **本專案內**（Django 學員端 + Live Backend 訓練狀態機） | **教師其他專案獨立開發** |
| 封版標記 | **已可實際使用**（本輪零修改） | **僅預留接口** |
| 契約依據 | `external_modules.py` 設計約束：「不得把 F450 十二任務（`/platform/f450`）重新命名為 3D 數位孿生；兩者為不同模組」 | 同上 |

**（2）MP12 vs MP 地面站 —— 前者在平台內，後者為獨立專案**

| 項目 | MP12（Mission Planner 調參實訓） | MP 地面站 |
|---|---|---|
| 識別 | TASK_07 之深度子模組 MP01–MP12（Live Backend MP-12 Catalog／State／Teacher Gate） | 模組 ID `MP_GROUND_STATION` |
| 實作位置 | **本專案內** | **教師獨立專案** |
| 封版標記 | **已可實際使用**（本輪零修改 MP12 內部程式） | **僅預留接口** |
| 證據 | I2 預設模式「[build] 既有入口存在：Mission Planner 調參實訓（MP01–MP12）」PASS | 預設配置 → 尚未接入、無連結、不探測 |

**（3）YOLO 模型使用 vs R07 模型提交 —— 兩條完全不同的路徑**

| 項目 | YOLO 模型**使用**（推論） | R07 模型**提交**（學員上傳） |
|---|---|---|
| 入口 | `/student/courses/<id>/prop-scan/`（M1–M4） | `growth_model_upload` → `evidence_type=YOLO_MODEL` |
| 後端 | Live Backend → YOLO `:8765`（正式）／DEMO 模擬推論 | Live Backend `EvidenceRecord` Artifact Storage → `POST /api/v1/vision/submissions` → `VisionCenter.create_submission` |
| 是否執行模型 | **是**（推論） | **否**（`_validate_model_submission()` 僅檢查副檔名 `.pt`、任務類型、大小 ≤ 500MB） |
| 教師角色 | 模型倉庫 `ACTIVE` 切換（需 `VALIDATED`）／回滾／複核 | 教師收件匣 → 審核 → `APPROVED_FOR_BENCHMARK` → 方可進 Benchmark Sandbox |
| 封版標記 | **已可實際使用**（凍結保護，本輪未修改） | **已完成但尚未整合**（見 D-4 精細拆分） |
| 明確不可混用 | 兩者共用「YOLO」字樣但**無共用程式路徑**；R07 提交**不會**自動影響 `ACTIVE` 模型 | 同上 |

**（4）R07 整體 vs 圖片辨識前端 —— 不得把已完成的 R07 整體標記為「尚未整合」**

| 子項目 | 狀態 | 封版標記 |
|---|---|---|
| R07 學員端模型**提交鏈**（上傳 → 驗證 → Live 儲存 → 教師收件匣） | 完成（凍結保護，本輪零修改） | **已可實際使用** |
| 教師**審核**流程（收件匣、合格／待複核、回饋） | 完成 | **已可實際使用** |
| 教師**模型倉庫**（候選審核、`ACTIVE` 發布、版本回滾、失敗樣本池） | 完成（本輪零修改） | **已可實際使用** |
| 教師端**圖片測試頁**（`teacher_vision_verify.html`，以指定模型對圖片推論） | 完成 | **已可實際使用** |
| **學員端靜態圖片辨識前端** | **尚未建置**：學員可上傳 `.pt`，但沒有「以目前 ACTIVE 模型辨識一張靜態圖片」的學員頁面（`prop-scan` 為螺旋槳方向專用相機頁，非通用靜態圖片辨識；`urls.py` 無對應路由） | **尚未完成** |
| 正式 `:8765` 真實推論 | 本輪未開啟（DEMO 使用模擬推論） | **需要教師實測** |

### D-3 「已完成但尚未整合」清單（共 2 項）

| 項目 | 完成部分 | 尚未整合／尚未完成的部分 |
|---|---|---|
| 學員端 R07 模型提交鏈 | 上傳 → `vision_submission.py` → Live `POST /api/v1/vision/submissions` → `VisionCenter.create_submission`（教師收件匣與模型倉庫皆已完成） | ① 學員端**靜態圖片辨識前端**未建置；② 正式 `:8765` 真實推論未開（DEMO 為模擬推論） |
| 外部模組接口層（三模組） | 契約、四態狀態機、雙層安全檢查、IP 釘選探測與降級**全部完成**（I5-B 修復後 39/39 PASS） | 三個獨立專案**尚未接入**（無 `entry_url`、無資料交換、不指定未知服務埠） |

### D-4 「尚有阻塞問題」清單

**0 項**。所有入口皆為「可用」「僅預留接口」或「明確標記尚未完成」，**無「應該可用但目前不可用」者**；且本輪安全修復未讓任何既有入口退化（回歸見 §H）。

---

## E. 教師教學 SOP（I5-D）

> 適用環境：DEMO 隔離環境 `:8110`／`:8111`（本表所有步驟皆已在隔離環境以 HTTP 層實測通過；iPhone 實機仍未驗）。
> 帳號：學員 `demo.student01@fde-demo.local`、教師 `demo.teacher@fde-demo.local`（密碼取自 `demo.shared.password.txt`）。

| # | 步驟 | 入口／動作 | 預期結果 | 失敗處理 |
|---|---|---|---|---|
| 1 | 學員登入 | `http://192.168.1.114:8111/` → 「登入」→ 輸入學員帳密 | 登入成功並進入學員頁；網址仍為 `192.168.1.114:8111` 開頭（同一入口，只登入一次） | 顯示「電子郵箱或密碼錯誤」→ 先用 `demo/tools/fix_demo_accounts.py` 檢查 `auth_user.username` 是否等於種子 email，再懷疑密碼；出現 `Load failed` → 確認服務是否以 `demo/tools/start_demo.ps1` 啟動（缺 `FDE_DEMO_SIMULATED_INFERENCE=1` 會掛起 >30s） |
| 2 | 進入五階段工作台 | `/student/learning-path/`（或課程卡 → 學習路徑） | 自動進入該課程工作台；依序出現「學／練／做／測／證」五個區塊，每階段有 R01–R08 成長紀錄槽位；390px 無水平溢出 | 302 → 未登入，回步驟 1；404 → 課程不屬於該學員（跨課程隔離，屬預期） |
| 3 | F450 十二任務（做） | 工作台「做」階段 → 「F450 十二任務實訓」 | 開啟 `/platform/f450`（HTTP 200，**不得 404**）；頁面有「五階段學習工作台」可返回 | 404 → Live 代理未生效（I4-A 已修正並實測 200）；回報代理差異 |
| 4 | AI 助教（學／練） | 工作台「學／練」階段 → 「AI 助教」→ `/live/` | Live Coach 頁正常；輸入「F450 螺旋槳方向如何判別？」取得知識庫回答 | RAG 未啟動 → 顯示「FDE 知識庫暫時無法連線」，頁面不卡死、不白屏（屬預期降級，非缺陷） |
| 5 | 成長紀錄（證） | 工作台「證」階段 → 「我的學習成長日誌」→ 點 R01–R08 任一項 | 顯示該項狀態、需求與教師複核結果；狀態用語：未提交＝未開始／已提交＝待教師複核／已複核＝已完成（與教師端一致，不顯示假成績） | 狀態不一致 → 以教師端為準並回報；R07 頁面為凍結保護內容，任何異常都應回報而非自行修改 |
| 6 | 外部模組卡片（做／測） | 工作台「做」「測」階段卡片 | F450 數位孿生／MP 地面站／HQGC 考核顯示 **尚未接入**、**無可點連結**；未由教師接入前不得出現連結 | 若出現連結 → 屬安全設定被放行，立即停止試用並回報（I5-B 修復後預設不可能發生） |
| 7 | 教師登入 | 登出 → `http://192.168.1.114:8111/teacher/login/` → 教師帳密 | 登入成功；班級清單**僅**顯示該教師授權班級 | 403/302 → 帳號無教師角色；用 `verify_browser_flow.py` 檢查登入鏈 |
| 8 | 教師複核 | 教師後台 → 班級 → 學員詳情 → 待複核提交 → 依既有流程複核 | 學員詳情頁可見提交內容（學員備註與證據）；複核後學員工作台狀態由「待教師複核」變「已完成」 | 表單 404 → 改用頁面上既有的複核端點；不可手動改資料庫 |
| 9 | 班級報告與登出 | `/teacher/class-outcomes/` → 班級成果／結訓報告 → 匯出摘要與明細 CSV → 登出 | 報告數字與學員端一致；兩份 CSV 可下載、Excel 中文不亂碼；登出後直接開工作台網址被導向登入頁；學員身分開 `/teacher/` 被拒（403） | 數字不一致 → 以學員端實測值回報；未登入能看到教師頁 → **立即停止試用並回報** |

---

## F. iPhone Safari 人工驗收（I5-E）

- **沿用 I4-E 表格原文**：`docs/reports/I4_iPhone_Safari_Acceptance_Checklist.md`（**7 站 32 項**：前置 4 項 + 第 1 站登入 4 項 + 第 2 站工作台 4 項 + 第 3 站 F450 3 項 + 第 4 站 AI 助教 3 項 + 第 5 站成長紀錄 4 項 + 第 6 站教師 5 項 + 第 7 站返回與登出 5 項）。
- **本輪適用性**：I5 **未修改任何前端頁面、模板、CSS 或 JS**（§I），因此 I4-E 全表**逐項沿用有效**，無需新增或修改項目。
- **與 I5 相關的一項預期補強**（第 2 站 2.4）：外部模組卡片在預設配置下顯示「尚未接入」且**不可點**；若在教師配置後顯示「已可使用」，表示該服務已通過安全檢查並可連結——**只有教師明確配置時才應發生**。
- **狀態**：全數 `PENDING`。未經教師以真實 iPhone 逐項回填並附實機截圖前，**任何手機相關結論一律不得寫成 `REAL DEVICE PASS`**（含 Chrome 390×844 裝置模擬結果亦不算真機）。

---

## G. 正式部署前檢查與回滾方案（I5-F）

> **本節只產出方案，本輪未執行任何一項**：未重啟正式服務、未新增任何正式環境安全配置、未備份正式資料庫、未部署、未建立正式 Tunnel。

| # | 檢查項 | 方案內容 | 通過判準 | 回滾方式 |
|---|---|---|---|---|
| 1 | 重啟服務 | 依序重啟 Django `:8022` → Live `:8111` → RAG `:8770` → YOLO `:8765`；以 `demo/tools/start_demo.ps1`（正式環境改用正式啟動器）逐項啟動並確認無殘留舊程序 | 四個埠皆 LISTENING；`/api/live/health`、`/api/rag/health` 回 200 | 保留舊程序 PID 與啟動指令，必要時殺新起舊 |
| 2 | 新增安全配置 | 在正式環境設定檔新增 `FDE_EXTERNAL_MODULE_ALLOWED_HOSTS`（主機名信任清單，非空時具強制性）與 `FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS`（**預設維持空**；僅在教師確有內網服務時精確填入單一主機名或 IP） | 配置檔可被 settings 讀到（`python manage.py diffsettings` 可見）；私網清單為空時任何內網／metadata 目標皆被拒 | 移除兩個變數即回覆修復前的預設拒絕行為 |
| 3 | 外部模組預設停用 | 三個模組（`FDE_DIGITAL_TWIN`／`MP_GROUND_STATION`／`HQGC_ASSESSMENT`）的 `FDE_MODULE_*_ENABLED` 一律不設或設 `0`、`FDE_MODULE_*_URL` 留空 | 工作台顯示「尚未接入」、無連結、**探測 0 次**（I5 §10 已實證） | 不需回滾（預設即停用） |
| 4 | 正式資料備份 | 以 `demo/tools/backup_demo_data.py` 的同流程對**正式庫** `student_portal/db.sqlite3` 做一次完整備份（含 media 指紋），置於正式環境外部磁碟 | 備份檔 SHA256 與還原演練皆記錄 | 以備份檔還原（還原前停止服務） |
| 5 | 健康檢查 | 逐項實測：首頁 200、`/login/` 200、學員登入 302→工作台 200、`/platform/f450` 200、`/downloads/` 200、`/flight-health/` 200、`/live/` 200、`/api/rag/health` 200、iPhone 同網段實機開首頁無 `Load failed` | 全部符合預期；任一項失敗即中止部署 | 見 #1 |
| 6 | 回滾程序（書面） | 分三層：①程式層：以 `student_portal/learning/external_modules.py.i5-prebak` 覆寫回修復前版本、移除 `settings.py` 的 `FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS` 區塊、以 git 還原 4 個驗收腳本；②配置層：移除兩個白名單變數；③資料層：以 #4 備份還原。**因本輪未 commit，回滾不等於 git revert** | 回滾後 `learning.tests.test_external_module_interface` 仍為 47 項全綠（修復前版本對應 47 項測試） | — |
| 7 | 未提交工作區保護 | 本輪**未執行任何 git 寫入操作**：0 commit／0 push／0 merge／0 reset／0 clean／0 checkout。工作區現有變更（P0–P9、I1–I5 全部成果）**全數保留**，部署前應由教師決定是否先建立 checkpoint（建議先 `git stash list` 為空再提交） | `git status` 仍顯示既有變更；`git log -1` 仍為 `e5c0442` | 若誤執行 git 操作，以 `git reflog` 與 `.i5-prebak` 救援 |
| 8 | v1.5C 完全隔離證據 | v1.5C 為**另一個分支**（`fde-ai-v1.5c`，HEAD `12cabfb`，2026-09-23）且**不在本工作區**；本輪所有操作只在 `D:\FDE-AI-UAS-v2.0`（worktree `fde-ai-v2.0-dev`，HEAD `e5c0442`） | 兩個分支 HEAD 與工作區路徑皆與本輪開始時一致 | 不適用（未觸碰） |

---

## H. 回歸結果（I5-G）

### H-1 彙總（全部為隔離環境，不觸碰正式 `:8022`／`:8770`／正式資料庫）

| 範圍 | 腳本／指令 | 結果 |
|---|---|---|
| I1 外部模組接口層 | `verify_i1_external_modules.py` | **46/46 PASS** |
| I1／I5 單元測試 | `manage.py test learning.tests.test_external_module_interface` | **63/63 OK** |
| I2 四態與降級 | `verify_i2_framework.py` default | **67/67 PASS** |
| I2 四態與降級 | `verify_i2_framework.py` module-up | **23/23 PASS** |
| I2 四態與降級 | `verify_i2_framework.py` module-down | **24/24 PASS** |
| I3 端到端流程 | `verify_i3_e2e.py` | **45 PASS / 0 FAIL / 2 SKIPPED / 1 PENDING**（共 48） |
| I3 外部模組安全 | `verify_i3_modules.py` default | **25 PASS / 0 FAIL**（共 27，1 SKIPPED、1 PENDING） |
| I3 外部模組安全 | `verify_i3_modules.py` unsafe | **24 PASS / 0 FAIL**（共 26，1 SKIPPED、1 PENDING） |
| I3 外部模組安全 | `verify_i3_modules.py` module-up | **22 PASS / 0 FAIL**（共 24，1 SKIPPED、1 PENDING） |
| I3 外部模組安全 | `verify_i3_modules.py` module-down | **24 PASS / 0 FAIL**（共 26，1 SKIPPED、1 PENDING） |
| I4 跨服務入口 | `verify_i4_cross_service.py --phase main` | **31 PASS / 0 FAIL / 2 PENDING**（共 33） |
| I4 跨服務降級 | `verify_i4_cross_service.py --phase degradation` | **9/9 PASS** |
| I4 接口安全複查 | `verify_i4_security.py --mode deny` | **35 PASS / 0 FAIL / 1 PENDING**（共 36） |
| I4 接口安全複查 | `verify_i4_security.py --mode allow` | **36 PASS / 0 FAIL / 1 PENDING**（共 37） |
| I5 路由核對 | `i5_route_check.py` | **33/33 PASS**（無路由被覆蓋） |
| I5 DNS 安全（教師 13 項） | `verify_i5_security.py` | **39 PASS / 0 FAIL** |
| **learning 完整回歸** | `manage.py test learning`（分 6 批 + 接口層） | **934 項：932 通過、2 項既有失敗**（見 H-2） |

**HTTP 層與安全層合計：546 項 PASS、0 項 FAIL**（不含 PENDING／SKIPPED）；PENDING 項目全部為 iPhone 真機與正式環境項。

learning 回歸分批明細（避免單回合觸發 temp 清理防護）：

| 批次 | 模組 | 結果 |
|---|---|---|
| 接口層 | `test_external_module_interface` | 63 OK |
| b1 | anonymous_accounts／auth／course_sync／deployment_settings／enrollments | 33 OK、**1 既有失敗** |
| b2 | golden_set_center／golden_set_contract／golden_set_immutability／growth_records／growth_video／i3_student_experience | 218 OK（22 skipped） |
| b3 | p2_task_record_chain／p8_showcase_security／p9_readonly_report／project_directions／public_ai／public_platform／seed_tasks | 111 OK |
| b4 | student_email_login／student_learning_path／student_prop_scan_page／student_survey／student_survey_v2／student_tasks／survey_recommendations／task_versions | 98 OK |
| b5 | registration_profile／qa_accounts／teacher_catalogue／teacher_class_outcomes／teacher_class_report／teacher_class_showcase／teacher_cohort_delivery／teacher_survey_dashboard／teacher_workflow／v15b_test_cohort_seed | 218 OK |
| b6 | teacher_vision_acceptance／teacher_vision_center_page／vision_flywheel_framework／vision_model_center／vision_repository／vision_rule_templates／vision_snapshot／vision_snapshot_security | 191 OK、**1 既有失敗**（4 skipped） |

### H-2 兩項既有失敗（獨立記錄，與本輪無關，未修改教師模型倉庫消除）

| # | 測試 | 失敗原因（客觀） | 本輪處置 |
|---|---|---|---|
| 1 | `learning.tests.test_auth.StudentRegistrationTests.test_platform_hero_action_opens_student_growth_portal` | 斷言 `src/platform-browser.js` 含 `label: '我的學習日誌'`；先前的改版已將 hero 標籤改為「我的學習成長日誌」，字串不存在 | **未修改**（前端屬保護/凍結範圍，且非本輪變更造成）；自 P9 起即存在，舊日誌 `learning-full-test.log` 已記載 |
| 2 | `learning.tests.test_vision_flywheel_framework.VisionFlywheelFrameworkTests.test_teacher_sees_only_authorized_models_with_four_status_dimensions` | 教師模型列表模板已於 2026-10-10 改版移除「訓練用途」欄，測試仍斷言該欄 | **未修改**（教師模型倉庫凍結；依教師明令不得修改教師模型倉庫來消除歷史失敗） |

> 兩項失敗在 I5 之前即存在（I1／P9 報告已歸位），**本輪新增 0 項失敗、修復 0 項失敗、也未為消除失敗而動保護區**。

### H-3 因安全語意變更而同步更新的驗收腳本（透明記錄）

本輪依教師批准的新狀態語意（「安全檢查失敗 → 服務暫時不可用」而非「尚未接入」）更新了 4 個驗收腳本與其驅動：

| 檔案 | 更新內容 | 為什麼必須更新 |
|---|---|---|
| `verify_i4_security.py` | deny 模式三個模組期望由「尚未接入」改為「服務暫時不可用」；allow 模式改由 `FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS` 放行迴路位址；程式碼斷言改指向 `_probe_pinned`／`_Pinned*`（舊的 `_http_probe`／`_NoRedirectProbe` 已被 IP 釘選實作取代）；`allowlist_precedence` 期望由 `True` 改為 `False` | 產品語意經教師批准變更；舊斷言會因「文件字串含 Cookie／Authorization」等產生假陽性 |
| `verify_i3_modules.py` | unsafe 模式期望由「尚未接入」改為「服務暫時不可用」 | 敏感參數 URL 屬**安全設定拒絕**，非未配置 |
| `run_i4_matrix.sh` | allow 模式補 `FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS=127.0.0.1` | 白名單不再授予內網存取 |
| `run_i4_regression.sh` | module-up／module-down 區塊補同一變數 | 同上 |

**未為讓測試通過而放寬任何產品安全判定**：更新後仍保留並新增了 5 項「白名單／通配符不得放行內網」的回歸證據（deny 模式全數 PASS）。

### H-4 未取得真機結果

所有 `PENDING` 項目（iPhone Safari、正式 Tunnel 登入、正式 `:8770` 真實問答、正式 `:8765` 真實推論）**均未取得結果**，本報告不對其下任何結論。

---

## I. 受保護區零修改證據（I5-H）

**證據方法**：① `git status`／`git diff --name-only`（追蹤檔變更清單）；② 檔案 mtime（本輪時間窗 = 2026-10-14 00:37 起，即建立 `.i5-prebak` 之後）；③ 分支與 worktree 分離；④ 隔離環境只使用測試庫（`demo/runtime/db/*.sqlite3`），未連接正式庫。

| 保護區 | 本輪修改 | 客觀證據 |
|---|---|---|
| v1.5C 穩定母版（程式／資料／部署） | **0** | v1.5C 位於**另一分支** `fde-ai-v1.5c`（HEAD `12cabfb`，2026-09-23），**不在本工作區**；本輪所有操作只在 `D:\FDE-AI-UAS-v2.0`（worktree `fde-ai-v2.0-dev`，HEAD 仍為 `e5c0442`） |
| YOLO：`best.pt`、訓練程式、資料集、`data.yaml`、推論／規則引擎、候選／ACTIVE 模型、版本回滾 | **0** | 所有 `best.pt` mtime 均為 2026-10-11 或更早（`demo/backup/*` 快照）；本輪未執行任何推論服務操作；`vision_center.py`／`vision_api.py` 未修改 |
| R07 提交資料模型／上傳驗證／提交權限／審核歷史 | **0** | `growth_records.py` mtime 2026-10-13 09:16、`models.py` 2026-10-09、`training_records.py` 2026-10-07，**全部早於本輪時間窗**；0 Migration、未連正式庫 |
| 教師模型倉庫（上傳清單／驗證／候選審核／ACTIVE 發布／回滾／失敗樣本池／Golden Set／Benchmark） | **0** | 相關模板與視圖（`teacher_vision_center.html`、`teacher_vision_verify.html`、`teacher_golden_*`）與程式 mtime 均早於本輪；**未為消除 H-2 第 2 項失敗而修改任何一行** |
| Flight Health AI | **0** | `/flight-health/` 靜態掛載內容未修改 |
| F450 十二任務核心 | **0** | `task_catalog.py`（2026-10-07）、`task_state.py`（2026-10-07）、`sessions.py`（2026-10-07）、`coach_ask.py`（2026-10-05）mtime 均早於本輪；I2 實測 F450 十二任務與 R01–R08 狀態未被改寫 |
| MP12（Catalog／State／Teacher Gate／前端） | **0** | `mp12_catalog.py`／`mp12_state.py`／`mp12_models.py` 與 `live/mp12-frontend-integration.test.cjs` 未修改；I2 實測 MP01–MP12 入口正常 |
| HQGC | **0** | 下載中心僅**唯讀**檢查：I1／I2 實測 `D:\下載中心文件\download_manifest.json` 仍含 HQGC 條目 |
| F450 3D 數位孿生 | **0** | 未接入、未指定服務埠、未建立任何連線（I5 §11d 僅驗證「教師精確配置時可用」的語意） |
| 正式資料庫／正式服務 | **0** | 全程僅使用隔離測試庫 `demo/runtime/db/{i3_e2e,i4_e2e,p42_verify}.sqlite3`；正式 `:8022` 未被重啟或連線 |
| Git 歷史 | **0** | `git log -1` 仍為 `e5c0442`；0 commit／0 push／0 merge／0 reset／0 clean／0 checkout；工作區變更全數保留 |

**唯一非程式碼的副作用（如實記錄）**：learning 測試套件於 `student_portal/private_media/`（已被 `.gitignore` 排除）重新產生了 Golden Set 測試圖片與 evidence 上傳測試檔（mtime 01:52–02:01）。這是測試既有行為，**非正式資料庫、非程式碼、非 git 追蹤檔**，與先前各輪執行同一套件的行為一致。

---

## J. 剩餘風險與教師試用結論（I5-I）

### J-1 未修復的殘餘風險（教師僅批准 R1/R2/R3/R7/R9）

> 修復前共辨識 12 項 RISK。教師批准的 **R1／R2／R3／R7／R9 已完成修復並驗收**（前後對照見 §A，實證見 §B／§C）；以下為**未修復**的殘餘風險。

| 編號 | 級別 | 風險 | 現狀與建議 |
|---|---|---|---|
| **R4** | 中 | **埠號未限制**：`http://<主機>:6379/`、`:22/`、`:9200/` 等非 HTTP 埠只要主機通過安全檢查即可被探測 | 建議正式啟用外部模組前，先以網路層（防火牆／僅允許 80/443 出站）或反向代理限制；如要程式層白名單，需教師另一次批准（`FDE_EXTERNAL_MODULE_ALLOWED_PORTS`） |
| **R5** | 中 | **同步探測阻塞 Django worker**：3 個模組全啟用且皆逾時，最壞約 4.5 秒附加於工作台渲染 | 預設模組全數停用（§G-3）時不發生；建議縮短 TTL 或改背景刷新（屬交付後優化） |
| **R6** | 低 | 3xx 回應被視為「服務在線」，學員瀏覽器可能被模組自身重新導向 | 屬模組契約責任；建議補契約文字（模組不得將學員導向非公開位址），無程式變更 |
| **R8** | 低 | 連線資源無全域上限 | 受模組數（3）與 TTL 快取自然限制，未見無界成長 |
| A-2-1 | 低 | Live 代理 `host` 標頭寫死 `127.0.0.1:8022` | 正式部署確為此位址時正確；改埠前需一併改 |
| A-2-2 | 中 | `x-forwarded-proto` 經 Cloudflare Tunnel 後為 `http` | **列入教師正式環境實測項**（§J-3 條件 b） |
| A-2-3 | 低 | `httpx.AsyncClient` 無連線池 | 效能層面，最壞體感受 15s 逾時限制 |

### J-2 其他待教師處理事項

1. 兩項既有測試失敗（§H-2）是否允許修正（前端標籤／教師模型列表模板）。
2. `git` 仍未提交：P0–P9、I1–I5 全部成果保留在工作區，是否建立 checkpoint 由教師決定。
3. 正式環境的 RAG `:8770` 真實問答、YOLO `:8765` 真實推論、學員端靜態圖片辨識前端（§D-2 第 4 組）是否排入後續迭代。

### J-3 教師試用結論：**條件式適合**

**結論：適合教師在受控環境試用，但必須先滿足下列全部條件；條件未滿足前不得視為可交付。**

| 條件 | 內容 | 現狀 |
|---|---|---|
| a | 教師以真實 iPhone 完成 `I4_iPhone_Safari_Acceptance_Checklist.md` 的 **7 站 32 項**並回填截圖 | `PENDING` |
| b | 正式 Cloudflare Tunnel 環境實際登入一次（驗證 A-2-2：`x-forwarded-proto` 為 `http` 時的登入 POST） | `PENDING` |
| c | 外部模組維持**預設停用**；若要啟用，入口只能指向 80/443，或教師精確列入 `FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS` 的單一主機名／IP | 預設即停用（已實證） |
| d | 正式 `:8770` 真實問答、正式 `:8765` 真實推論各實測一次 | `PENDING` |
| e | 依 §G 完成 8 項部署前檢查（含正式庫備份與回滾演練） | 未執行（僅方案） |

### J-4 停止條件（試用期間任一發生即停用外部模組並回報）

1. 任何情境下探測連到內網／迴路／link-local／metadata 位址（含白名單命中時）。
2. DNS 解析失敗卻得到「已可使用」。
3. 未授權角色或模組停用時出現任何連線或解析。
4. 安全拒絕在前端頁面看到主機名／IP／診斷碼（學員端）。
5. 外部模組啟用後工作台出現 500 或學習紀錄被改寫。
6. 非 80/443 的埠被探測（R4 未修復前的替代防線失效時）。

### J-5 後續建議順序（本輪不執行）

1. iPhone 實機驗收（§F）→ 2. 正式 Tunnel 登入實測（A-2-2）→ 3. §G 部署前檢查與回滾演練 → 4. R4 埠號限制（需教師批准）→ 5. R5/R8 效能與資源 → 6. R6 契約文字 → 7. 兩項既有測試失敗 → 8. 學員端靜態圖片辨識前端（§D-2 第 4 組）。

**本輪至此停止**：依教師指令，完成 I5 後**不進入 I6**、**不部署正式環境**、不提交／不推送任何 git 變更。

---

## 附錄：可重現指令與產物

```bash
cd /d/FDE-AI-UAS-v2.0

# I5-A 路由解析核對（不啟動服務、不發網路請求）
PYTHONUTF8=1 NO_PROXY='*' \
  "C:/Users/admin/AppData/Local/Python/pythoncore-3.14-64/python.exe" demo/tools/i5_route_check.py

# I5-B 安全修復驗收（教師 13 項；in-process 哨兵 + 實際連線目標記錄；不寫資料庫）
PYTHONUTF8=1 "D:/FDE-AI-UAS-v2.0/.test-temp/django-venv/Scripts/python.exe" \
  demo/tools/verify_i5_security.py

# I1／I5 單元測試（63 項）
cd student_portal && env -u DJANGO_DEBUG -u DATABASE_URL \
  DJANGO_DB_NAME="D:/FDE-AI-UAS-v2.0/demo/runtime/db/i4_e2e.sqlite3" \
  ../../.test-temp/django-venv/Scripts/python.exe manage.py test \
  learning.tests.test_external_module_interface

# I1／I2／I3 HTTP 層回歸（自動啟動隔離服務 :8112／:8116 + 哨兵 :8198）
bash demo/tools/run_i4_regression.sh

# I4-C 接口安全矩陣（deny／allow 兩模式，:8120 + 哨兵 :8198）
bash demo/tools/run_i4_matrix.sh

# I4-A 跨服務（main + degradation，:8120／:8121）
bash .test-temp/i5g_run_i4.sh          # 本輪新增的一次性驅動腳本

# I3-A 端到端教學流程（:8115）
bash .test-temp/i5g_run_i3e2e.sh       # 本輪新增的一次性驅動腳本

# learning 完整回歸（分批；日誌 .test-temp/i5g_batch_b*.log）
bash .test-temp/i5g_run_batch.sh b1 test_anonymous_accounts test_auth ...
```

| 產物 | 位置 |
|---|---|
| I5-A 路由核對輸出 | `demo/runtime/logs/`（本次終端輸出，PASS 33/33） |
| I5-B 安全驗收明細（JSON） | `demo/runtime/logs/i5_security_findings.json` |
| I1／I2／I3 回歸日誌 | `/tmp/i5g_i123_regression.log`（PASS 255 項） |
| I4 安全矩陣日誌 | `/tmp/i5g_i4_matrix2.log`（deny 35＋allow 36 PASS） |
| I4-A 跨服務日誌 | `/tmp/i5g_i4a.log`（main 31＋degradation 9 PASS） |
| I3-A 端到端日誌 | `/tmp/i5g_i3e2e.log`（45 PASS） |
| learning 分批日誌 | `.test-temp/i5g_batch_b1..b6.log` |
| 修復前備份 | `student_portal/learning/external_modules.py.i5-prebak` |

---

## 附錄二：I5-A 跨服務代理核對結果（八問，PASS 33/33）

被檢對象：`live_backend/app/main.py`（本輪**零修改**）；I4 新增者為
`Route("/platform/", django_portal_proxy)` 與 `Route("/platform/{portal_path:path}", django_portal_proxy)`。

| # | 教師要求 | 結論 | 客觀證據 |
|---|---|---|---|
| 1 | 不覆蓋既有路由 | **PASS** | 路由總數 79；33 個代表性路徑樣本中，每個樣本的**所有** FULL match 皆指向**同一 endpoint**（33/33）。`/platform/` 出現 2 個 FULL match 但為同一 handler，且此形態與**既有的** `/login/`、`/student/`、`/teacher/` 完全相同（Starlette `{x:path}` 可匹配空字串）→ 屬既有慣例的無害重複 |
| 2 | 不影響 `/live/` | **PASS** | `/live/`、`/live/index.html` → 唯一命中 `Mount(/live)` |
| 3 | 不影響 `/downloads/` | **PASS** | 唯一命中 `Mount(/downloads)`；`/api/downloads` 不受影響 |
| 4 | 不影響 `/flight-health/` | **PASS** | 唯一命中 `Mount(/flight-health)` |
| 5 | 不影響 AI Live Coach 和 RAG | **PASS** | `/api/live/*` 共 31 條全數唯一命中；`/api/rag/ask`、`/api/rag/health` 唯一命中；RAG 上游不可用時明確降級為 503 |
| 6 | 不繞過 Django 登入與權限 | **PASS** | 代理為透明轉發，不注入身分、不偽造標頭；I4-A 實測：學員 Cookie 存取 `/teacher/` → 403；匿名存取工作台 → 302（未登入 302 非 200） |
| 7 | 不錯誤轉送 Cookie／Token／敏感標頭 | **PASS**（3 項觀察） | 請求側剝除 `host`/`connection`/`content-length`/`accept-encoding`；回應側剝除 `content-length`/`connection`/`transfer-encoding`/`content-encoding`，再以 `get_list("set-cookie")` 逐條 append（未改寫 `Domain`/`Path`/`Secure`）→ 正是「全程只登入一次」的關鍵 |
| 8 | 上游故障時正確降級 | **PASS** | `except httpx.HTTPError → 503`；I4-A 降級驗收 9/9 PASS；逾時 15.0 秒 |
