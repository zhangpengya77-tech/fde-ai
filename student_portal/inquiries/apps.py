from django.apps import AppConfig


class InquiriesConfig(AppConfig):
    """2026-11-18：課程諮詢（官網「課程專區」的諮詢表單）。
    資料存在獨立資料庫（DATABASES['inquiries']），不寫入學員系統的 default 資料庫。"""

    default_auto_field = "django.db.models.BigAutoField"
    name = "inquiries"
    verbose_name = "課程諮詢"
