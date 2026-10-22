/**
 * 考試模式主程式（CAA 專業基本級術科考場模擬）。
 *
 * 組裝：考場場景(3D) + 考試機飛控(雙模式/慣性) + 風場 + 即時面板(HUD) +
 * 會話錄製 + 成績單(仿附錄5) + 航跡回放。
 *
 * 本模組為「考試機獨立疊加」：不動既有巡檢任務、搖桿映射、標定檔、飛控航向
 * 修正；僅在此模式下掛載考試機飛控與考場場景。
 *
 * 考試模式（examMode=true，預設）下引導強制關閉（不得提供飛行輔助）。
 */

import * as THREE from 'three';
import { zhHant as L } from '../i18n/zh-Hant';
import { loadExamConfig, loadExamAircraftParams } from './config';
import { buildExamField } from './field';
import { createExamScene, type ExamSceneHandle } from './scene';
import { ExamFlightController } from './flight-controller';
import { WindField } from './wind';
import { ExamHud, type ExamHudMode } from './panel';
import { ExamSession, type TrajectoryPoint } from './session';
import { ExamInput } from './exam-input';
import type { FlightSample } from './subjects';
import type { ExamStickCommand, ExamFlightSnapshot } from './types';

/** 純函式：飛控快照 → 考試錄製樣本（供科目判定與重大違失偵測）。可單元測試。 */
export function toFlightSample(snapshot: ExamFlightSnapshot, t: number): FlightSample {
  return {
    t,
    x: snapshot.position.x,
    y: snapshot.position.y,
    z: snapshot.position.z,
    headingDeg: snapshot.headingDeg,
    speedMps: snapshot.horizontalSpeedMps,
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

export function createExamApp(root: HTMLElement, options: CreateExamAppOptions = {}): AppHandle {
  const examMode = options.examMode ?? true;
  const config = loadExamConfig();
  const field = buildExamField(config);
  const aircraft = loadExamAircraftParams();

  const controller = new ExamFlightController(aircraft);
  const wind = new WindField(config);
  const session = new ExamSession();

  // ---- DOM 佈局 ----
  root.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;background:#0b1d2a;';
  root.appendChild(wrap);

  const topDisclaimer = document.createElement('div');
  topDisclaimer.textContent = L.exam.topDisclaimer;
  topDisclaimer.style.cssText =
    'position:absolute;top:8px;left:50%;transform:translateX(-50%);background:rgba(180,40,40,0.85);color:#fff;padding:4px 12px;border-radius:12px;font:12px sans-serif;z-index:5;';
  wrap.appendChild(topDisclaimer);

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%;';
  wrap.appendChild(canvas);

  const controls = document.createElement('div');
  controls.textContent = L.exam.controlsHint;
  controls.style.cssText =
    'position:absolute;bottom:6px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.5);color:#cfe;padding:3px 10px;border-radius:8px;font:11px sans-serif;white-space:nowrap;z-index:5;';
  wrap.appendChild(controls);

  const safety = document.createElement('div');
  safety.style.cssText =
    'position:absolute;top:8px;left:8px;background:rgba(220,120,0,0.9);color:#fff;padding:4px 10px;border-radius:8px;font:12px sans-serif;z-index:5;display:none;max-width:60%;';
  wrap.appendChild(safety);

  // 面板（HUD）掛載於右上。
  const hudHost = document.createElement('div');
  hudHost.style.cssText = 'position:absolute;top:8px;right:8px;z-index:5;';
  wrap.appendChild(hudHost);
  const hud = new ExamHud(field, hudHost);
  hud.setExamMode(examMode);

  // 成績單面板（預設隱藏）。
  const reportHost = document.createElement('div');
  reportHost.style.cssText =
    'position:absolute;inset:0;background:rgba(8,18,28,0.92);color:#fff;overflow:auto;padding:24px;display:none;z-index:10;font:13px/1.5 sans-serif;';
  wrap.appendChild(reportHost);

  // ---- Three.js ----
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
  camera.position.set(0, 34, 46);
  camera.lookAt(0, 0, -10);

  const sceneHandle: ExamSceneHandle = createExamScene(scene, field);

  const resize = (): void => {
    const w = wrap.clientWidth || 800;
    const h = wrap.clientHeight || 600;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  // ---- 輸入：既有輸入管線（搖桿標定 → InputNormalizer → ChannelMapper；鍵盤備援）----
  // 不另寫映射、不改標定檔：複用 PilotInputPipeline、GamepadInputAdapter、
  // KeyboardInputAdapter 與 ProfileStore；有搖桿就用搖桿，否則回退鍵盤。
  const examInput = new ExamInput();
  void examInput.start();

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    const code = e.code;
    if (code === 'Digit1') controller.setMode('manual');
    else if (code === 'Digit2') controller.setMode('attitude');
    else if (code === 'Digit3') controller.setMode('position');
    else if (code === 'KeyT') {
      controller.arm();
      controller.takeoff(1.5);
    } else if (code === 'KeyL') controller.land();
    else if (code === 'KeyG') examInput.togglePreference();
    else if (code === 'Enter') finish();
    else if (code === 'Escape') restart();
  };
  window.addEventListener('keydown', onKeyDown);

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
    sceneHandle.clearTrajectory();
    reportHost.style.display = 'none';
    simTime = 0;
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
    renderReport(result.report);
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
        return `<tr>
          <td>${label}</td>
          <td style="text-align:center">${m.detected ? '是' : '否'}</td>
          <td style="opacity:.7">${m.detail}</td>
        </tr>`;
      })
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
        <div style="margin:12px 0;font-size:15px;font-weight:bold">${overall}</div>
        <div style="opacity:.8">${L.exam.report.officialStandard}：${report.officialPassStandard}</div>
        <div style="margin-top:16px;display:flex;gap:8px">
          <button id="exam-replay" style="padding:6px 14px">${L.exam.report.replay}</button>
          <button id="exam-restart" style="padding:6px 14px">${L.exam.report.restart}</button>
        </div>
      </div>`;
    reportHost.style.display = 'block';
    reportHost.querySelector<HTMLButtonElement>('#exam-replay')?.addEventListener('click', () => {
      reportHost.style.display = 'none';
      startReplay();
    });
    reportHost.querySelector<HTMLButtonElement>('#exam-restart')?.addEventListener('click', () => {
      restart();
    });
  };

  const updateSafety = (): void => {
    if (wind.needsSafetyDeclaration()) {
      safety.style.display = 'block';
      safety.textContent = `${L.exam.panel.safety}：${config.wind.declarationText}`;
    } else {
      safety.style.display = 'none';
    }
  };

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
      session.record(toFlightSample(snap, simTime));
      simTime += dt;
      sceneHandle.setDronePose(snap.position, snap.headingDeg);
      sceneHandle.appendTrajectory(snap.position.x, snap.position.z);
      sceneHandle.setWindArrow(wind.currentVector());
      hud.setDrone(snap.position.x, snap.position.z, snap.headingDeg);
      hud.setMode(snap.mode as ExamHudMode);
      hud.setInputInfo(examInput.getInfo());
      updateSafety();
    }
    renderer.render(scene, camera);
  };
  rafId = requestAnimationFrame(animate);

  return {
    dispose(): void {
      disposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKeyDown);
      examInput.dispose();
      hud.dispose();
      sceneHandle.dispose();
      renderer.dispose();
      root.innerHTML = '';
    },
  };
}
