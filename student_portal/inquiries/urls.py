from django.urls import path

from . import views

app_name = "inquiries"

urlpatterns = [
    # 放在 /api/public/ 底下，Live 服務才會把官網表單的 POST 轉給 Django
    path("api/public/course-inquiry/", views.submit_inquiry, name="submit"),
    path("teacher/course-inquiries/", views.teacher_inquiries, name="teacher_inquiries"),
]
