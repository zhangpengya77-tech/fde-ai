"""在既有導覽列提供 FDE-GCS 入口；只有通過存取判定時才輸出網址。"""
from django.urls import reverse

from .access import ALLOWED, evaluate_access


def gcs_entry(request):
    if evaluate_access(request) != ALLOWED:
        return {"fde_gcs_url": ""}
    return {"fde_gcs_url": reverse("gcs_portal:home")}
