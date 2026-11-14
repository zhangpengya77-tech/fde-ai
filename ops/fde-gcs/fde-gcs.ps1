# FDE-GCS 教室啟動腳本（Windows PowerShell 5.1／7）
# 用法：fde-gcs.ps1 -Action start | stop | check | sitl
# 原則：資料一律放 D 槽；只用 8260 埠且只綁 127.0.0.1；只停止自己啟動的程序；不重複啟動已存在的 SITL。
param(
  [ValidateSet('start', 'stop', 'check', 'sitl')]
  [string]$Action = 'check'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$PortalRoot = Join-Path $RepoRoot 'student_portal'
$RuntimeRoot = if ($env:FDE_GCS_RUNTIME) { $env:FDE_GCS_RUNTIME } else { 'D:\FDE-GCS-runtime' }
$Port = 8260
$BindAddr = '127.0.0.1'
$BaseUrl = "http://${BindAddr}:${Port}"
$StateFile = Join-Path $RuntimeRoot 'state\web.json'
$LogDir = Join-Path $RuntimeRoot 'logs'
$SitlPorts = @(5760, 5762)
$GcsProcessNames = @('MissionPlanner', 'QGroundControl', 'HyperQGC', 'HQGC')

function Write-Head([string]$text) {
  Write-Host ''
  Write-Host ('=' * 74) -ForegroundColor DarkCyan
  Write-Host "  $text" -ForegroundColor Cyan
  Write-Host ('=' * 74) -ForegroundColor DarkCyan
}
function Write-Ok([string]$text)   { Write-Host "  [OK]   $text" -ForegroundColor Green }
function Write-Warn2([string]$text){ Write-Host "  [WARN] $text" -ForegroundColor Yellow }
function Write-Bad([string]$text)  { Write-Host "  [FAIL] $text" -ForegroundColor Red }
function Write-Info([string]$text) { Write-Host "  [ .. ] $text" -ForegroundColor Gray }

function Get-PortOwner([int]$PortNumber) {
  $conn = Get-NetTCPConnection -LocalPort $PortNumber -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $conn) { return $null }
  $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
  return [pscustomobject]@{ Port = $PortNumber; Pid = [int]$conn.OwningProcess; Name = if ($proc) { $proc.ProcessName } else { 'unknown' } }
}

# 回傳 HTTP 狀態碼（不跟隨轉址）；連不上回傳 0。
function Get-HttpStatus([string]$url) {
  try {
    $request = [System.Net.HttpWebRequest]::Create($url)
    $request.AllowAutoRedirect = $false
    $request.Timeout = 3000
    $response = $request.GetResponse()
    $code = [int]$response.StatusCode
    $response.Close()
    return $code
  } catch [System.Net.WebException] {
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    return 0
  }
}

function Test-WebHealthy { return (Get-HttpStatus "$BaseUrl/gcs/") -in @(200, 302) }

function Read-State {
  if (-not (Test-Path $StateFile)) { return $null }
  try { return Get-Content -Raw -Encoding UTF8 $StateFile | ConvertFrom-Json } catch { return $null }
}

function Save-State([int]$ProcessId, [string]$LogFile) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $StateFile) | Out-Null
  $state = [ordered]@{ pid = $ProcessId; port = $Port; log = $LogFile; startedAt = [DateTimeOffset]::Now.ToString('o') }
  [System.IO.File]::WriteAllText($StateFile, ($state | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))
}

# 呼叫外部程式時暫時放寬錯誤處理：Windows PowerShell 5.1 在 Stop 模式下，外部程式寫入 stderr 會直接中斷腳本。
function Invoke-Native([scriptblock]$Block) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Block } finally { $ErrorActionPreference = $previous }
}

function Resolve-Python {
  if ($env:FDE_GCS_PYTHON) { return $env:FDE_GCS_PYTHON }
  $venv = Join-Path $RepoRoot '.test-temp\django-venv\Scripts\python.exe'
  if (Test-Path $venv) { return $venv }
  return 'python'
}

function Show-Environment {
  Write-Head 'FDE-GCS 環境檢查'
  $drive = Split-Path -Qualifier $RuntimeRoot
  $disk = Get-PSDrive -Name $drive.TrimEnd(':') -ErrorAction SilentlyContinue
  if (-not $disk) { Write-Bad "找不到 $drive 槽；資料不得寫入 C 槽，請設定 FDE_GCS_RUNTIME"; return $false }
  $freeGb = [math]::Round($disk.Free / 1GB, 1)
  if ($drive -ieq 'C:') { Write-Bad '資料目錄在 C 槽；C 槽空間不足，請把 FDE_GCS_RUNTIME 設到 D 槽'; return $false }
  Write-Ok "資料目錄 $RuntimeRoot（$drive 剩餘 $freeGb GB）"

  $chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  $edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  if ($chrome -or $edge) { Write-Ok "瀏覽器：$(@($chrome, $edge) | Where-Object { $_ } | ForEach-Object { Split-Path -Leaf $_ })（支援 Web Serial）" }
  else { Write-Warn2 '找不到 Chrome 或 Edge；FDE-GCS 的 USB 連線只支援這兩種瀏覽器' }

  $ports = [System.IO.Ports.SerialPort]::GetPortNames()
  if ($ports.Count -gt 0) { Write-Ok "COM 埠：$($ports -join ', ')" } else { Write-Warn2 '沒有偵測到 COM 埠：請確認 USB 線與飛控驅動' }

  $running = Get-Process -Name $GcsProcessNames -ErrorAction SilentlyContinue
  if ($running) { Write-Warn2 "以下地面站正在執行，可能占用 COM 埠，請在使用 FDE-GCS 前關閉：$(($running | Select-Object -ExpandProperty ProcessName -Unique) -join ', ')" }
  else { Write-Ok '沒有其他地面站在執行' }

  foreach ($sitlPort in $SitlPorts) {
    $owner = Get-PortOwner $sitlPort
    if ($owner) { Write-Info "SITL 埠 $sitlPort 由 $($owner.Name)（PID $($owner.Pid)）使用中" }
  }
  return $true
}

function Start-Web {
  if (-not (Show-Environment)) { exit 1 }
  Write-Head 'FDE-GCS 網站啟動'
  $state = Read-State
  if ($state -and (Get-Process -Id $state.pid -ErrorAction SilentlyContinue) -and (Test-WebHealthy)) {
    Write-Ok "FDE-GCS 已在執行（PID $($state.pid)），不重複啟動"
    Start-Process "$BaseUrl/gcs/"
    return
  }
  $owner = Get-PortOwner $Port
  if ($owner) {
    Write-Bad "埠 $Port 已被 $($owner.Name)（PID $($owner.Pid)）占用，這不是 FDE-GCS 啟動的程序，不會強制關閉它"
    exit 1
  }
  if (-not $env:FDE_GCS_COHORTS) {
    Write-Warn2 '沒有設定 FDE_GCS_COHORTS：只有教師看得到 FDE-GCS，學員看不到入口'
  }
  $python = Resolve-Python
  Invoke-Native { & $python -c "import django" 2>$null }
  if ($LASTEXITCODE -ne 0) { Write-Bad "找不到 Django（Python：$python）。請設定 FDE_GCS_PYTHON"; exit 1 }
  Write-Ok "Python：$python"

  New-Item -ItemType Directory -Force -Path (Join-Path $RuntimeRoot 'db'), (Join-Path $RuntimeRoot 'media'), $LogDir | Out-Null
  $env:DJANGO_DEBUG = 'true'
  $env:DJANGO_DB_NAME = Join-Path $RuntimeRoot 'db\fde-gcs.sqlite3'
  $env:DJANGO_MEDIA_ROOT = Join-Path $RuntimeRoot 'media'
  $env:DJANGO_ALLOWED_HOSTS = "127.0.0.1,localhost,127.0.0.1:$Port,localhost:$Port"
  $env:DJANGO_CSRF_TRUSTED_ORIGINS = "$BaseUrl,http://localhost:$Port"
  $env:FDE_GCS_ENABLED = '1'

  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $logFile = Join-Path $LogDir "fde-gcs-web-$stamp.log"
  Write-Info "資料庫：$($env:DJANGO_DB_NAME)"
  Invoke-Native { & $python (Join-Path $PortalRoot 'manage.py') migrate --noinput *>> $logFile }
  if ($LASTEXITCODE -ne 0) { Write-Bad "資料庫更新失敗，請看紀錄：$logFile"; exit 1 }
  Write-Ok '資料庫已更新'

  $process = Start-Process -FilePath $python -ArgumentList @((Join-Path $PortalRoot 'manage.py'), 'runserver', "${BindAddr}:${Port}", '--noreload') `
    -WorkingDirectory $PortalRoot -RedirectStandardOutput $logFile -RedirectStandardError "$logFile.err" -WindowStyle Minimized -PassThru
  Save-State $process.Id $logFile
  for ($i = 0; $i -lt 30; $i++) {
    if (Test-WebHealthy) { break }
    Start-Sleep -Seconds 1
  }
  if (-not (Test-WebHealthy)) { Write-Bad "網站沒有在 30 秒內啟動，請看紀錄：$logFile.err"; exit 1 }
  Write-Ok "FDE-GCS 已啟動：$BaseUrl/gcs/（PID $($process.Id)）"
  Write-Info "紀錄檔：$logFile"
  Start-Process "$BaseUrl/teacher/login/?next=/gcs/"
}

function Stop-Web {
  Write-Head 'FDE-GCS 安全停止'
  $state = Read-State
  if (-not $state) { Write-Info '沒有 FDE-GCS 啟動紀錄，不需要停止'; return }
  $process = Get-Process -Id $state.pid -ErrorAction SilentlyContinue
  $owner = Get-PortOwner $Port
  if ($process -and $owner -and $owner.Pid -eq $state.pid -and $process.ProcessName -like 'python*') {
    Stop-Process -Id $state.pid
    Write-Ok "已停止 FDE-GCS（PID $($state.pid)）"
  } elseif ($process) {
    Write-Warn2 "PID $($state.pid) 已不是 FDE-GCS 的網站程序，不會停止它"
  } else {
    Write-Info 'FDE-GCS 已經停止'
  }
  Remove-Item $StateFile -ErrorAction SilentlyContinue
  Write-Info "紀錄檔保留在：$LogDir"
}

function Check-All {
  [void](Show-Environment)
  Write-Head 'FDE-GCS 網站狀態'
  if (Test-WebHealthy) { Write-Ok "網站正常：$BaseUrl/gcs/" } else { Write-Info '網站沒有在執行' }
}

function Start-SitlTraining {
  Write-Head 'SITL 仿真檢查'
  $owner = Get-PortOwner 5760
  if ($owner) {
    Write-Ok "SITL 已在執行（$($owner.Name)，PID $($owner.Pid)，埠 5760），不重複啟動"
  } elseif ($env:FDE_SITL_LAUNCHER -and (Test-Path $env:FDE_SITL_LAUNCHER)) {
    Write-Info "使用既有 SITL 啟動程式：$($env:FDE_SITL_LAUNCHER)"
    Start-Process -FilePath $env:FDE_SITL_LAUNCHER -WorkingDirectory (Split-Path -Parent $env:FDE_SITL_LAUNCHER)
    for ($i = 0; $i -lt 60; $i++) {
      if (Get-PortOwner 5760) { break }
      Start-Sleep -Seconds 1
    }
    if (Get-PortOwner 5760) { Write-Ok 'SITL 已啟動（埠 5760）' } else { Write-Bad 'SITL 沒有在 60 秒內開始監聽 5760，請看 SITL 自己的視窗或紀錄' }
  } else {
    Write-Warn2 'SITL 沒有在執行，也沒有設定 FDE_SITL_LAUNCHER。'
    Write-Info '請用 Gazebo／SITL 接管案既有的啟動方式啟動 SITL，或把它的啟動檔路徑設成 FDE_SITL_LAUNCHER。'
  }
  Write-Info '注意：FDE-GCS 的仿真連線屬於 P4，目前尚未接入；SITL 請先用 Mission Planner 或 QGC 連線。'
  Write-Info '同一個 SITL 連線埠只能給一個程式使用；多個程式同時連線需要 MAVLink 分流（P4）。'
}

switch ($Action) {
  'start' { Start-Web }
  'stop'  { Stop-Web }
  'check' { Check-All }
  'sitl'  { Start-SitlTraining }
}
