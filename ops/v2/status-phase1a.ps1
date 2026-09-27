param(
  [string]$LiveUrl = 'http://127.0.0.1:8030',
  [string]$VisionUrl = 'http://127.0.0.1:8765'
)

$ErrorActionPreference = 'Stop'

function Get-Health([string]$Url) {
  try {
    return Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 3
  } catch {
    return $null
  }
}

$liveHealth = Get-Health "$LiveUrl/api/live/health"
$visionHealth = Get-Health "$VisionUrl/api/health"
$liveState = if ($liveHealth) { 'online' } else { 'offline' }
$visionState = if ($visionHealth) { 'online' } else { 'offline' }
$overall = if ($liveState -eq 'online' -and $visionState -eq 'online') {
  'online'
} elseif ($liveState -eq 'offline' -and $visionState -eq 'offline') {
  'offline'
} else {
  'degraded'
}

[ordered]@{
  status = $overall
  components = [ordered]@{
    live_backend = $liveState
    vision = $visionState
  }
  endpoints = [ordered]@{
    live_backend = $LiveUrl
    vision = $VisionUrl
  }
} | ConvertTo-Json -Depth 4 -Compress
