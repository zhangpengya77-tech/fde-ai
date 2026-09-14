import json
from pathlib import Path

from django.db.models import Q

from .models import GrowthRecordDefinition, GrowthRecordSubmission


GROWTH_RECORDS_CONFIG = Path(__file__).parent / "data" / "growth_records_v1.json"


def load_growth_record_config():
    with GROWTH_RECORDS_CONFIG.open(encoding="utf-8") as config_file:
        return json.load(config_file)


def seed_growth_record_definitions(cohort):
    definitions = []
    for item in load_growth_record_config():
        definition, _ = GrowthRecordDefinition.objects.get_or_create(
            cohort=cohort,
            slot_id=item["slot_id"],
            group_scope=None,
            defaults={key: value for key, value in item.items() if key != "slot_id"},
        )
        definitions.append(definition)
    return definitions


def ensure_growth_submissions(enrollment):
    seed_growth_record_definitions(enrollment.cohort)
    definitions = GrowthRecordDefinition.objects.filter(cohort=enrollment.cohort).filter(
        Q(group_scope__isnull=True) | Q(group_scope_id=enrollment.group_id)
    )
    selected_by_slot = {}
    for definition in definitions:
        current = selected_by_slot.get(definition.slot_id)
        if current is None or definition.group_scope_id:
            selected_by_slot[definition.slot_id] = definition

    submissions = []
    for definition in selected_by_slot.values():
        if not definition.enabled:
            continue
        submission, _ = GrowthRecordSubmission.objects.get_or_create(
            enrollment=enrollment, definition=definition
        )
        submissions.append(submission)
    return sorted(submissions, key=lambda submission: (submission.definition.display_order, submission.definition.slot_id))
