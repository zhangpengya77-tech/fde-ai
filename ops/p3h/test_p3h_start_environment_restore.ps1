$ErrorActionPreference = 'Stop'

function Get-FreeLoopbackPort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  try {
    $listener.Start()
    return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  } finally {
    $listener.Stop()
  }
}

$starter = Join-Path $PSScriptRoot 'start-p3h-isolated.ps1'
$stopper = Join-Path $PSScriptRoot 'stop-p3h-isolated.ps1'
$root = Join-Path ([IO.Path]::GetTempPath()) ("fde-p3h-env-restore-" + [Guid]::NewGuid().ToString('N'))
$djangoPort = Get-FreeLoopbackPort
$livePort = Get-FreeLoopbackPort
$entryPort = Get-FreeLoopbackPort
while ($livePort -eq $djangoPort) { $livePort = Get-FreeLoopbackPort }
while ($entryPort -eq $djangoPort -or $entryPort -eq $livePort) { $entryPort = Get-FreeLoopbackPort }

$original = [Environment]::GetEnvironmentVariable('FDE_GATEWAY_DJANGO_ORIGIN', 'Process')
[Environment]::SetEnvironmentVariable('FDE_GATEWAY_DJANGO_ORIGIN', 'p3h-sentinel-origin', 'Process')
try {
  & $starter -Start -DjangoPort $djangoPort -LivePort $livePort -EntryPort $entryPort -CandidateRoot $root -DjangoAllowedHosts '127.0.0.1,localhost' -DjangoCsrfTrustedOrigins "http://127.0.0.1:$entryPort" -AssertionKey 'test-assertion-key' -GatewayKey 'test-gateway-key'
  if ($LASTEXITCODE -ne 0) { throw 'ASSERTION FAILED: isolated starter must succeed.' }
  $after = [Environment]::GetEnvironmentVariable('FDE_GATEWAY_DJANGO_ORIGIN', 'Process')
  if ($after -ne 'p3h-sentinel-origin') { throw 'ASSERTION FAILED: starter must restore FDE_GATEWAY_DJANGO_ORIGIN.' }
  Write-Output 'PASS: P3H starter restores its gateway Django-origin environment variable.'
} finally {
  if (Test-Path -LiteralPath (Join-Path $root 'p3h-state.json')) {
    & $stopper -CandidateRoot $root
  }
  [Environment]::SetEnvironmentVariable('FDE_GATEWAY_DJANGO_ORIGIN', $original, 'Process')
}
