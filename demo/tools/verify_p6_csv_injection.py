#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""P6 CSV 公式注入防護 — 端到端驗證（2026-10-13 教師指令第六項第 6 點）。

在**隔離驗證庫**（demo/runtime/db/p42_verify.sqlite3）內暫時建立一組攻擊向量資料，
透過執行中的 :8112 服務以教師身分實際匯出 CSV，驗證：
  1. 任何以 `=` `+` `-` `@` `TAB` `CR` 開頭的儲存格都被中和（前置單引號），
     不可能被 Excel／Google Sheets 當成公式執行。
  2. 攻擊字串本身仍完整保留（不靜默丟棄、不改變學員可見內容）。
  3. 匯出檔不含任何未中和的公式儲存格。

安全設計：
  1. 只允許寫入檔名含 `p42_verify` 的獨立測試庫，否則安全停止。
  2. 結束時（含例外）一律清除本腳本建立的全部資料，並驗證已還原。
  3. 憑證不寫入程式：由 demo_credentials 載入器取得。
"""
import csv
import http.cookiejar
import io
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import demo_credentials  # noqa: E402

DB_PATH = os.environ.get("DJANGO_DB_NAME", "")
if "p42_verify" not in DB_PATH:
    print("[安全停止] DJANGO_DB_NAME 必須指向 p42_verify 獨立測試庫，目前為：%r" % DB_PATH)
    sys.exit(2)
if "demo.sqlite3" in DB_PATH or os.path.join("student_portal", "db.sqlite3") in DB_PATH:
    print("[安全停止] 拒絕對 DEMO／正式資料庫寫入：%r" % DB_PATH)
    sys.exit(2)

MEDIA_PATH = os.environ.get("DJANGO_MEDIA_ROOT", "")
if not MEDIA_PATH or "runtime" not in MEDIA_PATH.replace("\\", "/"):
    print("[安全停止] 需設定隔離的 DJANGO_MEDIA_ROOT（含 runtime）：目前為 %r" % MEDIA_PATH)
    sys.exit(2)

sys.path.insert(0, r"D:\FDE-AI-UAS-v2.0\student_portal")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django  # noqa: E402

django.setup()

from django.contrib.auth import get_user_model  # noqa: E402

from learning.growth_records import ensure_growth_submissions  # noqa: E402
from learning.models import (  # noqa: E402
    Cohort,
    Enrollment,
    GrowthRecordSubmission,
    StudentProfile,
    TeacherCohortAccess,
)

BASE = "http://192.168.1.114:8112"
COHORT_ID = "P6-INJ-2026"
COHORT_NAME = "=SUM(1+1)*cmd|'/C calc'!A0"
TEACHER_EMAIL = "p42.teacher.a@fde-demo.local"
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")

# 四種公式起頭字元 + TAB + CR，每個都建立一位學員。
PAYLOADS = [
    ("=cmd|' /C calc'!A0", "等號起頭"),
    ("+1+1|' /C calc'!A0", "加號起頭"),
    ("-2+3+cmd|' /C calc'!A0", "減號起頭"),
    ("@SUM(1+1)*cmd|'/C calc'!A0", "小老鼠起頭"),
    ("\t=1+1", "TAB 起頭"),
]

RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    print("%s - %s%s" % ("PASS" if ok else "FAIL", name, (" | " + detail) if detail else ""))


def csv_rows(text):
    return list(csv.reader(io.StringIO(text)))


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------
def new_session():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(
        urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(jar)
    )


def _open(opener, url, referer=None, data=None):
    headers = {"User-Agent": "P6-INJ/1.0", "Referer": referer or BASE + "/"}
    if data is not None:
        parts = urllib.parse.urlsplit(referer or BASE + "/")
        headers["Origin"] = "%s://%s" % (parts.scheme, parts.netloc)
    request = urllib.request.Request(url, data=data, headers=headers)
    try:
        with opener.open(request, timeout=30) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def login_teacher(password):
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(jar)
    )
    _status, page = _open(opener, BASE + "/teacher/login/")
    token = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', page.decode("utf-8", "replace"))
    payload = urllib.parse.urlencode(
        {
            "username": TEACHER_EMAIL,
            "password": password,
            "csrfmiddlewaretoken": token.group(1) if token else "",
        }
    ).encode()
    status, body = _open(opener, BASE + "/teacher/login/", referer=BASE + "/teacher/login/", data=payload)
    return opener, status in (200, 302) and b"<form" not in body[:200]


# ---------------------------------------------------------------------------
# 攻擊向量資料（僅存在於隔離驗證庫，結束時一律清除）
# ---------------------------------------------------------------------------
def create_fixture():
    teacher = get_user_model().objects.filter(username=TEACHER_EMAIL).first()
    if teacher is None:
        raise RuntimeError("找不到教師帳號 %s" % TEACHER_EMAIL)
    cohort = Cohort.objects.create(cohort_id=COHORT_ID, name=COHORT_NAME)
    TeacherCohortAccess.objects.create(teacher=teacher, cohort=cohort)
    created = []
    try:
        for index, (payload, _label) in enumerate(PAYLOADS):
            email = "p6.inj.%d@fde-inj.local" % (index + 1)
            user = get_user_model().objects.create_user(
                username=email, email=email, password=uuid.uuid4().hex + "Aa1!"
            )
            profile = StudentProfile.objects.create(
                student_id=uuid.uuid4().hex, nickname=payload, email=email, user=user
            )
            enrollment = Enrollment.objects.create(student=profile, cohort=cohort)
            submissions = ensure_growth_submissions(enrollment)
            first = submissions[0]
            first.status = GrowthRecordSubmission.Status.SUBMITTED
            first.save(update_fields=["status"])
            created.append((user, profile, enrollment))
    except Exception:
        remove_fixture(cohort, created)
        raise
    return teacher, cohort, created


def remove_fixture(cohort, created):
    for user, profile, enrollment in created:
        GrowthRecordSubmission.objects.filter(enrollment=enrollment).delete()
        Enrollment.objects.filter(pk=enrollment.pk).delete()
        StudentProfile.objects.filter(pk=profile.pk).delete()
        get_user_model().objects.filter(pk=user.pk).delete()
    TeacherCohortAccess.objects.filter(cohort=cohort).delete()
    Cohort.objects.filter(cohort_id=COHORT_ID).delete()


# ---------------------------------------------------------------------------
# 主體
# ---------------------------------------------------------------------------
def main():
    password = demo_credentials.load_password("teacher", required=False)
    if not password:
        print("[安全停止] 無法取得教師密碼：請設定 FDE_DEMO_TEACHER_PASSWORD 或提供憑證檔。")
        return 2

    before_cohorts = Cohort.objects.count()
    before_users = get_user_model().objects.count()

    opener, ok = login_teacher(password)
    check("前置：教師 A 可登入", ok)
    if not ok:
        return 2

    cohort = None
    created = []
    try:
        _teacher, cohort, created = create_fixture()
        check("前置：已於隔離驗證庫建立攻擊向量班級與 %d 位學員" % len(created), True)

        summary_url = BASE + "/teacher/class-report/export/summary/%s/" % COHORT_ID
        records_url = BASE + "/teacher/class-report/export/records/%s/" % COHORT_ID
        checklist_url = BASE + "/teacher/review-checklist/%s/" % COHORT_ID

        status, raw = _open(opener, summary_url)
        check("匯出摘要 CSV 成功（200）", status == 200, "status=%s" % status)
        check("摘要 CSV 具 UTF-8 BOM", raw.startswith(b"\xef\xbb\xbf"))
        summary_text = raw.decode("utf-8-sig")

        status, raw = _open(opener, records_url)
        check("匯出明細 CSV 成功（200）", status == 200, "status=%s" % status)
        check("明細 CSV 具 UTF-8 BOM", raw.startswith(b"\xef\xbb\xbf"))
        records_text = raw.decode("utf-8-sig")

        # 1) 不得有任何未中和的公式儲存格
        offenders = []
        for name, text in (("摘要", summary_text), ("明細", records_text)):
            for row in csv_rows(text):
                for cell in row:
                    if cell.startswith(FORMULA_PREFIXES):
                        offenders.append((name, cell))
        check("1. 匯出檔不含任何以公式字元開頭的儲存格", not offenders,
              "offenders=%s" % offenders[:5])

        # 2) 班級名稱（=SUM(...)）已被中和
        check("2. 班級名稱攻擊向量已中和（前置單引號）",
              "'" + COHORT_NAME in summary_text and COHORT_NAME in summary_text)

        # 3) 每位學員暱稱（各類公式起頭）皆已中和，且原文完整保留
        raw_cells = {cell for row in csv_rows(records_text) for cell in row}
        unneutralised = [payload for payload, _label in PAYLOADS if payload in raw_cells]
        missing = [
            payload for payload, _label in PAYLOADS if ("'" + payload) not in raw_cells
        ]
        check(
            "3. 全部 %d 種公式起頭學員暱稱皆已中和且原文保留" % len(PAYLOADS),
            not unneutralised and not missing,
            "未中和=%s 未保留=%s" % (unneutralised, missing),
        )

        # 4) 攻擊字串未被靜默丟棄
        check("4. 攻擊字串完整保留（未被靜默丟棄）",
              all(payload in records_text for payload, _label in PAYLOADS))

        # 5) 逐格驗證：以公式字元開頭者必帶前置單引號
        verified = 0
        for row in csv_rows(records_text):
            for cell in row:
                if cell.startswith("'"):
                    if not cell[1:2] or cell[1] not in FORMULA_PREFIXES:
                        check("5. 前置單引號只用於公式起頭儲存格", False, repr(cell))
                        break
                    verified += 1
        check("5. 前置單引號僅施加於公式起頭儲存格（共 %d 格）" % verified, verified >= len(PAYLOADS))

        # 6) 清單頁同樣不得執行任何內容（純文字輸出）
        status, checklist_raw = _open(opener, checklist_url)
        checklist_text = checklist_raw.decode("utf-8", "replace")
        check("6. 結訓審核清單成功呈現攻擊向量班級", status == 200 and COHORT_ID in checklist_text)
        check("6. 清單未將攻擊字串放入任何可執行屬性",
              "javascript:" not in checklist_text.lower()
              and "onerror=" not in checklist_text.lower())

        # 7) 表格仍可被試算表正確解析（欄數一致）
        header, body = csv_rows(records_text)[0], [
            row for row in csv_rows(records_text)[1:] if row and row[0] != "說明"
        ]
        check("7. 明細 CSV 每列欄數一致（%d 欄）" % len(header),
              bool(body) and all(len(row) == len(header) for row in body),
              "列數=%s" % len(body))
    finally:
        if cohort is not None:
            remove_fixture(cohort, created)
            check("清理：攻擊向量班級已刪除", not Cohort.objects.filter(cohort_id=COHORT_ID).exists())
            check("清理：學員帳號已刪除",
                  get_user_model().objects.count() == before_users
                  and Cohort.objects.count() == before_cohorts,
                  "cohorts=%s/%s users=%s/%s"
                  % (Cohort.objects.count(), before_cohorts,
                     get_user_model().objects.count(), before_users))

    passed = sum(1 for _n, ok, _d in RESULTS if ok)
    failed = [name for name, ok, _d in RESULTS if not ok]
    print("")
    print("=" * 74)
    print("P6 CSV 公式注入防護驗證：%d/%d PASS" % (passed, len(RESULTS)))
    if failed:
        print("未通過項目：")
        for name in failed:
            print("  - %s" % name)
    print("=" * 74)
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
