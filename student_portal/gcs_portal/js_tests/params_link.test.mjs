import assert from 'node:assert/strict';
import test from 'node:test';

import { MavlinkParser } from '../static/gcs_portal/mavlink/codec.js';
import { HEARTBEAT_LOST_MS, VehicleLink, describeOpenError } from '../static/gcs_portal/mavlink/link.js';
import { ParamDownloader, normalizeParamValue } from '../static/gcs_portal/mavlink/params.js';
import { TelemetryModel, formatFirmwareVersion } from '../static/gcs_portal/mavlink/telemetry.js';

const TARGET = { sysid: 1, compid: 1 };

function paramFields(index, total, name = `P_${index}`, value = index * 1.5, type = 9) {
  return { param_id: name, param_value: value, param_type: type, param_count: total, param_index: index };
}

test('downloads all parameters and ignores duplicates', () => {
  const sent = [];
  const dl = new ParamDownloader((name, fields) => sent.push([name, fields]));
  dl.start(TARGET, 0);
  assert.deepEqual(sent[0][0], 'PARAM_REQUEST_LIST');
  for (const i of [0, 1, 2, 2, 3, 4]) dl.onParamValue(paramFields(i, 5), 10 + i);
  assert.equal(dl.state, 'complete');
  assert.equal(dl.summary().duplicates, 1);
  assert.equal(dl.params.size, 5);
});

test('re-requests missing indexes after a quiet period, then completes', () => {
  const sent = [];
  const dl = new ParamDownloader((name, fields) => sent.push([name, fields]), { quietMs: 100, batchSize: 2 });
  dl.start(TARGET, 0);
  for (const i of [0, 1, 3, 5]) dl.onParamValue(paramFields(i, 6), 10);
  dl.tick(50);
  assert.equal(sent.length, 1, 'no re-request before the quiet period');
  dl.tick(200);
  const reads = sent.filter(([name]) => name === 'PARAM_REQUEST_READ').map(([, f]) => f.param_index);
  assert.deepEqual(reads, [2, 4]);
  dl.onParamValue(paramFields(2, 6), 210);
  dl.onParamValue(paramFields(4, 6), 220);
  assert.equal(dl.state, 'complete');
});

test('reports parameters that never arrive after the retry limit', () => {
  const dl = new ParamDownloader(() => {}, { quietMs: 100, readRetries: 3 });
  dl.start(TARGET, 0);
  dl.onParamValue(paramFields(0, 3), 10);
  dl.onParamValue(paramFields(2, 3), 10);
  for (let t = 200; t < 2000; t += 150) dl.tick(t);
  assert.equal(dl.state, 'incomplete');
  assert.deepEqual(dl.summary().missing, [1]);
  assert.equal(dl.readAttempts.get(1), 3);
});

test('fails clearly when the vehicle never answers the list request', () => {
  const sent = [];
  const dl = new ParamDownloader((name) => sent.push(name), { quietMs: 100, listTimeoutMs: 1000, listRetries: 2 });
  dl.start(TARGET, 0);
  for (let t = 0; t <= 5000; t += 500) dl.tick(t);
  assert.equal(dl.state, 'failed');
  assert.equal(sent.filter((n) => n === 'PARAM_REQUEST_LIST').length, 3);
});

test('integer parameter types are rounded, float types keep precision', () => {
  assert.equal(normalizeParamValue(2.0000001, 6), 2);
  assert.equal(normalizeParamValue(0.135, 9), 0.135);
});

test('telemetry ignores other ground stations and maps ArduCopter state', () => {
  const model = new TelemetryModel();
  const gcs = { name: 'HEARTBEAT', sysid: 255, compid: 190, fields: { type: 6, autopilot: 8, base_mode: 0, custom_mode: 0 } };
  assert.equal(model.update(gcs, 0), false);
  const vehicle = { name: 'HEARTBEAT', sysid: 1, compid: 1, fields: { type: 2, autopilot: 3, base_mode: 209, custom_mode: 5 } };
  assert.equal(model.update(vehicle, 0), true);
  assert.equal(model.values.mode.text, 'LOITER');
  assert.match(model.values.armed.text, /ARMED/);
  assert.equal(model.isStale('mode', 1000), false);
  assert.equal(model.isStale('mode', 2500), true);
  assert.equal(formatFirmwareVersion(0x040500ff), '4.5.0 official');
  model.update({ name: 'AUTOPILOT_VERSION', sysid: 1, compid: 1, fields: { flight_sw_version: 0x040500ff } }, 0);
  assert.equal(model.isStale('firmware', 60000), false, 'firmware is static information');
});

class FakeStream {
  constructor() {
    this.queue = [];
    this.waiters = [];
    this.written = [];
  }
  getReader() {
    return {
      read: () => (this.queue.length ? Promise.resolve(this.queue.shift()) : new Promise((r) => this.waiters.push(r))),
      cancel: async () => { this.push({ done: true }); },
      releaseLock: () => {},
    };
  }
  getWriter() {
    return { write: async (b) => { this.written.push(b); }, releaseLock: () => {} };
  }
  push(item) {
    const waiter = this.waiters.shift();
    if (waiter) waiter(item); else this.queue.push(item);
  }
}

function fakeTimers() {
  return { setInterval: () => 1, clearInterval: () => {} };
}

test('link state goes waiting → ok → stale → lost and only sends whitelisted messages', async () => {
  let now = 0;
  const stream = new FakeStream();
  const link = new VehicleLink({ now: () => now, timers: fakeTimers() });
  link.attach(stream, stream);
  assert.equal(link.linkState(), 'waiting');
  // pymavlink 產生的 ArduCopter 心跳（sysid 1）
  const hb = Uint8Array.from('fd090000000101000000050000000203510303590e'.match(/../g).map((b) => parseInt(b, 16)));
  stream.push({ value: hb, done: false });
  await new Promise((r) => setImmediate(r));
  assert.equal(link.linkState(), 'ok');
  assert.ok(link.sent.includes('COMMAND_LONG'), 'requests telemetry after first heartbeat');
  now = 4000;
  assert.equal(link.linkState(), 'stale');
  now = HEARTBEAT_LOST_MS + 1;
  assert.equal(link.linkState(), 'lost');
  const parser = new MavlinkParser();
  const names = stream.written.flatMap((frame) => parser.push(frame).map((m) => m.name));
  for (const name of names) assert.ok(['HEARTBEAT', 'COMMAND_LONG', 'PARAM_REQUEST_LIST', 'PARAM_REQUEST_READ'].includes(name), name);
  await link.disconnect();
  assert.equal(link.linkState(), 'disconnected');
});

test('busy COM port gives a plain-language message', () => {
  const error = new Error('Failed to open serial port.');
  error.name = 'NetworkError';
  assert.match(describeOpenError(error), /Mission Planner/);
});
