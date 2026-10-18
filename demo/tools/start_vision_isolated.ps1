# ===========================================================================
#  視覺驗收「完全隔離」環境（2026-10-16 教師裁決 P0）
#
#  啟動兩件事：
#    (1) 獨立 Live Backend（預設 127.0.0.1:8117），使用獨立 FDE_VISION_CENTER_ROOT
#        -> <ProjectRoot>\.test-temp\vision-isolated\live-vision-store
#    (2) 隔離 Django（預設 127.0.0.1:8112），使用獨立 DB（v2_vision.sqlite3），
#        並把 DJANGO_VISION_SUBMISSION_API_BASE_URL 指向 (1)
#
#  隔離保證：
#    - 不寫入 DEMO 共用儲存區 demo\runtime\vision-center（僅首次單向複製作種子）
#    - 不寫入正式儲存區 %LOCALAPPDATA%\FDE-AI-UAS\vision-center
#    - ACTIVE 指標、模型檔案、vision_center.json、驗證輸出全部獨立
#
#  ⚠️ 參數名稱刻意使用 Isolated* 前綴：
#     demo_common.ps1 以 `$script:DjangoPort` / `$script:LivePort` 等名稱定義共用變數，
#     由於本檔 dot-source 它，同名的普通變數會被覆寫（曾因此誤啟到 8110／8111）。
#
#  用法：
#    powershell.exe -ExecutionPolicy Bypass -File start_vision_isolated.ps1
#    powershell.exe ... -Reseed                       # 重新從 DEMO 複製種子（覆蓋隔離區）
#    powershell.exe ... -IsolatedDjangoPort 8112 -IsolatedLivePort 8117 -IsolatedDbFile v2_vision.sqlite3
# ===========================================================================
param(
  [int]$IsolatedDjangoPort = 8112,
  [int]$IsolatedLivePort   = 8117,
  [string]$IsolatedDbFile  = 'v2_vision.sqlite3',
  [switch]$Reseed
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'demo_common.ps1')

Set-DemoEnvironment

# ---------------------------------------------------------------------------
#  安全閘（任何一步不合格就拒絕啟動）
# ---------------------------------------------------------------------------
if ($IsolatedDjangoPort -eq 8110 -or $IsolatedLivePort -eq 8111) {
  Write-Bad '拒絕啟動：隔離埠不可使用 DEMO 的 8110／8111。'
  exit 1
}
if ($IsolatedDjangoPort -eq $IsolatedLivePort) {
  Write-Bad '拒絕啟動：隔離 Django 與隔離 Live Backend 不可使用同一個埠。'
  exit 1
}

$TestTempRoot  = [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot '.test-temp'))
$IsolatedStore = [System.IO.Path]::GetFullPath((Join-Path $TestTempRoot 'vision-isolated\live-vision-store'))
$DemoStore     = [System.IO.Path]::GetFullPath((Join-Path $DemoRoot 'runtime\vision-center'))
$ProdStore     = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'FDE-AI-UAS\vision-center'))
$IsolatedDb    = Join-Path $DemoRoot "runtime\db\$IsolatedDbFile"

if ($IsolatedStore -eq $DemoStore -or $IsolatedStore -eq $ProdStore) {
  Write-Bad "拒絕啟動：隔離儲存區不可等於 DEMO 或正式儲存區（$IsolatedStore）"
  exit 1
}
if (-not $IsolatedStore.StartsWith($TestTempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  Write-Bad "拒絕啟動：隔離儲存區必須位於 .test-temp 之下（$IsolatedStore）"
  exit 1
}
if (-not (Test-Path $IsolatedDb)) {
  Write-Bad "找不到隔離測試庫：$IsolatedDb"
  exit 1
}

Write-Head '視覺驗收完全隔離環境'
Write-Info "隔離 Django      ：127.0.0.1:$IsolatedDjangoPort"
Write-Info "隔離 Live Backend：127.0.0.1:$IsolatedLivePort"
Write-Info "隔離儲存區       ：$IsolatedStore"
Write-Info "DEMO 共用區      ：$DemoStore（唯讀，僅作種子）"
Write-Info "正式儲存區       ：$ProdStore（完全不碰）"
Write-Info "隔離測試庫       ：$IsolatedDb"

# ---------------------------------------------------------------------------
#  種子複製（單向：只從 DEMO 讀，永不寫回）
# ---------------------------------------------------------------------------
# 種子建立與「絕對路徑重寫」一律交由 Python 處理：
#   單向複製 DEMO -> 隔離，並把 vision_center.json 內的 file_path / storage_path
#   改指向隔離目錄，否則隔離環境實際上仍會去讀 DEMO 的模型檔。
$env:FDE_DEMO_STORE = $DemoStore
$env:FDE_ISOLATED_STORE = $IsolatedStore
$seedArgs = @((Join-Path $PSScriptRoot 'seed_vision_isolated_store.py'))
if ($Reseed) { $seedArgs += '--reseed' }
Write-Info '建立／檢查隔離種子（單向複製 + 路徑重寫）…'
& $DjangoPy @seedArgs
if ($LASTEXITCODE -ne 0) {
  Write-Bad '隔離種子建立失敗，中止啟動。'
  exit 1
}

# ---------------------------------------------------------------------------
#  環境變數（全部指向隔離）
# ---------------------------------------------------------------------------
$env:FDE_VISION_CENTER_ROOT = $IsolatedStore
$env:DJANGO_DB_NAME = $IsolatedDb
$env:DJANGO_VISION_SUBMISSION_API_BASE_URL = "http://127.0.0.1:$IsolatedLivePort"
$env:DJANGO_ALLOWED_HOSTS = "$($env:DJANGO_ALLOWED_HOSTS),127.0.0.1:$IsolatedDjangoPort"
$env:DJANGO_CSRF_TRUSTED_ORIGINS = "$($env:DJANGO_CSRF_TRUSTED_ORIGINS),http://127.0.0.1:$IsolatedDjangoPort"

New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null

# ---------------------------------------------------------------------------
#  啟動獨立 Live Backend
# ---------------------------------------------------------------------------
$isoLiveProc = $null
if (Test-PortBusy $IsolatedLivePort) {
  $owner = Get-PortOwner $IsolatedLivePort
  Write-Warn2 "埠 $IsolatedLivePort 已被占用（PID $($owner.Pid) / $($owner.Name)）— 沿用既有行程。"
} else {
  Write-Info "啟動獨立 Live Backend（127.0.0.1:$IsolatedLivePort）…"
  $liveOut = Join-Path $LogRoot 'vision-isolated.live.out.log'
  $liveErr = Join-Path $LogRoot 'vision-isolated.live.err.log'
  $isoLiveProc = Start-Process -FilePath $LivePy `
    -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', "$IsolatedLivePort") `
    -WorkingDirectory (Join-Path $ProjectRoot 'live_backend') `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $liveOut -RedirectStandardError $liveErr
  if (-not (Wait-Http "http://127.0.0.1:$IsolatedLivePort/api/live/health" 90)) {
    Write-Bad '獨立 Live Backend 未能在 90 秒內啟動。'
    $tail = Get-Content $liveErr -Tail 15 -ErrorAction SilentlyContinue
    if ($tail) { $tail | ForEach-Object { Write-Host "         $_" -ForegroundColor DarkGray } }
    exit 1
  }
  Write-Ok "獨立 Live Backend 就緒（PID $($isoLiveProc.Id)）"
}

# ---------------------------------------------------------------------------
#  啟動隔離 Django
# ---------------------------------------------------------------------------
$djangoOut = Join-Path $LogRoot "vision-isolated.$IsolatedDbFile.django.out.log"
$djangoErr = Join-Path $LogRoot "vision-isolated.$IsolatedDbFile.django.err.log"
$isoDjangoProc = Start-Process -FilePath $DjangoPy `
  -ArgumentList @('manage.py', 'runserver', "127.0.0.1:$IsolatedDjangoPort", '--noreload') `
  -WorkingDirectory (Join-Path $ProjectRoot 'student_portal') `
  -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $djangoOut -RedirectStandardError $djangoErr

if (-not (Wait-Http "http://127.0.0.1:$IsolatedDjangoPort/login/" 60)) {
  Write-Bad '隔離 Django 未能在 60 秒內啟動。'
  $tail = Get-Content $djangoErr -Tail 15 -ErrorAction SilentlyContinue
  if ($tail) { $tail | ForEach-Object { Write-Host "         $_" -ForegroundColor DarkGray } }
  exit 1
}
Write-Ok "隔離 Django 就緒（PID $($isoDjangoProc.Id)）"

Write-Head '隔離環境已就緒'
Write-Output "VISION ISOLATED READY django=http://127.0.0.1:$IsolatedDjangoPort live=http://127.0.0.1:$IsolatedLivePort store=$IsolatedStore db=$IsolatedDb"
Write-Output "ISOLATED DJANGO PID=$($isoDjangoProc.Id) LIVE PID=$($isoLiveProc.Id)"

# 保持前景存活：沙箱會在工作結束時終止子程序，需由呼叫端以背景方式常駐。
Wait-Process -Id $isoDjangoProc.Id
Write-Output "VISION ISOLATED DJANGO :$IsolatedDjangoPort exited."
