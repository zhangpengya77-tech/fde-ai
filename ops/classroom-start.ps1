$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$projectRoot = Split-Path -Parent $PSScriptRoot
$fdeRoot = Split-Path -Parent (Split-Path -Parent $projectRoot)
$runtimeRoot = Join-Path $fdeRoot 'rag\f450_v1\runtime'
$stateRoot = Join-Path $env:LOCALAPPDATA 'FDE-AI\classroom'
$stateFile = Join-Path $stateRoot 'services.json'
$logRoot = Join-Path $env:TEMP 'fde-ai-classroom'
$pagesRoot = Join-Path $stateRoot 'gh-pages'
$apiHealth = 'http://127.0.0.1:8770/api/rag/health'

New-Item -ItemType Directory -Force -Path $stateRoot, $logRoot | Out-Null

function Test-Health([string]$url) {
  try {
    $result = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 3
    return $result.status -eq 'ok' -and $result.version -eq 'f450_v1' -and $result.index_loaded
  } catch {
    return $false
  }
}

function Wait-Health([string]$url, [int]$seconds) {
  for ($i = 0; $i -lt $seconds; $i++) {
    if (Test-Health $url) { return $true }
    Start-Sleep -Seconds 1
  }
  return $false
}

function Invoke-CheckedGit([string]$workingDirectory, [string[]]$gitArgs) {
  & git -C $workingDirectory @gitArgs
  if ($LASTEXITCODE -ne 0) { throw "Git command failed: git $($gitArgs -join ' ')" }
}

function Save-State {
  $state = [ordered]@{
    ragPid = $ragPid
    ragOwned = $ragOwned
    tunnelPid = $tunnelPid
    tunnelOwned = $tunnelOwned
    publicUrl = $publicUrl
    updatedAt = [DateTimeOffset]::UtcNow.ToString('o')
  }
  [System.IO.File]::WriteAllText($stateFile, ($state | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))
}

if (-not (Test-Path (Join-Path $runtimeRoot 'rag_http_server.py'))) {
  throw 'F450 RAG runtime was not found relative to this v1.2 installation.'
}

$ragOwned = $false
$ragPid = $null
$tunnelOwned = $false
$tunnelPid = $null
$publicUrl = $null

if (Test-Path $stateFile) {
  try {
    $previous = Get-Content -Raw $stateFile | ConvertFrom-Json
    if ($previous.ragOwned -and $previous.ragPid -and (Get-Process -Id $previous.ragPid -ErrorAction SilentlyContinue) -and (Test-Health $apiHealth)) {
      $ragPid = [int]$previous.ragPid
      $ragOwned = $true
    }
    if ($previous.tunnelPid -and (Get-Process -Id $previous.tunnelPid -ErrorAction SilentlyContinue) -and (Test-Health "$($previous.publicUrl)/api/rag/health")) {
      $tunnelPid = [int]$previous.tunnelPid
      $tunnelOwned = [bool]$previous.tunnelOwned
      $publicUrl = [string]$previous.publicUrl
    }
  } catch {
    # Ignore stale state and start a new managed tunnel.
  }
}

if (-not (Test-Health $apiHealth)) {
  $python = $null
  $pythonArgs = @()
  if ($env:FDE_RAG_PYTHON) {
    $python = $env:FDE_RAG_PYTHON
  } elseif (Get-Command py.exe -ErrorAction SilentlyContinue) {
    $python = (Get-Command py.exe).Source
    $pythonArgs += '-3'
  } elseif (Get-Command python.exe -ErrorAction SilentlyContinue) {
    $python = (Get-Command python.exe).Source
  }
  if (-not $python) { throw 'Python was not found. Set FDE_RAG_PYTHON to the Python executable used by F450 RAG.' }

  $ragOut = Join-Path $logRoot 'rag.stdout.log'
  $ragErr = Join-Path $logRoot 'rag.stderr.log'
  $ragArgs = $pythonArgs + @('-m', 'rag_http_server', '--host', '127.0.0.1', '--port', '8770')
  $ragProcess = Start-Process -FilePath $python -ArgumentList $ragArgs -WorkingDirectory $runtimeRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $ragOut -RedirectStandardError $ragErr
  $ragPid = $ragProcess.Id
  $ragOwned = $true
  if (-not (Wait-Health $apiHealth 30)) {
    Stop-Process -Id $ragPid -ErrorAction SilentlyContinue
    throw "Local RAG did not become healthy. Check $ragErr in the temporary classroom log folder."
  }
}
Save-State

if (-not $publicUrl) {
  $cloudflared = $null
  if (Get-Command cloudflared.exe -ErrorAction SilentlyContinue) {
    $cloudflared = (Get-Command cloudflared.exe).Source
  } elseif (${env:ProgramFiles(x86)}) {
    $candidate = Join-Path ${env:ProgramFiles(x86)} 'cloudflared\cloudflared.exe'
    if (Test-Path $candidate) { $cloudflared = $candidate }
  }
  if (-not $cloudflared) { throw 'cloudflared was not found. Install the Cloudflare Tunnel client first.' }

  $tunnelOut = Join-Path $logRoot 'tunnel.stdout.log'
  $tunnelErr = Join-Path $logRoot 'tunnel.stderr.log'
  Remove-Item $tunnelOut, $tunnelErr -Force -ErrorAction SilentlyContinue
  $tunnelProcess = Start-Process -FilePath $cloudflared -ArgumentList @('tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:8770') -WindowStyle Hidden -PassThru -RedirectStandardOutput $tunnelOut -RedirectStandardError $tunnelErr
  $tunnelPid = $tunnelProcess.Id
  $tunnelOwned = $true
  Save-State

  for ($i = 0; $i -lt 60 -and -not $publicUrl; $i++) {
    if (-not (Get-Process -Id $tunnelPid -ErrorAction SilentlyContinue)) { throw 'cloudflared exited before creating a tunnel.' }
    foreach ($logPath in @($tunnelOut, $tunnelErr)) {
      if (Test-Path $logPath) {
        $text = Get-Content -Raw $logPath -ErrorAction SilentlyContinue
        $match = [regex]::Match($text, 'https://[a-z0-9-]+\.trycloudflare\.com')
        if ($match.Success) { $publicUrl = $match.Value; break }
      }
    }
    if (-not $publicUrl) { Start-Sleep -Seconds 1 }
  }
  if (-not $publicUrl) { throw 'cloudflared did not report a public HTTPS URL within 60 seconds.' }
  Save-State
  if (-not (Wait-Health "$publicUrl/api/rag/health" 30)) { throw 'The public RAG health check failed.' }
}
Save-State

Invoke-CheckedGit $projectRoot @('fetch', 'origin', 'gh-pages')
if (Test-Path $pagesRoot) {
  & git -C $pagesRoot rev-parse --is-inside-work-tree *> $null
  if ($LASTEXITCODE -ne 0) { throw 'The Pages worktree path exists but is not a Git worktree; no files were changed there.' }
  $dirty = & git -C $pagesRoot status --porcelain
  if ($dirty) { throw 'The Pages worktree contains uncommitted changes; refusing to overwrite them.' }
  Invoke-CheckedGit $pagesRoot @('merge', '--ff-only', 'origin/gh-pages')
} else {
  Invoke-CheckedGit $projectRoot @('worktree', 'add', '--detach', $pagesRoot, 'origin/gh-pages')
}

$configPath = Join-Path $pagesRoot 'src\rag-config.js'
if (-not (Test-Path $configPath)) { throw 'The GitHub Pages worktree is missing src/rag-config.js.' }
$configText = Get-Content -Raw $configPath
$urlPattern = "PUBLIC_RAG_API_URL:\s*'[^']*'"
$urlMatches = [regex]::Matches($configText, $urlPattern)
if ($urlMatches.Count -ne 1) { throw 'Expected exactly one PUBLIC_RAG_API_URL setting in the Pages configuration.' }
$newSetting = "PUBLIC_RAG_API_URL: '$publicUrl'"
if ($urlMatches[0].Value -ne $newSetting) {
  $updatedConfig = [regex]::Replace($configText, $urlPattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $newSetting }, 1)
  [System.IO.File]::WriteAllText($configPath, $updatedConfig, [System.Text.UTF8Encoding]::new($false))
  Invoke-CheckedGit $pagesRoot @('add', '--', 'src/rag-config.js')
  Invoke-CheckedGit $pagesRoot @('commit', '-m', 'chore: refresh temporary RAG tunnel URL')
  Invoke-CheckedGit $pagesRoot @('push', 'origin', 'HEAD:gh-pages')
  Invoke-CheckedGit $projectRoot @('fetch', 'origin', 'gh-pages')
}

$publicAsk = "$publicUrl/api/rag/ask"
$body = @{ question = 'F450 的槳葉正反桨怎么区分？' } | ConvertTo-Json -Compress
$bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)
$answer = Invoke-RestMethod -Uri $publicAsk -Method Post -ContentType 'text/plain; charset=utf-8' -Body $bodyBytes -TimeoutSec 20
if (-not $answer.answer -or $answer.version -ne 'f450_v1') { throw 'The public RAG ask test returned an unexpected response.' }

$pagesReady = $false
for ($i = 0; $i -lt 24 -and -not $pagesReady; $i++) {
  try {
    $publicConfigUrl = 'https://zhangpengya77-tech.github.io/fde-ai/src/rag-config.js?check=' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + '-' + $i
    $pageResponse = Invoke-WebRequest -Uri $publicConfigUrl -TimeoutSec 20
    $pagesReady = $pageResponse.StatusCode -eq 200 -and $pageResponse.Content -match [regex]::Escape($newSetting)
  } catch {
    $pagesReady = $false
  }
  if (-not $pagesReady) { Start-Sleep -Seconds 5 }
}
if (-not $pagesReady) { throw 'GitHub Pages has not published the current tunnel URL within two minutes.' }

Save-State

Write-Output 'RAG API = OK'
Write-Output 'Tunnel = OK'
Write-Output 'Public API = OK'
Write-Output "Classroom website: https://zhangpengya77-tech.github.io/fde-ai/"
Write-Output "Public RAG API: $publicUrl"
Write-Output "RAG answer: $($answer.answer)"
