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
              <h2>输电线路巡视</h2>
            </div>
          </div>
          <dl class="mission-facts">
            <div><dt>训练模式</dt><dd>指定巡检</dd></div>
            <div><dt>巡检目标</dt><dd>待装载</dd></div>
            <div><dt>任务进度</dt><dd>0 / 1</dd></div>
          </dl>
          <div class="phase-notice">
            <strong>P1-1</strong>
            <span>基础训练环境已就绪</span>
          </div>
        </aside>

        <section class="scene-panel" aria-label="三维训练场景">
          <div class="scene-toolbar">
            <div>
              <span class="toolbar-label">场景</span>
              <strong>输电线路 · 基础环境</strong>
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
          <div class="camera-standby" aria-label="相机待命">
            <div class="focus-frame" aria-hidden="true"></div>
            <span>CAMERA STANDBY</span>
          </div>
          <dl class="camera-readout">
            <div><dt>Yaw</dt><dd>0°</dd></div>
            <div><dt>Pitch</dt><dd>-30°</dd></div>
            <div><dt>Zoom</dt><dd>1.0×</dd></div>
          </dl>
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
            <li><span class="check-state">—</span><span>目标定位</span></li>
            <li><span class="check-state">—</span><span>安全距离</span></li>
            <li><span class="check-state">—</span><span>巡检取证</span></li>
          </ol>
        </aside>

        <aside class="panel calibration-anchor" data-calibration-anchor aria-label="遥控器标定"></aside>
      </section>

      <footer class="control-deck" aria-label="飞行操作区">
        <div class="control-group">
          <button type="button" data-action="arm">解锁</button>
          <button type="button" data-action="takeoff">起飞</button>
          <button type="button" data-action="hover">悬停</button>
          <button type="button" data-action="rtl">返航</button>
          <button type="button" data-action="land">降落</button>
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
    </main>
  `;

  const shell = root.querySelector<HTMLElement>('.training-shell');
  if (!shell) throw new Error('Training shell was not created.');
  return shell;
}

function addReferenceScene(scene: THREE.Scene): void {
  scene.background = new THREE.Color(0xcbd8d1);
  scene.fog = new THREE.Fog(0xcbd8d1, 35, 105);

  const hemisphere = new THREE.HemisphereLight(0xf5fff9, 0x4e5e4a, 2.2);
  scene.add(hemisphere);

  const sun = new THREE.DirectionalLight(0xfff1ce, 3.2);
  sun.position.set(18, 28, 12);
  sun.castShadow = true;
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshStandardMaterial({ color: 0x71856d, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(120, 60, 0x385845, 0x7e927b);
  grid.position.y = 0.015;
  scene.add(grid);

  const routeMaterial = new THREE.MeshStandardMaterial({ color: 0xe3b84f, roughness: 0.55 });
  const routeGeometry = new THREE.CylinderGeometry(0.12, 0.12, 0.7, 12);
  for (const [x, z] of [[-9, 4], [0, -2], [11, 3]] as Array<[number, number]>) {
    const marker = new THREE.Mesh(routeGeometry, routeMaterial);
    marker.position.set(x, 0.35, z);
    marker.castShadow = true;
    scene.add(marker);
  }

  const boundary = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-18, 0.04, -11),
      new THREE.Vector3(18, 0.04, -11),
      new THREE.Vector3(18, 0.04, 11),
      new THREE.Vector3(-18, 0.04, 11),
    ]),
    new THREE.LineBasicMaterial({ color: 0x3bd18a }),
  );
  scene.add(boundary);
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
  addReferenceScene(scene);

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

  const readout = {
    altitude: root.querySelector<HTMLElement>('[data-altitude]'),
    state: root.querySelector<HTMLElement>('[data-flight-state]'),
    mode: root.querySelector<HTMLElement>('[data-flight-mode]'),
    inputSource: root.querySelector<HTMLElement>('[data-input-source]'),
    x: root.querySelector<HTMLElement>('[data-position-x]'),
    y: root.querySelector<HTMLElement>('[data-position-y]'),
    z: root.querySelector<HTMLElement>('[data-position-z]'),
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
    flightController.rtl();
    updateReadout(flightController.snapshot());
  });
  root.querySelector<HTMLElement>('[data-action="land"]')?.addEventListener('click', () => {
    flightController.land();
    updateReadout(flightController.snapshot());
  });

  const render = (timestamp: number): void => {
    if (disposed) return;
    const deltaSeconds = Math.min(Math.max((timestamp - lastUpdate) / 1000, 0), 0.1);
    lastUpdate = timestamp;
    const input = pipeline.poll();
    const snapshot = flightController.update(input.command, deltaSeconds);
    droneEntity?.update(snapshot, deltaSeconds);
    updateReadout(snapshot);
    updateInputSource(input.source);

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
