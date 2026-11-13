from django.contrib.auth.views import redirect_to_login
from django.http import Http404
from django.shortcuts import render
from django.urls import reverse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

from .access import ALLOWED, ANONYMOUS, DISABLED, NOT_IN_COHORT, UNVERIFIED, evaluate_access

# 只允許同源資源；不允許 inline script／style、第三方 CDN、被嵌入框架。
# connect-src 目前只有同源；P4 接入 SITL Gateway 時再明確加入其位址。
CONTENT_SECURITY_POLICY = "; ".join(
    [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ]
)

DENIED_MESSAGES = {
    UNVERIFIED: "你的學員帳號尚未完成啟用，請聯絡教師確認。",
    NOT_IN_COHORT: "你所在的班級尚未開放 FDE-AI 地面站，請等待教師開放。",
}


def _secure(response):
    response["Content-Security-Policy"] = CONTENT_SECURITY_POLICY
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    response["Referrer-Policy"] = "same-origin"
    response["X-Frame-Options"] = "DENY"
    return response


@never_cache
@require_GET
def gcs_home(request):
    state = evaluate_access(request)
    if state == DISABLED:
        raise Http404
    if state == ANONYMOUS:
        return redirect_to_login(request.get_full_path(), reverse("learning:student_login"))
    if state != ALLOWED:
        response = render(
            request,
            "gcs_portal/denied.html",
            {"message": DENIED_MESSAGES.get(state, DENIED_MESSAGES[NOT_IN_COHORT])},
            status=403,
        )
        return _secure(response)
    role = "teacher" if request.user.is_staff else "student"
    response = render(request, "gcs_portal/home.html", {"gcs_role": role})
    return _secure(response)
