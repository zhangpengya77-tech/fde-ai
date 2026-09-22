from django.urls import path

from . import views
from . import public_ai

app_name = "learning"

urlpatterns = [
    path("", views.home, name="home"),
    path("platform/", views.platform_entry, name="platform"),
    path("platform/<path:asset_path>", views.platform_asset, name="platform_asset"),
    path("api/public/rag/ask/", public_ai.public_rag_ask, name="public_rag_ask"),
    path("api/public/inspection/detect/", public_ai.public_inspection_detect, name="public_inspection_detect"),
    path("api/public/inspection/hover/", public_ai.public_inspection_hover, name="public_inspection_hover"),
    path("api/public/voice/ask/", public_ai.public_voice_ask, name="public_voice_ask"),
    path("register/", views.register, name="register"),
    path("activate/<str:public_user_id>/", views.activate, name="activate"),
    path("activate/<str:public_user_id>/resend/", views.resend_activation, name="resend_activation"),
    path("login/", views.StudentLoginView.as_view(), name="student_login"),
    path("login/resend-verification/", views.resend_activation_by_email, name="resend_activation_by_email"),
    path("teacher/login/", views.TeacherLoginView.as_view(), name="teacher_login"),
    path("logout/", views.LogoutView.as_view(next_page="learning:home"), name="logout"),
    path("password-reset/", views.StudentPasswordResetView.as_view(), name="password_reset"),
    path("password-reset/done/", views.StudentPasswordResetDoneView.as_view(), name="password_reset_done"),
    path("reset/<uidb64>/<token>/", views.StudentPasswordResetConfirmView.as_view(), name="password_reset_confirm"),
    path("reset/done/", views.StudentPasswordResetCompleteView.as_view(), name="password_reset_complete"),
    path("student/", views.student_dashboard, name="student_dashboard"),
    path("student/growth/", views.student_growth_entry, name="student_growth_entry"),
    path("courses/join/", views.join_cohort, name="join_cohort"),
    path("student/courses/<int:enrollment_id>/", views.student_course_dashboard, name="student_course_dashboard"),
    path("student/courses/<int:enrollment_id>/project-direction/", views.select_project_direction, name="select_project_direction"),
    path("student/courses/<int:enrollment_id>/growth/", views.student_growth_dashboard, name="student_growth_dashboard"),
    path("student/courses/<int:enrollment_id>/growth/<str:slot_id>/", views.growth_record_detail, name="growth_record_detail"),
    path("student/courses/<int:enrollment_id>/growth/R08/survey/", views.student_survey, name="student_survey"),
    path(
        "student/courses/<int:enrollment_id>/growth/<str:slot_id>/evidence/<uuid:evidence_id>/delete/",
        views.growth_evidence_delete,
        name="growth_evidence_delete",
    ),
    path("student/courses/<int:enrollment_id>/tasks/<str:task_id>/", views.task_detail, name="task_detail"),
    path("student/courses/<int:enrollment_id>/tasks/<str:task_id>/evidence/", views.evidence_add, name="evidence_add"),
    path("evidence/<uuid:evidence_id>/download/", views.evidence_download, name="evidence_download"),
    path("student/courses/<int:enrollment_id>/phases/<str:phase>/", views.update_phase, name="update_phase"),
    path("teacher/", views.teacher_dashboard, name="teacher_dashboard"),
    path("teacher/enrollments/<int:enrollment_id>/", views.teacher_student_detail, name="teacher_student_detail"),
    path("teacher/enrollments/<int:enrollment_id>/project-direction/", views.teacher_update_project_direction, name="teacher_update_project_direction"),
    path("teacher/enrollments/<int:enrollment_id>/verify/", views.teacher_toggle_verified, name="teacher_toggle_verified"),
    path("teacher/enrollments/<int:enrollment_id>/identity/", views.teacher_save_identity, name="teacher_save_identity"),
    path("teacher/growth-reviews/<int:submission_id>/", views.review_growth_record, name="growth_review"),
    path("teacher/reviews/<int:progress_id>/", views.review_task, name="review_task"),
    path("teacher/evidence/<uuid:evidence_id>/candidate/", views.promote_candidate, name="promote_candidate"),
]
