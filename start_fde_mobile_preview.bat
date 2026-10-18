@echo off
chcp 65001 >nul
title FDE-AI-UAS 手機預覽啟動器

echo.
echo ╔══════════════════════════════════════════════════════╗
echo ║        FDE-AI-UAS  手機 LAN 預覽啟動器              ║
echo ║        FDE Flight Health AI  一鍵啟動               ║
echo ╚══════════════════════════════════════════════════════╝
echo.

:: ─────────────────────────────────────────────
:: 0. 防火牆規則（需要管理員權限時自動提權）
:: ─────────────────────────────────────────────
echo [1/5] 開放防火牆 Port 8080 / 8040 ...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Start-Process powershell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"%~dp0add_firewall_rules.ps1\"' -Verb RunAs -Wait" ^
  2>nul
echo       防火牆設定完成（若未出現 UAC 視窗，規則已存在）
echo.

:: ─────────────────────────────────────────────
:: 1. 取得區網 IPv4（排除 loopback / WSL 172.18.x.x）
:: ─────────────────────────────────────────────
echo [2/5] 偵測區網 IP ...
for /f "tokens=*" %%A in ('powershell -NoProfile -Command ^
  "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -match '^(192\.168|10\.|172\.(1[6-9]|2[0-9]|3[01]))\.' -and $_.IPAddress -notmatch '^172\.18\.' } | Sort-Object { ($_.InterfaceAlias -eq 'WLAN') } -Descending | Select-Object -First 1 -ExpandProperty IPAddress"') do (
  set LAN_IP=%%A
)

if "%LAN_IP%"=="" (
  echo [警告] 未偵測到區網 IP，可能尚未連接 Wi-Fi。
  echo        手機預覽功能無法使用。
  echo        電腦本機仍可使用 http://127.0.0.1:8080/
  set LAN_IP=127.0.0.1
)
echo       區網 IP: %LAN_IP%
echo.

:: ─────────────────────────────────────────────
:: 2. 檢查 Port 占用
:: ─────────────────────────────────────────────
echo [3/5] 檢查 Port 占用狀態 ...
netstat -ano | findstr ":8080 " >nul 2>&1
if %errorlevel%==0 (
  echo [警告] Port 8080 已被占用！請關閉占用程式後再重試。
  echo        如果是上次的啟動器未關閉，請先關閉那個視窗。
  pause
  exit /b 1
)
netstat -ano | findstr ":8040 " >nul 2>&1
if %errorlevel%==0 (
  echo [警告] Port 8040 已被占用！請關閉占用程式後再重試。
  echo        如果是上次的啟動器未關閉，請先關閉那個視窗。
  pause
  exit /b 1
)
echo       Port 8080 / 8040 均可用
echo.

:: ─────────────────────────────────────────────
:: 3. 啟動 FDE-AI-UAS 主站（Port 8080）
:: ─────────────────────────────────────────────
echo [4/5] 啟動 FDE-AI-UAS 主站 (Port 8080) ...
start "FDE-AI-UAS 主站 :8080" /D "D:\FDE-AI-UAS-v2.0" cmd /k ^
  "echo FDE-AI-UAS 主站已啟動 (0.0.0.0:8080) && python -m http.server 8080 --bind 0.0.0.0"

:: ─────────────────────────────────────────────
:: 4. 啟動 Flight Health Backend（Port 8040）
:: ─────────────────────────────────────────────
echo       啟動 Flight Health Backend (Port 8040) ...
start "FDE Flight Health API :8040" /D "D:\FDE-Flight-Health-AI" cmd /k ^
  "echo Flight Health Backend 已啟動 (0.0.0.0:8040) && D:\FDE-Flight-Health-AI\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8040 --reload"

:: 等待服務啟動
echo       等待服務就緒 (5 秒) ...
timeout /t 5 /nobreak >nul

:: ─────────────────────────────────────────────
:: 5. 健康檢查 + 顯示訪問網址
:: ─────────────────────────────────────────────
echo [5/5] 服務健康檢查 ...
echo.

:: 檢查 8080
D:\FDE-Flight-Health-AI\.venv\Scripts\python.exe -c ^
  "import urllib.request, sys; urllib.request.urlopen('http://127.0.0.1:8080/', timeout=3); print('[OK] 主站 8080 正常')" ^
  2>nul && set SITE_OK=1 || (
    echo [警告] 主站 8080 尚未回應，可能需要更多時間...
    set SITE_OK=0
  )

:: 檢查 8040
D:\FDE-Flight-Health-AI\.venv\Scripts\python.exe -c ^
  "import urllib.request, sys; r=urllib.request.urlopen('http://127.0.0.1:8040/api/v1/health', timeout=3); print('[OK] Flight Health API 8040 正常：' + r.read().decode()[:60])" ^
  2>nul || echo [警告] Flight Health 8040 尚未回應，可能需要更多時間...

echo.
echo ════════════════════════════════════════════════════════
echo.
echo   ✅  電腦瀏覽器訪問：
echo.
echo       主站：   http://127.0.0.1:8080/
echo       飛行健康：http://127.0.0.1:8080/flight-health/
echo.
echo ════════════════════════════════════════════════════════
echo.
echo   📱  手機瀏覽器訪問（請確認手機和電腦在同一個 Wi-Fi）：
echo.
echo       主站：    http://%LAN_IP%:8080/
echo       飛行健康：http://%LAN_IP%:8080/flight-health/
echo       API 狀態：http://%LAN_IP%:8040/api/v1/health
echo.
echo ════════════════════════════════════════════════════════
echo.
echo   🛑  關閉方式：
echo       關閉「FDE-AI-UAS 主站」和「FDE Flight Health API」
echo       兩個終端機視窗即可停止服務。
echo.

:: 自動在瀏覽器開啟主站
start "" "http://127.0.0.1:8080/"

pause
