"""R07 最小修復的契約測試（2026-10-20 教師指令）。

修復內容：`UltralyticsModelRunner.predict` 原本呼叫 `model.predict(source=image,
verbose=False)` 未傳 `conf=`，ultralytics 因此套用預設 conf=0.25，把低信心候選框
連同判定機會一起靜默過濾，即使模型實際有輸出，平台只回報 NO_DETECTION
（「模型未檢測到任何目標」）。

本檔以注入假 cv2／numpy／ultralytics 的方式，用「真實的
UltralyticsModelRunner.predict 程式碼路徑」證明：

1. YOLO 推論呼叫確實收到明確的候選框最低信心 `conf=CANDIDATE_BOX_MIN_CONF`
   （= 0.001），不再依赖 ultralytics 預設值。
2. 沒有任何候選框時才回報 NO_DETECTION（修復不會偽造框）。
3. 有候選框但低於教師門檻 → 如實回報 LOW_CONFIDENCE，不得標為通過。
4. 達到教師門檻 → 依既有契約判定（MATCH/MISMATCH/DETECTED）。
5. 推論例外 → 可追溯的 422 錯誤（不假通過）。
6. API 回應的模型 ID／版本／類別／信心／判定互相一致。

測試全部使用隔離臨時目錄，不觸碰正式資料、不切換 ACTIVE。
"""

import base64
import sys
import tempfile
import types
import unittest
from pathlib import Path

from p6_signed_client import legacy_header_client as TestClient

from app.main import create_app
from app.vision_center import (
    CANDIDATE_BOX_MIN_CONF,
    PROP_CLASSES,
    ModelValidationError,
    UltralyticsModelRunner,
    VisionCenter,
)


class _FakeArray:
    """模擬 numpy array 的最小切片子類。"""

    def __init__(self, values):
        self._values = list(values)

    def __getitem__(self, _index):
        return self._values[0]

    def tolist(self):
        return list(self._values)


class _FakeBox:
    def __init__(self, xyxy, cls, conf):
        self.xyxy = [_FakeArray(xyxy)]
        self.cls = _FakeArray([cls])
        self.conf = _FakeArray([conf])


class _FakePrediction:
    names = {0: "CW", 1: "CCW", 2: "CW", 3: "CCW"}

    def __init__(self, boxes):
        self.boxes = boxes


class RecordingUltralyticsModel:
    """記錄 predict 收到的所有 kwargs（證明 conf 是否顯式傳入）。"""

    def __init__(self, boxes=None, raise_exc=None):
        self.calls = []
        self._boxes = boxes if boxes is not None else []
        self._raise_exc = raise_exc

    def predict(self, **kwargs):
        self.calls.append(kwargs)
        if self._raise_exc is not None:
            raise self._raise_exc
        return [_FakePrediction(self._boxes)]


class RecordingYOLO:
    last_instance = None

    def __init__(self, key, task=None):
        self.key = key
        self.model = RecordingUltralyticsModel(
            boxes=RecordingYOLO.boxes,
            raise_exc=RecordingYOLO.raise_exc,
        )
        self.names = _FakePrediction([]).names
        RecordingYOLO.last_instance = self

    def predict(self, **kwargs):
        return self.model.predict(**kwargs)


RecordingYOLO.boxes = []
RecordingYOLO.raise_exc = None


def fake_cv2_module():
    module = types.ModuleType("cv2")
    module.IMREAD_COLOR = 1

    def _imdecode(_buffer, _flags):
        return "decoded-image"

    module.imdecode = _imdecode
    return module


def fake_numpy_module():
    module = types.ModuleType("numpy")
    module.uint8 = "uint8"

    def _frombuffer(_data, dtype=None):
        return b"buffer"

    module.frombuffer = _frombuffer
    return module


def fake_ultralytics_module():
    module = types.ModuleType("ultralytics")
    module.YOLO = RecordingYOLO
    return module


class FixtureValidator:
    def validate(self, _path, _model_type):
        return {
            "class_names": list(PROP_CLASSES),
            "task": "detect",
            "smoke_inference": True,
        }


class OfflineVision:
    async def health(self):
        return False


class CandidateFloorContractTests(unittest.TestCase):
    """以真實 UltralyticsModelRunner.predict 路徑驗證 conf 下限修復。"""

    def setUp(self):
        RecordingYOLO.boxes = []
        RecordingYOLO.raise_exc = None
        RecordingYOLO.last_instance = None
        root = Path(__file__).resolve().parents[2] / ".test-temp"
        root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=root)
        self.center = VisionCenter(
            self.temp.name, model_validator=FixtureValidator(), model_runner=UltralyticsModelRunner()
        )
        self.client = TestClient(
            create_app(vision_adapter=OfflineVision(), vision_center=self.center, dev_mode=True)
        )
        self.teacher = {"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": "teacher-1"}
        # 在 predict 內部 import cv2／numpy／ultralytics 之前置入假模組；
        # 先記下原本的快取內容，tearDown 精確還原（不誤刪真實模組）。
        self._saved_modules = {
            name: sys.modules.get(name) for name in ("cv2", "numpy", "ultralytics")
        }
        sys.modules["cv2"] = fake_cv2_module()
        sys.modules["numpy"] = fake_numpy_module()
        sys.modules["ultralytics"] = fake_ultralytics_module()

    def tearDown(self):
        for name, original in self._saved_modules.items():
            if original is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = original
        self.temp.cleanup()

    def upload(self):
        dataset = self.client.post(
            "/api/v1/vision/datasets",
            headers=self.teacher,
            json={"model_type": "PROP_DIRECTION", "dataset_version": "v1", "created_by": "ignored"},
        )
        self.assertEqual(dataset.status_code, 201)
        response = self.client.post(
            "/api/v1/vision/models",
            headers=self.teacher,
            json={
                "model_type": "PROP_DIRECTION",
                "model_name": "candidate-floor-fixture",
                "version": "v1",
                "file_name": "best.pt",
                "file_base64": base64.b64encode(b"fixture-pt").decode(),
                "dataset_id": dataset.json()["dataset_id"],
                "dataset_version": "v1",
                "rule_version": "r1",
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def validate_image(self, model_id, image_bytes, **extra):
        payload = {"image_base64": base64.b64encode(image_bytes).decode()}
        payload.update(extra)
        return self.client.post(
            f"/api/v1/vision/models/{model_id}/validate-image", headers=self.teacher, json=payload
        )

    # ---- 1. YOLO 推論呼叫確實收到明確的候選框最低信心 ----
    def test_predict_passes_explicit_candidate_floor(self):
        """UltralyticsModelRunner.predict 必須顯式傳入 conf=CANDIDATE_BOX_MIN_CONF。"""
        RecordingYOLO.boxes = [_FakeBox([10, 10, 30, 30], 0, 0.42)]
        runner = UltralyticsModelRunner()
        detections = runner.predict(Path("fake.pt"), b"image-bytes")
        fake_model = RecordingYOLO.last_instance.model
        self.assertEqual(len(fake_model.calls), 1)
        call = fake_model.calls[0]
        self.assertIn("conf", call, "predict 必須顯式提供 conf，不得依賴 ultralytics 預設 0.25")
        self.assertEqual(call["conf"], CANDIDATE_BOX_MIN_CONF)
        self.assertEqual(call["conf"], 0.001)
        self.assertEqual(call["source"], "decoded-image")
        self.assertIs(call["verbose"], False)
        # 偵測事實必須原樣流向呼叫端（不被修復改動）。
        self.assertEqual(len(detections), 1)
        self.assertEqual(detections[0]["class"], "CW")
        self.assertAlmostEqual(detections[0]["confidence"], 0.42, places=5)
        self.assertEqual(detections[0]["bbox"], [10, 10, 30, 30])

    # ---- 2. 沒有任何候選框時，才回報 NO_DETECTION ----
    def test_no_candidate_boxes_reports_no_detection(self):
        model = self.upload()
        RecordingYOLO.boxes = []
        body = self.validate_image(model["model_id"], b"image-bytes", expected_class="CW").json()
        self.assertEqual(body["detection_count"], 0)
        self.assertEqual(body["verdict"]["reason_code"], "NO_DETECTION")
        self.assertEqual(body["verdict"]["decision"], "INSUFFICIENT_DATA")
        self.assertIsNone(body["verdict"]["predicted_class"])

    # ---- 3. 有候選框但低於教師門檻 → LOW_CONFIDENCE，不得通過 ----
    def test_low_candidate_confidence_is_not_a_pass(self):
        model = self.upload()
        RecordingYOLO.boxes = [_FakeBox([10, 10, 30, 30], 0, 0.0071)]
        body = self.validate_image(model["model_id"], b"image-bytes", expected_class="CW").json()
        self.assertEqual(body["detection_count"], 1)
        self.assertEqual(body["verdict"]["reason_code"], "LOW_CONFIDENCE")
        self.assertEqual(body["verdict"]["decision"], "INSUFFICIENT_DATA")
        self.assertNotEqual(body["verdict"]["decision"], "MATCH")
        self.assertEqual(body["verdict"]["confidence_threshold"], 0.5)
        self.assertAlmostEqual(body["verdict"]["predicted_confidence"], 0.0071, places=5)

    # ---- 4. 達到教師門檻 → 依既有契約判定 ----
    def test_candidate_meets_teacher_threshold_is_judged(self):
        model = self.upload()
        RecordingYOLO.boxes = [_FakeBox([10, 10, 30, 30], 0, 0.93)]
        body = self.validate_image(model["model_id"], b"image-bytes", expected_class="CW").json()
        self.assertEqual(body["verdict"]["reason_code"], "OK")
        self.assertEqual(body["verdict"]["decision"], "MATCH")
        self.assertEqual(body["verdict"]["predicted_class"], "CW")

    def test_candidate_meets_threshold_but_wrong_class_is_mismatch(self):
        model = self.upload()
        RecordingYOLO.boxes = [_FakeBox([10, 10, 30, 30], 1, 0.93)]
        body = self.validate_image(model["model_id"], b"image-bytes", expected_class="CW").json()
        self.assertEqual(body["verdict"]["reason_code"], "CLASS_MISMATCH")
        self.assertEqual(body["verdict"]["decision"], "MISMATCH")

    # ---- 5. 推論例外 → 可追溯錯誤，不假通過 ----
    def test_inference_exception_is_traceable_error_not_fake_pass(self):
        model = self.upload()
        before = dict(self.center.get_model(model["model_id"]))
        RecordingYOLO.raise_exc = RuntimeError("boom")
        response = self.validate_image(model["model_id"], b"image-bytes", expected_class="CW")
        self.assertEqual(response.status_code, 422, response.text)
        body = response.json()
        self.assertEqual(body["error"]["code"], "image_validation_failed")
        self.assertNotIn("verdict", body)
        # 失敗的驗證探針不得對模型紀錄產生任何副作用（快照前後一致）。
        self.assertEqual(dict(self.center.get_model(model["model_id"])), before)

    # ---- 6. API 回應一致性：模型 ID／版本／類別／信心／判定 ----
    def test_api_response_fields_are_consistent(self):
        model = self.upload()
        RecordingYOLO.boxes = [_FakeBox([10, 10, 30, 30], 0, 0.93)]
        response = self.validate_image(model["model_id"], b"image-bytes", expected_class="CW")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["model"]["model_id"], model["model_id"])
        self.assertEqual(body["model"]["version"], model["version"])
        self.assertEqual(body["model"]["file_hash"], model["file_hash"])
        self.assertEqual(body["model"]["class_names"], list(PROP_CLASSES))
        self.assertEqual(body["detection_count"], 1)
        self.assertEqual(body["detections"][0]["class"], "CW")
        self.assertAlmostEqual(body["detections"][0]["confidence"], 0.93, places=5)
        self.assertEqual(
            body["verdict"]["predicted_confidence"],
            round(body["detections"][0]["confidence"], 6),
        )
        self.assertEqual(body["verdict"]["predicted_class"], body["detections"][0]["class"])
        self.assertEqual(body["verdict"]["expected_class"], "CW")
        self.assertEqual(body["validated_by"], "teacher-1")
        # 唯讀驗證不得改動 ACTIVE 指標。
        self.assertIsNone(self.center.active_model("PROP_DIRECTION"))


if __name__ == "__main__":
    unittest.main()
