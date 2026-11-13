# SITL and Gazebo Setup Plan

Status: ArduPilot SITL is **available and validated through the separate FDE-DT service**; Gazebo is **not installed / not validated**.

## Chosen order

1. Preserve and regression-test the existing headless FDE-DT ArduPilot SITL service.
2. Verify loopback MAVLink, HEARTBEAT, telemetry, logs and safe disconnect.
3. Add official `ardupilot_gazebo` with a minimal world only after a separate capacity and version decision.
4. Use low-quality or headless Gazebo first on the 16 GiB RAM / MX450 2 GiB laptop.

## Capacity gate

Before installing dependencies, remeasure C/D/E drives and estimate clone, build, package cache and log space. D is preferred; do not use E without confirming that its volume remains available. No installer or administrator action is implicit in this plan.

## Version policy

Pin ArduPilot, Gazebo and plugin revisions only after reading the selected official compatibility matrix. Do not use historical Prometheus PX4/Gazebo instructions as a current version lock.
