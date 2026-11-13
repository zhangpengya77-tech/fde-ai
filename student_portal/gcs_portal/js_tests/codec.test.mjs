// 執行：node --test student_portal/gcs_portal/js_tests/
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  MavlinkParser,
  OutgoingNotAllowedError,
  encodeMessage,
} from '../static/gcs_portal/mavlink/codec.js';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/mavlink_fixtures.json', import.meta.url)));
const fromHex = (hex) => Uint8Array.from(hex.match(/../g).map((b) => parseInt(b, 16)));
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

function assertFieldsEqual(actual, expected, label) {
  for (const [name, value] of Object.entries(expected)) {
    const got = actual[name];
    if (typeof value === 'number' && !Number.isInteger(value)) {
      assert.ok(Math.abs(got - value) < 1e-5, `${label}.${name}: ${got} != ${value}`);
    } else if (typeof value === 'string' && typeof got === 'bigint') {
      assert.equal(got.toString(), value, `${label}.${name}`);
    } else if (Array.isArray(value)) {
      assert.deepEqual(got.map((v) => (typeof v === 'bigint' ? Number(v) : v)), value, `${label}.${name}`);
    } else {
      assert.equal(typeof got === 'bigint' ? Number(got) : got, value, `${label}.${name}`);
    }
  }
}

test('decodes every pymavlink reference frame (MAVLink v1 and v2)', () => {
  for (const sample of fixtures.incoming) {
    const parser = new MavlinkParser();
    const [message, ...rest] = parser.push(fromHex(sample.hex));
    assert.equal(rest.length, 0);
    assert.ok(message, `no message for ${sample.name} v${sample.version}`);
    assert.equal(message.name, sample.name);
    assert.equal(message.version, sample.version);
    assertFieldsEqual(message.fields, sample.fields, `${sample.name} v${sample.version}`);
  }
});

test('reassembles frames split across chunks and skips garbage', () => {
  const stream = [0x00, 0x13, 0x37, ...fixtures.incoming.flatMap((s) => [...fromHex(s.hex)])];
  const parser = new MavlinkParser();
  const messages = [];
  for (let i = 0; i < stream.length; i += 7) {
    messages.push(...parser.push(Uint8Array.from(stream.slice(i, i + 7))));
  }
  assert.equal(messages.length, fixtures.incoming.length);
  assert.equal(parser.stats.droppedBytes, 3);
  assert.equal(parser.stats.crcErrors, 0);
});

test('rejects a frame with a corrupted CRC and resynchronises', () => {
  const good = fromHex(fixtures.incoming[0].hex);
  const bad = good.slice();
  bad[bad.length - 1] ^= 0xff;
  const parser = new MavlinkParser();
  const messages = parser.push(Uint8Array.from([...bad, ...good]));
  assert.equal(messages.length, 1);
  assert.ok(parser.stats.crcErrors >= 1);
});

test('encodes outgoing messages byte-for-byte like pymavlink', () => {
  for (const sample of fixtures.outgoing) {
    const frame = encodeMessage(sample.name, sample.fields, { seq: sample.seq, sysid: 255, compid: 190 });
    assert.equal(toHex(frame), sample.hex, sample.name);
  }
});

test('refuses to encode any write or control message', () => {
  for (const name of ['PARAM_SET', 'SET_MODE', 'MISSION_ITEM_INT', 'RC_CHANNELS_OVERRIDE', 'COMMAND_INT']) {
    assert.throws(() => encodeMessage(name, {}), OutgoingNotAllowedError, name);
  }
  // 400 = ARM/DISARM、176 = DO_SET_MODE、209 = MOTOR_TEST、241 = 校準、246 = 重啟、22 = 起飛、20 = RTL、21 = LAND
  for (const command of [400, 176, 209, 241, 246, 22, 20, 21]) {
    assert.throws(() => encodeMessage('COMMAND_LONG', { command }), OutgoingNotAllowedError, `command ${command}`);
  }
});
