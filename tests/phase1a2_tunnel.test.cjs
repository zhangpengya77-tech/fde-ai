const assert = require('node:assert/strict');
const test = require('node:test');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('quick tunnel dry-run is localhost-only and production-isolated', () => {
  const script = path.resolve(__dirname, '..', 'ops', 'v2', 'start-phase1a2-tunnel.ps1');
  const output = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-DryRun'], { encoding: 'utf8' });
  const result = JSON.parse(output.trim());
  assert.equal(result.target, 'http://127.0.0.1:8030');
  assert.equal(result.tunnel_type, 'cloudflare_quick_tunnel');
  assert.equal(result.production_worker_updated, false);
  assert.equal(result.production_tunnel_updated, false);
  assert.equal(result.secrets_updated, false);
});

