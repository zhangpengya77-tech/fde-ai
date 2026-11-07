/**
 * REA 考照模擬器：槳葉旋轉聲音（2026-11-08）。
 *
 * 全部用 Web Audio API 即時合成，不使用任何錄音檔（沒有版權問題、檔案也不會變大）：
 *  - 「嗡嗡聲」：鋸齒波＋方波，頻率＝槳葉通過頻率（轉速 × 槳葉數 ÷ 60），隨油門與傾角升降。
 *  - 「風切聲」：濾波後的白噪音，模擬槳葉切風的沙沙聲。
 *  - 機型越大，槳越大、轉越慢 → 音高越低、聲音越厚。
 * 瀏覽器規定要使用者點過畫面才能出聲，所以在按「開始飛／看示範」時才建立音訊。
 */

import type { AirframeId } from './courses';
import type { Command, DroneState } from './physics';

/** 各機型懸停時的槳葉通過頻率（Hz）與音量係數。 */
const PROFILES: Record<AirframeId, { hoverHz: number; level: number }> = {
  'quad-800g': { hoverHz: 190, level: 0.8 },
  'quad-4kg': { hoverHz: 125, level: 1 },
  'hexa-18kg': { hoverHz: 82, level: 1.15 },
};

export interface RotorTarget {
  /** 轉速比例：0 = 停止，1 = 懸停轉速，最高約 1.45。 */
  spin: number;
  /** 槳葉通過頻率（Hz）。 */
  freq: number;
  /** 0–1 的音量。 */
  gain: number;
}

/**
 * 依機型、打桿與飛行狀態算出槳葉聲音目標值（純函式，方便測試）。
 * 未解鎖或已落地且油門收到底 → 停止；地面怠速 → 低轉速；飛行中依油門與傾角加速。
 */
export function rotorTarget(airframeId: AirframeId, cmd: Command, s: Pick<DroneState, 'armed' | 'landed' | 'crashed' | 'pitchDeg' | 'rollDeg'>): RotorTarget {
  const p = PROFILES[airframeId] ?? PROFILES['quad-4kg'];
  let spin: number;
  if (!s.armed || s.crashed) spin = 0;
  else if (s.landed) spin = cmd.throttle > 0.55 ? 0.75 + (cmd.throttle - 0.55) : 0.45; // 地面怠速／正要起飛
  else {
    const climb = (cmd.throttle - 0.5) * 0.6; // 推油門升高、收油門下降
    const tilt = Math.min(1, Math.hypot(s.pitchDeg, s.rollDeg) / 30) * 0.18; // 傾斜時需要更多推力
    const yaw = Math.abs(cmd.yaw) * 0.06;
    spin = 1 + climb + tilt + yaw;
  }
  spin = Math.max(0, Math.min(1.45, spin));
  return { spin, freq: p.hoverHz * Math.max(0.35, spin), gain: spin === 0 ? 0 : Math.min(1, (0.25 + 0.55 * spin) * p.level) };
}

/** 槳葉聲音播放器。所有數值用平滑過渡，避免突然跳音。 */
export class RotorAudio {
  enabled = true;
  /** 主音量（0–1）。 */
  volume = 0.35;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private saw: OscillatorNode | null = null;
  private sq: OscillatorNode | null = null;
  private noiseGain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;

  /** 在使用者點擊（開始飛、看示範）時呼叫，建立或喚醒音訊。 */
  unlock(): void {
    if (!this.enabled) return;
    const AC = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!AC) return;
    if (!this.ctx) {
      try { this.build(new AC()); } catch { return; }
    }
    void this.ctx?.resume().catch(() => undefined);
  }

  private build(ctx: AudioContext): void {
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    // 低通讓聲音不刺耳，也讓大機型更「悶」
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1800;
    filter.Q.value = 0.7;
    filter.connect(master).connect(ctx.destination);

    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    const sawGain = ctx.createGain();
    sawGain.gain.value = 0.32;
    saw.connect(sawGain).connect(filter);

    // 第二組略微走音的方波：多顆馬達轉速不完全相同造成的「拍頻」
    const sq = ctx.createOscillator();
    sq.type = 'square';
    const sqGain = ctx.createGain();
    sqGain.gain.value = 0.12;
    sq.connect(sqGain).connect(filter);

    // 槳葉切風的噪音
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 900;
    band.Q.value = 0.6;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;
    noise.connect(band).connect(noiseGain).connect(master);

    saw.start();
    sq.start();
    noise.start();
    Object.assign(this, { master, saw, sq, noiseGain, filter });
  }

  /** 每幀呼叫：把聲音平滑地帶到目標轉速。 */
  update(target: RotorTarget): void {
    if (!this.ctx || !this.master || !this.saw || !this.sq || !this.noiseGain || !this.filter) return;
    const t = this.ctx.currentTime;
    const on = this.enabled ? 1 : 0;
    const k = 0.08; // 時間常數（秒）：轉速變化的反應速度
    this.saw.frequency.setTargetAtTime(Math.max(20, target.freq), t, k);
    this.sq.frequency.setTargetAtTime(Math.max(20, target.freq * 1.012), t, k);
    this.filter.frequency.setTargetAtTime(900 + 1400 * target.spin, t, k);
    this.noiseGain.gain.setTargetAtTime(0.18 * target.spin * on, t, k);
    // 停槳時慢慢收掉（真實馬達會滑行一下）
    this.master.gain.setTargetAtTime(target.gain * this.volume * on, t, target.gain === 0 ? 0.35 : k);
  }

  /** 立刻靜音（離開飛行、換科目）。 */
  silence(): void {
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
  }

  dispose(): void {
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}
