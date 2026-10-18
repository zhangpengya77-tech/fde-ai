@echo off
chcp 65001 >nul 2>&1
title FDE-AI-UAS 2.0 DEMO - CHECK

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\check_demo.ps1"
set "RC=%ERRORLEVEL%"

echo.
echo 按任意鍵關閉此視窗...
pause >nul
exit /b %RC%
