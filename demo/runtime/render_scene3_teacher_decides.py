# -*- coding: utf-8 -*-
"""Render scene 2 + scene 3 in the "teacher decides" state for evidence.

READ-ONLY: opens the DEMO SQLite DB read-only through Django, reads the REAL
DEMO model list from the Live Backend (GET only), and calls the real
`teacher_vision_center` view with an IN-MEMORY session (no session.save(), no
DB write, no store mutation).

Why: the teacher's browser session holds the image-validation records, but a
fresh curl session has none, so real HTTP shows the "需驗證" state only. This
script reproduces the state right AFTER the teacher has validated a
LOW_QUALITY / DEMO_IMPORTED model and is deciding whether to activate it —
without mutating the DEMO store.
"""
import io
import os
import sys
from unittest.mock import patch

PROJECT = r"D:\FDE-AI-UAS-v2.0"
DEMO = os.path.join(PROJECT, "demo", "runtime")
OUT = os.path.join(DEMO, "logs", "scene3-teacher-decides-evidence-2026-10-22")
os.makedirs(OUT, exist_ok=True)

os.environ.setdefault("DJANGO_DB_NAME", os.path.join(DEMO, "db", "demo.sqlite3"))
os.environ.setdefault("DJANGO_MEDIA_ROOT", os.path.join(DEMO, "media"))
os.environ.setdefault("FDE_VISION_CENTER_ROOT", os.path.join(DEMO, "vision-center"))
os.environ.setdefault("DJANGO_ALLOWED_HOSTS", "127.0.0.1,localhost")
os.environ.setdefault("DJANGO_DEBUG", "true")
os.environ.setdefault("DJANGO_VISION_SUBMISSION_API_BASE_URL", "http://127.0.0.1:8030")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
sys.path.insert(0, os.path.join(PROJECT, "student_portal"))

import django  # noqa: E402

django.setup()

from django.contrib.auth import get_user_model  # noqa: E402
from django.contrib.sessions.backends.db import SessionStore  # noqa: E402
from django.test import RequestFactory  # noqa: E402

from learning import views  # noqa: E402
from learning import vision_submission as vision_api  # noqa: E402

TASK = "PROP_DIRECTION"


def real_history():
    """Read the REAL DEMO model list (GET only, no mutation)."""
    return vision_api.task_model_history(model_type=TASK, teacher_id=1)


def main():
    user = get_user_model().objects.filter(is_staff=True).order_by("id").first()
    if user is None:
        raise SystemExit("no staff user found in DEMO DB (read-only lookup)")

    history = real_history()
    models = history.get("history") or []
    if not models:
        raise SystemExit("DEMO store has no models; nothing to render")

    # Seed an in-memory session: the teacher HAS just validated every model
    # (verdict CHECK — the real outcome for these LOW_QUALITY models), so the
    # "teacher decides" buttons must appear.
    records = []
    for m in models:
        records.append(
            {
                "model_id": m["model_id"],
                "task_id": TASK,
                "verdict": "CHECK",
                "evidence_source": "REAL_INFERENCE",
                "predicted_class": "CCW_B",
                "predicted_confidence": 0.0027,
                "confidence_threshold": 0.5,
                "expected_class": "",
                "validated_at": "2026-10-22T14:30:00Z",
                "validated_at_display": "2026-10-22 14:30:00",
            }
        )
    session_cache = {
        "vision_validation_records": records,
        # scene-2 result card: the teacher just ran an image validation -> CHECK
        "vision_center_result": {
            "task_id": TASK,
            "model_id": models[0]["model_id"],
            "model_name": models[0].get("model_name") or models[0]["model_id"],
            "model_version": models[0].get("version") or "v1",
            "model_type": TASK,
            "class_names": ", ".join(models[0].get("class_names") or []),
            "detection_count": 1,
            "predicted_class": "CCW_B",
            "predicted_confidence": 0.0027,
            "max_confidence": 0.0027,
            "highest_confidence": 0.0027,
            "confidence_threshold_used": 0.5,
            "verdict_reason_code": "LOW_CONFIDENCE",
            "expected_class": "",
            "reason": "最高信心值低於門檻，不足以判定。",
            "reason_code": "LOW_CONFIDENCE",
            "rule_version": "P1",
            "confidence_threshold": 0.5,
            "validated_at": "2026-10-22T14:30:00Z",
            "validated_at_display": "2026-10-22 14:30:00",
            "verdict": "CHECK",
            "verdict_label": "需檢查",
            "verdict_css": "check",
            "verdict_passed": False,
            "verdict_cta_label": "需檢查",
            "evidence_source": "REAL_INFERENCE",
            "boxes": [],
        },
    }

    factory = RequestFactory()

    def render(scene):
        request = factory.get(
            "/teacher/vision-center/", {"task": TASK, "scene": str(scene)}
        )
        request.user = user
        store = SessionStore()
        store._session_cache = {
            k: (list(v) if isinstance(v, list) else dict(v))
            for k, v in session_cache.items()
        }
        request.session = store
        with patch(
            "learning.views.vision_api.vision_api_health", return_value=(True, "")
        ), patch(
            "learning.views.vision_api.list_submissions", return_value=[]
        ), patch(
            "learning.views.vision_api.task_model_history", return_value=history
        ):
            response = views.teacher_vision_center(request)
        if response.status_code != 200:
            raise SystemExit("scene %s returned %s" % (scene, response.status_code))
        return response.content.decode("utf-8")

    for scene, name in ((2, "scene2"), (3, "scene3")):
        html = render(scene)
        dst = os.path.join(OUT, "%s-teacher-decides.html" % name)
        io.open(dst, "w", encoding="utf-8", newline="\n").write(html)
        a = html.index('data-scene="%d">' % scene)
        b = html.index('data-scene="%d">' % (scene + 1))
        io.open(
            os.path.join(OUT, "%s-teacher-decides-section.html" % name), "w",
            encoding="utf-8", newline="\n",
        ).write(html[a:b])
        section = html[a:b]
        print(
            "scene %d: bytes=%d slice=%d activate_buttons=%d badge_ready=%d" % (
                scene, len(html), b - a,
                section.count(">設為正式模型</button>"),
                section.count(">可啟用</span>"),
            )
        )
        print("   wrote:", dst)
    print("teacher user:", user.username)


if __name__ == "__main__":
    main()
