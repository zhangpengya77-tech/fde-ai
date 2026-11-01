"""模型上傳結構預檢（不反序列化、不載入 PyTorch）。

為什麼需要
----------
`GrowthModelForm` 原本只檢查副檔名是 `.pt` 且 ≤100MB。實測（2026-10-28 安全驗收
S-06/S-07）2KB 垃圾位元組命名為 `fake_model.pt` 可以通過表單並在 Live 建立真實的
`SUBMITTED` 提交紀錄，污染教師待審佇列。

安全邊界
--------
1. **絕不 unpickle**。PyTorch `.pt` 是 pickle，載入即執行任意程式碼，因此本模組
   只做「容器層」檢查：ZIP 中央目錄、entry 名稱、宣告大小。不做 torch.load。
2. 真正的「這個模型能不能跑」由 Live Backend 的匯入預檢負責（教師受控動作），
   不在 Django Web Request 內進行。
3. 預檢在**獨立子行程**中執行並有硬逾時，避免惡意 ZIP 結構拖垮 Web 進程。
4. 失敗只寫審計事件，**不建立 Evidence、不進待審佇列**。

已知限制（必須如實告知）
------------------------
* Windows 上無法對子行程做精確的 CPU／記憶體配額；目前只做到「獨立進程 + 硬逾時
  + 只讀檔案 + 不載入任何模型」。若要更嚴格的資源隔離，需容器或 Job Object。
* 純 pickle（protocol 0-5，開頭 `\\x80`）的舊格式 `.pt` 會被**拒絕**，因為驗證它
  必然要反序列化。這是刻意的取捨：寧可拒絕，也不在 Web 進程解 pickle。
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import subprocess
import sys
import zipfile

MAX_MODEL_BYTES = 100 * 1024 * 1024          # 與 forms.py 一致
MAX_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024  # 解壓後上限（防 ZIP 炸彈）
MAX_COMPRESSION_RATIO = 200                  # 壓縮比上限
PREFLIGHT_TIMEOUT_SECONDS = 20

ZIP_MAGICS = (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")
PICKLE_MAGIC = b"\x80"

REASON_OK = "ok"
REASON_EMPTY = "empty_file"
REASON_TOO_LARGE = "file_too_large"
REASON_BAD_EXTENSION = "extension_not_allowed"
REASON_UNSAFE_PICKLE = "unsafe_pickle_format"
REASON_NOT_ARCHIVE = "not_a_torch_archive"
REASON_BAD_ARCHIVE = "corrupt_archive"
REASON_MISSING_PAYLOAD = "torch_payload_missing"
REASON_UNSAFE_ENTRY = "unsafe_archive_entry"
REASON_ZIP_BOMB = "archive_expansion_too_large"
REASON_TIMEOUT = "preflight_timeout"
REASON_PREFLIGHT_FAILED = "preflight_failed"


def inspect_bytes(content: bytes, filename: str = "model.pt") -> dict:
    """純結構檢查（不反序列化）。回傳 {ok, reason, details}。"""
    details: dict = {
        "filename": os.path.basename(str(filename)),
        "size_bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest() if content else "",
    }

    if not content:
        return {"ok": False, "reason": REASON_EMPTY, "details": details}
    if len(content) > MAX_MODEL_BYTES:
        return {"ok": False, "reason": REASON_TOO_LARGE, "details": details}
    if not str(filename).lower().endswith(".pt"):
        return {"ok": False, "reason": REASON_BAD_EXTENSION, "details": details}

    if content.startswith(PICKLE_MAGIC):
        # 舊式純 pickle：要驗證就得 unpickle，違反本模組的安全邊界，直接拒絕。
        return {"ok": False, "reason": REASON_UNSAFE_PICKLE, "details": details}
    if not content.startswith(ZIP_MAGICS):
        return {"ok": False, "reason": REASON_NOT_ARCHIVE, "details": details}

    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            infos = archive.infolist()
    except (zipfile.BadZipFile, OSError, ValueError):
        return {"ok": False, "reason": REASON_BAD_ARCHIVE, "details": details}

    if not infos:
        return {"ok": False, "reason": REASON_BAD_ARCHIVE, "details": details}

    total_uncompressed = 0
    names: list[str] = []
    for info in infos:
        name = info.filename
        names.append(name)
        # zip-slip：絕對路徑或上層跳脫一律拒絕（即使我們不解壓，也不放行這種結構）。
        if name.startswith(("/", "\\")) or ".." in name.replace("\\", "/").split("/"):
            details["offending_entry"] = name
            return {"ok": False, "reason": REASON_UNSAFE_ENTRY, "details": details}
        total_uncompressed += max(int(info.file_size or 0), 0)

    details["entry_count"] = len(names)
    details["uncompressed_bytes"] = total_uncompressed
    details["sample_entries"] = names[:6]

    if total_uncompressed > MAX_UNCOMPRESSED_BYTES:
        return {"ok": False, "reason": REASON_ZIP_BOMB, "details": details}
    if len(content) > 0 and (total_uncompressed / len(content)) > MAX_COMPRESSION_RATIO:
        return {"ok": False, "reason": REASON_ZIP_BOMB, "details": details}

    lowered = [name.replace("\\", "/").lower() for name in names]
    # torch.save 的 zip 格式至少會有 data.pkl（權重與結構）與 version。
    has_payload = any(name.endswith("data.pkl") for name in lowered)
    has_version = any(
        name.endswith("version") or name.endswith("byteorder") or "/data/" in f"/{name}"
        for name in lowered
    )
    details["has_data_pkl"] = has_payload
    details["has_version_marker"] = has_version
    if not has_payload:
        return {"ok": False, "reason": REASON_MISSING_PAYLOAD, "details": details}

    return {"ok": True, "reason": REASON_OK, "details": details}


def inspect_file(path: str, filename: str = "") -> dict:
    try:
        with open(path, "rb") as handle:
            content = handle.read(MAX_MODEL_BYTES + 1)
    except OSError:
        return {"ok": False, "reason": REASON_PREFLIGHT_FAILED, "details": {"path": path}}
    return inspect_bytes(content, filename or os.path.basename(path))


def run_isolated_check(path: str, filename: str = "", timeout: int = PREFLIGHT_TIMEOUT_SECONDS) -> dict:
    """在獨立子行程中執行結構檢查，避免惡意 ZIP 拖垮 Web 進程。"""
    try:
        completed = subprocess.run(
            [sys.executable, "-m", "learning.vision_preflight", "--check", path,
             "--filename", filename or os.path.basename(path)],
            capture_output=True,
            timeout=timeout,
            cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "reason": REASON_TIMEOUT, "details": {"path": path, "timeout": timeout}}
    except OSError:
        return {"ok": False, "reason": REASON_PREFLIGHT_FAILED, "details": {"path": path}}

    stdout = (completed.stdout or b"").decode("utf-8", "replace").strip()
    try:
        return json.loads(stdout.splitlines()[-1])
    except (ValueError, IndexError):
        return {
            "ok": False,
            "reason": REASON_PREFLIGHT_FAILED,
            "details": {"returncode": completed.returncode, "stderr": (completed.stderr or b"").decode("utf-8", "replace")[:300]},
        }


def _main(argv: list[str]) -> int:
    if "--check" not in argv:
        print(json.dumps({"ok": False, "reason": REASON_PREFLIGHT_FAILED, "details": {}}))
        return 2
    index = argv.index("--check")
    path = argv[index + 1] if len(argv) > index + 1 else ""
    filename = ""
    if "--filename" in argv:
        f_index = argv.index("--filename")
        filename = argv[f_index + 1] if len(argv) > f_index + 1 else ""
    result = inspect_file(path, filename)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(_main(sys.argv[1:]))
