# P3-H Phase 19: fault-injection matrix (F01-F14) for the v1.5C ownership /
# adoption decision path.
#
# Purpose
#   Prove that every abnormal condition ends in a SAFE state:
#     - verdict is UNKNOWN or FOREIGN, never a false OWNED
#     - no process is ever terminated by the decision path
#     - a state file is never half-written, never silently replaced
#     - adoption failure exits without killing or restarting the listener
#
# Safety boundary (identical to the Phase 17/18 harness)
#   - Only non-production ports 18031 / 18032 / 18033 / 18034 / 18099 are used.
#     8022 / 8770 / 8030 are only READ (listener pid snapshots), never written.
#   - Only processes started by this script ($script:started) are ever stopped.
#   - All scratch files live in a per-run temp directory that is removed at exit.
#   - The module under test is dot-sourced from the real V15C-Ownership.ps1 /
#     V15C-Adoption.ps1, i.e. exactly what the patched launcher loads.
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

foreach ($pname in @('http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY')) {
    [Environment]::SetEnvironmentVariable($pname, $null, 'Process')
}
$env:NO_PROXY = '127.0.0.1,localhost'

$here = $PSScriptRoot
if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $FakeManage) { $FakeManage = Join-Path $here 'fake_manage.py' }

# Phase 19 close-out: full endpoint-set listener contract (replaces single-PID checks).
$ListenerContractModulePath = Join-Path $here 'V15C-ListenerContract.ps1'
. $ListenerContractModulePath

$OwnershipModulePath = Join-Path $here 'V15C-Ownership.ps1'
$AdoptionModulePath = Join-Path $here 'V15C-Adoption.ps1'
# NOTE: the modules are dot-sourced inside the try block, AFTER F10. F10 must
# observe a scope where neither module is loaded, otherwise the adoption guard
# finds the ownership functions through the parent scope and never throws.

$script:results = New-Object System.Collections.Generic.List[object]
$script:started = New-Object System.Collections.Generic.List[object]
$script:scratch = Join-Path $env:TEMP ('p3h-phase19-fault-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $script:scratch | Out-Null

$PORT_DJANGO = 18031
$PORT_FOREIGN = 18032
$PORT_SPARE = 18033

$TEST_MARKER = 'P3H-TEST-MARKER'

function Record([string]$id, [string]$name, [bool]$ok, [string]$detail) {
    $script:results.Add([pscustomobject]@{ Id = $id; Name = $name; Ok = $ok; Detail = $detail })
    $tag = if ($ok) { 'PASS' } else { 'FAIL' }
    Write-Output ("{0} {1} {2} :: {3}" -f $tag, $id, $name, $detail)
}

function Start-Listener([string]$exe, [int]$port, [string]$mode) {
    if ($mode -eq 'django') {
        $proc = Start-Process -FilePath $exe -ArgumentList @($FakeManage, 'runserver', "127.0.0.1:$port", '--noreload') -PassThru -WindowStyle Hidden
    } else {
        $proc = Start-Process -FilePath $exe -ArgumentList @('-m', 'http.server', "$port", '--bind', '127.0.0.1') -PassThru -WindowStyle Hidden
    }
    $script:started.Add($proc)
    for ($i = 0; $i -lt 80; $i++) {
        if ((Get-V15CListenerPid $port) -ne 0) { break }
        Start-Sleep -Milliseconds 250
    }
    return $proc
}

function Stop-Own([object]$proc) {
    if (-not $proc) { return }
    try {
        if (-not $proc.HasExited) { $proc.Kill(); [void]$proc.WaitForExit(3000) }
    } catch { }
}

function Stop-AllOwned() {
    foreach ($p in $script:started) { Stop-Own $p }
    $script:started.Clear()
}

function Wait-PortFree([int]$port, [int]$timeoutMs = 8000) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.ElapsedMilliseconds -lt $timeoutMs) {
        if ((Get-V15CListenerPid $port) -eq 0) { return $true }
        Start-Sleep -Milliseconds 150
    }
    return ((Get-V15CListenerPid $port) -eq 0)
}

function New-StatePath([string]$tag) {
    return (Join-Path $script:scratch ("state-$tag.json"))
}

function Write-StateFile {
    param([string]$Path, [int]$ProcessId, [string]$CreatedAt = '', [int]$Port = 0, [string]$RawText = '')
    if ($RawText) { [System.IO.File]::WriteAllText($Path, $RawText, [System.Text.UTF8Encoding]::new($false)); return }
    if (-not $CreatedAt) {
        $p = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
        if ($p -and $p.CreationDate) { $CreatedAt = ([datetime]$p.CreationDate).ToUniversalTime().ToString('o') }
    }
    $obj = [ordered]@{ pid = $ProcessId; created_at = $CreatedAt; port = $Port; v15_root = 'PHASE19-TEST' }
    [System.IO.File]::WriteAllText($Path, ($obj | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))
}

function Get-FileSha([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return '' }
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Invoke-Judge {
    param([int]$ListenerPid, [int]$Port, [string]$StateFile, [string]$V15RootOverride = '', [scriptblock]$InfoProvider = $null, [scriptblock]$ListenerProvider = $null, [scriptblock]$HealthProvider = $null)
    $root = if ($V15RootOverride) { $V15RootOverride } else { $script:scratch }
    $args = @{
        ListenerPid = $ListenerPid
        Port        = $Port
        V15Root     = $root
        DjangoPython = $Python
        StateFile   = $StateFile
        HealthUrl   = "http://127.0.0.1:$Port/"
        HealthMarker = $TEST_MARKER
    }
    if ($InfoProvider) { $args['ProcessInfoProvider'] = $InfoProvider }
    if ($ListenerProvider) { $args['ListenerPidProvider'] = $ListenerProvider }
    if ($HealthProvider) { $args['HealthProvider'] = $HealthProvider }
    return (Test-IsV15CDjango @args)
}

function Invoke-AdoptionGate {
    param([int]$ListenerPid, [int]$Port, [string]$V15RootOverride = '', [scriptblock]$ListenerProvider = $null, [scriptblock]$HealthProvider = $null)
    $root = if ($V15RootOverride) { $V15RootOverride } else { $script:scratch }
    $args = @{
        ListenerPid  = $ListenerPid
        Port         = $Port
        V15Root      = $root
        DjangoPython = $Python
        HealthUrl    = "http://127.0.0.1:$Port/"
        HealthMarkers = @($TEST_MARKER)
        MutexName    = ''
        CurrentPid   = $PID
    }
    if ($ListenerProvider) { $args['ListenerPidProvider'] = $ListenerProvider }
    if ($HealthProvider) { $args['HealthProvider'] = $HealthProvider }
    return (Test-V15CAdoptionEligible @args)
}

function Snapshot-Prod {
    return [pscustomobject]@{
        P8022 = [int](Get-V15CListenerPid 8022)
        P8770 = [int](Get-V15CListenerPid 8770)
        P8030 = [int](Get-V15CListenerPid 8030)
    }
}

# A real manage.py must exist under V15Root for E4b to pass. The scratch root
# gets a copy of fake_manage.py renamed to manage.py so the hash comparison has
# something legitimate to compare against. This is done after the modules load.

Write-Output ("SCRATCH {0}" -f $script:scratch)

try {
    # =====================================================================
    # F10 module missing (adoption loaded without the ownership module)
    # MUST run before any dot-source so the guard sees a clean scope.
    # =====================================================================
    $isoDir = Join-Path $script:scratch 'iso-no-ownership'
    New-Item -ItemType Directory -Force -Path $isoDir | Out-Null
    Copy-Item -LiteralPath $AdoptionModulePath -Destination (Join-Path $isoDir 'V15C-Adoption.ps1') -Force
    $orphanPath = Join-Path $isoDir 'V15C-Adoption.ps1'
    $f10msg = ''
    $f10threw = $false
    try {
        & {
            . $orphanPath
        } 2>&1 | Out-Null
        $f10threw = $false
    } catch {
        $f10threw = $true
        $f10msg = $_.Exception.Message
    }
    $ok10 = $f10threw -and ($f10msg -match 'V15C-Ownership')
    Record 'F10' 'module missing -> adoption refuses to load' $ok10 ("threw={0} msg={1}" -f $f10threw, $f10msg)

    # ---------------------------------------------------------------------
    # Load the modules under test.
    # ---------------------------------------------------------------------
    . $OwnershipModulePath
    . $AdoptionModulePath

    Copy-Item -LiteralPath $FakeManage -Destination (Join-Path $script:scratch 'manage.py') -Force
    $prodBefore = Snapshot-Prod
    $prodBeforeSet8770 = Get-V15CListenerEndpoints -Port 8770
    Write-Output ("PROD-BEFORE 8022={0} 8770={1} 8030={2}" -f $prodBefore.P8022, $prodBefore.P8770, $prodBefore.P8030)
    Write-Output ("PROD-BEFORE-SET 8770=[{0}]" -f (@($prodBeforeSet8770) -join ','))

    # =====================================================================
    # F01 state file absent
    # =====================================================================
    $p1 = Start-Listener $Python $PORT_DJANGO 'django'
    $pid1 = [int](Get-V15CListenerPid $PORT_DJANGO)
    $state1 = New-StatePath 'f01'
    $v1 = Invoke-Judge -ListenerPid $pid1 -Port $PORT_DJANGO -StateFile $state1
    $ok1 = ($v1.Verdict -eq 'UNKNOWN') -and ($v1.Reasons -contains 'state_record_absent') -and (-not $p1.HasExited)
    Record 'F01' 'state file absent -> UNKNOWN, listener alive' $ok1 ("verdict={0} reasons={1} alive={2}" -f $v1.Verdict, ($v1.Reasons -join ';'), (-not $p1.HasExited))

    # =====================================================================
    # F02 state file corrupt
    # =====================================================================
    $state2 = New-StatePath 'f02'
    Write-StateFile -Path $state2 -RawText '{ "pid": 12'
    $shaBefore2 = Get-FileSha $state2
    $v2 = Invoke-Judge -ListenerPid $pid1 -Port $PORT_DJANGO -StateFile $state2
    $w2 = Write-V15CStateRecord -StateFile $state2 -ProcessId $pid1 -Port $PORT_DJANGO -V15Root $script:scratch
    $shaAfter2 = Get-FileSha $state2
    $ok2 = ($v2.Verdict -eq 'UNKNOWN') -and (-not $w2.Written) -and ($w2.Reason -eq 'existing_state_corrupt') -and ($shaBefore2 -eq $shaAfter2) -and (-not $p1.HasExited)
    Record 'F02' 'state corrupt -> UNKNOWN, write refused, file untouched' $ok2 ("verdict={0} written={1} reason={2} untouched={3}" -f $v2.Verdict, $w2.Written, $w2.Reason, ($shaBefore2 -eq $shaAfter2))

    # =====================================================================
    # F03 state file not writable (read-only attribute)
    # =====================================================================
    $state3 = New-StatePath 'f03'
    Write-StateFile -Path $state3 -ProcessId $pid1 -Port $PORT_DJANGO
    $shaBefore3 = Get-FileSha $state3
    Set-ItemProperty -LiteralPath $state3 -Name IsReadOnly -Value $true
    $w3 = $null
    try {
        $w3 = Write-V15CStateRecord -StateFile $state3 -ProcessId $pid1 -Port $PORT_DJANGO -V15Root $script:scratch -MutexTimeoutMs 1500
    } catch {
        $w3 = [pscustomobject]@{ Written = $false; Reason = 'threw:' + $_.Exception.GetType().Name; ExistingPid = 0 }
    }
    Set-ItemProperty -LiteralPath $state3 -Name IsReadOnly -Value $false
    $shaAfter3 = Get-FileSha $state3
    $ok3 = (-not $w3.Written) -and ($shaBefore3 -eq $shaAfter3) -and (-not $p1.HasExited)
    Record 'F03' 'state not writable -> refused, no crash, file untouched' $ok3 ("written={0} reason={1} untouched={2} alive={3}" -f $w3.Written, $w3.Reason, ($shaBefore3 -eq $shaAfter3), (-not $p1.HasExited))

    # =====================================================================
    # F04 PID reuse (record points at another live process)
    # =====================================================================
    $state4 = New-StatePath 'f04'
    $decoy = $script:started[0]
    Write-StateFile -Path $state4 -ProcessId ([int]$decoy.Id) -Port $PORT_DJANGO
    $v4 = Invoke-Judge -ListenerPid $pid1 -Port $PORT_DJANGO -StateFile $state4
    $ok4 = ($v4.Verdict -eq 'UNKNOWN') -and ($v4.Reasons -contains 'state_pid_mismatch') -and (-not $p1.HasExited)
    Record 'F04' 'pid reuse -> UNKNOWN, listener alive' $ok4 ("verdict={0} reasons={1}" -f $v4.Verdict, ($v4.Reasons -join ';'))

    # =====================================================================
    # F05 CreationDate mismatch (same pid, stale timestamp)
    # =====================================================================
    $state5 = New-StatePath 'f05'
    $stale = ([datetime]::UtcNow.AddSeconds(-30)).ToString('o')
    Write-StateFile -Path $state5 -ProcessId $pid1 -CreatedAt $stale -Port $PORT_DJANGO
    $v5 = Invoke-Judge -ListenerPid $pid1 -Port $PORT_DJANGO -StateFile $state5
    $ok5 = ($v5.Verdict -eq 'UNKNOWN') -and ($v5.Reasons -contains 'state_created_at_mismatch') -and (-not $p1.HasExited)
    Record 'F05' 'creation time mismatch -> UNKNOWN, alive' $ok5 ("verdict={0} reasons={1}" -f $v5.Verdict, ($v5.Reasons -join ';'))

    # =====================================================================
    # F06 command line unreadable
    # =====================================================================
    $state6 = New-StatePath 'f06'
    Write-StateFile -Path $state6 -ProcessId $pid1 -Port $PORT_DJANGO
    $noCmd = {
        param($procId)
        [pscustomobject]@{
            ProcessId       = [int]$procId
            ParentProcessId = 0
            ExecutablePath  = ''
            CommandLine     = ''
            CreationTimeUtc = [datetime]::UtcNow
        }
    }
    $v6 = Invoke-Judge -ListenerPid $pid1 -Port $PORT_DJANGO -StateFile $state6 -InfoProvider $noCmd
    $a6 = Invoke-AdoptionGate -ListenerPid $pid1 -Port $PORT_DJANGO
    $ok6 = ($v6.Verdict -eq 'UNKNOWN') -and ($v6.Reasons -contains 'command_line_unreadable') -and (-not $p1.HasExited)
    Record 'F06' 'command line unreadable -> UNKNOWN, alive' $ok6 ("verdict={0} reasons={1} adopt={2}" -f $v6.Verdict, ($v6.Reasons -join ';'), $a6.Verdict)

    # =====================================================================
    # F07 health check fails
    # =====================================================================
    $state7 = New-StatePath 'f07'
    Write-StateFile -Path $state7 -ProcessId $pid1 -Port $PORT_DJANGO
    $badHealth = { param($url, $marker) [pscustomobject]@{ Ok = $false; Status = 0; MarkerOk = $false } }
    $v7 = Invoke-Judge -ListenerPid $pid1 -Port $PORT_DJANGO -StateFile $state7 -HealthProvider $badHealth
    $ok7 = ($v7.Verdict -ne 'OWNED') -and (-not $p1.HasExited)
    Record 'F07' 'health check fails -> never OWNED, alive' $ok7 ("verdict={0} alive={1} reasons={2}" -f $v7.Verdict, (-not $p1.HasExited), ($v7.Reasons -join ';'))

    # =====================================================================
    # F08 process exits during verification
    # =====================================================================
    # (a) process info becomes unavailable after the listener check passed
    $goneInfo = { param($procId) $null }
    $v8a = Invoke-Judge -ListenerPid $pid1 -Port $PORT_DJANGO -StateFile $state7 -InfoProvider $goneInfo
    # (b) adoption gate re-check catches listener drift between E1 and E6
    $driftScript = {
        $script:f19Drift = 0
        {
            param($port)
            $script:f19Drift = $script:f19Drift + 1
            if ($script:f19Drift -le 1) { return [int]$script:f19RealPid }
            return [int]($script:f19RealPid + 11111)
        }.GetNewClosure()
    }
    $script:f19RealPid = $pid1
    $driftProvider = & $driftScript
    $a8 = Invoke-AdoptionGate -ListenerPid $pid1 -Port $PORT_DJANGO -ListenerProvider $driftProvider
    $e6Hit = ($a8.Reasons -contains 'E6_listener_changed_during_evidence') -and ($a8.Verdict -eq 'UNKNOWN')
    $ok8 = ($v8a.Verdict -eq 'UNKNOWN') -and $e6Hit -and (-not $p1.HasExited)
    Record 'F08' 'process/listener disappears mid-check -> UNKNOWN' $ok8 ("owner_verdict={0} adopt={1} e6={2}" -f $v8a.Verdict, $a8.Verdict, $e6Hit)

    # =====================================================================
    # F09 repeated scheduler trigger
    # =====================================================================
    $state9 = New-StatePath 'f09'
    $proc9 = Get-CimInstance Win32_Process -Filter "ProcessId=$pid1" -ErrorAction SilentlyContinue
    $created9 = if ($proc9 -and $proc9.CreationDate) { ([datetime]$proc9.CreationDate).ToUniversalTime().ToString('o') } else { '' }
    $w9 = Write-V15CStateRecord -StateFile $state9 -ProcessId $pid1 -Port $PORT_DJANGO -V15Root $script:scratch -CreatedAtUtc $created9
    $verdicts = @()
    $pids = @()
    $reasons9 = ''
    for ($i = 0; $i -lt 3; $i++) {
        $vv = Invoke-Judge -ListenerPid $pid1 -Port $PORT_DJANGO -StateFile $state9
        $verdicts += $vv.Verdict
        if (-not $reasons9) { $reasons9 = ($vv.Reasons -join ';') }
        $pids += [int](Get-V15CListenerPid $PORT_DJANGO)
        Start-Sleep -Milliseconds 200
    }
    $samePid = (@($pids | Select-Object -Unique).Count -eq 1)
    $stable9 = (@($verdicts | Select-Object -Unique).Count -eq 1)
    $ok9 = $w9.Written -and $stable9 -and ($verdicts[0] -eq 'OWNED') -and $samePid -and (-not $p1.HasExited)
    Record 'F09' 'repeated trigger -> stable verdict, no restart' $ok9 ("written={0} verdicts={1} pids={2} reasons={3}" -f $w9.Written, ($verdicts -join ','), (($pids | Select-Object -Unique) -join ','), $reasons9)

    # =====================================================================
    # F11 version / schema mismatch
    # =====================================================================
    $state11 = New-StatePath 'f11'
    Write-StateFile -Path $state11 -RawText ('{ "pid": ' + $pid1 + ', "schema_version": 99 }')
    $v11 = Invoke-Judge -ListenerPid $pid1 -Port $PORT_DJANGO -StateFile $state11
    $w11 = Write-V15CStateRecord -StateFile $state11 -ProcessId $pid1 -Port $PORT_DJANGO -V15Root $script:scratch -AllowOverwrite
    $ok11 = ($v11.Verdict -eq 'UNKNOWN') -and (-not $p1.HasExited)
    Record 'F11' 'schema mismatch -> UNKNOWN, no false OWNED' $ok11 ("verdict={0} reasons={1} rewrite={2}" -f $v11.Verdict, ($v11.Reasons -join ';'), $w11.Written)

    # =====================================================================
    # F12 atomic write: reader never sees a partial file; tmp leftovers are inert
    # =====================================================================
    $state12 = New-StatePath 'f12'
    Write-StateFile -Path $state12 -ProcessId $pid1 -Port $PORT_DJANGO
    $bad12 = 0
    $reads12 = 0
    for ($w = 0; $w -lt 12; $w++) {
        [void](Write-V15CStateRecord -StateFile $state12 -ProcessId $pid1 -Port $PORT_DJANGO -V15Root $script:scratch -AllowOverwrite -MutexTimeoutMs 3000)
        for ($r = 0; $r -lt 8; $r++) {
            $reads12++
            try {
                $txt = [System.IO.File]::ReadAllText($state12)
                if ([string]::IsNullOrWhiteSpace($txt)) { $bad12++; continue }
                $obj = $txt | ConvertFrom-Json
                if (-not ($obj.PSObject.Properties.Name -contains 'pid')) { $bad12++ }
            } catch {
                $bad12++
            }
        }
    }
    # simulate an interrupted writer leaving a tmp file behind
    $tmpLeft = Join-Path $script:scratch ('state-f12.json.tmp.' + [guid]::NewGuid().ToString('N'))
    [System.IO.File]::WriteAllText($tmpLeft, '{ half written', [System.Text.UTF8Encoding]::new($false))
    $w12b = Write-V15CStateRecord -StateFile $state12 -ProcessId $pid1 -Port $PORT_DJANGO -V15Root $script:scratch -AllowOverwrite -MutexTimeoutMs 3000
    $finalOk = $false
    try { $finalOk = (($([System.IO.File]::ReadAllText($state12)) | ConvertFrom-Json).pid -eq $pid1) } catch { $finalOk = $false }
    $ok12 = ($bad12 -eq 0) -and ($reads12 -gt 0) -and $w12b.Written -and $finalOk
    Record 'F12' 'atomic write: no partial reads, tmp leftovers inert' $ok12 ("reads={0} bad={1} rewrite={2} final_ok={3}" -f $reads12, $bad12, $w12b.Written, $finalOk)

    # =====================================================================
    # F13 FOREIGN / UNKNOWN are never terminated
    # =====================================================================
    $p13 = Start-Listener $Python $PORT_FOREIGN 'foreign'
    $pid13 = [int](Get-V15CListenerPid $PORT_FOREIGN)
    $state13 = New-StatePath 'f13'
    Write-StateFile -Path $state13 -ProcessId $pid13 -Port $PORT_FOREIGN
    $v13 = Invoke-Judge -ListenerPid $pid13 -Port $PORT_FOREIGN -StateFile $state13
    $a13 = Invoke-AdoptionGate -ListenerPid $pid13 -Port $PORT_FOREIGN
    $d13 = Resolve-V15CListenerAction -Verdict $v13.Verdict -Reasons $v13.Reasons -Adoption $a13 -AdoptionEnabled $true
    $foreignAlive = -not $p13.HasExited
    $unknownAlive = -not $p1.HasExited
    $ok13 = ($v13.Verdict -eq 'FOREIGN') -and ($d13.Action -eq 'ABORT') -and $foreignAlive -and $unknownAlive
    Record 'F13' 'FOREIGN/UNKNOWN never terminated' $ok13 ("verdict={0} action={1}/{2} foreign_alive={3} unknown_alive={4}" -f $v13.Verdict, $d13.Action, $d13.Reason, $foreignAlive, $unknownAlive)

    # =====================================================================
    # F14 adoption failure -> safe exit (no kill, no state file)
    # =====================================================================
    $badRoot = Join-Path $script:scratch 'no-manage-here'
    New-Item -ItemType Directory -Force -Path $badRoot | Out-Null
    $state14 = New-StatePath 'f14'
    $a14 = Invoke-AdoptionGate -ListenerPid $pid1 -Port $PORT_DJANGO -V15RootOverride $badRoot
    $d14 = Resolve-V15CListenerAction -Verdict 'UNKNOWN' -Reasons @('state_record_absent') -Adoption $a14 -AdoptionEnabled $true
    $c14 = Invoke-V15CAdoptionClaim -Adoption $a14 -StateFile $state14 -Port $PORT_DJANGO -V15Root $badRoot
    $ok14 = ($a14.Verdict -eq 'UNKNOWN') -and ($d14.Action -eq 'ABORT') -and (-not $c14.Claimed) -and (-not (Test-Path -LiteralPath $state14)) -and (-not $p1.HasExited)
    Record 'F14' 'adoption failure -> ABORT, no kill, no state file' $ok14 ("adopt={0} decision={1}/{2} claimed={3} state_exists={4} alive={5}" -f $a14.Verdict, $d14.Action, $d14.Reason, $c14.Claimed, (Test-Path -LiteralPath $state14), (-not $p1.HasExited))

    # =====================================================================
    # Guard rails
    # =====================================================================
    $prodAfter = Snapshot-Prod
    # Full IPv4+IPv6 endpoint-set contract for 8770 (never Select-Object -First 1).
    # A dual listener on one tuple is a legitimate stable state; any genuine
    # production endpoint added/removed fails G01 and prints the diff.
    $contractG01 = Test-V15CListenerContract -Port 8770 -Before $prodBeforeSet8770 -TestPorts @($PORT_DJANGO, $PORT_FOREIGN, $PORT_SPARE) -HealthUrl 'http://127.0.0.1:8770/api/rag/health'
    $set8030After = Get-V15CListenerEndpoints -Port 8030
    $g01ok = $contractG01.Ok -and (@($set8030After).Count -eq 0)
    Record 'G01' '8770/8030 untouched by fault tests (endpoint-set)' $g01ok ("same={0} diff={1} health={2}/{3} leaked=[{4}] 8030=[{5}] 8022={6}->{7}(background scheduler may rotate 8022)" -f $contractG01.Same, $contractG01.DiffText, $contractG01.HealthOk, $contractG01.HealthStatus, ($contractG01.LeakedTestPorts -join ','), (@($set8030After) -join ','), $prodBefore.P8022, $prodAfter.P8022)

    $shaOfficial = (Get-FileHash -LiteralPath $OfficialLauncher -Algorithm SHA256).Hash.ToLowerInvariant()
    Record 'G02' 'official launcher unchanged' ($shaOfficial -eq $ExpectedOfficialSha.ToLowerInvariant()) ("sha={0}" -f $shaOfficial)

    $portsUsed = @($PORT_DJANGO, $PORT_FOREIGN, $PORT_SPARE)
    $excluded = ($portsUsed -notcontains 8022) -and ($portsUsed -notcontains 8770) -and ($portsUsed -notcontains 8030)
    Record 'G03' 'test ports exclude production' $excluded ("ports={0}" -f ($portsUsed -join ','))

    $adoptionSrc = [System.IO.File]::ReadAllText($AdoptionModulePath)
    $noKill = -not ($adoptionSrc -match 'Stop-Process')
    Record 'G04' 'adoption module never calls Stop-Process' $noKill ("contains_stop_process={0}" -f (-not $noKill))
}
finally {
    try { Stop-AllOwned } catch { }
    try { [void](Wait-PortFree $PORT_DJANGO) } catch { }
    try { [void](Wait-PortFree $PORT_FOREIGN) } catch { }
    try {
        Get-ChildItem -LiteralPath $script:scratch -Recurse -Force -ErrorAction SilentlyContinue |
            ForEach-Object { if ($_.PSIsContainer -eq $false) { try { Set-ItemProperty -LiteralPath $_.FullName -Name IsReadOnly -Value $false -ErrorAction SilentlyContinue } catch { } } }
        Remove-Item -LiteralPath $script:scratch -Recurse -Force -ErrorAction SilentlyContinue
    } catch { }
}

$pass = @($script:results | Where-Object { $_.Ok }).Count
$fail = @($script:results | Where-Object { -not $_.Ok }).Count
Write-Output ("SUMMARY pass={0} fail={1} total={2}" -f $pass, $fail, $script:results.Count)

if ($ResultJson) {
    $payload = [ordered]@{
        generated_at     = (Get-Date).ToUniversalTime().ToString('o')
        phase            = 'P3-H Phase 19 fault matrix'
        official_sha256  = (Get-FileHash -LiteralPath $OfficialLauncher -Algorithm SHA256).Hash.ToLowerInvariant()
        ownership_sha256 = (Get-FileHash -LiteralPath $OwnershipModulePath -Algorithm SHA256).Hash.ToLowerInvariant()
        adoption_sha256  = (Get-FileHash -LiteralPath $AdoptionModulePath -Algorithm SHA256).Hash.ToLowerInvariant()
        prod_before      = $prodBefore
        prod_after       = (Snapshot-Prod)
        pass             = $pass
        fail             = $fail
        total            = $script:results.Count
        results          = $script:results
    }
    $payload | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ResultJson -Encoding utf8
    Write-Output ("RESULT_JSON {0}" -f $ResultJson)
}

if ($fail -gt 0) { exit 1 } else { exit 0 }
