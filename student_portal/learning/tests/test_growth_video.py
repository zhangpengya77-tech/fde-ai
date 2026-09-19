import shutil
import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase, override_settings
from django.urls import reverse

from learning.growth_video import VideoProcessingError, process_growth_video
from learning.models import Cohort, Evidence, GrowthRecordSubmission, TeacherCohortAccess
from learning.tests.helpers import create_student_account, enroll_student


FFMPEG = shutil.which("ffmpeg")
FFPROBE = shutil.which("ffprobe")


def create_video_file(path, *, duration=1, size="640x360", rate=24, audio=True, rotation=None):
    command = [
        FFMPEG,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
    ]
    if rotation is not None:
        command.extend(["-display_rotation:v:0", str(rotation)])
    command.extend([
        "-f",
        "lavfi",
        "-i",
        f"testsrc=size={size}:rate={rate}",
    ])
    if audio:
        command.extend(["-f", "lavfi", "-i", "sine=frequency=880:sample_rate=44100"])
    command.extend(["-t", str(duration), "-c:v", "libx264", "-pix_fmt", "yuv420p"])
    if audio:
        command.extend(["-c:a", "aac", "-shortest"])
    else:
        command.append("-an")
    command.append(str(path))
    subprocess.run(command, check=True, capture_output=True)


def uploaded_video(path, content_type="video/mp4"):
    from django.core.files.uploadedfile import SimpleUploadedFile

    return SimpleUploadedFile(path.name, path.read_bytes(), content_type=content_type)


def uploaded_document(name="成果.pptx", content_type="application/vnd.openxmlformats-officedocument.presentationml.presentation"):
    from django.core.files.uploadedfile import SimpleUploadedFile

    return SimpleUploadedFile(name, b"presentation test", content_type=content_type)


@unittest.skipUnless(FFMPEG and FFPROBE, "ffmpeg and ffprobe are required")
class GrowthVideoProcessorTests(SimpleTestCase):
    def test_mp4_mov_and_m4v_are_normalized_to_mp4(self):
        for extension, content_type in (
            ("mp4", "video/mp4"),
            ("mov", "video/quicktime"),
            ("m4v", "video/x-m4v"),
        ):
            with self.subTest(extension=extension), TemporaryDirectory() as temp_dir:
                source = Path(temp_dir) / f"source.{extension}"
                create_video_file(source)

                processed = process_growth_video(uploaded_video(source, content_type))
                try:
                    self.assertEqual(processed.path.suffix, ".mp4")
                    self.assertEqual(processed.processed_metadata["format"], "MP4")
                    self.assertEqual(processed.processed_metadata["video_codec"], "h264")
                    self.assertEqual(processed.processed_metadata["audio_codec"], "aac")
                    self.assertAlmostEqual(processed.processed_metadata["fps"], 30, delta=0.1)
                    self.assertLessEqual(processed.processed_metadata["width"], 1280)
                    self.assertLessEqual(processed.processed_metadata["height"], 720)
                finally:
                    output_path = processed.path
                    processed.cleanup()
                self.assertFalse(output_path.exists())

    def test_large_and_high_frame_rate_video_is_scaled_to_720p_and_30fps(self):
        with TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "portrait.mp4"
            create_video_file(source, size="1440x2560", rate=60)
            processed = process_growth_video(uploaded_video(source))
            try:
                metadata = processed.processed_metadata
                self.assertEqual(metadata["height"], 720)
                self.assertGreaterEqual(metadata["width"], 400)
                self.assertLessEqual(metadata["width"], 410)
                self.assertAlmostEqual(metadata["fps"], 30, delta=0.1)
            finally:
                processed.cleanup()

    def test_video_without_audio_is_processed(self):
        with TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "silent.mp4"
            create_video_file(source, audio=False)
            processed = process_growth_video(uploaded_video(source))
            try:
                self.assertIsNone(processed.processed_metadata["audio_codec"])
                self.assertEqual(processed.processed_metadata["video_codec"], "h264")
            finally:
                processed.cleanup()

    def test_rotation_metadata_is_applied_without_stretching(self):
        with TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "portrait-metadata.mov"
            create_video_file(source, size="640x360", audio=False, rotation=90)
            processed = process_growth_video(uploaded_video(source, "video/quicktime"))
            try:
                self.assertEqual(
                    (processed.processed_metadata["width"], processed.processed_metadata["height"]),
                    (360, 640),
                )
            finally:
                processed.cleanup()

    def test_fake_or_corrupt_video_is_rejected_by_ffprobe(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        upload = SimpleUploadedFile("fake.mp4", b"this is not a video", content_type="video/mp4")
        with self.assertRaises(VideoProcessingError) as raised:
            process_growth_video(upload)
        self.assertEqual(raised.exception.reason, "ffprobe_rejected")

    def test_long_video_is_trimmed_and_size_limit_is_enforced(self):
        with TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "long.mp4"
            create_video_file(source, duration=31, size="160x90", rate=1, audio=False)
            processed = process_growth_video(uploaded_video(source))
            try:
                self.assertLessEqual(processed.processed_metadata["duration"], 30.01)
            finally:
                processed.cleanup()

            with override_settings(GROWTH_VIDEO_MAX_UPLOAD_BYTES=10):
                with self.assertRaises(VideoProcessingError) as raised:
                    process_growth_video(uploaded_video(source))
            self.assertIn("檔案過大", str(raised.exception))

    def test_two_minute_source_is_accepted_and_trimmed_to_thirty_seconds(self):
        with TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "two-minute.mp4"
            create_video_file(source, duration=120, size="160x90", rate=1, audio=False)
            processed = process_growth_video(uploaded_video(source))
            try:
                self.assertLessEqual(processed.processed_metadata["duration"], 30.01)
                self.assertAlmostEqual(processed.processed_metadata["fps"], 30, delta=0.1)
            finally:
                processed.cleanup()

    def test_missing_ffmpeg_is_reported_as_a_friendly_error(self):
        with patch("learning.growth_video.shutil.which", return_value=None):
            from django.core.files.uploadedfile import SimpleUploadedFile

            upload = SimpleUploadedFile("clip.mp4", b"video", content_type="video/mp4")
            with self.assertRaises(VideoProcessingError) as raised:
                process_growth_video(upload)
        self.assertIn("影片處理工具", str(raised.exception))

    def test_extension_and_mime_are_checked_before_transcoding(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        for filename, content_type in (
            ("clip.exe", "application/x-msdownload"),
            ("clip.mp4", "text/plain"),
        ):
            with self.subTest(filename=filename):
                upload = SimpleUploadedFile(filename, b"video", content_type=content_type)
                with self.assertRaises(VideoProcessingError) as raised:
                    process_growth_video(upload)
                self.assertEqual(raised.exception.reason, "extension_or_mime_rejected")


@unittest.skipUnless(FFMPEG and FFPROBE, "ffmpeg and ffprobe are required")
class GrowthVideoViewTests(TestCase):
    def setUp(self):
        self.profile = create_student_account("growth-video@example.com", "Video Student")
        self.cohort = Cohort.objects.create(cohort_id="2026-01", name="2026 第一梯")
        self.enrollment = enroll_student(self.profile, self.cohort)
        self.client.force_login(self.profile.user)
        self.client.get(reverse("learning:student_growth_dashboard", args=[self.enrollment.pk]))

    def test_r07_page_exposes_video_input_and_saves_normalized_evidence(self):
        with TemporaryDirectory() as media_dir, TemporaryDirectory() as temp_dir, override_settings(MEDIA_ROOT=media_dir):
            source = Path(temp_dir) / "flight.MOV"
            create_video_file(source, size="1280x720")
            url = reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R07"])
            page = self.client.get(url)
            self.assertContains(page, 'accept="video/*"')
            self.assertContains(page, 'data-growth-video=""')

            response = self.client.post(
                url,
                {"action": "save_draft", "student_note": "應用專案影片", "video": uploaded_video(source, "video/quicktime")},
            )
            self.assertEqual(response.status_code, 302)
            evidence = Evidence.objects.get(
                growth_submission__enrollment=self.enrollment,
                growth_submission__definition__slot_id="R07",
                evidence_type=Evidence.Type.VIDEO,
            )
            self.assertTrue(evidence.upload.name.endswith(".mp4"))
            self.assertEqual(evidence.processed_metadata["video_codec"], "h264")
            self.assertEqual(evidence.processed_metadata["audio_codec"], "aac")
            self.assertTrue(Path(media_dir, evidence.upload.name).is_file())

            refreshed = self.client.get(url)
            self.assertContains(refreshed, "video")
            self.assertContains(refreshed, "controls")

    def test_r01_video_can_be_submitted_without_a_photo(self):
        with TemporaryDirectory() as media_dir, TemporaryDirectory() as temp_dir, override_settings(MEDIA_ROOT=media_dir):
            source = Path(temp_dir) / "r01.mp4"
            create_video_file(source, audio=False)
            response = self.client.post(
                reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R01"]),
                {"action": "submit_review", "video": uploaded_video(source)},
            )

            self.assertEqual(response.status_code, 302)
            submission = GrowthRecordSubmission.objects.get(
                enrollment=self.enrollment, definition__slot_id="R01"
            )
            self.assertEqual(submission.status, GrowthRecordSubmission.Status.SUBMITTED)
            self.assertTrue(
                Evidence.objects.filter(
                    growth_submission=submission, evidence_type=Evidence.Type.VIDEO
                ).exists()
            )

    def test_all_growth_records_expose_video_upload(self):
        for slot_id in (f"R{index:02d}" for index in range(1, 9)):
            with self.subTest(slot_id=slot_id):
                page = self.client.get(
                    reverse("learning:growth_record_detail", args=[self.enrollment.pk, slot_id])
                )
                self.assertContains(page, 'data-growth-video=""')

    def test_r01_rejects_corrupt_video_without_creating_video_evidence(self):
        response = self.client.post(
            reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R01"]),
            {"action": "save_draft", "video": uploaded_video(Path(__file__))},
        )
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "影片格式無效")
        self.assertFalse(Evidence.objects.filter(evidence_type=Evidence.Type.VIDEO).exists())

    def test_submitted_r07_cannot_replace_existing_video(self):
        with TemporaryDirectory() as media_dir, TemporaryDirectory() as temp_dir, override_settings(MEDIA_ROOT=media_dir):
            source = Path(temp_dir) / "first.mp4"
            create_video_file(source)
            url = reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R07"])
            self.client.post(url, {"action": "save_draft", "video": uploaded_video(source)})
            submission = GrowthRecordSubmission.objects.get(
                enrollment=self.enrollment, definition__slot_id="R07"
            )
            submission.status = GrowthRecordSubmission.Status.SUBMITTED
            submission.save(update_fields=["status", "updated_at"])
            evidence = Evidence.objects.get(growth_submission=submission, evidence_type=Evidence.Type.VIDEO)

            response = self.client.post(url, {"action": "save_draft", "video": uploaded_video(source)})
            self.assertEqual(response.status_code, 302)
            self.assertTrue(Evidence.objects.filter(pk=evidence.pk).exists())

    def test_r07_video_can_be_submitted_without_a_photo(self):
        with TemporaryDirectory() as media_dir, TemporaryDirectory() as temp_dir, override_settings(MEDIA_ROOT=media_dir):
            source = Path(temp_dir) / "application.mp4"
            create_video_file(source, audio=False)
            url = reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R07"])
            response = self.client.post(
                url,
                {"action": "submit_review", "video": uploaded_video(source)},
            )

            self.assertEqual(response.status_code, 302)
            submission = GrowthRecordSubmission.objects.get(
                enrollment=self.enrollment, definition__slot_id="R07"
            )
            self.assertEqual(submission.status, GrowthRecordSubmission.Status.SUBMITTED)
            self.assertTrue(
                Evidence.objects.filter(growth_submission=submission, evidence_type=Evidence.Type.VIDEO).exists()
            )

    def test_ffmpeg_failure_returns_friendly_form_error_without_creating_evidence(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        url = reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R07"])
        upload = SimpleUploadedFile("failed.mp4", b"not processed", content_type="video/mp4")
        failure = VideoProcessingError("這個影片無法處理，請換一個影片再試。", reason="ffmpeg_failed")
        with patch("learning.views.process_growth_video", side_effect=failure):
            response = self.client.post(url, {"action": "save_draft", "video": upload})

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "這個影片無法處理，請換一個影片再試。")
        self.assertFalse(
            Evidence.objects.filter(
                growth_submission__enrollment=self.enrollment,
                growth_submission__definition__slot_id="R07",
                evidence_type=Evidence.Type.VIDEO,
            ).exists()
        )

    def test_teacher_can_play_the_normalized_growth_video(self):
        with TemporaryDirectory() as media_dir, TemporaryDirectory() as temp_dir, override_settings(MEDIA_ROOT=media_dir):
            source = Path(temp_dir) / "teacher-review.mov"
            create_video_file(source)
            url = reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R07"])
            self.client.post(url, {"action": "save_draft", "video": uploaded_video(source, "video/quicktime")})
            evidence = Evidence.objects.get(
                growth_submission__enrollment=self.enrollment,
                growth_submission__definition__slot_id="R07",
                evidence_type=Evidence.Type.VIDEO,
            )
            teacher = get_user_model().objects.create_user(
                username="growth-video-teacher",
                email="growth-video-teacher@example.com",
                password="Another-strong-passphrase-916!",
                is_staff=True,
            )
            TeacherCohortAccess.objects.create(teacher=teacher, cohort=self.cohort)
            self.client.force_login(teacher)

            detail = self.client.get(reverse("learning:teacher_student_detail", args=[self.enrollment.pk]))
            self.assertContains(detail, "class=\"teacher-growth-video\"")
            preview = self.client.get(reverse("learning:evidence_download", args=[evidence.pk]) + "?inline=1")
            self.assertEqual(preview.status_code, 200)
            self.assertEqual(preview["Content-Type"], "video/mp4")
            self.assertTrue(preview["Content-Disposition"].startswith("inline;"))
            preview.close()

    def test_r08_can_submit_a_video_without_changing_r01_to_r06(self):
        with TemporaryDirectory() as media_dir, TemporaryDirectory() as temp_dir, override_settings(MEDIA_ROOT=media_dir):
            source = Path(temp_dir) / "summary.m4v"
            create_video_file(source, audio=False)
            url = reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R08"])
            page = self.client.get(url)
            self.assertContains(page, 'accept="video/*"')
            self.assertContains(page, 'data-growth-images=""')
            self.assertContains(page, 'data-growth-documents=""')

            response = self.client.post(
                url,
                {
                    "action": "submit_review",
                    "learning_summary": "本期成果展示影片。",
                    "video": uploaded_video(source, "video/x-m4v"),
                },
            )
            self.assertEqual(response.status_code, 302)
            evidence = Evidence.objects.get(
                growth_submission__enrollment=self.enrollment,
                growth_submission__definition__slot_id="R08",
                evidence_type=Evidence.Type.VIDEO,
            )
            self.assertTrue(evidence.upload.name.endswith(".mp4"))
            self.assertEqual(evidence.processed_metadata["audio_codec"], None)
            submission = GrowthRecordSubmission.objects.get(
                enrollment=self.enrollment, definition__slot_id="R08"
            )
            self.assertEqual(submission.status, GrowthRecordSubmission.Status.SUBMITTED)

    def test_r08_long_video_is_trimmed_and_submission_is_completed(self):
        with TemporaryDirectory() as media_dir, TemporaryDirectory() as temp_dir, override_settings(MEDIA_ROOT=media_dir):
            source = Path(temp_dir) / "summary-long.mp4"
            create_video_file(source, duration=31, size="160x90", rate=1, audio=False)
            url = reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R08"])

            response = self.client.post(
                url,
                {
                    "action": "submit_review",
                    "learning_summary": "本期成果總結。",
                    "video": uploaded_video(source),
                },
            )

            self.assertEqual(response.status_code, 302)
            submission = GrowthRecordSubmission.objects.get(
                enrollment=self.enrollment, definition__slot_id="R08"
            )
            self.assertEqual(submission.status, GrowthRecordSubmission.Status.SUBMITTED)
            self.assertIsNotNone(submission.submitted_at)
            evidence = Evidence.objects.get(growth_submission=submission, evidence_type=Evidence.Type.VIDEO)
            self.assertLessEqual(evidence.processed_metadata["duration"], 30.01)

    def test_r08_single_document_is_enough_to_submit(self):
        with TemporaryDirectory() as media_dir, override_settings(MEDIA_ROOT=media_dir):
            url = reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R08"])
            response = self.client.post(
                url,
                {
                    "action": "submit_review",
                    "learning_summary": "只提交一份成果檔案。",
                    "documents": [uploaded_document("成果.pptx")],
                },
            )

            self.assertEqual(response.status_code, 302)
            submission = GrowthRecordSubmission.objects.get(
                enrollment=self.enrollment, definition__slot_id="R08"
            )
            self.assertEqual(submission.status, GrowthRecordSubmission.Status.SUBMITTED)

    def test_r08_long_video_is_trimmed_and_submitted(self):
        with TemporaryDirectory() as media_dir, TemporaryDirectory() as temp_dir, override_settings(MEDIA_ROOT=media_dir):
            source = Path(temp_dir) / "summary-too-long.mp4"
            create_video_file(source, duration=31, size="160x90", rate=1, audio=False)
            url = reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R08"])

            response = self.client.post(
                url,
                {
                    "action": "submit_review",
                    "learning_summary": "本期成果總結。",
                    "video": uploaded_video(source),
                },
            )

            self.assertEqual(response.status_code, 302)
            submission = GrowthRecordSubmission.objects.get(
                enrollment=self.enrollment, definition__slot_id="R08"
            )
            self.assertEqual(submission.status, GrowthRecordSubmission.Status.SUBMITTED)
            self.assertIsNotNone(submission.submitted_at)
            evidence = Evidence.objects.get(growth_submission=submission, evidence_type=Evidence.Type.VIDEO)
            self.assertLessEqual(evidence.processed_metadata["duration"], 30.01)
