from io import BytesIO

from django.contrib import admin
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, RequestFactory, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from PIL import Image

from learning.models import (
    CandidatePool,
    ClassCode,
    Cohort,
    Enrollment,
    Evidence,
    GrowthRecordReview,
    GrowthRecordSubmission,
    LearningGroup,
    StudentProfile,
    StudentSurvey,
    StudentTaskProgress,
    TaskDefinition,
    TeacherCohortAccess,
    TeacherReviewEvent,
)
from learning.growth_records import ensure_growth_submissions
from learning.tests.helpers import create_student_account, enroll_student


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class TeacherWorkflowTests(TestCase):
    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="2026-01", name="2026 第一梯")
        self.student = create_student_account()
        self.enrollment = enroll_student(self.student, self.cohort)
        self.teacher = get_user_model().objects.create_user(
            username="teacher", email="teacher@example.com", password="Another-strong-passphrase-911!", is_staff=True
        )
        TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=self.cohort)
        self.task = TaskDefinition.objects.create(
            task_id="T06", sort_order=6, stage=TaskDefinition.Stage.BUILD, title="F450 組裝"
        )
        self.progress = StudentTaskProgress.objects.create(
            enrollment=self.enrollment, task=self.task, status=StudentTaskProgress.Status.SUBMITTED
        )

    def test_only_teacher_can_open_review_dashboard(self):
        self.client.force_login(self.student.user)
        response = self.client.get(reverse("learning:teacher_dashboard"))
        self.assertEqual(response.status_code, 403)

        self.client.force_login(self.teacher)
        response = self.client.get(reverse("learning:teacher_dashboard"))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, self.student.public_user_id)

    def test_teacher_cannot_read_or_review_an_unassigned_cohort(self):
        other_cohort = Cohort.objects.create(cohort_id="2026-02", name="2026 第二梯")
        other_teacher = get_user_model().objects.create_user(
            username="teacher2", email="teacher2@example.com", password="Another-strong-passphrase-912!", is_staff=True
        )
        TeacherCohortAccess.objects.create(teacher=other_teacher, cohort=other_cohort)
        self.client.force_login(other_teacher)

        detail = self.client.get(reverse("learning:teacher_student_detail", args=[self.enrollment.pk]))
        review = self.client.post(
            reverse("learning:review_task", args=[self.progress.pk]),
            {"result": TeacherReviewEvent.Result.REVIEWED, "note": "不能跨班查看", "score": ""},
        )

        self.assertEqual(detail.status_code, 404)
        self.assertEqual(review.status_code, 404)
        self.assertFalse(TeacherReviewEvent.objects.filter(progress=self.progress).exists())

    def test_teacher_dashboard_shows_growth_progress_group_and_last_activity(self):
        self.client.force_login(self.student.user)
        self.client.get(reverse("learning:student_growth_dashboard", args=[self.enrollment.pk]))
        submissions = {
            item.definition.slot_id: item
            for item in GrowthRecordSubmission.objects.filter(enrollment=self.enrollment).select_related("definition")
        }
        submissions["R01"].status = GrowthRecordSubmission.Status.SUBMITTED
        submissions["R01"].save(update_fields=["status", "updated_at"])
        for slot_id, status in (
            ("R02", GrowthRecordSubmission.Status.APPROVED),
            ("R03", GrowthRecordSubmission.Status.NEEDS_REVISION),
        ):
            submission = submissions[slot_id]
            submission.status = status
            submission.save(update_fields=["status", "updated_at"])
            GrowthRecordReview.objects.create(
                submission=submission,
                reviewer=self.teacher,
                review_status=status,
                score=88,
                teacher_note="已複核",
            )
        group = LearningGroup.objects.create(cohort=self.cohort, code="C", name="航線規劃組")
        self.enrollment.group = group
        self.enrollment.save(update_fields=["group"])
        self.client.force_login(self.teacher)

        response = self.client.get(reverse("learning:teacher_dashboard"))

        row = next(item for item in response.context["rows"] if item["student"] == self.student)
        self.assertEqual(row["growth_submitted_count"], 3)
        self.assertEqual(row["growth_reviewed_count"], 2)
        self.assertEqual(row["growth_pending_count"], 1)
        self.assertEqual(row["group"], group)
        self.assertIsNotNone(row["last_activity"])
        self.assertEqual(row["email_masked"], "st***@example.com")
        self.assertContains(response, "3 / 8")
        self.assertContains(response, "2 / 8")
        self.assertContains(response, "航線規劃組")

    def test_teacher_can_review_growth_record_and_student_sees_feedback(self):
        self.client.force_login(self.student.user)
        self.client.get(reverse("learning:student_growth_dashboard", args=[self.enrollment.pk]))
        submission = GrowthRecordSubmission.objects.get(
            enrollment=self.enrollment, definition__slot_id="R01"
        )
        submission.status = GrowthRecordSubmission.Status.SUBMITTED
        submission.submitted_at = timezone.now()
        submission.save(update_fields=["status", "submitted_at", "updated_at"])
        Evidence.objects.create(
            growth_submission=submission,
            evidence_type=Evidence.Type.IMAGE,
            external_url="https://example.test/r01.jpg",
            description="R01 刷題證據",
        )
        self.client.force_login(self.teacher)

        detail = self.client.get(reverse("learning:teacher_student_detail", args=[self.enrollment.pk]))

        self.assertEqual(detail.status_code, 200)
        self.assertEqual(len(detail.context["growth_records"]), 8)
        self.assertContains(detail, 'id="growth-review"')
        self.assertContains(detail, "R01～R08 詳細教師複核")
        self.assertNotContains(detail, "原有 12 項任務與證據（保留參考）")
        for number in range(1, 9):
            self.assertContains(detail, f"R{number:02d}")
        self.assertContains(detail, "R01 刷題證據")

        response = self.client.post(
            reverse("learning:growth_review", args=[submission.pk]),
            {"review_status": "approved", "score": "91", "teacher_note": "操作紀錄完整"},
        )

        self.assertRedirects(response, reverse("learning:teacher_student_detail", args=[self.enrollment.pk]))
        submission.refresh_from_db()
        self.assertEqual(submission.status, GrowthRecordSubmission.Status.APPROVED)
        self.assertEqual(str(submission.teacher_final_score), "91.00")
        review = GrowthRecordReview.objects.get(submission=submission)
        self.assertEqual(review.reviewer, self.teacher)
        self.assertEqual(review.teacher_note, "操作紀錄完整")

        self.client.force_login(self.student.user)
        student_detail = self.client.get(
            reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R01"])
        )
        self.assertContains(student_detail, "操作紀錄完整")
        self.assertContains(student_detail, "91.00")

    def test_teacher_review_page_shows_current_enrollment_r08_survey(self):
        ensure_growth_submissions(self.enrollment)
        r08 = GrowthRecordSubmission.objects.get(
            enrollment=self.enrollment, definition__slot_id="R08"
        )
        StudentSurvey.objects.create(
            student=self.student,
            enrollment=self.enrollment,
            growth_record=r08,
            a01=5,
            a02=1,
            a03=0,
            a04=0,
            a05=0,
            a06=0,
            a07=0,
            survey_version="v2",
            v2_responses={
                "q1_helpfulness": "very_helpful",
                "q2_practice_ratio": "more_practice",
                "q3_topics": ["flight_license"],
                "q3_other": "",
                "q4_improvements": ["practical_time"],
                "q4_other": "",
                "q5_feedback": "希望增加更多實作",
                "q6_interests": ["physical_ai"],
                "q7_paths": ["industry_pilot"],
                "q8_intent": "learn_more",
                "q9_courses": ["fpv_professional"],
                "contact_phone": "0912-345-678",
            },
            contact_email="career@example.com",
        )
        self.client.force_login(self.teacher)
        response = self.client.get(reverse("learning:teacher_student_detail", args=[self.enrollment.pk]))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "R08｜學員結訓回饋與發展調查")
        self.assertContains(response, "希望增加更多實作")
        self.assertEqual(response.context["r08_q6_labels"], ["Physical AI（實體人工智慧）與智能無人系統"])
        self.assertContains(response, "行業無人機飛手")
        self.assertContains(response, "有興趣，想先了解進階課程內容")
        self.assertContains(response, "FPV 專業飛手／工程應用課程")
        self.assertContains(response, "career@example.com")
        self.assertContains(response, "0912-345-678")
        self.assertContains(response, "職業發展方向參考")
        self.assertContains(response, "FPV 專業飛手／工程應用")
        self.assertContains(response, "無人機種子教師／教官")
        self.assertContains(response, "無人機足球")
        self.assertContains(response, "ROS 2")
        self.assertContains(response, "MAVLink")
        self.assertContains(response, "✓ 職業方向選擇")
        self.assertContains(response, "★ 想進一步了解")
        self.assertContains(response, 'data-career-path="industry_pilot"')
        self.assertContains(response, 'data-career-selected="true"')
        self.assertNotContains(response, 'data-career-path="seed_instructor" data-career-selected="true"')
        self.assertNotContains(response, 'name="q7_paths"')

    def test_teacher_review_separates_q7_and_q9_badges(self):
        ensure_growth_submissions(self.enrollment)
        r08 = GrowthRecordSubmission.objects.get(enrollment=self.enrollment, definition__slot_id="R08")
        StudentSurvey.objects.create(
            student=self.student,
            enrollment=self.enrollment,
            growth_record=r08,
            a01=0,
            a02=0,
            a03=0,
            a04=0,
            a05=0,
            a06=0,
            a07=0,
            survey_version="v2",
            v2_responses={
                "q7_paths": ["undecided"],
                "q9_courses": ["seed_instructor", "software_engineer"],
            },
        )
        self.client.force_login(self.teacher)
        response = self.client.get(reverse("learning:teacher_student_detail", args=[self.enrollment.pk]))

        self.assertEqual(response.status_code, 200)
        self.assertNotContains(response, "✓ 職業方向選擇")
        self.assertEqual(response.content.decode().count("★ 想進一步了解"), 2)
        self.assertNotContains(response, 'name="q7_paths"')

    def test_teacher_review_page_handles_missing_r08_survey(self):
        self.client.force_login(self.teacher)
        response = self.client.get(reverse("learning:teacher_student_detail", args=[self.enrollment.pk]))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "此學員尚未填寫 R08 結訓回饋與進階發展調查。")
        self.assertNotContains(response, "職業發展方向參考")
        self.assertNotContains(response, "FPV 專業飛手／工程應用")

    def test_assigned_teacher_can_preview_private_growth_photo(self):
        with override_settings(
            STORAGES={
                "default": {"BACKEND": "django.core.files.storage.InMemoryStorage"},
                "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
            }
        ):
            self.client.force_login(self.student.user)
            self.client.get(reverse("learning:student_growth_dashboard", args=[self.enrollment.pk]))
            image_buffer = BytesIO()
            Image.new("RGB", (16, 12), color="teal").save(image_buffer, format="JPEG")
            upload_response = self.client.post(
                reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R01"]),
                {
                    "action": "save_draft",
                    "student_note": "教師端照片查看驗收",
                    "images": [SimpleUploadedFile("r01.jpg", image_buffer.getvalue(), content_type="image/jpeg")],
                },
                follow=True,
            )
            self.assertEqual(upload_response.status_code, 200)
            evidence = Evidence.objects.get(
                growth_submission__enrollment=self.enrollment,
                growth_submission__definition__slot_id="R01",
            )
            self.client.force_login(self.teacher)

            detail = self.client.get(reverse("learning:teacher_student_detail", args=[self.enrollment.pk]))
            preview = self.client.get(reverse("learning:evidence_download", args=[evidence.pk]) + "?inline=1")

            self.assertContains(detail, "教師端照片查看驗收")
            self.assertContains(detail, 'alt="R01 學習證據"')
            self.assertEqual(preview.status_code, 200)
            self.assertEqual(preview["Content-Type"], "image/jpeg")
            self.assertTrue(preview["Content-Disposition"].startswith("inline;"))
            preview.close()

    def test_authorized_teacher_can_delete_one_image_without_touching_record_review_or_video(self):
        with override_settings(
            STORAGES={
                "default": {"BACKEND": "django.core.files.storage.InMemoryStorage"},
                "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
            }
        ):
            self.client.force_login(self.student.user)
            ensure_growth_submissions(self.enrollment)
            record = GrowthRecordSubmission.objects.get(
                enrollment=self.enrollment, definition__slot_id="R01"
            )
            record.status = GrowthRecordSubmission.Status.APPROVED
            record.teacher_final_score = 92
            record.save(update_fields=["status", "teacher_final_score", "updated_at"])
            review = GrowthRecordReview.objects.create(
                submission=record,
                reviewer=self.teacher,
                review_status=GrowthRecordReview.Status.APPROVED,
                score=92,
                teacher_note="保留原評語",
            )
            first = Evidence.objects.create(
                growth_submission=record,
                evidence_type=Evidence.Type.IMAGE,
                description="錯誤照片",
                upload=SimpleUploadedFile("wrong.jpg", b"image-one", content_type="image/jpeg"),
            )
            second = Evidence.objects.create(
                growth_submission=record,
                evidence_type=Evidence.Type.IMAGE,
                description="正確照片",
                upload=SimpleUploadedFile("right.jpg", b"image-two", content_type="image/jpeg"),
            )
            video = Evidence.objects.create(
                growth_submission=record,
                evidence_type=Evidence.Type.VIDEO,
                upload=SimpleUploadedFile("flight.mp4", b"video", content_type="video/mp4"),
            )
            first_name = first.upload.name
            self.client.force_login(self.teacher)

            detail = self.client.get(reverse("learning:teacher_student_detail", args=[self.enrollment.pk]))
            response = self.client.post(
                reverse("learning:teacher_delete_image_evidence", args=[first.pk]),
            )

            self.assertContains(detail, "刪除此照片")
            self.assertEqual(response.status_code, 302)
            self.assertFalse(Evidence.objects.filter(pk=first.pk).exists())
            self.assertTrue(Evidence.objects.filter(pk=second.pk).exists())
            self.assertTrue(Evidence.objects.filter(pk=video.pk).exists())
            self.assertTrue(GrowthRecordSubmission.objects.filter(pk=record.pk).exists())
            self.assertTrue(GrowthRecordReview.objects.filter(pk=review.pk).exists())
            record.refresh_from_db()
            review.refresh_from_db()
            self.assertEqual(str(record.teacher_final_score), "92.00")
            self.assertEqual(review.teacher_note, "保留原評語")
            self.assertFalse(first.upload.storage.exists(first_name))

    def test_teacher_image_delete_is_post_only_and_cohort_scoped(self):
        ensure_growth_submissions(self.enrollment)
        record = GrowthRecordSubmission.objects.get(
            enrollment=self.enrollment, definition__slot_id="R01"
        )
        image = Evidence.objects.create(
            growth_submission=record,
            evidence_type=Evidence.Type.IMAGE,
            external_url="https://example.test/wrong.jpg",
        )
        self.client.force_login(self.teacher)
        self.assertEqual(
            self.client.get(reverse("learning:teacher_delete_image_evidence", args=[image.pk])).status_code,
            405,
        )

        self.client.force_login(self.student.user)
        self.assertEqual(
            self.client.post(reverse("learning:teacher_delete_image_evidence", args=[image.pk])).status_code,
            403,
        )

        other_cohort = Cohort.objects.create(cohort_id="2026-02", name="未授權班")
        other_teacher = get_user_model().objects.create_user(
            username="other-image-teacher",
            email="other-image-teacher@example.com",
            password="Another-strong-passphrase-914!",
            is_staff=True,
        )
        TeacherCohortAccess.objects.create(teacher=other_teacher, cohort=other_cohort)
        self.client.force_login(other_teacher)
        response = self.client.post(
            reverse("learning:teacher_delete_image_evidence", args=[image.pk]),
        )
        self.assertEqual(response.status_code, 404)
        self.assertTrue(Evidence.objects.filter(pk=image.pk).exists())

    def test_teacher_image_delete_requires_csrf_and_preserves_shared_storage(self):
        with override_settings(
            STORAGES={
                "default": {"BACKEND": "django.core.files.storage.InMemoryStorage"},
                "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
            }
        ):
            ensure_growth_submissions(self.enrollment)
            record = GrowthRecordSubmission.objects.get(
                enrollment=self.enrollment, definition__slot_id="R01"
            )
            first = Evidence.objects.create(
                growth_submission=record,
                evidence_type=Evidence.Type.IMAGE,
                upload=SimpleUploadedFile("shared.jpg", b"shared", content_type="image/jpeg"),
            )
            shared = Evidence.objects.create(
                growth_submission=record,
                evidence_type=Evidence.Type.IMAGE,
                upload=first.upload.name,
            )
            storage = first.upload.storage
            upload_name = first.upload.name
            client = Client(enforce_csrf_checks=True)
            client.force_login(self.teacher)
            response = client.post(
                reverse("learning:teacher_delete_image_evidence", args=[first.pk]),
            )
            self.assertEqual(response.status_code, 403)
            self.assertTrue(Evidence.objects.filter(pk=first.pk).exists())

            self.client.force_login(self.teacher)
            response = self.client.post(
                reverse("learning:teacher_delete_image_evidence", args=[first.pk]),
            )
            self.assertEqual(response.status_code, 302)
            self.assertFalse(Evidence.objects.filter(pk=first.pk).exists())
            self.assertTrue(Evidence.objects.filter(pk=shared.pk).exists())
            self.assertTrue(storage.exists(upload_name))

    def test_teacher_cannot_review_growth_record_outside_assigned_cohort(self):
        self.client.force_login(self.student.user)
        self.client.get(reverse("learning:student_growth_dashboard", args=[self.enrollment.pk]))
        submission = GrowthRecordSubmission.objects.get(
            enrollment=self.enrollment, definition__slot_id="R01"
        )
        submission.status = GrowthRecordSubmission.Status.SUBMITTED
        submission.save(update_fields=["status", "updated_at"])
        other_cohort = Cohort.objects.create(cohort_id="2026-02", name="其他班級")
        other_teacher = get_user_model().objects.create_user(
            username="other-growth-teacher", email="other-growth-teacher@example.com",
            password="Another-strong-passphrase-913!", is_staff=True
        )
        TeacherCohortAccess.objects.create(teacher=other_teacher, cohort=other_cohort)
        self.client.force_login(other_teacher)

        response = self.client.post(
            reverse("learning:growth_review", args=[submission.pk]),
            {"review_status": "approved", "score": "100", "teacher_note": "跨班測試"},
        )

        self.assertEqual(response.status_code, 404)
        self.assertFalse(GrowthRecordReview.objects.filter(submission=submission).exists())

    def test_teacher_review_persists_status_note_score_and_history(self):
        self.client.force_login(self.teacher)

        response = self.client.post(
            reverse("learning:review_task", args=[self.progress.pk]),
            {"result": TeacherReviewEvent.Result.REVIEWED, "note": "接線與方向確認完成", "score": "92.5"},
        )

        self.assertEqual(response.status_code, 302)
        self.progress.refresh_from_db()
        self.assertEqual(self.progress.status, StudentTaskProgress.Status.REVIEWED)
        self.assertEqual(self.progress.teacher_note, "接線與方向確認完成")
        self.assertEqual(str(self.progress.teacher_score), "92.50")
        self.assertIsNotNone(self.progress.reviewed_at)
        event = TeacherReviewEvent.objects.get(progress=self.progress)
        self.assertEqual(event.teacher, self.teacher)
        self.assertEqual(event.result, TeacherReviewEvent.Result.REVIEWED)

    def test_incomplete_review_can_be_resubmitted_without_deleting_history(self):
        self.client.force_login(self.teacher)
        self.client.post(
            reverse("learning:review_task", args=[self.progress.pk]),
            {"result": TeacherReviewEvent.Result.INCOMPLETE, "note": "請補一張照片", "score": ""},
        )
        self.progress.refresh_from_db()
        self.assertEqual(self.progress.status, StudentTaskProgress.Status.INCOMPLETE)
        self.assertEqual(TeacherReviewEvent.objects.filter(progress=self.progress).count(), 1)

        self.client.force_login(self.student.user)
        response = self.client.post(
            reverse("learning:task_detail", args=[self.enrollment.pk, "T06"]),
            {"status": StudentTaskProgress.Status.SUBMITTED, "student_note": "已補照片"},
        )
        self.assertEqual(response.status_code, 302)
        self.progress.refresh_from_db()
        self.assertEqual(self.progress.status, StudentTaskProgress.Status.SUBMITTED)
        self.assertEqual(TeacherReviewEvent.objects.filter(progress=self.progress).count(), 1)

    def test_teacher_must_explicitly_approve_candidate_promotion(self):
        evidence = Evidence.objects.create(
            progress=self.progress,
            evidence_type=Evidence.Type.GITHUB,
            external_url="https://github.com/example/fde-work",
            description="學員成果",
        )
        self.client.force_login(self.teacher)

        response = self.client.post(
            reverse("learning:promote_candidate", args=[str(evidence.pk)]),
            {"promote_to_dataset": "on", "promote_to_rag": ""},
        )

        self.assertEqual(response.status_code, 302)
        candidate = CandidatePool.objects.get(evidence=evidence)
        self.assertTrue(candidate.promote_to_dataset)
        self.assertFalse(candidate.promote_to_rag)
        self.assertEqual(candidate.approved_by_teacher, self.teacher)
        self.assertIsNotNone(candidate.approved_at)

    def test_audit_records_cannot_be_changed_or_deleted_in_admin(self):
        evidence = Evidence.objects.create(
            progress=self.progress,
            evidence_type=Evidence.Type.GITHUB,
            external_url="https://github.com/example/fde-work",
        )
        event = TeacherReviewEvent.objects.create(
            progress=self.progress,
            teacher=self.teacher,
            result=TeacherReviewEvent.Result.REVIEWED,
        )
        candidate = CandidatePool.objects.create(
            evidence=evidence, promote_to_rag=True, approved_by_teacher=self.teacher
        )
        request = RequestFactory().get("/admin/")
        request.user = get_user_model().objects.create_superuser(
            username="root", email="root@example.com", password="A-root-passphrase-984!"
        )

        profile_admin = admin.site._registry[StudentProfile]
        self.assertIn("public_user_id", profile_admin.get_readonly_fields(request, self.student))
        self.assertNotIn("email", profile_admin.get_fields(request, self.student))

        for record in (self.progress, evidence, event, candidate):
            model_admin = admin.site._registry[type(record)]
            self.assertFalse(model_admin.has_add_permission(request))
            self.assertFalse(model_admin.has_change_permission(request, record))
            self.assertFalse(model_admin.has_delete_permission(request, record))

    def test_class_code_admin_only_offers_assigned_cohorts(self):
        other_cohort = Cohort.objects.create(cohort_id="2026-02", name="2026 第二梯")
        request = RequestFactory().get("/admin/")
        request.user = self.teacher
        model_admin = admin.site._registry[ClassCode]

        field = model_admin.formfield_for_foreignkey(ClassCode._meta.get_field("cohort"), request)

        self.assertQuerySetEqual(field.queryset.order_by("cohort_id"), [self.cohort], transform=lambda item: item)
        self.assertNotIn(other_cohort, field.queryset)
