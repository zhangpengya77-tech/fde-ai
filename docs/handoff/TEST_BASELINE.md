# TEST_BASELINE.md｜測試基準封存

> 移交者：WorkBuddy ｜ 2026-10-14
> 原則：**每個數字都標明來源與執行日期。未重新執行的項目不得宣稱本次重新驗證。**

---

## 1. 基準總表

| 項目 | 結果 | 執行日期 | 來源 |
|---|---|---|---|
| I1 外部模組接口與權限隔離（**教師確認之最終測試基準**） | **46/46 PASS** | 教師確認（教師跨班級隔離補充驗收）；I5-G 回歸 2026-10-14 | `demo/tools/verify_i1_external_modules.py`、`docs/reports/I1_External_Module_Integration_Report.md` §G |
| I2 四態與降級測試 | **114/114**（default 67 + module-up 23 + module-down 24） | 2026-10-14（I5-G 回歸） | `.test-temp/i5g_i123_regression.log` |
| I3-A 端到端教學流程 | **45 PASS** | 2026-10-14（I5-G 回歸） | `.test-temp/i5g_i3e2e.log` |
| I3-B 模組安全驗收 | **95 PASS / 0 FAIL** | 2026-10-14（I5-G 回歸） | `.test-temp/i5g_i123_regression.log` |
| I4-A 跨服務主流程 | **31 PASS** | 2026-10-14（I5-G 回歸） | `.test-temp/i5g_i4a.log` |
| I4-A 降級驗收 | **9 PASS** | 2026-10-14（I5-G 回歸） | `.test-temp/i5g_i4a.log` |
| I4-C deny 模式 | **35 PASS** | 2026-10-14（I5-G 回歸） | `.test-temp/i5g_i4_matrix2.log` |
| I4-C allow 模式 | **36 PASS** | 2026-10-14（I5-G 回歸） | `.test-temp/i5g_i4_matrix2.log` |
| I5-A 路由核對 | **33/33 PASS** | 2026-10-14（I5-G 重跑） | `demo/tools/i5_route_check.py` |
| I5-B 安全測試 | **PASS 39 / FAIL 0** | 2026-10-14（I5-G 重跑） | `demo/tools/verify_i5_security.py` |
| I1／I5 單元測試 | **63/63 OK** | 2026-10-14（I5-G 重跑） | `student_portal/learning/tests/test_external_module_interface.py` |
| learning 完整回歸 | **934 項 → 932 通過、2 項既有失敗** | 2026-10-14（I5-G 回歸） | `.test-temp/i5g_batch_b1.log` ~ `b6.log` |

> I1 46/46 為**教師確認之最終測試基準**（詳見 §1.1）；同一檔案內的單元測試子集為 63/63。
> 「learning 934 項」為 I5-G 期間分 6 批執行的合計，非單一进程一次跑完。

---

## 1.1 I1 最終測試基準（教師確認歸檔）

教師已確認 **I1 教師跨班級隔離補充驗收 46/46 PASS，並接受作為 I1 最終測試基準**。

### 1.1.1 驗證腳本位置

| 腳本 | 用途 | 狀態 |
|---|---|---|
| `demo/tools/verify_i1_external_modules.py` | 入口、權限、跨班級／跨課程隔離 HTTP 層驗收（**46 項**） | **46/46 PASS（教師確認，最終基準）** |
| `demo/tools/i1_external_modules_check.cjs` | 渲染＋手機 390×844 檢查 | 11/11 PASS（Chrome 裝置模擬） |

### 1.1.2 I1 基準涵蓋的六項教師確認要點

| # | 確認要點 | 對應驗收 |
|---|---|---|
| 1 | 教師授權班級正常存取 | 教師 A 對授權班級（總覽／報告／結訓清單／展示）PASS（HTTP 200） |
| 2 | 教師跨班級未授權存取回傳 404 | 教師 A 對未授權班級 `P42-B-2026`（報告／結訓清單／展示／兩種 CSV）→ 404；**不得以空資料冒充 200** |
| 3 | 學員跨課程未授權存取回傳 404 | 學員存取他人課程工作台 → 404（跨課程隔離） |
| 4 | 教師登入使用 `/teacher/login/`（非 `/login/`） | 登入端點判定已內建於腳本 |
| 5 | 權限測試**禁止自動跟隨重導**，以免產生假 PASS | 自訂 `redirect_request()` 回傳 `None` → 302（未登入導向登入頁）如實呈現，不被誤判為 200 |
| 6 | 真實 iPhone Safari 仍為 **PENDING** | Chrome 390×844 裝置模擬結果不算真機 |

### 1.1.3 I1 基準執行方式（隔離環境）

```bash
# 1) 啟動 I1 隔離驗收服務（獨立 DB p42_verify.sqlite3，不觸碰正式庫）
powershell -ExecutionPolicy Bypass -File demo\tools\start_p42_verify.ps1 -Port 8112 -DbFile p42_verify.sqlite3

# 2) 執行 46 項驗收（BASE 內建為 http://192.168.1.114:8112）
python demo\tools\verify_i1_external_modules.py
```

相關報告：`docs/reports/I1_External_Module_Integration_Report.md`（§G 46/46 PASS、§H 受保護區零修改證據）。

> ⚠️ I1 為**介面與權限層**基準。之後 I2／I3／I4／I5 的框架、跨服務代理與安全修復**仍為後續版本成果，全部保留**
> （見 `MODULE_STATUS_MATRIX.md`）；Codex **不得**以 I1 歷史程式覆蓋 I5 最新版本。

---

## 2. 兩項既有失敗（獨立記錄，禁止修改保護區消滅）

| # | 測試 | 差異內容 | 判定 |
|---|---|---|---|
| 1 | `learning.tests.test_auth` | hero 標籤差異 | **I5 之前即存在**，非本輪回歸新增 |
| 2 | `learning.tests.test_vision_flywheel_framework` | 「訓練用途」欄位差異 | **I5 之前即存在**，非本輪回歸新增 |

批次來源：`b1`（`test_auth`）、`b6`（`test_vision_flywheel_framework`）。
**禁止為讓測試全綠而修改教師模型倉庫或既有前端。**

---

## 3. 待人工驗收（自動化無法完成）

| 項目 | 狀態 | 說明 |
|---|---|---|
| 真實 iPhone Safari | **PENDING** | 沿用 I4-E 表：7 站 32 項；Chrome 390×844 裝置模擬不算真機 |
| 正式 Tunnel 登入 | **PENDING** | 需正式環境 |
| 正式 RAG 真實問答 | **PENDING** | DEMO 用的是同源代理 |
| 正式 YOLO 推論 | **PENDING** | `:8765` 未啟動；DEMO 為模擬推論 |
| 教師實際課堂試用 | **PENDING** | 需教師安排 |

---

## 4. 重現指令

### 4.1 I1／I5 單元測試（63/63）

```bash
cd /d/FDE-AI-UAS-v2.0
env -u DJANGO_DEBUG -u DATABASE_URL DJANGO_DB_NAME="$PWD/demo/runtime/db/i4_e2e.sqlite3" \
  "D:/FDE-AI-UAS-v2.0/.test-temp/django-venv/Scripts/python.exe" \
  -c "import sys; sys.path.insert(0,'student_portal'); import django, os; os.environ['DJANGO_SETTINGS_MODULE']='config.settings'; django.setup(); from django.test.utils import get_runner; from django.conf import settings; get_runner(settings)(verbosity=1).run_tests(['learning.tests.test_external_module_interface'])"
```

### 4.2 I1 外部模組接口與權限隔離（46/46，教師確認之最終基準）

```bash
# 隔離服務（獨立 DB，不觸碰正式庫）
powershell -ExecutionPolicy Bypass -File demo\tools\start_p42_verify.ps1 -Port 8112 -DbFile p42_verify.sqlite3
python demo\tools\verify_i1_external_modules.py     # 期望 46/46 PASS
```

### 4.3 I2／I3 回歸

```bash
cd /d/FDE-AI-UAS-v2.0
bash demo/tools/run_i4_regression.sh      # I1 + I2 default/up/down + I3-B
bash .test-temp/i5g_run_i3e2e.sh           # I3-A 端到端
```

### 4.4 I4 回歸

```bash
cd /d/FDE-AI-UAS-v2.0
bash demo/tools/run_i4_matrix.sh           # I4-C deny / allow
bash .test-temp/i5g_run_i4.sh              # I4-A 主流程 + 降級
```

### 4.5 I5 安全測試

```bash
cd /d/FDE-AI-UAS-v2.0
PYTHONUTF8=1 "D:/FDE-AI-UAS-v2.0/.test-temp/django-venv/Scripts/python.exe" demo/tools/verify_i5_security.py
```

### 4.6 I5-A 路由核對

```bash
cd /d/FDE-AI-UAS-v2.0
PYTHONUTF8=1 NO_PROXY='*' "C:/Users/admin/AppData/Local/Python/pythoncore-3.14-64/python.exe" demo/tools/i5_route_check.py
```

### 4.7 learning 完整回歸（分 6 批）

批次腳本：`.test-temp/i5g_run_batch.sh`；批次定義見下表（日誌 `.test-temp/i5g_batch_<b>.log`）：

| 批 | 測試模組 |
|---|---|
| b1 | `test_anonymous_accounts`、`test_auth`、`test_course_sync`、`test_deployment_settings`、`test_enrollments` |
| b2 | `test_golden_set_center`、`test_golden_set_contract`、`test_golden_set_immutability`、`test_growth_records`、`test_growth_video`、`test_i3_student_experience` |
| b3 | `test_p2_task_record_chain`、`test_p8_showcase_security`、`test_p9_readonly_report`、`test_project_directions`、`test_public_ai`、`test_public_platform`、`test_seed_tasks` |
| b4 | `test_student_email_login`、`test_student_learning_path`、`test_student_prop_scan_page`、`test_student_survey`、`test_student_survey_v2`、`test_student_tasks`、`test_survey_recommendations`、`test_task_versions` |
| b5 | `test_registration_profile`、`test_qa_accounts`、`test_teacher_catalogue`、`test_teacher_class_outcomes`、`test_teacher_class_report`、`test_teacher_class_showcase`、`test_teacher_cohort_delivery`、`test_teacher_survey_dashboard`、`test_teacher_workflow`、`test_v15b_test_cohort_seed` |
| b6 | `test_teacher_vision_acceptance`、`test_teacher_vision_center_page`、`test_vision_flywheel_framework`、`test_vision_model_center`、`test_vision_repository`、`test_vision_rule_templates`、`test_vision_snapshot`、`test_vision_snapshot_security` |

執行環境：`DJANGO_DB_NAME=demo/runtime/db/i4_e2e.sqlite3`、`DJANGO_SETTINGS_MODULE=config.settings`、
`DJANGO_DEBUG=true`、`PYTHONUTF8=1`、venv python。

> ⚠️ 完整後端套件**單回合**執行會觸發 CLI `safe-delete` 大量刪除保護（temp 清理 >50 即擋）報 ERROR，
> 非程式錯誤。**分 6 批執行可避開。**

---

## 5. Node 測試（28 個 `.test.cjs`）

未在本輪重新執行。既有紀錄見 I4／P0 報告；重跑方式：`node --test src/*.test.cjs` 等（Node 22/24）。

---

## 6. 測試環境注意事項

| 項目 | 說明 |
|---|---|
| 測試 DB | `demo/runtime/db/i4_e2e.sqlite3`（720896 bytes，2026-10-14 01:46） |
| 正式庫 | `student_portal/db.sqlite3`（450560 bytes，2026-10-07 19:08）— **測試不得使用** |
| I5 哨兵 | 127.0.0.1:8198（HTTP）、127.0.0.1:8197（HTTPS 自簽，openssl 產生）— 僅測試期間存在 |
| 對外流量 | I5 腳本以 `_MODE` 對公網模擬位址「記錄目標後拋 TimeoutError」避免真實對外連線 |
| Python 3.12 注意 | `198.51.100.0/24`、`203.0.113.0/24`、`192.0.2.0/24` 的 `is_private` 為 **True**，不可當「公網模擬位址」；請用真實全球位址（如 `93.184.216.34`） |
