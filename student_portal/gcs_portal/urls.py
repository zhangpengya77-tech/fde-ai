from django.urls import path

from . import api, results_api, sitl_api, views

app_name = "gcs_portal"

urlpatterns = [
    path("", views.gcs_home, name="home"),
    path("api/allowlist/", api.allowlist_view, name="api_allowlist"),
    path("api/param-requests/", api.param_requests, name="api_param_requests"),
    path("api/param-requests/<int:pk>/decision/", api.decide, name="api_decide"),
    path("api/param-requests/<int:pk>/result/", api.report_result, name="api_result"),
    path("api/param-requests/<int:pk>/cancel/", api.cancel, name="api_cancel"),
    path("api/param-requests/<int:pk>/review/", results_api.review_write, name="api_review_write"),
    path("api/backups/", results_api.backups, name="api_backups"),
    path("api/backups/<int:pk>/diff/", results_api.backup_diff, name="api_backup_diff"),
    path("api/backups/<int:pk>/review/", results_api.review_backup, name="api_review_backup"),
    path("api/summary/", results_api.summary, name="api_summary"),
    path("api/export.csv", results_api.export_csv, name="api_export"),
    path("api/sitl/ticket/", sitl_api.ticket, name="api_sitl_ticket"),
    path("api/sitl/revoke/", sitl_api.revoke, name="api_sitl_revoke"),
]
