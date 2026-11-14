# =============================================================================
# P8：F450 組裝與接線實訓 正式部署（2026-11 草案，執行前需使用者批准）
# 做的事（任何一步失敗就停止，不會往下做）：
#   0. 檢查：正式站工作目錄乾淨、目前版本是 98040d1、要部署的分支包含審核過的 1f2d99a 且之後只有文件變動
#   1. 備份：程式打標籤 backup/pre-f450-training-<日期>；資料庫線上備份到 db\
#   2. 程式：正式站分支快轉（fast-forward）到 feat/f450-assembly-training（F450 頁面立即生效）
#   3. 資料庫：migrate（0033，no-op）＋ seed_tasks（新增 T13，不覆寫老師改過的任務）
#   4. 重新啟動 Django（會跳出 UAC，請按「是」）：讓新模板與成績 API 生效
#   5. 檢查：本機 F450 頁面、實訓模組、成績 API、資料庫狀態
# 用法：在 PowerShell 執行  & '<本檔路徑>'
# =============================================================================
$ErrorActionPreference = 'Stop'
$repo = 'D:\FDE-AI-UAS-v2.0-integration'
$runtime = 'D:\FDE-AI-Runtime\v2-integration'
$branch = 'feat/f450-assembly-training'
$expectBase = '98040d1'
$expectHead = '1f2d99a'
$stamp = Get-Date -Format yyyyMMdd_HHmmss
$tag = 'backup/pre-f450-training-' + (Get-Date -Format yyyyMMdd)
$helper = Join-Path $PSScriptRoot 'p8_manage.py'
$py = 'D:\FDE-AI-UAS-v2.0\.test-temp\django-venv\Scripts\python.exe'
Start-Transcript -Path (Join-Path $runtime "logs\p8_f450_deploy_$stamp.log") | Out-Null

Write-Output '=== 0. 檢查 ==='
if (git -C $repo status --porcelain) { Write-Output '正式站工作目錄有未提交的變更，已停止（避免覆蓋）。'; exit 1 }
$head = (git -C $repo rev-parse --short HEAD).Trim()
if ($head -ne $expectBase) { Write-Output "正式站目前版本是 $head，不是預期的 $expectBase，已停止。請先確認。"; exit 1 }
# 審核過的程式版本是 $expectHead；之後只允許多出文件（docs/），程式有任何變動就停止
git -C $repo merge-base --is-ancestor $expectHead $branch
if ($LASTEXITCODE -ne 0) { Write-Output "$branch 不包含審核過的 $expectHead，已停止。"; exit 1 }
$extra = git -C $repo diff --name-only $expectHead $branch | Where-Object { $_ -notlike 'docs/*' }
if ($extra) { Write-Output "$expectHead 之後有未審核的程式變動，已停止："; $extra; exit 1 }
git -C $repo merge-base --is-ancestor HEAD $branch
if ($LASTEXITCODE -ne 0) { Write-Output '無法快轉（分支不是從目前版本延伸），已停止。'; exit 1 }

Write-Output '=== 1. 備份 ==='
git -C $repo tag $tag HEAD
Write-Output "程式備份標籤：$tag → $head"
$dbBackup = Join-Path $runtime "db\integration.before-f450-training-$stamp.sqlite3"
& $py $helper backup-db $dbBackup
if ($LASTEXITCODE -ne 0) { Write-Output '資料庫備份失敗，已停止。'; exit 1 }

Write-Output '=== 2. 程式快轉 ==='
git -C $repo merge --ff-only $branch
Write-Output ('正式站版本：' + (git -C $repo log --oneline -1))

Write-Output '=== 3. 資料庫 ==='
& $py $helper migrate; if ($LASTEXITCODE -ne 0) { Write-Output 'migrate 失敗，請執行 p8_rollback.ps1'; exit 1 }
& $py $helper seed;    if ($LASTEXITCODE -ne 0) { Write-Output 'seed_tasks 失敗，請執行 p8_rollback.ps1'; exit 1 }

Write-Output '=== 4. 重新啟動 Django（UAC 請按「是」）==='
Start-Process -FilePath powershell.exe -Verb RunAs -Wait -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $runtime 'services\restart_django_clean.ps1')
Start-Sleep 5

Write-Output '=== 5. 檢查 ==='
& $py $helper verify
if ($LASTEXITCODE -ne 0) { Write-Output '檢查沒通過，請看上面的問題；需要時執行 p8_rollback.ps1'; exit 1 }
Write-Output '部署完成。請用公開網址打開 /f450-twin/ 走一遍（見部署計畫第 6 節）。'
Write-Output "回滾：& '$(Join-Path $PSScriptRoot 'p8_rollback.ps1')'"
Stop-Transcript | Out-Null
