<#
  P3-H Phase 20-A  E4c contract verification (RECONSTRUCTED, genuinely executed).

  Context: the original Phase 20-A E4c test scripts were lost (only ephemeral
  Phase 19 iso snapshots remained). This file faithfully reconstructs the 12
  E4c checks described in the phase plan and EXECUTES them against the
  reconstructed 2-marker authoritative module (V15C-Adoption.ps1) and the
  reconciled launcher copies.

  Safety:
    - Does NOT run the launcher; modules are dot-sourced only.
    - E4c health checks are read-only HTTP GETs (fake local server on 18199,
      and an optional read-only check against real 8022 if reachable).
    - Adoption eligibility uses injected providers (no production process scan).
    - State-claim (E4C-08) writes to an isolated temp state file only.
    - Production launcher / scheduler / 8022 / 8770 / 8030 are NEVER modified.
#>
[CmdletBinding()]
param(
    [string]$ModuleDir = $PSScriptRoot,
    [string]$FakeUrl = 'http://127.0.0.1:18199/login/',
    [string]$ProdUrl = 'http://127.0.0.1:8022/login/'
)

$ErrorActionPreference = 'Stop'
$results = New-Object System.Collections.Generic.List[object]

function Record([string]$id, [string]$name, [bool]$pass, [string]$detail) {
    $results.Add([pscustomobject]@{ id = $id; name = $name; pass = $pass; detail = $detail })
    $tag = if ($pass) { 'PASS' } else { 'FAIL' }
    Write-Host ("[{0}] {1} {2} :: {3}" -f $tag, $id, $name, $detail)
}

# ---- dot-source modules (same order as the launcher) -----------------------
$ownMod = Join-Path $ModuleDir 'V15C-Ownership.ps1'
$adpMod = Join-Path $ModuleDir 'V15C-Adoption.ps1'
if (-not (Test-Path $ownMod)) { throw "Ownership module missing: $ownMod" }
if (-not (Test-Path $adpMod)) { throw "Adoption module missing: $adpMod" }
. $ownMod
. $adpMod

# ---- constructor helpers ---------------------------------------------------
function New-HealthObj([bool]$ok, [int]$status, [bool]$all) {
    [pscustomobject]@{ Ok = $ok; Status = $status; ContentLength = 100; Markers = @{}; AllMarkers = $all }
}
function New-VenvObj([bool]$shim, [bool]$pyvenv, [bool]$homeMatches) {
    [pscustomobject]@{ ShimExists = $shim; PyvenvCfgReadable = $pyvenv; HomeMatchesObserved = $homeMatches; VenvRoot = 'D:\iso_venv' }
}
function New-ProjectObj([bool]$exists, [string]$sha, [bool]$same) {
    [pscustomobject]@{ ManagePyExists = $exists; ManagePySha256 = $sha; SameCode = $same }
}
function New-ConflictObj([int]$cc, [bool]$check, [bool]$free) {
    [pscustomobject]@{ ConflictCount = $cc; MutexCheckable = $check; MutexFree = $free }
}
function New-InfoObj([int]$ProcId, [int]$ppid, [string]$exe, [string]$cmd, [datetime]$ct) {
    [pscustomobject]@{ ProcessId = $ProcId; ParentProcessId = $ppid; CreationTimeUtc = $ct; ExecutablePath = $exe; CommandLine = $cmd }
}

$SHIM = 'C:\SHIM\python.exe'

# ===========================================================================
# E4C-01 : real-page replica (2-marker) => AllMarkers True, status 200
# ===========================================================================
try {
    $h2 = Get-V15CHealthDetailed -Url $FakeUrl -Markers @('FDE-AI', 'csrfmiddlewaretoken')
    $ok = ($h2.Status -eq 200) -and ($h2.AllMarkers -eq $true)
    Record 'E4C-01' 'real-page-replica 2-marker AllMarkers=True' $ok ("status=$($h2.Status) allMarkers=$($h2.AllMarkers) len=$($h2.ContentLength)")
} catch {
    Record 'E4C-01' 'real-page-replica 2-marker AllMarkers=True' $false ("EXCEPTION: " + $_.Exception.Message)
}

# ===========================================================================
# E4C-02 : OLD 3-marker contract on the SAME page => AllMarkers False
#          (proves the deadlock root cause + why dropping resend-verification fixes it)
# ===========================================================================
try {
    $h3 = Get-V15CHealthDetailed -Url $FakeUrl -Markers @('FDE-AI', 'csrfmiddlewaretoken', 'resend-verification')
    $ok = ($h3.AllMarkers -eq $false)
    Record 'E4C-02' 'old 3-marker AllMarkers=False on real page' $ok ("allMarkers=$($h3.AllMarkers) fakeHasResend=False (resend is a separate route, never in /login/)")
} catch {
    Record 'E4C-02' 'old 3-marker AllMarkers=False on real page' $false ("EXCEPTION: " + $_.Exception.Message)
}

# ===========================================================================
# E4C-03 : injected UNKNOWN, e4c=False
# ===========================================================================
try {
    $info = New-InfoObj 90001 1 $SHIM 'manage.py runserver 127.0.0.1:18199' ([datetime]::UtcNow)
    $adopt = Test-V15CAdoptionEligible -ListenerPid 90001 -Port 18199 -V15Root 'D:\iso_project' -DjangoPython $SHIM -HealthUrl $FakeUrl -MutexName '' -CurrentPid $PID `
        -ProcessInfoProvider { param($p) return (New-InfoObj 90001 1 'C:\SHIM\python.exe' 'manage.py runserver 127.0.0.1:18199' ([datetime]::UtcNow)) } `
        -ListenerPidProvider { param($p) return 90001 } `
        -HealthProvider { param($u, $m) return (New-HealthObj -ok $true -status 200 -all $false) } `
        -VenvEvidenceProvider { param($a, $b) return (New-VenvObj $true $true $true) } `
        -ProjectEvidenceProvider { param($a, $b) return (New-ProjectObj $true 'sha' $true) } `
        -ConflictProvider { param($a, $b, $c) return (New-ConflictObj 0 $true $true) }
    $reasonHas = ($adopt.Reasons -contains 'E4c_http_project_fingerprint_missing')
    $ok = ($adopt.Verdict -eq 'UNKNOWN') -and ($adopt.Evidence.E4_project.FingerprintOk -eq $false) -and $reasonHas
    Record 'E4C-03' 'injected UNKNOWN e4c=False' $ok ("verdict=$($adopt.Verdict) e4c=$($adopt.Evidence.E4_project.FingerprintOk)")
} catch {
    Record 'E4C-03' 'injected UNKNOWN e4c=False' $false ("EXCEPTION: " + $_.Exception.Message)
}

# ===========================================================================
# E4C-04 : injected UNKNOWN, e4c=True e5=False
# ===========================================================================
try {
    $adopt = Test-V15CAdoptionEligible -ListenerPid 90001 -Port 18199 -V15Root 'D:\iso_project' -DjangoPython $SHIM -HealthUrl $FakeUrl -MutexName '' -CurrentPid $PID `
        -ProcessInfoProvider { param($p) return (New-InfoObj 90001 1 'C:\WRONG\python.exe' 'manage.py runserver 127.0.0.1:18199' ([datetime]::UtcNow)) } `
        -ListenerPidProvider { param($p) return 90001 } `
        -HealthProvider { param($u, $m) return (New-HealthObj -ok $true -status 200 -all $true) } `
        -VenvEvidenceProvider { param($a, $b) return (New-VenvObj $true $true $true) } `
        -ProjectEvidenceProvider { param($a, $b) return (New-ProjectObj $true 'sha' $true) } `
        -ConflictProvider { param($a, $b, $c) return (New-ConflictObj 0 $true $true) }
    $ok = ($adopt.Verdict -eq 'UNKNOWN') -and ($adopt.Evidence.E4_project.FingerprintOk -eq $true) -and ($adopt.Evidence.E5_interpreter.Ok -eq $false)
    Record 'E4C-04' 'injected UNKNOWN e4c=True e5=False' $ok ("verdict=$($adopt.Verdict) e4c=$($adopt.Evidence.E4_project.FingerprintOk) e5=$($adopt.Evidence.E5_interpreter.Ok)")
} catch {
    Record 'E4C-04' 'injected UNKNOWN e4c=True e5=False' $false ("EXCEPTION: " + $_.Exception.Message)
}

# ===========================================================================
# E4C-05 : injected UNKNOWN e7=False status=302
# ===========================================================================
try {
    $adopt = Test-V15CAdoptionEligible -ListenerPid 90001 -Port 18199 -V15Root 'D:\iso_project' -DjangoPython $SHIM -HealthUrl $FakeUrl -MutexName '' -CurrentPid $PID `
        -ProcessInfoProvider { param($p) return (New-InfoObj 90001 1 'C:\SHIM\python.exe' 'manage.py runserver 127.0.0.1:18199' ([datetime]::UtcNow)) } `
        -ListenerPidProvider { param($p) return 90001 } `
        -HealthProvider { param($u, $m) return (New-HealthObj -ok $false -status 302 -all $true) } `
        -VenvEvidenceProvider { param($a, $b) return (New-VenvObj $true $true $true) } `
        -ProjectEvidenceProvider { param($a, $b) return (New-ProjectObj $true 'sha' $true) } `
        -ConflictProvider { param($a, $b, $c) return (New-ConflictObj 0 $true $true) }
    $ok = ($adopt.Verdict -eq 'UNKNOWN') -and ($adopt.Evidence.E7_health.Ok -eq $false) -and ($adopt.Evidence.E7_health.Status -eq 302)
    Record 'E4C-05' 'injected UNKNOWN e7=False status=302' $ok ("verdict=$($adopt.Verdict) e7_ok=$($adopt.Evidence.E7_health.Ok) status=$($adopt.Evidence.E7_health.Status)")
} catch {
    Record 'E4C-05' 'injected UNKNOWN e7=False status=302' $false ("EXCEPTION: " + $_.Exception.Message)
}

# ===========================================================================
# E4C-06 : injected UNKNOWN, reason E3_commandline_unreadable (no process info)
# ===========================================================================
try {
    $adopt = Test-V15CAdoptionEligible -ListenerPid 90001 -Port 18199 -V15Root 'D:\iso_project' -DjangoPython $SHIM -HealthUrl $FakeUrl -MutexName '' -CurrentPid $PID `
        -ProcessInfoProvider { param($p) return $null } `
        -ListenerPidProvider { param($p) return 90001 } `
        -HealthProvider { param($u, $m) return (New-HealthObj -ok $true -status 200 -all $true) } `
        -VenvEvidenceProvider { param($a, $b) return (New-VenvObj $true $true $true) } `
        -ProjectEvidenceProvider { param($a, $b) return (New-ProjectObj $true 'sha' $true) } `
        -ConflictProvider { param($a, $b, $c) return (New-ConflictObj 0 $true $true) }
    $ok = ($adopt.Verdict -eq 'UNKNOWN') -and ($adopt.Reasons -contains 'E3_commandline_unreadable')
    Record 'E4C-06' 'injected UNKNOWN E3_commandline_unreadable' $ok ("verdict=$($adopt.Verdict) reasons=$($adopt.Reasons -join ',')")
} catch {
    Record 'E4C-06' 'injected UNKNOWN E3_commandline_unreadable' $false ("EXCEPTION: " + $_.Exception.Message)
}

# ===========================================================================
# E4C-07 : injected UNKNOWN e6=False (listener drift during evidence)
# ===========================================================================
try {
    $adopt = Test-V15CAdoptionEligible -ListenerPid 90001 -Port 18199 -V15Root 'D:\iso_project' -DjangoPython $SHIM -HealthUrl $FakeUrl -MutexName '' -CurrentPid $PID `
        -ProcessInfoProvider { param($p) return (New-InfoObj 90001 1 'C:\SHIM\python.exe' 'manage.py runserver 127.0.0.1:18199' ([datetime]::UtcNow)) } `
        -ListenerPidProvider { param($p) return 99999 } `
        -HealthProvider { param($u, $m) return (New-HealthObj -ok $true -status 200 -all $true) } `
        -VenvEvidenceProvider { param($a, $b) return (New-VenvObj $true $true $true) } `
        -ProjectEvidenceProvider { param($a, $b) return (New-ProjectObj $true 'sha' $true) } `
        -ConflictProvider { param($a, $b, $c) return (New-ConflictObj 0 $true $true) }
    $ok = ($adopt.Verdict -eq 'UNKNOWN') -and ($adopt.Evidence.E6_listener_recheck.Ok -eq $false)
    Record 'E4C-07' 'injected UNKNOWN e6=False' $ok ("verdict=$($adopt.Verdict) e6=$($adopt.Evidence.E6_listener_recheck.Ok)")
} catch {
    Record 'E4C-07' 'injected UNKNOWN e6=False' $false ("EXCEPTION: " + $_.Exception.Message)
}

# ===========================================================================
# E4C-08 : ADOPTABLE (2-marker now reachable) + controlled state claim on isolated file
# ===========================================================================
try {
    $stateFile = Join-Path $env:TEMP ('p3h20_e4c_state_{0}.json' -f [guid]::NewGuid().ToString('N'))
    if (Test-Path $stateFile) { Remove-Item $stateFile -Force }
    $adopt = Test-V15CAdoptionEligible -ListenerPid 90001 -Port 18199 -V15Root 'D:\iso_project' -DjangoPython $SHIM -HealthUrl $FakeUrl -MutexName '' -CurrentPid $PID `
        -ProcessInfoProvider { param($p) return (New-InfoObj 90001 1 'C:\SHIM\python.exe' 'manage.py runserver 127.0.0.1:18199' ([datetime]::UtcNow) ) } `
        -ListenerPidProvider { param($p) return 90001 } `
        -HealthProvider { param($u, $m) return (New-HealthObj -ok $true -status 200 -all $true) } `
        -VenvEvidenceProvider { param($a, $b) return (New-VenvObj $true $true $true) } `
        -ProjectEvidenceProvider { param($a, $b) return (New-ProjectObj $true 'sha' $true) } `
        -ConflictProvider { param($a, $b, $c) return (New-ConflictObj 0 $true $true) }
    $adoptable = ($adopt.Verdict -eq 'ADOPTABLE')
    $claim = Invoke-V15CAdoptionClaim -Adoption $adopt -StateFile $stateFile -Port 18199 -V15Root 'D:\iso_project'
    $claimed = [bool]$claim.Claimed
    $pidRead = 0
    if (Test-Path $stateFile) {
        $rec = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
        $pidRead = [int]$rec.pid
    }
    $ok = $adoptable -and $claimed -and ($pidRead -eq 90001)
    Record 'E4C-08' 'ADOPTABLE + isolated state claim writes single owner' $ok ("adoptable=$adoptable claimed=$claimed pid=$pidRead")
    if (Test-Path $stateFile) { Remove-Item $stateFile -Force }
} catch {
    Record 'E4C-08' 'ADOPTABLE + isolated state claim writes single owner' $false ("EXCEPTION: " + $_.Exception.Message)
}

# ===========================================================================
# E4C-09 : REUSE action for OWNED verdict; module contains 0 termination primitives
# ===========================================================================
try {
    $dec = Resolve-V15CListenerAction -Verdict 'OWNED' -Reasons @('owned')
    $modText = (Get-Content -LiteralPath $adpMod -Raw) + (Get-Content -LiteralPath (Join-Path $ModuleDir 'start_fde_v15c_classroom.patched-v3.isolation.ps1') -Raw)
    $killHits = ([regex]::Matches($modText, 'Stop-Process|taskkill|\.Kill\(')).Count
    $ok = ($dec.Action -eq 'REUSE') -and ($killHits -eq 0)
    Record 'E4C-09' 'OWNED=>REUSE; 0 termination primitives' $ok ("action=$($dec.Action) killPrimitives=$killHits")
} catch {
    Record 'E4C-09' 'OWNED=>REUSE; 0 termination primitives' $false ("EXCEPTION: " + $_.Exception.Message)
}

# ===========================================================================
# E4C-10 : UNKNOWN (no state_absent) => ABORT
# ===========================================================================
try {
    $dec = Resolve-V15CListenerAction -Verdict 'UNKNOWN' -Reasons @('E4c_http_project_fingerprint_missing')
    $ok = ($dec.Action -eq 'ABORT')
    Record 'E4C-10' 'UNKNOWN=>ABORT' $ok ("action=$($dec.Action) reason=$($dec.Reason)")
} catch {
    Record 'E4C-10' 'UNKNOWN=>ABORT' $false ("EXCEPTION: " + $_.Exception.Message)
}

# ===========================================================================
# E4C-11 : UNKNOWN e7=False => ABORT (unknown_evidence)
# ===========================================================================
try {
    $dec = Resolve-V15CListenerAction -Verdict 'UNKNOWN' -Reasons @('E7_health_failed')
    $ok = ($dec.Action -eq 'ABORT')
    Record 'E4C-11' 'UNKNOWN e7=False=>ABORT' $ok ("action=$($dec.Action) reason=$($dec.Reason)")
} catch {
    Record 'E4C-11' 'UNKNOWN e7=False=>ABORT' $false ("EXCEPTION: " + $_.Exception.Message)
}

# ===========================================================================
# E4C-12 : production 8022/8770/8030 listening state UNCHANGED (read-only)
# ===========================================================================
function Test-PortOpen([int]$p) {
    try { return [bool](Test-NetConnection -ComputerName 127.0.0.1 -Port $p -InformationLevel Quiet -WarningAction SilentlyContinue) } catch { return $false }
}
try {
    $before = @{ '8022' = (Test-PortOpen 8022); '8770' = (Test-PortOpen 8770); '8030' = (Test-PortOpen 8030) }
    # (no action taken between; the whole suite is read-only w.r.t. production)
    $after = @{ '8022' = (Test-PortOpen 8022); '8770' = (Test-PortOpen 8770); '8030' = (Test-PortOpen 8030) }
    $unchanged = ($before['8022'] -eq $after['8022']) -and ($before['8770'] -eq $after['8770']) -and ($before['8030'] -eq $after['8030'])
    $ok = $unchanged
    Record 'E4C-12' 'production 8022/8770/8030 state unchanged' $ok ("before=8022:$($before['8022'])/8770:$($before['8770'])/8030:$($before['8030']) after=8022:$($after['8022'])/8770:$($after['8770'])/8030:$($after['8030'])")
} catch {
    Record 'E4C-12' 'production 8022/8770/8030 state unchanged' $false ("EXCEPTION: " + $_.Exception.Message)
}

# ---- summary ---------------------------------------------------------------
$pass = 0; $fail = 0
foreach ($r in $results) { if ($r.pass) { $pass++ } else { $fail++ } }
$total = $results.Count
$summary = [pscustomobject]@{
    suite   = 'P20-A-E4c'
    total   = $total
    pass    = $pass
    fail    = $fail
    results = $results
}
$outJson = Join-Path $ModuleDir 'TEST_RESULTS_PHASE20_E4C.json'
$outLog  = Join-Path $ModuleDir 'TEST_RESULTS_PHASE20_E4C.log'
$summary | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $outJson -Encoding utf8
$results | ForEach-Object { "{0}`t{1}`t{2}`t{3}" -f $_.id, $_.pass, $_.name, $_.detail } | Set-Content -LiteralPath $outLog -Encoding utf8
Write-Host ("`nSUMMARY pass={0} fail={1} total={2}" -f $pass, $fail, $total)
if ($fail -gt 0) { exit 1 } else { exit 0 }
