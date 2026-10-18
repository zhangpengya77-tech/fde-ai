# ===========================================================================
#  P4.2–P8 隔離驗收服務（單一 Django 實例，獨立測試庫）
#  以 demo\runtime\db\p42_verify.sqlite3 啟動 192.168.1.114:8112，
#  供 P4.2／P5／P6／P7／P8 驗收腳本（verify_*.py、p*_screenshot.cjs）使用。
#
#  與 DEMO（8110／8111）及正式服務（8022）完全隔離：
#    - 資料庫為獨立副本，不共用 DEMO 或正式 DB。
#    - 埠與綁定位址不同，不會互相覆蓋。
#    - 沿用 demo_common.ps1 的 Set-DemoEnvironment（含模擬推論開關），
#      確保展示頁不退化連真實推論服務。
#
#  用法：powershell.exe -ExecutionPolicy Bypass -File start_p42_verify.ps1
#  （沙箱中需以背景常駐方式執行，見 start_p42_verify_hold.ps1）
# ===========================================================================
param(
  # 預設為 P4.2–P8 共用的隔離驗收庫；P8-A 副作用稽核以 -Port 8113
  # -DbFile p8_audit.sqlite3 啟動（稽核腳本自帶 DB 路徑安全閘）。
  [int]$Port = 8112,
  [string]$DbFile = 'p42_verify.sqlite3'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'demo_common.ps1')

Set-DemoEnvironment

$VerifyPort = $Port
$VerifyDb   = Join-Path $DemoRoot "runtime\db\$DbFile"

if (-not (Test-Path $VerifyDb)) {
  Write-Bad "找不到隔離測試庫：$VerifyDb"
  Write-Host '         請先執行 demo\tools\seed_p42_verify.py 建立測試資料。' -ForegroundColor Yellow
  exit 1
}

$env:DJANGO_DB_NAME = $VerifyDb
$env:DJANGO_ALLOWED_HOSTS = "$($env:DJANGO_ALLOWED_HOSTS),$BindAddr`:$VerifyPort"
$env:DJANGO_CSRF_TRUSTED_ORIGINS = "$($env:DJANGO_CSRF_TRUSTED_ORIGINS),http://${BindAddr}:$VerifyPort"

# ---------------------------------------------------------------------------
#  視覺儲存隔離（2026-10-16 教師裁決 P0）
#  8112 驗收環境一律使用「獨立」的 vision center 儲存區，不得寫入
#  8110 DEMO 共用儲存區（demo\runtime\vision-center）。
#  作法：把 Django 指向獨立的 Live Backend 連接埠；若該 Live Backend 未啟動，
#        視覺頁面顯示「服務離線」（fail-closed），不會靜默寫入 DEMO 共用資料。
#  獨立 Live Backend 由 demo\tools\start_vision_isolated.ps1 啟動。
# ---------------------------------------------------------------------------
$IsolatedVisionRoot = if ($env:FDE_ISOLATED_VISION_ROOT) {
  $env:FDE_ISOLATED_VISION_ROOT
} else {
  Join-Path $ProjectRoot '.test-temp\vision-isolated\live-vision-store'
}
$IsolatedLivePort = if ($env:FDE_ISOLATED_LIVE_PORT) { [int]$env:FDE_ISOLATED_LIVE_PORT } else { 8117 }

$TestTempRoot       = [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot '.test-temp'))
$normalizedIsolated = [System.IO.Path]::GetFullPath($IsolatedVisionRoot)
$DemoVisionDir      = [System.IO.Path]::GetFullPath((Join-Path $DemoRoot 'runtime\vision-center'))
$ProdVisionDir      = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'FDE-AI-UAS\vision-center'))

if ($normalizedIsolated -eq $DemoVisionDir -or $normalizedIsolated -eq $ProdVisionDir) {
  Write-Bad "隔離視覺儲存區不可指向 DEMO 或正式儲存區：$normalizedIsolated"
  exit 1
}
if (-not $normalizedIsolated.StartsWith($TestTempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  Write-Bad "隔離視覺儲存區必須位於 .test-temp 之下：$normalizedIsolated"
  exit 1
}

$env:FDE_VISION_CENTER_ROOT = $normalizedIsolated
$env:DJANGO_VISION_SUBMISSION_API_BASE_URL = "http://127.0.0.1:$IsolatedLivePort"

Write-Info "隔離視覺儲存區：$normalizedIsolated"
Write-Info "隔離 Live Backend：http://127.0.0.1:$IsolatedLivePort"
Write-Info "DEMO 共用儲存區（本環境不寫入）：$DemoVisionDir"

$tag = [System.IO.Path]::GetFileNameWithoutExtension($DbFile)
$outLog = Join-Path $LogRoot "$tag.out.log"
$errLog = Join-Path $LogRoot "$tag.err.log"

Write-Head "隔離驗收服務（Django :$VerifyPort）"
Write-Info "測試庫：$VerifyDb"
Write-Info "綁定：${BindAddr}:$VerifyPort"

$proc = Start-Process -FilePath $DjangoPy `
  -ArgumentList @('manage.py', 'runserver', "${BindAddr}:$VerifyPort", '--noreload') `
  -WorkingDirectory (Join-Path $ProjectRoot 'student_portal') `
  -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $outLog -RedirectStandardError $errLog

Write-Output "VERIFY DJANGO PID=$($proc.Id) PORT=$VerifyPort DB=$DbFile"

if (-not (Wait-Http "http://${BindAddr}:$VerifyPort/login/" 45)) {
  Write-Bad "Django :$VerifyPort 未能在 45 秒內健康啟動。"
  $tail = Get-Content $errLog -Tail 15 -ErrorAction SilentlyContinue
  if ($tail) { $tail | ForEach-Object { Write-Host "         $_" -ForegroundColor DarkGray } }
  exit 1
}
Write-Ok "Django :$VerifyPort 健康檢查通過"

# 保持前景存活：沙箱會在工作結束時終止子程序，需由呼叫端以背景方式常駐。
Wait-Process -Id $proc.Id
Write-Output "VERIFY DJANGO :$VerifyPort exited."
