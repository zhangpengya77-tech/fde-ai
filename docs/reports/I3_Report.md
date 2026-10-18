# FDE-AI-UAS 2.0｜I3 教學流程整合與接口安全驗收 — 交付報告

- 專案：`D:\FDE-AI-UAS-v2.0`
- 分支：`fde-ai-v2.0-dev`
- HEAD（未變動）：`e5c0442`
- 執行日期：2026-10-13
- 對應指令：教師 I3 指令（一、最高原則；二、I3-A；三、I3-B；四、I3-C；五、I3-D；六、驗收；七、安全限制；八、交付報告）

---

## 0. 完成等級與結果總覽

| 等級 | 含義 | 本輪結果 |
|---|---|---|
| `AUTOMATED PASS` | 單元測試 + 隔離 HTTP 驗收 + Chrome 裝置模擬全數通過 | **達成** |
| `REAL DEVICE PASS` | iPhone 實機 Safari 人工驗收 | **`PENDING`（本輪未執行）** |

> 本輪所有手機結論均來自 **Chrome 裝置模擬（390×844）**，**不等於**真實 iPhone Safari。
> 報告中不出現任何未經實機驗證的「真機通過」字樣。

### 全部驗收結果彙總（PASS／FAIL／SKIPPED／PENDING）

| 驗收項 | PASS | FAIL | SKIPPED | PENDING | 合計 |
|---|---|---|---|---|---|
| I3-A 端到端教學流程 | 45 | **0** | 2 | 1 | 48 |
| I3-B 外部模組接口安全（四模式） | 95 | **0** | 4 | 4 | 103 |
| I3-C 學生操作體驗（單元） | 13 | **0** | 0 | 0 | 13 |
| I3-C 學生操作體驗（Chrome） | 16 | **0** | 0 | 0 | 16 |
| I1 回歸 | 46 | **0** | 0 | 0 | 46 |
| I2 回歸（default／module-up／module-down） | 114 | **0** | 0 | 0 | 114 |
| **本輪新增自動化驗收合計** | **329** | **0** | **6** | **5** | **340** |
| learning 全套件回歸（907 項） | 879 | 2（既有） | 26 | 0 | 907 |

**SKIPPED 與 PENDING 的具體內容（皆已逐項說明原因，非隱藏失敗）**

- SKIPPED ×2（I3-A）：`/live/`、`/downloads/` 由 Live 服務（:8111）提供，**非 Django 路由**，
  在隔離 Django 服務上必然 404 → 改以「下載中心 manifest 仍含 HQGC」驗證既有入口資料未被破壞。
- SKIPPED ×4（I3-B）：live 預設 `allowed_roles` 含 student，無法在實例上觸發「角色不符」，
  該項由單元測試 `test_role_restricted_skips_probe` 覆蓋。
- PENDING ×5：真實 iPhone Safari 人工驗收（每支腳本各記 1 項，須教師以實機確認）。

---

## 1. I3 實際修改檔案

I3 期間（18:00 之後）實際變更僅 **6 個檔案**，其中**產品程式僅 1 個**。

### 1-1 修改（既有檔案）

| 檔案 | 修改內容 | 性質 |
|---|---|---|
| `student_portal/learning/external_modules.py` | 新增入口 URL 安全檢查 `validate_entry_url()`（scheme 白名單、禁止帳密、禁止敏感參數、禁止 metadata 主機）；未通過者一律視為「尚未接入」、**不探測、不連結**；契約新增 `url_safety` | 附加式，屬教師授權範圍（「只允許在 external_modules 及其必要配置、測試範圍內做最小修復」） |
| `student_portal/learning/tests/test_external_module_interface.py` | 新增 `ExternalModuleUrlSafetyTests`（12 項） | 測試 |

### 1-2 新增

| 檔案 | 用途 |
|---|---|
| `student_portal/learning/tests/test_i3_student_experience.py` | I3-C 學生體驗單元測試（13 項） |
| `demo/tools/verify_i3_e2e.py` | I3-A 端到端教學流程 HTTP 驗收 |
| `demo/tools/verify_i3_modules.py` | I3-B 外部模組接口安全驗收（四模式） |
| `demo/tools/i3_framework_check.cjs` | I3-C Chrome 渲染 + 手機 390×844 驗收 |
| `docs/reports/I3_Report.md` | 本報告 |

### 1-3 明確**未**修改（與 I2 對照）

- 未修改任何模板（`.html`）、樣式（`.css`）、`views.py`、`urls.py`、`settings.py`。
- **未新增 Migration**（仍為 0001–0019）。
- 未新增任何展示頁面、未重新設計教師後台。

---

## 2. 學員完整操作驗收（I3-A）

隔離環境：`:8115`，測試庫 `demo/runtime/db/i3_e2e.sqlite3`（由 `p42_verify.sqlite3` 以 SQLite backup API 複製的**獨立副本**）。
全程**不跟隨重導**（`_NoRedirect`），避免「未登入 302 → 登入頁」被誤讀為 200（假 PASS）。

### 2-1 學員流程逐步結果

| 步驟 | 檢查 | 結果 |
|---|---|---|
| 未登入防護 | 未登入存取工作台 → **302 → `/login/?next=/student/learning-path/`** | PASS |
| 登入 | 學員 `p42-a-0001@fde-p42.local` 登入成功（取得 `sessionid`） | PASS |
| 五階段入口 | `/student/learning-path/` → **302 → `/student/courses/14/learning-path/`**（單一課程直接進入） | PASS |
| 工作台 | 五階段工作台 HTTP 200 | PASS |
| 五階段區塊 | 學習知識／模擬與練習／專項實訓／能力考核／成長日誌 全部存在 | PASS ×5 |
| 學習功能 | `/platform/`（學習平台）HTTP 200 | PASS |
| 學習功能 | `/live/`（AI 助教／RAG） | SKIPPED（Live 服務提供，非 Django 路由） |
| 學習功能 | `/downloads/`（下載中心） | SKIPPED（同上） |
| 入口資料 | `D:\下載中心文件\download_manifest.json` 仍含 HQGC | PASS |
| 實訓功能 | `/platform/f450`（F450 十二任務）HTTP 200 | PASS |
| 返回工作台 | 實訓頁含 `/student/learning-path/` 返回路徑 | PASS |
| R01–R08 | `/student/courses/14/growth/` HTTP 200，R01–R08 八項齊備 | PASS ×2 |
| 成長紀錄 | R01 詳情頁 HTTP 200 | PASS |
| 凍結保護 | R07 詳情頁 HTTP 200（**僅讀取，未上傳／未發布／未回滾**） | PASS |
| 凍結保護 | M1–M4 槳葉辨識頁 HTTP 200，含 `motor_M1`–`motor_M4`（**僅讀取**） | PASS |
| 提交成果 | 找到尚未提交的紀錄（R01）→ POST **既有表單端點** `submit_review` + 1 張 8×8 PNG | PASS |
| 狀態真實更新 | 工作台回傳 **`○ 未開始` → `待教師複核`** | PASS |

**未偽造聲明**：本輪唯一寫入為「以既有表單提交 1 張測試 PNG」。
未偽造成績、未偽造證據、未偽造教師審核、未直接寫入資料庫（所有寫入皆由產品程式處理）。

### 2-2 資料庫層交叉驗證（唯讀）

提交後直接以唯讀方式查核測試庫，確認寫入為**產品流程**產生：

```
R01  submission_id=137  status=approved  submitted_at=2026-10-13 10:10:04  teacher_final_score=88
複核紀錄: (137, 'approved', 88, 'I3 端到端驗收：以既有複核表單完成複核。')
```

---

## 3. 教師完整操作驗收（I3-A）

| 步驟 | 檢查 | 結果 |
|---|---|---|
| 未登入防護 | 未登入存取教師頁 → **302 → `/teacher/login/?next=/teacher/class-outcomes/`** | PASS |
| 登入 | 教師 A `p42.teacher.a@fde-demo.local` 經 **`/teacher/login/`** 登入成功 | PASS |
| 查看班級 | `/teacher/class-outcomes/` HTTP 200 | PASS |
| 班級範圍 | 含授權班級 `P42-A-2026`；**不含**未授權班級 `P42-B-2026` | PASS ×2 |
| 查看提交 | `/teacher/enrollments/14/` HTTP 200，列出成長紀錄（含 R01） | PASS |
| 狀態呈現 | 教師端以獨立用詞呈現（合格／待複核），與學員端一致對應 | PASS |
| 提交可見 | 教師端可見**學員提交的備註與證據**（逐字命中） | PASS |
| 複核端點 | 於該紀錄區塊定位既有複核表單 `submission_id=137` | PASS |
| 執行複核 | POST **既有複核端點** `/teacher/growth-reviews/137/`（`approved`／88 分／評語） | PASS |
| 複核反映 | 學員詳情頁出現評分 88 | PASS |
| 複核反映 | 學員端工作台 **`待教師複核` → `✅ 已完成`** | PASS |
| 班級成果 | `/teacher/class-report/P42-A-2026/` HTTP 200，含複核結果 | PASS ×2 |
| 成果匯出 | 摘要 CSV／學員明細 CSV：HTTP 200 且含 UTF-8 BOM | PASS ×2 |
| 跨班級隔離 | 未授權班級之報告／清單／展示／兩種 CSV → **全部 404** | PASS ×5 |
| 角色區隔 | 教師存取學員工作台 → **403**；學員存取教師頁 → **403** | PASS ×2 |

---

## 4. 外部模組接口安全結果（I3-B）

三個外部模組 **`MP_GROUND_STATION`／`HQGC_ASSESSMENT`／`F450_DIGITAL_TWIN` 各自獨立**：
設定其一不影響其餘兩者（單元測試 `test_three_modules_are_independent`）。

### 4-1 四種配置實測（隔離實例）

| 模式 | 埠 | 配置 | 期望 | 結果 |
|---|---|---|---|---|
| `default` | 8115 | 三模組皆未配置 | 全部「尚未接入」、無連結、不探測 | **25 PASS / 0 FAIL** |
| `unsafe` | 8116 | 啟用 + URL 含 `?token=abc123` | **URL 被拒絕** → 「尚未接入」、URL 不出現 | **24 PASS / 0 FAIL** |
| `module-up` | 8117 | 啟用 + 可達 URL | 「已可使用」並產生連結 | **22 PASS / 0 FAIL** |
| `module-down` | 8118 | 啟用 + 不可達 URL | 「服務暫時不可用」、**無連結**、頁面仍 200 | **24 PASS / 0 FAIL** |

### 4-2 教師指定九項逐條對照

| # | 要求 | 驗證方式 | 結果 |
|---|---|---|---|
| 1 | 未配置時 DISABLED | 四模式實測：default 下三模組皆「尚未接入」、`url=""` | PASS |
| 2 | 未授權時不探測 | 單元測試 `test_role_restricted_skips_probe`：角色不符時 `prober.calls == []`；且**角色判定先於探測** | PASS（live 標 SKIPPED，已說明） |
| 3 | 服務不可用時不產生可點連結 | module-down 實測：徽章「服務暫時不可用」、`href` 命中數 0 | PASS |
| 4 | URL 不接受不受信任的任意目標 | 新增 `validate_entry_url()`：只允許 `http`/`https`；拒絕 `javascript:`、`file:`、`data:`、`ftp:`、`//host`、含帳密 `user:pass@`、雲端 metadata 主機 `169.254.169.254` | PASS（12 項單元測試 + unsafe 實測） |
| 5 | 探測需短逾時與明確失敗處理 | 逾時預設 **1.5 秒**（上限斷言 ≤5 秒）；連線失敗／逾時／DNS 失敗**一律回 False 且絕不拋例外** | PASS |
| 6 | 不將 Token／密碼／學生個資放入 URL | 拒絕含 `token/access_token/password/api_key/sessionid/student_id/email` 等 24 組敏感鍵；頁面掃描 6 組敏感字串皆 0 命中 | PASS |
| 7 | 不因外部服務故障拖垮工作台 | module-down 下工作台仍 **HTTP 200**、R01–R08 完整（8/8）、`/platform/f450` 仍 200 | PASS |
| 8 | 不因探測而修改學習紀錄 | 探測前後**逐表指紋（行數＋內容 SHA256）完全一致**（32 張表） | PASS |
| 9 | 不自動啟動外部服務 | `external_modules.py` 原始碼掃描：無 `subprocess`／`os.system`／`Popen`／`startfile` | PASS |

### 4-3 最小修復說明（唯一產品程式變更）

**問題**：原實作直接採用設定值作為探測目標與連結目標，未做任何驗證。
若教師誤設（例如把帶 Token 的網址寫進環境變數），會產生兩個風險：
①把憑證寫進 HTML 連結；②對不受信任目標發出探測請求。

**修復（僅 `external_modules.py`）**：新增 `validate_entry_url()`，
未通過者**降級為「尚未接入」**——`url=""`、**不探測**、`note` 說明原因、新增 `url_rejected` 旗標。
四態語意不變，契約新增 `url_safety` 段（供驗收引用）。

**未動**：`settings.py`、`views.py`、模板、CSS、以及任何獨立專案。

---

## 5. 手機版驗收（I3-C）

Chrome 裝置模擬 390×844（DPR 2、touch、iPhone UA）。

| 檢查 | 實測值 | 結果 |
|---|---|---|
| 無水平溢出 | `overflowX = 0 px` | PASS |
| 五階段區塊錨點 | 5/5 | PASS |
| 五階段導覽錨點一致 | 5/5 | PASS |
| 模組卡片可見 | 3 | PASS |
| 入口列表可見 | 10 | PASS |
| 手機五階段導覽可見 | 5 | PASS |
| 入口連結可點高度 | 10 個中 0 個 < 24px | PASS |
| 外部模組徽章皆四態 | `["尚未接入","尚未接入","尚未接入"]` | PASS |
| 預留模組不可點 | 0 個匹配 `<a>` | PASS |
| 功能入口無重複（名稱＋目標） | 10 個入口、0 重複 | PASS |
| F450 十二任務入口 | `href=/platform/f450` | PASS |
| 平台頁返回工作台路徑 | 存在 | PASS |
| 截圖 | `i3_workbench_iphone390x844.png`、`i3_workbench_desktop.png` | PASS ×2 |

**Chrome 驗收合計 16/16 PASS。真實 iPhone Safari 驗收：`PENDING`。**

---

## 6. 回歸測試與既有失敗對照

### 6-1 完整 learning 套件回歸

指令：`manage.py test learning`（in-memory test DB，**不觸碰正式 DB**）

```
Ran 907 tests in 1417.972s

FAILED (failures=2, skipped=26)
```

| 項目 | 數值 |
|---|---|
| 執行測試數 | **907** |
| 失敗 | **2**（皆為既有，非本輪引入） |
| 略過 | 26 |
| 耗時 | 1417.972 秒（約 23.6 分鐘） |

**測試數增量與來源**：

| 輪次 | 測試數 | 失敗 | 失敗清單 |
|---|---|---|---|
| P9 | 858 | 2 | 既有兩項 |
| I1 | 869 | 2 | 既有兩項 |
| I2 | 882 | 2 | 既有兩項 |
| **I3（本輪）** | **907** | **2** | **既有兩項（完全相同）** |

增量 882 → 907 = **+25**：
`test_external_module_interface` +12（URL 安全測試，24 → 36）＋
`test_i3_student_experience` +13（新增檔案）。

**結論：I3 引入 0 項新失敗。**

### 6-2 I1／I2 HTTP 回歸（隔離服務）

| 驗收 | 結果 |
|---|---|
| I1 入口與權限（`verify_i1_external_modules.py`） | **46/46 PASS** |
| I2 default（`verify_i2_framework.py default`） | **67/67 PASS** |
| I2 module-up（啟用＋可達 → 已可使用並產生連結） | **23/23 PASS** |
| I2 module-down（啟用＋不可達 → 服務暫時不可用、無連結） | **24/24 PASS** |
| I2 合計 | **114/114 PASS** |

> I2 的 module-up／module-down 需在 :8112 以模組環境變數啟動實例，
> 本輪以「啟動 → 驗收 → 停止 → 換配置重啟」方式逐一執行，結果如上。

### 6-3 既有失敗對照（I3-D）

| 失敗測試 | 套件 | 是否 I3 引入 |
|---|---|---|
| `test_platform_hero_action_opens_student_growth_portal` | `test_auth` | ❌ 否（P9 起既有） |
| `test_teacher_sees_only_authorized_models_with_four_status_dimensions` | `test_vision_flywheel_framework` | ❌ 否（P9 起既有） |

### 6-4 I3-D 兩項歷史失敗分析

#### 第一項：我的學習日誌／我的成長日誌 文案差異

**確認結果：屬**測試斷言落後**，**不涉及對外介面契約變更**。**

| 項目 | 內容 |
|---|---|
| 測試斷言 | `student_portal/learning/tests/test_auth.py:104-105` → `label: '我的學習日誌'`、`target: '/student/'` |
| 現行實作 | `src/platform-browser.js:118` → `{ label: '我的成長日誌', target: '/student/growth/', kind: 'primary' }` |
| 一致性 | `index.html:36` → `<a href="/student/growth/">我的成長日誌</a>`（**兩處一致**） |
| 變更來源 | `git diff src/platform-browser.js` 顯示為**未提交的既有變更**：`-我的學習日誌 /student/` → `+我的成長日誌 /student/growth/` |
| 路由存在性 | `/student/`（`student_dashboard`）與 `/student/growth/`（`student_growth_entry`）**皆仍存在**，僅預設落點改變 |
| 其他消費者 | 全倉僅該測試引用 `我的學習日誌`；無其他程式依賴此字串 |

**最小修復建議（本輪未執行，待教師決定）**：
僅需把測試斷言改為現行契約，**不動任何產品程式**：

```python
# student_portal/learning/tests/test_auth.py:104-105
-        self.assertIn("label: '我的學習日誌'", source)
-        self.assertIn("target: '/student/'", source)
+        self.assertIn("label: '我的成長日誌'", source)
+        self.assertIn("target: '/student/growth/'", source)
```

**建議理由**：該測試名稱為 `test_platform_hero_action_opens_student_growth_portal`（「開啟學生成長入口」），
其**測試意圖本身就是成長入口**，現行產品的 `/student/growth/` 落點更貼合測試意圖；
且 `index.html` 與 `platform-browser.js` 已一致。故屬**測試落後**而非產品缺陷。

> 依「不得為通過測試而更動受保護功能」，本輪**未修改**此測試，僅提出建議。
> 此項亦不屬任何凍結區（`src/platform-browser.js` 非受保護模組），風險極低。

#### 第二項：教師模型列表「訓練用途」差異

**確認結果：屬**頁面改版後欄位被取代**，該頁位於教師模型倉庫**凍結區** → **本輪只記錄，不修改**。**

| 項目 | 內容 |
|---|---|
| 測試斷言 | `test_vision_flywheel_framework.py:70` → 於 `teacher_vision_model_list` 頁面斷言含「審核／驗證／訓練用途／部署」 |
| 測試實際頁面 | `reverse("learning:teacher_vision_model_list")` → 模板 `teacher_vision_model_list.html` |
| 該頁現況 | 表頭為：班級／期別、組別、學員、模型任務、檔案／時間、**審核狀態**、操作（**無「訓練用途」**） |
| 模板狀態 | `teacher_vision_model_list.html` 為**未追蹤新檔**（`??`），mtime **2026-10-10 19:15:58**，屬 2026-10-10 教師視覺中心改版產物 |
| 「訓練用途」仍在何處 | `teacher_vision_flywheel.html`（**另一個頁面**，`teacher_vision_flywheel` 路由）仍保留「訓練用途」欄；`teacher_vision_model_detail.html` 亦保留 |
| 模型定義 | `learning/models.py:688` 文件仍定義「審核狀態／驗證狀態／訓練用途／部署狀態」四個獨立維度（**未變**） |

**原因判定**：`teacher_vision_model_list` 是改版後**新增**的模型清單頁，
以「審核狀態」單欄呈現，未沿用舊 flywheel 頁的「訓練用途」欄；
測試仍針對舊版頁面結構斷言，故失敗。**四個狀態維度的資料模型未變**，僅呈現欄位不同。

**建議（本輪不執行）**：屬教師視覺模型倉庫（凍結區），**不修改**。
待教師決定其一：
1. 在 `teacher_vision_model_list` 補回「訓練用途」欄（**改動凍結區，需教師明確授權**）；或
2. 將該測試斷言更新為現行頁面契約（測試變更，仍需教師確認，因涉及凍結區頁面語意）。

---

## 7. 受保護模組零修改證據

### 7-1 版本與資料庫

| 項目 | 值 | 說明 |
|---|---|---|
| HEAD | `e5c0442` | 未變動 |
| 分支 | `fde-ai-v2.0-dev` | 未變動 |
| Migration | 0001–0019（**0 新增**） | 未執行 `makemigrations`／`migrate` |
| 正式 DB `student_portal/db.sqlite3` | mtime **2026-10-07 19:08:32**、450,560 bytes、SHA256 `1fa462fe…c19c133` | **未被觸碰** |
| Git 寫操作 | **0 次**（無 commit／push／merge／reset／clean／deploy） | stash 數 1（未動） |
| R07 `--apply` | **未執行** | — |

### 7-2 受保護模組最後修改時間（今日 = 2026-10-13）

| 檔案 | 最後修改時間 | 本輪是否修改 |
|---|---|---|
| `live_backend/app/vision_center.py`（教師視覺模型倉庫） | 2026-10-11 06:05:48 | ❌ 否 |
| `live_backend/app/main.py`（推論入口） | 2026-10-11 07:05:25 | ❌ 否 |
| `live_backend/app/task_catalog.py`（F450 十二任務核心） | 2026-10-07 18:39:10 | ❌ 否 |
| `live_backend/app/task_state.py` | 2026-10-07 22:42:45 | ❌ 否 |
| `live_backend/app/training_records.py` | 2026-10-07 22:44:35 | ❌ 否 |
| `live_backend/app/coach_ask.py`（AI Live Coach） | 2026-10-05 00:59:27 | ❌ 否 |
| `student_portal/learning/vision_rule_templates.py`（視覺規則） | 2026-10-08 17:25:41 | ❌ 否 |
| `student_portal/learning/models.py`（含 R07／模型定義） | 2026-10-09 02:39:03 | ❌ 否 |
| `teacher_vision_model_list.html`（教師模型列表） | 2026-10-10 19:15:58 | ❌ 否 |

> `find live_backend student_portal/learning -newermt 2026-10-13` 的結果中
> **完全沒有 `live_backend/` 任何檔案**，證明 YOLO／推論／任務核心／教練後端全數零修改。

### 7-3 逐項對照（教師 I3 指令第七節）

| 禁止項 | 結果 |
|---|---|
| Migration | ✅ 0 新增 |
| 正式 DB 修改 | ✅ 未觸碰（mtime／SHA256 與 I2 一致） |
| v1.5C 修改 | ✅ 未觸碰 |
| R07 `--apply` | ✅ 未執行 |
| YOLO／`best.pt`／ACTIVE 模型變更 | ✅ 未觸碰（`vision_center.py` mtime 早於本輪；R07 僅 GET 詳情頁） |
| 教師模型倉庫修改 | ✅ 未觸碰（僅分析失敗原因，未改任何檔案） |
| 飛行健康內部修改 | ✅ 未觸碰（僅沿用既有 `/flight-health/` 入口） |
| MP／HQGC／F450 3D 內部修改 | ✅ 未觸碰（僅外部模組接口層設定與驗證，未進入獨立專案） |
| `git clean/reset/commit/push/merge/deploy` | ✅ 全部未執行 |
| 保留全部既有未提交成果 | ✅ 工作區所有變更原樣保留 |

### 7-4 本輪變更範圍（最小足跡）

I3 期間實際變更僅 6 個檔案，其中產品程式 **1 個**（`external_modules.py`，屬教師明確授權的修復範圍）。
**未修改**：任何模板、CSS、`views.py`、`urls.py`、`settings.py`、`live_backend/`、`src/`、`live/`。

---

## 8. 附錄：驗收指令（可重現）

```bash
# 隔離服務（PowerShell；沙箱需 -ExecutionPolicy Bypass）
# 端到端（I3-A）用獨立測試庫副本
python -c "import sqlite3,os; s=sqlite3.connect(r'D:\FDE-AI-UAS-v2.0\demo\runtime\db\p42_verify.sqlite3'); d=sqlite3.connect(r'D:\FDE-AI-UAS-v2.0\demo\runtime\db\i3_e2e.sqlite3');
d.executescript(''); s.backup(d)"
powershell -Command "Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force"
powershell -File demo/tools/start_p42_verify.ps1 -Port 8115 -DbFile i3_e2e.sqlite3     # I3-A
powershell -File demo/tools/start_p42_verify.ps1 -Port 8116 -DbFile p42_verify.sqlite3 # I3-B unsafe（需設 FDE_MODULE_*_URL 含 ?token=）
powershell -File demo/tools/start_p42_verify.ps1 -Port 8117 -DbFile p42_verify.sqlite3 # I3-B module-up
powershell -File demo/tools/start_p42_verify.ps1 -Port 8118 -DbFile p42_verify.sqlite3 # I3-B module-down
powershell -File demo/tools/start_p42_verify.ps1 -Port 8112 -DbFile p42_verify.sqlite3 # I1/I2 回歸

# I3-A 端到端
python demo/tools/verify_i3_e2e.py

# I3-B（四模式）
I3_MODULE_BASE=http://192.168.1.114:8115 python demo/tools/verify_i3_modules.py default
I3_MODULE_BASE=http://192.168.1.114:8116 python demo/tools/verify_i3_modules.py unsafe
I3_MODULE_BASE=http://192.168.1.114:8117 I3_MODULE_URL=http://192.168.1.114:8117/login/ \
    python demo/tools/verify_i3_modules.py module-up
I3_MODULE_BASE=http://192.168.1.114:8118 I3_MODULE_URL=http://192.168.1.114:8199/twin \
    python demo/tools/verify_i3_modules.py module-down

# I3-C（Chrome 裝置模擬）
FDE_I3_BASE=http://192.168.1.114:8115 node demo/tools/i3_framework_check.cjs

# I1／I2 回歸
python demo/tools/verify_i1_external_modules.py
python demo/tools/verify_i2_framework.py default
I2_MODULE_URL=... python demo/tools/verify_i2_framework.py module-up
I2_MODULE_URL=... python demo/tools/verify_i2_framework.py module-down

# 單元測試
cd student_portal
env -u DATABASE_URL -u DJANGO_DEBUG -u DJANGO_SETTINGS_MODULE \
    -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY \
    DJANGO_MEDIA_ROOT=/tmp/fde_test_media \
    ../.test-temp/django-venv/Scripts/python.exe manage.py test learning
```

---

## 9. 結論

- **I3-A 端到端教學流程**：完成。學員（登入 → 五階段 → 學習／實訓 → 返回 → R01–R08 → 既有表單提交）
  與教師（登入 → 班級 → 學生提交 → 既有複核 → 班級成果／匯出）全鏈路通過，**0 FAIL**。
- **I3-B 外部模組接口安全**：完成。九項要求逐條驗證通過；並以**最小修復**補上入口 URL 安全檢查
  （未通過者不探測、不連結），修復範圍限於 `external_modules.py`。
- **I3-C 學生操作體驗**：完成。導航一致、入口無重複、四態正確、返回路徑存在、多課程回總覽、手機 390×844 正常、角色雙向隔離。
- **I3-D 兩項歷史失敗**：已定位並確認——第 1 項為**測試斷言落後**（不涉介面契約，已附最小修復建議）；
  第 2 項屬**教師模型倉庫凍結區**（僅記錄原因與建議，未修改）。
- **驗收**：`AUTOMATED PASS`（本輪新增自動化驗收 340 項：PASS 329／FAIL 0／SKIPPED 6／PENDING 5）。
- **真實 iPhone Safari 驗收**：`PENDING`。
- **安全邊界**：全部遵守；受保護模組零修改；0 次 Git 寫操作；未新增 Migration；正式 DB 零修改。

**依教師指令，本輪 I3 完成後停止，不自行進入 I4。**
