from django.contrib import admin

from .models import (
    CandidatePool,
    ClassCode,
    Cohort,
    EmailVerificationCode,
    Enrollment,
    Evidence,
    PhaseProgress,
    StudentProfile,
    StudentTaskProgress,
    TaskDefinition,
    TaskDefinitionRevision,
    TeacherCohortAccess,
    TeacherReviewEvent,
)


def _teacher_scope(queryset, request, lookup):
    if request.user.is_superuser:
        return queryset
    return queryset.filter(**{lookup: request.user}).distinct()


class ImmutableRecordAdmin:
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Cohort)
class CohortAdmin(admin.ModelAdmin):
    list_display = ("cohort_id", "name", "active", "created_at")
    search_fields = ("cohort_id", "name")
    list_filter = ("active",)

    def get_queryset(self, request):
        return _teacher_scope(super().get_queryset(request), request, "teacher_accesses__teacher")


@admin.register(ClassCode)
class ClassCodeAdmin(admin.ModelAdmin):
    list_display = ("code", "cohort", "active", "use_count", "max_uses", "expires_at")
    search_fields = ("code", "cohort__cohort_id", "cohort__name")
    list_filter = ("active", "cohort")

    def get_queryset(self, request):
        return _teacher_scope(super().get_queryset(request), request, "cohort__teacher_accesses__teacher")

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        if db_field.name == "cohort" and not request.user.is_superuser:
            kwargs["queryset"] = Cohort.objects.filter(
                active=True, teacher_accesses__teacher=request.user
            ).distinct()
        return super().formfield_for_foreignkey(db_field, request, **kwargs)


@admin.register(Enrollment)
class EnrollmentAdmin(ImmutableRecordAdmin, admin.ModelAdmin):
    list_display = ("student", "cohort", "joined_at", "active")
    search_fields = ("student__public_user_id", "student__nickname", "cohort__cohort_id")
    list_filter = ("cohort", "active")

    def get_queryset(self, request):
        return _teacher_scope(super().get_queryset(request), request, "cohort__teacher_accesses__teacher")


@admin.register(StudentProfile)
class StudentProfileAdmin(admin.ModelAdmin):
    list_display = ("public_user_id", "nickname", "account_type", "created_at", "active")
    search_fields = ("public_user_id", "nickname")
    list_filter = ("account_type", "active")
    fields = ("public_user_id", "nickname", "account_type", "active", "created_at")
    readonly_fields = ("public_user_id", "created_at")

    def get_queryset(self, request):
        if request.user.is_superuser:
            return super().get_queryset(request)
        return super().get_queryset(request).filter(
            enrollments__cohort__teacher_accesses__teacher=request.user
        ).distinct()

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(TaskDefinition)
class TaskDefinitionAdmin(admin.ModelAdmin):
    list_display = ("task_id", "sort_order", "title", "stage", "version", "active", "updated_at")
    search_fields = ("task_id", "title", "description")
    list_filter = ("stage", "active")
    list_editable = ("sort_order", "stage", "active")
    readonly_fields = ("version", "updated_at")

    def save_model(self, request, obj, form, change):
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(TaskDefinitionRevision)
class TaskDefinitionRevisionAdmin(ImmutableRecordAdmin, admin.ModelAdmin):
    list_display = ("task", "version", "title", "updated_by", "created_at")
    list_filter = ("stage",)
    search_fields = ("task__task_id", "title")
    readonly_fields = ("task", "version", "sort_order", "stage", "title", "description", "requirements", "evidence_required", "updated_by", "created_at")


@admin.register(StudentTaskProgress)
class StudentTaskProgressAdmin(ImmutableRecordAdmin, admin.ModelAdmin):
    list_display = ("enrollment", "task", "status", "submitted_at", "reviewed_at", "teacher_score")
    search_fields = ("enrollment__student__public_user_id", "enrollment__student__nickname", "task__title")
    list_filter = ("status", "enrollment__cohort", "task__stage")

    def get_queryset(self, request):
        return _teacher_scope(super().get_queryset(request), request, "enrollment__cohort__teacher_accesses__teacher")


@admin.register(PhaseProgress)
class PhaseProgressAdmin(admin.ModelAdmin):
    list_display = ("enrollment", "phase", "status", "updated_at")
    list_filter = ("phase", "status", "enrollment__cohort")

    def get_queryset(self, request):
        return _teacher_scope(super().get_queryset(request), request, "enrollment__cohort__teacher_accesses__teacher")


@admin.register(Evidence)
class EvidenceAdmin(ImmutableRecordAdmin, admin.ModelAdmin):
    list_display = ("evidence_id", "progress", "evidence_type", "created_at")
    search_fields = ("progress__enrollment__student__public_user_id", "description")
    list_filter = ("evidence_type", "progress__enrollment__cohort")
    readonly_fields = ("evidence_id", "created_at")

    def get_queryset(self, request):
        return _teacher_scope(super().get_queryset(request), request, "progress__enrollment__cohort__teacher_accesses__teacher")


@admin.register(TeacherReviewEvent)
class TeacherReviewEventAdmin(ImmutableRecordAdmin, admin.ModelAdmin):
    list_display = ("progress", "teacher", "result", "score", "created_at")
    list_filter = ("result", "teacher", "created_at")
    search_fields = ("progress__enrollment__student__public_user_id", "note")

    def get_queryset(self, request):
        return _teacher_scope(super().get_queryset(request), request, "progress__enrollment__cohort__teacher_accesses__teacher")


@admin.register(CandidatePool)
class CandidatePoolAdmin(ImmutableRecordAdmin, admin.ModelAdmin):
    list_display = ("evidence", "promote_to_dataset", "promote_to_rag", "approved_by_teacher", "approved_at")
    list_filter = ("promote_to_dataset", "promote_to_rag", "approved_by_teacher")
    readonly_fields = ("approved_at", "updated_at")

    def get_queryset(self, request):
        return _teacher_scope(super().get_queryset(request), request, "evidence__progress__enrollment__cohort__teacher_accesses__teacher")


@admin.register(EmailVerificationCode)
class EmailVerificationCodeAdmin(admin.ModelAdmin):
    list_display = ("user", "expires_at", "attempts", "consumed_at", "created_at")
    readonly_fields = ("user", "code_hash", "expires_at", "attempts", "consumed_at", "created_at")

    def has_add_permission(self, request):
        return False

    def has_view_permission(self, request, obj=None):
        return request.user.is_superuser

    def has_change_permission(self, request, obj=None):
        return request.user.is_superuser


@admin.register(TeacherCohortAccess)
class TeacherCohortAccessAdmin(admin.ModelAdmin):
    list_display = ("teacher", "cohort", "created_at")
    list_filter = ("cohort",)
    search_fields = ("teacher__username", "cohort__cohort_id")
    readonly_fields = ("created_at",)

    def has_module_permission(self, request):
        return request.user.is_superuser
