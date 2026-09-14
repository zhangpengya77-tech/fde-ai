import uuid

from django.contrib.auth import get_user_model

from learning.models import Enrollment, StudentProfile


def create_student_account(email="student@example.com", nickname="Eagle", password="A-strong-passphrase-984!", active=True):
    email = email.lower()
    user = get_user_model().objects.create_user(
        username=email,
        email=email,
        password=password,
        is_active=active,
    )
    profile = StudentProfile.objects.create(
        student_id=uuid.uuid4().hex,
        nickname=nickname,
        email=email,
        user=user,
    )
    return profile


def enroll_student(profile, cohort):
    return Enrollment.objects.create(student=profile, cohort=cohort)
