$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# One idempotent classroom bootstrap for the existing v1.5B services.
$V15Root = 'C:\Users\admin\Documents\Codex\2026-08-30\new-chat\FDE-AI-v1.5\student_portal'
$RagRoot = 'D:\FDE-AI\rag\f450_v1\runtime'
$DjangoPort = 8022
$RagPort = 8770
$FixedUrl = 'https://fde-ai-gateway.fde-ai-gateway.workers.dev'
$WorkerName = 'fde-ai-gateway'
$CloudflaredPath = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
$PreferredStateRoot = Join-Path $env:LOCALAPPDATA 'FDE-AI\classroom'
$StateRoot = Join-Path $env:TEMP 'fde-ai-v15b-classroom'
$PreferredLogRoot = 'D:\FDE-AI\logs'
$LogRoot = Join-Path $env:TEMP 'fde-ai-v15b-classroom\logs'
$ServiceLogRoot = Join-Path $LogRoot 'services'
$StartupLog = Join-Path $LogRoot 'startup.log'
$TunnelState = Join-Path $StateRoot 'current-tunnel.json'
$WranglerCache = Join-Path $StateRoot 'npm-cache'
$CachedWrangler = 'C:\Users\admin\AppData\Local\npm-cache\_npx\32026684e21afda6\node_modules\wrangler\bin\wrangler.js'
$MaxAttempts = 4
$RetryDelaySeconds = 12

try {
  New-Item -ItemType Directory -Force -Path $PreferredStateRoot | Out-Null
  $stateProbe = Join-Path $PreferredStateRoot '.write-test'
  'ok' | Set-Content -LiteralPath $stateProbe -Encoding UTF8
  Remove-Item -LiteralPath $stateProbe -Force
  $StateRoot = $PreferredStateRoot
} catch {
  $StateRoot = Join-Path $env:TEMP 'fde-ai-v15b-classroom'
}
New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null
try {
  New-Item -ItemType Directory -Force -Path $PreferredLogRoot | Out-Null
  $probe = Join-Path $PreferredLogRoot '.write-test'
  'ok' | Set-Content -LiteralPath $probe -Encoding UTF8
  Remove-Item -LiteralPath $probe -Force
  $LogRoot = $PreferredLogRoot
} catch {
  # Some Windows policies block user processes from writing the D: data volume.
  # Keep startup reliable and record the fallback location in the user profile.
  $LogRoot = Join-Path $env:TEMP 'fde-ai-v15b-classroom\logs'
}
$ServiceLogRoot = Join-Path $LogRoot 'services'
$StartupLog = Join-Path $LogRoot 'startup.log'
New-Item -ItemType Directory -Force -Path $LogRoot, $ServiceLogRoot | Out-Null

function Write-Log([string]$Message) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz') $Message"
  Add-Content -LiteralPath $StartupLog -Value $line -Encoding UTF8
  Write-Output $line
}

function Test-Http([string]$Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 -MaximumRedirection 0
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
  } catch {
    # Windows PowerShell may fail Schannel validation for Cloudflare edge
    # certificates even though the browser and Node HTTPS stack are healthy.
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($node) {
      & $node.Source -e "fetch(process.argv[1]).then(r => { if (r.status < 200 || r.status >= 300) process.exitCode = 1 }).catch(() => { process.exitCode = 1 })" $Url *> $null
      return $LASTEXITCODE -eq 0
    }
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

function Wait-Network([int]$Seconds) {
  for ($i = 0; $i -lt $Seconds; $i++) {
    try {
      if (Test-NetConnection -ComputerName '1.1.1.1' -Port 443 -InformationLevel Quiet -WarningAction SilentlyContinue) { return $true }
    } catch { }
    Start-Sleep -Seconds 1
  }
  return $false
}

function Resolve-Python {
  $candidate = Join-Path $V15Root '.venv\Scripts\python.exe'
  if (Test-Path $candidate) { return $candidate }
  throw "v1.5B Python environment not found: $candidate"
}

function Resolve-PyLauncher {
  $command = Get-Command py.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  throw 'Python launcher py.exe was not found for the RAG service.'
}

function Start-RagIfNeeded {
  $health = "http://127.0.0.1:$RagPort/api/rag/health"
  if (Test-Http $health) { Write-Log 'RAG already healthy; SKIP start.'; return }
  $py = Resolve-PyLauncher
  $out = Join-Path $ServiceLogRoot 'rag.stdout.log'
  $err = Join-Path $ServiceLogRoot 'rag.stderr.log'
  Write-Log 'RAG not healthy; starting existing RAG runtime.'
  Start-Process -FilePath $py -ArgumentList @('-3', 'rag_http_server.py', '--host', '127.0.0.1', '--port', "$RagPort") -WorkingDirectory $RagRoot -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err | Out-Null
  if (-not (Wait-Http $health 45)) { throw "RAG health check failed; see $err" }
  Write-Log 'RAG health check PASS.'
}

function Start-DjangoIfNeeded {
  $health = "http://127.0.0.1:$DjangoPort/"
  if (Test-Http $health) { Write-Log 'Django already healthy; SKIP start.'; return }
  $python = Resolve-Python
  $out = Join-Path $ServiceLogRoot 'django.stdout.log'
  $err = Join-Path $ServiceLogRoot 'django.stderr.log'
  Write-Log 'Django not healthy; starting v1.5B server.'
  Start-Process -FilePath $python -ArgumentList @('manage.py', 'runserver', "127.0.0.1:$DjangoPort", '--noreload', '--insecure') -WorkingDirectory $V15Root -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err | Out-Null
  if (-not (Wait-Http $health 45)) { throw "Django health check failed; see $err" }
  Write-Log 'Django health check PASS.'
}

function Get-CurrentTunnel {
  if (-not (Test-Path $TunnelState)) { return $null }
  try {
    $state = Get-Content -LiteralPath $TunnelState -Raw | ConvertFrom-Json
    if ($state.url -and $state.pid -and (Get-Process -Id ([int]$state.pid) -ErrorAction SilentlyContinue) -and (Test-Http "$($state.url)/")) {
      return $state
    }
  } catch {
    Write-Log "Existing tunnel state ignored: $($_.Exception.Message)"
  }
  return $null
}

function Start-TunnelIfNeeded {
  $existing = Get-CurrentTunnel
  if ($existing) { Write-Log "Cloudflare Tunnel already healthy; SKIP start ($($existing.url))."; return $existing }
  $unmanaged = @(Get-Process -Name cloudflared -ErrorAction SilentlyContinue)
  if ($unmanaged.Count -gt 0) {
    throw 'cloudflared is already running but has no healthy managed state; refusing to create a duplicate tunnel.'
  }
  if (-not (Test-Path $CloudflaredPath)) { throw "cloudflared not found: $CloudflaredPath" }
  $out = Join-Path $ServiceLogRoot 'cloudflared.stdout.log'
  $err = Join-Path $ServiceLogRoot 'cloudflared.stderr.log'
  Remove-Item -LiteralPath $out, $err -Force -ErrorAction SilentlyContinue
  Write-Log 'Cloudflare Tunnel not healthy; starting Quick Tunnel to existing Django port.'
  $process = Start-Process -FilePath $CloudflaredPath -ArgumentList @('tunnel', '--no-autoupdate', '--url', "http://127.0.0.1:$DjangoPort") -WorkingDirectory $StateRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
  $url = $null
  for ($i = 0; $i -lt 90 -and -not $url; $i++) {
    Start-Sleep -Seconds 1
    $text = ((Get-Content -LiteralPath $out -Raw -ErrorAction SilentlyContinue) + "`n" + (Get-Content -LiteralPath $err -Raw -ErrorAction SilentlyContinue))
    $match = [regex]::Match($text, 'https://[a-z0-9-]+\.trycloudflare\.com')
    if ($match.Success) { $url = $match.Value }
    if (-not (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) { throw "cloudflared exited before creating a tunnel; see $err" }
  }
  if (-not $url) { throw "cloudflared did not provide a URL within 90 seconds; see $err" }
  if (-not (Wait-Http "$url/" 90)) { throw "Tunnel URL is not reachable: $url" }
  $state = [ordered]@{ pid = $process.Id; url = $url; updatedAt = [DateTimeOffset]::UtcNow.ToString('o') }
  ($state | ConvertTo-Json) | Set-Content -LiteralPath $TunnelState -Encoding UTF8
  Write-Log "Cloudflare Tunnel health check PASS: $url"
  return [pscustomobject]$state
}

function Load-WranglerToken {
  if ($env:CLOUDFLARE_API_TOKEN) { return }
  $config = Join-Path $env:APPDATA 'xdg.config\.wrangler\config\default.toml'
  if (Test-Path $config) {
    $match = [regex]::Match((Get-Content -LiteralPath $config -Raw), '(?m)^oauth_token\s*=\s*"([^"]+)"')
    if ($match.Success) { $env:CLOUDFLARE_API_TOKEN = $match.Groups[1].Value }
  }
  if (-not $env:CLOUDFLARE_API_TOKEN) { throw 'Cloudflare authentication unavailable; run wrangler login once for this Windows user.' }
}

function Update-GatewayOrigin([string]$OriginUrl) {
  Load-WranglerToken
  $wranglerLog = Join-Path $LogRoot 'wrangler-origin.log'
  Write-Log 'Updating fixed Gateway CURRENT_ORIGIN_URL.'
  $env:npm_config_offline = 'false'
  $env:NPM_CONFIG_OFFLINE = 'false'
  New-Item -ItemType Directory -Force -Path $WranglerCache | Out-Null
  if (Test-Path $CachedWrangler) {
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $output = $OriginUrl | & $node $CachedWrangler secret put ORIGIN_URL --name $WorkerName 2>&1
  } else {
    $output = $OriginUrl | & npx.cmd --yes --prefer-online --cache $WranglerCache wrangler secret put ORIGIN_URL --name $WorkerName 2>&1
  }
  $output | Set-Content -LiteralPath $wranglerLog -Encoding UTF8
  if ($LASTEXITCODE -ne 0) { throw "Gateway Origin update failed; see $wranglerLog" }
  Write-Log 'Gateway Origin update PASS.'
}

function Test-FixedGateway {
  if (-not (Wait-Http "$FixedUrl/login/" 45)) { throw 'Fixed Gateway did not switch to ONLINE within 45 seconds.' }
  Write-Log 'Fixed Gateway ONLINE health check PASS.'
}

if (-not (Test-Path (Join-Path $V15Root 'manage.py'))) { throw "v1.5B manage.py not found: $V15Root" }
if (-not (Test-Path (Join-Path $RagRoot 'rag_http_server.py'))) { throw "RAG runtime not found: $RagRoot" }

Write-Log '===== FDE-AI v1.5B AUTO START BEGIN ====='
$networkReady = Wait-Network 180
if (-not $networkReady) { Write-Log 'Public network check did not pass within 180 seconds; continuing to retry service startup.' }

$success = $false
for ($attempt = 1; $attempt -le $MaxAttempts -and -not $success; $attempt++) {
  try {
    Write-Log "Startup attempt $attempt/$MaxAttempts."
    Start-RagIfNeeded
    Start-DjangoIfNeeded
    $tunnel = Start-TunnelIfNeeded
    Update-GatewayOrigin $tunnel.url
    Test-FixedGateway
    Write-Log '===== FDE-AI v1.5B ONLINE PASS ====='
    $success = $true
  } catch {
    Write-Log "Startup attempt $attempt FAILED: $($_.Exception.Message)"
    if ($attempt -lt $MaxAttempts) { Start-Sleep -Seconds $RetryDelaySeconds }
  }
}

if (-not $success) {
  Write-Log '===== FDE-AI v1.5B AUTO START FAIL ====='
  exit 1
}
