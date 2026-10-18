# CODEX_FIRST_RUN_CHECKLIST.md｜Codex 首次接手檢查清單

> 目的：讓 Codex 在**不修改任何檔案**的前提下，用最短時間建立正確心智模型，並向教師提交「接棒理解報告」。
> 全部步驟皆為**唯讀**。任何一步發現異常 → 停止並回報，不得自行修復。

---

## 第 0 步：先讀文件（順序不可改）

| 順序 | 文件 | 讀完應該能回答 |
|---|---|---|
| 1 | `docs/handoff/CODEX_HANDOFF_MASTER.md` | 這是什麼專案？現在停在哪？ |
| 2 | `docs/handoff/PROTECTED_MODULES.md` | 我**絕對不能碰**什麼？哪些操作要教師批准？ |
| 3 | `docs/handoff/GIT_WORKTREE_INVENTORY.md` | 什麼已提交、什麼没有？誤操作會損失什麼？ |
| 4 | `docs/handoff/SYSTEM_ARCHITECTURE.md` | 四個服務怎麼連？三組易混淆概念是什麼？ |
| 5 | `docs/handoff/MODULE_STATUS_MATRIX.md` | 哪些功能真的完成了？哪些只是預留接口？ |
| 6 | `docs/handoff/TEST_BASELINE.md` | 測試跑到什麼程度？哪兩項失敗要保留？ |
| 7 | `docs/handoff/DEVELOPMENT_ENVIRONMENT.md` | 怎麼啟動？有哪些已知地雷？ |
| 8 | `docs/handoff/NEXT_DEVELOPMENT_BACKLOG.md` | 接下來該做什麼？ |

---

## 第 1 步：唯讀環境盤點（全部唯讀指令）

```bash
# 1.1 Git 狀態
cd /d/FDE-AI-UAS-v2.0
git rev-parse --abbrev-ref HEAD          # 期望 fde-ai-v2.0-dev
git rev-parse HEAD                       # 期望 e5c0442...
git status --short | wc -l               # 期望 190（43 M + 146 ?? + docs/handoff/）
git stash list                           # 期望 1 筆（分支 fde-ai-v1.5）
git diff --stat | tail -1                # 期望 43 files changed, 6881 insertions(+), 289 deletions(-)

# 1.2 Migration
ls student_portal/learning/migrations/ | grep -E '^[0-9]{4}' | sort | tail -1   # 期望 0019

# 1.3 服務埠（只讀探測）
netstat -ano | grep -E ':(8022|8770|8765|8110|8111) '
curl -s --noproxy '*' -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8022/login/   # 期望 200
curl -s --noproxy '*' http://127.0.0.1:8770/                                        # 期望 JSON refuse
```

### 檢查點

| 項 | 期望值 | 若不符 |
|---|---|---|
| 分支 | `fde-ai-v2.0-dev` | **停止**，回報教師 |
| status 數量 | 190（189 + `docs/handoff/` 1 條） | 明顯變少 → 可能有人動過工作區，**停止** |
| 8022 | LISTENING、`/login/` 200 | 未啟動 → 回報，勿自行啟動 |
| 8770 | LISTENING | 同上 |
| 8765 / 8110 / 8111 | 未啟動 | 屬預期，非異常 |

---

## 第 2 步：確認受保護模組未被修改

```bash
# 2.1 v1.5C repo 獨立且未被動
cd /c/Users/admin/Documents/Codex/2026-08-30/new-chat/FDE-AI
git rev-parse HEAD && git branch --show-current    # 期望 c7a0b25...
git status --porcelain | head -20                  # 若為空表示乾淨

# 2.2 2.0 repo 內無 v1.5C worktree
cd /d/FDE-AI-UAS-v2.0 && git worktree list         # 期望僅主 worktree

# 2.3 正式資料庫 mtime（交接基準：2026-10-07 19:08）
ls -l --time-style=+%Y-%m-%d_%H:%M student_portal/db.sqlite3
```

| 項 | 期望 | 異常處理 |
|---|---|---|
| v1.5C HEAD | `c7a0b25`（2026-09-02） | 改變即為事故 → **立即停止並回報教師** |
| worktree | 僅主 worktree | 出現其他 worktree → 回報 |
| `db.sqlite3` mtime | 2026-10-07 | 若晚於交接日 → 回報誰寫入了正式庫 |

---

## 第 3 步：核對 I1–I5 報告與程式碼一致

```bash
# 3.1 I5 安全核心存在
ls -l student_portal/learning/external_modules.py            # 未追蹤但必須存在
grep -c "_PinnedHTTPSConnection\|_resolve_probe_target" student_portal/learning/external_modules.py
grep -n "FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS" student_portal/config/settings.py

# 3.2 保護區業務模組存在
ls student_portal/learning/vision_*.py student_portal/learning/golden_set*.py

# 3.3 報告存在
ls docs/reports/I1_*.md docs/reports/I2_Report.md docs/reports/I3_Report.md \
   docs/reports/I4_Report.md docs/reports/I5_Report.md
```

| 項 | 期望 | 異常處理 |
|---|---|---|
| `external_modules.py` | 存在（含 IP Pinning） | 缺檔即為重大遺失 → 停止 |
| `settings.py` 私網清單 | 有 `FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS` | 缺 → 回報 |
| I1–I5 報告 | 5 份齊全 | 缺 → 回報 |

---

## 第 4 步：最小驗收（只跑不寫）

> 目的：確認測試基準仍成立。全部使用 **測試專用 DB**，禁止對正式庫執行。

```bash
cd /d/FDE-AI-UAS-v2.0
# 4.1 I1／I5 單元測試（期望 63/63）
env -u DJANGO_DEBUG -u DATABASE_URL DJANGO_DB_NAME="$PWD/demo/runtime/db/i4_e2e.sqlite3" \
  "D:/FDE-AI-UAS-v2.0/.test-temp/django-venv/Scripts/python.exe" \
  -c "import sys; sys.path.insert(0,'student_portal'); import django, os; os.environ['DJANGO_SETTINGS_MODULE']='config.settings'; django.setup(); from django.test.utils import get_runner; from django.conf import settings; get_runner(settings)(verbosity=1).run_tests(['learning.tests.test_external_module_interface'])"

# 4.2 I5 安全測試（期望 PASS 39 / FAIL 0）
PYTHONUTF8=1 "D:/FDE-AI-UAS-v2.0/.test-temp/django-venv/Scripts/python.exe" demo/tools/verify_i5_security.py
```

| 項 | 期望 | 異常處理 |
|---|---|---|
| 4.1 | `OK`（63 tests） | 失敗 → 記錄清單，**不要為了轉綠而改保護區** |
| 4.2 | `PASS - 39 / FAIL - 0` | 失敗 → 記錄，同上 |

> 若失敗數與基準**完全一致**（2 項既有失敗）→ 屬預期。
> 若出現**新的**失敗 → 停下手開發，先回報。

---

## 第 5 步：提交「接棒理解報告」

完成上述檢查後，向教師提交一份報告，必含：

1. **我讀了哪些文件、理解到什麼程度**（用自己的話重述三組易混淆概念）
2. **Git 盤點結果**：分支、HEAD、43 修改 + 292 未追蹤、1 筆 stash
3. **受保護模組確認結果**：v1.5C HEAD、worktree、正式庫 mtime
4. **最小驗收結果**：63/63 與 39/39 是否仍成立；新失敗清單（若有）
5. **我打算從 `NEXT_DEVELOPMENT_BACKLOG.md` 的哪一項開始**，以及為什麼
6. **我認為需要教師批准的事項**（Git 提交、正式服務、外部模組等）

**報告完成後停止，等教師批准。**

---

## 絕對禁止（首次接手期間）

- ❌ `git clean` / `reset` / `checkout --` / `stash pop` / `commit` / `push` / `merge` / `rebase`
- ❌ 修改 v1.5C、YOLO／`best.pt`、R07、教師模型倉庫、Flight Health、F450 十二任務、MP12、HQGC、F450 3D
- ❌ 新增 Migration、修改正式 DB
- ❌ 部署、重啟正式服務、安裝／升級系統級環境
- ❌ 大規模重構、自行啟動 I6
- ❌ 把未提交成果當成已封版
