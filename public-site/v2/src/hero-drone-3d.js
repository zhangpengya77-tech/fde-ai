// 2026-11-05：首頁右側「科技感透明 F450」3D 動態展示（方案 A：Three.js + 既有 F450 數位孿生 GLB）
// - 直接載入 /f450-twin/ 的 L2-R4 組裝模型（四片螺旋槳、馬達、機臂、Pixhawk、GPS、電池都是獨立零件）
// - 只改「材質外觀」成透明玻璃＋藍色發光，不重畫簡化幾何機體
// - 四片螺旋槳各自繞自己的馬達軸旋轉（X 型四旋翼：右前／左後 逆時針，左前／右後 順時針，相鄰相反）
// - 整機只做輕微上下浮動與小幅姿態擺動，不旋轉整張圖
// - 低階裝置降為 30fps、尊重 prefers-reduced-motion、離開畫面或分頁隱藏時暫停
// - 任何一步失敗（無 WebGL、模型載入失敗）都改顯示靜態備援圖，不影響首頁其他功能
import * as THREE from 'three';
import { GLTFLoader } from '../f450-twin/vendor/three/addons/loaders/GLTFLoader.js';

// GitHub 頁面版：模型路徑相對於本模組檔計算
const MODEL_URL = new URL('../f450-twin/models/f450-l2-r4-preview-assembly.glb', import.meta.url).href;
const FALLBACK_URL = './src/assets/hero-drone-fallback.jpg';

const stage = document.querySelector('.drone-stage');

// 顯示靜態備援圖（載入失敗或不支援 WebGL 時）
function showFallback(reason) {
  if (!stage || stage.classList.contains('drone-3d-fallback')) return;
  console.warn('[hero-drone-3d] 改用靜態備援圖：', reason);
  stage.classList.remove('drone-3d-ready');
  stage.classList.add('drone-3d-fallback');
  if (!stage.querySelector('.hero-drone-fallback')) {
    const img = new Image();
    img.className = 'hero-drone-fallback';
    img.alt = 'F450 四旋翼科技展示靜態圖';
    img.decoding = 'async';
    img.src = FALLBACK_URL;
    stage.appendChild(img);
  }
}

// 用 canvas 畫一張徑向漸層貼圖（LED 光暈、槳盤殘影共用）
function radialTexture(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  stops.forEach(([p, col]) => grad.addColorStop(p, col));
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 全息底環貼圖：同心圓、刻度、內圈光暈
function holoRingTexture() {
  const S = 512, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d'), m = S / 2;
  const glow = g.createRadialGradient(m, m, 0, m, m, m);
  glow.addColorStop(0, 'rgba(0,170,255,0.20)');
  glow.addColorStop(0.55, 'rgba(0,140,255,0.06)');
  glow.addColorStop(1, 'rgba(0,120,255,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(90,210,255,0.85)';
  [[0.96, 3], [0.88, 1.2], [0.62, 2], [0.4, 1]].forEach(([r, w]) => {
    g.lineWidth = w; g.beginPath(); g.arc(m, m, m * r, 0, Math.PI * 2); g.stroke();
  });
  // 外圈刻度
  for (let i = 0; i < 120; i += 1) {
    const a = (i / 120) * Math.PI * 2, long = i % 10 === 0;
    const r1 = m * 0.89, r2 = m * (long ? 0.95 : 0.92);
    g.lineWidth = long ? 2 : 1;
    g.beginPath(); g.moveTo(m + Math.cos(a) * r1, m + Math.sin(a) * r1); g.lineTo(m + Math.cos(a) * r2, m + Math.sin(a) * r2); g.stroke();
  }
  // 內圈三段弧（旋轉時才看得出在轉）
  g.lineWidth = 4; g.strokeStyle = 'rgba(120,225,255,0.9)';
  for (let k = 0; k < 3; k += 1) { g.beginPath(); g.arc(m, m, m * 0.75, k * 2.094, k * 2.094 + 0.9); g.stroke(); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 依零件名稱給材質。2026-11-06 依使用者參考圖（docs/design-reference/hero-drone-style-reference.jpg）改風格：
// 透明壓克力機身、銅橘色結構線、青色發光馬達、白灰槳葉；機型維持四旋翼 F450（參考圖為多旋翼概念圖）
function styleFor(name) {
  const n = String(name).replace(/_/g, ' ').toLowerCase();
  const glass = { transparent: true, depthWrite: false, side: THREE.DoubleSide, metalness: 0.15, roughness: 0.06 };
  if (n.includes('latticearm')) {
    // 機臂：透明壓克力＋銅橘色輪廓（對應參考圖機臂內的橘色結構）
    return { mat: { ...glass, color: 0xe6f8ff, emissive: 0x0a5a7a, emissiveIntensity: 0.22, opacity: 0.3 }, edge: 0xffa04a, edgeOpacity: 0.75 };
  }
  if (n.includes('motor')) {
    // 馬達：青色發光半透明外殼
    return { mat: { ...glass, depthWrite: true, color: 0x7fe6ff, emissive: 0x16c8ff, emissiveIntensity: 0.95, opacity: 0.78 }, edge: 0xc8f6ff, edgeOpacity: 0.55 };
  }
  if (n.includes('pixhawk flightcontroller')) {
    return { mat: { ...glass, depthWrite: true, color: 0x0c1a26, emissive: 0x0b5f95, emissiveIntensity: 0.55, opacity: 0.85 }, edge: 0x7fe9ff, edgeOpacity: 0.9 };
  }
  if (n.includes('gps arrow')) {
    return { mat: { color: 0xffffff, emissive: 0x9fe9ff, emissiveIntensity: 0.9 }, edge: null };
  }
  if (n.includes('gps compass')) {
    return { mat: { ...glass, color: 0xdff6ff, emissive: 0x0d7fb0, emissiveIntensity: 0.45, opacity: 0.45 }, edge: 0xa8f0ff, edgeOpacity: 0.8 };
  }
  if (n.includes('battery')) {
    return { mat: { ...glass, color: 0x9fdcff, emissive: 0x0b6aa0, emissiveIntensity: 0.5, opacity: 0.38 }, edge: 0x8fe6ff, edgeOpacity: 0.65 };
  }
  if (n.includes('esc')) {
    // 電調：銅橘色（對應參考圖的橘色線條）
    return { mat: { ...glass, depthWrite: true, color: 0xff9a3c, emissive: 0xc05a10, emissiveIntensity: 0.45, metalness: 0.6, roughness: 0.3, opacity: 0.85 }, edge: null };
  }
  if (n.includes('gold edge')) {
    return { mat: { ...glass, color: 0xffb066, emissive: 0xc06010, emissiveIntensity: 0.5, opacity: 0.8 }, edge: 0xffa04a, edgeOpacity: 0.8 };
  }
  if (n.includes('centre plate') || n.includes('powermodule') || n.includes('foam') || n.includes('gps mast')) {
    return { mat: { ...glass, color: 0xd6f2ff, emissive: 0x0a3a55, emissiveIntensity: 0.35, opacity: 0.26 }, edge: 0x9fe9ff, edgeOpacity: 0.6 };
  }
  if (n.includes('landing leg')) {
    // 腳架：透明並帶青光（參考圖腳架下緣發青光）
    return { mat: { ...glass, color: 0xbff0ff, emissive: 0x13b6e6, emissiveIntensity: 0.55, opacity: 0.42 }, edge: 0x9ff0ff, edgeOpacity: 0.6 };
  }
  // 線束、束帶、膠帶等小件：低調透明
  return { mat: { ...glass, color: 0x9fb8c8, emissive: 0x06283c, emissiveIntensity: 0.3, opacity: 0.35 }, edge: null };
}

async function init() {
  if (!stage) return;
  // 尊重系統「減少動態效果」；驗收時可加 ?motion=1 強制播放（例如 Windows 關閉了動畫效果的電腦）
  const forceMotion = new URLSearchParams(window.location.search).get('motion') === '1';
  const systemQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduceMotionQuery = forceMotion ? { matches: false, addEventListener: null } : systemQuery;

  // 低階裝置判斷：核心數少、記憶體小或觸控為主 → 30fps、像素比上限 1.5
  const lowEnd = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4 || window.matchMedia('(pointer: coarse)').matches;
  let maxPixelRatio = lowEnd ? 1.5 : 2;
  const frameInterval = lowEnd ? 1000 / 30 : 0;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch (error) {
    showFallback('瀏覽器不支援 WebGL');
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio));
  renderer.setClearColor(0x000000, 0); // 透明背景，露出 CSS 深藍底
  const canvas = renderer.domElement;
  canvas.className = 'hero-drone-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); showFallback('WebGL context lost'); });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 10, 6000);

  // 燈光：冷色環境光＋主光＋兩盞藍色補光
  scene.add(new THREE.HemisphereLight(0xbfefff, 0x02080f, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.8); key.position.set(300, 600, -400); scene.add(key);
  const rimA = new THREE.PointLight(0x22d3ff, 2.4, 0, 0); rimA.position.set(-450, 120, 300); scene.add(rimA);
  const rimB = new THREE.PointLight(0x18b8ff, 1.6, 0, 0); rimB.position.set(450, -120, 250); scene.add(rimB);

  const drone = new THREE.Group(); // 只用來做浮動與擺動
  scene.add(drone);

  // ── 載入 GLB ──
  let gltf;
  try {
    gltf = await new GLTFLoader().loadAsync(MODEL_URL);
  } catch (error) {
    renderer.dispose();
    showFallback('模型載入失敗');
    return;
  }

  const model = gltf.scene;
  const propellers = [];
  const motorCenters = {};
  const meshesToStyle = [];
  model.traverse((node) => { if (node.isMesh) meshesToStyle.push(node); });

  meshesToStyle.forEach((mesh) => {
    const name = mesh.name || mesh.parent?.name || '';
    const label = String(name).replace(/_/g, ' ');
    const propMatch = label.match(/propeller\s+(FL|FR|RL|RR)/i);
    const motorMatch = label.match(/motor\s+(FL|FR|RL|RR)/i);
    mesh.geometry.computeBoundingBox();

    if (motorMatch) {
      const c = mesh.geometry.boundingBox.getCenter(new THREE.Vector3()).add(mesh.position);
      motorCenters[motorMatch[1].toUpperCase()] = c;
    }

    if (propMatch) {
      // 螺旋槳：把幾何移到自己的中心，外面套一個樞軸，讓它繞自己的馬達軸轉
      const pos = propMatch[1].toUpperCase();
      const center = mesh.geometry.boundingBox.getCenter(new THREE.Vector3());
      const geometry = mesh.geometry.clone();
      geometry.translate(-center.x, -center.y, -center.z);
      const pivot = new THREE.Group();
      pivot.position.copy(center).add(mesh.position);
      geometry.computeBoundingBox();
      const propSize = geometry.boundingBox.getSize(new THREE.Vector3());
      const radius = Math.max(propSize.x, propSize.z) / 2; // 槳葉半徑（槳盤大小用）
      // 右前／左後 逆時針（+1），左前／右後 順時針（-1）→ 相鄰兩槳旋向相反
      const dir = pos === 'FR' || pos === 'RL' ? 1 : -1;
      // 槳葉：參考圖的白灰色槳
      const blade = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xe4eaee, emissive: 0x2a3a44, emissiveIntensity: 0.25, transparent: true, opacity: 0.95, roughness: 0.42, metalness: 0.15, side: THREE.DoubleSide }));
      pivot.add(blade);
      // 輕微動態模糊：兩片同形狀、透明度遞減的殘影跟在槳葉後方
      [0.2, 0.4].forEach((lag, i) => {
        const ghost = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xdfe8ee, transparent: true, opacity: i === 0 ? 0.22 : 0.1, side: THREE.DoubleSide, depthWrite: false }));
        ghost.rotation.y = -dir * lag;
        pivot.add(ghost);
      });
      // 很淡的槳盤（旋轉面），讓高速感更自然
      const disc = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.98, 48), new THREE.MeshBasicMaterial({ map: radialTexture([[0, 'rgba(220,240,250,0.0)'], [0.25, 'rgba(220,240,250,0.08)'], [0.85, 'rgba(220,240,250,0.14)'], [1, 'rgba(220,240,250,0)']]), transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      disc.rotation.x = -Math.PI / 2;
      // 圓盤不跟著槳葉轉，放在樞軸外的同一位置
      const discHolder = new THREE.Group();
      discHolder.position.copy(pivot.position);
      discHolder.add(disc);
      // 銅色馬達軸（參考圖馬達上方的銅色軸），不旋轉
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 16, 12), new THREE.MeshStandardMaterial({ color: 0xd98a3a, metalness: 0.85, roughness: 0.25, emissive: 0x5a2a08, emissiveIntensity: 0.4 }));
      shaft.position.y = -6;
      discHolder.add(shaft);
      // 透明槳護圈（參考圖每個槳外圍的透明圓環），固定不轉
      const guard = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.07, 1.8, 8, 96), new THREE.MeshStandardMaterial({ color: 0xeaf9ff, emissive: 0x1aa8d8, emissiveIntensity: 0.35, transparent: true, opacity: 0.55, roughness: 0.05, metalness: 0.2, depthWrite: false }));
      guard.rotation.x = Math.PI / 2;
      guard.position.y = -4;
      discHolder.add(guard);
      drone.add(pivot, discHolder);
      // 每顆馬達轉速略有差異，看起來比較真實
      propellers.push({ pivot, dir, speed: 24 + Math.random() * 2.5, phase: Math.random() * Math.PI });
      mesh.parent?.remove(mesh);
      return;
    }

    // 其他零件：換成透明科技材質＋藍色輪廓線
    const style = styleFor(name);
    const oldMaterial = mesh.material;
    mesh.material = new THREE.MeshStandardMaterial(style.mat);
    (Array.isArray(oldMaterial) ? oldMaterial : [oldMaterial]).forEach((m) => m?.dispose?.());
    if (style.edge) {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 28), new THREE.LineBasicMaterial({ color: style.edge, transparent: true, opacity: style.edgeOpacity, depthWrite: false, blending: THREE.AdditiveBlending }));
      mesh.add(edges);
    }
  });
  drone.add(model);

  // ── 藍色 LED：四個機臂末端下方＋飛控上方一顆狀態燈 ──
  const glowTex = radialTexture([[0, 'rgba(225,250,255,1)'], [0.18, 'rgba(60,215,255,0.9)'], [0.5, 'rgba(0,170,240,0.28)'], [1, 'rgba(0,140,255,0)']]);
  const leds = [];
  const addLed = (position, size) => {
    const core = new THREE.Mesh(new THREE.SphereGeometry(size * 0.12, 12, 8), new THREE.MeshBasicMaterial({ color: 0xbfe8ff }));
    core.position.copy(position);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85 }));
    glow.scale.set(size, size, 1);
    glow.position.copy(position);
    drone.add(core, glow);
    leds.push({ glow, size, offset: leds.length * 0.9 });
  };
  Object.values(motorCenters).forEach((c) => addLed(new THREE.Vector3(c.x, 8, c.z), 95));
  addLed(new THREE.Vector3(0, 30, 6), 120);   // 機身內部的藍光（參考圖透明機身中的藍色光源）
  // 透明座艙罩：罩住飛控，呈現參考圖的透明機身外殼
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xeaf9ff, emissive: 0x0a6a9a, emissiveIntensity: 0.25, transparent: true, opacity: 0.2, roughness: 0.04, metalness: 0.3, depthWrite: false, side: THREE.DoubleSide }));
  canopy.scale.set(56, 30, 66);
  canopy.position.set(0, 14, 4);
  const canopyEdge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.SphereGeometry(1, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), 1), new THREE.LineBasicMaterial({ color: 0xbff4ff, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }));
  canopy.add(canopyEdge);
  drone.add(canopy);

  // ── 全息底環與低強度掃描光 ──
  const ringTex = holoRingTexture();
  const holo = new THREE.Mesh(new THREE.PlaneGeometry(560, 560), new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  holo.rotation.x = -Math.PI / 2;
  holo.position.y = -128;
  holo.material.opacity = 0.3;
  scene.add(holo);
  // 參考圖桌面上的青色光暈：每顆馬達正下方一團，緩慢明暗
  const poolTex = radialTexture([[0, 'rgba(60,220,255,0.75)'], [0.35, 'rgba(0,170,255,0.32)'], [1, 'rgba(0,120,255,0)']]);
  const pools = Object.values(motorCenters).map((c, i) => {
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(230, 230), new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(c.x, -127, c.z);
    scene.add(pool);
    return { pool, offset: i * 1.3 };
  });
  const scanTex = radialTexture([[0, 'rgba(80,200,255,0)'], [0.82, 'rgba(80,200,255,0.05)'], [0.96, 'rgba(120,220,255,0.35)'], [1, 'rgba(120,220,255,0)']]);
  const scan = new THREE.Mesh(new THREE.CircleGeometry(330, 64), new THREE.MeshBasicMaterial({ map: scanTex, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  scan.rotation.x = -Math.PI / 2;
  scene.add(scan);

  // ── 鏡頭：前上方 3/4 視角，依容器比例算距離，保證整機（含槳尖與底環）都在畫面內 ──
  const viewDir = new THREE.Vector3(0.62, 0.44, -1).normalize(); // 機頭朝 -Z，從右前上方看
  const target = new THREE.Vector3(0, -42, 0);
  const fitRadius = 318; // 槳尖水平半徑約 320mm（斜視時投影較小），留少量浮動與擺動餘量
  function resize() {
    const w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
    // 手機等窄畫面多留 10% 邊界，確保槳尖不貼邊、不被裁切
    const margin = camera.aspect < 1.15 ? 1.14 : 1.04;
    const dist = (fitRadius / Math.sin(Math.min(vHalf, hHalf))) * margin;
    camera.position.copy(target).addScaledVector(viewDir, dist);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
  }

  // ── 動畫 ──
  let running = false, visible = true, last = 0, elapsed = 0, prevNow = 0, slowFrames = 0;
  function update(dt) {
    elapsed += dt;
    const t = elapsed;
    propellers.forEach((p) => { p.pivot.rotation.y += p.dir * p.speed * dt; });
    // 輕微懸停浮動與姿態擺動（不旋轉整機）
    drone.position.y = Math.sin(t * 1.1) * 7;
    drone.rotation.x = Math.sin(t * 0.7) * 0.035;
    drone.rotation.z = Math.sin(t * 0.55 + 1.2) * 0.03;
    drone.rotation.y = Math.sin(t * 0.25) * 0.04;
    // LED 柔和呼吸（不閃爍）
    leds.forEach((l) => { const k = 0.88 + Math.sin(t * 1.6 + l.offset) * 0.12; l.glow.scale.set(l.size * k, l.size * k, 1); l.glow.material.opacity = 0.7 + 0.2 * k; });
    holo.rotation.z = t * 0.12;
    holo.material.opacity = 0.26 + Math.sin(t * 0.9) * 0.05;
    pools.forEach((p) => { p.pool.material.opacity = 0.42 + Math.sin(t * 1.4 + p.offset) * 0.08; });
    // 掃描光：6 秒一趟，由下往上慢慢掃過機身
    const s = (t % 6) / 6;
    scan.position.y = -140 + s * 230;
    scan.material.opacity = Math.sin(s * Math.PI) * 0.35;
  }

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (frameInterval && now - last < frameInterval - 1) return;
    const dt = Math.min(0.05, prevNow ? (now - prevNow) / 1000 : 0.016);
    prevNow = now; last = now;
    // 自動降級：連續偏慢就把像素比降到 1
    if (dt > 0.045 && maxPixelRatio > 1) { slowFrames += 1; if (slowFrames > 40) { maxPixelRatio = 1; renderer.setPixelRatio(1); resize(); } } else slowFrames = 0;
    update(dt);
    renderer.render(scene, camera);
  }

  function renderStatic() {
    // 減少動態：只畫一張靜止畫面（槳葉停在不同角度、槳盤可見）
    propellers.forEach((p, i) => { p.pivot.rotation.y = p.phase + i * 0.7; });
    update(0);
    scan.material.opacity = 0;
    renderer.render(scene, camera);
  }

  function start() {
    if (running || reduceMotionQuery.matches || !visible || document.hidden) return;
    running = true; prevNow = 0;
    requestAnimationFrame(frame);
  }
  function stop() { running = false; }

  // 驗收用唯讀資訊：四片槳各自的旋向與目前角度（不影響畫面）
  window.FdeHeroDrone = {
    propellers: () => propellers.map((p) => ({ dir: p.dir > 0 ? 'CCW' : 'CW', speed: +p.speed.toFixed(2), angle: +p.pivot.rotation.y.toFixed(3) })),
    running: () => running,
    lowEnd,
    reducedMotion: () => reduceMotionQuery.matches
  };

  stage.prepend(canvas);
  resize();
  stage.classList.add('drone-3d-ready');
  stage.setAttribute('aria-label', 'F450 四旋翼科技透明 3D 展示：四片螺旋槳獨立旋轉');
  if (reduceMotionQuery.matches) renderStatic(); else { update(0); renderer.render(scene, camera); start(); }

  new ResizeObserver(() => { resize(); if (!running) renderStatic(); }).observe(stage);
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; visible ? start() : stop(); }).observe(stage);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  reduceMotionQuery.addEventListener?.('change', () => { if (reduceMotionQuery.matches) { stop(); renderStatic(); } else start(); });
}

// 等首頁其他內容載完、瀏覽器空閒時才開始載模型，不拖慢首頁
function boot() {
  const run = () => init().catch((error) => showFallback(error?.message || error));
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 1500 }); else setTimeout(run, 300);
}
if (document.readyState === 'complete') boot(); else window.addEventListener('load', boot, { once: true });
