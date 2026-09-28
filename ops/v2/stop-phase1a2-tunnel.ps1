$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$StateFile = Join-Path $ProjectRoot '.test-temp\phase1a2-tunnel\state.json'
if(-not (Test-Path -LiteralPath $StateFile)){[ordered]@{status='nothing_to_stop'}|ConvertTo-Json -Compress;exit 0}
$state=Get-Content -LiteralPath $StateFile -Raw|ConvertFrom-Json
$process=Get-CimInstance Win32_Process -Filter "ProcessId = $($state.pid)" -ErrorAction SilentlyContinue
if($process -and $process.CommandLine -match 'cloudflared.*tunnel.*127\.0\.0\.1:8030'){Stop-Process -Id $state.pid -ErrorAction Stop;$status='stopped'}else{$status='not_owned'}
Remove-Item -LiteralPath $StateFile -Force
[ordered]@{status=$status;url=$state.url}|ConvertTo-Json -Compress

