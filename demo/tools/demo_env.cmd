@echo off
chcp 65001 >nul
REM ===========================================================================
REM  FDE-AI-UAS 2.0 DEMO（合作展示版）— 環境變數定義
REM  這是唯一的隔離來源。START / STOP / CHECK 三個工具都呼叫此檔。
REM  嚴禁把任何路徑指向正式環境。
REM ===========================================================================

set "FDE_DEMO_ROOT=D:\FDE-AI-UAS-v2.0\demo"
set "FDE_PROJECT_ROOT=D:\FDE-AI-UAS-v2.0"

REM --- 隔離資源（全部在 demo\ 之下）-------------------------------------------
set "FDE_DEMO_DB=%FDE_DEMO_ROOT%\runtime\db\demo.sqlite3"
set "FDE_DEMO_MEDIA=%FDE_DEMO_ROOT%\runtime\media"
set "FDE_DEMO_VISION_ROOT=%FDE_DEMO_ROOT%\runtime\vision-center"
set "FDE_DEMO_LOG=%FDE_DEMO_ROOT%\runtime\logs"
set "FDE_DEMO_STATE=%FDE_DEMO_ROOT%\runtime\state"
REM  下載來源：優先使用老師既有下載資料夾（六個課程軟體正式來源，唯讀引用）。
REM  若不存在則退回 demo 內建的展示用檔案。
set "FDE_DEMO_DOWNLOADS_SOURCE=D:\下載中心文件"
if exist "%FDE_DEMO_DOWNLOADS_SOURCE%\download_manifest.json" (
  set "FDE_DEMO_DOWNLOADS=%FDE_DEMO_DOWNLOADS_SOURCE%"
) else (
  set "FDE_DEMO_DOWNLOADS=%FDE_DEMO_ROOT%\runtime\downloads"
)

REM --- 連接埠（已確認未占用；正式服務使用 8022 / 8770）-------------------------
set "FDE_DEMO_DJANGO_PORT=8110"
set "FDE_DEMO_LIVE_PORT=8111"

REM --- 監聽位址（2026-10-10 教師授權：學員手機區網測試）------------------------
REM  預設 127.0.0.1 僅本機可用；填入區網 IPv4 後，該位址同時可被同網段手機連入。
REM  只綁定指定網卡位址，非 0.0.0.0，不對外公開、不影響正式服務（8022/8770 不動）。
REM  回滾：把 FDE_DEMO_BIND_ADDR 改回 127.0.0.1 後重啟 DEMO 即可。
set "FDE_DEMO_BIND_ADDR=192.168.1.114"

REM --- Python 解譯器 ----------------------------------------------------------
REM  Django ：專用 venv（Python 3.12.13 + Django 5.2.17），不污染正式環境
set "FDE_DEMO_DJANGO_PY=%FDE_PROJECT_ROOT%\.test-temp\django-venv\Scripts\python.exe"
REM  Live Backend：需要 uvicorn + starlette
set "FDE_DEMO_LIVE_PY=C:\Users\admin\AppData\Local\Python\pythoncore-3.14-64\python.exe"

REM --- 隔離強制變數 ------------------------------------------------------------
REM  Django 讀這三個變數決定 DB / MEDIA / DEBUG
set "DJANGO_DB_NAME=%FDE_DEMO_DB%"
set "DJANGO_MEDIA_ROOT=%FDE_DEMO_MEDIA%"
set "DJANGO_DEBUG=true"
REM  展示環境 CSRF / ALLOWED_HOSTS 精確白名單（僅 DEMO 生效，不影響正式設定）。
REM  proxy 會把 Host 寫死為 127.0.0.1:8022，瀏覽器 Origin 為 127.0.0.1:8111；
REM  兩者都必須列入，且「不使用萬用字元」、「不關閉 CSRF Middleware」。
REM  2026-10-10 追加區網位址，供學員手機以 http://192.168.1.114:8111 存取。
set "DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost,127.0.0.1:8022,127.0.0.1:8110,127.0.0.1:8111,192.168.1.114,192.168.1.114:8110,192.168.1.114:8111"
set "DJANGO_CSRF_TRUSTED_ORIGINS=http://127.0.0.1:8110,http://127.0.0.1:8111,http://192.168.1.114:8110,http://192.168.1.114:8111"
REM  Live Backend 讀這兩組決定 Vision Store 與下載中心
set "FDE_VISION_CENTER_ROOT=%FDE_DEMO_VISION_ROOT%"
set "FDE_DOWNLOAD_ROOT=%FDE_DEMO_DOWNLOADS%"
REM  Live Backend 反代到 DEMO Django（不是正式 8022）
REM  2026-10-10：隨 FDE_DEMO_BIND_ADDR 調整，Django 綁定處即為反代目標。
set "FDE_DJANGO_PORTAL_URL=http://%FDE_DEMO_BIND_ADDR%:%FDE_DEMO_DJANGO_PORT%"
REM  R07 模型提交導向 DEMO Live Backend（僅「存放」.pt，不做任何推論）。
REM  Vision Center 儲存位置仍為 demo\runtime\vision-center，與正式完全隔離。
set "DJANGO_VISION_SUBMISSION_API_BASE_URL=http://%FDE_DEMO_BIND_ADDR%:%FDE_DEMO_LIVE_PORT%"

REM --- 其他 --------------------------------------------------------------------
set "PYTHONNOUSERSITE=1"
set "PYTHONUTF8=1"
set "DJANGO_SETTINGS_MODULE=config.settings"
