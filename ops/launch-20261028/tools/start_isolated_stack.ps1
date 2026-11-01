# ===========================================================================
#  FDE-AI 2.0 上線收尾 — 隔離 YOLO 閉環測試棧
#  目的：在不接觸正式 8022 / 8770 / 正式 Registry / 正式 DB 的前提下，
#        起一套可操作的 Django + Live 疊，供 12 項閉環驗證使用。
#
#  隔離手段：
#    1. 只綁 127.0.0.1:18110 / 18111（正式為 8022/8770，DEMO 為 8110/8111）。
#    2. DB / MEDIA / vision-center 全部使用 ops\launch-20261028\isolated-run 下的副本。
#    3. 啟動前若正式 8110/8111/8022 有監聽，不停止、不接管，只記錄。
#
#  用法：
#    powershell -ExecutionPolicy Bypass -File start_isolated_stack.ps1 -Action prepare
#    powershell -ExecutionPolicy Bypass -File start_isolated_stack.ps1 -Action start
#    powershell -ExecutionPolicy Bypass -File start_isolated_stack.ps1 -Action status
#    powershell -ExecutionPolicy Bypass -File start_isolated_stack.ps1 -Action stop
# ===========================================================================
param(
  [ValidateSet('prepare', 'start', 'status', 'stop')]
  [string]$Action = 'status',
  [string]$RunRoot = ''
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = 'D:\FDE-AI-UAS-v2.0'
$SourceRun   = Join-Path $ProjectRoot 'demo\runtime'
$IsoRoot     = if ([string]::IsNullOrWhiteSpace($RunRoot)) { Join-Path $ProjectRoot 'ops\launch-20261028\isolated-run' } else { $RunRoot }
$LogRoot     = Join-Path $IsoRoot 'logs'
$DjangoPy    = Join-Path $ProjectRoot '.test-temp\django-venv\Scripts\python.exe'
$LivePy      = 'C:\Users\admin\AppData\Local\Python\pythoncore-3.14-64\python.exe'
$DjangoPort  = 18110
$LivePort    = 18111
$BindAddr    = '127.0.0.1'

function Write-Log([string]$Message) {
  if (-not (Test-Path $LogRoot)) { New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null }
  $line = ('[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message)
  Add-Content -Path (Join-Path $LogRoot 'isolated-stack.log') -Value $line -Encoding UTF8
  Write-Output $Message
}

function Get-ListenerPid([int]$Port) {
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) { return $conn.OwningProcess }
  return 0
}

if ($Action -eq 'prepare') {
  Write-Log "prepare: 來源 $SourceRun -> 隔離 $IsoRoot"
  foreach ($d in @('db', 'media', 'vision-center', 'logs', 'downloads')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $IsoRoot $d) | Out-Null
  }

  $dbSrc = Join-Path $SourceRun 'db\demo.sqlite3'
  $dbDst = Join-Path $IsoRoot 'db\demo.sqlite3'
  if (-not (Test-Path $dbDst)) {
    Copy-Item -Path $dbSrc -Destination $dbDst -Force
    Write-Log "prepare: DB 已複製 $((Get-Item $dbDst).Length) bytes"
  } else {
    Write-Log 'prepare: DB 已存在，跳過（避免覆蓋既有測試狀態）'
  }

  $mediaDst = Join-Path $IsoRoot 'media'
  if (-not (Test-Path (Join-Path $mediaDst 'vision_repository'))) {
    Copy-Item -Path (Join-Path $SourceRun 'media\*') -Destination $mediaDst -Recurse -Force
    Write-Log 'prepare: media 已複製'
  } else {
    Write-Log 'prepare: media 已存在，跳過'
  }

  $storeDst = Join-Path $IsoRoot 'vision-center'
  if (-not (Test-Path (Join-Path $storeDst 'vision_center.json'))) {
    Copy-Item -Path (Join-Path $SourceRun 'vision-center\*') -Destination $storeDst -Recurse -Force
    Write-Log 'prepare: vision-center 已複製'
  } else {
    Write-Log 'prepare: vision-center 已存在，跳過'
  }

  # 記錄來源指紋，供事後證明「正式 Registry 未被本輪修改」
  $srcJson = Join-Path $SourceRun 'vision-center\vision_center.json'
  if (Test-Path $srcJson) {
    $hash = (Get-FileHash -Path $srcJson -Algorithm SHA256).Hash
    Write-Log "prepare: 來源 vision_center.json SHA256=$hash"
    Set-Content -Path (Join-Path $IsoRoot 'SOURCE_STORE_SHA256.txt') -Value $hash -Encoding UTF8
  }
  exit 0
}

if ($Action -eq 'stop') {
  foreach ($p in @($DjangoPort, $LivePort)) {
    $owner = Get-ListenerPid $p
    if ($owner -gt 0) {
      $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$owner" -ErrorAction SilentlyContinue
      if ($proc -and $proc.CommandLine -match '18110|18111') {
        Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
        Write-Log "stop: 已停止埠 $p 的隔離行程 PID=$owner"
      } else {
        Write-Log "stop: 埠 $p 的行程 PID=$owner 非本棧所有，拒絕停止"
      }
    }
  }
  exit 0
}

if ($Action -eq 'status') {
  foreach ($p in @($DjangoPort, $LivePort)) {
    $owner = Get-ListenerPid $p
    if ($owner -gt 0) {
      $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$owner" -ErrorAction SilentlyContinue
      Write-Output ("port {0}: LISTENING pid={1} cmd={2}" -f $p, $owner, $proc.CommandLine)
    } else {
      Write-Output ("port {0}: free" -f $p)
    }
  }
  exit 0
}

# ---- start ---------------------------------------------------------------
foreach ($need in @(
    (Join-Path $IsoRoot 'db\demo.sqlite3'),
    (Join-Path $IsoRoot 'vision-center\vision_center.json')
  )) {
  if (-not (Test-Path $need)) { throw "缺少隔離資源：$need（請先執行 -Action prepare）" }
}
if (-not (Test-Path $DjangoPy)) { throw "缺少 Django 解釋器：$DjangoPy" }
if (-not (Test-Path $LivePy)) { throw "缺少 Live 解釋器：$LivePy" }

foreach ($p in @(8022, 8770, 8110, 8111)) {
  $owner = Get-ListenerPid $p
  if ($owner -gt 0) { Write-Log "start: 注意 正式/DEMO 埠 $p 正由 PID=$owner 佔用（本棧不觸碰）" }
}

$envBlock = @(
  "DJANGO_DB_NAME=$IsoRoot\db\demo.sqlite3",
  "DJANGO_MEDIA_ROOT=$IsoRoot\media",
  "DJANGO_DEBUG=true",
  "DJANGO_SECRET_KEY=isolated-e2e-only-not-production",
  "DJANGO_SETTINGS_MODULE=config.settings",
  "DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost,127.0.0.1:$DjangoPort,127.0.0.1:$LivePort",
  "DJANGO_CSRF_TRUSTED_ORIGINS=http://127.0.0.1:$DjangoPort,http://127.0.0.1:$LivePort",
  "FDE_VISION_CENTER_ROOT=$IsoRoot\vision-center",
  "FDE_DOWNLOAD_ROOT=$IsoRoot\downloads",
  "FDE_DJANGO_PORTAL_URL=http://127.0.0.1:$DjangoPort",
  "DJANGO_VISION_SUBMISSION_API_BASE_URL=http://127.0.0.1:$LivePort",
  "FDE_INTERNAL_SHARED_SECRET=fde-phase4-isolated-test-secret-not-for-production",
  "PYTHONNOUSERSITE=1",
  "PYTHONUTF8=1",
  "NO_PROXY=*",
  "no_proxy=*",
  "HTTP_PROXY=",
  "HTTPS_PROXY=",
  "http_proxy=",
  "https_proxy=",
  "ALL_PROXY=",
  "all_proxy="
)

# 產生 .cmd 啟動檔：避免 cmd.exe /c 對長引號鏈的解析問題（曾導致參數被吞、行程落進 REPL）。
function New-LaunchCmd([string]$Name, [string]$Python, [string]$ArgLine, [string]$Cwd, [string]$OutLog) {
  $lines = @('@echo off', 'chcp 65001 > nul')
  foreach ($e in $envBlock) { $lines += "set `"$e`"" }
  $lines += "cd /d `"$Cwd`""
  $lines += "`"$Python`" $ArgLine > `"$OutLog`" 2>&1"
  $path = Join-Path $IsoRoot ("run-$Name.cmd")
  [System.IO.File]::WriteAllLines($path, $lines, [System.Text.UTF8Encoding]::new($false))
  return $path
}

$jobs = @(
  @{ Name = 'django'; Cmd = (New-LaunchCmd 'django' $DjangoPy "manage.py runserver ${BindAddr}:${DjangoPort} --noreload" (Join-Path $ProjectRoot 'student_portal') (Join-Path $LogRoot 'django.log')) },
  @{ Name = 'live';   Cmd = (New-LaunchCmd 'live' $LivePy "-m uvicorn app.main:app --host $BindAddr --port $LivePort" (Join-Path $ProjectRoot 'live_backend') (Join-Path $LogRoot 'live.log')) }
)

foreach ($j in $jobs) {
  # 路徑無空白，故意不加引號：cmd /c 對「只有一對引號且引號間無空白」會保留引號，
  # 導致把整串引號路徑當成命令名而找不到檔案（本輪實測踩到）。
  $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine      = "cmd.exe /c $($j.Cmd)"
    CurrentDirectory = $ProjectRoot
  }
  Write-Log "start: $($j.Name) ReturnValue=$($r.ReturnValue) PID=$($r.ProcessId) cmd=$($j.Cmd)"
}

$deadline = (Get-Date).AddSeconds(60)
$dOk = $false; $lOk = $false
while ((Get-Date) -lt $deadline) {
  try { $dOk = (Invoke-WebRequest "http://127.0.0.1:$DjangoPort/login/" -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch { $dOk = $false }
  try { $lOk = (Invoke-WebRequest "http://127.0.0.1:$LivePort/api/live/health" -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch { $lOk = $false }
  if ($dOk -and $lOk) { break }
  Start-Sleep -Seconds 3
}
Write-Log "start: health django=$dOk live=$lOk"
Write-Output "django=$dOk live=$lOk"
