# =============================================================================
# P8 回滾：撤銷「F450 組裝與接線實訓」正式部署
# 做的事：
#   1. T13 設成停用（不刪除，保留學員可能已上傳的佐證；學員與老師就看不到這張卡）
#   2. 資料庫退回 learning 0032（0033 是 no-op，資料不變；F450 練習紀錄會保留在表中）
#   3. 程式退回部署前標籤（F450 頁面立即恢復舊版）
#   4. 重新啟動 Django（會跳出 UAC，請按「是」）
# 一般不需要還原整個資料庫備份；只有資料損壞時才用部署前備份（會失去部署後的所有新資料，需另外確認）。
# 用法：& '<本檔路徑>' -Tag backup/pre-f450-training-<日期>
# =============================================================================
param([Parameter(Mandatory = $true)][string]$Tag)
$ErrorActionPreference = 'Stop'
$repo = 'D:\FDE-AI-UAS-v2.0-integration'
$runtime = 'D:\FDE-AI-Runtime\v2-integration'
$helper = Join-Path $PSScriptRoot 'p8_manage.py'
$py = 'D:\FDE-AI-UAS-v2.0\.test-temp\django-venv\Scripts\python.exe'
Start-Transcript -Path (Join-Path $runtime ('logs\p8_f450_rollback_' + (Get-Date -Format yyyyMMdd_HHmmss) + '.log')) | Out-Null

Write-Output '=== 回滾 F450 組裝與接線實訓 ==='
if (git -C $repo status --porcelain) { Write-Output '正式站工作目錄有未提交的變更，已停止（避免覆蓋）。'; exit 1 }
git -C $repo rev-parse --verify --quiet "refs/tags/$Tag" | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Output "找不到標籤 $Tag，已停止。"; exit 1 }

Write-Output '1. 停用 T13'
& $py $helper deactivate-t13
Write-Output '2. 資料庫退回 0032'
& $py $helper migrate-back
Write-Output '3. 程式退回'
git -C $repo reset --keep $Tag
Write-Output ('正式站版本：' + (git -C $repo log --oneline -1))
Write-Output '4. 重新啟動 Django（UAC 請按「是」）'
Start-Process -FilePath powershell.exe -Verb RunAs -Wait -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $runtime 'services\restart_django_clean.ps1')
Write-Output '回滾完成。請重新整理 /f450-twin/，確認實訓區回到部署前的樣子。'
Stop-Transcript | Out-Null
