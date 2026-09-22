import logging
import mimetypes
import re
import secrets
import time
from functools import wraps
from pathlib import Path
from urllib.parse import urlencode

from django.conf import settings
from django.contrib import messages
from django.contrib.auth.decorators import login_required
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
from django.core.files import File
from django.core.files.base import ContentFile
from django.db import IntegrityError, transaction
from django.db.models import Max, Q
from django.http import FileResponse, Http404, HttpResponse, HttpResponseForbidden, JsonResponse
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404, redirect, render
from django.template.loader import render_to_string
from django.urls import reverse, reverse_lazy
from django.utils import timezone
from django.utils.http import url_has_allowed_host_and_scheme
from django.contrib.auth.views import redirect_to_login
from django.views.decorators.http import require_http_methods, require_POST

from .forms import (
    EvidenceForm,
    GrowthRecordReviewForm,
    GrowthRecordForm,
    ProjectDirectionForm,
    PhaseProgressForm,
    StudentLoginForm,
    StudentPasswordResetForm,
    StudentRegistrationForm,
    StudentSurveyForm,
    StudentSurveyV2Form,
    StudentTaskProgressForm,
    SURVEY_HELPFUL_TOPIC_CHOICES,
    SURVEY_FUTURE_INTEREST_CHOICES,
    SURVEY_FORMAT_CHOICES,
    SURVEY_LICENSE_CHOICES,
    SURVEY_PRIORITY_CHOICES,
    SURVEY_DURATION_CHOICES,
    SURVEY_V2_ABILITY_CHOICES,
    SURVEY_V2_COURSE_CHOICES,
    SURVEY_V2_PATH_CHOICES,
    SURVEY_V2_INTENT_CHOICES,
    SURVEY_V2_Q1_CHOICES,
    SURVEY_V2_Q2_CHOICES,
    TeacherIdentityForm,
    TeacherLoginForm,
    TeacherReviewForm,
)
from .models import (
    CandidatePool,
    Cohort,
    EmailVerificationCode,
    Enrollment,
    Evidence,
    GrowthRecordReview,
    GrowthRecordSubmission,
    PhaseProgress,
    StudentProfile,
    StudentSurvey,
    StudentTaskProgress,
    TaskDefinition,
    TeacherCohortAccess,
    TeacherReviewEvent,
)
from .growth_media import process_growth_image
from .growth_video import VideoProcessingError, process_growth_video
from .growth_records import ensure_growth_submissions
from .project_directions import (
    direction_content,
    direction_label,
    direction_overview,
    learner_direction_options,
    student_status_label,
    task_display_id,
    task_status_label,
)
from .services import issue_activation_code
from .survey_recommendations import recommend_paths, recommend_v2_paths
from .survey_analytics import (
    PATH_INTEREST_CHOICES,
    apply_survey_filters,
    build_survey_analytics,
    build_survey_v2_analytics,
    choice_labels,
    contact_status,
    contact_status_label,
    labels_for,
)


logger = logging.getLogger(__name__)
PLATFORM_ROOT = Path(settings.BASE_DIR).parent.resolve()
GROWTH_SUBMITTED_STATUSES = {
    GrowthRecordSubmission.Status.SUBMITTED,
    GrowthRecordSubmission.Status.NEEDS_REVISION,
    GrowthRecordSubmission.Status.APPROVED,
    GrowthRecordSubmission.Status.REJECTED,
}
GROWTH_REVIEWED_STATUSES = {
    GrowthRecordSubmission.Status.NEEDS_REVISION,
    GrowthRecordSubmission.Status.APPROVED,
    GrowthRecordSubmission.Status.REJECTED,
}


def home(request):
    return _platform_response(PLATFORM_ROOT / "index.html", html=True, request=request)


def _validated_next(request, value=None):
    candidate = value if value is not None else request.GET.get("next", "")
    if not url_has_allowed_host_and_scheme(
        candidate,
        allowed_hosts={request.get_host()},
        require_https=request.is_secure(),
    ):
        return ""
    return candidate


def _platform_identity_context(request):
    role = "anonymous"
    profile = None
    if request.user.is_authenticated:
        role = "teacher" if request.user.is_staff else "student"
        if role == "student":
            profile = getattr(request.user, "student_profile", None)
            if profile is None or not profile.active:
                role = "unverified"
    platform_context = {
        "role": role,
        "growthUrl": reverse("learning:student_growth_entry"),
        "teacherDashboardUrl": reverse("learning:teacher_dashboard"),
        "teacherLoginUrl": reverse("learning:teacher_login"),
    }
    return {
        "role": role,
        "profile": profile,
        "platform_context": platform_context,
        "growth_url": reverse("learning:student_growth_entry"),
        "courses_url": reverse("learning:student_dashboard"),
        "teacher_dashboard_url": reverse("learning:teacher_dashboard"),
        "student_login_url": reverse("learning:student_login"),
        "register_url": reverse("learning:register"),
        "teacher_login_url": reverse("learning:teacher_login"),
    }


def _platform_response(file_path, *, html=False, request=None):
    if not file_path.is_file():
        raise Http404
    if html:
        content = file_path.read_text(encoding="utf-8").replace(
            "<head>", '<head>\n    <base href="/platform/">', 1
        )
        if request is not None:
            identity_context = _platform_identity_context(request)
            identity_context["csrf_token"] = get_token(request)
            identity_context["request"] = request
            nav = render_to_string("learning/platform_identity_nav.html", identity_context, request=request)
            content = re.sub(r"(<body\b[^>]*>)", rf"\1\n{nav}", content, count=1, flags=re.IGNORECASE)
            demo_note = render_to_string(
                "learning/platform_demo_note.html", identity_context, request=request
            )
            content = re.sub(
                r'(<section\b[^>]*id=["\']teacher["\'][^>]*>.*?<div\b[^>]*class=["\'][^"\']*section-intro[^"\']*["\'][^>]*>)',
                rf"\1{demo_note}",
                content,
                count=1,
                flags=re.IGNORECASE | re.DOTALL,
            )
        content = content.replace(
            "</head>",
            '    <link rel="stylesheet" href="/static/learning/public-platform.css?v=1.5b">\n</head>',
            1,
        )
        content = re.sub(
            r'(<script\b[^>]*src=["\']\./src/platform-browser\.js[^>]*></script>)',
            r'\1\n    <script src="/static/learning/public-platform.js?v=1.5b"></script>',
            content,
            count=1,
            flags=re.IGNORECASE,
        )
        content = re.sub(
            r'(</script>\s*)(?=<script\b[^>]*src=["\']\./src/rag-client\.js)',
            r'\1\n    <script src="/static/learning/public-rag-config.js?v=1.5b"></script>\n    ',
            content,
            count=1,
            flags=re.IGNORECASE,
        )
        response = HttpResponse(content, content_type="text/html; charset=utf-8")
    else:
        content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        response = FileResponse(file_path.open("rb"), content_type=content_type)
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    return response


def platform_entry(request):
    return _platform_response(PLATFORM_ROOT / "index.html", html=True, request=request)


def platform_asset(request, asset_path):
    if asset_path == "index.html":
        return _platform_response(PLATFORM_ROOT / "index.html", html=True, request=request)

    static_roots = (PLATFORM_ROOT / "src").resolve(), (PLATFORM_ROOT / "assets").resolve()
    file_path = (PLATFORM_ROOT / asset_path).resolve()
    if any(file_path.is_relative_to(root) for root in static_roots) and file_path.is_file():
        return _platform_response(file_path)
    if Path(asset_path).suffix:
        raise Http404
    return _platform_response(PLATFORM_ROOT / "index.html", html=True, request=request)


@require_http_methods(["GET", "POST"])
def register(request):
    form = StudentRegistrationForm(request.POST or None)
    next_url = _validated_next(request, request.POST.get("next") if request.method == "POST" else None)
    is_console_email_backend = settings.EMAIL_BACKEND == "django.core.mail.backends.console.EmailBackend"
    existing_unverified_activation_url = ""
    if request.method == "POST":
        submitted_email = request.POST.get("email", "").strip().lower()
        existing_profile = (
            StudentProfile.objects.filter(
                email__iexact=submitted_email,
                active=True,
                user__is_active=False,
            )
            .only("public_user_id")
            .first()
        )
        if existing_profile:
            existing_unverified_activation_url = reverse(
                "learning:activate", args=[existing_profile.public_user_id]
            )
            if next_url:
                existing_unverified_activation_url = (
                    f"{existing_unverified_activation_url}?{urlencode({'next': next_url})}"
                )
    if request.method == "POST" and form.is_valid():
        try:
            profile = form.create_account()
        except ValidationError as exc:
            form.add_error(None, exc)
        except IntegrityError:
            form.add_error("email", "此電子郵件已註冊，請直接登入或使用忘記密碼功能。")
        except Exception as exc:
            logger.exception("Student registration failed while issuing verification email (%s).", type(exc).__name__)
            form.add_error(None, "驗證碼寄送失敗，請稍後重試。")
        else:
            activation_url = reverse("learning:activate", args=[profile.public_user_id])
            if next_url:
                activation_url = f"{activation_url}?{urlencode({'next': next_url})}"
            return redirect(activation_url)
    return render(
        request,
        "learning/register.html",
        {
            "form": form,
            "is_console_email_backend": is_console_email_backend,
            "next_url": next_url,
            "existing_unverified_activation_url": existing_unverified_activation_url,
        },
    )


@require_http_methods(["GET", "POST"])
def activate(request, public_user_id):
    next_url = _validated_next(request, request.POST.get("next") if request.method == "POST" else None)
    profile = StudentProfile.objects.filter(public_user_id=public_user_id, active=True).select_related("user").first()
    user = profile.user if profile and profile.user_id else None
    error = ""
    pending_code = (
        EmailVerificationCode.objects.filter(user=user, consumed_at__isnull=True).first()
        if user
        else None
    )
    has_pending_code = bool(
        pending_code
        and pending_code.expires_at > timezone.now()
        and pending_code.attempts < 5
    )
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
                messages.success(
                    request,
                    f"電子郵件驗證完成，您的永久 FDE ID：{profile.public_user_id}。現在可以登入。",
                )
                login_url = reverse("learning:student_login")
                if next_url:
                    login_url = f"{login_url}?{urlencode({'next': next_url})}"
                return redirect(login_url)
    return render(
        request,
        "learning/activate.html",
        {
            "public_user_id": public_user_id,
            "error": error,
            "has_pending_code": has_pending_code,
            "is_console_email_backend": settings.EMAIL_BACKEND == "django.core.mail.backends.console.EmailBackend",
            "is_smtp_email_backend": settings.EMAIL_BACKEND == "django.core.mail.backends.smtp.EmailBackend",
            "masked_email": mask_email((profile.email or user.email) if profile and user else ""),
            "next_url": next_url,
        },
    )


@require_POST
def resend_activation(request, public_user_id):
    next_url = _validated_next(request, request.POST.get("next"))
    profile = StudentProfile.objects.filter(
        public_user_id=public_user_id, active=True, user__is_active=False
    ).select_related("user").first()
    if profile and profile.user_id:
        try:
            issue_activation_code(profile.user)
        except ValidationError as exc:
            messages.error(request, exc.messages[0])
        except Exception as exc:
            logger.exception("Activation email resend failed (%s).", type(exc).__name__)
            messages.error(request, "驗證碼寄送失敗，請稍後重試。")
        else:
            if settings.EMAIL_BACKEND == "django.core.mail.backends.console.EmailBackend":
                messages.success(request, "開發模式：驗證碼已輸出至伺服器控制台。")
            elif settings.EMAIL_BACKEND == "django.core.mail.backends.smtp.EmailBackend":
                messages.success(request, f"驗證碼已提交 SMTP 郵件服務至 {mask_email(profile.email or profile.user.email)}。")
            else:
                messages.success(request, "驗證碼已交由目前設定的郵件後端處理。")
    else:
        messages.info(request, "若帳號符合驗證條件，系統會提供重新寄送結果。")
    activation_url = reverse("learning:activate", args=[public_user_id])
    if next_url:
        activation_url = f"{activation_url}?{urlencode({'next': next_url})}"
    return redirect(activation_url)


@require_POST
def resend_activation_by_email(request):
    email = request.POST.get("email", "").strip().lower()
    next_url = _validated_next(request, request.POST.get("next"))
    profile = (
        StudentProfile.objects.filter(
            email__iexact=email,
            active=True,
            user__is_active=False,
        )
        .select_related("user")
        .first()
    )
    if profile and profile.user_id:
        try:
            issue_activation_code(profile.user)
        except ValidationError as exc:
            messages.error(request, exc.messages[0])
        except Exception as exc:
            logger.exception("Activation email resend by login failed (%s).", type(exc).__name__)
            messages.error(request, "驗證碼寄送失敗，請稍後重試。")
        else:
            messages.success(request, "驗證碼已重新寄送，請查看收件匣或垃圾郵件。")
    else:
        messages.info(request, "若帳號符合驗證條件，系統會提供重新寄送結果。")
    login_url = reverse("learning:student_login")
    if next_url:
        login_url = f"{login_url}?{urlencode({'next': next_url})}"
    return redirect(login_url)


class StudentLoginView(LoginView):
    authentication_form = StudentLoginForm
    template_name = "learning/student_login.html"

    def form_valid(self, form):
        response = super().form_valid(form)
        diagnostic = getattr(form, "login_diagnostic", {})
        diagnostic["session_created"] = bool(self.request.session.session_key)
        diagnostic["redirect_url"] = response.headers.get("Location", "")
        logger.info("Student login session diagnostic: %s", diagnostic)
        return response

    def get_success_url(self):
        return self.get_redirect_url() or reverse("learning:student_dashboard")


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
    @wraps(view_func)
    def wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return redirect_to_login(request.get_full_path(), reverse("learning:student_login"))
        if request.user.is_staff:
            return render(request, "learning/role_denied.html", {"required_role": "學員"}, status=403)
        profile = getattr(request.user, "student_profile", None)
        if profile is None or not profile.active:
            return render(request, "learning/role_denied.html", {"required_role": "有效學員帳號"}, status=403)
        request.student_profile = profile
        return view_func(request, *args, **kwargs)

    return wrapped


def teacher_required(view_func):
    @wraps(view_func)
    def wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return redirect_to_login(request.get_full_path(), reverse("learning:teacher_login"))
        if not request.user.is_staff:
            return render(request, "learning/role_denied.html", {"required_role": "教師"}, status=403)
        return view_func(request, *args, **kwargs)

    return wrapped


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
    enrollments = profile.enrollments.filter(active=True).select_related("cohort", "group")
    enrollment_rows = []
    for enrollment in enrollments:
        submissions = ensure_growth_submissions(enrollment)
        enrollment_rows.append(
            {
                "enrollment": enrollment,
                "record_count": len(submissions),
                "submitted_count": sum(item.status in GROWTH_SUBMITTED_STATUSES for item in submissions),
                "reviewed_count": sum(item.status in GROWTH_REVIEWED_STATUSES for item in submissions),
            }
        )
    return render(request, "learning/student_dashboard.html", {"profile": profile, "enrollment_rows": enrollment_rows})


@student_required
def student_growth_entry(request):
    enrollments = list(
        Enrollment.objects.filter(
            student=request.student_profile,
            active=True,
        ).order_by("pk")[:2]
    )
    if len(enrollments) == 1:
        return redirect("learning:student_growth_dashboard", enrollment_id=enrollments[0].pk)
    return redirect("learning:student_dashboard")


@student_required
@require_http_methods(["GET", "POST"])
def join_cohort(request):
    profile = request.student_profile
    if request.method == "POST":
        cohort = Cohort.objects.filter(
            pk=request.POST.get("cohort_id", ""), active=True, teacher_accesses__isnull=False
        ).first()
        if cohort is None:
            messages.error(request, "這門課程目前未開放加入。")
            return redirect("learning:join_cohort")

        with transaction.atomic():
            enrollment, created = Enrollment.objects.get_or_create(student=profile, cohort=cohort)
            if not enrollment.active:
                enrollment.active = True
                enrollment.save(update_fields=["active"])
            if created:
                for task in TaskDefinition.objects.filter(active=True):
                    StudentTaskProgress.objects.get_or_create(enrollment=enrollment, task=task)
                for phase, _ in TaskDefinition.Stage.choices:
                    PhaseProgress.objects.get_or_create(enrollment=enrollment, phase=phase)

        messages.success(request, "已加入課程。" if created else "你已進入這門課程。")
        return redirect("learning:student_course_dashboard", enrollment_id=enrollment.pk)

    cohorts = (
        Cohort.objects.filter(active=True, teacher_accesses__isnull=False)
        .exclude(enrollments__student=profile, enrollments__active=True)
        .distinct()
    )
    return render(request, "learning/join_cohort.html", {"profile": profile, "cohorts": cohorts})


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
    growth_submissions = ensure_growth_submissions(enrollment)
    return render(
        request,
        "learning/student_course_dashboard.html",
        {
            "profile": request.student_profile,
            "enrollment": enrollment,
            "progress": progress,
            "phases": phases,
            "reviewed_count": reviewed_count,
            "growth_submitted_count": sum(
                item.status in GROWTH_SUBMITTED_STATUSES for item in growth_submissions
            ),
            "growth_reviewed_count": sum(
                item.status in GROWTH_REVIEWED_STATUSES for item in growth_submissions
            ),
            "growth_record_count": len(growth_submissions),
            "direction_options": learner_direction_options(),
            "direction_content": direction_content(enrollment, "R07"),
            "direction_overview": direction_overview(),
        },
    )


@student_required
@require_http_methods(["GET", "POST"])
def select_project_direction(request, enrollment_id):
    enrollment = get_object_or_404(Enrollment, pk=enrollment_id, student=request.student_profile, active=True)
    form = ProjectDirectionForm(request.POST or None, initial={"project_direction": enrollment.project_direction})
    if request.method == "POST" and form.is_valid():
        enrollment.project_direction = form.cleaned_data["project_direction"]
        enrollment.save(update_fields=["project_direction"])
        messages.success(request, "本期專案方向已保存。")
        return redirect("learning:student_course_dashboard", enrollment_id=enrollment.pk)
    return render(request, "learning/project_direction_select.html", {"profile": request.student_profile, "enrollment": enrollment, "form": form})


@student_required
def student_growth_dashboard(request, enrollment_id):
    enrollment = get_object_or_404(
        Enrollment.objects.select_related("cohort", "group", "student"),
        pk=enrollment_id,
        student=request.student_profile,
        active=True,
    )
    submissions = ensure_growth_submissions(enrollment)
    records = [
        {
            "submission": submission,
            "display_title": "鷹眼 AI 目標檢測" if submission.definition.slot_id == "R06" else submission.definition.title,
            "content": None if submission.definition.slot_id == "R07" else direction_content(enrollment, submission.definition.slot_id),
            "overview_description": "依專業方向完成本期行業應用任務驗證。" if submission.definition.slot_id == "R07" else "",
            "status_label": student_status_label(submission.status),
            "image_count": submission.evidence.filter(evidence_type=Evidence.Type.IMAGE).count(),
        }
        for submission in submissions
    ]
    return render(
        request,
        "learning/student_growth_dashboard.html",
        {
            "profile": request.student_profile,
            "enrollment": enrollment,
            "records": records,
            "submitted_count": sum(item.status in GROWTH_SUBMITTED_STATUSES for item in submissions),
            "reviewed_count": sum(item.status in GROWTH_REVIEWED_STATUSES for item in submissions),
            "record_count": len(submissions),
            "direction_label": direction_label(enrollment.project_direction),
        },
    )


@student_required
@require_http_methods(["GET", "POST"])
def growth_record_detail(request, enrollment_id, slot_id):
    enrollment = get_object_or_404(
        Enrollment.objects.select_related("cohort", "group", "student"),
        pk=enrollment_id,
        student=request.student_profile,
        active=True,
    )
    submissions = ensure_growth_submissions(enrollment)
    submission = next(
        (item for item in submissions if item.definition.slot_id == slot_id.upper()),
        None,
    )
    if submission is None:
        raise Http404

    images = submission.evidence.filter(evidence_type=Evidence.Type.IMAGE).order_by("created_at")
    videos = submission.evidence.filter(evidence_type=Evidence.Type.VIDEO).order_by("created_at")
    documents = submission.evidence.filter(evidence_type=Evidence.Type.FILE).order_by("created_at")
    video_allowed = submission.definition.slot_id in {f"R0{index}" for index in range(1, 9)}
    document_allowed = submission.definition.slot_id in {"R07", "R08"}
    editable = submission.status in {
        GrowthRecordSubmission.Status.NOT_STARTED,
        GrowthRecordSubmission.Status.IN_PROGRESS,
        GrowthRecordSubmission.Status.NEEDS_REVISION,
    }
    latest_review = submission.reviews.select_related("reviewer").first()
    form = None
    if request.method == "POST":
        video_request_id = request.headers.get("X-FDE-Video-Request-ID", "").strip()
        video_started_at = time.perf_counter()
        if video_request_id:
            logger.info(
                "VIDEO_UPLOAD_REQUEST request_id=%s method=%s content_type=%s content_length=%s files=%s entered_at=%s",
                video_request_id,
                request.method,
                request.META.get("CONTENT_TYPE", ""),
                request.META.get("CONTENT_LENGTH", ""),
                sorted(request.FILES.keys()),
                timezone.now().isoformat(),
            )
        if not editable:
            messages.error(request, "此成長記錄已提交或完成複核，目前唯讀。")
            return redirect("learning:growth_record_detail", enrollment_id=enrollment.pk, slot_id=slot_id)

        action = request.POST.get("action")
        form = GrowthRecordForm(request.POST, request.FILES)
        if form.is_valid():
            new_uploads = form.cleaned_data["images"]
            new_video = form.cleaned_data["video"]
            new_documents = form.cleaned_data["documents"]
            uploaded_videos = request.FILES.getlist("video")
            if uploaded_videos and not video_request_id:
                video_request_id = f"VID-{int(time.time() * 1000)}-{secrets.token_hex(3)}"
                logger.info(
                    "VIDEO_UPLOAD_REQUEST request_id=%s method=%s content_type=%s content_length=%s files=%s entered_at=%s",
                    video_request_id,
                    request.method,
                    request.META.get("CONTENT_TYPE", ""),
                    request.META.get("CONTENT_LENGTH", ""),
                    sorted(request.FILES.keys()),
                    timezone.now().isoformat(),
                )
            if video_request_id and uploaded_videos:
                upload = uploaded_videos[0]
                logger.info(
                    "DJANGO_VIDEO_RECEIVED request_id=%s field=video filename=%s size=%s content_type=%s",
                    video_request_id,
                    Path(str(upload.name)).name,
                    upload.size,
                    getattr(upload, "content_type", ""),
                )
            elif video_request_id:
                logger.warning("DJANGO_VIDEO_NOT_RECEIVED request_id=%s files=%s", video_request_id, sorted(request.FILES.keys()))
            is_summary = submission.definition.slot_id == "R08"
            if len(uploaded_videos) > 1:
                form.add_error("video", "每項成長記錄最多上傳1段影片。")
            elif new_documents and not document_allowed:
                form.add_error(None, "成果檔案只開放於 R07、R08 成長記錄。")
            elif action not in {"save_draft", "submit_review"}:
                form.add_error(None, "無效的保存操作，請重新提交。")
            elif images.count() + len(new_uploads) > 5:
                form.add_error("images", "每項學習成長記錄最多上傳5張照片，請先刪除現有照片再添加。")
            elif (
                action == "submit_review"
                and images.count() + len(new_uploads) + videos.count() + bool(new_video) + documents.count() + len(new_documents) == 0
            ):
                if is_summary:
                    form.add_error(None, "請先上傳至少一項照片、影片或成果檔案，再提交教師複核。")
                else:
                    form.add_error("images", "請先上傳至少一張照片或一段影片，再提交教師複核。")

            processed_images = []
            processed_video = None
            if not form.errors:
                try:
                    processed_images = [process_growth_image(upload) for upload in new_uploads]
                except ValidationError as exc:
                    form.add_error("images", exc.messages[0])
            if not form.errors and new_video:
                try:
                    processed_video = process_growth_video(new_video, request_id=video_request_id)
                except VideoProcessingError as exc:
                    form.add_error("video", exc.user_message)
                    if video_request_id:
                        logger.warning(
                            "VIDEO_UPLOAD_FAILED request_id=%s stage=VIDEO_PROCESSING reason=%s duration_ms=%s",
                            video_request_id,
                            exc.reason,
                            round((time.perf_counter() - video_started_at) * 1000),
                        )
                except Exception:
                    logger.exception(
                        "Growth video upload failed after validation slot=%s enrollment_id=%s",
                        submission.definition.slot_id,
                        enrollment.pk,
                    )
                    form.add_error("video", "影片保存失敗，影片仍保留在待提交清單，請稍後重試。")
                    if video_request_id:
                        logger.exception(
                            "VIDEO_UPLOAD_FAILED request_id=%s stage=VIDEO_PROCESSING duration_ms=%s",
                            video_request_id,
                            round((time.perf_counter() - video_started_at) * 1000),
                        )

            if form.is_valid() and not form.errors:
                submission.student_note = form.cleaned_data["student_note"].strip()
                submission.learning_summary = form.cleaned_data["learning_summary"].strip()
                if action == "submit_review":
                    submission.status = GrowthRecordSubmission.Status.SUBMITTED
                    submission.submitted_at = timezone.now()
                elif submission.status == GrowthRecordSubmission.Status.NOT_STARTED:
                    submission.status = GrowthRecordSubmission.Status.IN_PROGRESS

                created_evidence = []
                try:
                    with transaction.atomic():
                        submission.save()
                        for filename, image_bytes, metadata in processed_images:
                            evidence = Evidence(
                                growth_submission=submission,
                                evidence_type=Evidence.Type.IMAGE,
                                description=submission.definition.title,
                                original_metadata=metadata["original"],
                                processed_metadata=metadata["processed"],
                            )
                            evidence.upload.save(filename, ContentFile(image_bytes), save=True)
                            created_evidence.append(evidence)
                        if processed_video is not None:
                            if video_request_id:
                                logger.info(
                                    "FINAL_FILE_CREATED request_id=%s final_file_size=%s",
                                    video_request_id,
                                    processed_video.path.stat().st_size,
                                )
                                logger.info("EVIDENCE_SAVE_STARTED request_id=%s", video_request_id)
                            old_videos = list(
                                submission.evidence.filter(evidence_type=Evidence.Type.VIDEO)
                            )
                            for old_video in old_videos:
                                old_name = old_video.upload.name
                                old_storage = old_video.upload.storage
                                old_video.delete()
                                transaction.on_commit(
                                    lambda name=old_name, storage=old_storage: storage.delete(name)
                                )
                            video_evidence = Evidence(
                                growth_submission=submission,
                                evidence_type=Evidence.Type.VIDEO,
                                description=submission.definition.title,
                                original_metadata=processed_video.original_metadata,
                                processed_metadata=processed_video.processed_metadata,
                            )
                            with processed_video.path.open("rb") as video_file:
                                video_evidence.upload.save(
                                    f"growth-video-{video_evidence.evidence_id}.mp4",
                                    File(video_file),
                                    save=True,
                                )
                            if video_request_id:
                                logger.info("EVIDENCE_SAVE_PASS request_id=%s", video_request_id)
                            created_evidence.append(video_evidence)
                        for upload in new_documents:
                            original_name = Path(str(upload.name)).name
                            extension = Path(original_name).suffix.lower()
                            document_evidence = Evidence(
                                growth_submission=submission,
                                evidence_type=Evidence.Type.FILE,
                                description=submission.definition.title,
                                original_metadata={
                                    "filename": original_name,
                                    "extension": extension,
                                    "content_type": getattr(upload, "content_type", "") or "",
                                    "size_bytes": upload.size,
                                },
                                processed_metadata={
                                    "filename": original_name,
                                    "extension": extension,
                                    "content_type": getattr(upload, "content_type", "") or "",
                                    "size_bytes": upload.size,
                                },
                            )
                            document_evidence.upload.save(original_name, File(upload), save=True)
                            created_evidence.append(document_evidence)
                except Exception:
                    if video_request_id and processed_video is not None:
                        logger.exception("EVIDENCE_SAVE_FAIL request_id=%s", video_request_id)
                    for evidence in created_evidence:
                        evidence.upload.delete(save=False)
                        evidence.delete()
                    raise
                finally:
                    if processed_video is not None:
                        processed_video.cleanup()

                success_message = "已提交教師複核。" if action == "submit_review" else "成長記錄草稿已保存。"
                if video_request_id:
                    logger.info(
                        "VIDEO_UPLOAD_COMPLETE request_id=%s http_status=%s response_type=%s duration_ms=%s",
                        video_request_id,
                        200,
                        "json" if request.headers.get("x-requested-with") == "XMLHttpRequest" else "redirect",
                        round((time.perf_counter() - video_started_at) * 1000),
                    )
                messages.success(request, success_message)
                if request.headers.get("x-requested-with") == "XMLHttpRequest":
                    return JsonResponse({"ok": True})
                return redirect("learning:growth_record_detail", enrollment_id=enrollment.pk, slot_id=slot_id)
    else:
        form = GrowthRecordForm(
            initial={
                "student_note": submission.student_note,
                "learning_summary": submission.learning_summary,
            }
        )

    if not video_allowed:
        form.fields.pop("video", None)
    if not document_allowed:
        form.fields.pop("documents", None)
    return render(
        request,
        "learning/growth_record_detail.html",
        {
            "profile": request.student_profile,
            "enrollment": enrollment,
            "submission": submission,
            "definition": submission.definition,
            "display_title": "鷹眼 AI 目標檢測" if submission.definition.slot_id == "R06" else submission.definition.title,
            "images": images,
            "videos": videos,
            "documents": documents,
            "image_count": images.count(),
            "video_allowed": video_allowed,
            "document_allowed": document_allowed,
            "form": form,
            "editable": editable,
            "is_summary": submission.definition.slot_id == "R08",
            "latest_review": latest_review,
            "direction_content": direction_content(enrollment, submission.definition.slot_id),
            "direction_label": direction_label(enrollment.project_direction),
            "direction_overview": direction_overview(),
            "content_override": submission.definition.slot_id in {"R06", "R07", "R08"},
            "status_label": student_status_label(submission.status),
            "survey_exists": StudentSurvey.objects.filter(enrollment=enrollment).exists()
            if submission.definition.slot_id == "R08"
            else False,
        },
    )


@student_required
@require_http_methods(["GET", "POST"])
def student_survey(request, enrollment_id):
    enrollment = get_object_or_404(
        Enrollment.objects.select_related("cohort", "group", "student"),
        pk=enrollment_id,
        student=request.student_profile,
        active=True,
    )
    submissions = ensure_growth_submissions(enrollment)
    r08_submission = next(
        (item for item in submissions if item.definition.slot_id == "R08"),
        None,
    )
    if r08_submission is None:
        raise Http404

    survey = StudentSurvey.objects.filter(enrollment=enrollment).first()
    legacy_post = request.method == "POST" and "q1_helpfulness" not in request.POST and "a01" in request.POST
    form = (
        StudentSurveyForm(request.POST, instance=survey)
        if legacy_post
        else StudentSurveyV2Form(request.POST or None, instance=survey)
    )
    if request.method == "POST" and form.is_valid():
        survey = form.save(commit=False) if legacy_post else form.apply_to_survey(survey or StudentSurvey())
        survey.student = request.student_profile
        survey.enrollment = enrollment
        survey.growth_record = r08_submission
        survey.save()
        messages.success(request, "我的下一階段學習方向已保存。")
        return redirect("learning:student_survey", enrollment_id=enrollment.pk)

    return render(
        request,
        "learning/student_survey.html",
        {
            "profile": request.student_profile,
            "enrollment": enrollment,
            "submission": r08_submission,
            "form": form,
            "survey": survey,
        },
    )


@student_required
def student_survey_result(request, enrollment_id):
    enrollment = get_object_or_404(
        Enrollment.objects.select_related("cohort", "group", "student"),
        pk=enrollment_id,
        student=request.student_profile,
        active=True,
    )
    survey = StudentSurvey.objects.filter(enrollment=enrollment).first()
    if survey is None:
        return redirect("learning:student_survey", enrollment_id=enrollment.pk)

    return render(
        request,
        "learning/student_survey_result.html",
        {
            "profile": request.student_profile,
            "enrollment": enrollment,
            "survey": survey,
            "recommendations": recommend_v2_paths(survey) if survey.survey_version == "v2" else recommend_paths(survey),
            "is_v2": survey.survey_version == "v2",
            "contact_notice": survey.contact_opt_in and bool(survey.contact_email),
        },
    )


@student_required
@require_POST
def growth_evidence_delete(request, enrollment_id, slot_id, evidence_id):
    enrollment = get_object_or_404(
        Enrollment, pk=enrollment_id, student=request.student_profile, active=True
    )
    submission = get_object_or_404(
        GrowthRecordSubmission,
        enrollment=enrollment,
        definition__slot_id=slot_id.upper(),
    )
    if submission.status not in {
        GrowthRecordSubmission.Status.NOT_STARTED,
        GrowthRecordSubmission.Status.IN_PROGRESS,
        GrowthRecordSubmission.Status.NEEDS_REVISION,
    }:
        messages.error(request, "只有尚未提交或教師要求補充的照片可以刪除。")
        return redirect("learning:growth_record_detail", enrollment_id=enrollment.pk, slot_id=slot_id)
    allowed_types = [Evidence.Type.IMAGE, Evidence.Type.VIDEO]
    if submission.definition.slot_id in {"R07", "R08"}:
        allowed_types.extend([Evidence.Type.VIDEO, Evidence.Type.FILE])
    evidence = get_object_or_404(
        Evidence, pk=evidence_id, growth_submission=submission, evidence_type__in=allowed_types
    )
    evidence.upload.delete(save=False)
    evidence.delete()
    messages.success(request, "照片或影片已刪除。")
    return redirect("learning:growth_record_detail", enrollment_id=enrollment.pk, slot_id=slot_id)


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
        {
            "task": task,
            "task_content": progress.task_content,
            "progress": progress,
            "enrollment": enrollment,
            "form": form,
            "evidence": progress.evidence.all(),
            "task_display_id": task_display_id(task.task_id),
            "task_status_label": task_status_label(progress.status),
        },
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
        Evidence.objects.select_related(
            "progress__enrollment__student__user",
            "progress__enrollment__cohort",
            "growth_submission__enrollment__student__user",
            "growth_submission__enrollment__cohort",
        ),
        evidence_id=evidence_id,
    )
    enrollment = evidence.enrollment
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
    inline_media = request.GET.get("inline") == "1" and evidence.evidence_type in {
        Evidence.Type.IMAGE,
        Evidence.Type.VIDEO,
    }
    content_type = mimetypes.guess_type(evidence.upload.name)[0] or "application/octet-stream"
    response = FileResponse(
        file_handle,
        as_attachment=not inline_media,
        filename=evidence.upload.name.rsplit("/", 1)[-1],
        content_type=content_type,
    )
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
        enrollments = profile.enrollments.filter(active=True, cohort_id__in=cohorts).select_related("cohort", "group")
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
                    "group": None,
                    "training_source_label": "尚未選擇",
                    "project_direction_label": "尚未選擇",
                    "teacher_verified": False,
                    "teacher_verified_name": "",
                    "growth_submitted_count": 0,
                    "growth_reviewed_count": 0,
                    "growth_pending_count": 0,
                    "growth_record_count": 0,
                    "last_activity": max(
                        (value for value in (profile.user.last_login, profile.created_at) if value),
                        default=None,
                    ),
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
            growth_records = ensure_growth_submissions(enrollment)
            submitted_growth_statuses = {
                GrowthRecordSubmission.Status.SUBMITTED,
                GrowthRecordSubmission.Status.NEEDS_REVISION,
                GrowthRecordSubmission.Status.APPROVED,
                GrowthRecordSubmission.Status.REJECTED,
            }
            reviewed_growth_statuses = {
                GrowthRecordSubmission.Status.NEEDS_REVISION,
                GrowthRecordSubmission.Status.APPROVED,
                GrowthRecordSubmission.Status.REJECTED,
            }
            latest_task_activity = enrollment.task_progress.aggregate(latest=Max("updated_at"))["latest"]
            latest_phase_activity = enrollment.phase_progress.aggregate(latest=Max("updated_at"))["latest"]
            latest_evidence_activity = Evidence.objects.filter(
                Q(progress__enrollment=enrollment) | Q(growth_submission__enrollment=enrollment)
            ).aggregate(latest=Max("created_at"))["latest"]
            last_activity = max(
                (
                    value
                    for value in (
                        profile.user.last_login,
                        enrollment.joined_at,
                        latest_task_activity,
                        latest_phase_activity,
                        latest_evidence_activity,
                        *(record.updated_at for record in growth_records),
                    )
                    if value
                ),
                default=None,
            )
            rows.append(
                {
                    "enrollment": enrollment,
                    "student": profile,
                    "email_masked": mask_email(profile.email),
                    "group": enrollment.group,
                    "training_source_label": enrollment.get_training_source_display() or "尚未選擇",
                    "project_direction_label": direction_label(enrollment.project_direction),
                    "teacher_verified": enrollment.teacher_verified,
                    "teacher_verified_name": enrollment.teacher_verified_name,
                    "reviewed_count": sum(item.status == StudentTaskProgress.Status.REVIEWED for item in items),
                    "total_count": len(items),
                    "submitted_count": sum(item.status == StudentTaskProgress.Status.SUBMITTED for item in items),
                    "incomplete_count": sum(item.status == StudentTaskProgress.Status.INCOMPLETE for item in items),
                    "skipped_count": sum(item.status == StudentTaskProgress.Status.SKIPPED for item in items),
                    "growth_submitted_count": sum(record.status in submitted_growth_statuses for record in growth_records),
                    "growth_reviewed_count": sum(record.status in reviewed_growth_statuses for record in growth_records),
                    "growth_pending_count": sum(
                        record.status == GrowthRecordSubmission.Status.SUBMITTED for record in growth_records
                    ),
                    "growth_record_count": len(growth_records),
                    "last_activity": last_activity,
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
        Enrollment.objects.filter(cohort__in=teacher_cohorts(request.user)).select_related("cohort", "group", "student__user"),
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
    seeded_growth_records = ensure_growth_submissions(enrollment)
    growth_records = list(
        GrowthRecordSubmission.objects.filter(pk__in=[item.pk for item in seeded_growth_records])
        .select_related("definition")
        .prefetch_related("evidence", "reviews__reviewer")
    )
    for record in growth_records:
        review_history = list(record.reviews.all())
        record.latest_review = review_history[0] if review_history else None
        if record.definition.slot_id in {"R06", "R07", "R08"}:
            record.display_content = direction_content(enrollment, record.definition.slot_id)
        else:
            record.display_content = None
    return render(
        request,
        "learning/teacher_student_detail.html",
        {
            "profile": enrollment.student,
            "enrollment": enrollment,
            "email": enrollment.student.email,
            "email_masked": mask_email(enrollment.student.email),
            "progress": progress,
            "phases": ordered_phase_progress(enrollment),
            "growth_records": growth_records,
            "project_direction_label": direction_label(enrollment.project_direction),
            "project_direction_options": learner_direction_options(),
        },
    )


@teacher_required
def teacher_survey_dashboard(request):
    cohorts = teacher_cohorts(request.user)
    selected_cohort = request.GET.get("cohort", "").strip()
    authorized_enrollments = Enrollment.objects.filter(
        active=True,
        cohort__in=cohorts,
    ).select_related("cohort", "student")
    if selected_cohort:
        authorized_enrollments = authorized_enrollments.filter(cohort_id=selected_cohort)
    enrollment_list = list(authorized_enrollments)
    surveys = list(
        StudentSurvey.objects.filter(enrollment__in=enrollment_list)
        .select_related("student", "enrollment__cohort")
        .order_by("-submitted_at")
    )
    filtered_surveys = apply_survey_filters(surveys, request.GET)
    analytics = build_survey_analytics(filtered_surveys)
    analytics_v2 = build_survey_v2_analytics(filtered_surveys)
    completed_count = len(surveys)
    total_count = len(enrollment_list)
    rows = [
        {
            "survey": survey,
            "status": contact_status_label(contact_status(survey)),
            "detail_url": reverse("learning:teacher_survey_detail", args=[survey.enrollment_id]),
        }
        for survey in filtered_surveys
    ]
    analytics.update(
        {
            "total_students": total_count,
            "completed_surveys": completed_count,
            "incomplete_surveys": max(total_count - completed_count, 0),
            "completion_rate": round(completed_count * 100 / total_count, 1) if total_count else 0,
            "filtered_count": len(filtered_surveys),
        }
    )
    return render(
        request,
        "learning/teacher_survey_dashboard.html",
        {
            "cohorts": cohorts,
            "selected_cohort": selected_cohort,
            "selected_filters": request.GET,
            "analytics": analytics,
            "analytics_v2": analytics_v2,
            "rows": rows,
            "path_interest_choices": PATH_INTEREST_CHOICES,
            "g03_choices": StudentSurvey.AdvancedCourseIntent.choices,
            "interest_choices": SURVEY_FUTURE_INTEREST_CHOICES,
            "license_choices": SURVEY_LICENSE_CHOICES,
            "v2_ability_choices": SURVEY_V2_ABILITY_CHOICES,
            "v2_path_choices": SURVEY_V2_PATH_CHOICES,
            "v2_intent_choices": SURVEY_V2_INTENT_CHOICES,
            "v2_course_choices": SURVEY_V2_COURSE_CHOICES,
        },
    )


@teacher_required
def teacher_survey_detail(request, enrollment_id):
    enrollment = get_object_or_404(
        Enrollment.objects.filter(cohort__in=teacher_cohorts(request.user)).select_related("cohort", "student"),
        pk=enrollment_id,
        active=True,
    )
    survey = get_object_or_404(
        StudentSurvey.objects.select_related("student", "enrollment__cohort"),
        enrollment=enrollment,
    )
    answers = [(f"A0{index}", getattr(survey, f"a0{index}")) for index in range(1, 8)]
    answer_labels = dict(PATH_INTEREST_CHOICES)
    v2_answers = survey.v2_responses or {}
    v2_path_labels = dict(SURVEY_V2_PATH_CHOICES)
    v2_ability_labels = dict(SURVEY_V2_ABILITY_CHOICES)
    v2_course_labels = dict(SURVEY_V2_COURSE_CHOICES)
    v2_q1_labels = dict(SURVEY_V2_Q1_CHOICES)
    v2_q2_labels = dict(SURVEY_V2_Q2_CHOICES)
    v2_intent_labels = dict(SURVEY_V2_INTENT_CHOICES)
    return render(
        request,
        "learning/teacher_survey_detail.html",
        {
            "survey": survey,
            "enrollment": enrollment,
            "answers": answers,
            "path_interest_labels": answer_labels,
            "contact_status": contact_status_label(contact_status(survey)),
            "show_contact_email": contact_status(survey) == "contactable",
            "helpful_topics": labels_for(survey.helpful_topics, SURVEY_HELPFUL_TOPIC_CHOICES),
            "future_interests": labels_for(survey.future_interests, SURVEY_FUTURE_INTEREST_CHOICES),
            "license_interest": labels_for(survey.license_interest, SURVEY_LICENSE_CHOICES),
            "course_formats": labels_for(survey.course_format_preferences, SURVEY_FORMAT_CHOICES),
            "course_priorities": labels_for(survey.course_priority_factors, SURVEY_PRIORITY_CHOICES),
            "course_duration": dict(SURVEY_DURATION_CHOICES).get(survey.course_duration_preference, survey.course_duration_preference),
            "is_v2": survey.survey_version == "v2",
            "v2_answers": v2_answers,
            "v2_ability_answers": [v2_ability_labels.get(value, value) for value in v2_answers.get("q6_interests", [])],
            "v2_path_answers": [v2_path_labels.get(value, value) for value in v2_answers.get("q7_paths", [])],
            "v2_course_answers": [v2_course_labels.get(value, value) for value in v2_answers.get("q9_courses", [])],
            "v2_q1_label": v2_q1_labels.get(v2_answers.get("q1_helpfulness", ""), "未填寫"),
            "v2_q2_label": v2_q2_labels.get(v2_answers.get("q2_practice_ratio", ""), "未填寫"),
            "v2_intent_label": v2_intent_labels.get(v2_answers.get("q8_intent", ""), "未填寫"),
        },
    )


@teacher_required
@require_POST
def teacher_toggle_verified(request, enrollment_id):
    enrollment = get_object_or_404(
        Enrollment.objects.filter(cohort__in=teacher_cohorts(request.user)),
        pk=enrollment_id,
        active=True,
    )
    enrollment.teacher_verified = not enrollment.teacher_verified
    enrollment.save(update_fields=["teacher_verified"])
    return redirect(request.POST.get("next") or "learning:teacher_dashboard")


@teacher_required
@require_POST
def teacher_save_identity(request, enrollment_id):
    enrollment = get_object_or_404(
        Enrollment.objects.filter(cohort__in=teacher_cohorts(request.user)),
        pk=enrollment_id,
        active=True,
    )
    form = TeacherIdentityForm(request.POST)
    if form.is_valid():
        enrollment.teacher_verified_name = form.cleaned_data["teacher_verified_name"]
        enrollment.save(update_fields=["teacher_verified_name"])
        messages.success(request, "教師核實姓名已保存。")
    else:
        messages.error(request, "身份資料無效，未保存變更。")
    return redirect("learning:teacher_student_detail", enrollment_id=enrollment.pk)


@teacher_required
@require_POST
def teacher_update_project_direction(request, enrollment_id):
    enrollment = get_object_or_404(
        Enrollment.objects.filter(cohort__in=teacher_cohorts(request.user)), pk=enrollment_id, active=True
    )
    form = ProjectDirectionForm(request.POST)
    if form.is_valid():
        enrollment.project_direction = form.cleaned_data["project_direction"]
        enrollment.save(update_fields=["project_direction"])
        messages.success(request, "學員專案方向已更新。")
    else:
        messages.error(request, "專案方向無效，未保存變更。")
    return redirect("learning:teacher_student_detail", enrollment_id=enrollment.pk)


@teacher_required
@require_POST
def review_growth_record(request, submission_id):
    submission = get_object_or_404(
        GrowthRecordSubmission.objects.filter(
            enrollment__cohort__in=teacher_cohorts(request.user)
        ).select_related("enrollment"),
        pk=submission_id,
    )
    if submission.status != GrowthRecordSubmission.Status.SUBMITTED:
        messages.error(request, "只能複核已提交的成長記錄。")
        return redirect("learning:teacher_student_detail", enrollment_id=submission.enrollment_id)

    form = GrowthRecordReviewForm(request.POST)
    if form.is_valid():
        review_status = form.cleaned_data["review_status"]
        score = form.cleaned_data["score"]
        teacher_note = form.cleaned_data["teacher_note"].strip()
        with transaction.atomic():
            GrowthRecordReview.objects.create(
                submission=submission,
                reviewer=request.user,
                review_status=review_status,
                score=score,
                teacher_note=teacher_note,
            )
            submission.status = review_status
            submission.teacher_final_score = score
            submission.save(update_fields=["status", "teacher_final_score", "updated_at"])
        messages.success(request, "成長記錄複核已保存。")
    else:
        messages.error(request, "複核資料無效，未保存變更。")
    return redirect("learning:teacher_student_detail", enrollment_id=submission.enrollment_id)


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
