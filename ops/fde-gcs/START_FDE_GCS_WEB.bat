@echo off
REM FDE-GCS web start (127.0.0.1:8260)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0fde-gcs.ps1" -Action start
echo.
pause
