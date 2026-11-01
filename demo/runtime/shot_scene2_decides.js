// Screenshot the PASSED-state scene-2 page.
//
// The HTML comes from render_scene2_pass.py (real view + template, in-memory
// session with verdict == MATCH). Static assets are root-relative, so we inject
// a <base href> pointing at the live DEMO Django for CSS to resolve.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const OUT = 'D:/FDE-AI-UAS-v2.0/demo/runtime/logs/scene3-teacher-decides-evidence-2026-10-22';
const HTML = path.join(OUT, 'scene2-teacher-decides.html');
const PNG = path.join(OUT, '02-teacher-decides.png');
const BASE = 'http://127.0.0.1:8110';

(async () => {
  let html = fs.readFileSync(HTML, 'utf8');
  if (!/<base\s/i.test(html)) {
    html = html.replace('<head>', '<head>\n  <base href="' + BASE + '/">');
  }
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewportSize: { width: 1440, height: 1500 } });
  await page.setContent(html, { waitUntil: 'load' });
  // expand every <details> so nothing important is folded away
  await page.evaluate(() => {
    document.querySelectorAll('details').forEach((d) => { d.open = true; });
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: PNG, fullPage: true });
  const text = await page.evaluate(() => {
    const sec = document.querySelector('section[data-scene="2"]');
    return sec ? sec.innerText : '(scene 2 section not found)';
  });
  console.log('saved:', PNG);
  console.log('---- scene2 visible text ----');
  console.log(text);
  await browser.close();
})().catch((e) => {
  console.error('FAILED:', e && e.message ? e.message : e);
  process.exit(1);
});
