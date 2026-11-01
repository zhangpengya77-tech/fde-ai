r"""P-13：Django → Live 代理逾時安全退出（fail-closed）。

為什麼要用程式碼路徑而不是打 HTTP
--------------------------------
要讓「正在服務的隔離棧」發生逾時，只能把 Live 停掉或改它的環境變數，
兩者都會破壞同批次的其他測試。因此本腳本在**獨立進程**裡用同一份 Django
程式碼，把 `VISION_SUBMISSION_API_BASE_URL` 指向一個不可達位址，驗證：

  1. `vision_submission._get()` 逾時後拋 `RuntimeError("vision_api_unavailable")`，
     不會掛住、不會回傳半截資料、不會把例外往上炸成 500。
  2. `views.vision_resource_guard()` 接到這個 RuntimeError 後回傳 403（fail-closed），
     而不是「查不到就放行」。
  3. 整個過程在設定的 timeout 附近結束，證明有硬逾時。

輸出最後一行為 JSON，供 phase4_security_tests.py 解析。

用法：
  set DJANGO_DB_NAME=<isolated>\db\demo.sqlite3
  set DJANGO_MEDIA_ROOT=<isolated>\media
  python phase4_proxy_timeout.py
"""

from __future__ import annotations

import json
import os
import sys
import time

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS_DIR)
PROJECT_ROOT = os.path.dirname(os.path.dirname(ROOT))
sys.path.insert(0, os.path.join(PROJECT_ROOT, "student_portal"))

ISO = os.environ.get("FDE_E2E_RUN_ROOT") or os.path.join(ROOT, "isolated-phase4")
os.environ.setdefault("DJANGO_DB_NAME", os.path.join(ISO, "db", "demo.sqlite3"))
os.environ.setdefault("DJANGO_MEDIA_ROOT", os.path.join(ISO, "media"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
os.environ.setdefault("DJANGO_DEBUG", "true")
os.environ.setdefault("DJANGO_SECRET_KEY", "isolated-phase4-p13-only")

import django  # noqa: E402

django.setup()

from django.conf import settings  # noqa: E402
from django.contrib.auth import get_user_model  # noqa: E402
from django.test import RequestFactory  # noqa: E402

from learning import vision_submission  # noqa: E402
from learning import views  # noqa: E402

# 不可達位址（RFC 5737 TEST-NET-1，封包會被丟棄 → 觸發真正的連線逾時而非立即拒絕）
UNREACHABLE = "http://10.255.255.1:9"
SHORT_TIMEOUT = 3


def main() -> int:
    out: dict = {"ok": False}
    original_base = settings.VISION_SUBMISSION_API_BASE_URL
    original_timeout = settings.VISION_SUBMISSION_API_TIMEOUT_SECONDS

    try:
        settings.VISION_SUBMISSION_API_BASE_URL = UNREACHABLE
        settings.VISION_SUBMISSION_API_TIMEOUT_SECONDS = SHORT_TIMEOUT

        # ---- 1. 低層：逾時必須轉成 RuntimeError，且在 timeout 附近結束 ----
        started = time.time()
        raised = ""
        try:
            vision_submission.list_submissions(teacher_id=2)
        except RuntimeError as exc:
            raised = str(exc)
        except Exception as exc:  # noqa: BLE001 - 任何其他例外都代表沒有正確收斂
            raised = f"UNEXPECTED:{type(exc).__name__}:{exc}"
        elapsed = round(time.time() - started, 2)
        out["list_submissions"] = {
            "raised": raised,
            "elapsed_seconds": elapsed,
            "timeout_configured": SHORT_TIMEOUT,
            "bounded": elapsed <= SHORT_TIMEOUT + 6,
        }

        # ---- 2. 上層：guard 必須 fail-closed（403），不得放行 ----
        User = get_user_model()
        teacher = User.objects.filter(is_staff=True).order_by("pk").first()
        request = RequestFactory().get("/teacher/vision-center/", {"submission_id": "sub-does-not-exist"})
        request.user = teacher

        started = time.time()
        response = views.vision_resource_guard(request)
        guard_elapsed = round(time.time() - started, 2)
        out["guard"] = {
            "teacher": getattr(teacher, "username", None),
            "status_code": getattr(response, "status_code", None),
            "elapsed_seconds": guard_elapsed,
            "fail_closed": getattr(response, "status_code", None) == 403,
        }

        out["ok"] = (
            out["list_submissions"]["raised"] == "vision_api_unavailable"
            and out["list_submissions"]["bounded"]
            and out["guard"]["fail_closed"]
        )
    finally:
        settings.VISION_SUBMISSION_API_BASE_URL = original_base
        settings.VISION_SUBMISSION_API_TIMEOUT_SECONDS = original_timeout

    print(json.dumps(out, ensure_ascii=False))
    return 0 if out["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
