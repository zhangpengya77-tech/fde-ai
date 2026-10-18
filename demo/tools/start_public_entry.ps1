# start_public_entry.ps1 — FDE-AI DEMO 公開入口（靜態頁 + 同源反代 + 臨時隧道）
#
# 功能：
#   1. 檢查教師電腦上的三個 DEMO 服務（Django :8110 / Live :8111 / Flight Health :8040）
#   2. 背景啟動公開入口伺服器（:8112，託管靜態入口頁並同源反代到 Live）
#   3. 新開一個視窗啟動 pinggy 免費隧道，把 :8112 暴露成公網 HTTPS 網址
#   4. （可選）帶上 -TunnelUrl 時，啟動後自動驗證該網址
#
# 用法（在專案根目錄 D:\FDE-AI-UAS-v2.0）：
#   powershell -ExecutionPolicy Bypass -File demo\tools\start_public_entry.ps1
#   powershell -ExecutionPolicy Bypass -File demo\tools\start_public_entry.ps1 -TunnelUrl "https://xxxx.free.pinggy.net"
#
# 停止：關閉隧道視窗即可；入口伺服器可用下列指令停止：
#   powershell -ExecutionPolicy Bypass -File demo\tools\start_public_entry.ps1 -Stop
#
# 注意：
#   * 本腳本只「新增」公開入口，不修改 Django / Live / YOLO / 資料庫 / 審核規則。
#   * 隧道網址每次重啟都會變；pinggy 免費隧道 60 分鐘上限，逾時請重跑本腳本。
#   * 瀏覽器首次開啟會看到 pinggy 一次性安全提示頁，點「Enter site」即可（每個瀏覽器只需一次）。

param(
    [string]$TunnelUrl = "",
    [switch]$Stop
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$EntryPort = if ($env:FDE_ENTRY_PORT) { [int]$env:FDE_ENTRY_PORT } else { 8112 }
$EntryBind = if ($env:FDE_ENTRY_BIND) { $env:FDE_ENTRY_BIND } else { '192.168.1.114' }
$PythonCandidates = @(
    (Join-Path $ProjectRoot '.test-temp\django-venv\Scripts\python.exe'),
    'python'
)

function Write-Ok([string]$Msg)   { Write-Host "[ OK ] $Msg" -ForegroundColor Green }
function Write-Bad([string]$Msg)  { Write-Host "[FAIL] $Msg" -ForegroundColor Red }
function Write-Info([string]$Msg) { Write-Host "[INFO] $Msg" -ForegroundColor Cyan }

function Test-Http([string]$Url, [int]$Seconds) {
    try {
        $r = Invoke-WebRequest -Uri $Url -TimeoutSec $Seconds -UseBasicParsing -ErrorAction Stop
        return $r.StatusCode
    } catch {
        if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
        return 0
    }
}

function Get-Python {
    foreach ($py in $PythonCandidates) {
        try {
            $null = & $py --version 2>&1
            if ($LASTEXITCODE -eq 0) { return $py }
        } catch { }
    }
    return $null
}

if ($Stop) {
    $conns = Get-NetTCPConnection -LocalPort $EntryPort -State Listen -ErrorAction SilentlyContinue
    if ($conns) {
        foreach ($c in $conns) {
            $pidToStop = $c.OwningProcess
            Stop-Process -Id $pidToStop -Force -ErrorAction SilentlyContinue
            Write-Ok "入口伺服器已停止（PID $pidToStop）"
        }
        Start-Sleep -Seconds 1
        $still = Get-NetTCPConnection -LocalPort $EntryPort -State Listen -ErrorAction SilentlyContinue
        if ($still) { Write-Bad ":8112 仍有監聽（PID $($still.OwningProcess -join ', ')），請手動確認" }
        else { Write-Ok ":$EntryPort 已釋放" }
    } else {
        Write-Info "入口伺服器未在執行"
    }
    exit 0
}

# 1) 服務檢查
$svcOk = $true
$svcMap = [ordered]@{
    'Django 學員/教師入口' = "http://${EntryBind}:8110/login/"
    'Live 即時助教後端'    = "http://${EntryBind}:8111/api/live/health"
    'Flight Health 飛行健檢' = "http://${EntryBind}:8040/api/v1/health"
}
foreach ($name in $svcMap.Keys) {
    $code = Test-Http $svcMap[$name] 20
    if ($code -eq 200) { Write-Ok "$name 正常（$($svcMap[$name])）" }
    else { Write-Bad "$name 無回應（HTTP $code）。請先執行 demo\tools\start_demo.ps1 啟動 DEMO。"; $svcOk = $false }
}
if (-not $svcOk) { exit 1 }

# 2) 啟動入口伺服器（背景、隱藏視窗）
$existing = Get-NetTCPConnection -LocalPort $EntryPort -State Listen -ErrorAction SilentlyContinue
if ($existing) {
    Write-Info "入口伺服器已在執行（:8112）"
} else {
    $py = Get-Python
    if (-not $py) { Write-Bad "找不到可用的 Python"; exit 1 }
    $serverScript = Join-Path $PSScriptRoot 'static_entry_server.py'
    $env:FDE_ENTRY_BIND = $EntryBind
    $env:FDE_ENTRY_PORT = "$EntryPort"
    Start-Process -FilePath $py -ArgumentList @($serverScript) -WorkingDirectory $ProjectRoot -WindowStyle Hidden
    Start-Sleep -Seconds 2
    $code = Test-Http "http://${EntryBind}:$EntryPort/" 15
    if ($code -eq 200) { Write-Ok "入口伺服器已啟動（http://${EntryBind}:$EntryPort/）" }
    else { Write-Bad "入口伺服器啟動失敗（HTTP $code）"; exit 1 }
}

# 3) 隧道（新視窗，教師可看見網址；60 分鐘上限）
Write-Info "正在新視窗啟動 pinggy 隧道…（目標 :8112）"
$sshArgs = @(
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=NUL',
    '-o', 'ServerAliveInterval=30',
    '-p', '443',
    '-R0', "${EntryBind}:${EntryPort}",
    'qr@a.pinggy.io'
)
Start-Process -FilePath 'ssh' -ArgumentList $sshArgs
Start-Sleep -Seconds 8
Write-Info "請從新開的隧道視窗複製 https:// 網址（例如 https://xxxx.free.pinggy.net）。"
Write-Info "該視窗持續開著＝隧道存活；關閉視窗或逾時 60 分鐘即失效。"

# 4) 可選：自動驗證
if ($TunnelUrl) {
    Start-Sleep -Seconds 3
    $code = Test-Http "$($TunnelUrl.TrimEnd('/'))/" 30
    if ($code -eq 200) { Write-Ok "公開網址驗證通過：$TunnelUrl" }
    else { Write-Bad "公開網址驗證失敗（HTTP $code）：$TunnelUrl" }
}

Write-Host ""
Write-Host "完成。學員/教師請用瀏覽器開啟公開網址（首次會看到 pinggy 一次性安全提示頁，點 Enter site 即可）。" -ForegroundColor Yellow
Write-Host "詳細說明與帳號位置：demo\runtime\PUBLIC_ACCESS_2026-10-18.md" -ForegroundColor Yellow
