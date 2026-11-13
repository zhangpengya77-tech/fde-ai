# 01 Architecture

The canonical additive architecture is in [PHYSICS_PRO_ARCHITECTURE.md](PHYSICS_PRO_ARCHITECTURE.md).

The required dependency direction is:

```text
Input adapters -> FlightEngine -> local gateway -> verified simulated adapter -> SITL/Gazebo
                                              \-> test-only mock adapter
Renderer / CourseRunner / score / replay consume engine snapshots only.
```

This preserves WEB LITE and blocks unreviewed flight-stack state from directly changing browser score logic.
