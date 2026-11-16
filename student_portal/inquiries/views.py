"""課程諮詢：官網表單送出（公開 API）＋教師後台查看（統計、未讀通知、標示已讀）。

- 公開 API：POST /api/public/course-inquiry/
  - 只收必要欄位；必須勾選同意個資告知。
  - 防機器人：隱藏陷阱欄位、填寫時間過短一律丟棄、只接受本站來源網址。
  - 限流：同一來源 10 分鐘 3 筆；全站每小時 60 筆。
  - 不存原始 IP，只存加鹽雜湊，用來限流。
  - 寄通知信給老師只是輔助：寄不出去也不影響保存，老師以教師後台為主要查看處。
- 教師後台：GET /teacher/course-inquiries/（教師帳號才能看）
  - 統計：總數、未讀、近 7 天、各課程、各班別、近 8 週。
  - 列表：未讀標示，可單筆或全部標示為已讀。
- 保存期限：180 天，過期資料在每次有人送出或開啟後台時自動刪除。
- 資料只存在獨立資料庫 DATABASES['inquiries']，不寫入學員系統的資料庫。
"""
from __future__ import annotations

import hashlib
import hmac
import re
from datetime import timedelta
from urllib.parse import urlparse

from django.conf import settings
from django.core.mail import send_mail
from django.db.models import Count
from django.db.models.functions import TruncWeek
from django.http import JsonResponse
from django.shortcuts import redirect, render
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from learning.views import teacher_required

from .models import CourseInquiry

# 與 src/data/vocational-programs.js 的課程代號、名稱一致（測試會比對兩邊）
COURSES = {
    "license": "無人機證照考取專班",
    "seed": "FDE-AI 無人載具種子教師專案",
    "pilot": "專業無人機職業飛手專案",
    "rd": "無人載具軟硬體研發工程師專案",
    "mro": "無人載具裝調檢修與測試工程師專案",
}
FORMATS = {"周末班", "常日班", "都可以／未定"}
RETENTION_DAYS = 180
PER_SOURCE_LIMIT = (3, timedelta(minutes=10))
GLOBAL_LIMIT = (60, timedelta(hours=1))
MIN_FILL_SECONDS = 3
PHONE_RE = re.compile(r"^09\d{2}-?\d{3}-?\d{3}$")
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")


def _allowed_origin(request) -> str | None:
    """只接受本站相關網址送來的表單：固定入口、GitHub 頁面、快速通道、本機。"""
    origin = request.headers.get("Origin") or ""
    if not origin:
        ref = request.headers.get("Referer") or ""
        if ref:
            p = urlparse(ref)
            origin = f"{p.scheme}://{p.netloc}"
    host = urlparse(origin).hostname or ""
    extra = [h.strip() for h in getattr(settings, "COURSE_INQUIRY_ALLOWED_HOSTS", "").split(",") if h.strip()]
    ok = (
        host in {"fde-ai-v2.fde-ai-gateway.workers.dev", "zhangpengya77-tech.github.io", "localhost", "127.0.0.1", "testserver"}
        or host.endswith(".trycloudflare.com")
        or host in extra
        or host == request.get_host().split(":")[0]
    )
    return origin if ok else None


def _source_hash(request) -> str:
    ip = (
        request.headers.get("CF-Connecting-IP")
        or (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
        or request.META.get("REMOTE_ADDR", "")
    )
    return hmac.new(settings.SECRET_KEY.encode(), f"course-inquiry:{ip}".encode(), hashlib.sha256).hexdigest()


def purge_expired() -> int:
    deleted, _ = CourseInquiry.objects.filter(created_at__lt=timezone.now() - timedelta(days=RETENTION_DAYS)).delete()
    return deleted


def _notify(inquiry: CourseInquiry) -> bool:
    """寄通知信給老師（輔助）。沒設定收件人或寄信失敗都回 False，不影響保存。"""
    raw = getattr(settings, "COURSE_INQUIRY_NOTIFY_EMAILS", "") or getattr(settings, "EMAIL_HOST_USER", "")
    to = [x.strip() for x in raw.split(",") if x.strip()]
    if not to:
        return False
    body = (
        f"有一筆新的課程諮詢（{timezone.localtime(inquiry.created_at):%Y-%m-%d %H:%M}）\n\n"
        f"稱呼：{inquiry.name}\n聯絡方式：{inquiry.contact}\n課程：{inquiry.course_title}\n班別：{inquiry.class_format or '未填'}\n"
        f"問題：{inquiry.message or '（未填）'}\n\n請到教師後台「課程諮詢」查看與標示已讀：/teacher/course-inquiries/\n"
        f"（諮詢資料保存 {RETENTION_DAYS} 天後自動刪除）"
    )
    try:
        return send_mail(f"【FDE-AI 課程諮詢】{inquiry.course_title}｜{inquiry.name}", body, settings.DEFAULT_FROM_EMAIL, to, fail_silently=False) > 0
    except Exception:  # 寄信失敗不影響保存
        return False


def _json(data, status=200):
    return JsonResponse(data, status=status, json_dumps_params={"ensure_ascii": False})


@csrf_exempt  # 公開表單（GitHub 頁面跨網站送出），以來源檢查、陷阱欄位、填寫時間與限流防濫用
@require_http_methods(["POST"])
def submit_inquiry(request):
    if not _allowed_origin(request):
        return _json({"ok": False, "error": "來源網站不正確"}, 403)
    f = request.POST
    # 陷阱欄位有值，或填寫太快（機器人）：假裝成功、不保存
    try:
        started = int(f.get("started_ms", "0")) / 1000
    except ValueError:
        started = 0
    if f.get("website") or (started and timezone.now().timestamp() - started < MIN_FILL_SECONDS):
        return _json({"ok": True})
    name = f.get("name", "").strip()[:30]
    contact = f.get("contact", "").strip()[:80]
    course = f.get("course", "").strip()
    fmt = f.get("format", "").strip()
    message = f.get("message", "").strip()[:500]
    errors = []
    if not name:
        errors.append("請填寫稱呼")
    if not (PHONE_RE.match(contact.replace(" ", "")) or EMAIL_RE.match(contact)):
        errors.append("請填寫正確的手機（09 開頭）或 Email")
    if course not in COURSES:
        errors.append("請選擇課程")
    if fmt and fmt not in FORMATS:
        fmt = ""
    if f.get("consent") not in ("on", "1", "true"):
        errors.append("請勾選同意個資告知")
    if errors:
        return _json({"ok": False, "error": "；".join(errors)}, 400)

    now = timezone.now()
    src = _source_hash(request)
    if CourseInquiry.objects.filter(ip_hash=src, created_at__gte=now - PER_SOURCE_LIMIT[1]).count() >= PER_SOURCE_LIMIT[0]:
        return _json({"ok": False, "error": "送出次數太多，請 10 分鐘後再試，或直接來電／加 LINE。"}, 429)
    if CourseInquiry.objects.filter(created_at__gte=now - GLOBAL_LIMIT[1]).count() >= GLOBAL_LIMIT[0]:
        return _json({"ok": False, "error": "目前諮詢量較大，請稍後再試，或直接來電／加 LINE。"}, 429)

    purge_expired()
    inquiry = CourseInquiry.objects.create(
        name=name, contact=contact, course=course, course_title=COURSES[course], class_format=fmt, message=message,
        consent_at=now, source=(urlparse(_allowed_origin(request) or "").hostname or "")[:120], ip_hash=src,
    )
    if _notify(inquiry):
        CourseInquiry.objects.filter(pk=inquiry.pk).update(email_sent=True)
    return _json({"ok": True})


@teacher_required
@require_http_methods(["GET", "POST"])
def teacher_inquiries(request):
    purge_expired()
    if request.method == "POST":
        now, who = timezone.now(), request.user.get_username()
        if request.POST.get("action") == "read_all":
            CourseInquiry.objects.filter(is_read=False).update(is_read=True, read_at=now, read_by=who)
        elif request.POST.get("action") == "read" and request.POST.get("id", "").isdigit():
            CourseInquiry.objects.filter(pk=int(request.POST["id"]), is_read=False).update(is_read=True, read_at=now, read_by=who)
        elif request.POST.get("action") == "unread" and request.POST.get("id", "").isdigit():
            CourseInquiry.objects.filter(pk=int(request.POST["id"])).update(is_read=False, read_at=None, read_by="")
        return redirect(request.get_full_path())

    qs = CourseInquiry.objects.all()
    only_unread = request.GET.get("view") == "unread"
    now = timezone.now()
    by_course = {r["course"]: r["n"] for r in qs.values("course").annotate(n=Count("id"))}
    by_format = {r["class_format"] or "未填": r["n"] for r in qs.values("class_format").annotate(n=Count("id"))}
    weeks = {r["w"].date(): r["n"] for r in qs.filter(created_at__gte=now - timedelta(weeks=8)).annotate(w=TruncWeek("created_at")).values("w").annotate(n=Count("id")) if r["w"]}
    start = timezone.localdate() - timedelta(days=timezone.localdate().weekday())
    week_rows = [(start - timedelta(weeks=i), weeks.get(start - timedelta(weeks=i), 0)) for i in range(7, -1, -1)]
    peak = max([n for _, n in week_rows] + [1])
    stats = {
        "total": qs.count(),
        "unread": qs.filter(is_read=False).count(),
        "week": qs.filter(created_at__gte=now - timedelta(days=7)).count(),
        "courses": [(cid, title, by_course.get(cid, 0)) for cid, title in COURSES.items()],
        "formats": sorted(by_format.items(), key=lambda x: -x[1]),
        "weeks": [(d, n, round(n * 100 / peak)) for d, n in week_rows],
    }
    items = list((qs.filter(is_read=False) if only_unread else qs)[:300])
    return render(request, "inquiries/teacher_inquiries.html", {"stats": stats, "items": items, "only_unread": only_unread, "retention_days": RETENTION_DAYS})
