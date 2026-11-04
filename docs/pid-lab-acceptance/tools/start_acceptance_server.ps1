# AI PID & Filter Lab 本機驗收伺服器（開發模式、獨立資料夾，不影響正式網站與正式資料庫）
# 用法：在 PowerShell 執行 & 'D:\FDE-AI-UAS-v2.0-pidlab\docs\pid-lab-acceptance\tools\start_acceptance_server.ps1'
# 停止：在此視窗按 Ctrl+C
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
$data = 'D:\FDE-AI-Runtime\pidlab-acceptance'
$port = 8195
New-Item -ItemType Directory -Force -Path $data | Out-Null
$env:FDE_LIVE_DEV_MODE = '1'
$env:FDE_PID_LAB_ROOT = Join-Path $data 'data'
$env:FDE_LIVE_SESSION_STORE = Join-Path $data 'sessions.sqlite3'
$env:FDE_VISION_CENTER_ROOT = Join-Path $data 'vc'
$env:FDE_LIVE_STORE_DIR = Join-Path $data 'store'
$env:PYTHONIOENCODING = 'utf8'
$python = 'C:\Users\admin\AppData\Local\Python\pythoncore-3.14-64\python.exe'
Write-Host "驗收網址：http://127.0.0.1:$port/pid-lab/" -ForegroundColor Cyan
Write-Host "首頁（側欄入口）：http://127.0.0.1:$port/" -ForegroundColor Cyan
Write-Host "資料夾：$data（可整個刪除以重來）" -ForegroundColor DarkGray
Set-Location (Join-Path $repo 'live_backend')
& $python -m uvicorn app.main:app --host 127.0.0.1 --port $port
