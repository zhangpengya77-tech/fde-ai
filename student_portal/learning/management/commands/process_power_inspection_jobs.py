"""獨立處理 POWER_INSPECTION_V1 影片工作，不在 Django request 執行推論。"""

import time

from django.core.management.base import BaseCommand

from learning.power_inspection_jobs import process_next_job
from learning.power_inspection_runner import run_job


class Command(BaseCommand):
    help = "處理一筆電力巡檢影片工作；預設不允許 MOCK。"

    def add_arguments(self, parser):
        parser.add_argument("--allow-mock-test", action="store_true", help="僅隔離自動化測試允許 MOCK 工作完成。")
        parser.add_argument("--loop", action="store_true", help="持續等待並處理新工作。")

    def handle(self, *args, **options):
        while True:
            job = process_next_job(allow_mock_test=bool(options["allow_mock_test"]), real_runner=run_job)
            if job is not None:
                self.stdout.write(f"JOB={job.job_id} STATUS={job.status} MODE={job.inference_mode}")
            elif not options["loop"]:
                self.stdout.write("NO_QUEUED_JOB")
                return
            else:
                time.sleep(5)
