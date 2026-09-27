param(
  [string]$StateFile = ''
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $StateFile) {
  $StateFile = Join-Path $ProjectRoot '.test-temp\phase1a-runtime\services.json'
}

if (-not (Test-Path -LiteralPath $StateFile)) {
  [ordered]@{ stopped = @(); status = 'nothing_to_stop' } | ConvertTo-Json -Depth 3 -Compress
  exit 0
}

$state = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
$stopped = @()

foreach ($service in @(
    [pscustomobject]@{ Name = 'live_backend'; Pid = $state.live_pid; Owned = $state.live_owned; Pattern = 'uvicorn.*app\.main:app' },
    [pscustomobject]@{ Name = 'vision'; Pid = $state.vision_pid; Owned = $state.vision_owned; Pattern = 'yolo_server\.py' }
)) {
  if (-not $service.Owned -or -not $service.Pid) { continue }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($service.Pid)" -ErrorAction SilentlyContinue
  if ($process -and $process.CommandLine -match $service.Pattern) {
    Stop-Process -Id $service.Pid -ErrorAction Stop
    $stopped += $service.Name
  }
}

Remove-Item -LiteralPath $StateFile -Force
[ordered]@{ stopped = $stopped; status = 'stopped' } | ConvertTo-Json -Depth 3 -Compress
