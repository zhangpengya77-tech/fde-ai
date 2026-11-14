import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { MavlinkParser, OutgoingNotAllowedError, PARAM_WRITE_CAPABILITY, encodeMessage } from '../static/gcs_portal/mavlink/codec.js';
import { VehicleLink } from '../static/gcs_portal/mavlink/link.js';
import { WriteBlockedError, evaluateWriteChecks, validateChange, writeApprovedParam } from '../static/gcs_portal/mavlink/writer.js';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/mavlink_fixtures.json', import.meta.url)));
const allowlist = JSON.parse(readFileSync(new URL('../param_allowlist/arducopter-4.json', import.meta.url)));
const hex = (h) => Uint8Array.from(h.match(/../g).map((b) => parseInt(b, 16)));
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const DISARMED_HB = hex('fd090000000101000000050000000203510303590e');
const ARMED_HB = hex('fd090000010101000000050000000203d104032221');

function fakeTimers() {
  const pending = new Set();
  return {
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: (fn) => { const t = { fn }; pending.add(t); return t; },
    clearTimeout: (t) => pending.delete(t),
    fireAll: () => { for (const t of [...pending]) { pending.delete(t); t.fn(); } },
  };
}

function makeLink({ armed = false } = {}) {
  const written = [];
  const timers = fakeTimers();
  const link = new VehicleLink({ now: () => 1000, timers });
  link.reader = { read: () => new Promise(() => {}), cancel: async () => {}, releaseLock() {} };
  link.writer = { write: async (b) => { written.push(b); }, releaseLock() {} };
  link.connected = true;
  link.connectedAt = 1000;
  link.receive(armed ? ARMED_HB : DISARMED_HB);
  link.params.state = 'complete';
  link.params.params.set('ATC_RAT_RLL_P', { name: 'ATC_RAT_RLL_P', value: 0.13500000536441803, type: 9, typeName: 'REAL32', index: 17 });
  const names = () => { const p = new MavlinkParser(); return written.flatMap((f) => p.push(f).map((m) => m.name)); };
  return { link, written, names, timers };
}

function approvedRequest(overrides = {}) {
  return {
    param_name: 'ATC_RAT_RLL_P', old_value: 0.13500000536441803, new_value: 0.15, vehicle_sysid: 1, safety_ack: true,
    status: 'APPROVED', approval_expires_at: new Date(Date.now() + 5 * 60000).toISOString(), ...overrides,
  };
}

const ok = { safetyAckNow: true, confirmed: true, allowlist };

test('PARAM_SET cannot be encoded without the write capability', () => {
  assert.throws(() => encodeMessage('PARAM_SET', fixtures.param_set.fields), OutgoingNotAllowedError);
  const frame = encodeMessage('PARAM_SET', fixtures.param_set.fields, { seq: fixtures.param_set.seq }, PARAM_WRITE_CAPABILITY);
  assert.equal(toHex(frame), fixtures.param_set.hex, 'byte-identical to pymavlink');
});

test('JavaScript allowlist rules match the server rules', () => {
  assert.deepEqual(validateChange(allowlist, 'ATC_RAT_RLL_P', 0.135, 0.15), []);
  assert.ok(validateChange(allowlist, 'ATC_RAT_RLL_P', 0.135, 0.5).length);
  assert.ok(validateChange(allowlist, 'ATC_RAT_RLL_P', 0.135, 0.25).length);
  assert.ok(validateChange(allowlist, 'ARMING_CHECK', 1, 0).length);
});

for (const [label, setup] of [
  ['armed vehicle', () => ({ ...makeLink({ armed: true }), request: approvedRequest(), opts: ok })],
  ['request not approved', () => ({ ...makeLink(), request: approvedRequest({ status: 'PENDING' }), opts: ok })],
  ['approval expired', () => ({ ...makeLink(), request: approvedRequest({ approval_expires_at: new Date(Date.now() - 1000).toISOString() }), opts: ok })],
  ['different vehicle', () => ({ ...makeLink(), request: approvedRequest({ vehicle_sysid: 2 }), opts: ok })],
  ['value changed since request', () => ({ ...makeLink(), request: approvedRequest({ old_value: 0.12 }), opts: ok })],
  ['out of range', () => ({ ...makeLink(), request: approvedRequest({ new_value: 0.9 }), opts: ok })],
  ['no safety acknowledgement now', () => ({ ...makeLink(), request: approvedRequest(), opts: { ...ok, safetyAckNow: false } })],
  ['not confirmed', () => ({ ...makeLink(), request: approvedRequest(), opts: { ...ok, confirmed: false } })],
]) {
  test(`blocks the write and sends nothing when: ${label}`, async () => {
    const { link, names, request, opts } = setup();
    const before = names().length;
    await assert.rejects(writeApprovedParam({ link, request, ...opts }), WriteBlockedError);
    assert.equal(names().length, before);
    assert.ok(!names().includes('PARAM_SET'));
  });
}

test('writes once and confirms with the readback value', async () => {
  const { link, names } = makeLink();
  assert.ok(evaluateWriteChecks({ link, request: approvedRequest(), ...ok }).every((c) => c.ok));
  const pending = writeApprovedParam({ link, request: approvedRequest(), ...ok });
  await new Promise((r) => setImmediate(r));
  for (const l of link.paramListeners) l({ param_id: 'ATC_RAT_RLL_P', param_value: 0.15000000596046448, param_type: 9 });
  const result = await pending;
  assert.equal(result.success, true);
  assert.equal(names().filter((n) => n === 'PARAM_SET').length, 1);
});

test('no reply: re-reads by name once and never re-sends PARAM_SET', async () => {
  const { link, names, timers } = makeLink();
  const pending = writeApprovedParam({ link, request: approvedRequest(), ...ok, timers });
  await new Promise((r) => setImmediate(r));
  timers.fireAll();
  await new Promise((r) => setImmediate(r));
  timers.fireAll();
  const result = await pending;
  assert.equal(result.success, false);
  assert.equal(names().filter((n) => n === 'PARAM_SET').length, 1);
  assert.equal(names().filter((n) => n === 'PARAM_REQUEST_READ').length, 1);
});

test('mismatched readback is reported as failure', async () => {
  const { link } = makeLink();
  const pending = writeApprovedParam({ link, request: approvedRequest(), ...ok });
  await new Promise((r) => setImmediate(r));
  for (const l of link.paramListeners) l({ param_id: 'ATC_RAT_RLL_P', param_value: 0.135, param_type: 9 });
  assert.equal((await pending).success, false);
});

test('revert requests skip only the step limit, never the range or allowlist', () => {
  assert.ok(validateChange(allowlist, 'ATC_RAT_RLL_P', 0.1, 0.135).length, 'normal request: +35% is rejected');
  assert.deepEqual(validateChange(allowlist, 'ATC_RAT_RLL_P', 0.1, 0.135, true), []);
  assert.ok(validateChange(allowlist, 'ATC_RAT_RLL_P', 0.1, 0.9, true).length, 'range still applies');
  assert.ok(validateChange(allowlist, 'ARMING_CHECK', 0, 1, true).length, 'allowlist still applies');
  const { link } = makeLink();
  link.params.params.get('ATC_RAT_RLL_P').value = 0.10000000149011612;
  const request = approvedRequest({ old_value: 0.10000000149011612, new_value: 0.135, revert_of: 5 });
  assert.ok(evaluateWriteChecks({ link, request, ...ok }).every((c) => c.ok));
});
