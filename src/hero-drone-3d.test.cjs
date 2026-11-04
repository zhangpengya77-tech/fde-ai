// 2026-11-05：首頁右側 3D F450 動畫驗收測試（靜態檢查：載入方式、旋向、降級與備援、首頁其他部分未動）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, 'hero-drone-3d.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');

test('首頁以 module 延後載入 3D 模組，沿用 F450 數位孿生的 three.js 與 GLB', () => {
  assert.match(html, /<script type="importmap">\{"imports":\{"three":"\/f450-twin\/vendor\/three\/three\.module\.min\.js"\}\}<\/script>/);
  assert.match(html, /<script type="module" src="\.\/src\/hero-drone-3d\.js\?v=[^"]+"><\/script>/);
  assert.ok(js.includes("'/f450-twin/models/f450-l2-r4-preview-assembly.glb'"));
  assert.ok(fs.existsSync(path.join(root, 'f450-twin/models/f450-l2-r4-preview-assembly.glb')));
  assert.match(js, /requestIdleCallback/, '空閒時才載入，不拖慢首頁');
});

test('四片螺旋槳獨立旋轉，X 型配置相鄰旋向相反', () => {
  assert.match(js, /propeller\\s\+\(FL\|FR\|RL\|RR\)/);
  assert.match(js, /const dir = pos === 'FR' \|\| pos === 'RL' \? 1 : -1;/);
  assert.match(js, /p\.pivot\.rotation\.y \+= p\.dir \* p\.speed \* dt/);
  assert.doesNotMatch(js, /model\.rotation\.y\s*\+=/, '不得旋轉整個模型');
});

test('低階裝置降頻、減少動態、離開畫面暫停、失敗改靜態圖', () => {
  assert.match(js, /lowEnd \? 1000 \/ 30 : 0/);
  assert.match(js, /prefers-reduced-motion: reduce/);
  assert.match(js, /IntersectionObserver/);
  assert.match(js, /visibilitychange/);
  assert.match(js, /showFallback\('模型載入失敗'\)/);
  assert.ok(fs.existsSync(path.join(__dirname, 'assets/hero-drone-fallback.jpg')));
  assert.match(css, /\.drone-stage\.drone-3d-ready \.drone/);
});

test('首頁左側文案、右上角五個入口、學練做測證結構保留', () => {
  for (const id of ['heroHeadline', 'heroSummary', 'heroSystems', 'heroActions']) assert.ok(html.includes(`id="${id}"`), id);
  for (const entry of ['學員登入', '學員註冊', '教師登入', '下載中心', '仿真訓練']) assert.ok(html.includes(entry), entry);
  for (const id of ['learn', 'practice', 'build', 'inspection', 'certify']) assert.ok(html.includes(`id="${id}"`), id);
  assert.ok(html.includes('class="drone"'), '原 CSS 線框機保留為 3D 載入前的占位');
});
