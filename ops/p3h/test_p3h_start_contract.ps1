$ErrorActionPreference = 'Stop'

# P3H 候選環境的最小契約測試：絕不啟動服務。
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$starter = Join-Path $root 'ops\p3h\start-p3h-isolated.ps1'

function Assert-True([bool]$condition, [string]$message) {
  if (-not $condition) { throw "ASSERTION FAILED: $message" }
}

function Invoke-Contract([hashtable]$arguments) {
  $output = & $starter @arguments 2>&1
  $succeeded = $?
  return [pscustomobject]@{ ExitCode = $(if ($succeeded) { 0 } else { 1 }); Output = ($output -join "`n") }
}

function With-Override([hashtable]$source, [hashtable]$override) {
  $copy = @{}
  foreach ($key in $source.Keys) { $copy[$key] = $source[$key] }
  foreach ($key in $override.Keys) { $copy[$key] = $override[$key] }
  return $copy
}

$common = @{
  DryRun = $true
  DjangoPort = 8130
  LivePort = 8131
  EntryPort = 8132
  CandidateRoot = (Join-Path $env:TEMP 'fde-p3h-contract-test')
  DjangoAllowedHosts = '127.0.0.1,localhost'
  DjangoCsrfTrustedOrigins = 'http://127.0.0.1:8132'
  AssertionKey = 'test-assertion-key-not-for-production'
  GatewayKey = 'test-gateway-key-not-for-production'
}

$reserved = Invoke-Contract (With-Override $common @{ DjangoPort = 8022 })
Assert-True ($reserved.ExitCode -ne 0) '8022 must be rejected before any launch.'
Assert-True ($reserved.Output -match 'reserved') 'Reserved-port rejection must be explicit.'

$missing = Invoke-Contract (With-Override $common @{ AssertionKey = '' })
Assert-True ($missing.ExitCode -ne 0) 'Missing assertion key must fail closed.'
Assert-True ($missing.Output -match 'AssertionKey') 'Missing assertion key must identify the configuration error.'

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
try {
  $occupiedPort = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  $occupied = Invoke-Contract (With-Override $common @{ LivePort = $occupiedPort })
  Assert-True ($occupied.ExitCode -ne 0) 'An already occupied candidate port must be rejected.'
  Assert-True ($occupied.Output -match 'already in use') 'Occupied-port rejection must be explicit.'
} finally {
  $listener.Stop()
}

$valid = Invoke-Contract $common
Assert-True ($valid.ExitCode -eq 0) 'An explicit isolated dry-run contract must validate.'
Assert-True ($valid.Output -match 'candidate_contract_valid') 'Dry-run must report a valid candidate contract.'

Write-Output 'PASS: P3H start contract rejects unsafe settings and accepts isolated dry-run settings.'
