# P3-H Phase 18 (rerun): controlled-adoption + R-1 state-initialisation contract tests.
#
# Suites in this file:
#   T18-1 .. T18-14  adoption gate / decision / no-kill contract (Phase 18 first pass)
#   A1 .. A6         evidence-insufficiency tests (one signal is never enough)
#   S1 .. S4         structural checks on the patched launcher
#   R1 .. R12        R-1 PID-state-file initialisation requirements (this rerun)
#
# Safety boundary:
#   - Only non-production ports 18022 / 18023 / 18024 / 18025 / 18099 are used.
#     8022 / 8770 / 8030 are only READ (listener pid snapshots), never written.
#   - Only processes started by this script ($script:started) are ever terminated.
#   - Every state-file write goes to a temporary directory created by this script.
#   - The modules under test are dot-sourced, i.e. the exact files the patched
#     launcher dot-sources.
#
# ASCII-only on purpose: Windows PowerShell 5.1 misparses non-ASCII .ps1 files
# that have no BOM.

[CmdletBinding()]
param(
    [string]$BasePython = 'C:\Users\admin\.workbuddy-ai\binaries\python\versions\3.13.12\python.exe',
    [string]$OtherPython = 'D:\FDE-AI-UAS-v2.0\.test-temp\django-venv\Scripts\python.exe',
    [string]$FakeProject = '',
    [string]$PatchedLauncher = '',
    [string]$OriginalLauncher = '',
    [string]$OfficialLauncher = 'D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1',
    [string]$ExpectedOfficialSha = 'a64330ef7a31e6c981fba95117466610af5e5db833d1ddafc8d91dba1c7a7b59',
    [string]$ResultJson = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

foreach ($pname in @('http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY')) {
    [Environment]::SetEnvironmentVariable($pname, $null, 'Process')
}
$env:NO_PROXY = '127.0.0.1,localhost'

$here = $PSScriptRoot
if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $FakeProject) { $FakeProject = Join-Path $here 'fake_project.py' }
if (-not $PatchedLauncher) { $PatchedLauncher = Join-Path $here 'start_fde_v15c_classroom.patched-v3.ps1' }
if (-not $OriginalLauncher) { $OriginalLauncher = Join-Path $here 'start_fde_v15c_classroom.original.ps1' }

$OwnershipModulePath = Join-Path $here 'V15C-Ownership.ps1'
$AdoptionModulePath = Join-Path $here 'V15C-Adoption.ps1'
. $OwnershipModulePath
. $AdoptionModulePath

$script:results = New-Object System.Collections.Generic.List[object]
$script:started = New-Object System.Collections.Generic.List[object]

function Record([string]$id, [string]$name, [bool]$ok, [string]$detail) {
    $script:results.Add([pscustomobject]@{ Id = $id; Name = $name; Ok = $ok; Detail = $detail })
    $tag = if ($ok) { 'PASS' } else { 'FAIL' }
    Write-Output ("{0} {1} {2} :: {3}" -f $tag, $id, $name, $detail)
}

function Start-Listener([string]$exe, [string[]]$arguments, [int]$port) {
    $proc = Start-Process -FilePath $exe -ArgumentList $arguments -PassThru -WindowStyle Hidden
    $script:started.Add($proc)
    for ($i = 0; $i -lt 60; $i++) {
        if ((Get-V15CListenerPid $port) -ne 0) { break }
        Start-Sleep -Milliseconds 250
    }
    return $proc
}

function Alive([int]$procId) {
    if ($procId -le 0) { return $false }
    return [bool](Get-Process -Id $procId -ErrorAction SilentlyContinue)
}

function Get-Sha256([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { return '' }
    return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
}

# Raw JSON seed writer, used only to fabricate deliberately wrong/stale records.
function Write-StateRecord([string]$path, [int]$listenerPid, [string]$createdOverride = '') {
    $created = $createdOverride
    if (-not $created) {
        $p = Get-CimInstance Win32_Process -Filter "ProcessId=$listenerPid" -ErrorAction SilentlyContinue
        if ($p -and $p.CreationDate) { $created = ([datetime]$p.CreationDate).ToUniversalTime().ToString('o') }
    }
    [pscustomobject]@{ pid = $listenerPid; created_at = $created; port = 0; v15_root = 'TEST' } |
        ConvertTo-Json | Set-Content -LiteralPath $path -Encoding utf8
}

function Get-RealCreatedUtc([int]$procId) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
    if ($p -and $p.CreationDate) { return ([datetime]$p.CreationDate).ToUniversalTime().ToString('o') }
    return ''
}

function Wait-PortFree([int]$port, [int]$tries = 40) {
    for ($i = 0; $i -lt $tries; $i++) {
        if ((Get-V15CListenerPid $port) -eq 0) { return $true }
        Start-Sleep -Milliseconds 200
    }
    return ((Get-V15CListenerPid $port) -eq 0)
}

$PORT_MAIN = 18022
$PORT_OTHER = 18023
$PORT_GENERIC = 18024
$PORT_SECOND = 18025
$DEADPORT = 18099

# ---------- preflight ----------
$preflight = @()
if (-not (Test-Path -LiteralPath $BasePython)) { $preflight += "BasePython missing: $BasePython" }
if (-not (Test-Path -LiteralPath $OtherPython)) { $preflight += "OtherPython missing: $OtherPython" }
if (-not (Test-Path -LiteralPath $FakeProject)) { $preflight += "FakeProject missing: $FakeProject" }
if (-not (Test-Path -LiteralPath $PatchedLauncher)) { $preflight += "PatchedLauncher missing: $PatchedLauncher" }
if (-not (Test-Path -LiteralPath $OriginalLauncher)) { $preflight += "OriginalLauncher missing: $OriginalLauncher" }
if (-not (Get-Command Write-V15CStateRecord -ErrorAction SilentlyContinue)) { $preflight += 'Write-V15CStateRecord not loaded' }
if (-not (Get-Command Test-V15CAdoptionEligible -ErrorAction SilentlyContinue)) { $preflight += 'Test-V15CAdoptionEligible not loaded' }
if (-not (Get-Command Invoke-V15CAdoptionClaim -ErrorAction SilentlyContinue)) { $preflight += 'Invoke-V15CAdoptionClaim not loaded' }
if ($preflight.Count -gt 0) {
    Write-Output ('PREFLIGHT_FAIL :: ' + ($preflight -join ' | '))
    Write-Output 'V15C_PHASE18_TESTS_FAIL'
    exit 3
}
Write-Output ("PREFLIGHT_OK base_python={0}" -f $BasePython)
Write-Output ("PATCHED_LAUNCHER sha256={0}" -f (Get-Sha256 $PatchedLauncher))

$officialShaBefore = Get-Sha256 $OfficialLauncher
Write-Output ("OFFICIAL_LAUNCHER sha256={0} expected={1} match={2}" -f $officialShaBefore, $ExpectedOfficialSha, ($officialShaBefore -eq $ExpectedOfficialSha))

$tmp = Join-Path $env:TEMP ("p3h18r-" + [guid]::NewGuid().ToString('N'))
$projRoot = Join-Path $tmp 'proj'
$venvRoot = Join-Path $projRoot '.venv'
New-Item -ItemType Directory -Force -Path $projRoot | Out-Null
Write-Output ("TMPDIR {0}" -f $tmp)

# Real isolated project tree: manage.py + a real venv at proj\.venv
Set-Content -LiteralPath (Join-Path $projRoot 'manage.py') -Value '# P3H18 fake manage.py' -Encoding ascii
& $BasePython -m venv --without-pip $venvRoot 2>&1 | Out-Null
$djangoPythonT = Join-Path $venvRoot 'Scripts\python.exe'
if (-not (Test-Path -LiteralPath $djangoPythonT)) {
    Write-Output 'PREFLIGHT_FAIL :: isolated venv python was not created'
    Write-Output 'V15C_PHASE18_TESTS_FAIL'
    exit 3
}
$fakeManageT = Join-Path $projRoot 'fake_manage.py'
Copy-Item -LiteralPath $FakeProject -Destination $fakeManageT -Force
$fakeGenericT = Join-Path $tmp 'fake_manage_generic.py'
Copy-Item -LiteralPath $FakeProject -Destination $fakeGenericT -Force
Write-Output ("ISOLATED_TREE proj={0} venv_python={1} manage_sha={2}" -f $projRoot, $djangoPythonT, (Get-Sha256 (Join-Path $projRoot 'manage.py')))

$stateFresh = Join-Path $tmp 'state-fresh.json'
$stateAdopt = Join-Path $tmp 'state-adopt.json'
$stateMissing = Join-Path $tmp 'state-missing.json'
$stateCorrupt = Join-Path $tmp 'state-corrupt.json'
$stateReusePid = Join-Path $tmp 'state-reusepid.json'
$stateDrift = Join-Path $tmp 'state-drift.json'
$stateAfterRestart = Join-Path $tmp 'state-after-restart.json'
$stateR2 = Join-Path $tmp 'state-r2.json'
$stateR4 = Join-Path $tmp 'state-r4.json'
$stateR5 = Join-Path $tmp 'state-r5.json'
$stateR7 = Join-Path $tmp 'state-r7.json'
$stateR8 = Join-Path $tmp 'state-r8.json'
$stateR9 = Join-Path $tmp 'state-r9.json'
$stateR11 = Join-Path $tmp 'state-r11.json'

# P20-A (2026-10-28) E4c contract fix:
#   BEFORE: @('FDE-AI', 'csrfmiddlewaretoken', 'resend-verification')
#   AFTER : @('FDE-AI', 'csrfmiddlewaretoken')
# resend-verification is a SEPARATE route (learning/urls.py:20), never
# embedded in the /login/ page. The real /login/ page (student_login.html)
# serves only FDE-AI + csrfmiddlewaretoken. The 3-marker set was
# structurally unreachable on prod (Phase 19 E4c dead-end), and the
# fake_project.py double over-accommodated it. Reducing to the two markers
# the real page actually carries; process-level identity (E3/E4a/E4b/E5)
# stays the primary, fail-closed gate. Test purpose (verify every adoption
# eligibility branch) is preserved -- only the marker constant is corrected.
$MARKERS = @('FDE-AI', 'csrfmiddlewaretoken')
$prodBefore = @{ '8022' = (Get-V15CListenerPid 8022); '8770' = (Get-V15CListenerPid 8770); '8030' = (Get-V15CListenerPid 8030) }
Write-Output ("PROD_BEFORE 8022={0} 8770={1} 8030={2}" -f $prodBefore['8022'], $prodBefore['8770'], $prodBefore['8030'])

$pidMain = 0
$pidOther = 0
$pidGeneric = 0
$pidSecond = 0
try {
    # ---------- start isolated listeners ----------
    $pMain = Start-Listener $djangoPythonT @($fakeManageT, 'runserver', "127.0.0.1:$PORT_MAIN", '--noreload', '--mode=v15c') $PORT_MAIN
    $pidMain = Get-V15CListenerPid $PORT_MAIN
    $pOther = Start-Listener $djangoPythonT @('-m', 'http.server', "$PORT_OTHER", '--bind', '127.0.0.1') $PORT_OTHER
    $pidOther = Get-V15CListenerPid $PORT_OTHER
    $pGeneric = Start-Listener $djangoPythonT @($fakeGenericT, 'runserver', "127.0.0.1:$PORT_GENERIC", '--noreload', '--mode=generic') $PORT_GENERIC
    $pidGeneric = Get-V15CListenerPid $PORT_GENERIC
    $pSecond = Start-Listener $djangoPythonT @($fakeManageT, 'runserver', "127.0.0.1:$PORT_SECOND", '--noreload', '--mode=v15c') $PORT_SECOND
    $pidSecond = Get-V15CListenerPid $PORT_SECOND
    Write-Output ("LISTENERS main={0} other={1} generic={2} second={3}" -f $pidMain, $pidOther, $pidGeneric, $pidSecond)
    if ($pidMain -le 0) { throw 'main test listener did not start' }

    $healthUrl = "http://127.0.0.1:$PORT_MAIN/"
    $deadUrl = "http://127.0.0.1:$DEADPORT/"
    $created1 = Get-RealCreatedUtc $pidMain

    # =====================================================================
    # T18-1 .. T18-14  (Phase 18 first pass, retargeted at the unified writer)
    # =====================================================================

    # ===== T18-1: first start writes a state record, next check is OWNED =====
    $w1 = Write-V15CStateRecord -StateFile $stateFresh -ProcessId $pidMain -Port $PORT_MAIN -V15Root $projRoot -CreatedAtUtc $created1
    $v = Test-IsV15CDjango -ListenerPid $pidMain -Port $PORT_MAIN -V15Root $projRoot -DjangoPython $djangoPythonT -StateFile $stateFresh -HealthUrl $healthUrl -HealthMarker 'P3H18-MARKER'
    Record 'T18-1' 'first start writes state -> OWNED' (($w1.Written) -and ($v.Verdict -eq 'OWNED')) ("written=$($w1.Written) verdict=$($v.Verdict); " + ($v.Reasons -join '; '))

    # ===== T18-2: controlled adoption of a pre-existing listener =====
    $vBefore = Test-IsV15CDjango -ListenerPid $pidMain -Port $PORT_MAIN -V15Root $projRoot -DjangoPython $djangoPythonT -StateFile $stateAdopt -HealthUrl $healthUrl -HealthMarker 'P3H18-MARKER'
    $adopt = Test-V15CAdoptionEligible -ListenerPid $pidMain -Port $PORT_MAIN -V15Root $projRoot -DjangoPython $djangoPythonT -HealthUrl $healthUrl -HealthMarkers $MARKERS -MutexName '' -CurrentPid $PID
    $dec = Resolve-V15CListenerAction -Verdict $vBefore.Verdict -Reasons $vBefore.Reasons -Adoption $adopt -AdoptionEnabled $true
    $claim = $null
    if ($dec.Action -eq 'ADOPT') {
        $claim = Invoke-V15CAdoptionClaim -Adoption $adopt -StateFile $stateAdopt -Port $PORT_MAIN -V15Root $projRoot
    }
    $vAfter = Test-IsV15CDjango -ListenerPid $pidMain -Port $PORT_MAIN -V15Root $projRoot -DjangoPython $djangoPythonT -StateFile $stateAdopt -HealthUrl $healthUrl -HealthMarker 'P3H18-MARKER'
    Record 'T18-2' 'controlled adoption -> state written -> OWNED' (($vBefore.Verdict -eq 'UNKNOWN') -and ($vBefore.Reasons -contains 'state_record_absent') -and ($adopt.Verdict -eq 'ADOPTABLE') -and ($dec.Action -eq 'ADOPT') -and ($claim.Claimed) -and ($vAfter.Verdict -eq 'OWNED')) ("before=$($vBefore.Verdict)/state_absent adopt=$($adopt.Verdict) mode=$($adopt.Mode) decision=$($dec.Action) claimed=$($claim.Claimed) after=$($vAfter.Verdict)")

    # ===== T18-3: state record absent -> scheme A aborts, scheme B adopts =====
    $v = Test-IsV15CDjango -ListenerPid $pidMain -Port $PORT_MAIN -V15Root $projRoot -DjangoPython $djangoPythonT -StateFile $stateMissing -HealthUrl $healthUrl -HealthMarker 'P3H18-MARKER'
    $decA = Resolve-V15CListenerAction -Verdict $v.Verdict -Reasons $v.Reasons -Adoption $null -AdoptionEnabled $false
    $decB = Resolve-V15CListenerAction -Verdict $v.Verdict -Reasons $v.Reasons -Adoption $adopt -AdoptionEnabled $true
    Record 'T18-3' 'state absent: scheme A abort / scheme B adopt' (($v.Verdict -eq 'UNKNOWN') -and ($decA.Action -eq 'ABORT') -and ($decB.Action -eq 'ADOPT') -and (Alive $pidMain)) ("verdict=$($v.Verdict) A=$($decA.Action)/$($decA.Reason) B=$($decB.Action)/$($decB.Reason) alive=$(Alive $pidMain)")

    # ===== T18-4: state record corrupt -> UNKNOWN, adoption NOT attempted =====
    Set-Content -LiteralPath $stateCorrupt -Value '{not-valid-json' -Encoding utf8
    $v = Test-IsV15CDjango -ListenerPid $pidMain -Port $PORT_MAIN -V15Root $projRoot -DjangoPython $djangoPythonT -StateFile $stateCorrupt -HealthUrl $healthUrl -HealthMarker 'P3H18-MARKER'
    $dec = Resolve-V15CListenerAction -Verdict $v.Verdict -Reasons $v.Reasons -Adoption $adopt -AdoptionEnabled $true
    Record 'T18-4' 'state corrupt -> UNKNOWN, no adoption, alive' (($v.Verdict -eq 'UNKNOWN') -and (-not ($v.Reasons -contains 'state_record_absent')) -and ($dec.Action -eq 'ABORT') -and (Alive $pidMain)) ("verdict=$($v.Verdict) decision=$($dec.Action)/$($dec.Reason) alive=$(Alive $pidMain); " + ($v.Reasons -join '; '))

    # ===== T18-5: pid reused (creation time far in the past) -> UNKNOWN, alive =====
    Write-StateRecord $stateReusePid $pidMain '2000-01-01T00:00:00.0000000Z'
    $v = Test-IsV15CDjango -ListenerPid $pidMain -Port $PORT_MAIN -V15Root $projRoot -DjangoPython $djangoPythonT -StateFile $stateReusePid -HealthUrl $healthUrl -HealthMarker 'P3H18-MARKER'
    $dec = Resolve-V15CListenerAction -Verdict $v.Verdict -Reasons $v.Reasons -Adoption $adopt -AdoptionEnabled $true
    Record 'T18-5' 'pid reused -> UNKNOWN, no adoption, alive' (($v.Verdict -eq 'UNKNOWN') -and ($dec.Action -eq 'ABORT') -and (Alive $pidMain)) ("verdict=$($v.Verdict) decision=$($dec.Action) alive=$(Alive $pidMain); " + ($v.Reasons -join '; '))

    # ===== T18-6: creation time drift (5s) -> UNKNOWN, no adoption, alive =====
    $drift = ([datetime]::Parse($created1)).ToUniversalTime().AddSeconds(5).ToString('o')
    Write-StateRecord $stateDrift $pidMain $drift
    $v = Test-IsV15CDjango -ListenerPid $pidMain -Port $PORT_MAIN -V15Root $projRoot -DjangoPython $djangoPythonT -StateFile $stateDrift -HealthUrl $healthUrl -HealthMarker 'P3H18-MARKER'
    $dec = Resolve-V15CListenerAction -Verdict $v.Verdict -Reasons $v.Reasons -Adoption $adopt -AdoptionEnabled $true
    Record 'T18-6' 'creation drift 5s -> UNKNOWN, no adoption, alive' (($v.Verdict -eq 'UNKNOWN') -and ($v.Reasons -contains 'state_created_at_mismatch') -and ($dec.Action -eq 'ABORT') -and (Alive $pidMain)) ("verdict=$($v.Verdict) decision=$($dec.Action) alive=$(Alive $pidMain); " + ($v.Reasons -join '; '))

    # ===== T18-7: different project sharing the same python -> FOREIGN, alive =====
    $v = Test-IsV15CDjango -ListenerPid $pidOther -Port $PORT_OTHER -V15Root $projRoot -DjangoPython $djangoPythonT -StateFile $stateAdopt
    $adoptOther = Test-V15CAdoptionEligible -ListenerPid $pidOther -Port $PORT_OTHER -V15Root $projRoot -DjangoPython $djangoPythonT -HealthUrl "http://127.0.0.1:$PORT_OTHER/" -HealthMarkers $MARKERS -MutexName '' -CurrentPid $PID
    $dec = Resolve-V15CListenerAction -Verdict $v.Verdict -Reasons $v.Reasons -Adoption $adoptOther -AdoptionEnabled $true
    Record 'T18-7' 'same python other project -> FOREIGN, no adoption, alive' (($v.Verdict -eq 'FOREIGN') -and ($adoptOther.Verdict -eq 'UNKNOWN') -and ($dec.Action -eq 'ABORT') -and (Alive $pidOther)) ("verdict=$($v.Verdict) adopt=$($adoptOther.Verdict) decision=$($dec.Action) alive=$(Alive $pidOther)")

    # ===== T18-8: command line unreadable -> UNKNOWN, no adoption, alive =====
    $realMainPid = $pidMain
    $providerEmpty = {
        param($procId)
        if ($procId -eq $realMainPid) {
            return [pscustomobject]@{ ProcessId = $realMainPid; ParentProcessId = 0; ExecutablePath = ''; CommandLine = ''; CreationTimeUtc = $null }
        }
        return $null
    }.GetNewClosure()
    $listenerStub = { param($portArg) $realMainPid }.GetNewClosure()
    $v = Test-IsV15CDjango -ListenerPid $pidMain -Port $PORT_MAIN -V15Root $projRoot -DjangoPython $djangoPythonT -StateFile $stateAdopt -ProcessInfoProvider $providerEmpty -ListenerPidProvider $listenerStub
    $adoptNoCmd = Test-V15CAdoptionEligible -ListenerPid $pidMain -Port $PORT_MAIN -V15Root $projRoot -DjangoPython $djangoPythonT -HealthUrl $healthUrl -HealthMarkers $MARKERS -MutexName '' -CurrentPid $PID -ProcessInfoProvider $providerEmpty -ListenerPidProvider $listenerStub
    Record 'T18-8' 'command line unreadable -> UNKNOWN, no adoption, alive' (($v.Verdict -eq 'UNKNOWN') -and ($adoptNoCmd.Verdict -eq 'UNKNOWN') -and (Alive $pidMain)) ("verdict=$($v.Verdict) adopt=$($adoptNoCmd.Verdict) alive=$(Alive $pidMain); " + ($adoptNoCmd.Reasons -join '; '))

    # ===== T18-9: health check failing -> UNKNOWN, no adoption, alive =====
    $v = Test-IsV15CDjango -ListenerPid $pidMain -Port $PORT_MAIN -V15Root $projRoot -DjangoPython $djangoPythonT -StateFile $stateAdopt -HealthUrl $deadUrl -HealthMarker 'P3H18-MARKER'
    $adoptDead = Test-V15CAdoptionEligible -ListenerPid $pidMain -Port $PORT_MAIN -V15Root $projRoot -DjangoPython $djangoPythonT -HealthUrl $deadUrl -HealthMarkers $MARKERS -MutexName '' -CurrentPid $PID
    Record 'T18-9' 'health failing -> UNKNOWN, no adoption, alive' (($v.Verdict -eq 'UNKNOWN') -and ($adoptDead.Verdict -eq 'UNKNOWN') -and (Alive $pidMain)) ("verdict=$($v.Verdict) adopt=$($adoptDead.Verdict) alive=$(Alive $pidMain); " + ($adoptDead.Reasons -join '; '))

    # ===== T18-10: repeated trigger -> same decision, no restart =====
    $pidBefore = Get-V15CListenerPid $PORT_MAIN
    $countBefore = $script:started.Count
    $acts = @()
    for ($k = 0; $k -lt 3; $k++) {
        $vv = Test-IsV15CDjango -ListenerPid $pidBefore -Port $PORT_MAIN -V15Root $projRoot -DjangoPython $djangoPythonT -StateFile $stateAdopt -HealthUrl $healthUrl -HealthMarker 'P3H18-MARKER'
        $dd = Resolve-V15CListenerAction -Verdict $vv.Verdict -Reasons $vv.Reasons -Adoption $null -AdoptionEnabled $true
        $acts += $dd.Action
    }
    $pidAfter = Get-V15CListenerPid $PORT_MAIN
    Record 'T18-10' 'repeated trigger -> REUSE x3, pid unchanged' (($acts -notcontains 'ABORT') -and ($acts -notcontains 'ADOPT') -and ($pidBefore -eq $pidAfter) -and ($script:started.Count -eq $countBefore)) ("actions=$($acts -join ',') pid=$pidBefore->$pidAfter started=$($script:started.Count)")

    # ===== T18-11: OWNED never terminated =====
    $v = Test-IsV15CDjango -ListenerPid $pidMain -Port $PORT_MAIN -V15Root $projRoot -DjangoPython $djangoPythonT -StateFile $stateAdopt -HealthUrl $healthUrl -HealthMarker 'P3H18-MARKER'
    $dec = Resolve-V15CListenerAction -Verdict $v.Verdict -Reasons $v.Reasons -Adoption $null -AdoptionEnabled $true
    Record 'T18-11' 'OWNED -> REUSE, process alive' (($v.Verdict -eq 'OWNED') -and ($dec.Action -eq 'REUSE') -and (Alive $pidMain)) ("verdict=$($v.Verdict) action=$($dec.Action) alive=$(Alive $pidMain)")

    # ===== T18-12: FOREIGN / UNKNOWN never terminated =====
    $ok12 = (Alive $pidOther) -and (Alive $pidGeneric) -and (Alive $pidMain)
    Record 'T18-12' 'FOREIGN/UNKNOWN never terminated' $ok12 ("other_alive=$(Alive $pidOther) generic_alive=$(Alive $pidGeneric) main_alive=$(Alive $pidMain)")

    # ===== T18-13: after the process stops, a safe restart is possible =====
    Stop-Process -Id $pidBefore -Force -ErrorAction SilentlyContinue
    $freeOk = Wait-PortFree $PORT_MAIN
    $freePid = Get-V15CListenerPid $PORT_MAIN
    $vFree = Test-IsV15CDjango -ListenerPid 0 -Port $PORT_MAIN -V15Root $projRoot -DjangoPython $djangoPythonT -StateFile $stateAdopt
    $adoptFree = Test-V15CAdoptionEligible -ListenerPid 0 -Port $PORT_MAIN -V15Root $projRoot -DjangoPython $djangoPythonT -HealthUrl $healthUrl -HealthMarkers $MARKERS -MutexName '' -CurrentPid $PID
    $pRestart = Start-Listener $djangoPythonT @($fakeManageT, 'runserver', "127.0.0.1:$PORT_MAIN", '--noreload', '--mode=v15c') $PORT_MAIN
    $pidRestart = Get-V15CListenerPid $PORT_MAIN
    $adoptRestart = Test-V15CAdoptionEligible -ListenerPid $pidRestart -Port $PORT_MAIN -V15Root $projRoot -DjangoPython $djangoPythonT -HealthUrl $healthUrl -HealthMarkers $MARKERS -MutexName '' -CurrentPid $PID
    $claimRestart = Invoke-V15CAdoptionClaim -Adoption $adoptRestart -StateFile $stateAfterRestart -Port $PORT_MAIN -V15Root $projRoot
    $vRestart = Test-IsV15CDjango -ListenerPid $pidRestart -Port $PORT_MAIN -V15Root $projRoot -DjangoPython $djangoPythonT -StateFile $stateAfterRestart -HealthUrl $healthUrl -HealthMarker 'P3H18-MARKER'
    Record 'T18-13' 'stopped -> safe restart -> OWNED' (($freePid -eq 0) -and ($vFree.Verdict -eq 'UNKNOWN') -and ($vFree.Reasons -contains 'no_listener_on_port') -and ($adoptFree.Verdict -eq 'UNKNOWN') -and ($claimRestart.Claimed) -and ($vRestart.Verdict -eq 'OWNED')) ("free_pid=$freePid free_verdict=$($vFree.Verdict) adopt_on_free=$($adoptFree.Verdict) restart_pid=$pidRestart claimed=$($claimRestart.Claimed) restart_verdict=$($vRestart.Verdict)")

    # ===== T18-14: production ports untouched =====
    $prodMid = @{ '8022' = (Get-V15CListenerPid 8022); '8770' = (Get-V15CListenerPid 8770); '8030' = (Get-V15CListenerPid 8030) }
    $untouched = ($prodBefore['8770'] -eq $prodMid['8770']) -and ($prodBefore['8030'] -eq $prodMid['8030'])
    $noProd = -not (($PORT_MAIN -in @(8022, 8770, 8030)) -or ($PORT_OTHER -in @(8022, 8770, 8030)) -or ($PORT_GENERIC -in @(8022, 8770, 8030)) -or ($PORT_SECOND -in @(8022, 8770, 8030)))
    Record 'T18-14' 'production 8022/8770/8030 untouched' ($untouched -and $noProd) ("8770={0}->{1} 8030={2}->{3} 8022={4}->{5} ports_exclude_prod={6}" -f $prodBefore['8770'], $prodMid['8770'], $prodBefore['8030'], $prodMid['8030'], $prodBefore['8022'], $prodMid['8022'], $noProd)

    # =====================================================================
    # A1 .. A6  evidence insufficiency
    # =====================================================================
    $pidMain2 = Get-V15CListenerPid $PORT_MAIN

    # ===== A1: health 200 but no project fingerprint -> UNKNOWN =====
    $adoptGeneric = Test-V15CAdoptionEligible -ListenerPid $pidGeneric -Port $PORT_GENERIC -V15Root $projRoot -DjangoPython $djangoPythonT -HealthUrl "http://127.0.0.1:$PORT_GENERIC/" -HealthMarkers $MARKERS -MutexName '' -CurrentPid $PID
    Record 'A1' 'health 200 without fingerprint -> UNKNOWN' (($adoptGeneric.Verdict -eq 'UNKNOWN') -and ($adoptGeneric.Reasons -contains 'E4c_http_project_fingerprint_missing') -and (Alive $pidGeneric)) ("verdict=$($adoptGeneric.Verdict) alive=$(Alive $pidGeneric); " + ($adoptGeneric.Reasons -join '; '))

    # ===== A2: pid + health only (no command line) -> UNKNOWN =====
    $realPid2 = $pidMain2
    $providerPidOnly = {
        param($procId)
        if ($procId -eq $realPid2) {
            return [pscustomobject]@{ ProcessId = $realPid2; ParentProcessId = 0; ExecutablePath = ''; CommandLine = ''; CreationTimeUtc = [datetime]::Parse('2026-10-27T02:00:00Z').ToUniversalTime() }
        }
        return $null
    }.GetNewClosure()
    $listenerPidOnly = { param($portArg) $realPid2 }.GetNewClosure()
    $adoptPidOnly = Test-V15CAdoptionEligible -ListenerPid $pidMain2 -Port $PORT_MAIN -V15Root $projRoot -DjangoPython $djangoPythonT -HealthUrl $healthUrl -HealthMarkers $MARKERS -MutexName '' -CurrentPid $PID -ProcessInfoProvider $providerPidOnly -ListenerPidProvider $listenerPidOnly
    Record 'A2' 'pid + health only -> UNKNOWN' (($adoptPidOnly.Verdict -eq 'UNKNOWN') -and ($adoptPidOnly.Reasons -contains 'E3_commandline_unreadable')) ("verdict=$($adoptPidOnly.Verdict); " + ($adoptPidOnly.Reasons -join '; '))

    # ===== A3: python path only (shim mismatch) -> UNKNOWN =====
    $adoptShim = Test-V15CAdoptionEligible -ListenerPid $pidMain2 -Port $PORT_MAIN -V15Root $projRoot -DjangoPython $OtherPython -HealthUrl $healthUrl -HealthMarkers $MARKERS -MutexName '' -CurrentPid $PID
    Record 'A3' 'python path only (shim mismatch) -> UNKNOWN' (($adoptShim.Verdict -eq 'UNKNOWN') -and ($adoptShim.Reasons -contains 'E5_no_self_or_ancestor_matches_shim')) ("verdict=$($adoptShim.Verdict); " + ($adoptShim.Reasons -join '; '))

    # ===== A4: manage.py identity broken -> UNKNOWN =====
    $emptyRoot = Join-Path $tmp 'emptyroot'
    New-Item -ItemType Directory -Force -Path $emptyRoot | Out-Null
    $adoptNoManage = Test-V15CAdoptionEligible -ListenerPid $pidMain2 -Port $PORT_MAIN -V15Root $emptyRoot -DjangoPython $djangoPythonT -HealthUrl $healthUrl -HealthMarkers $MARKERS -MutexName '' -CurrentPid $PID
    Record 'A4' 'manage.py identity missing -> UNKNOWN' (($adoptNoManage.Verdict -eq 'UNKNOWN') -and ($adoptNoManage.Reasons -contains 'E4b_manage_py_identity_insufficient')) ("verdict=$($adoptNoManage.Verdict); " + ($adoptNoManage.Reasons -join '; '))

    # ===== A5: another launcher instance detected -> UNKNOWN =====
    $conflictStub = {
        param($name, $mutexName, $currentPid)
        return [pscustomobject]@{
            LauncherScriptName = $name; MutexName = $mutexName
            ConflictingProcesses = @([pscustomobject]@{ ProcessId = 424242; CommandLine = 'simulated second launcher' })
            ConflictCount = 1; MutexFree = $true; MutexCheckable = $true; MutexDetail = 'acquired'
        }
    }
    $adoptConflict = Test-V15CAdoptionEligible -ListenerPid $pidMain2 -Port $PORT_MAIN -V15Root $projRoot -DjangoPython $djangoPythonT -HealthUrl $healthUrl -HealthMarkers $MARKERS -MutexName '' -CurrentPid $PID -ConflictProvider $conflictStub
    Record 'A5' 'other launcher process -> UNKNOWN' (($adoptConflict.Verdict -eq 'UNKNOWN') -and ($adoptConflict.Reasons -contains 'E8_launcher_process_conflict')) ("verdict=$($adoptConflict.Verdict); " + ($adoptConflict.Reasons -join '; '))

    # ===== A5b: instance mutex held by another thread -> UNKNOWN =====
    $mutexName = 'Local\P3H18-HOLD-' + [guid]::NewGuid().ToString('N')
    $holder = [powershell]::Create()
    [void]$holder.AddScript("`$m = New-Object System.Threading.Mutex(`$false, '$mutexName'); `$null = `$m.WaitOne(0); Start-Sleep -Seconds 25")
    $holderHandle = $holder.BeginInvoke()
    Start-Sleep -Milliseconds 1500
    $conflictMutex = Get-V15CLauncherConflict -LauncherScriptName 'start_fde_v15c_classroom.ps1' -MutexName $mutexName -CurrentPid $PID
    $adoptMutex = Test-V15CAdoptionEligible -ListenerPid $pidMain2 -Port $PORT_MAIN -V15Root $projRoot -DjangoPython $djangoPythonT -HealthUrl $healthUrl -HealthMarkers $MARKERS -MutexName $mutexName -CurrentPid $PID
    try { $holder.Stop() } catch { }
    try { $holder.Dispose() } catch { }
    Record 'A5b' 'instance mutex held elsewhere -> UNKNOWN' (($conflictMutex.MutexFree -eq $false) -and ($conflictMutex.MutexDetail -eq 'held_by_other') -and ($adoptMutex.Verdict -eq 'UNKNOWN') -and ($adoptMutex.Reasons -contains 'E8_mutex_held_by_other')) ("mutex_free=$($conflictMutex.MutexFree) detail=$($conflictMutex.MutexDetail) adopt=$($adoptMutex.Verdict)")

    # ===== A6: the state writer refuses to overwrite a live owner's record =====
    $stateA6 = Join-Path $tmp 'state-a6.json'
    $pidA6 = Get-V15CListenerPid $PORT_MAIN
    $createdA6 = Get-RealCreatedUtc $pidA6
    $wA6a = Write-V15CStateRecord -StateFile $stateA6 -ProcessId $pidA6 -Port $PORT_MAIN -V15Root $projRoot -CreatedAtUtc $createdA6
    $wA6b = Write-V15CStateRecord -StateFile $stateA6 -ProcessId 59998 -Port $PORT_MAIN -V15Root $projRoot -CreatedAtUtc '2026-10-27T02:00:00.0000000Z'
    $stillAdoptedPid = 0
    try { $stillAdoptedPid = [int](Get-Content -Raw -LiteralPath $stateA6 | ConvertFrom-Json).pid } catch { $stillAdoptedPid = 0 }
    Record 'A6' 'state writer refuses overwrite of live owner' (($wA6a.Written) -and (-not $wA6b.Written) -and ($wA6b.Reason -eq 'existing_owner_alive') -and ($stillAdoptedPid -eq $pidA6)) ("first_written=$($wA6a.Written) second_written=$($wA6b.Written) reason=$($wA6b.Reason) preserved_pid=$stillAdoptedPid expected_pid=$pidA6")

    # =====================================================================
    # S1 .. S4  structural checks on the patched launcher (v3)
    # =====================================================================
    $v3Text = Get-Content -Raw -LiteralPath $PatchedLauncher
    $needTokens = @('Test-V15CAdoptionEligible', 'Resolve-V15CListenerAction', 'Invoke-V15CAdoptionClaim', 'Write-V15CStateRecord', 'EnableAdoption', 'V15C-Adoption.ps1')
    $missing = @()
    foreach ($t in $needTokens) { if ($v3Text.IndexOf($t, [System.StringComparison]::Ordinal) -lt 0) { $missing += $t } }
    Record 'S1' 'patched-v3 wires the adoption branch' ($missing.Count -eq 0) ("missing=[$($missing -join ',')]")

    $tok = $null
    $errs = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($PatchedLauncher, [ref]$tok, [ref]$errs)
    $stopCmds = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Stop-Process' }, $true)
    $killDjango = 0
    $details = @()
    foreach ($c in $stopCmds) {
        $text = $c.Extent.Text
        if ($text -match '\$django') { $killDjango++ }
        $details += ($text -replace '\s+', ' ')
    }
    $parseClean = (-not $errs) -or ($errs.Count -eq 0)
    Record 'S2' 'no Stop-Process targets $django' (($killDjango -eq 0) -and ($stopCmds.Count -eq 2) -and $parseClean) ("stop_process_count=$($stopCmds.Count) targets_django=$killDjango parse_clean=$parseClean targets=[$($details -join ' | ')]")

    $v3Bytes = [System.IO.File]::ReadAllBytes($PatchedLauncher)
    $nonAscii = 0
    foreach ($b in $v3Bytes) { if ($b -gt 127) { $nonAscii++ } }
    $hasBom = ($v3Bytes.Length -ge 3) -and ($v3Bytes[0] -eq 0xEF) -and ($v3Bytes[1] -eq 0xBB) -and ($v3Bytes[2] -eq 0xBF)
    Record 'S3' 'patched-v3 is ASCII-only, no BOM' (($nonAscii -eq 0) -and (-not $hasBom)) ("non_ascii=$nonAscii bom=$hasBom bytes=$($v3Bytes.Length)")

    $officialShaAfter = Get-Sha256 $OfficialLauncher
    Record 'S4' 'official launcher unchanged during run' (($officialShaAfter -eq $ExpectedOfficialSha) -and ($officialShaAfter -eq $officialShaBefore)) ("before=$officialShaBefore after=$officialShaAfter")

    # =====================================================================
    # R1 .. R12  R-1 PID state file initialisation requirements
    # =====================================================================

    # ===== R1: first cold start creates the state record =====
    # Cold start = no listener, launcher starts Django, then writes state.
    if ($pidSecond -gt 0) { Stop-Process -Id $pidSecond -Force -ErrorAction SilentlyContinue }
    $r1Free = Wait-PortFree $PORT_SECOND
    $r1FreeVerdict = $null
    if ($r1Free) {
        $r1FreeVerdict = Test-IsV15CDjango -ListenerPid 0 -Port $PORT_SECOND -V15Root $projRoot -DjangoPython $djangoPythonT -StateFile $stateR2
    }
    $pR1 = Start-Listener $djangoPythonT @($fakeManageT, 'runserver', "127.0.0.1:$PORT_SECOND", '--noreload', '--mode=v15c') $PORT_SECOND
    $pidR1 = Get-V15CListenerPid $PORT_SECOND
    $createdR1 = Get-RealCreatedUtc $pidR1
    $wR1 = Write-V15CStateRecord -StateFile $stateR2 -ProcessId $pidR1 -Port $PORT_SECOND -V15Root $projRoot -CreatedAtUtc $createdR1
    $vR1 = Test-IsV15CDjango -ListenerPid $pidR1 -Port $PORT_SECOND -V15Root $projRoot -DjangoPython $djangoPythonT -StateFile $stateR2 -HealthUrl "http://127.0.0.1:$PORT_SECOND/" -HealthMarker 'P3H18-MARKER'
    $r1StateOk = $false
    if (Test-Path -LiteralPath $stateR2) {
        try {
            $r1Rec = Get-Content -Raw -LiteralPath $stateR2 | ConvertFrom-Json
            $r1StateOk = ([int]$r1Rec.pid -eq $pidR1) -and ([int]$r1Rec.port -eq $PORT_SECOND)
        } catch { $r1StateOk = $false }
    }
    Record 'R1' 'cold start: no listener -> start -> atomic state -> OWNED' (($r1Free) -and ($r1FreeVerdict.Verdict -eq 'UNKNOWN') -and ($pidR1 -gt 0) -and ($wR1.Written) -and ($r1StateOk) -and ($vR1.Verdict -eq 'OWNED')) ("port_was_free=$r1Free free_verdict=$(if ($r1FreeVerdict) { $r1FreeVerdict.Verdict } else { 'n/a' }) pid=$pidR1 written=$($wR1.Written) state_pid_port_ok=$r1StateOk verdict=$($vR1.Verdict)")

    # ===== R2: an existing legitimate process is adopted, not restarted =====
    $stateR2b = Join-Path $tmp 'state-r2b.json'
    $vR2a = Test-IsV15CDjango -ListenerPid $pidR1 -Port $PORT_SECOND -V15Root $projRoot -DjangoPython $djangoPythonT -StateFile $stateR2b -HealthUrl "http://127.0.0.1:$PORT_SECOND/" -HealthMarker 'P3H18-MARKER'
    $adoptR2 = Test-V15CAdoptionEligible -ListenerPid $pidR1 -Port $PORT_SECOND -V15Root $projRoot -DjangoPython $djangoPythonT -HealthUrl "http://127.0.0.1:$PORT_SECOND/" -HealthMarkers $MARKERS -MutexName '' -CurrentPid $PID
    $decR2 = Resolve-V15CListenerAction -Verdict $vR2a.Verdict -Reasons $vR2a.Reasons -Adoption $adoptR2 -AdoptionEnabled $true
    $claimR2 = Invoke-V15CAdoptionClaim -Adoption $adoptR2 -StateFile $stateR2b -Port $PORT_SECOND -V15Root $projRoot
    $pidR2After = Get-V15CListenerPid $PORT_SECOND
    $vR2b = Test-IsV15CDjango -ListenerPid $pidR1 -Port $PORT_SECOND -V15Root $projRoot -DjangoPython $djangoPythonT -StateFile $stateR2b -HealthUrl "http://127.0.0.1:$PORT_SECOND/" -HealthMarker 'P3H18-MARKER'
    $startedR2 = $script:started.Count
    Record 'R2' 'existing legit process adopted (no restart, no new process)' (($vR2a.Reasons -contains 'state_record_absent') -and ($adoptR2.Verdict -eq 'ADOPTABLE') -and ($decR2.Action -eq 'ADOPT') -and ($claimR2.Claimed) -and ($pidR2After -eq $pidR1) -and ($vR2b.Verdict -eq 'OWNED')) ("before=$($vR2a.Verdict)/absent adopt=$($adoptR2.Verdict) mode=$($adoptR2.Mode) decision=$($decR2.Action) claimed=$($claimR2.Claimed) pid=$pidR1->$pidR2After after=$($vR2b.Verdict) started_total=$startedR2")

    # ===== R3: a foreign process is never adopted =====
    $stateR3 = Join-Path $tmp 'state-r3.json'
    $vR3 = Test-IsV15CDjango -ListenerPid $pidOther -Port $PORT_OTHER -V15Root $projRoot -DjangoPython $djangoPythonT -StateFile $stateR3
    $adoptR3 = Test-V15CAdoptionEligible -ListenerPid $pidOther -Port $PORT_OTHER -V15Root $projRoot -DjangoPython $djangoPythonT -HealthUrl "http://127.0.0.1:$PORT_OTHER/" -HealthMarkers $MARKERS -MutexName '' -CurrentPid $PID
    $decR3 = Resolve-V15CListenerAction -Verdict $vR3.Verdict -Reasons $vR3.Reasons -Adoption $adoptR3 -AdoptionEnabled $true
    $claimR3 = Invoke-V15CAdoptionClaim -Adoption $adoptR3 -StateFile $stateR3 -Port $PORT_OTHER -V15Root $projRoot
    Record 'R3' 'foreign process never adopted, never killed' (($adoptR3.Verdict -eq 'UNKNOWN') -and ($decR3.Action -eq 'ABORT') -and (-not $claimR3.Claimed) -and (-not (Test-Path -LiteralPath $stateR3)) -and (Alive $pidOther)) ("verdict=$($vR3.Verdict) adopt=$($adoptR3.Verdict) decision=$($decR3.Action)/$($decR3.Reason) claimed=$($claimR3.Claimed) state_file=$(Test-Path -LiteralPath $stateR3) alive=$(Alive $pidOther)")

    # ===== R4: PID reuse is not mistaken for ownership =====
    # A stale record carrying the *current* pid but a creation time from a
    # previous incarnation must not be trusted.
    Write-StateRecord $stateR4 $pidR1 '2001-02-03T04:05:06.0000000Z'
    $vR4 = Test-IsV15CDjango -ListenerPid $pidR1 -Port $PORT_SECOND -V15Root $projRoot -DjangoPython $djangoPythonT -StateFile $stateR4 -HealthUrl "http://127.0.0.1:$PORT_SECOND/" -HealthMarker 'P3H18-MARKER'
    $decR4 = Resolve-V15CListenerAction -Verdict $vR4.Verdict -Reasons $vR4.Reasons -Adoption $adoptR2 -AdoptionEnabled $true
    Record 'R4' 'pid reuse: stale creation time -> UNKNOWN, alive' (($vR4.Verdict -eq 'UNKNOWN') -and ($vR4.Reasons -contains 'state_created_at_mismatch') -and ($decR4.Action -eq 'ABORT') -and (Alive $pidR1)) ("verdict=$($vR4.Verdict) decision=$($decR4.Action) alive=$(Alive $pidR1); " + ($vR4.Reasons -join '; '))

    # ===== R5: a different creation time never reuses the old state =====
    # The stale record is rejected; recovery needs an explicit rewrite with the
    # correct creation time (the writer accepts it because the pid matches).
    $createdR1dt = [datetime]::Parse($createdR1).ToUniversalTime()
    $shiftR5 = $createdR1dt.AddSeconds(-3).ToString('o')
    Write-StateRecord $stateR5 $pidR1 $shiftR5
    $vR5 = Test-IsV15CDjango -ListenerPid $pidR1 -Port $PORT_SECOND -V15Root $projRoot -DjangoPython $djangoPythonT -StateFile $stateR5 -HealthUrl "http://127.0.0.1:$PORT_SECOND/" -HealthMarker 'P3H18-MARKER'
    $decR5 = Resolve-V15CListenerAction -Verdict $vR5.Verdict -Reasons $vR5.Reasons -Adoption $null -AdoptionEnabled $true
    $wR5 = Write-V15CStateRecord -StateFile $stateR5 -ProcessId $pidR1 -Port $PORT_SECOND -V15Root $projRoot -CreatedAtUtc $createdR1
    $vR5b = Test-IsV15CDjango -ListenerPid $pidR1 -Port $PORT_SECOND -V15Root $projRoot -DjangoPython $djangoPythonT -StateFile $stateR5 -HealthUrl "http://127.0.0.1:$PORT_SECOND/" -HealthMarker 'P3H18-MARKER'
    Record 'R5' 'creation time differs -> UNKNOWN, no reuse, explicit rewrite recovers' (($vR5.Verdict -eq 'UNKNOWN') -and ($vR5.Reasons -contains 'state_created_at_mismatch') -and ($decR5.Action -eq 'ABORT') -and ($wR5.Written) -and ($vR5b.Verdict -eq 'OWNED') -and (Alive $pidR1)) ("stale_verdict=$($vR5.Verdict) decision=$($decR5.Action) rewrite=$($wR5.Written) after_rewrite=$($vR5b.Verdict) alive=$(Alive $pidR1)")

    # ===== R6: unreadable command line stays UNKNOWN =====
    $r6Pid = $pidR1
    $providerR6 = {
        param($procId)
        if ($procId -eq $r6Pid) {
            return [pscustomobject]@{ ProcessId = $r6Pid; ParentProcessId = 0; ExecutablePath = ''; CommandLine = ''; CreationTimeUtc = [datetime]::Parse('2026-10-27T02:00:00Z').ToUniversalTime() }
        }
        return $null
    }.GetNewClosure()
    $listenerR6 = { param($portArg) $r6Pid }.GetNewClosure()
    $adoptR6 = Test-V15CAdoptionEligible -ListenerPid $r6Pid -Port $PORT_SECOND -V15Root $projRoot -DjangoPython $djangoPythonT -HealthUrl "http://127.0.0.1:$PORT_SECOND/" -HealthMarkers $MARKERS -MutexName '' -CurrentPid $PID -ProcessInfoProvider $providerR6 -ListenerPidProvider $listenerR6
    $claimR6 = Invoke-V15CAdoptionClaim -Adoption $adoptR6 -StateFile (Join-Path $tmp 'state-r6.json') -Port $PORT_SECOND -V15Root $projRoot
    Record 'R6' 'unreadable command line -> UNKNOWN, no claim' (($adoptR6.Verdict -eq 'UNKNOWN') -and ($adoptR6.Reasons -contains 'E3_commandline_unreadable') -and (-not $claimR6.Claimed) -and (Alive $r6Pid)) ("verdict=$($adoptR6.Verdict) claimed=$($claimR6.Claimed) reason=$($claimR6.Reason) alive=$(Alive $r6Pid); " + ($adoptR6.Reasons -join '; '))

    # ===== R7: a corrupt state file is refused safely =====
    Set-Content -LiteralPath $stateR7 -Value '{corrupt' -Encoding ascii
    $corruptBefore = Get-Content -Raw -LiteralPath $stateR7
    $vR7 = Test-IsV15CDjango -ListenerPid $pidR1 -Port $PORT_SECOND -V15Root $projRoot -DjangoPython $djangoPythonT -StateFile $stateR7 -HealthUrl "http://127.0.0.1:$PORT_SECOND/" -HealthMarker 'P3H18-MARKER'
    $wR7 = Write-V15CStateRecord -StateFile $stateR7 -ProcessId $pidR1 -Port $PORT_SECOND -V15Root $projRoot -CreatedAtUtc $createdR1
    $corruptAfter = Get-Content -Raw -LiteralPath $stateR7
    Record 'R7' 'corrupt state -> UNKNOWN, write refused, file untouched' (($vR7.Verdict -eq 'UNKNOWN') -and ($vR7.Reasons -contains 'state_unreadable_or_corrupt') -and (-not $wR7.Written) -and ($wR7.Reason -eq 'existing_state_corrupt') -and ($corruptBefore -eq $corruptAfter) -and (Alive $pidR1)) ("verdict=$($vR7.Verdict) write=$($wR7.Written)/$($wR7.Reason) untouched=$($corruptBefore -eq $corruptAfter) alive=$(Alive $pidR1)")

    # ===== R8: an interrupted write never leaves a half-written state file =====
    # Dynamic: a child process writes the same state file in a tight loop while
    # this process reads it continuously; the child is then hard-killed at a
    # random moment. The destination must always parse as complete JSON.
    $r8Writer = Join-Path $tmp 'r8-writer.ps1'
    $writerSrc = @'
param([string]$Module, [string]$StateFile, [string]$Port, [string]$Root)
$ErrorActionPreference = 'Stop'
. $Module
$i = 0
while ($true) {
    $i++
    $created = '2026-10-27T03:00:{0:00}.0000000Z' -f ($i % 60)
    $null = Write-V15CStateRecord -StateFile $StateFile -ProcessId 50001 -Port ([int]$Port) -V15Root $Root -CreatedAtUtc $created -AllowOverwrite -MutexTimeoutMs 2000
}
'@
    Set-Content -LiteralPath $r8Writer -Value $writerSrc -Encoding ascii
    $r8Bad = 0
    $r8OpenErr = 0
    $r8Reads = 0
    $r8Rounds = 0
    $r8RoundOk = 0
    $r8TmpLeft = 0
    $r8Seed = Write-V15CStateRecord -StateFile $stateR8 -ProcessId 50001 -Port $PORT_SECOND -V15Root $projRoot -CreatedAtUtc '2026-10-27T03:00:00.0000000Z'
    for ($round = 0; $round -lt 3; $round++) {
        $r8Rounds++
        $childArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $r8Writer, '-Module', $OwnershipModulePath, '-StateFile', $stateR8, '-Port', [string]$PORT_SECOND, '-Root', $projRoot)
        $child = Start-Process -FilePath 'powershell.exe' -ArgumentList $childArgs -PassThru -WindowStyle Hidden
        $script:started.Add($child)
        $deadline = (Get-Date).AddMilliseconds(700)
        while ((Get-Date) -lt $deadline) {
            $r8Reads++
            try {
                $raw = [System.IO.File]::ReadAllText($stateR8)
                if ($raw.Trim().Length -eq 0) { $r8Bad++ }
                else { $null = $raw | ConvertFrom-Json }
            } catch [System.Management.Automation.ItemNotFoundException] {
                $r8OpenErr++
            } catch {
                if ($_.Exception -is [System.IO.IOException]) { $r8OpenErr++ } else { $r8Bad++ }
            }
        }
        # hard kill in the middle of the write loop
        try { Stop-Process -Id $child.Id -Force -ErrorAction SilentlyContinue } catch { }
        Start-Sleep -Milliseconds 250
        $okRound = $false
        if (Test-Path -LiteralPath $stateR8) {
            try {
                $rec = Get-Content -Raw -LiteralPath $stateR8 | ConvertFrom-Json
                $okRound = ([int]$rec.pid -eq 50001) -and ([string]$rec.created_at).Length -gt 0
            } catch { $okRound = $false }
        }
        if ($okRound) { $r8RoundOk++ }
    }
    $r8TmpLeft = @(Get-ChildItem -LiteralPath (Split-Path -Parent $stateR8) -Filter 'state-r8.json.*' -ErrorAction SilentlyContinue).Count
    Record 'R8' 'interrupted write: destination never half-written' (($r8Bad -eq 0) -and ($r8RoundOk -eq $r8Rounds) -and ($r8Reads -gt 50)) ("rounds=$r8Rounds valid_after_kill=$r8RoundOk reads=$r8Reads bad=$r8Bad openErr=$r8OpenErr seed_written=$($r8Seed.Written) tmp_leftovers=$r8TmpLeft")

    # ===== R9: repeated schedule trigger produces no second instance =====
    $pidR9Before = Get-V15CListenerPid $PORT_SECOND
    $startedR9Before = $script:started.Count
    $actsR9 = @()
    $writesR9 = 0
    for ($k = 0; $k -lt 5; $k++) {
        $vR9 = Test-IsV15CDjango -ListenerPid $pidR9Before -Port $PORT_SECOND -V15Root $projRoot -DjangoPython $djangoPythonT -StateFile $stateR9 -HealthUrl "http://127.0.0.1:$PORT_SECOND/" -HealthMarker 'P3H18-MARKER'
        $adoptR9 = $null
        if ($vR9.Reasons -contains 'state_record_absent') {
            $adoptR9 = Test-V15CAdoptionEligible -ListenerPid $pidR9Before -Port $PORT_SECOND -V15Root $projRoot -DjangoPython $djangoPythonT -HealthUrl "http://127.0.0.1:$PORT_SECOND/" -HealthMarkers $MARKERS -MutexName '' -CurrentPid $PID
        }
        $decR9 = Resolve-V15CListenerAction -Verdict $vR9.Verdict -Reasons $vR9.Reasons -Adoption $adoptR9 -AdoptionEnabled $true
        $actsR9 += $decR9.Action
        if ($decR9.Action -eq 'ADOPT') {
            $cR9 = Invoke-V15CAdoptionClaim -Adoption $adoptR9 -StateFile $stateR9 -Port $PORT_SECOND -V15Root $projRoot
            if ($cR9.Claimed) { $writesR9++ }
        }
    }
    $pidR9After = Get-V15CListenerPid $PORT_SECOND
    $listenerCountR9 = @(Get-NetTCPConnection -LocalPort $PORT_SECOND -State Listen -ErrorAction SilentlyContinue).Count
    Record 'R9' 'repeated trigger: one instance, one claim, no restart' (($actsR9[0] -eq 'ADOPT') -and ($writesR9 -eq 1) -and ($actsR9[1..4] -notcontains 'ADOPT') -and ($pidR9After -eq $pidR9Before) -and ($listenerCountR9 -eq 1) -and ($script:started.Count -eq $startedR9Before)) ("actions=$($actsR9 -join ',') claims=$writesR9 pid=$pidR9Before->$pidR9After listeners=$listenerCountR9 new_processes=$($script:started.Count - $startedR9Before)")

    # ===== R10: a failing health check never leads to a kill =====
    $pidR10 = Get-V15CListenerPid $PORT_SECOND
    $vR10 = Test-IsV15CDjango -ListenerPid $pidR10 -Port $PORT_SECOND -V15Root $projRoot -DjangoPython $djangoPythonT -StateFile $stateR9 -HealthUrl $deadUrl -HealthMarker 'P3H18-MARKER'
    $adoptR10 = Test-V15CAdoptionEligible -ListenerPid $pidR10 -Port $PORT_SECOND -V15Root $projRoot -DjangoPython $djangoPythonT -HealthUrl $deadUrl -HealthMarkers $MARKERS -MutexName '' -CurrentPid $PID
    $decR10 = Resolve-V15CListenerAction -Verdict $vR10.Verdict -Reasons $vR10.Reasons -Adoption $adoptR10 -AdoptionEnabled $true
    $pidR10After = Get-V15CListenerPid $PORT_SECOND
    Record 'R10' 'health failure -> UNKNOWN/ABORT, process survives' (($vR10.Verdict -eq 'UNKNOWN') -and ($decR10.Action -eq 'ABORT') -and ($adoptR10.Verdict -eq 'UNKNOWN') -and ($pidR10After -eq $pidR10) -and (Alive $pidR10)) ("verdict=$($vR10.Verdict) adopt=$($adoptR10.Verdict) decision=$($decR10.Action) pid=$pidR10->$pidR10After alive=$(Alive $pidR10)")

    # ===== R11: simulated rollback does not terminate an unknown process =====
    # A rollback restores an older state record (different pid) while the current
    # legitimate listener keeps running. The new code must not kill anything.
    Write-StateRecord $stateR11 $pidOther $createdR1
    $pidR11 = Get-V15CListenerPid $PORT_SECOND
    $vR11 = Test-IsV15CDjango -ListenerPid $pidR11 -Port $PORT_SECOND -V15Root $projRoot -DjangoPython $djangoPythonT -StateFile $stateR11 -HealthUrl "http://127.0.0.1:$PORT_SECOND/" -HealthMarker 'P3H18-MARKER'
    $decR11 = Resolve-V15CListenerAction -Verdict $vR11.Verdict -Reasons $vR11.Reasons -Adoption $null -AdoptionEnabled $true
    # AST proof: the ORIGINAL launcher did target $django, the patched one does not.
    $tokO = $null; $errsO = $null
    $astO = [System.Management.Automation.Language.Parser]::ParseFile($OriginalLauncher, [ref]$tokO, [ref]$errsO)
    $origKillsDjango = @($astO.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Stop-Process' -and $n.Extent.Text -match '\$django' }, $true)).Count
    $patchedKillsDjango = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Stop-Process' -and $n.Extent.Text -match '\$django' }, $true)).Count
    Record 'R11' 'rollback: no unknown process terminated; old launcher hazard proven' (($vR11.Verdict -eq 'UNKNOWN') -and ($decR11.Action -eq 'ABORT') -and (Alive $pidR11) -and (Alive $pidOther) -and ($origKillsDjango -ge 1) -and ($patchedKillsDjango -eq 0)) ("verdict=$($vR11.Verdict) decision=$($decR11.Action) listener_alive=$(Alive $pidR11) other_alive=$(Alive $pidOther) original_stop_django=$origKillsDjango patched_stop_django=$patchedKillsDjango")

    # ===== R12: production ports are never touched =====
    $prodR12 = @{ '8022' = (Get-V15CListenerPid 8022); '8770' = (Get-V15CListenerPid 8770); '8030' = (Get-V15CListenerPid 8030) }
    $r12PortsOk = -not (@($PORT_MAIN, $PORT_OTHER, $PORT_GENERIC, $PORT_SECOND) -contains 8022) -and
                  -not (@($PORT_MAIN, $PORT_OTHER, $PORT_GENERIC, $PORT_SECOND) -contains 8770) -and
                  -not (@($PORT_MAIN, $PORT_OTHER, $PORT_GENERIC, $PORT_SECOND) -contains 8030)
    $r12_8770 = ($prodR12['8770'] -eq $prodBefore['8770'])
    $r12_8030 = ($prodR12['8030'] -eq $prodBefore['8030'])
    $r12_8022_same = ($prodR12['8022'] -eq $prodBefore['8022'])
    Record 'R12' 'production 8022/8770/8030 untouched by R-tests' ($r12PortsOk -and $r12_8770 -and $r12_8030) ("8770={0}->{1} 8030={2}->{3} 8022={4}->{5} 8022_unchanged={6} ports_exclude_prod={7}" -f $prodBefore['8770'], $prodR12['8770'], $prodBefore['8030'], $prodR12['8030'], $prodBefore['8022'], $prodR12['8022'], $r12_8022_same, $r12PortsOk)
}
finally {
    foreach ($proc in $script:started) {
        if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    }
}

$prodFinal = @{ '8022' = (Get-V15CListenerPid 8022); '8770' = (Get-V15CListenerPid 8770); '8030' = (Get-V15CListenerPid 8030) }
Write-Output ("PROD_AFTER 8022={0} 8770={1} 8030={2}" -f $prodFinal['8022'], $prodFinal['8770'], $prodFinal['8030'])

$passed = @($script:results | Where-Object { $_.Ok }).Count
$failed = @($script:results | Where-Object { -not $_.Ok }).Count
if ($ResultJson) {
    $payload = [pscustomobject]@{
        generated_at     = (Get-Date).ToUniversalTime().ToString('o')
        official_sha256  = $officialShaBefore
        patched_sha256   = (Get-Sha256 $PatchedLauncher)
        ownership_sha256 = (Get-Sha256 $OwnershipModulePath)
        adoption_sha256  = (Get-Sha256 $AdoptionModulePath)
        prod_before      = $prodBefore
        prod_after       = $prodFinal
        pass             = $passed
        fail             = $failed
        total            = $script:results.Count
        results          = $script:results
    }
    $payload | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ResultJson -Encoding utf8
    Write-Output ("RESULT_JSON {0}" -f $ResultJson)
}
Write-Output ("SUMMARY pass={0} fail={1} total={2}" -f $passed, $failed, $script:results.Count)
if ($failed -gt 0) {
    Write-Output 'V15C_PHASE18_TESTS_FAIL'
    exit 1
}
Write-Output 'V15C_PHASE18_TESTS_PASS'
