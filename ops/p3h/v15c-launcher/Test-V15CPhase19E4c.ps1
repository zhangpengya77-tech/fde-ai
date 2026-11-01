# P3-H Phase 19 (supplementary): E4c health-marker fix - positive & negative tests.
#
# Uses the INDEPENDENT copy V15C-Adoption.e4c.ps1 (HealthMarkers fixed to
# @('FDE-AI','csrfmiddlewaretoken')). The parallel-agent-owned V15C-Adoption.ps1
# is NOT touched.
#
# Deterministic: all adoption-gate scenarios use injected providers so they do
# not depend on the (non-elevated, CommandLine-unreadable) live 8022 listener.
# A separate read-only live probe of the real 8022 /login/ is included to prove
# the fix is necessary AND sufficient for the production fingerprint.
#
# ASCII-only on purpose (PS 5.1 misparses non-ASCII .ps1 without BOM).

[CmdletBinding()]
param(
  [string]$ResultJson = ''
)

$ErrorActionPreference = 'Stop'
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

$here = $PSScriptRoot
if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Path }

$OwnershipModulePath = Join-Path $here 'V15C-Ownership.ps1'
$AdoptionModulePath  = Join-Path $here 'V15C-Adoption.e4c.ps1'

# modules must load before any test that uses their functions
. $OwnershipModulePath
. $AdoptionModulePath

$results = New-Object System.Collections.Generic.List[object]
function Record([string]$id, [string]$desc, [bool]$ok, [string]$detail) {
  $script:results.Add([pscustomobject]@{ name = $id; description = $desc; ok = $ok; detail = $detail })
  $mark = if ($ok) { 'PASS' } else { 'FAIL' }
  Write-Output ("[{0}] {1} :: {2} :: {3}" -f $mark, $id, $desc, $detail)
}

# ---- shared fake topology --------------------------------------------------
$SHIM = 'C:\fake\student_portal\.venv\Scripts\python.exe'
$BASE = 'C:\Users\admin\.fde-ai\YoloRuntime\python\cpython-3.12.13-windows-x86_64-none\python.exe'
$PORT = 18099   # non-production port
$V15ROOT = 'C:\fake\v1.5C\student_portal'

function New-Info([int]$pidn, [int]$ppid, [string]$exe, [string]$cmd, [datetime]$created) {
  [pscustomobject]@{
    ProcessId       = $pidn
    ParentProcessId = $ppid
    ExecutablePath  = $exe
    CommandLine     = $cmd
    CreationTimeUtc = $created
  }
}

$CMD_OK = "$SHIM C:\fake\v1.5C\student_portal\manage.py runserver 127.0.0.1:$PORT"

# provider builders (scriptblocks capture the fake objects)
function Provider([scriptblock]$sb) { $sb }

# ===========================================================================
# Item 1 - correct v1.5C service passes (fully evidenced -> ADOPTABLE, E4c True)
# ===========================================================================
$infoCorrect = New-Info 90001 90000 $BASE $CMD_OK ([datetime]::UtcNow)
$prov = @{
  ProcessInfo  = { param($p) if ([int]$p -eq 90001) { return $infoCorrect } return $null }.GetNewClosure()
  ListenerPid = { param($pt) if ([int]$pt -eq $PORT) { return 90001 } return 0 }.GetNewClosure()
  Health      = { param($u,$m) [pscustomobject]@{ Ok=$true; Status=200; ContentLength=120; Markers=@{}; AllMarkers=$true } }.GetNewClosure()
  Venv        = { param($dp,$obs) [pscustomobject]@{ ShimPath=$SHIM; ShimExists=$true; VenvRoot='C:\fake\student_portal\.venv'; PyvenvCfgPath='x'; PyvenvCfgReadable=$true; Home=$BASE; HomeMatchesObserved=$true; ObservedInterpreter=$BASE } }.GetNewClosure()
  Project     = { param($r,$vr) [pscustomobject]@{ V15Root=$V15ROOT; ManagePyPath='p'; ManagePyExists=$true; ManagePySha256='abc'; ShimProjectRoot='x'; ShimManagePyExists=$true; ShimManagePySha256='abc'; SameCode=$true } }.GetNewClosure()
  Conflict    = { param($s,$m,$c) [pscustomobject]@{ LauncherScriptName=$s; MutexName=$m; ConflictingProcesses=@(); ConflictCount=0; MutexFree=$true; MutexCheckable=$true; MutexDetail='acquired' } }.GetNewClosure()
}
$r1 = Test-V15CAdoptionEligible -ListenerPid 90001 -Port $PORT -V15Root $V15ROOT -DjangoPython $SHIM -HealthUrl 'http://127.0.0.1:18099/login/' `
  -ProcessInfoProvider $prov.ProcessInfo -ListenerPidProvider $prov.ListenerPid -HealthProvider $prov.Health `
  -VenvEvidenceProvider $prov.Venv -ProjectEvidenceProvider $prov.Project -ConflictProvider $prov.Conflict
$ok1 = ($r1.Verdict -eq 'ADOPTABLE') -and ($r1.Evidence.E4_project.FingerprintOk -eq $true)
Record 'E4c-1' 'correct v1.5C (full evidence) -> ADOPTABLE & E4c fingerprint passes' $ok1 ("verdict=$($r1.Verdict) e4c=$($r1.Evidence.E4_project.FingerprintOk) e4a=$($r1.Evidence.E4_project.VenvOk) e4b=$($r1.Evidence.E4_project.ManagePyOk)")

# ===========================================================================
# Item 2 - wrong Django project rejected (SameCode False)
# ===========================================================================
$prov2 = $prov.Clone()
$prov2.Project = { param($r,$vr) [pscustomobject]@{ V15Root=$V15ROOT; ManagePyPath='p'; ManagePyExists=$true; ManagePySha256='abc'; ShimProjectRoot='x'; ShimManagePyExists=$true; ShimManagePySha256='DIFFERENT'; SameCode=$false } }.GetNewClosure()
$r2 = Test-V15CAdoptionEligible -ListenerPid 90001 -Port $PORT -V15Root $V15ROOT -DjangoPython $SHIM -HealthUrl 'http://x/login/' `
  -ProcessInfoProvider $prov2.ProcessInfo -ListenerPidProvider $prov2.ListenerPid -HealthProvider $prov2.Health `
  -VenvEvidenceProvider $prov2.Venv -ProjectEvidenceProvider $prov2.Project -ConflictProvider $prov2.Conflict
$ok2 = ($r2.Verdict -eq 'UNKNOWN') -and ($r2.Evidence.E4_project.ManagePyOk -eq $false)
Record 'E4c-2' 'wrong Django project (manage.py hash mismatch) -> UNKNOWN' $ok2 ("verdict=$($r2.Verdict) e4b=$($r2.Evidence.E4_project.ManagePyOk)")

# ===========================================================================
# Item 3 - generic login page must NOT pass on common markers alone
# ===========================================================================
$prov3 = $prov.Clone()
$prov3.Health = { param($u,$m) [pscustomobject]@{ Ok=$true; Status=200; ContentLength=80; Markers=@{}; AllMarkers=$false } }.GetNewClosure()
$r3 = Test-V15CAdoptionEligible -ListenerPid 90001 -Port $PORT -V15Root $V15ROOT -DjangoPython $SHIM -HealthUrl 'http://x/login/' `
  -ProcessInfoProvider $prov3.ProcessInfo -ListenerPidProvider $prov3.ListenerPid -HealthProvider $prov3.Health `
  -VenvEvidenceProvider $prov3.Venv -ProjectEvidenceProvider $prov3.Project -ConflictProvider $prov3.Conflict
$ok3 = ($r3.Evidence.E4_project.FingerprintOk -eq $false) -and ($r3.Verdict -eq 'UNKNOWN')
Record 'E4c-3' 'generic login page (no project fingerprint) -> E4c False, UNKNOWN' $ok3 ("verdict=$($r3.Verdict) e4c=$($r3.Evidence.E4_project.FingerprintOk)")

# ===========================================================================
# Item 4 - HTTP 200 but wrong service identity rejected (E4c passes, E5 fails)
# ===========================================================================
$prov4 = $prov.Clone()
$prov4.Venv = { param($dp,$obs) [pscustomobject]@{ ShimPath=$SHIM; ShimExists=$true; VenvRoot='C:\fake\student_portal\.venv'; PyvenvCfgPath='x'; PyvenvCfgReadable=$true; Home='C:\WRONG\python.exe'; HomeMatchesObserved=$false; ObservedInterpreter=$BASE } }.GetNewClosure()
$r4 = Test-V15CAdoptionEligible -ListenerPid 90001 -Port $PORT -V15Root $V15ROOT -DjangoPython $SHIM -HealthUrl 'http://x/login/' `
  -ProcessInfoProvider $prov4.ProcessInfo -ListenerPidProvider $prov4.ListenerPid -HealthProvider $prov4.Health `
  -VenvEvidenceProvider $prov4.Venv -ProjectEvidenceProvider $prov4.Project -ConflictProvider $prov4.Conflict
$ok4 = ($r4.Evidence.E4_project.FingerprintOk -eq $true) -and ($r4.Verdict -eq 'UNKNOWN') -and ($r4.Evidence.E5_interpreter.Ok -eq $false)
Record 'E4c-4' 'HTTP 200 wrong identity (E4c passes but E5 fails) -> UNKNOWN, gate not weakened' $ok4 ("verdict=$($r4.Verdict) e4c=$($r4.Evidence.E4_project.FingerprintOk) e5=$($r4.Evidence.E5_interpreter.Ok)")

# ===========================================================================
# Item 5 - health endpoint unavailable -> UNKNOWN
# ===========================================================================
$prov5 = $prov.Clone()
$prov5.Health = { param($u,$m) [pscustomobject]@{ Ok=$false; Status=0; ContentLength=0; Markers=@{}; AllMarkers=$false } }.GetNewClosure()
$r5 = Test-V15CAdoptionEligible -ListenerPid 90001 -Port $PORT -V15Root $V15ROOT -DjangoPython $SHIM -HealthUrl 'http://127.0.0.1:1/closed/' `
  -ProcessInfoProvider $prov5.ProcessInfo -ListenerPidProvider $prov5.ListenerPid -HealthProvider $prov5.Health `
  -VenvEvidenceProvider $prov5.Venv -ProjectEvidenceProvider $prov5.Project -ConflictProvider $prov5.Conflict
$ok5 = ($r5.Verdict -eq 'UNKNOWN') -and ($r5.Evidence.E7_health.Ok -eq $false)
Record 'E4c-5' 'health endpoint unavailable -> UNKNOWN (E7 fails)' $ok5 ("verdict=$($r5.Verdict) e7=$($r5.Evidence.E7_health.Ok)")

# ===========================================================================
# Item 6 - PID or CreationDate changed during evidence -> UNKNOWN (E6 drift)
# ===========================================================================
$prov6 = $prov.Clone()
# E1/E2 see 90001, but E6 recheck (second ListenerPidProvider call) returns a different pid
$calls = 0
$prov6.ListenerPid = { param($pt); $script:calls++; if ($script:calls -le 1) { return 90001 } return 90002 }.GetNewClosure()
$r6 = Test-V15CAdoptionEligible -ListenerPid 90001 -Port $PORT -V15Root $V15ROOT -DjangoPython $SHIM -HealthUrl 'http://x/login/' `
  -ProcessInfoProvider $prov6.ProcessInfo -ListenerPidProvider $prov6.ListenerPid -HealthProvider $prov6.Health `
  -VenvEvidenceProvider $prov6.Venv -ProjectEvidenceProvider $prov6.Project -ConflictProvider $prov6.Conflict
$ok6 = ($r6.Verdict -eq 'UNKNOWN') -and ($r6.Evidence.E6_listener_recheck.Ok -eq $false)
Record 'E4c-6' 'listener PID drift during evidence (E6) -> UNKNOWN' $ok6 ("verdict=$($r6.Verdict) e6=$($r6.Evidence.E6_listener_recheck.Ok)")

# ===========================================================================
# Item 7 - CommandLine unreadable -> UNKNOWN (early return)
# ===========================================================================
$infoNoCmd = New-Info 90001 90000 $BASE '' ([datetime]::UtcNow)
$prov7 = $prov.Clone()
$prov7.ProcessInfo = { param($p) if ([int]$p -eq 90001) { return $infoNoCmd } return $null }.GetNewClosure()
$r7 = Test-V15CAdoptionEligible -ListenerPid 90001 -Port $PORT -V15Root $V15ROOT -DjangoPython $SHIM -HealthUrl 'http://x/login/' `
  -ProcessInfoProvider $prov7.ProcessInfo -ListenerPidProvider $prov7.ListenerPid -HealthProvider $prov7.Health `
  -VenvEvidenceProvider $prov7.Venv -ProjectEvidenceProvider $prov7.Project -ConflictProvider $prov7.Conflict
$ok7 = ($r7.Verdict -eq 'UNKNOWN') -and ($r7.Reasons -contains 'E3_commandline_unreadable')
Record 'E4c-7' 'CommandLine unreadable -> UNKNOWN (E3 unreadable)' $ok7 ("verdict=$($r7.Verdict) reasons=$($r7.Reasons -join ',')")

# ===========================================================================
# Item 8 - concurrent adoption claims do NOT produce double ownership
# ===========================================================================
$scratch = Join-Path $env:TEMP ('v15c-e4c-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $scratch | Out-Null
$stateFile = Join-Path $scratch 'django-v15c-pid.json'
try {
  $rsScript = {
    param($modulePath, $stateFile, $pidn, $port, $v15root, $createdUtc)
    . $modulePath
    return (Write-V15CStateRecord -StateFile $stateFile -ProcessId $pidn -Port $port -V15Root $v15root -CreatedAtUtc $createdUtc)
  }
  $pool = [runspacefactory]::CreateRunspacePool(2, 2)
  $pool.Open()
  $createdUtc = [datetime]::UtcNow.ToString('o')
  $jobs = @()
  for ($i = 0; $i -lt 2; $i++) {
    $ps = [powershell]::Create()
    $ps.RunspacePool = $pool
    [void]$ps.AddScript($rsScript).AddArgument($OwnershipModulePath).AddArgument($stateFile).AddArgument(90001).AddArgument($PORT).AddArgument($V15ROOT).AddArgument($createdUtc)
    $jobs += $ps.BeginInvoke()
  }
  $outs = @()
  for ($i = 0; $i -lt 2; $i++) {
    $outs += $jobs[$i].PowerShell.EndInvoke($jobs[$i])
    $jobs[$i].PowerShell.Dispose()
  }
  $pool.Close()
  $writtenCount = (@($outs) | Where-Object { $_.Written -eq $true }).Count
  # exactly one writer succeeds; the other must be rejected, not overwriting
  $rejected = (@($outs) | Where-Object { $_.Written -eq $false -and ($_.Reason -eq 'existing_owner_alive' -or $_.Reason -eq 'mutex_timeout') }).Count
  $ok8 = ($writtenCount -eq 1) -and ($rejected -ge 1)
  Record 'E4c-8' 'concurrent claims -> exactly one owner, no double ownership' $ok8 ("writtenCount=$writtenCount rejected=$rejected reasons=$(($outs | ForEach-Object{$_.Reason}) -join ',')")
} finally {
  if (Test-Path $scratch) { Remove-Item -Recurse -Force $scratch }
}

# ===========================================================================
# LIVE read-only probe of the REAL 8022 /login/ (does the fix help production?)
# ===========================================================================
try {
  foreach ($m in @('FDE-AI','csrfmiddlewaretoken')) { } # noop to keep import tidy
  # new (fixed, 2-marker) set
  $hNew = Get-V15CHealthDetailed -Url 'http://127.0.0.1:8022/login/' -Markers @('FDE-AI','csrfmiddlewaretoken')
  # old (buggy, 3-marker) set - to prove the fix is necessary
  $hOld = Get-V15CHealthDetailed -Url 'http://127.0.0.1:8022/login/' -Markers @('FDE-AI','csrfmiddlewaretoken','resend-verification')
  $okLive = ($hNew.AllMarkers -eq $true) -and ($hOld.AllMarkers -eq $false)
  Record 'E4c-LIVE' 'real 8022 /login/ : fixed 2-marker passes, old 3-marker fails' $okLive ("new.AllMarkers=$($hNew.AllMarkers) old.AllMarkers=$($hOld.AllMarkers) status=$($hNew.Status)")
} catch {
  Record 'E4c-LIVE' 'real 8022 /login/ probe' $false ("ERROR: $($_.Exception.Message)")
}

# ---- summary ---------------------------------------------------------------
$pass = @($results | Where-Object { $_.ok }).Count
$fail = @($results | Where-Object { -not $_.ok }).Count
Write-Output ('SUMMARY pass={0} fail={1} total={2}' -f $pass, $fail, $results.Count)

if ($ResultJson) {
  $out = [pscustomobject]@{
    suite      = 'Phase19-E4c'
    pass       = $pass
    fail       = $fail
    total      = $results.Count
    results    = $results
    prod8022_e4c_new = if ($hNew) { $hNew.AllMarkers } else { $null }
    prod8022_e4c_old = if ($hOld) { $hOld.AllMarkers } else { $null }
  }
  [System.IO.File]::WriteAllText($ResultJson, ($out | ConvertTo-Json -Depth 8 -Compress))
  Write-Output ('WROTE ' + $ResultJson)
}

exit $(if ($fail -eq 0) { 0 } else { 1 })
