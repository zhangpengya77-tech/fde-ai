from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from learning.growth_records import ensure_growth_submissions, seed_growth_record_definitions
from learning.models import Cohort, Enrollment, LearningGroup


class Command(BaseCommand):
    help = "Initialize the v1.5B test cohort, Group C, and its R01-R08 records."

    cohort_id = "2026-09"
    cohort_name = "v1.5B Test Cohort"
    group_code = "C"
    group_name = "航线规划组"

    @transaction.atomic
    def handle(self, *args, **options):
        cohort, _ = Cohort.objects.get_or_create(
            cohort_id=self.cohort_id,
            defaults={"name": self.cohort_name, "active": True},
        )
        if cohort.name != self.cohort_name:
            raise CommandError(
                f"Cohort {self.cohort_id} already exists with a different name; it was not changed."
            )
        if not cohort.active:
            raise CommandError(f"Cohort {self.cohort_id} is inactive; it was not changed.")

        group, _ = LearningGroup.objects.get_or_create(
            cohort=cohort,
            code=self.group_code,
            defaults={"name": self.group_name, "active": True},
        )
        if group.name != self.group_name:
            raise CommandError(
                f"Group {self.group_code} already exists with a different name; it was not changed."
            )
        if not group.active:
            raise CommandError(f"Group {self.group_code} is inactive; it was not changed.")

        definitions = seed_growth_record_definitions(cohort)
        expected_slots = [f"R{number:02d}" for number in range(1, 9)]
        if sorted(item.slot_id for item in definitions) != expected_slots:
            raise CommandError("The versioned growth-record config must define R01 through R08.")

        enrollments = Enrollment.objects.filter(cohort=cohort, active=True).select_related("cohort", "group")
        for enrollment in enrollments:
            ensure_growth_submissions(enrollment)

        self.stdout.write(
            self.style.SUCCESS(
                f"{self.cohort_name} ready: {self.group_code} {self.group_name}; R01-R08 initialized."
            )
        )
