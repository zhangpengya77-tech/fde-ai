from django.urls import path

from . import api, views

app_name = "gcs_portal"

urlpatterns = [
    path("", views.gcs_home, name="home"),
    path("api/allowlist/", api.allowlist_view, name="api_allowlist"),
    path("api/param-requests/", api.param_requests, name="api_param_requests"),
    path("api/param-requests/<int:pk>/decision/", api.decide, name="api_decide"),
    path("api/param-requests/<int:pk>/result/", api.report_result, name="api_result"),
    path("api/param-requests/<int:pk>/cancel/", api.cancel, name="api_cancel"),
]
