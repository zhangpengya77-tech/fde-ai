# Third-Party Notices

## Runtime and Tooling

| Project | Source | License | Use |
|---|---|---|---|
| Three.js | https://github.com/mrdoob/three.js | MIT | Browser 3D rendering |
| Vite | https://github.com/vitejs/vite | MIT | Development and build tooling |
| Vitest | https://github.com/vitest-dev/vitest | MIT | Unit testing |
| Playwright | https://github.com/microsoft/playwright | Apache-2.0 | Browser acceptance testing |
| TypeScript | https://github.com/microsoft/TypeScript | Apache-2.0 | Type checking and compilation |
| qrcode-generator 1.4.4 | https://github.com/kazuhikoarase/qrcode-generator | MIT | 手機遙控器配對 QR 碼（收錄於 `src/vendor/qrcode-generator.js`，保留原作者版權聲明） |
| MediaPipe Tasks Vision 0.10.14＋hand_landmarker 模型 | https://github.com/google-ai-edge/mediapipe | Apache-2.0 | 手勢搖桿手部辨識（`src/vendor/mediapipe/`、`public/mediapipe/`；未修改，開啟手勢時才載入） |

Installed versions are pinned by `package-lock.json`.

## Design References Only

| Project | Source | License | Boundary |
|---|---|---|---|
| DroneCommander | https://github.com/vroby65/DroneCommander | MIT | Concepts reviewed; no source copied in P1-1 |
| ardupilot-wasm / ArduPilot | https://github.com/pauldw/ardupilot-wasm | GPLv3 components | Interface reference only; not included or distributed |
| powerline_inspection_simulation | https://github.com/lactec-cfg-drones/powerline_inspection_simulation | Apache-2.0 | Scene/task concepts reviewed; no source or assets copied |
| uav-path-planning-demo | https://github.com/Xieyizhou/uav-path-planning-demo | MIT | Planning/safety concepts reviewed; no source copied |

No third-party 3D model is included in P1-1.
