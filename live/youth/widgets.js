// 單元互動元件（「互動動畫＋學生操作」）：每個 widget 都是 mount(el, api)，api.done() 表示學生完成操作
import { batteryPack } from './core/physics.js';

const W = {};

// U01 零件熱點：點遍 6 個零件
W['parts-hotspot'] = (el, api) => {
  const parts = [['飛控', 50, 48, '大腦，計算姿態'], ['電池', 50, 30, '能量來源'], ['電機', 18, 18, '讓螺旋槳轉'], ['螺旋槳', 82, 18, '推空氣產生升力'], ['電調', 30, 66, '控制電機轉速'], ['GPS', 72, 66, '知道自己在哪']];
  const seen = new Set();
  el.innerHTML = `<div class="hot"><svg viewBox="0 0 100 84"><g stroke="#2b3a55" stroke-width="3"><line x1="18" y1="18" x2="82" y2="66"/><line x1="82" y1="18" x2="18" y2="66"/></g>${[[18, 18], [82, 18], [18, 66], [82, 66]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="9" fill="none" stroke="#9db4d6" stroke-width="1.5"/>`).join('')}<rect x="38" y="36" width="24" height="18" rx="3" fill="#dbe7fb"/></svg>
  ${parts.map(([n, x, y], i) => `<button style="left:${x}%;top:${y / 84 * 100}%" data-i="${i}">${i + 1}</button>`).join('')}</div><p class="small" id="hp-t">點數字認識零件（0/6）</p>`;
  el.querySelector('.hot').onclick = e => { const b = e.target.closest('button'); if (!b) return; const p = parts[b.dataset.i]; seen.add(b.dataset.i); b.classList.add('ok'); el.querySelector('#hp-t').textContent = `${p[0]}：${p[3]}（${seen.size}/6）`; if (seen.size === 6) api.done(); };
};

// U02 力平衡：調油門讓升力＝重力
W['force-balance'] = (el, api) => {
  el.innerHTML = `<div class="fb"><svg viewBox="0 0 200 160"><rect x="70" y="70" width="60" height="20" rx="4" fill="#2f7cf6"/><g id="fb-up"></g><g id="fb-dn"></g><text id="fb-tx" x="100" y="155" text-anchor="middle" font-size="11"></text></svg></div>
  <label class="rng">油門（升力）<input type="range" id="fb-r" min="0" max="200" value="60"></label><label class="rng">機身重量 <select id="fb-w"><option value="100">1.0 kg</option><option value="140">1.4 kg</option><option value="80">0.8 kg</option></select></label><p class="small" id="fb-s"></p>`;
  let hold = 0, last = performance.now(), raf;
  const arrow = (y0, len, dir, c) => `<line x1="100" y1="${y0}" x2="100" y2="${y0 + dir * len}" stroke="${c}" stroke-width="6"/><polygon points="${100 - 8},${y0 + dir * len} ${100 + 8},${y0 + dir * len} 100,${y0 + dir * (len + 12)}" fill="${c}"/>`;
  const tick = now => {
    const L = +el.querySelector('#fb-r').value, G = +el.querySelector('#fb-w').value;
    el.querySelector('#fb-up').innerHTML = arrow(70, L * 0.3, -1, '#27ae60'); el.querySelector('#fb-dn').innerHTML = arrow(90, G * 0.3, 1, '#e74c3c');
    const diff = L - G, state = Math.abs(diff) <= 4 ? '升力 ≈ 重力 → 懸停' : diff > 0 ? '升力 > 重力 → 上升' : '升力 < 重力 → 下降';
    hold = Math.abs(diff) <= 4 ? hold + (now - last) / 1000 : 0; last = now;
    el.querySelector('#fb-tx').textContent = state; el.querySelector('#fb-s').textContent = `保持懸停 ${hold.toFixed(1)} / 3 秒`;
    if (hold >= 3 && !tick.ok) { tick.ok = true; api.done(); }
    if (el.isConnected) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
};

// U03 搖桿對應：把 4 個動作拖對到搖桿方向（以選單作答，手機友善）
W['stick-mapping'] = (el, api) => {
  const Q = [['左搖桿上下', 'Throttle 油門'], ['左搖桿左右', 'Yaw 偏航'], ['右搖桿上下', 'Pitch 俯仰'], ['右搖桿左右', 'Roll 橫滾']];
  const opts = Q.map(q => q[1]).sort();
  el.innerHTML = `<p class="small">美國手（Mode 2）：每個搖桿方向控制什麼？</p>${Q.map((q, i) => `<label class="pair">${q[0]} <select data-i="${i}"><option value="">選擇</option>${opts.map(o => `<option>${o}</option>`).join('')}</select></label>`).join('')}<button class="btn small" id="sm-c">檢查</button><p class="small" id="sm-r"></p>`;
  el.querySelector('#sm-c').onclick = () => { const bad = [...el.querySelectorAll('select')].filter(s => s.value !== Q[s.dataset.i][1]); el.querySelector('#sm-r').textContent = bad.length ? `還有 ${bad.length} 個不對，再想想。` : '全對！'; if (!bad.length) api.done(); };
};

// U04 動力鏈排序
W['power-chain'] = (el, api) => {
  const ans = ['電池', 'ESC 電調', '無刷電機', '螺旋槳', '推力'];
  let cur = [...ans].sort(() => Math.random() - 0.5);
  const draw = () => { el.innerHTML = `<p class="small">用 ◀ ▶ 把能量流動排成正確順序：</p><div class="chain">${cur.map((c, i) => `<span><button data-i="${i}" data-d="-1">◀</button>${c}<button data-i="${i}" data-d="1">▶</button></span>`).join('<b>→</b>')}</div><button class="btn small" id="pc-c">檢查</button><p class="small" id="pc-r"></p>`;
    el.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { const i = +b.dataset.i, j = i + +b.dataset.d; if (j < 0 || j >= cur.length) return; [cur[i], cur[j]] = [cur[j], cur[i]]; draw(); });
    el.querySelector('#pc-c').onclick = () => { const ok = cur.every((c, i) => c === ans[i]); el.querySelector('#pc-r').textContent = ok ? '正確！電能 → 調速 → 旋轉 → 推空氣 → 推力。' : '順序還不對，想想電從哪裡來。'; if (ok) api.done(); };
  };
  draw();
};

// U05 電池計算題
W['battery-calc'] = (el, api) => {
  const s = 4, p = 2, mah = 2200; const r = batteryPack({ s, p, cellMah: mah });
  el.innerHTML = `<p class="small">題目：${s} 顆串聯、${p} 組並聯（${r.label}），每顆 3.7 V、${mah} mAh。</p>
  <label class="pair">標稱電壓 <input id="bc-v" inputmode="decimal" placeholder="V"></label><label class="pair">總容量 <input id="bc-c" inputmode="numeric" placeholder="mAh"></label><label class="pair">能量 <input id="bc-e" inputmode="decimal" placeholder="Wh"></label><button class="btn small" id="bc-k">檢查</button><p class="small" id="bc-r"></p>`;
  el.querySelector('#bc-k').onclick = () => {
    const v = +el.querySelector('#bc-v').value, c = +el.querySelector('#bc-c').value, e = +el.querySelector('#bc-e').value;
    const ok = Math.abs(v - r.nominalV) < 0.05 && c === r.capacityMah && Math.abs(e - r.energyWh) <= 0.6;
    el.querySelector('#bc-r').textContent = ok ? `正確：${r.nominalV} V、${r.capacityMah} mAh、${r.energyWh} Wh。` : '還不對。提示：串聯電壓相加、並聯容量相加、Wh = V × Ah。';
    if (ok) api.done();
  };
};

// U06 感測器配對
W['sensor-readout'] = (el, api) => {
  const Q = [['角速度 35 °/s', '陀螺儀'], ['重力方向：傾斜 12°', '加速度計'], ['氣壓下降 1 hPa', '氣壓計'], ['北緯 24.1°、東經 120.6°', 'GPS']];
  const o = ['陀螺儀', '加速度計', '氣壓計', 'GPS'];
  el.innerHTML = `<p class="small">這些讀數來自哪個感測器？</p>${Q.map((q, i) => `<label class="pair">${q[0]} <select data-i="${i}"><option value="">選擇</option>${o.map(x => `<option>${x}</option>`).join('')}</select></label>`).join('')}<button class="btn small" id="sr-c">檢查</button><p class="small" id="sr-r"></p>`;
  el.querySelector('#sr-c').onclick = () => { const bad = [...el.querySelectorAll('select')].filter(s => s.value !== Q[s.dataset.i][1]).length; el.querySelector('#sr-r').textContent = bad ? `錯 ${bad} 題` : '全對！'; if (!bad) api.done(); };
};

// U07 電機位置點選
W['motor-order'] = (el, api) => {
  const pos = { M1: [75, 25], M2: [25, 75], M3: [25, 25], M4: [75, 75] };
  let k = 1;
  el.innerHTML = `<p class="small" id="mo-t">ArduPilot Quad X（機頭朝上）：請點出 M1 的位置</p><div class="mo"><span class="nose">▲ 機頭</span>${Object.entries(pos).map(([m, [x, y]]) => `<button data-m="${m}" style="left:${x}%;top:${y}%">?</button>`).join('')}</div>`;
  el.querySelector('.mo').onclick = e => { const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.m === `M${k}`) { b.textContent = `M${k}`; b.classList.add('ok'); k++; el.querySelector('#mo-t').textContent = k > 4 ? '全部正確！M1 右前、M2 左後、M3 左前、M4 右後。' : `正確！再點 M${k}`; if (k > 4) api.done(); }
    else { el.querySelector('#mo-t').textContent = `不對，再找找 M${k}（提示：M1 右前、M2 在它的對角）`; } };
};

// U08 情境判斷
W['scenario-judge'] = (el, api) => {
  const S = [['風速 10 m/s 的海邊，要不要飛？', ['照飛', '不飛，改天再來'], 1], ['公園有很多小朋友在玩', ['飛到他們上方拍照', '換到沒人的場地'], 1], ['電池外觀鼓起來', ['停用交給老師', '綁緊一點繼續用'], 0], ['機場旁的空地', ['先查空域，禁航區不飛', '低空飛應該沒關係'], 0]];
  let i = 0, ok = 0;
  const draw = () => { if (i >= S.length) { el.innerHTML = `<p>完成！答對 ${ok}/${S.length}。${ok === S.length ? '' : '答錯的情境請再想一次。'}</p>${ok < S.length ? '<button class="btn small" id="sj-a">再做一次</button>' : ''}`; if (ok === S.length) api.done(); else el.querySelector('#sj-a').onclick = () => { i = 0; ok = 0; draw(); }; return; }
    const s = S[i]; el.innerHTML = `<p class="small">情境 ${i + 1}/${S.length}：${s[0]}</p>${s[1].map((o, j) => `<button class="btn ghost small" data-j="${j}">${o}</button>`).join(' ')}`;
    el.querySelectorAll('[data-j]').forEach(b => b.onclick = () => { if (+b.dataset.j === s[2]) ok++; i++; draw(); }); };
  draw();
};

// U09 懸停小遊戲（2D）：按住按鈕上升、放開下降，保持在綠帶 5 秒
W['hover-score'] = (el, api) => {
  el.innerHTML = `<canvas width="300" height="160" class="chart"></canvas><button class="btn small" id="hs-b">按住加油門</button><p class="small" id="hs-t">保持在綠色區（1.35–1.65 m）5 秒</p>`;
  const c = el.querySelector('canvas').getContext('2d'); let y = 0, v = 0, up = false, hold = 0, last = performance.now();
  const b = el.querySelector('#hs-b');
  ['pointerdown', 'pointerup', 'pointerleave'].forEach(ev => b.addEventListener(ev, () => { up = ev === 'pointerdown'; }));
  const tick = now => { const dt = Math.min(0.05, (now - last) / 1000); last = now;
    v += ((up ? 1.2 : -1.2) - v) * dt * 2; y = Math.max(0, Math.min(3, y + v * dt));
    const inBand = y >= 1.35 && y <= 1.65; hold = inBand ? hold + dt : 0;
    c.clearRect(0, 0, 300, 160); c.fillStyle = '#d7f5df'; c.fillRect(0, 160 - 1.65 * 50, 300, 0.3 * 50);
    c.fillStyle = '#2f7cf6'; c.fillRect(140, 160 - y * 50 - 8, 20, 8);
    el.querySelector('#hs-t').textContent = `高度 ${y.toFixed(2)} m｜保持 ${hold.toFixed(1)} / 5 秒`;
    if (hold >= 5 && !tick.ok) { tick.ok = true; api.done(); }
    if (el.isConnected) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
};

// U10 戰術板：把 3 台藍隊球機放到「門前防守」正確位置
W['tactic-board'] = (el, api) => {
  el.innerHTML = `<p class="small">「門前防守」：把防守機 B3 拖到藍隊圓環（左端）前方 1 m 的位置。</p><div class="pitch"><i class="goal l"></i><i class="goal r"></i><b class="chip" id="tb-b3" style="left:50%;top:50%">B3</b><i class="target"></i></div><p class="small" id="tb-r"></p>`;
  const chip = el.querySelector('#tb-b3'), pitch = el.querySelector('.pitch');
  chip.onpointerdown = e => { chip.setPointerCapture(e.pointerId); chip.onpointermove = m => { const r = pitch.getBoundingClientRect(); chip.style.left = `${Math.max(0, Math.min(100, (m.clientX - r.left) / r.width * 100))}%`; chip.style.top = `${Math.max(0, Math.min(100, (m.clientY - r.top) / r.height * 100))}%`; }; };
  chip.onpointerup = () => { chip.onpointermove = null; const x = parseFloat(chip.style.left), y = parseFloat(chip.style.top);
    const ok = x >= 8 && x <= 20 && y >= 38 && y <= 62; el.querySelector('#tb-r').textContent = ok ? '位置正確！擋在圓環正前方。' : '還不對：要靠近左邊圓環、在中線高度上。'; if (ok) api.done(); };
};

// U11 方塊程式（也作為「程式實驗」）：排指令，俯視圖模擬飛行
W['block-coding'] = (el, api) => {
  const B = { up: '起飛 1 m', fwd: '前進 2 m', right: '右轉 90°', left: '左轉 90°', land: '降落', rep4: '重複 4 次（下一行）' };
  let prog = [];
  el.innerHTML = `<div class="code"><div class="palette">${Object.entries(B).map(([k, n]) => `<button class="blk" data-k="${k}">${n}</button>`).join('')}</div><ol class="prog" id="bk-p"></ol><canvas width="220" height="220" class="chart" id="bk-c"></canvas></div><div class="sc-row"><button class="btn small" id="bk-run">▶ 執行</button><button class="btn ghost small" id="bk-clr">清除</button></div><p class="small" id="bk-r">目標：用「重複 4 次」飛出正方形並降落。</p>`;
  const P = el.querySelector('#bk-p'), cv = el.querySelector('#bk-c').getContext('2d');
  const drawP = () => { P.innerHTML = prog.map((k, i) => `<li>${B[k]} <button data-i="${i}">✕</button></li>`).join(''); P.querySelectorAll('button').forEach(b => b.onclick = () => { prog.splice(+b.dataset.i, 1); drawP(); }); };
  el.querySelectorAll('.blk').forEach(b => b.onclick = () => { if (prog.length < 12) { prog.push(b.dataset.k); drawP(); } });
  el.querySelector('#bk-clr').onclick = () => { prog = []; drawP(); };
  // 展開迴圈：rep4 讓「下一行」重複 4 次；若下一行後面緊接著還有一行，也一起重複（兩行為一組）
  const expand = p => { const out = []; for (let i = 0; i < p.length; i++) { if (p[i] === 'rep4') { const body = p.slice(i + 1, i + 3).filter(x => x !== 'rep4' && x !== 'land' && x !== 'up'); for (let r = 0; r < 4; r++) out.push(...body); i += body.length; } else out.push(p[i]); } return out; };
  el.querySelector('#bk-run').onclick = () => {
    const steps = expand(prog); let x = 110, y = 170, h = -Math.PI / 2, air = false; const path = [[x, y]]; let err = '';
    for (const s of steps) { if (s === 'up') air = true; else if (!air) { err = '要先「起飛」才能移動'; break; } else if (s === 'fwd') { x += Math.cos(h) * 60; y += Math.sin(h) * 60; path.push([x, y]); } else if (s === 'right') h += Math.PI / 2; else if (s === 'left') h -= Math.PI / 2; else if (s === 'land') air = false; }
    cv.clearRect(0, 0, 220, 220); cv.strokeStyle = '#2f7cf6'; cv.lineWidth = 3; cv.beginPath(); path.forEach(([a, b], i) => i ? cv.lineTo(a, b) : cv.moveTo(a, b)); cv.stroke();
    cv.fillStyle = '#e74c3c'; cv.beginPath(); cv.arc(x, y, 6, 0, 7); cv.fill();
    const back = Math.hypot(x - 110, y - 170) < 1, square = path.length === 5 && back, landed = steps.at(-1) === 'land';
    const usedLoop = prog.includes('rep4');
    const r = el.querySelector('#bk-r');
    if (err) r.textContent = '錯誤：' + err;
    else if (square && landed && usedLoop) { r.textContent = '成功！用迴圈飛出正方形並降落。'; api.done(); }
    else r.textContent = `還沒完成：${!usedLoop ? '請使用「重複 4 次」；' : ''}${!square ? '路線不是正方形；' : ''}${!landed ? '最後要降落。' : ''}`;
  };
};

// U12 專題紀錄表
W['project-sheet'] = (el, api) => {
  el.innerHTML = `<label class="pair">題目 <input id="pj-t" maxlength="40" placeholder="例：電池 S 數與能量的關係"></label><label class="pair">假設 <input id="pj-h" maxlength="80" placeholder="我認為……因為……"></label>
  <table class="pj"><tr><th>條件</th><th>第 1 次</th><th>第 2 次</th><th>第 3 次</th><th>平均</th></tr>${[0, 1].map(i => `<tr><td><input data-r="${i}" data-c="n" maxlength="12"></td>${[0, 1, 2].map(j => `<td><input data-r="${i}" data-c="${j}" inputmode="decimal"></td>`).join('')}<td data-avg="${i}">-</td></tr>`).join('')}</table>
  <label class="pair">結論 <input id="pj-c" maxlength="120" placeholder="假設成立嗎？數據怎麼說？"></label><button class="btn small" id="pj-s">送出給老師</button><p class="small" id="pj-r"></p>`;
  el.addEventListener('input', () => { [0, 1].forEach(i => { const v = [0, 1, 2].map(j => parseFloat(el.querySelector(`[data-r="${i}"][data-c="${j}"]`).value)).filter(n => !isNaN(n)); el.querySelector(`[data-avg="${i}"]`).textContent = v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : '-'; }); });
  el.querySelector('#pj-s').onclick = () => {
    const t = el.querySelector('#pj-t').value.trim(), h = el.querySelector('#pj-h').value.trim(), c = el.querySelector('#pj-c').value.trim();
    const rows = [0, 1].map(i => ({ name: el.querySelector(`[data-r="${i}"][data-c="n"]`).value, vals: [0, 1, 2].map(j => el.querySelector(`[data-r="${i}"][data-c="${j}"]`).value) }));
    const full = rows.every(r => r.name && r.vals.every(v => v !== '' && !isNaN(+v)));
    if (!t || !h || !c || !full) { el.querySelector('#pj-r').textContent = '請填完題目、假設、兩個條件各 3 次數據與結論。'; return; }
    api.project?.({ title: t, hypothesis: h, rows, conclusion: c });
    el.querySelector('#pj-r').textContent = '已送出（保存在學習紀錄，老師匯入你的學習報告後即可批改）。'; api.done();
  };
};

export function mountWidget(name, el, api) {
  const f = W[name]; if (!f) { el.textContent = '（此單元沒有互動元件）'; return; }
  f(el, api);
}
export const WIDGET_NAMES = Object.keys(W);
