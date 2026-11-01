"""POWER_INSPECTION_V1 教師／學員入口：只測隔離資料與授權。"""

import json
import tempfile
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings
from django.urls import reverse

from learning.models import (
    Cohort,
    PowerInspectionCohortDeployment,
    PowerInspectionCohortDeploymentEvent,
    PowerInspectionJob,
    PowerInspectionModel,
    TeacherCohortAccess,
)
from learning.power_inspection_runner import PowerWorkerError
from learning.tests.helpers import create_student_account, enroll_student


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class PowerInspectionPortalTests(TestCase):
    def setUp(self):
        self.cohort_a = Cohort.objects.create(cohort_id="2099-PA", name="電力巡檢 A 班")
        self.cohort_b = Cohort.objects.create(cohort_id="2099-PB", name="電力巡檢 B 班")
        self.student_a = create_student_account("power-a@example.test", "巡檢學員 A")
        self.student_b = create_student_account("power-b@example.test", "巡檢學員 B")
        self.enrollment_a = enroll_student(self.student_a, self.cohort_a)
        self.enrollment_b = enroll_student(self.student_b, self.cohort_b)
        self.teacher_a = get_user_model().objects.create_user(username="power-teacher-a", password="test", is_staff=True)
        self.teacher_b = get_user_model().objects.create_user(username="power-teacher-b", password="test", is_staff=True)
        TeacherCohortAccess.objects.create(teacher=self.teacher_a, cohort=self.cohort_a)

    def _student(self, profile):
        client = Client(enforce_csrf_checks=True)
        client.force_login(profile.user)
        client.get(reverse("learning:power_inspection_task", args=[self.enrollment_a.pk if profile == self.student_a else self.enrollment_b.pk]))
        return client

    def test_student_mp4_upload_is_cohort_owned_and_blocked_without_real_model(self):
        with tempfile.TemporaryDirectory() as media, override_settings(MEDIA_ROOT=Path(media)):
            client = self._student(self.student_a)
            response = client.post(
                reverse("learning:power_inspection_upload", args=[self.enrollment_a.pk]),
                {"video": SimpleUploadedFile("tower.mp4", b"\x00\x00\x00\x18ftypisompayload", content_type="video/mp4")},
                HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
                HTTP_ORIGIN="http://testserver",
            )
            self.assertEqual(response.status_code, 201)
            job = PowerInspectionJob.objects.get()
            self.assertEqual(job.enrollment_id, self.enrollment_a.pk)
            self.assertEqual(job.inference_mode, "BLOCKED")
            self.assertEqual(job.status, "WAITING_FOR_REAL_MODEL")
            self.assertTrue(Path(job.video.path).is_file())

    def test_cross_cohort_teacher_cannot_read_job(self):
        job = PowerInspectionJob.objects.create(enrollment=self.enrollment_a, status="WAITING_FOR_REAL_MODEL", inference_mode="BLOCKED")
        client = Client(); client.force_login(self.teacher_b)
        response = client.get(reverse("learning:power_inspection_teacher_job", args=[job.pk]))
        self.assertEqual(response.status_code, 404)

    def test_student_job_status_api_is_private_to_owner(self):
        job = PowerInspectionJob.objects.create(
            enrollment=self.enrollment_a, status="WAITING_FOR_REAL_MODEL", inference_mode="BLOCKED"
        )
        owner = Client(); owner.force_login(self.student_a.user)
        self.assertEqual(owner.get(reverse("learning:power_inspection_student_job", args=[job.pk])).status_code, 200)
        other = Client(); other.force_login(self.student_b.user)
        self.assertEqual(other.get(reverse("learning:power_inspection_student_job", args=[job.pk])).status_code, 404)

    def test_growth_dashboard_shows_owner_power_inspection_record_without_changing_r01_r08(self):
        PowerInspectionJob.objects.create(
            enrollment=self.enrollment_a,
            original_filename="line-inspection.mp4",
            status=PowerInspectionJob.Status.WAITING_FOR_REAL_MODEL,
            inference_mode=PowerInspectionJob.InferenceMode.BLOCKED,
        )
        client = Client()
        client.force_login(self.student_a.user)
        response = client.get(reverse("learning:student_growth_dashboard", args=[self.enrollment_a.pk]))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "AI 電力巡檢紀錄")
        self.assertContains(response, "line-inspection.mp4")
        self.assertContains(response, reverse("learning:power_inspection_task", args=[self.enrollment_a.pk]))

    def test_teacher_model_import_is_explicitly_pending_not_mock_inference(self):
        client = Client(enforce_csrf_checks=True); client.force_login(self.teacher_a)
        client.get(reverse("learning:power_inspection_teacher"))
        response = client.post(
            reverse("learning:power_inspection_model_import"),
            {"model_file": SimpleUploadedFile("power.pt", b"untrusted", content_type="application/octet-stream"), "version": "v1", "class_contract": "MISSING_INSULATOR_DISC"},
            HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
            HTTP_ORIGIN="http://testserver",
        )
        self.assertEqual(response.status_code, 201)
        model = PowerInspectionModel.objects.get()
        self.assertEqual(model.status, "PENDING_REAL_MODEL_VALIDATION")
        self.assertEqual(model.inference_mode, "BLOCKED")

    def _imported_model(self, status):
        return PowerInspectionModel.objects.create(
            version="r6", sha256="a" * 64, class_contract=["foreign_object"], status=status, imported_by=self.teacher_a,
        )

    def test_verify_marks_model_real_only_after_worker_passes(self):
        model = self._imported_model(PowerInspectionModel.Status.IMPORTED)
        client = Client(); client.force_login(self.teacher_a)
        url = reverse("learning:power_inspection_verify", args=[model.model_id])
        with patch("learning.views.verify_power_model", side_effect=PowerWorkerError("model_classes_mismatch")):
            self.assertEqual(client.post(url).status_code, 422)
        model.refresh_from_db()
        self.assertEqual(model.inference_mode, "BLOCKED")
        with patch("learning.views.verify_power_model", return_value={}):
            self.assertEqual(client.post(url).status_code, 200)
        model.refresh_from_db()
        self.assertEqual((model.status, model.inference_mode), ("VALIDATED", "REAL"))

    def test_verify_rejects_incomplete_delivery(self):
        model = self._imported_model(PowerInspectionModel.Status.PENDING_REAL_MODEL_VALIDATION)
        client = Client(); client.force_login(self.teacher_a)
        response = client.post(reverse("learning:power_inspection_verify", args=[model.model_id]))
        self.assertEqual(response.status_code, 409)

    def test_complete_delivery_is_imported_but_not_validated_or_trial_ready(self):
        client = Client(enforce_csrf_checks=True); client.force_login(self.teacher_a)
        client.get(reverse("learning:power_inspection_teacher"))
        delivery = {
            "training": {"version": "2026.10", "date": "2026-10-31"},
            "metrics": {"precision": 0.91, "recall": 0.88, "map50": 0.90},
            "independent_test": {"report_id": "POWER-TEST-001", "passed": True},
            "inference": {"confidence": 0.25, "frame_stride": 3},
            "source_license": {"source": "internal", "license": "FDE-training-only"},
        }
        response = client.post(
            reverse("learning:power_inspection_model_import"),
            {
                "model_file": SimpleUploadedFile("power.onnx", b"untrusted", content_type="application/octet-stream"),
                "data_yaml_file": SimpleUploadedFile("data.yaml", b"names: [MISSING_INSULATOR_DISC]", content_type="text/yaml"),
                "version": "v2",
                "class_contract": "MISSING_INSULATOR_DISC",
                "delivery_manifest": json.dumps(delivery),
            },
            HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
            HTTP_ORIGIN="http://testserver",
        )
        self.assertEqual(response.status_code, 201)
        model = PowerInspectionModel.objects.get(version="v2")
        self.assertTrue(model.data_yaml.name)
        self.assertEqual(model.delivery_manifest["metrics"]["map50"], 0.90)
        self.assertEqual(model.status, "IMPORTED")
        self.assertEqual(model.inference_mode, "BLOCKED")

    def test_mov_and_dji_video_create_jobs(self):
        client = self._student(self.student_a)
        for name in ("IMG_8770.mov", "DJI_0001.MP4", "DJI_0001.LRF"):
            response = client.post(
                reverse("learning:power_inspection_upload", args=[self.enrollment_a.pk]),
                {"video": SimpleUploadedFile(name, b"\x00\x00\x00\x18ftypqt  payload", content_type="video/quicktime")},
                HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
                HTTP_ORIGIN="http://testserver",
            )
            self.assertEqual(response.status_code, 201, name)
        self.assertEqual(PowerInspectionJob.objects.count(), 3)

    def test_unsupported_extension_leaves_no_partial_job(self):
        client = self._student(self.student_a)
        response = client.post(
            reverse("learning:power_inspection_upload", args=[self.enrollment_a.pk]),
            {"video": SimpleUploadedFile("tower.exe", b"\x00\x00\x00\x18ftypisompayload", content_type="video/mp4")},
            HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
            HTTP_ORIGIN="http://testserver",
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(PowerInspectionJob.objects.count(), 0)

    def test_invalid_mp4_leaves_no_partial_job(self):
        client = self._student(self.student_a)
        response = client.post(
            reverse("learning:power_inspection_upload", args=[self.enrollment_a.pk]),
            {"video": SimpleUploadedFile("tower.mp4", b"not-a-container", content_type="video/mp4")},
            HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
            HTTP_ORIGIN="http://testserver",
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(PowerInspectionJob.objects.count(), 0)

    def test_cross_student_cannot_upload_to_other_enrollment(self):
        client = self._student(self.student_b)
        response = client.post(
            reverse("learning:power_inspection_upload", args=[self.enrollment_a.pk]),
            {"video": SimpleUploadedFile("tower.mp4", b"\x00\x00\x00\x18ftypisompayload", content_type="video/mp4")},
            HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
            HTTP_ORIGIN="http://testserver",
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(PowerInspectionJob.objects.count(), 0)

    def test_unverified_or_blocked_model_cannot_enable_trial(self):
        model = PowerInspectionModel.objects.create(
            version="v1", sha256="a" * 64, class_contract=["MISSING_INSULATOR_DISC"], imported_by=self.teacher_a
        )
        client = Client(enforce_csrf_checks=True); client.force_login(self.teacher_a)
        client.get(reverse("learning:power_inspection_teacher"))
        response = client.post(
            reverse("learning:power_inspection_trial", args=[model.pk]),
            {"cohort_id": self.cohort_a.pk},
            HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
            HTTP_ORIGIN="http://testserver",
        )
        self.assertEqual(response.status_code, 409)
        model.refresh_from_db()
        self.assertEqual(model.status, "PENDING_REAL_MODEL_VALIDATION")

    def test_cohort_has_one_explicit_validated_real_default_model(self):
        first = PowerInspectionModel.objects.create(
            version="v1", sha256="b" * 64, class_contract=["foreign_object"],
            status=PowerInspectionModel.Status.VALIDATED,
            inference_mode=PowerInspectionModel.InferenceMode.REAL,
            imported_by=self.teacher_a,
        )
        second = PowerInspectionModel.objects.create(
            version="v2", sha256="c" * 64, class_contract=["foreign_object"],
            status=PowerInspectionModel.Status.VALIDATED,
            inference_mode=PowerInspectionModel.InferenceMode.REAL,
            imported_by=self.teacher_a,
        )

        PowerInspectionCohortDeployment.objects.create(
            cohort=self.cohort_a, model=first, deployed_by=self.teacher_a,
        )
        PowerInspectionCohortDeployment.objects.update_or_create(
            cohort=self.cohort_a,
            defaults={"model": second, "deployed_by": self.teacher_a, "enabled": True},
        )

        deployment = PowerInspectionCohortDeployment.objects.get(cohort=self.cohort_a)
        self.assertEqual(deployment.model_id, second.model_id)
        self.assertTrue(deployment.enabled)
        self.assertFalse(PowerInspectionCohortDeployment.objects.filter(cohort=self.cohort_b).exists())

    def test_teacher_sets_cohort_default_and_student_upload_resolves_it_server_side(self):
        model = PowerInspectionModel.objects.create(
            version="v3", sha256="d" * 64, class_contract=["foreign_object"],
            status=PowerInspectionModel.Status.VALIDATED,
            inference_mode=PowerInspectionModel.InferenceMode.REAL,
            rule_version="POWER_INSPECTION_RULE_V7",
            rule_config={"confidence_threshold": 0.8, "max_gap_ms": 900},
            imported_by=self.teacher_a,
        )
        teacher = Client(enforce_csrf_checks=True)
        teacher.force_login(self.teacher_a)
        teacher.get(reverse("learning:power_inspection_teacher"))
        response = teacher.post(
            reverse("learning:power_inspection_deploy", args=[model.model_id]),
            {"cohort_id": self.cohort_a.cohort_id},
            HTTP_X_CSRFTOKEN=teacher.cookies["csrftoken"].value,
            HTTP_ORIGIN="http://testserver",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            PowerInspectionCohortDeployment.objects.get(cohort=self.cohort_a).model_id,
            model.model_id,
        )

        student = self._student(self.student_a)
        response = student.post(
            reverse("learning:power_inspection_upload", args=[self.enrollment_a.pk]),
            {"video": SimpleUploadedFile("tower.mp4", b"\x00\x00\x00\x18ftypisompayload", content_type="video/mp4")},
            HTTP_X_CSRFTOKEN=student.cookies["csrftoken"].value,
            HTTP_ORIGIN="http://testserver",
        )
        self.assertEqual(response.status_code, 201)
        job = PowerInspectionJob.objects.get()
        self.assertEqual(job.model_id, model.model_id)
        self.assertEqual(job.status, PowerInspectionJob.Status.QUEUED)
        self.assertEqual(job.inference_mode, PowerInspectionJob.InferenceMode.REAL)
        self.assertEqual(job.rule_version, "POWER_INSPECTION_RULE_V7")
        self.assertEqual(job.rule_config["confidence_threshold"], 0.8)

    def test_teacher_cannot_set_default_for_unassigned_cohort(self):
        model = PowerInspectionModel.objects.create(
            version="v4", sha256="e" * 64, class_contract=["foreign_object"],
            status=PowerInspectionModel.Status.VALIDATED,
            inference_mode=PowerInspectionModel.InferenceMode.REAL,
            imported_by=self.teacher_a,
        )
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.teacher_a)
        client.get(reverse("learning:power_inspection_teacher"))
        response = client.post(
            reverse("learning:power_inspection_deploy", args=[model.model_id]),
            {"cohort_id": self.cohort_b.cohort_id},
            HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
            HTTP_ORIGIN="http://testserver",
        )
        self.assertEqual(response.status_code, 404)
        self.assertFalse(PowerInspectionCohortDeployment.objects.exists())

    def test_teacher_page_keeps_default_assignment_for_real_teaching_trial_model(self):
        model = PowerInspectionModel.objects.create(
            version="v5", sha256="f" * 64, class_contract=["foreign_object"],
            status=PowerInspectionModel.Status.TEACHING_TRIAL,
            inference_mode=PowerInspectionModel.InferenceMode.REAL,
            rule_config={"confidence_threshold": 0.8, "max_gap_ms": 900},
            imported_by=self.teacher_a,
        )
        client = Client()
        client.force_login(self.teacher_a)
        response = client.get(reverse("learning:power_inspection_teacher"))
        self.assertContains(
            response,
            reverse("learning:power_inspection_deploy", args=[model.model_id]),
        )

    def test_authorized_teacher_can_disable_cohort_default_without_deleting_model(self):
        model = PowerInspectionModel.objects.create(
            version="v6", sha256="1" * 64, class_contract=["foreign_object"],
            status=PowerInspectionModel.Status.TEACHING_TRIAL,
            inference_mode=PowerInspectionModel.InferenceMode.REAL,
            rule_config={"confidence_threshold": 0.8, "max_gap_ms": 900},
            imported_by=self.teacher_a,
        )
        deployment = PowerInspectionCohortDeployment.objects.create(
            cohort=self.cohort_a, model=model, deployed_by=self.teacher_a,
        )
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.teacher_a)
        client.get(reverse("learning:power_inspection_teacher"))
        response = client.post(
            reverse("learning:power_inspection_deployment_disable", args=[deployment.pk]),
            HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
            HTTP_ORIGIN="http://testserver",
        )
        self.assertEqual(response.status_code, 200)
        deployment.refresh_from_db()
        self.assertFalse(deployment.enabled)
        self.assertTrue(PowerInspectionModel.objects.filter(model_id=model.model_id).exists())

    def test_disabled_default_model_leaves_new_student_work_waiting_for_real_model(self):
        model = PowerInspectionModel.objects.create(
            version="v7", sha256="2" * 64, class_contract=["foreign_object"],
            status=PowerInspectionModel.Status.TEACHING_TRIAL,
            inference_mode=PowerInspectionModel.InferenceMode.REAL,
            rule_config={"confidence_threshold": 0.8, "max_gap_ms": 900},
            imported_by=self.teacher_a,
        )
        PowerInspectionCohortDeployment.objects.create(
            cohort=self.cohort_a, model=model, deployed_by=self.teacher_a, enabled=False,
        )
        client = self._student(self.student_a)
        response = client.post(
            reverse("learning:power_inspection_upload", args=[self.enrollment_a.pk]),
            {"video": SimpleUploadedFile("tower.mp4", b"\x00\x00\x00\x18ftypisompayload", content_type="video/mp4")},
            HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
            HTTP_ORIGIN="http://testserver",
        )
        self.assertEqual(response.status_code, 201)
        job = PowerInspectionJob.objects.get()
        self.assertIsNone(job.model)
        self.assertEqual(job.status, PowerInspectionJob.Status.WAITING_FOR_REAL_MODEL)

    def test_teacher_can_roll_back_only_to_same_cohort_deployment_history(self):
        first = PowerInspectionModel.objects.create(version="v8", sha256="3" * 64, class_contract=["foreign_object"], status="VALIDATED", inference_mode="REAL", rule_config={"confidence_threshold": 0.8, "max_gap_ms": 900}, imported_by=self.teacher_a)
        second = PowerInspectionModel.objects.create(version="v9", sha256="4" * 64, class_contract=["foreign_object"], status="TEACHING_TRIAL", inference_mode="REAL", rule_config={"confidence_threshold": 0.8, "max_gap_ms": 900}, imported_by=self.teacher_a)
        deployment = PowerInspectionCohortDeployment.objects.create(cohort=self.cohort_a, model=second, deployed_by=self.teacher_a)
        old_event = PowerInspectionCohortDeploymentEvent.objects.create(deployment=deployment, cohort=self.cohort_a, model=first, model_version=first.version, actor=self.teacher_a, action="DEPLOYED")
        client = Client(enforce_csrf_checks=True); client.force_login(self.teacher_a)
        client.get(reverse("learning:power_inspection_teacher"))
        response = client.post(reverse("learning:power_inspection_deployment_rollback", args=[deployment.pk, old_event.pk]), HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value, HTTP_ORIGIN="http://testserver")
        self.assertEqual(response.status_code, 200)
        deployment.refresh_from_db()
        self.assertEqual(deployment.model_id, first.model_id)

    def test_rollback_rejects_unvalidated_history_model(self):
        blocked = PowerInspectionModel.objects.create(version="v10", sha256="5" * 64, class_contract=["foreign_object"], status="PENDING_REAL_MODEL_VALIDATION", inference_mode="REAL", rule_config={"confidence_threshold": 0.8, "max_gap_ms": 900}, imported_by=self.teacher_a)
        current = PowerInspectionModel.objects.create(version="v11", sha256="6" * 64, class_contract=["foreign_object"], status="TEACHING_TRIAL", inference_mode="REAL", rule_config={"confidence_threshold": 0.8, "max_gap_ms": 900}, imported_by=self.teacher_a)
        deployment = PowerInspectionCohortDeployment.objects.create(cohort=self.cohort_a, model=current, deployed_by=self.teacher_a)
        event = PowerInspectionCohortDeploymentEvent.objects.create(deployment=deployment, cohort=self.cohort_a, model=blocked, model_version=blocked.version, actor=self.teacher_a, action="DEPLOYED")
        client = Client(enforce_csrf_checks=True); client.force_login(self.teacher_a)
        client.get(reverse("learning:power_inspection_teacher"))
        response = client.post(reverse("learning:power_inspection_deployment_rollback", args=[deployment.pk, event.pk]), HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value, HTTP_ORIGIN="http://testserver")
        self.assertEqual(response.status_code, 409)
        deployment.refresh_from_db()
        self.assertEqual(deployment.model_id, current.model_id)

    def test_deploy_update_disable_and_rollback_write_audit_events(self):
        first = PowerInspectionModel.objects.create(version="v12", sha256="7" * 64, class_contract=["foreign_object"], status="VALIDATED", inference_mode="REAL", rule_config={"confidence_threshold": 0.8, "max_gap_ms": 900}, imported_by=self.teacher_a)
        second = PowerInspectionModel.objects.create(version="v13", sha256="8" * 64, class_contract=["foreign_object"], status="VALIDATED", inference_mode="REAL", rule_config={"confidence_threshold": 0.8, "max_gap_ms": 900}, imported_by=self.teacher_a)
        client = Client(enforce_csrf_checks=True); client.force_login(self.teacher_a)
        client.get(reverse("learning:power_inspection_teacher")); csrf = client.cookies["csrftoken"].value
        for model in (first, second):
            self.assertEqual(client.post(reverse("learning:power_inspection_deploy", args=[model.pk]), {"cohort_id": self.cohort_a.pk}, HTTP_X_CSRFTOKEN=csrf, HTTP_ORIGIN="http://testserver").status_code, 200)
        deployment = PowerInspectionCohortDeployment.objects.get(cohort=self.cohort_a)
        self.assertEqual(client.post(reverse("learning:power_inspection_deployment_disable", args=[deployment.pk]), HTTP_X_CSRFTOKEN=csrf, HTTP_ORIGIN="http://testserver").status_code, 200)
        original = PowerInspectionCohortDeploymentEvent.objects.filter(deployment=deployment, model=first, action="DEPLOYED").get()
        self.assertEqual(client.post(reverse("learning:power_inspection_deployment_rollback", args=[deployment.pk, original.pk]), HTTP_X_CSRFTOKEN=csrf, HTTP_ORIGIN="http://testserver").status_code, 200)
        actions = set(PowerInspectionCohortDeploymentEvent.objects.filter(deployment=deployment).values_list("action", flat=True))
        self.assertTrue({"DEPLOYED", "UPDATED", "DISABLED", "ROLLED_BACK"}.issubset(actions))
        for event in PowerInspectionCohortDeploymentEvent.objects.filter(deployment=deployment):
            self.assertEqual(event.model_version, event.model.version)
            self.assertEqual(event.outcome, "SUCCESS")

    def test_teacher_page_shows_authorized_deployment_history(self):
        model = PowerInspectionModel.objects.create(version="v14", sha256="9" * 64, class_contract=["foreign_object"], status="TEACHING_TRIAL", inference_mode="REAL", rule_config={"confidence_threshold": 0.8, "max_gap_ms": 900}, imported_by=self.teacher_a)
        deployment = PowerInspectionCohortDeployment.objects.create(cohort=self.cohort_a, model=model, deployed_by=self.teacher_a)
        PowerInspectionCohortDeploymentEvent.objects.create(deployment=deployment, cohort=self.cohort_a, model=model, model_version=model.version, actor=self.teacher_a, action="DEPLOYED", rule_version="POWER_INSPECTION_RULE_V1")
        client = Client(); client.force_login(self.teacher_a)
        response = client.get(reverse("learning:power_inspection_teacher"))
        self.assertContains(response, "模型部署歷程")
        self.assertContains(response, "v14")

    def test_teacher_cannot_roll_back_other_cohort_history(self):
        model = PowerInspectionModel.objects.create(version="v15", sha256="a" * 64, class_contract=["foreign_object"], status="TEACHING_TRIAL", inference_mode="REAL", rule_config={"confidence_threshold": 0.8, "max_gap_ms": 900}, imported_by=self.teacher_b)
        deployment = PowerInspectionCohortDeployment.objects.create(cohort=self.cohort_b, model=model, deployed_by=self.teacher_b)
        event = PowerInspectionCohortDeploymentEvent.objects.create(deployment=deployment, cohort=self.cohort_b, model=model, model_version=model.version, actor=self.teacher_b, action="DEPLOYED")
        client = Client(enforce_csrf_checks=True); client.force_login(self.teacher_a)
        client.get(reverse("learning:power_inspection_teacher"))
        response = client.post(reverse("learning:power_inspection_deployment_rollback", args=[deployment.pk, event.pk]), HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value, HTTP_ORIGIN="http://testserver")
        self.assertEqual(response.status_code, 404)

    def test_rollback_preserves_completed_student_inspection_job(self):
        """回退只改班級預設模型，既有巡檢工作與結果不得被改寫。"""
        previous = PowerInspectionModel.objects.create(
            version="v16", sha256="b" * 64, class_contract=["foreign_object"],
            status="VALIDATED", inference_mode="REAL",
            rule_config={"confidence_threshold": 0.8, "max_gap_ms": 900}, imported_by=self.teacher_a,
        )
        current = PowerInspectionModel.objects.create(
            version="v17", sha256="c" * 64, class_contract=["foreign_object"],
            status="TEACHING_TRIAL", inference_mode="REAL",
            rule_config={"confidence_threshold": 0.8, "max_gap_ms": 900}, imported_by=self.teacher_a,
        )
        deployment = PowerInspectionCohortDeployment.objects.create(
            cohort=self.cohort_a, model=current, deployed_by=self.teacher_a,
        )
        event = PowerInspectionCohortDeploymentEvent.objects.create(
            deployment=deployment, cohort=self.cohort_a, model=previous, model_version=previous.version,
            actor=self.teacher_a, action="DEPLOYED",
        )
        job = PowerInspectionJob.objects.create(
            enrollment=self.enrollment_a, model=current,
            status=PowerInspectionJob.Status.COMPLETED,
            inference_mode=PowerInspectionJob.InferenceMode.REAL,
            anomaly_timeline=[{"class_name": "foreign_object", "start_ms": 100}],
            result_json={"model_version": "v17", "result": "preserve"},
        )
        client = Client(enforce_csrf_checks=True); client.force_login(self.teacher_a)
        client.get(reverse("learning:power_inspection_teacher"))
        response = client.post(
            reverse("learning:power_inspection_deployment_rollback", args=[deployment.pk, event.pk]),
            HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
            HTTP_ORIGIN="http://testserver",
        )
        self.assertEqual(response.status_code, 200)
        deployment.refresh_from_db(); job.refresh_from_db()
        self.assertEqual(deployment.model_id, previous.model_id)
        self.assertEqual(job.model_id, current.model_id)
        self.assertEqual(job.status, PowerInspectionJob.Status.COMPLETED)
        self.assertEqual(job.result_json, {"model_version": "v17", "result": "preserve"})

    def test_existing_vision_center_contains_power_inspection_entry(self):
        template = (Path(__file__).resolve().parents[1] / "templates" / "learning" / "teacher_vision_center.html").read_text(encoding="utf-8")
        self.assertIn("power_inspection_teacher", template)

