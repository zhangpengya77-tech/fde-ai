"""P3H Phase 12：Evidence 無效 PDF 上傳與資料一致性驗收（真實 HTTP／DB／媒體）。

設計原則：
- 全程走真實 HTTP（Entry 8142 -> Django 8140），不模擬 form／view。
- 每個案例前後都對「Evidence 列集合」與「媒體樹檔案集合」做快照差集，
  以「零殘留」作為拒絕類案例的唯一通過標準。
- 超大檔以檔案串流送出，避免把 100MB 放進記憶體。
- 所有帳號密碼僅存在本次程序記憶體。
"""

import hashlib
import http.cookiejar
import json
import os
import re
import secrets
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from django.conf import settings  # noqa: E402
from django.contrib.auth import get_user_model  # noqa: E402
from learning.models import (  # noqa: E402
    Cohort,
    Enrollment,
    Evidence,
    LearningGroup,
    StudentProfile,
    StudentTaskProgress,
    TaskDefinition,
)

BASE = os.environ.get("P3H_BASE", "http://127.0.0.1:8142").rstrip("/")
MEDIA_ROOT = Path(settings.MEDIA_ROOT)
PASSWORD = secrets.token_urlsafe(32)
TASK_ID = "T12"

RESULTS = []
FINDINGS = []


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + ("  :: " + detail if detail else ""))


def note(name, detail):
    RESULTS.append((name, None, detail))
    print("OBSERVE " + name + "  :: " + detail)


# --------------------------------------------------------------------------- HTTP


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """保留 302／403／404 原狀，避免被跟隨成 200 而誤判成功。"""

    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def opener():
    return urllib.request.build_opener(
        NoRedirect(), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
    )


def request(op, url, data=None, headers=None):
    req = urllib.request.Request(url, data=data, headers=headers or {})
    try:
        with op.open(req, timeout=120) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def csrf(html):
    match = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', html)
    assert match, "csrf token missing"
    return match.group(1)


def form_errors(html):
    """抽出表單錯誤訊息，用來證明「拒絕」是驗證器造成，而非無聲失敗。

    本專案模板 evidence_add.html 以 <p class="error">{{ error }}</p> 渲染，
    與 Django 預設的 <ul class="errorlist"> 不同，兩種都要認。
    """
    texts = []
    for item in re.findall(r'<p[^>]*class="[^"]*\berror\b[^"]*"[^>]*>(.*?)</p>', html, re.S):
        texts.append(re.sub(r"<[^>]+>", "", item).strip())
    blocks = re.findall(r'<(?:ul|div)[^>]*class="[^"]*errorlist[^"]*"[^>]*>(.*?)</(?:ul|div)>', html, re.S)
    for block in blocks:
        for item in re.findall(r"<li[^>]*>(.*?)</li>", block, re.S):
            texts.append(re.sub(r"<[^>]+>", "", item).strip())
    return [t for t in texts if t]


def login(op, email):
    status, body = request(op, BASE + "/login/")
    assert status == 200, status
    token = csrf(body.decode("utf-8", "replace"))
    data = urllib.parse.urlencode(
        {"csrfmiddlewaretoken": token, "username": email, "password": PASSWORD}
    ).encode()
    status, body = request(
        op,
        BASE + "/login/",
        data,
        {"Content-Type": "application/x-www-form-urlencoded", "Origin": BASE, "Referer": BASE + "/login/"},
    )
    assert status == 302, (status, body[:200])
    return token


def multipart_small(fields, filename, body):
    boundary = "----P3H" + secrets.token_hex(8)
    chunks = []
    for key, value in fields.items():
        chunks.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode()
        )
    chunks.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="upload"; '
        f'filename="{filename}"\r\nContent-Type: application/pdf\r\n\r\n'.encode()
    )
    chunks.append(body)
    chunks.append(f"\r\n--{boundary}--\r\n".encode())
    return boundary, b"".join(chunks)


def multipart_stream(fields, filename, payload_path):
    """把 multipart 邊界寫進暫存檔，payload 以串流方式接上，回傳 (boundary, path, size)。"""
    boundary = "----P3H" + secrets.token_hex(8)
    head = b""
    for key, value in fields.items():
        head += f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode()
    head += (
        f'--{boundary}\r\nContent-Disposition: form-data; name="upload"; '
        f'filename="{filename}"\r\nContent-Type: application/pdf\r\n\r\n'.encode()
    )
    tail = f"\r\n--{boundary}--\r\n".encode()
    out = Path(tempfile.mkstemp(prefix="p3h-mp-", suffix=".bin")[1])
    with out.open("wb") as fh:
        fh.write(head)
        with payload_path.open("rb") as src:
            while True:
                chunk = src.read(1024 * 1024)
                if not chunk:
                    break
                fh.write(chunk)
        fh.write(tail)
    return boundary, out, out.stat().st_size


def post_evidence(op, enrollment_id, token, boundary, body, content_length=None):
    headers = {
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Origin": BASE,
        "Referer": f"{BASE}/student/courses/{enrollment_id}/tasks/{TASK_ID}/",
    }
    if content_length is not None:
        headers["Content-Length"] = str(content_length)
    url = f"{BASE}/student/courses/{enrollment_id}/tasks/{TASK_ID}/evidence/"
    if isinstance(body, Path):
        with body.open("rb") as fh:
            req = urllib.request.Request(url, data=fh, headers=headers)
            try:
                with op.open(req, timeout=180) as resp:
                    return resp.status, resp.read()
            except urllib.error.HTTPError as exc:
                return exc.code, exc.read()
    return request(op, url, body, headers)


# ----------------------------------------------------------------------- snapshot


def media_snapshot():
    if not MEDIA_ROOT.exists():
        return {}
    snap = {}
    for path in MEDIA_ROOT.rglob("*"):
        if path.is_file():
            rel = path.relative_to(MEDIA_ROOT).as_posix()
            snap[rel] = hashlib.sha256(path.read_bytes()).hexdigest()
    return snap


def db_snapshot():
    rows = {}
    for ev in Evidence.objects.all():
        rows[str(ev.evidence_id)] = {
            "type": ev.evidence_type,
            "upload": ev.upload.name if ev.upload else "",
            "progress": ev.progress_id,
            "growth": ev.growth_submission_id,
            "size": ev.upload.size if ev.upload else 0,
        }
    return rows


def diff(before, after):
    return {k: v for k, v in after.items() if k not in before}


# ------------------------------------------------------------------------- seeding


def ensure_user(email, staff=False):
    User = get_user_model()
    user, _ = User.objects.get_or_create(username=email, defaults={"email": email})
    user.email = email
    user.is_active = True
    user.is_staff = staff
    user.set_password(PASSWORD)
    user.save()
    return user


def ensure_student(email, cohort_id):
    user = ensure_user(email)
    profile, _ = StudentProfile.objects.get_or_create(
        user=user,
        defaults={
            "nickname": email.split("@")[0],
            "email": email,
            "account_type": StudentProfile.AccountType.STUDENT,
            "active": True,
        },
    )
    cohort, _ = Cohort.objects.get_or_create(
        cohort_id=cohort_id, defaults={"name": cohort_id, "active": True}
    )
    group, _ = LearningGroup.objects.get_or_create(
        cohort=cohort, code="QA", defaults={"name": "QA", "active": True}
    )
    enrollment, _ = Enrollment.objects.get_or_create(
        student=profile, cohort=cohort, defaults={"group": group, "active": True}
    )
    return user, profile, enrollment


# ---------------------------------------------------------------------------- main


def main():
    print(f"BASE={BASE}")
    print(f"MEDIA_ROOT={MEDIA_ROOT}")

    # 班級編號須符合 Cohort.cohort_id 的 ^\d{4}-\d{2}$ 契約（get_or_create 不跑 validator，
    # 但寫入違規格式會污染候選資料集，故直接用合法值）。
    _, _, enroll_a = ensure_student("p3h12-a@example.test", "2026-12")
    _, _, enroll_b = ensure_student("p3h12-b@example.test", "2026-13")
    TaskDefinition.objects.get_or_create(
        task_id=TASK_ID, defaults={"sort_order": 12, "stage": "assess", "title": "P3H12 Evidence"}
    )

    student_a = opener()
    login(student_a, "p3h12-a@example.test")
    status, page = request(student_a, f"{BASE}/student/courses/{enroll_a.pk}/tasks/{TASK_ID}/")
    assert status == 200, status
    token_a = csrf(page.decode("utf-8", "replace"))

    valid_pdf = b"%PDF-1.4\n% P3H12 valid evidence\n%%EOF\n"

    # ---- E1 有效 PDF 基線
    db0, media0 = db_snapshot(), media_snapshot()
    boundary, payload = multipart_small({"csrfmiddlewaretoken": token_a, "evidence_type": "file"}, "p3h12-valid.pdf", valid_pdf)
    status, body = post_evidence(student_a, enroll_a.pk, token_a, boundary, payload)
    db1, media1 = db_snapshot(), media_snapshot()
    new_rows, new_files = diff(db0, db1), diff(media0, media1)
    row_ok = len(new_rows) == 1
    detail = f"status={status} new_rows={len(new_rows)} new_files={len(new_files)}"
    if row_ok:
        ev = Evidence.objects.get(pk=list(new_rows)[0])
        disk = Path(ev.upload.path)
        sha_ok = disk.is_file() and hashlib.sha256(disk.read_bytes()).hexdigest() == hashlib.sha256(valid_pdf).hexdigest()
        detail += f" stored={ev.upload.name} sha_match={sha_ok} under_media={MEDIA_ROOT.resolve() in disk.resolve().parents}"
        check("E1 valid PDF accepted and persisted 1:1", status == 302 and sha_ok and len(new_files) == 1, detail)
        baseline_evidence = ev
    else:
        check("E1 valid PDF accepted and persisted 1:1", False, detail)
        baseline_evidence = None

    # ---- E1b 具備物件結構的 PDF（非只有檔頭）亦應正常上傳
    structured_pdf = (
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n"
        b"trailer<</Root 1 0 R/Size 4>>\n%%EOF\n"
    )
    db0, media0 = db_snapshot(), media_snapshot()
    boundary, payload = multipart_small(
        {"csrfmiddlewaretoken": token_a, "evidence_type": "file"}, "p3h13-structured.pdf", structured_pdf
    )
    status, body = post_evidence(student_a, enroll_a.pk, token_a, boundary, payload)
    db1, media1 = db_snapshot(), media_snapshot()
    nr, nf = diff(db0, db1), diff(media0, media1)
    sha_ok = False
    if len(nr) == 1:
        ev_b = Evidence.objects.get(pk=list(nr)[0])
        disk_b = Path(ev_b.upload.path)
        sha_ok = disk_b.is_file() and hashlib.sha256(disk_b.read_bytes()).hexdigest() == hashlib.sha256(structured_pdf).hexdigest()
    check(
        "E1b structured PDF accepted and persisted 1:1",
        status == 302 and len(nr) == 1 and len(nf) == 1 and sha_ok,
        f"status={status} new_rows={len(nr)} new_files={len(nf)} sha_match={sha_ok}",
    )

    # ---- E2 錯誤副檔名（.exe）
    db0, media0 = db_snapshot(), media_snapshot()
    boundary, payload = multipart_small({"csrfmiddlewaretoken": token_a, "evidence_type": "file"}, "p3h12-bad.exe", valid_pdf)
    status, body = post_evidence(student_a, enroll_a.pk, token_a, boundary, payload)
    db1, media1 = db_snapshot(), media_snapshot()
    nr, nf = diff(db0, db1), diff(media0, media1)
    errs = form_errors(body.decode("utf-8", "replace"))
    check(
        "E2 wrong extension rejected with zero residue",
        status == 200 and not nr and not nf and bool(errs),
        f"status={status} new_rows={len(nr)} new_files={len(nf)} errors={errs[:2]}",
    )

    # ---- E3 超大檔（100 MB + 1 KB）
    big = Path(tempfile.mkstemp(prefix="p3h-big-", suffix=".pdf")[1])
    with big.open("wb") as fh:
        fh.write(b"%PDF-1.4\n")
        fh.truncate(100 * 1024 * 1024 + 1024)
    db0, media0 = db_snapshot(), media_snapshot()
    boundary, mp_path, mp_size = multipart_stream({"csrfmiddlewaretoken": token_a, "evidence_type": "file"}, "p3h12-huge.pdf", big)
    try:
        status, body = post_evidence(student_a, enroll_a.pk, token_a, boundary, mp_path, content_length=mp_size)
        db1, media1 = db_snapshot(), media_snapshot()
        nr, nf = diff(db0, db1), diff(media0, media1)
        errs = form_errors(body.decode("utf-8", "replace"))
        check(
            "E3 oversize (>100MB) rejected with zero residue",
            status == 200 and not nr and not nf and bool(errs),
            f"status={status} new_rows={len(nr)} new_files={len(nf)} errors={errs[:2]}",
        )
    finally:
        try:
            mp_path.unlink()
            big.unlink()
        except OSError:
            pass

    # ---- E4 二進位改名為 .pdf（P3-H 第十三階段起必須被拒絕，不得只信 Content-Type）
    binary_payloads = {
        "PE/MZ 執行檔": b"MZ\x90\x00\x03" + bytes(range(256)) * 8,
        "ZIP 壓縮檔": b"PK\x03\x04" + b"\x00" * 512,
        "純文字": b"NOT-A-PDF " * 64,
        "PNG 影像": b"\x89PNG\r\n\x1a\n" + b"\x00" * 512,
    }
    for label, blob in binary_payloads.items():
        db0, media0 = db_snapshot(), media_snapshot()
        boundary, payload = multipart_small(
            {"csrfmiddlewaretoken": token_a, "evidence_type": "file"}, "p3h13-binary.pdf", blob
        )
        status, body = post_evidence(student_a, enroll_a.pk, token_a, boundary, payload)
        db1, media1 = db_snapshot(), media_snapshot()
        nr, nf = diff(db0, db1), diff(media0, media1)
        errs = form_errors(body.decode("utf-8", "replace"))
        check(
            f"E4 binary renamed .pdf rejected [{label}]",
            status == 200 and not nr and not nf and any("PDF" in err for err in errs),
            f"status={status} new_rows={len(nr)} new_files={len(nf)} errors={errs[:2]}",
        )

    # ---- E5 零位元組 .pdf
    db0, media0 = db_snapshot(), media_snapshot()
    boundary, payload = multipart_small({"csrfmiddlewaretoken": token_a, "evidence_type": "file"}, "p3h12-empty.pdf", b"")
    status, body = post_evidence(student_a, enroll_a.pk, token_a, boundary, payload)
    db1, media1 = db_snapshot(), media_snapshot()
    nr, nf = diff(db0, db1), diff(media0, media1)
    errs = form_errors(body.decode("utf-8", "replace"))
    check(
        "E5 zero-byte .pdf rejected with zero residue",
        status == 200 and not nr and not nf and bool(errs),
        f"status={status} new_rows={len(nr)} new_files={len(nf)} errors={errs[:2]}",
    )

    # ---- E6 路徑穿越檔名
    db0, media0 = db_snapshot(), media_snapshot()
    boundary, payload = multipart_small({"csrfmiddlewaretoken": token_a, "evidence_type": "file"}, "../../../p3h12-evil.pdf", valid_pdf)
    status, body = post_evidence(student_a, enroll_a.pk, token_a, boundary, payload)
    db1, media1 = db_snapshot(), media_snapshot()
    nr, nf = diff(db0, db1), diff(media0, media1)
    if nr:
        ev = Evidence.objects.get(pk=list(nr)[0])
        disk = Path(ev.upload.path).resolve()
        inside = MEDIA_ROOT.resolve() in disk.parents
        check(
            "E6 path traversal filename contained inside media root",
            inside and ".." not in ev.upload.name,
            f"status={status} stored={ev.upload.name} inside_media={inside}",
        )
    else:
        check("E6 path traversal filename rejected", status == 200 and not nf, f"status={status} new_files={len(nf)}")

    # ---- E7 跨班級越權上傳（B 對 A 的 enrollment）
    # 必須使用 B 自己的 CSRF token：若沿用 A 的 token，請求會在 CSRF 中介層就被擋成 403，
    # 測到的是 CSRF 保護而非 view 的擁有者校驗，屬於測錯目標。
    student_b = opener()
    login(student_b, "p3h12-b@example.test")
    status_b, page_b = request(student_b, f"{BASE}/student/courses/{enroll_b.pk}/tasks/{TASK_ID}/")
    assert status_b == 200, status_b
    token_b = csrf(page_b.decode("utf-8", "replace"))
    db0, media0 = db_snapshot(), media_snapshot()
    boundary, payload = multipart_small({"csrfmiddlewaretoken": token_b, "evidence_type": "file"}, "p3h12-cross.pdf", valid_pdf)
    status, body = post_evidence(student_b, enroll_a.pk, token_b, boundary, payload)
    db1, media1 = db_snapshot(), media_snapshot()
    nr, nf = diff(db0, db1), diff(media0, media1)
    check(
        "E7 cross-cohort upload rejected with zero residue",
        status == 404 and not nr and not nf,
        f"status={status} new_rows={len(nr)} new_files={len(nf)}",
    )

    # ---- E7b 沿用他人 CSRF token 的越權嘗試（應在 CSRF 層被擋）
    db0, media0 = db_snapshot(), media_snapshot()
    boundary, payload = multipart_small({"csrfmiddlewaretoken": token_a, "evidence_type": "file"}, "p3h12-csrfcross.pdf", valid_pdf)
    status, body = post_evidence(student_b, enroll_a.pk, token_a, boundary, payload)
    db1, media1 = db_snapshot(), media_snapshot()
    nr, nf = diff(db0, db1), diff(media0, media1)
    check(
        "E7b foreign CSRF token rejected with zero residue",
        status == 403 and not nr and not nf,
        f"status={status} new_rows={len(nr)} new_files={len(nf)}",
    )

    # ---- E8 全量一致性：列 <-> 檔
    rows = {ev.evidence_id: ev for ev in Evidence.objects.all() if ev.upload}
    media = media_snapshot()
    missing = []
    sha_bad = []
    for eid, ev in rows.items():
        rel = ev.upload.name
        if rel not in media:
            missing.append(str(eid))
            continue
        disk = Path(ev.upload.path)
        if disk.is_file() and hashlib.sha256(disk.read_bytes()).hexdigest() != media.get(rel):
            sha_bad.append(str(eid))
    referenced = set(rows[eid].upload.name for eid in rows)
    orphans = sorted(set(media) - referenced)
    check(
        "E8 every Evidence row has its file (no dangling rows)",
        not missing,
        f"rows={len(rows)} media={len(media)} missing={len(missing)} {missing[:3]}",
    )
    check(
        "E8 no orphan media files (no residue)",
        not orphans,
        f"orphans={len(orphans)} {orphans[:5]}",
    )

    # ---- E9 拒絕類案例未污染任務進度狀態
    progress = StudentTaskProgress.objects.filter(enrollment=enroll_a).first()
    if progress:
        check(
            "E9 rejected uploads did not corrupt progress state",
            progress.status in (
                StudentTaskProgress.Status.IN_PROGRESS,
                StudentTaskProgress.Status.SUBMITTED,
                StudentTaskProgress.Status.REVIEWED,
            ),
            f"status={progress.status}",
        )
    else:
        check("E9 rejected uploads did not corrupt progress state", False, "progress row missing")

    # ---- 總結
    passed = sum(1 for _, ok, _ in RESULTS if ok is True)
    failed = sum(1 for _, ok, _ in RESULTS if ok is False)
    observed = sum(1 for _, ok, _ in RESULTS if ok is None)
    print("")
    for name, detail in FINDINGS:
        print(f"FINDING {name}  :: {detail}")
    print(f"SUMMARY pass={passed} fail={failed} observe={observed} finding={len(FINDINGS)}")
    print("EVIDENCE_ATOMICITY_" + ("PASS" if failed == 0 else "FAIL"))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
