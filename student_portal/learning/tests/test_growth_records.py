from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image
from pillow_heif import register_heif_opener
from django.apps import apps
from django.db import IntegrityError, transaction
from django.core.management import call_command, get_commands
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from learning import models
from learning.models import Cohort, Evidence
from learning.tests.helpers import create_student_account, enroll_student


def make_image(name="proof.png", size=(2000, 1000), orientation=None, image_format="PNG"):
    output = BytesIO()
    image = Image.new("RGB", size, color="teal")
    if orientation:
        exif = image.getexif()
        exif[274] = orientation
        image.save(output, format=image_format, exif=exif)
    else:
        image.save(output, format=image_format)
    return output.getvalue()


def make_heic_image():
    register_heif_opener()
    output = BytesIO()
    Image.new("RGB", (120, 80), color="teal").save(output, format="HEIF")
    return output.getvalue()


class GrowthRecordFoundationTests(TestCase):
    def setUp(self):
        self.profile = create_student_account("growth@example.com", "Eagle")
        self.cohort = Cohort.objects.create(cohort_id="2026-01", name="2026 第一梯")
        self.enrollment = enroll_student(self.profile, self.cohort)
        self.client.force_login(self.profile.user)

    def test_growth_record_models_are_defined(self):
        for model_name in (
            "LearningGroup",
            "GrowthRecordDefinition",
            "GrowthRecordSubmission",
            "GrowthRecordReview",
        ):
            with self.subTest(model=model_name):
                self.assertTrue(hasattr(models, model_name), f"{model_name} model is missing")

    def test_seed_command_creates_eight_records_idempotently(self):
        commands = get_commands()
        self.assertIn("seed_growth_records", commands)
        if "seed_growth_records" not in commands:
            return

        call_command("seed_growth_records", "2026-01", verbosity=0)
        call_command("seed_growth_records", "2026-01", verbosity=0)

        definition_model = apps.get_model("learning", "GrowthRecordDefinition")
        definitions = definition_model.objects.filter(cohort=self.cohort).order_by("display_order")
        self.assertEqual(definitions.count(), 8)
        self.assertEqual([item.slot_id for item in definitions], [f"R{i:02d}" for i in range(1, 9)])

    def test_student_growth_dashboard_lists_eight_records(self):
        response = self.client.get(f"/student/courses/{self.enrollment.pk}/growth/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, self.profile.public_user_id)
        self.assertContains(response, "Eagle")
        self.assertContains(response, "2026-01")
        for number in range(1, 9):
            self.assertContains(response, f"R{number:02d}")

    def test_student_course_page_has_only_the_growth_record_workflow(self):
        response = self.client.get(
            reverse("learning:student_course_dashboard", args=[self.enrollment.pk])
        )

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, self.cohort.name)
        self.assertContains(response, self.profile.public_user_id)
        self.assertContains(response, self.profile.nickname)
        self.assertContains(response, self.cohort.cohort_id)
        self.assertContains(response, "小組：尚未分組")
        self.assertContains(response, "我的學習成長日誌")
        self.assertContains(response, "0 / 8")
        self.assertNotContains(response, "12 項任務")
        self.assertNotContains(response, "學習階段")
        self.assertNotContains(response, "T01")
        self.assertNotContains(response, "我的任務")

    def test_student_course_list_shows_growth_log_as_its_only_learning_entry(self):
        response = self.client.get(reverse("learning:student_dashboard"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'href="/student/growth/"')
        self.assertContains(response, "成長記錄已提交 0 / 8")
        self.assertContains(response, "我的學習成長日誌")
        self.assertNotContains(response, "查看任務")
        self.assertNotContains(response, "任務完成")

    def test_student_growth_nav_goes_directly_to_single_enrollment(self):
        response = self.client.get(reverse("learning:student_growth_entry"))

        self.assertRedirects(
            response,
            reverse("learning:student_growth_dashboard", args=[self.enrollment.pk]),
        )

    def test_student_growth_nav_returns_to_courses_for_multiple_enrollments(self):
        other_cohort = Cohort.objects.create(cohort_id="2026-02", name="2026 第二梯")
        enroll_student(self.profile, other_cohort)

        response = self.client.get(reverse("learning:student_growth_entry"))

        self.assertRedirects(response, reverse("learning:student_dashboard"))

    def test_growth_dashboard_counts_needs_revision_as_submitted_and_reviewed(self):
        self.client.get(f"/student/courses/{self.enrollment.pk}/growth/")
        submission_model = apps.get_model("learning", "GrowthRecordSubmission")
        for slot_id, status in (("R01", "needs_revision"), ("R02", "approved")):
            submission = submission_model.objects.get(
                enrollment=self.enrollment, definition__slot_id=slot_id
            )
            submission.status = status
            submission.submitted_at = timezone.now()
            submission.save(update_fields=["status", "submitted_at", "updated_at"])

        response = self.client.get(f"/student/courses/{self.enrollment.pk}/growth/")

        self.assertEqual(response.context["submitted_count"], 2)
        self.assertEqual(response.context["reviewed_count"], 2)

    def test_group_scoped_r07_definition_overrides_the_default_without_view_logic_changes(self):
        call_command("seed_growth_records", "2026-01", verbosity=0)
        group_model = apps.get_model("learning", "LearningGroup")
        definition_model = apps.get_model("learning", "GrowthRecordDefinition")
        group = group_model.objects.create(cohort=self.cohort, code="D", name="YOLOv8 AI 目標檢測組")
        definition_model.objects.create(
            cohort=self.cohort,
            group_scope=group,
            slot_id="R07",
            title="YOLOv8 AI 目標檢測專業成長記錄",
            description="圖片蒐集、標註與模型檢測成果。",
            completion_requirements=["提交標註或檢測成果。"],
            evidence_requirement=["AI 檢測成果"],
            learning_resource=["本組教師提供的 YOLOv8 資源。"],
            display_order=7,
        )
        self.enrollment.group = group
        self.enrollment.save(update_fields=["group"])

        response = self.client.get(f"/student/courses/{self.enrollment.pk}/growth/")

        self.assertEqual(response.status_code, 200)
        r07 = next(
            row["submission"] for row in response.context["records"]
            if row["submission"].definition.slot_id == "R07"
        )
        self.assertEqual(r07.definition.title, "YOLOv8 AI 目標檢測專業成長記錄")

    def test_teacher_final_score_is_limited_to_zero_through_one_hundred(self):
        self.client.get(f"/student/courses/{self.enrollment.pk}/growth/")
        submission = apps.get_model("learning", "GrowthRecordSubmission").objects.get(
            enrollment=self.enrollment, definition__slot_id="R01"
        )

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                submission.teacher_final_score = 101
                submission.save(update_fields=["teacher_final_score", "updated_at"])

    def test_growth_dashboard_requires_student_login(self):
        self.client.logout()

        response = self.client.get(f"/student/courses/{self.enrollment.pk}/growth/")

        self.assertEqual(response.status_code, 302)
        self.assertIn("/login/?next=", response.url)

    def test_student_cannot_open_another_enrollments_growth_records(self):
        other = create_student_account("other-growth@example.com", "Other")
        other_enrollment = enroll_student(other, self.cohort)

        response = self.client.get(f"/student/courses/{other_enrollment.pk}/growth/")

        self.assertEqual(response.status_code, 404)

    def test_record_detail_shows_requirements_and_mobile_image_input(self):
        response = self.client.get(f"/student/courses/{self.enrollment.pk}/growth/R01/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "證照題庫學習記錄")
        self.assertContains(response, "已上傳 0 / 5")
        self.assertContains(response, 'accept="image/*"')
        self.assertContains(response, "這次我要完成什麼")
        self.assertContains(response, "我可以去哪裡學習")

    def test_draft_image_is_exif_corrected_resized_and_saved_as_jpeg(self):
        with TemporaryDirectory() as media_dir, override_settings(MEDIA_ROOT=media_dir):
            upload = make_image(orientation=6)
            response = self.client.post(
                f"/student/courses/{self.enrollment.pk}/growth/R01/",
                {
                    "action": "save_draft",
                    "student_note": "課堂刷題紀錄",
                    "images": [upload_file(upload)],
                },
            )

            self.assertEqual(response.status_code, 302)
            evidence = Evidence.objects.get(growth_submission__definition__slot_id="R01")
            self.assertTrue(evidence.upload.name.endswith(".jpg"))
            with Image.open(evidence.upload.path) as processed:
                self.assertEqual(processed.format, "JPEG")
                self.assertEqual(processed.size, (800, 1600))
            evidence.upload.close()
            response = self.client.get(f"/student/courses/{self.enrollment.pk}/growth/R01/")
            self.assertContains(response, "課堂刷題紀錄")

    def test_growth_draft_upload_redirects_back_without_404(self):
        with TemporaryDirectory() as media_dir, override_settings(MEDIA_ROOT=media_dir):
            response = self.client.post(
                reverse(
                    "learning:growth_record_detail",
                    args=[self.enrollment.pk, "R01"],
                ),
                {
                    "action": "save_draft",
                    "student_note": "已保存草稿",
                    "images": [upload_file(make_image(size=(40, 30)))],
                },
                follow=True,
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.redirect_chain[-1][0],
            reverse(
                "learning:growth_record_detail",
                args=[self.enrollment.pk, "R01"],
            ),
        )
        self.assertContains(response, "已保存草稿")
        self.assertContains(response, "已上傳 1 / 5 張圖片")

    def test_growth_submission_redirects_back_without_404(self):
        with TemporaryDirectory() as media_dir, override_settings(MEDIA_ROOT=media_dir):
            response = self.client.post(
                reverse(
                    "learning:growth_record_detail",
                    args=[self.enrollment.pk, "R01"],
                ),
                {
                    "action": "submit_review",
                    "student_note": "提交複核",
                    "images": [upload_file(make_image(size=(40, 30)))],
                },
                follow=True,
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.redirect_chain[-1][0],
            reverse(
                "learning:growth_record_detail",
                args=[self.enrollment.pk, "R01"],
            ),
        )
        self.assertEqual(response.context["submission"].status, "submitted")
        submission = apps.get_model("learning", "GrowthRecordSubmission").objects.get(
            enrollment=self.enrollment,
            definition__slot_id="R01",
        )
        self.assertEqual(submission.status, "submitted")

    def test_iphone_heic_photo_is_converted_to_standard_jpeg(self):
        with TemporaryDirectory() as media_dir, override_settings(MEDIA_ROOT=media_dir):
            response = self.client.post(
                f"/student/courses/{self.enrollment.pk}/growth/R01/",
                {
                    "action": "save_draft",
                    "images": [upload_file(make_heic_image(), name="iphone.heic", content_type="image/heic")],
                },
            )

            self.assertEqual(response.status_code, 302)
            evidence = Evidence.objects.get(growth_submission__definition__slot_id="R01")
            self.assertTrue(evidence.upload.name.endswith(".jpg"))
            self.assertEqual(evidence.original_metadata["format"], "HEIF")
            with Image.open(evidence.upload.path) as processed:
                self.assertEqual(processed.format, "JPEG")
                self.assertEqual(processed.size, (120, 80))
            evidence.upload.close()

    def test_growth_image_preview_is_private_and_inline_only_for_owner(self):
        with TemporaryDirectory() as media_dir, override_settings(MEDIA_ROOT=media_dir):
            self.client.post(
                f"/student/courses/{self.enrollment.pk}/growth/R01/",
                {"action": "save_draft", "images": [upload_file(make_image(size=(40, 30)))]},
            )
            evidence = Evidence.objects.get(growth_submission__definition__slot_id="R01")
            preview_url = reverse("learning:evidence_download", args=[evidence.pk]) + "?inline=1"
            preview = self.client.get(preview_url)

            self.assertEqual(preview.status_code, 200)
            self.assertEqual(preview["Content-Type"], "image/jpeg")
            self.assertTrue(preview["Content-Disposition"].startswith("inline;"))
            self.assertEqual(preview["Cache-Control"], "private, no-store")
            preview.close()

            other = create_student_account("private-viewer@example.com", "Viewer")
            self.client.force_login(other.user)
            forbidden = self.client.get(preview_url)
            self.assertEqual(forbidden.status_code, 404)

    def test_processed_evidence_retains_original_and_processed_metadata(self):
        field_names = {field.name for field in Evidence._meta.get_fields()}

        self.assertTrue({"original_metadata", "processed_metadata"}.issubset(field_names))

        with TemporaryDirectory() as media_dir, override_settings(MEDIA_ROOT=media_dir):
            self.client.post(
                f"/student/courses/{self.enrollment.pk}/growth/R01/",
                {"action": "save_draft", "images": [upload_file(make_image(orientation=6))]},
            )
            evidence = Evidence.objects.get(growth_submission__definition__slot_id="R01")

            self.assertEqual(evidence.original_metadata["width"], 2000)
            self.assertEqual(evidence.original_metadata["height"], 1000)
            self.assertEqual(evidence.processed_metadata["format"], "JPEG")
            self.assertEqual(evidence.processed_metadata["width"], 800)
            self.assertEqual(evidence.processed_metadata["height"], 1600)
            self.assertLess(evidence.processed_metadata["size_bytes"], evidence.original_metadata["size_bytes"])

    def test_unsubmitted_image_can_be_deleted_by_its_owner(self):
        with TemporaryDirectory() as media_dir, override_settings(MEDIA_ROOT=media_dir):
            upload_response = self.client.post(
                f"/student/courses/{self.enrollment.pk}/growth/R01/",
                {"action": "save_draft", "images": [upload_file(make_image(size=(20, 20)))]},
            )
            self.assertEqual(upload_response.status_code, 302)
            if upload_response.status_code != 302:
                return
            evidence = Evidence.objects.get(growth_submission__definition__slot_id="R01")
            stored_name = evidence.upload.name
            response = self.client.post(
                f"/student/courses/{self.enrollment.pk}/growth/R01/evidence/{evidence.pk}/delete/"
            )

            self.assertEqual(response.status_code, 302)
            self.assertFalse(Evidence.objects.filter(pk=evidence.pk).exists())
            self.assertFalse((Path(media_dir) / stored_name).exists())

    def test_sixth_image_is_rejected_without_saving_any(self):
        with TemporaryDirectory() as media_dir, override_settings(MEDIA_ROOT=media_dir):
            files = [upload_file(make_image(size=(20, 20))) for _ in range(6)]
            response = self.client.post(
                f"/student/courses/{self.enrollment.pk}/growth/R01/",
                {"action": "save_draft", "images": files},
            )

            self.assertEqual(response.status_code, 200)
            self.assertContains(response, "每項最多上傳 5 張圖片")
            self.assertFalse(Evidence.objects.filter(growth_submission__isnull=False).exists())

    def test_non_image_upload_is_rejected(self):
        with TemporaryDirectory() as media_dir, override_settings(MEDIA_ROOT=media_dir):
            response = self.client.post(
                f"/student/courses/{self.enrollment.pk}/growth/R01/",
                {
                    "action": "save_draft",
                    "images": [upload_file(b"not an image", name="bad.jpg", content_type="image/jpeg")],
                },
            )

            self.assertEqual(response.status_code, 200)
            self.assertContains(response, "圖片格式無效")
            self.assertFalse(Evidence.objects.filter(growth_submission__isnull=False).exists())

    def test_submitting_requires_photo_evidence(self):
        response = self.client.post(
            f"/student/courses/{self.enrollment.pk}/growth/R01/",
            {"action": "submit_review", "student_note": "完成"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "請先上傳至少一張圖片")

    def test_photo_can_be_submitted_and_cannot_be_deleted_after_submission(self):
        with TemporaryDirectory() as media_dir, override_settings(MEDIA_ROOT=media_dir):
            response = self.client.post(
                f"/student/courses/{self.enrollment.pk}/growth/R01/",
                {
                    "action": "submit_review",
                    "student_note": "已完成題庫練習",
                    "images": [upload_file(make_image(size=(30, 20)))],
                },
            )

            self.assertEqual(response.status_code, 302)
            submission = apps.get_model("learning", "GrowthRecordSubmission").objects.get(
                enrollment=self.enrollment, definition__slot_id="R01"
            )
            evidence = Evidence.objects.get(growth_submission=submission)
            self.assertEqual(submission.status, "submitted")
            self.assertIsNotNone(submission.submitted_at)

            response = self.client.post(
                f"/student/courses/{self.enrollment.pk}/growth/R01/evidence/{evidence.pk}/delete/"
            )

            self.assertEqual(response.status_code, 302)
            self.assertTrue(Evidence.objects.filter(pk=evidence.pk).exists())

    def test_r08_only_accepts_a_summary_draft_until_evidence_selection_is_available(self):
        response = self.client.post(
            f"/student/courses/{self.enrollment.pk}/growth/R08/",
            {"action": "save_draft", "learning_summary": "本期學會飛控設定與安全檢查。"},
        )

        self.assertEqual(response.status_code, 302)
        response = self.client.get(f"/student/courses/{self.enrollment.pk}/growth/R08/")
        self.assertContains(response, "本期學會飛控設定與安全檢查。")
        self.assertContains(response, "請從 R01～R07 選擇 3～5 項代表成果")

        response = self.client.post(
            f"/student/courses/{self.enrollment.pk}/growth/R08/",
            {"action": "submit_review", "learning_summary": "本期學會飛控設定與安全檢查。"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "完成代表成果選擇後才能提交 R08")


def upload_file(content, name="proof.png", content_type="image/png"):
    from django.core.files.uploadedfile import SimpleUploadedFile

    return SimpleUploadedFile(name, content, content_type=content_type)
