from django.contrib import admin

from .models import (
    CandidatePool,
    Cohort,
    EmailVerificationCode,
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
    return queryset.filter(**{lookup: request.user})


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


@admin.register(StudentProfile)
class StudentProfileAdmin(admin.ModelAdmin):
    list_display = ("student_id", "display_name", "legal_name", "cohort", "expected_email", "user", "active")
    search_fields = ("student_id", "display_name", "legal_name", "expected_email")
    list_filter = ("cohort", "active")
    readonly_fields = ("created_at",)

    def get_queryset(self, request):
        return _teacher_scope(super().get_queryset(request), request, "cohort__teacher_accesses__teacher")

    def get_readonly_fields(self, request, obj=None):
        fields = ["created_at", "registered_email", "user"]
        if obj:
            fields.append("student_id")
        return fields

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        if db_field.name == "cohort" and not request.user.is_superuser:
            kwargs["queryset"] = Cohort.objects.filter(
                active=True, teacher_accesses__teacher=request.user
            ).distinct()
        return super().formfield_for_foreignkey(db_field, request, **kwargs)

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
    list_display = ("student", "task", "status", "submitted_at", "reviewed_at", "teacher_score")
    search_fields = ("student__student_id", "student__legal_name", "task__title")
    list_filter = ("status", "student__cohort", "task__stage")
    readonly_fields = ("submitted_at", "reviewed_at", "updated_at")

    def get_queryset(self, request):
        return _teacher_scope(super().get_queryset(request), request, "student__cohort__teacher_accesses__teacher")


@admin.register(PhaseProgress)
class PhaseProgressAdmin(admin.ModelAdmin):
    list_display = ("student", "phase", "status", "updated_at")
    list_filter = ("phase", "status", "student__cohort")

    def get_queryset(self, request):
        return _teacher_scope(super().get_queryset(request), request, "student__cohort__teacher_accesses__teacher")


@admin.register(Evidence)
class EvidenceAdmin(ImmutableRecordAdmin, admin.ModelAdmin):
    list_display = ("evidence_id", "progress", "evidence_type", "created_at")
    search_fields = ("progress__student__student_id", "description")
    list_filter = ("evidence_type", "progress__student__cohort")
    readonly_fields = ("evidence_id", "created_at")

    def get_queryset(self, request):
        return _teacher_scope(super().get_queryset(request), request, "progress__student__cohort__teacher_accesses__teacher")


@admin.register(TeacherReviewEvent)
class TeacherReviewEventAdmin(ImmutableRecordAdmin, admin.ModelAdmin):
    list_display = ("progress", "teacher", "result", "score", "created_at")
    list_filter = ("result", "teacher", "created_at")
    search_fields = ("progress__student__student_id", "note")
    readonly_fields = ("created_at",)

    def get_queryset(self, request):
        return _teacher_scope(super().get_queryset(request), request, "progress__student__cohort__teacher_accesses__teacher")


@admin.register(CandidatePool)
class CandidatePoolAdmin(ImmutableRecordAdmin, admin.ModelAdmin):
    list_display = ("evidence", "promote_to_dataset", "promote_to_rag", "approved_by_teacher", "approved_at")
    list_filter = ("promote_to_dataset", "promote_to_rag", "approved_by_teacher")
    readonly_fields = ("approved_at", "updated_at")

    def get_queryset(self, request):
        return _teacher_scope(super().get_queryset(request), request, "evidence__progress__student__cohort__teacher_accesses__teacher")


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
