# FDE-GCS Web 1.0 交接文件

- 日期：2026-11-14
- 分支：`feat/fde-gcs-web-v1`（從 `fde-ai-v2.0c` @ `2e7f9f3` 開出，**未合併、未部署**）
- 開發環境：雲端容器（無 Windows、無 USB、無法執行 SITL）

## 1. 各階段狀態

| 階段 | 內容 | 狀態 | 文件 |
|---|---|---|---|
| P0 | 唯讀盤點、開源授權審計、架構 | 雲端部分 PASS；本機盤點 `PENDING_LOCAL` | `FDE_GCS_V1_ARCHITECTURE.md`、`FDE_GCS_OPEN_SOURCE_AUDIT.md`、`FDE_GCS_SCENE_SPEC.md`（草稿） |
| P1 | 右上角入口、登入保護、Feature Flag、六大區塊、CSP | PASS | `FDE_GCS_P1_REPORT.md` |
| P2 | Web Serial 唯讀：心跳、遙測、參數讀取、斷線處理 | 程式 PASS（模擬飛控）；**真機 `PENDING_MANUAL`** | `FDE_GCS_P2_REPORT.md`、`FDE_GCS_USB_MAVLINK_TEST.md` |
| P3 | 教師批准的 PID 參數寫入 | 程式 PASS（模擬飛控）；**真機 `PENDING_MANUAL`，停在人工驗收點** | `FDE_GCS_P3_REPORT.md` |
| P4 | SITL 仿真整合 | **BLOCKED**：等 Gazebo 接管案回歸測試通過 | `FDE_GCS_SITL_INTEGRATION_TEST.md` |
| P5 | 參數備份、差異報告、教師 PASS／NG、任務卡、CSV、AI 調參助教、SOP | PASS（AI 回答品質 `PENDING_LOCAL`） | `FDE_GCS_P5_REPORT.md`、`FDE_GCS_STUDENT_SOP.md`、`FDE_GCS_TEACHER_SOP.md` |
| P6 | 教室驗收 | **PENDING_MANUAL** | 本文件第 5 節 |
| — | 教室啟動腳本 | 程式完成，靜態檢查 PASS；**Windows 實際執行 `PENDING_LOCAL`** | 本文件第 3 節 |
| Web 1.1 | 一鍵還原、教師待批准提醒 | PASS（模擬飛控） | `FDE_GCS_WEB11_REPORT.md` |

## 2. 程式碼位置

| 位置 | 內容 |
|---|---|
| `student_portal/gcs_portal/` | 全部 FDE-GCS 程式：Django app、API、模板、前端、測試、開發工具 |
| `student_portal/gcs_portal/static/gcs_portal/mavlink/` | MAVLink 編解碼、連線、參數、遙測、寫入模組 |
| `student_portal/gcs_portal/param_allowlist/arducopter-4.json` | 寫入白名單（版本 `2026-11-14.1`，張鵬亞教官 2026-11-14 批准） |
| `student_portal/gcs_portal/param_explanations.json` | 參數說明（張鵬亞教官 2026-11-14 批准） |
| `student_portal/gcs_portal/migrations/` | `0001`（寫入申請）、`0002`（覆核欄位、參數備份）、`0003`（還原申請）；**只影響 gcs_portal 自己的資料表** |
| `ops/fde-gcs/` | 教室啟動腳本 |
| `docs/fde-gcs/` | 全部文件與截圖 |

**修改到的既有檔案只有 4 個**（P1，共新增 15 行、0 刪除）：`config/settings.py`、`config/urls.py`、`learning/templates/learning/base.html`、`learning/templates/learning/platform_identity_nav.html`。

## 3. 教室部署（Windows）

### 第一次設定

1. 把這個分支取到本機（**不要**直接在正式站工作樹切換）：

```bat
cd /d D:\FDE-AI-UAS-v2.0
git fetch origin feat/fde-gcs-web-v1
git worktree add D:\FDE-GCS-worktree feat/fde-gcs-web-v1
```

2. 設定要開放的班級（以 2026-06 期為例），設定後重新開啟命令視窗：

```bat
setx FDE_GCS_COHORTS 2026-06
```

3. 若 Python 不在預設位置，設定 `FDE_GCS_PYTHON` 指向有 Django 5.2 的 python.exe。
4. 若有 SITL 接管案的啟動檔，設定 `FDE_SITL_LAUNCHER`。

### 每次上課

| 檔案（`ops\fde-gcs\`） | 作用 |
|---|---|
| `CHECK_FDE_GCS.bat` | 檢查：D 槽空間、Chrome／Edge、COM 埠、是否有 Mission Planner／QGC 在跑、SITL 埠、網站狀態 |
| `START_FDE_GCS_WEB.bat` | 啟動網站（只綁 `127.0.0.1:8260`），資料庫和紀錄放在 `D:\FDE-GCS-runtime`，並打開教師登入頁 |
| `STOP_FDE_GCS_WEB.bat` | 安全停止：**只停止自己啟動、而且仍占用 8260 的程序**，紀錄檔保留 |
| `START_FDE_SITL_TRAINING.bat` | 檢查 SITL；已在執行就不重複啟動 |

### 帳號

啟動腳本使用**獨立的資料庫**（`D:\FDE-GCS-runtime\db\fde-gcs.sqlite3`），不會碰到正式站或 DEMO 的資料。第一次使用要建立帳號：

```bat
cd /d D:\FDE-GCS-worktree\student_portal
set DJANGO_DB_NAME=D:\FDE-GCS-runtime\db\fde-gcs.sqlite3
python manage.py createsuperuser
```

之後用 `/admin/` 建立班級（Cohort）、教師班級存取權，學員用網站原本的註冊與班級代碼流程加入。

## 4. 測試總表（雲端）

| 測試 | 數量 | 結果 |
|---|---|---|
| JavaScript 單元測試（含啟動腳本靜態檢查） | 33 | PASS |
| Django `gcs_portal` | 53 | PASS |
| 端到端 P2／P3／P5／Web 1.1（Chromium＋pymavlink 模擬飛控） | 8／12／10／9 | PASS |
| 完整回歸 `learning`＋`gcs_portal` | 1390 | 失敗項目與改動前基準完全相同（17 failures、19 errors，雲端缺 ffmpeg 與平台檔） |

重現指令：

```bash
node --test 'student_portal/gcs_portal/js_tests/*.test.mjs'
cd student_portal && python manage.py test gcs_portal
```

## 5. 人工驗收清單（P6，教室）

| # | 項目 | 狀態 |
|---|---|---|
| 1 | `CHECK_FDE_GCS.bat`、`START_FDE_GCS_WEB.bat`、`STOP_FDE_GCS_WEB.bat` 在 Windows 實際執行，中文顯示正常 | PENDING_LOCAL |
| 2 | 本機完整回歸測試（有 ffmpeg、平台檔），確認基準那 36 個失敗在本機不存在或與 FDE-GCS 無關 | PENDING_LOCAL |
| 3 | Windows Chrome 的 USB 連線、Pixhawk 2.4.8 參數讀取（`FDE_GCS_USB_MAVLINK_TEST.md` 第 4 節） | PENDING_MANUAL |
| 4 | H743 參數讀取（有設備時） | PENDING_MANUAL |
| 5 | 單參數安全寫入與讀回，並用 Mission Planner 交叉確認（`FDE_GCS_P3_REPORT.md` 第 7 節，**拆槳、教師在場**） | PENDING_MANUAL |
| 6 | 解鎖狀態下寫入被擋下 | PENDING_MANUAL |
| 7 | USB 拔除與重新連線、COM 埠被 Mission Planner 占用時的提示 | PENDING_MANUAL |
| 8 | 學員成果紀錄、教師權限、跨班級隔離（兩個班級各一位學員與教師實測） | PENDING_MANUAL |
| 9 | AI 調參助教的實際回答品質（RAG 服務運作時） | PENDING_LOCAL |
| 10 | 教師確認白名單範圍與參數說明文字 | **PASS**（2026-11-14 張鵬亞教官批准） |
| 11 | SITL 獨立啟動、四航點仿真任務、QGC／HyperQGC 仿真連線 | BLOCKED（P4） |
| 12 | P0 本機盤點（D／E 槽、QGC／HyperQGC 版本、COM 驅動、Gazebo 接管案） | PENDING_LOCAL |

## 6. 回退方式

| 範圍 | 做法 |
|---|---|
| 立即停用 | 把 `FDE_GCS_ENABLED` 設成 `0` 或刪除，入口與所有 API 消失（404） |
| 本機教室服務 | `STOP_FDE_GCS_WEB.bat`；刪除 `D:\FDE-GCS-runtime` 即清除所有 FDE-GCS 本機資料 |
| 程式碼 | 這個分支沒有合併到任何地方；不合併即完全不影響現有系統 |

## 7. Web 1.1 建議

1. **P4 仿真整合**（Gazebo 接管案通過後）
2. ~~一鍵還原~~（Web 1.1 已完成）
3. ~~教師待批准提醒~~（Web 1.1 已完成，仍為 5 秒輪詢；需要跨分頁即時推播時再評估）
4. **白名單擴充**：依教學需要加入 `ATC_ANG_*_P` 或 `PSC_*`，每次擴充都要教師確認並更新版本號
5. **H743 與其他韌體版本的白名單分檔**
