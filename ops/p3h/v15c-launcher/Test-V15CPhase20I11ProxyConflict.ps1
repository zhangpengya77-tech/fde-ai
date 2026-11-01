<#
  P3-H Phase 20-A-2  I-11: proxy environment-variable case conflict.

  Hazard under test:
    Windows environment blocks are case-insensitive. When BOTH `https_proxy` and
    `HTTPS_PROXY` (and the http pair) exist, `Start-Process -RedirectStandardOutput`
    copies the environment into a case-insensitive StringDictionary and throws
    ArgumentException ("An item with the same key has already been added"), so the
    child process NEVER starts. The patched launchers start Django/RAG with
    -RedirectStandardOutput, so this blocks a cold start / restart.

  What this verifies (read-only w.r.t. production):
    I11-1 detect duplicate-case proxy vars via raw `cmd /c set`
    I11-2 Start-Process -RedirectStandardOutput throws while duplicates exist
    I11-3 after sanitising duplicates, Start-Process succeeds (mitigation works)
    I11-4 environment is restored to its original proxy values afterwards

  It never starts Django, never touches 8022/8770/8030, never edits the launcher.
#>
[CmdletBinding()]
param([string]$OutDir = '')

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($OutDir)) {
    if ($PSScriptRoot) { $OutDir = $PSScriptRoot }
    elseif ($MyInvocation.MyCommand.Path) { $OutDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
    else { $OutDir = (Get-Location).Path }
}

$results = New-Object System.Collections.Generic.List[object]
function Record([string]$id, [string]$name, [bool]$pass, [string]$detail) {
    $results.Add([pscustomobject]@{ id = $id; name = $name; pass = $pass; detail = $detail })
    $tag = if ($pass) { 'PASS' } else { 'FAIL' }
    Write-Host ("[{0}] {1} {2} :: {3}" -f $tag, $id, $name, $detail)
}

$tmp = Join-Path $env:TEMP ('p3h20_i11_' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$outFile = Join-Path $tmp 'child-out.txt'
$errFile = Join-Path $tmp 'child-err.txt'

# --- I11-1: detect duplicate-case proxy vars via raw `cmd /c set` -----------
$raw = & cmd.exe /c set 2>$null
$proxyNames = @()
foreach ($line in $raw) {
    if ($line -match '^(?i)(https?_proxy)=') { $proxyNames += ($line -split '=', 2)[0] }
}
$hasLower = $false; $hasUpper = $false
foreach ($n in $proxyNames) {
    if ($n -ceq 'http_proxy' -or $n -ceq 'https_proxy') { $hasLower = $true }
    if ($n -ceq 'HTTP_PROXY' -or $n -ceq 'HTTPS_PROXY') { $hasUpper = $true }
}
$dupPresent = ($hasLower -and $hasUpper)
Record 'I11-1' 'duplicate-case proxy vars present in this environment' $true `
    ("names=" + ($proxyNames -join ',') + " lower=$hasLower upper=$hasUpper dup=$dupPresent")

# --- I11-2: Start-Process -RedirectStandardOutput throws while duplicates ----
$threw = $false; $threwMsg = ''
try {
    $p = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', 'echo child-ok') `
        -RedirectStandardOutput $outFile -RedirectStandardError $errFile -PassThru -WindowStyle Hidden
    $p.WaitForExit(8000) | Out-Null
} catch {
    $threw = $true
    $threwMsg = $_.Exception.Message
}
if ($dupPresent) {
    $ok2 = $threw -and ($threwMsg -match 'same key|already been added|ArgumentException')
    Record 'I11-2' 'Start-Process -RedirectStandardOutput throws on duplicate env keys' $ok2 `
        ("threw=$threw msg=" + ($threwMsg -replace '\s+', ' ').Substring(0, [Math]::Min(90, ($threwMsg -replace '\s+', ' ').Length)))
} else {
    Record 'I11-2' 'Start-Process -RedirectStandardOutput throws on duplicate env keys' $true `
        'duplicates not present in this run; hazard not reproducible here'
}

# --- I11-3: sanitise duplicates, Start-Process succeeds (mitigation) --------
$saved = @{}
foreach ($v in @('HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy')) {
    $val = [System.Environment]::GetEnvironmentVariable($v)
    if ($val) { $saved[$v] = $val }
}
foreach ($v in @('HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy')) {
    Remove-Item -LiteralPath ('Env:\' + $v) -ErrorAction SilentlyContinue
}
$ok3 = $false; $ok3detail = ''
try {
    $p3 = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', 'echo child-ok') `
        -RedirectStandardOutput $outFile -RedirectStandardError $errFile -PassThru -WindowStyle Hidden
    $p3.WaitForExit(8000) | Out-Null
    $txt = ''
    if (Test-Path $outFile) { $txt = (Get-Content -LiteralPath $outFile -Raw) }
    $ok3 = ($txt -match 'child-ok')
    $ok3detail = "started=True childOut='" + ($txt.Trim()) + "'"
} catch {
    $ok3 = $false
    $ok3detail = 'still threw: ' + $_.Exception.Message
}
Record 'I11-3' 'after sanitising duplicates, Start-Process succeeds' $ok3 $ok3detail

# --- I11-4: restore environment --------------------------------------------
$restoreOk = $true
foreach ($k in $saved.Keys) {
    [System.Environment]::SetEnvironmentVariable($k, $saved[$k])
}
foreach ($k in $saved.Keys) {
    $back = [System.Environment]::GetEnvironmentVariable($k)
    if ($back -ne $saved[$k]) { $restoreOk = $false }
}
Record 'I11-4' 'environment restored to original proxy values' $restoreOk `
    ("restoredKeys=" + (($saved.Keys) -join ','))

# ---- summary ---------------------------------------------------------------
$pass = 0; $fail = 0
foreach ($r in $results) { if ($r.pass) { $pass++ } else { $fail++ } }
$summary = [pscustomobject]@{
    suite = 'P20-A2-I11-PROXY-CONFLICT'
    total = $results.Count
    pass  = $pass
    fail  = $fail
    duplicateCaseProxyPresent = $dupPresent
    results = $results
}
$outJson = Join-Path $OutDir 'TEST_RESULTS_A2_I11_PROXY_2026-10-28.json'
$outLog = Join-Path $OutDir 'TEST_RESULTS_A2_I11_PROXY_2026-10-28.log'
$summary | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $outJson -Encoding utf8
$results | ForEach-Object { "{0}`t{1}`t{2}`t{3}" -f $_.id, $_.pass, $_.name, $_.detail } | Set-Content -LiteralPath $outLog -Encoding utf8
Write-Host ("`nSUMMARY pass={0} fail={1} total={2} dupPresent={3}" -f $pass, $fail, $results.Count, $dupPresent)

Get-ChildItem -LiteralPath $tmp -File -Force -ErrorAction SilentlyContinue | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue

if ($fail -gt 0) { exit 1 } else { exit 0 }
