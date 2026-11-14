# 關閉 FDE-AI 地面站（多機仿真）：本機網站、SITL Gateway，以及多機 SITL 與考照場景
param([int]$DjangoPort = 8275, [string]$SimRoot = 'D:\FDE-Sim-SITL-Mode')
Get-CimInstance Win32_Process -Filter "Name='python.exe' or Name='py.exe'" |
  Where-Object { $_.CommandLine -match "fde_gcs_gateway\.py|runserver 127\.0\.0\.1:$DjangoPort" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Host "已關閉 PID $($_.ProcessId)" }
$stopSim = Join-Path $SimRoot 'tools\sitl-mode\stop-sitl-mode.ps1'
if (Test-Path $stopSim) { & powershell -NoProfile -ExecutionPolicy Bypass -File $stopSim }
Write-Host '完成。'
