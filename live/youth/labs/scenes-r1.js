// R1 四課的三維演示場景（U01 零件、U02 安全、U04 電機、U05 電池）：全部程式生成，自製模型
// 介面與 U09 場景相同：setTime(t) 依時間軸更新畫面並回傳 { hud }，setView(v) 切視角，dispose() 釋放
import { THREE, makeStage, buildQuad, spinProps, label } from './three-kit.js';
import { COMMUTATION, mechanicalAngle } from '../core/physics.js';

const ease = x => x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x);
const HI = 0xff8a00;   // 目前講解的零件（橘色）

function phaseIndex(phases, t) { let i = 0; phases.forEach((p, k) => { if (t >= p.t) i = k; }); return i; }

function base(host, cam, target) {
  const st = makeStage(host, { bg: 0xe4f0ff, cam, target, grid: false });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: 0xf4f7fb }));
  ground.rotation.x = -Math.PI / 2; st.scene.add(ground);
  const grid = new THREE.GridHelper(30, 60, 0xc9d6ea, 0xdfe7f3); grid.position.y = 0.001; st.scene.add(grid);
  let views = {};
  return {
    st, setViews: v => { views = v; },
    setView(v) { const k = v === 'reset' ? 'three' : v; if (views[k]) { st.camera.position.set(...views[k][0]); st.controls.target.set(...views[k][1]); } }
  };
}

function kid(h = 1.6, color = 0x2f6bf0) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xf2c9a0 }), shirt = new THREE.MeshStandardMaterial({ color }), pants = new THREE.MeshStandardMaterial({ color: 0x24324d });
  const legH = h * 0.47, bodyH = h * 0.3, r = h * 0.075;
  for (const x of [-0.09, 0.09]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, legH, 10), pants); l.position.set(x, legH / 2, 0); g.add(l); }
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.14, bodyH, 14), shirt); b.position.y = legH + bodyH / 2; g.add(b);
  const hd = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), skin); hd.position.y = legH + bodyH + r * 1.2; g.add(hd);
  return g;
}

// 把零件群組染成橘色高亮或恢復原色
function tint(obj, on) {
  obj.traverse(o => { if (o.material?.emissive) { o.material.emissive.setHex(on ? HI : 0); o.material.emissiveIntensity = on ? 0.55 : 0; } });
}
function fade(obj, opacity) {
  obj.traverse(o => { if (o.material) { o.material.transparent = opacity < 1; o.material.opacity = opacity; o.material.depthWrite = opacity >= 1; } });
}

// ---------- U01 認識無人機：整機 → 機架 → 動力 → 飛控 → 電池 ----------
function u01(host, demo) {
  const B = base(host, [2.2, 1.8, 2.6], [0, 0.4, 0]);
  B.setViews({ three: [[2.2, 1.8, 2.6], [0, 0.4, 0]], top: [[0, 3.6, 0.01], [0, 0, 0]], side: [[3.2, 0.7, 0], [0, 0.4, 0]] });
  const q = buildQuad(); q.position.y = 0.35; B.st.scene.add(q);
  const P = Object.fromEntries(q.userData.parts.map(p => [p.key, p]));
  const groups = {
    frame: ['frame'], power: ['motor1', 'motor2', 'motor3', 'motor4', 'esc1', 'esc2', 'esc3', 'esc4', 'prop1', 'prop2', 'prop3', 'prop4'],
    brain: ['fc', 'gps', 'rx'], battery: ['battery']
  };
  const names = { whole: '整機（6 大零件）', frame: '機架與機臂', power: '電機・電調・螺旋槳', brain: '飛控・GPS・接收機', battery: '鋰電池' };
  const tag = label('機頭', { size: 0.1, color: '#c0123d' }); tag.position.set(0, 0.75, -0.75); B.st.scene.add(tag);
  let spin = 0, cur = -1;
  B.st.onFrame(dt => { spinProps(q, dt, spin); });
  return {
    setTime(t) {
      const i = phaseIndex(demo.phases, t), key = demo.phases[i].key, local = t - demo.phases[i].t;
      if (i !== cur) {
        cur = i;
        q.userData.parts.forEach(p => { tint(p.obj, false); fade(p.obj, key === 'whole' ? 1 : 0.25); });
        fade(q.userData.shell, key === 'whole' ? 0.95 : 0.12);
        (groups[key] || []).forEach(k => { tint(P[k].obj, true); fade(P[k].obj, 1); });
      }
      q.rotation.y = key === 'whole' ? t * 0.4 : q.rotation.y;
      spin = key === 'power' ? 1 : 0;
      P.battery.obj.position.y = P.battery.home.y + (key === 'battery' ? 0.35 * ease(local / 3) : 0);
      return { hud: names[key] };
    },
    setView: B.setView, dispose: () => B.st.dispose()
  };
}

// ---------- U02 飛行安全：飛前檢查 → 場地判斷 → 站位 → 失控處理 → 收機 ----------
function u02(host, demo) {
  const B = base(host, [5.5, 4.5, 7], [0, 0.6, 0.5]);
  B.setViews({ three: [[5.5, 4.5, 7], [0, 0.6, 0.5]], top: [[0, 11, 0.6], [0, 0, 0.6]], side: [[9, 1.6, 0.5], [0, 0.6, 0.5]] });
  const s = B.st.scene;
  const q = buildQuad({ scale: 0.35 }); s.add(q);
  const student = kid(1.6); student.position.set(0, 0, 3); s.add(student);
  const friend = kid(1.5, 0x1f9d55); friend.position.set(0.9, 0, 4.2); s.add(friend);
  // 禁飛區（人群）紅色圓盤＋人物
  const no = new THREE.Mesh(new THREE.CircleGeometry(1.6, 40), new THREE.MeshBasicMaterial({ color: 0xff3355, transparent: true, opacity: 0.22 }));
  no.rotation.x = -Math.PI / 2; no.position.set(-4, 0.01, -2); s.add(no);
  const crowd = new THREE.Group(); [[-4.5, -2.3], [-3.6, -1.6], [-4.1, -1.2], [-3.4, -2.6]].forEach(([x, z], k) => { const c = kid(1.2 + k * 0.08, 0xd84a6a); c.position.set(x, 0, z); crowd.add(c); }); s.add(crowd);
  const noTag = label('人群：禁止上方飛行', { size: 0.22, color: '#b3123d' }); noTag.position.set(-4, 2, -2); s.add(noTag);
  // 可飛區域（藍）與安全距離線（橘）
  const ok = new THREE.Mesh(new THREE.CircleGeometry(2.2, 40), new THREE.MeshBasicMaterial({ color: 0x2f8cff, transparent: true, opacity: 0.1 }));
  ok.rotation.x = -Math.PI / 2; ok.position.y = 0.012; s.add(ok);
  const dist = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0.3, 0.03, 0), new THREE.Vector3(0.3, 0.03, 3)]), new THREE.LineDashedMaterial({ color: HI, dashSize: 0.15, gapSize: 0.1 }));
  dist.computeLineDistances(); s.add(dist);
  const distTag = label('安全距離', { size: 0.16, color: '#b35a00' }); distTag.position.set(0.9, 0.2, 1.5); s.add(distTag);
  const checkTag = label('', { size: 0.2 }); s.add(checkTag);
  const checks = ['① 電量', '② 槳葉無裂', '③ 螺絲鎖緊', '④ 遙控連線', '⑤ GPS 定位'];
  const bat = q.userData.parts.find(p => p.key === 'battery');
  let spin = 0, lastCheck = -1;
  B.st.onFrame(dt => spinProps(q, dt, spin));
  const setCheck = txt => { s.remove(checkTag.userData.cur || checkTag); const l = label(txt, { size: 0.2 }); l.position.set(0, 1.1, 0); s.add(l); checkTag.userData.cur = l; };
  return {
    setTime(t) {
      const i = phaseIndex(demo.phases, t), key = demo.phases[i].key, local = t - demo.phases[i].t;
      no.visible = crowd.visible = noTag.visible = key === 'site' || key === 'lost';
      dist.visible = distTag.visible = key === 'stand' || key === 'lost';
      let y = 0, x = 0, z = 0; spin = 0;
      if (key === 'check') { const k = Math.min(4, Math.floor(local / 3)); if (k !== lastCheck) { lastCheck = k; setCheck(checks[k] + ' ✓'); } }
      else if (lastCheck !== -2) { lastCheck = -2; setCheck(key === 'lost' ? '⚠ 按緊急停止' : key === 'pack' ? '先拔電池' : ''); }
      if (key === 'stand') { spin = 0.2; }
      if (key === 'lost') { const k = Math.min(1, local / 8); y = local < 8 ? 1.2 + k * 0.3 : 1.5 * (1 - ease((local - 8) / 4)); x = -k * 1.2; z = -k * 0.6; spin = local < 8 ? 1 : 0.2 * (1 - ease((local - 8) / 2)); }
      q.position.set(x, y + 0.03, z);
      bat.obj.position.y = bat.home.y + (key === 'pack' ? 0.5 * ease((local - 2) / 3) : 0);
      const d = Math.hypot(student.position.x - x, student.position.z - z);
      return { hud: `${d.toFixed(1)} m` };
    },
    setView: B.setView, dispose: () => B.st.dispose()
  };
}

// ---------- U04 動力系統：拆電機 → 定子轉子 → 換相 → 反扭力 → 正反槳 ----------
function u04(host, demo) {
  const B = base(host, [1.8, 1.6, 2.2], [0, 0.5, 0]);
  B.setViews({ three: [[1.8, 1.6, 2.2], [0, 0.5, 0]], top: [[0, 3.2, 0.01], [0, 0, 0]], side: [[2.8, 0.6, 0], [0, 0.5, 0]] });
  const s = B.st.scene;
  const motor = new THREE.Group(); motor.position.y = 0.3; s.add(motor);
  const stator = new THREE.Group(); motor.add(stator);
  stator.add(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.3, 24), new THREE.MeshStandardMaterial({ color: 0x8c96a6, metalness: 0.6 })));
  const coils = [];
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    const c = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.035, 8, 16), new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 0.4 }));
    c.position.set(Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35); c.rotation.y = -a + Math.PI / 2; c.userData.phase = 'ABC'[i % 3]; coils.push(c); stator.add(c);
  }
  const rotor = new THREE.Group(); motor.add(rotor);
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.36, 40, 1, true), new THREE.MeshStandardMaterial({ color: 0x222831, metalness: 0.7, side: THREE.DoubleSide }));
  rotor.add(bell);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.04, 40), new THREE.MeshStandardMaterial({ color: 0xd23c3c, metalness: 0.5 })); cap.position.y = 0.2; rotor.add(cap);
  for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.2), new THREE.MeshStandardMaterial({ color: i % 2 ? 0x2f7cf6 : 0xe74c3c })); m.position.set(Math.cos(a) * 0.56, 0, Math.sin(a) * 0.56); m.rotation.y = -a; rotor.add(m); }
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.9, 10), new THREE.MeshStandardMaterial({ color: 0xcfd6df, metalness: 0.9 })); shaft.position.y = 0.15; motor.add(shaft);
  const tags = { stator: label('定子＋線圈（不動）', { size: 0.1 }), rotor: label('轉子＋磁鐵（會轉）', { size: 0.1 }) };
  Object.values(tags).forEach(l => s.add(l));
  // 反扭力示意：機臂與彎箭頭；正反槳：兩顆小電機
  const arm = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.05, 0.1), new THREE.MeshStandardMaterial({ color: 0x2b3a55 })); arm.position.y = 0.12; s.add(arm);
  const twist = label('機身被反向扭轉 ↺', { size: 0.12, color: '#b35a00' }); twist.position.set(0, 1.25, 0); s.add(twist);
  const pair = new THREE.Group(); s.add(pair);
  const mkProp = (x, dir) => { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.16, 20), new THREE.MeshStandardMaterial({ color: 0xd23c3c })); g.add(m); const bl = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.01, 0.07), new THREE.MeshStandardMaterial({ color: dir > 0 ? 0x222222 : 0x888888 })); bl.position.y = 0.1; g.add(bl); g.position.set(x, 0.3, 0); g.userData = { dir, bl }; const l = label(dir > 0 ? '逆時針 CCW' : '順時針 CW', { size: 0.09 }); l.position.set(0, 0.45, 0); g.add(l); pair.add(g); return g; };
  const pa = mkProp(-1.1, 1), pb = mkProp(1.1, -1);
  let rot = 0, body = 0, cur = -1;
  B.st.onFrame(dt => { pair.children.forEach(g => { g.userData.bl.rotation.y += g.userData.dir * dt * 18; }); });
  return {
    setTime(t) {
      const i = phaseIndex(demo.phases, t), key = demo.phases[i].key, local = t - demo.phases[i].t;
      const open = key === 'open' ? ease(local / 4) : key === 'parts' || key === 'commute' ? 1 : 0;   // 換相時轉子保持抬起，才看得到線圈發光
      rotor.position.y = open * 0.75;
      tags.stator.visible = tags.rotor.visible = key === 'parts' || key === 'open';
      tags.stator.position.set(0.7, 0.55, 0); tags.rotor.position.set(0.8, 0.3 + rotor.position.y + 0.35, 0);
      // 換相：每 0.5 秒一步，線圈依相位發光，轉子跟著轉
      const step = Math.floor(local * 2) % 6, c = COMMUTATION[step];
      coils.forEach(k => { const v = key === 'commute' ? c[k.userData.phase] : '0'; k.material.emissive.setHex(v === '0' ? 0 : HI); k.material.emissiveIntensity = v === '0' ? 0 : 0.9; });
      rot = key === 'commute' ? mechanicalAngle(Math.floor(local * 2) * 60) * Math.PI / 180 : key === 'torque' ? local * 4 : 0;
      rotor.rotation.y = -rot;
      motor.visible = key !== 'props';
      arm.visible = twist.visible = key === 'torque';
      body = key === 'torque' ? Math.sin(local * 1.2) * 0.25 + local * 0.02 : 0; arm.rotation.y = body;
      pair.visible = key === 'props';
      if (i !== cur) cur = i;
      const rpm = key === 'commute' || key === 'torque' ? '≈10,200 RPM' : key === 'props' ? '對角同向・相鄰相反' : '未通電';
      return { hud: rpm };
    },
    setView: B.setView, dispose: () => B.st.dispose()
  };
}

// ---------- U05 電池科學：單顆 → 串聯 3S → 並聯 2P → 4S/6S → 安全存放 ----------
function u05(host, demo) {
  u05.lastV = null;
  const B = base(host, [0, 2.2, 3.6], [0, 0.4, 0]);
  B.setViews({ three: [[0, 2.2, 3.6], [0, 0.4, 0]], top: [[0, 4.5, 0.01], [0, 0, 0]], side: [[4, 0.8, 0], [0, 0.4, 0]] });
  const s = B.st.scene;
  const cells = []; const group = new THREE.Group(); s.add(group);
  for (let k = 0; k < 6; k++) {
    const c = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.62, 0.12), new THREE.MeshStandardMaterial({ color: 0xe7f0ff }));
    const tab = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.04), new THREE.MeshStandardMaterial({ color: 0x3a6fd8 })); tab.position.y = 0.34;
    const l = label('3.7 V', { size: 0.09 }); l.position.y = 0;
    c.add(body, tab, l); c.userData = { body, l }; c.position.y = 0.32; cells.push(c); group.add(c);
  }
  const wires = new THREE.Group(); s.add(wires);
  const dots = []; for (let k = 0; k < 14; k++) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: HI })); s.add(d); dots.push(d); }
  const bag = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.6), new THREE.MeshStandardMaterial({ color: 0xc0392b, transparent: true, opacity: 0.35 })); bag.position.y = 0.45; s.add(bag);
  const bagTag = label('防爆袋', { size: 0.12, color: '#a32020' }); bagTag.position.set(0, 1.1, 0); s.add(bagTag);
  let path = [], cur = -1;
  const layout = (n, mode) => {
    wires.clear(); path = [];
    cells.forEach((c, k) => { c.visible = k < n; });
    const gap = 0.55;
    for (let k = 0; k < n; k++) {
      const c = cells[k];
      c.position.set((k - (n - 1) / 2) * gap, 0.32, 0); c.rotation.y = 0;   // 串並聯都面向鏡頭並排
    }
    const pts = [];
    if (mode === 'p') {
      // 並聯：正極接上方匯流排、負極接下方匯流排
      const xs = cells.slice(0, n).map(c => c.position.x), x0 = Math.min(...xs) - 0.3, x1 = Math.max(...xs) + 0.3;
      pts.push([new THREE.Vector3(x0, 0.82, 0), new THREE.Vector3(x1, 0.82, 0)]);
      for (const x of xs) pts.push([new THREE.Vector3(x, 0.82, 0), new THREE.Vector3(x, 0.68, 0)]);
      pts.push([new THREE.Vector3(x0, -0.02 + 0.03, 0.08), new THREE.Vector3(x1, 0.01, 0.08)]);
    }
    else for (let k = 0; k < n - 1; k++) pts.push([new THREE.Vector3(cells[k].position.x + 0.08, 0.68, 0), new THREE.Vector3(cells[k + 1].position.x - 0.08, 0.68, 0)]);
    pts.forEach(([a, b]) => { wires.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: HI }))); path.push([a, b]); });
  };
  const conf = { cell: [1, 's'], s3: [3, 's'], p2: [2, 'p'], s46: [6, 's'], store: [1, 's'] };
  return {
    setTime(t) {
      const i = phaseIndex(demo.phases, t), key = demo.phases[i].key, local = t - demo.phases[i].t;
      let n = conf[key][0];
      if (key === 's46') n = local < 8 ? 4 : 6;
      const sig = key + n;
      if (sig !== cur) { cur = sig; layout(n, conf[key][1]); }
      const v = key === 'store' ? 3.8 : 3.7;
      // 電壓標籤只在數值改變時重畫（避免每幀產生新貼圖）
      if (v !== u05.lastV) cells.forEach(c => { const nl = label(`${v.toFixed(1)} V`, { size: 0.09 }); c.remove(c.userData.l); c.userData.l = nl; nl.position.z = 0.08; c.add(nl); });
      u05.lastV = v;
      bag.visible = bagTag.visible = key === 'store';
      dots.forEach((d, k) => { if (!path.length || key === 'store') { d.visible = false; return; } const seg = path[k % path.length]; const f = ((t * 0.6 + k / dots.length) % 1); d.visible = true; d.position.lerpVectors(seg[0], seg[1], f); });
      const S = conf[key][1] === 's' ? n : 1, P = conf[key][1] === 'p' ? n : 1;
      return { hud: `${S}S${P}P・${(S * v).toFixed(1)} V・${1500 * P} mAh` };
    },
    setView: B.setView, dispose: () => B.st.dispose()
  };
}

const MAKERS = { 'u01-parts': u01, 'u02-safety': u02, 'u04-motor': u04, 'u05-battery': u05 };
export function createScene(kind, host, demo) {
  const f = MAKERS[kind]; if (!f) throw new Error(`找不到演示場景 ${kind}`);
  return f(host, demo);
}
