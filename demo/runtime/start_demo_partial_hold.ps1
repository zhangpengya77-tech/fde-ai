# Holder for the partial DEMO stack (Live 8113 + Django 8110 + FlightHealth 8040).
# Runs the transient launcher (which starts services and exits, orphaning them),
# then holds their PIDs with Wait-Process so the background task stays alive.
# Mirrors start_demo_hold.ps1 exactly.
$ErrorActionPreference = 'Stop'

& powershell.exe -ExecutionPolicy Bypass -File 'D:\FDE-AI-UAS-v2.0\demo\runtime\start_demo_partial.ps1'

$stateFile = 'D:\FDE-AI-UAS-v2.0\demo\runtime\state\demo-services.json'
if (-not (Test-Path $stateFile)) {
  Write-Error 'DEMO state file not found; startup may have failed.'
  exit 1
}
$state = Get-Content $stateFile -Raw | ConvertFrom-Json
Write-Output "HOLDING live=$($state.live_pid)(:$($state.live_port)) django=$($state.django_pid) flight_health=$($state.flight_health_pid)"
$alive = @()
foreach ($pidValue in @($state.live_pid, $state.django_pid, $state.flight_health_pid)) {
  if ($pidValue -and (Get-Process -Id $pidValue -ErrorAction SilentlyContinue)) { $alive += $pidValue }
}
if (-not $alive) {
  Write-Error 'No DEMO service process is alive.'
  exit 1
}
Wait-Process -Id $alive
Write-Output 'DEMO services have all exited.'