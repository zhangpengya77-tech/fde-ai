# Transient partial DEMO launcher (Live 8030 + Django 8110 + FlightHealth 8040).
#
# WHY 8030: 8030 is the CANONICAL FDE Live Backend port for this project:
#   - ops/v2/start-phase1a.ps1 sets $LivePort = 8030
#   - student_portal/config/settings.py:224 defaults DJANGO_VISION_SUBMISSION_API_BASE_URL
#     to http://127.0.0.1:8030
#   - src/rag-config.js:11 hardcodes VISION_API_BASE_URL = http://127.0.0.1:8030, which is
#     what the BROWSER uses for /api/v1/vision/prop-check and /api/v1/vision/hover-video
#     on the /platform/* pages.
# The DEMO wrapper (demo_common.ps1) remaps Live to 8111 for isolation, but that never
# matched the frontend's hardcoded 8030, so the platform page showed
# "no model available" even though a model was uploaded.
# Port 8111 is squatted by the Power-Inspection-Simulator (tools\serve-8111.py, PID changes
# between runs - verify with Get-CimInstance before assuming) which must NOT be
# terminated, and it answers HTTP 404 on every FDE Live route anyway.
# Running the real Live Backend on 8030 fixes BOTH the browser vision calls and Django's
# submission path, with zero code changes and nothing terminated.
#
# Starts services via Start-Process and then EXITS, orphaning them so they
# survive independently of the holder (mirrors start_demo.ps1 + start_demo_hold.ps1).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$env:FDE_DEMO_BIND_ADDR = '127.0.0.1'

. 'D:\FDE-AI-UAS-v2.0\demo\tools\demo_common.ps1'

# Canonical Live Backend port (matches frontend rag-config.js + settings.py default).
$LivePortRun = 8030
$LiveUrlRun  = "http://${BindAddr}:$LivePortRun"

# Repoint Django -> Live (must be set BEFORE Django starts).
$env:DJANGO_VISION_SUBMISSION_API_BASE_URL = $LiveUrlRun

Write-Head 'FDE-AI-UAS 2.0 DEMO (partial transient: Live 8030 + Django 8110 + FlightHealth 8040)'

if (-not (Test-DemoIsolation)) { Write-Bad 'Isolation validation failed.'; exit 1 }

if (-not (Test-Path $DjangoPy)) { Write-Bad "Django Python not found: $DjangoPy"; exit 1 }
if (-not (Test-Path $LivePy))   { Write-Bad "Live Backend Python not found: $LivePy"; exit 1 }
Write-Ok 'Django + Live Backend Python exist'
$demoDb = Join-Path $DemoRoot 'runtime\db\demo.sqlite3'
if (-not (Test-Path $demoDb)) { Write-Bad "DEMO DB not found: $demoDb"; exit 1 }
Write-Ok "DEMO DB exists ($([math]::Round((Get-Item $demoDb).Length/1KB,1)) KB)"
$fhServer = Join-Path $ProjectRoot 'flight-health\reference_server.py'
if (-not (Test-Path $fhServer)) { Write-Bad "Flight Health backend not found: $fhServer"; exit 1 }
Write-Ok 'Flight Health backend exists'

New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null
Set-DemoEnvironment
# Re-assert the Live override AFTER Set-DemoEnvironment (which resets it to $LivePort=8111).
$env:DJANGO_VISION_SUBMISSION_API_BASE_URL = $LiveUrlRun

# Live Backend first (so Django's very first submission has a target).
Write-Host ''
Write-Host "  [1/3] Starting Live Backend (DEMO :$LivePortRun)" -ForegroundColor White
$liveOut = Join-Path $LogRoot 'live.out.log'
$liveErr = Join-Path $LogRoot 'live.err.log'
$liveProc = Start-Process -FilePath $LivePy `
  -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', "$BindAddr", '--port', "$LivePortRun") `
  -WorkingDirectory (Join-Path $ProjectRoot 'live_backend') `
  -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $liveOut -RedirectStandardError $liveErr
$livePid = $liveProc.Id
Write-Info "Live Backend starting (PID $livePid, binding ${BindAddr}:$LivePortRun)..."
if (-not (Wait-Http "$LiveUrlRun/api/live/health" 90)) {
  Write-Bad "Live Backend failed to start within 90s. See: $liveErr"
  Get-Content $liveErr -Tail 25 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "         $_" -ForegroundColor DarkGray }
  exit 1
}
Write-Ok "Live Backend health check passed (PID $livePid)"

# Django
Write-Host ''
Write-Host '  [2/3] Starting Django (DEMO :8110)' -ForegroundColor White
$djangoOut = Join-Path $LogRoot 'django.out.log'
$djangoErr = Join-Path $LogRoot 'django.err.log'
$djangoProc = Start-Process -FilePath $DjangoPy `
  -ArgumentList @('manage.py', 'runserver', "${BindAddr}:$DjangoPort", '--noreload') `
  -WorkingDirectory (Join-Path $ProjectRoot 'student_portal') `
  -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $djangoOut -RedirectStandardError $djangoErr
$djangoPid = $djangoProc.Id
Write-Info "Django starting (PID $djangoPid)..."
if (-not (Wait-Http "$DjangoUrl/login/" 60)) {
  Write-Bad 'Django failed to start within 60s.'
  Get-Content $djangoErr -Tail 25 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "         $_" -ForegroundColor DarkGray }
  exit 1
}
Write-Ok "Django health check passed (PID $djangoPid)"

# Flight Health
Write-Host ''
Write-Host "  [3/3] Starting Flight Health (DEMO :$FlightHealthPort)" -ForegroundColor White
$fhOut = Join-Path $LogRoot 'flight-health.out.log'
$fhErr = Join-Path $LogRoot 'flight-health.err.log'
$fhProc = Start-Process -FilePath $LivePy `
  -ArgumentList @($fhServer) `
  -WorkingDirectory (Join-Path $ProjectRoot 'flight-health') `
  -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $fhOut -RedirectStandardError $fhErr
$fhPid = $fhProc.Id
Write-Info "Flight Health starting (PID $fhPid)..."
if (-not (Wait-Http "$FlightHealthUrl/api/v1/health" 30)) {
  Write-Warn2 'Flight Health failed to start (teacher/student login still works; only health-check feature limited).'
  Get-Content $fhErr -Tail 15 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "         $_" -ForegroundColor DarkGray }
  $fhPid = $null
} else {
  Write-Ok "Flight Health health check passed (PID $fhPid)"
}

Save-DemoState ([ordered]@{
  django_pid        = $djangoPid
  live_pid          = $livePid
  live_port         = $LivePortRun
  flight_health_pid = $fhPid
  django_url        = $DjangoUrl
  live_url          = $LiveUrlRun
  flight_health_url = $FlightHealthUrl
  started_at        = [DateTimeOffset]::Now.ToString('o')
  note              = 'Partial start: Live on 8030 (canonical port; matches frontend rag-config.js and settings.py default). 8111 squatted by Power-Inspection-Simulator, not terminated.'
})

Write-Host "TRANSIENT LAUNCHER DONE: live=$livePid($LivePortRun) django=$djangoPid flight_health=$fhPid"
exit 0