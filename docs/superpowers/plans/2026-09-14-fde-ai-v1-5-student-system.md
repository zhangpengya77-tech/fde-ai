# FDE-AI v1.5 Student System Implementation Plan

## Scope and safety boundary

- Work only on branch `fde-ai-v1.5` in the separate `FDE-AI-v1.5` worktree.
- Keep the sibling `FDE-AI-v1.2` worktree on `fde-ai-v1.2`; do not alter its files, branch, or Pages deployment.
- Add a standalone Django portal under `student_portal/`. Do not change the existing static website, YOLO, Rule Engine, RAG, AI assistant, FDE column, or GitHub Pages configuration.
- Use an isolated Python 3.12 virtual environment. Do not change Windows global Python 3.14.
- No push or deployment in this development task. Local development email may use Django's console backend; codes must never be returned in page/API responses. Production must use configured SMTP and durable/private storage.

## Architecture decisions

- Django 5.2 LTS, pinned to the current security patch (`5.2.17`), with server-rendered pages and Django sessions/CSRF.
- SQLite only for local development. Production hosting/database, private object storage, HTTPS domain, and SMTP credentials remain deployment prerequisites.
- A teacher preloads cohorts and student roster records (including teacher-only legal names and learner-facing masked display names). Learner self-registration requires an existing, unclaimed `student_id`, email, and password; email activation is required before sign-in. Daily sign-in uses `student_id + password`; password reset uses Django's email flow.
- The stable identifier is `YYYY-NN-SNN`; it is unique and never derived from a display name.
- Seed T01-T12 from a versioned JSON data file. Each task can be opened independently. Status and phase progress are records, not navigation locks.
- Evidence is a separate model. Uploaded files are stored outside static assets and served only through authenticated ownership/teacher checks. External links remain metadata; no large assets enter Git.
- Teacher users can use a dedicated dashboard for roster, cohort/task progress, filters, evidence, review history, comments and optional scores; Django admin is an additional management surface.
- Candidate-pool fields record explicit teacher promotion only. No automatic dataset promotion, model training, RAG ingestion, or AI scoring.

## Implementation tasks

1. Add this plan and commit a v1.5 planning checkpoint.
2. Create isolated Django project, settings, version constraints, local environment template, private upload configuration, and idempotent default-task seeding command.
3. Add failing tests for roster-bound registration, email activation, student-ID login, duplicate registration, and password-reset privacy; then implement the authentication flow.
4. Add failing tests for independent task access, task status/phase persistence, evidence ownership, and protected downloads; then implement learner task and evidence pages.
5. Add failing tests for teacher-only access, cohort/student filters, review transitions/history, task editing, and explicit candidate approval; then implement teacher dashboard and admin.
6. Document local setup and deployment prerequisites. Run portal tests, Django system checks, and existing v1.2 JavaScript tests. Verify only the dedicated v1.5 branch contains changes and commit the tested implementation.

## Acceptance checks

- Students can register only a teacher-preloaded ID once; activation code is delivered through configured email backend, not rendered into a response.
- Students log in with ID/password, can request a password reset, and can only access their own profile, progress, evidence, and files.
- Exactly 12 editable initial tasks are seeded. Opening or updating one task never depends on another task's completion.
- Submission, teacher review/incomplete result, timestamps, notes, optional teacher score, and review history persist.
- Teacher dashboard filters by cohort and review/status categories; teachers alone can manage rosters/tasks and review evidence.
- Uploads remain private and are not committed. Candidate promotion requires an explicit teacher action and has no training/RAG side effect.
- Existing v1.2 files and branch remain unchanged; all existing JS tests still pass.
- Local portal URL is reported separately from the existing GitHub Pages site. Do not claim public-ready until hosting, HTTPS, production DB/storage, and SMTP are configured and externally tested.
