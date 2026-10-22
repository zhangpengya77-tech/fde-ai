@echo off
rem ===========================================================================
rem  FDE teaching server launcher (simulator on http://<this-pc>:8111/sim/)
rem  Double-click this file to start. Keep the window OPEN while teaching.
rem  Closing the window (or Ctrl+C) stops the server.
rem  --lan is passed so phones / other PCs on the same network can open it.
rem ===========================================================================
setlocal
cd /d "%~dp0"
title FDE teaching server - port 8111
color 07
echo.
echo   Starting FDE teaching server on port 8111 ...
echo   (build output is read from dist\ - run "npm run build" after source changes)
echo.

set "PYEXE="
where py >nul 2>nul
if not errorlevel 1 set "PYEXE=py -3"
if defined PYEXE goto run
where python >nul 2>nul
if not errorlevel 1 set "PYEXE=python"
if defined PYEXE goto run

echo   [ERROR] Python not found on PATH.
echo   Install Python 3 from https://www.python.org/ and tick "Add to PATH".
goto end

:run
rem --- free port 8111 if a stale server window is still holding it ---------
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr /r /c:":8111[^0-9]"') do (
  echo   [info] port 8111 is held by PID %%p - stopping that old server first ...
  taskkill /f /pid %%p >nul 2>nul
)
if errorlevel 1 echo   [info] could not stop the old process - if startup fails, close that window manually.
ping -n 2 127.0.0.1 >nul 2>nul

%PYEXE% tools\serve-8111.py --lan
if errorlevel 1 (
  echo.
  echo   [ERROR] server exited with an error - see the message above.
  echo   Most common cause: port 8111 is already in use by another window.
)

:end
echo.
echo   Server stopped. Press any key to close this window.
pause >nul
