# GIT_WORKTREE_INVENTORY.md｜Git 工作區盤點

> 移交者：WorkBuddy ｜ 2026-10-14
> 🔴 **HEAD 沒變動 ≠ 程式碼已封版。** 本文檔明確區分「已提交／未提交修改／未追蹤／stash／本機設定／外部獨立專案」。

---

## 1. 倉庫總覽

| 項目 | 值 |
|---|---|
| 專案 repo | `D:\FDE-AI-UAS-v2.0` |
| 目前分支 | `fde-ai-v2.0-dev` |
| HEAD | `e5c044244475d18930f32e26696d2cf9cf43dfa6`（`e5c0442`） |
| HEAD 日期 | 2026-10-03 12:50 |
| HEAD 訊息 | `fix: initialize tasks and compose coach answers` |
| Git worktree 清單 | 僅主 worktree（無其他 worktree） |

> ⚠️ HEAD `e5c0442` 只是歷史基準。**P1–P9、I1–I5 的全部成果都在 HEAD 之後，且絕大部分尚未提交。**

---

## 2. 工作區數量總表

| 類別 | 數量 | 說明 |
|---|---|---|
| 已修改未提交（tracked, `M`） | **43 個檔案** | `+6881 / -289` 行 |
| 未追蹤（untracked） | **146 條 status 目錄項 → 展開為 292 個實際檔案** | `git ls-files --others --exclude-standard`（不含本輪新增 `docs/handoff/`） |
| stash | **1 筆** | 屬另一分支，見 §5 |
| Migration 未提交 | 4 個（0016–0019） | 未追蹤 |
| 本機設定／runtime | 多項 | `.gitignore` 排除，不會進 Git，見 §6 |

> 上表「未追蹤 292 個實際檔案」為交接輪開始前的基準（不含 `docs/handoff/`）。
> 交接輪新增 10 份交接文件後，未追蹤總數為 **302**；`git status --short` 條目由 189 變 **190**。

---

## 3. 已修改但未提交的 43 個檔案

### 3.1 `live_backend/`（10）

```
app/coach_ask.py        app/main.py            app/sessions.py
app/task_catalog.py     app/task_state.py      app/training_records.py
tests/test_coach_ask.py tests/test_f450_live_loop.py
tests/test_f450_task_catalog.py  tests/test_training_records.py
```

### 3.2 `student_portal/`（15）

```
.env.example
config/settings.py
learning/forms.py       learning/growth_records.py   learning/models.py
learning/urls.py        learning/views.py
learning/static/learning/portal.css
learning/templates/learning/base.html
learning/templates/learning/growth_record_detail.html
learning/templates/learning/platform_identity_nav.html
learning/templates/learning/student_dashboard.html
learning/templates/learning/student_login.html
learning/templates/learning/teacher_dashboard.html
learning/templates/learning/teacher_login.html
learning/templates/learning/teacher_student_detail.html
learning/tests/test_project_directions.py
```

> `views.py` 一個檔案即 `+3163` 行，是學習工作台／教師端／模型倉庫頁面的主要載體。

### 3.3 前端與靜態（13）

```
404.html  index.html
live/index.html  live/live.css  live/live.js
live/live-coach-simplified-ux.test.cjs  live/student-ux-voice-reply.test.cjs
live/task-ui.test.cjs
src/app.js  src/platform-browser.js  src/rag-client.js
src/rag-client.test.cjs  src/rag-config.js  src/styles.css
```

### 3.4 文件（1）

```
docs/verification/CLASSROOM_BROWSER_ACCEPTANCE.md
```

### 3.5 其他（4）

```
.gitignore（已修改）
live_backend/app/main.py（同時是 I4 /platform/ 代理載體）
（前兩項已列於上）
```

> `git diff --stat` 總計：`43 files changed, 6881 insertions(+), 289 deletions(-)`

---

## 4. 未追蹤檔案（292 個，按目錄分組）

| 目錄 | 檔案數 | 內容 |
|---|---|---|
| `student_portal/learning/` | 61 | 核心業務模組與模板（見下） |
| `live_backend/tests/` | 16 | Live Backend 測試 |
| `live_backend/app/` | 9 | MP12、providers、vision_center、vision_api、teacher_style |
| `docs/architecture/` | 9 | 架構文件 |
| `docs/verification/` | 7 | 驗收紀錄 |
| `docs/superpowers/` | 3 | 計畫與設計規格 |
| `demo/` | 92 | DEMO 啟動／驗收工具與腳本（81 個 `demo/tools/` 腳本） |
| `docs/reports/` | — | P1–P9、I1–I5 全部報告（目錄整組未追蹤） |
| `docs/delivery/`、`docs/handoffs/` | — | 交付與舊交接文件 |
| `src/`、`live/` | 10 | `vision-client.js` 與 9 個 `.test.cjs` |
| `live_backend/tools/` | — | 工具腳本 |
| `student_portal/tests/` | — | 測試 |
| `validation_sets/` | — | 驗證集 |
| `flight-health/`、`downloads/` | — | 靜態前端 |
| 根目錄 | 17 個 `.md` + `add_firewall_rules.ps1` + `start_fde_mobile_preview.bat` | 歷史報告與工具 |

### 4.1 最關鍵的未追蹤業務檔案（Codex 必看）

```
student_portal/learning/external_modules.py            ← I1 建立、I5 安全強化（含 .i5-prebak 備份）
student_portal/learning/golden_set.py / golden_set_guard.py
student_portal/learning/growth_task_map.py
student_portal/learning/prop_scan.py
student_portal/learning/vision_submission.py            ← R07 提交鏈（保護區）
student_portal/learning/vision_repository.py            ← 教師模型倉庫（保護區）
student_portal/learning/vision_integrity.py / vision_verification.py
student_portal/learning/vision_snapshot.py / vision_flywheel.py
student_portal/learning/vision_rule_templates.py
student_portal/learning/migrations/0016–0019_*.py       ← 4 個 Migration
student_portal/learning/templates/learning/student_learning_path.html
student_portal/learning/templates/learning/student_prop_scan.html
student_portal/learning/templates/learning/teacher_vision_*.html（7 個）
student_portal/learning/templates/learning/teacher_golden_*.html（3 個）
student_portal/learning/templates/learning/teacher_class_*.html（3 個）
student_portal/learning/templates/learning/teacher_showcase.html
student_portal/learning/templates/learning/teacher_cohort_review_checklist.html
student_portal/learning/static/learning/learning-path.css、teacher-*.css/js（6 個）
student_portal/learning/tests/test_*.py（21 個）
live_backend/app/vision_center.py / vision_api.py / mp12_*.py / providers/ / teacher_style.py
src/vision-client.js
demo/（92 個檔案，含 start_demo.ps1、stop_demo.ps1、demo_common.ps1、33 個 verify_* 腳本）
```

> ⚠️ **`external_modules.py`、所有 `vision_*.py`、4 個 Migration、五階段工作台模板全部只存在於工作區，
> 沒有任何 Git 版本保護。** 一旦誤執行 `git clean -fd` 或 `git checkout -- .`，這些成果會**立即消失**。

---

## 5. stash 盤點

```
stash@{0}: On fde-ai-v1.5: safety: pre-anonymous identity v1.5 2026-09-14
```

- 建立於分支 `fde-ai-v1.5`，與 `fde-ai-v2.0-dev` **無關**
- 屬 v1.5C 世代的安全備份
- 🔴 **禁止 `stash pop` / `stash apply` / `stash drop`**（會污染 v1.5C 或 2.0 工作區）

---

## 6. 本機設定與 runtime（`.gitignore` 排除，不會進 Git）

| 項目 | 說明 |
|---|---|
| `.gitignore` 已排除 | `demo/runtime/db/`、`demo/runtime/downloads/`、`demo/runtime/vision-center/`、`demo/runtime/state/`、`demo/runtime/tmp/`、`demo/runtime/chrome-vision-test/`、`demo/runtime/*.txt`、`demo/runtime/*.json` |
| 本機設定 | `student_portal/.env`（若存在，含本機路徑）— **禁止提交、禁止寫入任何文件** |
| 正式資料庫 | `student_portal/db.sqlite3`（追蹤狀態見下） |
| DEMO 資料 | `demo/runtime/db/demo.sqlite3` 等（本地獨有） |
| 備份 | `demo/backup/`（3 個歷史備份） |

> `git ls-files` 未列出上述 runtime 路徑 → **這些資料只存在本機磁碟，無任何 Git 備份。**
> 建立備份包需教師單獨批准。

---

## 7. Migration 盤點

| app | 最新版本 | 追蹤狀態 |
|---|---|---|
| `student_portal/learning` | `0019_golden_set_manifest_contract.py` | **0016–0019 全部未追蹤** |

本輪零新增 Migration、未執行 `makemigrations`／`migrate`。

---

## 8. 外部獨立專案（不在本 repo）

| 專案 | 位置 | 狀態 |
|---|---|---|
| v1.5C 正式系統 | `C:\Users\admin\Documents\Codex\2026-08-30\new-chat\FDE-AI`（HEAD `c7a0b25`，2026-09-02） | 獨立 repo，禁止修改 |
| F450 3D 數位孿生 | 獨立專案（未接入 2.0） | 禁止移動 |
| HQGC | 獨立專案 | 禁止移動 |
| MP 地面站 | Mission Planner 獨立軟體 | 禁止移動 |
| YOLO Student Lite | `%LOCALAPPDATA%\FDE-AI-YOLO`（v1.1.0）；原始 `D:\AI\YoloWebAgentStarter` | 從未真實訓練出 best.pt |

---

## 9. 本輪新增（交接文件，唯一允許的寫入）

2026-10-14 交接輪共建立／更新 **10 份**文件（全部位於 `docs/handoff/`，未動任何產品程式）：

```
docs/handoff/CODEX_HANDOFF_MASTER.md          專案總覽、歷史、現狀、接棒原則
docs/handoff/SYSTEM_ARCHITECTURE.md           系統架構、服務關係、三組區分
docs/handoff/MODULE_STATUS_MATRIX.md          P1–P9／I1–I5／模組狀態
docs/handoff/PROTECTED_MODULES.md             凍結區、禁止範圍、I1 不得覆蓋 I5
docs/handoff/DEVELOPMENT_ENVIRONMENT.md       環境、依賴、啟動、埠號、變數、故障排除
docs/handoff/TEST_BASELINE.md                 測試基準（含 I1 46/46 教師確認歸檔）、既有失敗
docs/handoff/GIT_WORKTREE_INVENTORY.md        本文件
docs/handoff/NEXT_DEVELOPMENT_BACKLOG.md      未完成功能、風險、建議順序
docs/handoff/CODEX_FIRST_RUN_CHECKLIST.md     Codex 首次接手唯讀檢查
docs/handoff/HANDOFF_ACCEPTANCE.md            交接驗收清單（CODEX_HANDOFF_READY 判準）
```

盤點數量對照（2026-10-14 交接輪結束時）：

| 類別 | 交接前 | 交接後 |
|---|---|---|
| 已修改未提交 | 43 | 43（未變） |
| 未追蹤檔案 | 292 | 302（+10 為 `docs/handoff/`） |
| `git status --short` 條目 | 189 | 190（+1 為 `docs/handoff/` 目錄項） |

---

## 10. 重建盤點的命令（Codex 可自行重跑，全部唯讀）

```bash
cd /d/FDE-AI-UAS-v2.0
git rev-parse --abbrev-ref HEAD && git rev-parse HEAD
git log -1 --format="%h | %cd | %s" --date=format:"%Y-%m-%d %H:%M"
git status --short | wc -l
git status --porcelain | grep -c '^??'
git diff --stat | tail -1
git ls-files --others --exclude-standard | wc -l
git stash list
git worktree list
ls student_portal/learning/migrations/ | grep -E '^[0-9]{4}' | sort | tail -1
netstat -ano | grep -E ':(8022|8770|8765|8110|8111) '
```

> 禁止用 `git clean`、`git reset`、`git checkout --`、`stash pop` 「整理」工作區。
