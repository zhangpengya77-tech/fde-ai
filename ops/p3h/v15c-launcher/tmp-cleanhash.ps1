$files = @('V15C-Adoption.e4c.ps1','V15C-Adoption.ps1','E3-elevated-probe.ps1','Test-V15CPhase19FaultMatrix.ps1','V15C-Ownership.ps1')
foreach ($f in $files) {
    $h = (Get-FileHash -Algorithm SHA256 $f).Hash.ToLower()
    Write-Output ($f + '  ' + $h)
}
$b = [System.IO.File]::ReadAllBytes('E3-elevated-probe.ps1')
$idx = @()
for ($i = 0; $i -lt $b.Length; $i++) { if ($b[$i] -gt 127) { $idx += $i } }
Write-Output ('E3 nonASCII indices: ' + ($idx -join ','))
if ($idx.Count -gt 0) {
    foreach ($i in $idx) {
        $lo = [Math]::Max(0, $i - 10)
        $hi = [Math]::Min($b.Length - 1, $i + 10)
        $ctx = -join ($b[$lo..$hi] | ForEach-Object { if ($_ -lt 32 -or $_ -gt 126) { '.' } else { [char]$_ } })
        Write-Output ('  at ' + $i + ': ' + $ctx)
    }
}
