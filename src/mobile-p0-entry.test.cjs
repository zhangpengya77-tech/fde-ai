const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

test('手機選單預設收合且提供既有平台入口', () => {
  assert.match(html, /id="mobileMenuToggle"/);
  assert.match(html, /id="mobileMenu"[^>]*hidden/);
  assert.match(html, /id="portalMenuToggle"/);
  assert.match(html, /href="\/teacher\/login\/">教師後台<\/a>/);
  assert.match(html, /href="\/flight-health\/"/);
  assert.match(html, /href="\/student\/growth\/"/);
  assert.match(app, /mobileMenuToggle/);
});
