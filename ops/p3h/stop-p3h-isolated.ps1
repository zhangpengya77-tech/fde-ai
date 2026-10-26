[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory = $true)][string]$CandidateRoot
)

$ErrorActionPreference = 'Stop'
$stateFile = Join-Path $CandidateRoot 'p3h-state.json'
if (-not (Test-Path -LiteralPath $stateFile)) {
  Write-Output 'P3H state file is absent; no process was stopped.'
  exit 0
}

$state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
if (-not $state.services) {
  Write-Output 'P3H state file has no verified service identities; refusing to stop anything.'
  exit 1
}

function Get-ProcessRecord([int]$Id) {
  Get-CimInstance Win32_Process -Filter "ProcessId=$Id" -ErrorAction SilentlyContinue
}

foreach ($service in $state.services) {
  $listener = Get-NetTCPConnection -State Listen -LocalPort ([int]$service.port) -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $listener) {
    Write-Output "$($service.name): listener already absent; no action."
    continue
  }
  if ([int]$listener.OwningProcess -ne [int]$service.listener_pid) {
    Write-Output "$($service.name): identity mismatch; port owner differs from recorded listener PID."
    exit 1
  }
  $process = Get-ProcessRecord ([int]$service.listener_pid)
  if (-not $process -or [string]::IsNullOrWhiteSpace([string]$process.CommandLine) -or $process.CommandLine -notlike "*$($service.command_fragment)*") {
    Write-Output "$($service.name): identity mismatch; command line does not match P3H state."
    exit 1
  }
  $actualStarted = if ($process.CreationDate -is [datetime]) {
    $process.CreationDate.ToUniversalTime().ToString('o')
  } else {
    ([System.Management.ManagementDateTimeConverter]::ToDateTime([string]$process.CreationDate)).ToUniversalTime().ToString('o')
  }
  # CIM 與 JSON 在 Windows 可能以不同精度序列化；允許一秒內的格式差異，
  # 仍可攔截 PID 被重用後的不同建立時間。
  try {
    # PowerShell 會把 ISO 8601 JSON 時間自動反序列化為 DateTime；若先轉字串，
    # 會遺失原本的 Z/offset 並在不同文化設定下被當成本地時間。
    $recordedStarted = if ($service.listener_started_at -is [datetime]) {
      [DateTimeOffset]$service.listener_started_at.ToUniversalTime()
    } else {
      [DateTimeOffset]::Parse([string]$service.listener_started_at).ToUniversalTime()
    }
    $actualStartedAt = [DateTimeOffset]::Parse($actualStarted).ToUniversalTime()
    $sameProcess = [Math]::Abs(($actualStartedAt - $recordedStarted).TotalSeconds) -lt 1
  } catch {
    $sameProcess = $false
  }
  if (-not $sameProcess) {
    Write-Output "$($service.name): identity mismatch; process start time differs from P3H state."
    exit 1
  }
  if ($PSCmdlet.ShouldProcess("PID $($service.listener_pid)", "Stop verified P3H $($service.name) listener")) {
    Stop-Process -Id ([int]$service.listener_pid) -ErrorAction Stop
    if ($service.launcher_pid -and [int]$service.launcher_pid -ne [int]$service.listener_pid) {
      $launcher = Get-ProcessRecord ([int]$service.launcher_pid)
      if ($launcher -and $launcher.CommandLine -like "*$($service.command_fragment)*") {
        Stop-Process -Id ([int]$service.launcher_pid) -ErrorAction SilentlyContinue
      }
    }
    Write-Output "$($service.name): verified P3H process stopped."
  }
}
