from __future__ import annotations

import asyncio
import base64
import binascii
import hmac
import json
import time
import os
import httpx
from dataclasses import asdict
from pathlib import Path
from uuid import uuid4

from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.routing import Mount, Route
from starlette.responses import FileResponse, Response
from starlette.staticfiles import StaticFiles

from .credential_isolation import ClientCredentialIsolation
from .download_center import (
    configured_download_root,
    configured_manifest_path,
    download_endpoint,
    manifest_endpoint,
)
from .config import LiveConfig
from .errors import error_response, json_response
from . import internal_auth
from .guidance import DeterministicGuidanceProvider
from .live_assertions import LiveAssertionError, verify_live_assertion
from .mock_vision import MockVision
from .orchestrator import CoachOrchestrator
from .rag import RAGAdapter
from .rag_context import RAGContextBuilder
from .rag_guidance import ContextualGuidanceCoordinator, RAGGuidanceProvider
from .sessions import InMemorySessionStore, InvalidSessionTransition
from .task_state import TaskTransitionError
from .training_records import EvidenceRecord, EvidenceType, ModelSubmissionStatus, ModelTaskType, ReflectionSource, StudentReflection
from .sop import SopDecision, SopEngine
from .vision import VisionAdapter, VisionResponseError, VisionUnavailable
from .coach_ask import LiveCoachAskService
from .providers.provider_manager import GeneralAIProviderManager
from .vision_api import vision_routes
from .vision_center import VisionCenter
from .prop_rotation_service import build_rotation_trial_service_from_environment
from .benchmark import PropBenchmarkSandbox, runtime_status


def _decode_image_data(image_data: object, max_image_bytes: int) -> tuple[bytes | None, str | None]:
    if not isinstance(image_data, str) or not image_data.startswith("data:image/"):
        return None, "invalid_image"
    header, separator, encoded = image_data.partition(",")
    if not separator or ";base64" not in header or not encoded:
        return None, "invalid_image"
    try:
        decoded = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        return None, "invalid_image"
    if not decoded:
        return None, "invalid_image"
    if len(decoded) > max_image_bytes:
        return None, "image_too_large"
    return decoded, None


# P1-1：學生上傳 YOLO 模型（best.pt）的基礎安全檢查；本輪只作 Artifact Storage，不執行模型。
_MODEL_TASK_TYPES = {item.value for item in ModelTaskType}
_MODEL_MAX_BYTES = 500 * 1024 * 1024  # 500 MB 上限


def _validate_model_submission(metadata: dict) -> dict:
    filename = str(metadata.get("model_filename") or "").strip()
    if not filename.lower().endswith(".pt"):
        raise ValueError("model_file_must_be_pt")
    task_type = str(metadata.get("model_task_type") or ModelTaskType.PROP_DETECTION.value)
    if task_type not in _MODEL_TASK_TYPES:
        raise ValueError("unsupported_model_task_type")
    size = metadata.get("size_bytes")
    if size is not None and (not isinstance(size, int) or size <= 0 or size > _MODEL_MAX_BYTES):
        raise ValueError("invalid_model_file_size")
    clean = {
        "model_task_type": task_type,
        "model_filename": filename,
        "model_status": ModelSubmissionStatus.UPLOADED.value,
        "teacher_note": "",
        "student_note": str(metadata.get("student_note") or "").strip()[:500],
        "size_bytes": size,
    }
    if task_type == ModelTaskType.PROP_DETECTION.value:
        # PROP Contract：槳葉方向與正反面辨識。
        clean["expected_classes"] = ["CW_F", "CCW_F", "CW_B", "CCW_B"]
    return clean


def _default_session_store_path() -> "Path | None":
    """Opt-in durable session store. Disabled unless FDE_LIVE_SESSION_STORE is set (P1: 重载保留)."""
    raw = os.environ.get("FDE_LIVE_SESSION_STORE")
    if not raw:
        return None
    return Path(raw)


def portal_proxy_timeout_seconds() -> float:
    """Portal 代理等待上限。

    2026-11-01：學員與教師的 YOLO 推論走這條代理，CPU 推論負載高時超過原本的
    15 秒，瀏覽器收到 503，後端卻已寫入紀錄。預設值須大於 V5 推論的 120 秒預算。
    """
    try:
        return max(1.0, float(os.environ.get("FDE_PORTAL_PROXY_TIMEOUT_SECONDS", "125")))
    except ValueError:
        return 125.0


def create_app(*, vision_adapter=None, session_store=None, rag_adapter=None, general_ai_provider=None, vision_health_timeout_seconds=None, max_image_bytes=None, dev_mode=None, vision_center=None, benchmark_sandbox=None, download_root=None, download_manifest_path=None, django_portal_url=None, session_store_path: "Path | None" = None, live_assertion_key=None, trusted_proxy_key=None, require_live_auth=None) -> Starlette:
    config = LiveConfig.from_environment()
    adapter = vision_adapter or VisionAdapter(config.yolo_base_url, timeout_seconds=config.vision_request_timeout_seconds)
    store_path = session_store_path if session_store_path is not None else _default_session_store_path()
    sessions = session_store or InMemorySessionStore(persistence_path=store_path)
    development = config.dev_mode if dev_mode is None else bool(dev_mode)
    # 正式模式永遠 Fail Closed；僅明確隔離的開發環境可關閉 Assertion。
    require_identity = not development if require_live_auth is None else bool(require_live_auth)
    if not development:
        require_identity = True
    assertion_key = str(live_assertion_key if live_assertion_key is not None else os.environ.get("FDE_LIVE_ASSERTION_KEY", "")).strip()
    proxy_key = str(trusted_proxy_key if trusted_proxy_key is not None else os.environ.get("FDE_LIVE_PROXY_KEY", "")).strip()

    def trusted_role(request):
        """安全模式只採用 Middleware 驗證後的角色。"""
        identity = getattr(request.state, "live_identity", None)
        if require_identity:
            return str((identity or {}).get("role") or "")
        return request.headers.get("X-FDE-Role", "student")

    def trusted_teacher_id(request):
        """安全模式由簽章 subject 提供教師身分。"""
        identity = getattr(request.state, "live_identity", None)
        if require_identity:
            return str((identity or {}).get("sub") or "") if (identity or {}).get("role") == "teacher" else ""
        return request.headers.get("X-FDE-Teacher-ID", "")
    rag_client = rag_adapter or RAGAdapter(config.rag_base_url, timeout_seconds=config.rag_timeout_seconds)
    rag_coordinator = ContextualGuidanceCoordinator(
        sessions, RAGContextBuilder(), RAGGuidanceProvider(rag_client)
    )
    coach_ask = LiveCoachAskService(sessions, adapter, rag_client, general_ai_provider)
    orchestrator = CoachOrchestrator(
        sessions, SopEngine(), DeterministicGuidanceProvider(), rag_coordinator
    )
    mock_vision = MockVision()
    health_timeout = config.vision_health_timeout_seconds if vision_health_timeout_seconds is None else vision_health_timeout_seconds
    image_limit = config.max_image_bytes if max_image_bytes is None else max_image_bytes
    center_root = Path(os.environ.get("FDE_VISION_CENTER_ROOT") or Path(os.environ.get("LOCALAPPDATA", Path.home())) / "FDE-AI-UAS" / "vision-center")
    center = vision_center or VisionCenter(
        center_root,
        demo_simulation_enabled=os.environ.get("FDE_DEMO_SIMULATED_INFERENCE", "").strip() == "1",
    )
    # PROP_ROTATION_V5 僅在明確隔離環境設定時啟用；不影響既有四類 PROP_DIRECTION。
    rotation_trial = build_rotation_trial_service_from_environment()
    if hasattr(sessions, "set_prop_vision_probe"):
        sessions.set_prop_vision_probe(lambda: center.active_model("PROP_DIRECTION") is not None)
    # P1-2：PROP Benchmark Sandbox（僅教師主動觸發；隔離於 Production / A06）
    sandbox = benchmark_sandbox or PropBenchmarkSandbox()
    # 下載中心沿用既有 Starlette 後端；Manifest 僅保存相對路徑。
    downloads_root = Path(download_root or configured_download_root()).resolve()
    downloads_manifest_file = Path(download_manifest_path or configured_manifest_path(downloads_root)).resolve()
    # 既有 Django 學員／教師入口由同一 Tunnel 反向代理；不建立第二套登入系統。
    django_origin = (django_portal_url or os.environ.get("FDE_DJANGO_PORTAL_URL") or "http://127.0.0.1:8022").rstrip("/")

    async def health(_request):
        try:
            vision_online = bool(await asyncio.wait_for(adapter.health(), timeout=health_timeout))
        except (TimeoutError, OSError, ValueError):
            vision_online = False
        components = {"live_backend": "online", "vision": "online" if vision_online else "offline"}
        if general_ai_provider is not None and hasattr(general_ai_provider, "health_status"):
            components["general_ai"] = general_ai_provider.health_status()
        return json_response({
            "status": "online" if vision_online else "degraded",
            "components": components,
            # 2026-10-28：讓運維一眼看出內部呼叫是否已啟用簽章驗證。
            # unsigned_legacy 代表任何本機程序都能偽造 X-FDE-Role，正式環境不得停留此狀態。
            "internal_auth": internal_auth.auth_mode(),
        })

    async def downloads_manifest(request):
        return await manifest_endpoint(request, downloads_root, downloads_manifest_file)

    async def download_file(request):
        return await download_endpoint(request, downloads_root, downloads_manifest_file)

    async def create_session(request):
        try: payload = await request.json()
        except (ValueError, UnicodeDecodeError): return error_response("invalid_json", "Request body must be a JSON object.", 400)
        if not isinstance(payload, dict): return error_response("invalid_json", "Request body must be a JSON object.", 400)
        forbidden = {"student_id", "teacher", "course_permission", "pass"}.intersection(payload)
        if forbidden: return error_response("untrusted_field", "Demo sessions do not accept identity, permission, or result fields.", 400)
        if payload.get("mode", "demo") != "demo": return error_response("unsupported_mode", "Phase 2 supports demo mode only.", 400)
        source = str(payload.get("vision_source", "REAL_VISION"))
        if source not in {"REAL_VISION", "MOCK_VISION"}: return error_response("invalid_vision_source", "Unknown vision source.", 400)
        if source == "MOCK_VISION" and not development: return error_response("dev_only", "Mock Vision is disabled.", 404)
        training_track = payload.get("training_track")
        if training_track not in {None, "F450_TWELVE_TASK"}: return error_response("invalid_training_track", "Unknown training track.", 400)
        identity = getattr(request.state, "live_identity", None)
        if require_identity:
            if not identity or identity.get("role") != "student":
                return error_response("live_student_required", "Student identity is required.", 403)
            created = sessions.create(
                vision_source=source,
                training_track=training_track,
                owner_subject=identity["sub"],
                owner_enrollment_id=identity["enrollment_id"],
                owner_cohort_id=identity["cohort_ids"][0],
            ).as_dict()
        else:
            created = sessions.create(vision_source=source, training_track=training_track).as_dict()
        created["dev_mode"] = development
        return json_response(created, status_code=201)

    async def get_session(request):
        session = sessions.get(request.path_params["session_id"])
        if session is None: return error_response("session_not_found", "Live session was not found.", 404)
        step = sessions.current_step(session.session_id) if session.state != "TASK_COMPLETED" else None
        payload = session.as_dict()
        payload["course_title"] = sessions.course.title
        payload["task_title"] = sessions.task.title
        payload["step"] = None if step is None else {"step_id": step.step_id, "title": step.title, "instruction": step.instruction, "expected_classes": list(step.expected_classes)}
        payload["progress"] = {"current": session._step_index + 1, "total": len(sessions.task.steps)}
        payload["rag_explanation"] = session.rag_explanation
        payload["dev_mode"] = development
        if session.training_track == "F450_TWELVE_TASK": payload["training"] = sessions.training_state(session.session_id)
        return json_response(payload)

    async def training_start_task(request):
        sid, task_id = request.path_params["session_id"], request.path_params["task_id"]
        try: state = sessions.start_training_task(sid, task_id)
        except KeyError: return error_response("session_not_found", "Training session was not found.", 404)
        except TaskTransitionError as error: return error_response("task_blocked", str(error), 409)
        return json_response({"training": state})

    async def training_view_task(request):
        try: view = sessions.training_task_view(request.path_params["session_id"], request.path_params["task_id"])
        except KeyError: return error_response("training_task_not_found", "Training session or task was not found.", 404)
        return json_response({"training_task_view": view})

    async def training_complete_task(request):
        sid, task_id = request.path_params["session_id"], request.path_params["task_id"]
        try: state = sessions.complete_training_task(sid, task_id)
        except KeyError: return error_response("session_not_found", "Training session was not found.", 404)
        except TaskTransitionError as error: return error_response(str(error), str(error), 409)
        return json_response({"training": state})

    async def training_step_fact(request):
        sid, step_id = request.path_params["session_id"], request.path_params["step_id"]
        try:
            payload = await request.json()
            state = sessions.record_training_step_fact(sid, step_id, str(payload["fact"]), str(payload.get("student_note") or ""))
        except KeyError: return error_response("invalid_step_fact", "Session or fact is missing.", 400)
        except TaskTransitionError as error: return error_response("invalid_step_transition", str(error), 409)
        return json_response({"training": state})

    async def training_step_safety_ack(request):
        try: state = sessions.acknowledge_training_step_safety(request.path_params["session_id"], request.path_params["step_id"])
        except KeyError: return error_response("session_not_found", "Training session was not found.", 404)
        except TaskTransitionError as error: return error_response("invalid_step_transition", str(error), 409)
        return json_response({"training": state})

    async def training_evidence(request):
        sid = request.path_params["session_id"]
        try: payload = await request.json()
        except (ValueError, UnicodeDecodeError): return error_response("invalid_json", "Request body must be JSON.", 400)
        try:
            evidence_type = EvidenceType(str(payload["evidence_type"]))
            # P1-1：學生上傳 YOLO 模型（best.pt）僅作 Artifact Storage，本輪不執行模型。
            if evidence_type == EvidenceType.YOLO_MODEL:
                metadata = _validate_model_submission(payload.get("metadata") or {})
                # 內部 task_id 落到當前有效 F450 任務（課程查找需要），不代表模型屬於該任務；
                # 教師端依 evidence_type=YOLO_MODEL 列出，與此 task_id 無關。
                target = sessions.get(sid) if sessions.get(sid) else None
                current_task = (target.current_task_id if target else None) or "TASK_01"
                evidence = EvidenceRecord.create(
                    f"dev-student:{sid}", sid, "F450_AI_TRAINING", current_task, None,
                    evidence_type, str(payload.get("source") or "STUDENT_UPLOAD"), payload.get("file_reference"),
                    None, None, None, tuple(payload.get("error_codes") or ()),
                    tuple(payload.get("safety_reminders_acknowledged") or ()), metadata,
                )
            else:
                evidence = EvidenceRecord.create(
                    f"dev-student:{sid}", sid, "F450_AI_TRAINING", str(payload["task_id"]), payload.get("step_id"),
                    evidence_type, str(payload.get("source") or "DEV_STORAGE"), payload.get("file_reference"),
                    payload.get("vision_result"), payload.get("check_result"), None, tuple(payload.get("error_codes") or ()),
                    tuple(payload.get("safety_reminders_acknowledged") or ()), dict(payload.get("metadata") or {}),
                )
            sessions.add_training_evidence(sid, evidence)
        except KeyError: return error_response("invalid_evidence", "Required evidence field or session is missing.", 400)
        except ValueError as error: return error_response("invalid_evidence", str(error), 400)
        return json_response({"evidence": asdict(evidence), "training": sessions.training_state(sid)}, status_code=201)

    # P1-1：教師收件匣（AI 模型提交）
    async def training_model_submissions(request):
        sid = request.path_params["session_id"]
        role = trusted_role(request)
        if role != "teacher": return error_response("teacher_authority_required", "Teacher permission is required.", 403)
        try: return json_response({"model_submissions": sessions.list_model_submissions(sid)})
        except KeyError: return error_response("session_not_found", "Training session was not found.", 404)

    # P1-1：教師審核（通過進入 Benchmark / 退回）
    async def training_model_submission_review(request):
        sid = request.path_params["session_id"]
        role = trusted_role(request)
        if role != "teacher": return error_response("teacher_authority_required", "Teacher permission is required.", 403)
        teacher_id = trusted_teacher_id(request) or "MOCK_TEACHER"
        try: payload = await request.json()
        except (ValueError, UnicodeDecodeError): return error_response("invalid_json", "Request body must be JSON.", 400)
        try:
            result = sessions.review_model_submission(sid, request.path_params["evidence_id"], str(payload["decision"]), teacher_id, str(payload.get("note") or ""))
        except KeyError: return error_response("model_submission_not_found", "Model submission was not found.", 404)
        except ValueError as error: return error_response("invalid_model_review", str(error), 400)
        return json_response({"review": result, "training": sessions.training_state(sid)})

    # P1-2：教師主動觸發 PROP Sandbox Benchmark（僅 APPROVED_FOR_BENCHMARK）
    async def training_model_submission_benchmark(request):
        sid = request.path_params["session_id"]
        role = trusted_role(request)
        if role != "teacher": return error_response("teacher_authority_required", "Teacher permission is required.", 403)
        teacher_id = trusted_teacher_id(request) or "MOCK_TEACHER"
        try: submission = sessions.get_model_submission(sid, request.path_params["evidence_id"])
        except KeyError: return error_response("model_submission_not_found", "Model submission was not found.", 404)
        # 僅 APPROVED_FOR_BENCHMARK 可進入 Benchmark；上傳階段仍禁止執行模型。
        if (submission.get("metadata") or {}).get("model_status") != ModelSubmissionStatus.APPROVED_FOR_BENCHMARK.value:
            return error_response("invalid_benchmark_stage", "Benchmark requires APPROVED_FOR_BENCHMARK.", 409)
        try:
            benchmark = sandbox.run(submission, teacher_id)
            updated = sessions.record_model_benchmark(sid, request.path_params["evidence_id"], benchmark)
        except KeyError: return error_response("model_submission_not_found", "Model submission was not found.", 404)
        return json_response({"benchmark": benchmark, "submission": updated, "validation_set": sandbox.validation_set_status(), "runtime": runtime_status()})

    # P1-2：Benchmark 歷史（同一 submission 可重複驗證）
    async def training_model_submission_benchmarks(request):
        sid = request.path_params["session_id"]
        role = trusted_role(request)
        if role != "teacher": return error_response("teacher_authority_required", "Teacher permission is required.", 403)
        evidence_id = request.path_params["evidence_id"]
        try: sessions.get_model_submission(sid, evidence_id)
        except KeyError: return error_response("model_submission_not_found", "Model submission was not found.", 404)
        return json_response({"benchmarks": sandbox.history(evidence_id), "validation_set": sandbox.validation_set_status()})

    async def training_reflection(request):
        sid = request.path_params["session_id"]
        try: payload = await request.json()
        except (ValueError, UnicodeDecodeError): return error_response("invalid_json", "Request body must be JSON.", 400)
        try:
            reflection = StudentReflection.create(
                f"dev-student:{sid}", str(payload["task_id"]), str(payload.get("original_text") or ""),
                payload.get("ai_assisted_text"), ReflectionSource(str(payload.get("source_type") or "TEXT")),
            )
            sessions.add_training_reflection(sid, reflection)
        except KeyError: return error_response("session_not_found", "Training session was not found.", 404)
        except ValueError as error: return error_response(str(error), str(error), 400)
        return json_response({"reflection": asdict(reflection), "training": sessions.training_state(sid)}, status_code=201)

    async def training_teacher_review(request):
        sid = request.path_params["session_id"]
        role = trusted_role(request)
        teacher_id = trusted_teacher_id(request)
        if role != "teacher": return error_response("teacher_authority_required", "Teacher permission is required.", 403)
        if development and not require_identity and teacher_id != "MOCK_TEACHER": return error_response("invalid_dev_teacher", "Use the explicit development teacher identity.", 403)
        try: payload = await request.json()
        except (ValueError, UnicodeDecodeError): return error_response("invalid_json", "Request body must be JSON.", 400)
        if payload.get("step_id"):
            try: state = sessions.review_training_step(sid, str(payload["task_id"]), str(payload["step_id"]), str(payload["decision"]), teacher_id, str(payload.get("note") or ""))
            except KeyError: return error_response("session_not_found", "Training session was not found.", 404)
            except TaskTransitionError as error: return error_response("invalid_teacher_review", str(error), 409)
            return json_response({"review": {"task_id": payload["task_id"], "step_id": payload["step_id"], "decision": payload["decision"], "teacher_id": teacher_id, "note": payload.get("note") or "", "development_identity": bool(development)}, "training": state})
        try: review = sessions.review_training_task(sid, str(payload["task_id"]), str(payload["decision"]), teacher_id, str(payload.get("note") or ""))
        except KeyError: return error_response("session_not_found", "Training session was not found.", 404)
        except TaskTransitionError as error: return error_response("invalid_teacher_review", str(error), 409)
        review_payload = asdict(review)
        review_payload["development_identity"] = bool(development and teacher_id == "MOCK_TEACHER")
        review_payload["previous_state"] = review.previous_state.value
        review_payload["new_state"] = review.new_state.value
        return json_response({"review": review_payload, "training": sessions.training_state(sid)})

    # ---- MP-12 Integration Adapter（Backend）：TASK_07 深度子模組 MP01～MP12 ----
    # 複用既有 MP-12 Catalog / State / Teacher Gate，不重新實作；教師權限沿用 Main-12 既有
    # X-FDE-Role / X-FDE-Teacher-ID 慣例（與 training_teacher_review 同一條 Gate 強度）。

    async def training_mp12_select(request):
        sid, subtask_id = request.path_params["session_id"], request.path_params["subtask_id"]
        try: state = sessions.select_mp_subtask(sid, subtask_id)
        except KeyError: return error_response("session_not_found", "Training session was not found.", 404)
        except TaskTransitionError as error: return error_response("invalid_mp_subtask", str(error), 409)
        return json_response({"training": state})

    async def training_mp12_complete(request):
        sid, subtask_id = request.path_params["session_id"], request.path_params["subtask_id"]
        try: state = sessions.complete_mp_subtask(sid, subtask_id, actor="student")
        except KeyError: return error_response("session_not_found", "Training session was not found.", 404)
        except TaskTransitionError as error: return error_response("invalid_mp_completion", str(error), 409)
        return json_response({"training": state})

    async def training_mp12_teacher_review(request):
        sid, subtask_id = request.path_params["session_id"], request.path_params["subtask_id"]
        role = trusted_role(request)
        teacher_id = trusted_teacher_id(request)
        if role != "teacher": return error_response("teacher_authority_required", "Teacher permission is required.", 403)
        if development and not require_identity and teacher_id != "MOCK_TEACHER": return error_response("invalid_dev_teacher", "Use the explicit development teacher identity.", 403)
        if not teacher_id: return error_response("teacher_id_required", "Teacher identity is required.", 400)
        try: payload = await request.json()
        except (ValueError, UnicodeDecodeError): return error_response("invalid_json", "Request body must be JSON.", 400)
        try: state = sessions.review_mp_subtask(
            sid, subtask_id, str(payload.get("decision") or ""), teacher_id,
            reason=str(payload.get("reason") or ""), note=str(payload.get("note") or ""),
        )
        except KeyError: return error_response("session_not_found", "Training session was not found.", 404)
        except TaskTransitionError as error: return error_response("invalid_mp_teacher_review", str(error), 409)
        return json_response({
            "review": {
                "subtask_id": subtask_id, "decision": payload.get("decision"),
                "teacher_id": teacher_id, "reason": payload.get("reason") or "",
                "note": payload.get("note") or "",
                "parent_task_id": "TASK_07",
                "development_identity": bool(development and teacher_id == "MOCK_TEACHER"),
            },
            "training": state,
        })

    async def training_growth_record(request):
        sid = request.path_params["session_id"]
        try: payload = asdict(sessions.growth_record(sid))
        except KeyError: return error_response("session_not_found", "Training session was not found.", 404)
        return json_response(payload)

    async def classroom_validation(request):
        sid = request.path_params["session_id"]
        try:
            if request.method == "POST":
                payload = await request.json()
                return json_response(sessions.set_classroom_validation(sid, bool(payload.get("enabled"))))
            return json_response(sessions.classroom_validation_state(sid))
        except KeyError:
            return error_response("session_not_found", "Live session was not found.", 404)

    async def classroom_validation_event(request):
        sid = request.path_params["session_id"]
        try:
            payload = await request.json()
            event = sessions.record_classroom_event(sid, payload)
        except KeyError:
            return error_response("session_not_found", "Live session was not found.", 404)
        except (ValueError, TypeError):
            return error_response("invalid_classroom_event", "Classroom event is invalid.", 400)
        return json_response({"event": event}, status_code=201)

    async def classroom_validation_report(request):
        try:
            return json_response(sessions.classroom_validation_report(request.path_params["session_id"]))
        except KeyError:
            return error_response("session_not_found", "Live session was not found.", 404)

    async def snapshot(request):
        sid = request.path_params["session_id"]
        session = sessions.get(sid)
        if session is None: return error_response("session_not_found", "Live session was not found.", 404)
        if session.vision_source != "REAL_VISION": return error_response("vision_source_mismatch", "Snapshot requires a REAL_VISION session.", 409)
        try: payload = await request.json()
        except (ValueError, UnicodeDecodeError): return error_response("invalid_json", "Request body must be a JSON object.", 400)
        if not isinstance(payload, dict): return error_response("invalid_json", "Request body must be a JSON object.", 400)
        _decoded, image_error = _decode_image_data(payload.get("image_data"), image_limit)
        if image_error == "invalid_image": return error_response("invalid_image", "A valid base64 image data URL is required.", 400)
        if image_error == "image_too_large": return error_response("image_too_large", "The snapshot exceeds the Phase 1A size limit.", 413)
        frame_id = str(payload.get("frame_id") or uuid4())
        if len(frame_id) > 100: return error_response("invalid_frame_id", "Frame ID is too long.", 400)
        file_name = str(payload.get("file_name") or "live-snapshot.jpg")
        if len(file_name) > 255: return error_response("invalid_file_name", "File name is too long.", 400)
        try: confidence = float(payload.get("confidence", 0.25))
        except (TypeError, ValueError): return error_response("invalid_confidence", "Confidence must be between 0 and 1.", 400)
        if not 0 <= confidence <= 1: return error_response("invalid_confidence", "Confidence must be between 0 and 1.", 400)
        started = time.perf_counter()
        try: result = await adapter.detect(payload["image_data"], file_name, confidence)
        except VisionUnavailable: return error_response("vision_offline", "Vision service is currently unavailable.", 503)
        except VisionResponseError: return error_response("vision_invalid_response", "Vision service returned an invalid response.", 502)
        metrics = {"vision_upstream_ms": result.upstream_ms, **(result.timings or {}), "backend_ms": round((time.perf_counter() - started) * 1000, 1)}
        response = orchestrator.process(sid, result.detections, frame_id, "REAL_VISION", metrics)
        response["session_id"] = sid
        response["frame_id"] = frame_id
        return json_response(response)

    async def simulate(request):
        if not development: return error_response("dev_only", "Mock Vision is disabled.", 404)
        sid = request.path_params["session_id"]
        session = sessions.get(sid)
        if session is None: return error_response("session_not_found", "Live session was not found.", 404)
        if session.vision_source != "MOCK_VISION": return error_response("vision_source_mismatch", "Simulation requires a MOCK_VISION session.", 409)
        try: payload = await request.json()
        except (ValueError, UnicodeDecodeError): return error_response("invalid_json", "Request body must be a JSON object.", 400)
        frame_id = str(payload.get("frame_id") or uuid4())
        try: detections = mock_vision.scenario(str(payload.get("scenario")), frame_id)
        except ValueError: return error_response("invalid_scenario", "Unsupported Mock Vision scenario.", 400)
        return json_response(orchestrator.process(sid, detections, frame_id, "MOCK_VISION", {"mock": True}))

    # M1 閉環：遙控器標定向導（fde_rc_calibrator.js）自動存盤的最新設備檔案，
    # 供 /sim/ 首次連接該遙控器時導入；未標定/目錄缺失時回 ok:false，不臆造資料。
    rc_calib_dir = Path(os.environ.get("FDE_RC_CALIB_DIR") or r"C:\Users\admin\WorkBuddy AI\2026-10-05-17-47-38")

    async def latest_rc_profile(_request):
        try:
            if not rc_calib_dir.is_dir():
                return json_response({"ok": False, "reason": "no-directory"})
            candidates = sorted(rc_calib_dir.glob("fde-rc-calibration-*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
            for candidate in candidates:
                try:
                    payload = json.loads(candidate.read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    continue
                profile = payload.get("profile") if isinstance(payload, dict) else None
                if not isinstance(profile, dict) or not isinstance(profile.get("id"), str):
                    continue
                if payload.get("schema") != "fde.device-profile/1":
                    continue
                # 纵深防御：缺轴/异构 profile 一律跳过，避免返回不完整档被误当有效。
                axes = profile.get("axes")
                if not isinstance(axes, dict) or not all(
                    isinstance(axes.get(k), dict) and isinstance(axes[k].get("source"), int)
                    for k in ("roll", "pitch", "yaw", "throttle")
                ):
                    continue
                return json_response({
                    "ok": True,
                    "file": candidate.name,
                    "savedAtMs": payload.get("savedAtMs"),
                    "profile": profile,
                    "calibration": payload.get("calibration"),
                })
        except OSError:
            return json_response({"ok": False, "reason": "read-failed"})
        return json_response({"ok": False, "reason": "no-valid-profile"})

    async def confirm(request):
        sid = request.path_params["session_id"]
        try: session = sessions.confirm(sid)
        except KeyError: return error_response("session_not_found", "Live session was not found.", 404)
        except InvalidSessionTransition: return error_response("invalid_transition", "PASS_CANDIDATE is required.", 409)
        status = "TASK_COMPLETED" if session.state == "TASK_COMPLETED" else "STEP_COMPLETED"
        decision = SopDecision(status, None, (session.expected_class,), session.last_detection, session.last_confidence, session.pass_candidate_count, 1, None)
        message = DeterministicGuidanceProvider().get_guidance(session.as_dict(), decision, None)
        return json_response({"session": session.as_dict(), "guidance": message.as_dict()})

    async def events(request):
        try: values = sessions.events(request.path_params["session_id"])
        except KeyError: return error_response("session_not_found", "Live session was not found.", 404)
        return json_response({"events": values})

    async def ask_coach(request):
        sid = request.path_params["session_id"]
        if sessions.get(sid) is None: return error_response("session_not_found", "Live session was not found.", 404)
        try: payload = await request.json()
        except (ValueError, UnicodeDecodeError): return error_response("invalid_json", "Request body must be JSON.", 400)
        question = str(payload.get("question") or "").strip() if isinstance(payload, dict) else ""
        if not question: return error_response("question_required", "A student question is required.", 400)
        image_data = payload.get("image_data")
        if image_data is not None:
            _decoded, image_error = _decode_image_data(image_data, image_limit)
            if image_error: return error_response(image_error, "A valid image is required for a visual question.", 413 if image_error == "image_too_large" else 400)
        request_id = str(payload.get("request_id") or "") or None
        interaction_id = str(payload.get("interaction_id") or "") or None
        try: result = await coach_ask.answer(sid, question, image_data, request_id=request_id, interaction_id=interaction_id)
        except ValueError as error:
            if str(error) == "visual_frame_required": return error_response("visual_frame_required", "Open the camera and capture one current frame.", 428)
            raise
        return json_response(result)


    async def camera_started(request):
        try: event = sessions.append_event(request.path_params["session_id"], "CAMERA_STARTED")
        except KeyError: return error_response("session_not_found", "Live session was not found.", 404)
        return json_response({"event": event})

    async def auto_started(request):
        try: event = sessions.append_event(request.path_params["session_id"], "AUTO_OBSERVATION_STARTED")
        except KeyError: return error_response("session_not_found", "Live session was not found.", 404)
        return json_response({"event": event})

    async def auto_stopped(request):
        try: event = sessions.append_event(request.path_params["session_id"], "AUTO_OBSERVATION_STOPPED")
        except KeyError: return error_response("session_not_found", "Live session was not found.", 404)
        return json_response({"event": event})

    # 手機端 F450 AI 助教問答必須走同源，否則 RAG(:8770) 只綁 127.0.0.1 無法連線。
    # 這裡僅做透明代理，不新增任何推論或知識庫邏輯。
    async def rag_ask_proxy(request: Request):
        try:
            payload = await request.json()
        except ValueError:
            return error_response("invalid_rag_request", "Request body must be JSON.", 422)
        question = str(payload.get("question") or "").strip()
        if not question:
            return error_response("empty_question", "question is required.", 422)
        result = await rag_client.query(question, str(uuid4()), 0)
        if result.status != "online":
            return error_response(result.error_code or "rag_unavailable", "FDE 知識庫暫時無法連線。", 503)
        return json_response({
            "answer": result.explanation,
            "source_type": result.source_type or "rag",
            "version": result.version or "",
        })

    # 統一入口僅回傳既有根首頁；靜態資源以白名單 Mount 提供，不暴露整個專案目錄。
    # 前端為「路徑即區塊」路由（src/router.js），任何已知區塊路徑都必須回傳同一份
    # index.html 由前端自行切換，否則手機直接開啟 /eagle 會得到 404 而按鈕無反應。
    async def homepage(_request):
        return FileResponse(Path(__file__).resolve().parents[2] / "index.html")

    async def django_portal_proxy(request: Request):
        """代理既有 Django Portal，讓 Quick Tunnel 使用同一個公開主機。"""
        upstream_url = f"{django_origin}{request.url.path}"
        if request.url.query:
            upstream_url = f"{upstream_url}?{request.url.query}"
        # P3-F（2026-10-25）：轉發標頭一律由本層重建，**不採信客戶端自帶值**。
        # 舊版只排除 host/connection/content-length/accept-encoding，客戶端自帶的
        # `X-Forwarded-For`／`Forwarded`／`X-Real-IP` 會原樣傳給 Django，等於讓
        # 外部決定上游看到的來源位址與協定。此處全部丟棄後再自行設定。
        excluded_headers = {
            "host",
            "connection",
            "content-length",
            "accept-encoding",
            "x-forwarded-proto",
            "x-forwarded-host",
            "x-forwarded-for",
            "x-forwarded-port",
            "x-real-ip",
            "forwarded",
        }
        headers = {key: value for key, value in request.headers.items() if key.lower() not in excluded_headers}
        headers["host"] = "127.0.0.1:8022"
        headers["x-forwarded-host"] = request.headers.get("host", "")
        # `request.url.scheme` 由 ASGI 伺服器決定（uvicorn 預設只信任來自
        # 127.0.0.1 的 `X-Forwarded-Proto`，即本機的公開入口），不會被遠端客戶端
        # 直接操控。純 HTTP 入口送來的就是 `http`，不會被預設標記成 `https`。
        headers["x-forwarded-proto"] = request.url.scheme
        headers["x-forwarded-for"] = request.client.host if request.client else ""
        try:
            async with httpx.AsyncClient(follow_redirects=False, timeout=portal_proxy_timeout_seconds()) as client:
                upstream = await client.request(request.method, upstream_url, headers=headers, content=await request.body())
        except httpx.HTTPError:
            return Response("Student Portal is temporarily unavailable.", status_code=503, media_type="text/plain")

        response_headers = {
            key: value for key, value in upstream.headers.items()
            if key.lower() not in {"content-length", "connection", "transfer-encoding", "content-encoding", "set-cookie"}
        }
        location = response_headers.get("location")
        if location and location.startswith(django_origin):
            response_headers["location"] = location[len(django_origin):] or "/"
        response = Response(content=upstream.content, status_code=upstream.status_code, headers=response_headers)
        for cookie in upstream.headers.get_list("set-cookie"):
            response.headers.append("set-cookie", cookie)
        return response
    async def delete_session(request):
        if not sessions.delete(request.path_params["session_id"]): return error_response("session_not_found", "Live session was not found.", 404)
        return json_response({"deleted": True})

    routes = vision_routes(center, rotation_trial=rotation_trial) + [
        Route("/login/", django_portal_proxy, methods=["GET", "POST"]),
        Route("/login/{portal_path:path}", django_portal_proxy, methods=["GET", "POST"]),
        Route("/register/", django_portal_proxy, methods=["GET", "POST"]),
        Route("/activate/{portal_path:path}", django_portal_proxy, methods=["GET", "POST"]),
        Route("/logout/", django_portal_proxy, methods=["GET", "POST"]),
        Route("/password-reset/{portal_path:path}", django_portal_proxy, methods=["GET", "POST"]),
        Route("/reset/{portal_path:path}", django_portal_proxy, methods=["GET", "POST"]),
        Route("/student/", django_portal_proxy, methods=["GET", "POST"]),
        Route("/student/{portal_path:path}", django_portal_proxy, methods=["GET", "POST"]),
        Route("/teacher/", django_portal_proxy, methods=["GET", "POST"]),
        Route("/teacher/{portal_path:path}", django_portal_proxy, methods=["GET", "POST"]),
        Route("/courses/{portal_path:path}", django_portal_proxy, methods=["GET", "POST"]),
        Route("/evidence/{portal_path:path}", django_portal_proxy, methods=["GET", "POST"]),
        # I4-A（2026-10-13）：五階段工作台「做」階段的「F450 十二任務實訓」入口為
        # 相對路徑 /platform/f450（Django 的 learning:platform 路由）。工作台本身
        # 由本服務代理提供，瀏覽器來源為本服務，但先前未代理 /platform，
        # 導致統一模擬入口點擊該入口得到 404。此處僅沿用既有 django_portal_proxy
        # 做透明代理（不新增任何推論或業務邏輯），維持單一入口可用。
        Route("/platform/", django_portal_proxy, methods=["GET", "POST"]),
        Route("/platform/{portal_path:path}", django_portal_proxy, methods=["GET", "POST"]),
        Route("/static/{portal_path:path}", django_portal_proxy, methods=["GET"]),
        Route("/", homepage, methods=["GET"]),
        # 前端「路徑即區塊」入口：/eagle(測) 必須回傳同一份 index.html，
        # 否則手機直開 /eagle 取得 404，使用者看到無綁定的按鈕而沒有反應。
        # 僅補上目前實際以路徑直開的區塊，避免影響既有 /teacher/、/courses/ Django 代理。
        Route("/eagle", homepage, methods=["GET"]),
        # 同源 RAG 問答代理（手機 AI 修正建議用）。
        Route("/api/rag/ask", rag_ask_proxy, methods=["POST"]),
        Route("/api/rag/health", lambda _r: json_response({"status": "ok"}), methods=["GET"]),
        Mount("/src", app=StaticFiles(directory=str(Path(__file__).resolve().parents[2] / "src")), name="root-src"),
        Mount("/flight-health", app=StaticFiles(directory=str(Path(__file__).resolve().parents[2] / "flight-health"), html=True), name="flight-health"),
        # M0 方向纠偏：在线无人机巡检仿真训练入口（FDE-Power-Inspection-Simulator vite build 产物）。
        # 默认指向 D 盘仿真器 repo 的 dist；可用 FDE_SIM_DIST 覆盖；dist 缺失时该路由返回 404 而不影响启动。
        Mount("/sim", app=StaticFiles(directory=str(Path(os.environ.get("FDE_SIM_DIST") or "D:/FDE-Power-Inspection-Simulator/dist")), html=True, check_dir=False), name="simulator"),
        Route("/api/downloads", downloads_manifest, methods=["GET"]),
        Route("/api/downloads/{download_id}/file", download_file, methods=["GET"]),
        Route("/api/live/health", health, methods=["GET"]),
        Route("/api/live/sessions", create_session, methods=["POST"]),
        Route("/api/live/sessions/{session_id}", get_session, methods=["GET"]),
        Route("/api/live/sessions/{session_id}/snapshot", snapshot, methods=["POST"]),
        Route("/api/live/sessions/{session_id}/confirm", confirm, methods=["POST"]),
        Route("/api/live/sessions/{session_id}/events", events, methods=["GET"]),
        Route("/api/live/sessions/{session_id}/ask", ask_coach, methods=["POST"]),
        Route("/api/live/sessions/{session_id}/training/tasks/{task_id}/start", training_start_task, methods=["POST"]),
        Route("/api/live/sessions/{session_id}/training/tasks/{task_id}", training_view_task, methods=["GET"]),
        Route("/api/live/sessions/{session_id}/training/tasks/{task_id}/complete", training_complete_task, methods=["POST"]),
        Route("/api/live/sessions/{session_id}/training/mp12/{subtask_id}/select", training_mp12_select, methods=["POST"]),
        Route("/api/live/sessions/{session_id}/training/mp12/{subtask_id}/complete", training_mp12_complete, methods=["POST"]),
        Route("/api/live/sessions/{session_id}/training/mp12/{subtask_id}/teacher-review", training_mp12_teacher_review, methods=["POST"]),
        Route("/api/live/sessions/{session_id}/training/steps/{step_id}/facts", training_step_fact, methods=["POST"]),
        Route("/api/live/sessions/{session_id}/training/steps/{step_id}/safety-ack", training_step_safety_ack, methods=["POST"]),
        Route("/api/live/sessions/{session_id}/training/evidence", training_evidence, methods=["POST"]),
        Route("/api/live/sessions/{session_id}/training/reflection", training_reflection, methods=["POST"]),
        Route("/api/live/sessions/{session_id}/training/teacher-review", training_teacher_review, methods=["POST"]),
        Route("/api/live/sessions/{session_id}/training/growth-record", training_growth_record, methods=["GET"]),
        Route("/api/live/sessions/{session_id}/training/model-submissions", training_model_submissions, methods=["GET"]),
        Route("/api/live/sessions/{session_id}/training/model-submissions/{evidence_id}/review", training_model_submission_review, methods=["POST"]),
        Route("/api/live/sessions/{session_id}/training/model-submissions/{evidence_id}/benchmark", training_model_submission_benchmark, methods=["POST"]),
        Route("/api/live/sessions/{session_id}/training/model-submissions/{evidence_id}/benchmarks", training_model_submission_benchmarks, methods=["GET"]),
        Route("/api/live/sessions/{session_id}/classroom-validation", classroom_validation, methods=["GET", "POST"]),
        Route("/api/live/sessions/{session_id}/classroom-validation/events", classroom_validation_event, methods=["POST"]),
        Route("/api/live/sessions/{session_id}/classroom-validation/report", classroom_validation_report, methods=["GET"]),
        Route("/api/live/sessions/{session_id}/simulate", simulate, methods=["POST"]),
        Route("/api/rc/latest-profile", latest_rc_profile, methods=["GET"]),
        Route("/api/live/sessions/{session_id}/camera/start", camera_started, methods=["POST"]),
        Route("/api/live/sessions/{session_id}/auto/start", auto_started, methods=["POST"]),
        Route("/api/live/sessions/{session_id}/auto/stop", auto_stopped, methods=["POST"]),
        Route("/api/live/sessions/{session_id}", delete_session, methods=["DELETE"]),
        Mount("/live", app=StaticFiles(directory=str(Path(__file__).resolve().parents[2] / "live"), html=True), name="live"),
        Mount("/downloads", app=StaticFiles(directory=str(Path(__file__).resolve().parents[2] / "downloads"), html=True), name="downloads"),
    ]
    app = Starlette(routes=routes)

    async def trusted_live_identity(request, call_next):
        """所有受保護 Live Session 路徑先驗證 Gateway 與短效 Assertion。"""
        path = request.url.path
        protected_live = path.startswith("/api/live/") and path != "/api/live/health"
        if not require_identity or not protected_live:
            return await call_next(request)
        if not assertion_key or not proxy_key:
            return error_response("live_authorization_unavailable", "Live authorization is unavailable.", 503)
        supplied_proxy_key = request.headers.get("X-FDE-Proxy-Auth", "")
        if not hmac.compare_digest(supplied_proxy_key, proxy_key):
            return error_response("live_proxy_required", "Trusted proxy authentication is required.", 403)
        try:
            identity = verify_live_assertion(request.headers.get("X-FDE-Live-Assertion", ""), assertion_key)
        except LiveAssertionError:
            return error_response("live_identity_required", "A valid live identity is required.", 401)
        request.state.live_identity = identity
        segments = [item for item in path.split("/") if item]
        if len(segments) >= 4 and segments[:3] == ["api", "live", "sessions"]:
            session = sessions.get(segments[3])
            if session is not None:
                if not session.owner_subject or not session.owner_cohort_id:
                    return error_response("legacy_session_unowned", "Legacy sessions cannot be claimed.", 403)
                if identity["role"] == "student" and identity["sub"] != session.owner_subject:
                    return error_response("session_owner_required", "Session ownership is required.", 403)
                if identity["role"] == "teacher" and session.owner_cohort_id not in identity["cohort_ids"]:
                    return error_response("session_cohort_forbidden", "Teacher cohort permission is required.", 403)
        return await call_next(request)

    app.add_middleware(BaseHTTPMiddleware, dispatch=trusted_live_identity)
    # P7-B2（2026-10-29）：最後加入 = 最外層 = 最先執行。在身分驗證之前先把
    # 「Live 自有路由的瀏覽器憑證」與「不可信 X-FDE-* 標頭」剝掉；Django Portal
    # 代理前綴則原樣放行，讓登入與 CSRF 的 Cookie 能到達 Django。
    app.add_middleware(ClientCredentialIsolation, proxy_key=proxy_key)
    app.state.vision_adapter = adapter
    app.state.session_store = sessions
    app.state.dev_mode = development
    app.state.rag_coordinator = rag_coordinator
    app.state.vision_center = center
    return app


app = create_app(general_ai_provider=GeneralAIProviderManager.from_environment())
