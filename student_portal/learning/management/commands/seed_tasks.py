import json
from pathlib import Path

from django.core.management.base import BaseCommand

from learning.models import TaskDefinition


class Command(BaseCommand):
    help = "Create the editable FDE-AI v1.5 starter tasks without overwriting teacher edits."

    def handle(self, *args, **options):
        task_file = Path(__file__).resolve().parents[2] / "data" / "tasks_v1.json"
        with task_file.open(encoding="utf-8") as source:
            definitions = json.load(source)
        created = 0
        for definition in definitions:
            _, was_created = TaskDefinition.objects.get_or_create(
                task_id=definition["task_id"], defaults=definition
            )
            created += was_created
        self.stdout.write(self.style.SUCCESS(f"12 項預設任務已就緒；本次新增 {created} 項，既有教師編輯內容未覆寫。"))
