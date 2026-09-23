# R08 Career Explanation and Teacher Image Deletion Design

## Scope

Add a read-before-choice career explanation section to the existing R08 v2 survey, add the FPV option to the existing Q9 multi-select field, and provide teachers with a narrowly scoped POST action to delete one authorized image Evidence attachment.

The change must preserve existing StudentSurvey JSON data, R08 Evidence records, review state, scores, comments, video handling, v1.5B, Gateway, Worker, and runtime configuration.

## Existing Boundaries

- R08 v2 answers are stored in `StudentSurvey.v2_responses`; no schema change is required.
- Q9 is validated by `StudentSurveyV2Form` and stored as `q9_courses`; adding a choice is backward-compatible with existing JSON values.
- Teacher access is already represented by `teacher_required()` and `teacher_cohorts()`.
- Growth Evidence is attached to `GrowthRecordSubmission`; the delete action must target image Evidence only.

## Feature A: Career Explanation

Update the existing R08 v2 form choices and template:

- Add `FPV` to the Q9 course choices.
- Insert a Traditional Chinese explanation section immediately before Q9.
- Render four collapsible cards: industry UAS pilot, FPV professional pilot/engineering application, seed teacher/instructor, and UAS software/hardware integration engineer.
- Show each card's positioning, concise skills, application directions, and an expandable detailed list.
- Keep Q8 conditional behavior unchanged: Q9 and contact email remain visible only for the two advanced-interest answers.

No new model, field, or migration is needed. Existing older Q9 JSON values remain readable and are rendered through the choice-label fallback already used by the dashboard.

## Feature B: Teacher Image Deletion

Add a dedicated teacher-only POST endpoint:

`/teacher/evidence/<uuid:evidence_id>/delete/`

The view will:

1. Require authenticated staff access through `teacher_required()`.
2. Resolve only an image Evidence whose growth submission belongs to a cohort returned by `teacher_cohorts(request.user)`.
3. Reject GET and other methods with the existing Django method restriction.
4. Delete only the selected Evidence row and its file.
5. Preserve the parent GrowthRecordSubmission, all reviews, scores, teacher notes, other Evidence rows, and all videos.
6. Delete the physical file only when no other Evidence row references the same storage name.
7. Redirect to the authorized teacher student detail page with a confirmation message.

The teacher detail template will show a confirmation form beside image Evidence only. Video and non-image Evidence will not receive this control.

## Testing Strategy

Add tests before implementation for:

- Four career cards and the FPV Q9 option.
- Q9 max-two validation and existing Q8 conditional behavior.
- Authorized teacher image deletion.
- Unauthorized teacher denial.
- Student denial.
- GET rejection.
- Database row and file deletion.
- Preservation of other images, videos, parent record, score, and teacher note.
- Existing R08 survey and media upload regression coverage.

## Non-Goals

No migration, no email automation, no teacher notification, no video deletion, no Evidence refactor, no R01-R07 changes, and no runtime or Gateway changes.
