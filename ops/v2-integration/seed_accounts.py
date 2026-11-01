"""在隔離資料庫建立驗收帳號；密碼隨機產生並只寫入 RUNTIME/accounts.json。"""

from __future__ import annotations

import json
import os
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "student_portal"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django  # noqa: E402

django.setup()

from django.contrib.auth import get_user_model  # noqa: E402

from learning.models import Cohort, Enrollment, StudentProfile, TeacherCohortAccess  # noqa: E402
from learning.tests.helpers import create_student_account, enroll_student  # noqa: E402


def main(output: Path) -> None:
    if output.exists():
        print("accounts already seeded")
        return
    password = secrets.token_urlsafe(16)
    accounts = {"password": password, "cohorts": {}}
    User = get_user_model()
    for key, email in (("A", "v2.student.a@integration.invalid"), ("B", "v2.student.b@integration.invalid")):
        cohort, _ = Cohort.objects.get_or_create(cohort_id=f"V2-{key}", defaults={"name": f"V2 集成 {key} 班"})
        teacher = User.objects.create_user(username=f"v2.teacher.{key.lower()}", password=password, is_staff=True)
        TeacherCohortAccess.objects.get_or_create(teacher=teacher, cohort=cohort)
        profile = create_student_account(email, f"集成學員 {key}", password=password)
        enrollment = enroll_student(profile, cohort)
        accounts["cohorts"][key] = {
            "cohort_pk": cohort.pk, "cohort_id": cohort.cohort_id, "teacher": teacher.username,
            "student": email, "enrollment": enrollment.pk, "student_id": profile.public_user_id,
        }
    output.write_text(json.dumps(accounts, ensure_ascii=False, indent=2), encoding="utf-8")
    print("seeded", len(accounts["cohorts"]), "cohorts;", Enrollment.objects.count(), StudentProfile.objects.count())


if __name__ == "__main__":
    main(Path(sys.argv[1]))
