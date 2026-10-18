const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('總首頁提供既有 Portal、Flight Health 與下載中心入口', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

  assert.match(html, /href="\/student\/"[^>]*>學員前端<\/a>/);
  assert.match(html, /href="\/register\/"/);
  assert.match(html, /href="\/teacher\/login\/"/);
  assert.match(html, /href="\/downloads\/"/);
  assert.match(html, /href="\.\/flight-health\//);
  assert.doesNotMatch(app, /title:\s*'下載中心\s*\/\s*Download Center'/);
  assert.match(app, /title:\s*'飛行健康 AI\s*\/\s*Flight Health'/);
});
