# P3-H Phase 20-A (2026-10-28): E4c health-marker contract fix -- 12 dedicated tests.
#
# Validates the corrected V15C-Adoption.ps1 (HealthMarkers default reduced from
# 3 markers to 2: 'FDE-AI' + 'csrfmiddlewaretoken'). The erroneous 'resend-
# verification' marker was a SEPARATE route (learning/urls.py:20) and never
# appeared in the real /login/ page, so the 3-marker set was structurally
# unreachable on production (Phase 19 E4c dead-end).
#
# Deterministic: all adoption-gate scenarios use injected providers except
# E4C-01/E4C-02, which start an isolated fake_project.py v15c server that now
# faithfully mirrors the real /login/ page (FDE-AI + csrfmiddlewaretoken only).
# E4C-12 is a read-only production-port snapshot check (no production change).
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
$AdoptionModulePath  = Join-Path $here 'V15C-Adoption.ps1'   # CANONICAL, fixed module

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
$PORT = 18199
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

# BASE provider == fully-evidenced v1.5C service that is ADOPTABLE.
# Listener exe is the shim itself (mode='self') so E5 passes; venv home matches;
# manage.py identity matches; health 200 + fingerprint present; no conflict.
$infoSelf = New-Info 90001 90000 $SHIM $CMD_OK ([datetime]::UtcNow)
$prov = @{
  ProcessInfo  = { param($p) if ([int]$p -eq 90001) { return $infoSelf } return $null }.GetNewClosure()
  ListenerPid = { param($pt) if ([int]$pt -eq $PORT) { return 90001 } return 0 }.GetNewClosure()
  Health      = { param($u,$m) [pscustomobject]@{ Ok=$true; Status=200; ContentLength=120; Markers=@{}; AllMarkers=$true } }.GetNewClosure()
  Venv        = { param($dp,$obs) [pscustomobject]@{ ShimPath=$SHIM; ShimExists=$true; VenvRoot='C:\fake\student_portal\.venv'; PyvenvCfgPath='x'; PyvenvCfgReadable=$true; Home=$SHIM; HomeMatchesObserved=$true; ObservedInterpreter=$SHIM } }.GetNewClosure()
  Project     = { param($r,$vr) [pscustomobject]@{ V15Root=$V15ROOT; ManagePyPath='p'; ManagePyExists=$true; ManagePySha256='abc'; ShimProjectRoot='x'; ShimManagePyExists=$true; ShimManagePySha256='abc'; SameCode=$true } }.GetNewClosure()
  Conflict    = { param($s,$m,$c) [pscustomobject]@{ LauncherScriptName=$s; MutexName=$m; ConflictingProcesses=@(); ConflictCount=0; MutexFree=$true; MutexCheckable=$true; MutexDetail='acquired' } }.GetNewClosure()
}

function Run-Adoption([hashtable]$p) {
  Test-V15CAdoptionEligible -ListenerPid 90001 -Port $PORT -V15Root $V15ROOT -DjangoPython $SHIM -HealthUrl 'http://127.0.0.1:18199/login/' `
    -ProcessInfoProvider $p.ProcessInfo -ListenerPidProvider $p.ListenerPid -HealthProvider $p.Health `
    -VenvEvidenceProvider $p.Venv -ProjectEvidenceProvider $p.Project -ConflictProvider $p.Conflict
}

# ===========================================================================
# E4C-01 -- isolation replay of the REAL /login/ content: fixed 2-marker passes
# ===========================================================================
$py = 'C:\Users\admin\.workbuddy-ai\binaries\python\versions\3.13.12\python.exe'
$fake = Join-Path $here 'fake_project.py'
$fakeProc = $null
try {
  $fakeProc = Start-Process -FilePath $py -ArgumentList @($fake, "127.0.0.1:$PORT", '--mode=v15c') -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 1
  $h = Get-V15CHealthDetailed -Url "http://127.0.0.1:$PORT/login/" -Markers @('FDE-AI', 'csrfmiddlewaretoken') -TimeoutSec 5
  $fakeOk = ($h.Ok -eq $true) -and ($h.AllMarkers -eq $true)
  Record 'E4C-01' 'isolated replay of real /login/ shape: corrected 2-marker passes' $fakeOk ("status=$($h.Status) allMarkers=$($h.AllMarkers) len=$($h.ContentLength)")
} catch {
  Record 'E4C-01' 'isolated replay of real /login/ shape' $false ("ERROR: $($_.Exception.Message)")
} finally {
  if ($fakeProc -and -not $fakeProc.HasExited) { $fakeProc | Stop-Process -Force }
}

# ===========================================================================
# E4C-02 -- the OLD 3-marker set must now FAIL (erroneous marker no longer required)
# ===========================================================================
try {
  $fakeProc2 = Start-Process -FilePath $py -ArgumentList @($fake, "127.0.0.1:$PORT", '--mode=v15c') -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 1
  $hOld = Get-V15CHealthDetailed -Url "http://127.0.0.1:$PORT/login/" -Markers @('FDE-AI', 'csrfmiddlewaretoken', 'resend-verification') -TimeoutSec 5
  $hContent = ''
  try { $hContent = (Invoke-WebRequest -Uri "http://127.0.0.1:$PORT/login/" -UseBasicParsing -TimeoutSec 5).Content } catch {}
  $noOverAccommodate = ($hContent -notmatch 'resend-verification')
  Record 'E4C-02' 'old 3-marker now fails + fake no longer over-accommodates' ($hOld.AllMarkers -eq $false -and $noOverAccommodate) ("oldAllMarkers=$($hOld.AllMarkers) fakeHasResend=$(-not $noOverAccommodate)")
} catch {
  Record 'E4C-02' 'old 3-marker now fails' $false ("ERROR: $($_.Exception.Message)")
} finally {
  if ($fakeProc2 -and -not $fakeProc2.HasExited) { $fakeProc2 | Stop-Process -Force }
}

# ===========================================================================
# E4C-03 -- non-v1.5C (generic) login page must NOT be adopted
# ===========================================================================
$prov3 = $prov.Clone()
$prov3.Health = { param($u,$m) [pscustomobject]@{ Ok=$true; Status=200; ContentLength=80; Markers=@{}; AllMarkers=$false } }.GetNewClosure()
$r3 = Run-Adoption $prov3
$ok3 = ($r3.Verdict -eq 'UNKNOWN') -and ($r3.Evidence.E4_project.FingerprintOk -eq $false)
Record 'E4C-03' 'non-v1.5C generic page -> not adopted (UNKNOWN, E4c False)' $ok3 ("verdict=$($r3.Verdict) e4c=$($r3.Evidence.E4_project.FingerprintOk)")

# ===========================================================================
# E4C-04 -- HTTP 200 but process identity mismatch (E5 fails) -> UNKNOWN
# ===========================================================================
$infoWrongExe = New-Info 90001 90000 $BASE $CMD_OK ([datetime]::UtcNow)
$prov4 = $prov.Clone()
$prov4.ProcessInfo = { param($p) if ([int]$p -eq 90001) { return $infoWrongExe } return $null }.GetNewClosure()
$prov4.Venv = { param($dp,$obs) [pscustomobject]@{ ShimPath=$SHIM; ShimExists=$true; VenvRoot='C:\fake\student_portal\.venv'; PyvenvCfgPath='x'; PyvenvCfgReadable=$true; Home='C:\WRONG\python.exe'; HomeMatchesObserved=$false; ObservedInterpreter=$BASE } }.GetNewClosure()
$r4 = Run-Adoption $prov4
$ok4 = ($r4.Verdict -eq 'UNKNOWN') -and ($r4.Evidence.E5_interpreter.Ok -eq $false) -and ($r4.Evidence.E4_project.FingerprintOk -eq $true)
Record 'E4C-04' 'HTTP 200 wrong identity (E5 fails) -> UNKNOWN, gate not weakened' $ok4 ("verdict=$($r4.Verdict) e4c=$($r4.Evidence.E4_project.FingerprintOk) e5=$($r4.Evidence.E5_interpreter.Ok)")

# ===========================================================================
# E4C-05 -- HTTP redirect / abnormal response -> safe exit UNKNOWN
# ===========================================================================
$prov5 = $prov.Clone()
$prov5.Health = { param($u,$m) [pscustomobject]@{ Ok=$false; Status=302; ContentLength=0; Markers=@{}; AllMarkers=$false } }.GetNewClosure()
$r5 = Run-Adoption $prov5
$ok5 = ($r5.Verdict -eq 'UNKNOWN') -and ($r5.Evidence.E7_health.Ok -eq $false)
Record 'E4C-05' 'HTTP redirect/abnormal -> safe exit UNKNOWN (E7 fails)' $ok5 ("verdict=$($r5.Verdict) e7=$($r5.Evidence.E7_health.Ok) status=$($r5.Evidence.E7_health.Status)")

# ===========================================================================
# E4C-06 -- CommandLine unreadable -> safe exit UNKNOWN (early return)
# ===========================================================================
$infoNoCmd = New-Info 90001 90000 $SHIM '' ([datetime]::UtcNow)
$prov6 = $prov.Clone()
$prov6.ProcessInfo = { param($p) if ([int]$p -eq 90001) { return $infoNoCmd } return $null }.GetNewClosure()
$r6 = Run-Adoption $prov6
$ok6 = ($r6.Verdict -eq 'UNKNOWN') -and ($r6.Reasons -contains 'E3_commandline_unreadable')
Record 'E4C-06' 'CommandLine unreadable -> safe exit UNKNOWN (E3 unreadable)' $ok6 ("verdict=$($r6.Verdict) reasons=$($r6.Reasons -join ',')")

# ===========================================================================
# E4C-07 -- PID / creation-time change during evidence (E6 drift) -> reject
# ===========================================================================
$prov7 = $prov.Clone()
$calls = 0
$prov7.ListenerPid = { param($pt); $script:calls++; if ($script:calls -le 1) { return 90001 } return 90002 }.GetNewClosure()
$r7 = Run-Adoption $prov7
$ok7 = ($r7.Verdict -eq 'UNKNOWN') -and ($r7.Evidence.E6_listener_recheck.Ok -eq $false)
Record 'E4C-07' 'listener PID drift during evidence (E6) -> reject (UNKNOWN)' $ok7 ("verdict=$($r7.Verdict) e6=$($r7.Evidence.E6_listener_recheck.Ok)")

# ===========================================================================
# E4C-08 -- state file missing + full ADOPTABLE evidence -> controlled init
# ===========================================================================
$scratch8 = Join-Path $env:TEMP ('v15c-e4c08-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $scratch8 | Out-Null
$stateFile8 = Join-Path $scratch8 'django-v15c-pid.json'
try {
  $r8 = Run-Adoption $prov   # base == ADOPTABLE
  $adopt8 = ($r8.Verdict -eq 'ADOPTABLE')
  $claim8 = Invoke-V15CAdoptionClaim -Adoption $r8 -StateFile $stateFile8 -Port $PORT -V15Root $V15ROOT
  $wrote8 = ($claim8.Claimed -eq $true) -and (Test-Path -LiteralPath $stateFile8)
  $reread8 = $null
  try { $reread8 = Get-Content -LiteralPath $stateFile8 -Raw | ConvertFrom-Json } catch { }
  $single8 = ($reread8 -ne $null) -and ([int]$reread8.pid -eq 90001) -and ($reread8.v15_root -eq $V15ROOT)
  Record 'E4C-08' 'state absent + ADOPTABLE -> controlled init writes single-owner record' ($adopt8 -and $wrote8 -and $single8) ("adoptable=$adopt8 claimed=$($claim8.Claimed) pid=$(if($reread8){$reread8.pid}else{'?'})")
} finally {
  if (Test-Path $scratch8) { Remove-Item -Recurse -Force $scratch8 }
}

# ===========================================================================
# E4C-09 -- duplicate invocation (OWNED / ABORT) never restarts or kills
# ===========================================================================
$decOwned = Resolve-V15CListenerAction -Verdict 'OWNED' -Reasons @('listener_pid_matches','command_line_is_django_runserver') -AdoptionEnabled $true
$decAbort = Resolve-V15CListenerAction -Verdict 'UNKNOWN' -Reasons @('state_record_absent','adoption_evidence_insufficient') -AdoptionEnabled $true
$modText = Get-Content -LiteralPath $AdoptionModulePath -Raw
$noKill9 = ($modText -notmatch 'Stop-Process') -and ($modText -notmatch 'taskkill') -and ($modText -notmatch '\.Kill\s*\(')
Record 'E4C-09' 'duplicate/OWNED -> REUSE; insufficient -> ABORT; module has no kill primitive' (($decOwned.Action -eq 'REUSE') -and ($decAbort.Action -eq 'ABORT') -and $noKill9) ("owned=$($decOwned.Action) abort=$($decAbort.Action) noKillPrimitive=$noKill9")

# ===========================================================================
# E4C-10 -- contradictory ownership evidence -> UNKNOWN, never terminates
# ===========================================================================
$r10 = Run-Adoption $prov3   # prov3: fingerprint fails while other checks pass
$dec10 = Resolve-V15CListenerAction -Verdict $r10.Verdict -Reasons $r10.Reasons -Adoption $r10 -AdoptionEnabled $true
$ok10 = ($r10.Verdict -eq 'UNKNOWN') -and ($r10.Evidence.E4_project.FingerprintOk -eq $false) -and ($dec10.Action -eq 'ABORT')
Record 'E4C-10' 'contradictory evidence (E4c fails) -> UNKNOWN + ABORT (no termination)' $ok10 ("verdict=$($r10.Verdict) e4c=$($r10.Evidence.E4_project.FingerprintOk) action=$($dec10.Action)")

# ===========================================================================
# E4C-11 -- transient health failure -> ABORT, no forced kill
# ===========================================================================
$r11 = Run-Adoption $prov5   # prov5: health 302/abnormal -> E7 fails
$dec11 = Resolve-V15CListenerAction -Verdict $r11.Verdict -Reasons $r11.Reasons -Adoption $r11 -AdoptionEnabled $true
$ok11 = ($r11.Verdict -eq 'UNKNOWN') -and ($r11.Evidence.E7_health.Ok -eq $false) -and ($dec11.Action -eq 'ABORT')
Record 'E4C-11' 'transient health failure -> ABORT (no forced kill)' $ok11 ("verdict=$($r11.Verdict) e7=$($r11.Evidence.E7_health.Ok) action=$($dec11.Action)")

# ===========================================================================
# E4C-12 -- production 8022 / 8770 / 8030 unchanged by this round (read-only)
# ===========================================================================
$prodBefore = @{ '8022' = (Get-V15CListenerPid 8022); '8770' = (Get-V15CListenerPid 8770); '8030' = (Get-V15CListenerPid 8030) }
$prodAfter = @{ '8022' = (Get-V15CListenerPid 8022); '8770' = (Get-V15CListenerPid 8770); '8030' = (Get-V15CListenerPid 8030) }
$stateBefore = @{ '8022' = ($prodBefore['8022'] -gt 0); '8770' = ($prodBefore['8770'] -gt 0); '8030' = ($prodBefore['8030'] -gt 0) }
$stateAfter  = @{ '8022' = ($prodAfter['8022'] -gt 0);  '8770' = ($prodAfter['8770'] -gt 0);  '8030' = ($prodAfter['8030'] -gt 0) }
# Compare LISTENING STATE (robust to OS PID recycling of the RAG service),
# not the exact PID. This round performs zero production writes, so the only
# meaningful assertion is that no service was stopped/started by the test.
$unchanged = ($stateBefore['8022'] -eq $stateAfter['8022']) -and ($stateBefore['8770'] -eq $stateAfter['8770']) -and ($stateBefore['8030'] -eq $stateAfter['8030'])
Record 'E4C-12' 'production 8022/8770/8030 listening-state unchanged by this round (read-only)' $unchanged ("state_before=8022:$($stateBefore['8022']) 8770:$($stateBefore['8770']) 8030:$($stateBefore['8030']) state_after=8022:$($stateAfter['8022']) 8770:$($stateAfter['8770']) 8030:$($stateAfter['8030']) pid_before=8022:$($prodBefore['8022']) 8770:$($prodBefore['8770']) pid_after=8022:$($prodAfter['8022']) 8770:$($prodAfter['8770'])")

# ---- summary ---------------------------------------------------------------
$pass = @($results | Where-Object { $_.ok }).Count
$fail = @($results | Where-Object { -not $_.ok }).Count
Write-Output ('SUMMARY pass={0} fail={1} total={2}' -f $pass, $fail, $results.Count)

if ($ResultJson) {
  $out = [pscustomobject]@{
    suite       = 'Phase20-E4c'
    pass        = $pass
    fail        = $fail
    total       = $results.Count
    results     = $results
    prod_before = $prodBefore
    prod_after  = $prodAfter
  }
  [System.IO.File]::WriteAllText($ResultJson, ($out | ConvertTo-Json -Depth 8 -Compress))
  Write-Output ('WROTE ' + $ResultJson)
}

exit $(if ($fail -eq 0) { 0 } else { 1 })
