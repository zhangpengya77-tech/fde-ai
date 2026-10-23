/**
 * 人工驗證前置預檢（跑在「教師實際會打開的那個網址」上）。
 *
 * 目的：把「人工驗證清單」裡可以自動判定的項目先跑一遍，留下截圖與數值，
 * 教師只需驗證手感與觀感（機體大小、字級、顏色、搖桿反應），不必再從零排查。
 *
 * 與 tests/browser/exam-drone.spec.ts 的差別：
 *  - 那支跑 Vite preview（4173），是 CI 用的；
 *  - 這支跑既有的 8111 服務（/sim/，直接吃 dist），就是教師的入口。
 *
 * 用法：
 *   node tools/manual-verify-smoke.mjs                     # 預設 http://127.0.0.1:8111/sim/
 *   node tools/manual-verify-smoke.mjs http://127.0.0.1:4173/
 *
 * 產出：.playwright-output/manual-verify/*.png 與一則 JSON 摘要（stdout）。
 */

import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8111/sim/';
const OUT = '.playwright-output/manual-verify';
const URL_EXAM = `${BASE}${BASE.includes('?') ? '&' : '?'}mode=exam`;

const notes = [];
const record = (item, ok, detail) => notes.push({ item, ok, detail });

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  args: [
    // Chrome 會節流被遮擋視窗的 rAF，導致計時與渲染隨機失敗（見 playwright.config.ts）。
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

const state = () => page.evaluate(() => window.__examTestHook.getState());
const droneScreen = () => page.evaluate(() => window.__examTestHook.getDroneScreen());
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const bodyText = () => page.evaluate(() => document.body.innerText);

await page.goto(URL_EXAM, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__examTestHook), undefined, { timeout: 30_000 });
// 等畫面真的畫過（frames > 5），否則截圖可能全黑。
await page.waitForFunction(() => window.__examTestHook.getState().frames > 5, undefined, { timeout: 30_000 });

// ---- ① 初次進入：機體看得見、停在地面 ----
const s0 = await state();
const d0 = await droneScreen();
await shot('00-initial');
record('① 初次進入可見機體', d0.inView && d0.sizePx > 20, `投影 ${d0.x},${d0.y} 尺寸 ${d0.sizePx}px，高度 ${s0.altitude.toFixed(2)}m，狀態 ${s0.flightState}`);
record('① 預設風況為無風', /無風/.test(await bodyText()), (await bodyText()).match(/風：[^\n]+/)?.[0] ?? '未找到風況文字');
record('① 步驟條高亮目前步驟', (await page.locator('[data-step][data-current="true"]').count()) === 1, `目前步驟 ${s0.step}`);

// ---- ② 未選科目的防護：按 T 必須給明確原因，不得靜默失效 ----
await page.keyboard.press('KeyT');
await page.waitForTimeout(300);
const guardText = await bodyText();
// 提示字串來自 i18n：'請先選科目（點上方科目按鈕）'
const guarded = /請先選科目/.test(guardText) || /请先选科目/.test(guardText);
await shot('01-guard-no-subject');
record('② 未選科目按 T 有明確提示', guarded, guarded ? '提示已顯示' : '未看到提示文字');
record('② 未選科目時起飛鈕為停用', await page.locator('[data-action="takeoff"]').isDisabled(), 'disabled 狀態');

// ---- ③ 選科目 B 後起飛 ----
await page.locator('[data-subject="B"]').click();
await page.waitForTimeout(200);
const sB = await state();
await shot('02-subject-B');
record('③ 選科目 B 後狀態更新', sB.subject === 'B', `科目 ${sB.subject}，步驟 ${sB.step}`);

await page.locator('[data-action="takeoff"]').click();
await page.waitForFunction(() => window.__examTestHook.getState().altitude > 1.2, undefined, { timeout: 20_000 });
await page.waitForTimeout(1200);
const s1 = await state();
const d1 = await droneScreen();
await shot('03-airborne');
record('③ 起飛後離地', s1.altitude > 1.2, `高度 ${s1.altitude.toFixed(2)}m，狀態 ${s1.flightState}`);
record('③ 起飛後機體仍在畫面內', d1.inView, `投影 ${d1.x},${d1.y} 尺寸 ${d1.sizePx}px`);
record('③ 無風下定位保持不漂移', Math.hypot(s1.position.x, s1.position.z) < 0.2, `水平位移 ${Math.hypot(s1.position.x, s1.position.z).toFixed(3)}m`);

// ---- ④ 風況切換：微風／接近門檻／觸發宣告 ----
const windLine = async () => (await bodyText()).match(/風：[^\n]+/)?.[0] ?? '(未找到)';
// 風況切換器收在頂欄的 <details> 裡（摘要列本身隨時顯示當前風況，點一下展開）。
// 展開時面板必須是浮層，不得把科目列／步驟條往下推。
const stageTop = () => page.evaluate(() => document.querySelector('#exam-stage').getBoundingClientRect().top);
const setWindChipOpen = (open) =>
  page.evaluate((v) => {
    for (const d of document.querySelectorAll('#exam-topbar details')) d.open = v;
  }, open);
const openWindChip = async () => {
  await setWindChipOpen(true);
  await page.waitForTimeout(150);
};

const stageTopBefore = await stageTop();
await openWindChip();
const stageTopOpen = await stageTop();
record('④ 展開風況面板不推動版面', Math.abs(stageTopOpen - stageTopBefore) < 1, `舞台頂端 ${stageTopBefore.toFixed(0)} → ${stageTopOpen.toFixed(0)}px`);
await setWindChipOpen(false);

const pickWind = async (key, name) => {
  await openWindChip();
  await page.selectOption('[data-wind-preset]', key);
  await page.waitForTimeout(1500);
  const st = await state();
  const line = await windLine();
  await shot(`${name}-open`);
  await setWindChipOpen(false);
  await page.waitForTimeout(150);
  await shot(name);
  return { st, line };
};

const breeze = await pickWind('breeze', '04-breeze');
record('④ 微風 2/4 顯示平均與陣峰', /平均 2\.0/.test(breeze.line) && /陣峰 4\.0/.test(breeze.line), breeze.line);
record('④ 微風不需安全宣告', !breeze.line.includes('⚠'), breeze.line);

const near = await pickWind('nearThreshold', '05-near-threshold');
record('④ 接近門檻 7/9 不需宣告（未達 7.5／10）', !near.line.includes('⚠'), near.line);

const decl = await pickWind('declaration', '06-declaration');
record('④ 觸發宣告 7.5/10 顯示警示', decl.line.includes('⚠'), decl.line);

const calm = await pickWind('calm', '07-back-to-calm');
record('④ 切回無風後警示消失', !calm.line.includes('⚠'), calm.line);

// ---- ⑤ V 鍵三視角 ----
await page.keyboard.press('KeyV');
await page.waitForTimeout(400);
const v1 = await state();
const dFollow = await droneScreen();
await shot('08-camera-chase');
await page.keyboard.press('KeyV');
await page.waitForTimeout(400);
const v2 = await state();
const dOver = await droneScreen();
await shot('09-camera-overview');
await page.keyboard.press('KeyV');
await page.waitForTimeout(400);
const v3 = await state();
record('⑤ V 鍵三視角循環', new Set([s0.cameraView, v1.cameraView, v2.cameraView]).size === 3 && v3.cameraView === s0.cameraView, `${s0.cameraView} → ${v1.cameraView} → ${v2.cameraView} → ${v3.cameraView}`);
// 僅供參考，不判定：全景視角本來就會讓機體變小，數字用來判斷「小到看不見」還是「小但可辨」。
record('⑤ 追隨／全景的機體尺寸（僅供參考）', true, `追隨 ${dFollow.sizePx.toFixed(0)}px、全景 ${dOver.sizePx.toFixed(0)}px、考生 ${d0.sizePx.toFixed(0)}px`);

// ---- ⑥ 降落 ----
await page.locator('[data-action="land"]').click();
await page.waitForFunction(() => window.__examTestHook.getState().flightState === 'landed', undefined, { timeout: 30_000 });
await page.waitForTimeout(500);
const sL = await state();
await shot('10-landed');
record('⑥ 降落後回到地面', sL.altitude < 0.2, `高度 ${sL.altitude.toFixed(2)}m，狀態 ${sL.flightState}`);

// ---- ⑦ 版面：面板兩兩不相交、中央淨空 ----
const boxes = await page.evaluate(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return { id: sel, x: r.x, y: r.y, w: r.width, h: r.height };
  };
  return ['#exam-topbar', '#exam-hud-host', '#exam-controls', '#exam-keyhint'].map(pick).filter(Boolean);
});
const overlaps = [];
for (let i = 0; i < boxes.length; i += 1) {
  for (let j = i + 1; j < boxes.length; j += 1) {
    const a = boxes[i];
    const b = boxes[j];
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ox > 1 && oy > 1) overlaps.push(`${a.id}×${b.id} (${ox.toFixed(0)}×${oy.toFixed(0)}px)`);
  }
}
record('⑦ 面板互不重疊', overlaps.length === 0, overlaps.length ? overlaps.join('; ') : `${boxes.length} 個面板`);

const centerClear = await page.evaluate(() => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const cx = w * 0.3;
  const cy = h * 0.25;
  const cw = w * 0.4;
  const ch = h * 0.5;
  const hit = [];
  // #exam-stage 是場景容器本身（必然覆蓋中央），#exam-app 是根層，兩者不算遮擋。
  const containers = new Set(['exam-stage', 'exam-app']);
  for (const el of document.querySelectorAll('body *')) {
    if (!el.id && !el.className) continue;
    if (el.tagName === 'CANVAS') continue;
    if (containers.has(el.id)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (getComputedStyle(el).position === 'static') continue;
    const ox = Math.min(r.x + r.width, cx + cw) - Math.max(r.x, cx);
    const oy = Math.min(r.y + r.height, cy + ch) - Math.max(r.y, cy);
    if (ox > 1 && oy > 1) hit.push(el.id || el.className);
  }
  return hit;
});
record('⑦ 場景中央 40%×50% 淨空', centerClear.length === 0, centerClear.length ? centerClear.join(', ') : '無覆蓋');

record('⑦ 主控台無錯誤', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || '無');

await browser.close();

const pass = notes.filter((n) => n.ok).length;
console.log(`\n=== 人工驗證預檢 @ ${URL_EXAM} ===`);
for (const n of notes) console.log(`${n.ok ? 'PASS' : 'FAIL'}  ${n.item} — ${n.detail}`);
console.log(`\n合計 ${pass}/${notes.length} 通過；截圖在 ${OUT}/`);
process.exit(pass === notes.length ? 0 : 1);
