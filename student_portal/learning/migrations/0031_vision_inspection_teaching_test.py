from django.db import migrations, models


class Migration(migrations.Migration):
    """V1.0 教學測試版：保存模型發布階段與規則引擎候選結果（2026-11-03）。"""

    dependencies = [
        ("learning", "0030_golden_label_two_classes"),
    ]

    operations = [
        migrations.AddField(
            model_name="visioninspectionrecord",
            name="release_stage",
            field=models.CharField(blank=True, max_length=16),
        ),
        migrations.AddField(
            model_name="visioninspectionrecord",
            name="rule_evaluation",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
