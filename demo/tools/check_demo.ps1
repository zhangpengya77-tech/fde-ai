# ===========================================================================
#  FDE-AI-UAS 2.0 DEMO — 健康檢查腳本（唯讀，不安裝、不修改）
#  檢查：埠、程序、隔離路徑、Django、Live Backend、五個展示頁面、資料
# ===========================================================================

. (Join-Path $PSScriptRoot 'demo_common.ps1')

$fail = 0

Write-Head 'FDE-AI-UAS 2.0 DEMO — 健康檢查'

# ---------------------------------------------------------------------------
#  1. 服務程序
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '  [1/6] 服務程序狀態' -ForegroundColor White
$state = Read-DemoState
if ($state) {
  foreach ($e in @(
      @{ Name = 'Django';       Pid = $state.django_pid },
      @{ Name = 'Live Backend'; Pid = $state.live_pid }
    )) {
    if ($e.Pid -and (Get-Process -Id $e.Pid -ErrorAction SilentlyContinue)) {
      Write-Ok "$($e.Name) 執行中（PID $($e.Pid)）"
    } else {
      Write-Bad "$($e.Name) 未執行（狀態檔 PID $($e.Pid)）"
      $fail++
    }
  }
  Write-Info "啟動時間：$($state.started_at)"
} else {
  Write-Bad "找不到狀態檔，DEMO 可能尚未啟動：$StateFile"
  $fail++
}

# ---------------------------------------------------------------------------
#  2. 連接埠
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '  [2/6] 連接埠狀態' -ForegroundColor White
foreach ($p in @($DjangoPort, $LivePort)) {
  $owner = Get-PortOwner $p
  if ($owner) {
    Write-Ok "埠 $p LISTENING（PID $($owner.Pid) / $($owner.Name)）"
  } else {
    Write-Bad "埠 $p 未監聽"
    $fail++
  }
}
# 正式服務必須仍在（不得被本 DEMO 影響）
foreach ($p in @(8022, 8770)) {
  $owner = Get-PortOwner $p
  if ($owner) {
    Write-Ok "正式服務埠 $p 仍在（PID $($owner.Pid)）— 未被 DEMO 影響"
  } else {
    Write-Warn2 "正式服務埠 $p 未監聽（可能本來就未啟動，非本 DEMO 造成）"
  }
}

# ---------------------------------------------------------------------------
#  3. 隔離路徑
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '  [3/6] 隔離路徑驗證' -ForegroundColor White
if (-not (Test-DemoIsolation)) { $fail++ }

# 正式資源指紋（唯讀）
Write-Host ''
Write-Host '  正式資源指紋（唯讀，確認未被污染）：' -ForegroundColor White
if (Test-Path $ProdDb) {
  $h = (Get-FileHash $ProdDb -Algorithm SHA256).Hash.ToLower()
  Write-Host "    student_portal\db.sqlite3        $($h.Substring(0,24))…" -ForegroundColor DarkGray
}
$prodStore = Join-Path $ProdVisionDir 'vision_center.json'
if (Test-Path $prodStore) {
  $h = (Get-FileHash $prodStore -Algorithm SHA256).Hash.ToLower()
  Write-Host "    正式 vision_center.json          $($h.Substring(0,24))…" -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
#  4. 服務健康
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '  [4/6] 服務健康檢查' -ForegroundColor White
if (Test-Http "$DjangoUrl/login/") {
  Write-Ok "Django 回應正常（$DjangoUrl）"
} else {
  Write-Bad "Django 無回應（$DjangoUrl）"
  $fail++
}
if (Test-Http "$LiveUrl/api/live/health") {
  Write-Ok "Live Backend 健康端點正常（$LiveUrl/api/live/health）"
} else {
  Write-Bad "Live Backend 無回應（$LiveUrl/api/live/health）"
  $fail++
}

# ---------------------------------------------------------------------------
#  5. 展示頁面
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '  [5/6] 五個展示頁面' -ForegroundColor White
foreach ($page in Get-DemoPages) {
  $status = Get-HttpStatus $page.Url 8
  $expected = $page.Need
  $ok = if ($expected -eq 200) { $status -eq 200 } else { $status -eq $expected -or $status -eq 200 }
  if ($ok) {
    Write-Ok "$($page.Key)   HTTP $status   $($page.Url)"
  } else {
    Write-Bad "$($page.Key)   HTTP $status（預期 $expected）   $($page.Url)"
    $fail++
  }
}

# ---------------------------------------------------------------------------
#  6. 展示資料
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '  [6/6] 展示資料完整性' -ForegroundColor White
$verifyScript = Join-Path $DemoRoot 'tools\verify_demo_data.py'
if (Test-Path $verifyScript) {
  $output = & $DjangoPy $verifyScript 2>&1
  $summary = $output | Select-String -Pattern '驗證結果' | Select-Object -Last 1
  if ($summary -and $summary.ToString() -match '(\d+)/(\d+) PASS') {
    $pass = [int]$Matches[1]; $total = [int]$Matches[2]
    if ($pass -eq $total) {
      Write-Ok "展示資料 $pass/$total PASS"
    } else {
      Write-Bad "展示資料 $pass/$total PASS"
      $fail++
    }
  } else {
    Write-Warn2 '無法解析展示資料驗證結果'
  }
  $failLines = $output | Select-String -Pattern '\[FAIL\]'
  foreach ($l in $failLines) { Write-Host "         $($l.ToString().Trim())" -ForegroundColor DarkYellow }
} else {
  Write-Warn2 "找不到 $verifyScript"
}

# ---------------------------------------------------------------------------
#  總結
# ---------------------------------------------------------------------------
Write-Head '檢查結果'
Write-Host ''
if ($fail -eq 0) {
  Write-Host '  ✓ DEMO 環境健康，可以進行展示。' -ForegroundColor Green
  Write-Host ''
  Write-Host "  展示入口： $LiveUrl/" -ForegroundColor Green
  Write-Host "  學員登入： $DjangoUrl/login/" -ForegroundColor Green
  Write-Host "  教師登入： $DjangoUrl/teacher/login/" -ForegroundColor Green
  Write-Host ''
  exit 0
} else {
  Write-Host "  ✗ 發現 $fail 項問題，請先排除再展示。" -ForegroundColor Red
  Write-Host ''
  Write-Host "  日誌目錄：$LogRoot" -ForegroundColor Yellow
  Write-Host ''
  exit 1
}
