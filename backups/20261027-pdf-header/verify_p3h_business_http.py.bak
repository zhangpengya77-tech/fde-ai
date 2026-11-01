"""P3H：經 Entry 8142 驗證真實登入、Evidence 與班級隔離。"""
import hashlib, http.cookiejar, re, secrets, urllib.error, urllib.parse, urllib.request
from pathlib import Path

from django.contrib.auth import get_user_model
from learning.models import Cohort, Enrollment, Evidence, LearningGroup, StudentProfile, TaskDefinition, TeacherCohortAccess

BASE = "http://127.0.0.1:8142"
PDF = b"%PDF-1.4\n% P3H isolated evidence\n%%EOF\n"
# 僅存在於本次隔離驗收程序記憶體；不寫入檔案、日誌或回應。
TEST_PASSWORD = secrets.token_urlsafe(32)

def ensure_user(email, password, *, staff=False):
    User = get_user_model(); user, _ = User.objects.get_or_create(username=email, defaults={"email": email})
    user.email=email; user.is_active=True; user.is_staff=staff; user.set_password(password); user.save(); return user

def ensure_student(email, cohort_id):
    user=ensure_user(email, TEST_PASSWORD)
    profile,_=StudentProfile.objects.get_or_create(user=user, defaults={"nickname":email.split('@')[0],"email":email,"account_type":StudentProfile.AccountType.STUDENT,"active":True})
    cohort,_=Cohort.objects.get_or_create(cohort_id=cohort_id,defaults={"name":cohort_id,"active":True})
    group,_=LearningGroup.objects.get_or_create(cohort=cohort,code="QA",defaults={"name":"QA","active":True})
    enrollment,_=Enrollment.objects.get_or_create(student=profile,cohort=cohort,defaults={"group":group,"active":True})
    return user, profile, enrollment

def opener(): return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
class NoRedirect(urllib.request.HTTPRedirectHandler):
    """保留拒絕請求的原始 302／403／404，不把它誤判為登入頁 200。"""
    def redirect_request(self, request, fp, code, msg, headers, newurl): return None
def rejecting_opener(): return urllib.request.build_opener(NoRedirect(), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def csrf(html):
    match=re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"',html)
    assert match, "csrf token missing"; return match.group(1)
def request(op, url, data=None, headers=None):
    req=urllib.request.Request(url,data=data,headers=headers or {})
    try:
        with op.open(req,timeout=15) as response: return response.status,response.read(),response.geturl()
    except urllib.error.HTTPError as error: return error.code,error.read(),error.geturl()
def form(data): return urllib.parse.urlencode(data).encode()
def multipart(fields, filename, body):
    boundary="----P3H"+secrets.token_hex(8); chunks=[]
    for key,value in fields.items(): chunks += [f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{value}\r\n".encode()]
    chunks += [f"--{boundary}\r\nContent-Disposition: form-data; name=\"upload\"; filename=\"{filename}\"\r\nContent-Type: application/pdf\r\n\r\n".encode(),body,f"\r\n--{boundary}--\r\n".encode()]
    return boundary,b"".join(chunks)
def login(op, path, email):
    status,body,_=request(op,BASE+path); assert status==200
    token=csrf(body.decode()); status,body,url=request(op,BASE+path,form({"csrfmiddlewaretoken":token,"username":email,"password":TEST_PASSWORD}),{"Content-Type":"application/x-www-form-urlencoded","Origin":BASE,"Referer":BASE+path})
    assert status==200 and ("student" in url or "teacher" in url), (status,url); return token

student_a, profile_a, enroll_a=ensure_student("p3h-a@example.test","P3H-A")
student_b, profile_b, enroll_b=ensure_student("p3h-b@example.test","P3H-B")
teacher_a=ensure_user("p3h-teacher-a@example.test",TEST_PASSWORD,staff=True)
teacher_b=ensure_user("p3h-teacher-b@example.test",TEST_PASSWORD,staff=True)
TeacherCohortAccess.objects.get_or_create(teacher=teacher_a,cohort=enroll_a.cohort)
TeacherCohortAccess.objects.get_or_create(teacher=teacher_b,cohort=enroll_b.cohort)
TaskDefinition.objects.get_or_create(task_id="T10",defaults={"sort_order":10,"stage":"assess","title":"P3H PDF"})

owner=opener(); token=login(owner,"/login/","p3h-a@example.test")
status, task_page, _ = request(owner, f"{BASE}/student/courses/{enroll_a.pk}/tasks/T10/")
assert status == 200
token = csrf(task_page.decode())
boundary,payload=multipart({"csrfmiddlewaretoken":token,"evidence_type":Evidence.Type.FILE},"p3h.pdf",PDF)
status,_,_=request(owner,f"{BASE}/student/courses/{enroll_a.pk}/tasks/T10/evidence/",payload,{"Content-Type":f"multipart/form-data; boundary={boundary}","Origin":BASE,"Referer":f"{BASE}/student/courses/{enroll_a.pk}/tasks/T10/"})
assert status==200, status
evidence=Evidence.objects.filter(progress__enrollment=enroll_a).latest("created_at")
assert Path(evidence.upload.path).is_file() and Path(evidence.upload.path).read_bytes()==PDF

teacher=opener(); login(teacher,"/teacher/login/","p3h-teacher-a@example.test")
status,download,_=request(teacher,f"{BASE}/evidence/{evidence.pk}/download/"); assert status==200 and download==PDF
other_teacher=opener(); login(other_teacher,"/teacher/login/","p3h-teacher-b@example.test")
cross_teacher=request(other_teacher,f"{BASE}/evidence/{evidence.pk}/download/")[0]
other_student=opener(); token_b=login(other_student,"/login/","p3h-b@example.test")
cross_student=request(other_student,f"{BASE}/evidence/{evidence.pk}/download/")[0]
boundary,forged=multipart({"csrfmiddlewaretoken":token_b,"evidence_type":Evidence.Type.FILE},"forged.pdf",PDF)
forged_status=request(other_student,f"{BASE}/student/courses/{enroll_a.pk}/tasks/T10/evidence/",forged,{"Content-Type":f"multipart/form-data; boundary={boundary}","Origin":BASE,"Referer":BASE})[0]
anonymous_status=request(rejecting_opener(),f"{BASE}/evidence/{evidence.pk}/download/")[0]
print("BUSINESS_HTTP_REJECTION_STATUSES teacher=%s student=%s forged=%s anonymous=%s" % (cross_teacher,cross_student,forged_status,anonymous_status))
assert cross_teacher in (403,404) and cross_student in (403,404) and forged_status in (403,404) and anonymous_status in (302,403,404)
print("BUSINESS_HTTP_PASS evidence=%s sha256=%s teacher=%s cross_teacher=%s cross_student=%s forged=%s anonymous=%s" % (evidence.pk,hashlib.sha256(PDF).hexdigest(),status,cross_teacher,cross_student,forged_status,anonymous_status))
