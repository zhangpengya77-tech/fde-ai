from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from threading import RLock
from uuid import uuid4

from .sop import DetectionFact, SopCourse, SopDecision, SopStep, load_demo_course


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class InvalidSessionTransition(ValueError):
    pass


@dataclass
class LiveSession:
    session_id: str
    mode: str
    created_at: str
    course_id: str
    task_id: str
    current_step_id: str
    state: str
    vision_source: str
    expected_class: str
    last_detection: str | None = None
    last_confidence: float | None = None
    last_frame_id: str | None = None
    pass_candidate_count: int = 0
    fail_count: int = 0
    help_count: int = 0
    sequence: int = 0
    started_at: str = ""
    updated_at: str = ""
    completed_at: str | None = None
    _step_index: int = field(default=0, repr=False)
    _events: list[dict] = field(default_factory=list, repr=False)

    def as_dict(self) -> dict:
        value = asdict(self)
        value.pop("_step_index", None)
        value.pop("_events", None)
        return value


class InMemorySessionStore:
    def __init__(self, course: SopCourse | None = None):
        self.course = course or load_demo_course()
        self.task = self.course.tasks[0]
        self._sessions: dict[str, LiveSession] = {}
        self._lock = RLock()

    def create(self, *, vision_source: str = "REAL_VISION", mode: str = "demo") -> LiveSession:
        now = utc_now_iso()
        first = self.task.steps[0]
        session = LiveSession(
            session_id=str(uuid4()),
            mode=mode,
            created_at=now,
            course_id=self.course.course_id,
            task_id=self.task.task_id,
            current_step_id=first.step_id,
            state="WAITING_FOR_OBJECT",
            vision_source=vision_source,
            expected_class=first.expected_classes[0],
            started_at=now,
            updated_at=now,
        )
        with self._lock:
            self._sessions[session.session_id] = session
            self._append(session, "SESSION_STARTED")
            self._append(session, "STEP_STARTED")
        return session

    def get(self, session_id: str) -> LiveSession | None:
        with self._lock:
            return self._sessions.get(session_id)

    def current_step(self, session_id: str) -> SopStep:
        session = self.get(session_id)
        if session is None:
            raise KeyError(session_id)
        return self.task.steps[session._step_index]

    def _append(self, session: LiveSession, event_type: str, data: dict | None = None) -> dict:
        session.sequence += 1
        event = {
            "sequence": session.sequence,
            "timestamp": utc_now_iso(),
            "session_id": session.session_id,
            "step_id": session.current_step_id,
            "type": event_type,
            "data": data or {},
        }
        session._events.append(event)
        session.updated_at = event["timestamp"]
        return event

    def append_event(self, session_id: str, event_type: str, data: dict | None = None) -> dict:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                raise KeyError(session_id)
            return self._append(session, event_type, data)

    def events(self, session_id: str) -> list[dict]:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                raise KeyError(session_id)
            return [dict(event) for event in session._events]

    def apply_decision(
        self,
        session_id: str,
        step: SopStep,
        detection: DetectionFact | None,
        decision: SopDecision,
    ) -> LiveSession:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                raise KeyError(session_id)
            session.state = decision.status
            if detection is not None:
                session.last_detection = detection.class_name
                session.last_confidence = detection.confidence
                if decision.error_code != "duplicate_frame":
                    session.last_frame_id = detection.frame_id
            session.pass_candidate_count = decision.pass_candidate_count
            if decision.status == "NG":
                session.fail_count += 1
            self._append(session, "SOP_EVALUATED", decision.as_dict())
            self._append(session, decision.status, decision.as_dict())
            return session

    def confirm(self, session_id: str) -> LiveSession:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                raise KeyError(session_id)
            if session.state != "PASS_CANDIDATE":
                raise InvalidSessionTransition("pass_candidate_required")
            self._append(session, "STEP_CONFIRMED")
            self._append(session, "STEP_COMPLETED")
            if session._step_index >= len(self.task.steps) - 1:
                session.state = "TASK_COMPLETED"
                session.completed_at = utc_now_iso()
                self._append(session, "TASK_COMPLETED")
                return session
            session._step_index += 1
            next_step = self.task.steps[session._step_index]
            session.current_step_id = next_step.step_id
            session.expected_class = next_step.expected_classes[0]
            session.state = "WAITING_FOR_OBJECT"
            session.last_detection = None
            session.last_confidence = None
            session.last_frame_id = None
            session.pass_candidate_count = 0
            self._append(session, "STEP_STARTED")
            return session

    def delete(self, session_id: str) -> bool:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return False
            self._append(session, "SESSION_STOPPED")
            self._sessions.pop(session_id, None)
            return True
