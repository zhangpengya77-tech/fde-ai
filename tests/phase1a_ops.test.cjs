const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const powershell = 'powershell.exe';

function runScript(name, args = []) {
  return spawnSync(
    powershell,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'ops', 'v2', name), ...args],
    { cwd: root, encoding: 'utf8' }
  );
}

test('start dry-run reports isolated localhost services without starting processes', () => {
  const result = runScript('start-phase1a.ps1', ['-DryRun']);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.mode, 'dry_run');
  assert.equal(payload.live_backend.url, 'http://127.0.0.1:8030');
  assert.equal(payload.vision.url, 'http://127.0.0.1:8765');
  assert.equal(payload.production_worker_updated, false);
  assert.equal(payload.tunnel_started, false);
});

test('status reports component availability as JSON even when services are offline', () => {
  const result = runScript('status-phase1a.ps1');

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.ok(['online', 'degraded', 'offline'].includes(payload.status));
  assert.ok(['online', 'offline'].includes(payload.components.live_backend));
  assert.ok(['online', 'offline'].includes(payload.components.vision));
});

test('stop with no owned state is safe and does not treat unrelated processes as owned', () => {
  const emptyState = path.join(root, '.test-temp', `phase1a-empty-${process.pid}.json`);
  const result = runScript('stop-phase1a.ps1', ['-StateFile', emptyState]);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    stopped: [],
    status: 'nothing_to_stop'
  });
});
