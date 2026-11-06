import * as THREE from 'three';

import { loadF450 } from '../drone/load-f450';
import type { FlightSnapshot, FlightState, PilotCommand } from '../flight/types';
import { SimpleFlightController } from '../flight/adapters/SimpleFlightController';
import { KeyboardInputAdapter } from '../input/adapters/KeyboardInputAdapter';
import { GamepadInputAdapter } from '../input/adapters/GamepadInputAdapter';
// 2026-11-07：原子筆鏡頭搖桿、手機遙控器與「連線方式」面板
import { PenCameraInputAdapter } from '../input/adapters/PenCameraInputAdapter';
import { PhoneLinkInputAdapter } from '../input/adapters/PhoneLinkInputAdapter';
import { HandGestureInputAdapter } from '../input/adapters/HandGestureInputAdapter';
import { LinkPanel } from '../ui/link-panel';
import { normalizeInputSource, showPracticeToast, syncPractice } from '../report/practice-sync';
import { PilotInputPipeline, type PilotInputSource, type PipelineTrace } from '../input/PilotInputPipeline';
import { ControllerCalibrationPanel, type ActiveProfileInfo } from '../ui/controller-calibration';
import { describeChain } from '../ui/input-chain';
import { resolveProfileStore } from '../ui/profile-store';
import type { DeviceProfile } from '../input/device-profile';
import { BUNDLED_RC_PROFILE_ENDPOINT, describeAxisMapping, fetchLatestRcProfile } from '../input/auto-profile';
import { createRenderConfig } from './render-config';
import { SafetyDistanceEngine } from '../safety/SafetyEngine';
import { createTransmissionScene } from '../scenes/transmission/create-transmission-scene';
import { classifyInspectionAIResult } from '../inspection/types';
import type { SafetyState, InspectionAIResult, InspectionCaptureRecord, Vec3 } from '../inspection/types';
import { MissionEngine } from '../mission/MissionEngine';
import { DEFAULT_MISSION_CONFIG, type MissionState, type MissionTelemetry } from '../mission/types';
import { GimbalCamera } from '../camera/GimbalCamera';
import { ProjectionPhotoValidator, DEFAULT_PHOTO_VALIDATOR_CONFIG } from '../camera/ProjectionPhotoValidator';
import type { PhotoSample } from '../camera/ProjectionPhotoValidator';
import { MockInspectionAI } from '../ai/MockInspectionAI';
import { resolveInspectionCaptureStore } from '../persistence/inspection-capture-store';
import { resolveMissionReportStore } from '../persistence/mission-report-store';
import { ScoringEngine } from '../scoring/ScoringEngine';
import { SessionRecorder } from '../scoring/SessionRecorder';
import type { MissionScoreResult } from '../scoring/types';
import { DEFAULT_SCORE_CONFIG } from '../scoring/config';
import { buildMissionReport, serializeReport, formatDuration } from '../report/mission-report';
import type { MissionReport, ReportCaptureEntry, ReportStatus } from '../report/types';
import { zhHant as L } from '../i18n/zh-Hant';

export interface AppHandle {
  dispose(): void;
}

function createInterface(root: HTMLElement): HTMLElement {
  root.innerHTML = `
    <main class="training-shell" data-app-status="booting">
      <header class="topbar">
        <div class="brand-block">
          <span class="brand-mark" aria-hidden="true">FDE</span>
          <div>
            <h1>${L.brandTitle}</h1>
            <p>${L.brandSub}</p>
          </div>
        </div>
        <div class="system-state" role="status">
          <span class="state-dot" aria-hidden="true"></span>
          ${L.localEnv}
        </div>
      </header>

      <section class="workspace" aria-label="無人機巡檢訓練台">
        <aside class="panel mission-panel">
          <div class="panel-heading">
            <span class="step-number">01</span>
            <div>
              <p class="eyebrow">${L.currentTask}</p>
              <h2>${L.missionTitle}</h2>
            </div>
          </div>
          <dl class="mission-facts">
            <div><dt>${L.missionTarget}</dt><dd data-inspection-target>${L.targetPending}</dd></div>
            <div><dt>${L.currentStep}</dt><dd data-mission-step>${L.stepPending}</dd></div>
            <div><dt>${L.missionProgress}</dt><dd data-mission-progress>${L.dash}</dd></div>
            <div><dt>${L.distTarget}</dt><dd data-distance-target>${L.dash} m</dd></div>
            <div><dt>${L.distObstacle}</dt><dd data-distance-obstacle>${L.dash} m</dd></div>
            <div><dt>${L.gimbalPitchYaw}</dt><dd><b data-gimbal-pitch>0</b>° / <b data-gimbal-yaw>0</b>°</dd></div>
          </dl>
          <div class="safety-block">
            <div class="safety-row">
              <span>${L.safetyState}</span>
              <strong data-safety-status class="safety-safe">${L.safe}</strong>
            </div>
            <div class="safety-row">
              <span>${L.inspectionZone}</span>
              <strong data-inspection-zone>${L.zoneOut}</strong>
            </div>
          </div>
          <p class="mission-hint" data-mission-hint>${L.missionHint}</p>
          <div class="phase-notice">
            <strong>${L.phaseTag}</strong>
            <span>${L.phaseDesc}</span>
          </div>
        </aside>

        <section class="scene-panel" aria-label="三維訓練場景">
          <div class="scene-toolbar">
            <div>
              <span class="toolbar-label">${L.sceneLabel}</span>
              <strong>${L.sceneName}</strong>
            </div>
            <div class="coordinates" aria-label="座標狀態">
              <span>${L.axisX} <b data-position-x>0.0</b></span>
              <span>${L.axisY} <b data-position-y>0.0</b></span>
              <span>${L.axisZ} <b data-position-z data-value="0">0.0</b></span>
              <span class="heading-chip">航向 <b data-heading>0°</b></span>
            </div>
            <div class="view-switch" role="group" aria-label="視角切換">
              <button type="button" data-view="chase" aria-pressed="true">追尾</button>
              <button type="button" data-view="top" aria-pressed="false">俯視</button>
              <button type="button" data-view="world" aria-pressed="false">固定</button>
            </div>
            <button type="button" class="scene-fullscreen" data-action="fullscreen" aria-label="${L.fullscreen}">${L.fullscreen}</button>
          </div>
          <div class="scene-mount" data-scene-mount></div>
          <div class="scene-scale" aria-hidden="true"><span></span> ${L.scale10m}</div>

          <!-- 固定顯示：目前生效標定 + 四軸實測值（真機驗收用，貼在三維畫面上） -->
          <section class="rc-hud" data-rc-hud data-state="offline" aria-label="遙控器即時狀態">
            <div class="rc-hud-head">
              <span class="rc-hud-dot" aria-hidden="true"></span>
              <strong data-rc-hud-title>遙控器未連接</strong>
              <button type="button" class="rc-hud-toggle" data-action="rc-hud-toggle" aria-expanded="true">收起</button>
            </div>
            <dl class="rc-hud-meta">
              <div><dt>來源</dt><dd data-rc-hud-origin>—</dd></div>
              <div><dt>檔案</dt><dd data-rc-hud-file>—</dd></div>
              <div><dt>時間</dt><dd data-rc-hud-saved>—</dd></div>
              <div><dt>映射</dt><dd data-rc-hud-mapping>—</dd></div>
            </dl>
            <ul class="rc-hud-axes">
              <li data-rc-hud-row="pitch">
                <span class="rc-hud-name">Pitch<em>上推=前進</em></span>
                <i class="rc-hud-bar"><b data-rc-hud-bar="pitch"></b></i>
                <strong data-rc-hud-value="pitch">+0.00</strong>
              </li>
              <li data-rc-hud-row="roll">
                <span class="rc-hud-name">Roll<em>右打=右移</em></span>
                <i class="rc-hud-bar"><b data-rc-hud-bar="roll"></b></i>
                <strong data-rc-hud-value="roll">+0.00</strong>
              </li>
              <li data-rc-hud-row="yaw">
                <span class="rc-hud-name">Yaw<em>右打=右轉</em></span>
                <i class="rc-hud-bar"><b data-rc-hud-bar="yaw"></b></i>
                <strong data-rc-hud-value="yaw">+0.00</strong>
              </li>
              <li data-rc-hud-row="throttle">
                <span class="rc-hud-name">Thr<em>上推=加大</em></span>
                <i class="rc-hud-bar"><b data-rc-hud-bar="throttle"></b></i>
                <strong data-rc-hud-value="throttle">0.00</strong>
              </li>
            </ul>
            <!-- 鏈路即時診斷：raw → norm → cmd → 機身座標位移（一眼看出哪一層錯） -->
            <div class="rc-chain" data-rc-chain data-layer="idle" aria-label="輸入鏈路診斷">
              <div class="rc-chain-head">
                <span>鏈路</span><span>raw</span><span>norm</span><span>cmd</span><span>位移 前/右</span>
              </div>
              <div class="rc-chain-row" data-rc-chain-row="pitch" data-verdict="idle">
                <span class="rc-chain-name">Pitch<em data-rc-chain-axis="pitch">a—</em></span>
                <b data-rc-chain-raw="pitch">—</b>
                <b data-rc-chain-norm="pitch">—</b>
                <b data-rc-chain-cmd="pitch">—</b>
                <b data-rc-chain-move="pitch">—</b>
              </div>
              <div class="rc-chain-row" data-rc-chain-row="roll" data-verdict="idle">
                <span class="rc-chain-name">Roll<em data-rc-chain-axis="roll">a—</em></span>
                <b data-rc-chain-raw="roll">—</b>
                <b data-rc-chain-norm="roll">—</b>
                <b data-rc-chain-cmd="roll">—</b>
                <b data-rc-chain-move="roll">—</b>
              </div>
              <p class="rc-chain-message" data-rc-chain-message>靜止：推桿後這裡會指出是哪一層出錯。</p>
            </div>
            <button type="button" class="rc-hud-clear" data-action="rc-hud-clear">清除本機標定並重新載入</button>
          </section>
        </section>

        <aside class="panel camera-panel">
          <div class="panel-heading compact">
            <span class="step-number">02</span>
            <div>
              <p class="eyebrow">${L.gimbalView}</p>
              <h2>${L.rgbCamera}</h2>
            </div>
          </div>
          <div class="camera-standby" aria-label="雲台相機">
            <img class="photo-preview" data-photo-preview alt="${L.capturePhoto}" hidden />
            <div class="photo-placeholder" data-photo-placeholder>
              <div class="focus-frame" aria-hidden="true"></div>
              <span>${L.cameraStandby}</span>
            </div>
          </div>
          <dl class="camera-readout">
            <div><dt>${L.yawLabel}</dt><dd data-gimbal-readout-yaw>0°</dd></div>
            <div><dt>${L.pitchLabel}</dt><dd data-gimbal-readout-pitch>0°</dd></div>
            <div><dt>${L.zoomLabel}</dt><dd>1.0×</dd></div>
          </dl>
          <p class="gimbal-keys">${L.gimbalKeys}</p>
        </aside>

        <aside class="panel telemetry-panel">
          <p class="eyebrow">${L.flightStatus}</p>
          <div class="telemetry-grid">
            <div><span>${L.altitude}</span><strong><b data-altitude data-value="0">0.0</b> <small>m</small></strong></div>
            <div><span>${L.speed}</span><strong>0.0 <small>m/s</small></strong></div>
            <div><span>${L.heading}</span><strong>000 <small>°</small></strong></div>
            <div><span>${L.mode}</span><strong class="mode-text is-idle" data-flight-state>${L.standby}</strong></div>
          </div>
        </aside>

        <aside class="panel checklist-panel">
          <p class="eyebrow">${L.checklist}</p>
          <ol>
            <li><span class="check-state" data-check-target>—</span><span>${L.targetLocate}</span></li>
            <li><span class="check-state" data-check-safety>—</span><span>${L.safeDistance}</span></li>
            <li><span class="check-state" data-check-evidence>—</span><span>${L.inspectEvidence}</span></li>
          </ol>
          <div class="mission-result">
            <div class="result-row"><span>${L.photo}</span><strong data-photo-result>${L.notShot}</strong></div>
            <p class="result-reasons" data-photo-reasons></p>
            <div class="result-row"><span>${L.mockAI}</span><strong data-ai-state>${L.notDetected}</strong></div>
            <p class="result-reasons" data-ai-detail></p>
            <div class="result-row"><span>${L.missionStatus}</span><strong data-mission-state>${L.stepPending}</strong></div>
          </div>
          <button type="button" class="score-reopen" data-action="show-score" hidden>${L.viewScore}</button>
        </aside>

        <aside class="panel calibration-anchor" data-calibration-anchor aria-label="遙控器標定"></aside>
      </section>

      <footer class="control-deck" aria-label="飛行操作區">
        <div class="control-group">
          <button type="button" data-action="arm">${L.arm}</button>
          <button type="button" data-action="takeoff">${L.takeoff}</button>
          <button type="button" data-action="hover">${L.hover}</button>
          <button type="button" data-action="capture" class="capture-button">${L.capturePhoto}</button>
          <button type="button" data-action="rtl">${L.rtl}</button>
          <button type="button" data-action="land">${L.land}</button>
          <button type="button" class="reports-button" data-action="open-reports">${L.missionRecord}</button>
          <button type="button" class="link-button" data-action="open-link">🔗 連線方式</button>
        </div>
        <div class="phase-status">
          <span>${L.flightController}</span>
          <strong data-flight-mode>${L.hover}</strong>
        </div>
        <div class="phase-status input-source-status">
          <span>${L.inputSource}</span>
          <strong data-input-source>${L.keyboard}</strong>
        </div>
      </footer>

      <div class="score-overlay" data-score-overlay hidden>
        <div class="score-block" data-score-panel>
          <div class="score-total">
            <span class="score-total-label">${L.teachingScore}</span>
            <strong><b data-score-total>0</b> / 100</strong>
            <em class="score-grade" data-score-grade>—</em>
          </div>
          <ul class="score-dimensions">
            <li data-score-dimension="mission-completion" data-score-status>
              <span class="score-dim-name">${L.scoreDimensions.missionCompletion}</span>
              <b class="score-dim-value" data-score-value>—</b>
              <p class="score-dim-reason" data-score-reason></p>
            </li>
            <li data-score-dimension="flight-safety" data-score-status>
              <span class="score-dim-name">${L.scoreDimensions.flightSafety}</span>
              <b class="score-dim-value" data-score-value>—</b>
              <p class="score-dim-reason" data-score-reason></p>
            </li>
            <li data-score-dimension="inspection-position" data-score-status>
              <span class="score-dim-name">${L.scoreDimensions.inspectionPosition}</span>
              <b class="score-dim-value" data-score-value>—</b>
              <p class="score-dim-reason" data-score-reason></p>
            </li>
            <li data-score-dimension="photo-quality" data-score-status>
              <span class="score-dim-name">${L.scoreDimensions.photoQuality}</span>
              <b class="score-dim-value" data-score-value>—</b>
              <p class="score-dim-reason" data-score-reason></p>
            </li>
            <li data-score-dimension="flight-efficiency" data-score-status>
              <span class="score-dim-name">${L.scoreDimensions.flightEfficiency}</span>
              <b class="score-dim-value" data-score-value>—</b>
              <p class="score-dim-reason" data-score-reason></p>
            </li>
            <li data-score-dimension="control-stability" data-score-status>
              <span class="score-dim-name">${L.scoreDimensions.controlStability}</span>
              <b class="score-dim-value" data-score-value>—</b>
              <p class="score-dim-reason" data-score-reason></p>
            </li>
          </ul>
          <p class="score-issues" data-score-issues hidden></p>
          <div class="score-suggestions" data-score-suggestions hidden>
            <p class="score-suggestions-title">${L.teachingSuggestions}</p>
            <ul data-score-suggestion-list></ul>
          </div>
          <button type="button" class="score-close" data-action="close-score">${L.gotIt}</button>
        </div>
      </div>

      <div class="reports-overlay" data-reports-overlay hidden>
        <div class="reports-block" data-reports-block>
          <div class="reports-head">
            <div>
              <h2 data-reports-title>${L.recordTitle}</h2>
              <span class="report-role-badge" data-report-role>${L.studentRecord}</span>
            </div>
            <button type="button" class="score-close" data-action="close-reports">${L.close}</button>
          </div>
          <div class="report-role-toggle" role="tablist" aria-label="查看視角">
            <button type="button" class="role-tab" data-report-role-tab="student" aria-pressed="true">${L.studentView}</button>
            <button type="button" class="role-tab" data-report-role-tab="teacher" aria-pressed="false">${L.teacherView}</button>
          </div>
          <p class="report-teacher-note" data-report-teacher-note hidden>${L.teacherNote}</p>
          <div class="reports-list" data-reports-list></div>
          <div class="report-detail report-print" data-report-detail hidden></div>
        </div>
      </div>
    </main>
  `;

  const shell = root.querySelector<HTMLElement>('.training-shell');
  if (!shell) throw new Error('Training shell was not created.');
  return shell;
}

export function createApp(root: HTMLElement): AppHandle {
  const shell = createInterface(root);
  const mount = root.querySelector<HTMLElement>('[data-scene-mount]');
  if (!mount) throw new Error('Scene mount was not found.');

  const config = createRenderConfig(window.devicePixelRatio);
  const renderer = new THREE.WebGLRenderer({
    antialias: config.antialias,
    alpha: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(config.pixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.dataset.scene = 'training';
  renderer.domElement.setAttribute('aria-label', '三維電力巡檢訓練場景');
  mount.append(renderer.domElement);

  const scene = new THREE.Scene();

  const transmissionScene = createTransmissionScene(scene);
  shell.dataset.scene = 'transmission';
  shell.dataset.towerCount = String(transmissionScene.towerCount);
  shell.dataset.wireCount = String(transmissionScene.wireCount);
  shell.dataset.targetSet = 'true';
  shell.dataset.inspectionReady = 'true';

  const safetyEngine = new SafetyDistanceEngine(transmissionScene.layout);

  // --- P1-5 mission loop: gimbal, photo capture, validation and mock AI -------
  const layout = transmissionScene.layout;
  const TARGET_POS: Vec3 = layout.target.position;
  const INSPECTION_TARGET_RADIUS = 0.3;
  const CAPTURE_W = 512;
  const CAPTURE_H = 288;
  const CAPTURE_ASPECT = CAPTURE_W / CAPTURE_H;
  const GIMBAL_STEP_DEG = 4;

  const mission = new MissionEngine();
  const gimbal = new GimbalCamera();
  // P1-6 teaching score: the recorder collects real run data, the engine is
  // pure. The UI never computes a number itself.
  const sessionRecorder = new SessionRecorder();
  const scoringEngine = new ScoringEngine();
  let scoreResult: MissionScoreResult | null = null;
  /** The trainee closed the score card; it can be re-opened from the checklist. */
  let scoreDismissed = false;
  const photoValidator = new ProjectionPhotoValidator({
    ...DEFAULT_PHOTO_VALIDATOR_CONFIG,
  });
  // The mock is wired with the target's *identity* and the capture geometry
  // only. The scene's planted defect (`layout.target.defectType`) is never
  // handed to it - not through the request and not through construction - so
  // the detector cannot read the answer it is supposed to produce.
  const mockAI = new MockInspectionAI({
    targetId: layout.target.id,
    idealDistanceM: 2.4,
    maxAngleErrorDeg: DEFAULT_PHOTO_VALIDATOR_CONFIG.maxAngleErrorDeg,
  });
  const captureStore = resolveInspectionCaptureStore();
  const reportStore = resolveMissionReportStore();
  /** P1-7: every capture of the current run, for the trainee report. */
  const missionCaptures: InspectionCaptureRecord[] = [];
  let missionStartedAt = 0;
  let lastReport: MissionReport | null = null;
  let currentDetailReport: MissionReport | null = null;
  let reportRole: 'student' | 'teacher' = 'student';
  let missionId = `mission-${Date.now()}`;
  sessionRecorder.reset(missionId);
  sessionRecorder.setSceneReference({ x: 0, y: 0, z: 0 }, TARGET_POS);
  let recordSeq = 0;
  let prevMissionState = mission.currentState;
  /** Set when a capture request was refused; shown until the next capture. */
  let captureRefusal: string | null = null;

  const captureCamera = new THREE.PerspectiveCamera(DEFAULT_PHOTO_VALIDATOR_CONFIG.fovYDeg, CAPTURE_ASPECT, 0.1, 200);
  const captureTarget = new THREE.WebGLRenderTarget(CAPTURE_W, CAPTURE_H);

  const missionDom = {
    step: root.querySelector<HTMLElement>('[data-mission-step]'),
    progress: root.querySelector<HTMLElement>('[data-mission-progress]'),
    hint: root.querySelector<HTMLElement>('[data-mission-hint]'),
    gimbalPitch: root.querySelector<HTMLElement>('[data-gimbal-pitch]'),
    gimbalYaw: root.querySelector<HTMLElement>('[data-gimbal-yaw]'),
    gimbalReadoutPitch: root.querySelector<HTMLElement>('[data-gimbal-readout-pitch]'),
    gimbalReadoutYaw: root.querySelector<HTMLElement>('[data-gimbal-readout-yaw]'),
    checkTarget: root.querySelector<HTMLElement>('[data-check-target]'),
    checkSafety: root.querySelector<HTMLElement>('[data-check-safety]'),
    checkEvidence: root.querySelector<HTMLElement>('[data-check-evidence]'),
    photoResult: root.querySelector<HTMLElement>('[data-photo-result]'),
    photoReasons: root.querySelector<HTMLElement>('[data-photo-reasons]'),
    aiState: root.querySelector<HTMLElement>('[data-ai-state]'),
    aiDetail: root.querySelector<HTMLElement>('[data-ai-detail]'),
    missionState: root.querySelector<HTMLElement>('[data-mission-state]'),
    photoPreview: root.querySelector<HTMLImageElement>('[data-photo-preview]'),
    photoPlaceholder: root.querySelector<HTMLElement>('[data-photo-placeholder]'),
  };

  function clampDeg(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  function dronePosition(): Vec3 {
    if (droneEntity) {
      return { x: droneEntity.group.position.x, y: droneEntity.group.position.y, z: droneEntity.group.position.z };
    }
    return { x: lastSnapshot.position.x, y: lastSnapshot.position.y + 0.5, z: lastSnapshot.position.z };
  }

  /** World-space capture-camera pose from the drone pose + the gimbal angles. */
  function computeCameraPose(): { position: Vec3; forward: Vec3 } {
    const headingRad = (lastSnapshot.headingDeg * Math.PI) / 180;
    const gimbalYawRad = (gimbal.yaw * Math.PI) / 180;
    const pitchRad = (gimbal.pitch * Math.PI) / 180;
    const heading = headingRad + gimbalYawRad;
    return {
      position: dronePosition(),
      forward: {
        x: Math.cos(pitchRad) * Math.sin(heading),
        y: Math.sin(pitchRad),
        z: -Math.cos(pitchRad) * Math.cos(heading),
      },
    };
  }

  function angleToTargetDeg(forward: Vec3, position: Vec3): number {
    const dx = TARGET_POS.x - position.x;
    const dy = TARGET_POS.y - position.y;
    const dz = TARGET_POS.z - position.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    const dp = (forward.x * dx + forward.y * dy + forward.z * dz) / dist;
    return (Math.acos(clampDeg(dp, -1, 1)) * 180) / Math.PI;
  }

  function gimbalAimed(): boolean {
    const pose = computeCameraPose();
    return angleToTargetDeg(pose.forward, pose.position) <= DEFAULT_MISSION_CONFIG.aimToleranceDeg;
  }

  function buildTelemetry(): MissionTelemetry {
    const pos = lastSnapshot.position;
    const home = lastSnapshot.homePoint;
    return {
      flightState: lastSnapshot.state,
      altitude: pos.y,
      position: pos,
      homePoint: home,
      insideInspectionZone: inspectionResult.insideInspectionZone,
      safetyState: inspectionResult.safetyState,
      distanceToTarget: inspectionResult.distanceToTarget,
      // Horizontal distance: RTL brings the aircraft overhead the home point
      // (it holds >= 5 m until the mission's LAND step), so vertical distance
      // must not block the RETURN -> LAND transition.
      distanceToHome: Math.hypot(pos.x - home.x, pos.z - home.z),
      gimbalAimed: gimbalAimed(),
    };
  }

  /** Real Three.js capture: render the current camera view to the render target. */
  function renderCaptureToDataUrl(position: Vec3, forward: Vec3): string {
    captureCamera.position.set(position.x, position.y, position.z);
    captureCamera.up.set(0, 1, 0);
    captureCamera.lookAt(position.x + forward.x, position.y + forward.y, position.z + forward.z);
    captureCamera.updateProjectionMatrix();
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(captureTarget);
    renderer.render(scene, captureCamera);
    const pixels = new Uint8Array(CAPTURE_W * CAPTURE_H * 4);
    renderer.readRenderTargetPixels(captureTarget, 0, 0, CAPTURE_W, CAPTURE_H, pixels);
    renderer.setRenderTarget(previous);
    const canvas = document.createElement('canvas');
    canvas.width = CAPTURE_W;
    canvas.height = CAPTURE_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    const image = ctx.createImageData(CAPTURE_W, CAPTURE_H);
    for (let row = 0; row < CAPTURE_H; row += 1) {
      const src = (CAPTURE_H - 1 - row) * CAPTURE_W * 4;
      const dst = row * CAPTURE_W * 4;
      for (let col = 0; col < CAPTURE_W * 4; col += 1) image.data[dst + col] = pixels[src + col];
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
  }

  function showPreview(dataUrl: string): void {
    if (missionDom.photoPreview && missionDom.photoPlaceholder) {
      // 空 dataUrl 保護：沒有實際照片時保持隱藏，避免渲染破圖。
      if (!dataUrl) {
        missionDom.photoPreview.removeAttribute('src');
        missionDom.photoPreview.hidden = true;
        missionDom.photoPlaceholder.hidden = false;
        return;
      }
      missionDom.photoPreview.src = dataUrl;
      missionDom.photoPreview.hidden = false;
      missionDom.photoPlaceholder.hidden = true;
    }
  }

  function setCheckState(el: HTMLElement | null, done: boolean): void {
    if (el) el.textContent = done ? '✓' : '—';
  }

  async function captureInspection(): Promise<void> {
    const permission = mission.requestCapture();
    if (!permission.ok) {
      // Kept in state so the per-frame updateMissionUI keeps showing the
      // refusal until the next real capture clears it.
      captureRefusal = permission.reason ?? '當前無法拍攝';
      updateMissionUI();
      return;
    }
    captureRefusal = null;

    const pose = computeCameraPose();
    const photoDataUrl = renderCaptureToDataUrl(pose.position, pose.forward);
    const geo = safetyEngine.evaluate(pose.position);
    const sample: PhotoSample = {
      cameraPosition: pose.position,
      cameraForward: pose.forward,
      targetPosition: TARGET_POS,
      targetRadius: INSPECTION_TARGET_RADIUS,
      aspect: CAPTURE_ASPECT,
      insideInspectionZone: geo.insideInspectionZone,
      safetyState: geo.safetyState,
    };
    const photo = photoValidator.validate(sample);
    mission.submitPhoto(photo);
    showPreview(photoDataUrl);

    recordSeq += 1;
    const captureId = `cap-${recordSeq}-${Date.now()}`;

    let ai: InspectionAIResult | null = null;
    if (photo.valid) {
      try {
        ai = await mockAI.inspect({
          requestId: captureId,
          targetId: layout.target.id,
          // The detector only ever sees the captured frame + camera geometry.
          // The scene's planted defect (`layout.target.defectType`) is
          // deliberately NOT passed in - that would leak the answer.
          image: photoDataUrl ? { dataUrl: photoDataUrl } : null,
          distanceToTarget: photo.distanceToTarget,
          angleErrorDeg: photo.angleErrorDeg,
          coverageRatio: photo.coverageRatio,
        });
      } catch (error) {
        // A failed model must never be read as "no defect".
        ai = {
          defectDetected: false,
          defectType: null,
          confidence: 0,
          source: 'unavailable',
          reason: `AI 呼叫失敗：${error instanceof Error ? error.message : String(error)}`,
        };
      }
      mission.submitAI(ai);
    }

    const record: InspectionCaptureRecord = {
      id: captureId,
      missionId,
      timestamp: Date.now(),
      targetId: layout.target.id,
      aircraftPosition: { ...lastSnapshot.position },
      altitude: lastSnapshot.position.y,
      attitude: { rollDeg: lastSnapshot.rollDeg, pitchDeg: lastSnapshot.pitchDeg, yawDeg: lastSnapshot.headingDeg },
      gimbalPitchDeg: gimbal.pitch,
      gimbalYawDeg: gimbal.yaw,
      distanceToTarget: photo.distanceToTarget,
      distanceToWire: geo.distanceToWire,
      distanceToTower: geo.distanceToTower,
      safetyState: photo.safetyState,
      photoValidation: photo,
      aiResult: ai,
      photoDataUrl,
    };
    void captureStore.save(record).catch(() => undefined);
    sessionRecorder.recordCapture(record);
    missionCaptures.push(record);
    updateMissionUI();
  }

  // --- P1-6 teaching score ---------------------------------------------------
  const SCORE_DIMENSION_DOM_KEY: Record<keyof MissionScoreResult['dimensions'], string> = {
    missionCompletion: 'mission-completion',
    flightSafety: 'flight-safety',
    inspectionPosition: 'inspection-position',
    photoQuality: 'photo-quality',
    flightEfficiency: 'flight-efficiency',
    controlStability: 'control-stability',
  };

  function updateScoreUI(): void {
    const overlay = root.querySelector<HTMLElement>('[data-score-overlay]');
    const reopen = root.querySelector<HTMLElement>('[data-action="show-score"]');
    if (!overlay) return;
    if (!scoreResult) {
      overlay.hidden = true;
      if (reopen) reopen.hidden = true;
      return;
    }
    overlay.hidden = scoreDismissed;
    if (reopen) reopen.hidden = !scoreDismissed;

    const panel = root.querySelector<HTMLElement>('[data-score-panel]');
    if (!panel) return;

    const setText = (selector: string, text: string): void => {
      const element = panel.querySelector<HTMLElement>(selector);
      if (element) element.textContent = text;
    };

    setText('[data-score-total]', String(scoreResult.totalScore));
    setText('[data-score-grade]', scoringEngine.config.labels[scoreResult.grade]);

    (Object.keys(scoreResult.dimensions) as Array<keyof MissionScoreResult['dimensions']>).forEach((key) => {
      const dimension = scoreResult?.dimensions[key];
      if (!dimension) return;
      const row = panel.querySelector<HTMLElement>(`[data-score-dimension="${SCORE_DIMENSION_DOM_KEY[key]}"]`);
      if (!row) return;
      const value = row.querySelector<HTMLElement>('[data-score-value]');
      const reason = row.querySelector<HTMLElement>('[data-score-reason]');
      if (value) value.textContent = `${dimension.score} / ${dimension.maxScore}`;
      if (reason) reason.textContent = dimension.reasons.join('；');
      row.dataset.scoreStatus = dimension.status;
    });

    const issues = panel.querySelector<HTMLElement>('[data-score-issues]');
    if (issues) {
      const lines = [...(scoreResult.capReason ? [scoreResult.capReason] : []), ...scoreResult.majorIssues];
      issues.hidden = lines.length === 0;
      issues.textContent = lines.join('；');
    }

    const suggestionsBlock = panel.querySelector<HTMLElement>('[data-score-suggestions]');
    const suggestionList = panel.querySelector<HTMLElement>('[data-score-suggestion-list]');
    if (suggestionsBlock && suggestionList) {
      suggestionsBlock.hidden = scoreResult.suggestions.length === 0;
      suggestionList.textContent = '';
      for (const suggestion of scoreResult.suggestions) {
        const item = document.createElement('li');
        item.textContent = suggestion;
        suggestionList.append(item);
      }
    }
  }

  /**
   * Score once per run, from real recorded data, when the run is over:
   * mission COMPLETE / FAILED, or the trainee landed early without finishing.
   */
  function maybeComputeScore(): void {
    if (scoreResult) return;
    const state = mission.currentState;
    const terminal = state === 'COMPLETE' || state === 'FAILED';
    const landedEarly = lastSnapshot.state === 'armed' && lastSnapshot.position.y <= 0.1;
    if (!terminal && !(landedEarly && sessionRecorder.hasReachedTakeoff())) return;
    scoreResult = scoringEngine.score(sessionRecorder.session());
    scoreDismissed = false;
    updateScoreUI();
    // P1-7: assemble the trainee report from the SAME real recorded data and
    // persist it. No value is invented - it is only reorganised for review.
    const report = buildMissionReport({
      missionId,
      taskName: '輸電塔右側絕緣子串巡檢',
      targetId: layout.target.id,
      targetName: layout.target.label ?? '絕緣子串巡檢點',
      startedAt: missionStartedAt || Date.now(),
      finishedAt: Date.now(),
      session: sessionRecorder.session(),
      score: scoreResult,
      captures: missionCaptures.map(toReportCaptureEntry),
      controlSamples: sessionRecorder.controlSamples(),
    });
    lastReport = report;
    // 2026-11-07：登入學員的練習成績自動存入成長日誌（只送成績摘要）
    void syncPractice({
      mode: 'inspection',
      title: report.taskName,
      score: report.score.totalScore,
      grade: String(report.score.grade),
      duration_seconds: Math.round(report.durationMs / 1000),
      input_source: practiceInputSource,
      summary: { pathLengthM: Math.round(report.pathLengthM * 10) / 10, maxAltitudeM: Math.round(report.maxAltitudeM * 10) / 10, status: report.status },
    }).then(showPracticeToast);
    void reportStore.save(report).catch(() => undefined);
  }

  function toReportCaptureEntry(record: InspectionCaptureRecord): ReportCaptureEntry {
    return {
      index: missionCaptures.indexOf(record) + 1,
      timestamp: record.timestamp,
      valid: record.photoValidation.valid,
      photoValidation: record.photoValidation,
      safetyState: record.safetyState,
      aiResult: record.aiResult,
      photoDataUrl: record.photoDataUrl,
    };
  }

  // --- P1-7 trainee mission report: history list + teacher view --------------

  const STATUS_LABEL: Record<ReportStatus, string> = {
    completed: L.statusLabel.completed,
    failed: L.statusLabel.failed,
    incomplete: L.statusLabel.incomplete,
  };

  function esc(value: string | number): string {
    return String(value).replace(/[&<>"']/g, (char) => {
      switch (char) {
        case '&':
          return '&amp;';
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '"':
          return '&quot;';
        default:
          return '&#39;';
      }
    });
  }

  function gradeLabel(grade: MissionScoreResult['grade']): string {
    return DEFAULT_SCORE_CONFIG.labels[grade];
  }

  function buildReportDetailHtml(report: MissionReport, role: 'student' | 'teacher'): string {
    const s = report.score;
    const dimOrder: Array<keyof MissionScoreResult['dimensions']> = [
      'missionCompletion',
      'flightSafety',
      'inspectionPosition',
      'photoQuality',
      'flightEfficiency',
      'controlStability',
    ];
    const dims = dimOrder
      .map((key) => {
        const dim = s.dimensions[key];
        const reasons = dim.reasons.length > 0 ? dim.reasons.map((r) => esc(r)).join('；') : '無扣項';
        return `
          <li class="report-dim" data-score-status="${dim.status}">
            <span class="report-dim-name">${esc(dim.label)}</span>
            <b class="report-dim-value">${dim.score} / ${dim.maxScore}</b>
            <p class="report-dim-reason">${reasons}</p>
          </li>`;
      })
      .join('');

    const controlRows =
      report.controlSamples.length > 0
        ? report.controlSamples
            .slice(0, 12)
            .map(
              (c) =>
                `<tr><td>${c.t}</td><td>${c.roll.toFixed(2)}</td><td>${c.pitch.toFixed(2)}</td><td>${c.yaw.toFixed(2)}</td><td>${c.throttle.toFixed(2)}</td></tr>`,
            )
            .join('')
        : '';
    const controlSection =
      report.controlSamples.length > 0
        ? `<section class="report-section">
             <h3>飛行操縱記錄（Roll / Pitch / Yaw / Throttle）</h3>
             <p class="report-note">共 ${report.controlSamples.length} 條採樣（每 200ms 一次）</p>
             <table class="report-control-table">
               <thead><tr><th>時間(ms)</th><th>Roll</th><th>Pitch</th><th>Yaw</th><th>Throttle</th></tr></thead>
               <tbody>${controlRows}</tbody>
             </table>
             ${report.controlSamples.length > 12 ? `<p class="report-note">… 僅顯示前 12 條</p>` : ''}
           </section>`
        : `<section class="report-section"><h3>飛行操縱記錄（Roll / Pitch / Yaw / Throttle）</h3><p class="report-empty">無記錄</p></section>`;

    const captureRows = report.captures
      .map((cap) => {
        const reasons = cap.photoValidation.reasons.length > 0 ? cap.photoValidation.reasons.map((r) => esc(r)).join('；') : '—';
        const aiVerdict = classifyInspectionAIResult(cap.aiResult);
        const ai =
          aiVerdict === 'defect'
            ? `<p class="report-ai">模擬 AI 檢測結果：檢出缺陷（絕緣子片缺失），置信度 ${Math.round((cap.aiResult?.confidence ?? 0) * 100)}%，來源：模擬 AI / 非真實 YOLO 模型</p>`
            : aiVerdict === 'unavailable' && cap.aiResult
              ? `<p class="report-ai">AI 不可用：${esc(cap.aiResult.reason ?? '未提供判定結果')}（未完成缺陷判定，<b>不等同於「無缺陷」</b>）</p>`
              : '';
        return `
          <li class="report-capture ${cap.valid ? 'valid' : 'invalid'}">
            <span class="report-capture-badge">${cap.valid ? '有效' : '無效'}</span>
            <span>第 ${cap.index} 次 · 安全狀態：${esc(cap.safetyState)}</span>
            <p class="report-capture-reason">校驗：${reasons}</p>
            ${ai}
            ${cap.photoDataUrl ? `<img class="report-photo" src="${esc(cap.photoDataUrl)}" alt="巡檢照片 ${cap.index}" />` : ''}
          </li>`;
      })
      .join('');
    const captureSection =
      report.captures.length > 0
        ? `<section class="report-section">
             <h3>拍攝記錄（共 ${report.captures.length} 次）</h3>
             <ul class="report-captures">${captureRows}</ul>
           </section>`
        : `<section class="report-section"><h3>拍攝記錄</h3><p class="report-empty">無記錄</p></section>`;

    const photos = report.captures.filter((c) => c.valid && c.photoDataUrl);
    const photoGallery =
      photos.length > 0
        ? `<section class="report-section">
             <h3>有效巡检照片</h3>
             <div class="report-photo-gallery">${photos
               .map((c) => `<img class="report-photo" src="${esc(c.photoDataUrl ?? '')}" alt="有效巡檢照片 ${c.index}" />`)
               .join('')}</div>
           </section>`
        : '';

    const hazardSection =
      report.hazardSummary.length > 0
        ? `<section class="report-section">
             <h3>安全事件</h3>
             <ul class="report-hazards">${report.hazardSummary
               .map(
                 (h) =>
                   `<li class="hazard-${h.state.toLowerCase()}">${esc(h.state)}：${h.count} 次，累計 ${(h.totalDurationMs / 1000).toFixed(1)} 秒</li>`,
               )
               .join('')}</ul>
           </section>`
        : `<section class="report-section"><h3>安全事件</h3><p class="report-empty">全程安全，未觸發 WARNING / DANGER / COLLISION</p></section>`;

    // Read every verdict through the shared classifier: an `unavailable`
    // result answers no question, so it must never be folded into "无缺陷".
    const detectedCaptures = report.captures.filter(
      (c) => classifyInspectionAIResult(c.aiResult) === 'defect',
    );
    const unavailableReasons = Array.from(
      new Set(
        report.captures
          .filter((c) => classifyInspectionAIResult(c.aiResult) === 'unavailable' && c.aiResult)
          .map((c) => c.aiResult?.reason ?? '未提供判定結果'),
      ),
    );
    const aiSection =
      detectedCaptures.length > 0
        ? `<section class="report-section">
             <h3>Mock AI 檢測結果</h3>
             <p class="report-note report-ai-warn">以下結果來自模擬 AI（程式化教學缺陷），<b>非真實 YOLO 模型</b>，僅用於教學演示。</p>
             <ul class="report-ai-list">${detectedCaptures
               .map(
                 (c) =>
                   `<li>第 ${c.index} 次照片：檢出缺陷「絕緣子片缺失」，置信度 ${Math.round((c.aiResult?.confidence ?? 0) * 100)}%（模擬 AI）</li>`,
               )
               .join('')}</ul>
           </section>`
        : unavailableReasons.length > 0
          ? `<section class="report-section">
              <h3>Mock AI 檢測結果</h3>
              <p class="report-note report-ai-warn">以下結果來自模擬 AI（程式化教學缺陷），<b>非真實 YOLO 模型</b>，僅用於教學演示。</p>
              <p class="report-ai">AI 不可用：${unavailableReasons.map((r) => esc(r)).join('；')}</p>
              <p class="report-empty">本次<b>未完成缺陷判定</b>，不等同於「無缺陷」，也不能視為檢測通過。</p>
             </section>`
          : report.captures.length === 0
            ? `<section class="report-section"><h3>Mock AI 檢測結果</h3><p class="report-empty">無記錄</p></section>`
            : `<section class="report-section"><h3>Mock AI 檢測結果</h3><p class="report-empty">未檢測到缺陷</p></section>`;

    const issues = s.majorIssues.length > 0 ? s.majorIssues.map((i) => esc(i)).join('；') : '無';
    const suggestions =
      s.suggestions.length > 0
        ? `<ul class="report-suggestions">${s.suggestions.map((sug) => `<li>${esc(sug)}</li>`).join('')}</ul>`
        : '<p class="report-empty">無記錄</p>';

    const roleNote =
      role === 'teacher' ? `<p class="report-role-flag">教師查看模式（唯讀）：用於覆核學員提交的任務報告。</p>` : '';

    return `
      <button type="button" class="report-back" data-action="back-to-list">← 返回清單</button>
      ${roleNote}
      <header class="report-header">
        <h3>${esc(report.taskName)}</h3>
        <p class="report-meta">任務 ID：${esc(report.missionId)} · 報告 ID：${esc(report.reportId)}</p>
        <p class="report-meta">開始：${new Date(report.startedAt).toLocaleString('zh-Hant')} · 結束：${new Date(report.finishedAt).toLocaleString('zh-Hant')}</p>
        <p class="report-meta">最終狀態：<b class="report-status report-status-${report.status}">${STATUS_LABEL[report.status]}</b> · 巡檢目標：${esc(report.targetName)}（${esc(report.targetId)}）· 是否進入巡檢區：${report.enteredInspectionZone ? '是' : '否'}</p>
      </header>
      <section class="report-section report-summary-grid">
        <div><span>飛行時長</span><b>${formatDuration(report.durationMs)}</b></div>
        <div><span>航跡長度</span><b>${report.pathLengthM.toFixed(1)} m</b></div>
        <div><span>最高高度</span><b>${report.maxAltitudeM.toFixed(1)} m</b></div>
        <div><span>總分 / 等級</span><b>${s.totalScore} / 100 · ${esc(gradeLabel(s.grade))}${s.capped ? '（封頂）' : ''}</b></div>
      </section>
      ${controlSection}
      ${captureSection}
      ${photoGallery}
      ${aiSection}
      ${hazardSection}
      <section class="report-section">
        <h3>教學評分（六項）</h3>
        <ul class="report-dimensions">${dims}</ul>
        <p class="report-issues"><b>重大問題：</b>${esc(issues)}</p>
        <div class="report-suggestions-block"><b>教學建議：</b>${suggestions}</div>
      </section>
      <div class="report-actions">
        <button type="button" class="report-export" data-action="export-report">匯出 JSON</button>
        <button type="button" class="report-print-btn" data-action="print-report">列印 / 儲存 PDF</button>
      </div>
    `;
  }

  async function renderReportsList(): Promise<void> {
    const listEl = root.querySelector<HTMLElement>('[data-reports-list]');
    if (!listEl) return;
    const summaries = await reportStore.list();
    listEl.innerHTML = '';
    if (summaries.length === 0) {
      listEl.innerHTML = '<p class="reports-empty">暫無任務記錄。完成一次巡檢後，報告會自動儲存到這裡。</p>';
      return;
    }
    for (const summary of summaries) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'report-item';
      item.dataset.reportId = summary.reportId;
      item.innerHTML = `
        <span class="report-item-date">${esc(summary.date)}</span>
        <span class="report-item-task">${esc(summary.taskName)}</span>
        <span class="report-status report-status-${summary.status}">${STATUS_LABEL[summary.status]}</span>
        <span class="report-item-score">${summary.totalScore} 分 · ${esc(gradeLabel(summary.grade))}</span>
        ${summary.hadCollision ? '<span class="report-collision">碰撞</span>' : ''}
      `;
      item.addEventListener('click', () => void openReportDetail(summary.reportId));
      listEl.append(item);
    }
  }

  async function openReportDetail(reportId: string): Promise<void> {
    const report = await reportStore.get(reportId);
    const listEl = root.querySelector<HTMLElement>('[data-reports-list]');
    const detailEl = root.querySelector<HTMLElement>('[data-report-detail]');
    if (!report || !detailEl) {
      void renderReportsList();
      return;
    }
    currentDetailReport = report;
    if (listEl) listEl.hidden = true;
    detailEl.hidden = false;
    detailEl.innerHTML = buildReportDetailHtml(report, reportRole);
  }

  function backToList(): void {
    const listEl = root.querySelector<HTMLElement>('[data-reports-list]');
    const detailEl = root.querySelector<HTMLElement>('[data-report-detail]');
    if (detailEl) detailEl.hidden = true;
    if (listEl) listEl.hidden = false;
    currentDetailReport = null;
    void renderReportsList();
  }

  async function openReportsOverlay(): Promise<void> {
    const overlay = root.querySelector<HTMLElement>('[data-reports-overlay]');
    if (!overlay) return;
    overlay.hidden = false;
    currentDetailReport = null;
    const detailEl = root.querySelector<HTMLElement>('[data-report-detail]');
    const listEl = root.querySelector<HTMLElement>('[data-reports-list]');
    if (detailEl) detailEl.hidden = true;
    if (listEl) listEl.hidden = false;
    await renderReportsList();
  }

  function closeReportsOverlay(): void {
    const overlay = root.querySelector<HTMLElement>('[data-reports-overlay]');
    if (overlay) overlay.hidden = true;
  }

  function exportCurrentReport(): void {
    const report = currentDetailReport ?? lastReport;
    if (!report) return;
    const json = serializeReport(report);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `mission-report-${report.reportId}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function printReport(): void {
    window.print();
  }

  function setReportRole(role: 'student' | 'teacher'): void {
    reportRole = role;
    const badge = root.querySelector<HTMLElement>('[data-report-role]');
    const teacherNote = root.querySelector<HTMLElement>('[data-report-teacher-note]');
    const tabs = root.querySelectorAll<HTMLElement>('[data-report-role-tab]');
    if (badge) badge.textContent = role === 'teacher' ? '教師查看（唯讀）' : '學員任務記錄';
    if (teacherNote) teacherNote.hidden = role !== 'teacher';
    tabs.forEach((tab) => tab.setAttribute('aria-pressed', String(tab.dataset.reportRoleTab === role)));
    if (currentDetailReport) {
      const detailEl = root.querySelector<HTMLElement>('[data-report-detail]');
      if (detailEl) detailEl.innerHTML = buildReportDetailHtml(currentDetailReport, role);
    }
  }

  const MISSION_STATE_TEXT: Record<MissionState, string> = {
    IDLE: L.missionStateText.IDLE,
    READY: L.missionStateText.READY,
    TAKEOFF: L.missionStateText.TAKEOFF,
    FLY_TO_TARGET: L.missionStateText.FLY_TO_TARGET,
    POSITION_FOR_INSPECTION: L.missionStateText.POSITION_FOR_INSPECTION,
    AIM_CAMERA: L.missionStateText.AIM_CAMERA,
    CAPTURE: L.missionStateText.CAPTURE,
    VALIDATE_PHOTO: L.missionStateText.VALIDATE_PHOTO,
    AI_INSPECTION: L.missionStateText.AI_INSPECTION,
    INSPECTION_COMPLETE: L.missionStateText.INSPECTION_COMPLETE,
    RETURN: L.missionStateText.RETURN,
    LAND: L.missionStateText.LAND,
    COMPLETE: L.missionStateText.COMPLETE,
    FAILED: L.missionStateText.FAILED,
  };

  function updateMissionUI(): void {
    const state = mission.currentState;

    // Drive the real flight controller from mission state edges.
    if (state === 'RETURN' && prevMissionState !== 'RETURN') flightController.rtl();
    if (state === 'LAND' && prevMissionState !== 'LAND') flightController.land();
    // A fresh run after a scored one: clear the old score and recording.
    if (state === 'READY' && prevMissionState !== 'READY' && scoreResult !== null) {
      scoreResult = null;
      scoreDismissed = false;
      missionId = `mission-${Date.now()}`;
      sessionRecorder.reset(missionId);
      missionCaptures.length = 0;
      missionStartedAt = 0;
      lastReport = null;
      currentDetailReport = null;
      updateScoreUI();
      renderReportsList();
    }
    // Mark the wall-clock mission start once the run actually begins.
    if (missionStartedAt === 0 && state !== 'IDLE' && state !== 'READY') {
      missionStartedAt = Date.now();
    }
    prevMissionState = state;

    const info = mission.stepInfo();
    if (missionDom.step) missionDom.step.textContent = info.label;
    if (missionDom.progress) missionDom.progress.textContent = info.progress || '—';
    if (missionDom.hint) missionDom.hint.textContent = info.hint;
    if (missionDom.gimbalPitch) missionDom.gimbalPitch.textContent = gimbal.pitch.toFixed(0);
    if (missionDom.gimbalYaw) missionDom.gimbalYaw.textContent = gimbal.yaw.toFixed(0);
    if (missionDom.gimbalReadoutPitch) missionDom.gimbalReadoutPitch.textContent = `${gimbal.pitch.toFixed(0)}°`;
    if (missionDom.gimbalReadoutYaw) missionDom.gimbalReadoutYaw.textContent = `${gimbal.yaw.toFixed(0)}°`;

    setCheckState(missionDom.checkTarget, inspectionResult.insideInspectionZone);
    setCheckState(
      missionDom.checkSafety,
      inspectionResult.safetyState === 'SAFE' || inspectionResult.safetyState === 'WARNING',
    );

    const photo = mission.photoResult;
    if (missionDom.checkEvidence) missionDom.checkEvidence.textContent = photo?.valid ? '✓' : '—';
    if (missionDom.photoResult) {
      if (captureRefusal) missionDom.photoResult.textContent = '無法拍攝';
      else if (!photo) missionDom.photoResult.textContent = '未拍攝';
      else missionDom.photoResult.textContent = photo.valid ? '照片合格' : '照片不合格';
    }
    if (missionDom.photoReasons) {
      if (captureRefusal) missionDom.photoReasons.textContent = captureRefusal;
      else missionDom.photoReasons.textContent = photo && !photo.valid ? photo.reasons.join('；') : '';
    }

    const ai = mission.aiResult;
    // `null` means "not run yet"; `unavailable` means "ran, but no verdict".
    // Both differ from "clear", so the HUD must not collapse them.
    const aiVerdict = ai ? classifyInspectionAIResult(ai) : null;
    if (missionDom.aiState) {
      missionDom.aiState.textContent =
        aiVerdict === 'defect' ? '已檢測' : aiVerdict === 'unavailable' ? 'AI 不可用' : '未檢測';
    }
    if (missionDom.aiDetail) {
      missionDom.aiDetail.textContent =
        aiVerdict === 'defect'
          ? `缺陷：絕緣子片缺失（缺失 1 片） · 置信度 ${Math.round((ai?.confidence ?? 0) * 100)}% · 來源：模擬 AI / 非真實模型`
          : aiVerdict === 'unavailable'
            ? `未完成缺陷判定：${ai?.reason ?? '無可用結果'}（不等同於無缺陷）`
            : '';
    }

    if (missionDom.missionState) {
      const running = !['IDLE', 'COMPLETE', 'FAILED'].includes(state);
      missionDom.missionState.textContent = state === 'IDLE' ? '待開始' : running ? '進行中' : MISSION_STATE_TEXT[state];
    }
  }

  const flightController = new SimpleFlightController();
  const keyboard = new KeyboardInputAdapter();
  const gamepad = new GamepadInputAdapter(0);
  // 原子筆／手機：狀態變化時更新「連線方式」面板（面板稍後建立，先用 ?. 保護）
  let linkPanel: LinkPanel | null = null;
  const pen = new PenCameraInputAdapter((state) => linkPanel?.renderPen(state));
  const phone = new PhoneLinkInputAdapter((state) => linkPanel?.renderPhone(state));
  const gesture = new HandGestureInputAdapter();
  linkPanel = new LinkPanel({ root, pen, phone, gesture });
  root.querySelector<HTMLElement>('[data-action="open-link"]')?.addEventListener('click', () => linkPanel?.toggle());
  const { store: profileStore } = resolveProfileStore();

  // Device profiles keyed by adapter id. The calibration wizard keeps this in
  // sync via onProfileApplied; the flight pipeline consults it (and the live
  // wizard draft) so an un-saved controller still flies.
  const deviceProfiles = new Map<string, DeviceProfile>();

  const calibrationAnchor = root.querySelector<HTMLElement>('[data-calibration-anchor]');

  // --- 遙控器 HUD：生效標定 + 四軸實測值（固定在畫面上，不隨版面捲動）-----
  const rcHud = {
    root: root.querySelector<HTMLElement>('[data-rc-hud]'),
    title: root.querySelector<HTMLElement>('[data-rc-hud-title]'),
    origin: root.querySelector<HTMLElement>('[data-rc-hud-origin]'),
    file: root.querySelector<HTMLElement>('[data-rc-hud-file]'),
    saved: root.querySelector<HTMLElement>('[data-rc-hud-saved]'),
    mapping: root.querySelector<HTMLElement>('[data-rc-hud-mapping]'),
    values: {
      pitch: root.querySelector<HTMLElement>('[data-rc-hud-value="pitch"]'),
      roll: root.querySelector<HTMLElement>('[data-rc-hud-value="roll"]'),
      yaw: root.querySelector<HTMLElement>('[data-rc-hud-value="yaw"]'),
      throttle: root.querySelector<HTMLElement>('[data-rc-hud-value="throttle"]'),
    },
    bars: {
      pitch: root.querySelector<HTMLElement>('[data-rc-hud-bar="pitch"]'),
      roll: root.querySelector<HTMLElement>('[data-rc-hud-bar="roll"]'),
      yaw: root.querySelector<HTMLElement>('[data-rc-hud-bar="yaw"]'),
      throttle: root.querySelector<HTMLElement>('[data-rc-hud-bar="throttle"]'),
    },
  };

  const chainHud = {
    root: root.querySelector<HTMLElement>('[data-rc-chain]'),
    message: root.querySelector<HTMLElement>('[data-rc-chain-message]'),
    rows: {
      pitch: {
        row: root.querySelector<HTMLElement>('[data-rc-chain-row="pitch"]'),
        axis: root.querySelector<HTMLElement>('[data-rc-chain-axis="pitch"]'),
        raw: root.querySelector<HTMLElement>('[data-rc-chain-raw="pitch"]'),
        norm: root.querySelector<HTMLElement>('[data-rc-chain-norm="pitch"]'),
        cmd: root.querySelector<HTMLElement>('[data-rc-chain-cmd="pitch"]'),
        move: root.querySelector<HTMLElement>('[data-rc-chain-move="pitch"]'),
      },
      roll: {
        row: root.querySelector<HTMLElement>('[data-rc-chain-row="roll"]'),
        axis: root.querySelector<HTMLElement>('[data-rc-chain-axis="roll"]'),
        raw: root.querySelector<HTMLElement>('[data-rc-chain-raw="roll"]'),
        norm: root.querySelector<HTMLElement>('[data-rc-chain-norm="roll"]'),
        cmd: root.querySelector<HTMLElement>('[data-rc-chain-cmd="roll"]'),
        move: root.querySelector<HTMLElement>('[data-rc-chain-move="roll"]'),
      },
    },
  };

  const formatSigned = (value: number): string => `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;

  /**
   * 鏈路 HUD：把一帧的 raw → norm → cmd → 機身座標位移攤開，並指出出錯的層。
   * 鍵盤輸入沒有 raw 通道，直接顯示「—」。
   */
  const updateChainHud = (
    command: PilotCommand,
    snapshot: FlightSnapshot,
    trace: PipelineTrace | undefined,
  ): void => {
    if (!chainHud.root) return;
    const flying = snapshot.state === 'flying';
    const report = trace
      ? describeChain({
          rawChannels: trace.rawChannels,
          normalized: { roll: trace.normalized.roll, pitch: trace.normalized.pitch },
          command: { roll: command.roll, pitch: command.pitch },
          velocity: { x: snapshot.velocity.x, z: snapshot.velocity.z },
          headingDeg: snapshot.headingDeg,
          axes: { roll: trace.profile.axes.roll, pitch: trace.profile.axes.pitch },
          flying,
        })
      : null;

    chainHud.root.dataset.layer = report ? report.layer : 'idle';
    if (chainHud.message) {
      chainHud.message.textContent = report
        ? report.message
        : '鍵盤輸入：沒有 raw 通道可追蹤（推桿診斷需要接上遙控器）。';
      chainHud.message.dataset.layer = report ? report.layer : 'idle';
    }

    for (const role of ['pitch', 'roll'] as const) {
      const cells = chainHud.rows[role];
      const row = report?.rows.find((item) => item.role === role);
      if (cells.row) cells.row.dataset.verdict = row ? row.verdict : 'idle';
      if (cells.axis) cells.axis.textContent = row ? `a${row.axis}` : 'a—';
      if (cells.raw) cells.raw.textContent = row ? formatSigned(row.raw) : '—';
      if (cells.norm) cells.norm.textContent = row ? formatSigned(row.norm) : '—';
      if (cells.cmd) cells.cmd.textContent = row ? formatSigned(row.cmd) : '—';
      if (cells.move) {
        cells.move.textContent = row
          ? `${role === 'pitch' ? '前' : '右'} ${formatSigned(role === 'pitch' ? row.forward : row.right)}`
          : '—';
        cells.move.dataset.sign = row
          ? (role === 'pitch' ? row.forward : row.right) > 0.02
            ? 'pos'
            : (role === 'pitch' ? row.forward : row.right) < -0.02
              ? 'neg'
              : 'zero'
          : 'zero';
      }
    }
  };

  /** HUD 上的來源短標籤：回答「我到底在飛哪一份標定」。 */
  const PROFILE_ORIGIN_TEXT: Record<ActiveProfileInfo['origin']['kind'], string> = {
    live: '在線 API',
    bundled: '靜態回退檔',
    stored: 'IndexedDB 本機',
    draft: '預設草稿（未實測）',
    manual: '手動儲存（本機）',
    guided: '引導式標定（本次實測）',
    imported: '匯入檔（本機）',
    suggestion: '錄製建議套用（本次實測）',
  };

  /** 把四個歸一化控制量即時畫到 HUD（真機驗收就是看這四個數字）。 */
  const updateRcHudValues = (command: PilotCommand): void => {
    const values: Record<keyof typeof rcHud.values, number> = {
      pitch: command.pitch,
      roll: command.roll,
      yaw: command.yaw,
      throttle: command.throttle,
    };
    for (const key of Object.keys(values) as Array<keyof typeof values>) {
      const value = values[key];
      const valueEl = rcHud.values[key];
      if (valueEl) {
        valueEl.textContent = key === 'throttle' ? value.toFixed(2) : formatSigned(value);
        valueEl.dataset.sign = value > 0.02 ? 'pos' : value < -0.02 ? 'neg' : 'zero';
      }
      const barEl = rcHud.bars[key];
      if (barEl) {
        if (key === 'throttle') {
          barEl.style.left = '0%';
          barEl.style.width = `${Math.min(Math.max(value, 0), 1) * 100}%`;
        } else {
          const magnitude = Math.min(Math.abs(value), 1) * 50;
          barEl.style.left = value >= 0 ? '50%' : `${50 - magnitude}%`;
          barEl.style.width = `${magnitude}%`;
        }
        barEl.dataset.sign = value > 0.02 ? 'pos' : value < -0.02 ? 'neg' : 'zero';
      }
    }
  };

  const renderRcHudProfile = (info: ActiveProfileInfo | null): void => {
    if (!rcHud.root) return;
    if (!info) {
      rcHud.root.dataset.state = 'offline';
      if (rcHud.title) rcHud.title.textContent = '遙控器未連接（使用鍵盤）';
      if (rcHud.origin) rcHud.origin.textContent = '—';
      if (rcHud.file) rcHud.file.textContent = '—';
      if (rcHud.saved) rcHud.saved.textContent = '—';
      if (rcHud.mapping) rcHud.mapping.textContent = '—';
      return;
    }
    rcHud.root.dataset.state = 'live';
    if (rcHud.title) rcHud.title.textContent = '遙控器已連接 · 生效中';
    if (rcHud.origin) {
      rcHud.origin.textContent =
        PROFILE_ORIGIN_TEXT[info.origin.kind] + (info.origin.conflict ? ' ⚠ 與擷取檔映射不同' : '');
      rcHud.origin.dataset.origin = info.origin.conflict ? 'conflict' : info.origin.kind;
    }
    if (rcHud.file) rcHud.file.textContent = info.origin.file?.trim() ? info.origin.file : '—（本機）';
    if (rcHud.saved) {
      const savedAtMs = info.origin.savedAtMs ?? 0;
      rcHud.saved.textContent = savedAtMs > 0 ? new Date(savedAtMs).toLocaleString('zh-Hant') : '—';
    }
    if (rcHud.mapping) rcHud.mapping.textContent = describeAxisMapping(info.profile);
  };

  const calibrationPanel = calibrationAnchor
    ? new ControllerCalibrationPanel({
        root: calibrationAnchor,
        adapter: gamepad,
        store: profileStore,
        onProfileApplied: (profile) => deviceProfiles.set(profile.id, profile),
        // HUD 直接顯示「目前生效的是哪一份」：檔名 / savedAtMs / 來源 / 四軸映射。
        onActiveProfileChange: (info) => renderRcHudProfile(info),
        // M1 闭环: first time this controller is seen with no local profile,
        // import the newest guided-calibration capture from the online entry
        // point (unreachable in offline/local runs - then the default draft
        // and the manual wizard stay in charge).
        autoProfileSource: (deviceId) =>
          fetchLatestRcProfile({
            deviceId,
            // Static deployments (e.g. a plain /sim/ mount without the live
            // backend) fall back to the capture bundled at build time.
            fallbackEndpoint: BUNDLED_RC_PROFILE_ENDPOINT,
          }),
        // 漂移診斷的「重設位置」按鈕：把機體位置與速度清零，回到 Home Point。
        // 不改飛行物理，只觸發既有 teleport（測試用的跳點）作為臨時輔助。
        onResetPosition: () => {
          const home = flightController.snapshot().homePoint;
          flightController.teleport({ x: home.x, y: home.y, z: home.z });
        },
        // 方向驗收面板需要即時飛行狀態（位置 / 速度 / 航向 + 歸一化指令），
        // 由應用層每幀提供；面板只讀不寫。
        onFlightSample: () => ({
          state: flightController.snapshot().state,
          command: { ...lastPilotCommand },
          velocity: flightController.snapshot().velocity,
          headingDeg: flightController.snapshot().headingDeg,
        }),
      })
    : null;

  // Test seam: when the browser test pins the input clock, stale detection uses
  // it instead of wall time (no other behaviour changes).
  const inputNow = (): number => {
    const override = (window as unknown as { __fdeInputClock?: number }).__fdeInputClock;
    return typeof override === 'number' ? override : performance.now();
  };

  const pipeline = new PilotInputPipeline({
    // 優先順序：實體遙控器 → 手機 → 原子筆 → 鍵盤（有新鮮訊號的第一個接手）
    adapters: [gamepad, phone, gesture, pen],
    keyboard: () => keyboard.poll(),
    profileFor: (id) => {
      // 手機與原子筆的通道排列固定（美國手），不需校正
      if (id === phone.id) return phone.profile();
      if (id === pen.id) return pen.profile();
      if (id === gesture.id) return gesture.profile();
      const saved = deviceProfiles.get(id);
      if (saved) return saved;
      return calibrationPanel && calibrationPanel.isConnected() && calibrationPanel.getProfile() !== null
        ? calibrationPanel.getProfile()
        : null;
    },
    now: inputNow,
  });

  void gamepad.connect().catch(() => undefined);
  calibrationPanel?.start();

  // Test seams for the inspection browser tests (no production behaviour change):
  //  - __fdeTeleport jumps the F450 to an absolute pose for deterministic checks.
  //  - __fdeInspection exposes the layout, a pure evaluator, and the last result.
  //  - __fdeGimbal / __fdeMission let tests place the gimbal and run a capture.
  const inspectionSeam = window as unknown as {
    __fdeTeleport?: (position: { x: number; y: number; z: number }) => void;
    __fdeInspection?: {
      layout: typeof transmissionScene.layout;
      evaluate: (position: { x: number; y: number; z: number }) => ReturnType<SafetyDistanceEngine['evaluate']>;
      lastResult: ReturnType<SafetyDistanceEngine['evaluate']> | null;
    };
    __fdeGimbal?: {
      getPitch(): number;
      getYaw(): number;
      setPitch(deg: number): void;
      setYaw(deg: number): void;
      recenter(): void;
      aimAtTarget(): void;
      gimbalAimed(): boolean;
    };
    __fdeMission?: {
      state(): MissionState;
      stepInfo(): { state: MissionState; label: string; hint: string; progress: string };
      capture(): Promise<void>;
      photoResult(): unknown;
      aiResult(): unknown;
    };
  };
  inspectionSeam.__fdeTeleport = (position) => {
    flightController.teleport(position);
    // A teleport is a test-harness jump, not flown distance: keep it out of
    // the scored path length.
    sessionRecorder.noteTeleport();
  };
  inspectionSeam.__fdeInspection = {
    layout: transmissionScene.layout,
    evaluate: (position) => safetyEngine.evaluate(position),
    get lastResult() {
      return inspectionResult;
    },
  };
  inspectionSeam.__fdeGimbal = {
    getPitch: () => gimbal.pitch,
    getYaw: () => gimbal.yaw,
    setPitch: (deg) => {
      gimbal.setPitch(deg);
    },
    setYaw: (deg) => {
      gimbal.setYaw(deg);
    },
    recenter: () => gimbal.recenter(),
    gimbalAimed: () => gimbalAimed(),
    aimAtTarget: () => {
      const position = dronePosition();
      const dx = TARGET_POS.x - position.x;
      const dy = TARGET_POS.y - position.y;
      const dz = TARGET_POS.z - position.z;
      const desiredHeadingRad = Math.atan2(dx, -dz);
      const gimbalYawDeg = ((desiredHeadingRad - (lastSnapshot.headingDeg * Math.PI) / 180) * 180) / Math.PI;
      const horizontal = Math.hypot(dx, dz) || 1;
      gimbal.setYaw(((gimbalYawDeg + 540) % 360) - 180);
      gimbal.setPitch((Math.atan2(dy, horizontal) * 180) / Math.PI);
    },
  };
  inspectionSeam.__fdeMission = {
    state: () => mission.currentState,
    stepInfo: () => mission.stepInfo(),
    capture: () => captureInspection(),
    photoResult: () => mission.photoResult,
    aiResult: () => mission.aiResult,
  };

  // --- P1-7 report event wiring + test seam ---------------------------------
  root.querySelector<HTMLElement>('[data-action="open-reports"]')?.addEventListener('click', () => void openReportsOverlay());
  root.querySelector<HTMLElement>('[data-reports-overlay]')?.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement).closest('[data-action]')?.getAttribute('data-action');
    if (action === 'close-reports') closeReportsOverlay();
    else if (action === 'back-to-list') backToList();
    else if (action === 'export-report') exportCurrentReport();
    else if (action === 'print-report') printReport();
  });
  root.querySelectorAll<HTMLElement>('[data-report-role-tab]').forEach((tab) =>
    tab.addEventListener('click', () => setReportRole(tab.dataset.reportRoleTab === 'teacher' ? 'teacher' : 'student')),
  );

  const reportSeam = window as unknown as Record<string, unknown>;
  reportSeam.__fdeReport = {
    last: () => lastReport,
    json: () => {
      const report = currentDetailReport ?? lastReport;
      return report ? serializeReport(report) : null;
    },
    detailJson: () => (currentDetailReport ? serializeReport(currentDetailReport) : null),
    summaries: () => reportStore.list(),
    get: (id: string) => reportStore.get(id),
    exportName: () => {
      const report = currentDetailReport ?? lastReport;
      return report ? `mission-report-${report.reportId}.json` : null;
    },
    openReports: () => openReportsOverlay(),
    openReport: (id: string) => openReportDetail(id),
    setRole: (role: 'student' | 'teacher') => setReportRole(role),
  };

  let droneEntity: Awaited<ReturnType<typeof loadF450>>['entity'] | null = null;
  void loadF450().then(({ entity, notice }) => {
    droneEntity = entity;
    scene.add(entity.group);
    shell.dataset.droneReady = 'true';
    shell.dataset.droneSource = entity.source;
    shell.dataset.droneNotice = notice;
  });

  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 180);
  camera.position.set(18, 16, 24);
  camera.lookAt(0, 0, 0);

  const resize = (): void => {
    const width = Math.max(mount.clientWidth, 1);
    const height = Math.max(mount.clientHeight, 1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(mount);
  resize();

  // 頁面卸載時主動釋放 WebGL context（非 bfcache 還原）：否則瀏覽器／GPU 程序
  // 會累積未釋放的 context，全量瀏覽器測試順序執行到後段時可用 context 耗盡，
  // 後面的頁面會空白（flight／shell 等測試偶發失敗的根因）。
  const handlePageHide = (event: PageTransitionEvent): void => {
    if (!event.persisted) renderer.forceContextLoss();
  };
  window.addEventListener('pagehide', handlePageHide);

  const frameInterval = 1000 / config.targetFrameRate;
  let animationFrame = 0;
  let lastRender = 0;
  let lastUpdate = performance.now();
  let disposed = false;

  const stateLabels: Record<FlightState, string> = {
    disarmed: '待機',
    armed: '已解鎖',
    'taking-off': '起飛中',
    flying: '飛行中',
    landing: '降落中',
    paused: '已暫停',
    emergency: '緊急停止',
  };

  let lastSnapshot = flightController.snapshot();
  let inspectionResult = safetyEngine.evaluate(lastSnapshot.position);

  const readout = {
    altitude: root.querySelector<HTMLElement>('[data-altitude]'),
    state: root.querySelector<HTMLElement>('[data-flight-state]'),
    mode: root.querySelector<HTMLElement>('[data-flight-mode]'),
    inputSource: root.querySelector<HTMLElement>('[data-input-source]'),
    x: root.querySelector<HTMLElement>('[data-position-x]'),
    y: root.querySelector<HTMLElement>('[data-position-y]'),
    z: root.querySelector<HTMLElement>('[data-position-z]'),
    heading: root.querySelector<HTMLElement>('[data-heading]'),
    inspectionTarget: root.querySelector<HTMLElement>('[data-inspection-target]'),
    distanceTarget: root.querySelector<HTMLElement>('[data-distance-target]'),
    distanceObstacle: root.querySelector<HTMLElement>('[data-distance-obstacle]'),
    safetyStatus: root.querySelector<HTMLElement>('[data-safety-status]'),
    inspectionZone: root.querySelector<HTMLElement>('[data-inspection-zone]'),
  };

  const SAFETY_LABELS: Record<SafetyState, string> = {
    SAFE: '安全',
    WARNING: '警告',
    DANGER: '危險',
    COLLISION: '碰撞',
  };

  const SAFETY_CLASS: Record<SafetyState, string> = {
    SAFE: 'safety-safe',
    WARNING: 'safety-warning',
    DANGER: 'safety-danger',
    COLLISION: 'safety-collision',
  };

  // 記住目前操作方式，練習結束時一併寫進練飛紀錄
  let practiceInputSource = '鍵盤';
  const updateInputSource = (source: PilotInputSource): void => {
    practiceInputSource = normalizeInputSource(source.kind, source.label);
    if (readout.inputSource) {
      readout.inputSource.textContent = source.kind === 'adapter' ? `遙控器 · ${source.label}` : '鍵盤';
    }
  };

  const updateReadout = (snapshot: FlightSnapshot): void => {
    const x = snapshot.position.x.toFixed(1);
    const y = snapshot.position.y.toFixed(1);
    const z = snapshot.position.z.toFixed(1);
    if (readout.altitude) {
      readout.altitude.textContent = y;
      readout.altitude.dataset.value = snapshot.position.y.toFixed(2);
    }
    if (readout.state) {
      readout.state.textContent = stateLabels[snapshot.state];
      // 模式文字同步變色（飛行綠 / 懸停黃 / 未解鎖灰）
      readout.state.classList.toggle('is-flying',
        snapshot.state === 'flying' || snapshot.state === 'taking-off' || snapshot.state === 'armed' || snapshot.state === 'landing');
      readout.state.classList.toggle('is-hover', snapshot.state === 'paused');
      readout.state.classList.toggle('is-idle', snapshot.state === 'disarmed');
    }
    if (readout.mode) readout.mode.textContent = snapshot.mode === 'manual' ? '手動' : snapshot.mode === 'mission' ? '任務' : '懸停';
    if (readout.x) readout.x.textContent = x;
    if (readout.y) readout.y.textContent = y;
    if (readout.heading) readout.heading.textContent = `${Math.round(snapshot.headingDeg)}°`;
    if (readout.z) {
      readout.z.textContent = z;
      readout.z.dataset.value = snapshot.position.z.toFixed(2);
    }
  };

  // Per-frame inspection readout: real distances + safety classification only.
  const updateInspectionReadout = (): void => {
    const result = safetyEngine.evaluate(lastSnapshot.position);
    inspectionResult = result;
    if (readout.inspectionTarget) {
      readout.inspectionTarget.textContent = transmissionScene.layout.target.label;
    }
    if (readout.distanceTarget) {
      readout.distanceTarget.textContent = `${result.distanceToTarget.toFixed(1)} m`;
    }
    if (readout.distanceObstacle) {
      readout.distanceObstacle.textContent = `${safetyEngine.nearestObstacleDistance(lastSnapshot.position).toFixed(1)} m`;
    }
    if (readout.safetyStatus) {
      readout.safetyStatus.textContent = SAFETY_LABELS[result.safetyState];
      readout.safetyStatus.className = SAFETY_CLASS[result.safetyState];
    }
    if (readout.inspectionZone) {
      readout.inspectionZone.textContent = result.insideInspectionZone ? '已進入' : '區外';
    }
    transmissionScene.setZoneHighlight(result.safetyState);
  };

  root.querySelector<HTMLElement>('[data-action="arm"]')?.addEventListener('click', () => {
    flightController.arm();
    updateReadout(flightController.snapshot());
  });
  root.querySelector<HTMLElement>('[data-action="takeoff"]')?.addEventListener('click', () => {
    flightController.takeoff(3);
    updateReadout(flightController.snapshot());
  });
  root.querySelector<HTMLElement>('[data-action="hover"]')?.addEventListener('click', () => {
    keyboard.setHover(true);
    const input = pipeline.poll();
    updateReadout(flightController.update(input.command, 0));
  });
  root.querySelector<HTMLElement>('[data-action="rtl"]')?.addEventListener('click', () => {
    // After the inspection completes the RTL button is the mission "return";
    // otherwise it stays a manual Return Home.
    const requested = mission.requestReturn();
    if (!requested.ok) flightController.rtl();
    updateReadout(flightController.snapshot());
    updateMissionUI();
  });
  root.querySelector<HTMLElement>('[data-action="land"]')?.addEventListener('click', () => {
    flightController.land();
    updateReadout(flightController.snapshot());
  });
  root.querySelector<HTMLElement>('[data-action="capture"]')?.addEventListener('click', () => {
    void captureInspection();
  });

  // --- 遙控器 HUD：收起 / 清除本機標定 ---------------------------------------
  root.querySelector<HTMLElement>('[data-action="rc-hud-toggle"]')?.addEventListener('click', (event) => {
    if (!rcHud.root) return;
    const collapsed = rcHud.root.dataset.collapsed === 'true';
    rcHud.root.dataset.collapsed = collapsed ? 'false' : 'true';
    const button = event.currentTarget as HTMLButtonElement;
    button.textContent = collapsed ? '收起' : '展開';
    button.setAttribute('aria-expanded', collapsed ? 'true' : 'false');
  });
  root.querySelector<HTMLElement>('[data-action="rc-hud-clear"]')?.addEventListener('click', () => {
    void calibrationPanel?.clearLocalProfile();
  });

  // --- 全螢幕 ---------------------------------------------------------------
  const fullscreenButton = root.querySelector<HTMLButtonElement>('[data-action="fullscreen"]');
  const scenePanel = root.querySelector<HTMLElement>('.scene-panel');
  fullscreenButton?.addEventListener('click', () => {
    const doc = document as Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
    const el = scenePanel;
    if (!el) return;
    const fsEl = document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
    if (fsEl) {
      void (document.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
    } else {
      void (el.requestFullscreen?.() ?? (el as HTMLElement & { webkitRequestFullscreen?: () => void }).webkitRequestFullscreen?.());
    }
  });

  // --- 按鈕狀態顏色（任務四）-------------------------------------------------
  const controlButtons = {
    arm: root.querySelector<HTMLButtonElement>('[data-action="arm"]'),
    takeoff: root.querySelector<HTMLButtonElement>('[data-action="takeoff"]'),
    hover: root.querySelector<HTMLButtonElement>('[data-action="hover"]'),
    capture: root.querySelector<HTMLButtonElement>('[data-action="capture"]'),
    rtl: root.querySelector<HTMLButtonElement>('[data-action="rtl"]'),
    land: root.querySelector<HTMLButtonElement>('[data-action="land"]'),
  };
  function setBtn(btn: HTMLButtonElement | null, state: 'active' | 'hover-active' | 'available' | 'disabled'): void {
    if (!btn) return;
    btn.classList.remove('btn-active', 'btn-hover-active', 'btn-disabled');
    btn.disabled = state === 'disabled';
    if (state === 'active') btn.classList.add('btn-active');
    else if (state === 'hover-active') btn.classList.add('btn-hover-active');
    else if (state === 'disabled') btn.classList.add('btn-disabled');
  }
  const updateControlButtonStates = (snapshot: FlightSnapshot, missionState: MissionState): void => {
    const flight = snapshot.state;
    const airborne = flight === 'taking-off' || flight === 'flying' || flight === 'landing';
    const hovering = flight === 'paused';
    const disarmed = flight === 'disarmed';
    // 解鎖：未解鎖時可用（綠）；其餘狀態預設
    setBtn(controlButtons.arm, disarmed ? 'active' : 'available');
    // 起飛：飛行中高亮（綠）；已解鎖可用；未解鎖禁點
    setBtn(controlButtons.takeoff, disarmed ? 'disabled' : airborne || hovering ? 'active' : 'available');
    // 懸停：懸停中黃色高亮；飛行中可用
    setBtn(controlButtons.hover, airborne ? (hovering ? 'hover-active' : 'available') : disarmed ? 'disabled' : 'available');
    // 返航：任務返航階段高亮；飛行中可用
    setBtn(controlButtons.rtl, disarmed ? 'disabled' : missionState === 'RETURN' ? 'active' : airborne || hovering ? 'available' : 'disabled');
    // 降落：降落中高亮；飛行中可用
    setBtn(controlButtons.land, disarmed ? 'disabled' : flight === 'landing' ? 'active' : airborne || hovering ? 'available' : 'disabled');
    // 拍攝：懸停/飛行中可用（需先起飛），未解鎖禁點
    setBtn(controlButtons.capture, disarmed ? 'disabled' : airborne || hovering ? 'available' : 'disabled');
  };

  // P1-6 score card: dismiss after reading, re-open from the checklist panel.
  root.querySelector<HTMLElement>('[data-action="close-score"]')?.addEventListener('click', () => {
    scoreDismissed = true;
    updateScoreUI();
  });
  root.querySelector<HTMLElement>('[data-action="show-score"]')?.addEventListener('click', () => {
    scoreDismissed = false;
    updateScoreUI();
  });

  // Gimbal teaching controls (separate from the flight keyboard mapping, so the
  // P1-3 input chain is untouched): I/K pitch up/down, J/L yaw, C recentre.
  const handleGimbalKey = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    if (key === 'i') gimbal.nudgePitch(GIMBAL_STEP_DEG);
    else if (key === 'k') gimbal.nudgePitch(-GIMBAL_STEP_DEG);
    else if (key === 'j') gimbal.nudgeYaw(-GIMBAL_STEP_DEG);
    else if (key === 'l') gimbal.nudgeYaw(GIMBAL_STEP_DEG);
    else if (key === 'c') gimbal.recenter();
    else return;
    event.preventDefault();
    updateMissionUI();
  };
  window.addEventListener('keydown', handleGimbalKey);

  // 最近一帧的歸一化指令：方向驗收面板用它判斷「桿推了哪個方向」。
  let lastPilotCommand: PilotCommand = {
    roll: 0,
    pitch: 0,
    yaw: 0,
    throttle: 0,
    arm: false,
    flightMode: 'manual',
    gimbalYaw: 0,
    gimbalPitch: 0,
  };

  // --- 視角切換 -------------------------------------------------------------
  // 追尾低角度是預設：仰角 22°、距離 9 m。之前是仰角 25°／距離 21 m，機體在畫面上
  // 太小，教師看不出機頭有沒有下壓（「前進時機頭朝上」的觀察就是在這種視角下做的）。
  const VIEW_MODES = ['chase', 'top', 'world'] as const;
  type ViewMode = (typeof VIEW_MODES)[number];
  const VIEW_PRESETS: Record<ViewMode, { distance: number; elevationDeg: number; lerp: number }> = {
    chase: { distance: 8, elevationDeg: 22, lerp: 0.08 },
    top: { distance: 11, elevationDeg: 84, lerp: 0.06 },
    world: { distance: 0, elevationDeg: 0, lerp: 0.05 },
  };
  let viewMode: ViewMode = 'chase';
  const viewButtons = Array.from(root.querySelectorAll<HTMLElement>('[data-view]'));

  const applyViewMode = (mode: ViewMode): void => {
    viewMode = mode;
    for (const button of viewButtons) {
      const active = button.dataset.view === mode;
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.dataset.active = active ? 'true' : 'false';
    }
  };
  for (const button of viewButtons) {
    button.addEventListener('click', () => {
      const mode = button.dataset.view as ViewMode | undefined;
      if (mode && (VIEW_MODES as readonly string[]).includes(mode)) applyViewMode(mode);
    });
  }
  applyViewMode('chase');

  /** 依視角模式算出相機應該在的世界座標。 */
  const cameraPositionFor = (mode: ViewMode, snapshot: FlightSnapshot, target: THREE.Vector3): THREE.Vector3 => {
    if (mode === 'world') {
      // 固定世界視角：舊行為（+X/+Z 斜後方），保留給「看整體場景」用。
      return new THREE.Vector3(target.x + 12, target.y + 8, target.z + 15);
    }
    const { distance, elevationDeg } = VIEW_PRESETS[mode];
    const elevation = (elevationDeg * Math.PI) / 180;
    const horizontal = distance * Math.cos(elevation);
    const height = distance * Math.sin(elevation);
    const headingRad = (snapshot.headingDeg * Math.PI) / 180;
    // 機頭反方向 = (−sin h, 0, cos h)；俯視時把水平偏移縮到 1.5 m，讓畫面幾乎正上方，
    // 但仍保留一點「機尾在下方」的方向感。
    const back = mode === 'top' ? 1.5 : horizontal;
    return new THREE.Vector3(
      target.x - Math.sin(headingRad) * back,
      target.y + height,
      target.z + Math.cos(headingRad) * back,
    );
  };

  const render = (timestamp: number): void => {
    if (disposed) return;
    const deltaSeconds = Math.min(Math.max((timestamp - lastUpdate) / 1000, 0), 0.1);
    lastUpdate = timestamp;
    const input = pipeline.poll();
    lastPilotCommand = input.command;
    const snapshot = flightController.update(input.command, deltaSeconds);
    lastSnapshot = snapshot;
    droneEntity?.update(snapshot, deltaSeconds);
    updateReadout(snapshot);
    updateControlButtonStates(snapshot, mission.currentState);
    updateInputSource(input.source);
    updateRcHudValues(input.command);
    updateChainHud(input.command, snapshot, input.trace);
    updateInspectionReadout();
    mission.update(buildTelemetry());
    updateMissionUI();

    // P1-6: feed the scorer real telemetry every frame (recording only).
    sessionRecorder.sample({
      position: snapshot.position,
      safetyState: inspectionResult.safetyState,
      insideInspectionZone: inspectionResult.insideInspectionZone,
      flightState: snapshot.state,
      horizontalSpeedMps: snapshot.horizontalSpeedMps,
      command: input.command,
      now: timestamp,
    });
    sessionRecorder.setSceneReference(snapshot.homePoint, TARGET_POS);
    sessionRecorder.observeMission(mission.currentState, timestamp);
    maybeComputeScore();

    if (droneEntity) {
      const target = droneEntity.group.position;
      // 視角切換：追尾（低角度，預設）／俯視／固定世界視角。
      // 追尾的相機永遠在機頭後方，讓「螢幕上方 = 機頭方向、螢幕右方 = 右側」。
      camera.position.lerp(cameraPositionFor(viewMode, snapshot, target), VIEW_PRESETS[viewMode].lerp);
      camera.lookAt(target);
    }
    if (timestamp - lastRender >= frameInterval) {
      renderer.render(scene, camera);
      lastRender = timestamp;
    }
    animationFrame = requestAnimationFrame(render);
  };

  renderer.render(scene, camera);
  animationFrame = requestAnimationFrame(render);
  shell.dataset.appStatus = 'ready';

  return {
    dispose(): void {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      keyboard.dispose();
      gamepad.disconnect();
      pen.disconnect();
      phone.disconnect();
      gesture.disconnect();
      linkPanel?.el.remove();
      calibrationPanel?.stop();
      droneEntity?.dispose();
      transmissionScene.dispose();
      captureTarget.dispose();
      window.removeEventListener('keydown', handleGimbalKey);
      window.removeEventListener('pagehide', handlePageHide);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
