# Hardware Resource Report

Audit snapshot: Dell laptop, 16 GiB RAM, NVIDIA MX450 2 GiB VRAM. C drive is capacity-constrained; D drive has limited free capacity.

## Operational limits

- Start with one headless SITL process and one browser.
- Do not start multi-vehicle Gazebo or high-resolution rendering.
- Measure RAM, CPU, GPU and frame time before raising fidelity.
- Keep logs, build artifacts and package caches off C where possible.

## Measurements and deferred work

Actual CPU, RAM, GPU and FPS sampling is **NOT RUN**. A single real headless ArduPilot SITL/browser integration is within the current machine's available scope; the successful browser test completed in 56.6s. Gazebo is not installed or tested, so multi-vehicle and graphical-Gazebo work remain blocked pending a separately approved capacity review.
