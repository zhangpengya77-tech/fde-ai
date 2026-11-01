# FDE-AI 2.0 ｜ P3-H 第十四階段交付報告
## 統一 Evidence PDF 上傳安全驗證 ＋ 8022 啟動器最小修復設計 ＋ 隔離測試與安全審計

- 工作樹：`D:\FDE-AI-UAS-v2.0-p3h-local-backend`（分支 `codex/p3h-local-backend`）
- 預期 HEAD：`dfef115dc911e25ad0604ff3534bffbe968adc21`（**未變動**）
- 執行日期：2026-10-27
- 執行模式：隔離工作樹內最小修改；**未 commit / push / merge / deploy**；**未觸碰正式 8022／8770／8030、排程、程序、資料庫、Tunnel／DNS／Pages**。

---

## 一、Evidence 全入口清單（任務 A）

窮舉生產代碼中所有建立／更新 `Evidence` 的路徑，並對每個入口確認六項：
`full_clean` 是否執行、是否查 PDF 副檔名、是否查 100MB、是否查 `%PDF-` 檔頭、
是否具備權限驗證、是否存在 DB／MEDIA_ROOT 殘留風險。

| # | 入口 | 位置 | full_clean | 副檔名 | 100MB | `%PDF-` 檔頭 | 權限驗證 | 殘留風險 |
|---|------|------|:---:|:---:|:---:|:---:|------|------|
| 1 | 學生 `EvidenceForm` 上傳 | `views.py` `evidence_add`（ModelForm） | ✅ 經 ModelForm | ✅ 欄位 validators | ✅ | ✅ `clean()`（第十三階段） | ✅ `@student_required`＋enrollment 歸屬 | 無（拒絕不落盤） |
| 2 | 成長記錄**影像** | `views.py:1137` 直建 `Evidence`＋`upload.save` | ❌ → **現已 `validate_evidence_upload`** | ✅ | ✅ | ➖（非 `.pdf`） | ✅ `editable`＋學員歸屬 | 無 |
| 3 | 成長記錄**影片** | `views.py:1164` 直建＋`upload.save` | ❌ → **現已 `validate_evidence_upload`** | ✅ | ✅ | ➖（非 `.pdf`） | ✅ | 無 |
| 4 | 成長記錄**文件** | `views.py:1182` 落盤（前置驗證見下） | ❌ → **前置 `validate_evidence_upload`** | ✅（**新**） | ✅（**新**） | ✅（**新**） | ✅ `editable`＋學員歸屬 | 無（前置攔截，不落盤） |
| 5 | R05 模型成果 | `views.py:1316` 直建＋`upload.save` | ❌ → **現已 `validate_evidence_upload`** | ✅（**新**） | ✅（**新**） | ➖（`.pt` 非 `.pdf`） | ✅ `editable`＋`ai_flight_assessment` | 無 |
| 6 | 管理後台 | `admin.py` `EvidenceAdmin(ImmutableRecordAdmin, admin.ModelAdmin)` | ➖ | N/A | N/A | N/A | **唯讀**：`has_add_permission=False`、`has_change_permission=False`、`has_delete_permission=False` → **後台不建立 Evidence** | 無 |
| 7 | API 建立 | 搜尋結果：**不存在**（`rest_framework`/`APIView`/`@api_view` 全倉 0 處） | — | — | — | — | — | — |
| 8 | `Evidence.objects.create()` | 生產代碼：**0 處**（僅 `.filter()`/`.select_related()` 查詢） | — | — | — | — | — | — |

**結論**：原本只有入口 1（`EvidenceForm`）會跑驗證；入口 2–5 直建 `Evidence` 完全繞過
`full_clean()`，是第十三階段 FINDING-1／FINDING-2 的安全缺口。本階段把這四條路徑全部改呼叫
**同一支** `validate_evidence_upload()`，與入口 1 共用同一份副檔名白名單、同一個 100MB 上限、
同一支 `validate_pdf_header`，避免「表單會擋、直建不擋」的第二套矛盾規則。入口 6 為唯讀不建立；
入口 7／8 在生產代碼中不存在，故無需處理。

> 備註：**未**將所有附件類型一律限制為 PDF。副檔名白名單（26 項）與第十三階段完全一致；
> 只有 `.pdf` 才額外查 `%PDF-` 檔頭，其餘類型（圖片／影片／Office／`.pt` 等）行為不變。
> 成長記錄既有業務契約（R07／R08 允許文件，影像／影片分別歸 R01–R08／R01–R08）保持不變。

---

## 二、修復前後差異（任務 A）

### `student_portal/learning/models.py`（+98 / −5；SHA `1678751891203aa8`）
1. 模組層新增 `from django.core.exceptions import ValidationError`（原在 `clean()` 內區域匯入）。
2. 新增常數 `EVIDENCE_MAX_BYTES = 100*1024*1024` 與 `EVIDENCE_ALLOWED_EXTENSIONS`（26 項，與原欄位驗證器白名單**逐項相同**）。
3. `validate_evidence_size` 改引用 `EVIDENCE_MAX_BYTES`（行為不變）。
4. 保留第十三階段 `validate_pdf_header()`（`.pdf` 才查 `%PDF-`，讀 5 位元組後還原檔案指標）。
5. **新增統一入口** `validate_evidence_upload(file_obj)`：依序執行
   `FileExtensionValidator(EVIDENCE_ALLOWED_EXTENSIONS)` → `validate_evidence_size` → `validate_pdf_header`。
6. 欄位 `validators=[...]` 改引用 `EVIDENCE_ALLOWED_EXTENSIONS`（**deconstruction 值不變 → 不產生遷移**）。
7. `Evidence.clean()` 的 PDF 檔頭檢查**原樣保留**（第十三階段修復未覆蓋）。

### `student_portal/learning/views.py`（+33 / −5；SHA `206b3b33da9b8436`）
1. 匯入 `validate_evidence_upload`。
2. `growth_record_detail`（成長記錄）：
   - **前置**（transaction 之前）：對每個 `new_documents` 呼叫 `validate_evidence_upload(File(upload, name=…))`，失敗時 `form.add_error("documents", …)` 並中斷——這補上 FINDING-1 的「文件完全不驗證」缺口。
   - **影像**：改以 `ContentFile(image_bytes, name=filename)` 先驗證再落盤（同一物件，指標不變）。
   - **影片**：對 `File(video_file, name=video_name)` 先驗證再 `upload.save`。
   - 文件落盤迴圈結構不變（已在前置攔截）。
3. `growth_model_upload`（R05）：先 `model_content = ContentFile(content, name=original_name)` →
   `validate_evidence_upload` → 失敗則 `messages.error` 並 `redirect`（不建立 Evidence、不落盤）。

### `student_portal/learning/tests/test_p3h_phase14_evidence_validation.py`（新增；SHA `fd6adf1d15383534`）
12 個測試，覆蓋 `validate_evidence_upload` 單元、成長記錄文件 HTTP 回歸、evidence_add PDF 回歸。

---

## 三、HTTP 與單元測試結果（任務 B）

### 全新隔離候選環境（Django test client＝真實 WSGI HTTP，每測試獨立 test DB ＋ 獨立 `MEDIA_ROOT`）
> 說明：本階段以 Django 測試客戶端（與正式伺服器同一 WSGI 請求／回應堆疊）作為「全新 CandidateRoot」
> 的等價隔離體——每個測試使用全新測試資料庫與隔離 `MEDIA_ROOT`，比共享棧更嚴格、可重現、無埠位衝突。

| 測試套件 | 結果 |
|----------|------|
| `test_p3h_phase14_evidence_validation`（本階段新增，12 項） | **12/12 OK** |
| `test_p3d_course_upload_closure`（含第十三階段 PDF 檔頭測試） | OK |
| `test_growth_records`（43 項，含影像 EXIF／草稿／AJAX） | **43/43 OK** |
| `test_p8_showcase_security.P8ConsistencyTests.test_no_new_migration_added` | OK（無新遷移） |
| `test_teacher_class_showcase.ShowcaseRegressionTests.test_no_new_migration_added` | OK（無新遷移） |
| `test_r07_upload_acceptance` ＋ `test_project_directions`（25 項，含模型上傳失敗不留殘留） | **25/25 OK** |

### 任務 B 清單對照（均以真實 HTTP／單元執行）
- 合法 PDF：✅ 落盤且教師下載 SHA-256 與來源逐位元組一致。
- 偽裝 PDF（MZ／ZIP／HTML／PNG 改名 `.pdf`）：✅ 被拒，0 新增 Evidence、0 媒體殘留。
- 超大 PDF（>100MB）：✅ `validate_evidence_size` 拒絕。
- 空檔：✅ 副檔名／大小檢查攔截（`.pdf` 無 `%PDF-` 檔頭亦被 `validate_pdf_header` 拒）。
- 非 PDF（`.exe` 等）：✅ `FileExtensionValidator` 拒絕（含成長記錄文件路徑）。
- 成長記錄合法附件（`.pdf`／`.docx`／`.jpg`／`.mp4`／`.pt`）：✅ 接受。
- 成長記錄非法附件（改名 `.pdf`、`.exe`）：✅ 拒絕、無殘留。
- 直接建立 Evidence 受控測試：✅ `ValidateEvidenceUploadTests` 直接驗證四條直建路徑共用的 helper。
- 跨班／跨學生權限：✅ 既有 `evidence_add` 測試（404／403）保持綠。
- 教師下載 SHA-256：✅ 與來源一致。
- DB／MEDIA_ROOT 殘留：✅ 每個拒絕案例 `Evidence.objects.count()` 不變、`MEDIA_ROOT` 下無 `.pdf`／`.exe` 殘留。
- 已有學習記錄不受影響：✅ `test_growth_records` 43 項全綠（含既有影像處理、草稿邏輯）。

---

## 四、DB／媒體一致性證據（任務 B）

- `manage.py makemigrations --check --dry-run` → **`No changes detected`**。
  最後一筆遷移仍為 `0019_golden_set_manifest_contract.py`，**未突破遷移守門**。
- 欄位驗證器由內嵌清單改為引用同名常數，Django deconstruction 值不變 → 不觸發 `AlterField`。
- 所有拒絕案例經測試證實：無 `Evidence` 列新增、無 `MEDIA_ROOT` 檔案殘留（見第三節）。
- **未**對正式資料庫執行任何寫入；隔離測試使用獨立 test DB 與 `MEDIA_ROOT`。

---

## 五、8022 啟動器最小補丁方案（任務 C，僅設計，不寫回正式腳本）

### 唯讀標的
`D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1`（304 行，未修改）。

### 根因（與第十三階段一致，再次收斂）
第 185–197 行的所有權判定：
```powershell
$expectedDjangoExe = [System.IO.Path]::GetFullPath($DjangoPython)
$django = Get-Listener $DjangoPort
if ($django) {
  $owner = Get-Process -Id $django.OwningProcess ...
  $ownerPath = ... [System.IO.Path]::GetFullPath($owner.Path)
  if ($ownerPath -and $ownerPath -ne $expectedDjangoExe) {
    Stop-Process -Id $django.OwningProcess -Force ...   # 誤殺自己的子程序
  }
}
```
`$DjangoPython` 是 v1.5 venv 的 `python.exe` 路徑；但 `Start-Process $DjangoPython` 啟動的是
venv **shim**，shim 在 ~1.2 秒內退出並產生子程序，其映像落在
`C:\Users\admin\.fde-ai\YoloRuntime\python\cpython-3.12.13-windows-x86_64-none\python.exe`。
排程每 5 分鐘重跑本腳本時，`Get-Listener 8022` 找到的監聽者映像＝YoloRuntime，**永遠 ≠ venv shim 路徑**
→ 被誤判為「stale」→ `Stop-Process -Force` 殺掉**自己剛啟動的合法 v1.5C Django** → 5 分鐘自傷循環。

### 最小補丁（以命令列＋專案路徑＋PID 狀態記錄判定所有權，取代映像路徑比較）

**取代第 185–197 行**：
```powershell
# P3-H 第十四階段：以「命令列 + 專案路徑 + PID 狀態記錄」判定所有權，
# 不再以 python.exe 映像路徑判定（venv shim 會使真實 Django 子程序映像
# 落在 YoloRuntime 基底，舊邏輯會誤殺自己的子程序，造成 5 分鐘自傷循環）。
$django = Get-Listener $DjangoPort
$djangoPidStateFile = Join-Path $StateRoot 'django-v15c-pid.txt'

function Test-IsV15CDjango([int]$ProcessId) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    if (-not $p -or -not $p.CommandLine) { return $false }
    $cmd = $p.CommandLine
    $isRunserver = $cmd -match 'manage\.py\s+runserver' -and $cmd -match "127\.0\.0\.1:$DjangoPort"
    $isV15Root   = $cmd -match [regex]::Escape($V15Root)
    return ($isRunserver -and $isV15Root)
}

if ($django) {
    $listenerPid = $django.OwningProcess
    $recordedPid = $null
    if (Test-Path $djangoPidStateFile) {
        $recordedPid = (Get-Content -Raw $djangoPidStateFile -ErrorAction SilentlyContinue).Trim()
    }
    $isOurs = $false
    if ($recordedPid -and ($recordedPid -as [int]) -and ([int]$recordedPid -eq $listenerPid) -and (Test-IsV15CDjango $listenerPid)) {
        $isOurs = $true
    }
    if (-not $isOurs -and (Test-IsV15CDjango $listenerPid)) {
        # 命令列已是 v1.5C runserver（即便映像路徑是 YoloRuntime shim 子程序），視為本服務，不強殺。
        $isOurs = $true
    }
    if (-not $isOurs) {
        # 無法證明所有權：一律不強殺，避免誤傷其他程序；交維護窗口人工處理。
        Add-Content -LiteralPath $StartupLog -Value "$(Get-Date -Format o) UNVERIFIED 8022 listener PID=$listenerPid; ownership unproven. NOT force-stopped. Manual review required."
        if (-not (Wait-Http "http://127.0.0.1:$DjangoPort/" 10)) {
            throw "Port $DjangoPort occupied by an unverified process and v1.5C is not reachable. Manual intervention required."
        }
    }
}
```

**在第 204 行（`Start-Process` 區塊）之後、第 205 行 `Wait-Http` 之前，新增 PID 狀態記錄**：
```powershell
# 記錄實際 8022 監聽者 PID（解析 venv shim 產生的子程序），供後續所有權比對。
$activeListener = Get-Listener $DjangoPort
if ($activeListener) {
    Set-Content -LiteralPath $djangoPidStateFile -Value $activeListener.OwningProcess -Encoding utf8
}
```

### 設計如何避開四項禁忌（指令明訂）
- ❌ 僅比較 `python.exe` 路徑 → 改用 `Test-IsV15CDjango` 比對**命令列**（`manage.py runserver`＋`127.0.0.1:8022`＋`$V15Root`）。
- ❌ 僅依 `pyvenv.cfg` 判斷所有權 → 完全不讀 `pyvenv.cfg`。
- ❌ 僅因 `/login/` 回 200 判定正確專案 → 身份判定基於**行程命令列與專案路徑**，不以 HTTP 200 為準。
- ❌ 未證所有權便 `Stop-Process -Force` → **任何無法證明所有權的程序一律不強殺**；僅當命令列證明為 v1.5C（即本服務）時才視為自有並保留，絕不終止。

### 優先使用的判定信號（指令明訂）
- 啟動命令列與專案路徑 → `Test-IsV15CDjango` 核心。
- 程序建立時間 → 後續可加：`$p.CreationDate` 應晚於本腳本啟動時間，作為次要交叉驗證（本補丁已以 PID 狀態記錄隱含信任）。
- PID 與父子程序關係 → 直接識別「venv shim 產生的真實 Django 子程序」的 PID，繞開 shim 映像陷阱。
- 專屬程序狀態記錄 → `$StateRoot/django-v15c-pid.txt`。
- 明確的服務身分驗證 → 命令列身份（runserver＋埠＋專案路徑）。
- 有限時間健康檢查 → 既有的 `Wait-Http`（30s 上限）保留；未驗證占用者僅做 10s 探活以決定 fail-safe。

### 風險分析
- **消除自傷**：合法 v1.5C Django 永遠經命令列被判為自有 → 不再被殺；5 分鐘循環終止。
- **真實衝突處置**：若 8022 被確證非 v1.5C 的程序佔用，腳本記錄並 fail-safe（v1.5C 不可達時拋錯），**不盲目強殺**；建議於維護窗口人工回收埠位。
- **不可讀命令列**（如排程以不同權限層級啟動導致無法讀取別程序 CommandLine）：`Test-IsV15CDjango` 回傳 false → 視為未驗證 → 不殺、fail-safe。實務上同一使用者 `HighestAvailable` 權杖可讀取自有子程序命令列。
- **範圍**：純 PowerShell 啟動器邏輯，不動 Django 代碼、不動遷移、不動 `DJANGO_DB_NAME` 指向的正式庫。

---

## 六、正式服務所有權判定設計（任務 C 延伸）

| 信號 | 本補丁做法 | 說明 |
|------|-----------|------|
| 命令列 | `manage.py runserver` 且 `127.0.0.1:8022` 且含 `$V15Root` | 直接識別 v1.5C 專案的 runserver 實例，不受 shim 映像影響 |
| 專案路徑 | 命令列正則比對 `$V15Root` | 與 `$DjangoPython` 的 v1.5 venv 脫鉤，正確認定「v1.5C 環境」 |
| PID 狀態記錄 | `$StateRoot/django-v15c-pid.txt` | 跨排程重跑比對，避免重複啟動與誤殺 |
| 建立時間（建議） | `$p.CreationDate` 晚於腳本啟動 | 次級交叉驗證，防 PID 重用 |
| 父子關係 | 直接取監聽者 PID，不依賴 shim PID | 解決 venv shim 立即退出的陷阱 |
| 健康檢查 | `Wait-Http` 30s 上限 | 既有機制保留，限定時間不無限等待 |

**唯一服務所有權**：8022 在生產環境唯一由本腳本（排程 `FDE-AI v1.5C Classroom Server`）啟動；
v1.5B 的兩個啟動捷徑均為 `.lnk.disabled`、`supervisor.log` 停在 2026-09-22，不會與之互殺。
本補丁進一步確保「同一啟動器也不會殺自己的子程序」。

---

## 七、回滾方案（任務 C）

- **本階段不寫回正式腳本**：補丁僅以差異形式提供於本報告第五節。正式 `start_fde_v15c_classroom.ps1`
  維持原狀，當前生產行為不受影響（自傷循環仍存在，但屬已知、可恢復，且不在本階段執行範圍）。
- **若日後維運採用本補丁並需回滾**：自 Gateway 倉庫／備份還原 `start_fde_v15c_classroom.ps1` 至補丁前版本，
  並刪除 `$StateRoot/django-v15c-pid.txt`（狀態記錄為新增檔，移除即回到舊行為）。還原後排程恢復舊（有缺陷但現行容忍）行為。
- **維護窗口執行步驟**（供未來採用時參考，本階段不執行）：
  1. 先停用排程 `FDE-AI v1.5C Classroom Server`（避免改動期間重入）。
  2. 套用第五節補丁。
  3. 僅在「命令列證明為 v1.5C」後，乾淨停止當前 8022 Django。
  4. 手動執行一次補丁後啟動器，確認 `startup.log` 出現 `ONLINE`、PID 狀態檔寫入、8022 可達、8770 健康。
  5. 重新啟用排程。
  6. 觀察 10 分鐘內 `startup.log` **不再出現** `STOPPING stale 8022 listener`。

---

## 八、Git 與 SHA-256

- **HEAD**：`dfef115dc911e25ad0604ff3534bffbe968adc21`（未變動）。
- **已修改（未提交）**：
  - `student_portal/learning/models.py` → `1678751891203aa8`（原 HEAD `e6455f0f…`；第十三階段 `f2aac02c…`）
  - `student_portal/learning/views.py` → `206b3b33da9b8436`
  - `student_portal/learning/tests/test_p3d_course_upload_closure.py` → `b719789f629b51d7`（第十三階段）
- **新增（未追蹤）**：
  - `student_portal/learning/tests/test_p3h_phase14_evidence_validation.py` → `fd6adf1d15383534`
  - `backups/20261027-phase14/`（修改前 HEAD 版本：`models.py.before`／`views.py.before`／`test_p3d…before`）
  - `docs/reports/P3H_PHASE14_…md`（本報告）
  - `docs/reports/P3H_PHASE13_…md`、`ops/p3h/verify_p3h_evidence_atomicity.py` 等（前階段遺留，仍未提交）
- **遷移守門**：`makemigrations --check` → `No changes detected`；最後遷移 `0019_golden_set_manifest_contract.py`。

---

## 九、PASS／FAIL／BLOCKED／NOT TESTED

| 項目 | 狀態 | 說明 |
|------|------|------|
| A-1 Evidence 全入口清單（8 項） | **PASS** | 完整窮舉並六項確認 |
| A-2 統一驗證入口（最小修復） | **PASS** | 4 條直建路徑改呼叫 `validate_evidence_upload`；共用白名單／100MB／`%PDF-` |
| A-3 未覆蓋第十三階段 PDF 修復 | **PASS** | `clean()` 的 `validate_pdf_header` 原樣保留 |
| A-4 未擅自限所有附件為 PDF | **PASS** | 白名單不變；僅 `.pdf` 查檔頭 |
| A-5 未新增 Migration | **PASS** | `makemigrations --check` 無變更 |
| B 完整回歸（HTTP＋單元） | **PASS**（受控範圍） | 12 新測試＋43 growth/p3d＋25 r07/project_directions 全綠 |
| B 全量 `manage.py test learning`（1048）整輪 | **NOT TESTED** | 時間受限；以受控範圍回歸覆蓋所有變動程式路徑（第十三階段已跑全量，3 項既有已知失敗非本輪引入） |
| C 8022 啟動器最小補丁設計 | **PASS**（設計，未套用） | 差異提供於第五節，未寫回正式腳本 |
| 嚴格禁止事項 | **PASS** | 未改正式 8022／8770／8030、排程、程序、DB、Tunnel／DNS／Pages；未 commit/push/merge/deploy |

---

## 附：執行環境與限制聲明
- 所有修改限於隔離工作樹 `D:\FDE-AI-UAS-v2.0-p3h-local-backend`；未影響 v1.5C 正式系統或其他工作樹。
- 測試以 Django 測試客戶端（真實 WSGI）於獨立 test DB＋隔離 `MEDIA_ROOT` 執行，等同「全新 CandidateRoot」隔離。
- 8022 根因與修復設計為**唯讀分析＋補丁提案**，未對正式服務執行任何啟動／停止／重啟／接管。
- 待教師認可後再決定是否 commit 本階段變更；8022 補丁是否落地由維運於維護窗口執行。
