from __future__ import annotations

import json
import os
from pathlib import Path

VERSION = "f450_v1"
EMBEDDING_DIMENSIONS = 2048
RAG_TOP_K = 5
RAG_MIN_SCORE = 0.58
RAG_CONTEXT_MIN_SCORE = 0.20
MAX_QUESTION_LENGTH = 500
ACTIVE_VERSION_PATH = Path(r"D:\FDE-AI\rag\active_version.json")
LLM_FALLBACK_ENABLED = os.getenv("LLM_FALLBACK_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}
LLM_FALLBACK_TIMEOUT_SECONDS = 15
REFUSAL_ANSWER = "这个问题目前超出 F450 AI 助教可确认范围，建议询问老师。"
LLM_UNAVAILABLE_ANSWER = "目前知识库证据不足，AI 补充服务也暂时不可用，请稍后再试。"
COMMON_KNOWLEDGE_PREFIX = "根据一般无人机常识补充："


class VersionResolutionError(RuntimeError):
    pass


def resolve_active_version(pointer_path: Path = ACTIVE_VERSION_PATH) -> Path:
    pointer_path = Path(pointer_path)
    try:
        data = json.loads(pointer_path.read_text(encoding="utf-8"))
        version = data["active_version"]
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise VersionResolutionError("active_version.json 無效或不存在") from exc
    if not isinstance(version, str) or not version or any(part in version for part in ("/", "\\", "..")):
        raise VersionResolutionError("active_version 名稱無效")
    version_root = pointer_path.parent / version
    required = (version_root / "manifest.json", version_root / "index" / "documents.jsonl", version_root / "index" / "vectors.npz")
    if not version_root.is_dir() or not all(path.is_file() for path in required):
        raise VersionResolutionError(f"指定版本不存在或不完整：{version}")
    return version_root
