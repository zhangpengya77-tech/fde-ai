# E3 elevated read-only probe — NO side effects, NO process start/stop.
# Writes findings to a JSON file for the non-elevated caller to read.
param(
  [string]$OutFile = 'C:\Users\admin\AppData\Local\FDE-AI\classroom\e3-elevated-probe.json'
)
$ErrorActionPreference = 'Continue'
function Safe-Json($o){ try { $o | ConvertTo-Json -Compress -Depth 6 } catch { '{}' } }

$out = @{ probe_elevated = $false; queries = @{}; errors = @() }

# 1. self elevation
try {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $wp = New-Object Security.Principal.WindowsPrincipal($id)
  $out.probe_elevated = $wp.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  $out.probe_user = $id.Name
} catch { $out.errors += "self_elev: $($_.Exception.Message)" }

# 2. 8022 listener
try {
  $c = Get-NetTCPConnection -LocalPort 8022 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) {
    $pid = $c.OwningProcess
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$pid" -ErrorAction SilentlyContinue
    $chain = @()
    $cur = $pid
    for ($i=0; $i -lt 4 -and $cur; $i++) {
      $pp = Get-CimInstance Win32_Process -Filter "ProcessId=$cur" -ErrorAction SilentlyContinue
      if (-not $pp) { $chain += @{ pid=$cur; gone=$true }; break }
      $chain += @{
        pid = $cur
        name = $pp.Name
        created = if($pp.CreationDate){$pp.CreationDate.ToString('yyyy-MM-dd HH:mm:ss')}else{$null}
        parentPid = $pp.ParentProcessId
        exePath = $pp.ExecutablePath
        cmdReadable = [bool]($pp.CommandLine)
        cmdLen = if($pp.CommandLine){$pp.CommandLine.Length}else{0}
        cmd = if($pp.CommandLine){ $pp.CommandLine.Substring(0,[Math]::Min(500,$pp.CommandLine.Length)) }else{$null}
      }
      $cur = $pp.ParentProcessId
    }
    $out.queries['listener_8022'] = @{
      pid = $pid
      name = $p.Name
      created = if($p.CreationDate){$p.CreationDate.ToString('yyyy-MM-dd HH:mm:ss')}else{$null}
      parentPid = $p.ParentProcessId
      cmdReadable = [bool]($p.CommandLine)
      cmdLen = if($p.CommandLine){$p.CommandLine.Length}else{0}
      cmd = if($p.CommandLine){ $p.CommandLine.Substring(0,[Math]::Min(500,$p.CommandLine.Length)) }else{$null}
      chain = $chain
    }
  } else {
    $out.queries['listener_8022'] = @{ listening = $false; note = '8022 not listening at probe time' }
  }
} catch { $out.errors += "listener: $($_.Exception.Message)" }

# 3. scheduled task identity
try {
  $t = Get-ScheduledTask -TaskName 'FDE-AI v1.5C Classroom Server' -ErrorAction SilentlyContinue
  if ($t) {
    $info = Get-ScheduledTaskInfo -TaskName 'FDE-AI v1.5C Classroom Server' -ErrorAction SilentlyContinue
    $out.queries['scheduled_task'] = @{
      path = "$($t.TaskPath)$($t.TaskName)"
      state = [string]$t.State
      runLevel = [string]$t.Principal.RunLevel
      userId = $t.Principal.UserId
      logonType = [string]$t.Principal.LogonType
      lastRun = if($info){$info.LastRunTime.ToString('yyyy-MM-dd HH:mm:ss')}else{$null}
      lastResult = if($info){$info.LastTaskResult}else{$null}
      nextRun = if($info){$info.NextRunTime.ToString('yyyy-MM-dd HH:mm:ss')}else{$null}
    }
  } else { $out.queries['scheduled_task'] = @{ found = $false } }
} catch { $out.errors += "sched: $($_.Exception.Message)" }

# 4. read the formal launcher (read-only, no execution) to capture its declared interpreter/venv
try {
  $gwp = 'D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1'
  if (Test-Path $gwp) {
    $lines = [System.IO.File]::ReadAllLines($gwp)
    $hits = @()
    for ($i=0; $i -lt $lines.Count; $i++) {
      if ($lines[$i] -match 'python\.exe|venv|V15Root|manage\.py|runserver|127\.0\.0\.1:8022') {
        $hits += @{ line = ($i+1); text = $lines[$i].Substring(0,[Math]::Min(200,$lines[$i].Length)) }
      }
    }
    $out.queries['formal_launcher_refs'] = $hits
  }
} catch { $out.errors += "launcher_refs: $($_.Exception.Message)" }

try {
  [System.IO.File]::WriteAllText($OutFile, (Safe-Json $out))
  "WROTE $OutFile"
} catch {
  # fallback to stdout
  "WRITE-FAIL: $($_.Exception.Message)"
  Safe-Json $out
}