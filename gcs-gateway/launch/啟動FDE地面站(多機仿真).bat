@echo off
chcp 65001 >nul
rem FDE-AI 地面站（多機仿真）一鍵啟動：3 架 SITL、考照場景、Gateway、本機網站，最後自動打開瀏覽器
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-fde-gcs-sim.ps1" %*
if errorlevel 1 pause
