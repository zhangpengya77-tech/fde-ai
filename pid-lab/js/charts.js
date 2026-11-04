/* 無依賴的 Canvas 折線圖：時間曲線、頻譜、階躍響應共用。 */
(function () {
  function niceTicks(min, max, count) {
    if (!(isFinite(min) && isFinite(max)) || min === max) { max = min + 1; }
    const span = max - min;
    const step0 = span / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const norm = step0 / mag;
    const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
    const ticks = [];
    for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(+v.toFixed(10));
    return ticks;
  }

  function drawLines(canvas, series, opts) {
    opts = opts || {};
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 600;
    const h = canvas.clientHeight || 220;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const pad = { l: 46, r: 10, t: 10, b: 28 };
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    series.forEach((s) => {
      for (let i = 0; i < s.x.length; i++) {
        const x = s.x[i], y = s.y[i];
        if (!isFinite(x) || !isFinite(y)) continue;
        if (x < xmin) xmin = x; if (x > xmax) xmax = x;
        if (y < ymin) ymin = y; if (y > ymax) ymax = y;
      }
    });
    if (opts.ymin !== undefined) ymin = Math.min(ymin, opts.ymin);
    if (opts.ymax !== undefined) ymax = Math.max(ymax, opts.ymax);
    if (!isFinite(xmin)) { ctx.fillStyle = '#94abc2'; ctx.fillText('沒有資料', 10, 20); return; }
    const ypad = (ymax - ymin) * 0.08 || 1;
    ymin -= ypad; ymax += ypad;
    const X = (x) => pad.l + (x - xmin) / (xmax - xmin || 1) * (w - pad.l - pad.r);
    const Y = (y) => h - pad.b - (y - ymin) / (ymax - ymin || 1) * (h - pad.t - pad.b);
    ctx.font = '11px sans-serif';
    ctx.strokeStyle = 'rgba(148,171,194,0.15)';
    ctx.fillStyle = '#94abc2';
    niceTicks(ymin, ymax, 4).forEach((v) => {
      ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(w - pad.r, Y(v)); ctx.stroke();
      ctx.fillText(String(Math.round(v * 100) / 100), 4, Y(v) + 4);
    });
    niceTicks(xmin, xmax, 6).forEach((v) => {
      ctx.beginPath(); ctx.moveTo(X(v), pad.t); ctx.lineTo(X(v), h - pad.b); ctx.stroke();
      ctx.fillText(String(Math.round(v * 100) / 100), X(v) - 8, h - 10);
    });
    if (opts.xlabel) ctx.fillText(opts.xlabel, w - pad.r - ctx.measureText(opts.xlabel).width, h - 1);
    (opts.hlines || []).forEach((hl) => {
      ctx.save(); ctx.strokeStyle = hl.color || '#f59e0b'; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(pad.l, Y(hl.y)); ctx.lineTo(w - pad.r, Y(hl.y)); ctx.stroke(); ctx.restore();
    });
    series.forEach((s) => {
      ctx.save();
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 1.4;
      if (s.dash) ctx.setLineDash(s.dash);
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < s.x.length; i++) {
        if (!isFinite(s.x[i]) || !isFinite(s.y[i])) { started = false; continue; }
        const px = X(s.x[i]), py = Y(s.y[i]);
        if (!started) { ctx.moveTo(px, py); started = true; } else { ctx.lineTo(px, py); }
      }
      ctx.stroke();
      ctx.restore();
    });
  }

  window.LabCharts = { drawLines };
})();
