from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    """模擬器練飛紀錄（2026-11-07）：網頁模擬器練習成績自動存入學員成長日誌。"""

    dependencies = [
        ("learning", "0031_vision_inspection_teaching_test"),
    ]

    operations = [
        migrations.CreateModel(
            name="SimPracticeRecord",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("mode", models.CharField(choices=[("inspection", "電力巡檢"), ("exam", "考場模擬")], max_length=16)),
                ("title", models.CharField(max_length=120)),
                ("score", models.PositiveSmallIntegerField(blank=True, null=True)),
                ("grade", models.CharField(blank=True, max_length=8)),
                ("passed", models.BooleanField(blank=True, null=True)),
                ("duration_seconds", models.PositiveIntegerField(default=0)),
                ("input_source", models.CharField(blank=True, max_length=40)),
                ("summary", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("cohort", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="sim_practice_records", to="learning.cohort")),
                ("student", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="sim_practice_records", to="learning.studentprofile")),
            ],
            options={
                "ordering": ["-created_at", "-id"],
                "indexes": [
                    models.Index(fields=["student", "-created_at"], name="sim_practice_student_idx"),
                    models.Index(fields=["cohort", "-created_at"], name="sim_practice_cohort_idx"),
                ],
            },
        ),
    ]
