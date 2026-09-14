import logging
import mimetypes
from pathlib import Path

from django.conf import settings
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
from django.http import FileResponse, Http404, HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse, reverse_lazy
from django.utils import timezone
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.http import require_http_methods, require_POST

from .forms import (
    EvidenceForm,
    JoinCohortForm,
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
    ClassCode,
    Cohort,
    EmailVerificationCode,
    Enrollment,
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
PLATFORM_ROOT = Path(settings.BASE_DIR).parent.resolve()


def home(request):
    if request.user.is_authenticated:
        if request.user.is_staff:
            return redirect("learning:teacher_dashboard")
        return redirect("learning:platform")
    next_url = request.GET.get("next", "")
    if not url_has_allowed_host_and_scheme(
        next_url, allowed_hosts={request.get_host()}, require_https=request.is_secure()
    ):
        next_url = ""
    return render(request, "learning/home.html", {"next_url": next_url})


def _platform_response(file_path, *, html=False):
    if not file_path.is_file():
        raise Http404
    if html:
        content = file_path.read_text(encoding="utf-8").replace(
            "<head>", '<head>\n    <base href="/platform/">', 1
        )
        response = HttpResponse(content, content_type="text/html; charset=utf-8")
    else:
        content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        response = FileResponse(file_path.open("rb"), content_type=content_type)
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    return response


@login_required(login_url=reverse_lazy("learning:home"))
def platform_entry(request):
    return _platform_response(PLATFORM_ROOT / "index.html", html=True)


@login_required(login_url=reverse_lazy("learning:home"))
def platform_asset(request, asset_path):
    if asset_path == "index.html":
        return _platform_response(PLATFORM_ROOT / "index.html", html=True)

    static_roots = (PLATFORM_ROOT / "src").resolve(), (PLATFORM_ROOT / "assets").resolve()
    file_path = (PLATFORM_ROOT / asset_path).resolve()
    if any(file_path.is_relative_to(root) for root in static_roots) and file_path.is_file():
        return _platform_response(file_path)
    if Path(asset_path).suffix:
        raise Http404
    return _platform_response(PLATFORM_ROOT / "index.html", html=True)


@require_http_methods(["GET", "POST"])
def register(request):
    form = StudentRegistrationForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        try:
            profile = form.create_account()
        except ValidationError as exc:
            form.add_error(None, exc)
        except IntegrityError:
            form.add_error("email", "此電子郵件已註冊，請直接登入或使用忘記密碼功能。")
        except Exception as exc:
            logger.error("Student registration failed (%s).", type(exc).__name__)
            form.add_error(None, "目前無法寄送驗證郵件，請稍後再試。")
        else:
            messages.success(request, "驗證碼已寄到您的電子郵件，請在 15 分鐘內完成驗證。")
            return redirect("learning:activate", public_user_id=profile.public_user_id)
    return render(request, "learning/register.html", {"form": form})


@require_http_methods(["GET", "POST"])
def activate(request, public_user_id):
    profile = StudentProfile.objects.filter(public_user_id=public_user_id, active=True).select_related("user").first()
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
                messages.success(request, "電子郵件驗證完成，現在可以使用電子郵件登入。")
                return redirect("learning:student_login")
    return render(request, "learning/activate.html", {"public_user_id": public_user_id, "error": error})


@require_POST
def resend_activation(request, public_user_id):
    profile = StudentProfile.objects.filter(
        public_user_id=public_user_id, active=True, user__is_active=False
    ).select_related("user").first()
    if profile and profile.user_id:
        try:
            issue_activation_code(profile.user)
        except ValidationError:
            pass
        except Exception as exc:
            logger.error("Activation email resend failed (%s).", type(exc).__name__)
    messages.info(request, "若帳號符合驗證條件，系統已寄送驗證碼；若未收到，請稍後重試。")
    return redirect("learning:activate", public_user_id=public_user_id)


class StudentLoginView(LoginView):
    authentication_form = StudentLoginForm
    template_name = "learning/student_login.html"

    def get_success_url(self):
        return self.get_redirect_url() or reverse("learning:platform")


class TeacherLoginView(LoginView):
    authentication_form = TeacherLoginForm
    template_name = "learning/teacher_login.html"

    def get_success_url(self):
        return self.get_redirect_url() or reverse("learning:teacher_dashboard")


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


def ordered_phase_progress(enrollment):
    progress = {item.phase: item for item in PhaseProgress.objects.filter(enrollment=enrollment)}
    return [progress[phase] for phase, _ in TaskDefinition.Stage.choices if phase in progress]


def mask_email(email):
    if not email or "@" not in email:
        return "未提供"
    local, domain = email.split("@", 1)
    return f"{local[:2]}***@{domain}"


@student_required
def student_dashboard(request):
    profile = request.student_profile
    enrollments = profile.enrollments.filter(active=True).select_related("cohort")
    enrollment_rows = []
    task_count = TaskDefinition.objects.filter(active=True).count()
    for enrollment in enrollments:
        enrollment_rows.append(
            {
                "enrollment": enrollment,
                "task_count": task_count,
                "completed_count": enrollment.task_progress.filter(
                    status=StudentTaskProgress.Status.REVIEWED, task__active=True
                ).count(),
            }
        )
    return render(request, "learning/student_dashboard.html", {"profile": profile, "enrollment_rows": enrollment_rows})


@student_required
@require_http_methods(["GET", "POST"])
def join_cohort(request):
    form = JoinCohortForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        now = timezone.now()
        try:
            with transaction.atomic():
                code = (
                    ClassCode.objects.select_for_update()
                    .select_related("cohort")
                    .filter(code=form.cleaned_data["class_code"], active=True, cohort__active=True)
                    .first()
                )
                if (
                    code is None
                    or (code.expires_at and code.expires_at <= now)
                    or (code.max_uses is not None and code.use_count >= code.max_uses)
                ):
                    raise ValidationError("邀請碼無效或已失效，請確認後重試。")
                enrollment, created = Enrollment.objects.get_or_create(
                    student=request.student_profile, cohort=code.cohort
                )
                if created:
                    code.use_count += 1
                    code.save(update_fields=["use_count"])
                    for task in TaskDefinition.objects.filter(active=True):
                        StudentTaskProgress.objects.get_or_create(enrollment=enrollment, task=task)
                    for phase, _ in TaskDefinition.Stage.choices:
                        PhaseProgress.objects.get_or_create(enrollment=enrollment, phase=phase)
        except ValidationError as exc:
            form.add_error("class_code", exc)
        except IntegrityError:
            form.add_error("class_code", "加入課程時發生衝突，請重新提交。")
        else:
            messages.success(request, "已加入課程。" if created else "你已加入這門課程。")
            return redirect("learning:student_dashboard")
    return render(request, "learning/join_cohort.html", {"profile": request.student_profile, "form": form})


@student_required
def student_course_dashboard(request, enrollment_id):
    enrollment = get_object_or_404(
        Enrollment.objects.select_related("cohort", "student"),
        pk=enrollment_id,
        student=request.student_profile,
        active=True,
    )
    tasks = TaskDefinition.objects.filter(active=True)
    for task in tasks:
        StudentTaskProgress.objects.get_or_create(enrollment=enrollment, task=task)
    for phase, _ in TaskDefinition.Stage.choices:
        PhaseProgress.objects.get_or_create(enrollment=enrollment, phase=phase)
    progress = (
        StudentTaskProgress.objects.filter(enrollment=enrollment, task__active=True)
        .select_related("task")
        .prefetch_related("evidence")
    )
    phases = ordered_phase_progress(enrollment)
    reviewed_count = progress.filter(status=StudentTaskProgress.Status.REVIEWED).count()
    return render(
        request,
        "learning/student_course_dashboard.html",
        {"profile": request.student_profile, "enrollment": enrollment, "progress": progress, "phases": phases, "reviewed_count": reviewed_count},
    )


@student_required
@require_http_methods(["GET", "POST"])
def task_detail(request, enrollment_id, task_id):
    enrollment = get_object_or_404(
        Enrollment, pk=enrollment_id, student=request.student_profile, active=True
    )
    task = get_object_or_404(TaskDefinition, task_id=task_id.upper(), active=True)
    progress, _ = StudentTaskProgress.objects.get_or_create(enrollment=enrollment, task=task)
    is_reviewed = progress.status == StudentTaskProgress.Status.REVIEWED
    if is_reviewed and request.method == "POST":
        messages.error(request, "此任務已由教師覆核；如需修改，請聯絡教師重新開放。")
        return redirect("learning:task_detail", enrollment_id=enrollment.pk, task_id=task.task_id)
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
            return redirect("learning:task_detail", enrollment_id=enrollment.pk, task_id=task.task_id)
    else:
        form = StudentTaskProgressForm(instance=progress)
    return render(
        request,
        "learning/task_detail.html",
        {"task": task, "task_content": progress.task_content, "progress": progress, "enrollment": enrollment, "form": form, "evidence": progress.evidence.all()},
    )


@student_required
@require_http_methods(["GET", "POST"])
def evidence_add(request, enrollment_id, task_id):
    enrollment = get_object_or_404(
        Enrollment, pk=enrollment_id, student=request.student_profile, active=True
    )
    task = get_object_or_404(TaskDefinition, task_id=task_id.upper(), active=True)
    progress, _ = StudentTaskProgress.objects.get_or_create(enrollment=enrollment, task=task)
    if progress.status == StudentTaskProgress.Status.REVIEWED:
        messages.error(request, "此任務已由教師覆核，不能再新增證據。")
        return redirect("learning:task_detail", enrollment_id=enrollment.pk, task_id=task.task_id)
    form = EvidenceForm(request.POST or None, request.FILES or None)
    if request.method == "POST" and form.is_valid():
        evidence = form.save(commit=False)
        evidence.progress = progress
        evidence.save()
        if progress.status == StudentTaskProgress.Status.NOT_STARTED:
            progress.status = StudentTaskProgress.Status.IN_PROGRESS
            progress.save(update_fields=["status", "updated_at"])
        messages.success(request, "學習證據已保存。")
        return redirect("learning:task_detail", enrollment_id=enrollment.pk, task_id=task.task_id)
    return render(request, "learning/evidence_add.html", {"task": task, "enrollment": enrollment, "form": form})


@login_required(login_url=reverse_lazy("learning:student_login"))
def evidence_download(request, evidence_id):
    evidence = get_object_or_404(
        Evidence.objects.select_related("progress__enrollment__student__user", "progress__enrollment__cohort"),
        evidence_id=evidence_id,
    )
    enrollment = evidence.progress.enrollment
    is_owner = enrollment.active and enrollment.student.user_id == request.user.pk
    is_assigned_teacher = request.user.is_superuser or (
        request.user.is_staff
        and TeacherCohortAccess.objects.filter(teacher=request.user, cohort=enrollment.cohort).exists()
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
def update_phase(request, enrollment_id, phase):
    enrollment = get_object_or_404(
        Enrollment, pk=enrollment_id, student=request.student_profile, active=True
    )
    if phase not in dict(TaskDefinition.Stage.choices):
        raise Http404
    progress, _ = PhaseProgress.objects.get_or_create(enrollment=enrollment, phase=phase)
    form = PhaseProgressForm(request.POST, instance=progress)
    if form.is_valid():
        form.save()
        messages.success(request, "學習階段狀態已保存；各任務仍可自由進入。")
    else:
        messages.error(request, "階段狀態無法保存，請檢查輸入。")
    return redirect("learning:student_course_dashboard", enrollment_id=enrollment.pk)


@teacher_required
def teacher_dashboard(request):
    cohorts = list(teacher_cohorts(request.user).values_list("cohort_id", flat=True).distinct())
    cohort_id = request.GET.get("cohort", "").strip()
    status_filter = request.GET.get("status", "").strip()
    query = request.GET.get("q", "").strip()
    profiles = StudentProfile.objects.filter(active=True, user__is_staff=False).select_related("user")
    if query:
        profiles = profiles.filter(Q(public_user_id__icontains=query) | Q(nickname__icontains=query))
    tasks = list(TaskDefinition.objects.filter(active=True))
    rows = []
    valid_statuses = {value for value, _ in StudentTaskProgress.Status.choices}
    for profile in profiles:
        enrollments = profile.enrollments.filter(active=True, cohort_id__in=cohorts).select_related("cohort")
        if cohort_id:
            enrollments = enrollments.filter(cohort_id=cohort_id)
        visible_enrollments = list(enrollments)
        if not visible_enrollments:
            if cohort_id or status_filter in valid_statuses or profile.enrollments.filter(active=True).exists():
                continue
            rows.append(
                {
                    "enrollment": None,
                    "student": profile,
                    "email_masked": mask_email(profile.email),
                    "reviewed_count": 0,
                    "total_count": 0,
                    "submitted_count": 0,
                    "incomplete_count": 0,
                    "skipped_count": 0,
                }
            )
            continue
        for enrollment in visible_enrollments:
            by_task = {}
            for task in tasks:
                item, _ = StudentTaskProgress.objects.get_or_create(enrollment=enrollment, task=task)
                by_task[task.task_id] = item
            items = list(by_task.values())
            if status_filter in valid_statuses and not any(item.status == status_filter for item in items):
                continue
            rows.append(
                {
                    "enrollment": enrollment,
                    "student": profile,
                    "email_masked": mask_email(profile.email),
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
def teacher_student_detail(request, enrollment_id):
    enrollment = get_object_or_404(
        Enrollment.objects.filter(cohort__in=teacher_cohorts(request.user)).select_related("cohort", "student__user"),
        pk=enrollment_id,
        active=True,
    )
    tasks = TaskDefinition.objects.filter(active=True)
    for task in tasks:
        StudentTaskProgress.objects.get_or_create(enrollment=enrollment, task=task)
    for phase, _ in TaskDefinition.Stage.choices:
        PhaseProgress.objects.get_or_create(enrollment=enrollment, phase=phase)
    progress = (
        StudentTaskProgress.objects.filter(enrollment=enrollment, task__active=True)
        .select_related("task")
        .prefetch_related("evidence", "review_events__teacher")
    )
    return render(
        request,
        "learning/teacher_student_detail.html",
        {"profile": enrollment.student, "enrollment": enrollment, "email_masked": mask_email(enrollment.student.email), "progress": progress, "phases": ordered_phase_progress(enrollment)},
    )


@teacher_required
@require_POST
def review_task(request, progress_id):
    progress = get_object_or_404(
        StudentTaskProgress.objects.filter(enrollment__cohort__in=teacher_cohorts(request.user)).select_related("enrollment", "task"),
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
    return redirect("learning:teacher_student_detail", enrollment_id=progress.enrollment_id)


@teacher_required
@require_POST
def promote_candidate(request, evidence_id):
    evidence = get_object_or_404(
        Evidence.objects.filter(progress__enrollment__cohort__in=teacher_cohorts(request.user)).select_related("progress__enrollment"),
        evidence_id=evidence_id,
    )
    promote_to_dataset = request.POST.get("promote_to_dataset") == "on"
    promote_to_rag = request.POST.get("promote_to_rag") == "on"
    if not (promote_to_dataset or promote_to_rag):
        messages.error(request, "請明確選擇要加入的候選池；本操作不會自動訓練或更新知識庫。")
        return redirect("learning:teacher_student_detail", enrollment_id=evidence.progress.enrollment_id)
    record, _ = CandidatePool.objects.get_or_create(evidence=evidence)
    record.promote_to_dataset = promote_to_dataset
    record.promote_to_rag = promote_to_rag
    record.approved_by_teacher = request.user
    record.approved_at = timezone.now()
    record.save()
    messages.success(request, "已記錄教師批准的候選用途；未執行模型訓練或 RAG 更新。")
    return redirect("learning:teacher_student_detail", enrollment_id=evidence.progress.enrollment_id)
