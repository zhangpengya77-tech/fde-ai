import json
import tempfile
import unittest
from pathlib import Path

from starlette.testclient import TestClient

from app.benchmark import (
    HOVER_CLASS_CONTRACT,
    PROP_CLASS_CONTRACT,
    BenchmarkPolicy,
    BenchmarkStatus,
    PropBenchmarkSandbox,
    PropValidationSet,
    runtime_status,
)
from app.main import create_app
from app.rag import RAGResult
from app.sessions import InMemorySessionStore
from app.vision import VisionResult


class FakeVision:
    async def health(self):
        return True

    async def detect(self, image_data, file_name, confidence):
        return VisionResult([], 1.0, {})


class FakeRAG:
    async def query(self, question, request_id, context_version):
        return RAGResult("online", "ctx", None, None, 1.0, True, None, request_id, context_version, "rag")


class FakeCenter:
    """P1-2 測試用占位；不觸發 Vision Center 磁碟行為。"""


class FakeModel:
    """模擬 YOLO 模型：僅提供類別名稱，不涉及真實推理。"""

    def __init__(self, names):
        self.names = names


class FakeValidationSet:
    """模擬 PROP 標準驗證集介面。"""

    def __init__(self, available=True, version="PROP_GOLDEN_V1"):
        self.version = version
        self._available = available

    def available(self):
        return self._available

    @property
    def manifest_path(self):
        return Path("manifest.json")


PROP_METRICS = {
    "precision": 0.91, "recall": 0.88, "map50": 0.93,
    "map50_95": 0.71, "inference_time_ms": 12.3, "per_class": {},
}


class P1_2BenchmarkTests(unittest.TestCase):
    def setUp(self):
        self.store = InMemorySessionStore()
        # 注入 runtime_probe=ready：測試環境不裝 ultralytics/torch，
        # 若用真實 runtime_status() 會在 runtime gate 直接判 MODEL_LOAD_FAILED，
        # 導致原有契約/指標測試無法到達預期分支。
        self.sandbox = PropBenchmarkSandbox(
            model_loader=lambda ref: FakeModel(list(PROP_CLASS_CONTRACT)),
            validation_set=FakeValidationSet(available=False),
            evaluator=lambda model, vset: dict(PROP_METRICS),
            runtime_probe=lambda: {"ultralytics": "AVAILABLE", "torch": "AVAILABLE", "ready": True},
        )
        self.client = TestClient(create_app(
            vision_adapter=FakeVision(), rag_adapter=FakeRAG(),
            session_store=self.store, dev_mode=True,
            vision_center=FakeCenter(), benchmark_sandbox=self.sandbox,
        ))
        self.sid = self.client.post(
            "/api/live/sessions", json={"mode": "demo", "training_track": "F450_TWELVE_TASK"}
        ).json()["session_id"]
        self.teacher_headers = {"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": "MOCK_TEACHER"}

    # 建立 submission 並（可選）核准為 APPROVED_FOR_BENCHMARK
    def submit(self, approve=True, filename="best.pt"):
        evidence = self.client.post(
            f"/api/live/sessions/{self.sid}/training/evidence",
            json={"evidence_type": "YOLO_MODEL", "source": "STUDENT_UPLOAD",
                  "file_reference": f"dev-upload://{filename}",
                  "metadata": {"model_filename": filename, "model_task_type": "PROP_DETECTION", "size_bytes": 12345}},
        ).json()["evidence"]
        if approve:
            self.client.post(
                f"/api/live/sessions/{self.sid}/training/model-submissions/{evidence['evidence_id']}/review",
                headers=self.teacher_headers, json={"decision": "APPROVED_FOR_BENCHMARK", "note": ""},
            )
        return evidence["evidence_id"]

    def run_benchmark(self, evidence_id, headers=None):
        return self.client.post(
            f"/api/live/sessions/{self.sid}/training/model-submissions/{evidence_id}/benchmark",
            headers=headers or self.teacher_headers,
        )

    # 1. 只有 APPROVED_FOR_BENCHMARK 才能啟動驗證
    def test_only_approved_can_start_benchmark(self):
        evidence_id = self.submit(approve=False)
        response = self.run_benchmark(evidence_id)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"]["code"], "invalid_benchmark_stage")

    def test_rejected_submission_cannot_start_benchmark(self):
        evidence_id = self.submit(approve=False)
        self.client.post(
            f"/api/live/sessions/{self.sid}/training/model-submissions/{evidence_id}/review",
            headers=self.teacher_headers, json={"decision": "REJECTED", "note": "x"},
        )
        self.assertEqual(self.run_benchmark(evidence_id).status_code, 409)

    def test_student_cannot_start_benchmark(self):
        evidence_id = self.submit(approve=True)
        response = self.run_benchmark(evidence_id, headers={"X-FDE-Role": "student"})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "teacher_authority_required")

    # 2. 錯誤類別 → INCOMPATIBLE_CLASSES
    def test_incompatible_classes(self):
        self.sandbox._load_model = lambda ref: FakeModel(["cw_propeller", "ccw_propeller"])
        evidence_id = self.submit()
        benchmark = self.run_benchmark(evidence_id).json()["benchmark"]
        self.assertEqual(benchmark["status"], BenchmarkStatus.INCOMPATIBLE_CLASSES.value)
        self.assertEqual(benchmark["model_classes"], ["cw_propeller", "ccw_propeller"])

    def test_old_generic_classes_rejected(self):
        self.sandbox._load_model = lambda ref: FakeModel(["无人机", "motor"])
        evidence_id = self.submit()
        benchmark = self.run_benchmark(evidence_id).json()["benchmark"]
        self.assertEqual(benchmark["status"], BenchmarkStatus.INCOMPATIBLE_CLASSES.value)

    # 3. 正確 PROP 類別 → 通過 Contract Check
    def test_correct_prop_classes_pass_contract(self):
        evidence_id = self.submit()
        benchmark = self.run_benchmark(evidence_id).json()["benchmark"]
        self.assertEqual(benchmark["model_classes"], list(PROP_CLASS_CONTRACT))
        self.assertNotEqual(benchmark["status"], BenchmarkStatus.INCOMPATIBLE_CLASSES.value)

    # 4. 模型載入失敗 → MODEL_LOAD_FAILED
    def test_model_load_failed(self):
        def broken_loader(ref):
            raise RuntimeError("boom")

        self.sandbox._load_model = broken_loader
        evidence_id = self.submit()
        benchmark = self.run_benchmark(evidence_id).json()["benchmark"]
        self.assertEqual(benchmark["status"], BenchmarkStatus.MODEL_LOAD_FAILED.value)

    # 5. 沒有 Golden Set → WAITING_FOR_GOLDEN_SET（不偽造 PASS）
    def test_waiting_for_golden_set(self):
        evidence_id = self.submit()
        benchmark = self.run_benchmark(evidence_id).json()["benchmark"]
        self.assertEqual(benchmark["status"], BenchmarkStatus.WAITING_FOR_GOLDEN_SET.value)
        self.assertEqual(benchmark["metrics"], {})
        self.assertFalse(self.run_benchmark(evidence_id).json()["validation_set"]["available"])

    # 6. 有測試集時能保存 metrics
    def test_metrics_saved_with_validation_set(self):
        self.sandbox._validation_set = FakeValidationSet(available=True)
        evidence_id = self.submit()
        benchmark = self.run_benchmark(evidence_id).json()["benchmark"]
        self.assertEqual(benchmark["metrics"]["precision"], 0.91)
        self.assertEqual(benchmark["metrics"]["map50"], 0.93)
        self.assertEqual(benchmark["metrics"]["inference_time_ms"], 12.3)
        # 門檻未設定（NOT_CONFIGURED）→ REVIEW_REQUIRED，不自動 PASS
        self.assertEqual(benchmark["status"], BenchmarkStatus.REVIEW_REQUIRED.value)

    def test_policy_configured_decides_pass_and_fail(self):
        self.sandbox._validation_set = FakeValidationSet(available=True)
        evidence_id = self.submit()
        self.sandbox._policy = BenchmarkPolicy(min_precision=0.9, min_recall=0.85, min_map50=0.9)
        self.assertEqual(self.run_benchmark(evidence_id).json()["benchmark"]["status"], BenchmarkStatus.PASS.value)
        self.sandbox._policy = BenchmarkPolicy(min_precision=0.99, min_recall=0.99, min_map50=0.99)
        self.assertEqual(self.run_benchmark(evidence_id).json()["benchmark"]["status"], BenchmarkStatus.FAIL.value)
        # 同一 submission 可重複 Benchmark，保留歷史
        self.assertEqual(len(self.sandbox.history(evidence_id)), 2)

    # 7. Benchmark 不改變 Production
    def test_benchmark_does_not_change_production(self):
        self.sandbox._validation_set = FakeValidationSet(available=True)
        evidence_id = self.submit()
        body = self.run_benchmark(evidence_id).json()
        submission = body["submission"]
        self.assertEqual(submission["metadata"]["model_status"], "APPROVED_FOR_BENCHMARK")
        for forbidden in ("PRODUCTION", "ACTIVE", "DEPLOYED"):
            self.assertNotIn(forbidden, submission["metadata"]["model_status"])
            self.assertNotIn(forbidden, body["benchmark"]["status"])

    # 8. Benchmark 不呼叫 A06
    def test_benchmark_does_not_call_a06(self):
        self.sandbox._validation_set = FakeValidationSet(available=True)
        evidence_id = self.submit()
        body = self.run_benchmark(evidence_id).json()
        payload = str(body).lower()
        self.assertNotIn("a06", payload)
        self.assertNotIn("deploy", payload)
        self.assertNotIn("production", payload)

    # 9. 不會碰 Hover
    def test_benchmark_does_not_touch_hover(self):
        self.sandbox._validation_set = FakeValidationSet(available=True)
        evidence_id = self.submit()
        benchmark = self.run_benchmark(evidence_id).json()["benchmark"]
        self.assertEqual(benchmark["model_classes"], list(PROP_CLASS_CONTRACT))
        self.assertNotEqual(tuple(benchmark["model_classes"]), HOVER_CLASS_CONTRACT)
        self.assertNotIn("HOVER", benchmark["validation_set_version"])
        self.assertIn("PROP", benchmark["validation_set_version"])


class P1_2_5RealReadinessTests(unittest.TestCase):
    """P1-2.5 真實 Benchmark 就緒度：只驗證真實磁碟與執行環境，不偽造。

    核心原則：
    - 真實執行環境（ultralytics/torch）缺失 → 不得執行模型，直接 MODEL_LOAD_FAILED。
    - 真實標準驗證集未凍結 / 未教師確認 / 無真實樣本 → 不得 available()，不偽造 PASS。
    - Golden Set 一旦凍結，訓練 / Hard Example 不得回流寫入（available 恆須 frozen+TEACHER_CONFIRMED）。
    """

    def _make_validation_dir(self, contract=None, frozen=False, review_status="NOT_REVIEWED", images=0):
        root = Path(tempfile.mkdtemp())
        manifest = {
            "validation_set_id": "PROP_GOLDEN",
            "version": "PROP_GOLDEN_V1",
            "class_contract": list(contract or PROP_CLASS_CONTRACT),
            "class_contract_version": "PROP_V1",
            "frozen": frozen,
            "review_status": review_status,
            "image_count": images,
        }
        (root / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
        images_dir = root / "images"
        images_dir.mkdir()
        for i in range(images):
            (images_dir / f"img_{i}.jpg").write_bytes(b"\x00")
        (root / "labels").mkdir()
        return root

    def _ready_probe(self):
        return {"ultralytics": "AVAILABLE", "torch": "AVAILABLE", "ready": True}

    def _missing_probe(self):
        return {"ultralytics": "MISSING", "torch": "MISSING", "ready": False}

    # 1. 真實磁碟上的 PROP 標準驗證集（validation_sets/prop）狀態確認
    def test_real_disk_validation_set_is_blocked(self):
        vs = PropValidationSet()  # 預設指向 D:/FDE-AI-UAS-v2.0/validation_sets/prop
        self.assertEqual(vs.validation_set_id, "PROP_GOLDEN")
        # manifest 宣告的契約正確（邏輯層 PASS）
        self.assertTrue(vs.contract_ok())
        # 但實際無真實樣本、未凍結、未教師確認 → 不可用
        self.assertEqual(vs.image_count(), 0)
        self.assertFalse(vs.frozen)
        self.assertEqual(vs.review_status, "BLOCKED_NO_REAL_SAMPLES")
        self.assertFalse(vs.available())

    # 2. 真實執行環境缺失 → 不執行模型
    def test_missing_runtime_blocks_model_execution(self):
        called = []
        sandbox = PropBenchmarkSandbox(
            model_loader=lambda ref: called.append(ref) or FakeModel(list(PROP_CLASS_CONTRACT)),
            validation_set=FakeValidationSet(available=True),
            evaluator=lambda model, vset: dict(PROP_METRICS),
            runtime_probe=self._missing_probe,
        )
        submission = {"evidence_id": "ev-1", "file_reference": "dev-upload://best.pt"}
        result = sandbox.run(submission, "MOCK_TEACHER")
        self.assertEqual(result["status"], BenchmarkStatus.MODEL_LOAD_FAILED.value)
        self.assertEqual(called, [], "runtime 缺失時不得載入/執行模型")
        self.assertEqual(result["runtime_version"], "ultralytics=MISSING;torch=MISSING")

    # 3. 真實執行環境就緒 + 可用驗證集 → 才產生真實指標
    def test_runtime_ready_and_available_set_produces_metrics(self):
        root = self._make_validation_dir(frozen=True, review_status="TEACHER_CONFIRMED", images=2)
        sandbox = PropBenchmarkSandbox(
            model_loader=lambda ref: FakeModel(list(PROP_CLASS_CONTRACT)),
            validation_set=PropValidationSet(root),
            evaluator=lambda model, vset: dict(PROP_METRICS),
            runtime_probe=self._ready_probe,
        )
        self.assertTrue(sandbox.validation_set_status()["available"])
        submission = {"evidence_id": "ev-2", "file_reference": "dev-upload://best.pt"}
        result = sandbox.run(submission, "MOCK_TEACHER")
        self.assertNotEqual(result["status"], BenchmarkStatus.MODEL_LOAD_FAILED.value)
        self.assertEqual(result["metrics"]["precision"], 0.91)
        self.assertEqual(result["validation_set_version"], "PROP_GOLDEN_V1")
        # 門檻未設定（NOT_CONFIGURED）→ REVIEW_REQUIRED，不自動 PASS
        self.assertEqual(result["status"], BenchmarkStatus.REVIEW_REQUIRED.value)

    # 4. Golden Set 凍結原則：未凍結即便有樣本也不可用（禁止訓練/Hard Example 回流）
    def test_not_frozen_never_available(self):
        root = self._make_validation_dir(frozen=False, review_status="TEACHER_CONFIRMED", images=3)
        vs = PropValidationSet(root)
        self.assertTrue(vs.contract_ok())
        self.assertEqual(vs.image_count(), 3)
        self.assertFalse(vs.available(), "未凍結不得 available，訓練/Hard Example 不得寫回")

    def test_not_teacher_confirmed_never_available(self):
        root = self._make_validation_dir(frozen=True, review_status="BLOCKED_NO_REAL_SAMPLES", images=3)
        self.assertFalse(PropValidationSet(root).available())

    def test_empty_images_never_available(self):
        root = self._make_validation_dir(frozen=True, review_status="TEACHER_CONFIRMED", images=0)
        self.assertFalse(PropValidationSet(root).available())

    # 5. 舊類別契約（cw_propeller/ccw_propeller）嚴格拒絕
    def test_old_class_contract_rejected(self):
        root = self._make_validation_dir(
            contract=["cw_propeller", "ccw_propeller"], frozen=True,
            review_status="TEACHER_CONFIRMED", images=1,
        )
        vs = PropValidationSet(root)
        self.assertFalse(vs.contract_ok(), "舊 cw_propeller/ccw_propeller 契約不得通過")
        self.assertFalse(vs.available())

    # 6. 真實環境探測：測試 venv 內 ultralytics/torch 缺失
    def test_runtime_status_missing_in_test_env(self):
        status = runtime_status()
        self.assertIn(status["ultralytics"], ("MISSING", "AVAILABLE"))
        self.assertIn(status["torch"], ("MISSING", "AVAILABLE"))
        # 若兩者皆缺失，則不得 ready（CI / 測試環境通常不裝）
        if status["ultralytics"] == "MISSING" or status["torch"] == "MISSING":
            self.assertFalse(status["ready"])


if __name__ == "__main__":
    unittest.main()
