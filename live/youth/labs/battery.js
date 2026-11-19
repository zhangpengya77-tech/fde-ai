// 實驗 C：電池科學（單體／串聯／並聯／3S・4S・6S；即時計算電壓、容量、能量；電流路徑與安全示警）
// 以 SVG 繪製，純虛擬操作；畫面固定顯示安全提示，不引導學生拆裝真實鋰電池
import { batteryPack, CELL } from '../core/physics.js';

export const meta = { id: 'battery', title: '電池科學', unit: 5 };

export function mount(host, ctx) {
  host.innerHTML = `
  <div class="tabs" role="tablist"><button data-t="1" class="on">01 串聯與並聯</button><button data-t="2">02 充放電原理</button><button data-t="3">03 過充與鼓包</button></div>
  <div class="lab3">
    <aside class="card lab-side">
      <p class="eyebrow">SERIES／串聯數量</p>
      <div class="stepper"><button id="b-sdec">−</button><b id="b-s">3<small>S</small></b><button id="b-sinc">＋</button></div>
      <p class="eyebrow">PARALLEL／並聯數量</p>
      <div class="stepper"><button id="b-pdec">−</button><b id="b-p">1<small>P</small></b><button id="b-pinc">＋</button></div>
      <div class="quick"><button data-sp="1,1">單體</button><button data-sp="3,1">3S</button><button data-sp="4,1">4S</button><button data-sp="6,1">6S</button><button data-sp="4,2">4S2P</button></div>
      <label class="rng">單芯電壓 <b id="b-v-v">3.70 V</b><input type="range" id="b-v" min="3.0" max="4.35" step="0.01" value="3.70"></label>
      <div class="quick"><button data-v="3.2">3.2 放電參考</button><button data-v="3.7">3.7 標稱</button><button data-v="4.2">4.2 滿電</button></div>
      <label class="rng">單芯容量 <select id="b-mah"><option>1000</option><option selected>1500</option><option>2200</option><option>5000</option></select> mAh</label>
    </aside>
    <div class="lab-stage light" id="b-stage"><svg id="b-svg" viewBox="0 0 640 380" role="img" aria-label="電池組示意圖"></svg></div>
    <aside class="card lab-info">
      <p class="eyebrow">電池組</p><h3 id="b-label">3S1P</h3>
      <div class="kpis"><div><small>總電壓</small><b id="b-V">11.10 V</b></div><div><small>總容量</small><b id="b-C">1500 mAh</b></div><div><small>能量（標稱）</small><b id="b-E">16.7 Wh</b></div><div><small>電芯數</small><b id="b-N">3</b></div></div>
      <p id="b-state" class="state ok">電壓正常</p>
      <p id="b-explain" class="muted small"></p>
      <p class="safety">⚠ 本實驗只在虛擬環境操作。真實鋰電池不可拆解、刺穿或自行串並聯，充電必須用平衡充電器並有人看管。</p>
    </aside>
  </div>`;
  const $ = s => host.querySelector(s);
  let S = 3, P = 1, V = 3.7, tab = '1', t0 = performance.now(), raf = 0;
  const seen = new Set();

  const svg = $('#b-svg');
  function draw() {
    const r = batteryPack({ s: S, p: P, cellV: V, cellMah: +$('#b-mah').value });
    $('#b-s').innerHTML = `${S}<small>S</small>`; $('#b-p').innerHTML = `${P}<small>P</small>`;
    $('#b-v-v').textContent = `${V.toFixed(2)} V`;
    $('#b-label').textContent = r.label; $('#b-V').textContent = `${r.voltage.toFixed(2)} V`;
    $('#b-C').textContent = `${r.capacityMah} mAh`; $('#b-E').textContent = `${r.energyWh} Wh`; $('#b-N').textContent = r.cells;
    const msg = { ok: '電壓正常', over: `過充！單芯 ${V.toFixed(2)} V 超過 4.20 V，電池會產氣鼓包甚至起火`, under: `過放！單芯低於 ${CELL.LOW} V，電芯會受損` }[r.state];
    const el = $('#b-state'); el.textContent = msg; el.className = 'state ' + r.state;
    $('#b-explain').textContent = `串聯 ${S} 顆：電壓 ${S} × ${V.toFixed(2)} = ${r.voltage.toFixed(2)} V。並聯 ${P} 組：容量 ${P} × ${$('#b-mah').value} = ${r.capacityMah} mAh。能量 ＝ 標稱 ${r.nominalV} V × ${(r.capacityMah / 1000).toFixed(2)} Ah ＝ ${r.energyWh} Wh。`;
    seen.add(r.label);
    if (r.label === '4S2P') { ctx.task?.(); }
    if (['1S1P', '3S1P', '4S1P', '6S1P', '4S2P'].every(x => seen.has(x)) && !draw.done) { draw.done = true; ctx.done?.({ completed: true, configs: [...seen] }); }
    ctx.log?.('config', r.label);
    render(r);
  }

  function render(r) {
    const now = (performance.now() - t0) / 1000;
    let h = '';
    if (tab === '1') {
      // 電芯格狀排列：每列一串（S 顆），共 P 列並聯
      const cw = Math.min(70, 480 / S - 12), ch = 110, gap = 12;
      const totalW = S * cw + (S - 1) * gap, x0 = (640 - totalW) / 2;
      const rowH = Math.min(150, 300 / P), y0 = (380 - P * rowH) / 2 + 10;
      for (let j = 0; j < P; j++) {
        const y = y0 + j * rowH, hh = Math.min(ch, rowH - 30);
        for (let i = 0; i < S; i++) {
          const x = x0 + i * (cw + gap);
          const fill = r.state === 'over' ? '#ffd1d1' : r.state === 'under' ? '#fff1c9' : '#e7f0ff';
          const bulge = r.state === 'over' ? 4 : 0;
          h += `<rect x="${x - bulge}" y="${y}" width="${cw + bulge * 2}" height="${hh}" rx="10" fill="${fill}" stroke="#3a6fd8" stroke-width="2"/>`;
          h += `<rect x="${x + cw * 0.3}" y="${y - 6}" width="${cw * 0.4}" height="6" rx="2" fill="#3a6fd8"/>`;
          h += `<text x="${x + cw / 2}" y="${y + hh / 2}" text-anchor="middle" font-size="13" fill="#123">${V.toFixed(2)}V</text>`;
          if (i < S - 1) h += `<path d="M${x + cw} ${y + 16} L${x + cw + gap} ${y + 16}" class="wire flow" stroke="#ff8a00"/>`;
        }
        h += `<text x="${x0 - 14}" y="${y + 20}" text-anchor="end" font-size="16" fill="#d33">＋</text><text x="${x0 + totalW + 14}" y="${y + 20}" font-size="16" fill="#333">−</text>`;
        if (P > 1) {
          h += `<path d="M${x0 - 6} ${y + 16} L${x0 - 28} ${y + 16}" class="wire flow" stroke="#d33"/>`;
          h += `<path d="M${x0 + totalW + 6} ${y + 16} L${x0 + totalW + 28} ${y + 16}" class="wire flow" stroke="#333"/>`;
        }
      }
      if (P > 1) {
        h += `<path d="M${x0 - 28} ${y0 + 16} L${x0 - 28} ${y0 + (P - 1) * rowH + 16}" class="wire" stroke="#d33"/>`;
        h += `<path d="M${x0 + totalW + 28} ${y0 + 16} L${x0 + totalW + 28} ${y0 + (P - 1) * rowH + 16}" class="wire" stroke="#333"/>`;
      }
      h += `<text x="320" y="370" text-anchor="middle" font-size="15" fill="#123">橘色虛線＝電流路徑　總電壓 ${r.voltage.toFixed(2)} V　總容量 ${r.capacityMah} mAh</text>`;
    } else if (tab === '2') {
      // 充放電：鋰離子在正極（左）與負極（右）間移動
      const charging = V >= 3.7;
      h += `<rect x="70" y="60" width="150" height="240" rx="14" fill="#ffb15c"/><text x="145" y="330" text-anchor="middle" font-size="15">正極（鋰金屬氧化物）</text>`;
      h += `<rect x="420" y="60" width="150" height="240" rx="14" fill="#7d93b2"/><text x="495" y="330" text-anchor="middle" font-size="15">負極（石墨）</text>`;
      h += `<rect x="300" y="60" width="40" height="240" fill="#dfe8f5"/><text x="320" y="50" text-anchor="middle" font-size="13">隔離膜</text>`;
      for (let i = 0; i < 18; i++) {
        const ph = ((now * 0.35 + i / 18) % 1);
        const x = charging ? 220 + ph * 200 : 420 - ph * 200;
        const y = 80 + (i * 37) % 210;
        h += `<circle cx="${x}" cy="${y}" r="6" fill="#2f7cf6"/>`;
      }
      h += `<text x="320" y="365" text-anchor="middle" font-size="16" fill="#123">${charging ? '充電中：鋰離子從正極移到負極儲存能量（拖曳單芯電壓到 3.7 V 以下看放電）' : '放電中：鋰離子回到正極，外部電路得到電流'}</text>`;
    } else {
      // 過充與鼓包：電壓越高，軟包膨脹越大
      const over = Math.max(0, V - CELL.FULL);
      const bulge = 8 + over * 900;
      h += `<ellipse cx="320" cy="190" rx="${110 + bulge * 0.4}" ry="${140}" fill="${over > 0 ? '#ffd6d6' : '#e7f0ff'}" stroke="${over > 0 ? '#d33' : '#3a6fd8'}" stroke-width="3"/>`;
      h += `<rect x="${290}" y="40" width="60" height="16" fill="#999"/>`;
      if (over > 0) for (let i = 0; i < 10; i++) h += `<circle cx="${270 + (i * 47) % 110}" cy="${120 + ((now * 40 + i * 30) % 150)}" r="${4 + i % 3}" fill="#fff" stroke="#d33"/>`;
      h += `<text x="320" y="365" text-anchor="middle" font-size="16" fill="${over > 0 ? '#c00' : '#123'}">${over > 0 ? '過充產氣，軟包鼓起：立即停用，交給老師依規定處理' : '把單芯電壓拉到 4.20 V 以上，觀察過充的後果（只在虛擬環境）'}</text>`;
    }
    svg.innerHTML = h;
  }

  const loop = () => { render(batteryPack({ s: S, p: P, cellV: V, cellMah: +$('#b-mah').value })); raf = requestAnimationFrame(loop); };
  host.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { tab = b.dataset.t; host.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b)); ctx.log?.('tab', tab); });
  $('#b-sdec').onclick = () => { S = Math.max(1, S - 1); draw(); }; $('#b-sinc').onclick = () => { S = Math.min(6, S + 1); draw(); };
  $('#b-pdec').onclick = () => { P = Math.max(1, P - 1); draw(); }; $('#b-pinc').onclick = () => { P = Math.min(3, P + 1); draw(); };
  host.querySelectorAll('[data-sp]').forEach(b => b.onclick = () => { [S, P] = b.dataset.sp.split(',').map(Number); draw(); });
  host.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { V = +b.dataset.v; $('#b-v').value = V; draw(); });
  $('#b-v').oninput = e => { V = +e.target.value; draw(); };
  $('#b-mah').onchange = draw;
  draw(); raf = requestAnimationFrame(loop);
  ctx.onReset = () => { S = 3; P = 1; V = 3.7; $('#b-v').value = 3.7; seen.clear(); draw.done = false; draw(); };
  return () => cancelAnimationFrame(raf);
}
