from collections import Counter

from .forms import (
    SURVEY_DURATION_CHOICES,
    SURVEY_FORMAT_CHOICES,
    SURVEY_FUTURE_INTEREST_CHOICES,
    SURVEY_LICENSE_CHOICES,
    SURVEY_PRIORITY_CHOICES,
)
from .models import StudentSurvey


PATHS = {
    "2.0": ("path_20_interest", "2.0 無人系統專業人才"),
    "2.5": ("path_25_interest", "2.5 FPV 工程應用"),
    "3.0": ("path_30_interest", "3.0 無人系統軟體工程師"),
}
PATH_INTEREST_CHOICES = [
    (value, label) for value, label in StudentSurvey.PathInterest.choices
]


def choice_labels(choices):
    return dict(choices)


def labels_for(values, choices):
    labels = choice_labels(choices)
    return [labels.get(value, value) for value in (values or [])]


def contact_status(survey):
    if survey.contact_opt_in and survey.contact_email.strip():
        return "contactable"
    if survey.contact_opt_in:
        return "willing_no_email"
    return "survey_only"


def contact_status_label(status):
    return {
        "survey_only": "僅調查",
        "willing_no_email": "願意收到資訊／未留 Email",
        "contactable": "可後續聯絡",
    }[status]


def _counter_stats(values, choices, denominator=None):
    counts = Counter(value for value in values if value)
    labels = choice_labels(choices)
    denominator = denominator if denominator is not None else sum(counts.values())
    return [
        {
            "value": value,
            "label": labels.get(value, value),
            "count": counts.get(value, 0),
            "percent": round(counts.get(value, 0) * 100 / denominator, 1) if denominator else 0,
        }
        for value, label in choices
    ]


def apply_survey_filters(surveys, params):
    filters = {
        "path_20": "path_20_interest",
        "path_25": "path_25_interest",
        "path_30": "path_30_interest",
        "g03": "advanced_course_intent",
    }
    selected = {name: params.get(name, "").strip() for name in filters}
    selected_interest = params.get("interest", "").strip()
    selected_license = params.get("license", "").strip()
    selected_contact = params.get("contact", "").strip()
    filtered = []
    for survey in surveys:
        if any(selected[name] and getattr(survey, field) != selected[name] for name, field in filters.items()):
            continue
        if selected_interest and selected_interest not in (survey.future_interests or []):
            continue
        if selected_license and selected_license not in (survey.license_interest or []):
            continue
        if selected_contact and contact_status(survey) != selected_contact:
            continue
        filtered.append(survey)
    return filtered


def build_survey_analytics(surveys):
    surveys = list(surveys)
    path_stats = {}
    for key, (field, label) in PATHS.items():
        counts = Counter(getattr(survey, field) for survey in surveys)
        path_stats[f"path_{key.replace('.', '_')}"] = {
            "label": label,
            "levels": [
                {"value": value, "label": interest_label, "count": counts.get(value, 0)}
                for value, interest_label in PATH_INTEREST_CHOICES
            ],
        }

    g03_stats = _counter_stats(
        (s.advanced_course_intent for s in surveys),
        StudentSurvey.AdvancedCourseIntent.choices,
    )
    cross_stats = {}
    need_observation = {}
    for key, (field, label) in PATHS.items():
        cross_stats[f"path_{key.replace('.', '_')}"] = {
            "label": label,
            "high": sum(getattr(s, field) == "very_interested" and s.advanced_course_intent == "HIGH" for s in surveys),
            "interested_high": sum(
                getattr(s, field) == "interested" and s.advanced_course_intent in {"HIGH", "INTERESTED"}
                for s in surveys
            ),
        }
        need_observation[f"path_{key.replace('.', '_')}"] = {
            "label": label,
            "high": sum(s.advanced_course_intent == "HIGH" and getattr(s, field) in {"very_interested", "interested"} for s in surveys),
            "potential": sum(
                s.advanced_course_intent in {"HIGH", "INTERESTED"}
                and getattr(s, field) in {"very_interested", "interested"}
                for s in surveys
            ),
            "contactable": sum(
                contact_status(s) == "contactable"
                and getattr(s, field) in {"very_interested", "interested"}
                for s in surveys
            ),
        }

    contact_counts = Counter(contact_status(survey) for survey in surveys)
    return {
        "path_stats": path_stats,
        "g03_stats": g03_stats,
        "cross_stats": cross_stats,
        "need_observation": need_observation,
        "interest_stats": _counter_stats(
            (value for survey in surveys for value in (survey.future_interests or [])),
            SURVEY_FUTURE_INTEREST_CHOICES,
            denominator=len(surveys),
        ),
        "license_stats": _counter_stats(
            (value for survey in surveys for value in (survey.license_interest or [])),
            SURVEY_LICENSE_CHOICES,
        ),
        "format_stats": _counter_stats(
            (value for survey in surveys for value in (survey.course_format_preferences or [])),
            SURVEY_FORMAT_CHOICES,
        ),
        "duration_stats": _counter_stats(
            (survey.course_duration_preference for survey in surveys),
            SURVEY_DURATION_CHOICES,
        ),
        "priority_stats": _counter_stats(
            (value for survey in surveys for value in (survey.course_priority_factors or [])),
            SURVEY_PRIORITY_CHOICES,
        ),
        "contact_counts": {
            "survey_only": contact_counts.get("survey_only", 0),
            "willing_no_email": contact_counts.get("willing_no_email", 0),
            "contactable": contact_counts.get("contactable", 0),
        },
    }
