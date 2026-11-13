# Physics Pro Architecture

## Minimum additive architecture

```text
Existing input adapters
  -> PilotInputPipeline
  -> FlightEngine
       ├─ FlightSession (WEB LITE, existing)
       └─ SitlEngine (PHYSICS PRO, existing draft)
             -> FDE-DT Gateway (127.0.0.1 only)
                   -> pymavlink adapter (existing FDE-DT service)
                         -> ArduPilot SITL (verified local instance)
                               -> Gazebo Sim (future optional physical world)
```

Three.js remains a rendering consumer. CourseRunner, score, replay and browser input remain engine-agnostic.

## Authority rules

1. WEB LITE state is authoritative only for WEB LITE sessions.
2. Physics Pro browser state is authoritative only when gateway telemetry identifies a running local SITL session.
3. Mode changes are rejected while a session is flying; an explicit restart is required.
4. No layer may identify mock telemetry as real SITL telemetry.

## Single-vehicle scope

One local active simulation session per gateway process. Each future instance carries configurable MAVLink System ID and Component ID. Multi-vehicle orchestration is deliberately deferred until the single-vehicle isolation test passes.
