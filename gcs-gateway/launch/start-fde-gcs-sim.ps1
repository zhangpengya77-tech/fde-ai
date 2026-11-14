# FDE-AI 地面站（多機仿真）一鍵啟動：3 架 SITL ＋ 考照場景 ＋ SITL Gateway ＋ 本機 FDE-GCS 網站，最後打開瀏覽器
#
#   這是「教室單機仿真」用：所有服務只綁 127.0.0.1，只連本機 ArduPilot SITL，沒有任何真實飛控的控制路徑。
#   本機網站使用獨立的資料庫（%LOCALAPPDATA%\FDE-GCS\gcs-local.sqlite3），不碰正式站資料。
#   每次啟動產生一次性登入代碼，瀏覽器打開後自動以這台電腦的本機帳號登入，代碼用過即失效。

param(
  [int]$Count = 3,
  [int]$DjangoPort = 8275,
  [string]$SimRoot = 'D:\FDE-Sim-SITL-Mode',      # 考照模擬器與多機 SITL 腳本所在
  [string]$GatewayPython = '',                    # 需有 pymavlink、websockets；預設用模擬器的轉接程式環境
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Portal = Join-Path $Repo 'student_portal'
$Gateway = Join-Path $Repo 'gcs-gateway\fde_gcs_gateway.py'
$Data = Join-Path $env:LOCALAPPDATA 'FDE-GCS'
$Logs = Join-Path $Data 'logs'
New-Item -ItemType Directory -Force -Path $Data, $Logs | Out-Null
if (-not $GatewayPython) { $GatewayPython = Join-Path $SimRoot '.venv-bridge\Scripts\python.exe' }

function Write-Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
# 只要服務有任何 HTTP 回應（含 302 轉向登入）就算在執行；用 .NET 直接請求，PowerShell 5.1 與 7 行為一致
function Test-Http($url) {
  try {
    $req = [System.Net.HttpWebRequest]::Create($url)
    $req.AllowAutoRedirect = $false
    $req.Timeout = 2000
    $res = $req.GetResponse(); $res.Close(); return $true
  } catch [System.Net.WebException] {
    if ($_.Exception.Response) { $_.Exception.Response.Close(); return $true }
    return $false
  }
}
function New-RandomText([int]$n) { -join ((48..57) + (65..90) + (97..122) | Get-Random -Count $n | ForEach-Object { [char]$_ }) }
function Stop-ByCommandLine($pattern) {
  # 用 Stop-Process 並忽略「程序已結束」：PowerShell 5.1 在 Stop 模式下，taskkill 的錯誤輸出會讓整支腳本中斷
  Get-CimInstance Win32_Process -Filter "Name='python.exe' or Name='py.exe'" | Where-Object { $_.CommandLine -match $pattern } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

foreach ($p in $GatewayPython, $Gateway, (Join-Path $SimRoot 'tools\sitl-mode\start-sitl-mode.ps1')) {
  if (-not (Test-Path $p)) { throw "找不到 $p。請確認考照模擬器（$SimRoot）與 FDE-GCS 專案都已安裝。" }
}

# 本機 Gateway 金鑰：第一次產生後保存在本機，網站與 Gateway 共用（不會上傳）
$secretFile = Join-Path $Data 'gateway.secret'
if (-not (Test-Path $secretFile)) { Set-Content -Path $secretFile -Value (New-RandomText 40) -NoNewline -Encoding ascii }
$secret = (Get-Content $secretFile -Raw).Trim()

# ---- 1. 多機 SITL ＋ 考照場景
Write-Step "1/4 多機 SITL（$Count 架）與考照場景"
if (Test-Http 'http://127.0.0.1:8263/health') {
  Write-Host '多機 SITL 已在執行，沿用。'
} else {
  Start-Process powershell -WindowStyle Minimized -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    (Join-Path $SimRoot 'tools\sitl-mode\start-sitl-mode.ps1'), '-Count', "$Count", '-NoBrowser', '-NoMissionPlanner')
}
$ready = $false
for ($i = 0; $i -lt 90; $i++) {
  Start-Sleep -Seconds 2
  try {
    $h = Invoke-RestMethod 'http://127.0.0.1:8263/health' -TimeoutSec 2
    if (@($h.fleet | Where-Object { $_.connected }).Count -ge $Count) { $ready = $true; break }
  } catch { }
}
if ($ready) { Write-Host "SITL 已就緒（$Count 架）。" -ForegroundColor Green } else { Write-Host 'SITL 還在啟動，網頁會自動等待。' -ForegroundColor Yellow }

# ---- 2. SITL Gateway（每次重開，確保使用本機金鑰）
Write-Step '2/4 SITL Gateway（127.0.0.1:8261）'
Stop-ByCommandLine 'fde_gcs_gateway\.py'
Start-Sleep -Seconds 1
$env:FDE_GCS_GATEWAY_SECRET = $secret
Start-Process -FilePath $GatewayPython -WindowStyle Minimized -ArgumentList @('-u', $Gateway, '--count', "$Count",
  '--formation-file', (Join-Path $SimRoot '.sitl-run\formation.json')) `
  -RedirectStandardOutput (Join-Path $Logs 'gateway.out.log') -RedirectStandardError (Join-Path $Logs 'gateway.err.log')
for ($i = 0; $i -lt 20 -and -not (Test-Http 'http://127.0.0.1:8261/health'); $i++) { Start-Sleep -Seconds 1 }
if (-not (Test-Http 'http://127.0.0.1:8261/health')) { throw "Gateway 沒有啟動，請看 $Logs\gateway.err.log" }
Write-Host 'Gateway 已啟動。' -ForegroundColor Green

# ---- 3. 本機 FDE-GCS 網站（獨立資料庫）
Write-Step "3/4 本機 FDE-GCS 網站（127.0.0.1:$DjangoPort）"
Stop-ByCommandLine "runserver 127\.0\.0\.1:$DjangoPort"
$token = New-RandomText 40
$env:FDE_GCS_ENABLED = '1'
$env:DJANGO_DB_NAME = Join-Path $Data 'gcs-local.sqlite3'
$env:FDE_GCS_LOCAL_LAUNCH_TOKEN = $token
Push-Location $Portal
try { & py -3 manage.py migrate --noinput *> (Join-Path $Logs 'migrate.log') } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw "網站資料庫初始化失敗，請看 $Logs\migrate.log" }
Start-Process -FilePath 'py' -WorkingDirectory $Portal -WindowStyle Minimized -ArgumentList @('-3', 'manage.py', 'runserver', "127.0.0.1:$DjangoPort", '--noreload') `
  -RedirectStandardOutput (Join-Path $Logs 'web.out.log') -RedirectStandardError (Join-Path $Logs 'web.err.log')
for ($i = 0; $i -lt 30 -and -not (Test-Http "http://127.0.0.1:$DjangoPort/gcs/"); $i++) { Start-Sleep -Seconds 1 }
if (-not (Test-Http "http://127.0.0.1:$DjangoPort/gcs/")) { throw "網站沒有啟動，請看 $Logs\web.err.log" }
Write-Host '網站已啟動。' -ForegroundColor Green

# ---- 4. 打開地面站
Write-Step '4/4 打開 FDE-AI 地面站'
$url = "http://127.0.0.1:$DjangoPort/gcs/local-login/$token/"
if ($NoBrowser) { Write-Host "登入網址（一次性）：$url" } else { Start-Process $url }
Write-Host "`n完成。在「04 多機仿真與編隊」按「連線仿真」→「取得控制權」，就能一鍵起飛與編隊。" -ForegroundColor Green
Write-Host '關閉：雙擊「關閉 FDE 地面站（多機仿真）」。'
