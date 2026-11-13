// 把收到的 MAVLink 訊息整理成儀表板數值。每個數值都記錄來源訊息與收到時間，過期的數值由介面變灰。

export const STALE_MS = 2000;
// 只在連線時讀一次的靜態資訊，不會因時間過期。
const STATIC_KEYS = new Set(['firmware']);

const MAV_TYPE = { 1: '固定翼', 2: '四旋翼', 3: '共軸直升機', 4: '直升機', 10: '地面車', 13: '六旋翼', 14: '八旋翼', 15: '三旋翼' };
const MAV_AUTOPILOT = { 3: 'ArduPilot', 12: 'PX4' };
const COPTER_MODES = {
  0: 'STABILIZE', 1: 'ACRO', 2: 'ALT_HOLD', 3: 'AUTO', 4: 'GUIDED', 5: 'LOITER', 6: 'RTL', 7: 'CIRCLE', 9: 'LAND',
  11: 'DRIFT', 13: 'SPORT', 14: 'FLIP', 15: 'AUTOTUNE', 16: 'POSHOLD', 17: 'BRAKE', 18: 'THROW', 19: 'AVOID_ADSB',
  20: 'GUIDED_NOGPS', 21: 'SMART_RTL', 22: 'FLOWHOLD', 23: 'FOLLOW', 24: 'ZIGZAG', 25: 'SYSTEMID', 26: 'AUTOROTATE', 27: 'AUTO_RTL',
};
const GPS_FIX = { 0: '無 GPS', 1: '未定位', 2: '2D 定位', 3: '3D 定位', 4: 'DGPS', 5: 'RTK Float', 6: 'RTK Fixed', 7: '固定基站', 8: 'PPP' };
const MULTICOPTER_TYPES = new Set([2, 3, 4, 13, 14, 15]);
const MAV_MODE_FLAG_SAFETY_ARMED = 128;
const MAV_TYPE_GCS = 6;
const FIRMWARE_TYPE = { 0: 'dev', 64: 'alpha', 128: 'beta', 192: 'rc', 255: 'official' };

const deg = (rad) => (rad * 180) / Math.PI;
const fixed = (value, digits) => (Number.isFinite(value) ? value.toFixed(digits) : '—');

export function formatFirmwareVersion(version) {
  const major = (version >>> 24) & 0xff;
  const minor = (version >>> 16) & 0xff;
  const patch = (version >>> 8) & 0xff;
  const type = FIRMWARE_TYPE[version & 0xff] || `type${version & 0xff}`;
  return `${major}.${minor}.${patch} ${type}`;
}

export class TelemetryModel {
  constructor() {
    this.values = {};
    this.vehicle = null;
  }

  set(key, text, source, now) {
    this.values[key] = { text, source, at: now };
  }

  // 只接受第一台送出飛控心跳的載具；地面站（MAV_TYPE_GCS）的心跳忽略。
  accepts(message) {
    if (this.vehicle) {
      return message.sysid === this.vehicle.sysid && message.compid === this.vehicle.compid;
    }
    return message.name === 'HEARTBEAT' && message.fields.type !== MAV_TYPE_GCS && message.fields.autopilot !== 8;
  }

  update(message, now) {
    if (!this.accepts(message)) return false;
    const f = message.fields;
    switch (message.name) {
      case 'HEARTBEAT': {
        this.vehicle = this.vehicle || { sysid: message.sysid, compid: message.compid };
        this.vehicle.lastHeartbeat = now;
        this.vehicle.type = f.type;
        this.vehicle.autopilot = f.autopilot;
        const vehicleName = `${MAV_AUTOPILOT[f.autopilot] || `Autopilot ${f.autopilot}`} · ${MAV_TYPE[f.type] || `類型 ${f.type}`}`;
        this.set('vehicle', vehicleName, 'HEARTBEAT', now);
        const mode = MULTICOPTER_TYPES.has(f.type) && f.autopilot === 3 ? COPTER_MODES[f.custom_mode] : null;
        this.set('mode', mode || `custom_mode ${f.custom_mode}`, 'HEARTBEAT', now);
        this.set('armed', f.base_mode & MAV_MODE_FLAG_SAFETY_ARMED ? '已解鎖（ARMED）' : '已上鎖（DISARMED）', 'HEARTBEAT', now);
        this.armed = (f.base_mode & MAV_MODE_FLAG_SAFETY_ARMED) !== 0;
        break;
      }
      case 'SYS_STATUS': {
        const volts = f.voltage_battery === 0xffff ? '—' : `${fixed(f.voltage_battery / 1000, 2)} V`;
        const amps = f.current_battery === -1 ? '' : ` · ${fixed(f.current_battery / 100, 1)} A`;
        const pct = f.battery_remaining === -1 ? '' : ` · ${f.battery_remaining}%`;
        this.set('battery', `${volts}${amps}${pct}`, 'SYS_STATUS', now);
        break;
      }
      case 'GPS_RAW_INT':
        this.set('gps', `${GPS_FIX[f.fix_type] || f.fix_type} · ${f.satellites_visible === 255 ? '—' : f.satellites_visible} 顆`, 'GPS_RAW_INT', now);
        break;
      case 'GLOBAL_POSITION_INT':
        this.set('altitude', `${fixed(f.relative_alt / 1000, 1)} m（相對起飛點）`, 'GLOBAL_POSITION_INT', now);
        break;
      case 'ATTITUDE':
        this.set('attitude', `${fixed(deg(f.roll), 1)}° / ${fixed(deg(f.pitch), 1)}° / ${fixed(deg(f.yaw), 1)}°`, 'ATTITUDE', now);
        break;
      case 'AUTOPILOT_VERSION':
        this.set('firmware', formatFirmwareVersion(f.flight_sw_version), 'AUTOPILOT_VERSION', now);
        break;
      default:
        return false;
    }
    this.set('updated', new Date(now).toLocaleTimeString('zh-TW', { hour12: false }), '本機時鐘', now);
    return true;
  }

  isStale(key, now) {
    const value = this.values[key];
    if (value && STATIC_KEYS.has(key)) return false;
    return !value || now - value.at > STALE_MS;
  }
}
