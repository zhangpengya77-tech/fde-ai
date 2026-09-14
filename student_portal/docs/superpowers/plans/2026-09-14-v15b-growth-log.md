# FDE-AI v1.5B-1 Implementation Plan

1. Add regression tests for cohort-scoped R01-R08 definitions, learner-owned growth pages, draft/submit behavior, and image limits/normalization.
2. Add configurable growth-record seed data, cohort group and definition/submission/review models, and an idempotent initialization command. Reuse Evidence while preserving legacy task evidence.
3. Add authenticated learner overview/detail routes, mobile-first templates, draft/submit actions, private image uploads, EXIF correction, resize to 1600px, and JPEG quality 80.
4. Run focused and full Django tests, migration checks, system check, inspect git scope, and verify the v1.2 worktree remains clean. Stop before video, teacher review UI, and R08 evidence selection.
