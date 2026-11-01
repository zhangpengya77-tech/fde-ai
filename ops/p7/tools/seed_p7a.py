"""P7-A 隔離測試資料種子（僅寫入 P7-A 獨立 SQLite，不碰任何正式/DEMO 資料）。

建立：
  - 兩個班級 COHORT-A / COHORT-B
  - 教師 A（僅授權 COHORT-A）、教師 B（僅授權 COHORT-B）
  - 學員 S1（僅在 COHORT-A）
用途：驗證「跨班級教師被拒」（驗收第 5 項）與「學員上傳／教師複核」（第 8 項）。
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "student_portal"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django  # noqa: E402

django.setup()

from django.contrib.auth import get_user_model  # noqa: E402

from learning.models import Cohort, Enrollment, StudentProfile, TeacherCohortAccess  # noqa: E402

User = get_user_model()

PASSWORD = os.environ.get("P7A_SEED_PASSWORD", "P7a-isolated-only-2026")

# 2026-10-29（P7-A）：學員登入頁以「電子郵件 + 密碼」驗證（StudentLoginView），
# 教師登入頁以使用者名稱驗證（TeacherLoginView）。初版種子未寫 email，導致學員
# 永遠登入失敗（表單回「電子郵箱或密碼錯誤」）。此處補上 `.invalid` 保留網域
# （RFC 2606），確保不會指向任何真實信箱。
EMAILS = {
    "p7a.teacher.a": "p7a.teacher.a@p7a.invalid",
    "p7a.teacher.b": "p7a.teacher.b@p7a.invalid",
    "p7a.student.s1": "p7a.student.s1@p7a.invalid",
}


def main() -> int:
    cohort_a, _ = Cohort.objects.get_or_create(cohort_id="COHORT-A", defaults={"name": "P7A 班級 A", "active": True})
    cohort_b, _ = Cohort.objects.get_or_create(cohort_id="COHORT-B", defaults={"name": "P7A 班級 B", "active": True})

    teacher_a, _ = User.objects.get_or_create(
        username="p7a.teacher.a",
        defaults={"is_staff": True, "is_active": True, "email": EMAILS["p7a.teacher.a"]},
    )
    teacher_a.is_staff = True
    teacher_a.is_active = True
    teacher_a.email = EMAILS["p7a.teacher.a"]
    teacher_a.set_password(PASSWORD)
    teacher_a.save()

    teacher_b, _ = User.objects.get_or_create(
        username="p7a.teacher.b",
        defaults={"is_staff": True, "is_active": True, "email": EMAILS["p7a.teacher.b"]},
    )
    teacher_b.is_staff = True
    teacher_b.is_active = True
    teacher_b.email = EMAILS["p7a.teacher.b"]
    teacher_b.set_password(PASSWORD)
    teacher_b.save()

    TeacherCohortAccess.objects.get_or_create(teacher=teacher_a, cohort=cohort_a)
    # 教師 A 明確「不」授權 COHORT-B。
    TeacherCohortAccess.objects.filter(teacher=teacher_a, cohort=cohort_b).delete()
    TeacherCohortAccess.objects.get_or_create(teacher=teacher_b, cohort=cohort_b)

    student_user, _ = User.objects.get_or_create(
        username="p7a.student.s1",
        defaults={"is_active": True, "email": EMAILS["p7a.student.s1"]},
    )
    student_user.is_active = True
    student_user.email = EMAILS["p7a.student.s1"]
    student_user.set_password(PASSWORD)
    student_user.save()

    profile = StudentProfile.objects.filter(user=student_user).first()
    if profile is None:
        profile = StudentProfile.objects.create(user=student_user, nickname="P7A 學員 S1", active=True)
    profile.active = True
    profile.save()

    Enrollment.objects.get_or_create(student=profile, cohort=cohort_a, defaults={"active": True})
    Enrollment.objects.filter(student=profile, cohort=cohort_b).delete()

    print("cohort_a", cohort_a.pk, "cohort_b", cohort_b.pk)
    print("teacher_a", teacher_a.pk, teacher_a.username)
    print("teacher_b", teacher_b.pk, teacher_b.username)
    print("student_profile", profile.pk, "user", student_user.pk, student_user.username)
    print("teacher_a_cohorts", list(TeacherCohortAccess.objects.filter(teacher=teacher_a).values_list("cohort__cohort_id", flat=True)))
    print("teacher_b_cohorts", list(TeacherCohortAccess.objects.filter(teacher=teacher_b).values_list("cohort__cohort_id", flat=True)))
    print("student_cohorts", list(Enrollment.objects.filter(student=profile, active=True).values_list("cohort__cohort_id", flat=True)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
