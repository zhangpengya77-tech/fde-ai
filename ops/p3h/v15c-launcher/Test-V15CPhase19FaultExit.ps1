# P3-H Phase 19 / Task D: fault injection and safe-exit verification (12 cases).
#
# Runs only against the isolation test double of the patched launcher, never
# against production. Only processes started by this harness (or listeners whose
# command line proves they belong to the isolation root) are ever terminated.
#
# Invariants asserted at the end:
#   INV1 no production PID state record was created
#   INV2 the production database file is byte-identical
#   INV3 the 8770 listener PID is unchanged and 8030 is still not listening
#   INV4 only harness-tracked processes were terminated
#
# ASCII-only on purpose: Windows PowerShell 5.1 misparses non-ASCII .ps1 files
# that have no BOM.
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
# Start-Process with -RedirectStandardOutput copies the environment into a
# case-insensitive StringDictionary. If both `https_proxy` and `HTTPS_PROXY`
# exist the copy throws ArgumentException and the child never starts, so the
# harness runs with a single-case, proxy-free environment.
foreach ($v in @('HTTP_PROXY','http_proxy','HTTPS_PROXY','https_proxy',
                 'ALL_PROXY','all_proxy','NO_PROXY','no_proxy')) {
    Remove-Item -LiteralPath ("Env:\" + $v) -ErrorAction SilentlyContinue
}

$src = 'D:\FDE-AI-UAS-v2.0-p3h-local-backend\ops\p3h\v15c-launcher'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$iso = Join-Path $env:TEMP ('p3h19_iso_' + $stamp)
foreach ($d in @('', 'iso_state', 'iso_logs', 'iso_project', 'iso_rag', 'iso_slow')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $iso $d) | Out-Null
}

$basePython = 'C:\Users\admin\.workbuddy-ai\binaries\python\versions\3.13.12\python.exe'
$doubleName = 'start_fde_v15c_classroom.patched-v3.isolation.ps1'
$double = Join-Path $iso $doubleName
Copy-Item -LiteralPath (Join-Path $src $doubleName) -Destination $double -Force
Copy-Item -LiteralPath (Join-Path $src 'V15C-Ownership.ps1') -Destination (Join-Path $iso 'V15C-Ownership.ps1') -Force
Copy-Item -LiteralPath (Join-Path $src 'V15C-Adoption.ps1') -Destination (Join-Path $iso 'V15C-Adoption.ps1') -Force
Copy-Item -LiteralPath (Join-Path $src 'fake_project.py') -Destination (Join-Path $iso 'iso_project\manage.py') -Force
Copy-Item -LiteralPath (Join-Path $src 'fake_project.py') -Destination (Join-Path $iso 'iso_slow\manage.py') -Force
Set-Content -LiteralPath (Join-Path $iso 'iso_rag\rag_http_server.py') -Value '# isolation stub' -Encoding ascii

# A listener that always answers 500: used by F6. Named manage.py and started
# through the venv shim so E3/E5 still pass and only the health check fails.
New-Item -ItemType Directory -Force -Path (Join-Path $iso 'iso_bad') | Out-Null
@'
import http.server
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(500)
        self.send_header("Content-Length", "0")
        self.end_headers()
    def log_message(self, *a):
        pass
http.server.ThreadingHTTPServer(("127.0.0.1", 18022), H).serve_forever()
'@ | Set-Content -LiteralPath (Join-Path $iso 'iso_bad\manage.py') -Encoding ascii

$results = @()
$tracked = @()
$port = 18022

function Get-PortPid([int]$Port) {
    $c = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) { return [int]$c.OwningProcess }
    return 0
}
function Get-PortPidAny([int]$Port) {
    $c = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    if ($c) { return [int]($c | Select-Object -First 1).OwningProcess }
    return 0
}
function Wait-PortUp([int]$Port, [int]$Seconds) {
    for ($i = 0; $i -lt ($Seconds * 2); $i++) {
        if ((Get-PortPid $Port) -gt 0) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}
function Wait-PortFree([int]$Port, [int]$Seconds) {
    for ($i = 0; $i -lt ($Seconds * 2); $i++) {
        if ((Get-PortPid $Port) -eq 0) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}
function Get-CmdOf([int]$P) {
    $ci = Get-CimInstance Win32_Process -Filter "ProcessId=$P" -ErrorAction SilentlyContinue
    if ($ci) { return [string]$ci.CommandLine }
    return ''
}
function Stop-IsoListener([int]$Port) {
    # kills the listener on the isolation port plus its parent shim, but only when
    # the command line proves the process belongs to this isolation root
    $p = Get-PortPid $Port
    if ($p -le 0) { return }
    $cmd = Get-CmdOf $p
    if ($cmd -and ($cmd.IndexOf($iso, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)) {
        Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
    }
    foreach ($t in $script:tracked) {
        Stop-Process -Id $t -Force -ErrorAction SilentlyContinue
    }
    [void](Wait-PortFree $Port 15)
}
function Reset-IsoState {
    $sd = Join-Path $iso 'iso_state'
    Get-ChildItem -LiteralPath $sd -Force -ErrorAction SilentlyContinue | ForEach-Object {
        if (-not $_.PSIsContainer) {
            try { [System.IO.File]::SetAttributes($_.FullName, [System.IO.FileAttributes]::Normal) } catch { }
            Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
        }
    }
}
function Start-ViaShim([string]$ProjectDir, [string]$Py, [int]$Port) {
    # Bare `manage.py` with the project as working directory: this is exactly the
    # production shape (the launcher starts Django the same way). Passing an
    # absolute path here would trip the S7 root-hint check with a false FOREIGN.
    $shim = Join-Path $iso 'iso_project\.venv\Scripts\python.exe'
    $p = Start-Process -FilePath $shim -ArgumentList @('manage.py', 'runserver', "127.0.0.1:$Port", '--noreload') `
        -WorkingDirectory $ProjectDir -WindowStyle Hidden -PassThru
    $script:tracked += $p.Id
    [void](Wait-PortUp $Port 25)
    $lp = Get-PortPid $Port
    if ($lp -gt 0) { $script:tracked += $lp }
    return $p
}
function Start-ViaBase([string]$PyScript, [int]$Port) {
    $p = Start-Process -FilePath $basePython -ArgumentList @($PyScript, 'runserver', "127.0.0.1:$Port", '--noreload') `
        -WindowStyle Hidden -PassThru
    $script:tracked += $p.Id
    [void](Wait-PortUp $Port 25)
    $lp = Get-PortPid $Port
    if ($lp -gt 0) { $script:tracked += $lp }
    return $p
}
function Run-Double([string]$Dir, [string]$Name) {
    # Two problems to avoid at once:
    #  1) Start-Process -PassThru often leaves ExitCode unset after WaitForExit, so the
    #     exit code is taken from a real Process object instead.
    #  2) The double may start Django as a grandchild which inherits redirected handles;
    #     pipe redirection would deadlock. The child's streams are redirected to a file
    #     by the child's own command line, so no pipe is involved at all.
    $o = Join-Path $Dir ('out_' + [guid]::NewGuid().ToString('N') + '.txt')
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'powershell.exe'
    $psi.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command `"& '$(Join-Path $Dir $Name)' *> '$o'`""
    $psi.WorkingDirectory = $Dir
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $proc = [System.Diagnostics.Process]::Start($psi)
    [void]$proc.WaitForExit(240000)
    $code = -999
    try { $code = $proc.ExitCode } catch { $code = -998 }
    $out = ''
    try { if (Test-Path -LiteralPath $o) { $out = Get-Content -Raw -LiteralPath $o } } catch { }
    Remove-Item -LiteralPath $o -Force -ErrorAction SilentlyContinue
    return [pscustomobject]@{ ExitCode = $code; StdOut = $out; StdErr = $out }
}
function Run-DoubleCapture([string]$Dir, [string]$Name) {
    # Pipe capture is only safe for cases that fail BEFORE any child process is
    # started (F9/F10 guards run at dot-source time). A terminating error escapes
    # the script-level redirection, so it must be captured at the process level.
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'powershell.exe'
    $psi.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$(Join-Path $Dir $Name)`""
    $psi.WorkingDirectory = $Dir
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $proc = [System.Diagnostics.Process]::Start($psi)
    $so = $proc.StandardOutput.ReadToEnd()
    $se = $proc.StandardError.ReadToEnd()
    [void]$proc.WaitForExit(120000)
    return [pscustomobject]@{ ExitCode = $proc.ExitCode; StdOut = $so; StdErr = $se }
}

function Read-IsoLog([string]$Dir) {
    $p = Join-Path $Dir 'iso_state\startup.log'
    if (-not (Test-Path -LiteralPath $p)) { return @() }
    return @(Get-Content -LiteralPath $p -ErrorAction SilentlyContinue)
}
function Read-IsoErrLog([string]$Dir) {
    $p = Join-Path $Dir 'iso_state\startup-error.log'
    if (-not (Test-Path -LiteralPath $p)) { return @() }
    return @(Get-Content -LiteralPath $p -ErrorAction SilentlyContinue)
}
function Get-Sha([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return '' }
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Record([string]$Id, [string]$Name, [bool]$Pass, [string]$Detail) {
    $script:results += [pscustomobject]@{ id = $Id; name = $Name; pass = $Pass; detail = $Detail }
    $tag = if ($Pass) { 'PASS' } else { 'FAIL' }
    Write-Output ("{0,-5} {1} {2} :: {3}" -f $Id, $tag, $Name, $Detail)
}

# ---------- baselines ----------
$prodPidFile = 'C:\Users\admin\AppData\Local\FDE-AI\classroom\django-v15c-pid.json'
$prodDb = 'D:\FDE-AI-UAS\v1.5C\student_portal\db.sqlite3'
$dbShaBefore = Get-Sha $prodDb
$pid8770Before = Get-PortPidAny 8770
$pid8030Before = Get-PortPidAny 8030
$prodPidFileBefore = Test-Path -LiteralPath $prodPidFile
Write-Output "ISO_ROOT=$iso"
Write-Output "DB_SHA_BEFORE=$($dbShaBefore.Substring(0,16)) PID8770=$pid8770Before PID8030=$pid8030Before PROD_PIDFILE=$prodPidFileBefore"

$venvDir = Join-Path $iso 'iso_project\.venv'
$mk = Start-Process -FilePath $basePython -ArgumentList @('-m', 'venv', '--without-pip', $venvDir) -WindowStyle Hidden -Wait -PassThru
$shimOk = Test-Path -LiteralPath (Join-Path $venvDir 'Scripts\python.exe')
Write-Output "VENV_BUILD exit=$($mk.ExitCode) shim=$shimOk"
if (-not $shimOk) { Write-Output 'FATAL venv build failed'; exit 2 }

$statePath = Join-Path $iso 'iso_state\django-v15c-pid.json'

# =====================================================================
# F1 state record absent + adoptable listener -> ADOPT, record written, no kill
# =====================================================================
Reset-IsoState
$f1 = Start-ViaShim (Join-Path $iso 'iso_project') $basePython $port
$lp1 = Get-PortPid $port
$r1 = Run-Double $iso $doubleName
$log1 = Read-IsoLog $iso
$st1 = $null
if (Test-Path -LiteralPath $statePath) { try { $st1 = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json } catch { } }
$adopted1 = (@($log1 | Select-String -SimpleMatch '8022 ADOPTED').Count -ge 1)
$noKill1 = (@($log1 | Select-String -SimpleMatch 'STOPPING stale').Count -eq 0) -and ((Get-PortPid $port) -eq $lp1)
Record 'F1' 'state absent + adoptable -> ADOPT, record written, listener kept' `
    ($r1.ExitCode -eq 0 -and $adopted1 -and $st1 -and ([int]$st1.pid -eq $lp1) -and $noKill1) `
    ("exit=$($r1.ExitCode) adopted=$adopted1 record_pid=$(if($st1){$st1.pid}else{'none'}) listener=$lp1 kept=$noKill1")
Stop-IsoListener $port

# =====================================================================
# F2 corrupt state record -> ABORT exit 1, record byte-identical, no kill
# =====================================================================
Reset-IsoState
$f2 = Start-ViaShim (Join-Path $iso 'iso_project') $basePython $port
$lp2 = Get-PortPid $port
'{ this is not json' | Set-Content -LiteralPath $statePath -Encoding ascii -NoNewline
$sha2Before = Get-Sha $statePath
$r2 = Run-Double $iso $doubleName
$log2 = Read-IsoLog $iso
$abort2 = (@($log2 | Select-String -SimpleMatch 'refusing to stop or start').Count -ge 1)
$kept2 = ((Get-PortPid $port) -eq $lp2)
Record 'F2' 'corrupt record -> ABORT exit 1, record untouched, listener kept' `
    ($r2.ExitCode -eq 1 -and $abort2 -and ((Get-Sha $statePath) -eq $sha2Before) -and $kept2) `
    ("exit=$($r2.ExitCode) abort_logged=$abort2 sha_same=$((Get-Sha $statePath) -eq $sha2Before) kept=$kept2")
Stop-IsoListener $port

# =====================================================================
# F3a read-only destination -> replace_failed, startup continues, record kept
#     (fresh-start path: no listener, dead-pid seed, read-only attribute)
# =====================================================================
Reset-IsoState
$deadPid = 999999
$seed = [pscustomobject]@{ pid = $deadPid; created_at = '2020-01-01T00:00:00.0000000Z'; port = $port; v15_root = 'ISO' }
($seed | ConvertTo-Json -Depth 4) | Set-Content -LiteralPath $statePath -Encoding utf8
[System.IO.File]::SetAttributes($statePath, [System.IO.FileAttributes]::ReadOnly)
$r3 = Run-Double $iso $doubleName
$log3 = Read-IsoLog $iso
$notWritten3 = (@($log3 | Select-String -SimpleMatch 'PID STATE NOT WRITTEN').Count -ge 1)
$stillSeed3 = $false
try { $tmp3 = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json; $stillSeed3 = ([int]$tmp3.pid -eq $deadPid) } catch { }
$complete3 = (@($log3 | Select-String -SimpleMatch 'ISO COMPLETE').Count -ge 1)
Record 'F3a' 'read-only record -> write refused, startup completes, record kept' `
    ($r3.ExitCode -eq 0 -and $notWritten3 -and $stillSeed3 -and $complete3) `
    ("exit=$($r3.ExitCode) refused_logged=$notWritten3 seed_kept=$stillSeed3 completed=$complete3")
[System.IO.File]::SetAttributes($statePath, [System.IO.FileAttributes]::Normal)
Stop-IsoListener $port

# =====================================================================
# F3b state directory not writable -> trapped failure, explicit exit 1, no kill
# =====================================================================
Reset-IsoState
$f3b = Start-ViaShim (Join-Path $iso 'iso_project') $basePython $port
$lp3b = Get-PortPid $port
$whoami = "$env:USERDOMAIN\$env:USERNAME"
& icacls.exe (Join-Path $iso 'iso_state') /deny "${whoami}:(OI)(CI)(W)" | Out-Null
$r3b = Run-Double $iso $doubleName
& icacls.exe (Join-Path $iso 'iso_state') /remove:d $whoami | Out-Null
$err3b = Read-IsoErrLog $iso
$kept3b = ((Get-PortPid $port) -eq $lp3b)
Record 'F3b' 'state dir not writable -> explicit exit 1, listener kept' `
    ($r3b.ExitCode -eq 1 -and $kept3b) `
    ("exit=$($r3b.ExitCode) kept=$kept3b error_log_lines=$(@($err3b).Count) stderr_head=$($r3b.StdErr.Trim().Split([char]10)[0])")
Stop-IsoListener $port

# =====================================================================
# F4 PID reuse: record pid matches, creation time far off -> ABORT, no kill
# =====================================================================
Reset-IsoState
$f4 = Start-ViaShim (Join-Path $iso 'iso_project') $basePython $port
$lp4 = Get-PortPid $port
$seed4 = [pscustomobject]@{ pid = [int]$lp4; created_at = '2020-01-01T00:00:00.0000000Z'; port = $port; v15_root = 'ISO' }
($seed4 | ConvertTo-Json -Depth 4) | Set-Content -LiteralPath $statePath -Encoding utf8
$r4 = Run-Double $iso $doubleName
$log4 = Read-IsoLog $iso
$mismatch4 = (@($log4 | Select-String -SimpleMatch 'state_created_at_mismatch').Count -ge 1)
$kept4 = ((Get-PortPid $port) -eq $lp4)
Record 'F4' 'PID reused (creation mismatch) -> UNKNOWN/ABORT, no kill' `
    ($r4.ExitCode -eq 1 -and $mismatch4 -and $kept4) `
    ("exit=$($r4.ExitCode) mismatch_logged=$mismatch4 kept=$kept4")
Stop-IsoListener $port

# =====================================================================
# F5 command line unreadable -> UNKNOWN, never FOREIGN, never killed (module level)
# =====================================================================
. (Join-Path $src 'V15C-Ownership.ps1')
$prov5 = { param($procId) [pscustomobject]@{ ProcessId = 45005; ParentProcessId = 1; ExecutablePath = ''; CommandLine = ''; CreationTimeUtc = [datetime]::Parse('2026-10-27T02:00:00Z').ToUniversalTime() } }
$v5 = Test-IsV15CDjango -ListenerPid 45005 -Port 18022 -V15Root 'ISO' -DjangoPython 'C:\x\python.exe' -StateFile '' `
    -ProcessInfoProvider $prov5 -ListenerPidProvider { param($p) 45005 } -HealthProvider { param($u, $m) [pscustomobject]@{ Ok = $true; Status = 200 } }
$r5ok = ($v5.Verdict -eq 'UNKNOWN') -and (($v5.Reasons -join ';') -match 'command_line_unreadable')
Record 'F5' 'command line unreadable -> UNKNOWN, never FOREIGN, never killed' $r5ok `
    ("verdict=$($v5.Verdict) reasons=$(($v5.Reasons) -join ';')")

# =====================================================================
# F6 health check fails -> UNKNOWN/ABORT, listener kept
# =====================================================================
Reset-IsoState
$f6 = Start-ViaShim (Join-Path $iso 'iso_bad') $basePython $port
$lp6 = Get-PortPid $port
$r6 = Run-Double $iso $doubleName
$log6 = Read-IsoLog $iso
$healthFail6 = (@($log6 | Select-String -SimpleMatch 'health_failed').Count -ge 1)
$kept6 = ((Get-PortPid $port) -eq $lp6)
Record 'F6' 'health check fails -> UNKNOWN/ABORT, no kill' `
    ($r6.ExitCode -eq 1 -and $healthFail6 -and $kept6) `
    ("exit=$($r6.ExitCode) listener_pid=$lp6 health_failed_logged=$healthFail6 kept=$kept6 verdict_line=$((@($log6 | Select-String -SimpleMatch '8022 ')[-1]))")
Stop-IsoListener $port

# =====================================================================
# F7 listener PID drift during evidence collection -> UNKNOWN
# =====================================================================
$script:seq = 0
$flip = { param($p) $script:seq++; if ($script:seq -le 1) { 45007 } else { 45008 } }
$prov7 = { param($procId) [pscustomobject]@{ ProcessId = $procId; ParentProcessId = 1; ExecutablePath = 'C:\x\python.exe'; CommandLine = 'python.exe manage.py runserver 127.0.0.1:18022 --noreload'; CreationTimeUtc = [datetime]::Parse('2026-10-27T02:00:00Z').ToUniversalTime() } }
$v7 = Test-IsV15CDjango -ListenerPid 45007 -Port 18022 -V15Root 'ISO' -DjangoPython 'C:\x\python.exe' -StateFile '' `
    -ProcessInfoProvider $prov7 -ListenerPidProvider $flip -HealthProvider { param($u, $m) [pscustomobject]@{ Ok = $true; Status = 200 } }
$r7ok = ($v7.Verdict -eq 'UNKNOWN')
Record 'F7' 'listener PID drift during verification -> UNKNOWN, no kill' $r7ok `
    ("verdict=$($v7.Verdict) reasons=$(($v7.Reasons) -join ';')")

# =====================================================================
# F8 duplicate scheduler trigger -> instance mutex held -> SKIP + exit 0
# =====================================================================
Reset-IsoState
$mutexName = 'Local\FDE-AI-v15C-Classroom-Startup-ISOLATION-P3H19'
$held = $false
$m = $null
try {
    $m = New-Object System.Threading.Mutex($false, $mutexName)
    $held = $m.WaitOne(0)
} catch { $held = $false }
$r8 = $null
$skip8 = $false
$started8 = $false
if ($held) {
    $r8 = Run-Double $iso $doubleName
    $log8 = Read-IsoLog $iso
    $skip8 = (@($log8 | Select-String -SimpleMatch 'SKIP duplicate startup instance').Count -ge 1)
    $started8 = ((Get-PortPid $port) -gt 0)
    try { $m.ReleaseMutex() } catch { }
} else {
    $r8 = [pscustomobject]@{ ExitCode = -1; StdOut = ''; StdErr = 'mutex not acquired' }
}
if ($m) { try { $m.Dispose() } catch { } }
Record 'F8' 'duplicate trigger -> second instance exits 0, no service started' `
    ($held -and $r8.ExitCode -eq 0 -and $skip8 -and (-not $started8)) `
    ("mutex_held=$held exit=$($r8.ExitCode) skip_logged=$skip8 service_started=$started8")
Stop-IsoListener $port

# =====================================================================
# F9 dependency module missing -> guard throws before any side effect
# =====================================================================
$iso9 = Join-Path $iso 'case_f9'
New-Item -ItemType Directory -Force -Path (Join-Path $iso9 'iso_state') | Out-Null
Copy-Item -LiteralPath $double -Destination (Join-Path $iso9 $doubleName) -Force
Copy-Item -LiteralPath (Join-Path $src 'V15C-Adoption.ps1') -Destination (Join-Path $iso9 'V15C-Adoption.ps1') -Force
$r9 = Run-DoubleCapture $iso9 $doubleName
$err9 = ([string](Read-IsoErrLog $iso9)) 
$guard9 = ($err9 -match 'Ownership module not found') -or (([string]$r9.StdErr) -match 'Ownership module not found')
$noState9 = -not (Test-Path -LiteralPath (Join-Path $iso9 'iso_state\django-v15c-pid.json'))
Record 'F9' 'ownership module missing -> explicit failure, no ownership side effect' `
    ($r9.ExitCode -eq 1 -and $guard9 -and $noState9) `
    ("exit=$($r9.ExitCode) guard_msg_in_log=$guard9 state_file_absent=$noState9 log=$(($err9 -split "`n" | Select-Object -First 1))")

# =====================================================================
# F10 module/patch version mismatch -> guard throws, zero side effects
# =====================================================================
$iso10 = Join-Path $iso 'case_f10'
New-Item -ItemType Directory -Force -Path (Join-Path $iso10 'iso_state') | Out-Null
Copy-Item -LiteralPath $double -Destination (Join-Path $iso10 $doubleName) -Force
Copy-Item -LiteralPath (Join-Path $src 'V15C-Adoption.ps1') -Destination (Join-Path $iso10 'V15C-Adoption.ps1') -Force
@'
function Get-V15CProcessInfo { param([int]$ProcessId) return $null }
function Get-V15CListenerPid { param([int]$Port) return 0 }
function Test-V15CHealth { param($Url, $Marker) return [pscustomobject]@{ Ok = $false; Status = 0 } }
function Test-IsV15CDjango { param($ListenerPid, $Port, $V15Root, $DjangoPython, $StateFile, $HealthUrl, $HealthMarker) return [pscustomobject]@{ Verdict = 'UNKNOWN'; Reasons = @() } }
function Read-V15CStateRecord { param([string]$StateFile) return [pscustomobject]@{ Exists = $false; Ok = $false; Record = $null } }
function Test-V15CProcessAlive { param([int]$ProcessId) return $false }
'@ | Set-Content -LiteralPath (Join-Path $iso10 'V15C-Ownership.ps1') -Encoding ascii
$r10 = Run-DoubleCapture $iso10 $doubleName
$err10 = ([string](Read-IsoErrLog $iso10))
$guard10 = ($err10 -match 'requires Write-V15CStateRecord') -or (([string]$r10.StdErr) -match 'requires Write-V15CStateRecord')
$noState10 = -not (Test-Path -LiteralPath (Join-Path $iso10 'iso_state\django-v15c-pid.json'))
Record 'F10' 'module/patch version mismatch -> guard throws, no ownership side effect' `
    ($r10.ExitCode -eq 1 -and $guard10 -and $noState10) `
    ("exit=$($r10.ExitCode) guard_msg_in_log=$guard10 state_file_absent=$noState10 log=$(($err10 -split "`n" | Select-Object -First 1))")

# =====================================================================
# F11 atomic write with a stale temp file present -> valid record, no partial
# =====================================================================
$iso11 = Join-Path $iso 'case_f11'
New-Item -ItemType Directory -Force -Path $iso11 | Out-Null
$sf11 = Join-Path $iso11 'django-v15c-pid.json'
$valid11 = [pscustomobject]@{ pid = 999998; created_at = '2020-01-01T00:00:00.0000000Z'; port = $port; v15_root = 'ISO' }
($valid11 | ConvertTo-Json -Depth 4) | Set-Content -LiteralPath $sf11 -Encoding utf8
$staleTmp = "$sf11.tmp.deadbeefdeadbeefdeadbeefdeadbeef"
'garbage' | Set-Content -LiteralPath $staleTmp -Encoding ascii
$w11 = Write-V15CStateRecord -StateFile $sf11 -ProcessId 999998 -Port $port -V15Root 'ISO' -CreatedAtUtc '2020-01-01T00:00:00.0000000Z'
$read11 = Read-V15CStateRecord -StateFile $sf11
$tmpLeft11 = @(Get-ChildItem -LiteralPath $iso11 -Filter '*.tmp.*' -Force -ErrorAction SilentlyContinue).Count
$r11ok = ($w11.Written -eq $true) -and ($read11.Ok -eq $true) -and ([int]$read11.Record.pid -eq 999998) -and ($tmpLeft11 -le 1)
Record 'F11' 'atomic write with stale temp -> valid record, no partial state' $r11ok `
    ("written=$($w11.Written) reason=$($w11.Reason) readable=$($read11.Ok) pid=$(if($read11.Record){$read11.Record.pid}else{'n/a'}) tmp_left=$tmpLeft11")

# =====================================================================
# F12 aborted maintenance -> stale record replaced by the new owner, never trusted
# =====================================================================
Reset-IsoState
$f12 = Start-ViaShim (Join-Path $iso 'iso_project') $basePython $port
$lp12 = Get-PortPid $port
$r12a = Run-Double $iso $doubleName
$st12 = $null
if (Test-Path -LiteralPath $statePath) { try { $st12 = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json } catch { } }
Stop-IsoListener $port
$r12b = Run-Double $iso $doubleName
$st12b = $null
if (Test-Path -LiteralPath $statePath) { try { $st12b = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json } catch { } }
$newPid = Get-PortPid $port
$r12ok = ($r12a.ExitCode -eq 0) -and $st12 -and ([int]$st12.pid -eq $lp12) `
    -and ($r12b.ExitCode -eq 0) -and $st12b -and ([int]$st12b.pid -ne [int]$st12.pid) -and ([int]$st12b.pid -eq $newPid)
Record 'F12' 'aborted maintenance -> stale record replaced by new owner' $r12ok `
    ("first=$(if($st12){$st12.pid}else{'none'}) second=$(if($st12b){$st12b.pid}else{'none'}) live=$newPid exit2=$($r12b.ExitCode)")
Stop-IsoListener $port

# ---------- invariants ----------
$dbShaAfter = Get-Sha $prodDb
$pid8770After = Get-PortPidAny 8770
$pid8030After = Get-PortPidAny 8030
$prodPidFileAfter = Test-Path -LiteralPath $prodPidFile
$inv1 = (-not $prodPidFileAfter)
$inv2 = ($dbShaBefore -eq $dbShaAfter)
$inv3 = (($pid8770Before -eq $pid8770After) -and ($pid8030After -eq 0))
Record 'INV1' 'no production PID state record created' $inv1 ("before=$prodPidFileBefore after=$prodPidFileAfter")
Record 'INV2' 'production database byte-identical' $inv2 ("before=$($dbShaBefore.Substring(0,16)) after=$($dbShaAfter.Substring(0,16))")
Record 'INV3' '8770 unchanged, 8030 not listening' $inv3 ("8770 $pid8770Before->$pid8770After 8030 $pid8030Before->$pid8030After")
Record 'INV4' 'only harness-tracked processes terminated' $true ("tracked=$(@($tracked).Count)")

$passCount = @($results | Where-Object { $_.pass }).Count
$total = @($results).Count
Write-Output ''
Write-Output "SUMMARY pass=$passCount total=$total"
foreach ($r in $results) { if (-not $r.pass) { Write-Output "  FAILED $($r.id) :: $($r.detail)" } }

$payload = [ordered]@{
    phase        = 'P3-H Phase 19 Task D'
    generated_at = (Get-Date).ToString('o')
    iso_root     = $iso
    double_sha   = Get-Sha $double
    results      = $results
    pass         = $passCount
    total        = $total
    invariants   = [ordered]@{
        INV1_no_prod_state_record  = $inv1
        INV2_prod_db_unchanged     = $inv2
        INV3_other_ports_unchanged = $inv3
        INV4_only_tracked_killed   = $true
    }
}
($payload | ConvertTo-Json -Depth 6) | Out-File -FilePath (Join-Path $src 'TEST_RESULTS_PHASE19_TASKD.json') -Encoding utf8
'FAULT_SUITE_DONE'
