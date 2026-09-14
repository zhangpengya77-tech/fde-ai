import secrets

import django.db.models.deletion
from django.db import migrations, models
from django.utils import timezone


PUBLIC_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def migrate_legacy_profiles(apps, schema_editor):
    StudentProfile = apps.get_model("learning", "StudentProfile")
    Enrollment = apps.get_model("learning", "Enrollment")
    StudentTaskProgress = apps.get_model("learning", "StudentTaskProgress")
    PhaseProgress = apps.get_model("learning", "PhaseProgress")
    database = schema_editor.connection.alias

    for profile in StudentProfile.objects.using(database).all().iterator():
        if not profile.public_user_id:
            while True:
                year = timezone.now().year % 100
                suffix = "".join(secrets.choice(PUBLIC_ID_ALPHABET) for _ in range(6))
                public_id = f"FDE-{year:02d}-{suffix}"
                if not StudentProfile.objects.using(database).filter(public_user_id=public_id).exists():
                    profile.public_user_id = public_id
                    break
        if not profile.email and profile.user_id:
            user = profile.user
            profile.email = (user.email or "").strip().lower() or None
        profile.save(using=database, update_fields=["public_user_id", "email"])

        if profile.cohort_id:
            enrollment, _ = Enrollment.objects.using(database).get_or_create(
                student_id=profile.student_id,
                cohort_id=profile.cohort_id,
            )
            StudentTaskProgress.objects.using(database).filter(student_id=profile.student_id).update(
                enrollment_id=enrollment.pk
            )
            PhaseProgress.objects.using(database).filter(student_id=profile.student_id).update(
                enrollment_id=enrollment.pk
            )


class Migration(migrations.Migration):

    dependencies = [
        ("learning", "0004_student_registered_email"),
    ]

    operations = [
        migrations.CreateModel(
            name="ClassCode",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("code", models.CharField(max_length=24, unique=True)),
                ("active", models.BooleanField(default=True)),
                ("expires_at", models.DateTimeField(blank=True, null=True)),
                ("max_uses", models.PositiveIntegerField(blank=True, null=True)),
                ("use_count", models.PositiveIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={"ordering": ["cohort_id", "code"]},
        ),
        migrations.CreateModel(
            name="Enrollment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("joined_at", models.DateTimeField(auto_now_add=True)),
                ("active", models.BooleanField(default=True)),
            ],
            options={"ordering": ["-joined_at"]},
        ),
        migrations.RenameField(
            model_name="studentprofile",
            old_name="display_name",
            new_name="nickname",
        ),
        migrations.RenameField(
            model_name="studentprofile",
            old_name="registered_email",
            new_name="email",
        ),
        migrations.AlterModelOptions(
            name="studentprofile",
            options={"ordering": ["public_user_id"]},
        ),
        migrations.RemoveConstraint(
            model_name="phaseprogress",
            name="one_phase_per_student",
        ),
        migrations.RemoveConstraint(
            model_name="studenttaskprogress",
            name="one_progress_per_student_task",
        ),
        migrations.AddField(
            model_name="studentprofile",
            name="account_type",
            field=models.CharField(choices=[("free", "免費"), ("student", "學員"), ("pro", "Pro")], default="free", max_length=12),
        ),
        migrations.AddField(
            model_name="studentprofile",
            name="public_user_id",
            field=models.CharField(blank=True, editable=False, max_length=13, null=True, unique=True),
        ),
        migrations.AlterField(
            model_name="studentprofile",
            name="student_id",
            field=models.CharField(editable=False, max_length=32, primary_key=True, serialize=False),
        ),
        migrations.AddField(
            model_name="classcode",
            name="cohort",
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="class_codes", to="learning.cohort"),
        ),
        migrations.AddField(
            model_name="enrollment",
            name="cohort",
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="enrollments", to="learning.cohort"),
        ),
        migrations.AddField(
            model_name="enrollment",
            name="student",
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="enrollments", to="learning.studentprofile"),
        ),
        migrations.AddField(
            model_name="phaseprogress",
            name="enrollment",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="phase_progress", to="learning.enrollment"),
        ),
        migrations.AddField(
            model_name="studenttaskprogress",
            name="enrollment",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="task_progress", to="learning.enrollment"),
        ),
        migrations.RunPython(migrate_legacy_profiles, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="studentprofile",
            name="nickname",
            field=models.CharField(max_length=40),
        ),
        migrations.AlterField(
            model_name="studentprofile",
            name="public_user_id",
            field=models.CharField(editable=False, max_length=13, unique=True),
        ),
        migrations.AlterField(
            model_name="phaseprogress",
            name="enrollment",
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="phase_progress", to="learning.enrollment"),
        ),
        migrations.AlterField(
            model_name="studenttaskprogress",
            name="enrollment",
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="task_progress", to="learning.enrollment"),
        ),
        migrations.AddConstraint(
            model_name="phaseprogress",
            constraint=models.UniqueConstraint(fields=("enrollment", "phase"), name="one_phase_per_enrollment"),
        ),
        migrations.AddConstraint(
            model_name="studenttaskprogress",
            constraint=models.UniqueConstraint(fields=("enrollment", "task"), name="one_progress_per_enrollment_task"),
        ),
        migrations.AddConstraint(
            model_name="enrollment",
            constraint=models.UniqueConstraint(fields=("student", "cohort"), name="one_enrollment_per_cohort"),
        ),
        migrations.RemoveField(model_name="phaseprogress", name="student"),
        migrations.RemoveField(model_name="studentprofile", name="cohort"),
        migrations.RemoveField(model_name="studentprofile", name="expected_email"),
        migrations.RemoveField(model_name="studentprofile", name="legal_name"),
        migrations.RemoveField(model_name="studenttaskprogress", name="student"),
    ]
