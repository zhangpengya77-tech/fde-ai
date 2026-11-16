"""教師後台用：未讀課程諮詢數（顯示在教師總覽的通知）。
諮詢資料庫還沒建立、無法連線，或在不允許查詢它的環境（例如其他功能的測試）時一律回 0，教師總覽絕不因此壞掉。"""
from django import template

from ..models import CourseInquiry

register = template.Library()


@register.simple_tag
def course_inquiry_unread():
    try:
        return CourseInquiry.objects.filter(is_read=False).count()
    except Exception:  # noqa: BLE001 — 通知只是輔助，任何錯誤都不影響教師總覽
        return 0
