$ErrorActionPreference = 'Stop'
$stateFile = Join-Path $env:LOCALAPPDATA 'FDE-AI\classroom\services.json'

if (-not (Test-Path $stateFile)) {
  Write-Output 'No classroom-managed services are recorded; nothing was stopped.'
  exit 0
}

$state = Get-Content -Raw $stateFile | ConvertFrom-Json
if ($state.tunnelOwned -and $state.tunnelPid) {
  $process = Get-Process -Id $state.tunnelPid -ErrorAction SilentlyContinue
  if ($process -and $process.ProcessName -eq 'cloudflared') {
    Stop-Process -Id $state.tunnelPid
    Write-Output 'Classroom HTTPS tunnel stopped.'
  }
}

if ($state.ragOwned -and $state.ragPid) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($state.ragPid)" -ErrorAction SilentlyContinue
  if ($process -and $process.CommandLine -match 'rag_http_server' -and $process.CommandLine -match '--port 8770') {
    Stop-Process -Id $state.ragPid
    Write-Output 'Classroom RAG API stopped.'
  }
}

Remove-Item -LiteralPath $stateFile -Force
Write-Output 'Only services started by classroom-start.ps1 were stopped.'
