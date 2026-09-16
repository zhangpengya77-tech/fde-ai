# FDE-AI v1.5B Classroom Stable

## Recovery checkpoint

- Branch: `fde-ai-v1.5b`
- Tag: `v1.5B-classroom-stable`
- Commit: `bdc75f7e083e58f39277cc1132a0b494b5c95a17`

## Runtime

- Fixed student entry: https://fde-ai-gateway.fde-ai-gateway.workers.dev
- Public reference site: https://zhangpengya77-tech.github.io/fde-ai/
- Django project: `student_portal`
- Classroom launcher: `D:\FDE-AI-Gateway\start_fde_v15b_classroom.ps1`
- Django local service: `127.0.0.1:8022`
- RAG local service: `127.0.0.1:8770`
- Gateway Worker: `fde-ai-gateway`

The classroom launcher starts or reuses Django, RAG, and the Quick Tunnel, then updates the Worker origin. Students should use only the fixed Worker URL, never the temporary `trycloudflare.com` URL.

## Database and private data

Run migrations from `student_portal` with:

```powershell
.venv\Scripts\python.exe manage.py migrate
```

`db.sqlite3`, the local `backup/` directory, `.env`, `private_media/`, uploads, and learner evidence are runtime data and are intentionally excluded from GitHub. The pre-migration database backup is kept locally under `student_portal\backup\`.

GitHub restores the program source and configuration templates. Restore the database and private media from separate local backups before starting a replacement classroom machine.

## Validation commands

```powershell
.venv\Scripts\python.exe manage.py check
.venv\Scripts\python.exe manage.py makemigrations --check
.venv\Scripts\python.exe manage.py showmigrations
.venv\Scripts\python.exe manage.py test
```

Do not commit secrets, the database, private media, learner uploads, or API credentials.
