from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from learning.models import ClassCode, Cohort


REGISTRATION_CLASS_CODES = tuple(f"2026-{number:02d}" for number in range(1, 7))


class Command(BaseCommand):
    help = "Initialize the 2026 registration cohorts and class codes without changing existing records."

    @transaction.atomic
    def handle(self, *args, **options):
        for code in REGISTRATION_CLASS_CODES:
            cohort, _ = Cohort.objects.get_or_create(
                cohort_id=code,
                defaults={"name": f"{code} 班", "active": True},
            )
            if not cohort.active:
                raise CommandError(f"Cohort {code} is inactive; it was not changed.")

            class_code, _ = ClassCode.objects.get_or_create(code=code, defaults={"cohort": cohort})
            if class_code.cohort_id != cohort.cohort_id:
                raise CommandError(f"Class code {code} belongs to a different cohort; it was not changed.")
            if not class_code.active:
                raise CommandError(f"Class code {code} is inactive; it was not changed.")

        self.stdout.write(self.style.SUCCESS("2026-01 through 2026-06 registration class codes are ready."))
