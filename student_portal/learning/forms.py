import logging
import uuid
from pathlib import Path
from django import forms
from django.forms.widgets import ClearableFileInput
from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.forms import AuthenticationForm, PasswordResetForm
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from .models import (
    ClassCode,
    Enrollment,
    Evidence,
    GrowthRecordReview,
    PhaseProgress,
    StudentProfile,
    StudentTaskProgress,
    TeacherReviewEvent,
    EmailVerificationCode,
)
from .services import issue_activation_code
from .project_directions import learner_direction_options


logger = logging.getLogger(__name__)


def _mask_login_email(email):
    local, separator, domain = email.partition("@")
    if not separator:
        return "***"
    return f"{local[:2]}***@{domain}"


REGISTRATION_CLASS_CODES = (
    ("2026-01", "2026-01"),
    ("2026-02", "2026-02"),
    ("2026-03", "2026-03"),
    ("2026-04", "2026-04"),
    ("2026-05", "2026-05"),
    ("2026-06", "2026-06"),
)


class StudentRegistrationForm(forms.Form):
    nickname = forms.CharField(
        label="姓名／暱稱",
        max_length=40,
        help_text="建議填寫授課教師可辨識的姓名，例如：張○亞；也可使用個人暱稱。",
    )
    email = forms.EmailField(label="電子郵件")
    class_code = forms.ChoiceField(
        label="班級代碼",
        choices=REGISTRATION_CLASS_CODES,
        initial="2026-01",
        help_text="請依教師指示選擇本期班級代碼。",
    )
    training_source = forms.ChoiceField(
        label="班型來源",
        choices=[("", "請選擇班型來源"), *Enrollment.TrainingSource.choices],
        required=True,
    )
    project_direction = forms.ChoiceField(
        label="組別／專案方向",
        choices=learner_direction_options(),
        required=False,
        initial="",
    )
    password1 = forms.CharField(label="密碼", widget=forms.PasswordInput)
    password2 = forms.CharField(label="確認密碼", widget=forms.PasswordInput)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    def clean_email(self):
        email = self.cleaned_data["email"].strip().lower()
        if StudentProfile.objects.filter(email__iexact=email).exists():
            raise ValidationError("此電子郵件已註冊，請直接登入或使用忘記密碼功能。")
        user_model = get_user_model()
        if user_model.objects.filter(email__iexact=email).exists():
            raise ValidationError("此電子郵件已註冊，請直接登入或使用忘記密碼功能。")
        return email

    def clean(self):
        cleaned = super().clean()
        password1 = cleaned.get("password1")
        password2 = cleaned.get("password2")
        if password1 and password2 and password1 != password2:
            self.add_error("password2", "兩次輸入的密碼不一致。")
        if password1:
            try:
                validate_password(password1)
            except ValidationError as exc:
                self.add_error("password1", exc)
        return cleaned

    def clean_class_code(self):
        value = self.cleaned_data["class_code"].strip().upper()
        if not value:
            self._class_code = None
            return value
        code = ClassCode.objects.filter(code=value, active=True).select_related("cohort").first()
        if code is None or not code.cohort.active:
            raise ValidationError("班級代碼無效，請向授課教師確認。")
        if code.expires_at and code.expires_at <= timezone.now():
            raise ValidationError("班級代碼已過期，請向授課教師確認。")
        if code.max_uses is not None and code.use_count >= code.max_uses:
            raise ValidationError("班級代碼已達使用上限，請向授課教師確認。")
        self._class_code = code
        return value

    @transaction.atomic
    def create_account(self):
        user_model = get_user_model()
        user = user_model.objects.create_user(
            username=self.cleaned_data["email"],
            email=self.cleaned_data["email"],
            password=self.cleaned_data["password1"],
            is_active=False,
        )
        profile = StudentProfile.objects.create(
            student_id=uuid.uuid4().hex,
            nickname=self.cleaned_data["nickname"].strip(),
            email=self.cleaned_data["email"],
            user=user,
        )
        if self._class_code is not None:
            code = ClassCode.objects.select_for_update().select_related("cohort").get(pk=self._class_code.pk)
            enrollment, created = Enrollment.objects.get_or_create(
                student=profile,
                cohort=code.cohort,
                defaults={
                    "project_direction": self.cleaned_data.get("project_direction") or None,
                    "training_source": self.cleaned_data["training_source"],
                },
            )
            updates = {}
            project_direction = self.cleaned_data.get("project_direction") or None
            if not created and enrollment.project_direction != project_direction:
                enrollment.project_direction = project_direction
                updates["project_direction"] = project_direction
            if not created and enrollment.training_source != self.cleaned_data["training_source"]:
                enrollment.training_source = self.cleaned_data["training_source"]
                updates["training_source"] = self.cleaned_data["training_source"]
            if updates:
                enrollment.save(update_fields=list(updates))
            code.use_count += 1
            code.save(update_fields=["use_count"])
        issue_activation_code(user)
        return profile


class ProjectDirectionForm(forms.Form):
    project_direction = forms.ChoiceField(label="本期專案方向", choices=learner_direction_options())


class TeacherIdentityForm(forms.Form):
    teacher_verified_name = forms.CharField(label="教師核實姓名", max_length=40, required=False)

    def clean_teacher_verified_name(self):
        return self.cleaned_data["teacher_verified_name"].strip()


class StudentLoginForm(AuthenticationForm):
    username = forms.EmailField(label="電子郵件")

    def clean_username(self):
        return self.cleaned_data["username"].strip().lower()

    def clean(self):
        cleaned_data = forms.Form.clean(self)
        email = cleaned_data.get("username")
        password = cleaned_data.get("password")
        if not email or not password:
            return cleaned_data

        user_model = get_user_model()
        user = (
            user_model.objects.filter(email__iexact=email)
            .select_related("student_profile")
            .first()
        )
        verification_completed = bool(
            user
            and EmailVerificationCode.objects.filter(
                user=user,
                consumed_at__isnull=False,
            ).exists()
        )
        diagnostic = {
            "email": _mask_login_email(email),
            "user_found": user is not None,
            "email_verified": bool(user and (user.is_active or verification_completed)),
            "is_active": bool(user and user.is_active),
            "check_password": False,
            "authenticate": False,
            "session_created": False,
            "redirect_url": "",
            "user_agent": self.request.META.get("HTTP_USER_AGENT", "")[:240],
        }
        self.login_diagnostic = diagnostic
        if user is None:
            logger.info("Student login diagnostic: %s", diagnostic)
            self.add_error(None, "電子郵箱或密碼錯誤，請重新確認。")
            return cleaned_data
        if not user.is_active:
            if verification_completed:
                user.is_active = True
                user.save(update_fields=["is_active"])
                diagnostic["is_active"] = True
            else:
                logger.info("Student login diagnostic: %s", diagnostic)
                self.unverified_email = email
                self.add_error(None, "此帳號尚未完成電子郵件驗證，請先完成驗證。")
                return cleaned_data

        diagnostic["check_password"] = user.check_password(password)
        self.user_cache = authenticate(
            self.request,
            username=user.get_username(),
            password=password,
        )
        diagnostic["authenticate"] = self.user_cache is not None
        if self.user_cache is None:
            logger.info("Student login diagnostic: %s", diagnostic)
            self.add_error(None, "電子郵箱或密碼錯誤，請重新確認。")
            return cleaned_data
        self.confirm_login_allowed(self.user_cache)
        logger.info("Student login diagnostic: %s", diagnostic)
        return cleaned_data

    def confirm_login_allowed(self, user):
        super().confirm_login_allowed(user)
        if user.is_staff:
            raise ValidationError("教師帳號請使用教師登入。")
        if not StudentProfile.objects.filter(user=user, active=True).exists():
            raise ValidationError("此帳號沒有有效的學員資料，請聯絡管理員。")


class TeacherLoginForm(AuthenticationForm):
    username = forms.CharField(label="教師帳號")

    def confirm_login_allowed(self, user):
        super().confirm_login_allowed(user)
        if not user.is_staff:
            raise ValidationError("此帳號沒有教師後台權限。")


class StudentPasswordResetForm(PasswordResetForm):
    def get_users(self, email):
        user_model = get_user_model()
        email_field = user_model.get_email_field_name()
        users = user_model._default_manager.filter(**{f"{email_field}__iexact": email, "is_active": True})
        for user in users:
            if user.has_usable_password() and StudentProfile.objects.filter(user=user, active=True).exists():
                yield user


class EvidenceForm(forms.ModelForm):
    class Meta:
        model = Evidence
        fields = ["evidence_type", "external_url", "upload", "description"]
        widgets = {"upload": forms.ClearableFileInput(attrs={"accept": ".jpg,.jpeg,.png,.webp,.mp4,.mov,.pdf,.zip,.pt,.onnx,.tif,.tiff,.obj,.stl,.glb,.txt"})}

    def clean(self):
        cleaned = super().clean()
        external_url = cleaned.get("external_url")
        upload = cleaned.get("upload")
        if bool(external_url) == bool(upload):
            raise ValidationError("請提供一個外部網址或一個檔案。")
        if external_url and upload:
            raise ValidationError("網址和檔案只能選擇一種。")
        return cleaned


class MultipleFileInput(ClearableFileInput):
    allow_multiple_selected = True


class MultipleImageField(forms.FileField):
    widget = MultipleFileInput

    def clean(self, data, initial=None):
        if not data and initial is None:
            return []
        files = data if isinstance(data, (list, tuple)) else [data]
        # Browsers may submit an empty file control alongside another media
        # field. Ignore only zero-byte placeholders; real images still use
        # the existing image validation path unchanged.
        files = [upload for upload in files if upload and getattr(upload, "size", 0) > 0]
        return [super(MultipleImageField, self).clean(upload, initial) for upload in files]


GROWTH_DOCUMENT_EXTENSIONS = {
    ".pdf",
    ".ppt",
    ".pptx",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".csv",
    ".zip",
    ".txt",
    ".odt",
    ".odp",
    ".ods",
}
GROWTH_DOCUMENT_MAX_BYTES = 100 * 1024 * 1024


class GrowthDocumentField(MultipleImageField):
    def clean(self, data, initial=None):
        files = super().clean(data, initial)
        for upload in files:
            extension = Path(str(upload.name)).suffix.lower()
            if extension not in GROWTH_DOCUMENT_EXTENSIONS:
                raise ValidationError("檔案格式無效，請上傳 PDF、PPT、PPTX、Word 或 Excel 檔案。")
            if upload.size > GROWTH_DOCUMENT_MAX_BYTES:
                raise ValidationError("檔案過大，單一成果檔案請控制在100 MB以內。")
        return files


class GrowthRecordForm(forms.Form):
    student_note = forms.CharField(
        label="學習備註",
        required=False,
        widget=forms.Textarea(attrs={"rows": 3, "maxlength": 4000}),
    )
    learning_summary = forms.CharField(
        label="本期學習總結",
        required=False,
        widget=forms.Textarea(attrs={"rows": 6, "maxlength": 10000}),
    )
    images = MultipleImageField(
        label="新增照片",
        required=False,
        widget=MultipleFileInput(
            attrs={
                "accept": "image/*",
                "data-growth-images": "",
                "class": "growth-file-input",
            }
        ),
    )
    video = forms.FileField(
        label="新增影片",
        required=False,
        widget=forms.ClearableFileInput(
            attrs={
                "accept": "video/*",
                "data-growth-video": "",
                "class": "growth-file-input",
            }
        ),
    )
    documents = GrowthDocumentField(
        label="成果檔案",
        required=False,
        widget=MultipleFileInput(
            attrs={
                "accept": "application/pdf,application/msword,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.csv,.zip,.txt,.odt,.odp,.ods",
                "data-growth-documents": "",
                "class": "growth-file-input",
            }
        ),
    )


class StudentTaskProgressForm(forms.ModelForm):
    class Meta:
        model = StudentTaskProgress
        fields = ["status", "student_note"]
        widgets = {"student_note": forms.Textarea(attrs={"rows": 3})}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance.status == StudentTaskProgress.Status.SUBMITTED:
            self.fields["status"].choices = [(StudentTaskProgress.Status.SUBMITTED, "已提交")]
        else:
            self.fields["status"].choices = [
                (StudentTaskProgress.Status.IN_PROGRESS, "進行中"),
                (StudentTaskProgress.Status.SUBMITTED, "已提交"),
            ]

    def clean_status(self):
        status = self.cleaned_data["status"]
        if status == StudentTaskProgress.Status.SUBMITTED:
            if self.instance.task_content.evidence_required and not self.instance.evidence.exists():
                raise ValidationError("此任務需要先新增至少一項證據再提交。")
        return status


class PhaseProgressForm(forms.ModelForm):
    class Meta:
        model = PhaseProgress
        fields = ["status", "note"]
        widgets = {"note": forms.TextInput(attrs={"maxlength": 300})}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["status"].choices = [
            (PhaseProgress.Status.NOT_STARTED, "未開始"),
            (PhaseProgress.Status.IN_PROGRESS, "進行中"),
            (PhaseProgress.Status.COMPLETED, "已完成"),
        ]


class TeacherReviewForm(forms.Form):
    result = forms.ChoiceField(choices=TeacherReviewEvent.Result.choices, label="複核結果")
    note = forms.CharField(label="教師備註", required=False, widget=forms.Textarea(attrs={"rows": 2}))
    score = forms.DecimalField(label="教師評分（選填）", required=False, min_value=0, max_value=100, decimal_places=2)
    evidence = forms.ModelChoiceField(queryset=Evidence.objects.none(), required=False, label="對應證據")

    def __init__(self, *args, progress=None, **kwargs):
        super().__init__(*args, **kwargs)
        if progress is not None:
            self.fields["evidence"].queryset = Evidence.objects.filter(progress=progress)

    def clean(self):
        cleaned = super().clean()
        if cleaned.get("result") == TeacherReviewEvent.Result.SKIPPED and not cleaned.get("note", "").strip():
            self.add_error("note", "記錄跳過時請填寫原因，例如請假。")
        return cleaned


class GrowthRecordReviewForm(forms.Form):
    review_status = forms.ChoiceField(choices=GrowthRecordReview.Status.choices, label="成長記錄複核")
    score = forms.DecimalField(
        label="教師評分",
        required=False,
        min_value=0,
        max_value=100,
        decimal_places=2,
    )
    teacher_note = forms.CharField(
        label="教師評語",
        required=False,
        widget=forms.Textarea(attrs={"rows": 2}),
    )
