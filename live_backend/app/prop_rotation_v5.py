"""PROP_ROTATION_V5 的隔離教學試用 Registry。

此模組刻意不接觸既有 PROP_DIRECTION 四類模型 Registry。它只保存已核對
SHA-256 的 F450 CW/CCW V5 來源，以及教師對真實圖片推論結果的人工確認。
沒有獨立 Golden Test 時，模型只能進入 TEACHING_TRIAL，不能成為 ACTIVE。

2026-11-03（V1.0 教學測試版 SOP）：另可登記 V6 為 TEST 教學測試模型。TEST 模型只在
隔離測試環境使用，啟用後狀態為 TEST（不是 TEACHING_TRIAL），永遠不得進入 ACTIVE／ACTIVE_ISOLATED，
也不觸碰正式 ACTIVE 模型；V6 測試組 mAP50 0.565 未達門檻。

2026-11-04 教師指令：先讓驗證流程通過，mAP50 啟用門檻由 0.600 調為 0.58（可用環境變數
FDE_PROP_ROTATION_MAP50_THRESHOLD 調整）。V7（測試組 mAP50 0.585）登記時即以固定測試組成績
作為獨立 Golden Test 證據，達門檻者可由教師設為 ACTIVE_ISOLATED。
"""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4


PROP_ROTATION_V5 = "PROP_ROTATION_V5"
V5_MODEL_SHA256 = "911228ff2c1019701e3409c51b767e359871418f501941f00746434cfcd7352c"
V5_CLASS_NAMES = ("CW", "CCW")
V6_TEST_MODEL_SHA256 = "f4ad9b01fb4dbaa6954a9d602606eca39e4c9fc0596940b397dcfb2a7828b5bf"
V7_MODEL_SHA256 = "93503064f312ef0b0d77a6145a72e61fe1177bbeec54488e2e5c4a2a0a3701ea"
DEFAULT_MAP50_THRESHOLD = 0.58
TRIAL_STATUSES = ("PENDING_TEACHER_VALIDATION", "TEACHING_TRIAL", "TEST", "ACTIVE_ISOLATED")
# 可登記的模型（SHA-256 → 固定 metadata）。test_only 的模型只能啟用為 TEST。
MODEL_SPECS = {
    V5_MODEL_SHA256: {
        "model_id": "ROTATION_V5_20261027", "model_name": "F450 CW／CCW V5",
        "version": "v5_finetune_20261027_101500", "test_only": False,
    },
    V6_TEST_MODEL_SHA256: {
        "model_id": "ROTATION_V6_TEST_20261103", "model_name": "F450 CW／CCW V6（教學測試版）",
        "version": "v6_final_all_20261103_204027", "test_only": True,
        "test_map50": 0.565,
    },
    V7_MODEL_SHA256: {
        "model_id": "ROTATION_V7_20261103", "model_name": "F450 CW／CCW V7",
        "version": "v7_final_all_20261103_221118", "test_only": False,
        # 固定測試組 15 張（V6 測試組＋使用者測試圖，與訓練／驗證組隔離）。
        "test_map50": 0.585, "golden_test_set": "F450_final_test_15",
    },
}


def map50_threshold() -> float:
    """模型啟用的 mAP50 門檻：環境變數 > 預設 0.58。"""
    try:
        return float(os.environ.get("FDE_PROP_ROTATION_MAP50_THRESHOLD", DEFAULT_MAP50_THRESHOLD))
    except ValueError:
        return DEFAULT_MAP50_THRESHOLD


class PropRotationTrialError(ValueError):
    """雙類旋向教學試用契約遭拒時的安全錯誤。"""


def _utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class PropRotationTrialRegistry:
    """隔離 Registry；每一次變更均以同目錄 replace 原子寫入。"""

    def __init__(self, root: Path | str):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.path = self.root / "prop_rotation_v5_trial.json"
        self.data = self._load()

    @staticmethod
    def _empty() -> dict:
        return {"schema_version": 1, "models": [], "validations": [], "audit": []}

    def _load(self) -> dict:
        if not self.path.exists():
            return self._empty()
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise PropRotationTrialError("trial_registry_unreadable") from exc
        if not isinstance(data, dict):
            raise PropRotationTrialError("trial_registry_invalid")
        baseline = self._empty()
        baseline.update(data)
        return baseline

    def _save(self) -> None:
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(self.data, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temporary, self.path)

    def _refresh(self) -> None:
        """每次操作前重新讀取檔案，避免長駐 Gateway 以舊快照覆寫教師審核。"""
        self.data = self._load()

    def _find(self, model_id: str) -> dict:
        for item in self.data["models"]:
            if item.get("model_id") == model_id:
                return item
        raise PropRotationTrialError("rotation_trial_model_not_found")

    def register_verified_model(
        self, *, model_path: str, model_sha256: str, class_names: list[str], source: str,
    ) -> dict:
        """登記 MODEL_SPECS 中指定檔案的 immutable metadata；不載入任何 checkpoint。"""
        self._refresh()
        sha256 = str(model_sha256).lower()
        spec = MODEL_SPECS.get(sha256)
        if spec is None:
            raise PropRotationTrialError("model_sha256_mismatch")
        if tuple(str(name) for name in class_names) != V5_CLASS_NAMES:
            raise PropRotationTrialError("class_contract_mismatch")
        existing = next((item for item in self.data["models"] if item.get("file_hash") == sha256), None)
        if existing:
            return dict(existing)
        record = {
            "model_id": spec["model_id"],
            "task_id": PROP_ROTATION_V5,
            "model_name": spec["model_name"],
            "version": spec["version"],
            "file_path": str(model_path),
            "file_hash": sha256,
            "class_names": list(V5_CLASS_NAMES),
            "source": str(source),
            "status": "PENDING_TEACHER_VALIDATION",
            "release_stage": "TEST" if spec["test_only"] else "TRIAL",
            "test_only": spec["test_only"],
            "created_at": _utc_now(),
            "teaching_trial_enabled_at": None,
            "active_isolated_at": None,
        }
        for key in ("test_map50", "golden_test_set"):
            if key in spec:
                record[key] = spec[key]
        threshold = map50_threshold()
        record["map50_threshold"] = threshold
        if not spec["test_only"] and spec.get("golden_test_set") and float(spec.get("test_map50", 0)) >= threshold:
            # 固定測試組成績達門檻，視為已通過獨立 Golden Test；仍須教師按下才會 ACTIVE。
            record["independent_golden_test_passed"] = True
        self.data["models"].append(record)
        self.data["audit"].append({"event": "REGISTERED", "model_id": record["model_id"], "at": _utc_now()})
        self._save()
        return dict(record)

    # 舊呼叫名稱保留：既有 V5 測試與服務仍可使用。
    register_verified_v5 = register_verified_model

    def record_validation(
        self, *, model_id: str, image_sha256: str, detections: list[dict], teacher_id: str,
        expected_class: str | None, teacher_decision: str,
    ) -> dict:
        """保存教師人工確認；不改權重、不暗中改變 ACTIVE。"""
        self._refresh()
        model = self._find(model_id)
        if model.get("task_id") != PROP_ROTATION_V5:
            raise PropRotationTrialError("wrong_model_task")
        if teacher_decision not in {"CORRECT", "INCORRECT", "RETEST"}:
            raise PropRotationTrialError("invalid_teacher_decision")
        if len(str(image_sha256)) != 64:
            raise PropRotationTrialError("invalid_image_sha256")
        validation = {
            "validation_id": f"rotation-validation-{uuid4()}",
            "model_id": model_id,
            "image_sha256": str(image_sha256).lower(),
            "detections": [dict(item) for item in detections],
            "expected_class": expected_class if expected_class in V5_CLASS_NAMES else None,
            "teacher_decision": teacher_decision,
            "teacher_id": str(teacher_id),
            "validated_at": _utc_now(),
        }
        self.data["validations"].append(validation)
        self.data["audit"].append({"event": "TEACHER_REVIEW", "model_id": model_id, "at": _utc_now(), "teacher_id": str(teacher_id)})
        self._save()
        return dict(validation)

    def confirm_validation(self, *, validation_id: str, teacher_id: str, decision: str) -> dict:
        """教師確認既有推論；只允許原驗證教師修改自己的待確認記錄。"""
        self._refresh()
        if decision not in {"CORRECT", "INCORRECT", "RETEST"}:
            raise PropRotationTrialError("invalid_teacher_decision")
        for validation in self.data["validations"]:
            if validation.get("validation_id") != validation_id:
                continue
            if str(validation.get("teacher_id")) != str(teacher_id):
                raise PropRotationTrialError("validation_teacher_mismatch")
            validation["teacher_decision"] = decision
            validation["confirmed_at"] = _utc_now()
            self.data["audit"].append({"event": "TEACHER_CONFIRMATION", "model_id": validation["model_id"], "at": _utc_now(), "teacher_id": str(teacher_id)})
            self._save()
            return dict(validation)
        raise PropRotationTrialError("validation_not_found")

    def enable_teaching_trial(self, model_id: str, teacher_id: str, trial_cohort_ids: list[str] | None = None) -> dict:
        """至少一筆教師確認正確後才可限定為隔離教學試用。"""
        self._refresh()
        model = self._find(model_id)
        has_confirmed = any(
            item.get("model_id") == model_id and item.get("teacher_decision") == "CORRECT"
            for item in self.data["validations"]
        )
        if not has_confirmed:
            raise PropRotationTrialError("teacher_confirmation_required")
        cohorts = sorted({str(item).strip() for item in (trial_cohort_ids or []) if str(item).strip()})
        model.update(
            status="TEST" if model.get("test_only") else "TEACHING_TRIAL", teaching_trial_enabled_at=_utc_now(),
            teaching_trial_enabled_by=str(teacher_id),
        )
        if cohorts:
            model["trial_cohort_ids"] = cohorts
        self.data["audit"].append({"event": "TEACHING_TRIAL_ENABLED", "model_id": model_id, "at": _utc_now(), "teacher_id": str(teacher_id)})
        self._save()
        return dict(model)

    def withdraw_teaching_trial(self, model_id: str, teacher_id: str) -> dict:
        """回到待驗證；學員推論立即停用，既有紀錄全部保留。"""
        self._refresh()
        model = self._find(model_id)
        model.update(status="PENDING_TEACHER_VALIDATION", active_isolated_at=None, trial_cohort_ids=[])
        self.data["audit"].append({"event": "TEACHING_TRIAL_WITHDRAWN", "model_id": model_id, "at": _utc_now(), "teacher_id": str(teacher_id)})
        self._save()
        return dict(model)

    def activate_isolated(self, model_id: str, teacher_id: str) -> dict:
        """隔離 ACTIVE 也必須有獨立 Golden Test，絕不以人工單張確認取代。"""
        self._refresh()
        model = self._find(model_id)
        if model.get("test_only"):
            # TEST 教學測試模型永遠不得成為 ACTIVE；啟用需模型的 Golden Test mAP50 達門檻。
            raise PropRotationTrialError("test_model_not_activatable")
        if not model.get("independent_golden_test_passed"):
            raise PropRotationTrialError("independent_golden_test_required")
        model.update(status="ACTIVE_ISOLATED", active_isolated_at=_utc_now(), active_isolated_by=str(teacher_id))
        self.data["audit"].append({"event": "ACTIVE_ISOLATED", "model_id": model_id, "at": _utc_now(), "teacher_id": str(teacher_id)})
        self._save()
        return dict(model)

    def model(self) -> dict | None:
        self._refresh()
        return dict(self.data["models"][0]) if self.data["models"] else None

    def record_teacher_label_edit(self, *, model_id: str, image_sha256: str, teacher_id: str, before: list[dict], after: list[dict], note: str = "") -> dict:
        """保存教師修改標籤紀錄（追加，不覆蓋）；原始推論結果保留在 before。"""
        self._refresh()
        self._find(model_id)
        edit = {
            "edit_id": f"rotation-label-edit-{uuid4()}", "model_id": model_id,
            "image_sha256": str(image_sha256).lower(), "teacher_id": str(teacher_id),
            "before": [dict(item) for item in before], "after": [dict(item) for item in after],
            "note": str(note)[:500], "label_status": "TEACHER_CONFIRMED", "edited_at": _utc_now(),
        }
        self.data.setdefault("label_edits", []).append(edit)
        self.data["audit"].append({"event": "TEACHER_LABEL_EDIT", "model_id": model_id, "at": _utc_now(), "teacher_id": str(teacher_id)})
        self._save()
        return dict(edit)

    def validations(self, model_id: str) -> list[dict]:
        self._refresh()
        return [dict(item) for item in self.data["validations"] if item.get("model_id") == model_id]

    def record_student_event(self, *, model_id: str, student_id: str, cohort_ids: list[str], image_sha256: str, detections: list[dict], rule_evaluation: dict | None = None) -> dict:
        """保存教學試用紀錄；不寫入既有四類任務或正式 ACTIVE Registry。"""
        self._refresh()
        self._find(model_id)
        event = {
            "event_id": f"rotation-student-event-{uuid4()}",
            "model_id": model_id,
            "student_id": str(student_id),
            "cohort_ids": [str(item) for item in cohort_ids],
            "image_sha256": str(image_sha256).lower(),
            "detections": [dict(item) for item in detections],
            "created_at": _utc_now(),
        }
        if rule_evaluation is not None:
            # 候選結果只是 AI 建議：is_official 一律 False，正式結果只能由教師覆核產生。
            event["rule_evaluation"] = {**rule_evaluation, "is_official": False}
        self.data.setdefault("student_events", []).append(event)
        self.data["audit"].append({"event": "STUDENT_INFERENCE", "model_id": model_id, "at": _utc_now(), "student_id": str(student_id)})
        self._save()
        return dict(event)
