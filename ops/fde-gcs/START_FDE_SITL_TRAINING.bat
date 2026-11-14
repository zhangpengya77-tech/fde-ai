@echo off
REM SITL check; never starts a second SITL
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0fde-gcs.ps1" -Action sitl
echo.
pause
