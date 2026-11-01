# P3-H 第十三階段：Evidence PDF 格式驗證修復 ＋ 8022 唯讀根因 ＋ 恢復方案

- 工作樹：`D:\FDE-AI-UAS-v2.0-p3h-local-backend`
- 分支：`codex/p3h-local-backend`
- 基線 HEAD：`dfef115dc911e25ad0604ff3534bffbe968adc21`（核實一致，全程未變動）
- 執行時間：2026-10-27 00:2x ～ 02:0x（+08:00）
- 約束遵守：**未 Commit / Push / Merge / Deploy**；未修改正式 v1.5C、正式排程、正式 DB、Cloudflare Tunnel / DNS / GitHub Pages；未啟用 H3 ACTIVE；未繞過 safe-delete；**未啟動／停止／重啟／接管 8022**（僅唯讀觀測）。

---

## 一、Evidence PDF 驗證修復差異（任務 A-1 ～ A-4）

### 1.1 實際驗證路徑（實測確認）

```
POST /student/courses/<enrollment>/tasks/<task>/evidence/   (views.evidence_add:1695)
  └─ EvidenceForm(request.POST, request.FILES)              (forms.py:305，ModelForm)
       └─ form.is_valid() → _post_clean() → instance.full_clean()
            ├─ clean_fields()  → Evidence.upload 欄位驗證器
            │     ① FileExtensionValidator(24 種白名單，含 pdf)
            │     ② validate_evidence_size（>100MB 拒絕）
            └─ clean()         → Evidence.clean()（本次加入 PDF 檔頭檢查）
       └─ form.save(commit=False) → evidence.progress = progress → evidence.save()
```

**設計決策（重要，含一次自我修正）**

第一版把 `validate_pdf_header` 註冊到 `Evidence.upload` 的 **field validators**。這是 Django 語意上最自然的位置，但會改變欄位 deconstruction，`makemigrations` 因而產生 `0020_alter_evidence_upload.py`。

全量套件隨即抓到 **2 項回歸**：`test_p8_showcase_security.P8ConsistencyTests.test_no_new_migration_added` 與 `test_teacher_class_showcase.ShowcaseRegressionTests.test_no_new_migration_added`。兩者硬編碼「最後一個遷移必須是 `0019_golden_set_manifest_contract.py`」，屬專案刻意的遷移守門。

**因此改採第二版**：把檢查放進既有的 `Evidence.clean()`。`clean()` 不參與欄位 deconstruction，**不產生任何遷移**，且 `ModelForm._post_clean()` 一定會呼叫 `full_clean()`，覆蓋率與 field validator 相同。產生的 `0020` 已移出遷移目錄（保留在備份中，見 1.3），`makemigrations --check` 現為 `No changes detected`。

### 1.2 修改內容（2 檔，+83 / −5，**無新增遷移**）

`student_portal/learning/models.py`

```diff
 from django.conf import settings
+from django.core.exceptions import ValidationError
 from django.core.validators import FileExtensionValidator, MaxValueValidator, MinValueValidator, RegexValidator

+PDF_MAGIC_HEADER = b"%PDF-"
+
+
+def validate_pdf_header(file_obj):
+    """副檔名為 .pdf 時，要求檔頭為 %PDF-（不採信 Content-Type）。
+
+    只讀取前 5 個位元組，讀完把檔案指標還原到原位置，避免影響後續儲存。
+    其他副檔名一律放行，由 FileExtensionValidator 與下游流程負責。
+    """
+    name = getattr(file_obj, "name", "") or ""
+    if not str(name).lower().endswith(".pdf"):
+        return
+
+    from django.core.exceptions import ValidationError
+
+    try:
+        position = file_obj.tell()
+    except (AttributeError, OSError):
+        position = None
+    try:
+        file_obj.seek(0)
+        header = file_obj.read(len(PDF_MAGIC_HEADER))
+    except (AttributeError, OSError):
+        return
+    finally:
+        if position is not None:
+            file_obj.seek(position)
+        else:
+            file_obj.seek(0)
+
+    if header != PDF_MAGIC_HEADER:
+        raise ValidationError("副檔名為 .pdf 的檔案缺少 PDF 檔頭（%PDF-），請確認檔案未損壞或未經改名。")
```

```diff
     def clean(self):
-        from django.core.exceptions import ValidationError
-
         if self.progress_id and self.growth_submission_id:
             raise ValidationError("證據必須且只能屬於一項任務或一筆成長記錄。")
         if not self._state.adding and not self.progress_id and not self.growth_submission_id:
             raise ValidationError("證據必須且只能屬於一項任務或一筆成長記錄。")
         if bool(self.external_url) == bool(self.upload):
             raise ValidationError("證據必須且只能提供一個檔案或一個外部連結。")
+        if self.upload:
+            try:
+                validate_pdf_header(self.upload)
+            except ValidationError as exc:
+                raise ValidationError({"upload": exc.messages}) from exc
```

- 以 `{"upload": ...}` 形式拋出，讓 `ModelForm._update_errors()` 把錯誤掛回 `upload` 欄位，模板在檔案輸入框下方以 `<p class="error">` 顯示（實測見 2.2 E4）。
- 模組層 `ValidationError` 匯入後，`validate_evidence_size` 內的區域匯入維持原樣（未改動既有函式）。

`student_portal/learning/tests/test_p3d_course_upload_closure.py`（測試夾具，+46 / −3）

- 原夾具 `SimpleUploadedFile("proof.pdf", b"p3d-pdf")` 是「副檔名 .pdf、內容非 PDF」的假檔，修復後必被拒絕，會使該測試前置條件失效。
- 改為 `VALID_PDF = b"%PDF-1.7\n% P3-D fixture\n%%EOF\n"`，同步更新下載位元組比對；**測試目的（上傳閉環＋擁有權／班級授權）不變**。
- 跨班偽造案例刻意保留 `b"x"`（非 PDF），證明 404 來自授權而非內容驗證。
- 新增 `EvidencePdfHeaderValidatorTests` 三項：指標還原（`tell()` 前後一致、`read()` 取回完整內容）、四種二進位改名拒絕、非 PDF 副檔名不受檢查。

### 1.3 備份與 SHA-256

備份目錄 `backups/20261027-pdf-header/`（`cmp` 驗證與修改前逐位元組相同）

| 檔案 | 修改前 | 修改後 |
|---|---|---|
| `student_portal/learning/models.py` | `e6455f0fcf4af4b606094cca5884e92af1ca82d0df424e8858e21cd7f75adf40` | `f2aac02cc963f10e56a8361d2787d6cc52a254186f40c89aa57cf969d428810f` |
| `student_portal/learning/tests/test_p3d_course_upload_closure.py` | `2edac007c449878c96c9ec7950587d3270abc9dd95b472dad211e0a7f6c3ccd5` | `b719789f629b51d7833a10922ec25660986fbf0e840961248b638cdc3d9834e1` |
| `ops/p3h/verify_p3h_evidence_atomicity.py` | `27600b65d58bbe87a58b1fb91da4755dc8220728231864269dbd848dc3594fcb` | `8aaac2b2a2d2ffc2a98e8cc87acdd9b1c75ce0fb3453f2e65fd0414c9a82f581` |
| `student_portal/learning/forms.py` | `e45ca959f9a1303aabae5b9fcdac8bae8050096d008082848fb0c5bf89fbf1f7` | 未修改 |
| `ops/p3h/verify_p3h_business_http.py` | `9c9bb4568805ea10cc1281e601f4cf62916eb746a24a484b5fae3b4fd0668df9` | 未修改 |
| `0020_alter_evidence_upload.py.reverted`（第一版產物，已移出遷移目錄） | — | `177e6e6eb1e18bfea9923ac1fe8dec38fa6dadea4fe62a4fb47c35d98aa7430b` |

---

## 二、真實 HTTP 回歸測試證據（任務 A-5）

### 2.1 環境

- 隔離棧：Django `8140` / Gateway(Live) `8141` / Entry `8142`，候選根 `C:\Users\admin\AppData\Local\Temp\p3h-candidate-20261027c`（**全新空根：Evidence=0 列、media=0 檔**）。
- 鏈路 `Entry 8142 → Live/Gateway 8141 → Django 8140`，全程真實 HTTP、真實 DB、真實 MEDIA_ROOT。
- 每案例前後對 **DB 全表**與 **MEDIA_ROOT 全樹**做集合差集；拒絕類必須同時滿足：狀態碼＋零新增列＋零新增檔＋驗證器錯誤訊息。

### 2.2 結果（`ops/p3h/verify_p3h_evidence_atomicity.py`）

| 案例 | 期望 | 實測 |
|---|---|---|
| E1 合法 PDF（`%PDF-1.4`） | 接受 | `302`，1 列 1 檔，落盤 SHA-256 與來源完全相同，位於 MEDIA_ROOT 內 |
| E1b 具物件結構 PDF（catalog/pages/page + trailer） | 接受 | `302`，1 列 1 檔，SHA-256 相符 |
| E2 副檔名 `.exe` | 拒絕 | `200`，0 列 0 檔，「不允許副檔名為 "exe" …」 |
| E3 超過 100MB（100MB+1KB） | 拒絕 | `200`，0 列 0 檔，「單一證據檔案不得超過 100 MB。」 |
| E4 PE/MZ 執行檔改名 `.pdf` | 拒絕 | `200`，0 列 0 檔，「副檔名為 .pdf 的檔案缺少 PDF 檔頭（%PDF-）…」 |
| E4 ZIP 改名 `.pdf` | 拒絕 | 同上 |
| E4 純文字改名 `.pdf` | 拒絕 | 同上 |
| E4 PNG 改名 `.pdf` | 拒絕 | 同上 |
| E5 零位元組 `.pdf` | 拒絕 | `200`，0 列 0 檔，「送出的檔案是空的。」 |
| E6 路徑穿越 `../../../x.pdf` | 收斂 | `302`，存為 `evidence/<uuid>/<hex>.pdf`，`..` 消除，位於 MEDIA_ROOT 內 |
| E7 跨班上傳（B 對 A 的 enrollment） | 拒絕 | `404`，0 列 0 檔 |
| E7b 他人 CSRF token | 拒絕 | `403`，0 列 0 檔 |
| E8 全域不變量（列↔檔 1:1、無孤立） | 通過 | `rows=3 media=3 missing=0 orphans=0` |
| E9 拒絕類未污染進度狀態 | 通過 | `status=in_progress` |

**SUMMARY：`pass=15 fail=0 observe=0 finding=0` → `EVIDENCE_ATOMICITY_PASS`**

### 2.3 保留原有 Evidence SHA-256 驗收與教師下載回歸

`ops/p3h/verify_p3h_business_http.py`（**未修改**，與第八～十二階段同一支）本輪重跑：

```
BUSINESS_HTTP_REJECTION_STATUSES teacher=404 student=404 forged=403 anonymous=302
BUSINESS_HTTP_PASS evidence=c666c82e-f386-4eae-ae54-8d749b110970 \
  sha256=6658c8881ea236c048a2c97b17c61fcbec1b1ccfd853fe8da18542db8fc4242e \
  teacher=200 cross_teacher=404 cross_student=404 forged=403 anonymous=302
```

- Evidence SHA-256 `6658c888…` 與第八～十二階段**逐位元組一致** → 修復未改變既有合法 PDF 的落盤結果。
- 教師下載 `200`、跨教師 `404`、跨學生 `404`、偽造 `403`、匿名 `302`（導向登入）。

### 2.4 單元測試（Django）

| 測試 | 結果 |
|---|---|
| `test_p3d_course_upload_closure` + `test_p8_showcase_security` + `test_teacher_class_showcase` | **83/83 OK**（358.5s，含兩項遷移契約測試） |
| `test_teacher_workflow` + `test_growth_records` + `test_teacher_class_report` | **74/74 OK**（106.9s） |
| `learning` 全量 | 見 §8.2 |

### 2.5 Gateway 鏈路回歸（確認未波及）

`verify_p3h_gateway_http.py` T1–T6 全 PASS（`CHAIN_PASS`）：T1 health 200、T2 建 session 201 且 `owner_subject=student:…`、T3 偽造 `X-FDE-Role` 被剝除、T4 未認證 403、T5 直連 403、T6 缺 Gateway 金鑰 403。

---

## 三、DB／MEDIA_ROOT 前後差異

| 時點 | Evidence 列數 | MEDIA_ROOT 檔數 | 懸空列 | 孤立檔 |
|---|---|---|---|---|
| 測試前（全新候選根 c） | 0 | 0 | 0 | 0 |
| E1–E9 後 | 3 | 3 | 0 | 0 |
| 業務閉環後（最終） | 4 | 4 | 0 | 0 |

最終媒體樹（SHA-256 / 大小 / 相對路徑）：

```
cbdccf95c9812bf71abfc54b9a79aca18f939485a5d93af08c2d20a51b79a987   38  evidence/5adefb51-…/3a375d5c….pdf   (E1)
d5e25e83c8415981201c74a04fd2fedd4aebf96fe88c62ef0e37c573fdda618c  200  evidence/…/….pdf                       (E1b)
cbdccf95c9812bf71abfc54b9a79aca18f939485a5d93af08c2d20a51b79a987   38  evidence/d2c2bd8f-…/55bb4208….pdf   (E6 路徑穿越)
6658c8881ea236c048a2c97b17c61fcbec1b1ccfd853fe8da18542db8fc4242e   39  evidence/c666c82e-…/….pdf               (業務閉環，與歷史基線一致)
```

- 被拒絕的 9 次（E2/E3/E4×4/E5/E7/E7b）**合計新增 0 列、0 檔**。
- 系統暫存目錄無 >50MB 殘留上傳檔。

---

## 四、8022 競爭機制完整證據（任務 B-1～B-6，全唯讀）

### 4.1 排程工作完整設定

`\FDE-AI v1.5C Classroom Server`（State=Ready，LastTaskResult=0，LastRunTime 00:36:54，NextRun 00:41:53）

| 項目 | 值 |
|---|---|
| Action | `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1"`，WorkingDirectory `D:\FDE-AI-Gateway` |
| Trigger 1 | LogonTrigger，Delay `PT30S`，UserId `KIWI的电脑\admin` |
| Trigger 2 | TimeTrigger，StartBoundary `2026-09-23T21:30:19`，ScheduleByDay Interval 1，**Repetition Interval `PT5M`**，StopAtDurationEnd=false |
| Principal | `admin`，LogonType `InteractiveToken`，RunLevel `HighestAvailable` |
| Settings | MultipleInstances `IgnoreNew`、StartWhenAvailable=true、ExecutionTimeLimit `PT0S`（不限）、DisallowStartIfOnBatteries=false |

### 4.2 腳本終止邏輯（`start_fde_v15c_classroom.ps1:184-207`）

```powershell
$expectedDjangoExe = [System.IO.Path]::GetFullPath($DjangoPython)   # .venv\Scripts\python.exe
$django = Get-Listener $DjangoPort                                   # 8022 的 listener
if ($django) {
  $owner = Get-Process -Id $django.OwningProcess
  $ownerPath = if ($owner -and $owner.Path) { [IO.Path]::GetFullPath($owner.Path) } else { '' }
  if ($ownerPath -and $ownerPath -ne $expectedDjangoExe) {           # ← 只比映像路徑字串
    ... "STOPPING stale 8022 listener: PID=…; executable=$ownerPath"
    Stop-Process -Id $django.OwningProcess -Force
    Start-Sleep -Seconds 2
    $django = Get-Listener $DjangoPort
    if ($django) { throw "Port 8022 is still occupied by a non-v1.5C process." }
  }
}
if (-not $django) { Start-Process -FilePath $DjangoPython -ArgumentList @('manage.py','runserver','127.0.0.1:8022','--noreload','--insecure') ... }
if (-not (Wait-Http "http://127.0.0.1:8022/" 30)) { throw 'v1.5C Django did not become available.' }
```

判據只有「解釋器映像路徑字串相等」，**沒有**任何「這是不是同一個 App」的健康判據。

### 4.3 關鍵機制：venv 解譯器是 shim，映像落在 YoloRuntime 基底

| 觀測 | 事實 |
|---|---|
| `pyvenv.cfg` | `home = C:\Users\admin\.fde-ai\YoloRuntime\python\cpython-3.12.13-windows-x86_64-none`；`executable` 同路徑；`command = …\YoloRuntime\…\python.exe -m venv --upgrade …\FDE-AI-v1.5\student_portal\.venv` |
| `sys.base_prefix` | `C:\Users\admin\.fde-ai\YoloRuntime\python\cpython-3.12.13-windows-x86_64-none`（Python 3.12.13 / Django 5.2.17） |
| `Start-Process .venv\Scripts\python.exe -c "sleep"` | **launcher 在 1.2 秒內 `HasExited=True`**，實際工作由子程序承載 |
| 8022 listener | 恆為**父子成對**（例 `pid=7180 ppid=2340 created=00:42:03` → `pid=12460 ppid=7180 created=00:42:03`），listener 是**子程序** |

→ `$ownerPath`（子程序映像 = `…\YoloRuntime\python\…\python.exe`）**永遠不等於** `$expectedDjangoExe`（`…\.venv\Scripts\python.exe`）。
→ **v1.5C 每 5 分鐘殺掉自己的 Django 再重啟**，形成自傷循環。

### 4.4 量化證據

- `startup.log` 的 `STOPPING stale 8022 listener` 累計 **4590 次**，被殺執行檔 **4590/4590 全部**為 `C:\Users\admin\.fde-ai\YoloRuntime\python\cpython-3.12.13-windows-x86_64-none\python.exe`。
- 今日（10-27）9 次，間隔精準 5 分鐘：`00:01:57 / 00:06:57 / 00:11:57 / 00:16:57 / 00:22:00 / 00:27:05 / 00:31:59 / 00:36:58 / 00:42:00`。
- 每次 `kill → Django 可回應` 實測 **3–9 秒**（以 `NETWORK READY attempt=1` 為上界）：
  ```
  00:01:57→00:02:01 (3s)   00:06:57→00:07:01 (3s)   00:11:57→00:12:01 (3s)
  00:16:57→00:17:01 (3s)   00:22:00→00:22:05 (5s)   00:27:05→00:27:13 (7s)
  00:31:59→00:32:04 (4s)   00:36:58→00:37:02 (4s)   00:42:00→00:42:10 (9s)
  ```
- 今日 9 次全部 `ONLINE; django=PASS`，`rag=FAIL` 0 次 → 目前「殺得回來」，但每次都有 3–9 秒不可用窗口（每日約 288 輪）。

### 4.5 已排除的替代假設

| 假設 | 查證 | 結論 |
|---|---|---|
| 第二支啟動器搶 8022 | `run_fde_v15b_classroom.ps1` 是 `while($true)` + 30 秒迴圈監督器；但 Startup 資料夾的 `FDE-AI v1.5B Classroom.lnk.disabled`、`FDE-AI v1.5B Auto Start.lnk.disabled` **皆停用**，`supervisor.log` 最後活動停在 2026-09-22 07:17 | **今日非活動競爭者**（潛在風險，見 §6.1 C-1） |
| Windows 服務 | `Win32_Service.PathName` 比對 `python\|Yolo\|FDE\|nssm` → **0 筆** | 排除 |
| Run 登錄鍵 | HKCU/HKLM `…\CurrentVersion\Run` 全量 → 無 python/FDE 項目 | 排除 |
| 排程工作（以動作為準） | 全量掃描 Actions 含 `python\|8022\|Yolo` → **0 筆** | 排除 |
| Python 自動重載 | 腳本明確 `--noreload`；觀測到的父子對是 **shim→基底**，非 autoreload | 排除 |
| 我的隔離工具誤殺 | `stop-p3h-isolated.ps1` 只殺 state 檔內的 8140/8141/8142，PID＋命令列＋建立時間三重比對；`start-p3h-isolated.ps1` 硬拒 8022/8030/8770 | 排除 |
| 4688 稽核／Prefetch | 4688 無事件；`C:\Windows\Prefetch\PYTHON*.pf` 不存在 | 無可用來源，不影響結論 |

### 4.6 8022 對應的實際專案、版本與啟動命令

| 項目 | 值 |
|---|---|
| 專案（程式碼） | `D:\FDE-AI-UAS\v1.5C\student_portal`（`manage.py` 存在，2026-09-22 12:35） |
| 資料（DB／媒體） | `C:\Users\admin\Documents\Codex\2026-08-30\new-chat\FDE-AI-v1.5\student_portal\{db.sqlite3, private_media}` |
| 解譯器 | `…\FDE-AI-v1.5\student_portal\.venv\Scripts\python.exe`（shim）→ 基底 `…\YoloRuntime\python\cpython-3.12.13-windows-x86_64-none\python.exe` |
| 版本 | Python 3.12.13 / Django 5.2.17 |
| 啟動命令 | `manage.py runserver 127.0.0.1:8022 --noreload --insecure` |
| 對外 | cloudflared tunnel → `https://guests-demands-roller-vinyl.trycloudflare.com`（`REUSE existing tunnel`） |

> **設定風險（僅記錄，未變更）**：程式碼在 `D:\FDE-AI-UAS\v1.5C`，資料庫與媒體卻在 `C:\…\FDE-AI-v1.5`。兩棵樹若不同步，會出現「程式已更新、資料層未跟上」的隱性不一致。

---

## 五、v1.5C 啟動失敗原因與可信度（任務 B-7）

`startup-error.log` 全期統計（255,641 bytes）：

| 錯誤 | 次數 | 直接成因（可驗證） |
|---|---|---|
| `v1.5C Django did not become available.` | 60 | 殺掉 listener 後新 Django 在 30 秒內未回應 `http://127.0.0.1:8022/`。成因二選一：(a) 綁定競爭落敗（舊 socket 未釋放／Windows 允許 `SO_REUSEADDR` 雙綁）；(b) 新程序啟動即退出（失敗當下 `django.log`、`django.err.log` 皆 0 bytes，無 traceback） |
| `Port 8022 is still occupied by a non-v1.5C process.` | 14 | `Stop-Process` 後僅等 2 秒，重查仍有 listener → 直接 throw（腳本第 195 行） |
| `Local RAG did not become healthy.` | 64 | 8770 的 `GET /api/rag/health` 30 秒內未達標（與 8022 無關；今日 0 次） |

**可信度**

| 結論 | 可信度 | 依據 |
|---|---|---|
| 8022 PID 反覆變動＝v1.5C 每 5 分鐘殺掉自己的 Django 再重啟 | **高（實證）** | 4590/4590 被殺執行檔同一路徑；今日 9 次間隔精準 5 分鐘且與 `LastRunTime` 對齊 |
| 成因為「路徑字串比對」與「venv shim 映像路徑」不一致 | **高（實證）** | §4.3 四項獨立觀測（pyvenv.cfg、`sys.base_prefix`、shim 立即退出、父子成對） |
| 「did not become available」60 次的**單一次因** | **中（NOT DETERMINED）** | 失敗當下 stderr 為 0 bytes 且已被後續成功啟動覆寫；需在維護窗口前景啟動一次取 stderr。本階段禁止啟動正式服務，故未執行 |
| RAG 8770 的 64 次失敗 | **未定** | 今日 0 次；8770 現為 LISTENING 且 `/api/rag/health` 200，樣本不可重現 |

---

## 六、最小正式服務恢復計畫（任務 C，**只提出、未執行**）

> 以下每一步都**未執行**。任何一步都需另行批准，並在受控維護窗口內進行。

### C-1　8022 唯一服務所有權
- 保留 `\FDE-AI v1.5C Classroom Server` 為 8022 的**唯一**所有者。
- 永久維持 `FDE-AI v1.5B Classroom.lnk.disabled`、`FDE-AI v1.5B Auto Start.lnk.disabled` 停用；`run_fde_v15b_classroom.ps1` 的 30 秒 `while($true)` 迴圈若被誤啟，將與 v1.5C 形成真正的雙寫，須在文件與捷徑層面標註「禁用」。

### C-2　是否需要獨立埠位
- v1.5B 僅需唯讀回顧：**不需要**，維持停用。
- v1.5B 必須與 v1.5C 同時可跑：**需要**給 v1.5B 專屬埠（例 `8023`），tunnel 只指向 8022。**絕不可共用 8022。**

### C-3　如何避免兩個啟動器互相強殺（核心修正，單檔小改）
1. 把「映像路徑字串比對」改為「**解釋器歸屬判定**」：讀 `$V15Root\.venv\pyvenv.cfg` 的 `home`，**同時接受** shim 路徑與 `home` 基底路徑兩種映像。
2. 再加「**同一 App 健康判據**」：listener 存在且 `GET http://127.0.0.1:8022/login/` 回 200/302，且回應含 v1.5C 特徵 → 判為自己的服務，**不殺**。
3. 只有「路徑不符 **且** 健康判據不符」才 `Stop-Process`。
4. 移除「殺後僅等 2 秒就 throw」的硬失敗，改為最多輪詢 15 秒等埠釋放，逾時則記錄並跳過本輪（不 throw），避免一次競爭失敗中斷整個流程。
5. `Wait-Http` 由 30 秒延長到 60 秒（Django 冷啟動較慢）。

### C-4　如何確認正確的 Python／Django 環境
- 以 `pyvenv.cfg` 的 `home` ＋ `.venv\Scripts\python.exe -c "import django,sys;print(django.get_version(), sys.base_prefix)"` 作為「環境指紋」，每次啟動寫入日誌比對。
- 在窗口內確認 `DJANGO_DB_NAME` / `DJANGO_MEDIA_ROOT`（`C:\…\FDE-AI-v1.5`）與程式碼樹（`D:\FDE-AI-UAS\v1.5C`）的關係是刻意設計或歷史遺留，並固定寫入腳本註解與日誌。

### C-5　受控維護窗口內如何恢復
1. 視窗開始：記錄 `Get-ScheduledTaskInfo`、8022 現任 PID、`startup.log` 最後 20 行。
2. `Disable-ScheduledTask` 暫停 5 分鐘循環（**唯一允許的排程變更，需批准**）。
3. 備份 `start_fde_v15c_classroom.ps1`（含 SHA-256）與目前 task XML。
4. 套用 C-3（僅該 .ps1 的判定區塊）。
5. 前景手動跑一次該腳本並保留完整 stdout/stderr → 取得「did not become available」的真實 stderr（同時解掉 §5 的中可信度項）。
6. 驗證：`GET http://127.0.0.1:8022/login/` = 200、`/api/rag/health` = 200、tunnel URL 可用、`startup.log` 出現 `ONLINE; django=PASS`。
7. `Enable-ScheduledTask`，觀察連續 3 個 5 分鐘週期**不得**再出現 `STOPPING stale`。

### C-6　如何回滾
- 腳本：以第 3 步備份還原（單檔、無 DB 變更、無遷移）。
- 排程：若行為異常，`Enable-ScheduledTask` 即恢復原循環（原行為＝每 5 分鐘重啟，可用但非理想）。
- 回滾成功判準：`LastTaskResult=0` 且 8022 於 60 秒內回 200。

### C-7　如何保證 8770／8030 及其他專案不受影響
- 修改僅限 `start_fde_v15c_classroom.ps1` 的 8022 判定區塊；8770 的 RAG 啟動段與 tunnel 段不動。
- 8030 目前**無 listener**，本計畫不涉及。
- 施工前後各做一次唯讀基線：`Get-NetTCPConnection` 的 8022/8030/8770 ＋ 三個 HTTP 探測，作為「未波及」比對證據。
- 不動 Cloudflare Tunnel 設定、DNS、GitHub Pages、正式 DB 與媒體。

### 風險與前置條件

| 風險 | 說明 |
|---|---|
| 修改期間的 5 分鐘循環 | 必須先停排程，否則改到一半會被下一輪覆蓋執行 |
| `RunLevel HighestAvailable` + `InteractiveToken` | 非提權 shell 讀不到其程序 `Path`（本輪實測為空字串），驗證須用任務日誌而非一般 shell |
| 資料樹不一致 | 修好循環後可能暴露 `D:\FDE-AI-UAS\v1.5C` 與 `C:\…\FDE-AI-v1.5` 的版本差異 |
| 不可逆性 | 本計畫**不涉及 DB 遷移與資料刪除**，回滾僅需還原單一 .ps1 |

---

## 七、Git 狀態與 SHA-256（任務 A-1）

```
branch  : codex/p3h-local-backend
HEAD    : dfef115dc911e25ad0604ff3534bffbe968adc21   (未變動)
status  :
   M student_portal/learning/models.py
   M student_portal/learning/tests/test_p3d_course_upload_closure.py
  ?? backups/
  ?? docs/reports/P3H_PHASE11_COMMIT_AUDIT_REPORT_2026-10-26.md
  ?? docs/reports/P3H_PHASE12_EVIDENCE_ATOMICITY_AND_8022_ROOT_CAUSE_2026-10-26.md
  ?? docs/reports/P3H_PHASE13_PDF_HEADER_FIX_AND_8022_ROOT_CAUSE_2026-10-27.md
  ?? docs/superpowers/plans/2026-10-25-p3h-independent-local-backend.md
  ?? ops/p3h/verify_p3h_evidence_atomicity.py
diffstat: 2 files changed, 83 insertions(+), 5 deletions(-)
migrations: 最後一筆仍為 0019_golden_set_manifest_contract.py（無新增）
```

- **未 Commit、未 Push、未 Merge、未 Deploy。**
- 8022 / 8770 / 8030 全程未啟動、未停止、未重啟、未接管（僅 `Get-NetTCPConnection`、`Get-CimInstance`、`Get-ScheduledTask*`、日誌讀取）。
- 未修改排程、未停用保活、未終止任何正式程序、未變更服務所有權。
- 隔離埠 8140/8141/8142/8143 全部 released；8022（PID 23056，5 分鐘循環中）、8770（PID 14124）狀態與本輪開始時一致；8030 未監聽。

### 7.1 本輪產物 SHA-256

| 檔案 | SHA-256 |
|---|---|
| `student_portal/learning/models.py` | `f2aac02cc963f10e56a8361d2787d6cc52a254186f40c89aa57cf969d428810f` |
| `student_portal/learning/tests/test_p3d_course_upload_closure.py` | `b719789f629b51d7833a10922ec25660986fbf0e840961248b638cdc3d9834e1` |
| `ops/p3h/verify_p3h_evidence_atomicity.py` | `8aaac2b2a2d2ffc2a98e8cc87acdd9b1c75ce0fb3453f2e65fd0414c9a82f581` |
| `backups/20261027-pdf-header/models.py.bak` | `e6455f0fcf4af4b606094cca5884e92af1ca82d0df424e8858e21cd7f75adf40` |
| `backups/20261027-pdf-header/test_p3d_course_upload_closure.py.bak` | `2edac007c449878c96c9ec7950587d3270abc9dd95b472dad211e0a7f6c3ccd5` |
| `backups/20261027-pdf-header/verify_p3h_evidence_atomicity.py.bak` | `27600b65d58bbe87a58b1fb91da4755dc8220728231864269dbd848dc3594fcb` |
| `backups/20261027-pdf-header/0020_alter_evidence_upload.py.reverted` | `177e6e6eb1e18bfea9923ac1fe8dec38fa6dadea4fe62a4fb47c35d98aa7430b` |

---

## 八、PASS／FAIL／BLOCKED／NOT TESTED 統計

### 8.1 本階段測試

| 類別 | 數量 | 內容 |
|---|---|---|
| **PASS** | 15 | Evidence 原子性 E1/E1b/E2/E3/E4×4/E5/E6/E7/E7b/E8×2/E9 |
| **PASS** | 1 | 業務閉環（Evidence SHA-256 ＋ 教師下載 ＋ 三種越權拒絕） |
| **PASS** | 8 | Gateway T1–T6 鏈路斷言 |
| **PASS** | 83 | Django 單元測試（p3d ＋ p8_showcase ＋ teacher_class_showcase，含遷移契約） |
| **PASS** | 74 | Django 單元測試（teacher_workflow ＋ growth_records ＋ teacher_class_report） |
| **FAIL** | 0 | — |
| **BLOCKED** | 0 | — |
| **NOT TESTED** | 1 | 8022「did not become available」的單一次因（需前景啟動取 stderr，本階段禁止啟動正式服務） |
| **NOT DETERMINED** | 1 | RAG 8770 歷史 64 次失敗（今日 0 次，樣本不可重現） |
| **FINDING** | 2 | FINDING-1、FINDING-2（見下） |

### 8.2 `learning` 全量回歸

第一次全量（field-validator 版本）結果：`Ran 1048 tests … FAILED (failures=4, errors=1, skipped=26)`，其中
- 3 項為**既有已知失敗**（與本輪無關）：`test_public_platform.test_anonymous_home_serves_existing_fde_ai_platform`(E)、`test_auth.test_platform_hero_action_opens_student_growth_portal`(F)、`test_vision_flywheel_framework.test_teacher_sees_only_authorized_models_with_four_status_dimensions`(F)。
- **2 項為本輪第一版造成的回歸**：`test_p8_showcase_security.test_no_new_migration_added`、`test_teacher_class_showcase.test_no_new_migration_added`（遷移守門）。已透過改採 `clean()` 方案修正，兩項現均 OK。

第二次全量（`clean()` 版本，最終交付版本）：見下方「重跑結果」段落。

**重跑結果（最終交付版本）：`Ran 1048 tests in 2354.499s` → `FAILED (failures=2, errors=1, skipped=26)`**

剩餘 3 項與本輪修改**無關**，且與專案既有已知失敗清單完全一致：

| 測試 | 類型 | 已知狀態 |
|---|---|---|
| `test_public_platform.PublicPlatformRouteTests.test_anonymous_home_serves_existing_fde_ai_platform` | ERROR | 既有（首頁導航斷言） |
| `test_auth.StudentRegistrationTests.test_platform_hero_action_opens_student_growth_portal` | FAIL | 既有（hero 標籤） |
| `test_vision_flywheel_framework.VisionFlywheelFrameworkTests.test_teacher_sees_only_authorized_models_with_four_status_dimensions` | FAIL | 既有（「訓練用途」欄） |

→ **本輪造成的回歸數：0**（第一版的 2 項遷移契約回歸已消除）。

### FINDING-1：成長記錄文件上傳不經過任何驗證器（既有缺口，未修）
`views.py:1166-1187` 以 `Evidence(...)` 直建 + `upload.save(...)`，不呼叫 `full_clean()`，因此 `FileExtensionValidator`、`validate_evidence_size`、`validate_pdf_header` **三者都不生效**。同一支 `Evidence.upload` 在此路徑可寫入任意副檔名、任意大小的檔案。屬既有設計缺口，超出本階段「最小修改」授權，僅記錄。

### FINDING-2：`Evidence.upload` 的驗證只在 `full_clean()` 被呼叫時生效
三處直建路徑（`views.py:1123/1150/1169/1297`）皆繞過。若要讓「Evidence 一定是合法檔案」成為不變量，需在這些路徑補 `full_clean(exclude=[...])` 或改用 Form/Serializer，屬獨立議題。

### 未擴大功能（依指令）
未做 PDF 結構完整性驗證（xref / object / EOF 檢查）。若後續需要，建議獨立方案：以 `pypdf` 解析並只讀取頁數與 trailer，失敗即拒；屆時需評估第三方依賴與既有檔案回溯相容性。
