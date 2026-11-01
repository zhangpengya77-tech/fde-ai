import os, sys, django
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()
from django.contrib.auth import get_user_model
from learning.models import Cohort, Enrollment, TeacherCohortAccess
U = get_user_model()
print("== staff ==")
for u in U.objects.filter(is_staff=True):
    print(f"  id={u.pk} {u.username} super={u.is_superuser}")
print("== non-staff (first 10) ==")
for u in U.objects.filter(is_staff=False)[:10]:
    print(f"  id={u.pk} {u.username}")
print("== cohorts ==")
for c in Cohort.objects.all():
    print(f"  id={c.pk} active={c.active} repr={str(c)}")
print("== TeacherCohortAccess ==")
for a in TeacherCohortAccess.objects.all():
    print(f"  teacher={a.teacher_id} cohort={a.cohort_id}")
print("== enrollments ==")
for e in Enrollment.objects.select_related("student","cohort")[:20]:
    print(f"  id={e.pk} student={e.student_id} pub={e.student.public_user_id} cohort={e.cohort_id} active={e.active} dir={e.project_direction}")
print("total enrollments", Enrollment.objects.count())
