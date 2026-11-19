// 實驗 D：無刷電機（外轉子 12 槽 14 極）：定子、轉子、磁鐵、線圈、軸承拆解＋ESC 六步換相動畫
import { THREE, makeStage, label } from './three-kit.js';
import { COMMUTATION, fieldAngle, mechanicalAngle } from '../core/physics.js';

export const meta = { id: 'motor', title: '無刷電機', unit: 4 };

const PHASE_COLOR = { A: 0xe74c3c, B: 0x27ae60, C: 0x2f7cf6 };

export function mount(host, ctx) {
  host.innerHTML = `
  <div class="lab3">
    <aside class="card lab-side">
      <h4>拆解</h4>
      <label class="rng">爆炸圖 <input type="range" id="m-exp" min="0" max="100" value="45"></label>
      <label class="sw"><input type="checkbox" id="m-bell"> 隱藏轉子鐘罩（看內部定子）</label>
      <label class="sw"><input type="checkbox" id="m-tag" checked> 顯示零件名稱</label>
      <h4>零件</h4>
      <ul class="part-list small">
        <li><b>定子</b>：固定在底座的鐵芯，12 個齒繞著線圈。</li>
        <li><b>線圈</b>：分 A、B、C 三相，通電產生磁場。</li>
        <li><b>轉子鐘罩</b>：外圈會轉的部分，螺旋槳裝在上面。</li>
        <li><b>磁鐵</b>：14 片 N／S 交錯，貼在鐘罩內側。</li>
        <li><b>軸承</b>：讓轉軸順暢旋轉、減少摩擦。</li>
      </ul>
    </aside>
    <div class="lab-stage" id="m-stage"><div class="stage-tip">外轉子無刷電機　12 槽 14 極</div></div>
    <aside class="card lab-info">
      <h4>ESC 六步換相</h4>
      <div class="steps6" id="m-steps"></div>
      <div class="seg"><button id="m-prev">上一步</button><button id="m-next" class="on">下一步</button><button id="m-auto">自動播放</button></div>
      <label class="rng">換相速度 <input type="range" id="m-spd" min="1" max="30" value="4"></label>
      <p id="m-now" class="state ok"></p>
      <p class="muted small">ESC 依序讓兩相線圈通電（一相＋、一相−、第三相浮接）。定子磁場每步轉 60° 電角度，吸著磁鐵前進；14 極＝7 對極，所以轉子每步只轉 60°÷7 ≈ 8.6°。</p>
      <p class="muted small">對照：有刷電機靠「電刷＋換向器」機械換相，會磨損；無刷電機改由 ESC 電子換相，壽命長、效率高。</p>
    </aside>
  </div>`;
  const $ = s => host.querySelector(s);
  const st = makeStage($('#m-stage'), { cam: [2.0, 1.5, 2.4], target: [0, 0.4, 0] });
  const parts = []; const tags = new THREE.Group(); st.scene.add(tags);
  const add = (name, obj, ex) => { st.scene.add(obj); parts.push({ obj, home: obj.position.clone(), ex: new THREE.Vector3(...ex) }); const l = label(name, { size: 0.1 }); tags.add(l); parts.at(-1).tag = l; };

  // 定子＋12 個線圈（相序 A A B B C C … 依常見 12N14P 繞法簡化為 A B C 輪替）
  const stator = new THREE.Group();
  stator.add(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.3, 24), new THREE.MeshStandardMaterial({ color: 0x8c96a6, metalness: 0.6 })));
  const coils = [];
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.1), new THREE.MeshStandardMaterial({ color: 0x9aa4b5, metalness: 0.5 }));
    tooth.position.set(Math.cos(a) * 0.38, 0, Math.sin(a) * 0.38); tooth.rotation.y = -a; stator.add(tooth);
    const ph = 'ABC'[i % 3];
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.035, 8, 16), new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 0.4, emissive: 0 }));
    coil.position.copy(tooth.position).multiplyScalar(0.92); coil.rotation.y = -a + Math.PI / 2;
    coil.userData.phase = ph; coils.push(coil); stator.add(coil);
  }
  add('定子＋線圈', stator, [0, 0, 0]);
  // 轉子鐘罩與 14 片磁鐵
  const rotor = new THREE.Group();
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.36, 40, 1, true), new THREE.MeshStandardMaterial({ color: 0x222831, metalness: 0.7, side: THREE.DoubleSide }));
  rotor.add(bell);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.04, 40), new THREE.MeshStandardMaterial({ color: 0xd23c3c, metalness: 0.5 }));
  cap.position.y = 0.2; rotor.add(cap);
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * Math.PI * 2;
    const mg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.2), new THREE.MeshStandardMaterial({ color: i % 2 ? 0x2f7cf6 : 0xe74c3c }));
    mg.position.set(Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6); mg.rotation.y = -a; rotor.add(mg);
  }
  add('轉子鐘罩＋磁鐵（紅 N／藍 S）', rotor, [0, 1.7, 0]);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 12), new THREE.MeshStandardMaterial({ color: 0xcfd6df, metalness: 0.9 }));
  add('轉軸', shaft, [0, 2.6, 0]);
  const bearing = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.03, 10, 20), new THREE.MeshStandardMaterial({ color: 0xf1c40f, metalness: 0.8 }));
  bearing.rotation.x = Math.PI / 2; bearing.position.y = 0.17;
  add('軸承', bearing, [0.9, 0.5, 0]);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 32), new THREE.MeshStandardMaterial({ color: 0x555b66 }));
  base.position.y = -0.2;
  add('底座', base, [0, -0.6, 0]);
  const fieldArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0.25, 0), 0.5, 0xffcc00, 0.12, 0.08);
  st.scene.add(fieldArrow);

  let step = 0, auto = false, acc = 0, rotorAngle = 0, explode = 0.45, seen = new Set();
  const stepsEl = $('#m-steps');
  const renderSteps = () => {
    stepsEl.innerHTML = COMMUTATION.map((c, i) => `<button class="${i === step ? 'on' : ''}" data-i="${i}">${c.name}</button>`).join('');
    const c = COMMUTATION[step];
    $('#m-now').textContent = `第 ${c.step} 步：A 相 ${c.A === '+' ? '＋' : c.A === '-' ? '−' : '浮接'}、B 相 ${c.B === '+' ? '＋' : c.B === '-' ? '−' : '浮接'}、C 相 ${c.C === '+' ? '＋' : c.C === '-' ? '−' : '浮接'}`;
    coils.forEach(k => { const v = c[k.userData.phase]; k.material.emissive.setHex(v === '0' ? 0 : PHASE_COLOR[k.userData.phase]); k.material.emissiveIntensity = v === '0' ? 0 : 0.9; });
    seen.add(step);
    if (seen.size === 6 && !renderSteps.done) { renderSteps.done = true; ctx.task?.(); ctx.done?.({ completed: true, steps: 6 }); }
  };
  stepsEl.onclick = e => { const b = e.target.closest('button'); if (b) { step = +b.dataset.i; renderSteps(); ctx.log?.('step', step); } };
  $('#m-next').onclick = () => { step = (step + 1) % 6; renderSteps(); };
  $('#m-prev').onclick = () => { step = (step + 5) % 6; renderSteps(); };
  $('#m-auto').onclick = () => { auto = !auto; $('#m-auto').classList.toggle('on', auto); };
  $('#m-exp').oninput = e => { explode = e.target.value / 100; };
  $('#m-bell').onchange = e => { bell.visible = cap.visible = !e.target.checked; };
  $('#m-tag').onchange = e => { tags.visible = e.target.checked; };

  // 已轉過的電角度累計（每步 +60°），轉子機械角度跟著平滑追上
  let elecTarget = 0, lastStep = 0;
  st.onFrame(dt => {
    if (auto) { acc += dt * +$('#m-spd').value; if (acc >= 1) { acc = 0; step = (step + 1) % 6; renderSteps(); } }
    if (step !== lastStep) { const d = ((step - lastStep) % 6 + 6) % 6; elecTarget += (d <= 3 ? d : d - 6) * 60; lastStep = step; }
    const target = mechanicalAngle(elecTarget) * Math.PI / 180;
    rotorAngle += (target - rotorAngle) * Math.min(1, dt * 8);
    rotor.rotation.y = -rotorAngle;
    const fa = fieldAngle(step) * Math.PI / 180;
    fieldArrow.setDirection(new THREE.Vector3(Math.cos(fa), 0, -Math.sin(fa)));
    parts.forEach(p => { p.obj.position.lerpVectors(p.home, p.ex, explode); p.tag.position.copy(p.obj.position).add(new THREE.Vector3(0, 0.45, 0)); });
  });
  renderSteps();
  ctx.onReset = () => { step = 0; seen = new Set(); renderSteps.done = false; elecTarget = 0; lastStep = 0; renderSteps(); };
  return () => st.dispose();
}
