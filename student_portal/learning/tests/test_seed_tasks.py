from django.core.management import call_command
from django.test import TestCase

from learning.models import TaskDefinition


class DefaultTaskSeedTests(TestCase):
    def test_seed_is_idempotent_and_creates_the_twelve_independent_tasks(self):
        call_command("seed_tasks")
        call_command("seed_tasks")

        tasks = TaskDefinition.objects.filter(active=True).order_by("sort_order")
        self.assertEqual(tasks.count(), 12)
        self.assertEqual([task.task_id for task in tasks], [f"T{i:02d}" for i in range(1, 13)])
        self.assertEqual(tasks.get(task_id="T12").stage, TaskDefinition.Stage.CERTIFY)
