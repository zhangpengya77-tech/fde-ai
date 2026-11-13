# P5-J5-R2 Chrome quality

Implemented renderer budgets:

| Quality | Pixel-ratio cap | Shadows | Shadow map |
| --- | ---: | --- | ---: |
| LOW | 1.00 | off | 512 |
| MEDIUM | 1.25 | on | 1024 |
| HIGH | 2.00 | on | 2048 |

MEDIUM is the stored default. The settings selector does not alter physics,
scoring, Gateway, token/session checks, or observer permissions.

Focused TypeScript and Vitest checks pass. Chrome FPS, frame time, memory,
render load, reload persistence, resource release, and read-only isolation are
not yet marked PASS because a clean browser process boundary is unavailable.
