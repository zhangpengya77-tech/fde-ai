import * as THREE from 'three';

import { loadF450 } from '../drone/load-f450';
import type { FlightSnapshot, FlightState } from '../flight/types';
import { SimpleFlightController } from '../flight/adapters/SimpleFlightController';
import { KeyboardInputAdapter } from '../input/adapters/KeyboardInputAdapter';
import { GamepadInputAdapter } from '../input/adapters/GamepadInputAdapter';
import { PilotInputPipeline, type PilotInputSource } from '../input/PilotInputPipeline';
import { ControllerCalibrationPanel } from '../ui/controller-calibration';
import { resolveProfileStore } from '../ui/profile-store';
import type { DeviceProfile } from '../input/device-profile';
import { createRenderConfig } from './render-config';
import { SafetyDistanceEngine } from '../safety/SafetyEngine';
import { createTransmissionScene } from '../scenes/transmission/create-transmission-scene';
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
            <h1>FDE 无人机电力巡检数字孪生训练系统</h1>
            <p>输电线路巡检 · 教学模式</p>
          </div>
        </div>
        <div class="system-state" role="status">
          <span class="state-dot" aria-hidden="true"></span>
          本地训练环境
        </div>
      </header>

      <section class="workspace" aria-label="无人机巡检训练台">
        <aside class="panel mission-panel">
          <div class="panel-heading">
            <span class="step-number">01</span>
            <div>
              <p class="eyebrow">当前任务</p>
              <h2>输电塔绝缘子巡检</h2>
            </div>
          </div>
          <dl class="mission-facts">
            <div><dt>巡检目标</dt><dd data-inspection-target>待装载</dd></div>
            <div><dt>当前步骤</dt><dd data-mission-step>待开始</dd></div>
            <div><dt>任务进度</dt><dd data-mission-progress>—</dd></div>
            <div><dt>距目标</dt><dd data-distance-target>— m</dd></div>
            <div><dt>距障碍</dt><dd data-distance-obstacle>— m</dd></div>
            <div><dt>云台 Pitch / Yaw</dt><dd><b data-gimbal-pitch>0</b>° / <b data-gimbal-yaw>0</b>°</dd></div>
          </dl>
          <div class="safety-block">
            <div class="safety-row">
              <span>安全状态</span>
              <strong data-safety-status class="safety-safe">安全</strong>
            </div>
            <div class="safety-row">
              <span>巡检区</span>
              <strong data-inspection-zone>区外</strong>
            </div>
          </div>
          <p class="mission-hint" data-mission-hint>请解锁并起飞，飞向输电塔右侧绝缘子串。</p>
          <div class="phase-notice">
            <strong>P1-6</strong>
            <span>巡检任务闭环 · 教学评分</span>
          </div>
        </aside>

        <section class="scene-panel" aria-label="三维训练场景">
          <div class="scene-toolbar">
            <div>
              <span class="toolbar-label">场景</span>
              <strong>输电线路 · 巡检环境</strong>
            </div>
            <div class="coordinates" aria-label="坐标状态">
              <span>X <b data-position-x>0.0</b></span>
              <span>Y <b data-position-y>0.0</b></span>
              <span>Z <b data-position-z data-value="0">0.0</b></span>
            </div>
          </div>
          <div class="scene-mount" data-scene-mount></div>
          <div class="scene-scale" aria-hidden="true"><span></span> 10 m</div>
        </section>

        <aside class="panel camera-panel">
          <div class="panel-heading compact">
            <span class="step-number">02</span>
            <div>
              <p class="eyebrow">云台画面</p>
              <h2>RGB 相机</h2>
            </div>
          </div>
          <div class="camera-standby" aria-label="云台相机">
            <img class="photo-preview" data-photo-preview alt="巡检照片预览" hidden />
            <div class="photo-placeholder" data-photo-placeholder>
              <div class="focus-frame" aria-hidden="true"></div>
              <span>CAMERA STANDBY</span>
            </div>
          </div>
          <dl class="camera-readout">
            <div><dt>Yaw</dt><dd data-gimbal-readout-yaw>0°</dd></div>
            <div><dt>Pitch</dt><dd data-gimbal-readout-pitch>0°</dd></div>
            <div><dt>Zoom</dt><dd>1.0×</dd></div>
          </dl>
          <p class="gimbal-keys">云台按键：I/K 俯仰 · J/L 偏航 · C 回中</p>
        </aside>

        <aside class="panel telemetry-panel">
          <p class="eyebrow">飞行状态</p>
          <div class="telemetry-grid">
            <div><span>高度</span><strong><b data-altitude data-value="0">0.0</b> <small>m</small></strong></div>
            <div><span>速度</span><strong>0.0 <small>m/s</small></strong></div>
            <div><span>航向</span><strong>000 <small>°</small></strong></div>
            <div><span>模式</span><strong data-flight-state>待机</strong></div>
          </div>
        </aside>

        <aside class="panel checklist-panel">
          <p class="eyebrow">巡检清单</p>
          <ol>
            <li><span class="check-state" data-check-target>—</span><span>目标定位</span></li>
            <li><span class="check-state" data-check-safety>—</span><span>安全距离</span></li>
            <li><span class="check-state" data-check-evidence>—</span><span>巡检取证</span></li>
          </ol>
          <div class="mission-result">
            <div class="result-row"><span>照片</span><strong data-photo-result>未拍摄</strong></div>
            <p class="result-reasons" data-photo-reasons></p>
            <div class="result-row"><span>Mock AI（模拟）</span><strong data-ai-state>未检测</strong></div>
            <p class="result-reasons" data-ai-detail></p>
            <div class="result-row"><span>任务状态</span><strong data-mission-state>待开始</strong></div>
          </div>
          <button type="button" class="score-reopen" data-action="show-score" hidden>查看教学评分</button>
        </aside>

        <aside class="panel calibration-anchor" data-calibration-anchor aria-label="遥控器标定"></aside>
      </section>

      <footer class="control-deck" aria-label="飞行操作区">
        <div class="control-group">
          <button type="button" data-action="arm">解锁</button>
          <button type="button" data-action="takeoff">起飞</button>
          <button type="button" data-action="hover">悬停</button>
          <button type="button" data-action="capture" class="capture-button">拍摄巡检照片</button>
          <button type="button" data-action="rtl">返航</button>
          <button type="button" data-action="land">降落</button>
          <button type="button" class="reports-button" data-action="open-reports">任务记录</button>
        </div>
        <div class="phase-status">
          <span>飞行控制器</span>
          <strong data-flight-mode>悬停</strong>
        </div>
        <div class="phase-status input-source-status">
          <span>输入源</span>
          <strong data-input-source>键盘</strong>
        </div>
      </footer>

      <div class="score-overlay" data-score-overlay hidden>
        <div class="score-block" data-score-panel>
          <div class="score-total">
            <span class="score-total-label">教学评分</span>
            <strong><b data-score-total>0</b> / 100</strong>
            <em class="score-grade" data-score-grade>—</em>
          </div>
          <ul class="score-dimensions">
            <li data-score-dimension="mission-completion" data-score-status>
              <span class="score-dim-name">任务完成</span>
              <b class="score-dim-value" data-score-value>—</b>
              <p class="score-dim-reason" data-score-reason></p>
            </li>
            <li data-score-dimension="flight-safety" data-score-status>
              <span class="score-dim-name">飞行安全</span>
              <b class="score-dim-value" data-score-value>—</b>
              <p class="score-dim-reason" data-score-reason></p>
            </li>
            <li data-score-dimension="inspection-position" data-score-status>
              <span class="score-dim-name">巡检位置</span>
              <b class="score-dim-value" data-score-value>—</b>
              <p class="score-dim-reason" data-score-reason></p>
            </li>
            <li data-score-dimension="photo-quality" data-score-status>
              <span class="score-dim-name">照片质量</span>
              <b class="score-dim-value" data-score-value>—</b>
              <p class="score-dim-reason" data-score-reason></p>
            </li>
            <li data-score-dimension="flight-efficiency" data-score-status>
              <span class="score-dim-name">飞行效率</span>
              <b class="score-dim-value" data-score-value>—</b>
              <p class="score-dim-reason" data-score-reason></p>
            </li>
            <li data-score-dimension="control-stability" data-score-status>
              <span class="score-dim-name">操纵稳定性</span>
              <b class="score-dim-value" data-score-value>—</b>
              <p class="score-dim-reason" data-score-reason></p>
            </li>
          </ul>
          <p class="score-issues" data-score-issues hidden></p>
          <div class="score-suggestions" data-score-suggestions hidden>
            <p class="score-suggestions-title">教学建议</p>
            <ul data-score-suggestion-list></ul>
          </div>
          <button type="button" class="score-close" data-action="close-score">知道了</button>
        </div>
      </div>

      <div class="reports-overlay" data-reports-overlay hidden>
        <div class="reports-block" data-reports-block>
          <div class="reports-head">
            <div>
              <h2 data-reports-title>任务记录</h2>
              <span class="report-role-badge" data-report-role>学员任务记录</span>
            </div>
            <button type="button" class="score-close" data-action="close-reports">关闭</button>
          </div>
          <div class="report-role-toggle" role="tablist" aria-label="查看视角">
            <button type="button" class="role-tab" data-report-role-tab="student" aria-pressed="true">学员视角</button>
            <button type="button" class="role-tab" data-report-role-tab="teacher" aria-pressed="false">教师查看</button>
          </div>
          <p class="report-teacher-note" data-report-teacher-note hidden>教师查看模式为只读，用于复核学员提交的任务报告；本机未实现多用户隔离。</p>
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
  renderer.domElement.setAttribute('aria-label', '三维电力巡检训练场景');
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
  const mockAI = new MockInspectionAI({
    targetId: layout.target.id,
    defectType: layout.target.defectType,
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
      captureRefusal = permission.reason ?? '当前无法拍摄';
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

    let ai: InspectionAIResult | null = null;
    if (photo.valid) {
      ai = await mockAI.inspect({
        targetId: layout.target.id,
        defectType: layout.target.defectType,
        distanceToTarget: photo.distanceToTarget,
        angleErrorDeg: photo.angleErrorDeg,
        coverageRatio: photo.coverageRatio,
      });
      mission.submitAI(ai);
    }

    recordSeq += 1;
    const record: InspectionCaptureRecord = {
      id: `cap-${recordSeq}-${Date.now()}`,
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
      taskName: '输电塔右侧绝缘子串巡检',
      targetId: layout.target.id,
      targetName: layout.target.label ?? '绝缘子串巡检点',
      startedAt: missionStartedAt || Date.now(),
      finishedAt: Date.now(),
      session: sessionRecorder.session(),
      score: scoreResult,
      captures: missionCaptures.map(toReportCaptureEntry),
      controlSamples: sessionRecorder.controlSamples(),
    });
    lastReport = report;
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
    completed: '完成',
    failed: '失败',
    incomplete: '未完成',
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
        const reasons = dim.reasons.length > 0 ? dim.reasons.map((r) => esc(r)).join('；') : '无扣分项';
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
             <h3>飞行操纵记录（Roll / Pitch / Yaw / Throttle）</h3>
             <p class="report-note">共 ${report.controlSamples.length} 条采样（每 200ms 一次）</p>
             <table class="report-control-table">
               <thead><tr><th>时间(ms)</th><th>Roll</th><th>Pitch</th><th>Yaw</th><th>Throttle</th></tr></thead>
               <tbody>${controlRows}</tbody>
             </table>
             ${report.controlSamples.length > 12 ? `<p class="report-note">… 仅显示前 12 条</p>` : ''}
           </section>`
        : `<section class="report-section"><h3>飞行操纵记录（Roll / Pitch / Yaw / Throttle）</h3><p class="report-empty">无记录</p></section>`;

    const captureRows = report.captures
      .map((cap) => {
        const reasons = cap.photoValidation.reasons.length > 0 ? cap.photoValidation.reasons.map((r) => esc(r)).join('；') : '—';
        const ai =
          cap.aiResult && cap.aiResult.defectDetected
            ? `<p class="report-ai">模拟 AI 检测结果：检出缺陷（绝缘子片缺失），置信度 ${Math.round(cap.aiResult.confidence * 100)}%，来源：模拟 AI / 非真实 YOLO 模型</p>`
            : '';
        return `
          <li class="report-capture ${cap.valid ? 'valid' : 'invalid'}">
            <span class="report-capture-badge">${cap.valid ? '有效' : '无效'}</span>
            <span>第 ${cap.index} 次 · 安全状态：${esc(cap.safetyState)}</span>
            <p class="report-capture-reason">校验：${reasons}</p>
            ${ai}
            ${cap.photoDataUrl ? `<img class="report-photo" src="${esc(cap.photoDataUrl)}" alt="巡检照片 ${cap.index}" />` : ''}
          </li>`;
      })
      .join('');
    const captureSection =
      report.captures.length > 0
        ? `<section class="report-section">
             <h3>拍摄记录（共 ${report.captures.length} 次）</h3>
             <ul class="report-captures">${captureRows}</ul>
           </section>`
        : `<section class="report-section"><h3>拍摄记录</h3><p class="report-empty">无记录</p></section>`;

    const photos = report.captures.filter((c) => c.valid && c.photoDataUrl);
    const photoGallery =
      photos.length > 0
        ? `<section class="report-section">
             <h3>有效巡检照片</h3>
             <div class="report-photo-gallery">${photos
               .map((c) => `<img class="report-photo" src="${esc(c.photoDataUrl ?? '')}" alt="有效巡检照片 ${c.index}" />`)
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
                   `<li class="hazard-${h.state.toLowerCase()}">${esc(h.state)}：${h.count} 次，累计 ${(h.totalDurationMs / 1000).toFixed(1)} 秒</li>`,
               )
               .join('')}</ul>
           </section>`
        : `<section class="report-section"><h3>安全事件</h3><p class="report-empty">全程安全，未触发 WARNING / DANGER / COLLISION</p></section>`;

    const aiSection =
      report.captures.some((c) => c.aiResult && c.aiResult.defectDetected)
        ? `<section class="report-section">
             <h3>Mock AI 检测结果</h3>
             <p class="report-note report-ai-warn">以下结果来自模拟 AI（程序化教学缺陷），<b>非真实 YOLO 模型</b>，仅用于教学演示。</p>
             <ul class="report-ai-list">${report.captures
               .filter((c) => c.aiResult && c.aiResult.defectDetected)
               .map(
                 (c) =>
                   `<li>第 ${c.index} 次照片：检出缺陷「绝缘子片缺失」，置信度 ${Math.round((c.aiResult?.confidence ?? 0) * 100)}%（模拟 AI）</li>`,
               )
               .join('')}</ul>
           </section>`
        : `<section class="report-section"><h3>Mock AI 检测结果</h3><p class="report-empty">未检测到缺陷</p></section>`;

    const issues = s.majorIssues.length > 0 ? s.majorIssues.map((i) => esc(i)).join('；') : '无';
    const suggestions =
      s.suggestions.length > 0
        ? `<ul class="report-suggestions">${s.suggestions.map((sug) => `<li>${esc(sug)}</li>`).join('')}</ul>`
        : '<p class="report-empty">无记录</p>';

    const roleNote =
      role === 'teacher' ? `<p class="report-role-flag">教师查看模式（只读）：用于复核学员提交的任务报告。</p>` : '';

    return `
      <button type="button" class="report-back" data-action="back-to-list">← 返回列表</button>
      ${roleNote}
      <header class="report-header">
        <h3>${esc(report.taskName)}</h3>
        <p class="report-meta">任务 ID：${esc(report.missionId)} · 报告 ID：${esc(report.reportId)}</p>
        <p class="report-meta">开始：${new Date(report.startedAt).toLocaleString('zh-CN')} · 结束：${new Date(report.finishedAt).toLocaleString('zh-CN')}</p>
        <p class="report-meta">最终状态：<b class="report-status report-status-${report.status}">${STATUS_LABEL[report.status]}</b> · 巡检目标：${esc(report.targetName)}（${esc(report.targetId)}）· 是否进入巡检区：${report.enteredInspectionZone ? '是' : '否'}</p>
      </header>
      <section class="report-section report-summary-grid">
        <div><span>飞行时长</span><b>${formatDuration(report.durationMs)}</b></div>
        <div><span>航迹长度</span><b>${report.pathLengthM.toFixed(1)} m</b></div>
        <div><span>最高高度</span><b>${report.maxAltitudeM.toFixed(1)} m</b></div>
        <div><span>总分 / 等级</span><b>${s.totalScore} / 100 · ${esc(gradeLabel(s.grade))}${s.capped ? '（封顶）' : ''}</b></div>
      </section>
      ${controlSection}
      ${captureSection}
      ${photoGallery}
      ${aiSection}
      ${hazardSection}
      <section class="report-section">
        <h3>教学评分（六项）</h3>
        <ul class="report-dimensions">${dims}</ul>
        <p class="report-issues"><b>重大问题：</b>${esc(issues)}</p>
        <div class="report-suggestions-block"><b>教学建议：</b>${suggestions}</div>
      </section>
      <div class="report-actions">
        <button type="button" class="report-export" data-action="export-report">导出 JSON</button>
        <button type="button" class="report-print-btn" data-action="print-report">打印 / 保存 PDF</button>
      </div>
    `;
  }

  async function renderReportsList(): Promise<void> {
    const listEl = root.querySelector<HTMLElement>('[data-reports-list]');
    if (!listEl) return;
    const summaries = await reportStore.list();
    listEl.innerHTML = '';
    if (summaries.length === 0) {
      listEl.innerHTML = '<p class="reports-empty">暂无任务记录。完成一次巡检后，报告会自动保存到这里。</p>';
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
    if (badge) badge.textContent = role === 'teacher' ? '教师查看（只读）' : '学员任务记录';
    if (teacherNote) teacherNote.hidden = role !== 'teacher';
    tabs.forEach((tab) => tab.setAttribute('aria-pressed', String(tab.dataset.reportRoleTab === role)));
    if (currentDetailReport) {
      const detailEl = root.querySelector<HTMLElement>('[data-report-detail]');
      if (detailEl) detailEl.innerHTML = buildReportDetailHtml(currentDetailReport, role);
    }
  }

  const MISSION_STATE_TEXT: Record<MissionState, string> = {
    IDLE: '待开始',
    READY: '准备',
    TAKEOFF: '起飞',
    FLY_TO_TARGET: '前往巡检点',
    POSITION_FOR_INSPECTION: '进入巡检位置',
    AIM_CAMERA: '调整云台',
    CAPTURE: '拍摄',
    VALIDATE_PHOTO: '照片检查',
    AI_INSPECTION: 'AI 缺陷检查',
    INSPECTION_COMPLETE: '巡检完成',
    RETURN: '返航',
    LAND: '降落',
    COMPLETE: '完成',
    FAILED: '失败',
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
      if (captureRefusal) missionDom.photoResult.textContent = '无法拍摄';
      else if (!photo) missionDom.photoResult.textContent = '未拍摄';
      else missionDom.photoResult.textContent = photo.valid ? '照片合格' : '照片不合格';
    }
    if (missionDom.photoReasons) {
      if (captureRefusal) missionDom.photoReasons.textContent = captureRefusal;
      else missionDom.photoReasons.textContent = photo && !photo.valid ? photo.reasons.join('；') : '';
    }

    const ai = mission.aiResult;
    if (missionDom.aiState) missionDom.aiState.textContent = ai?.defectDetected ? '已检测' : '未检测';
    if (missionDom.aiDetail) {
      missionDom.aiDetail.textContent = ai?.defectDetected
        ? `缺陷：绝缘子片缺失（缺失 1 片） · 置信度 ${Math.round(ai.confidence * 100)}% · 来源：模拟 AI / 非真实模型`
        : '';
    }

    if (missionDom.missionState) {
      const running = !['IDLE', 'COMPLETE', 'FAILED'].includes(state);
      missionDom.missionState.textContent = state === 'IDLE' ? '待开始' : running ? '进行中' : MISSION_STATE_TEXT[state];
    }
  }

  const flightController = new SimpleFlightController();
  const keyboard = new KeyboardInputAdapter();
  const gamepad = new GamepadInputAdapter(0);
  const { store: profileStore } = resolveProfileStore();

  // Device profiles keyed by adapter id. The calibration wizard keeps this in
  // sync via onProfileApplied; the flight pipeline consults it (and the live
  // wizard draft) so an un-saved controller still flies.
  const deviceProfiles = new Map<string, DeviceProfile>();

  const calibrationAnchor = root.querySelector<HTMLElement>('[data-calibration-anchor]');
  const calibrationPanel = calibrationAnchor
    ? new ControllerCalibrationPanel({
        root: calibrationAnchor,
        adapter: gamepad,
        store: profileStore,
        onProfileApplied: (profile) => deviceProfiles.set(profile.id, profile),
      })
    : null;

  // Test seam: when the browser test pins the input clock, stale detection uses
  // it instead of wall time (no other behaviour changes).
  const inputNow = (): number => {
    const override = (window as unknown as { __fdeInputClock?: number }).__fdeInputClock;
    return typeof override === 'number' ? override : performance.now();
  };

  const pipeline = new PilotInputPipeline({
    adapters: [gamepad],
    keyboard: () => keyboard.poll(),
    profileFor: (id) => {
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

  const frameInterval = 1000 / config.targetFrameRate;
  let animationFrame = 0;
  let lastRender = 0;
  let lastUpdate = performance.now();
  let disposed = false;

  const stateLabels: Record<FlightState, string> = {
    disarmed: '待机',
    armed: '已解锁',
    'taking-off': '起飞中',
    flying: '飞行中',
    landing: '降落中',
    paused: '已暂停',
    emergency: '紧急停止',
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
    inspectionTarget: root.querySelector<HTMLElement>('[data-inspection-target]'),
    distanceTarget: root.querySelector<HTMLElement>('[data-distance-target]'),
    distanceObstacle: root.querySelector<HTMLElement>('[data-distance-obstacle]'),
    safetyStatus: root.querySelector<HTMLElement>('[data-safety-status]'),
    inspectionZone: root.querySelector<HTMLElement>('[data-inspection-zone]'),
  };

  const SAFETY_LABELS: Record<SafetyState, string> = {
    SAFE: '安全',
    WARNING: '警告',
    DANGER: '危险',
    COLLISION: '碰撞',
  };

  const SAFETY_CLASS: Record<SafetyState, string> = {
    SAFE: 'safety-safe',
    WARNING: 'safety-warning',
    DANGER: 'safety-danger',
    COLLISION: 'safety-collision',
  };

  const updateInputSource = (source: PilotInputSource): void => {
    if (readout.inputSource) {
      readout.inputSource.textContent = source.kind === 'adapter' ? `遥控器 · ${source.label}` : '键盘';
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
    if (readout.state) readout.state.textContent = stateLabels[snapshot.state];
    if (readout.mode) readout.mode.textContent = snapshot.mode === 'manual' ? '手动' : snapshot.mode === 'mission' ? '任务' : '悬停';
    if (readout.x) readout.x.textContent = x;
    if (readout.y) readout.y.textContent = y;
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
      readout.inspectionZone.textContent = result.insideInspectionZone ? '已进入' : '区外';
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

  const render = (timestamp: number): void => {
    if (disposed) return;
    const deltaSeconds = Math.min(Math.max((timestamp - lastUpdate) / 1000, 0), 0.1);
    lastUpdate = timestamp;
    const input = pipeline.poll();
    const snapshot = flightController.update(input.command, deltaSeconds);
    lastSnapshot = snapshot;
    droneEntity?.update(snapshot, deltaSeconds);
    updateReadout(snapshot);
    updateInputSource(input.source);
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
      camera.position.lerp(new THREE.Vector3(target.x + 12, target.y + 8, target.z + 15), 0.05);
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
      calibrationPanel?.stop();
      droneEntity?.dispose();
      transmissionScene.dispose();
      captureTarget.dispose();
      window.removeEventListener('keydown', handleGimbalKey);
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
