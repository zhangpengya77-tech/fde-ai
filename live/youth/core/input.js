// 操控輸入管理：USB 遙控器（Gamepad API）→ 鍵盤 → 螢幕虛擬搖桿，三者擇優合併
// 只做「瀏覽器模擬器操控」。不經 WebUSB／Web Serial 與任何真機通訊，絕不用於實體無人機飛控。
import { deadzone, clamp } from './physics.js';

const CFG_KEY = 'fde-youth-rc-v1';
const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

// 預設通道對應（美國手 Mode 2）：左搖桿 = 油門(上下)＋偏航(左右)；右搖桿 = 俯仰(上下)＋橫滾(左右)
export const DEFAULT_MAP = {
  throttle: { axis: 1, invert: true },
  yaw: { axis: 0, invert: false },
  pitch: { axis: 3, invert: true },
  roll: { axis: 2, invert: false },
  deadzone: 0.08,
  estopButton: 0,    // 虛擬緊急停止
  armButton: 1
};

export function loadMap() {
  try { return { ...DEFAULT_MAP, ...(JSON.parse(localStorage.getItem(CFG_KEY) || '{}')) }; } catch { return { ...DEFAULT_MAP }; }
}
export function saveMap(m) { try { localStorage.setItem(CFG_KEY, JSON.stringify(m)); } catch { /* 略 */ } }

/** 單軸讀值＋校準（中心偏移、行程）＋反向＋死區 */
export function readAxis(raw, ch, cal, dz) {
  if (!ch || raw == null) return 0;
  let v = raw;
  const c = cal?.[ch.axis];
  if (c) {
    v = v - c.center;
    const span = v >= 0 ? (c.max - c.center) : (c.center - c.min);
    v = span > 0.05 ? v / span : v;
  }
  if (ch.invert) v = -v;
  return deadzone(clamp(v, -1, 1), dz);
}

export class InputHub {
  constructor() {
    this.map = loadMap();
    this.keys = new Set();
    this.virtual = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
    this.virtualActive = false;
    this.pad = null;          // 目前使用的 Gamepad 物件索引
    this.padName = '';
    this.connected = false;
    this.lostAt = 0;          // 斷線時間（顯示提醒用）
    this.estop = false;
    this.listeners = new Set();
    this._onKey = e => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      const k = e.key.toLowerCase();
      if (e.type === 'keydown') { this.keys.add(k); if (k === ' ') { this.estop = true; e.preventDefault(); } }
      else this.keys.delete(k);
    };
    this._onConn = e => { this.pad = e.gamepad.index; this.padName = e.gamepad.id; this.connected = true; this.lostAt = 0; this.emit(); };
    this._onDisc = e => { if (e.gamepad.index === this.pad) { this.connected = false; this.lostAt = Date.now(); this.emit(); } };
  }
  attach(win = window) {
    win.addEventListener('keydown', this._onKey); win.addEventListener('keyup', this._onKey);
    win.addEventListener('gamepadconnected', this._onConn); win.addEventListener('gamepaddisconnected', this._onDisc);
  }
  detach(win = window) {
    win.removeEventListener('keydown', this._onKey); win.removeEventListener('keyup', this._onKey);
    win.removeEventListener('gamepadconnected', this._onConn); win.removeEventListener('gamepaddisconnected', this._onDisc);
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.listeners.forEach(f => f(this.status())); }
  status() {
    return { connected: this.connected, name: this.padName, lostAt: this.lostAt, estop: this.estop,
      source: this.connected ? 'USB 遙控器' : (this.virtualActive ? '虛擬搖桿' : '鍵盤') };
  }
  rawPad() {
    if (this.pad == null || typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    return navigator.getGamepads()[this.pad] || null;
  }
  /** 每幀讀取，回傳 {throttle,yaw,pitch,roll}（-1..1）與按鈕事件 */
  read() {
    const out = { throttle: 0, yaw: 0, pitch: 0, roll: 0, source: '鍵盤', arm: false };
    const gp = this.rawPad();
    if (gp && gp.connected) {
      const m = this.map;
      for (const ch of ['throttle', 'yaw', 'pitch', 'roll']) out[ch] = readAxis(gp.axes[m[ch].axis], m[ch], m.cal, m.deadzone);
      if (gp.buttons[m.estopButton]?.pressed) this.estop = true;
      out.arm = !!gp.buttons[m.armButton]?.pressed;
      out.source = 'USB 遙控器';
    } else if (this.virtualActive && ![...this.keys].some(k => MOVE_KEYS.has(k))) {
      // 用過虛擬搖桿後以搖桿為主；一按鍵盤方向鍵就改回鍵盤
      Object.assign(out, this.virtual); out.source = '虛擬搖桿';
    } else {
      const k = this.keys;
      // 鍵盤：W/S 油門、A/D 偏航、方向鍵 ↑↓ 俯仰、←→ 橫滾
      out.throttle = (k.has('w') ? 1 : 0) - (k.has('s') ? 1 : 0);
      out.yaw = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0);
      out.pitch = (k.has('arrowup') ? 1 : 0) - (k.has('arrowdown') ? 1 : 0);
      out.roll = (k.has('arrowright') ? 1 : 0) - (k.has('arrowleft') ? 1 : 0);
    }
    if (this.estop) { out.throttle = -1; out.yaw = out.pitch = out.roll = 0; }
    return out;
  }
  /** 校準：記錄一段時間內各軸的最小、最大值，以及目前的中心值 */
  calibrateCapture(cal = {}) {
    const gp = this.rawPad(); if (!gp) return cal;
    gp.axes.forEach((v, i) => {
      const c = (cal[i] ??= { min: v, max: v, center: v });
      c.min = Math.min(c.min, v); c.max = Math.max(c.max, v);
    });
    return cal;
  }
  calibrateCenter(cal) {
    const gp = this.rawPad(); if (!gp) return cal;
    gp.axes.forEach((v, i) => { if (cal[i]) cal[i].center = v; });
    return cal;
  }
}

/** 建立螢幕虛擬搖桿（觸控與滑鼠皆可）；onMove(x,y) 範圍 -1..1，y 往上為正 */
export function createStick(el, onMove) {
  const knob = document.createElement('i'); el.appendChild(knob);
  let id = null;
  const set = (x, y) => { knob.style.transform = `translate(${x * 40}px, ${-y * 40}px)`; onMove(x, y); };
  const pos = e => {
    const r = el.getBoundingClientRect();
    let x = (e.clientX - r.left - r.width / 2) / (r.width / 2);
    let y = -(e.clientY - r.top - r.height / 2) / (r.height / 2);
    const len = Math.hypot(x, y); if (len > 1) { x /= len; y /= len; }
    set(x, y);
  };
  el.addEventListener('pointerdown', e => { id = e.pointerId; try { el.setPointerCapture(id); } catch { /* 部分瀏覽器不支援，忽略 */ } pos(e); });
  el.addEventListener('pointermove', e => { if (e.pointerId === id) pos(e); });
  const end = e => { if (e.pointerId === id) { id = null; set(0, 0); } };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  knob.style.transform = 'translate(0,0)';   // 初始只擺正搖桿頭，不觸發 onMove（避免一進頁面就把鍵盤操作切成虛擬搖桿）
}
