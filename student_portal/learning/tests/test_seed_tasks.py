from django.core.management import call_command
from django.test import TestCase

from learning.models import TaskDefinition


class DefaultTaskSeedTests(TestCase):
    def test_seed_is_idempotent_and_creates_the_thirteen_independent_tasks(self):
        call_command("seed_tasks")
        call_command("seed_tasks")

        tasks = TaskDefinition.objects.filter(active=True).order_by("sort_order", "task_id")   # T05、T13 同排序值，以編號決定先後
        self.assertEqual(tasks.count(), 13)
        # 2026-11-14：新增 T13 FPV 穿越機接線實訓，排序值同 T05，所以緊接在 F450 工程組裝之後
        self.assertEqual([task.task_id for task in tasks], ["T01", "T02", "T03", "T04", "T05", "T13", "T06", "T07", "T08", "T09", "T10", "T11", "T12"])
        self.assertEqual(tasks.get(task_id="T13").stage, TaskDefinition.Stage.PRACTICE)
        self.assertEqual(tasks.get(task_id="T12").stage, TaskDefinition.Stage.CERTIFY)

    def test_t13_fpv_wiring_task_content_and_record_link(self):
        # 2026-11-14：FPV 穿越機接線實訓。PNG 走既有「上傳佐證」；沒有一對一成長紀錄，只標相關 R05
        from learning.growth_task_map import task_map_note, task_record_slot, task_related_records

        call_command("seed_tasks", verbosity=0)
        task = TaskDefinition.objects.get(task_id="T13")
        self.assertEqual(task.title, "FPV 穿越機接線實訓")
        self.assertIn("FPV 接線圖 PNG", task.evidence_required)
        self.assertIn("hs-fpv.com", task.description)
        self.assertIn("不會自動記錄", task.description)
        self.assertIsNone(task_record_slot("T13"))
        self.assertEqual(task_related_records("T13"), ("R05",))
        self.assertIn("延伸練習", task_map_note("T13"))
