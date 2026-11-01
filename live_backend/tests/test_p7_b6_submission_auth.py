"""P7-B6 驗收：匿名／冒用身分不得建立學員模型提交。

批准令（P7 安全鏈路修復批准令 §二 第一優先）要求：

* 匿名使用者不能建立模型或影像提交；
* 不信任請求本文中的 ``student_id``；
* 真實身分必須由已驗證的 Session 或有效內部 Assertion 取得；
* 驗證 Enrollment 與 Cohort；
* 學員不得冒用其他學員提交；
* 無效或未經授權的請求不得建立正式提交紀錄。

本檔在修復前**必須全紅**（第一項重現「匿名 POST 回 201」），修復後全綠。
每項測試都同時斷言 HTTP 狀態與「提交紀錄數量的前後差異」。
"""

from __future__ import annotations

import base64
import json
import tempfile
import unittest
from pathlib import Path

from starlette.testclient import TestClient

from app import live_assertions
from app.main import create_app
from app.vision_center import HOVER_CLASSES, PROP_CLASSES, VisionCenter
from p6_signed_client import DEFAULT_KEY, DEFAULT_LEDGER, install_identity_env, signed_teacher_client


SUBMISSIONS_PATH = "/api/v1/vision/submissions"
STUDENT_SUBJECT = "S1"
STUDENT_ENROLLMENT = 11
COHORT_A = "COHORT-A"


class OfflineVision:
    async def health(self):
        return False


class FixtureValidator:
    def validate(self, _path, model_type):
        return {
            "class_names": list(PROP_CLASSES if model_type == "PROP_DIRECTION" else HOVER_CLASSES),
            "task": "detect",
            "smoke_inference": True,
        }


class FixtureRunner:
    def predict(self, _path, _image_bytes):
        return []


def _submission_payload(**overrides):
    payload = {
        "task_id": "PROP_DIRECTION",
        "student_id": STUDENT_SUBJECT,
        "group_id": "G1",
        "growth_record_id": "77",
        "growth_record_slot": "R07",
        "evidence_reference": "evidence-77",
        "evidence_type": "YOLO_MODEL",
        "original_filename": "best.pt",
        "file_base64": base64.b64encode(b"fixture-best-pt").decode("ascii"),
        "notes": "hw",
    }
    payload.update(overrides)
    return payload


class _Base(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parents[2] / ".test-temp"
        root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=root)
        self.center = VisionCenter(
            self.temp.name, model_validator=FixtureValidator(), model_runner=FixtureRunner()
        )
        app = create_app(vision_adapter=OfflineVision(), vision_center=self.center, dev_mode=True)
        install_identity_env()
        # 完全沒有憑證的呼叫者（瀏覽器／任意本機程序）。
        self.anonymous = TestClient(app)
        # 合法學員：身分由 Assertion 帶入，不是本文欄位。
        self.student = signed_teacher_client(
            TestClient(app),
            subject=STUDENT_SUBJECT,
            role="student",
            enrollment_id=STUDENT_ENROLLMENT,
            cohort_ids=(COHORT_A,),
        )
        # 教師：既有契約的上傳路徑是 POST /api/v1/vision/models，不是本端點。
        self.teacher = signed_teacher_client(TestClient(app), subject="teacher-1", role="teacher")
        # 另一位學員（冒用測試用）。
        self.other_student = signed_teacher_client(
            TestClient(app),
            subject="S2",
            role="student",
            enrollment_id=12,
            cohort_ids=("COHORT-B",),
        )

    def tearDown(self):
        self.temp.cleanup()

    # -- helpers ---------------------------------------------------------
    def submission_count(self) -> int:
        return len(self.center.list_submissions())

    def assert_no_record_created(self, before: int):
        self.assertEqual(
            self.submission_count(),
            before,
            "未經授權的請求不得建立正式提交紀錄",
        )

    def error_code(self, response) -> str:
        try:
            return response.json()["error"]["code"]
        except Exception:  # pragma: no cover - 回應不是標準錯誤封包
            return f"<no-error-code:{response.text[:120]}>"


# ---------------------------------------------------------------- B6-1
class AnonymousSubmissionTests(_Base):
    def test_b6_1_anonymous_post_is_rejected_and_creates_no_record(self):
        """修復前：201 + 建出 sub-xxx；修復後：403 + 零紀錄。"""
        before = self.submission_count()
        response = self.anonymous.post(SUBMISSIONS_PATH, json=_submission_payload())
        self.assertIn(response.status_code, (401, 403), response.text)
        self.assert_no_record_created(before)

    def test_b6_2_anonymous_cannot_forge_identity_via_legacy_headers(self):
        """舊標頭 X-FDE-Role / X-FDE-Student-ID 一律不得成為授權來源。"""
        before = self.submission_count()
        response = self.anonymous.post(
            SUBMISSIONS_PATH,
            json=_submission_payload(),
            headers={
                "X-FDE-Role": "student",
                "X-FDE-Student-ID": STUDENT_SUBJECT,
                "X-FDE-Teacher-ID": "1",
            },
        )
        self.assertIn(response.status_code, (401, 403), response.text)
        self.assert_no_record_created(before)

    def test_b6_3_anonymous_cannot_forge_assertion_header(self):
        """自行捏造的 Assertion 字串不得通過。"""
        before = self.submission_count()
        response = self.anonymous.post(
            SUBMISSIONS_PATH,
            json=_submission_payload(),
            headers={"X-FDE-Live-Assertion": "v1.forged.signature"},
        )
        self.assertIn(response.status_code, (401, 403), response.text)
        self.assert_no_record_created(before)


# ---------------------------------------------------------------- B6-2
class ImpersonationTests(_Base):
    def test_b6_4_student_cannot_claim_another_student_id(self):
        """學員 S1 在本文寫 student_id=S2 → 必須拒絕且零紀錄。"""
        before = self.submission_count()
        response = self.student.post(SUBMISSIONS_PATH, json=_submission_payload(student_id="S2"))
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(self.error_code(response), "student_identity_mismatch")
        self.assert_no_record_created(before)

    def test_b6_5_student_cannot_post_for_another_students_growth_record(self):
        """以 S2 的身分提交 S1 的成長紀錄編號 → 身分不符即拒絕。"""
        before = self.submission_count()
        response = self.other_student.post(
            SUBMISSIONS_PATH,
            json=_submission_payload(student_id=STUDENT_SUBJECT, growth_record_id="77"),
        )
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(self.error_code(response), "student_identity_mismatch")
        self.assert_no_record_created(before)

    def test_b6_6_teacher_assertion_cannot_create_student_submission(self):
        """教師的既有契約是 /models（可帶 source_student_id）；本端點不收教師。"""
        before = self.submission_count()
        response = self.teacher.post(SUBMISSIONS_PATH, json=_submission_payload())
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(self.error_code(response), "student_assertion_required")
        self.assert_no_record_created(before)

    def test_b6_7_body_tampering_after_signing_is_rejected(self):
        """簽章綁 body：簽 A 送 B 必須被 body_tampered 擋下。"""
        before = self.submission_count()
        signed_body = json.dumps(_submission_payload()).encode("utf-8")
        tampered = json.dumps(_submission_payload(student_id="S2")).encode("utf-8")
        claims = {
            "sub": f"student:{STUDENT_SUBJECT}",
            "role": "student",
            "enrollment_id": STUDENT_ENROLLMENT,
            "cohort_ids": [COHORT_A],
            "method": "POST",
            "path": SUBMISSIONS_PATH,
            "body_sha256": live_assertions.body_sha256(signed_body),
        }
        token = live_assertions.issue_live_assertion(claims, DEFAULT_KEY)
        response = self.anonymous.post(
            SUBMISSIONS_PATH,
            content=tampered,
            headers={"Content-Type": "application/json", "X-FDE-Live-Assertion": token},
        )
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(self.error_code(response), "internal_auth_rejected")
        self.assert_no_record_created(before)


# ---------------------------------------------------------------- B6-3
class EnrollmentAndCohortTests(_Base):
    def test_b6_8_student_without_enrollment_is_rejected(self):
        """沒有 enrollment 的 Assertion 不得建立提交。

        兩層防線都會擋：信封層（``live_assertions`` 對 role=student 強制
        ``enrollment_id > 0``，故連簽都簽不出合法票）與端點層
        （``_student_identity`` 的 ``enrollment_required``）。這裡斷言的是
        **效果**：拒絕且零紀錄。
        """
        bare = signed_teacher_client(
            TestClient(create_app(vision_adapter=OfflineVision(), vision_center=self.center, dev_mode=True)),
            subject=STUDENT_SUBJECT,
            role="student",
            enrollment_id=0,
            cohort_ids=(),
        )
        before = self.submission_count()
        response = bare.post(SUBMISSIONS_PATH, json=_submission_payload())
        self.assertEqual(response.status_code, 403, response.text)
        self.assertIn(
            self.error_code(response), ("internal_auth_rejected", "enrollment_required"), response.text
        )
        self.assert_no_record_created(before)

    def test_b6_9_student_without_cohort_is_rejected(self):
        """有 enrollment 但沒有 cohort → 拒絕（Cohort 必須可驗）。"""
        no_cohort = signed_teacher_client(
            TestClient(create_app(vision_adapter=OfflineVision(), vision_center=self.center, dev_mode=True)),
            subject=STUDENT_SUBJECT,
            role="student",
            enrollment_id=STUDENT_ENROLLMENT,
            cohort_ids=(),
        )
        before = self.submission_count()
        response = no_cohort.post(SUBMISSIONS_PATH, json=_submission_payload())
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(self.error_code(response), "cohort_required")
        self.assert_no_record_created(before)


# ---------------------------------------------------------------- B6-4 正向
class LegitimateSubmissionTests(_Base):
    def test_b6_10_legitimate_student_submission_succeeds_with_asserted_identity(self):
        before = self.submission_count()
        response = self.student.post(SUBMISSIONS_PATH, json=_submission_payload())
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(self.submission_count(), before + 1)
        record = response.json()
        # 身分來自 Assertion，不是本文。
        self.assertEqual(record["student_id"], STUDENT_SUBJECT)
        self.assertEqual(record["enrollment_id"], STUDENT_ENROLLMENT)
        self.assertEqual(record["cohort_ids"], [COHORT_A])
        self.assertEqual(record["status"], "SUBMITTED")

    def test_b6_11_omitted_student_id_is_filled_from_assertion(self):
        """本文不帶 student_id 時，必須由 Assertion 補上（不得落成 unknown）。"""
        payload = _submission_payload()
        payload.pop("student_id")
        response = self.student.post(SUBMISSIONS_PATH, json=payload)
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["student_id"], STUDENT_SUBJECT)

    def test_b6_12_legit_submission_is_visible_to_teacher_list(self):
        created = self.student.post(SUBMISSIONS_PATH, json=_submission_payload())
        self.assertEqual(created.status_code, 201)
        listed = self.teacher.get(SUBMISSIONS_PATH)
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json()[0]["submission_id"], created.json()["submission_id"])
