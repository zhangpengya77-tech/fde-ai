"""P6 回歸測試輔助：讓 TestClient 送出「Django 會送的那種」身分 Assertion。

P6 之後 Live 不再信任 ``X-FDE-Role`` / ``X-FDE-Teacher-ID``，教師身分必須來自
綁定 method / path / body 的短效 Assertion。既有的 Phase-4 Live 套件因此改用
本輔助模組簽發 Assertion，功能覆蓋不變、但不再是「偽造標頭」的路徑。

注意：本檔不是測試模組（檔名不以 test_ 開頭），不會被 unittest 探索。
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from app import live_assertions

DEFAULT_KEY = "p6-regression-test-key"
DEFAULT_LEDGER = str(Path(__file__).resolve().parents[1] / "var" / "p6-regression-ledger.sqlite3")


def install_identity_env(key: str = DEFAULT_KEY, ledger_path: str = DEFAULT_LEDGER) -> None:
    """設定 Live 內部驗證所需的環境變數（測試用一次性金鑰）。"""
    os.environ["FDE_INTERNAL_SHARED_SECRET"] = key
    os.environ["FDE_REPLAY_LEDGER_PATH"] = ledger_path


def signed_teacher_client(
    client,
    *,
    subject: str = "teacher-1",
    role: str = "teacher",
    cohort_ids=("cohort-a",),
    enrollment_id: int = 0,
    key: str = DEFAULT_KEY,
    ledger_path: str = DEFAULT_LEDGER,
):
    """回傳會自動為每個請求簽上 Assertion 的同一個 client。"""
    install_identity_env(key=key, ledger_path=ledger_path)
    original_send = client.send

    def send(request, **kwargs):
        body = request.read()
        claims = {
            "sub": f"{role}:{subject}",
            "role": role,
            "enrollment_id": int(enrollment_id),
            "cohort_ids": list(cohort_ids),
            "method": request.method.upper(),
            "path": request.url.path,
            "body_sha256": live_assertions.body_sha256(body),
        }
        request.headers["X-FDE-Live-Assertion"] = live_assertions.issue_live_assertion(claims, key)
        return original_send(request, **kwargs)

    client.send = send
    return client


def legacy_header_client(app, **kwargs):
    """取代 TestClient：把舊測試的教師標頭換成 Assertion，無標頭的請求維持未授權。

    2026-11-01 整合：主樹的模型管理測試以 ``X-FDE-Role`` 表達「這是教師請求」。
    Live 已不信任該標頭，因此這裡只把它當測試內的意圖，轉成真正的簽章；
    刻意不帶標頭的負向測試不簽章，仍須被 fail closed 拒絕。
    """
    from starlette.testclient import TestClient

    install_identity_env()
    client = TestClient(app, **kwargs)
    original_send = client.send

    def send(request, **send_kwargs):
        path = request.url.path
        if request.method == "POST" and path in ("/api/v1/vision/submissions", "/api/v1/vision/prop-check"):
            # 這兩個端點的正常呼叫者是 Django 代學員送出，身分同樣改由 Assertion 表達。
            body = request.read()
            student = json.loads(body or b"{}").get("student_id") or "s1"
            claims = {
                "sub": f"student:{student}", "role": "student", "enrollment_id": 21,
                "cohort_ids": ["cohort-a"], "method": "POST", "path": path,
                "body_sha256": live_assertions.body_sha256(body),
            }
            request.headers["X-FDE-Live-Assertion"] = live_assertions.issue_live_assertion(claims, DEFAULT_KEY)
        elif request.headers.get("X-FDE-Role", "").casefold() == "teacher":
            claims = {
                "sub": f"teacher:{request.headers.get('X-FDE-Teacher-ID', 'teacher-1')}",
                "role": "teacher", "enrollment_id": 0, "cohort_ids": ["cohort-a"],
                "method": request.method.upper(), "path": request.url.path,
                "body_sha256": live_assertions.body_sha256(request.read()),
            }
            request.headers["X-FDE-Live-Assertion"] = live_assertions.issue_live_assertion(claims, DEFAULT_KEY)
        return original_send(request, **send_kwargs)

    client.send = send
    return client
