# 學員端五階段導航 — 最後收尾交付報告（2026-10-16）

> 對應教師 2026-10-15 指令【FDE-AI-UAS 2.0｜學員端五階段導航最後收尾】
> 分支 `fde-ai-v2.0-dev`；所有修改**停留工作樹**，未 commit、未 push、未部署。
> 教師本輪不進行人工驗收；完成後**停止新增學員端導航功能**，等待統一人工驗收。

---

## 〇、本輪四項指令與落實結果（總覽）

| # | 教師指令 | 落實結果 |
|---|---|---|
| 一 | 統一五階段名稱為「學 → 練 → 做 → 測 → 證」，原「作」改「做」 | ✅ 完成。僅改使用者可見文字，內部識別碼／路由／資料模型／功能邏輯全未動 |
| 二 | 清理重複的五階段入口（帳號列、Django topbar） | ✅ 完成。左側 `#moduleNav` 為唯一主導航；工作台頁面與路由保留 |
| 三 | QR Code 本輪不新增；v2.0 若不存在則於報告註明 | ✅ 已確認 v2.0 **不存在**任何 QR Code 功能，見第六節 |
| 四 | 開發安全：不覆蓋其他代理成果、不動受保護核心、不 commit／部署 | ✅ 遵守，見第七節 |
| 五 | 驗證與交付（5 項確認） | ✅ 全部執行，見第三、四、五節 |

---

## 一、交付一：最終學員端導航架構

### 唯一五階段主導航＝平台左側 `#moduleNav`

位置：`/platform/`（Live Backend `:8111` 統一入口）左側導覽，由 `src/app.js::renderNavigation`
依 `src/platform.js`（瀏覽器實際載入 `src/platform-browser.js`）的 `moduleSections` 渲染。

| 階段 | 可見文字 | 連結目標 | 內容（教師指定） |
|---|---|---|---|
| 學 | `學` | `./courses` | 課程影片與下載說明（知識學習） |
| 練 | `練` | `./simulator` | 模擬器與考照練習（原有練習） |
| 做 | `做` | `./f450` | F450 組裝與 AI 助教 |
| 測 | `測` | `./eagle` | 鷹眼 AI 檢測中心（槳葉方向 M1–M4 ＋ 四面懸停 FOUR_SIDE_HOVER） |
| 證 | `證` | `/student/growth/` | 學習成長日誌（Django 真實 R01–R08） |

同側導覽另有 4 個**既有非五階段**入口，全部保留未動：
`任` 12 任務地圖（`./tasks`）、`健` 飛行健康 AI（`/flight-health/`）、
`展` 歷屆學員成果（`./results`）、`師` 教師複核中心（`./teacher`）。

### 內部識別碼維持不變（僅改可見文字）

| 項目 | 值 | 本輪是否變更 |
|---|---|---|
| `moduleSections` 的 `key` | `build` | 未變 |
| 對應 DOM `id` | `id="build"` | 未變 |
| SPA 路由 `path` | `f450` | 未變 |
| `workflowSteps[].key` | `build` | 未變 |
| `certify` 的 `href` | `/student/growth/` | 未變（前輪已改，本輪未動） |
| 資料模型／DB／migration | — | 完全未動 |

### 「證」仍正確連到真實 R01–R08

實測點擊「證」→ `302` → `/student/courses/<pk>/growth/`，頁面標題
「我的學習成長日誌｜FDE-AI-UAS DEMO 展示班（苗栗合作）」，含真實 R01–R08 八個槽位、
「已提交 5 / 8」「教師已複核 0 / 8」等真實資料，**非 `./github` 靜態展示頁**。

### 重複入口清理結果

| 位置 | 清理前 | 清理後 |
|---|---|---|
| 平台頁帳號列（`fde-public-bar` / `platform_identity_nav.html`） | 我的學習成長日誌／我的課程／**五階段學習工作台** | 我的學習成長日誌／我的課程（移除重複項） |
| Django 學員 topbar（`learning/base.html`） | 學習平台／我的學習成長日誌／加入課程／**五階段學習工作台** | 學習平台／我的學習成長日誌／加入課程（移除重複項） |
| 平台左側 `#moduleNav` | 學／練／作／測／證 | 學／練／**做**／測／證（唯一主導航） |

**Django 五階段工作台頁面與路由「保留不動」**：`/student/learning-path/`（→ `302` →
`/student/courses/<pk>/learning-path/`）仍可達，由**首頁課程卡按鈕**進入，
既有測試 `test_dashboard_offers_workbench_entry` 持續保護其可達性。
登入、教師入口、下載中心、飛行健康、AI Live Coach 等**完全不受影響**。

---

## 二、交付二：修改檔案清單

### A. 本輪實際修改（共 10 個檔案）

**已納入 Git 追蹤（7 個，`git diff` 可見）**

| 檔案 | 修改內容 |
|---|---|
| `index.html` | ① 手機選單 `<a href="./f450">做</a>`（原「作」）；② 示範面板 05「做」；③ `<h2>學・練・做・測・證</h2>`；④ `eyebrow` `Build · 做`；⑤ 手機展示文案「學練做測證」；⑥ `platform-browser.js` 版本號 `?v=1.5c-nav-certify-growth` → `?v=1.5d-stage-rename`（避免瀏覽器快取舊導航） |
| `404.html` | 「作」→「做」共 4 處（學練做測證 ×2、`<h2>`、`eyebrow`） |
| `src/app.js` | `renderDataFlow()` 流程陣列 `['做', 'F450 / AI / 3D']` |
| `src/platform.js` | `moduleSections` build `label: '做'`；`workflowSteps` `{key:'build', label:'做', title:'專案實作'}`；`currentMission.progress.label='做'`；`designSystem.motion`／`platformModes.nav`／summary 三處字樣 |
| `src/platform-browser.js` | 同上（**瀏覽器實際載入的副本**，必須與 `platform.js` 手工同步） |
| `student_portal/learning/templates/learning/platform_identity_nav.html` | 移除學生分支重複的「五階段學習工作台」連結；更新註解為最終裁決說明 |
| `student_portal/learning/tests/test_public_platform.py` | 導航標籤清單與 `navigation_order` 斷言「作」→「做」 |

**尚未納入 Git 追蹤（3 個，`??` 狀態；皆為測試／工具層）**

| 檔案 | 修改內容 |
|---|---|
| `student_portal/learning/tests/test_i3_student_experience.py` | 原 `test_return_to_workbench_path_present` 改為兩測試：`test_topbar_retains_platform_and_growth_entries`（topbar 保留平台／成長／加入課程）＋ `test_topbar_no_longer_repeats_workbench_entry`（topbar 不再含 `/student/learning-path/`）；docstring 同步 |
| `demo/tools/i2_framework_check.cjs` | 見下方「附：I2 工具修正」 |
| `demo/tools/verify_i2_framework.py` | I2-C 斷言改為檢查 `./courses`、`./simulator`、`./f450`、`./eagle`、`/student/growth/` 五個 token 皆在平台頁 |

### 附：`demo/tools/i2_framework_check.cjs` 修正（4 項，皆工具層）

本輪在執行 I2 回歸時，發現該工具**長期存在登入失敗**（與本輪五階段改動無關），已修正：

1. **登入表單選擇器錯誤**（根因）：工具用 `document.querySelector('form[method="post"]')`
   取登入表單，但 `learning/base.html` 第 20 行在**已登入**狀態會多渲染一個
   登出表單 `<form method="post" action="/logout/">`，導致抓到登出表單 →
   `[name="username"]` 為 null → 靜默不送出登入。
   修正：改為 `Array.from(document.querySelectorAll('form')).find(f => f.querySelector('[name="username"]'))`。
2. **未清 Cookie**：profile 殘留 session 會讓工具在「已登入」狀態重跑。
   修正：開始前 `Network.clearBrowserCookies` ＋ `Network.clearBrowserCache`，失敗時再清一次重試。
3. **固定 sleep 造成載入競態**：`readyState=loading` 即斷言 → 假失敗。
   修正：新增 `waitFor()` 輪詢等待（最多 25 秒），取代固定 sleep。
4. **過時斷言**：手機段落原斷言「≥3 個 `.lp-module` 可見、≥8 個 `li.lp-entry` 可見」，
   係「全部階段同時顯示」時代的舊語意，與教師 2026-10-15 整合原則第 4 點
   「一次只顯示一個階段」衝突。
   修正：改為「五階段區塊齊備（DOM 中 `[data-stage-section]` = 5）＋同時僅 1 個可見
   ＋入口總數 ≥ 8 且當前階段可見」。**此為測試語意更新，非放寬標準**（階段切換正確性另由
   `verify_5stage_switch.cjs` 26/26 獨立驗證）。

> 註：本輪**未修改** `student_portal/learning/templates/learning/base.html`——
> 該檔移除重複連結後與 `HEAD` 一致（`git diff` 為空），故不列入修改清單。

---

## 三、交付三：自動化測試結果

### 3.1 前端與 Django 回歸（本輪全數重跑）

| # | 項目 | 工具 | 結果 |
|---|---|---|---|
| 1 | Node 前端單元（`src/` ＋ `live/`） | `node --test src/*.test.cjs live/*.test.cjs`（Node 22.22.2） | **188 / 188 PASS** |
| 2 | Django 隔離全套（learning app） | `manage.py test`（隔離庫 `.test-temp/5stage-check/`） | **114 pass / 0 fail** |
| 3 | 平台頁公開測試 | `run_public_platform.py` | **10 / 0** |
| 4 | 五階段渲染 | `render_verify.py` | **26 / 0** |
| 5 | 唯一主導航（Chrome CDP） | `verify_unique_nav.cjs` | **15 / 0** |
| 6 | 五階段切換（Chrome CDP） | `verify_5stage_switch.cjs` | **26 / 0** |
| 7 | 既有功能入口 | `verify_entries.cjs` | **8 / 0** |
| 8 | I2 框架驗收 A 段（HTTP） | `verify_i2_framework.py` | **67 / 67 PASS** |
| 9 | I2 框架驗收 B 段（Chrome CDP） | `i2_framework_check.cjs` | **22 / 22 PASS**（修正工具後） |

合併驗證任務（單一 launcher 起 8110/8111 後連跑 5/6/7）合計 **49 PASS / 0 FAIL**。

### 3.2 I2 B 段（Chrome CDP）— 修正工具後結果

修正前：13 FAIL（登入未送出 → 連鎖失敗）。
修正後：**22 / 22 全數 PASS**。關鍵實測輸出：

```
[login] submit=submitted at=/student/       ← 登入成功
[login] 登入後 path=/student/
PASS - 登入後可進入五階段工作台 | path=/student/courses/14/learning-path/
PASS - 五階段錨點齊備 | found=5
PASS - [學] 有 AI 助教（RAG 知識庫問答）
PASS - [練] 有模擬器練習與 AI 助教
PASS - [做] 有 F450 十二任務實訓
PASS - [做] 有 F450 數位孿生（預留）
PASS - [測] 有 M1–M4 與飛行健康 AI
PASS - [測] 有 MP／HQGC 預留模組
PASS - [證] 有成長日誌總覽入口
PASS - 預設三模組皆標示「尚未接入」| count=3
PASS - 預設不得出現「已可使用」／「服務暫時不可用」／「權限不足」
PASS - 預留模組不可點擊 | []
PASS - F450 十二任務入口指向既有 /platform/f450 | href=/platform/f450
PASS - 全頁不存在指向孿生／MP／HQGC 的假連結 | []
PASS - F450 十二任務 /platform/f450 可開啟 | readyState=complete bodyLen=56906
PASS - 平台頁左側 #moduleNav 為唯一五階段主導航（學→練→做→測→證，證→真實成長日誌）
       | {"ok":true,"labels":["任","學","練","做","測","證","健","展","師"],
          "links":["./tasks","./courses","./simulator","./f450","./eagle",
                   "/student/growth/","/flight-health/","./results","./teacher"]}
PASS - 手機 390×844 無水平溢出 | overflowX=0px
PASS - 手機 390×844 五階段區塊齊備（學/練/做/測/證）
       | total=5 keys=["learn","practice","build","assess","certify"]
PASS - 手機 390×844 一次只顯示一個階段 | visible stages=1
PASS - 手機 390×844 入口列表齊備且當前階段可見 | total entries=11 visible=2
```

**I2 合計：A 段 67/67 ＋ B 段 22/22 ＝ 89 / 89 全數 PASS。**

> **修正前的失敗全屬測試工具缺陷**（登入表單選擇器／Cookie 殘留／固定等待／過時斷言），
> 與本輪「作→做」及「移除重複入口」改動**無因果關係**；A 段 HTTP 67/67 全綠、
> 本輪新增的 `#moduleNav` 斷言一次即 PASS 可證。

### 3.3 五項教師指定確認

| 教師指定確認 | 證據 | 結果 |
|---|---|---|
| ① 左側只保留學、練、做、測、證五階段主導航 | `verify_unique_nav.cjs`：「五階段字樣統一為學/練/做/測/證（無『作』殘留）」PASS；「既有功能保留（任/健/展/師 四項）」PASS | ✅ |
| ② 證仍正確連到真實 R01–R08 | `verify_unique_nav.cjs`：「點擊『證』落地 Django 成長日誌（非 github 展示頁）」PASS，實際 URL `/student/courses/1/growth/`；`verify_5stage_switch.cjs`：R01–R08 八槽位全存在、進度摘要「5 / 8」「0 / 8」 | ✅ |
| ③ 五階段內容切換正常 | `verify_5stage_switch.cjs` 26/26（含各階段 hash 切換與 `#stage-*` 可見性） | ✅ |
| ④ 下載中心、飛行健康及其他功能入口不受影響 | `verify_entries.cjs` 8/8（學員儀表板、工作台、成長日誌、下載中心、Flight Health AI、AI Live Coach、F450 十二任務、鷹眼四面懸停）；I2 A 段「下載中心 manifest 仍含 HQGC 條目」PASS | ✅ |
| ⑤ 桌面及手機模擬畫面沒有排版問題 | 桌面 1440×900：左側導航完整、無破版；手機 390×844：`overflowX=0px`（`verify_unique_nav.cjs`、`verify_5stage_switch.cjs`、`i2_framework_check.cjs` 三處獨立驗證） | ✅ |

---

## 四、交付四：桌面與手機模擬截圖

存放於 `.test-temp/5stage-check/shots/`（2026-10-16 01:00 重拍）：

| 檔案 | 內容 | 驗證重點 |
|---|---|---|
| `nav_desktop_platform.png` | 桌面 1440×900 平台頁 | 左側 `任/學/練/**做**/測/證/健/展/師`；帳號列僅「我的學習成長日誌／我的課程／登出」，**無重複五階段入口** |
| `nav_certify_lands_growth_log.png` | 點「證」後落地頁 | `/student/growth/` 真實 R01–R08（R01 無人家基礎認知、R02 模擬飛行訓練…）、「已提交 5 / 8」「教師已複核 0 / 8」；topbar「學習平台／我的學習成長日誌／加入課程／登出」 |
| `nav_mobile_menu_mirror.png` | 手機 390px 選單鏡像 | `學/練/**做**/測/證` ＋ 首頁／教師後台／學員註冊／12 任務／歷屆學員成果／教師復核參照／飛行健康 AI／下載中心 全數保留 |
| `desktop_stage_learn.png` … `desktop_stage_certify.png` | 桌面五階段逐階段畫面 | 一次只顯示一個階段、路徑列「學・練・**做**・測・證」 |
| `mobile_default.png` / `mobile_assess.png` | 手機 390px 預設與「測」階段 | 單欄排版、無溢出 |
| `desktop_platform.png` | 桌面平台頁全景 | 整體版面 |

> 以上皆為 **Chrome 裝置模擬**，**不等於真實 iPhone Safari 驗收**。

---

## 五、交付五：待教師人工驗收清單

> 以下全部標記 `PENDING_MANUAL`，須教師以實機／人工確認。

### 5.1 iPhone Safari 真機驗收（7 站 32 項，沿用 `docs/delivery/13`）

- 存取位址：`http://192.168.1.114:8111/`（DEMO 綁定區網位址；**需教師以系統管理員身分
  執行 netsh 加入私人區網防火牆規則**，本代理不得擅自改防火牆）
- 學員帳號：`demo.student01@fde-demo.local`（密碼見 `demo/runtime/demo.shared.password.txt`）
- 重點複驗：① 左側／選單五階段是否顯示「**做**」；② 點「證」是否進真實成長日誌；
  ③ 五階段切換在 iOS Safari 是否正常；④ 無橫向捲動；⑤ AI 語音朗讀需使用者手勢授權

### 5.2 其他既有待驗項目（非本輪新增）

- 真實飛行日誌分析（教師主機 `:8040`，`docs/delivery/14`）
- 正式 Cloudflare Tunnel、正式 YOLO `:8765` 真實推論
- R4／R5／R8 保護區修復核准（設計已備，未動碼）
- Git 提交（7 批建議見 `docs/reports/GIT_COMMIT_PLAN_2026-10-14.md`，**未 commit**）
- 正式部署

### 5.3 兩項既有失敗（保留，禁止為消滅而改保護區）

- `test_auth`：hero 標籤
- `test_vision_flywheel_framework`：「訓練用途」欄

---

## 六、QR Code 說明（教師指令第三點）

已對 v2.0 全庫（排除 `node_modules`／`.git`／`.test-temp`／`runtime`／`backups`／`docs`）
以 `qrcode|qr_code|qr-code|二維碼|二维码` 搜尋，**命中 0 筆**。

**結論：FDE-AI-UAS 2.0 目前不存在 QR Code 功能**，本輪亦未新增。
（前輪盤點中列為「既有功能保留」係指「若存在則保留」，實際不存在。）

---

## 七、開發安全與受保護核心確認

### 7.1 其他代理衝突檢查

- 動工前後對本輪 10 個檔案做 mtime 檢查，**無第三方並發寫入**。
- `git status` 中大量 `M`／`??` 為 10-14 基線既有狀態，本輪僅新增上述 10 檔的改動。
- 未觀察到本輪期間有外部行程改動平台側檔案。

### 7.2 受保護核心「零修改」確認

本輪**完全未觸碰**：

`views.py`（僅讀）、`urls.py`、`models.py`、`forms.py`、`growth_records.py`、
`growth_record_detail.html`、R01–R08 提交複核鏈、R07 `best.pt` 與模型倉庫、
F450 十二任務（`task_catalog.py`／`task_state.py`）、Flight Health AI、MP12、
`live/`、`live_backend/`、正式資料庫（`:8022`）、migration、部署配置。

### 7.3 未執行的高風險動作（依停止條件）

未 commit／未 push／未 merge／未部署／未重啟正式服務／未動正式 DB／
未清理工作區／未安裝系統級環境／未修改防火牆（僅教師可為）。

### 7.4 隔離邊界

所有驗證皆在隔離環境：
- DEMO：`demo/runtime/db/demo.sqlite3`，`:8110`／`:8111`，綁定 `192.168.1.114`
- I2 隔離：`demo/runtime/db/p42_verify.sqlite3`，`:8112`（驗證後即停）
- Django 單元：`.test-temp/5stage-check/`（`test_` 前綴庫）
- 正式 `:8022` Django、`:8770` RAG 全程未動

---

## 八、結論

- **本輪四項指令全部完成**：五階段名稱統一（作→做）、重複入口清理、
  QR Code 確認不存在、驗證與交付齊備。
- **導航最終架構定案**：平台左側 `#moduleNav` 為全站唯一五階段主導航
  （學→練→做→測→證），「證」→ Django 真實 R01–R08；
  工作台頁面與路由保留，由首頁課程卡進入。
- **回歸全綠**：Node 188/188、Django 114/0、平台頁 10/0、渲染 26/0、
  唯一主導航 15/0、五階段切換 26/0、既有入口 8/0、I2 **89/89**（A 67 ＋ B 22）；
  I2 B 段工具缺陷已修復。
- **依教師指示，本輪結束後停止新增學員端導航功能**，等待教師統一人工驗收。
