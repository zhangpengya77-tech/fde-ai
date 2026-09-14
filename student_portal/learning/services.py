import secrets
from datetime import timedelta

from django.contrib.auth.hashers import make_password
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone

from .models import EmailVerificationCode


def send_activation_code(email, code):
    return send_mail(
        subject="FDE-AI 學員帳號電子郵件驗證",
        message=f"您的驗證碼是：{code}\n驗證碼 15 分鐘內有效；若非本人操作，請忽略此郵件。",
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[email],
        fail_silently=False,
    )


@transaction.atomic
def issue_activation_code(user):
    user = type(user).objects.select_for_update().get(pk=user.pk)
    now = timezone.now()
    latest = EmailVerificationCode.objects.filter(user=user, consumed_at__isnull=True).first()
    if latest and latest.created_at > now - timedelta(seconds=60):
        raise ValidationError("請稍候 60 秒後再要求新的驗證碼。")
    EmailVerificationCode.objects.filter(user=user, consumed_at__isnull=True).update(consumed_at=now)
    code = f"{secrets.randbelow(1_000_000):06d}"
    EmailVerificationCode.objects.create(
        user=user,
        code_hash=make_password(code),
        expires_at=now + timedelta(minutes=15),
    )
    if send_activation_code(user.email, code) != 1:
        raise ValidationError("驗證郵件未能寄出，請稍後再試。")
