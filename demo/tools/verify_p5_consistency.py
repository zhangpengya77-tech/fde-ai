"""P5-A 口徑一致性檢查（在行程內以 Django test client 執行，唯讀）。

用途：驗證「班級卡片待複核成果（筆數）」與「學員篩選 pending（人數）」
使用同一工作項目集合，且與 DB 直接計算的期望值一致。

安全：只讀取；DB 路徑必須含 p5check 或 p42_verify，否則安全停止。
"""
import os
import re
import sys

import django

DB_PATH = os.environ.get("DJANGO_DB_NAME", "")
if not any(tag in DB_PATH for tag in ("p5check", "p42_verify", "demo.sqlite3")):
    print("[安全停止] 拒絕在非測試／DEMO 資料庫執行：%r" % DB_PATH)
    sys.exit(2)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "student_portal"))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from django.conf import settings  # noqa: E402
from django.contrib.auth import get_user_model  # noqa: E402
from django.test import Client  # noqa: E402

from learning.growth_task_map import task_record_slot, task_related_records  # noqa: E402
from learning.models import (  # noqa: E402
    Cohort,
    Enrollment,
    GrowthRecordSubmission,
    StudentTaskProgress,
)

if "testserver" not in settings.ALLOWED_HOSTS:
    settings.ALLOWED_HOSTS = list(settings.ALLOWED_HOSTS) + ["testserver"]

SUBMITTED = GrowthRecordSubmission.Status.SUBMITTED
NEEDS_REVISION = GrowthRecordSubmission.Status.NEEDS_REVISION
GROWTH_SUBMITTED = {SUBMITTED, NEEDS_REVISION, "approved", "rejected"}

results = []


def check(label, ok, detail=""):
    results.append(bool(ok))
    print("%s - %s%s" % ("PASS" if ok else "FAIL", label, (" | " + detail) if detail else ""))


def db_expected(cohort):
    """獨立計算期望值（不引用產品程式碼）。"""
    enrollments = list(Enrollment.objects.filter(cohort=cohort, active=True))
    pending_items = 0
    needs_items = 0
    students_with_pending = 0
    source_counts = {"成長紀錄": 0, "任務": 0}
    for enrollment in enrollments:
        student_pending = 0
        for sub in GrowthRecordSubmission.objects.filter(enrollment=enrollment):
            if sub.status == SUBMITTED:
                student_pending += 1
                pending_items += 1
                source_counts["成長紀錄"] += 1
            elif sub.status == NEEDS_REVISION:
                needs_items += 1
        for prog in StudentTaskProgress.objects.filter(enrollment=enrollment, status="submitted"):
            student_pending += 1
            pending_items += 1
            source_counts["任務"] += 1
        if student_pending > 0:
            students_with_pending += 1
    return {
        "pending_items": pending_items,
        "needs_items": needs_items,
        "students_with_pending": students_with_pending,
        "source_counts": source_counts,
        "student_count": len(enrollments),
    }


def main():
    User = get_user_model()
    # A 班／B 班各由不同授權教師查看（P5-A 亦驗證跨班不洩漏）。
    # C 班為空班級，依種子設定授權給 A 師（用於空狀態驗證）。
    teacher_a = User.objects.filter(username__startswith="p42.teacher.a").first()
    teacher_b = User.objects.filter(username__startswith="p42.teacher.b").first()
    teacher_by_prefix = {
        "P42-A": teacher_a,
        "P42-B": teacher_b,
        "P42-C": teacher_a,
    }
    if any(t is None for t in teacher_by_prefix.values()):
        print("[安全停止] 找不到測試教師帳號。")
        sys.exit(2)

    for cohort in Cohort.objects.filter(cohort_id__startswith="P42-").order_by("cohort_id"):
        teacher = teacher_by_prefix.get(cohort.cohort_id[:5])
        if teacher is None:
            print("[安全停止] 班級 %s 沒有對應授權教師，拒絕以匿名身分查詢。" % cohort.cohort_id)
            sys.exit(2)
        client = Client()
        client.force_login(teacher)
        expected = db_expected(cohort)
        url = "/teacher/class-outcomes/?cohort=%s" % cohort.cohort_id
        resp = client.get(url)
        check("班級 %s 頁面可開啟" % cohort.cohort_id, resp.status_code == 200, "HTTP %s" % resp.status_code)
        html = resp.content.decode("utf-8")

        # 卡片結構：<span class="tco-stat-num">N</span><span class="tco-stat-label">待複核成果（筆）</span>
        m = re.search(
            r'tco-stat-num[^>]*>\s*(\d+)\s*<[^>]*>\s*<span class="tco-stat-label">待複核成果（筆）',
            html,
            re.S,
        )
        card = int(m.group(1)) if m else None
        check(
            "班級卡片「待複核成果（筆）」與 DB 一致",
            card == expected["pending_items"],
            "頁面 %s ｜ DB %s" % (card, expected["pending_items"]),
        )

        m = re.search(r"有待複核成果（人數）", html)
        check("學員篩選標籤明示單位「人數」", bool(m), "label present" if m else "label missing")

        m = re.search(r"目前\s*(\d+)\s*人", html)
        students = int(m.group(1)) if m else None
        check(
            "學員篩選「有待複核成果」人數與 DB 一致",
            students == expected["students_with_pending"],
            "頁面 %s ｜ DB %s" % (students, expected["students_with_pending"]),
        )

        m = re.search(r"另有需要補充\s*(\d+)\s*筆", html)
        needs = int(m.group(1)) if m else None
        check(
            "「需要補充」筆數與 DB 一致",
            needs == expected["needs_items"],
            "頁面 %s ｜ DB %s" % (needs, expected["needs_items"]),
        )

        for kind, count in expected["source_counts"].items():
            label = "任務提交" if kind == "任務" else kind
            check(
                "資料來源標示 %s = %d 筆" % (label, count),
                ("%s %d 筆" % (label, count)) in html,
                "expected fragment present",
            )

        check(
            "卡片筆數 ≥ 篩選人數（單位不同但同一集合）",
            card is not None and students is not None and card >= students,
            "筆 %s ｜ 人 %s" % (card, students),
        )

    print("")
    print("==== P5-A 口徑一致性結果：%d 項通過 / %d 項失敗 / 共 %d 項 ====" % (
        sum(results), len(results) - sum(results), len(results)))
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
