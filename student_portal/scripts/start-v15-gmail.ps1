$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$python = Join-Path $projectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) {
    throw "Project virtual environment not found: $python"
}

$gmailAddress = (Read-Host "Gmail address for sending and receiving the test email").Trim().ToLowerInvariant()
if ($gmailAddress -notmatch '^[^\s@]+@gmail\.com$') {
    throw "Enter a valid @gmail.com address."
}

$secureAppPassword = Read-Host "Google App Password (input hidden; do not use your normal Gmail password)" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureAppPassword)
try {
    $appPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer) -replace '\s', ''
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    $secureAppPassword.Dispose()
}

if ($appPassword.Length -ne 16) {
    $appPassword = $null
    throw "Google App Password must contain 16 characters after removing spaces."
}

$environmentNames = @(
    "DJANGO_SECRET_KEY", "DJANGO_DEBUG", "DJANGO_ALLOWED_HOSTS", "DJANGO_CSRF_TRUSTED_ORIGINS", "DJANGO_DB_NAME",
    "DJANGO_EMAIL_BACKEND", "DJANGO_EMAIL_HOST", "DJANGO_EMAIL_PORT", "DJANGO_EMAIL_HOST_USER",
    "DJANGO_EMAIL_HOST_PASSWORD", "DJANGO_EMAIL_USE_TLS", "DEFAULT_FROM_EMAIL"
)
$originalEnvironment = @{}
foreach ($name in $environmentNames) {
    $originalEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}

$listener = $null
try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 8022)
    $listener.Start()
}
catch {
    $appPassword = $null
    throw "Port 8022 is already in use. Stop the current v1.5 server before starting Gmail mode."
}
finally {
    if ($listener) { $listener.Stop() }
}

$randomBytes = New-Object byte[] 48
$randomGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $randomGenerator.GetBytes($randomBytes)
    $env:DJANGO_SECRET_KEY = [Convert]::ToBase64String($randomBytes)
}
finally {
    $randomGenerator.Dispose()
    [Array]::Clear($randomBytes, 0, $randomBytes.Length)
}

$env:DJANGO_DEBUG = "false"
$env:DJANGO_ALLOWED_HOSTS = ".trycloudflare.com,127.0.0.1,localhost"
$env:DJANGO_CSRF_TRUSTED_ORIGINS = "https://*.trycloudflare.com"
$env:DJANGO_DB_NAME = Join-Path $projectRoot "db.sqlite3"
$env:DJANGO_EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
$env:DJANGO_EMAIL_HOST = "smtp.gmail.com"
$env:DJANGO_EMAIL_PORT = "587"
$env:DJANGO_EMAIL_HOST_USER = $gmailAddress
$env:DJANGO_EMAIL_HOST_PASSWORD = $appPassword
$env:DJANGO_EMAIL_USE_TLS = "true"
$env:DEFAULT_FROM_EMAIL = "FDE-AI <$gmailAddress>"
$appPassword = $null

$probeCode = @'
import os
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django
django.setup()
from django.conf import settings
from django.core.mail import send_mail
sent = send_mail("FDE-AI SMTP setup test", "Gmail SMTP verification succeeded.", settings.DEFAULT_FROM_EMAIL, [settings.EMAIL_HOST_USER], fail_silently=False)
if sent != 1:
    raise RuntimeError(f"SMTP accepted {sent} messages; expected one")
print("SMTP_TEST_SENT")
'@

Push-Location $projectRoot
try {
    & $python -c $probeCode
    if ($LASTEXITCODE -ne 0) {
        throw "Gmail SMTP test failed. Check the error above; the website server was not started."
    }
    Write-Host "Gmail SMTP test passed. Starting FDE-AI v1.5 at http://127.0.0.1:8022/"
    Write-Host "The existing Cloudflare Tunnel can continue forwarding to port 8022."
    $server = Start-Process -FilePath $python -ArgumentList @("manage.py", "runserver", "127.0.0.1:8022", "--noreload", "--insecure") -NoNewWindow -PassThru
    foreach ($name in $environmentNames) {
        [Environment]::SetEnvironmentVariable($name, $originalEnvironment[$name], "Process")
    }
    $server.WaitForExit()
    exit $server.ExitCode
}
finally {
    foreach ($name in $environmentNames) {
        [Environment]::SetEnvironmentVariable($name, $originalEnvironment[$name], "Process")
    }
    $appPassword = $null
    Pop-Location
}
