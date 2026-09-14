from django.core.management.base import BaseCommand, CommandError

from learning.growth_records import ensure_growth_submissions, seed_growth_record_definitions
from learning.models import Cohort, Enrollment


class Command(BaseCommand):
    help = "Initialize the configurable R01-R08 growth records for one or all cohorts."

    def add_arguments(self, parser):
        parser.add_argument("cohort_id", nargs="?", help="Cohort ID such as 2026-01; defaults to all cohorts.")

    def handle(self, *args, **options):
        cohort_id = options["cohort_id"]
        cohorts = Cohort.objects.all()
        if cohort_id:
            cohorts = cohorts.filter(cohort_id=cohort_id)
            if not cohorts.exists():
                raise CommandError(f"Cohort {cohort_id} does not exist.")

        initialized = 0
        for cohort in cohorts:
            seed_growth_record_definitions(cohort)
            for enrollment in Enrollment.objects.filter(cohort=cohort, active=True).select_related("cohort", "group"):
                ensure_growth_submissions(enrollment)
            initialized += 1

        self.stdout.write(self.style.SUCCESS(f"Initialized growth records for {initialized} cohort(s)."))
