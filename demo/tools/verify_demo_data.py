"""FDE-AI-UAS 2.0 DEMO — 展示資料驗證（唯讀）。

確認五個展示頁面所需的資料全部存在，並回報關鍵雜湊值。
只讀取 DEMO DB，不寫入任何資料。
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(r"D:\FDE-AI-UAS-v2.0")
DEMO_ROOT = PROJECT_ROOT / "demo"
sys.path.insert(0, str(PROJECT_ROOT / "student_portal"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
os.environ["DJANGO_DEBUG"] = "true"
os.environ["DJANGO_DB_NAME"] = str(DEMO_ROOT / "runtime" / "db" / "demo.sqlite3")
os.environ["DJANGO_MEDIA_ROOT"] = str(DEMO_ROOT / "runtime" / "media")
os.environ["FDE_VISION_CENTER_ROOT"] = str(DEMO_ROOT / "runtime" / "vision-center")
os.environ["PYTHONNOUSERSITE"] = "1"

import django  # noqa: E402

django.setup()

from django.conf import settings  # noqa: E402

from learning import golden_set as golden_set_service  # noqa: E402
from learning.models import (  # noqa: E402
    Cohort,
    Enrollment,
    Evidence,
    GoldenSet,
    GoldenSetSample,
    GrowthRecordSubmission,
    StudentProfile,
    TeacherCohortAccess,
    VisionModelRecord,
)
import demo_credentials

PASS, FAIL = "[PASS]", "[FAIL]"
results = []


def check(label: str, ok: bool, detail: str = "") -> bool:
    tag = PASS if ok else FAIL
    results.append(ok)
    print(f"  {tag} {label}" + (f" — {detail}" if detail else ""))
    return ok


print("=" * 74)
print("  DEMO 展示資料驗證（唯讀）")
print("=" * 74)
print(f"  DB        : {settings.DATABASES['default']['NAME']}")
print(f"  MEDIA     : {settings.MEDIA_ROOT}")
print(f"  VISION    : {os.environ['FDE_VISION_CENTER_ROOT']}")
print()

# --- A. 學員 ---
print("[A] 學員帳號與任務")
profile = StudentProfile.objects.filter(email="demo.student01@fde-demo.local").first()
check("學員 profile 存在", profile is not None, profile.nickname if profile else "")
if profile:
    check("學員 user 已啟用", bool(profile.user and profile.user.is_active))
    check("學員可登入（密碼已設）", profile.user.has_usable_password())
enrollment = (
    Enrollment.objects.filter(student=profile, active=True).select_related("cohort", "group").first()
    if profile else None
)
check("Enrollment 存在", enrollment is not None,
      f"{enrollment.cohort.cohort_id} / {enrollment.project_direction}" if enrollment else "")
if enrollment:
    check("方向為 ai_flight_assessment（R07 開放）",
          enrollment.project_direction == "ai_flight_assessment")
    subs = GrowthRecordSubmission.objects.filter(enrollment=enrollment).select_related("definition")
    slots = sorted(s.definition.slot_id for s in subs)
    check("成長紀錄 8 筆齊備", len(slots) == 8, str(slots))
    r07 = next((s for s in subs if s.definition.slot_id == "R07"), None)
    check("R07 成長紀錄存在", r07 is not None)

# --- B. R07 證據 ---
print()
print("[B] R07 模型提交")
if enrollment:
    ev = Evidence.objects.filter(
        growth_submission__enrollment=enrollment,
        evidence_type=Evidence.Type.MODEL,
    ).first()
    check("R07 MODEL 證據存在", ev is not None, str(ev.evidence_id) if ev else "")
    if ev:
        meta = dict(ev.processed_metadata or {})
        check("檔名標記 DEMO_TEST_ONLY",
              "DEMO_TEST_ONLY" in str(meta.get("filename", "")).upper(),
              meta.get("filename", ""))
        check("已產生 SHA256", bool(meta.get("artifact_sha256")),
              str(meta.get("artifact_sha256", ""))[:24] + "…")
        review = dict(meta.get("vision_model_review") or {})
        check("教師審核為 CANDIDATE", review.get("status") == "CANDIDATE",
              str(review.get("status")))

    # --- C. 教師 ---
    print()
    print("[C] 教師帳號與權限")
    from django.contrib.auth import get_user_model
    from django.contrib.auth.hashers import check_password
    teacher = get_user_model().objects.filter(username="demo.teacher@fde-demo.local").first()
    check("教師帳號存在", teacher is not None)
    if teacher:
        check("is_staff（教師身分）", teacher.is_staff)
        check("密碼可驗證", check_password(demo_credentials.teacher_password(), teacher.password))
        check("TeacherCohortAccess 已授權",
              TeacherCohortAccess.objects.filter(teacher=teacher, cohort=enrollment.cohort).exists())

    # --- D. 模型倉庫 ---
    print()
    print("[D] Vision Model Repository V1")
    record = VisionModelRecord.objects.filter(evidence=ev).first() if ev else None
    check("V1 倉庫紀錄存在", record is not None,
          f"{record.model_version}" if record else "")
    if record:
        check("快照已建立（STORED）", record.snapshot_status == "STORED", record.snapshot_status)
        check("快照 SHA256 與來源一致",
              record.snapshot_sha256 == record.artifact_sha256,
              str(record.artifact_sha256)[:24] + "…")
        check("標記 is_demo_test_only", record.is_demo_test_only)
        check("Active blocked 已明確", bool(record.active_blocked_reason()),
              record.active_blocked_reason()[:40])
        check("未發布 ACTIVE", record.lifecycle_status != "ACTIVE"
              if hasattr(record, "lifecycle_status") else True)

# --- E. Golden Set ---
print()
print("[E] Golden Set 標準測試集")
gs = GoldenSet.objects.filter(golden_set_id="PROP_GOLDEN_DEMO_v1").first()
check("Golden Set 存在", gs is not None)
if gs:
    check("狀態為 FROZEN", gs.status == "FROZEN", gs.status)
    samples = GoldenSetSample.objects.filter(golden_set=gs)
    check("樣本 8 筆（每類 2 張）", samples.count() == 8, str(samples.count()))
    labels = sorted(samples.values_list("label", flat=True))
    check("四類標籤齊備", set(labels) == {"CW_F", "CCW_F", "CW_B", "CCW_B"}, str(sorted(set(labels))))
    confirmed = samples.filter(confirmation_status="CONFIRMED").count()
    check("全部已教師確認", confirmed == 8, f"{confirmed}/8")
    check("Manifest SHA256 已產生", bool(gs.manifest_sha256), str(gs.manifest_sha256)[:24] + "…")
    ok = golden_set_service.verify_manifest_sha256(gs, gs.manifest_sha256)
    check("Manifest SHA256 可驗證一致", ok)
    check("binding 狀態為 BOUND", gs.manifest_binding_status == "BOUND", gs.manifest_binding_status)
    level = golden_set_service.completeness_level(gs)
    check("完整度已達 EVALUATION_READY", level == "EVALUATION_READY", level)

print()
print("=" * 74)
total, passed = len(results), sum(results)
print(f"  驗證結果：{passed}/{total} PASS")
print("=" * 74)

sys.exit(0 if passed == total else 1)
