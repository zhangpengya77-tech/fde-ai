from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from threading import RLock
from uuid import uuid4


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


@dataclass(frozen=True)
class LiveSession:
    session_id: str
    mode: str
    created_at: str

    def as_dict(self) -> dict:
        return asdict(self)


class InMemorySessionStore:
    def __init__(self):
        self._sessions: dict[str, LiveSession] = {}
        self._lock = RLock()

    def create(self) -> LiveSession:
        session = LiveSession(
            session_id=str(uuid4()),
            mode="demo",
            created_at=utc_now_iso(),
        )
        with self._lock:
            self._sessions[session.session_id] = session
        return session

    def get(self, session_id: str) -> LiveSession | None:
        with self._lock:
            return self._sessions.get(session_id)

    def delete(self, session_id: str) -> bool:
        with self._lock:
            return self._sessions.pop(session_id, None) is not None
