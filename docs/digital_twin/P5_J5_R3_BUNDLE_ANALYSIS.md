# P5-J5-R3 bundle analysis

Production build passes. Largest asset is shared `three.module` at about 557
KiB; existing mode entrypoints already use dynamic imports in `src/main.ts`.
No safe small code-splitting change was identified without moving shared Three
objects or changing mode-loading behavior, so no speculative optimization was
applied.
