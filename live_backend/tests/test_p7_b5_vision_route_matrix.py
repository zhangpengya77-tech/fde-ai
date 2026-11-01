"""P7-B5 驗收：`/api/v1/vision/*` 的逐路由權限矩陣。

批准令要求：
* 先列出所有 `/api/v1/vision/*` 路由與 Method；
* 建立逐路由權限矩陣（公開可讀／學員已驗證／教師已驗證／教師所屬班級／管理員／
  僅內部服務）；
* 任何建立、修改、導入、刪除、審核、啟用資料的端點，**預設都要求授權**；
* **不得**用單一新增前綴取代逐路由驗證。

本檔的矩陣是「可執行的規格」：任何新增路由若沒被歸類，測試就會失敗，強迫補上
分類與授權，避免又退化成「一個前綴打天下」。
"""

from __future__ import annotations

import base64
import tempfile
import unittest
from pathlib import Path

from starlette.testclient import TestClient

from app.main import create_app
from app.vision_api import vision_routes
from app.vision_center import HOVER_CLASSES, PROP_CLASSES, VisionCenter
from p6_signed_client import install_identity_env, signed_teacher_client


# ---------------------------------------------------------------- 權限矩陣
# public_read         : 任何人可讀，且不得含學員個資
# student_or_teacher  : 需已驗證身分（學員手機端要用）
# teacher             : 需教師身分
# teacher_cohort      : 需教師身分，且資料需落在其班級範圍（由 Django 端過濾）
# internal_only       : 只允許內部服務（由斷言／代理金鑰保護）
MATRIX = {
    ("/api/v1/vision/models", "GET"): "public_read",
    ("/api/v1/vision/models", "POST"): "teacher",
    ("/api/v1/vision/models/{model_id}", "GET"): "public_read",
    ("/api/v1/vision/models/{model_id}/evaluate", "POST"): "teacher",
    ("/api/v1/vision/models/{model_id}/activate", "POST"): "teacher",
    ("/api/v1/vision/models/{model_id}/archive", "POST"): "teacher",
    ("/api/v1/vision/models/{model_id}/validate-image", "POST"): "teacher",
    ("/api/v1/vision/models/{model_id}/golden-sets", "GET"): "teacher",
    ("/api/v1/vision/tasks/{model_type}/history", "GET"): "teacher",
    ("/api/v1/vision/tasks/{model_type}/rollback", "POST"): "teacher",
    ("/api/v1/vision/prop-check", "GET"): "public_read",
    ("/api/v1/vision/prop-check", "POST"): "student_or_teacher",
    ("/api/v1/vision/hover-analyze", "POST"): "student_or_teacher",
    ("/api/v1/vision/hover-video", "POST"): "student_or_teacher",
    ("/api/v1/vision/datasets", "GET"): "teacher",
    ("/api/v1/vision/datasets", "POST"): "teacher",
    ("/api/v1/vision/datasets/{dataset_id}/build-next", "POST"): "teacher",
    ("/api/v1/vision/datasets/{dataset_id}/quarantine", "POST"): "teacher",
    ("/api/v1/vision/datasets/{dataset_id}/export", "GET"): "teacher",
    ("/api/v1/vision/hard-examples", "GET"): "teacher",
    ("/api/v1/vision/hard-examples/{sample_id}/review", "POST"): "teacher",
    ("/api/v1/vision/camera-profiles", "POST"): "teacher",
    ("/api/v1/vision/submissions", "GET"): "teacher",
    ("/api/v1/vision/submissions", "POST"): "student_or_teacher",
    ("/api/v1/vision/submissions/{submission_id}", "DELETE"): "teacher",
    ("/api/v1/vision/submissions/{submission_id}/import-preflight", "POST"): "teacher",
    ("/api/v1/vision/submissions/{submission_id}/import", "POST"): "teacher",
    ("/api/v1/vision/submissions/{submission_id}/import-failure", "POST"): "teacher",
    ("/api/v1/vision/submissions/{submission_id}/validate-image", "POST"): "teacher",
    ("/api/v1/vision/golden-sets", "GET"): "teacher",
    ("/api/v1/vision/golden-sets", "POST"): "teacher",
    ("/api/v1/vision/golden-sets/{golden_set_id}", "GET"): "teacher",
    ("/api/v1/vision/models/{model_id}/restore", "POST"): "teacher",
    ("/api/v1/vision/models/{model_id}/delete", "POST"): "teacher",
    ("/api/v1/vision/models/{model_id}/seed", "POST"): "teacher",
    ("/api/v1/vision/models/{model_id}/unseed", "POST"): "teacher",
    ("/api/v1/vision/tasks/{model_type}/recommended-seed", "GET"): "student_or_teacher",
    ("/api/v1/vision/tasks/{model_type}/seed-version-chain", "GET"): "student_or_teacher",
    ("/api/v1/vision/seed/download", "GET"): "student_or_teacher",
    ("/api/v1/vision/rotation-v5/status", "GET"): "student_or_teacher",
    ("/api/v1/vision/rotation-v5/infer", "POST"): "student_or_teacher",
    ("/api/v1/vision/rotation-v5/teacher/validate-image", "POST"): "teacher",
    ("/api/v1/vision/rotation-v5/teacher/validations/{validation_id}/confirm", "POST"): "teacher",
    ("/api/v1/vision/rotation-v5/teacher/enable-trial", "POST"): "teacher_cohort",
    ("/api/v1/vision/rotation-v5/teacher/withdraw-trial", "POST"): "teacher",
    ("/api/v1/vision/rotation-v5/teacher/activate-isolated", "POST"): "teacher",
}

# 「會建立／修改／導入／刪除／審核／啟用資料」的方法：一律不得是 public_read。
MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


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


class RouteInventoryTests(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parents[2] / ".test-temp"
        root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=root)
        self.center = VisionCenter(
            self.temp.name, model_validator=FixtureValidator(), model_runner=FixtureRunner()
        )

    def tearDown(self):
        self.temp.cleanup()

    def _inventory(self):
        found = set()
        for route in vision_routes(self.center):
            for method in route.methods or []:
                # Starlette 會為每個 GET 路由自動補上 HEAD；矩陣只列業務方法。
                if method == "HEAD":
                    continue
                found.add((route.path, method))
        return found

    def test_b5_1_every_route_is_classified(self):
        inventory = self._inventory()
        missing = sorted(inventory - set(MATRIX))
        stale = sorted(set(MATRIX) - inventory)
        self.assertEqual(missing, [], f"新路由未在權限矩陣中分類：{missing}")
        self.assertEqual(stale, [], f"矩陣含已不存在的路由：{stale}")

    def test_b5_2_no_mutating_route_is_publicly_readable(self):
        offenders = [
            (path, method, MATRIX[(path, method)])
            for (path, method) in MATRIX
            if method in MUTATING_METHODS and MATRIX[(path, method)] == "public_read"
        ]
        self.assertEqual(offenders, [], f"會改資料的端點不得公開：{offenders}")

    def test_b5_3_public_reads_are_limited_to_model_catalogue_and_demo_status(self):
        public = sorted({path for (path, _m), kind in MATRIX.items() if kind == "public_read"})
        self.assertEqual(
            public,
            [
                "/api/v1/vision/models",
                "/api/v1/vision/models/{model_id}",
                "/api/v1/vision/prop-check",
            ],
            "公開可讀清單若有變動，必須在報告與本測試中明確說明理由",
        )


class UnauthenticatedAccessTests(unittest.TestCase):
    """沒有 Assertion 的呼叫者：公開可讀可用，其餘一律拒絕。"""

    def setUp(self):
        root = Path(__file__).resolve().parents[2] / ".test-temp"
        root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=root)
        self.center = VisionCenter(
            self.temp.name, model_validator=FixtureValidator(), model_runner=FixtureRunner()
        )
        app = create_app(vision_adapter=OfflineVision(), vision_center=self.center, dev_mode=True)
        install_identity_env()
        self.anonymous = TestClient(app)
        self.teacher = signed_teacher_client(TestClient(app), subject="teacher-1", role="teacher")
        self.student = signed_teacher_client(
            TestClient(app), subject="S1", role="student", enrollment_id=21, cohort_ids=("2026-01",)
        )

    def tearDown(self):
        self.temp.cleanup()

    def test_b5_4_public_reads_work_without_identity(self):
        self.assertEqual(self.anonymous.get("/api/v1/vision/models").status_code, 200)
        self.assertEqual(self.anonymous.get("/api/v1/vision/prop-check").status_code, 200)

    def test_b5_5_hover_analyze_requires_identity(self):
        response = self.anonymous.post("/api/v1/vision/hover-analyze", json={"frames": []})
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(response.json()["error"]["code"], "internal_auth_rejected")

    def test_b5_6_hover_video_requires_identity(self):
        response = self.anonymous.post(
            "/api/v1/vision/hover-video",
            json={"file_name": "x.mp4", "file_base64": base64.b64encode(b"v").decode()},
        )
        self.assertEqual(response.status_code, 403, response.text)

    def test_b5_7_prop_check_post_requires_identity(self):
        response = self.anonymous.post(
            "/api/v1/vision/prop-check",
            json={
                "detections": [],
                "image_width": 100,
                "image_height": 100,
            },
        )
        self.assertEqual(response.status_code, 403, response.text)

    def test_b5_8_teacher_only_route_rejects_anonymous(self):
        for path in (
            "/api/v1/vision/datasets",
            "/api/v1/vision/hard-examples",
            "/api/v1/vision/golden-sets",
            "/api/v1/vision/submissions",
        ):
            with self.subTest(path=path):
                self.assertEqual(self.anonymous.get(path).status_code, 403)

    def test_b5_9_student_cannot_reach_teacher_routes(self):
        self.assertEqual(self.student.get("/api/v1/vision/datasets").status_code, 403)
        self.assertEqual(self.student.get("/api/v1/vision/hard-examples").status_code, 403)

    def test_b5_10_student_can_use_inference_with_identity(self):
        response = self.student.post(
            "/api/v1/vision/prop-check",
            json={"detections": [], "image_width": 100, "image_height": 100},
        )
        self.assertEqual(response.status_code, 200, response.text)

    def test_b5_11_teacher_can_use_inference_with_identity(self):
        response = self.teacher.post(
            "/api/v1/vision/prop-check",
            json={"detections": [], "image_width": 100, "image_height": 100},
        )
        self.assertEqual(response.status_code, 200, response.text)
