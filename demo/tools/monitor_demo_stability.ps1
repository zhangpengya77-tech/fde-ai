# ===========================================================================
#  FDE-AI-UAS 2.0 DEMO — 服務穩定性監控腳本（10 分鐘）
#  僅用於 DEMO 展示環境；不觸碰正式服務。
#  流程：清理 8110/8111 殘留 → 啟動 DEMO → 於 T+1/5/10 分鐘檢查
#        埠監聽 / PID / HTTP 各頁面 / 啟動日誌例外 / 真實 Chrome 登入跳轉。
# ===========================================================================
$ErrorActionPreference = 'Continue'
try { Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force } catch {}

$root = 'D:\FDE-AI-UAS-v2.0'
$log  = "$root\demo\runtime\logs\monitor.log"
$py   = "D:\FDE-AI-UAS-v2.0\.test-temp\django-venv\Scripts\python.exe"

# 清除可能干擾 localhost 的系統代理（避免 HTTP 502 偽陽性）
$env:HTTP_PROXY = $null; $env:HTTPS_PROXY = $null; $env:ALL_PROXY = $null
$env:http_proxy = $null; $env:https_proxy = $null; $env:all_proxy = $null
$env:NO_PROXY = '*'; $env:no_proxy = '*'

"=== STABILITY MONITOR START $(Get-Date -Format 'o') ===" | Out-File -FilePath $log -Encoding utf8

# ---------------------------------------------------------------------------
#  清理 8110/8111 殘留程序（只殺占用這兩個埠的 python，絕不動 8022/8770）
# ---------------------------------------------------------------------------
"--- 清理 8110/8111 殘留程序 ---" | Out-File -FilePath $log -Append -Encoding utf8
$stale = Get-NetTCPConnection -LocalPort 8110,8111 -State Listen -ErrorAction SilentlyContinue
foreach ($c in $stale) {
  $pidv = $c.OwningProcess
  $proc = Get-Process -Id $pidv -ErrorAction SilentlyContinue
  if ($proc -and $proc.ProcessName -match '^python') {
    "KILL stale PID $pidv ($($proc.ProcessName)) on :$($c.LocalPort)" | Out-File -FilePath $log -Append -Encoding utf8
    Stop-Process -Id $pidv -Force -ErrorAction SilentlyContinue
  } else {
    "PORT :$($c.LocalPort) owned by non-python PID $pidv ($($proc.ProcessName)) — skipped" | Out-File -FilePath $log -Append -Encoding utf8
  }
}
Start-Sleep -Seconds 3

# ---------------------------------------------------------------------------
#  啟動 DEMO
# ---------------------------------------------------------------------------
"--- 啟動 DEMO (start_demo.ps1 -NoBrowser) ---" | Out-File -FilePath $log -Append -Encoding utf8
& "$root\demo\tools\start_demo.ps1" -NoBrowser *>&1 | Out-File -FilePath $log -Append -Encoding utf8
"LAUNCH done $(Get-Date -Format 'o')" | Out-File -FilePath $log -Append -Encoding utf8

# ---------------------------------------------------------------------------
#  檢查點函式
# ---------------------------------------------------------------------------
function Checkpoint($label) {
  $t = Get-Date -Format 'o'
  "---- CHECKPOINT $label @ $t ----" | Out-File -FilePath $log -Append -Encoding utf8

  # 埠 + PID
  $ports = Get-NetTCPConnection -LocalPort 8110,8111 -State Listen -ErrorAction SilentlyContinue
  foreach ($p in @(8110,8111)) {
    $o = $ports | Where-Object { $_.LocalPort -eq $p }
    if ($o) { "PORT :$p LISTENING PID=$($o.OwningProcess)" | Out-File -FilePath $log -Append -Encoding utf8 }
    else { "PORT :$p *** DOWN ***" | Out-File -FilePath $log -Append -Encoding utf8 }
  }

  # 所有 python 行程（觀察 Django / Live PID 是否變更）
  $pyProcs = Get-Process -Name python -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id
  "PYTHON_PIDS: $($pyProcs -join ',')" | Out-File -FilePath $log -Append -Encoding utf8

  # HTTP 各頁面（清過代理，走 127.0.0.1 直連）
  $urls = @(
    @{n='home_8111';          u='http://127.0.0.1:8111/'},
    @{n='login_8111';         u='http://127.0.0.1:8111/login/'},
    @{n='student_growth_8111';u='http://127.0.0.1:8111/student/growth/'},
    @{n='downloads_8111';     u='http://127.0.0.1:8111/downloads/'},
    @{n='api_downloads_8111'; u='http://127.0.0.1:8111/api/downloads'},
    @{n='live_health_8111';   u='http://127.0.0.1:8111/api/live/health'},
    @{n='django_login_8110';  u='http://127.0.0.1:8110/login/'}
  )
  foreach ($x in $urls) {
    try {
      $r = Invoke-WebRequest -Uri $x.u -UseBasicParsing -TimeoutSec 8 -MaximumRedirection 5
      "HTTP $($x.n): $($r.StatusCode)" | Out-File -FilePath $log -Append -Encoding utf8
    } catch {
      $code = if ($_.Exception.Response) { $_.Exception.Response.StatusCode.value__ } else { 'ERR' }
      "HTTP $($x.n): FAIL($code) $($_.Exception.Message.Split([Environment]::NewLine)[0])" | Out-File -FilePath $log -Append -Encoding utf8
    }
  }

  # 日誌例外尾段
  "--- django.err.log tail ---" | Out-File -FilePath $log -Append -Encoding utf8
  (Get-Content "$root\demo\runtime\logs\django.err.log" -Tail 10 -ErrorAction SilentlyContinue) | Out-File -FilePath $log -Append -Encoding utf8
  "--- live.err.log tail ---" | Out-File -FilePath $log -Append -Encoding utf8
  (Get-Content "$root\demo\runtime\logs\live.err.log" -Tail 10 -ErrorAction SilentlyContinue) | Out-File -FilePath $log -Append -Encoding utf8
}

function ChromeVerify($label) {
  "--- Chrome real-browser verify ($label) ---" | Out-File -FilePath $log -Append -Encoding utf8
  (& $py "$root\demo\tools\capture_demo_screenshots.py" 2>&1 | Select-Object -Last 12) | Out-File -FilePath $log -Append -Encoding utf8
}

# ---------------------------------------------------------------------------
#  時間點檢查
# ---------------------------------------------------------------------------
Checkpoint "T+0_after_launch"
Start-Sleep -Seconds 60
Checkpoint "T+1min"
ChromeVerify "T+1min"
Start-Sleep -Seconds 240
Checkpoint "T+5min"
ChromeVerify "T+5min"
Start-Sleep -Seconds 300
Checkpoint "T+10min"
ChromeVerify "T+10min"

"=== STABILITY MONITOR END $(Get-Date -Format 'o') ===" | Out-File -FilePath $log -Append -Encoding utf8
