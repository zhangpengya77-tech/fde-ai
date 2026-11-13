from django.urls import path

from . import views

app_name = "gcs_portal"

urlpatterns = [
    path("", views.gcs_home, name="home"),
]
