import base64
import csv
import datetime
import logging
import mimetypes
import re
import secrets
import time
from functools import wraps
from io import StringIO
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
    GrowthModelForm,
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
    SURVEY_V2_HELPFUL_CHOICES,
    SURVEY_V2_IMPROVEMENT_CHOICES,
    SURVEY_V2_PATH_CHOICES,
    SURVEY_V2_INTENT_CHOICES,
    SURVEY_V2_Q1_CHOICES,
    SURVEY_V2_Q2_CHOICES,
    TeacherIdentityForm,
    TeacherLoginForm,
    TeacherReviewForm,
)
from .vision_submission import submit_model_evidence_to_vision
from . import vision_submission as vision_api
from .vision_rule_templates import template_choices_for_task, template_for_task
from . import prop_scan
from .vision_verification import runner_state
from .external_modules import external_modules_for_stage, all_external_modules
from .golden_set import (
    COMPLETENESS_EVALUATION_READY,
    COMPLETENESS_INCOMPLETE,
    COMPLETENESS_STRUCTURAL,
    GOLDEN_LABELS,
    GOLDEN_SET_CONTRACT_VERSION,
    GOLDEN_TEST_METRIC_FIELDS,
    MIN_SAMPLES_PER_CLASS_FOR_EVALUATION,
    PROP_LABELS,
    SUPPORTED_GOLDEN_TASK_IDS,
    GoldenSetError,
    add_sample,
    completeness_level,
    completeness_reason,
    confirm_sample,
    create_golden_set,
    formal_evaluation_blocked_reason,
    freeze_golden_set,
    golden_set_summary,
    golden_sets_for_teacher,
    manifest_sha256,
    model_golden_test_blocked_reason,
    reject_sample,
)

# 四面懸停的四類固定標籤；與後端 HOVER_CLASSES 完全一致，不得各自為政。
HOVER_LABELS = ("FRONT", "RIGHT", "BACK", "LEFT")
from .vision_flywheel import (
    REVIEW_STATUSES,
    active_switch_blocked_reason,
    build_flywheel_view,
    deployment_status_of,
    review_status_of,
    training_usage_of,
    validation_status_of,
)
from .vision_verification import (
    runner_state,
    verification_blocked_reason,
    verification_ready,
)
from .vision_repository import IntakeError, catalogue_model, records_for_teacher
from .vision_integrity import (
    INTEGRITY_STATUSES,
    STATUS_LABELS as INTEGRITY_STATUS_LABELS,
    run_integrity_check,
    run_integrity_check_for_cohort,
)
from .vision_snapshot import snapshot_usage_report
from .models import (
    CandidatePool,
    Cohort,
    EmailVerificationCode,
    Enrollment,
    Evidence,
    GoldenSet,
    GrowthRecordReview,
    GrowthRecordSubmission,
    PhaseProgress,
    StudentProfile,
    StudentSurvey,
    StudentTaskProgress,
    TaskDefinition,
    TeacherCohortAccess,
    TeacherReviewEvent,
    VisionModelRecord,
)
from .growth_media import process_growth_image
from .growth_video import VideoProcessingError, process_growth_video
from .growth_records import ensure_growth_submissions, growth_record_slot_plan
from .project_directions import (
    direction_content,
    direction_label,
    direction_overview,
    learner_direction_options,
    student_status_label,
    task_display_id,
    task_status_label,
)
from .growth_task_map import (
    STAGE_RECORD_SLOTS,
    task_map_note,
    task_record_slot,
    task_related_records,
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

# P4（2026-10-13 教師指令）：待複核清單排序選項。
# P4.1（2026-10-13 補齊指令）：新增 student_asc（學員名稱 A→Z）、
# record_asc（任務／成長紀錄編號由小到大）。原截斷的第三選項以此兩項落地。
PENDING_SORT_OPTIONS = (
    ("oldest", "提交時間：最早優先"),
    ("newest", "提交時間：最新優先"),
    # P4.2：介面明確標示為字元排序（Unicode 碼位序，非拼音／筆畫序）。
    ("student_asc", "學員名稱（字元排序）"),
    ("record_asc", "紀錄編號由小到大"),
)
DEFAULT_PENDING_SORT = "oldest"

# P4.1 待複核篩選選項（顯示用標籤與內部值）。
PENDING_TYPE_OPTIONS = (
    ("", "全部類型"),
    ("growth", "成長紀錄"),
    ("task", "任務提交"),
)
PENDING_STATUS_OPTIONS = (
    ("all", "全部"),
    ("submitted", "待教師複核"),
    ("needs_revision", "需要補充"),
)
DEFAULT_PENDING_STATUS = "all"
# P4.2 學員進度篩選（五項）。判定一律依既有資料（提交數／待複核紀錄），
# 不代表考核合格與否。
# P5-A：`pending` 的統計單位為「人數」，與班級卡片的「成果筆數」共用同一工作項目集合，
# 故標籤明確標示單位以避免混淆。
PROGRESS_FILTER_OPTIONS = (
    ("", "全部學員"),
    ("none", "尚未提交任何 R01–R08"),
    ("partial", "部分提交（1–7 項）"),
    ("complete", "八項已提交（8 項）"),
    ("pending", "有待複核成果（人數）"),
)
# R01–R08 槽位清單（供待複核「紀錄」篩選；與成長紀錄定義同一組槽位）。
GROWTH_RECORD_SLOT_IDS = tuple(
    slot for slots in STAGE_RECORD_SLOTS.values() for slot in slots
)


def _progress_filter_matches(row, progress_filter):
    """P4.2 學員進度篩選判定（純讀取既有資料，不改統計規則）。

    - none：R01–R08 提交數 0
    - partial：提交數 1–7
    - complete：提交數 8
    - pending：至少一筆真實待複核紀錄（該學員有 status=submitted 的成長紀錄，
      與矩陣／進度列表顯示的「待複核」數同一來源）
    """
    submitted = row["submitted_count"]
    if progress_filter == "none":
        return submitted == 0
    if progress_filter == "partial":
        return 1 <= submitted <= 7
    if progress_filter == "complete":
        return submitted == 8
    if progress_filter == "pending":
        return row["pending_count"] > 0
    return True


# ── P5-A（2026-10-13 教師指令）：統一「待複核」口徑 ─────────────────────────
# 教師發現：班級卡片「待複核成果」含成長紀錄＋任務提交，但學員篩選 pending
# 只計入成長紀錄，可能出現「卡片 1 筆、篩選 0 位學員」的不一致。
# 修正原則：建立**單一工作項目集合**，兩種檢視共用同一集合，僅單位不同：
#   - 班級卡片／清單：統計「成果筆數」
#   - 學員進度篩選：統計「涉及人數」
# 每一項目一律標示資料來源（成長紀錄／任務提交），不以名稱合併。
#
# 三組明確定義（一律依既有資料判定，不新增狀態、不改提交或複核流程）：
#   1. 待教師複核（pending_review）：已提交且尚無有效教師複核。
#      成長紀錄 status=submitted（GrowthRecordReview 於複核時才建立）；
#      任務 status=submitted。
#   2. 需要補充（needs_revision）：教師已複核且判定需補充。
#      成長紀錄 status=needs_revision（必有 GrowthRecordReview 紀錄）。
#   3. 已複核（reviewed）：已有有效教師複核紀錄。
#      成長紀錄 status ∈ {needs_revision, approved, rejected}（review_growth_record
#      於同一交易內建立 GrowthRecordReview 並同步 status，故兩者一致）；
#      任務 status=reviewed。
PENDING_WORK_GROUPS = (
    ("pending_review", "待教師複核"),
    ("needs_revision", "需要補充"),
)
PENDING_WORK_GROUP_LABELS = dict(PENDING_WORK_GROUPS)
# 資料來源顯示標籤（內部 kind 值沿用既有清單，不新增第二套命名）。
PENDING_SOURCE_LABELS = {"成長紀錄": "成長紀錄", "任務": "任務提交"}


def pending_work_group(status_key):
    """P5-A：狀態 → 待複核工作分組（待教師複核／需要補充／已複核）。"""
    if status_key == GrowthRecordSubmission.Status.SUBMITTED:
        return "pending_review"
    if status_key == GrowthRecordSubmission.Status.NEEDS_REVISION:
        return "needs_revision"
    return "reviewed"


def build_pending_work_item(
    *,
    kind,
    code,
    title,
    student,
    submitted_at,
    status_key,
    url,
    task_id=None,
    record_slots=(),
):
    """P5-A：建立單一格式的待複核工作項目（兩種檢視共用，避免口徑分歧）。

    `source_label` 明確標示資料來源；任務另帶 P2 權威對應表的 R 槽位
    （`record_slots`），供紀錄篩選與「不依名稱合併」的關聯判定使用。
    """
    return {
        "kind": kind,
        "source_label": PENDING_SOURCE_LABELS.get(kind, kind),
        "code": code,
        "title": title,
        "student": student,
        "submitted_at": submitted_at,
        "status_key": status_key,
        "status_label": student_status_label(status_key),
        "group": pending_work_group(status_key),
        "group_label": PENDING_WORK_GROUP_LABELS.get(pending_work_group(status_key), ""),
        "url": url,
        "task_id": task_id,
        "record_slots": tuple(record_slots),
    }


# 時間遺逝項目排序用的 aware 下限值（避免 naive/aware 比較錯誤）。
PENDING_TIME_FLOOR = datetime.datetime.min.replace(tzinfo=datetime.timezone.utc)


def _pending_name_key(row):
    """學員名稱 A→Z 主鍵（空暱稱以 FDE ID 兜底，附 FDE ID 保證全序）。"""
    student = row["student"]
    nickname = (student.nickname or "").strip()
    return ((nickname or student.public_user_id).lower(), student.public_user_id)


def _pending_record_key(row):
    """紀錄編號由小到大：R 群先於 M 群，各群內數字由小到大。"""
    code = (row.get("code") or "").upper()
    prefix = code[:1]
    digits = code[1:]
    group = 0 if prefix == "R" else 1
    try:
        number = int(digits)
    except ValueError:
        number = 10 ** 6
    return (group, number, code)


def _pending_time_key(row):
    """提交時間鍵：缺失值一律排在最後（各排序方向皆同）。"""
    stamp = row["submitted_at"]
    return (stamp is None, stamp if stamp is not None else PENDING_TIME_FLOOR)


def sort_pending_rows(rows, pending_sort):
    """P4.1 待複核排序：主鍵＋穩定次要鍵（學員名稱→紀錄編號→提交時間）。

    任意兩列皆有全序，相同名稱或相同時間不會造成顯示順序不固定；
    提交時間缺失者在所有排序方向下皆排最後。
    """
    ordered = list(rows)
    ordered.sort(key=_pending_time_key)      # 第三鍵：提交時間（缺失最後）
    ordered.sort(key=_pending_record_key)    # 第二鍵：紀錄編號
    ordered.sort(key=_pending_name_key)      # 第二鍵：學員名稱
    if pending_sort == "student_asc":
        ordered.sort(key=_pending_name_key)
    elif pending_sort == "record_asc":
        ordered.sort(key=_pending_record_key)
    else:
        stamped = [row for row in ordered if row["submitted_at"] is not None]
        unstamped = [row for row in ordered if row["submitted_at"] is None]
        stamped.sort(key=lambda row: row["submitted_at"], reverse=(pending_sort == "newest"))
        ordered = stamped + unstamped
    return ordered


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
        # I2-C：讓學員從平台／模組頁能回到五階段工作台（不繞過權限，入口本身會導向登入）。
        "workbench_url": reverse("learning:student_learning_path_entry"),
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
    model_evidence = submission.evidence.filter(evidence_type=Evidence.Type.MODEL).order_by("-created_at")
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
            "model_evidence": model_evidence,
            "model_upload_allowed": (
                submission.definition.slot_id == "R07"
                and enrollment.project_direction == "ai_flight_assessment"
            ),
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
@require_POST
def growth_model_upload(request, enrollment_id):
    """保存 R07 MODEL 證據並接入既有 Vision Submission 審核鏈。"""
    enrollment = get_object_or_404(
        Enrollment.objects.select_related("cohort", "group", "student"),
        pk=enrollment_id,
        student=request.student_profile,
        active=True,
    )
    submissions = ensure_growth_submissions(enrollment)
    submission = next((item for item in submissions if item.definition.slot_id == "R07"), None)
    redirect_url = reverse("learning:growth_record_detail", args=[enrollment.pk, "R07"])
    if submission is None or enrollment.project_direction != "ai_flight_assessment":
        messages.error(request, "此專業方向不開放模型成果上傳。")
        return redirect(redirect_url)
    if submission.status not in {
        GrowthRecordSubmission.Status.NOT_STARTED,
        GrowthRecordSubmission.Status.IN_PROGRESS,
        GrowthRecordSubmission.Status.NEEDS_REVISION,
    }:
        messages.error(request, "此成長記錄已提交或完成複核，目前唯讀。")
        return redirect(redirect_url)

    form = GrowthModelForm(request.POST, request.FILES)
    if not form.is_valid():
        messages.error(request, "模型提交失敗：請選擇有效的 best.pt。")
        return redirect(redirect_url)

    upload = form.cleaned_data["model_file"]
    original_name = Path(str(upload.name)).name
    content = upload.read()
    evidence = None
    stored_name = ""
    storage = None
    try:
        with transaction.atomic():
            evidence = Evidence(
                growth_submission=submission,
                evidence_type=Evidence.Type.MODEL,
                description="R07 AI Vision / YOLO 訓練模型",
                original_metadata={
                    "filename": original_name,
                    "extension": ".pt",
                    "content_type": getattr(upload, "content_type", "") or "",
                    "size_bytes": upload.size,
                    "task_type": "PROP_DIRECTION",
                    "evidence_type": "YOLO_MODEL",
                },
            )
            evidence.upload.save(original_name, ContentFile(content), save=True)
            stored_name = evidence.upload.name
            storage = evidence.upload.storage
            vision_submission = submit_model_evidence_to_vision(
                task_type="PROP_DIRECTION",
                student_id=enrollment.student.public_user_id,
                group_id=enrollment.group.code if enrollment.group else "UNGROUPED",
                growth_record_id=submission.pk,
                growth_record_slot="R07",
                evidence_reference=str(evidence.evidence_id),
                evidence_type="YOLO_MODEL",
                original_filename=original_name,
                content=content,
                notes=submission.student_note,
            )
            evidence.processed_metadata = {
                **evidence.original_metadata,
                "vision_submission_id": vision_submission["submission_id"],
                "submission_status": vision_submission["status"],
            }
            evidence.save(update_fields=["processed_metadata"])
            if submission.status == GrowthRecordSubmission.Status.NOT_STARTED:
                submission.status = GrowthRecordSubmission.Status.IN_PROGRESS
                submission.save(update_fields=["status", "updated_at"])
    except Exception:
        if stored_name and storage:
            storage.delete(stored_name)
        logger.exception("R07 model submission failed enrollment_id=%s", enrollment.pk)
        messages.error(request, "模型提交失敗，請確認 Vision 服務後重試。")
        return redirect(redirect_url)

    messages.success(request, "best.pt 已提交，狀態：等待教師審核。")
    return redirect(redirect_url)


# ---- 學員手機端靜態圖片辨識（PROP_DIRECTION_V1） ----
# 安全邊界：本視圖永不載入 .pt。沒有通過隔離審查的推論 Runner 時，
# 一律回傳 WAITING_FOR_MODEL／BLOCKED，不顯示假檢測框、假可信度或假 PASS。
PROP_SCAN_MAX_IMAGE_BYTES = 8 * 1024 * 1024


def _prop_scan_gate() -> dict:
    """彙整「現在能不能產生真實辨識結果」的閘門狀態。"""
    runner = runner_state()
    model = prop_scan.model_status()
    if not runner.get("available"):
        return {
            "can_infer": False,
            "state": "BLOCKED",
            "state_label": "無法推論",
            "reason": runner.get("reason", ""),
            "detail": runner.get("required_for_enable", ""),
            "runner": runner,
            "model": model,
        }
    if model["status"] != "READY":
        state = model["status"] if model["status"] in {"BLOCKED", "WAITING_FOR_MODEL"} else "BLOCKED"
        return {
            "can_infer": False,
            "state": state,
            "state_label": model.get("label", "等待合格模型"),
            "reason": model["reason"],
            "detail": model["next_step"],
            "runner": runner,
            "model": model,
        }
    return {
        "can_infer": True,
        "state": "READY",
        "state_label": "可推論",
        "reason": "",
        "detail": "",
        "runner": runner,
        "model": model,
    }


@student_required
@require_http_methods(["GET", "POST"])
def student_prop_scan(request, enrollment_id):
    """學員上傳單張照片做槳葉方向辨識。

    GET：顯示上傳介面與已確認的馬達規則對照表。
    POST：只有在閘門允許時才呼叫真實推論；否則明確回報 BLOCKED。
    """
    enrollment = get_object_or_404(
        Enrollment.objects.select_related("cohort", "group", "student"),
        pk=enrollment_id,
        student=request.student_profile,
        active=True,
    )
    gate = _prop_scan_gate()
    context = {
        "enrollment": enrollment,
        "gate": gate,
        "rule_table": prop_scan.rule_table(),
        "motor_ids": list(prop_scan.MOTOR_IDS),
        "result": None,
        "uploaded_name": "",
        "uploaded_data_url": "",
        "error": "",
    }

    if request.method != "POST":
        return render(request, "learning/student_prop_scan.html", context)

    upload = request.FILES.get("photo")
    if upload is None:
        context["error"] = "請先選擇一張照片。"
        return render(request, "learning/student_prop_scan.html", context)

    if upload.size > PROP_SCAN_MAX_IMAGE_BYTES:
        context["error"] = "照片超過 8 MB，請縮小後再上傳。"
        return render(request, "learning/student_prop_scan.html", context)

    content_type = (getattr(upload, "content_type", "") or "").lower()
    if not content_type.startswith("image/"):
        context["error"] = "僅接受圖片檔案。"
        return render(request, "learning/student_prop_scan.html", context)

    content = upload.read()
    context["uploaded_name"] = Path(str(upload.name)).name
    context["uploaded_data_url"] = "data:{};base64,{}".format(
        content_type or "image/jpeg", base64.b64encode(content).decode("ascii")
    )

    if not gate["can_infer"]:
        # 明確阻擋：不產生任何辨識框、可信度或 PASS。
        context["error"] = gate["reason"]
        context["result"] = {
            "state": gate["state"],
            "state_label": gate["state_label"],
            "detail": gate["detail"],
        }
        return render(request, "learning/student_prop_scan.html", context)

    # 閘門通過才呼叫真實推論（Runner 由 live_backend 隔離環境提供）。
    try:
        inference = _run_prop_inference(content, context["uploaded_name"])
    except prop_scan.PropScanBlocked as blocked:
        context["result"] = {"state": "BLOCKED", "state_label": "無法推論",
                             "detail": blocked.message, "code": blocked.code}
        context["error"] = blocked.message
        return render(request, "learning/student_prop_scan.html", context)

    detections = inference["detections"]
    evaluation = inference["evaluation"]
    explanation = prop_scan.build_explanation(evaluation["checks"], evaluation["status"])
    context["result"] = {
        "state": "READY",
        "detections": detections,
        "evaluation": evaluation,
        "explanation": explanation,
        "simulation_mode": inference.get("simulation_mode", False),
        "result_label": inference.get("result_label", ""),
        "model": inference.get("model") or {},
    }
    return render(request, "learning/student_prop_scan.html", context)


def _run_prop_inference(image_bytes: bytes, file_name: str) -> dict:
    """呼叫既有 prop-check，並只轉譯真實檢測與規則引擎結果。"""
    try:
        response = vision_api.prop_check(
            image_bytes=image_bytes, input_reference=file_name
        )
    except RuntimeError as exc:
        message = str(exc)
        code = "INVALID_IMAGE" if message == "invalid_image" else "VISION_API_UNAVAILABLE"
        detail = "照片無法解碼，請改用有效的 JPG、JPEG 或 PNG。" if code == "INVALID_IMAGE" else "Vision API 推論失敗，未產生任何辨識結果。"
        raise prop_scan.PropScanBlocked(code, detail) from exc

    if not isinstance(response, dict) or not response.get("model"):
        raise prop_scan.PropScanBlocked(
            "ACTIVE_MODEL_NOT_RESOLVED", "Vision API 未解析到合格的 ACTIVE 模型。"
        )

    detections = []
    for item in response.get("detections") or []:
        class_name = str(item.get("class") or item.get("className") or "").strip()
        box = item.get("bbox") or item.get("box")
        confidence = item.get("confidence")
        if class_name not in prop_scan.PROP_CLASS_CONTRACT:
            raise prop_scan.PropScanBlocked(
                "CLASS_CONTRACT_MISMATCH", "推論結果包含不符合四類契約的類別。"
            )
        if not isinstance(box, list) or len(box) != 4 or not isinstance(confidence, (int, float)):
            raise prop_scan.PropScanBlocked(
                "INVALID_INFERENCE_RESULT", "Vision API 回傳的辨識框或信心值格式無效。"
            )
        detections.append({
            "class_name": class_name,
            "confidence": round(float(confidence), 6),
            "box": [float(value) for value in box],
        })

    checks = []
    for motor in prop_scan.MOTOR_IDS:
        item = (response.get("positions") or {}).get(motor) or {}
        expected = str(item.get("expected") or "")
        expected_parts = expected.split("_", 1)
        checks.append({
            "motor": motor,
            "position": prop_scan.MOTOR_POSITIONS[motor],
            "result": item.get("result", "INSUFFICIENT_DATA"),
            "detected_class": item.get("detected"),
            "confidence": item.get("confidence"),
            "expected_direction": expected_parts[0] if len(expected_parts) == 2 else None,
            "expected_face": expected_parts[1] if len(expected_parts) == 2 else None,
            "reason": item.get("reason", "無法取得規則判定。"),
            "reason_code": item.get("reason_code", "MISSING_RESULT"),
        })
    status = response.get("final_result")
    if status not in {"PASS", "NG", "INSUFFICIENT_DATA"}:
        raise prop_scan.PropScanBlocked(
            "INVALID_RULE_RESULT", "Vision API 未回傳有效的 PASS／NG 規則判定。"
        )
    results = [item["result"] for item in checks]
    return {
        "detections": detections,
        "simulation_mode": response.get("simulation_mode") is True,
        "result_label": response.get("result_label") or "",
        "model": response.get("model") or {},
        "evaluation": {
            "status": status,
            "checks": checks,
            "pass_count": results.count("PASS"),
            "ng_count": results.count("NG"),
            "insufficient_count": results.count("INSUFFICIENT_DATA"),
        },
    }


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
            "selected_career_paths": [
                path
                for path in (survey.v2_responses or {}).get("q7_paths", [])
                if path in {"industry_pilot", "fpv_professional", "seed_instructor", "software_engineer"}
            ] if survey.survey_version == "v2" else [],
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


# 只取回教師被授權班級的學員模型證據。
def teacher_model_evidence_queryset(user):
    return (
        Evidence.objects.filter(
            evidence_type=Evidence.Type.MODEL,
            growth_submission__enrollment__cohort__in=teacher_cohorts(user),
        )
        .select_related(
            "growth_submission__enrollment__cohort",
            "growth_submission__enrollment__group",
            "growth_submission__enrollment__student__user",
        )
        .order_by("-created_at")
    )


@teacher_required
def teacher_vision_model_list(request):
    models = list(teacher_model_evidence_queryset(request.user))
    task_labels = {
        "PROP_DIRECTION": "槳葉方向",
        "FOUR_SIDE_HOVER": "四面懸停",
    }
    for evidence in models:
        enrollment = evidence.growth_submission.enrollment
        evidence.task_type = evidence.original_metadata.get("task_type", "")
        evidence.task_label = task_labels.get(evidence.task_type, evidence.task_type or "未設定")
        evidence.filename = evidence.original_metadata.get("filename", "best.pt")
        evidence.group_label = (
            f"{enrollment.group.code}｜{enrollment.group.name}"
            if enrollment.group_id
            else "未設定"
        )
        evidence.is_demo_test_only = bool(
            evidence.original_metadata.get("is_demo_test_only")
            or evidence.processed_metadata.get("is_demo_test_only")
            or "DEMO_TEST_ONLY" in evidence.filename.upper()
        )
        evidence.review = evidence.processed_metadata.get("vision_model_review", {})
        evidence.review_status = review_status_of(evidence)
        evidence.validation_status = validation_status_of(evidence)
        evidence.training_usage = training_usage_of(evidence)
        evidence.deployment_status = deployment_status_of(evidence)

    selected_evidence = None
    selected_id = str(request.GET.get("model") or "").strip()
    if selected_id:
        selected_evidence = next(
            (evidence for evidence in models if str(evidence.pk) == selected_id),
            None,
        )

    api_online, api_detail = vision_api.vision_api_health()
    registry_models = []
    if api_online:
        try:
            registry_models = [_vision_model_row(item) for item in (vision_api.list_models() or [])]
        except RuntimeError as exc:
            api_online = False
            api_detail = str(exc)

    active_models = [item for item in registry_models if item["status"] == "ACTIVE"]
    activation_models = [
        item
        for item in registry_models
        if item["validation_status"] == "VALIDATED" and item["status"] != "ARCHIVED"
    ]
    repository_records = list(
        records_for_teacher(request.user)
        .select_related("student", "cohort", "evidence")
        .order_by("-created_at")
    )
    selected_repository = _repository_view_of(selected_evidence) if selected_evidence else None
    selected_catalogue_reason = (
        _catalogue_blocked_reason(selected_evidence) if selected_evidence else ""
    )
    selected_verify_reason = (
        verification_blocked_reason(selected_evidence) if selected_evidence else ""
    )
    if selected_evidence and selected_evidence.is_demo_test_only:
        selected_verify_reason = "DEMO_TEST_ONLY 僅供流程展示，不得執行真實模型推論。"

    return render(
        request,
        "learning/teacher_vision_model_list.html",
        {
            "models": models,
            "selected_evidence": selected_evidence,
            "selected_repository": selected_repository,
            "selected_catalogue_reason": selected_catalogue_reason,
            "selected_verify_reason": selected_verify_reason,
            "api_online": api_online,
            "api_detail": api_detail,
            "registry_models": registry_models,
            "active_models": active_models,
            "activation_models": activation_models,
            "repository_records": repository_records,
        },
    )


@teacher_required
def teacher_vision_model_detail(request, evidence_id):
    evidence = get_object_or_404(teacher_model_evidence_queryset(request.user), pk=evidence_id)
    task_type = evidence.original_metadata.get("task_type", "")
    return render(
        request,
        "learning/teacher_vision_model_detail.html",
        {
            "evidence": evidence,
            "task_type": task_type,
            "template_choices": template_choices_for_task(task_type),
            "review": evidence.processed_metadata.get("vision_model_review", {}),
            "review_status": review_status_of(evidence),
            "validation_status": validation_status_of(evidence),
            "training_usage": training_usage_of(evidence),
            "deployment_status": deployment_status_of(evidence),
            "active_blocked_reason": active_switch_blocked_reason(evidence),
            "flywheel": build_flywheel_view(evidence),
            "runner": runner_state(),
            "verification_blocked_reason": verification_blocked_reason(evidence),
            "repository": _repository_view_of(evidence),
            "catalogue_blocked_reason": _catalogue_blocked_reason(evidence),
        },
    )


def _repository_view_of(evidence):
    """取得此證據的倉庫紀錄（若已入庫）；未入庫回傳 None。"""
    return VisionModelRecord.objects.filter(evidence=evidence).first()


def _catalogue_blocked_reason(evidence) -> str:
    """判斷目前是否可收藏入庫；回傳空字串代表可收藏。"""
    if _repository_view_of(evidence) is not None:
        return "此模型已入庫，無需重複收藏。"
    review = dict(evidence.processed_metadata.get("vision_model_review") or {})
    if str(review.get("status") or "") != "CANDIDATE":
        return "需先由教師列為候選，才可收藏至模型倉庫。"
    return ""


@teacher_required
@require_POST
def teacher_vision_model_catalogue(request, evidence_id):
    """教師收藏模型至倉庫：完成完整性檢查後建立 VisionModelRecord。

    僅允許已通過教師審核（CANDIDATE）的模型入庫。
    入庫不等於 VALIDATED 或 ACTIVE；一律以保守預設建立。
    檢查期間不載入、不反序列化 .pt。
    """
    evidence = get_object_or_404(teacher_model_evidence_queryset(request.user), pk=evidence_id)
    blocked = _catalogue_blocked_reason(evidence)
    if blocked:
        messages.error(request, f"無法收藏至模型倉庫：{blocked}")
        return redirect("learning:teacher_vision_model_detail", evidence_id=evidence.pk)

    model_version = request.POST.get("model_version", "V1").strip() or "V1"
    parent_id = request.POST.get("parent_record_id", "").strip()
    parent_record = None
    if parent_id:
        parent_record = VisionModelRecord.objects.filter(
            pk=parent_id, cohort_id=evidence.enrollment.cohort_id
        ).first()
        if parent_record is None:
            messages.error(request, "無法收藏至模型倉庫：指定的父版本不存在或不屬於同一班級。")
            return redirect("learning:teacher_vision_model_detail", evidence_id=evidence.pk)

    try:
        record = catalogue_model(
            evidence=evidence,
            teacher=request.user,
            model_version=model_version,
            parent_record=parent_record,
        )
    except IntakeError as exc:
        messages.error(request, f"無法收藏至模型倉庫：{exc.message}（{exc.code}）")
        return redirect("learning:teacher_vision_model_detail", evidence_id=evidence.pk)
    except ValidationError as exc:
        detail = "；".join(exc.messages) if hasattr(exc, "messages") else str(exc)
        messages.error(request, f"無法收藏至模型倉庫：{detail}")
        return redirect("learning:teacher_vision_model_detail", evidence_id=evidence.pk)

    messages.success(request, f"模型已入庫（{record.model_version}）。入庫不代表已驗證或已啟用。")
    return redirect("learning:teacher_vision_model_detail", evidence_id=evidence.pk)


@teacher_required
def teacher_vision_model_verify(request, evidence_id):
    """教師圖片測試頁；無安全 Runner 時僅顯示停用狀態，不執行推論。

    流程：教師後台 → 學員 R07 → best.pt → 模型詳情 → 圖片測試。
    沒有可用模型或安全推論服務時顯示 WAITING_FOR_MODEL 或 BLOCKED。
    """
    evidence = get_object_or_404(teacher_model_evidence_queryset(request.user), pk=evidence_id)
    runner = runner_state()
    model = prop_scan.model_status()
    if not runner.get("available"):
        gate_state, gate_reason, gate_detail = "BLOCKED", runner.get("reason", ""), runner.get("required_for_enable", "")
    elif model["status"] != "READY":
        gate_state, gate_reason, gate_detail = "WAITING_FOR_MODEL", model["reason"], model["next_step"]
    else:
        gate_state, gate_reason, gate_detail = "READY", "", ""
    return render(
        request,
        "learning/teacher_vision_verify.html",
        {
            "evidence": evidence,
            "task_type": evidence.original_metadata.get("task_type", ""),
            "review_status": review_status_of(evidence),
            "blocked_reason": verification_blocked_reason(evidence),
            "verification_ready": verification_ready(evidence),
            "runner": runner,
            "gate_state": gate_state,
            "gate_reason": gate_reason,
            "gate_detail": gate_detail,
            "test_records": list(evidence.processed_metadata.get("vision_test_records") or []),
        },
    )


@teacher_required
@require_POST
def teacher_vision_model_verify_run(request, evidence_id):
    """執行圖片驗證（本輪停用）。無安全 Runner 時直接拒絕，不得偽造結果。"""
    evidence = get_object_or_404(teacher_model_evidence_queryset(request.user), pk=evidence_id)
    blocked = verification_blocked_reason(evidence)
    if blocked:
        messages.error(request, f"目前無法執行圖片驗證：{blocked}")
        return redirect("learning:teacher_vision_model_verify", evidence_id=evidence.pk)
    # 安全 Runner 就緒後，才會在此串接隔離環境；本輪不得載入學員 .pt。
    messages.error(request, "圖片驗證 Runner 尚未接入，未執行任何推論。")
    return redirect("learning:teacher_vision_model_verify", evidence_id=evidence.pk)


@teacher_required
@require_POST
def teacher_vision_model_integrity_check(request, model_id):
    """對單一倉庫紀錄執行檔案完整性檢查。

    只更新檢查欄位，**不刪除、不覆蓋、不自動切換 ACTIVE**，亦不載入 .pt。
    """
    record = get_object_or_404(records_for_teacher(request.user), pk=model_id)
    result = run_integrity_check(record)
    label = INTEGRITY_STATUS_LABELS.get(result["status"], result["status"])
    if result["status"] == "INTACT":
        messages.success(request, f"完整性檢查完成：{label}。")
    else:
        messages.warning(
            request,
            f"完整性檢查完成：{label}。{result['reason']}此模型不得作為訓練基底或發布。",
        )
    return redirect("learning:teacher_vision_flywheel")


@teacher_required
@require_POST
def teacher_vision_integrity_check_all(request):
    """對教師可見範圍內的所有倉庫紀錄批次執行完整性檢查。"""
    summary = run_integrity_check_for_cohort(request.user)
    counts = summary["summary"]
    messages.success(
        request,
        "完整性檢查完成：共 {checked} 筆，完整 {intact}／檔案不存在 {missing}／"
        "內容已變動 {modified}／尚未檢查 {not_checked}。".format(
            checked=summary["checked"],
            intact=counts.get("INTACT", 0),
            missing=counts.get("MISSING", 0),
            modified=counts.get("MODIFIED", 0),
            not_checked=counts.get("NOT_CHECKED", 0),
        ),
    )
    return redirect("learning:teacher_vision_flywheel")


@teacher_required
def teacher_vision_flywheel(request):
    """資料飛輪倉庫框架頁；顯示既有模型與飛輪欄位，不發布任何學生資源。"""
    models = list(teacher_model_evidence_queryset(request.user))
    rows = []
    for evidence in models:
        view = build_flywheel_view(evidence)
        view["review_status"] = review_status_of(evidence)
        view["validation_status"] = validation_status_of(evidence)
        view["training_usage"] = training_usage_of(evidence)
        view["deployment_status"] = deployment_status_of(evidence)
        view["evidence_id"] = evidence.pk
        rows.append(view)
    # 已入庫紀錄：教師可在倉庫清單查看。僅限已授權班級。
    records = list(
        records_for_teacher(request.user)
        .select_related("student", "cohort", "parent_record", "lineage_root")
        .order_by("-created_at")
    )
    return render(
        request,
        "learning/teacher_vision_flywheel.html",
        {
            "rows": rows,
            "records": records,
            "record_count": len(records),
            "review_statuses": REVIEW_STATUSES,
            "integrity_statuses": INTEGRITY_STATUSES,
            "integrity_labels": INTEGRITY_STATUS_LABELS,
            "snapshot_usage": snapshot_usage_report(),
            "runner": runner_state(),
        },
    )


@teacher_required
@require_POST
def teacher_vision_model_review(request, evidence_id):
    evidence = get_object_or_404(teacher_model_evidence_queryset(request.user), pk=evidence_id)
    task_type = evidence.original_metadata.get("task_type", "")
    template = template_for_task(task_type)
    action = request.POST.get("action", "").strip()
    template_id = request.POST.get("rule_template_id", "").strip()
    if template is None or template_id != template["template_id"] or action not in {"candidate", "return"}:
        return HttpResponse("無效的模型審核操作。", status=400)

    status = "CANDIDATE" if action == "candidate" else "RETURNED"
    note = request.POST.get("note", "").strip()
    metadata = dict(evidence.processed_metadata or {})
    previous = dict(metadata.get("vision_model_review") or {})
    history = list(previous.get("history") or [])
    teacher_name = request.user.get_full_name().strip() or request.user.get_username()
    history.append(
        {
            "action": status,
            "teacher_id": str(request.user.pk),
            "teacher_name": teacher_name,
            "note": note,
            "at": timezone.now().isoformat(),
        }
    )
    metadata["vision_model_review"] = {
        "status": status,
        "task_type": task_type,
        "rule_template_id": template["template_id"],
        "current_note": note,
        "history": history,
    }
    evidence.processed_metadata = metadata
    evidence.save(update_fields=["processed_metadata"])
    messages.success(request, "模型審核結果已保存。")
    return redirect("learning:teacher_vision_model_detail", evidence_id=evidence.pk)

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
    r08_survey = StudentSurvey.objects.filter(enrollment=enrollment).first()
    r08_answers = (r08_survey.v2_responses or {}) if r08_survey and r08_survey.survey_version == "v2" else {}
    r08_q1_labels = dict(SURVEY_V2_Q1_CHOICES)
    r08_q2_labels = dict(SURVEY_V2_Q2_CHOICES)
    r08_intent_labels = dict(SURVEY_V2_INTENT_CHOICES)
    r08_path_labels = dict(SURVEY_V2_PATH_CHOICES)
    r08_course_labels = dict(SURVEY_V2_COURSE_CHOICES)
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
            "r08_survey": r08_survey,
            "r08_is_v2": bool(r08_survey and r08_survey.survey_version == "v2"),
            "r08_answers": r08_answers,
            "r08_selected_career_paths": r08_answers.get("q7_paths", []),
            "r08_selected_course_paths": r08_answers.get("q9_courses", []),
            "r08_q1_label": r08_q1_labels.get(r08_answers.get("q1_helpfulness", ""), "未填寫"),
            "r08_q2_label": r08_q2_labels.get(r08_answers.get("q2_practice_ratio", ""), "未填寫"),
            "r08_q3_labels": labels_for(r08_answers.get("q3_topics", []), SURVEY_V2_HELPFUL_CHOICES),
            "r08_q4_labels": labels_for(r08_answers.get("q4_improvements", []), SURVEY_V2_IMPROVEMENT_CHOICES),
            "r08_q6_labels": labels_for(r08_answers.get("q6_interests", []), SURVEY_V2_ABILITY_CHOICES),
            "r08_q7_labels": labels_for(r08_answers.get("q7_paths", []), SURVEY_V2_PATH_CHOICES),
            "r08_q9_labels": labels_for(r08_answers.get("q9_courses", []), SURVEY_V2_COURSE_CHOICES),
            "r08_intent_label": r08_intent_labels.get(r08_answers.get("q8_intent", ""), "未填寫"),
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


@teacher_required
@require_POST
def teacher_delete_image_evidence(request, evidence_id):
    evidence = get_object_or_404(
        Evidence.objects.filter(
            growth_submission__enrollment__cohort__in=teacher_cohorts(request.user),
            evidence_type=Evidence.Type.IMAGE,
            upload__gt="",
        ).select_related("growth_submission__enrollment"),
        evidence_id=evidence_id,
    )
    enrollment_id = evidence.growth_submission.enrollment_id
    storage = evidence.upload.storage
    upload_name = evidence.upload.name
    shared_file = Evidence.objects.filter(upload=upload_name).exclude(pk=evidence.pk).exists()
    if not shared_file:
        storage.delete(upload_name)
    evidence.delete()
    messages.success(request, "已刪除指定照片；請確認是否需要學員補件。")
    return redirect("learning:teacher_student_detail", enrollment_id=enrollment_id)


# =====================================================================
# Golden Test Center（2026-10-09 第 23 輪指令「二、Golden Set 管理中心」
# 與「三、Golden Test 評估中心框架」）
#
# 設計邊界：
#   1. 重用既有 vision_center 的 golden set 概念，不建立第二套平行來源。
#   2. 僅支援 PROP_DIRECTION_V1，四類標籤 CW_F / CCW_F / CW_B / CCW_B。
#   3. FROZEN 版本不得再新增、修改、刪除樣本。
#   4. 本輪只建框架：不執行推論、不載入 .pt、不啟用 ACTIVE。
# =====================================================================


def _teacher_golden_set_or_404(request, golden_set_id):
    """取得教師可見的 Golden Set；沿用既有班級隔離。"""
    return get_object_or_404(
        golden_sets_for_teacher(request.user), golden_set_id=golden_set_id
    )


@teacher_required
def teacher_golden_set_list(request):
    """Golden Set 清單：顯示版本、照片數、四類分佈與鎖定狀態。"""
    golden_sets = golden_sets_for_teacher(request.user).select_related(
        "created_by", "cohort", "frozen_by"
    )
    rows = [golden_set_summary(item) for item in golden_sets]
    return render(
        request,
        "learning/teacher_golden_set_list.html",
        {
            "rows": rows,
            "supported_task_id": SUPPORTED_GOLDEN_TASK_IDS[0],
            "label_choices": GOLDEN_LABELS,
            "annotation_sources": GoldenSet.AnnotationSource.choices,
            "cohorts": teacher_cohorts(request.user),
        },
    )


@teacher_required
@require_POST
def teacher_golden_set_create(request):
    """建立新的 Golden Set 版本（DRAFT）。"""
    name = request.POST.get("name", "").strip()
    version = request.POST.get("version", "v1").strip() or "v1"
    description = request.POST.get("description", "").strip()
    cohort_id = request.POST.get("cohort_id", "").strip()
    cohort = None
    if cohort_id:
        cohort = teacher_cohorts(request.user).filter(pk=cohort_id).first()
        if cohort is None:
            messages.error(request, "指定的班級不在您的授權範圍內。")
            return redirect("learning:teacher_golden_set_list")
    try:
        created = create_golden_set(
            teacher=request.user,
            name=name,
            version=version,
            task_id=SUPPORTED_GOLDEN_TASK_IDS[0],
            description=description,
            cohort=cohort,
        )
    except GoldenSetError as exc:
        messages.error(request, exc.message)
        return redirect("learning:teacher_golden_set_list")
    messages.success(request, f"已建立測試集 {created.golden_set_id}（草稿）。")
    return redirect("learning:teacher_golden_set_detail", golden_set_id=created.golden_set_id)


@teacher_required
def teacher_golden_set_detail(request, golden_set_id):
    """單一 Golden Set 版本詳情：樣本清單、四類分佈、鎖定狀態。"""
    golden_set = _teacher_golden_set_or_404(request, golden_set_id)
    samples = golden_set.samples.select_related("confirmed_by").order_by("label", "created_at")
    return render(
        request,
        "learning/teacher_golden_set_detail.html",
        {
            "golden_set": golden_set,
            "summary": golden_set_summary(golden_set),
            "samples": samples,
            "label_choices": GOLDEN_LABELS,
            "annotation_sources": GoldenSet.AnnotationSource.choices,
            "cohorts": teacher_cohorts(request.user),
            "mutation_blocked_reason": golden_set.mutation_blocked_reason(),
            # 第 24 輪：完整度與 Manifest 綁定狀態。
            "completeness_label": {
                COMPLETENESS_INCOMPLETE: "結構未完整",
                COMPLETENESS_STRUCTURAL: "結構完整（尚不可正式評估）",
                COMPLETENESS_EVALUATION_READY: "可供正式評估（結構性最低條件）",
            }.get(completeness_level(golden_set), completeness_level(golden_set)),
            "completeness_reason": completeness_reason(golden_set),
            "manifest_binding_label": {
                "BOUND": "已綁定，內容一致",
                "MISMATCH": "不一致，樣本可能已被更動",
                "UNBOUND": "未綁定",
            }.get(golden_set.manifest_binding_status, golden_set.manifest_binding_status),
        },
    )


@teacher_required
@require_POST
def teacher_golden_set_add_sample(request, golden_set_id):
    """上傳教師確認的測試照片並記錄四類標籤。"""
    golden_set = _teacher_golden_set_or_404(request, golden_set_id)
    image = request.FILES.get("image")
    label = request.POST.get("label", "").strip()
    annotation_source = request.POST.get("annotation_source", "").strip()
    note = request.POST.get("note", "").strip()
    confirm_now = request.POST.get("confirm_now") == "on"
    try:
        add_sample(
            golden_set=golden_set,
            teacher=request.user,
            image=image,
            label=label,
            annotation_source=annotation_source,
            note=note,
            confirm_now=confirm_now,
        )
    except GoldenSetError as exc:
        messages.error(request, f"[{exc.code}] {exc.message}")
        return redirect("learning:teacher_golden_set_detail", golden_set_id=golden_set.golden_set_id)
    messages.success(request, f"已新增樣本（{label}）。")
    return redirect("learning:teacher_golden_set_detail", golden_set_id=golden_set.golden_set_id)


@teacher_required
@require_POST
def teacher_golden_sample_confirm(request, golden_set_id, sample_id):
    """教師確認或退回樣本標籤。"""
    golden_set = _teacher_golden_set_or_404(request, golden_set_id)
    sample = get_object_or_404(golden_set.samples, sample_id=sample_id)
    action = request.POST.get("action", "").strip()
    note = request.POST.get("note", "").strip()
    try:
        if action == "confirm":
            confirm_sample(sample=sample, teacher=request.user, note=note)
            messages.success(request, "已確認此樣本標籤。")
        elif action == "reject":
            reject_sample(sample=sample, teacher=request.user, note=note)
            messages.success(request, "已退回此樣本標籤。")
        else:
            messages.error(request, "無效的樣本操作。")
    except GoldenSetError as exc:
        messages.error(request, f"[{exc.code}] {exc.message}")
    return redirect("learning:teacher_golden_set_detail", golden_set_id=golden_set.golden_set_id)


@teacher_required
@require_POST
def teacher_golden_set_freeze(request, golden_set_id):
    """鎖定測試集版本；鎖定後不得再變更樣本。"""
    golden_set = _teacher_golden_set_or_404(request, golden_set_id)
    try:
        freeze_golden_set(golden_set=golden_set, teacher=request.user)
    except GoldenSetError as exc:
        messages.error(request, f"[{exc.code}] {exc.message}")
        return redirect("learning:teacher_golden_set_detail", golden_set_id=golden_set.golden_set_id)
    messages.success(request, f"已鎖定測試集 {golden_set.golden_set_id}，樣本不可再變更。")
    return redirect("learning:teacher_golden_set_detail", golden_set_id=golden_set.golden_set_id)


@teacher_required
def teacher_golden_test_page(request, model_id):
    """Golden Test 評估中心框架頁。

    教師從模型倉庫選擇 Candidate 模型進入本頁。
    本輪**只呈現框架與預留欄位**，不執行推論、不載入 .pt、不變更任何狀態。

    第 24 輪指令「四」：阻擋條件一律由服務層自行驗證，
    本頁傳入的清單僅供顯示，**不作為安全判斷依據**。
    """
    record = get_object_or_404(
        records_for_teacher(request.user).select_related("student", "cohort"), model_id=model_id
    )
    golden_sets = [golden_set_summary(item) for item in golden_sets_for_teacher(request.user)]

    # 顯示用的已鎖定清單（僅供下拉選單呈現）。
    frozen = [item for item in golden_sets if item["is_frozen"]]

    # 權威判斷：由服務層自行查詢 DB 驗證，不使用上面的 frozen 清單。
    ready_blocked_reason = model_golden_test_blocked_reason(record)

    # 逐版本標示完整度等級，讓教師看得出「可鎖定」與「可正式評估」的差別。
    completeness_rows = []
    for item in golden_sets_for_teacher(request.user):
        level = completeness_level(item)
        completeness_rows.append(
            {
                "golden_set_id": item.golden_set_id,
                "version": item.version,
                "status": item.status,
                "level": level,
                "level_label": {
                    COMPLETENESS_INCOMPLETE: "結構未完整",
                    COMPLETENESS_STRUCTURAL: "結構完整（尚不可正式評估）",
                    COMPLETENESS_EVALUATION_READY: "可供正式評估（結構性最低條件）",
                }.get(level, level),
                "reason": completeness_reason(item),
                "formal_blocked_reason": formal_evaluation_blocked_reason(
                    item, item.task_id
                ),
                "sample_count": item.sample_count,
                "confirmed_sample_count": item.confirmed_sample_count,
                "label_distribution": item.label_distribution(),
                "missing_labels": item.missing_labels(),
                "manifest_sha256": item.manifest_sha256,
                "manifest_binding_status": item.manifest_binding_status,
            }
        )

    return render(
        request,
        "learning/teacher_golden_test.html",
        {
            "record": record,
            "golden_sets": golden_sets,
            "frozen_golden_sets": frozen,
            "completeness_rows": completeness_rows,
            "completeness_level": completeness_level,
            "evaluation_ready_level": COMPLETENESS_EVALUATION_READY,
            "min_samples_per_class": MIN_SAMPLES_PER_CLASS_FOR_EVALUATION,
            "contract_version": GOLDEN_SET_CONTRACT_VERSION,
            "class_mapping": list(record.class_mapping or []),
            "metrics_placeholder": GOLDEN_TEST_METRIC_FIELDS,
            "runner": runner_state(),
            "ready_blocked_reason": ready_blocked_reason,
        },
    )


# =====================================================================
# AI 視覺模型中心（2026-10-10 指令 P）
#
# 單一教師入口，整合四個步驟（由上而下）：
#   步驟① 查看學員模型 / 步驟② 教師圖片驗證
#   步驟③ 教師複核與啟用 / 步驟④ 保存下一期教學資源
#
# 安全原則：
#   1. Django 服務進程永不載入 .pt（學生模型是 PyTorch pickle，載入即執行任意程式碼）。
#      所有推論一律轉發到既有的 Live Backend 獨立推論服務。
#   2. 兩個任務（PROP_DIRECTION / FOUR_SIDE_HOVER）各自獨立的
#      模型、規則、測試集與啟用版本；不共用狀態。
#   3. 不得只憑信心值判定通過；未達門檻一律回報「資料不足」。
#   4. 不得假設 best.pt 內含訓練資料；缺少的資源一律標示為缺少，不偽造。
# =====================================================================

VISION_CENTER_TASKS = (
    {
        "id": "PROP_DIRECTION",
        "label": "四槳方向辨識",
        "classes": list(PROP_LABELS),
    },
    {
        "id": "FOUR_SIDE_HOVER",
        "label": "四面懸停辨識",
        "classes": list(HOVER_LABELS),
    },
)

VISION_CENTER_STATUS_LABELS = {
    "DRAFT": "草稿",
    "VALIDATING": "CHECK（檢查中）",
    "VALIDATED": "PASS（已通過驗證）",
    "CANDIDATE": "候選模型（待驗證）",
    "ACTIVE": "ACTIVE（正式模型）",
    "ARCHIVED": "歷史版本",
    "REJECTED": "NG（未通過檢查）",
    "FAILED": "NG（檢查失敗）",
    "DEMO_IMPORTED": "DEMO·類別放寬（未驗證）",
}

# 教師 2026-10-16 裁決：教師界面狀態統一為
# 待複核 / CHECK（需要檢查）/ PASS（驗證通過）/ NG（驗證失敗）/ ACTIVE（正式使用）。
VISION_CENTER_SUBMISSION_LABELS = {
    "SUBMITTED": "待複核",
    "IMPORTED": "已導入（待驗證）",
    "REJECTED": "NG（未採用）",
}

VISION_CENTER_VERDICT_LABELS = {
    "MATCH": "PASS（通過）· 預測與教師標註相符",
    "MISMATCH": "NG（失敗）· 預測與教師標註不相符",
    "INSUFFICIENT_DATA": "CHECK（需要檢查）· 資料不足，無法判定",
    "DETECTED": "CHECK（需要檢查）· 已辨識（教師未標註）",
}

VISION_CENTER_VERDICT_CSS = {
    "MATCH": "match",
    "MISMATCH": "mismatch",
    "INSUFFICIENT_DATA": "incomplete",
    "DETECTED": "incomplete",
}


def _vision_status_label(status):
    return VISION_CENTER_STATUS_LABELS.get(status, status or "未知")


def _vision_status_css(status):
    return {
        "ACTIVE": "active",
        "VALIDATED": "validated",
        "CANDIDATE": "candidate",
        "REJECTED": "rejected",
        "FAILED": "rejected",
        "ARCHIVED": "archived",
        "DEMO_IMPORTED": "warn",
    }.get(status, "submitted")


def _vision_task_meta(task_id):
    for item in VISION_CENTER_TASKS:
        if item["id"] == task_id:
            return item
    return VISION_CENTER_TASKS[0]


def _vision_task_id(request):
    """解析任務類型。接受 GET 的 `task` 與表單送出的 `task_id`（兩種都可能是 POST）。"""
    raw = (
        request.GET.get("task")
        or request.GET.get("task_id")
        or request.POST.get("task_id")
        or request.POST.get("task")
        or ""
    ).strip().upper()
    valid = {item["id"] for item in VISION_CENTER_TASKS}
    return raw if raw in valid else "PROP_DIRECTION"


def _vision_api_online():
    """探測 Live Backend 推論服務是否可用。不載入任何模型。"""
    ok, detail = vision_api.vision_api_health()
    return ok, detail


def _vision_format_time(value):
    if not value:
        return ""
    # Live Backend API 回傳 UTC（ISO 8601、Z 結尾）時間戳。教師頁必須換算為站台
    # 時區（Asia/Taipei, UTC+8）後顯示，與學員頁 Django localtime 呈現一致；
    # 否則 UTC 直顯會讓本地當天凌晨的上傳顯示成前一天日期，教師會誤判
    # 「後台沒有更新」（2026-10-18 教師實測回報的個案）。
    raw = value if isinstance(value, str) else str(value)
    raw = raw.strip()
    try:
        parsed = datetime.datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return raw.replace("T", " ").replace("Z", "")[:19]
    if parsed.tzinfo is not None:
        parsed = timezone.localtime(parsed)
    return parsed.strftime("%Y-%m-%d %H:%M:%S")


def _vision_format_size(size):
    try:
        size = int(size or 0)
    except (TypeError, ValueError):
        return "—"
    if size >= 1024 * 1024:
        return f"{size / (1024 * 1024):.1f} MB"
    if size >= 1024:
        return f"{size / 1024:.1f} KB"
    return f"{size} bytes"


def _vision_validation_records(request):
    """驗證紀錄保存在 Django session，供教師在步驟②查核。"""
    return list(request.session.get("vision_validation_records") or [])


def _vision_remember_validation(request, record):
    records = _vision_validation_records(request)
    records.insert(0, record)
    request.session["vision_validation_records"] = records[:20]


# --- 2026-10-16 教師裁決 P1：ACTIVE 啟用風險揭露 ---------------------------
# 「模型結構驗證」（可載入、類別契約正確）與「真實圖片辨識品質」是兩件事。
# 教師畫面必須同時呈現兩者，且不得讓 VALIDATED 被解讀為辨識品質已通過。
IMAGE_EVIDENCE_LABELS = {
    "NONE": "尚未做過真實圖片驗證",
    "PASS": "最近一次真實圖片驗證：PASS（通過）",
    "NG": "最近一次真實圖片驗證：NG（失敗）",
    "CHECK": "最近一次真實圖片驗證：CHECK（需要檢查）",
}

IMAGE_EVIDENCE_CSS = {
    "NONE": "submitted",
    "PASS": "active",
    "NG": "rejected",
    "CHECK": "candidate",
}

IMAGE_EVIDENCE_NOTES = {
    "NONE": "尚未證實此模型的真實辨識品質：沒有任何真實圖片驗證紀錄。",
    "PASS": "最近一次真實圖片驗證與您的標註相符；仍建議以多張真實照片重複驗收。",
    "NG": "預測與您的標註不相符，尚未證實辨識品質，不建議設為正式模型。",
    "CHECK": "資料不足或未偵測到目標，尚未證實辨識品質，不建議據此設為正式模型。",
}

STRUCTURE_VALIDATED_NOTE = (
    "「結構驗證通過」只代表模型可載入、類別契約正確，"
    "不代表真實圖片辨識品質已通過。"
)


def _vision_latest_image_evidence(validation_records, model_id):
    """取該模型最近一次「真實推論」圖片驗證紀錄（session 內，最新在前）。

    只有 `evidence_source == "REAL_INFERENCE"` 可作為辨識品質依據；
    DEMO 模擬結果（若有）一律排除，不得當成正式驗證。
    """
    if not model_id or not validation_records:
        return None
    for record in validation_records:
        if record.get("model_id") != model_id:
            continue
        if record.get("evidence_source", "REAL_INFERENCE") != "REAL_INFERENCE":
            continue
        return record
    return None


def _vision_image_evidence_state(latest):
    if latest is None:
        return "NONE"
    return {"MATCH": "PASS", "MISMATCH": "NG"}.get(latest.get("verdict"), "CHECK")


def _vision_model_row(model, *, validation_records=None):
    status = model.get("status")
    model_id = model.get("model_id")
    structure_ok = model.get("validation_status") == "VALIDATED"
    latest_evidence = _vision_latest_image_evidence(validation_records, model_id)
    evidence_state = _vision_image_evidence_state(latest_evidence)
    return {
        "model_id": model_id,
        "model_type": model.get("model_type") or "PROP_DIRECTION",
        "model_name": model.get("model_name") or model.get("model_id"),
        "version": model.get("version") or "",
        "status": status,
        "status_label": _vision_status_label(status),
        "status_css": _vision_status_css(status),
        "validation_status": model.get("validation_status"),
        "validation_label": _vision_status_label(model.get("validation_status")),
        "source_label": (
            "學員提交"
            if model.get("source_submission_id")
            else "教師上傳"
        ),
        "uploaded_at_display": _vision_format_time(model.get("uploaded_at")),
        "activated_at_display": _vision_format_time(model.get("activated_at")),
        "archived_at_display": _vision_format_time(model.get("archived_at")),
        "time_display": _vision_format_time(
            model.get("activated_at") or model.get("uploaded_at")
        ),
        "file_size_display": _vision_format_size(model.get("file_size")),
        "file_size": model.get("file_size"),
        "can_activate": model.get("validation_status") == "VALIDATED"
        and status != "REJECTED",
        "class_names": model.get("class_names") or [],
        # --- 受控放寬（2026-10-19）：映射版／臨時模型必須在畫面上可辨識 ---
        "temporary_mapping": model.get("temporary_mapping") is True,
        "temporary_mapping_label": model.get("temporary_mapping_label") or "映射版·臨時",
        # --- DEMO 放寬（2026-10-19）：類別不一致但以筆誤別名對應後匯入的模型 ---
        "demo_class_relaxed": model.get("demo_class_relaxed") is True,
        "class_name_mapping": model.get("class_name_mapping") or {},
        "class_name_mapping_display": "、".join(
            f"{key}→{value}"
            for key, value in (model.get("class_name_mapping") or {}).items()
        ),
        "class_name_mapping_note": model.get("class_name_mapping_note") or "",
        # --- P1：結構驗證狀態 vs 真實圖片辨識品質（兩者必須分別呈現）---
        "structure_validated": structure_ok,
        "structure_label": "已通過結構驗證" if structure_ok else "未通過結構驗證",
        "structure_note": STRUCTURE_VALIDATED_NOTE,
        "last_image_validation": latest_evidence,
        "image_evidence_state": evidence_state,
        "image_evidence_label": IMAGE_EVIDENCE_LABELS[evidence_state],
        "image_evidence_css": IMAGE_EVIDENCE_CSS[evidence_state],
        "image_evidence_note": IMAGE_EVIDENCE_NOTES[evidence_state],
        "recognition_quality_proven": evidence_state == "PASS",
    }


@teacher_required
def teacher_vision_center(request):
    """AI 視覺模型中心：單一入口，四個步驟（由上而下）。

    ① 查看學員模型 → ② 教師圖片驗證 → ③ 教師複核與啟用 → ④ 保存下一期教學資源。
    所有推論與啟用動作都轉發到既有 Live Backend；
    本頁只負責呈現與安全轉發，不在 Django 內載入任何模型。
    """
    task_id = _vision_task_id(request)
    task_meta = _vision_task_meta(task_id)

    # 驗證紀錄（session，最新在前）先取得，供 ③ 逐模型呈現「最近一次真實圖片驗證」。
    history_records = _vision_validation_records(request)

    api_online, api_detail = _vision_api_online()

    task_summary = []
    history_models = []
    submissions = []
    hard_examples = []
    inference_source = {}
    model_review_map = {}

    if api_online:
        for meta in VISION_CENTER_TASKS:
            try:
                history = vision_api.task_model_history(
                    model_type=meta["id"], teacher_id=request.user.pk
                )
            except RuntimeError:
                history = {"history": [], "active": None, "inference_source": {}}
            task_summary.append(
                {
                    "label": meta["label"],
                    "active": history.get("active"),
                    "history_count": len(history.get("history") or []),
                }
            )
            if meta["id"] == task_id:
                history_models = [
                    _vision_model_row(item, validation_records=history_records)
                    for item in (history.get("history") or [])
                ]
                inference_source = history.get("inference_source") or {}

        try:
            raw_submissions = vision_api.list_submissions(
                task_id=task_id, teacher_id=request.user.pk
            )
        except RuntimeError:
            raw_submissions = []

        models_by_submission = {
            item["model_id"]: item
            for item in history_models
        }
        for item in raw_submissions or []:
            imported_id = item.get("imported_model_id")
            submissions.append(
                {
                    "submission_id": item.get("submission_id"),
                    "original_filename": item.get("original_filename"),
                    "student_id": item.get("student_id"),
                    "group_id": item.get("group_id"),
                    "status": item.get("status"),
                    "status_label": VISION_CENTER_SUBMISSION_LABELS.get(
                        item.get("status"), item.get("status") or "未知"
                    ),
                    "status_css": {
                        "SUBMITTED": "submitted",
                        "IMPORTED": "imported",
                        "REJECTED": "rejected",
                    }.get(item.get("status"), "submitted"),
                    "file_hash": item.get("file_hash"),
                    "file_size_display": _vision_format_size(item.get("file_size")),
                    "uploaded_at_display": _vision_format_time(item.get("uploaded_at")),
                    "notes": item.get("notes") or "",
                    "growth_record_slot": item.get("growth_record_slot") or "—",
                    "growth_record_id": item.get("growth_record_id") or "—",
                    "evidence_reference": item.get("evidence_reference") or "—",
                    "imported_model_id": imported_id,
                    "model_row": models_by_submission.get(imported_id),
                    "demo_review_status": item.get("demo_review_status") or "",
                    "demo_active": item.get("demo_active") is True,
                    "import_last_error": item.get("import_last_error") or "",
                    "import_attempted_at_display": (
                        _vision_format_time(item.get("import_attempted_at"))
                        if item.get("import_attempted_at") else ""
                    ),
                }
            )

        # 步驟④（保存教學資源）需要 hard_examples；改為不再受限 tab，
        # 只要推論服務在線就抓取，確保四步驟單頁渲染時資源庫有資料。
        try:
            hard_examples = vision_api.list_hard_examples(
                teacher_id=request.user.pk
            ) or []
        except RuntimeError:
            hard_examples = []

        # 建立 imported_model_id -> 學員證據複核資訊 的對應，供步驟③顯示與記錄
        # 教師複核意見（沿用既有 teacher_vision_model_review 機制，不另建第二套複核系統）。
        for item in submissions:
            imid = item.get("imported_model_id")
            ev_ref = item.get("evidence_reference")
            if imid and ev_ref:
                try:
                    ev = Evidence.objects.filter(pk=ev_ref).first()
                    if ev:
                        rm = (ev.processed_metadata or {}).get("vision_model_review") or {}
                        model_review_map[imid] = {
                            "evidence_id": str(ev.pk),
                            "review_status": rm.get("status") or "—",
                            "review_note": rm.get("current_note") or "",
                        }
                except Exception:
                    pass

    # 將既有教師複核意見（若存在）附加到每個模型，供步驟③直接顯示/記錄。
    for row in history_models:
        row["review"] = model_review_map.get(row["model_id"])

    active_model = next(
        (item for item in history_models if item["status"] == "ACTIVE"), None
    )
    activatable_models = [
        item for item in history_models if item["status"] != "ARCHIVED"
    ]
    verifiable_models = [
        item
        for item in history_models
        if item["status"] in {"VALIDATED", "CANDIDATE", "ACTIVE", "DEMO_IMPORTED"}
    ]

    # --- P1：教師畫面必須明確揭露「尚未證實真實辨識品質」的模型 ---
    # 只要最近一次真實圖片驗證不是 PASS（含完全沒驗證過、NG、CHECK），
    # 就必須在畫面上明確警示；本輪**不**因此阻擋啟用（ACTIVE 核心未動）。
    models_without_proven_quality = [
        item for item in activatable_models if not item["recognition_quality_proven"]
    ]

    # history_records 已於上方取得（供 ③ 逐模型呈現最近一次真實圖片驗證）。
    task_history_records = [
        item for item in history_records if item.get("task_id") == task_id
    ]
    # 教師 2026-10-16 裁決：④ Data Flywheel 主畫面只顯示簡單統計。
    # 全部由既有驗證紀錄推導，不新增資料模型、不寫入任何檔案。
    mismatch_records = [
        h for h in task_history_records if h.get("verdict") == "MISMATCH"
    ]
    low_confidence_records = []
    for h in task_history_records:
        conf = h.get("predicted_confidence")
        thr = h.get("confidence_threshold")
        if conf is None or thr is None:
            continue
        try:
            if float(conf) < float(thr):
                low_confidence_records.append(h)
        except (TypeError, ValueError):
            continue

    resources = {
        "model_count": len(history_models),
        "class_mapping": "已定義（4 類）",
        "data_yaml": "匯出訓練包時產生",
        "images": "缺少" if not hard_examples else f"{len(hard_examples)} 筆待確認",
        "labels": "缺少（需人工確認標註）",
        "validation_reports": (
            f"{len(task_history_records)} 筆" if task_history_records else "尚無"
        ),
        "hard_examples": f"{len(hard_examples)} 筆",
        "teacher_corrections": (
            f"{len(mismatch_records)} 筆" if task_history_records else "尚無"
        ),
        # ④ Data Flywheel 三項主畫面統計（純顯示，不影響任何後端行為）
        "new_samples": f"{len(task_history_records)} 筆",
        "mismatch_samples": f"{len(mismatch_records)} 筆",
        "low_confidence_samples": f"{len(low_confidence_records)} 筆",
    }

    selected_model_id = (
        request.GET.get("model") or ""
    ).strip() or (verifiable_models[0]["model_id"] if verifiable_models else "")
    selected_expected = (request.GET.get("expected") or "").strip().upper()
    if selected_expected and selected_expected not in task_meta["classes"]:
        selected_expected = ""

    # --- 四場景工作流（2026-10-16 教師裁決）---
    # ① 學員模型 ② 圖片驗證 ③ 正式模型 ④ 下一輪資料飛輪。
    # scene 參數控制頁面載入後預設顯示的場景；無效值回落到 ①。
    try:
        scene = int(request.GET.get("scene", "1"))
    except (TypeError, ValueError):
        scene = 1
    if scene not in (1, 2, 3, 4):
        scene = 1
    selected_model = next(
        (item for item in verifiable_models if item["model_id"] == selected_model_id),
        None,
    )
    candidate_models = [
        item
        for item in activatable_models
        if item["status"] not in ("ACTIVE", "REJECTED", "ARCHIVED")
    ]
    approved_models = [
        item for item in history_models if item.get("recognition_quality_proven")
    ]
    # ① 學員模型場景：待複核（SUBMITTED）與已處理（IMPORTED/REJECTED）分開呈現。
    pending_submissions = [
        item for item in submissions if item.get("status") == "SUBMITTED"
    ]
    processed_submissions = [
        item for item in submissions if item.get("status") != "SUBMITTED"
    ]

    validation_result = request.session.pop("vision_center_result", None)
    if validation_result and validation_result.get("task_id") != task_id:
        validation_result = None

    # 提交級驗證（場景①直接對 SUBMITTED 提交推理）的伺服器回傳結果（非 AJAX 備援）。
    submission_validation_result = request.session.pop("vision_center_submission_result", None)
    if submission_validation_result and submission_validation_result.get("task_id") != task_id:
        submission_validation_result = None
    active_sub = (request.GET.get("sub") or "").strip()

    # 教師指令③：「類別名對照表」於導入前預檢時寫入 session，此處「讀取」供場景①渲染。
    # 注意：此處只讀不消費（pop），否則渲染後 payload 即消失，教師提交對照表時
    # apply_mapping 會誤判「對照表已過期」。唯一消費點為 apply_mapping 本身。
    class_name_mapping = request.session.get("vision_class_name_mapping", None)
    if class_name_mapping and class_name_mapping.get("task_id") != task_id:
        class_name_mapping = None

    return render(
        request,
        "learning/teacher_vision_center.html",
        {
            "task_id": task_id,
            "task_label": task_meta["label"],
            "task_options": [
                {"id": item["id"], "label": item["label"]}
                for item in VISION_CENTER_TASKS
            ],
            "class_options": task_meta["classes"],
            "api_online": api_online,
            "api_detail": api_detail,
            "task_summary": task_summary,
            "submissions": submissions,
            "history": history_models,
            "active_model": active_model,
            "activatable_models": activatable_models,
            "verifiable_models": verifiable_models,
            "selected_model_id": selected_model_id,
            "selected_expected": selected_expected,
            "selected_model": selected_model,
            "scene": scene,
            "candidate_models": candidate_models,
            "approved_models": approved_models,
            "pending_submissions": pending_submissions,
            "processed_submissions": processed_submissions,
            "class_name_mapping": class_name_mapping,
            "inference_source": inference_source,
            "can_rollback": any(
                item["status"] == "ARCHIVED"
                and item["validation_status"] == "VALIDATED"
                for item in history_models
            ),
            "validation_result": validation_result,
            "submission_validation_result": submission_validation_result,
            "active_sub": active_sub,
            "demo_simulation_enabled": getattr(settings, "VISION_DEMO_SIMULATION_ENABLED", False),
            "validation_history": task_history_records,
            "resources": resources,
            "hard_examples": hard_examples,
            # --- P1：風險揭露用 ---
            "structure_validated_note": STRUCTURE_VALIDATED_NOTE,
            "models_without_proven_quality": models_without_proven_quality,
        },
    )


@teacher_required
@require_POST
def teacher_vision_center_validate(request):
    """步驟②：上傳測試圖片，對指定模型執行真實推論。

    支援兩種回應：
    - 一般表單送出 → 重導回中心頁（場景②），結果經 session 帶回渲染。
    - AJAX（X-Requested-With）→ 回傳 JSON，供前端不刷新頁面顯示原圖與畫框結果。
    兩者都走同一條真實推論鏈，不改變任何安全行為。
    """
    task_id = _vision_task_id(request)
    is_ajax = request.headers.get("X-Requested-With") == "XMLHttpRequest"

    def _validate_error(detail, status_code=400):
        if is_ajax:
            return JsonResponse({"ok": False, "error": detail}, status=status_code)
        messages.error(request, detail)
        return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=2&model={model_id}")

    model_id = (request.POST.get("model_id") or "").strip()
    expected = (request.POST.get("expected_class") or "").strip().upper() or None
    try:
        threshold = float(request.POST.get("confidence_threshold") or 0.5)
    except (TypeError, ValueError):
        threshold = 0.5
    threshold = min(max(threshold, 0.05), 0.95)

    upload = request.FILES.get("test_image")
    if not upload:
        return _validate_error("請先選擇一張測試圖片。")
    if not model_id:
        return _validate_error("請先選擇要驗證的模型。")

    content = upload.read()
    if not content:
        return _validate_error("圖片檔案是空的，請重新選擇。")

    try:
        result = vision_api.validate_image_with_model(
            model_id=model_id,
            image_bytes=content,
            teacher_id=request.user.pk,
            expected_class=expected,
            confidence_threshold=threshold,
        )
    except RuntimeError as exc:
        return _validate_error(f"無法執行圖片驗證：{exc}")

    verdict = result.get("verdict") or {}
    decision = verdict.get("decision") or "INSUFFICIENT_DATA"
    model = result.get("model") or {}
    detections = result.get("detections") or []
    payload = {
        "task_id": task_id,
        "model_id": model.get("model_id") or model_id,
        "model_name": model.get("model_name") or model_id,
        "model_version": model.get("version") or "",
        "model_type": model.get("model_type") or task_id,
        "class_names": ", ".join(model.get("class_names") or []),
        "detection_count": result.get("detection_count", len(detections)),
        "predicted_class": verdict.get("predicted_class"),
        "predicted_confidence": (
            round(float(verdict["predicted_confidence"]), 4)
            if verdict.get("predicted_confidence") is not None
            else None
        ),
        "expected_class": verdict.get("expected_class"),
        "reason": verdict.get("reason") or "",
        "reason_code": verdict.get("reason_code") or "",
        "rule_version": verdict.get("rule_version") or "",
        "confidence_threshold": verdict.get("confidence_threshold"),
        "validated_at": result.get("validated_at") or "",
        "verdict": decision,
        "verdict_label": VISION_CENTER_VERDICT_LABELS.get(decision, decision),
        "verdict_css": VISION_CENTER_VERDICT_CSS.get(decision, "incomplete"),
        # P1：本頁驗證一律走真實推論（Live Backend 載入 .pt），無 DEMO 模擬分支。
        # 標記來源，確保只有真實推論可作為「辨識品質依據」。
        "evidence_source": "REAL_INFERENCE",
        "boxes": [
            {
                "class": item.get("class"),
                "confidence": round(float(item.get("confidence", 0)), 4),
                "bbox": item.get("bbox"),
            }
            for item in detections[:20]
        ],
    }
    payload["validated_at_display"] = _vision_format_time(payload["validated_at"])
    request.session["vision_center_result"] = payload
    _vision_remember_validation(request, payload)

    if is_ajax:
        return JsonResponse({"ok": True, "result": payload})

    if decision == "MATCH":
        messages.success(request, "圖片驗證完成：模型預測與您的標註相符。")
    elif decision == "MISMATCH":
        messages.error(request, "圖片驗證完成：模型預測與您的標註不相符，建議退回修改。")
    else:
        messages.warning(request, "圖片驗證完成：資料不足，無法判定，請勿據此啟用模型。")
    return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=2&model={model_id}")


@teacher_required
@require_POST
def teacher_vision_center_validate_submission(request):
    """步驟①補充：對 SUBMITTED 學員提交直接上傳圖片做真實推理（不匯入、不啟用）。

    讓教師能在「① 學員模型」場景直接驗證待複核提交：載入該提交的 .pt 推理，
    顯示槳葉方向預測與信心值。唯讀：不變更提交狀態、不切換 ACTIVE、
    不動匯入閘門。對應 Live 路由 POST /api/v1/vision/submissions/{id}/validate-image。
    """
    task_id = _vision_task_id(request)
    is_ajax = request.headers.get("X-Requested-With") == "XMLHttpRequest"

    def _validate_error(detail, status_code=400):
        if is_ajax:
            return JsonResponse({"ok": False, "error": detail}, status=status_code)
        messages.error(request, detail)
        return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=1")

    submission_id = (request.POST.get("submission_id") or "").strip()
    expected = (request.POST.get("expected_class") or "").strip().upper() or None
    try:
        threshold = float(request.POST.get("confidence_threshold") or 0.5)
    except (TypeError, ValueError):
        threshold = 0.5
    threshold = min(max(threshold, 0.05), 0.95)

    upload = request.FILES.get("test_image")
    if not submission_id:
        return _validate_error("缺少提交編號。")
    if not upload:
        return _validate_error("請先選擇一張測試圖片。")
    content = upload.read()
    if not content:
        return _validate_error("圖片檔案是空的，請重新選擇。")

    try:
        result = vision_api.validate_image_with_submission(
            submission_id=submission_id,
            image_bytes=content,
            teacher_id=request.user.pk,
            expected_class=expected,
            confidence_threshold=threshold,
        )
    except RuntimeError as exc:
        return _validate_error(f"無法執行圖片驗證：{exc}")

    verdict = result.get("verdict") or {}
    decision = verdict.get("decision") or "INSUFFICIENT_DATA"
    model = result.get("model") or {}
    detections = result.get("detections") or []
    payload = {
        "task_id": task_id,
        "submission_id": submission_id,
        "model_id": None,
        "model_name": model.get("model_name") or submission_id,
        "model_version": "",
        "model_type": model.get("model_type") or task_id,
        "class_names": ", ".join(model.get("class_names") or []),
        "detection_count": result.get("detection_count", len(detections)),
        "predicted_class": verdict.get("predicted_class"),
        "predicted_confidence": (
            round(float(verdict["predicted_confidence"]), 4)
            if verdict.get("predicted_confidence") is not None
            else None
        ),
        "expected_class": verdict.get("expected_class"),
        "reason": verdict.get("reason") or "",
        "reason_code": verdict.get("reason_code") or "",
        "rule_version": verdict.get("rule_version") or "",
        "confidence_threshold": verdict.get("confidence_threshold"),
        "validated_at": result.get("validated_at") or "",
        "verdict": decision,
        "verdict_label": VISION_CENTER_VERDICT_LABELS.get(decision, decision),
        "verdict_css": VISION_CENTER_VERDICT_CSS.get(decision, "incomplete"),
        "evidence_source": "REAL_INFERENCE",
        "boxes": [
            {
                "class": item.get("class"),
                "confidence": round(float(item.get("confidence", 0)), 4),
                "bbox": item.get("bbox"),
            }
            for item in detections[:20]
        ],
    }
    request.session["vision_center_submission_result"] = payload

    if is_ajax:
        return JsonResponse({"ok": True, "result": payload, "submission_id": submission_id})

    if decision == "MATCH":
        messages.success(request, "圖片驗證完成：模型預測與您的標註相符。")
    elif decision == "MISMATCH":
        messages.error(request, "圖片驗證完成：模型預測與您的標註不相符。")
    else:
        messages.warning(request, "圖片驗證完成：資料不足，無法判定，請勿據此啟用模型。")
    return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=1&sub={submission_id}")


@teacher_required
@require_POST
def teacher_vision_center_import(request):
    """步驟① → 步驟②：教師把學員提交導入為候選模型。

    教師指令③④（2026-10-18）：
    - 先做唯讀預檢（載入 .pt 取得實際類別名），不建立任何紀錄；
    - 類別名不同但數量一致 → 進入「類別名對照表」，由教師確認後再導入；
    - names 為空 → 提示「模型缺少類別名稱，請補充」，不直接駁回；
    - 匯入失敗 → Live 端保持 SUBMITTED 並記錄原因，此處完整顯示（不截斷）。
    """
    task_id = _vision_task_id(request)
    task_meta = _vision_task_meta(task_id)
    submission_id = (request.POST.get("submission_id") or "").strip()
    if not submission_id:
        messages.error(request, "缺少提交編號，無法導入。")
        return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=1")

    if request.POST.get("demo_review_approved") == "1":
        if not getattr(settings, "VISION_DEMO_SIMULATION_ENABLED", False):
            messages.error(request, "DEMO 模擬推論未啟用，未變更任何模型狀態。")
            return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=1")
        try:
            vision_api.approve_demo_submission(
                submission_id=submission_id, teacher_id=request.user.pk
            )
        except RuntimeError as exc:
            messages.error(request, f"DEMO 模型複核失敗：{exc}")
            return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=1")
        messages.success(request, "DEMO 模型已複核通過並啟用。此狀態僅供 DEMO 模擬結果，不會修改正式 ACTIVE 模型。")
        return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=1")

    try:
        preflight = vision_api.preflight_import(
            submission_id=submission_id, teacher_id=request.user.pk
        )
    except RuntimeError as exc:
        # D2：預檢本身失敗（逾時／連線失敗／提交狀態不可導入）也要留下原因。
        text = _vision_error_text(exc, "導入前檢查失敗，請稍後再試。")
        _vision_record_import_failure(
            request, submission_id, f"導入前檢查失敗：{text}", _vision_error_code(exc),
        )
        messages.error(request, f"導入前檢查失敗：{text}")
        return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=1")

    outcome = (preflight or {}).get("outcome")
    actual = preflight.get("class_names_actual") or []
    expected = preflight.get("class_names_expected") or []
    if outcome == "class_names_missing":
        message = "模型缺少類別名稱，請補充：這個 .pt 載入後沒有任何類別名。請用带有類別名的資料集重新訓練後再上傳，並由教師確認模型來源後重試。提交保持「待複核」，未被駁回。"
        _vision_record_import_failure(
            request, submission_id, "模型缺少類別名稱，請補充後重試。", "model_class_names_missing",
        )
        messages.error(request, message)
        return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=1")
    if outcome == "mismatch":
        message = f"導入失敗：模型類別數量與「{task_meta['label']}」預期不一致（實際 {len(actual)} 類、預期 {len(expected)} 類），無法建立對照。提交保持「待複核」，未被駁回。"
        _vision_record_import_failure(
            request, submission_id,
            f"模型類別數量與任務預期不一致（實際 {len(actual)} 類、預期 {len(expected)} 類）。",
            "model_class_names_mismatch",
        )
        messages.error(request, message)
        return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=1")
    if outcome == "registered_mapping_ready":
        # 受控放寬（2026-10-19）：此提交已在 live_backend/app/vision_class_mappings.json
        # 登記筆誤映射，才允許 6→4 many-to-one 導入。映射表由 Live 端從設定檔讀取，
        # 不從此處傳入，避免教師端臨時拼湊對照表繞過閘門。
        messages.warning(
            request,
            "此提交已在設定檔登記「筆誤映射」（臨時）：6 類名稱將對照為 4 類後導入。"
            "導入後的模型會標記為「映射版·臨時」，不是正式訓練模型。",
        )
        return _vision_import_with_dataset(
            request, task_id=task_id, submission_id=submission_id, class_name_mapping=None,
        )
    if outcome == "demo_class_relaxed":
        # DEMO 放寬（2026-10-19）：模型類別數量與任務預期不一致（6 類 vs 4 類），
        # 但能在 DEMO 模式下用筆誤別名（CCE/CCF→CCW）對應到全部預期類別。
        # 匯入後「不」標記為已驗證／已啟用，僅供 DEMO 模擬流程；不影響正式 ACTIVE 模型。
        messages.warning(
            request,
            "類別不一致（DEMO 放行）：模型實際 6 類、預期 4 類；DEMO 模式下以筆誤別名"
            "（CCE/CCF→CCW）對應後匯入，不會標記為已驗證／已啟用。此狀態僅供 DEMO 模擬。",
        )
        return _vision_import_with_dataset(
            request, task_id=task_id, submission_id=submission_id, class_name_mapping=None,
        )
    if outcome == "detection_model_required":
        _vision_record_import_failure(
            request, submission_id, "模型不是目標偵測（detect）模型，無法導入。", "model_must_be_detection_model",
        )
        messages.error(request, "導入失敗：模型必須是目標偵測（detect）模型。提交保持「待複核」，未被駁回。")
        return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=1")
    if outcome == "unloadable":
        reason = preflight.get("reason") or "未知原因"
        _vision_record_import_failure(
            request, submission_id, f"模型無法載入（{reason}）。", "model_unloadable",
        )
        messages.error(request, f"導入失敗：模型無法載入（{reason}）。提交保持「待複核」，未被駁回。")
        return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=1")
    if outcome == "mapping_required":
        # 教師指令③：進入類別名對照表，此時不建立資料集、不改動提交狀態。
        request.session["vision_class_name_mapping"] = {
            "submission_id": submission_id,
            "task_id": task_id,
            "class_names_actual": actual,
            "class_names_expected": expected,
        }
        return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=1&mapping=1")

    # outcome == "ready"：類別名與任務預期一致，走既定導入流程。
    return _vision_import_with_dataset(
        request, task_id=task_id, submission_id=submission_id, class_name_mapping=None,
    )


# D2（2026-10-19）：導入失敗原因對照表。
# 教師頁只顯示這裡的中文說明，永不回顯原始例外字串——避免把 URL、憑證或
# 內部堆疊資訊帶到畫面上。
_VISION_IMPORT_ERROR_TEXTS = {
    "vision_api_unavailable": "無法連線到推論服務（Live Backend），請確認服務已啟動後重試。",
    "submission_not_importable": "此提交目前的狀態不可導入（可能已導入或已駁回）。",
    "submission_already_imported": "此提交已導入過，請勿重複導入。",
    "submission_file_missing": "提交的模型檔案不存在，請學員重新上傳。",
    "model_class_names_mismatch": "模型類別數量與任務預期不一致，無法導入。",
    "model_class_names_missing": "模型缺少類別名稱，請補充後重試。",
    "model_class_names_mapping_required": "模型類別名稱與任務預期不同，需要提供類別名對照表。",
    "model_must_be_detection_model": "模型不是目標偵測（detect）模型，無法導入。",
    "smoke_inference_failed": "模型載入後的測試推論失敗，無法導入。",
    "model_file_unreadable": "模型檔案無法讀取。",
    "dataset_binding_mismatch": "資料集綁定不一致，請重新建立資料集後再試。",
    "registered_class_mapping_stale": "已登記的類別映射與模型不符，請洽管理員更新設定檔。",
    "model_quarantined": "此模型已隔離，無法啟用。",
    "validated_model_required": "只有通過驗證的模型才能啟用。",
    "dataset_in_use": "此資料集已被模型引用，不能隔離。",
    "submission_has_models": "此提交已導入為模型，不能直接刪除；請先處理對應的模型版本。",
    "submission_not_found": "找不到這筆提交（可能已被刪除）。",
}


def _vision_error_code(exc) -> str:
    """從包裝層例外字串取出已知的錯誤代碼；未知時回傳 unknown。"""
    raw = str(exc or "")
    for key in _VISION_IMPORT_ERROR_TEXTS:
        if key in raw:
            return key
    return "unknown"


def _vision_error_text(exc, fallback: str = "導入失敗，請稍後再試。") -> str:
    """把例外轉成教師可讀的繁體中文，不洩漏原始字串。"""
    raw = str(exc or "")
    for key, text in _VISION_IMPORT_ERROR_TEXTS.items():
        if key in raw:
            return text
    return fallback


def _vision_record_import_failure(request, submission_id, message: str, code: str = "") -> None:
    """D2：把失敗原因寫回 Live 的 import_last_error（供教師頁持久顯示）。

    Live 不可用時無法寫入持久紀錄，但教師訊息仍會顯示；此處吞掉例外是刻意的，
    避免「記錄失敗」掩蓋真正的導入錯誤。
    """
    if not submission_id:
        return
    try:
        vision_api.record_import_failure(
            submission_id=submission_id,
            message=message,
            code=code,
            teacher_id=request.user.pk,
        )
    except RuntimeError:
        pass


def _vision_quarantine_failed_dataset(request, dataset, submission_id: str, code: str) -> bool:
    """D1：匯入失敗後隔離剛建立的資料集，避免留下可見孤兒。

    只做補償式標記（quarantined=true），不刪除記錄或檔案；失敗時回傳 False，
    由呼叫端在教師訊息中如實說明。
    """
    dataset_id = (dataset or {}).get("dataset_id")
    if not dataset_id:
        return False
    try:
        vision_api.quarantine_dataset(
            dataset_id=dataset_id,
            reason=f"import_failed:{code}",
            source_submission_id=submission_id,
            teacher_id=request.user.pk,
        )
        return True
    except RuntimeError:
        return False


def _vision_import_with_dataset(request, *, task_id, submission_id, class_name_mapping):
    """建立資料集綁定並呼叫 Live 匯入；失敗時完整顯示原因（教師指令⑤）。

    D1/D2（2026-10-19）：
    - 匯入失敗時立刻把剛建立的資料集標記隔離（不刪除），避免可見孤兒；
    - 失敗原因寫入 import_last_error，教師頁以繁體中文持久顯示。
    """
    try:
        dataset = vision_api.create_dataset(
            model_type=task_id,
            dataset_version="v1",
            teacher_id=request.user.pk,
            notes="AI 視覺模型中心自動建立",
        )
    except RuntimeError as exc:
        text = _vision_error_text(exc, "無法建立資料集綁定。")
        _vision_record_import_failure(
            request, submission_id, f"資料集建立失敗：{text}", "dataset_create_failed",
        )
        messages.error(request, f"無法建立資料集綁定：{text}")
        return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=1")

    imported_model_id = ""
    try:
        result = vision_api.import_submission(
            submission_id=submission_id,
            model_name=f"學員模型 {submission_id[-6:]}",
            version="v1",
            dataset_id=dataset["dataset_id"],
            dataset_version=dataset["dataset_version"],
            rule_version="PROP_RULE_v1" if task_id == "PROP_DIRECTION" else "HOVER_RULE_v1",
            teacher_id=request.user.pk,
            notes="由 AI 視覺模型中心導入",
            class_name_mapping=class_name_mapping,
        )
        # 取得導入後的模型編號，攜帶回步驟②預選，實現「選擇模型即進入驗證」。
        if isinstance(result, dict):
            imported_model_id = (
                result.get("model_id")
                or (result.get("model") or {}).get("model_id")
                or str(result.get("id") or "")
            )
    except RuntimeError as exc:
        # D2：先轉成中文說明，再寫入失敗原因（不把原始例外字串寫進教師可見欄位）。
        text = _vision_error_text(exc)
        code = _vision_error_code(exc)
        # D1 補償：匯入失敗 → 隔離本次剛建立的資料集，不留下可見孤兒。
        quarantined = _vision_quarantine_failed_dataset(request, dataset, submission_id, code)
        _vision_record_import_failure(request, submission_id, text, code)
        # 教師指令④：Live 端已保持 submission 為 SUBMITTED，此處僅提示。
        suffix = (
            "本次建立的資料集已標記隔離，不會出現在資料集清單。"
            if quarantined else
            "注意：本次建立的資料集未能標記隔離，請管理員檢查資料集清單。"
        )
        messages.error(
            request,
            f"導入失敗：{text}{suffix}提交保持「待複核」，未被駁回，請教師決定下一步。",
        )
        return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=1")

    messages.success(request, "已導入為候選模型。導入只代表通過格式檢查，仍需完成圖片驗證才可啟用。")
    if imported_model_id:
        return redirect(
            f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=2&model={imported_model_id}"
        )
    return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=1")


@teacher_required
@require_POST
def teacher_vision_center_apply_mapping(request):
    """教師指令③：提交「類別名對照表」後完成導入。

    對照表來自 session（導入前預檢時寫入）；每個模型類別都必須對應到一個
    任務預期類別，否則拒絕導入並保留對照表供教師修正。
    """
    task_id = _vision_task_id(request)
    payload = request.session.pop("vision_class_name_mapping", None)
    if not payload or payload.get("task_id") != task_id:
        messages.error(request, "對照表已過期，請重新按「開始圖片驗證」開始導入。")
        return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=1")

    actual_names = payload.get("class_names_actual") or []
    expected_names = payload.get("class_names_expected") or []
    mapping = {}
    for index, actual in enumerate(actual_names):
        target = (request.POST.get(f"map_{index}") or "").strip()
        if target:
            mapping[actual] = target
    if (
        len(mapping) != len(actual_names)
        or sorted(mapping.values()) != sorted(expected_names)
    ):
        messages.error(
            request,
            "對照表不完整或重複：每個模型類別都必須對應到一個不同的任務預期類別。請補整後再次提交。",
        )
        request.session["vision_class_name_mapping"] = payload
        return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=1&mapping=1")

    return _vision_import_with_dataset(
        request, task_id=task_id, submission_id=payload["submission_id"], class_name_mapping=mapping,
    )


@teacher_required
@require_POST
def teacher_vision_center_activate(request):
    """步驟③：把已驗證模型設為該任務的正式模型。"""
    task_id = _vision_task_id(request)
    model_id = (request.POST.get("model_id") or "").strip()
    if not model_id:
        messages.error(request, "缺少模型編號，無法啟用。")
        return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=3")
    try:
        result = vision_api.activate_model(model_id=model_id, teacher_id=request.user.pk)
    except RuntimeError as exc:
        # D4（2026-10-19）：Live 端拒絕啟用隔離模型（model_quarantined），此處顯示
        # 明確中文說明；其餘失敗沿用既有提示，不洩漏原始例外字串。
        messages.error(
            request,
            f"啟用失敗，原本的正式模型未變更：{_vision_error_text(exc, '請稍後再試。')}",
        )
        return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=3")

    activation = result.get("activation") or {}
    source = activation.get("inference_source") or {}
    # 受控放寬（2026-10-19）：映射版模型啟用後必須留下明確警示，避免被誤認為正式模型。
    if result.get("temporary_mapping") is True:
        messages.warning(
            request,
            "注意：剛啟用的是「映射版·臨時」模型——類別名由筆誤對照而來，"
            "不是用正確 4 類資料訓練的正式模型。建議儘快用正確資料重訓後替換。",
        )
    if source.get("active_model_id") != model_id:
        messages.warning(
            request,
            "啟用已完成，但系統無法確認推論服務已改用新模型，請重新整理後再確認。",
        )
        return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=3")

    previous = activation.get("previous_active_model_id")
    if previous:
        messages.success(
            request,
            "已設為正式模型。原本的正式模型已保留為歷史版本，可隨時回復。",
        )
    else:
        messages.success(request, "已設為正式模型，推論服務已確認使用此模型。")
    return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=3")


@teacher_required
@require_POST
def teacher_vision_center_rollback(request):
    """步驟③：一鍵回復上一個已驗證版本。"""
    task_id = _vision_task_id(request)
    try:
        result = vision_api.rollback_model(model_type=task_id, teacher_id=request.user.pk)
    except RuntimeError as exc:
        messages.error(request, f"回復失敗，目前的正式模型未變更：{exc}")
        return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=3")

    restored = result.get("restored") or {}
    source = result.get("inference_source") or {}
    if source.get("active_model_id") != restored.get("model_id"):
        messages.warning(request, "回復動作已完成，但無法確認推論服務狀態，請重新整理確認。")
        return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=3")
    messages.success(
        request,
        f"已回復到版本 {restored.get('version') or ''}。被替換的版本仍保留在歷史中。",
    )
    return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=3")


@teacher_required
@require_POST
def teacher_vision_center_delete_submission(request):
    """刪除一筆學員上傳的 .pt（教師明確操作）。

    Live 端保證：有模型依賴時拒絕（422）、刪除前自動備份 store 與該提交目錄。
    Django 端只轉發並把結果/失敗原因如實顯示給教師。
    """
    task_id = _vision_task_id(request)
    submission_id = (request.POST.get("submission_id") or "").strip()
    if not submission_id:
        messages.error(request, "缺少提交編號，無法刪除。")
        return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=1")
    try:
        result = vision_api.delete_submission(
            submission_id=submission_id, teacher_id=request.user.pk
        )
    except RuntimeError as exc:
        messages.error(
            request,
            f"刪除失敗，提交記錄與 .pt 檔均未變更：{_vision_error_text(exc, '請稍後再試。')}",
        )
        return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=1")

    if result.get("file_removed"):
        messages.success(
            request,
            f"已刪除學員上傳 {submission_id}：記錄與 .pt 檔均已移除，刪除前已自動備份。",
        )
    else:
        messages.warning(
            request,
            f"已刪除提交記錄 {submission_id}，但實體 .pt 檔不存在（可能已被移除）；刪除前仍已自動備份。",
        )
    return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=1")


@teacher_required
@require_POST
def teacher_vision_center_upload(request):
    """步驟③：教師上傳自己的 best.pt（走同一套安全與契約檢查）。"""
    task_id = _vision_task_id(request)
    upload = request.FILES.get("model_file")
    model_name = (request.POST.get("model_name") or "").strip()
    version = (request.POST.get("version") or "v1").strip() or "v1"

    if not upload:
        messages.error(request, "請選擇要上傳的模型檔案（.pt）。")
        return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=3")
    if not model_name:
        messages.error(request, "請填寫模型名稱。")
        return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=3")
    if not upload.name.lower().endswith(".pt"):
        messages.error(request, "模型檔案必須是 .pt 格式。")
        return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=3")

    content = upload.read()
    try:
        dataset = vision_api.create_dataset(
            model_type=task_id,
            dataset_version="v1",
            teacher_id=request.user.pk,
            notes="教師上傳模型用資料集綁定",
        )
    except RuntimeError:
        try:
            existing = vision_api.list_datasets(model_type=task_id) or []
            dataset = existing[0] if existing else None
        except RuntimeError:
            dataset = None
        if not dataset:
            messages.error(request, "無法建立資料集綁定，請稍後再試。")
            return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=3")

    try:
        vision_api.upload_teacher_model(
            model_type=task_id,
            model_name=model_name,
            version=version,
            content=content,
            dataset_id=dataset["dataset_id"],
            dataset_version=dataset["dataset_version"],
            rule_version="PROP_RULE_v1" if task_id == "PROP_DIRECTION" else "HOVER_RULE_v1",
            teacher_id=request.user.pk,
            notes="由 AI 視覺模型中心上傳",
        )
    except RuntimeError as exc:
        messages.error(
            request,
            f"模型未通過檢查，未新增任何版本：{exc}",
        )
        return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=3")

    messages.success(
        request,
        "模型已通過檢查並新增為版本。請先到「② 圖片驗證」用圖片驗證，再設為正式模型。",
    )
    return redirect(f"{reverse('learning:teacher_vision_center')}?task={task_id}&scene=3")


# --- 五階段學習工作台（P1，2026-10-12 教師指令） ---------------------------------
# 設計約束（教師指令第二、三、四、六節）：
#   1. 只整理入口，不重做既有功能；所有進度、狀態、教師回饋一律取自既有資料，
#      沒有實際資料來源者不得以假資料冒充。
#   2. 凍結保護：R07 提交流程、M1–M4 前端、RAG 學生前端問答、飛行健康、下載中心、
#      MP12 內部程式一律不動；本視圖僅讀取與連結，不改寫任何既有流程。
#   3. 未接入的獨立模組（F450 數位孿生）只顯示「待接入」，不得顯示成可正常使用。
#   4. P2 起各階段成長紀錄槽位一律引用 growth_task_map.STAGE_RECORD_SLOTS，
#      對應表只在該模組維護一份；R03 依 tasks_v1.json（T03＝practice）由 assess
#      改隸屬於 practice（差異說明見 growth_task_map 模組 docstring）。
LEARNING_PATH_STAGES = (
    {
        "key": "learn",
        "character": "學",
        "title": "學習知識",
        "summary": "課程教材、理論知識、SOP 與 AI 助教問答；先建立概念與安全意識。",
        "growth_slots": STAGE_RECORD_SLOTS["learn"],
        "entries": (
            ("學習平台（課程影片與教材）", "platform", "現有主平台首頁，含學／練內容"),
            ("下載中心（課程軟體）", "downloads", "現有下載中心，位置與功能不變"),
            ("AI 助教（RAG 知識庫問答）", "live_coach", "現有 RAG 知識庫與語音教練，功能不重構"),
        ),
        "modules": (),
        "planned": (),
    },
    {
        "key": "practice",
        "character": "練",
        "title": "模擬與練習",
        "summary": "模擬與真機飛行訓練、證照技能訓練；尚未完成的功能標示規劃中。",
        "growth_slots": STAGE_RECORD_SLOTS["practice"],
        "entries": (
            ("模擬器練習（學習平台）", "platform", "現有模擬器與考照練習內容"),
            ("AI 助教（練習即時問答）", "live_coach", "現有 Live 教練／RAG 問答，練習中可隨時查詢"),
        ),
        "modules": (),
        "planned": (
            ("四面懸停", "規劃中"),
            ("起飛與降落", "規劃中"),
            ("八字訓練", "規劃中"),
        ),
    },
    {
        "key": "build",
        "character": "做",
        "title": "專項實訓",
        "summary": "F450 工程組裝、Mission Planner 調參與未來專項任務。",
        "growth_slots": STAGE_RECORD_SLOTS["build"],
        "entries": (
            ("F450 十二任務實訓", "f450_training", "既有 F450 十二任務實訓入口（/platform/f450），沿用不改名、不重構；與 F450 3D 數位孿生為兩個不同模組"),
            ("Mission Planner 調參實訓（MP01–MP12）", "live_coach", "已接入主專案（TASK_07 調參面板）；端到端與教師複核流程仍待教師確認"),
        ),
        # 獨立實訓模組改由 external_modules.py 統一提供（I1，2026-10-13 教師總指令第六節）：
        # F450_DIGITAL_TWIN 預設 DISABLED → 只顯示「待接入」，不產生連結或假完成狀態。
        "modules": (),
        "planned": (
            ("3D 列印", "規劃中"),
            ("航線規劃", "規劃中"),
            ("三維建模", "規劃中"),
            ("巡檢與產業 SOP", "規劃中"),
            ("無人車", "規劃中"),
        ),
    },
    {
        "key": "assess",
        "character": "測",
        "title": "能力考核",
        "summary": "鷹眼 AI 目標檢測與 AI 飛行評測；本輪不開發新的自動評分系統。",
        "growth_slots": STAGE_RECORD_SLOTS["assess"],
        "entries": (
            ("手機槳葉方向辨識（M1–M4）", "prop_scan", "現有 M1–M4 檢測頁，手機版排版凍結保護"),
            ("飛行健康 AI", "flight_health", "現有外部服務連結，原導航入口保持不變"),
        ),
        "modules": (),
        "planned": (),
    },
    {
        "key": "certify",
        "character": "證",
        "title": "成長日誌",
        "summary": "R07 專業任務驗證、R08 綜合成果展示；Evidence／Submission／教師複核流程不修改。",
        "growth_slots": STAGE_RECORD_SLOTS["certify"],
        "entries": (
            ("我的學習成長日誌（R01–R08 總覽）", "growth_dashboard", "既有成長日誌總覽頁，含教師複核結果；不重構"),
        ),
        "modules": (),
        "planned": (),
    },
)


@student_required
def student_learning_path_entry(request):
    """五階段學習工作台入口：單一在學課程直接進入，其餘回到學員總覽選擇。"""
    enrollments = list(
        Enrollment.objects.filter(
            student=request.student_profile,
            active=True,
        ).order_by("pk")[:2]
    )
    if len(enrollments) == 1:
        return redirect("learning:student_learning_path", enrollment_id=enrollments[0].pk)
    return redirect("learning:student_dashboard")


def _learning_path_entry_urls(enrollment):
    """只列已確認可用的現有入口（皆為 2026-10-12 實際碼境核對之路由）。"""
    return {
        "platform": reverse("learning:platform"),
        "downloads": "/downloads/",
        "live_coach": "/live/",
        "f450_training": "/platform/f450",
        "growth_dashboard": reverse("learning:student_growth_dashboard", args=[enrollment.pk]),
        "prop_scan": reverse("learning:student_prop_scan", args=[enrollment.pk]),
        "flight_health": "/flight-health/",
    }


@student_required
def student_learning_path(request, enrollment_id):
    enrollment = get_object_or_404(
        Enrollment.objects.select_related("cohort", "group", "student"),
        pk=enrollment_id,
        student=request.student_profile,
        active=True,
    )
    profile = request.student_profile
    submissions = ensure_growth_submissions(enrollment)
    submission_by_slot = {item.definition.slot_id: item for item in submissions}

    tasks = list(TaskDefinition.objects.filter(active=True).order_by("sort_order", "task_id"))
    for task in tasks:
        StudentTaskProgress.objects.get_or_create(enrollment=enrollment, task=task)
    progress_by_task = {
        item.task_id: item for item in StudentTaskProgress.objects.filter(enrollment=enrollment)
    }
    for phase, _ in TaskDefinition.Stage.choices:
        PhaseProgress.objects.get_or_create(enrollment=enrollment, phase=phase)
    phase_by_key = {item.phase: item for item in PhaseProgress.objects.filter(enrollment=enrollment)}

    entry_urls = _learning_path_entry_urls(enrollment)
    review_status_choices = dict(GrowthRecordReview.Status.choices)
    # I2-B：外部模組狀態需依角色判定（權限不足 vs 服務不可用不可互冒）。
    workbench_role = "teacher" if request.user.is_staff else "student"
    stage_rows = []
    for meta in LEARNING_PATH_STAGES:
        growth_rows = []
        for slot in meta["growth_slots"]:
            submission = submission_by_slot.get(slot)
            if submission is None:
                continue
            definition = submission.definition
            review = submission.reviews.select_related("reviewer").first()
            growth_rows.append(
                {
                    "slot_id": slot,
                    "title": definition.title,
                    "description": definition.description,
                    "requirements": list(definition.completion_requirements or []),
                    "evidence": list(definition.evidence_requirement or []),
                    "learning_resource": list(definition.learning_resource or []),
                    "stage_key": meta["key"],
                    "stage_title": meta["title"],
                    "status_key": submission.status,
                    "status_label": student_status_label(submission.status),
                    # 教師複核狀態只在真有 GrowthRecordReview 紀錄時顯示；
                    # 沒有教師審核不得顯示「已透過」，也不得虛構回饋。
                    "review_label": (
                        review_status_choices.get(review.review_status, review.review_status)
                        if review is not None
                        else None
                    ),
                    "teacher_note": review.teacher_note if review is not None else "",
                    "teacher_score": review.score if review is not None else None,
                    "url": reverse("learning:growth_record_detail", args=[enrollment.pk, slot]),
                }
            )
        task_rows = []
        for task in tasks:
            if task.stage != meta["key"]:
                continue
            progress = progress_by_task[task.task_id]
            record_slot = task_record_slot(task.task_id)
            record_submission = submission_by_slot.get(record_slot) if record_slot else None
            related_rows = []
            for related_slot in task_related_records(task.task_id):
                related = submission_by_slot.get(related_slot)
                if related is None:
                    continue
                related_rows.append(
                    {
                        "slot_id": related_slot,
                        "title": related.definition.title,
                        "url": reverse(
                            "learning:growth_record_detail",
                            args=[enrollment.pk, related_slot],
                        ),
                    }
                )
            task_rows.append(
                {
                    "task_id": task.task_id,
                    "display_id": task_display_id(task.task_id),
                    "title": task.title,
                    "description": task.description,
                    "requirements": list(task.requirements or []),
                    "evidence_required": list(task.evidence_required or []),
                    "stage_key": meta["key"],
                    "stage_title": meta["title"],
                    "record_slot": record_slot,
                    "record_title": (
                        record_submission.definition.title if record_submission is not None else None
                    ),
                    "record_status_label": (
                        student_status_label(record_submission.status)
                        if record_submission is not None
                        else None
                    ),
                    "record_url": (
                        reverse("learning:growth_record_detail", args=[enrollment.pk, record_slot])
                        if record_submission is not None
                        else None
                    ),
                    "related_records": related_rows,
                    "map_note": task_map_note(task.task_id),
                    "status_key": progress.status,
                    "status_label": task_status_label(progress.status),
                    "teacher_note": progress.teacher_note,
                    "teacher_score": progress.teacher_score,
                    "url": reverse("learning:task_detail", args=[enrollment.pk, task.task_id]),
                }
            )
        phase = phase_by_key.get(meta["key"])
        # 獨立實訓模組：靜態 modules（若有）＋ external_modules.py 註冊模組。
        # I2-B 四狀態（已可使用／尚未接入／服務暫時不可用／權限不足）一律由接口層判定，
        # 非「已可使用」時 url 為空 → 模板只顯示徽章與說明，不產生任何連結。
        module_rows = [
            {
                "name": name,
                "state": state,
                "note": note,
                "url": "",
                "status_key": "not-integrated",
                "module_id": "",
                "availability_status": "NOT_INTEGRATED",
                "allowed_roles": [],
                "integration_version": "",
                "external": False,
            }
            for name, state, note in meta["modules"]
        ]
        for external in external_modules_for_stage(meta["key"], role=workbench_role):
            module_rows.append(
                {
                    "name": external["name"],
                    "state": external["state"],
                    "note": external["note"],
                    "url": external["url"],
                    "status_key": external["status_key"],
                    "module_id": external["module_id"],
                    "availability_status": external["availability_status"],
                    "allowed_roles": external["allowed_roles"],
                    "integration_version": external["integration_version"],
                    "external": True,
                }
            )
        stage_rows.append(
            {
                **meta,
                "phase": phase,
                "phase_status_label": (
                    dict(PhaseProgress.Status.choices).get(phase.status, phase.status) if phase else None
                ),
                "growth_rows": growth_rows,
                "task_rows": task_rows,
                "entries": [
                    {"name": name, "url": entry_urls[key], "note": note} for name, key, note in meta["entries"]
                ],
                "modules": module_rows,
                "planned": [{"name": name, "state": state} for name, state in meta["planned"]],
            }
        )

    current_stage_key = None
    for wanted in (PhaseProgress.Status.IN_PROGRESS, PhaseProgress.Status.NOT_STARTED):
        for row in stage_rows:
            if row["phase"] is not None and row["phase"].status == wanted:
                current_stage_key = row["key"]
                break
        if current_stage_key:
            break

    feedback_rows = []
    for task in tasks:
        progress = progress_by_task.get(task.task_id)
        if progress is None:
            continue
        if not progress.teacher_note and progress.teacher_score is None:
            continue
        feedback_rows.append(
            {
                "source": "任務",
                "title": task.title,
                "note": progress.teacher_note,
                "score": progress.teacher_score,
                "status_label": task_status_label(progress.status),
                "url": reverse("learning:task_detail", args=[enrollment.pk, task.task_id]),
            }
        )
    for submission in submissions:
        review = submission.reviews.select_related("reviewer").first()
        if review is None:
            continue
        feedback_rows.append(
            {
                "source": f"成長紀錄 {submission.definition.slot_id}",
                "title": submission.definition.title,
                "note": review.teacher_note,
                "score": review.score,
                "status_label": review.get_review_status_display(),
                "url": reverse(
                    "learning:growth_record_detail",
                    args=[enrollment.pk, submission.definition.slot_id],
                ),
            }
        )

    stage_order = [row["key"] for row in stage_rows]
    current_stage = next((row for row in stage_rows if row["key"] == current_stage_key), None)
    return render(
        request,
        "learning/student_learning_path.html",
        {
            "profile": profile,
            "enrollment": enrollment,
            "direction_label": direction_label(enrollment.project_direction),
            "stage_rows": stage_rows,
            "stage_order": stage_order,
            "current_stage": current_stage,
            "growth_record_count": len(submissions),
            "growth_submitted_count": sum(
                item.status in GROWTH_SUBMITTED_STATUSES for item in submissions
            ),
            "growth_reviewed_count": sum(
                item.status in GROWTH_REVIEWED_STATUSES for item in submissions
            ),
            "feedback_rows": feedback_rows,
        },
    )


# 設計約束（教師 P3 指令，2026-10-13）：
#   1. 只彙整既有資料：班級學員人數、學員 × R01–R08 逐槽狀態、五階段進度、待複核清單，
#      一律取自 GrowthRecordSubmission／StudentTaskProgress／PhaseProgress 與 P2 的
#      STAGE_RECORD_SLOTS；沒有實際資料不得以假資料冒充。
#   2. 不建立第二套複核系統：本頁只讀與連結；複核表單仍留在既有教師學員詳情頁
#      （teacher_student_detail 的 R01～R08 表單 POST 至 growth_review）。
#   3. 權限不變：沿用 teacher_cohorts(request.user)，教師只看被授權班級。
#   4. 凍結保護：不改寫任何成長紀錄／任務進度／教師複核流程，僅 get_or_create 與彙整。
@teacher_required
def teacher_class_outcomes(request):
    """班級學習成果總覽：班級與人數、學員 × R01–R08 狀態矩陣、五階段概況、待複核清單。

    P4.1：待複核清單支援四種排序（穩定次要鍵）與三項篩選（紀錄槽位／類型／狀態），
    學員進度列表支援進度篩選；全部條件可同時使用且互相保留。
    """
    cohorts = list(teacher_cohorts(request.user).order_by("cohort_id"))
    selected_cohort = request.GET.get("cohort", "").strip()
    pending_sort = (request.GET.get("sort", "") or "").strip().lower()
    if pending_sort not in dict(PENDING_SORT_OPTIONS):
        pending_sort = DEFAULT_PENDING_SORT
    record_filter = (request.GET.get("p_record", "") or "").strip().upper()
    if record_filter not in GROWTH_RECORD_SLOT_IDS:
        record_filter = ""
    type_filter = (request.GET.get("p_type", "") or "").strip().lower()
    if type_filter not in dict(PENDING_TYPE_OPTIONS):
        type_filter = ""
    status_filter = (request.GET.get("p_status", "") or "").strip().lower()
    if status_filter not in dict(PENDING_STATUS_OPTIONS):
        status_filter = DEFAULT_PENDING_STATUS
    progress_filter = (request.GET.get("s_state", "") or "").strip().lower()
    if progress_filter not in dict(PROGRESS_FILTER_OPTIONS):
        progress_filter = ""
    stage_meta = {meta["key"]: meta for meta in LEARNING_PATH_STAGES}
    stage_keys = [key for key, _ in TaskDefinition.Stage.choices]

    type_label_by_key = {"成長紀錄": "growth", "任務": "task"}

    def pending_row_visible(row):
        """P4.1 篩選：班級由頁面班級篩選（既有）限定；此處處理紀錄／類型／狀態。"""
        if record_filter:
            if row["kind"] == "成長紀錄":
                # 成長紀錄依自身槽位比對。
                if row["code"] != record_filter:
                    return False
            elif record_filter not in row.get("record_slots", ()):
                # 任務提交只在 P2 對應表 genuinely 對應時才納入；
                # 沒有對應 R 槽位的任務不得被強行歸類。
                return False
        if type_filter and type_label_by_key.get(row["kind"]) != type_filter:
            return False
        if status_filter != "all" and row.get("status_key") != status_filter:
            return False
        return True

    class_rows = []
    for cohort in cohorts:
        if selected_cohort and cohort.cohort_id != selected_cohort:
            continue
        enrollments = list(
            Enrollment.objects.filter(cohort=cohort, active=True)
            .select_related("student__user", "group")
            .order_by("student__public_user_id")
        )
        student_rows = []
        pending_rows = []
        stage_progress = {key: {"done": 0, "total": 0} for key in stage_keys}
        for enrollment in enrollments:
            # 與學員端同一套 ensure_growth_submissions：缺紀錄時建立，不另立資料源。
            submissions = ensure_growth_submissions(enrollment)
            # 五階段進度列與教師學員詳情頁同一模式：缺列時建立，彙整分母＝班級人數。
            for phase, _ in TaskDefinition.Stage.choices:
                PhaseProgress.objects.get_or_create(enrollment=enrollment, phase=phase)
            slot_cells = [
                {
                    "slot_id": item.definition.slot_id,
                    "status_key": item.status,
                    "status_label": student_status_label(item.status),
                }
                for item in submissions
            ]
            for phase in ordered_phase_progress(enrollment):
                stage_progress[phase.phase]["total"] += 1
                if phase.status == PhaseProgress.Status.COMPLETED:
                    stage_progress[phase.phase]["done"] += 1
            # P4.1：待複核清單含「已提交（待教師複核）」與「需要補充（待學員補件）」兩態；
            # 任務提交僅有 submitted 一態，不強行對應其他狀態。
            # P5-A：改以 build_pending_work_item 建立單一格式項目，並同步累計
            # 該學員的工作項目，使「班級卡片筆數」與「學員篩選人數」共用同一集合。
            student_work_items = []
            for item in submissions:
                if item.status not in (
                    GrowthRecordSubmission.Status.SUBMITTED,
                    GrowthRecordSubmission.Status.NEEDS_REVISION,
                ):
                    continue
                work_item = build_pending_work_item(
                    kind="成長紀錄",
                    code=item.definition.slot_id,
                    title=item.definition.title,
                    student=enrollment.student,
                    submitted_at=item.submitted_at,
                    status_key=item.status,
                    # 一律連回既有教師學員詳情頁的 R01～R08 複核區（不新建複核功能）。
                    url=reverse("learning:teacher_student_detail", args=[enrollment.pk])
                    + "#growth-records",
                )
                student_work_items.append(work_item)
                pending_rows.append(work_item)
            for item in StudentTaskProgress.objects.filter(
                enrollment=enrollment,
                status=StudentTaskProgress.Status.SUBMITTED,
            ).select_related("task"):
                # 任務在 P2 對應表上的槽位（一對一＋相關）；無對應時為空tuple，
                # 因此紀錄篩選不會把沒有對應 R 槽位的任務強行歸類。
                task_slots = {task_record_slot(item.task.task_id)} | set(
                    task_related_records(item.task.task_id)
                )
                task_slots.discard(None)
                work_item = build_pending_work_item(
                    kind="任務",
                    code=task_display_id(item.task.task_id),
                    title=item.task.title,
                    student=enrollment.student,
                    submitted_at=item.submitted_at,
                    status_key=StudentTaskProgress.Status.SUBMITTED,
                    url=reverse("learning:teacher_student_detail", args=[enrollment.pk]),
                    task_id=item.task.task_id,
                    record_slots=tuple(sorted(task_slots)),
                )
                student_work_items.append(work_item)
                pending_rows.append(work_item)
            # P5-A：學員層級「待複核」與「需要補充」筆數，來源與班級卡片完全相同。
            student_pending_count = sum(
                1 for work in student_work_items if work["group"] == "pending_review"
            )
            student_needs_revision_count = sum(
                1 for work in student_work_items if work["group"] == "needs_revision"
            )
            student_rows.append(
                {
                    "enrollment": enrollment,
                    "student": enrollment.student,
                    "slot_cells": slot_cells,
                    "submitted_count": sum(item.status in GROWTH_SUBMITTED_STATUSES for item in submissions),
                    "reviewed_count": sum(item.status in GROWTH_REVIEWED_STATUSES for item in submissions),
                    # P5-A：與班級卡片同一工作項目集合（含任務提交），修正原僅計成長紀錄的口徑。
                    "pending_count": student_pending_count,
                    "needs_revision_count": student_needs_revision_count,
                    # P4 UI/UX：學員進度列表的視覺分組（顯示用，不改變統計規則）。
                    "progress_state": (
                        "complete"
                        if sum(item.status in GROWTH_SUBMITTED_STATUSES for item in submissions) == len(slot_cells)
                        else (
                            "none"
                            if not any(item.status in GROWTH_SUBMITTED_STATUSES for item in submissions)
                            else "partial"
                        )
                    ),
                    "detail_url": reverse("learning:teacher_student_detail", args=[enrollment.pk]),
                }
            )
        # P4 統計卡片（顯示用彙整，計數規則與矩陣完全同一套）：
        # 尚未提交＝已提交數 0；已完成八項＝已提交數等於 R01–R08 槽位總數（8）；
        # 待複核成果卡片固定為「待教師複核（submitted）」數（P4 語意，不隨狀態篩選變動）。
        # P5-A：單位一律為「筆」（成果筆數），並標示資料來源；
        # 學員篩選的「有待複核成果」則為「人數」，兩者共用同一工作項目集合。
        not_submitted_count = sum(1 for row in student_rows if row["submitted_count"] == 0)
        all_submitted_count = sum(1 for row in student_rows if row["submitted_count"] == 8)
        pending_total = sum(1 for row in pending_rows if row["group"] == "pending_review")
        needs_revision_total = sum(1 for row in pending_rows if row["group"] == "needs_revision")
        pending_source_counts = [
            {
                "kind": kind,
                "source_label": source,
                "count": sum(
                    1
                    for row in pending_rows
                    if row["group"] == "pending_review" and row["kind"] == kind
                ),
            }
            for kind, source in PENDING_SOURCE_LABELS.items()
        ]
        pending_student_count = sum(1 for row in student_rows if row["pending_count"] > 0)
        # P4.1 篩選 → 排序（穩定次要鍵；時間缺失排最後）。
        visible_rows = [row for row in pending_rows if pending_row_visible(row)]
        visible_rows = sort_pending_rows(visible_rows, pending_sort)
        visible_student_rows = [
            row for row in student_rows if _progress_filter_matches(row, progress_filter)
        ]
        stage_rows = [
            {
                "key": key,
                "character": stage_meta[key]["character"],
                "title": stage_meta[key]["title"],
                "done": stage_progress[key]["done"],
                "total": stage_progress[key]["total"],
            }
            for key in stage_keys
        ]
        class_rows.append(
            {
                "cohort": cohort,
                "student_count": len(enrollments),
                "student_rows": student_rows,
                "visible_student_rows": visible_student_rows,
                "stage_rows": stage_rows,
                "pending_rows": visible_rows,
                "pending_count": pending_total,
                "needs_revision_count": needs_revision_total,
                "pending_source_counts": pending_source_counts,
                "pending_student_count": pending_student_count,
                "pending_filtered": len(visible_rows) != len(pending_rows),
                "not_submitted_count": not_submitted_count,
                "all_submitted_count": all_submitted_count,
            }
        )

    return render(
        request,
        "learning/teacher_class_outcomes.html",
        {
            "class_rows": class_rows,
            "cohorts": cohorts,
            "selected_cohort": selected_cohort,
            "pending_sort": pending_sort,
            "pending_sort_options": PENDING_SORT_OPTIONS,
            "pending_type_options": PENDING_TYPE_OPTIONS,
            "pending_status_options": PENDING_STATUS_OPTIONS,
            "progress_filter_options": PROGRESS_FILTER_OPTIONS,
            "record_slot_ids": GROWTH_RECORD_SLOT_IDS,
            "record_filter": record_filter,
            "type_filter": type_filter,
            "status_filter": status_filter,
            "progress_filter": progress_filter,
            "filters_active": bool(record_filter or type_filter or status_filter != DEFAULT_PENDING_STATUS),
        },
    )


# ── P5-B／P5-C（2026-10-13 教師指令）：班級結訓成果報告與展示 ─────────────────
# 只讀彙整既有資料；不新建資料管理系統、不建伺服器 PDF、不建 PPT 產生器。
# 所有數字皆來自既有成長紀錄、任務進度與教師複核紀錄；無資料一律顯示「尚無紀錄」。
# 不得虛構成績、照片、證照或教師評語；「八項已提交」不等於「八項通過」。
REPORT_FEEDBACK_LIMIT = 200


def _report_slot_stats(enrollments, submission_map, slot_ids, slot_titles=None):
    """P5-B：R01–R08 逐槽提交／複核統計（只讀，與矩陣同一套狀態定義）。"""
    slot_titles = slot_titles or {}
    rows = []
    for slot_id in slot_ids:
        submitted = 0
        reviewed = 0
        for enrollment in enrollments:
            submission = submission_map.get(enrollment.pk, {}).get(slot_id)
            if submission is None:
                continue
            if submission.status in GROWTH_SUBMITTED_STATUSES:
                submitted += 1
            if submission.status in GROWTH_REVIEWED_STATUSES:
                reviewed += 1
        rows.append(
            {
                "slot_id": slot_id,
                "title": slot_titles.get(slot_id, ""),
                "submitted": submitted,
                "reviewed": reviewed,
                "total": len(enrollments),
            }
        )
    return rows


def build_cohort_report(cohort):
    """班級成果彙整（**P5／P6／P7 單一統計來源**，**P9 起為純唯讀**）。

    P5 報告頁、P6 結訓審核清單與 P6 兩種 CSV 匯出、P7 成果展示頁皆呼叫本函式，
    確保各處數字完全一致。無資料一律留空，由模板顯示「尚無紀錄」。
    不虛構成績／照片／證照／教師評語；「八項已提交」不等於「八項通過」。

    P8-A 副作用稽核結論（2026-10-13，`demo/tools/audit_p8_readonly.py`）：
      本函式當時為「讀取 ＋ 冪等惰性初始化」——
        - 資料齊備時：GET／CSV 匯出皆不產生任何寫入（已逐表指紋驗證）。
        - 資料缺失時：會補建成長紀錄提交（`ensure_growth_submissions`）與
          階段進度（`PhaseProgress.get_or_create`）。

    P9-A 唯讀化（2026-10-13，`demo/tools/audit_p9_readonly.py`）：
      上述惰性初始化已自本函式**移出**，改用唯讀版本：
        - 槽位計畫改呼叫 `growth_record_slot_plan()`（不建立任何資料列）。
        - 階段分母改以**在學學員數**計算（不依賴 PhaseProgress 資料列）。
        - 缺定義／缺提交列時以 `VirtualGrowthDefinition`／
          `VirtualGrowthSubmission`（狀態 NOT_STARTED）表達「未開始」，
          因此 **0 項提交的學員不會從統計中消失**。
      `ensure_growth_submissions()` **未被刪除**，學員端與教師寫入路徑照常使用。
      統計等價性已由 `tests/test_p9_readonly_report.py` 以 13 個情境
      （含缺提交列、缺階段進度、完全未 seed、小組覆寫、空班級、多班級）
      與修正前基準逐項比對通過。
    """
    enrollments = list(
        Enrollment.objects.filter(cohort=cohort, active=True)
        .select_related("student__user", "group")
        .order_by("student__public_user_id")
    )
    slot_ids = list(GROWTH_RECORD_SLOT_IDS)
    stage_keys = [key for key, _ in TaskDefinition.Stage.choices]

    submission_map = {}
    slot_titles = {}
    evidence_by_enrollment = {}
    stage_progress = {key: {"done": 0, "total": 0} for key in stage_keys}
    student_rows = []
    feedback_rows = []
    pending_items_total = 0
    needs_revision_total = 0
    pending_student_count = 0
    # P6-A：班級層級彙總清單（與 P5 報告共用同一份彙整，不另立統計）。
    pending_work_items = []  # 待教師複核 ＋ 需要補充（P5-A 同一工作項目集合）
    unsubmitted_items = []  # R01–R08 尚未提交（狀態非 submitted/needs_revision/approved/rejected）
    review_result_rows = []  # 已有教師複核結果（成長紀錄複核紀錄＋任務複核結果）

    for enrollment in enrollments:
        # P9-A：唯讀槽位計畫（不建立任何資料列）。缺定義／缺提交列時以等價的
        # 記憶體替身表達「未開始」，因此 0 項提交的學員不會從統計中消失，
        # R01–R08 與五階段語意皆不變（等價性由 test_p9_readonly_report.py 證明）。
        submissions = growth_record_slot_plan(enrollment)
        by_slot = {item.definition.slot_id: item for item in submissions}
        submission_map[enrollment.pk] = by_slot
        for slot_id, submission in by_slot.items():
            slot_titles.setdefault(slot_id, submission.definition.title)
        # P9-A：五階段分母＝在學學員數（不依賴資料列是否存在）；缺資料列等同
        # 「尚未開始」，與補建後（get_or_create → NOT_STARTED）語意一致。
        progress_by_phase = {
            item.phase: item for item in PhaseProgress.objects.filter(enrollment=enrollment)
        }
        for phase, _ in TaskDefinition.Stage.choices:
            stage_progress[phase]["total"] += 1
            item = progress_by_phase.get(phase)
            if item is not None and item.status == PhaseProgress.Status.COMPLETED:
                stage_progress[phase]["done"] += 1

        # 待複核工作項目（P5-A 同一集合：成長紀錄＋任務提交）。
        student_work_items = []
        # P6-A：R01–R08 尚未提交項目（與 GROWTH_SUBMITTED_STATUSES 互補，非新定義）。
        student_unsubmitted = []
        for submission in submissions:
            if submission.status not in GROWTH_SUBMITTED_STATUSES:
                student_unsubmitted.append(
                    {
                        "kind": "成長紀錄",
                        "source_label": PENDING_SOURCE_LABELS["成長紀錄"],
                        "code": submission.definition.slot_id,
                        "title": submission.definition.title,
                        "student": enrollment.student,
                        "status_key": submission.status,
                        "status_label": student_status_label(submission.status),
                        "url": reverse("learning:teacher_student_detail", args=[enrollment.pk])
                        + "#growth-records",
                    }
                )
            if submission.status not in (
                GrowthRecordSubmission.Status.SUBMITTED,
                GrowthRecordSubmission.Status.NEEDS_REVISION,
            ):
                continue
            student_work_items.append(
                build_pending_work_item(
                    kind="成長紀錄",
                    code=submission.definition.slot_id,
                    title=submission.definition.title,
                    student=enrollment.student,
                    submitted_at=submission.submitted_at,
                    status_key=submission.status,
                    url=reverse("learning:teacher_student_detail", args=[enrollment.pk])
                    + "#growth-records",
                )
            )
        for progress in StudentTaskProgress.objects.filter(
            enrollment=enrollment, status=StudentTaskProgress.Status.SUBMITTED
        ).select_related("task"):
            student_work_items.append(
                build_pending_work_item(
                    kind="任務",
                    code=task_display_id(progress.task.task_id),
                    title=progress.task.title,
                    student=enrollment.student,
                    submitted_at=progress.submitted_at,
                    status_key=StudentTaskProgress.Status.SUBMITTED,
                    url=reverse("learning:teacher_student_detail", args=[enrollment.pk]),
                    task_id=progress.task.task_id,
                )
            )
        student_pending = sum(1 for item in student_work_items if item["group"] == "pending_review")
        student_needs = sum(1 for item in student_work_items if item["group"] == "needs_revision")
        pending_items_total += student_pending
        needs_revision_total += student_needs
        if student_pending:
            pending_student_count += 1
        pending_work_items.extend(student_work_items)
        unsubmitted_items.extend(student_unsubmitted)

        # 教師回饋：只取真有 GrowthRecordReview 紀錄且填有評語者（不虛構）。
        # P6-A：同時彙整「已有教師複核結果」（含未填評語者，用於結訓審核清單）。
        student_reviewed_items = []
        for submission in submissions:
            for review in submission.reviews.select_related("reviewer").order_by("-reviewed_at"):
                review_result_rows.append(
                    {
                        "source_label": "成長紀錄",
                        "code": submission.definition.slot_id,
                        "title": submission.definition.title,
                        "student": enrollment.student,
                        "review_status": review.review_status,
                        "review_status_label": dict(GrowthRecordReview.Status.choices).get(
                            review.review_status, review.review_status
                        ),
                        "score": review.score,
                        "note": (review.teacher_note or "").strip(),
                        "reviewed_at": review.reviewed_at,
                        "reviewer": review.reviewer,
                    }
                )
                student_reviewed_items.append(review_result_rows[-1])
                if not (review.teacher_note or "").strip():
                    continue
                feedback_rows.append(
                    {
                        "source_label": "成長紀錄",
                        "code": submission.definition.slot_id,
                        "title": submission.definition.title,
                        "student": enrollment.student,
                        "review_status": review.review_status,
                        "review_status_label": dict(GrowthRecordReview.Status.choices).get(
                            review.review_status, review.review_status
                        ),
                        "score": review.score,
                        "note": review.teacher_note.strip(),
                        "reviewed_at": review.reviewed_at,
                        "reviewer": review.reviewer,
                    }
                )
        for progress in StudentTaskProgress.objects.filter(enrollment=enrollment).select_related("task"):
            # P6-A：任務已有複核結果＝狀態為「教師已複核」或已填評語／評分。
            if progress.status == StudentTaskProgress.Status.REVIEWED or (
                (progress.teacher_note or "").strip() or progress.teacher_score is not None
            ):
                row = {
                    "source_label": "任務提交",
                    "code": task_display_id(progress.task.task_id),
                    "title": progress.task.title,
                    "student": enrollment.student,
                    "review_status": progress.status,
                    "review_status_label": task_status_label(progress.status),
                    "score": progress.teacher_score,
                    "note": (progress.teacher_note or "").strip(),
                    "reviewed_at": progress.reviewed_at or progress.updated_at,
                    "reviewer": None,
                }
                review_result_rows.append(row)
                student_reviewed_items.append(row)
            if not (progress.teacher_note or "").strip():
                continue
            feedback_rows.append(
                {
                    "source_label": "任務提交",
                    "code": task_display_id(progress.task.task_id),
                    "title": progress.task.title,
                    "student": enrollment.student,
                    "review_status": progress.status,
                    "review_status_label": task_status_label(progress.status),
                    "score": progress.teacher_score,
                    "note": progress.teacher_note.strip(),
                    "reviewed_at": progress.updated_at,
                    "reviewer": None,
                }
            )

        # 學員成果證據（沿用既有授權檢查的 evidence_download；只做縮圖／連結）。
        evidence_rows = []
        for submission in submissions:
            for evidence in submission.evidence.all():
                evidence_rows.append(
                    {
                        "slot_id": submission.definition.slot_id,
                        "evidence_id": evidence.pk,
                        "type": evidence.evidence_type,
                        "type_label": evidence.get_evidence_type_display(),
                        "description": evidence.description,
                        "is_image": evidence.evidence_type == Evidence.Type.IMAGE and bool(evidence.upload),
                        "has_upload": bool(evidence.upload),
                        "external_url": evidence.external_url,
                    }
                )
        evidence_by_enrollment[enrollment.pk] = evidence_rows

        completed_stages = sum(
            1
            for phase in ordered_phase_progress(enrollment)
            if phase.status == PhaseProgress.Status.COMPLETED
        )
        student_rows.append(
            {
                "enrollment": enrollment,
                "student": enrollment.student,
                "group": enrollment.group,
                "direction_label": direction_label(enrollment.project_direction),
                "training_source_label": enrollment.get_training_source_display() or "",
                "submitted_count": sum(
                    1 for item in submissions if item.status in GROWTH_SUBMITTED_STATUSES
                ),
                "reviewed_count": sum(
                    1 for item in submissions if item.status in GROWTH_REVIEWED_STATUSES
                ),
                "pending_count": student_pending,
                "needs_revision_count": student_needs,
                # P6-A：每位學員尚待處理的項目（尚未提交 ＋ 待教師複核 ＋ 需要補充）。
                "outstanding_items": list(student_unsubmitted) + list(student_work_items),
                "outstanding_count": len(student_unsubmitted) + len(student_work_items),
                "unsubmitted_count": len(student_unsubmitted),
                "reviewed_items": list(student_reviewed_items),
                "reviewed_result_count": len(student_reviewed_items),
                "completed_stages": completed_stages,
                "stage_total": len(stage_keys),
                "evidence_count": len(evidence_rows),
                "evidence_rows": evidence_rows,
                "slot_cells": [
                    {
                        "slot_id": submission.definition.slot_id,
                        "status_key": submission.status,
                        "status_label": student_status_label(submission.status),
                    }
                    for submission in submissions
                ],
                "detail_url": reverse("learning:teacher_student_detail", args=[enrollment.pk]),
            }
        )

    feedback_rows.sort(key=lambda row: (row["reviewed_at"] is None, row["reviewed_at"]), reverse=False)
    feedback_rows = list(reversed(feedback_rows))[:REPORT_FEEDBACK_LIMIT]

    slot_stats = _report_slot_stats(enrollments, submission_map, slot_ids, slot_titles)
    stage_meta = {meta["key"]: meta for meta in LEARNING_PATH_STAGES}
    stage_rows = [
        {
            "key": key,
            "character": stage_meta[key]["character"],
            "title": stage_meta[key]["title"],
            "done": stage_progress[key]["done"],
            "total": stage_progress[key]["total"],
        }
        for key in stage_keys
    ]

    # 課程資訊（只彙整既有欄位，無資料顯示「尚無紀錄」）。
    direction_counts = {}
    for enrollment in enrollments:
        label = direction_label(enrollment.project_direction)
        direction_counts[label] = direction_counts.get(label, 0) + 1
    training_counts = {}
    for enrollment in enrollments:
        label = enrollment.get_training_source_display() or "未填寫"
        training_counts[label] = training_counts.get(label, 0) + 1

    return {
        "cohort": cohort,
        "student_count": len(enrollments),
        "generated_at": timezone.now(),
        "slot_stats": slot_stats,
        "slot_titles": slot_titles,
        "stage_rows": stage_rows,
        "student_rows": student_rows,
        "feedback_rows": feedback_rows,
        "pending_items_total": pending_items_total,
        "needs_revision_total": needs_revision_total,
        "pending_student_count": pending_student_count,
        "total_submitted": sum(row["submitted_count"] for row in student_rows),
        "total_reviewed": sum(row["reviewed_count"] for row in student_rows),
        "direction_counts": sorted(direction_counts.items(), key=lambda item: item[0]),
        "training_counts": sorted(training_counts.items(), key=lambda item: item[0]),
        "not_submitted_count": sum(1 for row in student_rows if row["submitted_count"] == 0),
        "all_submitted_count": sum(1 for row in student_rows if row["submitted_count"] == 8),
        # P6-A：結訓審核清單所需的班級層級清單（皆由同一份彙整導出）。
        "pending_work_items": pending_work_items,
        "unsubmitted_items": unsubmitted_items,
        "review_result_rows": review_result_rows,
        "reviewed_result_total": len(review_result_rows),
        "unsubmitted_items_total": len(unsubmitted_items),
        "outstanding_total": len(pending_work_items) + len(unsubmitted_items),
    }


@teacher_required
def teacher_class_report(request, cohort_id=None):
    """班級結訓成果報告（P5-B／P5-C）。

    版面順序：班級基本資料 → 班級成果摘要 → 五階段學習概況 → R01–R08 成長成果
    → 學員成果列表 → 教師回饋。列印使用瀏覽器原生列印＋print CSS（不建伺服器 PDF）。
    """
    cohorts = list(teacher_cohorts(request.user).order_by("cohort_id"))
    requested = (cohort_id or request.GET.get("cohort", "") or "").strip()
    cohort = None
    if requested:
        cohort = next((item for item in cohorts if item.cohort_id == requested), None)
        if cohort is None:
            # 教師無權查看的班級一律 404，不洩漏是否存在。
            raise Http404
    elif cohorts:
        cohort = cohorts[0]

    context = {
        "cohorts": cohorts,
        "selected_cohort": cohort.cohort_id if cohort else "",
        "cohort": cohort,
        "report": None,
    }
    if cohort is None:
        return render(request, "learning/teacher_class_report.html", context)
    context["report"] = build_cohort_report(cohort)
    return render(request, "learning/teacher_class_report.html", context)


# ── P6（2026-10-13 教師指令）：結訓審核與成果交付中心 ──────────────────────────
# P6-A 結訓審核清單（只讀，供教師判斷；不自動判定合格、不核發任何證照）
# P6-B 兩種 CSV 匯出（與 P5 報告共用同一份 build_cohort_report 統計來源）
# P6-C 報告與匯出端點一律重新驗證教師授權；CSV 不可公開快取
CSV_BOM = "\ufeff"
# OWASP CSV Injection：以這些字元開頭的儲存格可能被 Excel／Sheets 當成公式執行。
CSV_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")
CSV_EXPORT_NOTE = (
    "本匯出僅呈現既有學習紀錄與教師複核結果，不代表考核合格、結訓通過或任何證照取得；"
    "「證」階段為課程成果紀錄，非民航局專業操作證。"
)


def csv_safe_cell(value):
    """CSV 公式注入防護：以 = + - @ TAB CR 開頭者前置單引號，使其成為純文字。"""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "是" if value else "否"
    text = str(value)
    if text.startswith(CSV_FORMULA_PREFIXES):
        return "'" + text
    return text


def _resolve_teacher_cohort(request, cohort_id):
    """P6-C：報告與匯出端點共用的授權解析。越權班級一律 404（不洩漏是否存在）。"""
    cohorts = list(teacher_cohorts(request.user).order_by("cohort_id"))
    requested = (cohort_id or request.GET.get("cohort", "") or "").strip()
    cohort = None
    if requested:
        cohort = next((item for item in cohorts if item.cohort_id == requested), None)
        if cohort is None:
            raise Http404
    elif cohorts:
        cohort = cohorts[0]
    return cohorts, cohort


def _csv_http_response(filename, rows):
    """組出不可快取的 CSV 回應（UTF-8 BOM，Windows Excel 可正確顯示繁體中文）。"""
    buffer = StringIO()
    writer = csv.writer(buffer, lineterminator="\r\n")
    for row in rows:
        writer.writerow([csv_safe_cell(cell) for cell in row])
    payload = (CSV_BOM + buffer.getvalue()).encode("utf-8")
    response = HttpResponse(payload, content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = 'attachment; filename="%s"' % filename
    # 不得公開快取，亦不得落入代理／瀏覽器快取；本端點不在任何靜態目錄下。
    response["Cache-Control"] = "no-store, no-cache, must-revalidate, private, max-age=0"
    response["Pragma"] = "no-cache"
    response["X-Content-Type-Options"] = "nosniff"
    return response


def _export_stamp(report):
    return timezone.localtime(report["generated_at"]).strftime("%Y-%m-%d %H:%M")


def _export_filename(prefix, cohort_id, report):
    stamp = timezone.localtime(report["generated_at"]).strftime("%Y%m%d_%H%M")
    safe_id = re.sub(r"[^A-Za-z0-9._-]", "_", str(cohort_id))
    return "%s_%s_%s.csv" % (prefix, safe_id, stamp)


@teacher_required
def teacher_cohort_review_checklist(request, cohort_id=None):
    """P6-A 結訓審核清單（只讀）。

    顯示班級總人數、R01–R08 尚未提交、待教師複核、需要補充、已有教師複核結果，
    以及每位學員尚待處理的項目。每筆待處理項目都指向既有教師審核頁
    （`teacher_student_detail#growth-records`），**不建立第二套複核流程**。
    本頁僅供教師判斷，不自動判定學員合格或核發證照。
    """
    cohorts, cohort = _resolve_teacher_cohort(request, cohort_id)
    context = {
        "cohorts": cohorts,
        "selected_cohort": cohort.cohort_id if cohort else "",
        "cohort": cohort,
        "checklist": None,
    }
    if cohort is None:
        return render(request, "learning/teacher_cohort_review_checklist.html", context)

    report = build_cohort_report(cohort)
    pending_review_items = [item for item in report["pending_work_items"] if item["group"] == "pending_review"]
    needs_revision_items = [item for item in report["pending_work_items"] if item["group"] == "needs_revision"]

    unsubmitted_by_slot = {}
    for item in report["unsubmitted_items"]:
        unsubmitted_by_slot.setdefault(item["code"], []).append(item)

    context["checklist"] = {
        "cohort": cohort,
        "generated_at": report["generated_at"],
        "student_count": report["student_count"],
        "slot_stats": report["slot_stats"],
        "stage_rows": report["stage_rows"],
        "student_rows": report["student_rows"],
        "pending_review_items": pending_review_items,
        "needs_revision_items": needs_revision_items,
        "unsubmitted_items": report["unsubmitted_items"],
        "unsubmitted_by_slot": sorted(unsubmitted_by_slot.items(), key=lambda pair: pair[0]),
        "review_result_rows": report["review_result_rows"],
        "pending_review_total": len(pending_review_items),
        "needs_revision_total": len(needs_revision_items),
        "unsubmitted_total": report["unsubmitted_items_total"],
        "reviewed_result_total": report["reviewed_result_total"],
        "outstanding_total": report["outstanding_total"],
    }
    return render(request, "learning/teacher_cohort_review_checklist.html", context)


@teacher_required
def teacher_cohort_export_summary(request, cohort_id=None):
    """P6-B（A）班級統計摘要 CSV。

    與 P5 報告使用同一份 `build_cohort_report` 彙整，數字必然一致。
    預設不匯出任何個資（無 Email／電話／密碼／Token）。
    """
    cohorts, cohort = _resolve_teacher_cohort(request, cohort_id)
    if cohort is None:
        raise Http404
    report = build_cohort_report(cohort)
    name = report["cohort"].name
    cid = report["cohort"].cohort_id
    stamp = _export_stamp(report)

    rows = [
        [
            "類別",
            "班級名稱",
            "班級編號",
            "項目代碼",
            "項目名稱",
            "已提交或完成",
            "班級人數",
            "已複核",
            "統計產生時間",
        ]
    ]
    summary_metrics = (
        ("學員總人數（人）", report["student_count"]),
        ("R01–R08 已提交（筆）", report["total_submitted"]),
        ("R01–R08 已複核（筆）", report["total_reviewed"]),
        ("待教師複核（筆）", report["pending_items_total"]),
        ("需要補充（筆）", report["needs_revision_total"]),
        ("尚未提交（人）", report["not_submitted_count"]),
        ("八項已提交（人）", report["all_submitted_count"]),
        ("有待複核成果（人）", report["pending_student_count"]),
    )
    for label, value in summary_metrics:
        rows.append(["班級摘要", name, cid, "", label, value, report["student_count"], "", stamp])

    for slot in report["slot_stats"]:
        rows.append(
            [
                "成長紀錄統計",
                name,
                cid,
                slot["slot_id"],
                slot["title"],
                slot["submitted"],
                slot["total"],
                slot["reviewed"],
                stamp,
            ]
        )

    for stage in report["stage_rows"]:
        rows.append(
            [
                "五階段進度",
                name,
                cid,
                stage["key"],
                "%s｜%s" % (stage["character"], stage["title"]),
                stage["done"],
                stage["total"],
                "",
                stamp,
            ]
        )

    rows.append(["說明", name, cid, "", CSV_EXPORT_NOTE, "", "", "", stamp])
    return _csv_http_response(_export_filename("cohort_summary", cid, report), rows)


@teacher_required
def teacher_cohort_export_records(request, cohort_id=None):
    """P6-B（B）學員 R01–R08 成果明細 CSV。

    每位學員 × 每個 R01–R08 槽位一列；提交狀態與教師複核狀態皆取自既有紀錄。
    只輸出學員識別碼與顯示名稱（既有欄位），不含 Email／電話／密碼／Token，
    亦不打包任何私人證據原始檔案。
    """
    cohorts, cohort = _resolve_teacher_cohort(request, cohort_id)
    if cohort is None:
        raise Http404
    report = build_cohort_report(cohort)
    name = report["cohort"].name
    cid = report["cohort"].cohort_id
    stamp = _export_stamp(report)
    slot_titles = report["slot_titles"]

    rows = [
        [
            "班級名稱",
            "班級編號",
            "學員識別碼",
            "學員顯示名稱",
            "紀錄編號",
            "紀錄名稱",
            "R01–R08 提交狀態",
            "教師複核狀態",
            "複核評分",
            "五階段完成",
            "五階段總數",
            "統計產生時間",
        ]
    ]

    for row in report["student_rows"]:
        student = row["student"]
        latest_review = {}
        for item in row["reviewed_items"]:
            if item["source_label"] != "成長紀錄":
                continue
            current = latest_review.get(item["code"])
            if current is None or (item["reviewed_at"] or datetime.datetime.min.replace(
                tzinfo=datetime.timezone.utc
            )) > (current["reviewed_at"] or datetime.datetime.min.replace(tzinfo=datetime.timezone.utc)):
                latest_review[item["code"]] = item
        for cell in row["slot_cells"]:
            review = latest_review.get(cell["slot_id"])
            rows.append(
                [
                    name,
                    cid,
                    student.public_user_id,
                    student.nickname,
                    cell["slot_id"],
                    slot_titles.get(cell["slot_id"], ""),
                    cell["status_label"],
                    review["review_status_label"] if review else "尚未複核",
                    review["score"] if review and review["score"] is not None else "",
                    row["completed_stages"],
                    row["stage_total"],
                    stamp,
                ]
            )

    rows.append(["說明", "", "", "", "", "", CSV_EXPORT_NOTE, "", "", "", "", stamp])
    return _csv_http_response(_export_filename("cohort_records", cid, report), rows)


# ── P7（2026-10-13 教師指令）：班級成果發表與教學展示中心 ──────────────────────
# P7-A 班級成果展示頁：沿用 build_cohort_report()，不重算另一套統計數字。
# P7-B 16:9 簡報播放模式：同一頁面的前端切頁（不產生 PPTX／影片／AI 文案）。
# P7-C 證據展示與隱私：預設匿名化；具名展示需教師顯式聲明授權（存 session，不寫 DB）。
SHOWCASE_CONSENT_SESSION_KEY = "teacher_showcase_identify_consent"
SHOWCASE_SLIDE_IDS = (
    "cover",
    "outcomes",
    "stages",
    "slots",
    "works",
    "feedback",
    "closing",
)
SHOWCASE_PRIVACY_NOTE = (
    "預設以班級統計與匿名化成果展示：學員以序號呈現，不顯示個人暱稱、既有識別碼、"
    "教師評語內容或任何可識別影像。如需具名展示學員姓名、照片或可識別作品，"
    "教師須自行確認已取得該學員之展示授權後再開啟；無法確認授權時一律不顯示。"
    "本頁不產生公開分享連結，也不開放匿名觀看。"
)
SHOWCASE_IDENTIFY_NOTICE = (
    "具名展示＝教師確認已取得必要授權。本系統無法查核授權來源，"
    "開啟與否由教師自行負責；請確認已取得學員（或其監護人）同意後再開啟。"
)
SHOWCASE_CAVEAT = (
    "「已提交」不等於「已通過」；課程「證」階段為學習成果紀錄，非民航局專業操作證。"
)


def _showcase_consent_cohorts(request):
    """P8-B：回傳教師已聲明授權的班級集合。

    授權**按班級隔離**：在 A 班開啟具名展示，切換到 B 班仍為匿名，
    回到 A 班才維持具名。舊版（P7）不分班級的布林值一律視為未授權，
    避免升級後沿用不明來源的授權狀態。
    """
    raw = request.session.get(SHOWCASE_CONSENT_SESSION_KEY)
    if isinstance(raw, list):
        return {str(item) for item in raw if item}
    if isinstance(raw, dict):
        return {str(key) for key, value in raw.items() if value}
    return set()


def _showcase_store_consents(request, consents):
    """空集合時移除 session 鍵，避免留下無意義的空授權狀態。"""
    if consents:
        request.session[SHOWCASE_CONSENT_SESSION_KEY] = sorted(consents)
    else:
        request.session.pop(SHOWCASE_CONSENT_SESSION_KEY, None)


def _showcase_student_rows(report, identify=False):
    """P7-C／P8-B：把 build_cohort_report 的學員列轉成展示用列（預設匿名化）。

    只做呈現層包裝，不重算任何數字；`identify=False` 時不輸出學員暱稱、
    不輸出既有識別碼，也不輸出任何證據影像列與外部連結，
    避免可識別內容在未確認授權時外洩。
    """
    rows = []
    for index, row in enumerate(report["student_rows"], start=1):
        rows.append(
            {
                "index": index,
                "label": "學員 %02d" % index,
                "display_name": row["student"].nickname if identify else "",
                # P8-B：匿名模式下連既有識別碼也不輸出（唯一編號仍可對應到個別學員）。
                "public_user_id": row["student"].public_user_id if identify else "",
                "direction_label": row["direction_label"],
                "group": row["group"],
                "submitted_count": row["submitted_count"],
                "reviewed_count": row["reviewed_count"],
                "completed_stages": row["completed_stages"],
                "stage_total": row["stage_total"],
                "evidence_count": row["evidence_count"],
                "slot_cells": row["slot_cells"],
                "evidence_rows": row["evidence_rows"] if identify else [],
                "detail_url": row["detail_url"],
            }
        )
    return rows


def _showcase_response(request, template, context):
    """P7-C：展示頁一律禁止快取（含個資與既有證據連結，不得被共享快取保存）。"""
    response = render(request, template, context)
    response["Cache-Control"] = "no-store, no-cache, must-revalidate, private, max-age=0"
    response["Pragma"] = "no-cache"
    response["X-Content-Type-Options"] = "nosniff"
    return response


@teacher_required
def teacher_class_showcase(request, cohort_id=None):
    """P7-A／P7-B／P8-B：班級成果展示頁與 16:9 簡報播放模式（只讀）。

    統計一律取自 build_cohort_report()（P5／P6 同一來源），本視圖不重算。
    無資料顯示「尚無紀錄」；不虛構成績、照片、證照或教師評語。

    P8-B 隱私：
      - 預設匿名化；匿名時不輸出暱稱、既有識別碼、教師評語內容與任何證據影像。
      - 具名展示需教師**逐班**聲明「已取得必要授權」，狀態存於 session（不寫 DB）。
      - 授權按班級隔離，切換班級不沿用；登出或 session 過期即失效。
    """
    cohorts = list(teacher_cohorts(request.user).order_by("cohort_id"))
    requested = (cohort_id or request.GET.get("cohort", "") or "").strip()
    cohort = None
    if requested:
        cohort = next((item for item in cohorts if item.cohort_id == requested), None)
        if cohort is None:
            # 教師無權查看的班級一律 404，不洩漏是否存在。
            raise Http404
    elif cohorts:
        cohort = cohorts[0]

    consents = _showcase_consent_cohorts(request)

    if request.method == "POST":
        action = (request.POST.get("action") or "").strip()
        if cohort is not None:
            if action == "enable_identify":
                consents.add(cohort.cohort_id)
                messages.success(
                    request,
                    "已為「%s」開啟具名展示；請自行確認已取得該班學員之展示授權。"
                    % cohort.name,
                )
            elif action == "disable_identify":
                consents.discard(cohort.cohort_id)
                messages.success(request, "已將「%s」改回匿名化展示（預設）。" % cohort.name)
            _showcase_store_consents(request, consents)
        # 只重導回本頁路徑，避免開放式重導。
        return redirect(request.path)

    identify = bool(cohort is not None and cohort.cohort_id in consents)

    context = {
        "cohorts": cohorts,
        "selected_cohort": cohort.cohort_id if cohort else "",
        "cohort": cohort,
        "report": None,
        "showcase_rows": [],
        "showcase_evidence_total": 0,
        "identify": identify,
        "identified_cohorts": sorted(consents),
        "slide_ids": SHOWCASE_SLIDE_IDS,
        "privacy_note": SHOWCASE_PRIVACY_NOTE,
        "identify_notice": SHOWCASE_IDENTIFY_NOTICE,
        "showcase_caveat": SHOWCASE_CAVEAT,
        # P8-C：匿名時仍需讓教師分辨「有評語但已隱藏」與「真的沒有評語」，
        # 故保留一個**純數字**計數（不含任何可識別內容，非姓名／非評語原文）。
        "feedback_note_total": 0,
    }
    if cohort is None:
        return _showcase_response(request, "learning/teacher_showcase.html", context)
    report = build_cohort_report(cohort)
    # 先取計數，再依模式決定是否清空內容列（計數與模式無關，兩種模式皆相同）。
    feedback_note_total = len(report["feedback_rows"])
    if not identify:
        # P8-B：匿名模式下連 context 都不保留可識別內容
        # （教師評語原文可能含學員姓名；複核結果列含學員識別）。
        report = dict(report)
        report["feedback_rows"] = []
        report["review_result_rows"] = []
    context["report"] = report
    context["feedback_note_total"] = feedback_note_total
    context["showcase_rows"] = _showcase_student_rows(report, identify)
    context["showcase_evidence_total"] = sum(
        row["evidence_count"] for row in report["student_rows"]
    )
    return _showcase_response(request, "learning/teacher_showcase.html", context)
