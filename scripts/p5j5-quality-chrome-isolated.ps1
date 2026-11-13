param(
  [int]$Port = 4191
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runId = "quality-$([guid]::NewGuid().ToString('N'))"
$runDir = Join-Path $root ".p5j5-quality-runs\$runId"
$outputDir = Join-Path $runDir 'playwright-output'
$viteLog = Join-Path $runDir 'vite.log'
$resultFile = Join-Path $runDir 'result.json'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$node = (Get-Command node -ErrorAction Stop).Source
$viteCli = Join-Path $root 'node_modules\vite\bin\vite.js'
$vite = $null
$testExit = $null
$startedAt = [DateTime]::UtcNow

try {
  $vite = Start-Process -FilePath $node -ArgumentList @($viteCli, 'preview', '--host', '127.0.0.1', '--port', $Port, '--strictPort') -WorkingDirectory $root -RedirectStandardOutput $viteLog -RedirectStandardError "$viteLog.err" -PassThru
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 250
    try { $ready = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:$Port/").StatusCode -eq 200 } catch { $ready = $false }
  } while (-not $ready -and [DateTime]::UtcNow -lt $deadline -and -not $vite.HasExited)
  if (-not $ready) { throw "Vite preview did not become ready on port $Port." }

  $env:PLAYWRIGHT_PREVIEW_PORT = "$Port"
  $env:PLAYWRIGHT_REUSE_EXISTING_SERVER = '1'
  $env:PLAYWRIGHT_OUTPUT_DIR = $outputDir
  # Playwright browser fixtures create their own disposable profile. Passing a
  # user-data-dir argument is rejected by modern Playwright and would weaken
  # fixture ownership/cleanup semantics.
  & npx.cmd playwright test tests/browser/rea-exam.spec.ts --project=desktop-chrome -g '畫質選項' --reporter=list
  $testExit = $LASTEXITCODE
  if ($testExit -ne 0) { throw "Playwright exit $testExit." }
}
finally {
  $viteExit = $null
  if ($null -ne $vite) {
    $vite.Refresh()
    if (-not $vite.HasExited) {
      Stop-Process -Id $vite.Id -ErrorAction Stop
      $vite.WaitForExit(5000) | Out-Null
    }
    $vite.Refresh()
    if ($vite.HasExited) { $viteExit = $vite.ExitCode }
  }
  [pscustomobject]@{
    run_id = $runId
    port = $Port
    started_utc = $startedAt.ToString('o')
    finished_utc = [DateTime]::UtcNow.ToString('o')
    vite_pid = if ($null -eq $vite) { $null } else { $vite.Id }
    vite_exit = $viteExit
    playwright_exit = $testExit
    output_dir = $outputDir
    chrome_profile = 'Playwright-managed disposable profile'
  } | ConvertTo-Json | Set-Content -LiteralPath $resultFile -Encoding utf8
  Write-Output "P5J5_QUALITY_RESULT=$resultFile"
}
