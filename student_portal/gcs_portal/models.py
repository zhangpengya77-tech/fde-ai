from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone

APPROVAL_TTL = timedelta(minutes=10)


class ParamWriteRequest(models.Model):
    """真機參數寫入申請：每一筆都要教師批准，批准後 10 分鐘內只能使用一次。

    這張表同時是寫入日誌：申請、批准／退回、寫入結果與讀回值都記錄在同一筆。
    """

    class Status(models.TextChoices):
        PENDING = "PENDING", "待教師批准"
        APPROVED = "APPROVED", "已批准，可寫入"
        REJECTED = "REJECTED", "教師退回"
        CANCELLED = "CANCELLED", "已取消"
        EXPIRED = "EXPIRED", "批准已過期"
        APPLIED = "APPLIED", "已寫入並讀回確認"
        FAILED = "FAILED", "寫入失敗"

    requester = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="gcs_param_requests")
    student = models.ForeignKey(
        "learning.StudentProfile", null=True, blank=True, on_delete=models.PROTECT, related_name="gcs_param_requests"
    )
    cohort = models.ForeignKey(
        "learning.Cohort", null=True, blank=True, on_delete=models.PROTECT, related_name="gcs_param_requests"
    )
    param_name = models.CharField(max_length=16)
    allowlist_version = models.CharField(max_length=40)
    vehicle_sysid = models.PositiveSmallIntegerField()
    firmware = models.CharField(max_length=40, blank=True)
    old_value = models.FloatField()
    new_value = models.FloatField()
    safety_ack = models.BooleanField(default=False)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="gcs_param_decisions"
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.CharField(max_length=200, blank=True)
    approval_expires_at = models.DateTimeField(null=True, blank=True)
    result_value = models.FloatField(null=True, blank=True)
    result_message = models.CharField(max_length=200, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def expire_if_needed(self, now=None):
        now = now or timezone.now()
        if self.status == self.Status.APPROVED and self.approval_expires_at and now > self.approval_expires_at:
            self.status = self.Status.EXPIRED
            self.save(update_fields=["status"])
        return self.status

    def to_dict(self):
        return {
            "id": self.pk,
            "param_name": self.param_name,
            "old_value": self.old_value,
            "new_value": self.new_value,
            "vehicle_sysid": self.vehicle_sysid,
            "firmware": self.firmware,
            "status": self.status,
            "status_label": self.get_status_display(),
            "requester": self.student.public_user_id if self.student_id else "教師",
            "cohort": self.cohort_id or "",
            "safety_ack": self.safety_ack,
            "created_at": self.created_at.isoformat(),
            "decision_note": self.decision_note,
            "approval_expires_at": self.approval_expires_at.isoformat() if self.approval_expires_at else None,
            "result_value": self.result_value,
            "result_message": self.result_message,
            "allowlist_version": self.allowlist_version,
        }
