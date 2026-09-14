# FDE-AI v1.5B Checkpoint

- Version: FDE-AI v1.5B
- Branch: `fde-ai-v1.5b`
- Base: `fde-ai-v1.5` at `ab9a24b`
- Previous v1.5B code checkpoint: `0299934`

## Included

- Anonymous learner accounts with automatically generated, permanent FDE IDs and student login.
- Cohort, enrollment, and learning-group models.
- The student course entry and R01-R08 Growth Record pages.
- Versioned R01-R08 definitions in `student_portal/learning/data/growth_records_v1.json`.
- Image evidence upload, validation, orientation correction, JPEG compression, resizing, and HEIC decoding.
- Mobile-first learner pages and the current teacher learner list and per-record review flow, including status, score, and feedback.
- Django migrations through `0008` and the test suite.
- `seed_v15b_test_cohort` recreates the `2026-09` v1.5B test cohort, Group C (航线规划组), R01-R08 definitions, and missing submissions for active enrollments. It is safe to run repeatedly and does not create accounts or overwrite differently named existing cohort/group records.

## Restore from GitHub

From the repository root:

```powershell
git checkout fde-ai-v1.5b
cd student_portal
python -m venv .venv
pip install -r requirements.txt
python manage.py migrate
python manage.py seed_tasks
python manage.py seed_v15b_test_cohort
python manage.py test learning.tests
```

`seed_tasks` restores the editable starter task definitions. `seed_v15b_test_cohort` restores the test cohort and growth-record definitions. `create_qa_accounts` can create separate local QA student/teacher accounts and generates one-time random passwords; it does not restore real learner accounts or their records.

For local development, Django defaults to SQLite and console email. Production startup requires the environment variables and durable database/media configuration documented in `student_portal/README.md`.

## Verification at Checkpoint

- Tests: 71 passed.
- `manage.py check`: no issues.
- `makemigrations --check --dry-run`: no model changes pending a migration.
- `migrate --check`: no unapplied migrations in the local database.
- `pip check`: no broken dependencies.
- `fde-ai-v1.2`: separate worktree remains clean and unchanged.

## Not Included Yet

- Real Gmail SMTP credentials and an actual delivery verification.
- Production Django hosting, production database, and persistent media/object storage.
- FFmpeg video upload/transcoding.
- R08 selection of 3-5 existing evidence items; current tests document this as unavailable.
- Group-specific R07 definition content beyond the shared R07 definition and the seeded Group C membership.
- Physical iPhone/Android camera upload acceptance; responsive layout and image-processing tests are not a substitute for device testing.

Teacher per-record review is implemented; this checkpoint does not claim a course-wide final grade aggregation feature.

## Runtime Data Backups

The Git repository contains program code and initialization configuration, not live learner data. Back up `student_portal/db.sqlite3` (or the production database) and `student_portal/private_media/` separately. These may contain account records, password hashes, learning records, reviews, and uploaded evidence. Keep `.env`, SMTP passwords, `SECRET_KEY`, and other deployment secrets in a secure secret store; never commit them.

The `fde-ai-v1.2` branch and published GitHub Pages are not modified by this checkpoint.
