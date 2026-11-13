// 真機連線（P2，唯讀）：瀏覽器 Web Serial ↔ USB ↔ 飛控。
// 規則：每次由使用者點擊後手動選 COM 埠；不呼叫 getPorts()、斷線時 forget() 授權；
// COM 埠被占用時只提示，不自動重試；不送出任何寫入或控制訊息（白名單在 codec.js）。
import {
  MavlinkParser,
  MAV_CMD_REQUEST_MESSAGE,
  MAV_CMD_SET_MESSAGE_INTERVAL,
  encodeMessage,
} from './codec.js';
import { ParamDownloader } from './params.js';
import { TelemetryModel } from './telemetry.js';

export const HEARTBEAT_STALE_MS = 3000;
export const HEARTBEAT_LOST_MS = 10000;
const GCS_SYSID = 255;
const GCS_COMPID = 190;
const MAV_TYPE_GCS = 6;
const MAV_AUTOPILOT_INVALID = 8;
const MAV_STATE_ACTIVE = 4;

// 用 SET_MESSAGE_INTERVAL 請求遙測（不會存進飛控參數，重開機後失效）。
const STREAMS = [
  [1, 1000000], // SYS_STATUS 1 Hz
  [24, 1000000], // GPS_RAW_INT 1 Hz
  [30, 200000], // ATTITUDE 5 Hz
  [33, 500000], // GLOBAL_POSITION_INT 2 Hz
];
const AUTOPILOT_VERSION_ID = 148;

export function describeOpenError(error) {
  const name = error && error.name;
  if (name === 'NotFoundError') return '沒有選擇任何 USB 裝置。';
  if (name === 'SecurityError') return '瀏覽器不允許使用 USB：請確認網址是 HTTPS 或本機，並用 Chrome／Edge。';
  if (name === 'InvalidStateError' || name === 'NetworkError') {
    return '這個 USB 連線正被其他程式使用。請先關閉 Mission Planner、QGC 等地面站，再按「連線」。';
  }
  return `無法開啟 USB 連線：${(error && error.message) || error}`;
}

export class VehicleLink {
  constructor({ now = () => Date.now(), onUpdate = () => {}, timers = globalThis } = {}) {
    this.now = now;
    this.onUpdate = onUpdate;
    this.timers = timers;
    this.parser = new MavlinkParser();
    this.telemetry = new TelemetryModel();
    this.params = new ParamDownloader((name, fields) => this.send(name, fields));
    this.seq = 0;
    this.sent = [];
    this.connected = false;
    this.connectedAt = null;
    this.message = '';
  }

  async connectSerial(serial, baudRate) {
    if (!serial) throw new Error('這個瀏覽器不支援 Web Serial，請改用 Windows 桌面版 Chrome 或 Edge。');
    const port = await serial.requestPort();
    try {
      await port.open({ baudRate });
    } catch (error) {
      if (port.forget) await port.forget().catch(() => {});
      throw new Error(describeOpenError(error));
    }
    this.port = port;
    this.serial = serial;
    this.onSerialDisconnect = (event) => {
      if (event.target === port) this.handleLost('USB 已拔除或飛控斷電。');
    };
    serial.addEventListener('disconnect', this.onSerialDisconnect);
    this.attach(port.readable, port.writable);
  }

  attach(readable, writable) {
    this.reader = readable.getReader();
    this.writer = writable.getWriter();
    this.connected = true;
    this.connectedAt = this.now();
    this.message = '已開啟連線，等待飛控心跳…';
    this.heartbeatTimer = this.timers.setInterval(() => this.onTick(), 1000);
    this.sendHeartbeat();
    this.readLoop();
    this.onUpdate(this);
  }

  async readLoop() {
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) this.receive(value);
      }
    } catch (error) {
      if (this.connected) this.handleLost(`讀取 USB 資料失敗：${error.message || error}`);
      return;
    }
    if (this.connected) this.handleLost('USB 連線已結束。');
  }

  receive(bytes) {
    const now = this.now();
    let changed = false;
    for (const message of this.parser.push(bytes)) {
      const hadVehicle = Boolean(this.telemetry.vehicle);
      if (!this.telemetry.accepts(message)) continue;
      if (message.name === 'PARAM_VALUE') {
        this.params.onParamValue(message.fields, now);
        changed = true;
        continue;
      }
      changed = this.telemetry.update(message, now) || changed;
      if (!hadVehicle && this.telemetry.vehicle) {
        this.message = '已收到飛控心跳。';
        this.requestTelemetry();
      }
    }
    if (changed) this.onUpdate(this);
  }

  send(name, fields) {
    const frame = encodeMessage(name, fields, { seq: this.seq, sysid: GCS_SYSID, compid: GCS_COMPID });
    this.seq = (this.seq + 1) & 0xff;
    this.sent.push(name);
    if (this.writer) this.writer.write(frame).catch(() => {});
    return frame;
  }

  sendHeartbeat() {
    this.send('HEARTBEAT', {
      type: MAV_TYPE_GCS,
      autopilot: MAV_AUTOPILOT_INVALID,
      base_mode: 0,
      custom_mode: 0,
      system_status: MAV_STATE_ACTIVE,
      mavlink_version: 3,
    });
  }

  requestTelemetry() {
    const { sysid, compid } = this.telemetry.vehicle;
    for (const [messageId, intervalUs] of STREAMS) {
      this.send('COMMAND_LONG', {
        target_system: sysid, target_component: compid, command: MAV_CMD_SET_MESSAGE_INTERVAL,
        confirmation: 0, param1: messageId, param2: intervalUs, param3: 0, param4: 0, param5: 0, param6: 0, param7: 0,
      });
    }
    this.send('COMMAND_LONG', {
      target_system: sysid, target_component: compid, command: MAV_CMD_REQUEST_MESSAGE,
      confirmation: 0, param1: AUTOPILOT_VERSION_ID, param2: 0, param3: 0, param4: 0, param5: 0, param6: 0, param7: 0,
    });
  }

  startParamDownload() {
    if (!this.telemetry.vehicle || this.linkState() !== 'ok') {
      throw new Error('還沒收到飛控心跳，無法讀取參數。');
    }
    this.params.start(this.telemetry.vehicle, this.now());
    this.onUpdate(this);
  }

  onTick() {
    const now = this.now();
    this.sendHeartbeat();
    this.params.tick(now);
    if (this.linkState() === 'lost' && this.params.state === 'downloading') {
      this.params.state = 'failed';
      this.params.error = '連線中斷，參數下載未完成。';
    }
    this.onUpdate(this);
  }

  linkState() {
    if (!this.connected) return 'disconnected';
    const now = this.now();
    const last = this.telemetry.vehicle ? this.telemetry.vehicle.lastHeartbeat : this.connectedAt;
    if (now - last > HEARTBEAT_LOST_MS) return 'lost';
    if (!this.telemetry.vehicle) return 'waiting';
    if (now - last > HEARTBEAT_STALE_MS) return 'stale';
    return 'ok';
  }

  handleLost(message) {
    this.message = message;
    this.disconnect();
  }

  async disconnect() {
    if (!this.connected) return;
    this.connected = false;
    this.timers.clearInterval(this.heartbeatTimer);
    if (this.params.state === 'downloading') {
      this.params.state = 'failed';
      this.params.error = '連線中斷，參數下載未完成。';
    }
    try { await this.reader.cancel(); } catch (error) { /* 已關閉 */ }
    try { this.reader.releaseLock(); } catch (error) { /* 已釋放 */ }
    try { this.writer.releaseLock(); } catch (error) { /* 已釋放 */ }
    if (this.serial && this.onSerialDisconnect) this.serial.removeEventListener('disconnect', this.onSerialDisconnect);
    if (this.port) {
      try { await this.port.close(); } catch (error) { /* 已關閉 */ }
      if (this.port.forget) await this.port.forget().catch(() => {});
    }
    this.port = null;
    this.onUpdate(this);
  }
}
