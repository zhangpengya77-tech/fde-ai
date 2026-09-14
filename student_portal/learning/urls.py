from django.urls import path

from . import views

app_name = "learning"

urlpatterns = [
    path("", views.home, name="home"),
    path("register/", views.register, name="register"),
    path("activate/<str:student_id>/", views.activate, name="activate"),
    path("activate/<str:student_id>/resend/", views.resend_activation, name="resend_activation"),
    path("login/", views.StudentLoginView.as_view(), name="student_login"),
    path("teacher/login/", views.TeacherLoginView.as_view(), name="teacher_login"),
    path("logout/", views.LogoutView.as_view(next_page="learning:home"), name="logout"),
    path("password-reset/", views.StudentPasswordResetView.as_view(), name="password_reset"),
    path("password-reset/done/", views.StudentPasswordResetDoneView.as_view(), name="password_reset_done"),
    path("reset/<uidb64>/<token>/", views.StudentPasswordResetConfirmView.as_view(), name="password_reset_confirm"),
    path("reset/done/", views.StudentPasswordResetCompleteView.as_view(), name="password_reset_complete"),
    path("student/", views.student_dashboard, name="student_dashboard"),
    path("tasks/<str:task_id>/", views.task_detail, name="task_detail"),
    path("tasks/<str:task_id>/evidence/", views.evidence_add, name="evidence_add"),
    path("evidence/<uuid:evidence_id>/download/", views.evidence_download, name="evidence_download"),
    path("student/phases/<str:phase>/", views.update_phase, name="update_phase"),
    path("teacher/", views.teacher_dashboard, name="teacher_dashboard"),
    path("teacher/students/<str:student_id>/", views.teacher_student_detail, name="teacher_student_detail"),
    path("teacher/reviews/<int:progress_id>/", views.review_task, name="review_task"),
    path("teacher/evidence/<uuid:evidence_id>/candidate/", views.promote_candidate, name="promote_candidate"),
]
