$ErrorActionPreference = 'Stop'

# P3H 停止器必須拒絕狀態檔與實際程序不一致的情況，避免 PID 重用誤殺。
$root = Join-Path $env:TEMP 'fde-p3h-process-contract'
$stopper = Join-Path (Split-Path -Parent $PSScriptRoot) 'p3h\stop-p3h-isolated.ps1'
New-Item -ItemType Directory -Force -Path $root | Out-Null

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$occupiedPort = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
$state = [ordered]@{
  services = @(
    [ordered]@{
      name = 'fake'
      port = $occupiedPort
      launcher_pid = $PID
      listener_pid = $PID
      listener_started_at = '1900-01-01T00:00:00.0000000+00:00'
      command_fragment = 'definitely-not-this-powershell'
    }
  )
}
$state | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $root 'p3h-state.json') -Encoding utf8

$output = & $stopper -CandidateRoot $root -WhatIf 2>&1
try {
  if ($LASTEXITCODE -eq 0) { throw 'ASSERTION FAILED: mismatched PID identity must not be accepted.' }
  if (($output -join "`n") -notmatch 'identity mismatch') { throw 'ASSERTION FAILED: mismatched PID identity must be reported.' }
} finally {
  $listener.Stop()
  Remove-Item -LiteralPath $root -Recurse -Force
}
Write-Output 'PASS: P3H stopper rejects a stale or PID-reused state file without terminating a process.'
