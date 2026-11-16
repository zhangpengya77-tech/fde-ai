"""課程諮詢資料（獨立資料庫）。只收回覆諮詢必要的欄位；保存 180 天後自動刪除。"""
from django.db import models


class CourseInquiry(models.Model):
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    name = models.CharField("稱呼", max_length=30)
    contact = models.CharField("聯絡方式", max_length=80)
    course = models.CharField("課程代號", max_length=20, db_index=True)
    course_title = models.CharField("課程名稱", max_length=60)
    class_format = models.CharField("班別", max_length=20, blank=True)
    message = models.TextField("想問的問題", max_length=500, blank=True)
    consent_at = models.DateTimeField("同意個資告知時間")
    source = models.CharField("來源網站", max_length=120, blank=True)
    ip_hash = models.CharField("來源雜湊（限流用，不存原始 IP）", max_length=64, db_index=True)
    is_read = models.BooleanField("已讀", default=False, db_index=True)
    read_at = models.DateTimeField(null=True, blank=True)
    read_by = models.CharField(max_length=150, blank=True)
    email_sent = models.BooleanField("已寄通知信", default=False)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "課程諮詢"
        verbose_name_plural = "課程諮詢"

    def __str__(self):
        return f"{self.created_at:%Y-%m-%d %H:%M} {self.name}（{self.course_title}）"
