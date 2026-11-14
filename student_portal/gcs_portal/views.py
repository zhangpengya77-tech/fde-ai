from urllib.parse import urlsplit

from django.conf import settings
from django.contrib.auth.views import redirect_to_login
from django.http import Http404
from django.shortcuts import render
from django.urls import reverse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

from .access import ALLOWED, ANONYMOUS, DISABLED, NOT_IN_COHORT, UNVERIFIED, evaluate_access

# 只允許同源資源；不允許 inline script／style、第三方 CDN、被嵌入框架。
# connect-src 預設只有同源；P4 設定 SITL Gateway 後，page_csp() 只額外加入 Gateway 與考照場景兩個來源。
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


def _origin(url):
    """取出 scheme://host:port（CSP 只能列來源，不能帶路徑或查詢字串）。"""
    parts = urlsplit(url or "")
    return f"{parts.scheme}://{parts.netloc}" if parts.scheme and parts.netloc else ""


def sitl_enabled():
    return len(getattr(settings, "FDE_GCS_GATEWAY_SECRET", "")) >= 16


def page_csp():
    """P4：設定了 SITL Gateway 金鑰時，才在 connect-src 加 Gateway、frame-src 加考照場景；其餘維持嚴格政策。"""
    if not sitl_enabled():
        return CONTENT_SECURITY_POLICY
    gateway = _origin(settings.FDE_GCS_GATEWAY_URL)
    sim = _origin(settings.FDE_GCS_SIM_URL)
    policy = CONTENT_SECURITY_POLICY.replace("connect-src 'self'", f"connect-src 'self' {gateway}".strip())
    return policy + (f"; frame-src {sim}" if sim else "")


def _secure(response, csp=CONTENT_SECURITY_POLICY):
    response["Content-Security-Policy"] = csp
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
    context = {"gcs_role": role, "sitl_enabled": sitl_enabled(),
               "sitl_sim_url": settings.FDE_GCS_SIM_URL if sitl_enabled() else ""}
    response = render(request, "gcs_portal/home.html", context)
    return _secure(response, page_csp())
