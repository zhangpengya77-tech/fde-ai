const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const routerSource = fs.readFileSync(path.join(__dirname, 'router.js'), 'utf8');
const context = { URL, window: { location: { origin: 'https://example.test', pathname: '/fde-ai/' } } };
vm.runInNewContext(routerSource, context);

test('FDE column uses a flat route that works under the GitHub Pages project path', () => {
  const router = context.window.FdeRouter;

  assert.equal(router.routeFromLocation({ pathname: '/fde-ai/fde' }), 'fde-column');
  assert.equal(router.routeFromHref('./fde', { origin: 'https://example.test', pathname: '/fde-ai/courses' }), 'fde-column');
  assert.equal(router.hrefFor('fde-column'), './fde');
});
