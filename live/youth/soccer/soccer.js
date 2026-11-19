// 無人機足球 3D 專項訓練（Drone Soccer 3D Training Lab）
// 版面：上方模式分頁｜左欄球機名單與戰術｜中央 3D 場｜右欄即時數值與任務｜底部演示與計時
// 飛行模型為「教學級運動學近似」（core/physics.js stepDrone），不是經驗證的真實飛行物理
import { THREE, makeStage, buildQuad, spinProps, label } from '../labs/three-kit.js';
import { stepDrone, passedRing, hoverOk } from '../core/physics.js';
import { createStick } from '../core/input.js';

const FIELD = { x: 9, z: 5, h: 5 };
const RING_Y = 2, RING_R = 0.65;
const RINGS = { red: { x: 8, y: RING_Y, z: 0, r: RING_R }, blue: { x: -8, y: RING_Y, z: 0, r: RING_R } };

export const MODES = [
  { id: 'free', name: '自由練習', goal: '熟悉操作：起飛、移動、轉向、降落。沒有計分。' },
  { id: 'hover', name: '定點飛行', goal: '飛到中圈黃色標記上方 1.5 m（±15 cm）並保持 10 秒。' },
  { id: 'ring', name: '穿越球門', goal: '從場內方向穿過紅隊圓環球門（右端）一次。' },
  { id: 'attack', name: '進攻路線', goal: '依序穿過 3 個藍色路線點，再穿過紅隊圓環，越快越好。' },
  { id: 'defend', name: '防守戰術', goal: '紅隊得分機會沿路線衝向藍隊圓環（左端）。在它穿門前碰到它就算成功攔截。' },
  { id: 'timed', name: '計時挑戰', goal: '60 秒內盡量多次穿過紅隊圓環；每次得分後要先回到中線左側才能再得分。' }
];

// 課堂預設戰術：各球機的路線點 [x, y, z]
const PRESETS = {
  flank: { name: '側翼突破', desc: '輔攻機 B2 從上方邊路吸引防守，進攻機 B1 從下方邊路切入穿門。',
    routes: { B1: [[-6, 1.5, 3], [0, 1.8, 3.6], [5, 2, 2], [8.6, 2, 0]], B2: [[-6, 1.5, -3], [0, 2.2, -3.8], [6, 2.4, -1.5]], B3: [[-7, 2, 0]] } },
  swap: { name: '換位掩護', desc: 'B1 與 B2 在中場交叉換位，讓對手看不清誰是得分機。',
    routes: { B1: [[-6, 1.5, 2], [-1, 2, -1.5], [4, 2, -0.5], [8.6, 2, 0]], B2: [[-6, 1.5, -2], [-1, 2, 1.5], [4, 2.2, 1.5]], B3: [[-7.2, 2, 0]] } },
  goalD: { name: '門前防守', desc: '防守機 B3 停在自家圓環前 1 m、與圓環同高；B2 在中場攔截。',
    routes: { B1: [[-2, 1.5, 0]], B2: [[-4, 2, 1.5], [-4, 2, -1.5]], B3: [[-7, 2, 0]] } }
};

export function mount(host, ctx) {
  host.innerHTML = `
  <div class="soccer">
    <div class="sc-top">
      <nav class="sc-modes" id="sc-modes">${MODES.map(m => `<button data-m="${m.id}">${m.name}</button>`).join('')}</nav>
      <button class="btn ghost small" id="sc-rc">遙控器設定</button>
    </div>
    <aside class="card sc-left">
      <div class="sc-row"><b>場上球機</b><small>3 對 3</small></div>
      <ul class="sc-team" id="sc-team">
        ${['B1 進攻機（你）', 'B2 輔攻機', 'B3 防守機'].map((n, i) => `<li class="blue" data-id="B${i + 1}"><span>B${i + 1}</span>${n.slice(3)}</li>`).join('')}
        ${['R1 進攻機', 'R2 輔攻機', 'R3 防守機'].map((n, i) => `<li class="red" data-id="R${i + 1}"><span>R${i + 1}</span>${n.slice(3)}</li>`).join('')}
      </ul>
      <div class="sc-row"><b>課堂預設</b></div>
      <div class="sc-presets">${Object.entries(PRESETS).map(([k, p]) => `<button data-p="${k}">${p.name}</button>`).join('')}</div>
      <p class="sc-desc" id="sc-desc">選一個預設戰術，或在「俯視」畫面點場地替選中的球機畫路線點。</p>
      <div class="sc-row"><button class="btn ghost small" id="sc-save">保存戰術</button><button class="btn ghost small" id="sc-load">讀取戰術</button><button class="btn ghost small" id="sc-clear">清除路線</button></div>
    </aside>
    <div class="sc-stage" id="sc-stage">
      <div class="sc-views" id="sc-views">${[['all', '全景'], ['top', '俯視'], ['side', '側視'], ['pilot', '飛手視角'], ['follow', '跟隨']].map(([k, n]) => `<button data-v="${k}">${n}</button>`).join('')}</div>
      <div class="sc-score" id="sc-score"><b>藍 <span id="sc-sb">0</span></b><i id="sc-clock">--:--</i><b><span id="sc-sr">0</span> 紅</b></div>
      <div class="sc-banner" id="sc-banner" hidden></div>
      <div class="sticks" id="sc-sticks"><div class="stick" id="st-l" aria-label="左搖桿：油門與偏航"></div><div class="stick" id="st-r" aria-label="右搖桿：俯仰與橫滾"></div></div>
      <p class="sc-note">教學級模擬，不代表真實飛行物理</p>
    </div>
    <aside class="card sc-right">
      <div class="kpis two"><div><small>高度 m</small><b id="sc-h">0.00</b></div><div><small>速度 m/s</small><b id="sc-v">0.00</b></div></div>
      <div class="kpis two"><div><small>機頭朝向</small><b id="sc-yaw">0°</b></div><div><small>操控來源</small><b id="sc-src">鍵盤</b></div></div>
      <div id="sc-conn" class="state"></div>
      <h4 id="sc-mname">任務</h4>
      <p id="sc-goal" class="small"></p>
      <div class="meter"><i id="sc-prog"></i></div>
      <p id="sc-status" class="small muted"></p>
      <div class="sc-row"><button class="btn" id="sc-start">開始任務</button><button class="btn danger" id="sc-estop">緊急停止</button></div>
      <details class="small"><summary>操作說明</summary>
        <p>鍵盤：W/S 上升下降、A/D 左右轉、方向鍵前後左右、空白鍵緊急停止。</p>
        <p>觸控：左搖桿＝油門＋偏航，右搖桿＝俯仰＋橫滾。</p>
        <p>USB 遙控器：插上後按任一鍵喚醒，預設美國手（左油門）。可在「遙控器設定」校準與改通道。</p></details>
    </aside>
    <div class="sc-bottom card">
      <button class="btn ok" id="sc-demo">▶ 演示路線</button>
      <span id="sc-demo-st" class="muted small">已暫停／可準備</span>
      <label class="small">倍速 <select id="sc-speed"><option>0.5</option><option selected>1</option><option>2</option></select></label>
      <span class="muted small">任務完成會自動保存成績</span>
    </div>
  </div>`;
  const $ = s => host.querySelector(s);
  const st = makeStage($('#sc-stage'), { bg: 0x0b1a3a, cam: [-4, 10, 15], target: [0, 1, 0], grid: false });
  const scene = st.scene;
  scene.fog = new THREE.Fog(0x0b1a3a, 25, 60);

  // ---- 場地：草皮、中線中圈、網籠框架（紅藍兩半）、圓環球門 ----
  const turf = new THREE.Mesh(new THREE.PlaneGeometry(FIELD.x * 2, FIELD.z * 2), new THREE.MeshStandardMaterial({ color: 0x3fae5a }));
  turf.rotation.x = -Math.PI / 2; scene.add(turf);
  for (let i = -FIELD.x; i < FIELD.x; i += 2) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(1, FIELD.z * 2), new THREE.MeshStandardMaterial({ color: 0x4cbc66 }));
    strip.rotation.x = -Math.PI / 2; strip.position.set(i + 0.5, 0.002, 0); scene.add(strip);
  }
  const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff });
  const ln = pts => { const g = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p[0], 0.01, p[1]))); scene.add(new THREE.Line(g, lineMat)); };
  ln([[0, -FIELD.z], [0, FIELD.z]]);
  ln([[-FIELD.x, -FIELD.z], [FIELD.x, -FIELD.z], [FIELD.x, FIELD.z], [-FIELD.x, FIELD.z], [-FIELD.x, -FIELD.z]]);
  const circ = []; for (let i = 0; i <= 48; i++) { const a = i / 48 * Math.PI * 2; circ.push([Math.cos(a) * 1.6, Math.sin(a) * 1.6]); } ln(circ);
  const beam = (x1, y1, z1, x2, y2, z2, color) => {
    const len = Math.hypot(x2 - x1, y2 - y1, z2 - z1);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, len), new THREE.MeshStandardMaterial({ color, roughness: 0.4 }));
    m.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2); m.lookAt(x2, y2, z2); scene.add(m);
  };
  for (const [side, color] of [[-1, 0x2f8cff], [1, 0xff3b6b]]) {
    // 只畫外圍框架（四角立柱＋頂部邊框），中線不立柱，避免擋住視線；紅藍各半
    const xe = side * FIELD.x;
    for (const z of [-FIELD.z, FIELD.z]) beam(xe, 0, z, xe, FIELD.h, z, color);
    for (const z of [-FIELD.z, FIELD.z]) beam(0, FIELD.h, z, xe, FIELD.h, z, color);
    beam(xe, FIELD.h, -FIELD.z, xe, FIELD.h, FIELD.z, color);
    for (const z of [-FIELD.z, FIELD.z]) beam(0, 0.05, z, xe, 0.05, z, color);   // 底部邊框
  }
  const net = new THREE.Mesh(new THREE.BoxGeometry(FIELD.x * 2, FIELD.h, FIELD.z * 2), new THREE.MeshBasicMaterial({ color: 0x9cc8ff, wireframe: true, transparent: true, opacity: 0.08 }));
  net.position.y = FIELD.h / 2; scene.add(net);
  const ringMesh = {};
  for (const [k, r] of Object.entries(RINGS)) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r.r, 0.09, 16, 48), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: k === 'red' ? 0x551122 : 0x112255 }));
    ring.position.set(r.x, r.y, r.z); ring.rotation.y = Math.PI / 2; scene.add(ring); ringMesh[k] = ring;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, r.y - r.r), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
    pole.position.set(r.x, (r.y - r.r) / 2, r.z); scene.add(pole);
  }
  const hoverPad = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 32), new THREE.MeshBasicMaterial({ color: 0xffd400, side: THREE.DoubleSide }));
  hoverPad.rotation.x = -Math.PI / 2; hoverPad.position.y = 0.02; scene.add(hoverPad);

  // ---- 球機：玩家 B1＋其他 5 台（AI 或演示用）----
  const mk = (id, color) => {
    const g = buildQuad({ cage: true, scale: 0.28 });
    g.userData.cage.material.color.setHex(color);
    const tag = label(id, { size: 0.32, color: color === 0x2f8cff ? '#0b4bb3' : '#b3123d' }); tag.position.y = 0.55 / 0.28; g.add(tag);
    scene.add(g); return g;
  };
  const drones = {
    B1: mk('B1', 0x2f8cff), B2: mk('B2', 0x2f8cff), B3: mk('B3', 0x2f8cff),
    R1: mk('R1', 0xff3b6b), R2: mk('R2', 0xff3b6b), R3: mk('R3', 0xff3b6b)
  };
  const HOME = { B1: [-6, 0, 0], B2: [-6, 0, -2.5], B3: [-7.5, 0, 1.5], R1: [6, 0, 0], R2: [6, 0, 2.5], R3: [7.5, 0, -1.5] };
  let me, others;
  const resetPositions = () => {
    me = { x: -6, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: -Math.PI / 2, armed: true };
    others = {};
    for (const [id, p] of Object.entries(HOME)) {
      if (id === 'B1') continue;
      others[id] = { x: p[0], y: id.startsWith('R') ? 1.5 : 1.2, z: p[2] };
    }
  };
  resetPositions();

  // ---- 路線點（戰術編排）----
  const routes = { B1: [], B2: [], B3: [], R1: [], R2: [], R3: [] };
  const routeGroup = new THREE.Group(); scene.add(routeGroup);
  let selected = 'B1';
  const drawRoutes = () => {
    routeGroup.clear();
    for (const [id, pts] of Object.entries(routes)) {
      if (!pts.length) continue;
      const col = id.startsWith('B') ? 0x7fb6ff : 0xff8fb0;
      pts.forEach((p, i) => {
        const s = new THREE.Mesh(new THREE.SphereGeometry(id === selected ? 0.16 : 0.11, 12, 8), new THREE.MeshBasicMaterial({ color: id === selected ? 0xff5fa2 : col }));
        s.position.set(...p); routeGroup.add(s);
        if (i) { const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...pts[i - 1]), new THREE.Vector3(...p)]); routeGroup.add(new THREE.Line(g, new THREE.LineDashedMaterial({ color: col, dashSize: 0.3, gapSize: 0.2 }))); routeGroup.children.at(-1).computeLineDistances(); }
      });
    }
  };
  host.querySelectorAll('#sc-team li').forEach(li => li.onclick = () => {
    selected = li.dataset.id; host.querySelectorAll('#sc-team li').forEach(x => x.classList.toggle('sel', x === li)); drawRoutes();
  });
  host.querySelectorAll('[data-p]').forEach(b => b.onclick = () => {
    const p = PRESETS[b.dataset.p]; Object.keys(routes).forEach(k => { routes[k] = (p.routes[k] || []).map(x => [...x]); });
    $('#sc-desc').textContent = `${p.name}：${p.desc}`; drawRoutes(); ctx.log?.('preset', b.dataset.p);
  });
  $('#sc-clear').onclick = () => { Object.keys(routes).forEach(k => { routes[k] = []; }); drawRoutes(); };
  $('#sc-save').onclick = () => { try { localStorage.setItem('fde-youth-tactic', JSON.stringify(routes)); $('#sc-desc').textContent = '戰術已保存在這台裝置。'; } catch { $('#sc-desc').textContent = '這個瀏覽器不允許保存。'; } };
  $('#sc-load').onclick = () => {
    try { const r = JSON.parse(localStorage.getItem('fde-youth-tactic') || 'null'); if (r) { Object.assign(routes, r); drawRoutes(); $('#sc-desc').textContent = '已讀取保存的戰術。'; } else $('#sc-desc').textContent = '還沒有保存過戰術。'; } catch { /* 略 */ }
  };
  // 俯視時點草皮新增路線點
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  st.renderer.domElement.addEventListener('click', e => {
    if (view !== 'top') return;
    const r = st.renderer.domElement.getBoundingClientRect();
    ptr.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ptr, st.camera); const hit = ray.intersectObject(turf)[0];
    if (hit) { routes[selected].push([+hit.point.x.toFixed(2), 1.8, +hit.point.z.toFixed(2)]); drawRoutes(); }
  });

  // ---- 視角 ----
  let view = 'all';
  const setView = v => {
    view = v; host.querySelectorAll('#sc-views button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
    st.controls.enabled = v === 'all' || v === 'top' || v === 'side';
    if (v === 'all') { st.camera.position.set(-4, 10, 15); st.controls.target.set(0, 1, 0); }
    if (v === 'top') { st.camera.position.set(0, 22, 0.01); st.controls.target.set(0, 0, 0); }
    if (v === 'side') { st.camera.position.set(0, 2.5, 15); st.controls.target.set(0, 1.5, 0); }
    if (v === 'pilot') { st.camera.position.set(-FIELD.x - 1.5, 1.6, 0); }
  };
  host.querySelectorAll('#sc-views button').forEach(b => b.onclick = () => setView(b.dataset.v));
  setView('all');

  // ---- 虛擬搖桿（觸控／滑鼠）----
  const vs = ctx.input?.virtual || { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
  createStick($('#st-l'), (x, y) => { vs.yaw = x; vs.throttle = y; if (ctx.input) ctx.input.virtualActive = true; });
  createStick($('#st-r'), (x, y) => { vs.roll = x; vs.pitch = y; if (ctx.input) ctx.input.virtualActive = true; });

  // ---- 任務狀態 ----
  let mode = null, running = false, t = 0, prog = 0, score = { b: 0, r: 0 }, armedForGoal = true, cp = 0, prev = null, demo = false, demoT = 0;
  const CHECKS = [[-2, 2, 3], [2, 2, -3], [5.5, 2, 0]];
  const cpGroup = new THREE.Group(); scene.add(cpGroup);
  const banner = (txt, ok = true) => { const b = $('#sc-banner'); b.hidden = false; b.textContent = txt; b.className = 'sc-banner ' + (ok ? 'ok' : 'bad'); clearTimeout(banner.t); banner.t = setTimeout(() => { b.hidden = true; }, 2500); };
  const setMode = id => {
    mode = MODES.find(m => m.id === id); running = false; t = 0; prog = 0; cp = 0; score = { b: 0, r: 0 }; armedForGoal = true;
    host.querySelectorAll('#sc-modes button').forEach(b => b.classList.toggle('on', b.dataset.m === id));
    $('#sc-mname').textContent = mode.name; $('#sc-goal').textContent = mode.goal; $('#sc-status').textContent = '按「開始任務」開始。';
    $('#sc-start').textContent = '開始任務'; hoverPad.visible = id === 'hover';
    cpGroup.clear();
    if (id === 'attack') CHECKS.forEach((c, i) => { const r = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.06, 10, 32), new THREE.MeshBasicMaterial({ color: 0x5fb0ff })); r.position.set(...c); r.rotation.y = Math.PI / 2; r.userData.i = i; cpGroup.add(r); });
    resetPositions(); if (ctx.input) ctx.input.estop = false; updateScore();
  };
  host.querySelectorAll('#sc-modes button').forEach(b => b.onclick = () => setMode(b.dataset.m));
  const updateScore = () => { $('#sc-sb').textContent = score.b; $('#sc-sr').textContent = score.r; };
  const finish = (ok, extra = {}) => {
    running = false; $('#sc-start').textContent = '再試一次';
    const rec = { mode: mode.id, modeName: mode.name, ok, seconds: +t.toFixed(1), score: score.b, ...extra };
    ctx.saveRun?.(rec); banner(ok ? `任務完成！用時 ${t.toFixed(1)} 秒` : '任務未完成，再試一次', ok);
    $('#sc-status').textContent = ok ? `完成，成績已保存（${t.toFixed(1)} 秒${mode.id === 'timed' ? `、${score.b} 分` : ''}）。` : '未完成。調整路線再試一次。';
    if (ok) ctx.done?.(rec);
  };
  $('#sc-start').onclick = () => { setMode(mode.id); running = true; $('#sc-status').textContent = '任務進行中…'; $('#sc-start').textContent = '重新開始'; if (mode.id === 'defend') { others.R1 = { x: 6, y: 2, z: 2.5 }; } };
  $('#sc-estop').onclick = () => { if (ctx.input) ctx.input.estop = true; me.armed = false; banner('已緊急停止：動力關閉，球機下降', false); };
  $('#sc-rc').onclick = () => ctx.openRc?.();
  $('#sc-demo').onclick = () => { demo = !demo; demoT = 0; $('#sc-demo').textContent = demo ? '⏸ 暫停演示' : '▶ 演示路線'; $('#sc-demo-st').textContent = demo ? '演示中：球機依路線點飛行' : '已暫停／可準備'; };

  const follow = (obj, pts, sp, dt) => {   // 沿路線點等速前進（演示與 AI 用）
    if (!pts.length) return;
    obj._i ??= 0; const tg = pts[Math.min(obj._i, pts.length - 1)];
    const dx = tg[0] - obj.x, dy = tg[1] - obj.y, dz = tg[2] - obj.z, d = Math.hypot(dx, dy, dz);
    if (d < 0.15) { if (obj._i < pts.length - 1) obj._i++; return; }
    const k = Math.min(1, sp * dt / d); obj.x += dx * k; obj.y += dy * k; obj.z += dz * k;
  };

  let lastConn = null;
  ctx.input?.onChange?.(s => { lastConn = s; });
  st.onFrame(dt => {
    const inp = ctx.input ? ctx.input.read() : { throttle: 0, yaw: 0, pitch: 0, roll: 0, source: '鍵盤' };
    if (ctx.input?.estop) me.armed = false;
    prev = { ...me };
    // 物理以固定 1/60 秒細分計算：幀率低的裝置（平板、舊電腦）飛行速度與判定仍一致
    if (!demo) { const n = Math.max(1, Math.ceil(dt * 60)); for (let i = 0; i < n; i++) me = stepDrone(me, inp, dt / n, { bounds: FIELD }); }
    else { demoT += dt * +$('#sc-speed').value; follow(me, routes.B1.length ? routes.B1 : PRESETS.flank.routes.B1, 3 * +$('#sc-speed').value, dt); }
    for (const [id, o] of Object.entries(others)) {
      if (demo && routes[id]?.length) follow(o, routes[id], 3 * +$('#sc-speed').value, dt);
      else if (running && mode?.id === 'defend' && id === 'R1') follow(o, [[0, 2, 1.5], [-5, 2, -0.5], [-8.8, 2, 0]], 1.6 + t * 0.03, dt);
      else o.y += ((id.startsWith('R') ? 1.5 : 1.2) + Math.sin(performance.now() / 700 + id.charCodeAt(1)) * 0.1 - o.y) * dt;
    }
    // 更新 3D
    const d = drones.B1; d.position.set(me.x, me.y + 0.15, me.z); d.rotation.set(0, 0, 0); d.rotateY(me.yaw); d.rotateX(-(me.pitchDeg || 0) * Math.PI / 180); d.rotateZ(-(me.rollDeg || 0) * Math.PI / 180);
    spinProps(d, dt, me.armed ? 0.5 + Math.max(0, inp.throttle) : 0);
    for (const [id, o] of Object.entries(others)) { drones[id].position.set(o.x, o.y, o.z); spinProps(drones[id], dt, 0.6); drones[id].rotation.y = id.startsWith('R') ? Math.PI / 2 : -Math.PI / 2; }
    if (view === 'follow') { const back = new THREE.Vector3(Math.sin(me.yaw) * 3, 1.6, Math.cos(me.yaw) * 3); st.camera.position.lerp(new THREE.Vector3(me.x, me.y, me.z).add(back), 0.1); st.controls.target.set(me.x, me.y, me.z); }
    if (view === 'pilot') st.controls.target.set(me.x, me.y, me.z);
    // 數值面板
    $('#sc-h').textContent = me.y.toFixed(2); $('#sc-v').textContent = Math.hypot(me.vx, me.vz).toFixed(2);
    $('#sc-yaw').textContent = `${Math.round((((-me.yaw * 180 / Math.PI) % 360) + 360) % 360)}°`; $('#sc-src').textContent = inp.source;
    const conn = $('#sc-conn');
    if (lastConn?.lostAt && !lastConn.connected && Date.now() - lastConn.lostAt < 15000) { conn.className = 'state over'; conn.textContent = 'USB 遙控器已斷線！已改用鍵盤／虛擬搖桿，請放開搖桿並檢查連線。'; }
    else if (ctx.input?.estop) { conn.className = 'state over'; conn.textContent = '緊急停止中：按「開始任務」解除。'; }
    else { conn.className = 'state ok'; conn.textContent = lastConn?.connected ? `已連接：${(lastConn.name || '').slice(0, 40)}` : '未偵測到 USB 遙控器（可用鍵盤或虛擬搖桿）'; }
    // 任務判定
    if (!running || !mode) { $('#sc-clock').textContent = '--:--'; return; }
    t += dt;
    const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    $('#sc-clock').textContent = mode.id === 'timed' ? fmt(Math.max(0, 60 - t)) : fmt(t);
    const scored = passedRing(prev, me, RINGS.red) && prev.x < me.x;
    if (mode.id === 'hover') {
      prog = hoverOk(me, { x: 0, y: 1.5, z: 0 }) ? prog + dt : Math.max(0, prog - dt * 2);
      $('#sc-prog').style.width = `${prog / 10 * 100}%`; $('#sc-status').textContent = `保持中 ${prog.toFixed(1)} / 10 秒（高度 ${me.y.toFixed(2)} m）`;
      if (prog >= 10) finish(true);
    } else if (mode.id === 'ring') {
      $('#sc-prog').style.width = `${Math.max(0, Math.min(100, (me.x + 6) / 14 * 100))}%`;
      if (scored) { score.b++; updateScore(); finish(true); }
    } else if (mode.id === 'attack') {
      const c = CHECKS[cp];
      if (c && Math.hypot(me.x - c[0], me.y - c[1], me.z - c[2]) < 0.8) { cpGroup.children[cp].material.color.setHex(0x3fd17a); cp++; banner(`路線點 ${cp}/3`); }
      $('#sc-prog').style.width = `${(cp + (scored ? 1 : 0)) / 4 * 100}%`; $('#sc-status').textContent = cp < 3 ? `前往路線點 ${cp + 1}` : '穿過紅隊圓環！';
      if (scored && cp >= 3) { score.b++; updateScore(); finish(true, { checkpoints: 3 }); }
      else if (scored) banner('要先依序穿過 3 個路線點', false);
    } else if (mode.id === 'defend') {
      const r1 = others.R1;
      $('#sc-prog').style.width = `${Math.max(0, Math.min(100, (6 - r1.x) / 14.8 * 100))}%`;
      if (Math.hypot(me.x - r1.x, me.y - r1.y, me.z - r1.z) < 0.9) { finish(true, { blocked: true }); others.R1 = { x: 6, y: 1.5, z: 0 }; }
      else if (r1.x <= -8.5) { score.r++; updateScore(); finish(false, { blocked: false }); }
    } else if (mode.id === 'timed') {
      if (me.x < 0) armedForGoal = true;
      if (scored && armedForGoal) { score.b++; armedForGoal = false; updateScore(); banner(`得分！目前 ${score.b} 分`); }
      $('#sc-prog').style.width = `${Math.min(100, t / 60 * 100)}%`; $('#sc-status').textContent = armedForGoal ? '衝向紅隊圓環！' : '回到中線左側再進攻';
      if (t >= 60) finish(score.b > 0);
    } else { $('#sc-status').textContent = `自由練習中 ${t.toFixed(0)} 秒`; $('#sc-prog').style.width = '0%'; }
  });
  setMode(ctx.startMode || 'free');
  drawRoutes();
  return () => st.dispose();
}
