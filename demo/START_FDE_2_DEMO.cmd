@echo off
chcp 65001 >nul 2>&1
title FDE-AI-UAS 2.0 DEMO - START

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\start_demo.ps1"
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
  echo 按任意鍵關閉此視窗...
) else (
  echo *** 啟動未完全成功，請查看上方訊息 ***
  echo 按任意鍵關閉此視窗...
)
pause >nul
exit /b %RC%
