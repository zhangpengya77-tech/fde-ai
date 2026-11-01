"""階段四（C）班級隔離測試資料種子。

只對「隔離 DB」執行（DJANGO_DB_NAME 指向 ops/launch-20261028/isolated-phase4/db/demo.sqlite3），
絕不接觸正式 8022 或 DEMO 8110 的資料庫。

建立的資料
----------
班級 A：沿用既有 F450-DEMO-2026（教師 A = demo.teacher@fde-demo.local，學員 A = demo.student01）
班級 B：2026-99（教師 B = phase4.teacherB，學員 B = phase4.studentB）
教師 C：phase4.teacherC，**刻意不指派任何班級**，用於 P-08「無班級關聯安全拒絕」

用法：
    set DJANGO_DB_NAME=<isolated-phase4>\db\demo.sqlite3
    python seed_phase4_cohorts.py
"""

from __future__ import annotations

import json
import os
import sys

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(TOOLS_DIR)))
sys.path.insert(0, os.path.join(PROJECT_ROOT, "student_portal"))

import django  # noqa: E402

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from django.contrib.auth import get_user_model  # noqa: E402

from learning.models import Cohort, Enrollment, StudentProfile, TeacherCohortAccess  # noqa: E402

SHARED_PASSWORD = "zYpy8gr4p9NDRQqV"
COHORT_A = "F450-DEMO-2026"
COHORT_B = "2026-99"

User = get_user_model()
report: dict = {"cohorts": {}, "users": {}, "enrollments": {}, "access": []}


def ensure_user(username: str, *, nickname: str, is_staff: bool):
    user, created = User.objects.get_or_create(
        username=username,
        defaults={"email": username, "is_staff": is_staff, "is_active": True},
    )
    changed = False
    if user.is_staff != is_staff:
        user.is_staff = is_staff
        changed = True
    if not user.is_active:
        user.is_active = True
        changed = True
    user.set_password(SHARED_PASSWORD)
    user.save()
    return user, created, changed


def ensure_cohort(cohort_id: str, name: str):
    cohort, created = Cohort.objects.get_or_create(
        cohort_id=cohort_id, defaults={"name": name, "active": True}
    )
    if not cohort.active:
        cohort.active = True
        cohort.save(update_fields=["active"])
    return cohort, created


# ---- 班級 -----------------------------------------------------------------
cohort_a, created_a = ensure_cohort(COHORT_A, "FDE-AI-UAS DEMO 展示班（苗栗合作）")
cohort_b, created_b = ensure_cohort(COHORT_B, "階段四隔離測試班 B")
report["cohorts"] = {
    "A": {"cohort_id": cohort_a.cohort_id, "created": created_a},
    "B": {"cohort_id": cohort_b.cohort_id, "created": created_b},
}

# ---- 教師 ----------------------------------------------------------------
teacher_a = User.objects.get(username="demo.teacher@fde-demo.local")
teacher_b, tb_created, _ = ensure_user("phase4.teacherB@fde-demo.local", nickname="教師B", is_staff=True)
teacher_c, tc_created, _ = ensure_user("phase4.teacherC@fde-demo.local", nickname="教師C", is_staff=True)
report["users"] = {
    "teacherA": {"pk": teacher_a.pk, "username": teacher_a.username},
    "teacherB": {"pk": teacher_b.pk, "username": teacher_b.username, "created": tb_created},
    "teacherC": {"pk": teacher_c.pk, "username": teacher_c.username, "created": tc_created},
}

# ---- 班級授權（教師 C 刻意不指派）------------------------------------------
for teacher, cohort in ((teacher_a, cohort_a), (teacher_b, cohort_b)):
    access, created = TeacherCohortAccess.objects.get_or_create(teacher=teacher, cohort=cohort)
    access.full_clean()
    report["access"].append(
        {
            "teacher": teacher.username,
            "cohort": cohort.cohort_id,
            "created": created,
        }
    )

# ---- 學員 B ---------------------------------------------------------------
student_b_user, sb_created, _ = ensure_user("phase4.studentB@fde-demo.local", nickname="學員B", is_staff=False)
profile_b, pb_created = StudentProfile.objects.get_or_create(
    user=student_b_user,
    defaults={"nickname": "學員B", "email": student_b_user.username, "account_type": "student", "active": True},
)
if profile_b.email != student_b_user.username or profile_b.account_type != "student":
    profile_b.email = student_b_user.username
    profile_b.account_type = "student"
    profile_b.save()

enrollment_b, eb_created = Enrollment.objects.get_or_create(
    student=profile_b,
    cohort=cohort_b,
    defaults={"project_direction": "ai_flight_assessment", "active": True, "training_source": "pre_employment"},
)
if not enrollment_b.active:
    enrollment_b.active = True
    enrollment_b.save(update_fields=["active"])

student_a_user = User.objects.get(username="demo.student01@fde-demo.local")
enrollment_a = (
    Enrollment.objects.filter(student__user=student_a_user, cohort=cohort_a)
    .select_related("student")
    .first()
)

report["enrollments"] = {
    "A": {
        "enrollment_id": getattr(enrollment_a, "pk", None),
        "student_pk": getattr(getattr(enrollment_a, "student", None), "pk", None),
        "public_user_id": getattr(getattr(enrollment_a, "student", None), "public_user_id", None),
    },
    "B": {
        "enrollment_id": enrollment_b.pk,
        "student_pk": profile_b.pk,
        "public_user_id": profile_b.public_user_id,
        "created": eb_created,
    },
}

print(json.dumps(report, ensure_ascii=False, indent=2))
