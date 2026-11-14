"""FDE-GCS 學員成果 API（P5）：參數備份、差異報告、教師覆核 PASS／NG、任務卡進度、班級成果匯出。

學員只能看到自己的資料；教師只能看到被指派（TeacherCohortAccess）且已開放 FDE-GCS 的班級。
"""
import csv
import hashlib
import io
import math
import re

from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_http_methods

from .api import _body, _guard, _json_error, _student_cohort, _visible_requests, teacher_visible_cohorts
from .models import ParamBackup, ParamWriteRequest, Review

PARAM_NAME = re.compile(r"^[A-Z][A-Z0-9_]{0,15}$")
MAX_BACKUP_BYTES = 200 * 1024
MAX_BACKUP_PARAMS = 3000


def _visible_backups(user):
    if user.is_staff:
        from django.db.models import Q

        return ParamBackup.objects.filter(Q(requester=user) | Q(cohort__in=teacher_visible_cohorts(user)))
    return ParamBackup.objects.filter(requester=user)


def parse_backup(text):
    """把學員上傳的 .param 文字轉成 {名稱: 數值}；格式不符時回傳錯誤訊息。"""
    if not isinstance(text, str) or not text.strip():
        return None, "備份內容是空的。"
    if len(text.encode("utf-8")) > MAX_BACKUP_BYTES:
        return None, "備份檔案太大。"
    values = {}
    for number, line in enumerate(text.splitlines(), start=1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        name, sep, raw = line.partition(",")
        if not sep or not PARAM_NAME.match(name):
            return None, f"第 {number} 行格式不正確。"
        try:
            value = float(raw)
        except ValueError:
            return None, f"第 {number} 行的數值不正確。"
        if not math.isfinite(value):
            return None, f"第 {number} 行的數值不正確。"
        values[name] = value
        if len(values) > MAX_BACKUP_PARAMS:
            return None, "參數數量超過上限。"
    if not values:
        return None, "備份裡沒有任何參數。"
    return values, ""


def _canonical(values):
    return "".join(f"{name},{repr(values[name])}\n" for name in sorted(values))


@never_cache
@require_http_methods(["GET", "POST"])
def backups(request):
    blocked = _guard(request)
    if blocked:
        return blocked
    if request.method == "GET":
        items = []
        for item in _visible_backups(request.user).select_related("student")[:100]:
            entry = item.to_dict()
            entry["is_mine"] = item.requester_id == request.user.pk
            entry["can_review"] = request.user.is_staff and not entry["is_mine"]
            items.append(entry)
        return JsonResponse({"backups": items})
    data = _body(request)
    if data is None:
        return _json_error("請求格式錯誤。", 400)
    values, error = parse_backup(data.get("content"))
    sysid = data.get("vehicle_sysid")
    missing = data.get("missing_count", 0)
    if not error and (not isinstance(sysid, int) or isinstance(sysid, bool) or not 1 <= sysid <= 255):
        error = "飛控 System ID 不正確。"
    if not error and (not isinstance(missing, int) or isinstance(missing, bool) or missing < 0):
        error = "缺少參數數量不正確。"
    if error:
        return _json_error(error, 400)
    content = _canonical(values)
    profile = None if request.user.is_staff else request.user.student_profile
    item = ParamBackup.objects.create(
        requester=request.user,
        student=profile,
        cohort=None if profile is None else _student_cohort(profile),
        vehicle_sysid=sysid,
        firmware=str(data.get("firmware", ""))[:40],
        param_count=len(values),
        missing_count=missing,
        content=content,
        sha256=hashlib.sha256(content.encode("utf-8")).hexdigest(),
    )
    return JsonResponse({"backup": item.to_dict()}, status=201)


@never_cache
@require_http_methods(["GET"])
def backup_diff(request, pk):
    blocked = _guard(request)
    if blocked:
        return blocked
    item = _visible_backups(request.user).filter(pk=pk).first()
    if item is None:
        return _json_error("not_found", 404)
    base = (
        ParamBackup.objects.filter(requester_id=item.requester_id, vehicle_sysid=item.vehicle_sysid, created_at__lt=item.created_at)
        .order_by("-created_at")
        .first()
    )
    after = item.parsed()
    if base is None:
        return JsonResponse({"backup_id": item.pk, "base_id": None, "changed": [], "added": [], "removed": []})
    before = base.parsed()
    changed = [
        {"name": name, "before": before[name], "after": after[name]}
        for name in sorted(set(before) & set(after))
        if before[name] != after[name]
    ]
    return JsonResponse({
        "backup_id": item.pk,
        "base_id": base.pk,
        "base_created_at": base.created_at.isoformat(),
        "changed": changed,
        "added": sorted(set(after) - set(before)),
        "removed": sorted(set(before) - set(after)),
    })


def _review(request, queryset, pk, allowed_statuses=None):
    blocked = _guard(request)
    if blocked:
        return blocked, None
    if not request.user.is_staff:
        return _json_error("只有教師可以覆核。", 403), None
    data = _body(request)
    if data is None or data.get("result") not in (Review.PASS, Review.NG):
        return _json_error("請求格式錯誤。", 400), None
    item = queryset.filter(pk=pk).first()
    if item is None:
        return _json_error("not_found", 404), None
    if item.requester_id == request.user.pk:
        return _json_error("不能覆核自己的紀錄。", 403), None
    if allowed_statuses is not None and item.status not in allowed_statuses:
        return _json_error("這筆紀錄還不能覆核。", 409), None
    item.review_status = data["result"]
    item.review_note = str(data.get("note", ""))[:200]
    item.reviewed_by = request.user
    item.reviewed_at = timezone.now()
    item.save(update_fields=["review_status", "review_note", "reviewed_by", "reviewed_at"])
    return None, item


@never_cache
@require_http_methods(["POST"])
def review_backup(request, pk):
    error, item = _review(request, _visible_backups(request.user), pk)
    return error or JsonResponse({"backup": item.to_dict()})


@never_cache
@require_http_methods(["POST"])
def review_write(request, pk):
    statuses = (ParamWriteRequest.Status.APPLIED, ParamWriteRequest.Status.FAILED)
    error, item = _review(request, _visible_requests(request.user), pk, statuses)
    return error or JsonResponse({"request": item.to_dict()})


@never_cache
@require_http_methods(["GET"])
def summary(request):
    """學員任務卡：三個步驟的完成狀態全部由伺服器紀錄判斷，不由瀏覽器自行宣稱。"""
    blocked = _guard(request)
    if blocked:
        return blocked
    mine_backups = ParamBackup.objects.filter(requester=request.user)
    mine_writes = ParamWriteRequest.objects.filter(requester=request.user)
    applied = mine_writes.filter(status=ParamWriteRequest.Status.APPLIED)
    tasks = [
        {"key": "backup", "title": "連線飛控、讀取全部參數並上傳備份", "done": mine_backups.exists()},
        {"key": "write", "title": "完成一次教師批准的 PID 調參寫入（讀回確認）", "done": applied.exists()},
        {
            "key": "review",
            "title": "取得教師覆核 PASS",
            "done": mine_backups.filter(review_status=Review.PASS).exists() or applied.filter(review_status=Review.PASS).exists(),
        },
    ]
    payload = {"tasks": tasks}
    if request.user.is_staff:
        payload["cohorts"] = list(teacher_visible_cohorts(request.user).values_list("cohort_id", flat=True))
    return JsonResponse(payload)


def _csv_safe(value):
    text = "" if value is None else str(value)
    return f"'{text}" if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


@never_cache
@require_http_methods(["GET"])
def export_csv(request):
    blocked = _guard(request)
    if blocked:
        return blocked
    if not request.user.is_staff:
        return _json_error("只有教師可以匯出。", 403)
    cohort = teacher_visible_cohorts(request.user).filter(cohort_id=request.GET.get("cohort", "")).first()
    if cohort is None:
        return _json_error("沒有這個班級的權限。", 404)
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["類型", "學員編號", "班級", "時間", "內容", "狀態", "教師覆核", "覆核備註"])
    for item in ParamBackup.objects.filter(cohort=cohort).select_related("student").order_by("created_at"):
        writer.writerow([_csv_safe(v) for v in (
            "參數備份", item.student.public_user_id if item.student_id else "", cohort.cohort_id,
            timezone.localtime(item.created_at).strftime("%Y-%m-%d %H:%M"),
            f"{item.param_count} 個參數，缺少 {item.missing_count}，韌體 {item.firmware}", "已上傳",
            item.review_status or "待覆核", item.review_note,
        )])
    for item in ParamWriteRequest.objects.filter(cohort=cohort).select_related("student").order_by("created_at"):
        writer.writerow([_csv_safe(v) for v in (
            "參數寫入", item.student.public_user_id if item.student_id else "", cohort.cohort_id,
            timezone.localtime(item.created_at).strftime("%Y-%m-%d %H:%M"),
            f"{item.param_name}: {item.old_value} -> {item.new_value}（讀回 {item.result_value}）", item.get_status_display(),
            item.review_status or "待覆核", item.review_note,
        )])
    response = HttpResponse("﻿" + buffer.getvalue(), content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="fde-gcs-{cohort.cohort_id}.csv"'
    return response
