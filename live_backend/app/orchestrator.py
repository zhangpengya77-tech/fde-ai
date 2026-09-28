from __future__ import annotations

from .guidance import GuidanceProvider
from .sessions import InMemorySessionStore, utc_now_iso
from .sop import SopEngine, select_detection


class CoachOrchestrator:
    def __init__(self, sessions: InMemorySessionStore, engine: SopEngine, guidance: GuidanceProvider):
        self.sessions = sessions
        self.engine = engine
        self.guidance = guidance

    def process(self, session_id: str, detections: list[dict], frame_id: str, vision_source: str, metrics: dict) -> dict:
        session = self.sessions.get(session_id)
        if session is None:
            raise KeyError(session_id)
        step = self.sessions.current_step(session_id)
        self.sessions.append_event(session_id, "FRAME_CAPTURED", {"frame_id": frame_id, "vision_source": vision_source})
        self.sessions.append_event(session_id, "DETECTION_RECEIVED", {"frame_id": frame_id, "detections": detections})
        fact = select_detection(detections, frame_id, utc_now_iso())
        decision = self.engine.evaluate(step, fact, session.pass_candidate_count, session.last_frame_id)
        session = self.sessions.apply_decision(session_id, step, fact, decision)
        message = self.guidance.get_guidance(session.as_dict(), decision, decision.error_code)
        return {
            "detection": fact.as_dict() if fact else None,
            "detections": detections,
            "sop": decision.as_dict(),
            "guidance": message.as_dict(),
            "session": session.as_dict(),
            "metrics": metrics,
        }
