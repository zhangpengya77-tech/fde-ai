# P3-H Phase 18: controlled adoption of a pre-existing 8022 listener (scheme B).
#
# Purpose: when the launcher finds 8022 already served by a process it did not
# start in this run, and there is no PID state record yet, decide whether the
# listener may be ADOPTED (state record created from verified evidence) or must
# be left alone (UNKNOWN -> startup aborts, nothing is killed).
#
# Hard rules:
#   1. This module only READS. It never terminates, starts or restarts anything.
#   2. ADOPTABLE requires ALL eight evidence items. Any missing, contradictory or
#      unstable evidence yields UNKNOWN. A 200 health response, a python path or
#      a PID alone is never sufficient.
#   3. There is exactly ONE state-file writer in this code base:
#      Write-V15CStateRecord (V15C-Ownership.ps1, Phase 18). This module never
#      writes state itself; Invoke-V15CAdoptionClaim delegates to that writer so
#      the atomic-replace and single-owner rules cannot be bypassed.
#
# Depends on V15C-Ownership.ps1 and must be dot-sourced after it.
#
# ASCII-only on purpose: Windows PowerShell 5.1 misparses non-ASCII .ps1 files
# that have no BOM.

if (-not (Get-Command Get-V15CProcessInfo -ErrorAction SilentlyContinue)) {
    throw 'V15C-Adoption.ps1 requires V15C-Ownership.ps1 to be dot-sourced first.'
}
if (-not (Get-Command Write-V15CStateRecord -ErrorAction SilentlyContinue)) {
    throw 'V15C-Adoption.ps1 requires Write-V15CStateRecord from V15C-Ownership.ps1 (Phase 18).'
}

# ---------------------------------------------------------------------------
# Evidence helpers
# ---------------------------------------------------------------------------

function Get-V15CVenvEvidence {
    <#
      Resolves the interpreter topology: the configured DjangoPython (venv shim),
      its venv root, its pyvenv.cfg, and whether the recorded pyvenv home equals
      the interpreter actually observed as the listener (or its ancestor).
    #>
    param(
        [Parameter(Mandatory = $true)][string]$DjangoPython,
        [string]$ObservedInterpreter = ''
    )

    $shimFull = ''
    try { $shimFull = [System.IO.Path]::GetFullPath($DjangoPython) } catch { $shimFull = $DjangoPython }

    $shimExists = $false
    if ($shimFull) { $shimExists = Test-Path -LiteralPath $shimFull }

    $venvRoot = ''
    try {
        if ($shimFull) { $venvRoot = Split-Path -Parent (Split-Path -Parent $shimFull) }
    } catch { $venvRoot = '' }

    $cfgPath = ''
    if ($venvRoot) { $cfgPath = Join-Path $venvRoot 'pyvenv.cfg' }

    $cfgReadable = $false
    $pyvenvHome = ''
    if ($cfgPath -and (Test-Path -LiteralPath $cfgPath)) {
        try {
            foreach ($line in (Get-Content -LiteralPath $cfgPath -ErrorAction Stop)) {
                if ($line -match '^\s*home\s*=\s*(.+?)\s*$') { $pyvenvHome = $Matches[1]; break }
            }
            $cfgReadable = $true
        } catch {
            $cfgReadable = $false
        }
    }

    $homeMatches = $false
    if ($pyvenvHome -and $ObservedInterpreter) {
        $expectedBase = ''
        $observedBase = ''
        try { $expectedBase = [System.IO.Path]::GetFullPath((Join-Path $pyvenvHome 'python.exe')) } catch { $expectedBase = '' }
        try { $observedBase = [System.IO.Path]::GetFullPath($ObservedInterpreter) } catch { $observedBase = '' }
        if ($expectedBase -and $observedBase -and ($expectedBase -ieq $observedBase)) { $homeMatches = $true }
    }

    return [pscustomobject]@{
        ShimPath            = $shimFull
        ShimExists          = $shimExists
        VenvRoot            = $venvRoot
        PyvenvCfgPath       = $cfgPath
        PyvenvCfgReadable   = $cfgReadable
        Home                = $pyvenvHome
        HomeMatchesObserved = $homeMatches
        ObservedInterpreter = $ObservedInterpreter
    }
}

function Get-V15CProjectEvidence {
    <#
      Project identity evidence. Windows does not expose another process's current
      working directory, so the project is established by this chain:
        shim path -> venv root -> parent directory (project root used at build time)
        + $V15Root\manage.py
        + identical manage.py hash on both sides (same code base)
      The HTTP fingerprint is checked separately by the caller.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$V15Root,
        [string]$VenvRoot = ''
    )

    $managePy = ''
    if ($V15Root) { $managePy = Join-Path $V15Root 'manage.py' }
    $exists = $false
    $sha = ''
    if ($managePy -and (Test-Path -LiteralPath $managePy)) {
        $exists = $true
        try { $sha = (Get-FileHash -LiteralPath $managePy -Algorithm SHA256).Hash.ToLowerInvariant() } catch { $sha = '' }
    }

    $shimProjectRoot = ''
    $shimManagePy = ''
    $shimSha = ''
    if ($VenvRoot) {
        try { $shimProjectRoot = Split-Path -Parent $VenvRoot } catch { $shimProjectRoot = '' }
    }
    if ($shimProjectRoot) { $shimManagePy = Join-Path $shimProjectRoot 'manage.py' }
    if ($shimManagePy -and (Test-Path -LiteralPath $shimManagePy)) {
        try { $shimSha = (Get-FileHash -LiteralPath $shimManagePy -Algorithm SHA256).Hash.ToLowerInvariant() } catch { $shimSha = '' }
    }

    $sameCode = [bool]($sha -and $shimSha -and ($sha -eq $shimSha))

    return [pscustomobject]@{
        V15Root            = $V15Root
        ManagePyPath       = $managePy
        ManagePyExists     = $exists
        ManagePySha256     = $sha
        ShimProjectRoot    = $shimProjectRoot
        ShimManagePyExists = [bool]$shimSha
        ShimManagePySha256 = $shimSha
        SameCode           = $sameCode
    }
}

function Get-V15CHealthDetailed {
    <#
      One HTTP fetch used for both the status check (E7) and the project
      fingerprint (E4c), so the two signals never come from different responses.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [string[]]$Markers = @(),
        [int]$TimeoutSec = 6
    )

    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec -MaximumRedirection 5
        $status = [int]$r.StatusCode
        $content = [string]$r.Content
        $statusOk = ($status -ge 200 -and $status -lt 400)
        $hits = @{}
        $allMarkers = $true
        foreach ($m in $Markers) {
            $found = $content.IndexOf($m, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
            $hits[$m] = $found
            if (-not $found) { $allMarkers = $false }
        }
        return [pscustomobject]@{
            Ok            = $statusOk
            Status        = $status
            ContentLength = $content.Length
            Markers       = $hits
            AllMarkers    = $allMarkers
        }
    } catch {
        $status = 0
        if ($_.Exception.Response) {
            try { $status = [int]$_.Exception.Response.StatusCode } catch { $status = 0 }
        }
        return [pscustomobject]@{
            Ok            = $false
            Status        = $status
            ContentLength = 0
            Markers       = @{}
            AllMarkers    = $false
        }
    }
}

function Get-V15CAncestorPids {
    param([int]$StartPid, [int]$MaxDepth = 6)
    $ancestors = @()
    if ($StartPid -le 0) { return $ancestors }
    $cursor = $StartPid
    for ($d = 0; $d -lt $MaxDepth; $d++) {
        $info = Get-V15CProcessInfo -ProcessId $cursor
        if (-not $info) { break }
        if ([int]$info.ParentProcessId -le 0) { break }
        $ancestors += [int]$info.ParentProcessId
        $cursor = [int]$info.ParentProcessId
    }
    return $ancestors
}

function Get-V15CLauncherConflict {
    <#
      E8: proves no other launcher instance is running concurrently.
        - no powershell/pwsh process other than self/ancestors runs the launcher
        - the instance mutex can be acquired for zero wait
      Unverifiable mutex access is reported as such (caller treats it as UNKNOWN).
      An empty MutexName means the caller already holds the instance mutex.
    #>
    param(
        [string]$LauncherScriptName = 'start_fde_v15c_classroom.ps1',
        [string]$MutexName = 'Global\FDE-AI-v15C-Classroom-Startup',
        [int]$CurrentPid = 0
    )

    $ancestors = Get-V15CAncestorPids -StartPid $CurrentPid
    $conflicts = @()
    $shells = Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" -ErrorAction SilentlyContinue
    foreach ($p in $shells) {
        $otherPid = [int]$p.ProcessId
        if ($otherPid -eq $CurrentPid) { continue }
        if ($ancestors -contains $otherPid) { continue }
        $cmd = [string]$p.CommandLine
        if ($cmd -and ($cmd.IndexOf($LauncherScriptName, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)) {
            $conflicts += [pscustomobject]@{ ProcessId = $otherPid; CommandLine = $cmd }
        }
    }

    $mutexFree = $false
    $mutexCheckable = $false
    $mutexDetail = ''
    if ([string]::IsNullOrWhiteSpace($MutexName)) {
        $mutexFree = $true
        $mutexCheckable = $true
        $mutexDetail = 'skipped_caller_holds_mutex'
    } else {
        try {
            $mutex = New-Object System.Threading.Mutex($false, $MutexName)
            try {
                if ($mutex.WaitOne(0)) {
                    $mutexFree = $true
                    $mutexDetail = 'acquired'
                    [void]$mutex.ReleaseMutex()
                } else {
                    $mutexFree = $false
                    $mutexDetail = 'held_by_other'
                }
                $mutexCheckable = $true
            } catch [System.Threading.AbandonedMutexException] {
                $mutexFree = $true
                $mutexCheckable = $true
                $mutexDetail = 'abandoned_treated_free'
            } finally {
                try { $mutex.Dispose() } catch { }
            }
        } catch {
            $mutexCheckable = $false
            $mutexDetail = 'unverifiable:' + $_.Exception.GetType().Name
        }
    }

    return [pscustomobject]@{
        LauncherScriptName   = $LauncherScriptName
        MutexName            = $MutexName
        ConflictingProcesses = $conflicts
        ConflictCount        = $conflicts.Count
        MutexFree            = $mutexFree
        MutexCheckable       = $mutexCheckable
        MutexDetail          = $mutexDetail
    }
}

# ---------------------------------------------------------------------------
# E1..E8 adoption gate
# ---------------------------------------------------------------------------

function Test-V15CAdoptionEligible {
    <#
      Controlled adoption gate. Returns
        @{ Verdict='ADOPTABLE'|'UNKNOWN'; Reasons=[string[]]; Evidence=@{...}; Pid; CreatedUtc; Mode }
      ADOPTABLE requires every one of E1..E8. Never terminates anything.
        E1 listener identity on the port
        E2 process exists, creation time readable
        E3 command line = manage.py runserver + 127.0.0.1:<port>
        E4 project identity: venv/pyvenv + manage.py hash equality + HTTP fingerprint
        E5 interpreter relationship: self == shim (copy venv) or ancestor == shim (trampoline)
        E6 listener identity re-checked after evidence collection (no PID drift)
        E7 dedicated health check: 2xx/3xx
        E8 no other launcher instance (process scan + instance mutex)
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][int]$ListenerPid,
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][string]$V15Root,
        [Parameter(Mandatory = $true)][string]$DjangoPython,
        [Parameter(Mandatory = $true)][string]$HealthUrl,
        [string[]]$HealthMarkers = @('FDE-AI', 'csrfmiddlewaretoken'),
        [string]$MutexName = 'Global\FDE-AI-v15C-Classroom-Startup',
        [string]$LauncherScriptName = 'start_fde_v15c_classroom.ps1',
        [int]$CurrentPid = 0,
        [scriptblock]$ProcessInfoProvider = $null,
        [scriptblock]$ListenerPidProvider = $null,
        [scriptblock]$HealthProvider = $null,
        [scriptblock]$VenvEvidenceProvider = $null,
        [scriptblock]$ProjectEvidenceProvider = $null,
        [scriptblock]$ConflictProvider = $null
    )

    $reasons = New-Object System.Collections.Generic.List[string]
    $evidence = [ordered]@{}
    $allOk = $true

    $getInfo = if ($ProcessInfoProvider) { $ProcessInfoProvider } else { ${function:Get-V15CProcessInfo} }
    $getListener = if ($ListenerPidProvider) { $ListenerPidProvider } else { ${function:Get-V15CListenerPid} }

    # ---- E1 listener identity -------------------------------------------------
    $actualListener = & $getListener $Port
    $e1 = ([int]$actualListener -eq [int]$ListenerPid) -and ([int]$actualListener -gt 0)
    $evidence['E1_listener'] = [pscustomobject]@{ Ok = $e1; Expected = $ListenerPid; Actual = [int]$actualListener }
    if ($e1) { $reasons.Add('E1_listener_ok') } else { $reasons.Add('E1_listener_mismatch'); $allOk = $false }

    # ---- E2 process exists / creation time ------------------------------------
    $info = & $getInfo $ListenerPid
    $e2 = [bool]($info -and $info.CreationTimeUtc)
    $evidence['E2_process'] = [pscustomobject]@{
        Ok              = $e2
        ProcessId       = $ListenerPid
        ParentProcessId = if ($info) { [int]$info.ParentProcessId } else { 0 }
        CreatedUtc      = if ($info -and $info.CreationTimeUtc) { $info.CreationTimeUtc.ToString('o') } else { '' }
    }
    if ($e2) { $reasons.Add('E2_creation_time_ok') } else { $reasons.Add('E2_process_or_creation_unreadable'); $allOk = $false }

    if (-not $info) {
        $evidence['E3_commandline'] = [pscustomobject]@{ Ok = $false; CommandLine = '' }
        $reasons.Add('E3_commandline_unreadable')
        return [pscustomobject]@{ Verdict = 'UNKNOWN'; Reasons = $reasons; Evidence = $evidence; Pid = $ListenerPid; CreatedUtc = $null; Mode = '' }
    }

    # ---- E3 command line ------------------------------------------------------
    $cmd = [string]$info.CommandLine
    $e3 = $false
    if ([string]::IsNullOrWhiteSpace($cmd)) {
        $reasons.Add('E3_commandline_unreadable')
    } else {
        $e3 = ($cmd -match 'manage\.py\s+runserver\b') -and ($cmd -match ('127\.0\.0\.1:' + [int]$Port))
        if ($e3) { $reasons.Add('E3_commandline_ok') } else { $reasons.Add('E3_commandline_not_django_runserver_on_port') }
    }
    $evidence['E3_commandline'] = [pscustomobject]@{ Ok = $e3; CommandLine = $cmd }
    if (-not $e3) { $allOk = $false }

    # ---- E5 interpreter relationship (needed before E4a semantics) ------------
    $expectedPython = ''
    try { $expectedPython = [System.IO.Path]::GetFullPath($DjangoPython) } catch { $expectedPython = $DjangoPython }
    $mode = ''
    $observedInterpreter = ''
    $selfExe = ''
    try { if ($info.ExecutablePath) { $selfExe = [System.IO.Path]::GetFullPath($info.ExecutablePath) } } catch { $selfExe = '' }
    if ($selfExe -and ($selfExe -ieq $expectedPython)) {
        $mode = 'self'
        $observedInterpreter = $selfExe
    } else {
        $cursor = $info
        for ($depth = 1; $depth -le 3; $depth++) {
            if (-not $cursor -or [int]$cursor.ParentProcessId -le 0) { break }
            $parent = & $getInfo ([int]$cursor.ParentProcessId)
            if (-not $parent) { break }
            $pex = ''
            try { if ($parent.ExecutablePath) { $pex = [System.IO.Path]::GetFullPath($parent.ExecutablePath) } } catch { $pex = '' }
            if ($pex -and ($pex -ieq $expectedPython)) {
                $mode = 'ancestor'
                $observedInterpreter = $selfExe
                $reasons.Add("E5_ancestor_matches_shim depth=$depth")
                break
            }
            $cursor = $parent
        }
    }
    $e5 = [bool]$mode
    if ($e5 -and $mode -eq 'self') { $reasons.Add('E5_self_is_shim') }
    if (-not $e5) { $reasons.Add('E5_no_self_or_ancestor_matches_shim'); $allOk = $false }
    $evidence['E5_interpreter'] = [pscustomobject]@{
        Ok                  = $e5
        Mode                = $mode
        ShimPath            = $expectedPython
        ListenerExe         = $selfExe
        ObservedInterpreter = $observedInterpreter
    }

    # ---- E4 project identity --------------------------------------------------
    $getVenv = if ($VenvEvidenceProvider) { $VenvEvidenceProvider } else { ${function:Get-V15CVenvEvidence} }
    $venv = & $getVenv $DjangoPython $observedInterpreter

    $getProject = if ($ProjectEvidenceProvider) { $ProjectEvidenceProvider } else { ${function:Get-V15CProjectEvidence} }
    $project = & $getProject $V15Root $venv.VenvRoot

    $getHealth = if ($HealthProvider) { $HealthProvider } else { ${function:Get-V15CHealthDetailed} }
    $health = & $getHealth $HealthUrl $HealthMarkers

    $e4a = $false
    if ($venv.ShimExists -and $venv.PyvenvCfgReadable) {
        if ($mode -eq 'self') { $e4a = $true }
        elseif ($mode -eq 'ancestor') { $e4a = [bool]$venv.HomeMatchesObserved }
    }
    $e4b = [bool]($project.ManagePyExists -and $project.ManagePySha256 -and $project.SameCode)
    $e4c = [bool]$health.AllMarkers
    $e4 = ($e4a -and $e4b -and $e4c)

    if ($e4a) { $reasons.Add('E4a_venv_pyvenv_ok') } else { $reasons.Add('E4a_venv_pyvenv_insufficient') }
    if ($e4b) { $reasons.Add('E4b_manage_py_identity_ok') } else { $reasons.Add('E4b_manage_py_identity_insufficient') }
    if ($e4c) { $reasons.Add('E4c_http_project_fingerprint_ok') } else { $reasons.Add('E4c_http_project_fingerprint_missing') }
    if (-not $e4) { $allOk = $false }

    $evidence['E4_project'] = [pscustomobject]@{
        Ok            = $e4
        VenvOk        = $e4a
        ManagePyOk    = $e4b
        FingerprintOk = $e4c
        Venv          = $venv
        Project       = $project
        Markers       = $health.Markers
    }

    # ---- E7 dedicated health check -------------------------------------------
    $e7 = [bool]$health.Ok
    if ($e7) { $reasons.Add("E7_health_ok status=$($health.Status)") } else { $reasons.Add("E7_health_failed status=$($health.Status)"); $allOk = $false }
    $evidence['E7_health'] = [pscustomobject]@{ Ok = $e7; Status = $health.Status; ContentLength = $health.ContentLength }

    # ---- E6 listener identity re-check (no PID drift during evidence) --------
    $recheck = & $getListener $Port
    $e6 = ([int]$recheck -eq [int]$ListenerPid) -and ([int]$recheck -gt 0)
    if ($e6) { $reasons.Add('E6_listener_stable') } else { $reasons.Add('E6_listener_changed_during_evidence'); $allOk = $false }
    $evidence['E6_listener_recheck'] = [pscustomobject]@{ Ok = $e6; Expected = $ListenerPid; Actual = [int]$recheck }

    # ---- E8 no other launcher instance ---------------------------------------
    $getConflict = if ($ConflictProvider) { $ConflictProvider } else { ${function:Get-V15CLauncherConflict} }
    $conflict = & $getConflict $LauncherScriptName $MutexName $CurrentPid
    $e8 = ([int]$conflict.ConflictCount -eq 0) -and $conflict.MutexCheckable -and $conflict.MutexFree
    if ($e8) { $reasons.Add('E8_no_launcher_conflict') }
    elseif (-not $conflict.MutexCheckable) { $reasons.Add('E8_mutex_unverifiable') }
    elseif ([int]$conflict.ConflictCount -gt 0) { $reasons.Add('E8_launcher_process_conflict') }
    else { $reasons.Add('E8_mutex_held_by_other') }
    if (-not $e8) { $allOk = $false }
    $evidence['E8_launcher_conflict'] = $conflict

    $verdict = 'UNKNOWN'
    if ($allOk) { $verdict = 'ADOPTABLE' }

    return [pscustomobject]@{
        Verdict    = $verdict
        Reasons    = $reasons
        Evidence   = $evidence
        Pid        = $ListenerPid
        CreatedUtc = if ($info -and $info.CreationTimeUtc) { $info.CreationTimeUtc } else { $null }
        Mode       = $mode
    }
}

# ---------------------------------------------------------------------------
# Decision (pure, side-effect free) + claim (delegates to the single writer)
# ---------------------------------------------------------------------------

function Resolve-V15CListenerAction {
    <#
      Pure decision function: maps verdict + adoption result to an action.
        REUSE  -> listener is ours, leave it running
        ADOPT  -> claim a PID state record from verified evidence, leave it running
        ABORT  -> log and stop the startup flow; never kill
      Adoption is only considered when the ONLY reason the verdict is not OWNED
      is a missing state record. A corrupt or mismatching record is never
      silently replaced.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$Verdict,
        [string[]]$Reasons = @(),
        $Adoption = $null,
        [bool]$AdoptionEnabled = $true
    )

    if ($Verdict -eq 'OWNED') {
        return [pscustomobject]@{ Action = 'REUSE'; Reason = 'owned' }
    }

    $stateAbsent = ($Reasons -contains 'state_record_absent')

    if ($stateAbsent -and $AdoptionEnabled) {
        if ($Adoption -and ($Adoption.Verdict -eq 'ADOPTABLE')) {
            return [pscustomobject]@{ Action = 'ADOPT'; Reason = 'adopted_by_full_evidence' }
        }
        return [pscustomobject]@{ Action = 'ABORT'; Reason = 'adoption_evidence_insufficient' }
    }

    if ($stateAbsent -and (-not $AdoptionEnabled)) {
        return [pscustomobject]@{ Action = 'ABORT'; Reason = 'adoption_disabled_state_absent' }
    }

    if ($Verdict -eq 'FOREIGN') {
        return [pscustomobject]@{ Action = 'ABORT'; Reason = 'foreign_process' }
    }

    return [pscustomobject]@{ Action = 'ABORT'; Reason = 'unknown_evidence' }
}

function Invoke-V15CAdoptionClaim {
    <#
      Claims the PID state record for an adopted listener by delegating to the
      single writer Write-V15CStateRecord. Never writes the file directly, so the
      atomic-replace and single-owner rules always apply.
      Output: @{ Claimed; Reason; State }
      Reasons: adoption_not_eligible | creation_time_unavailable | <writer reasons>
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Adoption,
        [Parameter(Mandatory = $true)][string]$StateFile,
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][string]$V15Root
    )

    if (-not $Adoption -or $Adoption.Verdict -ne 'ADOPTABLE') {
        return [pscustomobject]@{ Claimed = $false; Reason = 'adoption_not_eligible'; State = $null }
    }

    $createdUtc = ''
    if ($Adoption.CreatedUtc) {
        try { $createdUtc = ([datetime]$Adoption.CreatedUtc).ToUniversalTime().ToString('o') } catch { $createdUtc = '' }
    }
    if (-not $createdUtc) {
        return [pscustomobject]@{ Claimed = $false; Reason = 'creation_time_unavailable'; State = $null }
    }

    $claim = Write-V15CStateRecord -StateFile $StateFile -ProcessId ([int]$Adoption.Pid) -Port $Port -V15Root $V15Root -CreatedAtUtc $createdUtc
    return [pscustomobject]@{
        Claimed = [bool]$claim.Written
        Reason  = [string]$claim.Reason
        State   = $claim
    }
}
