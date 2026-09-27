const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

test('development supervisor starts the snapshot-only vision entrypoint', () => {
  const root = path.resolve(__dirname, '..');
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(root, 'ops', 'v2', 'start-phase1a.ps1'),
      '-DryRun'
    ],
    { cwd: root, encoding: 'utf8' }
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.match(payload.vision.entrypoint, /vision_snapshot_server\.py$/);
  assert.doesNotMatch(payload.vision.entrypoint, /yolo_server\.py$/);
});
