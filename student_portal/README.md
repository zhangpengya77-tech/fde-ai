# FDE-AI v1.5 學員平台

這是基於既有 v1.2 學習內容增加匿名帳號及管理功能的 Django 應用。v1.2 原始網站和 GitHub Pages 發布內容保持獨立。學員以 Email 驗證及登入，系統產生永久 FDE ID；課程 12 項任務與 R01-R08「我的學習成長日誌」分開保存。教師按指派課程檢視任務和成長記錄、證據並人工複核。AI 不評分、不訓練 YOLO，也不更新 RAG。

## Windows 本機啟動

在 PowerShell 進入 `student_portal`：

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python manage.py migrate
python manage.py seed_tasks
python manage.py createsuperuser
python manage.py runserver 127.0.0.1:8020
```

開啟 `http://127.0.0.1:8020/`。本機預設使用 SQLite 與 Django console email backend。註冊驗證碼及密碼重設連結只會顯示在執行伺服器的終端機，不會顯示在網頁；這只適合本機開發測試，不是寄信服務。

若要讓預覽使用獨立資料庫、保留預設 `db.sqlite3` 不動，可在啟動前設定：

```powershell
New-Item -ItemType Directory -Force .tmp | Out-Null
$env:DJANGO_DB_NAME = "$PWD\.tmp\preview.sqlite3"
```

## 教師與課程初始化

以 superuser 開啟 `/admin/`：

1. 建立開放加入的課程期別，例如 `2026-01`。
2. 建立教師使用者並授予 staff 權限，再於「教師班級存取權」指派可管理的課程。
3. 學員註冊及 Email 驗證後，從可加入課程選擇加入，不需要邀請碼或預先建立名冊。
4. 使用 `seed_tasks` 建立 12 項任務，使用 `seed_growth_records` 初始化 R01-R08；兩套學習記錄保持獨立。

學員用已驗證 Email 和密碼登入。教師只可看獲指派課程的學員，普通列表只顯示遮罩 Email。學生忘記密碼只會對已啟用的學員帳號寄送重設連結。

## 郵件與正式部署

`.env.example` 只列設定名稱與非敏感開發預設值；Django 不會自動載入 `.env`，請在部署主機的環境變數管理功能設定。開發預設用 console email backend，驗證碼只輸出在 Django 伺服器終端。真實寄信需設定 `DJANGO_EMAIL_BACKEND`、`DJANGO_EMAIL_HOST`、`DJANGO_EMAIL_PORT`、`DJANGO_EMAIL_HOST_USER`、`DJANGO_EMAIL_HOST_PASSWORD`、`DJANGO_EMAIL_USE_TLS` 和 `DEFAULT_FROM_EMAIL`。Gmail 密碼必須使用應用程式專用密碼，僅存在於環境變數中。

本機 Gmail 驗證郵件可執行 `scripts/start-v15-gmail.ps1`。腳本會在終端機隱藏輸入 Gmail 與 Google 應用程式專用密碼，先寄送測試郵件，再啟動本機服務；密碼不會寫入檔案或 Git。此腳本只供 v1.5 本機測試使用。

### 生產部署準備

生產模式 (`DJANGO_DEBUG=false`) 必須提供 `DJANGO_SECRET_KEY`、`DJANGO_ALLOWED_HOSTS`、`DJANGO_CSRF_TRUSTED_ORIGINS`、`DATABASE_URL`，以及指向持久化磁碟或掛載卷的 `DJANGO_MEDIA_ROOT`。缺少資料庫或持久媒體路徑時，Django 會拒絕啟動，避免將學員照片寫進可能重置的臨時磁碟。生產設定使用 HTTPS redirect、Secure cookies、代理 HTTPS 標頭與 HSTS；HTTPS 由反向代理或主機提供。

Linux WSGI 啟動命令：

```sh
python manage.py migrate
python manage.py collectstatic --noinput
gunicorn config.wsgi:application --bind 0.0.0.0:${PORT:-8000}
```

目前尚未選擇或設定正式 Django 主機、持久資料庫/媒體儲存與正式網域；Cloudflare Quick Tunnel 只供暫時測試。不得把 `private_media/`、SQLite 資料庫、信件憑證或 `.env` 提交到 Git，也不要用 Django `runserver` 對外公開。
