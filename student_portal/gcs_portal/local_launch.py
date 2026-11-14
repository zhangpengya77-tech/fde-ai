"""FDE-GCS 本機一鍵啟動（教室單機仿真）的一次性登入。

只有「本機一鍵啟動器」會設定 FDE_GCS_LOCAL_LAUNCH_TOKEN（每次啟動隨機產生）；沒有設定時這個網址一律 404。
- 只接受來自本機（127.0.0.1／::1）的請求；
- 代碼以常數時間比對，用過一次就失效；
- 登入的是這台電腦專用的本機帳號（FDE_GCS_LOCAL_PILOT），只能操作本機 SITL，沒有真機控制路徑。
正式站不設定這個環境變數，所以不受影響。
"""
import hmac
import threading

from django.conf import settings
from django.contrib.auth import get_user_model, login
from django.http import Http404
from django.shortcuts import redirect
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

LOCAL_ADDRESSES = {"127.0.0.1", "::1"}
_used = threading.Lock()
_state = {"used": False}


@never_cache
@require_GET
def local_login(request, token):
    expected = getattr(settings, "FDE_GCS_LOCAL_LAUNCH_TOKEN", "")
    if len(expected) < 24 or request.META.get("REMOTE_ADDR") not in LOCAL_ADDRESSES:
        raise Http404
    with _used:
        if _state["used"] or not hmac.compare_digest(token.encode(), expected.encode()):
            raise Http404
        _state["used"] = True
    username = getattr(settings, "FDE_GCS_LOCAL_PILOT", "local-pilot@fde-gcs.local")
    user, _ = get_user_model().objects.get_or_create(username=username)
    if not user.is_staff:
        # 本機單機仿真：這台電腦的使用者就是自己 SITL 的操作者（可取得控制票）
        user.is_staff = True
        user.set_unusable_password()
        user.save()
    login(request, user, backend="django.contrib.auth.backends.ModelBackend")
    return redirect("gcs_portal:home")
