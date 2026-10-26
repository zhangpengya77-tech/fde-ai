$ErrorActionPreference = 'Stop'
$root = Join-Path $env:TEMP 'fde-p3h-wrapper-test'
$wrapper = Join-Path $PSScriptRoot 'invoke-p3h-django.ps1'

$bad = & $wrapper -CandidateRoot 'relative-path' -DryRun check 2>&1
if ($LASTEXITCODE -eq 0 -or ($bad -join "`n") -notmatch 'absolute') { throw 'ASSERTION FAILED: relative CandidateRoot must fail closed.' }

$ok = & $wrapper -CandidateRoot $root -DryRun check 2>&1
if ($LASTEXITCODE -ne 0 -or ($ok -join "`n") -notmatch 'p3h_django_contract_valid') { throw 'ASSERTION FAILED: an isolated temporary CandidateRoot must validate.' }

$settings = & $wrapper -CandidateRoot $root -DjangoArgs @('shell','-c',"from django.conf import settings; print(settings.DATABASES['default']['NAME']); print(settings.MEDIA_ROOT)") 2>&1
if ($LASTEXITCODE -ne 0 -or ($settings -join "`n") -notmatch [regex]::Escape($root)) { throw 'ASSERTION FAILED: wrapped Django settings must resolve inside CandidateRoot.' }

$failed = & $wrapper -CandidateRoot $root -DjangoArgs @('no_such_command') 2>&1
if ($LASTEXITCODE -eq 0) { throw 'ASSERTION FAILED: failed Django commands must return non-zero.' }
$after = & $wrapper -CandidateRoot $root -DryRun check 2>&1
if ($LASTEXITCODE -ne 0 -or ($after -join "`n") -notmatch 'p3h_django_contract_valid') { throw 'ASSERTION FAILED: caller must continue after a failed wrapped command.' }

Write-Output 'PASS: P3H Django wrapper rejects unsafe roots and accepts only isolated absolute candidate roots.'
