const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('根首頁提供桌面與手機下載中心入口', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(html, /class="portal-entry-links"[\s\S]*href="\/downloads\/"[\s\S]*下載中心/);
  assert.match(html, /id="mobileMenu"[\s\S]*href="\/downloads\/">下載中心<\/a>/);
  assert.match(html, /<a href="\/downloads\/">下載中心<\/a>/);
});
