from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Mapping, Sequence


@dataclass(frozen=True)
class DetectionFact:
    class_name: str
    confidence: float
    box: list[float]
    frame_id: str
    timestamp: str

    def as_dict(self) -> dict:
        return {
            "class": self.class_name,
            "confidence": self.confidence,
            "box": self.box,
            "frame_id": self.frame_id,
            "timestamp": self.timestamp,
        }


@dataclass(frozen=True)
class SopStep:
    step_id: str
    title: str
    instruction: str
    expected_classes: tuple[str, ...]
    min_confidence: float
    required_pass_count: int
    error_guidance: Mapping[str, str]
    safety_gate: bool
    next_step: str | None


@dataclass(frozen=True)
class SopTask:
    task_id: str
    title: str
    steps: tuple[SopStep, ...]


@dataclass(frozen=True)
class SopCourse:
    course_id: str
    title: str
    tasks: tuple[SopTask, ...]


@dataclass(frozen=True)
class SopDecision:
    status: str
    error_code: str | None
    expected_classes: tuple[str, ...]
    detected_class: str | None
    confidence: float | None
    pass_candidate_count: int
    required_pass_count: int
    next_step: str | None

    def as_dict(self) -> dict:
        value = asdict(self)
        value["expected_classes"] = list(self.expected_classes)
        return value


DEMO_MIN_CONFIDENCE = 0.60


def load_demo_course() -> SopCourse:
    guidance = {
        "no_detection": "目前没有识别到目标零件，请把零件完整放入画面。",
        "uncertain": "目前辨识信心不足，请将零件靠近镜头并保持稳定。",
    }
    return SopCourse(
        course_id="F450_BASIC_ASSEMBLY",
        title="F450 基础组装",
        tasks=(
            SopTask(
                task_id="PARTS_PREPARATION",
                title="零件辨识与准备",
                steps=(
                    SopStep("prepare_motor", "准备马达", "请将 F450 马达放到摄像头前。", ("motor",), DEMO_MIN_CONFIDENCE, 3, guidance, False, "prepare_frame_arm"),
                    SopStep("prepare_frame_arm", "准备机臂", "请将 F450 机臂放到摄像头前。", ("frame_arm",), DEMO_MIN_CONFIDENCE, 3, guidance, False, "prepare_flight_controller"),
                    SopStep("prepare_flight_controller", "准备飞控", "请将飞控放到摄像头前。", ("flight_controller",), DEMO_MIN_CONFIDENCE, 3, guidance, False, None),
                ),
            ),
        ),
    )


def select_detection(detections: Sequence[dict], frame_id: str, timestamp: str) -> DetectionFact | None:
    if not detections:
        return None
    best = max(detections, key=lambda item: (float(item.get("confidence", 0.0)), str(item.get("class", ""))))
    return DetectionFact(
        class_name=str(best["class"]),
        confidence=float(best["confidence"]),
        box=list(best.get("box", [])),
        frame_id=frame_id,
        timestamp=timestamp,
    )


class SopEngine:
    def evaluate(
        self,
        step: SopStep,
        detection: DetectionFact | None,
        pass_candidate_count: int,
        last_frame_id: str | None,
    ) -> SopDecision:
        common = {
            "expected_classes": step.expected_classes,
            "required_pass_count": step.required_pass_count,
            "next_step": step.next_step,
        }
        if detection is None:
            return SopDecision("NO_DETECTION", "no_detection", detected_class=None, confidence=None, pass_candidate_count=pass_candidate_count, **common)
        if detection.confidence < step.min_confidence:
            return SopDecision("UNCERTAIN", "low_confidence", detected_class=detection.class_name, confidence=detection.confidence, pass_candidate_count=pass_candidate_count, **common)
        if detection.class_name not in step.expected_classes:
            return SopDecision("NG", "wrong_class", detected_class=detection.class_name, confidence=detection.confidence, pass_candidate_count=pass_candidate_count, **common)
        if step.safety_gate:
            return SopDecision("TEACHER_CHECK", "teacher_check_required", detected_class=detection.class_name, confidence=detection.confidence, pass_candidate_count=pass_candidate_count, **common)
        duplicate = detection.frame_id == last_frame_id
        return SopDecision(
            "PASS_CANDIDATE",
            "duplicate_frame" if duplicate else None,
            detected_class=detection.class_name,
            confidence=detection.confidence,
            pass_candidate_count=pass_candidate_count if duplicate else pass_candidate_count + 1,
            **common,
        )
