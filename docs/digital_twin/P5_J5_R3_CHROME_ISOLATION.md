# P5-J5-R3 Chrome isolation

The R3 runner (`scripts/p5j5-quality-chrome-isolated.ps1`) starts a Vite Node
process by exact PID on a caller-selected loopback port, writes a per-run
result file, and terminates only that exact child in `finally`.

Runs `quality-ae936341e67f4114b49ee36bba331cd7` (4192) and
`quality-9bfb0a2d5f754b58b6d406ff12a2ceda` (4193) both reached real Chrome
but timed out at 90 seconds. Run `quality-775f24f927514a069e826d6fd0e954bc`
(4194) confirmed the same failure; failure-only tracing caused recursive
artifact expansion and was disabled to prevent disk risk. None is a PASS.
