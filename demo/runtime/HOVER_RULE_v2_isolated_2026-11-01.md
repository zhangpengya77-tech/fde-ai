# HOVER_RULE_v2 — 已隔離（未併入 R6，未刪除）

> 狀態：本補丁於 2026-11-01 從 R6 工作樹精準抽離，保留作為「四面懸停檢測（擴充）」的備用實作。
> 不屬於 R6 發布範圍。如需恢復，將下列 4 處改動套回 `live_backend/app/vision_center.py` 與 `live_backend/tests/test_vision_center.py` 即可。
> 原始 41 項 v1 測試 + 3 項 v2 測試均通過後才可視為完成。

## 1. 常數（vision_center.py，HOVER_RULE_VERSION 之後）
```python
HOVER_RULE_V2 = "HOVER_RULE_v2"
```

## 2. process_video 接規則版本（vision_center.py）
```python
        hover_rule = (config or {}).get("rule_version", HOVER_RULE_VERSION)
        result = analyze_hover(frames, camera_profile, config, rule_version=hover_rule)
        result["model"] = {"model_id": model["model_id"], "model_version": model["version"]}
```

## 3. analyze_hover（vision_center.py，整函式替換）
```python
def analyze_hover(frames: list[dict], camera_profile: dict | None, config: dict | None = None, rule_version: str = HOVER_RULE_VERSION) -> dict:
    cfg = {**DEFAULT_HOVER_CONFIG, **(config or {})}
    rule_version = (config or {}).get("rule_version", rule_version)
    require_sequence = bool(cfg.get("require_sequence", False))
    hold_mode = cfg.get("hold_mode", "continuous")
    calibrated = camera_profile is not None
    transform = _homography(camera_profile["four_corner_points"], camera_profile.get("width_m", 2.0), camera_profile.get("height_m", 2.0)) if calibrated else None
    ordered = sorted(frames, key=lambda item: float(item.get("timestamp", 0)))
    continuous_hold = {direction: 0.0 for direction in HOVER_CLASSES}
    cumulative_hold = {direction: 0.0 for direction in HOVER_CLASSES}
    segment_start, previous_direction, previous_time = None, None, None
    unknown_frames = 0
    outside_time = 0.0
    max_continuous_outside = 0.0
    outside_run = 0.0
    offsets = []
    projected = []
    visit_order = []
    for index, frame in enumerate(ordered):
        timestamp = float(frame.get("timestamp", 0))
        confidence = float(frame.get("confidence", 0))
        direction = frame.get("direction") if confidence >= cfg["confidence_threshold"] and frame.get("direction") in HOVER_CLASSES else "UNKNOWN"
        if direction == "UNKNOWN":
            unknown_frames += 1
        if direction != previous_direction:
            if previous_direction in HOVER_CLASSES and segment_start is not None and previous_time is not None:
                segment = previous_time - segment_start
                continuous_hold[previous_direction] = max(continuous_hold[previous_direction], segment)
                cumulative_hold[previous_direction] += segment
                if previous_direction not in visit_order:
                    visit_order.append(previous_direction)
            segment_start = timestamp if direction in HOVER_CLASSES else None
            if direction in HOVER_CLASSES and direction not in visit_order:
                visit_order.append(direction)
            previous_direction = direction
        previous_time = timestamp
        if calibrated:
            x, y = _project(transform, float(frame.get("center_x", 0)), float(frame.get("center_y", 0)))
            projected.append((x, y))
            offsets.append(math.dist((x, y), (camera_profile.get("width_m", 2.0) / 2, camera_profile.get("height_m", 2.0) / 2)))
            if index + 1 < len(ordered):
                delta = max(0.0, float(ordered[index + 1].get("timestamp", timestamp)) - timestamp)
                outside = x < 0 or y < 0 or x > camera_profile.get("width_m", 2.0) or y > camera_profile.get("height_m", 2.0)
                if outside:
                    outside_time += delta
                    outside_run += delta
                    max_continuous_outside = max(max_continuous_outside, outside_run)
                else:
                    outside_run = 0.0
    if previous_direction in HOVER_CLASSES and segment_start is not None and previous_time is not None:
        segment = previous_time - segment_start
        continuous_hold[previous_direction] = max(continuous_hold[previous_direction], segment)
        cumulative_hold[previous_direction] += segment
        if previous_direction not in visit_order:
            visit_order.append(previous_direction)
    hold = cumulative_hold if hold_mode == "cumulative" else continuous_hold
    direction_results = {direction: {
        "status": "COMPLETE" if hold[direction] >= cfg["required_hold_seconds"] else "INCOMPLETE",
        "valid_hold_seconds": round(hold[direction], 3),
        "continuous_hold_seconds": round(continuous_hold[direction], 3),
        "cumulative_hold_seconds": round(cumulative_hold[direction], 3),
    } for direction in HOVER_CLASSES}
    all_complete = all(value["status"] == "COMPLETE" for value in direction_results.values())
    severe_outside = outside_time > cfg["severe_outside_seconds"] if calibrated else False
    average_offset = sum(offsets) / len(offsets) if offsets else None
    max_offset = max(offsets) if offsets else None
    variation = math.sqrt(sum((value - average_offset) ** 2 for value in offsets) / len(offsets)) if offsets else None
    centering = max(0.0, 1 - (average_offset or 0) / math.sqrt(2)) if calibrated else 0.0
    stability = max(0.0, 1 - (variation or 0) / 0.5) if calibrated else 0.0
    boundary = max(0.0, 1 - outside_time / max(cfg["severe_outside_seconds"], 0.001)) if calibrated else 0.0
    completion_percent = round(sum(1 for value in direction_results.values() if value["status"] == "COMPLETE") / len(HOVER_CLASSES) * 100)
    missing_directions = [direction for direction, value in direction_results.items() if value["status"] != "COMPLETE"]
    canonical = list(HOVER_CLASSES)
    if set(visit_order) == set(HOVER_CLASSES) and visit_order == canonical:
        sequence_status = "IN_ORDER"
    elif set(visit_order) == set(HOVER_CLASSES):
        sequence_status = "ALL_VISITED_OUT_OF_ORDER"
    else:
        sequence_status = "INCOMPLETE"
    score = 0.0
    if all_complete and not severe_outside:
        score = cfg["base_pass_score"] + cfg["centering_weight"] * centering + cfg["stability_weight"] * stability + cfg["boundary_weight"] * boundary
    passed = all_complete and not severe_outside and (not require_sequence or sequence_status == "IN_ORDER")
    partial_score = (cfg["base_pass_score"] + cfg["centering_weight"] * centering + cfg["stability_weight"] * stability + cfg["boundary_weight"] * boundary) * (completion_percent / 100)
    failure_reasons = (["MISSING_DIRECTION"] if not all_complete else []) + (["SEVERE_OUTSIDE"] if severe_outside else []) + (["SEQUENCE_OUT_OF_ORDER"] if (require_sequence and sequence_status != "IN_ORDER") else [])
    base_result = {
        "rule_version": rule_version,
        "calibration_status": "CALIBRATED" if calibrated else "CALIBRATION_REQUIRED",
        "directions": direction_results,
        "unknown_frames": unknown_frames,
        "outside_time_seconds": round(outside_time, 3),
        "max_continuous_outside_seconds": round(max_continuous_outside, 3),
        "average_center_offset_m": round(average_offset, 4) if average_offset is not None else None,
        "max_center_offset_m": round(max_offset, 4) if max_offset is not None else None,
        "position_variation_m": round(variation, 4) if variation is not None else None,
        "score": round(min(100.0, score), 1),
        "result": "PASS" if passed else "NG",
        "failure_reasons": failure_reasons,
    }
    if rule_version == HOVER_RULE_V2:
        base_result.update({
            "visit_order": visit_order,
            "sequence_status": sequence_status,
            "completion_percent": completion_percent,
            "missing_directions": missing_directions,
            "partial_score": round(min(100.0, partial_score), 1),
            "hold_mode": hold_mode,
            "require_sequence": require_sequence,
        })
    return base_result
```

## 4. 測試（test_vision_center.py）
- import 加入 `HOVER_RULE_V2`
- 新增三個方法：`test_hover_v2_adds_sequence_and_completion_fields` / `test_hover_v2_cumulative_hold_counts_total_time` / `test_hover_v2_require_sequence_can_fail_out_of_order`（原始實作見本次對話紀錄）。
