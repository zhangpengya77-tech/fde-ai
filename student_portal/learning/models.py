import sys
import uuid
import secrets

from django.conf import settings
from django.core.validators import FileExtensionValidator, MaxValueValidator, MinValueValidator, RegexValidator
from django.db import models
from django.utils import timezone


PUBLIC_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def generate_public_user_id():
    year = timezone.now().year % 100
    suffix = "".join(secrets.choice(PUBLIC_ID_ALPHABET) for _ in range(6))
    return f"FDE-{year:02d}-{suffix}"


def evidence_upload_path(instance, filename):
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    return f"evidence/{instance.evidence_id}/{uuid.uuid4().hex}.{suffix}"


def power_inspection_upload_path(instance, filename):
    """保存電力巡檢隔離資產，不與既有 Evidence／Vision 資產混用。"""
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    return f"power_inspection/{instance.pk or uuid.uuid4().hex}/{uuid.uuid4().hex}.{suffix}"


def vision_inspection_upload_path(instance, filename):
    """學員檢測圖片只存私有媒體；檔名由伺服器產生，不沿用使用者輸入。"""
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    return f"vision_inspection/{instance.pk or uuid.uuid4().hex}/{uuid.uuid4().hex}.{suffix}"


def validate_evidence_size(file_obj):
    if file_obj.size > 100 * 1024 * 1024:
        from django.core.exceptions import ValidationError

        raise ValidationError("單一證據檔案不得超過 100 MB。")


class Cohort(models.Model):
    cohort_id = models.CharField(
        primary_key=True,
        max_length=7,
        validators=[RegexValidator(r"^\d{4}-\d{2}$", "班級編號格式須為 YYYY-期別。")],
    )
    name = models.CharField(max_length=80)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-cohort_id"]

    def __str__(self):
        return self.name


class LearningGroup(models.Model):
    cohort = models.ForeignKey(Cohort, on_delete=models.CASCADE, related_name="groups")
    code = models.CharField(max_length=24)
    name = models.CharField(max_length=80)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["cohort_id", "code"]
        constraints = [models.UniqueConstraint(fields=["cohort", "code"], name="one_group_code_per_cohort")]

    def __str__(self):
        return f"{self.cohort_id} · {self.name}"


class Enrollment(models.Model):
    class TrainingSource(models.TextChoices):
        PRE_EMPLOYMENT = "pre_employment", "職前培訓"
        IN_SERVICE = "in_service", "在職培訓"
        COLLEGE = "college", "大中專院校"
        OTHER = "other", "其他"

    student = models.ForeignKey("StudentProfile", on_delete=models.CASCADE, related_name="enrollments")
    cohort = models.ForeignKey(Cohort, on_delete=models.PROTECT, related_name="enrollments")
    group = models.ForeignKey(
        LearningGroup, null=True, blank=True, on_delete=models.SET_NULL, related_name="enrollments"
    )
    project_direction = models.CharField(max_length=64, null=True, blank=True)
    training_source = models.CharField(
        max_length=20,
        choices=TrainingSource.choices,
        null=True,
        blank=True,
    )
    joined_at = models.DateTimeField(auto_now_add=True)
    active = models.BooleanField(default=True)
    teacher_verified = models.BooleanField(default=False)
    teacher_verified_name = models.CharField(max_length=40, blank=True)

    class Meta:
        ordering = ["-joined_at"]
        constraints = [models.UniqueConstraint(fields=["student", "cohort"], name="one_enrollment_per_cohort")]

    def clean(self):
        from django.core.exceptions import ValidationError

        if self.group_id and self.cohort_id and self.group.cohort_id != self.cohort_id:
            raise ValidationError({"group": "小組必須屬於此課程期別。"})

    def __str__(self):
        return f"{self.student.public_user_id} · {self.cohort_id}"


class ClassCode(models.Model):
    code = models.CharField(max_length=24, unique=True)
    cohort = models.ForeignKey(Cohort, on_delete=models.CASCADE, related_name="class_codes")
    active = models.BooleanField(default=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    max_uses = models.PositiveIntegerField(null=True, blank=True)
    use_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["cohort_id", "code"]

    def save(self, *args, **kwargs):
        self.code = self.code.strip().upper()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.cohort_id} · {self.code}"


class GrowthRecordDefinition(models.Model):
    cohort = models.ForeignKey(Cohort, on_delete=models.CASCADE, related_name="growth_record_definitions")
    group_scope = models.ForeignKey(
        LearningGroup,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="growth_record_definitions",
    )
    slot_id = models.CharField(max_length=3, validators=[RegexValidator(r"^R0[1-8]$")])
    title = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    completion_requirements = models.JSONField(default=list, blank=True)
    evidence_requirement = models.JSONField(default=list, blank=True)
    learning_resource = models.JSONField(default=list, blank=True)
    display_order = models.PositiveSmallIntegerField(default=1)
    enabled = models.BooleanField(default=True)

    class Meta:
        ordering = ["display_order", "slot_id"]
        constraints = [
            models.UniqueConstraint(
                fields=["cohort", "slot_id"],
                condition=models.Q(group_scope__isnull=True),
                name="one_default_growth_definition_per_slot",
            ),
            models.UniqueConstraint(
                fields=["cohort", "slot_id", "group_scope"],
                condition=models.Q(group_scope__isnull=False),
                name="one_group_growth_definition_per_slot",
            ),
        ]

    def clean(self):
        from django.core.exceptions import ValidationError

        if self.group_scope_id and self.cohort_id and self.group_scope.cohort_id != self.cohort_id:
            raise ValidationError({"group_scope": "小組必須屬於此課程期別。"})

    def __str__(self):
        return f"{self.cohort_id} · {self.slot_id} · {self.title}"


class GrowthRecordSubmission(models.Model):
    class Status(models.TextChoices):
        NOT_STARTED = "not_started", "未開始"
        IN_PROGRESS = "in_progress", "進行中"
        SUBMITTED = "submitted", "已提交"
        NEEDS_REVISION = "needs_revision", "需要補充"
        APPROVED = "approved", "合格"
        REJECTED = "rejected", "不合格"

    enrollment = models.ForeignKey(Enrollment, on_delete=models.CASCADE, related_name="growth_submissions")
    definition = models.ForeignKey(
        GrowthRecordDefinition, on_delete=models.PROTECT, related_name="submissions"
    )
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.NOT_STARTED)
    student_note = models.TextField(blank=True)
    learning_summary = models.TextField(blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    teacher_final_score = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(0), MaxValueValidator(100)],
    )
    selected_evidence = models.ManyToManyField(
        "Evidence", blank=True, related_name="summary_submissions"
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["definition__display_order", "definition__slot_id"]
        constraints = [
            models.UniqueConstraint(fields=["enrollment", "definition"], name="one_growth_submission_per_record"),
            models.CheckConstraint(
                condition=models.Q(teacher_final_score__isnull=True)
                | models.Q(teacher_final_score__gte=0, teacher_final_score__lte=100),
                name="growth_final_score_0_100",
            ),
        ]

    def clean(self):
        from django.core.exceptions import ValidationError

        if self.enrollment_id and self.definition_id and self.enrollment.cohort_id != self.definition.cohort_id:
            raise ValidationError("成長記錄定義必須屬於學員加入的課程期別。")

    def __str__(self):
        return f"{self.enrollment.student.public_user_id} · {self.definition.slot_id}"


class StudentSurvey(models.Model):
    class PathInterest(models.TextChoices):
        VERY_INTERESTED = "very_interested", "非常有興趣"
        INTERESTED = "interested", "有興趣"
        LEARN_MORE = "learn_more", "想先了解"
        NOT_NOW = "not_now", "目前沒有"

    class AdvancedCourseIntent(models.TextChoices):
        HIGH = "HIGH", "很有意願參加"
        INTERESTED = "INTERESTED", "有意願，想先了解課程內容與費用"
        TIME_UNCERTAIN = "TIME_UNCERTAIN", "有興趣，但目前時間還不確定"
        INFO_ONLY = "INFO_ONLY", "目前只想先收到相關資訊"
        NONE = "NONE", "暫時沒有進階學習計畫"

    student = models.ForeignKey(
        "StudentProfile",
        on_delete=models.PROTECT,
        related_name="surveys",
    )
    enrollment = models.ForeignKey(
        Enrollment,
        on_delete=models.PROTECT,
        related_name="student_surveys",
    )
    growth_record = models.OneToOneField(
        GrowthRecordSubmission,
        on_delete=models.PROTECT,
        related_name="student_survey",
    )
    a01 = models.PositiveSmallIntegerField()
    a02 = models.PositiveSmallIntegerField()
    a03 = models.PositiveSmallIntegerField()
    a04 = models.PositiveSmallIntegerField()
    a05 = models.PositiveSmallIntegerField()
    a06 = models.PositiveSmallIntegerField()
    a07 = models.PositiveSmallIntegerField()
    helpful_topics = models.JSONField(default=list, blank=True)
    helpful_other = models.CharField(max_length=100, blank=True)
    future_interests = models.JSONField(default=list, blank=True)
    path_20_interest = models.CharField(max_length=20, choices=PathInterest.choices, blank=True)
    path_25_interest = models.CharField(max_length=20, choices=PathInterest.choices, blank=True)
    path_30_interest = models.CharField(max_length=20, choices=PathInterest.choices, blank=True)
    license_interest = models.JSONField(default=list, blank=True)
    course_format_preferences = models.JSONField(default=list, blank=True)
    course_duration_preference = models.CharField(max_length=32, blank=True)
    course_priority_factors = models.JSONField(default=list, blank=True)
    advanced_course_intent = models.CharField(
        max_length=20,
        choices=AdvancedCourseIntent.choices,
        blank=True,
    )
    contact_opt_in = models.BooleanField(default=False)
    contact_email = models.EmailField(blank=True)
    next_step_text = models.CharField(max_length=300, blank=True)
    feedback_text = models.CharField(max_length=500, blank=True)
    survey_version = models.CharField(max_length=8, default="v1")
    v2_responses = models.JSONField(default=dict, blank=True)
    submitted_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-submitted_at"]
        constraints = [
            models.UniqueConstraint(fields=["enrollment"], name="one_student_survey_per_enrollment"),
        ]

    @property
    def public_user_id(self):
        return self.student.public_user_id

    @property
    def cohort(self):
        return self.enrollment.cohort

    def clean(self):
        from django.core.exceptions import ValidationError

        errors = {}
        if self.student_id and self.enrollment_id and self.enrollment.student_id != self.student_id:
            errors["student"] = "學員必須與期別參與記錄一致。"
        if self.growth_record_id:
            if self.growth_record.enrollment_id != self.enrollment_id:
                errors["growth_record"] = "R08 成長記錄必須屬於此期別參與記錄。"
            if self.growth_record.definition.slot_id != "R08":
                errors["growth_record"] = "調查只能關聯 R08 成長記錄。"
        if errors:
            raise ValidationError(errors)

    def __str__(self):
        return f"{self.public_user_id} · {self.enrollment.cohort_id} · R08 調查"


class TeacherCohortAccess(models.Model):
    teacher = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="cohort_accesses")
    cohort = models.ForeignKey(Cohort, on_delete=models.CASCADE, related_name="teacher_accesses")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["cohort_id", "teacher__username"]
        constraints = [models.UniqueConstraint(fields=["teacher", "cohort"], name="one_teacher_access_per_cohort")]

    def clean(self):
        from django.core.exceptions import ValidationError

        if self.teacher_id and not self.teacher.is_staff:
            raise ValidationError({"teacher": "只有已設定教師權限的帳號才能指派班級存取權。"})

    def __str__(self):
        return f"{self.teacher} · {self.cohort}"


class StudentProfile(models.Model):
    class AccountType(models.TextChoices):
        FREE = "free", "免費"
        STUDENT = "student", "學員"
        PRO = "pro", "Pro"

    # Retained as an opaque internal profile key for compatibility with the initial schema.
    student_id = models.CharField(primary_key=True, max_length=32, editable=False)
    public_user_id = models.CharField(max_length=13, unique=True, editable=False)
    nickname = models.CharField(max_length=40)
    email = models.EmailField(unique=True, null=True, blank=True)
    account_type = models.CharField(max_length=12, choices=AccountType.choices, default=AccountType.FREE)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="student_profile",
    )
    github_repo_url = models.URLField(blank=True)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["public_user_id"]

    def save(self, *args, **kwargs):
        if self._state.adding and not self.student_id:
            self.student_id = uuid.uuid4().hex
        if self._state.adding and not self.public_user_id:
            from django.db import IntegrityError, transaction

            for _ in range(10):
                self.public_user_id = generate_public_user_id()
                try:
                    with transaction.atomic():
                        return super().save(*args, **kwargs)
                except IntegrityError:
                    if StudentProfile.objects.filter(public_user_id=self.public_user_id).exists():
                        continue
                    raise
            raise RuntimeError("無法產生唯一的 FDE ID，請重試。")
        if not self._state.adding:
            original = StudentProfile.objects.filter(pk=self.pk).values_list("public_user_id", flat=True).first()
            if original and original != self.public_user_id:
                from django.core.exceptions import ValidationError

                raise ValidationError({"public_user_id": "FDE ID 建立後不可修改。"})
        super().save(*args, **kwargs)

    @property
    def display_name(self):
        return self.nickname

    def __str__(self):
        return f"{self.public_user_id} · {self.nickname}"


class TaskDefinition(models.Model):
    class Stage(models.TextChoices):
        LEARN = "learn", "學"
        PRACTICE = "practice", "練"
        BUILD = "build", "做"
        ASSESS = "assess", "測"
        CERTIFY = "certify", "證"

    task_id = models.CharField(primary_key=True, max_length=3)
    version = models.PositiveSmallIntegerField(default=1)
    sort_order = models.PositiveSmallIntegerField()
    stage = models.CharField(max_length=12, choices=Stage.choices)
    title = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    requirements = models.JSONField(default=list, blank=True)
    evidence_required = models.JSONField(default=list, blank=True)
    active = models.BooleanField(default=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="updated_task_definitions",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "task_id"]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            previous = TaskDefinition.objects.get(pk=self.pk)
            content_fields = (
                "sort_order", "stage", "title", "description", "requirements", "evidence_required", "active"
            )
            update_fields = kwargs.get("update_fields")
            fields_to_check = content_fields if update_fields is None else set(content_fields).intersection(update_fields)
            changed = any(getattr(previous, field) != getattr(self, field) for field in fields_to_check)
            if changed:
                TaskDefinitionRevision.objects.create(
                    task=self,
                    version=previous.version,
                    sort_order=previous.sort_order,
                    stage=previous.stage,
                    title=previous.title,
                    description=previous.description,
                    requirements=previous.requirements,
                    evidence_required=previous.evidence_required,
                    updated_by=self.updated_by,
                )
                self.version = previous.version + 1
                if update_fields is not None:
                    kwargs["update_fields"] = set(update_fields) | {"version", "updated_at"}
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.task_id} · {self.title}"


class TaskDefinitionRevision(models.Model):
    task = models.ForeignKey(TaskDefinition, on_delete=models.CASCADE, related_name="revisions")
    version = models.PositiveSmallIntegerField()
    sort_order = models.PositiveSmallIntegerField()
    stage = models.CharField(max_length=12, choices=TaskDefinition.Stage.choices)
    title = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    requirements = models.JSONField(default=list, blank=True)
    evidence_required = models.JSONField(default=list, blank=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="task_definition_revisions",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["task__task_id", "-version"]
        constraints = [models.UniqueConstraint(fields=["task", "version"], name="one_revision_per_task_version")]

    def __str__(self):
        return f"{self.task_id} v{self.version} · {self.title}"


class StudentTaskProgress(models.Model):
    class Status(models.TextChoices):
        NOT_STARTED = "not_started", "未開始"
        IN_PROGRESS = "in_progress", "進行中"
        SUBMITTED = "submitted", "已提交"
        REVIEWED = "reviewed", "教師已複核"
        INCOMPLETE = "incomplete", "未完成"
        SKIPPED = "skipped", "跳過"

    enrollment = models.ForeignKey("Enrollment", on_delete=models.CASCADE, related_name="task_progress")
    task = models.ForeignKey(TaskDefinition, on_delete=models.PROTECT, related_name="progress_records")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.NOT_STARTED)
    task_version_snapshot = models.PositiveSmallIntegerField(default=1)
    student_note = models.TextField(blank=True)
    teacher_note = models.TextField(blank=True)
    teacher_score = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    skipped_reason = models.CharField(max_length=200, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["task__sort_order", "task__task_id"]
        constraints = [models.UniqueConstraint(fields=["enrollment", "task"], name="one_progress_per_enrollment_task")]

    def save(self, *args, **kwargs):
        if self._state.adding and self.task_id:
            self.task_version_snapshot = self.task.version
        super().save(*args, **kwargs)

    @property
    def task_content(self):
        if self.task_version_snapshot >= self.task.version:
            return self.task
        return self.task.revisions.filter(version=self.task_version_snapshot).first() or self.task

    def __str__(self):
        return f"{self.enrollment.student.public_user_id} / {self.task_id}: {self.get_status_display()}"


class PhaseProgress(models.Model):
    class Status(models.TextChoices):
        NOT_STARTED = "not_started", "未開始"
        IN_PROGRESS = "in_progress", "進行中"
        COMPLETED = "completed", "已完成"
        SKIPPED = "skipped", "跳過"

    enrollment = models.ForeignKey(Enrollment, on_delete=models.CASCADE, related_name="phase_progress")
    phase = models.CharField(max_length=12, choices=TaskDefinition.Stage.choices)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.NOT_STARTED)
    note = models.TextField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["phase"]
        constraints = [models.UniqueConstraint(fields=["enrollment", "phase"], name="one_phase_per_enrollment")]


class Evidence(models.Model):
    class Type(models.TextChoices):
        IMAGE = "image", "圖片"
        VIDEO = "video", "影片"
        FILE = "file", "檔案"
        GITHUB = "github", "GitHub"
        MODEL = "model", "模型權重"
        SURVEY = "survey", "測繪成果"
        MODEL_3D = "3d", "3D 作品"
        OTHER = "other", "其他"

    evidence_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    progress = models.ForeignKey(
        StudentTaskProgress, null=True, blank=True, on_delete=models.CASCADE, related_name="evidence"
    )
    growth_submission = models.ForeignKey(
        GrowthRecordSubmission,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="evidence",
    )
    evidence_type = models.CharField(max_length=12, choices=Type.choices)
    external_url = models.URLField(blank=True)
    upload = models.FileField(
        upload_to=evidence_upload_path,
        blank=True,
        validators=[
            FileExtensionValidator(
                allowed_extensions=["jpg", "jpeg", "png", "webp", "mp4", "mov", "pdf", "ppt", "pptx", "doc", "docx", "xls", "xlsx", "csv", "zip", "pt", "onnx", "tif", "tiff", "obj", "stl", "glb", "txt", "odt", "odp", "ods"],
            ),
            validate_evidence_size,
        ],
    )
    description = models.CharField(max_length=500, blank=True)
    original_metadata = models.JSONField(default=dict, blank=True)
    processed_metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(progress__isnull=False, growth_submission__isnull=True)
                    | models.Q(progress__isnull=True, growth_submission__isnull=False)
                ),
                name="evidence_has_exactly_one_parent",
            )
        ]

    def clean(self):
        from django.core.exceptions import ValidationError

        if self.progress_id and self.growth_submission_id:
            raise ValidationError("證據必須且只能屬於一項任務或一筆成長記錄。")
        if not self._state.adding and not self.progress_id and not self.growth_submission_id:
            raise ValidationError("證據必須且只能屬於一項任務或一筆成長記錄。")
        if bool(self.external_url) == bool(self.upload):
            raise ValidationError("證據必須且只能提供一個檔案或一個外部連結。")

    @property
    def student(self):
        return self.enrollment.student

    @property
    def enrollment(self):
        if self.growth_submission_id:
            return self.growth_submission.enrollment
        return self.progress.enrollment

    def __str__(self):
        if self.growth_submission_id:
            label = self.growth_submission.definition.slot_id
        else:
            label = self.progress.task_id
        return f"{label} · {self.get_evidence_type_display()}"


class GrowthRecordReview(models.Model):
    class Status(models.TextChoices):
        APPROVED = "approved", "合格"
        NEEDS_REVISION = "needs_revision", "需要補充"
        REJECTED = "rejected", "不合格"

    submission = models.ForeignKey(
        GrowthRecordSubmission, on_delete=models.CASCADE, related_name="reviews"
    )
    reviewer = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="growth_record_reviews"
    )
    review_status = models.CharField(max_length=16, choices=Status.choices)
    score = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(0), MaxValueValidator(100)],
    )
    teacher_note = models.TextField(blank=True)
    reviewed_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-reviewed_at", "-pk"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(score__isnull=True) | models.Q(score__gte=0, score__lte=100),
                name="growth_review_score_0_100",
            )
        ]


class TeacherReviewEvent(models.Model):
    class Result(models.TextChoices):
        REVIEWED = "reviewed", "教師已複核"
        INCOMPLETE = "incomplete", "未完成"
        SKIPPED = "skipped", "跳過"

    progress = models.ForeignKey(StudentTaskProgress, on_delete=models.CASCADE, related_name="review_events")
    evidence = models.ForeignKey(Evidence, null=True, blank=True, on_delete=models.SET_NULL, related_name="review_events")
    teacher = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="review_events")
    result = models.CharField(max_length=16, choices=Result.choices)
    note = models.TextField(blank=True)
    score = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]


class CandidatePool(models.Model):
    evidence = models.OneToOneField(Evidence, on_delete=models.CASCADE, related_name="candidate_record")
    promote_to_dataset = models.BooleanField(default=False)
    promote_to_rag = models.BooleanField(default=False)
    approved_by_teacher = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="approved_candidates",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)


class EmailVerificationCode(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="verification_codes")
    code_hash = models.CharField(max_length=128)
    expires_at = models.DateTimeField()
    attempts = models.PositiveSmallIntegerField(default=0)
    consumed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class VisionModelRecord(models.Model):
    """模型倉庫持久化紀錄（PROP_DIRECTION_V1）。

    設計原則（教師 2026-10-08 指令）：
    1. 不複製既有 R07 提交紀錄：本表以 OneToOne 參照 Evidence，為「入庫登錄」而非第二套提交系統。
    2. 四個狀態維度各自獨立欄位：審核狀態 / 驗證狀態 / 訓練用途 / 部署狀態，
       不得合併為單一 status 欄位。
    3. 血緣可追溯：parent_record 自我參照 + lineage_root 指向起源版本。
    4. 班級隔離：cohort 為必填外鍵，查詢一律經由此欄位過濾。
    5. 檔案完整性：artifact_sha256 為必填，供入庫後校驗。
    6. DEMO_TEST_ONLY 不得成為正式訓練基礎：由 is_demo_test_only 旗標標記。

    本表僅為「入庫登錄」，不代表模型已可推論、已驗證或已部署。
    """

    class ReviewStatus(models.TextChoices):
        SUBMITTED = "SUBMITTED", "已提交"
        CANDIDATE = "CANDIDATE", "候選"
        REJECTED = "REJECTED", "不合格"
        RETURNED = "RETURNED", "退回補件"

    class ValidationStatus(models.TextChoices):
        NOT_EVALUATED = "NOT_EVALUATED", "未驗證"
        VALIDATED = "VALIDATED", "已驗證"
        FAILED = "FAILED", "驗證失敗"

    class TrainingUsage(models.TextChoices):
        NOT_FOR_TRAINING = "NOT_FOR_TRAINING", "不可作為訓練基底"
        TRAINING_BASE = "TRAINING_BASE", "可作為訓練基底"

    class DeploymentStatus(models.TextChoices):
        CATALOGUED = "CATALOGUED", "已入庫"
        ACTIVE = "ACTIVE", "已啟用"
        ARCHIVED = "ARCHIVED", "已封存"

    class SnapshotStatus(models.TextChoices):
        """不可變快照的存在狀態；與部署狀態無關，僅描述檔案本身。"""

        PENDING = "PENDING", "尚未建立"
        STORED = "STORED", "已建立"

    class IntegrityStatus(models.TextChoices):
        """檔案完整性檢查結果（教師觸發，不自動變更狀態）。"""

        NOT_CHECKED = "NOT_CHECKED", "尚未檢查"
        INTACT = "INTACT", "完整"
        MISSING = "MISSING", "檔案不存在"
        MODIFIED = "MODIFIED", "內容已變動"

    model_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    evidence = models.OneToOneField(
        Evidence,
        on_delete=models.PROTECT,
        related_name="repository_record",
        help_text="來源 R07 模型證據；本表不複製其提交內容。",
    )
    task_id = models.CharField(max_length=32, help_text="所屬任務；本輪僅支援 PROP_DIRECTION。")
    student = models.ForeignKey(
        "StudentProfile", on_delete=models.PROTECT, related_name="vision_model_records"
    )
    cohort = models.ForeignKey(
        Cohort,
        on_delete=models.PROTECT,
        related_name="vision_model_records",
        help_text="班級隔離依據；查詢一律經由此欄位過濾。",
    )
    model_version = models.CharField(max_length=16, default="V1")
    parent_record = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="child_records",
        help_text="父版本；V1 為空。",
    )
    lineage_root = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="descendant_records",
        help_text="血緣起源版本；V1 指向自己。",
    )
    dataset_version = models.CharField(max_length=64, blank=True)
    class_mapping = models.JSONField(
        default=list, blank=True, help_text="類別索引對應表（學員類別 ID → 平台類別）。"
    )
    artifact_reference = models.CharField(max_length=255, help_text="best.pt 儲存參照。")
    artifact_sha256 = models.CharField(
        max_length=64, help_text="best.pt SHA256；入庫後用於驗證檔案完整性。"
    )
    artifact_size_bytes = models.PositiveBigIntegerField(default=0)
    # --- 不可變快照（2026-10-08 指令「一、模型不可變快照」）---
    # 入庫時在隔離倉庫建立獨立副本，使原始 Evidence 檔案被改動或遺失時，
    # 倉庫仍保有入庫當下的完整內容。原始 best.pt 一律不搬移、不刪除。
    snapshot_path = models.CharField(
        max_length=255, blank=True, help_text="倉庫內獨立副本的相對路徑（Media 根目錄之下）。"
    )
    snapshot_sha256 = models.CharField(
        max_length=64, blank=True, help_text="建立副本後重算的 SHA256，必須等於 artifact_sha256。"
    )
    snapshot_size_bytes = models.PositiveBigIntegerField(
        default=0, help_text="副本位元組數；應等於 artifact_size_bytes。"
    )
    snapshot_status = models.CharField(
        max_length=16,
        choices=SnapshotStatus.choices,
        default=SnapshotStatus.PENDING,
        help_text="副本是否已成功建立；PENDING 代表尚無可用的獨立副本。",
    )
    source_artifact_reference = models.CharField(
        max_length=255,
        blank=True,
        help_text="入庫當下的來源 Evidence 檔案參照，供追溯副本由何處複製而來。",
    )
    data_yaml_reference = models.CharField(max_length=255, blank=True)
    is_demo_test_only = models.BooleanField(
        default=False, help_text="檔名含 DEMO_TEST_ONLY；此類紀錄不得成為正式訓練基礎。"
    )
    review_status = models.CharField(
        max_length=16, choices=ReviewStatus.choices, default=ReviewStatus.SUBMITTED
    )
    validation_status = models.CharField(
        max_length=16, choices=ValidationStatus.choices, default=ValidationStatus.NOT_EVALUATED
    )
    training_usage = models.CharField(
        max_length=20, choices=TrainingUsage.choices, default=TrainingUsage.NOT_FOR_TRAINING
    )
    deployment_status = models.CharField(
        max_length=16, choices=DeploymentStatus.choices, default=DeploymentStatus.CATALOGUED
    )
    teacher_review = models.JSONField(default=dict, blank=True)
    validation_history = models.JSONField(default=list, blank=True)
    golden_test_summary = models.JSONField(default=dict, blank=True)
    publication_scope = models.JSONField(default=list, blank=True, help_text="可取得此模型的班級清單。")
    # --- 完整性檢查結果（2026-10-08 指令「二、模型完整性檢查」）---
    # 僅記錄最近一次教師觸發的檢查結果，不自動變更任何狀態、不自動刪除檔案。
    integrity_status = models.CharField(
        max_length=16,
        choices=IntegrityStatus.choices,
        default="NOT_CHECKED",
        help_text="最近一次完整性檢查結果：INTACT / MISSING / MODIFIED / NOT_CHECKED。",
    )
    integrity_checked_at = models.DateTimeField(null=True, blank=True)
    integrity_detail = models.JSONField(
        default=dict, blank=True, help_text="最近一次檢查的細節；不含任何本機絕對路徑。"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=~models.Q(model_version="V1") | models.Q(parent_record__isnull=True),
                name="vision_record_v1_has_no_parent",
            ),
            models.CheckConstraint(
                condition=models.Q(is_demo_test_only=False)
                | ~models.Q(training_usage="TRAINING_BASE"),
                name="vision_record_demo_never_training_base",
            ),
            models.CheckConstraint(
                condition=~models.Q(deployment_status="ACTIVE")
                | models.Q(validation_status="VALIDATED"),
                name="vision_record_active_requires_validated",
            ),
            models.CheckConstraint(
                condition=~models.Q(deployment_status="ACTIVE")
                | models.Q(is_demo_test_only=False),
                name="vision_record_active_not_demo",
            ),
            # 完整性異常時不得作為訓練基底（檔案遺失／內容已變動）。
            models.CheckConstraint(
                condition=~models.Q(training_usage="TRAINING_BASE")
                | models.Q(integrity_status__in=["NOT_CHECKED", "INTACT"]),
                name="vision_record_broken_never_training_base",
            ),
            # 已建立副本時，快照欄位必須齊備，避免出現「有紀錄卻無副本」的空殼。
            models.CheckConstraint(
                condition=~models.Q(snapshot_status="STORED")
                | (
                    ~models.Q(snapshot_path="")
                    & ~models.Q(snapshot_sha256="")
                    & ~models.Q(source_artifact_reference="")
                ),
                name="vision_record_stored_snapshot_is_complete",
            ),
        ]

    def __str__(self):
        return f"{self.model_version} · {self.artifact_reference}"

    @property
    def is_publishable(self) -> bool:
        """是否可發布為訓練資源。

        DEMO 樣本一律不可；且**檔案完整性異常時亦不可**，
        避免已損壞或已遺失的模型被當作後續訓練基底或發布出去。
        """
        if self.integrity_status in {
            self.IntegrityStatus.MISSING,
            self.IntegrityStatus.MODIFIED,
        }:
            return False
        return not self.is_demo_test_only and self.training_usage == self.TrainingUsage.TRAINING_BASE

    @property
    def has_snapshot(self) -> bool:
        """是否已具備可用的獨立副本。"""
        return (
            self.snapshot_status == self.SnapshotStatus.STORED
            and bool(self.snapshot_path)
            and bool(self.snapshot_sha256)
        )

    def integrity_blocked_reason(self) -> str:
        """檔案完整性異常時的阻擋原因；回傳空字串代表無異常。"""
        if self.integrity_status == self.IntegrityStatus.MISSING:
            return "模型檔案已遺失，不得作為訓練基底或發布。"
        if self.integrity_status == self.IntegrityStatus.MODIFIED:
            return "模型檔案內容已變動，與入庫紀錄不符，不得作為訓練基底或發布。"
        return ""

    def active_blocked_reason(self) -> str:
        """不可啟用 ACTIVE 的原因；回傳空字串代表允許。"""
        if self.is_demo_test_only:
            return "DEMO_TEST_ONLY 樣本不得發布為正式訓練基礎或啟用 ACTIVE。"
        integrity = self.integrity_blocked_reason()
        if integrity:
            return f"{integrity}（不得自動切換為 ACTIVE）"
        if self.validation_status != self.ValidationStatus.VALIDATED:
            return "未通過 Golden Test 驗證，不可啟用 ACTIVE。"
        if self.review_status != self.ReviewStatus.CANDIDATE:
            return "尚未由教師列為候選，不可啟用 ACTIVE。"
        return ""


class GoldenSet(models.Model):
    """Golden Test Set（黃金測試集）版本紀錄（PROP_DIRECTION_V1）。

    設計原則（教師 2026-10-09 第 23 輪指令）：
    1. **重用既有結構**：本表對應既有 `live_backend/app/vision_center.py` 的
       `golden_sets` 註冊表概念（golden_set_id / model_type / total_cases / status），
       不建立第二套平行資料來源；Django 端僅補上教師後台所需的版本與鎖定能力。
    2. 本輪僅支援 `PROP_DIRECTION_V1` 一個任務類型。
    3. 版本一旦 `FROZEN`，不得再新增、修改或刪除其樣本，
       確保同一版本在不同時間對同一顆模型評估的結果可比較。
    4. 樣本只記錄標籤與標註來源，**不儲存、不載入、不推論任何 .pt**。

    本表僅為「測試集登錄」，不代表模型已驗證或已部署。
    """

    class Status(models.TextChoices):
        """測試集生命週期：草稿可調整，鎖定後不可再變更樣本。"""

        DRAFT = "DRAFT", "草稿（可調整）"
        FROZEN = "FROZEN", "已鎖定（不可覆寫樣本）"

    class Label(models.TextChoices):
        """PROP_DIRECTION_V1 的四個固定類別；與後端 PROP_CLASSES 一致。"""

        CW_F = "CW_F", "順時針正面"
        CCW_F = "CCW_F", "逆時針正面"
        CW_B = "CW_B", "順時針背面"
        CCW_B = "CCW_B", "逆時針背面"

    class AnnotationSource(models.TextChoices):
        """標註來源，用於追溯標籤是怎麼來的。"""

        TEACHER_PHOTO = "TEACHER_PHOTO", "教師實拍"
        TEACHER_CONFIRMED_IMPORT = "TEACHER_CONFIRMED_IMPORT", "教師確認後匯入"
        EXISTING_DATASET = "EXISTING_DATASET", "既有資料集沿用"

    class ConfirmationStatus(models.TextChoices):
        """教師確認狀態；未確認的樣本不得計入正式評估。"""

        PENDING = "PENDING", "待教師確認"
        CONFIRMED = "CONFIRMED", "教師已確認"
        REJECTED = "REJECTED", "教師退回"

    # 本輪唯一支援的任務類型；與 vision_repository.SUPPORTED_TASK_IDS 一致。
    SUPPORTED_TASK_IDS = ("PROP_DIRECTION",)

    golden_set_id = models.CharField(
        max_length=64, unique=True, help_text="測試集唯一識別碼，例如 PROP_GOLDEN_v1。"
    )
    task_id = models.CharField(
        max_length=32, default="PROP_DIRECTION", help_text="所屬任務；本輪僅支援 PROP_DIRECTION。"
    )
    model_type = models.CharField(
        max_length=32, default="PROP_DIRECTION", help_text="對應後端 MODEL_TYPES。"
    )
    name = models.CharField(max_length=120, help_text="測試集名稱。")
    description = models.TextField(blank=True, help_text="測試集用途與取樣說明。")
    version = models.CharField(max_length=32, default="v1", help_text="測試集版本，例如 v1 / v2。")
    status = models.CharField(
        max_length=16, choices=Status.choices, default=Status.DRAFT,
        help_text="DRAFT 可調整樣本；FROZEN 後不得再新增、修改或刪除樣本。",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="golden_sets_created",
        help_text="建立此測試集的教師。",
    )
    cohort = models.ForeignKey(
        Cohort,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="golden_sets",
        help_text="隸屬班級；供教師權限過濾，可為空代表跨班共用測試集。",
    )
    frozen_at = models.DateTimeField(null=True, blank=True, help_text="鎖定時間；未鎖定為空。")
    frozen_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="golden_sets_frozen",
        help_text="執行鎖定的教師。",
    )
    # --- 版本化契約（2026-10-09 第 24 輪指令「三」）---
    manifest_sha256 = models.CharField(
        max_length=64,
        blank=True,
        help_text="鎖定當下的 Manifest SHA256；鎖定後不得改變，用以偵測樣本被更動。",
    )
    manifest_contract_version = models.CharField(
        max_length=32,
        blank=True,
        help_text="產生 Manifest 時使用的契約版本，供未來格式演進判讀。",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            # 本輪只允許 PROP_DIRECTION。
            models.CheckConstraint(
                condition=models.Q(task_id="PROP_DIRECTION"),
                name="golden_set_only_prop_direction",
            ),
            # 鎖定時必須留下時間與執行人，避免出現「已鎖定卻無法追溯」。
            models.CheckConstraint(
                condition=~models.Q(status="FROZEN")
                | (models.Q(frozen_at__isnull=False) & models.Q(frozen_by__isnull=False)),
                name="golden_set_frozen_requires_audit",
            ),
        ]

    def __str__(self):
        return f"{self.golden_set_id}（{self.get_status_display()}）"

    @property
    def is_frozen(self) -> bool:
        """是否已鎖定；鎖定後樣本不可再變更。"""
        return self.status == self.Status.FROZEN

    @property
    def sample_count(self) -> int:
        """樣本總數（含未確認）；供教師頁面顯示。"""
        return self.samples.count()

    @property
    def confirmed_sample_count(self) -> int:
        """教師已確認的樣本數；正式評估只採計此數量。"""
        return self.samples.filter(confirmation_status=self.ConfirmationStatus.CONFIRMED).count()

    def label_distribution(self) -> dict:
        """回傳四類標籤的（已確認）樣本數量，缺少的類別補 0。

        評估前必須確認四類皆有樣本，否則 Precision 會因類別缺失而失真。
        """
        counts = {label: 0 for label in self.Label.values}
        rows = (
            self.samples.filter(confirmation_status=self.ConfirmationStatus.CONFIRMED)
            .values("label")
            .order_by()
        )
        for row in rows:
            label = row["label"]
            if label in counts:
                counts[label] += 1
        return counts

    def missing_labels(self) -> list:
        """回傳尚無已確認樣本的類別；四類皆滿時回傳空清單。"""
        distribution = self.label_distribution()
        return [label for label, count in distribution.items() if count == 0]

    def mutation_blocked_reason(self) -> str:
        """是否允許變更樣本；回傳空字串代表允許。"""
        if self.is_frozen:
            return "此測試集版本已鎖定（FROZEN），不得再新增、修改或刪除樣本。"
        return ""

    @property
    def manifest_binding_status(self) -> str:
        """Manifest 綁定狀態：BOUND / UNBOUND / MISMATCH。

        - UNBOUND：尚未鎖定，或鎖定時未寫入 Manifest 雜湊（舊資料）。
        - BOUND：目前內容的 Manifest 雜湊等於鎖定當時記錄的雜湊。
        - MISMATCH：內容與鎖定當時不一致 → 樣本被動過，必須調查。
        """
        recorded = str(self.manifest_sha256 or "").strip()
        if not recorded:
            return "UNBOUND"
        from .golden_set import manifest_sha256

        return "BOUND" if manifest_sha256(self) == recorded else "MISMATCH"


class GoldenSetSample(models.Model):
    """Golden Set 中的單一測試照片與其教師確認標籤。

    設計原則：
    1. 只記錄標籤、標註來源與確認狀態，**不載入、不推論任何模型檔案**。
    2. 隸屬於某一 GoldenSet 版本；該版本鎖定後不得再變更本表資料。
    3. 照片本身存放於 Media，沿用既有 private_media 機制，不另建儲存層。
    """

    Label = GoldenSet.Label
    AnnotationSource = GoldenSet.AnnotationSource
    ConfirmationStatus = GoldenSet.ConfirmationStatus

    sample_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    golden_set = models.ForeignKey(
        GoldenSet, on_delete=models.CASCADE, related_name="samples",
        help_text="所屬測試集版本。",
    )
    image = models.FileField(
        upload_to="golden_set/", help_text="教師確認的測試照片；只做檔案保存，不執行推論。"
    )
    label = models.CharField(
        max_length=8, choices=GoldenSet.Label.choices, help_text="四類標籤之一。"
    )
    annotation_source = models.CharField(
        max_length=32,
        choices=GoldenSet.AnnotationSource.choices,
        default=GoldenSet.AnnotationSource.TEACHER_PHOTO,
        help_text="標籤來源，用於追溯。",
    )
    confirmation_status = models.CharField(
        max_length=16,
        choices=GoldenSet.ConfirmationStatus.choices,
        default=GoldenSet.ConfirmationStatus.PENDING,
        help_text="教師確認狀態；未確認不計入正式評估。",
    )
    confirmed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="golden_samples_confirmed",
        help_text="確認此標籤的教師。",
    )
    confirmed_at = models.DateTimeField(null=True, blank=True)
    note = models.CharField(max_length=255, blank=True, help_text="教師備註。")
    content_sha256 = models.CharField(
        max_length=64, blank=True, help_text="照片內容 SHA256，供去重與追溯；不涉及模型檔案。"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        constraints = [
            # 已確認的樣本必須留下確認人與時間，避免無法追溯。
            models.CheckConstraint(
                condition=~models.Q(confirmation_status="CONFIRMED")
                | (models.Q(confirmed_by__isnull=False) & models.Q(confirmed_at__isnull=False)),
                name="golden_sample_confirmed_requires_audit",
            ),
        ]

    def __str__(self):
        return f"{self.golden_set.golden_set_id} · {self.get_label_display()}"


class PowerInspectionModel(models.Model):
    """POWER_INSPECTION_V1 專用模型資產；正式 Registry 不在本模型中切換。"""

    class Status(models.TextChoices):
        IMPORTED = "IMPORTED", "模型已匯入"
        PENDING_REAL_MODEL_VALIDATION = "PENDING_REAL_MODEL_VALIDATION", "等待真實模型驗證"
        VALIDATED = "VALIDATED", "已驗證"
        TEACHING_TRIAL = "TEACHING_TRIAL", "教學試用"
        ACTIVE = "ACTIVE", "正式啟用"
        REJECTED = "REJECTED", "已退回"

    class InferenceMode(models.TextChoices):
        BLOCKED = "BLOCKED", "尚未載入真實模型"
        MOCK = "MOCK", "模擬流程"
        REAL = "REAL", "真實 YOLO"

    model_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    task_type = models.CharField(max_length=40, default="POWER_INSPECTION_V1", editable=False)
    model_name = models.CharField(max_length=120, default="POWER_INSPECTION_V1")
    version = models.CharField(max_length=64)
    artifact = models.FileField(upload_to=power_inspection_upload_path, blank=True)
    # 保存交付的 data.yaml，僅供隔離 worker 核驗類別契約，不在 Web 程序載入模型。
    data_yaml = models.FileField(upload_to=power_inspection_upload_path, blank=True)
    sha256 = models.CharField(max_length=64, blank=True)
    class_contract = models.JSONField(default=list, blank=True)
    # 規則與模型檔分離，只有完成獨立校準後才可設定為班級預設模型。
    rule_version = models.CharField(max_length=64, default="POWER_INSPECTION_RULE_V1")
    rule_config = models.JSONField(default=dict, blank=True)
    # 訓練與獨立測試交付 metadata；缺項時模型必須停在待真實核驗狀態。
    delivery_manifest = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=36, choices=Status.choices, default=Status.PENDING_REAL_MODEL_VALIDATION)
    inference_mode = models.CharField(max_length=12, choices=InferenceMode.choices, default=InferenceMode.BLOCKED)
    trial_cohorts = models.ManyToManyField(Cohort, blank=True, related_name="power_inspection_trial_models")
    imported_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="power_inspection_models")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [models.UniqueConstraint(fields=["version", "sha256"], name="one_power_inspection_model_version_hash")]


class PowerInspectionCohortDeployment(models.Model):
    """班級預設成品模型；學員上傳時只能由可信 Enrollment 解析此映射。"""

    cohort = models.ForeignKey(Cohort, on_delete=models.PROTECT, related_name="power_inspection_deployments")
    task_type = models.CharField(max_length=40, default="POWER_INSPECTION_V1", editable=False)
    model = models.ForeignKey(PowerInspectionModel, on_delete=models.PROTECT, related_name="cohort_deployments")
    deployed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="power_inspection_deployments")
    enabled = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["cohort_id", "task_type"]
        constraints = [
            models.UniqueConstraint(
                fields=["cohort", "task_type"],
                name="one_power_inspection_deployment_per_cohort_task",
            ),
        ]


class PowerInspectionCohortDeploymentEvent(models.Model):
    """班級預設模型的稽核事件；停用與回退不刪除任何資產或學生紀錄。"""

    class Action(models.TextChoices):
        DEPLOYED = "DEPLOYED", "設為預設"
        UPDATED = "UPDATED", "更新預設"
        DISABLED = "DISABLED", "已停用"
        ROLLED_BACK = "ROLLED_BACK", "已回退"

    deployment = models.ForeignKey(PowerInspectionCohortDeployment, on_delete=models.CASCADE, related_name="events")
    cohort = models.ForeignKey(Cohort, on_delete=models.PROTECT, related_name="power_inspection_deployment_events")
    model = models.ForeignKey(PowerInspectionModel, on_delete=models.PROTECT, related_name="deployment_events")
    # 版本字串為事件快照，避免日後編輯模型 metadata 時失去當時的部署證據。
    model_version = models.CharField(max_length=64)
    previous_model = models.ForeignKey(PowerInspectionModel, null=True, blank=True, on_delete=models.PROTECT, related_name="superseded_deployment_events")
    previous_model_version = models.CharField(max_length=64, blank=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="power_inspection_deployment_events")
    action = models.CharField(max_length=16, choices=Action.choices)
    rule_version = models.CharField(max_length=64, blank=True)
    outcome = models.CharField(max_length=32, default="SUCCESS")
    failure_reason = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class PowerInspectionJob(models.Model):
    """學員 MP4 巡檢工作與時間軸；真實推論前不能被標成成功。"""

    class Status(models.TextChoices):
        WAITING_FOR_REAL_MODEL = "WAITING_FOR_REAL_MODEL", "等待真實模型"
        QUEUED = "QUEUED", "等待處理"
        PROCESSING = "PROCESSING", "處理中"
        COMPLETED = "COMPLETED", "已完成"
        FAILED = "FAILED", "處理失敗"

    class InferenceMode(models.TextChoices):
        BLOCKED = "BLOCKED", "尚未載入真實模型"
        MOCK = "MOCK", "模擬流程"
        REAL = "REAL", "真實 YOLO"

    job_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    enrollment = models.ForeignKey(Enrollment, on_delete=models.CASCADE, related_name="power_inspection_jobs")
    model = models.ForeignKey(PowerInspectionModel, null=True, blank=True, on_delete=models.SET_NULL, related_name="jobs")
    video = models.FileField(upload_to=power_inspection_upload_path, blank=True)
    original_filename = models.CharField(max_length=255, blank=True)
    video_sha256 = models.CharField(max_length=64, blank=True)
    status = models.CharField(max_length=32, choices=Status.choices, default=Status.WAITING_FOR_REAL_MODEL)
    inference_mode = models.CharField(max_length=12, choices=InferenceMode.choices, default=InferenceMode.BLOCKED)
    # 工作建立時複製模型規則，後續模型調整不能改寫歷史巡檢報告。
    rule_version = models.CharField(max_length=64, default="POWER_INSPECTION_RULE_V1")
    rule_config = models.JSONField(default=dict, blank=True)
    anomaly_timeline = models.JSONField(default=list, blank=True)
    video_metadata = models.JSONField(default=dict, blank=True)
    result_json = models.JSONField(default=dict, blank=True)
    worker_detail = models.CharField(max_length=500, blank=True)
    last_error = models.CharField(max_length=500, blank=True)
    retry_count = models.PositiveSmallIntegerField(default=0)
    last_attempt_at = models.DateTimeField(null=True, blank=True)
    processed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]


class PowerInspectionAnomalyFrame(models.Model):
    """巡檢異常截圖；檔案只由隔離 worker 寫入，Web request 不產生截圖。"""

    frame_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    job = models.ForeignKey(PowerInspectionJob, on_delete=models.CASCADE, related_name="anomaly_frames")
    timestamp_ms = models.PositiveIntegerField()
    class_name = models.CharField(max_length=120)
    confidence = models.FloatField()
    screenshot = models.FileField(upload_to=power_inspection_upload_path, blank=True)
    inference_mode = models.CharField(max_length=12, choices=PowerInspectionJob.InferenceMode.choices)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["timestamp_ms", "created_at"]


class PowerInspectionReview(models.Model):
    """教師覆核電力巡檢工作；保留正確、錯誤與待確認三態。"""

    class Decision(models.TextChoices):
        CORRECT = "CORRECT", "正確"
        INCORRECT = "INCORRECT", "錯誤"
        PENDING = "PENDING", "待確認"

    review_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    job = models.ForeignKey(PowerInspectionJob, on_delete=models.CASCADE, related_name="reviews")
    reviewer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="power_inspection_reviews")
    decision = models.CharField(max_length=12, choices=Decision.choices)
    score = models.PositiveSmallIntegerField(null=True, blank=True, validators=[MinValueValidator(0), MaxValueValidator(100)])
    note = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


# ---------------------------------------------------------------------------
# FROZEN 不可變性守衛掛載（第 25 輪 P1 修復）
#
# 修復前 FROZEN 只在服務層/View 層檢查，直接走 ORM 仍可改動樣本。
# 這裡在模型定義完成後掛上 Model 層守衛，涵蓋：
#   save() / delete() / QuerySet.update() / QuerySet.delete()
#   / bulk_update() / bulk_create()
#
# 放在檔尾是刻意的：此刻所有模型都已定義完成，掛載不會造成循環匯入。
# 詳見 learning/golden_set_guard.py 的說明與殘餘風險清單。
# ---------------------------------------------------------------------------
from . import golden_set_guard as _golden_set_guard  # noqa: E402

_golden_set_guard.install(sys.modules[__name__])


class VisionInspectionRecord(models.Model):
    """學員單張圖片的真實 YOLO 檢測與教師覆核紀錄。

    只有 Live 回傳真實推論後才建立；推論失敗不留紀錄，也就不會出現假結果。
    模型版本與偵測框在建立時複製保存，之後換模型不會改寫歷史。
    """

    class TaskType(models.TextChoices):
        PROP_ROTATION_V5 = "PROP_ROTATION_V5", "F450 螺旋槳方向（CW／CCW）"
        POWER_INSPECTION_V1 = "POWER_INSPECTION_V1", "AI 電力巡檢"

    class ReviewStatus(models.TextChoices):
        PENDING = "PENDING", "等待教師覆核"
        PASS = "PASS", "PASS"
        NG = "NG", "NG"
        RESUBMIT = "RESUBMIT", "要求重傳"

    record_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    enrollment = models.ForeignKey(Enrollment, on_delete=models.CASCADE, related_name="vision_inspection_records")
    task_type = models.CharField(max_length=32, choices=TaskType.choices)
    image = models.FileField(upload_to=vision_inspection_upload_path)
    original_filename = models.CharField(max_length=255, blank=True)
    image_sha256 = models.CharField(max_length=64)
    image_width = models.PositiveIntegerField(default=0)
    image_height = models.PositiveIntegerField(default=0)
    model_id = models.CharField(max_length=128)
    model_version = models.CharField(max_length=128)
    model_status = models.CharField(max_length=32)
    model_sha256 = models.CharField(max_length=64, blank=True)
    detections = models.JSONField(default=list, blank=True)
    best_class = models.CharField(max_length=64, blank=True)
    best_confidence = models.FloatField(null=True, blank=True)
    learning_event_id = models.CharField(max_length=128, blank=True)
    review_status = models.CharField(max_length=16, choices=ReviewStatus.choices, default=ReviewStatus.PENDING)
    review_note = models.CharField(max_length=500, blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="vision_inspection_reviews",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    # NG／要求重傳的圖片回收為下一輪資料候選；只做標記，不自動進訓練集。
    failure_sample = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["review_status", "-created_at"], name="vision_insp_review_idx")]

    def __str__(self):
        return f"{self.task_type}:{self.record_id}"


class VisionInspectionReviewEvent(models.Model):
    """教師每次覆核都追加一筆，改判不覆蓋舊決定。"""

    record = models.ForeignKey(VisionInspectionRecord, on_delete=models.CASCADE, related_name="review_events")
    decision = models.CharField(max_length=16, choices=VisionInspectionRecord.ReviewStatus.choices)
    note = models.CharField(max_length=500, blank=True)
    reviewer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="vision_inspection_review_events")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
