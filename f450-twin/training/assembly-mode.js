// F450 實訓中心｜3D 組裝練習（P2）
// 學員從零件盤拿起零件 → 在 3D 上拖到發光圈附近放開 → 自動吸附；順序、方向、槳葉轉向由 model.js 判斷。
// 絕不用動畫假裝完成：每一件都必須由學員自己拖到位置。成績不記錄（P5／P6 才接判分與任務卡）。
import { ASSEMBLY, ASSEMBLY_BY_ID, PRACTICE_ONLY, assemblyReport, createAssemblyState, install, pick, putBack, rotate, slotsFor, stepTitle, unitOfNode } from './model.js?v=p2-2';

const SNAP_PX = matchMedia('(pointer: coarse)').matches ? 64 : 46;   // 螢幕上距離多近就吸附（手機放寬）
const LIFT = 170;                                                     // 拿起時放在安裝位置上方多少 mm

export function createPractice({ THREE, nodes, scene, camera, renderer, controls, host, strip, onSelect, setView }) {
  let state = createAssemblyState();
  let active = false, built = false, current = null, dragging = null, message = '';
  const units = new Map();      // id → { a, nodes, pivot, pos, q0: Map(node → 初始旋轉) }
  const Y = new THREE.Vector3(0, 1, 0), tmp = new THREE.Vector3(), q = new THREE.Quaternion();
  const marks = new THREE.Group(); marks.visible = false; scene.add(marks);
  const ringGeo = new THREE.TorusGeometry(26, 2.2, 8, 40);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x3ddc97, transparent: true, opacity: 0.85, depthTest: false });
  const rings = [];
  const nose = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(), 110, 0x36b9ff, 34, 20);   // 機頭方向
  const facing = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(), 80, 0xffc857, 26, 16); // 手上零件的箭頭
  marks.add(nose, facing);

  // ───────── 建立組裝單元（模型載入後第一次進入時） ─────────
  function build() {
    if (built || !nodes.length) return;
    for (const a of ASSEMBLY) units.set(a.id, { a, nodes: [], pivot: new THREE.Vector3(), pos: new THREE.Vector3(), q0: new Map() });
    for (const n of nodes) { const id = unitOfNode(n.obj.name); if (id) units.get(id).nodes.push(n); }
    for (const u of units.values()) {
      if (!u.nodes.length) continue;
      u.nodes.forEach((n) => { u.pivot.add(n.c0); u.q0.set(n, n.obj.quaternion.clone()); });
      u.pivot.multiplyScalar(1 / u.nodes.length);
    }
    const box = new THREE.Box3(); nodes.forEach((n) => box.expandByPoint(n.c0));
    nose.position.set(0, box.max.y + 10, box.min.z - 60);
    built = true;
  }

  // ───────── 擺放 ─────────
  function placeUnit(u) {
    const p = state.parts[u.a.id];
    const center = p.status === 'held' ? u.pos : units.get(p.slot || u.a.id).pivot;
    q.setFromAxisAngle(Y, (-p.yaw * Math.PI) / 180);
    for (const n of u.nodes) {
      n.obj.position.copy(tmp.copy(n.base).sub(u.pivot).applyQuaternion(q).add(center));
      n.obj.quaternion.copy(q).multiply(u.q0.get(n));
      n.obj.updateMatrixWorld(true);
    }
  }
  function update() {
    if (!active || !built) return;
    for (const u of units.values()) if (state.parts[u.a.id].status !== 'tray') placeUnit(u);
    // 方向箭頭：拿在手上或方向錯的零件才顯示
    const cu = current && units.get(current), cp = current && state.parts[current];
    facing.visible = !!(cu && cu.a.orient && (cp.status === 'held' || cp.status === 'wrong_orientation'));
    if (facing.visible) {
      const c = cp.status === 'held' ? cu.pos : cu.pivot;
      facing.position.copy(c).add(tmp.set(0, 45, 0));
      facing.setDirection(tmp.set(0, 0, -1).applyAxisAngle(Y, (-cp.yaw * Math.PI) / 180));
      facing.setColor(cp.yaw % 360 === 0 ? 0x3ddc97 : 0xffc857);
    }
  }

  // 外觀：在零件盤的隱藏；拿著的發藍光；方向錯的發紅光。回傳要描邊的物件
  function refresh() {
    const hot = [];
    for (const n of nodes) {
      const id = unitOfNode(n.obj.name), p = id && state.parts[id];
      n.obj.visible = !!p && p.status !== 'tray';
      const glow = !p ? null : p.status === 'held' ? 0x1f7bff : p.status === 'wrong_orientation' ? 0xff3b3b : null;
      if (glow && n.obj.visible) hot.push(n.obj);
      for (const m of n.meshes) for (const mat of [].concat(m.material)) {
        mat.transparent = false; mat.opacity = 1; mat.depthWrite = true;
        if (mat.emissive) { if (glow) mat.emissive.setHex(glow).multiplyScalar(0.55); else if (mat.userData.e0) mat.emissive.copy(mat.userData.e0); }
      }
    }
    // 目標圈：手上零件可以去的空位
    rings.forEach((r) => (r.visible = false));
    if (current && state.parts[current].status === 'held') {
      slotsFor(state, current).forEach((sid, i) => {
        if (!rings[i]) { const r = new THREE.Mesh(ringGeo, ringMat); r.rotation.x = Math.PI / 2; r.renderOrder = 10; marks.add(r); rings.push(r); }
        rings[i].position.copy(units.get(sid).pivot); rings[i].visible = true;
      });
    }
    renderStrip();
    return hot;
  }

  // ───────── 拖曳 ─────────
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(), plane = new THREE.Plane(), grab = new THREE.Vector3(), hitP = new THREE.Vector3();
  function setPtr(e) { const r = renderer.domElement.getBoundingClientRect(); ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ptr, camera); }
  function toScreen(v) { const r = renderer.domElement.getBoundingClientRect(); tmp.copy(v).project(camera); return [(tmp.x * 0.5 + 0.5) * r.width, (-tmp.y * 0.5 + 0.5) * r.height]; }
  host.addEventListener('pointerdown', (e) => {
    if (!active || !built || e.target !== renderer.domElement) return;
    setPtr(e);
    const pickable = [...units.values()].filter((u) => ['held', 'wrong_orientation'].includes(state.parts[u.a.id].status)).flatMap((u) => u.nodes.flatMap((n) => n.meshes));
    let hit = ray.intersectObjects(pickable, false)[0], u = null;
    if (hit) u = [...units.values()].find((x) => x.nodes.some((n) => n.meshes.includes(hit.object)));
    else if (current && state.parts[current].status === 'held') {   // 線材等細長零件中心可能是空的：點在零件中心附近也算抓到
      const r = renderer.domElement.getBoundingClientRect(), [x, y] = toScreen(units.get(current).pos);
      if (Math.hypot(e.clientX - r.left - x, e.clientY - r.top - y) > SNAP_PX) return;
      u = units.get(current); hit = { point: u.pos.clone() };
    } else return;
    current = u.a.id; onSelect(u.a.kind);
    if (state.parts[u.a.id].status !== 'held') { say(`已選取 ${u.a.zh}，可按「↻ 旋轉 90°」調整方向`); return; }
    dragging = u; controls.enabled = false;                                   // 拖零件時不轉鏡頭
    plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(tmp).clone(), u.pos);
    grab.copy(hit.point).sub(u.pos);
    renderer.domElement.setPointerCapture?.(e.pointerId);
  }, true);
  addEventListener('pointermove', (e) => {
    if (!dragging) return;
    setPtr(e);
    if (ray.ray.intersectPlane(plane, hitP)) dragging.pos.copy(hitP).sub(grab);
  });
  addEventListener('pointerup', () => {
    if (!dragging) return;
    const u = dragging; dragging = null; controls.enabled = true;
    drop(u);
  });

  // 放開：找螢幕上最近的空位；夠近才交給 model.js 判斷
  function drop(u) {
    const [x, y] = toScreen(u.pos);
    const cands = slotsFor(state, u.a.id).map((sid) => { const [sx, sy] = toScreen(units.get(sid).pivot); return [sid, Math.hypot(sx - x, sy - y)]; }).sort((p, r) => p[1] - r[1]);
    if (!cands.length || cands[0][1] > SNAP_PX) { say(`還沒到安裝位置：把 ${u.a.zh} 拖到綠色圈上再放開`); onChange(); return; }
    const r = install(state, u.a.id, cands[0][0]);
    if (r.ok) say(`✓ ${u.a.zh} 已安裝`, 'ok');
    else say(r.issue.message, 'bad');
    onChange();
  }

  // ───────── 面板 ─────────
  const $ = (sel) => strip.querySelector(sel);
  const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
  strip.replaceChildren();
  const head = el('div', null, 'row between');
  const btns = el('span');
  const bRotate = el('button', '↻ 旋轉 90°'), bBack = el('button', '放回零件盤'), bReset = el('button', '重新開始');
  [bRotate, bBack, bReset].forEach((b) => { b.type = 'button'; btns.append(b, ' '); });
  head.append(el('b', '3D 組裝練習'), btns);
  const bar = el('div', null, 'pr-bar'); bar.append(el('i'));
  strip.append(head, bar, el('p', null, 'pr-stat'), el('p', null, 'pr-msg'), el('div', null, 'pr-tray'),
    el('p', '操作：點零件盤的零件拿起 → 在 3D 上把發藍光的零件拖到綠色圈 → 放開自動吸附。藍色箭頭＝機頭方向；Pixhawk 與 GPS 的黃色箭頭要轉成綠色（對準機頭）。', 'note'),
    el('p', PRACTICE_ONLY ? '練習模式：組裝順序與方向規則依 DJI 手冊與公開資料整理，待實機核對；結果不記錄、不計正式成績。' : '', 'note'));
  $('.pr-msg').setAttribute('aria-live', 'polite');
  let msgTone = '';
  function say(text, tone = '') { message = text; msgTone = tone; }

  bRotate.onclick = () => {
    if (!current) { say('請先拿起或點選 Pixhawk 或 GPS'); onChange(); return; }
    const r = rotate(state, current, 90), a = ASSEMBLY_BY_ID[current];
    if (!r.ok) say(r.message);
    else if (state.parts[current].status === 'installed') say(`✓ ${a.zh} 已對準機頭並安裝`, 'ok');
    else say(`${a.zh} 目前朝向 ${r.yaw}°（0° 才是對準機頭）`);
    onChange();
  };
  bBack.onclick = () => { if (current && state.parts[current].status === 'held') { putBack(state, current); say('已放回零件盤'); current = null; onChange(); } };
  bReset.onclick = () => { state = createAssemblyState(); current = null; say('已重新開始；請從第 1 步開始'); onChange(); };

  function takeFromTray(id) {
    if (current && current !== id && state.parts[current].status === 'held') putBack(state, current);   // 一次只拿一件
    const r = pick(state, id), u = units.get(id);
    if (!r.ok) { say(r.issue.message, 'bad'); onChange(); return; }
    current = id;
    // 放在安裝位置上方；太靠近畫面上緣（會被視角按鈕擋住）就降低高度
    const H = renderer.domElement.getBoundingClientRect().height;
    for (let lift = LIFT; lift >= 40; lift -= 15) { u.pos.copy(u.pivot).add(tmp.set(0, lift, 0)); if (toScreen(u.pos)[1] > H * 0.2) break; }
    say(`已拿起 ${u.a.zh}：拖到綠色圈${u.a.orient ? '，並把箭頭轉成指向機頭' : ''}${u.a.slot ? '（槳葉要裝到相同轉向的位置）' : ''}`);
    onSelect(u.a.kind); onChange();
    const vr = host.getBoundingClientRect();   // 零件盤在 3D 下方：拿起後把 3D 畫面捲回可見，才能直接拖
    if (vr.top < 0 || vr.bottom > innerHeight) host.scrollIntoView({ block: 'nearest' });
  }

  function renderStrip() {
    const rep = assemblyReport(state);
    $('.pr-bar i').style.width = `${(rep.installed / rep.total) * 100}%`;
    $('.pr-stat').textContent = rep.complete
      ? `全部 ${rep.total} 件已依序安裝完成｜錯誤 ${rep.errorCount} 次（練習結果，未記錄成績）`
      : `已安裝 ${rep.installed} / ${rep.total}｜錯誤 ${rep.errorCount} 次｜下一步：第 ${rep.nextStep} 步「${stepTitle(rep.nextStep)}」${rep.wrongOrientation.length ? '｜有零件方向錯，先轉正' : ''}`;
    const m = $('.pr-msg'); m.textContent = message; m.className = `pr-msg ${msgTone}`;
    const tray = $('.pr-tray'); tray.replaceChildren();
    for (let s = 1; s <= 10; s++) {
      const list = ASSEMBLY.filter((a) => a.step === s);
      const left = list.filter((a) => state.parts[a.id].status !== 'installed' && state.parts[a.id].status !== 'wrong_orientation');
      const g = el('div', null, `pr-step${s === rep.nextStep ? ' now' : ''}${left.length ? '' : ' done'}`);
      g.append(el('span', `${left.length ? '' : '✓ '}${s}. ${stepTitle(s)}`, 'pr-h'));
      left.forEach((a) => {
        const b = el('button', a.zh); b.type = 'button';
        if (state.parts[a.id].status === 'held') b.classList.add('on');
        b.onclick = () => takeFromTray(a.id); g.append(b);
      });
      tray.append(g);
    }
  }

  // 自動化驗收用（?practiceDebug=1）：回報零件與安裝位的螢幕座標，不影響一般使用
  if (new URLSearchParams(location.search).get('practiceDebug') === '1') {
    window.__f450Practice = {
      report: () => assemblyReport(state),
      screen: (id) => { const u = units.get(id), r = renderer.domElement.getBoundingClientRect(), s = (v) => { const [x, y] = toScreen(v); return [x + r.left, y + r.top]; };
        return { held: s(u.pos), slots: Object.fromEntries(slotsFor(state, id).map((sid) => [sid, s(units.get(sid).pivot)])), status: state.parts[id].status, yaw: state.parts[id].yaw }; },
      message: () => message,
      visibleNodes: (id) => units.get(id).nodes.filter((n) => n.obj.visible).length,
    };
  }

  let onChange = () => {};
  return {
    get active() { return active; },
    setOnChange(fn) { onChange = fn; },
    setActive(on) {
      if (on === active) return;
      active = on; build(); marks.visible = on;
      if (!on) {   // 離開練習：還原零件旋轉，位置交回原本的爆炸／組裝流程
        if (dragging) { dragging = null; controls.enabled = true; }
        for (const u of units.values()) for (const n of u.nodes) n.obj.quaternion.copy(u.q0.get(n));
      } else { say(message || '從第 1 步開始：在零件盤點「下中心板」拿起'); setView('iso'); }
    },
    update, refresh,
    report: () => assemblyReport(state),
  };
}
