"""Live Coach 教師端點：經真實身分中介層的正向流程與跨班、偽造拒絕。"""

import unittest

from starlette.testclient import TestClient

from app.live_assertions import issue_live_assertion
from app.main import create_app
from app.sessions import InMemorySessionStore


class OfflineVision:
    async def health(self):
        return False


class LiveCoachTeacherBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.assertion_key = "coach-isolated-assertion-key"
        self.proxy_key = "coach-isolated-proxy-key"
        self.client = TestClient(create_app(
            vision_adapter=OfflineVision(), session_store=InMemorySessionStore(), dev_mode=True,
            live_assertion_key=self.assertion_key, trusted_proxy_key=self.proxy_key, require_live_auth=True,
        ))
        created = self.client.post(
            "/api/live/sessions", json={"training_track": "F450_TWELVE_TASK"}, headers=self._student(),
        )
        self.assertEqual(created.status_code, 201)
        self.session_id = created.json()["session_id"]
        self.submissions = f"/api/live/sessions/{self.session_id}/training/model-submissions"
        self.review = f"/api/live/sessions/{self.session_id}/training/teacher-review"

    def _headers(self, claims):
        return {
            "X-FDE-Proxy-Auth": self.proxy_key,
            "X-FDE-Live-Assertion": issue_live_assertion(claims, self.assertion_key),
        }

    def _student(self, subject="student:101", enrollment_id=201, cohort="cohort-a"):
        return self._headers({"sub": subject, "role": "student", "enrollment_id": enrollment_id, "cohort_ids": [cohort]})

    def _teacher(self, cohort="cohort-a"):
        return self._headers({"sub": "teacher:7", "role": "teacher", "cohort_ids": [cohort]})

    def test_same_cohort_teacher_can_list_submissions(self):
        response = self.client.get(self.submissions, headers=self._teacher())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["model_submissions"], [])

    def test_same_cohort_teacher_reaches_review_validation(self):
        response = self.client.post(self.review, json={"task_id": "T01", "decision": "bad"}, headers=self._teacher())
        self.assertNotIn(response.status_code, (401, 403))

    def test_other_cohort_teacher_refused(self):
        response = self.client.get(self.submissions, headers=self._teacher("cohort-b"))
        self.assertIn(response.status_code, (403, 404))

    def test_other_cohort_teacher_cannot_review(self):
        response = self.client.post(self.review, json={"task_id": "T01", "decision": "PASS"}, headers=self._teacher("cohort-b"))
        self.assertIn(response.status_code, (403, 404))

    def test_student_refused_on_teacher_route(self):
        response = self.client.get(self.submissions, headers=self._student())
        self.assertEqual(response.status_code, 403)

    def test_other_owner_student_refused(self):
        response = self.client.get(
            f"/api/live/sessions/{self.session_id}", headers=self._student("student:102", 202),
        )
        self.assertIn(response.status_code, (403, 404))

    def test_unsigned_request_refused(self):
        self.assertIn(self.client.get(self.submissions).status_code, (401, 403))

    def test_forged_role_header_refused(self):
        response = self.client.get(self.submissions, headers={"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": "7"})
        self.assertIn(response.status_code, (401, 403))

    def test_proxy_key_without_assertion_refused(self):
        response = self.client.get(self.submissions, headers={"X-FDE-Proxy-Auth": self.proxy_key, "X-FDE-Role": "teacher"})
        self.assertEqual(response.status_code, 401)

    def test_assertion_signed_with_wrong_key_refused(self):
        forged = issue_live_assertion({"sub": "teacher:7", "role": "teacher", "cohort_ids": ["cohort-a"]}, "wrong-key")
        response = self.client.get(self.submissions, headers={"X-FDE-Proxy-Auth": self.proxy_key, "X-FDE-Live-Assertion": forged})
        self.assertEqual(response.status_code, 401)
