import hashlib
import ipaddress
import json
import logging
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.conf import settings
from django.core.cache import cache
from django.http import JsonResponse
from django.views.decorators.http import require_POST


logger = logging.getLogger(__name__)


def _error(message, status):
    response = JsonResponse({"ok": False, "error": message}, status=status)
    response["Cache-Control"] = "no-store"
    return response


def _request_is_too_large(request):
    limit = settings.PUBLIC_AI_MAX_REQUEST_BYTES
    try:
        content_length = int(request.META.get("CONTENT_LENGTH", "0"))
    except (TypeError, ValueError):
        return True
    return content_length > limit or len(request.body) > limit


def _payload(request):
    try:
        value = json.loads(request.body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def _valid_payload(service, payload):
    if service in {"rag", "voice"}:
        question = payload.get("question")
        max_length = 4000 if service == "rag" else 2000
        return (
            isinstance(question, str)
            and 0 < len(question.strip()) <= max_length
            and len(str(payload.get("locale", "zh-TW"))) <= 20
        )
    if service == "detect":
        image_data = payload.get("imageData")
        return (
            isinstance(image_data, str)
            and image_data.startswith("data:image/")
            and ";base64," in image_data[:64]
            and len(str(payload.get("fileName", ""))) <= 255
        )
    video_data = payload.get("videoData")
    return (
        isinstance(video_data, str)
        and video_data.startswith("data:video/")
        and ";base64," in video_data[:64]
        and len(str(payload.get("fileName", ""))) <= 255
    )


def _allowed_by_rate_limit(request, service):
    limit_setting = {
        "rag": "PUBLIC_RAG_REQUESTS_PER_MINUTE",
        "voice": "PUBLIC_VOICE_REQUESTS_PER_MINUTE",
    }.get(service, "PUBLIC_INSPECTION_REQUESTS_PER_MINUTE")
    limit = max(1, int(getattr(settings, limit_setting)))
    address = _client_address(request)
    bucket = int(time.time() // 60)
    digest = hashlib.sha256(address.encode("utf-8", "replace")).hexdigest()[:24]
    key = f"public-ai:{service}:{digest}:{bucket}"
    if cache.add(key, 1, timeout=120):
        return True
    try:
        return cache.incr(key) <= limit
    except ValueError:
        return cache.add(key, 1, timeout=120)


def _client_address(request):
    remote_address = request.META.get("REMOTE_ADDR", "unknown")
    trusted_proxy_ips = getattr(settings, "PUBLIC_AI_TRUSTED_PROXY_IPS", frozenset())
    if remote_address not in trusted_proxy_ips:
        return remote_address

    forwarded_address = request.META.get("HTTP_CF_CONNECTING_IP", "").strip()
    if not forwarded_address:
        forwarded_address = request.META.get("HTTP_X_FORWARDED_FOR", "").split(",", 1)[0].strip()
    try:
        ipaddress.ip_address(forwarded_address)
    except ValueError:
        return remote_address
    return forwarded_address


def _upstream_url(service):
    if service == "rag":
        base = settings.PUBLIC_RAG_UPSTREAM_URL.strip().rstrip("/")
        path = "/api/rag/ask"
    elif service == "voice":
        base = settings.PUBLIC_VOICE_UPSTREAM_URL.strip().rstrip("/")
        path = "/api/voice/ask"
    else:
        base = settings.PUBLIC_INSPECTION_UPSTREAM_URL.strip().rstrip("/")
        path = "/api/detect" if service == "detect" else "/api/hover"
    if not base:
        return ""
    return f"{base}{path}"


def proxy_public_ai(request, service):
    if _request_is_too_large(request):
        return _error("請求內容過大，請縮小檔案後重試。", 413)
    payload = _payload(request)
    if payload is None or not _valid_payload(service, payload):
        return _error("請求格式無效，請檢查輸入內容後重試。", 400)
    if not _allowed_by_rate_limit(request, service):
        return _error("操作次數較多，請稍後再試。", 429)

    upstream_url = _upstream_url(service)
    if not upstream_url:
        return _error("AI 服務目前未連線，請稍後再試。", 503)

    request_headers = {"Content-Type": "application/json", "Accept": "application/json"}
    upstream_request = Request(
        upstream_url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=request_headers,
        method="POST",
    )
    try:
        with urlopen(upstream_request, timeout=settings.PUBLIC_AI_TIMEOUT_SECONDS) as upstream:
            raw_response = upstream.read(settings.PUBLIC_AI_MAX_REQUEST_BYTES + 1)
            if len(raw_response) > settings.PUBLIC_AI_MAX_REQUEST_BYTES:
                return _error("AI 服務回傳內容過大。", 502)
            response_payload = json.loads(raw_response.decode("utf-8"))
            if not isinstance(response_payload, dict):
                raise ValueError("upstream JSON must be an object")
    except HTTPError as exc:
        logger.warning("Public AI upstream returned HTTP %s (%s).", exc.code, service)
        return _error("AI 服務目前無法處理此請求，請稍後再試。", 502)
    except (URLError, TimeoutError, OSError, ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        logger.warning("Public AI upstream failed (%s, %s).", service, type(exc).__name__)
        return _error("AI 服務目前無法連線，請稍後再試。", 503)

    response = JsonResponse(response_payload)
    response["Cache-Control"] = "no-store"
    return response


@require_POST
def public_rag_ask(request):
    return proxy_public_ai(request, "rag")


@require_POST
def public_inspection_detect(request):
    return proxy_public_ai(request, "detect")


@require_POST
def public_inspection_hover(request):
    return proxy_public_ai(request, "hover")


@require_POST
def public_voice_ask(request):
    return proxy_public_ai(request, "voice")
