@echo off
REM FDE-GCS web safe stop (only the process it started)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0fde-gcs.ps1" -Action stop
echo.
pause
