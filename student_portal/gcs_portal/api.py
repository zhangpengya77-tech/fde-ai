"""FDE-GCS 參數寫入申請 API（同源 JSON，使用既有 Django Session 與 CSRF）。

伺服器負責：白名單驗證、教師批准、批准時效與單次使用、結果紀錄。
實際寫入發生在學員瀏覽器與 USB 飛控之間；伺服器不經手任何飛控資料，也無法遠端控制飛控。
"""
import json

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_http_methods

from learning.models import Cohort

from .access import ALLOWED, DISABLED, evaluate_access
from .allowlist import load_allowlist, load_explanations, readback_matches, validate_change
from .models import APPROVAL_TTL, ParamWriteRequest

Status = ParamWriteRequest.Status
OPEN_STATUSES = (Status.PENDING, Status.APPROVED)


def _json_error(message, status):
    return JsonResponse({"error": message}, status=status)


def _guard(request):
    state = evaluate_access(request)
    if state == DISABLED:
        return _json_error("not_found", 404)
    if state != ALLOWED:
        return _json_error("forbidden", 403 if request.user.is_authenticated else 401)
    return None


def _body(request):
    try:
        data = json.loads(request.body or b"{}")
    except (ValueError, UnicodeDecodeError):
        return None
    return data if isinstance(data, dict) else None


def teacher_visible_cohorts(user):
    """教師只看得到自己被指派、而且已開放 FDE-GCS 的班級（superuser 不受指派限制）。"""
    cohorts = Cohort.objects.filter(active=True, cohort_id__in=getattr(settings, "FDE_GCS_COHORTS", ()))
    if user.is_superuser:
        return cohorts
    return cohorts.filter(teacher_accesses__teacher=user)


def _visible_requests(user):
    if user.is_staff:
        return ParamWriteRequest.objects.filter(Q(requester=user) | Q(cohort__in=teacher_visible_cohorts(user)))
    return ParamWriteRequest.objects.filter(requester=user)


def _student_cohort(profile):
    enrollment = (
        profile.enrollments.filter(
            active=True, cohort__active=True, cohort_id__in=getattr(settings, "FDE_GCS_COHORTS", ())
        )
        .order_by("-joined_at")
        .first()
    )
    return enrollment.cohort if enrollment else None


@never_cache
@require_http_methods(["GET"])
def allowlist_view(request):
    blocked = _guard(request)
    if blocked:
        return blocked
    data = load_allowlist()
    payload = {key: data[key] for key in ("version", "firmware", "approved_by", "max_step_ratio", "params")}
    payload["explanations"] = load_explanations()
    return JsonResponse(payload)


@never_cache
@require_http_methods(["GET", "POST"])
def param_requests(request):
    blocked = _guard(request)
    if blocked:
        return blocked
    if request.method == "GET":
        items = []
        for item in _visible_requests(request.user).select_related("student")[:100]:
            item.expire_if_needed()
            entry = item.to_dict()
            entry["can_decide"] = request.user.is_staff and item.status == Status.PENDING
            entry["is_mine"] = item.requester_id == request.user.pk
            items.append(entry)
        return JsonResponse({"requests": items, "role": "teacher" if request.user.is_staff else "student"})

    data = _body(request)
    if data is None:
        return _json_error("請求格式錯誤。", 400)
    name = str(data.get("param_name", ""))[:16]
    old_value, new_value = data.get("old_value"), data.get("new_value")
    revert_of = None
    if data.get("revert_of") is not None:
        revert_of = ParamWriteRequest.objects.filter(
            pk=data.get("revert_of") if isinstance(data.get("revert_of"), int) else -1,
            requester=request.user,
            status=Status.APPLIED,
        ).first()
        if revert_of is None:
            return JsonResponse({"error": "validation", "errors": ["只能還原自己已寫入成功的申請。"]}, status=400)
        if revert_of.reverts.exclude(status__in=(Status.REJECTED, Status.CANCELLED, Status.EXPIRED, Status.FAILED)).exists():
            return _json_error("這筆寫入已經有還原申請了。", 409)
        # 還原的內容由伺服器決定：參數、飛控與數值一律取自原申請，不採用瀏覽器送來的值。
        name = revert_of.param_name
        new_value = revert_of.old_value
        data["vehicle_sysid"] = revert_of.vehicle_sysid
        if not isinstance(old_value, (int, float)) or isinstance(old_value, bool) or not readback_matches(revert_of.new_value, old_value):
            return JsonResponse({"error": "validation", "errors": ["飛控目前值已經不是當初寫入的值，請重新讀取參數後改用一般申請。"]}, status=400)
    errors = validate_change(name, old_value, new_value, is_revert=revert_of is not None)
    if data.get("safety_ack") is not True:
        errors.append("請先確認「已拆下螺旋槳、已斷開動力電池」。")
    sysid = data.get("vehicle_sysid")
    if not isinstance(sysid, int) or isinstance(sysid, bool) or not 1 <= sysid <= 255:
        errors.append("飛控 System ID 不正確。")
    if errors:
        return JsonResponse({"error": "validation", "errors": errors}, status=400)
    profile = None if request.user.is_staff else request.user.student_profile
    cohort = None if profile is None else _student_cohort(profile)
    with transaction.atomic():
        open_same = ParamWriteRequest.objects.select_for_update().filter(
            requester=request.user, param_name=name, status__in=OPEN_STATUSES
        )
        for item in open_same:
            item.expire_if_needed()
        if open_same.filter(status__in=OPEN_STATUSES).exists():
            return _json_error(f"{name} 已經有一筆尚未完成的申請。", 409)
        item = ParamWriteRequest.objects.create(
            requester=request.user,
            student=profile,
            cohort=cohort,
            param_name=name,
            allowlist_version=load_allowlist()["version"],
            vehicle_sysid=sysid,
            firmware=str(data.get("firmware", ""))[:40],
            old_value=float(old_value),
            new_value=float(new_value),
            safety_ack=True,
            revert_of=revert_of,
        )
    return JsonResponse({"request": item.to_dict()}, status=201)


def _get_visible(request, pk):
    return _visible_requests(request.user).filter(pk=pk).select_related("student").first()


@never_cache
@require_http_methods(["POST"])
def decide(request, pk):
    blocked = _guard(request)
    if blocked:
        return blocked
    if not request.user.is_staff:
        return _json_error("只有教師可以批准。", 403)
    data = _body(request)
    if data is None or data.get("decision") not in ("approve", "reject"):
        return _json_error("請求格式錯誤。", 400)
    with transaction.atomic():
        item = _get_visible(request, pk)
        if item is None:
            return _json_error("not_found", 404)
        item = ParamWriteRequest.objects.select_for_update().get(pk=item.pk)
        if item.status != Status.PENDING:
            return _json_error("這筆申請已經處理過了。", 409)
        now = timezone.now()
        item.decided_by = request.user
        item.decided_at = now
        item.decision_note = str(data.get("note", ""))[:200]
        if data["decision"] == "approve":
            item.status = Status.APPROVED
            item.approval_expires_at = now + APPROVAL_TTL
        else:
            item.status = Status.REJECTED
        item.save()
    return JsonResponse({"request": item.to_dict()})


@never_cache
@require_http_methods(["POST"])
def report_result(request, pk):
    blocked = _guard(request)
    if blocked:
        return blocked
    data = _body(request)
    if data is None or not isinstance(data.get("success"), bool):
        return _json_error("請求格式錯誤。", 400)
    with transaction.atomic():
        item = ParamWriteRequest.objects.select_for_update().filter(pk=pk, requester=request.user).first()
        if item is None:
            return _json_error("not_found", 404)
        if item.expire_if_needed() != Status.APPROVED:
            return _json_error("這筆申請目前不能回報寫入結果。", 409)
        readback = data.get("readback_value")
        readback = float(readback) if isinstance(readback, (int, float)) and not isinstance(readback, bool) else None
        message = str(data.get("message", ""))[:200]
        if data["success"] and readback is not None and readback_matches(item.new_value, readback):
            item.status = Status.APPLIED
            item.result_message = message or "寫入成功，讀回值一致。"
        else:
            item.status = Status.FAILED
            if data["success"]:
                message = "讀回值與申請的新值不一致，視為失敗。"
            item.result_message = message or "寫入失敗。"
        item.result_value = readback
        item.completed_at = timezone.now()
        item.save()
    return JsonResponse({"request": item.to_dict()})


@never_cache
@require_http_methods(["POST"])
def cancel(request, pk):
    blocked = _guard(request)
    if blocked:
        return blocked
    with transaction.atomic():
        item = ParamWriteRequest.objects.select_for_update().filter(pk=pk, requester=request.user).first()
        if item is None:
            return _json_error("not_found", 404)
        if item.status not in OPEN_STATUSES:
            return _json_error("這筆申請已經結束，無法取消。", 409)
        item.status = Status.CANCELLED
        item.completed_at = timezone.now()
        item.save()
    return JsonResponse({"request": item.to_dict()})
