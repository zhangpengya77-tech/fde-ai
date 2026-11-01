"""P6 Phase-4 model-upload structure preflight compatibility module."""

from __future__ import annotations

import hashlib
import io
import os
import zipfile

MAX_MODEL_BYTES = 100 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024
MAX_COMPRESSION_RATIO = 200
ZIP_MAGICS = (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")
PICKLE_MAGIC = b"\x80"


def inspect_bytes(content: bytes, filename: str = "model.pt") -> dict:
    """Perform safe container checks without loading an untrusted PyTorch model."""
    details = {"filename": os.path.basename(str(filename)), "size_bytes": len(content), "sha256": hashlib.sha256(content).hexdigest() if content else ""}
    if not content:
        return {"ok": False, "reason": "empty_file", "details": details}
    if len(content) > MAX_MODEL_BYTES:
        return {"ok": False, "reason": "file_too_large", "details": details}
    if not str(filename).lower().endswith(".pt"):
        return {"ok": False, "reason": "extension_not_allowed", "details": details}
    if content.startswith(PICKLE_MAGIC):
        return {"ok": False, "reason": "unsafe_pickle_format", "details": details}
    if not content.startswith(ZIP_MAGICS):
        return {"ok": False, "reason": "not_a_torch_archive", "details": details}
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            infos = archive.infolist()
    except (zipfile.BadZipFile, OSError, ValueError):
        return {"ok": False, "reason": "corrupt_archive", "details": details}
    total = 0
    names = []
    for info in infos:
        name = info.filename
        names.append(name)
        if name.startswith(("/", "\\")) or ".." in name.replace("\\", "/").split("/"):
            return {"ok": False, "reason": "unsafe_archive_entry", "details": details}
        total += max(int(info.file_size or 0), 0)
    if total > MAX_UNCOMPRESSED_BYTES or (len(content) and total / len(content) > MAX_COMPRESSION_RATIO):
        return {"ok": False, "reason": "archive_expansion_too_large", "details": details}
    if not any(name.replace("\\", "/").lower().endswith("data.pkl") for name in names):
        return {"ok": False, "reason": "torch_payload_missing", "details": details}
    return {"ok": True, "reason": "ok", "details": details}
