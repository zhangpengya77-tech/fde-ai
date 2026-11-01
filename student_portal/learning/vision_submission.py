import base64
import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.conf import settings

from . import internal_auth


class VisionImportClassNamesMappingRequired(RuntimeError):
    """Live 回報：模型類別名與任務預期不同但數量一致，需要教師提供對照表。"""

    def __init__(self, class_names_actual, class_names_expected):
        super().__init__("vision_api_rejected:422:model_class_names_mapping_required")
        self.class_names_actual = [str(name) for name in class_names_actual]
        self.class_names_expected = [str(name) for name in class_names_expected]


class VisionImportClassNamesMissing(RuntimeError):
    """Live 回報：模型缺少類別名稱（model.names 為空），教師需補充後重試。"""

    def __init__(self):
        super().__init__("vision_api_rejected:422:model_class_names_missing")


def _decode_error_body(exc) -> tuple[str, dict]:
    """完整讀取 Live 4xx 錯誤內容（教師指令⑤：不截斷），解出碼、訊息與附加資料。"""
    detail = ""
    try:
        detail = exc.read().decode("utf-8", errors="replace")
    except Exception:
        pass
    code = ""
    message = detail or f"HTTP {getattr(exc, 'code', '?')}"
    extras: dict = {}
    try:
        parsed = json.loads(detail)
        error = parsed.get("error") if isinstance(parsed, dict) else None
        if isinstance(error, dict):
            code = str(error.get("code") or "")
            message = str(error.get("message") or message)
            extras = {
                key: value for key, value in error.items()
                if key not in ("code", "message")
            }
    except (ValueError, TypeError):
        pass
    if code and code not in message:
        message = f"{code}:{message}"
    return message, extras


def _rejected(exc) -> RuntimeError:
    """把 Live 的 4xx 回應轉成 Django 端例外；類別名相關錯誤轉為可識別型別。"""
    message, extras = _decode_error_body(exc)
    if "model_class_names_mapping_required" in message:
        return VisionImportClassNamesMappingRequired(
            extras.get("class_names_actual") or [],
            extras.get("class_names_expected") or [],
        )
    if "model_class_names_missing" in message:
        return VisionImportClassNamesMissing()
    return RuntimeError(f"vision_api_rejected:{exc.code}:{message}")


def _post(path, payload, timeout=None, *, teacher_id=""):
    """呼叫既有 Live Backend 的視覺 API。

    真實推論（載入 .pt）一律由 Live Backend 執行：本機 Django 環境沒有
    ultralytics / torch / cv2 / numpy，且學生 .pt 為 PyTorch pickle，
    載入即執行任意程式碼 —— 禁止在 Django 服務進程內載入。
    本模組只負責安全地跨進程轉發請求與解讀結果。
    """
    base = settings.VISION_SUBMISSION_API_BASE_URL.rstrip("/")
    headers = {"Content-Type": "application/json"}
    if teacher_id:
        headers["X-FDE-Role"] = "teacher"
        headers["X-FDE-Teacher-ID"] = str(teacher_id)
    # 2026-10-28（階段四 B）：加上伺服器端簽章，讓 Live 能區分「Django 轉發」與「本機偽造」。
    headers = internal_auth.signed_headers("POST", path.split("?")[0], headers)
    request = Request(
        f"{base}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    seconds = timeout or settings.VISION_SUBMISSION_API_TIMEOUT_SECONDS
    try:
        with urlopen(request, timeout=seconds) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise _rejected(exc) from exc
    except (URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("vision_api_unavailable") from exc


def _get(path, timeout=None, *, teacher_id=""):
    base = settings.VISION_SUBMISSION_API_BASE_URL.rstrip("/")
    headers = {}
    if teacher_id:
        headers["X-FDE-Role"] = "teacher"
        headers["X-FDE-Teacher-ID"] = str(teacher_id)
    headers = internal_auth.signed_headers("GET", path.split("?")[0], headers)
    request = Request(f"{base}{path}", headers=headers, method="GET")
    seconds = timeout or settings.VISION_SUBMISSION_API_TIMEOUT_SECONDS
    try:
        with urlopen(request, timeout=seconds) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise _rejected(exc) from exc
    except (URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("vision_api_unavailable") from exc


def vision_api_health(*, teacher_id=""):
    """確認 Live Backend 是否可用；教師頁面據此決定按鈕可否啟用。"""
    try:
        _get("/api/v1/vision/models", teacher_id=teacher_id)
        return True, ""
    except RuntimeError as exc:
        return False, str(exc)


def validate_image_with_model(
    *, model_id, image_bytes, teacher_id, expected_class=None,
    confidence_threshold=0.5, image_width=None, image_height=None,
):
    """區域二：對指定模型跑真實推論，回傳偵測框、類別、信心值與規則判定。

    唯讀操作：不改動任何模型狀態，不切換 ACTIVE。
    """
    if not image_bytes:
        raise RuntimeError("image_required")
    payload = {
        "image_base64": base64.b64encode(image_bytes).decode("ascii"),
        "confidence_threshold": float(confidence_threshold),
    }
    if expected_class:
        payload["expected_class"] = str(expected_class)
    if image_width is not None:
        payload["image_width"] = float(image_width)
    if image_height is not None:
        payload["image_height"] = float(image_height)
    # 推論需要載入模型，給予較長逾時。
    return _post(
        f"/api/v1/vision/models/{model_id}/validate-image",
        payload,
        timeout=max(settings.VISION_SUBMISSION_API_TIMEOUT_SECONDS, 120),
        teacher_id=teacher_id,
    )


def validate_image_with_submission(
    *, submission_id, image_bytes, teacher_id, expected_class=None,
    confidence_threshold=0.5, image_width=None, image_height=None,
):
    """區域一/二：對 SUBMITTED 學員提交直接跑真實推論（不要求匯入/啟用）。

    唯讀操作：不改動提交狀態、不切換 ACTIVE。對應 Live 路由
    POST /api/v1/vision/submissions/{submission_id}/validate-image。
    """
    if not image_bytes:
        raise RuntimeError("image_required")
    payload = {
        "image_base64": base64.b64encode(image_bytes).decode("ascii"),
        "confidence_threshold": float(confidence_threshold),
    }
    if expected_class:
        payload["expected_class"] = str(expected_class)
    if image_width is not None:
        payload["image_width"] = float(image_width)
    if image_height is not None:
        payload["image_height"] = float(image_height)
    # 推論需要載入模型，給予較長逾時。
    return _post(
        f"/api/v1/vision/submissions/{submission_id}/validate-image",
        payload,
        timeout=max(settings.VISION_SUBMISSION_API_TIMEOUT_SECONDS, 120),
        teacher_id=teacher_id,
    )


def prop_check(*, image_bytes, input_reference="", confidence_threshold=0.5):
    """使用既有 ACTIVE PROP_DIRECTION 模型執行學員圖片辨識。"""
    if not image_bytes:
        raise RuntimeError("image_required")
    try:
        from io import BytesIO

        from django.core.files.images import get_image_dimensions

        image_width, image_height = get_image_dimensions(BytesIO(image_bytes))
    except Exception as exc:
        raise RuntimeError("invalid_image") from exc
    if not image_width or not image_height:
        raise RuntimeError("invalid_image")
    return _post(
        "/api/v1/vision/prop-check",
        {
            "image_base64": base64.b64encode(image_bytes).decode("ascii"),
            "image_width": float(image_width),
            "image_height": float(image_height),
            "confidence_threshold": float(confidence_threshold),
            "input_reference": str(input_reference or ""),
        },
        timeout=max(settings.VISION_SUBMISSION_API_TIMEOUT_SECONDS, 120),
    )


def _delete(path, timeout=None, *, teacher_id=""):
    """以 DELETE 呼叫 Live Backend（僅轉發；.pt 一律不進入 Django 進程）。"""
    base = settings.VISION_SUBMISSION_API_BASE_URL.rstrip("/")
    headers = {}
    if teacher_id:
        headers["X-FDE-Role"] = "teacher"
        headers["X-FDE-Teacher-ID"] = str(teacher_id)
    # 2026-10-28（階段四 B）：DELETE 同樣要簽章，否則 signed 模式下刪除會被拒。
    headers = internal_auth.signed_headers("DELETE", path.split("?")[0], headers)
    request = Request(f"{base}{path}", headers=headers, method="DELETE")
    seconds = timeout or settings.VISION_SUBMISSION_API_TIMEOUT_SECONDS
    try:
        with urlopen(request, timeout=seconds) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise _rejected(exc) from exc
    except (URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("vision_api_unavailable") from exc


def delete_submission(*, submission_id, teacher_id):
    """刪除一筆學員上傳（store 記錄＋.pt 實體檔；有模型依賴時會被拒絕）。

    刪除動作由 Live Backend 執行（自動先備份）；Django 端只轉發並回報結果。
    """
    return _delete(f"/api/v1/vision/submissions/{submission_id}", teacher_id=teacher_id)


def prop_check_status():
    """Read the approved DEMO adapter record without loading a model file."""
    return _get("/api/v1/vision/prop-check")


def activate_model(*, model_id, teacher_id, override=False):
    """區域三：把已驗證模型設為該任務的正式模型（ACTIVE）。

    切換動作由 Live Backend 執行；Django 端只轉發並記錄結果。

    `override=True`（2026-10-22 教師指令）：模型不符合自動品質判定時不再一律被擋，
    改由教師看過「② 圖片驗證」結果後自行決定。Live 端仍會把被覆寫的閘門原因
    逐條記進審計；`quarantined`（隔離）與 .pt 不可讀兩道硬攔**不會**被覆寫放行。
    """
    return _post(
        f"/api/v1/vision/models/{model_id}/activate",
        {"override": bool(override)},
        teacher_id=teacher_id,
    )


def rollback_model(*, model_type, teacher_id):
    """區域三：一鍵回復上一個已驗證版本。"""
    return _post(
        f"/api/v1/vision/tasks/{model_type}/rollback", {}, teacher_id=teacher_id
    )


def task_model_history(*, model_type, teacher_id):
    """區域三：讀取任務的完整版本歷史與目前推論來源。"""
    return _get(f"/api/v1/vision/tasks/{model_type}/history", teacher_id=teacher_id)


def archive_model(*, model_id, teacher_id, reason=""):
    """M1（2026-10-21）：歸檔非 ACTIVE 模型（.pt 保留，可還原）。

    Live 端硬攔 ACTIVE 與驗證中模型，並在成功後把來源提交標記「已被取代」，
    讓學員可重新上傳新模型。
    """
    return _post(
        f"/api/v1/vision/models/{model_id}/archive",
        {"reason": str(reason or "")},
        teacher_id=teacher_id,
    )


def restore_model(*, model_id, teacher_id, reason=""):
    """M2（2026-10-21）：一鍵還原教師手動歸檔的模型。"""
    return _post(
        f"/api/v1/vision/models/{model_id}/restore",
        {"reason": str(reason or "")},
        teacher_id=teacher_id,
    )


def delete_model(*, model_id, teacher_id, reason=""):
    """M3（2026-10-21）：永久刪除模型記錄；.pt 僅在無其他引用時才實際刪除。"""
    return _post(
        f"/api/v1/vision/models/{model_id}/delete",
        {"reason": str(reason or "")},
        teacher_id=teacher_id,
    )


def upload_teacher_model(
    *, model_type, model_name, version, content, dataset_id, dataset_version,
    rule_version, teacher_id, notes="",
):
    """區域三：教師自行上傳 best.pt（走與學員模型相同的驗證閘門）。"""
    return _post(
        "/api/v1/vision/models",
        {
            "model_type": model_type,
            "model_name": model_name,
            "version": version,
            "file_name": "best.pt",
            "file_base64": base64.b64encode(content).decode("ascii"),
            "dataset_id": dataset_id,
            "dataset_version": dataset_version,
            "rule_version": rule_version,
            "notes": notes,
        },
        timeout=max(settings.VISION_SUBMISSION_API_TIMEOUT_SECONDS, 180),
        teacher_id=teacher_id,
    )


def list_models(*, model_type=None):
    suffix = f"?model_type={model_type}" if model_type else ""
    return _get(f"/api/v1/vision/models{suffix}")


def list_datasets(*, model_type=None):
    suffix = f"?model_type={model_type}" if model_type else ""
    return _get(f"/api/v1/vision/datasets{suffix}")


def list_submissions(*, task_id=None, teacher_id=""):
    suffix = f"?task_id={task_id}" if task_id else ""
    return _get(f"/api/v1/vision/submissions{suffix}", teacher_id=teacher_id)


def import_submission(
    *, submission_id, model_name, version, dataset_id, dataset_version,
    rule_version, teacher_id, notes="", class_name_mapping=None,
):
    """區域一 → 區域三：教師把學員提交導入為候選模型。

    class_name_mapping：教師指令③的「類別名對照表」——{模型實際類別名: 任務預期類別名}。
    僅在 Live 預檢回報「數量一致、名稱不同」時由教師頁提交。
    """
    payload = {
        "model_name": model_name,
        "version": version,
        "dataset_id": dataset_id,
        "dataset_version": dataset_version,
        "rule_version": rule_version,
        "notes": notes,
    }
    if class_name_mapping:
        payload["class_name_mapping"] = {
            str(key): str(value) for key, value in dict(class_name_mapping).items()
        }
    return _post(
        f"/api/v1/vision/submissions/{submission_id}/import",
        payload,
        timeout=max(settings.VISION_SUBMISSION_API_TIMEOUT_SECONDS, 180),
        teacher_id=teacher_id,
    )


def preflight_import(*, submission_id, teacher_id):
    """導入前唯讀預檢：回報類別名結局，供教師頁決定顯示對照表／補充提示／錯誤。"""
    return _post(
        f"/api/v1/vision/submissions/{submission_id}/import-preflight",
        {},
        timeout=max(settings.VISION_SUBMISSION_API_TIMEOUT_SECONDS, 180),
        teacher_id=teacher_id,
    )


def approve_demo_submission(*, submission_id, teacher_id):
    """Approve an inert R07 submission for the explicitly labelled DEMO adapter."""
    return _post(
        f"/api/v1/vision/submissions/{submission_id}/import",
        {"demo_review_approved": True},
        teacher_id=teacher_id,
    )


def create_dataset(*, model_type, dataset_version, teacher_id, notes=""):
    return _post(
        "/api/v1/vision/datasets",
        {"model_type": model_type, "dataset_version": dataset_version, "notes": notes},
        teacher_id=teacher_id,
    )


def quarantine_dataset(*, dataset_id, reason, teacher_id, source_submission_id=""):
    """D1（2026-10-19）：匯入失敗後隔離剛建立的資料集（不刪除，可還原）。"""
    return _post(
        f"/api/v1/vision/datasets/{dataset_id}/quarantine",
        {
            "reason": str(reason or "import_failed"),
            "source_submission_id": str(source_submission_id or ""),
        },
        teacher_id=teacher_id,
    )


def record_import_failure(*, submission_id, message, code="", teacher_id):
    """D2（2026-10-19）：把 Django 端發生的導入失敗原因寫回 Live 的 import_last_error。"""
    return _post(
        f"/api/v1/vision/submissions/{submission_id}/import-failure",
        {"message": str(message or ""), "code": str(code or "")},
        teacher_id=teacher_id,
    )


def list_hard_examples(*, teacher_id, status=None):
    suffix = f"?status={status}" if status else ""
    return _get(f"/api/v1/vision/hard-examples{suffix}", teacher_id=teacher_id)


def submit_model_evidence_to_vision(
    *, task_type, student_id, group_id, growth_record_id, growth_record_slot,
    evidence_reference, evidence_type, original_filename, content, notes="",
    parent_model_id="",
):
    """將 R07 模型證據送入既有 Vision Submission，且不自動啟用模型。

    parent_model_id（2026-10-23 數據飛輪）：學員可選填「基於的種子模型」，
    匯入時由 Live 複製到模型紀錄，形成第 N 期 → 第 N+1 期的版本鏈。
    """
    payload = {
        "task_id": task_type,
        "student_id": student_id,
        "group_id": group_id,
        "growth_record_id": str(growth_record_id),
        "growth_record_slot": growth_record_slot,
        "evidence_reference": evidence_reference,
        "evidence_type": evidence_type,
        "original_filename": original_filename,
        "file_base64": base64.b64encode(content).decode("ascii"),
        "notes": notes,
        "parent_model_id": str(parent_model_id or ""),
    }
    url = f"{settings.VISION_SUBMISSION_API_BASE_URL.rstrip('/')}/api/v1/vision/submissions"
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=settings.VISION_SUBMISSION_API_TIMEOUT_SECONDS) as response:
            result = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("vision_submission_unavailable") from exc
    if result.get("status") != "SUBMITTED" or not result.get("submission_id"):
        raise RuntimeError("vision_submission_rejected")
    return result


# ---- 數據飛輪（B，2026-10-23）：種子模型 ----
def seed_model(*, model_id, teacher_id, note="", recommended=True, generation=None, parent_model_id=None):
    """教師把合格模型入庫為種子（基礎訓練模型）。"""
    payload = {
        "note": str(note or ""),
        "recommended": bool(recommended),
    }
    if generation is not None:
        payload["generation"] = generation
    if parent_model_id is not None:
        payload["parent_model_id"] = str(parent_model_id)
    return _post(
        f"/api/v1/vision/models/{model_id}/seed",
        payload,
        teacher_id=teacher_id,
    )


def unseed_model(*, model_id, teacher_id, reason=""):
    """教師取消種子標記（取消後才可永久刪除）。"""
    return _post(
        f"/api/v1/vision/models/{model_id}/unseed",
        {"reason": str(reason or "")},
        teacher_id=teacher_id,
    )


def recommended_seed(*, model_type, teacher_id=""):
    """讀取該任務的「當前推薦基礎模型」（學員下一期訓練起點）。"""
    return _get(
        f"/api/v1/vision/tasks/{model_type}/recommended-seed",
        teacher_id=teacher_id,
    )


def seed_version_chain(*, model_type, teacher_id=""):
    """該任務的種子版本鏈（期數／mAP50／驗證信心變化）。"""
    return _get(
        f"/api/v1/vision/tasks/{model_type}/seed-version-chain",
        teacher_id=teacher_id,
    )


def download_seed(*, model_id=None, model_type=None, student_id=""):
    """學員下載種子 .pt 作為訓練起點（僅已登入學員可見按鈕；下載寫審計）。

    GET 請求帶 X-FDE-Student-ID 表頭；未登入時由 Django 端控制可見性。
    """
    base = settings.VISION_SUBMISSION_API_BASE_URL.rstrip("/")
    params = []
    if model_id:
        params.append(f"model_id={model_id}")
    if model_type:
        params.append(f"model_type={model_type}")
    query = ("?" + "&".join(params)) if params else ""
    headers = {"Content-Type": "application/json"}
    if student_id:
        headers["X-FDE-Student-ID"] = str(student_id)
    headers = internal_auth.signed_headers("GET", "/api/v1/vision/seed/download", headers)
    request = Request(
        f"{base}/api/v1/vision/seed/download{query}",
        headers=headers,
        method="GET",
    )
    try:
        with urlopen(request, timeout=settings.VISION_SUBMISSION_API_TIMEOUT_SECONDS) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise _rejected(exc) from exc
    except (URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("vision_api_unavailable") from exc
