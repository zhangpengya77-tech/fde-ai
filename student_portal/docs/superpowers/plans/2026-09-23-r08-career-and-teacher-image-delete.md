# R08 Career Explanation and Teacher Image Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the approved R08 career explanation and FPV Q9 option, plus a teacher-only POST action for deleting one authorized image Evidence attachment.

**Architecture:** Reuse `StudentSurvey.v2_responses` and the existing v2 form/template/dashboard labels, so no migration is needed. Add a separate teacher endpoint with cohort-scoped lookup and image-only deletion; do not reuse the student delete view because its scope includes non-image media.

**Tech Stack:** Django forms/views/templates, existing JSONField survey storage, Django TestCase, existing private file storage.

**Spec:** `docs/superpowers/specs/2026-09-23-r08-career-explanation-teacher-image-delete-design.md`

## Global Constraints

- Do not modify v1.5B, the stable tag, Gateway, Worker, Quick Tunnel, RAG, YOLO, R01-R07, video processing, or database schema.
- Preserve all existing StudentSurvey JSON values and old Q9 values.
- Teacher deletion must be POST-only, CSRF-protected, staff-only, and restricted to the teacher's authorized cohorts.
- Delete images only; never expose deletion for video or other Evidence types.
- Preserve parent GrowthRecordSubmission, review status, scores, teacher notes, other images, and videos.
- Do not commit or push implementation until the user explicitly approves the completed diff.

## Review Focus

- Legacy Q9 JSON values: dashboard and detail views must render unknown/old values without errors; test in Task 1.
- Q8 conditional flow: adding the FPV choice must not expose Q9/email for non-advanced answers; test in Task 1.
- Shared storage names: deleting one Evidence must not remove a file referenced by another Evidence row; test in Task 2.
- Cross-cohort authorization: a staff user without the target cohort access must receive denial and retain the Evidence; test in Task 2.
- Non-image media: video and file Evidence must not be deletable through the new route; test in Task 2.

### Task 1: R08 Career Explanation and FPV Q9

**Files:**
- Modify: `learning/forms.py:515-536` to add the FPV Q9 choice.
- Modify: `learning/templates/learning/student_survey.html` before the existing advanced-course Q9 section.
- Modify: `learning/static/learning/student-survey.css` for the explanation cards if existing card rules are insufficient.
- Test: `learning/tests/test_student_survey_v2.py`.
- Test: `learning/tests/test_teacher_survey_dashboard.py` for Q9 label/statistics compatibility if needed.

**Interfaces:**
- Consumes: existing `StudentSurveyV2Form`, `q8_intent` conditional section, and `v2_responses["q9_courses"]`.
- Produces: a renderable Traditional Chinese career explanation section and the choice value `fpv_professional` with label `FPV 專業飛手／工程應用課程`.

- [ ] **Step 1: Write failing tests for the new visible content and choice**

Add tests that request the survey page and assert the page contains the explanation heading, all four career card titles, the seed-teacher activity `無人機足球`, and the technical terms `ROS 2`, `MAVLink`, and `Gazebo`. Add a form test asserting `fpv_professional` is accepted and is stored in `v2_responses["q9_courses"]`.

- [ ] **Step 2: Run the focused tests and verify the expected failures**

Run:

```powershell
python manage.py test learning.tests.test_student_survey_v2 -v 2
```

Expected: the new content assertions fail because the explanation section and FPV choice are absent.

- [ ] **Step 3: Implement the minimal form and template changes**

Add the FPV choice to `SURVEY_V2_COURSE_CHOICES`. Insert a section immediately before the existing Q9 form section with four `<details>` cards, concise positioning text, and the requested expanded learning/application lists. Keep the existing Q8-controlled `data-advanced-section` around Q9 and email unchanged.

- [ ] **Step 4: Run focused tests and then the survey regression tests**

Run:

```powershell
python manage.py test learning.tests.test_student_survey_v2 learning.tests.test_student_survey -v 2
```

Expected: all focused survey tests pass, including the existing Q9 max-two and email behavior.

### Task 2: Teacher Image Evidence Deletion

**Files:**
- Modify: `learning/urls.py` beside the existing teacher Evidence routes.
- Modify: `learning/views.py` near `promote_candidate` with a new `teacher_delete_image_evidence` view and a private storage-reference helper.
- Modify: `learning/templates/learning/teacher_student_detail.html` beside each growth-record image.
- Modify: `learning/static/learning/teacher-growth.css` only if the confirmation control needs existing layout styling.
- Test: `learning/tests/test_teacher_workflow.py`.

**Interfaces:**
- Consumes: `teacher_required`, `teacher_cohorts`, `Evidence`, `GrowthRecordSubmission`, `teacher_student_detail`, and Django CSRF/method decorators.
- Produces: `teacher_delete_image_evidence(request, evidence_id)` at `teacher/evidence/<uuid:evidence_id>/delete/`, returning a redirect to the authorized student detail page.

- [ ] **Step 1: Write failing tests for authorization, deletion, and preservation**

Create a real uploaded image with `SimpleUploadedFile` and a separate video Evidence. Add tests asserting:

```python
response = self.client.post(
    reverse("learning:teacher_delete_image_evidence", args=[image.evidence_id]),
)
self.assertRedirects(response, reverse("learning:teacher_student_detail", args=[self.enrollment.pk]))
self.assertFalse(Evidence.objects.filter(pk=image.pk).exists())
self.assertTrue(Evidence.objects.filter(pk=video.pk).exists())
self.assertTrue(GrowthRecordSubmission.objects.filter(pk=record.pk).exists())
```

Also assert the uploaded file no longer exists, the review score/note remain unchanged, unauthorized teachers and students receive denial, GET returns 405, and an image with a shared storage name does not delete the other row's file. Add a template assertion that only image Evidence renders the teacher delete form.

- [ ] **Step 2: Run the focused tests and verify the expected failures**

Run:

```powershell
python manage.py test learning.tests.test_teacher_workflow -v 2
```

Expected: import/reverse failures for the new route or 404/403 because the teacher endpoint does not exist yet.

- [ ] **Step 3: Implement the minimal teacher-only endpoint**

Add a POST-only route and view. Query Evidence with `growth_submission__enrollment__cohort__in=teacher_cohorts(request.user)` and `evidence_type=Evidence.Type.IMAGE`. Before deleting the `FieldFile`, check whether another Evidence row references the same `upload.name`; delete the physical storage object only when it is unreferenced, then delete only the selected Evidence row. Redirect to `teacher_student_detail` and add a success message. Do not alter the parent submission or review models.

- [ ] **Step 4: Add the confirmation form to the teacher detail template**

For image Evidence with an uploaded file, render a POST form with CSRF token, a clear `刪除此照片` button, and browser confirmation text `確定要刪除這張照片嗎？刪除後，該學員可以重新上傳新的照片。`. Render no such form for videos, files, links, or the student-facing page.

- [ ] **Step 5: Run focused deletion tests and the full regression suite**

Run:

```powershell
python manage.py test learning.tests.test_teacher_workflow learning.tests.test_student_survey_v2 -v 2
python manage.py test
python manage.py check
python manage.py makemigrations --check --dry-run
```

Expected: all tests pass, Django check passes, and `makemigrations --check --dry-run` reports no model changes.

### Task 3: Final Audit (No Commit Yet)

**Files:**
- Inspect only: all files changed by Tasks 1-2.

- [ ] **Step 1: Audit the diff and repository safety**

Run:

```powershell
git status --short
git diff --stat
git diff --name-only
```

Confirm only the approved R08/template/form/analytics/test/view/route files changed; confirm no database, media, runtime, secret, Gateway, or v1.5B files are present.

- [ ] **Step 2: Report results and stop before commit/push**

Report the actual files, whether Migration is `NONE`, deletion flow, focused/full test counts, Django check, and migration check. Do not commit or push until the user approves the completed diff.
