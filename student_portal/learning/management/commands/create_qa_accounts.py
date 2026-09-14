import secrets

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from learning.growth_records import ensure_growth_submissions
from learning.models import (
    Cohort,
    Enrollment,
    LearningGroup,
    StudentProfile,
    TeacherCohortAccess,
)


class Command(BaseCommand):
    help = "Create or refresh local QA learner and teacher accounts with one-time random passwords."

    student_email = "qa-student@fde-ai.test"
    teacher_email = "qa-teacher@fde-ai.test"
    cohort_id = "QA-2026-01"

    def handle(self, *args, **options):
        User = get_user_model()
        student_password = secrets.token_urlsafe(24)
        teacher_password = secrets.token_urlsafe(24)

        student_user = self._get_or_create_user(User, self.student_email, student_password)
        teacher_user = self._get_or_create_user(User, self.teacher_email, teacher_password, staff=True)

        profile, created = StudentProfile.objects.get_or_create(
            user=student_user,
            defaults={
                "nickname": "QA 測試學員",
                "email": self.student_email,
                "account_type": StudentProfile.AccountType.STUDENT,
                "active": True,
            },
        )
        if profile.email and profile.email.lower() != self.student_email:
            raise CommandError("Reserved QA learner account is linked to a different email.")
        if not created:
            profile.nickname = "QA 測試學員"
            profile.email = self.student_email
            profile.account_type = StudentProfile.AccountType.STUDENT
            profile.active = True
            profile.save(update_fields=["nickname", "email", "account_type", "active"])

        cohort, _ = Cohort.objects.get_or_create(
            cohort_id=self.cohort_id,
            defaults={"name": "FDE-AI QA 測試課程", "active": True},
        )
        if not cohort.active:
            cohort.active = True
            cohort.save(update_fields=["active"])
        group, _ = LearningGroup.objects.get_or_create(
            cohort=cohort,
            code="QA",
            defaults={"name": "QA 測試組", "active": True},
        )
        enrollment, _ = Enrollment.objects.get_or_create(
            student=profile,
            cohort=cohort,
            defaults={"group": group, "active": True},
        )
        if enrollment.group_id != group.pk or not enrollment.active:
            enrollment.group = group
            enrollment.active = True
            enrollment.save(update_fields=["group", "active"])
        TeacherCohortAccess.objects.get_or_create(teacher=teacher_user, cohort=cohort)
        ensure_growth_submissions(enrollment)

        self.stdout.write(self.style.SUCCESS("QA accounts created. Passwords are shown once; do not commit them."))
        self.stdout.write(f"student_email={self.student_email}")
        self.stdout.write(f"student_password={student_password}")
        self.stdout.write(f"student_fde_id={profile.public_user_id}")
        self.stdout.write(f"teacher_email={self.teacher_email}")
        self.stdout.write(f"teacher_password={teacher_password}")

    def _get_or_create_user(self, User, email, password, *, staff=False):
        user = User.objects.filter(username=email).first()
        email_owner = User.objects.filter(email__iexact=email).exclude(pk=getattr(user, "pk", None)).first()
        if email_owner:
            raise CommandError(f"Reserved QA email {email} is already used by another account.")
        if user is None:
            user = User(username=email, email=email)
        user.email = email
        user.is_active = True
        if staff:
            user.is_staff = True
        user.set_password(password)
        user.save()
        return user
