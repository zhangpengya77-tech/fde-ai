// 3D 共用工具：場景、相機、軌道控制、程式生成的教學用無人機模型（全部自行建模，不使用外部模型檔）
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export { THREE };

/** 建立可自動縮放的 3D 場景；回傳 {scene,camera,renderer,controls,onFrame,dispose} */
export function makeStage(host, { bg = 0xeaf3ff, cam = [3, 2.4, 3.4], target = [0, 0.3, 0], grid = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(bg);
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
  camera.position.set(...cam);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(...target); controls.enableDamping = true; controls.update();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8aa6c8, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(4, 8, 5); scene.add(sun);
  if (grid) {
    const g = new THREE.GridHelper(10, 20, 0x9fb7d8, 0xcfdcee); scene.add(g);
  }
  const hooks = new Set();
  let raf = 0, last = performance.now(), alive = true;
  const resize = () => {
    const w = host.clientWidth || 300, h = host.clientHeight || 240;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize); ro.observe(host); resize();
  const loop = now => {
    if (!alive) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;   // 低幀率裝置最多補 0.1 秒，避免卡頓後瞬移
    hooks.forEach(f => f(dt, now));
    controls.update(); renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  return {
    scene, camera, renderer, controls,
    onFrame: f => { hooks.add(f); return () => hooks.delete(f); },
    dispose() {
      alive = false; cancelAnimationFrame(raf); ro.disconnect(); controls.dispose();
      scene.traverse(o => { o.geometry?.dispose?.(); [].concat(o.material || []).forEach(m => m.dispose?.()); });
      renderer.dispose(); renderer.domElement.remove();
    }
  };
}

const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.15, ...o });

/** 文字標籤（Canvas 貼圖精靈） */
export function label(text, { color = '#0b3d91', bg = 'rgba(255,255,255,.92)', size = 0.18 } = {}) {
  const c = document.createElement('canvas'); const ctx = c.getContext('2d');
  ctx.font = 'bold 44px "Microsoft JhengHei", sans-serif';
  const w = Math.ceil(ctx.measureText(text).width) + 36; c.width = w; c.height = 72;
  ctx.font = 'bold 44px "Microsoft JhengHei", sans-serif';
  ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(0, 0, w, 72, 18); ctx.fill();
  ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.fillText(text, 18, 38);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  s.scale.set(size * w / 72, size, 1); s.renderOrder = 10;
  return s;
}

/**
 * 教學用四旋翼（X 型）。回傳 group，group.userData.parts = [{key,name,info,obj,home,explode}]
 * 每個零件都有原位 home 與爆炸位置 explode，供拆解實驗使用。
 */
export function buildQuad({ cage = false, scale = 1 } = {}) {
  const g = new THREE.Group(); const parts = [];
  const add = (key, name, info, obj, explode) => {
    obj.name = key; g.add(obj);
    parts.push({ key, name, info, obj, home: obj.position.clone(), explode: new THREE.Vector3(...explode) });
    return obj;
  };
  const shell = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.16, 0.62), mat(0xffffff, { transparent: true, opacity: 0.95 }));
  shell.position.y = 0.16;
  add('shell', '機殼／上板', '保護內部電子零件，也是安裝電池的平台。', shell, [0, 1.1, 0]);
  const frame = new THREE.Group();
  const armGeo = new THREE.BoxGeometry(1.5, 0.05, 0.08);
  for (const r of [Math.PI / 4, -Math.PI / 4]) { const a = new THREE.Mesh(armGeo, mat(0x2b3a55)); a.rotation.y = r; frame.add(a); }
  frame.position.y = 0.05;
  add('frame', '機架與機臂', '無人機的骨架，把電機固定在四個角落。X 型機臂互相垂直。', frame, [0, -0.45, 0]);
  const fc = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.16), mat(0x1f6feb));
  fc.position.y = 0.11;
  add('fc', '飛控', '無人機的大腦：讀感測器、計算姿態，命令每顆電機轉速。', fc, [0, 0.75, 0.55]);
  const bat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.18), mat(0xe8a33d));
  bat.position.y = 0.3;
  add('battery', '鋰電池', '提供能量。常見 3S（11.1 V）或 4S（14.8 V）。', bat, [0, 1.6, -0.2]);
  const gps = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.03, 24), mat(0x333333));
  gps.position.set(-0.18, 0.42, 0);
  add('gps', 'GPS 模組', '接收衛星訊號計算位置，讓無人機能定點與返航。', gps, [-0.6, 1.3, 0]);
  const rx = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.06), mat(0x2d9b5a));
  rx.position.set(0.18, 0.11, -0.12);
  add('rx', '接收機', '接收遙控器的訊號，轉交給飛控。', rx, [0.75, 0.6, -0.6]);
  // ArduPilot Quad X：M1 右前、M2 左後、M3 左前、M4 右後（此模型 +x 為右、-z 為前）
  const motorIdx = [[0.53, -0.53], [-0.53, 0.53], [-0.53, -0.53], [0.53, 0.53]];
  const props = [];
  motorIdx.forEach(([x, z], i) => {
    const dir = i < 2 ? 'ccw' : 'cw';
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.09, 20), mat(0xd23c3c, { metalness: 0.5 }));
    m.position.set(x, 0.1, z);
    add(`motor${i + 1}`, `電機 M${i + 1}`, `無刷電機，${dir === 'ccw' ? '逆時針' : '順時針'}轉。把電能變成旋轉。`, m, [x * 2.1, 0.1, z * 2.1]);
    const esc = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.05), mat(0x6c5ce7));
    esc.position.set(x * 0.55, 0.075, z * 0.55); esc.rotation.y = Math.atan2(-z, x);
    add(`esc${i + 1}`, `電調 ESC${i + 1}`, '電子調速器：依飛控命令切換電流，控制電機轉速。', esc, [x * 1.4, -0.3, z * 1.4]);
    const p = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.008, 0.05), mat(dir === 'ccw' ? 0x222222 : 0x888888));
    p.add(blade); const b2 = blade.clone(); b2.rotation.y = Math.PI / 2; p.add(b2);
    p.position.set(x, 0.16, z); p.userData.dir = dir === 'ccw' ? 1 : -1;
    add(`prop${i + 1}`, `螺旋槳 P${i + 1}`, `${dir === 'ccw' ? '逆時針（CCW）' : '順時針（CW）'}槳：把空氣往下推產生升力。`, p, [x * 1.6, 1.0, z * 1.6]);
    props.push(p);
  });
  if (cage) {
    const c = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.55 }));
    c.position.y = 0.15; g.add(c); g.userData.cage = c;
  }
  g.userData.parts = parts; g.userData.props = props; g.userData.shell = shell;
  g.scale.setScalar(scale);
  return g;
}

/** 讓螺旋槳轉動；speed 0–1 */
export function spinProps(g, dt, speed = 1) {
  for (const p of g.userData.props || []) p.rotation.y += p.userData.dir * dt * 40 * speed;
}
