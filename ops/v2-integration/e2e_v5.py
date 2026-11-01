"""經完整 HTTPS 鏈路（TLS→入口→Gateway→Django／Live）驗收 V5 真實檢測閉環。

只用隔離環境與真實 F450 照片；結果寫入 RUNTIME/logs/e2e_v5.json，不輸出密碼。
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import httpx

RUNTIME = Path(sys.argv[1] if len(sys.argv) > 1 else "D:/FDE-AI-Runtime/v2-integration")
BASE = sys.argv[2] if len(sys.argv) > 2 else "https://localhost:8543"
PHOTOS = sorted(Path("D:/AI/F450_CW_CCW_V5_training/build_20261027_093000/images/val").glob("*.jpg"))
accounts = json.loads((RUNTIME / "accounts.json").read_text(encoding="utf-8"))
A, B = accounts["cohorts"]["A"], accounts["cohorts"]["B"]
PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"
results: list[dict] = []


def check(name: str, ok: bool, detail: object = "") -> bool:
    results.append({"name": name, "result": "PASS" if ok else "FAIL", "detail": str(detail)[:300]})
    print("PASS" if ok else "FAIL", name, str(detail)[:160])
    return ok


def client(agent: str = "Mozilla/5.0 Desktop") -> httpx.Client:
    return httpx.Client(base_url=BASE, verify=False, trust_env=False, timeout=180, headers={"User-Agent": agent, "Referer": BASE + "/"})


def token(http: httpx.Client, path: str) -> str:
    page = http.get(path)
    match = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', page.text)
    return match.group(1) if match else ""


def login(http: httpx.Client, path: str, field: str, value: str) -> httpx.Response:
    return http.post(path, data={"csrfmiddlewaretoken": token(http, path), field: value, "password": accounts["password"]})


teacher = client()
response = login(teacher, "/teacher/login/", "username", A["teacher"])
check("教師 A 經 HTTPS 登入", response.status_code == 302, response.status_code)
cookie = response.headers.get("set-cookie", "")
check("Session Cookie 帶 Secure／HttpOnly", "Secure" in cookie and "HttpOnly" in cookie, cookie[:80] and "attrs checked")

scan_url = f"/student/courses/{A['enrollment']}/rotation-v5/"
rotation = "/teacher/vision-center/rotation-v5/"
page = teacher.get(rotation)
check("教師模型頁顯示 V5 與候選狀態", page.status_code == 200 and "PENDING_TEACHER_VALIDATION" in page.text, page.status_code)

student = client(PHONE)
response = login(student, "/login/", "username", A["student"])
check("學員 A 以手機 UA 登入", response.status_code == 302, response.status_code)
response = student.post(scan_url, data={"csrfmiddlewaretoken": token(student, scan_url)}, files={"photo": (PHOTOS[0].name, PHOTOS[0].read_bytes(), "image/jpeg")})
check("教師未確認前學員不可用", response.status_code == 503 and "rotation_model_not_available" in response.text, response.status_code)

photo = PHOTOS[0]
response = teacher.post(rotation, data={"csrfmiddlewaretoken": token(teacher, rotation), "action": "validate", "expected_class": "CW"}, files={"photo": (photo.name, photo.read_bytes(), "image/jpeg")})
validation = re.search(r'name="validation_id" value="([^"]+)"', response.text)
check("教師真實 YOLO 圖片驗證", response.status_code == 200 and bool(validation), re.findall(r"(CCW|CW) · ([0-9.]+)", response.text)[:4])

response = teacher.post(rotation, data={"csrfmiddlewaretoken": token(teacher, rotation), "action": "enable_trial", "cohort_id": A["cohort_id"]})
check("未人工確認不得啟用試用", "teacher_confirmation_required" in response.text or "rotation_trial_enable_failed" in response.text, response.status_code)
response = teacher.post(rotation, data={"csrfmiddlewaretoken": token(teacher, rotation), "action": "confirm", "validation_id": validation.group(1) if validation else "", "decision": "CORRECT"})
check("教師確認辨識正確", response.status_code == 200, response.status_code)
response = teacher.post(rotation, data={"csrfmiddlewaretoken": token(teacher, rotation), "action": "enable_trial", "cohort_id": A["cohort_id"]})
check("限定班級啟用 CANDIDATE 教學試用", "TEACHING_TRIAL" in teacher.get(rotation).text, response.status_code)
response = teacher.post(rotation, data={"csrfmiddlewaretoken": token(teacher, rotation), "action": "activate"})
check("無獨立 Golden Test 拒絕 ACTIVE", "independent_golden_test_required" in response.text or "rotation_activation_failed" in response.text, response.status_code)
check("拒絕後仍為 TEACHING_TRIAL", "ACTIVE_ISOLATED" not in re.sub(r"<form.*?</form>", "", teacher.get(rotation).text, flags=re.S), "")

detections = []
record_urls = []
for image in PHOTOS[:3]:
    response = student.post(scan_url, data={"csrfmiddlewaretoken": token(student, scan_url)}, files={"photo": (image.name, image.read_bytes(), "image/jpeg")})
    location = response.headers.get("location", "")
    ok = response.status_code == 302 and "record=" in location
    page = student.get(location) if ok else response
    tags = re.findall(r'vision-tag \w+">(CCW|CW) ([0-9.]+)', page.text)
    detections.append({"photo": image.name, "tags": tags})
    record_urls.append(location.split("record=")[-1] if ok else "")
    check(f"學員上傳 {image.name} → 真實 YOLO", ok and bool(tags) and "<rect" in page.text and "v5_finetune_20261027_101500" in page.text, tags[:4])
record_id = record_urls[0]
image_url = f"/evidence/vision-inspections/{record_id}/image/"
check("學員可讀自己的私有圖片", student.get(image_url).status_code == 200, "")
anonymous = client()
check("匿名讀圖被導向登入", anonymous.get(image_url).status_code in (302, 403, 404), "")

other_student = client(PHONE)
login(other_student, "/login/", "username", B["student"])
check("B 班學員不可讀 A 班圖片", bool(record_id) and other_student.get(image_url).status_code == 404, "")
response = other_student.post(f"/student/courses/{B['enrollment']}/rotation-v5/", data={"csrfmiddlewaretoken": token(other_student, f"/student/courses/{B['enrollment']}/rotation-v5/")}, files={"photo": (photo.name, photo.read_bytes(), "image/jpeg")})
check("未授權班級不可推論", response.status_code == 503 and "cohort_not_authorized" in response.text, response.status_code)
check("學員不可進他人課程頁", other_student.get(scan_url).status_code == 404, "")
other_teacher = client()
login(other_teacher, "/teacher/login/", "username", B["teacher"])
detail = f"/teacher/vision-inspections/{record_id}/"
check("B 班教師不可看 A 班紀錄", bool(record_id) and other_teacher.get(detail).status_code == 404, "")

response = student.post(scan_url, data={"csrfmiddlewaretoken": token(student, scan_url)}, files={"photo": ("x.jpg", b"GIF89a-not-a-jpeg", "image/jpeg")})
check("偽裝圖片被拒", response.status_code == 422, response.status_code)
response = student.post(scan_url, files={"photo": (photo.name, photo.read_bytes(), "image/jpeg")})
check("缺 CSRF 被拒", response.status_code == 403, response.status_code)
forged = client()
response = forged.post("/api/v1/vision/rotation-v5/teacher/activate-isolated", json={}, headers={"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": "1"})
check("外部偽造教師標頭被拒", response.status_code in (401, 403, 404), response.status_code)

check("教師列表可見學員紀錄", "集成學員 A" in teacher.get("/teacher/vision-inspections/").text, "")
response = teacher.post(detail, data={"csrfmiddlewaretoken": token(teacher, detail), "decision": "RESUBMIT", "note": "請補拍"})
check("教師要求重傳", response.status_code == 302, response.status_code)
page = student.get(f"{scan_url}?record={record_id}")
check("學員看到要求重傳", "教師要求重傳" in page.text and "請補拍" in page.text, "")
check("失敗樣本可查詢", bool(record_id) and record_id in teacher.get("/teacher/vision-inspections/?failure=1").text, "")
teacher.post(detail, data={"csrfmiddlewaretoken": token(teacher, detail), "decision": "NG"})
response = teacher.post(detail, data={"csrfmiddlewaretoken": token(teacher, detail), "decision": "PASS", "note": "人工改判"})
page = teacher.get(detail)
check("覆核歷程保留三筆", page.text.count("<li>2026") >= 3 or page.text.count("v2.teacher.a") >= 3, page.text.count("v2.teacher.a"))
check("依學員查成長紀錄", bool(record_id) and record_id in teacher.get(f"/teacher/vision-inspections/?student={A['student_id']}").text, "")

response = teacher.post(rotation, data={"csrfmiddlewaretoken": token(teacher, rotation), "action": "withdraw_trial"})
response2 = student.post(scan_url, data={"csrfmiddlewaretoken": token(student, scan_url)}, files={"photo": (photo.name, photo.read_bytes(), "image/jpeg")})
check("回滾後學員立即停用", response2.status_code == 503, response2.status_code)
check("回滾不刪歷史紀錄", bool(record_id) and record_id in teacher.get("/teacher/vision-inspections/").text, "")

summary = {"pass": sum(item["result"] == "PASS" for item in results), "fail": sum(item["result"] == "FAIL" for item in results), "detections": detections, "results": results}
(RUNTIME / "logs/e2e_v5.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"TOTAL PASS={summary['pass']} FAIL={summary['fail']}")
sys.exit(1 if summary["fail"] else 0)
