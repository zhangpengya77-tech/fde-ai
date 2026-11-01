from __future__ import annotations

import base64
import binascii

from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from .errors import error_response, json_response
from . import internal_auth
from .vision_center import (
    ModelClassNamesMappingRequiredError,
    ModelValidationError,
    VisionCenter,
    analyze_hover,
    evaluate_prop,
)


def _teacher(request: Request) -> tuple[str | None, Response | None]:
    """教師身分驗證。

    2026-10-28（上線收尾第四階段 B）：標頭本身可被任意偽造，因此除角色與 ID 外，
    必須通過內部簽章驗證（見 app/internal_auth.py）。未設定密鑰時維持
    unsigned_legacy 相容模式，但健康端點會明確回報該狀態。
    """
    if request.headers.get("X-FDE-Role", "").casefold() != "teacher":
        return None, error_response("teacher_required", "This action requires a teacher.", 403)
    teacher_id = request.headers.get("X-FDE-Teacher-ID", "").strip()
    if not teacher_id:
        return None, error_response("teacher_id_required", "Teacher identity is required.", 403)
    trusted, reason = internal_auth.verify(request)
    if not trusted:
        return None, error_response("internal_auth_rejected", f"Untrusted internal caller: {reason}.", 403)
    return teacher_id, None


async def _json(request: Request) -> dict:
    value = await request.json()
    if not isinstance(value, dict):
        raise ValueError("json_object_required")
    return value


async def _safe_json(request: Request) -> dict:
    """寬鬆解析 JSON body（模型管理用）：無 body／非物件時回退空 dict。

    歸檔／還原／刪除的 reason 是選填，呼叫方可能送空 body；
    此時以空原因繼續，不讓管理功能因 payload 解析失敗而不可用。
    """
    try:
        value = await request.json()
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def vision_routes(center: VisionCenter) -> list[Route]:
    async def models(request: Request):
        if request.method == "GET":
            return json_response(center.list_models(request.query_params.get("model_type")))
        teacher_id, denied = _teacher(request)
        if denied:
            return denied
        try:
            payload = await _json(request)
            if not str(payload.get("file_name", "")).lower().endswith(".pt"):
                raise ModelValidationError("pt_file_required")
            content = base64.b64decode(payload.get("file_base64", ""), validate=True)
            model = center.upload_model(
                model_type=payload["model_type"], model_name=payload["model_name"], version=payload["version"],
                content=content, dataset_id=payload["dataset_id"], dataset_version=payload["dataset_version"],
                rule_version=payload["rule_version"], uploaded_by=teacher_id, notes=payload.get("notes", ""),
                source_group=payload.get("source_group"),
                source_submission_id=payload.get("source_submission_id"),
                source_student_id=payload.get("source_student_id"),
            )
            return json_response(model, 201)
        except (KeyError, ValueError, ModelValidationError, binascii.Error) as exc:
            return error_response("model_validation_failed", str(exc), 422)

    async def model_detail(request: Request):
        try:
            return json_response(center.get_model(request.path_params["model_id"]))
        except KeyError:
            return error_response("model_not_found", "Model was not found.", 404)

    async def evaluate(request: Request):
        teacher_id, denied = _teacher(request)
        if denied:
            return denied
        try:
            return json_response(center.save_evaluation(request.path_params["model_id"], await _json(request), teacher_id))
        except (KeyError, ValueError) as exc:
            return error_response("evaluation_failed", str(exc), 422)

    async def activate(request: Request):
        teacher_id, denied = _teacher(request)
        if denied:
            return denied
        try:
            # 2026-10-23 教師指令：撤銷「教師覆寫」路徑——請求明確帶 override=true
            # 一律拒絕（teacher_override_disabled），不留靜音放行的後門。
            # 啟用資格（health OK＋驗證通過且最高信心≥0.6＋類別名恰為四類＋
            # 非 DEMO_IMPORTED）全部由 Live activate_model 硬判定。
            payload = await _safe_json(request)
            if payload.get("override") is True or payload.get("override") == "true":
                return error_response(
                    "teacher_override_disabled",
                    "教師覆寫路徑已撤銷：啟用資格為硬規則，不符合條件的模型不得啟用。",
                    422,
                )
            return json_response(
                center.activate_model(request.path_params["model_id"], teacher_id)
            )
        except KeyError:
            return error_response("model_not_found", "Model was not found.", 404)
        except ValueError as exc:
            return error_response("activation_failed", str(exc), 422)

    async def archive(request: Request):
        teacher_id, denied = _teacher(request)
        if denied:
            return denied
        try:
            payload = await _safe_json(request)
            reason = str(payload.get("reason", "") or "")
            return json_response(center.archive_model(request.path_params["model_id"], teacher_id, reason))
        except KeyError:
            return error_response("model_not_found", "Model was not found.", 404)
        except (ValueError, ModelValidationError) as exc:
            # M4（2026-10-21）：ACTIVE／驗證中模型在此拒絶並回傳可追溯錯誤碼
            # （model_active_cannot_manage / model_validation_in_progress），
            # 不依賴前端隱藏按鈕。
            return error_response("model_manage_failed", str(exc), 422)

    async def restore(request: Request):
        teacher_id, denied = _teacher(request)
        if denied:
            return denied
        try:
            payload = await _safe_json(request)
            reason = str(payload.get("reason", "") or "")
            return json_response(center.restore_model(request.path_params["model_id"], teacher_id, reason))
        except KeyError:
            return error_response("model_not_found", "Model was not found.", 404)
        except (ValueError, ModelValidationError) as exc:
            return error_response("model_restore_failed", str(exc), 422)

    async def delete_model(request: Request):
        teacher_id, denied = _teacher(request)
        if denied:
            return denied
        try:
            payload = await _safe_json(request)
            reason = str(payload.get("reason", "") or "")
            return json_response(center.delete_model(request.path_params["model_id"], teacher_id, reason))
        except KeyError:
            return error_response("model_not_found", "Model was not found.", 404)
        except (ValueError, ModelValidationError) as exc:
            return error_response("model_delete_failed", str(exc), 422)

    async def prop_check(request: Request):
        try:
            if request.method == "GET":
                return json_response(center.demo_model_status("PROP_DIRECTION") or {
                    "status": "MODEL_NOT_READY", "simulation_mode": False,
                })
            payload = await _json(request)
            demo_model = center.demo_model_status("PROP_DIRECTION")
            if demo_model is not None and payload.get("image_base64"):
                return json_response(center.simulate_prop_check(
                    image_bytes=base64.b64decode(payload["image_base64"], validate=True),
                    image_width=float(payload["image_width"]),
                    image_height=float(payload["image_height"]),
                ))
            active = center.active_model("PROP_DIRECTION")
            detections = payload.get("detections")
            if detections is None and payload.get("image_base64"):
                active, detections = center.infer_active("PROP_DIRECTION", base64.b64decode(payload["image_base64"], validate=True))
            result = evaluate_prop(detections or [], float(payload["image_width"]), float(payload["image_height"]), float(payload.get("confidence_threshold", .5)))
            result["model"] = {"model_id": active["model_id"], "model_version": active["version"]} if active else None
            result["detections"] = detections or []
            if result["final_result"] != "PASS":
                weakest = min(detections or [], key=lambda item: item.get("confidence", 0), default={})
                center.create_hard_example({"model_type": "PROP_DIRECTION", "model_version": active["version"] if active else None, "source": "RULE_ENGINE_NON_PASS", "input_reference": payload.get("input_reference"), "prediction": weakest.get("class"), "confidence": weakest.get("confidence"), "notes": result["final_result"]})
            return json_response(result)
        except (KeyError, ValueError, ModelValidationError, binascii.Error) as exc:
            return error_response("invalid_prop_request", str(exc), 422)

    async def hover_analyze(request: Request):
        try:
            payload = await _json(request)
            profile = center.get_camera_profile(payload["camera_profile_id"]) if payload.get("camera_profile_id") else None
            active = center.active_model("FOUR_SIDE_HOVER")
            frames = []
            for frame in payload.get("frames", []):
                normalized = dict(frame)
                if normalized.get("image_base64"):
                    active, detections = center.infer_active("FOUR_SIDE_HOVER", base64.b64decode(normalized.pop("image_base64"), validate=True))
                    best = max(detections, key=lambda item: item.get("confidence", 0), default={})
                    normalized.update(direction=best.get("class", "UNKNOWN"), confidence=best.get("confidence", 0), center_x=best.get("center_x", 0), center_y=best.get("center_y", 0))
                frames.append(normalized)
            result = analyze_hover(frames, profile, payload.get("scoring_config"))
            result["model"] = {"model_id": active["model_id"], "model_version": active["version"]} if active else None
            if result["result"] != "PASS" or result["unknown_frames"]:
                center.create_hard_example({"model_type": "FOUR_SIDE_HOVER", "model_version": active["version"] if active else None, "source": "HOVER_ANALYSIS_DIFFICULTY", "input_reference": payload.get("input_reference"), "prediction": "UNKNOWN" if result["unknown_frames"] else result["result"], "confidence": None, "retention_status": "METADATA_AND_NECESSARY_FRAME_ONLY"})
            return json_response(result)
        except KeyError as exc:
            return error_response("camera_profile_not_found", str(exc), 404)
        except (ValueError, ModelValidationError, binascii.Error) as exc:
            return error_response("invalid_hover_request", str(exc), 422)

    async def datasets(request: Request):
        if request.method == "GET":
            return json_response(center.list_datasets(request.query_params.get("model_type")))
        teacher_id, denied = _teacher(request)
        if denied:
            return denied
        try:
            payload = await _json(request)
            payload["created_by"] = teacher_id
            return json_response(center.create_dataset(payload), 201)
        except (KeyError, ValueError) as exc:
            return error_response("dataset_create_failed", str(exc), 422)

    async def build_next(request: Request):
        teacher_id, denied = _teacher(request)
        if denied:
            return denied
        try:
            payload = await _json(request)
            return json_response(center.build_next_dataset(request.path_params["dataset_id"], payload.get("hard_example_ids", []), payload.get("new_samples", []), teacher_id), 201)
        except (KeyError, ValueError) as exc:
            return error_response("dataset_build_failed", str(exc), 422)

    async def export_dataset(request: Request):
        _teacher_id, denied = _teacher(request)
        if denied:
            return denied
        try:
            data = center.export_dataset(request.path_params["dataset_id"])
            return Response(data, media_type="application/zip", headers={"Content-Disposition": f"attachment; filename={request.path_params['dataset_id']}.zip"})
        except KeyError:
            return error_response("dataset_not_found", "Dataset was not found.", 404)

    async def hard_examples(request: Request):
        _teacher_id, denied = _teacher(request)
        if denied:
            return denied
        return json_response(center.list_hard_examples(request.query_params.get("status")))

    async def review_hard_example(request: Request):
        teacher_id, denied = _teacher(request)
        if denied:
            return denied
        try:
            payload = await _json(request)
            return json_response(center.review_hard_example(request.path_params["sample_id"], payload["decision"], payload.get("teacher_label"), teacher_id, payload.get("notes", "")))
        except KeyError:
            return error_response("hard_example_not_found", "Hard example was not found.", 404)
        except ValueError as exc:
            return error_response("hard_example_review_failed", str(exc), 422)

    async def camera_profiles(request: Request):
        teacher_id, denied = _teacher(request)
        if denied:
            return denied
        try:
            payload = await _json(request)
            return json_response(center.create_camera_profile(
                payload["four_corner_points"], teacher_id,
                camera_name=payload.get("camera_name", ""),
                width_m=float(payload.get("width_m", 2.0)),
                height_m=float(payload.get("height_m", 2.0)),
            ), 201)
        except (KeyError, ValueError) as exc:
            return error_response("camera_calibration_failed", str(exc), 422)

    async def submissions(request: Request):
        if request.method == "GET":
            teacher_id, denied = _teacher(request)
            if denied:
                return denied
            return json_response(center.list_submissions(request.query_params.get("task_id"), request.query_params.get("status")))
        try:
            payload = await _json(request)
            if not str(payload.get("original_filename", "")).lower().endswith(".pt"):
                raise ModelValidationError("pt_file_required")
            content = base64.b64decode(payload.get("file_base64", ""), validate=True)
            submission = center.create_submission(
                task_id=payload["task_id"], student_id=payload.get("student_id", "unknown"),
                group_id=payload.get("group_id", "X"), original_filename=payload["original_filename"],
                content=content, notes=payload.get("notes", ""),
                growth_record_id=payload.get("growth_record_id", ""),
                growth_record_slot=payload.get("growth_record_slot", ""),
                evidence_reference=payload.get("evidence_reference", ""),
                evidence_type=payload.get("evidence_type", ""),
            )
            return json_response(submission, 201)
        except (KeyError, ValueError, ModelValidationError, binascii.Error) as exc:
            return error_response("submission_failed", str(exc), 422)

    async def delete_submission(request: Request):
        """Delete one student submission record and its uploaded .pt (teacher-only).

        Refuses with a traceable 422 when any model depends on the submission, and
        always writes a timestamped backup before mutating the store.
        """
        teacher_id, denied = _teacher(request)
        if denied:
            return denied
        try:
            result = center.delete_submission(
                request.path_params["submission_id"], deleted_by=teacher_id
            )
            return json_response(result)
        except KeyError:
            return error_response("submission_not_found", "Submission was not found.", 404)
        except (ValueError, ModelValidationError) as exc:
            return error_response("submission_delete_failed", str(exc), 422)

    async def import_submission(request: Request):
        teacher_id, denied = _teacher(request)
        if denied:
            return denied
        try:
            submission_id = request.path_params["submission_id"]
            payload = await _json(request)
            if payload.get("demo_review_approved") is True:
                return json_response(center.approve_demo_submission(
                    submission_id, approved_by=teacher_id
                ))
            model = center.import_submission(
                submission_id, model_name=payload["model_name"], version=payload.get("version", "v1"),
                dataset_id=payload["dataset_id"], dataset_version=payload["dataset_version"],
                rule_version=payload["rule_version"], uploaded_by=teacher_id, notes=payload.get("notes", ""),
                class_name_mapping=payload.get("class_name_mapping"),
            )
            return json_response(model, 201)
        except (KeyError, ValueError, ModelValidationError) as exc:
            body = {"error": {"code": "import_failed", "message": str(exc)}}
            if isinstance(exc, ModelClassNamesMappingRequiredError):
                # 教師指令③：把實際類別名與任務預期一併回傳，教師頁據此渲染對照表。
                body["error"]["class_names_actual"] = exc.class_names_actual
                body["error"]["class_names_expected"] = exc.class_names_expected
            return json_response(body, 422)

    async def import_preflight(request: Request):
        """導入前唯讀預檢：回報類別名結局，供教師頁決定顯示對照表／補充提示／錯誤。"""
        teacher_id, denied = _teacher(request)
        if denied:
            return denied
        try:
            return json_response(center.preflight_import(request.path_params["submission_id"]))
        except KeyError:
            return error_response("submission_not_found", "Submission was not found.", 404)
        except (ValueError, ModelValidationError) as exc:
            return error_response("import_preflight_failed", str(exc), 422)

    async def record_import_failure(request: Request):
        """D2（2026-10-19）：記錄 Django 端發生的導入失敗原因（預檢、逾時、連線等）。

        只寫入既有 import_last_error 欄位與其代碼，不改動提交狀態。
        """
        teacher_id, denied = _teacher(request)
        if denied:
            return denied
        try:
            payload = await _json(request)
            return json_response(center.record_import_failure(
                request.path_params["submission_id"],
                message=str(payload.get("message") or ""),
                code=str(payload.get("code") or ""),
                recorded_by=teacher_id,
            ))
        except KeyError:
            return error_response("submission_not_found", "Submission was not found.", 404)
        except ValueError as exc:
            return error_response("import_failure_record_failed", str(exc), 422)

    async def quarantine_dataset(request: Request):
        """D1（2026-10-19）：把匯入失敗後留下的資料集標記隔離（不刪除）。

        供 Django 匯入封裝層在補償時呼叫；已被模型引用的資料集會拒絕隔離。
        """
        teacher_id, denied = _teacher(request)
        if denied:
            return denied
        try:
            payload = await _json(request)
            return json_response(center.quarantine_dataset(
                request.path_params["dataset_id"],
                reason=str(payload.get("reason") or ""),
                source_submission_id=str(payload.get("source_submission_id") or ""),
                quarantined_by=teacher_id,
            ))
        except KeyError:
            return error_response("dataset_not_found", "Dataset was not found.", 404)
        except ValueError as exc:
            return error_response("dataset_quarantine_failed", str(exc), 422)

    async def golden_sets(request: Request):
        if request.method == "GET":
            return json_response(center.list_golden_sets(request.query_params.get("model_type")))
        teacher_id, denied = _teacher(request)
        if denied:
            return denied
        try:
            payload = await _json(request)
            payload["created_by"] = teacher_id
            return json_response(center.create_golden_set(payload), 201)
        except (KeyError, ValueError) as exc:
            return error_response("golden_set_create_failed", str(exc), 422)

    async def golden_set_detail(request: Request):
        try:
            return json_response(center.get_golden_set(request.path_params["golden_set_id"]))
        except KeyError:
            return error_response("golden_set_not_found", "Golden set was not found.", 404)

    async def model_golden_sets(request: Request):
        try:
            return json_response(center.model_golden_sets(request.path_params["model_id"]))
        except KeyError:
            return error_response("model_not_found", "Model was not found.", 404)

    async def hover_video(request: Request):
        try:
            payload = await _json(request)
            if not str(payload.get("file_name", "")).lower().endswith((".mp4", ".mov", ".webm", ".avi")):
                raise ModelValidationError("video_file_required")
            content = base64.b64decode(payload.get("file_base64", ""), validate=True)
            profile = center.get_camera_profile(payload["camera_profile_id"]) if payload.get("camera_profile_id") else None
            result = center.process_video(
                content=content, frame_interval_seconds=float(payload.get("frame_interval_seconds", 0.5)),
                camera_profile=profile, config=payload.get("scoring_config"),
            )
            return json_response(result)
        except (KeyError, ValueError, ModelValidationError, binascii.Error) as exc:
            return error_response("video_analysis_failed", str(exc), 422)

    # ---- Teacher single-image validation against a named model ----
    async def validate_image(request: Request):
        """Run real inference with one specific model on one uploaded image.

        Read-only with respect to model status: it neither activates nor archives. The
        teacher page uses the returned detections as validation evidence.
        """
        teacher_id, denied = _teacher(request)
        if denied:
            return denied
        try:
            payload = await _json(request)
            image_base64 = payload.get("image_base64") or ""
            if not image_base64:
                raise ModelValidationError("image_required")
            image_bytes = base64.b64decode(image_base64, validate=True)
            expected = payload.get("expected_class") or None
            result = center.validate_image_with_model(
                request.path_params["model_id"], image_bytes,
                expected_class=expected,
                confidence_threshold=float(payload.get("confidence_threshold", 0.5)),
                rule_version=payload.get("rule_version") or None,
                image_width=payload.get("image_width"),
                image_height=payload.get("image_height"),
                validated_by=teacher_id,
            )
            result["validated_by"] = teacher_id
            return json_response(result)
        except KeyError:
            return error_response("model_not_found", "Model was not found.", 404)
        except (ValueError, ModelValidationError, binascii.Error) as exc:
            return error_response("image_validation_failed", str(exc), 422)

    # ---- Teacher single-image validation against a SUBMITTED submission (pre-import) ----
    async def validate_submission_image(request: Request):
        """Run real inference with one SUBMITTED submission's .pt on one uploaded image.

        Read-only: does not require the submission to be imported/enabled. Lets a
        teacher verify a student submission (e.g. ``sub-5d87f027``) before enabling it,
        which is the gap that previously blocked the teacher review flow.
        """
        teacher_id, denied = _teacher(request)
        if denied:
            return denied
        try:
            payload = await _json(request)
            image_base64 = payload.get("image_base64") or ""
            if not image_base64:
                raise ModelValidationError("image_required")
            image_bytes = base64.b64decode(image_base64, validate=True)
            expected = payload.get("expected_class") or None
            result = center.validate_image_with_submission(
                request.path_params["submission_id"], image_bytes,
                expected_class=expected,
                confidence_threshold=float(payload.get("confidence_threshold", 0.5)),
                rule_version=payload.get("rule_version") or None,
                image_width=payload.get("image_width"),
                image_height=payload.get("image_height"),
            )
            result["validated_by"] = teacher_id
            return json_response(result)
        except KeyError:
            return error_response("submission_not_found", "Submission was not found.", 404)
        except (ValueError, ModelValidationError, binascii.Error) as exc:
            return error_response("image_validation_failed", str(exc), 422)

    # ---- Data flywheel: seed models ----
    async def seed_model(request: Request):
        teacher_id, denied = _teacher(request)
        if denied:
            return denied
        try:
            payload = await _safe_json(request)
            note = str(payload.get("note") or "")
            recommended = payload.get("recommended", True)
            if not isinstance(recommended, bool):
                recommended = True
            generation = payload.get("generation")
            parent_model_id = payload.get("parent_model_id") or None
            return json_response(center.seed_model(
                request.path_params["model_id"], teacher_id,
                generation=generation, parent_model_id=parent_model_id,
                note=note, recommended=recommended,
            ), 200)
        except KeyError:
            return error_response("model_not_found", "Model was not found.", 404)
        except (ValueError, ModelValidationError) as exc:
            return error_response("seed_failed", str(exc), 422)

    async def unseed_model(request: Request):
        teacher_id, denied = _teacher(request)
        if denied:
            return denied
        try:
            payload = await _safe_json(request)
            reason = str(payload.get("reason") or "")
            return json_response(center.unseed_model(request.path_params["model_id"], teacher_id, reason))
        except KeyError:
            return error_response("model_not_found", "Model was not found.", 404)
        except (ValueError, ModelValidationError) as exc:
            return error_response("unseed_failed", str(exc), 422)

    async def recommended_seed(request: Request):
        model_type = request.path_params["model_type"]
        seed = center.recommended_seed(model_type)
        return json_response({
            "model_type": model_type,
            "recommended_seed": seed,
        })

    async def seed_version_chain(request: Request):
        model_type = request.path_params["model_type"]
        return json_response({
            "model_type": model_type,
            "version_chain": center.seed_version_chain(model_type),
        })

    async def download_seed(request: Request):
        """學員下載種子 .pt（數據飛輪 B-5）。僅要求已登入學員身分（student_id）。

        不使用教師閘門；student_id 為空時由 Django 端攔截（未登入不可見按鈕）。
        """
        try:
            model_id = request.query_params.get("model_id") or None
            model_type = request.query_params.get("model_type") or None
            student_id = request.headers.get("X-FDE-Student-ID", "").strip()
            # 2026-10-28：下載會寫審計且取得 .pt，必須確認呼叫方為可信內部來源。
            trusted, reason = internal_auth.verify(request)
            if not trusted:
                return error_response("internal_auth_rejected", f"Untrusted internal caller: {reason}.", 403)
            downloaded_by = student_id or request.query_params.get("student_id") or "anonymous"
            data = center.download_seed_model(
                model_id=model_id, model_type=model_type, downloaded_by=downloaded_by,
            )
            return json_response(data)
        except KeyError:
            return error_response("model_not_found", "Model was not found.", 404)
        except ValueError as exc:
            return error_response("seed_download_failed", str(exc), 422)
        except ModelValidationError as exc:
            return error_response("seed_download_failed", str(exc), 422)

    # ---- Version history & rollback ----
    async def model_history(request: Request):
        _teacher_id, denied = _teacher(request)
        if denied:
            return denied
        model_type = request.path_params["model_type"]
        try:
            return json_response({
                "model_type": model_type,
                "history": center.model_history(model_type),
                "active": center.active_model(model_type),
                "inference_source": center.verify_active_model_inference(model_type),
            })
        except (KeyError, ValueError) as exc:
            return error_response("model_history_failed", str(exc), 422)

    async def rollback(request: Request):
        teacher_id, denied = _teacher(request)
        if denied:
            return denied
        try:
            model_type = request.path_params["model_type"]
            result = center.rollback_model(model_type, teacher_id)
            result["inference_source"] = center.verify_active_model_inference(model_type)
            return json_response(result)
        except ValueError as exc:
            return error_response("rollback_failed", str(exc), 422)

    return [
        Route("/api/v1/vision/models", models, methods=["GET", "POST"]),
        Route("/api/v1/vision/models/{model_id}", model_detail, methods=["GET"]),
        Route("/api/v1/vision/models/{model_id}/evaluate", evaluate, methods=["POST"]),
        Route("/api/v1/vision/models/{model_id}/activate", activate, methods=["POST"]),
        Route("/api/v1/vision/models/{model_id}/archive", archive, methods=["POST"]),
        Route("/api/v1/vision/models/{model_id}/restore", restore, methods=["POST"]),
        Route("/api/v1/vision/models/{model_id}/delete", delete_model, methods=["POST"]),
        Route("/api/v1/vision/models/{model_id}/validate-image", validate_image, methods=["POST"]),
        Route("/api/v1/vision/tasks/{model_type}/history", model_history, methods=["GET"]),
        Route("/api/v1/vision/tasks/{model_type}/rollback", rollback, methods=["POST"]),
        Route("/api/v1/vision/prop-check", prop_check, methods=["GET", "POST"]),
        Route("/api/v1/vision/hover-analyze", hover_analyze, methods=["POST"]),
        Route("/api/v1/vision/hover-video", hover_video, methods=["POST"]),
        Route("/api/v1/vision/datasets", datasets, methods=["GET", "POST"]),
        Route("/api/v1/vision/datasets/{dataset_id}/build-next", build_next, methods=["POST"]),
        Route("/api/v1/vision/datasets/{dataset_id}/quarantine", quarantine_dataset, methods=["POST"]),
        Route("/api/v1/vision/datasets/{dataset_id}/export", export_dataset, methods=["GET"]),
        Route("/api/v1/vision/hard-examples", hard_examples, methods=["GET"]),
        Route("/api/v1/vision/hard-examples/{sample_id}/review", review_hard_example, methods=["POST"]),
        Route("/api/v1/vision/camera-profiles", camera_profiles, methods=["POST"]),
        Route("/api/v1/vision/submissions", submissions, methods=["GET", "POST"]),
        Route("/api/v1/vision/submissions/{submission_id}", delete_submission, methods=["DELETE"]),
        Route("/api/v1/vision/submissions/{submission_id}/import-preflight", import_preflight, methods=["POST"]),
        Route("/api/v1/vision/submissions/{submission_id}/import", import_submission, methods=["POST"]),
        Route("/api/v1/vision/submissions/{submission_id}/import-failure", record_import_failure, methods=["POST"]),
        Route("/api/v1/vision/submissions/{submission_id}/validate-image", validate_submission_image, methods=["POST"]),
        Route("/api/v1/vision/models/{model_id}/seed", seed_model, methods=["POST"]),
        Route("/api/v1/vision/models/{model_id}/unseed", unseed_model, methods=["POST"]),
        Route("/api/v1/vision/tasks/{model_type}/recommended-seed", recommended_seed, methods=["GET"]),
        Route("/api/v1/vision/tasks/{model_type}/seed-version-chain", seed_version_chain, methods=["GET"]),
        Route("/api/v1/vision/seed/download", download_seed, methods=["GET"]),
        Route("/api/v1/vision/golden-sets", golden_sets, methods=["GET", "POST"]),
        Route("/api/v1/vision/golden-sets/{golden_set_id}", golden_set_detail, methods=["GET"]),
        Route("/api/v1/vision/models/{model_id}/golden-sets", model_golden_sets, methods=["GET"]),
    ]
