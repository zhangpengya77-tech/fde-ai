@echo off
chcp 65001 >nul
rem 關閉 FDE-AI 地面站（多機仿真）
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-fde-gcs-sim.ps1" %*
pause
