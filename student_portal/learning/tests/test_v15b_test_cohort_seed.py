from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase

from learning.models import Cohort, Enrollment, GrowthRecordDefinition, GrowthRecordSubmission, LearningGroup, StudentProfile


class V15BTestCohortSeedTests(TestCase):
    def test_command_recreates_test_cohort_group_c_and_r01_to_r08_idempotently(self):
        call_command("seed_v15b_test_cohort", verbosity=0)

        cohort = Cohort.objects.get(cohort_id="2026-09")
        group = LearningGroup.objects.get(cohort=cohort, code="C")
        definitions = GrowthRecordDefinition.objects.filter(cohort=cohort).order_by("display_order")

        self.assertEqual(cohort.name, "v1.5B Test Cohort")
        self.assertEqual(group.name, "航线规划组")
        self.assertEqual([item.slot_id for item in definitions], [f"R{i:02d}" for i in range(1, 9)])

        user = get_user_model().objects.create_user(
            username="seed-test@example.com",
            email="seed-test@example.com",
            password="test-only-password",
        )
        student = StudentProfile.objects.create(
            user=user,
            nickname="Seed 測試學員",
            email=user.email,
            account_type=StudentProfile.AccountType.STUDENT,
        )
        enrollment = Enrollment.objects.create(student=student, cohort=cohort, group=group)

        call_command("seed_v15b_test_cohort", verbosity=0)

        self.assertEqual(Cohort.objects.filter(cohort_id="2026-09").count(), 1)
        self.assertEqual(LearningGroup.objects.filter(cohort=cohort, code="C").count(), 1)
        self.assertEqual(GrowthRecordDefinition.objects.filter(cohort=cohort).count(), 8)
        self.assertEqual(GrowthRecordSubmission.objects.filter(enrollment=enrollment).count(), 8)
