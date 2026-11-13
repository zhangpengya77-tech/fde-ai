# P5-J5-R2 camera debug

Fresh isolated evidence remains:

- G0 camera lifecycle: `rca5-g0-sigterm-5877abf33e31`, exit `-11`.
- G5 no-sensor control: `rca5-g5-sigterm-f777a7f7123d`, exit `0`.

WSL has Gazebo Harmonic 8.15.0 and WSLg mounted, but no installed `gdb`,
`coredumpctl`, `lldb`, `eu-stack`, or `catchsegv`; `ulimit -c` is `0`.
Core policy and system packages were not changed. The next safe diagnostic is
an approved process-scoped debugger/core-capture facility, then G5 → minimal
camera → single camera → full G0 reproduction.
