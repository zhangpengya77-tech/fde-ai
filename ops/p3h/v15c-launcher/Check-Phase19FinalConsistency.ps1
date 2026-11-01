# Phase 19 Final Consistency Check (authorized B)
# Read-only: SHA-256, PS5.1 syntax (AST), BOM/non-ASCII, compare to recorded hashes.
$dir = 'D:\FDE-AI-UAS-v2.0-p3h-local-backend\ops\p3h\v15c-launcher'
$expected = @{
    'V15C-Ownership.ps1'                  = 'adf7f8ecd6bcdaf3d5bd013569c9c6231f0e7f16bf64675a83b0042391b03ec8'
    'V15C-Adoption.e4c.ps1'               = '229267988d8668ba8be71bc656c85625e4bad8867c6fc80a5c4fd7c416ebb64c74fe9'
    'V15C-Adoption.ps1'                   = '229267988d8668ba8be71bc656c85625e4bad8867c6fc80a5c4fd7c416ebb64c74fe9'
    'start_fde_v15c_classroom.original.ps1' = 'a64330ef7a31e6c981fba95117466610af5e5db833d1ddafc8d91dba1c7a7b59'
    'start_fde_v15c_classroom.patched-v3.ps1' = $null  # prefix known bc57751349551959
    'PATCH-v3.diff'                        = $null  # prefix known c24d3854f5e082bf
    'Test-V15CLauncherOwnership.ps1'       = '3157570af27511413eb4a4273583717ba38b66a62b4c6cd81c661375b73cd031'
    'Test-V15CPhase19FaultMatrix.ps1'      = '631c0d300049076b78e2847aa66f0f87c05b938f49746deb84350aa14ac39adf6'
    'Test-V15CPhase19E4c.supp.ps1'         = '5cf3ea454586b1b97892bd5bff3b0cb65bc67a1d0b2085e84b0e0be6c7d6e01b'
    'E3-elevated-probe.ps1'                = 'b037a4ac176bd78c8cf74323cc4b37ffa06ce3daff8bb08f121a631d6b65bf7'
}

$psFiles = @('V15C-Ownership.ps1','V15C-Adoption.e4c.ps1','V15C-Adoption.ps1',
             'start_fde_v15c_classroom.original.ps1','start_fde_v15c_classroom.patched-v3.ps1',
             'Test-V15CLauncherOwnership.ps1','Test-V15CPhase19FaultMatrix.ps1',
             'Test-V15CPhase19E4c.supp.ps1','E3-elevated-probe.ps1')

$results = @()
foreach ($name in ($expected.Keys + @('PATCH-v3.diff'))) {
    $path = Join-Path $dir $name
    $item = [ordered]@{ file = $name; exists = (Test-Path $path) }
    if (-not (Test-Path $path)) { $results += $item; continue }
    $bytes = [System.IO.File]::ReadAllBytes($path)
    $sha = (Get-FileHash -Algorithm SHA256 -Path $path).Hash.ToLower()
    $item['size'] = $bytes.Length
    $item['sha256'] = $sha
    # BOM / non-ASCII
    $bom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
    $nonAscii = 0
    foreach ($b in $bytes) { if ($b -gt 127) { $nonAscii++ } }
    $item['bom'] = $bom
    $item['nonAsciiBytes'] = $nonAscii
    # syntax (PS files only)
    if ($psFiles -contains $name) {
        $tok = $null; $errs = $null
        try {
            [void][System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tok, [ref]$errs)
            $item['ps51SyntaxErrors'] = $errs.Count
            $item['ps51SyntaxOk'] = ($errs.Count -eq 0)
        } catch {
            $item['ps51SyntaxOk'] = $false
            $item['ps51SyntaxErrors'] = 'parse-exception: ' + $_.Exception.Message
        }
    }
    # compare
    if ($expected[$name]) {
        $item['expectedSha'] = $expected[$name]
        $item['hashMatch'] = ($sha -eq $expected[$name])
    } else {
        $item['expectedSha'] = 'prefix-only'
        $item['hashMatch'] = 'PREFIX:' + $sha.Substring(0,16)
    }
    $results += $item
}
$out = [ordered]@{
    checkedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    fileCount = $results.Count
    anyHashMismatch = ($results | Where-Object { $_.Contains('hashMatch') -and $_.hashMatch -eq $false }).Count -gt 0
    results = $results
}
$out | ConvertTo-Json -Depth 5
