// 即時探測：只做兩個動作——右搖桿「往上推」停 2 秒、「往右推」停 2 秒。
// 每 100ms 抓一次 axes，偏離休止 >0.5 即時回報是「哪個軸、什麼極性」。
const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => console.log('PAGE_ERROR:', String(e).slice(0, 100)));
  await page.goto('http://127.0.0.1:8013/sim/');

  const DURATION_MS = 60000;
  const started = Date.now();
  const baseline = [null, null, null, null];
  const events = [];
  let lastEvent = 0;

  console.log('PROBE_START: 請依序 1) 右搖桿往上推滿停2秒 2) 回中 3) 右搖桿往右推滿停2秒 4) 放開');

  while (Date.now() - started < DURATION_MS) {
    const snap = await page.evaluate(() => {
      const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
      const pad = pads.find((p) => p && p.connected);
      return pad ? Array.from(pad.axes) : null;
    });
    if (snap) {
      if (baseline[0] === null) { for (let i = 0; i < 8; i++) baseline[i] = snap[i] ?? 0; }
      const now = Date.now();
      for (let i = 0; i < 4; i++) {
        const v = snap[i] ?? 0;
        const dev = v - baseline[i];
        if (Math.abs(dev) > 0.5 && now - lastEvent > 400) {
          lastEvent = now;
          const sec = ((now - started) / 1000).toFixed(1);
          events.push(`t=${sec}s axis${i} -> ${v.toFixed(3)} (休止 ${baseline[i].toFixed(3)})`);
          console.log(`EVENT t=${sec}s: axis${i} = ${v.toFixed(3)}  [休止 ${baseline[i].toFixed(3)}]`);
        }
      }
    }
    await page.waitForTimeout(100);
  }
  console.log('PROBE_DONE events=' + events.length);
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
