$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$StateFile = Join-Path $ProjectRoot '.test-temp\phase1a2-tunnel\state.json'
if(-not (Test-Path -LiteralPath $StateFile)){[ordered]@{status='offline';tunnel_type='cloudflare_quick_tunnel'}|ConvertTo-Json -Compress;exit 0}
$state=Get-Content -LiteralPath $StateFile -Raw|ConvertFrom-Json
$process=Get-Process -Id $state.pid -ErrorAction SilentlyContinue
[ordered]@{status=if($process){'online'}else{'offline'};url=$state.url;target=$state.target;tunnel_type=$state.tunnel_type;production_modified=$false}|ConvertTo-Json -Compress

