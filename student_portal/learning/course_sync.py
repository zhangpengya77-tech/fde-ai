import json
from pathlib import Path

from django.core.management.base import CommandError
from django.db import transaction

from .models import Cohort, GrowthRecordDefinition, TaskDefinition


DATA_ROOT = Path(__file__).parent / "data"
TASKS_CONFIG = DATA_ROOT / "tasks_v1.json"
GROWTH_CONFIG = DATA_ROOT / "growth_records_v1.json"


def _load(path):
    with path.open(encoding="utf-8") as source:
        return json.load(source)


def _validate_ids(definitions, key, prefix, expected_count):
    ids = [item.get(key) for item in definitions]
    expected = [f"{prefix}{index:02d}" for index in range(1, expected_count + 1)]
    if ids != expected:
        raise CommandError(f"{key} config must define {prefix}01 through {prefix}{expected_count:02d} in order.")


@transaction.atomic
def sync_course_definitions(*, cohorts=None):
    tasks = _load(TASKS_CONFIG)
    growth_records = _load(GROWTH_CONFIG)
    _validate_ids(tasks, "task_id", "T", 12)
    _validate_ids(growth_records, "slot_id", "R", 8)

    task_fields = ("sort_order", "stage", "title", "description", "requirements", "evidence_required", "active")
    task_created = task_updated = 0
    for definition in tasks:
        task_values = {field: definition[field] for field in task_fields if field in definition}
        task_values.setdefault("active", True)
        task, created = TaskDefinition.objects.get_or_create(
            task_id=definition["task_id"],
            defaults=task_values,
        )
        if created:
            task_created += 1
            continue
        changed = False
        for field, value in task_values.items():
            if getattr(task, field) != value:
                setattr(task, field, value)
                changed = True
        if changed:
            task.save(update_fields=task_fields)
            task_updated += 1

    growth_created = growth_updated = 0
    cohorts = Cohort.objects.all() if cohorts is None else cohorts
    growth_fields = (
        "title", "description", "completion_requirements", "evidence_requirement",
        "learning_resource", "display_order", "enabled",
    )
    for cohort in cohorts:
        for definition in growth_records:
            growth_values = {field: definition[field] for field in growth_fields if field in definition}
            growth_values.setdefault("enabled", True)
            record, created = GrowthRecordDefinition.objects.get_or_create(
                cohort=cohort,
                slot_id=definition["slot_id"],
                group_scope=None,
                defaults=growth_values,
            )
            if created:
                growth_created += 1
                continue
            changed = False
            for field, value in growth_values.items():
                if getattr(record, field) != value:
                    setattr(record, field, value)
                    changed = True
            if changed:
                record.save(update_fields=growth_fields)
                growth_updated += 1

    return {
        "tasks_created": task_created,
        "tasks_updated": task_updated,
        "growth_created": growth_created,
        "growth_updated": growth_updated,
    }
