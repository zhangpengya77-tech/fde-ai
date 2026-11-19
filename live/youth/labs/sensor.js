// 實驗 F：感測器（陀螺儀、加速度計、姿態角、回饋與自穩 PD 控制）
// 數值為教學用模擬：陀螺儀＝角速度、加速度計＝重力在機體軸的分量，非真實硬體讀值
import { THREE, makeStage, buildQuad } from './three-kit.js';
import { stabilize } from '../core/physics.js';

export const meta = { id: 'sensor', title: '感測器', unit: 6 };

export function mount(host, ctx) {
  host.innerHTML = `
  <div class="lab3">
    <aside class="card lab-side">
      <h4>操作</h4>
      <div class="seg"><button id="s-push-l">向左推一下</button><button id="s-push-r">向右推一下</button></div>
      <label class="rng">手動傾斜 <b id="s-tilt-v">0°</b><input type="range" id="s-tilt" min="-40" max="40" value="0"></label>
      <label class="sw"><input type="checkbox" id="s-stab"> 開啟自穩（PD 控制）</label>
      <label class="rng">P 比例 <b id="s-kp-v">6</b><input type="range" id="s-kp" min="0" max="20" step="0.5" value="6"></label>
      <label class="rng">D 微分 <b id="s-kd-v">2.2</b><input type="range" id="s-kd" min="0" max="8" step="0.1" value="2.2"></label>
      <p class="muted small">任務：先把機體傾斜到 20° 以上看讀數，再開啟自穩，讓它回到 ±2° 以內。</p>
    </aside>
    <div class="lab-stage" id="s-stage"><div class="hud"><div><small>姿態角 Roll</small><b id="s-ang">0.0°</b></div><div><small>陀螺儀</small><b id="s-gyro">0 °/s</b></div><div><small>加速度計 Y</small><b id="s-ay">0.00 g</b></div><div><small>加速度計 Z</small><b id="s-az">1.00 g</b></div></div></div>
    <aside class="card lab-info">
      <h4>即時曲線（最近 6 秒）</h4>
      <canvas id="s-chart" width="320" height="160" class="chart" aria-label="姿態角與角速度曲線"></canvas>
      <p class="small"><span class="dot" style="background:#2f7cf6"></span>姿態角　<span class="dot" style="background:#e74c3c"></span>陀螺儀角速度</p>
      <ol class="tasks" id="s-tasks"><li>傾斜到 20° 以上</li><li>開啟自穩並回正到 ±2°</li></ol>
      <p class="muted small">陀螺儀量「轉多快」，會慢慢漂移；加速度計看「重力方向」算傾角，但怕震動。飛控把兩者融合，再用 PID 命令電機把機身扶正。</p>
    </aside>
  </div>`;
  const $ = s => host.querySelector(s);
  const st = makeStage($('#s-stage'), { cam: [0, 1.4, 3], target: [0, 0.6, 0] });
  const quad = buildQuad(); quad.position.y = 0.6; st.scene.add(quad);
  const imu = new THREE.AxesHelper(0.5); imu.position.y = 0.15; quad.add(imu);
  let ang = 0, rate = 0, manual = false; const hist = [];
  let t1 = false, t2 = false;
  $('#s-tilt').oninput = e => { manual = true; ang = +e.target.value * Math.PI / 180; rate = 0; };
  $('#s-tilt').onchange = () => { manual = false; };
  $('#s-push-l').onclick = () => { rate -= 2.5; }; $('#s-push-r').onclick = () => { rate += 2.5; };
  ['kp', 'kd'].forEach(k => $('#s-' + k).oninput = e => { $(`#s-${k}-v`).textContent = e.target.value; });
  const cv = $('#s-chart'), g = cv.getContext('2d');
  const tasks = () => { const li = host.querySelectorAll('#s-tasks li'); li[0].className = t1 ? 'ok' : 'cur'; li[1].className = t2 ? 'ok' : (t1 ? 'cur' : ''); };
  tasks();
  st.onFrame(dt => {
    if (!manual) {
      // 固定 1/60 秒細分計算，低幀率時控制迴路仍穩定
      const n = Math.max(1, Math.ceil(dt * 60)), h = dt / n;
      for (let i = 0; i < n; i++) {
        const r = stabilize(ang, rate, h, $('#s-stab').checked, +$('#s-kp').value, +$('#s-kd').value);
        // 沒開自穩時，傾斜會因重力力矩慢慢加大（不穩定）
        if (!$('#s-stab').checked) r.rate += Math.sin(ang) * 1.2 * h;
        ang = Math.max(-1.2, Math.min(1.2, r.angle)); rate = r.rate;
      }
    }
    quad.rotation.z = -ang;
    const deg = ang * 180 / Math.PI;
    $('#s-ang').textContent = `${deg.toFixed(1)}°`; $('#s-gyro').textContent = `${Math.round(rate * 180 / Math.PI)} °/s`;
    $('#s-ay').textContent = `${Math.sin(ang).toFixed(2)} g`; $('#s-az').textContent = `${Math.cos(ang).toFixed(2)} g`;
    $('#s-tilt-v').textContent = `${Math.round(deg)}°`;
    if (!t1 && Math.abs(deg) >= 20) { t1 = true; tasks(); ctx.log?.('tilt20'); }
    if (t1 && !t2 && $('#s-stab').checked && Math.abs(deg) <= 2 && Math.abs(rate) < 0.05) { t2 = true; tasks(); ctx.task?.(); ctx.done?.({ completed: true }); }
    hist.push([deg, rate * 180 / Math.PI]); if (hist.length > 360) hist.shift();
    g.clearRect(0, 0, 320, 160); g.strokeStyle = '#d8e3f3'; g.beginPath(); g.moveTo(0, 80); g.lineTo(320, 80); g.stroke();
    [['#2f7cf6', 0, 1.6], ['#e74c3c', 1, 0.25]].forEach(([c, k, sc]) => {
      g.strokeStyle = c; g.lineWidth = 2; g.beginPath();
      hist.forEach((h, i) => { const x = i / 360 * 320, y = 80 - h[k] * sc; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
    });
  });
  ctx.onReset = () => { ang = 0; rate = 0; t1 = t2 = false; $('#s-stab').checked = false; tasks(); };
  return () => st.dispose();
}
