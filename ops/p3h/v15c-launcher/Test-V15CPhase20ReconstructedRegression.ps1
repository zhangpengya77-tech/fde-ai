<#
  P3-H Phase 20-A  RECONSTRUCTED regression suite (ownership + fault-exit + decision).

  IMPORTANT HONESTY NOTE:
    This is NOT the original 84-item suite (Test-V15CLauncherOwnership.ps1 /
    Test-V15CPhase18Adoption.ps1 / Test-V15CPhase19FaultExit.ps1). Those scripts
    were lost from disk and an exhaustive search (including AI_Cache/temp, where
    190 .ps1 files exist but ZERO Test-*.ps1) confirmed they are unrecoverable.
    This file is a FRESH reconstruction that re-verifies the SAME invariants the
    original suites covered, directly against the real authoritative modules
    (V15C-Ownership.ps1 and V15C-Adoption.ps1), and it is executed for real.
    Results are reported as a reconstructed suite, never as the original 84.

  Coverage (32 checks):
    O-01..O-11  ownership state-record invariants (single writer, atomic replace,
                never overwrite a live owner, corrupt-state refusal, schema,
                zero termination primitives)
    F-01..F-15  adoption gate E1..E8 fault matrix + claim delegation
    D-01..D-06  pure decision mapping (REUSE / ADOPT / ABORT)

  Safety:
    - Does NOT run the launcher; modules are dot-sourced only.
    - ALL adoption-eligibility calls use injected providers, so no real WMI
      process scan, no real port probe, no HTTP against production.
    - State-record tests write ONLY to a unique temp directory under $env:TEMP.
    - Uses a dedicated mutex name (Local\P3H20-Rego-Mutex), never the production
      launcher mutex, for the ownership writes.
    - Production launcher / scheduler / 8022 / 8770 / 8030 are NEVER touched.
#>
[CmdletBinding()]
param([string]$ModuleDir = '')

if ([string]::IsNullOrWhiteSpace($ModuleDir)) {
    if ($PSScriptRoot) { $ModuleDir = $PSScriptRoot }
    elseif ($MyInvocation -and $MyInvocation.MyCommand -and $MyInvocation.MyCommand.Path) { $ModuleDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
    else { $ModuleDir = (Get-Location).Path }
}
Write-Host ("ModuleDir = " + $ModuleDir)

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

$CUR   = $PID
$MUTEX = 'Local\P3H20-Rego-Mutex'

# ---- object constructors (param names avoid $PID / $HOME) -------------------
function New-InfoObj([int]$ProcId, [int]$ppid, [string]$exe, [string]$cmd, $ct) {
    [pscustomobject]@{ ProcessId = $ProcId; ParentProcessId = $ppid; CreationTimeUtc = $ct; ExecutablePath = $exe; CommandLine = $cmd }
}
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

# ---- adoption helper: ALWAYS inject all six providers (never hit production)
function Invoke-Adopt {
    param($Info, $Listen, $Health, $Venv, $Proj, $Conf)
    $defInfo   = { param($x) [pscustomobject]@{ ProcessId = 90001; ParentProcessId = 1; CreationTimeUtc = [datetime]::UtcNow; ExecutablePath = 'C:\SHIM\python.exe'; CommandLine = 'manage.py runserver 127.0.0.1:18199' } }
    $defListen = { param($x) return 90001 }
    $defHealth = { param($u, $m) [pscustomobject]@{ Ok = $true; Status = 200; ContentLength = 100; Markers = @{}; AllMarkers = $true } }
    $defVenv   = { param($a, $b) [pscustomobject]@{ ShimExists = $true; PyvenvCfgReadable = $true; HomeMatchesObserved = $true; VenvRoot = 'D:\iso_venv' } }
    $defProj   = { param($a, $b) [pscustomobject]@{ ManagePyExists = $true; ManagePySha256 = 'sha'; SameCode = $true } }
    $defConf   = { param($a, $b, $c) [pscustomobject]@{ ConflictCount = 0; MutexCheckable = $true; MutexFree = $true } }

    $p = @{
        ListenerPid  = 90001
        Port         = 18199
        V15Root      = 'D:\iso_project'
        DjangoPython = 'C:\SHIM\python.exe'
        HealthUrl    = 'http://127.0.0.1:18199/login/'
        MutexName    = ''
        CurrentPid   = $PID
        ProcessInfoProvider     = $(if ($Info)   { $Info }   else { $defInfo })
        ListenerPidProvider     = $(if ($Listen) { $Listen } else { $defListen })
        HealthProvider          = $(if ($Health) { $Health } else { $defHealth })
        VenvEvidenceProvider    = $(if ($Venv)   { $Venv }   else { $defVenv })
        ProjectEvidenceProvider = $(if ($Proj)   { $Proj }   else { $defProj })
        ConflictProvider        = $(if ($Conf)   { $Conf }   else { $defConf })
    }
    Test-V15CAdoptionEligible @p
}

$root = Join-Path $env:TEMP ('p3h20_rego_' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $root | Out-Null
function New-Stamp { ([datetime]::UtcNow).ToString('o') }

# ===========================================================================
# OWNERSHIP STATE-RECORD INVARIANTS  (O-01 .. O-11)
# ===========================================================================
try {
    $f = Join-Path $root 'o01.json'
    $r = Write-V15CStateRecord -StateFile $f -ProcessId 90001 -Port 18199 -V15Root 'D:\iso_project' -CreatedAtUtc (New-Stamp) -MutexName $MUTEX
    $ok = [bool]$r.Written -and ($r.Reason -eq 'written') -and (Test-Path $f)
    Record 'O-01' 'write to absent file -> written' $ok ("written=$($r.Written) reason=$($r.Reason)")
} catch { Record 'O-01' 'write to absent file -> written' $false ("EXCEPTION: " + $_.Exception.Message) }

try {
    $f = Join-Path $root 'o02.json'
    $r1 = Write-V15CStateRecord -StateFile $f -ProcessId $CUR -Port 18199 -V15Root 'D:\iso_project' -CreatedAtUtc (New-Stamp) -MutexName $MUTEX
    $r2 = Write-V15CStateRecord -StateFile $f -ProcessId 99999 -Port 18199 -V15Root 'D:\iso_project' -CreatedAtUtc (New-Stamp) -MutexName $MUTEX
    $rec = Get-Content -LiteralPath $f -Raw | ConvertFrom-Json
    $ok = [bool]$r1.Written -and (-not [bool]$r2.Written) -and ($r2.Reason -eq 'existing_owner_alive') -and ([int]$rec.pid -eq $CUR)
    Record 'O-02' 'live owner never overwritten; record unchanged' $ok ("r1=$($r1.Written) r2=$($r2.Written)/$($r2.Reason) pidKept=$([int]$rec.pid)")
} catch { Record 'O-02' 'live owner never overwritten; record unchanged' $false ("EXCEPTION: " + $_.Exception.Message) }

try {
    $f = Join-Path $root 'o03.json'
    $r1 = Write-V15CStateRecord -StateFile $f -ProcessId $CUR -Port 18199 -V15Root 'D:\iso_project' -CreatedAtUtc (New-Stamp) -MutexName $MUTEX
    $r2 = Write-V15CStateRecord -StateFile $f -ProcessId $CUR -Port 18199 -V15Root 'D:\iso_project' -CreatedAtUtc (New-Stamp) -MutexName $MUTEX
    $ok = [bool]$r1.Written -and [bool]$r2.Written -and ($r2.Reason -eq 'written')
    Record 'O-03' 'same pid may refresh its own record' $ok ("r1=$($r1.Written) r2=$($r2.Written)/$($r2.Reason)")
} catch { Record 'O-03' 'same pid may refresh its own record' $false ("EXCEPTION: " + $_.Exception.Message) }

try {
    $f = Join-Path $root 'o04.json'
    $r1 = Write-V15CStateRecord -StateFile $f -ProcessId $CUR -Port 18199 -V15Root 'D:\iso_project' -CreatedAtUtc (New-Stamp) -MutexName $MUTEX
    $r2 = Write-V15CStateRecord -StateFile $f -ProcessId 99999 -Port 18199 -V15Root 'D:\iso_project' -CreatedAtUtc (New-Stamp) -MutexName $MUTEX -AllowOverwrite
    $rec = Get-Content -LiteralPath $f -Raw | ConvertFrom-Json
    $ok = [bool]$r1.Written -and [bool]$r2.Written -and ([int]$rec.pid -eq 99999)
    Record 'O-04' 'explicit AllowOverwrite takeover succeeds' $ok ("r2=$($r2.Written)/$($r2.Reason) pid=$([int]$rec.pid)")
} catch { Record 'O-04' 'explicit AllowOverwrite takeover succeeds' $false ("EXCEPTION: " + $_.Exception.Message) }

try {
    $f = Join-Path $root 'o05.json'
    $r1 = Write-V15CStateRecord -StateFile $f -ProcessId 99999 -Port 18199 -V15Root 'D:\iso_project' -CreatedAtUtc (New-Stamp) -MutexName $MUTEX
    $r2 = Write-V15CStateRecord -StateFile $f -ProcessId $CUR -Port 18199 -V15Root 'D:\iso_project' -CreatedAtUtc (New-Stamp) -MutexName $MUTEX
    $rec = Get-Content -LiteralPath $f -Raw | ConvertFrom-Json
    $ok = [bool]$r1.Written -and [bool]$r2.Written -and ([int]$rec.pid -eq $CUR)
    Record 'O-05' 'dead owner record is replaceable' $ok ("r2=$($r2.Written)/$($r2.Reason) pid=$([int]$rec.pid)")
} catch { Record 'O-05' 'dead owner record is replaceable' $false ("EXCEPTION: " + $_.Exception.Message) }

try {
    $f = Join-Path $root 'o06.json'
    Set-Content -LiteralPath $f -Value '{ this is not valid json' -Encoding ASCII
    $r = Write-V15CStateRecord -StateFile $f -ProcessId $CUR -Port 18199 -V15Root 'D:\iso_project' -CreatedAtUtc (New-Stamp) -MutexName $MUTEX
    $ok = (-not [bool]$r.Written) -and ($r.Reason -eq 'existing_state_corrupt')
    Record 'O-06' 'corrupt existing state is never silently replaced' $ok ("written=$($r.Written) reason=$($r.Reason)")
} catch { Record 'O-06' 'corrupt existing state is never silently replaced' $false ("EXCEPTION: " + $_.Exception.Message) }

try {
    $f = Join-Path $root 'o07.json'
    $r = Write-V15CStateRecord -StateFile $f -ProcessId 90001 -Port 18199 -V15Root 'D:\iso_project' -CreatedAtUtc (New-Stamp) -MutexName $MUTEX
    $leftover = @(Get-ChildItem -Path ($f + '.tmp.*') -Force -ErrorAction SilentlyContinue)
    $ok = [bool]$r.Written -and ($leftover.Count -eq 0)
    Record 'O-07' 'atomic write leaves no .tmp file' $ok ("written=$($r.Written) tmpLeftover=$($leftover.Count)")
} catch { Record 'O-07' 'atomic write leaves no .tmp file' $false ("EXCEPTION: " + $_.Exception.Message) }

try {
    $r = Read-V15CStateRecord -StateFile (Join-Path $root 'does_not_exist.json')
    $ok = (-not [bool]$r.Exists) -and (-not [bool]$r.Ok)
    Record 'O-08' 'read absent -> Exists=false' $ok ("exists=$($r.Exists) ok=$($r.Ok)")
} catch { Record 'O-08' 'read absent -> Exists=false' $false ("EXCEPTION: " + $_.Exception.Message) }

try {
    $f = Join-Path $root 'o09.json'
    Set-Content -LiteralPath $f -Value '{ broken' -Encoding ASCII
    $r = Read-V15CStateRecord -StateFile $f
    $ok = [bool]$r.Exists -and (-not [bool]$r.Ok)
    Record 'O-09' 'read corrupt -> Exists=true Ok=false' $ok ("exists=$($r.Exists) ok=$($r.Ok)")
} catch { Record 'O-09' 'read corrupt -> Exists=true Ok=false' $false ("EXCEPTION: " + $_.Exception.Message) }

try {
    $f = Join-Path $root 'o10.json'
    $null = Write-V15CStateRecord -StateFile $f -ProcessId 90001 -Port 18199 -V15Root 'D:\iso_project' -CreatedAtUtc (New-Stamp) -MutexName $MUTEX
    $rec = Get-Content -LiteralPath $f -Raw | ConvertFrom-Json
    $names = @($rec.PSObject.Properties.Name)
    # -contains is case-INsensitive; use -ccontains so the negative check for a
    # PascalCase 'Pid' key is meaningful (lowercase 'pid' must not satisfy it).
    $ok = ($names.Count -eq 4) -and ($names -ccontains 'pid') -and ($names -ccontains 'created_at') -and ($names -ccontains 'port') -and ($names -ccontains 'v15_root') -and (-not ($names -ccontains 'Pid'))
    Record 'O-10' 'payload schema is snake_case (pid/created_at/port/v15_root)' $ok ("fields=" + ($names -join ','))
} catch { Record 'O-10' 'payload schema is snake_case (pid/created_at/port/v15_root)' $false ("EXCEPTION: " + $_.Exception.Message) }

try {
    $ownText = ((Get-Content -LiteralPath $ownMod) | Where-Object { $_ -notmatch '^\s*#' }) -join "`n"
    $adpText = ((Get-Content -LiteralPath $adpMod) | Where-Object { $_ -notmatch '^\s*#' }) -join "`n"
    $hitsOwn = ([regex]::Matches($ownText, 'Stop-Process|taskkill|\.Kill\(')).Count
    $hitsAdp = ([regex]::Matches($adpText, 'Stop-Process|taskkill|\.Kill\(')).Count
    $ok = ($hitsOwn -eq 0) -and ($hitsAdp -eq 0)
    Record 'O-11' 'modules contain 0 real termination primitives (comments excluded)' $ok ("own=$hitsOwn adp=$hitsAdp")
} catch { Record 'O-11' 'modules contain 0 real termination primitives (comments excluded)' $false ("EXCEPTION: " + $_.Exception.Message) }

# ===========================================================================
# ADOPTION GATE FAULT MATRIX  (F-01 .. F-15)
# ===========================================================================
try {
    $a = Invoke-Adopt -Listen { param($x) return 0 }
    $ok = ($a.Verdict -eq 'UNKNOWN') -and ($a.Evidence.E1_listener.Ok -eq $false)
    Record 'F-01' 'E1 listener mismatch -> UNKNOWN' $ok ("verdict=$($a.Verdict) e1=$($a.Evidence.E1_listener.Ok)")
} catch { Record 'F-01' 'E1 listener mismatch -> UNKNOWN' $false ("EXCEPTION: " + $_.Exception.Message) }

try {
    $a = Invoke-Adopt -Info { param($x) [pscustomobject]@{ ProcessId = 90001; ParentProcessId = 1; CreationTimeUtc = $null; ExecutablePath = 'C:\SHIM\python.exe'; CommandLine = 'manage.py runserver 127.0.0.1:18199' } }
    $ok = ($a.Verdict -eq 'UNKNOWN') -and ($a.Evidence.E2_process.Ok -eq $false)
    Record 'F-02' 'E2 creation time unreadable -> UNKNOWN' $ok ("verdict=$($a.Verdict) e2=$($a.Evidence.E2_process.Ok)")
} catch { Record 'F-02' 'E2 creation time unreadable -> UNKNOWN' $false ("EXCEPTION: " + $_.Exception.Message) }

try {
    $a = Invoke-Adopt -Info { param($x) return $null }
    $ok = ($a.Verdict -eq 'UNKNOWN') -and ($a.Reasons -contains 'E3_commandline_unreadable')
    Record 'F-03' 'E3 unreadable (no process info) -> UNKNOWN' $ok ("verdict=$($a.Verdict) reason=E3_commandline_unreadable")
} catch { Record 'F-03' 'E3 unreadable (no process info) -> UNKNOWN' $false ("EXCEPTION: " + $_.Exception.Message) }

try {
    $a = Invoke-Adopt -Info { param($x) [pscustomobject]@{ ProcessId = 90001; ParentProcessId = 1; CreationTimeUtc = [datetime]::UtcNow; ExecutablePath = 'C:\SHIM\python.exe'; CommandLine = 'notepad.exe' } }
    $ok = ($a.Verdict -eq 'UNKNOWN') -and ($a.Evidence.E3_commandline.Ok -eq $false)
    Record 'F-04' 'E3 not django runserver -> UNKNOWN' $ok ("verdict=$($a.Verdict) e3=$($a.Evidence.E3_commandline.Ok)")
} catch { Record 'F-04' 'E3 not django runserver -> UNKNOWN' $false ("EXCEPTION: " + $_.Exception.Message) }

try {
    $a = Invoke-Adopt -Proj { param($x, $y) [pscustomobject]@{ ManagePyExists = $true; ManagePySha256 = 'sha'; SameCode = $false } }
    $ok = ($a.Verdict -eq 'UNKNOWN') -and ($a.Evidence.E4_project.ManagePyOk -eq $false)
    Record 'F-05' 'E4b manage.py identity mismatch -> UNKNOWN' $ok ("verdict=$($a.Verdict) e4b=$($a.Evidence.E4_project.ManagePyOk)")
} catch { Record 'F-05' 'E4b manage.py identity mismatch -> UNKNOWN' $false ("EXCEPTION: " + $_.Exception.Message) }

try {
    $a = Invoke-Adopt -Venv { param($x, $y) [pscustomobject]@{ ShimExists = $false; PyvenvCfgReadable = $true; HomeMatchesObserved = $true; VenvRoot = 'D:\iso_venv' } }
    $ok = ($a.Verdict -eq 'UNKNOWN') -and ($a.Evidence.E4_project.VenvOk -eq $false)
    Record 'F-06' 'E4a venv/pyvenv insufficient -> UNKNOWN' $ok ("verdict=$($a.Verdict) e4a=$($a.Evidence.E4_project.VenvOk)")
} catch { Record 'F-06' 'E4a venv/pyvenv insufficient -> UNKNOWN' $false ("EXCEPTION: " + $_.Exception.Message) }

try {
    $a = Invoke-Adopt -Info { param($x) [pscustomobject]@{ ProcessId = 90001; ParentProcessId = 1; CreationTimeUtc = [datetime]::UtcNow; ExecutablePath = 'C:\WRONG\python.exe'; CommandLine = 'manage.py runserver 127.0.0.1:18199' } }
    $ok = ($a.Verdict -eq 'UNKNOWN') -and ($a.Evidence.E5_interpreter.Ok -eq $false)
    Record 'F-07' 'E5 interpreter unproven -> UNKNOWN' $ok ("verdict=$($a.Verdict) e5=$($a.Evidence.E5_interpreter.Ok)")
} catch { Record 'F-07' 'E5 interpreter unproven -> UNKNOWN' $false ("EXCEPTION: " + $_.Exception.Message) }

try {
    $a = Invoke-Adopt -Listen { param($x) return 99999 }
    $ok = ($a.Verdict -eq 'UNKNOWN') -and ($a.Evidence.E6_listener_recheck.Ok -eq $false)
    Record 'F-08' 'E6 listener drift during evidence -> UNKNOWN' $ok ("verdict=$($a.Verdict) e6=$($a.Evidence.E6_listener_recheck.Ok)")
} catch { Record 'F-08' 'E6 listener drift during evidence -> UNKNOWN' $false ("EXCEPTION: " + $_.Exception.Message) }

try {
    $a = Invoke-Adopt -Health { param($u, $m) [pscustomobject]@{ Ok = $false; Status = 500; ContentLength = 100; Markers = @{}; AllMarkers = $true } }
    $ok = ($a.Verdict -eq 'UNKNOWN') -and ($a.Evidence.E7_health.Ok -eq $false)
    Record 'F-09' 'E7 health failed -> UNKNOWN' $ok ("verdict=$($a.Verdict) e7=$($a.Evidence.E7_health.Ok) status=$($a.Evidence.E7_health.Status)")
} catch { Record 'F-09' 'E7 health failed -> UNKNOWN' $false ("EXCEPTION: " + $_.Exception.Message) }

try {
    $a = Invoke-Adopt -Conf { param($x, $y, $z) [pscustomobject]@{ ConflictCount = 1; MutexCheckable = $true; MutexFree = $true } }
    $ok = ($a.Verdict -eq 'UNKNOWN') -and ([int]$a.Evidence.E8_launcher_conflict.ConflictCount -eq 1)
    Record 'F-10' 'E8 launcher process conflict -> UNKNOWN' $ok ("verdict=$($a.Verdict) conflicts=$($a.Evidence.E8_launcher_conflict.ConflictCount)")
} catch { Record 'F-10' 'E8 launcher process conflict -> UNKNOWN' $false ("EXCEPTION: " + $_.Exception.Message) }

try {
    $a = Invoke-Adopt -Conf { param($x, $y, $z) [pscustomobject]@{ ConflictCount = 0; MutexCheckable = $false; MutexFree = $false } }
    $ok = ($a.Verdict -eq 'UNKNOWN') -and ($a.Evidence.E8_launcher_conflict.MutexCheckable -eq $false)
    Record 'F-11' 'E8 mutex unverifiable -> UNKNOWN' $ok ("verdict=$($a.Verdict) checkable=$($a.Evidence.E8_launcher_conflict.MutexCheckable)")
} catch { Record 'F-11' 'E8 mutex unverifiable -> UNKNOWN' $false ("EXCEPTION: " + $_.Exception.Message) }

try {
    $a = Invoke-Adopt
    $ok = ($a.Verdict -eq 'ADOPTABLE')
    Record 'F-12' 'all evidence present -> ADOPTABLE' $ok ("verdict=$($a.Verdict) reasons=$($a.Reasons -join ',')")
} catch { Record 'F-12' 'all evidence present -> ADOPTABLE' $false ("EXCEPTION: " + $_.Exception.Message) }

try {
    $a = Invoke-Adopt
    $f = Join-Path $root 'f13.json'
    $claim = Invoke-V15CAdoptionClaim -Adoption $a -StateFile $f -Port 18199 -V15Root 'D:\iso_project'
    $pidRead = 0
    if (Test-Path $f) { $rec = Get-Content -LiteralPath $f -Raw | ConvertFrom-Json; $pidRead = [int]$rec.pid }
    $ok = [bool]$claim.Claimed -and ($pidRead -eq 90001)
    Record 'F-13' 'ADOPTABLE claim delegates to single writer (pid written)' $ok ("claimed=$($claim.Claimed) reason=$($claim.Reason) pid=$pidRead")
} catch { Record 'F-13' 'ADOPTABLE claim delegates to single writer (pid written)' $false ("EXCEPTION: " + $_.Exception.Message) }

try {
    $fake = [pscustomobject]@{ Verdict = 'UNKNOWN'; Pid = 90001; CreatedUtc = [datetime]::UtcNow }
    $claim = Invoke-V15CAdoptionClaim -Adoption $fake -StateFile (Join-Path $root 'f14.json') -Port 18199 -V15Root 'D:\iso_project'
    $ok = (-not [bool]$claim.Claimed) -and ($claim.Reason -eq 'adoption_not_eligible')
    Record 'F-14' 'non-ADOPTABLE claim rejected' $ok ("claimed=$($claim.Claimed) reason=$($claim.Reason)")
} catch { Record 'F-14' 'non-ADOPTABLE claim rejected' $false ("EXCEPTION: " + $_.Exception.Message) }

try {
    $fake = [pscustomobject]@{ Verdict = 'ADOPTABLE'; Pid = 90001; CreatedUtc = $null }
    $claim = Invoke-V15CAdoptionClaim -Adoption $fake -StateFile (Join-Path $root 'f15.json') -Port 18199 -V15Root 'D:\iso_project'
    $ok = (-not [bool]$claim.Claimed) -and ($claim.Reason -eq 'creation_time_unavailable')
    Record 'F-15' 'ADOPTABLE without creation time rejected' $ok ("claimed=$($claim.Claimed) reason=$($claim.Reason)")
} catch { Record 'F-15' 'ADOPTABLE without creation time rejected' $false ("EXCEPTION: " + $_.Exception.Message) }

# ===========================================================================
# PURE DECISION MAPPING  (D-01 .. D-06)
# ===========================================================================
try {
    $d = Resolve-V15CListenerAction -Verdict 'OWNED' -Reasons @('owned')
    $ok = ($d.Action -eq 'REUSE')
    Record 'D-01' 'OWNED -> REUSE' $ok ("action=$($d.Action) reason=$($d.Reason)")
} catch { Record 'D-01' 'OWNED -> REUSE' $false ("EXCEPTION: " + $_.Exception.Message) }

try {
    $a = Invoke-Adopt
    $d = Resolve-V15CListenerAction -Verdict 'UNKNOWN' -Reasons @('state_record_absent') -Adoption $a
    $ok = ($d.Action -eq 'ADOPT')
    Record 'D-02' 'UNKNOWN + state_absent + ADOPTABLE -> ADOPT' $ok ("action=$($d.Action) reason=$($d.Reason)")
} catch { Record 'D-02' 'UNKNOWN + state_absent + ADOPTABLE -> ADOPT' $false ("EXCEPTION: " + $_.Exception.Message) }

try {
    $bad = [pscustomobject]@{ Verdict = 'UNKNOWN' }
    $d = Resolve-V15CListenerAction -Verdict 'UNKNOWN' -Reasons @('state_record_absent') -Adoption $bad
    $ok = ($d.Action -eq 'ABORT') -and ($d.Reason -eq 'adoption_evidence_insufficient')
    Record 'D-03' 'UNKNOWN + state_absent + insufficient -> ABORT' $ok ("action=$($d.Action) reason=$($d.Reason)")
} catch { Record 'D-03' 'UNKNOWN + state_absent + insufficient -> ABORT' $false ("EXCEPTION: " + $_.Exception.Message) }

try {
    $d = Resolve-V15CListenerAction -Verdict 'UNKNOWN' -Reasons @('state_record_absent') -AdoptionEnabled $false
    $ok = ($d.Action -eq 'ABORT') -and ($d.Reason -eq 'adoption_disabled_state_absent')
    Record 'D-04' 'UNKNOWN + state_absent + adoption disabled -> ABORT' $ok ("action=$($d.Action) reason=$($d.Reason)")
} catch { Record 'D-04' 'UNKNOWN + state_absent + adoption disabled -> ABORT' $false ("EXCEPTION: " + $_.Exception.Message) }

try {
    $d = Resolve-V15CListenerAction -Verdict 'FOREIGN' -Reasons @('foreign_process')
    $ok = ($d.Action -eq 'ABORT') -and ($d.Reason -eq 'foreign_process')
    Record 'D-05' 'FOREIGN -> ABORT' $ok ("action=$($d.Action) reason=$($d.Reason)")
} catch { Record 'D-05' 'FOREIGN -> ABORT' $false ("EXCEPTION: " + $_.Exception.Message) }

try {
    $d = Resolve-V15CListenerAction -Verdict 'UNKNOWN' -Reasons @('E4c_http_project_fingerprint_missing')
    $ok = ($d.Action -eq 'ABORT') -and ($d.Reason -eq 'unknown_evidence')
    Record 'D-06' 'UNKNOWN without state_absent -> ABORT' $ok ("action=$($d.Action) reason=$($d.Reason)")
} catch { Record 'D-06' 'UNKNOWN without state_absent -> ABORT' $false ("EXCEPTION: " + $_.Exception.Message) }

# ---- summary ---------------------------------------------------------------
$pass = 0; $fail = 0
foreach ($r in $results) { if ($r.pass) { $pass++ } else { $fail++ } }
$total = $results.Count
$summary = [pscustomobject]@{
    suite   = 'P20-A-RECONSTRUCTED-REGRESSION'
    note    = 'Reconstructed fresh suite, NOT the original 84-item suite (unrecoverable).'
    total   = $total
    pass    = $pass
    fail    = $fail
    results = $results
}
$outJson = Join-Path $ModuleDir 'TEST_RESULTS_PHASE20_REGRESSION.json'
$outLog  = Join-Path $ModuleDir 'TEST_RESULTS_PHASE20_REGRESSION.log'
$summary | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $outJson -Encoding utf8
$results | ForEach-Object { "{0}`t{1}`t{2}`t{3}" -f $_.id, $_.pass, $_.name, $_.detail } | Set-Content -LiteralPath $outLog -Encoding utf8
Write-Host ("`nSUMMARY pass={0} fail={1} total={2}" -f $pass, $fail, $total)

# ---- cleanup temp dir (per-file, avoid recursive bulk delete) --------------
try {
    Get-ChildItem -LiteralPath $root -File -Force -ErrorAction SilentlyContinue | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $root -Force -ErrorAction SilentlyContinue
} catch { }

if ($fail -gt 0) { exit 1 } else { exit 0 }
