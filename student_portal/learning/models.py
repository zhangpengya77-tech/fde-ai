import uuid

from django.conf import settings
from django.core.validators import FileExtensionValidator, RegexValidator
from django.db import models
from django.utils import timezone


student_id_validator = RegexValidator(
    regex=r"^\d{4}-\d{2}-S\d{2,}$",
    message="學員 ID 格式須為 YYYY-期別-S編號，例如 2026-01-S01。",
)


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
    student_id = models.CharField(primary_key=True, max_length=32, validators=[student_id_validator])
    cohort = models.ForeignKey(Cohort, on_delete=models.PROTECT, related_name="students")
    legal_name = models.CharField(max_length=80)
    display_name = models.CharField(max_length=40)
    expected_email = models.EmailField(blank=True)
    registered_email = models.EmailField(unique=True, null=True, blank=True)
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
        ordering = ["student_id"]

    def __str__(self):
        return f"{self.student_id} · {self.display_name}"


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

    student = models.ForeignKey(StudentProfile, on_delete=models.CASCADE, related_name="task_progress")
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
        constraints = [models.UniqueConstraint(fields=["student", "task"], name="one_progress_per_student_task")]

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
        return f"{self.student_id} / {self.task_id}: {self.get_status_display()}"


class PhaseProgress(models.Model):
    class Status(models.TextChoices):
        NOT_STARTED = "not_started", "未開始"
        IN_PROGRESS = "in_progress", "進行中"
        COMPLETED = "completed", "已完成"
        SKIPPED = "skipped", "跳過"

    student = models.ForeignKey(StudentProfile, on_delete=models.CASCADE, related_name="phase_progress")
    phase = models.CharField(max_length=12, choices=TaskDefinition.Stage.choices)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.NOT_STARTED)
    note = models.TextField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["phase"]
        constraints = [models.UniqueConstraint(fields=["student", "phase"], name="one_phase_per_student")]


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
    progress = models.ForeignKey(StudentTaskProgress, on_delete=models.CASCADE, related_name="evidence")
    evidence_type = models.CharField(max_length=12, choices=Type.choices)
    external_url = models.URLField(blank=True)
    upload = models.FileField(
        upload_to=evidence_upload_path,
        blank=True,
        validators=[
            FileExtensionValidator(
                allowed_extensions=["jpg", "jpeg", "png", "webp", "mp4", "mov", "pdf", "zip", "pt", "onnx", "tif", "tiff", "obj", "stl", "glb", "txt"],
            ),
            validate_evidence_size,
        ],
    )
    description = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def clean(self):
        from django.core.exceptions import ValidationError

        if bool(self.external_url) == bool(self.upload):
            raise ValidationError("證據必須且只能提供一個檔案或一個外部連結。")

    @property
    def student(self):
        return self.progress.student

    def __str__(self):
        return f"{self.progress.task_id} · {self.get_evidence_type_display()}"


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
