// FDE-GCS MAVLink 編解碼器（FDE-AI 自行撰寫）。訊息定義來自 defs.js（MAVLink 產生器輸出，MIT）。
// 送出訊息受白名單限制，不在白名單內的訊息一律無法編碼；PARAM_SET 需要寫入能力物件。
import { MESSAGE_DEFS } from './defs.js';

const STX_V1 = 0xfe;
const STX_V2 = 0xfd;
const SIGNED_FLAG = 0x01;
const SIGNATURE_LENGTH = 13;

const BY_NAME = Object.fromEntries(
  Object.entries(MESSAGE_DEFS).map(([id, def]) => [def.name, { ...def, id: Number(id) }])
);

// P2 唯讀白名單：只允許心跳、參數讀取、以及「請求某則訊息／設定回傳頻率」兩個不寫入飛控的指令。
// 不包含 PARAM_SET、模式切換、ARM、校準、馬達測試、重啟等任何會改變飛控狀態的訊息。
export const MAV_CMD_SET_MESSAGE_INTERVAL = 511;
export const MAV_CMD_REQUEST_MESSAGE = 512;
const OUTGOING_ALLOWED = new Set(['HEARTBEAT', 'PARAM_REQUEST_LIST', 'PARAM_REQUEST_READ', 'COMMAND_LONG']);
const COMMAND_LONG_ALLOWED = new Set([MAV_CMD_SET_MESSAGE_INTERVAL, MAV_CMD_REQUEST_MESSAGE]);

export class OutgoingNotAllowedError extends Error {}

// PARAM_SET 只能由寫入模組（writer.js）編碼：它必須先通過全部安全檢查，再帶著這個能力物件呼叫。
export const PARAM_WRITE_CAPABILITY = Symbol('fde-gcs-param-write');

export function crcAccumulate(byte, crc) {
  let tmp = (byte ^ (crc & 0xff)) & 0xff;
  tmp = (tmp ^ (tmp << 4)) & 0xff;
  return ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xffff;
}

export function crc16(bytes, start, end, crcExtra) {
  let crc = 0xffff;
  for (let i = start; i < end; i += 1) {
    crc = crcAccumulate(bytes[i], crc);
  }
  return crcAccumulate(crcExtra, crc);
}

const READERS = {
  char: (v, o) => v.getUint8(o),
  uint8_t: (v, o) => v.getUint8(o),
  int8_t: (v, o) => v.getInt8(o),
  uint16_t: (v, o) => v.getUint16(o, true),
  int16_t: (v, o) => v.getInt16(o, true),
  uint32_t: (v, o) => v.getUint32(o, true),
  int32_t: (v, o) => v.getInt32(o, true),
  float: (v, o) => v.getFloat32(o, true),
  double: (v, o) => v.getFloat64(o, true),
  uint64_t: (v, o) => v.getBigUint64(o, true),
  int64_t: (v, o) => v.getBigInt64(o, true),
};

const WRITERS = {
  char: (v, o, x) => v.setUint8(o, x),
  uint8_t: (v, o, x) => v.setUint8(o, x),
  int8_t: (v, o, x) => v.setInt8(o, x),
  uint16_t: (v, o, x) => v.setUint16(o, x, true),
  int16_t: (v, o, x) => v.setInt16(o, x, true),
  uint32_t: (v, o, x) => v.setUint32(o, x, true),
  int32_t: (v, o, x) => v.setInt32(o, x, true),
  float: (v, o, x) => v.setFloat32(o, x, true),
  double: (v, o, x) => v.setFloat64(o, x, true),
  uint64_t: (v, o, x) => v.setBigUint64(o, BigInt(x), true),
  int64_t: (v, o, x) => v.setBigInt64(o, BigInt(x), true),
};

const SIZES = { char: 1, uint8_t: 1, int8_t: 1, uint16_t: 2, int16_t: 2, uint32_t: 4, int32_t: 4, float: 4, double: 8, uint64_t: 8, int64_t: 8 };

export function decodePayload(def, payload) {
  // MAVLink v2 會截掉結尾的 0，解碼前補回完整長度。
  const full = new Uint8Array(def.length);
  full.set(payload.subarray(0, Math.min(payload.length, def.length)));
  const view = new DataView(full.buffer);
  const fields = {};
  for (const [name, type, arrayLength, offset] of def.fields) {
    if (type === 'char' && arrayLength > 0) {
      const bytes = full.subarray(offset, offset + arrayLength);
      const end = bytes.indexOf(0);
      fields[name] = new TextDecoder('utf-8').decode(end === -1 ? bytes : bytes.subarray(0, end));
    } else if (arrayLength > 0) {
      fields[name] = Array.from({ length: arrayLength }, (_, i) => READERS[type](view, offset + i * SIZES[type]));
    } else {
      fields[name] = READERS[type](view, offset);
    }
  }
  return fields;
}

export class MavlinkParser {
  constructor() {
    this.buffer = new Uint8Array(0);
    this.stats = { frames: 0, crcErrors: 0, unknown: 0, droppedBytes: 0 };
  }

  push(chunk) {
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;
    const messages = [];
    let i = 0;
    while (i < this.buffer.length) {
      const stx = this.buffer[i];
      if (stx !== STX_V1 && stx !== STX_V2) {
        i += 1;
        this.stats.droppedBytes += 1;
        continue;
      }
      const v2 = stx === STX_V2;
      const headerLength = v2 ? 10 : 6;
      if (this.buffer.length - i < headerLength) break;
      const payloadLength = this.buffer[i + 1];
      const signed = v2 && (this.buffer[i + 2] & SIGNED_FLAG) !== 0;
      const frameLength = headerLength + payloadLength + 2 + (signed ? SIGNATURE_LENGTH : 0);
      if (this.buffer.length - i < frameLength) break;
      const msgId = v2
        ? this.buffer[i + 7] | (this.buffer[i + 8] << 8) | (this.buffer[i + 9] << 16)
        : this.buffer[i + 5];
      const def = MESSAGE_DEFS[msgId];
      if (!def) {
        this.stats.unknown += 1;
        i += frameLength;
        continue;
      }
      const crcEnd = i + headerLength + payloadLength;
      const expected = crc16(this.buffer, i + 1, crcEnd, def.crcExtra);
      const received = this.buffer[crcEnd] | (this.buffer[crcEnd + 1] << 8);
      if (expected !== received) {
        // 可能是誤判的起始位元組：只跳過一個位元組，重新同步。
        this.stats.crcErrors += 1;
        i += 1;
        continue;
      }
      const payload = this.buffer.slice(i + headerLength, crcEnd);
      messages.push({
        msgId,
        name: def.name,
        seq: this.buffer[i + (v2 ? 4 : 2)],
        sysid: this.buffer[i + (v2 ? 5 : 3)],
        compid: this.buffer[i + (v2 ? 6 : 4)],
        version: v2 ? 2 : 1,
        signed,
        fields: decodePayload(def, payload),
      });
      this.stats.frames += 1;
      i += frameLength;
    }
    this.buffer = this.buffer.slice(i);
    return messages;
  }
}

export function assertOutgoingAllowed(name, fields, capability) {
  if (name === 'PARAM_SET' && capability === PARAM_WRITE_CAPABILITY) return;
  if (!OUTGOING_ALLOWED.has(name)) {
    throw new OutgoingNotAllowedError(`FDE-GCS P2 不允許送出 ${name}`);
  }
  if (name === 'COMMAND_LONG' && !COMMAND_LONG_ALLOWED.has(fields.command)) {
    throw new OutgoingNotAllowedError(`FDE-GCS P2 不允許送出指令 ${fields.command}`);
  }
}

export function encodeMessage(name, fields, { seq = 0, sysid = 255, compid = 190 } = {}, capability = undefined) {
  assertOutgoingAllowed(name, fields, capability);
  const def = BY_NAME[name];
  const payload = new Uint8Array(def.length);
  const view = new DataView(payload.buffer);
  for (const [field, type, arrayLength, offset] of def.fields) {
    const value = fields[field] ?? (type === 'char' && arrayLength > 0 ? '' : 0);
    if (type === 'char' && arrayLength > 0) {
      payload.set(new TextEncoder().encode(value).subarray(0, arrayLength), offset);
    } else if (arrayLength > 0) {
      value.forEach((item, index) => WRITERS[type](view, offset + index * SIZES[type], item));
    } else {
      WRITERS[type](view, offset, value);
    }
  }
  // MAVLink v2：去掉結尾的 0（至少保留 1 個位元組）。
  let length = payload.length;
  while (length > 1 && payload[length - 1] === 0) length -= 1;
  const frame = new Uint8Array(10 + length + 2);
  frame.set([STX_V2, length, 0, 0, seq & 0xff, sysid, compid, def.id & 0xff, (def.id >> 8) & 0xff, (def.id >> 16) & 0xff]);
  frame.set(payload.subarray(0, length), 10);
  const crc = crc16(frame, 1, 10 + length, def.crcExtra);
  frame[10 + length] = crc & 0xff;
  frame[11 + length] = crc >> 8;
  return frame;
}
