"""遷移鏈斷言的共用工具。

背景：原本 `test_teacher_class_showcase` 與 `test_p8_showcase_security` 各寫一份
「最後一個遷移必須是 0019_golden_set_manifest_contract.py」。這個斷言在
POWER_INSPECTION_V1 合法新增 0020–0026 之後必然失敗，但它原本要保護的事情
（「不可以悄悄多出遷移」）仍然值得保留。

改法：把保護對象從「寫死某一個檔名」提升為「整條遷移鏈必須與登記清單一致」。
如此一來：

1. 任何新增、刪除、改名、編號重複或編號斷號都會被抓到；
2. 刻意新增遷移時，必須同步更新 `EXPECTED_CHAIN`，等於留下一次明確的審閱紀錄；
3. Django 實際載入的葉節點必須與磁碟上最後一個遷移一致，避免檔案存在但未接上圖。

沒有刪除或跳過任何測試。
"""

from __future__ import annotations

from pathlib import Path

from django.db import connections
from django.db.migrations.loader import MigrationLoader

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"
APP_LABEL = "learning"

# 目前合法的遷移鏈。新增遷移時必須同步更新此清單（這正是保護機制）。
EXPECTED_CHAIN: tuple[str, ...] = (
    "0001_initial",
    "0002_taskdefinitionrevision",
    "0003_teachercohortaccess",
    "0004_student_registered_email",
    "0005_anonymous_accounts_and_enrollments",
    "0006_growth_records_v15b",
    "0007_growth_evidence_metadata",
    "0008_growth_final_score_limit",
    "0009_alter_evidence_upload",
    "0010_enrollment_project_direction",
    "0011_enrollment_teacher_verified",
    "0012_enrollment_teacher_verified_name",
    "0013_enrollment_training_source",
    "0014_student_survey",
    "0015_studentsurvey_survey_version_and_more",
    "0016_visionmodelrecord",
    "0017_visionmodelrecord_snapshot_and_integrity",
    "0018_golden_set_center",
    "0019_golden_set_manifest_contract",
    "0020_power_inspection_portal",
    "0021_power_inspection_jobs",
    "0022_power_inspection_delivery",
    "0023_power_inspection_model_status",
    "0024_power_inspection_cohort_default",
    "0025_power_inspection_rule_metadata",
    "0026_power_inspection_deployment_events",
    "0027_vision_inspection_records",
)


def migration_files() -> list[str]:
    """磁碟上實際存在的 learning 遷移（依檔名排序）。"""
    return sorted(path.stem for path in MIGRATIONS_DIR.glob("0*.py"))


def assert_migration_chain(testcase) -> None:
    """檢查整條遷移鏈；失敗訊息會指出是哪一層不符合。"""
    files = migration_files()

    testcase.assertEqual(
        tuple(files),
        EXPECTED_CHAIN,
        "learning 遷移鏈與 EXPECTED_CHAIN 不一致。"
        "若這是刻意的遷移變更，請同步更新 learning/tests/migration_assertions.py。",
    )

    prefixes = [name.split("_", 1)[0] for name in files]
    testcase.assertEqual(
        len(prefixes), len(set(prefixes)), f"遷移編號重複：{prefixes}"
    )
    testcase.assertEqual(
        prefixes,
        [f"{index:04d}" for index in range(1, len(prefixes) + 1)],
        "遷移編號必須從 0001 起連續、不可斷號。",
    )

    # Django 圖的葉節點必須唯一，且就是磁碟上最後一個遷移。
    # 這裡必須給 loader 一個真實連線，否則它不會建立圖（會回空清單）。
    loader = MigrationLoader(connections["default"], ignore_no_migrations=True)
    # leaf_nodes() 產出的是 (app_label, migration_name) 節點本身，不是 (node, children)。
    leaves = sorted(
        node[1] for node in loader.graph.leaf_nodes() if node[0] == APP_LABEL
    )
    testcase.assertEqual(
        len(leaves), 1, f"{APP_LABEL} 遷移必須只有唯一葉節點，實際為：{leaves}"
    )
    testcase.assertEqual(
        leaves[0], files[-1], "磁碟上最後一個遷移必須就是 Django 圖的葉節點。"
    )
