from django.core.management.base import BaseCommand

from learning.course_sync import sync_course_definitions


class Command(BaseCommand):
    help = "Synchronize T01-T12 and R01-R08 definitions from the versioned JSON files without deleting learner data."

    def handle(self, *args, **options):
        result = sync_course_definitions()
        self.stdout.write(
            self.style.SUCCESS(
                "Course definitions synchronized: "
                f"tasks created={result['tasks_created']}, updated={result['tasks_updated']}; "
                f"growth created={result['growth_created']}, updated={result['growth_updated']}."
            )
        )
