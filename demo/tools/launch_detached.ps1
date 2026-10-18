# ===========================================================================
#  FDE-AI-UAS 2.0 DEMO — 以「完全脫離」方式啟動服務（供本輪驗收使用）
#  與 START_FDE_2_DEMO.cmd 等價的環境設定，但用 WMI Win32_Process.Create
#  啟動，使子行程不隨呼叫端工作階段結束而終止。
#  只綁定 DEMO 埠 8110 / 8111，絕不觸碰正式 8022 / 8770。
# ===========================================================================
param([switch]$Stop)

$DemoRoot    = 'D:\FDE-AI-UAS-v2.0\demo'
$ProjectRoot = 'D:\FDE-AI-UAS-v2.0'
$DjangoPy    = Join-Path $ProjectRoot '.test-temp\django-venv\Scripts\python.exe'
$LivePy      = 'C:\Users\admin\AppData\Local\Python\pythoncore-3.14-64\python.exe'
$BindAddr    = '192.168.1.114'
$LogRoot     = Join-Path $DemoRoot 'runtime\logs'

$sb = New-Object System.Text.StringBuilder
function L($m) { [void]$sb.AppendLine($m) }
function Flush { [System.IO.File]::WriteAllText((Join-Path $LogRoot '_detached_launch.txt'), $sb.ToString(), [System.Text.UTF8Encoding]::new($false)) }

if ($Stop) {
  Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
    Where-Object { $_.CommandLine -match '8110|8111' } |
    ForEach-Object {
      L("stopping PID $($_.ProcessId): $($_.CommandLine)")
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
  Flush; Write-Output 'stopped'; exit 0
}

New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null

# --- 共用環境變數（與 demo_common.ps1 的 Set-DemoEnvironment 一致）----------
$envBlock = @(
  "DJANGO_DB_NAME=$DemoRoot\runtime\db\demo.sqlite3",
  "DJANGO_MEDIA_ROOT=$DemoRoot\runtime\media",
  "DJANGO_DEBUG=true",
  "DJANGO_SECRET_KEY=demo-only-not-production",
  "DJANGO_SETTINGS_MODULE=config.settings",
  "DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost,127.0.0.1:8022,127.0.0.1:8110,127.0.0.1:8111,$BindAddr,${BindAddr}:8110,${BindAddr}:8111",
  "DJANGO_CSRF_TRUSTED_ORIGINS=http://127.0.0.1:8110,http://127.0.0.1:8111,http://${BindAddr}:8110,http://${BindAddr}:8111",
  "FDE_VISION_CENTER_ROOT=$DemoRoot\runtime\vision-center",
  "FDE_DOWNLOAD_ROOT=$DemoRoot\runtime\downloads",
  "FDE_DJANGO_PORTAL_URL=http://${BindAddr}:8110",
  "DJANGO_VISION_SUBMISSION_API_BASE_URL=http://${BindAddr}:8111",
  "PYTHONNOUSERSITE=1",
  "PYTHONUTF8=1",
  "NO_PROXY=*",
  "no_proxy=*",
  "HTTP_PROXY=",
  "HTTPS_PROXY=",
  "http_proxy=",
  "https_proxy=",
  "ALL_PROXY=",
  "all_proxy="
)

# 組出單一 cmd 行：先 set 環境變數，再切換目錄，最後啟動
function Build-Cmd([string]$python, [string]$args, [string]$cwd) {
  $parts = @()
  foreach ($e in $envBlock) { $parts += "set `"$e`"" }
  $parts += "cd /d `"$cwd`""
  $parts += "`"$python`" $args"
  return ($parts -join ' && ')
}

$jobs = @(
  @{ Name='django'; Exe='cmd.exe'; Args='/c ' + (Build-Cmd $DjangoPy 'manage.py runserver ' + $BindAddr + ':8110 --noreload' (Join-Path $ProjectRoot 'student_portal')); Cwd=$ProjectRoot },
  @{ Name='live';   Exe='cmd.exe'; Args='/c ' + (Build-Cmd $LivePy   '-m uvicorn app.main:app --host ' + $BindAddr + ' --port 8111' (Join-Path $ProjectRoot 'live_backend'));     Cwd=$ProjectRoot }
)

foreach ($j in $jobs) {
  $out = Join-Path $LogRoot ("$($j.Name).manual.log")
  $cmd = "$($j.Exe) $($j.Args) > `"$out`" 2>&1"
  $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine      = $cmd
    CurrentDirectory = $j.Cwd
  }
  L("$($j.Name): ReturnValue=$($r.ReturnValue) PID=$($r.ProcessId)")
}

Start-Sleep -Seconds 10
Flush

# 健康檢查
$dOk = $false; $lOk = $false
try { $dOk = (Invoke-WebRequest "http://${BindAddr}:8110/login/" -UseBasicParsing -TimeoutSec 8).StatusCode -eq 200 } catch {}
try { $lOk = (Invoke-WebRequest "http://${BindAddr}:8111/api/live/health" -UseBasicParsing -TimeoutSec 8).StatusCode -eq 200 } catch {}
L("health django=$dOk live=$lOk")
Flush
Write-Output "django=$dOk live=$lOk"
