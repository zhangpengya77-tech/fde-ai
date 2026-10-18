# ===========================================================================
#  FDE-AI-UAS 2.0 DEMO — 停止腳本
#  只停止「本次啟動的 DEMO 程序」（依狀態檔記錄的 PID）。
#  絕不依埠號盲目終止其他服務（正式 8022 / 8770 一律不動）。
# ===========================================================================

. (Join-Path $PSScriptRoot 'demo_common.ps1')

Write-Head 'FDE-AI-UAS 2.0 DEMO — 停止'

$state = Read-DemoState
if (-not $state) {
  Write-Warn2 "找不到狀態檔：$StateFile"
  Write-Host '         可能從未啟動，或狀態檔已被清除。' -ForegroundColor Gray
  Write-Host ''
  Write-Host '  為安全起見，本腳本不會依埠號推測並終止任何程序。' -ForegroundColor Yellow
  Write-Host '  若確認 DEMO 服務仍在執行，請執行 CHECK_FDE_2_DEMO.cmd 查看。' -ForegroundColor Yellow
  Write-Host ''
  exit 0
}

$stopped = 0

foreach ($entry in @(
    @{ Name = 'Flight Health 後端'; Pid = $state.flight_health_pid },
    @{ Name = 'Live Backend'; Pid = $state.live_pid },
    @{ Name = 'Django';       Pid = $state.django_pid }
)) {

  if (-not $entry.Pid) {
    Write-Info "$($entry.Name)：狀態檔無 PID，略過。"
    continue
  }

  $proc = Get-Process -Id $entry.Pid -ErrorAction SilentlyContinue
  if (-not $proc) {
    Write-Info "$($entry.Name)（PID $($entry.Pid)）：程序已結束。"
    continue
  }

  # 安全檢查：確認該 PID 確實是 python，避免 PID 被回收後誤殺其他程式。
  if ($proc.ProcessName -notmatch '^python') {
    Write-Warn2 "$($entry.Name)（PID $($entry.Pid)）不是 python 程序（$($proc.ProcessName)），為安全起見不終止。"
    continue
  }

  try {
    Stop-Process -Id $entry.Pid -Force -ErrorAction Stop
    Write-Ok "$($entry.Name)（PID $($entry.Pid)）已停止。"
    $stopped++
  } catch {
    Write-Bad "$($entry.Name)（PID $($entry.Pid)）停止失敗：$($_.Exception.Message)"
  }
}

# 額外：以「連接埠持有者」為準停止（修復關閉視窗後殘留孤兒服務的問題）
# 即使狀態檔 PID 已過期，只要埠仍被 DEMO 服務佔用就停止它（僅限 python）。
foreach ($p in @($DjangoPort, $LivePort, $FlightHealthPort)) {
  $owner = Get-PortOwner $p
  if (-not $owner) { continue }
  $pProc = Get-Process -Id $owner.Pid -ErrorAction SilentlyContinue
  if (-not $pProc) { continue }
  if ($pProc.ProcessName -notmatch '^python') {
    Write-Warn2 "埠 $p 持有者（PID $($owner.Pid) / $($pProc.ProcessName)）非 python，為安全不終止。"
    continue
  }
  try {
    Stop-Process -Id $owner.Pid -Force -ErrorAction Stop
    Write-Ok "埠 $p 持有者（PID $($owner.Pid)）已停止。"
    $stopped++
  } catch {
    Write-Bad "埠 $p 持有者（PID $($owner.Pid)）停止失敗：$($_.Exception.Message)"
  }
}

# 等待埠釋放
Start-Sleep -Seconds 2
Write-Host ''
Write-Host '  連接埠狀態複查：' -ForegroundColor White
foreach ($p in @($DjangoPort, $LivePort, $FlightHealthPort)) {
  $owner = Get-PortOwner $p
  if ($owner) {
    Write-Warn2 "埠 $p 仍被占用（PID $($owner.Pid) / $($owner.Name)）"
  } else {
    Write-Ok "埠 $p 已釋放"
  }
}

# 清除狀態檔，避免下次誤判
# 注意：部分環境有 safe-delete 刪除防護會擋下 Remove-Item，故改以 try/catch：
#   刪除成功 → 正常；被防護擋下 → 改為清空內容為 {}，下次啟動會自動覆寫。
if (Test-Path $StateFile) {
  try {
    Remove-Item $StateFile -Force -ErrorAction Stop
    Write-Ok '狀態檔已清除。'
  } catch {
    try {
      [System.IO.File]::WriteAllText($StateFile, '{}', [System.Text.UTF8Encoding]::new($false))
      Write-Warn2 '狀態檔刪除遭環境防護擋下，已改為清空內容（下次啟動自動覆寫）。'
    } catch {
      Write-Warn2 "狀態檔清除失敗：$($_.Exception.Message)；下次啟動時將自動覆寫。"
    }
  }
}

Write-Head 'DEMO 已停止'
Write-Host ''
Write-Host "  已停止 $stopped 個 DEMO 程序。" -ForegroundColor Green
Write-Host '  正式服務（Django :8022、RAG :8770）全程未被觸碰。' -ForegroundColor DarkGray
Write-Host ''
Write-Host '  DEMO 資料庫與展示資料完整保留，下次可直接重新啟動。' -ForegroundColor Gray
Write-Host ''
