// 組裝實訓室｜3D 場景（淺色網格、零件擺放、動畫、拖放、高亮、視角預設、縮圖）
//
// 這個模組只負責「畫面」：零件該在哪裡由呼叫端（介面＋組裝引擎）決定；
// 拖放放開時只回報「哪個零件、放在哪裡（公釐）」，能不能裝由組裝引擎判斷。
// 單位：公釐；機頭朝 −Z。
import * as THREE from 'three';
import { OrbitControls } from '../../vendor/three/addons/controls/OrbitControls.js';
import { buildPart } from './parts-gen.js';

const VIEW_PRESETS = {
  iso: { pos: [520, 430, 640], target: [0, 60, 0] },
  top: { pos: [0, 1050, 1], target: [0, 60, 0] },      // 俯視：機頭在畫面上方
  side: { pos: [980, 110, 0], target: [0, 60, 0] },    // 從右側看
  front: { pos: [0, 140, -980], target: [0, 60, 0] },
};
const ANIM_MS = 650;

/**
 * @param {HTMLElement} host  放 3D 畫布的容器
 * @param {object} model      機型資料
 * @param {{lowPower?: boolean}} [opts]
 */
export function createScene(host, model, opts = {}) {
  const lowPower = !!opts.lowPower;
  // 機型尺度：以 F450（中心到槳尖約 350 mm）為 1，5 吋約 0.5；零件盤、視角距離都依此縮放
  const extent = Math.max(...model.parts.map((p) => Math.hypot(p.target.pos[0], p.target.pos[2]) + Math.max(p.dimensionsMm.x, p.dimensionsMm.z) / 2));
  const S = Math.min(1.2, Math.max(0.35, extent / 350));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#eef2f6');
  const camera = new THREE.PerspectiveCamera(38, 1, 5, 20000);
  const renderer = new THREE.WebGLRenderer({ antialias: !lowPower, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, lowPower ? 1.5 : 2));
  renderer.shadowMap.enabled = !lowPower;
  renderer.domElement.style.touchAction = 'none';
  host.append(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.495;   // 不鑽到地面下
  controls.minDistance = 120 * S;
  controls.maxDistance = 3200 * S;

  // 燈光：柔和環境光＋一盞投影主光
  scene.add(new THREE.HemisphereLight('#ffffff', '#b8c4d0', 1.6));
  const sun = new THREE.DirectionalLight('#ffffff', 1.4);
  sun.position.set(400, 900, 300);
  sun.castShadow = !lowPower;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -800, right: 800, top: 800, bottom: -800, near: 10, far: 2500 });
  scene.add(sun);

  // 淺色網格地面（每格 50 mm）
  const grid = new THREE.GridHelper(2000, 40, '#9fb0c2', '#d3dbe4');
  scene.add(grid);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.ShadowMaterial({ opacity: 0.12 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // ───────── 建立零件與「零件盤」位置 ─────────
  const objs = new Map();      // partId → Group
  const trayPos = new Map();   // partId → Vector3（未安裝時放在地面上的位置）
  const parts = model.parts;
  const normal = parts.filter((p) => p.shape.type !== 'prop');
  const props = parts.filter((p) => p.shape.type === 'prop');
  normal.forEach((p, i) => {
    const a = (i / normal.length) * Math.PI * 2 + Math.PI / 2;
    trayPos.set(p.partId, new THREE.Vector3(Math.cos(a) * 470 * S, 0, Math.sin(a) * 470 * S));
  });
  props.forEach((p, i) => {
    const corners = [[1, -1], [-1, -1], [-1, 1], [1, 1]];
    const [x, z] = corners[i % 4];
    trayPos.set(p.partId, new THREE.Vector3(x * 640 * S, 0, z * 640 * S));
  });
  for (const p of parts) {
    const g = buildPart(p);
    g.rotation.y = THREE.MathUtils.degToRad(p.target.rotY || 0);
    // 放在零件盤時要貼地：用外框算出底部到原點的距離
    const bb = new THREE.Box3().setFromObject(g);
    g.userData.lift = -bb.min.y;
    const t = trayPos.get(p.partId);
    t.y = g.userData.lift;
    g.position.copy(t);
    objs.set(p.partId, g);
    scene.add(g);
  }

  // ───────── 狀態 ─────────
  let installed = new Set();
  let exploded = false;
  let hideInstalled = false;
  const anims = new Map();     // partId → { from, to, start }
  const listeners = { hover: () => {}, pick: () => {}, drop: () => {} };

  const targetVec = (p) => new THREE.Vector3(...p.target.pos);
  /** 爆炸視圖：安裝好的零件沿水平方向往外推、往上拉開 */
  function explodedVec(p) {
    const v = targetVec(p);
    return new THREE.Vector3(v.x * 1.7, v.y * 2.4 - 40, v.z * 1.7);
  }
  function homeOf(id) {
    const p = model.parts.find((x) => x.partId === id);
    if (!installed.has(id)) return trayPos.get(id).clone();
    return exploded ? explodedVec(p) : targetVec(p);
  }
  function moveTo(id, to, animate) {
    const g = objs.get(id);
    if (!animate) { g.position.copy(to); anims.delete(id); return; }
    anims.set(id, { from: g.position.clone(), to, start: performance.now() });
  }
  function refresh(animateIds = []) {
    for (const id of objs.keys()) {
      moveTo(id, homeOf(id), animateIds === 'all' || animateIds.includes(id));
      objs.get(id).visible = !(hideInstalled && installed.has(id));
    }
  }

  // ───────── 高亮外框、提示虛影 ─────────
  const selBox = new THREE.Box3Helper(new THREE.Box3(), '#0a84ff');
  const hovBox = new THREE.Box3Helper(new THREE.Box3(), '#7a8a9a');
  selBox.visible = hovBox.visible = false;
  scene.add(selBox, hovBox);
  let selected = null;
  let hovered = null;
  let ghost = null;
  const flashes = new Map();   // partId → 結束時間（安裝成功時短暫綠色外框）
  const flashBoxes = new Map();

  function setGhost(id) {
    if (ghost) { scene.remove(ghost); ghost = null; }
    if (!id) return;
    const p = model.parts.find((x) => x.partId === id);
    ghost = buildPart(p);
    ghost.traverse((o) => {
      if (o.isMesh) {
        o.material = new THREE.MeshBasicMaterial({ color: '#0a84ff', transparent: true, opacity: 0.22, depthWrite: false });
        o.userData.partId = null;   // 虛影不能被點選
      }
    });
    ghost.rotation.y = THREE.MathUtils.degToRad(p.target.rotY || 0);
    ghost.position.copy(exploded ? explodedVec(p) : targetVec(p));
    ghost.userData.ghostOf = id;   // 切換爆炸視圖時用來重建虛影
    scene.add(ghost);
  }

  function flash(id) {
    if (!flashBoxes.has(id)) {
      const h = new THREE.Box3Helper(new THREE.Box3(), '#22b35e');
      flashBoxes.set(id, h);
      scene.add(h);
    }
    flashes.set(id, performance.now() + 1200);
  }

  // ───────── 滑鼠：懸停、點選、拖放 ─────────
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let drag = null;   // { id, startX, startY, moved, external }

  function setNdc(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
  }
  function pickAt(ev) {
    setNdc(ev);
    ray.setFromCamera(ndc, camera);
    const meshes = [];
    for (const g of objs.values()) if (g.visible) g.traverse((o) => { if (o.isMesh && o.userData.partId) meshes.push(o); });
    const hit = ray.intersectObjects(meshes, false)[0];
    return hit ? hit.object.userData.partId : null;
  }
  function planePoint(ev, id) {
    setNdc(ev);
    ray.setFromCamera(ndc, camera);
    const p = model.parts.find((x) => x.partId === id);
    // 拖動平面設在「正確安裝高度」，讓學員只需要對準水平位置
    dragPlane.constant = -p.target.pos[1];
    const out = new THREE.Vector3();
    return ray.ray.intersectPlane(dragPlane, out) ? out : null;
  }
  function beginDrag(id, ev, external) {
    drag = { id, startX: ev.clientX, startY: ev.clientY, moved: external, external };
    controls.enabled = false;
    anims.delete(id);
  }
  function moveDrag(ev) {
    if (!drag) return;
    if (Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY) > 4) drag.moved = true;
    if (!drag.moved) return;
    const inside = setNdc(ev);
    const pt = inside ? planePoint(ev, drag.id) : null;
    const g = objs.get(drag.id);
    if (pt) { g.position.copy(pt); g.visible = true; }
  }
  function endDrag(ev) {
    if (!drag) return;
    const { id, moved } = drag;
    drag = null;
    controls.enabled = true;
    if (!moved) { listeners.pick(id); return; }
    const inside = setNdc(ev);
    const pt = inside ? planePoint(ev, id) : null;
    if (!pt) { refresh([id]); return; }   // 放在畫布外：回到零件盤
    listeners.drop(id, [pt.x, pt.y, pt.z]);
  }

  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', (ev) => {
    const id = pickAt(ev);
    if (!id) return;
    if (installed.has(id)) { listeners.pick(id); return; }
    canvas.setPointerCapture(ev.pointerId);
    beginDrag(id, ev, false);
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (drag) { moveDrag(ev); return; }
    const id = ev.pointerType === 'mouse' ? pickAt(ev) : null;
    if (id !== hovered) { hovered = id; listeners.hover(id, ev.clientX, ev.clientY); }
    else if (id) listeners.hover(id, ev.clientX, ev.clientY);
  });
  canvas.addEventListener('pointerup', (ev) => { if (drag && !drag.external) endDrag(ev); });
  canvas.addEventListener('pointerleave', () => { if (hovered) { hovered = null; listeners.hover(null); } });

  // 從零件庫拖進來：用 window 聽移動與放開（指標一開始不在畫布上）
  function startExternalDrag(id, ev) {
    if (installed.has(id)) return;
    beginDrag(id, ev, true);
    const move = (e) => moveDrag(e);
    const up = (e) => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); endDrag(e); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ───────── 視角 ─────────
  function view(name, animate = true) {
    const v = VIEW_PRESETS[name] || VIEW_PRESETS.iso;
    const to = new THREE.Vector3(...v.pos).multiplyScalar(S);
    const tgt = new THREE.Vector3(...v.target).multiplyScalar(S);
    if (!animate) { camera.position.copy(to); controls.target.copy(tgt); controls.update(); return; }
    camAnim = { fromPos: camera.position.clone(), toPos: to, fromT: controls.target.clone(), toT: tgt, start: performance.now() };
  }
  let camAnim = null;
  function focus(id) {
    const g = objs.get(id);
    const bb = new THREE.Box3().setFromObject(g);
    const c = bb.getCenter(new THREE.Vector3());
    const size = Math.max(60, bb.getSize(new THREE.Vector3()).length());
    const dir = camera.position.clone().sub(controls.target).normalize();
    camAnim = { fromPos: camera.position.clone(), toPos: c.clone().add(dir.multiplyScalar(size * 2.2)), fromT: controls.target.clone(), toT: c, start: performance.now() };
  }

  // ───────── 縮圖（零件庫用；另開一個小畫布一次產生後釋放） ─────────
  function thumbnails(size = 96) {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setSize(size, size * 0.75);
    const s = new THREE.Scene();
    s.add(new THREE.HemisphereLight('#ffffff', '#99a7b5', 2.2));
    const cam = new THREE.PerspectiveCamera(30, 4 / 3, 1, 5000);
    const out = new Map();
    for (const p of model.parts) {
      const g = buildPart(p);
      g.rotation.y = THREE.MathUtils.degToRad(p.target.rotY || 0);
      s.add(g);
      const bb = new THREE.Box3().setFromObject(g);
      const c = bb.getCenter(new THREE.Vector3());
      const len = bb.getSize(new THREE.Vector3()).length();
      cam.position.copy(c).add(new THREE.Vector3(0.7, 0.75, 0.9).normalize().multiplyScalar(len * 1.45));
      cam.lookAt(c);
      r.render(s, cam);
      out.set(p.partId, r.domElement.toDataURL('image/png'));
      s.remove(g);
    }
    r.dispose();
    r.forceContextLoss();
    return out;
  }

  /** 零件中心在螢幕上的位置（給說明浮層定位） */
  function screenOf(id) {
    const g = objs.get(id);
    const c = new THREE.Box3().setFromObject(g).getCenter(new THREE.Vector3()).project(camera);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + ((c.x + 1) / 2) * r.width, y: r.top + ((1 - c.y) / 2) * r.height };
  }

  // ───────── P2：3D 線束預覽（已接好的線，畫成兩零件之間略為拱起的曲線） ─────────
  const wireGroup = new THREE.Group();
  scene.add(wireGroup);
  let wireList = [];
  function drawWires() {
    for (const c of [...wireGroup.children]) { c.geometry.dispose(); c.material.dispose(); wireGroup.remove(c); }
    if (exploded) return;   // 爆炸視圖時零件分開，線會亂，先不畫
    for (const w of wireList) {
      const a = new THREE.Box3().setFromObject(objs.get(w.from)).getCenter(new THREE.Vector3());
      const b = new THREE.Box3().setFromObject(objs.get(w.to)).getCenter(new THREE.Vector3());
      const mid = a.clone().lerp(b, 0.5);
      mid.y += 18 + a.distanceTo(b) * 0.08;
      const pts = new THREE.QuadraticBezierCurve3(a, mid, b).getPoints(24);
      wireGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: w.color })));
    }
  }

  // ───────── 尺寸與動畫迴圈 ─────────
  function resize() {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);
  resize();
  view('iso', false);

  const ease = (t) => 1 - Math.pow(1 - t, 3);
  function updateBox(helper, id) {
    if (!id || !objs.get(id).visible) { helper.visible = false; return; }
    helper.box.setFromObject(objs.get(id)).expandByScalar(3);
    helper.visible = true;
  }
  // ───────── 實機效能量測（網址加 ?fps=1 才顯示）：每秒更新平均幀率、最低幀率與繪圖次數 ─────────
  const perf = { on: new URLSearchParams(location.search).get('fps') === '1', frames: 0, last: performance.now(), worst: 0, prev: 0, el: null, samples: [] };
  if (perf.on) {
    perf.el = document.createElement('div');
    perf.el.className = 'bl-fps';
    host.append(perf.el);
  }
  function tickPerf(now) {
    if (perf.prev) perf.worst = Math.max(perf.worst, now - perf.prev);   // 這一秒內最慢的一幀（毫秒）
    perf.prev = now;
    perf.frames++;
    if (now - perf.last < 1000) return;
    const fps = Math.round((perf.frames * 1000) / (now - perf.last));
    perf.samples.push(fps);
    if (perf.samples.length > 30) perf.samples.shift();
    const avg = Math.round(perf.samples.reduce((a, b) => a + b, 0) / perf.samples.length);
    perf.el.textContent = `FPS ${fps}｜30 秒平均 ${avg}｜最慢一幀 ${Math.round(perf.worst)} ms｜繪圖 ${renderer.info.render.calls} 次｜像素比 ${renderer.getPixelRatio()}｜${lowPower ? '省電模式' : '一般模式'}`;
    perf.el.dataset.avg = String(avg);
    perf.frames = 0;
    perf.worst = 0;
    perf.last = now;
  }

  renderer.setAnimationLoop((now) => {
    for (const [id, a] of anims) {
      const t = Math.min(1, (now - a.start) / ANIM_MS);
      objs.get(id).position.lerpVectors(a.from, a.to, ease(t));
      if (t >= 1) anims.delete(id);
    }
    if (camAnim) {
      const t = Math.min(1, (now - camAnim.start) / ANIM_MS);
      camera.position.lerpVectors(camAnim.fromPos, camAnim.toPos, ease(t));
      controls.target.lerpVectors(camAnim.fromT, camAnim.toT, ease(t));
      if (t >= 1) camAnim = null;
    }
    controls.update();
    updateBox(selBox, selected);
    updateBox(hovBox, hovered !== selected ? hovered : null);
    for (const [id, until] of flashes) {
      const h = flashBoxes.get(id);
      if (now > until) { h.visible = false; flashes.delete(id); } else updateBox(h, id);
    }
    renderer.render(scene, camera);
    if (perf.on) tickPerf(now);
  });

  return {
    /** 依引擎狀態擺放零件；animateIds 指定要動畫的零件（或 'all'） */
    setInstalled(ids, animateIds = []) { installed = new Set(ids); refresh(animateIds); },
    setExploded(v) { exploded = !!v; refresh('all'); drawWires(); if (ghost) setGhost(ghost.userData.ghostOf); },
    /** 依已接好的線更新 3D 線束；等零件動畫結束後再畫，避免線停在半空 */
    setWires(list) { wireList = list; setTimeout(drawWires, ANIM_MS + 50); },
    setHideInstalled(v) { hideInstalled = !!v; refresh([]); },
    returnToTray(id) { refresh([id]); },
    setGhost(id) { setGhost(id); },
    select(id) { selected = id; },
    flash, view, focus, thumbnails, screenOf, startExternalDrag,
    on(name, fn) { listeners[name] = fn; },
    get lowPower() { return lowPower; },
  };
}
