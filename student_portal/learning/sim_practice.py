"""模擬器練飛紀錄（2026-11-07）

- 學員在網頁模擬器（/sim/app/）完成一次練習 → 自動存一筆成績到自己的成長日誌
- 學員：/student/sim-practice/ 看自己的練飛紀錄（最佳分數、最近 50 筆）
- 教師：/teacher/sim-practice/ 看自己班級學員的練飛紀錄（依班級隔離）

API：/student/sim-practice/api/
  GET  → {logged_in, nickname, csrf_token}（模擬器顯示「成績會存入成長日誌」或「登入後可保存」）
  POST → 存一筆（JSON；需登入學員＋CSRF）；未登入回 401，不跳轉
安全：不接受前端指定學員或班級；每位學員每天最多 300 筆；欄位長度與數值範圍都在後端檢查。
"""
from __future__ import annotations

import json
from datetime import timedelta

from django.db.models import Count, Max
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.shortcuts import render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_http_methods

from .models import Enrollment, SimPracticeRecord
from .views import student_required, teacher_cohorts, teacher_required

DAILY_LIMIT = 300
MAX_BODY_BYTES = 8 * 1024
INPUT_SOURCES = {"鍵盤", "實體遙控器", "手機遙控器", "原子筆（鏡頭）", "手勢（鏡頭）"}


def _student_profile(request):
    if not request.user.is_authenticated or request.user.is_staff:
        return None
    profile = getattr(request.user, "student_profile", None)
    return profile if profile is not None and profile.active else None


def _clean_record(payload: dict) -> tuple[dict | None, str]:
    """檢查模擬器送來的成績；回傳（乾淨的欄位, 錯誤訊息）"""
    mode = payload.get("mode")
    if mode not in SimPracticeRecord.Mode.values:
        return None, "mode 不正確"
    title = str(payload.get("title") or "").strip()[:120]
    if not title:
        return None, "缺少練習名稱"
    score = payload.get("score")
    if score is not None:
        if not isinstance(score, (int, float)) or not 0 <= score <= 100:
            return None, "分數需在 0～100"
        score = int(round(score))
    passed = payload.get("passed")
    if passed is not None and not isinstance(passed, bool):
        return None, "passed 需為是／否"
    duration = payload.get("duration_seconds") or 0
    if not isinstance(duration, (int, float)) or not 0 <= duration <= 6 * 3600:
        return None, "飛行時間不正確"
    source = str(payload.get("input_source") or "")
    source = source if source in INPUT_SOURCES else ("實體遙控器" if source.startswith("遙控器") else "")
    summary = payload.get("summary") or {}
    if not isinstance(summary, dict) or len(json.dumps(summary, ensure_ascii=False)) > 2000:
        return None, "摘要格式不正確或太長"
    return {
        "mode": mode,
        "title": title,
        "score": score,
        "grade": str(payload.get("grade") or "")[:8],
        "passed": passed,
        "duration_seconds": int(duration),
        "input_source": source,
        "summary": summary,
    }, ""


@require_http_methods(["GET", "POST"])
@csrf_protect
def sim_practice_api(request):
    profile = _student_profile(request)
    if request.method == "GET":
        return JsonResponse({
            "ok": True,
            "logged_in": profile is not None,
            "nickname": profile.nickname if profile else "",
            # 讓模擬器取得 CSRF token（同時寫入 csrftoken cookie）
            "csrf_token": get_token(request),
            "login_url": reverse("learning:student_login"),
            "records_url": reverse("learning:student_sim_practice"),
        })
    if profile is None:
        return JsonResponse({"ok": False, "code": "login_required", "detail": "登入學員帳號後，練飛成績才會存入成長日誌。",
                             "login_url": reverse("learning:student_login")}, status=401)
    if len(request.body or b"") > MAX_BODY_BYTES:
        return JsonResponse({"ok": False, "code": "too_large"}, status=413)
    try:
        payload = json.loads(request.body or b"{}")
    except ValueError:
        return JsonResponse({"ok": False, "code": "bad_json"}, status=400)
    if not isinstance(payload, dict):
        return JsonResponse({"ok": False, "code": "bad_json"}, status=400)
    fields, error = _clean_record(payload)
    if fields is None:
        return JsonResponse({"ok": False, "code": "invalid", "detail": error}, status=422)
    since = timezone.now() - timedelta(days=1)
    if SimPracticeRecord.objects.filter(student=profile, created_at__gte=since).count() >= DAILY_LIMIT:
        return JsonResponse({"ok": False, "code": "daily_limit", "detail": "今天的練飛紀錄已達上限。"}, status=429)
    # 班級由登入身分在後端決定；只有唯一有效班級時才記錄（避免跨班）
    enrollments = list(Enrollment.objects.filter(student=profile, active=True).select_related("cohort")[:2])
    cohort = enrollments[0].cohort if len(enrollments) == 1 else None
    record = SimPracticeRecord.objects.create(student=profile, cohort=cohort, **fields)
    return JsonResponse({"ok": True, "id": record.pk, "records_url": reverse("learning:student_sim_practice")}, status=201)


@student_required
def student_sim_practice(request):
    profile = request.student_profile
    records = list(SimPracticeRecord.objects.filter(student=profile)[:50])
    stats = SimPracticeRecord.objects.filter(student=profile).aggregate(total=Count("id"), best=Max("score"))
    return render(request, "learning/student_sim_practice.html", {"profile": profile, "records": records, "stats": stats})


@teacher_required
def teacher_sim_practice(request):
    cohorts = list(teacher_cohorts(request.user))
    cohort_ids = [c.pk for c in cohorts]
    selected = request.GET.get("cohort", "").strip()
    qs = SimPracticeRecord.objects.filter(cohort_id__in=cohort_ids).select_related("student", "cohort")
    if selected and selected in {str(c) for c in cohort_ids}:
        qs = qs.filter(cohort_id=selected)
    # 每位學員的練習次數與最佳分數
    per_student = (
        qs.values("student__public_user_id", "student__nickname")
        .annotate(total=Count("id"), best=Max("score"), last=Max("created_at"))
        .order_by("-last")[:200]
    )
    return render(request, "learning/teacher_sim_practice.html", {
        "cohorts": cohorts,
        "selected": selected,
        "per_student": list(per_student),
        "records": list(qs[:200]),
    })


