# -*- coding: utf-8 -*-
"""Render the scene-2 page in the PASSED state (verdict == MATCH) for evidence.

READ-ONLY: opens the DEMO SQLite DB read-only through Django, calls the real
`teacher_vision_center` view with an IN-MEMORY session (no session.save(), no
DB write), and writes the served HTML to the evidence folder.

Why this exists: the live DEMO teacher session has no passed validation, and
the DEMO models are LOW_QUALITY, so a real HTTP POST could never produce MATCH.
The negative path is verified over real HTTP by verify_scene2_cta_http.sh; this
script covers the positive path with the exact same view + template code.
"""
import io
import os
import sys
from unittest.mock import patch

PROJECT = r"D:\FDE-AI-UAS-v2.0"
DEMO = os.path.join(PROJECT, "demo", "runtime")
OUT = os.path.join(DEMO, "logs", "scene2-pass-cta-evidence-2026-10-22")
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

TASK = "PROP_DIRECTION"

PASSED_RESULT = {
    "task_id": TASK,
    "model_id": "PROP_demo",
    "model_name": "學員模型 e5b8b8",
    "model_version": "v1",
    "model_type": TASK,
    "class_names": "CW_F, CCW_F, CW_B, CCW_B",
    "detection_count": 1,
    "predicted_class": "CW_F",
    "predicted_confidence": 0.93,
    "max_confidence": 0.93,
    "highest_confidence": 0.93,
    "confidence_threshold_used": 0.5,
    "verdict_reason_code": "OK",
    "expected_class": "CW_F",
    "reason": "模型預測與教師標註相符，且最高信心值達門檻。",
    "reason_code": "OK",
    "rule_version": "P1",
    "confidence_threshold": 0.5,
    "validated_at": "2026-10-22T12:30:00Z",
    "validated_at_display": "2026-10-22 12:30:00",
    "verdict": "MATCH",
    "verdict_label": "通過",
    "verdict_css": "pass",
    "verdict_passed": True,
    "evidence_source": "REAL_INFERENCE",
    "boxes": [{"class": "CW_F", "confidence": 0.93, "bbox": [10, 10, 30, 30]}],
}

MODEL = {
    "model_id": "PROP_demo",
    "model_type": TASK,
    "model_name": "學員模型 e5b8b8",
    "version": "v1",
    "status": "VALIDATED",
    "validation_status": "VALIDATED",
    "file_size": 6_252_849,
    "uploaded_at": "2026-10-22T10:23:11Z",
    "activated_at": None,
    "class_names": ["CW_F", "CCW_F", "CW_B", "CCW_B"],
}

HISTORY = {
    "model_type": TASK,
    "history": [MODEL],
    "active": None,
    "inference_source": {"active_model_id": None},
}


def main():
    user = (
        get_user_model()
        .objects.filter(is_staff=True)
        .order_by("id")
        .first()
    )
    if user is None:
        raise SystemExit("no staff user found in DEMO DB (read-only lookup)")

    factory = RequestFactory()
    request = factory.get(
        "/teacher/vision-center/", {"task": TASK, "scene": "2"}
    )
    request.user = user

    store = SessionStore()
    store._session_cache = {"vision_center_result": dict(PASSED_RESULT)}
    request.session = store

    with patch(
        "learning.views.vision_api.vision_api_health", return_value=(True, "")
    ), patch(
        "learning.views.vision_api.list_submissions", return_value=[]
    ), patch(
        "learning.views.vision_api.task_model_history", return_value=HISTORY
    ):
        response = views.teacher_vision_center(request)

    if response.status_code != 200:
        raise SystemExit("view returned %s" % response.status_code)

    html = response.content.decode("utf-8")
    dst = os.path.join(OUT, "scene2-passed-render.html")
    io.open(dst, "w", encoding="utf-8", newline="\n").write(html)

    slice_dst = os.path.join(OUT, "scene2-passed-section.html")
    a = html.index('data-scene="2">')
    b = html.index('data-scene="3">')
    io.open(slice_dst, "w", encoding="utf-8", newline="\n").write(html[a:b])

    needle = "測試通過 → 前往啟用正式模型"
    print("teacher user:", user.username)
    print("rendered bytes:", len(html))
    print("scene2 slice bytes:", b - a)
    print("CTA occurrences in scene2 slice:", html[a:b].count(needle))
    print("wrote:", dst)
    print("wrote:", slice_dst)


if __name__ == "__main__":
    main()
