#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""修正 DEMO 帳號（正確版）：把「被改壞」的既有帳號與 profile 一起還原為種子值，
保留原有 user↔profile↔enrollment↔成長紀錄 關聯，避免新建帳號導致紀錄遺失。

只寫入隔離 DEMO DB，絕不碰正式 DB。
"""
import os
import sys

import demo_credentials

DEMO_ROOT = r"D:\FDE-AI-UAS-v2.0\demo"
DB = os.path.join(DEMO_ROOT, "runtime", "db", "demo.sqlite3")
SP = r"D:\FDE-AI-UAS-v2.0\student_portal"

if not DB.replace("\\", "/").lower().startswith(DEMO_ROOT.replace("\\", "/").lower()):
    raise SystemExit(f"ABORT：DB 路徑不在 demo/ 之下：{DB}")

os.environ["DJANGO_DB_NAME"] = DB
os.environ["DJANGO_MEDIA_ROOT"] = os.path.join(DEMO_ROOT, "runtime", "media")
os.environ["DJANGO_DEBUG"] = "true"
os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings"
os.environ["PYTHONNOUSERSITE"] = "1"
sys.path.insert(0, SP)

import django
django.setup()

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from learning.models import StudentProfile

actual = str(settings.DATABASES["default"]["NAME"]).replace("\\", "/")
assert actual.lower() == DB.replace("\\", "/").lower(), f"實際 DB 不符：{actual}"
print(f"[OK] 目標 DB 確認：{actual}")

USER = get_user_model()

STUDENT_EMAIL = "demo.student01@fde-demo.local"
STUDENT_PASSWORD = demo_credentials.student_password()
TEACHER_EMAIL = "demo.teacher@fde-demo.local"
TEACHER_PASSWORD = demo_credentials.teacher_password()

with transaction.atomic():
    # 0) 清掉前一次誤建的多餘學員帳號（無 profile 關聯者）
    stray = USER.objects.filter(username=STUDENT_EMAIL)
    for u in stray:
        has_profile = StudentProfile.objects.filter(user=u).exists()
        if not has_profile:
            print(f"[清理] 刪除無 profile 的多餘帳號 id={u.id} username={u.username!r}")
            u.delete()

    # 1) 還原學員：(依 profile.email 反推) profile.email 目前為被改壞的值
    profile = StudentProfile.objects.filter(public_user_id="DEMO-STU-0001").first()
    if profile is None:
        profile = StudentProfile.objects.first()
    assert profile is not None, "找不到 DEMO 學員 profile"

    stu_user = profile.user
    old = (stu_user.username, stu_user.email, profile.email)
    stu_user.username = STUDENT_EMAIL
    stu_user.email = STUDENT_EMAIL
    stu_user.is_active = True
    stu_user.is_staff = False
    stu_user.set_password(STUDENT_PASSWORD)   # 正規雜湊
    sut = stu_user.save()
    profile.email = STUDENT_EMAIL
    profile.active = True
    profile.user = stu_user
    profile.save()
    print(f"[還原學員] user id={stu_user.id} username {old[0]!r}->{STUDENT_EMAIL!r}, "
          f"profile.email {old[2]!r}->{STUDENT_EMAIL!r}")

    # 2) 還原教師
    tea_user = USER.objects.filter(is_staff=True).exclude(pk=stu_user.pk).first()
    assert tea_user is not None, "找不到 DEMO 教師帳號"
    old_t = (tea_user.username, tea_user.email)
    tea_user.username = TEACHER_EMAIL
    tea_user.email = TEACHER_EMAIL
    tea_user.is_active = True
    tea_user.is_staff = True
    tea_user.set_password(TEACHER_PASSWORD)
    tea_user.save()
    print(f"[還原教師] user id={tea_user.id} username {old_t[0]!r}->{TEACHER_EMAIL!r}")

# 3) 驗證
print("\n=== 驗證 ===")
from django.contrib.auth import authenticate

for email, pwd, tag in [
    (STUDENT_EMAIL, STUDENT_PASSWORD, "STUDENT"),
    (TEACHER_EMAIL, TEACHER_PASSWORD, "TEACHER"),
]:
    u = USER.objects.filter(username=email).first()
    auth = authenticate(username=email, password=pwd)
    print(f"[{tag}] exists={bool(u)} active={u.is_active if u else '-'} "
          f"staff={u.is_staff if u else '-'} authenticate={'OK' if auth else 'FAIL'}")

p = StudentProfile.objects.first()
print(f"[PROFILE] email={p.email!r} user={p.user.username!r} active={p.active}")
print("User 總數：", USER.objects.count(), "（應為 2）")
print("Profile 總數：", StudentProfile.objects.count(), "（應為 1）")
print("成長紀錄數：", __import__("learning.models", fromlist=["GrowthRecordSubmission"]).GrowthRecordSubmission.objects.count())
