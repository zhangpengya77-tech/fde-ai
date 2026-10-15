# Architecture

## Boundaries

```text
PilotInputAdapter
  -> InputNormalizer
  -> ChannelMapper
  -> FlightControllerAdapter
  -> MissionEngine
  -> InspectionEngine
  -> ScoringEngine
  -> SessionRepository
```

The Three.js rendering layer consumes state snapshots. It does not own mission, score or persistence rules. Brand-specific controllers stay behind `PilotInputAdapter`; future ArduPilot WASM and YOLO implementations must replace adapters rather than rewrite the UI.

## P1-1

`createApp()` owns the page shell, Three.js renderer, base scene and lifecycle disposal. `createRenderConfig()` limits pixel density and records the teaching-laptop frame-rate target. Later phases attach focused runtime modules through these boundaries.
