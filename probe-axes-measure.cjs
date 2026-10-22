// 真機測量：開有頭 Chromium，連續記錄 8 軸原始值，並把「單軸大幅偏離」的動作
// 依發生順序編號（第1次/第2次...），輸出 JSONL + 摘要。
// 用法：node probe-axes-measure.cjs [秒數]
// 不推任何桿、不做任何假設：只記錄裝置回報的數字。
const { chromium } = require('@playwright/test');
const fs = require('fs');

const SECONDS = Number(process.argv[2] || 100);
const LOG = 'probe-axes-measure.jsonl';

(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--window-size=1100,720'] });
  const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
  await page.goto('http://192.168.1.114:8111/sim/', { waitUntil: 'domcontentloaded' });

  const pad = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 300; i += 1) {
      const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
      const p = pads.find((q) => q && q.connected);
      if (p) return { id: p.id, mapping: p.mapping, axisCount: p.axes.length, buttonCount: p.buttons.length };
      await wait(100);
    }
    return null;
  });
  if (!pad) {
    console.log('NO_PAD：30 秒內瀏覽器沒有回報任何已連線控制器（請先晃一下搖桿喚醒）');
    await browser.close();
    process.exit(2);
  }
  console.log('PAD:', JSON.stringify(pad));

  const started = Date.now();
  const lines = [];
  let baseline = null;
  let actionIndex = 0;
  let lastActionAt = 0;
  let inAction = false;

  while (Date.now() - started < SECONDS * 1000) {
    const snap = await page.evaluate(() => {
      const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
      const p = pads.find((q) => q && q.connected);
      return p ? { t: Date.now(), axes: Array.from(p.axes) } : null;
    });
    if (snap) {
      if (!baseline) baseline = snap.axes.slice();
      const devs = snap.axes.map((v, i) => Math.abs(v - (baseline[i] ?? 0)));
      const maxDev = Math.max(...devs);
      const maxIdx = devs.indexOf(maxDev);
      lines.push(JSON.stringify({ t: snap.t, axes: snap.axes.map((v) => Number(v.toFixed(4))), maxIdx, maxDev: Number(maxDev.toFixed(3)) }));

      const now = Date.now();
      if (!inAction && maxDev > 0.6 && now - lastActionAt > 1500) {
        inAction = true;
        actionIndex += 1;
        lastActionAt = now;
        console.log(`ACTION #${actionIndex} t=${((now - started) / 1000).toFixed(1)}s axis${maxIdx}=${snap.axes[maxIdx].toFixed(3)} (rest ${(baseline[maxIdx] ?? 0).toFixed(3)}) all=${snap.axes.slice(0, 4).map((v) => v.toFixed(2)).join(',')}`);
      } else if (inAction && maxDev < 0.2) {
        inAction = false;
        lastActionAt = Date.now();
      }
    }
    await page.waitForTimeout(50);
  }

  fs.writeFileSync(LOG, lines.join('\n') + '\n');
  // 摘要：每個軸的極值
  const axes = baseline.length;
  const summary = [];
  for (let i = 0; i < axes; i += 1) {
    let min = Infinity;
    let max = -Infinity;
    for (const line of lines) {
      const v = JSON.parse(line).axes[i];
      if (Number.isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v); }
    }
    summary.push({ axis: i, rest: Number((baseline[i] ?? 0).toFixed(4)), min: Number(min.toFixed(4)), max: Number(max.toFixed(4)), span: Number((max - min).toFixed(4)) });
  }
  console.log('SUMMARY', JSON.stringify({ pad, actions: actionIndex, summary }, null, 2));
  fs.writeFileSync('probe-axes-summary.json', JSON.stringify({ pad, actions: actionIndex, summary, baseline }, null, 2));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
