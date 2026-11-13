"""FDE-GCS 存取判定（P1）。

規則：
1. Feature Flag `FDE_GCS_ENABLED` 預設關閉；關閉時對所有人都視為不存在（404、無入口）。
2. 未登入 → 要求登入。
3. 教師（is_staff）→ 允許。
4. 學員 → 帳號需已啟用，且在 `FDE_GCS_COHORTS` 指定的期別中有有效選課，才允許。
   沒有指定任何期別時，學員一律不允許。

本模組只讀取既有的帳號、學員檔案與選課資料，不寫入資料庫、不新增資料表。
"""
from django.conf import settings

DISABLED = "DISABLED"
ANONYMOUS = "ANONYMOUS"
UNVERIFIED = "UNVERIFIED"
NOT_IN_COHORT = "NOT_IN_COHORT"
ALLOWED = "ALLOWED"


def gcs_enabled():
    return bool(getattr(settings, "FDE_GCS_ENABLED", False))


def enabled_cohorts():
    return frozenset(getattr(settings, "FDE_GCS_COHORTS", ()) or ())


def evaluate_access(request):
    if not gcs_enabled():
        return DISABLED
    user = getattr(request, "user", None)
    if user is None or not user.is_authenticated:
        return ANONYMOUS
    if user.is_staff:
        return ALLOWED
    profile = getattr(user, "student_profile", None)
    if profile is None or not profile.active:
        return UNVERIFIED
    cohorts = enabled_cohorts()
    if not cohorts:
        return NOT_IN_COHORT
    in_cohort = profile.enrollments.filter(
        active=True,
        cohort__active=True,
        cohort_id__in=cohorts,
    ).exists()
    return ALLOWED if in_cohort else NOT_IN_COHORT
