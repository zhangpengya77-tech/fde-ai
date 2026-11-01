# P3-H Phase 19 close-out: NEGATIVE tests for the endpoint-set listener contract.
#
# Proves the new comparison does NOT mask real anomalies:
#   - single listener is stable
#   - double listener on one tuple is legitimately stable (not a failure)
#   - a genuine endpoint-set change (listener added OR removed) FAILS with a diff
#   - HTTP health failure FAILS
#   - test-port residue FAILS
#   - IPv4/IPv6 mixed endpoints are parsed and compared correctly
#
# All scenarios use injected synthetic netstat/health providers: this script never
# touches real 8022/8770/8030 and is fully deterministic.
#
# ASCII-only on purpose (Windows PowerShell 5.1 misparses non-ASCII .ps1 without BOM).

[CmdletBinding()]
param(
    [string]$ResultJson = ''
)

$ErrorActionPreference = 'Stop'

$here = $PSScriptRoot
if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Path }

. (Join-Path $here 'V15C-ListenerContract.ps1')

$results = New-Object System.Collections.Generic.List[object]
function Record([string]$id, [string]$desc, [bool]$ok, [string]$detail) {
    $script:results.Add([pscustomobject]@{ name = $id; description = $desc; ok = $ok; detail = $detail })
    $mark = if ($ok) { 'PASS' } else { 'FAIL' }
    Write-Output ("[{0}] {1} :: {2} :: {3}" -f $mark, $id, $desc, $detail)
}

# ---- synthetic netstat providers (param($fam) -> lines) --------------------
$provSingle = { param($fam) if ($fam -eq 'tcp') { @('  TCP    127.0.0.1:8770         0.0.0.0:0              LISTENING       111') } else { @() } }
$provDouble = { param($fam) if ($fam -eq 'tcp') { @(
    '  TCP    127.0.0.1:8770         0.0.0.0:0              LISTENING       111',
    '  TCP    127.0.0.1:8770         0.0.0.0:0              LISTENING       222') } else { @() } }
$provMixed  = { param($fam) if ($fam -eq 'tcp') { @('  TCP    127.0.0.1:8770         0.0.0.0:0              LISTENING       111') } else { @('  TCP    [::1]:8770             [::]:0                 LISTENING       222') } }
$provResid  = { param($fam) if ($fam -eq 'tcp') { @('  TCP    127.0.0.1:18031        0.0.0.0:0              LISTENING       999') } else { @() } }
$healthOk   = { param($u) [pscustomobject]@{ Ok = $true;  Status = 200 } }
$healthBad  = { param($u) [pscustomobject]@{ Ok = $false; Status = 0 } }

# ---- N01 single listener ------------------------------------------------
$s1 = @(Get-V15CListenerEndpoints -Port 8770 -NetstatProvider $provSingle)
$c1 = Compare-V15CEndpointSets -Before $s1 -After $s1
Record 'N01' 'single listener -> count=1, stable' (($s1.Count -eq 1) -and $c1.Same) ("count=$($s1.Count) set=[$($s1 -join ',')] same=$($c1.Same)")

# ---- N02 double listener same tuple (legit stable) ----------------------
$s2 = @(Get-V15CListenerEndpoints -Port 8770 -NetstatProvider $provDouble)
$c2 = Compare-V15CEndpointSets -Before $s2 -After $s2
Record 'N02' 'double listener same tuple -> count=2, stable (legit)' (($s2.Count -eq 2) -and $c2.Same) ("count=$($s2.Count) set=[$($s2 -join ',')] same=$($c2.Same)")

# ---- N03 genuine change: listener removed -> detected ------------------
$before3 = @('127.0.0.1:8770:111', '127.0.0.1:8770:222')
$after3 = @(Get-V15CListenerEndpoints -Port 8770 -NetstatProvider $provSingle)
$c3 = Compare-V15CEndpointSets -Before $before3 -After $after3
Record 'N03' 'genuine set change (listener removed) -> detected with diff' ((-not $c3.Same) -and ($c3.Removed -contains '127.0.0.1:8770:222') -and ($c3.Added.Count -eq 0)) ("same=$($c3.Same) $($c3.DiffText)")

# ---- N03b genuine change: listener added -> detected -------------------
$c3b = Compare-V15CEndpointSets -Before @('127.0.0.1:8770:111') -After @('127.0.0.1:8770:111', '127.0.0.1:8770:333')
Record 'N03b' 'genuine set change (listener added) -> detected with diff' ((-not $c3b.Same) -and ($c3b.Added -contains '127.0.0.1:8770:333') -and ($c3b.Removed.Count -eq 0)) ("same=$($c3b.Same) $($c3b.DiffText)")

# ---- N04 HTTP health failure -> contract fails -------------------------
$t4 = Test-V15CListenerContract -Port 8770 -Before $s1 -TestPorts @() -HealthUrl 'http://x/health' -NetstatProvider $provSingle -HealthProvider $healthBad
Record 'N04' '8770 health failure -> contract fails' ((-not $t4.Ok) -and (-not $t4.HealthOk)) ("ok=$($t4.Ok) same=$($t4.Same) healthOk=$($t4.HealthOk) status=$($t4.HealthStatus)")

# ---- N05 test-port residue -> contract fails ---------------------------
$t5 = Test-V15CListenerContract -Port 8770 -Before @() -TestPorts @(18031) -HealthUrl 'http://x/health' -NetstatProvider $provResid -HealthProvider $healthOk
Record 'N05' 'test port residue -> contract fails' ((-not $t5.Ok) -and ($t5.LeakedTestPorts -contains 18031)) ("ok=$($t5.Ok) leaked=[$($t5.LeakedTestPorts -join ',')]")

# ---- N06 IPv4/IPv6 mixed endpoints parsed & stable ---------------------
$s6 = @(Get-V15CListenerEndpoints -Port 8770 -NetstatProvider $provMixed)
$c6 = Compare-V15CEndpointSets -Before $s6 -After $s6
$hasV4 = ($s6 -contains '127.0.0.1:8770:111')
$hasV6 = ($s6 -contains '[::1]:8770:222')
Record 'N06' 'IPv4/IPv6 mixed endpoints parsed & stable' (($s6.Count -eq 2) -and $hasV4 -and $hasV6 -and $c6.Same) ("count=$($s6.Count) set=[$($s6 -join ',')] v4=$hasV4 v6=$hasV6 same=$($c6.Same)")

# ---- N07 positive control: stable + health ok + no leak -> Ok ----------
$t7 = Test-V15CListenerContract -Port 8770 -Before $s1 -TestPorts @(18031) -HealthUrl 'http://x/health' -NetstatProvider $provSingle -HealthProvider $healthOk
Record 'N07' 'positive control: stable set + health ok + no leak -> Ok=True' ($t7.Ok -and $t7.Same -and $t7.HealthOk -and (@($t7.LeakedTestPorts).Count -eq 0)) ("ok=$($t7.Ok) same=$($t7.Same) health=$($t7.HealthOk) leaked=[$($t7.LeakedTestPorts -join ',')]")

# ---- N08 set change NOT masked by a healthy check ----------------------
$t8 = Test-V15CListenerContract -Port 8770 -Before $before3 -TestPorts @(18031) -HealthUrl 'http://x/health' -NetstatProvider $provSingle -HealthProvider $healthOk
Record 'N08' 'set change not masked by healthy check -> fails' ((-not $t8.Ok) -and (-not $t8.Same)) ("ok=$($t8.Ok) same=$($t8.Same) $($t8.DiffText)")

# ---- summary -----------------------------------------------------------
$pass = @($results | Where-Object { $_.ok }).Count
$fail = @($results | Where-Object { -not $_.ok }).Count
Write-Output ('SUMMARY pass={0} fail={1} total={2}' -f $pass, $fail, $results.Count)

if ($ResultJson) {
    $out = [pscustomobject]@{
        suite   = 'Phase19-ListenerContract-Negative'
        pass    = $pass
        fail    = $fail
        total   = $results.Count
        results = $results
    }
    [System.IO.File]::WriteAllText($ResultJson, ($out | ConvertTo-Json -Depth 8 -Compress))
    Write-Output ('WROTE ' + $ResultJson)
}

exit $(if ($fail -eq 0) { 0 } else { 1 })
