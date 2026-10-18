# Persistent DEMO launcher (P2 acceptance helper, 2026-10-13).
# Sandbox kills child processes when a tool call ends; start_demo.ps1 exits
# right after health checks, so the services die with it. This wrapper runs
# start_demo.ps1 first (all env setup + health checks unchanged), then holds
# the service PIDs with Wait-Process so the background task stays alive.
# Usage: powershell.exe -ExecutionPolicy Bypass -File start_demo_hold.ps1
$ErrorActionPreference = 'Stop'
& powershell.exe -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'start_demo.ps1')
$stateFile = Join-Path $PSScriptRoot '..\runtime\state\demo-services.json'
if (-not (Test-Path $stateFile)) {
  Write-Error 'DEMO state file not found; startup may have failed.'
  exit 1
}
$state = Get-Content $stateFile -Raw | ConvertFrom-Json
Write-Output "HOLDING DEMO django=$($state.django_pid) live=$($state.live_pid) flight_health=$($state.flight_health_pid)"
$alive = @()
foreach ($pidValue in @($state.django_pid, $state.live_pid, $state.flight_health_pid)) {
  if ($pidValue -and (Get-Process -Id $pidValue -ErrorAction SilentlyContinue)) { $alive += $pidValue }
}
if (-not $alive) {
  Write-Error 'No DEMO service process is alive.'
  exit 1
}
Wait-Process -Id $alive
Write-Output 'DEMO services have all exited.'
