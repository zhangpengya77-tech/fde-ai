#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""DEMO 憑證載入器（P6 安全收尾，2026-10-13 教師指令）。

**憑證一律不寫入程式碼。** 本模組是所有 DEMO 工具唯一的憑證來源。

載入優先序（先命中者為準）：
  1. 環境變數
     - `FDE_DEMO_STUDENT_PASSWORD`（學員）
     - `FDE_DEMO_TEACHER_PASSWORD`（教師）
     - `FDE_DEMO_SHARED_PASSWORD`（學員與教師共用同一組時）
  2. 憑證檔路徑：環境變數 `FDE_DEMO_CREDENTIALS_FILE`
  3. `~/.fde-demo-credentials/demo.shared.password.txt`
  4. `~/.fde-demo-credentials/demo.student01.password.txt`（學員）
     `~/.fde-demo-credentials/demo.teacher.password.txt`（教師）

憑證檔解析規則：若存在「---- 以下為密碼」標記，取其後第一行非分隔線內容；
否則取第一個非註解（不以 `#` 開頭）、非空白行。

取不到憑證時一律 `raise DemoCredentialsMissing`，**絕不回落為任何預設密碼**。
"""
import os
from pathlib import Path

CREDENTIALS_DIR = Path(os.path.expanduser("~")) / ".fde-demo-credentials"
SHARED_FILE = CREDENTIALS_DIR / "demo.shared.password.txt"
STUDENT_FILE = CREDENTIALS_DIR / "demo.student01.password.txt"
TEACHER_FILE = CREDENTIALS_DIR / "demo.teacher.password.txt"

STUDENT_EMAIL = "demo.student01@fde-demo.local"
TEACHER_EMAIL = "demo.teacher@fde-demo.local"


class DemoCredentialsMissing(RuntimeError):
    """找不到 DEMO 憑證時拋出；呼叫端應安全停止，不得使用預設密碼。"""


def _parse_credential_file(path):
    try:
        lines = Path(path).read_text(encoding="utf-8").splitlines()
    except OSError:
        return None
    for index, line in enumerate(lines):
        if "以下為密碼" in line and "----" in line:
            for follow in lines[index + 1:]:
                token = follow.strip()
                if token and not token.startswith("----"):
                    return token
    for line in lines:
        token = line.strip()
        if token and not token.startswith("#"):
            return token
    return None


def _candidate_files(role):
    explicit = os.environ.get("FDE_DEMO_CREDENTIALS_FILE", "").strip()
    files = []
    if explicit:
        files.append(explicit)
    if role == "student":
        files.extend([SHARED_FILE, STUDENT_FILE])
    elif role == "teacher":
        files.extend([SHARED_FILE, TEACHER_FILE])
    else:
        files.append(SHARED_FILE)
    return files


def load_password(role="shared", required=True):
    """載入 DEMO 密碼。role ∈ {"shared", "student", "teacher"}。

    `required=False` 時找不到憑證回傳 `None`（供可選驗證項使用）。
    """
    env_names = {
        "student": ("FDE_DEMO_STUDENT_PASSWORD", "FDE_DEMO_SHARED_PASSWORD"),
        "teacher": ("FDE_DEMO_TEACHER_PASSWORD", "FDE_DEMO_SHARED_PASSWORD"),
        "shared": ("FDE_DEMO_SHARED_PASSWORD",),
    }[role]
    for name in env_names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    for path in _candidate_files(role):
        value = _parse_credential_file(path)
        if value:
            return value
    if not required:
        return None
    raise DemoCredentialsMissing(
        "找不到 DEMO 憑證。請設定環境變數 "
        "FDE_DEMO_STUDENT_PASSWORD／FDE_DEMO_TEACHER_PASSWORD／FDE_DEMO_SHARED_PASSWORD，"
        "或設定 FDE_DEMO_CREDENTIALS_FILE，或提供 "
        f"{SHARED_FILE}。本工具不提供預設密碼。"
    )


def student_password():
    return load_password("student")


def teacher_password():
    return load_password("teacher")


def shared_password():
    return load_password("shared")


def student_credentials():
    """回傳 `(email, password)`，供既有 `STUDENT = (...)` 形式直接使用。"""
    return (STUDENT_EMAIL, student_password())


def teacher_credentials():
    return (TEACHER_EMAIL, teacher_password())


def require_or_exit(role="shared"):
    """CLI 便利函式：取不到憑證時印出原因並以 exit code 2 結束。"""
    import sys

    try:
        return load_password(role)
    except DemoCredentialsMissing as exc:
        print(f"[安全停止] {exc}", file=sys.stderr)
        raise SystemExit(2)
