# FDE-AI-UAS 2.0｜Git 版本保護準備報告（提交清單與排除清單）

日期：2026-10-14 12:45
執行者：WorkBuddy
依據：教師《開發完成後安全收尾指令》第一節
性質：**唯讀盤點與建議；未執行任何 commit／push／reset／clean，等待教師核准提交範圍**

---

## 一、盤點總覽（`git status --short --untracked-files=all`）

| 類別 | 修改（M） | 未追蹤（??） | 合計 |
|---|---|---|---|
| A 前端產品碼 | 10 | 9 | **19** |
| B 後端產品碼 | 20 | 47 | **67** |
| C 測試（Django／Node／基準資料） | 10 | 67 | **77** |
| D Migration | 0 | 4 | **4** |
| E 設定檔（.gitignore／.env.example／settings.py） | 3 | 0 | **3** |
| F Flight Health（保護模組，歷史未追蹤） | 0 | 4 | **4** |
| G DEMO 工具與文件 | 0 | 92 | **92** |
| H 專案文件（docs/ 與根目錄報告） | 1 | 85 | **86** |
| Ops 腳本（`add_firewall_rules.ps1`） | 0 | 1 | **1** |
| Z 代理工作區記憶 | 0 | 2 | **2（建議排除）** |
| 排除項（執行期媒體／備份殘留） | 0 | 3 | **3（建議排除）** |
| **總計** | **44** | **314** | **358** |

未追蹤展開後的關鍵事實：
- **Migrations 0016–0019 全部未追蹤**（`student_portal/learning/migrations/0016..0019`）→ 部署阻塞項。
- `student_portal/learning/external_modules.py` 已追蹤（I5 修改中）；其副檔名殘留 `external_modules.py.i5-prebak` 為備份檔，**不得提交**。
- `flight-health/` 4 個檔案（index.html／css／js×2）為**保護模組** Flight Health AI 的前端，歷史遺留未追蹤。

---

## 二、敏感檔案掃描結果（唯讀）

| 掃描對象 | 結果 |
|---|---|
| `.env`／`.key`／`.pem`／憑證檔 | 未追蹤清單中**0 筆**（`.gitignore` 已覆蓋 `.env*`／`*.key`／`*.pem`） |
| `*.sqlite3`／`db.sqlite3` | **0 筆**（`.gitignore` `db.sqlite3`；DEMO DB 走 `demo/runtime/db/` 已忽略） |
| `*.pt`／模型權重 | **0 筆**（`/models/` 已忽略） |
| `*password*.txt`／`*帳密*.txt` | **0 筆**（已忽略規則） |
| `demo/DEMO_SHARED_PASSWORD_REPORT_2026-10-10.md` | 逐行檢查：文件第 8 行自述「本報告不含任何明文密碼」，內容僅描述機制與長度，**可安全提交** |
| `demo/tools/demo_credentials.py`、`reset_demo_shared_password.py` 等 | 為**載入器／產生器程式**，本身不含密碼值，**可安全提交**（密碼值只存活於 `demo/runtime/`，已忽略） |
| `demo/runtime/media_i4/evidence/*.jpg` | DEMO 執行期證據媒體 → **排除** |
| `.workbuddy-ai/memory/*.md` | 代理工作區記憶（含操作踩坑與環境細節，非專案交付物）→ **建議排除** |
| `external_modules.py.i5-prebak` | 手動備份殘留 → **排除** |

**結論：在現行 `.gitignore` 下，本批不存在必須攔截的敏感檔案进版本控制的風險點；排除清單如第四節。**

---

## 三、備份完整性與可恢復性驗證（唯讀實測）

| 備份 | 內容 | 驗證結果 |
|---|---|---|
| `backups\20261014-0715-codex-takeover`（Codex, 07:04） | 24,281 檔／1.559 GiB，含 `BACKUP_CRITICAL_SHA256.tsv`（9 項 critical 雜湊） | manifest 存在且可讀；早於 Codex 07:53–07:55 測試修正值，為**較舊基準** |
| `backups\20261014-1025-workbuddy-takeover`（WorkBuddy, 10:25） | 6,856 檔（排除 .git／node_modules／.test-temp／demo/runtime/logs） | **44 項修改檔逐一 SHA256 比對：44/44 與當前磁碟完全一致** → 可恢復且為最新碼態 |
| `backups\20261014-1245-workbuddy-final-deliverables`（本輪新增） | Phase 4–6 六份新交付＋`SHA256SUMS.txt` | 已建立，覆蓋 10:25 之後產出的全部新檔 |

**還原演練建議（待教師核可後執行，本輪未做）**：於隔離目錄以 WorkBuddy 備份實跑一次還原，比對 44 檔雜湊＋`integrity_check` 後刪除隔離目錄。

> ⚠️ **備份 ≠ 版本保護**：檔案備份可還原「當下狀態」，但無法回溯歷史、無法 diff、無法分支。
> 真正的安全網是 Git 提交；在教師核准前，`D:\FDE-AI-UAS-v2.0-backups\` 是唯一的事故復原手段，**請勿刪除**。

---

## 四、建議提交清單（分批，每批可獨立審查）

> 以下為**建議**，實際範圍由教師核定；每批附檢驗指令。

### 批次 1｜Migration（阻塞後續一切）
```
student_portal/learning/migrations/0016_visionmodelrecord.py
student_portal/learning/migrations/0017_visionmodelrecord_snapshot_and_integrity.py
student_portal/learning/migrations/0018_golden_set_center.py
student_portal/learning/migrations/0019_golden_set_manifest_contract.py
```
檢驗：`manage.py migrate --check`（隔離庫）＋ `showmigrations learning` 至 0019。

### 批次 2｜後端產品碼（67 檔）
`live_backend/app/**`（含 `providers/`）、`student_portal/learning/**` 非測試 Python、`student_portal/config/settings.py`、`.gitignore`、`student_portal/.env.example`。
檢驗：`manage.py test`（隔離 DB，六批）＋ Live Backend `unittest discover` → 預期與本輪基準一致（843 pass＋2 已知歷史失敗／315 OK）。

### 批次 3｜前端產品碼（19 檔）
`index.html`、`404.html`、`src/vision-client.js`、`live/live.js`、`live/live.css`、`live/index.html`、`downloads/**`（非 test）、`start_fde_mobile_preview.bat`。
檢驗：`node --test src/*.test.cjs live/*.test.cjs` → 188/188。

### 批次 4｜測試與基準資料（77 檔）
`src/*.test.cjs`、`live/*.test.cjs`、`downloads/*.test.cjs`、`student_portal/learning/tests/**`（含 `baselines/p9`）、`live_backend/tests/**`、`student_portal/tests/test_student_prop_scan.py`、`validation_sets/prop/**`。
檢驗：同批次 2/3 指令；另跑 `demo/tools/verify_i1_external_modules.py` → 46/46。

### 批次 5｜DEMO 工具與文件（92 檔）
`demo/tools/**`（含本輪新增 `verify_flight_health_frontend.cjs`）、`demo/*.cmd`、`demo/*.md`、`demo/runtime/seed_demo_downloads.py`（.gitignore 明確保留項）。
檢驗：`demo/tools/verify_phase2_student_loop.py` 27/27、`verify_live_coach_loop.py` 25/25、`verify_mobile_390x844.cjs` 22/22、`verify_flight_health_frontend.cjs` 16/16（需 DEMO 服務在線）。

### 批次 6｜專案文件（86 檔）
`docs/**`（`delivery/01–16`、`reports/`、`handoff/`、`architecture/`、`superpowers/`、`verification/`）、根目錄報告（`AGENTS.md`、`DELIVERY_ACCEPTANCE_REPORT.md`、`FDE_2_0_FINAL_CLOSURE_REPORT.md`、`P0_*/P1_*` 等）、`add_firewall_rules.ps1`。
檢驗：純文件，無測試依賴；提交前確認無密碼殘留（已完成第二節掃描）。

### 批次 7｜Flight Health 保護模組前端（4 檔，**需教師特別確認**）
`flight-health/index.html`、`flight-health/css/style.css`、`flight-health/js/app.js`、`flight-health/js/config.js`。
> 理由：Flight Health AI 在「不可修改清單」內；此 4 檔是**現有實作首次納入版本控制**（非修改）。
> 好處：納管後該保護模組才有還原點。是否提交由教師決定；不提交則維持現狀（備份已涵蓋）。

---

## 五、建議排除清單（3 項＋2 項記憶檔）

| 檔案 | 排除理由 |
|---|---|
| `student_portal/learning/external_modules.py.i5-prebak` | 手動備份殘留，非原始碼 |
| `demo/runtime/media_i4/evidence/1737cc18…/253448c5….jpg` | DEMO 執行期證據媒體（可重生成） |
| `demo/runtime/media_i4/evidence/492b159d…/5b4bdb6a….jpg` | 同上 |
| `.workbuddy-ai/memory/2026-10-08.md` | 代理工作區記憶，非專案交付物（建議改提交 `docs/handoff/` 內的正式交接文件） |
| `.workbuddy-ai/memory/2026-10-10.md` | 同上 |

> 執行時無需手動排除上述 3 檔——建議改以**精確路徑 `git add`**（不使用 `git add -A`／`git add .`），從根本上避免誤入。

---

## 六、本輪遵循聲明

| 動作 | 執行 |
|---|---|
| commit / push / reset / clean | ❌ **全部未執行** |
| 修改任何被追蹤檔案 | ❌ 未執行（僅新建本報告） |
| 刪除任何未追蹤檔案 | ❌ 未執行 |
| 唯讀盤點、分類、敏感掃描、備份驗證 | ✅ 已完成 |

**狀態維持**：`FDE_2_0_DEV_COMPLETE`（開發面）／`MANUAL_ACCEPTANCE_PENDING`／`PRODUCTION_RELEASE_PENDING`。
**等待教師核准**：提交範圍（批次 1–7 全收或選擇性）＋ 批次 7 的特別確認。
