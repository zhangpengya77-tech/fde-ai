// F450 數位孿生 2.0｜場景、分層爆炸、引線標籤、虛線組裝導引、零件教學與五種模式
import * as THREE from 'three';
import { OrbitControls } from './vendor/three/addons/controls/OrbitControls.js';
import { GLTFLoader } from './vendor/three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from './vendor/three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from './vendor/three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from './vendor/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { OutlinePass } from './vendor/three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from './vendor/three/addons/postprocessing/OutputPass.js';
import { PARTS, LAYERS, STATUS, STEPS, WIRING, CHECKS, SPECS, PRIMARY, LABELS, WIRING_LINKS, SIZE_REFS, PHOTOS, VIEW_PHOTOS } from './parts-data.js?v=1.2.1';

const $ = (id) => document.getElementById(id);
const query = new URLSearchParams(location.search);
const host = $('viewer');
// 圖片來源：桌面單檔版會把圖片內嵌在 window.__F450_IMG；網頁版用 ./img/
const imgSrc = (name) => (window.__F450_IMG && window.__F450_IMG[name]) || `./img/${name}`;
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };

// ───────── WebGL 偵測 ─────────
const T0 = performance.now();
function webglOK() {
  try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch { return false; }
}
function fatal(msg) {
  const l = $('loading'); if (l) { l.replaceChildren(); l.append(el('p', msg)); l.style.pointerEvents = 'auto'; }
  throw new Error(msg);
}
if (!webglOK()) fatal('這台裝置或瀏覽器不支援 WebGL，無法顯示 3D 模型。請改用新版 Chrome、Edge 或 Safari，並確認已開啟硬體加速。左右兩欄的零件介紹仍可閱讀。');

// ───────── 場景 ─────────
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(36, 1, 1, 9000);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 820 ? 1.5 : 2));   // 手機限制像素比，降低 GPU 負擔
renderer.setClearColor(0x000000, 0);
const LOW_POWER = matchMedia('(pointer: coarse)').matches || innerWidth < 820 || query.get('lite') === '1';   // 手機／平板：自動降級
(function gradientBackground() {
  const c = document.createElement('canvas'); c.width = 16; c.height = 512; const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 512); grd.addColorStop(0, '#0d2a47'); grd.addColorStop(0.55, '#0a1d33'); grd.addColorStop(1, '#050f1c');
  g.fillStyle = grd; g.fillRect(0, 0, 16, 512);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; scene.background = tex;
})();
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;   // 電影感色調，金屬與塑膠更自然
host.prepend(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.screenSpacePanning = true; controls.minDistance = 80; controls.maxDistance = 3000;
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };   // 單指旋轉、雙指縮放＋平移
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  const l = el('div', '3D 繪圖資源被系統回收（常見於手機記憶體不足）。請重新整理頁面。', 'ctxlost'); host.append(l);
});
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;   // 環境反射（金屬馬達、PCB 光澤）
scene.environmentIntensity = 0.4;   // 反射強度：保留金色與洋紅的飽和度
scene.add(new THREE.HemisphereLight(0xe0f0ff, 0x10233a, 1.2));
const key = new THREE.DirectionalLight(0xffffff, 2.5); key.position.set(420, 800, 380); scene.add(key);
if (!LOW_POWER) {   // 柔和陰影（電腦版）
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.radius = 4; key.shadow.bias = -0.0005;
  Object.assign(key.shadow.camera, { left: -500, right: 500, top: 500, bottom: -500, near: 100, far: 2400 });
}
const shadowGround = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.ShadowMaterial({ opacity: 0.38 }));
shadowGround.rotation.x = -Math.PI / 2; shadowGround.receiveShadow = true; scene.add(shadowGround);
const rim = new THREE.DirectionalLight(0x6fc0ff, 1.4); rim.position.set(-560, 240, -420); scene.add(rim);
const grid = new THREE.GridHelper(1600, 32, 0x2a7bc0, 0x123251);
grid.material.transparent = true; grid.material.opacity = 0.35; scene.add(grid);

// 模型為 glTF 標準 Y 向上；機頭 = -Z；從上往下看 +X 為右
const VIEWS = { iso: [620, 430, 620], top: [0, 1150, 1], right: [1100, 60, 0], front: [0, 60, -1100] };
const camGoal = new THREE.Vector3().fromArray(VIEWS.iso);
const tgtGoal = new THREE.Vector3();
const modelCenter = new THREE.Vector3();
camera.position.copy(camGoal);
let animatingCam = true, currentView = 'iso';
controls.addEventListener('start', () => { animatingCam = false; });

let composer = null, outline = null, bloom = null;
function setupFX() {
  if (LOW_POWER) return;
  const r = host.getBoundingClientRect(); const size = new THREE.Vector2(r.width, r.height);
  composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
  outline = new OutlinePass(size, scene, camera);   // 選取零件的發光描邊
  Object.assign(outline, { edgeStrength: 5, edgeGlow: 0.9, edgeThickness: 1.6, pulsePeriod: 2.5 });
  outline.visibleEdgeColor.set(0x4fd2ff); outline.hiddenEdgeColor.set(0x1b4f86); composer.addPass(outline);
  bloom = new UnrealBloomPass(size, 0.32, 0.4, 0.97); composer.addPass(bloom);   // 藍色光暈（只讓亮處發光）
  composer.addPass(new OutputPass());
}
function disableFX(reason) {   // 效能不足時自動降級
  composer = null; renderer.shadowMap.enabled = false; key.castShadow = false;
  console.info('F450 twin: 已自動降級畫質', reason);
}
function resize() {
  const r = host.getBoundingClientRect(); camera.aspect = r.width / r.height; camera.updateProjectionMatrix(); renderer.setSize(r.width, r.height, false);
  if (composer) { composer.setSize(r.width, r.height); }
}
if (query.get('fx') !== '0') setupFX();
addEventListener('resize', resize); resize();

// 觸控裝置改用觸控操作說明
if (matchMedia('(pointer: coarse)').matches) { const h = document.querySelector('.hint'); if (h) h.textContent = '單指旋轉｜雙指縮放與平移｜雙擊復原視角｜點零件看介紹'; }

// ───────── 真機照片：放大檢視 ─────────
function openPhoto(file, caption) {
  const box = el('div', null, 'lightbox'); const img = el('img'); img.src = imgSrc(file); img.alt = caption;
  box.append(img, el('p', `${caption}（教師真機照片，點任意處關閉）`)); box.onclick = () => box.remove(); document.body.append(box);
}
let showPip = false;
function updatePip() {
  const pip = $('pip'); if (!pip) return;
  pip.hidden = !showPip; if (!showPip) return;
  const [file, cap] = VIEW_PHOTOS[currentView] || VIEW_PHOTOS.iso;
  pip.querySelector('img').src = imgSrc(file); pip.querySelector('span').textContent = `真機 ${cap}`;
  pip.onclick = () => openPhoto(file, cap);
}

// ───────── 狀態 ─────────
const nodes = [];  // { obj, meshes, key, layer, step, status, base, explode, c0 }
const layerNow = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
const layerGoal = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
const hotNodes = new Set();   // 接線圖／量測時要一起高亮的節點
let distScale = 1, focusLayer = 0, selectedKey = null, selectedNode = null, mode = 'explode', step = 1, showLabels = true;

const maxGoal = () => Math.max(...Object.values(layerGoal));
function setView(v) {
  currentView = v;
  camGoal.fromArray(VIEWS[v]).multiplyScalar((0.92 + 0.12 * maxGoal() * distScale) * Math.max(1, 1.0 / camera.aspect));  // 窄螢幕自動拉遠
  tgtGoal.copy(modelCenter); if (maxGoal() > 0) tgtGoal.y += 40; animatingCam = true;
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  updatePip();   // 實拍對照跟著換成同角度的照片
}
document.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => setView(b.dataset.view)));
$('toggle-labels').onclick = (e) => { showLabels = !showLabels; e.currentTarget.classList.toggle('on', showLabels); };
$('toggle-pip').onclick = (e) => { showPip = !showPip; e.currentTarget.classList.toggle('on', showPip); updatePip(); };

// ───────── 零件註冊與外觀 ─────────
function medianPoint(obj) {
  obj.updateMatrixWorld(true);
  const xs = [], ys = [], zs = [], v3 = new THREE.Vector3();
  obj.traverse((n) => {
    if (!n.isMesh) return;
    const pos = n.geometry.attributes.position; const step = Math.max(1, Math.floor(pos.count / 1500));
    for (let i = 0; i < pos.count; i += step) { v3.fromBufferAttribute(pos, i).applyMatrix4(n.matrixWorld); xs.push(v3.x); ys.push(v3.y); zs.push(v3.z); }
  });
  const med = (a) => { a.sort((p, q) => p - q); return a[Math.floor(a.length / 2)] ?? 0; };
  return new THREE.Vector3(med(xs), med(ys), med(zs));
}
// PBR 材質微調（依材質名稱）：金屬更亮、PCB 有光澤、塑膠偏霧面
function tunePBR(mat) {
  const n = (mat.name || '').toLowerCase();
  const set = (metal, rough) => { mat.metalness = metal; mat.roughness = rough; };
  if (n.includes('motor gold')) set(0.95, 0.28);
  else if (n.includes('red anodised')) set(0.9, 0.3);
  else if (n.includes('steel') || n.includes('screw')) set(1.0, 0.22);
  else if (n.includes('gold pcb') || n.includes('pins')) set(1.0, 0.3);
  else if (n.includes('pcb')) set(0.3, 0.32);
  else if (n.includes('arm') || n.includes('prop')) set(0.0, 0.5);
  else if (n.includes('heat-shrink') || n.includes('lipo')) set(0.0, 0.42);
}
function prepare(root) {
  for (const obj of [...root.children]) {
    const u = obj.userData || {};
    if (!u.part_key) continue;
    const meshes = []; obj.traverse((n) => { if (n.isMesh) meshes.push(n); });
    meshes.forEach((m) => {
      m.castShadow = true; m.receiveShadow = true;
      m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
      for (const mat of [].concat(m.material)) tunePBR(mat);
      for (const mat of [].concat(m.material)) mat.userData.e0 = mat.emissive ? mat.emissive.clone() : null;
    });
    const c0 = medianPoint(obj);   // 錨點用頂點中位數，不被細長天線、線材拉偏
    nodes.push({ obj, meshes, key: u.part_key, layer: u.layer, step: u.step, status: u.status, name: u.cad_group || obj.name,
      base: obj.position.clone(), explode: new THREE.Vector3().fromArray(u.explode || [0, 0, 0]), c0, fly: 0 });
  }
}
const visible = (n) => mode !== 'assembly' || n.step <= step;
const WIRING_KEYS = ['wiring', 'pixhawk', 'esc', 'receiver', 'gps', 'power_module', 'power_lead', 'bottom_plate', 'battery', 'motor'];
function dimmed(n) {
  if (mode === 'wiring') return !WIRING_KEYS.includes(n.key);
  if (mode === 'explode' && focusLayer) return n.layer !== focusLayer;
  return false;
}
function refreshLook() {
  if (outline) outline.selectedObjects = nodes.filter((n) => n.obj.visible && (hotNodes.size ? hotNodes.has(n) : (selectedNode ? n.obj === selectedNode : n.key === selectedKey))).map((n) => n.obj);
  for (const n of nodes) {
    n.obj.visible = visible(n);
    const dim = dimmed(n);
    const hot = hotNodes.size ? hotNodes.has(n) : (selectedNode ? n.obj === selectedNode : n.key === selectedKey) || (mode === 'assembly' && n.step === step);
    for (const m of n.meshes) for (const mat of [].concat(m.material)) {
      mat.transparent = dim; mat.opacity = dim ? 0.12 : 1; mat.depthWrite = !dim;
      if (mat.emissive) { if (hot) mat.emissive.setHex(0x1f7bff).multiplyScalar(0.6); else if (mat.userData.e0) mat.emissive.copy(mat.userData.e0); }
    }
  }
}

// ───────── 爆炸控制 ─────────
function setLayers(v, only = null) { for (const L in layerGoal) if (!only || Number(L) === only) layerGoal[L] = v; if (!selectedNode) setView(currentView); }
$('ex-all').onclick = () => setLayers(1);
$('ex-reset').onclick = () => setLayers(0);
$('ex-next').onclick = () => { for (let L = 1; L <= 5; L++) if (layerGoal[L] < 1) { layerGoal[L] = 1; break; } setView(currentView); };
$('ex-back').onclick = () => { for (let L = 5; L >= 1; L--) if (layerGoal[L] > 0) { layerGoal[L] = 0; break; } setView(currentView); };
$('ex-scale').oninput = (e) => { distScale = Number(e.target.value) / 100; $('ex-scale-val').textContent = `${e.target.value}%`; };
(function chips() {
  const box = $('layer-chips');
  const mk = (L, label) => { const b = el('button', label); b.dataset.layer = L; b.onclick = () => pickLayer(L); box.append(b); };
  mk(0, '全部分層'); for (const L of [1, 2, 3, 4, 5]) mk(L, LAYERS[L]);
})();
function pickLayer(L) {
  focusLayer = L;
  $('layer-chips').querySelectorAll('button').forEach((x) => x.classList.toggle('on', Number(x.dataset.layer) === L));
  if (L) layerGoal[L] = 1;
  refreshLook();
}
pickLayer(0);

// ───────── 左欄零件清單 ─────────
function partButton(key, title, sub) {
  const p = PARTS[key];
  const b = el('button', null, 'part'); b.dataset.key = key;
  const img = el('img'); img.src = imgSrc(`part-${key}.png`); img.alt = ''; img.loading = 'lazy';
  const t = el('div'); t.append(el('b', title), el('span', sub));
  b.append(img, t, Object.assign(el('span', p.status === 'PLACEHOLDER' ? '示意' : '參考', `tag ${STATUS[p.status].tone}`), { title: STATUS[p.status].zh }));
  b.onclick = () => selectPart(key, null, true);
  return b;
}
PRIMARY.forEach(([k, t, s]) => $('part-list').append(partButton(k, t, s)));
Object.entries(PARTS).filter(([k]) => !PRIMARY.some(([p]) => p === k)).forEach(([k, p]) => $('part-more').append(partButton(k, p.zh, p.en)));

// ───────── 右欄資訊卡 ─────────
function renderInfo(key, node) {
  const p = PARTS[key]; const box = $('info'); box.replaceChildren();
  const head = el('div', null, 'head'); const img = el('img'); img.src = imgSrc(`part-${key}.png`); img.alt = '';
  const t = el('div'); t.append(el('h2', p.zh), el('div', `${p.en}｜${LAYERS[p.layer]}`, 'en'));
  head.append(img, t);
  const st = el('p'); st.append(el('span', p.status, `tag ${STATUS[p.status].tone}`), document.createTextNode(STATUS[p.status].zh));
  box.append(head, st);
  if (PHOTOS[key]) {   // 真機實拍（教師照片）
    box.append(el('h3', '真機實拍：'));
    const g = el('div', null, 'photos');
    PHOTOS[key].forEach(([file, cap]) => {
      const f = el('figure'); const img = el('img'); img.src = imgSrc(file); img.alt = cap; img.loading = 'lazy';
      f.append(img, el('figcaption', cap)); f.onclick = () => openPhoto(file, cap); g.append(f);
    });
    box.append(g);
  }
  box.append(el('h3', '功能：'));
  const ul = el('ul'); p.func.split(/[，；]/).filter(Boolean).forEach((x) => ul.append(el('li', x.replace(/。$/, '')))); box.append(ul);
  box.append(el('h3', '主要規格：'));
  const spec = el('table', null, 'spec'); const sb = el('tbody'); spec.append(sb);
  (SPECS[key] || [['規格', '待實機核對', 'pending']]).forEach(([a, b, tag]) => {
    const tr = el('tr'); const td = el('td'); td.append(el('span', tag === 'ref' ? 'REFERENCE' : tag === 'verified' ? 'VERIFIED' : '待核對', `tag ${tag}`), document.createTextNode(b));
    tr.append(el('td', a), td); sb.append(tr);
  });
  box.append(spec);
  box.append(el('h3', '主要接口與用途：'));
  if (Array.isArray(p.ports)) {
    const tbl = el('table'); const tb = el('tbody'); tbl.append(tb);
    p.ports.forEach(([a, b]) => { const tr = el('tr'); tr.append(el('td', `・${a}`), el('td', b)); tb.append(tr); });
    const w = el('div', null, 'tw'); w.append(tbl); box.append(w, el('p', p.portsNote, 'note'));
  } else box.append(el('p', p.ports));
  if (node?.userData?.spin) box.append(el('p', `本槳：${node.userData.spin}｜對應 MAIN OUT ${node.userData.main_out}（Quad X 標準，待實機核對）`, 'note'));
  const more = el('details'); more.append(el('summary', '安裝位置、連接、注意事項、故障檢查'));
  const sec = (h, v) => { more.append(el('h3', h)); if (Array.isArray(v)) { const u = el('ul'); v.forEach((x) => u.append(el('li', x))); more.append(u); } else more.append(el('p', v)); };
  sec('實際尺寸與重量', p.size); sec('安裝位置與方向', p.position); sec('與其他部件的連接', p.links); sec('安裝注意事項', p.caution); sec('常見故障與檢查', p.faults);
  box.append(more, el('p', `資料來源：${p.source}`, 'src'));
}

function selectPart(key, node = null, frame = false) {
  selectedKey = key; selectedNode = node;
  document.querySelectorAll('.part').forEach((b) => b.classList.toggle('on', b.dataset.key === key));
  if (node) { const b = document.querySelector(`.part[data-key="${key}"]`); if (b && innerWidth > 820) b.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  renderInfo(key, node); refreshLook();
  if (frame) {
    const box = new THREE.Box3();
    applyPositions();
    nodes.filter((n) => n.key === key && n.obj.visible).forEach((n) => box.expandByObject(n.obj));
    if (!box.isEmpty()) {
      const c = box.getCenter(new THREE.Vector3()); const s = Math.max(box.getSize(new THREE.Vector3()).length(), 120);
      tgtGoal.copy(c); camGoal.copy(c).add(new THREE.Vector3(1, 0.8, 1).multiplyScalar(s * 1.5)); animatingCam = true;
    }
  }
}

// 點選 3D 零件（拖曳不觸發）
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(); let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('dblclick', () => setView(currentView === 'front' ? 'iso' : currentView));   // 雙擊復原視角
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
  const r = renderer.domElement.getBoundingClientRect();
  ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  const pick = nodes.filter((n) => n.obj.visible && !dimmed(n)).flatMap((n) => n.meshes);
  const hit = ray.intersectObjects(pick, false)[0]; if (!hit) return;
  const n = nodes.find((x) => x.meshes.includes(hit.object)); if (!n) return;
  if (mode === 'size' && measure.on) { pickMeasure(n); return; }
  selectPart(n.key, n.obj);
});

// ───────── 模式 ─────────
function switchMode(m) {
  mode = m;
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  for (const id of ['explode', 'whole', 'assembly', 'wiring', 'size']) $(`strip-${id}`).hidden = id !== m;
  if (m === 'explode') { if (maxGoal() === 0) setLayers(1); }
  else { pickLayer(0); setLayers(0); }
  if (m === 'assembly') renderStep();
  if (m === 'wiring') selectPart('wiring');
  stopPlay(); hotNodes.clear(); measure.on = false; measure.picks = []; $('measure-toggle').classList.remove('on');
  if (m === 'size') { setView('iso'); camGoal.multiplyScalar(1.3); }   // 尺寸模式拉遠，讓四條標註都在畫面內
  else if (m !== 'assembly') setView(currentView === 'front' ? 'iso' : currentView);   // 其他模式：鏡頭回到標準視角
  if (m === 'wiring') selectWire(-1);
  refreshLook();
}
document.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => switchMode(b.dataset.mode)));
STEPS.forEach((s) => $('step-list').append(el('li', s.title)));
let playTimer = null;
function stopPlay() { if (playTimer) { clearInterval(playTimer); playTimer = null; } $('step-play').textContent = '▶ 自動播放'; }
$('step-play').onclick = () => {
  if (playTimer) { stopPlay(); return; }
  if (step >= STEPS.length) step = 0;
  $('step-play').textContent = '⏸ 暫停';
  const next = () => { if (step >= STEPS.length) { stopPlay(); return; } goStep(step + 1); };
  next(); playTimer = setInterval(next, 3600);
};
function goStep(n) {
  const forward = n > step; step = n;
  if (forward) for (const x of nodes) if (x.step === step) x.fly = 1;     // 本步零件從拆解位置飛回組裝位置
  renderStep();
  if ($('step-follow').checked) {                                          // 鏡頭跟隨：框住本步零件（以組裝位置計算）
    const pts = nodes.filter((x) => x.step === step).map((x) => x.c0);
    if (pts.length) {
      const box = new THREE.Box3().setFromPoints(pts); const c = box.getCenter(new THREE.Vector3());
      const sz = Math.max(box.getSize(new THREE.Vector3()).length(), 160);
      tgtGoal.copy(c); camGoal.copy(c).add(new THREE.Vector3(1, 0.85, 1).normalize().multiplyScalar(sz * 2.1 * Math.max(1, 1 / camera.aspect))); animatingCam = true;
    }
  }
}
function renderStep() {
  const s = STEPS[step - 1];
  const chips = $('step-parts'); chips.replaceChildren();
  [...new Set(nodes.filter((x) => x.step === step).map((x) => x.key))].forEach((k) => {
    const b = el('button', PARTS[k].zh); b.onclick = () => selectPart(k, null, false); chips.append(b);
  });
  $('step-title').textContent = `組裝流程 ${step} / ${STEPS.length}：${s.title}`;
  $('step-text').textContent = s.text; $('step-safety').hidden = !s.safety;
  $('step-list').querySelectorAll('li').forEach((li, i) => li.classList.toggle('on', i === step - 1));
  $('step-prev').disabled = step <= 1; $('step-next').disabled = step >= STEPS.length;
  refreshLook();
}
$('step-prev').onclick = () => { stopPlay(); goStep(Math.max(1, step - 1)); };
$('step-next').onclick = () => { stopPlay(); goStep(Math.min(STEPS.length, step + 1)); };
WIRING.forEach(([a, b, c], i) => {
  const tr = el('tr', null, WIRING_LINKS[i]?.[4] || ''); tr.append(el('td', a), el('td', b), el('td', `${c}（待實機核對）`));
  tr.onclick = () => selectWire(wireSel === i ? -1 : i); $('wiring-table').tBodies[0].append(tr);
});
CHECKS.forEach((c, i) => {
  const li = el('li'); const lab = el('label'); const cb = el('input'); cb.type = 'checkbox'; cb.id = `chk-${i}`;
  try { cb.checked = localStorage.getItem(`f450twin-chk-${i}`) === '1'; } catch { /* 無痕模式 */ }
  cb.onchange = () => { try { localStorage.setItem(`f450twin-chk-${i}`, cb.checked ? '1' : '0'); } catch { /* 略過 */ } checkProgress(); };
  lab.append(cb, el('span', c)); li.append(lab); $('check-list').append(li);
});
function checkProgress() { const all = [...$('check-list').querySelectorAll('input')]; $('check-progress').textContent = `（${all.filter((x) => x.checked).length} / ${all.length}）`; }
$('check-reset').onclick = () => { $('check-list').querySelectorAll('input').forEach((cb, i) => { cb.checked = false; try { localStorage.removeItem(`f450twin-chk-${i}`); } catch { /* 略過 */ } }); checkProgress(); };
checkProgress();

// ───────── 引線標籤與藍色虛線導引 ─────────
const labelEls = LABELS.map(([k, a, b]) => {
  const d = el('div', null, 'lbl'); d.style.display = 'none'; d.append(el('b', a)); if (b) d.append(el('span', b));  // 載入前先隱藏
  d.onclick = () => selectPart(k, null, true); $('labels').append(d); return d;
});
const svg = $('leaders');
const guideGroup = new THREE.Group(); scene.add(guideGroup);
const guideMat = new THREE.LineDashedMaterial({ color: 0x46c2ff, dashSize: 7, gapSize: 6, transparent: true, opacity: 0.85 });
const guides = [];
function buildGuides() {
  for (const n of nodes) {
    if (n.explode.lengthSq() < 1) continue;
    const g = new THREE.BufferGeometry().setFromPoints([n.c0.clone(), n.c0.clone()]);
    const line = new THREE.Line(g, guideMat); guideGroup.add(line); guides.push({ n, line });
  }
}
const v = new THREE.Vector3();
function updateOverlays() {
  const r = host.getBoundingClientRect();
  const W = r.width, H = r.height;
  const anchors = LABELS.map(([k, , , kw]) => {
    const n = nodes.find((x) => x.key === k && x.name.includes(kw)) || nodes.find((x) => x.key === k);
    if (!n || !n.obj.visible || dimmed(n) || !showLabels || mode === 'size') return null;   // 尺寸模式只留尺寸標註
    v.copy(n.c0).add(n.obj.position).sub(n.base).project(camera);
    if (v.z > 1) return null;
    return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H };
  });
  // 左右分邊並避免重疊：同側依 y 排序，最小間距 34px
  const side = anchors.map((a) => (a ? (a.x < W / 2 ? 'left' : 'right') : null));
  const ly = anchors.map((a) => (a ? a.y : 0));
  for (const s of ['left', 'right']) {
    const idx = anchors.map((a, i) => i).filter((i) => side[i] === s).sort((a, b) => ly[a] - ly[b]);
    let last = -1e9, lastH = 0;
    for (const i of idx) {                    // 標籤高度：兩行約 36px、一行約 18px；中心距 = 兩者半高相加＋間隙
      const h = labelEls[i].offsetHeight || (LABELS[i][2] ? 40 : 20);   // 以實際渲染高度避讓
      ly[i] = Math.max(ly[i], last + (lastH + h) / 2 + 8); last = ly[i]; lastH = h;
    }
  }
  let lines = '';
  anchors.forEach((a, i) => {
    const d = labelEls[i];
    if (!a) { d.style.display = 'none'; return; }
    const lw = d.offsetWidth || 90;   // 標籤寬度：確保整個標籤留在畫面內
    const lx = side[i] === 'left' ? Math.max(lw + 10, Math.min(a.x - 70, W * 0.28)) : Math.min(W - lw - 10, Math.max(a.x + 70, W * 0.72));
    d.style.display = ''; d.className = `lbl ${side[i]}${LABELS[i][0] === selectedKey ? ' on' : ''}`;
    d.style.left = `${side[i] === 'left' ? lx - 6 : lx + 6}px`; d.style.top = `${ly[i]}px`;
    lines += `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${lx.toFixed(1)}" y2="${ly[i].toFixed(1)}"/><circle cx="${a.x.toFixed(1)}" cy="${a.y.toFixed(1)}" r="2.6"/>`;
  });
  svg.innerHTML = lines;
  // 虛線導引：從組裝位置連到目前位置（只在拆解時顯示）
  for (const { n, line } of guides) {
    const show = n.obj.visible && !dimmed(n) && layerNow[n.layer] > 0.02;
    line.visible = show; if (!show) continue;
    const pos = line.geometry.attributes.position;
    v.copy(n.c0).add(n.obj.position).sub(n.base);
    pos.setXYZ(0, n.c0.x, n.c0.y, n.c0.z); pos.setXYZ(1, v.x, v.y, v.z); pos.needsUpdate = true;
    line.computeLineDistances();
  }
}

// ───────── 照片依據的貼紙 ─────────
function addPhotoDecals() {
  const find = (k, kw) => nodes.find((x) => x.key === k && x.name.includes(kw));
  const gps = find('gps', 'GPS M8N');
  if (gps) {   // GPS 頂面白色圓環
    const b = new THREE.Box3().setFromObject(gps.obj), c = b.getCenter(new THREE.Vector3()), r = Math.min(b.max.x - b.min.x, b.max.z - b.min.z) / 2;
    const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.68, r * 0.8, 48), new THREE.MeshStandardMaterial({ color: 0xe8ecef, roughness: 0.5 }));
    ring.rotation.x = -Math.PI / 2; ring.position.copy(gps.obj.worldToLocal(new THREE.Vector3(c.x, b.max.y + 0.25, c.z))); gps.obj.add(ring);
  }
  const bat = find('battery', 'Battery 4S');
  if (bat) {   // 電池側面白色條碼貼紙
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 96; const g = cv.getContext('2d');
    g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, 256, 96); g.fillStyle = '#111';
    for (let x = 20, i = 0; x < 236; i++) { const w = [2, 1, 3, 1, 2, 4][i % 6]; g.fillRect(x, 18, w, 52); x += w + [2, 3, 1, 2][i % 4]; }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const b = new THREE.Box3().setFromObject(bat.obj), c = b.getCenter(new THREE.Vector3());
    const label = new THREE.Mesh(new THREE.PlaneGeometry((b.max.z - b.min.z) * 0.42, (b.max.y - b.min.y) * 0.55), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
    label.rotation.y = Math.PI / 2; label.position.copy(bat.obj.worldToLocal(new THREE.Vector3(b.max.x + 0.3, c.y, c.z))); bat.obj.add(label);
  }
}

// ───────── 接線圖：3D 連線與流動光點 ─────────
const wireGroup = new THREE.Group(); scene.add(wireGroup);
const wires = [];   // { tube, pulses, curve, kind, from, to, i }
let wireSel = -1, wireFilter = 'all';
const anchorNode = (key, kw) => nodes.find((x) => x.key === key && x.name.includes(kw)) || nodes.find((x) => x.key === key);
function buildWires() {
  WIRING_LINKS.forEach(([fk, fkw, tk, tkw, kind], i) => {
    const from = anchorNode(fk, fkw), to = anchorNode(tk, tkw); if (!from || !to) return;
    const a = from.c0.clone(), b = to.c0.clone();
    const mid = a.clone().lerp(b, 0.5); mid.y += 30 + a.distanceTo(b) * 0.25 + (i % 4) * 6;   // 弧線拉高，避免穿過機身
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const color = kind === 'power' ? 0xff6a4d : 0x3fd0ff;
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 1.3, 6, false), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }));
    const pulses = [0, 1, 2].map(() => { const sph = new THREE.Mesh(new THREE.SphereGeometry(3.2, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff })); wireGroup.add(sph); return sph; });
    wireGroup.add(tube); wires.push({ tube, pulses, curve, kind, from, to, i });
  });
  wireGroup.visible = false;
}
function selectWire(i) {
  wireSel = i; hotNodes.clear();
  [...$('wiring-table').tBodies[0].rows].forEach((r, k) => r.classList.toggle('on', k === i));
  if (i >= 0) { const w = wires.find((x) => x.i === i); if (w) { hotNodes.add(w.from); hotNodes.add(w.to); } }
  refreshLook();
}
document.querySelectorAll('[data-wire]').forEach((b) => (b.onclick = () => {
  wireFilter = b.dataset.wire; document.querySelectorAll('[data-wire]').forEach((x) => x.classList.toggle('on', x === b)); selectWire(-1);
}));
// 2026-11-06：「▶ 接線教學」——依序播放每一條連線：3D 只顯示該線並高亮兩端零件，下方顯示「從 → 到：用途」
let wirePlayTimer = null;
function stopWirePlay() {
  if (wirePlayTimer) { clearInterval(wirePlayTimer); wirePlayTimer = null; }
  $('wire-play').textContent = '▶ 接線教學';
}
$('wire-play').onclick = () => {
  if (wirePlayTimer) { stopWirePlay(); return; }
  let k = -1;
  const total = WIRING.length;
  const step = () => {
    k += 1;
    if (k >= total) { stopWirePlay(); selectWire(-1); $('wire-caption').textContent = '接線教學播放完畢。接線前務必先拆槳，並對照實機外殼印字。'; return; }
    selectWire(k);
    const [a, b, c] = WIRING[k];
    $('wire-caption').hidden = false;
    $('wire-caption').textContent = `第 ${k + 1}／${total} 條：${a} → ${b}｜${c}`;
    $('wiring-table').tBodies[0].rows[k]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  $('wire-play').textContent = '⏸ 暫停';
  step();
  wirePlayTimer = setInterval(step, 3000);
};
// 手動點表格列或切換篩選時，停止自動播放
$('wiring-table').addEventListener('click', stopWirePlay);
document.querySelectorAll('[data-wire]').forEach((b) => b.addEventListener('click', stopWirePlay));

function updateWiring() {
  wireGroup.visible = mode === 'wiring'; if (!wireGroup.visible) return;
  const t = performance.now() / 1600;
  for (const w of wires) {
    const show = wireSel >= 0 ? w.i === wireSel : (wireFilter === 'all' || wireFilter === w.kind);
    w.tube.visible = show;
    w.pulses.forEach((pl, k) => { pl.visible = show; if (show) pl.position.copy(w.curve.getPoint((t + k / 3) % 1)); });
  }
}

// ───────── 尺寸規格：3D 標註與兩點量測 ─────────
const dimGroup = new THREE.Group(); scene.add(dimGroup);
const dimMat = new THREE.LineBasicMaterial({ color: 0xffc857 }), estMat = new THREE.LineBasicMaterial({ color: 0xff9f6b }), measMat = new THREE.LineBasicMaterial({ color: 0x3ddc97 });
const dims = [];   // { line, a, b, label }
let showDims = true;
function addDim(a, b, text, cls, mat) {
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), mat); dimGroup.add(line);
  const label = el('div', text, `dimlbl ${cls}`); label.style.display = 'none'; $('dimlabels').append(label);
  const d = { line, a, b, label }; dims.push(d); return d;
}
function buildDims(box) {
  const m = (kw) => anchorNode('motor', kw).c0.clone();
  const fr = m('Motor FR'), rl = m('Motor RL'), fl = m('Motor FL');
  const top = box.max.y + 12;
  addDim(fr.clone().setY(top), rl.clone().setY(top), '對角軸距 450 mm（DJI 手冊）', '', dimMat);
  addDim(fl.clone().setY(top - 8), fr.clone().setY(top - 8), `相鄰電機間距 約 ${Math.round(fl.distanceTo(fr))} mm（推算）`, '', dimMat);
  const x0 = box.max.x + 30;
  addDim(new THREE.Vector3(x0, box.min.y, box.max.z), new THREE.Vector3(x0, box.max.y, box.max.z), `高 約 ${Math.round(box.max.y - box.min.y)} mm（模型估計）`, 'est', estMat);
  const z0 = box.max.z + 30;
  addDim(new THREE.Vector3(box.min.x, box.min.y, z0), new THREE.Vector3(box.max.x, box.min.y, z0), `含槳寬 約 ${Math.round(box.max.x - box.min.x)} mm（模型估計）`, 'est', estMat);
  dimGroup.visible = false;
}
const measure = { on: false, picks: [], dim: null };
$('measure-toggle').onclick = () => {
  measure.on = !measure.on; measure.picks = []; hotNodes.clear(); $('measure-toggle').classList.toggle('on', measure.on);
  $('measure-out').textContent = measure.on ? '請在 3D 上依序點兩個零件' : ''; refreshLook();
};
$('dims-toggle').onclick = (e) => { showDims = !showDims; e.currentTarget.classList.toggle('on', showDims); };
function pickMeasure(n) {
  if (measure.picks.length >= 2) { measure.picks = []; hotNodes.clear(); }
  measure.picks.push(n); hotNodes.add(n); refreshLook();
  if (measure.picks.length === 2) {
    const [a, b] = measure.picks.map((x) => x.c0.clone());
    if (measure.dim) { dimGroup.remove(measure.dim.line); measure.dim.label.remove(); dims.splice(dims.indexOf(measure.dim), 1); }
    const mm = a.distanceTo(b);
    measure.dim = addDim(a, b, `${Math.round(mm)} mm（模型估計，非實測）`, 'meas', measMat);
    $('measure-out').textContent = `${PARTS[measure.picks[0].key].zh} ↔ ${PARTS[measure.picks[1].key].zh}：中心距約 ${Math.round(mm)} mm（模型估計，非實測）`;
  } else $('measure-out').textContent = `已選 ${PARTS[n.key].zh}，請再點第二個零件`;
}
function updateDims() {
  dimGroup.visible = mode === 'size';
  const r = host.getBoundingClientRect();
  for (const d of dims) {
    const vis = mode === 'size' && (showDims || d === measure.dim);
    d.line.visible = vis;
    if (!vis) { d.label.style.display = 'none'; continue; }
    v.copy(d.a).lerp(d.b, 0.5).project(camera);
    d.label.style.display = v.z > 1 ? 'none' : '';
    const hw = (d.label.offsetWidth || 120) / 2 + 4;   // 標籤保持在 3D 畫面內
    d.label.style.left = `${Math.min(r.width - hw, Math.max(hw, (v.x * 0.5 + 0.5) * r.width))}px`; d.label.style.top = `${(-v.y * 0.5 + 0.5) * r.height}px`;
  }
}
SIZE_REFS.forEach(([a, b, src, tag]) => {
  const tr = el('tr'); const td = el('td'); td.append(el('span', tag === 'ref' ? 'REFERENCE' : '待核對', `tag ${tag}`), document.createTextNode(src));
  tr.append(el('th', a), el('td', b), td); $('size-refs').append(tr);
});

// ───────── 載入 ─────────
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(new DRACOLoader().setDecoderPath('./vendor/three/draco/'));   // Draco 壓縮模型（Apache-2.0 解碼器）
let tLoaded = 0;
function loadModel() {
const onModel = (gltf) => {
  tLoaded = performance.now();
  scene.add(gltf.scene); prepare(gltf.scene); addPhotoDecals(); buildGuides(); buildWires();
  buildDims(new THREE.Box3().setFromObject(gltf.scene));
  const box = new THREE.Box3().setFromObject(gltf.scene); box.getCenter(modelCenter);
  const size = box.getSize(new THREE.Vector3());
  grid.position.y = box.min.y - 1; shadowGround.position.y = box.min.y - 0.5; tgtGoal.copy(modelCenter); controls.target.copy(modelCenter);
  const h = Math.round(size.y), w = Math.round(Math.max(size.x, size.z));
  $('sz-h').textContent = `約 ${h} mm`; $('sz-w').textContent = `約 ${w} mm`;
  $('dim-h').textContent = `高 約 ${h} mm`; $('dim-w').textContent = `含槳寬 約 ${w} mm（模型估計）`;
  $('loading').remove();
  // 網址參數（驗收截圖用）：mode、explode、layer、select、step、view
  switchMode(query.get('mode') || 'explode');
  if (query.has('explode')) { const x = Number(query.get('explode')) / 100; setLayers(x); }
  for (const L in layerNow) layerNow[L] = layerGoal[L];
  applyPositions();   // 先套用位移，聚焦才會對到目前位置
  if (query.get('step')) { step = Math.min(STEPS.length, Math.max(1, Number(query.get('step')))); renderStep(); }
  if (query.get('wirefilter')) document.querySelector(`[data-wire="${query.get('wirefilter')}"]`)?.click();
  if (query.get('wire')) selectWire(Number(query.get('wire')));
  if (query.get('layer')) pickLayer(Number(query.get('layer')));
  if (query.get('view')) setView(query.get('view'));
  if (query.get('pip') === '1') $('toggle-pip').click();
  const sel = query.get('select') || (mode === 'wiring' ? 'wiring' : 'pixhawk');
  if (PARTS[sel]) selectPart(sel, null, query.get('frame') === '1');
  refreshLook();
  camera.position.copy(camGoal); controls.target.copy(tgtGoal); animatingCam = false;
  if (query.get('scroll')) $(query.get('scroll'))?.scrollIntoView({ block: 'start' });   // 截圖用：捲到指定區塊
};
const onFail = (err) => {
  const l = $('loading'); if (!l) return;
  l.replaceChildren(el('p', `模型載入失敗：${String(err.message || err).slice(0, 120)}。請重新整理；若在 App 內建瀏覽器開啟，可改用 Chrome 或 Safari。`));   // 訊息截短，避免整段 base64 顯示
  const b = el('button', '重新載入模型'); b.onclick = () => { l.textContent = '正在重新載入…'; loadModel(); }; l.append(b); l.style.pointerEvents = 'auto';
};
if (window.__F450_GLB_B64) {   // 桌面單檔版：模型以 base64 內嵌，直接解析（file:// 不能用 fetch）
  const bin = Uint8Array.from(atob(window.__F450_GLB_B64), (c) => c.charCodeAt(0)).buffer;
  gltfLoader.parse(bin, '', onModel, onFail);
} else {
  gltfLoader.load('./models/f450-l2-r8-twin.glb?v=r8-1', onModel, (ev) => {
    const l = $('loading'); if (l && ev.total) l.textContent = `正在載入 F450 模型… ${Math.round((ev.loaded / ev.total) * 100)}%`;
  }, onFail);
}
}
loadModel();
// 效能量測（?perf=1）：首屏時間、繪製統計、記憶體、平均 FPS，寫入 document.title 供自動化讀取
if (query.get('perf') === '1') {
  let frames = 0, t1 = 0;
  const count = () => { if (tLoaded) { if (!t1) t1 = performance.now(); frames++; } if (!t1 || performance.now() - t1 < 3000) requestAnimationFrame(count); else report(); };
  const report = () => {
    const nav = performance.getEntriesByType('navigation')[0];
    const res = performance.getEntriesByType('resource').reduce((a, r) => a + (r.transferSize || r.encodedBodySize || 0), 0);
    const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1;
    const i = renderer.info;
    document.title = `PERF model_ready_ms=${Math.round(tLoaded - T0)} dom_ms=${Math.round(nav?.domContentLoadedEventEnd || 0)} bytes=${res} heap_mb=${mem} geometries=${i.memory.geometries} textures=${i.memory.textures} calls=${i.render.calls} tris=${i.render.triangles} fps=${(frames / ((performance.now() - t1) / 1000)).toFixed(1)}`;
  };
  requestAnimationFrame(count);
}

// FPS 監測：載入後 3 秒內平均低於 24 FPS 就關閉後處理與陰影
let fpsT0 = 0, fpsN = 0, fpsDone = false;
function fpsGuard() {
  if (fpsDone || !composer || !nodes.length) return;
  const t = performance.now(); if (!fpsT0) { fpsT0 = t; return; }
  fpsN++; if (t - fpsT0 > 3000) { fpsDone = true; const fps = fpsN / ((t - fpsT0) / 1000); if (fps < 24 && query.get('fx') !== '1') disableFX(`平均 ${fps.toFixed(1)} FPS`); }
}
const tmp = new THREE.Vector3();
function applyPositions() {   // 依各層拆解程度放置零件
  for (const n of nodes) { n.obj.position.copy(n.base).add(tmp.copy(n.explode).multiplyScalar(Math.max(layerNow[n.layer] * distScale, n.fly))); n.obj.updateMatrixWorld(true); }
}
(function tick() {
  for (const L in layerNow) layerNow[L] += (layerGoal[L] - layerNow[L]) * 0.12;
  for (const n of nodes) if (n.fly > 0.001) n.fly *= 0.93; else n.fly = 0;   // 組裝飛入動畫
  applyPositions();
  controls.update();
  if (animatingCam) { camera.position.lerp(camGoal, 0.1); controls.target.lerp(tgtGoal, 0.1); if (camera.position.distanceTo(camGoal) < 0.5) animatingCam = false; }
  if (nodes.length) { updateOverlays(); updateWiring(); updateDims(); }
  if (composer) composer.render(); else renderer.render(scene, camera);
  fpsGuard();
  requestAnimationFrame(tick);
})();
