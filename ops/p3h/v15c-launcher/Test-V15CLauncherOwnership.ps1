# P3-H Phase 17: v1.5C 8022 ownership-judgment contract tests T1-T12 (+T13/T14 extras).
#
# Safety boundary:
#   - Only non-production ports 18022 / 18023 / 18024 / 18099 are used.
#     8022 / 8770 / 8030 are only READ (listener pid snapshots), never written.
#   - Only processes started by this script ($script:started) are ever terminated.
#   - The module under test is dot-sourced from V15C-Ownership.ps1, i.e. the exact
#     same file the patched launcher dot-sources. Tests exercise production logic.
#
# ASCII-only on purpose: Windows PowerShell 5.1 misparses non-ASCII .ps1 files
# that have no BOM.

[CmdletBinding()]
param(
    [string]$Python = 'D:\FDE-AI-UAS-v2.0\.test-temp\django-venv\Scripts\python.exe',
    [string]$OtherPython = 'C:\Users\admin\.workbuddy-ai\binaries\python\versions\3.13.12\python.exe',
    [string]$FakeManage = '',
    [string]$OfficialLauncher = 'D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1',
    [string]$ExpectedOfficialSha = 'a64330ef7a31e6c981fba95117466610af5e5db833d1ddafc8d91dba1c7a7b59',
    [string]$ResultJson = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Localhost health checks must not be intercepted by a proxy.
foreach ($pname in @('http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY')) {
    [Environment]::SetEnvironmentVariable($pname, $null, 'Process')
}
$env:NO_PROXY = '127.0.0.1,localhost'

# $PSScriptRoot is not populated inside param() defaults on Windows PowerShell 5.1,
# so resolve the script directory in the body and keep the defaults above empty.
$here = $PSScriptRoot
if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $FakeManage) { $FakeManage = Join-Path $here 'fake_manage.py' }

$OwnershipModulePath = Join-Path $here 'V15C-Ownership.ps1'
. $OwnershipModulePath

# Phase 19 close-out: full endpoint-set listener contract (replaces single-PID checks).
$ListenerContractModulePath = Join-Path $here 'V15C-ListenerContract.ps1'
. $ListenerContractModulePath

$script:results = New-Object System.Collections.Generic.List[object]
$script:started = New-Object System.Collections.Generic.List[object]

function Record([string]$id, [string]$name, [bool]$ok, [string]$detail) {
    $script:results.Add([pscustomobject]@{ Id = $id; Name = $name; Ok = $ok; Detail = $detail })
    $tag = if ($ok) { 'PASS' } else { 'FAIL' }
    Write-Output ("{0} {1} {2} :: {3}" -f $tag, $id, $name, $detail)
}

function Start-Listener([string]$exe, [int]$port, [string]$mode) {
    if ($mode -eq 'django') {
        # No quotes around $FakeManage: the command line must keep the
        # `manage.py runserver 127.0.0.1:<port>` shape the detector looks for.
        $proc = Start-Process -FilePath $exe -ArgumentList @($FakeManage, 'runserver', "127.0.0.1:$port", '--noreload') -PassThru -WindowStyle Hidden
    } else {
        $proc = Start-Process -FilePath $exe -ArgumentList @('-m', 'http.server', "$port", '--bind', '127.0.0.1') -PassThru -WindowStyle Hidden
    }
    $script:started.Add($proc)
    for ($i = 0; $i -lt 60; $i++) {
        if ((Get-V15CListenerPid $port) -ne 0) { break }
        Start-Sleep -Milliseconds 250
    }
    return $proc
}

function Write-State([int]$port, [string]$path, [string]$createdOverride = '') {
    $listenerPid = Get-V15CListenerPid $port
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$listenerPid" -ErrorAction SilentlyContinue
    $created = if ($proc -and $proc.CreationDate) { ([datetime]$proc.CreationDate).ToUniversalTime().ToString('o') } else { '' }
    if ($createdOverride) { $created = $createdOverride }
    [pscustomobject]@{ pid = $listenerPid; created_at = $created; port = $port; v15_root = 'TEST' } |
        ConvertTo-Json | Set-Content -LiteralPath $path -Encoding utf8
}

function Alive([int]$procId) {
    if ($procId -le 0) { return $false }
    return [bool](Get-Process -Id $procId -ErrorAction SilentlyContinue)
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

function Get-Sha256([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { return '' }
    return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
}

$V15ROOT = 'D:\FDE-AI-UAS\v1.5C\student_portal'
$PORT1 = 18022   # legit Django-shaped listener (owned)
$PORT3 = 18023   # same interpreter, different project
$PORT4 = 18024   # different interpreter
$DEADPORT = 18099  # nothing listens here: used to force a health-check failure
# Phase 18 ports (all non-production).
$PORT5 = 18025   # foreign project: absolute \manage.py path under another root
$PORT6 = 18026   # external occupant, later reused for the recovery test
$PORT7 = 18027   # fresh legit Django-shaped listener for the Phase-18 judgments
$ALLTESTPORTS = @($PORT1, $PORT3, $PORT4, $PORT5, $PORT6, $PORT7, $DEADPORT)

# ---------- preflight ----------
$preflight = @()
if (-not (Test-Path -LiteralPath $Python)) { $preflight += "missing python: $Python" }
if (-not (Test-Path -LiteralPath $OtherPython)) { $preflight += "missing other python: $OtherPython" }
if (-not (Test-Path -LiteralPath $FakeManage)) { $preflight += "missing fake_manage: $FakeManage" }
if (-not (Test-Path -LiteralPath $OwnershipModulePath)) { $preflight += "missing module: $OwnershipModulePath" }
foreach ($p in $ALLTESTPORTS) {
    if ((Get-V15CListenerPid $p) -ne 0) { $preflight += "test port already in use: $p" }
}
if ($preflight.Count -gt 0) {
    Write-Output ("PREFLIGHT_FAIL :: " + ($preflight -join '; '))
    Write-Output 'V15C_OWNERSHIP_TESTS_FAIL'
    exit 2
}
Write-Output ("PREFLIGHT_OK python={0}" -f $Python)

$officialShaBefore = Get-Sha256 $OfficialLauncher
Write-Output ("OFFICIAL_LAUNCHER sha256={0} expected={1} match={2}" -f $officialShaBefore, $ExpectedOfficialSha, ($officialShaBefore -eq $ExpectedOfficialSha))

$tmp = Join-Path $env:TEMP ("p3h-v15c-tests-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$stateMatch = Join-Path $tmp 'state-match.json'
$stateBadTime = Join-Path $tmp 'state-badtime.json'
$stateCorrupt = Join-Path $tmp 'state-corrupt.json'
$stateAbsent = Join-Path $tmp 'state-absent.json'
$stateT1b = Join-Path $tmp 'state-t1b.json'
Write-Output ("TMPDIR {0}" -f $tmp)

$prodBefore = @{ '8022' = (Get-V15CListenerPid 8022); '8770' = (Get-V15CListenerPid 8770); '8030' = (Get-V15CListenerPid 8030) }
$prodBeforeSet8770 = Get-V15CListenerEndpoints -Port 8770
$prodBeforeSet8030 = Get-V15CListenerEndpoints -Port 8030
Write-Output ("PROD_BEFORE 8022={0} 8770={1} 8030={2}" -f $prodBefore['8022'], $prodBefore['8770'], $prodBefore['8030'])
Write-Output ("PROD_BEFORE_SET 8770=[{0}] 8030=[{1}]" -f (@($prodBeforeSet8770) -join ','), (@($prodBeforeSet8030) -join ','))

$p1 = $null
try {
    # ===== T1a: real legit Django-shaped listener (interpreter proven) -> OWNED =====
    # Note: on this machine .venv\Scripts\python.exe is a trampoline, so the real
    # listener is a CHILD of the venv python. T1a therefore exercises the
    # "ancestor interpreter" branch in practice (see the recorded reasons).
    $p1 = Start-Listener $Python $PORT1 'django'
    $pid1 = Get-V15CListenerPid $PORT1
    Write-State $PORT1 $stateMatch
    if ($pid1 -le 0) {
        Record 'T1a' 'legit django (real process) -> OWNED' $false 'listener never came up on test port'
    } else {
        $v = Test-IsV15CDjango -ListenerPid $pid1 -Port $PORT1 -V15Root $V15ROOT -DjangoPython $Python -StateFile $stateMatch -HealthUrl "http://127.0.0.1:$PORT1/" -HealthMarker 'P3H-TEST-MARKER'
        Record 'T1a' 'legit django (real process) -> OWNED' ($v.Verdict -eq 'OWNED') ("verdict=$($v.Verdict) pid=$pid1; " + ($v.Reasons -join '; '))
    }

    # ===== T1b: venv shim -> child interpreter (ancestor match) -> OWNED =====
    # Synthetic process table: the listener runs a different python than the venv
    # shim, but its parent is the venv shim (this is the real 8022 topology).
    $fixedCreated = '2026-10-27T02:00:00.0000000Z'
    [pscustomobject]@{ pid = 40001; created_at = $fixedCreated; port = $PORT1; v15_root = 'TEST' } |
        ConvertTo-Json | Set-Content -LiteralPath $stateT1b -Encoding utf8
    $fakeShim = 'D:\FDE-AI-UAS\v1.5C\student_portal\.venv\Scripts\python.exe'
    $providerT1b = {
        param($procId)
        $t = [datetime]::Parse('2026-10-27T02:00:00Z').ToUniversalTime()
        if ($procId -eq 40001) {
            return [pscustomobject]@{ ProcessId = 40001; ParentProcessId = 40002; ExecutablePath = 'D:\YoloRuntime\python.exe'; CommandLine = 'D:\YoloRuntime\python.exe manage.py runserver 127.0.0.1:18022 --noreload'; CreationTimeUtc = $t }
        }
        if ($procId -eq 40002) {
            return [pscustomobject]@{ ProcessId = 40002; ParentProcessId = 0; ExecutablePath = 'D:\FDE-AI-UAS\v1.5C\student_portal\.venv\Scripts\python.exe'; CommandLine = 'shim'; CreationTimeUtc = $t }
        }
        return $null
    }
    $listenerT1b = { param($portArg) 40001 }
    $healthT1b = { param($u, $m) [pscustomobject]@{ Ok = $true; Status = 200; MarkerOk = $true } }
    $v = Test-IsV15CDjango -ListenerPid 40001 -Port $PORT1 -V15Root $V15ROOT -DjangoPython $fakeShim -StateFile $stateT1b -HealthUrl 'http://127.0.0.1:1/' -HealthMarker 'X' -ProcessInfoProvider $providerT1b -ListenerPidProvider $listenerT1b -HealthProvider $healthT1b
    Record 'T1b' 'venv shim child (ancestor) -> OWNED' ($v.Verdict -eq 'OWNED') ("verdict=$($v.Verdict); " + ($v.Reasons -join '; '))

    # ===== T1c: listener interpreter IS DjangoPython (self-exe branch) -> OWNED =====
    # Synthetic table: covers the direct-match branch that T1a cannot reach on this
    # machine because the venv python is a trampoline.
    $providerT1c = {
        param($procId)
        $t = [datetime]::Parse('2026-10-27T02:00:00Z').ToUniversalTime()
        if ($procId -eq 40011) {
            return [pscustomobject]@{ ProcessId = 40011; ParentProcessId = 0; ExecutablePath = 'D:\FDE-AI-UAS\v1.5C\student_portal\.venv\Scripts\python.exe'; CommandLine = '"D:\FDE-AI-UAS\v1.5C\student_portal\.venv\Scripts\python.exe" manage.py runserver 127.0.0.1:18022 --noreload'; CreationTimeUtc = $t }
        }
        return $null
    }
    $listenerT1c = { param($portArg) 40011 }
    $healthT1c = { param($u, $m) [pscustomobject]@{ Ok = $true; Status = 200; MarkerOk = $true } }
    [pscustomobject]@{ pid = 40011; created_at = $fixedCreated; port = $PORT1; v15_root = 'TEST' } |
        ConvertTo-Json | Set-Content -LiteralPath $stateT1b -Encoding utf8
    $v = Test-IsV15CDjango -ListenerPid 40011 -Port $PORT1 -V15Root $V15ROOT -DjangoPython $fakeShim -StateFile $stateT1b -HealthUrl 'http://127.0.0.1:1/' -HealthMarker 'X' -ProcessInfoProvider $providerT1c -ListenerPidProvider $listenerT1c -HealthProvider $healthT1c
    Record 'T1c' 'listener exe is DjangoPython (self) -> OWNED' (($v.Verdict -eq 'OWNED') -and (($v.Reasons -join '; ') -match 'listener_exe_is_django_python')) ("verdict=$($v.Verdict); " + ($v.Reasons -join '; '))

    # ===== T2: repeated check on the same process -> OWNED, no restart =====
    $before = Get-V15CListenerPid $PORT1
    $v1 = Test-IsV15CDjango -ListenerPid $before -Port $PORT1 -V15Root $V15ROOT -DjangoPython $Python -StateFile $stateMatch -HealthUrl "http://127.0.0.1:$PORT1/" -HealthMarker 'P3H-TEST-MARKER'
    $v2 = Test-IsV15CDjango -ListenerPid $before -Port $PORT1 -V15Root $V15ROOT -DjangoPython $Python -StateFile $stateMatch -HealthUrl "http://127.0.0.1:$PORT1/" -HealthMarker 'P3H-TEST-MARKER'
    $after = Get-V15CListenerPid $PORT1
    Record 'T2' 'repeat check -> OWNED, no restart' (($v1.Verdict -eq 'OWNED') -and ($v2.Verdict -eq 'OWNED') -and ($before -eq $after) -and ($before -gt 0)) ("v1=$($v1.Verdict) v2=$($v2.Verdict) pid_before=$before pid_after=$after")

    # ===== T3: same interpreter, different project -> FOREIGN/UNKNOWN, never killed =====
    $p3 = Start-Listener $Python $PORT3 'http'
    $pid3 = Get-V15CListenerPid $PORT3
    if ($pid3 -le 0) {
        Record 'T3' 'same python, different project -> FOREIGN/UNKNOWN, alive' $false 'listener never came up on test port'
    } else {
        $v = Test-IsV15CDjango -ListenerPid $pid3 -Port $PORT3 -V15Root $V15ROOT -DjangoPython $Python -StateFile $stateMatch
        Record 'T3' 'same python, different project -> FOREIGN/UNKNOWN, alive' (($v.Verdict -in @('FOREIGN', 'UNKNOWN')) -and (Alive $pid3)) ("verdict=$($v.Verdict) alive=$(Alive $pid3); " + ($v.Reasons -join '; '))
    }

    # ===== T4: different interpreter, other server -> FOREIGN/UNKNOWN, never killed =====
    $p4 = Start-Listener $OtherPython $PORT4 'http'
    $pid4 = Get-V15CListenerPid $PORT4
    if ($pid4 -le 0) {
        Record 'T4' 'different python, other server -> FOREIGN/UNKNOWN, alive' $false 'listener never came up on test port'
    } else {
        $v = Test-IsV15CDjango -ListenerPid $pid4 -Port $PORT4 -V15Root $V15ROOT -DjangoPython $Python -StateFile $stateMatch
        Record 'T4' 'different python, other server -> FOREIGN/UNKNOWN, alive' (($v.Verdict -in @('FOREIGN', 'UNKNOWN')) -and (Alive $pid4)) ("verdict=$($v.Verdict) alive=$(Alive $pid4); " + ($v.Reasons -join '; '))
    }

    # ===== T5: pid reused / creation time differs -> UNKNOWN, never killed =====
    Write-State $PORT1 $stateBadTime '2000-01-01T00:00:00.0000000Z'
    $pid1 = Get-V15CListenerPid $PORT1
    $v = Test-IsV15CDjango -ListenerPid $pid1 -Port $PORT1 -V15Root $V15ROOT -DjangoPython $Python -StateFile $stateBadTime -HealthUrl "http://127.0.0.1:$PORT1/" -HealthMarker 'P3H-TEST-MARKER'
    Record 'T5' 'pid reused / creation differs -> UNKNOWN, alive' (($v.Verdict -eq 'UNKNOWN') -and (Alive $pid1)) ("verdict=$($v.Verdict) alive=$(Alive $pid1); " + ($v.Reasons -join '; '))

    # ===== T6: command line unreadable -> UNKNOWN, never killed =====
    $pid1 = Get-V15CListenerPid $PORT1
    $realPid = $pid1
    $providerT6 = {
        param($procId)
        if ($procId -eq $realPid) {
            return [pscustomobject]@{ ProcessId = $realPid; ParentProcessId = 0; ExecutablePath = ''; CommandLine = ''; CreationTimeUtc = $null }
        }
        return $null
    }.GetNewClosure()
    $listenerT6 = { param($portArg) $realPid }.GetNewClosure()
    $v = Test-IsV15CDjango -ListenerPid $pid1 -Port $PORT1 -V15Root $V15ROOT -DjangoPython $Python -StateFile $stateMatch -ProcessInfoProvider $providerT6 -ListenerPidProvider $listenerT6
    Record 'T6' 'command line unreadable -> UNKNOWN, alive' (($v.Verdict -eq 'UNKNOWN') -and (Alive $pid1)) ("verdict=$($v.Verdict) alive=$(Alive $pid1); " + ($v.Reasons -join '; '))

    # ===== T7: health check temporarily failing -> no kill =====
    $pid1 = Get-V15CListenerPid $PORT1
    Write-State $PORT1 $stateMatch
    $v = Test-IsV15CDjango -ListenerPid $pid1 -Port $PORT1 -V15Root $V15ROOT -DjangoPython $Python -StateFile $stateMatch -HealthUrl "http://127.0.0.1:$DEADPORT/" -HealthMarker 'P3H-TEST-MARKER'
    Record 'T7' 'health check fails -> no kill' ((Alive $pid1) -and ($v.Verdict -ne 'OWNED')) ("verdict=$($v.Verdict) alive=$(Alive $pid1); " + ($v.Reasons -join '; '))

    # ===== T8a: pid state file absent -> UNKNOWN, never killed =====
    $pid1 = Get-V15CListenerPid $PORT1
    $v = Test-IsV15CDjango -ListenerPid $pid1 -Port $PORT1 -V15Root $V15ROOT -DjangoPython $Python -StateFile $stateAbsent -HealthUrl "http://127.0.0.1:$PORT1/" -HealthMarker 'P3H-TEST-MARKER'
    Record 'T8a' 'state file absent -> UNKNOWN, alive' (($v.Verdict -eq 'UNKNOWN') -and (Alive $pid1)) ("verdict=$($v.Verdict) alive=$(Alive $pid1); " + ($v.Reasons -join '; '))

    # ===== T8b: pid state file corrupt -> UNKNOWN, never killed =====
    Set-Content -LiteralPath $stateCorrupt -Value '{not-valid-json' -Encoding utf8
    $pid1 = Get-V15CListenerPid $PORT1
    $v = Test-IsV15CDjango -ListenerPid $pid1 -Port $PORT1 -V15Root $V15ROOT -DjangoPython $Python -StateFile $stateCorrupt -HealthUrl "http://127.0.0.1:$PORT1/" -HealthMarker 'P3H-TEST-MARKER'
    Record 'T8b' 'state file corrupt -> UNKNOWN, alive' (($v.Verdict -eq 'UNKNOWN') -and (Alive $pid1)) ("verdict=$($v.Verdict) alive=$(Alive $pid1); " + ($v.Reasons -join '; '))

    # ===== T9: scheduled task fires repeatedly -> no double start, no false kill =====
    Write-State $PORT1 $stateMatch
    $pidBefore = Get-V15CListenerPid $PORT1
    $countBefore = $script:started.Count
    $r1 = Test-IsV15CDjango -ListenerPid $pidBefore -Port $PORT1 -V15Root $V15ROOT -DjangoPython $Python -StateFile $stateMatch -HealthUrl "http://127.0.0.1:$PORT1/" -HealthMarker 'P3H-TEST-MARKER'
    $r2 = Test-IsV15CDjango -ListenerPid $pidBefore -Port $PORT1 -V15Root $V15ROOT -DjangoPython $Python -StateFile $stateMatch -HealthUrl "http://127.0.0.1:$PORT1/" -HealthMarker 'P3H-TEST-MARKER'
    $r3 = Test-IsV15CDjango -ListenerPid $pidBefore -Port $PORT1 -V15Root $V15ROOT -DjangoPython $Python -StateFile $stateMatch -HealthUrl "http://127.0.0.1:$PORT1/" -HealthMarker 'P3H-TEST-MARKER'
    $pidAfter = Get-V15CListenerPid $PORT1
    Record 'T9' 'repeated trigger -> no double start, no false kill' (($r1.Verdict -eq 'OWNED') -and ($r2.Verdict -eq 'OWNED') -and ($r3.Verdict -eq 'OWNED') -and ($pidBefore -eq $pidAfter) -and ($script:started.Count -eq $countBefore)) ("v1=$($r1.Verdict) v2=$($r2.Verdict) v3=$($r3.Verdict) pid=$pidBefore->$pidAfter started_count=$($script:started.Count)")

    # ===== T10: process really stopped -> port free, start eligible =====
    # This kills only $pidBefore, which this script started (p1) on a test port.
    Stop-Process -Id $pidBefore -Force -ErrorAction SilentlyContinue
    for ($i = 0; $i -lt 25; $i++) {
        if ((Get-V15CListenerPid $PORT1) -eq 0) { break }
        Start-Sleep -Milliseconds 200
    }
    $freePid = Get-V15CListenerPid $PORT1
    $v = Test-IsV15CDjango -ListenerPid 0 -Port $PORT1 -V15Root $V15ROOT -DjangoPython $Python -StateFile $stateMatch
    Record 'T10' 'stopped -> port free, start eligible' (($freePid -eq 0) -and ($v.Verdict -eq 'UNKNOWN') -and ($v.Reasons -contains 'no_listener_on_port')) ("port_pid=$freePid verdict=$($v.Verdict); " + ($v.Reasons -join '; '))

    # ===== T11: production ports untouched =====
    $prodMid = @{ '8022' = (Get-V15CListenerPid 8022); '8770' = (Get-V15CListenerPid 8770); '8030' = (Get-V15CListenerPid 8030) }
    $untouched = ($prodBefore['8770'] -eq $prodMid['8770']) -and ($prodBefore['8030'] -eq $prodMid['8030'])
    $noProdPort = -not (($PORT1 -in @(8022, 8770, 8030)) -or ($PORT3 -in @(8022, 8770, 8030)) -or ($PORT4 -in @(8022, 8770, 8030)) -or ($DEADPORT -in @(8022, 8770, 8030)))
    Record 'T11' 'does not affect 8022/8770/8030' ($untouched -and $noProdPort) ("8770={0}->{1} 8030={2}->{3} 8022={4}->{5} test_ports_exclude_prod={6}" -f $prodBefore['8770'], $prodMid['8770'], $prodBefore['8030'], $prodMid['8030'], $prodBefore['8022'], $prodMid['8022'], $noProdPort)

    # ===== T12: cleanup touches only our own processes (full endpoint-set contract) =====
    # Compares the COMPLETE IPv4+IPv6 endpoint set for 8770 (never First-1). A dual
    # listener on one tuple is a legitimate stable state; a genuine set change (a
    # production endpoint added or removed) fails with the diff, never silently.
    foreach ($proc in $script:started) {
        if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    }
    Start-Sleep -Milliseconds 600
    $contract12 = Test-V15CListenerContract -Port 8770 -Before $prodBeforeSet8770 -TestPorts @($PORT1, $PORT3, $PORT4) -HealthUrl 'http://127.0.0.1:8770/api/rag/health'
    $set8030After = Get-V15CListenerEndpoints -Port 8030
    $ok12 = $contract12.Ok -and (@($set8030After).Count -eq 0)
    Record 'T12' 'cleanup only own test processes (8770 endpoint-set)' $ok12 ("same={0} diff={1} health={2}/{3} leaked_test_ports=[{4}] 8030=[{5}]" -f $contract12.Same, $contract12.DiffText, $contract12.HealthOk, $contract12.HealthStatus, ($contract12.LeakedTestPorts -join ','), (@($set8030After) -join ','))

    # ===== T13 (extra): the ownership module contains no process-termination call =====
    # AST-based on purpose: a plain text search would also hit the module's own
    # header comment ("it never calls Stop-Process"), which is not executable code.
    $modTokens = $null
    $modErrors = $null
    $modAst = [System.Management.Automation.Language.Parser]::ParseFile($OwnershipModulePath, [ref]$modTokens, [ref]$modErrors)
    $found = @()
    $cmdAsts = $modAst.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)
    foreach ($c in $cmdAsts) {
        $cn = $c.GetCommandName()
        if ($cn -and ($cn -match '^(Stop-Process|taskkill|kill|spps)$')) { $found += ("command:" + $cn) }
    }
    $memberAsts = $modAst.FindAll({ param($n) $n -is [System.Management.Automation.Language.InvokeMemberExpressionAst] }, $true)
    foreach ($m in $memberAsts) {
        if ($m.Member -and $m.Member.Value -eq 'Kill') { $found += 'method:.Kill()' }
    }
    $parseClean = (-not $modErrors) -or ($modErrors.Count -eq 0)
    Record 'T13' 'ownership module never terminates processes' (($found.Count -eq 0) -and $parseClean) ("termination_calls=[$($found -join ',')] command_asts=$($cmdAsts.Count) parse_clean=$parseClean module_sha256=$(Get-Sha256 $OwnershipModulePath)")

    # ===== T14 (extra): the official launcher was not modified during this run =====
    $officialShaAfter = Get-Sha256 $OfficialLauncher
    Record 'T14' 'official launcher unchanged during run' (($officialShaAfter -eq $ExpectedOfficialSha) -and ($officialShaAfter -eq $officialShaBefore)) ("before=$officialShaBefore after=$officialShaAfter expected=$ExpectedOfficialSha")

    # =====================================================================
    # Phase 18 (T15-T27): R-1 hardening - atomic state file, single-owner
    # claim, and the ownership-verdict branches required by the phase-18
    # acceptance gates. T1-T14 above are re-run unchanged; nothing here
    # replaces them.
    # =====================================================================

    # ----- T15: atomic state write, concurrent reader never sees a partial file -----
    $atomicState = Join-Path $tmp 'state-atomic.json'
    $readerOut = Join-Path $tmp 'reader-result.txt'
    $readerPs1 = Join-Path $tmp 'reader.ps1'
    $seed15 = Write-V15CStateRecord -StateFile $atomicState -ProcessId 50001 -Port $PORT7 -V15Root 'TEST' -CreatedAtUtc '2026-10-27T03:00:00.0000000Z'
    $readerSource = @'
# .NET reader on purpose: Windows PowerShell 5.1 Get-Content -Raw can return
# $null while the file is non-empty, which would be a false corruption signal.
$bad = 0
$openErr = 0
$empty = 0
$file = '__FILE__'
$out = '__OUT__'
for ($i = 0; $i -lt 600; $i++) {
  $raw = $null
  try {
    $raw = [System.IO.File]::ReadAllText($file)
  } catch {
    # A rename-replace briefly denies new opens. That is contention, not content.
    $openErr++
    Start-Sleep -Milliseconds 2
    continue
  }
  if ($raw.Length -eq 0) { $empty++; continue }
  try {
    $o = $raw | ConvertFrom-Json
    if (-not ($o -and $o.pid)) { $bad++ }
  } catch {
    $bad++
  }
}
Set-Content -LiteralPath $out -Value ("bad=$bad;openErr=$openErr;empty=$empty") -Encoding ascii
'@
    $readerSource = $readerSource.Replace('__FILE__', $atomicState).Replace('__OUT__', $readerOut)
    Set-Content -LiteralPath $readerPs1 -Value $readerSource -Encoding ascii
    $readerProc = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', $readerPs1) -PassThru -WindowStyle Hidden
    $writes15 = 0
    for ($i = 0; $i -lt 120; $i++) {
        $r = Write-V15CStateRecord -StateFile $atomicState -ProcessId 50001 -Port $PORT7 -V15Root 'TEST' -CreatedAtUtc ('2026-10-27T03:00:{0:00}.0000000Z' -f ($i % 60)) -AllowOverwrite
        if ($r.Written) { $writes15++ }
    }
    $null = $readerProc.WaitForExit(120000)
    $readerText = if (Test-Path -LiteralPath $readerOut) { (Get-Content -Raw -LiteralPath $readerOut).Trim() } else { 'bad=-1;openErr=-1' }
    $badReads = -1
    $openErrs = -1
    $emptyReads = -1
    $m15 = [regex]::Match($readerText, 'bad=(\d+);openErr=(\d+);empty=(\d+)')
    if ($m15.Success) {
        $badReads = [int]$m15.Groups[1].Value
        $openErrs = [int]$m15.Groups[2].Value
        $emptyReads = [int]$m15.Groups[3].Value
    }
    $leftovers = @(Get-ChildItem -LiteralPath $tmp -Filter 'state-atomic.json.tmp*').Count
    $final15 = Read-V15CStateRecord -StateFile $atomicState
    Record 'T15' 'atomic state write: reader never sees partial/empty JSON' (($seed15.Written) -and ($writes15 -eq 120) -and ($badReads -eq 0) -and ($emptyReads -eq 0) -and ($leftovers -eq 0) -and ($final15.Ok)) ("seed=$($seed15.Written) writes=$writes15 reader=$readerText tmp_leftovers=$leftovers final_ok=$($final15.Ok)")

    # ----- T16: two launchers racing for ownership -> exactly one writer wins -----
    $raceState = Join-Path $tmp 'state-race.json'
    $goFlag = Join-Path $tmp 'go.flag'
    $childPs1 = Join-Path $tmp 'race-child.ps1'
    if (Test-Path -LiteralPath $raceState) { Remove-Item -LiteralPath $raceState -Force }
    if (Test-Path -LiteralPath $goFlag) { Remove-Item -LiteralPath $goFlag -Force }
    $outA = Join-Path $tmp 'race-a.json'
    $outB = Join-Path $tmp 'race-b.json'
    $childSource = @'
param([string]$Module, [string]$StateFile, [string]$Go, [string]$Out, [int]$Port)
$ErrorActionPreference = 'Stop'
. $Module
for ($i = 0; $i -lt 400; $i++) {
  if (Test-Path -LiteralPath $Go) { break }
  Start-Sleep -Milliseconds 25
}
$r = Write-V15CStateRecord -StateFile $StateFile -ProcessId $PID -Port $Port -V15Root 'TEST' -CreatedAtUtc '2026-10-27T03:10:00.0000000Z'
[pscustomobject]@{ pid = $PID; written = $r.Written; reason = $r.Reason; existing = $r.ExistingPid } | ConvertTo-Json | Set-Content -LiteralPath $Out -Encoding utf8
Start-Sleep -Seconds 3
'@
    Set-Content -LiteralPath $childPs1 -Value $childSource -Encoding ascii
    $commonArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', $childPs1, '-Module', $OwnershipModulePath, '-StateFile', $raceState, '-Go', $goFlag, '-Port', [string]$PORT7)
    $cA = Start-Process -FilePath 'powershell.exe' -ArgumentList ($commonArgs + @('-Out', $outA)) -PassThru -WindowStyle Hidden
    $cB = Start-Process -FilePath 'powershell.exe' -ArgumentList ($commonArgs + @('-Out', $outB)) -PassThru -WindowStyle Hidden
    Start-Sleep -Milliseconds 900
    Set-Content -LiteralPath $goFlag -Value 'go' -Encoding ascii
    $null = $cA.WaitForExit(60000)
    $null = $cB.WaitForExit(60000)
    $ra = if (Test-Path -LiteralPath $outA) { Get-Content -Raw -LiteralPath $outA | ConvertFrom-Json } else { $null }
    $rb = if (Test-Path -LiteralPath $outB) { Get-Content -Raw -LiteralPath $outB | ConvertFrom-Json } else { $null }
    $raceFinal = Read-V15CStateRecord -StateFile $raceState
    $winners = @()
    $losers = @()
    foreach ($r in @($ra, $rb)) {
        if (-not $r) { continue }
        if ($r.written) { $winners += $r } else { $losers += $r }
    }
    $t16ok = ($winners.Count -eq 1) -and ($losers.Count -eq 1) -and $raceFinal.Ok -and ([int]$raceFinal.Record.pid -eq [int]$winners[0].pid) -and ($losers[0].reason -in @('existing_owner_alive', 'mutex_timeout'))
    Record 'T16' 'concurrent launchers: one owner wins, no double write' $t16ok ("winner_pid={0} loser_reason={1} file_pid={2} file_ok={3}" -f ($(if ($winners.Count -gt 0) { $winners[0].pid } else { 'none' })), ($(if ($losers.Count -gt 0) { $losers[0].reason } else { 'none' })), ($(if ($raceFinal.Ok) { $raceFinal.Record.pid } else { 'n/a' })), $raceFinal.Ok)

    # ----- T17: a live foreign owner is never overwritten -----
    $ownState = Join-Path $tmp 'state-owned.json'
    $seed17 = Write-V15CStateRecord -StateFile $ownState -ProcessId $PID -Port $PORT7 -V15Root 'TEST' -CreatedAtUtc '2026-10-27T03:20:00.0000000Z'
    $before17 = if (Test-Path -LiteralPath $ownState) { Get-Content -Raw -LiteralPath $ownState } else { '' }
    $r17 = Write-V15CStateRecord -StateFile $ownState -ProcessId 59999 -Port $PORT7 -V15Root 'TEST' -CreatedAtUtc '2026-10-27T03:20:01.0000000Z'
    $after17 = if (Test-Path -LiteralPath $ownState) { Get-Content -Raw -LiteralPath $ownState } else { '' }
    Record 'T17' 'live foreign owner is never overwritten' (($seed17.Written) -and (-not $r17.Written) -and ($r17.Reason -eq 'existing_owner_alive') -and ($before17 -eq $after17) -and ([int]$r17.ExistingPid -eq $PID)) ("seed=$($seed17.Written) write=$($r17.Written) reason=$($r17.Reason) existing=$($r17.ExistingPid) unchanged=$($before17 -eq $after17)")

    # ----- Phase-18 live listener on PORT7 (used by T18/T21/T23/T25) -----
    $p7 = Start-Listener $Python $PORT7 'django'
    $pid7 = Get-V15CListenerPid $PORT7
    $state7 = Join-Path $tmp 'state-p7.json'
    $created7 = Get-RealCreatedUtc $pid7
    $w7 = Write-V15CStateRecord -StateFile $state7 -ProcessId $pid7 -Port $PORT7 -V15Root $V15ROOT -CreatedAtUtc $created7

    # ----- T18: creation time changed by 3s (near-domain) -> UNKNOWN, alive -----
    $stateShift = Join-Path $tmp 'state-p7-shift.json'
    $shifted = ''
    if ($created7) { $shifted = ([datetime]::Parse($created7).ToUniversalTime().AddSeconds(3)).ToString('o') }
    $null = Write-V15CStateRecord -StateFile $stateShift -ProcessId $pid7 -Port $PORT7 -V15Root $V15ROOT -CreatedAtUtc $shifted -AllowOverwrite
    $v18 = Test-IsV15CDjango -ListenerPid $pid7 -Port $PORT7 -V15Root $V15ROOT -DjangoPython $Python -StateFile $stateShift -HealthUrl "http://127.0.0.1:$PORT7/" -HealthMarker 'P3H-TEST-MARKER'
    $reasons18 = ($v18.Reasons -join '; ')
    Record 'T18' 'creation time differs by 3s -> UNKNOWN, alive' (($pid7 -gt 0) -and ($v18.Verdict -eq 'UNKNOWN') -and ($reasons18 -match 'state_created_at_mismatch') -and (Alive $pid7)) ("verdict=$($v18.Verdict) alive=$(Alive $pid7) reasons=$reasons18")

    # ----- T19: production 8022, non-elevated -> command line unreadable -> UNKNOWN (read-only) -----
    $prodPid19 = Get-V15CListenerPid 8022
    $prodStatePath = 'C:\Users\admin\AppData\Local\FDE-AI\classroom\django-v15c-pid.json'
    $prodDjangoPython = 'C:\Users\admin\Documents\Codex\2026-08-30\new-chat\FDE-AI-v1.5\student_portal\.venv\Scripts\python.exe'
    $v19 = $null
    if ($prodPid19 -gt 0) {
        $v19 = Test-IsV15CDjango -ListenerPid $prodPid19 -Port 8022 -V15Root $V15ROOT -DjangoPython $prodDjangoPython -StateFile $prodStatePath -HealthUrl 'http://127.0.0.1:8022/login/' -HealthMarker 'FDE-AI'
    }
    $prodPid19After = Get-V15CListenerPid 8022
    $reasons19 = if ($v19) { ($v19.Reasons -join '; ') } else { 'no_listener' }
    Record 'T19' 'prod 8022 read-only verdict is never OWNED without readable evidence' (($prodPid19 -gt 0) -and ($v19 -ne $null) -and ($v19.Verdict -ne 'OWNED') -and ($prodPid19After -eq $prodPid19)) ("verdict=$(if ($v19) { $v19.Verdict } else { 'n/a' }) pid=$prodPid19->$prodPid19After reasons=$reasons19")

    # ----- T20: health check passes but identity evidence is missing -> not OWNED -----
    $fakeShim20 = 'D:\FDE-AI-UAS\v1.5C\student_portal\.venv\Scripts\python.exe'
    $t20 = [datetime]::Parse('2026-10-27T02:00:00Z').ToUniversalTime()
    $providerT20 = {
        param($procId)
        if ($procId -eq 40021) {
            return [pscustomobject]@{ ProcessId = 40021; ParentProcessId = 0; ExecutablePath = $fakeShim20; CommandLine = 'manage.py runserver 127.0.0.1:18027 --noreload'; CreationTimeUtc = $t20 }
        }
        return $null
    }.GetNewClosure()
    $listenerT20 = { param($portArg) 40021 }
    $healthT20 = { param($u, $m) [pscustomobject]@{ Ok = $true; Status = 200; MarkerOk = $true } }
    $v20 = Test-IsV15CDjango -ListenerPid 40021 -Port $PORT7 -V15Root $V15ROOT -DjangoPython $fakeShim20 -StateFile $stateAbsent -HealthUrl 'http://127.0.0.1:1/' -HealthMarker 'X' -ProcessInfoProvider $providerT20 -ListenerPidProvider $listenerT20 -HealthProvider $healthT20
    $reasons20 = ($v20.Reasons -join '; ')
    Record 'T20' 'health OK but identity unproven -> not OWNED' (($v20.Verdict -ne 'OWNED') -and ($reasons20 -match 'health_ok') -and ($reasons20 -match 'state_record_absent')) ("verdict=$($v20.Verdict) reasons=$reasons20")

    # ----- T21: UNKNOWN verdict never terminates the listener (policy) -----
    $pid21 = Get-V15CListenerPid $PORT7
    $v21 = Test-IsV15CDjango -ListenerPid $pid21 -Port $PORT7 -V15Root $V15ROOT -DjangoPython $Python -StateFile (Join-Path $tmp 'state-absent-t21.json') -HealthUrl "http://127.0.0.1:$PORT7/" -HealthMarker 'P3H-TEST-MARKER'
    $pid21After = Get-V15CListenerPid $PORT7
    Record 'T21' 'UNKNOWN -> listener stays alive, pid unchanged' (($v21.Verdict -eq 'UNKNOWN') -and (Alive $pid21) -and ($pid21After -eq $pid21)) ("verdict=$($v21.Verdict) pid=$pid21->$pid21After alive=$(Alive $pid21)")

    # ----- T22: external program occupies the port -> FOREIGN/UNKNOWN, never killed -----
    $p6 = Start-Listener $OtherPython $PORT6 'http'
    $pid6 = Get-V15CListenerPid $PORT6
    $v22 = $null
    if ($pid6 -gt 0) {
        $v22 = Test-IsV15CDjango -ListenerPid $pid6 -Port $PORT6 -V15Root $V15ROOT -DjangoPython $Python -StateFile $state7
    }
    Record 'T22' 'external occupant -> FOREIGN/UNKNOWN, alive' (($pid6 -gt 0) -and ($v22.Verdict -in @('FOREIGN', 'UNKNOWN')) -and (Alive $pid6)) ("verdict=$(if ($v22) { $v22.Verdict } else { 'n/a' }) pid=$pid6 alive=$(Alive $pid6) reasons=$(if ($v22) { $v22.Reasons -join '; ' } else { '' })")

    # ----- T23: production shape (venv shim -> child, bare manage.py) stays OWNED -----
    $t23 = [datetime]::Parse('2026-10-27T02:00:00Z').ToUniversalTime()
    $providerT23 = {
        param($procId)
        if ($procId -eq 40031) {
            return [pscustomobject]@{ ProcessId = 40031; ParentProcessId = 40032; ExecutablePath = 'D:\YoloRuntime\python.exe'; CommandLine = 'D:\YoloRuntime\python.exe manage.py runserver 127.0.0.1:18027 --noreload'; CreationTimeUtc = $t23 }
        }
        if ($procId -eq 40032) {
            return [pscustomobject]@{ ProcessId = 40032; ParentProcessId = 0; ExecutablePath = $fakeShim20; CommandLine = 'shim'; CreationTimeUtc = $t23 }
        }
        return $null
    }.GetNewClosure()
    $listenerT23 = { param($portArg) 40031 }
    $stateT23 = Join-Path $tmp 'state-t23.json'
    [pscustomobject]@{ pid = 40031; created_at = '2026-10-27T02:00:00.0000000Z'; port = $PORT7; v15_root = 'TEST' } |
        ConvertTo-Json | Set-Content -LiteralPath $stateT23 -Encoding utf8
    $v23 = Test-IsV15CDjango -ListenerPid 40031 -Port $PORT7 -V15Root $V15ROOT -DjangoPython $fakeShim20 -StateFile $stateT23 -HealthUrl 'http://127.0.0.1:1/' -HealthMarker 'X' -ProcessInfoProvider $providerT23 -ListenerPidProvider $listenerT23 -HealthProvider $healthT20
    $reasons23 = ($v23.Reasons -join '; ')
    Record 'T23' 'bare manage.py (production shape) -> OWNED, S7 neutral' (($v23.Verdict -eq 'OWNED') -and ($reasons23 -match 'root_hint_absent') -and ($reasons23 -match 'ancestor_exe_is_django_python')) ("verdict=$($v23.Verdict) reasons=$reasons23")

    # ----- T24: another project with an absolute \manage.py path -> FOREIGN, alive -----
    $otherRoot = Join-Path $tmp 'otherproj'
    New-Item -ItemType Directory -Force -Path $otherRoot | Out-Null
    Copy-Item -LiteralPath $FakeManage -Destination (Join-Path $otherRoot 'manage.py') -Force
    $otherManage = Join-Path $otherRoot 'manage.py'
    $p5 = Start-Process -FilePath $Python -ArgumentList @($otherManage, 'runserver', "127.0.0.1:$PORT5", '--noreload') -PassThru -WindowStyle Hidden
    $script:started.Add($p5)
    for ($i = 0; $i -lt 60; $i++) { if ((Get-V15CListenerPid $PORT5) -ne 0) { break }; Start-Sleep -Milliseconds 250 }
    $pid5 = Get-V15CListenerPid $PORT5
    $v24 = $null
    if ($pid5 -gt 0) {
        $v24 = Test-IsV15CDjango -ListenerPid $pid5 -Port $PORT5 -V15Root $V15ROOT -DjangoPython $Python -StateFile $state7 -HealthUrl "http://127.0.0.1:$PORT5/" -HealthMarker 'P3H-TEST-MARKER'
    }
    $reasons24 = if ($v24) { $v24.Reasons -join '; ' } else { '' }
    Record 'T24' 'absolute manage.py under another root -> FOREIGN, alive' (($pid5 -gt 0) -and ($v24.Verdict -eq 'FOREIGN') -and ($reasons24 -match 'root_hint_mismatch') -and (Alive $pid5)) ("verdict=$(if ($v24) { $v24.Verdict } else { 'n/a' }) pid=$pid5 alive=$(Alive $pid5) reasons=$reasons24")

    # ----- T25: repeated scheduled trigger -> no restart, state file untouched -----
    $null = Write-V15CStateRecord -StateFile $state7 -ProcessId $pid7 -Port $PORT7 -V15Root $V15ROOT -CreatedAtUtc $created7 -AllowOverwrite
    $state7HashBefore = Get-Sha256 $state7
    $state7MtimeBefore = (Get-Item -LiteralPath $state7).LastWriteTimeUtc
    $r25 = @()
    for ($i = 0; $i -lt 3; $i++) {
        $r25 += (Test-IsV15CDjango -ListenerPid $pid7 -Port $PORT7 -V15Root $V15ROOT -DjangoPython $Python -StateFile $state7 -HealthUrl "http://127.0.0.1:$PORT7/" -HealthMarker 'P3H-TEST-MARKER').Verdict
    }
    $state7HashAfter = Get-Sha256 $state7
    $state7MtimeAfter = (Get-Item -LiteralPath $state7).LastWriteTimeUtc
    $pid7After = Get-V15CListenerPid $PORT7
    Record 'T25' 'repeated trigger: OWNED x3, no restart, state untouched' (($r25.Count -eq 3) -and ($r25 -notcontains 'UNKNOWN') -and ($r25 -notcontains 'FOREIGN') -and ($pid7After -eq $pid7) -and ($state7HashBefore -eq $state7HashAfter) -and ($state7MtimeBefore -eq $state7MtimeAfter)) ("verdicts=$($r25 -join ',') pid=$pid7->$pid7After state_unchanged=$($state7HashBefore -eq $state7HashAfter) mtime_unchanged=$($state7MtimeBefore -eq $state7MtimeAfter)")

    # ----- T26: corrupt state -> verdict UNKNOWN and the write is refused (no silent repair) -----
    $stateCorrupt2 = Join-Path $tmp 'state-corrupt2.json'
    Set-Content -LiteralPath $stateCorrupt2 -Value '{not-json' -Encoding ascii
    $corruptBefore = Get-Content -Raw -LiteralPath $stateCorrupt2
    $v26 = Test-IsV15CDjango -ListenerPid $pid7 -Port $PORT7 -V15Root $V15ROOT -DjangoPython $Python -StateFile $stateCorrupt2 -HealthUrl "http://127.0.0.1:$PORT7/" -HealthMarker 'P3H-TEST-MARKER'
    $r26 = Write-V15CStateRecord -StateFile $stateCorrupt2 -ProcessId $pid7 -Port $PORT7 -V15Root $V15ROOT -CreatedAtUtc $created7
    $corruptAfter = Get-Content -Raw -LiteralPath $stateCorrupt2
    Record 'T26' 'corrupt state: UNKNOWN + write refused, file untouched' (($v26.Verdict -eq 'UNKNOWN') -and (-not $r26.Written) -and ($r26.Reason -eq 'existing_state_corrupt') -and ($corruptBefore -eq $corruptAfter) -and (Alive $pid7)) ("verdict=$($v26.Verdict) write=$($r26.Written) reason=$($r26.Reason) untouched=$($corruptBefore -eq $corruptAfter)")

    # ----- T27: isolated occupant stops -> port free -> fresh listener is OWNED again -----
    if ($pid6 -gt 0) { Stop-Process -Id $pid6 -Force -ErrorAction SilentlyContinue }
    $freed = Wait-PortFree $PORT6
    $p6b = Start-Listener $Python $PORT6 'django'
    $pid6b = Get-V15CListenerPid $PORT6
    $state6 = Join-Path $tmp 'state-p6.json'
    $created6 = Get-RealCreatedUtc $pid6b
    $w6 = Write-V15CStateRecord -StateFile $state6 -ProcessId $pid6b -Port $PORT6 -V15Root $V15ROOT -CreatedAtUtc $created6
    $v27 = $null
    if ($pid6b -gt 0) {
        $v27 = Test-IsV15CDjango -ListenerPid $pid6b -Port $PORT6 -V15Root $V15ROOT -DjangoPython $Python -StateFile $state6 -HealthUrl "http://127.0.0.1:$PORT6/" -HealthMarker 'P3H-TEST-MARKER'
    }
    Record 'T27' 'after occupant stops: port free, fresh listener -> OWNED' (($freed) -and ($pid6b -gt 0) -and ($w6.Written) -and ($v27.Verdict -eq 'OWNED')) ("port_freed=$freed new_pid=$pid6b state_written=$($w6.Written) verdict=$(if ($v27) { $v27.Verdict } else { 'n/a' }) reasons=$(if ($v27) { $v27.Reasons -join '; ' } else { '' })")
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
        module_sha256    = (Get-Sha256 $OwnershipModulePath)
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
    Write-Output 'V15C_OWNERSHIP_TESTS_FAIL'
    exit 1
}
Write-Output 'V15C_OWNERSHIP_TESTS_PASS'
