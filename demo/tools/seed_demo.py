"""FDE-AI-UAS 2.0 DEMO（合作展示版）— 展示資料建立腳本。

用途：在**完全隔離的 DEMO 環境**建立可重複使用的展示案例。
嚴格限制：
  * 只寫入 DJANGO_DB_NAME 指向的 DEMO DB。
  * 只寫入 DJANGO_MEDIA_ROOT 指向的 DEMO MEDIA。
  * 不載入、不反序列化、不推論任何 .pt（只做位元組 SHA256）。
  * 不發布 ACTIVE、不寫入正式 DB / 正式 JSON Store。

用法：
    python seed_demo.py            # 建立（若已存在則跳過）
    python seed_demo.py --reset    # 先清空 DEMO 展示資料再重建
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# --- 安全护栏（必須在 django.setup() 之前執行）-------------------------------
PROJECT_ROOT = Path(r"D:\FDE-AI-UAS-v2.0")
DEMO_ROOT = PROJECT_ROOT / "demo"
sys.path.insert(0, str(PROJECT_ROOT / "student_portal"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
os.environ["DJANGO_DEBUG"] = "true"

DEMO_DB = str(DEMO_ROOT / "runtime" / "db" / "demo.sqlite3")
DEMO_MEDIA = str(DEMO_ROOT / "runtime" / "media")
os.environ["DJANGO_DB_NAME"] = DEMO_DB
os.environ["DJANGO_MEDIA_ROOT"] = DEMO_MEDIA
os.environ["FDE_VISION_CENTER_ROOT"] = str(DEMO_ROOT / "runtime" / "vision-center")
os.environ["PYTHONNOUSERSITE"] = "1"

import django  # noqa: E402

django.setup()

from django.conf import settings  # noqa: E402
from django.contrib.auth import get_user_model  # noqa: E402
from django.core.files.base import ContentFile  # noqa: E402
from django.db import transaction  # noqa: E402
from django.utils import timezone  # noqa: E402

from learning import golden_set as golden_set_service  # noqa: E402
from learning import vision_repository  # noqa: E402
from learning.growth_records import ensure_growth_submissions  # noqa: E402
from learning.models import (  # noqa: E402
    ClassCode,
    Cohort,
    Enrollment,
    Evidence,
    GoldenSet,
    GoldenSetSample,
    GrowthRecordDefinition,
    GrowthRecordSubmission,
    LearningGroup,
    StudentProfile,
    TaskDefinition,
    TeacherCohortAccess,
    VisionModelRecord,
)
from learning.vision_rule_templates import template_for_task  # noqa: E402
import demo_credentials

USER = get_user_model()

# --- 展示常數 ----------------------------------------------------------------
DEMO_TAG = "DEMO"
STUDENT_EMAIL = "demo.student01@fde-demo.local"
STUDENT_PASSWORD = demo_credentials.student_password()
STUDENT_NICKNAME = "DEMO-STUDENT-01"

TEACHER_EMAIL = "demo.teacher@fde-demo.local"
TEACHER_PASSWORD = demo_credentials.teacher_password()
TEACHER_NAME = "DEMO 教師"

COHORT_CODE = "F450-DEMO-2026"
GROUP_CODE = "DEMO-A"
GOLDEN_SET_ID = "PROP_GOLDEN_DEMO_v1"

# 四類標籤各一；用最小合法 PNG（1x1）作為測試圖片。
PNG_1PX = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c63000100000500010d0a2db40000000049454e44ae"
    "426082"
)

LABELS = ["CW_F", "CCW_F", "CW_B", "CCW_B"]


def banner(text: str) -> None:
    print(f"\n{'=' * 72}\n  {text}\n{'=' * 72}")


def guard_environment() -> None:
    """確認所有寫入路徑都在 demo/ 之下；否則直接中止。"""
    banner("環境隔離檢查")
    checks = [
        ("DB", settings.DATABASES["default"]["NAME"], DEMO_DB),
        ("MEDIA_ROOT", str(settings.MEDIA_ROOT), DEMO_MEDIA),
    ]
    ok = True
    for label, actual, expected in checks:
        actual_norm = str(actual).replace("\\", "/")
        expected_norm = expected.replace("\\", "/")
        same = actual_norm.lower() == expected_norm.lower()
        inside = actual_norm.lower().startswith(str(DEMO_ROOT).replace("\\", "/").lower())
        flag = "OK " if (same or inside) else "!!!"
        if not (same or inside):
            ok = False
        print(f"  [{flag}] {label:<12} = {actual_norm}")
    print(f"  [{'OK ' if settings.DEBUG else '!!!'}] DEBUG        = {settings.DEBUG}")
    if not ok:
        raise SystemExit("ABORT：偵測到路徑不在 demo/ 之下，拒絕執行以免污染正式環境。")
    print("  → 隔離確認通過。")


def make_png(label: str, index: int = 1) -> ContentFile:
    """產生最小合法 PNG；不同 index 給不同位元組，使雜湊可區分。"""
    body = PNG_1PX + f"-DEMO-{label}-{index}".encode()
    return ContentFile(body, name=f"demo-sample-{label}-{index}.png")


def build_accounts():
    """建立學員與教師 DEMO 帳號，並回傳 (profile, teacher_user)。"""
    banner("1. 建立 DEMO 帳號")

    cohort, _ = Cohort.objects.get_or_create(
        cohort_id=COHORT_CODE,
        defaults={"name": "FDE-AI-UAS DEMO 展示班（苗栗合作）", "active": True},
    )
    group, _ = LearningGroup.objects.get_or_create(
        cohort=cohort, code=GROUP_CODE,
        defaults={"name": "DEMO 展示組 A", "active": True},
    )

    # --- 學員 ---
    student_user, created = USER.objects.get_or_create(
        username=STUDENT_EMAIL,
        defaults={"email": STUDENT_EMAIL, "is_active": True},
    )
    student_user.email = STUDENT_EMAIL
    student_user.is_active = True          # 展示帳號視為已完成信箱驗證
    student_user.set_password(STUDENT_PASSWORD)
    student_user.save()

    profile, _ = StudentProfile.objects.get_or_create(
        email=STUDENT_EMAIL,
        defaults={
            "student_id": "demo0000000000000000000000000001",
            "public_user_id": "DEMO-STU-0001",
            "nickname": STUDENT_NICKNAME,
            "account_type": StudentProfile.AccountType.FREE,
            "user": student_user,
            "active": True,
        },
    )
    profile.nickname = STUDENT_NICKNAME
    profile.user = student_user
    profile.active = True
    profile.save()
    print(f"  [OK] 學員帳號 {STUDENT_EMAIL} / {STUDENT_PASSWORD}")
    print(f"       FDE ID = {profile.public_user_id}")

    # --- 教師 ---
    teacher, _ = USER.objects.get_or_create(
        username=TEACHER_EMAIL,
        defaults={"email": TEACHER_EMAIL, "is_active": True},
    )
    teacher.email = TEACHER_EMAIL
    teacher.is_active = True
    teacher.is_staff = True
    teacher.first_name = TEACHER_NAME
    teacher.set_password(TEACHER_PASSWORD)
    teacher.save()
    TeacherCohortAccess.objects.get_or_create(teacher=teacher, cohort=cohort)
    print(f"  [OK] 教師帳號 {TEACHER_EMAIL} / {TEACHER_PASSWORD}")
    print(f"       is_staff = {teacher.is_staff}（教師身分）")

    # --- Enrollment ---
    enrollment, _ = Enrollment.objects.get_or_create(
        student=profile, cohort=cohort,
        defaults={
            "group": group,
            "project_direction": "ai_flight_assessment",
            "training_source": Enrollment.TrainingSource.COLLEGE,
            "active": True,
            "teacher_verified": True,
            "teacher_verified_name": TEACHER_NAME,
        },
    )
    enrollment.group = group
    enrollment.project_direction = "ai_flight_assessment"
    enrollment.active = True
    enrollment.teacher_verified = True
    enrollment.teacher_verified_name = TEACHER_NAME
    enrollment.save()

    ClassCode.objects.get_or_create(
        code=COHORT_CODE, cohort=cohort, defaults={"active": True}
    )
    print(f"  [OK] 班級 {COHORT_CODE} / 組別 {GROUP_CODE} / 方向 ai_flight_assessment")
    return cohort, group, profile, teacher, enrollment


def build_growth_records(cohort, enrollment):
    """確保 R01~R08 的成長紀錄與任務進度齊備（沿用既有內建種子）。"""
    banner("2. 建立成長紀錄與任務卡")

    # ensure_growth_submissions 內部會先呼叫 seed_growth_record_definitions，
    # 因此這裡直接呼叫即可，不自行複製第二套定義。
    submissions = ensure_growth_submissions(enrollment)
    defs = list(
        GrowthRecordDefinition.objects.filter(cohort=cohort).order_by("display_order")
    )
    print(f"  [OK] 成長紀錄定義 {len(defs)} 筆：{[d.slot_id for d in defs]}")
    print(f"  [OK] 學員成長紀錄提交 {len(submissions)} 筆")

    tasks = TaskDefinition.objects.filter(active=True)
    print(f"  [OK] 任務卡 {tasks.count()} 張")

    if not any(d.slot_id == "R07" for d in defs):
        raise SystemExit("ABORT：DEMO DB 缺少 R07 成長紀錄定義。")
    return defs, submissions


def build_r07_evidence(cohort, group, profile, teacher, enrollment):
    """建立 R07 的模型證據（不載入 .pt，只做位元組雜湊）。"""
    banner("3. 建立 R07 模型提交與教師候選審核")

    submission = GrowthRecordSubmission.objects.get(
        enrollment=enrollment, definition__slot_id="R07"
    )

    existing = Evidence.objects.filter(
        growth_submission=submission, evidence_type=Evidence.Type.MODEL
    ).first()
    if existing is not None:
        print(f"  [SKIP] R07 證據已存在 evidence_id={existing.evidence_id}")
        evidence = existing
    else:
        # 組出一個「內容可重現」的假 .pt：DEMO 標記 + 固定位元組。
        # 全程只做 bytes 讀寫與 SHA256，絕不載入或反序列化。
        fake_bytes = (
            b"FDE-AI-UAS-DEMO-TEST-ONLY-best.pt\x00"
            + b"DEMO_TEST_ONLY\x00"
            + b"\x00" * 2048
        )
        filename = "DEMO_TEST_ONLY_best.pt"
        evidence = Evidence(
            growth_submission=submission,
            evidence_type=Evidence.Type.MODEL,
            description="R07 AI Vision / YOLO 訓練模型（DEMO 展示樣本）",
            original_metadata={
                "filename": filename,
                "extension": ".pt",
                "content_type": "application/octet-stream",
                "size_bytes": len(fake_bytes),
                "task_type": "PROP_DIRECTION",
                "evidence_type": "YOLO_MODEL",
                "demo": True,
            },
        )
        with transaction.atomic():
            evidence.upload.save(filename, ContentFile(fake_bytes), save=True)
            sha = vision_repository.compute_sha256(fake_bytes)
            evidence.processed_metadata = {
                **evidence.original_metadata,
                "vision_submission_id": f"DEMO-SUB-{evidence.evidence_id}",
                "submission_status": "PENDING_REVIEW",
                "artifact_sha256": sha,
                "demo": True,
                "note": "DEMO 展示資料，未連接 Vision 服務，未執行任何模型推論。",
            }
            evidence.save(update_fields=["processed_metadata"])
            submission.status = GrowthRecordSubmission.Status.SUBMITTED
            submission.submitted_at = timezone.now()
            submission.student_note = "DEMO：已完成槳葉方向模型訓練並提交 best.pt。"
            submission.save(update_fields=["status", "submitted_at", "student_note", "updated_at"])
        print(f"  [OK] R07 證據建立 evidence_id={evidence.evidence_id}")
        print(f"       SHA256 = {sha}")

    # 教師列為候選（CANDIDATE）
    metadata = dict(evidence.processed_metadata or {})
    review = dict(metadata.get("vision_model_review") or {})
    if review.get("status") != "CANDIDATE":
        template = template_for_task("PROP_DIRECTION")
        metadata["vision_model_review"] = {
            "status": "CANDIDATE",
            "task_type": "PROP_DIRECTION",
            "rule_template_id": template["template_id"],
            "current_note": "DEMO：槳葉方向正確，列為候選以收藏至模型倉庫。",
            "history": [
                {
                    "action": "CANDIDATE",
                    "teacher_id": str(teacher.pk),
                    "teacher_name": TEACHER_NAME,
                    "note": "DEMO：槳葉方向正確，列為候選。",
                    "at": timezone.now().isoformat(),
                }
            ],
        }
        evidence.processed_metadata = metadata
        evidence.save(update_fields=["processed_metadata"])
        print("  [OK] 教師已審核為 CANDIDATE")
    else:
        print("  [SKIP] 教師審核狀態已是 CANDIDATE")
    return evidence


def build_model_repository(evidence, teacher):
    """教師收藏模型為 V1（建立不可變快照）。"""
    banner("4. 建立 Vision Model Repository V1")

    existing = VisionModelRecord.objects.filter(evidence=evidence).first()
    if existing is not None:
        print(f"  [SKIP] 已入庫 model_version={existing.model_version}")
        return existing

    record = vision_repository.catalogue_model(
        evidence=evidence,
        teacher=teacher,
        model_version="V1",
    )
    record.refresh_from_db()
    print(f"  [OK] 入庫成功 model_version={record.model_version}")
    print(f"       artifact_sha256   = {record.artifact_sha256}")
    print(f"       snapshot_status   = {record.snapshot_status}")
    print(f"       snapshot_sha256   = {record.snapshot_sha256}")
    print(f"       integrity_status  = {record.integrity_status}")
    print(f"       review_status     = {record.review_status}")
    print(f"       is_demo_test_only = {record.is_demo_test_only}")
    print(f"       active_blocked    = {record.active_blocked_reason()}")
    return record


def build_golden_set(teacher):
    """建立 Golden Set 測試集、四類標籤樣本，並鎖定為 FROZEN。"""
    banner("5. 建立 Golden Set 測試集（四類標籤 → FROZEN）")

    gs = GoldenSet.objects.filter(golden_set_id=GOLDEN_SET_ID).first()
    if gs is not None and gs.status == GoldenSet.Status.FROZEN:
        samples = gs.samples.all()
        print(f"  [SKIP] 已存在且已 FROZEN，樣本 {samples.count()} 筆")
        print(f"       manifest_sha256 = {gs.manifest_sha256}")
        return gs

    if gs is None:
        gs = golden_set_service.create_golden_set(
            golden_set_id=GOLDEN_SET_ID,
            task_id="PROP_DIRECTION",
            name="DEMO 槳葉方向標準測試集 v1",
            description=(
                "苗栗合作展示用測試集。涵蓋 CW_F / CCW_F / CW_B / CCW_B 四類，"
                "每類 1 張最小合法 PNG 佔位圖；僅用於展示 Golden Set 管理流程，"
                "不代表任何模型已通過驗證。"
            ),
            version="v1",
            teacher=teacher,
        )
        print(f"  [OK] 建立測試集 {gs.golden_set_id}")

    for label in LABELS:
        for index in (1, 2):
            exists = GoldenSetSample.objects.filter(
                golden_set=gs, label=label, note=f"DEMO：{label} 展示樣本 #{index}"
            ).exists()
            if exists:
                print(f"  [SKIP] 樣本 {label} #{index} 已存在")
                continue
            sample = golden_set_service.add_sample(
                golden_set=gs,
                label=label,
                image=make_png(label, index),
                annotation_source=GoldenSet.AnnotationSource.TEACHER_PHOTO,
                teacher=teacher,
                note=f"DEMO：{label} 展示樣本 #{index}",
            )
            golden_set_service.confirm_sample(
                sample=sample, teacher=teacher, note="DEMO：教師確認標籤正確。"
            )
            print(f"  [OK] 新增並確認樣本 {label} #{index}")

    gs.refresh_from_db()
    if gs.status != GoldenSet.Status.FROZEN:
        golden_set_service.freeze_golden_set(golden_set=gs, teacher=teacher)
        gs.refresh_from_db()
        print("  [OK] 已鎖定為 FROZEN")

    summary = golden_set_service.golden_set_summary(gs)
    binding = gs.manifest_binding_status
    completeness = golden_set_service.completeness_level(gs)
    print(f"       status           = {gs.status}")
    print(f"       samples          = {summary['sample_count']}（已確認 {summary['confirmed_sample_count']}）")
    print(f"       label_distribution = {summary['label_distribution']}")
    print(f"       missing_labels   = {summary['missing_labels']}")
    print(f"       manifest_sha256  = {gs.manifest_sha256}")
    print(f"       binding_status   = {binding}")
    print(f"       completeness     = {completeness}")
    return gs


def main() -> None:
    reset = "--reset" in sys.argv
    guard_environment()

    if reset:
        # 不直接刪除 FROZEN 測試集樣本 —— P1 守衛（golden_set_guard）會正確地阻止，
        # 這是預期行為，不應繞過。重建展示資料一律走「重建 DEMO DB」路徑
        # （見 demo/tools/build_demo_db.sh --reset），確保不會在鎖定資料上動手。
        raise SystemExit(
            "ABORT：--reset 不可在此腳本執行。\n"
            "       FROZEN 測試集受 P1 守衛保護，刪除會被正確阻止。\n"
            "       請改用：bash demo/tools/build_demo_db.sh --reset && \\\n"
            "                python demo/tools/seed_demo.py"
        )

    cohort, group, profile, teacher, enrollment = build_accounts()
    build_growth_records(cohort, enrollment)
    evidence = build_r07_evidence(cohort, group, profile, teacher, enrollment)
    record = build_model_repository(evidence, teacher)
    gs = build_golden_set(teacher)

    banner("DEMO 展示資料建立完成")
    print(f"  學員帳號：{STUDENT_EMAIL} / {STUDENT_PASSWORD}")
    print(f"  教師帳號：{TEACHER_EMAIL} / {TEACHER_PASSWORD}")
    print(f"  模型倉庫：{record.model_version} · {record.artifact_sha256[:16]}…")
    print(f"  Golden Set：{gs.golden_set_id} · {gs.samples.count()} 樣本 · {gs.status}")
    print(f"  DEMO DB  ：{DEMO_DB}")
    print(f"  DEMO MEDIA：{DEMO_MEDIA}")
    print()


if __name__ == "__main__":
    main()
