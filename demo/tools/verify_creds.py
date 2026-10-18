#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""只讀檢查：用 Django 驗證 DEMO 帳號密碼是否與種子一致（不修改任何資料）。"""
import os
import sys

DEMO_ROOT = r"D:\FDE-AI-UAS-v2.0\demo"
DB = os.path.join(DEMO_ROOT, "runtime", "db", "demo.sqlite3")
SP = r"D:\FDE-AI-UAS-v2.0\student_portal"

os.environ["DJANGO_DB_NAME"] = DB
os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings"
os.environ["DJANGO_DEBUG"] = "true"
os.environ["PYTHONNOUSERSITE"] = "1"
sys.path.insert(0, SP)

import django
django.setup()

from django.contrib.auth import get_user_model, authenticate
import demo_credentials

USER = get_user_model()
STUDENT_EMAIL = "demo.student01@fde-demo.local"
STUDENT_PASSWORD = demo_credentials.student_password()
TEACHER_EMAIL = "demo.teacher@fde-demo.local"
TEACHER_PASSWORD = demo_credentials.teacher_password()

for label, email, pwd in [
    ("STUDENT", STUDENT_EMAIL, STUDENT_PASSWORD),
    ("TEACHER", TEACHER_EMAIL, TEACHER_PASSWORD),
]:
    try:
        u = USER.objects.get(username=email)
    except USER.DoesNotExist:
        print(f"[{label}] NOT FOUND username={email}")
        continue
    chk = u.check_password(pwd)
    auth = authenticate(username=email, password=pwd)
    print(f"[{label}] username={email} is_active={u.is_active} is_staff={u.is_staff} "
          f"check_password={chk} authenticate={'OK' if auth else 'None'}")
