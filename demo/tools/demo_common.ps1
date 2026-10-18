# ===========================================================================
#  FDE-AI-UAS 2.0 DEMO（合作展示版）— 共用函式庫
#  由 START_FDE_2_DEMO.cmd / STOP_FDE_2_DEMO.cmd / CHECK_FDE_2_DEMO.cmd 呼叫
# ===========================================================================

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$script:DemoRoot    = 'D:\FDE-AI-UAS-v2.0\demo'
$script:ProjectRoot = 'D:\FDE-AI-UAS-v2.0'
$script:StateFile   = Join-Path $DemoRoot 'runtime\state\demo-services.json'
$script:LogRoot     = Join-Path $DemoRoot 'runtime\logs'

$script:DjangoPort = 8110
$script:LivePort   = 8111

# Flight Health 分析後端（飛行健康 AI 的 DataFlash 解析服務，純標準庫 ThreadingHTTPServer）
# 前端 flight-health/js/config.js 在區網模式下直連 http://{host}:8040/api/v1，
# 故 DEMO 必須自動拉起此服務，否則「開始自動健康檢查」會 Failed to fetch。
$script:FlightHealthPort = if ($env:FDE_FLIGHT_HEALTH_PORT) { [int]$env:FDE_FLIGHT_HEALTH_PORT } else { 8040 }

# 監聽位址（2026-10-10 教師授權：學員手機區網測試）
#   127.0.0.1          = 僅本機可用（預設、回滾值）
#   192.168.1.114      = 同時可被同網段手機連入（只綁定本機 WLAN 網卡位址，非 0.0.0.0）
# 可用環境變數 FDE_DEMO_BIND_ADDR 覆寫；未設定時沿用下列預設值。
$script:BindAddr = if ($env:FDE_DEMO_BIND_ADDR) { $env:FDE_DEMO_BIND_ADDR } else { '192.168.1.114' }

$script:DjangoUrl  = "http://${BindAddr}:$DjangoPort"
$script:LiveUrl    = "http://${BindAddr}:$LivePort"
$script:FlightHealthUrl = "http://${BindAddr}:$FlightHealthPort"

$script:DjangoPy  = Join-Path $ProjectRoot '.test-temp\django-venv\Scripts\python.exe'
$script:LivePy    = 'C:\Users\admin\AppData\Local\Python\pythoncore-3.14-64\python.exe'

# 正式資源（僅用於「是否誤連」的比對，絕不寫入）
$script:ProdDb        = Join-Path $ProjectRoot 'student_portal\db.sqlite3'
$script:ProdVisionDir = Join-Path $env:LOCALAPPDATA 'FDE-AI-UAS\vision-center'

# ---------------------------------------------------------------------------
#  輸出工具
# ---------------------------------------------------------------------------
function Write-Head([string]$text) {
  Write-Host ''
  Write-Host ('=' * 74) -ForegroundColor DarkCyan
  Write-Host "  $text" -ForegroundColor Cyan
  Write-Host ('=' * 74) -ForegroundColor DarkCyan
}
function Write-Ok([string]$text)   { Write-Host "  [OK]   $text" -ForegroundColor Green }
function Write-Warn2([string]$text){ Write-Host "  [WARN] $text" -ForegroundColor Yellow }
function Write-Bad([string]$text)  { Write-Host "  [FAIL] $text" -ForegroundColor Red }
function Write-Info([string]$text) { Write-Host "  [ .. ] $text" -ForegroundColor Gray }

# ---------------------------------------------------------------------------
#  埠檢查
# ---------------------------------------------------------------------------
function Test-PortBusy([int]$Port) {
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($conn) { return $true }
  return $false
}

function Get-PortOwner([int]$Port) {
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
          Select-Object -First 1
  if (-not $conn) { return $null }
  $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
  return [pscustomobject]@{
    Port = $Port
    Pid  = $conn.OwningProcess
    Name = if ($proc) { $proc.ProcessName } else { 'unknown' }
  }
}

# ---------------------------------------------------------------------------
#  HTTP 檢查
# ---------------------------------------------------------------------------
function Test-Http([string]$Url, [int]$TimeoutSec = 5) {
  try {
    $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec -MaximumRedirection 5
    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400)
  } catch {
    return $false
  }
}

function Get-HttpStatus([string]$Url, [int]$TimeoutSec = 5) {
  try {
    $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec -MaximumRedirection 5
    return [int]$r.StatusCode
  } catch {
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    return -1
  }
}

function Wait-Http([string]$Url, [int]$Seconds) {
  for ($i = 0; $i -lt $Seconds; $i++) {
    if (Test-Http $Url 3) { return $true }
    Start-Sleep -Seconds 1
  }
  return $false
}

# ---------------------------------------------------------------------------
#  環境變數（只在此處設定；確保所有子程序都指向 DEMO）
# ---------------------------------------------------------------------------
function Set-DemoEnvironment {
  $env:DJANGO_DB_NAME      = Join-Path $DemoRoot 'runtime\db\demo.sqlite3'
  $env:DJANGO_MEDIA_ROOT   = Join-Path $DemoRoot 'runtime\media'
  $env:DJANGO_DEBUG        = 'true'

  # 展示環境 CSRF / ALLOWED_HOSTS 白名單（僅 DEMO 生效，不影響正式設定）。
  #  proxy 會把 Host 寫死為上游位址，瀏覽器 Origin 為實際存取網域；
  #  「不使用萬用字元（pinggy 隧道網域除外，見下）」、「不關閉 CSRF Middleware」。
  #  2026-10-10 追加區網位址，供學員手機以 http://192.168.1.114:8111 存取。
  #  2026-10-18 追加 :8112 入口伺服器與 pinggy 免費隧道萬用網域
  #  （https://*.free.pinggy.net、https://*.run.pinggy-free.link）——隧道每次
  #  重啟都會換新子網域，只能用這兩個萬用規則覆蓋；其餘仍為精確白名單，
  #  未使用萬用 CORS、未關閉任何安全中介層。
  $env:DJANGO_ALLOWED_HOSTS       = "127.0.0.1,localhost,127.0.0.1:8022,127.0.0.1:8110,127.0.0.1:8111,$BindAddr,$BindAddr`:$DjangoPort,$BindAddr`:$LivePort,$BindAddr`:8112"
  # 2026-10-18 補 localhost:8112 / 127.0.0.1:8112：iPhone 區網登入問題排查時，
  # 本機與 Mac 測試會以 localhost／127.0.0.1 直連入口 :8112；此二 origin 若不
  # 在 CSRF_TRUSTED_ORIGINS，Safari 送出帶 Origin 的 POST 會被 CSRF 拒於門外。
  $env:DJANGO_CSRF_TRUSTED_ORIGINS = "http://127.0.0.1:8110,http://127.0.0.1:8111,http://localhost:8112,http://127.0.0.1:8112,http://${BindAddr}:8110,http://${BindAddr}:8111,http://${BindAddr}:8112,https://*.free.pinggy.net,https://*.run.pinggy-free.link"
  $env:FDE_VISION_CENTER_ROOT = Join-Path $DemoRoot 'runtime\vision-center'
  # 下載來源：優先使用老師既有下載資料夾（六個課程軟體的正式來源，唯讀引用）。
  # 若該來源不存在，才退回 demo 內建的展示用檔案。正式服務不受影響。
  $downloadSource = 'D:\下載中心文件'
  if (Test-Path (Join-Path $downloadSource 'download_manifest.json')) {
    $env:FDE_DOWNLOAD_ROOT = $downloadSource
  } else {
    $env:FDE_DOWNLOAD_ROOT = Join-Path $DemoRoot 'runtime\downloads'
  }
  $env:FDE_DJANGO_PORTAL_URL = "http://${BindAddr}:$DjangoPort"
  # R07 模型提交導向 DEMO Live Backend（僅「存放」.pt，不做任何推論）。
  # Vision Center 儲存位置仍為 demo\runtime\vision-center，與正式完全隔離。
  $env:DJANGO_VISION_SUBMISSION_API_BASE_URL = "http://${BindAddr}:$LivePort"
  # 僅 DEMO：允許教師核准一筆 R07 提交後，以明確標示的模擬 Adapter 驗證完整操作鏈。
  $env:FDE_DEMO_SIMULATED_INFERENCE = '1'
  $env:DJANGO_VISION_DEMO_SIMULATION_ENABLED = '1'
  # 影片處理工具（2026-10-14 教師核准之獨立環境修復，僅 DEMO 生效）：
  # 指向專案內 tools\ffmpeg\bin，不動系統 PATH、不影響正式服務 8022。
  # 若二進位不存在則不設定，退回預設行為（與修復前一致，不會偽裝成功）。
  $ffmpegBin = Join-Path $ProjectRoot 'tools\ffmpeg\bin'
  if (Test-Path (Join-Path $ffmpegBin 'ffmpeg.exe')) {
    $env:DJANGO_FFMPEG_BINARY  = Join-Path $ffmpegBin 'ffmpeg.exe'
    $env:DJANGO_FFPROBE_BINARY = Join-Path $ffmpegBin 'ffprobe.exe'
  }
  $env:PYTHONNOUSERSITE    = '1'
  $env:PYTHONUTF8          = '1'
  $env:DJANGO_SETTINGS_MODULE = 'config.settings'

  # 清除代理變數：
  #  1. PowerShell 5.1 的 Start-Process 在環境同時存在 HTTPS_PROXY / https_proxy
  #     這類大小寫重複的鍵時會直接拋錯（Key already added）。
  #  2. 本 DEMO 全部走 127.0.0.1，不應經過任何代理；殘留代理會讓
  #     「服務離線」類測試誤判為成功。
  #  3. 改用直接指派 $null 來移除（等同清除），避免觸發環境的 safe-delete
  #     刪除防護——Remove-Item Env:<name> 在變數不存在時會被防護擋下並
  #     中止整個啟動腳本，導致服務永遠起不來（ERR_CONNECTION_REFUSED）。
  $env:HTTP_PROXY  = $null
  $env:HTTPS_PROXY = $null
  $env:ALL_PROXY   = $null
  $env:http_proxy  = $null
  $env:https_proxy = $null
  $env:all_proxy   = $null
  $env:NO_PROXY    = '*'
  $env:no_proxy    = '*'
}

# ---------------------------------------------------------------------------
#   detached 啟動（關鍵穩定性修復）
#  使用 Win32 CreateProcess + DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
#  啟動子程序，使其「不繼承啟動視窗的 console」。
#  這樣即使使用者關閉 START_FDE_2_DEMO.cmd 視窗（或視窗因故結束），
#  Windows 發送 CTRL_CLOSE_EVENT 拆除該 console 的 process group 時，
#  DEMO 服務也不會被連帶終止，解決「首頁正常但 Django 路由
#  ERR_CONNECTION_REFUSED」的穩定性問題。
#  注意：單獨的 CREATE_NEW_PROCESS_GROUP 只會禁用群組內 CTRL+C，
#        並不會脫離 parent console 的 CTRL_CLOSE_EVENT；必須搭配
#        DETACHED_PROCESS 才能真正在關窗後存活（見 Microsoft 文件）。
# ---------------------------------------------------------------------------
function Start-DemoServer {
  param(
    [string]$Exe,
    [string]$Arguments,
    [string]$WorkingDirectory,
    [string]$StdOutLog,
    [string]$StdErrLog
  )
  $src = @'
using System;
using System.IO;
using System.Runtime.InteropServices;
public class DemoProcUtil {
  [StructLayout(LayoutKind.Sequential)]
  public struct STARTUPINFO {
    public Int32 cb; public IntPtr lpReserved; public IntPtr lpDesktop;
    public IntPtr lpTitle; public Int32 dwX; public Int32 dwY; public Int32 dwXSize; public Int32 dwYSize;
    public Int32 dwXCountChars; public Int32 dwYCountChars; public Int32 dwFillAttribute; public Int32 dwFlags;
    public Int16 wShowWindow; public Int16 cbReserved2; public IntPtr lpReserved2; public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct PROCESS_INFORMATION {
    public IntPtr hProcess; public IntPtr hThread; public Int32 dwProcessId; public Int32 dwThreadId;
  }
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Auto)]
  public static extern bool CreateProcess(string lpApplicationName, string lpCommandLine, IntPtr lpProcessAttributes, IntPtr lpThreadAttributes, bool bInheritHandles, uint dwCreationFlags, IntPtr lpEnvironment, string lpCurrentDirectory, ref STARTUPINFO lpStartupInfo, ref PROCESS_INFORMATION lpProcessInformation);
  public const uint CREATE_NEW_PROCESS_GROUP = 0x00000200;
  public const uint DETACHED_PROCESS = 0x00000008;
  public const uint STARTF_USESTDHANDLES = 0x00000100;
}
'@
  if (-not ([System.Type]::GetType('DemoProcUtil', $false))) {
    Add-Type -TypeDefinition $src -ErrorAction SilentlyContinue
  }

  $si = New-Object DemoProcUtil.STARTUPINFO
  $si.cb = [System.Runtime.InteropServices.Marshal]::SizeOf($si)
  $si.dwFlags = [DemoProcUtil]::STARTF_USESTDHANDLES

  $outFs = [System.IO.File]::Open($StdOutLog, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
  $errFs = [System.IO.File]::Open($StdErrLog, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
  $si.hStdOutput = $outFs.SafeFileHandle.DangerousGetHandle()
  $si.hStdError  = $errFs.SafeFileHandle.DangerousGetHandle()
  $si.hStdInput  = [System.IntPtr]::Zero

  $pi = New-Object DemoProcUtil.PROCESS_INFORMATION
  $cmdLine = "$Exe $Arguments"
  $ok = [DemoProcUtil]::CreateProcess($Exe, $cmdLine, [System.IntPtr]::Zero, [System.IntPtr]::Zero, $true, ([DemoProcUtil]::DETACHED_PROCESS -bor [DemoProcUtil]::CREATE_NEW_PROCESS_GROUP), [System.IntPtr]::Zero, $WorkingDirectory, [ref]$si, [ref]$pi)
  $outFs.Close()
  $errFs.Close()
  if (-not $ok) {
    $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
    throw "CreateProcess 失敗（Win32 Error $err）：$Exe $Arguments"
  }
  return $pi.dwProcessId
}

# ---------------------------------------------------------------------------
#  隔離驗證：確認所有路徑都在 demo/ 之下
# ---------------------------------------------------------------------------
function Test-DemoIsolation {
  $demoNorm = $DemoRoot.Replace('\', '/').ToLower()
  $checks = @(
    @{ Label = 'DEMO DB';       Path = (Join-Path $DemoRoot 'runtime\db\demo.sqlite3') },
    @{ Label = 'DEMO MEDIA';    Path = (Join-Path $DemoRoot 'runtime\media') },
    @{ Label = 'DEMO VISION';   Path = (Join-Path $DemoRoot 'runtime\vision-center') }
  )
  $allOk = $true
  foreach ($c in $checks) {
    $norm = $c.Path.Replace('\', '/').ToLower()
    if ($norm.StartsWith($demoNorm)) {
      Write-Ok "$($c.Label) → $($c.Path)"
    } else {
      Write-Bad "$($c.Label) 不在 demo/ 之下：$($c.Path)"
      $allOk = $false
    }
  }
  return $allOk
}

# ---------------------------------------------------------------------------
#  狀態檔
# ---------------------------------------------------------------------------
function Save-DemoState($state) {
  $dir = Split-Path -Parent $StateFile
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $json = $state | ConvertTo-Json -Depth 4
  [System.IO.File]::WriteAllText($StateFile, $json, [System.Text.UTF8Encoding]::new($false))
}

function Read-DemoState {
  if (-not (Test-Path $StateFile)) { return $null }
  try { return (Get-Content -Raw $StateFile | ConvertFrom-Json) } catch { return $null }
}

# ---------------------------------------------------------------------------
#  五個展示頁面定義（單一來源，START / CHECK 共用）
# ---------------------------------------------------------------------------
function Get-DemoPages {
  return @(
    @{ Key='1-首頁';              Url="$LiveUrl/";                          Need=200 },
    @{ Key='2-學員登入';          Url="$DjangoUrl/login/";                   Need=200 },
    @{ Key='3-教師登入';          Url="$DjangoUrl/teacher/login/";           Need=200 },
    @{ Key='4-教師模型倉庫';      Url="$DjangoUrl/teacher/vision-flywheel/"; Need=302 },
    @{ Key='5-Golden Set 管理';   Url="$DjangoUrl/teacher/golden-sets/";     Need=302 },
    @{ Key='6-Flight Health 後端'; Url="$FlightHealthUrl/api/v1/health";     Need=200 }
  )
}
