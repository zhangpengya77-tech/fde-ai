# FDE-AI v1.5 學員任務平台

這是與既有 v1.2 靜態網站分離的 Django MVP。它提供名冊綁定註冊、電子郵件驗證、學員登入、T01-T12 任務、學習證據，以及教師班級複核。任務不互相鎖定；系統不評分、不訓練 YOLO，也不更新 RAG。

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

## 教師初始化

以 superuser 開啟 `/admin/`：

1. 建立班級，例如 `2026-01`。
2. 預先建立學員名冊：永久學員 ID、教師可見真實姓名、學員可見暱稱，可選填名冊預期信箱。
3. 建立教師使用者並授予 staff 權限，再於「教師班級存取權」指派班級。
4. 使用 `seed_tasks` 建立初始 12 項任務；之後可在任務管理中編輯內容。學生已有的任務會保留舊版本快照。

學員以名冊中的 `YYYY-MM-SNN`、信箱及密碼註冊，完成信箱驗證後以學員 ID 和密碼登入。學員信箱全域唯一；已註冊的 ID 不可再次認領。學生忘記密碼只會對已啟用的學員帳號寄送重設連結。

## 郵件與正式部署

`.env.example` 列出設定名稱供參考；Django 不會自動載入 `.env`，請由部署平台的環境變數管理功能設定。寄信需要設定 `DJANGO_EMAIL_BACKEND`、`DJANGO_EMAIL_HOST`、`DJANGO_EMAIL_PORT`、`DJANGO_EMAIL_HOST_USER`、`DJANGO_EMAIL_HOST_PASSWORD`、`DJANGO_EMAIL_USE_TLS` 和 `DEFAULT_FROM_EMAIL`。

本機 Gmail 驗證郵件可執行 `scripts/start-v15-gmail.ps1`。腳本會在終端機隱藏輸入 Gmail 與 Google 應用程式專用密碼，先寄送測試郵件，再啟動本機服務；密碼不會寫入檔案或 Git。此腳本只供 v1.5 本機課堂服務使用。

目前僅設定本機 SQLite 與檔案系統私有證據目錄。對外提供服務前，必須另行完成 HTTPS、正式 WSGI/ASGI 主機、持久化資料庫與備份、私有檔案儲存與備份、SMTP、主機網域與 CSRF/Allowed Hosts 設定，並執行外部安全測試。不得把 `private_media/`、SQLite 資料庫、信件憑證或 `.env` 提交到 Git。不要以 Django `runserver` 對外公開。
