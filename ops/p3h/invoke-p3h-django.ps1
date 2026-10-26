[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$CandidateRoot,
  [switch]$DryRun,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$DjangoArgs
)

$ErrorActionPreference = 'Stop'
# 候選程序啟動前清除所有 proxy 環境變數：避免大小寫重複的 proxy 鍵干擾，
# 且 localhost 呼叫不應被代理攔截。僅作用於本子程序，不影響父 session。
foreach ($pname in @('http_proxy','https_proxy','HTTP_PROXY','HTTPS_PROXY','all_proxy','ALL_PROXY','no_proxy','NO_PROXY')) {
  [Environment]::SetEnvironmentVariable($pname, $null, 'Process')
}
function Reject([string]$Message) { Write-Output $Message; exit 1 }
# 執行階段相容：本機 Windows PowerShell 5.1 的 [IO.Path] 未公開 IsPathFullyQualified；
# 以 IsPathRooted 加「非磁碟機相對（如 C:foo）」判斷，pwsh 7 與 WinPS 5.1 皆可用。
$isFullyQualified = [IO.Path]::IsPathRooted($CandidateRoot) -and -not ($CandidateRoot -match '^[A-Za-z]:[^\\]')
if ([string]::IsNullOrWhiteSpace($CandidateRoot) -or -not $isFullyQualified -or $CandidateRoot.StartsWith('\\')) {
  Reject 'CandidateRoot must be a non-UNC absolute path.'
}
$candidate = [IO.Path]::GetFullPath($CandidateRoot)
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
if (-not $candidate.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { Reject 'CandidateRoot must be inside the local temporary root.' }
$db = Join-Path $candidate 'p3h.sqlite3'
$media = Join-Path $candidate 'media'
if ($db -eq $media) { Reject 'Database and media paths must be distinct.' }
New-Item -ItemType Directory -Force -Path $candidate, $media | Out-Null
$project = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$django = Join-Path $project 'student_portal'
if (-not (Test-Path -LiteralPath (Join-Path $django 'manage.py'))) { Reject 'P3H Django source is unavailable.' }
if ($DryRun) {
  [ordered]@{status='p3h_django_contract_valid'; database=$db; media_root=$media; settings_module='config.settings'; secrets='process-only'} | ConvertTo-Json -Compress
  exit 0
}
if (-not $DjangoArgs -or $DjangoArgs.Count -eq 0) { Reject 'A Django management command is required.' }
$saved=@{}
foreach($name in @('DJANGO_DB_NAME','DJANGO_MEDIA_ROOT','DJANGO_SECRET_KEY','FDE_LIVE_ASSERTION_KEY','FDE_GATEWAY_INTERNAL_AUTH_KEY','DJANGO_SETTINGS_MODULE','DJANGO_DEBUG')){$saved[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
$commandExit = 1
try {
  $env:DJANGO_DB_NAME=$db; $env:DJANGO_MEDIA_ROOT=$media; $env:DJANGO_SECRET_KEY='p3h-isolated-only-key'; $env:FDE_LIVE_ASSERTION_KEY='p3h-isolated-assertion-key'; $env:FDE_GATEWAY_INTERNAL_AUTH_KEY='p3h-isolated-gateway-key'; $env:DJANGO_SETTINGS_MODULE='config.settings'; $env:DJANGO_DEBUG='true'
  Push-Location $django
  try {
    # 容許 python 寫入 stderr（如未知指令）但不讓 NativeCommandError 終止包裝器；
    # 仍正確回傳 python 的結束碼，使呼叫端能判斷失敗。
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & (Get-Command python -ErrorAction Stop).Source manage.py @DjangoArgs
    $commandExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prevEap
    Pop-Location
  }
} finally { foreach($item in $saved.GetEnumerator()){[Environment]::SetEnvironmentVariable($item.Key,$item.Value,'Process')} }
exit $commandExit
