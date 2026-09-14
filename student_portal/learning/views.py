import logging

from django.contrib import messages
from django.contrib.auth import logout
from django.contrib.auth.decorators import login_required, user_passes_test
from django.contrib.auth.hashers import check_password
from django.contrib.auth.views import (
    LoginView,
    LogoutView,
    PasswordResetCompleteView,
    PasswordResetConfirmView,
    PasswordResetDoneView,
    PasswordResetView,
)
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse, reverse_lazy
from django.utils import timezone
from django.views.decorators.http import require_http_methods, require_POST

from .forms import (
    EvidenceForm,
    PhaseProgressForm,
    StudentLoginForm,
    StudentPasswordResetForm,
    StudentRegistrationForm,
    StudentTaskProgressForm,
    TeacherLoginForm,
    TeacherReviewForm,
)
from .models import (
    CandidatePool,
    Cohort,
    EmailVerificationCode,
    Evidence,
    PhaseProgress,
    StudentProfile,
    StudentTaskProgress,
    TaskDefinition,
    TeacherCohortAccess,
    TeacherReviewEvent,
)
from .services import issue_activation_code


logger = logging.getLogger(__name__)


def home(request):
    if request.user.is_authenticated:
        if request.user.is_staff:
            return redirect("learning:teacher_dashboard")
        return redirect("learning:student_dashboard")
    return render(request, "learning/home.html")


@require_http_methods(["GET", "POST"])
def register(request):
    form = StudentRegistrationForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        try:
            form.create_account()
        except ValidationError as exc:
            form.add_error(None, exc)
        except IntegrityError:
            form.add_error("email", "此電子郵件已用於其他學員，請聯絡教師。")
        except Exception as exc:
            logger.error("Student registration failed (%s).", type(exc).__name__)
            form.add_error(None, "目前無法寄送驗證郵件，請稍後再試或聯絡教師。")
        else:
            messages.success(request, "驗證碼已寄到您的電子郵件，請在 15 分鐘內完成驗證。")
            return redirect("learning:activate", student_id=form.cleaned_data["student_id"])
    return render(request, "learning/register.html", {"form": form})


@require_http_methods(["GET", "POST"])
def activate(request, student_id):
    profile = StudentProfile.objects.filter(student_id=student_id, active=True).select_related("user").first()
    user = profile.user if profile and profile.user_id else None
    error = ""
    if request.method == "POST":
        submitted_code = request.POST.get("code", "").strip()
        with transaction.atomic():
            record = None
            if user and not user.is_active:
                record = (
                    EmailVerificationCode.objects.select_for_update()
                    .filter(user=user, consumed_at__isnull=True)
                    .first()
                )
            if record is None or record.expires_at <= timezone.now() or record.attempts >= 5:
                error = "驗證碼無效、已過期或帳號已完成驗證；可重新寄送或返回登入。"
            elif not check_password(submitted_code, record.code_hash):
                record.attempts += 1
                record.save(update_fields=["attempts"])
                error = "驗證碼無效、已過期或帳號已完成驗證；可重新寄送或返回登入。"
            else:
                record.consumed_at = timezone.now()
                record.save(update_fields=["consumed_at"])
                user.is_active = True
                user.save(update_fields=["is_active"])
                messages.success(request, "電子郵件驗證完成，現在可以使用學員 ID 登入。")
                return redirect("learning:student_login")
    return render(request, "learning/activate.html", {"student_id": student_id, "error": error})


@require_POST
def resend_activation(request, student_id):
    profile = StudentProfile.objects.filter(
        student_id=student_id, active=True, user__is_active=False
    ).select_related("user").first()
    if profile and profile.user_id:
        try:
            issue_activation_code(profile.user)
        except ValidationError:
            pass
        except Exception as exc:
            logger.error("Activation email resend failed (%s).", type(exc).__name__)
    messages.info(request, "若帳號符合驗證條件，系統已寄送驗證碼；若未收到，請稍後重試或聯絡教師。")
    return redirect("learning:activate", student_id=student_id)


class StudentLoginView(LoginView):
    authentication_form = StudentLoginForm
    template_name = "learning/student_login.html"

    def get_success_url(self):
        return reverse("learning:student_dashboard")


class TeacherLoginView(LoginView):
    authentication_form = TeacherLoginForm
    template_name = "learning/teacher_login.html"

    def get_success_url(self):
        return reverse("learning:teacher_dashboard")


class StudentPasswordResetView(PasswordResetView):
    form_class = StudentPasswordResetForm
    template_name = "learning/password_reset_form.html"
    email_template_name = "learning/password_reset_email.html"
    subject_template_name = "learning/password_reset_subject.txt"
    success_url = reverse_lazy("learning:password_reset_done")


class StudentPasswordResetDoneView(PasswordResetDoneView):
    template_name = "learning/password_reset_done.html"


class StudentPasswordResetConfirmView(PasswordResetConfirmView):
    template_name = "learning/password_reset_confirm.html"
    success_url = reverse_lazy("learning:password_reset_complete")


class StudentPasswordResetCompleteView(PasswordResetCompleteView):
    template_name = "learning/password_reset_complete.html"


def student_required(view_func):
    @login_required(login_url=reverse_lazy("learning:student_login"))
    def wrapped(request, *args, **kwargs):
        try:
            profile = request.user.student_profile
        except StudentProfile.DoesNotExist:
            logout(request)
            return redirect("learning:student_login")
        if not profile.active:
            logout(request)
            return redirect("learning:student_login")
        request.student_profile = profile
        return view_func(request, *args, **kwargs)

    return wrapped


teacher_required = user_passes_test(
    lambda user: user.is_authenticated and user.is_staff,
    login_url=reverse_lazy("learning:teacher_login"),
)


def teacher_cohorts(user):
    cohorts = Cohort.objects.filter(active=True)
    if user.is_superuser:
        return cohorts
    return cohorts.filter(teacher_accesses__teacher=user)


def ordered_phase_progress(student):
    progress = {item.phase: item for item in PhaseProgress.objects.filter(student=student)}
    return [progress[phase] for phase, _ in TaskDefinition.Stage.choices if phase in progress]


@student_required
def student_dashboard(request):
    profile = request.student_profile
    tasks = TaskDefinition.objects.filter(active=True)
    for task in tasks:
        StudentTaskProgress.objects.get_or_create(student=profile, task=task)
    for phase, _ in TaskDefinition.Stage.choices:
        PhaseProgress.objects.get_or_create(student=profile, phase=phase)
    progress = (
        StudentTaskProgress.objects.filter(student=profile, task__active=True)
        .select_related("task")
        .prefetch_related("evidence")
    )
    phases = ordered_phase_progress(profile)
    reviewed_count = progress.filter(status=StudentTaskProgress.Status.REVIEWED).count()
    return render(
        request,
        "learning/student_dashboard.html",
        {"profile": profile, "progress": progress, "phases": phases, "reviewed_count": reviewed_count},
    )


@student_required
@require_http_methods(["GET", "POST"])
def task_detail(request, task_id):
    task = get_object_or_404(TaskDefinition, task_id=task_id.upper(), active=True)
    progress, _ = StudentTaskProgress.objects.get_or_create(student=request.student_profile, task=task)
    is_reviewed = progress.status == StudentTaskProgress.Status.REVIEWED
    if is_reviewed and request.method == "POST":
        messages.error(request, "此任務已由教師覆核；如需修改，請聯絡教師重新開放。")
        return redirect("learning:task_detail", task_id=task.task_id)
    if is_reviewed:
        form = None
    elif request.method == "POST":
        form = StudentTaskProgressForm(request.POST, instance=progress)
        if form.is_valid():
            progress = form.save(commit=False)
            if progress.status == StudentTaskProgress.Status.SUBMITTED:
                progress.submitted_at = timezone.now()
            elif progress.status == StudentTaskProgress.Status.IN_PROGRESS:
                progress.submitted_at = None
            progress.save()
            messages.success(request, "任務狀態已保存。")
            return redirect("learning:task_detail", task_id=task.task_id)
    else:
        form = StudentTaskProgressForm(instance=progress)
    return render(
        request,
        "learning/task_detail.html",
        {"task": task, "task_content": progress.task_content, "progress": progress, "form": form, "evidence": progress.evidence.all()},
    )


@student_required
@require_http_methods(["GET", "POST"])
def evidence_add(request, task_id):
    task = get_object_or_404(TaskDefinition, task_id=task_id.upper(), active=True)
    progress, _ = StudentTaskProgress.objects.get_or_create(student=request.student_profile, task=task)
    if progress.status == StudentTaskProgress.Status.REVIEWED:
        messages.error(request, "此任務已由教師覆核，不能再新增證據。")
        return redirect("learning:task_detail", task_id=task.task_id)
    form = EvidenceForm(request.POST or None, request.FILES or None)
    if request.method == "POST" and form.is_valid():
        evidence = form.save(commit=False)
        evidence.progress = progress
        evidence.save()
        if progress.status == StudentTaskProgress.Status.NOT_STARTED:
            progress.status = StudentTaskProgress.Status.IN_PROGRESS
            progress.save(update_fields=["status", "updated_at"])
        messages.success(request, "學習證據已保存。")
        return redirect("learning:task_detail", task_id=task.task_id)
    return render(request, "learning/evidence_add.html", {"task": task, "form": form})


@login_required(login_url=reverse_lazy("learning:student_login"))
def evidence_download(request, evidence_id):
    evidence = get_object_or_404(Evidence.objects.select_related("progress__student__user"), evidence_id=evidence_id)
    student = evidence.progress.student
    is_owner = student.active and student.user_id == request.user.pk
    is_assigned_teacher = request.user.is_superuser or (
        request.user.is_staff
        and TeacherCohortAccess.objects.filter(teacher=request.user, cohort_id=student.cohort_id).exists()
    )
    if not (is_owner or is_assigned_teacher):
        raise Http404
    if not evidence.upload:
        raise Http404
    try:
        file_handle = evidence.upload.open("rb")
    except (OSError, ValueError):
        raise Http404
    response = FileResponse(file_handle, as_attachment=True, filename=evidence.upload.name.rsplit("/", 1)[-1])
    response["X-Content-Type-Options"] = "nosniff"
    response["Cache-Control"] = "private, no-store"
    return response


@student_required
@require_POST
def update_phase(request, phase):
    if phase not in dict(TaskDefinition.Stage.choices):
        raise Http404
    progress, _ = PhaseProgress.objects.get_or_create(student=request.student_profile, phase=phase)
    form = PhaseProgressForm(request.POST, instance=progress)
    if form.is_valid():
        form.save()
        messages.success(request, "學習階段狀態已保存；各任務仍可自由進入。")
    else:
        messages.error(request, "階段狀態無法保存，請檢查輸入。")
    return redirect("learning:student_dashboard")


@teacher_required
def teacher_dashboard(request):
    cohorts = list(teacher_cohorts(request.user).values_list("cohort_id", flat=True).distinct())
    cohort_id = request.GET.get("cohort", "").strip()
    status_filter = request.GET.get("status", "").strip()
    query = request.GET.get("q", "").strip()
    students = StudentProfile.objects.filter(cohort_id__in=cohorts).select_related("cohort", "user")
    if cohort_id:
        students = students.filter(cohort_id=cohort_id)
    if query:
        students = students.filter(Q(student_id__icontains=query) | Q(legal_name__icontains=query) | Q(display_name__icontains=query))
    tasks = list(TaskDefinition.objects.filter(active=True))
    rows = []
    valid_statuses = {value for value, _ in StudentTaskProgress.Status.choices}
    for student in students:
        by_task = {}
        for task in tasks:
            item, _ = StudentTaskProgress.objects.get_or_create(student=student, task=task)
            by_task[task.task_id] = item
        items = list(by_task.values())
        if status_filter in valid_statuses and not any(item.status == status_filter for item in items):
            continue
        rows.append(
            {
                "student": student,
                "reviewed_count": sum(item.status == StudentTaskProgress.Status.REVIEWED for item in items),
                "total_count": len(items),
                "submitted_count": sum(item.status == StudentTaskProgress.Status.SUBMITTED for item in items),
                "incomplete_count": sum(item.status == StudentTaskProgress.Status.INCOMPLETE for item in items),
                "skipped_count": sum(item.status == StudentTaskProgress.Status.SKIPPED for item in items),
            }
        )
    return render(
        request,
        "learning/teacher_dashboard.html",
        {
            "rows": rows,
            "cohorts": cohorts,
            "selected_cohort": cohort_id,
            "selected_status": status_filter,
            "query": query,
            "statuses": StudentTaskProgress.Status.choices,
            "task_count": len(tasks),
        },
    )


@teacher_required
def teacher_student_detail(request, student_id):
    profile = get_object_or_404(
        StudentProfile.objects.filter(cohort__in=teacher_cohorts(request.user)).select_related("cohort", "user"),
        student_id=student_id,
    )
    tasks = TaskDefinition.objects.filter(active=True)
    for task in tasks:
        StudentTaskProgress.objects.get_or_create(student=profile, task=task)
    for phase, _ in TaskDefinition.Stage.choices:
        PhaseProgress.objects.get_or_create(student=profile, phase=phase)
    progress = (
        StudentTaskProgress.objects.filter(student=profile, task__active=True)
        .select_related("task")
        .prefetch_related("evidence", "review_events__teacher")
    )
    return render(
        request,
        "learning/teacher_student_detail.html",
        {"profile": profile, "progress": progress, "phases": ordered_phase_progress(profile)},
    )


@teacher_required
@require_POST
def review_task(request, progress_id):
    progress = get_object_or_404(
        StudentTaskProgress.objects.filter(student__cohort__in=teacher_cohorts(request.user)).select_related("student", "task"),
        pk=progress_id,
    )
    form = TeacherReviewForm(request.POST, progress=progress)
    if form.is_valid():
        result = form.cleaned_data["result"]
        now = timezone.now()
        progress.status = result
        progress.teacher_note = form.cleaned_data["note"].strip()
        progress.teacher_score = form.cleaned_data["score"]
        progress.reviewed_at = now
        if result == TeacherReviewEvent.Result.SKIPPED:
            progress.skipped_reason = progress.teacher_note
        progress.save()
        TeacherReviewEvent.objects.create(
            progress=progress,
            evidence=form.cleaned_data["evidence"],
            teacher=request.user,
            result=result,
            note=progress.teacher_note,
            score=progress.teacher_score,
        )
        messages.success(request, "教師複核已保存，歷史紀錄已保留。")
    else:
        messages.error(request, "複核資料無效，未保存變更。")
    return redirect("learning:teacher_student_detail", student_id=progress.student_id)


@teacher_required
@require_POST
def promote_candidate(request, evidence_id):
    evidence = get_object_or_404(
        Evidence.objects.filter(progress__student__cohort__in=teacher_cohorts(request.user)).select_related("progress__student"),
        evidence_id=evidence_id,
    )
    promote_to_dataset = request.POST.get("promote_to_dataset") == "on"
    promote_to_rag = request.POST.get("promote_to_rag") == "on"
    if not (promote_to_dataset or promote_to_rag):
        messages.error(request, "請明確選擇要加入的候選池；本操作不會自動訓練或更新知識庫。")
        return redirect("learning:teacher_student_detail", student_id=evidence.progress.student_id)
    record, _ = CandidatePool.objects.get_or_create(evidence=evidence)
    record.promote_to_dataset = promote_to_dataset
    record.promote_to_rag = promote_to_rag
    record.approved_by_teacher = request.user
    record.approved_at = timezone.now()
    record.save()
    messages.success(request, "已記錄教師批准的候選用途；未執行模型訓練或 RAG 更新。")
    return redirect("learning:teacher_student_detail", student_id=evidence.progress.student_id)
