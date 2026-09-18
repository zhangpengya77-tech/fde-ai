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
    student = models.ForeignKey("StudentProfile", on_delete=models.CASCADE, related_name="enrollments")
    cohort = models.ForeignKey(Cohort, on_delete=models.PROTECT, related_name="enrollments")
    group = models.ForeignKey(
        LearningGroup, null=True, blank=True, on_delete=models.SET_NULL, related_name="enrollments"
    )
    project_direction = models.CharField(max_length=64, null=True, blank=True)
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
