# 停止「即時鏡頭檢測」預覽環境（2026-11-08）。
# 辨認方式：指令列含預覽工作樹路徑「FDE-AI-UAS-v2.0-live-camera」或預覽專用埠號（8440／8441／8443／通道指向 8442），
# 再連同子程序一起停止（venv 的 python 會再開一個子程序）。
# 正式站（8140～8143、8543、8772、8040，程式在 FDE-AI-UAS-v2.0-integration）不符合條件，不會被停止。
$marker = 'FDE-AI-UAS-v2\.0-live-camera|127\.0\.0\.1:8440|--port 8441|--port 8443|tunnel .*127\.0\.0\.1:8442'
$all = Get-CimInstance Win32_Process
$roots = $all | Where-Object { $_.CommandLine -and $_.CommandLine -match $marker -and $_.CommandLine -notmatch 'stop_preview' }
if (-not $roots) { Write-Output '預覽環境沒有在執行。'; exit 0 }
foreach ($proc in $roots) {
  & taskkill.exe /T /F /PID $proc.ProcessId *> $null
  Write-Output ("已停止 PID {0} {1}" -f $proc.ProcessId, $proc.Name)
}
Start-Sleep -Seconds 1
$left = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -match $marker -and $_.CommandLine -notmatch 'stop_preview' }
if ($left) { $left | ForEach-Object { Write-Output ("仍在執行 PID {0}" -f $_.ProcessId) } } else { Write-Output '完成，預覽環境已全部停止。' }
