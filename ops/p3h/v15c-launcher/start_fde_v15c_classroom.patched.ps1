param(
  [switch]$OpenBrowser
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$GatewayRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$V15Root = 'D:\FDE-AI-UAS\v1.5C\student_portal'
$DjangoPython = 'C:\Users\admin\Documents\Codex\2026-08-30\new-chat\FDE-AI-v1.5\student_portal\.venv\Scripts\python.exe'
$PythonLauncher = 'C:\Users\admin\AppData\Local\Python\pythoncore-3.14-64\python.exe'
$NpxCommand = 'C:\Program Files\nodejs\npx.cmd'
$FfmpegBin = 'D:\FDE-AI-Tools\ffmpeg-9.0.2\package\ffmpeg-9.0.2-essentials_build\bin'
$FfmpegExecutable = Join-Path $FfmpegBin 'ffmpeg.exe'
$FfprobeExecutable = Join-Path $FfmpegBin 'ffprobe.exe'
$env:DJANGO_DB_NAME = 'C:\Users\admin\Documents\Codex\2026-08-30\new-chat\FDE-AI-v1.5\student_portal\db.sqlite3'
$env:DJANGO_MEDIA_ROOT = 'C:\Users\admin\Documents\Codex\2026-08-30\new-chat\FDE-AI-v1.5\student_portal\private_media'
$env:DJANGO_FFMPEG_BINARY = $FfmpegExecutable
$env:DJANGO_FFPROBE_BINARY = $FfprobeExecutable
$env:PATH = "$FfmpegBin;$env:PATH"
$RagRoot = 'C:\Users\admin\Documents\Codex\2026-08-30\new-chat\FDE-AI\rag\f450_v1\runtime'
$DjangoPort = 8022
$RagPort = 8770
$WorkerName = 'fde-ai-gateway'
$FixedUrl = 'https://fde-ai-gateway.fde-ai-gateway.workers.dev'
$StateRoot = 'C:\Users\admin\AppData\Local\FDE-AI\classroom'
$LogRoot = Join-Path $GatewayRoot 'logs'
$TunnelUrlFile = Join-Path $StateRoot 'current-tunnel-url.txt'
$StartupErrorLog = Join-Path $StateRoot 'startup-error.log'
$StartupLog = Join-Path $StateRoot 'startup.log'
$TunnelStateFile = Join-Path $StateRoot 'tunnel-state.json'
$InstanceMutexName = 'Global\FDE-AI-v15C-Classroom-Startup'
$DjangoPidStateFile = Join-Path $StateRoot 'django-v15c-pid.json'

# P3-H Phase 17: process-ownership module (single source of truth, shared with contract tests).
$OwnershipModule = Join-Path $GatewayRoot 'V15C-Ownership.ps1'
if (-not (Test-Path -LiteralPath $OwnershipModule)) { throw "Ownership module not found: $OwnershipModule" }
. $OwnershipModule

trap {
  $_ | Out-File -FilePath $StartupErrorLog -Encoding utf8 -Append
  exit 1
}

New-Item -ItemType Directory -Force -Path $StateRoot, $LogRoot | Out-Null
Set-Location -LiteralPath $GatewayRoot

$instanceMutex = New-Object System.Threading.Mutex($false, $InstanceMutexName)
if (-not $instanceMutex.WaitOne(0)) {
  Add-Content -LiteralPath $StartupLog -Value "$(Get-Date -Format o) SKIP duplicate startup instance."
  exit 0
}

# Task Scheduler may start with a stale environment block. Load the persisted
# user-level SMTP settings into this process without printing credential values.
foreach ($name in @(
    'DJANGO_EMAIL_BACKEND', 'DJANGO_EMAIL_HOST', 'DJANGO_EMAIL_PORT',
    'DJANGO_EMAIL_HOST_USER', 'DJANGO_EMAIL_HOST_PASSWORD',
    'DJANGO_EMAIL_USE_TLS', 'DEFAULT_FROM_EMAIL'
)) {
  if (-not [Environment]::GetEnvironmentVariable($name, 'Process')) {
    $userValue = [Environment]::GetEnvironmentVariable($name, 'User')
    if ($userValue) { Set-Item -Path "Env:$name" -Value $userValue }
  }
}

# SMTP is optional for boot. Use only preconfigured environment variables;
# never prompt during automatic startup and never log credential values.
$smtpReady = $env:DJANGO_EMAIL_BACKEND -eq 'django.core.mail.backends.smtp.EmailBackend' -and
  $env:DJANGO_EMAIL_HOST -and $env:DJANGO_EMAIL_HOST_USER -and $env:DJANGO_EMAIL_HOST_PASSWORD
if ($smtpReady) {
  Add-Content -LiteralPath $StartupLog -Value "$(Get-Date -Format o) SMTP CONFIGURED; automatic startup will not prompt."
} else {
  Add-Content -LiteralPath $StartupLog -Value "$(Get-Date -Format o) SMTP NOT CONFIGURED; continuing classroom startup without email prompts."
}

# Task Scheduler is non-interactive, so pass the existing Wrangler login token
# to child Wrangler processes without storing it in this project or its logs.
if (-not $env:CLOUDFLARE_API_TOKEN) {
  $wranglerConfigCandidates = @(
    (Join-Path $env:APPDATA 'xdg.config\.wrangler\config\default.toml'),
    'C:\Users\admin\AppData\Roaming\xdg.config\.wrangler\config\default.toml'
  ) | Select-Object -Unique
  foreach ($wranglerConfig in $wranglerConfigCandidates) {
    if (-not (Test-Path $wranglerConfig)) { continue }
    $tokenMatch = [regex]::Match((Get-Content -Raw $wranglerConfig), '(?m)^oauth_token\s*=\s*"([^"]+)"')
    if ($tokenMatch.Success) {
      $env:CLOUDFLARE_API_TOKEN = $tokenMatch.Groups[1].Value
      break
    }
  }
}

function Test-Http([string]$Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 -MaximumRedirection 0
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -in @(301, 302, 303, 307, 308)) { return $true }
    return $false
  }
}

function Wait-Http([string]$Url, [int]$Seconds) {
  for ($i = 0; $i -lt $Seconds; $i++) {
    if (Test-Http $Url) { return $true }
    Start-Sleep -Seconds 1
  }
  return $false
}

function Test-NetworkReady() {
  try {
    Resolve-DnsName 'api.cloudflare.com' -ErrorAction Stop | Out-Null
    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.UseProxy = $false
    $client = New-Object System.Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(8)
    $response = $client.GetAsync('https://api.cloudflare.com/cdn-cgi/trace').GetAwaiter().GetResult()
    $ok = $response.IsSuccessStatusCode
    $client.Dispose()
    $handler.Dispose()
    return $ok
  } catch {
    return $false
  }
}

function Wait-NetworkReady([int]$Seconds = 300) {
  $attempts = [Math]::Ceiling($Seconds / 10)
  for ($i = 1; $i -le $attempts; $i++) {
    if (Test-NetworkReady) {
      Add-Content -LiteralPath $StartupLog -Value "$(Get-Date -Format o) NETWORK READY attempt=$i"
      return $true
    }
    Add-Content -LiteralPath $StartupLog -Value "$(Get-Date -Format o) NETWORK NOT READY attempt=$i; waiting_seconds=10"
    if ($i -lt $attempts) { Start-Sleep -Seconds 10 }
  }
  Add-Content -LiteralPath $StartupLog -Value "$(Get-Date -Format o) WARNING network did not become ready within ${Seconds}s."
  return $false
}

function Wait-TunnelReady([string]$Url, [int]$Seconds = 90) {
  $attempts = [Math]::Ceiling($Seconds / 5)
  $firstCheckAt = [DateTimeOffset]::Now
  $lastStatus = 0
  $lastError = ''
  Add-Content -LiteralPath $StartupLog -Value "$(Get-Date -Format o) TUNNEL WARMUP START url=$Url first_check=$($firstCheckAt.ToString('o')) max_seconds=$Seconds"
  for ($i = 1; $i -le $attempts; $i++) {
    try {
      $response = Invoke-WebRequest -Uri "$Url/login/" -UseBasicParsing -TimeoutSec 5 -MaximumRedirection 0
      $lastStatus = [int]$response.StatusCode
      $lastError = ''
    } catch {
      $lastStatus = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
      $lastError = $_.Exception.Message
    }
    $elapsed = [int](([DateTimeOffset]::Now - $firstCheckAt).TotalSeconds)
    Add-Content -LiteralPath $StartupLog -Value "$(Get-Date -Format o) TUNNEL WARMUP attempt=$i elapsed_seconds=$elapsed status=$lastStatus"
    if ($lastStatus -ge 200 -and $lastStatus -lt 400) {
      Add-Content -LiteralPath $StartupLog -Value "$(Get-Date -Format o) TUNNEL READY url=$Url status=$lastStatus elapsed_seconds=$elapsed"
      return [pscustomobject]@{ Ready = $true; Status = $lastStatus; ElapsedSeconds = $elapsed; FirstCheckAt = $firstCheckAt; Error = '' }
    }
    if ($i -lt $attempts) { Start-Sleep -Seconds 5 }
  }
  Add-Content -LiteralPath $StartupLog -Value "$(Get-Date -Format o) TUNNEL WARMUP FAILED url=$Url status=$lastStatus elapsed_seconds=$([int](([DateTimeOffset]::Now - $firstCheckAt).TotalSeconds)) error=$lastError"
  return [pscustomobject]@{ Ready = $false; Status = $lastStatus; ElapsedSeconds = [int](([DateTimeOffset]::Now - $firstCheckAt).TotalSeconds); FirstCheckAt = $firstCheckAt; Error = $lastError }
}

function Get-Listener([int]$Port) {
  return Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
}

function Read-TunnelState() {
  if (-not (Test-Path -LiteralPath $TunnelStateFile)) { return [pscustomobject]@{ failure_count = 0 } }
  try { return Get-Content -Raw -LiteralPath $TunnelStateFile | ConvertFrom-Json } catch { return [pscustomobject]@{ failure_count = 0 } }
}

function Write-TunnelState($state) {
  $state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $TunnelStateFile -Encoding utf8
}

function Get-RateLimitUntil($state) {
  if (-not $state.rate_limit_until) { return $null }
  try { return [DateTimeOffset]::Parse($state.rate_limit_until) } catch { return $null }
}

if (-not (Test-Path (Join-Path $V15Root 'manage.py'))) { throw "v1.5C manage.py not found: $V15Root" }
if (-not (Test-Path (Join-Path $RagRoot 'rag_http_server.py'))) { throw "RAG runtime not found: $RagRoot" }

# P3-H Phase 17: ownership is no longer decided by venv-shim path equality alone; never auto-kill.
# OWNED is never stopped; FOREIGN/UNKNOWN are never stopped either: startup aborts, conflict logged.
$django = Get-Listener $DjangoPort
if ($django) {
  $verdict = Test-IsV15CDjango -ListenerPid $django.OwningProcess -Port $DjangoPort -V15Root $V15Root -DjangoPython $DjangoPython -StateFile $DjangoPidStateFile -HealthUrl "http://127.0.0.1:$DjangoPort/login/" -HealthMarker 'FDE-AI'
  $reasonSummary = ($verdict.Reasons -join '; ')
  if ($verdict.Verdict -eq 'OWNED') {
    Add-Content -LiteralPath $StartupLog -Value "$(Get-Date -Format o) 8022 OWNED pid=$($django.OwningProcess); reuse; reasons=$reasonSummary"
  } else {
    Add-Content -LiteralPath $StartupLog -Value "$(Get-Date -Format o) 8022 $($verdict.Verdict) pid=$($django.OwningProcess); refusing to stop or start; manual intervention required; reasons=$reasonSummary"
    throw "Port $DjangoPort is occupied by a $($verdict.Verdict) process; no auto-kill by policy; manual intervention required."
  }
}
if (-not $django) {
  $djangoLog = Join-Path $LogRoot 'django.log'
  $djangoErr = Join-Path $LogRoot 'django.err.log'
  Start-Process -FilePath $DjangoPython `
    -ArgumentList @('manage.py', 'runserver', "127.0.0.1:$DjangoPort", '--noreload', '--insecure') `
    -WorkingDirectory $V15Root -WindowStyle Hidden -RedirectStandardOutput $djangoLog -RedirectStandardError $djangoErr | Out-Null
}
if (-not (Wait-Http "http://127.0.0.1:$DjangoPort/" 30)) { throw 'v1.5C Django did not become available.' }
# P3-H Phase 17: persist the PID state record (consistency signal for later ownership judgments).
# P3-H Phase 18: write it atomically and only when this launcher may own it. A refused
# write means another live process owns the record, or the record is corrupt; in both
# cases the file is left untouched by policy and the conflict is logged. Django is
# already online at this point, so the startup flow continues (aborting here would
# only cost availability without improving safety).
$startedListener = Get-Listener $DjangoPort
if ($startedListener) {
  $startedProc = Get-CimInstance Win32_Process -Filter "ProcessId=$($startedListener.OwningProcess)" -ErrorAction SilentlyContinue
  $startedCreated = if ($startedProc -and $startedProc.CreationDate) { ([datetime]$startedProc.CreationDate).ToUniversalTime().ToString('o') } else { '' }
  $stateClaim = Write-V15CStateRecord -StateFile $DjangoPidStateFile -ProcessId ([int]$startedListener.OwningProcess) -Port $DjangoPort -V15Root $V15Root -CreatedAtUtc $startedCreated
  if ($stateClaim.Written) {
    Add-Content -LiteralPath $StartupLog -Value "$(Get-Date -Format o) PID STATE WRITTEN pid=$($stateClaim.Pid) file=$DjangoPidStateFile"
  } else {
    Add-Content -LiteralPath $StartupLog -Value "$(Get-Date -Format o) PID STATE NOT WRITTEN reason=$($stateClaim.Reason) existing_pid=$($stateClaim.ExistingPid); state file left untouched by policy"
  }
}

if (-not (Test-Http "http://127.0.0.1:$RagPort/api/rag/health")) {
  $ragLog = Join-Path $LogRoot 'rag.log'
  $ragErr = Join-Path $LogRoot 'rag.err.log'
  Start-Process -FilePath $PythonLauncher -ArgumentList @('rag_http_server.py', '--host', '127.0.0.1', '--port', "$RagPort") `
    -WorkingDirectory $RagRoot -WindowStyle Hidden -RedirectStandardOutput $ragLog -RedirectStandardError $ragErr | Out-Null
}
if (-not (Wait-Http "http://127.0.0.1:$RagPort/api/rag/health" 30)) { throw 'Local RAG did not become healthy.' }

if (-not (Wait-NetworkReady 300)) {
  throw 'Network is not ready for Quick Tunnel startup.'
}

$cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
if (-not (Test-Path $cloudflared)) { $cloudflared = (Get-Command cloudflared.exe -ErrorAction SilentlyContinue).Source }
if (-not $cloudflared) { throw 'cloudflared.exe was not found.' }

$out = Join-Path $LogRoot 'cloudflared.out.log'
$err = Join-Path $LogRoot 'cloudflared.err.log'
$state = Read-TunnelState
$rateLimitUntil = Get-RateLimitUntil $state
if ($rateLimitUntil -and $rateLimitUntil -gt [DateTimeOffset]::Now) {
  $remainingSeconds = [int][Math]::Ceiling(($rateLimitUntil - [DateTimeOffset]::Now).TotalSeconds)
  if ($remainingSeconds -le 60) {
    $waitSeconds = [Math]::Max(1, $remainingSeconds + 5)
    Add-Content -LiteralPath $StartupLog -Value "$(Get-Date -Format o) BACKOFF NEAR EXPIRY; remaining_seconds=$remainingSeconds; waiting_seconds=$waitSeconds"
    Start-Sleep -Seconds $waitSeconds
  } else {
    throw "Quick Tunnel rate limited until $rateLimitUntil; backoff is active."
  }
}

$currentUrl = ''
$tunnelCreatedAt = $null
$existingTunnel = Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" |
  Where-Object { $_.CommandLine -match "127\.0\.0\.1:$DjangoPort" } | Select-Object -First 1
if ($existingTunnel -and $state.last_successful_tunnel -and (Wait-Http "$($state.last_successful_tunnel)/login/" 30)) {
  $currentUrl = $state.last_successful_tunnel
  Add-Content -LiteralPath $StartupLog -Value "$(Get-Date -Format o) REUSE existing tunnel=$currentUrl"
} else {
  if ($existingTunnel) { Stop-Process -Id $existingTunnel.ProcessId -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2 }
  $retryDelays = @(10, 20, 40, 60, 60)
  for ($attempt = 1; $attempt -le $retryDelays.Count -and -not $currentUrl; $attempt++) {
    Remove-Item $out, $err -Force -ErrorAction SilentlyContinue
    $startedTunnel = Start-Process -FilePath $cloudflared -ArgumentList @('tunnel', '--no-autoupdate', '--protocol', 'http2', '--edge-ip-version', '4', '--url', "http://127.0.0.1:$DjangoPort") `
      -PassThru `
      -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err
    for ($i = 0; $i -lt 60 -and -not $currentUrl; $i++) {
      Start-Sleep -Seconds 1
      $logText = ((Get-Content -Raw $out -ErrorAction SilentlyContinue) + "`n" + (Get-Content -Raw $err -ErrorAction SilentlyContinue))
      $match = [regex]::Match($logText, 'https://[a-z0-9-]+\.trycloudflare\.com')
      if ($match.Success) {
        $candidateUrl = $match.Value
        $warmup = Wait-TunnelReady $candidateUrl 90
        if ($warmup.Ready) {
          $currentUrl = $candidateUrl
          $tunnelCreatedAt = [DateTimeOffset]::Now
          Add-Content -LiteralPath $StartupLog -Value "$(Get-Date -Format o) TUNNEL CREATED url=$currentUrl created_at=$($tunnelCreatedAt.ToString('o')) attempt=$attempt"
        }
      }
    }
    if (-not $currentUrl) {
      Stop-Process -Id $startedTunnel.Id -Force -ErrorAction SilentlyContinue
      Add-Content -LiteralPath $StartupLog -Value "$(Get-Date -Format o) TUNNEL ATTEMPT $attempt FAILED; retrying after $($retryDelays[$attempt - 1]) seconds."
      if ($attempt -lt $retryDelays.Count) { Start-Sleep -Seconds $retryDelays[$attempt - 1] }
    }
  }
  if (-not $currentUrl) { throw "cloudflared did not produce a ready URL after $($retryDelays.Count) attempts. Check $err" }
}
[System.IO.File]::WriteAllText($TunnelUrlFile, $currentUrl + "`n", [System.Text.UTF8Encoding]::new($false))
if ((Get-Content -Raw $TunnelUrlFile).Trim() -ne $currentUrl) { throw "Could not persist current tunnel URL: $TunnelUrlFile" }
$wranglerLog = Join-Path $LogRoot 'wrangler.log'
if (-not $env:CLOUDFLARE_API_TOKEN) { throw 'Cloudflare authentication is unavailable. Run wrangler login once as this Windows user.' }
$wranglerOutput = $currentUrl | & $NpxCommand --yes wrangler secret put ORIGIN_URL --name $WorkerName 2>&1
$wranglerOutput | Set-Content -Path $wranglerLog -Encoding utf8
if ($LASTEXITCODE -ne 0) { throw "Cloudflare Worker Origin update failed. See $wranglerLog" }
$fixedRootReady = Wait-Http "$FixedUrl/" 30
$fixedLoginReady = Wait-Http "$FixedUrl/login/" 30
$fixedStudentReady = Wait-Http "$FixedUrl/student/growth/" 30
if (-not $fixedRootReady -or -not $fixedLoginReady -or -not $fixedStudentReady) {
  Add-Content -LiteralPath $StartupLog -Value "$(Get-Date -Format o) WARNING fixed Worker health check incomplete; root=$fixedRootReady; login=$fixedLoginReady; student_growth=$fixedStudentReady; Django and tunnel remain online."
}
$state = [pscustomobject]@{ failure_count = 0; last_tunnel_attempt = [DateTimeOffset]::Now.ToString('o'); last_successful_tunnel = $currentUrl; rate_limit_until = $null }
Write-TunnelState $state
Add-Content -LiteralPath $StartupLog -Value "$(Get-Date -Format o) ONLINE; django=PASS; rag=PASS; tunnel=$currentUrl; worker_origin=UPDATED; fixed_root=$fixedRootReady; login=$fixedLoginReady; student_growth=$fixedStudentReady"

Write-Output ''
Write-Output '================================='
Write-Output 'FDE-AI v1.5C ONLINE'
Write-Output "Fixed student URL: $FixedUrl"
Write-Output "Current tunnel: $currentUrl"
Write-Output "Django: RUNNING (127.0.0.1:$DjangoPort)"
Write-Output "RAG: RUNNING (127.0.0.1:$RagPort)"
Write-Output 'Gateway: UPDATED'
Write-Output '================================='

# The local address is an origin only; the classroom browser must stay on the fixed public host.
if ($OpenBrowser) { Start-Process $FixedUrl }
