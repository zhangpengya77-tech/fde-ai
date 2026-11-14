// F450 實訓中心｜2D／3D 同步的 3D 端（P4）
// 1. 2D 選取元件或導線 → 3D 對應零件發光；選到導線時畫出這條線並有光點流動。
// 2. 3D 點零件（或從零件清單選）→ 通知 2D 框出對應元件。
// 3. 2D 勾「在 3D 顯示我的接線」→ 把學員自己接的線畫在 3D 上（檢查後綠＝對、紅＝錯）。
// 只讀 nodes，不改模型；高亮沿用 app.js 的 hotNodes 機制。
import { COMPONENT_NODES, PORTS, componentOfNode, componentsOfKind, componentName, nodeMatches } from './model.js?v=p4-1';
import { emit, on, latest } from './bus.js?v=p4-1';

const KIND_COLOR = { power: 0xff6a4d, signal: 0x3fd0ff, data: 0x7ee8c8 };
const roleKind = (role) => (role.startsWith('power') ? 'power' : role.startsWith('signal') ? 'signal' : 'data');
const SEGMENTS = 28;

export function createSync3D({ THREE, scene, camera, canvas, nodes, hotNodes, refreshLook, host, getMode }) {
  let fromTwoD = false, focusWire = null, myWires = { wires: [], result: null, show: false };
  const group = new THREE.Group(); scene.add(group);
  const tmp = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), mid = new THREE.Vector3();
  const pulses = [0, 1, 2].map(() => { const s = new THREE.Mesh(new THREE.SphereGeometry(3.4, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false })); s.renderOrder = 20; group.add(s); return s; });
  const lines = [];   // { line, from, to, focus }

  // 畫面上的說明條（3D 沒有的零件、目前同步的內容）
  const cap = document.createElement('div'); cap.className = 'sync-cap'; cap.hidden = true; cap.setAttribute('aria-live', 'polite');
  const capText = document.createElement('span');
  const capBtn = document.createElement('button'); capBtn.type = 'button'; capBtn.textContent = '到 2D 接線畫布 ↓';
  capBtn.onclick = () => { const p = document.getElementById('wire2d'); if (p?.hidden) document.getElementById('wire2d-enter')?.click(); else p?.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
  cap.append(capText, capBtn); host.append(cap);
  const say = (t) => { capText.textContent = t; cap.hidden = !t; };

  const nodesOf = (cid) => { const pre = COMPONENT_NODES[cid] || []; return nodes.filter((n) => pre.some((p) => nodeMatches(n.obj.name, p))); };
  // 元件目前的中心（跟著爆炸、組裝練習的位移）；看不到的零件回傳 null
  function centerOf(cid, out) {
    const list = nodesOf(cid).filter((n) => n.obj.visible); if (!list.length) return null;
    out.set(0, 0, 0); list.forEach((n) => out.add(tmp.copy(n.c0).add(n.obj.position).sub(n.base))); return out.multiplyScalar(1 / list.length);
  }

  // ───────── 2D → 3D ─────────
  on('focus2d', (d) => {
    const comps = d?.components || [];
    if (!comps.length && !fromTwoD && !focusWire) return;   // 2D 沒選東西：不要清掉 3D 自己的高亮（例如接線圖表格）
    hotNodes.clear();
    comps.forEach((cid) => nodesOf(cid).forEach((n) => hotNodes.add(n)));
    fromTwoD = comps.length > 0; focusWire = d?.wire || null;
    const missing = comps.filter((cid) => !(COMPONENT_NODES[cid] || []).length);
    const hidden = comps.filter((cid) => (COMPONENT_NODES[cid] || []).length && !nodesOf(cid).some((n) => n.obj.visible));
    say(!comps.length ? '' : `2D 選取：${d.label || comps.map(componentName).join('、')}`
      + (missing.length ? `｜3D 模型沒有：${missing.map(componentName).join('、')}` : '')
      + (hidden.length ? `｜3D 目前看不到：${hidden.map(componentName).join('、')}${getMode() === 'practice' ? '（尚未組裝）' : ''}` : ''));
    rebuild(); refreshLook();
  });
  on('wires2d', (d) => { myWires = d || myWires; rebuild(); });

  // ───────── 3D → 2D ─────────
  function fromSelect(key, node) {
    if (fromTwoD) { hotNodes.clear(); fromTwoD = false; focusWire = null; say(''); rebuild(); }
    const cid = node ? componentOfNode(node.name || '') : null;
    const comps = cid ? [cid] : componentsOfKind(key);
    emit('focus3d', { components: comps, label: comps.map(componentName).join('、') });
  }

  // ───────── 3D 連線 ─────────
  function rebuild() {
    lines.forEach((l) => { group.remove(l.line); l.line.geometry.dispose(); l.line.material.dispose(); }); lines.length = 0;
    const list = [];
    if (myWires.show) {
      const bad = new Set(), good = new Set();
      (myWires.result?.issues || []).forEach((i) => i.wire && bad.add(i.wire));
      (myWires.result?.correct || []).forEach((c) => good.add(c.wire));
      myWires.wires.forEach((w) => list.push({ ...w, color: bad.has(w.id) ? 0xff3b3b : good.has(w.id) ? 0x3ddc97 : KIND_COLOR[roleKind(PORTS[w.from].role)] }));
    }
    if (focusWire && !list.some((w) => (w.from === focusWire.from && w.to === focusWire.to) || (w.from === focusWire.to && w.to === focusWire.from))) {
      list.push({ ...focusWire, color: KIND_COLOR[roleKind(PORTS[focusWire.from].role)] });
    }
    for (const w of list) {
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEGMENTS + 1) * 3), 3));
      const isFocus = focusWire && ((w.from === focusWire.from && w.to === focusWire.to) || (w.from === focusWire.to && w.to === focusWire.from));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: w.color, transparent: true, opacity: isFocus ? 1 : 0.75, depthTest: false }));
      line.renderOrder = 15; group.add(line);
      lines.push({ line, from: PORTS[w.from].component, to: PORTS[w.to].component, focus: isFocus });
    }
  }
  // 每一格更新線的位置（零件會爆炸、被拖動）
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  function update() {
    let focusCurve = null;
    for (const l of lines) {
      const okA = centerOf(l.from, a), okB = okA && centerOf(l.to, b);
      l.line.visible = !!(okA && okB); if (!l.line.visible) continue;
      mid.copy(a).lerp(b, 0.5); mid.y += 25 + a.distanceTo(b) * 0.3;
      const pos = l.line.geometry.attributes.position;
      for (let i = 0; i <= SEGMENTS; i++) { curve.getPoint(i / SEGMENTS, tmp); pos.setXYZ(i, tmp.x, tmp.y, tmp.z); }
      pos.needsUpdate = true; l.line.geometry.computeBoundingSphere();
      if (l.focus) focusCurve = new THREE.QuadraticBezierCurve3(a.clone(), mid.clone(), b.clone());
    }
    const t = performance.now() / 1400;
    pulses.forEach((p, k) => { p.visible = !!focusCurve; if (focusCurve) p.position.copy(focusCurve.getPoint((t + k / 3) % 1)); });
  }

  // 晚建立時，補上 2D 已經送出的狀態
  if (latest('wires2d')) myWires = latest('wires2d');

  // 自動化驗收用（?syncDebug=1）：只回報狀態，不改任何東西
  if (new URLSearchParams(location.search).get('syncDebug') === '1') {
    window.__f450Sync = {
      hot: () => [...hotNodes].map((n) => n.obj.name.replace(/_/g, ' ')),
      lines: () => lines.filter((l) => l.line.visible).length,
      caption: () => (cap.hidden ? '' : capText.textContent),
      pulses: () => pulses.filter((p) => p.visible).length,
      screenOf: (cid) => { const v = centerOf(cid, new THREE.Vector3()); if (!v) return null; v.project(camera); const r = canvas.getBoundingClientRect(); return [r.left + (v.x * 0.5 + 0.5) * r.width, r.top + (-v.y * 0.5 + 0.5) * r.height]; },
    };
  }
  return { fromSelect, update };
}
