# P3-H Phase 19 close-out: listener endpoint-set contract helpers.
#
# Purpose
#   Replace the unreliable "8770 listener PID before == PID after" check.
#   In a dual-listener environment (two processes LISTEN on the same IPv4 tuple,
#   e.g. Windows SO_REUSEADDR), Get-NetTCPConnection returns only ONE of the
#   duplicate rows and the row it returns is not stable across calls. Comparing a
#   single PID is therefore meaningless. Instead we enumerate the FULL endpoint
#   set (IPv4 + IPv6) from netstat and compare the sets.
#
# Rules
#   - Read-only. Never terminates or starts any process.
#   - Never uses "Select-Object -First 1" to decide complete listener state.
#   - A genuine endpoint-set change MUST surface as a failure with the diff.
#
# ASCII-only on purpose (Windows PowerShell 5.1 misparses non-ASCII .ps1 without BOM).

function Get-V15CListenerEndpoints {
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [scriptblock]$NetstatProvider = $null
    )
    # Returns a sorted, unique array of "address:port:pid" for every LISTENING row
    # on $Port across IPv4 (tcp) and IPv6 (tcpv6).
    $run = if ($NetstatProvider) { $NetstatProvider } else { { param($fam) & netstat -ano -p $fam 2>$null } }
    $set = New-Object System.Collections.Generic.List[string]
    foreach ($fam in @('tcp', 'tcpv6')) {
        $out = & $run $fam
        foreach ($line in @($out)) {
            $s = ([string]$line).Trim()
            if (-not $s) { continue }
            $parts = $s -split '\s+'
            if ($parts.Count -lt 5) { continue }
            # netstat columns: Proto  LocalAddress  ForeignAddress  State  PID
            if ($parts[3] -ne 'LISTENING') { continue }
            $local = [string]$parts[1]
            $idx = $local.LastIndexOf(':')
            if ($idx -lt 0) { continue }
            $lport = $local.Substring($idx + 1)
            if ($lport -ne [string]$Port) { continue }
            $addr = $local.Substring(0, $idx)
            $epPid = [string]$parts[$parts.Count - 1]
            $set.Add(("{0}:{1}:{2}" -f $addr, $lport, $epPid))
        }
    }
    return @($set | Sort-Object -Unique)
}

function Compare-V15CEndpointSets {
    param(
        [string[]]$Before = @(),
        [string[]]$After = @()
    )
    $b = @(@($Before) | Sort-Object -Unique)
    $a = @(@($After) | Sort-Object -Unique)
    $added = @($a | Where-Object { $b -notcontains $_ })
    $removed = @($b | Where-Object { $a -notcontains $_ })
    return [pscustomobject]@{
        Same     = (($added.Count -eq 0) -and ($removed.Count -eq 0))
        Before   = $b
        After    = $a
        Added    = $added
        Removed  = $removed
        DiffText = ("added=[{0}] removed=[{1}]" -f ($added -join ','), ($removed -join ','))
    }
}

function Test-V15CListenerContract {
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [string[]]$Before = @(),
        [int[]]$TestPorts = @(),
        [string]$HealthUrl = '',
        [scriptblock]$NetstatProvider = $null,
        [scriptblock]$HealthProvider = $null
    )
    # Composite contract:
    #   (1) full endpoint set for $Port unchanged vs $Before
    #   (2) $Port HTTP health succeeds (if HealthUrl/HealthProvider given)
    #   (3) every $TestPorts entry has zero listeners (released)
    $after = Get-V15CListenerEndpoints -Port $Port -NetstatProvider $NetstatProvider
    $cmp = Compare-V15CEndpointSets -Before $Before -After $after

    $healthOk = $true
    $healthStatus = $null
    if ($HealthProvider) {
        $h = & $HealthProvider $HealthUrl
        $healthOk = [bool]$h.Ok
        $healthStatus = $h.Status
    } elseif ($HealthUrl) {
        try {
            $r = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 5
            $healthStatus = [int]$r.StatusCode
            $healthOk = ($healthStatus -ge 200 -and $healthStatus -lt 400)
        } catch {
            $healthOk = $false
            $healthStatus = 0
        }
    }

    $leaked = @()
    foreach ($tp in @($TestPorts)) {
        $eps = Get-V15CListenerEndpoints -Port ([int]$tp) -NetstatProvider $NetstatProvider
        if (@($eps).Count -gt 0) { $leaked += [int]$tp }
    }

    return [pscustomobject]@{
        Ok             = ($cmp.Same -and $healthOk -and ($leaked.Count -eq 0))
        Same           = $cmp.Same
        Added          = $cmp.Added
        Removed        = $cmp.Removed
        DiffText       = $cmp.DiffText
        Before         = $cmp.Before
        After          = $cmp.After
        HealthOk       = $healthOk
        HealthStatus   = $healthStatus
        LeakedTestPorts = $leaked
    }
}
