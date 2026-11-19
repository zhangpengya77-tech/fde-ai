// 實驗 B：飛行姿態（Pitch／Roll／Yaw／Throttle 四控制量，3D 同步，含任務模式）
// 可用滑桿、鍵盤或 USB 遙控器（共用 InputHub）操作
import { THREE, makeStage, buildQuad, spinProps } from './three-kit.js';

export const meta = { id: 'attitude', title: '飛行姿態', unit: 3 };

const TASKS = [
  { id: 'level', name: '保持水平懸停 3 秒', hint: '油門推到 50% 以上，Pitch、Roll 保持 0（±3°）。',
    check: s => s.thr >= 0.5 && Math.abs(s.p) <= 3 && Math.abs(s.r) <= 3, hold: 3 },
  { id: 'yaw90', name: '只用 Yaw 右轉到 90°', hint: '其他三個量不要動，把機頭轉到 90°（±5°）。',
    check: s => Math.abs(s.yawDeg - 90) <= 5 && Math.abs(s.p) <= 3 && Math.abs(s.r) <= 3, hold: 1 },
  { id: 'pitch15', name: '機頭向下 15° 前進', hint: 'Pitch 前推到 15°（±3°），Roll 保持 0。',
    check: s => Math.abs(s.p - 15) <= 3 && Math.abs(s.r) <= 3 && s.thr >= 0.4, hold: 2 },
  { id: 'roll-20', name: '向左橫滾 20°', hint: 'Roll 向左到 −20°（±3°）。',
    check: s => Math.abs(s.r + 20) <= 3 && Math.abs(s.p) <= 3 && s.thr >= 0.4, hold: 2 }
];

export function mount(host, ctx) {
  host.innerHTML = `
  <div class="lab3">
    <aside class="card lab-side">
      <h4>控制量</h4>
      ${[['thr', 'Throttle 油門', 0, 100, 0, '%'], ['p', 'Pitch 俯仰', -30, 30, 0, '°'], ['r', 'Roll 橫滾', -30, 30, 0, '°'], ['y', 'Yaw 偏航速度', -90, 90, 0, '°/s']]
        .map(([k, n, a, b, v, u]) => `<label class="rng">${n} <b id="at-${k}-v">${v}${u}</b><input type="range" id="at-${k}" min="${a}" max="${b}" value="${v}"></label>`).join('')}
      <button class="btn ghost" id="at-zero">全部歸零</button>
      <p class="muted small">鍵盤：W/S 油門、A/D 偏航、方向鍵俯仰與橫滾；已接 USB 遙控器時自動使用遙控器。</p>
    </aside>
    <div class="lab-stage" id="at-stage">
      <div class="hud"><div><small>Pitch</small><b id="h-p">0°</b></div><div><small>Roll</small><b id="h-r">0°</b></div><div><small>Yaw</small><b id="h-y">0°</b></div><div><small>油門</small><b id="h-t">0%</b></div></div>
    </div>
    <aside class="card lab-info">
      <h4>任務模式</h4>
      <ol class="tasks" id="at-tasks"></ol>
      <div class="meter"><i id="at-hold"></i></div>
      <p id="at-hint" class="muted"></p>
      <h4>電機轉速（示意）</h4>
      <div class="motors" id="at-mot"></div>
    </aside>
  </div>`;
  const $ = s => host.querySelector(s);
  const st = makeStage($('#at-stage'), { cam: [2.4, 1.6, 2.6], target: [0, 0.6, 0] });
  const quad = buildQuad(); quad.position.y = 0.6; st.scene.add(quad);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 12), new THREE.MeshStandardMaterial({ color: 0xff3355 }));
  nose.rotation.x = -Math.PI / 2; nose.position.set(0, 0.2, -0.45); quad.add(nose);   // 紅色箭頭 = 機頭

  const s = { thr: 0, p: 0, r: 0, yawRate: 0, yawDeg: 0 };
  let ti = 0, held = 0; const done = new Set();
  const sliders = ['thr', 'p', 'r', 'y'].map(k => $('#at-' + k));
  let userTouched = 0;
  sliders.forEach(el => el.addEventListener('input', () => { userTouched = performance.now(); }));
  $('#at-zero').onclick = () => { sliders.forEach(el => { el.value = 0; }); s.yawDeg = 0; };

  const renderTasks = () => {
    $('#at-tasks').innerHTML = TASKS.map((t, i) => `<li class="${done.has(t.id) ? 'ok' : i === ti ? 'cur' : ''}">${t.name}${done.has(t.id) ? ' ✓' : ''}</li>`).join('');
    $('#at-hint').textContent = done.size === TASKS.length ? '全部任務完成！' : TASKS[ti].hint;
  };
  renderTasks();

  st.onFrame(dt => {
    // 搖桿／鍵盤輸入（若有動作就覆蓋滑桿）
    const inp = ctx.input?.read();
    if (inp && performance.now() - userTouched > 400 && (inp.throttle || inp.pitch || inp.roll || inp.yaw)) {
      sliders[0].value = Math.round(Math.min(100, Math.max(0, +sliders[0].value + inp.throttle * 60 * dt)));
      sliders[1].value = Math.round(inp.pitch * 30); sliders[2].value = Math.round(inp.roll * 30); sliders[3].value = Math.round(inp.yaw * 90);
    }
    s.thr = sliders[0].value / 100; s.p = +sliders[1].value; s.r = +sliders[2].value; s.yawRate = +sliders[3].value;
    s.yawDeg = ((s.yawDeg + s.yawRate * dt) % 360 + 360) % 360;
    const yd = s.yawDeg > 180 ? s.yawDeg - 360 : s.yawDeg;
    // three.js：Yaw 繞 y（右轉為負）、Pitch 繞 x（機頭朝 -z，機頭向下為負 x 轉）、Roll 繞 z
    quad.rotation.set(-s.p * Math.PI / 180, -s.yawDeg * Math.PI / 180, -s.r * Math.PI / 180, 'YXZ');
    quad.position.y = 0.3 + s.thr * 0.9;
    spinProps(quad, dt, 0.15 + s.thr);
    $('#at-thr-v').textContent = `${Math.round(s.thr * 100)}%`; $('#at-p-v').textContent = `${s.p}°`; $('#at-r-v').textContent = `${s.r}°`; $('#at-y-v').textContent = `${s.yawRate}°/s`;
    $('#h-p').textContent = `${s.p}°`; $('#h-r').textContent = `${s.r}°`; $('#h-y').textContent = `${Math.round(yd)}°`; $('#h-t').textContent = `${Math.round(s.thr * 100)}%`;
    // 電機轉速示意：M1 右前、M2 左後、M3 左前、M4 右後
    const base = s.thr, k = 0.012, ky = 0.0015;
    const m = [base - s.p * k - s.r * k + s.yawRate * ky, base + s.p * k + s.r * k + s.yawRate * ky, base - s.p * k + s.r * k - s.yawRate * ky, base + s.p * k - s.r * k - s.yawRate * ky]
      .map(v => Math.max(0, Math.min(1, v)));
    $('#at-mot').innerHTML = m.map((v, i) => `<div><span>M${i + 1}</span><i style="width:${Math.round(v * 100)}%"></i><b>${Math.round(v * 100)}</b></div>`).join('');
    // 任務判定
    if (done.size < TASKS.length) {
      const t = TASKS[ti];
      const ok = t.check({ ...s, yawDeg: s.yawDeg });
      held = ok ? held + dt : 0;
      $('#at-hold').style.width = `${Math.min(100, held / t.hold * 100)}%`;
      if (held >= t.hold) {
        done.add(t.id); held = 0; ti = TASKS.findIndex(x => !done.has(x.id)); if (ti < 0) ti = 0;
        ctx.log?.('task', t.id); renderTasks();
        if (done.size === 1) ctx.task?.();
        if (done.size === TASKS.length) ctx.done?.({ completed: true, tasks: TASKS.length });
      }
    }
  });
  ctx.onReset = () => { done.clear(); ti = 0; held = 0; $('#at-zero').onclick(); renderTasks(); };
  return () => st.dispose();
}
