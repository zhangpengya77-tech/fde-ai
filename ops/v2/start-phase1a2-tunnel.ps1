param([switch]$DryRun)
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$RuntimeRoot = Join-Path $ProjectRoot '.test-temp\phase1a2-tunnel'
$StateFile = Join-Path $RuntimeRoot 'state.json'
$TargetUrl = 'http://127.0.0.1:8030'
$Cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'

if ($DryRun) {
  [ordered]@{ mode='dry_run'; tunnel_type='cloudflare_quick_tunnel'; target=$TargetUrl; production_worker_updated=$false; production_tunnel_updated=$false; secrets_updated=$false } | ConvertTo-Json -Compress
  exit 0
}
if (-not (Test-Path -LiteralPath $Cloudflared)) { throw "cloudflared not found: $Cloudflared" }
try { $health = Invoke-RestMethod -Uri "$TargetUrl/api/live/health" -TimeoutSec 5 } catch { throw 'Live Backend must be started before the dev tunnel.' }
New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
$stdout = Join-Path $RuntimeRoot 'cloudflared.out.log'
$stderr = Join-Path $RuntimeRoot 'cloudflared.err.log'
$process = Start-Process -FilePath $Cloudflared -ArgumentList @('tunnel','--url',$TargetUrl,'--no-autoupdate') -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
$url = $null
for($attempt=0; $attempt -lt 30; $attempt++) {
  Start-Sleep -Seconds 1
  $text = ((Get-Content -LiteralPath $stdout,$stderr -Raw -ErrorAction SilentlyContinue) -join "`n")
  $match = [regex]::Match($text, 'https://[a-z0-9-]+\.trycloudflare\.com')
  if($match.Success){$url=$match.Value;break}
  if($process.HasExited){throw "Quick Tunnel exited. See $stderr"}
}
if(-not $url){Stop-Process -Id $process.Id -ErrorAction SilentlyContinue;throw 'Quick Tunnel URL was not issued within 30 seconds.'}
[ordered]@{pid=$process.Id;url=$url;target=$TargetUrl;tunnel_type='cloudflare_quick_tunnel';production_modified=$false;started_at=[DateTimeOffset]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $StateFile -Encoding utf8
Get-Content -LiteralPath $StateFile -Raw

