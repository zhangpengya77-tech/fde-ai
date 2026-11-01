# E3 Final Read-Only Probe (Phase 19 Final Safety Confirmation)
# Authorized: architect approval A. Read-only. No elevation, no schedule change,
# no service stop/restart, no env modification. Executes ONE read-only collection.
$ErrorActionPreference = 'Stop'
$out = [ordered]@{
    collectedAtUtc   = (Get-Date).ToUniversalTime().ToString('o')
    sessionElevated  = $false
    scheduledTask    = $null
    listener         = $null
    commandLine      = $null
    shimRelation     = $null
}

# 0. Session elevation status (read-only)
try {
    $id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $wp = New-Object System.Security.Principal.WindowsPrincipal($id)
    $out.sessionElevated = $wp.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
} catch { $out.sessionElevated = 'error' }

# 1+2. Scheduled task account & RunLevel (read-only)
try {
    $task = Get-ScheduledTask -TaskName 'FDE-AI v1.5C Classroom Server' -ErrorAction Stop
    $p = $task.Principal
    $out.scheduledTask = [ordered]@{
        taskName   = $task.TaskName
        state      = $task.State.ToString()
        userId     = $p.UserId
        logonType  = $p.LogonType.ToString()
        runLevel   = $p.RunLevel.ToString()
        groupId    = $p.GroupId
        taskPath   = $task.TaskPath
    }
    $info = Get-ScheduledTaskInfo -TaskName 'FDE-AI v1.5C Classroom Server' -ErrorAction SilentlyContinue
    if ($info) { $out.scheduledTask['lastRunTime'] = $info.LastRunTime.ToString('o'); $out.scheduledTask['lastTaskResult'] = $info.LastTaskResult }
} catch {
    $out.scheduledTask = [ordered]@{ error = $_.Exception.Message }
}

# 3+4+5+6. 8022 listener PID / CreationDate / CommandLine / ParentProcessId (read-only)
try {
    $conn = Get-NetTCPConnection -LocalPort 8022 -State Listen -ErrorAction Stop
    $listenerPid = $conn.OwningProcess | Select-Object -First 1
    $out.listener = [ordered]@{ localPort = 8022; owningPid = $listenerPid }
    $proc = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $listenerPid" -ErrorAction Stop
    $cmd = $proc.CommandLine
    $cmdLen = if ($null -eq $cmd) { 0 } else { $cmd.Length }
    $out.listener['creationDate']   = $proc.CreationDate
    $out.listener['parentProcessId']= $proc.ParentProcessId
    $out.listener['name']           = $proc.Name
    $out.listener['executablePath'] = $proc.ExecutablePath
    $out.commandLine = [ordered]@{
        rawLength    = $cmdLen
        readable     = ($cmdLen -gt 0)
        status       = if ($cmdLen -gt 0) { 'READABLE' } else { 'NOT_DETERMINED' }
        note         = if ($cmdLen -gt 0) { 'CommandLine read under current identity' } else { 'Empty under non-elevated identity; cannot read under formal elevated schedule identity in this sandbox (RunAs blocked). Marked NOT DETERMINED per authorization.' }
    }
} catch {
    $out.listener = [ordered]@{ error = $_.Exception.Message }
    $out.commandLine = [ordered]@{ status = 'NOT_DETERMINED'; note = 'Listener lookup failed: ' + $_.Exception.Message }
}

# 7. Python shim -> Django child relation (read-only, via parent chain + pyvenv.cfg)
try {
    if ($out.listener -and $out.listener.Contains('parentProcessId')) {
        $ppid = $out.listener['parentProcessId']
        $pp = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $ppid" -ErrorAction SilentlyContinue
        $shim = [ordered]@{
            parentPid      = $ppid
            parentName     = if ($pp) { $pp.Name } else { $null }
            parentExePath  = if ($pp) { $pp.ExecutablePath } else { $null }
            parentCmdLen   = if ($pp) { if ($null -eq $pp.CommandLine) { 0 } else { $pp.CommandLine.Length } } else { $null }
            relation       = $null
        }
        # Parent is the venv shim (redirector) that spawned the base interpreter listener.
        if ($pp -and $pp.Name -eq 'python.exe') {
            $shim['relation'] = 'listener(base python.exe) parent is python.exe shim'
        } elseif ($pp) {
            $shim['relation'] = "listener parent is $($pp.Name)"
        } else {
            $shim['relation'] = 'parent process details restricted under non-elevated identity'
        }
        # Deep pyvenv.cfg proof requires an executable path; ExecutablePath is null
        # under non-elevated identity, so record as restricted and rely on file-side
        # proof performed in the E4c consistency section (read-only file read).
        $shim['pyvenvCfgStatus'] = 'RESTRICTED_PATH_UNDER_NON_ELEVATED'
        $out.shimRelation = $shim
    }
} catch {
    $out.shimRelation = [ordered]@{ error = $_.Exception.Message }
}

$out | ConvertTo-Json -Depth 6
