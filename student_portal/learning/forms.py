import re
from django import forms
from django.contrib.auth import get_user_model
from django.contrib.auth.forms import AuthenticationForm, PasswordResetForm
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import transaction

from .models import Evidence, PhaseProgress, StudentProfile, StudentTaskProgress, TeacherReviewEvent
from .services import issue_activation_code


STUDENT_ID_PATTERN = re.compile(r"^\d{4}-\d{2}-S\d{2,}$")


class StudentRegistrationForm(forms.Form):
    student_id = forms.CharField(label="學員 ID", max_length=32)
    email = forms.EmailField(label="電子郵件")
    password1 = forms.CharField(label="密碼", widget=forms.PasswordInput)
    password2 = forms.CharField(label="確認密碼", widget=forms.PasswordInput)

    def __init__(self, *args, **kwargs):
        self.student_profile = None
        super().__init__(*args, **kwargs)

    def clean_student_id(self):
        student_id = self.cleaned_data["student_id"].strip().upper()
        if not STUDENT_ID_PATTERN.fullmatch(student_id):
            raise ValidationError("學員 ID 格式須為 YYYY-期別-S編號，例如 2026-01-S01。")
        profile = StudentProfile.objects.filter(student_id=student_id, active=True).first()
        if profile is None:
            raise ValidationError("找不到此學員編號，請確認後聯絡教師。")
        if profile.user_id:
            raise ValidationError("此學員 ID 已註冊，請直接登入或聯絡教師。")
        self.student_profile = profile
        return student_id

    def clean_email(self):
        email = self.cleaned_data["email"].strip().lower()
        if self.student_profile and self.student_profile.expected_email:
            if self.student_profile.expected_email.strip().lower() != email:
                raise ValidationError("此電子郵件與教師名冊資料不符，請聯絡教師。")
        if StudentProfile.objects.filter(registered_email__iexact=email).exists():
            raise ValidationError("此電子郵件已用於其他學員，請聯絡教師。")
        user_model = get_user_model()
        if user_model.objects.filter(email__iexact=email).exists():
            raise ValidationError("此電子郵件已用於其他帳號，請聯絡教師。")
        return email

    def clean(self):
        cleaned = super().clean()
        password1 = cleaned.get("password1")
        password2 = cleaned.get("password2")
        if password1 and password2 and password1 != password2:
            self.add_error("password2", "兩次輸入的密碼不一致。")
        if password1 and self.student_profile:
            try:
                validate_password(password1)
            except ValidationError as exc:
                self.add_error("password1", exc)
        return cleaned

    @transaction.atomic
    def create_account(self):
        profile = StudentProfile.objects.select_for_update().get(student_id=self.cleaned_data["student_id"])
        if profile.user_id:
            raise ValidationError("此學員 ID 已註冊，請直接登入或聯絡教師。")
        user_model = get_user_model()
        user = user_model.objects.create_user(
            username=profile.student_id,
            email=self.cleaned_data["email"],
            password=self.cleaned_data["password1"],
            is_active=False,
        )
        profile.user = user
        profile.registered_email = self.cleaned_data["email"]
        profile.save(update_fields=["user", "registered_email"])
        issue_activation_code(user)
        return user


class StudentLoginForm(AuthenticationForm):
    username = forms.CharField(label="學員 ID", max_length=32)

    def confirm_login_allowed(self, user):
        super().confirm_login_allowed(user)
        if user.is_staff:
            raise ValidationError("教師帳號請使用教師登入。")
        if not StudentProfile.objects.filter(user=user, active=True).exists():
            raise ValidationError("此帳號目前沒有有效的學員名冊。")


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
