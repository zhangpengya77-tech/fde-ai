import * as THREE from 'three';

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
              <span>X 0.0</span><span>Y 0.0</span><span>Z 0.0</span>
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
            <div><span>高度</span><strong>0.0 <small>m</small></strong></div>
            <div><span>速度</span><strong>0.0 <small>m/s</small></strong></div>
            <div><span>航向</span><strong>000 <small>°</small></strong></div>
            <div><span>模式</span><strong>待机</strong></div>
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
      </section>

      <footer class="control-deck" aria-label="飞行操作区">
        <div class="control-group">
          <button type="button" disabled>解锁</button>
          <button type="button" disabled>起飞</button>
          <button type="button" disabled>悬停</button>
          <button type="button" disabled>返航</button>
          <button type="button" disabled>降落</button>
        </div>
        <div class="phase-status">
          <span>飞行控制器</span>
          <strong>下一阶段接入</strong>
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
  let disposed = false;

  const render = (timestamp: number): void => {
    if (disposed) return;
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
