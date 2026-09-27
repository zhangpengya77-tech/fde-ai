param(
  [switch]$DryRun,
  [string]$Python = 'C:\Users\admin\AppData\Local\Python\pythoncore-3.14-64\python.exe',
  [string]$YoloRoot = 'C:\Users\admin\Documents\Codex\2026-08-30\new-chat\FDE-AI\api',
  [int]$LivePort = 8030,
  [int]$VisionPort = 8765,
  [string]$StateFile = ''
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$LiveRoot = Join-Path $ProjectRoot 'live_backend'
$VisionEntryPoint = Join-Path $LiveRoot 'dev\vision_snapshot_server.py'
$RuntimeRoot = Join-Path $ProjectRoot '.test-temp\phase1a-runtime'
$LogRoot = Join-Path $RuntimeRoot 'logs'
if (-not $StateFile) { $StateFile = Join-Path $RuntimeRoot 'services.json' }
$LiveUrl = "http://127.0.0.1:$LivePort"
$VisionUrl = "http://127.0.0.1:$VisionPort"

if ($DryRun) {
  [ordered]@{
    mode = 'dry_run'
    live_backend = [ordered]@{ url = $LiveUrl; working_directory = $LiveRoot }
    vision = [ordered]@{ url = $VisionUrl; working_directory = $LiveRoot; entrypoint = $VisionEntryPoint }
    production_worker_updated = $false
    tunnel_started = $false
  } | ConvertTo-Json -Depth 4 -Compress
  exit 0
}

if (-not (Test-Path -LiteralPath $Python)) { throw "Python executable not found: $Python" }
if (-not (Test-Path -LiteralPath (Join-Path $LiveRoot 'app\main.py'))) { throw 'Live Backend source was not found.' }
if (-not (Test-Path -LiteralPath $VisionEntryPoint)) { throw 'Phase 1A vision wrapper was not found.' }
if (-not (Test-Path -LiteralPath (Join-Path $YoloRoot 'yolo_server.py'))) { throw 'Existing YOLO server was not found.' }
New-Item -ItemType Directory -Force -Path $RuntimeRoot, $LogRoot | Out-Null

function Test-Http([string]$Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Wait-Http([string]$Url, [int]$Seconds) {
  for ($attempt = 0; $attempt -lt $Seconds; $attempt++) {
    if (Test-Http $Url) { return $true }
    Start-Sleep -Seconds 1
  }
  return $false
}

$state = [ordered]@{
  live_pid = $null
  live_owned = $false
  vision_pid = $null
  vision_owned = $false
  started_at = [DateTimeOffset]::UtcNow.ToString('o')
}

if (-not (Test-Http "$VisionUrl/api/health")) {
  $visionProcess = Start-Process -FilePath $Python `
    -ArgumentList @($VisionEntryPoint, '--source-root', $YoloRoot, '--host', '127.0.0.1', '--port', "$VisionPort") `
    -WorkingDirectory $LiveRoot -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $LogRoot 'vision.out.log') `
    -RedirectStandardError (Join-Path $LogRoot 'vision.err.log')
  $state.vision_pid = $visionProcess.Id
  $state.vision_owned = $true
}

if (-not (Test-Http "$LiveUrl/api/live/health")) {
  $liveProcess = Start-Process -FilePath $Python `
    -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', "$LivePort") `
    -WorkingDirectory $LiveRoot -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $LogRoot 'live.out.log') `
    -RedirectStandardError (Join-Path $LogRoot 'live.err.log')
  $state.live_pid = $liveProcess.Id
  $state.live_owned = $true
}

$state | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $StateFile -Encoding utf8

if (-not (Wait-Http "$LiveUrl/api/live/health" 30)) {
  throw "Live Backend did not become healthy. See $LogRoot\live.err.log"
}
if (-not (Wait-Http "$VisionUrl/api/health" 60)) {
  throw "YOLO did not become healthy. See $LogRoot\vision.err.log"
}

[ordered]@{
  status = 'online'
  live_backend = $LiveUrl
  vision = $VisionUrl
  live_page = "$LiveUrl/live/"
  state_file = $StateFile
  production_worker_updated = $false
  tunnel_started = $false
} | ConvertTo-Json -Depth 3 -Compress
