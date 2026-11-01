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
    # Gateway 使用既有 Django Session／CSRF 驗證 Live API 請求。
    path("api/live/auth/session/", views.live_session_auth, name="live_session_auth"),
    # 僅供 Gateway 內部鏈路取得短效、已簽章 Assertion。
    path("api/live/auth/assertion/", views.live_identity_assertion, name="live_identity_assertion"),
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
    path("student/learning-path/", views.student_learning_path_entry, name="student_learning_path_entry"),
    path("student/growth/", views.student_growth_entry, name="student_growth_entry"),
    path("courses/join/", views.join_cohort, name="join_cohort"),
    path("student/courses/<int:enrollment_id>/", views.student_course_dashboard, name="student_course_dashboard"),
    path("student/courses/<int:enrollment_id>/project-direction/", views.select_project_direction, name="select_project_direction"),
    path("student/courses/<int:enrollment_id>/growth/", views.student_growth_dashboard, name="student_growth_dashboard"),
    path("student/courses/<int:enrollment_id>/growth/R07/model/", views.growth_model_upload, name="growth_model_upload"),
    path(
        "student/courses/<int:enrollment_id>/growth/seed/download/",
        views.student_seed_download,
        name="student_seed_download",
    ),
    path("student/courses/<int:enrollment_id>/prop-scan/", views.student_prop_scan, name="student_prop_scan"),
    path("student/rotation-v5/", views.student_rotation_v5_entry, name="student_rotation_v5_entry"),
    path("student/courses/<int:enrollment_id>/rotation-v5/", views.student_rotation_v5_scan, name="student_rotation_v5_scan"),
    path("evidence/vision-inspections/<uuid:record_id>/image/", views.vision_inspection_image, name="vision_inspection_image"),
    # POWER_INSPECTION_V1：獨立 MP4 巡檢任務，不影響既有 R07／V5。
    path("student/power-inspection/", views.student_power_inspection_entry, name="power_inspection_entry"),
    path("student/power-inspection/upload/", views.student_power_inspection_api_upload, name="power_inspection_api_upload"),
    path("student/courses/<int:enrollment_id>/power-inspection/", views.student_power_inspection_task, name="power_inspection_task"),
    path("student/courses/<int:enrollment_id>/power-inspection/upload/", views.student_power_inspection_upload, name="power_inspection_upload"),
    path("student/power-inspection/jobs/<uuid:job_id>/", views.student_power_inspection_job, name="power_inspection_student_job"),
    path("student/courses/<int:enrollment_id>/learning-path/", views.student_learning_path, name="student_learning_path"),
    path("student/courses/<int:enrollment_id>/growth/<str:slot_id>/", views.growth_record_detail, name="growth_record_detail"),
    path("student/courses/<int:enrollment_id>/growth/R08/survey/", views.student_survey, name="student_survey"),
    path("student/courses/<int:enrollment_id>/growth/R08/survey/result/", views.student_survey_result, name="student_survey_result"),
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
    # P3 班級學習成果總覽（2026-10-13 教師指令）：重用 P1 五階段與 P2 成長證據鏈資料。
    path("teacher/class-outcomes/", views.teacher_class_outcomes, name="teacher_class_outcomes"),
    # P5-B／P5-C 班級結訓成果報告（2026-10-13 教師指令）：只讀彙整，支援瀏覽器原生列印。
    path("teacher/class-report/", views.teacher_class_report, name="teacher_class_report"),
    path(
        "teacher/class-report/<str:cohort_id>/",
        views.teacher_class_report,
        name="teacher_class_report_cohort",
    ),
    # P6-A 結訓審核清單（2026-10-13 教師指令）：只讀，待處理項目指向既有教師審核頁。
    path(
        "teacher/review-checklist/",
        views.teacher_cohort_review_checklist,
        name="teacher_cohort_review_checklist",
    ),
    path(
        "teacher/review-checklist/<str:cohort_id>/",
        views.teacher_cohort_review_checklist,
        name="teacher_cohort_review_checklist_cohort",
    ),
    # P6-B 班級成果 CSV 匯出（2026-10-13 教師指令）：與 P5 報告同一統計來源。
    path(
        "teacher/class-report/export/summary/",
        views.teacher_cohort_export_summary,
        name="teacher_cohort_export_summary",
    ),
    path(
        "teacher/class-report/export/summary/<str:cohort_id>/",
        views.teacher_cohort_export_summary,
        name="teacher_cohort_export_summary_cohort",
    ),
    path(
        "teacher/class-report/export/records/",
        views.teacher_cohort_export_records,
        name="teacher_cohort_export_records",
    ),
    path(
        "teacher/class-report/export/records/<str:cohort_id>/",
        views.teacher_cohort_export_records,
        name="teacher_cohort_export_records_cohort",
    ),
    # P7-A／P7-B 班級成果展示與簡報播放模式（2026-10-13 教師指令）：
    # 沿用 build_cohort_report() 統計，預設匿名化，教師須顯式聲明授權才具名。
    path(
        "teacher/class-showcase/",
        views.teacher_class_showcase,
        name="teacher_class_showcase",
    ),
    path(
        "teacher/class-showcase/<str:cohort_id>/",
        views.teacher_class_showcase,
        name="teacher_class_showcase_cohort",
    ),
    # --- AI 視覺模型中心（2026-10-10 指令 P）：單一教師入口、四個區域 ---
    path("teacher/vision-center/", views.teacher_vision_center, name="teacher_vision_center"),
    path("teacher/vision-center/rotation-v5/", views.teacher_rotation_v5_trial, name="teacher_rotation_v5_trial"),
    path("teacher/vision-inspections/", views.teacher_vision_inspections, name="teacher_vision_inspections"),
    path("teacher/vision-inspections/<uuid:record_id>/", views.teacher_vision_inspection_detail, name="teacher_vision_inspection_detail"),
    # POWER_INSPECTION_V1：教師端模型匯入／試用／部署／停用／回退與工作覆核。
    path("teacher/power-inspection/", views.teacher_power_inspection, name="power_inspection_teacher"),
    path("teacher/power-inspection/models/import/", views.teacher_power_inspection_model_import, name="power_inspection_model_import"),
    path("teacher/power-inspection/models/<uuid:model_id>/trial/", views.teacher_power_inspection_trial, name="power_inspection_trial"),
    path("teacher/power-inspection/models/<uuid:model_id>/deploy/", views.teacher_power_inspection_deploy, name="power_inspection_deploy"),
    path("teacher/power-inspection/deployments/<int:deployment_id>/disable/", views.teacher_power_inspection_deployment_disable, name="power_inspection_deployment_disable"),
    path("teacher/power-inspection/deployments/<int:deployment_id>/rollback/<int:event_id>/", views.teacher_power_inspection_deployment_rollback, name="power_inspection_deployment_rollback"),
    path("teacher/power-inspection/jobs/<uuid:job_id>/", views.teacher_power_inspection_job, name="power_inspection_teacher_job"),
    path("teacher/power-inspection/jobs/<uuid:job_id>/review/", views.teacher_power_inspection_review, name="power_inspection_review"),
    path("teacher/power-inspection/jobs/<uuid:job_id>/retry/", views.teacher_power_inspection_retry, name="power_inspection_retry"),
    path(
        "teacher/vision-center/validate/",
        views.teacher_vision_center_validate,
        name="teacher_vision_center_validate",
    ),
    path(
        "teacher/vision-center/validate-submission/",
        views.teacher_vision_center_validate_submission,
        name="teacher_vision_center_validate_submission",
    ),
    path(
        "teacher/vision-center/import/",
        views.teacher_vision_center_import,
        name="teacher_vision_center_import",
    ),
    path(
        "teacher/vision-center/import/apply-mapping/",
        views.teacher_vision_center_apply_mapping,
        name="teacher_vision_center_apply_mapping",
    ),
    path(
        "teacher/vision-center/activate/",
        views.teacher_vision_center_activate,
        name="teacher_vision_center_activate",
    ),
    path(
        "teacher/vision-center/rollback/",
        views.teacher_vision_center_rollback,
        name="teacher_vision_center_rollback",
    ),
    path(
        "teacher/vision-center/delete-submission/",
        views.teacher_vision_center_delete_submission,
        name="teacher_vision_center_delete_submission",
    ),
    # --- 模型管理（M1/M2/M3，2026-10-21）：歸檔／還原／永久刪除 ---
    path(
        "teacher/vision-center/models/archive/",
        views.teacher_vision_center_archive_model,
        name="teacher_vision_center_archive_model",
    ),
    path(
        "teacher/vision-center/models/restore/",
        views.teacher_vision_center_restore_model,
        name="teacher_vision_center_restore_model",
    ),
    path(
        "teacher/vision-center/models/delete/",
        views.teacher_vision_center_delete_model,
        name="teacher_vision_center_delete_model",
    ),
    path(
        "teacher/vision-center/upload/",
        views.teacher_vision_center_upload,
        name="teacher_vision_center_upload",
    ),
    path(
        "teacher/vision-center/seed/",
        views.teacher_vision_center_seed,
        name="teacher_vision_center_seed",
    ),
    path(
        "teacher/vision-center/unseed/",
        views.teacher_vision_center_unseed,
        name="teacher_vision_center_unseed",
    ),
    path("teacher/vision-models/", views.teacher_vision_model_list, name="teacher_vision_model_list"),
    path("teacher/vision-models/<uuid:evidence_id>/", views.teacher_vision_model_detail, name="teacher_vision_model_detail"),
    path("teacher/vision-models/<uuid:evidence_id>/review/", views.teacher_vision_model_review, name="teacher_vision_model_review"),
    path("teacher/vision-models/<uuid:evidence_id>/catalogue/", views.teacher_vision_model_catalogue, name="teacher_vision_model_catalogue"),
    path("teacher/vision-models/<uuid:evidence_id>/verify/", views.teacher_vision_model_verify, name="teacher_vision_model_verify"),
    path("teacher/vision-models/<uuid:evidence_id>/verify/run/", views.teacher_vision_model_verify_run, name="teacher_vision_model_verify_run"),
    path("teacher/vision-flywheel/", views.teacher_vision_flywheel, name="teacher_vision_flywheel"),
    path(
        "teacher/vision-repository/<uuid:model_id>/integrity-check/",
        views.teacher_vision_model_integrity_check,
        name="teacher_vision_model_integrity_check",
    ),
    path(
        "teacher/vision-repository/integrity-check/",
        views.teacher_vision_integrity_check_all,
        name="teacher_vision_integrity_check_all",
    ),
    # --- Golden Test Center（2026-10-09 第 23 輪指令「二、三」）---
    path("teacher/golden-sets/", views.teacher_golden_set_list, name="teacher_golden_set_list"),
    path("teacher/golden-sets/create/", views.teacher_golden_set_create, name="teacher_golden_set_create"),
    path("teacher/golden-sets/<str:golden_set_id>/", views.teacher_golden_set_detail, name="teacher_golden_set_detail"),
    path(
        "teacher/golden-sets/<str:golden_set_id>/samples/",
        views.teacher_golden_set_add_sample,
        name="teacher_golden_set_add_sample",
    ),
    path(
        "teacher/golden-sets/<str:golden_set_id>/samples/<uuid:sample_id>/confirm/",
        views.teacher_golden_sample_confirm,
        name="teacher_golden_sample_confirm",
    ),
    path(
        "teacher/golden-sets/<str:golden_set_id>/freeze/",
        views.teacher_golden_set_freeze,
        name="teacher_golden_set_freeze",
    ),
    path(
        "teacher/vision-repository/<uuid:model_id>/golden-test/",
        views.teacher_golden_test_page,
        name="teacher_golden_test_page",
    ),
    path("teacher/surveys/", views.teacher_survey_dashboard, name="teacher_survey_dashboard"),
    path("teacher/surveys/<int:enrollment_id>/", views.teacher_survey_detail, name="teacher_survey_detail"),
    path("teacher/enrollments/<int:enrollment_id>/", views.teacher_student_detail, name="teacher_student_detail"),
    path("teacher/enrollments/<int:enrollment_id>/project-direction/", views.teacher_update_project_direction, name="teacher_update_project_direction"),
    path("teacher/enrollments/<int:enrollment_id>/verify/", views.teacher_toggle_verified, name="teacher_toggle_verified"),
    path("teacher/enrollments/<int:enrollment_id>/identity/", views.teacher_save_identity, name="teacher_save_identity"),
    path("teacher/growth-reviews/<int:submission_id>/", views.review_growth_record, name="growth_review"),
    path("teacher/reviews/<int:progress_id>/", views.review_task, name="review_task"),
    path("teacher/evidence/<uuid:evidence_id>/candidate/", views.promote_candidate, name="promote_candidate"),
    path("teacher/evidence/<uuid:evidence_id>/delete/", views.teacher_delete_image_evidence, name="teacher_delete_image_evidence"),
]
