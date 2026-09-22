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
from learning.growth_media import process_growth_image
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


def make_heic_image(size=(120, 80), orientation=None):
    register_heif_opener()
    output = BytesIO()
    image = Image.new("RGB", size, color="teal")
    options = {}
    if orientation:
        exif = image.getexif()
        exif[274] = orientation
        options["exif"] = exif
    image.save(output, format="HEIF", **options)
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
        self.assertContains(response, "無人機基礎認知")
        self.assertContains(response, "已上傳 0 / 5")
        self.assertContains(response, 'accept="image/*"')
        self.assertContains(response, "multiple")
        self.assertNotContains(response, "capture=")
        self.assertContains(response, "待提交照片")
        self.assertContains(response, "＋拍照 / 選擇照片")
        self.assertContains(response, 'class="growth-file-input"')
        self.assertContains(response, 'data-growth-images=""')
        self.assertContains(response, 'data-growth-photo-list')
        self.assertContains(response, 'data-growth-photo-count')
        self.assertContains(response, 'data-growth-saved-photo-list')
        self.assertContains(response, "/static/learning/growth-upload.js?v=video-field-split-1")
        self.assertContains(response, "/static/learning/growth-records.css?v=growth-video-3")
        self.assertNotContains(response, "growth-photo-queue.js")
        self.assertContains(response, "這次我要完成什麼")
        self.assertContains(response, "我可以去哪裡學習")

    def test_each_growth_record_detail_route_opens(self):
        self.client.get(reverse("learning:student_growth_dashboard", args=[self.enrollment.pk]))

        for number in range(1, 9):
            slot_id = f"R{number:02d}"
            with self.subTest(slot_id=slot_id):
                response = self.client.get(
                    reverse("learning:growth_record_detail", args=[self.enrollment.pk, slot_id])
                )
                self.assertEqual(response.status_code, 200)

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

    def test_growth_draft_appends_new_photo_selections_without_duplicate_saves(self):
        with TemporaryDirectory() as media_dir, override_settings(MEDIA_ROOT=media_dir):
            url = reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R01"])
            first = self.client.post(
                url,
                {"action": "save_draft", "images": [upload_file(make_image(size=(20, 20)), name="first.png")]},
            )
            self.assertEqual(first.status_code, 302)
            first_evidence = Evidence.objects.get(growth_submission__enrollment=self.enrollment)
            first_file = first_evidence.upload.name

            second = self.client.post(
                url,
                {"action": "save_draft", "images": [upload_file(make_image(size=(24, 24)), name="second.png")]},
            )
            self.assertEqual(second.status_code, 302)
            self.assertTrue(Evidence.objects.filter(pk=first_evidence.pk, upload=first_file).exists())
            self.assertEqual(Evidence.objects.filter(growth_submission__enrollment=self.enrollment).count(), 2)

            third = self.client.post(url, {"action": "save_draft", "student_note": "稍後再補第三張"})
            self.assertEqual(third.status_code, 302)
            self.assertEqual(Evidence.objects.filter(growth_submission__enrollment=self.enrollment).count(), 2)

    def test_ajax_draft_save_returns_success_json_after_persisting_staged_photos(self):
        with TemporaryDirectory() as media_dir, override_settings(MEDIA_ROOT=media_dir):
            response = self.client.post(
                reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R01"]),
                {
                    "action": "save_draft",
                    "images": [
                        upload_file(make_image(size=(20, 20)), name="first.png"),
                        upload_file(make_image(size=(24, 24)), name="second.png"),
                    ],
                },
                HTTP_X_REQUESTED_WITH="XMLHttpRequest",
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/json")
        self.assertTrue(response.json()["ok"])
        self.assertEqual(Evidence.objects.filter(growth_submission__enrollment=self.enrollment).count(), 2)

    def test_sequential_drafts_keep_five_photos_and_allow_delete_then_replacement(self):
        with TemporaryDirectory() as media_dir, override_settings(MEDIA_ROOT=media_dir):
            url = reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R01"])
            for index in range(5):
                response = self.client.post(
                    url,
                    {
                        "action": "save_draft",
                        "images": [
                            upload_file(make_image(size=(20 + index, 20)), name=f"photo-{index + 1}.png")
                        ],
                    },
                )
                self.assertEqual(response.status_code, 302)
                self.assertEqual(
                    Evidence.objects.filter(growth_submission__definition__slot_id="R01").count(),
                    index + 1,
                )

            refreshed = self.client.get(url)
            self.assertEqual(refreshed.context["image_count"], 5)
            self.assertContains(refreshed, 'alt="R01 學習證據照片"', count=5)
            evidence = list(
                Evidence.objects.filter(growth_submission__definition__slot_id="R01").order_by("created_at", "pk")
            )
            response = self.client.post(
                reverse("learning:growth_evidence_delete", args=[self.enrollment.pk, "R01", evidence[1].pk])
            )
            self.assertEqual(response.status_code, 302)
            self.assertEqual(Evidence.objects.filter(growth_submission__definition__slot_id="R01").count(), 4)

            response = self.client.post(
                url,
                {"action": "save_draft", "images": [upload_file(make_image(size=(30, 20)), name="replacement.png")]},
            )
            self.assertEqual(response.status_code, 302)
            self.assertEqual(Evidence.objects.filter(growth_submission__definition__slot_id="R01").count(), 5)

            response = self.client.post(
                url,
                {"action": "save_draft", "images": [upload_file(make_image(size=(32, 20)), name="sixth.png")]},
            )
            self.assertEqual(response.status_code, 200)
            self.assertContains(response, "每項學習成長記錄最多上傳5張照片，請先刪除現有照片再添加。")
            self.assertEqual(Evidence.objects.filter(growth_submission__definition__slot_id="R01").count(), 5)

    def test_uploaded_photo_thumbnail_survives_refresh_and_new_login(self):
        with TemporaryDirectory() as media_dir, override_settings(MEDIA_ROOT=media_dir):
            url = reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R01"])
            response = self.client.post(
                url,
                {"action": "save_draft", "student_note": "刷題練習", "images": [upload_file(make_image(size=(40, 30)))]},
                follow=True,
            )

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.context["image_count"], 1)
            self.assertContains(response, 'alt="R01 學習證據照片"', count=1)
            evidence = Evidence.objects.get(growth_submission__enrollment=self.enrollment)
            self.assertTrue(Path(media_dir, evidence.upload.name).is_file())
            preview_url = reverse("learning:evidence_download", args=[evidence.pk]) + "?inline=1"
            preview = self.client.get(preview_url)
            self.assertEqual(preview.status_code, 200)
            preview.close()

            self.client.logout()
            self.client.force_login(self.profile.user)
            refreshed = self.client.get(url)

            self.assertEqual(refreshed.status_code, 200)
            self.assertEqual(refreshed.context["image_count"], 1)
            self.assertContains(refreshed, "刷題練習")
            self.assertContains(refreshed, 'alt="R01 學習證據照片"', count=1)
            self.assertContains(refreshed, "data-saved-photo", count=1)

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

    def test_supported_image_formats_convert_to_jpeg(self):
        samples = (
            ("photo.jpg", "image/jpeg", make_image(image_format="JPEG"), "JPEG"),
            ("photo.png", "image/png", make_image(image_format="PNG"), "PNG"),
            ("photo.webp", "image/webp", make_image(image_format="WEBP"), "WEBP"),
            ("photo.heic", "image/heic", make_heic_image(), "HEIF"),
        )

        for filename, content_type, content, original_format in samples:
            with self.subTest(format=original_format):
                output_name, output_bytes, metadata = process_growth_image(
                    upload_file(content, name=filename, content_type=content_type)
                )

                self.assertTrue(output_name.endswith(".jpg"))
                self.assertEqual(metadata["original"]["format"], original_format)
                self.assertEqual(metadata["processed"]["content_type"], "image/jpeg")
                with Image.open(BytesIO(output_bytes)) as processed:
                    self.assertEqual(processed.format, "JPEG")

    def test_heic_exif_orientation_is_applied_and_long_edge_is_limited(self):
        _, output_bytes, metadata = process_growth_image(
            upload_file(
                make_heic_image(size=(2000, 1000), orientation=6),
                name="iphone.HEIC",
                content_type="image/heic",
            )
        )

        self.assertEqual(metadata["original"]["format"], "HEIF")
        self.assertLessEqual(max(metadata["processed"]["width"], metadata["processed"]["height"]), 1600)
        with Image.open(BytesIO(output_bytes)) as processed:
            self.assertEqual(processed.size, (800, 1600))

    def test_invalid_heic_logs_extension_mime_and_container_without_full_filename(self):
        invalid_heic = b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00invalid"
        url = reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R01"])

        with self.assertLogs("learning.growth_media", level="WARNING") as logs:
            response = self.client.post(
                url,
                {
                    "action": "save_draft",
                    "images": [
                        upload_file(
                            invalid_heic,
                            name="private-student-photo.heic",
                            content_type="image/heic",
                        )
                    ],
                },
            )

        output = "\n".join(logs.output)
        self.assertContains(response, "圖片格式無效")
        self.assertIn("extension=.heic", output)
        self.assertIn("content_type=image/heic", output)
        self.assertIn("container_brand=heic", output)
        self.assertIn("reason=decode_error", output)
        self.assertNotIn("private-student-photo", output)

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
            detail = self.client.get(f"/student/courses/{self.enrollment.pk}/growth/R01/")
            self.assertContains(detail, 'data-growth-saved-photo-list')
            self.assertContains(detail, 'class="growth-photo-delete"')
            self.assertContains(detail, 'aria-label="刪除已保存照片 1"')
            self.assertLess(
                detail.content.index(b'class="growth-photo-delete"'),
                detail.content.index(b'data-growth-form'),
            )
            response = self.client.post(
                f"/student/courses/{self.enrollment.pk}/growth/R01/evidence/{evidence.pk}/delete/"
            )

            self.assertEqual(response.status_code, 302)
            self.assertFalse(Evidence.objects.filter(pk=evidence.pk).exists())
            self.assertFalse((Path(media_dir) / stored_name).exists())

    def test_photo_can_be_deleted_after_teacher_requests_revision(self):
        with TemporaryDirectory() as media_dir, override_settings(MEDIA_ROOT=media_dir):
            url = reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R01"])
            self.client.post(
                url,
                {"action": "save_draft", "images": [upload_file(make_image(size=(20, 20)))]},
            )
            submission = apps.get_model("learning", "GrowthRecordSubmission").objects.get(
                enrollment=self.enrollment, definition__slot_id="R01"
            )
            submission.status = "needs_revision"
            submission.save(update_fields=["status", "updated_at"])
            evidence = Evidence.objects.get(growth_submission=submission)

            response = self.client.post(
                reverse(
                    "learning:growth_evidence_delete",
                    args=[self.enrollment.pk, "R01", evidence.pk],
                )
            )

        self.assertEqual(response.status_code, 302)
        self.assertFalse(Evidence.objects.filter(pk=evidence.pk).exists())

    def test_sixth_image_is_rejected_without_saving_any(self):
        with TemporaryDirectory() as media_dir, override_settings(MEDIA_ROOT=media_dir):
            files = [upload_file(make_image(size=(20, 20))) for _ in range(6)]
            response = self.client.post(
                f"/student/courses/{self.enrollment.pk}/growth/R01/",
                {"action": "save_draft", "images": files},
            )

            self.assertEqual(response.status_code, 200)
            self.assertContains(response, "每項學習成長記錄最多上傳5張照片，請先刪除現有照片再添加。")
            self.assertFalse(Evidence.objects.filter(growth_submission__isnull=False).exists())

    def test_fifth_photo_persists_and_sixth_is_blocked_with_limit_message(self):
        with TemporaryDirectory() as media_dir, override_settings(MEDIA_ROOT=media_dir):
            url = reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R01"])
            response = self.client.post(
                url,
                {"action": "save_draft", "images": [
                    upload_file(make_image(size=(20, 20)), name=f"proof-{index}.png")
                    for index in range(5)
                ]},
                follow=True,
            )

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.context["image_count"], 5)
            self.assertContains(response, "已上傳 5 / 5 張圖片")
            self.assertContains(response, 'alt="R01 學習證據照片"', count=5)

            response = self.client.post(
                url,
                {"action": "save_draft", "images": [upload_file(make_image(size=(20, 20)), name="proof-6.png")]},
            )

            self.assertEqual(response.status_code, 200)
            self.assertContains(response, "每項學習成長記錄最多上傳5張照片，請先刪除現有照片再添加。")
            self.assertEqual(Evidence.objects.filter(growth_submission__definition__slot_id="R01").count(), 5)

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
        self.assertContains(response, "請先上傳至少一張照片或一段影片")

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

            response = self.client.post(
                f"/student/courses/{self.enrollment.pk}/growth/R01/",
                {"action": "save_draft", "images": [upload_file(make_image(size=(20, 20)), name="locked.png")]},
            )
            self.assertEqual(response.status_code, 302)
            self.assertEqual(Evidence.objects.filter(growth_submission=submission).count(), 1)

    def test_r08_accepts_photo_and_pdf_and_can_submit_for_review(self):
        with TemporaryDirectory() as media_dir, override_settings(MEDIA_ROOT=media_dir):
            response = self.client.post(
                f"/student/courses/{self.enrollment.pk}/growth/R08/",
                {
                    "action": "submit_review",
                    "learning_summary": "本期完成應用專案成果展示。",
                    "images": [upload_file(make_image(size=(40, 30)), name="summary.jpg", content_type="image/jpeg")],
                    "documents": [upload_file(b"%PDF-1.7 test", name="成果報告.pdf", content_type="application/pdf")],
                },
            )

            self.assertEqual(response.status_code, 302)
            submission = apps.get_model("learning", "GrowthRecordSubmission").objects.get(
                enrollment=self.enrollment, definition__slot_id="R08"
            )
            self.assertEqual(submission.status, "submitted")
            self.assertEqual(
                set(Evidence.objects.filter(growth_submission=submission).values_list("evidence_type", flat=True)),
                {Evidence.Type.IMAGE, Evidence.Type.FILE},
            )

            page = self.client.get(f"/student/courses/{self.enrollment.pk}/growth/R08/")
            self.assertContains(page, "本期完成應用專案成果展示。")
            self.assertContains(page, "成果報告.pdf")
            self.assertContains(page, "已提交")

    def test_r08_document_upload_rejects_unsupported_extension(self):
        response = self.client.post(
            f"/student/courses/{self.enrollment.pk}/growth/R08/",
            {
                "action": "save_draft",
                "documents": [upload_file(b"not allowed", name="成果.exe", content_type="application/octet-stream")],
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "檔案格式無效")
        self.assertFalse(Evidence.objects.filter(growth_submission__isnull=False).exists())


def upload_file(content, name="proof.png", content_type="image/png"):
    from django.core.files.uploadedfile import SimpleUploadedFile

    return SimpleUploadedFile(name, content, content_type=content_type)
