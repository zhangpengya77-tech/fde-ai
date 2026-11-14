@echo off
REM FDE-GCS environment check
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0fde-gcs.ps1" -Action check
echo.
pause
