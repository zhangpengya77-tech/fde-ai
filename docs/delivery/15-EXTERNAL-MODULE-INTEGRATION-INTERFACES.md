# FDE-AI-UAS 2.0 交付文件｜15 外部模組後續接入介面清單

**文件版本**：v1.0（2026-10-14 Phase 6 產出）
**依據**：教師 Phase 6 指令第七節第 6 項
**性質**：**介面清單與接入指南；不開發、不修改任何外部模組本身**

---

## 一、範圍與現狀（唯讀盤點）

| 模組 | 顯示名稱 | 掛載階段 | 目前狀態 |
|---|---|---|---|
| `F450_DIGITAL_TWIN` | F450 數位孿生 | build（做） | **待接入**（預設 DISABLED，無連結） |
| `MP_GROUND_STATION` | MP 地面站（預留） | assess（測） | **待接入** |
| `HQGC_ASSESSMENT` | HQGC 考核（預留） | assess（測） | **待接入** |

- 三者皆為**教師在其他專案獨立開發**的系統，本專案僅預留介面（`integration_version: reserved-1.0`）。
- 預設（未設定任何環境變數）下：工作台只顯示「待接入」徽章，**不產生連結、不標記完成狀態、不建假資料、完全不發出探測**。
- 介面層已通過 I5 安全強化（IP 釘選、雙層檢查、fail-closed、四態語意），**接入時不得弱化**。

---

## 二、教師需提供的資訊（每個模組）

| # | 項目 | 說明 |
|---|---|---|
| 1 | 模組基礎網址（`entry_url`） | **只能是基礎網址**；不得夾帶登入 Token、學生個資等敏感參數（前端會做靜態檢查並拒絕） |
| 2 | 主機名稱 | 若平台已設定 `FDE_EXTERNAL_MODULE_ALLOWED_HOSTS`（非空時具有強制性），該主機名**必須精確列入**（或符合其 `*.suffix` 樣式）才會被接受 |
| 3 | 是否部署於內網 | 若指向內網／迴環／link-local／保留位址，必須以**精確主機名或精確 IP** 列入 `FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS`（**不支援通配符**；metadata／localhost 永遠拒絕，列入也無效） |
| 4 | 使用者授權範圍 | 目前三個模組 `allowed_roles` 皆為 `["student", "teacher"]`；如需限縮須修改 `external_modules.py` 的靜態契約（改動介面層須教師核准） |
| 5 | 身分驗證方式 | **本介面不代管認證**。若模組需登入，由模組自行處理；入口 URL 不得夾帶憑證 |

---

## 三、環境變數接入方式（唯伺服器端設定）

```bash
# 啟用與位址（ENABLED=1 且提供 URL 才視為可用）
FDE_MODULE_F450_DIGITAL_TWIN_ENABLED=1
FDE_MODULE_F450_DIGITAL_TWIN_URL=https://<twin-host>/
FDE_MODULE_MP_GROUND_STATION_ENABLED=1
FDE_MODULE_MP_GROUND_STATION_URL=https://<mp-host>/
FDE_MODULE_HQGC_ASSESSMENT_ENABLED=1
FDE_MODULE_HQGC_ASSESSMENT_URL=https://<hqgc-host>/

# 主機名信任白名單（非空時強制；不授予內網能力）
FDE_EXTERNAL_MODULE_ALLOWED_HOSTS=<mp-host>,*.hqgc.internal

# 內網精確放行（僅精稱主機名或 IP；預設空）
FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS=mp.school.edu.tw,192.168.1.50

# 探測參數（選用）
FDE_EXTERNAL_MODULE_PROBE_TIMEOUT_SECONDS=1.5   # 單次探測逾時
FDE_EXTERNAL_MODULE_PROBE_TTL_SECONDS=30        # 探測結果快取
```

> 所有設定皆來自 **Django settings／環境變數**，**不接受任何請求輸入**（已實測）。

---

## 四、安全語意（接入前必讀；I5 已強化，禁止弱化）

### 4.1 雙層檢查

1. **靜態檢查**（免 DNS）：scheme 白名單、禁帳密、禁敏感參數、拒 reserved hostname、拒數字型主機名、強制主機名白名單、拒字面 IP（除非精確列入私網放行）。
2. **解析後 IP 驗證**：DNS 後驗證 IP 是否為內網／迴環／link-local／保留位址／metadata；未釘選即 `raise OSError`，**不退回 hostname**。

### 4.2 IP 釘選

- `evaluate_entry_url()` 解析驗證後回傳單一 IP → `_probe_pinned(url, ip)` 以該 IP 建線，**連線過程 0 次 DNS**（杜絕 DNS rebinding）。
- HTTPS 使用 `ssl.create_default_context()` + 原主機名 SNI，**保留完整憑證驗證**（禁止關閉）。

### 4.3 四態與診斷碼（教師可見，學員不可見）

| 學員看到 | 狀態語意 | 教師診斷碼 |
|---|---|---|
| 尚未接入 | 未配置／已停用 | `NOT_CONFIGURED` |
| 權限不足 | 未授權（零解析零探測） | `ROLE_RESTRICTED` |
| 可連線 | 服務可連線 | `SERVICE_ONLINE` |
| 暫時不可用 | 服務不可達／DNS 失敗／安全拒絕 | `SERVICE_UNREACHABLE`／`DNS_FAILED`／`SECURITY_REJECTED` |

> `DIAG_*` 不含主機名與 IP（`student_visible=False`），學員模板只渲染通用四態文字。

### 4.4 fail-closed 原則

DNS 失敗 → `DNS_FAILED`，**不探測**；安全拒絕 → `SECURITY_REJECTED`，**不探測**。未列白名單的內網位址一律拒絕。

---

## 五、接入步驟（教師核准後執行）

| 步驟 | 動作 | 完成判準 |
|---|---|---|
| 1 | 確認模組已由教師專案獨立開發完成並可對外服務 | 該模組自己的驗收通過 |
| 2 | 取得基礎網址，通過第二節資訊盤點 | 無敏感參數、主機名已確定 |
| 3 | 設定環境變數（第三節）並**重啟受影響服務** | `manage.py check` 無誤 |
| 4 | 教師後台觀察診斷碼 | 非 `SECURITY_REJECTED`／`DNS_FAILED` |
| 5 | 以學員與教師身分各開一次工作台 | 徽章由「尚未接入」變為實際狀態；學員只看到四態通用文字 |
| 6 | 執行 I5 安全回歸（`demo/tools/verify_i1_external_modules.py` 與 I5 單元） | 與 I5 基準一致或更嚴 |
| 7 | 更新本文件各模組狀態並通知教師 | 文件與現實一致 |

---

## 六、明確不做的事（邊界）

- **不開發** F450 數位孿生、MP 地面站、HQGC 考核的任何功能本體。
- **不修改** MP12 內部程式（屬獨立專案）。
- **不為了讓模組上線而**關閉憑證驗證、放寬白名單為通配、或把 `ALLOW_PRIVATE_HOSTS` 改成萬用字元。
- 不在入口 URL 中代管任何使用者憑證。

---

## 七、資料契約（建議教師模組回傳）

本介面只做**入口與健康探測**，不傳送學員資料；若未來需要傳遞上下文，建議採：

| 欄位 | 建議 |
|---|---|
| 使用者識別 | 由模組自行依 session 判讀，本平台不代傳 |
| 課程／任務上下文 | 以查詢參數顯式傳遞（非敏感） |
| 回傳格式 | JSON；錯誤時回傳統一錯誤碼，頁面只顯示四態通用文字 |

---

**本文件為接入介面清單；三個外部模組目前皆為「待接入」。**
**接入口介面層（`student_portal/learning/external_modules.py`）本輪零修改。**
