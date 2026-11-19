// R2 七課的三維演示場景（U03 四力、U06 姿態、U07 感測器、U08 組裝、U10 程式、U11 足球、U12 專題）
// 全部程式生成，自製模型；介面同 scenes-r1：setTime(t) → { hud }、setView(v)、dispose()
import { THREE, makeStage, buildQuad, spinProps, label } from './three-kit.js';
import { stabilize } from '../core/physics.js';

const ease = x => x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x);
const HI = 0xff8a00;
const phaseIndex = (P, t) => { let i = 0; P.forEach((p, k) => { if (t >= p.t) i = k; }); return i; };

function base(host, cam, target, views) {
  const st = makeStage(host, { bg: 0xe4f0ff, cam, target, grid: false });
  const g = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0xf4f7fb }));
  g.rotation.x = -Math.PI / 2; st.scene.add(g);
  const grid = new THREE.GridHelper(40, 80, 0xc9d6ea, 0xdfe7f3); grid.position.y = 0.001; st.scene.add(grid);
  return {
    st, setView(v) { const k = v === 'reset' ? 'three' : v; if (views[k]) { st.camera.position.set(...views[k][0]); st.controls.target.set(...views[k][1]); } },
    dispose: () => st.dispose()
  };
}
const glow = (o, on) => o.traverse(m => { if (m.material?.emissive) { m.material.emissive.setHex(on ? HI : 0); m.material.emissiveIntensity = on ? 0.7 : 0; } });
// 可重設長度的箭頭（長度 0 時隱藏）
function arrow(scene, dir, color) {
  const a = new THREE.ArrowHelper(new THREE.Vector3(...dir).normalize(), new THREE.Vector3(), 1, color, 0.18, 0.12);
  scene.add(a);
  return { a, set(origin, len) { a.visible = len > 0.02; a.position.copy(origin); if (a.visible) a.setLength(len, Math.min(0.2, len * 0.4), 0.12); } };
}

// ---------- U03 四力 ----------
function u03(host, demo) {
  const B = base(host, [2.6, 1.8, 3.2], [0, 1, 0], { three: [[2.6, 1.8, 3.2], [0, 1, 0]], top: [[0, 5, 0.01], [0, 0, 0]], side: [[4, 1.2, 0], [0, 1, 0]] });
  const s = B.st.scene, q = buildQuad({ scale: 0.6 }); s.add(q);
  const up = arrow(s, [0, 1, 0], 0x27ae60), down = arrow(s, [0, -1, 0], 0xe74c3c), fwd = arrow(s, [0, 0, -1], 0x2f6bf0), drag = arrow(s, [0, 0, 1], 0x8a95a8);
  const tags = { up: label('推力', { size: 0.12, color: '#13693a' }), down: label('重力', { size: 0.12, color: '#a32020' }), fwd: label('水平推力', { size: 0.1, color: '#1f4fc9' }), drag: label('阻力', { size: 0.1, color: '#555' }) };
  Object.values(tags).forEach(l => s.add(l));
  let spin = 0; B.st.onFrame(dt => spinProps(q, dt, spin));
  return {
    setTime(t) {
      const i = phaseIndex(demo.phases, t), key = demo.phases[i].key, local = t - demo.phases[i].t;
      let ratio = 0, y = 0, z = 0, tilt = 0;
      if (key === 'gravity') ratio = 0;
      if (key === 'thrust') ratio = 0.7 * ease(local / 5);
      if (key === 'hover') { ratio = 1; y = 1; }
      if (key === 'climb') { ratio = 1.4; y = 1 + 0.5 * ease(local / 10); }
      if (key === 'drag') { ratio = 1.1; y = 1.2; tilt = 0.25; z = -((local * 0.3) % 2.5); }
      spin = ratio === 0 ? 0 : 0.4 + ratio * 0.5;
      q.position.set(0, y + 0.05, z); q.rotation.x = -tilt;
      const o = q.position.clone().add(new THREE.Vector3(0, 0.15, 0));
      const G = 0.8;
      up.set(o, ratio * G); down.set(o, G); fwd.set(o, key === 'drag' ? 0.5 : 0); drag.set(o, key === 'drag' ? 0.35 : 0);
      tags.up.visible = ratio > 0; tags.up.position.copy(o).add(new THREE.Vector3(0.3, ratio * G, 0));
      tags.down.position.copy(o).add(new THREE.Vector3(0.3, -G, 0));
      tags.fwd.visible = tags.drag.visible = key === 'drag';
      tags.fwd.position.copy(o).add(new THREE.Vector3(0, 0.15, -0.6)); tags.drag.position.copy(o).add(new THREE.Vector3(0, 0.15, 0.5));
      return { hud: ratio.toFixed(1) };
    },
    setView: B.setView, dispose: B.dispose
  };
}

// ---------- U06 姿態 ----------
function u06(host, demo) {
  const B = base(host, [2, 1.6, 2.4], [0, 0.7, 0], { three: [[2, 1.6, 2.4], [0, 0.7, 0]], top: [[0, 3.5, 0.01], [0, 0, 0]], side: [[3, 0.8, 0], [0, 0.7, 0]] });
  const s = B.st.scene, q = buildQuad(); s.add(q);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 12), new THREE.MeshStandardMaterial({ color: 0x2f6bf0 }));
  nose.rotation.x = -Math.PI / 2; nose.position.set(0, 0.2, -0.45); q.add(nose);
  const M = [1, 2, 3, 4].map(n => q.userData.parts.find(p => p.key === `motor${n}`).obj);
  [1, 2, 3, 4].forEach(n => { const l = label(`M${n}`, { size: 0.08 }); l.position.copy(M[n - 1].position).add(new THREE.Vector3(0, 0.15, 0)); q.add(l); });
  const FAST = { thr: [0, 1, 2, 3], pitch: [1, 3], roll: [0, 3], yaw: [0, 1], combo: [1, 3, 0] };   // M2、M4 後；M1、M4 右；M1、M2 逆時針
  B.st.onFrame(dt => spinProps(q, dt, 0.8));
  return {
    setTime(t) {
      const i = phaseIndex(demo.phases, t), key = demo.phases[i].key, local = t - demo.phases[i].t;
      M.forEach((m, k) => glow(m, FAST[key].includes(k)));
      let y = 0.7, p = 0, r = 0, yaw = 0, hud = '';
      if (key === 'thr') { y = 0.5 + 0.4 * Math.sin(local * 0.8); hud = `高度 ${y.toFixed(2)} m`; }
      if (key === 'pitch') { p = 15 * ease(local / 3); hud = `前傾 ${p.toFixed(0)}°`; }
      if (key === 'roll') { r = -20 * ease(local / 3); hud = `左滾 ${(-r).toFixed(0)}°`; }
      if (key === 'yaw') { yaw = Math.min(90, local * 12); hud = `偏航 ${yaw.toFixed(0)}°`; }
      if (key === 'combo') { p = 10; yaw = local * 10 % 360; hud = `前傾 10°＋轉向 ${yaw.toFixed(0)}°`; }
      q.position.y = y; q.rotation.set(-p * Math.PI / 180, -yaw * Math.PI / 180, -r * Math.PI / 180, 'YXZ');
      return { hud };
    },
    setView: B.setView, dispose: B.dispose
  };
}

// ---------- U07 感測器 ----------
function u07(host, demo) {
  const B = base(host, [2.2, 1.8, 2.8], [0, 0.9, 0], { three: [[2.2, 1.8, 2.8], [0, 0.9, 0]], top: [[0, 5, 0.01], [0, 0, 0]], side: [[3.2, 1, 0], [0, 0.9, 0]] });
  const s = B.st.scene, q = buildQuad(); s.add(q);
  const axes = new THREE.AxesHelper(0.5); axes.position.y = 0.15; q.add(axes);
  const g = arrow(s, [0, -1, 0], HI);
  const sats = new THREE.Group(); for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.2), new THREE.MeshStandardMaterial({ color: 0xcfd6df, metalness: 0.7 })); m.position.set(Math.cos(a) * 2.5, 3.2 + (k % 2) * 0.3, Math.sin(a) * 2.5); sats.add(m); } s.add(sats);
  const lines = new THREE.Group(); s.add(lines);
  const needle = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.3, 8), new THREE.MeshStandardMaterial({ color: 0xe74c3c })); needle.rotation.x = Math.PI / 2; s.add(needle);
  let ang = 0, rate = 0, lastT = 0;
  B.st.onFrame(dt => spinProps(q, dt, 0.8));
  return {
    setTime(t) {
      const i = phaseIndex(demo.phases, t), key = demo.phases[i].key, local = t - demo.phases[i].t;
      let y = 0.9, roll = 0, yaw = 0, hud = '';
      sats.visible = lines.visible = needle.visible = key === 'gps';
      g.set(q.position.clone().add(new THREE.Vector3(0, 0.15, 0)), key === 'accel' ? 0.6 : 0);
      if (key === 'gyro') { const w = Math.sin(local * 0.8) * 60; yaw = -Math.cos(local * 0.8) * 75 + 75; hud = `角速度 ${w.toFixed(0)} °/s`; }
      if (key === 'accel') { roll = 25 * Math.sin(local * 0.5); hud = `重力分量 Y ${Math.sin(roll * Math.PI / 180).toFixed(2)} g`; }
      if (key === 'baro') { y = 0.9 + 1.6 * ease(local / 12); const rise = (y - 0.9) * 8; hud = `高度 +${rise.toFixed(0)} m・${(1013.25 - rise / 8).toFixed(2)} hPa`; }   // 畫面高度放大 8 倍示意；每升 8 m 少 1 hPa
      if (key === 'gps') {
        if (!lines.children.length) sats.children.forEach(m => lines.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([m.position, new THREE.Vector3(0, 1, 0)]), new THREE.LineDashedMaterial({ color: 0x2f8cff, dashSize: 0.1, gapSize: 0.08 }))));
        lines.children.forEach(l => l.computeLineDistances());
        needle.position.set(0.8, 0.05, 0.8); hud = `衛星 ${Math.min(6, 2 + Math.floor(local / 2))} 顆・機頭朝北`;
      }
      if (key === 'loop') {
        // 一陣風把機身吹歪，再由 PD 回饋扶正（以時間積分模擬）
        if (local < 0.1 || t < lastT) { ang = 0.5; rate = 0; }
        const n = Math.max(1, Math.ceil((t - lastT) * 60)); for (let k = 0; k < n && t > lastT; k++) ({ angle: ang, rate } = stabilize(ang, rate, (t - lastT) / n, true, 4, 2));
        roll = ang * 180 / Math.PI; hud = `傾角 ${roll.toFixed(1)}°`;
      }
      lastT = t;
      q.position.y = y; q.rotation.set(0, -yaw * Math.PI / 180, -roll * Math.PI / 180, 'YXZ');
      return { hud };
    },
    setView: B.setView, dispose: B.dispose
  };
}

// ---------- U08 組裝 ----------
function u08(host, demo) {
  const B = base(host, [2.2, 1.8, 2.6], [0, 0.3, 0], { three: [[2.2, 1.8, 2.6], [0, 0.3, 0]], top: [[0, 3.6, 0.01], [0, 0, 0]], side: [[3.2, 0.8, 0], [0, 0.3, 0]] });
  const s = B.st.scene, q = buildQuad(); q.position.y = 0.05; s.add(q);
  const parts = q.userData.parts;
  const stage = { frame: ['frame'], motor: ['motor1', 'motor2', 'motor3', 'motor4'], esc: ['esc1', 'esc2', 'esc3', 'esc4'], fc: ['fc', 'rx'], check: ['gps', 'battery', 'shell', 'prop1', 'prop2', 'prop3', 'prop4'] };
  const order = demo.phases.map(p => p.key);
  const redArm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.55), new THREE.MeshStandardMaterial({ color: 0xe74c3c })); redArm.position.set(0.2, 0.06, -0.2); redArm.rotation.y = Math.PI / 4; q.add(redArm);
  B.st.onFrame(dt => spinProps(q, dt, 0));
  return {
    setTime(t) {
      const i = phaseIndex(demo.phases, t), key = demo.phases[i].key, local = t - demo.phases[i].t;
      let count = 0;
      parts.forEach(p => {
        const si = order.findIndex(k => stage[k].includes(p.key));
        const shown = si < i || (si === i);
        p.obj.visible = shown;
        const f = si < i ? 1 : si === i ? ease(local / 4) : 0;
        p.obj.position.lerpVectors(p.explode, p.home, f);
        glow(p.obj, si === i);
        if (si <= i) count++;
      });
      redArm.visible = true;
      return { hud: `${count} / ${parts.length}` };
    },
    setView: B.setView, dispose: B.dispose
  };
}

// ---------- U10 程式（俯視航線）----------
function u10(host, demo) {
  const B = base(host, [0, 6, 4.5], [0, 0, 0], { three: [[0, 6, 4.5], [0, 0, 0]], top: [[0, 8, 0.01], [0, 0, 0]], side: [[6, 1.5, 0], [0, 0.5, 0]] });
  const s = B.st.scene, q = buildQuad({ scale: 0.4 }); s.add(q);
  const plan = new THREE.Group(), trail = new THREE.Group(); s.add(plan, trail);
  const line = (pts, color, dashed) => { const g = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p[0], 0.03, p[1]))); const m = dashed ? new THREE.LineDashedMaterial({ color, dashSize: 0.15, gapSize: 0.1 }) : new THREE.LineBasicMaterial({ color }); const l = new THREE.Line(g, m); if (dashed) l.computeLineDistances(); return l; };
  const home = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.35, 32), new THREE.MeshBasicMaterial({ color: 0x27ae60, side: THREE.DoubleSide })); home.rotation.x = -Math.PI / 2; home.position.y = 0.02; s.add(home);
  const SQ = [[0, 0], [0, -2], [2, -2], [2, 0], [0, 0]].map(([x, z]) => [x - 1, z + 1]);
  const ROUTES = {
    seq: { plan: [[-1, 1], [-1, -1]], cmds: ['起飛', '前進 2 m', '降落'] },
    loop: { plan: SQ, cmds: ['重複 4 次：前進 2 m、右轉 90°'] },
    cond: { plan: [[-1, 1], [-1, -1], [1, -1], [-1, 1]], cmds: ['如果 電量 < 30%：返航'] },
    route: { plan: [[-1, 1], [-2, -1], [0, -2], [2, -1], [1, 1], [-1, 1]], cmds: ['依航點巡航'] },
    debug: { plan: SQ, bad: [[-1, 1], [-1, -1], [-3, -1]], cmds: ['第 3 行「左轉」→ 改成「右轉」'] }
  };
  let cur = '';
  const along = (pts, f) => { const segs = pts.length - 1, u = Math.min(segs - 1e-6, f * segs), k = Math.floor(u), r = u - k; return [pts[k][0] + (pts[k + 1][0] - pts[k][0]) * r, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * r]; };
  B.st.onFrame(dt => spinProps(q, dt, 0.8));
  return {
    setTime(t) {
      const i = phaseIndex(demo.phases, t), key = demo.phases[i].key, local = t - demo.phases[i].t, R = ROUTES[key];
      if (cur !== key) { cur = key; plan.clear(); trail.children.forEach(l => l.geometry.dispose()); trail.clear(); plan.add(line(R.plan, 0x2f8cff, true)); if (R.bad) plan.add(line(R.bad, 0xe74c3c, false)); }
      const f = ease(Math.min(1, local / 12));
      const pts = key === 'debug' && local < 6 ? R.bad : R.plan;
      const ff = key === 'debug' ? (local < 6 ? ease(local / 6) : ease((local - 6) / 8)) : f;
      const [x, z] = along(pts, ff);
      q.position.set(x, 0.5, z);
      const n = 30; const tp = []; for (let k = 0; k <= n; k++) tp.push(along(pts, ff * k / n));
      // 重用同一條軌跡線，只換頂點，避免每幀產生新物件
      if (!trail.children.length) trail.add(line(tp, HI, false)); else { const l = trail.children[0]; l.geometry.dispose(); l.geometry = new THREE.BufferGeometry().setFromPoints(tp.map(p => new THREE.Vector3(p[0], 0.03, p[1]))); }
      const bat = key === 'cond' ? Math.max(20, 100 - local * 7) : null;
      return { hud: bat != null ? `${R.cmds[0]}（電量 ${bat.toFixed(0)}%${bat <= 30 ? '・返航中' : ''}）` : R.cmds[Math.min(R.cmds.length - 1, Math.floor(f * R.cmds.length))] };
    },
    setView: B.setView, dispose: B.dispose
  };
}

// ---------- U11 足球（縮小版球場）----------
function u11(host, demo) {
  const B = base(host, [0, 6, 9], [0, 1, 0], { three: [[0, 6, 9], [0, 1, 0]], top: [[0, 12, 0.01], [0, 0, 0]], side: [[0, 1.6, 9], [0, 1.4, 0]] });
  const s = B.st.scene;
  const turf = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), new THREE.MeshStandardMaterial({ color: 0x3fae5a })); turf.rotation.x = -Math.PI / 2; turf.position.y = 0.005; s.add(turf);
  const net = new THREE.Mesh(new THREE.BoxGeometry(12, 3.5, 6), new THREE.MeshBasicMaterial({ color: 0x2f6bf0, wireframe: true, transparent: true, opacity: 0.15 })); net.position.y = 1.75; s.add(net);
  const rings = {}; for (const [k, x, c] of [['blue', -5.5, 0x2f8cff], ['red', 5.5, 0xff3b6b]]) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.07, 12, 40), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: c, emissiveIntensity: 0.3 })); r.position.set(x, 1.6, 0); r.rotation.y = Math.PI / 2; s.add(r); rings[k] = r; }
  const ball = (color, id) => { const g = buildQuad({ cage: true, scale: 0.22 }); g.userData.cage.material.color.setHex(color); const l = label(id, { size: 0.3, color: color === 0x2f8cff ? '#0b4bb3' : '#b3123d' }); l.position.y = 2.6; g.add(l); s.add(g); return g; };
  const D = { B1: ball(0x2f8cff, 'B1 得分'), B2: ball(0x2f8cff, 'B2 輔攻'), B3: ball(0x2f8cff, 'B3 防守'), R1: ball(0xff3b6b, 'R1 得分'), R3: ball(0xff3b6b, 'R3 防守') };
  const route = new THREE.Line(new THREE.BufferGeometry().setFromPoints([[-3, 1.4, 1.8], [1, 1.6, 2.2], [4, 1.6, 1], [5.9, 1.6, 0]].map(p => new THREE.Vector3(...p))), new THREE.LineDashedMaterial({ color: HI, dashSize: 0.25, gapSize: 0.15 }));
  route.computeLineDistances(); s.add(route);
  const pts = [[-3, 1.4, 1.8], [1, 1.6, 2.2], [4, 1.6, 1], [5.9, 1.6, 0]];
  const along = f => { const u = Math.min(pts.length - 1 - 1e-6, f * (pts.length - 1)), k = Math.floor(u), r = u - k; return pts[k].map((v, j) => v + (pts[k + 1][j] - v) * r); };
  B.st.onFrame(dt => Object.values(D).forEach(d => spinProps(d, dt, 0.7)));
  return {
    setTime(t) {
      const i = phaseIndex(demo.phases, t), key = demo.phases[i].key, local = t - demo.phases[i].t;
      const home = { B1: [-3, 1.4, 1.8], B2: [-3, 1.8, -1.8], B3: [-4.6, 1.6, 0], R1: [3, 1.5, -1], R3: [4.6, 1.6, 0] };
      Object.entries(home).forEach(([k, p]) => D[k].position.set(...p));
      route.visible = key === 'attack' || key === 'shoot';
      let score = '0：0';
      if (key === 'ball') { D.B1.position.set(0, 1.6, 2); D.B1.rotation.y = local; }
      if (key === 'attack') { D.B1.position.set(...along(ease(local / 14) * 0.75)); D.B2.position.set(-3 + 5 * ease(local / 14), 1.9, -2); D.R3.position.set(4.6 - 1.2 * ease(local / 14), 1.7, -1.2 * ease(local / 14)); }
      if (key === 'defend') { D.R1.position.set(3 - 6.5 * ease(local / 12), 1.6, -1 + ease(local / 12)); D.B3.position.set(-4.6, 1.6, 0); }   // 防守機守在自家圓環正前方、同高
      if (key === 'shoot') { D.B1.position.set(...along(0.75 + 0.25 * ease(local / 6))); if (local > 6) { D.B1.position.x = 5.9 + (local - 6) * 0.15; score = '1：0'; } }
      return { hud: score };
    },
    setView: B.setView, dispose: B.dispose
  };
}

// ---------- U12 專題（3D 長條圖）----------
function u12(host, demo) {
  const B = base(host, [0, 2.2, 4.2], [0, 0.8, 0], { three: [[0, 2.2, 4.2], [0, 0.8, 0]], top: [[0, 5, 0.01], [0, 0, 0]], side: [[4.5, 1, 0], [0, 0.8, 0]] });
  const s = B.st.scene;
  const data = [['3S', 16.7], ['4S', 22.2], ['6S', 33.3]];
  const bars = data.map(([n, v], k) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1, 0.45), new THREE.MeshStandardMaterial({ color: 0x2f8cff })); m.position.set((k - 1) * 0.9, 0, 0); s.add(m); const l = label(`${n}`, { size: 0.14 }); l.position.set((k - 1) * 0.9, -0.15, 0.4); s.add(l); const vl = label(`${v} Wh`, { size: 0.12 }); s.add(vl); return { m, v, vl }; });
  const q = buildQuad({ scale: 0.35 }); q.position.set(-2.2, 0.6, 0); s.add(q);
  const board = { ask: '問題：S 數和能量有什麼關係？', hypo: '假設：S 數 2 倍 → 能量 2 倍', exp: '實驗：3S／4S／6S 各測 3 次', rec: '紀錄：畫成長條圖', show: '結論：假設成立 ✓' };
  let cur = '', tag = null;
  B.st.onFrame(dt => spinProps(q, dt, 0.6));
  return {
    setTime(t) {
      const i = phaseIndex(demo.phases, t), key = demo.phases[i].key, local = t - demo.phases[i].t;
      if (cur !== key) { cur = key; if (tag) s.remove(tag); tag = label(board[key], { size: 0.18, color: '#1f4fc9' }); tag.position.set(0, 2.1, 0); s.add(tag); }
      const grow = key === 'rec' ? ease(local / 8) : key === 'show' ? 1 : 0;
      bars.forEach(b => { const h = Math.max(0.001, b.v / 33.3 * 1.5 * grow); b.m.scale.y = h; b.m.position.y = h / 2; b.m.visible = grow > 0; b.vl.visible = grow > 0.9; b.vl.position.set(b.m.position.x, h + 0.15, 0.25); glow(b.m, key === 'show' && b.v === 33.3); });
      q.visible = key === 'exp' || key === 'hypo';
      q.position.y = 0.6 + Math.sin(t * 2) * 0.05;
      return { hud: `${i + 1} / 5・${demo.phases[i].label}` };
    },
    setView: B.setView, dispose: B.dispose
  };
}

const MAKERS = { 'u03-forces': u03, 'u06-attitude': u06, 'u07-sensors': u07, 'u08-assembly': u08, 'u10-coding': u10, 'u11-soccer': u11, 'u12-stem': u12 };
export function createScene(kind, host, demo) {
  const f = MAKERS[kind]; if (!f) throw new Error(`找不到演示場景 ${kind}`);
  return f(host, demo);
}
export const KINDS = Object.keys(MAKERS);
