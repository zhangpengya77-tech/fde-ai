"""模型不可變快照服務（PROP_DIRECTION_V1）。

2026-10-08 教師指令「一、模型不可變快照」的實作。

設計原則：
    1. 保留原始 Evidence 與原始 best.pt：**不搬移、不刪除、不就地修改**。
    2. 模型收藏時，在隔離倉庫建立**獨立檔案副本**。
    3. 使用**內容雜湊命名**，同名內容天然去重、不同內容不會互相覆蓋。
    4. 複製前後分別計算 SHA256，確認內容一致才落定。
    5. 驗證實際路徑位於允許的 Media 根目錄之下。
    6. 拒絕路徑穿越、符號連結及不合法來源。
    7. 使用暫存檔 + 原子改名，避免留下不完整快照。
    8. 入庫紀錄保存快照路徑、SHA256、來源 Evidence。
    9. 資料庫寫入失敗時，清理本次未完成的暫存檔。
    10. **不得載入或反序列化任何 .pt**：全程只做位元組串流複製與雜湊。

本模組不執行推論、不訓練、不部署、不變更任何狀態維度。
"""

import hashlib
import os
import shutil
import tempfile
import uuid

from django.conf import settings
from django.core.files.storage import default_storage

# 倉庫快照根目錄（位於 Media 根目錄之下）。
SNAPSHOT_ROOT = "vision_repository"

# 單一檔案複製的位元組塊大小；1 MB 足以兼顧記憶體與吞吐。
_CHUNK = 1024 * 1024


class SnapshotError(Exception):
    """快照建立失敗；帶穩定錯誤碼以便記錄與測試比對。"""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def media_root() -> str:
    """回傳 Media 根目錄的絕對路徑（正規化）。"""
    return os.path.realpath(str(settings.MEDIA_ROOT))


def _is_within(child: str, parent: str) -> bool:
    """判斷 child 是否位於 parent 之下（已正規化，阻擋 ../ 逃逸）。"""
    child_real = os.path.realpath(child)
    parent_real = os.path.realpath(parent)
    try:
        return os.path.commonpath([child_real, parent_real]) == parent_real
    except ValueError:
        # 不同磁碟機時 commonpath 會拋錯，代表必然不在同一樹下。
        return False


def validate_snapshot_target(target_path: str) -> str:
    """驗證快照目標路徑合法；回傳正規化後的絕對路徑。

    拒絕條件：
        - 目標不在 Media 根目錄之下（路徑穿越）
        - 目標或其父目錄為符號連結
    """
    root = media_root()
    target_real = os.path.realpath(target_path)
    if not _is_within(target_real, root):
        raise SnapshotError(
            "SNAPSHOT_PATH_ESCAPE",
            "快照目標路徑不在允許的 Media 根目錄之下，已拒絕。",
        )
    # 逐層檢查既有父目錄是否為符號連結。
    current = os.path.dirname(target_real)
    while current and _is_within(current, root) and current != root:
        if os.path.islink(current):
            raise SnapshotError(
                "SNAPSHOT_SYMLINK_REJECTED",
                "快照目標的父目錄為符號連結，已拒絕。",
            )
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    if os.path.islink(target_real):
        raise SnapshotError(
            "SNAPSHOT_SYMLINK_REJECTED", "快照目標為符號連結，已拒絕。"
        )
    return target_real


def validate_source_path(source_path: str) -> str:
    """驗證來源檔案合法；回傳正規化後的絕對路徑。

    拒絕符號連結：來源若為 symlink，代表指向的內容可能不在預期位置，
    或可被外部替換，因此一律拒絕，避免快照把不可控內容帶進倉庫。

    2026-10-08 安全審核修正（最小範圍）：
        Windows 上除了符號連結之外，還有「NTFS junction（目錄連結）」等
        重解析點（reparse point）。建立 junction **不需要管理員權限**，
        且 `os.path.islink()` 對 junction 一律回傳 False，因此原本只靠
        `os.path.islink()` 的檢查可被繞過：在 Media 內放一個 junction
        指向 Media 之外，即可讓外部檔案被當成合法來源複製進倉庫。

        修正方式維持最小範圍：在原有檢查之外，額外要求**解析後的真實路徑**
        必須仍位於 Media 根目錄之下。junction／symlink／任何重解析點只要
        讓真實路徑逃出 Media，就會被 `_is_within()` 擋下。
    """
    if not source_path:
        raise SnapshotError("SOURCE_INVALID", "來源檔案參照為空。")
    source_real = os.path.realpath(source_path)
    if os.path.islink(source_path):
        raise SnapshotError(
            "SOURCE_SYMLINK_REJECTED", "來源 best.pt 為符號連結，已拒絕入庫。"
        )
    # 阻擋 junction 等 os.path.islink() 看不到的重解析點逃逸 Media 樹。
    if not _is_within(source_real, media_root()):
        raise SnapshotError(
            "SOURCE_SYMLINK_REJECTED",
            "來源 best.pt 的真實路徑不在 Media 根目錄之下（可能經目錄連結逃逸），已拒絕入庫。",
        )
    if not os.path.isfile(source_real):
        raise SnapshotError("SOURCE_MISSING", "來源 best.pt 檔案不存在。")
    return source_real


def resolve_evidence_artifact_path(evidence) -> str:
    """取得 Evidence 上傳檔案的實際磁碟路徑。

    只使用 storage.path()；若 storage 不支援實體路徑（例如雲端儲存），
    則無法建立不可變快照，一律拒絕而非静默略過。
    """
    if not evidence or not evidence.upload or not evidence.upload.name:
        raise SnapshotError("SOURCE_INVALID", "此證據沒有可用的 best.pt 檔案。")
    try:
        return evidence.upload.storage.path(evidence.upload.name)
    except NotImplementedError as exc:
        raise SnapshotError(
            "SOURCE_NOT_LOCAL",
            "目前儲存後端不支援實體路徑，無法建立不可變快照。",
        ) from exc


def hash_file(path: str) -> str:
    """以位元組串流計算檔案 SHA256；**不載入、不反序列化**。"""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def snapshot_relative_path(content_sha256: str) -> str:
    """依內容雜湊決定快照相對路徑。

    以內容雜湊命名：相同內容天然去重為同一路徑，
    不同內容必然落在不同路徑，因此不會互相覆蓋。
    """
    if len(content_sha256) != 64:
        raise SnapshotError("SNAPSHOT_HASH_INVALID", "內容雜湊長度不合法。")
    # 前兩碼作為分層目錄，避免單一目錄檔案過多。
    return f"{SNAPSHOT_ROOT}/{content_sha256[:2]}/{content_sha256}.pt"


def create_immutable_snapshot(*, source_path: str, expected_sha256: str) -> dict:
    """建立不可變快照並回傳結果。

    流程：
        1. 驗證來源（存在、非 symlink）。
        2. 複製前計算來源 SHA256，必須等於 expected_sha256。
        3. 驗證目標路徑在 Media 根目錄之下、非 symlink。
        4. 寫入同目錄暫存檔（.tmp-<uuid>），逐塊複製並同時計算目的雜湊。
        5. 目的雜湊必須等於來源雜湊，否則刪除暫存檔並拒絕。
        6. 以 os.replace 原子改名落定；目標已存在且內容相同時直接重用（去重）。

    回傳：{"relative_path", "sha256", "size_bytes", "deduplicated"}
    失敗一律拋出 SnapshotError，且**不留下任何暫存檔**。
    """
    source_real = validate_source_path(source_path)

    actual_source_sha256 = hash_file(source_real)
    if expected_sha256 and actual_source_sha256 != expected_sha256:
        raise SnapshotError(
            "SNAPSHOT_SOURCE_MISMATCH",
            "複製前來源雜湊與入庫紀錄不符，已拒絕建立快照。",
        )

    relative = snapshot_relative_path(actual_source_sha256)
    root = media_root()
    target_abs = os.path.join(root, relative.replace("/", os.sep))
    validate_snapshot_target(target_abs)

    os.makedirs(os.path.dirname(target_abs), exist_ok=True)
    # 建立後再驗證一次，避免父目錄在競態中被替換為 symlink。
    validate_snapshot_target(target_abs)

    size_bytes = os.path.getsize(source_real)
    deduplicated = False

    if os.path.isfile(target_abs):
        # 內容雜湊相同即為同一份內容，直接重用，不建立第二份。
        if hash_file(target_abs) == actual_source_sha256:
            return {
                "relative_path": relative,
                "sha256": actual_source_sha256,
                "size_bytes": size_bytes,
                "deduplicated": True,
            }
        # 雜湊相同但內容不同 ⇒ 檔案系統層異常，拒絕而非覆蓋。
        raise SnapshotError(
            "SNAPSHOT_EXISTING_CORRUPT",
            "目標快照路徑已存在但內容不符，已拒絕覆蓋。",
        )

    tmp_handle = None
    tmp_path = None
    try:
        fd, tmp_path = tempfile.mkstemp(
            prefix=".tmp-snapshot-", suffix=".part", dir=os.path.dirname(target_abs)
        )
        tmp_handle = os.fdopen(fd, "wb")
        digest = hashlib.sha256()
        with open(source_real, "rb") as src:
            for chunk in iter(lambda: src.read(_CHUNK), b""):
                digest.update(chunk)
                tmp_handle.write(chunk)
        tmp_handle.flush()
        os.fsync(tmp_handle.fileno())
        tmp_handle.close()
        tmp_handle = None

        copied_sha256 = digest.hexdigest()
        if copied_sha256 != actual_source_sha256:
            raise SnapshotError(
                "SNAPSHOT_COPY_MISMATCH",
                "複製後雜湊與來源不一致，已放棄本次快照。",
            )

        if not os.path.isfile(tmp_path):
            raise SnapshotError("SNAPSHOT_TEMP_LOST", "暫存檔在落定前消失。")

        # 原子改名：確保不會停留在「半個檔案」的中間狀態。
        os.replace(tmp_path, target_abs)
        tmp_path = None
    except SnapshotError:
        raise
    except OSError as exc:
        raise SnapshotError(
            "SNAPSHOT_IO_ERROR", f"建立快照時發生 I/O 錯誤：{exc.strerror or exc}"
        ) from exc
    finally:
        # 失敗路徑一律清理暫存檔，不留下不完整快照。
        if tmp_handle is not None:
            try:
                tmp_handle.close()
            except OSError:
                pass
        if tmp_path and os.path.isfile(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass

    return {
        "relative_path": relative,
        "sha256": actual_source_sha256,
        "size_bytes": size_bytes,
        "deduplicated": False,
    }


def read_snapshot(snapshot_path: str) -> str:
    """讀取快照實體路徑；供完整性檢查使用（只讀，不修改）。

    遞迴解析 symlink 後仍必須位於 Media 根目錄之下，避免透過特製紀錄讀取任意檔案。
    """
    if not snapshot_path:
        raise SnapshotError("SNAPSHOT_PATH_EMPTY", "此紀錄沒有快照路徑。")
    if os.path.isabs(snapshot_path):
        raise SnapshotError("SNAPSHOT_PATH_ABSOLUTE", "快照路徑必須為相對路徑。")
    root = media_root()
    target_abs = os.path.join(root, snapshot_path.replace("/", os.sep))
    target_real = os.path.realpath(target_abs)
    if not _is_within(target_real, root):
        raise SnapshotError(
            "SNAPSHOT_PATH_ESCAPE", "快照路徑不在 Media 根目錄之下，已拒絕讀取。"
        )
    return target_real


def delete_snapshot_file(snapshot_path: str) -> bool:
    """刪除快照實體檔（僅供測試清理與未完成流程使用）。

    正式流程**不得**呼叫此函式刪除損壞檔案；損壞檔案一律保留以便追查。
    """
    if not snapshot_path:
        return False
    try:
        target = read_snapshot(snapshot_path)
    except SnapshotError:
        return False
    if os.path.isfile(target):
        os.remove(target)
        return True
    return False


def cleanup_orphan_temp_files() -> int:
    """清理倉庫目錄下殘留的 .tmp-snapshot-* 暫存檔；回傳清除數量。

    用於流程中斷（例如行程被強制終止）後的人工或排程清理。
    """
    root = os.path.join(media_root(), SNAPSHOT_ROOT)
    if not os.path.isdir(root):
        return 0
    removed = 0
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            if name.startswith(".tmp-snapshot-"):
                try:
                    os.remove(os.path.join(dirpath, name))
                    removed += 1
                except OSError:
                    pass
    return removed


def snapshot_usage_report() -> dict:
    """回傳倉庫快照的使用量摘要，供教師後台顯示（不涉及模型推論）。"""
    root = os.path.join(media_root(), SNAPSHOT_ROOT)
    if not os.path.isdir(root):
        return {"file_count": 0, "total_bytes": 0, "temp_file_count": 0}
    file_count = 0
    total_bytes = 0
    temp_count = 0
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            full = os.path.join(dirpath, name)
            if name.startswith(".tmp-snapshot-"):
                temp_count += 1
                continue
            file_count += 1
            try:
                total_bytes += os.path.getsize(full)
            except OSError:
                pass
    return {"file_count": file_count, "total_bytes": total_bytes, "temp_file_count": temp_count}
