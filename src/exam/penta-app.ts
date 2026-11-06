/**
 * 科目 E（高度保持五邊飛行）教學練習應用 — `?mode=penta` 獨立入口。
 *
 * 隔離性：
 *  - 不改既有考試模式（?mode=exam）、巡檢模式、飛控、RC 映射；
 *  - 不接正式評分：無 S/U/N、不呼叫 subjects.ts／scoring.ts、不產生成績單；
 *  - 場景自 src/exam/penta-scene.ts（獨立於 scene.ts 的考試場景）；
 *  - 訓練狀態機／偵測／記錄在 penta-training.ts（純函式），UI 在
 *    penta-training-ui.ts（只顯示不判定）；本檔只做接線與協調。
 *
 * 第四輪新增「教學練習」：READY → TAKEOFF → ENTER_ROUTE → SEGMENT_1..5 →
 * COMPLETE（另含 PAUSED／RESTARTED／ABORTED）；機體由考試機飛控
 * ExamFlightController 驅動（起飛目標 = 航線高度 20m，官方 p165），
 * 輸入沿用 ExamInput（搖桿標定生態＋鍵盤備援），本練習模式無風。
 *
 * 畫面固定標示「非官方測驗，僅供練習」；結果只能稱為「教學練習記錄」；
 * 航線與容差皆為項目教學假設（見
 * docs/handoff/SUBJECT-E-RULE-VERIFICATION-2026-10-25.md）。
 */

import * as THREE from 'three';
import { loadExamAircraftParams, loadExamConfig, validateSubjectEConfig } from './config';
import { buildExamField } from './field';
import { buildTeachingPentaRoute, pentaAirspaceForLevel, pentaFlightOrder } from './penta';
import { createPentaScene, type PentaSceneHandle } from './penta-scene';
import { ExamFlightController } from './flight-controller';
import { ExamInput } from './exam-input';
import { mountFloatingLinkPanel } from '../ui/link-panel';
import type { ExamStickCommand } from './types';
import {
  PENTA_PRACTICE_NOTE,
  buildPentaPracticeRecord,
  createPentaTrainingState,
  currentPentaTarget,
  detectPentaPosition,
  pentaAbort,
  pentaBegin,
  pentaIsActivePhase,
  pentaPause,
  pentaResume,
  pentaRestart,
  pentaStep,
  pentaTrainingView,
  targetLegIndexForPhase,
  type PentaTrainingSample,
  type PentaTrainingState,
  type PentaTrainingTolerances,
} from './penta-training';
import { PentaTrainingUI } from './penta-training-ui';

export interface AppHandle {
  dispose(): void;
}

function div(style: string): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = style;
  return el;
}

export function createPentaApp(root: HTMLElement): AppHandle {
  const config = loadExamConfig();
  const field = buildExamField(config);
  const subjectE = config.subjects.E;
  const validation = validateSubjectEConfig(subjectE);
  const altitudeM = subjectE.params.operationAltitudeM;
  const route = buildTeachingPentaRoute(field, altitudeM);
  const airspace = pentaAirspaceForLevel(config, config.level);

  // ---- 教學訓練（第四輪）：容差／飛控／輸入／狀態機 ----
  // 教學容差取自 config.simAssist.subjectE（模擬假設，非官方，可調），
  // 與官方 subjects.E.params 嚴格分離；判定邏輯全部在 penta-training.ts。
  const simE = config.simAssist.subjectE;
  const tolerances: PentaTrainingTolerances = {
    routeDeviationToleranceM: simE.routeDeviationToleranceM,
    altitudeToleranceM: simE.altitudeToleranceM,
    waypointReachRadiusM: simE.waypointReachRadiusM,
    minSegmentTimeS: simE.minSegmentTimeS,
    takeoffCompleteToleranceM: simE.takeoffCompleteToleranceM,
  };
  const aircraft = loadExamAircraftParams();
  const controller = new ExamFlightController(aircraft);
  const examInput = new ExamInput();
  void examInput.start();
  // 2026-11-07：左下角「🔗 連線方式」——原子筆鏡頭搖桿、手機遙控器
  const unmountLink = examInput.pen && examInput.phone ? mountFloatingLinkPanel(examInput.pen, examInput.phone, examInput.gesture ?? undefined) : () => undefined;
  /** 練習狀態機（不可變資料；轉換皆為純函式）。 */
  let training: PentaTrainingState = createPentaTrainingState();
  /** 最近一次訓練取樣（驅動 UI 與場景覆疊）。 */
  let lastSample: PentaTrainingSample | null = null;
  /** 最近一次飛控快照（測試接縫讀取）。 */
  let lastSnap: ReturnType<ExamFlightController['snapshot']> | null = null;
  /** 練習時鐘（秒）；僅訓練活動且未暫停時推進。 */
  let simTime = 0;
  /** 測試縫：腳本位姿（設定時飛控凍結，直接驅動位姿與狀態機）。 */
  let scriptedPose: { x: number; y: number; z: number; headingDeg: number } | null = null;
  /** 已為哪個終態顯示過結果浮層（同一 phase 只提示一次）。 */
  let resultShownFor: string | null = null;

  root.innerHTML = '';
  const wrap = div(
    'position:relative;width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;background:#0b1d2a;font:12px/1.5 sans-serif;color:#cfe;',
  );
  root.appendChild(wrap);

  // ---- 頂欄：標題 + 免責 + 合法性 ----
  const topBar = div(
    'flex:0 0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:6px 10px;background:rgba(8,18,28,0.94);border-bottom:1px solid #22415a;z-index:20;',
  );
  wrap.appendChild(topBar);

  const title = document.createElement('strong');
  title.textContent = `科目 E：${subjectE.name} — 教學預覽`;
  title.style.cssText = 'font-size:13px;color:#dfe;';
  topBar.appendChild(title);

  const disclaimer = document.createElement('span');
  disclaimer.textContent = '非官方測驗，僅供練習';
  disclaimer.dataset.pentaDisclaimer = 'true';
  disclaimer.style.cssText =
    'font-size:11px;padding:2px 10px;border-radius:10px;background:rgba(180,40,40,0.85);color:#fff;white-space:nowrap;';
  topBar.appendChild(disclaimer);

  const badge = document.createElement('span');
  badge.dataset.pentaStatus = validation.ok ? 'config-ok' : 'config-error';
  badge.textContent = validation.ok
    ? `官方數值已載入（p${subjectE.page ?? '—'}）· 航線為教學假設`
    : `配置驗證失敗：${validation.errors.join('；')}`;
  badge.style.cssText = validation.ok
    ? 'font-size:11px;padding:2px 8px;border-radius:8px;background:#22415a;color:#9ad0ff;white-space:nowrap;'
    : 'font-size:11px;padding:2px 8px;border-radius:8px;background:#7a2020;color:#ffd0d0;white-space:nowrap;';
  topBar.appendChild(badge);

  const playBtn = document.createElement('button');
  playBtn.dataset.pentaPlay = 'true';
  playBtn.textContent = '▶ 播放航線演示';
  playBtn.style.cssText =
    'margin-left:auto;font-size:11px;padding:3px 10px;border:1px solid #4a6a82;border-radius:6px;background:#123;color:#9ad0ff;cursor:pointer;';
  topBar.appendChild(playBtn);

  // ---- 訓練動作（只操作狀態機與飛控重置；判定全在 penta-training.ts）----
  function beginPractice(): void {
    if (training.phase !== 'READY') return;
    controller.arm();
    controller.takeoff(altitudeM); // 起飛目標 = 航線高度 20m（官方 p165）
    simTime = 0;
    training = pentaBegin(training, simTime);
    lastSample = null;
    resultShownFor = null;
    trainingUI.hideResult();
    playing = false; // 訓練開始後停止航線演示
    setPlayLabel();
  }

  function pausePractice(): void {
    training = pentaPause(training, simTime);
  }

  function resumePractice(): void {
    training = pentaResume(training, simTime);
  }

  function restartPractice(): void {
    if (training.phase === 'READY') return;
    training = pentaRestart(training, simTime); // RESTARTED：回 READY、清記錄、計次+1
    controller.reset(); // 機體重置回起降點
    simTime = 0;
    lastSample = null;
    lastSnap = null;
    resultShownFor = null;
    trainingUI.hideResult();
    if (!scriptedPose) {
      playing = true;
      setPlayLabel();
    }
  }

  function abortPractice(): void {
    if (!pentaIsActivePhase(training.phase)) return;
    training = pentaAbort(training, simTime, '使用者中止練習');
    // 空中則指令降落，讓起飛／降落程序走完（機體平安落地）。
    if (lastSnap && lastSnap.state === 'flying') controller.land();
    resultShownFor = training.phase;
    trainingUI.showResult(buildPentaPracticeRecord(training));
  }

  // ---- 訓練列 UI（第四輪；只顯示與派發事件，不判定、不碰飛控）----
  const trainingUI = new PentaTrainingUI({
    route,
    tolerances,
    disclaimerText: '非官方測驗，僅供練習',
    practiceNote: PENTA_PRACTICE_NOTE,
    onAction: (action) => {
      if (action === 'begin') beginPractice();
      else if (action === 'pause') pausePractice();
      else if (action === 'resume') resumePractice();
      else if (action === 'restart') restartPractice();
      else if (action === 'abort') abortPractice();
    },
  });
  wrap.appendChild(trainingUI.bar);

  // ---- 左側：官方條件與教學說明 ----
  const sidePanel = div(
    'position:absolute;left:10px;top:44px;width:min(360px,calc(100vw - 20px));padding:8px 10px;background:rgba(4,12,18,0.92);border:1px solid #22415a;border-radius:6px;z-index:10;max-height:calc(100% - 60px);overflow:auto;',
  );
  wrap.appendChild(sidePanel);

  const h3 = (text: string): HTMLHeadingElement => {
    const el = document.createElement('h3');
    el.textContent = text;
    el.style.cssText = 'margin:6px 0 4px;font-size:12px;color:#9ad0ff;';
    return el;
  };
  const para = (text: string, color = '#cfe'): HTMLParagraphElement => {
    const el = document.createElement('p');
    el.textContent = text;
    el.style.cssText = `margin:2px 0;font-size:11px;color:${color};white-space:pre-wrap;`;
    return el;
  };

  sidePanel.appendChild(h3('官方條件（AC 107-005D p165）'));
  const ol = document.createElement('ol');
  ol.style.cssText = 'margin:2px 0 2px 18px;padding:0;font-size:11px;color:#dfe;';
  for (const c of subjectE.criteria) {
    const li = document.createElement('li');
    li.textContent = c;
    li.style.cssText = 'margin:2px 0;';
    ol.appendChild(li);
  }
  sidePanel.appendChild(ol);
  sidePanel.appendChild(para(`操作高度 ${altitudeM} m（官方）· 級距 ${config.level} 最小空域 ${airspace ? `${airspace.lengthM}×${airspace.widthM} m` : '未設定'}（官方）`));
  sidePanel.appendChild(h3('教學假設（非官方）'));
  sidePanel.appendChild(para(route.note, '#ffd28a'));
  sidePanel.appendChild(h3('操作說明'));
  sidePanel.appendChild(para('拖曳：環繞視角／滾輪：縮放／R：重置視角／空白鍵：播放或暫停演示。'));
  sidePanel.appendChild(
    para(
      '開始練習後：W/S 前後、A/D 左右、Q/E 轉向、R/F 升降（鍵盤備援；放開操縱後定位模式自動保持位置）。' +
        '暫停會凍結機體與練習計時；重新開始將機體重置回起降點；中止後機體自動降落。',
    ),
  );
  sidePanel.appendChild(
    para(
      '本練習為教學模擬：無風、航線與容差皆為教學假設；不進行評分，結果僅為「教學練習記錄」，不進入附錄5 成績單。',
      '#8fa8b8',
    ),
  );

  // ---- 舞台 ----
  const stage = div('position:relative;flex:1 1 auto;min-height:0;');
  wrap.appendChild(stage);
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%;';
  stage.appendChild(canvas);

  // preserveDrawingBuffer：讓測試/截圖可在渲染後讀取 framebuffer（教學預覽可接受此代價）。
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1d2a);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1000);
  const pentaHandle: PentaSceneHandle = createPentaScene(scene, field, route, { airspace, altitudeM });
  // 教學練習結果浮層（absolute；覆蓋舞台但不遮頂欄免責）。
  stage.appendChild(trainingUI.overlay);

  // 簡易環繞相機（自實現，避免引入 three examples 依賴）。
  const camTarget = new THREE.Vector3(0, 8, -12);
  let camRadius = 46;
  let camYaw = Math.PI; // 從 H 後方看向八字
  let camPitch = 0.62;
  const applyCamera = (): void => {
    const y = camTarget.y + camRadius * Math.sin(camPitch);
    const r = camRadius * Math.cos(camPitch);
    camera.position.set(camTarget.x + r * Math.sin(camYaw), y, camTarget.z + r * Math.cos(camYaw));
    camera.lookAt(camTarget);
  };
  applyCamera();

  const resize = (): void => {
    const w = stage.clientWidth || 800;
    const h = stage.clientHeight || 600;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const onPointerDown = (e: PointerEvent): void => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (!dragging) return;
    camYaw -= (e.clientX - lastX) * 0.008;
    camPitch = Math.min(1.45, Math.max(0.12, camPitch + (e.clientY - lastY) * 0.006));
    lastX = e.clientX;
    lastY = e.clientY;
    applyCamera();
  };
  const onPointerUp = (e: PointerEvent): void => {
    dragging = false;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    camRadius = Math.min(120, Math.max(12, camRadius * (1 + e.deltaY * 0.001)));
    applyCamera();
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  const resetCamera = (): void => {
    camRadius = 46;
    camYaw = Math.PI;
    camPitch = 0.62;
    applyCamera();
  };

  // ---- 航線演示（機體沿教學假設航線勻速巡遊，循環） ----
  const seq = pentaFlightOrder(route);
  let playing = true;
  let demoT = 0; // 沿序列的位置（浮點索引）
  const demoSpeed = 0.12; // 航段/秒
  const setPlayLabel = (): void => {
    playBtn.textContent = playing ? '⏸ 暫停演示' : '▶ 播放航線演示';
  };
  setPlayLabel();
  playBtn.addEventListener('click', () => {
    playing = !playing;
    setPlayLabel();
  });
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Space') {
      e.preventDefault();
      // 訓練進行中空白鍵不切換演示（此時演示已停止）。
      if (training.phase === 'READY') {
        playing = !playing;
        setPlayLabel();
      }
    } else if (e.code === 'KeyR') {
      resetCamera();
    }
  };
  window.addEventListener('keydown', onKeyDown);

  const demoPos = new THREE.Vector3();
  const demoAim = new THREE.Vector3();
  const updateDemo = (dt: number): void => {
    // 訓練進行中／腳本位姿模式下不播放演示（演示僅供 READY 預覽航線）。
    if (!playing || scriptedPose || training.phase !== 'READY') return;
    demoT += demoSpeed * dt;
    if (demoT >= seq.length - 1) demoT = 0;
    const i = Math.min(Math.floor(demoT), seq.length - 2);
    const f = demoT - i;
    const a = seq[i];
    const b = seq[i + 1];
    demoPos.set(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f);
    demoAim.set(b.x, b.y, b.z);
    // heading：0 = 朝 −Z；atan2 以世界 X/Z 換算。
    const dx = demoAim.x - demoPos.x;
    const dz = demoAim.z - demoPos.z;
    const headingDeg = (Math.atan2(-dx, -dz) * 180) / Math.PI;
    pentaHandle.setDronePose(demoPos, headingDeg);
  };
  // 初始位姿置於 H 上方。
  pentaHandle.setDronePose({ x: 0, y: altitudeM, z: 0 }, 0);

  // ---- 教學訓練每幀推進（第四輪）----
  /** 搖桿指令（來源：標定管線或鍵盤備援；與考試模式同一套輸入，不改映射）。 */
  const pollCommand = (): ExamStickCommand => {
    const result = examInput.tick();
    const c = result.command;
    return { roll: c.roll, pitch: c.pitch, yaw: c.yaw, throttle: c.throttle };
  };

  /** 場景訓練覆疊（目前目標高亮／已達航點／偏離連線；純視覺，不判定）。 */
  const syncTrainingOverlay = (): void => {
    if (training.phase === 'READY') {
      pentaHandle.setTrainingView(null);
      return;
    }
    let deviationFrom: { x: number; y: number; z: number } | null = null;
    let deviationTo: { x: number; y: number; z: number } | null = null;
    if (lastSample) {
      const target = currentPentaTarget(training);
      if (target) {
        const d = detectPentaPosition(route, lastSample, target);
        // 超出教學容差才畫偏離連線（與 UI 提示同一口徑）。
        if (d.routeDeviationM > tolerances.routeDeviationToleranceM) {
          deviationFrom = { x: lastSample.x, y: lastSample.y, z: lastSample.z };
          deviationTo = { x: d.closest.x, y: route.altitudeM, z: d.closest.z };
        }
      }
    }
    pentaHandle.setTrainingView({
      entry: training.phase === 'ENTER_ROUTE',
      legIndex: targetLegIndexForPhase(training.phase),
      reachedWaypoints: training.reachedWaypoints,
      deviationFrom,
      deviationTo,
    });
  };

  /**
   * 每幀推進訓練狀態機（READY／暫停時不推進）。
   *  - 真實模式：飛控快照 → 取樣 → pentaStep → 機體位姿；
   *  - 腳本模式（測試縫）：腳本位姿直接驅動取樣與狀態機（飛控凍結）；
   *  - 暫停：機體與練習計時皆凍結。
   */
  const updateTraining = (dt: number): void => {
    const running = pentaIsActivePhase(training.phase) && !training.paused;
    if (running) simTime += dt;

    if (scriptedPose) {
      lastSample = {
        t: simTime,
        x: scriptedPose.x,
        y: scriptedPose.y,
        z: scriptedPose.z,
        headingDeg: scriptedPose.headingDeg,
      };
      pentaHandle.setDronePose(scriptedPose, scriptedPose.headingDeg);
      if (running) training = pentaStep(training, lastSample, route, tolerances);
    } else if (running) {
      const snap = controller.update(pollCommand(), dt);
      lastSnap = snap;
      lastSample = {
        t: simTime,
        x: snap.position.x,
        y: snap.position.y,
        z: snap.position.z,
        headingDeg: snap.headingDeg,
      };
      pentaHandle.setDronePose(snap.position, snap.headingDeg);
      training = pentaStep(training, lastSample, route, tolerances);
      // 機體降落（練習中落地）→ 自動中止。
      if (snap.state === 'landed' && pentaIsActivePhase(training.phase)) {
        training = pentaAbort(training, simTime, '機體已降落，練習自動中止');
      }
    } else if (controller.isLanding() || controller.isTakingOff()) {
      // 中止後讓起飛／降落程序走完（機體平安落地再凍結）。
      const snap = controller.update(pollCommand(), dt);
      lastSnap = snap;
      pentaHandle.setDronePose(snap.position, snap.headingDeg);
    }

    // 完成／中止 → 顯示教學練習記錄（同一終態只提示一次）。
    if (resultShownFor === null && (training.phase === 'COMPLETE' || training.phase === 'ABORTED')) {
      resultShownFor = training.phase;
      trainingUI.showResult(buildPentaPracticeRecord(training));
    }
    syncTrainingOverlay();
    trainingUI.update(pentaTrainingView(training, route, lastSample, tolerances));
  };

  // ---- 測試鉤子（只讀狀態＋腳本位姿縫；不影響功能）----
  const testHook = {
    getFrames: () => frameCount,
    getTrainingState: () => ({
      phase: training.phase,
      paused: training.paused,
      segments: training.segments.map((s) => ({ ...s })),
      reachedWaypoints: [...training.reachedWaypoints],
      restartCount: training.restartCount,
      maxAltitudeDeviationM: training.maxAltitudeDeviationM,
      maxRouteDeviationM: training.maxRouteDeviationM,
      startedAtT: training.startedAtT,
      endedAtT: training.endedAtT,
      abortReason: training.abortReason,
      transitions: training.transitions.map((tr) => ({ ...tr })),
    }),
    getTrainingView: () => pentaTrainingView(training, route, lastSample, tolerances),
    getPracticeRecord: () => buildPentaPracticeRecord(training),
    getFlight: () => ({
      state: lastSnap?.state ?? 'idle',
      x: lastSnap?.position.x ?? 0,
      y: lastSnap?.position.y ?? 0,
      z: lastSnap?.position.z ?? 0,
      headingDeg: lastSnap?.headingDeg ?? 0,
    }),
    getTolerances: () => ({ ...tolerances }),
    setScriptedPose: (x: number, y: number, z: number, headingDeg = 0): void => {
      scriptedPose = { x, y, z, headingDeg };
      lastSample = { t: simTime, x, y, z, headingDeg };
    },
    clearScriptedPose: (): void => {
      scriptedPose = null;
    },
    isScriptedPose: (): boolean => scriptedPose !== null,
  };
  (window as unknown as Record<string, unknown>).__pentaTestHook = testHook;

  const handlePageHide = (event: PageTransitionEvent): void => {
    if (!event.persisted) renderer.forceContextLoss();
  };
  window.addEventListener('pagehide', handlePageHide);

  let rafId = 0;
  let lastTs = 0;
  let frameCount = 0;
  const animate = (ts: number): void => {
    rafId = requestAnimationFrame(animate);
    const dt = lastTs === 0 ? 0.016 : Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    updateTraining(dt);
    updateDemo(dt);
    renderer.render(scene, camera);
    frameCount += 1;
  };
  rafId = requestAnimationFrame(animate);

  return {
    dispose(): void {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pagehide', handlePageHide);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      delete (window as unknown as Record<string, unknown>).__pentaTestHook;
      examInput.dispose();
      unmountLink();
      trainingUI.dispose();
      pentaHandle.dispose();
      renderer.dispose();
      root.innerHTML = '';
    },
  };
}
