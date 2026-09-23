import logging
import uuid
from pathlib import Path
from django import forms
from django.forms.widgets import ClearableFileInput
from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.forms import AuthenticationForm, PasswordResetForm
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.validators import RegexValidator
from django.db import transaction
from django.utils import timezone

from .models import (
    ClassCode,
    Enrollment,
    Evidence,
    GrowthRecordReview,
    PhaseProgress,
    StudentProfile,
    StudentSurvey,
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


SURVEY_LIKERT_CHOICES = [(value, str(value)) for value in range(1, 6)]
SURVEY_HELPFUL_TOPIC_CHOICES = [
    ("safety_regulations", "無人機安全與法規"),
    ("simulation_flight", "模擬飛行"),
    ("real_flight", "真機飛行"),
    ("f450_assembly", "F450／多旋翼組裝"),
    ("flight_controller_sensors", "飛控與感測器"),
    ("mission_planner", "Mission Planner 航線規劃"),
    ("ai_detection", "AI 目標檢測"),
    ("yolo_training", "YOLO 圖片標註與模型訓練"),
    ("rag_tutor", "RAG AI 助教"),
    ("modeling_3d", "3D 建模"),
    ("printing_3d", "3D 列印"),
    ("other", "其他"),
]
SURVEY_FUTURE_INTEREST_CHOICES = [
    ("aerial_photo", "航拍／攝影"),
    ("drone_license", "無人機考照"),
    ("inspection", "巡檢應用"),
    ("surveying", "測繪"),
    ("modeling_3d", "3D 建模"),
    ("printing_3d", "3D 列印"),
    ("route_planning", "航線規劃"),
    ("autonomous_mission", "自動任務"),
    ("ai_detection", "AI 目標檢測"),
    ("ai_training", "AI 模型訓練"),
    ("drone_assembly", "無人機組裝"),
    ("drone_repair", "無人機維修"),
    ("fpv", "FPV 穿越機"),
    ("rover", "無人車 Rover"),
    ("air_ground_coordination", "陸空協同"),
    ("ros2", "ROS 2"),
    ("uas_software", "無人系統軟體開發"),
    ("uas_career", "無人載具相關就業"),
    ("undecided", "目前還不確定"),
]
SURVEY_LICENSE_CHOICES = [
    ("basic", "目前先以基本操作能力為主"),
    ("g1", "想準備 G1"),
    ("g2", "想準備 G2"),
    ("g3", "未來想挑戰 G3"),
    ("already_certified", "已經有相關操作證"),
    ("none", "暫時沒有考照規劃"),
]
SURVEY_FORMAT_CHOICES = [
    ("weekday_day", "平日白天"),
    ("weekday_evening", "平日晚間"),
    ("weekend", "週末班"),
    ("intensive_practical", "密集實作班"),
    ("project_practical", "專題實作班"),
    ("hybrid", "線上＋實體混合"),
    ("small_class", "小班制"),
    ("individual_coaching", "個人專題指導"),
    ("enterprise_career", "企業／就業導向班"),
]
SURVEY_PRIORITY_CHOICES = [
    ("content", "課程內容"),
    ("equipment", "實作設備"),
    ("license", "證照"),
    ("employment", "就業連結"),
    ("project", "專題作品"),
    ("instructor", "師資"),
    ("price", "價格"),
    ("schedule", "時間安排"),
]
SURVEY_DURATION_CHOICES = [
    ("1_2_days", "1～2 天體驗課"),
    ("4_6_weeks", "4～6 週進階班"),
    ("8_12_weeks", "8～12 週專題班"),
    ("320_hours", "320 小時職前／專業人才訓練"),
    ("decide_by_content", "視課程內容決定"),
]


class StudentSurveyForm(forms.ModelForm):
    a01 = forms.TypedChoiceField(choices=SURVEY_LIKERT_CHOICES, coerce=int, label="A01", widget=forms.RadioSelect)
    a02 = forms.TypedChoiceField(choices=SURVEY_LIKERT_CHOICES, coerce=int, label="A02", widget=forms.RadioSelect)
    a03 = forms.TypedChoiceField(choices=SURVEY_LIKERT_CHOICES, coerce=int, label="A03", widget=forms.RadioSelect)
    a04 = forms.TypedChoiceField(choices=SURVEY_LIKERT_CHOICES, coerce=int, label="A04", widget=forms.RadioSelect)
    a05 = forms.TypedChoiceField(choices=SURVEY_LIKERT_CHOICES, coerce=int, label="A05", widget=forms.RadioSelect)
    a06 = forms.TypedChoiceField(choices=SURVEY_LIKERT_CHOICES, coerce=int, label="A06", widget=forms.RadioSelect)
    a07 = forms.TypedChoiceField(choices=SURVEY_LIKERT_CHOICES, coerce=int, label="A07", widget=forms.RadioSelect)
    helpful_topics = forms.MultipleChoiceField(choices=SURVEY_HELPFUL_TOPIC_CHOICES, required=False, widget=forms.CheckboxSelectMultiple)
    future_interests = forms.MultipleChoiceField(choices=SURVEY_FUTURE_INTEREST_CHOICES, required=False, widget=forms.CheckboxSelectMultiple)
    license_interest = forms.MultipleChoiceField(choices=SURVEY_LICENSE_CHOICES, required=False, widget=forms.CheckboxSelectMultiple)
    course_format_preferences = forms.MultipleChoiceField(choices=SURVEY_FORMAT_CHOICES, required=False, widget=forms.CheckboxSelectMultiple)
    course_priority_factors = forms.MultipleChoiceField(choices=SURVEY_PRIORITY_CHOICES, required=False, widget=forms.CheckboxSelectMultiple)
    path_20_interest = forms.ChoiceField(choices=[("", "---------"), *StudentSurvey.PathInterest.choices], required=False, widget=forms.RadioSelect)
    path_25_interest = forms.ChoiceField(choices=[("", "---------"), *StudentSurvey.PathInterest.choices], required=False, widget=forms.RadioSelect)
    path_30_interest = forms.ChoiceField(choices=[("", "---------"), *StudentSurvey.PathInterest.choices], required=False, widget=forms.RadioSelect)
    course_duration_preference = forms.ChoiceField(choices=[("", "---------"), *SURVEY_DURATION_CHOICES], required=False, widget=forms.RadioSelect)
    advanced_course_intent = forms.ChoiceField(
        choices=[("", "---------"), *StudentSurvey.AdvancedCourseIntent.choices],
        required=False,
        widget=forms.RadioSelect,
    )
    contact_opt_in = forms.BooleanField(required=False, initial=False)
    contact_email = forms.EmailField(required=False)
    helpful_other = forms.CharField(required=False, max_length=100)
    next_step_text = forms.CharField(required=False, max_length=300, widget=forms.Textarea(attrs={"rows": 5}))
    feedback_text = forms.CharField(required=False, max_length=500, widget=forms.Textarea(attrs={"rows": 6}))

    class Meta:
        model = StudentSurvey
        exclude = ["student", "enrollment", "growth_record", "submitted_at", "updated_at", "survey_version", "v2_responses"]

    def clean_future_interests(self):
        values = self.cleaned_data.get("future_interests", [])
        if len(values) > 3:
            raise ValidationError("下一階段學習興趣最多選 3 項。")
        return values


SURVEY_V2_HELPFUL_CHOICES = [
    ("flight_license", "飛行操作與證照"),
    ("assembly_repair", "無人機組裝、調試與維修"),
    ("mission_planning", "航線規劃與自動任務"),
    ("mapping_printing", "測繪建模與 3D 列印"),
    ("ai_uas", "AI 與智能無人系統應用"),
    ("industry_tasks", "無人機行業任務應用"),
    ("project_showcase", "專題實作與成果展示"),
    ("other", "其他"),
]
SURVEY_V2_IMPROVEMENT_CHOICES = [
    ("pace", "課程節奏"),
    ("theory", "理論講解"),
    ("practical_time", "實作時間"),
    ("flight_time", "飛行練習時間"),
    ("equipment", "設備數量"),
    ("difficulty", "課程難度"),
    ("grouping", "分組方式"),
    ("materials", "教材與操作說明"),
    ("other", "其他"),
]
SURVEY_V2_ABILITY_CHOICES = [
    ("flight_license", "飛行與專業證照"),
    ("assembly_repair", "無人機組裝、調試與維修"),
    ("mapping_printing", "測繪建模與 3D 列印產業應用"),
    ("industry_tasks", "無人機行業任務應用"),
    ("physical_ai", "Physical AI（實體人工智慧）與智能無人系統"),
]
SURVEY_V2_PATH_CHOICES = [
    ("industry_pilot", "行業無人機飛手"),
    ("technician", "無人機裝調檢修技師"),
    ("seed_instructor", "無人機種子教師／教官"),
    ("software_engineer", "無人機軟硬整合／軟體開發工程師"),
    ("ai_industry", "AI／測繪／行業應用"),
    ("engineering", "無人機軟硬整合／軟體開發工程師"),
    ("foundation_first", "目前先完成基礎學習"),
    ("undecided", "目前還不確定"),
]
SURVEY_V2_INTENT_CHOICES = [
    ("deep_learning", "我希望繼續深入學習"),
    ("learn_more", "我有興趣，想先了解進階課程內容"),
    ("practice_first", "我想先把目前學到的內容練熟"),
    ("experience", "我目前主要是興趣體驗"),
    ("none", "暫時沒有繼續學習計畫"),
]
SURVEY_V2_COURSE_CHOICES = [
    ("industry_pilot", "行業無人機飛手進階課程"),
    ("fpv_professional", "FPV 專業飛手／工程應用課程"),
    ("technician", "無人機裝調檢修技師課程"),
    ("seed_instructor", "無人機種子教師／教官培訓"),
    ("software_engineer", "無人機軟硬整合／軟體開發工程課程"),
]
SURVEY_V2_Q1_CHOICES = [
    ("very_helpful", "非常有幫助"),
    ("helpful", "有幫助"),
    ("ordinary", "普通"),
    ("less_helpful", "幫助較少"),
    ("uncertain", "目前還不確定"),
]
SURVEY_V2_Q2_CHOICES = [
    ("more_practice", "希望增加更多實作"),
    ("balanced", "目前比例剛好"),
    ("more_theory", "希望增加更多原理與講解"),
    ("uncertain", "目前還不確定"),
]


class StudentSurveyV2Form(forms.Form):
    q1_helpfulness = forms.ChoiceField(choices=SURVEY_V2_Q1_CHOICES, label="整體而言，這一期課程對你有沒有實際幫助？", widget=forms.RadioSelect)
    q2_practice_ratio = forms.ChoiceField(choices=SURVEY_V2_Q2_CHOICES, label="你覺得目前課程的實作比例如何？", widget=forms.RadioSelect)
    q3_topics = forms.MultipleChoiceField(choices=SURVEY_V2_HELPFUL_CHOICES, required=False, widget=forms.CheckboxSelectMultiple)
    q3_other = forms.CharField(required=False, max_length=100)
    q4_improvements = forms.MultipleChoiceField(choices=SURVEY_V2_IMPROVEMENT_CHOICES, required=False, widget=forms.CheckboxSelectMultiple)
    q4_other = forms.CharField(required=False, max_length=100)
    q5_feedback = forms.CharField(required=False, max_length=500, widget=forms.Textarea(attrs={"rows": 5}))
    q6_interests = forms.MultipleChoiceField(choices=SURVEY_V2_ABILITY_CHOICES, required=False, widget=forms.CheckboxSelectMultiple)
    q7_paths = forms.MultipleChoiceField(choices=SURVEY_V2_PATH_CHOICES, required=False, widget=forms.CheckboxSelectMultiple)
    q8_intent = forms.ChoiceField(choices=SURVEY_V2_INTENT_CHOICES, label="看完上面的發展方向後，你目前對進階學習的想法是？", widget=forms.RadioSelect)
    q9_courses = forms.MultipleChoiceField(choices=SURVEY_V2_COURSE_CHOICES, required=False, widget=forms.CheckboxSelectMultiple)
    contact_email = forms.EmailField(required=False)
    contact_phone = forms.CharField(
        required=False,
        max_length=30,
        validators=[RegexValidator(r"^[0-9+()\-\s]*$", "請輸入有效的電話號碼格式。")],
    )

    def __init__(self, *args, instance=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.instance = instance
        existing = (instance.v2_responses or {}) if instance is not None else {}
        if not args or not args[0]:
            for name in self.fields:
                if name in existing:
                    self.initial[name] = existing[name]
            self.initial["contact_email"] = instance.contact_email if instance is not None else ""

    def _clean_max(self, name, limit):
        values = self.cleaned_data.get(name, [])
        if len(values) > limit:
            raise ValidationError(f"此題最多選 {limit} 項。")
        return values

    def clean_q3_topics(self):
        return self._clean_max("q3_topics", 3)

    def clean_q6_interests(self):
        return self._clean_max("q6_interests", 3)

    def clean_q7_paths(self):
        values = self._clean_max("q7_paths", 2)
        if "undecided" in values and len(values) > 1:
            raise ValidationError("選擇「目前還不確定」時，請不要再選其他方向。")
        return values

    def clean_q9_courses(self):
        return self._clean_max("q9_courses", 2)

    def clean(self):
        cleaned = super().clean()
        if cleaned.get("q8_intent") in {"deep_learning", "learn_more"}:
            return cleaned
        cleaned["q9_courses"] = []
        cleaned["contact_email"] = cleaned.get("contact_email", "")
        cleaned["contact_phone"] = cleaned.get("contact_phone", "").strip()
        return cleaned

    def apply_to_survey(self, survey):
        data = {name: self.cleaned_data.get(name, []) for name in (
            "q1_helpfulness", "q2_practice_ratio", "q3_topics", "q3_other",
            "q4_improvements", "q4_other", "q5_feedback", "q6_interests",
            "q7_paths", "q8_intent", "q9_courses", "contact_phone",
        )}
        survey.survey_version = "v2"
        survey.v2_responses = data
        survey.a01 = {"very_helpful": 5, "helpful": 4, "ordinary": 3, "less_helpful": 2, "uncertain": 1}[data["q1_helpfulness"]]
        survey.a02 = {"more_practice": 1, "balanced": 2, "more_theory": 3, "uncertain": 4}[data["q2_practice_ratio"]]
        survey.a03 = survey.a04 = survey.a05 = survey.a06 = survey.a07 = 0
        survey.helpful_topics = data["q3_topics"]
        survey.helpful_other = data["q3_other"]
        survey.future_interests = data["q6_interests"]
        survey.advanced_course_intent = {
            "deep_learning": "HIGH", "learn_more": "INTERESTED", "practice_first": "TIME_UNCERTAIN",
            "experience": "INFO_ONLY", "none": "NONE",
        }[data["q8_intent"]]
        survey.contact_email = self.cleaned_data.get("contact_email", "").strip()
        survey.contact_opt_in = bool(survey.contact_email)
        survey.feedback_text = data["q5_feedback"]
        return survey


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
