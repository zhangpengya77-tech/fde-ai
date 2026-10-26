[CmdletBinding()]
param(
  [switch]$DryRun,
  [switch]$Start,
  [int]$DjangoPort = 8130,
  [int]$LivePort = 8131,
  [int]$EntryPort = 8132,
  [string]$CandidateRoot,
  [string]$DjangoAllowedHosts,
  [string]$DjangoCsrfTrustedOrigins,
  [string]$AssertionKey,
  [string]$GatewayKey
)

$ErrorActionPreference = 'Stop'

# 候選程序啟動前清除所有 proxy 環境變數：本機 session 可能同時存在大小寫重複的
# proxy 鍵（https_proxy / HTTPS_PROXY），會導致 Start-Process 拋出
# 「Item has already been added」；且 localhost 呼叫不應被代理攔截。
# 此清除僅作用於本啟動子程序（powershell -File），不影響父 session。
foreach ($pname in @('http_proxy','https_proxy','HTTP_PROXY','HTTPS_PROXY','all_proxy','ALL_PROXY','no_proxy','NO_PROXY')) {
  [Environment]::SetEnvironmentVariable($pname, $null, 'Process')
}

function Stop-UnsafeCandidate([string]$Message) {
  # 失敗訊息僅描述候選設定，不包含任何秘密值。
  Write-Output $Message
  exit 1
}

function Test-LoopbackPortFree([int]$Port) {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $async = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(250)) { return $true }
    $client.EndConnect($async)
    return $false
  } catch {
    return $true
  } finally {
    $client.Dispose()
  }
}

function Get-P3hListenerIdentity([string]$Name, [int]$Port, [int]$LauncherPid, [string]$CommandFragment) {
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
      $record = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
      if ($record -and $record.CommandLine -like "*$CommandFragment*") {
        $startedAt = if ($record.CreationDate -is [datetime]) {
          $record.CreationDate.ToUniversalTime().ToString('o')
        } else {
          ([System.Management.ManagementDateTimeConverter]::ToDateTime([string]$record.CreationDate)).ToUniversalTime().ToString('o')
        }
        return [ordered]@{
          name = $Name
          port = $Port
          launcher_pid = $LauncherPid
          listener_pid = [int]$listener.OwningProcess
          listener_started_at = $startedAt
          command_fragment = $CommandFragment
        }
      }
    }
    Start-Sleep -Milliseconds 250
  }
  Stop-UnsafeCandidate "P3H $Name did not create the expected listener on 127.0.0.1:$Port."
}

# P3H 僅允許使用隔離候選埠，永不碰觸既有正式服務。
$reservedPorts = @(8022, 8030, 8770)
$ports = @($DjangoPort, $LivePort, $EntryPort)
if (($ports | Select-Object -Unique).Count -ne $ports.Count) {
  Stop-UnsafeCandidate 'P3H candidate ports must be distinct.'
}
foreach ($port in $ports) {
  if ($reservedPorts -contains $port) {
    Stop-UnsafeCandidate "Port $port is reserved and cannot be used by P3H."
  }
  if ($port -lt 1024 -or $port -gt 65535) {
    Stop-UnsafeCandidate "Port $port is outside the allowed TCP range."
  }
}

# 必要的 Django／Gateway 信任設定缺失時直接拒絕；不得降級為匿名或角色標頭模式。
$required = @{
  CandidateRoot = $CandidateRoot
  DjangoAllowedHosts = $DjangoAllowedHosts
  DjangoCsrfTrustedOrigins = $DjangoCsrfTrustedOrigins
  AssertionKey = $AssertionKey
  GatewayKey = $GatewayKey
}
foreach ($setting in $required.GetEnumerator()) {
  if ([string]::IsNullOrWhiteSpace([string]$setting.Value)) {
    Stop-UnsafeCandidate "$($setting.Key) is required for the isolated P3H candidate."
  }
}
if ($DjangoAllowedHosts -match '\*' -or $DjangoCsrfTrustedOrigins -match '\*') {
  Stop-UnsafeCandidate 'Wildcard Host or CSRF origins are not allowed for P3H.'
}
foreach ($port in $ports) {
  if (-not (Test-LoopbackPortFree $port)) {
    Stop-UnsafeCandidate "Candidate port $port is already in use; choose another port and do not stop its owner."
  }
}

if ($Start -and $DryRun) {
  Stop-UnsafeCandidate 'P3H cannot combine -Start with -DryRun.'
}

if ($DryRun) {
  [ordered]@{
    status = 'candidate_contract_valid'
    django_port = $DjangoPort
    live_port = $LivePort
    entry_port = $EntryPort
    candidate_root = $CandidateRoot
    production_services_touched = $false
  } | ConvertTo-Json -Compress
  exit 0
}

if (-not $Start) {
  Stop-UnsafeCandidate 'Specify -DryRun to validate or -Start to launch the isolated candidate.'
}

# 啟動僅使用 P3H 自己的 SQLite、媒體、log 與 state 目錄；不共用正式資料。
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$djangoRoot = Join-Path $projectRoot 'student_portal'
$liveRoot = Join-Path $projectRoot 'live_backend'
$entryScript = Join-Path $projectRoot 'demo\tools\static_entry_server.py'
$python = (Get-Command python -ErrorAction Stop).Source
foreach ($path in @($djangoRoot, $liveRoot, $entryScript)) {
  if (-not (Test-Path -LiteralPath $path)) { Stop-UnsafeCandidate "P3H source is missing: $path" }
}
New-Item -ItemType Directory -Force -Path $CandidateRoot, (Join-Path $CandidateRoot 'media'), (Join-Path $CandidateRoot 'logs') | Out-Null

$saved = @{}
foreach ($name in @('DJANGO_DEBUG','DJANGO_SETTINGS_MODULE','DJANGO_DB_NAME','DJANGO_MEDIA_ROOT','DJANGO_ALLOWED_HOSTS','DJANGO_CSRF_TRUSTED_ORIGINS','FDE_LIVE_ASSERTION_KEY','FDE_GATEWAY_INTERNAL_AUTH_KEY','FDE_LIVE_PROXY_KEY','FDE_DJANGO_PORTAL_URL','FDE_GATEWAY_DJANGO_ORIGIN','FDE_LIVE_DEV_MODE','FDE_ENTRY_BIND','FDE_ENTRY_PORT','FDE_ENTRY_UPSTREAM_HOST','FDE_ENTRY_UPSTREAM_PORT','FDE_ENTRY_ALLOWED_HOSTS','FDE_ENTRY_TRUSTED_ORIGINS','FDE_ENTRY_PUBLIC_SCHEME')) {
  $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
try {
  $env:DJANGO_DEBUG = 'true'
  # `manage.py` 預設設定不得依賴呼叫端環境；候選子程序明確指定 v2.0 settings。
  $env:DJANGO_SETTINGS_MODULE = 'config.settings'
  $env:DJANGO_DB_NAME = Join-Path $CandidateRoot 'p3h.sqlite3'
  $env:DJANGO_MEDIA_ROOT = Join-Path $CandidateRoot 'media'
  # 隔離 Django 同時是 Gateway 的 Assertion 上游；Gateway 以 http://127.0.0.1:<DjangoPort>
  # 回呼 Django，故需將該 origin 同時列入 ALLOWED_HOSTS 與 CSRF_TRUSTED_ORIGINS（明確主機，非萬用字元）。
  $env:DJANGO_ALLOWED_HOSTS = "127.0.0.1,localhost,127.0.0.1:$DjangoPort"
  $env:DJANGO_CSRF_TRUSTED_ORIGINS = "http://127.0.0.1:$EntryPort,http://127.0.0.1:$DjangoPort"
  $env:FDE_LIVE_ASSERTION_KEY = $AssertionKey
  $env:FDE_GATEWAY_INTERNAL_AUTH_KEY = $GatewayKey
  $env:FDE_LIVE_PROXY_KEY = $GatewayKey
  $env:FDE_DJANGO_PORTAL_URL = "http://127.0.0.1:$DjangoPort"
  # Gateway 簽發 Assertion 時回呼的 Django origin（必須指向隔離 Django，絕不可使用預設 8022 正式服務）。
  $env:FDE_GATEWAY_DJANGO_ORIGIN = "http://127.0.0.1:$DjangoPort"
  $env:FDE_LIVE_DEV_MODE = 'false'
  $env:FDE_ENTRY_BIND = '127.0.0.1'
  $env:FDE_ENTRY_PORT = "$EntryPort"
  $env:FDE_ENTRY_UPSTREAM_HOST = '127.0.0.1'
  $env:FDE_ENTRY_UPSTREAM_PORT = "$LivePort"
  $env:FDE_ENTRY_ALLOWED_HOSTS = "127.0.0.1:$EntryPort,localhost:$EntryPort"
  $env:FDE_ENTRY_TRUSTED_ORIGINS = "http://127.0.0.1:$EntryPort"
  $env:FDE_ENTRY_PUBLIC_SCHEME = 'http'

  # 隔離 SQLite 建立 schema；此命令只會碰觸 CandidateRoot 指定的資料庫。
  Push-Location $djangoRoot
  try {
    & $python manage.py migrate --noinput | Out-File -LiteralPath (Join-Path $CandidateRoot 'logs\django-migrate.log') -Encoding utf8
    if ($LASTEXITCODE -ne 0) { Stop-UnsafeCandidate 'P3H isolated Django migration failed; no services were started.' }
  } finally {
    Pop-Location
  }

  $django = Start-Process -FilePath $python -ArgumentList @('manage.py','runserver',"127.0.0.1:$DjangoPort",'--noreload') -WorkingDirectory $djangoRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $CandidateRoot 'logs\django.out.log') -RedirectStandardError (Join-Path $CandidateRoot 'logs\django.err.log')
  # P3-H：Live 元件改以 gateway_main:app 啟動，使 IdentityGateway 位於候選入口與 Live 之間，
  # 形成 Browser -> Entry -> IdentityGateway -> Live 之真實 HTTP 鏈（Django 僅作 Assertion 簽發方）。
  $live = Start-Process -FilePath $python -ArgumentList @('-m','uvicorn','gateway_main:app','--host','127.0.0.1','--port',"$LivePort") -WorkingDirectory $liveRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $CandidateRoot 'logs\live.out.log') -RedirectStandardError (Join-Path $CandidateRoot 'logs\live.err.log')
  $entry = Start-Process -FilePath $python -ArgumentList @($entryScript) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $CandidateRoot 'logs\entry.out.log') -RedirectStandardError (Join-Path $CandidateRoot 'logs\entry.err.log')
  $services = @(
    (Get-P3hListenerIdentity 'django' $DjangoPort $django.Id "manage.py runserver 127.0.0.1:$DjangoPort"),
    (Get-P3hListenerIdentity 'live' $LivePort $live.Id '-m uvicorn gateway_main:app'),
    (Get-P3hListenerIdentity 'entry' $EntryPort $entry.Id 'static_entry_server.py')
  )
  [ordered]@{ services=$services; candidate_root=$CandidateRoot; started_at=[DateTimeOffset]::UtcNow.ToString('o') } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $CandidateRoot 'p3h-state.json') -Encoding utf8
  Write-Output (ConvertTo-Json ([ordered]@{status='p3h_started'; django_port=$DjangoPort; live_port=$LivePort; entry_port=$EntryPort; state_file=(Join-Path $CandidateRoot 'p3h-state.json')} ) -Compress)
} finally {
  foreach ($pair in $saved.GetEnumerator()) { [Environment]::SetEnvironmentVariable($pair.Key, $pair.Value, 'Process') }
}
