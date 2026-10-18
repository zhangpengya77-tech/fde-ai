from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterator
from urllib.parse import quote

from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse


SUPPORTED_EXTENSIONS = frozenset({".exe", ".msi", ".zip", ".7z", ".rar", ".pdf"})
CHUNK_SIZE = 1024 * 1024
_RANGE_PATTERN = re.compile(r"^bytes=(\d*)-(\d*)$")


# 讀取下載根目錄；優先使用正式 FDE-Downloads，否則沿用老師既有下載資料夾。
def configured_download_root() -> Path:
    configured = os.environ.get("FDE_DOWNLOAD_ROOT", "").strip()
    if configured:
        return Path(configured)
    primary = Path(r"D:\FDE-Downloads")
    if primary.is_dir():
        return primary
    return Path(r"D:\下載中心文件")


# Manifest 僅保存相對路徑，避免將 Windows 實體路徑回傳給瀏覽器。
def configured_manifest_path(root: Path) -> Path:
    configured = os.environ.get("FDE_DOWNLOAD_MANIFEST", "").strip()
    return Path(configured) if configured else root / "download_manifest.json"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(CHUNK_SIZE), b""):
            digest.update(block)
    return digest.hexdigest()


def _relative_depth(relative_path: Path) -> int:
    return len(relative_path.parts)


def _metadata(relative_path: Path) -> dict[str, str]:
    # 以老師整理的父資料夾作為產品脈絡，避免把 WebODM 的相依工具誤當成建模軟體。
    path_value = " ".join(relative_path.parts).lower()
    filename = relative_path.name.lower()

    if filename == "git_installer.exe" or filename.startswith("git_"):
        return {
            "category": "development-installation-tool",
            "display_name": "Git 安裝工具",
            "description_zh": "Git 安裝工具；部分開源教學軟體部署時使用。",
            "description_en": "Git installer used by selected open-source course software.",
        }
    if "webodm" in path_value or "odm" in path_value:
        return {
            "category": "3d-mapping",
            "display_name": "WebODM",
            "description_zh": "航拍影像測繪、正射影像與 3D 建模教學工具。",
            "description_en": "Aerial mapping, orthophoto, and 3D modelling training tool.",
        }
    if "missionplanner" in path_value:
        return {
            "category": "ground-station",
            "display_name": "Mission Planner",
            "description_zh": "ArduPilot 地面站操作與任務規劃工具。",
            "description_en": "ArduPilot ground-station and mission-planning tool.",
        }
    if "hqgc" in path_value or "qgc" in path_value:
        return {
            "category": "ground-station",
            "display_name": "HQGC Student",
            "description_zh": "課程使用的地面站操作工具。",
            "description_en": "Course ground-station operation tool.",
        }
    if "naza" in path_value or "dji" in path_value:
        return {
            "category": "drivers" if "driver" in path_value or "驅動" in path_value else "ground-station",
            "display_name": relative_path.stem,
            "description_zh": "DJI NAZA 相關地面站或驅動工具。",
            "description_en": "DJI NAZA ground-station or driver tool.",
        }
    if "yolo" in path_value or "fde-ai" in path_value or "視覺" in path_value:
        return {
            "category": "ai-training-tools",
            "display_name": "FDE-AI YOLO",
            "description_zh": "FDE-AI 視覺訓練教學工具。",
            "description_en": "FDE-AI vision-training tool.",
        }
    return {
        "category": "others",
        "display_name": relative_path.stem,
        "description_zh": "課程使用的安裝檔或工具。",
        "description_en": "Course software or supporting tool.",
    }

def _version(filename: str) -> str:
    match = re.search(r"(?:v|version|_|-)(\d+(?:\.\d+){1,3})(?=$|[^0-9])", filename, re.IGNORECASE)
    if match:
        return match.group(1)
    match = re.search(r"\b(\d+\.\d+(?:\.\d+)?)\b", filename)
    return match.group(1) if match else ""


def _identifier(relative_path: Path) -> str:
    safe_stem = re.sub(r"[^a-z0-9]+", "-", relative_path.stem.lower()).strip("-") or "download"
    fingerprint = hashlib.sha256(relative_path.as_posix().encode("utf-8")).hexdigest()[:10]
    return f"{safe_stem[:42]}-{fingerprint}"


def _item_for(path: Path, root: Path) -> dict:
    relative = path.relative_to(root)
    metadata = _metadata(relative)
    size = path.stat().st_size
    return {
        "id": _identifier(relative),
        "display_name": metadata["display_name"],
        "filename": path.name,
        "category": metadata["category"],
        "version": _version(path.name),
        "size": size,
        "extension": path.suffix.lower(),
        "last_modified": datetime.fromtimestamp(path.stat().st_mtime, UTC).isoformat(),
        "sha256": _sha256(path),
        "description_zh": metadata["description_zh"],
        "description_en": metadata["description_en"],
        "install_note": "僅支援 Windows；下載後請依安裝程式指示完成安裝。",
        "platform": "Windows Only",
        "enabled": True,
        "download_path": f"/api/downloads/{_identifier(relative)}/file",
        "source_relative_path": relative.as_posix(),
    }

# 掃描老師指定目錄的可下載檔案，略過深層第三方原始碼或測試檔案。
def refresh_manifest(root: Path | None = None, manifest_path: Path | None = None, *, max_depth: int = 4) -> dict:
    root = (root or configured_download_root()).resolve()
    if not root.is_dir():
        raise FileNotFoundError("download_root_not_found")
    records = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.name.startswith("~$") or path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            continue
        relative = path.relative_to(root)
        if _relative_depth(relative) > max_depth:
            continue
        records.append(_item_for(path, root))
    manifest = {
        "schema_version": "1.0",
        "generated_at": datetime.now(UTC).isoformat(),
        "downloads": records,
    }
    destination = manifest_path or configured_manifest_path(root)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def load_manifest(root: Path | None = None, manifest_path: Path | None = None) -> dict:
    root = (root or configured_download_root()).resolve()
    path = manifest_path or configured_manifest_path(root)
    if not path.is_file():
        return refresh_manifest(root, path)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return refresh_manifest(root, path)
    if not isinstance(payload, dict) or not isinstance(payload.get("downloads"), list):
        return refresh_manifest(root, path)
    return payload


def public_manifest(manifest: dict) -> dict:
    return {
        "generated_at": manifest.get("generated_at"),
        "downloads": [
            {key: value for key, value in item.items() if key != "source_relative_path"}
            for item in manifest.get("downloads", [])
            if item.get("enabled")
        ],
    }


# 只依 Manifest ID 解析檔案，並再次確認路徑仍在下載根目錄內。
def resolve_download(download_id: str, root: Path | None = None, manifest_path: Path | None = None) -> tuple[dict, Path] | None:
    if not re.fullmatch(r"[a-z0-9-]{1,80}", download_id):
        return None
    root = (root or configured_download_root()).resolve()
    manifest = load_manifest(root, manifest_path)
    item = next((entry for entry in manifest.get("downloads", []) if entry.get("id") == download_id and entry.get("enabled")), None)
    if item is None or not isinstance(item.get("source_relative_path"), str):
        return None
    candidate = (root / item["source_relative_path"]).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        return None
    return (item, candidate) if candidate.is_file() else None


def _byte_range(value: str | None, total: int) -> tuple[int, int] | None:
    if not value:
        return 0, total - 1
    match = _RANGE_PATTERN.fullmatch(value.strip())
    if not match:
        return None
    start_text, end_text = match.groups()
    if not start_text:
        length = int(end_text or 0)
        return (max(total - length, 0), total - 1) if length else None
    start = int(start_text)
    end = int(end_text) if end_text else total - 1
    if start >= total or start > end:
        return None
    return start, min(end, total - 1)


# 以固定區塊串流檔案，避免大型安裝包一次載入後端記憶體。
def _stream(path: Path, start: int, length: int) -> Iterator[bytes]:
    remaining = length
    with path.open("rb") as source:
        source.seek(start)
        while remaining:
            block = source.read(min(CHUNK_SIZE, remaining))
            if not block:
                break
            remaining -= len(block)
            yield block


async def manifest_endpoint(_request: Request, root: Path, manifest_path: Path) -> JSONResponse:
    return JSONResponse(public_manifest(load_manifest(root, manifest_path)), headers={"Cache-Control": "no-store"})


async def download_endpoint(request: Request, root: Path, manifest_path: Path) -> Response:
    resolved = resolve_download(request.path_params["download_id"], root, manifest_path)
    if resolved is None:
        return Response(status_code=404)
    item, path = resolved
    total = path.stat().st_size
    requested_range = _byte_range(request.headers.get("range"), total)
    if requested_range is None:
        return Response(status_code=416, headers={"Content-Range": f"bytes */{total}"})
    start, end = requested_range
    length = end - start + 1
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(length),
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(item['filename'])}",
        "Cache-Control": "no-store",
    }
    status_code = 200
    if request.headers.get("range"):
        headers["Content-Range"] = f"bytes {start}-{end}/{total}"
        status_code = 206
    media_type = mimetypes.guess_type(item["filename"])[0] or "application/octet-stream"
    return StreamingResponse(_stream(path, start, length), status_code=status_code, headers=headers, media_type=media_type)

