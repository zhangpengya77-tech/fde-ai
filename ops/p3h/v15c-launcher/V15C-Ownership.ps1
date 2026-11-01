# P3-H Phase 17: v1.5C 8022 process-ownership judgment (single source of truth).
# P3-H Phase 18: added S7 project-root hint and the atomic single-owner state writer.
#
# Dot-sourced by start_fde_v15c_classroom.patched.ps1 and by the contract tests,
# so tests exercise the exact same logic as the launcher.
#
# Design:
#   - This module only READS process state; it never calls Stop-Process.
#     The caller decides: OWNED is never stopped; FOREIGN/UNKNOWN are never
#     auto-killed either (the launcher stops its startup flow and logs a conflict
#     for manual handling).
#   - Ownership is never decided by "venv shim path equality" alone. It combines
#     listener identity, command line, project-root hint, interpreter (self or
#     ancestor), the PID state record, and a dedicated health check.
#   - If the command line / executable cannot be read, the verdict is UNKNOWN
#     (never kill merely because the information is unreadable).
#   - The PID state record is only ever replaced atomically, under a named mutex,
#     and only when the current owner is not a different live process.
#
# ASCII-only on purpose: Windows PowerShell 5.1 misparses non-ASCII .ps1 files
# without a BOM. Keeping this file ASCII avoids that entire class of failure.

function Get-V15CProcessInfo {
    param([int]$ProcessId)
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
    if (-not $p) { return $null }
    $created = $null
    if ($p.CreationDate) {
        try { $created = ([datetime]$p.CreationDate).ToUniversalTime() } catch { $created = $null }
    }
    return [pscustomobject]@{
        ProcessId       = [int]$p.ProcessId
        ParentProcessId = if ($p.ParentProcessId) { [int]$p.ParentProcessId } else { 0 }
        ExecutablePath  = [string]$p.ExecutablePath
        CommandLine     = [string]$p.CommandLine
        CreationTimeUtc = $created
    }
}

function Get-V15CListenerPid {
    param([int]$Port)
    $c = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $c) { return 0 }
    return [int]$c.OwningProcess
}

function Test-V15CHealth {
    param([string]$Url, [string]$Marker, [int]$TimeoutSec = 5)
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec -MaximumRedirection 5
        $statusOk = ([int]$r.StatusCode -ge 200 -and [int]$r.StatusCode -lt 400)
        $markerOk = if ([string]::IsNullOrEmpty($Marker)) { $true } else { ([string]$r.Content).Contains($Marker) }
        return [pscustomobject]@{ Ok = ($statusOk -and $markerOk); Status = [int]$r.StatusCode; MarkerOk = $markerOk }
    } catch {
        $status = 0
        if ($_.Exception.Response) { try { $status = [int]$_.Exception.Response.StatusCode } catch { $status = 0 } }
        return [pscustomobject]@{ Ok = $false; Status = $status; MarkerOk = $false }
    }
}

function Test-IsV15CDjango {
    <#
      Determines whether the process currently listening on a port really belongs
      to the v1.5C Django service.
      Output: [pscustomobject]@{ Verdict='OWNED'|'FOREIGN'|'UNKNOWN'; Reasons=[string[]]; Pid; CreatedUtc }
      Signals:
        S1 listener identity: current port owner must equal ListenerPid.
        S2 process exists and creation time is readable.
        S3 command line readable and matches `manage.py runserver` + `127.0.0.1:<port>`.
        S7 project-root hint: when the command line carries an absolute manage.py
           path, its directory must equal V15Root; a mismatch is FOREIGN. A bare
           `manage.py` (the production shape) is neutral and never downgrades.
        S4 interpreter identity: listener exe, or an ancestor (depth 3), equals DjangoPython.
        S5 PID state record: StateFile exists, pid matches, created_at within 2s.
        S6 dedicated health check: HealthUrl (when supplied) returns 2xx/3xx and contains HealthMarker.
      FOREIGN only when the command line is readable and is clearly NOT this port's Django runserver.
      Everything else (unreadable/contradictory) is UNKNOWN. This function never kills anything.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][int]$ListenerPid,
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][string]$V15Root,
        [Parameter(Mandatory = $true)][string]$DjangoPython,
        [string]$StateFile = '',
        [string]$HealthUrl = '',
        [string]$HealthMarker = '',
        [scriptblock]$ProcessInfoProvider = $null,
        [scriptblock]$ListenerPidProvider = $null,
        [scriptblock]$HealthProvider = $null
    )

    $reasons = New-Object System.Collections.Generic.List[string]
    $getInfo = if ($ProcessInfoProvider) { $ProcessInfoProvider } else { ${function:Get-V15CProcessInfo} }
    $getListener = if ($ListenerPidProvider) { $ListenerPidProvider } else { ${function:Get-V15CListenerPid} }

    # S1: listener identity
    $actualListener = & $getListener $Port
    if (-not $actualListener) {
        $reasons.Add('no_listener_on_port')
        return [pscustomobject]@{ Verdict = 'UNKNOWN'; Reasons = $reasons; Pid = $ListenerPid; CreatedUtc = $null }
    }
    if ([int]$actualListener -ne [int]$ListenerPid) {
        $reasons.Add("listener_pid_changed expected=$ListenerPid actual=$actualListener")
        return [pscustomobject]@{ Verdict = 'UNKNOWN'; Reasons = $reasons; Pid = $ListenerPid; CreatedUtc = $null }
    }
    $reasons.Add('listener_pid_matches')

    # S2/S3: process info and command line
    $info = & $getInfo $ListenerPid
    if (-not $info) {
        $reasons.Add('process_not_found')
        return [pscustomobject]@{ Verdict = 'UNKNOWN'; Reasons = $reasons; Pid = $ListenerPid; CreatedUtc = $null }
    }
    if ([string]::IsNullOrWhiteSpace($info.CommandLine)) {
        $reasons.Add('command_line_unreadable')
        return [pscustomobject]@{ Verdict = 'UNKNOWN'; Reasons = $reasons; Pid = $ListenerPid; CreatedUtc = $info.CreationTimeUtc }
    }

    $cmd = [string]$info.CommandLine
    $isDjangoRunserver = ($cmd -match 'manage\.py\s+runserver\b') -and ($cmd -match ('127\.0\.0\.1:' + [int]$Port))
    if (-not $isDjangoRunserver) {
        $reasons.Add('command_line_not_django_runserver_on_port')
        return [pscustomobject]@{ Verdict = 'FOREIGN'; Reasons = $reasons; Pid = $ListenerPid; CreatedUtc = $info.CreationTimeUtc }
    }
    $reasons.Add('command_line_is_django_runserver')

    # S7 (Phase 18): project-root hint. The production launcher starts Django with a
    # BARE `manage.py`, so the root is NOT in the command line; absence must stay
    # neutral (otherwise every real startup would be downgraded). When the command
    # line DOES carry an absolute manage.py path, it must live directly under
    # V15Root - that is positive evidence of a different project occupying the port.
    # S7 can only strengthen FOREIGN; it never turns a non-OWNED verdict into OWNED.
    if ($V15Root) {
        $rootMatch = [regex]::Match($cmd, '"?([A-Za-z]:\\[^"]*\\manage\.py)"?', 'IgnoreCase')
        if ($rootMatch.Success) {
            $cmdRoot = ''
            try { $cmdRoot = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($rootMatch.Groups[1].Value)) } catch { $cmdRoot = '' }
            $expectedRoot = ''
            try { $expectedRoot = [System.IO.Path]::GetFullPath($V15Root) } catch { $expectedRoot = $V15Root }
            if ($cmdRoot -and $expectedRoot -and ($cmdRoot.TrimEnd('\') -ieq $expectedRoot.TrimEnd('\'))) {
                $reasons.Add('root_hint_matches')
            } else {
                $reasons.Add("root_hint_mismatch cmd_root=$cmdRoot expected=$expectedRoot")
                return [pscustomobject]@{ Verdict = 'FOREIGN'; Reasons = $reasons; Pid = $ListenerPid; CreatedUtc = $info.CreationTimeUtc }
            }
        } else {
            $reasons.Add('root_hint_absent')
        }
    }

    # S4: interpreter identity (self or ancestor equals DjangoPython)
    $expectedPython = ''
    try { $expectedPython = [System.IO.Path]::GetFullPath($DjangoPython) } catch { $expectedPython = $DjangoPython }
    $interpreterOwned = $false
    $selfExe = ''
    try { if ($info.ExecutablePath) { $selfExe = [System.IO.Path]::GetFullPath($info.ExecutablePath) } } catch { $selfExe = '' }
    if ($selfExe -and ($selfExe -ieq $expectedPython)) {
        $interpreterOwned = $true
        $reasons.Add('listener_exe_is_django_python')
    } else {
        $cursor = $info
        for ($depth = 1; $depth -le 3; $depth++) {
            if (-not $cursor -or [int]$cursor.ParentProcessId -le 0) { break }
            $parent = & $getInfo ([int]$cursor.ParentProcessId)
            if (-not $parent) { break }
            $pex = ''
            try { if ($parent.ExecutablePath) { $pex = [System.IO.Path]::GetFullPath($parent.ExecutablePath) } } catch { $pex = '' }
            if ($pex -and ($pex -ieq $expectedPython)) {
                $interpreterOwned = $true
                $reasons.Add("ancestor_exe_is_django_python depth=$depth")
                break
            }
            $cursor = $parent
        }
        if (-not $interpreterOwned) { $reasons.Add('no_self_or_ancestor_matches_django_python') }
    }

    # S5: PID state record
    $stateStatus = 'absent'
    if ($StateFile -and (Test-Path -LiteralPath $StateFile)) {
        try {
            $st = Get-Content -Raw -LiteralPath $StateFile | ConvertFrom-Json
            if ($st -and $st.pid -and ([int]$st.pid -eq [int]$ListenerPid) -and $st.created_at) {
                try {
                    $stCreated = [datetime]::Parse([string]$st.created_at).ToUniversalTime()
                    if ($info.CreationTimeUtc -and [math]::Abs(($info.CreationTimeUtc - $stCreated).TotalSeconds) -lt 2) {
                        $stateStatus = 'match'
                        $reasons.Add('state_record_matches')
                    } else {
                        $stateStatus = 'mismatch'
                        $reasons.Add('state_created_at_mismatch')
                    }
                } catch {
                    $stateStatus = 'corrupt'
                    $reasons.Add('state_created_at_unparseable')
                }
            } else {
                $stateStatus = 'mismatch'
                $reasons.Add('state_pid_mismatch')
            }
        } catch {
            $stateStatus = 'corrupt'
            $reasons.Add('state_unreadable_or_corrupt')
        }
    } else {
        $reasons.Add('state_record_absent')
    }

    # S6: dedicated health check (required for OWNED only when HealthUrl is supplied)
    $healthOk = $true
    if ($HealthUrl) {
        $getHealth = if ($HealthProvider) { $HealthProvider } else { ${function:Test-V15CHealth} }
        $h = & $getHealth $HealthUrl $HealthMarker
        $healthOk = [bool]$h.Ok
        if ($healthOk) { $reasons.Add("health_ok status=$($h.Status)") }
        else { $reasons.Add("health_failed status=$($h.Status)") }
    }

    # Decision
    if ($interpreterOwned -and $stateStatus -eq 'match' -and $healthOk) {
        $verdict = 'OWNED'
    } elseif ($interpreterOwned -and $stateStatus -eq 'match' -and -not $healthOk) {
        $verdict = 'UNKNOWN'
        $reasons.Add('unknown: health_failed_despite_process_evidence')
    } elseif ($interpreterOwned -and $stateStatus -ne 'match') {
        $verdict = 'UNKNOWN'
        $reasons.Add("unknown: state_$stateStatus")
    } elseif (-not $interpreterOwned -and $stateStatus -eq 'match') {
        $verdict = 'UNKNOWN'
        $reasons.Add('unknown: state_matches_but_interpreter_unproven')
    } else {
        $verdict = 'UNKNOWN'
        $reasons.Add('unknown: insufficient_evidence')
    }

    return [pscustomobject]@{ Verdict = $verdict; Reasons = $reasons; Pid = $ListenerPid; CreatedUtc = $info.CreationTimeUtc }
}

# ---------------------------------------------------------------------------
# Phase 18: PID state record (atomic, single-owner claim).
#
# Why this exists:
#   Phase 17 wrote the record with `ConvertTo-Json | Set-Content`, which truncates
#   the destination in place. A reader (or a crash) in the middle of that write can
#   observe an empty or half-written JSON file, and a second launcher could simply
#   overwrite the record of the process it did not start.
#
# Policy (mirrors the R-1 ownership rules):
#   - A record may only be replaced when it is missing, when it belongs to the same
#     pid, or when its pid is no longer alive (or -AllowOverwrite is given for an
#     explicit, human-approved takeover).
#   - A corrupt record is NEVER overwritten silently; the caller must resolve it.
#   - Writers serialise on a named mutex; the replacement is an atomic rename, so
#     a concurrent reader sees either the old record or the new one, never a partial.
#   - This function never terminates any process.
# ---------------------------------------------------------------------------

function Read-V15CStateRecord {
    <# Returns @{ Exists; Ok; Record }. Ok=$false means "present but unusable".
       Reads are retried: Windows PowerShell 5.1 Get-Content -Raw can return $null
       while the file is being replaced, which must not be reported as corruption. #>
    param([string]$StateFile)
    if (-not $StateFile -or -not (Test-Path -LiteralPath $StateFile)) {
        return [pscustomobject]@{ Exists = $false; Ok = $false; Record = $null }
    }
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            $raw = Get-Content -Raw -LiteralPath $StateFile
            if (-not [string]::IsNullOrWhiteSpace($raw)) {
                $obj = $raw | ConvertFrom-Json
                if ($obj -and $obj.pid) {
                    return [pscustomobject]@{ Exists = $true; Ok = $true; Record = $obj }
                }
                # Parsed but no pid: genuinely unusable, do not retry.
                return [pscustomobject]@{ Exists = $true; Ok = $false; Record = $null }
            }
        } catch {
            # Unparseable or briefly locked; retry a couple of times.
        }
        if ($attempt -lt 3) { Start-Sleep -Milliseconds 20 }
    }
    return [pscustomobject]@{ Exists = $true; Ok = $false; Record = $null }
}

function Test-V15CProcessAlive {
    param([int]$ProcessId)
    if ($ProcessId -le 0) { return $false }
    return [bool](Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Write-V15CStateRecord {
    <#
      Writes the PID state record atomically and only if this caller may own it.
      Output: @{ Written; Reason; Path; Pid; ExistingPid }
      Reasons: written | mutex_timeout | existing_state_corrupt |
               existing_owner_alive | replace_failed | verify_failed
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$StateFile,
        # Named ProcessId, not Pid: $PID is a read-only automatic variable and a
        # parameter called -Pid cannot be bound on Windows PowerShell 5.1.
        [Parameter(Mandatory = $true)][int]$ProcessId,
        [Parameter(Mandatory = $true)][int]$Port,
        [string]$V15Root = '',
        [string]$CreatedAtUtc = '',
        [int]$MutexTimeoutMs = 5000,
        [switch]$AllowOverwrite,
        [string]$MutexName = 'Local\FDE-AI-v15C-PidState'
    )

    $result = [pscustomobject]@{
        Written     = $false
        Reason      = ''
        Path        = $StateFile
        Pid         = [int]$ProcessId
        ExistingPid = 0
    }

    $dir = ''
    try { $dir = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($StateFile)) } catch { $dir = '' }
    if ($dir -and -not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }

    $mutex = $null
    $acquired = $false
    try {
        $mutex = New-Object System.Threading.Mutex($false, $MutexName)
        try {
            $acquired = $mutex.WaitOne($MutexTimeoutMs)
        } catch [System.Threading.AbandonedMutexException] {
            # The previous owner died while holding the mutex; we own it now.
            $acquired = $true
        } catch {
            $acquired = $false
        }
        if (-not $acquired) {
            $result.Reason = 'mutex_timeout'
            return $result
        }

        $existing = Read-V15CStateRecord -StateFile $StateFile
        if ($existing.Exists) {
            if (-not $existing.Ok) {
                # Corrupt state is a conflict, not a licence to rewrite ownership.
                $result.Reason = 'existing_state_corrupt'
                return $result
            }
            $existingPid = 0
            try { $existingPid = [int]$existing.Record.pid } catch { $existingPid = 0 }
            $result.ExistingPid = $existingPid
            if (($existingPid -ne [int]$ProcessId) -and (-not $AllowOverwrite) -and (Test-V15CProcessAlive $existingPid)) {
                # Another live process already owns the record: never overwrite it.
                $result.Reason = 'existing_owner_alive'
                return $result
            }
        }

        $payload = [pscustomobject]@{
            pid        = [int]$ProcessId
            created_at = [string]$CreatedAtUtc
            port       = [int]$Port
            v15_root   = [string]$V15Root
        }
        $json = $payload | ConvertTo-Json -Depth 4
        $tmpPath = ('{0}.tmp.{1}' -f $StateFile, [guid]::NewGuid().ToString('N'))
        $utf8 = New-Object System.Text.UTF8Encoding($false)

        $fs = $null
        try {
            $fs = New-Object System.IO.FileStream($tmpPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
            $bytes = $utf8.GetBytes($json)
            $fs.Write($bytes, 0, $bytes.Length)
            $fs.Flush($true)
        } finally {
            if ($fs) { $fs.Dispose() }
        }

        # Atomic rename-replace. A concurrent reader that opened the destination
        # with FileShare.Read (Get-Content does) makes ReplaceFile fail with a
        # sharing violation, so retry briefly. Never fall back to delete+move:
        # that window is exactly what atomic replacement exists to avoid. If the
        # retries are exhausted the write is refused and the next 5-minute cycle
        # retries - the previous record stays intact.
        $replaced = $false
        $lastError = ''
        for ($attempt = 1; $attempt -le 40 -and -not $replaced; $attempt++) {
            try {
                if (Test-Path -LiteralPath $StateFile) {
                    # [NullString]::Value, not $null: PowerShell would bind $null to
                    # "" and .NET rejects an empty backup path ("not of a legal form").
                    [System.IO.File]::Replace($tmpPath, $StateFile, [NullString]::Value)
                } else {
                    [System.IO.File]::Move($tmpPath, $StateFile)
                }
                $replaced = $true
            } catch {
                $lastError = $_.Exception.Message
                Start-Sleep -Milliseconds 15
            }
        }
        if (-not $replaced) {
            if (Test-Path -LiteralPath $tmpPath) { Remove-Item -LiteralPath $tmpPath -Force -ErrorAction SilentlyContinue }
            $result.Reason = 'replace_failed'
            $result | Add-Member -NotePropertyName Detail -NotePropertyValue $lastError -Force
            return $result
        }

        $verify = Read-V15CStateRecord -StateFile $StateFile
        if (-not ($verify.Exists -and $verify.Ok) -or ([int]$verify.Record.pid -ne [int]$ProcessId)) {
            $result.Reason = 'verify_failed'
            return $result
        }

        $result.Written = $true
        $result.Reason = 'written'
        return $result
    } finally {
        if ($mutex) {
            if ($acquired) { try { $mutex.ReleaseMutex() } catch { } }
            try { $mutex.Dispose() } catch { }
        }
    }
}
