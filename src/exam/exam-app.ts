/**
 * 考試模式主程式（CAA 專業基本級術科考場模擬）。
 *
 * 組裝：考場場景(3D) + 考試機飛控(雙模式/慣性) + 風場 + 即時面板(HUD) +
 * 會話錄製 + 成績單(仿附錄5) + 航跡回放。
 *
 * 本模組為「考試機獨立疊加」：不動既有巡檢任務、搖桿映射、標定檔、飛控航向
 * 修正；僅在此模式下掛載考試機飛控與考場場景。
 *
 * 版面（2026-10-23 教師實測回報後重做）：
 *  - 頂部固定列：應考科目（空間不足換行）＋風速／安全宣告（可收合小卡）＋
 *    步驟條（①選科目②起飛③執行④降落⑤成績單，目前步驟高亮）＋狀態＋提示；
 *  - 右側窄欄：即時面板（小地圖 216×140、模式／視角、輸入摘要可展開）；
 *  - 場景中央保留給 3D 畫面，任何面板不得覆蓋；
 *  - 底部中央：起飛／懸停／降落控制列（依飛行狀態啟用）＋鍵盤提示。
 *
 * 相機：預設「考生視角」（應考人站位看向機體），V 鍵循環 考生／追隨／俯視全景；
 * 距離與高度取自 config.simAssist.camera（模擬假設，非官方，可調）。
 */

import * as THREE from 'three';
import { zhHant as L } from '../i18n/zh-Hant';
import { loadExamConfig, loadExamAircraftParams, type ExamCameraView } from './config';
import { buildExamField } from './field';
import { createExamScene, type ExamSceneHandle } from './scene';
import { ExamFlightController } from './flight-controller';
import { SAFETY_DECLARATION, WindField } from './wind';
import { ExamHud, type ExamHudMode } from './panel';
import { ExamSession, type TrajectoryPoint } from './session';
import { ExamInput } from './exam-input';
import { mountFloatingLinkPanel } from '../ui/link-panel';
import { normalizeInputSource, showPracticeToast, syncPractice } from '../report/practice-sync';
import { GroundCheckPanel } from './ground-panel';
import {
  addOrbitPitchDeg,
  addOrbitYawDeg,
  defaultCameraAdjust,
  resolveCameraPosition,
  zoomFovDeg,
} from './camera';
import {
  cycleCameraView,
  deriveControlAvailability,
  deriveExamStep,
  deriveFlightStatus,
  deriveStatusLabel,
  nextHintKey,
  type ExamFlowStep,
  type ExamStatusLabel,
} from './flow';
import type { FlightSample } from './subjects';
import type { ExamStickCommand, ExamFlightSnapshot } from './types';

/**
 * 純函式：飛控快照 → 考試錄製樣本（供科目判定與重大違失偵測）。可單元測試。
 *
 * 對地速度：定位保持生效時風已被飛控抵銷（snapshot.positionHoldCompensating），
 * 有效風為 0；否則全額風作用於機體。兩者不可混——否則「放桿懸停」會被記成
 * 風速大小的對地速度，靜止判定永遠不成立。
 */
export function toFlightSample(snapshot: ExamFlightSnapshot, t: number): FlightSample {
  const windEffX = snapshot.positionHoldCompensating ? 0 : snapshot.windVector.x;
  const windEffZ = snapshot.positionHoldCompensating ? 0 : snapshot.windVector.z;
  return {
    t,
    x: snapshot.position.x,
    y: snapshot.position.y,
    z: snapshot.position.z,
    headingDeg: snapshot.headingDeg,
    speedMps: snapshot.horizontalSpeedMps,
    // 對地速度：有風時懸停的對空速度≈風速，靜止／停頓判定必須用對地速度。
    groundSpeedMps: Math.hypot(snapshot.velocity.x + windEffX, snapshot.velocity.z + windEffZ),
    vy: snapshot.verticalSpeedMps,
    mode: snapshot.mode,
  };
}

export interface AppHandle {
  dispose(): void;
}

export interface CreateExamAppOptions {
  /** 是否為正式考試模式（強制關閉引導）。預設 true。 */
  examMode?: boolean;
}

/** 考試機起飛目標高度（m）。科目 B 官方準則 1.5m；其餘科目同基準。 */
const TAKEOFF_ALTITUDE_M = 1.5;

function div(style: string): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = style;
  return el;
}

export function createExamApp(root: HTMLElement, options: CreateExamAppOptions = {}): AppHandle {
  const examMode = options.examMode ?? true;
  const config = loadExamConfig();
  const field = buildExamField(config);
  const aircraft = loadExamAircraftParams();

  const controller = new ExamFlightController(aircraft);
  const wind = new WindField(config);
  const session = new ExamSession();

  // ---- DOM 骨架 ----
  root.innerHTML = '';
  const wrap = div('position:relative;width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;background:#0b1d2a;');
  root.appendChild(wrap);

  // 頂部固定列（科目列＋風速卡＋步驟條＋狀態＋提示）。
  const topBar = div(
    'flex:0 0 auto;display:flex;flex-direction:column;gap:4px;padding:6px 10px;background:rgba(8,18,28,0.94);border-bottom:1px solid #22415a;z-index:20;font:12px/1.4 sans-serif;color:#cfe;',
  );
  topBar.id = 'exam-topbar';
  wrap.appendChild(topBar);

  const subjectRow = div('display:flex;flex-wrap:wrap;align-items:center;gap:6px;');
  topBar.appendChild(subjectRow);

  const subjectBar = div('display:flex;flex-wrap:wrap;gap:4px;align-items:center;');
  subjectRow.appendChild(subjectBar);

  const topDisclaimer = document.createElement('span');
  topDisclaimer.textContent = L.exam.topDisclaimer;
  topDisclaimer.style.cssText =
    'font-size:11px;padding:2px 10px;border-radius:10px;background:rgba(180,40,40,0.85);color:#fff;white-space:nowrap;';
  subjectRow.appendChild(topDisclaimer);

  // 風速／安全宣告：小型可收合卡片（不佔橫幅）。
  // 面板必須是浮層（position:absolute）：若隨 <details> 展開佔用文件流，頂欄會換行，
  // 科目列與步驟條被往下推，整個舞台跳動——教師實測時只要點一下風況就會看到版面位移。
  const windChip = document.createElement('details');
  windChip.style.cssText = 'position:relative;margin-left:auto;font-size:11px;color:#ffd28a;';
  const windSummary = document.createElement('summary');
  windSummary.style.cssText = 'cursor:pointer;padding:2px 8px;border:1px solid #4a6a82;border-radius:8px;white-space:nowrap;';
  windChip.appendChild(windSummary);
  const windBody = div(
    'position:absolute;right:0;top:calc(100% + 4px);width:min(420px,calc(100vw - 24px));padding:6px 8px;background:rgba(4,12,18,0.96);border:1px solid #4a6a82;border-radius:6px;color:#ffd28a;z-index:20;box-shadow:0 6px 18px rgba(0,0,0,0.55);',
  );
  windChip.appendChild(windBody);

  // 風況切換（教學／監評用）：無風／微風／接近門檻／觸發宣告。
  // 微風與接近門檻為模擬假設（非官方），選項文字直接標示。
  const windPresetRow = div('display:flex;align-items:center;gap:6px;margin-bottom:4px;');
  const windPresetLabel = document.createElement('span');
  windPresetLabel.textContent = L.exam.windChip.presetLabel;
  const windPresetSelect = document.createElement('select');
  windPresetSelect.dataset.windPreset = 'true';
  windPresetSelect.style.cssText =
    'background:#0b1d2a;color:#ffd28a;border:1px solid #4a6a82;border-radius:4px;font-size:11px;padding:1px 4px;';
  for (const preset of wind.getPresets()) {
    const option = document.createElement('option');
    option.value = preset.key;
    option.textContent = `${preset.label}（平均 ${preset.meanMps}／陣峰 ${preset.gustMps} m/s${preset.official ? '' : '，非官方'}）`;
    windPresetSelect.appendChild(option);
  }
  windPresetSelect.value = wind.getPresetKey();
  windPresetSelect.addEventListener('change', () => {
    wind.setPreset(windPresetSelect.value);
    updateWindChip();
  });
  windPresetRow.append(windPresetLabel, windPresetSelect);
  windBody.appendChild(windPresetRow);

  const windStatus = div('white-space:pre-wrap;');
  windBody.appendChild(windStatus);
  subjectRow.appendChild(windChip);

  // 步驟條＋狀態＋提示。
  const flowRow = div('display:flex;flex-wrap:wrap;align-items:center;gap:8px;');
  topBar.appendChild(flowRow);

  const stepBar = div('display:flex;flex-wrap:wrap;gap:4px;align-items:center;');
  stepBar.id = 'exam-steps';
  flowRow.appendChild(stepBar);

  const statusTag = document.createElement('span');
  statusTag.style.cssText = 'font-size:11px;padding:2px 8px;border-radius:8px;background:#33475a;color:#dfe;';
  flowRow.appendChild(statusTag);

  const hintText = document.createElement('span');
  hintText.id = 'exam-hint';
  hintText.style.cssText = 'font-size:12px;color:#8fe3b0;';
  flowRow.appendChild(hintText);

  // 舞台（3D 場景＋浮層）。中央區域不得被面板覆蓋。
  const stage = div('position:relative;flex:1 1 auto;overflow:hidden;');
  stage.id = 'exam-stage';
  wrap.appendChild(stage);

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%;';
  stage.appendChild(canvas);

  // 右側窄欄：即時面板。
  const hudHost = div('position:absolute;top:8px;right:8px;z-index:10;');
  hudHost.id = 'exam-hud-host';
  stage.appendChild(hudHost);
  const hud = new ExamHud(field, hudHost);
  hud.setExamMode(examMode);

  // 地面檢查面板（科目 A／G；預設隱藏，置於左側、不遮中央）。
  const groundHost = div(
    'position:absolute;top:8px;left:8px;z-index:10;display:none;width:min(320px,calc(100% - 264px));max-height:calc(100% - 16px);overflow:auto;',
  );
  stage.appendChild(groundHost);
  const groundPanel = new GroundCheckPanel(groundHost, session);

  // 底部中央：起飛／懸停／降落控制列（狀態驅動）。
  const controlBar = div(
    'position:absolute;bottom:34px;left:50%;transform:translateX(-50%);display:flex;gap:8px;z-index:10;',
  );
  controlBar.id = 'exam-controls';
  stage.appendChild(controlBar);

  const btnStyle =
    'padding:7px 18px;border-radius:8px;border:1px solid #4a7;background:#1d3a2b;color:#dff;font:bold 13px sans-serif;cursor:pointer;';
  const takeoffButton = document.createElement('button');
  takeoffButton.textContent = `${L.exam.controlBar.takeoff} (T)`;
  takeoffButton.dataset.action = 'takeoff';
  takeoffButton.style.cssText = btnStyle;
  const hoverButton = document.createElement('button');
  hoverButton.textContent = L.exam.controlBar.hover;
  hoverButton.dataset.action = 'hover';
  hoverButton.style.cssText = btnStyle;
  const landButton = document.createElement('button');
  landButton.textContent = `${L.exam.controlBar.land} (L)`;
  landButton.dataset.action = 'land';
  landButton.style.cssText = btnStyle;
  const viewButton = document.createElement('button');
  viewButton.dataset.action = 'camera-view';
  viewButton.style.cssText = `${btnStyle}background:#173957;border-color:#4b9fd0;`;
  controlBar.append(takeoffButton, hoverButton, landButton, viewButton);

  const controls = document.createElement('div');
  controls.textContent = L.exam.controlsHint;
  controls.style.cssText =
    'position:absolute;bottom:6px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.5);color:#cfe;padding:3px 10px;border-radius:8px;font:11px sans-serif;white-space:nowrap;z-index:10;max-width:96%;overflow:hidden;text-overflow:ellipsis;';
  controls.id = 'exam-keyhint';
  stage.appendChild(controls);

  // 緊急返航橫幅（科目 F，監評人員下達時顯示）。
  const emergencyBanner = document.createElement('div');
  emergencyBanner.textContent = L.exam.emergencyBanner;
  emergencyBanner.style.cssText =
    'position:absolute;top:8px;left:50%;transform:translateX(-50%);background:rgba(200,30,30,0.92);color:#fff;padding:8px 18px;border-radius:10px;font:bold 15px sans-serif;z-index:12;display:none;max-width:80%;text-align:center;';
  stage.appendChild(emergencyBanner);
  let emergencyBannerUntil = 0;

  // 成績單（覆蓋舞台；頂部列仍可見以免責聲明）。
  // 成績單浮層：必須完全不透明——半透明時下方的即時面板（z-index 10）會透出來
  // 形成鬼影，成績單上的數字會被誤讀。
  const reportHost = div(
    'position:absolute;inset:0;background:#08121c;color:#fff;overflow:auto;padding:20px;display:none;z-index:30;font:13px/1.5 sans-serif;',
  );
  reportHost.id = 'exam-report';
  stage.appendChild(reportHost);

  /** 最近一帧飛控快照（供監評觸發按鍵與測試鉤子讀取）。 */
  let lastSnap: ExamFlightSnapshot | null = null;
  /** 已渲染帧數（測試鉤子用：確認畫面真的畫過，而非只掛載 DOM）。 */
  let frameCount = 0;

  // ---- 應考科目列 ----
  const SUBJECT_KEYS: Array<{ key: 'A' | 'B' | 'C' | 'D' | 'F' | 'G'; label: string }> = [
    { key: 'A', label: `A ${L.exam.subjects.A}` },
    { key: 'B', label: `B ${L.exam.subjects.B}` },
    { key: 'C', label: `C ${L.exam.subjects.C}` },
    { key: 'D', label: `D ${L.exam.subjects.D}` },
    { key: 'F', label: `F ${L.exam.subjects.F}` },
    { key: 'G', label: `G ${L.exam.subjects.G}` },
  ];
  const renderSubjectBar = (): void => {
    const current = session.getCurrentSubject();
    subjectBar.innerHTML = SUBJECT_KEYS.map(
      ({ key, label }) =>
        `<button data-subject="${key}" style="padding:3px 10px;border-radius:6px;border:1px solid #4a7;cursor:pointer;font:12px sans-serif;white-space:nowrap;${
          current === key ? 'background:#2d6;color:#04240f;font-weight:bold;' : 'background:rgba(20,40,55,0.9);color:#cfe;'
        }">${label}</button>`,
    ).join('');
    subjectBar.querySelectorAll('button').forEach((el) => {
      const btn = el as HTMLButtonElement;
      btn.addEventListener('click', () => {
        const key = btn.dataset.subject as 'A' | 'B' | 'C' | 'D' | 'F' | 'G';
        session.startSubject(key);
        groundPanel.setSubject(key === 'A' || key === 'G' ? key : null);
        renderSubjectBar();
        renderFlow(true);
      });
    });
  };
  renderSubjectBar();

  // ---- Three.js ----
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
  const sceneHandle: ExamSceneHandle = createExamScene(scene, field);

  const cam = config.simAssist.camera;
  let cameraView: ExamCameraView = cam.defaultView;
  let cameraAdjust = defaultCameraAdjust();
  let appliedFovDeg = camera.fov;
  const followEye = new THREE.Vector3();
  let followEyeInit = false;

  const resize = (): void => {
    const w = stage.clientWidth || 800;
    const h = stage.clientHeight || 600;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  // 頁面卸載時主動釋放 WebGL context（非 bfcache 還原），避免瀏覽器／GPU 程序
  // 累積未釋放的 context（全量瀏覽器測試後段頁面空白／機體消失的根因之一）。
  const handlePageHide = (event: PageTransitionEvent): void => {
    if (!event.persisted) renderer.forceContextLoss();
  };
  window.addEventListener('pagehide', handlePageHide);

  const syncCameraUi = (): void => {
    hud.setCameraView(cameraView, cameraAdjust);
    viewButton.textContent = `${L.exam.panel.cameraView}：${L.exam.camera[cameraView]} (V)`;
  };

  /** 依視角更新相機（機體保持畫面中央：lookAt 機體位置）。 */
  const updateCamera = (snap: ExamFlightSnapshot | null, dt: number): void => {
    const dronePos = snap?.position ?? { x: 0, y: 0, z: 0 };
    const targetY = Math.max(dronePos.y, 0.35);
    const target = new THREE.Vector3(dronePos.x, targetY, dronePos.z);
    const applyPosition = (base: THREE.Vector3): void => {
      const position = resolveCameraPosition(
        target,
        { x: base.x - target.x, y: base.y - target.y, z: base.z - target.z },
        cameraAdjust.orbitYawDeg,
        cameraAdjust.orbitPitchDeg,
      );
      camera.position.set(position.x, position.y, position.z);
      camera.lookAt(target);
    };
    if (appliedFovDeg !== cameraAdjust.fovDeg) {
      camera.fov = cameraAdjust.fovDeg;
      camera.updateProjectionMatrix();
      appliedFovDeg = cameraAdjust.fovDeg;
    }
    if (cameraView === 'examinee') {
      // 考生視角：站在應考人位置（起降點 H 後方 standoffBehindHM、眼高 eyeHeightM），
      // 看向機體——起飛前即可見機體停在起降點上。
      applyPosition(new THREE.Vector3(
        field.examineePosition.x,
        cam.views.examinee.eyeHeightM,
        field.examineePosition.z + cam.views.examinee.standoffBehindHM,
      ));
      followEyeInit = false;
      return;
    }
    if (cameraView === 'follow') {
      // 追隨視角：機體後方 distanceM、上方 heightM，平滑跟隨。
      const rad = (snap?.headingDeg ?? 0) * (Math.PI / 180);
      const desired = new THREE.Vector3(
        dronePos.x - Math.sin(rad) * cam.views.follow.distanceM,
        dronePos.y + cam.views.follow.heightM,
        dronePos.z + Math.cos(rad) * cam.views.follow.distanceM,
      );
      if (!followEyeInit) {
        followEye.copy(desired);
        followEyeInit = true;
      } else {
        followEye.lerp(desired, 1 - Math.exp(-6 * Math.max(dt, 1 / 120)));
      }
      applyPosition(followEye);
      return;
    }
    // 俯視全景。
    const overviewTarget = new THREE.Vector3(0, 0, cam.views.overview.lookAtZ);
    const overviewBase = new THREE.Vector3(0, cam.views.overview.heightM, cam.views.overview.distanceM);
    const overviewPosition = resolveCameraPosition(
      overviewTarget,
      { x: overviewBase.x - overviewTarget.x, y: overviewBase.y - overviewTarget.y, z: overviewBase.z - overviewTarget.z },
      cameraAdjust.orbitYawDeg,
      cameraAdjust.orbitPitchDeg,
    );
    camera.position.set(overviewPosition.x, overviewPosition.y, overviewPosition.z);
    camera.lookAt(overviewTarget);
    followEyeInit = false;
  };
  updateCamera(null, 0);
  syncCameraUi();

  // 相機操作只改畫面，不送出飛控指令也不改變評分資料。
  const onCameraWheel = (event: WheelEvent): void => {
    event.preventDefault();
    cameraAdjust = { ...cameraAdjust, fovDeg: zoomFovDeg(cameraAdjust.fovDeg, event.deltaY < 0 ? 1 : -1) };
    syncCameraUi();
  };
  stage.addEventListener('wheel', onCameraWheel, { passive: false });

  let cameraDrag: { pointerId: number; x: number; y: number } | null = null;
  const onCameraPointerDown = (event: PointerEvent): void => {
    // 觸控 PointerEvent 在部分行動 WebView 的 button 值不是 0；只排除滑鼠右鍵／中鍵。
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    cameraDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const onCameraPointerMove = (event: PointerEvent): void => {
    if (!cameraDrag || cameraDrag.pointerId !== event.pointerId) return;
    const dx = event.clientX - cameraDrag.x;
    const dy = event.clientY - cameraDrag.y;
    cameraDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    cameraAdjust = {
      ...cameraAdjust,
      orbitYawDeg: addOrbitYawDeg(cameraAdjust.orbitYawDeg, dx * 0.35),
      orbitPitchDeg: addOrbitPitchDeg(cameraAdjust.orbitPitchDeg, -dy * 0.25),
    };
    syncCameraUi();
  };
  const stopCameraDrag = (event: PointerEvent): void => {
    if (!cameraDrag || cameraDrag.pointerId !== event.pointerId) return;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    cameraDrag = null;
  };
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('pointerdown', onCameraPointerDown);
  canvas.addEventListener('pointermove', onCameraPointerMove);
  canvas.addEventListener('pointerup', stopCameraDrag);
  canvas.addEventListener('pointercancel', stopCameraDrag);

  // ---- 輸入：既有輸入管線（搖桿標定 → InputNormalizer → ChannelMapper；鍵盤備援）----
  const examInput = new ExamInput();
  void examInput.start();
  // 2026-11-07：左下角「🔗 連線方式」——原子筆鏡頭搖桿、手機遙控器
  const unmountLink = examInput.pen && examInput.phone ? mountFloatingLinkPanel(examInput.pen, examInput.phone, examInput.gesture ?? undefined) : () => undefined;

  // ---- 流程狀態（步驟條／狀態／提示／按鈕）----
  let reportOpen = false;
  let flowCacheKey = '';
  let hintOverride: { text: string; until: number } | null = null;
  let hoverActive = false;

  const steps: Array<{ key: ExamFlowStep; label: string }> = [
    { key: 'select', label: L.exam.steps.select },
    { key: 'takeoff', label: L.exam.steps.takeoff },
    { key: 'execute', label: L.exam.steps.execute },
    { key: 'land', label: L.exam.steps.land },
    { key: 'report', label: L.exam.steps.report },
  ];

  const currentFlowState = () => {
    const flightStatus = deriveFlightStatus(lastSnap?.state ?? 'idle', lastSnap?.position.y ?? 0);
    return {
      subjectSelected: session.getCurrentSubject() !== null,
      flightStatus,
      reportOpen,
      takingOff: controller.isTakingOff(),
      landing: controller.isLanding(),
    };
  };

  const renderFlow = (force = false): void => {
    const s = currentFlowState();
    const step = deriveExamStep(s);
    const statusLabel: ExamStatusLabel = deriveStatusLabel(s.flightStatus, s.takingOff, s.landing);
    const hintKey = nextHintKey(s);
    const override = hintOverride && performance.now() < hintOverride.until ? hintOverride.text : null;
    const key = `${step}|${statusLabel}|${hintKey}|${s.subjectSelected}|${hoverActive}|${override ?? ''}`;
    if (!force && key === flowCacheKey) return;
    flowCacheKey = key;

    stepBar.innerHTML = steps
      .map(
        (it) =>
          `<span data-step="${it.key}" data-current="${it.key === step}" style="padding:2px 8px;border-radius:6px;font-size:11px;white-space:nowrap;${
            it.key === step ? 'background:#2d6;color:#04240f;font-weight:bold;' : 'background:rgba(30,55,72,0.9);color:#9fc;'
          }">${it.label}</span>`,
      )
      .join('');

    statusTag.textContent = L.exam.flightStatus[statusLabel];
    statusTag.dataset.status = statusLabel;
    hintText.textContent = override ?? L.exam.hints[hintKey as keyof typeof L.exam.hints];

    const avail = deriveControlAvailability(s.flightStatus, s.takingOff, s.landing);
    const takeoffEnabled = avail.takeoff && s.subjectSelected;
    takeoffButton.disabled = !takeoffEnabled;
    hoverButton.disabled = !avail.hover;
    landButton.disabled = !avail.land;
    takeoffButton.title = s.subjectSelected ? L.exam.hints.pressTakeoff : L.exam.hints.selectSubjectFirst;
    type ControlAction = 'takeoff' | 'hover' | 'land';
    type ControlState = 'disabled' | 'ready' | 'active' | 'completed';
    const controlState = (action: ControlAction, enabled: boolean): ControlState => {
      if (action === 'takeoff' && s.takingOff) return 'active';
      if (action === 'land' && s.landing) return 'active';
      if (action === 'land' && s.flightStatus === 'landed') return 'completed';
      if (action === 'hover' && hoverActive && s.flightStatus === 'flying' && !s.takingOff && !s.landing) return 'active';
      return enabled ? 'ready' : 'disabled';
    };
    const renderControl = (button: HTMLButtonElement, action: ControlAction, enabled: boolean): void => {
      const state = controlState(action, enabled);
      button.dataset.controlState = state;
      button.setAttribute('aria-pressed', state === 'active' ? 'true' : 'false');
      button.style.opacity = state === 'disabled' ? '0.48' : '1';
      button.style.cursor = state === 'disabled' ? 'not-allowed' : 'pointer';
      button.style.background = state === 'active' ? '#16a34a' : state === 'ready' ? '#237a45' : state === 'completed' ? '#1c6c48' : '#293842';
      button.style.borderColor = state === 'active' ? '#86efac' : state === 'ready' ? '#62d685' : state === 'completed' ? '#75caa1' : '#51616d';
      button.style.color = state === 'disabled' ? '#a8b4ba' : '#effff4';
      button.style.boxShadow = state === 'active' ? '0 0 0 2px rgba(134,239,172,0.38),0 0 18px rgba(34,197,94,0.42)' : 'none';
    };
    renderControl(takeoffButton, 'takeoff', takeoffEnabled);
    renderControl(hoverButton, 'hover', avail.hover);
    renderControl(landButton, 'land', avail.land);
  };

  const flashHint = (text: string): void => {
    hintOverride = { text, until: performance.now() + 2500 };
    renderFlow(true);
  };

  /** 起飛（按鈕與 T 鍵共用）：未選科目不得起飛。 */
  const requestTakeoff = (): void => {
    if (!session.getCurrentSubject()) {
      flashHint(L.exam.hints.selectSubjectFirst);
      return;
    }
    controller.arm();
    controller.takeoff(TAKEOFF_ALTITUDE_M);
    hoverActive = false;
    renderFlow(true);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    const code = e.code;
    if (code === 'Digit1') controller.setMode('manual');
    else if (code === 'Digit2') controller.setMode('attitude');
    else if (code === 'Digit3') controller.setMode('position');
    else if (code === 'KeyT') requestTakeoff();
    else if (code === 'KeyL') {
      hoverActive = false;
      controller.land();
      renderFlow(true);
    }
    else if (code === 'KeyG') examInput.togglePreference();
    else if (code === 'KeyV') {
      cameraView = cycleCameraView(cameraView);
      syncCameraUi();
      flashHint(`${L.exam.panel.cameraView}：${L.exam.camera[cameraView]}（${L.exam.camera.switchHint}）`);
    } else if (code === 'Equal' || code === 'NumpadAdd' || code === 'ArrowUp') {
      e.preventDefault();
      cameraAdjust = { ...cameraAdjust, fovDeg: zoomFovDeg(cameraAdjust.fovDeg, 1) };
      syncCameraUi();
    } else if (code === 'Minus' || code === 'NumpadSubtract' || code === 'ArrowDown') {
      e.preventDefault();
      cameraAdjust = { ...cameraAdjust, fovDeg: zoomFovDeg(cameraAdjust.fovDeg, -1) };
      syncCameraUi();
    } else if (code === 'KeyZ') {
      cameraAdjust = defaultCameraAdjust();
      syncCameraUi();
    } else if (code === 'KeyE') triggerEmergency();
    else if (code === 'Enter') finish();
    else if (code === 'Escape') restart();
  };
  window.addEventListener('keydown', onKeyDown);

  takeoffButton.addEventListener('click', () => requestTakeoff());
  hoverButton.addEventListener('click', () => {
    hoverActive = controller.hover();
    renderFlow(true);
  });
  landButton.addEventListener('click', () => {
    hoverActive = false;
    controller.land();
    renderFlow(true);
  });
  viewButton.addEventListener('click', () => {
    cameraView = cycleCameraView(cameraView);
    syncCameraUi();
    flashHint(`${L.exam.panel.cameraView}：${L.exam.camera[cameraView]}（${L.exam.camera.switchHint}）`);
  });

  /**
   * 監評人員下達「緊急返航」（科目 F 觸發，官方準則第 3 條：在空中任一位置）。
   * 須在空中（y > 0.15m）才生效；記錄觸發時間與當下機位——判定以「較近一側」
   * 八字圓為降落目標，並要求立即原處懸停於觸發點。
   */
  const triggerEmergency = (): void => {
    if (!lastSnap || lastSnap.position.y <= 0.15) {
      emergencyBanner.textContent = L.exam.emergencyIgnored;
      emergencyBanner.style.display = 'block';
      emergencyBannerUntil = performance.now() + 1500;
      return;
    }
    session.triggerEmergency(simTime, lastSnap.position.x, lastSnap.position.z);
    emergencyBanner.textContent = L.exam.emergencyBanner;
    emergencyBanner.style.display = 'block';
    emergencyBannerUntil = performance.now() + 4000;
  };

  /** 本幀搖桿指令（來源：遙控器標定管線或鍵盤備援）。 */
  const pollCommand = (): ExamStickCommand => {
    const result = examInput.tick();
    const c = result.command;
    return { roll: c.roll, pitch: c.pitch, yaw: c.yaw, throttle: c.throttle };
  };

  // ---- 回放 ----
  let replaying = false;
  let replayIndex = 0;
  let lastTrajectory: readonly TrajectoryPoint[] = [];

  const startReplay = (): void => {
    if (lastTrajectory.length === 0) return;
    replaying = true;
    replayIndex = 0;
    sceneHandle.clearTrajectory();
  };
  const stopReplay = (): void => {
    replaying = false;
  };

  const restart = (): void => {
    stopReplay();
    controller.reset();
    session.clear();
    groundPanel.setSubject(null);
    renderSubjectBar();
    sceneHandle.clearTrajectory();
    reportHost.style.display = 'none';
    reportOpen = false;
    emergencyBanner.style.display = 'none';
    emergencyBannerUntil = 0;
    lastSnap = null;
    simTime = 0;
    renderFlow(true);
  };

  // ---- 成績單 ----
  const finish = (): void => {
    stopReplay();
    const result = session.finalize(config, field, {
      headerValues: {
        測驗日期: new Date().toLocaleDateString('zh-TW'),
        申請人姓名: '—',
        身分證字號: '—',
        測驗級別: '基本級',
      },
    });
    lastTrajectory = result.trajectory;
    reportOpen = true;
    renderReport(result.report);
    // 2026-11-07：登入學員的考場模擬結果自動存入成長日誌（各項 S／U／N 統計＋是否模擬通過）
    const ratings = { S: 0, U: 0, N: 0 };
    for (const it of result.report.items) if (it.rating) ratings[it.rating] += 1;
    const info = examInput.getInfo();
    void syncPractice({
      mode: 'exam',
      title: '考場模擬（A～G 科目）',
      passed: !!result.report.simulatedPass,
      duration_seconds: Math.round(simTime),
      input_source: normalizeInputSource(info.sourceKind, info.sourceLabel),
      summary: ratings,
    }).then(showPracticeToast);
    renderFlow(true);
  };

  const renderReport = (report: ReturnType<ExamSession['finalize']>['report']): void => {
    const ratingText = (r: 'S' | 'U' | 'N' | null): string => {
      if (r === 'S') return `S · ${L.exam.report.ratingS}`;
      if (r === 'U') return `U · ${L.exam.report.ratingU}`;
      if (r === 'N') return `N · ${L.exam.report.ratingN}`;
      return '—';
    };

    const headerRows = report.header
      .map((h) => `<tr><td style="opacity:.7">${h.field}</td><td>${h.value}</td></tr>`)
      .join('');

    const itemRows = report.items
      .map((it) => {
        const tag = it.simulated ? L.exam.report.itemSimulated : L.exam.report.itemNotCovered;
        return `<tr>
          <td>${it.name}</td>
          <td style="text-align:center;font-weight:bold">${ratingText(it.rating)}</td>
          <td style="opacity:.7">${it.note} ${tag}</td>
        </tr>`;
      })
      .join('');

    const mfRows = report.majorFailure.items
      .map((m) => {
        const label = L.exam.majorFailure[m.labelKey.replace('exam.majorFailure.', '') as keyof typeof L.exam.majorFailure];
        const warningTag = m.warningOnly ? `（${L.exam.majorFailure.beyondExamineeRearWarning}，不計入否決）` : '';
        return `<tr>
          <td>${label}${warningTag}</td>
          <td style="text-align:center">${m.detected ? '是' : '否'}</td>
          <td style="opacity:.7">${m.detail}</td>
        </tr>`;
      })
      .join('');

    const warningLines = report.majorFailure.warnings
      .map((w) => `<div style="color:#ffb86b;margin:4px 0">${L.exam.majorFailure.beyondExamineeRearWarning}：${w.detail}</div>`)
      .join('');

    const overall = report.simulatedPass ? L.exam.report.simulatedPass : L.exam.report.simulatedFail;

    reportHost.innerHTML = `
      <div style="max-width:720px;margin:0 auto;">
        <h2 style="margin:0 0 4px">${L.exam.report.title}</h2>
        <div style="color:#ffd28a">${report.judgmentLabel}</div>
        <table style="width:100%;border-collapse:collapse;margin:12px 0">
          ${headerRows}
        </table>
        <h3 style="margin:8px 0">附錄5 七項</h3>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr><th style="text-align:left">項目</th><th>S/U/N</th><th>備註</th></tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
        <h3 style="margin:12px 0">${L.exam.report.majorFailureSection}</h3>
        <div style="color:#ffd28a">${report.majorFailure.rule}</div>
        <table style="width:100%;border-collapse:collapse;margin:6px 0">
          <thead><tr><th style="text-align:left">項目</th><th>是否</th><th>量測</th></tr></thead>
          <tbody>${mfRows}</tbody>
        </table>
        ${warningLines}
        <div style="margin:12px 0;font-size:15px;font-weight:bold">${overall}</div>
        <div style="opacity:.85;font-size:12px">${report.simulatedPassDetail}</div>
        <div style="opacity:.8">${L.exam.report.officialStandard}：${report.officialPassStandard}</div>
        <div style="margin-top:16px;display:flex;gap:8px">
          <button id="exam-replay" style="padding:6px 14px">${L.exam.report.replay}</button>
          <button id="exam-restart" style="padding:6px 14px">${L.exam.report.restart}</button>
        </div>
      </div>`;
    reportHost.style.display = 'block';
    reportHost.querySelector<HTMLButtonElement>('#exam-replay')?.addEventListener('click', () => {
      reportHost.style.display = 'none';
      reportOpen = false;
      renderFlow(true);
      startReplay();
    });
    reportHost.querySelector<HTMLButtonElement>('#exam-restart')?.addEventListener('click', () => {
      restart();
    });
  };

  const updateWindChip = (): void => {
    const st = wind.getState();
    const declaring = wind.needsSafetyDeclaration();
    const preset = wind.getPreset();
    const officialNote = preset.official ? '' : '（模擬假設，非官方）';
    // 平均風與陣風峰值（陣峰＝瞬時風速上限），另附當前瞬時風速。
    windSummary.textContent = `風：${preset.label}｜平均 ${st.meanSpeedMps.toFixed(1)} · 陣峰 ${st.gustSpeedMps.toFixed(1)} m/s（即時 ${st.instantSpeedMps.toFixed(1)}）${declaring ? ' ⚠ 需安全宣告' : ''}`;
    windSummary.style.color = declaring ? '#ff9d5c' : '#ffd28a';
    windStatus.textContent = declaring
      ? `${L.exam.panel.safety}：${config.wind.declarationText}${officialNote}`
      : `未達安全宣告門檻（平均 ${SAFETY_DECLARATION.meanWindMps} m/s／陣峰 ${SAFETY_DECLARATION.gustMps} m/s），無須宣告。${officialNote}`;
    if (windPresetSelect.value !== wind.getPresetKey()) windPresetSelect.value = wind.getPresetKey();
    hud.setWind({
      meanMps: st.meanSpeedMps,
      gustPeakMps: st.gustSpeedMps,
      instantMps: st.instantSpeedMps,
      declaring,
    });
  };

  // ---- 測試鉤子（供瀏覽器測試讀取機體投影與流程狀態；不影響功能）----
  const testHook = {
    getState: () => ({
      frames: frameCount,
      step: deriveExamStep(currentFlowState()),
      status: statusTag.dataset.status ?? null,
      cameraView,
      cameraAdjust: { ...cameraAdjust },
      subject: session.getCurrentSubject(),
      /** 機體目前位置（m）與定位保持狀態：驗證「起飛後原地不動」與飄移量。 */
      position: {
        x: lastSnap?.position.x ?? 0,
        y: lastSnap?.position.y ?? 0,
        z: lastSnap?.position.z ?? 0,
      },
      mode: lastSnap?.mode ?? 'position',
      positionHoldCompensating: lastSnap?.positionHoldCompensating ?? false,
      windSpeedMps: Math.hypot(lastSnap?.windVector.x ?? 0, lastSnap?.windVector.z ?? 0),
      flightState: lastSnap?.state ?? 'idle',
      altitude: lastSnap?.position.y ?? 0,
      heading: lastSnap?.headingDeg ?? 0,
    }),
    /** 機體在畫面上的投影（像素）與近似尺寸，用於驗證「看得見」。 */
    getDroneScreen: () => {
      const p = lastSnap?.position ?? { x: 0, y: 0, z: 0 };
      const w = renderer.domElement.clientWidth;
      const h = renderer.domElement.clientHeight;
      const center = new THREE.Vector3(p.x, p.y + 0.12, p.z).project(camera);
      const right = new THREE.Vector3(p.x + 0.55, p.y + 0.12, p.z).project(camera);
      const px = (center.x * 0.5 + 0.5) * w;
      const py = (-center.y * 0.5 + 0.5) * h;
      const px2 = (right.x * 0.5 + 0.5) * w;
      return {
        inView: Math.abs(center.x) <= 1 && Math.abs(center.y) <= 1 && center.z < 1,
        x: px,
        y: py,
        sizePx: Math.abs(px2 - px),
        viewport: { w, h },
      };
    },
  };
  (window as unknown as Record<string, unknown>).__examTestHook = testHook;

  // ---- 主迴圈 ----
  let disposed = false;
  let rafId = 0;
  let simTime = 0;
  const clock = new THREE.Clock();

  const animate = (): void => {
    if (disposed) return;
    rafId = requestAnimationFrame(animate);
    const dt = clock.getDelta();

    if (replaying) {
      if (replayIndex < lastTrajectory.length) {
        const p = lastTrajectory[replayIndex];
        sceneHandle.setDronePose({ x: p.x, y: p.y, z: p.z }, 0);
        sceneHandle.appendTrajectory(p.x, p.z);
        replayIndex += 1;
      } else {
        replaying = false;
      }
    } else {
      const cmd = pollCommand();
      wind.step(dt);
      controller.applyWind(wind.currentVector());
      const snap = controller.update(cmd, dt);
      lastSnap = snap;
      session.record(toFlightSample(snap, simTime));
      simTime += dt;
      sceneHandle.setDronePose(snap.position, snap.headingDeg);
      sceneHandle.appendTrajectory(snap.position.x, snap.position.z);
      sceneHandle.setWindArrow(wind.currentVector());
      hud.setDrone(snap.position.x, snap.position.z, snap.headingDeg);
      hud.setMode(snap.mode as ExamHudMode);
      hud.setInputInfo(examInput.getInfo());
      updateWindChip();
      if (emergencyBannerUntil > 0 && performance.now() > emergencyBannerUntil) {
        emergencyBanner.style.display = 'none';
        emergencyBannerUntil = 0;
      }
    }
    updateCamera(lastSnap, dt);
    renderFlow();
    renderer.render(scene, camera);
    frameCount += 1;
  };
  renderFlow(true);
  updateWindChip();
  rafId = requestAnimationFrame(animate);

  return {
    dispose(): void {
      disposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pagehide', handlePageHide);
      stage.removeEventListener('wheel', onCameraWheel);
      canvas.removeEventListener('pointerdown', onCameraPointerDown);
      canvas.removeEventListener('pointermove', onCameraPointerMove);
      canvas.removeEventListener('pointerup', stopCameraDrag);
      canvas.removeEventListener('pointercancel', stopCameraDrag);
      delete (window as unknown as Record<string, unknown>).__examTestHook;
      examInput.dispose();
      unmountLink();
      groundPanel.dispose();
      hud.dispose();
      sceneHandle.dispose();
      renderer.dispose();
      root.innerHTML = '';
    },
  };
}
