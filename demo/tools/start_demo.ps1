# ===========================================================================
#  FDE-AI-UAS 2.0 DEMO — 啟動腳本
#  依序：埠檢查 → 隔離驗證 → 依賴檢查 → 啟動 Django → 啟動 Live Backend
#        → 健康檢查 → 開啟瀏覽器 → 顯示狀態
#  只監聽 127.0.0.1，不觸碰任何正式服務。
# ===========================================================================
param(
  [switch]$NoBrowser   # 自動化測試用：不開啟瀏覽器
)

. (Join-Path $PSScriptRoot 'demo_common.ps1')

$exitCode = 0

Write-Head 'FDE-AI-UAS 2.0 DEMO（合作展示版）— 啟動'

# ---------------------------------------------------------------------------
#  1. 埠檢查
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '  [1/8] 連接埠檢查' -ForegroundColor White

$state = Read-DemoState
$djangoOwned = ($state -and $state.django_pid -and (Get-Process -Id $state.django_pid -ErrorAction SilentlyContinue))
$liveOwned   = ($state -and $state.live_pid   -and (Get-Process -Id $state.live_pid   -ErrorAction SilentlyContinue))
$fhOwned     = ($state -and $state.flight_health_pid -and (Get-Process -Id $state.flight_health_pid -ErrorAction SilentlyContinue))

foreach ($p in @($DjangoPort, $LivePort, $FlightHealthPort)) {
  $owner = Get-PortOwner $p
  $ownedByUs = (($p -eq $DjangoPort) -and $djangoOwned) -or (($p -eq $LivePort) -and $liveOwned) -or (($p -eq $FlightHealthPort) -and $fhOwned)
  if ($owner -and -not $ownedByUs) {
    Write-Bad "埠 $p 已被其他行程占用（PID $($owner.Pid) / $($owner.Name)）"
    Write-Host '         請先關閉該行程，或改用其他埠並同步修改 demo_env.cmd。' -ForegroundColor Yellow
    $exitCode = 1
  } elseif ($owner) {
    Write-Ok "埠 $p 由本次 DEMO 服務持有（PID $($owner.Pid)）"
  } else {
    Write-Ok "埠 $p 可用"
  }
}
if ($exitCode -ne 0) {
  Write-Host ''
  Write-Bad '啟動中止：連接埠衝突。'
  exit 1
}

# ---------------------------------------------------------------------------
#  2. 隔離驗證
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '  [2/8] 隔離驗證（所有路徑必須在 demo/ 之下）' -ForegroundColor White
if (-not (Test-DemoIsolation)) {
  Write-Host ''
  Write-Bad '啟動中止：偵測到路徑不在 demo/ 之下，拒絕啟動以免污染正式資料。'
  exit 1
}

# ---------------------------------------------------------------------------
#  3. 依賴檢查
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '  [3/8] 依賴檢查' -ForegroundColor White
if (-not (Test-Path $DjangoPy)) {
  Write-Bad "找不到 Django Python：$DjangoPy"
  exit 1
}
Write-Ok "Django Python 存在"
if (-not (Test-Path $LivePy)) {
  Write-Bad "找不到 Live Backend Python：$LivePy"
  exit 1
}
Write-Ok "Live Backend Python 存在"

$demoDb = Join-Path $DemoRoot 'runtime\db\demo.sqlite3'
if (-not (Test-Path $demoDb)) {
  Write-Warn2 "DEMO DB 尚未建立，正在建立…"
  & $DjangoPy (Join-Path $DemoRoot 'tools\build_demo_db.py') 2>&1 | Out-Null
}
if (Test-Path $demoDb) {
  $dbSize = (Get-Item $demoDb).Length
  Write-Ok "DEMO DB 存在（$([math]::Round($dbSize/1KB,1)) KB）"
} else {
  Write-Bad 'DEMO DB 不存在，請先執行 demo\tools\build_demo_db.sh --reset'
  exit 1
}

New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null

# ---------------------------------------------------------------------------
#  4. 啟動 Django
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '  [4/8] 啟動 Django（DEMO :8110）' -ForegroundColor White
Set-DemoEnvironment

if ($djangoOwned -and (Test-Http "$DjangoUrl/login/")) {
  Write-Ok "Django 已在執行（PID $($state.django_pid)）"
  $djangoPid = $state.django_pid
} else {
  $djangoOut = Join-Path $LogRoot 'django.out.log'
  $djangoErr = Join-Path $LogRoot 'django.err.log'
  $proc = Start-Process -FilePath $DjangoPy `
    -ArgumentList @('manage.py', 'runserver', "${BindAddr}:$DjangoPort", '--noreload') `
    -WorkingDirectory (Join-Path $ProjectRoot 'student_portal') `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $djangoOut -RedirectStandardError $djangoErr
  $djangoPid = $proc.Id
  Write-Info "Django 啟動中（PID $djangoPid，綁定 ${BindAddr}:$DjangoPort）…"

  if (-not (Wait-Http "$DjangoUrl/login/" 45)) {
    Write-Bad "Django 未能在 45 秒內健康啟動。"
    Write-Host "         請查看：$djangoErr" -ForegroundColor Yellow
    $tail = Get-Content $djangoErr -Tail 15 -ErrorAction SilentlyContinue
    if ($tail) { $tail | ForEach-Object { Write-Host "         $_" -ForegroundColor DarkGray } }
    exit 1
  }
  Write-Ok "Django 健康檢查通過（PID $djangoPid）"
}

# ---------------------------------------------------------------------------
#  5. 啟動 Live Backend
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '  [5/8] 啟動 Live Backend（DEMO :8111）' -ForegroundColor White
Set-DemoEnvironment

if ($liveOwned -and (Test-Http "$LiveUrl/api/live/health")) {
  Write-Ok "Live Backend 已在執行（PID $($state.live_pid)）"
  $livePid = $state.live_pid
} else {
  $liveOut = Join-Path $LogRoot 'live.out.log'
  $liveErr = Join-Path $LogRoot 'live.err.log'
  $proc = Start-Process -FilePath $LivePy `
    -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', "$BindAddr", '--port', "$LivePort") `
    -WorkingDirectory (Join-Path $ProjectRoot 'live_backend') `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $liveOut -RedirectStandardError $liveErr
  $livePid = $proc.Id
  Write-Info "Live Backend 啟動中（PID $livePid，綁定 ${BindAddr}:$LivePort）…"

  if (-not (Wait-Http "$LiveUrl/api/live/health" 45)) {
    Write-Bad "Live Backend 未能在 45 秒內健康啟動。"
    Write-Host "         請查看：$liveErr" -ForegroundColor Yellow
    $tail = Get-Content $liveErr -Tail 15 -ErrorAction SilentlyContinue
    if ($tail) { $tail | ForEach-Object { Write-Host "         $_" -ForegroundColor DarkGray } }
    Write-Host ''
    Write-Warn2 "Django 仍在執行（PID $djangoPid）。若要一併停止，請執行 STOP_FDE_2_DEMO.cmd。"
    exit 1
  }
  Write-Ok "Live Backend 健康檢查通過（PID $livePid）"
}

# ---------------------------------------------------------------------------
#  6. 啟動 Flight Health 分析後端（DEMO :8040）
# ---------------------------------------------------------------------------
# 飛行健康 AI 的 DataFlash 解析服務（純 Python 標準庫，無額外依賴）。
# 前端 flight-health/js/config.js 在區網模式下直連 http://{host}:8040/api/v1；
# 不自動拉起此服務 → 「開始自動健康檢查」必然 Failed to fetch（2026-10-16 教師真機回報）。
Write-Host ''
Write-Host "  [6/8] 啟動 Flight Health 分析後端（DEMO :$FlightHealthPort）" -ForegroundColor White

$fhServer = Join-Path $ProjectRoot 'flight-health\reference_server.py'
if (-not (Test-Path $fhServer)) {
  Write-Bad "找不到 Flight Health 後端腳本：$fhServer"
  exit 1
}

if ($fhOwned -and (Test-Http "$FlightHealthUrl/api/v1/health")) {
  Write-Ok "Flight Health 後端已在執行（PID $($state.flight_health_pid)）"
  $fhPid = $state.flight_health_pid
} else {
  $fhOut = Join-Path $LogRoot 'flight-health.out.log'
  $fhErr = Join-Path $LogRoot 'flight-health.err.log'
  $proc = Start-Process -FilePath $LivePy `
    -ArgumentList @($fhServer) `
    -WorkingDirectory (Join-Path $ProjectRoot 'flight-health') `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $fhOut -RedirectStandardError $fhErr
  $fhPid = $proc.Id
  Write-Info "Flight Health 後端啟動中（PID $fhPid，綁定 ${BindAddr}:$FlightHealthPort）…"

  if (-not (Wait-Http "$FlightHealthUrl/api/v1/health" 30)) {
    Write-Bad "Flight Health 後端未能在 30 秒內健康啟動。"
    Write-Host "         請查看：$fhErr" -ForegroundColor Yellow
    $tail = Get-Content $fhErr -Tail 15 -ErrorAction SilentlyContinue
    if ($tail) { $tail | ForEach-Object { Write-Host "         $_" -ForegroundColor DarkGray } }
    exit 1
  }
  Write-Ok "Flight Health 後端健康檢查通過（PID $fhPid）"
}

# ---------------------------------------------------------------------------
#  儲存狀態
# ---------------------------------------------------------------------------
Save-DemoState ([ordered]@{
  django_pid = $djangoPid
  live_pid   = $livePid
  flight_health_pid = $fhPid
  django_url = $DjangoUrl
  live_url   = $LiveUrl
  flight_health_url = $FlightHealthUrl
  started_at = [DateTimeOffset]::Now.ToString('o')
})

# ---------------------------------------------------------------------------
#  6. 頁面檢查
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '  [7/8] 展示頁面檢查' -ForegroundColor White
$pageFail = 0
foreach ($page in Get-DemoPages) {
  $status = Get-HttpStatus $page.Url 8
  $expected = $page.Need
  $ok = if ($expected -eq 200) { $status -eq 200 } else { $status -eq $expected -or $status -eq 200 }
  if ($ok) {
    Write-Ok "$($page.Key)（HTTP $status）"
  } else {
    Write-Bad "$($page.Key)（HTTP $status，預期 $expected）"
    $pageFail++
  }
}

# ---------------------------------------------------------------------------
#  7. 開啟瀏覽器
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '  [8/8] 開啟展示網站' -ForegroundColor White
$demoEntry = "$LiveUrl/"
if ($NoBrowser) {
  Write-Info "（已指定 -NoBrowser，略過自動開啟）"
} else {
  Start-Process $demoEntry
  Write-Ok "已開啟：$demoEntry"
}

Write-Head 'DEMO 已就緒'
Write-Host ''
Write-Host "  展示入口（Live Backend）： $LiveUrl/" -ForegroundColor Green
Write-Host "  學員登入：                $DjangoUrl/login/" -ForegroundColor Green
Write-Host "  教師登入：                $DjangoUrl/teacher/login/" -ForegroundColor Green
Write-Host ''
Write-Host "  學員帳號： demo.student01@fde-demo.local" -ForegroundColor White
Write-Host "  教師帳號： demo.teacher@fde-demo.local" -ForegroundColor White
$credentialFile = Join-Path $HOME '.fde-demo-credentials\demo.shared.password.txt'
if (Test-Path $credentialFile) {
  Write-Host "  登入密碼： 請查看受限交付檔 $credentialFile" -ForegroundColor White
} else {
  Write-Warn2 "找不到受限交付檔：$credentialFile"
}
Write-Host ''
Write-Host "  Django PID = $djangoPid ｜ Live Backend PID = $livePid ｜ Flight Health PID = $fhPid" -ForegroundColor Gray
Write-Host "  日誌目錄： $LogRoot" -ForegroundColor Gray
Write-Host ''
if ($pageFail -gt 0) {
  Write-Warn2 "$pageFail 個頁面檢查未通過，請執行 CHECK_FDE_2_DEMO.cmd 進一步診斷。"
  $exitCode = 1
} else {
  Write-Ok '所有展示頁面檢查通過。'
}
Write-Host ''
Write-Host '  提示：展示結束後請執行 STOP_FDE_2_DEMO.cmd 安全停止。' -ForegroundColor Yellow
Write-Host ''

exit $exitCode
